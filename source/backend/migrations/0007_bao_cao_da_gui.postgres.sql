-- =====================================================================
-- FamilyFinance v4.0 - Migration 0007 (PostgreSQL / Neon)
-- Báo cáo tháng (Phase 6): đánh dấu đã gửi theo từng người + tháng để cron chạy bắt bù không gửi trùng.
-- Bảng vận hành (không đồng bộ desktop). Chạy lại được (IF NOT EXISTS).
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bao_cao_da_gui (
    id TEXT PRIMARY KEY,
    -- Tháng báo cáo 'YYYY-MM'
    ky TEXT NOT NULL CHECK (ky ~ '^[0-9]{4}-[0-9]{2}$'),
    thanh_vien_id TEXT NOT NULL REFERENCES thanh_vien(id),
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('DANG_GUI', 'DA_GUI', 'LOI')),
    so_lan INTEGER NOT NULL DEFAULT 1 CHECK (so_lan > 0),
    loi TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (ky, thanh_vien_id)
);

COMMIT;
