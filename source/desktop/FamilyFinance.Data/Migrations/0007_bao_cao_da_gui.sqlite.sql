-- ⚠️ CHỈ DÙNG CHO SQLite (app desktop / test). KHÔNG chạy trên Neon — Neon dùng temp/neon/0x_*.sql (bản Postgres).
-- =====================================================================
-- FamilyFinance v4.0 - Migration 0007 (SQLite)
-- Cùng nội dung bản Postgres: đánh dấu đã gửi báo cáo tháng theo từng người.
-- =====================================================================

CREATE TABLE IF NOT EXISTS bao_cao_da_gui (
    id TEXT PRIMARY KEY,
    ky TEXT NOT NULL CHECK (length(ky) = 7 AND substr(ky, 5, 1) = '-'),
    thanh_vien_id TEXT NOT NULL REFERENCES thanh_vien(id),
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('DANG_GUI', 'DA_GUI', 'LOI')),
    so_lan INTEGER NOT NULL DEFAULT 1 CHECK (so_lan > 0),
    loi TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (ky, thanh_vien_id)
);
