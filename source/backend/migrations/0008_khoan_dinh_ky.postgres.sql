-- =====================================================================
-- FamilyFinance v4.0 - Migration 0008 (PostgreSQL / Neon)
-- Phase 7: bảng cấu hình (thông số lịch nhắc / báo cáo — sau này UI quản lý sửa)
-- + khoản định kỳ (khai báo, mỗi tháng 1 lần đến hạn, theo dõi gửi tin nhắc).
-- Chạy lại được (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- =====================================================================

BEGIN;

-- Cấu hình dạng khoá – giá trị. Danh mục khoá + kiểu + giới hạn + mặc định khai báo trong code
-- (src/config/settings.ts); thiếu / sai → dùng mặc định. Đồng bộ desktop.
CREATE TABLE IF NOT EXISTS cau_hinh (
    khoa TEXT PRIMARY KEY CHECK (length(khoa) BETWEEN 3 AND 64),
    gia_tri TEXT NOT NULL,
    mo_ta TEXT NULL,
    nguoi_cap_nhat_id TEXT NULL REFERENCES thanh_vien(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_cau_hinh_sync ON cau_hinh (version, khoa);

-- Khoản định kỳ hằng tháng (tiền điện, học phí, lương...). Dừng = is_active FALSE (giữ dòng).
CREATE TABLE IF NOT EXISTS khoan_dinh_ky (
    id TEXT PRIMARY KEY,
    ten TEXT NOT NULL CHECK (length(ten) BETWEEN 1 AND 100),
    -- Tên không dấu, chữ thường: gõ lại cùng tên = cập nhật khoản cũ
    ten_chuan TEXT NOT NULL,
    loai_giao_dich TEXT NOT NULL CHECK (loai_giao_dich IN ('THU', 'CHI')),
    so_tien BIGINT NOT NULL CHECK (so_tien > 0),
    danh_muc_id TEXT NOT NULL REFERENCES danh_muc(id),
    nguoi_giu_tien_id TEXT NOT NULL CHECK (nguoi_giu_tien_id IN ('VO', 'CHONG', 'QUY_CHUNG')),
    -- NULL = nhắc theo cấu hình chung (dinh_ky.ngay_nhac); để dành nhắc theo ngày riêng
    ngay_trong_thang SMALLINT NULL CHECK (ngay_trong_thang BETWEEN 1 AND 31),
    -- Tháng bắt đầu nhắc 'YYYY-MM'
    bat_dau_ky TEXT NOT NULL CHECK (bat_dau_ky ~ '^[0-9]{4}-[0-9]{2}$'),
    nguoi_tao_id TEXT NOT NULL REFERENCES thanh_vien(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_khoan_dinh_ky_ten ON khoan_dinh_ky (ten_chuan) WHERE is_active = TRUE AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_khoan_dinh_ky_sync ON khoan_dinh_ky (version, id);

-- Mỗi khoản mỗi tháng 1 lần đến hạn. Số tiền / loại / danh mục / người giữ tiền chụp lại lúc tạo
-- (sửa khoản sau đó không đổi nút đã gửi). han_dong: quá ngày này chưa bấm → QUA_HAN.
CREATE TABLE IF NOT EXISTS khoan_dinh_ky_lan (
    id TEXT PRIMARY KEY,
    khoan_dinh_ky_id TEXT NOT NULL REFERENCES khoan_dinh_ky(id),
    ky TEXT NOT NULL CHECK (ky ~ '^[0-9]{4}-[0-9]{2}$'),
    ngay_den_han DATE NOT NULL,
    han_dong DATE NOT NULL CHECK (han_dong >= ngay_den_han),
    loai_giao_dich TEXT NOT NULL CHECK (loai_giao_dich IN ('THU', 'CHI')),
    so_tien BIGINT NOT NULL CHECK (so_tien > 0),
    danh_muc_id TEXT NOT NULL REFERENCES danh_muc(id),
    nguoi_giu_tien_id TEXT NOT NULL CHECK (nguoi_giu_tien_id IN ('VO', 'CHONG', 'QUY_CHUNG')),
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('CHO', 'DA_GHI', 'BO_QUA', 'QUA_HAN', 'DA_DUNG')),
    giao_dich_id TEXT NULL REFERENCES giao_dich(id),
    -- Tăng mỗi lần huỷ giao dịch đã ghi → khoá chống ghi trùng mới cho lần bấm sau
    so_lan_ghi INTEGER NOT NULL DEFAULT 0 CHECK (so_lan_ghi >= 0),
    nguoi_xu_ly_id TEXT NULL REFERENCES thanh_vien(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL,
    UNIQUE (khoan_dinh_ky_id, ky)
);

CREATE INDEX IF NOT EXISTS idx_khoan_dinh_ky_lan_ky ON khoan_dinh_ky_lan (ky, trang_thai);
CREATE INDEX IF NOT EXISTS idx_khoan_dinh_ky_lan_giao_dich ON khoan_dinh_ky_lan (giao_dich_id) WHERE giao_dich_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_khoan_dinh_ky_lan_sync ON khoan_dinh_ky_lan (version, id);

-- Bảng vận hành (không đồng bộ): tin nhắc chung theo (tháng, người, lần nhắc 1 / 2).
-- Thử gửi tối đa 3 lần mỗi ngày (ngay_thu + so_lan_thu); telegram_message_id để vẽ lại tin khi bấm.
CREATE TABLE IF NOT EXISTS nhac_dinh_ky (
    id TEXT PRIMARY KEY,
    ky TEXT NOT NULL CHECK (ky ~ '^[0-9]{4}-[0-9]{2}$'),
    thanh_vien_id TEXT NOT NULL REFERENCES thanh_vien(id),
    lan_nhac SMALLINT NOT NULL CHECK (lan_nhac IN (1, 2)),
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('DANG_GUI', 'DA_GUI', 'LOI')),
    ngay_thu DATE NOT NULL,
    so_lan_thu INTEGER NOT NULL DEFAULT 1 CHECK (so_lan_thu > 0),
    telegram_message_id BIGINT NULL,
    gui_luc TIMESTAMPTZ NULL,
    loi TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (ky, thanh_vien_id, lan_nhac)
);

-- Giá trị mặc định (giống code). Đã có thì giữ nguyên.
INSERT INTO cau_hinh (khoa, gia_tri, mo_ta) VALUES
    ('dinh_ky.ngay_nhac', '2', 'Ngày trong tháng gửi tin nhắc khoản định kỳ (1-28)'),
    ('dinh_ky.gio_nhac', '20', 'Giờ gửi tin nhắc khoản định kỳ, giờ VN (7-22; càng muộn càng ít lượt gửi bù trong ngày)'),
    ('dinh_ky.so_ngay_nhac_lai', '3', 'Số ngày sau lần nhắc đầu thì nhắc lại khoản còn chờ (0 = không nhắc lại)'),
    ('dinh_ky.so_ngay_dong', '10', 'Số ngày sau ngày nhắc chưa bấm thì tự đóng, không ghi (1-27)'),
    ('bao_cao.ngay_gui', '1', 'Ngày gửi báo cáo tháng trước (1-28)'),
    ('bao_cao.gio_gui', '20', 'Giờ gửi báo cáo tháng, giờ VN (7-22)'),
    ('bao_cao.so_ngay_gui_bu', '3', 'Số ngày được gửi bù báo cáo nếu lỗi, tính cả ngày gửi (1-7)')
ON CONFLICT (khoa) DO NOTHING;

COMMIT;
