import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { amountOnly } from '../src/services/edit-service.ts';
import type { TgUpdate } from '../src/telegram/types.ts';
import { BACKENDS, assertInvariant, count, seedInitial, type TestEnv } from './helpers/phase3-env.ts';
import { CHONG, VO, button, createHarness, sentTo, type BotHarness, type SentCall } from './helpers/phase5-bot.ts';

const TODAY = '2026-11-05';

describe('Sửa số tiền — hàm thuần', () => {
  it('trả lời tin nhắc: chỉ nhận số tiền', () => {
    assert.deepEqual(['80k', '1tr5', '80.000đ', '80000', ' 2 triệu '].map((t) => amountOnly(t, 'VO')), [80_000, 1_500_000, 80_000, 80_000, 2_000_000]);
    assert.deepEqual(['abc', 'cafe 80k', '2 hay 3tr', ''].map((t) => amountOnly(t, 'VO')), [null, null, null, null]);
  });
});

for (const backend of BACKENDS) {
  describe(`Sửa số tiền khoản đã ghi [${backend.name}]`, () => {
    let env: TestEnv;
    let h: BotHarness;
    let editSeq = 800_000;

    async function say(from: number, text: string, extra: Record<string, unknown> = {}) {
      const { update } = await h.text(from, text, extra);
      return { update, calls: h.tg.take() };
    }
    // Sửa tin gốc (edited_message cùng message_id, update_id mới); editAt = giây
    async function editMsg(original: TgUpdate, text: string, editAt: number, updateId = (editSeq += 1)): Promise<SentCall[]> {
      const m = original.message!;
      await h.post({ update_id: updateId, edited_message: { ...m, text, edit_date: editAt } });
      return h.tg.take();
    }
    const reply = (calls: SentCall[], who: number) => sentTo(calls, who)[0]?.text ?? '';
    const cash = async () => {
      const r = await env.bal.getHolderBalances(TODAY);
      return r.status === 'OK' ? [r.nhom.VO, r.nhom.CHONG, r.nhom.QUY_CHUNG] : [];
    };
    const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

    beforeEach(async () => {
      env = await backend.open();
      h = createHarness(env.db);
      await seedInitial(env); // vợ 5tr, chồng 3tr, quỹ 2tr
    });
    afterEach(async () => {
      await env.close();
    });

    it('A: sửa tin gốc → đổi số tiền tại chỗ + lịch sử + báo người kia; gửi lại / bản cũ đến muộn → bỏ qua', async () => {
      const { update } = await say(VO, 'tiền ăn 50k');
      const calls = await editMsg(update, 'tiền ăn 80k', at('2026-11-05T03:05:00Z'));
      assert.equal(reply(calls, VO), '✏️ Đã sửa số tiền: 50.000đ → Chi 80.000đ · Thức ăn · vợ trả · 05/11');
      assert.equal(reply(calls, CHONG), 'ℹ️ Vợ sửa số tiền: 50.000đ → Chi 80.000đ · Thức ăn · vợ trả · 05/11.');
      assert.deepEqual(await cash(), [4_920_000, 3_000_000, 2_000_000]);
      assert.equal(await count(env.db, 'giao_dich'), 1);
      assert.equal(await count(env.db, 'lich_su_chinh_sua', "ly_do = 'SUA_TIN'"), 1);
      // Telegram gửi lại cùng update → không sửa lại, chỉ nhắc kết quả cho người sửa (không báo người kia lần nữa)
      const id = editSeq;
      const again = await editMsg(update, 'tiền ăn 80k', at('2026-11-05T03:05:00Z'), id);
      assert.deepEqual(again.map((c) => c.chatId), [VO]);
      assert.equal(await count(env.db, 'lich_su_chinh_sua', "ly_do = 'SUA_TIN'"), 1);
      // Sửa lần 2 (90k) rồi bản sửa cũ hơn (70k) đến muộn → giữ 90k
      await editMsg(update, 'tiền ăn 90k', at('2026-11-05T03:10:00Z'));
      assert.equal((await editMsg(update, 'tiền ăn 70k', at('2026-11-05T03:07:00Z'))).length, 0);
      assert.deepEqual(await cash(), [4_910_000, 3_000_000, 2_000_000]);
      assert.match(reply(await editMsg(update, 'tiền ăn 90k', at('2026-11-05T03:12:00Z')), VO), /^Số tiền không đổi/);
      await assertInvariant(env, TODAY, 'sửa');
    });

    it('A: đổi phần chữ / số mơ hồ / quá 1 ngày / khoản đã huỷ / chuyển tiền → không sửa, nhắc đúng lý do', async () => {
      const { update, calls: first } = await say(VO, 'tiền ăn 50k');
      assert.match(reply(await editMsg(update, 'cafe 80k', at('2026-11-05T03:01:00Z')), VO), /^Chỉ sửa được số tiền/);
      assert.match(reply(await editMsg(update, 'tiền ăn 2 hay 3tr', at('2026-11-05T03:02:00Z')), VO), /^Chưa rõ số tiền mới/);
      h.setNow('2026-11-06T03:01:00.000Z'); // quá 24 giờ
      assert.match(reply(await editMsg(update, 'tiền ăn 60k', at('2026-11-06T03:01:00Z')), VO), /quá 1 ngày/);
      h.setNow('2026-11-05T04:00:00.000Z');
      await h.click(VO, button(sentTo(first, VO)[0], 'gd:'));
      h.tg.take();
      assert.match(reply(await editMsg(update, 'tiền ăn 60k', at('2026-11-05T04:01:00Z')), VO), /đã huỷ/);
      const t = await say(CHONG, 'chuyển vợ 1tr');
      assert.match(reply(await editMsg(t.update, 'chuyển vợ 2tr', at('2026-11-05T04:02:00Z')), CHONG), /không sửa được bằng cách này/);
      assert.deepEqual(await cash(), [5_000_000, 3_000_000, 2_000_000]);
    });

    it('A: tin gốc thiếu số tiền → sửa thêm số = ghi mới; sửa tiếp = sửa khoản đó (không ghi 2 lần)', async () => {
      const { update } = await say(VO, 'tiền ăn');
      assert.match(reply(await editMsg(update, 'tiền ăn 50k', at('2026-11-05T03:01:00Z')), VO), /^✅ Chi 50\.000đ · Thức ăn/);
      assert.match(reply(await editMsg(update, 'tiền ăn 60k', at('2026-11-05T03:02:00Z')), VO), /^✏️ Đã sửa số tiền: 50\.000đ → Chi 60\.000đ/);
      assert.equal(await count(env.db, 'giao_dich'), 1);
    });

    it('B: nút ✏️ Sửa số tiền → tin nhắc (mở ô trả lời) → trả lời "80k" → sửa; người kia / trả lời giả / sai số → không sửa', async () => {
      const { calls } = await say(VO, 'tiền ăn 50k');
      await h.click(VO, button(sentTo(calls, VO)[0], 'sd:'));
      const prompt = sentTo(h.tg.take(), VO)[0]!;
      assert.match(prompt.text ?? '', /^✏️ Nhập số tiền mới cho khoản dưới \(trả lời tin này, vd 80k\):\nChi 50\.000đ · Thức ăn · vợ trả · 05\/11\nMã: GD_/);
      assert.equal(prompt.forceReply, 'vd 80k');
      const botMsg = (who: number, isBot = true) => ({ reply_to_message: { message_id: 1, date: 0, chat: { id: who, type: 'private' }, from: { id: 1, is_bot: isBot }, text: prompt.text } });
      assert.match(reply((await say(VO, 'abc', botMsg(VO))).calls, VO), /^Chưa rõ số tiền mới/);
      // Chồng bấm nút / trả lời bằng mã khoản của vợ → không được
      await h.click(CHONG, button(sentTo(calls, VO)[0], 'sd:'));
      assert.ok(h.tg.take().some((c) => c.method === 'answer' && /Chỉ người nhập/.test(c.text ?? '')));
      assert.match(reply((await say(CHONG, '90k', botMsg(CHONG))).calls, CHONG), /^Chỉ người nhập/);
      // Trả lời tin không phải của bot (tự gõ mã) → tin thường, không sửa khoản
      await say(VO, '70k', botMsg(VO, false));
      const ok = await say(VO, '80k', botMsg(VO));
      assert.match(reply(ok.calls, VO), /^✏️ Đã sửa số tiền: 50\.000đ → Chi 80\.000đ/);
      assert.equal(await count(env.db, 'lich_su_chinh_sua', "ly_do = 'NUT_SUA'"), 1);
      await assertInvariant(env, TODAY, 'nút sửa');
      // Quá 1 ngày → nút báo quá hạn
      h.setNow('2026-11-06T04:00:00.000Z');
      await h.click(VO, button(sentTo(calls, VO)[0], 'sd:'));
      assert.ok(h.tg.take().some((c) => c.method === 'answer' && /quá 1 ngày/.test(c.text ?? '')));
    });

    it('code review: bản cũ đến muộn sau bản "không đổi" / cùng giây → bỏ qua; gửi lại bản đã áp → nhắc lại; sửa câu trả lời "80k" → sửa tiếp', async () => {
      const { update } = await say(VO, 'tiền ăn 50k');
      // Bản sửa về đúng 50k (không đổi) đến trước, bản 80k cũ hơn đến sau → giữ 50k
      await editMsg(update, 'tiền ăn 50k', at('2026-11-05T03:10:00Z'));
      assert.equal((await editMsg(update, 'tiền ăn 80k', at('2026-11-05T03:05:00Z'))).length, 0);
      // Cùng giây: update_id lớn hơn thắng
      await editMsg(update, 'tiền ăn 60k', at('2026-11-05T03:20:00Z'), 900_010);
      assert.equal((await editMsg(update, 'tiền ăn 70k', at('2026-11-05T03:20:00Z'), 900_005)).length, 0);
      assert.deepEqual(await cash(), [4_940_000, 3_000_000, 2_000_000]);
      // Telegram gửi lại đúng update đã áp → nhắc lại kết quả (không im lặng, không báo người kia lần nữa)
      const again = await editMsg(update, 'tiền ăn 60k', at('2026-11-05T03:20:00Z'), 900_010);
      assert.match(reply(again, VO), /^✏️ Đã sửa: Chi 60\.000đ/);
      assert.equal(sentTo(again, CHONG).length, 0);
      // Nút sửa → trả lời "80k" → sửa câu trả lời thành "90k"
      const { calls } = await say(VO, 'cafe 30k');
      await h.click(VO, button(sentTo(calls, VO)[0], 'sd:'));
      const prompt = sentTo(h.tg.take(), VO)[0]!;
      const replyTo = { reply_to_message: { message_id: 1, date: 0, chat: { id: VO, type: 'private' }, from: { id: 1, is_bot: true }, text: prompt.text } };
      const r = await say(VO, '80k', replyTo);
      assert.match(reply(r.calls, VO), /30\.000đ → Chi 80\.000đ/);
      assert.match(reply(await editMsg(r.update, '90k', at('2026-11-05T03:30:00Z')), VO), /80\.000đ → Chi 90\.000đ/);
    });

    it('code review: tin gốc lỗi (LOI) → sửa tin = xử lý lại', async () => {
      h.db.fail = (sql) => (/INSERT INTO giao_dich/.test(sql) ? new Error('hỏng') : null);
      const { update } = await say(VO, 'tiền ăn 50k');
      h.db.fail = null;
      assert.equal(await count(env.db, 'giao_dich'), 0);
      assert.match(reply(await editMsg(update, 'tiền ăn 50k', at('2026-11-05T03:01:00Z')), VO), /^✅ Chi 50\.000đ/);
      assert.equal(await count(env.db, 'giao_dich'), 1);
    });

    it('chi trả từ hũ: sửa số tiền → dòng lấy ra hũ đổi theo; cảnh báo hũ âm', async () => {
      await say(VO, '/taohu Y tế');
      await say(VO, 'bỏ hũ y tế 2tr');
      const { update } = await say(VO, 'khám bệnh 1tr lấy từ quỹ y tế');
      const calls = await editMsg(update, 'khám bệnh 3tr lấy từ quỹ y tế', at('2026-11-05T03:05:00Z'));
      assert.match(reply(calls, VO), /^✏️ Đã sửa số tiền: 1\.000\.000đ → Chi 3\.000\.000đ[\s\S]*⚠️ Hũ Y tế bị âm/);
      const jar = await env.db.queryOne<{ t: unknown }>(
        `SELECT SUM(CASE WHEN chieu = 'RUT' THEN -so_tien ELSE so_tien END) AS t FROM hu_tiet_kiem WHERE trang_thai = 'HOAN_TAT'`,
      );
      assert.equal(Number(jar?.t), -1_000_000);
      assert.deepEqual(await cash(), [3_000_000, 3_000_000, 2_000_000]); // bỏ hũ 2tr; chi từ hũ không trừ tiền mặt
      await assertInvariant(env, TODAY, 'hũ');
    });
  });
}
