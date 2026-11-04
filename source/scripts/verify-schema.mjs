import fs from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const root = 'F:/FamilyFinance/source';
const sqliteSchemaPath = `${root}/desktop/FamilyFinance.Data/Migrations/0001_initial_schema.sqlite.sql`;
const sqlite0002Path = `${root}/desktop/FamilyFinance.Data/Migrations/0002_giao_dich_chieu_dieu_chinh.sqlite.sql`;
const postgres0002Path = `${root}/backend/migrations/0002_giao_dich_chieu_dieu_chinh.postgres.sql`;
const seed0002Path = `${root}/backend/seeds/0002_seed_lai_cho_vay.sql`;
const postgresSchemaPath = `${root}/backend/migrations/0001_initial_schema.postgres.sql`;
const seedPath = `${root}/backend/seeds/0001_seed_reference_data.sql`;
const contractsPath = `${root}/shared/contracts/domain-contracts.json`;
const testCasesPath = `${root}/shared/contracts/parser-test-cases.json`;

// 1. Kiểm tra JSON contracts và test cases
const contracts = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));
const testCases = JSON.parse(fs.readFileSync(testCasesPath, 'utf8'));
assert.equal(contracts.version, '4.0.0');
assert.equal(testCases.transactionCases.length, 12);
assert.equal(testCases.transferCases.length, 2);

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
const toSqliteSeed = (file) => fs.readFileSync(file, 'utf8').replace(/TRUE/g, '1').replace(/FALSE/g, '0');
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

console.log('✅ Schema & Contracts Verification PASSED!');
console.log('   - Tables verified (PostgreSQL & SQLite 1:1):', tables.length);
console.log(`   - Seed data verified: ${memberCount} members, ${categoryCount} categories, ${keywordCount} keywords, ${beneficiaryCount} beneficiaries`);
console.log('   - Integrity constraints verified: positive amount, distinct transfer parties, valid money holder');
console.log('   - Migration 0002 verified: chieu_dieu_chinh + HOAN_TAT có người giữ (SQLite chạy thật, Postgres kiểm tên constraint)');

