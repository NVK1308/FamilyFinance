-- =====================================================================
-- FamilyFinance v4.0 - Seed 0002: danh mục Lãi cho vay (THU)
-- Không ghi cột version: Postgres lấy theo sequence, SQLite mặc định 1.
-- =====================================================================

INSERT INTO danh_muc (id, ma_danh_muc, ten_danh_muc, loai_giao_dich, mo_ta, is_active, created_at, updated_at)
VALUES
    ('DM_LAI_CHO_VAY', 'LAI_CHO_VAY', 'Lãi cho vay', 'THU', 'Tiền lãi thu về từ khoản cho vay', TRUE, '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tu_khoa_danh_muc (id, danh_muc_id, tu_khoa, normalized_keyword, nguoi_xac_nhan_id, created_at, updated_at)
VALUES
    ('TKDM_LAI_CHO_VAY_1', 'DM_LAI_CHO_VAY', 'lãi cho vay', 'lai cho vay', 'CHONG', '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
