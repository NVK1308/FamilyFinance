import type { MemberId, MoneyHolderId } from '../config/constants.ts';
import { extractAmountVnd } from './amount-parser.ts';
import { hasDebtWord } from './intent-classifier.ts';
import { createParseContext, normalizeWhitespace, removeVietnameseDiacritics } from './normalizer.ts';

// Phase 8b: câu nợ có cấu trúc → ghi nợ thật. Chỉ trả kết quả khi CHẮC (có từ vay / nợ, hoặc tên đối tác khớp
// khoản đang mở); còn lại null → luồng cũ (ghi chú nợ / khoản chi như trước).

export type DebtKind = 'BORROW' | 'LEND' | 'REPAY' | 'COLLECT' | 'INTEREST_PAY' | 'INTEREST_COLLECT';

export interface DebtIntent {
  kind: DebtKind;
  // Tên đối tác như gõ ("anh Nam"); key: bỏ dấu, thường, bỏ xưng hô ("nam") — để khớp khoản
  partner: string;
  partnerKey: string;
  amount: number;
  // Nói rõ người ("vợ vay…", "…vào quỹ", "tôi vay…"); null = mặc định quỹ chung
  holder: MoneyHolderId | null;
  // 0 hôm nay, 1 hôm qua, 2 hôm kia
  daysAgo: number;
}

const HONORIFIC = /^(?:anh|chi|em|co|chu|bac|ong|ba|di|cau|mo|thim|a|c|e)\s+/;
const ONLY_HONORIFIC = /^(?:anh|chi|em|co|chu|bac|ong|ba|di|cau|mo|thim|a|c|e)$/;
// Đối tác không được là người trong nhà / đại từ
const NOT_PARTNER = new Set(['vo', 'chong', 'quy', 'quy chung', 'toi', 'minh', 'tao', 'em', 'anh', 'chi', 'nha', 'gia dinh', 'no', 'lai', 'tien', '']);
const FILLER_TAIL = /(?:\s+(?:nua|roi|nhe|nha|a|nhe|tien|no|lai|thang nay|hom nay))+$/;
const HOLDER_WORD: Record<string, MoneyHolderId> = { vo: 'VO', chong: 'CHONG', quy: 'QUY_CHUNG', 'quy chung': 'QUY_CHUNG' };
const DAYS: Record<string, number> = { 'hom nay': 0, 'hom qua': 1, 'hom kia': 2 };

// Bỏ xưng hô + dấu: "Anh Nam" → "nam"
export function partnerKeyOf(partner: string): string {
  const ascii = normalizeWhitespace(removeVietnameseDiacritics(partner.normalize('NFC').toLowerCase()));
  return ascii.replace(HONORIFIC, '').trim() || ascii;
}

// Key đối tác của khoản đang mở theo chiều: borrow = mình đang nợ (DI_VAY), lend = mình cho vay (CHO_VAY)
export interface OpenPartners {
  borrow: readonly string[];
  lend: readonly string[];
}

