-- =====================================================================
-- FamilyFinance v4.0 - Reference & Mock Seed Data (Dev/Test Only)
-- File: 0001_seed_reference_data.sql
-- Lưu ý: Chỉ chứa dữ liệu danh mục chuẩn và user ID giả phục vụ test.
-- =====================================================================

-- 1. Thành viên gia đình (User ID giả dùng cho môi trường dev/test)
INSERT INTO thanh_vien (id, ten, telegram_user_id, vai_tro, is_active, created_at, updated_at, version)
VALUES
    ('CHONG', 'Chồng', 100000001, 'CHONG', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 1),
    ('VO', 'Vợ', 100000002, 'VO', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 2)
ON CONFLICT (id) DO NOTHING;

-- 2. Đối tượng thụ hưởng chuẩn
INSERT INTO doi_tuong_thu_huong (id, ten_doi_tuong, loai_doi_tuong, quan_he, is_active, created_at, updated_at, version)
VALUES
    ('GIA_DINH', 'Gia đình chung', 'NHOM_GIA_DINH', 'Gia đình', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 3),
    ('CHONG', 'Chồng', 'CA_NHAN', 'Chồng', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 4),
    ('VO', 'Vợ', 'CA_NHAN', 'Vợ', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 5),
    ('CON_GAI', 'Con gái', 'CA_NHAN', 'Con gái', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 6),
    ('CON_TRAI', 'Con trai', 'CA_NHAN', 'Con trai', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 7)
ON CONFLICT (id) DO NOTHING;

-- 3. Từ khóa nhận diện đối tượng thụ hưởng
INSERT INTO tu_khoa_doi_tuong (id, doi_tuong_id, tu_khoa, normalized_keyword, nguoi_xac_nhan_id, created_at, updated_at, version)
VALUES
    ('TKDT_CON_GAI_1', 'CON_GAI', 'con gái', 'con gai', 'CHONG', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 8),
    ('TKDT_CON_TRAI_1', 'CON_TRAI', 'con trai', 'con trai', 'CHONG', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 9),
    ('TKDT_VO_1', 'VO', 'cho vợ', 'cho vo', 'CHONG', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 10),
    ('TKDT_CHONG_1', 'CHONG', 'cho chồng', 'cho chong', 'VO', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 11),
    ('TKDT_GIA_DINH_1', 'GIA_DINH', 'gia đình', 'gia dinh', 'CHONG', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 12),
    ('TKDT_GIA_DINH_2', 'GIA_DINH', 'cả nhà', 'ca nha', 'CHONG', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 13)
ON CONFLICT (id) DO NOTHING;

-- 4. Danh mục THU / CHI theo chuẩn Runbook v3 (Mục 4.4) & MasterPrompt v2 (Mục 5)
INSERT INTO danh_muc (id, ma_danh_muc, ten_danh_muc, loai_giao_dich, mo_ta, is_active, created_at, updated_at, version)
VALUES
    -- Danh mục THU
    ('DM_LUONG', 'LUONG', 'Lương', 'THU', 'Thu nhập tiền lương hàng tháng', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 14),
    ('DM_OT', 'OT', 'OT', 'THU', 'Tiền làm thêm giờ (Overtime)', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 15),
    ('DM_THUONG', 'THUONG', 'Thưởng', 'THU', 'Tiền thưởng lễ, tết, dự án', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 16),
    ('DM_KINH_DOANH', 'KINH_DOANH', 'Kinh doanh', 'THU', 'Thu nhập từ bán hàng/kinh doanh', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 17),
    ('DM_TIEN_DUOC_CHO', 'TIEN_DUOC_CHO', 'Tiền được cho', 'THU', 'Tiền biếu, cho tặng', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 18),
    ('DM_QUA_TANG', 'QUA_TANG', 'Quà tặng', 'CA_HAI', 'Tiền quà tặng nhận được hoặc mừng/biếu', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 19),
    ('DM_THU_HOI_NO', 'THU_HOI_NO', 'Thu hồi nợ', 'THU', 'Khoản thu hồi nợ được xác nhận', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 20),
    ('DM_NO_CUA_ANH', 'NO_CUA_ANH', 'Nợ của anh', 'CA_HAI', 'Danh mục minh họa tính độc lập giữa danh mục và loại THU/CHI', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 21),
    ('DM_THU_KHAC', 'THU_KHAC', 'Thu khác', 'THU', 'Các khoản thu khác', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 22),

    -- Danh mục CHI
    ('DM_THUC_AN', 'THUC_AN', 'Thức ăn', 'CHI', 'Ăn uống hàng ngày', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 23),
    ('DM_DI_CHO', 'DI_CHO', 'Đi chợ', 'CHI', 'Mua thực phẩm đi chợ', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 24),
    ('DM_SUA', 'SUA', 'Sữa', 'CHI', 'Mua sữa cho con/gia đình', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 25),
    ('DM_HOC_PHI', 'HOC_PHI', 'Học phí', 'CHI', 'Học phí chính khóa', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 26),
    ('DM_HOC_THEM', 'HOC_THEM', 'Học thêm', 'CHI', 'Học thêm, ngoại khóa', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 27),
    ('DM_Y_TE', 'Y_TE', 'Y tế', 'CHI', 'Khám chữa bệnh, viện phí', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 28),
    ('DM_THUOC', 'THUOC', 'Thuốc', 'CHI', 'Mua thuốc men', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 29),
    ('DM_DIEN', 'DIEN', 'Điện', 'CHI', 'Tiền điện hàng tháng', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 30),
    ('DM_NUOC', 'NUOC', 'Nước', 'CHI', 'Tiền nước sinh hoạt', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 31),
    ('DM_INTERNET', 'INTERNET', 'Internet', 'CHI', 'Tiền mạng, viễn thông', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 32),
    ('DM_NHA_CUA', 'NHA_CUA', 'Nhà cửa', 'CHI', 'Chi phí nhà ở, sửa chữa, phí dịch vụ', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 33),
    ('DM_DI_LAI', 'DI_LAI', 'Đi lại', 'CHI', 'Xăng xe, gửi xe, taxi', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 34),
    ('DM_MUA_SAM', 'MUA_SAM', 'Mua sắm', 'CHI', 'Quần áo, đồ dùng cá nhân/gia đình', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 35),
    ('DM_GIAI_TRI', 'GIAI_TRI', 'Giải trí', 'CHI', 'Du lịch, vui chơi', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 36),
    ('DM_CHI_KHAC', 'CHI_KHAC', 'Chi khác', 'CHI', 'Các khoản chi khác', TRUE, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 37)
