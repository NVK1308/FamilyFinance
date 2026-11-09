import { MESSAGE_INTENT, MESSAGE_STATUS, TABLE_NAME, TRANSFER_STATUS, type MemberId } from '../config/constants.ts';
import { countAuditByReason } from '../db/audit-repository.ts';
import {
  getCategoryById,
  getMemberByTelegramUserId,
  getMessageByUpdateId,
  isActiveMember,
  listActiveCategoriesFor,
  updateMessageStatus,
} from '../db/repositories/index.ts';
import type { ChuyenTienNoiBoRecord, DatabaseAdapter, GiaoDichRecord, HuRecord, ThanhVienRecord } from '../db/types.ts';
import { isActionRequest } from '../parser/intent-classifier.ts';
import { parseQuery } from '../query/query-parser.ts';
import { BalanceService } from '../services/balance-service.ts';
import { DomainError } from '../services/common.ts';
import { insertIncomingMessage, type IncomingMessage, type RecordOutcome } from '../services/message-outcome.ts';
import { QueryService } from '../services/query-service.ts';
import { SavingsService } from '../services/savings-service.ts';
import { KEYBOARD_EXCLUDED_CATEGORIES, TransactionService } from '../services/transaction-service.ts';
import { TransferService } from '../services/transfer-service.ts';
import type { ParsedQueryOrOtherResult } from '../parser/types.ts';
import type { BotAction, InlineKeyboard, TgCallbackQuery, TgMessage, TgUpdate } from '../telegram/types.ts';
import { decodeCallback, type CallbackData } from './callback-data.ts';
import { parseCommand, runCommand } from './commands.ts';
import { memberChatId, otherMember } from './members.ts';
import { ACTION_HELP, QUERY_HELP, queryAnswerText, remindText } from './query-replies.ts';
import {
  DONE_BUT_ERROR_TEXT,
  EDITED_TEXT,
  ERROR_TEXT,
  QUESTION_TEXT,
  SHORT_HELP,
  cancelButton,
  categoryKeyboard,
  formatDay,
  formatMoney,
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
}

export function createBotContext(db: DatabaseAdapter, now: () => Date = () => new Date()): BotContext {
  const options = { now };
  const txs = new TransactionService(db, options);
  return {
    db,
    now,
    txs,
    transfers: new TransferService(db, options),
    balances: new BalanceService(db, options),
    queries: new QueryService(db, options),
    savings: txs.savingsService,
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
    receivedAt: new Date(m.date * 1000).toISOString(),
  };
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
    const m = acceptedText(update.edited_message);
    return m && (await activeMember(ctx.db, m.from.id)) ? [{ type: 'send', chatId: m.chat.id, text: EDITED_TEXT }] : [];
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
  if (chonDanhMuc && (tx.loai_giao_dich === 'THU' || tx.loai_giao_dich === 'CHI')) {
    const categories = await listActiveCategoriesFor(db, tx.loai_giao_dich, KEYBOARD_EXCLUDED_CATEGORIES);
    // Chi trả từ hũ: chỉ đổi danh mục trong loại Chi, không có nút đổi sang Thu
    return { text, keyboard: categoryKeyboard(tx, categories, hu === null) };
  }
  return { text, keyboard: cancelButton('gd', tx.id) };
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
      // Chi từ hũ chung → báo người kia (như bỏ / lấy hũ)
      const other = outcome.hu && !outcome.duplicate ? await memberChatId(ctx.db, otherMember(member.id)) : null;
      if (other !== null && outcome.hu) {
        actions.push({ type: 'send', chatId: other, text: jarExpenseNoticeText(outcome.transaction, outcome.hu, member.id) });
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
        actions.push({ type: 'send', chatId: other, text: fundNoticeText(f) });
      }
      return actions;
    }
    case 'SAVINGS_MOVE': {
      const h = outcome.move;
      const actions: BotAction[] = [send(savingsText(h, outcome.jar, outcome.canhBaoVuotSoDu), h.trang_thai === 'HOAN_TAT' ? cancelButton('hk', h.id) : undefined)];
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
        return [send(await answerQuestion(ctx, member, incoming, parsed))];
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
  return queryAnswerText(await ctx.queries.run(spec, parsed.ngay_tham_chieu), parsed.co_so_tien);
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
    return await runCallback(ctx, member, data, answer, edit);
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
): Promise<BotAction[]> {
  const me = member.id as MemberId;
  switch (data.kind) {
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
      return [answer(note), ...edit(view.text, view.keyboard)];
    }
    case 'gd': {
      const res = await ctx.txs.cancelTransaction(data.id, me, 'Huỷ qua bot', { chiNguoiTao: true });
      const view = await transactionView(ctx, res.transaction, false);
      return [answer(res.changed ? 'Đã huỷ' : 'Khoản này đã huỷ trước đó.'), ...edit(view.text, view.keyboard)];
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
      const other = res.changed ? await memberChatId(ctx.db, otherMember(res.fundMove.thanh_vien_id)) : null;
      if (other !== null) {
        actions.push({ type: 'send', chatId: other, text: `ℹ️ ${memberName(me)} đã huỷ: ${fundNoticeText(res.fundMove).replace(/^ℹ️ /, '')}` });
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
