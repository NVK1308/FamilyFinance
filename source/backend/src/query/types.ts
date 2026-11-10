import type { BeneficiaryId, MemberId, MoneyHolderId, TransferStatus } from '../config/constants.ts';
import type { Period } from './period-parser.ts';

// 5b-1: TONG, SO_DU, THEO_DANH_MUC, THEO_DOI_TUONG, NO. 5b-2: LON_NHAT, AI_NHIEU_NHAT, SO_SANH, CHUYEN_TIEN, LIET_KE.
export type QueryKind =
  | 'TONG'
  | 'SO_DU'
  | 'THEO_DANH_MUC'
  | 'THEO_DOI_TUONG'
  | 'NO'
  | 'LON_NHAT'
  | 'AI_NHIEU_NHAT'
  | 'SO_SANH'
  | 'CHUYEN_TIEN'
  | 'LIET_KE'
  | 'HU_TIET_KIEM';

// TONG_QUAN = thu + chi + chênh lệch
export type QueryMeasure = 'THU' | 'CHI' | 'CHENH_LECH' | 'TONG_QUAN';

export interface QueryFilterSpec {
  // Người thực hiện (chủ ngữ "vợ chi"); null = cả hai
  performer: MemberId | null;
  // Đối tượng ("cho con gái"); "các con" = CON_GAI + CON_TRAI + CAC_CON
  beneficiaries: { ids: BeneficiaryId[]; label: string } | null;
  // Danh mục / nhóm danh mục ("tiền học" = HOC_PHI + HOC_THEM)
  categories: { codes: string[]; label: string } | null;
  // Người giữ tiền ("chi từ quỹ chung")
  holder: MoneyHolderId | null;
}

// Câu hỏi chuyển tiền nội bộ (5b-2)
export interface TransferQuerySpec {
  statuses: TransferStatus[];
  label: string;
  from: MemberId | null;
  to: MemberId | null;
  // true = liệt kê từng khoản; false = chỉ tổng
  list: boolean;
}

export interface QuerySpec extends QueryFilterSpec {
  kind: QueryKind;
  measure: QueryMeasure;
  period: Period;
  // SO_SANH: kỳ đem so (mặc định kỳ liền trước)
  comparePeriod?: Period;
  transfer?: TransferQuerySpec;
  // HU_TIET_KIEM: true = bỏ vào / lấy ra trong kỳ; không có = số dư hũ
  savingsFlow?: boolean;
  // LIET_KE: "chi tiết / tất cả" → mọi khoản trong kỳ (kỳ dài quá 31 ngày → 31 ngày cuối)
  fullList?: boolean;
  // HU_TIET_KIEM: tên hũ (ASCII) khi câu hỏi 1 hũ ("quỹ y tế còn bao nhiêu"); null = mọi hũ
  huTen?: string | null;
  // HU_TIET_KIEM + savingsFlow: chỉ dòng vàng (mua / bán vàng trong kỳ)
  vang?: boolean;
}
