-- =====================================================================
-- FamilyFinance v4.0 - Migration 0002 (SQLite)
-- Cùng nội dung bản Postgres. SQLite không ADD CONSTRAINT được nên gắn
-- cả 3 điều kiện vào CHECK của cột mới (SQLite cho CHECK cột tham chiếu cột khác).
-- =====================================================================

ALTER TABLE giao_dich ADD COLUMN chieu_dieu_chinh TEXT NULL CHECK (
    (chieu_dieu_chinh IS NULL OR chieu_dieu_chinh IN ('TANG', 'GIAM'))
    AND ((loai_giao_dich = 'DIEU_CHINH') = (chieu_dieu_chinh IS NOT NULL))
    AND (trang_thai <> 'HOAN_TAT' OR nguoi_giu_tien_id IS NOT NULL)
);
