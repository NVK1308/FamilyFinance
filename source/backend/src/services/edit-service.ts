import {
  AUDIT_ACTION,
  DEFAULT_JAR_ID,
  MESSAGE_STATUS,
  TABLE_NAME,
  TRANSACTION_STATUS,
  type MemberId,
  type MoneyHolderId,
} from '../config/constants.ts';
import { insertAuditLog } from '../db/audit-repository.ts';
import {
  getTransactionByTelegramMessage,
  hasNewerAppliedEdit,
  listMessagesByTelegramId,
  updateLinkedSavingsAmount,
  updateTransactionAmount,
} from '../db/repositories/edit-repository.ts';
import { getJarById, getMessageByUpdateId, getSavingsMoveByTransaction, getTransactionById, updateMessageStatus } from '../db/repositories/index.ts';
import type { DatabaseAdapter, GiaoDichRecord, HuRecord, ThanhVienRecord } from '../db/types.ts';
import { extractAmountVnd } from '../parser/amount-parser.ts';
import { createParseContext, normalizeWhitespace } from '../parser/normalizer.ts';
import type { BalanceService } from './balance-service.ts';
import { resolveClock, type ServiceOptions } from './common.ts';
import { insertIncomingMessage, type IncomingMessage } from './message-outcome.ts';
import type { SavingsService } from './savings-service.ts';

// Sửa số tiền khoản đã ghi (người dùng chốt 12/11): chỉ số tiền, chỉ người nhập, trong 24 giờ kể từ lúc ghi.
// 2 đường: sửa tin gốc trong Telegram (SUA_TIN) / trả lời tin nhắc của nút "✏️ Sửa số tiền" (NUT_SUA).

export const EDIT_WINDOW_MS = 24 * 3_600_000;
// Loại sửa được: thu / chi (khoản vay / trả nợ / điều chỉnh không)
const EDITABLE_TYPES = new Set(['THU', 'CHI', 'PHI', 'LAI_VAY']);
// Tin gốc chưa ghi được (thiếu / mơ hồ số tiền, lỗi xử lý) → sửa tin = xử lý lại như tin mới
const RETRY_REASONS = new Set(['THIEU_SO_TIEN', 'SO_TIEN_MO_HO', 'THIEU_HOAC_MO_HO_SO_TIEN']);
// Lý do im lặng (không nhắc lại khi Telegram gửi lại)
const SILENT_REASONS = new Set(['SUA_CU', 'SUA_KHONG_DOI']);

export type EditSource = 'SUA_TIN' | 'NUT_SUA';

export type EditResult =
  | {
      kind: 'EDITED';
      before: GiaoDichRecord;
      after: GiaoDichRecord;
      jar: HuRecord | null;
      canhBaoVuotSoDu: boolean;
      canhBaoHuAm: boolean;
    }
  // Telegram gửi lại bản sửa đã áp (lỗi sau commit) → nhắc lại kết quả, không báo người kia lần nữa
  | { kind: 'REPLAY'; transaction: GiaoDichRecord }
  | { kind: 'REJECTED'; reason: string }
  | { kind: 'UNCHANGED' }
  // Gửi lại cùng update / bản sửa cũ đến sau bản mới → im lặng
  | { kind: 'IGNORED' }
  // Tin gốc chưa ghi được → xử lý tin sửa như tin mới
  | { kind: 'NEW_MESSAGE' }
  // Không có gì để sửa (lệnh, câu hỏi…) → im lặng
  | { kind: 'NOT_FOUND' };

// Số tiền + phần chữ còn lại (không dấu) của 1 câu
function splitAmount(text: string, senderId: MemberId): { amount: number | null; ambiguous: boolean; rest: string } {
  const ctx = createParseContext(text, { senderId });
  const r = extractAmountVnd(ctx);
  return { amount: r.amount, ambiguous: r.isAmbiguous, rest: normalizeWhitespace(ctx.workingAsciiText.replace(/[.,!?;:]+$/g, '')) };
}

// Trả lời tin nhắc: chỉ được là số tiền ("80k", "1tr5", "80.000đ")
export function amountOnly(text: string, senderId: MemberId): number | null {
  const r = splitAmount(text, senderId);
  return !r.ambiguous && r.amount !== null && /^(?:d|vnd|dong)?$/.test(r.rest) ? r.amount : null;
}

