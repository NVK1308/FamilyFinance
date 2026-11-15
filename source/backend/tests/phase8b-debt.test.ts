import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { detectDebt } from '../src/parser/debt-detector.ts';
import { BACKENDS, count, seedInitial, type TestEnv } from './helpers/phase3-env.ts';
import { CHONG, VO, answers, buttons, createHarness, sentTo, type BotHarness, type SentCall } from './helpers/phase5-bot.ts';

const TODAY = '2026-11-05';

describe('Phase 8b — nhận diện câu nợ (hàm thuần)', () => {
  const d = (t: string, open: string[] = []) => {
    const r = detectDebt(t, 'CHONG', { borrow: open, lend: open });
    return r ? [r.kind, r.partner, r.amount, r.holder] : null;
  };
  it('vay / cho vay cần từ nợ thật; người giữ tiền theo chủ ngữ / "vào…"; mặc định null (quỹ chung)', () => {
    assert.deepEqual(d('vay anh Nam 5tr'), ['BORROW', 'anh Nam', 5_000_000, null]);
    assert.deepEqual(d('vợ vay anh Nam 5tr'), ['BORROW', 'anh Nam', 5_000_000, 'VO']);
    assert.deepEqual(d('vay anh Nam 5tr vào vợ'), ['BORROW', 'anh Nam', 5_000_000, 'VO']);
    assert.deepEqual(d('tôi vay chị Hoa 2tr'), ['BORROW', 'chị Hoa', 2_000_000, 'CHONG']);
    assert.deepEqual(d('cho chị Lan vay 3tr'), ['LEND', 'chị Lan', 3_000_000, null]);
    assert.deepEqual(d('cho chi Lan vay 3tr'), ['LEND', 'chi Lan', 3_000_000, null]);
    assert.deepEqual(d('vay ngân hàng 10tr'), ['BORROW', 'ngân hàng', 10_000_000, null]);
    assert.equal(d('hôm qua vay anh Nam 5tr')?.[0], 'BORROW');
  });
  it('trả / thu / lãi: chỉ khi đối tác có khoản mở đúng chiều; còn lại để luồng cũ', () => {
    assert.equal(d('trả nợ anh Hùng 2tr'), null);
    assert.deepEqual(d('trả nợ anh Hùng 2tr', ['hung']), ['REPAY', 'anh Hùng', 2_000_000, null]);
    assert.equal(d('trả anh Nam 2tr'), null);
    assert.deepEqual(d('trả anh Nam 2tr', ['nam']), ['REPAY', 'anh Nam', 2_000_000, null]);
    assert.deepEqual(d('chị Lan trả 1tr', ['lan']), ['COLLECT', 'chị Lan', 1_000_000, null]);
    assert.deepEqual(d('trả lãi anh Nam 200k', ['nam']), ['INTEREST_PAY', 'anh Nam', 200_000, null]);
    assert.deepEqual(d('chị Lan trả lãi 200k', ['lan']), ['INTEREST_COLLECT', 'chị Lan', 200_000, null]);
    assert.equal(d('trả lãi anh Nam 200k'), null);
    // Sai chiều: chị Lan đang nợ mình (cho vay) → "trả chị Lan 500k" là khoản chi
    assert.equal(detectDebt('trả chị Lan 500k', 'VO', { borrow: [], lend: ['lan'] }), null);
    assert.equal(detectDebt('chị Lan trả 1tr', 'VO', { borrow: ['lan'], lend: [] }), null);
  });
  it('code review: "tra lai" không dấu không đoán; ngày ở cuối câu; quỹ / thẻ không phải đối tác', () => {
    assert.equal(d('tra lai anh Nam 200k', ['nam']), null);
    const late = detectDebt('vay anh Nam 5tr hôm qua', 'CHONG');
    assert.deepEqual([late?.partner, late?.daysAgo], ['anh Nam', 1]);
    assert.equal(detectDebt('trả anh Nam 2tr hôm qua', 'CHONG', { borrow: ['nam'], lend: [] })?.daysAgo, 1);
    assert.equal(d('rút quỹ chung trả nợ 5tr', ['nam']), null);
    assert.equal(d('trả nợ thẻ tín dụng 5tr', ['the tin dung']), null);
  });
  it('không phải nợ: vậy / muốn, không đối tác, đối tác là người trong nhà, số mơ hồ, Nợ của anh, khoản chi thường', () => {
    for (const t of ['vậy là 50k', 'muốn mua 50k', 'trả nợ 2tr', 'nợ chị Lan 1tr', 'trả vợ 2tr', 'vay anh Nam 2 hay 3tr', 'thu: nợ của a 1tr', 'trả anh thợ 500k', 'tiền ăn 50k', 'vay 10tr']) {
      assert.equal(d(t, ['nam']), null, t);
    }
  });
});

