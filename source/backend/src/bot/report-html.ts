import type { MoneyHolderId } from '../config/constants.ts';
import type { GroupTotal } from '../db/repositories/index.ts';
import type { ReportData } from '../services/report-service.ts';
import { goldValue } from '../services/savings-service.ts';
import { assetText, formatDay, formatGold, formatMoney, goldPriceLine, holderName, memberName } from './replies.ts';

// Phase 6: báo cáo tháng. summaryCardHtml → chụp thành ảnh (1080×1350); fullReportHtml → file gửi kèm.
// Mọi chữ lấy từ dữ liệu đi qua esc(). Không JS, không tải gì từ ngoài (trừ font của trang chụp ảnh — trang này không gửi cho người dùng).

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
const TOP_CATEGORIES = 5;
const HOLDERS: MoneyHolderId[] = ['VO', 'CHONG', 'QUY_CHUNG', 'CHUA_XAC_DINH'];
const TYPE_NAME: Record<string, string> = { THU: 'Thu', CHI: 'Chi', PHI: 'Phí', LAI_VAY: 'Lãi vay' };

// Escape cho cả nội dung lẫn thuộc tính; bỏ ký tự điều khiển
export function esc(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function categoryLabel(g: GroupTotal): string {
  return g.label ?? (TYPE_NAME[g.loai] && g.loai !== 'CHI' && g.loai !== 'THU' ? TYPE_NAME[g.loai]! : 'Chưa phân loại');
}

function fullDay(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

// "↑ 12%" / "↓ 8%" / "—" (kỳ trước = 0)
export function changeText(cur: number, prev: number): string {
  if (prev === 0) return '—';
  const pct = Math.round(((cur - prev) * 100) / prev);
  return pct === 0 ? '= kỳ trước' : `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}%`;
}

function periodLine(d: ReportData): string {
  return `${formatDay(d.period.from)}–${formatDay(d.period.to)}${d.partial ? ' (đến hôm nay)' : ''}`;
}

function compareLabel(d: ReportData): string {
  return `${formatDay(d.compare.period.from)}–${formatDay(d.compare.period.to)}`;
}

// Tổng tài sản cuối kỳ (tiền mặt + hũ + vàng đã định giá), chưa trừ nợ; null = chưa có số dư
function totalAssets(d: ReportData): number | null {
  return d.balances.status === 'OK' ? d.balances.tong + d.savings.tien + (d.savings.vangGiaTri ?? 0) : null;
}

// ---------- Chữ: chú thích ảnh + tin dự phòng khi không chụp được ảnh ----------

export function reportCaption(d: ReportData): string {
  return `📊 ${d.title}${d.partial ? ' (đến hôm nay)' : ''}: thu ${formatMoney(d.thu)} · chi ${formatMoney(d.chi)} · chênh lệch ${formatMoney(d.thu - d.chi)}. Chi tiết trong file HTML.`;
}

export function reportFallbackText(d: ReportData): string {
  const top = d.chiTheoDanhMuc.slice(0, TOP_CATEGORIES).map((g) => `${categoryLabel(g)} ${formatMoney(g.total)}`);
  const lines = [
    `📊 Báo cáo ${d.title} (${periodLine(d)})`,
    `• Thu: ${formatMoney(d.thu)}`,
    `• Chi: ${formatMoney(d.chi)} (${changeText(d.chi, d.compare.chi)} so với ${compareLabel(d)})`,
    `• Chênh lệch: ${formatMoney(d.thu - d.chi)}`,
    ...(top.length ? [`Chi nhiều nhất: ${top.join(' · ')}`] : []),
  ];
  const assets = totalAssets(d);
  if (d.balances.status === 'OK' && assets !== null) {
    const b = d.balances;
    lines.push(
      `Cuối kỳ: ${HOLDERS.filter((h) => h !== 'CHUA_XAC_DINH' || b.nhom[h] !== 0).map((h) => `${holderName(h)} ${formatMoney(b.nhom[h])}`).join(' · ')}`,
      `Hũ: ${assetText(d.savings.tien, d.savings.vangPhan, d.savings.vangGiaTri)}`,
      `Tổng tài sản (chưa trừ nợ): ${formatMoney(assets)}`,
    );
  }
  lines.push('(Chưa tạo được ảnh — xem file HTML để có đủ bảng.)');
  return lines.join('\n');
}

// ---------- Trang tóm tắt để chụp ảnh ----------

function bars(groups: GroupTotal[], max: number): string {
  return groups
    .map((g) => {
      const w = max > 0 ? Math.max(2, Math.round((g.total * 100) / max)) : 0;
      return `<div class="bar"><div class="bl"><span>${esc(categoryLabel(g))}</span><b>${esc(formatMoney(g.total))}</b></div><div class="track"><div class="fill" style="width:${w}%"></div></div></div>`;
    })
    .join('');
}

export function summaryCardHtml(d: ReportData): string {
  const top = d.chiTheoDanhMuc.slice(0, TOP_CATEGORIES);
  const max = top[0]?.total ?? 0;
  const diff = d.thu - d.chi;
  const b = d.balances;
  const assets = totalAssets(d);
  const balance =
    b.status === 'OK'
      ? `<div class="row3${b.nhom.CHUA_XAC_DINH !== 0 ? ' four' : ''}">${HOLDERS.filter((h) => h !== 'CHUA_XAC_DINH' || b.nhom[h] !== 0)
          .map((h) => `<div><small>${esc(holderName(h))}</small><b class="${b.nhom[h] < 0 ? 'neg' : ''}">${esc(formatMoney(b.nhom[h]))}</b></div>`)
          .join('')}</div>
        <p class="line">Hũ: ${esc(assetText(d.savings.tien, d.savings.vangPhan, d.savings.vangGiaTri))}</p>
        <p class="total">Tổng tài sản ≈ ${esc(formatMoney(assets ?? 0))} <small>(chưa trừ nợ)</small></p>`
      : `<p class="line">Chưa có số dư cho kỳ này.</p>`;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<!-- display=swap: chữ hiện ngay bằng font hệ thống; display=block làm chữ ẩn tới khi font tải xong → ảnh chụp mất chữ (11/11) -->
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700&amp;display=swap">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${CARD_WIDTH}px;height:${CARD_HEIGHT}px;overflow:hidden}
body{font-family:'Be Vietnam Pro','Noto Sans','DejaVu Sans','Liberation Sans',Arial,sans-serif;background:#f4f6f8;color:#1c2430;padding:56px 64px}
h1{font-size:60px;font-weight:700}
.sub{font-size:30px;color:#5b6675;margin:6px 0 32px}
.kpi{display:flex;gap:20px;margin-bottom:36px}
.kpi div{flex:1;min-width:0;background:#fff;border-radius:24px;padding:22px 20px}
.kpi small,.row3 small{display:block;font-size:28px;color:#5b6675}
.kpi b{display:block;font-size:36px;margin-top:6px;white-space:nowrap}
.kpi i{display:block;font-style:normal;font-size:26px;color:#5b6675;margin-top:4px}
.thu{color:#16794c}.chi{color:#b3261e}.neg{color:#b3261e}
h2{font-size:34px;margin:0 0 18px;color:#334155}
.card{background:#fff;border-radius:24px;padding:28px 30px;margin-bottom:28px}
.bar{margin-bottom:16px}
.bl{display:flex;justify-content:space-between;gap:16px;font-size:32px;margin-bottom:8px}
.bl span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bl b{white-space:nowrap}
.track{height:20px;background:#e8ecf1;border-radius:10px}
.fill{height:20px;background:#3867d6;border-radius:10px}
.row3{display:flex;gap:18px;margin-bottom:16px}
.row3 div{flex:1;min-width:0}
.row3 b{display:block;font-size:38px;white-space:nowrap}
.row3.four b{font-size:30px}
.line{font-size:32px;margin-bottom:10px}
.total{font-size:40px;font-weight:700}
.total small{font-size:26px;font-weight:400;color:#5b6675}
.empty{font-size:32px;color:#5b6675}
</style></head><body>
<h1>Báo cáo ${esc(d.title)}</h1>
<p class="sub">${esc(periodLine(d))} · so với ${esc(compareLabel(d))}</p>
<div class="kpi">
<div><small>Thu</small><b class="thu">${esc(formatMoney(d.thu))}</b><i>${esc(changeText(d.thu, d.compare.thu))}</i></div>
<div><small>Chi</small><b class="chi">${esc(formatMoney(d.chi))}</b><i>${esc(changeText(d.chi, d.compare.chi))}</i></div>
<div><small>Chênh lệch</small><b class="${diff < 0 ? 'neg' : ''}">${esc(formatMoney(diff))}</b><i>${d.soKhoan} khoản</i></div>
</div>
<div class="card"><h2>Chi nhiều nhất</h2>${top.length ? bars(top, max) : '<p class="empty">Chưa có khoản chi.</p>'}</div>
<div class="card"><h2>Cuối kỳ (${esc(formatDay(d.asOf))})</h2>${balance}</div>
</body></html>`;
}

// ---------- File HTML đầy đủ ----------

function table(head: string[], rows: string[][], cls = ''): string {
  if (rows.length === 0) return '<p class="muted">Không có.</p>';
  const th = head.map((h) => `<th>${esc(h)}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table class="${cls}"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

const m = (n: number): string => esc(formatMoney(n));

function groupRows(groups: GroupTotal[], total: number, label: (g: GroupTotal) => string, prev?: Map<string, number>): string[][] {
  return groups.map((g) => {
    const pct = total > 0 ? Math.round((g.total * 1000) / total) / 10 : 0;
    const row = [
      esc(label(g)),
      `<span class="num">${m(g.total)}</span><div class="mini"><div style="width:${Math.max(1, Math.round(pct))}%"></div></div>`,
      `${pct.toString().replace('.', ',')}%`,
      String(g.count),
    ];
    if (prev) {
      const key = `${g.key ?? ''}|${g.loai}`;
      const before = prev.get(key) ?? 0;
      row.push(m(before), esc(changeText(g.total, before)));
    }
    return row;
  });
}

export function fullReportHtml(d: ReportData): string {
  const prevDm = new Map(d.compare.chiTheoDanhMuc.map((g) => [`${g.key ?? ''}|${g.loai}`, g.total]));
  const b = d.balances;
  const assets = totalAssets(d);
  const balanceSection =
    b.status === 'OK'
      ? table(
          ['Nhóm', 'Số dư'],
          [
            ...HOLDERS.filter((h) => h !== 'CHUA_XAC_DINH' || b.nhom[h] !== 0).map((h) => [esc(holderName(h)), `<span class="${b.nhom[h] < 0 ? 'neg' : ''}">${m(b.nhom[h])}</span>`]),
            ['<b>Tiền mặt</b>', `<b>${m(b.tong)}</b>`],
            ['Hũ tiết kiệm', esc(assetText(d.savings.tien, d.savings.vangPhan, d.savings.vangGiaTri))],
            ['<b>Tổng tài sản (chưa trừ nợ)</b>', `<b>${m(assets ?? 0)}</b>`],
          ],
        ) +
        (d.pending.count > 0 ? `<p class="muted">Đang chờ xác nhận chuyển: ${m(d.pending.total)} (${d.pending.count} khoản) — chưa tính vào số dư.</p>` : '')
      : `<p class="muted">Chưa có số dư cho kỳ này${b.ngayApDung ? ` (số dư ban đầu tính từ ${esc(fullDay(b.ngayApDung))})` : ''}.</p>`;
  const shownTien = d.savings.rows.reduce((s, r) => s + r.tien, 0);
  const shownVang = d.savings.rows.reduce((s, r) => s + r.vangPhan, 0);
  const hidden =
    shownTien !== d.savings.tien || shownVang !== d.savings.vangPhan
      ? [[esc('Hũ khác (đã ẩn)'), esc(assetText(d.savings.tien - shownTien, d.savings.vangPhan - shownVang, goldValue(d.savings.vangPhan - shownVang, d.savings.gia))), '—']]
      : [];
  const jars = table(
    ['Hũ', 'Đang có', 'Mục tiêu'],
    [...d.savings.rows.map((r) => {
      const vang = goldValue(r.vangPhan, d.savings.gia);
      const value = r.tien + (vang ?? 0);
      return [
        esc(r.jar.ten),
        esc(assetText(r.tien, r.vangPhan, vang)),
        r.jar.muc_tieu ? `${m(r.jar.muc_tieu)} (${Math.floor((Math.max(value, 0) * 100) / r.jar.muc_tieu)}%)` : '—',
      ];
    }), ...hidden],
  );
  const people = (['VO', 'CHONG'] as const).map((who) => {
    const nop = d.fundMoves.find((f) => f.nhom === who && f.chieu === 'NOP')?.total ?? 0;
    const rut = d.fundMoves.find((f) => f.nhom === who && f.chieu === 'RUT')?.total ?? 0;
    return [esc(memberName(who)), m(nop), m(rut)];
  });
  const rowsTable = table(
    ['Ngày', 'Người', 'Loại', 'Danh mục', 'Số tiền', 'Tin gốc'],
    d.rows.map((r) => [
      esc(formatDay(r.ngay)),
      esc(memberName(r.nguoi_thuc_hien_id)),
      esc(TYPE_NAME[r.loai] ?? r.loai),
      esc(r.danh_muc ?? '—'),
      `<span class="num ${r.loai === 'THU' ? 'thu' : ''}">${r.loai === 'THU' ? '+' : ''}${m(Number(r.so_tien))}</span>`,
      `<span class="muted">${esc((r.mo_ta ?? '').slice(0, 80))}</span>`,
    ]),
    'rows',
  );
  const generated = new Date(Date.parse(d.generatedAt) + 7 * 3_600_000).toISOString();
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>Báo cáo ${esc(d.title)}</title>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans',Arial,sans-serif;margin:0;padding:16px;background:#f4f6f8;color:#1c2430;font-size:15px;line-height:1.45}
main{max-width:900px;margin:0 auto}
h1{font-size:24px;margin:4px 0}
h2{font-size:18px;margin:24px 0 8px}
.muted{color:#5b6675}
.kpi{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}
.kpi div{flex:1 1 160px;background:#fff;border-radius:12px;padding:12px}
.kpi b{display:block;font-size:20px}
.thu{color:#16794c}.chi{color:#b3261e}.neg{color:#b3261e}
section{background:#fff;border-radius:12px;padding:12px 14px;margin-bottom:12px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e5e9ef;vertical-align:top}
th{color:#5b6675;font-weight:600;white-space:nowrap}
.num{white-space:nowrap;font-variant-numeric:tabular-nums}
.mini{height:6px;background:#e8ecf1;border-radius:3px;margin-top:4px;min-width:80px}
.mini div{height:6px;background:#3867d6;border-radius:3px}
.rows td:nth-child(6){min-width:160px}
footer{font-size:12px;color:#5b6675;margin:16px 0}
</style></head><body><main>
<h1>📊 Báo cáo ${esc(d.title)}</h1>
<p class="muted">Kỳ ${esc(periodLine(d))} · so với ${esc(compareLabel(d))} · số liệu đến ${esc(fullDay(d.asOf))}</p>
<div class="kpi">
<div>Thu<b class="thu">${m(d.thu)}</b><span class="muted">${esc(changeText(d.thu, d.compare.thu))} · kỳ trước ${m(d.compare.thu)}</span></div>
<div>Chi<b class="chi">${m(d.chi)}</b><span class="muted">${esc(changeText(d.chi, d.compare.chi))} · kỳ trước ${m(d.compare.chi)}</span></div>
<div>Chênh lệch<b class="${d.thu - d.chi < 0 ? 'neg' : ''}">${m(d.thu - d.chi)}</b><span class="muted">${d.soKhoan} khoản</span></div>
</div>
<section><h2>Chi theo danh mục</h2>${table(['Danh mục', 'Số tiền', '%', 'Khoản', 'Kỳ trước', 'So sánh'], groupRows(d.chiTheoDanhMuc, d.chi, categoryLabel, prevDm))}</section>
<section><h2>Thu theo danh mục</h2>${table(['Danh mục', 'Số tiền', '%', 'Khoản'], groupRows(d.thuTheoDanhMuc, d.thu, categoryLabel))}</section>
<section><h2>Chi theo người</h2>${table(['Người', 'Số tiền', '%', 'Khoản'], groupRows(d.chiTheoNguoi, d.chi, (g) => memberName(g.key ?? '')))}
<p class="muted">Trong đó chi từ quỹ chung: ${m(d.chiTuQuyChung)}</p></section>
<section><h2>Chi cho ai</h2>${table(['Đối tượng', 'Số tiền', '%', 'Khoản'], groupRows(d.chiTheoDoiTuong, d.chi, (g) => g.label ?? 'Không ghi đối tượng'))}</section>
<section><h2>Số dư cuối kỳ (${esc(fullDay(d.asOf))})</h2>${balanceSection}</section>
<section><h2>Hũ tiết kiệm</h2>${jars}
<p class="muted">Trong kỳ: bỏ vào ${m(d.savingsFlows.nop)} (${d.savingsFlows.soNop} lần) · lấy ra ${m(d.savingsFlows.rut)} (${d.savingsFlows.soRut} lần)${
    d.goldFlows.soNop + d.goldFlows.soRut > 0 ? ` · trong đó mua vàng ${m(d.goldFlows.nop)}, bán vàng ${m(d.goldFlows.rut)}` : ''
  }${d.savings.vangPhan !== 0 ? ` · vàng đang có ${esc(formatGold(d.savings.vangPhan))}` : ''}</p>
${goldPriceLine(d.savings.vangPhan !== 0 ? d.savings.gia : null).map((l) => `<p class="muted">${esc(l)}</p>`).join('')}</section>
<section><h2>Chuyển tiền trong kỳ${d.transfersTruncated ? ' (chỉ hiện các khoản mới nhất)' : ''}</h2>${table(
    ['Ngày', 'Từ', 'Đến', 'Số tiền'],
    d.transfers.map((t) => [esc(formatDay(t.ngay_chuyen)), esc(memberName(t.nguoi_chuyen_id)), esc(memberName(t.nguoi_nhan_id)), m(t.so_tien)]),
  )}
<h2>Quỹ chung trong kỳ</h2>${table(['Người', 'Nộp vào', 'Rút ra'], people)}</section>
<section><h2>Mọi khoản thu / chi (${d.rows.length}${d.rowsTruncated ? '+, chỉ hiện các khoản mới nhất' : ''})</h2>${rowsTable}</section>
<footer>Tạo lúc ${esc(fullDay(generated.slice(0, 10)))} ${esc(generated.slice(11, 16))} (giờ VN) · FamilyFinance · Thu = THU; Chi = Chi + Phí + Lãi vay; chuyển tiền, quỹ chung, hũ, vay / trả nợ không tính vào thu / chi.</footer>
</main></body></html>`;
}
