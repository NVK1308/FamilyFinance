import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { CONFIRMATION_TYPE, MEMBER_ID, type MemberId } from '../src/config/constants.ts';
import { insertConfirmation } from '../src/db/repositories/index.ts';
import type { DatabaseAdapter } from '../src/db/types.ts';
import { TransactionService, TransferService, type RecordOutcome } from '../src/services/index.ts';
import {
  BACKENDS,
  FaultyAdapter,
  INITIAL_DATE,
  assertInvariant,
  count,
  expectDomainError,
  msg,
  seedInitial,
  snapshotCounts,
  type TestEnv,
} from './helpers/phase3-env.ts';

const ASOF = '2026-11-30';

type TransferOutcome = Extract<RecordOutcome, { kind: 'TRANSFER' }>;
type FundOutcome = Extract<RecordOutcome, { kind: 'FUND_MOVE' }>;

async function sendTransfer(env: TestEnv, sender: MemberId, text: string): Promise<TransferOutcome> {
  const out = await env.txs.recordFromText(msg(sender, text));
  assert.equal(out.kind, 'TRANSFER', `${text}: ${JSON.stringify(out.kind === 'IGNORED' ? out.reason : out.kind)}`);
  return out as TransferOutcome;
}

async function sendFund(env: TestEnv, sender: MemberId, text: string): Promise<FundOutcome> {
  const out = await env.txs.recordFromText(msg(sender, text));
  assert.equal(out.kind, 'FUND_MOVE', `${text}: ${JSON.stringify(out.kind === 'IGNORED' ? out.reason : out.kind)}`);
  return out as FundOutcome;
}

async function expectIgnored(env: TestEnv, sender: MemberId | number, text: string, reason: string): Promise<void> {
  const out = await env.txs.recordFromText(msg(sender, text));
  assert.equal(out.kind, 'IGNORED', text);
  if (out.kind !== 'IGNORED') return;
  assert.equal(out.reason, reason, text);
  assert.equal(out.message.trang_thai_xu_ly, 'DA_BO_QUA');
}

async function holders(env: TestEnv) {
  const r = await env.bal.getHolderBalances(ASOF);
  if (r.status !== 'OK') throw new Error(r.status);
  return r.nhom;
}

async function row<T>(db: DatabaseAdapter, sql: string, params: string[]): Promise<T> {
  const r = await db.queryOne<T>(sql, params);
  if (!r) throw new Error(`Không có dòng: ${sql}`);
  return r;
}

async function addAdmin(db: DatabaseAdapter): Promise<void> {
  await db.execute(
    `INSERT INTO thanh_vien (id, ten, telegram_user_id, vai_tro, is_active, created_at, updated_at, version)
     VALUES ('ADMIN', 'Quản trị', 100000009, 'QUAN_TRI', TRUE, $1, $1, $2)`,
    ['2026-11-01T00:00:00.000Z', await db.nextVersion()],
  );
}

