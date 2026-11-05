import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { MEMBER_ID, type MoneyHolderId } from '../src/config/constants.ts';
import { DomainError, HOLDERS, type HolderAmounts } from '../src/services/index.ts';
import {
  BACKENDS,
  INITIAL_DATE,
  apiKey,
  assertInvariant,
  count,
  expectDomainError,
  insertTransfer,
  seedInitial,
  snapshotCounts,
  type TestEnv,
} from './helpers/phase3-env.ts';

const ASOF = '2026-11-30';

async function holders(env: TestEnv, asOf = ASOF): Promise<HolderAmounts> {
  const r = await env.bal.getHolderBalances(asOf);
  assert.equal(r.status, 'OK');
  if (r.status !== 'OK') throw new Error('unreachable');
  return r.nhom;
}

function explicit(
  env: TestEnv,
  loai: 'THU' | 'CHI' | 'PHI' | 'LAI_VAY' | 'DIEU_CHINH',
  soTien: number,
  holder: MoneyHolderId,
  extra: { ngay?: string; maDanhMuc?: string | null; chieu?: 'TANG' | 'GIAM' } = {},
) {
  const defaultCategory = loai === 'THU' ? 'LUONG' : loai === 'CHI' ? 'THUC_AN' : null;
  return env.txs.recordExplicit({
    idempotencyKey: apiKey(),
    loai,
    soTien,
    maDanhMuc: extra.maDanhMuc !== undefined ? extra.maDanhMuc : defaultCategory,
    nguoiTaoId: MEMBER_ID.CHONG,
    nguoiGiuTienId: holder,
    chieuDieuChinh: extra.chieu ?? null,
    moTa: `${loai} test`,
    ngayGiaoDich: extra.ngay ?? '2026-11-05',
  });
}

function loan(env: TestEnv, chieuNo: 'DI_VAY' | 'CHO_VAY', soTien: number, holder: MoneyHolderId) {
  return env.debt.createLoan({
    idempotencyKey: apiKey(), chieuNo, tenKhoanNo: `${chieuNo} test`, doiTac: 'Đối tác',
    soTien, ngay: '2026-11-05', nguoiTaoId: MEMBER_ID.CHONG, nguoiGiuTienId: holder,
  });
}

function repay(env: TestEnv, khoanNoId: string, soTien: number, holder: MoneyHolderId) {
  return env.debt.repayPrincipal({
    idempotencyKey: apiKey(), khoanNoId, soTien, ngay: '2026-11-06', nguoiTaoId: MEMBER_ID.CHONG, nguoiGiuTienId: holder,
  });
}

// PRNG cố định để T25 lặp lại được
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

