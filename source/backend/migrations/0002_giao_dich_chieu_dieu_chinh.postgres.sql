-- =====================================================================
-- FamilyFinance v4.0 - Migration 0002 (PostgreSQL / Neon)
-- Thêm chiều điều chỉnh (TANG/GIAM) cho DIEU_CHINH; HOAN_TAT bắt buộc có người giữ tiền.
--
-- Chạy trên Neon thật: kiểm dòng vi phạm trước, kết quả phải rỗng:
--   SELECT id, loai_giao_dich, trang_thai, nguoi_giu_tien_id FROM giao_dich
--   WHERE loai_giao_dich = 'DIEU_CHINH'
--      OR (trang_thai = 'HOAN_TAT' AND nguoi_giu_tien_id IS NULL);
-- =====================================================================

BEGIN;

ALTER TABLE giao_dich ADD COLUMN IF NOT EXISTS chieu_dieu_chinh TEXT NULL;

ALTER TABLE giao_dich DROP CONSTRAINT IF EXISTS chk_giao_dich_chieu_dieu_chinh_gia_tri;
ALTER TABLE giao_dich ADD CONSTRAINT chk_giao_dich_chieu_dieu_chinh_gia_tri
    CHECK (chieu_dieu_chinh IS NULL OR chieu_dieu_chinh IN ('TANG', 'GIAM'));

ALTER TABLE giao_dich DROP CONSTRAINT IF EXISTS chk_giao_dich_dieu_chinh_co_chieu;
ALTER TABLE giao_dich ADD CONSTRAINT chk_giao_dich_dieu_chinh_co_chieu
    CHECK ((loai_giao_dich = 'DIEU_CHINH') = (chieu_dieu_chinh IS NOT NULL));

ALTER TABLE giao_dich DROP CONSTRAINT IF EXISTS chk_giao_dich_hoan_tat_co_nguoi_giu;
ALTER TABLE giao_dich ADD CONSTRAINT chk_giao_dich_hoan_tat_co_nguoi_giu
    CHECK (trang_thai <> 'HOAN_TAT' OR nguoi_giu_tien_id IS NOT NULL);

COMMIT;
