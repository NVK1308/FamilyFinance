import type {
  AdjustmentDirection,
  BeneficiaryId,
  MemberId,
  MoneyHolderId,
  TransactionStatus,
  TransactionType,
} from '../../config/constants.ts';
import type { DatabaseAdapter, GiaoDichRecord } from '../types.ts';

export interface NewTransactionInput {
  id: string;
  loai_giao_dich: TransactionType;
  so_tien: number;
  danh_muc_id: string | null;
  nguoi_tao_id: MemberId;
  nguoi_thuc_hien_id: MemberId;
  nguoi_giu_tien_id: MoneyHolderId | null;
  doi_tuong_thu_huong_id: BeneficiaryId | null;
  khoan_no_id: string | null;
  chieu_dieu_chinh: AdjustmentDirection | null;
  mo_ta: string;
  ngay_giao_dich: string;
  trang_thai: TransactionStatus;
  source_message_id: string | null;
  idempotency_key: string;
  nowIso: string;
}

export async function insertTransaction(
  db: DatabaseAdapter,
  input: NewTransactionInput,
): Promise<GiaoDichRecord> {
  const version = await db.nextVersion();
  const row = await db.queryOne<GiaoDichRecord>(
    `INSERT INTO giao_dich (
      id, loai_giao_dich, so_tien, danh_muc_id, nguoi_tao_id, nguoi_thuc_hien_id,
      nguoi_giu_tien_id, doi_tuong_thu_huong_id, khoan_no_id, chieu_dieu_chinh, mo_ta,
      ngay_giao_dich, trang_thai, source_message_id, idempotency_key, created_at, updated_at, version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16, $17)
    RETURNING *`,
    [
      input.id,
      input.loai_giao_dich,
      input.so_tien,
      input.danh_muc_id,
      input.nguoi_tao_id,
      input.nguoi_thuc_hien_id,
      input.nguoi_giu_tien_id,
      input.doi_tuong_thu_huong_id,
      input.khoan_no_id,
      input.chieu_dieu_chinh,
      input.mo_ta,
      input.ngay_giao_dich,
      input.trang_thai,
      input.source_message_id,
      input.idempotency_key,
      input.nowIso,
      version,
    ],
  );
  if (!row) {
    throw new Error(`Không đọc lại được giao dịch vừa ghi: ${input.id}`);
  }
  return row;
}

export function getTransactionById(db: DatabaseAdapter, id: string): Promise<GiaoDichRecord | null> {
  return db.queryOne<GiaoDichRecord>('SELECT * FROM giao_dich WHERE id = $1', [id]);
}

export function getTransactionByIdempotencyKey(
  db: DatabaseAdapter,
  key: string,
): Promise<GiaoDichRecord | null> {
  return db.queryOne<GiaoDichRecord>('SELECT * FROM giao_dich WHERE idempotency_key = $1', [key]);
}

// Trả số dòng đổi: 0 = đã huỷ trước đó (bấm lặp)
export async function markTransactionCancelled(
  db: DatabaseAdapter,
  id: string,
  nowIso: string,
): Promise<number> {
  const version = await db.nextVersion();
  const res = await db.execute(
    `UPDATE giao_dich SET trang_thai = 'DA_HUY', updated_at = $2, version = $3
     WHERE id = $1 AND trang_thai <> 'DA_HUY' AND deleted_at IS NULL`,
    [id, nowIso, version],
  );
  return res.changes;
}
