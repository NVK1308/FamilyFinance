import {
  BENEFICIARY_ID,
  CATEGORY_CODE,
  DEFAULT_CATEGORIES,
  MEMBER_ID,
  MONEY_HOLDER_ID,
  type BeneficiaryId,
  type MemberId,
  type MoneyHolderId,
  type TransferStatus,
} from '../config/constants.ts';
import { isGoldQuestion } from '../parser/gold-detector.ts';
import { findCategoryByKeyword } from '../parser/category-matcher.ts';
import { hasDebtWord, toMemberId } from '../parser/intent-classifier.ts';
import { jarWordGate, matchKnownJar } from '../parser/savings-detector.ts';
import { createParseContext, normalizeWhitespace } from '../parser/normalizer.ts';
import {
  allTimePeriod,
  currentMonthPeriod,
  parsePeriod,
  previousPeriod,
  todayPeriod,
  type ParsedPeriod,
  type Period,
} from './period-parser.ts';
import type { QueryFilterSpec, QueryKind, QueryMeasure, QuerySpec, TransferQuerySpec } from './types.ts';

// Luật cố định theo từ khoá (Q1), thứ tự từ tự do. Xem source/docs/QUERY_RULES.md.

const LENDING_INCOME = /\blai\s+cho\s+vay\b/i;
const BY_CATEGORY =
  /\b(?:theo\s+danh\s+muc|danh\s+muc\s+nao|tung\s+danh\s+muc|cac\s+danh\s+muc|vao\s+(?:cai\s+|viec\s+)?gi|nhieu\s+nhat\s+vao)\b/i;
const BY_BENEFICIARY = /\b(?:tung\s+nguoi|theo\s+doi\s+tuong|tung\s+doi\s+tuong|cho\s+ai|theo\s+tung\s+nguoi)\b/i;
// 5b-2
// "chuyển" so trên chuỗi có dấu ("chuyến đi", "vận chuyển" không phải chuyển tiền); không dấu thì bỏ "van chuyen", "chuyen di"
const TRANSFER_ACCENTED = /(?:^|\s)(?<!vận\s)(?:chuyển|ck)(?=$|\s)/u;
const TRANSFER_ASCII = /(?<!\bvan\s)\b(?:chuyen|ck)\b(?!\s+(?:di|xe|bay)\b)/i;
const FUND_WORD = /\bquy\s+chung\b/i;
const PENDING_STRONG = /\b(?:chua|cho|dang\s+cho)\s+xac\s+nhan\b/i;
const PENDING_WORD = /\b(?:chua\s+xac\s+nhan|cho\s+xac\s+nhan|dang\s+cho|chua\s+nhan)\b/i;
// Kỳ thứ 2 tương đối ("tháng 10 với tháng trước") → kỳ liền trước của kỳ thứ nhất
const RELATIVE_PERIOD = /\b(?:truoc|qua|ngoai)\b/i;
const DETAIL = /\bchi\s+tiet\b/gi;
const FULL_LIST = /\b(?:chi\s+tiet|tat\s+ca|day\s+du|toan\s+bo)\b/i;

function isTransferQuestion(normalized: string, ascii: string, rest: string): boolean {
  if (FUND_WORD.test(rest)) return false;
  const word = normalized !== ascii ? TRANSFER_ACCENTED.test(normalized) : TRANSFER_ASCII.test(ascii);
  return word || PENDING_STRONG.test(rest);
}
const CANCELLED_WORD = /\b(?:bi\s+huy|da\s+huy|tu\s+choi)\b/i;
const EXPIRED_WORD = /\bhet\s+han\b/i;
const COMPARE = /\bso\s+sanh\b/i;
// "ai" trừ "chưa rõ ai giữ" (câu số dư)
const WHO = /(?<!\bro\s)\bai\b(?!\s+giu)|\bnguoi\s+nao\b/i;
const LARGEST = /\b(?:lon\s+nhat|to\s+nhat|nhieu\s+nhat|khoan\s+(?:chi\s+|thu\s+)?nao)\b/i;
// "chi tiết" được đổi thành "liet ke" trước khi xét (để chữ "chi" không thành động từ chi)
const LIST = /\b(?:liet\s+ke|lich\s+su|danh\s+sach|nhung\s+khoan|cac\s+khoan)\b/i;
const TRANSFER_PAIR = /\b(vo|chong)\s+(?:da\s+)?(?:chuyen|ck|dua)(?:\s+tien)?\s+(?:cho\s+)?(vo|chong)\b/i;
const TRANSFER_SUBJECT = /\b(vo|chong)\s+(?:da\s+)?(?:chuyen|ck)\b/i;
const TRANSFER_RECIPIENT = /\b(?:chuyen|ck|dua)(?:\s+tien)?\s+(?:cho\s+)?(vo|chong)\b/i;
const ALL_TRANSFER_STATUSES: TransferStatus[] = ['DA_XAC_NHAN', 'CHO_XAC_NHAN', 'DA_HUY', 'TU_CHOI', 'HET_HAN'];

