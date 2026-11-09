export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const DEFAULT_CURRENCY = 'VND';

export const TRANSACTION_TYPE = {
  THU: 'THU',
  CHI: 'CHI',
  VAY: 'VAY',
  TRA_NO: 'TRA_NO',
  LAI_VAY: 'LAI_VAY',
  PHI: 'PHI',
  DIEU_CHINH: 'DIEU_CHINH',
} as const;

export type TransactionType = (typeof TRANSACTION_TYPE)[keyof typeof TRANSACTION_TYPE];

export const CATEGORY_SCOPE = {
  THU: 'THU',
  CHI: 'CHI',
  CA_HAI: 'CA_HAI',
} as const;

export type CategoryScope = (typeof CATEGORY_SCOPE)[keyof typeof CATEGORY_SCOPE];

export const MESSAGE_INTENT = {
  RECORD_TRANSACTION: 'RECORD_TRANSACTION',
  INTERNAL_TRANSFER: 'INTERNAL_TRANSFER',
  QUERY_STATISTICS: 'QUERY_STATISTICS',
  EXPORT_HTML_REPORT: 'EXPORT_HTML_REPORT',
  CONFIRMATION_REPLY: 'CONFIRMATION_REPLY',
  FUND_TRANSFER: 'FUND_TRANSFER',
  // Hũ tiết kiệm (Phase 5c)
  SAVINGS_MOVE: 'SAVINGS_MOVE',
  UNKNOWN: 'UNKNOWN',
} as const;

export type MessageIntent = (typeof MESSAGE_INTENT)[keyof typeof MESSAGE_INTENT];

export const MEMBER_ID = {
  VO: 'VO',
  CHONG: 'CHONG',
} as const;

export type MemberId = (typeof MEMBER_ID)[keyof typeof MEMBER_ID];

export const MONEY_HOLDER_ID = {
  VO: 'VO',
  CHONG: 'CHONG',
  QUY_CHUNG: 'QUY_CHUNG',
  CHUA_XAC_DINH: 'CHUA_XAC_DINH',
} as const;

export type MoneyHolderId = (typeof MONEY_HOLDER_ID)[keyof typeof MONEY_HOLDER_ID];

export const BENEFICIARY_ID = {
  VO: 'VO',
  CHONG: 'CHONG',
  CON_GAI: 'CON_GAI',
  CON_TRAI: 'CON_TRAI',
  GIA_DINH: 'GIA_DINH',
  // Tất cả các con (seed 0003, Phase 5b Q8)
  CAC_CON: 'CAC_CON',
} as const;

export type BeneficiaryId = (typeof BENEFICIARY_ID)[keyof typeof BENEFICIARY_ID];

export const TRANSFER_STATUS = {
  CHO_XAC_NHAN: 'CHO_XAC_NHAN',
  DA_XAC_NHAN: 'DA_XAC_NHAN',
  TU_CHOI: 'TU_CHOI',
  DA_HUY: 'DA_HUY',
  HET_HAN: 'HET_HAN',
} as const;

export type TransferStatus = (typeof TRANSFER_STATUS)[keyof typeof TRANSFER_STATUS];

export const TRANSACTION_STATUS = {
  CHO_XAC_NHAN: 'CHO_XAC_NHAN',
  HOAN_TAT: 'HOAN_TAT',
  DA_HUY: 'DA_HUY',
} as const;

export type TransactionStatus = (typeof TRANSACTION_STATUS)[keyof typeof TRANSACTION_STATUS];

export const MESSAGE_STATUS = {
  DA_NHAN: 'DA_NHAN',
  DA_GHI: 'DA_GHI',
  CHO_XAC_NHAN: 'CHO_XAC_NHAN',
  DA_BO_QUA: 'DA_BO_QUA',
  LOI: 'LOI',
} as const;

export type MessageStatus = (typeof MESSAGE_STATUS)[keyof typeof MESSAGE_STATUS];

export const CONFIRMATION_STATUS = {
  CHO_XAC_NHAN: 'CHO_XAC_NHAN',
  DA_XAC_NHAN: 'DA_XAC_NHAN',
  TU_CHOI: 'TU_CHOI',
  HET_HAN: 'HET_HAN',
} as const;

export type ConfirmationStatus = (typeof CONFIRMATION_STATUS)[keyof typeof CONFIRMATION_STATUS];

export const LOAN_DIRECTION = {
  DI_VAY: 'DI_VAY',
  CHO_VAY: 'CHO_VAY',
} as const;

export type LoanDirection = (typeof LOAN_DIRECTION)[keyof typeof LOAN_DIRECTION];