// Lý do không sửa được (null = sửa được). Dùng chung cho nút (ẩn / hiện) và lúc sửa.
export function editBlockReason(tx: GiaoDichRecord, now: Date): string | null {
  if (tx.deleted_at !== null) return 'SUA_KHONG_TIM_THAY';
  if (tx.trang_thai === TRANSACTION_STATUS.DA_HUY) return 'SUA_DA_HUY';
  if (tx.trang_thai !== TRANSACTION_STATUS.HOAN_TAT) return 'SUA_DANG_CHO';
  if (!EDITABLE_TYPES.has(tx.loai_giao_dich)) return 'SUA_LOAI_KHONG_HO_TRO';
  // Lãi vay gắn khoản nợ: sửa số tiền làm lệch lịch sử nợ → Huỷ rồi nhắn lại
  if (tx.khoan_no_id) return 'SUA_KHOAN_NO';
  if (now.getTime() - Date.parse(String(tx.created_at)) > EDIT_WINDOW_MS) return 'SUA_QUA_HAN';
  return null;
}

export function canEditAmount(tx: GiaoDichRecord, now: Date): boolean {
  return editBlockReason(tx, now) === null;
}

export class EditService {
  private readonly db: DatabaseAdapter;
  private readonly now: () => Date;
  private readonly balances: BalanceService;
  private readonly savings: SavingsService;

  constructor(db: DatabaseAdapter, savings: SavingsService, balances: BalanceService, options?: ServiceOptions) {
    this.db = db;
    this.now = resolveClock(options);
    this.balances = balances;
    this.savings = savings;
  }

  // Đường A: người dùng sửa tin gốc. incoming.receivedAt = thời điểm sửa (edit_date).
  async fromEditedMessage(incoming: IncomingMessage, sender: ThanhVienRecord): Promise<EditResult> {
    const found = await getTransactionByTelegramMessage(this.db, incoming.chatId, incoming.messageId);
    if (!found) {
      const rows = await listMessagesByTelegramId(this.db, incoming.chatId, incoming.messageId);
      const last = rows[rows.length - 1];
      if (!last) {
        return { kind: 'NOT_FOUND' };
      }
      // Lần trước chưa ghi được (thiếu số tiền / lỗi) → xử lý lại
      if (last.trang_thai_xu_ly === MESSAGE_STATUS.LOI || (last.trang_thai_xu_ly === MESSAGE_STATUS.DA_BO_QUA && RETRY_REASONS.has(last.chi_tiet_loi ?? ''))) {
        return { kind: 'NEW_MESSAGE' };
      }
      // Tin đã ghi thành chuyển tiền / quỹ chung / hũ → không sửa kiểu này
      if (rows.some((r) => r.trang_thai_xu_ly === MESSAGE_STATUS.DA_GHI || r.trang_thai_xu_ly === MESSAGE_STATUS.CHO_XAC_NHAN)) {
        return { kind: 'REJECTED', reason: 'SUA_LOAI_KHONG_HO_TRO' };
      }
      return { kind: 'NOT_FOUND' };
    }
    const memberId = sender.id as MemberId;
    const before = splitAmount(found.text, memberId);
    const after = splitAmount(incoming.text, memberId);
    const reason = after.rest !== before.rest ? 'SUA_CHI_SO_TIEN' : after.ambiguous || after.amount === null ? 'SUA_SO_TIEN_MO_HO' : null;
    return this.apply(incoming, sender, found.transaction.id, reason ? null : after.amount, 'SUA_TIN', reason);
  }

  // Đường B: trả lời tin nhắc "✏️ Nhập số tiền mới" bằng số tiền (kể cả sửa lại chính câu trả lời đó)
  fromReply(incoming: IncomingMessage, sender: ThanhVienRecord, giaoDichId: string): Promise<EditResult> {
    const amount = amountOnly(incoming.text, sender.id as MemberId);
    return this.apply(incoming, sender, giaoDichId, amount, 'NUT_SUA', amount === null ? 'SUA_SO_TIEN_MO_HO' : null);
  }

