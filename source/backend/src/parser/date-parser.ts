import { normalizeWhitespace } from './normalizer.ts';
import type { ParseContext } from './types.ts';

export function addDaysToIsoDate(isoDate: string, deltaDays: number): string {
  const parts = isoDate.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const utc = new Date(Date.UTC(year, month - 1, day + deltaDays));
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isValidDayMonth(day: number, month: number, year: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= maxDay;
}

const EXPLICIT_DATE_REGEX =
  /\b(?:ngay\s+)?(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?\b(?!\s*(?:k|nghin|ngan|tr|trieu|d|vnd)\b)/i;

export function extractTransactionDate(ctx: ParseContext): string {
  const text = ctx.workingAsciiText;
  const refYear = Number(ctx.referenceDate.slice(0, 4));

  const dateMatch = text.match(EXPLICIT_DATE_REGEX);
  if (dateMatch) {
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const year = dateMatch[3] ? Number(dateMatch[3]) : refYear;

    if (isValidDayMonth(day, month, year)) {
      ctx.workingAsciiText = normalizeWhitespace(text.replace(dateMatch[0], ' '));
      const m = String(month).padStart(2, '0');
      const d = String(day).padStart(2, '0');
      return `${year}-${m}-${d}`;
    }
  }

  // "tối qua", "sáng nay"... (buổi + qua/nay)
  const partOfDay = text.match(/\b(?:sang|trua|chieu|toi|dem)\s+(qua|nay)\b/i);
  if (partOfDay) {
    ctx.workingAsciiText = normalizeWhitespace(text.replace(partOfDay[0], ' '));
    return partOfDay[1]!.toLowerCase() === 'qua' ? addDaysToIsoDate(ctx.referenceDate, -1) : ctx.referenceDate;
  }

  if (/\bhom\s+kia\b/i.test(text)) {
    ctx.workingAsciiText = normalizeWhitespace(text.replace(/\bhom\s+kia\b/i, ' '));
    return addDaysToIsoDate(ctx.referenceDate, -2);
  }

  if (/\bhom\s+qua\b/i.test(text)) {
    ctx.workingAsciiText = normalizeWhitespace(text.replace(/\bhom\s+qua\b/i, ' '));
    return addDaysToIsoDate(ctx.referenceDate, -1);
  }

  if (/\bhom\s+nay\b/i.test(text)) {
    ctx.workingAsciiText = normalizeWhitespace(text.replace(/\bhom\s+nay\b/i, ' '));
    return ctx.referenceDate;
  }

  return ctx.referenceDate;
}

