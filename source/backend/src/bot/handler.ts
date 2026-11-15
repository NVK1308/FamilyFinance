import { MESSAGE_INTENT, MESSAGE_STATUS, TABLE_NAME, TRANSFER_STATUS, type MemberId } from '../config/constants.ts';
import { countAuditByReason } from '../db/audit-repository.ts';
import {
  getCategoryById,
  getMemberByTelegramUserId,
  getMessageByUpdateId,
  getTransactionById,
  isActiveMember,
  listActiveCategoriesFor,
  updateMessageStatus,
} from '../db/repositories/index.ts';
import type { ChuyenTienNoiBoRecord, DatabaseAdapter, GiaoDichRecord, HuRecord, ThanhVienRecord } from '../db/types.ts';
import { isActionRequest } from '../parser/intent-classifier.ts';
import { parseQuery } from '../query/query-parser.ts';
import { BalanceService } from '../services/balance-service.ts';
import { DomainError, toVnDate } from '../services/common.ts';
import { insertIncomingMessage, type IncomingMessage, type RecordOutcome } from '../services/message-outcome.ts';
import { QueryService } from '../services/query-service.ts';
import { SavingsService } from '../services/savings-service.ts';
import { KEYBOARD_EXCLUDED_CATEGORIES, TransactionService } from '../services/transaction-service.ts';
import { TransferService } from '../services/transfer-service.ts';
import { EditService, amountOnly, canEditAmount, type EditResult } from '../services/edit-service.ts';
import { RecurringService, type PayResult } from '../services/recurring-service.ts';
import { BudgetService } from '../services/budget-service.ts';
import type { DueRow } from '../db/repositories/recurring-repository.ts';
import { RECURRING_CODE, RECURRING_PROMPT, dueButtonRow, dueDoneText, recurringPromptText, reminderView } from './recurring-replies.ts';
import { loadSettings } from '../services/settings-service.ts';
import { monthOf, shiftMonth } from '../services/recurring-service.ts';
import type { ParsedQueryOrOtherResult } from '../parser/types.ts';
import type { BotAction, InlineKeyboard, TgCallbackQuery, TgMessage, TgUpdate } from '../telegram/types.ts';
import { decodeCallback, type CallbackData } from './callback-data.ts';
import { isSpouse, parseCommand, recurringListView, runCommand } from './commands.ts';
import { memberChatId, otherMember } from './members.ts';
import { ACTION_HELP, QUERY_HELP, queryAnswerText, remindText, splitTelegramText } from './query-replies.ts';
import {
  DONE_BUT_ERROR_TEXT,
  EDIT_CODE,
  EDIT_PROMPT,
  ERROR_TEXT,
  editButtonRow,
  editNoticeText,
  editPromptText,
  editedText,
  QUESTION_TEXT,
  SHORT_HELP,
  cancelButton,
  categoryKeyboard,
  budgetWarningText,
  debtResultText,
  debtSummaryText,
  deletedJarText,
  formatDay,
  formatMoney,
  fundCancelNoticeText,
  fundToOther,
  fundNoticeText,
  jarExpenseNoticeText,
  savingsCancelNoticeText,
  savingsNoticeText,
  savingsText,
  fundText,
  ignoredText,
  memberName,
  transactionText,
  transferReceiverKeyboard,
  transferReceiverText,
  transferSenderText,
  transferStateText,
} from './replies.ts';

export interface BotContext {
  db: DatabaseAdapter;
  now: () => Date;
  txs: TransactionService;
  transfers: TransferService;
  balances: BalanceService;
  queries: QueryService;
  savings: SavingsService;
  edits: EditService;
  recurring: RecurringService;
  budgets: BudgetService;
  // id bot (phần trước ':' của token) — kiểm tin nhắc sửa đúng do bot này gửi; null = không biết (test)
  botId: number | null;
}

export function createBotContext(db: DatabaseAdapter, now: () => Date = () => new Date(), botId: number | null = null): BotContext {
  const options = { now };
  const txs = new TransactionService(db, options);
  const balances = new BalanceService(db, options);
  return {
    botId,
    db,
    now,
    txs,
    transfers: new TransferService(db, options),
    balances,
    queries: new QueryService(db, options),
    savings: txs.savingsService,
    edits: new EditService(db, txs.savingsService, balances, options),
    recurring: new RecurringService(db, options),
    budgets: new BudgetService(db, options),
  };
}

// Chỉ nhận tin chữ trong chat riêng, không phải tin chuyển tiếp (AC2)
function acceptedText(m: TgMessage | undefined): (TgMessage & { text: string; from: { id: number } }) | null {
  if (!m || m.chat.type !== 'private' || !m.text || !m.from) {
    return null;
  }
  if (m.forward_origin !== undefined || m.forward_from !== undefined || m.forward_date !== undefined) {
    return null;
  }
  return m as TgMessage & { text: string; from: { id: number } };
}

function toIncoming(updateId: number, m: TgMessage & { text: string; from: { id: number } }): IncomingMessage {
  return {
    updateId,
    messageId: m.message_id,
    chatId: m.chat.id,
    senderTelegramUserId: m.from.id,
    text: m.text,
    // Tin đã sửa: thời điểm sửa (sắp thứ tự các lần sửa)
    receivedAt: new Date((m.edit_date ?? m.date) * 1000).toISOString(),
  };
}

