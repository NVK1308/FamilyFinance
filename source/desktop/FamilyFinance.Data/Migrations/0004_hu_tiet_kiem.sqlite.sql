-- ⚠️ CHỈ DÙNG CHO SQLite (app desktop / test). KHÔNG chạy trên Neon — Neon dùng temp/neon/0x_*.sql (bản Postgres).
-- =====================================================================
-- FamilyFinance v4.0 - Migration 0004 (SQLite)
-- Cùng nội dung bản Postgres: hũ tiết kiệm (tiền, vàng theo phân).
-- =====================================================================

CREATE TABLE IF NOT EXISTS hu_tiet_kiem (
    id TEXT PRIMARY KEY,
    chieu TEXT NOT NULL CHECK (chieu IN ('KHAI_BAO', 'NOP', 'RUT')),
    loai_tai_san TEXT NOT NULL CHECK (loai_tai_san IN ('TIEN', 'VANG')),
    so_luong_phan INTEGER NULL CHECK (so_luong_phan IS NULL OR so_luong_phan > 0),
    so_tien INTEGER NULL CHECK (so_tien IS NULL OR so_tien > 0),
    nguon_id TEXT NULL CHECK (nguon_id IS NULL OR nguon_id IN ('VO', 'CHONG', 'QUY_CHUNG')),
    thanh_vien_id TEXT NOT NULL REFERENCES thanh_vien(id),
    ngay TEXT NOT NULL,
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('HOAN_TAT', 'DA_HUY')),
    source_message_id TEXT NULL REFERENCES tin_nhan_goc(id),
    idempotency_key TEXT NOT NULL UNIQUE,
    ghi_chu TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT NULL,
    CHECK (loai_tai_san <> 'TIEN' OR (so_tien IS NOT NULL AND so_luong_phan IS NULL)),
    CHECK (loai_tai_san <> 'VANG' OR so_luong_phan IS NOT NULL),
    CHECK (chieu <> 'KHAI_BAO' OR nguon_id IS NULL),
    CHECK (nguon_id IS NULL OR so_tien IS NOT NULL),
    CHECK (chieu = 'KHAI_BAO' OR so_tien IS NULL OR nguon_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_hu_tiet_kiem_trang_thai ON hu_tiet_kiem (trang_thai, ngay);
CREATE INDEX IF NOT EXISTS idx_hu_tiet_kiem_sync ON hu_tiet_kiem (version, id);
