import { DEFAULT_TIMEZONE } from '../config/constants.ts';

export type DomainErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'WRONG_CONFIRMER'
  | 'FORBIDDEN'
  | 'OVERPAY'
  | 'LOAN_CLOSED'
  | 'CANCEL_BLOCKED'
  | 'NOT_SUPPORTED';

// Lỗi nghiệp vụ: transaction đang mở sẽ rollback
export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'DomainError';
  }
}

export interface ServiceOptions {
  now?: () => Date;
}

export function resolveClock(options?: ServiceOptions): () => Date {
  return options?.now ?? (() => new Date());
}

const VN_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: DEFAULT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Ngày YYYY-MM-DD theo giờ Việt Nam (không dùng toISOString: 0h–7h sẽ lệch ngày)
export function toVnDate(date: Date): string {
  return VN_DATE_FORMAT.format(date);
}

export function addDaysIso(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

// Vi phạm UNIQUE (SQLite / Postgres): dùng để đọc lại bản ghi khi 2 lời gọi cùng key chạy song song
export function isUniqueViolation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed|duplicate key value/i.test(text);
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(value: string, field: string): void {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new DomainError('INVALID_INPUT', `${field} phải dạng YYYY-MM-DD: ${value}`);
  }
}

export function assertPositiveAmount(value: number, field = 'so_tien'): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DomainError('INVALID_INPUT', `${field} phải là số nguyên dương: ${value}`);
  }
}

// Hàm gọi tường minh bắt buộc truyền key dạng api:<uuid>
export function assertApiKey(key: string): void {
  if (!/^api:[0-9a-fA-F-]{8,}/.test(key)) {
    throw new DomainError('INVALID_INPUT', `idempotency_key phải dạng api:<uuid>: ${key}`);
  }
}
