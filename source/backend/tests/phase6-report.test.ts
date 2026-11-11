import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { changeText, esc } from '../src/bot/report-html.ts';
import { reportPeriod, ReportService } from '../src/services/report-service.ts';
import { CloudflareScreenshotter, HttpTelegramClient } from '../src/telegram/client.ts';
import { REPORT_CRON } from '../src/worker.ts';
import { BACKENDS, seedInitial, type TestEnv } from './helpers/phase3-env.ts';
import { CHONG, VO, createHarness, sentTo, type BotHarness, type SentCall } from './helpers/phase5-bot.ts';
import { TelegramApiError } from '../src/telegram/client.ts';

describe('Phase 6 — báo cáo tháng: hàm thuần', () => {
  it('escape HTML + bỏ ký tự điều khiển; so sánh %; kỳ tháng đang chạy', () => {
    assert.equal(esc('<script>"x"&\'y\'</script>\u0007'), '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;');
    assert.deepEqual([changeText(110, 100), changeText(90, 100), changeText(5, 0), changeText(100, 100)], ['↑ 10%', '↓ 10%', '—', '= kỳ trước']);
    assert.deepEqual(reportPeriod('2026-11-05', null), {
      period: { from: '2026-11-01', to: '2026-11-30', label: 'tháng 11/2026', explicit: true },
      asOf: '2026-11-05',
      partial: true,
    });
    assert.equal(reportPeriod('2026-11-05', { y: 2026, m: 10 }).partial, false);
  });

  it('Cloudflare screenshot: đúng URL / token / viewport; trả về không phải ảnh → lỗi', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const ok = new CloudflareScreenshotter('acc1', 'tok1', async (url, init) => {
      seen.push({ url, init });
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    });
    assert.deepEqual([...(await ok.screenshot('<p>x</p>', 1080, 1350))], [1, 2, 3]);
    assert.equal(seen[0]!.url, 'https://api.cloudflare.com/client/v4/accounts/acc1/browser-rendering/screenshot');
    assert.equal((seen[0]!.init.headers as Record<string, string>).authorization, 'Bearer tok1');
    const body = JSON.parse(String(seen[0]!.init.body));
    assert.deepEqual([body.html, body.viewport], ['<p>x</p>', { width: 1080, height: 1350 }]);
    const bad = new CloudflareScreenshotter('a', 't', async () => Response.json({ success: false }, { status: 429 }));
    await assert.rejects(bad.screenshot('x', 1, 1), /Browser Rendering 429/);
  });

  it('Telegram sendPhoto / sendDocument gửi multipart, có protect_content', async () => {
    const forms: FormData[] = [];
    const client = new HttpTelegramClient('T', async (_url, init) => {
      forms.push(init.body as FormData);
      return Response.json({ ok: true });
    });
    await client.sendPhoto(1, new Uint8Array([9]), 'c'.repeat(2000));
    await client.sendDocument(1, 'a.html', new TextEncoder().encode('<p>'), 'text/html');
    assert.ok(forms[0] instanceof FormData);
    assert.equal(String(forms[0]!.get('caption')).length, 1024);
    assert.equal(forms[0]!.get('protect_content'), 'true');
    assert.equal((forms[1]!.get('document') as File).name, 'a.html');
  });
});

