-- =====================================================================
-- FamilyFinance v4.0 - Migration 0006 (PostgreSQL / Neon)
-- Giá vàng thị trường nhập bằng /giavang (giá 1 chỉ). Dùng để định giá vàng trong hũ
-- khi mới hơn lần mua / bán gần nhất. Không phải dòng tiền, không đụng số dư.
-- Chạy lại được (IF NOT EXISTS).
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS gia_vang (
    id TEXT PRIMARY KEY,
    -- Giá 1 chỉ (đồng)
    gia_chi BIGINT NOT NULL CHECK (gia_chi > 0),
    ngay DATE NOT NULL,
    thanh_vien_id TEXT NOT NULL REFERENCES thanh_vien(id),
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_gia_vang_ngay ON gia_vang (ngay, version) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gia_vang_sync ON gia_vang (version, id);

COMMIT;
