import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { BACKENDS, assertInvariant, seedInitial, type TestEnv } from './helpers/phase3-env.ts';
import { CHONG, VO, button, createHarness, sentTo, type BotHarness } from './helpers/phase5-bot.ts';

const TODAY = '2026-11-05';

for (const backend of BACKENDS) {
  describe(`/dieuchinh — chỉnh số dư cho khớp tiền thật [${backend.name}]`, () => {
    let env: TestEnv;
    let h: BotHarness;

    async function say(from: number, text: string) {
      await h.text(from, text);
      return h.tg.take();
    }
    const reply = async (from: number, text: string) => sentTo(await say(from, text), from)[0]?.text ?? '';
    const cash = async () => {
      const r = await env.bal.getHolderBalances(TODAY);
      return r.status === 'OK' ? [r.nhom.VO, r.nhom.CHONG, r.nhom.QUY_CHUNG] : [];
    };

    beforeEach(async () => {
      env = await backend.open();
      h = createHarness(env.db);
      await seedInitial(env); // vợ 5tr, chồng 3tr, quỹ 2tr
      await say(VO, 'tiền ăn 8tr'); // vợ âm 3tr (giống tình huống thật: chi > số dư khai)
    });
    afterEach(async () => {
      await env.close();
    });

    it('+tiền / = số thực tế / -tiền; không vào thu chi; báo người kia; huỷ trả lại', async () => {
      const calls = await say(VO, '/dieuchinh vợ +12tr quên khai tiền ngân hàng');
      const mine = sentTo(calls, VO)[0];
      assert.equal(mine?.text, '✅ Điều chỉnh tăng 12.000.000đ · tiền của vợ · 05/11\nTiền của vợ: -3.000.000đ → 9.000.000đ\nKhông tính vào thu / chi.');
      assert.equal(sentTo(calls, CHONG)[0]?.text, 'ℹ️ Vợ điều chỉnh tiền của vợ +12.000.000đ (quên khai tiền ngân hàng).');
      assert.deepEqual(await cash(), [9_000_000, 3_000_000, 2_000_000]);
      // = số thực tế → bot tự tính phần chênh
      assert.match(await reply(CHONG, '/dieuchinh vợ = 10tr'), /^✅ Điều chỉnh tăng 1\.000\.000đ · tiền của vợ[\s\S]*9\.000\.000đ → 10\.000\.000đ/);
      assert.match(await reply(CHONG, '/dieuchinh quỹ -500k'), /^✅ Điều chỉnh giảm 500\.000đ · quỹ chung/);
      assert.match(await reply(VO, '/dieuchinh vợ = 10tr'), /đang đúng 10\.000\.000đ — không cần điều chỉnh/);
      await assertInvariant(env, TODAY, 'điều chỉnh');
      // Thu / chi tháng không đổi
      assert.match(await reply(VO, '/thang'), /• Thu: 0đ · 0 khoản\n• Chi: 8\.000\.000đ · 1 khoản/);
      // Huỷ khoản đầu → trả lại
      await h.click(VO, button(mine, 'gd:'));
      h.tg.take();
      assert.deepEqual(await cash(), [-2_000_000, 3_000_000, 1_500_000]);
    });

    it('code review: lý do bắt đầu bằng "trong / khác / ngân" không bị đọc thành đơn vị tiền', async () => {
      assert.match(await reply(VO, '/dieuchinh vợ +500k trong ví'), /^✅ Điều chỉnh tăng 500\.000đ/);
      assert.match(await reply(VO, '/dieuchinh vợ +12tr ngân hàng'), /^✅ Điều chỉnh tăng 12\.000\.000đ/);
      assert.match(await reply(VO, '/dieuchinh vợ +500 trong ví'), /^Chưa hiểu lệnh/);
      assert.match(await reply(VO, '/dieuchinh vợ +2 triệu khác'), /^✅ Điều chỉnh tăng 2\.000\.000đ/);
    });

    it('sai cú pháp → hướng dẫn, không ghi', async () => {
      for (const text of ['/dieuchinh', '/dieuchinh vợ 12tr', '/dieuchinh ai +2tr', '/dieuchinh vợ +abc']) {
        assert.match(await reply(VO, text), /^Chưa hiểu lệnh\.\nCú pháp: \/dieuchinh/, text);
      }
      assert.deepEqual(await cash(), [-3_000_000, 3_000_000, 2_000_000]);
    });

    it('Telegram gửi lại cùng update → không ghi 2 lần', async () => {
      const { update } = await h.text(VO, '/dieuchinh vợ +1tr');
      h.tg.take();
      await h.post(update);
      h.tg.take();
      assert.deepEqual(await cash(), [-2_000_000, 3_000_000, 2_000_000]);
    });
  });
}