export const LOAN_STATUS = {
  DANG_NO: 'DANG_NO',
  DA_TAT_TOAN: 'DA_TAT_TOAN',
  DA_HUY: 'DA_HUY',
} as const;

export type LoanStatus = (typeof LOAN_STATUS)[keyof typeof LOAN_STATUS];

export const DEBT_CHANGE_TYPE = {
  GIAI_NGAN: 'GIAI_NGAN',
  TRA_GOC: 'TRA_GOC',
  THU_GOC: 'THU_GOC',
  TRA_LAI: 'TRA_LAI',
  DIEU_CHINH: 'DIEU_CHINH',
} as const;

export type DebtChangeType = (typeof DEBT_CHANGE_TYPE)[keyof typeof DEBT_CHANGE_TYPE];

// Nộp vào / rút ra quỹ chung (bảng chuyen_quy_chung, migration 0003)
export const FUND_DIRECTION = {
  NOP: 'NOP',
  RUT: 'RUT',
} as const;

export type FundDirection = (typeof FUND_DIRECTION)[keyof typeof FUND_DIRECTION];

export const FUND_MOVE_STATUS = {
  HOAN_TAT: 'HOAN_TAT',
  DA_HUY: 'DA_HUY',
} as const;

export type FundMoveStatus = (typeof FUND_MOVE_STATUS)[keyof typeof FUND_MOVE_STATUS];

// Hũ tiết kiệm (bảng hu_tiet_kiem, migration 0004): khai báo tài sản có sẵn / bỏ vào / lấy ra
export const SAVINGS_DIRECTION = {
  KHAI_BAO: 'KHAI_BAO',
  NOP: 'NOP',
  RUT: 'RUT',
} as const;

export type SavingsDirection = (typeof SAVINGS_DIRECTION)[keyof typeof SAVINGS_DIRECTION];

export const ASSET_TYPE = {
  TIEN: 'TIEN',
  VANG: 'VANG',
} as const;

export type AssetType = (typeof ASSET_TYPE)[keyof typeof ASSET_TYPE];

// Nhóm tiền mặt làm nguồn / đích của hũ (không có CHUA_XAC_DINH)
export type SavingsSourceId = 'VO' | 'CHONG' | 'QUY_CHUNG';

// Hũ mặc định (seed migration 0005): câu không nêu tên hũ → hũ này
export const DEFAULT_JAR_ID = 'TIET_KIEM';

// Chiều của giao dịch DIEU_CHINH (migration 0002)
export const ADJUSTMENT_DIRECTION = {
  TANG: 'TANG',
  GIAM: 'GIAM',
} as const;

export type AdjustmentDirection = (typeof ADJUSTMENT_DIRECTION)[keyof typeof ADJUSTMENT_DIRECTION];

// Hạn trả lời yêu cầu xác nhận (Q5)
export const CONFIRMATION_EXPIRY_DAYS = 7;

export const AUDIT_ACTION = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  CANCEL: 'CANCEL',
  CONFIRM: 'CONFIRM',
  ARCHIVE: 'ARCHIVE',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

export const TABLE_NAME = {
  THANH_VIEN: 'thanh_vien',
  SO_DU_BAN_DAU: 'so_du_ban_dau',
  DOI_TUONG_THU_HUONG: 'doi_tuong_thu_huong',
  TU_KHOA_DOI_TUONG: 'tu_khoa_doi_tuong',
  DANH_MUC: 'danh_muc',
  TU_KHOA_DANH_MUC: 'tu_khoa_danh_muc',
  TIN_NHAN_GOC: 'tin_nhan_goc',
  KHOAN_NO: 'khoan_no',
  GIAO_DICH: 'giao_dich',
  PHAN_BO_GIAO_DICH: 'phan_bo_giao_dich',
  CHUYEN_TIEN_NOI_BO: 'chuyen_tien_noi_bo',
  CHUYEN_QUY_CHUNG: 'chuyen_quy_chung',
  HU_TIET_KIEM: 'hu_tiet_kiem',
  HU: 'hu',
  LICH_SU_NO: 'lich_su_no',
  YEU_CAU_XAC_NHAN: 'yeu_cau_xac_nhan',
  LICH_SU_CHINH_SUA: 'lich_su_chinh_sua',
  DONG_BO: 'dong_bo',
  ARCHIVE_MANIFEST: 'archive_manifest',
} as const;

export type TableName = (typeof TABLE_NAME)[keyof typeof TABLE_NAME];

