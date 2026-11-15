// Danh mục khoá cấu hình (bảng cau_hinh, migration 0008). Thêm khoá = thêm 1 dòng ở đây (+ seed tuỳ chọn).
// Giá trị trong DB thiếu / sai / ngoài giới hạn → dùng mặc định (bot không dừng vì cấu hình sai).

export interface SettingDef {
  min: number;
  max: number;
  def: number;
  moTa: string;
}

export const SETTING_DEFS = {
  'dinh_ky.ngay_nhac': { min: 1, max: 28, def: 2, moTa: 'Ngày trong tháng gửi tin nhắc khoản định kỳ' },
  'dinh_ky.gio_nhac': { min: 7, max: 22, def: 20, moTa: 'Giờ gửi tin nhắc khoản định kỳ (giờ VN; càng muộn càng ít lượt gửi bù)' },
  'dinh_ky.so_ngay_nhac_lai': { min: 0, max: 15, def: 3, moTa: 'Số ngày sau lần nhắc đầu thì nhắc lại khoản còn chờ (0 = không nhắc lại)' },
  'dinh_ky.so_ngay_dong': { min: 1, max: 27, def: 10, moTa: 'Số ngày sau ngày nhắc chưa bấm thì tự đóng, không ghi' },
  'bao_cao.ngay_gui': { min: 1, max: 28, def: 1, moTa: 'Ngày gửi báo cáo tháng trước' },
  'bao_cao.gio_gui': { min: 7, max: 22, def: 20, moTa: 'Giờ gửi báo cáo tháng (giờ VN)' },
  'bao_cao.so_ngay_gui_bu': { min: 1, max: 7, def: 3, moTa: 'Số ngày được gửi bù báo cáo nếu lỗi (tính cả ngày gửi)' },
  'ngan_sach.canh_bao_phan_tram': { min: 50, max: 99, def: 80, moTa: 'Báo khi chi một danh mục vượt bao nhiêu % ngân sách tháng (vượt 100% luôn báo)' },
} as const satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTING_DEFS;
export type Settings = Record<SettingKey, number>;

export const SETTING_KEYS = Object.keys(SETTING_DEFS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_DEFS, key);
}

export function defaultSettings(): Settings {
  const out = {} as Settings;
  for (const key of SETTING_KEYS) {
    out[key] = SETTING_DEFS[key].def;
  }
  return out;
}

// Số nguyên trong giới hạn của khoá; sai → null
export function parseSettingValue(key: SettingKey, raw: string): number | null {
  const text = raw.trim();
  if (!/^-?\d+$/.test(text)) {
    return null;
  }
  const value = Number(text);
  const def = SETTING_DEFS[key];
  return value >= def.min && value <= def.max ? value : null;
}

// Ràng buộc chéo giữa các khoá: mỗi cặp sai → trả các khoá của cặp đó + lý do
const CROSS_RULES: ReadonlyArray<{ keys: SettingKey[]; ok: (s: Settings) => boolean; reason: string }> = [
  {
    keys: ['bao_cao.ngay_gui', 'bao_cao.so_ngay_gui_bu'],
    ok: (s) => s['bao_cao.ngay_gui'] + s['bao_cao.so_ngay_gui_bu'] - 1 <= 28,
    reason: 'ngày gửi báo cáo + số ngày gửi bù phải trong ngày 28',
  },
  {
    keys: ['dinh_ky.so_ngay_nhac_lai', 'dinh_ky.so_ngay_dong'],
    ok: (s) => s['dinh_ky.so_ngay_nhac_lai'] === 0 || s['dinh_ky.so_ngay_nhac_lai'] < s['dinh_ky.so_ngay_dong'],
    reason: 'số ngày nhắc lại phải nhỏ hơn số ngày tự đóng (hoặc 0)',
  },
];

export function crossRuleError(s: Settings): string | null {
  return CROSS_RULES.find((r) => !r.ok(s))?.reason ?? null;
}

// Dòng DB → cấu hình dùng được + danh sách khoá đã thay bằng mặc định (để log)
export function resolveSettings(rows: ReadonlyArray<{ khoa: string; gia_tri: string }>): { values: Settings; invalid: string[] } {
  const values = defaultSettings();
  const invalid: string[] = [];
  for (const row of rows) {
    if (!isSettingKey(row.khoa)) {
      continue;
    }
    const v = parseSettingValue(row.khoa, String(row.gia_tri));
    if (v === null) {
      invalid.push(row.khoa);
    } else {
      values[row.khoa] = v;
    }
  }
  for (const rule of CROSS_RULES) {
    if (!rule.ok(values)) {
      for (const key of rule.keys) {
        values[key] = SETTING_DEFS[key].def;
        invalid.push(key);
      }
    }
  }
  return { values, invalid };
}
