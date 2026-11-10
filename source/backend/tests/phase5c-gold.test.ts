import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { formatGold } from '../src/bot/replies.ts';
import { parseVietnameseFinanceMessage } from '../src/parser/index.ts';
import { parseQuery } from '../src/query/query-parser.ts';
import { BACKENDS, assertInvariant, seedInitial, type TestEnv } from './helpers/phase3-env.ts';
import { CHONG, VO, button, createHarness, sentTo, type BotHarness } from './helpers/phase5-bot.ts';

const TODAY = '2026-11-05';
const JARS = ['tiet kiem', 'mua nha', 'y te'];

function parse(text: string, senderId: 'VO' | 'CHONG' = 'VO') {
  return parseVietnameseFinanceMessage(text, { senderId, referenceDate: TODAY, jarNames: JARS });
}

// "NOP:20:28000000:VO:null:-" — chiều, phân, tiền, nguồn, hũ, lý do
function gold(text: string, senderId: 'VO' | 'CHONG' = 'VO'): string {
  const r = parse(text, senderId);
  if (r.intent !== 'SAVINGS_MOVE') {
    return r.intent === 'RECORD_TRANSACTION' ? `GD:${r.loai_giao_dich}:${r.ma_danh_muc}:${r.so_tien}` : r.intent;
  }
  const body = [r.chieu, r.so_luong_phan, r.so_tien, r.nguon_id, r.ten_hu, r.ly_do_chua_ho_tro ?? '-'].join(':');
  return r.loai_tai_san === 'VANG' ? body : `TIEN:${body}`;
}