// Trả lời tin nhắc do chính bot gửi (bắt đầu bằng prompt, cuối có "Mã: …") → mã; không phải → null
function promptTarget(m: TgMessage, botId: number | null, prompt: string, code: RegExp): string | null {
  const r = m.reply_to_message;
  if (!r?.from?.is_bot || (botId !== null && r.from.id !== botId) || !r.text?.startsWith(prompt)) {
    return null;
  }
  return r.text.match(code)?.[1] ?? null;
}

// "✏️ Nhập số tiền mới … Mã: GD_…" → id giao dịch
function editTarget(m: TgMessage, botId: number | null): string | null {
  return promptTarget(m, botId, EDIT_PROMPT, EDIT_CODE);
}

// "🔁 Nhập số tiền thực … Mã: DKL_…" (nút Số khác của khoản định kỳ) → id lần đến hạn
function recurringTarget(m: TgMessage, botId: number | null): string | null {
  return promptTarget(m, botId, RECURRING_PROMPT, RECURRING_CODE);
}

async function activeMember(db: DatabaseAdapter, telegramUserId: number): Promise<ThanhVienRecord | null> {
  const member = await getMemberByTelegramUserId(db, telegramUserId);
  return isActiveMember(member) ? member : null;
}

// Update → danh sách lệnh gửi Telegram (chạy sau khi DB đã commit). Lỗi không phải DomainError ném ra cho worker.
export async function handleUpdate(ctx: BotContext, update: TgUpdate): Promise<BotAction[]> {
  if (update.callback_query) {
    return handleCallback(ctx, update.callback_query);
  }
  if (update.edited_message) {
    // Sửa tin gốc → sửa số tiền khoản đã ghi (chỉ số tiền, người nhập, trong 1 ngày)
    const m = acceptedText(update.edited_message);
    const member = m ? await activeMember(ctx.db, m.from.id) : null;
    if (!m || !member || parseCommand(m.text)) {
      return [];
    }
    const incoming = toIncoming(update.update_id, m);
    const dueTarget = recurringTarget(m, ctx.botId);
    if (dueTarget) {
      return recurringReplyActions(ctx, member, incoming, dueTarget, true);
    }
    // Sửa lại chính câu trả lời "80k" của nút Sửa → sửa tiếp khoản đó
    const replyTarget = editTarget(m, ctx.botId);
    const res = replyTarget ? await ctx.edits.fromReply(incoming, member, replyTarget) : await ctx.edits.fromEditedMessage(incoming, member);
    if (res.kind === 'NEW_MESSAGE') {
      return outcomeActions(ctx, member, incoming, await ctx.txs.recordFromText(incoming));
    }
    return editActions(ctx, member, m.chat.id, res);
  }
  const m = acceptedText(update.message);
  if (!m) {
    return [];
  }
  const incoming = toIncoming(update.update_id, m);
  const member = await activeMember(ctx.db, m.from.id);
  if (!member) {
    // Người lạ: lưu tin DA_BO_QUA (để đăng ký telegram_user_id — Q9), không trả lời
    await ctx.txs.recordFromText(incoming);
    return [];
  }
  const command = parseCommand(m.text);
  if (command) {
    return runCommand(ctx, member, m.chat.id, command.name, command.args, update.update_id);
  }
  const dueTarget = recurringTarget(m, ctx.botId);
  if (dueTarget) {
    return recurringReplyActions(ctx, member, incoming, dueTarget, false);
  }
  const target = editTarget(m, ctx.botId);
  if (target) {
    return editActions(ctx, member, m.chat.id, await ctx.edits.fromReply(incoming, member, target));
  }
  try {
    return await outcomeActions(ctx, member, incoming, await ctx.txs.recordFromText(incoming));
  } catch (error) {
    if (error instanceof DomainError) {
      return [{ type: 'send', chatId: m.chat.id, text: `Chưa ghi được: ${error.message}` }];
    }
    throw error;
  }
}

