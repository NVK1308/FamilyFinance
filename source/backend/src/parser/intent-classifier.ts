import {
  MEMBER_ID,
  MESSAGE_INTENT,
  TRANSACTION_TYPE,
  type MemberId,
  type MessageIntent,
  type TransactionType,
} from '../config/constants.ts';
import { hasClearAmount } from './amount-parser.ts';
import { normalizeWhitespace, removeVietnameseDiacritics } from './normalizer.ts';
import { hasGoldMove } from './gold-detector.ts';
import { hasSavingsVerb } from './savings-detector.ts';
import type { ParseContext } from './types.ts';

export interface IntentClassification {
  intent: MessageIntent;
  explicitTransactionType: TransactionType | null;
  transferRecipientId: MemberId | null;
  // Chủ ngữ trước động từ chuyển ("chồng chuyển vợ"); null nếu câu không nêu
  transferSubjectId: MemberId | null;
  // QUERY: câu hỏi có kèm số tiền rõ ("lương bao nhiêu 10tr") → trả lời kèm gợi ý cách ghi
  hasAmount?: boolean;
  // UNKNOWN: lý do nhắc người gửi (không ghi, không lưu) — Q6
  reason?: string;
  // Câu có tiền chỉ khớp luật hỏi yếu, đã bỏ "?" / "tổng": chỉ ghi khi nhận ra loại hoặc danh mục
  weakQuestion?: boolean;
}

// Tiền tố có dấu ":" / "-" là ý ghi rõ ràng → xét trước luật câu hỏi
const STRICT_PREFIX_PATTERNS: ReadonlyArray<{
  regex: RegExp;
  type: TransactionType;
}> = [
  { regex: /^thu\s*[:\-]\s*/i, type: TRANSACTION_TYPE.THU },
  { regex: /^chi\s*[:\-]\s*/i, type: TRANSACTION_TYPE.CHI },
  { regex: /^vay\s*[:\-]\s*/i, type: TRANSACTION_TYPE.VAY },
  { regex: /^tra\s+no\s*[:\-]\s*/i, type: TRANSACTION_TYPE.TRA_NO },
  { regex: /^lai\s+vay\s*[:\-]\s*/i, type: TRANSACTION_TYPE.LAI_VAY },
  { regex: /^phi\s*[:\-]\s*/i, type: TRANSACTION_TYPE.PHI },
  { regex: /^dieu\s+chinh\s*[:\-]\s*/i, type: TRANSACTION_TYPE.DIEU_CHINH },
];

// Tiền tố không dấu xét sau luật câu hỏi: "chi tiền học tháng này" là câu hỏi
const LOOSE_PREFIX_PATTERNS: ReadonlyArray<{
  regex: RegExp;
  type: TransactionType;
}> = [
  { regex: /^thu\s+(?=\d|luong|ot|thuong|tien|no\b)/i, type: TRANSACTION_TYPE.THU },
  { regex: /^chi\s+(?=\d|tien|an\b|mua\b|hoc\b|sua\b|chong\b|vo\b|no\b)/i, type: TRANSACTION_TYPE.CHI },
];

const HTML_REPORT_PATTERNS: readonly RegExp[] = [
  /\bxuat\s+bao\s+cao\b/i,
  /\bbao\s+cao\s+html\b/i,
  /\bfile\s+html\b/i,
  /\bgui\s+bao\s+cao\s+chi\s+tiet\b/i,
];

// Cho phép thời gian / chủ ngữ / "đã" đứng trước động từ chuyển: "hôm qua chồng đã chuyển vợ 2tr".
// Nhóm 1 (thời gian + chủ ngữ + đã) giữ lại để bước tách ngày còn đọc được.
const TRANSFER_REGEX =
  /^((?:(?:hom\s+(?:qua|nay|kia)|(?:sang|trua|chieu|toi|dem)\s+(?:nay|qua)|(?:ngay\s+)?\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{4})?)\s+)?(?:(vo|chong)\s+)?(?:da\s+)?)(?:chuyen(?:\s+tien|\s+khoan)?|ck|dua(?:\s+tien)?)\s+(?:cho\s+)?(vo|chong)\b/i;

