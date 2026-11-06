import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { parseVietnameseFinanceMessage } from '../src/parser/index.ts';
import { parseQuery } from '../src/query/query-parser.ts';
import { BACKENDS, assertInvariant, count, seedInitial, type TestEnv } from './helpers/phase3-env.ts';
import { CHONG, VO, answers, button, createHarness, sentTo, type BotHarness } from './helpers/phase5-bot.ts';

const TODAY = '2026-11-05';

function parse(text: string, sender: 'VO' | 'CHONG' = 'VO') {
  return parseVietnameseFinanceMessage(text, { senderId: sender, referenceDate: TODAY });
}

describe('Phase 5c-1 — hũ tiết kiệm: parser', () => {
  it('S-parse: bỏ / rút / khai báo / nguồn quỹ chung / chủ ngữ khác', () => {
    const cases: Array<[string, string, string | null, number | null]> = [
      ['bỏ hũ tiết kiệm 5tr', 'NOP', 'VO', 5_000_000],
      ['gửi tiết kiệm ngân hàng 100tr', 'NOP', 'VO', 100_000_000],
      ['lấy quỹ chung bỏ hũ 2tr', 'NOP', 'QUY_CHUNG', 2_000_000],
      ['rút hũ tiết kiệm 2tr', 'RUT', 'VO', 2_000_000],
      ['rút hũ 1tr bỏ vào quỹ chung', 'RUT', 'QUY_CHUNG', 1_000_000],
      ['tất toán sổ tiết kiệm 100tr', 'RUT', 'VO', 100_000_000],
      ['khai báo hũ tiết kiệm 50tr', 'KHAI_BAO', null, 50_000_000],
      ['bỏ hũ tiết kiệm', 'NOP', 'VO', null],
    ];
    for (const [text, chieu, nguon, tien] of cases) {
      const r = parse(text);
      assert.equal(r.intent, 'SAVINGS_MOVE', text);
      if (r.intent !== 'SAVINGS_MOVE') continue;
      assert.deepEqual([r.chieu, r.nguon_id, r.so_tien], [chieu, nguon, tien], text);
    }
    const other = parse('chồng bỏ hũ 3tr');
    assert.equal(other.intent === 'SAVINGS_MOVE' && other.ly_do_chua_ho_tro, 'CHU_NGU_KHAC_NGUOI_GUI');
    assert.equal(parse('hôm qua bỏ hũ 1tr').intent === 'SAVINGS_MOVE' && (parse('hôm qua bỏ hũ 1tr') as { ngay: string }).ngay, '2026-11-04');
  });

  it('code review: "rút quỹ chung bỏ hũ", nói ngược chiều quỹ chung, "tất toán" trần', () => {
    for (const text of ['rút quỹ chung bỏ hũ 2tr', 'rút tiền quỹ chung gửi tiết kiệm 10tr', 'lấy quỹ chung bỏ hũ 2tr']) {
      const r = parse(text);
      assert.equal(r.intent === 'SAVINGS_MOVE' && `${r.chieu}:${r.nguon_id}:${r.ly_do_chua_ho_tro}`, 'NOP:QUY_CHUNG:null', text);
    }
    const into = parse('bỏ hũ 2tr vào quỹ chung');
    assert.equal(into.intent === 'SAVINGS_MOVE' && into.ly_do_chua_ho_tro, 'HU_NGUON_KHONG_RO');
    const back = parse('rút hũ 1tr bỏ vào quỹ chung');
    assert.equal(back.intent === 'SAVINGS_MOVE' && `${back.chieu}:${back.nguon_id}:${back.ly_do_chua_ho_tro}`, 'RUT:QUY_CHUNG:null');
    assert.notEqual(parse('tất toán 5tr').intent, 'SAVINGS_MOVE');
    assert.equal(parse('tất toán tiết kiệm 5tr').intent, 'SAVINGS_MOVE');
  });

  it('code review: câu hỏi hũ — dòng tiền trong kỳ, "tiết kiệm có", không dấu, "tiết kiệm được"', () => {
    const flow = parseQuery('tháng trước bỏ hũ bao nhiêu', TODAY)!;
    assert.deepEqual([flow.kind, flow.savingsFlow, flow.period.from], ['HU_TIET_KIEM', true, '2026-10-01']);
    assert.equal(parseQuery('tháng này gửi tiết kiệm bao nhiêu', TODAY)?.savingsFlow, true);
    assert.equal(parseQuery('tháng này còn tiết kiệm được bao nhiêu', TODAY)?.measure, 'CHENH_LECH');
    const holding = parseQuery('tiết kiệm có bao nhiêu', TODAY)!;
    assert.deepEqual([holding.kind, holding.savingsFlow, holding.period.to], ['HU_TIET_KIEM', undefined, TODAY]);
    assert.equal(parseQuery('hu con bao nhieu', TODAY)?.kind, 'HU_TIET_KIEM');
  });

  it('S-8: câu không phải hũ giữ nguyên', () => {
    const lai = parse('lãi tiết kiệm 2tr');
    assert.equal(lai.intent, 'RECORD_TRANSACTION');
    assert.deepEqual(lai.intent === 'RECORD_TRANSACTION' && [lai.loai_giao_dich, lai.ma_danh_muc], ['THU', 'THU_KHAC']);
    assert.equal(parse('tháng này tiết kiệm được bao nhiêu').intent, 'QUERY_STATISTICS');
    assert.equal(parse('hũ tiết kiệm còn bao nhiêu').intent, 'QUERY_STATISTICS');
    assert.equal(parse('mua đồ tiết kiệm 50k').intent, 'RECORD_TRANSACTION');
    assert.equal(parse('bỏ vào quỹ chung 2tr').intent, 'FUND_TRANSFER');
    assert.equal(parse('rút quỹ chung 1tr').intent, 'FUND_TRANSFER');
    assert.equal(parse('cho con tiền tiết kiệm 500k').intent, 'RECORD_TRANSACTION');
  });

  it('S-7 parseQuery: số dư hũ khác "tiết kiệm được"', () => {
    assert.equal(parseQuery('hũ tiết kiệm còn bao nhiêu', TODAY)?.kind, 'HU_TIET_KIEM');
    assert.equal(parseQuery('tiền tiết kiệm còn bao nhiêu', TODAY)?.kind, 'HU_TIET_KIEM');
    assert.equal(parseQuery('sổ tiết kiệm có bao nhiêu', TODAY)?.kind, 'HU_TIET_KIEM');
    assert.equal(parseQuery('tháng này tiết kiệm được bao nhiêu', TODAY)?.measure, 'CHENH_LECH');
    assert.equal(parseQuery('tiền hủ tiếu tháng này bao nhiêu', TODAY)?.kind, 'TONG');
  });
});

