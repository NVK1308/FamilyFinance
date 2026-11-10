import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { splitTelegramText } from '../src/bot/query-replies.ts';
import { parseQuery } from '../src/query/query-parser.ts';
import { BACKENDS, seedInitial, type TestEnv } from './helpers/phase3-env.ts';
import { CHONG, VO, createHarness, sentTo, type BotHarness } from './helpers/phase5-bot.ts';

const TODAY = '2026-11-05'; // thứ 5

describe('Phase 5d — liệt kê chi tiết + lệnh tắt: hàm thuần', () => {
  it('"chi tiết / tất cả / đầy đủ / toàn bộ" → liệt kê đủ; "tổng tất cả" vẫn là tổng', () => {
    for (const text of ['liệt kê chi tiết vợ chi tuần trước', 'tất cả khoản chi tháng này', 'chi đầy đủ tuần này', 'toàn bộ thu chi từ 1/10 đến nay']) {
      const q = parseQuery(text, TODAY)!;
      assert.deepEqual([q.kind, q.fullList], ['LIET_KE', true], text);
    }
    assert.equal(parseQuery('liệt kê vợ chi tuần trước', TODAY)!.fullList, undefined);
    assert.equal(parseQuery('tổng tất cả thu chi tháng này', TODAY)!.kind, 'TONG');
  });

  it('tách tin theo dòng ≤ giới hạn; dòng quá dài bị cắt', () => {
    const text = Array.from({ length: 300 }, (_, i) => `• dòng ${i} ${'x'.repeat(20)}`).join('\n');
    const parts = splitTelegramText(text);
    assert.ok(parts.length >= 2);
    assert.ok(parts.every((p) => p.length <= 3_900));
    assert.equal(parts.join('\n'), text);
    assert.deepEqual(splitTelegramText('a\nb'), ['a\nb']);
    assert.equal(splitTelegramText('y'.repeat(5_000))[0]!.length, 3_900);
  });
});

