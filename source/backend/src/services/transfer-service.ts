import {
  AUDIT_ACTION,
  CONFIRMATION_EXPIRY_DAYS,
  CONFIRMATION_STATUS,
  CONFIRMATION_TYPE,
  FUND_DIRECTION,
  MESSAGE_STATUS,
  MONEY_HOLDER_ID,
  TABLE_NAME,
  TRANSFER_STATUS,
  type MemberId,
  type MoneyHolderId,
} from '../config/constants.ts';
import { insertAuditLog } from '../db/audit-repository.ts';
import {
  closeConfirmation,
  getFundMoveById,
  getMemberById,
  getTransferById,
  getTransferByMessage,
  insertConfirmation,
  insertFundMove,
  insertTransfer,
  isActiveMember,
  listConfirmationsByMessage,
  listPendingTransfers,
  markFundMoveCancelled,
  markTransferCancelled,
  markTransferConfirmed,
  updateMessageStatus,
} from '../db/repositories/index.ts';
import type {
  ChuyenQuyChungRecord,
  ChuyenTienNoiBoRecord,
  DatabaseAdapter,
  ThanhVienRecord,
  YeuCauXacNhanRecord,
} from '../db/types.ts';
import type { ParsedFundTransferResult, ParsedTransferResult } from '../parser/types.ts';
import { BalanceService } from './balance-service.ts';
import { DomainError, addDaysIso, newId, resolveClock, toVnDate, type ServiceOptions } from './common.ts';
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

export type TransferReply = 'DA_NHAN' | 'CHUA_NHAN';

export interface TransferReplyResult {
  changed: boolean;
  // "Đã nhận" sau hạn 7 ngày → không đổi (job hết hạn chuyển cả chuyển + yêu cầu sang HET_HAN)
  expired: boolean;
  transfer: ChuyenTienNoiBoRecord;
}

export interface TransferCancelResult {
  changed: boolean;
  transfer: ChuyenTienNoiBoRecord;
}

export interface FundCancelResult {
  changed: boolean;
  fundMove: ChuyenQuyChungRecord;
}

// Nhóm giữ tiền của thành viên; chỉ VO/CHONG được chuyển (QUAN_TRI làm lệch số dư nhóm)
export function memberGroup(member: ThanhVienRecord | null): 'VO' | 'CHONG' | null {
  if (!isActiveMember(member)) {
    return null;
  }
  return member.vai_tro === 'VO' || member.vai_tro === 'CHONG' ? member.vai_tro : null;
}

// Lý do không ghi dòng quỹ chung (null = ghi được)
function fundRejectReason(
  parsed: ParsedFundTransferResult,
  group: 'VO' | 'CHONG' | null,
  today: string,
): string | null {
  if (parsed.ly_do_chua_ho_tro) {
    return parsed.ly_do_chua_ho_tro;
  }
  if (parsed.so_tien === null) {
    return parsed.so_tien_mo_ho ? 'SO_TIEN_MO_HO' : 'THIEU_SO_TIEN';
  }
  if (group === null) {
    return 'NGUOI_GUI_KHONG_HOP_LE';
  }
  return parsed.ngay_chuyen > today ? 'NGAY_TUONG_LAI' : null;
}

export class TransferService {
  private readonly db: DatabaseAdapter;
  private readonly now: () => Date;

  constructor(db: DatabaseAdapter, options?: ServiceOptions) {
    this.db = db;
    this.now = resolveClock(options);
  }

