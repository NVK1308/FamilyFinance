import { CONFIRMATION_STATUS, CONFIRMATION_TYPE, DEFAULT_JAR_ID, type MemberId } from '../config/constants.ts';
import {
  hasCompletedTransactionsFrom,
  listActiveInitialBalances,
  listConfirmationsByMessage,
  listDebtNotes,
} from '../db/repositories/index.ts';
import type { ThanhVienRecord } from '../db/types.ts';
import { extractAmountVnd } from '../parser/amount-parser.ts';
import { createParseContext } from '../parser/normalizer.ts';
import { DomainError, toVnDate, vnMonthRange } from '../services/common.ts';
import type { BotAction } from '../telegram/types.ts';
import type { BotContext } from './handler.ts';
import { memberChatId, otherMember } from './members.ts';
import {
  HELP_TEXT,
  balanceSummaryLines,
  ignoredText,
  jarListLines,
  cancelButton,
  formatDay,
  formatMoney,
  holderName,
  memberName,
  transferReceiverKeyboard,
  transferReceiverText,
  savingsNoticeText,
  savingsText,
} from './replies.ts';

export const NOTE_LIMIT = 20;
const PENDING_LIMIT = 10;
const NEED_INITIAL = 'Chưa nhập số dư ban đầu. Gõ: /sodudau <vợ> <chồng> <quỹ chung>, vd /sodudau 5tr 3tr 2tr';

// '/thang@ten_bot 123' → { name: 'thang', args: ['123'] }; không phải lệnh → null
export function parseCommand(text: string): { name: string; args: string[] } | null {
  const m = text.trim().match(/^\/([A-Za-z0-9_]+)(?:@\S+)?(?:\s+([\s\S]*))?$/);
  if (!m) {
    return null;
  }
  return { name: m[1]!.toLowerCase(), args: (m[2] ?? '').split(/\s+/).filter(Boolean) };
}

export async function runCommand(
  ctx: BotContext,
  member: ThanhVienRecord,
  chatId: number,
  name: string,
  args: string[],
  // update_id của Telegram: khoá chống ghi 2 lần cho lệnh có ghi DB (/tietkiemdau)
  updateId?: number,
): Promise<BotAction[]> {
  const reply = (text: string): BotAction[] => [{ type: 'send', chatId, text }];
  switch (name) {
    case 'start':
    case 'help':
      return reply(`Chào ${member.ten}!\n${HELP_TEXT}`);
    case 'sodu':
      return reply(await balanceText(ctx));
    case 'thang':
      return reply(await monthText(ctx));
    case 'cho':
      return pendingTransfers(ctx, member.id as MemberId, chatId);
    case 'ghichu':
      return reply(await notesText(ctx));
    case 'sodudau':
      return reply(await setInitial(ctx, member.id as MemberId, args));
    case 'tietkiem':
      return reply(await savingsJarText(ctx));
    case 'taohu':
      return reply(await createJar(ctx, member, args));
    case 'tietkiemdau':
      return declareSavings(ctx, member, chatId, args, updateId);
    default:
      return reply(`Không có lệnh /${name}.\n${HELP_TEXT}`);
  }
}

async function balanceText(ctx: BotContext): Promise<string> {
  const today = toVnDate(ctx.now());
  const res = await ctx.balances.getHolderBalances(today);
  if (res.status !== 'OK') {
    return NEED_INITIAL;
  }
  const hu = (await ctx.savings.getJar(today)).tien;
  return balanceSummaryLines(res.nhom, res.tong, today, hu).join('\n');
}

const SAVINGS_LABEL: Record<string, string> = { KHAI_BAO: 'Khai báo', NOP: 'Bỏ vào', RUT: 'Lấy ra' };
const SAVINGS_RECENT = 5;
const SAVINGS_SYNTAX = [
  'Tạo hũ: /taohu Mua nhà 2 tỷ (mục tiêu không bắt buộc)',
  'Khai báo tiền đang để dành (không trừ ai): /tietkiemdau 50tr mua nhà',
  'Bỏ / lấy: nhắn "bỏ hũ mua nhà 5tr", "rút quỹ y tế 2tr", "khám bệnh 500k lấy từ quỹ y tế"',
].join('\n');

