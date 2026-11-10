import { ASSET_TYPE, MEMBER_ID, MESSAGE_INTENT, SAVINGS_DIRECTION, type MemberId, type SavingsDirection, type SavingsSourceId } from '../config/constants.ts';
import { extractAmountVnd, parseAmountToken } from './amount-parser.ts';
import { extractTransactionDate } from './date-parser.ts';
import { normalizeWhitespace, removeVietnameseDiacritics } from './normalizer.ts';
import { jarWordGate, matchKnownJar, trimJarName, type JarWordGate } from './savings-detector.ts';
import type { ParseContext, ParseOptions, ParsedSavingsResult } from './types.ts';

// Vàng trong hũ (Phase 5c-2). Chạy trước hũ tiền / quỹ chung / chi trả từ hũ.
// Câu vàng = động từ (mua / bán / khai báo / bỏ, cất) + "vàng" + số lượng. Số lượng lưu bằng phân (1 chỉ = 10 phân).

// Câu có dấu phải viết "vàng" (hoặc gõ không dấu "vang"); "vâng", "vắng" không tính
const GOLD_WORD = /(?:^|\s)(?:vàng|vang|nhẫn\s+(?:tròn|trơn)|nhan\s+tron)(?=$|[\s?.!,;:])/u;
const GOLD_NOUN = /\b(?:vang|nhan\s+tron(?:\s+tron)?)\b/i;
// Mô tả loại vàng — bỏ trước khi đọc tiền ("vàng 9999", "2 chỉ 9999", "vàng 24k" không phải số tiền)
const GOLD_DESCRIPTOR = /\b(vang|nhan\s+tron)((?:\s+(?:mieng|nhan|tron|bao\s+tin(?:\s+minh\s+chau)?))+)\b/gi;
const GOLD_PURITY = /\b(?:9999|999|24k|sjc|pnj|doji|btmc)\b/gi;
// Không phải vàng tích trữ → chi thường (V1): trang sức ("nhẫn vàng"; còn "vàng nhẫn" / "nhẫn tròn" là vàng), vàng mã, rượu vang
const NOT_SAVINGS_GOLD =
  /\b(?:nhan\s+vang|day\s+chuyen|bong\s+tai|hoa\s+tai|lac\s+tay|vong\s+tay|kieng|mat\s+day|trang\s+suc|ruou\s+vang|vang\s+(?:ma|tay|trang|y|18k|14k|10k))\b/i;
// Quà cho người: "cho con", "tặng vợ" (không bắt "tăng giá", "cho chắc", "cho hũ")
const GIFT = /\b(?:cho|tang|bieu)\s+(?:con|vo|chong|me|bo|ba|ong|anh|chi|em|chau|ban|co|di|chu|bac|cau|mo|thim)\b/i;

const UNIT_PHAN: Record<string, number> = { chi: 10, phan: 1, luong: 100, cay: 100 };
const QTY_ONE = String.raw`(?:\d+(?:[.,]\d+)?|mot|nua)\s*(?:chi|phan|luong|cay)\b(?:\s+ruoi\b)?`;
// "1 chỉ 5 phân", "1 lượng 2 chỉ" là 1 cụm
const QTY_SOURCE = String.raw`\b${QTY_ONE}(?:\s+(?:va\s+)?${QTY_ONE})*`;
const QTY_PART = /(\d+(?:[.,]\d+)?|mot|nua)\s*(chi|phan|luong|cay)\b(\s+ruoi\b)?/gi;
// Cụm tiền đi với đơn giá; đọc lại bằng parseAmountToken
const AMT = String.raw`(\d+(?:[.,]\d+)*(?:\s*(?:ty|tr|trieu|m|cu|k|nghin|ngan)(?:\d{1,3}\b)?)?(?:\s*(?:d|vnd))?)`;
// Đơn giá chắc chắn: "14tr/chỉ", "mỗi chỉ 14tr"
const PRICE_ALWAYS = [
  new RegExp(String.raw`\b(?:gia\s+)?moi\s+chi\s+(?:gia\s+|la\s+)?${AMT}`, 'i'),
  new RegExp(String.raw`\b(?:gia\s+)?${AMT}\s*(?:\/\s*(?:1\s*|mot\s+)?|moi\s+)chi\b`, 'i'),
];
// "14tr 1 chỉ" / "1 chỉ 14tr" chỉ là đơn giá khi câu còn số lượng khác ("mua 2 chỉ giá 14tr 1 chỉ")
const PRICE_IF_OTHER_QTY = [
  new RegExp(String.raw`\b(?:gia\s+)?${AMT}\s+(?:1|mot)\s+chi\b`, 'i'),
  new RegExp(String.raw`\b(?:gia\s+)?(?:1|mot)\s+chi\s+(?:gia\s+|la\s+)?${AMT}`, 'i'),
];

