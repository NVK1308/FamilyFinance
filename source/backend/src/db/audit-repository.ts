import type { AuditAction, MemberId, TableName } from '../config/constants.ts';
import { toSafeNumber, type DatabaseAdapter, type LichSuChinhSuaRecord } from './types.ts';

// Số lần ghi lịch sử của 1 bản ghi theo lý do (vd đếm "Chưa nhận")
export async function countAuditByReason(
  db: DatabaseAdapter,
  tenBang: TableName,
  banGhiId: string,
  lyDo: string,
): Promise<number> {
  const row = await db.queryOne<{ c: unknown }>(
    'SELECT COUNT(*) AS c FROM lich_su_chinh_sua WHERE ten_bang = $1 AND ban_ghi_id = $2 AND ly_do = $3',
    [tenBang, banGhiId, lyDo],
  );
  return toSafeNumber(row?.c);
}

export interface CreateAuditLogInput {
  ten_bang: TableName;
  ban_ghi_id: string;
  hanh_dong: AuditAction;
  du_lieu_truoc?: unknown;
  du_lieu_sau?: unknown;
  nguoi_thuc_hien_id: MemberId | null;
  ly_do?: string | null;
  nowIso?: string;
}

export async function insertAuditLog(
  db: DatabaseAdapter,
  input: CreateAuditLogInput,
): Promise<LichSuChinhSuaRecord> {
  const id = `AUD_${crypto.randomUUID()}`;
  const createdAt = input.nowIso ?? new Date().toISOString();
  const version = await db.nextVersion();
  const beforeJson =
    input.du_lieu_truoc !== undefined && input.du_lieu_truoc !== null
      ? JSON.stringify(input.du_lieu_truoc)
      : null;
  const afterJson =
    input.du_lieu_sau !== undefined && input.du_lieu_sau !== null
      ? JSON.stringify(input.du_lieu_sau)
      : null;
  const reason = input.ly_do ?? null;

  await db.execute(
    `INSERT INTO lich_su_chinh_sua (
      id, ten_bang, ban_ghi_id, hanh_dong,
      du_lieu_truoc_json, du_lieu_sau_json,
      nguoi_thuc_hien_id, ly_do, created_at, version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      input.ten_bang,
      input.ban_ghi_id,
      input.hanh_dong,
      beforeJson,
      afterJson,
      input.nguoi_thuc_hien_id,
      reason,
      createdAt,
      version,
    ],
  );

  return {
    id,
    ten_bang: input.ten_bang,
    ban_ghi_id: input.ban_ghi_id,
    hanh_dong: input.hanh_dong,
    du_lieu_truoc_json: beforeJson,
    du_lieu_sau_json: afterJson,
    nguoi_thuc_hien_id: input.nguoi_thuc_hien_id,
    ly_do: reason,
    created_at: createdAt,
    version,
  };
}

