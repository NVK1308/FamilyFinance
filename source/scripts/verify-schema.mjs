import fs from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const root = 'F:/FamilyFinance/source';
const sqliteSchemaPath = `${root}/desktop/FamilyFinance.Data/Migrations/0001_initial_schema.sqlite.sql`;
const sqlite0002Path = `${root}/desktop/FamilyFinance.Data/Migrations/0002_giao_dich_chieu_dieu_chinh.sqlite.sql`;
const postgres0002Path = `${root}/backend/migrations/0002_giao_dich_chieu_dieu_chinh.postgres.sql`;
const seed0002Path = `${root}/backend/seeds/0002_seed_lai_cho_vay.sql`;
const sqlite0003Path = `${root}/desktop/FamilyFinance.Data/Migrations/0003_chuyen_quy_chung.sqlite.sql`;
const postgres0003Path = `${root}/backend/migrations/0003_chuyen_quy_chung.postgres.sql`;
const sqlite0004Path = `${root}/desktop/FamilyFinance.Data/Migrations/0004_hu_tiet_kiem.sqlite.sql`;
const postgres0004Path = `${root}/backend/migrations/0004_hu_tiet_kiem.postgres.sql`;
const sqlite0005Path = `${root}/desktop/FamilyFinance.Data/Migrations/0005_nhieu_hu.sqlite.sql`;
const postgres0005Path = `${root}/backend/migrations/0005_nhieu_hu.postgres.sql`;
const sqlite0006Path = `${root}/desktop/FamilyFinance.Data/Migrations/0006_gia_vang.sqlite.sql`;
const postgres0006Path = `${root}/backend/migrations/0006_gia_vang.postgres.sql`;
const sqlite0007Path = `${root}/desktop/FamilyFinance.Data/Migrations/0007_bao_cao_da_gui.sqlite.sql`;
const postgres0007Path = `${root}/backend/migrations/0007_bao_cao_da_gui.postgres.sql`;
const postgresSchemaPath = `${root}/backend/migrations/0001_initial_schema.postgres.sql`;
const seedPath = `${root}/backend/seeds/0001_seed_reference_data.sql`;
const contractsPath = `${root}/shared/contracts/domain-contracts.json`;
const testCasesPath = `${root}/shared/contracts/parser-test-cases.json`;

// 1. Kiểm tra JSON contracts và test cases
const contracts = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));
const testCases = JSON.parse(fs.readFileSync(testCasesPath, 'utf8'));
assert.equal(contracts.version, '4.0.0');
assert.equal(testCases.transactionCases.length, 14);
assert.equal(testCases.transferCases.length, 4);
assert.equal(testCases.fundCases.length, 4);

// 2. Kiểm tra thực thi SQLite Schema + Seed trên In-Memory DB
const db = new DatabaseSync(':memory:');
const sqliteSchema = fs.readFileSync(sqliteSchemaPath, 'utf8');
const seedSql = fs.readFileSync(seedPath, 'utf8')
  .replace(/\bTRUE\b/g, '1')
  .replace(/\bFALSE\b/g, '0');

db.exec(sqliteSchema);
db.exec(seedSql);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
assert.equal(tables.length, 16, `Expected 16 tables, got ${tables.length}`);

// 3. Kiểm tra số lượng bản ghi seed
const memberCount = db.prepare('SELECT COUNT(*) AS c FROM thanh_vien').get().c;
const categoryCount = db.prepare('SELECT COUNT(*) AS c FROM danh_muc').get().c;
const keywordCount = db.prepare('SELECT COUNT(*) AS c FROM tu_khoa_danh_muc').get().c;
const beneficiaryCount = db.prepare('SELECT COUNT(*) AS c FROM doi_tuong_thu_huong').get().c;

assert.equal(memberCount, 2);
assert.equal(categoryCount, 24);
assert.equal(keywordCount, 20);
assert.equal(beneficiaryCount, 5);

