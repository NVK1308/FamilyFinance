import type { DebtChangeType, LoanDirection, LoanStatus } from '../../config/constants.ts';
import { toSafeNumber, type DatabaseAdapter, type KhoanNoRecord, type LichSuNoRecord } from '../types.ts';

export interface NewLoanInput {
  id: string;
  ten_khoan_no: string;
  chieu_no: LoanDirection;
  doi_tac: string;
  so_tien_goc: number;
  ngay_phat_sinh: string;
  ngay_dao_han: string | null;
  ghi_chu: string | null;
  nowIso: string;
}

export async function insertLoan(db: DatabaseAdapter, input: NewLoanInput): Promise<void> {
  const version = await db.nextVersion();
  await db.execute(
    `INSERT INTO khoan_no (
      id, ten_khoan_no, chieu_no, doi_tac, so_tien_goc, du_no_hien_tai, ngay_phat_sinh,
      ngay_dao_han, trang_thai, ghi_chu, created_at, updated_at, version
    ) VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 'DANG_NO', $8, $9, $9, $10)`,
    [
      input.id,
      input.ten_khoan_no,
      input.chieu_no,
      input.doi_tac,
      input.so_tien_goc,
      input.ngay_phat_sinh,
      input.ngay_dao_han,
      input.ghi_chu,
      input.nowIso,
      version,
    ],
  );
}

export function getLoanById(db: DatabaseAdapter, id: string): Promise<KhoanNoRecord | null> {
  return db.queryOne<KhoanNoRecord>('SELECT * FROM khoan_no WHERE id = $1 AND deleted_at IS NULL', [id]);
}

export function listLoans(db: DatabaseAdapter): Promise<KhoanNoRecord[]> {
  return db.query<KhoanNoRecord>(
    'SELECT * FROM khoan_no WHERE deleted_at IS NULL ORDER BY ngay_phat_sinh, id',
  );
}

// Trừ dư nợ có điều kiện (khoá dòng trên Postgres, chặn trả vượt). Trả số dòng đổi.
export async function decreaseLoanBalance(
  db: DatabaseAdapter,
  id: string,
  amount: number,
  nowIso: string,
): Promise<number> {
  const version = await db.nextVersion();
  const res = await db.execute(
    `UPDATE khoan_no SET du_no_hien_tai = du_no_hien_tai - $2, updated_at = $3, version = $4
     WHERE id = $1 AND du_no_hien_tai >= $2 AND trang_thai = 'DANG_NO' AND deleted_at IS NULL`,
    [id, amount, nowIso, version],
  );
  return res.changes;
}

export async function updateLoanState(
  db: DatabaseAdapter,
  id: string,
  duNo: number,
  status: LoanStatus,
  nowIso: string,
): Promise<void> {
  const version = await db.nextVersion();
  await db.execute(
    `UPDATE khoan_no SET du_no_hien_tai = $2, trang_thai = $3, updated_at = $4, version = $5
     WHERE id = $1`,
    [id, duNo, status, nowIso, version],
  );
}

export interface NewDebtHistoryInput {
  id: string;
  khoan_no_id: string;
  giao_dich_id: string;
  loai_bien_dong: DebtChangeType;
  so_tien: number;
  ngay_ghi_nhan: string;
  ghi_chu: string | null;
  nowIso: string;
}

export async function insertDebtHistory(db: DatabaseAdapter, input: NewDebtHistoryInput): Promise<void> {
  const version = await db.nextVersion();
  await db.execute(
    `INSERT INTO lich_su_no (
      id, khoan_no_id, giao_dich_id, loai_bien_dong, so_tien, ngay_ghi_nhan, ghi_chu,
      created_at, updated_at, version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`,
    [
      input.id,
      input.khoan_no_id,
      input.giao_dich_id,
      input.loai_bien_dong,
      input.so_tien,
      input.ngay_ghi_nhan,
      input.ghi_chu,
      input.nowIso,
      version,
    ],
  );
}

export function listDebtHistoryByTransaction(
  db: DatabaseAdapter,
  giaoDichId: string,
): Promise<LichSuNoRecord[]> {
  return db.query<LichSuNoRecord>(
    'SELECT * FROM lich_su_no WHERE giao_dich_id = $1 AND deleted_at IS NULL',
    [giaoDichId],
  );
}

export function listDebtHistoryByLoan(db: DatabaseAdapter, loanId: string): Promise<LichSuNoRecord[]> {
  return db.query<LichSuNoRecord>(
    `SELECT * FROM lich_su_no WHERE khoan_no_id = $1 AND deleted_at IS NULL
     ORDER BY ngay_ghi_nhan, created_at, id`,
    [loanId],
  );
}

export async function softDeleteDebtHistoryByTransaction(
  db: DatabaseAdapter,
  giaoDichId: string,
  nowIso: string,
): Promise<number> {
  const version = await db.nextVersion();
  const res = await db.execute(
    `UPDATE lich_su_no SET deleted_at = $2, updated_at = $2, version = $3
     WHERE giao_dich_id = $1 AND deleted_at IS NULL`,
    [giaoDichId, nowIso, version],
  );
  return res.changes;
}

export interface LoanLedgerSums {
  giaiNgan: number;
  goc: number;
}

// Tổng giải ngân và tổng trả/thu gốc trên các dòng chưa xoá (lãi không tính)
export async function sumLoanLedger(db: DatabaseAdapter, loanId: string): Promise<LoanLedgerSums> {
  const row = await db.queryOne<{ giai_ngan: unknown; goc: unknown }>(
    `SELECT
       COALESCE(SUM(CASE WHEN loai_bien_dong = 'GIAI_NGAN' THEN so_tien ELSE 0 END), 0) AS giai_ngan,
       COALESCE(SUM(CASE WHEN loai_bien_dong IN ('TRA_GOC', 'THU_GOC') THEN so_tien ELSE 0 END), 0) AS goc
     FROM lich_su_no WHERE khoan_no_id = $1 AND deleted_at IS NULL`,
    [loanId],
  );
  return { giaiNgan: toSafeNumber(row?.giai_ngan), goc: toSafeNumber(row?.goc) };
}
