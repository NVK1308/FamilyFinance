import assert from 'node:assert/strict';
import { CONFIRMATION_TYPE, MEMBER_ID, MESSAGE_STATUS, type ConfirmationType, type MemberId } from '../../src/config/constants.ts';
import { insertConfirmation, updateMessageStatus } from '../../src/db/repositories/index.ts';
import { SqliteMemoryAdapter } from '../../src/db/sqlite-memory-adapter.ts';
import {
  toSafeNumber,
  type DatabaseAdapter,
  type SqlParam,
  type TinNhanGocRecord,
  type YeuCauXacNhanRecord,
} from '../../src/db/types.ts';
import { parseVietnameseFinanceMessage } from '../../src/parser/index.ts';
import {
  BalanceService,
  DebtService,
  DomainError,
  TransactionService,
  TransferService,
  insertIncomingMessage,
  newId,
  requireMessage,
  type DomainErrorCode,
  type IncomingMessage,
} from '../../src/services/index.ts';
import { PgliteTestAdapter } from './pglite-adapter.ts';

// Phase 5 không còn tạo yêu cầu GIAO_DICH_MO_HO / DANH_MUC_MOI từ tin nhắn. Yêu cầu cũ vẫn có thể còn trong DB:
// tạo trực tiếp (tin CHO_XAC_NHAN + yêu cầu, hạn 7 ngày) để giữ kiểm resolveConfirmation.
export async function legacyPending(
  env: TestEnv,
  sender: MemberId,
  text: string,
  type: ConfirmationType = CONFIRMATION_TYPE.GIAO_DICH_MO_HO,
): Promise<{ message: TinNhanGocRecord; confirmations: YeuCauXacNhanRecord[] }> {
  const m = msg(sender, text);
  const parsed = parseVietnameseFinanceMessage(text, { senderId: sender, referenceDate: '2026-11-04' });
  const nowIso = '2026-11-04T03:00:00.000Z';
  return env.db.transaction(async (tx) => {
    const messageId = await insertIncomingMessage(tx, m, sender, nowIso);
    if (!messageId) {
      throw new Error('update trùng');
    }
    const confirmation = await insertConfirmation(tx, {
      id: newId('YC'),
      source_message_id: messageId,
      nguoi_tao_id: sender,
      nguoi_can_xac_nhan_id: sender,
      loai_xac_nhan: type,
      du_lieu_de_xuat: { parsed, ly_do: 'YEU_CAU_CU' },
      expires_at: '2026-11-11T03:00:00.000Z',
      nowIso,
    });
    await updateMessageStatus(tx, messageId, MESSAGE_STATUS.CHO_XAC_NHAN, nowIso);
    return { message: await requireMessage(tx, messageId), confirmations: [confirmation] };
  });
}

export const TELEGRAM_ID: Record<MemberId, number> = {
  [MEMBER_ID.CHONG]: 100000001,
  [MEMBER_ID.VO]: 100000002,
};

export interface TestEnv {
  db: DatabaseAdapter;
  txs: TransactionService;
  transfers: TransferService;
  bal: BalanceService;
  debt: DebtService;
  setNow(iso: string): void;
  close(): Promise<void>;
}

export interface Backend {
  name: string;
  open(options?: { skipMigration?: number }): Promise<TestEnv>;
}

function buildEnv(db: DatabaseAdapter, close: () => Promise<void>): TestEnv {
  let now = new Date('2026-11-04T03:00:00.000Z');
  const clock = { now: () => now };
  return {
    db,
    txs: new TransactionService(db, clock),
    transfers: new TransferService(db, clock),
    bal: new BalanceService(db, clock),
    debt: new DebtService(db, clock),
    setNow: (iso) => {
      now = new Date(iso);
    },
    close,
  };
}

// Q12: cùng bộ test chạy trên SQLite và Postgres (PGlite)
export const BACKENDS: Backend[] = [
  {
    name: 'SQLite',
    open: async (options) => buildEnv(new SqliteMemoryAdapter(options), async () => undefined),
  },
  {
    name: 'PGlite',
    open: async (options) => {
      const db = await PgliteTestAdapter.create(options);
      return buildEnv(db, () => db.close());
    },
  },
];

let updateSeq = 5000;
export function msg(sender: MemberId | number, text: string, receivedAt = '2026-11-04T03:00:00.000Z'): IncomingMessage {
  updateSeq += 1;
  return {
    updateId: updateSeq,
    messageId: updateSeq,
    chatId: -100,
    senderTelegramUserId: typeof sender === 'number' ? sender : TELEGRAM_ID[sender],
    text,
    receivedAt,
  };
}

