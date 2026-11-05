import { FUND_DIRECTION, MEMBER_ID, type FundDirection, type MemberId } from '../config/constants.ts';
import { normalizeWhitespace } from './normalizer.ts';

export interface FundDetection {
  chieu: FundDirection;
  // Lý do chưa hỗ trợ (bot báo lại, không ghi): chủ ngữ là người khác, hoặc có người nhận
  unsupportedReason: string | null;
}

// RUT kiểm trước: "chuyển từ quỹ chung" là rút, không phải nộp
const RUT_REGEX =
  /\b(?:(?:rut|lay)\s+(?:tien\s+)?(?:ra\s+)?(?:tu\s+|o\s+)?quy\s+chung(?:\s+ra)?|(?:chuyen|dua)\s+(?:tien\s+)?tu\s+quy\s+chung)\b/i;
const NOP_REGEX = /\b(?:bo|gop|nop|chuyen|dua|cho)\s+(?:tien\s+)?(?:vao\s+)?quy\s+chung\b/i;

const SUBJECT_REGEX = /^(vo|chong)\b\s*/i;
const RECIPIENT_REGEX = /\bcho\s+(?:vo|chong)\b/i;
// Từ nối được phép còn lại; còn chữ nào khác (danh mục, vay, nợ, lương...) thì không phải nộp/rút quỹ
const FILLER_REGEX = /\b(?:da|vao|ra|tien|nhe|nha|roi|di|luon|them|nay)\b/gi;

// Nhận nộp/rút quỹ chung theo danh sách cho phép chặt (review 3 #1): câu đã bỏ ngày + số tiền,
// sau khi bỏ cụm quỹ, chủ ngữ của chính người gửi và từ nối thì phải rỗng.
export function detectFundTransfer(workingAsciiText: string, senderId: MemberId): FundDetection | null {
  let chieu: FundDirection;
  let rest: string;
  const rut = workingAsciiText.match(RUT_REGEX);
  if (rut) {
    chieu = FUND_DIRECTION.RUT;
    rest = workingAsciiText.replace(rut[0], ' ');
  } else {
    const nop = workingAsciiText.match(NOP_REGEX);
    if (!nop) {
      return null;
    }
    chieu = FUND_DIRECTION.NOP;
    rest = workingAsciiText.replace(nop[0], ' ');
  }

  rest = normalizeWhitespace(rest);
  let unsupportedReason: string | null = null;
  const subject = rest.match(SUBJECT_REGEX);
  if (subject) {
    const subjectId = subject[1]!.toLowerCase() === 'vo' ? MEMBER_ID.VO : MEMBER_ID.CHONG;
    if (subjectId !== senderId) {
      unsupportedReason = 'CHU_NGU_KHAC_NGUOI_GUI';
    }
    rest = rest.slice(subject[0].length);
  }
  if (RECIPIENT_REGEX.test(rest)) {
    unsupportedReason ??= 'CO_NGUOI_NHAN';
    rest = rest.replace(RECIPIENT_REGEX, ' ');
  }
  rest = normalizeWhitespace(rest.replace(FILLER_REGEX, ' '));
  if (rest !== '') {
    return null;
  }
  return { chieu, unsupportedReason };
}
