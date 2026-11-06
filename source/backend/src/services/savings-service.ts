import {
  ASSET_TYPE,
  AUDIT_ACTION,
  MESSAGE_STATUS,
  SAVINGS_DIRECTION,
  TABLE_NAME,
  type MemberId,
  type SavingsSourceId,
} from '../config/constants.ts';
import { insertAuditLog } from '../db/audit-repository.ts';
import {
  getSavingsMoveById,
  getSavingsMoveByIdempotencyKey,
  insertSavingsMove,
  listRecentSavingsMoves,
  markSavingsMoveCancelled,
  updateMessageStatus,
} from '../db/repositories/index.ts';
import type { DatabaseAdapter, HuTietKiemRecord, ThanhVienRecord } from '../db/types.ts';
import type { ParsedSavingsResult } from '../parser/types.ts';
import { BalanceService } from './balance-service.ts';
import { DomainError, isUniqueViolation, newId, resolveClock, toVnDate, type ServiceOptions } from './common.ts';
import {
  ignoreMessage,
  insertIncomingMessage,
  loadExistingOutcome,
  requireMessage,
  telegramKey,
  withDuplicateFallback,
  type IncomingMessage,
  type RecordOutcome,
} from './message-outcome.ts';
import { memberGroup } from './transfer-service.ts';

export interface SavingsCancelResult {
  changed: boolean;
  move: HuTietKiemRecord;
}

// Hũ tiết kiệm (Phase 5c-1: tiền). Tài sản chung; ghi ngay, không cần xác nhận; không vào thu/chi.
export class SavingsService {
  private readonly db: DatabaseAdapter;
  private readonly now: () => Date;
  private readonly balances: BalanceService;

  constructor(db: DatabaseAdapter, options?: ServiceOptions) {
    this.db = db;
    this.now = resolveClock(options);
    this.balances = new BalanceService(db, options);
  }

  // Tin "bỏ hũ tiết kiệm 5tr" / "rút hũ 2tr" / "khai báo hũ tiết kiệm 50tr"
  async recordFromParsed(msg: IncomingMessage, parsed: ParsedSavingsResult, sender: ThanhVienRecord): Promise<RecordOutcome> {
    const now = this.now();
    const nowIso = now.toISOString();
    const outcome = await withDuplicateFallback(this.db, msg.updateId, () =>
      this.db.transaction(async (tx): Promise<RecordOutcome> => {
        const messageId = await insertIncomingMessage(tx, msg, sender.id, nowIso);
        if (!messageId) {
          return loadExistingOutcome(tx, msg.updateId);
        }
        const group = memberGroup(sender);
        const reason = rejectReason(parsed, group, toVnDate(now));
        if (reason || group === null) {
          return ignoreMessage(tx, messageId, reason ?? 'HU_NGUOI_GUI_KHONG_HOP_LE', nowIso);
        }
        const declare = parsed.chieu === SAVINGS_DIRECTION.KHAI_BAO;
        const move = await this.insert(tx, {
          chieu: parsed.chieu,
          soTien: parsed.so_tien as number,
          // Nguồn tiền mặt là nhóm của người gửi (theo vai trò), hoặc quỹ chung
          nguon: declare ? null : parsed.nguon_id === 'QUY_CHUNG' ? 'QUY_CHUNG' : group,
          memberId: sender.id as MemberId,
          ngay: parsed.ngay,
          messageId,
          key: telegramKey(msg.updateId),
          ghiChu: parsed.mo_ta,
          nowIso,
        });
        await updateMessageStatus(tx, messageId, MESSAGE_STATUS.DA_GHI, nowIso);
        return { kind: 'SAVINGS_MOVE', duplicate: false, message: await requireMessage(tx, messageId), move, canhBaoVuotSoDu: false };
      }),
    );
    if (outcome.kind === 'SAVINGS_MOVE' && !outcome.duplicate) {
      outcome.canhBaoVuotSoDu = await this.isOverBalance(outcome.move);
    }
    return outcome;
  }

  // Lệnh /tietkiemdau <tiền>: khai báo tiền đang để dành (không trừ ai). key chống ghi 2 lần khi Telegram gửi lại.
  async declare(sender: ThanhVienRecord, soTien: number, key: string): Promise<{ move: HuTietKiemRecord; duplicate: boolean }> {
    if (!Number.isSafeInteger(soTien) || soTien <= 0) {
      throw new DomainError('INVALID_INPUT', 'Số tiền phải lớn hơn 0');
    }
    // Cùng điều kiện với đường nhắn tin: chỉ vợ / chồng
    if (memberGroup(sender) === null) {
      throw new DomainError('FORBIDDEN', 'HU_NGUOI_GUI_KHONG_HOP_LE');
    }
    const memberId = sender.id as MemberId;
    const nowIso = this.now().toISOString();
    const existing = await getSavingsMoveByIdempotencyKey(this.db, key);
    if (existing) {
      return { move: existing, duplicate: true };
    }
    try {
      const move = await this.db.transaction((tx) =>
        this.insert(tx, {
          chieu: SAVINGS_DIRECTION.KHAI_BAO,
          soTien,
          nguon: null,
          memberId,
          ngay: toVnDate(this.now()),
          messageId: null,
          key,
          ghiChu: 'Khai báo qua bot',
          nowIso,
        }),
      );
      return { move, duplicate: false };
    } catch (error) {
      const raced = isUniqueViolation(error) ? await getSavingsMoveByIdempotencyKey(this.db, key) : null;
      if (raced) {
        return { move: raced, duplicate: true };
      }
      throw error;
    }
  }

