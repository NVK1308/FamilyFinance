import type { ConfirmationStatus, ConfirmationType, MemberId } from '../../config/constants.ts';
import type { DatabaseAdapter, YeuCauXacNhanRecord } from '../types.ts';

export interface NewConfirmationInput {
  id: string;
  source_message_id: string;
  nguoi_tao_id: MemberId;
  nguoi_can_xac_nhan_id: MemberId;
  loai_xac_nhan: ConfirmationType;
  du_lieu_de_xuat: unknown;
  expires_at: string;
  nowIso: string;
}

export async function insertConfirmation(
  db: DatabaseAdapter,
  input: NewConfirmationInput,
): Promise<YeuCauXacNhanRecord> {
  const version = await db.nextVersion();
  const row = await db.queryOne<YeuCauXacNhanRecord>(
    `INSERT INTO yeu_cau_xac_nhan (
      id, source_message_id, nguoi_tao_id, nguoi_can_xac_nhan_id, loai_xac_nhan,
      du_lieu_de_xuat_json, trang_thai, expires_at, created_at, updated_at, version
    ) VALUES ($1, $2, $3, $4, $5, $6, 'CHO_XAC_NHAN', $7, $8, $8, $9)
    RETURNING *`,
    [
      input.id,
      input.source_message_id,
      input.nguoi_tao_id,
      input.nguoi_can_xac_nhan_id,
      input.loai_xac_nhan,
      JSON.stringify(input.du_lieu_de_xuat),
      input.expires_at,
      input.nowIso,
      version,
    ],
  );
  if (!row) {
    throw new Error(`Không đọc lại được yêu cầu xác nhận vừa ghi: ${input.id}`);
  }
  return row;
}

export function getConfirmationById(
  db: DatabaseAdapter,
  id: string,
): Promise<YeuCauXacNhanRecord | null> {
  return db.queryOne<YeuCauXacNhanRecord>('SELECT * FROM yeu_cau_xac_nhan WHERE id = $1', [id]);
}

export function listConfirmationsByMessage(
  db: DatabaseAdapter,
  messageId: string,
): Promise<YeuCauXacNhanRecord[]> {
  return db.query<YeuCauXacNhanRecord>(
    `SELECT * FROM yeu_cau_xac_nhan WHERE source_message_id = $1 AND deleted_at IS NULL
     ORDER BY created_at, id`,
    [messageId],
  );
}

// Chỉ đóng yêu cầu còn CHO_XAC_NHAN (và chưa hết hạn nếu truyền notExpiredAt). Trả số dòng đổi.
export async function closeConfirmation(
  db: DatabaseAdapter,
  id: string,
  status: Exclude<ConfirmationStatus, 'CHO_XAC_NHAN'>,
  nowIso: string,
  notExpiredAt: string | null = null,
): Promise<number> {
  const version = await db.nextVersion();
  const sql =
    `UPDATE yeu_cau_xac_nhan SET trang_thai = $2, updated_at = $3, version = $4
     WHERE id = $1 AND trang_thai = 'CHO_XAC_NHAN' AND deleted_at IS NULL` +
    (notExpiredAt === null ? '' : ' AND expires_at > $5');
  const params = notExpiredAt === null ? [id, status, nowIso, version] : [id, status, nowIso, version, notExpiredAt];
  const res = await db.execute(sql, params);
  return res.changes;
}