  // Tin "chuyển vợ 3tr": chuyển CHO_XAC_NHAN + yêu cầu CHUYEN_TIEN cho người nhận, 1 transaction.
  // Thiếu thông tin / chưa hỗ trợ → chỉ lưu tin DA_BO_QUA + lý do (không dùng luồng hỏi lại của giao dịch).
  async recordTransferFromParsed(
    msg: IncomingMessage,
    parsed: ParsedTransferResult,
    sender: ThanhVienRecord,
  ): Promise<RecordOutcome> {
    const now = this.now();
    const nowIso = now.toISOString();
    const outcome = await withDuplicateFallback(this.db, msg.updateId, () =>
      this.db.transaction(async (tx): Promise<RecordOutcome> => {
        const messageId = await insertIncomingMessage(tx, msg, sender.id, nowIso);
        if (!messageId) {
          return loadExistingOutcome(tx, msg.updateId);
        }
        const reason = await this.transferRejectReason(tx, parsed, sender, toVnDate(now));
        if (reason) {
          return ignoreMessage(tx, messageId, reason, nowIso);
        }
        const transfer = await insertTransfer(tx, {
          id: newId('CT'),
          nguoi_chuyen_id: parsed.nguoi_chuyen_id,
          nguoi_nhan_id: parsed.nguoi_nhan_id,
          so_tien: parsed.so_tien as number,
          ngay_chuyen: parsed.ngay_chuyen,
          source_message_id: messageId,
          idempotency_key: telegramKey(msg.updateId),
          ghi_chu: parsed.mo_ta,
          nowIso,
        });
        const confirmation = await insertConfirmation(tx, {
          id: newId('YC'),
          source_message_id: messageId,
          nguoi_tao_id: sender.id,
          nguoi_can_xac_nhan_id: parsed.nguoi_nhan_id,
          loai_xac_nhan: CONFIRMATION_TYPE.CHUYEN_TIEN,
          du_lieu_de_xuat: { chuyen_tien_id: transfer.id, parsed },
          expires_at: addDaysIso(now, CONFIRMATION_EXPIRY_DAYS),
          nowIso,
        });
        await this.audit(tx, TABLE_NAME.CHUYEN_TIEN_NOI_BO, transfer.id, AUDIT_ACTION.CREATE, null, transfer, sender.id, null, nowIso);
        await updateMessageStatus(tx, messageId, MESSAGE_STATUS.CHO_XAC_NHAN, nowIso);
        return {
          kind: 'TRANSFER',
          duplicate: false,
          message: await requireMessage(tx, messageId),
          transfer,
          confirmation,
          canhBaoVuotSoDu: false,
        };
      }),
    );
    if (outcome.kind === 'TRANSFER' && !outcome.duplicate) {
      const from = memberGroup(sender);
      outcome.canhBaoVuotSoDu =
        from !== null && (await this.isOverBalance(from, sender.id, outcome.transfer.ngay_chuyen));
    }
    return outcome;
  }

  // Người nhận trả lời (gọi trong transaction của resolveConfirmation — không tự mở transaction).
  // Thứ tự khoá cố định: chuyen_tien_noi_bo → yeu_cau_xac_nhan → tin → audit.
  async respondTransferInTx(
    tx: DatabaseAdapter,
    request: YeuCauXacNhanRecord,
    reply: TransferReply,
    now: Date,
  ): Promise<TransferReplyResult> {
    const nowIso = now.toISOString();
    const transfer = await this.requireTransferOfRequest(tx, request);
    if (transfer.trang_thai !== TRANSFER_STATUS.CHO_XAC_NHAN) {
      return { changed: false, expired: false, transfer };
    }
    // "Chưa nhận": giữ chờ (chuyển khoản có thể chậm), chỉ ghi lại lịch sử
    if (reply === 'CHUA_NHAN') {
      await this.audit(tx, TABLE_NAME.CHUYEN_TIEN_NOI_BO, transfer.id, AUDIT_ACTION.UPDATE, null, null, request.nguoi_can_xac_nhan_id, 'CHUA_NHAN', nowIso);
      return { changed: false, expired: false, transfer };
    }
    if (Date.parse(request.expires_at) <= now.getTime()) {
      return { changed: false, expired: true, transfer };
    }
    const receiver = await getMemberById(tx, transfer.nguoi_nhan_id);
    if (!receiver) {
      throw new Error(`Không tìm thấy người nhận ${transfer.nguoi_nhan_id}`);
    }
    if ((await markTransferConfirmed(tx, transfer.id, receiver.telegram_user_id, nowIso)) === 0) {
      return { changed: false, expired: false, transfer: (await getTransferById(tx, transfer.id)) ?? transfer };
    }
    if ((await closeConfirmation(tx, request.id, CONFIRMATION_STATUS.DA_XAC_NHAN, nowIso)) === 0) {
      throw new Error(`Yêu cầu ${request.id} lệch trạng thái với chuyển ${transfer.id}`);
    }
    await updateMessageStatus(tx, request.source_message_id, MESSAGE_STATUS.DA_GHI, nowIso);
    const after = (await getTransferById(tx, transfer.id)) ?? transfer;
    await this.audit(tx, TABLE_NAME.CHUYEN_TIEN_NOI_BO, transfer.id, AUDIT_ACTION.CONFIRM, transfer, after, receiver.id, null, nowIso);
    await this.audit(tx, TABLE_NAME.YEU_CAU_XAC_NHAN, request.id, AUDIT_ACTION.CONFIRM, { trang_thai: request.trang_thai }, { trang_thai: CONFIRMATION_STATUS.DA_XAC_NHAN, chuyen_tien_id: transfer.id }, receiver.id, null, nowIso);
    return { changed: true, expired: false, transfer: after };
  }