// Lỗi không tạm thời (3.1): transaction riêng lưu/đánh dấu tin LOI, báo người gửi nếu là thành viên
export async function handleFailure(ctx: BotContext, update: TgUpdate, error: unknown): Promise<BotAction[]> {
  const detail = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  if (update.callback_query) {
    return [{ type: 'answer', callbackQueryId: update.callback_query.id, text: ERROR_TEXT }];
  }
  // Sửa tin lỗi → báo người sửa; lỗi xảy ra sau khi đã ghi (tin của update này đã DA_GHI) → báo đã ghi, đừng làm lại
  const edited = acceptedText(update.edited_message);
  if (edited) {
    if (!(await activeMember(ctx.db, edited.from.id))) {
      return [];
    }
    const done = (await getMessageByUpdateId(ctx.db, update.update_id))?.trang_thai_xu_ly === MESSAGE_STATUS.DA_GHI;
    return [{ type: 'send', chatId: edited.chat.id, text: done ? DONE_BUT_ERROR_TEXT : ERROR_TEXT }];
  }
  const m = acceptedText(update.message);
  if (!m) {
    return [];
  }
  const member = await activeMember(ctx.db, m.from.id);
  const nowIso = ctx.now().toISOString();
  const alreadyDone = await ctx.db.transaction(async (tx) => {
    const messageId = await insertIncomingMessage(tx, toIncoming(update.update_id, m), member?.id ?? null, nowIso);
    const existing = messageId ? null : await getMessageByUpdateId(tx, update.update_id);
    // Tin đã xử lý xong (lỗi xảy ra sau commit) → giữ nguyên trạng thái
    const target = messageId ?? (existing?.trang_thai_xu_ly === MESSAGE_STATUS.DA_NHAN ? existing.id : null);
    if (target) {
      await updateMessageStatus(tx, target, MESSAGE_STATUS.LOI, nowIso, detail);
    }
    return target === null;
  });
  return member ? [{ type: 'send', chatId: m.chat.id, text: alreadyDone ? DONE_BUT_ERROR_TEXT : ERROR_TEXT }] : [];
}

// ---------- Sửa số tiền ----------

async function editActions(ctx: BotContext, member: ThanhVienRecord, chatId: number, res: EditResult): Promise<BotAction[]> {
  switch (res.kind) {
    case 'EDITED': {
      const name = await categoryName(ctx.db, res.after);
      const view = await transactionView(ctx, res.after, false, res.jar);
      const warn = [
        res.canhBaoVuotSoDu ? '⚠️ Số tiền lớn hơn số đang giữ — kiểm tra lại.' : '',
        res.canhBaoHuAm && res.jar ? `⚠️ Hũ ${res.jar.ten} bị âm — kiểm tra lại.` : '',
      ].filter(Boolean);
      const actions: BotAction[] = [{ type: 'send', chatId, text: [editedText(res.before, view.text), ...warn].join('\n'), ...(view.keyboard ? { keyboard: view.keyboard } : {}) }];
      const other = await memberChatId(ctx.db, otherMember(member.id));
      if (other !== null) {
        actions.push({ type: 'send', chatId: other, text: editNoticeText(res.before, res.after, name, member.id, toVnDate(ctx.now())) });
      }
      actions.push(...(await budgetActions(ctx, res.after)));
      return actions;
    }
    case 'REPLAY': {
      // Telegram gửi lại bản sửa đã áp: nhắc lại kết quả hiện tại (không báo người kia lần nữa)
      const view = await transactionView(ctx, res.transaction, false);
      return [{ type: 'send', chatId, text: `✏️ Đã sửa: ${view.text.replace(/^✅ /, '')}`, ...(view.keyboard ? { keyboard: view.keyboard } : {}) }];
    }
    case 'REJECTED':
      return [{ type: 'send', chatId, text: ignoredText(res.reason) }];
    case 'UNCHANGED':
      return [{ type: 'send', chatId, text: 'Số tiền không đổi.' }];
    default:
      return [];
  }
}

// ---------- Trả lời kết quả ghi tin nhắn ----------

async function categoryName(db: DatabaseAdapter, tx: GiaoDichRecord): Promise<string | null> {
  return tx.danh_muc_id ? ((await getCategoryById(db, tx.danh_muc_id))?.ten_danh_muc ?? null) : null;
}

// Tin + bàn phím của giao dịch theo trạng thái DB hiện tại
// jar: hũ nguồn nếu là khoản chi trả từ hũ (undefined → tự tra)
async function transactionView(
  ctx: BotContext,
  tx: GiaoDichRecord,
  chonDanhMuc: boolean,
  jar?: HuRecord | null,
): Promise<{ text: string; keyboard?: InlineKeyboard }> {
  const db = ctx.db;
  const hu = jar === undefined ? await ctx.savings.jarOfTransaction(db, tx.id) : jar;
  const text = transactionText(tx, await categoryName(db, tx), chonDanhMuc, hu?.ten ?? null);
  if (tx.trang_thai !== 'HOAN_TAT') {
    return { text };
  }
  // Còn trong 1 ngày → thêm nút "✏️ Sửa số tiền"
  const editRow = canEditAmount(tx, ctx.now()) ? editButtonRow(tx) : [];
  if (chonDanhMuc && (tx.loai_giao_dich === 'THU' || tx.loai_giao_dich === 'CHI')) {
    const categories = await listActiveCategoriesFor(db, tx.loai_giao_dich, KEYBOARD_EXCLUDED_CATEGORIES);
    // Chi trả từ hũ: chỉ đổi danh mục trong loại Chi, không có nút đổi sang Thu
    return { text, keyboard: [...categoryKeyboard(tx, categories, hu === null), ...editRow] };
  }
  return { text, keyboard: [...cancelButton('gd', tx.id), ...editRow] };
}

const RECEIVED_WORDS = /^(đã nhận|da nhan|nhận rồi|nhan roi|đã nhận rồi|da nhan roi|ok đã nhận)\.?$/i;

