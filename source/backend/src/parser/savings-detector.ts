import {
  MEMBER_ID,
  SAVINGS_DIRECTION,
  type MemberId,
  type SavingsDirection,
  type SavingsSourceId,
} from '../config/constants.ts';
import { findCategoryByKeyword } from './category-matcher.ts';
import { normalizeWhitespace } from './normalizer.ts';

// Hũ tiết kiệm (Phase 5c-1, chỉ tiền). Chạy trên câu đã bỏ ngày + số tiền, trước nộp/rút quỹ chung.
// Danh sách cho phép chặt như fund-detector: bỏ cụm hũ, nguồn, chủ ngữ của chính người gửi, từ nối → phải rỗng.

export interface SavingsDetection {
  chieu: SavingsDirection;
  // null = người gửi (gán ở index.ts); QUY_CHUNG khi câu nói "quỹ chung"
  nguon: SavingsSourceId | null;
  // Chữ sau "hũ / quỹ <tên>" (ASCII), service khớp tiền tố dài nhất với tên hũ; null = hũ mặc định
  tenHu: string | null;
  unsupportedReason: string | null;
}

// Từ chỉ hũ: "hũ", hoặc "quỹ" không phải "quỹ chung" (người dùng gọi "quỹ y tế", "quỹ mua nhà")
const JAR = String.raw`(?:(?<jar>hu|quy(?!\s+chung\b))|so\s+tiet\s+kiem|tiet\s+kiem)`;
const DECLARE_REGEX = new RegExp(String.raw`\bkhai\s+bao\s+(?:them\s+)?(?:tien\s+)?(?:trong\s+|vao\s+)?${JAR}\b`, 'i');
const WITHDRAW_REGEX = new RegExp(
  // "tất toán" phải kèm "(sổ) tiết kiệm" — "tất toán 5tr" (khoản vay, thẻ) không phải hũ
  String.raw`\b(?:(?:rut|lay|dung|trich)\s+(?:tien\s+)?(?:ra\s+)?(?:tu\s+|o\s+|trong\s+)?${JAR}(?:\s+ra)?|tat\s+toan\s+(?:so\s+)?tiet\s+kiem)\b`,
  'i',
);
const DEPOSIT_REGEX = new RegExp(
  String.raw`\b(?:(?:bo|gop|nop|cho|dua|chuyen|cat|de)\s+(?:tien\s+)?(?:vao\s+)?${JAR}|gui\s+(?:tien\s+)?tiet\s+kiem|mo\s+so\s+tiet\s+kiem)\b`,
  'i',
);
// Bỏ vào: nguồn quỹ chung ("lấy / rút / từ quỹ chung bỏ hũ"). Lấy ra: đích quỹ chung ("rút hũ bỏ vào quỹ chung").
// Nói ngược chiều ("bỏ hũ 2tr vào quỹ chung") → chưa rõ nguồn, không ghi.
const FUND_FROM_REGEX = /\b(?:(?:lay|rut|tu|dung|trich)\s+)?(?:tien\s+)?(?:tu\s+)?quy\s+chung\b/i;
const FUND_TO_REGEX = /\b(?:(?:bo|cho|dua|nop|chuyen)\s+)?(?:tien\s+)?(?:vao\s+)?quy\s+chung\b/i;
const FUND_INTO_WORDING = /\b(?:vao|bo|cho|dua|nop)\s+(?:tien\s+)?(?:vao\s+)?quy\s+chung\b/i;
const FUND_OUT_WORDING = /\b(?:lay|rut|tu|trich)\s+(?:tien\s+)?(?:tu\s+)?quy\s+chung\b/i;
const SUBJECT_REGEX = /^(vo|chong)\b\s*/i;
const FILLER_REGEX = /\b(?:da|vao|ra|tien|nhe|nha|roi|di|luon|them|nay|ngan\s+hang|o)\b/gi;
// Phần dư sau tên hũ được phép (không phải nội dung khác)
const LEFTOVER_FILLER = /\b(?:da|vao|ra|tien|nhe|roi|di|luon|them|o|thang\s+nay|tuan\s+nay|nam\s+nay)\b/gi;