export const CONFIRMATION_TYPE = {
  CHUYEN_TIEN: 'CHUYEN_TIEN',
  NGUOI_GIU_TIEN: 'NGUOI_GIU_TIEN',
  DANH_MUC_MOI: 'DANH_MUC_MOI',
  DOI_TUONG_MOI: 'DOI_TUONG_MOI',
  PHAN_BO: 'PHAN_BO',
  GIAO_DICH_MO_HO: 'GIAO_DICH_MO_HO',
} as const;

export type ConfirmationType = (typeof CONFIRMATION_TYPE)[keyof typeof CONFIRMATION_TYPE];

export const CATEGORY_CODE = {
  LUONG: 'LUONG',
  OT: 'OT',
  THUONG: 'THUONG',
  KINH_DOANH: 'KINH_DOANH',
  TIEN_DUOC_CHO: 'TIEN_DUOC_CHO',
  QUA_TANG: 'QUA_TANG',
  THU_HOI_NO: 'THU_HOI_NO',
  NO_CUA_ANH: 'NO_CUA_ANH',
  THU_KHAC: 'THU_KHAC',
  LAI_CHO_VAY: 'LAI_CHO_VAY',
  THUC_AN: 'THUC_AN',
  DI_CHO: 'DI_CHO',
  SUA: 'SUA',
  HOC_PHI: 'HOC_PHI',
  HOC_THEM: 'HOC_THEM',
  Y_TE: 'Y_TE',
  THUOC: 'THUOC',
  DIEN: 'DIEN',
  NUOC: 'NUOC',
  INTERNET: 'INTERNET',
  NHA_CUA: 'NHA_CUA',
  DI_LAI: 'DI_LAI',
  MUA_SAM: 'MUA_SAM',
  GIAI_TRI: 'GIAI_TRI',
  CHI_KHAC: 'CHI_KHAC',
} as const;

export type CategoryCode = (typeof CATEGORY_CODE)[keyof typeof CATEGORY_CODE];

export interface CategoryDefinition {
  code: CategoryCode;
  name: string;
  scope: CategoryScope;
  keywords: readonly string[];
}

