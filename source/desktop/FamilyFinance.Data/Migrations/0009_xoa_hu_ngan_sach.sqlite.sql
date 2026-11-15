-- ⚠️ CHỈ DÙNG CHO SQLite (app desktop / test). KHÔNG chạy trên Neon — Neon dùng temp/neon/11_xoa_hu_ngan_sach.sql (bản Postgres).
-- =====================================================================
-- FamilyFinance v4.0 - Migration 0009 (SQLite)
-- Cùng nội dung bản Postgres: xoá hũ (tên dùng lại được) + ngân sách theo danh mục.
-- =====================================================================

DROP INDEX IF EXISTS uq_hu_ten_khong_dau;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hu_ten_dang_dung ON hu (ten_khong_dau) WHERE deleted_at IS NULL AND is_active = 1;

CREATE TABLE IF NOT EXISTS ngan_sach (
    id TEXT PRIMARY KEY,
    danh_muc_id TEXT NOT NULL REFERENCES danh_muc(id),
    so_tien_thang INTEGER NOT NULL CHECK (so_tien_thang > 0),
    nguoi_tao_id TEXT NOT NULL REFERENCES thanh_vien(id),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ngan_sach_danh_muc ON ngan_sach (danh_muc_id) WHERE is_active = 1 AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ngan_sach_sync ON ngan_sach (version, id);

CREATE TABLE IF NOT EXISTS ngan_sach_canh_bao (
    id TEXT PRIMARY KEY,
    ngan_sach_id TEXT NOT NULL REFERENCES ngan_sach(id),
    ky TEXT NOT NULL CHECK (length(ky) = 7 AND substr(ky, 5, 1) = '-'),
    muc INTEGER NOT NULL CHECK (muc BETWEEN 1 AND 100),
    created_at TEXT NOT NULL,
    UNIQUE (ngan_sach_id, ky, muc)
);

INSERT INTO cau_hinh (khoa, gia_tri, mo_ta) VALUES
    ('ngan_sach.canh_bao_phan_tram', '80', 'Báo khi chi một danh mục vượt bao nhiêu % ngân sách tháng (50-99; vượt 100% luôn báo)')
ON CONFLICT (khoa) DO NOTHING;