export function toMemberId(word: string | undefined): MemberId | null {
  if (!word) {
    return null;
  }
  return word.toLowerCase() === 'vo' ? MEMBER_ID.VO : MEMBER_ID.CHONG;
}


// Từ hỏi mạnh: luôn là câu hỏi, kể cả câu có số tiền
const STRONG_QUERY_PATTERNS: readonly RegExp[] = [
  /\bbao\s+nhieu\b/i,
  /\bliet\s+ke\b/i,
  /\bso\s+sanh\b/i,
  /\blich\s+su\b/i,
  /\bthong\s+ke\b/i,
  /\bkhoan\s+chi\s+nao\b/i,
  /\bai\s+da\s+thanh\s+toan\b/i,
  /\bchi\s+nhieu\s+nhat\b/i,
];

// Trợ từ hỏi — so trên chuỗi CÓ dấu ("mấy" ≠ "máy", "chưa" ≠ "chua")
const PARTICLE_END = /(?:^|\s)(?:à|hả|hở|chưa|không|nhỉ|sao|phải không|được không|rồi à|hay)$/u;
const PARTICLE_START = /^(?:sao|tại sao|có phải|ai)\s/u;
const MAY_WORD = /(?:^|\s)mấy(?=$|[\s?.!,])/u;

// Luật hỏi yếu: dấu "?" cuối câu, câu bắt đầu "tổng" / "số dư"
const WEAK_QUESTION_MARK = /\s*\?+$/;
const WEAK_TONG = /^tong\b\s*/i;
const WEAK_SO_DU = /^so\s+du\b/i;

// Từ chỉ kỳ (3.2a, 3.2c)
const PERIOD_WORD =
  /\b(?:hom\s+(?:nay|qua|kia)|(?:tuan|thang|quy|nam)\s+(?:nay|truoc|qua|ngoai)|thang\s+\d{1,2}|quy\s+[1-4]|nam\s+\d{4}|tu\s+dau|dau\s+(?:thang|nam|quy|tuan)|\d{1,2}[\/\-]\d{1,2})\b/i;

// Từ thống kê (3.2a): câu không có tiền mà có các từ này → câu hỏi
const STAT_WORD =
  /\b(?:lon\s+nhat|nhieu\s+nhat|it\s+nhat|tiet\s+kiem|chua\s+xac\s+nhan|bi\s+huy|theo\s+danh\s+muc|theo\s+doi\s+tuong|tung\s+nguoi|chi\s+phi|tong|con\s+lai|so\s+du|dang\s+giu|thu\s+chi|chua\s+(?:ro|xac\s+dinh)\s+nguoi\s+giu)\b/i;

// Cụm kỳ cắt đi trước khi xét "có tiền": năm 2026, tháng 10, quý 3, 1/10 không phải số tiền
const PERIOD_NUMBER_PHRASES: readonly RegExp[] = [
  /\bnam\s+\d{4}\b/gi,
  /\bthang\s+\d{1,2}(?:[\/\-]\d{4})?\b/gi,
  /\bquy\s+[1-4]\b/gi,
  /\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{4})?\b(?!\s*(?:k|nghin|ngan|tr|trieu|d|vnd)\b)/gi,
];

// 3.2a bỏ qua câu chuyển / nộp / rút quỹ / nợ không có từ hỏi ("hôm qua bỏ quỹ chung")
const FUND_VERB = /\b(?:bo|gop|nop|rut|lay|chuyen|dua)\b.*\bquy\s+chung\b/i;

