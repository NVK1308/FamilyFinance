import {
  CONFIRMATION_TYPE,
  MESSAGE_INTENT,
  SAVINGS_DIRECTION,
  TRANSACTION_TYPE,
  TRANSFER_STATUS,
  type ConfirmationType,
  type TransactionType,
} from '../config/constants.ts';
import { extractAmountVnd } from './amount-parser.ts';
import { matchCategoryAndType } from './category-matcher.ts';
import { extractTransactionDate } from './date-parser.ts';
import { detectFundTransfer } from './fund-detector.ts';
import { classifyIntent } from './intent-classifier.ts';
import { createParseContext } from './normalizer.ts';
import { resolveRoles } from './role-resolver.ts';
import { detectSavings } from './savings-detector.ts';
import type { ParseOptions, ParseResult } from './types.ts';

function computeCashflowImpact(type: TransactionType | null, amount: number | null): number {
  if (amount === null || amount <= 0 || type === null) {
    return 0;
  }
  if (type === TRANSACTION_TYPE.THU) {
    return amount;
  }
  if (
    type === TRANSACTION_TYPE.CHI ||
    type === TRANSACTION_TYPE.LAI_VAY ||
    type === TRANSACTION_TYPE.PHI
  ) {
    return -amount;
  }
  return 0;
}

