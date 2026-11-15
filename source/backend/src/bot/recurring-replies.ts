import type { Settings } from '../config/settings.ts';
import type { DueRow, KhoanDinhKyRecord } from '../db/repositories/recurring-repository.ts';
import type { DueLine } from '../services/recurring-service.ts';
import type { InlineKeyboard } from '../telegram/types.ts';
import { encodeCallback } from './callback-data.ts';
import { formatDay, formatMoney, holderName, memberName } from './replies.ts';

// Phase 7: tin nhắc khoản định kỳ, danh sách /dinhky, tin nhắc trả lời "Số khác"

export const RECURRING_SYNTAX = [
  'Khai báo khoản định kỳ: /dinhky <tên> <số tiền> [vợ | chồng | quỹ]',
  '• /dinhky tiền điện 1tr5 · /dinhky học phí 3tr quỹ · /dinhky lương 15tr',
  'Gõ lại cùng tên = sửa số tiền / người trả. Ngày + giờ nhắc chung: /cauhinh.',
].join('\n');

// Telegram: tối đa ~100 nút / bàn phím
const MAX_BUTTONS = 99;
const BUTTON_NAME_MAX = 20;

export const RECURRING_PROMPT = '🔁 Nhập số tiền thực';
export const RECURRING_CODE = /\nMã: (DKL_[A-Za-z0-9_-]+)\s*$/;

function verb(due: { loai_giao_dich: string }): string {
  return due.loai_giao_dich === 'THU' ? 'nhận' : 'trả';
}

function monthLabel(ky: string): string {
  return `${ky.slice(5)}/${ky.slice(0, 4)}`;
}

function shortName(ten: string): string {
  return ten.length > BUTTON_NAME_MAX ? `${ten.slice(0, BUTTON_NAME_MAX - 1)}…` : ten;
}

// Hàng nút của 1 lần đang chờ: ✅ ghi đúng số · ✏️ số khác · ⏭ tháng này không có
export function dueButtonRow(due: DueRow, index: number | null = null): InlineKeyboard[number] {
  const no = index === null ? '' : `${index}. `;
  return [
    { text: `✅ ${no}${shortName(due.ten)}`, callback_data: encodeCallback({ kind: 'dk', id: due.id, action: 'A' }) },
    { text: index === null ? '✏️ Số khác' : `✏️ ${index}`, callback_data: encodeCallback({ kind: 'dk', id: due.id, action: 'S' }) },
    { text: index === null ? '⏭ Không có' : `⏭ ${index}`, callback_data: encodeCallback({ kind: 'dk', id: due.id, action: 'B' }) },
  ];
}

function whoSuffix(due: DueRow): string {
  return due.nguoi_giu_tien_id === 'QUY_CHUNG' ? ' (quỹ chung)' : '';
}

// 1 dòng theo trạng thái hiện tại của lần
function dueLineText(line: DueLine, index: number): string[] {
  const { due } = line;
  const by = due.nguoi_xu_ly_id ? ` · ${memberName(due.nguoi_xu_ly_id).toLowerCase()}` : '';
  switch (due.trang_thai) {
    case 'CHO': {
      const out = [`${index}. ${due.ten} — ${formatMoney(due.so_tien)}${whoSuffix(due)}`];
      if (line.hint) {
        out.push(`   ⚠️ Tháng này đã ghi ${formatMoney(line.hint.so_tien)} ngày ${formatDay(line.hint.ngay_giao_dich)} — nếu là khoản này, bấm ⏭`);
      }
      return out;
    }
    case 'DA_GHI':
      return [`${index}. ✅ ${due.ten} — đã ${verb(due)} ${formatMoney(line.paidAmount ?? due.so_tien)}${by}`];
    case 'BO_QUA':
      return [`${index}. ⏭ ${due.ten} — tháng này không có${by}`];
    case 'QUA_HAN':
      return [`${index}. ⌛ ${due.ten} — quá hạn, không ghi`];
    case 'DA_DUNG':
      return [`${index}. 🗑 ${due.ten} — đã dừng khoản`];
  }
}

// Tin nhắc chung của 1 người cho 1 kỳ (vẽ lại từ DB mỗi lần bấm)
export function reminderView(lines: readonly DueLine[], ky: string, memberId: string, lanNhac: number): { text: string; keyboard: InlineKeyboard } {
  const who = memberName(memberId).toLowerCase();
  const head = lanNhac === 2 ? `🔁 Nhắc lại — khoản định kỳ tháng ${monthLabel(ky)} còn chờ (${who})` : `🔁 Khoản định kỳ tháng ${monthLabel(ky)} (${who})`;
  const body: string[] = [];
  const keyboard: InlineKeyboard = [];
  const pending = lines.filter((l) => l.due.trang_thai === 'CHO');
  lines.forEach((line, i) => {
    body.push(...dueLineText(line, i + 1));
    if (line.due.trang_thai === 'CHO') {
      keyboard.push(dueButtonRow(line.due, i + 1));
    }
  });
  const footer =
    pending.length > 0
      ? `✅ đã trả / nhận đúng số · ✏️ số khác · ⏭ tháng này không có. Hạn bấm: ${formatDay(pending.reduce((m, l) => (l.due.han_dong < m ? l.due.han_dong : m), pending[0]!.due.han_dong))}.`
      : `Xong khoản định kỳ tháng ${monthLabel(ky)}.`;
  return { text: [head, ...body, '', footer].join('\n'), keyboard };
}

