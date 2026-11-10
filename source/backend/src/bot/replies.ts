import type { MemberId, MoneyHolderId, TransactionType } from '../config/constants.ts';
import type { ChuyenQuyChungRecord, ChuyenTienNoiBoRecord, DanhMucRecord, GiaoDichRecord, HuRecord, HuTietKiemRecord } from '../db/types.ts';
import { goldPricePerChi, goldValue, pricePerChi, type GoldPrice, type SavingsSummary } from '../services/savings-service.ts';
import type { InlineKeyboard } from '../telegram/types.ts';
import { categoryCodeFits, encodeCallback } from './callback-data.ts';

// ---------- Định dạng ----------

export function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}${String(Math.abs(Math.round(amount))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;
}

// Vàng: 5 phân → "0,5 chỉ"; 120 phân → "12 chỉ (1,2 lượng)"
export function formatGold(phan: number): string {
  const num = (v: number): string => String(Number(v.toFixed(2))).replace('.', ',');
  const chi = `${num(phan / 10)} chỉ`;
  return Math.abs(phan) >= 100 ? `${chi} (${num(phan / 100)} lượng)` : chi;
}

// Tiền + vàng: "5.000.000đ + vàng 2 chỉ (≈ 28.000.000đ)"
export function assetText(tien: number, vangPhan: number, vangGiaTri: number | null): string {
  if (vangPhan === 0) {
    return formatMoney(tien);
  }
  return `${formatMoney(tien)} + vàng ${formatGold(vangPhan)} (${vangGiaTri === null ? 'chưa định giá' : `≈ ${formatMoney(vangGiaTri)}`})`;
}

const GOLD_PRICE_SOURCE: Record<GoldPrice['nguon'], string> = {
  THI_TRUONG: 'nhập bằng /giavang',
  MUA_BAN: 'theo lần mua/bán gần nhất',
  KHAI_BAO: 'theo lần khai báo gần nhất',
};

export function goldPriceLine(gia: GoldPrice | null): string[] {
  return gia ? [`Giá vàng ${GOLD_PRICE_SOURCE[gia.nguon]}: ${formatMoney(goldPricePerChi(gia))}/chỉ (${formatDay(gia.ngay)})`] : [];
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

// jarName: khoản chi trả từ hũ (B)
export function transactionText(tx: GiaoDichRecord, categoryName: string | null, chonDanhMuc = false, jarName: string | null = null): string {
  const line = `${transactionLine(tx, categoryName)}${jarName ? ` · từ hũ ${jarName}` : ''}`;
  if (tx.trang_thai === 'DA_HUY') {
    return `❌ Đã huỷ: ${line}`;
  }
  const hint = chonDanhMuc ? '\nChọn danh mục nếu muốn (không chọn → giữ nguyên).' : '';
  return `✅ ${line}${hint}`;
}

export function cancelButton(kind: 'gd' | 'ct' | 'qc' | 'hk', id: string, label = 'Huỷ'): InlineKeyboard {
  return [[{ text: label, callback_data: encodeCallback({ kind, id }) }]];
}

// Q4: 3 nút/hàng + đổi Thu↔Chi + Huỷ
// typeSwitch = false: khoản chi trả từ hũ — không cho đổi sang Thu
export function categoryKeyboard(tx: GiaoDichRecord, categories: readonly DanhMucRecord[], typeSwitch = true): InlineKeyboard {
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
  if (typeSwitch) {
    const to = tx.loai_giao_dich === 'THU' ? 'CHI' : 'THU';
    rows.push([{ text: `Đổi sang ${to === 'THU' ? 'Thu' : 'Chi'}`, callback_data: encodeCallback({ kind: 'lt', id: tx.id, to }) }]);
  }
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

// Rút quỹ chung đưa thẳng cho người kia (nhom_id khác người ghi)
export function fundToOther(f: ChuyenQuyChungRecord): boolean {
  return f.chieu === 'RUT' && f.nhom_id !== f.thanh_vien_id;
}

export function fundText(f: ChuyenQuyChungRecord, overBalance: boolean): string {
  const action = f.chieu === 'NOP' ? 'Nộp quỹ chung' : fundToOther(f) ? `Rút quỹ chung đưa ${memberName(f.nhom_id).toLowerCase()}` : 'Rút quỹ chung';
  const prefix = f.trang_thai === 'DA_HUY' ? '❌ Đã huỷ: ' : '✅ ';
  const warn = overBalance ? '\n⚠️ Số tiền lớn hơn số đang có — kiểm tra lại.' : '';
  return `${prefix}${action} ${formatMoney(Number(f.so_tien))} · ${formatDay(f.ngay_chuyen)}${warn}`;
}

// "rút quỹ chung 1.000.000đ đưa vợ (05/11)" / "nộp vào quỹ chung 2.000.000đ (05/11)"
function fundNoticeBody(f: ChuyenQuyChungRecord): string {
  const money = formatMoney(Number(f.so_tien));
  if (fundToOther(f)) {
    return `rút quỹ chung ${money} đưa ${memberName(f.nhom_id).toLowerCase()} (${formatDay(f.ngay_chuyen)})`;
  }
  return `${f.chieu === 'NOP' ? 'nộp vào' : 'rút từ'} quỹ chung ${money} (${formatDay(f.ngay_chuyen)})`;
}

export function fundNoticeText(f: ChuyenQuyChungRecord): string {
  const credited = fundToOther(f) ? ` — đã cộng vào tiền của ${memberName(f.nhom_id).toLowerCase()}` : '';
  return `ℹ️ ${memberName(f.thanh_vien_id)} ${fundNoticeBody(f)}${credited}.`;
}

export function fundCancelNoticeText(f: ChuyenQuyChungRecord, nguoiHuy: string): string {
  return `ℹ️ ${memberName(nguoiHuy)} đã huỷ: ${fundNoticeBody(f)}.`;
}

// ---------- Số dư (dùng chung /sodu và câu hỏi số dư) ----------

// Từng nhóm tiền mặt + tổng; có hũ (tiền / vàng) thì thêm dòng hũ và tổng tài sản (ước tính)
export function balanceSummaryLines(
  nhom: Record<MoneyHolderId, number>,
  tong: number,
  asOf: string,
  hu: Pick<SavingsSummary, 'tien' | 'vangPhan' | 'vangGiaTri'>,
): string[] {
  const holders: MoneyHolderId[] = ['VO', 'CHONG', 'QUY_CHUNG', 'CHUA_XAC_DINH'];
  const lines = [
    `💰 Số dư đến ${formatDay(asOf)}:`,
    ...holders.filter((h) => h !== 'CHUA_XAC_DINH' || nhom[h] !== 0).map((h) => `• ${HOLDER_NAME[h]}: ${formatMoney(nhom[h])}`),
  ];
  if (hu.tien === 0 && hu.vangPhan === 0) {
    return [...lines, `Tổng: ${formatMoney(tong)}`];
  }
  const unpriced = hu.vangPhan !== 0 && hu.vangGiaTri === null ? ' (chưa tính vàng chưa định giá)' : '';
  return [
    ...lines,
    `Tiền mặt: ${formatMoney(tong)}`,
    `🏺 Hũ tiết kiệm: ${assetText(hu.tien, hu.vangPhan, hu.vangGiaTri)}`,
    `Tổng tài sản (ước tính): ${formatMoney(tong + hu.tien + (hu.vangGiaTri ?? 0))}${unpriced}`,
  ];
}

// ---------- Hũ tiết kiệm ----------

const SAVINGS_VERB: Record<string, string> = {
  KHAI_BAO: 'khai báo',
  NOP: 'bỏ',
  RUT: 'lấy ra từ',
};

const GOLD_VERB: Record<string, string> = { KHAI_BAO: 'khai báo vàng', NOP: 'mua vàng', RUT: 'bán vàng' };

// "bỏ hũ Mua nhà" / "Bỏ hũ Mua nhà" / "Mua vàng 2 chỉ vào hũ Tiết kiệm"
function savingsAction(f: HuTietKiemRecord, jar: HuRecord, capital: boolean): string {
  const gold = f.loai_tai_san === 'VANG';
  const verb = (gold ? GOLD_VERB : SAVINGS_VERB)[f.chieu] ?? f.chieu;
  const head = capital ? verb.charAt(0).toUpperCase() + verb.slice(1) : verb;
  return gold ? `${head} ${formatGold(Number(f.so_luong_phan))} ${f.chieu === 'RUT' ? 'từ' : 'vào'} hũ ${jar.ten}` : `${head} hũ ${jar.ten}`;
}

// " 28.000.000đ (14.000.000đ/chỉ)" — đơn giá khi vàng khác 1 chỉ
function savingsAmount(f: HuTietKiemRecord): string {
  if (f.so_tien === null) {
    return '';
  }
  const phan = Number(f.so_luong_phan);
  const unit = f.loai_tai_san === 'VANG' && phan !== 10 ? ` (${formatMoney(pricePerChi(Number(f.so_tien), phan))}/chỉ)` : '';
  return ` ${formatMoney(Number(f.so_tien))}${unit}`;
}

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

// giaThamChieu: đơn giá vàng lệch xa giá đang dùng (đồng/chỉ) → cảnh báo gõ nhầm
export function savingsText(f: HuTietKiemRecord, jar: HuRecord, overBalance: boolean, giaThamChieu: number | null = null): string {
  const prefix = f.trang_thai === 'DA_HUY' ? '❌ Đã huỷ: ' : '🏺 ';
  const gold = f.loai_tai_san === 'VANG';
  const warn = !overBalance
    ? ''
    : f.chieu === 'RUT'
      ? gold
        ? '\n⚠️ Bán nhiều hơn số vàng đang có trong hũ — kiểm tra lại.'
        : '\n⚠️ Lấy ra nhiều hơn số đang có trong hũ — kiểm tra lại.'
      : '\n⚠️ Số tiền lớn hơn số đang giữ — kiểm tra lại.';
  const price =
    giaThamChieu && f.trang_thai !== 'DA_HUY'
      ? `\n⚠️ Giá này lệch xa giá đang dùng ${formatMoney(giaThamChieu)}/chỉ — gõ đúng chưa? Sai thì bấm Huỷ rồi nhắn lại.`
      : '';
  const note =
    f.chieu === 'KHAI_BAO' && !gold && f.trang_thai !== 'DA_HUY'
      ? '\nLưu ý: tiền này không được nằm sẵn trong số dư ban đầu của vợ/chồng/quỹ (sẽ bị tính 2 lần).'
      : '';
  return `${prefix}${savingsAction(f, jar, true)}${savingsAmount(f)} · ${savingsSource(f)} · ${formatDay(f.ngay)}${warn}${price}${note}`;
}

// "bỏ hũ Mua nhà 1.000.000đ (vợ trả, 05/11)." — dùng cho tin báo ghi và báo huỷ
function savingsNoticeBody(f: HuTietKiemRecord, jar: HuRecord): string {
  return `${savingsAction(f, jar, false)}${savingsAmount(f)} (${savingsSource(f)}, ${formatDay(f.ngay)}).`;
}

export function savingsNoticeText(f: HuTietKiemRecord, jar: HuRecord): string {
  return `ℹ️ ${memberName(f.thanh_vien_id)}: ${savingsNoticeBody(f, jar)}`;
}

export function savingsCancelNoticeText(f: HuTietKiemRecord, jar: HuRecord, nguoiHuy: string): string {
  return `ℹ️ ${memberName(nguoiHuy)} đã huỷ: ${savingsNoticeBody(f, jar)}`;
}

// Báo người kia: khoản chi trả từ hũ chung
export function jarExpenseNoticeText(tx: GiaoDichRecord, jar: HuRecord, by: string): string {
  return `ℹ️ ${memberName(by)}: chi ${formatMoney(Number(tx.so_tien))} từ hũ ${jar.ten} (${formatDay(tx.ngay_giao_dich)}).`;
}

// /tietkiem: từng hũ (tiền + vàng, % mục tiêu tính cả vàng đã định giá) + tổng + giá vàng đang dùng
export function jarListLines(s: SavingsSummary, asOf: string): string[] {
  const lines = s.rows.map(({ jar, tien, vangPhan }) => {
    const vang = goldValue(vangPhan, s.gia);
    const value = tien + (vang ?? 0);
    const goal = jar.muc_tieu ? ` / ${formatMoney(jar.muc_tieu)} (${Math.floor((Math.max(value, 0) * 100) / jar.muc_tieu)}%)` : '';
    return `• ${jar.ten}: ${assetText(tien, vangPhan, vang)}${goal}`;
  });
  const hasGold = s.vangPhan !== 0;
  const total = `${hasGold ? '≈ ' : ''}${formatMoney(s.tien + (s.vangGiaTri ?? 0))}${hasGold && s.vangGiaTri === null ? ' (chưa tính vàng)' : ''}`;
  return [`🏺 Hũ đến ${formatDay(asOf)}:`, ...lines, `Tổng hũ: ${total}`, ...goldPriceLine(hasGold ? s.gia : null)];
}

// ---------- Bỏ qua / hướng dẫn ----------

const IGNORED_TEXT: Record<string, string> = {
  GHI_CHU_NO: '📝 Đã lưu ghi chú nợ (không tính vào số dư). Xem: /ghichu',
  THIEU_SO_TIEN: "Chưa rõ số tiền — nhắn lại đầy đủ, vd 'tiền ăn 50k'.",
  SO_TIEN_MO_HO: "Số tiền chưa rõ (có 2 số) — nhắn lại 1 số, vd 'tiền ăn 50k'.",
  THIEU_HOAC_MO_HO_SO_TIEN: "Chưa rõ số tiền chuyển — nhắn lại, vd 'chuyển vợ 3tr'.",
  DIEU_CHINH_CHUA_HO_TRO_CHAT: 'Điều chỉnh số dư chưa làm được qua chat.',
  CHU_NGU_KHAC_NGUOI_GUI: 'Chỉ ghi được khoản do chính bạn chuyển — người kia tự nhắn nhé.',
  CHUYEN_TU_QUY_CHUNG: "Chưa rõ tiền đi đâu — nhắn 'chuyển vợ 2tr từ quỹ chung' (quỹ → vợ) hoặc 'bỏ vào quỹ chung 2tr'.",
  CO_NGUOI_NHAN: "Nộp quỹ chung không có người nhận — nhắn 'bỏ vào quỹ chung 2tr'; đưa tiền quỹ cho vợ: 'rút quỹ chung cho vợ 2tr'.",
  TU_CHUYEN_CHO_MINH: 'Không chuyển cho chính mình được.',
  NGAY_TUONG_LAI: 'Ngày trong tương lai — chưa ghi.',
  NGUOI_CHUYEN_KHONG_HOP_LE: 'Tài khoản này không chuyển tiền được.',
  NGUOI_NHAN_KHONG_HOP_LE: 'Người nhận không hợp lệ.',
  NGUOI_GUI_KHONG_HOP_LE: 'Tài khoản này không ghi quỹ chung được.',
  HU_NGUOI_GUI_KHONG_HOP_LE: 'Tài khoản này không ghi hũ tiết kiệm được.',
  HU_KHONG_CO: 'Chưa có hũ tên này. Xem các hũ: /tietkiem · tạo hũ: /taohu <tên> [mục tiêu], vd /taohu Mua nhà 2 tỷ',
  HU_CHI_HO_TRO_CHI: 'Chỉ khoản chi mới trả từ hũ được.',
  HU_NGUON_KHONG_RO: "Chưa rõ tiền lấy từ đâu — nhắn 'lấy quỹ chung bỏ hũ 2tr' hoặc 'bỏ hũ 2tr' (trừ tiền của bạn).",
  VANG_THIEU_SO_LUONG: "Mấy chỉ vàng? Nhắn lại kèm số lượng, vd 'mua vàng 1 chỉ 14tr' (chỉ / phân / lượng).",
  VANG_LE_QUA_NHO: "Số lượng vàng lẻ hơn 1 phân — nhắn theo chỉ / phân, vd 'mua vàng 2 phân 3tr'.",
  VANG_SO_LUONG_MO_HO: "Có nhiều số lượng vàng — nhắn lại 1 số, vd 'mua vàng 2 chỉ 28tr'.",
  VANG_SO_TIEN_MO_HO: "Số tiền chưa rõ — nhắn tổng tiền ('mua vàng 2 chỉ 28tr') hoặc giá 1 chỉ ('mua vàng 2 chỉ 14tr/chỉ').",
  VANG_BAN_THIEU_TIEN: "Bán được bao nhiêu? Nhắn lại, vd 'bán vàng 1 chỉ 15tr' (tiền về bạn) hoặc 'bán vàng 1 chỉ 15tr bỏ quỹ chung'.",
  VANG_TU_HU: "Chưa hỗ trợ đổi tiền trong hũ sang vàng — nhắn 2 tin: 'rút hũ 28tr' rồi 'mua vàng 2 chỉ 28tr'.",
  VANG_CHON_HU: "Vàng đang ở nhiều hũ — ghi rõ hũ, vd 'bán vàng 1 chỉ 15tr từ hũ mua nhà'.",
  VANG_NGUON_KHONG_RO: "Chưa rõ tiền quỹ chung đi đâu — nhắn 'lấy quỹ chung mua vàng 1 chỉ 14tr' hoặc 'bán vàng 1 chỉ 15tr bỏ quỹ chung'.",
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
  '• mua vàng 1 chỉ 14tr · bán vàng 1 chỉ 15tr · /giavang 15tr — giá vàng hôm nay (1 chỉ)',
  '• chuyển vợ 2tr từ quỹ chung — quỹ chung đưa thẳng cho vợ',
  'Hỏi:',
  '• tháng này vợ chi bao nhiêu · chi tiền học năm nay',
  '• gia đình còn bao nhiêu · chi theo danh mục tháng trước',
  'Lệnh:',
  '/sodu — số dư từng người',
  '/tuan, /thang — tổng hợp tuần / tháng này (thêm "trước", "vợ", "chồng": /tuan trước vợ)',
  'Xem từng khoản: "liệt kê chi tiết vợ chi tuần trước" (tối đa 31 ngày cuối kỳ)',
  '/cho — khoản chuyển đang chờ',
  '/ghichu — ghi chú nợ',
  '/sodudau <vợ> <chồng> <quỹ> — nhập số dư ban đầu (1 lần)',
  '/tietkiem — các hũ · /taohu <tên> [mục tiêu] — tạo hũ · /tietkiemdau <tiền | N chỉ vàng> [hũ] — khai báo tiền / vàng đang để dành',
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