function transferSpec(text: string): TransferQuerySpec {
  const pair = text.match(TRANSFER_PAIR);
  let from = pair ? toMemberId(pair[1]) : toMemberId(text.match(TRANSFER_SUBJECT)?.[1]);
  let to = pair ? toMemberId(pair[2]) : toMemberId(text.match(TRANSFER_RECIPIENT)?.[1]);
  // Chỉ có vợ và chồng: biết 1 bên thì bên kia là người còn lại
  const other = (m: MemberId): MemberId => (m === MEMBER_ID.VO ? MEMBER_ID.CHONG : MEMBER_ID.VO);
  if (from && !to) to = other(from);
  if (to && !from) from = other(to);
  if (from && from === to) from = to = null;
  const base = { from, to };
  if (PENDING_WORD.test(text)) return { ...base, statuses: ['CHO_XAC_NHAN'], label: 'chưa xác nhận', list: true };
  if (CANCELLED_WORD.test(text)) return { ...base, statuses: ['DA_HUY', 'TU_CHOI'], label: 'bị huỷ / từ chối', list: true };
  if (EXPIRED_WORD.test(text)) return { ...base, statuses: ['HET_HAN'], label: 'hết hạn', list: true };
  if (LIST.test(text)) return { ...base, statuses: ALL_TRANSFER_STATUSES, label: 'mọi trạng thái', list: true };
  return { ...base, statuses: ['DA_XAC_NHAN'], label: 'đã nhận', list: false };
}
const DIFFERENCE = /\b(?:tiet\s+kiem|du\s+ra|chenh\s+lech|con\s+lai\s+sau)\b/i;
const BALANCE_ASCII = /\b(?:so\s+du|dang\s+giu|chua\s+(?:ro|xac\s+dinh)\s+(?:nguoi|ai)\s+giu|giu\s+bao\s+nhieu)\b/i;
const REMAIN_ACCENTED = /(?:^|\s)còn(?=\s|$)/u;
const REMAIN_ASCII = /\bcon\s+(?:lai|bao\s+nhieu|du|tien)\b/i;
const CHILD_BEFORE_REMAIN = /\b(?:cho|cua)\s+con\s+(?:bao|tien|lai)\b/i;
const OVERVIEW = /\b(?:tong|thu\s+chi|tinh\s+hinh|thong\s+ke)\b/i;
const ASKS_AMOUNT = /\b(?:bao\s+nhieu|het|tiet\s+kiem|du\s+ra|chenh\s+lech)\b/i;
const INCOME_VERB = /\b(?:thu|kiem|thu\s+nhap|nhan\s+duoc|luong)\b/i;
const EXPENSE_VERB = /\b(?:chi|tieu|xai|thanh\s+toan|tra|mua|het|dong|nop|ton)\b/i;

const PERFORMER_INCOME = /\b(?:luong|thuong|thu\s+nhap)\s+(?:cua\s+)?(vo|chong)\b/i;
const PERFORMER_VERB =
  /(?<!\b(?:cho|cua)\s)\b(vo|chong)\s+(?:da\s+|dang\s+)?(?:chi|tieu|xai|thanh\s+toan|tra|mua|thu|kiem|nhan|dong|nop|het|dung|tiet\s+kiem)\b/i;
const FROM_FUND = /\bquy\s+chung\b/i;

