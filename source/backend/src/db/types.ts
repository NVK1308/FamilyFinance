import type {
  AdjustmentDirection,
  AuditAction,
  BeneficiaryId,
  ConfirmationStatus,
  ConfirmationType,
  DebtChangeType,
  LoanDirection,
  LoanStatus,
  MemberId,
  MessageStatus,
  MoneyHolderId,
  TableName,
  TransactionStatus,
  TransactionType,
  TransferStatus,
} from '../config/constants.ts';

export type SqlParam = string | number | bigint | boolean | null | undefined;

export interface DatabaseAdapter {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlParam[],
  ): Promise<T | null>;
  execute(sql: string, params?: readonly SqlParam[]): Promise<{ changes: number }>;
  transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T>;
  nextVersion(): Promise<number>;
}

export function toSafeNumber(val: unknown): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : 0;
  }
  if (typeof val === 'bigint') {
    return Number(val);
  }
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export interface TinNhanGocRecord {
  id: string;
  telegram_update_id: number;
  telegram_message_id: number;
  telegram_chat_id: number;
  nguoi_gui_id: MemberId | null;
  noi_dung_goc: string;
  thoi_gian_nhan: string;
  trang_thai_xu_ly: MessageStatus;
  chi_tiet_loi: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
}

export interface GiaoDichRecord {
  id: string;
  loai_giao_dich: TransactionType;
  so_tien: number;
  danh_muc_id: string | null;
  nguoi_tao_id: MemberId;
  nguoi_thuc_hien_id: MemberId;
  nguoi_giu_tien_id: MoneyHolderId | null;
  doi_tuong_thu_huong_id: BeneficiaryId | null;
  khoan_no_id: string | null;
  chieu_dieu_chinh: AdjustmentDirection | null;
  mo_ta: string;
  ngay_giao_dich: string;
  trang_thai: TransactionStatus;
  source_message_id: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
}

export interface YeuCauXacNhanRecord {
  id: string;
  source_message_id: string;
  nguoi_tao_id: MemberId;
  nguoi_can_xac_nhan_id: MemberId;
  loai_xac_nhan: ConfirmationType;
  du_lieu_de_xuat_json: string;
  trang_thai: ConfirmationStatus;
  expires_at: string;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
}

export interface SoDuBanDauRecord {
  id: string;
  nguoi_giu_tien_id: MoneyHolderId;
  so_tien: number;
  ngay_ap_dung: string;
  nguoi_xac_nhan_id: MemberId | null;
  ghi_chu: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
}

export interface KhoanNoRecord {
  id: string;
  ten_khoan_no: string;
  chieu_no: LoanDirection;
  doi_tac: string;
  so_tien_goc: number;
  du_no_hien_tai: number;
  ngay_phat_sinh: string;
  ngay_dao_han: string | null;
  trang_thai: LoanStatus;
  ghi_chu: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
}

export interface LichSuNoRecord {
  id: string;
  khoan_no_id: string;
  giao_dich_id: string;
  loai_bien_dong: DebtChangeType;
  so_tien: number;
  ngay_ghi_nhan: string;
  ghi_chu: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
}

export interface LichSuChinhSuaRecord {
  id: string;
  ten_bang: TableName;
  ban_ghi_id: string;
  hanh_dong: AuditAction;
  du_lieu_truoc_json: string | null;
  du_lieu_sau_json: string | null;
  nguoi_thuc_hien_id: MemberId | null;
  ly_do: string | null;
  created_at: string;
  version: number;
}


export interface ThanhVienRecord {
  id: MemberId;
  ten: string;
  telegram_user_id: number;
  vai_tro: 'VO' | 'CHONG' | 'QUAN_TRI';
  is_active: number | boolean;
  deleted_at: string | null;
}

export interface DanhMucRecord {
  id: string;
  ma_danh_muc: string;
  ten_danh_muc: string;
  loai_giao_dich: 'THU' | 'CHI' | 'CA_HAI';
  is_active: number | boolean;
  deleted_at: string | null;
}

export interface ChuyenTienNoiBoRecord {
  id: string;
  nguoi_chuyen_id: string;
  nguoi_nhan_id: string;
  so_tien: number;
  ngay_chuyen: string;
  trang_thai: TransferStatus;
  deleted_at: string | null;
}
