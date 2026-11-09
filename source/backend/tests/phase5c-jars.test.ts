import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { parseVietnameseFinanceMessage } from '../src/parser/index.ts';
import { parseQuery } from '../src/query/query-parser.ts';
import { normalizeJarName } from '../src/services/savings-service.ts';
import { BACKENDS, assertInvariant, count, seedInitial, type TestEnv } from './helpers/phase3-env.ts';
import { CHONG, VO, answers, button, buttons, createHarness, edits, sentTo, type BotHarness } from './helpers/phase5-bot.ts';

const TODAY = '2026-11-05';
const JARS = ['tiet kiem', 'mua nha', 'y te', 'tien hoc'];

function parse(text: string) {
  return parseVietnameseFinanceMessage(text, { senderId: 'VO', referenceDate: TODAY, jarNames: JARS });
}

describe('Phase 5c-1 v3 — nhiều hũ: parser', () => {
  it('hũ / quỹ + tên hũ đang có; "quỹ lớp", "quý 3" không phải hũ', () => {
    const jar = (text: string) => {
      const r = parse(text);
      return r.intent === 'SAVINGS_MOVE' ? `${r.chieu}:${r.ten_hu}` : r.intent === 'RECORD_TRANSACTION' ? `CHI:${r.ten_hu_nguon}:${r.ma_danh_muc}` : r.intent;
    };
    assert.equal(jar('bỏ hũ mua nhà 10tr'), 'NOP:mua nha');
    assert.equal(jar('bỏ quỹ mua nhà tháng này 10tr'), 'NOP:mua nha');
    assert.equal(jar('rút quỹ y tế 2tr'), 'RUT:y te');
    assert.equal(jar('bỏ hũ 3tr'), 'NOP:null');
    assert.equal(jar('bỏ hũ du lịch 5tr'), 'NOP:du lich'); // tên chưa có → service báo
    // B: chi trả từ hũ, phần chữ còn lại vẫn khớp danh mục
    assert.equal(jar('khám bệnh 2tr lấy từ quỹ y tế'), 'CHI:y te:Y_TE');
    assert.equal(jar('lấy quỹ y tế khám bệnh 2tr'), 'CHI:y te:Y_TE');
    assert.equal(jar('rút hũ y tế 2tr khám bệnh'), 'CHI:y te:Y_TE');
    assert.equal(jar('mua sữa 200k lấy từ hũ tiền học'), 'CHI:tien hoc:SUA');
    assert.equal(jar('mua sữa 200k lấy từ hũ'), 'CHI::SUA');
    // Không phải hũ (review 2 #1)
    for (const text of ['đóng quỹ lớp cho con 200k', 'nộp quỹ lớp 200k', 'góp quỹ họ 1tr', 'lấy quỹ mua đồ ăn 200k', 'tiền học từ quý 3 2tr']) {
      const r = parse(text);
      assert.equal(r.intent, 'RECORD_TRANSACTION', text);
      assert.equal(r.intent === 'RECORD_TRANSACTION' && r.ten_hu_nguon, null, text);
    }
    assert.equal(jar('khám bệnh 500k từ quỹ chung'), 'CHI:null:Y_TE');
  });

  it('code review: "hũ/quỹ" phải có dấu (tủ hư, hủ tiếu); rút hũ để chi; "tý" ≠ tỷ', () => {
    const r = (text: string) => {
      const p = parse(text);
      return p.intent === 'SAVINGS_MOVE' ? `HU:${p.chieu}:${p.ten_hu}` : p.intent === 'RECORD_TRANSACTION' ? `CHI:${p.ten_hu_nguon}:${p.ma_danh_muc}:${p.so_tien}` : p.intent;
    };
    assert.equal(r('thay tủ hư 500k'), 'CHI:null:null:500000');
    assert.equal(r('đổi đồ dùng hư 300k'), 'CHI:null:null:300000');
    assert.equal(r('lấy hủ tiếu 30k'), 'CHI:null:null:30000');
    assert.equal(r('rút hũ 2tr mua thuốc'), 'CHI::THUOC:2000000');
    assert.equal(r('lấy từ hũ ra mua thuốc 200k'), 'CHI::THUOC:200000');
    assert.equal(r('mua thuốc 100k lấy từ hũ du lịch'), 'CHI:du lich:THUOC:100000');
    assert.equal(r('bỏ hũ du lịch 5tr'), 'HU:NOP:du lich');
    // Câu không dấu: không phân biệt được → vẫn nhận hũ
    assert.equal(r('rut hu y te 2tr'), 'HU:RUT:y te');
    assert.equal(r('mua rau 1 tý 20k'), 'CHI:null:null:20000');
    assert.equal(r('mua đất 2 tỷ'), 'CHI:null:null:2000000000');
    const alt = parse('mua đất 1 hay 2 tỷ');
    assert.equal(alt.intent === 'RECORD_TRANSACTION' && alt.so_tien_mo_ho, true);
  });

  it('"tỷ"; tên hũ chuẩn hoá; câu hỏi theo hũ', () => {
    const r = parse('bỏ hũ mua nhà 1,5 tỷ');
    assert.equal(r.intent === 'SAVINGS_MOVE' && r.so_tien, 1_500_000_000);
    assert.deepEqual(normalizeJarName('Quỹ Y tế'), { ten: 'Y tế', key: 'y te' });
    assert.deepEqual(normalizeJarName('  hũ   Mua nhà '), { ten: 'Mua nhà', key: 'mua nha' });
    const q = parseQuery('quỹ y tế còn bao nhiêu', TODAY, JARS)!;
    assert.deepEqual([q.kind, q.huTen, q.savingsFlow], ['HU_TIET_KIEM', 'y te', undefined]);
    assert.equal(parseQuery('tháng này bỏ hũ mua nhà bao nhiêu', TODAY, JARS)?.huTen, 'mua nha');
    assert.equal(parseQuery('quỹ chung còn bao nhiêu', TODAY, JARS)?.holder, 'QUY_CHUNG');
    assert.equal(parseQuery('chi y tế tháng này', TODAY, JARS)?.kind, 'TONG');
  });
});