// 4. Kiểm tra ràng buộc toàn vẹn (CHECK & UNIQUE constraints)
// 4a. Không cho phép so_tien <= 0
assert.throws(() => {
  db.prepare(`
    INSERT INTO giao_dich (id, loai_giao_dich, so_tien, nguoi_tao_id, nguoi_thuc_hien_id, mo_ta, ngay_giao_dich, trang_thai, idempotency_key, created_at, updated_at)
    VALUES ('GD_ERR_1', 'CHI', 0, 'VO', 'VO', 'Test 0đ', '2026-11-04', 'HOAN_TAT', 'KEY_1', '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z')
  `).run();
}, /CHECK constraint failed/);

// 4b. Không cho phép nguoi_chuyen_id = nguoi_nhan_id
assert.throws(() => {
  db.prepare(`
    INSERT INTO chuyen_tien_noi_bo (id, nguoi_chuyen_id, nguoi_nhan_id, so_tien, ngay_chuyen, trang_thai, idempotency_key, created_at, updated_at)
    VALUES ('CT_ERR_1', 'CHONG', 'CHONG', 1000000, '2026-11-04', 'CHO_XAC_NHAN', 'CT_KEY_1', '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z')
  `).run();
}, /CHECK constraint failed/);

// 4c. Không cho phép nguoi_giu_tien_id sai danh mục chuẩn
assert.throws(() => {
  db.prepare(`
    INSERT INTO giao_dich (id, loai_giao_dich, so_tien, nguoi_tao_id, nguoi_thuc_hien_id, nguoi_giu_tien_id, mo_ta, ngay_giao_dich, trang_thai, idempotency_key, created_at, updated_at)
    VALUES ('GD_ERR_2', 'CHI', 50000, 'VO', 'VO', 'NGUOI_LA', 'Test sai người giữ', '2026-11-04', 'HOAN_TAT', 'KEY_2', '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z')
  `).run();
}, /CHECK constraint failed/);

// 4d. Kiểm tra PostgreSQL schema có đủ 16 CREATE TABLE
const pgSchema = fs.readFileSync(postgresSchemaPath, 'utf8');
const pgTables = [...pgSchema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]).sort();
assert.deepEqual(pgTables, tables, 'Danh sách bảng giữa PostgreSQL và SQLite phải khớp 100%');

// 5. Migration 0002: SQLite gắn CHECK vào cột, Postgres dùng ADD CONSTRAINT có tên (cùng 3 điều kiện)
const toSqliteSeed = (file) => fs.readFileSync(file, 'utf8').replace(/\bTRUE\b/g, '1').replace(/\bFALSE\b/g, '0');
db.exec(fs.readFileSync(sqlite0002Path, 'utf8'));
db.exec(toSqliteSeed(seed0002Path));
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM danh_muc WHERE ma_danh_muc = 'LAI_CHO_VAY'").get().c, 1);
const insertGd = (id, loai, holder, chieu) => db.prepare(`
  INSERT INTO giao_dich (id, loai_giao_dich, so_tien, nguoi_tao_id, nguoi_thuc_hien_id, nguoi_giu_tien_id, chieu_dieu_chinh, mo_ta, ngay_giao_dich, trang_thai, idempotency_key, created_at, updated_at)
  VALUES (?, ?, 1000, 'VO', 'VO', ?, ?, 'x', '2026-11-04', 'HOAN_TAT', ?, '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z')
`).run(id, loai, holder, chieu, id);
assert.throws(() => insertGd('GD_0002_1', 'CHI', null, null), /CHECK constraint failed/);
assert.throws(() => insertGd('GD_0002_2', 'DIEU_CHINH', 'VO', null), /CHECK constraint failed/);
assert.throws(() => insertGd('GD_0002_3', 'CHI', 'VO', 'TANG'), /CHECK constraint failed/);
insertGd('GD_0002_4', 'DIEU_CHINH', 'VO', 'GIAM');
const pg0002 = fs.readFileSync(postgres0002Path, 'utf8');
for (const name of ['chk_giao_dich_chieu_dieu_chinh_gia_tri', 'chk_giao_dich_dieu_chinh_co_chieu', 'chk_giao_dich_hoan_tat_co_nguoi_giu']) {
  assert.ok(pg0002.includes(`ADD CONSTRAINT ${name}`), `Thiếu constraint ${name} trong 0002 Postgres`);
}
assert.ok(pg0002.includes('ADD COLUMN IF NOT EXISTS chieu_dieu_chinh'));

