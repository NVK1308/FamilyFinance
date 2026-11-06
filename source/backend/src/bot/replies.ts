import type { MemberId, MoneyHolderId, TransactionType } from '../config/constants.ts';
import type { ChuyenQuyChungRecord, ChuyenTienNoiBoRecord, DanhMucRecord, GiaoDichRecord, HuTietKiemRecord } from '../db/types.ts';
import type { InlineKeyboard } from '../telegram/types.ts';
import { categoryCodeFits, encodeCallback } from './callback-data.ts';

// ---------- Định dạng ----------

export function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}${String(Math.abs(Math.round(amount))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;
}

// '2026-11-05' → '05/11'
export function formatDay(date: string): string {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

const MEMBER_NAME: Record<MemberId, string> = { VO: 'Vợ', CHONG: 'Chồng' };

export function memberName(id: string): string {
  return MEMBER_NAME[id as MemberId] ?? id;
}

// Nói theo hành động: khoản chi → ai trả (tiền ra từ nhóm nào), khoản thu → ai nhận (tiền vào nhóm nào)
const PAID_BY: Record<MoneyHolderId, string> = {
  VO: 'vợ trả',
  CHONG: 'chồng trả',
  QUY_CHUNG: 'trả từ quỹ chung',
  CHUA_XAC_DINH: 'chưa rõ ai trả',
};
const RECEIVED_BY: Record<MoneyHolderId, string> = {
  VO: 'vợ nhận',
  CHONG: 'chồng nhận',
  QUY_CHUNG: 'vào quỹ chung',
  CHUA_XAC_DINH: 'chưa rõ ai nhận',
};
const HOLDER_LABEL: Record<MoneyHolderId, string> = {
  VO: 'tiền của vợ',
  CHONG: 'tiền của chồng',
  QUY_CHUNG: 'quỹ chung',
  CHUA_XAC_DINH: 'chưa rõ của ai',
};

function holderAction(loai: TransactionType, holder: MoneyHolderId): string {
  if (loai === 'CHI' || loai === 'PHI' || loai === 'LAI_VAY') {
    return PAID_BY[holder];
  }
  return loai === 'THU' ? RECEIVED_BY[holder] : HOLDER_LABEL[holder];
}

const HOLDER_NAME: Record<MoneyHolderId, string> = {
  VO: 'Vợ',
  CHONG: 'Chồng',
  QUY_CHUNG: 'Quỹ chung',
  CHUA_XAC_DINH: 'Chưa rõ',
};

const TYPE_LABEL: Record<TransactionType, string> = {
  THU: 'Thu',
  CHI: 'Chi',
  VAY: 'Vay',
  TRA_NO: 'Trả nợ',
  LAI_VAY: 'Lãi vay',
  PHI: 'Phí',
  DIEU_CHINH: 'Điều chỉnh',
};

// ---------- Giao dịch ----------

export function transactionLine(tx: GiaoDichRecord, categoryName: string | null): string {
  const parts = [`${TYPE_LABEL[tx.loai_giao_dich]} ${formatMoney(Number(tx.so_tien))}`];
  if (categoryName) {
    parts.push(categoryName);
  }
  if (tx.nguoi_giu_tien_id) {
    parts.push(holderAction(tx.loai_giao_dich, tx.nguoi_giu_tien_id));
  }
  parts.push(formatDay(tx.ngay_giao_dich));
  return parts.join(' · ');
}

export function transactionText(tx: GiaoDichRecord, categoryName: string | null, chonDanhMuc = false): string {
  if (tx.trang_thai === 'DA_HUY') {
    return `❌ Đã huỷ: ${transactionLine(tx, categoryName)}`;
  }
  const hint = chonDanhMuc ? '\nChọn danh mục nếu muốn (không chọn → giữ nguyên).' : '';
  return `✅ ${transactionLine(tx, categoryName)}${hint}`;
}

export function cancelButton(kind: 'gd' | 'ct' | 'qc' | 'hk', id: string, label = 'Huỷ'): InlineKeyboard {
  return [[{ text: label, callback_data: encodeCallback({ kind, id }) }]];
}

// Q4: 3 nút/hàng + đổi Thu↔Chi + Huỷ
export function categoryKeyboard(tx: GiaoDichRecord, categories: readonly DanhMucRecord[]): InlineKeyboard {
  const rows: InlineKeyboard = [];
  const usable = categories.filter((c) => categoryCodeFits(tx.id, c.ma_danh_muc));
  for (let i = 0; i < usable.length; i += 3) {
    rows.push(
      usable.slice(i, i + 3).map((c) => ({
        text: c.id === tx.danh_muc_id ? `• ${c.ten_danh_muc}` : c.ten_danh_muc,
        callback_data: encodeCallback({ kind: 'dm', id: tx.id, code: c.ma_danh_muc }),
      })),
    );
  }
  const to = tx.loai_giao_dich === 'THU' ? 'CHI' : 'THU';
  rows.push([{ text: `Đổi sang ${to === 'THU' ? 'Thu' : 'Chi'}`, callback_data: encodeCallback({ kind: 'lt', id: tx.id, to }) }]);
  rows.push(...cancelButton('gd', tx.id));
  return rows;
}

// ---------- Chuyển tiền / quỹ chung ----------

export function transferSenderText(t: ChuyenTienNoiBoRecord, overBalance: boolean): string {
  const base = `📤 Đã ghi chuyển ${formatMoney(Number(t.so_tien))} cho ${memberName(t.nguoi_nhan_id).toLowerCase()} (${formatDay(t.ngay_chuyen)}), chờ ${memberName(t.nguoi_nhan_id).toLowerCase()} xác nhận.`;
  return overBalance ? `${base}\n⚠️ Số chuyển lớn hơn số bạn đang giữ — kiểm tra lại.` : base;
}

export function transferReceiverText(t: ChuyenTienNoiBoRecord): string {
  return `💸 ${memberName(t.nguoi_chuyen_id)} chuyển bạn ${formatMoney(Number(t.so_tien))} (${formatDay(t.ngay_chuyen)}). Đã nhận chưa?`;
}

export function transferReceiverKeyboard(yeuCauId: string): InlineKeyboard {
  return [
    [
      { text: 'Đã nhận', callback_data: encodeCallback({ kind: 'yc', id: yeuCauId, accept: true }) },
      { text: 'Chưa nhận', callback_data: encodeCallback({ kind: 'yc', id: yeuCauId, accept: false }) },
    ],
  ];
}

const TRANSFER_STATUS_TEXT: Record<string, string> = {
  CHO_XAC_NHAN: 'đang chờ xác nhận',
  DA_XAC_NHAN: 'đã nhận ✅',
  DA_HUY: 'đã huỷ ❌',
  HET_HAN: 'đã hết hạn',
  TU_CHOI: 'bị từ chối',
};

// Tin của người nhận sau khi xử lý (sửa tin gốc theo trạng thái DB)
export function transferStateText(t: ChuyenTienNoiBoRecord, status?: string): string {
  const state = status ?? TRANSFER_STATUS_TEXT[t.trang_thai] ?? t.trang_thai;
  return `💸 ${memberName(t.nguoi_chuyen_id)} chuyển ${memberName(t.nguoi_nhan_id).toLowerCase()} ${formatMoney(Number(t.so_tien))} (${formatDay(t.ngay_chuyen)}): ${state}.`;
}

export function fundText(f: ChuyenQuyChungRecord, overBalance: boolean): string {
  const action = f.chieu === 'NOP' ? 'Nộp quỹ chung' : 'Rút quỹ chung';
  const prefix = f.trang_thai === 'DA_HUY' ? '❌ Đã huỷ: ' : '✅ ';
  const warn = overBalance ? '\n⚠️ Số tiền lớn hơn số đang có — kiểm tra lại.' : '';
  return `${prefix}${action} ${formatMoney(Number(f.so_tien))} · ${formatDay(f.ngay_chuyen)}${warn}`;
}

export function fundNoticeText(f: ChuyenQuyChungRecord): string {
  const action = f.chieu === 'NOP' ? 'nộp vào' : 'rút từ';
  return `ℹ️ ${memberName(f.thanh_vien_id)} ${action} quỹ chung ${formatMoney(Number(f.so_tien))} (${formatDay(f.ngay_chuyen)}).`;
}

// ---------- Số dư (dùng chung /sodu và câu hỏi số dư) ----------

// Từng nhóm tiền mặt + tổng; hũ ≠ 0 thì thêm dòng hũ và tổng tài sản (ước tính)
export function balanceSummaryLines(nhom: Record<MoneyHolderId, number>, tong: number, asOf: string, hu: number): string[] {
  const holders: MoneyHolderId[] = ['VO', 'CHONG', 'QUY_CHUNG', 'CHUA_XAC_DINH'];
  const lines = [
    `💰 Số dư đến ${formatDay(asOf)}:`,
    ...holders.filter((h) => h !== 'CHUA_XAC_DINH' || nhom[h] !== 0).map((h) => `• ${HOLDER_NAME[h]}: ${formatMoney(nhom[h])}`),
  ];
  if (hu === 0) {
    return [...lines, `Tổng: ${formatMoney(tong)}`];
  }
  return [
    ...lines,
    `Tiền mặt: ${formatMoney(tong)}`,
    `🏺 Hũ tiết kiệm: ${formatMoney(hu)}`,
    `Tổng tài sản (ước tính): ${formatMoney(tong + hu)}`,
  ];
}

// ---------- Hũ tiết kiệm ----------

const SAVINGS_ACTION: Record<string, string> = {
  KHAI_BAO: 'Khai báo hũ tiết kiệm',
  NOP: 'Bỏ hũ tiết kiệm',
  RUT: 'Lấy ra từ hũ tiết kiệm',
};

// "từ quỹ chung" / "vợ trả" (bỏ vào) — "vào quỹ chung" / "vợ nhận" (lấy ra)
function savingsSource(f: HuTietKiemRecord): string {
  if (!f.nguon_id) {
    return 'không trừ tiền ai';
  }
  const from = f.chieu === 'NOP';
  if (f.nguon_id === 'QUY_CHUNG') {
    return from ? 'từ quỹ chung' : 'vào quỹ chung';
  }
  return `${memberName(f.nguon_id).toLowerCase()} ${from ? 'trả' : 'nhận'}`;
}

export function savingsText(f: HuTietKiemRecord, overBalance: boolean): string {
  const prefix = f.trang_thai === 'DA_HUY' ? '❌ Đã huỷ: ' : '🏺 ';
  const amount = f.so_tien === null ? '' : ` ${formatMoney(Number(f.so_tien))}`;
  const warn = !overBalance
    ? ''
    : f.chieu === 'RUT'
      ? '\n⚠️ Lấy ra nhiều hơn số đang có trong hũ — kiểm tra lại.'
      : '\n⚠️ Số tiền lớn hơn số đang giữ — kiểm tra lại.';
  const note =
    f.chieu === 'KHAI_BAO' && f.trang_thai !== 'DA_HUY'
      ? '\nLưu ý: tiền này không được nằm sẵn trong số dư ban đầu của vợ/chồng/quỹ (sẽ bị tính 2 lần).'
      : '';
  return `${prefix}${SAVINGS_ACTION[f.chieu]}${amount} · ${savingsSource(f)} · ${formatDay(f.ngay)}${warn}${note}`;
}

// "bỏ hũ tiết kiệm 1.000.000đ (vợ trả, 05/11)." — dùng cho tin báo ghi và báo huỷ
function savingsNoticeBody(f: HuTietKiemRecord): string {
  const amount = f.so_tien === null ? '' : ` ${formatMoney(Number(f.so_tien))}`;
  return `${SAVINGS_ACTION[f.chieu]!.toLowerCase()}${amount} (${savingsSource(f)}, ${formatDay(f.ngay)}).`;
}

export function savingsNoticeText(f: HuTietKiemRecord): string {
  return `ℹ️ ${memberName(f.thanh_vien_id)}: ${savingsNoticeBody(f)}`;
}

export function savingsCancelNoticeText(f: HuTietKiemRecord, nguoiHuy: string): string {
  return `ℹ️ ${memberName(nguoiHuy)} đã huỷ: ${savingsNoticeBody(f)}`;
}

// ---------- Bỏ qua / hướng dẫn ----------

const IGNORED_TEXT: Record<string, string> = {
  GHI_CHU_NO: '📝 Đã lưu ghi chú nợ (không tính vào số dư). Xem: /ghichu',
  THIEU_SO_TIEN: "Chưa rõ số tiền — nhắn lại đầy đủ, vd 'tiền ăn 50k'.",
  SO_TIEN_MO_HO: "Số tiền chưa rõ (có 2 số) — nhắn lại 1 số, vd 'tiền ăn 50k'.",
  THIEU_HOAC_MO_HO_SO_TIEN: "Chưa rõ số tiền chuyển — nhắn lại, vd 'chuyển vợ 3tr'.",
  DIEU_CHINH_CHUA_HO_TRO_CHAT: 'Điều chỉnh số dư chưa làm được qua chat.',
  CHU_NGU_KHAC_NGUOI_GUI: 'Chỉ ghi được khoản do chính bạn chuyển — người kia tự nhắn nhé.',
  CHUYEN_TU_QUY_CHUNG: 'Chuyển từ quỹ chung cho người khác chưa hỗ trợ: rút quỹ trước rồi chuyển.',
  TU_CHUYEN_CHO_MINH: 'Không chuyển cho chính mình được.',
  NGAY_TUONG_LAI: 'Ngày trong tương lai — chưa ghi.',
  NGUOI_CHUYEN_KHONG_HOP_LE: 'Tài khoản này không chuyển tiền được.',
  NGUOI_NHAN_KHONG_HOP_LE: 'Người nhận không hợp lệ.',
  NGUOI_GUI_KHONG_HOP_LE: 'Tài khoản này không ghi quỹ chung được.',
  HU_NGUOI_GUI_KHONG_HOP_LE: 'Tài khoản này không ghi hũ tiết kiệm được.',
  HU_NGUON_KHONG_RO: "Chưa rõ tiền lấy từ đâu — nhắn 'lấy quỹ chung bỏ hũ 2tr' hoặc 'bỏ hũ 2tr' (trừ tiền của bạn).",
  DA_HUY: 'Khoản này đã huỷ.',
  HET_HAN: 'Khoản này đã hết hạn.',
  TU_CHOI: 'Khoản này đã bị từ chối.',
  LOI: 'Tin này bị lỗi lúc xử lý — nhắn lại sau.',
};

export function ignoredText(reason: string): string {
  return IGNORED_TEXT[reason] ?? `Chưa ghi được (${reason}).`;
}

export const HELP_TEXT = [
  'Nhắn khoản thu/chi như nói chuyện:',
  '• tiền ăn 50k · lương 20tr · cafe 30k',
  '• chuyển vợ 3tr · bỏ vào quỹ chung 2tr',
  '• bỏ hũ tiết kiệm 5tr · rút hũ tiết kiệm 2tr',
  'Hỏi:',
  '• tháng này vợ chi bao nhiêu · chi tiền học năm nay',
  '• gia đình còn bao nhiêu · chi theo danh mục tháng trước',
  'Lệnh:',
  '/sodu — số dư từng người',
  '/thang — tổng thu/chi tháng này',
  '/cho — khoản chuyển đang chờ',
  '/ghichu — ghi chú nợ',
  '/sodudau <vợ> <chồng> <quỹ> — nhập số dư ban đầu (1 lần)',
  '/tietkiem — hũ tiết kiệm · /tietkiemdau <tiền> — khai báo tiền đang để dành',
].join('\n');

export const SHORT_HELP = "Chưa hiểu tin này. Nhắn kiểu 'tiền ăn 50k', hoặc /help.";
// Xuất báo cáo HTML chưa có (Phase 6)
export const QUESTION_TEXT = 'Chưa xuất được báo cáo HTML — tạm dùng /thang, /sodu.';
export const EDITED_TEXT = 'Sửa tin không đổi bản ghi — bấm Huỷ dưới tin cũ rồi nhắn lại.';
export const ERROR_TEXT = '⚠️ Lỗi khi xử lý tin — nhắn lại sau ít phút.';
// Lỗi sau khi đã ghi: không bảo nhắn lại (sẽ ghi 2 lần)
export const DONE_BUT_ERROR_TEXT = '⚠️ Tin đã được ghi nhưng lỗi khi trả lời — đừng nhắn lại, kiểm tra bằng /thang hoặc /cho.';

export function holderName(id: MoneyHolderId): string {
  return HOLDER_NAME[id];
}