export interface GoldScan {
  // null = không có số lượng
  phan: number | null;
  // Đơn giá 1 chỉ (đồng)
  donGia: number | null;
  rest: string;
  reason: string | null;
}

function cut(text: string, part: string): string {
  return normalizeWhitespace(text.replace(part, ' '));
}

function qtyMatches(text: string): string[] {
  return text.match(new RegExp(QTY_SOURCE, 'gi')) ?? [];
}

// Cụm số lượng → số phân; lẻ hơn 1 phân → null
export function quantityToPhan(group: string): number | null {
  let total = 0;
  for (const m of group.matchAll(QTY_PART)) {
    const word = m[1]!.toLowerCase();
    let n = word === 'mot' ? 1 : word === 'nua' ? 0.5 : Number(word.replace(',', '.'));
    if (m[3]) n += 0.5;
    total += n * UNIT_PHAN[m[2]!.toLowerCase()]!;
  }
  const r = Math.round(total * 1000) / 1000;
  return Number.isSafeInteger(r) && r > 0 ? r : null;
}

// Bỏ tên hũ đã có chứa chữ "vàng" ("hũ vàng cưới") để câu hũ tiền không bị hiểu là câu vàng
function withoutGoldJarNames(ascii: string, jarNames: readonly string[]): string {
  const names = jarNames.filter((n) => /\bvang\b/.test(n));
  let t = ascii;
  for (const m of names.length ? ascii.matchAll(/\b(?:hu|quy)\s+/gi) : []) {
    const known = matchKnownJar(ascii.slice((m.index ?? 0) + m[0].length), names);
    if (known) t = t.replace(known.name, ' ');
  }
  return t;
}

export function hasGoldWord(normalizedText: string, asciiText: string, jarNames: readonly string[] = []): boolean {
  return GOLD_NOUN.test(withoutGoldJarNames(asciiText, jarNames)) && GOLD_WORD.test(normalizedText);
}

// Câu hỏi về vàng tích trữ ("vàng còn mấy chỉ", "giá vàng", "mua vàng tháng này bao nhiêu");
// không bắt "áo vàng", "vàng mã", "rượu vang"
const GOLD_QUESTION = /\b(?:chi|phan|luong|cay)\s+vang\b|\bvang\b.*\b(?:chi|phan|luong|cay)\b|\bgia\s+vang\b|\b(?:mua|ban)\s+vang\b|^vang\b|\b(?:hu|quy|co)\s+vang\b/i;

export function isGoldQuestion(normalizedText: string, asciiText: string, jarNames: readonly string[] = []): boolean {
  return hasGoldWord(normalizedText, asciiText, jarNames) && !NOT_SAVINGS_GOLD.test(asciiText) && GOLD_QUESTION.test(withoutGoldJarNames(asciiText, jarNames));
}

// Đơn giá 1 chỉ × số phân → tổng tiền
export function amountFromUnitPrice(donGiaChi: number, phan: number): number {
  return Math.round((donGiaChi * phan) / 10);
}

// Câu có động từ + vàng + số lượng (classifier: "mua vàng 1 chỉ hôm qua" là câu ghi, không phải câu hỏi)
export function hasGoldMove(normalizedText: string, asciiText: string): boolean {
  return hasGoldWord(normalizedText, asciiText) && /\b(?:mua|ban|khai\s+bao|bo|cat|gui)\b/i.test(asciiText) && qtyMatches(asciiText).length > 0;
}

// Tách đơn giá + số lượng khỏi câu (ASCII). Bỏ mô tả loại vàng.
export function scanGoldQuantity(ascii: string): GoldScan {
  let rest = normalizeWhitespace(ascii.replace(GOLD_DESCRIPTOR, '$1').replace(GOLD_PURITY, ' '));
  let donGia: number | null = null;
  let reason: string | null = null;
  const takePrice = (re: RegExp): boolean => {
    const m = rest.match(re);
    const v = m ? parseAmountToken(m[1]!) : null;
    if (!m || v === null) return false;
    if (donGia !== null) reason = 'VANG_SO_TIEN_MO_HO';
    donGia = v;
    rest = cut(rest, m[0]);
    return true;
  };
  PRICE_ALWAYS.forEach(takePrice);
  if (qtyMatches(rest).length >= 2) {
    PRICE_IF_OTHER_QTY.some(takePrice);
  }
  const groups = qtyMatches(rest);
  rest = normalizeWhitespace(rest.replace(new RegExp(QTY_SOURCE, 'gi'), ' '));
  if (groups.length > 1) {
    return { phan: null, donGia, rest, reason: 'VANG_SO_LUONG_MO_HO' };
  }
  const phan = groups.length ? quantityToPhan(groups[0]!) : null;
  if (groups.length && phan === null) reason = 'VANG_LE_QUA_NHO';
  return { phan, donGia, rest, reason };
}

