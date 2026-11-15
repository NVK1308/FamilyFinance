-- ⚠️ CHỈ DÙNG CHO SQLite (app desktop / test). KHÔNG chạy trên Neon — Neon dùng temp/neon/10_khoan_dinh_ky.sql (bản Postgres).
-- =====================================================================
-- FamilyFinance v4.0 - Migration 0008 (SQLite)
-- Cùng nội dung bản Postgres: cấu hình + khoản định kỳ + theo dõi tin nhắc.
-- =====================================================================

CREATE TABLE IF NOT EXISTS cau_hinh (
    khoa TEXT PRIMARY KEY CHECK (length(khoa) BETWEEN 3 AND 64),
    gia_tri TEXT NOT NULL,
    mo_ta TEXT NULL,
    nguoi_cap_nhat_id TEXT NULL REFERENCES thanh_vien(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_cau_hinh_sync ON cau_hinh (version, khoa);

CREATE TABLE IF NOT EXISTS khoan_dinh_ky (
    id TEXT PRIMARY KEY,
    ten TEXT NOT NULL CHECK (length(ten) BETWEEN 1 AND 100),
    ten_chuan TEXT NOT NULL,
    loai_giao_dich TEXT NOT NULL CHECK (loai_giao_dich IN ('THU', 'CHI')),
    so_tien INTEGER NOT NULL CHECK (so_tien > 0),
    danh_muc_id TEXT NOT NULL REFERENCES danh_muc(id),
    nguoi_giu_tien_id TEXT NOT NULL CHECK (nguoi_giu_tien_id IN ('VO', 'CHONG', 'QUY_CHUNG')),
    ngay_trong_thang INTEGER NULL CHECK (ngay_trong_thang BETWEEN 1 AND 31),
    bat_dau_ky TEXT NOT NULL CHECK (length(bat_dau_ky) = 7 AND substr(bat_dau_ky, 5, 1) = '-'),
    nguoi_tao_id TEXT NOT NULL REFERENCES thanh_vien(id),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_khoan_dinh_ky_ten ON khoan_dinh_ky (ten_chuan) WHERE is_active = 1 AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_khoan_dinh_ky_sync ON khoan_dinh_ky (version, id);

CREATE TABLE IF NOT EXISTS khoan_dinh_ky_lan (
    id TEXT PRIMARY KEY,
    khoan_dinh_ky_id TEXT NOT NULL REFERENCES khoan_dinh_ky(id),
    ky TEXT NOT NULL CHECK (length(ky) = 7 AND substr(ky, 5, 1) = '-'),
    ngay_den_han TEXT NOT NULL,
    han_dong TEXT NOT NULL CHECK (han_dong >= ngay_den_han),
    loai_giao_dich TEXT NOT NULL CHECK (loai_giao_dich IN ('THU', 'CHI')),
    so_tien INTEGER NOT NULL CHECK (so_tien > 0),
    danh_muc_id TEXT NOT NULL REFERENCES danh_muc(id),
    nguoi_giu_tien_id TEXT NOT NULL CHECK (nguoi_giu_tien_id IN ('VO', 'CHONG', 'QUY_CHUNG')),
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('CHO', 'DA_GHI', 'BO_QUA', 'QUA_HAN', 'DA_DUNG')),
    giao_dich_id TEXT NULL REFERENCES giao_dich(id),
    so_lan_ghi INTEGER NOT NULL DEFAULT 0 CHECK (so_lan_ghi >= 0),
    nguoi_xu_ly_id TEXT NULL REFERENCES thanh_vien(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT NULL,
    UNIQUE (khoan_dinh_ky_id, ky)
);

CREATE INDEX IF NOT EXISTS idx_khoan_dinh_ky_lan_ky ON khoan_dinh_ky_lan (ky, trang_thai);
CREATE INDEX IF NOT EXISTS idx_khoan_dinh_ky_lan_giao_dich ON khoan_dinh_ky_lan (giao_dich_id) WHERE giao_dich_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_khoan_dinh_ky_lan_sync ON khoan_dinh_ky_lan (version, id);

CREATE TABLE IF NOT EXISTS nhac_dinh_ky (
    id TEXT PRIMARY KEY,
    ky TEXT NOT NULL CHECK (length(ky) = 7 AND substr(ky, 5, 1) = '-'),
    thanh_vien_id TEXT NOT NULL REFERENCES thanh_vien(id),
    lan_nhac INTEGER NOT NULL CHECK (lan_nhac IN (1, 2)),
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('DANG_GUI', 'DA_GUI', 'LOI')),
    ngay_thu TEXT NOT NULL,
    so_lan_thu INTEGER NOT NULL DEFAULT 1 CHECK (so_lan_thu > 0),
    telegram_message_id INTEGER NULL,
    gui_luc TEXT NULL,
    loi TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (ky, thanh_vien_id, lan_nhac)
);

INSERT INTO cau_hinh (khoa, gia_tri, mo_ta) VALUES
    ('dinh_ky.ngay_nhac', '2', 'Ngày trong tháng gửi tin nhắc khoản định kỳ (1-28)'),
    ('dinh_ky.gio_nhac', '20', 'Giờ gửi tin nhắc khoản định kỳ, giờ VN (7-22; càng muộn càng ít lượt gửi bù trong ngày)'),
    ('dinh_ky.so_ngay_nhac_lai', '3', 'Số ngày sau lần nhắc đầu thì nhắc lại khoản còn chờ (0 = không nhắc lại)'),
    ('dinh_ky.so_ngay_dong', '10', 'Số ngày sau ngày nhắc chưa bấm thì tự đóng, không ghi (1-27)'),
    ('bao_cao.ngay_gui', '1', 'Ngày gửi báo cáo tháng trước (1-28)'),
    ('bao_cao.gio_gui', '20', 'Giờ gửi báo cáo tháng, giờ VN (7-22)'),
    ('bao_cao.so_ngay_gui_bu', '3', 'Số ngày được gửi bù báo cáo nếu lỗi, tính cả ngày gửi (1-7)')
ON CONFLICT (khoa) DO NOTHING;