for (const backend of BACKENDS) {
  describe(`Phase 5d — liệt kê chi tiết + lệnh tắt qua webhook [${backend.name}]`, () => {
    let env: TestEnv;
    let h: BotHarness;

    async function ask(from: number, text: string): Promise<string[]> {
      await h.text(from, text);
      return sentTo(h.tg.take(), from).map((c) => c.text ?? '');
    }

    beforeEach(async () => {
      env = await backend.open();
      h = createHarness(env.db);
      await seedInitial(env);
      h.setNow('2026-09-05T03:00:00.000Z');
      await h.text(VO, 'tiền ăn 111k'); // ngoài 31 ngày cuối kỳ "từ 1/9 đến 5/11"
      h.setNow('2026-10-20T03:00:00.000Z');
      await h.text(VO, 'tiền ăn 999k'); // tháng trước
      h.setNow('2026-11-03T03:00:00.000Z');
      await h.text(VO, 'tiền ăn 200k');
      await h.text(VO, 'lấy tiền quỹ chung đi chợ 300k');
      h.setNow('2026-11-04T03:00:00.000Z');
      await h.text(VO, 'tiền ăn 150k');
      await h.text(CHONG, 'lương 20tr');
      await h.text(CHONG, 'cafe 30k');
      h.setNow('2026-11-05T03:00:00.000Z');
      h.tg.take();
    });
    afterEach(async () => {
      await env.close();
    });

    it('liệt kê chi tiết: nhóm người → Thu/Chi → danh mục → ngày', async () => {
      const [text, ...rest] = await ask(VO, 'liệt kê chi tiết thu chi tuần này');
      assert.equal(rest.length, 0);
      assert.equal(
        text,
        [
          '📋 Thu/chi · tuần này (02/11–08/11): thu 20.000.000đ, chi 680.000đ · 5 khoản',
          '👤 Vợ',
          '  Chi: 650.000đ',
          '    Thức ăn: 350.000đ',
          '      • 03/11: 200.000đ',
          '      • 04/11: 150.000đ',
          '    Đi chợ: 300.000đ',
          '      • 03/11: 300.000đ',
          '👤 Chồng',
          '  Thu: 20.000.000đ',
          '    Lương: 20.000.000đ',
          '      • 04/11: 20.000.000đ',
          '  Chi: 30.000đ',
          '    Chi khác: 30.000đ',
          '      • 04/11: 30.000đ — cafe 30k',
        ].join('\n'),
      );
      const vo = (await ask(VO, 'liệt kê chi tiết vợ chi tháng này'))[0]!;
      assert.match(vo, /^📋 Vợ chi · tháng 11\/2026 \(01\/11–30\/11\): 650\.000đ · 3 khoản\n👤 Vợ\n  Chi: 650\.000đ/);
      assert.doesNotMatch(vo, /Chồng/);
    });

    it('kỳ dài hơn 31 ngày → 31 ngày cuối kỳ (trong kỳ đã chọn) + chỉ phần còn lại', async () => {
      const text = (await ask(VO, 'liệt kê chi tiết chi từ 1/9 đến 5/11'))[0]!;
      assert.match(text, /^📋 Chi · 06\/10–05\/11: 1\.679\.000đ · 5 khoản/);
      assert.match(text, /• 20\/10: 999\.000đ/);
      assert.doesNotMatch(text, /111\.000đ/);
      assert.match(text, /chỉ hiện 31 ngày cuối kỳ\. Phần còn lại hỏi: "liệt kê chi tiết chi từ 01\/09 đến 05\/10"/);
      // Câu gợi ý hỏi lại được, ra đúng phần còn lại
      const restQ = parseQuery('liệt kê chi tiết chi từ 01/09 đến 05/10', TODAY)!;
      assert.deepEqual([restQ.period.from, restQ.period.to, restQ.fullList], ['2026-09-01', '2026-10-05', true]);
      // Năm khác → câu gợi ý có năm; giữ bộ lọc người + danh mục
      const lastYear = (await ask(VO, 'liệt kê chi tiết vợ chi tiền ăn năm ngoái'))[0]!;
      assert.match(lastYear, /"liệt kê chi tiết vợ chi thức ăn từ 01\/01\/2025 đến 30\/11\/2025"/);
      // Tháng 31 ngày không bị cắt
      assert.doesNotMatch((await ask(VO, 'liệt kê chi tiết chi tháng 10'))[0]!, /Kỳ dài hơn/);
      // Hỏi số tiền có "tất cả" vẫn là tổng
      assert.match((await ask(VO, 'tháng này chi tất cả bao nhiêu'))[0]!, /^📊 Chi · /);
      // Kỳ đã qua: 31 ngày cuối của chính kỳ đó, không tính theo hôm nay
      const sep = (await ask(VO, 'liệt kê chi tiết chi từ 1/8 đến 30/9'))[0]!;
      assert.match(sep, /^📋 Chi · 31\/08–30\/09: 111\.000đ · 1 khoản/);
    });

    it('liệt kê thường (không "chi tiết") vẫn 10 khoản + gợi ý xem đủ', async () => {
      for (let i = 0; i < 9; i += 1) {
        await h.text(VO, `tiền ăn ${10 + i}k`);
      }
      h.tg.take();
      const short = (await ask(VO, 'liệt kê chi tháng này'))[0]!;
      assert.equal(short.split('\n').filter((l) => l.startsWith('•')).length, 10);
      assert.match(short, /… còn 3 khoản cũ hơn\. Xem đủ: "liệt kê chi tiết chi từ 01\/11 đến 30\/11"/);
      const full = (await ask(VO, 'liệt kê chi tiết chi tháng này'))[0]!;
      assert.equal(full.split('\n').filter((l) => l.trim().startsWith('•')).length, 13);
    });

    it('/tuan, /tuan trước, /thang trước, /tuan vợ', async () => {
      assert.equal(
        (await ask(VO, '/tuan'))[0],
        [
          '📊 Tuần này (02/11–08/11):',
          '• Thu: 20.000.000đ · 1 khoản',
          '• Chi: 680.000đ · 4 khoản',
          '• Chênh lệch: 19.320.000đ',
          'Chi nhiều nhất: Thức ăn 350.000đ · Đi chợ 300.000đ · Chi khác 30.000đ',
          'Theo người: Vợ 650.000đ · Chồng 30.000đ',
          'Trong đó chi từ quỹ chung: 300.000đ',
          'Xem từng khoản: "liệt kê chi tiết chi tuần này"',
        ].join('\n'),
      );
      const vo = (await ask(VO, '/tuan vợ'))[0]!;
      assert.match(vo, /^📊 Tuần này \(02\/11–08\/11\) · Vợ:\n• Thu: 0đ · 0 khoản\n• Chi: 650\.000đ · 3 khoản/);
      assert.doesNotMatch(vo, /Theo người/);
      assert.match(vo, /"liệt kê chi tiết vợ chi tuần này"$/);
      assert.match((await ask(VO, '/tuan trước'))[0]!, /^📊 Tuần trước \(26\/10–01\/11\):\n• Thu: 0đ · 0 khoản\n• Chi: 0đ · 0 khoản/);
      const lastMonth = (await ask(CHONG, '/thang truoc'))[0]!;
      assert.match(lastMonth, /^📊 Tháng 10\/2026 \(01\/10–31\/10\):\n• Thu: 0đ · 0 khoản\n• Chi: 999\.000đ · 1 khoản/);
      assert.match((await ask(VO, '/thang'))[0]!, /^📊 Tháng 11\/2026 \(01\/11–30\/11\):/);
      assert.match((await ask(VO, '/thang 10'))[0]!, /^📊 Tháng 10\/2026 \(01\/10–31\/10\):\n• Thu: 0đ · 0 khoản\n• Chi: 999\.000đ/);
      assert.match((await ask(VO, '/thang 9/2026 vợ'))[0]!, /^📊 Tháng 9\/2026 \(01\/09–30\/09\) · Vợ:/);
      assert.match((await ask(VO, '/thang abc'))[0]!, /^Chưa hiểu "abc"\.\nCú pháp:/);
      assert.match((await ask(VO, '/thang 13'))[0]!, /Tháng không hợp lệ/);
    });
  });
}