interface GoldDetection {
  chieu: SavingsDirection;
  nguon: SavingsSourceId | null;
  tenHu: string | null;
  reason: string | null;
}

const FUND_INTO = /\b(?:bo|vao|cho|nop|dua|chuyen|ve)\s+(?:tien\s+)?(?:vao\s+)?quy\s+chung\b/i;
const FUND_FROM = /\b(?:(?:lay|rut|dung|trich|bang)\s+)?(?:tien\s+)?(?:tu\s+)?(?:cua\s+)?quy\s+chung\b/i;
const JAR_PHRASE = /\b((?:(?:bo|cat|de|gui|cho|vao|tu|trong|o|lay|rut|dung|trich)\s+)*)(hu|quy(?!\s+chung\b))\b/i;
const VERB = /\b(mua|ban|khai\s+bao(?:\s+them)?)\b/gi;
const PUT_VERB = /\b(?:bo|cat|gui|de)\b/i;
const TAKE_VERB = /\b(?:lay|rut|dung|trich)\b/i;
const FILLER = /\b(?:da|roi|nhe|nha|luon|them|gia|la|tien|duoc|het|bang|o|tai|tiem|vao|ra|nay|voi|cua|tu|di|ve|cho)\b/gi;

// Câu đã bỏ số lượng / đơn giá / ngày / tiền → hướng + nguồn + hũ. null = không phải câu vàng.
function detectGold(
  text: string,
  normalizedText: string,
  senderId: MemberId,
  jarNames: readonly string[],
  allowWord: JarWordGate,
  hasQuantity: boolean,
): GoldDetection | null {
  let t = text;
  let reason: string | null = null;
  const subject = t.match(/^(vo|chong)\b\s*/i);
  if (subject) {
    if ((subject[1]!.toLowerCase() === 'vo' ? MEMBER_ID.VO : MEMBER_ID.CHONG) !== senderId) reason = 'CHU_NGU_KHAC_NGUOI_GUI';
    t = t.slice(subject[0].length);
  }
  const owner = t.match(/\btien\s+(?:cua\s+)?(vo|chong)\b/i);
  if (owner) {
    if ((owner[1]!.toLowerCase() === 'vo' ? MEMBER_ID.VO : MEMBER_ID.CHONG) !== senderId) reason ??= 'CHU_NGU_KHAC_NGUOI_GUI';
    t = cut(t, owner[0]);
  }
  let fund: 'INTO' | 'FROM' | null = null;
  const into = t.match(FUND_INTO);
  const from = into ? null : t.match(FUND_FROM);
  if (into || from) {
    fund = into ? 'INTO' : 'FROM';
    t = cut(t, (into ?? from)![0]);
  }
  // Hũ trước danh từ: tên hũ có thể chứa "vàng" ("bỏ hũ vàng cưới 2 chỉ vàng")
  let tenHu: string | null = null;
  let jarVerb = '';
  const jm = t.match(JAR_PHRASE);
  if (jm && allowWord(jm[2]!)) {
    const before = t.slice(0, jm.index);
    const after = t.slice((jm.index ?? 0) + jm[0].length);
    const known = matchKnownJar(after, jarNames);
    if (known) {
      tenHu = known.name;
      t = normalizeWhitespace(`${before} ${known.leftover}`);
    } else if (jm[2]!.toLowerCase() === 'quy') {
      return null; // "quỹ lớp" — không phải hũ đã có
    } else {
      // Tên chưa có: phần sau "hũ" trừ danh từ vàng ("bỏ hũ 1 chỉ vàng" → hũ mặc định)
      const nounAfter = after.match(GOLD_NOUN);
      tenHu = trimJarName(nounAfter ? after.replace(nounAfter[0], ' ') : after) || null;
      t = normalizeWhitespace(`${before} ${nounAfter ? nounAfter[0] : ''}`);
    }
    jarVerb = jm[1] ?? '';
  }
  const noun = t.match(GOLD_NOUN);
  if (!noun) return null;
  t = cut(t, noun[0]);

  const verbs = new Set([...t.matchAll(VERB)].map((m) => m[1]!.toLowerCase().split(/\s+/)[0]!));
  if (verbs.size > 1) return null; // "bạn mua vàng": ban + mua
  let chieu: SavingsDirection;
  const verb = [...verbs][0];
  if (verb === 'ban' && normalizedText !== removeVietnameseDiacritics(normalizedText) && !/(?:^|\s)bán(?=$|\s)/u.test(normalizedText)) {
    return null; // "bạn"
  }
  if (verb) {
    chieu = verb === 'mua' ? SAVINGS_DIRECTION.NOP : verb === 'ban' ? SAVINGS_DIRECTION.RUT : SAVINGS_DIRECTION.KHAI_BAO;
    t = normalizeWhitespace(t.replace(VERB, ' '));
  } else if (PUT_VERB.test(jarVerb) || PUT_VERB.test(t)) {
    // "bỏ hũ 1 chỉ vàng", "cất 2 chỉ vàng vào hũ": vàng có sẵn đưa vào hũ, không trừ ai
    chieu = SAVINGS_DIRECTION.KHAI_BAO;
    t = normalizeWhitespace(t.replace(PUT_VERB, ' '));
  } else if (TAKE_VERB.test(jarVerb)) {
    chieu = SAVINGS_DIRECTION.RUT;
    reason ??= 'VANG_TU_HU';
  } else {
    return null;
  }
  // "rút hũ mua vàng" = đổi tiền hũ sang vàng (V3: chưa hỗ trợ)
  if (TAKE_VERB.test(jarVerb) || (chieu === SAVINGS_DIRECTION.NOP && TAKE_VERB.test(t) && /\b(?:hu|quy)\b/i.test(text))) {
    reason ??= 'VANG_TU_HU';
  }
  let nguon: SavingsSourceId | null = null;
  if (fund) {
    const ok = (chieu === SAVINGS_DIRECTION.NOP && fund === 'FROM') || (chieu === SAVINGS_DIRECTION.RUT && fund === 'INTO');
    if (ok) nguon = 'QUY_CHUNG';
    else reason ??= 'VANG_NGUON_KHONG_RO';
  }
  const leftover = normalizeWhitespace(t.replace(FILLER, ' '));
  if (/\b\d+\b/.test(leftover)) {
    reason ??= 'VANG_SO_TIEN_MO_HO'; // "mua vàng 1 chỉ 14" — số trần
  } else if (!hasQuantity && leftover !== '') {
    return null; // không số lượng: phải sạch ("mua vàng mã 50k" → chi thường)
  }
  return { chieu, nguon, tenHu, reason };
}

