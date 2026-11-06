import {
  MEMBER_ID,
  SAVINGS_DIRECTION,
  type MemberId,
  type SavingsDirection,
  type SavingsSourceId,
} from '../config/constants.ts';
import { normalizeWhitespace } from './normalizer.ts';

// Hũ tiết kiệm (Phase 5c-1, chỉ tiền). Chạy trên câu đã bỏ ngày + số tiền, trước nộp/rút quỹ chung.
// Danh sách cho phép chặt như fund-detector: bỏ cụm hũ, nguồn, chủ ngữ của chính người gửi, từ nối → phải rỗng.

export interface SavingsDetection {
  chieu: SavingsDirection;
  // null = người gửi (gán ở index.ts); QUY_CHUNG khi câu nói "quỹ chung"
  nguon: SavingsSourceId | null;
  unsupportedReason: string | null;
}

const JAR = String.raw`(?:hu(?:\s+tiet\s+kiem)?|so\s+tiet\s+kiem|tiet\s+kiem)`;
const DECLARE_REGEX = new RegExp(String.raw`\bkhai\s+bao\s+(?:them\s+)?(?:tien\s+)?(?:trong\s+)?${JAR}\b`, 'i');
const WITHDRAW_REGEX = new RegExp(
  // "tất toán" phải kèm "(sổ) tiết kiệm" — "tất toán 5tr" (khoản vay, thẻ) không phải hũ
  String.raw`\b(?:(?:rut|lay)\s+(?:tien\s+)?(?:ra\s+)?(?:tu\s+|o\s+|trong\s+)?${JAR}(?:\s+ra)?|tat\s+toan\s+(?:so\s+)?tiet\s+kiem)\b`,
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

export function detectSavings(workingAsciiText: string, senderId: MemberId): SavingsDetection | null {
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
  let rest = normalizeWhitespace(workingAsciiText.replace(match[0], ' '));
  let nguon: SavingsSourceId | null = null;
  let unsupportedReason: string | null = null;
  const deposit = chieu !== SAVINGS_DIRECTION.RUT;
  const fund = rest.match(deposit ? FUND_FROM_REGEX : FUND_TO_REGEX);
  if (fund) {
    nguon = 'QUY_CHUNG';
    if ((deposit ? FUND_INTO_WORDING : FUND_OUT_WORDING).test(rest)) {
      unsupportedReason = 'HU_NGUON_KHONG_RO';
    }
    rest = normalizeWhitespace(rest.replace(fund[0], ' '));
  }
  const subject = rest.match(SUBJECT_REGEX);
  if (subject) {
    const subjectId = subject[1]!.toLowerCase() === 'vo' ? MEMBER_ID.VO : MEMBER_ID.CHONG;
    if (subjectId !== senderId) {
      unsupportedReason = 'CHU_NGU_KHAC_NGUOI_GUI';
    }
    rest = rest.slice(subject[0].length);
  }
  rest = normalizeWhitespace(rest.replace(FILLER_REGEX, ' '));
  if (rest !== '') {
    return null;
  }
  return { chieu, nguon: chieu === SAVINGS_DIRECTION.KHAI_BAO ? null : nguon, unsupportedReason };
}

// Câu có động từ hũ (dùng ở classifier: câu không tiền "bỏ hũ tiết kiệm" không thành câu hỏi)
export function hasSavingsVerb(asciiText: string): boolean {
  return DECLARE_REGEX.test(asciiText) || WITHDRAW_REGEX.test(asciiText) || DEPOSIT_REGEX.test(asciiText);
}
