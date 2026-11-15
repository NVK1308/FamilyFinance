import { AUDIT_ACTION, CATEGORY_CODE, TABLE_NAME, type MemberId, type MoneyHolderId } from '../config/constants.ts';
import type { Settings } from '../config/settings.ts';
import { insertAuditLog } from '../db/audit-repository.ts';
import { getActiveCategoryByCode, getCategoryById } from '../db/repositories/index.ts';
import {
  claimReminder,
  closeDue,
  expireDues as expireOverdue,
  findSameCategoryInMonth,
  getActiveItemByName,
  getDue,
  getItemById,
  getReminder,
  insertDueIfMissing,
  insertItem,
  listActiveItems,
  listDues,
  listItemsForMonth,
  setDueTransaction,
  stopItem,
  stopPendingDues,
  updateItem,
  type DueRow,
  type ItemFields,
  type KhoanDinhKyRecord,
  type RecurringType,
} from '../db/repositories/recurring-repository.ts';
import type { DatabaseAdapter, GiaoDichRecord } from '../db/types.ts';
import { findCategoryByKeyword } from '../parser/category-matcher.ts';
import { normalizeWhitespace, removeVietnameseDiacritics } from '../parser/normalizer.ts';
import { DomainError, newId, resolveClock, toVnDate, toVnHour, type ServiceOptions } from './common.ts';
import { recordExplicitInTx } from './transaction-service.ts';

export const MAX_ACTIVE_ITEMS = 30;
const OTHER_CODE: Record<RecurringType, string> = { THU: CATEGORY_CODE.THU_KHAC, CHI: CATEGORY_CODE.CHI_KHAC };

// ---------- Ngày / kỳ (chuỗi 'YYYY-MM-DD' / 'YYYY-MM', không phụ thuộc múi giờ máy) ----------

export function monthOf(dayIso: string): string {
  return dayIso.slice(0, 7);
}