// Từ nợ: so trên chuỗi có dấu ("vậy", "muốn" không phải nợ); câu gõ không dấu chỉ nhận cụm rõ nghĩa
const DEBT_ACCENTED = /(?:^|\s)(?:nợ|vay|mượn)(?=$|[\s?.!,])/u;
const DEBT_ASCII_ONLY =
  /\bno\b|^vay\b|\b(?:di|cho|khoan|tien)\s+vay\b|\b(?:vay|muon)\s+(?:anh|chi|em|ong|ba|co|chu|bac|cua|ai|bao|tien|no)\b/i;

export function hasDebtWord(normalizedText: string, asciiText: string): boolean {
  return normalizedText !== asciiText ? DEBT_ACCENTED.test(normalizedText) : DEBT_ASCII_ONLY.test(asciiText);
}

// Yêu cầu thao tác (huỷ / xoá / sửa / hoàn tác) — bot không làm qua chữ, chỉ hướng dẫn nút bấm.
// So trên chuỗi có dấu ("sửa" ≠ "sữa"); "bị huỷ / đã huỷ" là trạng thái (câu hỏi chuyển tiền), không phải yêu cầu.
// "sửa" chỉ khi là thao tác ("sửa lại", "sửa tin") — "tiền sửa xe" là khoản chi
const ACTION_ACCENTED = /(?:^|\s)(?:huỷ|hủy|xoá|xóa|hoàn tác|sửa (?:lại|tin|khoản|giúp|giùm|hộ))(?=$|[\s?.!,])/u;
const ACTION_ASCII_ONLY = /\b(?:huy|xoa|hoan\s+tac)\b/i;
const ACTION_STATE = /\b(?:bi|da)\s+huy\b/i;
// Câu bắt đầu bằng lệnh huỷ/xoá ("huỷ khoản tiền ăn 50k") → không ghi
const ACTION_START = /^(?:huỷ|hủy|xoá|xóa|hoàn tác)\s/u;

export function isActionRequest(normalizedText: string): boolean {
  const ascii = normalizeWhitespace(removeVietnameseDiacritics(normalizedText)).toLowerCase();
  if (ACTION_STATE.test(ascii)) return false;
  return normalizedText !== ascii ? ACTION_ACCENTED.test(normalizedText) : ACTION_ASCII_ONLY.test(ascii);
}

function hasAmountOutsidePeriod(text: string): boolean {
  let rest = text;
  for (const re of PERIOD_NUMBER_PHRASES) {
    rest = rest.replace(re, ' ');
  }
  return hasClearAmount(rest);
}

function hasQuestionParticle(normalizedText: string): boolean {
  const t = normalizedText.replace(/[\s?.!…]+$/u, '');
  return PARTICLE_END.test(t) || PARTICLE_START.test(t) || MAY_WORD.test(normalizedText);
}

type QuestionCheck =
  | { kind: 'QUERY'; hasAmount: boolean }
  | { kind: 'REMIND'; reason: string }
  | { kind: 'RECORD'; weakQuestion: boolean };

// Phase 5b (plan 3.2a, 3.2c): tách câu hỏi khỏi câu ghi. RECORD + weakQuestion → đã bỏ "?" / "tổng" khỏi ctx.
function checkQuestion(ctx: ParseContext): QuestionCheck {
  const text = ctx.workingAsciiText;
  const hasAmount = hasAmountOutsidePeriod(text);
  if (STRONG_QUERY_PATTERNS.some((re) => re.test(text)) || hasQuestionParticle(ctx.normalizedText)) {
    return { kind: 'QUERY', hasAmount };
  }
  const weak = WEAK_QUESTION_MARK.test(text) || WEAK_TONG.test(text) || WEAK_SO_DU.test(text);
  if (!hasAmount) {
    const moneyMove = TRANSFER_REGEX.test(text) || FUND_VERB.test(text) || hasSavingsVerb(text) || hasGoldMove(ctx.normalizedText, text) || hasDebtWord(ctx.normalizedText, ctx.asciiText);
    if (weak || (!moneyMove && (PERIOD_WORD.test(text) || STAT_WORD.test(text)))) {
      return { kind: 'QUERY', hasAmount: false };
    }
    return { kind: 'RECORD', weakQuestion: false };
  }
  if (!weak) {
    return { kind: 'RECORD', weakQuestion: false };
  }
  if (WEAK_SO_DU.test(text)) {
    return { kind: 'REMIND', reason: 'SO_DU_DUNG_LENH' };
  }
  if (PERIOD_WORD.test(text)) {
    return { kind: 'REMIND', reason: 'HOI_HAY_GHI' };
  }
  ctx.workingAsciiText = normalizeWhitespace(text.replace(WEAK_TONG, '').replace(WEAK_QUESTION_MARK, ''));
  return { kind: 'RECORD', weakQuestion: true };
}