  // Người chuyển huỷ khi còn chờ (kể cả quá hạn mà job chưa chạy). Đã nhận → không huỷ, chuyển ngược lại (Q2).
  async cancelTransfer(transferId: string, nguoiHuyId: MemberId): Promise<TransferCancelResult> {
    const nowIso = this.now().toISOString();
    return this.db.transaction(async (tx) => {
      const transfer = await getTransferById(tx, transferId);
      if (!transfer) {
        throw new DomainError('NOT_FOUND', `Không tìm thấy chuyển tiền ${transferId}`);
      }
      if (transfer.nguoi_chuyen_id !== nguoiHuyId) {
        throw new DomainError('FORBIDDEN', 'Chỉ người chuyển được huỷ');
      }
      if (transfer.trang_thai === TRANSFER_STATUS.DA_XAC_NHAN) {
        throw new DomainError('CANCEL_BLOCKED', 'Người nhận đã xác nhận; nhầm thì chuyển ngược lại');
      }
      if (transfer.trang_thai !== TRANSFER_STATUS.CHO_XAC_NHAN) {
        return { changed: false, transfer };
      }
      if ((await markTransferCancelled(tx, transfer.id, nowIso)) === 0) {
        return { changed: false, transfer: (await getTransferById(tx, transfer.id)) ?? transfer };
      }
      if (transfer.source_message_id) {
        // Dữ liệu cũ có thể có yêu cầu HET_HAN mà chuyển còn chờ → chỉ đóng khi còn chờ, chuyển vẫn huỷ được
        const pending = (await listConfirmationsByMessage(tx, transfer.source_message_id)).find(
          (c) => c.loai_xac_nhan === CONFIRMATION_TYPE.CHUYEN_TIEN && c.trang_thai === CONFIRMATION_STATUS.CHO_XAC_NHAN,
        );
        if (pending) {
          if ((await closeConfirmation(tx, pending.id, CONFIRMATION_STATUS.TU_CHOI, nowIso)) === 0) {
            throw new Error(`Yêu cầu ${pending.id} lệch trạng thái với chuyển ${transfer.id}`);
          }
          await this.audit(tx, TABLE_NAME.YEU_CAU_XAC_NHAN, pending.id, AUDIT_ACTION.UPDATE, { trang_thai: pending.trang_thai }, { trang_thai: CONFIRMATION_STATUS.TU_CHOI }, nguoiHuyId, 'DA_HUY', nowIso);
        }
        await updateMessageStatus(tx, transfer.source_message_id, MESSAGE_STATUS.DA_BO_QUA, nowIso, 'DA_HUY');
      }
      const after = (await getTransferById(tx, transfer.id)) ?? transfer;
      await this.audit(tx, TABLE_NAME.CHUYEN_TIEN_NOI_BO, transfer.id, AUDIT_ACTION.CANCEL, transfer, after, nguoiHuyId, null, nowIso);
      return { changed: true, transfer: after };
    });
  }