const KIDS: { ids: BeneficiaryId[]; label: string } = {
  ids: [BENEFICIARY_ID.CON_GAI, BENEFICIARY_ID.CON_TRAI, BENEFICIARY_ID.CAC_CON],
  label: 'các con',
};
const BENEFICIARY_WORDS: ReadonlyArray<[RegExp, { ids: BeneficiaryId[]; label: string }]> = [
  [/^(?:con\s+gai|be\s+lon)$/, { ids: [BENEFICIARY_ID.CON_GAI], label: 'con gái' }],
  [/^(?:con\s+trai|be\s+nho)$/, { ids: [BENEFICIARY_ID.CON_TRAI], label: 'con trai' }],
  [/^(?:cac\s+con|2\s+con|hai\s+con)$/, KIDS],
  [/^(?:gia\s+dinh(?:\s+chung)?|ca\s+nha)$/, { ids: [BENEFICIARY_ID.GIA_DINH], label: 'gia đình chung' }],
  [/^vo$/, { ids: [BENEFICIARY_ID.VO], label: 'vợ' }],
  [/^chong$/, { ids: [BENEFICIARY_ID.CHONG], label: 'chồng' }],
];
const BENEFICIARY_WITH_PREP =
  /\b(?:cho|cua|danh\s+cho)\s+(con\s+gai|be\s+lon|con\s+trai|be\s+nho|cac\s+con|2\s+con|hai\s+con|gia\s+dinh(?:\s+chung)?|ca\s+nha|vo|chong)\b/i;
const BENEFICIARY_BARE = /\b(con\s+gai|con\s+trai|cac\s+con|gia\s+dinh\s+chung)\b/i;

// Nhóm danh mục (AC3)
const CATEGORY_GROUPS: ReadonlyArray<[RegExp, { codes: string[]; label: string }]> = [
  [/\bhoc\b(?!\s+(?:phi|them)\b)/i, { codes: [CATEGORY_CODE.HOC_PHI, CATEGORY_CODE.HOC_THEM], label: 'tiền học' }],
  [/\by\s+te\b/i, { codes: [CATEGORY_CODE.Y_TE, CATEGORY_CODE.THUOC], label: 'y tế (gồm thuốc)' }],
  [/\ban\s+uong\b/i, { codes: [CATEGORY_CODE.THUC_AN, CATEGORY_CODE.DI_CHO, CATEGORY_CODE.SUA], label: 'ăn uống' }],
];

function beneficiaryOf(phrase: string): { ids: BeneficiaryId[]; label: string } | null {
  const key = normalizeWhitespace(phrase.toLowerCase());
  return BENEFICIARY_WORDS.find(([re]) => re.test(key))?.[1] ?? null;
}

function balanceHolder(text: string): MoneyHolderId | null {
  if (FROM_FUND.test(text)) return MONEY_HOLDER_ID.QUY_CHUNG;
  if (/\bchua\s+(?:ro|xac\s+dinh)\b/i.test(text)) return MONEY_HOLDER_ID.CHUA_XAC_DINH;
  const vo = /\bvo\b/i.test(text);
  const chong = /\bchong\b/i.test(text);
  if (vo !== chong) return vo ? MONEY_HOLDER_ID.VO : MONEY_HOLDER_ID.CHONG;
  return null;
}

// Tách người thực hiện / đối tượng / người giữ / danh mục; trả phần chữ còn lại để xét động từ
function extractFilters(input: string): { filters: QueryFilterSpec; scope: 'THU' | 'CHI' | 'CA_HAI' | null } {
  let text = input;
  const cut = (m: RegExpMatchArray): void => {
    text = normalizeWhitespace(text.replace(m[0], ' '));
  };
  let performer: MemberId | null = null;
  const income = text.match(PERFORMER_INCOME);
  if (income) {
    performer = toMemberId(income[1]);
    text = normalizeWhitespace(text.replace(income[0], income[0].split(/\s+/)[0]!));
  }

  let beneficiaries: QueryFilterSpec['beneficiaries'] = null;
  const ben = text.match(BENEFICIARY_WITH_PREP) ?? text.match(BENEFICIARY_BARE);
  if (ben) {
    beneficiaries = beneficiaryOf(ben[1]!);
    cut(ben);
  }

  if (!performer) {
    const verb = text.match(PERFORMER_VERB);
    if (verb) {
      performer = toMemberId(verb[1]);
    }
  }

  const holder = FROM_FUND.test(text) ? MONEY_HOLDER_ID.QUY_CHUNG : null;

  let categories: QueryFilterSpec['categories'] = null;
  let scope: 'THU' | 'CHI' | 'CA_HAI' | null = null;
  const group = CATEGORY_GROUPS.find(([re]) => re.test(text));
  if (group) {
    categories = group[1];
    scope = 'CHI';
  } else {
    const found = findCategoryByKeyword(text);
    if (found) {
      const name = DEFAULT_CATEGORIES.find((c) => c.code === found.code)?.name ?? found.code;
      categories = { codes: [found.code], label: name.toLowerCase() };
      scope = found.scope;
    }
  }
  return { filters: { performer, beneficiaries, categories, holder }, scope };
}

