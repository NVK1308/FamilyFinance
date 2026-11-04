import {
  CATEGORY_SCOPE,
  DEFAULT_CATEGORIES,
  TRANSACTION_TYPE,
  type CategoryCode,
  type CategoryScope,
  type TransactionType,
} from '../config/constants.ts';
import { normalizeWhitespace, removeVietnameseDiacritics } from './normalizer.ts';
import type { ParseContext } from './types.ts';

export interface CompiledKeywordEntry {
  normalizedKeyword: string;
  regex: RegExp;
  categoryCode: CategoryCode;
  scope: CategoryScope;
}

export interface CategoryMatchResult {
  categoryCode: CategoryCode | null;
  inferredTransactionType: TransactionType | null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildCompiledKeywords(): readonly CompiledKeywordEntry[] {
  const entries: CompiledKeywordEntry[] = [];
  const seen = new Set<string>();

  for (const cat of DEFAULT_CATEGORIES) {
    for (const kw of cat.keywords) {
      const asciiKw = normalizeWhitespace(removeVietnameseDiacritics(kw.toLowerCase()));
      const key = `${cat.code}:${asciiKw}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push({
        normalizedKeyword: asciiKw,
        regex: new RegExp(`\\b${escapeRegex(asciiKw)}\\b`, 'i'),
        categoryCode: cat.code,
        scope: cat.scope,
      });
    }
  }

  // Sắp xếp từ khóa dài nhất trước (longest-match first) để cụm 'mua do an' khớp trước 'mua do'
  entries.sort((a, b) => b.normalizedKeyword.length - a.normalizedKeyword.length);
  return entries;
}

const COMPILED_KEYWORDS = buildCompiledKeywords();

export function matchCategoryAndType(
  ctx: ParseContext,
  explicitType: TransactionType | null,
): CategoryMatchResult {
  const candidates = [ctx.workingAsciiText, ctx.asciiText];

  for (const targetText of candidates) {
    for (const entry of COMPILED_KEYWORDS) {
      if (entry.regex.test(targetText)) {
        let inferredType: TransactionType | null = explicitType;
        if (inferredType === null) {
          if (entry.scope === CATEGORY_SCOPE.THU) {
            inferredType = TRANSACTION_TYPE.THU;
          } else if (entry.scope === CATEGORY_SCOPE.CHI) {
            inferredType = TRANSACTION_TYPE.CHI;
          }
        }
        return {
          categoryCode: entry.categoryCode,
          inferredTransactionType: inferredType,
        };
      }
    }
  }

  // Trường hợp câu không khớp danh mục chuẩn nhưng có từ khóa vay/trả nợ rõ ràng
  let fallbackType: TransactionType | null = explicitType;
  if (fallbackType === null) {
    if (/\btra\s+no\b/i.test(ctx.workingAsciiText)) {
      fallbackType = TRANSACTION_TYPE.TRA_NO;
    } else if (/\blai\s+vay\b/i.test(ctx.workingAsciiText)) {
      fallbackType = TRANSACTION_TYPE.LAI_VAY;
    } else if (/\bvay\b/i.test(ctx.workingAsciiText)) {
      fallbackType = TRANSACTION_TYPE.VAY;
    }
  }

  return {
    categoryCode: null,
    inferredTransactionType: fallbackType,
  };
}

