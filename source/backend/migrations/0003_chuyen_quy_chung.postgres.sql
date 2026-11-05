-- =====================================================================
-- FamilyFinance v4.0 - Migration 0003 (PostgreSQL / Neon)
-- Nộp vào / rút ra quỹ chung (1 quỹ, nhóm QUY_CHUNG). Ghi ngay, không cần xác nhận.
-- Không đổi tổng gia đình, không vào THU/CHI. Chạy lại được (IF NOT EXISTS).
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS chuyen_quy_chung (
    id TEXT PRIMARY KEY,
    chieu TEXT NOT NULL CHECK (chieu IN ('NOP', 'RUT')),
    -- Người thao tác; nhom_id là nhóm giữ tiền của người đó lúc ghi (không suy lại qua vai_tro)
    thanh_vien_id TEXT NOT NULL REFERENCES thanh_vien(id),
    nhom_id TEXT NOT NULL CHECK (nhom_id IN ('VO', 'CHONG')),
    so_tien BIGINT NOT NULL CHECK (so_tien > 0),
    ngay_chuyen DATE NOT NULL,
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('HOAN_TAT', 'DA_HUY')),
    source_message_id TEXT NULL REFERENCES tin_nhan_goc(id),
    idempotency_key TEXT NOT NULL UNIQUE,
    ghi_chu TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_chuyen_quy_chung_trang_thai ON chuyen_quy_chung (trang_thai, ngay_chuyen) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chuyen_quy_chung_sync ON chuyen_quy_chung (version, id);

COMMIT;