export function parseVietnameseFinanceMessage(
  rawText: string,
  options: ParseOptions,
): ParseResult {
  const ctx = createParseContext(rawText, options);
  const classification = classifyIntent(ctx);

  // 1. Xử lý câu hỏi thống kê hoặc yêu cầu xuất báo cáo HTML
  if (
    classification.intent === MESSAGE_INTENT.QUERY_STATISTICS ||
    classification.intent === MESSAGE_INTENT.EXPORT_HTML_REPORT ||
    classification.intent === MESSAGE_INTENT.CONFIRMATION_REPLY ||
    classification.intent === MESSAGE_INTENT.UNKNOWN
  ) {
    return {
      intent: classification.intent,
      rawText: ctx.rawText,
      normalizedText: ctx.normalizedText,
      nguoi_tao_id: ctx.senderId,
      ngay_tham_chieu: ctx.referenceDate,
      ly_do: classification.reason ?? null,
      co_so_tien: classification.hasAmount ?? false,
    };
  }

  // 2. Xử lý chuyển tiền nội bộ giữa Vợ và Chồng
  if (
    classification.intent === MESSAGE_INTENT.INTERNAL_TRANSFER &&
    classification.transferRecipientId !== null
  ) {
    const transferDate = extractTransactionDate(ctx);
    const amountResult = extractAmountVnd(ctx);
    const confirmations: ConfirmationType[] = [];

    if (amountResult.amount === null || amountResult.isAmbiguous) {
      confirmations.push(CONFIRMATION_TYPE.GIAO_DICH_MO_HO);
    } else {
      confirmations.push(CONFIRMATION_TYPE.CHUYEN_TIEN);
    }

    // Chưa hỗ trợ: chủ ngữ là người khác ("vợ chuyển chồng" do chồng nhắn, Q6);
    // tiền lấy từ quỹ chung chuyển cho người kia ("chuyển vợ 2tr từ quỹ chung")
    const subject = classification.transferSubjectId;
    let unsupported: string | null = null;
    if (subject !== null && subject !== ctx.senderId) {
      unsupported = 'CHU_NGU_KHAC_NGUOI_GUI';
    } else if (/\bquy\s+chung\b/i.test(ctx.asciiText)) {
      unsupported = 'CHUYEN_TU_QUY_CHUNG';
    }
    return {
      intent: MESSAGE_INTENT.INTERNAL_TRANSFER,
      nguoi_chuyen_id: ctx.senderId,
      nguoi_nhan_id: classification.transferRecipientId,
      so_tien: amountResult.amount,
      ngay_chuyen: transferDate,
      trang_thai: TRANSFER_STATUS.CHO_XAC_NHAN,
      nguoi_can_xac_nhan_id: classification.transferRecipientId,
      affects_family_total: false,
      requires_confirmation: confirmations,
      ly_do_chua_ho_tro: unsupported,
      mo_ta: ctx.rawText,
    };
  }

  // 3. Xử lý ghi nhận giao dịch (THU / CHI / VAY / TRA_NO...)
  const transactionDate = extractTransactionDate(ctx);
  const amountResult = extractAmountVnd(ctx);

  // 3a. Hũ tiết kiệm (trước quỹ chung: "lấy quỹ chung bỏ hũ" là bỏ hũ, nguồn quỹ chung)
  if (classification.explicitTransactionType === null) {
    const savings = detectSavings(ctx.workingAsciiText, ctx.senderId);
    if (savings) {
      return {
        intent: MESSAGE_INTENT.SAVINGS_MOVE,
        chieu: savings.chieu,
        thanh_vien_id: ctx.senderId,
        nguon_id: savings.chieu === SAVINGS_DIRECTION.KHAI_BAO ? null : (savings.nguon ?? ctx.senderId),
        so_tien: amountResult.isAmbiguous ? null : amountResult.amount,
        so_tien_mo_ho: amountResult.isAmbiguous,
        ngay: transactionDate,
        ly_do_chua_ho_tro: savings.unsupportedReason,
        mo_ta: ctx.rawText,
      };
    }
  }

  // 3b. Nộp / rút quỹ chung: chỉ khi câu không có tiền tố loại và không chứa gì khác
  if (classification.explicitTransactionType === null) {
    const fund = detectFundTransfer(ctx.workingAsciiText, ctx.senderId);
    if (fund) {
      return {
        intent: MESSAGE_INTENT.FUND_TRANSFER,
        chieu: fund.chieu,
        thanh_vien_id: ctx.senderId,
        so_tien: amountResult.isAmbiguous ? null : amountResult.amount,
        so_tien_mo_ho: amountResult.isAmbiguous,
        ngay_chuyen: transactionDate,
        ly_do_chua_ho_tro: fund.unsupportedReason,
        mo_ta: ctx.rawText,
      };
    }
  }

  const roles = resolveRoles(ctx);
  const categoryMatch = matchCategoryAndType(ctx, classification.explicitTransactionType);

  const finalType = categoryMatch.inferredTransactionType;
  const confirmations: ConfirmationType[] = [];

  if (amountResult.amount === null || amountResult.isAmbiguous || finalType === null) {
    confirmations.push(CONFIRMATION_TYPE.GIAO_DICH_MO_HO);
  }

  if (
    categoryMatch.categoryCode === null &&
    (finalType === TRANSACTION_TYPE.THU || finalType === TRANSACTION_TYPE.CHI)
  ) {
    confirmations.push(CONFIRMATION_TYPE.DANH_MUC_MOI);
  }

  if (roles.hasUnknownBeneficiary) {
    confirmations.push(CONFIRMATION_TYPE.DOI_TUONG_MOI);
  }

  // Q6: câu có tiền chỉ khớp luật hỏi yếu ("tiền ăn 50k?") → ghi khi nhận ra loại hoặc danh mục, không thì nhắc
  const typeKnown = finalType !== null && !confirmations.includes(CONFIRMATION_TYPE.GIAO_DICH_MO_HO);
  if (classification.weakQuestion && !typeKnown && categoryMatch.categoryCode === null) {
    return {
      intent: MESSAGE_INTENT.UNKNOWN,
      rawText: ctx.rawText,
      normalizedText: ctx.normalizedText,
      nguoi_tao_id: ctx.senderId,
      ngay_tham_chieu: ctx.referenceDate,
      ly_do: 'HOI_HAY_GHI',
      co_so_tien: true,
    };
  }

  return {
    intent: MESSAGE_INTENT.RECORD_TRANSACTION,
    loai_giao_dich: finalType,
    so_tien: amountResult.amount,
    so_tien_mo_ho: amountResult.isAmbiguous,
    ma_danh_muc: categoryMatch.categoryCode,
    nguoi_tao_id: roles.nguoi_tao_id,
    nguoi_thuc_hien_id: roles.nguoi_thuc_hien_id,
    nguoi_giu_tien_id: roles.nguoi_giu_tien_id,
    doi_tuong_thu_huong_id: roles.doi_tuong_thu_huong_id,
    ngay_giao_dich: transactionDate,
    requires_confirmation: confirmations,
    cashflow_impact: computeCashflowImpact(finalType, amountResult.amount),
    mo_ta: ctx.rawText,
  };
}

export * from './types.ts';
export * from './normalizer.ts';
export * from './amount-parser.ts';
export * from './date-parser.ts';
export * from './role-resolver.ts';
export * from './category-matcher.ts';
export * from './intent-classifier.ts';

