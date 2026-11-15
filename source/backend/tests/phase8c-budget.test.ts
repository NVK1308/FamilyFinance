import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { defaultSettings } from '../src/config/settings.ts';
import { BudgetService } from '../src/services/budget-service.ts';
import type { GiaoDichRecord } from '../src/db/types.ts';
import { BACKENDS, count, seedInitial, type TestEnv } from './helpers/phase3-env.ts';
import { CHONG, VO, buttons, createHarness, sentTo, type BotHarness, type SentCall } from './helpers/phase5-bot.ts';

for (const backend of BACKENDS) {
  describe(`Phase 8c — ngân sách theo danh mục [${backend.name}]`, () => {
    let env: TestEnv;
    let h: BotHarness;

    async function say(from: number, text: string, extra: Record<string, unknown> = {}): Promise<SentCall[]> {
      await h.text(from, text, extra);
      return h.tg.take();
    }
    const reply = (calls: SentCall[], who: number) => sentTo(calls, who)[0]?.text ?? '';
    const warnings = (calls: SentCall[]) => calls.filter((c) => c.method === 'send' && /Ngân sách|ngân sách/.test(c.text ?? '') && /^(⚠️|🚨)/.test(c.text ?? ''));

    beforeEach(async () => {
      env = await backend.open();
      h = createHarness(env.db); // 05/11/2026
      await seedInitial(env, 50_000_000, 30_000_000, 20_000_000);
    });
    afterEach(async () => {
      await env.close();
    });

    it('đặt / sửa / bỏ; danh mục theo tên hoặc từ khoá; danh mục thu / lạ → báo; bảng /ngansach', async () => {
      assert.match(reply(await say(VO, '/ngansach'), VO), /^Chưa đặt ngân sách nào/);
      assert.equal(reply(await say(VO, '/ngansach tiền ăn 5tr'), VO), '💰 Đã đặt ngân sách Thức ăn: 5.000.000đ / tháng. Tháng này đã chi 0đ.');
      await say(CHONG, 'tiền ăn 1tr');
      assert.match(reply(await say(CHONG, '/ngansach thức ăn 6tr'), CHONG), /^💰 Đã sửa ngân sách Thức ăn: 6\.000\.000đ \/ tháng\. Tháng này đã chi 1\.000\.000đ/);
      await say(VO, '/ngansach điện 1tr');
      const table = reply(await say(VO, '/ngansach'), VO);
      assert.match(table, /^💰 Ngân sách tháng 11\/2026\n• Thức ăn: 1\.000\.000đ \/ 6\.000\.000đ · còn 5\.000\.000đ\n  ▰▰▱▱▱▱▱▱▱▱ 17%\n• Điện: 0đ/);
      assert.match(reply(await say(VO, '/ngansach lương 1tr'), VO), /^Không có danh mục chi "lương"/);
      assert.match(reply(await say(VO, '/ngansach abc 1tr'), VO), /^Không có danh mục chi "abc"/);
      assert.equal(reply(await say(VO, '/ngansach điện 0'), VO), '💰 Đã bỏ ngân sách Điện.');
      assert.equal(reply(await say(VO, '/ngansach điện 0'), VO), 'Điện chưa có ngân sách.');
      assert.equal(await count(env.db, 'ngan_sach', 'is_active = TRUE'), 1);
      assert.equal(await count(env.db, 'lich_su_chinh_sua', "ten_bang = 'ngan_sach'"), 4);
    });

    it('vượt 80% / 100% → báo cả 2 người, mỗi mốc 1 lần / tháng; nhảy thẳng qua 100% → 1 tin; tháng sau báo lại', async () => {
      await say(VO, '/ngansach thức ăn 5tr');
      assert.equal(warnings(await say(VO, 'tiền ăn 3tr')).length, 0);
      let calls = await say(CHONG, 'tiền ăn 1tr2');
      const w = warnings(calls);
      assert.deepEqual(w.map((c) => c.chatId).sort(), [CHONG, VO].sort());
      assert.equal(w[0]?.text, '⚠️ Ngân sách Thức ăn tháng 11: đã chi 4.200.000 / 5.000.000đ (84%)');
      assert.equal(warnings(await say(VO, 'tiền ăn 100k')).length, 0);
      calls = await say(VO, 'tiền ăn 1tr');
      assert.equal(warnings(calls)[0]?.text, '🚨 Vượt ngân sách Thức ăn tháng 11: đã chi 5.300.000 / 5.000.000đ (106%)');
      assert.equal(warnings(await say(VO, 'tiền ăn 1tr')).length, 0);
      assert.match(reply(await say(VO, '/ngansach'), VO), /vượt 1\.300\.000đ\n.*🚨/);
      // Danh mục khác: 0 → 120% trong 1 khoản → chỉ 1 tin (🚨)
      await say(VO, '/ngansach điện 1tr');
      calls = await say(VO, 'tiền điện 1tr2');
      assert.deepEqual(warnings(calls).map((c) => c.text?.slice(0, 2)), ['🚨', '🚨']);
      assert.equal(await count(env.db, 'ngan_sach_canh_bao'), 4);
      // Tăng hạn mức giữa tháng → tính lại mốc theo hạn mức mới
      await say(VO, '/ngansach thức ăn 6tr');
      assert.equal(warnings(await say(VO, 'tiền ăn 1tr')).length, 2); // 7,3tr / 6tr → 🚨 lại
      // Tháng 12: báo lại từ đầu
      h.setNow('2026-12-02T03:00:00.000Z');
      assert.equal(warnings(await say(VO, 'tiền ăn 5tr')).length, 2); // 5tr / 6tr = 83%
    });

    it('sửa số tiền / đổi danh mục làm vượt → báo; đổi cấu hình mốc; thu không bị tính', async () => {
      await say(VO, '/ngansach thức ăn 1tr');
      await say(VO, '/cauhinh ngan_sach.canh_bao_phan_tram 90');
      const { update } = await h.text(VO, 'tiền ăn 850k');
      assert.equal(warnings(h.tg.take()).length, 0); // 85% < 90%
      await h.post({ update_id: 970_001, edited_message: { ...update.message!, text: 'tiền ăn 950k', edit_date: Math.floor(Date.parse('2026-11-05T03:05:00Z') / 1000) } });
      assert.match(warnings(h.tg.take())[0]?.text ?? '', /^⚠️ Ngân sách Thức ăn tháng 11: đã chi 950\.000 \/ 1\.000\.000đ \(95%\)/);
      // Khoản "Chi khác" đổi sang Thức ăn bằng nút danh mục → vượt 100%
      const other = sentTo(await say(VO, 'linh tinh 200k'), VO)[0];
      const toFood = buttons(other).find((b) => b.data.endsWith(':THUC_AN'));
      assert.ok(toFood, 'Tin "linh tinh 200k" phải có nút chọn Thức ăn');
      await h.click(VO, toFood.data);
      assert.match(warnings(h.tg.take())[0]?.text ?? '', /^🚨 Vượt ngân sách Thức ăn/);
      assert.equal(warnings(await say(VO, 'lương 20tr')).length, 0);
    });

    it('2 khoản song song cùng vượt mốc → báo 1 lần; ghi lùi ngày tính đúng tháng của khoản chi', async () => {
      await say(VO, '/ngansach thức ăn 1tr');
      await say(VO, 'tiền ăn 900k');
      const svc = new BudgetService(env.db, { now: () => new Date('2026-11-05T04:00:00.000Z') });
      const tx = (await env.db.queryOne<GiaoDichRecord>(`SELECT * FROM giao_dich WHERE so_tien = 900000`))!;
      // 900k = 90% đã báo ở trên (mốc 80) → mốc 100 chưa; thêm 200k rồi 2 lần kiểm song song
      await say(CHONG, 'tiền ăn 200k');
      const settings = defaultSettings();
      const both = await Promise.all([svc.checkAfterSpend(tx, async () => settings), svc.checkAfterSpend(tx, async () => settings)]);
      assert.equal(both.filter((x) => x !== null).length, 0); // lượt ghi 200k đã báo mốc 100
      const back = { ...tx, ngay_giao_dich: '2026-10-20' };
      assert.equal(await svc.checkAfterSpend(back, async () => settings), null); // tháng 10 chỉ có 0đ (khoản thật ở tháng 11)
      assert.equal(await count(env.db, 'ngan_sach_canh_bao', "ky = '2026-11'"), 2);
    });

    it('/baocao có bảng ngân sách tháng', async () => {
      await say(VO, '/ngansach thức ăn 2tr');
      await say(VO, 'tiền ăn 500k');
      const doc = (await say(VO, '/baocao')).find((c) => c.method === 'document');
      assert.match(doc?.text ?? '', /<h2>Ngân sách tháng<\/h2>[\s\S]*Thức ăn[\s\S]*500\.000đ[\s\S]*1\.500\.000đ[\s\S]*25%/);
    });
  });
}
