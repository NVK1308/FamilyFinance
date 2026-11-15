-- =====================================================================
-- FamilyFinance v4.0 - Migration 0009 (PostgreSQL / Neon)
-- Phase 8: xoá hũ (ẩn bằng is_active, tên dùng lại được) + ngân sách theo danh mục.
-- Chạy lại được (IF NOT EXISTS / DROP IF EXISTS).
-- =====================================================================

BEGIN;

-- Xoá hũ = is_active FALSE (giữ dòng để lịch sử / nút của khoản cũ còn tra được hũ).
-- Tên hũ chỉ cần duy nhất trong các hũ đang dùng → xoá rồi tạo lại cùng tên được.
DROP INDEX IF EXISTS uq_hu_ten_khong_dau;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hu_ten_dang_dung ON hu (ten_khong_dau) WHERE deleted_at IS NULL AND is_active = TRUE;

-- Ngân sách tháng theo danh mục chi (cả gia đình). Bỏ = is_active FALSE. Đồng bộ desktop.
CREATE TABLE IF NOT EXISTS ngan_sach (
    id TEXT PRIMARY KEY,
    danh_muc_id TEXT NOT NULL REFERENCES danh_muc(id),
    so_tien_thang BIGINT NOT NULL CHECK (so_tien_thang > 0),
    nguoi_tao_id TEXT NOT NULL REFERENCES thanh_vien(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ngan_sach_danh_muc ON ngan_sach (danh_muc_id) WHERE is_active = TRUE AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ngan_sach_sync ON ngan_sach (version, id);

-- Bảng vận hành (không đồng bộ): đã báo mốc % của ngân sách trong tháng chưa (mỗi mốc 1 lần / tháng)
CREATE TABLE IF NOT EXISTS ngan_sach_canh_bao (
    id TEXT PRIMARY KEY,
    ngan_sach_id TEXT NOT NULL REFERENCES ngan_sach(id),
    ky TEXT NOT NULL CHECK (ky ~ '^[0-9]{4}-[0-9]{2}$'),
    muc SMALLINT NOT NULL CHECK (muc BETWEEN 1 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (ngan_sach_id, ky, muc)
);

INSERT INTO cau_hinh (khoa, gia_tri, mo_ta) VALUES
    ('ngan_sach.canh_bao_phan_tram', '80', 'Báo khi chi một danh mục vượt bao nhiêu % ngân sách tháng (50-99; vượt 100% luôn báo)')
ON CONFLICT (khoa) DO NOTHING;

COMMIT;