function measureOf(text: string, scope: 'THU' | 'CHI' | 'CA_HAI' | null, filters: QueryFilterSpec): QueryMeasure {
  if (DIFFERENCE.test(text)) return 'CHENH_LECH';
  if (/\bthu\s+chi\b/i.test(text)) return 'TONG_QUAN';
  if (scope === 'THU') return 'THU';
  if (scope === 'CHI') return 'CHI';
  const income = INCOME_VERB.test(text);
  const expense = EXPENSE_VERB.test(text) || /\bchi\s+phi\b/i.test(text);
  if (income && !expense) return 'THU';
  if (expense && !income) return 'CHI';
  if (scope === 'CA_HAI' || filters.beneficiaries) return 'CHI';
  return 'TONG_QUAN';
}

function isRemainQuestion(rawNormalized: string, ascii: string): boolean {
  if (BALANCE_ASCII.test(ascii)) return true;
  const accented = rawNormalized !== ascii;
  return accented ? REMAIN_ACCENTED.test(rawNormalized) : REMAIN_ASCII.test(ascii) && !CHILD_BEFORE_REMAIN.test(ascii);
}

// 2 kỳ đem so, xếp theo vị trí trong câu. Kỳ sau là tương đối ("tháng trước") → kỳ liền trước kỳ đầu.
// Chỉ 1 kỳ đứng sau "với" ("so sánh với tháng trước") → kỳ hiện tại cùng loại so với kỳ đó. Không nêu → tháng này vs tháng trước.
function comparePeriods(p1: ParsedPeriod, today: string): { period: Period; comparePeriod: Period } {
  const p2 = parsePeriod(p1.rest, today);
  if (p1.period && p2.period) {
    const [a, b] = p2.index < p1.index ? [p2, p1] : [p1, p2];
    const first = a.period!;
    const second = RELATIVE_PERIOD.test(b.phrase) || b.period!.from === first.from ? previousPeriod(first) : b.period!;
    return { period: first, comparePeriod: second };
  }
  const withUnit = p1.period ? p1.phrase.match(/^(tuan|thang|quy|nam|hom)\b/i) : null;
  const afterWith = p1.period !== null && /\bvoi(?:\s+ky)?\s*$/i.test(p1.rest.slice(0, p1.index));
  if (p1.period && withUnit && afterWith) {
    const unit = withUnit[1]!.toLowerCase();
    const current = parsePeriod(unit === 'hom' ? 'hom nay' : `${unit} nay`, today).period ?? p1.period;
    return { period: current, comparePeriod: p1.period };
  }
  const first = p1.period ?? currentMonthPeriod(today);
  return { period: first, comparePeriod: previousPeriod(first) };
}

// "hũ (tiết kiệm)", "sổ tiết kiệm", "tiền tiết kiệm còn …" → số dư hũ. "hũ" so trên chuỗi có dấu ("hủ tiếu" ≠ hũ).
const JAR_ACCENTED = /(?:^|\s)hũ(?=$|\s)/u;
const JAR_ASCII = /\b(?:hu\s+tiet\s+kiem|so\s+tiet\s+kiem|gui\s+tiet\s+kiem)\b/i;
const JAR_ASCII_ONLY = /\bhu\b/i;
// "tiết kiệm được" = thu − chi; "tiết kiệm có / còn / hiện có" = số dư hũ
const SAVED_DIFFERENCE = /\btiet\s+kiem\s+duoc\b/i;
const SAVINGS_HOLDING = /\btiet\s+kiem\s+(?:co|dang\s+co|hien\s+co|hien\s+tai)\b/i;
// Hỏi dòng tiền vào/ra hũ trong kỳ ("tháng trước bỏ hũ bao nhiêu")
const SAVINGS_FLOW = /\b(?:bo|gop|nop|gui|cat|de|rut|lay|tat\s+toan)\b/i;

