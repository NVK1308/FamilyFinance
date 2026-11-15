import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { defaultSettings, resolveSettings } from '../src/config/settings.ts';
import { parseRecurringArgs } from '../src/bot/commands.ts';
import { decodeCallback, encodeCallback } from '../src/bot/callback-data.ts';
import { RecurringService, addDays, dueDateOf, startMonthFor } from '../src/services/recurring-service.ts';
import { loadSettings } from '../src/services/settings-service.ts';
import { TelegramApiError } from '../src/telegram/client.ts';
import { HOURLY_CRON } from '../src/worker.ts';
import type { DatabaseAdapter } from '../src/db/types.ts';
import { BACKENDS, count, seedInitial, type TestEnv } from './helpers/phase3-env.ts';
import { CHONG, VO, answers, buttons, createHarness, edits, sentTo, type BotHarness, type SentCall } from './helpers/phase5-bot.ts';

describe('Phase 7 — khoản định kỳ: hàm thuần', () => {
  it('tách câu /dinhky: tên, số tiền, người trả; bỏ "ngày N"; thiếu tên / tiền → null', () => {
    const p = (t: string, who: 'VO' | 'CHONG' = 'VO') => parseRecurringArgs(t.split(' '), who);
    assert.deepEqual(p('tiền điện 1tr5'), { ten: 'tiền điện', soTien: 1_500_000, holder: 'VO', ignoredDay: false });
    assert.deepEqual(p('học phí bé Na 3 triệu quỹ'), { ten: 'học phí bé Na', soTien: 3_000_000, holder: 'QUY_CHUNG', ignoredDay: false });
    assert.deepEqual(p('lương 15tr chồng'), { ten: 'lương', soTien: 15_000_000, holder: 'CHONG', ignoredDay: false });
    assert.deepEqual(p('tiền nhà 5tr ngày 5 quỹ chung'), { ten: 'tiền nhà', soTien: 5_000_000, holder: 'QUY_CHUNG', ignoredDay: true });
    assert.deepEqual(p('<tiền nước> 200k đồng', 'CHONG'), { ten: 'tiền nước', soTien: 200_000, holder: 'CHONG', ignoredDay: false });
    assert.deepEqual([p('tiền điện'), p('1tr5'), p('vợ')], [null, null, null]);
  });

  it('ngày / kỳ: ngày cuối tháng, tạo trước / sau ngày nhắc, cộng ngày qua tháng', () => {
    assert.deepEqual([dueDateOf('2027-02', 31), dueDateOf('2026-11', 2)], ['2027-02-28', '2026-11-02']);
    assert.deepEqual([startMonthFor('2026-11-01', 2), startMonthFor('2026-11-02', 2), startMonthFor('2026-12-15', 2)], ['2026-11', '2026-12', '2027-01']);
    assert.equal(addDays('2026-11-28', 10), '2026-12-08');
  });

  it('cấu hình: sai / ngoài giới hạn / vi phạm ràng buộc chéo → mặc định; bảng chưa tạo → mặc định', async () => {
    const r = resolveSettings([
      { khoa: 'dinh_ky.ngay_nhac', gia_tri: '5' },
      { khoa: 'dinh_ky.gio_nhac', gia_tri: '23' },
      { khoa: 'bao_cao.ngay_gui', gia_tri: 'abc' },
      { khoa: 'dinh_ky.so_ngay_nhac_lai', gia_tri: '12' },
      { khoa: 'khoa_la', gia_tri: '1' },
    ]);
    assert.equal(r.values['dinh_ky.ngay_nhac'], 5);
    assert.equal(r.values['dinh_ky.gio_nhac'], 20);
    assert.equal(r.values['bao_cao.ngay_gui'], 1);
    // nhắc lại 12 ≥ đóng 10 → cả cặp về mặc định
    assert.deepEqual([r.values['dinh_ky.so_ngay_nhac_lai'], r.values['dinh_ky.so_ngay_dong']], [3, 10]);
    const missing = { query: async () => { throw new Error('relation "cau_hinh" does not exist'); } } as unknown as DatabaseAdapter;
    assert.deepEqual(await loadSettings(missing), defaultSettings());
  });

  it('callback dk / dx ≤ 64 byte, giải mã đúng', () => {
    const id = 'DKL_0f8e7a9c-1234-4abc-9def-0123456789ab';
    const text = encodeCallback({ kind: 'dk', id, action: 'S' });
    assert.ok(new TextEncoder().encode(text).length <= 64);
    assert.deepEqual(decodeCallback(text), { kind: 'dk', id, action: 'S' });
    assert.deepEqual(decodeCallback('dx:KDK_abc'), { kind: 'dx', id: 'KDK_abc' });
    assert.equal(decodeCallback('dk:x:Z'), null);
  });
});