// Câu vàng → kết quả hũ (VANG). Không phải câu vàng nhưng có "vàng" + số lượng (trang sức, quà, có tiền tố loại)
// → bỏ cụm số lượng khỏi ctx để "1 lượng" không thành "lương", "2 chỉ" không thành "chi"; trả null.
export function parseGold(ctx: ParseContext, options: ParseOptions, allowRecord: boolean): ParsedSavingsResult | null {
  const jarNames = options.jarNames ?? [];
  if (!hasGoldWord(ctx.normalizedText, ctx.workingAsciiText, jarNames)) {
    return null;
  }
  const scan = scanGoldQuantity(ctx.workingAsciiText);
  const giftOrJewelry = NOT_SAVINGS_GOLD.test(ctx.workingAsciiText) || GIFT.test(ctx.workingAsciiText);
  if (allowRecord && !giftOrJewelry) {
    const g: ParseContext = { ...ctx, workingAsciiText: scan.rest };
    const ngay = extractTransactionDate(g);
    const amount = extractAmountVnd(g);
    const d = detectGold(g.workingAsciiText, ctx.normalizedText, ctx.senderId, jarNames, jarWordGate(ctx.normalizedText), scan.phan !== null);
    if (d) {
      let soTien = amount.isAmbiguous ? null : amount.amount;
      let moHo = amount.isAmbiguous;
      let reason = scan.reason ?? d.reason;
      if (scan.donGia !== null) {
        if (soTien !== null || moHo) {
          moHo = true;
          soTien = null;
        } else if (scan.phan !== null) {
          soTien = amountFromUnitPrice(scan.donGia, scan.phan);
        }
      }
      if (moHo) reason ??= 'VANG_SO_TIEN_MO_HO';
      if (scan.phan === null) reason ??= 'VANG_THIEU_SO_LUONG';
      const declare = d.chieu === SAVINGS_DIRECTION.KHAI_BAO;
      return {
        intent: MESSAGE_INTENT.SAVINGS_MOVE,
        chieu: d.chieu,
        loai_tai_san: ASSET_TYPE.VANG,
        so_luong_phan: scan.phan,
        thanh_vien_id: ctx.senderId,
        nguon_id: declare ? null : (d.nguon ?? ctx.senderId),
        ten_hu: d.tenHu,
        so_tien: soTien,
        so_tien_mo_ho: moHo,
        ngay,
        ly_do_chua_ho_tro: reason,
        mo_ta: ctx.rawText,
      };
    }
  }
  // Cả asciiText: bộ khớp danh mục đọc lại câu gốc khi phần còn lại không khớp
  const strip = (t: string): string => normalizeWhitespace(t.replace(new RegExp(QTY_SOURCE, 'gi'), ' '));
  ctx.workingAsciiText = strip(ctx.workingAsciiText);
  ctx.asciiText = strip(ctx.asciiText);
  return null;
}