async function outcomeActions(
  ctx: BotContext,
  member: ThanhVienRecord,
  incoming: IncomingMessage,
  outcome: RecordOutcome,
): Promise<BotAction[]> {
  const chatId = incoming.chatId;
  const send = (t: string, keyboard?: InlineKeyboard): BotAction => ({
    type: 'send',
    chatId,
    text: t,
    ...(keyboard ? { keyboard } : {}),
  });
  switch (outcome.kind) {
    case 'RECORDED': {
      const view = await transactionView(ctx, outcome.transaction, outcome.chonDanhMuc, outcome.hu);
      const warn = outcome.canhBaoHuAm ? `\n⚠️ Hũ ${outcome.hu?.ten} bị âm — kiểm tra lại.` : '';
      const actions: BotAction[] = [send(`${view.text}${warn}`, view.keyboard)];
      if (!outcome.duplicate) {
        actions.push(...(await budgetActions(ctx, outcome.transaction)));
      }
      // Chi từ hũ chung → báo người kia (như bỏ / lấy hũ)
      const other = outcome.hu && !outcome.duplicate ? await memberChatId(ctx.db, otherMember(member.id)) : null;
      if (other !== null && outcome.hu) {
        actions.push({ type: 'send', chatId: other, text: jarExpenseNoticeText(outcome.transaction, outcome.hu, member.id) });
      }
      return actions;
    }
    case 'DEBT': {
      const view = await transactionView(ctx, outcome.transaction, false);
      const actions: BotAction[] = [send(debtResultText(outcome.transaction, outcome.loan), view.keyboard)];
      const other = outcome.duplicate ? null : await memberChatId(ctx.db, otherMember(member.id));
      if (other !== null) {
        actions.push({ type: 'send', chatId: other, text: debtResultText(outcome.transaction, outcome.loan, member.id) });
      }
      return actions;
    }
    case 'PENDING':
      return [send('Tin này đang chờ xác nhận.')];
    case 'IGNORED':
      return [send(ignoredText(outcome.reason))];
    case 'TRANSFER':
      return transferActions(ctx, chatId, outcome.transfer, outcome.confirmation?.id ?? null, outcome.canhBaoVuotSoDu, outcome.duplicate);
    case 'FUND_MOVE': {
      const f = outcome.fundMove;
      const actions: BotAction[] = [send(fundText(f, outcome.canhBaoVuotSoDu), f.trang_thai === 'HOAN_TAT' ? cancelButton('qc', f.id) : undefined)];
      const other = outcome.duplicate ? null : await memberChatId(ctx.db, otherMember(f.thanh_vien_id));
      if (other !== null) {
        // Quỹ đưa thẳng người nhận: người nhận có nút Huỷ (không có bước xác nhận)
        const keyboard = fundToOther(f) && f.trang_thai === 'HOAN_TAT' ? { keyboard: cancelButton('qc', f.id) } : {};
        actions.push({ type: 'send', chatId: other, text: fundNoticeText(f), ...keyboard });
      }
      return actions;
    }
    case 'SAVINGS_MOVE': {
      const h = outcome.move;
      const actions: BotAction[] = [send(savingsText(h, outcome.jar, outcome.canhBaoVuotSoDu, outcome.giaVangThamChieu ?? null), h.trang_thai === 'HOAN_TAT' ? cancelButton('hk', h.id) : undefined)];
      const other = outcome.duplicate ? null : await memberChatId(ctx.db, otherMember(h.thanh_vien_id));
      if (other !== null) {
        actions.push({ type: 'send', chatId: other, text: savingsNoticeText(h, outcome.jar) });
      }
      return actions;
    }
    case 'NOT_TRANSACTION': {
      const parsed = outcome.parsed;
      // "huỷ lệnh … được không", "xoá khoản hôm qua" → hướng dẫn nút, không thống kê / không đoán
      if ('normalizedText' in parsed && isActionRequest(parsed.normalizedText)) {
        return [send(ACTION_HELP)];
      }
      if (parsed.intent === MESSAGE_INTENT.QUERY_STATISTICS) {
        // Liệt kê đủ có thể dài → tách nhiều tin
        return splitTelegramText(await answerQuestion(ctx, member, incoming, parsed)).map((t) => send(t));
      }
      if (parsed.intent === MESSAGE_INTENT.EXPORT_HTML_REPORT) {
        return [send(QUESTION_TEXT)];
      }
      const remind = 'ly_do' in parsed ? remindText(parsed.ly_do) : null;
      if (remind) {
        return [send(remind)];
      }
      if (RECEIVED_WORDS.test(incoming.text.trim().normalize('NFC'))) {
        const waiting = (await ctx.transfers.listPendingTransfers()).some((t) => t.nguoi_nhan_id === member.id);
        if (waiting) {
          return [send('Bấm nút "Đã nhận" dưới tin chuyển tiền (gõ /cho để xem lại).')];
        }
      }
      return [send(SHORT_HELP)];
    }
  }
}

