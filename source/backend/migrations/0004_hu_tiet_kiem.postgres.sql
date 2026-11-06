-- =====================================================================
-- FamilyFinance v4.0 - Migration 0004 (PostgreSQL / Neon)
-- Hũ tiết kiệm: tài sản chung (tiền, vàng). Khai báo / bỏ vào / lấy ra; ghi ngay, không xác nhận.
-- Không vào THU/CHI. NOP/RUT có tiền thì trừ/cộng nhóm tiền mặt nguon_id. Chạy lại được.
-- Vàng lưu số nguyên PHÂN (1 chỉ = 10 phân, 1 lượng = 100 phân).
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS hu_tiet_kiem (
    id TEXT PRIMARY KEY,
    chieu TEXT NOT NULL CHECK (chieu IN ('KHAI_BAO', 'NOP', 'RUT')),
    loai_tai_san TEXT NOT NULL CHECK (loai_tai_san IN ('TIEN', 'VANG')),
    so_luong_phan BIGINT NULL CHECK (so_luong_phan IS NULL OR so_luong_phan > 0),
    so_tien BIGINT NULL CHECK (so_tien IS NULL OR so_tien > 0),
    -- Nhóm tiền mặt bị trừ (NOP) / được cộng (RUT); NULL khi khai báo hoặc không có tiền
    nguon_id TEXT NULL CHECK (nguon_id IS NULL OR nguon_id IN ('VO', 'CHONG', 'QUY_CHUNG')),
    thanh_vien_id TEXT NOT NULL REFERENCES thanh_vien(id),
    ngay DATE NOT NULL,
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('HOAN_TAT', 'DA_HUY')),
    source_message_id TEXT NULL REFERENCES tin_nhan_goc(id),
    idempotency_key TEXT NOT NULL UNIQUE,
    ghi_chu TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL,
    CHECK (loai_tai_san <> 'TIEN' OR (so_tien IS NOT NULL AND so_luong_phan IS NULL)),
    CHECK (loai_tai_san <> 'VANG' OR so_luong_phan IS NOT NULL),
    CHECK (chieu <> 'KHAI_BAO' OR nguon_id IS NULL),
    CHECK (nguon_id IS NULL OR so_tien IS NOT NULL),
    CHECK (chieu = 'KHAI_BAO' OR so_tien IS NULL OR nguon_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_hu_tiet_kiem_trang_thai ON hu_tiet_kiem (trang_thai, ngay) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hu_tiet_kiem_sync ON hu_tiet_kiem (version, id);

COMMIT;
