import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ACTION_HELP, NO_TEXT, QUERY_HELP } from '../src/bot/query-replies.ts';
import { isActionRequest } from '../src/parser/intent-classifier.ts';
import { parseVietnameseFinanceMessage } from '../src/parser/index.ts';
import { parsePeriod } from '../src/query/period-parser.ts';
import { parseQuery } from '../src/query/query-parser.ts';
import { BACKENDS, count, insertTransfer, seedInitial, snapshotCounts, type TestEnv } from './helpers/phase3-env.ts';
import { CHONG, VO, button, createHarness, sentTo, type BotHarness } from './helpers/phase5-bot.ts';

const TODAY = '2026-11-05'; // thứ 5

function range(text: string, today = TODAY): [string, string] | null {
  const { period } = parsePeriod(text, today);
  return period ? [period.from, period.to] : null;
}

function parse(text: string, sender: 'VO' | 'CHONG' = 'VO') {
  return parseVietnameseFinanceMessage(text, { senderId: sender, referenceDate: TODAY });
}

describe('Phase 5b — kỳ thời gian (Q-T1, Q-T2)', () => {
  it('Q-T1: hôm nay/qua, tuần (thứ 2), tháng, quý, năm, từ…đến, từ đầu…', () => {
    assert.deepEqual(range('hom nay'), [TODAY, TODAY]);
    assert.deepEqual(range('hom qua'), ['2026-11-04', '2026-11-04']);
    assert.deepEqual(range('tuan nay'), ['2026-11-02', '2026-11-08']);
    assert.deepEqual(range('tuan truoc'), ['2026-10-26', '2026-11-01']);
    assert.deepEqual(range('thang nay'), ['2026-11-01', '2026-11-30']);
    assert.deepEqual(range('thang truoc'), ['2026-10-01', '2026-10-31']);
    assert.deepEqual(range('thang 2'), ['2026-02-01', '2026-02-28']);
    assert.deepEqual(range('thang 10/2025'), ['2025-10-01', '2025-10-31']);
    assert.deepEqual(range('thang 10 nam 2025'), ['2025-10-01', '2025-10-31']);
    assert.deepEqual(range('quy nay'), ['2026-10-01', '2026-12-31']);
    assert.deepEqual(range('quy truoc'), ['2026-07-01', '2026-09-30']);
    assert.deepEqual(range('quy 1'), ['2026-01-01', '2026-03-31']);
    assert.deepEqual(range('nam nay'), ['2026-01-01', '2026-12-31']);
    assert.deepEqual(range('nam ngoai'), ['2025-01-01', '2025-12-31']);
    assert.deepEqual(range('nam 2024'), ['2024-01-01', '2024-12-31']);
    assert.deepEqual(range('chi tu 1/10 den 15/10'), ['2026-10-01', '2026-10-15']);
    assert.deepEqual(range('tu 20/10 den nay'), ['2026-10-20', TODAY]);
    assert.deepEqual(range('tu dau nam'), ['2026-01-01', TODAY]);
    assert.deepEqual(range('tu dau thang den 3/11'), ['2026-11-01', '2026-11-03']);
    assert.deepEqual(range('ngay 2/11'), ['2026-11-02', '2026-11-02']);
    assert.equal(range('vo chi bao nhieu'), null);
    assert.equal(parsePeriod('tien hoc thang nay', TODAY).rest, 'tien hoc');
  });

  it('Q-T2: CN→T2, đầu năm, 29/02, tháng/quý chưa tới → năm trước, từ 20/12 đến 5/1', () => {
    assert.deepEqual(range('tuan nay', '2026-11-08'), ['2026-11-02', '2026-11-08']); // CN
    assert.deepEqual(range('tuan nay', '2026-11-09'), ['2026-11-09', '2026-11-15']); // T2
    assert.deepEqual(range('tuan truoc', '2026-01-02'), ['2025-12-22', '2025-12-28']);
    assert.deepEqual(range('thang truoc', '2026-01-15'), ['2025-12-01', '2025-12-31']);
    assert.deepEqual(range('quy truoc', '2026-02-01'), ['2025-10-01', '2025-12-31']);
    assert.deepEqual(range('thang 2', '2028-03-01'), ['2028-02-01', '2028-02-29']);
    assert.deepEqual(range('thang 12', '2027-01-10'), ['2026-12-01', '2026-12-31']);
    assert.deepEqual(range('quy 4', '2027-01-10'), ['2026-10-01', '2026-12-31']);
    assert.deepEqual(range('tu 20/12 den 5/1', '2027-01-10'), ['2026-12-20', '2027-01-05']);
    assert.equal(range('ngay 31/2'), null);
  });
});