export function shiftMonth(ky: string, delta: number): string {
  const [y, m] = ky.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Ngày nhắc của kỳ: ngày N, tháng ngắn hơn → ngày cuối tháng
export function dueDateOf(ky: string, dayOfMonth: number): string {
  const [y, m] = ky.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ky}-${String(Math.min(dayOfMonth, last)).padStart(2, '0')}`;
}

export function addDays(dayIso: string, days: number): string {
  const d = new Date(`${dayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function lastDayOf(ky: string): string {
  return dueDateOf(ky, 31);
}

export function nameKey(ten: string): string {
  return normalizeWhitespace(removeVietnameseDiacritics(ten.normalize('NFC').toLowerCase()));
}

// Khoản tạo trước giờ nhắc của ngày nhắc tháng này → nhắc ngay tháng này; còn lại → từ tháng sau
export function startMonthFor(today: string, ngayNhac: number, hourVn = 0, gioNhac = 0): string {
  const ky = monthOf(today);
  const due = dueDateOf(ky, ngayNhac);
  return today < due || (today === due && hourVn < gioNhac) ? ky : shiftMonth(ky, 1);
}

// ---------- Kết quả ----------

export type UpsertResult =
  | { kind: 'CREATED' | 'UPDATED'; item: KhoanDinhKyRecord; categoryName: string }
  | { kind: 'LIMIT' };

export type PayResult =
  | { kind: 'PAID'; due: DueRow; transaction: GiaoDichRecord; fallbackCategory: boolean }
  | { kind: 'DONE'; due: DueRow }
  | { kind: 'STOPPED'; due: DueRow }
  | { kind: 'NOT_FOUND' };

export type SkipResult = { kind: 'SKIPPED'; due: DueRow } | { kind: 'DONE'; due: DueRow } | { kind: 'NOT_FOUND' };

// Dòng của tin nhắc chung / danh sách: lần + gợi ý trùng (chỉ khi còn chờ)
export interface DueLine {
  due: DueRow;
  hint: { so_tien: number; ngay_giao_dich: string } | null;
  // Số đã ghi thật (có thể khác số dự kiến khi bấm "Số khác")
  paidAmount: number | null;
}

export interface ReminderTask {
  ky: string;
  memberId: MemberId;
  lanNhac: 1 | 2;
  // Tin lần 1 (lần 2 gửi xong thì gỡ nút của tin cũ)
  previousMessageId: number | null;
}

export class RecurringService {
  private readonly db: DatabaseAdapter;
  private readonly now: () => Date;

  constructor(db: DatabaseAdapter, options?: ServiceOptions) {
    this.db = db;
    this.now = resolveClock(options);
  }

  // Danh mục theo tên ("tiền điện" → Điện); không nhận ra / ngừng hoạt động → Chi khác
  private async categoryFor(ten: string): Promise<{ loai: RecurringType; danhMucId: string; name: string }> {
    const match = findCategoryByKeyword(nameKey(ten));
    const loai: RecurringType = match?.scope === 'THU' ? 'THU' : 'CHI';
    const found = match ? await getActiveCategoryByCode(this.db, match.code) : null;
    const category = found ?? (await getActiveCategoryByCode(this.db, OTHER_CODE[loai]));
    if (!category) {
      throw new DomainError('INVALID_INPUT', `Thiếu danh mục ${OTHER_CODE[loai]}`);
    }
    return { loai, danhMucId: category.id, name: category.ten_danh_muc };
  }

  // Tạo khoản mới hoặc cập nhật khoản đang chạy cùng tên
  async upsert(member: MemberId, input: { ten: string; soTien: number; holder: MoneyHolderId }, settings: Settings): Promise<UpsertResult> {
    const nowIso = this.now().toISOString();
    const ten = normalizeWhitespace(input.ten.normalize('NFC')).slice(0, 100);
    const category = await this.categoryFor(ten);
    const fields: ItemFields = {
      ten: ten.charAt(0).toUpperCase() + ten.slice(1),
      tenChuan: nameKey(ten),
      loai: category.loai,
      soTien: input.soTien,
      danhMucId: category.danhMucId,
      nguoiGiuTienId: input.holder,
    };
    return this.db.transaction(async (tx): Promise<UpsertResult> => {
      const existing = await getActiveItemByName(tx, fields.tenChuan);
      if (existing) {
        // Gõ lại cùng tên (khác hoa / thường, dấu cách) → giữ tên hiển thị cũ
        await updateItem(tx, existing.id, { ...fields, ten: existing.ten }, nowIso);
        const after = (await getItemById(tx, existing.id))!;
        await insertAuditLog(tx, {
          ten_bang: TABLE_NAME.KHOAN_DINH_KY,
          ban_ghi_id: existing.id,
          hanh_dong: AUDIT_ACTION.UPDATE,
          du_lieu_truoc: existing,
          du_lieu_sau: after,
          nguoi_thuc_hien_id: member,
          ly_do: '/dinhky',
          nowIso,
        });
        return { kind: 'UPDATED', item: after, categoryName: category.name };
      }
      if ((await listActiveItems(tx)).length >= MAX_ACTIVE_ITEMS) {
        return { kind: 'LIMIT' };
      }
      const id = newId('KDK');
      const batDauKy = startMonthFor(toVnDate(this.now()), settings['dinh_ky.ngay_nhac'], toVnHour(this.now()), settings['dinh_ky.gio_nhac']);
      await insertItem(tx, { ...fields, id, batDauKy, nguoiTaoId: member, nowIso });
      const item = (await getItemById(tx, id))!;
      await insertAuditLog(tx, {
        ten_bang: TABLE_NAME.KHOAN_DINH_KY,
        ban_ghi_id: id,
        hanh_dong: AUDIT_ACTION.CREATE,
        du_lieu_sau: item,
        nguoi_thuc_hien_id: member,
        ly_do: '/dinhky',
        nowIso,
      });
      return { kind: 'CREATED', item, categoryName: category.name };
    });
  }

  listItems(): Promise<KhoanDinhKyRecord[]> {
    return listActiveItems(this.db);
  }

  getItem(id: string): Promise<KhoanDinhKyRecord | null> {
    return getItemById(this.db, id);
  }

  getDue(id: string): Promise<DueRow | null> {
    return getDue(this.db, id);
  }

  // Dừng khoản + đóng lần đang chờ. changed = false khi đã dừng trước đó.
  async stop(itemId: string, member: MemberId): Promise<{ changed: boolean; item: KhoanDinhKyRecord | null }> {
    const nowIso = this.now().toISOString();
    return this.db.transaction(async (tx) => {
      const before = await getItemById(tx, itemId);
      if (!before || (await stopItem(tx, itemId, nowIso)) === 0) {
        return { changed: false, item: before };
      }
      await stopPendingDues(tx, itemId, member, nowIso);
      const after = await getItemById(tx, itemId);
      await insertAuditLog(tx, {
        ten_bang: TABLE_NAME.KHOAN_DINH_KY,
        ban_ghi_id: itemId,
        hanh_dong: AUDIT_ACTION.CANCEL,
        du_lieu_truoc: before,
        du_lieu_sau: after,
        nguoi_thuc_hien_id: member,
        ly_do: 'Dừng khoản định kỳ',
        nowIso,
      });
      return { changed: true, item: after };
    });
  }

  // Kỳ còn xử lý được hôm nay: kỳ này và kỳ trước (hạn đóng có thể sang tháng sau)
  private openMonths(today: string): string[] {
    const ky = monthOf(today);
    return [shiftMonth(ky, -1), ky];
  }

  // Cron: tạo lần còn thiếu (đã tới ngày nhắc, chưa quá hạn đóng) + đóng lần quá hạn. Trả số lần mới.
  async ensureDues(today: string, settings: Settings): Promise<number> {
    const nowIso = this.now().toISOString();
    let created = 0;
    for (const ky of this.openMonths(today)) {
      const ngayDenHan = dueDateOf(ky, settings['dinh_ky.ngay_nhac']);
      const hanDong = addDays(ngayDenHan, settings['dinh_ky.so_ngay_dong']);
      if (today < ngayDenHan || today > hanDong) {
        continue;
      }
      // Chỉ chèn khoản chưa có lần của kỳ (không tốn version cho dòng đã có)
      const existing = new Set((await listDues(this.db, ky)).map((d) => d.khoan_dinh_ky_id));
      for (const item of await listItemsForMonth(this.db, ky)) {
        if (!existing.has(item.id) && (await insertDueIfMissing(this.db, { id: newId('DKL'), item, ky, ngayDenHan, hanDong, nowIso }))) {
          created += 1;
        }
      }
    }
    await expireOverdue(this.db, today, nowIso);
    return created;
  }

  // Cron: tin nhắc cần gửi (mỗi người / kỳ: lần 1, rồi lần 2 sau N ngày nếu còn khoản chờ)
  async reminderTasks(today: string, settings: Settings, members: readonly MemberId[]): Promise<ReminderTask[]> {
    const tasks: ReminderTask[] = [];
    const again = settings['dinh_ky.so_ngay_nhac_lai'];
    for (const ky of this.openMonths(today)) {
      for (const memberId of members) {
        const dues = await listDues(this.db, ky, memberId);
        if (!dues.some((d) => d.trang_thai === 'CHO')) {
          continue;
        }
        const first = await getReminder(this.db, ky, memberId, 1);
        if (!first || first.trang_thai !== 'DA_GUI') {
          tasks.push({ ky, memberId, lanNhac: 1, previousMessageId: null });
          continue;
        }
        const second = again > 0 ? await getReminder(this.db, ky, memberId, 2) : null;
        const sentDay = first.gui_luc ? toVnDate(new Date(first.gui_luc)) : today;
        if (again > 0 && second?.trang_thai !== 'DA_GUI' && addDays(sentDay, again) <= today) {
          tasks.push({ ky, memberId, lanNhac: 2, previousMessageId: first.telegram_message_id });
        }
      }
    }
    return tasks;
  }

  claimReminder(task: ReminderTask, today: string, staleBeforeIso: string): Promise<boolean> {
    return claimReminder(this.db, {
      id: newId('NDK'),
      ky: task.ky,
      memberId: task.memberId,
      lanNhac: task.lanNhac,
      today,
      nowIso: this.now().toISOString(),
      staleBeforeIso,
    });
  }

  // Tin nhắc đang còn nút của 1 người / kỳ (lần 2 nếu đã gửi, không thì lần 1) → để vẽ lại khi bấm
  async liveReminder(ky: string, memberId: string): Promise<{ lanNhac: number; messageId: number } | null> {
    for (const lanNhac of [2, 1]) {
      const r = await getReminder(this.db, ky, memberId, lanNhac);
      if (r?.trang_thai === 'DA_GUI' && r.telegram_message_id !== null) {
        return { lanNhac, messageId: r.telegram_message_id };
      }
    }
    return null;
  }

  // Các dòng của tin nhắc chung cho 1 người (khoản mình trả / nhận + quỹ chung), kèm gợi ý trùng cho khoản chờ
  async dueLines(ky: string, memberId: string): Promise<DueLine[]> {
    const lines: DueLine[] = [];
    for (const due of await listDues(this.db, ky, memberId)) {
      // Chỉ khoản còn chờ, danh mục cụ thể (Chi khác / Thu khác luôn khớp sai) mới hỏi gợi ý trùng
      const isOther = !due.ma_danh_muc || due.ma_danh_muc === CATEGORY_CODE.CHI_KHAC || due.ma_danh_muc === CATEGORY_CODE.THU_KHAC;
      const hint =
        due.trang_thai !== 'CHO' || isOther
          ? null
          : await findSameCategoryInMonth(this.db, { danhMucId: due.danh_muc_id, holder: due.nguoi_giu_tien_id, from: `${ky}-01`, to: lastDayOf(ky) });
      lines.push({ due, hint, paidAmount: due.so_tien_da_ghi });
    }
    return lines;
  }

  // Người có tin nhắc chứa lần này (quỹ chung → cả hai)
  static holdersOf(due: { nguoi_giu_tien_id: string }): MemberId[] {
    return due.nguoi_giu_tien_id === 'QUY_CHUNG' ? ['VO', 'CHONG'] : [due.nguoi_giu_tien_id as MemberId];
  }

  // Bấm "Đã trả / Đã nhận" (soTien null = số đã chụp lại) hoặc trả lời tin "Số khác"
  async pay(dueId: string, member: MemberId, soTien: number | null): Promise<PayResult> {
    const nowIso = this.now().toISOString();
    const today = toVnDate(this.now());
    return this.db.transaction(async (tx): Promise<PayResult> => {
      const due = await this.currentDue(tx, dueId, today, nowIso);
      if (!due) {
        return { kind: 'NOT_FOUND' };
      }
      if (due.trang_thai === 'CHO' && !due.khoan_active) {
        return { kind: 'STOPPED', due };
      }
      // Khoá dòng trước khi ghi: lượt bấm thứ 2 chờ lượt 1 xong rồi thấy 0 dòng
      if ((await closeDue(tx, dueId, 'DA_GHI', member, nowIso)) === 0) {
        return { kind: 'DONE', due: (await getDue(tx, dueId)) ?? due };
      }
      const category = await getCategoryById(tx, due.danh_muc_id);
      const usable = category && category.is_active && category.deleted_at === null && (category.loai_giao_dich === due.loai_giao_dich || category.loai_giao_dich === 'CA_HAI');
      const { transaction } = await recordExplicitInTx(
        tx,
        {
          // Khoá theo lần + số lần đã huỷ (bỏ tiền tố DKL_ cho khớp dạng api:<hex>)
          idempotencyKey: `api:${due.id.slice(4)}-${due.so_lan_ghi}`,
          loai: due.loai_giao_dich,
          soTien: soTien ?? due.so_tien,
          maDanhMuc: usable ? category.ma_danh_muc : OTHER_CODE[due.loai_giao_dich],
          nguoiTaoId: member,
          nguoiGiuTienId: due.nguoi_giu_tien_id,
          moTa: `${due.ten} tháng ${due.ky.slice(5)}/${due.ky.slice(0, 4)} (định kỳ)`,
          ngayGiaoDich: today,
        },
        nowIso,
      );
      await setDueTransaction(tx, dueId, transaction.id, nowIso);
      return { kind: 'PAID', due: (await getDue(tx, dueId))!, transaction, fallbackCategory: !usable };
    });
  }

  // Đọc lần; quá hạn đóng mà cron chưa kịp đóng (cron chỉ chạy từ giờ nhắc) → đóng QUA_HAN ngay, bấm muộn không ghi
  private async currentDue(tx: DatabaseAdapter, dueId: string, today: string, nowIso: string): Promise<DueRow | null> {
    const due = await getDue(tx, dueId);
    if (due?.trang_thai === 'CHO' && today > due.han_dong) {
      await expireOverdue(tx, today, nowIso);
      return getDue(tx, dueId);
    }
    return due;
  }

  // "Tháng này không có"
  async skip(dueId: string, member: MemberId): Promise<SkipResult> {
    const nowIso = this.now().toISOString();
    const today = toVnDate(this.now());
    return this.db.transaction(async (tx): Promise<SkipResult> => {
      const due = await this.currentDue(tx, dueId, today, nowIso);
      if (!due) {
        return { kind: 'NOT_FOUND' };
      }
      if ((await closeDue(tx, dueId, 'BO_QUA', member, nowIso)) === 0) {
        return { kind: 'DONE', due: (await getDue(tx, dueId)) ?? due };
      }
      return { kind: 'SKIPPED', due: (await getDue(tx, dueId))! };
    });
  }
}