async function savingsJarText(ctx: BotContext): Promise<string> {
  const today = toVnDate(ctx.now());
  const rows = await ctx.savings.listJarBalances(today);
  const names = new Map(rows.map((r) => [r.jar.id, r.jar.ten]));
  const recent = (await ctx.savings.listRecent(SAVINGS_RECENT)).map((h) => {
    const who = h.nguon_id === null ? '' : h.nguon_id === 'QUY_CHUNG' ? ', quỹ chung' : `, ${memberName(h.nguon_id).toLowerCase()}`;
    // Dòng lấy ra đi kèm khoản chi → "Chi từ hũ"
    const label = h.giao_dich_id ? 'Chi từ hũ' : SAVINGS_LABEL[h.chieu];
    return `• ${formatDay(h.ngay)} ${label} ${formatMoney(Number(h.so_tien ?? 0))} (${names.get(h.hu_id ?? DEFAULT_JAR_ID) ?? '?'}${who})`;
  });
  return [...jarListLines(rows, today), ...(recent.length ? ['Gần đây:', ...recent] : []), '', SAVINGS_SYNTAX].join('\n');
}

// "/taohu Mua nhà 2 tỷ" → tên + mục tiêu (1–2 chữ cuối là số tiền)
function splitNameAndAmount(args: string[], memberId: MemberId): { name: string; amount: number | null } {
  for (const n of [2, 1]) {
    if (args.length > n) {
      const amount = parseMoneyArg(args.slice(-n).join(' '), memberId);
      // Số trần dưới 10.000 ("2026") không phải mục tiêu
      if (amount && amount >= 10_000) {
        return { name: args.slice(0, -n).join(' '), amount };
      }
    }
  }
  return { name: args.join(' '), amount: null };
}

async function createJar(ctx: BotContext, member: ThanhVienRecord, args: string[]): Promise<string> {
  const { name, amount } = splitNameAndAmount(args, member.id as MemberId);
  if (!name.trim()) {
    return `Thiếu tên hũ.\n${SAVINGS_SYNTAX}`;
  }
  try {
    const { jar, created } = await ctx.savings.createJar(member, name, amount);
    if (!created) {
      return `Đã có hũ ${jar.ten}. Xem: /tietkiem`;
    }
    const goal = jar.muc_tieu ? ` · mục tiêu ${formatMoney(jar.muc_tieu)}` : '';
    return `🏺 Đã tạo hũ ${jar.ten}${goal}.\nBỏ tiền: nhắn "bỏ hũ ${jar.ten.toLowerCase()} 5tr".`;
  } catch (error) {
    if (error instanceof DomainError) {
      return error.code === 'FORBIDDEN' ? ignoredText('HU_NGUOI_GUI_KHONG_HOP_LE') : `Không tạo được: ${error.message}`;
    }
    throw error;
  }
}

