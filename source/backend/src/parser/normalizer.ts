import { DEFAULT_TIMEZONE } from '../config/constants.ts';
import type { ParseContext, ParseOptions } from './types.ts';

export function removeVietnameseDiacritics(input: string): string {
  const nfd = input.normalize('NFD');
  const withoutCombining = nfd.replace(/[\u0300-\u036f]/g, '');
  return withoutCombining.replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function getTodayInVietnam(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

export function createParseContext(rawText: string, options: ParseOptions): ParseContext {
  const trimmed = rawText.normalize('NFC').trim();
  const normalizedText = normalizeWhitespace(trimmed.toLowerCase());
  const asciiText = normalizeWhitespace(removeVietnameseDiacritics(normalizedText));
  const referenceDate = options.referenceDate ?? getTodayInVietnam();

  return {
    rawText: trimmed,
    normalizedText,
    asciiText,
    workingAsciiText: asciiText,
    senderId: options.senderId,
    referenceDate,
  };
}