// Tin nhắc cũ (lần 1) khi đã gửi lần 2: bỏ nút, chỉ sang tin mới
export function supersededText(ky: string): string {
  return `🔁 Khoản định kỳ tháng ${monthLabel(ky)} — xem tin nhắc lại bên dưới.`;
}

export function recurringPromptText(due: DueRow): string {
  return `${RECURRING_PROMPT} đã ${verb(due)} cho khoản dưới (trả lời tin này, vd 1tr45):\n${due.ten} — dự kiến ${formatMoney(due.so_tien)} (tháng ${monthLabel(due.ky)})\nMã: ${due.id}`;
}

// Câu trả lời khi lần đã có người xử lý / khoản đã dừng
export function dueDoneText(due: DueRow): string {
  const by = due.nguoi_xu_ly_id ? memberName(due.nguoi_xu_ly_id) : '';
  if (due.trang_thai === 'CHO' && !due.khoan_active) {
    return `Khoản ${due.ten} đã dừng.`;
  }
  switch (due.trang_thai) {
    case 'DA_GHI':
      return `${by ? `${by} đã` : 'Đã'} ghi khoản ${due.ten} tháng ${monthLabel(due.ky)} rồi.`;
    case 'BO_QUA':
      return `${due.ten} tháng ${monthLabel(due.ky)} đã đánh dấu không có${by ? ` (${by.toLowerCase()})` : ''}.`;
    case 'QUA_HAN':
      return `${due.ten} tháng ${monthLabel(due.ky)} đã quá hạn — nhắn khoản như thường nếu cần ghi.`;
    case 'DA_DUNG':
      return `Khoản ${due.ten} đã dừng.`;
    default:
      return 'Khoản này đang chờ.';
  }
}

export function itemLine(item: KhoanDinhKyRecord): string {
  return `${item.ten} — ${formatMoney(item.so_tien)} · ${item.loai_giao_dich === 'THU' ? 'nhận' : 'trả'}: ${holderName(item.nguoi_giu_tien_id).toLowerCase()}`;
}

function dueStatusShort(due: DueRow | undefined): string {
  if (!due) return 'chưa tới ngày nhắc';
  return { CHO: 'đang chờ', DA_GHI: 'đã ghi', BO_QUA: 'không có', QUA_HAN: 'quá hạn', DA_DUNG: 'đã dừng' }[due.trang_thai];
}

// /dinhky: danh sách + trạng thái kỳ này; nút cho lần đang chờ + nút Dừng (giới hạn số nút Telegram)
export function itemListView(
  items: readonly KhoanDinhKyRecord[],
  dues: readonly DueRow[],
  settings: Settings,
  ky: string,
): { text: string; keyboard: InlineKeyboard } {
  const schedule = `Nhắc chung ngày ${settings['dinh_ky.ngay_nhac']} hằng tháng lúc ${settings['dinh_ky.gio_nhac']}:00 (đổi: /cauhinh).`;
  if (items.length === 0 && dues.every((d) => d.trang_thai !== 'CHO')) {
    return { text: ['Chưa có khoản định kỳ nào.', schedule, '', RECURRING_SYNTAX].join('\n'), keyboard: [] };
  }
  const dueOf = new Map(dues.filter((d) => d.ky === ky).map((d) => [d.khoan_dinh_ky_id, d]));
  const lines = items.map((item, i) => `${i + 1}. ${itemLine(item)} · tháng ${monthLabel(ky)}: ${dueStatusShort(dueOf.get(item.id))}`);
  const keyboard: InlineKeyboard = [];
  let used = 0;
  const stopRow: InlineKeyboard[number] = [];
  for (const [i, item] of items.entries()) {
    stopRow.push({ text: `🗑 Dừng ${i + 1}`, callback_data: encodeCallback({ kind: 'dx', id: item.id }) });
  }
  used += stopRow.length;
  const pending = dues.filter((d) => d.trang_thai === 'CHO');
  for (const due of pending) {
    if (used + 3 > MAX_BUTTONS) break;
    keyboard.push(dueButtonRow(due));
    used += 3;
  }
  // Nút Dừng: 4 nút / hàng
  for (let i = 0; i < stopRow.length; i += 4) {
    keyboard.push(stopRow.slice(i, i + 4));
  }
  const pendingText = pending.length > 0 ? ['', `Đang chờ bấm: ${pending.map((d) => `${d.ten} (${monthLabel(d.ky)})`).join(', ')}`] : [];
  return { text: ['🔁 Khoản định kỳ', ...lines, ...pendingText, '', schedule, RECURRING_SYNTAX].join('\n'), keyboard };
}