async function declareSavings(
  ctx: BotContext,
  member: ThanhVienRecord,
  chatId: number,
  args: string[],
  updateId: number | undefined,
): Promise<BotAction[]> {
  const memberId = member.id as MemberId;
  // /tietkiemdau 50tr [tên hũ] — số tiền là 1–2 chữ đầu ("2 tỷ", "50 triệu")
  let amount: number | null = null;
  let nameFrom = 1;
  for (const n of [2, 1]) {
    const a = args.length >= n ? parseMoneyArg(args.slice(0, n).join(' '), memberId) : null;
    if (a && a >= 10_000) {
      amount = a;
      nameFrom = n;
      break;
    }
  }
  if (!amount || updateId === undefined) {
    return [{ type: 'send', chatId, text: `Chưa rõ số tiền.\n${SAVINGS_SYNTAX}` }];
  }
  let res;
  try {
    res = await ctx.savings.declare(member, amount, `tg:${updateId}`, args.slice(nameFrom).join(' ') || null);
  } catch (error) {
    if (error instanceof DomainError && (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND')) {
      return [{ type: 'send', chatId, text: ignoredText(error.message) }];
    }
    throw error;
  }
  const { move, jar, duplicate } = res;
  const actions: BotAction[] = [
    { type: 'send', chatId, text: savingsText(move, jar, false), ...(move.trang_thai === 'HOAN_TAT' ? { keyboard: cancelButton('hk', move.id) } : {}) },
  ];
  const other = duplicate ? null : await memberChatId(ctx.db, otherMember(memberId));
  if (other !== null) {
    actions.push({ type: 'send', chatId: other, text: savingsNoticeText(move, jar) });
  }
  return actions;
}

async function monthText(ctx: BotContext): Promise<string> {
  const { from, to } = vnMonthRange(ctx.now());
  const t = await ctx.balances.getPeriodTotals(from, to);
  return [
    `📅 Tháng ${to.slice(5, 7)}/${to.slice(0, 4)}:`,
    `• Thu: ${formatMoney(t.tongThu)}`,
    `• Chi: ${formatMoney(t.tongChi)}`,
    `• Chênh lệch: ${formatMoney(t.chenhLech)}`,
  ].join('\n');
}

// Mỗi khoản chuyển đang chờ 1 tin kèm nút (người nhận: Đã nhận/Chưa nhận; người chuyển: Huỷ)
async function pendingTransfers(ctx: BotContext, memberId: MemberId, chatId: number): Promise<BotAction[]> {
  const mine = (await ctx.transfers.listPendingTransfers()).filter(
    (t) => t.nguoi_nhan_id === memberId || t.nguoi_chuyen_id === memberId,
  );
  if (mine.length === 0) {
    return [{ type: 'send', chatId, text: 'Không có khoản chuyển nào đang chờ.' }];
  }
  const actions: BotAction[] = [];
  for (const t of mine.slice(0, PENDING_LIMIT)) {
    if (t.nguoi_nhan_id === memberId && t.source_message_id) {
      const request = (await listConfirmationsByMessage(ctx.db, t.source_message_id)).find(
        (c) => c.loai_xac_nhan === CONFIRMATION_TYPE.CHUYEN_TIEN && c.trang_thai === CONFIRMATION_STATUS.CHO_XAC_NHAN,
      );
      actions.push({
        type: 'send',
        chatId,
        text: transferReceiverText(t),
        ...(request ? { keyboard: transferReceiverKeyboard(request.id) } : {}),
      });
    } else {
      actions.push({
        type: 'send',
        chatId,
        text: `📤 Bạn chuyển ${memberName(t.nguoi_nhan_id).toLowerCase()} ${formatMoney(Number(t.so_tien))} (${formatDay(t.ngay_chuyen)}) — chờ xác nhận.`,
        keyboard: cancelButton('ct', t.id, 'Huỷ chuyển'),
      });
    }
  }
  if (mine.length > PENDING_LIMIT) {
    actions.push({ type: 'send', chatId, text: `… còn ${mine.length - PENDING_LIMIT} khoản nữa.` });
  }
  return actions;
}

async function notesText(ctx: BotContext): Promise<string> {
  const notes = await listDebtNotes(ctx.db, NOTE_LIMIT);
  if (notes.length === 0) {
    return 'Chưa có ghi chú nợ nào.';
  }
  const lines = notes.map(
    (n) => `• ${formatDay(toVnDate(new Date(n.thoi_gian_nhan)))} ${memberName(n.nguoi_gui_id ?? '?')}: ${n.noi_dung_goc}`,
  );
  return [`📝 Ghi chú nợ (${notes.length} gần nhất, không tính số dư):`, ...lines].join('\n');
}

function parseMoneyArg(token: string, senderId: MemberId): number | null {
  if (/^0+$/.test(token)) {
    return 0;
  }
  const ctx = createParseContext(token, { senderId });
  const r = extractAmountVnd(ctx);
  return r.isAmbiguous || r.amount === null || ctx.workingAsciiText !== '' ? null : r.amount;
}

const INITIAL_SYNTAX =
  'Cú pháp (đủ 3 khoản, không có thì ghi 0):\n• /sodudau vợ 5tr chồng 10tr quỹ 0\n• hoặc theo thứ tự vợ, chồng, quỹ: /sodudau 5tr 10tr 0';

const INITIAL_LABELS: ReadonlyArray<{ key: 'vo' | 'chong' | 'quy'; name: string; re: RegExp }> = [
  { key: 'vo', name: 'vợ', re: /^(vợ|vo)$/ },
  { key: 'chong', name: 'chồng', re: /^(chồng|chong)$/ },
  { key: 'quy', name: 'quỹ chung', re: /^(quỹ|quy)$/ },
];

// "vợ 5tr chồng 10tr quỹ chung 0" (thứ tự bất kỳ) hoặc 3 số theo thứ tự vợ, chồng, quỹ. Bắt đủ 3 khoản vì chỉ nhập 1 lần.
export function parseInitialArgs(
  args: string[],
  senderId: MemberId,
): { vo: number; chong: number; quy: number } | { error: string } {
  const tokens = args.map((a) => a.normalize('NFC').toLowerCase().replace(/[:=,]+$/, '')).filter((t) => t !== 'chung');
  const labeled = tokens.some((t) => INITIAL_LABELS.some((l) => l.re.test(t)));
  if (!labeled) {
    const amounts = tokens.map((t) => parseMoneyArg(t, senderId));
    if (amounts.length !== 3 || amounts.some((a) => a === null)) {
      return { error: 'Chưa hiểu số tiền.' };
    }
    const [vo, chong, quy] = amounts as [number, number, number];
    return { vo, chong, quy };
  }
  const values: Partial<Record<'vo' | 'chong' | 'quy', number>> = {};
  for (let i = 0; i < tokens.length; i += 2) {
    const label = INITIAL_LABELS.find((l) => l.re.test(tokens[i]!));
    const amount = tokens[i + 1] === undefined ? null : parseMoneyArg(tokens[i + 1]!, senderId);
    if (!label || amount === null) {
      return { error: `Chưa hiểu "${tokens.slice(i, i + 2).join(' ')}".` };
    }
    if (values[label.key] !== undefined) {
      return { error: `Khoản ${label.name} nhập 2 lần.` };
    }
    values[label.key] = amount;
  }
  const missing = INITIAL_LABELS.filter((l) => values[l.key] === undefined).map((l) => l.name);
  if (missing.length > 0) {
    return { error: `Thiếu số của: ${missing.join(', ')}.` };
  }
  return { vo: values.vo!, chong: values.chong!, quy: values.quy! };
}

// Q10: chỉ nhập lần đầu, ngày áp dụng = hôm nay giờ VN, CHUA_XAC_DINH = 0
async function setInitial(ctx: BotContext, memberId: MemberId, args: string[]): Promise<string> {
  const existing = await listActiveInitialBalances(ctx.db);
  if (existing.length > 0) {
    return `Số dư ban đầu đã nhập ngày ${formatDay(existing[0]!.ngay_ap_dung)}; sửa sẽ làm ở phase sau.`;
  }
  const parsed = parseInitialArgs(args, memberId);
  if ('error' in parsed) {
    return `${parsed.error}\n${INITIAL_SYNTAX}`;
  }
  const { vo, chong, quy } = parsed;
  const today = toVnDate(ctx.now());
  const warn = (await hasCompletedTransactionsFrom(ctx.db, today))
    ? '\n⚠️ Đã có giao dịch từ hôm nay — số dư nhập nên là số đầu ngày.'
    : '';
  try {
    await ctx.balances.setInitialBalance({
      ngayApDung: today,
      theoNhom: { VO: vo, CHONG: chong, QUY_CHUNG: quy, CHUA_XAC_DINH: 0 },
      tongNhap: vo + chong + quy,
      nguoiXacNhanId: memberId,
      ghiChu: 'Nhập qua bot',
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return `Không nhập được: ${error.message}`;
    }
    throw error;
  }
  return [
    `✅ Đã nhập số dư ban đầu ngày ${formatDay(today)}:`,
    `• Vợ: ${formatMoney(vo)}`,
    `• Chồng: ${formatMoney(chong)}`,
    `• Quỹ chung: ${formatMoney(quy)}`,
  ].join('\n') + warn;
}