for (const backend of BACKENDS) {
  describe(`Phase 8b — nợ qua bot [${backend.name}]`, () => {
    let env: TestEnv;
    let h: BotHarness;

    async function say(from: number, text: string): Promise<SentCall[]> {
      await h.text(from, text);
      return h.tg.take();
    }
    const reply = (calls: SentCall[], who: number) => sentTo(calls, who)[0]?.text ?? '';
    const cash = async () => {
      const r = await env.bal.getHolderBalances(TODAY);
      return r.status === 'OK' ? [r.nhom.VO, r.nhom.CHONG, r.nhom.QUY_CHUNG] : [];
    };

    beforeEach(async () => {
      env = await backend.open();
      h = createHarness(env.db); // 05/11/2026
      await seedInitial(env); // vợ 5tr, chồng 3tr, quỹ 2tr
    });
    afterEach(async () => {
      await env.close();
    });

    it('vay → quỹ chung +; trả gốc → −, còn nợ; trả lãi tính vào chi, không sửa được; người kia được báo; /no', async () => {
      let calls = await say(CHONG, 'vay anh Nam 5tr');
      assert.equal(reply(calls, CHONG), '✅ Vay anh Nam 5.000.000đ · vào quỹ chung · 05/11\nCòn nợ anh Nam: 5.000.000đ');
      assert.equal(reply(calls, VO), 'ℹ️ Chồng ghi: Vay anh Nam 5.000.000đ · vào quỹ chung · 05/11\nCòn nợ anh Nam: 5.000.000đ');
      assert.deepEqual(await cash(), [5_000_000, 3_000_000, 7_000_000]);
      calls = await say(CHONG, 'trả anh Nam 2tr');
      assert.equal(reply(calls, CHONG), '✅ Trả anh Nam 2.000.000đ · từ quỹ chung · 05/11\nCòn nợ anh Nam: 3.000.000đ');
      calls = await say(VO, 'trả lãi anh Nam 200k');
      assert.match(reply(calls, VO), /^✅ Trả lãi anh Nam 200\.000đ \(tính vào chi\) · từ quỹ chung/);
      assert.equal(buttons(sentTo(calls, VO)[0]).filter((b) => b.data.startsWith('sd:')).length, 0);
      assert.deepEqual(await cash(), [5_000_000, 3_000_000, 4_800_000]);
      assert.match(reply(await say(VO, '/thang'), VO), /Chi: 200\.000đ/);
      assert.equal(reply(await say(VO, '/no'), VO).split('\n').slice(0, 4).join('\n'), '📒 Nợ đang mở\nMình đang nợ:\n• anh Nam: 3.000.000đ (vay 5.000.000đ, 05/11)\nTổng: 3.000.000đ');
      assert.match(reply(await say(VO, 'còn nợ ai bao nhiêu'), VO), /^📒 Nợ đang mở/);
    });

    it('cho vay (chủ ngữ "tôi" → người ghi); thu gốc / thu lãi về quỹ chung; "trả anh thợ" vẫn là khoản chi', async () => {
      await say(VO, 'tôi cho chị Lan vay 3tr');
      assert.deepEqual(await cash(), [2_000_000, 3_000_000, 2_000_000]);
      assert.equal(reply(await say(VO, 'chị Lan trả 1tr'), VO), '✅ Chị Lan trả 1.000.000đ · vào quỹ chung · 05/11\nChị Lan còn nợ: 2.000.000đ');
      assert.match(reply(await say(VO, 'chị Lan trả lãi 100k'), VO), /^✅ Thu 100\.000đ · Lãi cho vay/);
      assert.deepEqual(await cash(), [2_000_000, 3_000_000, 3_100_000]);
      assert.match(reply(await say(VO, 'trả anh thợ 500k'), VO), /^✅ Chi 500\.000đ/);
      assert.match(reply(await say(VO, '/thang'), VO), /Thu: 100\.000đ · 1 khoản\n• Chi: 500\.000đ · 1 khoản/);
    });

    it('trả vượt / chưa có khoản → không ghi, hướng dẫn; Telegram gửi lại → không ghi đôi', async () => {
      await say(CHONG, 'vay anh Nam 2tr');
      assert.match(reply(await say(CHONG, 'trả anh Nam 3tr'), CHONG), /^Số trả lớn hơn số còn nợ/);
      // Chưa có khoản với anh Hùng → ghi chú như cũ, kèm hướng dẫn /nodau
      assert.match(reply(await say(CHONG, 'trả nợ anh Hùng 1tr'), CHONG), /^📝 Đã lưu ghi chú nợ[\s\S]*\/nodau/);
      const { update } = await h.text(CHONG, 'trả anh Nam 1tr');
      h.tg.take();
      await h.post(update);
      assert.match(reply(h.tg.take(), CHONG), /Còn nợ anh Nam: 1\.000\.000đ/);
      assert.equal(await count(env.db, 'giao_dich', "loai_giao_dich = 'TRA_NO'"), 1);
    });

    it('huỷ lần trả → dư nợ + số dư về như cũ; huỷ khoản vay đã có trả → chặn', async () => {
      const borrow = sentTo(await say(CHONG, 'vay anh Nam 5tr'), CHONG)[0];
      const repay = sentTo(await say(CHONG, 'trả anh Nam 2tr'), CHONG)[0];
      let calls: SentCall[];
      await h.click(CHONG, buttons(borrow).find((b) => b.data.startsWith('gd:'))!.data, borrow?.messageId);
      calls = h.tg.take();
      assert.match(answers(calls)[0]?.text ?? '', /huỷ các lần trả trước/);
      await h.click(CHONG, buttons(repay).find((b) => b.data.startsWith('gd:'))!.data, repay?.messageId);
      h.tg.take();
      assert.deepEqual(await cash(), [5_000_000, 3_000_000, 7_000_000]);
      assert.match(reply(await say(CHONG, '/no'), CHONG), /anh Nam: 5\.000\.000đ/);
    });

    it('sai chiều: chị Lan đang nợ mình → "trả chị Lan 500k" vẫn là khoản chi', async () => {
      await say(VO, 'cho chị Lan vay 3tr');
      assert.match(reply(await say(VO, 'trả chị Lan 500k'), VO), /^✅ Chi 500\.000đ/);
      assert.match(reply(await say(VO, '/no'), VO), /chị Lan: 3\.000\.000đ/);
    });

    it('/nodau: nợ cũ không đổi số dư; trả sau đó trừ quỹ chung; /sodu có đang nợ + tài sản ròng; báo cáo có dòng nợ', async () => {
      assert.match(reply(await say(VO, '/nodau vay anh Tú 50tr'), VO), /^📒 Đã khai nợ cũ: Mình đang nợ anh Tú 50\.000\.000đ \(không đổi số dư\)/);
      await say(VO, '/nodau cho chị Lan vay 3tr');
      assert.deepEqual(await cash(), [5_000_000, 3_000_000, 2_000_000]);
      assert.match(reply(await say(VO, '/no'), VO), /• anh Tú: 50\.000\.000đ \(vay 50\.000\.000đ, nợ cũ\)/);
      await say(VO, 'trả anh Tú 10tr');
      assert.deepEqual(await cash(), [5_000_000, 3_000_000, -8_000_000]);
      const sodu = reply(await say(VO, '/sodu'), VO);
      assert.match(sodu, /Tổng: 0đ\n📕 Đang nợ: 40\.000\.000đ · 📗 Cho vay: 3\.000\.000đ\nTài sản ròng \(trừ nợ, cộng cho vay\): -37\.000\.000đ/);
      const doc = (await say(VO, '/baocao')).find((c) => c.method === 'document');
      assert.match(doc?.text ?? '', /Đang nợ[\s\S]*40\.000\.000đ[\s\S]*Tài sản ròng/);
      assert.match(reply(await say(VO, '/nodau abc'), VO), /^Chưa hiểu/);
    });
  });
}