  getTransfer(id: string): Promise<ChuyenTienNoiBoRecord | null> {
    return getTransferById(this.db, id);
  }

  listPendingTransfers(): Promise<ChuyenTienNoiBoRecord[]> {
    return listPendingTransfers(this.db);
  }

  // Tin "bỏ vào quỹ chung 2tr" / "rút quỹ chung 1tr": ghi ngay HOAN_TAT, không cần xác nhận
  async recordFundFromParsed(
    msg: IncomingMessage,
    parsed: ParsedFundTransferResult,
    sender: ThanhVienRecord,
  ): Promise<RecordOutcome> {
    const now = this.now();
    const nowIso = now.toISOString();
    const outcome = await withDuplicateFallback(this.db, msg.updateId, () =>
      this.db.transaction(async (tx): Promise<RecordOutcome> => {
        const messageId = await insertIncomingMessage(tx, msg, sender.id, nowIso);
        if (!messageId) {
          return loadExistingOutcome(tx, msg.updateId);
        }
        const group = memberGroup(sender);
        const reason = fundRejectReason(parsed, group, toVnDate(now));
        if (reason || group === null) {
          return ignoreMessage(tx, messageId, reason ?? 'NGUOI_GUI_KHONG_HOP_LE', nowIso);
        }
        const fundMove = await insertFundMove(tx, {
          id: newId('QC'),
          chieu: parsed.chieu,
          thanh_vien_id: sender.id,
          // Rút cho người kia: tiền về nhóm người nhận (nhom_id), người ghi vẫn là người gửi
          nhom_id: parsed.chieu === FUND_DIRECTION.RUT && parsed.nguoi_nhan_id ? parsed.nguoi_nhan_id : group,
          so_tien: parsed.so_tien as number,
          ngay_chuyen: parsed.ngay_chuyen,
          source_message_id: messageId,
          idempotency_key: telegramKey(msg.updateId),
          ghi_chu: parsed.mo_ta,
          nowIso,
        });
        await this.audit(tx, TABLE_NAME.CHUYEN_QUY_CHUNG, fundMove.id, AUDIT_ACTION.CREATE, null, fundMove, sender.id, null, nowIso);
        await updateMessageStatus(tx, messageId, MESSAGE_STATUS.DA_GHI, nowIso);
        return {
          kind: 'FUND_MOVE',
          duplicate: false,
          message: await requireMessage(tx, messageId),
          fundMove,
          canhBaoVuotSoDu: false,
        };
      }),
    );
    if (outcome.kind === 'FUND_MOVE' && !outcome.duplicate) {
      const f = outcome.fundMove;
      outcome.canhBaoVuotSoDu =
        f.chieu === FUND_DIRECTION.NOP
          ? await this.isOverBalance(f.nhom_id, sender.id, f.ngay_chuyen)
          : await this.isOverBalance(MONEY_HOLDER_ID.QUY_CHUNG, null, f.ngay_chuyen);
    }
    return outcome;
  }

  // Người ghi huỷ dòng quỹ nhập nhầm → số dư trả lại. Tin giữ DA_GHI (như huỷ giao dịch).
  async cancelFundMove(fundMoveId: string, nguoiHuyId: MemberId): Promise<FundCancelResult> {
    const nowIso = this.now().toISOString();
    return this.db.transaction(async (tx) => {
      const fundMove = await getFundMoveById(tx, fundMoveId);
      if (!fundMove) {
        throw new DomainError('NOT_FOUND', `Không tìm thấy dòng quỹ chung ${fundMoveId}`);
      }
      // Rút quỹ đưa thẳng người kia: người nhận cũng huỷ được (không có bước xác nhận)
      const recipient = fundMove.chieu === FUND_DIRECTION.RUT && fundMove.nhom_id !== fundMove.thanh_vien_id && fundMove.nhom_id === nguoiHuyId;
      if (fundMove.thanh_vien_id !== nguoiHuyId && !recipient) {
        throw new DomainError('FORBIDDEN', 'Chỉ người ghi được huỷ');
      }
      if ((await markFundMoveCancelled(tx, fundMove.id, nowIso)) === 0) {
        return { changed: false, fundMove: (await getFundMoveById(tx, fundMove.id)) ?? fundMove };
      }
      const after = (await getFundMoveById(tx, fundMove.id)) ?? fundMove;
      await this.audit(tx, TABLE_NAME.CHUYEN_QUY_CHUNG, fundMove.id, AUDIT_ACTION.CANCEL, fundMove, after, nguoiHuyId, null, nowIso);
      return { changed: true, fundMove: after };
    });
  }

