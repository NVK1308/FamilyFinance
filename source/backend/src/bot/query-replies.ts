import type { GroupTotal, TxRow } from '../db/repositories/index.ts';
import { ALL_TIME_FROM, type Period } from '../query/period-parser.ts';
import type { QuerySpec } from '../query/types.ts';
import { FULL_LIST_DAYS, FULL_LIST_LIMIT, MAX_GROUPS, type QueryAnswer, type Sum } from '../services/query-service.ts';
import { addDaysToIsoDate } from '../parser/date-parser.ts';
import { assetText, balanceSummaryLines, formatDay, formatMoney, goldPriceLine, holderName, jarListLines, memberName } from './replies.ts';

const TYPE_NAME: Record<string, string> = { LAI_VAY: 'Lãi vay', PHI: 'Phí' };

export const QUERY_HELP = [
  'Chưa hiểu câu hỏi. Thử hỏi kiểu:',
  '• tháng này vợ chi bao nhiêu',
  '• chi tiền học năm nay',
  '• gia đình còn bao nhiêu',
  '• chi theo danh mục tháng trước',
  '• tiết kiệm được bao nhiêu',
  'Hoặc dùng /sodu, /thang.',
].join('\n');

export const NO_TEXT = 'Chưa hỗ trợ thống kê nợ — xem ghi chú nợ: /ghichu';
export const RECORD_HINT = "Muốn ghi khoản này thì nhắn không kèm từ hỏi, vd 'lương 10tr'.";

// Bot không huỷ / sửa theo tin chữ — chỉ qua nút
export const ACTION_HELP = [
  'Bot không huỷ / sửa theo tin nhắn chữ. Cách làm:',
  '• Khoản đã ghi: bấm nút "Huỷ" dưới tin ✅ của khoản đó (chỉ người ghi huỷ được), rồi nhắn lại nếu cần.',
  '• Chuyển tiền đang chờ: gõ /cho — người chuyển bấm "Huỷ chuyển", người nhận bấm "Đã nhận" / "Chưa nhận".',
  '• Sửa tin đã gửi không đổi bản ghi — huỷ rồi nhắn lại.',
].join('\n');

const REMIND_TEXT: Record<string, string> = {
  THAO_TAC: ACTION_HELP,
  HOI_HAY_GHI: "Chưa ghi — tin này giống câu hỏi. Muốn ghi thì nhắn rõ, không kèm '?', vd 'tiền ăn 50k'.",
  SO_DU_DUNG_LENH: 'Chưa ghi. Nhập số dư ban đầu: /sodudau; xem số dư: /sodu.',
};

export function remindText(reason: string | null): string | null {
  return reason ? (REMIND_TEXT[reason] ?? null) : null;
}