// Phase 5b: câu hỏi thống kê — chỉ đọc DB. Câu chưa hiểu → lưu tin DA_BO_QUA để học dần (Q7).
async function answerQuestion(
  ctx: BotContext,
  member: ThanhVienRecord,
  incoming: IncomingMessage,
  parsed: ParsedQueryOrOtherResult,
): Promise<string> {
  const spec = parseQuery(incoming.text, parsed.ngay_tham_chieu, await ctx.savings.jarNames());
  // Phase 8b: hỏi nợ → khoản nợ đang mở
  if (spec?.kind === 'NO') {
    return debtSummaryText(await ctx.txs.debtService.listOpen());
  }
  if (!spec) {
    const nowIso = ctx.now().toISOString();
    await ctx.db.transaction(async (tx) => {
      const id = await insertIncomingMessage(tx, incoming, member.id as MemberId, nowIso);
      if (id) {
        await updateMessageStatus(tx, id, MESSAGE_STATUS.DA_BO_QUA, nowIso, UNKNOWN_QUESTION);
      }
    });
    return QUERY_HELP;
  }
  return queryAnswerText(await ctx.queries.run(spec, parsed.ngay_tham_chieu), parsed.co_so_tien, parsed.ngay_tham_chieu);
}

export const UNKNOWN_QUESTION = 'CAU_HOI_CHUA_HIEU';

// AC4/AC5: gửi người nhận trước (403 → ghi chú cho người chuyển); update gửi lại chỉ gửi lại người nhận khi còn chờ
async function transferActions(
  ctx: BotContext,
  senderChat: number,
  t: ChuyenTienNoiBoRecord,
  yeuCauId: string | null,
  overBalance: boolean,
  duplicate: boolean,
): Promise<BotAction[]> {
  const pending = t.trang_thai === TRANSFER_STATUS.CHO_XAC_NHAN;
  const actions: BotAction[] = [];
  const receiverChat = pending && yeuCauId ? await memberChatId(ctx.db, t.nguoi_nhan_id) : null;
  if (receiverChat !== null && yeuCauId) {
    actions.push({
      type: 'send',
      chatId: receiverChat,
      text: transferReceiverText(t),
      keyboard: transferReceiverKeyboard(yeuCauId),
      onBlocked: {
        type: 'send',
        chatId: senderChat,
        text: `⚠️ ${memberName(t.nguoi_nhan_id)} chưa mở bot nên chưa nhận được tin. Nhắc ${memberName(t.nguoi_nhan_id).toLowerCase()} nhắn /start rồi gõ /cho.`,
      },
    });
  }
  const text = duplicate && !pending ? transferStateText(t) : transferSenderText(t, overBalance);
  actions.push({
    type: 'send',
    chatId: senderChat,
    text,
    ...(pending ? { keyboard: cancelButton('ct', t.id, 'Huỷ chuyển') } : {}),
  });
  return actions;
}

// ---------- Nút bấm ----------

const DENIED: Record<string, string> = {
  WRONG_CONFIRMER: 'Nút này không dành cho bạn.',
  FORBIDDEN: 'Chỉ người ghi khoản này mới bấm được.',
  NOT_FOUND: 'Không tìm thấy khoản này.',
};

async function handleCallback(ctx: BotContext, cq: TgCallbackQuery): Promise<BotAction[]> {
  const answer = (text?: string): BotAction => ({ type: 'answer', callbackQueryId: cq.id, ...(text ? { text } : {}) });
  const member = await activeMember(ctx.db, cq.from.id);
  const data = decodeCallback(cq.data);
  if (!member || !data) {
    return [answer()];
  }
  const edit = (text: string, keyboard?: InlineKeyboard): BotAction[] =>
    cq.message
      ? [{ type: 'edit', chatId: cq.message.chat.id, messageId: cq.message.message_id, text, ...(keyboard ? { keyboard } : {}) }]
      : [];
  try {
    return await runCallback(ctx, member, data, answer, edit, cq.message);
  } catch (error) {
    if (error instanceof DomainError) {
      return [answer(DENIED[error.code] ?? error.message)];
    }
    throw error;
  }
}

type Answer = (text?: string) => BotAction;
type Edit = (text: string, keyboard?: InlineKeyboard) => BotAction[];

