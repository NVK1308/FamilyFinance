import type { FundDirection, MemberId } from '../../config/constants.ts';
import { toSafeNumber, type ChuyenQuyChungRecord, type ChuyenTienNoiBoRecord, type DatabaseAdapter } from '../types.ts';

// ---------- Chuyển tiền vợ ↔ chồng (chuyen_tien_noi_bo) ----------

export interface NewTransferInput {
  id: string;
  nguoi_chuyen_id: MemberId;
  nguoi_nhan_id: MemberId;
  so_tien: number;
  ngay_chuyen: string;
  source_message_id: string;
  idempotency_key: string;
  ghi_chu: string | null;
  nowIso: string;
}

export async function insertTransfer(db: DatabaseAdapter, input: NewTransferInput): Promise<ChuyenTienNoiBoRecord> {
  const version = await db.nextVersion();
  const row = await db.queryOne<ChuyenTienNoiBoRecord>(
    `INSERT INTO chuyen_tien_noi_bo (
      id, nguoi_chuyen_id, nguoi_nhan_id, so_tien, ngay_chuyen, trang_thai, source_message_id,
      idempotency_key, ghi_chu, created_at, updated_at, version
    ) VALUES ($1, $2, $3, $4, $5, 'CHO_XAC_NHAN', $6, $7, $8, $9, $9, $10)
    RETURNING *`,
    [
      input.id,
      input.nguoi_chuyen_id,
      input.nguoi_nhan_id,
      input.so_tien,
      input.ngay_chuyen,
      input.source_message_id,
      input.idempotency_key,
      input.ghi_chu,
      input.nowIso,
      version,
    ],
  );
  if (!row) {
    throw new Error(`Không đọc lại được chuyển tiền vừa ghi: ${input.id}`);
  }
  return row;
}

export function getTransferById(db: DatabaseAdapter, id: string): Promise<ChuyenTienNoiBoRecord | null> {
  return db.queryOne<ChuyenTienNoiBoRecord>(
    'SELECT * FROM chuyen_tien_noi_bo WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
}

export function getTransferByIdempotencyKey(
  db: DatabaseAdapter,
  key: string,
): Promise<ChuyenTienNoiBoRecord | null> {
  return db.queryOne<ChuyenTienNoiBoRecord>('SELECT * FROM chuyen_tien_noi_bo WHERE idempotency_key = $1', [key]);
}

export function getTransferByMessage(
  db: DatabaseAdapter,
  messageId: string,
): Promise<ChuyenTienNoiBoRecord | null> {
  return db.queryOne<ChuyenTienNoiBoRecord>(
    'SELECT * FROM chuyen_tien_noi_bo WHERE source_message_id = $1 AND deleted_at IS NULL',
    [messageId],
  );
}

export function listPendingTransfers(db: DatabaseAdapter): Promise<ChuyenTienNoiBoRecord[]> {
  return db.query<ChuyenTienNoiBoRecord>(
    `SELECT * FROM chuyen_tien_noi_bo WHERE trang_thai = 'CHO_XAC_NHAN' AND deleted_at IS NULL
     ORDER BY ngay_chuyen, created_at, id`,
  );
}

// Tổng tiền người này đang chuyển đi mà chưa được xác nhận (để cảnh báo vượt số dư)
export async function sumPendingOutgoing(db: DatabaseAdapter, memberId: string): Promise<number> {
  const row = await db.queryOne<{ total: unknown }>(
    `SELECT COALESCE(SUM(so_tien), 0) AS total FROM chuyen_tien_noi_bo
     WHERE nguoi_chuyen_id = $1 AND trang_thai = 'CHO_XAC_NHAN' AND deleted_at IS NULL`,
    [memberId],
  );
  return toSafeNumber(row?.total);
}

// Chỉ đổi khi còn CHO_XAC_NHAN. Trả số dòng đổi (0 = bấm lặp / bên kia đã xử lý trước).
export async function markTransferConfirmed(
  db: DatabaseAdapter,
  id: string,
  telegramUserId: number,
  nowIso: string,
): Promise<number> {
  const version = await db.nextVersion();
  const res = await db.execute(
    `UPDATE chuyen_tien_noi_bo SET trang_thai = 'DA_XAC_NHAN', ngay_xac_nhan = $2,
       telegram_user_id_xac_nhan = $3, updated_at = $2, version = $4
     WHERE id = $1 AND trang_thai = 'CHO_XAC_NHAN' AND deleted_at IS NULL`,
    [id, nowIso, telegramUserId, version],
  );
  return res.changes;
}

export async function markTransferCancelled(db: DatabaseAdapter, id: string, nowIso: string): Promise<number> {
  const version = await db.nextVersion();
  const res = await db.execute(
    `UPDATE chuyen_tien_noi_bo SET trang_thai = 'DA_HUY', updated_at = $2, version = $3
     WHERE id = $1 AND trang_thai = 'CHO_XAC_NHAN' AND deleted_at IS NULL`,
    [id, nowIso, version],
  );
  return res.changes;
}

// ---------- Nộp / rút quỹ chung (chuyen_quy_chung) ----------

export interface NewFundMoveInput {
  id: string;
  chieu: FundDirection;
  thanh_vien_id: MemberId;
  nhom_id: 'VO' | 'CHONG';
  so_tien: number;
  ngay_chuyen: string;
  source_message_id: string | null;
  idempotency_key: string;
  ghi_chu: string | null;
  nowIso: string;
}

export async function insertFundMove(db: DatabaseAdapter, input: NewFundMoveInput): Promise<ChuyenQuyChungRecord> {
  const version = await db.nextVersion();
  const row = await db.queryOne<ChuyenQuyChungRecord>(
    `INSERT INTO chuyen_quy_chung (
      id, chieu, thanh_vien_id, nhom_id, so_tien, ngay_chuyen, trang_thai, source_message_id,
      idempotency_key, ghi_chu, created_at, updated_at, version
    ) VALUES ($1, $2, $3, $4, $5, $6, 'HOAN_TAT', $7, $8, $9, $10, $10, $11)
    RETURNING *`,
    [
      input.id,
      input.chieu,
      input.thanh_vien_id,
      input.nhom_id,
      input.so_tien,
      input.ngay_chuyen,
      input.source_message_id,
      input.idempotency_key,
      input.ghi_chu,
      input.nowIso,
      version,
    ],
  );
  if (!row) {
    throw new Error(`Không đọc lại được dòng quỹ chung vừa ghi: ${input.id}`);
  }
  return row;
}

export function getFundMoveById(db: DatabaseAdapter, id: string): Promise<ChuyenQuyChungRecord | null> {
  return db.queryOne<ChuyenQuyChungRecord>(
    'SELECT * FROM chuyen_quy_chung WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
}

export function getFundMoveByIdempotencyKey(
  db: DatabaseAdapter,
  key: string,
): Promise<ChuyenQuyChungRecord | null> {
  return db.queryOne<ChuyenQuyChungRecord>('SELECT * FROM chuyen_quy_chung WHERE idempotency_key = $1', [key]);
}

export async function markFundMoveCancelled(db: DatabaseAdapter, id: string, nowIso: string): Promise<number> {
  const version = await db.nextVersion();
  const res = await db.execute(
    `UPDATE chuyen_quy_chung SET trang_thai = 'DA_HUY', updated_at = $2, version = $3
     WHERE id = $1 AND trang_thai = 'HOAN_TAT' AND deleted_at IS NULL`,
    [id, nowIso, version],
  );
  return res.changes;
}
