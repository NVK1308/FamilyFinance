import {
  AUDIT_ACTION,
  CONFIRMATION_STATUS,
  CONFIRMATION_TYPE,
  MESSAGE_STATUS,
  TABLE_NAME,
  TRANSFER_STATUS,
  type ConfirmationType,
} from '../config/constants.ts';
import { insertAuditLog } from '../db/audit-repository.ts';
import {
  closeConfirmation,
  getMessageById,
  getTransferById,
  getTransferByMessage,
  listOverdueConfirmations,
  markTransferExpired,
  updateMessageStatus,
} from '../db/repositories/index.ts';
import type { ChuyenTienNoiBoRecord, DatabaseAdapter, YeuCauXacNhanRecord } from '../db/types.ts';
import { resolveClock, type ServiceOptions } from './common.ts';

// Yêu cầu mà hết hạn thì tin gốc coi như bỏ qua (DOI_TUONG_MOI đi kèm giao dịch đã ghi → giữ DA_GHI)
const MESSAGE_CLOSING_TYPES: readonly ConfirmationType[] = [
  CONFIRMATION_TYPE.GIAO_DICH_MO_HO,
  CONFIRMATION_TYPE.DANH_MUC_MOI,
  CONFIRMATION_TYPE.CHUYEN_TIEN,
];

export interface ExpiryResult {
  expired: number;
  failed: number;
  // Chuyển vừa hết hạn → báo người chuyển sau commit
  transfers: ChuyenTienNoiBoRecord[];
}

export class ExpiryService {
  private readonly db: DatabaseAdapter;
  private readonly now: () => Date;

  constructor(db: DatabaseAdapter, options?: ServiceOptions) {
    this.db = db;
    this.now = resolveClock(options);
  }

  // Job hằng đêm (3.5): mỗi yêu cầu quá hạn 1 transaction; lỗi 1 yêu cầu → log, làm tiếp
  async expireOverdue(limit = 50): Promise<ExpiryResult> {
    const nowIso = this.now().toISOString();
    const result: ExpiryResult = { expired: 0, failed: 0, transfers: [] };
    for (const request of await listOverdueConfirmations(this.db, nowIso, limit)) {
      try {
        const transfer = await this.db.transaction((tx) => this.expireOne(tx, request, nowIso));
        result.expired += 1;
        if (transfer) {
          result.transfers.push(transfer);
        }
      } catch (error) {
        result.failed += 1;
        console.error(`Hết hạn yêu cầu ${request.id} lỗi`, error);
      }
    }
    return result;
  }

  // Lặp từng lô tới khi hết tồn; dừng nếu lô không tiến được (yêu cầu lỗi lặp lại ở đầu danh sách)
  async expireAllOverdue(limit = 50, maxBatches = 20): Promise<ExpiryResult> {
    const total: ExpiryResult = { expired: 0, failed: 0, transfers: [] };
    for (let i = 0; i < maxBatches; i += 1) {
      const r = await this.expireOverdue(limit);
      total.expired += r.expired;
      total.failed += r.failed;
      total.transfers.push(...r.transfers);
      if (r.expired + r.failed < limit || r.expired === 0) {
        break;
      }
    }
    return total;
  }

  // Thứ tự khoá như respondTransferInTx: chuyển → yêu cầu → tin → audit. 0 dòng → throw để rollback.
  private async expireOne(
    tx: DatabaseAdapter,
    request: YeuCauXacNhanRecord,
    nowIso: string,
  ): Promise<ChuyenTienNoiBoRecord | null> {
    let expiredTransfer: ChuyenTienNoiBoRecord | null = null;
    if (request.loai_xac_nhan === CONFIRMATION_TYPE.CHUYEN_TIEN) {
      const transfer = await getTransferByMessage(tx, request.source_message_id);
      // Chuyển đã kết thúc (dữ liệu cũ) → chỉ đóng yêu cầu
      if (transfer && transfer.trang_thai === TRANSFER_STATUS.CHO_XAC_NHAN) {
        if ((await markTransferExpired(tx, transfer.id, nowIso)) === 0) {
          throw new Error(`Chuyển ${transfer.id} vừa được xử lý, bỏ qua lần này`);
        }
        expiredTransfer = (await getTransferById(tx, transfer.id)) ?? transfer;
        await insertAuditLog(tx, {
          ten_bang: TABLE_NAME.CHUYEN_TIEN_NOI_BO,
          ban_ghi_id: transfer.id,
          hanh_dong: AUDIT_ACTION.UPDATE,
          du_lieu_truoc: transfer,
          du_lieu_sau: expiredTransfer,
          nguoi_thuc_hien_id: null,
          ly_do: 'HET_HAN',
          nowIso,
        });
      }
    }
    if ((await closeConfirmation(tx, request.id, CONFIRMATION_STATUS.HET_HAN, nowIso)) === 0) {
      throw new Error(`Yêu cầu ${request.id} vừa được xử lý, bỏ qua lần này`);
    }
    await insertAuditLog(tx, {
      ten_bang: TABLE_NAME.YEU_CAU_XAC_NHAN,
      ban_ghi_id: request.id,
      hanh_dong: AUDIT_ACTION.UPDATE,
      du_lieu_truoc: { trang_thai: request.trang_thai },
      du_lieu_sau: { trang_thai: CONFIRMATION_STATUS.HET_HAN },
      nguoi_thuc_hien_id: null,
      ly_do: 'HET_HAN',
      nowIso,
    });
    if (MESSAGE_CLOSING_TYPES.includes(request.loai_xac_nhan)) {
      const message = await getMessageById(tx, request.source_message_id);
      if (message?.trang_thai_xu_ly === MESSAGE_STATUS.CHO_XAC_NHAN) {
        await updateMessageStatus(tx, message.id, MESSAGE_STATUS.DA_BO_QUA, nowIso, 'HET_HAN');
        await insertAuditLog(tx, {
          ten_bang: TABLE_NAME.TIN_NHAN_GOC,
          ban_ghi_id: message.id,
          hanh_dong: AUDIT_ACTION.UPDATE,
          du_lieu_truoc: { trang_thai_xu_ly: message.trang_thai_xu_ly },
          du_lieu_sau: { trang_thai_xu_ly: MESSAGE_STATUS.DA_BO_QUA, chi_tiet_loi: 'HET_HAN' },
          nguoi_thuc_hien_id: null,
          ly_do: 'HET_HAN',
          nowIso,
        });
      }
    }
    return expiredTransfer;
  }
}