async function runCallback(
  ctx: BotContext,
  member: ThanhVienRecord,
  data: CallbackData,
  answer: Answer,
  edit: Edit,
  source?: TgMessage,
): Promise<BotAction[]> {
  const me = member.id as MemberId;
  switch (data.kind) {
    case 'dk':
      return dueCallback(ctx, member, data.id, data.action, answer, source);
    case 'xh': {
      if (!isSpouse(member)) {
        return [answer(DENIED.WRONG_CONFIRMER)];
      }
      if (data.mode === 'X') {
        return [answer('Đã thôi'), ...edit('Đã thôi — không xoá hũ.')];
      }
      const dest = data.dest === 'V' ? 'VO' : data.dest === 'C' ? 'CHONG' : 'QUY_CHUNG';
      const gold = data.mode === 'B' ? { kind: 'SELL' as const } : data.mode === 'J' && data.toJarId ? { kind: 'MOVE' as const, toJarId: data.toJarId } : { kind: 'NONE' as const };
      const res = await ctx.savings.deleteJar(data.jarId, me, dest, gold);
      if (res.kind === 'DONE') {
        return [answer('Hũ này đã xoá trước đó.'), ...edit(`🗑 Hũ ${res.jar.ten} đã xoá.`)];
      }
      const actions: BotAction[] = [answer('Đã xoá hũ'), ...edit(deletedJarText(res))];
      const other = await memberChatId(ctx.db, otherMember(me));
      if (other !== null) {
        actions.push({ type: 'send', chatId: other, text: deletedJarText(res, me) });
      }
      return actions;
    }
    case 'dx': {
      if (!isSpouse(member)) {
        return [answer(DENIED.WRONG_CONFIRMER)];
      }
      const res = await ctx.recurring.stop(data.id, me);
      if (!res.item) {
        return [answer(DENIED.NOT_FOUND)];
      }
      const ky = monthOf(toVnDate(ctx.now()));
      const view = await recurringListView(ctx, await loadSettings(ctx.db));
      const redraw = await redrawReminders(ctx, [shiftMonth(ky, -1), ky], RecurringService.holdersOf(res.item));
      return [answer(res.changed ? `Đã dừng ${res.item.ten}` : 'Khoản này đã dừng trước đó.'), ...edit(view.text, view.keyboard), ...redraw];
    }
    case 'yc':
      return confirmCallback(ctx, me, data.id, data.accept, answer, edit);
    case 'dm':
    case 'lt': {
      const change =
        data.kind === 'dm'
          ? { maDanhMuc: data.code }
          : { loai: data.to, maDanhMuc: data.to === 'THU' ? 'THU_KHAC' : 'CHI_KHAC' };
      const res = await ctx.txs.changeCategory(data.id, me, change);
      // Đổi Thu↔Chi → hiện bàn phím loại mới; chọn danh mục xong → chỉ còn Huỷ
      const view = await transactionView(ctx, res.transaction, data.kind === 'lt');
      const note = res.transaction.trang_thai === 'DA_HUY' ? 'Khoản này đã huỷ.' : res.changed ? 'Đã đổi' : undefined;
      return [answer(note), ...edit(view.text, view.keyboard), ...(res.changed ? await budgetActions(ctx, res.transaction) : [])];
    }
    case 'sd': {
      // Nút "✏️ Sửa số tiền" → gửi tin nhắc, người dùng trả lời bằng số tiền mới
      const tx = await getTransactionById(ctx.db, data.id);
      if (!tx || tx.nguoi_tao_id !== me) {
        return [answer('Chỉ người nhập khoản này mới sửa được.')];
      }
      if (!canEditAmount(tx, ctx.now())) {
        return [answer(tx.trang_thai === 'DA_HUY' ? 'Khoản này đã huỷ.' : 'Đã quá 1 ngày — không sửa được.')];
      }
      return [
        answer(),
        { type: 'send', chatId: Number(member.telegram_user_id), text: editPromptText(tx, await categoryName(ctx.db, tx)), forceReply: 'vd 80k' },
      ];
    }
    case 'gd': {
      const res = await ctx.txs.cancelTransaction(data.id, me, 'Huỷ qua bot', { chiNguoiTao: true });
      const view = await transactionView(ctx, res.transaction, false);
      const due = res.lanDinhKy;
      if (!due) {
        return [answer(res.changed ? 'Đã huỷ' : 'Khoản này đã huỷ trước đó.'), ...edit(view.text, view.keyboard)];
      }
      // Khoản ghi từ định kỳ: lần về chờ → hiện lại nút; vẽ lại tin nhắc chung cho khớp
      const reopened = due.trang_thai === 'CHO';
      const text = reopened ? `${view.text}\n🔁 ${due.ten} tháng ${due.ky.slice(5)}/${due.ky.slice(0, 4)} về chờ — bấm lại bên dưới.` : view.text;
      return [
        answer('Đã huỷ'),
        ...edit(text, reopened ? [dueButtonRow(due)] : undefined),
        ...(await redrawReminders(ctx, [due.ky], RecurringService.holdersOf(due))),
      ];
    }
    case 'ct': {
      let res;
      try {
        res = await ctx.transfers.cancelTransfer(data.id, me);
      } catch (error) {
        if (error instanceof DomainError && error.code === 'CANCEL_BLOCKED') {
          const t = await ctx.transfers.getTransfer(data.id);
          return [answer('Người nhận đã xác nhận — nhầm thì chuyển ngược lại.'), ...(t ? edit(transferStateText(t)) : [])];
        }
        throw error;
      }
      const actions: BotAction[] = [answer(res.changed ? 'Đã huỷ chuyển' : undefined), ...edit(transferStateText(res.transfer))];
      const receiver = res.changed ? await memberChatId(ctx.db, res.transfer.nguoi_nhan_id) : null;
      if (receiver !== null) {
        actions.push({ type: 'send', chatId: receiver, text: transferStateText(res.transfer) });
      }
      return actions;
    }
    case 'qc': {
      const res = await ctx.transfers.cancelFundMove(data.id, me);
      const actions: BotAction[] = [answer(res.changed ? 'Đã huỷ' : 'Khoản này đã huỷ trước đó.'), ...edit(fundText(res.fundMove, false))];
      // Người nhận cũng huỷ được (quỹ đưa thẳng) → báo người còn lại, không phải người ghi
      const other = res.changed ? await memberChatId(ctx.db, otherMember(me)) : null;
      if (other !== null) {
        actions.push({ type: 'send', chatId: other, text: fundCancelNoticeText(res.fundMove, me) });
      }
      return actions;
    }
    case 'hk': {
      const res = await ctx.savings.cancel(data.id, me);
      const actions: BotAction[] = [answer(res.changed ? 'Đã huỷ' : 'Khoản này đã huỷ trước đó.'), ...edit(savingsText(res.move, res.jar, false))];
      const other = res.changed ? await memberChatId(ctx.db, otherMember(res.move.thanh_vien_id)) : null;
      if (other !== null) {
        actions.push({ type: 'send', chatId: other, text: savingsCancelNoticeText(res.move, res.jar, me) });
      }
      return actions;
    }
  }
}