  private async transferRejectReason(
    tx: DatabaseAdapter,
    parsed: ParsedTransferResult,
    sender: ThanhVienRecord,
    today: string,
  ): Promise<string | null> {
    if (parsed.ly_do_chua_ho_tro) {
      return parsed.ly_do_chua_ho_tro;
    }
    if (parsed.so_tien === null || parsed.requires_confirmation.includes(CONFIRMATION_TYPE.GIAO_DICH_MO_HO)) {
      return 'THIEU_HOAC_MO_HO_SO_TIEN';
    }
    if (parsed.nguoi_chuyen_id === parsed.nguoi_nhan_id) {
      return 'TU_CHUYEN_CHO_MINH';
    }
    if (memberGroup(sender) === null) {
      return 'NGUOI_CHUYEN_KHONG_HOP_LE';
    }
    if (memberGroup(await getMemberById(tx, parsed.nguoi_nhan_id)) === null) {
      return 'NGUOI_NHAN_KHONG_HOP_LE';
    }
    if (parsed.ngay_chuyen > today) {
      return 'NGAY_TUONG_LAI';
    }
    return null;
  }

  private async requireTransferOfRequest(
    tx: DatabaseAdapter,
    request: YeuCauXacNhanRecord,
  ): Promise<ChuyenTienNoiBoRecord> {
    const transfer = await getTransferByMessage(tx, request.source_message_id);
    const proposal = JSON.parse(request.du_lieu_de_xuat_json) as { chuyen_tien_id?: string };
    if (!transfer || transfer.id !== proposal.chuyen_tien_id) {
      throw new Error(`Yêu cầu ${request.id} không khớp bản ghi chuyển tiền`);
    }
    return transfer;
  }

  // Cờ cảnh báo (Q7), tính sau commit, ngoài transaction: số dư nhóm (đã gồm khoản vừa ghi nếu HOAN_TAT)
  // trừ các chuyển vợ↔chồng còn chờ của thành viên đó. Chưa có số dư ban đầu → không cảnh báo.
  // Lỗi khi tính → không cảnh báo (bản ghi đã commit; ném lỗi sẽ làm Telegram gửi lại và người nhận mất tin)
  private isOverBalance(holder: MoneyHolderId, memberId: MemberId | null, asOf: string): Promise<boolean> {
    return new BalanceService(this.db, { now: this.now }).isOverBalance(holder, memberId, asOf);
  }

  private async audit(
    tx: DatabaseAdapter,
    table: typeof TABLE_NAME.CHUYEN_TIEN_NOI_BO | typeof TABLE_NAME.CHUYEN_QUY_CHUNG | typeof TABLE_NAME.YEU_CAU_XAC_NHAN,
    id: string,
    action: (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION],
    before: unknown,
    after: unknown,
    actor: MemberId,
    reason: string | null,
    nowIso: string,
  ): Promise<void> {
    await insertAuditLog(tx, {
      ten_bang: table,
      ban_ghi_id: id,
      hanh_dong: action,
      du_lieu_truoc: before,
      du_lieu_sau: after,
      nguoi_thuc_hien_id: actor,
      ly_do: reason,
      nowIso,
    });
  }
}