for (const backend of BACKENDS) {
  describe(`Phase 6 — báo cáo tháng qua webhook + cron [${backend.name}]`, () => {
    let env: TestEnv;
    let h: BotHarness;

    async function say(from: number, text: string): Promise<SentCall[]> {
      await h.text(from, text);
      return h.tg.take();
    }
    const of = (calls: SentCall[], chatId: number, method: SentCall['method']) => calls.filter((c) => c.chatId === chatId && c.method === method);

    beforeEach(async () => {
      env = await backend.open();
      h = createHarness(env.db);
      await seedInitial(env, 50_000_000, 30_000_000, 20_000_000); // từ 01/11
      h.setNow('2026-11-03T03:00:00.000Z');
      await say(VO, 'tiền ăn 1tr');
      await say(VO, 'mua <b>đồ</b> chơi cho con 300k');
      await say(CHONG, 'lương 20tr');
      await say(CHONG, 'lấy quỹ chung đi chợ 500k');
      await say(VO, 'bỏ hũ 2tr');
      await say(VO, 'mua vàng 1 chỉ 14tr');
      h.setNow('2026-11-05T03:00:00.000Z');
    });
    afterEach(async () => {
      await env.close();
    });

    it('/baocao: ảnh + file HTML cho người gõ; số khớp /thang; HTML đã escape', async () => {
      const calls = await say(VO, '/baocao');
      assert.match(sentTo(calls, VO)[0]?.text ?? '', /^⏳ Đang tạo báo cáo tháng này/);
      const photo = of(calls, VO, 'photo')[0];
      assert.match(photo?.caption ?? '', /^📊 Tháng 11\/2026 \(đến hôm nay\): thu 20\.000\.000đ · chi 1\.800\.000đ · chênh lệch 18\.200\.000đ/);
      const doc = of(calls, VO, 'document')[0];
      assert.equal(doc?.filename, 'bao-cao-2026-11.html');
      const html = doc?.text ?? '';
      assert.match(html, /Content-Security-Policy/);
      assert.doesNotMatch(html, /<b>đồ<\/b>|<script/);
      assert.match(html, /mua &lt;b&gt;đồ&lt;\/b&gt; chơi/);
      assert.match(html, /Trong đó chi từ quỹ chung: 500\.000đ/);
      assert.match(html, /trong đó mua vàng 14\.000\.000đ/);
      assert.match(html, /Tổng tài sản \(chưa trừ nợ\)/);
      assert.equal(of(calls, CHONG, 'photo').length, 0); // chỉ người gõ
      assert.equal(h.shooter.shots.length, 1);
      // Cùng số với /thang
      const month = sentTo(await say(VO, '/thang'), VO)[0]?.text ?? '';
      assert.match(month, /• Thu: 20\.000\.000đ · 1 khoản\n• Chi: 1\.800\.000đ · 3 khoản/);
    });

    it('số liệu đủ: tổng các dòng (danh mục / người / đối tượng) = tổng chi; mọi khoản có mặt', async () => {
      const r = await new ReportService(env.db, { now: () => new Date('2026-11-05T03:00:00.000Z') }).build(
        reportPeriod('2026-11-05', null).period,
        '2026-11-05',
        true,
      );
      const sum = (g: Array<{ total: number }>) => g.reduce((s, x) => s + x.total, 0);
      assert.equal(r.chi, 1_800_000);
      assert.deepEqual([sum(r.chiTheoDanhMuc), sum(r.chiTheoNguoi), sum(r.chiTheoDoiTuong)], [r.chi, r.chi, r.chi]);
      assert.equal(r.rows.length, 4);
      assert.equal(r.compare.period.from, '2026-10-01');
      assert.equal(r.compare.period.to, '2026-10-05');
    });

    it('chụp ảnh lỗi (hết lượt Browser Rendering) → tin chữ thay ảnh, vẫn có file', async () => {
      h.shooter.fail = new Error('Browser Rendering 429');
      const calls = await say(VO, '/baocao');
      assert.equal(of(calls, VO, 'photo').length, 0);
      assert.ok(sentTo(calls, VO).some((c) => /^📊 Báo cáo Tháng 11\/2026[\s\S]*Chưa tạo được ảnh/.test(c.text ?? '')));
      assert.equal(of(calls, VO, 'document').length, 1);
    });

    it('code review: dựng lỗi → báo lỗi; "/baocao 12" trong tháng 1 = năm trước; hết 3 lần thì thôi gửi lại', async () => {
      h.db.fail = (sql) => (/FROM giao_dich g/.test(sql) ? new Error('boom') : null);
      assert.ok(sentTo(await say(VO, '/baocao'), VO).some((c) => /Tạo báo cáo lỗi/.test(c.text ?? '')));
      h.db.fail = null;
      h.setNow('2027-01-02T03:00:00.000Z');
      assert.match(sentTo(await say(VO, '/baocao 12'), VO)[0]?.text ?? '', /^⏳ Đang tạo báo cáo tháng 12\/2026/);
      h.tg.take();
      h.setNow('2026-12-01T01:00:00.000Z');
      h.tg.failFor.set(CHONG, new TelegramApiError('sendPhoto', 403, 'blocked'));
      for (let hour = 1; hour <= 5; hour += 1) {
        h.setNow(`2026-12-01T0${hour}:00:00.000Z`);
        await h.cron(REPORT_CRON);
      }
      const row = await env.db.queryOne<{ trang_thai: string; so_lan: unknown }>(`SELECT trang_thai, so_lan FROM bao_cao_da_gui WHERE thanh_vien_id = 'CHONG'`);
      assert.deepEqual([row?.trang_thai, Number(row?.so_lan)], ['LOI', 3]);
    });

    it('/baocao trước, tháng sai, tháng chưa tới', async () => {
      assert.match(of(await say(VO, '/baocao trước'), VO, 'document')[0]?.filename ?? '', /bao-cao-2026-10\.html/);
      assert.match(sentTo(await say(VO, '/baocao 13'), VO)[0]?.text ?? '', /^Tháng không hợp lệ/);
      assert.match(sentTo(await say(VO, '/baocao 12/2026'), VO)[0]?.text ?? '', /^Tháng chưa tới/);
      assert.match(sentTo(await say(VO, '/baocao abc'), VO)[0]?.text ?? '', /^Chưa hiểu "abc"/);
    });

    it('cron ngày 1: gửi cả 2 người tháng trước, 1 lần; chụp 1 ảnh; người lỗi được gửi lại giờ sau', async () => {
      h.setNow('2026-12-01T01:00:00.000Z'); // 08:00 VN
      h.tg.failFor.set(CHONG, new TelegramApiError('sendPhoto', 500, 'boom'));
      await h.cron(REPORT_CRON);
      let calls = h.tg.take();
      assert.equal(of(calls, VO, 'photo').length, 1);
      assert.equal(of(calls, VO, 'document')[0]?.filename, 'bao-cao-2026-11.html');
      assert.equal(h.shooter.shots.length, 1);
      // Chạy lại giờ sau: vợ đã nhận → không gửi; chồng lỗi → gửi lại
      h.tg.failFor.clear();
      h.setNow('2026-12-01T02:00:00.000Z');
      await h.cron(REPORT_CRON);
      calls = h.tg.take();
      assert.equal(of(calls, VO, 'photo').length + of(calls, VO, 'document').length, 0);
      assert.equal(of(calls, CHONG, 'document').length, 1);
      await h.cron(REPORT_CRON);
      assert.equal(h.tg.take().length, 0);
      const rows = await env.db.query<{ trang_thai: string; so_lan: unknown }>(`SELECT trang_thai, so_lan FROM bao_cao_da_gui ORDER BY thanh_vien_id`);
      assert.deepEqual(rows.map((r) => [r.trang_thai, Number(r.so_lan)]), [['DA_GUI', 2], ['DA_GUI', 1]]);
      // Cron job hết hạn (lịch khác) không gửi báo cáo
      await h.cron();
      assert.equal(h.tg.take().filter((c) => c.method === 'document').length, 0);
    });
  });
}