for (const backend of BACKENDS) {
  describe(`Phase 5c-1 v3 — nhiều hũ qua webhook [${backend.name}]`, () => {
    let env: TestEnv;
    let h: BotHarness;

    async function say(from: number, text: string) {
      const { update } = await h.text(from, text);
      return { update, calls: h.tg.take() };
    }
    const reply = async (from: number, text: string) => sentTo((await say(from, text)).calls, from)[0]?.text ?? '';
    const jarTien = async (key: string) => {
      const jar = await env.db.queryOne<{ id: string }>('SELECT id FROM hu WHERE ten_khong_dau = $1', [key]);
      assert.ok(jar, key);
      const r = await env.db.queryOne<{ t: unknown }>(
        `SELECT COALESCE(SUM(CASE WHEN chieu = 'RUT' THEN -so_tien ELSE so_tien END), 0) AS t FROM hu_tiet_kiem
         WHERE hu_id = $1 AND trang_thai = 'HOAN_TAT'`,
        [jar.id],
      );
      return Number(r?.t);
    };
    const voCash = async () => {
      const r = await env.bal.getHolderBalances(TODAY);
      return r.status === 'OK' ? r.nhom.VO : NaN;
    };

    beforeEach(async () => {
      env = await backend.open();
      h = createHarness(env.db);
      await seedInitial(env); // 01/11: vợ 5tr, chồng 3tr, quỹ 2tr
    });
    afterEach(async () => {
      await env.close();
    });

    it('/taohu: tạo, trùng tên, tên không hợp lệ, bỏ tiền tố "quỹ"; /tietkiem có % mục tiêu', async () => {
      assert.match(await reply(VO, '/taohu Mua nhà 20tr'), /^🏺 Đã tạo hũ Mua nhà · mục tiêu 20\.000\.000đ\./);
      assert.match(await reply(CHONG, '/taohu mua nha'), /Đã có hũ Mua nhà/);
      assert.match(await reply(VO, '/taohu chung'), /Không tạo được/);
      assert.match(await reply(VO, '/taohu Hũ 2026'), /Không tạo được/);
      assert.match(await reply(VO, '/taohu Quỹ Y tế'), /Đã tạo hũ Y tế\./);
      assert.match(await reply(VO, '/taohu Du lịch 2 tỷ'), /mục tiêu 2\.000\.000\.000đ/);
      assert.match(await reply(VO, '/taohu'), /Thiếu tên hũ/);
      assert.match(await reply(VO, '/taohu Chung cư'), /Không tạo được/); // "quỹ chung cư" bị luật quỹ chung bắt
      assert.match(await reply(VO, '/tietkiemdau 2 tỷ du lịch'), /^🏺 Khai báo hũ Du lịch 2\.000\.000\.000đ/);
      await say(VO, 'bỏ hũ mua nhà 15tr');
      const list = await reply(VO, '/tietkiem');
      assert.match(list, /^🏺 Hũ đến 05\/11:\n• Tiết kiệm: 0đ\n• Mua nhà: 15\.000\.000đ \/ 20\.000\.000đ \(75%\)\n• Y tế: 0đ\n• Du lịch: 2\.000\.000\.000đ \/ 2\.000\.000\.000đ \(100%\)\nTổng hũ: 2\.015\.000\.000đ/);
    });

    it('/taohu gõ nguyên cú pháp mẫu "<mua nhà> 2 tỷ đồng" vẫn hiểu', async () => {
      assert.match(await reply(VO, '/taohu <mua nhà> 2 tỷ đồng'), /^🏺 Đã tạo hũ mua nhà · mục tiêu 2\.000\.000\.000đ\./);
      assert.match(await reply(VO, '/tietkiemdau <50tr> <mua nhà>'), /^🏺 Khai báo hũ mua nhà 50\.000\.000đ/);
    });

    it('Neon chưa có bảng hu (chưa chạy 06): tin thu/chi thường vẫn ghi được', async () => {
      h.db.fail = (sql) => (/\bFROM hu\b/.test(sql) ? new Error('relation "hu" does not exist') : null);
      assert.match(await reply(VO, 'tiền ăn 50k'), /^✅ Chi 50\.000đ · Thức ăn/);
      h.db.fail = null;
    });

    it('bỏ / rút theo tên; "quỹ <tên>"; tên chưa có → nhắc; "quỹ lớp" vẫn là chi; bất biến', async () => {
      await say(VO, '/taohu Mua nhà');
      await say(VO, '/taohu Y tế');
      assert.match(await reply(VO, 'bỏ hũ mua nhà 2tr'), /^🏺 Bỏ hũ Mua nhà 2\.000\.000đ · vợ trả · 05\/11$/);
      assert.match(await reply(CHONG, 'lấy quỹ chung bỏ quỹ y tế 1tr'), /^🏺 Bỏ hũ Y tế 1\.000\.000đ · từ quỹ chung/);
      assert.match(await reply(VO, 'rút quỹ mua nhà 500k'), /^🏺 Lấy ra từ hũ Mua nhà 500\.000đ · vợ nhận/);
      assert.match(await reply(VO, 'bỏ hũ du lịch 5tr'), /Chưa có hũ tên này/);
      assert.match(await reply(VO, 'bỏ hũ 3tr'), /^🏺 Bỏ hũ Tiết kiệm 3\.000\.000đ/);
      assert.match(await reply(VO, 'đóng quỹ lớp cho con 200k'), /^✅ Chi 200\.000đ/);
      assert.equal(await jarTien('mua nha'), 1_500_000);
      assert.equal(await jarTien('y te'), 1_000_000);
      assert.equal(await jarTien('tiet kiem'), 3_000_000);
      await assertInvariant(env, TODAY, 'nhiều hũ');
      assert.equal(await reply(VO, 'quỹ y tế còn bao nhiêu'), '🏺 Hũ Y tế đến 05/11: 1.000.000đ\nChi tiết: /tietkiem');
      assert.match(await reply(VO, 'hũ còn bao nhiêu'), /^🏺 Hũ đến 05\/11:\n• Tiết kiệm: 3\.000\.000đ\n• Mua nhà: 1\.500\.000đ\n• Y tế: 1\.000\.000đ\nTổng hũ: 5\.500\.000đ/);
      assert.match(await reply(VO, 'tháng này bỏ hũ mua nhà bao nhiêu'), /^🏺 Hũ Mua nhà · .*: bỏ vào 2\.000\.000đ \(1 lần\) · lấy ra 500\.000đ \(1 lần\)/);
      assert.match(await reply(VO, '/sodu'), /🏺 Hũ tiết kiệm: 5\.500\.000đ/);
    });

    it('B: chi trả từ hũ — tiền mặt người trả không đổi, hũ giảm, chi tháng tăng; huỷ cả cặp; gửi lại update', async () => {
      await say(VO, '/taohu Y tế');
      await say(VO, '/tietkiemdau 10tr y tế');
      const { update, calls } = await say(VO, 'khám bệnh 2tr lấy từ quỹ y tế');
      const mine = sentTo(calls, VO)[0];
      assert.equal(mine?.text, '✅ Chi 2.000.000đ · Y tế · vợ trả · 05/11 · từ hũ Y tế');
      assert.deepEqual(buttons(mine).map((b) => b.data.split(':')[0]), ['gd']);
      assert.equal(await voCash(), 5_000_000);
      assert.equal(await jarTien('y te'), 8_000_000);
      assert.match(await reply(VO, '/thang'), /• Chi: 2\.000\.000đ/);
      await assertInvariant(env, TODAY, 'B');

      // Gửi lại update → không ghi thêm, trả lời giống lần đầu
      await h.post(update);
      assert.equal(sentTo(h.tg.take(), VO)[0]?.text, '✅ Chi 2.000.000đ · Y tế · vợ trả · 05/11 · từ hũ Y tế');
      assert.equal(await count(env.db, 'hu_tiet_kiem', 'giao_dich_id IS NOT NULL'), 1);

      // Huỷ riêng dòng hũ đi kèm → từ chối
      const linked = await env.db.queryOne<{ id: string }>('SELECT id FROM hu_tiet_kiem WHERE giao_dich_id IS NOT NULL');
      await h.click(VO, `hk:${linked!.id}`);
      assert.match(answers(h.tg.take())[0]?.text ?? '', /huỷ khoản chi đó/);

      // Huỷ khoản chi → hũ về lại, chi tháng về 0
      await h.click(VO, button(mine, 'gd:'));
      const done = h.tg.take();
      assert.equal(answers(done)[0]?.text, 'Đã huỷ');
      assert.match(edits(done)[0]?.text ?? '', /^❌ Đã huỷ: Chi 2\.000\.000đ .* · từ hũ Y tế$/);
      assert.equal(await jarTien('y te'), 10_000_000);
      assert.equal(await voCash(), 5_000_000);
      assert.match(await reply(VO, '/thang'), /• Chi: 0đ/);
      await assertInvariant(env, TODAY, 'huỷ B');
    });

    it('B: chưa rõ danh mục → bàn phím không có nút đổi sang Thu; đổi loại bị chặn; khoản thu / hũ chưa có → không ghi', async () => {
      await say(VO, '/taohu Y tế');
      const { calls } = await say(VO, 'lấy quỹ y tế khám bệnh 500k');
      // Hũ Y tế đang trống → chi từ hũ làm hũ âm → cảnh báo (vẫn ghi); người kia được báo
      assert.match(sentTo(calls, VO)[0]?.text ?? '', /^✅ Chi 500\.000đ · Y tế · .* · từ hũ Y tế\n⚠️ Hũ Y tế bị âm/);
      assert.match(sentTo(calls, CHONG)[0]?.text ?? '', /Vợ: chi 500\.000đ từ hũ Y tế/);
      // Phần chữ còn lại không khớp danh mục → lấy theo tên hũ (hũ Y tế → Y tế)
      assert.match(await reply(VO, 'cafe 50k lấy từ hũ y tế'), /^✅ Chi 50\.000đ · Y tế · .* · từ hũ Y tế\n/);
      await say(VO, '/taohu Mua nhà');
      const cafe = sentTo((await say(VO, 'cafe 50k lấy từ hũ mua nhà')).calls, VO)[0];
      assert.match(cafe?.text ?? '', /Chi khác .* · từ hũ Mua nhà/);
      const kinds = buttons(cafe).map((b) => b.data.split(':')[0]);
      assert.ok(kinds.includes('dm'));
      assert.ok(!kinds.includes('lt'));
      const gdId = button(cafe, 'gd:').slice(3);
      await h.click(VO, `lt:${gdId}:T`);
      assert.match(answers(h.tg.take())[0]?.text ?? '', /không đổi sang Thu/);
      await h.click(VO, button(cafe, 'dm:'));
      assert.equal(answers(h.tg.take())[0]?.text, 'Đã đổi');

      assert.match(await reply(VO, 'lương 10tr lấy từ hũ y tế'), /Chỉ khoản chi mới trả từ hũ/);
      assert.match(await reply(VO, 'mua thuốc 100k lấy từ hũ du lịch'), /Chưa có hũ tên này/); // "hũ" rõ ý → không ghi chi thường
      assert.match(await reply(VO, 'mua thuốc 100k lấy từ quỹ du lịch'), /^✅ Chi 100\.000đ/); // "quỹ" + tên lạ → chi thường
      assert.equal(await count(env.db, 'hu_tiet_kiem', 'giao_dich_id IS NOT NULL'), 3);
      await assertInvariant(env, TODAY, 'B2');
    });
  });
}