// AC6: Đã nhận / Chưa nhận. "Chưa nhận" giữ nút; chỉ báo người chuyển ở lần bấm đầu.
async function confirmCallback(
  ctx: BotContext,
  me: MemberId,
  yeuCauId: string,
  accept: boolean,
  answer: Answer,
  edit: Edit,
): Promise<BotAction[]> {
  const res = await ctx.txs.resolveConfirmation(yeuCauId, me, accept ? { type: 'ACCEPT' } : { type: 'REJECT' });
  const t = res.transfer;
  if (!t) {
    // Yêu cầu cũ không phải chuyển tiền (không còn tạo từ tin nhắn)
    const text = res.transaction ? transactionText(res.transaction, await categoryName(ctx.db, res.transaction)) : 'Đã xử lý.';
    return [answer(res.changed ? 'Đã ghi nhận' : 'Đã xử lý trước đó.'), ...edit(text)];
  }
  const sender = await memberChatId(ctx.db, t.nguoi_chuyen_id);
  const amount = `${formatMoney(Number(t.so_tien))} (${formatDay(t.ngay_chuyen)})`;
  if (!accept && t.trang_thai === TRANSFER_STATUS.CHO_XAC_NHAN) {
    const times = await countAuditByReason(ctx.db, TABLE_NAME.CHUYEN_TIEN_NOI_BO, t.id, 'CHUA_NHAN');
    const actions: BotAction[] = [answer('Đã ghi nhận: chưa nhận được.')];
    if (times === 1 && sender !== null) {
      actions.push({ type: 'send', chatId: sender, text: `⏳ ${memberName(me)} báo chưa nhận được ${amount}.` });
    }
    return actions;
  }
  if (res.changed) {
    const actions: BotAction[] = [answer('Đã ghi nhận'), ...edit(transferStateText(t))];
    if (sender !== null) {
      actions.push({ type: 'send', chatId: sender, text: `✅ ${memberName(me)} đã nhận ${amount}.` });
    }
    return actions;
  }
  if (res.expired) {
    return [answer('Khoản này đã quá hạn xác nhận.'), ...edit(transferStateText(t, 'đã quá hạn xác nhận'))];
  }
  return [answer('Khoản này đã được xử lý.'), ...edit(transferStateText(t))];
}

// ---------- Phase 7: khoản định kỳ ----------

// Vẽ lại tin nhắc chung đang còn nút của các người / kỳ (sau khi bấm, huỷ, dừng khoản)
async function redrawReminders(ctx: BotContext, kys: readonly string[], members: readonly MemberId[]): Promise<BotAction[]> {
  const actions: BotAction[] = [];
  for (const ky of kys) {
    for (const memberId of members) {
      const live = await ctx.recurring.liveReminder(ky, memberId);
      const chatId = live ? await memberChatId(ctx.db, memberId) : null;
      if (!live || chatId === null) {
        continue;
      }
      const view = reminderView(await ctx.recurring.dueLines(ky, memberId), ky, memberId, live.lanNhac);
      actions.push({ type: 'edit', chatId, messageId: live.messageId, text: view.text, keyboard: view.keyboard });
    }
  }
  return actions;
}

// Kết quả ghi / bỏ qua: tin kết quả (nếu có) + vẽ lại tin nhắc chung.
// clicked: tin chứa nút vừa bấm — không phải tin nhắc chung (vd danh sách /dinhky) → gỡ nút cho khỏi bấm lại.
async function dueResultActions(
  ctx: BotContext,
  chatId: number,
  due: DueRow,
  result: { text: string; keyboard?: InlineKeyboard } | null,
  clicked?: TgMessage,
): Promise<BotAction[]> {
  const redraw = await redrawReminders(ctx, [due.ky], RecurringService.holdersOf(due));
  const actions: BotAction[] = [];
  if (result) {
    actions.push({ type: 'send', chatId, text: result.text, ...(result.keyboard ? { keyboard: result.keyboard } : {}) });
  }
  const isReminder = redraw.some((a) => a.type === 'edit' && a.chatId === clicked?.chat.id && a.messageId === clicked?.message_id);
  if (clicked && !isReminder && clicked.text) {
    actions.push({ type: 'edit', chatId: clicked.chat.id, messageId: clicked.message_id, text: clicked.text });
  }
  return [...actions, ...redraw];
}

