import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { BACKENDS, assertInvariant, count, seedInitial, type TestEnv } from './helpers/phase3-env.ts';
import { CHONG, VO, button, createHarness, sentTo, type BotHarness } from './helpers/phase5-bot.ts';

const TODAY = '2026-11-05';

for (const backend of BACKENDS) {
  describe(`Quỹ chung → vợ/chồng qua webhook [${backend.name}]`, () => {
    let env: TestEnv;
    let h: BotHarness;

    async function say(from: number, text: string) {
      await h.text(from, text);
      return h.tg.take();
    }
    const cash = async () => {
      const r = await env.bal.getHolderBalances(TODAY);
      return r.status === 'OK' ? [r.nhom.VO, r.nhom.CHONG, r.nhom.QUY_CHUNG] : [];
    };

    beforeEach(async () => {
      env = await backend.open();
      h = createHarness(env.db);
      await seedInitial(env); // vợ 5tr, chồng 3tr, quỹ 2tr
    });
    afterEach(async () => {
      await env.close();
    });

    it('chồng nhắn "chuyển vợ 1tr từ quỹ chung" → quỹ −1tr, vợ +1tr, ghi ngay, báo vợ; huỷ trả lại', async () => {
      const calls = await say(CHONG, 'chuyển vợ 1tr từ quỹ chung');
      const mine = sentTo(calls, CHONG)[0];
      assert.equal(mine?.text, '✅ Rút quỹ chung đưa vợ 1.000.000đ · 05/11');
      assert.equal(sentTo(calls, VO)[0]?.text, 'ℹ️ Chồng rút quỹ chung 1.000.000đ đưa vợ (05/11) — đã cộng vào tiền của vợ.');
      assert.deepEqual(await cash(), [6_000_000, 3_000_000, 1_000_000]);
      assert.equal(await count(env.db, 'chuyen_tien_noi_bo'), 0); // không chờ xác nhận
      await assertInvariant(env, TODAY, 'quỹ → vợ');
      await h.click(CHONG, button(mine, 'qc:'));
      const after = h.tg.take();
      assert.ok(sentTo(after, VO).some((c) => /Chồng đã huỷ: rút quỹ chung 1\.000\.000đ đưa vợ/.test(c.text ?? '')));
      assert.deepEqual(await cash(), [5_000_000, 3_000_000, 2_000_000]);
    });

    it('các cách nói khác; vượt quỹ → cảnh báo; tự rút cho mình như cũ', async () => {
      assert.match(sentTo(await say(VO, 'rút quỹ chung cho chồng 500k'), VO)[0]?.text ?? '', /^✅ Rút quỹ chung đưa chồng 500\.000đ/);
      assert.match(sentTo(await say(VO, 'lấy quỹ chung đưa chồng 500k'), VO)[0]?.text ?? '', /^✅ Rút quỹ chung đưa chồng 500\.000đ/);
      assert.deepEqual(await cash(), [5_000_000, 4_000_000, 1_000_000]);
      assert.match(sentTo(await say(VO, 'chuyển chồng 5tr từ quỹ chung'), VO)[0]?.text ?? '', /⚠️ Số tiền lớn hơn số đang có/);
      assert.match(sentTo(await say(VO, 'rút quỹ chung cho vợ 100k'), VO)[0]?.text ?? '', /^✅ Rút quỹ chung 100\.000đ/);
      assert.match(sentTo(await say(CHONG, 'vợ chuyển chồng 1tr từ quỹ chung'), CHONG)[0]?.text ?? '', /chính bạn/);
      await assertInvariant(env, TODAY, 'cách nói');
    });

    it('code review: cách nói mơ hồ không ghi; tự chuyển cho mình; "chuyển quỹ chung cho vợ"; người nhận huỷ được', async () => {
      const before = await cash();
      for (const text of ['chuyển vợ 2tr cho quỹ chung', 'đưa vợ 2tr trả quỹ chung', 'chuyển vợ 2tr, quỹ chung còn 5tr', 'chuyển vợ 2tr vào quỹ chung']) {
        assert.match(sentTo(await say(CHONG, text), CHONG)[0]?.text ?? '', /^Chưa rõ tiền đi đâu/, text);
      }
      assert.match(sentTo(await say(CHONG, 'chuyển chồng 2tr từ quỹ chung'), CHONG)[0]?.text ?? '', /Không chuyển cho chính mình/);
      assert.match(sentTo(await say(CHONG, 'bỏ vào quỹ chung cho vợ 2tr'), CHONG)[0]?.text ?? '', /^Nộp quỹ chung không có người nhận/);
      assert.deepEqual(await cash(), before);
      const calls = await say(CHONG, 'chuyển quỹ chung cho vợ 1tr');
      assert.match(sentTo(calls, CHONG)[0]?.text ?? '', /^✅ Rút quỹ chung đưa vợ 1\.000\.000đ/);
      // Vợ (người nhận) có nút Huỷ và huỷ được
      await h.click(VO, button(sentTo(calls, VO)[0], 'qc:'));
      const after = h.tg.take();
      assert.ok(sentTo(after, CHONG).some((c) => /Vợ đã huỷ: rút quỹ chung 1\.000\.000đ đưa vợ/.test(c.text ?? '')));
      assert.deepEqual(await cash(), before);
    });
  });
}