function result(intent: MessageIntent, extra: Partial<IntentClassification> = {}): IntentClassification {
  return { intent, explicitTransactionType: null, transferRecipientId: null, transferSubjectId: null, ...extra };
}

export function classifyIntent(ctx: ParseContext): IntentClassification {
  // 1. Tiền tố giao dịch có dấu ":" ở đầu câu
  for (const item of STRICT_PREFIX_PATTERNS) {
    const match = ctx.workingAsciiText.match(item.regex);
    if (match) {
      ctx.workingAsciiText = normalizeWhitespace(ctx.workingAsciiText.slice(match[0].length));
      return result(MESSAGE_INTENT.RECORD_TRANSACTION, { explicitTransactionType: item.type });
    }
  }

  // 2. Yêu cầu xuất báo cáo HTML
  if (HTML_REPORT_PATTERNS.some((pattern) => pattern.test(ctx.workingAsciiText))) {
    return result(MESSAGE_INTENT.EXPORT_HTML_REPORT);
  }

  // 3. Lệnh huỷ/xoá đầu câu → không ghi, hướng dẫn (handler)
  if (ACTION_START.test(ctx.normalizedText)) {
    return result(MESSAGE_INTENT.UNKNOWN, { reason: 'THAO_TAC' });
  }

  // 4. Câu hỏi thống kê / nhắc (Q6)
  const question = checkQuestion(ctx);
  if (question.kind === 'QUERY') {
    return result(MESSAGE_INTENT.QUERY_STATISTICS, { hasAmount: question.hasAmount });
  }
  if (question.kind === 'REMIND') {
    return result(MESSAGE_INTENT.UNKNOWN, { reason: question.reason });
  }
  const weak = question.weakQuestion ? { weakQuestion: true } : {};
  const text = ctx.workingAsciiText;

  // 4. Tiền tố không dấu: "thu 5tr", "chi tiền ăn 50k"
  for (const item of LOOSE_PREFIX_PATTERNS) {
    const match = text.match(item.regex);
    if (match) {
      ctx.workingAsciiText = normalizeWhitespace(text.slice(match[0].length));
      return result(MESSAGE_INTENT.RECORD_TRANSACTION, { explicitTransactionType: item.type, ...weak });
    }
  }

  // 5. Chuyển tiền nội bộ giữa Vợ và Chồng (bỏ động từ + người nhận, giữ phần đứng trước)
  const transfer = text.match(TRANSFER_REGEX);
  if (transfer) {
    ctx.workingAsciiText = normalizeWhitespace(`${transfer[1] ?? ''} ${text.slice(transfer[0].length)}`);
    return result(MESSAGE_INTENT.INTERNAL_TRANSFER, {
      transferRecipientId: toMemberId(transfer[3]),
      transferSubjectId: toMemberId(transfer[2]),
    });
  }

  // 6. Mặc định phân tích như câu ghi nhận giao dịch tự nhiên (nếu có số tiền/danh mục)
  return result(MESSAGE_INTENT.RECORD_TRANSACTION, weak);
}