// PRNG cố định để R1 lặp lại được
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
  describe(`Phase 4 — chuyển tiền vợ ↔ chồng [${backend.name}]`, () => {
    let env: TestEnv;
    beforeEach(async () => {
      env = await backend.open();
    });
    afterEach(async () => {
      await env.close();
    });

    it('P1: "chuyển vợ 3 triệu" → chuyển chờ + yêu cầu cho VO; số dư nhóm chưa đổi', async () => {
      await seedInitial(env);
      const out = await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 3 triệu');
      assert.equal(out.transfer.trang_thai, 'CHO_XAC_NHAN');
      assert.equal(out.transfer.nguoi_chuyen_id, 'CHONG');
      assert.equal(out.transfer.nguoi_nhan_id, 'VO');
      assert.equal(Number(out.transfer.so_tien), 3_000_000);
      assert.equal(out.transfer.idempotency_key, `tg:${out.message.telegram_update_id}`);
      assert.equal(out.confirmation?.loai_xac_nhan, CONFIRMATION_TYPE.CHUYEN_TIEN);
      assert.equal(out.confirmation?.nguoi_can_xac_nhan_id, 'VO');
      assert.equal(JSON.parse(out.confirmation!.du_lieu_de_xuat_json).chuyen_tien_id, out.transfer.id);
      assert.equal(out.message.trang_thai_xu_ly, 'CHO_XAC_NHAN');
      assert.equal(await count(env.db, 'giao_dich'), 0);
      const h = await holders(env);
      assert.equal(h.CHONG, 3_000_000);
      assert.equal(h.VO, 5_000_000);
    });

    it('P2: gửi lại cùng update (lúc chờ / sau nhận / sau huỷ) → không thêm dòng, trả đúng bản ghi', async () => {
      const m = msg(MEMBER_ID.CHONG, 'chuyển vợ 1tr');
      const first = (await env.txs.recordFromText(m)) as TransferOutcome;
      const before = await snapshotCounts(env.db);
      const again = await env.txs.recordFromText(m);
      assert.equal(again.kind, 'TRANSFER');
      assert.equal((again as TransferOutcome).duplicate, true);
      assert.equal((again as TransferOutcome).transfer.id, first.transfer.id);
      assert.deepEqual(await snapshotCounts(env.db), before);
      await env.txs.resolveConfirmation(first.confirmation!.id, MEMBER_ID.VO, { type: 'ACCEPT' });
      const afterAccept = (await env.txs.recordFromText(m)) as TransferOutcome;
      assert.equal(afterAccept.transfer.trang_thai, 'DA_XAC_NHAN');

      const m2 = msg(MEMBER_ID.CHONG, 'chuyển vợ 2tr');
      const second = (await env.txs.recordFromText(m2)) as TransferOutcome;
      await env.transfers.cancelTransfer(second.transfer.id, MEMBER_ID.CHONG);
      const afterCancel = await env.txs.recordFromText(m2);
      assert.equal(afterCancel.kind, 'TRANSFER', 'chuyển đã huỷ gửi lại vẫn trả TRANSFER, không phải IGNORED');
      assert.equal((afterCancel as TransferOutcome).transfer.trang_thai, 'DA_HUY');
      assert.equal(await count(env.db, 'chuyen_tien_noi_bo'), 2);
    });

    it('P3: VO "Đã nhận" → CHONG −3tr, VO +3tr; tổng gia đình và THU/CHI không đổi', async () => {
      await seedInitial(env);
      const familyBefore = await assertInvariant(env, ASOF);
      const totalsBefore = await env.bal.getPeriodTotals(INITIAL_DATE, ASOF);
      const out = await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 3 triệu');
      const res = await env.txs.resolveConfirmation(out.confirmation!.id, MEMBER_ID.VO, { type: 'ACCEPT' });
      assert.equal(res.changed, true);
      assert.equal(res.transfer?.trang_thai, 'DA_XAC_NHAN');
      assert.equal(Number(res.transfer?.telegram_user_id_xac_nhan), 100000002);
      assert.ok(res.transfer?.ngay_xac_nhan);
      assert.equal(res.confirmation.trang_thai, 'DA_XAC_NHAN');
      const m = await row<{ trang_thai_xu_ly: string }>(env.db, 'SELECT trang_thai_xu_ly FROM tin_nhan_goc WHERE id = $1', [out.message.id]);
      assert.equal(m.trang_thai_xu_ly, 'DA_GHI');
      const h = await holders(env);
      assert.equal(h.CHONG, 0);
      assert.equal(h.VO, 8_000_000);
      assert.equal(await assertInvariant(env, ASOF), familyBefore);
      assert.deepEqual(await env.bal.getPeriodTotals(INITIAL_DATE, ASOF), totalsBefore);
      assert.equal(await count(env.db, 'lich_su_chinh_sua', "ten_bang = 'chuyen_tien_noi_bo' AND hanh_dong = 'CONFIRM'"), 1);
      assert.equal(await count(env.db, 'lich_su_chinh_sua', "ten_bang = 'yeu_cau_xac_nhan' AND hanh_dong = 'CONFIRM' AND ban_ghi_id = $1", [out.confirmation!.id]), 1);
    });

    it('P4: người chuyển bấm thay người nhận → lỗi sai người, không đổi gì', async () => {
      const out = await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 1tr');
      const before = await snapshotCounts(env.db);
      await expectDomainError(
        env.txs.resolveConfirmation(out.confirmation!.id, MEMBER_ID.CHONG, { type: 'ACCEPT' }),
        'WRONG_CONFIRMER',
      );
      assert.deepEqual(await snapshotCounts(env.db), before);
      const t = await row<{ trang_thai: string }>(env.db, 'SELECT trang_thai FROM chuyen_tien_noi_bo WHERE id = $1', [out.transfer.id]);
      assert.equal(t.trang_thai, 'CHO_XAC_NHAN');
    });

    it('P5: "Đã nhận" 2 lần → lần 2 không ghi', async () => {
      const out = await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 1tr');
      const a = await env.txs.resolveConfirmation(out.confirmation!.id, MEMBER_ID.VO, { type: 'ACCEPT' });
      const before = await snapshotCounts(env.db);
      const b = await env.txs.resolveConfirmation(out.confirmation!.id, MEMBER_ID.VO, { type: 'ACCEPT' });
      assert.equal(a.changed, true);
      assert.equal(b.changed, false);
      assert.deepEqual(await snapshotCounts(env.db), before);
    });

    it('P6: "Chưa nhận" → vẫn chờ, chỉ ghi lịch sử; sau đó "Đã nhận" / người chuyển huỷ vẫn được', async () => {
      await seedInitial(env);
      const a = await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 1tr');
      const r1 = await env.txs.resolveConfirmation(a.confirmation!.id, MEMBER_ID.VO, { type: 'REJECT' });
      const r2 = await env.txs.resolveConfirmation(a.confirmation!.id, MEMBER_ID.VO, { type: 'REJECT' });
      assert.equal(r1.changed, false);
      assert.equal(r1.transfer?.trang_thai, 'CHO_XAC_NHAN');
      assert.equal(r2.confirmation.trang_thai, 'CHO_XAC_NHAN');
      assert.equal((await holders(env)).VO, 5_000_000);
      assert.equal(await count(env.db, 'lich_su_chinh_sua', "ly_do = 'CHUA_NHAN'"), 2);
      const ok = await env.txs.resolveConfirmation(a.confirmation!.id, MEMBER_ID.VO, { type: 'ACCEPT' });
      assert.equal(ok.changed, true);
      assert.equal((await holders(env)).VO, 6_000_000);

      const b = await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 500k');
      await env.txs.resolveConfirmation(b.confirmation!.id, MEMBER_ID.VO, { type: 'REJECT' });
      const c = await env.transfers.cancelTransfer(b.transfer.id, MEMBER_ID.CHONG);
      assert.equal(c.changed, true);
      assert.equal(c.transfer.trang_thai, 'DA_HUY');
    });

    it('P7: huỷ khi chờ → DA_HUY + yêu cầu TU_CHOI + tin DA_BO_QUA; đã nhận → chặn; người nhận huỷ → lỗi', async () => {
      const a = await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 1tr');
      await expectDomainError(env.transfers.cancelTransfer(a.transfer.id, MEMBER_ID.VO), 'FORBIDDEN');
      const c = await env.transfers.cancelTransfer(a.transfer.id, MEMBER_ID.CHONG);
      assert.equal(c.changed, true);
      const req = await row<{ trang_thai: string }>(env.db, 'SELECT trang_thai FROM yeu_cau_xac_nhan WHERE id = $1', [a.confirmation!.id]);
      assert.equal(req.trang_thai, 'TU_CHOI');
      const m = await row<{ trang_thai_xu_ly: string; chi_tiet_loi: string }>(env.db, 'SELECT * FROM tin_nhan_goc WHERE id = $1', [a.message.id]);
      assert.equal(m.trang_thai_xu_ly, 'DA_BO_QUA');
      assert.equal(m.chi_tiet_loi, 'DA_HUY');
      const again = await env.transfers.cancelTransfer(a.transfer.id, MEMBER_ID.CHONG);
      assert.equal(again.changed, false);

      const b = await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 2tr');
      await env.txs.resolveConfirmation(b.confirmation!.id, MEMBER_ID.VO, { type: 'ACCEPT' });
      await expectDomainError(env.transfers.cancelTransfer(b.transfer.id, MEMBER_ID.CHONG), 'CANCEL_BLOCKED');
    });

    it('P8: huỷ trước rồi người nhận bấm "Đã nhận" → không ghi', async () => {
      const a = await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 1tr');
      await env.transfers.cancelTransfer(a.transfer.id, MEMBER_ID.CHONG);
      const r = await env.txs.resolveConfirmation(a.confirmation!.id, MEMBER_ID.VO, { type: 'ACCEPT' });
      assert.equal(r.changed, false);
      assert.equal(r.transfer?.trang_thai, 'DA_HUY');
    });

    it('P9: thiếu/mơ hồ tiền, tự chuyển, chủ ngữ khác, QUAN_TRI, người nhận không active, ngày tương lai → chỉ lưu tin DA_BO_QUA', async () => {
      await addAdmin(env.db);
      await expectIgnored(env, MEMBER_ID.VO, 'chuyển chồng', 'THIEU_HOAC_MO_HO_SO_TIEN');
      await expectIgnored(env, MEMBER_ID.CHONG, 'chuyển vợ 3 hay 4 triệu', 'THIEU_HOAC_MO_HO_SO_TIEN');
      await expectIgnored(env, MEMBER_ID.CHONG, 'đưa chồng 500k', 'TU_CHUYEN_CHO_MINH');
      await expectIgnored(env, MEMBER_ID.CHONG, 'vợ chuyển chồng 1tr', 'CHU_NGU_KHAC_NGUOI_GUI');
      await expectIgnored(env, 100000009, 'chuyển vợ 1tr', 'NGUOI_CHUYEN_KHONG_HOP_LE');
      await expectIgnored(env, MEMBER_ID.CHONG, 'chuyển vợ 1tr ngày 30/12', 'NGAY_TUONG_LAI');
      await env.db.execute("UPDATE thanh_vien SET is_active = FALSE WHERE id = 'VO'");
      await expectIgnored(env, MEMBER_ID.CHONG, 'chuyển vợ 1tr', 'NGUOI_NHAN_KHONG_HOP_LE');
      assert.equal(await count(env.db, 'chuyen_tien_noi_bo'), 0);
      assert.equal(await count(env.db, 'yeu_cau_xac_nhan'), 0);
      assert.equal(await count(env.db, 'giao_dich'), 0);
      // Người gửi hợp lệ vẫn được ghi vào tin (để truy vết)
      assert.equal(await count(env.db, 'tin_nhan_goc', "nguoi_gui_id = 'CHONG'"), 5);
    });

    it('P10: quá 7 ngày → "Đã nhận" không đổi (cờ expired); người chuyển vẫn huỷ được', async () => {
      const a = await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 1tr');
      env.setNow('2026-11-12T03:00:00.000Z');
      const r = await env.txs.resolveConfirmation(a.confirmation!.id, MEMBER_ID.VO, { type: 'ACCEPT' });
      assert.equal(r.changed, false);
      assert.equal(r.expired, true);
      const transfers = new TransferService(env.db, { now: () => new Date('2026-11-12T03:00:00.000Z') });
      const c = await transfers.cancelTransfer(a.transfer.id, MEMBER_ID.CHONG);
      assert.equal(c.changed, true);

      // Job Phase 5 đã chuyển yêu cầu sang HET_HAN mà chuyển còn chờ → người chuyển vẫn huỷ được
      const b = await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 2tr');
      await env.db.execute("UPDATE yeu_cau_xac_nhan SET trang_thai = 'HET_HAN' WHERE id = $1", [b.confirmation!.id]);
      const c2 = await transfers.cancelTransfer(b.transfer.id, MEMBER_ID.CHONG);
      assert.equal(c2.changed, true);
      assert.equal(c2.transfer.trang_thai, 'DA_HUY');
    });

    it('P11: lỗi giữa transaction ở bất kỳ lệnh ghi nào → không còn dòng dở', async () => {
      await seedInitial(env);
      const state = async () => ({
        counts: await snapshotCounts(env.db),
        ct: await count(env.db, 'chuyen_tien_noi_bo'),
        ctCho: await count(env.db, 'chuyen_tien_noi_bo', "trang_thai = 'CHO_XAC_NHAN'"),
        qc: await count(env.db, 'chuyen_quy_chung', "trang_thai = 'HOAN_TAT'"),
        ycCho: await count(env.db, 'yeu_cau_xac_nhan', "trang_thai = 'CHO_XAC_NHAN'"),
      });
      const runFaulty = async (writes: number, label: string, run: (db: DatabaseAdapter) => Promise<unknown>) => {
        for (let failAt = 1; failAt <= writes; failAt += 1) {
          const before = await state();
          await assert.rejects(run(new FaultyAdapter(env.db, { calls: 0, failAt })), `${label} failAt=${failAt}`);
          assert.deepEqual(await state(), before, `${label} failAt=${failAt}`);
        }
      };
      await runFaulty(5, 'tạo chuyển', (db) => new TransactionService(db).recordFromText(msg(MEMBER_ID.CHONG, 'chuyển vợ 1tr')));
      const pending = await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 1tr');
      await runFaulty(4, 'nhận', (db) =>
        new TransactionService(db).resolveConfirmation(pending.confirmation!.id, MEMBER_ID.VO, { type: 'ACCEPT' }),
      );
      await runFaulty(4, 'huỷ chuyển', (db) => new TransferService(db).cancelTransfer(pending.transfer.id, MEMBER_ID.CHONG));
      await runFaulty(4, 'nộp quỹ', (db) => new TransactionService(db).recordFromText(msg(MEMBER_ID.VO, 'bỏ vào quỹ chung 1tr')));
      const fund = await sendFund(env, MEMBER_ID.VO, 'bỏ vào quỹ chung 1tr');
      await runFaulty(2, 'huỷ quỹ', (db) => new TransferService(db).cancelFundMove(fund.fundMove.id, MEMBER_ID.VO));
    });

    it('P12: thời gian / chủ ngữ / "đã" đứng trước → vẫn là chuyển, ngày đúng', async () => {
      const a = await sendTransfer(env, MEMBER_ID.CHONG, 'hôm qua chuyển vợ 2tr');
      assert.equal(a.transfer.ngay_chuyen, '2026-11-03');
      const b = await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 3tr ngày 01/11');
      assert.equal(b.transfer.ngay_chuyen, '2026-11-01');
      await sendTransfer(env, MEMBER_ID.CHONG, 'chồng chuyển vợ 3tr');
      const e = await sendTransfer(env, MEMBER_ID.CHONG, 'tối qua chuyển vợ 2tr');
      assert.equal(e.transfer.ngay_chuyen, '2026-11-03');
      const f = await sendTransfer(env, MEMBER_ID.CHONG, '02-11 chuyển vợ 1tr');
      assert.equal(f.transfer.ngay_chuyen, '2026-11-02');
      await expectIgnored(env, MEMBER_ID.CHONG, 'chuyển vợ 2tr từ quỹ chung', 'CHUYEN_TU_QUY_CHUNG');
      const d = await sendTransfer(env, MEMBER_ID.VO, 'đã ck cho chồng 1tr');
      assert.equal(d.transfer.nguoi_nhan_id, 'CHONG');
      assert.equal(await count(env.db, 'giao_dich'), 0);
    });

    it('P14: cờ vượt số dư — chuyển nhiều hơn số đang giữ có cờ, không chặn; chưa có số dư ban đầu → không cờ', async () => {
      const noInitial = await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 50tr');
      assert.equal(noInitial.canhBaoVuotSoDu, false);
      // Khoản chờ này cũng bị tính vào cờ sau khi có số dư → huỷ để kiểm các ca dưới
      await env.transfers.cancelTransfer(noInitial.transfer.id, MEMBER_ID.CHONG);
      await seedInitial(env);
      const over = await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 5tr');
      const ok = await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 1tr');
      assert.equal(over.canhBaoVuotSoDu, true);
      assert.equal(ok.canhBaoVuotSoDu, true, 'đã có 5tr đang chờ nên 1tr nữa vẫn vượt 3tr');
      await env.transfers.cancelTransfer(over.transfer.id, MEMBER_ID.CHONG);
      assert.equal((await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 1tr')).canhBaoVuotSoDu, false);
      // 2 lần 2tr khi đang giữ 3tr: lần 2 phải có cờ
      await env.transfers.cancelTransfer(ok.transfer.id, MEMBER_ID.CHONG);
      assert.equal((await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 1tr')).canhBaoVuotSoDu, false);
      assert.equal((await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 2tr')).canhBaoVuotSoDu, true);
    });

    it('Danh sách chuyển đang chờ', async () => {
      await sendTransfer(env, MEMBER_ID.CHONG, 'chuyển vợ 1tr');
      const b = await sendTransfer(env, MEMBER_ID.VO, 'chuyển chồng 2tr');
      await env.transfers.cancelTransfer(b.transfer.id, MEMBER_ID.VO);
      const pending = await env.transfers.listPendingTransfers();
      assert.equal(pending.length, 1);
      assert.equal(pending[0]?.nguoi_chuyen_id, 'CHONG');
    });
  });

  describe(`Phase 4 — quỹ chung + bỏ phân bổ [${backend.name}]`, () => {
    let env: TestEnv;
    beforeEach(async () => {
      env = await backend.open();
    });
    afterEach(async () => {
      await env.close();
    });

    it('F1/F2: nộp / rút quỹ chung ghi ngay; tổng gia đình, THU/CHI không đổi', async () => {
      await seedInitial(env);
      const familyBefore = await assertInvariant(env, ASOF);
      const totalsBefore = await env.bal.getPeriodTotals(INITIAL_DATE, ASOF);
      const nop = await sendFund(env, MEMBER_ID.VO, 'bỏ vào quỹ chung 2tr');
      assert.equal(nop.fundMove.trang_thai, 'HOAN_TAT');
      assert.equal(nop.fundMove.chieu, 'NOP');
      assert.equal(nop.fundMove.nhom_id, 'VO');
      assert.equal(nop.message.trang_thai_xu_ly, 'DA_GHI');
      let h = await holders(env);
      assert.equal(h.VO, 3_000_000);
      assert.equal(h.QUY_CHUNG, 4_000_000);
      await sendFund(env, MEMBER_ID.CHONG, 'rút quỹ chung 1tr');
      await sendFund(env, MEMBER_ID.CHONG, 'lấy quỹ chung 500k');
      h = await holders(env);
      assert.equal(h.QUY_CHUNG, 2_500_000);
      assert.equal(h.CHONG, 4_500_000);
      assert.equal(await assertInvariant(env, ASOF), familyBefore);
      assert.deepEqual(await env.bal.getPeriodTotals(INITIAL_DATE, ASOF), totalsBefore);
      assert.equal(await count(env.db, 'giao_dich'), 0);
      assert.equal(await count(env.db, 'yeu_cau_xac_nhan'), 0);
    });

    it('F3/F6: câu lẫn thu/chi/nợ với quỹ chung không thành nộp/rút', async () => {
      const cases: Array<[MemberId, string, RecordOutcome['kind']]> = [
        [MEMBER_ID.VO, 'đi chợ 200k lấy quỹ chung', 'RECORDED'],
        [MEMBER_ID.VO, 'lấy quỹ chung 200k đi chợ', 'RECORDED'],
        [MEMBER_ID.CHONG, 'lương 10tr bỏ vào quỹ chung', 'RECORDED'],
        // Phase 5: nợ → ghi chú (Q6); chưa rõ danh mục → ghi Chi khác (Q4)
        [MEMBER_ID.CHONG, 'lấy quỹ chung 1tr trả nợ', 'IGNORED'],
        [MEMBER_ID.CHONG, 'lấy quỹ chung 300k mua bánh', 'RECORDED'],
        [MEMBER_ID.CHONG, 'chi 500k lấy quỹ chung', 'RECORDED'],
      ];
      for (const [sender, text, kind] of cases) {
        const out = await env.txs.recordFromText(msg(sender, text));
        assert.equal(out.kind, kind, text);
        if (out.kind === 'RECORDED') {
          assert.equal(out.transaction.nguoi_giu_tien_id, 'QUY_CHUNG', text);
        }
      }
      const thu = await row<{ loai_giao_dich: string }>(env.db, "SELECT loai_giao_dich FROM giao_dich WHERE danh_muc_id = $1", ['DM_LUONG']);
      assert.equal(thu.loai_giao_dich, 'THU');
      assert.equal(await count(env.db, 'chuyen_quy_chung'), 0);
    });

    it('F4: gửi lại update quỹ → không thêm; huỷ 2 lần → số dư trả lại 1 lần; người kia huỷ → lỗi', async () => {
      await seedInitial(env);
      const m = msg(MEMBER_ID.VO, 'góp quỹ chung 2tr');
      const first = (await env.txs.recordFromText(m)) as FundOutcome;
      const again = await env.txs.recordFromText(m);
      assert.equal(again.kind, 'FUND_MOVE');
      assert.equal((again as FundOutcome).duplicate, true);
      assert.equal((again as FundOutcome).fundMove.id, first.fundMove.id);
      assert.equal(await count(env.db, 'chuyen_quy_chung'), 1);
      await expectDomainError(env.transfers.cancelFundMove(first.fundMove.id, MEMBER_ID.CHONG), 'FORBIDDEN');
      const c1 = await env.transfers.cancelFundMove(first.fundMove.id, MEMBER_ID.VO);
      const c2 = await env.transfers.cancelFundMove(first.fundMove.id, MEMBER_ID.VO);
      assert.equal(c1.changed, true);
      assert.equal(c2.changed, false);
      const h = await holders(env);
      assert.equal(h.VO, 5_000_000);
      assert.equal(h.QUY_CHUNG, 2_000_000);
      const afterCancel = await env.txs.recordFromText(m);
      assert.equal(afterCancel.kind, 'FUND_MOVE');
    });

    it('F5/F7: thiếu/mơ hồ tiền, QUAN_TRI, ngày tương lai, chủ ngữ khác, có người nhận → DA_BO_QUA; "chuyển từ quỹ" là rút', async () => {
      await addAdmin(env.db);
      await expectIgnored(env, MEMBER_ID.VO, 'góp quỹ chung', 'THIEU_SO_TIEN');
      await expectIgnored(env, MEMBER_ID.VO, 'bỏ quỹ chung 2 hay 3tr', 'SO_TIEN_MO_HO');
      await expectIgnored(env, 100000009, 'bỏ vào quỹ chung 1tr', 'NGUOI_GUI_KHONG_HOP_LE');
      await expectIgnored(env, MEMBER_ID.VO, 'bỏ quỹ chung 1tr ngày 30/12', 'NGAY_TUONG_LAI');
      await expectIgnored(env, MEMBER_ID.CHONG, 'vợ nộp quỹ chung 2tr', 'CHU_NGU_KHAC_NGUOI_GUI');
      await expectIgnored(env, MEMBER_ID.CHONG, 'chuyển quỹ chung cho vợ 2tr', 'CO_NGUOI_NHAN');
      assert.equal(await count(env.db, 'chuyen_quy_chung'), 0);
      const rut = await sendFund(env, MEMBER_ID.CHONG, 'chuyển từ quỹ chung 1tr');
      assert.equal(rut.fundMove.chieu, 'RUT');
      const yesterday = await sendFund(env, MEMBER_ID.VO, 'hôm qua bỏ quỹ chung 2tr');
      assert.equal(yesterday.fundMove.ngay_chuyen, '2026-11-03');
      assert.equal(yesterday.fundMove.chieu, 'NOP');
    });

    it('F9: cờ vượt số dư khi rút quá số quỹ / nộp quá số đang giữ', async () => {
      await seedInitial(env);
      assert.equal((await sendFund(env, MEMBER_ID.CHONG, 'rút quỹ chung 3tr')).canhBaoVuotSoDu, true);
      assert.equal((await sendFund(env, MEMBER_ID.VO, 'bỏ vào quỹ chung 6tr')).canhBaoVuotSoDu, true);
      assert.equal((await sendFund(env, MEMBER_ID.CHONG, 'bỏ vào quỹ chung 1tr')).canhBaoVuotSoDu, false);
    });

    // Phase 5b Q8: "các con / 2 con / con gái và con trai" → CAC_CON; đối tượng khác lẫn vào → null
    it('A1: nhiều đối tượng → ghi CHI ngay, không hỏi phân bổ; các con → CAC_CON', async () => {
      const cases: Array<[string, string | null]> = [
        ['CHI: mua đồ ăn cho các con 500k', 'CAC_CON'],
        ['mua sữa cho con gái và con trai 400k', 'CAC_CON'],
        ['CHI: hôm qua mua sữa cho 2 con 450k', 'CAC_CON'],
        ['mua đồ cho con gái và cho vợ 300k', null],
      ];
      for (const [text, expected] of cases) {
        const out = await env.txs.recordFromText(msg(MEMBER_ID.VO, text));
        assert.equal(out.kind, 'RECORDED', text);
        if (out.kind !== 'RECORDED') continue;
        assert.equal(out.transaction.doi_tuong_thu_huong_id, expected, text);
        assert.equal(out.confirmations.length, 0, text);
      }
      assert.equal(await count(env.db, 'yeu_cau_xac_nhan'), 0);
    });

    it('A2: yêu cầu PHAN_BO cũ còn trong DB → đồng ý / từ chối chỉ đóng yêu cầu', async () => {
      const out = await env.txs.recordFromText(msg(MEMBER_ID.VO, 'tiền ăn 50k'));
      if (out.kind !== 'RECORDED') throw new Error('expected RECORDED');
      const mk = (id: string) =>
        env.db.transaction((tx) =>
          insertConfirmation(tx, {
            id, source_message_id: out.message.id, nguoi_tao_id: 'VO', nguoi_can_xac_nhan_id: 'VO',
            loai_xac_nhan: CONFIRMATION_TYPE.PHAN_BO, du_lieu_de_xuat: {}, expires_at: '2026-11-11T03:00:00.000Z',
            nowIso: '2026-11-04T03:00:00.000Z',
          }),
        );
      await mk('YC_PB_1');
      await mk('YC_PB_2');
      const a = await env.txs.resolveConfirmation('YC_PB_1', MEMBER_ID.VO, { type: 'ACCEPT' });
      const r = await env.txs.resolveConfirmation('YC_PB_2', MEMBER_ID.VO, { type: 'REJECT' });
      assert.equal(a.confirmation.trang_thai, 'DA_XAC_NHAN');
      assert.equal(r.confirmation.trang_thai, 'TU_CHOI');
      assert.equal(await count(env.db, 'giao_dich'), 1);
      assert.equal(await count(env.db, 'phan_bo_giao_dich'), 0);
    });

    it('R1: chuỗi ngẫu nhiên (thu/chi, chuyển tạo/nhận/chưa nhận/huỷ, nộp/rút/huỷ quỹ) → tổng nhóm luôn = gia đình', async () => {
      await seedInitial(env, 50_000_000, 50_000_000, 20_000_000, 0);
      const rnd = mulberry32(20261105);
      const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!;
      const amountK = () => (1 + Math.floor(rnd() * 90)) * 10;
      const pendingTransfers: TransferOutcome[] = [];
      const funds: FundOutcome[] = [];
      const steps = backend.name === 'SQLite' ? 80 : 30;
      for (let step = 0; step < steps; step += 1) {
        const label = `bước ${step}`;
        const sender = pick([MEMBER_ID.VO, MEMBER_ID.CHONG] as const);
        const other = sender === MEMBER_ID.VO ? 'chồng' : 'vợ';
        const totalsBefore = await env.bal.getPeriodTotals(INITIAL_DATE, ASOF);
        const familyBefore = await assertInvariant(env, ASOF, label);
        const op = Math.floor(rnd() * 6);
        let moneyOnly = true;
        if (op === 0) {
          moneyOnly = false;
          await env.txs.recordFromText(msg(sender, pick([`tiền ăn ${amountK()}k`, `lương ${amountK()}k`, `đi chợ ${amountK()}k lấy quỹ chung`])));
        } else if (op === 1) {
          pendingTransfers.push(await sendTransfer(env, sender, `chuyển ${other} ${amountK()}k`));
        } else if (op === 2 && pendingTransfers.length > 0) {
          const t = pendingTransfers.splice(Math.floor(rnd() * pendingTransfers.length), 1)[0]!;
          const reply = pick(['ACCEPT', 'REJECT', 'CANCEL'] as const);
          if (reply === 'CANCEL') {
            await env.transfers.cancelTransfer(t.transfer.id, t.transfer.nguoi_chuyen_id);
          } else {
            await env.txs.resolveConfirmation(t.confirmation!.id, t.transfer.nguoi_nhan_id, { type: reply });
            if (reply === 'REJECT') pendingTransfers.push(t);
          }
        } else if (op === 3) {
          funds.push(await sendFund(env, sender, pick([`bỏ vào quỹ chung ${amountK()}k`, `rút quỹ chung ${amountK()}k`])));
        } else if (op === 4 && funds.length > 0) {
          const f = pick(funds);
          await env.transfers.cancelFundMove(f.fundMove.id, f.fundMove.thanh_vien_id);
        }
        const familyAfter = await assertInvariant(env, ASOF, label);
        if (moneyOnly) {
          assert.equal(familyAfter, familyBefore, `chuyển / quỹ làm đổi tổng gia đình ${label}`);
          assert.deepEqual(await env.bal.getPeriodTotals(INITIAL_DATE, ASOF), totalsBefore, `chuyển / quỹ làm đổi THU/CHI ${label}`);
        }
      }
      const report = await env.bal.checkConsistency(ASOF);
      assert.equal(report.chenhLech, 0);
      assert.equal(report.nghiVan.chuyenTienKhongMapDuoc.length, 0);
    });
  });
}
