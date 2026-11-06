import { addDaysToIsoDate } from '../parser/date-parser.ts';
import { normalizeWhitespace } from '../parser/normalizer.ts';

// Khoảng ngày VN [from, to] (YYYY-MM-DD). explicit = câu có nêu thời gian.
export interface Period {
  from: string;
  to: string;
  label: string;
  explicit: boolean;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
// '2026-11-05' → '05/11'
const dm = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

function parts(date: string): [number, number, number] {
  return date.split('-').map(Number) as [number, number, number];
}

function validDay(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= lastDay(y, m);
}

function make(from: string, to: string, label: string): Period {
  return { from, to, label, explicit: true };
}

function day(date: string, name?: string): Period {
  return make(date, date, name ? `${name} (${dm(date)})` : dm(date));
}

function week(today: string, back: number, name: string): Period {
  const [y, m, d] = parts(today);
  const mondayOffset = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  const from = addDaysToIsoDate(today, -mondayOffset - 7 * back);
  const to = addDaysToIsoDate(from, 6);
  return make(from, to, `${name} (${dm(from)}–${dm(to)})`);
}

export function monthPeriod(y: number, m: number): Period {
  return make(iso(y, m, 1), iso(y, m, lastDay(y, m)), `tháng ${m}/${y}`);
}

function quarterPeriod(y: number, q: number): Period {
  const m1 = (q - 1) * 3 + 1;
  return make(iso(y, m1, 1), iso(y, m1 + 2, lastDay(y, m1 + 2)), `quý ${q}/${y}`);
}

function yearPeriod(y: number): Period {
  return make(iso(y, 1, 1), iso(y, 12, 31), `năm ${y}`);
}

// "1/10", "01/10/2026" → ngày; năm thiếu = năm hiện tại
function dateFrom(d: string, m: string, y: string | undefined, refYear: number): string | null {
  const yy = y ? Number(y) : refYear;
  return validDay(yy, Number(m), Number(d)) ? iso(yy, Number(m), Number(d)) : null;
}

const DATE = String.raw`(?:ngay\s+)?(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?`;
const RANGE_REGEX = new RegExp(String.raw`\btu\s+${DATE}\s+(?:den|toi)\s+(?:(nay|hom\s+nay)|${DATE})\b`, 'i');
const FROM_START_REGEX = new RegExp(
  String.raw`\btu\s+dau\s+(tuan|thang|quy|nam)(?:\s+nay)?(?:\s+(?:den|toi)\s+(?:(nay|hom\s+nay)|${DATE}))?\b`,
  'i',
);
// Năm đứng sau tháng / quý: "/2025", "năm 2025", "năm nay", "năm ngoái"
const YEAR_SUFFIX = String.raw`(?:[\/\-](\d{4})|\s+nam\s+(\d{4}|nay|ngoai|truoc|qua))?`;
const SINGLE_DATE_REGEX = new RegExp(String.raw`\b${DATE}\b`, 'i');

function yearOf(slash: string | undefined, word: string | undefined, ty: number): number | null {
  if (slash) return Number(slash);
  if (!word) return null;
  if (/^\d{4}$/.test(word)) return Number(word);
  return word.toLowerCase() === 'nay' ? ty : ty - 1;
}

export interface ParsedPeriod {
  period: Period | null;
  // Câu đã bỏ cụm kỳ
  rest: string;
  // Vị trí + nội dung cụm kỳ trong câu (-1 / '' khi không có) — dùng để xếp thứ tự 2 kỳ khi so sánh
  index: number;
  phrase: string;
}

// Câu (ASCII hoá) → kỳ + phần còn lại đã bỏ cụm kỳ. Không nêu thời gian → period null.
export function parsePeriod(ascii: string, today: string): ParsedPeriod {
  const [ty, tm] = parts(today);
  const take = (match: RegExpMatchArray, period: Period | null): ParsedPeriod => ({
    period,
    rest: normalizeWhitespace(ascii.replace(match[0], ' ')),
    index: match.index ?? -1,
    phrase: match[0],
  });

  const range = ascii.match(RANGE_REGEX);
  if (range) {
    let from = dateFrom(range[1]!, range[2]!, range[3], ty);
    const to = range[4] ? today : dateFrom(range[5]!, range[6]!, range[7], ty);
    if (from && to && from > to && !range[3]) {
      from = dateFrom(range[1]!, range[2]!, String(ty - 1), ty);
    }
    if (from && to && from <= to) {
      return take(range, make(from, to, `${dm(from)}–${dm(to)}`));
    }
  }

  // "từ đầu tháng (đến 15/10)": đầu tuần/tháng/quý/năm chứa ngày cuối
  const fromStart = ascii.match(FROM_START_REGEX);
  if (fromStart) {
    const to = fromStart[3] ? dateFrom(fromStart[3], fromStart[4]!, fromStart[5], ty) : today;
    if (!to) {
      return take(fromStart, null);
    }
    const [ey, em] = parts(to);
    const unit = fromStart[1]!.toLowerCase();
    const start =
      unit === 'tuan'
        ? week(to, 0, '').from
        : unit === 'thang'
          ? iso(ey, em, 1)
          : unit === 'quy'
            ? iso(ey, Math.floor((em - 1) / 3) * 3 + 1, 1)
            : iso(ey, 1, 1);
    return take(fromStart, make(start, to, `${dm(start)}–${dm(to)}`));
  }

  const rules: Array<[RegExp, (m: RegExpMatchArray) => Period | null]> = [
    [/\bhom\s+nay\b/i, () => day(today, 'hôm nay')],
    [/\bhom\s+qua\b/i, () => day(addDaysToIsoDate(today, -1), 'hôm qua')],
    [/\bhom\s+kia\b/i, () => day(addDaysToIsoDate(today, -2), 'hôm kia')],
    [/\btuan\s+nay\b/i, () => week(today, 0, 'tuần này')],
    [/\btuan\s+(?:truoc|qua)\b/i, () => week(today, 1, 'tuần trước')],
    [/\bthang\s+nay\b/i, () => monthPeriod(ty, tm)],
    [/\bthang\s+(?:truoc|qua)\b/i, () => (tm === 1 ? monthPeriod(ty - 1, 12) : monthPeriod(ty, tm - 1))],
    // "tháng 10", "tháng 10/2026", "tháng 10 năm 2025"; tháng chưa tới năm nay → năm trước
    [
      new RegExp(String.raw`\bthang\s+(\d{1,2})${YEAR_SUFFIX}\b`, 'i'),
      (m) => {
        const month = Number(m[1]);
        if (month < 1 || month > 12) return null;
        return monthPeriod(yearOf(m[2], m[3], ty) ?? (month > tm ? ty - 1 : ty), month);
      },
    ],
    [/\bquy\s+nay\b/i, () => quarterPeriod(ty, Math.floor((tm - 1) / 3) + 1)],
    [
      /\bquy\s+(?:truoc|qua)\b/i,
      () => {
        const q = Math.floor((tm - 1) / 3) + 1;
        return q === 1 ? quarterPeriod(ty - 1, 4) : quarterPeriod(ty, q - 1);
      },
    ],
    [
      new RegExp(String.raw`\bquy\s+([1-4])${YEAR_SUFFIX}\b`, 'i'),
      (m) => {
        const q = Number(m[1]);
        return quarterPeriod(yearOf(m[2], m[3], ty) ?? (q > Math.floor((tm - 1) / 3) + 1 ? ty - 1 : ty), q);
      },
    ],
    [/\bnam\s+nay\b/i, () => yearPeriod(ty)],
    [/\bnam\s+(?:truoc|ngoai|qua)\b/i, () => yearPeriod(ty - 1)],
    [/\bnam\s+(\d{4})\b/i, (m) => yearPeriod(Number(m[1]))],
    [
      SINGLE_DATE_REGEX,
      (m) => {
        const date = dateFrom(m[1]!, m[2]!, m[3], ty);
        return date ? day(date) : null;
      },
    ],
  ];
  for (const [regex, build] of rules) {
    const match = ascii.match(regex);
    if (match) {
      const period = build(match);
      if (period) {
        return take(match, period);
      }
    }
  }
  return { period: null, rest: ascii, index: -1, phrase: '' };
}

export function todayPeriod(today: string): Period {
  return { ...day(today, 'hôm nay'), explicit: false };
}

export function currentMonthPeriod(today: string): Period {
  const [y, m] = parts(today);
  return { ...monthPeriod(y, m), explicit: false };
}

export const ALL_TIME_FROM = '1900-01-01';

// Không giới hạn kỳ ("chuyển chưa xác nhận" — mọi khoản đang chờ)
export function allTimePeriod(today: string): Period {
  return { from: ALL_TIME_FROM, to: today, label: 'tính đến hôm nay', explicit: false };
}

// Lùi / tiến k tháng, ngày vượt cuối tháng thì lấy ngày cuối (31/03 − 1 tháng = 28/02)
function shiftMonths(date: string, k: number): string {
  const [y, m, d] = parts(date);
  const first = new Date(Date.UTC(y, m - 1 + k, 1));
  const ny = first.getUTCFullYear();
  const nm = first.getUTCMonth() + 1;
  return iso(ny, nm, Math.min(d, lastDay(ny, nm)));
}

// Kỳ liền trước cùng độ dài: tháng/quý/năm → tháng/quý/năm trước; còn lại lùi đúng số ngày
export function previousPeriod(p: Period): Period {
  const [fy, fm, fd] = parts(p.from);
  const [ty, tm, td] = parts(p.to);
  if (fd === 1 && td === lastDay(ty, tm)) {
    const months = (ty - fy) * 12 + (tm - fm) + 1;
    const start = new Date(Date.UTC(fy, fm - 1 - months, 1));
    const y = start.getUTCFullYear();
    const m = start.getUTCMonth() + 1;
    if (months === 1) return monthPeriod(y, m);
    if (months === 3 && m % 3 === 1) return quarterPeriod(y, (m + 2) / 3);
    if (months === 12 && m === 1) return yearPeriod(y);
    const end = new Date(Date.UTC(y, m - 1 + months, 0));
    const to = iso(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate());
    return make(iso(y, m, 1), to, `${dm(iso(y, m, 1))}–${dm(to)}`);
  }
  // Dở dang từ đầu năm / quý / tháng ("từ đầu năm" 01/01–06/11) → cùng đoạn của năm / quý / tháng trước
  if (fd === 1) {
    const span = (ty - fy) * 12 + (tm - fm) + 1;
    const back = fm === 1 && span > 3 ? 12 : (fm - 1) % 3 === 0 && span > 1 ? 3 : 1;
    const from = shiftMonths(p.from, -back);
    const to = shiftMonths(p.to, -back);
    return make(from, to, `${dm(from)}–${dm(to)}${from.slice(0, 4) !== p.from.slice(0, 4) ? `/${from.slice(0, 4)}` : ''}`);
  }
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
  const from = addDaysToIsoDate(p.from, -days);
  const to = addDaysToIsoDate(p.from, -1);
  return make(from, to, from === to ? dm(from) : `${dm(from)}–${dm(to)}`);
}
