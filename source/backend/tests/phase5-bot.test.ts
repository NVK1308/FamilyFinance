import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { CALLBACK_MAX_BYTES, categoryCodeFits, decodeCallback, encodeCallback } from '../src/bot/callback-data.ts';
import { parseCommand, parseInitialArgs } from '../src/bot/commands.ts';
import { constantTimeEqual, vnMonthRange } from '../src/services/common.ts';
import { TelegramApiError } from '../src/telegram/client.ts';
import { createWorker } from '../src/worker.ts';
import { BACKENDS, INITIAL_DATE, count, seedInitial, type TestEnv } from './helpers/phase3-env.ts';
import {
  CHONG,
  ENV,
  STRANGER,
  VO,
  answers,
  button,
  buttons,
  createHarness,
  edits,
  sentTo,
  type BotHarness,
} from './helpers/phase5-bot.ts';

async function gd(env: TestEnv): Promise<{ id: string; loai_giao_dich: string; danh_muc_id: string; trang_thai: string }> {
  const row = await env.db.queryOne<{ id: string; loai_giao_dich: string; danh_muc_id: string; trang_thai: string }>(
    'SELECT id, loai_giao_dich, danh_muc_id, trang_thai FROM giao_dich ORDER BY created_at DESC, id DESC',
  );
  assert.ok(row, 'chưa có giao dịch');
  return row;
}

describe('Phase 5 — hàm thuần', () => {
  it('callback_data ≤ 64 byte với mã danh mục dài nhất; giải mã đúng / bỏ qua dữ liệu lạ', () => {
    const id = `GD_${crypto.randomUUID()}`;
    const longest = encodeCallback({ kind: 'dm', id, code: 'TIEN_DUOC_CHO' });
    assert.ok(new TextEncoder().encode(longest).length <= CALLBACK_MAX_BYTES);
    assert.deepEqual(decodeCallback(longest), { kind: 'dm', id, code: 'TIEN_DUOC_CHO' });
    assert.deepEqual(decodeCallback(`yc:YC_x-1:R`), { kind: 'yc', id: 'YC_x-1', accept: false });
    assert.deepEqual(decodeCallback('ct:CT_1'), { kind: 'ct', id: 'CT_1' });
    assert.deepEqual(decodeCallback('lt:GD_1:C'), { kind: 'lt', id: 'GD_1', to: 'CHI' });
    assert.equal(categoryCodeFits(id, 'TIEN_DUOC_CHO'), true);
    assert.equal(categoryCodeFits(id, 'X'.repeat(30)), false);
    assert.equal(categoryCodeFits(id, 'an-uong'), false);
    for (const bad of [undefined, '', 'zz:1', 'yc:1:X', 'gd:', 'gd:a b', 'dm:1:abc', 'lt:GD_1']) {
      assert.equal(decodeCallback(bad), null, String(bad));
    }
    assert.throws(() => encodeCallback({ kind: 'dm', id, code: 'X'.repeat(30) }));
  });

  it('lệnh: bỏ hậu tố @tenbot, tách tham số; so sánh secret; tháng theo giờ VN', () => {
    assert.deepEqual(parseCommand('/thang@family_bot'), { name: 'thang', args: [] });
    assert.deepEqual(parseCommand('/sodudau 5tr  3tr 0'), { name: 'sodudau', args: ['5tr', '3tr', '0'] });
    assert.equal(parseCommand('tiền ăn 50k'), null);
    assert.equal(constantTimeEqual('abc', 'abc'), true);
    assert.equal(constantTimeEqual('abc', 'abd'), false);
    assert.equal(constantTimeEqual('abc', 'abcd'), false);
    assert.equal(constantTimeEqual('', 'a'), false);
    // 17:30Z 31/10 = 00:30 ngày 1/11 giờ VN
    assert.deepEqual(vnMonthRange(new Date('2026-10-31T17:30:00Z')), { from: '2026-11-01', to: '2026-11-30' });
    assert.deepEqual(vnMonthRange(new Date('2026-02-10T03:00:00Z')), { from: '2026-02-01', to: '2026-02-28' });
  });

  it('/sodudau: nhận dạng có tên (thứ tự bất kỳ) hoặc 3 số; thiếu khoản → báo rõ', () => {
    const p = (t: string) => parseInitialArgs(t.split(' ').filter(Boolean), 'CHONG');
    assert.deepEqual(p('5tr 10tr 0'), { vo: 5_000_000, chong: 10_000_000, quy: 0 });
    assert.deepEqual(p('chồng 10tr vợ 5tr quỹ 0'), { vo: 5_000_000, chong: 10_000_000, quy: 0 });
    assert.deepEqual(p('Vợ: 5tr, chong 24tr1 quỹ chung 2.000.000'), { vo: 5_000_000, chong: 24_100_000, quy: 2_000_000 });
    assert.deepEqual(p('chồng 10tr'), { error: 'Thiếu số của: vợ, quỹ chung.' });
    assert.ok('error' in p('5tr'));
    assert.ok('error' in p('<chồng> 5tr'));
    assert.ok('error' in p('vợ 5tr vợ 3tr quỹ 0 chồng 1tr'));
    assert.ok('error' in p('vợ abc chồng 1tr quỹ 0'));
  });

  it('preview chỉ bật ở development; /health', async () => {
    const worker = createWorker({ dbFactory: () => { throw new Error('không dùng DB'); }, telegramFactory: () => null });
    const ctx = { waitUntil: () => undefined };
    const req = () =>
      new Request('https://bot.test/api/parser/preview', { method: 'POST', body: JSON.stringify({ rawText: 'tiền ăn 50k' }) });
    assert.equal((await worker.fetch(req(), { ...ENV, ENVIRONMENT: 'production' }, ctx)).status, 404);
    assert.equal((await worker.fetch(req(), {}, ctx)).status, 404);
    const dev = await worker.fetch(req(), { ENVIRONMENT: 'development' }, ctx);
    assert.equal(dev.status, 200);
    assert.equal(((await dev.json()) as { so_tien: number }).so_tien, 50_000);
    assert.equal((await worker.fetch(new Request('https://bot.test/health'), {}, ctx)).status, 200);
  });
});