// Tên hũ đã có (ASCII, chữ thường) khớp ở đầu text, dài nhất trước → [tên, phần dư]; không khớp → null
export function matchKnownJar(text: string, jarNames: readonly string[]): { name: string; leftover: string } | null {
  const t = normalizeWhitespace(text);
  const name = [...jarNames].sort((a, b) => b.length - a.length).find((n) => t === n || t.startsWith(`${n} `));
  return name === undefined ? null : { name, leftover: normalizeWhitespace(t.slice(name.length)) };
}

function isFillerOnly(text: string): boolean {
  return normalizeWhitespace(text.replace(LEFTOVER_FILLER, ' ')) === '';
}

// Từ nối ở 2 đầu tên hũ ("hũ mua nhà thêm" → "mua nha"). Không có "nha"/"tien" (là chữ trong tên: "mua nhà", "tiền học").
const NAME_EDGE = /^(?:(?:da|vao|ra|nhe|roi|di|luon|them|o)\s+)+|(?:\s+(?:da|vao|ra|nhe|roi|di|luon|them|o|thang\s+nay|tuan\s+nay))+$/gi;

export function trimJarName(text: string): string {
  return normalizeWhitespace(normalizeWhitespace(text).replace(NAME_EDGE, ' '));
}

// Chữ "hu"/"quy" sau khi bỏ dấu có thể là hư, hủ (tiếu), tủ hư, quý (3)… Câu có dấu → chỉ nhận khi viết đúng "hũ"/"quỹ";
// câu gõ không dấu → không phân biệt được, chấp nhận.
const HU_ACCENTED = /(?:^|\s)hũ(?=$|[\s?.!,])/u;
const QUY_ACCENTED = /(?:^|\s)quỹ(?=$|[\s?.!,])/u;
export type JarWordGate = (word: string) => boolean;

export function jarWordGate(normalizedText: string): JarWordGate {
  // eslint-disable-next-line no-control-regex
  if (!/[^\u0000-\u007f]/.test(normalizedText)) {
    return () => true;
  }
  const hu = HU_ACCENTED.test(normalizedText);
  const quy = QUY_ACCENTED.test(normalizedText);
  return (word) => (word.toLowerCase() === 'hu' ? hu : quy);
}

function cut(text: string, part: string): string {
  return normalizeWhitespace(text.replace(part, ' '));
}

export function detectSavings(
  workingAsciiText: string,
  senderId: MemberId,
  jarNames: readonly string[] = [],
  allowWord: JarWordGate = () => true,
): SavingsDetection | null {
  let chieu: SavingsDirection;
  let match = workingAsciiText.match(DECLARE_REGEX);
  if (match) {
    chieu = SAVINGS_DIRECTION.KHAI_BAO;
  } else if ((match = workingAsciiText.match(WITHDRAW_REGEX))) {
    chieu = SAVINGS_DIRECTION.RUT;
  } else if ((match = workingAsciiText.match(DEPOSIT_REGEX))) {
    chieu = SAVINGS_DIRECTION.NOP;
  } else {
    return null;
  }
  const at = match.index ?? 0;
  // Trước cụm động từ: chỉ được chủ ngữ / nguồn quỹ chung / từ nối. Sau: tên hũ (+ nguồn / đích quỹ chung)
  let head = normalizeWhitespace(workingAsciiText.slice(0, at));
  let tail = normalizeWhitespace(workingAsciiText.slice(at + match[0].length));
  let nguon: SavingsSourceId | null = null;
  let unsupportedReason: string | null = null;
  const deposit = chieu !== SAVINGS_DIRECTION.RUT;
  const fundRegex = deposit ? FUND_FROM_REGEX : FUND_TO_REGEX;
  const fund = head.match(fundRegex) ?? tail.match(fundRegex);
  if (fund) {
    nguon = 'QUY_CHUNG';
    if ((deposit ? FUND_INTO_WORDING : FUND_OUT_WORDING).test(`${head} ${tail}`)) {
      unsupportedReason = 'HU_NGUON_KHONG_RO';
    }
    head = cut(head, fund[0]);
    tail = cut(tail, fund[0]);
  }
  const subject = head.match(SUBJECT_REGEX);
  if (subject) {
    const subjectId = subject[1]!.toLowerCase() === 'vo' ? MEMBER_ID.VO : MEMBER_ID.CHONG;
    if (subjectId !== senderId) {
      unsupportedReason = 'CHU_NGU_KHAC_NGUOI_GUI';
    }
    head = head.slice(subject[0].length);
  }
  if (normalizeWhitespace(head.replace(FILLER_REGEX, ' ')) !== '') {
    return null;
  }
  const jarWord = match.groups?.jar?.toLowerCase();
  let tenHu: string | null = null;
  if (jarWord && !allowWord(jarWord)) {
    return null;
  }
  if (jarWord) {
    const known = matchKnownJar(tail, jarNames);
    if (known) {
      // Còn chữ khác sau tên hũ ("rút hũ y tế 2tr khám bệnh") → không phải câu hũ thuần (luồng chi trả từ hũ)
      if (!isFillerOnly(known.leftover)) {
        return null;
      }
      tenHu = known.name;
    } else if (jarWord === 'quy') {
      // "quỹ lớp", "quỹ họ", "quý 3": không phải hũ đã có → luồng thường
      return null;
    } else if (chieu === SAVINGS_DIRECTION.RUT && findCategoryByKeyword(tail)) {
      // "rút hũ 2tr mua thuốc" → chi trả từ hũ mặc định (luồng ghi chi). "bỏ hũ du lịch" vẫn là bỏ hũ.
      return null;
    } else {
      // "hũ" không tên → hũ mặc định; "hũ <tên chưa có>" → service báo chưa có hũ
      tenHu = trimJarName(tail) || null;
    }
  } else if (normalizeWhitespace(tail.replace(FILLER_REGEX, ' ')) !== '') {
    return null;
  }
  return { chieu, nguon: chieu === SAVINGS_DIRECTION.KHAI_BAO ? null : nguon, tenHu, unsupportedReason };
}

