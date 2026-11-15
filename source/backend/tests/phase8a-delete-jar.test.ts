import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { decodeCallback, encodeCallback, jarFromToken, jarToken } from '../src/bot/callback-data.ts';
import { BACKENDS, count, seedInitial, type TestEnv } from './helpers/phase3-env.ts';
import { CHONG, VO, answers, buttons, createHarness, edits, sentTo, type BotHarness, type SentCall } from './helpers/phase5-bot.ts';

const TODAY = '2026-11-05';

describe('Phase 8a — xoá hũ: mã hũ trong nút', () => {
  it('nén / giải mã mã hũ; nút chuyển vàng 2 hũ ≤ 64 byte', () => {
    const a = 'HU_0f8e7a9c-1234-4abc-9def-0123456789ab';
    const b = 'HU_ffffffff-0000-4abc-8def-0123456789ab';
    assert.equal(jarFromToken(jarToken(a)), a);
    assert.deepEqual([jarToken('TIET_KIEM'), jarFromToken('T')], ['T', 'TIET_KIEM']);
    const text = encodeCallback({ kind: 'xh', jarId: a, dest: 'Q', mode: 'J', toJarId: b });
    assert.ok(new TextEncoder().encode(text).length <= 64);
    assert.deepEqual(decodeCallback(text), { kind: 'xh', jarId: a, dest: 'Q', mode: 'J', toJarId: b });
    assert.deepEqual(decodeCallback(encodeCallback({ kind: 'xh', jarId: a, dest: 'V', mode: 'N' })), { kind: 'xh', jarId: a, dest: 'V', mode: 'N' });
  });
});