for (const backend of BACKENDS) {
  describe(`Phase 5 — webhook + bot [${backend.name}]`, () => {
    let env: TestEnv;
    let h: BotHarness;
    beforeEach(async () => {
      env = await backend.open();
      h = createHarness(env.db);
    });
    afterEach(async () => {
      await env.close();
    });

    it('W1: thiếu biến secret / thiếu / sai header → 401, DB không đổi', async () => {
      const update = { update_id: 1, message: { message_id: 1, date: 0, chat: { id: CHONG, type: 'private' }, from: { id: CHONG }, text: 'tiền ăn 50k' } };
      assert.equal((await h.post(update, { env: { ...ENV, TELEGRAM_WEBHOOK_SECRET: undefined } })).status, 401);
      assert.equal((await h.post(update, { env: { ...ENV, TELEGRAM_WEBHOOK_SECRET: '' } })).status, 401);
      assert.equal((await h.post(update, { secret: null })).status, 401);
      assert.equal((await h.post(update, { secret: 'sai' })).status, 401);
      assert.equal(await count(env.db, 'tin_nhan_goc'), 0);
      assert.equal(h.tg.calls.length, 0);
    });

    it('W2: JSON hỏng → 200; lỗi tất định → 200 + tin LOI + báo; lỗi tạm thời → 500, không gửi', async () => {
      assert.equal((await h.post(null, { raw: '{hỏng' })).status, 200);

      h.db.fail = (sql) => (/INSERT INTO giao_dich/.test(sql) ? new Error('lỗi giả lập') : null);
      const { res } = await h.text(CHONG, 'tiền ăn 50k');
      assert.equal(res.status, 200);
      const row = await env.db.queryOne<{ trang_thai_xu_ly: string; chi_tiet_loi: string }>('SELECT * FROM tin_nhan_goc');
      assert.equal(row?.trang_thai_xu_ly, 'LOI');
      assert.match(row?.chi_tiet_loi ?? '', /lỗi giả lập/);
      assert.match(sentTo(h.tg.take(), CHONG)[0]?.text ?? '', /Lỗi/);
      assert.equal(await count(env.db, 'giao_dich'), 0);

      // Gửi lại update đã LOI → lý do cố định, không lộ lỗi nội bộ
      h.db.fail = null;
      const loiUpdate = { update_id: 900_500, message: { message_id: 1, date: 1_793_000_000, chat: { id: CHONG, type: 'private' }, from: { id: CHONG }, text: 'tiền ăn 50k' } };
      h.db.fail = (sql) => (/INSERT INTO giao_dich/.test(sql) ? new Error('lỗi nội bộ xyz') : null);
      await h.post(loiUpdate);
      h.db.fail = null;
      h.tg.take();
      await h.post(loiUpdate);
      const again = sentTo(h.tg.take(), CHONG)[0]?.text ?? '';
      assert.match(again, /bị lỗi lúc xử lý/);
      assert.doesNotMatch(again, /xyz/);

      // Lỗi sau khi đã ghi (lúc soạn trả lời) → không bảo nhắn lại
      h.db.fail = (sql) => (/FROM danh_muc WHERE id/.test(sql) ? new Error('lỗi sau commit') : null);
      await h.text(CHONG, 'tiền ăn 40k');
      h.db.fail = null;
      assert.match(sentTo(h.tg.take(), CHONG)[0]?.text ?? '', /đừng nhắn lại/);
      assert.equal(await count(env.db, 'giao_dich'), 1);

      h.db.fail = (sql) => (/INSERT INTO tin_nhan_goc/.test(sql) ? Object.assign(new Error('mất kết nối'), { code: '08006' }) : null);
      assert.equal((await h.text(CHONG, 'tiền ăn 60k')).res.status, 500);
      h.db.fail = (sql) => (/INSERT INTO tin_nhan_goc/.test(sql) ? new Error('Connection terminated unexpectedly') : null);
      assert.equal((await h.text(CHONG, 'tiền ăn 70k')).res.status, 500);
      assert.equal(h.tg.calls.length, 0);
      assert.equal(await count(env.db, 'tin_nhan_goc'), 3);
    });

    it('W3: không có chữ, chat nhóm, tin chuyển tiếp, update lạ → 200, không ghi, không gửi', async () => {
      await h.text(CHONG, '', { text: undefined, photo: [{}] });
      await h.text(CHONG, 'tiền ăn 50k', { chat: { id: -5, type: 'group' } });
      await h.text(CHONG, 'tiền ăn 50k', { forward_origin: { type: 'user' } });
      await h.text(CHONG, 'tiền ăn 50k', { forward_date: 1 });
      assert.equal((await h.post({ update_id: 5, my_chat_member: {} })).status, 200);
      assert.equal(await count(env.db, 'tin_nhan_goc'), 0);
      assert.equal(h.tg.calls.length, 0);
    });

    it('W4: sửa tin (thành viên) → nhắc Huỷ, DB không đổi; người lạ sửa → im', async () => {
      const edited = (from: number) => ({
        update_id: 7,
        edited_message: { message_id: 3, date: 0, chat: { id: from, type: 'private' }, from: { id: from }, text: 'tiền ăn 90k' },
      });
      await h.post(edited(VO));
      await h.post(edited(STRANGER));
      const calls = h.tg.take();
      assert.equal(calls.length, 1);
      assert.match(sentTo(calls, VO)[0]?.text ?? '', /bấm Huỷ/);
      assert.equal(await count(env.db, 'tin_nhan_goc'), 0);
    });

    it('W5: người lạ (cả lệnh) → lưu DA_BO_QUA có chat id, không trả lời', async () => {
      await h.text(STRANGER, 'tiền ăn 50k');
      await h.text(STRANGER, '/start');
      assert.equal(h.tg.calls.length, 0);
      assert.equal(await count(env.db, 'tin_nhan_goc', "trang_thai_xu_ly = 'DA_BO_QUA' AND telegram_chat_id = $1", [STRANGER]), 2);
      assert.equal(await count(env.db, 'giao_dich'), 0);
    });

    it('B1 + B7: "tiền ăn 50k" → ✅ + Huỷ; người kia bấm Huỷ → từ chối; người ghi huỷ → sửa tin; API cũ huỷ hộ vẫn được', async () => {
      await h.text(CHONG, 'tiền ăn 50k');
      const reply = sentTo(h.tg.take(), CHONG)[0];
      assert.match(reply?.text ?? '', /✅ Chi 50\.000đ · Thức ăn · chồng trả · 05\/11/);
      const cancel = button(reply, 'gd:');
      assert.equal(buttons(reply).length, 1);
      assert.ok(new TextEncoder().encode(cancel).length <= 64);

      await h.click(VO, cancel);
      assert.match(answers(h.tg.take())[0]?.text ?? '', /Chỉ người ghi/);
      assert.equal((await gd(env)).trang_thai, 'HOAN_TAT');

      await h.click(CHONG, cancel);
      const calls = h.tg.take();
      assert.equal(calls[0]?.method, 'answer', 'answer đặt đầu');
      assert.match(edits(calls)[0]?.text ?? '', /❌ Đã huỷ: Chi 50\.000đ/);
      assert.equal(edits(calls)[0]?.keyboard, undefined);
      assert.equal((await gd(env)).trang_thai, 'DA_HUY');
      await h.click(CHONG, cancel);
      assert.match(answers(h.tg.take())[0]?.text ?? '', /đã huỷ trước đó/);
      assert.equal(await count(env.db, 'lich_su_chinh_sua', "hanh_dong = 'CANCEL'"), 1);

      await h.text(CHONG, 'đi chợ 100k');
      const other = await env.db.queryOne<{ id: string }>("SELECT id FROM giao_dich WHERE trang_thai = 'HOAN_TAT'");
      const res = await env.txs.cancelTransaction(other!.id, 'VO');
      assert.equal(res.changed, true);
    });

    it('B3: thiếu / mơ hồ số tiền → không ghi, không yêu cầu, nhắc nhắn lại', async () => {
      await h.text(VO, 'tiền ăn');
      await h.text(VO, '3 hay 4 triệu');
      const calls = sentTo(h.tg.take(), VO);
      assert.match(calls[0]?.text ?? '', /Chưa rõ số tiền/);
      assert.match(calls[1]?.text ?? '', /có 2 số/);
      assert.equal(await count(env.db, 'giao_dich'), 0);
      assert.equal(await count(env.db, 'yeu_cau_xac_nhan'), 0);
    });

    it('B4: "cafe 30k" → Chi khác + bàn phím; chọn danh mục → UPDATE + audit; bấm lặp; người khác bấm; đổi Thu↔Chi; số dư đúng', async () => {
      await seedInitial(env);
      await h.text(CHONG, 'cafe 30k');
      const reply = sentTo(h.tg.take(), CHONG)[0];
      assert.match(reply?.text ?? '', /Chi 30\.000đ · Chi khác/);
      const all = buttons(reply);
      assert.ok(all.some((b) => b.data.endsWith(':THUC_AN')));
      assert.ok(!all.some((b) => /:(THU_HOI_NO|NO_CUA_ANH|LUONG)$/.test(b.data)), 'không có danh mục nợ / danh mục thu');
      assert.ok(all.some((b) => b.data.startsWith('lt:')) && all.some((b) => b.data.startsWith('gd:')));
      for (const b of all) assert.ok(new TextEncoder().encode(b.data).length <= 64, b.data);
      assert.equal(await count(env.db, 'yeu_cau_xac_nhan'), 0);

      const tx = await gd(env);
      assert.equal(tx.danh_muc_id, 'DM_CHI_KHAC');
      const before = await env.bal.getHolderBalances(INITIAL_DATE.replace('01', '05'));

      await h.click(VO, `dm:${tx.id}:THUC_AN`);
      assert.match(answers(h.tg.take())[0]?.text ?? '', /Chỉ người ghi/);

      await h.click(CHONG, `dm:${tx.id}:THUC_AN`);
      let calls = h.tg.take();
      assert.match(edits(calls)[0]?.text ?? '', /Chi 30\.000đ · Thức ăn/);
      assert.deepEqual(buttons(edits(calls)[0]).map((b) => b.data), [`gd:${tx.id}`]);
      assert.equal((await gd(env)).danh_muc_id, 'DM_THUC_AN');
      await h.click(CHONG, `dm:${tx.id}:THUC_AN`);
      assert.equal(await count(env.db, 'lich_su_chinh_sua', "ly_do = 'DOI_DANH_MUC'"), 1);
      h.tg.take();

      await h.click(CHONG, `dm:${tx.id}:LUONG`);
      assert.equal(answers(h.tg.take()).length, 1);
      assert.equal((await gd(env)).danh_muc_id, 'DM_THUC_AN');

      await h.click(CHONG, `lt:${tx.id}:T`);
      calls = h.tg.take();
      // Bấm lặp "Đổi sang Thu" (tin cũ / Telegram gửi lại) → không lật về Chi
      await h.click(CHONG, `lt:${tx.id}:T`);
      h.tg.take();
      const after = await gd(env);
      assert.equal(after.loai_giao_dich, 'THU');
      assert.equal(after.danh_muc_id, 'DM_THU_KHAC');
      assert.match(edits(calls)[0]?.text ?? '', /Thu 30\.000đ · Thu khác/);
      assert.ok(buttons(edits(calls)[0]).some((b) => b.data.endsWith(':TIEN_DUOC_CHO')));
      assert.ok(buttons(edits(calls)[0]).some((b) => b.data.endsWith(':QUA_TANG')), 'CA_HAI có ở cả 2 loại');
      const now = await env.bal.getHolderBalances(INITIAL_DATE.replace('01', '05'));
      assert.ok(before.status === 'OK' && now.status === 'OK');
      if (before.status === 'OK' && now.status === 'OK') {
        assert.equal(now.nhom.CHONG - before.nhom.CHONG, 60_000);
      }

      await h.click(CHONG, `gd:${tx.id}`);
      h.tg.take();
      await h.click(CHONG, `dm:${tx.id}:LUONG`);
      assert.match(answers(h.tg.take())[0]?.text ?? '', /đã huỷ/);
      assert.equal((await gd(env)).danh_muc_id, 'DM_THU_KHAC');
    });

    it('B4b: "chi 50k abc" / "50k" → Chi khác; "lương 10tr abc" → Lương, chỉ nút Huỷ; "quà tặng 200k" → giữ Quà tặng + bàn phím', async () => {
      await h.text(VO, 'chi 50k abc');
      await h.text(VO, '50k');
      await h.text(VO, 'lương 10tr abc');
      await h.text(VO, 'quà tặng 200k');
      const calls = sentTo(h.tg.take(), VO);
      assert.match(calls[0]?.text ?? '', /Chi khác/);
      assert.match(calls[1]?.text ?? '', /Chi khác/);
      assert.match(calls[2]?.text ?? '', /Thu 10\.000\.000đ · Lương/);
      assert.match(calls[2]?.text ?? '', /Lương · vợ nhận/);
      assert.equal(buttons(calls[2]).length, 1);
      assert.match(calls[3]?.text ?? '', /Chi 200\.000đ · Quà tặng/);
      assert.ok(buttons(calls[3]).length > 3);
    });

    it('B5: chuyển → người nhận trước (có nút) rồi người chuyển; 403 → ghi chú; lỗi tính cờ vượt số dư → vẫn ghi + trả lời', async () => {
      await seedInitial(env);
      await h.text(CHONG, 'chuyển vợ 3tr');
      let calls = h.tg.take();
      assert.equal(calls[0]?.chatId, VO);
      assert.match(calls[0]?.text ?? '', /Chồng chuyển bạn 3\.000\.000đ \(05\/11\)/);
      assert.deepEqual(buttons(calls[0]).map((b) => b.text), ['Đã nhận', 'Chưa nhận']);
      assert.equal(calls[1]?.chatId, CHONG);
      assert.match(calls[1]?.text ?? '', /chờ vợ xác nhận/);
      assert.ok(button(calls[1], 'ct:'));

      h.tg.failFor.set(VO, new TelegramApiError('sendMessage', 403, 'Forbidden: bot was blocked by the user'));
      await h.text(CHONG, 'chuyển vợ 1tr');
      calls = sentTo(h.tg.take(), CHONG);
      assert.equal(calls.length, 2);
      assert.match(calls[0]?.text ?? '', /chưa mở bot/);
      h.tg.failFor.clear();

      h.db.fail = (sql) => (/SUM\(so_tien\) AS total FROM chuyen_tien_noi_bo/.test(sql) ? new Error('lỗi tính') : null);
      const { res } = await h.text(CHONG, 'chuyển vợ 500k');
      h.db.fail = null;
      assert.equal(res.status, 200);
      assert.equal(sentTo(h.tg.take(), VO).length, 1);
      assert.equal(await count(env.db, 'chuyen_tien_noi_bo'), 3);
    });

    it('B2: gửi lại update chuyển → DB không thêm; còn chờ → gửi lại người nhận; đã nhận → không', async () => {
      const { update } = await h.text(CHONG, 'chuyển vợ 3tr');
      const yc = button(sentTo(h.tg.take(), VO)[0], 'yc:');
      await h.post(update);
      let calls = h.tg.take();
      assert.equal(sentTo(calls, VO).length, 1, 'còn chờ → gửi lại người nhận');
      assert.equal(sentTo(calls, CHONG).length, 1);
      await h.click(VO, yc);
      h.tg.take();
      await h.post(update);
      calls = h.tg.take();
      assert.equal(sentTo(calls, VO).length, 0);
      assert.match(sentTo(calls, CHONG)[0]?.text ?? '', /đã nhận/);
      assert.equal(await count(env.db, 'chuyen_tien_noi_bo'), 1);
      assert.equal(await count(env.db, 'tin_nhan_goc'), 1);
    });

    it('B6: Chưa nhận ×2 giữ nút, báo chồng 1 lần → Đã nhận ghi 1 lần + báo; bấm lặp; chồng bấm thay → từ chối', async () => {
      await h.text(CHONG, 'chuyển vợ 3tr');
      const accept = button(sentTo(h.tg.take(), VO)[0], 'yc:');
      const reject = accept.replace(/:A$/, ':R');

      await h.click(CHONG, accept);
      assert.match(answers(h.tg.take())[0]?.text ?? '', /không dành cho bạn/);

      await h.click(VO, reject);
      let calls = h.tg.take();
      assert.equal(edits(calls).length, 0, 'giữ nguyên bàn phím');
      assert.match(sentTo(calls, CHONG)[0]?.text ?? '', /Vợ báo chưa nhận được 3\.000\.000đ/);
      await h.click(VO, reject);
      calls = h.tg.take();
      assert.equal(sentTo(calls, CHONG).length, 0, 'chỉ báo lần đầu');
      assert.equal(answers(calls).length, 1);

      await h.click(VO, accept);
      calls = h.tg.take();
      assert.match(edits(calls)[0]?.text ?? '', /đã nhận/);
      assert.equal(edits(calls)[0]?.keyboard, undefined);
      assert.match(sentTo(calls, CHONG)[0]?.text ?? '', /Vợ đã nhận 3\.000\.000đ/);
      await h.click(VO, accept);
      calls = h.tg.take();
      assert.match(answers(calls)[0]?.text ?? '', /đã được xử lý/);
      assert.equal(sentTo(calls, CHONG).length, 0);
      await h.click(VO, reject);
      assert.match(answers(h.tg.take())[0]?.text ?? '', /đã được xử lý/);
      assert.equal(await count(env.db, 'chuyen_tien_noi_bo', "trang_thai = 'DA_XAC_NHAN'"), 1);
    });

    it('B7: huỷ chuyển (người nhận được báo); người nhận bấm Huỷ → từ chối; đã nhận → chặn; huỷ quỹ', async () => {
      await h.text(CHONG, 'chuyển vợ 3tr');
      const calls0 = h.tg.take();
      const yc = button(sentTo(calls0, VO)[0], 'yc:');
      const ct = button(sentTo(calls0, CHONG)[0], 'ct:');
      await h.click(VO, ct);
      assert.match(answers(h.tg.take())[0]?.text ?? '', /Chỉ người ghi|không dành/);
      await h.click(CHONG, ct);
      let calls = h.tg.take();
      assert.match(edits(calls)[0]?.text ?? '', /đã huỷ/);
      assert.match(sentTo(calls, VO)[0]?.text ?? '', /đã huỷ/);
      await h.click(VO, yc);
      assert.match(answers(h.tg.take())[0]?.text ?? '', /đã được xử lý/);

      await h.text(CHONG, 'chuyển vợ 1tr');
      calls = h.tg.take();
      await h.click(VO, button(sentTo(calls, VO)[0], 'yc:'));
      h.tg.take();
      await h.click(CHONG, button(sentTo(calls, CHONG)[0], 'ct:'));
      assert.match(answers(h.tg.take())[0]?.text ?? '', /chuyển ngược lại/);

      await h.text(VO, 'bỏ vào quỹ chung 2tr');
      const qc = button(sentTo(h.tg.take(), VO)[0], 'qc:');
      await h.click(CHONG, qc);
      assert.match(answers(h.tg.take())[0]?.text ?? '', /Chỉ người ghi/);
      await h.click(VO, qc);
      calls = h.tg.take();
      assert.match(edits(calls)[0]?.text ?? '', /❌ Đã huỷ: Nộp quỹ chung/);
      assert.match(sentTo(calls, CHONG)[0]?.text ?? '', /đã huỷ/);
    });

    it('B8: "bỏ vào quỹ chung 2tr" → trả lời + báo người kia; gửi lại → không báo lại', async () => {
      const { update } = await h.text(VO, 'bỏ vào quỹ chung 2tr');
      let calls = h.tg.take();
      assert.match(sentTo(calls, VO)[0]?.text ?? '', /✅ Nộp quỹ chung 2\.000\.000đ/);
      assert.match(sentTo(calls, CHONG)[0]?.text ?? '', /Vợ nộp vào quỹ chung 2\.000\.000đ/);
      await h.post(update);
      calls = h.tg.take();
      assert.equal(sentTo(calls, CHONG).length, 0);
      assert.equal(sentTo(calls, VO).length, 1);
    });

    it('B9: "ok"/"abc" không lưu, hướng dẫn; "/abc"; "đã nhận" khi có chuyển chờ → nhắc nút; câu hỏi → gợi ý lệnh', async () => {
      await h.text(VO, 'ok');
      await h.text(VO, 'abc');
      await h.text(VO, '/abc');
      await h.text(VO, 'đã nhận');
      await h.text(VO, 'số dư bao nhiêu');
      let calls = sentTo(h.tg.take(), VO);
      assert.match(calls[0]?.text ?? '', /Chưa hiểu/);
      assert.match(calls[1]?.text ?? '', /Chưa hiểu/);
      assert.match(calls[2]?.text ?? '', /Không có lệnh \/abc/);
      assert.match(calls[3]?.text ?? '', /Chưa hiểu/);
      assert.match(calls[4]?.text ?? '', /\/sodu/);
      assert.equal(await count(env.db, 'tin_nhan_goc'), 0);

      await h.text(CHONG, 'chuyển vợ 3tr');
      h.tg.take();
      await h.text(VO, 'Đã nhận');
      calls = sentTo(h.tg.take(), VO);
      assert.match(calls[0]?.text ?? '', /Bấm nút "Đã nhận"/);
    });

    it('B10: /sodu, /sodudau (lần đầu / lần 2 / sai cú pháp), /thang qua mốc 17h UTC, /cho, /help, /start@bot', async () => {
      await h.text(CHONG, '/sodu');
      assert.match(sentTo(h.tg.take(), CHONG)[0]?.text ?? '', /Chưa nhập số dư ban đầu/);
      await h.text(CHONG, '/sodudau 5tr 3tr');
      assert.match(sentTo(h.tg.take(), CHONG)[0]?.text ?? '', /Cú pháp/);
      await h.text(CHONG, '/sodudau 5tr 3.000.000 0');
      assert.match(sentTo(h.tg.take(), CHONG)[0]?.text ?? '', /Đã nhập số dư ban đầu ngày 05\/11/);
      await h.text(VO, '/sodudau 1tr 1tr 1tr');
      assert.match(sentTo(h.tg.take(), VO)[0]?.text ?? '', /đã nhập ngày 05\/11/);
      const initial = await env.db.query<{ ngay_ap_dung: string; so_tien: number }>('SELECT ngay_ap_dung, so_tien FROM so_du_ban_dau');
      assert.equal(initial.length, 4);
      assert.ok(initial.every((r) => r.ngay_ap_dung === '2026-11-05'));

      await h.text(CHONG, 'tiền ăn 50k');
      h.tg.take();
      await h.text(CHONG, '/sodu@family_bot');
      const sodu = sentTo(h.tg.take(), CHONG)[0]?.text ?? '';
      assert.match(sodu, /Vợ: 5\.000\.000đ/);
      assert.match(sodu, /Chồng: 2\.950\.000đ/);
      assert.match(sodu, /Tổng: 7\.950\.000đ/);

      // 31/10 17:30Z = 01/11 giờ VN → tháng 11
      h.setNow('2026-11-30T17:30:00.000Z');
      await h.text(VO, 'lương 10tr');
      h.setNow('2026-11-30T16:59:00.000Z');
      await h.text(VO, '/thang');
      const thang = sentTo(h.tg.take(), VO).at(-1)?.text ?? '';
      assert.match(thang, /Tháng 11\/2026/);
      assert.match(thang, /Thu: 0đ/, 'lương ngày 01/12 VN không vào tháng 11');
      assert.match(thang, /Chi: 50\.000đ/);

      await h.text(VO, '/cho');
      assert.match(sentTo(h.tg.take(), VO)[0]?.text ?? '', /Không có khoản chuyển/);
      await h.text(CHONG, 'chuyển vợ 1tr');
      h.tg.take();
      await h.text(VO, '/cho');
      const cho = sentTo(h.tg.take(), VO)[0];
      assert.ok(button(cho, 'yc:').endsWith(':A'));
      await h.text(CHONG, '/cho');
      assert.ok(button(sentTo(h.tg.take(), CHONG)[0], 'ct:'));

      await h.text(VO, '/start@family_bot');
      await h.text(VO, '/help');
      const help = sentTo(h.tg.take(), VO);
      assert.match(help[0]?.text ?? '', /\/sodu/);
      assert.match(help[1]?.text ?? '', /\/ghichu/);
      assert.equal(await count(env.db, 'tin_nhan_goc', "noi_dung_goc LIKE '/%'"), 0, 'lệnh không lưu');
    });

    it('B10b: /sodudau khi đã có giao dịch từ hôm nay → nhập + cảnh báo', async () => {
      await h.text(VO, 'tiền ăn 50k');
      h.tg.take();
      await h.text(VO, '/sodudau 5tr 3tr 2tr');
      assert.match(sentTo(h.tg.take(), VO)[0]?.text ?? '', /số đầu ngày/);
    });

    it('B11: câu nợ → ghi chú, không giao dịch/yêu cầu/số dư; /ghichu liệt kê', async () => {
      await seedInitial(env);
      const before = await env.bal.getHolderBalances('2026-11-05');
      const texts = [
        'thu hồi nợ 2tr', 'đòi nợ 2tr', 'thu nợ 2tr', 'chi nợ 2tr', 'nợ 2tr', 'trả nợ 2tr',
        'cho vay anh Nam 5tr', 'vay ngân hàng 10tr', 'thu: thu hồi nợ 2tr', 'Nợ chị Lan 1tr',
      ];
      for (const t of texts) {
        await h.text(VO, t);
      }
      const calls = sentTo(h.tg.take(), VO);
      assert.equal(calls.length, texts.length);
      for (const c of calls) assert.match(c.text ?? '', /ghi chú nợ/, c.text);
      assert.equal(await count(env.db, 'giao_dich'), 0);
      assert.equal(await count(env.db, 'yeu_cau_xac_nhan'), 0);
      assert.equal(await count(env.db, 'tin_nhan_goc', "chi_tiet_loi = 'GHI_CHU_NO'"), texts.length);
      assert.deepEqual(await env.bal.getHolderBalances('2026-11-05'), before);
      await h.text(CHONG, '/ghichu');
      const notes = sentTo(h.tg.take(), CHONG)[0]?.text ?? '';
      assert.match(notes, /Vợ: Nợ chị Lan 1tr/);
      assert.match(notes, /thu hồi nợ 2tr/);
    });

    it('B12: "nợ của a" (NO_CUA_ANH), "lãi vay 200k" → ghi bình thường; B13: điều chỉnh → chưa hỗ trợ', async () => {
      await h.text(CHONG, 'thu: nợ của a 1tr');
      await h.text(CHONG, 'chi: nợ của a 1tr');
      await h.text(CHONG, 'lãi vay 200k');
      await h.text(CHONG, 'điều chỉnh: 1tr');
      const calls = sentTo(h.tg.take(), CHONG);
      assert.match(calls[0]?.text ?? '', /✅ Thu 1\.000\.000đ · Nợ của anh/);
      assert.match(calls[1]?.text ?? '', /✅ Chi 1\.000\.000đ · Nợ của anh/);
      assert.match(calls[2]?.text ?? '', /✅ Lãi vay 200\.000đ/);
      assert.match(calls[3]?.text ?? '', /Điều chỉnh số dư dùng lệnh: \/dieuchinh/);
      assert.equal(await count(env.db, 'giao_dich'), 3);
    });

    it('B14: Telegram lỗi → DB vẫn ghi, 200; "not modified" bỏ qua; callback không có message → chỉ answer', async () => {
      h.tg.failAll = new Error('fetch failed');
      const { res } = await h.text(CHONG, 'tiền ăn 50k');
      assert.equal(res.status, 200);
      assert.equal(await count(env.db, 'giao_dich'), 1);
      h.tg.failAll = null;
      const tx = await gd(env);

      h.tg.editError = new TelegramApiError('editMessageText', 400, 'Bad Request: message is not modified');
      assert.equal((await h.click(CHONG, `gd:${tx.id}`)).status, 200);
      h.tg.editError = null;
      assert.equal((await gd(env)).trang_thai, 'DA_HUY');
      h.tg.take();

      await h.click(CHONG, `gd:${tx.id}`, null);
      const calls = h.tg.take();
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.method, 'answer');

      await h.click(STRANGER, `gd:${tx.id}`);
      await h.click(CHONG, 'rác');
      const junk = h.tg.take();
      assert.deepEqual(junk.map((c) => [c.method, c.text]), [['answer', undefined], ['answer', undefined]]);
      assert.ok(h.db.closed > 0, 'đóng DB sau mỗi request');
    });
  });
}
