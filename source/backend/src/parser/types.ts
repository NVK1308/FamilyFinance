import type {
  BeneficiaryId,
  CategoryCode,
  ConfirmationType,
  MemberId,
  MessageIntent,
  MoneyHolderId,
  TransactionType,
  TransferStatus,
} from '../config/constants.ts';

export interface ParseOptions {
  senderId: MemberId;
  referenceDate?: string;
}

export interface ParseContext {
  rawText: string;
  normalizedText: string;
  asciiText: string;
  workingAsciiText: string;
  senderId: MemberId;
  referenceDate: string;
}

export interface ParsedTransactionResult {
  intent: typeof MESSAGE_INTENT_TRANSACTION;
  loai_giao_dich: TransactionType | null;
  so_tien: number | null;
  ma_danh_muc: CategoryCode | string | null;
  nguoi_tao_id: MemberId;
  nguoi_thuc_hien_id: MemberId;
  nguoi_giu_tien_id: MoneyHolderId;
  doi_tuong_thu_huong_id: BeneficiaryId | null;
  ngay_giao_dich: string;
  requires_confirmation: ConfirmationType[];
  cashflow_impact: number;
  mo_ta: string;
}

export interface ParsedTransferResult {
  intent: typeof MESSAGE_INTENT_TRANSFER;
  nguoi_chuyen_id: MemberId;
  nguoi_nhan_id: MemberId;
  so_tien: number | null;
  ngay_chuyen: string;
  trang_thai: TransferStatus;
  nguoi_can_xac_nhan_id: MemberId;
  affects_family_total: false;
  requires_confirmation: ConfirmationType[];
}

export interface ParsedQueryOrOtherResult {
  intent: Exclude<MessageIntent, 'RECORD_TRANSACTION' | 'INTERNAL_TRANSFER'>;
  rawText: string;
  normalizedText: string;
  nguoi_tao_id: MemberId;
  ngay_tham_chieu: string;
}

export type ParseResult =
  | ParsedTransactionResult
  | ParsedTransferResult
  | ParsedQueryOrOtherResult;

const MESSAGE_INTENT_TRANSACTION = 'RECORD_TRANSACTION' as const;
const MESSAGE_INTENT_TRANSFER = 'INTERNAL_TRANSFER' as const;