  private async apply(
    incoming: IncomingMessage,
    sender: ThanhVienRecord,
    giaoDichId: string,
    soTien: number | null,
    source: EditSource,
    parseReason: string | null,
  ): Promise<EditResult> {
    const now = this.now();
    const nowIso = now.toISOString();
    const result = await this.db.transaction(async (tx): Promise<EditResult> => {
      // Mỗi lần sửa = 1 dòng tin riêng (update_id mới)
      const messageId = await insertIncomingMessage(tx, incoming, sender.id, nowIso);
      if (!messageId) {
        // Telegram gửi lại cùng update (lần trước lỗi sau commit) → nhắc lại kết quả đã có
        const done = await getMessageByUpdateId(tx, incoming.updateId);
        if (done?.trang_thai_xu_ly === MESSAGE_STATUS.DA_GHI) {
          const current = await getTransactionById(tx, giaoDichId);
          return current ? { kind: 'REPLAY', transaction: current } : { kind: 'IGNORED' };
        }
        const reason = done?.chi_tiet_loi ?? '';
        return done?.trang_thai_xu_ly === MESSAGE_STATUS.DA_BO_QUA && reason.startsWith('SUA_') && !SILENT_REASONS.has(reason)
          ? { kind: 'REJECTED', reason }
          : { kind: 'IGNORED' };
      }
      const reject = async (reason: string): Promise<EditResult> => {
        await updateMessageStatus(tx, messageId, MESSAGE_STATUS.DA_BO_QUA, nowIso, reason);
        return { kind: 'REJECTED', reason };
      };
      const before = await getTransactionById(tx, giaoDichId);
      if (!before) return reject('SUA_KHONG_TIM_THAY');
      if (before.nguoi_tao_id !== sender.id) return reject('SUA_KHONG_PHAI_NGUOI_GHI');
      const blocked = editBlockReason(before, now);
      if (blocked) return reject(blocked);
      // Chi trả từ hũ đã xoá: khoá sổ (không đổi số tiền dòng lấy ra của hũ đã ẩn)
      const linkedJar = await this.savings.jarOfTransaction(tx, before.id);
      if (linkedJar && !Boolean(linkedJar.is_active)) return reject('SUA_HU_DA_XOA');
      if (parseReason || soTien === null) return reject(parseReason ?? 'SUA_SO_TIEN_MO_HO');
      // Bản sửa cũ đến sau bản mới (Telegram gửi lại sau lỗi tạm thời): đã có lần sửa mới hơn của tin này,
      // hoặc khoản đã đổi sau thời điểm sửa (nút sửa / đổi danh mục) → không quay về số cũ
      if (
        source === 'SUA_TIN' &&
        (Date.parse(String(before.updated_at)) > Date.parse(incoming.receivedAt) ||
          (await hasNewerAppliedEdit(tx, { chatId: incoming.chatId, messageId: incoming.messageId, receivedAt: incoming.receivedAt, updateId: incoming.updateId, selfId: messageId })))
      ) {
        await updateMessageStatus(tx, messageId, MESSAGE_STATUS.DA_BO_QUA, nowIso, 'SUA_CU');
        return { kind: 'IGNORED' };
      }
      if (soTien === Number(before.so_tien)) {
        await updateMessageStatus(tx, messageId, MESSAGE_STATUS.DA_BO_QUA, nowIso, 'SUA_KHONG_DOI');
        return { kind: 'UNCHANGED' };
      }
      if ((await updateTransactionAmount(tx, { id: before.id, soTien, expectedVersion: Number(before.version), nowIso })) === 0) {
        throw new Error(`Giao dịch ${before.id} vừa đổi, sửa lại sau`);
      }
      const after = (await getTransactionById(tx, before.id)) ?? before;
      await insertAuditLog(tx, {
        ten_bang: TABLE_NAME.GIAO_DICH,
        ban_ghi_id: before.id,
        hanh_dong: AUDIT_ACTION.UPDATE,
        du_lieu_truoc: before,
        du_lieu_sau: after,
        nguoi_thuc_hien_id: sender.id as MemberId,
        ly_do: source,
        nowIso,
      });
      // Chi trả từ hũ: dòng lấy ra hũ đi kèm đổi theo
      const linked = await getSavingsMoveByTransaction(tx, before.id);
      let jar: HuRecord | null = null;
      if (linked && linked.trang_thai === 'HOAN_TAT' && (await updateLinkedSavingsAmount(tx, before.id, soTien, nowIso)) > 0) {
        await insertAuditLog(tx, {
          ten_bang: TABLE_NAME.HU_TIET_KIEM,
          ban_ghi_id: linked.id,
          hanh_dong: AUDIT_ACTION.UPDATE,
          du_lieu_truoc: linked,
          du_lieu_sau: { ...linked, so_tien: soTien },
          nguoi_thuc_hien_id: sender.id as MemberId,
          ly_do: source,
          nowIso,
        });
        jar = await getJarById(tx, linked.hu_id ?? DEFAULT_JAR_ID);
      }
      await updateMessageStatus(tx, messageId, MESSAGE_STATUS.DA_GHI, nowIso);
      return { kind: 'EDITED', before, after, jar, canhBaoVuotSoDu: false, canhBaoHuAm: false };
    });
    // Cảnh báo sau commit (không chặn), như lúc ghi
    if (result.kind === 'EDITED') {
      const a = result.after;
      const holder = a.nguoi_giu_tien_id as MoneyHolderId | null;
      if (holder && a.loai_giao_dich !== 'THU' && Number(a.so_tien) > Number(result.before.so_tien) && !result.jar) {
        result.canhBaoVuotSoDu = await this.balances.isOverBalance(holder, holder === 'QUY_CHUNG' ? null : (a.nguoi_thuc_hien_id as MemberId), a.ngay_giao_dich);
      }
      if (result.jar) {
        try {
          result.canhBaoHuAm = (await this.savings.jarBalance(a.ngay_giao_dich, result.jar.id)) < 0;
        } catch (error) {
          console.error('Hũ: tính cảnh báo âm lỗi, bỏ cảnh báo', error);
        }
      }
    }
    return result;
  }
}