for (const backend of BACKENDS) {
  describe(`Phase 7 — khoản định kỳ qua bot + cron [${backend.name}]`, () => {
    let env: TestEnv;
    let h: BotHarness;

    async function say(from: number, text: string, extra: Record<string, unknown> = {}): Promise<SentCall[]> {
      await h.text(from, text, extra);
      return h.tg.take();
    }
    const reply = (calls: SentCall[], who: number) => sentTo(calls, who)[0]?.text ?? '';
    async function cronAt(iso: string): Promise<SentCall[]> {
      h.setNow(iso);
      await h.cron(HOURLY_CRON);
      return h.tg.take();
    }
    async function click(from: number, data: string, messageId?: number): Promise<SentCall[]> {
      await h.click(from, data, messageId);
      return h.tg.take();
    }
    // Nút theo chữ đầu (vd "✅ 1.") trong 1 tin
    function btn(call: SentCall | undefined, textPrefix: string): string {
      const b = buttons(call).find((x) => x.text.startsWith(textPrefix));
      if (!b) throw new Error(`Không có nút "${textPrefix}" trong ${JSON.stringify(call?.keyboard)}`);
      return b.data;
    }
    const txCount = (where = "trang_thai = 'HOAN_TAT'") => count(env.db, 'giao_dich', where);
    const dueStatus = async (ten: string) =>
      (await env.db.queryOne<{ trang_thai: string }>(
        `SELECT l.trang_thai FROM khoan_dinh_ky_lan l JOIN khoan_dinh_ky k ON k.id = l.khoan_dinh_ky_id WHERE k.ten = $1 ORDER BY l.ky DESC LIMIT 1`,
        [ten],
      ))?.trang_thai;

    // 3 khoản: điện (vợ trả), lương (chồng nhận), học phí (quỹ chung) — khai báo 01/11, trước ngày nhắc 02/11
    async function setupItems(): Promise<void> {
      h.setNow('2026-11-01T03:00:00.000Z');
      assert.match(reply(await say(VO, '/dinhky tiền điện 1tr5'), VO), /Đã thêm khoản định kỳ: Tiền điện — 1\.500\.000đ · trả: vợ\nDanh mục: Điện\nNhắc lần đầu: 02\/11 lúc 20:00/);
      h.setNow('2026-11-01T03:01:00.000Z');
      assert.match(reply(await say(VO, '/dinhky lương 15tr chồng'), VO), /Lương — 15\.000\.000đ · nhận: chồng\nDanh mục: Lương/);
      h.setNow('2026-11-01T03:02:00.000Z');
      assert.match(reply(await say(CHONG, '/dinhky học phí 3tr quỹ'), CHONG), /Học phí — 3\.000\.000đ · trả: quỹ chung/);
    }
    // Gửi tin nhắc ngày 02/11 lúc 20h → tin của vợ, chồng
    async function remind(): Promise<{ vo: SentCall; chong: SentCall }> {
      const calls = await cronAt('2026-11-02T13:00:00.000Z');
      return { vo: sentTo(calls, VO)[0]!, chong: sentTo(calls, CHONG)[0]! };
    }

    beforeEach(async () => {
      env = await backend.open();
      h = createHarness(env.db);
      await seedInitial(env); // vợ 5tr, chồng 3tr, quỹ 2tr
      // Báo cáo tháng gửi ngày 25 → không chen vào các mốc ngày test nhắc định kỳ
      await env.db.execute(`UPDATE cau_hinh SET gia_tri = '25' WHERE khoa = 'bao_cao.ngay_gui'`);
    });
    afterEach(async () => {
      await env.close();
    });

    it('/dinhky: tạo, gõ lại cùng tên = cập nhật, danh mục lạ → Chi khác, danh sách có nút Dừng; tạo sau ngày nhắc → tháng sau', async () => {
      await setupItems();
      assert.match(reply(await say(CHONG, '/dinhky Tiền Điện 1tr6 ngày 5'), CHONG), /Đã cập nhật khoản định kỳ: Tiền điện — 1\.600\.000đ · trả: chồng[\s\S]*Ngày nhắc là ngày chung \(2\)/);
      assert.match(reply(await say(VO, '/dinhky bảo hiểm 150k'), VO), /Danh mục: Chi khác/);
      assert.equal(await count(env.db, 'khoan_dinh_ky', 'is_active = TRUE'), 4);
      assert.equal(await count(env.db, 'lich_su_chinh_sua', "ten_bang = 'khoan_dinh_ky'"), 5);
      const list = sentTo(await say(VO, '/dinhky'), VO)[0];
      assert.match(list?.text ?? '', /1\. Tiền điện — 1\.600\.000đ · trả: chồng · tháng 11\/2026: chưa tới ngày nhắc/);
      assert.equal(buttons(list).filter((b) => b.data.startsWith('dx:')).length, 4);
      assert.match(reply(await say(VO, '/dinhky abc'), VO), /^Chưa hiểu/);
      h.setNow('2026-11-03T03:00:00.000Z');
      assert.match(reply(await say(VO, '/dinhky internet 300k'), VO), /Nhắc lần đầu: 02\/12 lúc 20:00/);
    });

    it('cron: trước giờ nhắc không gửi; 20h gửi 1 tin / người (quỹ chung vào cả hai); chạy lại không gửi trùng', async () => {
      await setupItems();
      assert.equal((await cronAt('2026-11-02T12:00:00.000Z')).length, 0); // 19h VN
      const { vo, chong } = await remind();
      assert.equal(
        vo.text,
        '🔁 Khoản định kỳ tháng 11/2026 (vợ)\n1. Tiền điện — 1.500.000đ\n2. Học phí — 3.000.000đ (quỹ chung)\n\n✅ đã trả / nhận đúng số · ✏️ số khác · ⏭ tháng này không có. Hạn bấm: 12/11.',
      );
      assert.match(chong.text ?? '', /1\. Lương — 15\.000\.000đ\n2\. Học phí — 3\.000\.000đ \(quỹ chung\)/);
      assert.equal(vo.keyboard?.length, 2);
      assert.equal((await cronAt('2026-11-02T14:00:00.000Z')).length, 0);
      assert.equal(await count(env.db, 'khoan_dinh_ky_lan'), 3);
      assert.equal(await txCount(), 0); // chưa bấm → chưa ghi
    });

    it('bấm ✅: ghi đúng số / người giữ tiền / danh mục, vẽ lại tin; bấm lặp + quỹ chung 2 người bấm → 1 giao dịch', async () => {
      await setupItems();
      const { vo, chong } = await remind();
      let calls = await click(VO, btn(vo, '✅ 1.'), vo.messageId);
      assert.equal(answers(calls)[0]?.text, 'Đã ghi');
      assert.match(reply(calls, VO), /^✅ Chi 1\.500\.000đ · Điện · vợ trả · 02\/11/);
      const redraw = edits(calls).find((e) => e.messageId === vo.messageId);
      assert.match(redraw?.text ?? '', /1\. ✅ Tiền điện — đã trả 1\.500\.000đ · vợ\n2\. Học phí/);
      assert.equal(redraw?.keyboard?.length, 1);
      calls = await click(VO, btn(vo, '✅ 1.'), vo.messageId);
      assert.equal(answers(calls)[0]?.text, 'Vợ đã ghi khoản Tiền điện tháng 11/2026 rồi.');
      // Học phí: chồng bấm trước, vợ bấm sau → vợ nhận câu "đã ghi", 2 tin đều vẽ lại
      calls = await click(CHONG, btn(chong, '✅ 2.'), chong.messageId);
      assert.deepEqual(edits(calls).map((e) => e.chatId).sort(), [CHONG, VO].sort());
      calls = await click(VO, btn(vo, '✅ 2.'), vo.messageId);
      assert.equal(answers(calls)[0]?.text, 'Chồng đã ghi khoản Học phí tháng 11/2026 rồi.');
      assert.equal(await txCount(), 2);
      const fund = await env.db.queryOne<{ nguoi_giu_tien_id: string; nguoi_tao_id: string }>(`SELECT nguoi_giu_tien_id, nguoi_tao_id FROM giao_dich WHERE so_tien = 3000000`);
      assert.deepEqual([fund?.nguoi_giu_tien_id, fund?.nguoi_tao_id], ['QUY_CHUNG', 'CHONG']);
      const month = reply(await say(VO, '/thang'), VO);
      assert.match(month, /Chi: 4\.500\.000đ · 2 khoản/);
    });

    it('2 người bấm cùng lúc (song song) → đúng 1 giao dịch', async () => {
      await setupItems();
      await remind();
      const due = await env.db.queryOne<{ id: string }>(`SELECT l.id FROM khoan_dinh_ky_lan l JOIN khoan_dinh_ky k ON k.id = l.khoan_dinh_ky_id WHERE k.ten = 'Học phí'`);
      const svc = new RecurringService(env.db, { now: () => new Date('2026-11-02T14:00:00.000Z') });
      const results = await Promise.all([svc.pay(due!.id, 'VO', null), svc.pay(due!.id, 'CHONG', null)]);
      assert.deepEqual(results.map((r) => r.kind).sort(), ['DONE', 'PAID']);
      assert.equal(await txCount(), 1);
    });

    it('✏️ Số khác: trả lời tin nhắc → ghi số đó (không thành khoản mới); sửa câu trả lời → sửa số tiền; số lạ → hỏi lại', async () => {
      await setupItems();
      const { chong } = await remind();
      let calls = await click(CHONG, btn(chong, '✏️ 1'), chong.messageId);
      const prompt = sentTo(calls, CHONG)[0];
      assert.equal(prompt?.forceReply, 'vd 1tr45');
      assert.match(prompt?.text ?? '', /^🔁 Nhập số tiền thực đã nhận cho khoản dưới[\s\S]*Lương — dự kiến 15\.000\.000đ \(tháng 11\/2026\)\nMã: DKL_/);
      const replyTo = { reply_to_message: { message_id: prompt!.messageId, date: 0, chat: { id: CHONG, type: 'private' }, from: { id: 1, is_bot: true }, text: prompt!.text } };
      assert.match(reply(await say(CHONG, 'mười lăm', replyTo), CHONG), /^Chưa hiểu số tiền/);
      const { update } = await h.text(CHONG, '14tr5', replyTo);
      calls = h.tg.take();
      assert.match(reply(calls, CHONG), /^✅ Thu 14\.500\.000đ · Lương · chồng nhận/);
      assert.match(edits(calls).find((e) => e.messageId === chong.messageId)?.text ?? '', /✅ Lương — đã nhận 14\.500\.000đ · chồng/);
      assert.equal(await txCount(), 1);
      assert.equal(await count(env.db, 'giao_dich', "loai_giao_dich = 'CHI'"), 0);
      // Sửa lại câu trả lời "14tr5" → "15tr" = sửa số tiền khoản vừa ghi
      await h.post({ update_id: 990_001, edited_message: { ...update.message!, text: '15tr', edit_date: Math.floor(Date.now() / 1000) } });
      assert.match(reply(h.tg.take(), CHONG), /^✏️ Đã sửa số tiền: 14\.500\.000đ → Thu 15\.000\.000đ/);
      assert.equal(await txCount('so_tien = 15000000'), 1);
    });

    it('⏭ bỏ qua; huỷ khoản đã ghi → về chờ + nút hiện lại → bấm lại ghi được; dừng khoản → nút cũ báo đã dừng', async () => {
      await setupItems();
      const { vo, chong } = await remind();
      let calls = await click(VO, btn(vo, '⏭ 1'), vo.messageId);
      assert.match(answers(calls)[0]?.text ?? '', /Tiền điện tháng này không có/);
      assert.equal(await dueStatus('Tiền điện'), 'BO_QUA');
      calls = await click(CHONG, btn(chong, '✅ 1.'), chong.messageId);
      const result = sentTo(calls, CHONG)[0]!;
      calls = await click(CHONG, btn(result, 'Huỷ'), result.messageId);
      const back = edits(calls).find((e) => e.messageId === result.messageId);
      assert.match(back?.text ?? '', /Lương tháng 11\/2026 về chờ/);
      assert.equal(await dueStatus('Lương'), 'CHO');
      assert.match(edits(calls).find((e) => e.messageId === chong.messageId)?.text ?? '', /1\. Lương — 15\.000\.000đ/);
      calls = await click(CHONG, btn(back, '✅'), result.messageId);
      assert.equal(answers(calls)[0]?.text, 'Đã ghi');
      assert.deepEqual([await txCount(), await txCount("trang_thai = 'DA_HUY'")], [1, 1]);
      // Dừng học phí qua /dinhky → lần đang chờ đóng; nút cũ báo đã dừng
      const list = sentTo(await say(VO, '/dinhky'), VO)[0];
      calls = await click(VO, btn(list, '🗑 Dừng 3'), list?.messageId);
      assert.equal(answers(calls)[0]?.text, 'Đã dừng Học phí');
      assert.equal(await dueStatus('Học phí'), 'DA_DUNG');
      calls = await click(VO, btn(vo, '✅ 2.'), vo.messageId);
      assert.equal(answers(calls)[0]?.text, 'Khoản Học phí đã dừng.');
      assert.equal(await count(env.db, 'khoan_dinh_ky', 'is_active = TRUE'), 2);
    });

    it('gửi lỗi → giờ sau gửi lại; nhắc lại sau 3 ngày (gỡ nút tin cũ); quá hạn → QUA_HAN; đổi cấu hình sau khi gửi không lệch lịch', async () => {
      await setupItems();
      h.tg.failFor.set(VO, new TelegramApiError('sendMessage', 500, 'boom'));
      let calls = await cronAt('2026-11-02T13:00:00.000Z');
      assert.deepEqual(calls.map((c) => c.chatId), [CHONG]);
      h.tg.failFor.clear();
      calls = await cronAt('2026-11-02T14:00:00.000Z');
      const vo = sentTo(calls, VO)[0]!;
      assert.deepEqual(calls.map((c) => c.chatId), [VO]);
      // Ngày 3 đổi ngày nhắc sang 20 → không ảnh hưởng lần đã tạo
      h.setNow('2026-11-03T03:00:00.000Z');
      await say(VO, '/cauhinh dinh_ky.ngay_nhac 20');
      assert.equal((await cronAt('2026-11-04T13:00:00.000Z')).length, 0);
      // Ngày 05 (gửi 02 + 3): nhắc lại cho cả hai, tin cũ bị gỡ nút
      calls = await cronAt('2026-11-05T13:00:00.000Z');
      const again = sentTo(calls, VO)[0];
      assert.match(again?.text ?? '', /^🔁 Nhắc lại — khoản định kỳ tháng 11\/2026 còn chờ \(vợ\)/);
      assert.equal(sentTo(calls, CHONG).length, 1);
      assert.match(edits(calls).find((e) => e.messageId === vo.messageId)?.text ?? '', /xem tin nhắc lại bên dưới/);
      assert.equal((await cronAt('2026-11-06T13:00:00.000Z')).length, 0);
      // Quá 12/11 → QUA_HAN, bấm nút → báo quá hạn
      await cronAt('2026-11-13T13:00:00.000Z');
      assert.equal(await dueStatus('Tiền điện'), 'QUA_HAN');
      calls = await click(VO, btn(again, '✅ 1.'), again?.messageId);
      assert.match(answers(calls)[0]?.text ?? '', /quá hạn/);
      assert.equal(await txCount(), 0);
      // Tháng 12: nhắc theo ngày mới (20)
      assert.equal((await cronAt('2026-12-02T13:00:00.000Z')).length, 0);
      assert.equal(sentTo(await cronAt('2026-12-20T13:00:00.000Z'), VO).length, 1);
    });

    it('chặn bot (403) → coi như đã nhắc, không thử mãi; gợi ý trùng khi đã tự nhắn khoản cùng danh mục', async () => {
      await setupItems();
      h.setNow('2026-11-01T05:00:00.000Z');
      await say(VO, 'tiền điện 1tr4');
      h.tg.failFor.set(CHONG, new TelegramApiError('sendMessage', 403, 'blocked'));
      const calls = await cronAt('2026-11-02T13:00:00.000Z');
      assert.match(sentTo(calls, VO)[0]?.text ?? '', /1\. Tiền điện — 1\.500\.000đ\n {3}⚠️ Tháng này đã ghi 1\.400\.000đ ngày 01\/11 — nếu là khoản này, bấm ⏭/);
      assert.equal((await cronAt('2026-11-02T14:00:00.000Z')).length, 0);
      const row = await env.db.queryOne<{ trang_thai: string }>(`SELECT trang_thai FROM nhac_dinh_ky WHERE thanh_vien_id = 'CHONG'`);
      assert.equal(row?.trang_thai, 'DA_GUI');
    });

    it('danh mục đã ngừng dùng sau khi gửi nhắc → ghi vào Chi khác + báo', async () => {
      await setupItems();
      const { vo } = await remind();
      await env.db.execute(`UPDATE danh_muc SET is_active = FALSE WHERE ma_danh_muc = 'DIEN'`);
      const calls = await click(VO, btn(vo, '✅ 1.'), vo.messageId);
      assert.match(reply(calls, VO), /Chi 1\.500\.000đ · Chi khác[\s\S]*Danh mục cũ đã ngừng dùng/);
    });

    it('/cauhinh: xem, sửa (ghi lịch sử), chặn khoá lạ / ngoài giới hạn / ràng buộc chéo', async () => {
      assert.match(reply(await say(VO, '/cauhinh'), VO), /• dinh_ky\.ngay_nhac = 2 — [\s\S]*• bao_cao\.gio_gui = 20/);
      assert.match(reply(await say(VO, '/cauhinh dinh_ky.gio_nhac 21'), VO), /dinh_ky\.gio_nhac: 20 → 21/);
      assert.match(reply(await say(VO, '/cauhinh dinh_ky.gio_nhac 21'), VO), /không đổi/);
      assert.match(reply(await say(VO, '/cauhinh abc 1'), VO), /^Không có khoá abc/);
      assert.match(reply(await say(VO, '/cauhinh dinh_ky.gio_nhac 23'), VO), /từ 7 đến 22/);
      assert.match(reply(await say(VO, '/cauhinh dinh_ky.so_ngay_nhac_lai 12'), VO), /^Không đổi được: số ngày nhắc lại/);
      assert.equal(await count(env.db, 'lich_su_chinh_sua', "ten_bang = 'cau_hinh'"), 1);
      const row = await env.db.queryOne<{ gia_tri: string; nguoi_cap_nhat_id: string }>(`SELECT gia_tri, nguoi_cap_nhat_id FROM cau_hinh WHERE khoa = 'dinh_ky.gio_nhac'`);
      assert.deepEqual([row?.gia_tri, row?.nguoi_cap_nhat_id], ['21', 'VO']);
      // Dòng seed bị mất → /cauhinh thêm lại
      await env.db.execute(`DELETE FROM cau_hinh WHERE khoa = 'bao_cao.gio_gui'`);
      assert.match(reply(await say(VO, '/cauhinh bao_cao.gio_gui 9'), VO), /bao_cao\.gio_gui: 20 → 9/);
    });

    it('code review: tạo đúng ngày nhắc trước 20h → nhắc tối đó; 2 khoản cùng danh mục không báo trùng nhau; bấm sau hạn đóng (cron chưa chạy) → không ghi; huỷ sau khi dừng khoản → không về chờ', async () => {
      h.setNow('2026-11-02T03:00:00.000Z'); // 10h ngày nhắc
      assert.match(reply(await say(VO, '/dinhky học phí con A 3tr quỹ'), VO), /Nhắc lần đầu: 02\/11/);
      h.setNow('2026-11-02T03:01:00.000Z');
      await say(VO, '/dinhky học phí con B 3tr quỹ');
      h.setNow('2026-11-02T13:30:00.000Z'); // 20h30 — tin nhắc tối nay đã có thể gửi → khoản mới sang tháng sau
      assert.match(reply(await say(VO, '/dinhky tiền điện 1tr5'), VO), /Nhắc lần đầu: 02\/12/);
      const { vo } = await remind();
      assert.equal(vo.keyboard?.length, 2);
      let calls = await click(VO, btn(vo, '✅ 1.'), vo.messageId);
      assert.doesNotMatch(edits(calls).find((e) => e.messageId === vo.messageId)?.text ?? '', /⚠️/);
      // Hạn đóng 12/11; 09:00 ngày 13 (cron chỉ chạy từ 20h) bấm nút cũ → quá hạn, không ghi
      h.setNow('2026-11-13T02:00:00.000Z');
      calls = await click(VO, btn(vo, '✅ 2.'), vo.messageId);
      assert.match(answers(calls)[0]?.text ?? '', /quá hạn/);
      assert.equal(await txCount(), 1);
      // Học phí con A đã ghi → dừng khoản → huỷ giao dịch: lần thành DA_DUNG (không hiện lại nút)
      const paid = await env.db.queryOne<{ id: string }>(`SELECT id FROM giao_dich WHERE trang_thai = 'HOAN_TAT'`);
      const item = await env.db.queryOne<{ id: string }>(`SELECT id FROM khoan_dinh_ky WHERE ten = 'Học phí con A'`);
      await click(VO, `dx:${item!.id}`);
      h.setNow('2026-11-02T14:00:00.000Z'); // còn trong 1 ngày để huỷ bằng nút
      calls = await click(VO, `gd:${paid!.id}`, 4242);
      assert.equal(await dueStatus('Học phí con A'), 'DA_DUNG');
      assert.equal(buttons(edits(calls).find((e) => e.messageId === 4242)).filter((b) => b.data.startsWith('dk:')).length, 0);
    });
  });
}
