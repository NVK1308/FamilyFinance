import { FUND_DIRECTION, MEMBER_ID, type FundDirection, type MemberId } from '../config/constants.ts';
import { normalizeWhitespace } from './normalizer.ts';

export interface FundDetection {
  chieu: FundDirection;
  // Rút quỹ chung đưa thẳng cho người kia ("rút quỹ chung cho vợ 2tr"); null = tiền về người gửi
  nguoiNhan: MemberId | null;
  // Lý do chưa hỗ trợ (bot báo lại, không ghi): chủ ngữ là người khác, nộp quỹ mà có người nhận
  unsupportedReason: string | null;
}

// RUT kiểm trước: "chuyển từ quỹ chung" là rút, không phải nộp
// "chuyển quỹ chung cho vợ" (có người nhận ngay sau) cũng là rút
const RUT_REGEX =
  /\b(?:(?:rut|lay)\s+(?:tien\s+)?(?:ra\s+)?(?:tu\s+|o\s+)?quy\s+chung(?:\s+ra)?|(?:chuyen|dua)\s+(?:tien\s+)?tu\s+quy\s+chung|(?:chuyen|dua)\s+(?:tien\s+)?quy\s+chung(?=\s+(?:cho\s+)?(?:vo|chong)\b))\b/i;
const NOP_REGEX = /\b(?:bo|gop|nop|chuyen|dua|cho)\s+(?:tien\s+)?(?:vao\s+)?quy\s+chung\b/i;

const SUBJECT_REGEX = /^(vo|chong)\b\s*/i;
const RECIPIENT_REGEX = /\b(?:cho|chuyen|dua|ck)\s+(?:tien\s+)?(?:cho\s+)?(vo|chong)\b/i;
// Từ nối được phép còn lại; còn chữ nào khác (danh mục, vay, nợ, lương...) thì không phải nộp/rút quỹ
const FILLER_REGEX = /\b(?:da|vao|ra|tien|nhe|nha|roi|di|luon|them|nay)\b/gi;

// "chuyển vợ 2tr từ quỹ chung", "đưa vợ 2tr tiền quỹ chung": phần còn lại sau khi classifier bỏ "chuyển vợ" và bước tách
// ngày + tiền phải đúng là "từ / bằng / tiền (của) quỹ chung" + từ nối. Không khớp → false (nhắc, không ghi).
const FROM_FUND = /\b(?:(?:lay|rut|dung|trich)\s+)?(?:(?:tu|bang)(?:\s+tien)?|tien)\s+(?:cua\s+)?quy\s+chung\b/i;

export function isFromFundOnly(restAsciiText: string): boolean {
  const fund = restAsciiText.match(FROM_FUND);
  return fund !== null && normalizeWhitespace(restAsciiText.replace(fund[0], ' ').replace(FILLER_REGEX, ' ')) === '';
}

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
  let nguoiNhan: MemberId | null = null;
  const recipient = rest.match(RECIPIENT_REGEX);
  if (recipient) {
    const id = recipient[1]!.toLowerCase() === 'vo' ? MEMBER_ID.VO : MEMBER_ID.CHONG;
    // Rút cho người kia: tiền quỹ về thẳng người đó. Nộp "cho vợ" chưa rõ ý → không ghi
    if (chieu !== FUND_DIRECTION.RUT) unsupportedReason ??= 'CO_NGUOI_NHAN';
    else if (id !== senderId) nguoiNhan = id;
    rest = rest.replace(recipient[0], ' ');
  }
  rest = normalizeWhitespace(rest.replace(FILLER_REGEX, ' '));
  if (rest !== '') {
    return null;
  }
  return { chieu, nguoiNhan, unsupportedReason };
}