// Trả gốc / trả lãi chỉ nhận khi đối tác có khoản ĐI VAY đang mở; thu gốc / thu lãi khi có khoản CHO VAY đang mở
// (không khớp → luồng cũ: khoản chi / thu / quỹ / ghi chú như trước — không nuốt tin của luồng khác)
export function detectDebt(text: string, senderId: MemberId, open: OpenPartners = { borrow: [], lend: [] }): DebtIntent | null {
  const original = normalizeWhitespace(text.normalize('NFC').toLowerCase());
  const fullAscii = removeVietnameseDiacritics(original);
  const ctx = createParseContext(text, { senderId });
  const money = extractAmountVnd(ctx);
  if (money.isAmbiguous || money.amount === null || money.amount <= 0) {
    return null;
  }
  let rest = normalizeWhitespace(ctx.workingAsciiText.toLowerCase().replace(/[.,!?;:]+/g, ' '));
  let daysAgo = 0;
  // Ngày ở đầu hoặc cuối câu ("hôm qua vay…", "vay … hôm qua")
  const day = rest.match(/^(hom nay|hom qua|hom kia)\s+/) ?? rest.match(/\s+(hom nay|hom qua|hom kia)$/);
  if (day) {
    daysAgo = DAYS[day[1]!]!;
    rest = (rest.slice(0, day.index) + rest.slice(day.index! + day[0].length)).trim();
  }
  // Người giữ tiền: "… vào / cho / từ / của vợ | chồng | quỹ (chung)"
  let holder: MoneyHolderId | null = null;
  const holderPhrase = rest.match(/\s+(?:vao|tu|cua|bang|lay)\s+(?:tien\s+)?(quy chung|quy|vo|chong)$/);
  if (holderPhrase) {
    holder = HOLDER_WORD[holderPhrase[1]!]!;
    rest = rest.slice(0, holderPhrase.index);
  }
  // Chủ ngữ: "vợ vay…", "tôi / mình / em / anh vay…"
  const subject = rest.match(/^(vo|chong|toi|minh|tao|em|anh)\s+(?=(?:di\s+)?(?:vay|muon|cho|tra|thu)\b)/);
  if (subject) {
    holder ??= HOLDER_WORD[subject[1]!] ?? senderId;
    rest = rest.slice(subject[0].length);
  }
  const debtWord = hasDebtWord(original, fullAscii);
  const interest = /(?:^|\s)lãi(?=$|\s)/u.test(original);
  // Gõ không dấu "tra lai": không biết là "trả lãi" hay "trả lại" → không đoán (luồng cũ)
  if (original === fullAscii && /\btra\s+lai\b/.test(rest)) {
    return null;
  }
  const match = (kind: DebtKind, re: RegExp): { kind: DebtKind; partner: string } | null => {
    const m = rest.match(re);
    return m ? { kind, partner: m[1]!.replace(FILLER_TAIL, '').replace(/^(?:cho|cua)\s+/, '').trim() } : null;
  };
  const found = interest
    ? (match('INTEREST_PAY', /^tra\s+(?:tien\s+)?lai\s+(?:vay\s+)?(?:cho\s+)?(.+)$/) ??
      match('INTEREST_COLLECT', /^(.+?)\s+tra\s+(?:tien\s+)?lai(?:\s+vay)?$/) ??
      match('INTEREST_COLLECT', /^thu\s+(?:tien\s+)?lai\s+(?:cua\s+)?(.+)$/))
    : (match('LEND', /^cho\s+vay\s+(.+)$/) ??
      match('LEND', /^cho\s+(.+?)\s+(?:vay|muon)$/) ??
      match('COLLECT', /^thu\s+(?:hoi\s+)?no\s+(?:cua\s+)?(.+)$/) ??
      match('BORROW', /^(?:di\s+)?(?:vay|muon)\s+(?:tien\s+)?(?:cua\s+)?(.+)$/) ??
      match('REPAY', /^tra\s+(?:no\s+)?(?:lai\s+)?(?:cho\s+)?(.+)$/) ??
      match('COLLECT', /^(.+?)\s+tra(?:\s+(?:no|lai))*$/));
  // Tên đối tác: 1–4 chữ, không có số ("anh Nam 2 hay" → câu số tiền mơ hồ, bỏ)
  if (!found || found.partner.split(' ').length > 4 || /\d/.test(found.partner)) {
    return null;
  }
  // Vay / cho vay / thu nợ: bắt buộc có từ nợ thật (so có dấu: "vậy", "muốn" không phải vay / mượn)
  // Gõ không dấu "cho chi Lan vay 3tr": cấu trúc "cho <người> vay" đủ rõ
  const asciiLend = found.kind === 'LEND' && original === fullAscii;
  if ((found.kind === 'BORROW' || found.kind === 'LEND' || (found.kind === 'COLLECT' && rest.startsWith('thu '))) && !debtWord && !asciiLend) {
    return null;
  }
  const partnerAscii = found.partner;
  const key = partnerAscii.replace(HONORIFIC, '').trim();
  // Chỉ có xưng hô ("a", "anh") / "nợ của anh" (danh mục Nợ của anh) → không phải đối tác
  if (NOT_PARTNER.has(partnerAscii) || NOT_PARTNER.has(key) || ONLY_HONORIFIC.test(partnerAscii) || /\bno\s+cua\b/.test(rest)) {
    return null;
  }
  // Quỹ / hũ / thẻ không phải người cho vay ("rút quỹ chung trả nợ 5tr" là rút quỹ)
  if (/\b(?:quy|hu|the)\b/.test(partnerAscii)) {
    return null;
  }
  // Trả / thu / lãi: đối tác phải có khoản mở đúng chiều ("trả anh thợ 500k" vẫn là khoản chi)
  const payBack = found.kind === 'REPAY' || found.kind === 'INTEREST_PAY';
  const collect = found.kind === 'COLLECT' || found.kind === 'INTEREST_COLLECT';
  if ((payBack && !open.borrow.includes(key)) || (collect && !open.lend.includes(key))) {
    return null;
  }
  // Tên như gõ: removeVietnameseDiacritics giữ nguyên độ dài chuỗi NFC → cắt cùng vị trí ở câu gốc
  const at = fullAscii.lastIndexOf(partnerAscii);
  const partner = at >= 0 && fullAscii.length === original.length ? text.normalize('NFC').replace(/\s+/g, ' ').trim().slice(at, at + partnerAscii.length) : partnerAscii;
  return { kind: found.kind, partner: partner.trim() || partnerAscii, partnerKey: key, amount: money.amount, holder, daysAgo };
}

// Lọc nhanh trước khi đọc DB: câu có động từ nợ / trả / thu
export function mayBeDebt(text: string): boolean {
  return /\b(?:vay|muon|no|tra|thu|lai)\b/.test(removeVietnameseDiacritics(text.toLowerCase()));
}