// null = không phải câu về hũ; BALANCE = số dư hũ; FLOW = bỏ vào / lấy ra trong kỳ
// "hũ mua nhà", "quỹ y tế" (tên hũ đang có) → tên ASCII; "quỹ chung" không phải hũ
const JAR_MENTION = /\b(hu|quy(?!\s+chung\b))\s+/gi;

function jarMentioned(ascii: string, normalized: string, jarNames: readonly string[]): string | null {
  const allow = jarWordGate(normalized);
  for (const m of ascii.matchAll(JAR_MENTION)) {
    if (!allow(m[1]!)) continue;
    const known = matchKnownJar(ascii.slice((m.index ?? 0) + m[0].length), jarNames);
    if (known) return known.name;
  }
  return null;
}

function savingsJarQuestion(
  normalized: string,
  ascii: string,
  jarNames: readonly string[],
): { kind: 'BALANCE' | 'FLOW'; huTen: string | null } | null {
  const accented = normalized !== ascii;
  const huTen = jarMentioned(ascii, normalized, jarNames);
  const jarWord = huTen !== null || JAR_ACCENTED.test(normalized) || JAR_ASCII.test(ascii) || (!accented && JAR_ASCII_ONLY.test(ascii));
  const jar =
    jarWord ||
    (!SAVED_DIFFERENCE.test(ascii) && /\btiet\s+kiem\b/i.test(ascii) && (SAVINGS_HOLDING.test(ascii) || isRemainQuestion(normalized, ascii)));
  if (!jar) return null;
  return { kind: SAVINGS_FLOW.test(ascii) && !isRemainQuestion(normalized, ascii) ? 'FLOW' : 'BALANCE', huTen };
}