// 6. Migration 0003: bảng chuyen_quy_chung (17 bảng), chạy lại được
const sql0003 = fs.readFileSync(sqlite0003Path, 'utf8');
db.exec(sql0003);
db.exec(sql0003);
const tables0003 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
assert.equal(tables0003.length, 17, `Sau 0003 phải có 17 bảng, có ${tables0003.length}`);
const insertQuy = (id, chieu, nhom, soTien, trangThai) => db.prepare(`
  INSERT INTO chuyen_quy_chung (id, chieu, thanh_vien_id, nhom_id, so_tien, ngay_chuyen, trang_thai, idempotency_key, created_at, updated_at)
  VALUES (?, ?, 'VO', ?, ?, '2026-11-05', ?, ?, '2026-11-05T00:00:00Z', '2026-11-05T00:00:00Z')
`).run(id, chieu, nhom, soTien, trangThai, id);
assert.throws(() => insertQuy('Q1', 'KHAC', 'VO', 1000, 'HOAN_TAT'), /CHECK constraint failed/);
assert.throws(() => insertQuy('Q2', 'NOP', 'QUY_CHUNG', 1000, 'HOAN_TAT'), /CHECK constraint failed/);
assert.throws(() => insertQuy('Q3', 'NOP', 'VO', 0, 'HOAN_TAT'), /CHECK constraint failed/);
assert.throws(() => insertQuy('Q4', 'NOP', 'VO', 1000, 'CHO_XAC_NHAN'), /CHECK constraint failed/);
insertQuy('Q5', 'NOP', 'VO', 1000, 'HOAN_TAT');
assert.throws(() => insertQuy('Q5', 'RUT', 'VO', 1000, 'HOAN_TAT'), /UNIQUE constraint failed|PRIMARY KEY/);
const pg0003 = fs.readFileSync(postgres0003Path, 'utf8');
const pgTables0003 = [...pg0003.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]);
assert.deepEqual([...pgTables, ...pgTables0003].sort(), tables0003, 'Bảng Postgres (0001+0003) phải khớp SQLite');
for (const part of ["CHECK (chieu IN ('NOP', 'RUT'))", "CHECK (nhom_id IN ('VO', 'CHONG'))", 'idempotency_key TEXT NOT NULL UNIQUE', "DEFAULT nextval('sync_version_seq')"]) {
  assert.ok(pg0003.includes(part), `0003 Postgres thiếu: ${part}`);
}
const syncOrder = contracts.syncTablesOrder;
assert.ok(syncOrder.indexOf('chuyen_quy_chung') > syncOrder.indexOf('chuyen_tien_noi_bo'), 'syncTablesOrder thiếu chuyen_quy_chung');

