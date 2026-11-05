import {
  BENEFICIARY_ID,
  MEMBER_ID,
  MONEY_HOLDER_ID,
  type BeneficiaryId,
  type MemberId,
  type MoneyHolderId,
} from '../config/constants.ts';
import { normalizeWhitespace } from './normalizer.ts';
import type { ParseContext } from './types.ts';

export interface RoleResolutionResult {
  nguoi_tao_id: MemberId;
  nguoi_thuc_hien_id: MemberId;
  nguoi_giu_tien_id: MoneyHolderId;
  doi_tuong_thu_huong_id: BeneficiaryId | null;
  hasUnknownBeneficiary: boolean;
}

interface PatternRule<T> {
  regex: RegExp;
  value: T;
  replacement?: string;
}

const MONEY_HOLDER_RULES: ReadonlyArray<PatternRule<MoneyHolderId>> = [
  {
    regex: /\b(?:lay|tu|dung|trich)?\s*(?:tien\s+)?quy\s+chung\b/i,
    value: MONEY_HOLDER_ID.QUY_CHUNG,
  },
  {
    regex: /\b(?:lay\s+tien\s+vo|tien\s+vo\s+giu|vo\s+giu)\b/i,
    value: MONEY_HOLDER_ID.VO,
  },
  {
    regex: /\b(?:lay\s+tien\s+chong|tien\s+chong\s+giu|chong\s+giu)\b/i,
    value: MONEY_HOLDER_ID.CHONG,
  },
  {
    regex: /\b(?:chua\s+xac\s+dinh\s+nguoi\s+giu|chua\s+ro\s+ai\s+giu)\b/i,
    value: MONEY_HOLDER_ID.CHUA_XAC_DINH,
  },
];

const MULTI_BENEFICIARY_REGEX = /\b(?:cho\s+)?(?:cac\s+con|2\s+con|hai\s+con)\b/i;

const BENEFICIARY_RULES: ReadonlyArray<PatternRule<BeneficiaryId>> = [
  {
    regex: /\b(?:cho\s+|cua\s+)?(?:con\s+gai|be\s+lon|chi\s+hai)\b/i,
    value: BENEFICIARY_ID.CON_GAI,
  },
  {
    regex: /\b(?:cho\s+|cua\s+)?(?:con\s+trai|be\s+nho|cu\s+em)\b/i,
    value: BENEFICIARY_ID.CON_TRAI,
  },
  {
    regex: /\b(?:cho|cua)\s+vo\b/i,
    value: BENEFICIARY_ID.VO,
  },
  {
    regex: /\b(?:cho|cua)\s+chong\b/i,
    value: BENEFICIARY_ID.CHONG,
  },
  {
    regex: /\b(?:cho\s+|cua\s+)?(?:gia\s+dinh|ca\s+nha)\b/i,
    value: BENEFICIARY_ID.GIA_DINH,
  },
];

// Giữ lại động từ/danh từ nghiệp vụ ($1) để category-matcher phía sau vẫn khớp được 'mua do', 'luong'...
const PERFORMER_RULES: ReadonlyArray<PatternRule<MemberId>> = [
  {
    regex: /\bchong\s+(thanh\s+toan|tra)\b/i,
    value: MEMBER_ID.CHONG,
    replacement: ' ',
  },
  {
    regex: /\bvo\s+(thanh\s+toan|tra)\b/i,
    value: MEMBER_ID.VO,
    replacement: ' ',
  },
  {
    regex: /\bchong\s+(mua|chi|dong|nop|thu|nhan)\b/i,
    value: MEMBER_ID.CHONG,
    replacement: '$1',
  },
  {
    regex: /\bvo\s+(mua|chi|dong|nop|thu|nhan)\b/i,
    value: MEMBER_ID.VO,
    replacement: '$1',
  },
  {
    regex: /\b(luong|thuong|ot|thu\s+nhap)\s+chong\b/i,
    value: MEMBER_ID.CHONG,
    replacement: '$1',
  },
  {
    regex: /\b(luong|thuong|ot|thu\s+nhap)\s+vo\b/i,
    value: MEMBER_ID.VO,
    replacement: '$1',
  },
];

export function resolveRoles(ctx: ParseContext): RoleResolutionResult {
  let text = ctx.workingAsciiText;
  let nguoiGiuTienId: MoneyHolderId | null = null;
  let doiTuongThuHuongId: BeneficiaryId | null = null;
  let nguoiThucHienId: MemberId = ctx.senderId;

  // 1. Người giữ tiền câu nói rõ (quỹ chung, tiền vợ giữ...); không nói thì gán ở bước 4
  for (const rule of MONEY_HOLDER_RULES) {
    if (rule.regex.test(text)) {
      nguoiGiuTienId = rule.value;
      text = normalizeWhitespace(text.replace(rule.regex, ' '));
      break;
    }
  }

  // 2. Đối tượng thụ hưởng. Nhiều đối tượng ("các con", "con gái và con trai") → để NULL,
  // không hỏi phân bổ (người dùng bỏ phân bổ 05/11/2026, bảng phan_bo_giao_dich giữ cho sau này)
  if (MULTI_BENEFICIARY_REGEX.test(text)) {
    text = normalizeWhitespace(text.replace(MULTI_BENEFICIARY_REGEX, ' '));
  } else {
    const matched = BENEFICIARY_RULES.filter((rule) => rule.regex.test(text));
    for (const rule of matched) {
      text = normalizeWhitespace(text.replace(rule.regex, ' '));
    }
    if (matched.length === 1) {
      doiTuongThuHuongId = matched[0]!.value;
    }
  }

  // 3. Giải quyết nguoi_thuc_hien_id (mặc định bằng senderId nếu không chỉ rõ người khác)
  for (const rule of PERFORMER_RULES) {
    if (rule.regex.test(text)) {
      nguoiThucHienId = rule.value;
      text = normalizeWhitespace(text.replace(rule.regex, rule.replacement ?? ' '));
      break;
    }
  }

  ctx.workingAsciiText = text;

  // 4. Q2: không nói ai giữ tiền thì người giữ = người thực hiện
  return {
    nguoi_tao_id: ctx.senderId,
    nguoi_thuc_hien_id: nguoiThucHienId,
    nguoi_giu_tien_id: nguoiGiuTienId ?? nguoiThucHienId,
    doi_tuong_thu_huong_id: doiTuongThuHuongId,
    hasUnknownBeneficiary: false,
  };
}