describe('Phase 5b — phân loại câu (Q-11, Q-12, Q-13, Q-14)', () => {
  it('Q-11: câu hỏi không "?" → QUERY (không lưu tin thiếu tiền)', () => {
    for (const text of [
      'chi tiền học tháng này',
      'chi phí y tế của con trai',
      'khoản chi lớn nhất tháng này',
      'chi theo danh mục tháng này',
      'chuyển tiền chưa xác nhận',
      'chi tháng này',
      'thu tháng này',
      'tiết kiệm được mấy',
      'lương tháng 10',
      'tổng chi',
      'Còn nợ ai bao nhiêu?',
    ]) {
      assert.equal(parse(text).intent, 'QUERY_STATISTICS', text);
    }
  });

  it('Q-12: luật hỏi yếu + tiền (giả lập review 2)', () => {
    const rec = (text: string, loai: string, code: string | null) => {
      const r = parse(text);
      assert.equal(r.intent, 'RECORD_TRANSACTION', text);
      if (r.intent !== 'RECORD_TRANSACTION') return;
      assert.equal(r.loai_giao_dich, loai, text);
      assert.equal(r.ma_danh_muc, code, text);
    };
    rec('tiền ăn 50k?', 'CHI', 'THUC_AN');
    rec('tổng thu 5tr', 'THU', null);
    rec('tổng tiền ăn 300k', 'CHI', 'THUC_AN');
    const remind = (text: string, reason: string) => {
      const r = parse(text);
      assert.equal(r.intent, 'UNKNOWN', text);
      assert.equal('ly_do' in r ? r.ly_do : null, reason, text);
    };
    remind('số dư 3tr', 'SO_DU_DUNG_LENH');
    remind('abc 50k?', 'HOI_HAY_GHI');
    remind('hôm nay tiền ăn 50k?', 'HOI_HAY_GHI');
    // Trợ từ hỏi → câu hỏi, không ghi
    for (const text of [
      'tháng này tiền ăn hết 2tr à?',
      'tiền ăn 50k rồi à?',
      'vợ đã trả tiền điện 500k chưa?',
      'mua sữa 300k được không?',
      'tổng chi tháng này 3tr à?',
      'tiền ăn 50k phải không',
      'sao tiền ăn 500k',
    ]) {
      assert.equal(parse(text).intent, 'QUERY_STATISTICS', text);
    }
    // Năm / tháng không phải số tiền
    const year = parse('tiền ăn tháng 10 năm 2026?');
    assert.equal(year.intent, 'QUERY_STATISTICS');
    // Từ hỏi mạnh + tiền → câu hỏi kèm gợi ý ghi
    const strong = parse('lương bao nhiêu 10tr');
    assert.equal(strong.intent, 'QUERY_STATISTICS');
    assert.equal('co_so_tien' in strong && strong.co_so_tien, true);
  });

  it('Q-13: câu hỏi nợ → nhánh nợ, không thành tổng chi', () => {
    for (const text of ['tháng này trả nợ bao nhiêu?', 'còn nợ ai bao nhiêu', 'vay bao nhiêu rồi']) {
      assert.equal(parseQuery(text, TODAY)?.kind, 'NO', text);
    }
  });

  it('Q-14: câu ghi chép Phase 2–5a không đổi', () => {
    const cases: Array<[string, string]> = [
      ['tiền ăn 50k', 'RECORD_TRANSACTION'],
      ['lương 20tr', 'RECORD_TRANSACTION'],
      ['chi 50k abc', 'RECORD_TRANSACTION'],
      ['thu 5tr', 'RECORD_TRANSACTION'],
      ['hôm qua mua sữa 50k', 'RECORD_TRANSACTION'],
      ['cafe 30k', 'RECORD_TRANSACTION'],
      ['chồng nợ anh Hùng 5tr', 'RECORD_TRANSACTION'],
      ['hôm qua vay anh Nam', 'RECORD_TRANSACTION'],
      ['tiền điện tháng 10 hay 500k', 'RECORD_TRANSACTION'],
      ['chuyển vợ 3tr', 'INTERNAL_TRANSFER'],
      ['hôm qua chồng đã chuyển vợ 2tr', 'INTERNAL_TRANSFER'],
      ['bỏ vào quỹ chung 2tr', 'FUND_TRANSFER'],
      ['hôm qua bỏ quỹ chung', 'FUND_TRANSFER'],
      ['rút quỹ chung 1tr', 'FUND_TRANSFER'],
      ['Xuất báo cáo HTML tháng này', 'EXPORT_HTML_REPORT'],
    ];
    for (const [text, intent] of cases) {
      assert.equal(parse(text, 'CHONG').intent, intent, text);
    }
    const r = parse('tiền điện tháng 10 500k');
    assert.equal(r.intent === 'RECORD_TRANSACTION' && r.so_tien, 500_000);
  });

  it('parseQuery: loại câu + bộ lọc', () => {
    const q1 = parseQuery('Tháng này vợ chi bao nhiêu?', TODAY)!;
    assert.equal(q1.kind, 'TONG');
    assert.equal(q1.measure, 'CHI');
    assert.equal(q1.performer, 'VO');
    assert.equal(q1.period.from, '2026-11-01');

    const q2 = parseQuery('chồng chi cho con gái bao nhiêu', TODAY)!;
    assert.equal(q2.performer, 'CHONG');
    assert.deepEqual(q2.beneficiaries?.ids, ['CON_GAI']);

    const q3 = parseQuery('chi cho các con năm nay', TODAY)!;
    assert.equal(q3.performer, null);
    assert.deepEqual(q3.beneficiaries?.ids, ['CON_GAI', 'CON_TRAI', 'CAC_CON']);
    assert.equal(q3.period.from, '2026-01-01');

    assert.deepEqual(parseQuery('chi tiền học tháng này', TODAY)!.categories?.codes, ['HOC_PHI', 'HOC_THEM']);
    assert.deepEqual(parseQuery('học phí năm nay bao nhiêu', TODAY)!.categories?.codes, ['HOC_PHI']);
    assert.deepEqual(parseQuery('chi phí y tế của con trai', TODAY)!.categories?.codes, ['Y_TE', 'THUOC']);
    assert.equal(parseQuery('lương tháng 10', TODAY)!.measure, 'THU');
    assert.equal(parseQuery('lương của vợ tháng này bao nhiêu', TODAY)!.performer, 'VO');
    assert.equal(parseQuery('vợ chi tiền ăn cho gia đình', TODAY)!.beneficiaries?.ids[0], 'GIA_DINH');
    assert.equal(parseQuery('tháng này tiết kiệm được bao nhiêu', TODAY)!.measure, 'CHENH_LECH');
    assert.equal(parseQuery('tháng này bao nhiêu', TODAY)!.measure, 'TONG_QUAN');

    const bal = parseQuery('gia đình còn bao nhiêu', TODAY)!;
    assert.equal(bal.kind, 'SO_DU');
    assert.equal(bal.holder, null);
    assert.equal(bal.period.to, TODAY);
    assert.equal(parseQuery('vợ còn bao nhiêu tiền', TODAY)!.holder, 'VO');
    assert.equal(parseQuery('quỹ chung còn bao nhiêu', TODAY)!.holder, 'QUY_CHUNG');
    assert.equal(parseQuery('bao nhiêu tiền chưa xác định người giữ', TODAY)!.holder, 'CHUA_XAC_DINH');
    assert.equal(parseQuery('số dư cuối tháng trước', TODAY)!.period.to, '2026-10-31');
    // "cho con" không phải "còn"
    assert.equal(parseQuery('chi cho con bao nhieu thang nay', TODAY)!.kind, 'TONG');

    assert.equal(parseQuery('vợ chi nhiều nhất vào danh mục nào', TODAY)!.kind, 'THEO_DANH_MUC');
    assert.equal(parseQuery('tổng chi phí dành cho từng người', TODAY)!.kind, 'THEO_DOI_TUONG');
    const kinds: Array<[string, string]> = [
      ['so sánh tháng này với tháng trước', 'SO_SANH'],
      ['khoản chi nào lớn nhất', 'LON_NHAT'],
      ['những khoản chi lớn nhất tháng này', 'LON_NHAT'],
      ['ai thanh toán nhiều nhất cho con gái', 'AI_NHIEU_NHAT'],
      ['chuyển tiền chưa xác nhận', 'CHUYEN_TIEN'],
      ['liệt kê chi tiền ăn tuần này', 'LIET_KE'],
    ];
    for (const [text, kind] of kinds) {
      assert.equal(parseQuery(text, TODAY)!.kind, kind, text);
    }
    assert.equal(parseQuery('abc xyz', TODAY), null);
    assert.equal(parseQuery('ăn cơm chưa', TODAY), null);
  });

  it('code review: "vậy/muốn" không phải nợ; "chưa rõ ai giữ"; "con trai tiền"; năm nay/ngoái; từ đầu … đến', () => {
    assert.equal(parseQuery('tháng này chi bao nhiêu vậy', TODAY)!.kind, 'TONG');
    assert.equal(parseQuery('tôi muốn biết tháng này vợ chi bao nhiêu', TODAY)!.performer, 'VO');
    assert.equal(parse('muốn xem chi tiêu tháng này').intent, 'QUERY_STATISTICS');
    assert.equal(parse('chi tiêu tháng này vậy').intent, 'QUERY_STATISTICS');
    assert.equal(parse('hôm qua vay anh Nam').intent, 'RECORD_TRANSACTION');
    assert.equal(parse('hom qua vay anh Nam').intent, 'RECORD_TRANSACTION');
    const unknownHolder = parseQuery('tiền chưa rõ ai giữ còn bao nhiêu', TODAY)!;
    assert.equal(unknownHolder.kind, 'SO_DU');
    assert.equal(unknownHolder.holder, 'CHUA_XAC_DINH');
    assert.equal(parseQuery('thang nay chi cho con trai tien hoc bao nhieu', TODAY)!.kind, 'TONG');
    assert.deepEqual(range('thang 10 nam ngoai'), ['2025-10-01', '2025-10-31']);
    assert.deepEqual(range('thang 12 nam nay'), ['2026-12-01', '2026-12-31']);
    assert.deepEqual(range('quy 4 nam truoc'), ['2025-10-01', '2025-12-31']);
    assert.deepEqual(range('tu dau nam den 15/10/2025'), ['2025-01-01', '2025-10-15']);
    assert.deepEqual(range('tu dau thang den 5/10'), ['2026-10-01', '2026-10-05']);
  });

  it('5b-2 code review: thứ tự kỳ khi so sánh, kỳ dở dang, "chuyến đi", "chưa nhận lương", "chi tiết"', () => {
    const cmp = (text: string) => {
      const q = parseQuery(text, '2026-11-06')!;
      return [q.period.from, q.period.to, q.comparePeriod?.from, q.comparePeriod?.to];
    };
    assert.deepEqual(cmp('so sánh tháng 10 với tháng trước'), ['2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30']);
    assert.deepEqual(cmp('so sánh quý 3 với quý trước'), ['2026-07-01', '2026-09-30', '2026-04-01', '2026-06-30']);
    assert.deepEqual(cmp('so sánh tháng trước với tháng này'), ['2026-10-01', '2026-10-31', '2026-11-01', '2026-11-30']);
    assert.deepEqual(cmp('so sánh từ đầu tháng'), ['2026-11-01', '2026-11-06', '2026-10-01', '2026-10-06']);
    assert.deepEqual(cmp('so sánh từ đầu năm'), ['2026-01-01', '2026-11-06', '2025-01-01', '2025-11-06']);
    assert.deepEqual(cmp('so sánh với năm ngoái'), ['2026-01-01', '2026-12-31', '2025-01-01', '2025-12-31']);
    assert.equal(parseQuery('chi phí chuyến đi Đà Lạt tháng này bao nhiêu', TODAY)!.kind, 'TONG');
    assert.equal(parseQuery('phí vận chuyển tháng này bao nhiêu', TODAY)!.kind, 'TONG');
    assert.notEqual(parseQuery('tháng này chồng chưa nhận lương à', TODAY)!.kind, 'CHUYEN_TIEN');
    assert.equal(parseQuery('chuyen tien chua xac nhan', TODAY)!.kind, 'CHUYEN_TIEN');
    assert.equal(parseQuery('chi tiết các khoản thu tháng này', TODAY)!.measure, 'THU');
    assert.equal(parseQuery('ai đang giữ nhiều tiền nhất', TODAY)!.kind, 'SO_DU');
    assert.equal(parseQuery('so sánh chi tiêu của vợ và chồng', TODAY)!.kind, 'AI_NHIEU_NHAT');
  });

  it('không đoán bừa: câu chỉ có trợ từ hỏi → không hiểu; huỷ/xoá → thao tác', () => {
    for (const text of ['hủy lệnh xác nhận được không', 'vợ chi chưa', 'ai đó nhắn gì vậy', 'nhận được chưa']) {
      assert.equal(parseQuery(text, TODAY), null, text);
    }
    assert.equal(isActionRequest('hủy lệnh xác nhận được không'), true);
    assert.equal(isActionRequest('xoá khoản hôm qua'), true);
    assert.equal(isActionRequest('sửa lại khoản tiền ăn'), true);
    assert.equal(isActionRequest('huy giao dich'), true);
    assert.equal(isActionRequest('tiền sửa xe tháng này bao nhiêu'), false);
    assert.equal(isActionRequest('chuyển bị huỷ tháng này'), false);
    assert.equal(isActionRequest('mua sữa 50k'), false);
    const r = parse('hủy khoản tiền ăn 50k');
    assert.equal(r.intent, 'UNKNOWN');
    assert.equal('ly_do' in r ? r.ly_do : null, 'THAO_TAC');
    assert.equal(parseQuery('tiền sửa xe tháng này bao nhiêu', TODAY)!.kind, 'TONG');
    assert.equal(parseQuery('vợ chi bao nhiêu', TODAY)!.performer, 'VO');
  });

  it('5b-2 parseQuery: so sánh 2 kỳ, chuyển tiền (trạng thái, chiều, kỳ)', () => {
    const cmp = parseQuery('so sánh tháng này với tháng trước', TODAY)!;
    assert.deepEqual([cmp.period.from, cmp.comparePeriod?.from], ['2026-11-01', '2026-10-01']);
    const cmp2 = parseQuery('so sánh chi với tháng trước', TODAY)!;
    assert.deepEqual([cmp2.period.from, cmp2.comparePeriod?.from, cmp2.measure], ['2026-11-01', '2026-10-01', 'CHI']);
    const cmp3 = parseQuery('so sánh năm nay', TODAY)!;
    assert.equal(cmp3.comparePeriod?.from, '2025-01-01');
    const cmp4 = parseQuery('so sánh quý 3 với quý 2', TODAY)!;
    assert.deepEqual([cmp4.period.from, cmp4.comparePeriod?.from], ['2026-07-01', '2026-04-01']);

    const t1 = parseQuery('tháng này chồng chuyển vợ bao nhiêu', TODAY)!;
    assert.equal(t1.kind, 'CHUYEN_TIEN');
    assert.deepEqual([t1.transfer?.from, t1.transfer?.to, t1.transfer?.statuses, t1.transfer?.list], ['CHONG', 'VO', ['DA_XAC_NHAN'], false]);
    const t2 = parseQuery('chuyển tiền chưa xác nhận', TODAY)!;
    assert.deepEqual([t2.transfer?.statuses, t2.period.from, t2.transfer?.from], [['CHO_XAC_NHAN'], '1900-01-01', null]);
    assert.deepEqual(parseQuery('chuyển bị huỷ tháng này', TODAY)!.transfer?.statuses, ['DA_HUY', 'TU_CHOI']);
    const t3 = parseQuery('lịch sử chuyển tháng trước', TODAY)!;
    assert.equal(t3.transfer?.statuses.length, 5);
    assert.equal(t3.period.from, '2026-10-01');
    assert.deepEqual([parseQuery('vợ chuyển bao nhiêu tháng này', TODAY)!.transfer?.from, parseQuery('vợ chuyển bao nhiêu tháng này', TODAY)!.transfer?.to], ['VO', 'CHONG']);
    // Nộp/rút quỹ không phải chuyển nội bộ
    assert.notEqual(parseQuery('chuyển vào quỹ chung bao nhiêu', TODAY)!.kind, 'CHUYEN_TIEN');
    assert.equal(parseQuery('ai chi nhiều nhất tháng này', TODAY)!.performer, null);
    assert.equal(parseQuery('liệt kê thu tháng này', TODAY)!.measure, 'THU');
    assert.equal(parseQuery('liệt kê giao dịch tháng này', TODAY)!.measure, 'TONG_QUAN');
  });

  it('code review: "mua 2 con gà" không phải các con; "các con và vợ" → không gán', () => {
    const ben = (text: string) => {
      const r = parse(text);
      return r.intent === 'RECORD_TRANSACTION' ? r.doi_tuong_thu_huong_id : 'X';
    };
    assert.equal(ben('mua 2 con gà 300k'), null);
    assert.equal(ben('mua quần áo cho các con và cho vợ 2tr'), null);
    assert.equal(ben('mua sữa cho hai con 200k'), 'CAC_CON');
    assert.equal(ben('mua sữa cho con gái và con trai 400k'), 'CAC_CON');
    assert.equal(ben('mua sữa cho con gái 100k'), 'CON_GAI');
  });
});

