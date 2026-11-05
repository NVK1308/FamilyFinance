-- =====================================================================
-- FamilyFinance v4.0 - Migration 0003 (SQLite)
-- Cùng nội dung bản Postgres: nộp vào / rút ra quỹ chung.
-- =====================================================================

CREATE TABLE IF NOT EXISTS chuyen_quy_chung (
    id TEXT PRIMARY KEY,
    chieu TEXT NOT NULL CHECK (chieu IN ('NOP', 'RUT')),
    thanh_vien_id TEXT NOT NULL REFERENCES thanh_vien(id),
    nhom_id TEXT NOT NULL CHECK (nhom_id IN ('VO', 'CHONG')),
    so_tien INTEGER NOT NULL CHECK (so_tien > 0),
    ngay_chuyen TEXT NOT NULL,
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('HOAN_TAT', 'DA_HUY')),
    source_message_id TEXT NULL REFERENCES tin_nhan_goc(id),
    idempotency_key TEXT NOT NULL UNIQUE,
    ghi_chu TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_chuyen_quy_chung_trang_thai ON chuyen_quy_chung (trang_thai, ngay_chuyen);
CREATE INDEX IF NOT EXISTS idx_chuyen_quy_chung_sync ON chuyen_quy_chung (version, id);