// 7. Migration 0004: bảng hu_tiet_kiem (18 bảng), CHECK theo loại tài sản / chiều / nguồn, chạy lại được
const sql0004 = fs.readFileSync(sqlite0004Path, 'utf8');
db.exec(sql0004);
db.exec(sql0004);
const tables0004 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
assert.equal(tables0004.length, 18, `Sau 0004 phải có 18 bảng, có ${tables0004.length}`);
const insertHu = (id, chieu, loai, phan, soTien, nguon) => db.prepare(`
  INSERT INTO hu_tiet_kiem (id, chieu, loai_tai_san, so_luong_phan, so_tien, nguon_id, thanh_vien_id, ngay, trang_thai, idempotency_key, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 'VO', '2026-11-06', 'HOAN_TAT', ?, '2026-11-06T00:00:00Z', '2026-11-06T00:00:00Z')
`).run(id, chieu, loai, phan, soTien, nguon, id);
insertHu('H1', 'NOP', 'TIEN', null, 1000, 'VO');
insertHu('H2', 'KHAI_BAO', 'TIEN', null, 1000, null);
insertHu('H3', 'NOP', 'VANG', 10, null, null); // vàng không giá: không trừ ai
assert.throws(() => insertHu('H4', 'NOP', 'TIEN', null, null, 'VO'), /CHECK constraint failed/); // tiền phải có số tiền
assert.throws(() => insertHu('H5', 'NOP', 'TIEN', 10, 1000, 'VO'), /CHECK constraint failed/); // tiền không có số lượng
assert.throws(() => insertHu('H6', 'NOP', 'VANG', null, 1000, 'VO'), /CHECK constraint failed/); // vàng phải có số lượng
assert.throws(() => insertHu('H7', 'KHAI_BAO', 'TIEN', null, 1000, 'VO'), /CHECK constraint failed/); // khai báo không có nguồn
assert.throws(() => insertHu('H8', 'NOP', 'TIEN', null, 1000, null), /CHECK constraint failed/); // có tiền phải có nguồn
assert.throws(() => insertHu('H9', 'NOP', 'TIEN', null, 1000, 'CHUA_XAC_DINH'), /CHECK constraint failed/);
const pg0004 = fs.readFileSync(postgres0004Path, 'utf8');
const pgTables0004 = [...pg0004.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]);
assert.deepEqual([...pgTables, ...pgTables0003, ...pgTables0004].sort(), tables0004, 'Bảng Postgres (0001+0003+0004) phải khớp SQLite');
for (const part of ["CHECK (chieu IN ('KHAI_BAO', 'NOP', 'RUT'))", "CHECK (loai_tai_san IN ('TIEN', 'VANG'))", 'idempotency_key TEXT NOT NULL UNIQUE', "DEFAULT nextval('sync_version_seq')"]) {
  assert.ok(pg0004.includes(part), `0004 Postgres thiếu: ${part}`);
}
assert.ok(syncOrder.includes('hu_tiet_kiem'), 'syncTablesOrder thiếu hu_tiet_kiem');
assert.ok(contracts.enums.MessageIntent.includes('SAVINGS_MOVE'), 'MessageIntent thiếu SAVINGS_MOVE');

// 8. Migration 0005: bảng hu (19 bảng) + hu_tiet_kiem.hu_id / giao_dich_id. SQLite ALTER chỉ chạy 1 lần.
db.exec(fs.readFileSync(sqlite0005Path, 'utf8'));
const tables0005 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
assert.equal(tables0005.length, 19, `Sau 0005 phải có 19 bảng, có ${tables0005.length}`);
assert.equal(db.prepare("SELECT hu_id FROM hu_tiet_kiem WHERE id = 'H1'").get().hu_id, 'TIET_KIEM', 'Dòng cũ phải về hũ mặc định');
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM hu WHERE id = 'TIET_KIEM'").get().c, 1);
const insertJarRow = (id, key, deleted) => db.prepare(`
  INSERT INTO hu (id, ten, ten_khong_dau, created_at, updated_at, deleted_at) VALUES (?, ?, ?, '2026-11-09T00:00:00Z', '2026-11-09T00:00:00Z', ?)
`).run(id, key, key, deleted);
insertJarRow('HU_1', 'mua nha', null);
assert.throws(() => insertJarRow('HU_2', 'mua nha', null), /UNIQUE constraint failed/); // trùng tên hũ đang dùng
insertJarRow('HU_3', 'y te', '2026-11-09T00:00:00Z');
insertJarRow('HU_4', 'y te', null); // tên của hũ đã xoá mềm dùng lại được
const pg0005 = fs.readFileSync(postgres0005Path, 'utf8');
const pgTables0005 = [...pg0005.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]);
assert.deepEqual([...pgTables, ...pgTables0003, ...pgTables0004, ...pgTables0005].sort(), tables0005, 'Bảng Postgres (0001+0003+0004+0005) phải khớp SQLite');
for (const part of ['ADD COLUMN IF NOT EXISTS hu_id', 'ADD COLUMN IF NOT EXISTS giao_dich_id', 'uq_hu_ten_khong_dau', 'uq_hu_tiet_kiem_giao_dich', "DEFAULT nextval('sync_version_seq')"]) {
  assert.ok(pg0005.includes(part), `0005 Postgres thiếu: ${part}`);
}
assert.ok(syncOrder.indexOf('hu') >= 0 && syncOrder.indexOf('hu') < syncOrder.indexOf('hu_tiet_kiem'), 'syncTablesOrder: hu phải trước hu_tiet_kiem');

