-- =====================================================================
-- FamilyFinance v4.0 - Initial PostgreSQL Schema (Neon Primary DB)
-- Migration: 0001_initial_schema.postgres.sql
-- Quy tắc: Tiền tệ dùng BIGINT (nguyên dương VND), chuẩn hóa snake_case
-- =====================================================================

BEGIN;

-- Bộ đếm version toàn cục phục vụ đồng bộ watermark (Neon -> SQLite)
CREATE SEQUENCE IF NOT EXISTS sync_version_seq START WITH 1 INCREMENT BY 1;

-- 1. Bảng thành viên sử dụng hệ thống (Vợ, Chồng)
CREATE TABLE IF NOT EXISTS thanh_vien (
    id TEXT PRIMARY KEY,
    ten TEXT NOT NULL,
    telegram_user_id BIGINT NOT NULL UNIQUE,
    vai_tro TEXT NOT NULL CHECK (vai_tro IN ('VO', 'CHONG', 'QUAN_TRI')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

-- 2. Bảng số dư ban đầu theo người/nhóm giữ tiền
CREATE TABLE IF NOT EXISTS so_du_ban_dau (
    id TEXT PRIMARY KEY,
    nguoi_giu_tien_id TEXT NOT NULL UNIQUE CHECK (nguoi_giu_tien_id IN ('VO', 'CHONG', 'QUY_CHUNG', 'CHUA_XAC_DINH')),
    so_tien BIGINT NOT NULL CHECK (so_tien >= 0),
    ngay_ap_dung DATE NOT NULL,
    nguoi_xac_nhan_id TEXT NULL REFERENCES thanh_vien(id),
    ghi_chu TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

-- 3. Bảng đối tượng thụ hưởng (Vợ, Chồng, Con gái, Con trai, Gia đình...)
CREATE TABLE IF NOT EXISTS doi_tuong_thu_huong (
    id TEXT PRIMARY KEY,
    ten_doi_tuong TEXT NOT NULL,
    loai_doi_tuong TEXT NOT NULL CHECK (loai_doi_tuong IN ('CA_NHAN', 'NHOM_GIA_DINH', 'KHAC')),
    quan_he TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

-- 4. Bảng từ khóa / bí danh nhận diện đối tượng thụ hưởng
CREATE TABLE IF NOT EXISTS tu_khoa_doi_tuong (
    id TEXT PRIMARY KEY,
    doi_tuong_id TEXT NOT NULL REFERENCES doi_tuong_thu_huong(id),
    tu_khoa TEXT NOT NULL,
    normalized_keyword TEXT NOT NULL UNIQUE,
    nguoi_xac_nhan_id TEXT NULL REFERENCES thanh_vien(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

-- 5. Bảng danh mục THU / CHI
CREATE TABLE IF NOT EXISTS danh_muc (
    id TEXT PRIMARY KEY,
    ma_danh_muc TEXT NOT NULL UNIQUE,
    ten_danh_muc TEXT NOT NULL,
    loai_giao_dich TEXT NOT NULL CHECK (loai_giao_dich IN ('THU', 'CHI', 'CA_HAI')),
    mo_ta TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

-- 6. Bảng từ khóa / alias danh mục (chỉ lưu sau khi người dùng xác nhận)
CREATE TABLE IF NOT EXISTS tu_khoa_danh_muc (
    id TEXT PRIMARY KEY,
    danh_muc_id TEXT NOT NULL REFERENCES danh_muc(id),
    tu_khoa TEXT NOT NULL,
    normalized_keyword TEXT NOT NULL UNIQUE,
    nguoi_xac_nhan_id TEXT NULL REFERENCES thanh_vien(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

-- 7. Bảng lưu tin nhắn gốc từ Telegram để truy vết & chống trùng webhook
CREATE TABLE IF NOT EXISTS tin_nhan_goc (
    id TEXT PRIMARY KEY,
    telegram_update_id BIGINT NOT NULL UNIQUE,
    telegram_message_id BIGINT NOT NULL,
    telegram_chat_id BIGINT NOT NULL,
    nguoi_gui_id TEXT NULL REFERENCES thanh_vien(id),
    noi_dung_goc TEXT NOT NULL,
    thoi_gian_nhan TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trang_thai_xu_ly TEXT NOT NULL CHECK (trang_thai_xu_ly IN ('DA_NHAN', 'DA_GHI', 'CHO_XAC_NHAN', 'DA_BO_QUA', 'LOI')),
    chi_tiet_loi TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

-- 8. Bảng quản lý các khoản nợ (Vay / Cho vay)
CREATE TABLE IF NOT EXISTS khoan_no (
    id TEXT PRIMARY KEY,
    ten_khoan_no TEXT NOT NULL,
    chieu_no TEXT NOT NULL CHECK (chieu_no IN ('DI_VAY', 'CHO_VAY')),
    doi_tac TEXT NOT NULL,
    so_tien_goc BIGINT NOT NULL CHECK (so_tien_goc > 0),
    du_no_hien_tai BIGINT NOT NULL CHECK (du_no_hien_tai >= 0),
    ngay_phat_sinh DATE NOT NULL,
    ngay_dao_han DATE NULL,
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('DANG_NO', 'DA_TAT_TOAN', 'DA_HUY')),
    ghi_chu TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

-- 9. Bảng giao dịch chính (THU, CHI, VAY, TRA_NO, LAI_VAY, PHI, DIEU_CHINH)
CREATE TABLE IF NOT EXISTS giao_dich (
    id TEXT PRIMARY KEY,
    loai_giao_dich TEXT NOT NULL CHECK (loai_giao_dich IN ('THU', 'CHI', 'VAY', 'TRA_NO', 'LAI_VAY', 'PHI', 'DIEU_CHINH')),
    so_tien BIGINT NOT NULL CHECK (so_tien > 0),
    danh_muc_id TEXT NULL REFERENCES danh_muc(id),
    nguoi_tao_id TEXT NOT NULL REFERENCES thanh_vien(id),
    nguoi_thuc_hien_id TEXT NOT NULL REFERENCES thanh_vien(id),
    nguoi_giu_tien_id TEXT NULL CHECK (nguoi_giu_tien_id IS NULL OR nguoi_giu_tien_id IN ('VO', 'CHONG', 'QUY_CHUNG', 'CHUA_XAC_DINH')),
    doi_tuong_thu_huong_id TEXT NULL REFERENCES doi_tuong_thu_huong(id),
    khoan_no_id TEXT NULL REFERENCES khoan_no(id),
    mo_ta TEXT NOT NULL,
    ngay_giao_dich DATE NOT NULL,
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('CHO_XAC_NHAN', 'HOAN_TAT', 'DA_HUY')),
    source_message_id TEXT NULL REFERENCES tin_nhan_goc(id),
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

-- 10. Bảng phân bổ một giao dịch cho nhiều đối tượng thụ hưởng
CREATE TABLE IF NOT EXISTS phan_bo_giao_dich (
    id TEXT PRIMARY KEY,
    giao_dich_id TEXT NOT NULL REFERENCES giao_dich(id) ON DELETE CASCADE,
    doi_tuong_id TEXT NOT NULL REFERENCES doi_tuong_thu_huong(id),
    so_tien_phan_bo BIGINT NOT NULL CHECK (so_tien_phan_bo > 0),
    ghi_chu TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

-- 11. Bảng chuyển tiền nội bộ giữa Vợ và Chồng (không tính vào THU/CHI)
CREATE TABLE IF NOT EXISTS chuyen_tien_noi_bo (
    id TEXT PRIMARY KEY,
    nguoi_chuyen_id TEXT NOT NULL REFERENCES thanh_vien(id),
    nguoi_nhan_id TEXT NOT NULL REFERENCES thanh_vien(id),
    so_tien BIGINT NOT NULL CHECK (so_tien > 0),
    ngay_chuyen DATE NOT NULL,
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('CHO_XAC_NHAN', 'DA_XAC_NHAN', 'TU_CHOI', 'DA_HUY', 'HET_HAN')),
    ngay_xac_nhan TIMESTAMPTZ NULL,
    telegram_user_id_xac_nhan BIGINT NULL,
    source_message_id TEXT NULL REFERENCES tin_nhan_goc(id),
    idempotency_key TEXT NOT NULL UNIQUE,
    ghi_chu TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT chk_khac_nguoi_chuyen_nhan CHECK (nguoi_chuyen_id <> nguoi_nhan_id)
);

-- 12. Bảng lịch sử biến động khoản nợ
CREATE TABLE IF NOT EXISTS lich_su_no (
    id TEXT PRIMARY KEY,
    khoan_no_id TEXT NOT NULL REFERENCES khoan_no(id),
    giao_dich_id TEXT NOT NULL REFERENCES giao_dich(id),
    loai_bien_dong TEXT NOT NULL CHECK (loai_bien_dong IN ('GIAI_NGAN', 'TRA_GOC', 'THU_GOC', 'TRA_LAI', 'DIEU_CHINH')),
    so_tien BIGINT NOT NULL CHECK (so_tien > 0),
    ngay_ghi_nhan DATE NOT NULL,
    ghi_chu TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

-- 13. Bảng yêu cầu chờ người dùng xác nhận qua Telegram (Inline Keyboard / Reply)
CREATE TABLE IF NOT EXISTS yeu_cau_xac_nhan (
    id TEXT PRIMARY KEY,
    source_message_id TEXT NOT NULL REFERENCES tin_nhan_goc(id),
    nguoi_tao_id TEXT NOT NULL REFERENCES thanh_vien(id),
    nguoi_can_xac_nhan_id TEXT NOT NULL REFERENCES thanh_vien(id),
    loai_xac_nhan TEXT NOT NULL CHECK (loai_xac_nhan IN ('CHUYEN_TIEN', 'NGUOI_GIU_TIEN', 'DANH_MUC_MOI', 'DOI_TUONG_MOI', 'PHAN_BO', 'GIAO_DICH_MO_HO')),
    du_lieu_de_xuat_json TEXT NOT NULL,
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('CHO_XAC_NHAN', 'DA_XAC_NHAN', 'TU_CHOI', 'HET_HAN')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq'),
    deleted_at TIMESTAMPTZ NULL
);

-- 14. Bảng lịch sử chỉnh sửa & Audit Log (bất biến, không xóa)
CREATE TABLE IF NOT EXISTS lich_su_chinh_sua (
    id TEXT PRIMARY KEY,
    ten_bang TEXT NOT NULL,
    ban_ghi_id TEXT NOT NULL,
    hanh_dong TEXT NOT NULL CHECK (hanh_dong IN ('CREATE', 'UPDATE', 'CANCEL', 'CONFIRM', 'ARCHIVE')),
    du_lieu_truoc_json TEXT NULL,
    du_lieu_sau_json TEXT NULL,
    nguoi_thuc_hien_id TEXT NULL REFERENCES thanh_vien(id),
    ly_do TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq')
);

-- 15. Bảng trạng thái đồng bộ (Watermark cho từng máy local và từng bảng)
CREATE TABLE IF NOT EXISTS dong_bo (
    id TEXT PRIMARY KEY,
    ma_may_local TEXT NOT NULL,
    ten_bang TEXT NOT NULL,
    last_updated_at TIMESTAMPTZ NULL,
    last_record_id TEXT NULL,
    last_version BIGINT NOT NULL DEFAULT 0,
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('IDLE', 'RUNNING', 'SUCCESS', 'FAILED')),
    so_ban_ghi_dong_bo BIGINT NOT NULL DEFAULT 0,
    loi_cuoi TEXT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (ma_may_local, ten_bang)
);

-- 16. Bảng quản lý Archive Manifest trên Cloudflare R2
CREATE TABLE IF NOT EXISTS archive_manifest (
    id TEXT PRIMARY KEY,
    ky_thang TEXT NOT NULL UNIQUE, -- Định dạng YYYY-MM
    r2_object_key TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    row_counts_json TEXT NOT NULL,
    tong_thu BIGINT NOT NULL DEFAULT 0,
    tong_chi BIGINT NOT NULL DEFAULT 0,
    sha256_checksum TEXT NOT NULL,
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('DA_TAO', 'DA_XAC_MINH', 'LOI')),
    verified_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT nextval('sync_version_seq')
);

-- =====================================================================
-- INDEXES PHỤC VỤ TRUY VẤN THỐNG KÊ & ĐỒNG BỘ WATERMARK
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_giao_dich_ngay_loai ON giao_dich (ngay_giao_dich, loai_giao_dich, trang_thai) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_giao_dich_nguoi_thuc_hien ON giao_dich (nguoi_thuc_hien_id, ngay_giao_dich) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_giao_dich_nguoi_giu_tien ON giao_dich (nguoi_giu_tien_id, trang_thai) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_giao_dich_doi_tuong ON giao_dich (doi_tuong_thu_huong_id, ngay_giao_dich) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_giao_dich_danh_muc ON giao_dich (danh_muc_id, ngay_giao_dich) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_giao_dich_sync ON giao_dich (version, id);

CREATE INDEX IF NOT EXISTS idx_phan_bo_giao_dich_dt ON phan_bo_giao_dich (doi_tuong_id, giao_dich_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_phan_bo_sync ON phan_bo_giao_dich (version, id);

CREATE INDEX IF NOT EXISTS idx_chuyen_tien_trang_thai ON chuyen_tien_noi_bo (trang_thai, ngay_chuyen) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chuyen_tien_sync ON chuyen_tien_noi_bo (version, id);

CREATE INDEX IF NOT EXISTS idx_yeu_cau_xac_nhan_pending ON yeu_cau_xac_nhan (nguoi_can_xac_nhan_id, trang_thai, expires_at);
CREATE INDEX IF NOT EXISTS idx_lich_su_chinh_sua_record ON lich_su_chinh_sua (ten_bang, ban_ghi_id, created_at);

COMMIT;

