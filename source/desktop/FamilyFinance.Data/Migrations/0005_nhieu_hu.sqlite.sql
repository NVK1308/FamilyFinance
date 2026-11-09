-- ⚠️ CHỈ DÙNG CHO SQLite (app desktop / test). KHÔNG chạy trên Neon — Neon dùng temp/neon/0x_*.sql (bản Postgres).
-- =====================================================================
-- FamilyFinance v4.0 - Migration 0005 (SQLite)
-- Cùng nội dung bản Postgres: nhiều hũ có tên. Lưu ý: SQLite không có
-- ADD COLUMN IF NOT EXISTS → phần ALTER chỉ chạy 1 lần (runner theo dõi số migration).
-- Cột có REFERENCES thêm bằng ALTER phải default NULL (yêu cầu của SQLite).
-- =====================================================================

CREATE TABLE IF NOT EXISTS hu (
    id TEXT PRIMARY KEY,
    ten TEXT NOT NULL,
    ten_khong_dau TEXT NOT NULL,
    muc_tieu INTEGER NULL CHECK (muc_tieu IS NULL OR muc_tieu > 0),
    nguoi_tao_id TEXT NULL REFERENCES thanh_vien(id),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT NULL
);

INSERT INTO hu (id, ten, ten_khong_dau, created_at, updated_at)
VALUES ('TIET_KIEM', 'Tiết kiệm', 'tiet kiem', '2026-11-09T00:00:00Z', '2026-11-09T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE hu_tiet_kiem ADD COLUMN hu_id TEXT NULL REFERENCES hu(id);
ALTER TABLE hu_tiet_kiem ADD COLUMN giao_dich_id TEXT NULL REFERENCES giao_dich(id);

UPDATE hu_tiet_kiem SET hu_id = 'TIET_KIEM', updated_at = '2026-11-09T00:00:00Z' WHERE hu_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_hu_tiet_kiem_hu ON hu_tiet_kiem (hu_id, trang_thai);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hu_ten_khong_dau ON hu (ten_khong_dau) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hu_tiet_kiem_giao_dich ON hu_tiet_kiem (giao_dich_id) WHERE giao_dich_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hu_sync ON hu (version, id);