async function payResult(ctx: BotContext, res: Extract<PayResult, { kind: 'PAID' }>): Promise<{ text: string; keyboard?: InlineKeyboard }> {
  const view = await transactionView(ctx, res.transaction, false);
  const note = res.fallbackCategory ? '\n(Danh mục cũ đã ngừng dùng → ghi vào mục Khác)' : '';
  return { text: `${view.text}${note}`, ...(view.keyboard ? { keyboard: view.keyboard } : {}) };
}

// Nút của tin nhắc: A = ghi đúng số đã khai · S = gửi tin nhắc nhập số khác · B = tháng này không có
async function dueCallback(
  ctx: BotContext,
  member: ThanhVienRecord,
  dueId: string,
  action: 'A' | 'S' | 'B',
  answer: Answer,
  clicked?: TgMessage,
): Promise<BotAction[]> {
  if (!isSpouse(member)) {
    return [answer(DENIED.WRONG_CONFIRMER)];
  }
  const me = member.id as MemberId;
  const chatId = Number(member.telegram_user_id);
  if (action === 'S') {
    const due = await ctx.recurring.getDue(dueId);
    if (!due) {
      return [answer(DENIED.NOT_FOUND)];
    }
    if (due.trang_thai !== 'CHO' || !due.khoan_active || toVnDate(ctx.now()) > due.han_dong) {
      return [answer(toVnDate(ctx.now()) > due.han_dong && due.trang_thai === 'CHO' ? 'Khoản này đã quá hạn bấm.' : dueDoneText(due)), ...(await dueResultActions(ctx, chatId, due, null, clicked))];
    }
    return [answer(), { type: 'send', chatId, text: recurringPromptText(due), forceReply: 'vd 1tr45' }];
  }
  if (action === 'B') {
    const res = await ctx.recurring.skip(dueId, me);
    if (res.kind === 'NOT_FOUND') {
      return [answer(DENIED.NOT_FOUND)];
    }
    return [answer(res.kind === 'SKIPPED' ? `Đã đánh dấu: ${res.due.ten} tháng này không có` : dueDoneText(res.due)), ...(await dueResultActions(ctx, chatId, res.due, null, clicked))];
  }
  const res = await ctx.recurring.pay(dueId, me, null);
  if (res.kind === 'NOT_FOUND') {
    return [answer(DENIED.NOT_FOUND)];
  }
  if (res.kind !== 'PAID') {
    return [answer(dueDoneText(res.due)), ...(await dueResultActions(ctx, chatId, res.due, null, clicked))];
  }
  return [answer('Đã ghi'), ...(await dueResultActions(ctx, chatId, res.due, await payResult(ctx, res), clicked)), ...(await budgetActions(ctx, res.transaction))];
}

// Trả lời tin nhắc "Số khác" bằng số tiền. Sửa lại câu trả lời sau khi đã ghi → sửa số tiền khoản đó (như nút ✏️ Sửa).
async function recurringReplyActions(
  ctx: BotContext,
  member: ThanhVienRecord,
  incoming: IncomingMessage,
  dueId: string,
  edited: boolean,
): Promise<BotAction[]> {
  const chatId = incoming.chatId;
  const send = (text: string): BotAction[] => [{ type: 'send', chatId, text }];
  if (!isSpouse(member)) {
    return send('Chỉ vợ / chồng ghi được khoản định kỳ.');
  }
  const amount = amountOnly(incoming.text, member.id as MemberId);
  if (amount === null) {
    return send('Chưa hiểu số tiền — trả lời lại tin nhắc bằng số, vd 1tr45.');
  }
  const due = await ctx.recurring.getDue(dueId);
  if (!due) {
    return send(DENIED.NOT_FOUND!);
  }
  if (edited && due.trang_thai === 'DA_GHI' && due.giao_dich_id) {
    return editActions(ctx, member, chatId, await ctx.edits.fromReply(incoming, member, due.giao_dich_id));
  }
  const res = await ctx.recurring.pay(dueId, member.id as MemberId, amount);
  if (res.kind === 'NOT_FOUND') {
    return send(DENIED.NOT_FOUND!);
  }
  if (res.kind !== 'PAID') {
    return [...send(dueDoneText(res.due)), ...(await redrawReminders(ctx, [res.due.ky], RecurringService.holdersOf(res.due)))];
  }
  return [...(await dueResultActions(ctx, chatId, res.due, await payResult(ctx, res))), ...(await budgetActions(ctx, res.transaction))];
}

// ---------- Phase 8c: cảnh báo ngân sách (sau commit, báo cả 2 người) ----------

async function budgetActions(ctx: BotContext, tx: GiaoDichRecord): Promise<BotAction[]> {
  if (tx.loai_giao_dich !== 'CHI') {
    return [];
  }
  const warning = await ctx.budgets.checkAfterSpend(tx, () => loadSettings(ctx.db));
  if (!warning) {
    return [];
  }
  const actions: BotAction[] = [];
  for (const id of ['VO', 'CHONG'] as const) {
    const chatId = await memberChatId(ctx.db, id);
    if (chatId !== null) {
      actions.push({ type: 'send', chatId, text: budgetWarningText(warning) });
    }
  }
  return actions;
}