export const DEFAULT_CATEGORIES: readonly CategoryDefinition[] = [
  {
    code: CATEGORY_CODE.LUONG,
    name: 'Lương',
    scope: CATEGORY_SCOPE.THU,
    keywords: ['lương', 'luong', 'tiền lương', 'tien luong'],
  },
  {
    code: CATEGORY_CODE.OT,
    name: 'OT',
    scope: CATEGORY_SCOPE.THU,
    keywords: ['ot', 'tiền ot', 'tien ot', 'làm thêm giờ', 'lam them gio'],
  },
  {
    code: CATEGORY_CODE.THUONG,
    name: 'Thưởng',
    scope: CATEGORY_SCOPE.THU,
    keywords: ['tiền thưởng', 'tien thuong', 'thưởng', 'thuong'],
  },
  {
    code: CATEGORY_CODE.KINH_DOANH,
    name: 'Kinh doanh',
    scope: CATEGORY_SCOPE.THU,
    keywords: ['kinh doanh', 'bán hàng', 'ban hang'],
  },
  {
    code: CATEGORY_CODE.TIEN_DUOC_CHO,
    name: 'Tiền được cho',
    scope: CATEGORY_SCOPE.THU,
    keywords: ['tiền được cho', 'tien duoc cho', 'được biếu', 'duoc bieu'],
  },
  {
    code: CATEGORY_CODE.QUA_TANG,
    name: 'Quà tặng',
    scope: CATEGORY_SCOPE.CA_HAI,
    keywords: ['tiền quà', 'tien qua', 'quà tặng', 'qua tang', 'mua quà', 'mua qua'],
  },
  {
    code: CATEGORY_CODE.THU_HOI_NO,
    name: 'Thu hồi nợ',
    scope: CATEGORY_SCOPE.THU,
    keywords: ['thu hồi nợ', 'thu hoi no', 'đòi nợ', 'doi no'],
  },
  {
    code: CATEGORY_CODE.NO_CUA_ANH,
    name: 'Nợ của anh',
    scope: CATEGORY_SCOPE.CA_HAI,
    keywords: ['nợ của a', 'no cua a', 'nợ của anh', 'no cua anh'],
  },
  {
    code: CATEGORY_CODE.LAI_CHO_VAY,
    name: 'Lãi cho vay',
    scope: CATEGORY_SCOPE.THU,
    keywords: ['lãi cho vay', 'lai cho vay', 'tiền lãi cho vay', 'tien lai cho vay'],
  },
  {
    code: CATEGORY_CODE.THU_KHAC,
    name: 'Thu khác',
    scope: CATEGORY_SCOPE.THU,
    keywords: ['thu khác', 'thu khac', 'lãi tiết kiệm', 'lai tiet kiem', 'lãi ngân hàng', 'lai ngan hang'],
  },
  {
    code: CATEGORY_CODE.THUC_AN,
    name: 'Thức ăn',
    scope: CATEGORY_SCOPE.CHI,
    keywords: [
      'mua đồ ăn',
      'mua do an',
      'tiền ăn',
      'tien an',
      'ăn uống',
      'an uong',
      'đồ ăn',
      'do an',
      'ăn sáng',
      'an sang',
      'ăn trưa',
      'an trua',
      'ăn tối',
      'an toi',
    ],
  },
  {
    code: CATEGORY_CODE.DI_CHO,
    name: 'Đi chợ',
    scope: CATEGORY_SCOPE.CHI,
    keywords: ['đi chợ', 'di cho', 'tiền chợ', 'tien cho'],
  },
  {
    code: CATEGORY_CODE.SUA,
    name: 'Sữa',
    scope: CATEGORY_SCOPE.CHI,
    keywords: ['mua sữa', 'mua sua', 'tiền sữa', 'tien sua', 'sữa', 'sua'],
  },
  {
    code: CATEGORY_CODE.HOC_PHI,
    name: 'Học phí',
    scope: CATEGORY_SCOPE.CHI,
    keywords: ['đóng học phí', 'dong hoc phi', 'học phí', 'hoc phi', 'tiền học', 'tien hoc'],
  },
  {
    code: CATEGORY_CODE.HOC_THEM,
    name: 'Học thêm',
    scope: CATEGORY_SCOPE.CHI,
    keywords: ['học thêm', 'hoc them', 'tiền học thêm', 'tien hoc them'],
  },
  {
    code: CATEGORY_CODE.Y_TE,
    name: 'Y tế',
    scope: CATEGORY_SCOPE.CHI,
    keywords: ['khám bệnh', 'kham benh', 'viện phí', 'vien phi', 'y tế', 'y te'],
  },
  {
    code: CATEGORY_CODE.THUOC,
    name: 'Thuốc',
    scope: CATEGORY_SCOPE.CHI,
    keywords: ['mua thuốc', 'mua thuoc', 'tiền thuốc', 'tien thuoc', 'thuốc men', 'thuoc men'],
  },
  {
    code: CATEGORY_CODE.DIEN,
    name: 'Điện',
    scope: CATEGORY_SCOPE.CHI,
    keywords: ['tiền điện', 'tien dien'],
  },
  {
    code: CATEGORY_CODE.NUOC,
    name: 'Nước',
    scope: CATEGORY_SCOPE.CHI,
    keywords: ['tiền nước', 'tien nuoc'],
  },
  {
    code: CATEGORY_CODE.INTERNET,
    name: 'Internet',
    scope: CATEGORY_SCOPE.CHI,
    keywords: ['tiền mạng', 'tien mang', 'tiền internet', 'tien internet', 'internet', 'wifi'],
  },
  {
    code: CATEGORY_CODE.NHA_CUA,
    name: 'Nhà cửa',
    scope: CATEGORY_SCOPE.CHI,
    keywords: ['tiền nhà', 'tien nha', 'nhà cửa', 'nha cua', 'phí dịch vụ', 'phi dich vu'],
  },
  {
    code: CATEGORY_CODE.DI_LAI,
    name: 'Đi lại',
    scope: CATEGORY_SCOPE.CHI,
    keywords: [
      'tiền gửi xe',
      'tien gui xe',
      'gửi xe',
      'gui xe',
      'đổ xăng',
      'do xang',
      'tiền xăng',
      'tien xang',
      'đi lại',
      'di lai',
      'taxi',
    ],
  },
  {
    code: CATEGORY_CODE.MUA_SAM,
    name: 'Mua sắm',
    scope: CATEGORY_SCOPE.CHI,
    keywords: ['mua sắm', 'mua sam', 'mua quần áo', 'mua quan ao', 'mua đồ', 'mua do'],
  },
  {
    code: CATEGORY_CODE.GIAI_TRI,
    name: 'Giải trí',
    scope: CATEGORY_SCOPE.CHI,
    keywords: ['giải trí', 'giai tri', 'du lịch', 'du lich', 'đi chơi', 'di choi'],
  },
  {
    code: CATEGORY_CODE.CHI_KHAC,
    name: 'Chi khác',
    scope: CATEGORY_SCOPE.CHI,
    keywords: ['chi khác', 'chi khac'],
  },
];

