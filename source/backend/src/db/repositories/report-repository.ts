import type { DatabaseAdapter } from '../types.ts';

// ---------- Đánh dấu đã gửi báo cáo tháng (bao_cao_da_gui, migration 0007) ----------

export type ReportSendStatus = 'DANG_GUI' | 'DA_GUI' | 'LOI';

// Gửi lại tối đa (lỗi lâu dài như chặn bot / sai chat không thử mãi, không tốn lượt chụp ảnh)
export const REPORT_MAX_ATTEMPTS = 3;

// Giữ chỗ gửi báo cáo tháng `ky` cho 1 người. true = người này cần gửi (lần đầu, lần trước lỗi,
// hoặc lần trước kẹt ở DANG_GUI quá staleBeforeIso; chưa quá REPORT_MAX_ATTEMPTS lần); false = đã gửi / đang gửi / hết lượt.
export async function claimReportSend(
  db: DatabaseAdapter,
  i: { id: string; ky: string; thanhVienId: string; nowIso: string; staleBeforeIso: string },
): Promise<boolean> {
  const inserted = await db.queryOne<{ id: string }>(
    `INSERT INTO bao_cao_da_gui (id, ky, thanh_vien_id, trang_thai, so_lan, created_at, updated_at)
     VALUES ($1, $2, $3, 'DANG_GUI', 1, $4, $4)
     ON CONFLICT (ky, thanh_vien_id) DO NOTHING RETURNING id`,
    [i.id, i.ky, i.thanhVienId, i.nowIso],
  );
  if (inserted) {
    return true;
  }
  const res = await db.execute(
    `UPDATE bao_cao_da_gui SET trang_thai = 'DANG_GUI', so_lan = so_lan + 1, updated_at = $3, loi = NULL
     WHERE ky = $1 AND thanh_vien_id = $2 AND so_lan < $5
       AND (trang_thai = 'LOI' OR (trang_thai = 'DANG_GUI' AND updated_at < $4))`,
    [i.ky, i.thanhVienId, i.nowIso, i.staleBeforeIso, REPORT_MAX_ATTEMPTS],
  );
  return res.changes > 0;
}

export async function finishReportSend(
  db: DatabaseAdapter,
  i: { ky: string; thanhVienId: string; status: Exclude<ReportSendStatus, 'DANG_GUI'>; error: string | null; nowIso: string },
): Promise<void> {
  await db.execute(
    `UPDATE bao_cao_da_gui SET trang_thai = $3, loi = $4, updated_at = $5 WHERE ky = $1 AND thanh_vien_id = $2`,
    [i.ky, i.thanhVienId, i.status, i.error, i.nowIso],
  );
}