for (const backend of BACKENDS) {
  describe(`Phase 5b — trả lời câu hỏi qua webhook [${backend.name}]`, () => {
    let env: TestEnv;
    let h: BotHarness;

    async function ask(from: number, text: string): Promise<string> {
      await h.text(from, text);
      const calls = sentTo(h.tg.take(), from);
      assert.equal(calls.length, 1, text);
      return calls[0]!.text ?? '';
    }

    beforeEach(async () => {
      env = await backend.open();
      h = createHarness(env.db);
      await seedInitial(env); // 01/11: vợ 5tr, chồng 3tr, quỹ 2tr
      h.setNow('2026-10-20T03:00:00.000Z');
      await h.text(VO, 'tiền ăn 999k'); // tháng trước
      h.setNow('2026-11-05T03:00:00.000Z');
      await h.text(VO, 'tiền ăn 200k');
      await h.text(VO, 'lấy tiền quỹ chung đi chợ 300k');
      await h.text(CHONG, 'vợ trả học phí 1tr cho con gái');
      await h.text(CHONG, 'học thêm cho con trai 500k');
      await h.text(CHONG, 'mua sữa cho các con 150k');
      await h.text(CHONG, 'lương 20tr');
      await h.text(VO, 'vay anh Nam 5tr'); // ghi chú nợ, không tính
      h.tg.take();
      await h.text(VO, 'tiền điện 400k');
      const cancel = button(sentTo(h.tg.take(), VO)[0], 'gd:');
      await h.click(VO, cancel);
      await h.text(CHONG, 'chuyển vợ 1tr'); // chờ xác nhận
      h.tg.take();
    });
    afterEach(async () => {
      await env.close();
    });

    it('Q-1, Q-10: "tháng này vợ chi bao nhiêu" — chỉ khoản vợ thực hiện, trong đó từ quỹ chung; DB không đổi', async () => {
      const before = await snapshotCounts(env.db);
      const text = await ask(CHONG, 'tháng này vợ chi bao nhiêu');
      assert.match(text, /Vợ chi · tháng 11\/2026 \(01\/11–30\/11\): 1\.500\.000đ · 3 khoản/);
      assert.match(text, /Học phí 1\.000\.000đ · Đi chợ 300\.000đ · Thức ăn 200\.000đ/);
      assert.match(text, /Trong đó từ quỹ chung: 300\.000đ/);
      await ask(VO, 'chi theo danh mục tháng này');
      await ask(VO, 'gia đình còn bao nhiêu');
      assert.deepEqual(await snapshotCounts(env.db), before);
    });

    it('Q-2, Q-3: lọc đối tượng / nhóm danh mục', async () => {
      assert.match(await ask(VO, 'vợ chi cho con gái bao nhiêu'), /Vợ chi cho con gái · .*: 1\.000\.000đ · 1 khoản\n.*Chỉ tính khoản có ghi rõ cho con gái/);
      assert.match(await ask(VO, 'chồng chi cho con gái bao nhiêu'), /: 0đ \(chưa có khoản nào\)/);
      assert.match(await ask(VO, 'chi cho các con năm nay'), /Chi cho các con · năm 2026 \(01\/01–31\/12\): 1\.650\.000đ · 3 khoản/);
      assert.match(await ask(VO, 'chi tiền học tháng này'), /Chi tiền học · .*: 1\.500\.000đ · 2 khoản\n• Học phí 1\.000\.000đ · Học thêm 500\.000đ/);
      assert.match(await ask(VO, 'ăn uống tháng này hết bao nhiêu'), /Chi ăn uống · .*: 650\.000đ · 3 khoản/);
      assert.match(await ask(VO, 'tháng trước tiền ăn bao nhiêu'), /Chi thức ăn · tháng 10\/2026 .*: 999\.000đ · 1 khoản/);
      assert.match(await ask(VO, 'chi từ quỹ chung tháng này'), /Chi từ quỹ chung · .*: 300\.000đ · 1 khoản/);
    });

    it('Q-4: số dư hôm nay khớp BalanceService; theo người; trước ngày số dư ban đầu → báo', async () => {
      const bal = await env.bal.getHolderBalances(TODAY);
      assert.equal(bal.status, 'OK');
      if (bal.status !== 'OK') return;
      const text = await ask(VO, 'gia đình còn bao nhiêu');
      assert.match(text, new RegExp(`Tổng: ${bal.tong.toLocaleString('de-DE')}đ`));
      assert.match(text, /Đang chờ xác nhận chuyển: 1\.000\.000đ \(1 khoản\)/);
      assert.match(await ask(VO, 'vợ còn bao nhiêu tiền'), new RegExp(`Vợ đến 05/11: ${bal.nhom.VO.toLocaleString('de-DE')}đ`));
      const fund = await ask(VO, 'quỹ chung còn bao nhiêu');
      assert.match(fund, /Quỹ chung đến 05\/11: 1\.700\.000đ/);
      assert.doesNotMatch(fund, /chờ xác nhận/);
      assert.match(await ask(VO, 'số dư cuối tháng trước'), /Chưa có số dư tại 31\/10 — số dư ban đầu tính từ 01\/11/);
    });

    it('Q-8: tiết kiệm = thu − chi; tổng quan; theo danh mục / đối tượng', async () => {
      assert.match(await ask(VO, 'tháng này tiết kiệm được bao nhiêu'), /Tiết kiệm · .*: 17\.850\.000đ\nThu 20\.000\.000đ − Chi 2\.150\.000đ/);
      const all = await ask(VO, 'tháng này bao nhiêu');
      assert.match(all, /• Thu: 20\.000\.000đ · 1 khoản\n• Chi: 2\.150\.000đ · 5 khoản\n• Chênh lệch: 17\.850\.000đ/);
      const byCat = await ask(VO, 'chi theo danh mục tháng này');
      assert.match(byCat, /• Học phí: 1\.000\.000đ \(1\)\n• Học thêm: 500\.000đ \(1\)\n• Đi chợ: 300\.000đ \(1\)\n• Thức ăn: 200\.000đ \(1\)\n• Sữa: 150\.000đ \(1\)/);
      const byBen = await ask(VO, 'chi cho từng người tháng này');
      assert.match(byBen, /• Con gái: 1\.000\.000đ/);
      assert.match(byBen, /• Không ghi đối tượng: 500\.000đ \(2\)/);
      assert.match(byBen, /• Các con: 150\.000đ \(1\)/);
    });

    it('Q-5: khoản lớn nhất, ai chi nhiều nhất, liệt kê', async () => {
      assert.equal(
        await ask(VO, 'khoản chi nào lớn nhất tháng này'),
        [
          '🔝 Khoản chi lớn nhất · tháng 11/2026 (01/11–30/11):',
          '1. 05/11 1.000.000đ Học phí (Vợ)',
          '2. 05/11 500.000đ Học thêm (Chồng)',
          '3. 05/11 300.000đ Đi chợ (Vợ)',
          '4. 05/11 200.000đ Thức ăn (Vợ)',
          '5. 05/11 150.000đ Sữa (Chồng)',
        ].join('\n'),
      );
      assert.match(await ask(VO, 'ai thanh toán nhiều nhất cho con gái'), /• Vợ: 1\.000\.000đ \(1\)/);
      assert.match(await ask(VO, 'ai chi nhiều nhất tháng này'), /: 2\.150\.000đ · 5 khoản\n• Vợ: 1\.500\.000đ \(3\)\n• Chồng: 650\.000đ \(2\)/);
      assert.equal(
        await ask(VO, 'liệt kê chi tiền ăn tuần này'),
        '📋 Chi thức ăn · tuần này (02/11–08/11): 200.000đ · 1 khoản\n• 05/11 200.000đ Thức ăn (Vợ)',
      );
      const all = await ask(VO, 'liệt kê giao dịch tháng này');
      assert.match(all, /^📋 Thu\/chi · tháng 11\/2026 \(01\/11–30\/11\): thu 20\.000\.000đ, chi 2\.150\.000đ · 6 khoản/);
      assert.match(await ask(VO, 'chi tiết các khoản thu tháng này'), /^📋 Thu · .*: 20\.000\.000đ · 1 khoản\n• 05\/11 \+20\.000\.000đ Lương \(Chồng\)$/);
      assert.match(await ask(VO, 'so sánh chi tiêu của vợ và chồng'), /• Vợ: 1\.500\.000đ \(3\)\n• Chồng: 650\.000đ \(2\)/);
      assert.match(await ask(VO, 'ai đang giữ nhiều tiền nhất'), /Số dư đến 05\/11/);
      assert.match(all, /• 05\/11 \+20\.000\.000đ Lương \(Chồng\)/);
      assert.doesNotMatch(all, /Điện|999\.000/);
    });

    it('Q-6: so sánh tháng này với tháng trước', async () => {
      assert.equal(
        await ask(VO, 'so sánh tháng này với tháng trước'),
        [
          '📊 Tháng 11/2026 (01/11–30/11) so với tháng 10/2026 (01/10–31/10):',
          '• Thu: 20.000.000đ / 0đ (chênh +20.000.000đ)',
          '• Chi: 2.150.000đ / 999.000đ (chênh +1.151.000đ)',
          '• Tiết kiệm: 17.850.000đ / -999.000đ (chênh +18.849.000đ)',
        ].join('\n'),
      );
    });

    it('Q-7: chuyển tiền theo trạng thái và chiều', async () => {
      await insertTransfer(env.db, 'CT_Q7_1', 'CHONG', 'VO', 2_000_000, '2026-11-03', 'DA_XAC_NHAN');
      await insertTransfer(env.db, 'CT_Q7_2', 'VO', 'CHONG', 300_000, '2026-11-02', 'DA_XAC_NHAN');
      await insertTransfer(env.db, 'CT_Q7_3', 'CHONG', 'VO', 700_000, '2026-11-01', 'DA_HUY');
      await insertTransfer(env.db, 'CT_Q7_4', 'CHONG', 'VO', 400_000, '2026-10-30', 'DA_XAC_NHAN');
      assert.equal(
        await ask(VO, 'tháng này chồng chuyển vợ bao nhiêu'),
        '💸 Chuyển tiền Chồng → Vợ (đã nhận) · tháng 11/2026 (01/11–30/11): 2.000.000đ · 1 khoản',
      );
      assert.equal(
        await ask(VO, 'chuyển tiền chưa xác nhận'),
        '💸 Chuyển tiền (chưa xác nhận) · tính đến hôm nay: 1.000.000đ · 1 khoản\n• 05/11 Chồng → Vợ 1.000.000đ (đang chờ)',
      );
      assert.match(await ask(VO, 'chuyển bị huỷ tháng này'), /700\.000đ · 1 khoản\n• 01\/11 Chồng → Vợ 700\.000đ \(đã huỷ\)$/);
      assert.match(await ask(VO, 'lịch sử chuyển tháng trước'), /: 1 khoản, đã nhận 400\.000đ\n• 30\/10 Chồng → Vợ 400\.000đ \(đã nhận\)$/);
      // Nhiều trạng thái: khoản huỷ / chờ không cộng vào "đã nhận"
      assert.match(await ask(VO, 'lịch sử chuyển tháng này'), /: 4 khoản, đã nhận 2\.300\.000đ/);
    });

    it('Q-9, Q-13, Q-12: câu chưa hiểu lưu DA_BO_QUA; nợ; nhắc không ghi', async () => {
      const before = await count(env.db, 'giao_dich');
      assert.equal(await ask(VO, 'abc xyz?'), QUERY_HELP);
      assert.equal(await count(env.db, 'tin_nhan_goc', "chi_tiet_loi = 'CAU_HOI_CHUA_HIEU' AND trang_thai_xu_ly = 'DA_BO_QUA'"), 1);
      assert.equal(await ask(VO, 'tháng này trả nợ bao nhiêu'), NO_TEXT);
      // Huỷ/xoá qua chữ → hướng dẫn nút, không ghi, không lưu tin
      const tinTruoc = await count(env.db, 'tin_nhan_goc');
      assert.equal(await ask(VO, 'hủy lệnh xác nhận được không'), ACTION_HELP);
      assert.equal(await ask(VO, 'hủy khoản tiền ăn 50k'), ACTION_HELP);
      assert.equal(await ask(VO, 'xoá khoản hôm qua'), ACTION_HELP);
      assert.equal(await count(env.db, 'tin_nhan_goc'), tinTruoc);
      assert.match(await ask(VO, 'số dư 3tr'), /\/sodudau/);
      assert.match(await ask(VO, 'abc 50k?'), /giống câu hỏi/);
      assert.match(await ask(VO, 'lương bao nhiêu 10tr'), /Muốn ghi khoản này/);
      assert.equal(await count(env.db, 'giao_dich'), before);
      assert.match(await ask(VO, 'tiền ăn 50k?'), /✅ Chi 50\.000đ · Thức ăn/);
      assert.equal(await count(env.db, 'giao_dich'), before + 1);
    });
  });
}