function periodText(p: Period): string {
  // Kỳ "mọi lúc" (allTimePeriod) chỉ hiện nhãn
  return p.from === p.to || p.from === ALL_TIME_FROM || p.label.includes('–') ? p.label : `${p.label} (${formatDay(p.from)}–${formatDay(p.to)})`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "Vợ chi tiền học cho con gái từ quỹ chung"
function subject(spec: QuerySpec, verb: string): string {
  const parts = [spec.performer ? `${memberName(spec.performer)} ${verb}` : capitalize(verb)];
  if (spec.categories) parts.push(spec.categories.label);
  if (spec.beneficiaries) parts.push(`cho ${spec.beneficiaries.label}`);
  if (spec.holder === 'QUY_CHUNG') parts.push('từ quỹ chung');
  return parts.join(' ');
}

function sumText(s: Sum): string {
  return s.count === 0 ? '0đ (chưa có khoản nào)' : `${formatMoney(s.total)} · ${s.count} khoản`;
}

function groupLabel(g: GroupTotal, empty: string): string {
  return g.label ?? TYPE_NAME[g.loai] ?? empty;
}

function beneficiaryNote(spec: QuerySpec): string[] {
  return spec.beneficiaries ? [`(Chỉ tính khoản có ghi rõ cho ${spec.beneficiaries.label}.)`] : [];
}

function totalLines(a: Extract<QueryAnswer, { kind: 'TONG' }>): string[] {
  const { spec } = a;
  const when = periodText(spec.period);
  if (spec.measure === 'THU' || spec.measure === 'CHI') {
    const s = (spec.measure === 'THU' ? a.thu : a.chi)!;
    const lines = [`📊 ${subject(spec, spec.measure === 'THU' ? 'thu' : 'chi')} · ${when}: ${sumText(s)}`];
    if (a.topDanhMuc.length > 1) {
      lines.push(`• ${a.topDanhMuc.map((g) => `${groupLabel(g, 'Chưa phân loại')} ${formatMoney(g.total)}`).join(' · ')}`);
    }
    if (a.chiTuQuyChung) {
      lines.push(`Trong đó từ quỹ chung: ${formatMoney(a.chiTuQuyChung)}`);
    }
    return [...lines, ...beneficiaryNote(spec)];
  }
  const thu = a.thu!;
  const chi = a.chi!;
  if (spec.measure === 'CHENH_LECH') {
    const who = spec.performer ? ` (${memberName(spec.performer).toLowerCase()})` : '';
    return [
      `💰 Tiết kiệm${who} · ${when}: ${formatMoney(thu.total - chi.total)}`,
      `Thu ${formatMoney(thu.total)} − Chi ${formatMoney(chi.total)}`,
      ...beneficiaryNote(spec),
    ];
  }
  const head = spec.performer || spec.categories || spec.beneficiaries || spec.holder ? `${subject(spec, 'thu/chi')} · ` : '';
  const lines = [
    `📅 ${head}${capitalize(when)}:`,
    `• Thu: ${sumText(thu)}`,
    `• Chi: ${sumText(chi)}`,
    `• Chênh lệch: ${formatMoney(thu.total - chi.total)}`,
  ];
  if (a.chiTuQuyChung) {
    lines.push(`Chi từ quỹ chung: ${formatMoney(a.chiTuQuyChung)}`);
  }
  return [...lines, ...beneficiaryNote(spec)];
}

function balanceLines(a: Extract<QueryAnswer, { kind: 'SO_DU' }>): string[] {
  const b = a.balances;
  if (b.status === 'CHUA_CO_SO_DU_BAN_DAU') {
    return ['Chưa nhập số dư ban đầu. Gõ: /sodudau vợ 5tr chồng 3tr quỹ 2tr'];
  }
  if (b.status !== 'OK') {
    return [`Chưa có số dư tại ${formatDay(a.asOf)} — số dư ban đầu tính từ ${b.ngayApDung ? formatDay(b.ngayApDung) : '?'}.`];
  }
  const holder = a.spec.holder;
  const lines = holder
    ? [`💰 ${holderName(holder)} đến ${formatDay(a.asOf)}: ${formatMoney(b.nhom[holder])}`]
    : balanceSummaryLines(b.nhom, b.tong, a.asOf, a.hu ?? { tien: 0, vangPhan: 0, vangGiaTri: null });
  if (a.dangChoChuyen && a.dangChoChuyen.count > 0) {
    lines.push(`⏳ Đang chờ xác nhận chuyển: ${formatMoney(a.dangChoChuyen.total)} (${a.dangChoChuyen.count} khoản) — chưa tính vào số dư.`);
  }
  return lines;
}

function groupLines(a: Extract<QueryAnswer, { kind: 'THEO_DANH_MUC' | 'THEO_DOI_TUONG' }>): string[] {
  const { spec } = a;
  const by = a.kind === 'THEO_DANH_MUC' ? 'theo danh mục' : 'theo đối tượng';
  const head = `📊 ${subject(spec, spec.measure === 'THU' ? 'thu' : 'chi')} ${by} · ${periodText(spec.period)}: ${sumText(a.tong)}`;
  const empty = a.kind === 'THEO_DANH_MUC' ? 'Chưa phân loại' : 'Không ghi đối tượng';
  const rows = a.nhom.slice(0, MAX_GROUPS).map((g) => `• ${groupLabel(g, empty)}: ${formatMoney(g.total)} (${g.count})`);
  if (a.nhom.length > MAX_GROUPS) {
    rows.push(`… còn ${a.nhom.length - MAX_GROUPS} nhóm nữa`);
  }
  return [head, ...rows, ...beneficiaryNote(spec)];
}

// ---------- 5b-2 ----------

const OTHER_CATEGORIES = new Set(['CHI_KHAC', 'THU_KHAC']);

function shorten(text: string | null, max = 30): string {
  const t = (text ?? '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// Nhãn danh mục của 1 giao dịch (khoản không danh mục: theo loại)
function rowLabel(r: TxRow): string {
  return r.danh_muc ?? TYPE_NAME[r.loai] ?? 'Chưa phân loại';
}

// Danh mục Khác / không danh mục → kèm nội dung tin để biết là khoản gì
function rowNote(r: TxRow): string {
  return !r.ma_danh_muc || OTHER_CATEGORIES.has(r.ma_danh_muc) ? ` — ${shorten(r.mo_ta)}` : '';
}

// "05/11 1.000.000đ Học phí (Vợ)"
function itemLine(r: TxRow, index?: number): string {
  const sign = r.loai === 'THU' ? '+' : '';
  const prefix = index === undefined ? '•' : `${index}.`;
  return `${prefix} ${formatDay(r.ngay)} ${sign}${formatMoney(r.so_tien)} ${rowLabel(r)} (${memberName(r.nguoi_thuc_hien_id)})${rowNote(r)}`;
}

function verbOf(spec: QuerySpec): string {
  return spec.measure === 'THU' ? 'thu' : spec.measure === 'CHI' ? 'chi' : 'thu/chi';
}

// dd/mm, thêm /yyyy khi khác năm hiện tại của kỳ hỏi (để câu gợi ý hỏi lại đúng năm)
function dayForHint(date: string, refYear: string): string {
  return date.slice(0, 4) === refYear ? formatDay(date) : `${formatDay(date)}/${date.slice(0, 4)}`;
}

// Câu gợi ý hỏi tiếp, giữ đủ bộ lọc: "liệt kê chi tiết vợ chi tiền ăn từ …"
function listHint(spec: QuerySpec, when: string): string {
  const s = subject(spec, verbOf(spec));
  return `liệt kê chi tiết ${s.charAt(0).toLowerCase()}${s.slice(1)} ${when}`;
}

function itemLines(a: Extract<QueryAnswer, { kind: 'LON_NHAT' | 'LIET_KE' }>, today: string): string[] {
  const { spec } = a;
  const when = periodText(spec.period);
  if (a.kind === 'LON_NHAT') {
    const head = `🔝 Khoản ${subject(spec, verbOf(spec)).toLowerCase()} lớn nhất · ${when}:`;
    return a.rows.length === 0
      ? [`${head} chưa có khoản nào`]
      : [head, ...a.rows.map((r, i) => itemLine(r, i + 1)), ...beneficiaryNote(spec)];
  }
  // Thu và chi ghi riêng, không cộng lẫn
  const total =
    a.count === 0
      ? '0đ (chưa có khoản nào)'
      : spec.measure === 'THU'
        ? `${formatMoney(a.thu)} · ${a.count} khoản`
        : spec.measure === 'CHI'
          ? `${formatMoney(a.chi)} · ${a.count} khoản`
          : `thu ${formatMoney(a.thu)}, chi ${formatMoney(a.chi)} · ${a.count} khoản`;
  const head = `📋 ${subject(spec, verbOf(spec))} · ${a.shown?.capped ? periodText(a.shown.period) : when}: ${total}`;
  const top: string[] = [];
  const notes: string[] = [];
  const refYear = today.slice(0, 4);
  if (a.shown && a.count > a.rows.length) {
    // Chạm giới hạn 300: nói rõ danh sách bắt đầu từ ngày nào; tổng nhóm bên dưới chỉ gồm các khoản hiện ra
    const oldest = a.rows.reduce((m, r) => (r.ngay < m ? r.ngay : m), a.rows[0]?.ngay ?? spec.period.from);
    top.push(`⚠️ Chỉ hiện ${a.rows.length} khoản mới nhất (từ ${formatDay(oldest)}); số theo nhóm bên dưới chỉ tính các khoản này.`);
  }
  if (a.shown?.capped) {
    // Chỉ cắt trong kỳ đã chọn: hiện 31 ngày cuối kỳ, chỉ rõ phần đầu kỳ chưa hiện
    const restTo = addDaysToIsoDate(a.shown.period.from, -1);
    const rest = `từ ${dayForHint(spec.period.from, refYear)} đến ${dayForHint(restTo, refYear)}`;
    notes.push(`(Kỳ dài hơn ${FULL_LIST_DAYS} ngày: chỉ hiện ${FULL_LIST_DAYS} ngày cuối kỳ. Phần còn lại hỏi: "${listHint(spec, rest)}")`);
  }
  if (!a.shown && a.count > a.rows.length) {
    const range = `từ ${dayForHint(spec.period.from, refYear)} đến ${dayForHint(spec.period.to, refYear)}`;
    notes.push(`… còn ${a.count - a.rows.length} khoản cũ hơn. Xem đủ: "${listHint(spec, range)}"`);
  }
  const body = a.shown ? groupedItemLines(a.rows) : a.rows.map((r) => itemLine(r));
  return [head, ...top, ...body, ...notes, ...beneficiaryNote(spec)];
}

// Gom theo khoá, giữ thứ tự xuất hiện
function groupBy<K>(list: readonly TxRow[], key: (r: TxRow) => K): Map<K, TxRow[]> {
  const map = new Map<K, TxRow[]>();
  for (const r of list) {
    const k = key(r);
    const bucket = map.get(k);
    if (bucket) bucket.push(r);
    else map.set(k, [r]);
  }
  return map;
}

function sumOf(list: readonly TxRow[]): number {
  return list.reduce((s, r) => s + r.so_tien, 0);
}

// Liệt kê chi tiết: người → Thu/Chi → danh mục (lớn → nhỏ) → từng ngày (cũ → mới, cùng ngày theo thứ tự ghi)
//   👤 Vợ
//     Chi: 2.200.000đ
//       Thức ăn: 2.000.000đ
//         • 11/01: 2.000.000đ
function groupedItemLines(rows: readonly TxRow[]): string[] {
  // rows đến theo mới → cũ (ngày, rồi thời điểm ghi) → đảo lại rồi sắp ổn định theo ngày
  const ordered = [...rows].reverse().sort((x, y) => x.ngay.localeCompare(y.ngay));
  const personOrder = (p: string) => (p === 'VO' ? 0 : p === 'CHONG' ? 1 : 2);
  const lines: string[] = [];
  const people = [...groupBy(ordered, (r) => r.nguoi_thuc_hien_id)].sort(([a], [b]) => personOrder(a) - personOrder(b) || a.localeCompare(b));
  for (const [person, personRows] of people) {
    lines.push(`👤 ${memberName(person)}`);
    const sides = [...groupBy(personRows, (r) => (r.loai === 'THU' ? 'Thu' : 'Chi'))].sort(([a]) => (a === 'Thu' ? -1 : 1));
    for (const [side, sideRows] of sides) {
      lines.push(`  ${side}: ${formatMoney(sumOf(sideRows))}`);
      const categories = [...groupBy(sideRows, rowLabel)]
        .map(([name, list]) => ({ name, list, total: sumOf(list) }))
        .sort((x, y) => y.total - x.total || x.name.localeCompare(y.name));
      for (const c of categories) {
        lines.push(`    ${c.name}: ${formatMoney(c.total)}`);
        for (const r of c.list) {
          lines.push(`      • ${formatDay(r.ngay)}: ${formatMoney(r.so_tien)}${rowNote(r)}`);
        }
      }
    }
  }
  return lines;
}

// ---------- Lệnh tắt /tuan, /thang ----------

const SUMMARY_TOP = 5;

// Một tin tổng hợp kỳ: Thu / Chi (số khoản) / Chênh lệch + danh mục chi lớn + theo người + quỹ chung.
// Khác totalLines (câu hỏi tự do) ở chỗ luôn hiện số khoản và thêm 2 dòng tổng hợp.
export function periodSummaryText(spec: QuerySpec, total: QueryAnswer, byCategory: QueryAnswer, byPerson: QueryAnswer | null, example: string): string {
  if (total.kind !== 'TONG' || byCategory.kind !== 'THEO_DANH_MUC' || (byPerson && byPerson.kind !== 'AI_NHIEU_NHAT')) {
    throw new Error('periodSummaryText: sai loại kết quả');
  }
  const who = spec.performer ? ` · ${memberName(spec.performer)}` : '';
  const count = (s: Sum | null) => `${formatMoney(s?.total ?? 0)} · ${s?.count ?? 0} khoản`;
  const lines = [
    `📊 ${capitalize(periodText(spec.period))}${who}:`,
    `• Thu: ${count(total.thu)}`,
    `• Chi: ${count(total.chi)}`,
    `• Chênh lệch: ${formatMoney((total.thu?.total ?? 0) - (total.chi?.total ?? 0))}`,
  ];
  const top = byCategory.nhom.slice(0, SUMMARY_TOP);
  if (top.length > 0) {
    lines.push(`Chi nhiều nhất: ${top.map((g) => `${groupLabel(g, 'Chưa phân loại')} ${formatMoney(g.total)}`).join(' · ')}`);
  }
  if (byPerson?.kind === 'AI_NHIEU_NHAT' && byPerson.nhom.length > 0) {
    lines.push(`Theo người: ${byPerson.nhom.map((g) => `${memberName(g.key ?? '?')} ${formatMoney(g.total)}`).join(' · ')}`);
  }
  if (total.chiTuQuyChung) {
    lines.push(`Trong đó chi từ quỹ chung: ${formatMoney(total.chiTuQuyChung)}`);
  }
  lines.push(`Xem từng khoản: "${example}"`);
  return lines.join('\n');
}

// Telegram giới hạn 4.096 ký tự / tin → tách theo dòng
export const TELEGRAM_TEXT_MAX = 3_900;

export function splitTelegramText(text: string, max = TELEGRAM_TEXT_MAX): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    const piece = line.length > max ? `${line.slice(0, max - 1)}…` : line;
    if (current && current.length + 1 + piece.length > max) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function whoLines(a: Extract<QueryAnswer, { kind: 'AI_NHIEU_NHAT' }>): string[] {
  const { spec } = a;
  const head = `👥 ${subject(spec, verbOf(spec))} theo người · ${periodText(spec.period)}: ${sumText(a.tong)}`;
  const rows = a.nhom.map((g) => `• ${memberName(g.key ?? '?')}: ${formatMoney(g.total)} (${g.count})`);
  return [head, ...rows, ...beneficiaryNote(spec)];
}

function signed(n: number): string {
  return n > 0 ? `+${formatMoney(n)}` : formatMoney(n);
}

function compareLines(a: Extract<QueryAnswer, { kind: 'SO_SANH' }>): string[] {
  const [x, y] = a.ky;
  const { spec } = a;
  const head = spec.performer || spec.categories || spec.beneficiaries || spec.holder ? `${subject(spec, verbOf(spec))}: ` : '';
  const line = (name: string, vx: number, vy: number): string =>
    `• ${name}: ${formatMoney(vx)} / ${formatMoney(vy)} (chênh ${signed(vx - vy)})`;
  const title = `${head}${periodText(x.period)} so với ${periodText(y.period)}:`;
  const lines = [`📊 ${capitalize(title)}`];
  if (spec.measure !== 'CHI') lines.push(line('Thu', x.thu, y.thu));
  if (spec.measure !== 'THU') lines.push(line('Chi', x.chi, y.chi));
  if (spec.measure === 'TONG_QUAN' || spec.measure === 'CHENH_LECH') {
    lines.push(line('Tiết kiệm', x.thu - x.chi, y.thu - y.chi));
  }
  return [...lines, ...beneficiaryNote(spec)];
}

const TRANSFER_STATE: Record<string, string> = {
  CHO_XAC_NHAN: 'đang chờ',
  DA_XAC_NHAN: 'đã nhận',
  DA_HUY: 'đã huỷ',
  TU_CHOI: 'bị từ chối',
  HET_HAN: 'hết hạn',
};

function transferLines(a: Extract<QueryAnswer, { kind: 'CHUYEN_TIEN' }>): string[] {
  const t = a.spec.transfer!;
  const who = t.from && t.to ? ` ${memberName(t.from)} → ${memberName(t.to)}` : '';
  // Nhiều trạng thái: chỉ cộng khoản đã nhận (khoản huỷ / chờ / hết hạn chưa chuyển thật)
  const total =
    a.daNhan === null || a.tong.count === 0 ? sumText(a.tong) : `${a.tong.count} khoản, đã nhận ${formatMoney(a.daNhan)}`;
  const head = `💸 Chuyển tiền${who} (${t.label}) · ${periodText(a.spec.period)}: ${total}`;
  const rows = a.rows.map(
    (r) => `• ${formatDay(r.ngay_chuyen)} ${memberName(r.nguoi_chuyen_id)} → ${memberName(r.nguoi_nhan_id)} ${formatMoney(r.so_tien)} (${TRANSFER_STATE[r.trang_thai] ?? r.trang_thai})`,
  );
  const more = t.list && a.tong.count > a.rows.length ? [`… còn ${a.tong.count - a.rows.length} khoản`] : [];
  return [head, ...rows, ...more];
}

// today: ngày VN của tin (năm trong câu gợi ý hỏi tiếp)
export function queryAnswerText(a: QueryAnswer, coSoTien: boolean, today: string = a.spec.period.to): string {
  let lines: string[];
  switch (a.kind) {
    case 'TONG':
      lines = totalLines(a);
      break;
    case 'SO_DU':
      lines = balanceLines(a);
      break;
    case 'THEO_DANH_MUC':
    case 'THEO_DOI_TUONG':
      lines = groupLines(a);
      break;
    case 'NO':
      lines = [NO_TEXT];
      break;
    case 'AI_NHIEU_NHAT':
      lines = whoLines(a);
      break;
    case 'LON_NHAT':
    case 'LIET_KE':
      lines = itemLines(a, today);
      break;
    case 'SO_SANH':
      lines = compareLines(a);
      break;
    case 'CHUYEN_TIEN':
      lines = transferLines(a);
      break;
    case 'HU_TIET_KIEM': {
      const name = a.jar ? `Hũ ${a.jar.ten}` : 'Các hũ';
      const s = a.summary;
      const have = assetText(s.tien, s.vangPhan, s.vangGiaTri);
      const price = goldPriceLine(s.vangPhan !== 0 ? s.gia : null);
      if (a.flows) {
        // Bỏ vào / lấy ra tính theo tiền (gồm tiền mua / bán vàng); hỏi vàng → chỉ mua / bán vàng
        const [inWord, outWord] = a.spec.vang ? ['mua vàng', 'bán vàng'] : ['bỏ vào', 'lấy ra'];
        lines = [
          `🏺 ${name} · ${periodText(a.spec.period)}: ${inWord} ${formatMoney(a.flows.nop)} (${a.flows.soNop} lần) · ${outWord} ${formatMoney(a.flows.rut)} (${a.flows.soRut} lần)`,
          `Hiện có (đến ${formatDay(a.asOf)}): ${have}`,
          ...price,
        ];
      } else if (!a.jar) {
        lines = [...jarListLines(s, a.asOf), 'Chi tiết: /tietkiem'];
      } else {
        const goal = a.jar.muc_tieu ? ` / ${formatMoney(a.jar.muc_tieu)}` : '';
        lines = [`🏺 ${name} đến ${formatDay(a.asOf)}: ${have}${goal}`, ...price, 'Chi tiết: /tietkiem'];
      }
      break;
    }
  }
  return [...lines, ...(coSoTien ? [RECORD_HINT] : [])].join('\n');
}
