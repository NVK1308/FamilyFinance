-- =====================================================================
-- FamilyFinance v4.0 - Seed 0003: đối tượng "Các con" (Phase 5b, Q8)
-- Khoản ghi "cho các con / 2 con / con gái và con trai" → CAC_CON.
-- Không ghi cột version: Postgres lấy theo sequence, SQLite mặc định 1.
-- =====================================================================

INSERT INTO doi_tuong_thu_huong (id, ten_doi_tuong, loai_doi_tuong, quan_he, is_active, created_at, updated_at)
VALUES
    ('CAC_CON', 'Các con', 'NHOM_GIA_DINH', 'Các con', TRUE, '2026-11-06T00:00:00Z', '2026-11-06T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tu_khoa_doi_tuong (id, doi_tuong_id, tu_khoa, normalized_keyword, nguoi_xac_nhan_id, created_at, updated_at)
VALUES
    ('TKDT_CAC_CON_1', 'CAC_CON', 'các con', 'cac con', 'CHONG', '2026-11-06T00:00:00Z', '2026-11-06T00:00:00Z'),
    ('TKDT_CAC_CON_2', 'CAC_CON', '2 con', '2 con', 'CHONG', '2026-11-06T00:00:00Z', '2026-11-06T00:00:00Z'),
    ('TKDT_CAC_CON_3', 'CAC_CON', 'hai con', 'hai con', 'CHONG', '2026-11-06T00:00:00Z', '2026-11-06T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