describe('Phase 5c-2 — vàng: parser', () => {
  it('S-11 mua: tổng / đơn giá / không tiền / quỹ chung / hũ có tên / chủ ngữ khác', () => {
    assert.equal(gold('mua vàng 1 chỉ 14tr'), 'NOP:10:14000000:VO::-');
    assert.equal(gold('mua 2 chỉ vàng 28tr'), 'NOP:20:28000000:VO::-');
    assert.equal(gold('mua vàng 28tr 2 chỉ'), 'NOP:20:28000000:VO::-'); // không thành 28,2tr
    for (const text of ['mua vàng 2 chỉ 14tr/chỉ', 'mua vàng 2 chỉ giá 14tr 1 chỉ', 'mua vàng 2 chỉ mỗi chỉ 14tr', 'mua vàng 2 chỉ 14tr một chỉ']) {
      assert.equal(gold(text), 'NOP:20:28000000:VO::-', text);
    }
    assert.equal(gold('lấy quỹ chung mua vàng 2 chỉ 28tr'), 'NOP:20:28000000:QUY_CHUNG::-');
    assert.equal(gold('mua vàng 1 chỉ 14tr bỏ hũ mua nhà'), 'NOP:10:14000000:VO:mua nha:-');
    assert.equal(gold('mua vàng cho hũ mua nhà 1 chỉ 14tr'), 'NOP:10:14000000:VO:mua nha:-');
    assert.equal(gold('mua vàng 0.5 chỉ'), 'NOP:5::VO::-');
    assert.equal(gold('mua nửa chỉ vàng'), 'NOP:5::VO::-');
    assert.equal(gold('chồng mua vàng 1 chỉ 14tr'), 'NOP:10:14000000:VO::CHU_NGU_KHAC_NGUOI_GUI');
    assert.equal(gold('mua vàng 1 chỉ 14tr bằng tiền chồng'), 'NOP:10:14000000:VO::CHU_NGU_KHAC_NGUOI_GUI');
    assert.equal(gold('mua vàng sjc 1 lượng 140tr'), 'NOP:100:140000000:VO::-');
    assert.equal(gold('mua vàng 9999 2 chỉ 28tr'), 'NOP:20:28000000:VO::-'); // "9999" không phải tiền
    assert.equal(gold('mua nhẫn tròn trơn 1 chỉ 14tr'), 'NOP:10:14000000:VO::-');
    assert.equal(gold('mua vàng nhẫn bảo tín 1 chỉ 14tr'), 'NOP:10:14000000:VO::-');
    assert.equal(gold('mua vang 2 chi 28tr'), 'NOP:20:28000000:VO::-');
    assert.equal(gold('hôm qua mua vàng 1 chỉ 14tr'), 'NOP:10:14000000:VO::-');
    const r = parse('mua vàng 1 chỉ hôm qua'); // có ngày, không tiền: vẫn là câu ghi
    assert.deepEqual(r.intent === 'SAVINGS_MOVE' && [r.so_luong_phan, r.ngay], [10, '2026-11-04']);
  });

  it('S-12 đơn vị: lượng ≠ lương, cây, rưỡi, ghép, lẻ hơn phân', () => {
    assert.equal(gold('mua vàng 1 lượng 140tr'), 'NOP:100:140000000:VO::-');
    assert.equal(gold('mua vàng 1 cây 140tr'), 'NOP:100:140000000:VO::-');
    assert.equal(gold('mua vàng 1 chỉ rưỡi 21tr'), 'NOP:15:21000000:VO::-');
    assert.equal(gold('mua vàng 1 chỉ 5 phân 21tr'), 'NOP:15:21000000:VO::-');
    assert.equal(gold('mua vàng 1 lượng 2 chỉ 168tr'), 'NOP:120:168000000:VO::-');
    assert.equal(gold('mua vàng 0,25 chỉ'), 'NOP:::VO::VANG_LE_QUA_NHO');
    assert.deepEqual(['5', '20', '120', '125'].map((p) => formatGold(Number(p))), ['0,5 chỉ', '2 chỉ', '12 chỉ (1,2 lượng)', '12,5 chỉ (1,25 lượng)']);
  });

  it('S-13 bán / khai báo / bỏ hũ vàng', () => {
    assert.equal(gold('bán vàng 1 chỉ 15tr'), 'RUT:10:15000000:VO::-');
    assert.equal(gold('bán vàng 1 chỉ 15tr bỏ quỹ chung'), 'RUT:10:15000000:QUY_CHUNG::-');
    assert.equal(gold('bán vàng 1 chỉ 15tr từ hũ mua nhà'), 'RUT:10:15000000:VO:mua nha:-');
    assert.equal(gold('khai báo vàng 3 chỉ'), 'KHAI_BAO:30::::-');
    assert.equal(gold('khai báo vàng 3 chỉ giá 14tr/chỉ'), 'KHAI_BAO:30:42000000:::-');
    assert.equal(gold('bỏ hũ 1 chỉ vàng'), 'KHAI_BAO:10::::-');
    assert.equal(gold('cất 2 chỉ vàng vào hũ mua nhà'), 'KHAI_BAO:20:::mua nha:-');
  });

  it('S-16 thiếu số lượng / tiền mơ hồ / đổi tiền hũ sang vàng', () => {
    assert.equal(gold('mua vàng 14tr'), 'NOP::14000000:VO::VANG_THIEU_SO_LUONG');
    assert.equal(gold('mua vàng 1 chỉ 14'), 'NOP:10::VO::VANG_SO_TIEN_MO_HO');
    assert.equal(gold('mua vàng 2 chỉ 14tr/chỉ 28tr'), 'NOP:20::VO::VANG_SO_TIEN_MO_HO');
    assert.match(gold('rút hũ mua vàng 2 chỉ 28tr'), /VANG_TU_HU$/);
    assert.match(gold('lấy hũ mua nhà mua vàng 2 chỉ 28tr'), /VANG_TU_HU$/);
  });

  it('S-15 không phải vàng → luồng thường; "lượng" trong câu trang sức không thành lương', () => {
    assert.equal(gold('mua vàng mã 50k'), 'GD:null:null:50000');
    assert.equal(gold('áo vàng 200k'), 'GD:null:null:200000');
    assert.equal(gold('mua dây chuyền vàng 1 lượng 140tr'), 'GD:null:null:140000000');
    assert.equal(gold('mua nhẫn vàng cho con 1 chỉ 5tr'), 'GD:null:null:5000000');
    assert.equal(gold('bạn mua vàng 1 chỉ 14tr'), 'GD:null:null:14000000');
    assert.equal(gold('chi: mua vàng 1 lượng 140tr'), 'GD:CHI:null:140000000');
    assert.equal(gold('vâng'), 'GD:null:null:null');
    // Hồi quy hũ tiền / số tiền
    assert.equal(gold('bỏ hũ mua nhà 2tr'), 'TIEN:NOP::2000000:VO:mua nha:-');
    assert.equal(gold('lương 20tr'), 'GD:THU:LUONG:20000000');
    assert.equal(gold('1tr5 tiền ăn'), 'GD:CHI:THUC_AN:1500000');
  });

  it('code review: tên hũ có "vàng"; "1tr5 lương"; "tăng giá / cho chắc"; "về quỹ chung"; "2 chỉ 9999"', () => {
    const names = [...JARS, 'mua vang'];
    const p = (text: string) => parseVietnameseFinanceMessage(text, { senderId: 'VO', referenceDate: TODAY, jarNames: names });
    const a = p('bỏ hũ mua vàng 5tr');
    assert.deepEqual(a.intent === 'SAVINGS_MOVE' && [a.loai_tai_san, a.chieu, a.ten_hu, a.so_tien], ['TIEN', 'NOP', 'mua vang', 5_000_000]);
    const b = p('mua vàng 1 chỉ 14tr bỏ hũ mua vàng');
    assert.deepEqual(b.intent === 'SAVINGS_MOVE' && [b.loai_tai_san, b.so_luong_phan, b.ten_hu], ['VANG', 10, 'mua vang']);
    // Lookahead số lượng không còn áp cho mọi câu
    const c = parse('ứng 1tr5 lương');
    assert.equal(c.intent === 'RECORD_TRANSACTION' && c.so_tien, 1_500_000);
    assert.equal(gold('mua vàng 1 chỉ 14tr tăng giá'), 'NOP:10:14000000:VO::-');
    assert.equal(gold('mua vàng 1 chỉ 14tr cho chắc'), 'NOP:10:14000000:VO::-');
    assert.equal(gold('bán vàng 1 chỉ 15tr về quỹ chung'), 'RUT:10:15000000:QUY_CHUNG::-');
    assert.equal(gold('mua vàng 1 chỉ 14tr bỏ vào quỹ chung'), 'NOP:10:14000000:VO::VANG_NGUON_KHONG_RO');
    assert.equal(gold('mua vàng 2 chỉ 9999 28tr'), 'NOP:20:28000000:VO::-');
    for (const text of ['tháng này mua vàng mã bao nhiêu', 'tháng này mua rượu vang bao nhiêu', 'tháng này chi áo vàng bao nhiêu']) {
      assert.notEqual(parseQuery(text, TODAY, JARS)?.kind, 'HU_TIET_KIEM', text);
    }
    assert.equal(parseQuery('hũ mua vàng còn bao nhiêu', TODAY, names)?.huTen, 'mua vang');
  });

  it('S-17 câu hỏi vàng → hũ', () => {
    for (const text of ['vàng còn mấy chỉ', 'có bao nhiêu chỉ vàng', 'giá vàng bao nhiêu']) {
      const q = parseQuery(text, TODAY, JARS)!;
      assert.deepEqual([q.kind, q.savingsFlow], ['HU_TIET_KIEM', undefined], text);
    }
    assert.equal(parseQuery('tháng này mua vàng bao nhiêu', TODAY, JARS)?.savingsFlow, true);
    assert.equal(parseQuery('vâng tháng này chi bao nhiêu', TODAY, JARS)?.kind, 'TONG');
  });
});