// Câu ghi chi thường trả từ hũ: "khám bệnh 2tr lấy từ quỹ y tế" → tên hũ + câu đã bỏ đúng cụm hũ (feature B).
// "hũ" không tên ở cuối câu → hũ mặc định (''); "quỹ" phải theo sau là tên hũ đã có.
const JAR_SOURCE_REGEX = /\b(?:lay|tu|dung|trich|rut)\s+(?:tien\s+)?(?:tu\s+|trong\s+|o\s+)?(hu|quy(?!\s+chung\b))\b/gi;

export function extractJarSource(
  workingAsciiText: string,
  jarNames: readonly string[] = [],
  allowWord: JarWordGate = () => true,
): { tenHu: string; rest: string } | null {
  for (const m of workingAsciiText.matchAll(JAR_SOURCE_REGEX)) {
    if (!allowWord(m[1]!)) {
      continue;
    }
    const start = m.index ?? 0;
    const after = workingAsciiText.slice(start + m[0].length);
    const known = matchKnownJar(after, jarNames);
    const before = workingAsciiText.slice(0, start);
    if (known) {
      return { tenHu: known.name, rest: normalizeWhitespace(`${before} ${known.leftover}`) };
    }
    // "hũ" rõ ý: không tên / sau đó là nội dung chi ("lấy từ hũ ra mua thuốc") → hũ mặc định;
    // tên chưa có → service báo chưa có hũ (không ghi thành chi thường)
    if (m[1]!.toLowerCase() === 'hu') {
      // Phần trước đã nói chi gì ("mua thuốc … lấy từ hũ du lịch") → phần sau là tên hũ
      const purchaseAfter = !findCategoryByKeyword(before) && findCategoryByKeyword(after);
      if (normalizeWhitespace(after) === '' || purchaseAfter) {
        return { tenHu: '', rest: normalizeWhitespace(`${before} ${after}`) };
      }
      return { tenHu: trimJarName(after), rest: normalizeWhitespace(before) };
    }
  }
  return null;
}

// Câu có động từ hũ (dùng ở classifier: câu không tiền "bỏ hũ tiết kiệm" không thành câu hỏi)
export function hasSavingsVerb(asciiText: string): boolean {
  return DECLARE_REGEX.test(asciiText) || WITHDRAW_REGEX.test(asciiText) || DEPOSIT_REGEX.test(asciiText);
}
