-- =====================================================================
-- FamilyFinance v4.0 - Migration 0005 (PostgreSQL / Neon)
-- Nhiều hũ có tên (Y tế, Mua nhà, Tiết kiệm…). Hũ mặc định TIET_KIEM.
-- hu_tiet_kiem.hu_id: dòng thuộc hũ nào; giao_dich_id: dòng RUT đi kèm khoản chi trả từ hũ.
-- Chạy lại được (IF NOT EXISTS / ON CONFLICT / UPDATE có điều kiện).
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS hu (
    id TEXT PRIMARY KEY,
    ten TEXT NOT NULL,
    -- Tên bỏ dấu, chữ thường, gộp khoảng trắng: dùng để khớp tên trong tin nhắn
    ten_khong_dau TEXT NOT NULL,
    muc_tieu BIGINT NULL CHECK (muc_tieu IS NULL OR muc_tieu > 0),
    nguoi_tao_id TEXT NULL REFERENCES thanh_vien(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

INSERT INTO hu (id, ten, ten_khong_dau, created_at, updated_at)
VALUES ('TIET_KIEM', 'Tiết kiệm', 'tiet kiem', '2026-11-09T00:00:00Z', '2026-11-09T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE hu_tiet_kiem ADD COLUMN IF NOT EXISTS hu_id TEXT NULL REFERENCES hu(id);
ALTER TABLE hu_tiet_kiem ADD COLUMN IF NOT EXISTS giao_dich_id TEXT NULL REFERENCES giao_dich(id);

-- Dòng ghi trước khi có nhiều hũ → hũ mặc định
UPDATE hu_tiet_kiem SET hu_id = 'TIET_KIEM', updated_at = NOW(), version = nextval('sync_version_seq')
WHERE hu_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_hu_tiet_kiem_hu ON hu_tiet_kiem (hu_id, trang_thai);
-- Tên hũ duy nhất trong các hũ chưa xoá (xoá mềm rồi tạo lại cùng tên được)
CREATE UNIQUE INDEX IF NOT EXISTS uq_hu_ten_khong_dau ON hu (ten_khong_dau) WHERE deleted_at IS NULL;
-- Mỗi khoản chi trả từ hũ có đúng 1 dòng lấy ra đi kèm
CREATE UNIQUE INDEX IF NOT EXISTS uq_hu_tiet_kiem_giao_dich ON hu_tiet_kiem (giao_dich_id) WHERE giao_dich_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hu_sync ON hu (version, id);

COMMIT;