for (const backend of BACKENDS) {
  describe(`Phase 5c-2 — vàng qua webhook [${backend.name}]`, () => {
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
      await seedInitial(env, 50_000_000, 30_000_000, 20_000_000);
    });
    afterEach(async () => {
      await env.close();
    });

    it('mua / bán / khai báo: tiền mặt đúng nguồn, bất biến, báo người kia, không thành thu/chi', async () => {
      const calls = await say(VO, 'mua vàng 2 chỉ 14tr/chỉ');
      assert.equal(sentTo(calls, VO)[0]?.text, '🏺 Mua vàng 2 chỉ vào hũ Tiết kiệm 28.000.000đ (14.000.000đ/chỉ) · vợ trả · 05/11');
      assert.equal(sentTo(calls, CHONG)[0]?.text, 'ℹ️ Vợ: mua vàng 2 chỉ vào hũ Tiết kiệm 28.000.000đ (14.000.000đ/chỉ) (vợ trả, 05/11).');
      assert.match(await reply(CHONG, 'lấy quỹ chung mua vàng 1 chỉ 14tr'), /^🏺 Mua vàng 1 chỉ vào hũ Tiết kiệm 14\.000\.000đ · từ quỹ chung/);
      assert.match(await reply(VO, 'mua vàng 0.5 chỉ'), /^🏺 Mua vàng 0,5 chỉ vào hũ Tiết kiệm · không trừ tiền ai/);
      assert.deepEqual(await cash(), [22_000_000, 30_000_000, 6_000_000]);
      assert.match(await reply(CHONG, 'bán vàng 1 chỉ 15tr'), /^🏺 Bán vàng 1 chỉ từ hũ Tiết kiệm 15\.000\.000đ · chồng nhận/);
      assert.deepEqual(await cash(), [22_000_000, 45_000_000, 6_000_000]);
      assert.match(await reply(VO, 'khai báo vàng 3 chỉ'), /^🏺 Khai báo vàng 3 chỉ vào hũ Tiết kiệm · không trừ tiền ai/);
      await assertInvariant(env, TODAY, 'vàng');
      // Không vào thu/chi
      assert.match(await reply(VO, '/thang'), /• Thu: 0đ · 0 khoản\n• Chi: 0đ · 0 khoản/);
      // 2 + 1 + 0,5 − 1 + 3 = 5,5 chỉ; giá gần nhất = lần bán 15tr/chỉ
      const list = await reply(VO, '/tietkiem');
      assert.match(list, /^🏺 Hũ đến 05\/11:\n• Tiết kiệm: 0đ \+ vàng 5,5 chỉ \(≈ 82\.500\.000đ\)\nTổng hũ: ≈ 82\.500\.000đ\nGiá vàng theo lần mua\/bán gần nhất: 15\.000\.000đ\/chỉ \(05\/11\)/);
      assert.match(list, /• 05\/11 Bán vàng 1 chỉ 15\.000\.000đ \(Tiết kiệm, chồng\)/);
      assert.match(list, /• 05\/11 Khai báo vàng 3 chỉ \(Tiết kiệm\)/);
      const sodu = await reply(VO, '/sodu');
      assert.match(sodu, /🏺 Hũ tiết kiệm: 0đ \+ vàng 5,5 chỉ \(≈ 82\.500\.000đ\)\nTổng tài sản \(ước tính\): 155\.500\.000đ/);
      assert.match(await reply(VO, 'vàng còn mấy chỉ'), /Tiết kiệm: 0đ \+ vàng 5,5 chỉ/);
    });

    it('S-14 định giá: huỷ dòng giá gần nhất → về giá trước; chưa có giá → chưa định giá; khai báo không đè giá mua', async () => {
      await say(VO, 'khai báo vàng 2 chỉ');
      assert.match(await reply(VO, '/tietkiem'), /vàng 2 chỉ \(chưa định giá\)\nTổng hũ: ≈ 0đ \(chưa tính vàng\)/);
      assert.match(await reply(VO, '/sodu'), /Tổng tài sản \(ước tính\): 100\.000\.000đ \(chưa tính vàng chưa định giá\)/);
      await say(VO, 'mua vàng 1 chỉ 14tr');
      const calls = await say(VO, 'khai báo vàng 1 chỉ giá 9tr/chỉ');
      const sell = await say(VO, 'mua vàng 1 chỉ 16tr');
      assert.match(await reply(VO, '/tietkiem'), /vàng 5 chỉ \(≈ 80\.000\.000đ\)[\s\S]*16\.000\.000đ\/chỉ/);
      await h.click(VO, button(sentTo(sell, VO)[0], 'hk:'));
      h.tg.take();
      assert.match(await reply(VO, '/tietkiem'), /vàng 4 chỉ \(≈ 56\.000\.000đ\)[\s\S]*14\.000\.000đ\/chỉ/);
      assert.ok(calls.length > 0);
    });

    it('cảnh báo: bán quá số chỉ, giá lệch > 30%; bán thiếu tiền; vàng ở nhiều hũ', async () => {
      await say(VO, '/taohu Mua nhà');
      await say(VO, 'mua vàng 1 chỉ 14tr');
      assert.match(await reply(VO, 'bán vàng 2 chỉ 30tr'), /⚠️ Bán nhiều hơn số vàng đang có trong hũ/);
      const typo = sentTo(await say(VO, 'mua vàng 1 chỉ 1tr4'), VO)[0];
      assert.match(typo?.text ?? '', /⚠️ Giá này lệch xa giá đang dùng 15\.000\.000đ\/chỉ/);
      // Gõ nhầm → bấm Huỷ: giá đang dùng về lại 15tr
      await h.click(VO, button(typo, 'hk:'));
      h.tg.take();
      assert.doesNotMatch(await reply(VO, 'mua vàng 1 chỉ 15tr5'), /lệch xa/);
      assert.match(await reply(VO, 'bán vàng 1 chỉ'), /Bán được bao nhiêu\?/);
      assert.match(await reply(VO, 'mua vàng 14tr'), /Mấy chỉ vàng\?/);
      assert.match(await reply(VO, 'rút hũ mua vàng 2 chỉ 28tr'), /Chưa hỗ trợ đổi tiền trong hũ sang vàng/);
      // Tiết kiệm: 1 − 2 + 1 = 0 chỉ → bán không nêu hũ lấy từ hũ duy nhất đang có vàng
      await say(VO, 'cất 2 chỉ vàng vào hũ mua nhà');
      assert.match(await reply(VO, 'bán vàng 1 chỉ 15tr'), /^🏺 Bán vàng 1 chỉ từ hũ Mua nhà/);
      await say(VO, 'mua vàng 1 chỉ 15tr');
      assert.match(await reply(VO, 'bán vàng 1 chỉ 15tr'), /Vàng đang ở nhiều hũ/);
      assert.match(await reply(VO, 'bán vàng 1 chỉ 15tr từ hũ mua nhà'), /^🏺 Bán vàng 1 chỉ từ hũ Mua nhà 15\.000\.000đ/);
      assert.match(await reply(VO, '/taohu Vàng'), /Không tạo được/);
      await assertInvariant(env, TODAY, 'cảnh báo');
    });

    it('code review: hỏi "mua vàng" chỉ đếm vàng; giá từ khai báo; /tietkiemdau hũ "Vàng cưới"; hũ ẩn vẫn vào tổng', async () => {
      assert.match(await reply(VO, '/tietkiemdau 3 chỉ vàng 42tr'), /^🏺 Khai báo vàng 3 chỉ/);
      assert.match(await reply(VO, '/tietkiem'), /Giá vàng theo lần khai báo gần nhất: 14\.000\.000đ\/chỉ/);
      await say(VO, 'bỏ hũ 10tr');
      await say(VO, 'mua vàng 1 chỉ 14tr');
      assert.match(await reply(VO, 'tháng này mua vàng bao nhiêu'), /: mua vàng 14\.000\.000đ \(1 lần\) · bán vàng 0đ \(0 lần\)/);
      assert.match(await reply(VO, 'tháng này bỏ hũ bao nhiêu'), /: bỏ vào 24\.000\.000đ \(2 lần\)/);
      await say(VO, '/taohu Vàng cưới');
      assert.match(await reply(VO, '/tietkiemdau 5tr vàng cưới'), /^🏺 Khai báo hũ Vàng cưới 5\.000\.000đ/);
      assert.match(await reply(VO, 'bỏ hũ vàng cưới 1tr'), /^🏺 Bỏ hũ Vàng cưới 1\.000\.000đ/);
      const before = await reply(VO, '/sodu');
      await env.db.execute(`UPDATE hu SET is_active = (1 = 0) WHERE ten_khong_dau = 'vang cuoi'`);
      assert.equal(await reply(VO, '/sodu'), before);
    });

    it('/giavang: đặt giá → định giá theo giá mới hơn; mua sau đó lại dùng giá mua; giá 1 lượng; chưa có bảng vẫn chạy', async () => {
      await say(VO, 'mua vàng 2 chỉ 14tr/chỉ');
      const set = await say(VO, '/giavang 15tr');
      assert.equal(sentTo(set, VO)[0]?.text, '✅ Giá vàng 05/11: 15.000.000đ/chỉ\nVàng đang có: 2 chỉ ≈ 30.000.000đ');
      assert.equal(sentTo(set, CHONG)[0]?.text, 'ℹ️ Vợ cập nhật giá vàng: 15.000.000đ/chỉ.');
      assert.match(await reply(VO, '/tietkiem'), /vàng 2 chỉ \(≈ 30\.000\.000đ\)[\s\S]*Giá vàng nhập bằng \/giavang: 15\.000\.000đ\/chỉ \(05\/11\)/);
      await say(VO, 'mua vàng 1 chỉ 15tr5');
      assert.match(await reply(VO, '/giavang'), /^Giá vàng theo lần mua\/bán gần nhất: 15\.500\.000đ\/chỉ \(05\/11\)\nVàng đang có: 3 chỉ ≈ 46\.500\.000đ/);
      assert.match(await reply(CHONG, '/giavang 160tr lượng'), /^✅ Giá vàng 05\/11: 16\.000\.000đ\/chỉ/);
      assert.match(await reply(VO, '/giavang 15tr/chỉ'), /^✅ Giá vàng 05\/11: 15\.000\.000đ\/chỉ/);
      assert.match(await reply(VO, '/giavang abc'), /^Chưa rõ giá\./);
      assert.match(await reply(VO, 'mua vàng 1 chỉ 1tr'), /lệch xa giá đang dùng 15\.000\.000đ\/chỉ/);
      // Quên chữ "lượng" → cảnh báo lệch xa
      assert.match(await reply(VO, '/giavang 150tr'), /⚠️ Lệch xa giá trước đó 1\.000\.000đ\/chỉ/);
    });

    it('code review: Neon chưa có bảng gia_vang (xoá bảng thật) → mua / bán vàng, /tietkiem vẫn chạy; /giavang cũ không đè khai báo mới', async () => {
      h.setNow('2026-10-01T03:00:00.000Z');
      await say(VO, '/giavang 8tr');
      h.setNow('2026-11-05T03:00:00.000Z');
      await say(VO, '/tietkiemdau 3 chỉ vàng 45tr');
      assert.match(await reply(VO, '/tietkiem'), /Giá vàng theo lần khai báo gần nhất: 15\.000\.000đ\/chỉ/);
      await env.db.execute('DROP TABLE gia_vang');
      assert.match(await reply(VO, 'mua vàng 1 chỉ 14tr'), /^🏺 Mua vàng 1 chỉ vào hũ Tiết kiệm 14\.000\.000đ/);
      assert.match(await reply(VO, '/tietkiem'), /vàng 4 chỉ \(≈ 56\.000\.000đ\)/);
      await assertInvariant(env, TODAY, 'không có gia_vang');
    });

    it('/tietkiemdau vàng; huỷ dòng vàng trả lại tiền; câu hỏi 1 hũ có vàng', async () => {
      assert.match(await reply(VO, '/tietkiemdau 3 chỉ vàng 42tr'), /^🏺 Khai báo vàng 3 chỉ vào hũ Tiết kiệm 42\.000\.000đ \(14\.000\.000đ\/chỉ\) · không trừ tiền ai/);
      await say(VO, '/taohu Mua nhà');
      assert.match(await reply(VO, '/tietkiemdau 1 chỉ vàng mua nhà'), /^🏺 Khai báo vàng 1 chỉ vào hũ Mua nhà · không trừ tiền ai/);
      assert.match(await reply(VO, '/tietkiemdau vàng'), /^Chưa rõ số lượng vàng/);
      assert.match(await reply(VO, '/tietkiemdau 50tr'), /^🏺 Khai báo hũ Tiết kiệm 50\.000\.000đ/);
      const buy = await say(VO, 'mua vàng 1 chỉ 14tr');
      assert.deepEqual(await cash(), [36_000_000, 30_000_000, 20_000_000]);
      await h.click(VO, button(sentTo(buy, VO)[0], 'hk:'));
      const after = h.tg.take();
      assert.ok(after.some((c) => /Đã huỷ/.test(c.text ?? '')));
      assert.deepEqual(await cash(), [50_000_000, 30_000_000, 20_000_000]);
      assert.match(await reply(VO, 'hũ mua nhà còn bao nhiêu'), /^🏺 Hũ Mua nhà đến 05\/11: 0đ \+ vàng 1 chỉ \(≈ 14\.000\.000đ\)/);
      await assertInvariant(env, TODAY, 'huỷ');
    });
  });
}
