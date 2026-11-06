import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { CONFIRMATION_TYPE, MEMBER_ID } from '../src/config/constants.ts';
import { insertConfirmation } from '../src/db/repositories/index.ts';
import { parseVietnameseFinanceMessage } from '../src/parser/index.ts';
import type { ParsedTransactionResult } from '../src/parser/types.ts';
import { ExpiryService, newId } from '../src/services/index.ts';
import { BACKENDS, count, legacyPending, msg, type TestEnv } from './helpers/phase3-env.ts';
import { CHONG, VO, answers, button, createHarness, sentTo, type BotHarness, TestDb } from './helpers/phase5-bot.ts';

// Yêu cầu tạo lúc 2026-11-04T03:00Z (legacyPending) / 2026-11-05T03:00Z (bot) → hạn +7 ngày
const AFTER_ALL = '2026-11-13T00:00:00.000Z';

async function status(env: TestEnv, table: string, id: string, col = 'trang_thai'): Promise<string | undefined> {
  const row = await env.db.queryOne<Record<string, string>>(`SELECT ${col} AS s FROM ${table} WHERE id = $1`, [id]);
  return row?.s;
}

for (const backend of BACKENDS) {
  describe(`Phase 5 — job hết hạn [${backend.name}]`, () => {
    let env: TestEnv;
    let h: BotHarness;
    beforeEach(async () => {
      env = await backend.open();
      h = createHarness(env.db);
    });
    afterEach(async () => {
      await env.close();
    });

    it('J1: MO_HO cũ, CHUYEN_TIEN, DOI_TUONG_MOI quá hạn → HET_HAN; báo người chuyển; tin DA_BO_QUA trừ DOI_TUONG_MOI; audit; chạy lại không ghi thêm', async () => {
      const old = await legacyPending(env, MEMBER_ID.VO, 'tiền ăn');
      await h.text(CHONG, 'chuyển vợ 3tr');
      const yc = button(sentTo(h.tg.take(), VO)[0], 'yc:');
      const parsed = parseVietnameseFinanceMessage('CHI: mua quà cho bé Na 200k', {
        senderId: 'VO',
        referenceDate: '2026-11-04',
      }) as ParsedTransactionResult;
      parsed.requires_confirmation = [CONFIRMATION_TYPE.DOI_TUONG_MOI];
      const dt = await env.txs.recordFromParsed(msg(MEMBER_ID.VO, 'CHI: mua quà cho bé Na 200k'), parsed);
      assert.equal(dt.kind, 'RECORDED');
      if (dt.kind !== 'RECORDED') return;

      h.setNow(AFTER_ALL);
      await h.cron();
      const calls = h.tg.take();
      assert.equal(calls.length, 1, 'chỉ báo chuyển tiền hết hạn (Q7)');
      assert.equal(calls[0]?.chatId, CHONG);
      assert.match(calls[0]?.text ?? '', /3\.000\.000đ cho vợ \(05\/11\) đã hết hạn.*nhắn lại/);

      assert.equal(await count(env.db, 'yeu_cau_xac_nhan', "trang_thai = 'HET_HAN'"), 3);
      assert.equal(await count(env.db, 'chuyen_tien_noi_bo', "trang_thai = 'HET_HAN'"), 1);
      assert.equal(await status(env, 'tin_nhan_goc', old.message.id, 'chi_tiet_loi'), 'HET_HAN');
      assert.equal(await status(env, 'tin_nhan_goc', old.message.id, 'trang_thai_xu_ly'), 'DA_BO_QUA');
      assert.equal(await status(env, 'tin_nhan_goc', dt.message.id, 'trang_thai_xu_ly'), 'DA_GHI');
      assert.equal(await count(env.db, 'tin_nhan_goc', "chi_tiet_loi = 'HET_HAN'"), 2);
      const audits = await count(env.db, 'lich_su_chinh_sua', "ly_do = 'HET_HAN' AND nguoi_thuc_hien_id IS NULL");
      assert.equal(audits, 6, '1 chuyển + 3 yêu cầu + 2 tin');

      await h.cron();
      assert.equal(h.tg.calls.length, 0);
      assert.equal(await count(env.db, 'lich_su_chinh_sua', "ly_do = 'HET_HAN'"), audits);

      // Sau hết hạn: bấm Đã nhận → không ghi
      await h.click(VO, yc);
      assert.match(answers(h.tg.take())[0]?.text ?? '', /đã được xử lý/);
      assert.equal(await count(env.db, 'chuyen_tien_noi_bo', "trang_thai = 'DA_XAC_NHAN'"), 0);
    });

    it('J2: biên expires_at — đúng bằng now thì hết hạn, trước 1ms thì chưa', async () => {
      const a = await legacyPending(env, MEMBER_ID.VO, 'tiền ăn');
      const expires = a.confirmations[0]!.expires_at;
      const before = new ExpiryService(env.db, { now: () => new Date(Date.parse(expires) - 1) });
      assert.deepEqual(await before.expireOverdue(), { expired: 0, failed: 0, transfers: [] });
      const at = new ExpiryService(env.db, { now: () => new Date(expires) });
      assert.equal((await at.expireOverdue()).expired, 1);
      assert.equal(await status(env, 'yeu_cau_xac_nhan', a.confirmations[0]!.id), 'HET_HAN');
    });

    it('J3: "Đã nhận" chen giữa job → bên nhận thắng, job rollback yêu cầu đó; tin có 2 yêu cầu chặn → đóng cả 2, tin 1 lần', async () => {
      await h.text(CHONG, 'chuyển vợ 3tr');
      h.tg.take();
      const request = await env.db.queryOne<{ id: string }>("SELECT id FROM yeu_cau_xac_nhan WHERE loai_xac_nhan = 'CHUYEN_TIEN'");

      const db = new TestDb(env.db);
      db.afterQuery = async (sql) => {
        if (/expires_at <= \$1/.test(sql)) {
          db.afterQuery = null;
          // Người nhận bấm (đồng hồ của họ còn trong hạn) ngay sau khi job đọc danh sách
          await env.txs.resolveConfirmation(request!.id, 'VO', { type: 'ACCEPT' });
        }
      };
      const job = new ExpiryService(db, { now: () => new Date(AFTER_ALL) });
      const res = await job.expireOverdue();
      assert.deepEqual([res.expired, res.failed, res.transfers.length], [0, 1, 0]);
      assert.equal(await count(env.db, 'chuyen_tien_noi_bo', "trang_thai = 'DA_XAC_NHAN'"), 1);
      assert.equal(await status(env, 'yeu_cau_xac_nhan', request!.id), 'DA_XAC_NHAN');
      assert.equal(await count(env.db, 'lich_su_chinh_sua', "ly_do = 'HET_HAN'"), 0);

      const two = await legacyPending(env, MEMBER_ID.CHONG, 'chi 50k abc');
      await env.db.transaction((tx) =>
        insertConfirmation(tx, {
          id: newId('YC'),
          source_message_id: two.message.id,
          nguoi_tao_id: 'CHONG',
          nguoi_can_xac_nhan_id: 'CHONG',
          loai_xac_nhan: CONFIRMATION_TYPE.DANH_MUC_MOI,
          du_lieu_de_xuat: {},
          expires_at: two.confirmations[0]!.expires_at,
          nowIso: '2026-11-04T03:00:00.000Z',
        }),
      );
      const r2 = await new ExpiryService(env.db, { now: () => new Date(AFTER_ALL) }).expireOverdue();
      assert.deepEqual([r2.expired, r2.failed], [2, 0]);
      assert.equal(await status(env, 'tin_nhan_goc', two.message.id, 'trang_thai_xu_ly'), 'DA_BO_QUA');
      assert.equal(await count(env.db, 'lich_su_chinh_sua', "ten_bang = 'tin_nhan_goc' AND ly_do = 'HET_HAN'"), 1);
    });
  });
}
