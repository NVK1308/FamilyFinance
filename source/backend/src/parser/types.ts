import type {
  BeneficiaryId,
  CategoryCode,
  ConfirmationType,
  FundDirection,
  MemberId,
  MessageIntent,
  MoneyHolderId,
  SavingsDirection,
  SavingsSourceId,
  TransactionType,
  TransferStatus,
} from '../config/constants.ts';

export interface ParseOptions {
  senderId: MemberId;
  referenceDate?: string;
  // Tên hũ đang có (ASCII, chữ thường — hu.ten_khong_dau). "quỹ X" chỉ là hũ khi X khớp một tên ở đây.
  jarNames?: readonly string[];
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
  // Có 2 số tiền ("3 hay 4 triệu") → so_tien = null
  so_tien_mo_ho: boolean;
  ma_danh_muc: CategoryCode | string | null;
  nguoi_tao_id: MemberId;
  nguoi_thuc_hien_id: MemberId;
  nguoi_giu_tien_id: MoneyHolderId;
  doi_tuong_thu_huong_id: BeneficiaryId | null;
  ngay_giao_dich: string;
  requires_confirmation: ConfirmationType[];
  cashflow_impact: number;
  mo_ta: string;
  // Chi trả từ hũ ("… lấy từ quỹ y tế"): chữ sau "hũ / quỹ"; '' = hũ mặc định; null = không trả từ hũ
  ten_hu_nguon: string | null;
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
  // Câu chuyển chưa hỗ trợ (vd "vợ chuyển chồng" do chồng nhắn) → không tạo chuyển
  ly_do_chua_ho_tro: string | null;
  mo_ta: string;
}

export interface ParsedFundTransferResult {
  intent: typeof MESSAGE_INTENT_FUND;
  chieu: FundDirection;
  thanh_vien_id: MemberId;
  so_tien: number | null;
  so_tien_mo_ho: boolean;
  ngay_chuyen: string;
  ly_do_chua_ho_tro: string | null;
  mo_ta: string;
}

// Hũ tiết kiệm (Phase 5c-1: chỉ tiền)
export interface ParsedSavingsResult {
  intent: typeof MESSAGE_INTENT_SAVINGS;
  chieu: SavingsDirection;
  thanh_vien_id: MemberId;
  // Nguồn / đích tiền mặt; null khi khai báo
  nguon_id: SavingsSourceId | null;
  // Chữ sau "hũ / quỹ" (ASCII) — service khớp tên hũ; null = hũ mặc định
  ten_hu: string | null;
  so_tien: number | null;
  so_tien_mo_ho: boolean;
  ngay: string;
  ly_do_chua_ho_tro: string | null;
  mo_ta: string;
}

export interface ParsedQueryOrOtherResult {
  intent: Exclude<MessageIntent, 'RECORD_TRANSACTION' | 'INTERNAL_TRANSFER' | 'FUND_TRANSFER' | 'SAVINGS_MOVE'>;
  rawText: string;
  normalizedText: string;
  nguoi_tao_id: MemberId;
  ngay_tham_chieu: string;
  // UNKNOWN: lý do nhắc (HOI_HAY_GHI, SO_DU_DUNG_LENH) — Phase 5b Q6
  ly_do: string | null;
  // QUERY: câu hỏi có kèm số tiền rõ → trả lời kèm gợi ý cách ghi
  co_so_tien: boolean;
}

export type ParseResult =
  | ParsedTransactionResult
  | ParsedTransferResult
  | ParsedFundTransferResult
  | ParsedSavingsResult
  | ParsedQueryOrOtherResult;

const MESSAGE_INTENT_TRANSACTION = 'RECORD_TRANSACTION' as const;
const MESSAGE_INTENT_TRANSFER = 'INTERNAL_TRANSFER' as const;
const MESSAGE_INTENT_FUND = 'FUND_TRANSFER' as const;
const MESSAGE_INTENT_SAVINGS = 'SAVINGS_MOVE' as const;