for (const backend of BACKENDS) {
  describe(`Phase 8a — xoá hũ [${backend.name}]`, () => {
    let env: TestEnv;
    let h: BotHarness;

    async function say(from: number, text: string, extra: Record<string, unknown> = {}): Promise<SentCall[]> {
      await h.text(from, text, extra);
      return h.tg.take();
    }
    const first = (calls: SentCall[], who: number) => sentTo(calls, who)[0];
    const reply = (calls: SentCall[], who: number) => first(calls, who)?.text ?? '';
    async function click(from: number, data: string, messageId?: number): Promise<SentCall[]> {
      await h.click(from, data, messageId);
      return h.tg.take();
    }
    function btn(call: SentCall | undefined, textPrefix: string): string {
      const b = buttons(call).find((x) => x.text.startsWith(textPrefix));
      if (!b) throw new Error(`Không có nút "${textPrefix}" trong ${JSON.stringify(call?.keyboard)}`);
      return b.data;
    }
    const cash = async () => {
      const r = await env.bal.getHolderBalances(TODAY);
      return r.status === 'OK' ? [r.nhom.VO, r.nhom.CHONG, r.nhom.QUY_CHUNG] : [];
    };
    const goldIn = async (ten: string) =>
      Number(
        (await env.db.queryOne<{ phan: unknown }>(
          `SELECT COALESCE(SUM(CASE WHEN h.chieu = 'RUT' THEN -h.so_luong_phan ELSE h.so_luong_phan END), 0) AS phan
           FROM hu_tiet_kiem h JOIN hu ON hu.id = COALESCE(h.hu_id, 'TIET_KIEM')
           WHERE hu.ten = $1 AND h.loai_tai_san = 'VANG' AND h.trang_thai = 'HOAN_TAT'`,
          [ten],
        ))?.phan,
      );

    beforeEach(async () => {
      env = await backend.open();
      h = createHarness(env.db);
      await seedInitial(env); // vợ 5tr, chồng 3tr, quỹ 2tr
    });
    afterEach(async () => {
      await env.close();
    });

    it('xoá hũ còn tiền → về quỹ chung (mặc định); bấm lặp chỉ 1 lần; ẩn khỏi /tietkiem; tạo lại cùng tên được', async () => {
      await say(VO, '/taohu mua nhà');
      await say(VO, 'bỏ hũ mua nhà 4tr');
      assert.deepEqual(await cash(), [1_000_000, 3_000_000, 2_000_000]);
      const ask = first(await say(VO, '/xoahu mua nhà'), VO);
      assert.match(ask?.text ?? '', /^🗑 Xoá hũ mua nhà\?\n• Tiền còn 4\.000\.000đ → quỹ chung/);
      let calls = await click(VO, btn(ask, '🗑 Xoá hũ'), ask?.messageId);
      assert.equal(answers(calls)[0]?.text, 'Đã xoá hũ');
      assert.equal(edits(calls)[0]?.text, '🗑 Đã xoá hũ mua nhà.\n• Tiền 4.000.000đ → quỹ chung');
      assert.match(reply(calls, CHONG), /^ℹ️ Vợ đã xoá hũ mua nhà\./);
      assert.deepEqual(await cash(), [1_000_000, 3_000_000, 6_000_000]);
      calls = await click(CHONG, btn(ask, '🗑 Xoá hũ'), ask?.messageId);
      assert.equal(answers(calls)[0]?.text, 'Hũ này đã xoá trước đó.');
      assert.equal(await count(env.db, 'hu_tiet_kiem', "chieu = 'RUT'"), 1);
      const jars = reply(await say(VO, '/tietkiem'), VO);
      assert.doesNotMatch(jars.split('Gần đây:')[0] ?? '', /mua nhà/);
      assert.match(jars, /Lấy ra 4\.000\.000đ \(mua nhà, quỹ chung\)/);
      assert.match(reply(await say(VO, '/taohu mua nhà 2 tỷ'), VO), /^🏺 Đã tạo hũ mua nhà/);
      assert.equal(await count(env.db, 'hu', "ten_khong_dau = 'mua nha'"), 2);
    });

    it('xoá về vợ; hũ rỗng; hũ Tiết kiệm không xoá được; hũ lạ; Thôi', async () => {
      await say(CHONG, '/taohu y tế');
      await say(CHONG, 'bỏ hũ y tế 1tr');
      const ask = first(await say(CHONG, '/xoahu y tế vợ'), CHONG);
      assert.match(ask?.text ?? '', /Tiền còn 1\.000\.000đ → vợ/);
      await click(CHONG, btn(ask, '🗑 Xoá hũ'), ask?.messageId);
      assert.deepEqual(await cash(), [6_000_000, 2_000_000, 2_000_000]);
      await say(VO, '/taohu du lịch');
      const empty = first(await say(VO, '/xoahu du lịch'), VO);
      assert.match(empty?.text ?? '', /Hũ không còn tiền/);
      const calls = await click(VO, btn(empty, 'Thôi'), empty?.messageId);
      assert.equal(edits(calls)[0]?.text, 'Đã thôi — không xoá hũ.');
      assert.equal(await count(env.db, 'hu', 'is_active = TRUE'), 2);
      assert.match(reply(await say(VO, '/xoahu tiết kiệm'), VO), /không xoá được/);
      assert.match(reply(await say(VO, '/xoahu abc'), VO), /^Không có hũ "abc"/);
      assert.match(reply(await say(VO, '/xoahu'), VO), /^Cú pháp: \/xoahu/);
    });

    it('hũ còn vàng: chuyển sang hũ khác (giữ số phân, không đụng tiền) hoặc bán theo giá đang dùng → quỹ chung', async () => {
      await say(VO, '/taohu cưới');
      await say(VO, '/taohu con học');
      await say(VO, 'mua vàng 2 chỉ 14tr/chỉ bỏ hũ cưới');
      const before = await cash();
      let ask = first(await say(VO, '/xoahu cưới'), VO);
      assert.match(ask?.text ?? '', /• Vàng 2 chỉ: chuyển sang hũ khác hoặc bán \(≈ 28\.000\.000đ → quỹ chung\)/);
      assert.deepEqual(buttons(ask).map((b) => b.text), ['🔁 Vàng → hũ Tiết kiệm', '🔁 Vàng → hũ con học', '💰 Bán vàng ≈ 28.000.000đ', 'Thôi']);
      let calls = await click(VO, btn(ask, '🔁 Vàng → hũ con học'), ask?.messageId);
      assert.equal(edits(calls)[0]?.text, '🗑 Đã xoá hũ cưới.\n• Vàng 2 chỉ → hũ con học');
      assert.deepEqual(await cash(), before);
      assert.deepEqual([await goldIn('cưới'), await goldIn('con học')], [0, 20]);
      // Bán: /giavang 15tr → 2 chỉ = 30tr về quỹ chung
      await say(VO, '/giavang 15tr');
      ask = first(await say(VO, '/xoahu con học'), VO);
      calls = await click(VO, btn(ask, '💰 Bán vàng'), ask?.messageId);
      assert.equal(edits(calls)[0]?.text, '🗑 Đã xoá hũ con học.\n• Bán vàng 2 chỉ được 30.000.000đ → quỹ chung');
      assert.deepEqual(await cash(), [before[0], before[1], before[2]! + 30_000_000]);
      assert.equal(await goldIn('con học'), 0);
      // Dòng nhận vàng lúc xoá hũ (ở hũ còn dùng) không huỷ được — vàng không "biến mất"
      const recv = await env.db.queryOne<{ id: string }>(`SELECT id FROM hu_tiet_kiem WHERE idempotency_key LIKE 'xh:%:vang-vao'`);
      calls = await click(VO, `hk:${recv!.id}`);
      assert.match(answers(calls)[0]?.text ?? '', /xoá hũ — không huỷ được/);
      // Nút cũ "Xoá" khi hũ còn vàng (không chọn cách xử lý) → báo, không xoá
      await say(VO, '/taohu quà');
      await say(VO, 'mua vàng 1 chỉ 15tr bỏ hũ quà');
      const jar = await env.db.queryOne<{ id: string }>(`SELECT id FROM hu WHERE ten = 'quà'`);
      calls = await click(VO, encodeCallback({ kind: 'xh', jarId: jar!.id, dest: 'Q', mode: 'N' }));
      assert.match(answers(calls)[0]?.text ?? '', /còn 10 phân vàng/);
      assert.equal(await count(env.db, 'hu', "ten = 'quà' AND is_active = TRUE"), 1);
    });

    it('khoá sổ: khoản chi cũ trả từ hũ đã xoá không huỷ / sửa được; hũ âm không xoá được', async () => {
      await say(VO, '/taohu y tế');
      await say(VO, 'bỏ hũ y tế 2tr');
      const spent = first(await say(VO, 'khám bệnh 500k lấy từ quỹ y tế'), VO);
      const ask = first(await say(VO, '/xoahu y tế'), VO);
      await click(VO, btn(ask, '🗑 Xoá hũ'), ask?.messageId);
      assert.deepEqual(await cash(), [3_000_000, 3_000_000, 3_500_000]);
      let calls = await click(VO, btn(spent, 'Huỷ'), spent?.messageId);
      assert.match(answers(calls)[0]?.text ?? '', /Hũ y tế đã xoá/);
      assert.equal(await count(env.db, 'giao_dich', "trang_thai = 'DA_HUY'"), 0);
      // Nút ✏️ Sửa → trả lời số mới → từ chối
      calls = await click(VO, btn(spent, '✏️'), spent?.messageId);
      const prompt = first(calls, VO)!;
      const replyTo = { reply_to_message: { message_id: prompt.messageId, date: 0, chat: { id: VO, type: 'private' }, from: { id: 1, is_bot: true }, text: prompt.text } };
      assert.match(reply(await say(VO, '600k', replyTo), VO), /hũ đã xoá — không sửa được/);
      assert.deepEqual(await cash(), [3_000_000, 3_000_000, 3_500_000]);
      // Hũ âm
      await say(CHONG, '/taohu sửa nhà');
      await say(CHONG, 'bỏ hũ sửa nhà 1tr');
      await say(CHONG, 'rút hũ sửa nhà 2tr');
      const neg = first(await say(CHONG, '/xoahu sửa nhà'), CHONG);
      assert.match(neg?.text ?? '', /^Hũ sửa nhà đang âm \(-1\.000\.000đ\)/);
      assert.equal(buttons(neg).length, 0);
    });
  });
}
