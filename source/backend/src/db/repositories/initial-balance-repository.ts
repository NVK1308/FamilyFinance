import type { MemberId, MoneyHolderId } from '../../config/constants.ts';
import type { DatabaseAdapter, SoDuBanDauRecord } from '../types.ts';

// Gồm cả dòng đã xoá mềm (UNIQUE nguoi_giu_tien_id không loại deleted_at)
export function listAllInitialBalances(db: DatabaseAdapter): Promise<SoDuBanDauRecord[]> {
  return db.query<SoDuBanDauRecord>('SELECT * FROM so_du_ban_dau ORDER BY nguoi_giu_tien_id');
}

export function listActiveInitialBalances(db: DatabaseAdapter): Promise<SoDuBanDauRecord[]> {
  return db.query<SoDuBanDauRecord>(
    'SELECT * FROM so_du_ban_dau WHERE deleted_at IS NULL ORDER BY nguoi_giu_tien_id',
  );
}

export interface InitialBalanceInput {
  nguoi_giu_tien_id: MoneyHolderId;
  so_tien: number;
  ngay_ap_dung: string;
  nguoi_xac_nhan_id: MemberId | null;
  ghi_chu: string | null;
  nowIso: string;
}

export async function insertInitialBalance(
  db: DatabaseAdapter,
  id: string,
  input: InitialBalanceInput,
): Promise<void> {
  const version = await db.nextVersion();
  await db.execute(
    `INSERT INTO so_du_ban_dau (
      id, nguoi_giu_tien_id, so_tien, ngay_ap_dung, nguoi_xac_nhan_id, ghi_chu, created_at, updated_at, version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)`,
    [
      id,
      input.nguoi_giu_tien_id,
      input.so_tien,
      input.ngay_ap_dung,
      input.nguoi_xac_nhan_id,
      input.ghi_chu,
      input.nowIso,
      version,
    ],
  );
}

// Cập nhật dòng có sẵn, kể cả dòng đã xoá mềm (mở lại: deleted_at = NULL)
export async function updateInitialBalance(
  db: DatabaseAdapter,
  id: string,
  input: InitialBalanceInput,
): Promise<void> {
  const version = await db.nextVersion();
  await db.execute(
    `UPDATE so_du_ban_dau SET so_tien = $2, ngay_ap_dung = $3, nguoi_xac_nhan_id = $4, ghi_chu = $5,
       deleted_at = NULL, updated_at = $6, version = $7
     WHERE id = $1`,
    [id, input.so_tien, input.ngay_ap_dung, input.nguoi_xac_nhan_id, input.ghi_chu, input.nowIso, version],
  );
}
