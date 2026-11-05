import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { CONFIRMATION_TYPE, MEMBER_ID, MESSAGE_INTENT } from '../src/config/constants.ts';
import { parseVietnameseFinanceMessage } from '../src/parser/index.ts';
import type { ParsedTransactionResult } from '../src/parser/types.ts';
import { DebtService, TransactionService, toVnDate } from '../src/services/index.ts';
import {
  BACKENDS,
  FaultyAdapter,
  apiKey,
  count,
  expectDomainError,
  msg,
  snapshotCounts,
  type TestEnv,
} from './helpers/phase3-env.ts';

function parseTx(text: string, sender: 'VO' | 'CHONG', ref = '2026-11-04'): ParsedTransactionResult {
  const r = parseVietnameseFinanceMessage(text, { senderId: sender, referenceDate: ref });
  assert.equal(r.intent, MESSAGE_INTENT.RECORD_TRANSACTION);
  return r;
}

for (const backend of BACKENDS) {
  describe(`Phase 3 — ghi giao dịch [${backend.name}]`, () => {
    let env: TestEnv;
    beforeEach(async () => {
      env = await backend.open();
    });
    afterEach(async () => {
      await env.close();
    });

    it('T1: "tiền ăn 50k tiền vợ giữ" → CHI HOAN_TAT, holder VO, tin DA_GHI, audit CREATE', async () => {
      const out = await env.txs.recordFromText(msg(MEMBER_ID.VO, 'tiền ăn 50k tiền vợ giữ'));
      assert.equal(out.kind, 'RECORDED');
      if (out.kind !== 'RECORDED') return;
      assert.equal(out.transaction.loai_giao_dich, 'CHI');
      assert.equal(Number(out.transaction.so_tien), 50_000);
      assert.equal(out.transaction.trang_thai, 'HOAN_TAT');
      assert.equal(out.transaction.nguoi_giu_tien_id, 'VO');
      assert.equal(out.transaction.danh_muc_id, 'DM_THUC_AN');
      assert.equal(out.message.trang_thai_xu_ly, 'DA_GHI');
      assert.equal(out.transaction.idempotency_key, `tg:${out.message.telegram_update_id}`);
      assert.equal(
        await count(env.db, 'lich_su_chinh_sua', "ban_ghi_id = $1 AND hanh_dong = 'CREATE'", [out.transaction.id]),
        1,
      );
    });

    it('T2: gửi lại cùng update_id → không thêm dòng, trả giao dịch cũ', async () => {
      const m = msg(MEMBER_ID.VO, 'tiền ăn 50k');
      const first = await env.txs.recordFromText(m);
      const before = await snapshotCounts(env.db);
      const second = await env.txs.recordFromText(m);
      assert.equal(second.kind, 'RECORDED');
      if (first.kind !== 'RECORDED' || second.kind !== 'RECORDED') return;
      assert.equal(second.duplicate, true);
      assert.equal(second.transaction.id, first.transaction.id);
      assert.deepEqual(await snapshotCounts(env.db), before);
    });

    it('T3: "lương chồng 20tr" do VO nhắn → thực hiện CHONG, holder CHONG, không hỏi lại', async () => {
      const out = await env.txs.recordFromText(msg(MEMBER_ID.VO, 'lương chồng 20tr'));
      assert.equal(out.kind, 'RECORDED');
      if (out.kind !== 'RECORDED') return;
      assert.equal(out.transaction.loai_giao_dich, 'THU');
      assert.equal(out.transaction.nguoi_tao_id, 'VO');
      assert.equal(out.transaction.nguoi_thuc_hien_id, 'CHONG');
      assert.equal(out.transaction.nguoi_giu_tien_id, 'CHONG');
      assert.equal(out.confirmations.length, 0);
      assert.equal(await count(env.db, 'yeu_cau_xac_nhan'), 0);
    });

    it('T4: không nêu ai giữ → người nhắn; "lấy quỹ chung" → QUY_CHUNG', async () => {
      const a = await env.txs.recordFromText(msg(MEMBER_ID.VO, 'tiền ăn 50k'));
      const b = await env.txs.recordFromText(msg(MEMBER_ID.VO, 'đi chợ 200k lấy quỹ chung'));
      assert.ok(a.kind === 'RECORDED' && b.kind === 'RECORDED');
      if (a.kind !== 'RECORDED' || b.kind !== 'RECORDED') return;
      assert.equal(a.transaction.nguoi_giu_tien_id, 'VO');
      assert.equal(b.transaction.nguoi_giu_tien_id, 'QUY_CHUNG');
    });

    it('T5: VO bấm xác nhận yêu cầu của CHONG → lỗi sai người, không đổi gì', async () => {
      const out = await env.txs.recordFromText(msg(MEMBER_ID.CHONG, 'tiền ăn'));
      assert.equal(out.kind, 'PENDING');
      if (out.kind !== 'PENDING') return;
      const req = out.confirmations[0]!;
      const before = await snapshotCounts(env.db);
      await expectDomainError(
        env.txs.resolveConfirmation(req.id, MEMBER_ID.VO, { type: 'ACCEPT', data: { so_tien: 50_000 } }),
        'WRONG_CONFIRMER',
      );
      assert.deepEqual(await snapshotCounts(env.db), before);
      const row = await env.db.queryOne<{ trang_thai: string }>('SELECT trang_thai FROM yeu_cau_xac_nhan WHERE id = $1', [req.id]);
      assert.equal(row?.trang_thai, 'CHO_XAC_NHAN');
    });

    it('T6: xác nhận 2 lần chỉ ghi 1 giao dịch; huỷ 2 lần chỉ huỷ 1 lần', async () => {
      const out = await env.txs.recordFromText(msg(MEMBER_ID.CHONG, 'tiền ăn'));
      assert.equal(out.kind, 'PENDING');
      if (out.kind !== 'PENDING') return;
      const req = out.confirmations[0]!;
      const first = await env.txs.resolveConfirmation(req.id, MEMBER_ID.CHONG, { type: 'ACCEPT', data: { so_tien: 50_000 } });
      assert.equal(first.changed, true);
      assert.ok(first.transaction);
      assert.equal(first.transaction?.idempotency_key, `tg:${out.message.telegram_update_id}`);
      const second = await env.txs.resolveConfirmation(req.id, MEMBER_ID.CHONG, { type: 'ACCEPT', data: { so_tien: 99_000 } });
      assert.equal(second.changed, false);
      assert.equal(second.transaction?.id, first.transaction?.id);
      assert.equal(await count(env.db, 'giao_dich'), 1);
      const msgRow = await env.db.queryOne<{ trang_thai_xu_ly: string }>('SELECT trang_thai_xu_ly FROM tin_nhan_goc WHERE id = $1', [out.message.id]);
      assert.equal(msgRow?.trang_thai_xu_ly, 'DA_GHI');

      const c1 = await env.txs.cancelTransaction(first.transaction!.id, MEMBER_ID.CHONG, 'nhập nhầm');
      const c2 = await env.txs.cancelTransaction(first.transaction!.id, MEMBER_ID.CHONG, 'nhập nhầm');
      assert.equal(c1.changed, true);
      assert.equal(c1.transaction.trang_thai, 'DA_HUY');
      assert.equal(c2.changed, false);
      assert.equal(await count(env.db, 'lich_su_chinh_sua', "hanh_dong = 'CANCEL'"), 1);
    });

    it('T6b: huỷ lần trả nợ 2 lần → dư nợ chỉ hoàn 1 lần', async () => {
      const loan = await env.debt.createLoan({
        idempotencyKey: apiKey(), chieuNo: 'DI_VAY', tenKhoanNo: 'Vay NH', doiTac: 'Ngân hàng',
        soTien: 10_000_000, ngay: '2026-11-02', nguoiTaoId: 'CHONG', nguoiGiuTienId: 'CHONG',
      });
      const pay = await env.debt.repayPrincipal({
        idempotencyKey: apiKey(), khoanNoId: loan.loan.id, soTien: 4_000_000, ngay: '2026-11-03', nguoiTaoId: 'CHONG', nguoiGiuTienId: 'CHONG',
      });
      await env.txs.cancelTransaction(pay.transaction.id, MEMBER_ID.CHONG);
      await env.txs.cancelTransaction(pay.transaction.id, MEMBER_ID.CHONG);
      const row = await env.db.queryOne<{ du_no_hien_tai: number }>('SELECT du_no_hien_tai FROM khoan_no WHERE id = $1', [loan.loan.id]);
      assert.equal(Number(row?.du_no_hien_tai), 10_000_000);
    });

    it('T6c: bấm lặp ACCEPT không kèm dữ liệu sau khi đã ghi → no-op, không lỗi', async () => {
      const out = await env.txs.recordFromText(msg(MEMBER_ID.VO, 'tiền ăn'));
      if (out.kind !== 'PENDING') throw new Error('expected PENDING');
      const id = out.confirmations[0]!.id;
      await env.txs.resolveConfirmation(id, MEMBER_ID.VO, { type: 'ACCEPT', data: { so_tien: 50_000 } });
      const again = await env.txs.resolveConfirmation(id, MEMBER_ID.VO, { type: 'ACCEPT' });
      assert.equal(again.changed, false);
      assert.equal(await count(env.db, 'giao_dich'), 1);
    });

    it('Trả lời đổi người thực hiện → người giữ mặc định đi theo; câu nói rõ người giữ thì giữ nguyên', async () => {
      const a = await env.txs.recordFromText(msg(MEMBER_ID.VO, 'tiền ăn'));
      const b = await env.txs.recordFromText(msg(MEMBER_ID.VO, 'tiền ăn lấy quỹ chung'));
      if (a.kind !== 'PENDING' || b.kind !== 'PENDING') throw new Error('expected PENDING');
      const ra = await env.txs.resolveConfirmation(a.confirmations[0]!.id, MEMBER_ID.VO, {
        type: 'ACCEPT', data: { so_tien: 50_000, nguoi_thuc_hien_id: 'CHONG' },
      });
      const rb = await env.txs.resolveConfirmation(b.confirmations[0]!.id, MEMBER_ID.VO, {
        type: 'ACCEPT', data: { so_tien: 50_000, nguoi_thuc_hien_id: 'CHONG' },
      });
      assert.equal(ra.transaction?.nguoi_giu_tien_id, 'CHONG');
      assert.equal(rb.transaction?.nguoi_giu_tien_id, 'QUY_CHUNG');
    });

    it('Danh mục lệch loại ("thu: tiền ăn 50k") → hỏi lại DANH_MUC_MOI; hàm tường minh từ chối', async () => {
      const out = await env.txs.recordFromText(msg(MEMBER_ID.VO, 'thu: tiền ăn 50k'));
      assert.equal(out.kind, 'PENDING');
      if (out.kind !== 'PENDING') return;
      assert.equal(out.confirmations[0]?.loai_xac_nhan, CONFIRMATION_TYPE.DANH_MUC_MOI);
      const base = { soTien: 1_000, nguoiTaoId: 'VO' as const, nguoiGiuTienId: 'VO' as const, moTa: 'x', ngayGiaoDich: '2026-11-04' };
      await expectDomainError(env.txs.recordExplicit({ ...base, idempotencyKey: apiKey(), loai: 'CHI', maDanhMuc: 'LUONG' }), 'INVALID_INPUT');
      await expectDomainError(env.txs.recordExplicit({ ...base, idempotencyKey: apiKey(), loai: 'PHI', maDanhMuc: 'THUC_AN' }), 'INVALID_INPUT');
    });

    it('T7: "tiền ăn" thiếu số tiền → không ghi, tin CHO_XAC_NHAN + GIAO_DICH_MO_HO; từ chối → DA_BO_QUA', async () => {
      const out = await env.txs.recordFromText(msg(MEMBER_ID.VO, 'tiền ăn'));
      assert.equal(out.kind, 'PENDING');
      if (out.kind !== 'PENDING') return;
      assert.equal(await count(env.db, 'giao_dich'), 0);
      assert.equal(out.message.trang_thai_xu_ly, 'CHO_XAC_NHAN');
      assert.deepEqual(out.confirmations.map((c) => c.loai_xac_nhan), [CONFIRMATION_TYPE.GIAO_DICH_MO_HO]);
      const req = out.confirmations[0]!;
      assert.ok(JSON.parse(req.du_lieu_de_xuat_json).parsed, 'yêu cầu giữ dữ liệu thô');
      const rej = await env.txs.resolveConfirmation(req.id, MEMBER_ID.VO, { type: 'REJECT' });
      assert.equal(rej.changed, true);
      assert.equal(rej.confirmation.trang_thai, 'TU_CHOI');
      const m = await env.db.queryOne<{ trang_thai_xu_ly: string }>('SELECT trang_thai_xu_ly FROM tin_nhan_goc WHERE id = $1', [out.message.id]);
      assert.equal(m?.trang_thai_xu_ly, 'DA_BO_QUA');
      assert.equal(await count(env.db, 'giao_dich'), 0);
    });

    it('T8: "vay ngân hàng 10tr" qua tin nhắn → không ghi, GIAO_DICH_MO_HO (Q8)', async () => {
      const out = await env.txs.recordFromText(msg(MEMBER_ID.CHONG, 'vay ngân hàng 10tr'));
      assert.equal(out.kind, 'PENDING');
      if (out.kind !== 'PENDING') return;
      assert.equal(await count(env.db, 'giao_dich'), 0);
      assert.equal(out.confirmations[0]?.loai_xac_nhan, CONFIRMATION_TYPE.GIAO_DICH_MO_HO);
      assert.equal(JSON.parse(out.confirmations[0]!.du_lieu_de_xuat_json).ly_do, 'VAY_TU_TIN_NHAN');
      // Trả lời bằng loại VAY vẫn không ghi được qua đường này: nợ phải đi DebtService
      await expectDomainError(
        env.txs.resolveConfirmation(out.confirmations[0]!.id, MEMBER_ID.CHONG, { type: 'ACCEPT' }),
        'NOT_SUPPORTED',
      );
    });

    it('T9: "50k" không rõ tiền gì / "chi 50k abc" danh mục mới → không ghi, hỏi lại; chọn danh mục → ghi', async () => {
      const a = await env.txs.recordFromText(msg(MEMBER_ID.VO, '50k'));
      const b = await env.txs.recordFromText(msg(MEMBER_ID.VO, 'chi 50k abc'));
      assert.ok(a.kind === 'PENDING' && b.kind === 'PENDING');
      if (a.kind !== 'PENDING' || b.kind !== 'PENDING') return;
      assert.equal(a.confirmations[0]?.loai_xac_nhan, CONFIRMATION_TYPE.GIAO_DICH_MO_HO);
      assert.equal(b.confirmations[0]?.loai_xac_nhan, CONFIRMATION_TYPE.DANH_MUC_MOI);
      assert.equal(await count(env.db, 'giao_dich'), 0);

      // Chọn danh mục chưa có → lỗi, yêu cầu vẫn chờ
      await expectDomainError(
        env.txs.resolveConfirmation(b.confirmations[0]!.id, MEMBER_ID.VO, { type: 'ACCEPT', data: { ma_danh_muc: 'KHONG_CO' } }),
        'INVALID_INPUT',
      );
      const ok = await env.txs.resolveConfirmation(b.confirmations[0]!.id, MEMBER_ID.VO, {
        type: 'ACCEPT',
        data: { ma_danh_muc: 'CHI_KHAC' },
      });
      assert.equal(ok.transaction?.danh_muc_id, 'DM_CHI_KHAC');
      assert.equal(ok.transaction?.nguoi_giu_tien_id, 'VO');
      assert.equal(await count(env.db, 'giao_dich'), 1);
    });

    it('T9b: đối tượng mới vẫn ghi HOAN_TAT + yêu cầu DOI_TUONG_MOI', async () => {
      // Parser chưa nhận diện tên lạ ("bé Na") → giả lập cờ DOI_TUONG_MOI
      const parsed = parseTx('CHI: mua quà cho bé Na 200k', 'VO');
      parsed.requires_confirmation = [CONFIRMATION_TYPE.DOI_TUONG_MOI];
      const out = await env.txs.recordFromParsed(msg(MEMBER_ID.VO, 'CHI: mua quà cho bé Na 200k'), parsed);
      assert.equal(out.kind, 'RECORDED');
      if (out.kind !== 'RECORDED') return;
      assert.equal(out.transaction.trang_thai, 'HOAN_TAT');
      assert.equal(out.message.trang_thai_xu_ly, 'DA_GHI');
      assert.deepEqual(out.confirmations.map((c) => c.loai_xac_nhan), [CONFIRMATION_TYPE.DOI_TUONG_MOI]);
      // Huỷ giao dịch → đóng yêu cầu còn chờ đi kèm
      await env.txs.cancelTransaction(out.transaction.id, MEMBER_ID.VO);
      assert.equal(await count(env.db, 'yeu_cau_xac_nhan', "trang_thai = 'TU_CHOI'"), 1);
    });

    it('T16 (tin nhắn): DIEU_CHINH từ tin nhắn → GIAO_DICH_MO_HO, không ghi', async () => {
      const out = await env.txs.recordFromText(msg(MEMBER_ID.CHONG, 'dieu chinh: 1tr'));
      assert.equal(out.kind, 'PENDING');
      assert.equal(await count(env.db, 'giao_dich'), 0);
    });

    it('LAI_VAY không gắn khoản nợ từ tin nhắn → ghi luôn như khoản chi', async () => {
      const out = await env.txs.recordFromText(msg(MEMBER_ID.CHONG, 'lãi vay: 200k'));
      assert.equal(out.kind, 'RECORDED');
      if (out.kind !== 'RECORDED') return;
      assert.equal(out.transaction.loai_giao_dich, 'LAI_VAY');
      assert.equal(out.transaction.khoan_no_id, null);
    });

    it('Hàm tường minh: key bắt buộc api:<uuid>, gọi lặp không ghi 2 lần, VAY/TRA_NO phải qua DebtService', async () => {
      const base = {
        loai: 'CHI' as const, soTien: 100_000, maDanhMuc: 'THUC_AN', nguoiTaoId: MEMBER_ID.VO,
        nguoiGiuTienId: 'VO' as const, moTa: 'ăn trưa', ngayGiaoDich: '2026-11-04',
      };
      await expectDomainError(env.txs.recordExplicit({ ...base, idempotencyKey: 'abc' }), 'INVALID_INPUT');
      const key = apiKey();
      const a = await env.txs.recordExplicit({ ...base, idempotencyKey: key });
      const b = await env.txs.recordExplicit({ ...base, idempotencyKey: key });
      assert.equal(b.duplicate, true);
      assert.equal(b.transaction.id, a.transaction.id);
      await expectDomainError(env.txs.recordExplicit({ ...base, loai: 'VAY', idempotencyKey: apiKey() }), 'NOT_SUPPORTED');
      await expectDomainError(
        env.txs.recordExplicit({ ...base, loai: 'DIEU_CHINH', maDanhMuc: null, idempotencyKey: apiKey() }),
        'INVALID_INPUT',
      );
    });

    it('T22: lỗi giữa transaction ở bất kỳ lệnh ghi nào → không còn dòng dở', async () => {
      const before = await snapshotCounts(env.db);
      for (let failAt = 1; failAt <= 4; failAt += 1) {
        const faulty = new FaultyAdapter(env.db, { calls: 0, failAt });
        const svc = new TransactionService(faulty);
        await assert.rejects(svc.recordFromText(msg(MEMBER_ID.VO, 'tiền ăn 50k')));
        assert.deepEqual(await snapshotCounts(env.db), before, `recordFromText failAt=${failAt}`);
      }
      for (let failAt = 1; failAt <= 5; failAt += 1) {
        const faulty = new FaultyAdapter(env.db, { calls: 0, failAt });
        const debt = new DebtService(faulty);
        await assert.rejects(
          debt.createLoan({
            idempotencyKey: apiKey(), chieuNo: 'DI_VAY', tenKhoanNo: 'Vay', doiTac: 'NH', soTien: 1_000_000,
            ngay: '2026-11-04', nguoiTaoId: 'CHONG', nguoiGiuTienId: 'CHONG',
          }),
        );
        assert.deepEqual(await snapshotCounts(env.db), before, `createLoan failAt=${failAt}`);
      }
    });

    it('T24: tin nhắn lúc 00:30 giờ VN (17:30Z hôm trước) → ngày giao dịch theo VN', async () => {
      assert.equal(toVnDate(new Date('2026-11-03T17:30:00.000Z')), '2026-11-04');
      assert.equal(toVnDate(new Date('2026-11-03T16:59:59.000Z')), '2026-11-03');
      const out = await env.txs.recordFromText(msg(MEMBER_ID.VO, 'tiền ăn 50k', '2026-11-03T17:30:00.000Z'));
      assert.equal(out.kind, 'RECORDED');
      if (out.kind !== 'RECORDED') return;
      assert.equal(out.transaction.ngay_giao_dich, '2026-11-04');
    });

    it('T25c: người gửi không active / không có → tin DA_BO_QUA, không ghi gì khác', async () => {
      await env.db.execute("UPDATE thanh_vien SET is_active = FALSE WHERE id = 'VO'");
      const a = await env.txs.recordFromText(msg(MEMBER_ID.VO, 'tiền ăn 50k'));
      const b = await env.txs.recordFromText(msg(999999, 'tiền ăn 50k'));
      assert.equal(a.kind, 'IGNORED');
      assert.equal(b.kind, 'IGNORED');
      assert.equal(await count(env.db, 'tin_nhan_goc', "trang_thai_xu_ly = 'DA_BO_QUA' AND nguoi_gui_id IS NULL"), 2);
      assert.equal(await count(env.db, 'giao_dich'), 0);
      assert.equal(await count(env.db, 'yeu_cau_xac_nhan'), 0);
    });

    it('Yêu cầu quá hạn 7 ngày → xác nhận không ghi (chuyển HET_HAN là việc job Phase 5)', async () => {
      const out = await env.txs.recordFromText(msg(MEMBER_ID.VO, 'tiền ăn'));
      if (out.kind !== 'PENDING') throw new Error('expected PENDING');
      env.setNow('2026-11-12T03:00:00.000Z');
      const res = await env.txs.resolveConfirmation(out.confirmations[0]!.id, MEMBER_ID.VO, {
        type: 'ACCEPT',
        data: { so_tien: 50_000 },
      });
      assert.equal(res.changed, false);
      assert.equal(res.expired, true);
      assert.equal(await count(env.db, 'giao_dich'), 0);
    });
  });
}