for (const backend of BACKENDS) {
  describe(`Phase 3 — số dư và nợ [${backend.name}]`, () => {
    let env: TestEnv;
    beforeEach(async () => {
      env = await backend.open();
    });
    afterEach(async () => {
      await env.close();
    });

    it('T10: số dư ban đầu + THU/CHI/PHI/LAI_VAY nhiều nhóm → từng nhóm đúng, tổng nhóm = gia đình', async () => {
      await seedInitial(env);
      await explicit(env, 'THU', 20_000_000, 'CHONG');
      await explicit(env, 'CHI', 50_000, 'VO');
      await explicit(env, 'PHI', 10_000, 'QUY_CHUNG');
      await explicit(env, 'LAI_VAY', 100_000, 'CHONG');
      await explicit(env, 'CHI', 70_000, 'CHUA_XAC_DINH');
      assert.deepEqual(await holders(env), {
        VO: 4_950_000, CHONG: 22_900_000, QUY_CHUNG: 1_990_000, CHUA_XAC_DINH: -70_000,
      });
      assert.equal(await assertInvariant(env, ASOF), 29_770_000);
    });

    it('Q7: setInitialBalance kiểm tổng, cập nhật dòng có sẵn (kể cả xoá mềm), không chèn thêm', async () => {
      await expectDomainError(
        env.bal.setInitialBalance({
          ngayApDung: INITIAL_DATE, theoNhom: { VO: 1, CHONG: 1, QUY_CHUNG: 1, CHUA_XAC_DINH: 0 }, tongNhap: 4, nguoiXacNhanId: 'VO',
        }),
        'INVALID_INPUT',
      );
      await seedInitial(env);
      await env.db.execute("UPDATE so_du_ban_dau SET deleted_at = $1 WHERE nguoi_giu_tien_id = 'VO'", ['2026-11-02T00:00:00.000Z']);
      assert.equal((await env.bal.getHolderBalances(ASOF)).status, 'CHUA_CO_SO_DU_BAN_DAU');
      await seedInitial(env, 7_000_000);
      assert.equal(await count(env.db, 'so_du_ban_dau'), 4);
      assert.equal(await count(env.db, 'so_du_ban_dau', 'deleted_at IS NULL'), 4);
      assert.equal((await holders(env)).VO, 7_000_000);
    });

    it('T11 + T25b: chưa nhập số dư ban đầu / asOf trước ngày áp dụng → trả cờ, không trả 0', async () => {
      assert.equal((await env.bal.getHolderBalances(ASOF)).status, 'CHUA_CO_SO_DU_BAN_DAU');
      assert.equal((await env.bal.getFamilyBalance(ASOF)).status, 'CHUA_CO_SO_DU_BAN_DAU');
      await seedInitial(env);
      const early = await env.bal.getFamilyBalance('2026-10-31');
      assert.equal(early.status, 'ASOF_TRUOC_NGAY_AP_DUNG');
      assert.equal('soDu' in early, false);
    });

    it('T12: giao dịch trước ngày áp dụng / sau asOf không tính', async () => {
      await seedInitial(env);
      await explicit(env, 'CHI', 100_000, 'VO', { ngay: '2026-10-31' });
      await explicit(env, 'CHI', 200_000, 'VO', { ngay: '2026-12-01' });
      await explicit(env, 'CHI', 300_000, 'VO', { ngay: INITIAL_DATE });
      await explicit(env, 'CHI', 400_000, 'VO', { ngay: ASOF });
      assert.equal((await holders(env)).VO, 5_000_000 - 700_000);
      await assertInvariant(env, ASOF);
    });

    it('T13: chuyển nội bộ chỉ tính khoản DA_XAC_NHAN trong kỳ; tổng và THU/CHI không đổi', async () => {
      await seedInitial(env);
      const totalsBefore = await env.bal.getPeriodTotals(INITIAL_DATE, ASOF);
      const familyBefore = await assertInvariant(env, ASOF);
      await insertTransfer(env.db, 'CT1', 'VO', 'CHONG', 1_000_000, '2026-11-10', 'DA_XAC_NHAN');
      await insertTransfer(env.db, 'CT2', 'VO', 'CHONG', 500_000, '2026-11-10', 'CHO_XAC_NHAN');
      await insertTransfer(env.db, 'CT3', 'CHONG', 'VO', 700_000, '2026-11-10', 'TU_CHOI');
      await insertTransfer(env.db, 'CT4', 'VO', 'CHONG', 900_000, '2026-12-05', 'DA_XAC_NHAN');
      const h = await holders(env);
      assert.equal(h.VO, 4_000_000);
      assert.equal(h.CHONG, 4_000_000);
      assert.equal(await assertInvariant(env, ASOF), familyBefore);
      assert.deepEqual(await env.bal.getPeriodTotals(INITIAL_DATE, ASOF), totalsBefore);
    });

    it('T14: giao dịch CHO_XAC_NHAN / DA_HUY / deleted_at không tính', async () => {
      await seedInitial(env);
      const a = await explicit(env, 'CHI', 100_000, 'VO');
      const b = await explicit(env, 'CHI', 200_000, 'VO');
      await env.txs.cancelTransaction(a.transaction.id, 'VO');
      await env.db.execute('UPDATE giao_dich SET deleted_at = $2 WHERE id = $1', [b.transaction.id, '2026-11-06T00:00:00.000Z']);
      await env.db.execute(
        `INSERT INTO giao_dich (id, loai_giao_dich, so_tien, nguoi_tao_id, nguoi_thuc_hien_id, nguoi_giu_tien_id, mo_ta,
           ngay_giao_dich, trang_thai, idempotency_key, created_at, updated_at, version)
         VALUES ('GD_CHO', 'CHI', 300000, 'VO', 'VO', 'VO', 'chờ', '2026-11-05', 'CHO_XAC_NHAN', 'test:cho', $1, $1, $2)`,
        ['2026-11-05T00:00:00.000Z', await env.db.nextVersion()],
      );
      assert.equal((await holders(env)).VO, 5_000_000);
      await assertInvariant(env, ASOF);
    });

    it('T15: tổng kỳ — THU chỉ THU; CHI = CHI+LAI_VAY+PHI; VAY/TRA_NO/DIEU_CHINH không vào', async () => {
      await seedInitial(env);
      await explicit(env, 'THU', 1_000_000, 'VO');
      await explicit(env, 'CHI', 100_000, 'VO');
      await explicit(env, 'LAI_VAY', 20_000, 'VO');
      await explicit(env, 'PHI', 3_000, 'VO');
      await explicit(env, 'DIEU_CHINH', 5_000_000, 'VO', { chieu: 'TANG' });
      const l = await loan(env, 'DI_VAY', 9_000_000, 'CHONG');
      await repay(env, l.loan.id, 1_000_000, 'CHONG');
      assert.deepEqual(await env.bal.getPeriodTotals(INITIAL_DATE, ASOF), {
        tongThu: 1_000_000, tongChi: 123_000, chenhLech: 877_000,
      });
    });

    it('T16: DIEU_CHINH TANG/GIAM qua hàm tường minh; thiếu chiều → lỗi', async () => {
      await seedInitial(env);
      await explicit(env, 'DIEU_CHINH', 300_000, 'VO', { chieu: 'TANG' });
      await explicit(env, 'DIEU_CHINH', 100_000, 'CHONG', { chieu: 'GIAM' });
      const h = await holders(env);
      assert.equal(h.VO, 5_300_000);
      assert.equal(h.CHONG, 2_900_000);
      await assertInvariant(env, ASOF);
      await expectDomainError(explicit(env, 'DIEU_CHINH', 1, 'VO'), 'INVALID_INPUT');
      await expectDomainError(explicit(env, 'CHI', 1, 'VO', { chieu: 'TANG' }), 'INVALID_INPUT');
    });

    it('T17: DI_VAY 10tr → trả gốc 4tr → trả lãi 200k', async () => {
      await seedInitial(env);
      const l = await loan(env, 'DI_VAY', 10_000_000, 'CHONG');
      await repay(env, l.loan.id, 4_000_000, 'CHONG');
      const interest = await env.debt.payInterest({
        idempotencyKey: apiKey(), khoanNoId: l.loan.id, soTien: 200_000, ngay: '2026-11-07', nguoiTaoId: 'CHONG', nguoiGiuTienId: 'CHONG',
      });
      assert.equal(Number(interest.loan.du_no_hien_tai), 6_000_000);
      const out = await env.debt.getOutstanding();
      assert.equal(Number(out[0]?.loan.du_no_hien_tai), 6_000_000);
      assert.equal(out[0]?.duNoTheoLichSu, 6_000_000);
      assert.equal(await count(env.db, 'lich_su_no', 'khoan_no_id = $1', [l.loan.id]), 3);
      assert.equal((await holders(env)).CHONG, 3_000_000 + 10_000_000 - 4_000_000 - 200_000);
      await assertInvariant(env, ASOF);
    });

    it('T18: trả gốc vượt dư nợ → lỗi, rollback toàn bộ', async () => {
      const l = await loan(env, 'DI_VAY', 5_000_000, 'CHONG');
      const before = await snapshotCounts(env.db);
      await expectDomainError(repay(env, l.loan.id, 5_000_001, 'CHONG'), 'OVERPAY');
      assert.deepEqual(await snapshotCounts(env.db), before);
      const row = await env.db.queryOne<{ du_no_hien_tai: number }>('SELECT du_no_hien_tai FROM khoan_no WHERE id = $1', [l.loan.id]);
      assert.equal(Number(row?.du_no_hien_tai), 5_000_000);
    });

    it('T19: trả hết → DA_TAT_TOAN; huỷ lần trả cuối → mở lại DANG_NO', async () => {
      const l = await loan(env, 'DI_VAY', 5_000_000, 'CHONG');
      await repay(env, l.loan.id, 2_000_000, 'CHONG');
      const last = await repay(env, l.loan.id, 3_000_000, 'CHONG');
      assert.equal(last.loan.trang_thai, 'DA_TAT_TOAN');
      assert.equal(Number(last.loan.du_no_hien_tai), 0);
      await expectDomainError(repay(env, l.loan.id, 1, 'CHONG'), 'LOAN_CLOSED');
      await env.txs.cancelTransaction(last.transaction.id, 'CHONG');
      const row = await env.db.queryOne<{ trang_thai: string; du_no_hien_tai: number }>('SELECT * FROM khoan_no WHERE id = $1', [l.loan.id]);
      assert.equal(row?.trang_thai, 'DANG_NO');
      assert.equal(Number(row?.du_no_hien_tai), 3_000_000);
    });

    it('T19b: huỷ giải ngân khi chưa trả gốc → khoản nợ DA_HUY, không nhận ghi thêm', async () => {
      const l = await loan(env, 'DI_VAY', 1_000_000, 'CHONG');
      await env.txs.cancelTransaction(l.transaction.id, 'CHONG');
      const row = await env.db.queryOne<{ trang_thai: string; du_no_hien_tai: number }>('SELECT * FROM khoan_no WHERE id = $1', [l.loan.id]);
      assert.equal(row?.trang_thai, 'DA_HUY');
      assert.equal(Number(row?.du_no_hien_tai), 0);
      await expectDomainError(repay(env, l.loan.id, 1, 'CHONG'), 'LOAN_CLOSED');
      await expectDomainError(
        env.debt.payInterest({ idempotencyKey: apiKey(), khoanNoId: l.loan.id, soTien: 1, ngay: '2026-11-07', nguoiTaoId: 'CHONG', nguoiGiuTienId: 'CHONG' }),
        'LOAN_CLOSED',
      );
    });

    it('T20 + Q11: CHO_VAY 5tr → thu gốc 2tr: nhóm −5tr +2tr, dư nợ 3tr, không vào THU; lãi cho vay vào THU', async () => {
      await seedInitial(env);
      const familyStart = await assertInvariant(env, ASOF);
      const l = await loan(env, 'CHO_VAY', 5_000_000, 'VO');
      const back = await repay(env, l.loan.id, 2_000_000, 'VO');
      assert.equal(Number(back.loan.du_no_hien_tai), 3_000_000);
      assert.equal(await count(env.db, 'lich_su_no', "loai_bien_dong = 'THU_GOC'"), 1);
      assert.equal((await holders(env)).VO, 5_000_000 - 5_000_000 + 2_000_000);
      assert.equal(await assertInvariant(env, ASOF), familyStart - 3_000_000);
      assert.equal((await env.bal.getPeriodTotals(INITIAL_DATE, ASOF)).tongThu, 0);
      await expectDomainError(
        env.debt.payInterest({ idempotencyKey: apiKey(), khoanNoId: l.loan.id, soTien: 1, ngay: '2026-11-07', nguoiTaoId: 'VO', nguoiGiuTienId: 'VO' }),
        'NOT_SUPPORTED',
      );
      await explicit(env, 'THU', 150_000, 'VO', { maDanhMuc: 'LAI_CHO_VAY' });
      assert.equal((await env.bal.getPeriodTotals(INITIAL_DATE, ASOF)).tongThu, 150_000);
      assert.equal(await assertInvariant(env, ASOF), familyStart - 3_000_000 + 150_000);
    });

    it('T21: huỷ giải ngân khi đã có trả gốc → bị chặn', async () => {
      const l = await loan(env, 'DI_VAY', 5_000_000, 'CHONG');
      await repay(env, l.loan.id, 1_000_000, 'CHONG');
      await expectDomainError(env.txs.cancelTransaction(l.transaction.id, 'CHONG'), 'CANCEL_BLOCKED');
    });

    it('Nợ: gọi lặp cùng key không tạo thêm', async () => {
      const key = apiKey();
      const input = {
        idempotencyKey: key, chieuNo: 'DI_VAY' as const, tenKhoanNo: 'Vay', doiTac: 'NH', soTien: 1_000_000,
        ngay: '2026-11-05', nguoiTaoId: 'CHONG' as const, nguoiGiuTienId: 'CHONG' as const,
      };
      const a = await env.debt.createLoan(input);
      const b = await env.debt.createLoan(input);
      assert.equal(b.duplicate, true);
      assert.equal(b.loan.id, a.loan.id);
      assert.equal(await count(env.db, 'khoan_no'), 1);
    });

    it('T25e: đối soát VO thực tế 8tr, hệ thống 10tr → đề xuất −2tr không ghi; đồng ý → DIEU_CHINH GIAM, VO = 8tr', async () => {
      await seedInitial(env, 10_000_000);
      const proposal = await env.bal.proposeReconciliation(ASOF, { VO: 8_000_000 });
      assert.deepEqual(proposal.dong, [{ nhom: 'VO', heThong: 10_000_000, thucTe: 8_000_000, chenh: -2_000_000 }]);
      assert.equal(await count(env.db, 'giao_dich'), 0);
      const key = apiKey();
      const written = await env.bal.applyReconciliation({ asOf: ASOF, thucTeTheoNhom: { VO: 8_000_000 }, nguoiXacNhanId: 'VO', idempotencyKey: key });
      assert.equal(written.length, 1);
      assert.equal(written[0]?.loai_giao_dich, 'DIEU_CHINH');
      assert.equal(written[0]?.chieu_dieu_chinh, 'GIAM');
      assert.equal((await holders(env)).VO, 8_000_000);
      // Gọi lại cùng key (mất phản hồi): trả lại đúng dòng đã ghi, không ghi thêm
      const retry = await env.bal.applyReconciliation({ asOf: ASOF, thucTeTheoNhom: { VO: 8_000_000 }, nguoiXacNhanId: 'VO', idempotencyKey: key });
      assert.deepEqual(retry.map((t) => t.id), written.map((t) => t.id));
      assert.equal(await count(env.db, 'giao_dich'), 1);
      await assertInvariant(env, ASOF);
    });

    it('T25: chuỗi thao tác ngẫu nhiên (seed cố định) → luôn tổng nhóm = gia đình, dư nợ = lich_su_no', async () => {
      await seedInitial(env, 50_000_000, 50_000_000, 20_000_000, 0);
      const rnd = mulberry32(20261104);
      const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!;
      const amount = () => (1 + Math.floor(rnd() * 50)) * 10_000;
      const txIds: string[] = [];
      const loanIds: string[] = [];
      const steps = backend.name === 'SQLite' ? 120 : 40;
      for (let step = 0; step < steps; step += 1) {
        const op = Math.floor(rnd() * 7);
        const holder = pick(HOLDERS);
        const label = `bước ${step} op ${op}`;
        try {
          if (op === 0) txIds.push((await explicit(env, 'THU', amount(), holder)).transaction.id);
          if (op === 1) txIds.push((await explicit(env, pick(['CHI', 'PHI', 'LAI_VAY'] as const), amount(), holder)).transaction.id);
          if (op === 2) txIds.push((await explicit(env, 'DIEU_CHINH', amount(), holder, { chieu: pick(['TANG', 'GIAM'] as const) })).transaction.id);
          if (op === 3) {
            const l = await loan(env, pick(['DI_VAY', 'CHO_VAY'] as const), amount() * 10, holder);
            loanIds.push(l.loan.id);
            txIds.push(l.transaction.id);
          }
          if (op === 4 && loanIds.length > 0) {
            txIds.push((await repay(env, pick(loanIds), amount(), holder)).transaction.id);
          }
          if (op === 5 && txIds.length > 0) {
            await env.txs.cancelTransaction(pick(txIds), MEMBER_ID.VO);
          }
          if (op === 6) {
            const familyBefore = await assertInvariant(env, ASOF, label);
            const [from, to] = rnd() < 0.5 ? ['VO', 'CHONG'] : ['CHONG', 'VO'];
            await insertTransfer(env.db, `CT_R${step}`, from, to, amount(), '2026-11-10', 'DA_XAC_NHAN');
            assert.equal(await assertInvariant(env, ASOF, label), familyBefore, `chuyển nội bộ đổi tổng ${label}`);
          }
        } catch (error) {
          // Trả vượt / khoản đã huỷ / huỷ giải ngân bị chặn là kết quả hợp lệ
          if (!(error instanceof DomainError) || !['OVERPAY', 'LOAN_CLOSED', 'CANCEL_BLOCKED'].includes(error.code)) {
            throw error;
          }
        }
        await assertInvariant(env, ASOF, label);
        for (const o of await env.debt.getOutstanding()) {
          assert.equal(Number(o.loan.du_no_hien_tai), o.duNoTheoLichSu, `dư nợ lệch ${label}`);
        }
      }
      const report = await env.bal.checkConsistency(ASOF);
      assert.equal(report.chenhLech, 0);
      assert.equal(report.nghiVan.giaoDichNoLech.length, 0);
      assert.equal(report.nghiVan.khoanNoLechLichSu.length, 0);
    });
  });

  describe(`Phase 3 — dữ liệu cũ thiếu CHECK 0002 [${backend.name}]`, () => {
    it('T25d: giao dịch HOAN_TAT holder NULL → checkConsistency báo chênh đúng số, chỉ ra bản ghi', async () => {
      const env = await backend.open({ skipMigration: 2 });
      try {
        // Giả lập bản sao cũ: có cột chieu_dieu_chinh nhưng chưa có CHECK của 0002
        await env.db.execute('ALTER TABLE giao_dich ADD COLUMN chieu_dieu_chinh TEXT NULL');
        await seedInitial(env);
        await env.db.execute(
          `INSERT INTO giao_dich (id, loai_giao_dich, so_tien, nguoi_tao_id, nguoi_thuc_hien_id, nguoi_giu_tien_id, mo_ta,
             ngay_giao_dich, trang_thai, idempotency_key, created_at, updated_at, version)
           VALUES ('GD_CU', 'CHI', 300000, 'VO', 'VO', NULL, 'dữ liệu cũ', '2026-11-05', 'HOAN_TAT', 'old:1', $1, $1, $2)`,
          ['2026-11-05T00:00:00.000Z', await env.db.nextVersion()],
        );
        const report = await env.bal.checkConsistency(ASOF);
        assert.equal(report.status, 'OK');
        assert.equal(report.chenhLech, 300_000);
        assert.deepEqual(report.nghiVan.giaoDichKhongNguoiGiu.map((r) => r.id), ['GD_CU']);
      } finally {
        await env.close();
      }
    });

    it('Migration 0002 chặn HOAN_TAT thiếu người giữ và DIEU_CHINH thiếu chiều', async () => {
      const env = await backend.open();
      try {
        const insert = (id: string, loai: string, holder: string | null, chieu: string | null) =>
          env.db.execute(
            `INSERT INTO giao_dich (id, loai_giao_dich, so_tien, nguoi_tao_id, nguoi_thuc_hien_id, nguoi_giu_tien_id, chieu_dieu_chinh,
               mo_ta, ngay_giao_dich, trang_thai, idempotency_key, created_at, updated_at, version)
             VALUES ($1, $2, 1000, 'VO', 'VO', $3, $4, 'x', '2026-11-05', 'HOAN_TAT', $1, $5, $5, 1)`,
            [id, loai, holder, chieu, '2026-11-05T00:00:00.000Z'],
          );
        await assert.rejects(insert('X1', 'CHI', null, null));
        await assert.rejects(insert('X2', 'DIEU_CHINH', 'VO', null));
        await assert.rejects(insert('X3', 'CHI', 'VO', 'TANG'));
        await assert.rejects(insert('X4', 'DIEU_CHINH', 'VO', 'KHAC'));
        await insert('X5', 'DIEU_CHINH', 'VO', 'TANG');
        assert.equal(await count(env.db, 'giao_dich'), 1);
      } finally {
        await env.close();
      }
    });
  });
}