// Câu hỏi → QuerySpec; không hiểu → null (Q7). today = ngày VN của tin nhắn.
export function parseQuery(rawText: string, today: string, jarNames: readonly string[] = []): QuerySpec | null {
  const ctx = createParseContext(rawText, { senderId: MEMBER_ID.VO, referenceDate: today });
  const clean = (s: string): string => normalizeWhitespace(s.replace(/[?!.,;:]+/g, ' '));
  const ascii = clean(ctx.asciiText);
  const normalized = clean(ctx.normalizedText);
  const parsed = parsePeriod(ascii, today);
  const period = parsed.period;
  const rest = parsed.rest.replace(DETAIL, 'liet ke');
  const empty: QueryFilterSpec = { performer: null, beneficiaries: null, categories: null, holder: null };
  const spec = (kind: QueryKind, measure: QueryMeasure, filters: QueryFilterSpec = empty): QuerySpec => ({
    kind,
    measure,
    period: period ?? (kind === 'SO_DU' ? todayPeriod(today) : currentMonthPeriod(today)),
    ...filters,
  });

  if (hasDebtWord(normalized, ascii) && !LENDING_INCOME.test(rest)) {
    return spec('NO', 'TONG_QUAN');
  }
  if (isTransferQuestion(normalized, ascii, rest)) {
    const transfer = transferSpec(rest);
    // Khoản đang chờ: không nêu kỳ → mọi khoản còn chờ
    const pendingOnly = transfer.statuses.length === 1 && transfer.statuses[0] === 'CHO_XAC_NHAN';
    return { ...spec('CHUYEN_TIEN', 'TONG_QUAN'), ...(period || !pendingOnly ? {} : { period: allTimePeriod(today) }), transfer };
  }
  // Hũ tiết kiệm (tài sản), xét trước "tiết kiệm được" (= thu − chi)
  const jar = savingsJarQuestion(normalized, ascii, jarNames);
  // Vàng ("vàng còn mấy chỉ", "giá vàng", "có bao nhiêu chỉ vàng") → hũ: số chỉ + giá trị; "tháng này mua vàng bao nhiêu" → vào/ra
  if (isGoldQuestion(normalized, ascii, jarNames)) {
    const flow = /\b(?:mua|ban)\b/i.test(ascii) && period !== null && !isRemainQuestion(normalized, ascii);
    return flow
      ? { ...spec('HU_TIET_KIEM', 'TONG_QUAN'), savingsFlow: true, vang: true, huTen: jar?.huTen ?? null }
      : { ...spec('HU_TIET_KIEM', 'TONG_QUAN'), period: period ?? todayPeriod(today), huTen: jar?.huTen ?? null };
  }
  if (jar?.kind === 'BALANCE') {
    return { ...spec('HU_TIET_KIEM', 'TONG_QUAN'), period: period ?? todayPeriod(today), huTen: jar.huTen };
  }
  if (jar?.kind === 'FLOW') {
    return { ...spec('HU_TIET_KIEM', 'TONG_QUAN'), savingsFlow: true, huTen: jar.huTen };
  }
  const { filters, scope } = extractFilters(rest);
  const incomeOnly = INCOME_VERB.test(rest) && !EXPENSE_VERB.test(rest);
  if (BY_CATEGORY.test(rest)) {
    return spec('THEO_DANH_MUC', incomeOnly ? 'THU' : 'CHI', { ...filters, categories: null });
  }
  if (BY_BENEFICIARY.test(rest)) {
    return spec('THEO_DOI_TUONG', 'CHI', { ...filters, beneficiaries: null });
  }
  const measure = measureOf(rest, scope, filters);
  // Số dư xét trước "ai / nhiều nhất" ("ai đang giữ nhiều tiền nhất")
  if (measure !== 'CHENH_LECH' && isRemainQuestion(normalized, ascii)) {
    return spec('SO_DU', 'TONG_QUAN', { ...empty, holder: balanceHolder(rest) });
  }
  if (COMPARE.test(rest)) {
    // So sánh vợ với chồng → chi/thu theo người
    if (/\bvo\b/i.test(rest) && /\bchong\b/i.test(rest)) {
      return spec('AI_NHIEU_NHAT', measure === 'THU' ? 'THU' : 'CHI', { ...filters, performer: null, beneficiaries: null });
    }
    return { ...spec('SO_SANH', measure, filters), ...comparePeriods(parsed, today) };
  }
  if (WHO.test(rest) && (LARGEST.test(rest) || EXPENSE_VERB.test(rest) || INCOME_VERB.test(rest))) {
    return spec('AI_NHIEU_NHAT', measure === 'THU' ? 'THU' : 'CHI', { ...filters, performer: null });
  }
  if (LARGEST.test(rest)) {
    return spec('LON_NHAT', measure === 'THU' ? 'THU' : 'CHI', filters);
  }
  // "chi tiết / tất cả / đầy đủ / toàn bộ" → liệt kê đủ (tối đa 31 ngày). Hỏi số tiền
  // ("tổng tất cả", "chi tất cả bao nhiêu", "mấy") vẫn là tổng.
  const asksNumber = /\btong\b/i.test(rest) || ASKS_AMOUNT.test(rest) || /(?:^|\s)mấy(?=$|\s)/u.test(normalized);
  const fullList = FULL_LIST.test(ascii) && !asksNumber;
  if (LIST.test(rest) || fullList) {
    return { ...spec('LIET_KE', measure === 'CHENH_LECH' ? 'TONG_QUAN' : measure, filters), ...(fullList ? { fullList } : {}) };
  }
  // Không đoán bừa: phải hỏi số tiền ("bao nhiêu", "mấy", "tổng"…), hoặc nêu kỳ / danh mục / đối tượng / quỹ chung.
  // Chỉ có trợ từ hỏi + động từ ("huỷ lệnh xác nhận được không") → không hiểu.
  const asksAmount = ASKS_AMOUNT.test(rest) || OVERVIEW.test(rest) || /(?:^|\s)mấy(?=$|\s)/u.test(normalized);
  const hasScope = Boolean(filters.beneficiaries || filters.categories || filters.holder);
  if (!asksAmount && !hasScope && !period) {
    return null;
  }
  return spec('TONG', measure, filters);
}
