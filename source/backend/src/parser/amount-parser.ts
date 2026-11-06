import { normalizeWhitespace } from './normalizer.ts';
import type { ParseContext } from './types.ts';

export interface AmountParseResult {
  amount: number | null;
  isAmbiguous: boolean;
  matchedCount: number;
}

const AMOUNT_TOKEN_REGEX =
  /\b(?:(\d+)\s*(?:tr|trieu|m|cu)\s*(\d{1,3})\b|(\d+(?:[.,]\d+)?)\s*(tr|trieu|m|cu|k|nghin|ngan)\b|(\d{1,3}(?:[.,]\d{3})+)\s*(?:d|vnd)?\b|(\d{4,})\s*(?:d|vnd)?\b)/gi;

function parseSingleMatch(match: RegExpExecArray): number | null {
  // 1. Dạng 1tr5, 2tr25, 1m5
  if (match[1] !== undefined && match[2] !== undefined) {
    const millions = Number(match[1]);
    const fractionStr = match[2];
    const fractionScale = Math.pow(10, 6 - fractionStr.length);
    const total = millions * 1_000_000 + Number(fractionStr) * fractionScale;
    return total > 0 ? Math.round(total) : null;
  }

  // 2. Dạng 20tr, 1.5 triệu, 2,5tr, 50k, 50 nghìn
  if (match[3] !== undefined && match[4] !== undefined) {
    const rawNum = match[3].replace(',', '.');
    const value = Number(rawNum);
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    const unit = match[4].toLowerCase();
    const multiplier =
      unit === 'k' || unit === 'nghin' || unit === 'ngan' ? 1_000 : 1_000_000;
    return Math.round(value * multiplier);
  }

  // 3. Dạng phân tách hàng nghìn: 1.200.000, 1,200,000d, 500.000
  if (match[5] !== undefined) {
    const digitsOnly = match[5].replace(/[.,]/g, '');
    const value = Number(digitsOnly);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  // 4. Dạng số nguyên >= 4 chữ số: 50000, 120000d
  if (match[6] !== undefined) {
    const value = Number(match[6]);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  return null;
}

// "3 hay 4 triệu", "2 hoặc 3tr": hai số chung 1 đơn vị → mơ hồ (quy tắc hẹp, không đụng câu khác).
// Số đầu đứng sau tháng/ngày/tuần/năm/lần ("tiền điện tháng 10 hay 500k") thì không tính.
const ALTERNATIVE_AMOUNT_REGEX =
  /(?<!\b(?:thang|ngay|tuan|nam|lan)\s+)\b\d+(?:[.,]\d+)?\s*(?:hay|hoac)\s*\d+(?:[.,]\d+)?\s*(?:tr|trieu|m|cu|k|nghin|ngan)\b/i;

export function extractAmountVnd(ctx: ParseContext): AmountParseResult {
  const text = ctx.workingAsciiText;
  const alternative = text.match(ALTERNATIVE_AMOUNT_REGEX);
  if (alternative) {
    ctx.workingAsciiText = normalizeWhitespace(text.replace(alternative[0], ' '));
    return { amount: null, isAmbiguous: true, matchedCount: 2 };
  }
  const regex = new RegExp(AMOUNT_TOKEN_REGEX.source, 'gi');
  const parsedValues: number[] = [];
  const matchedTokens: string[] = [];

  let match: RegExpExecArray | null = regex.exec(text);
  while (match !== null) {
    const val = parseSingleMatch(match);
    if (val !== null) {
      parsedValues.push(val);
      matchedTokens.push(match[0]);
    }
    match = regex.exec(text);
  }

  if (parsedValues.length === 0) {
    return { amount: null, isAmbiguous: false, matchedCount: 0 };
  }

  let updatedText = text;
  for (const token of matchedTokens) {
    updatedText = updatedText.replace(token, ' ');
  }
  ctx.workingAsciiText = normalizeWhitespace(updatedText);

  if (parsedValues.length > 1) {
    return {
      amount: null,
      isAmbiguous: true,
      matchedCount: parsedValues.length,
    };
  }

  return {
    amount: parsedValues[0] ?? null,
    isAmbiguous: false,
    matchedCount: 1,
  };
}


// "Có số tiền rõ" (Phase 5b 3.2c): số có đơn vị, hoặc số trần >= 10.000 (năm 2026, "tháng 10" không tính).
// Hàm thuần, không sửa ctx.
export function hasClearAmount(text: string): boolean {
  if (ALTERNATIVE_AMOUNT_REGEX.test(text)) {
    return true;
  }
  const regex = new RegExp(AMOUNT_TOKEN_REGEX.source, 'gi');
  for (let m = regex.exec(text); m !== null; m = regex.exec(text)) {
    const value = parseSingleMatch(m);
    const hasUnit = m[2] !== undefined || m[4] !== undefined || /(?:d|vnd)$/i.test(m[0]);
    if (value !== null && (hasUnit || value >= 10_000)) {
      return true;
    }
  }
  return false;
}
