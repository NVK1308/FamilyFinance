import {
  MEMBER_ID,
  MESSAGE_INTENT,
  TRANSACTION_TYPE,
  type MemberId,
  type MessageIntent,
  type TransactionType,
} from '../config/constants.ts';
import { normalizeWhitespace } from './normalizer.ts';
import type { ParseContext } from './types.ts';

export interface IntentClassification {
  intent: MessageIntent;
  explicitTransactionType: TransactionType | null;
  transferRecipientId: MemberId | null;
}

const EXPLICIT_PREFIX_PATTERNS: ReadonlyArray<{
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
  { regex: /^thu\s+(?=\d|luong|ot|thuong|tien|no\b)/i, type: TRANSACTION_TYPE.THU },
  { regex: /^chi\s+(?=\d|tien|an\b|mua\b|hoc\b|sua\b|chong\b|vo\b|no\b)/i, type: TRANSACTION_TYPE.CHI },
];

const HTML_REPORT_PATTERNS: readonly RegExp[] = [
  /\bxuat\s+bao\s+cao\b/i,
  /\bbao\s+cao\s+html\b/i,
  /\bfile\s+html\b/i,
  /\bgui\s+bao\s+cao\s+chi\s+tiet\b/i,
];

const QUERY_PATTERNS: readonly RegExp[] = [
  /\?$/,
  /\bbao\s+nhieu\b/i,
  /\bcon\s+bao\s+nhieu\b/i,
  /\bliet\s+ke\b/i,
  /\bso\s+sanh\b/i,
  /\blich\s+su\b/i,
  /\bthong\s+ke\b/i,
  /\bkhoan\s+chi\s+nao\b/i,
  /\bai\s+da\s+thanh\s+toan\b/i,
  /\bchi\s+nhieu\s+nhat\b/i,
  /^tong\s+(thu|chi|tien)\b/i,
  /^so\s+du\b/i,
];

const TRANSFER_TO_VO_REGEX =
  /^(?:chuyen(?:\s+tien|\s+khoan)?|ck|dua(?:\s+tien)?)\s+(?:cho\s+)?vo\b/i;
const TRANSFER_TO_CHONG_REGEX =
  /^(?:chuyen(?:\s+tien|\s+khoan)?|ck|dua(?:\s+tien)?)\s+(?:cho\s+)?chong\b/i;

export function classifyIntent(ctx: ParseContext): IntentClassification {
  const text = ctx.workingAsciiText;

  // 1. Kiểm tra tiền tố giao dịch tường minh ở đầu câu trước tiên
  for (const item of EXPLICIT_PREFIX_PATTERNS) {
    const match = text.match(item.regex);
    if (match) {
      ctx.workingAsciiText = normalizeWhitespace(text.slice(match[0].length));
      return {
        intent: MESSAGE_INTENT.RECORD_TRANSACTION,
        explicitTransactionType: item.type,
        transferRecipientId: null,
      };
    }
  }

  // 2. Kiểm tra yêu cầu xuất báo cáo HTML
  for (const pattern of HTML_REPORT_PATTERNS) {
    if (pattern.test(text)) {
      return {
        intent: MESSAGE_INTENT.EXPORT_HTML_REPORT,
        explicitTransactionType: null,
        transferRecipientId: null,
      };
    }
  }

  // 3. Kiểm tra câu hỏi truy vấn / thống kê
  for (const pattern of QUERY_PATTERNS) {
    if (pattern.test(text)) {
      return {
        intent: MESSAGE_INTENT.QUERY_STATISTICS,
        explicitTransactionType: null,
        transferRecipientId: null,
      };
    }
  }

  // 4. Kiểm tra chuyển tiền nội bộ giữa Vợ và Chồng
  const toVoMatch = text.match(TRANSFER_TO_VO_REGEX);
  if (toVoMatch) {
    ctx.workingAsciiText = normalizeWhitespace(text.slice(toVoMatch[0].length));
    return {
      intent: MESSAGE_INTENT.INTERNAL_TRANSFER,
      explicitTransactionType: null,
      transferRecipientId: MEMBER_ID.VO,
    };
  }

  const toChongMatch = text.match(TRANSFER_TO_CHONG_REGEX);
  if (toChongMatch) {
    ctx.workingAsciiText = normalizeWhitespace(text.slice(toChongMatch[0].length));
    return {
      intent: MESSAGE_INTENT.INTERNAL_TRANSFER,
      explicitTransactionType: null,
      transferRecipientId: MEMBER_ID.CHONG,
    };
  }

  // 5. Mặc định phân tích như câu ghi nhận giao dịch tự nhiên (nếu có số tiền/danh mục)
  return {
    intent: MESSAGE_INTENT.RECORD_TRANSACTION,
    explicitTransactionType: null,
    transferRecipientId: null,
  };
}