  // Người ghi huỷ dòng nhập nhầm → số dư trả lại
  async cancel(moveId: string, nguoiHuyId: MemberId): Promise<SavingsCancelResult> {
    const nowIso = this.now().toISOString();
    return this.db.transaction(async (tx) => {
      const move = await getSavingsMoveById(tx, moveId);
      if (!move) {
        throw new DomainError('NOT_FOUND', `Không tìm thấy dòng hũ tiết kiệm ${moveId}`);
      }
      if (move.thanh_vien_id !== nguoiHuyId) {
        throw new DomainError('FORBIDDEN', 'Chỉ người ghi được huỷ');
      }
      if ((await markSavingsMoveCancelled(tx, move.id, nowIso)) === 0) {
        return { changed: false, move: (await getSavingsMoveById(tx, move.id)) ?? move };
      }
      const after = (await getSavingsMoveById(tx, move.id)) ?? move;
      await audit(tx, move.id, AUDIT_ACTION.CANCEL, move, after, nguoiHuyId, nowIso);
      return { changed: true, move: after };
    });
  }

  getJar(asOf: string): Promise<{ tien: number; soDong: number }> {
    return this.balances.getSavingsJar(asOf);
  }

  listRecent(limit: number): Promise<HuTietKiemRecord[]> {
    return listRecentSavingsMoves(this.db, limit);
  }

  private async insert(
    tx: DatabaseAdapter,
    i: {
      chieu: HuTietKiemRecord['chieu'];
      soTien: number;
      nguon: SavingsSourceId | null;
      memberId: MemberId;
      ngay: string;
      messageId: string | null;
      key: string;
      ghiChu: string | null;
      nowIso: string;
    },
  ): Promise<HuTietKiemRecord> {
    const move = await insertSavingsMove(tx, {
      id: newId('HK'),
      chieu: i.chieu,
      loai_tai_san: ASSET_TYPE.TIEN,
      so_luong_phan: null,
      so_tien: i.soTien,
      nguon_id: i.nguon,
      thanh_vien_id: i.memberId,
      ngay: i.ngay,
      source_message_id: i.messageId,
      idempotency_key: i.key,
      ghi_chu: i.ghiChu,
      nowIso: i.nowIso,
    });
    await audit(tx, move.id, AUDIT_ACTION.CREATE, null, move, i.memberId, i.nowIso);
    return move;
  }

  // Cảnh báo sau commit (không chặn): bỏ vào → nguồn âm (trừ chuyển đang chờ của người đó); lấy ra → hũ âm.
  // Lỗi khi tính → không cảnh báo (bản ghi đã commit).
  private async isOverBalance(move: HuTietKiemRecord): Promise<boolean> {
    if (move.chieu === SAVINGS_DIRECTION.NOP && move.nguon_id !== null) {
      const member = move.nguon_id === 'QUY_CHUNG' ? null : move.thanh_vien_id;
      return this.balances.isOverBalance(move.nguon_id, member, move.ngay);
    }
    if (move.chieu !== SAVINGS_DIRECTION.RUT) {
      return false;
    }
    try {
      return (await this.balances.getSavingsJar(move.ngay)).tien < 0;
    } catch (error) {
      console.error('Hũ tiết kiệm: tính cảnh báo lỗi, bỏ cảnh báo', error);
      return false;
    }
  }
}

// Lý do không ghi (null = ghi được)
function rejectReason(parsed: ParsedSavingsResult, group: 'VO' | 'CHONG' | null, today: string): string | null {
  if (parsed.ly_do_chua_ho_tro) {
    return parsed.ly_do_chua_ho_tro;
  }
  if (parsed.so_tien === null) {
    return parsed.so_tien_mo_ho ? 'SO_TIEN_MO_HO' : 'THIEU_SO_TIEN';
  }
  if (group === null) {
    return 'HU_NGUOI_GUI_KHONG_HOP_LE';
  }
  return parsed.ngay > today ? 'NGAY_TUONG_LAI' : null;
}

async function audit(
  tx: DatabaseAdapter,
  id: string,
  action: (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION],
  before: unknown,
  after: unknown,
  actor: MemberId,
  nowIso: string,
): Promise<void> {
  await insertAuditLog(tx, {
    ten_bang: TABLE_NAME.HU_TIET_KIEM,
    ban_ghi_id: id,
    hanh_dong: action,
    du_lieu_truoc: before,
    du_lieu_sau: after,
    nguoi_thuc_hien_id: actor,
    ly_do: null,
    nowIso,
  });
}