for (const backend of BACKENDS) {
  describe(`Phase 5c-1 — hũ tiết kiệm qua webhook [${backend.name}]`, () => {
    let env: TestEnv;
    let h: BotHarness;

    async function say(from: number, text: string) {
      const { update } = await h.text(from, text);
      return { update, calls: h.tg.take() };
    }
    const jar = async () => (await env.bal.getSavingsJar(TODAY)).tien;
    const holders = async () => {
      const r = await env.bal.getHolderBalances(TODAY);
      assert.equal(r.status, 'OK');
      return r.status === 'OK' ? r.nhom : null;
    };

    beforeEach(async () => {
      env = await backend.open();
      h = createHarness(env.db);
      await seedInitial(env); // 01/11: vợ 5tr, chồng 3tr, quỹ 2tr
    });
    afterEach(async () => {
      await env.close();
    });

    it('S-1: /tietkiemdau khai báo (không trừ ai, nhắc tính 2 lần, báo người kia); gửi lại update không ghi 2 lần', async () => {
      const { update, calls } = await say(VO, '/tietkiemdau 50tr');
      const mine = sentTo(calls, VO)[0];
      assert.match(mine?.text ?? '', /^🏺 Khai báo hũ tiết kiệm 50\.000\.000đ · không trừ tiền ai · 05\/11\nLưu ý:/);
      assert.ok(button(mine, 'hk:'));
      assert.match(sentTo(calls, CHONG)[0]?.text ?? '', /Vợ: khai báo hũ tiết kiệm 50\.000\.000đ/);
      assert.equal(await jar(), 50_000_000);
      assert.deepEqual(await holders(), { VO: 5_000_000, CHONG: 3_000_000, QUY_CHUNG: 2_000_000, CHUA_XAC_DINH: 0 });
      await h.post(update);
      const again = h.tg.take();
      assert.equal(sentTo(again, CHONG).length, 0);
      assert.equal(await count(env.db, 'hu_tiet_kiem'), 1);
      assert.match((await say(VO, '/tietkiemdau abc')).calls[0]?.text ?? '', /Chưa rõ số tiền/);
    });

    it('S-2, S-3, S-5, S-6: bỏ vào / lấy ra trừ cộng đúng nguồn; bất biến; /sodu; /thang không đổi', async () => {
      await say(VO, '/tietkiemdau 10tr');
      const nop = await say(VO, 'bỏ hũ tiết kiệm 1tr');
      assert.match(sentTo(nop.calls, VO)[0]?.text ?? '', /^🏺 Bỏ hũ tiết kiệm 1\.000\.000đ · vợ trả · 05\/11$/);
      assert.match(sentTo(nop.calls, CHONG)[0]?.text ?? '', /Vợ: bỏ hũ tiết kiệm 1\.000\.000đ \(vợ trả, 05\/11\)/);
      const fund = await say(CHONG, 'lấy quỹ chung bỏ hũ 500k');
      assert.match(sentTo(fund.calls, CHONG)[0]?.text ?? '', /500\.000đ · từ quỹ chung/);
      const rut = await say(CHONG, 'rút hũ tiết kiệm 2tr');
      assert.match(sentTo(rut.calls, CHONG)[0]?.text ?? '', /^🏺 Lấy ra từ hũ tiết kiệm 2\.000\.000đ · chồng nhận · 05\/11$/);
      assert.deepEqual(await holders(), { VO: 4_000_000, CHONG: 5_000_000, QUY_CHUNG: 1_500_000, CHUA_XAC_DINH: 0 });
      assert.equal(await jar(), 9_500_000);
      await assertInvariant(env, TODAY, 'sau hũ');

      // Vượt → cảnh báo, vẫn ghi
      assert.match(sentTo((await say(VO, 'rút hũ 50tr')).calls, VO)[0]?.text ?? '', /Lấy ra nhiều hơn số đang có trong hũ/);
      assert.match(sentTo((await say(VO, 'bỏ hũ 100tr')).calls, VO)[0]?.text ?? '', /lớn hơn số đang giữ/);
      await assertInvariant(env, TODAY, 'sau vượt');

      const sodu = sentTo((await say(VO, '/sodu')).calls, VO)[0]?.text ?? '';
      // Tổng tài sản = 10tr tiền mặt ban đầu + 10tr khai báo (bỏ vào / lấy ra chỉ đổi chỗ tiền)
      assert.match(sodu, /Tiền mặt: -39\.500\.000đ\n🏺 Hũ tiết kiệm: 59\.500\.000đ\nTổng tài sản \(ước tính\): 20\.000\.000đ$/);
      const thang = sentTo((await say(VO, '/thang')).calls, VO)[0]?.text ?? '';
      assert.match(thang, /• Thu: 0đ\n• Chi: 0đ/);
    });

    it('S-2b, S-10: chủ ngữ khác người gửi → không ghi; thiếu tiền → nhắc', async () => {
      assert.match(sentTo((await say(CHONG, 'vợ bỏ hũ 1tr')).calls, CHONG)[0]?.text ?? '', /Chỉ ghi được khoản do chính bạn/);
      assert.match(sentTo((await say(VO, 'bỏ hũ tiết kiệm')).calls, VO)[0]?.text ?? '', /Chưa rõ số tiền/);
      assert.equal(await count(env.db, 'hu_tiet_kiem'), 0);
    });

    it('S-4: huỷ — người khác bấm bị từ chối; người ghi huỷ → trả lại số dư; bấm lặp', async () => {
      const { calls } = await say(VO, 'bỏ hũ tiết kiệm 1tr');
      const cancel = button(sentTo(calls, VO)[0], 'hk:');
      await h.click(CHONG, cancel);
      assert.equal(answers(h.tg.take())[0]?.text, 'Chỉ người ghi khoản này mới bấm được.');
      await h.click(VO, cancel);
      const done = h.tg.take();
      assert.equal(answers(done)[0]?.text, 'Đã huỷ');
      assert.match(sentTo(done, CHONG)[0]?.text ?? '', /Vợ đã huỷ: bỏ hũ tiết kiệm 1\.000\.000đ/);
      assert.equal(await jar(), 0);
      assert.equal((await holders())?.VO, 5_000_000);
      await h.click(VO, cancel);
      assert.equal(answers(h.tg.take())[0]?.text, 'Khoản này đã huỷ trước đó.');
      await assertInvariant(env, TODAY, 'sau huỷ');
    });

    it('S-7: câu hỏi số dư hũ, số dư chung kèm hũ, /tietkiem, "lãi tiết kiệm" là Thu', async () => {
      assert.match(sentTo((await say(VO, '/tietkiem')).calls, VO)[0]?.text ?? '', /Hũ tiết kiệm đang trống/);
      await say(VO, '/tietkiemdau 20tr');
      h.setNow('2026-11-05T04:00:00.000Z'); // created_at khác nhau → thứ tự "gần đây" xác định
      await say(CHONG, 'bỏ hũ tiết kiệm 3tr');
      assert.equal(
        sentTo((await say(VO, 'hũ tiết kiệm còn bao nhiêu')).calls, VO)[0]?.text,
        '🏺 Hũ tiết kiệm đến 05/11: 23.000.000đ\nChi tiết: /tietkiem',
      );
      assert.match(sentTo((await say(VO, 'gia đình còn bao nhiêu')).calls, VO)[0]?.text ?? '', /🏺 Hũ tiết kiệm: 23\.000\.000đ/);
      assert.match(sentTo((await say(VO, 'tháng này tiết kiệm được bao nhiêu')).calls, VO)[0]?.text ?? '', /^💰 Tiết kiệm · /);
      const detail = sentTo((await say(VO, '/tietkiem')).calls, VO)[0]?.text ?? '';
      assert.match(detail, /^🏺 Hũ tiết kiệm đến 05\/11: 23\.000\.000đ\nGần đây:\n• 05\/11 Bỏ vào 3\.000\.000đ \(chồng\)\n• 05\/11 Khai báo 20\.000\.000đ$/);
      assert.match(sentTo((await say(VO, 'lãi tiết kiệm 2tr')).calls, VO)[0]?.text ?? '', /✅ Thu 2\.000\.000đ · Thu khác/);
      assert.equal(
        sentTo((await say(VO, 'tháng này bỏ hũ bao nhiêu')).calls, VO)[0]?.text,
        '🏺 Hũ tiết kiệm · tháng 11/2026 (01/11–30/11): bỏ vào 3.000.000đ (1 lần) · lấy ra 0đ (0 lần)\nHũ hiện có (đến 05/11): 23.000.000đ',
      );
    });

    it('code review: nói ngược chiều quỹ chung → không ghi, nhắc', async () => {
      assert.match(sentTo((await say(VO, 'bỏ hũ 2tr vào quỹ chung')).calls, VO)[0]?.text ?? '', /Chưa rõ tiền lấy từ đâu/);
      assert.equal(await count(env.db, 'hu_tiet_kiem'), 0);
    });
  });
}