// 9. Migration 0006: gia_vang (20 bảng), giá > 0, chạy lại được
db.exec(fs.readFileSync(sqlite0006Path, 'utf8'));
db.exec(fs.readFileSync(sqlite0006Path, 'utf8'));
const tables0006 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
assert.equal(tables0006.length, 20, `Sau 0006 phải có 20 bảng, có ${tables0006.length}`);
assert.throws(() => db.prepare(`
  INSERT INTO gia_vang (id, gia_chi, ngay, thanh_vien_id, idempotency_key, created_at, updated_at) VALUES ('G0', 0, '2026-11-10', 'VO', 'k0', 'x', 'x')
`).run(), /CHECK constraint failed/);
const pg0006 = fs.readFileSync(postgres0006Path, 'utf8');
const pgTables0006 = [...pg0006.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]);
assert.deepEqual([...pgTables, ...pgTables0003, ...pgTables0004, ...pgTables0005, ...pgTables0006].sort(), tables0006, 'Bảng Postgres (0001+0003..0006) phải khớp SQLite');
assert.ok(pg0006.includes("DEFAULT nextval('sync_version_seq')"), '0006 Postgres thiếu version seq');
assert.ok(syncOrder.includes('gia_vang'), 'syncTablesOrder thiếu gia_vang');

// 10. Migration 0007: bao_cao_da_gui (21 bảng, bảng vận hành — không đồng bộ), 1 dòng / (tháng, người)
db.exec(fs.readFileSync(sqlite0007Path, 'utf8'));
db.exec(fs.readFileSync(sqlite0007Path, 'utf8'));
const tables0007 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
assert.equal(tables0007.length, 21, `Sau 0007 phải có 21 bảng, có ${tables0007.length}`);
const insertReport = (id, ky) => db.prepare(`
  INSERT INTO bao_cao_da_gui (id, ky, thanh_vien_id, trang_thai, created_at, updated_at) VALUES (?, ?, 'VO', 'DA_GUI', 'x', 'x')
`).run(id, ky);
insertReport('B1', '2026-10');
assert.throws(() => insertReport('B2', '2026-10'), /UNIQUE constraint failed/);
assert.throws(() => insertReport('B3', '2026/10'), /CHECK constraint failed/);
const pg0007 = fs.readFileSync(postgres0007Path, 'utf8');
const pgTables0007 = [...pg0007.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]);
assert.deepEqual([...pgTables, ...pgTables0003, ...pgTables0004, ...pgTables0005, ...pgTables0006, ...pgTables0007].sort(), tables0007, 'Bảng Postgres (0001+0003..0007) phải khớp SQLite');
assert.ok(pg0007.includes('UNIQUE (ky, thanh_vien_id)'), '0007 Postgres thiếu UNIQUE (ky, thanh_vien_id)');

console.log('✅ Schema & Contracts Verification PASSED!');
console.log('   - Tables verified (PostgreSQL & SQLite 1:1):', tables.length);
console.log(`   - Seed data verified: ${memberCount} members, ${categoryCount} categories, ${keywordCount} keywords, ${beneficiaryCount} beneficiaries`);
console.log('   - Integrity constraints verified: positive amount, distinct transfer parties, valid money holder');
console.log('   - Migration 0007 verified: bao_cao_da_gui (21 bảng), 1 dòng / (tháng, người), kỳ YYYY-MM');
console.log('   - Migration 0006 verified: gia_vang (20 bảng), giá > 0, chạy lại được');
console.log('   - Migration 0005 verified: hu (19 bảng), hu_id/giao_dich_id, tên hũ duy nhất (trừ hũ đã xoá), dòng cũ → TIET_KIEM');
console.log('   - Migration 0004 verified: hu_tiet_kiem (18 bảng), CHECK tiền/vàng/khai báo/nguồn, chạy lại được');
console.log('   - Migration 0003 verified: chuyen_quy_chung (17 bảng), CHECK chieu/nhom_id/so_tien/trang_thai, chạy lại được');
console.log('   - Migration 0002 verified: chieu_dieu_chinh + HOAN_TAT có người giữ (SQLite chạy thật, Postgres kiểm tên constraint)');