ON CONFLICT (id) DO NOTHING;

-- 5. Từ khóa danh mục chuẩn đã được phê duyệt trong tài liệu
INSERT INTO tu_khoa_danh_muc (id, danh_muc_id, tu_khoa, normalized_keyword, nguoi_xac_nhan_id, created_at, updated_at, version)
VALUES
    ('TKDM_LUONG_1', 'DM_LUONG', 'lương', 'luong', 'CHONG', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 38),
    ('TKDM_OT_1', 'DM_OT', 'ot', 'ot', 'CHONG', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 39),
    ('TKDM_THUONG_1', 'DM_THUONG', 'tiền thưởng', 'tien thuong', 'CHONG', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 40),
    ('TKDM_THUONG_2', 'DM_THUONG', 'thưởng', 'thuong', 'CHONG', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 41),
    ('TKDM_QUA_1', 'DM_QUA_TANG', 'tiền quà', 'tien qua', 'CHONG', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 42),
    ('TKDM_NO_A_1', 'DM_NO_CUA_ANH', 'nợ của a', 'no cua a', 'CHONG', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 43),
    ('TKDM_NO_A_2', 'DM_NO_CUA_ANH', 'nợ của anh', 'no cua anh', 'CHONG', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 44),
    ('TKDM_AN_1', 'DM_THUC_AN', 'tiền ăn', 'tien an', 'VO', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 45),
    ('TKDM_AN_2', 'DM_THUC_AN', 'ăn uống', 'an uong', 'VO', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 46),
    ('TKDM_AN_3', 'DM_THUC_AN', 'đồ ăn', 'do an', 'VO', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 47),
    ('TKDM_AN_4', 'DM_THUC_AN', 'ăn sáng', 'an sang', 'VO', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 48),
    ('TKDM_AN_5', 'DM_THUC_AN', 'mua đồ ăn', 'mua do an', 'VO', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 57),
    ('TKDM_SUA_1', 'DM_SUA', 'mua sữa', 'mua sua', 'VO', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 49),
    ('TKDM_SUA_2', 'DM_SUA', 'sữa', 'sua', 'VO', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 50),
    ('TKDM_HOC_PHI_1', 'DM_HOC_PHI', 'học phí', 'hoc phi', 'VO', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 51),
    ('TKDM_HOC_PHI_2', 'DM_HOC_PHI', 'tiền học', 'tien hoc', 'VO', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 52),
    ('TKDM_DI_LAI_1', 'DM_DI_LAI', 'tiền gửi xe', 'tien gui xe', 'CHONG', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 53),
    ('TKDM_DI_LAI_2', 'DM_DI_LAI', 'gửi xe', 'gui xe', 'CHONG', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 54),
    ('TKDM_DI_LAI_3', 'DM_DI_LAI', 'đổ xăng', 'do xang', 'CHONG', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 55),
    ('TKDM_MUA_SAM_1', 'DM_MUA_SAM', 'mua đồ', 'mua do', 'VO', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 56)
ON CONFLICT (id) DO NOTHING;