let keySeq = 0;
// Key dạng api:<uuid> cho hàm gọi tường minh
export function apiKey(): string {
  keySeq += 1;
  return `api:00000000-0000-4000-8000-${String(keySeq).padStart(12, '0')}`;
}

export async function count(db: DatabaseAdapter, table: string, where = '1 = 1', params: SqlParam[] = []): Promise<number> {
  const row = await db.queryOne<{ c: unknown }>(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`, params);
  return toSafeNumber(row?.c);
}

export async function snapshotCounts(db: DatabaseAdapter): Promise<Record<string, number>> {
  const tables = ['tin_nhan_goc', 'giao_dich', 'yeu_cau_xac_nhan', 'lich_su_chinh_sua', 'khoan_no', 'lich_su_no'];
  const result: Record<string, number> = {};
  for (const t of tables) {
    result[t] = await count(db, t);
  }
  return result;
}

export async function expectDomainError(promise: Promise<unknown>, code: DomainErrorCode): Promise<void> {
  await assert.rejects(promise, (err: unknown) => err instanceof DomainError && err.code === code);
}

export const INITIAL_DATE = '2026-11-01';

export async function seedInitial(env: TestEnv, vo = 5_000_000, chong = 3_000_000, quy = 2_000_000, cxd = 0): Promise<void> {
  await env.bal.setInitialBalance({
    ngayApDung: INITIAL_DATE,
    theoNhom: { VO: vo, CHONG: chong, QUY_CHUNG: quy, CHUA_XAC_DINH: cxd },
    tongNhap: vo + chong + quy + cxd,
    nguoiXacNhanId: MEMBER_ID.CHONG,
  });
}

// Chuyển nội bộ (Phase 4 mới có service) — chèn thẳng để test phần đọc
export async function insertTransfer(
  db: DatabaseAdapter,
  id: string,
  from: string,
  to: string,
  amount: number,
  date: string,
  status: string,
): Promise<void> {
  await db.execute(
    `INSERT INTO chuyen_tien_noi_bo (id, nguoi_chuyen_id, nguoi_nhan_id, so_tien, ngay_chuyen, trang_thai,
       idempotency_key, created_at, updated_at, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`,
    [id, from, to, amount, date, status, `test:${id}`, '2026-11-04T00:00:00.000Z', await db.nextVersion()],
  );
}

// Bất biến chính: tổng 4 nhóm = số dư gia đình tính độc lập
export async function assertInvariant(env: TestEnv, asOf: string, label = ''): Promise<number> {
  const holders = await env.bal.getHolderBalances(asOf);
  const family = await env.bal.getFamilyBalance(asOf);
  assert.equal(holders.status, 'OK', label);
  assert.equal(family.status, 'OK', label);
  if (holders.status === 'OK' && family.status === 'OK') {
    assert.equal(holders.tong, family.soDu, `tổng nhóm ≠ gia đình ${label}`);
    return family.soDu;
  }
  return 0;
}

// T22 / P11: ném lỗi ở lệnh ghi thứ N bên trong transaction
export class FaultyAdapter implements DatabaseAdapter {
  private readonly inner: DatabaseAdapter;
  private readonly state: { calls: number; failAt: number };
  constructor(inner: DatabaseAdapter, state: { calls: number; failAt: number }) {
    this.inner = inner;
    this.state = state;
  }
  // Đếm mọi lệnh ghi (INSERT/UPDATE), kể cả INSERT ... RETURNING đi qua query
  private maybeFail(sql: string): void {
    if (!/^\s*(INSERT|UPDATE)\b/i.test(sql)) {
      return;
    }
    this.state.calls += 1;
    if (this.state.calls === this.state.failAt) {
      throw new Error(`Lỗi giả lập ở lệnh ghi #${this.state.failAt}`);
    }
  }
  async query<T>(sql: string, params?: readonly SqlParam[]): Promise<T[]> {
    this.maybeFail(sql);
    return this.inner.query<T>(sql, params);
  }
  async queryOne<T>(sql: string, params?: readonly SqlParam[]): Promise<T | null> {
    this.maybeFail(sql);
    return this.inner.queryOne<T>(sql, params);
  }
  async execute(sql: string, params?: readonly SqlParam[]): Promise<{ changes: number }> {
    this.maybeFail(sql);
    return this.inner.execute(sql, params);
  }
  transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    return this.inner.transaction((tx) => fn(new FaultyAdapter(tx, this.state)));
  }
  nextVersion(): Promise<number> {
    return this.inner.nextVersion();
  }
}
