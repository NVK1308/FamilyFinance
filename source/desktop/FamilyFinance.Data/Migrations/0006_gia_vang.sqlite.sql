-- ⚠️ CHỈ DÙNG CHO SQLite (app desktop / test). KHÔNG chạy trên Neon — Neon dùng temp/neon/0x_*.sql (bản Postgres).
-- =====================================================================
-- FamilyFinance v4.0 - Migration 0006 (SQLite)
-- Cùng nội dung bản Postgres: giá vàng thị trường nhập bằng /giavang.
-- =====================================================================

CREATE TABLE IF NOT EXISTS gia_vang (
    id TEXT PRIMARY KEY,
    gia_chi INTEGER NOT NULL CHECK (gia_chi > 0),
    ngay TEXT NOT NULL,
    thanh_vien_id TEXT NOT NULL REFERENCES thanh_vien(id),
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_gia_vang_ngay ON gia_vang (ngay, version) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gia_vang_sync ON gia_vang (version, id);
