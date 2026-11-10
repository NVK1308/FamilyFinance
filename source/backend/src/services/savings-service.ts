import {
  ASSET_TYPE,
  AUDIT_ACTION,
  DEFAULT_JAR_ID,
  MESSAGE_STATUS,
  SAVINGS_DIRECTION,
  TABLE_NAME,
  type AssetType,
  type MemberId,
  type SavingsSourceId,
} from '../config/constants.ts';
import { insertAuditLog } from '../db/audit-repository.ts';
import {
  getJarById,
  getJarByNormalizedName,
  getSavingsMoveById,
  getSavingsMoveByIdempotencyKey,
  getSavingsMoveByTransaction,
  insertJar,
  insertSavingsMove,
  latestGoldPrice,
  listActiveJars,
  listRecentSavingsMoves,
  markSavingsMoveCancelled,
  sumSavingsCash,
  sumGoldByJar,
  sumSavingsCashByJar,
  updateMessageStatus,
} from '../db/repositories/index.ts';
import type { DatabaseAdapter, HuRecord, HuTietKiemRecord, ThanhVienRecord } from '../db/types.ts';
import { normalizeWhitespace, removeVietnameseDiacritics } from '../parser/normalizer.ts';
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

export interface JarBalance {
  jar: HuRecord;
  tien: number;
  // Vàng trong hũ (phân)
  vangPhan: number;
}

// Giá vàng đang dùng: dòng có giá gần nhất (so_tien cho so_luong_phan phân)
export interface GoldPrice {
  soTien: number;
  phan: number;
  ngay: string;
  // Giá lấy từ dòng khai báo (chưa có lần mua / bán nào có giá)
  khaiBao: boolean;
}

// Mọi hũ: từng hũ + tổng tiền, tổng vàng, giá trị vàng (null = chưa định giá)
export interface SavingsSummary {
  rows: JarBalance[];
  gia: GoldPrice | null;
  tien: number;
  vangPhan: number;
  vangGiaTri: number | null;
}

export function goldValue(phan: number, gia: GoldPrice | null): number | null {
  return gia ? Math.round((phan * gia.soTien) / gia.phan) : null;
}

// Giá 1 chỉ của dòng soTien cho phan phân
export function pricePerChi(soTien: number, phan: number): number {
  return Math.round((soTien * 10) / phan);
}

export function goldPricePerChi(gia: GoldPrice): number {
  return pricePerChi(gia.soTien, gia.phan);
}

// Đơn giá lệch quá mức này so với giá đang dùng → cảnh báo (gõ nhầm "1tr4" thay "14tr")
const GOLD_PRICE_DEVIATION = 0.3;

const JAR_NAME_MAX = 30;
// Tên dành riêng: "chung" (quỹ chung), "vàng" (câu vàng)
const RESERVED_JAR_NAMES = new Set(['chung', 'quy chung', 'hu', 'quy', 'vang']);

// "Quỹ Y tế" → { ten: 'Y tế', key: 'y te' }; bỏ tiền tố hũ/quỹ (parser cũng bỏ chữ này khi khớp tên)
export function normalizeJarName(raw: string): { ten: string; key: string } {
  const ten = normalizeWhitespace(raw.normalize('NFC')).replace(/^(?:hũ|hủ|quỹ|hu|quy)\s+/iu, '').trim();
  const key = normalizeWhitespace(removeVietnameseDiacritics(ten).toLowerCase());
  return { ten, key };
}

// Hũ tiết kiệm: nhiều hũ có tên, tài sản chung; ghi ngay, không cần xác nhận; không vào thu/chi.
export class SavingsService {
  private readonly db: DatabaseAdapter;
  private readonly now: () => Date;
  private readonly balances: BalanceService;

  constructor(db: DatabaseAdapter, options?: ServiceOptions) {
    this.db = db;
    this.now = resolveClock(options);
    this.balances = new BalanceService(db, options);
  }

  // Tên hũ đang có (ASCII) — truyền cho parser. Nhớ trong đời instance (1 instance / 1 update), xoá khi tạo hũ.
  private jarNamesCache: Promise<string[]> | null = null;

  // Đọc lỗi (vd Neon chưa chạy migration 0005) → [] để tin thu/chi thường vẫn ghi được; lệnh hũ sẽ báo lỗi riêng.
  jarNames(): Promise<string[]> {
    this.jarNamesCache ??= listActiveJars(this.db).then(
      (jars) => jars.map((j) => j.ten_khong_dau),
      (error: unknown) => {
        console.error('Không đọc được danh sách hũ (đã chạy temp/neon/06_nhieu_hu.sql chưa?)', error);
        this.jarNamesCache = null;
        return [];
      },
    );
    return this.jarNamesCache;
  }

  // Tên ASCII từ parser → hũ đang hoạt động; null / '' → hũ mặc định
  async resolveJar(db: DatabaseAdapter, tenHu: string | null): Promise<HuRecord | null> {
    const jar = tenHu ? await getJarByNormalizedName(db, tenHu) : await getJarById(db, DEFAULT_JAR_ID);
    return jar && jar.deleted_at === null && Boolean(jar.is_active) ? jar : null;
  }

  // Tin "bỏ hũ mua nhà 5tr" / "rút quỹ y tế 2tr" / "khai báo hũ tiết kiệm 50tr"
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
        const gold = parsed.loai_tai_san === ASSET_TYPE.VANG;
        // Bán vàng không nêu hũ → hũ đang có vàng
        const jar =
          gold && parsed.chieu === SAVINGS_DIRECTION.RUT && !parsed.ten_hu ? await this.goldSellJar(tx, parsed.ngay) : await this.resolveJar(tx, parsed.ten_hu);
        if (jar === 'NHIEU') {
          return ignoreMessage(tx, messageId, 'VANG_CHON_HU', nowIso);
        }
        if (!jar) {
          return ignoreMessage(tx, messageId, 'HU_KHONG_CO', nowIso);
        }
        const declare = parsed.chieu === SAVINGS_DIRECTION.KHAI_BAO;
        const soTien = parsed.so_tien;
        const giaTruoc = gold && soTien !== null ? await this.goldPrice(parsed.ngay, tx) : null;
        const move = await this.insert(tx, {
          chieu: parsed.chieu,
          huId: jar.id,
          loaiTaiSan: parsed.loai_tai_san,
          soLuongPhan: gold ? parsed.so_luong_phan : null,
          soTien,
          // Nguồn tiền mặt là nhóm của người gửi (theo vai trò), hoặc quỹ chung; không có tiền → không nguồn
          nguon: declare || soTien === null ? null : parsed.nguon_id === 'QUY_CHUNG' ? 'QUY_CHUNG' : group,
          memberId: sender.id as MemberId,
          ngay: parsed.ngay,
          messageId,
          giaoDichId: null,
          key: telegramKey(msg.updateId),
          ghiChu: parsed.mo_ta,
          nowIso,
        });
        await updateMessageStatus(tx, messageId, MESSAGE_STATUS.DA_GHI, nowIso);
        return {
          kind: 'SAVINGS_MOVE',
          duplicate: false,
          message: await requireMessage(tx, messageId),
          move,
          jar,
          canhBaoVuotSoDu: false,
          giaVangThamChieu: priceDeviation(move, giaTruoc),
        };
      }),
    );
    if (outcome.kind === 'SAVINGS_MOVE' && !outcome.duplicate) {
      outcome.canhBaoVuotSoDu = await this.isOverBalance(outcome.move);
    }
    return outcome;
  }

  // Lệnh /tietkiemdau <tiền> [tên hũ]: khai báo tiền đang để dành (không trừ ai). key chống ghi 2 lần khi Telegram gửi lại.
  async declare(
    sender: ThanhVienRecord,
    soTien: number,
    key: string,
    tenHu: string | null = null,
  ): Promise<{ move: HuTietKiemRecord; jar: HuRecord; duplicate: boolean }> {
    if (!Number.isSafeInteger(soTien) || soTien <= 0) {
      throw new DomainError('INVALID_INPUT', 'Số tiền phải lớn hơn 0');
    }
    return this.declareAsset(sender, { loai: ASSET_TYPE.TIEN, soTien, phan: null }, key, tenHu);
  }

  // /tietkiemdau 3 chỉ vàng [giá] [hũ]: vàng đang có (không trừ ai); giá (tổng) không bắt buộc
  async declareGold(
    sender: ThanhVienRecord,
    phan: number,
    soTien: number | null,
    key: string,
    tenHu: string | null = null,
  ): Promise<{ move: HuTietKiemRecord; jar: HuRecord; duplicate: boolean }> {
    if (!Number.isSafeInteger(phan) || phan <= 0 || (soTien !== null && (!Number.isSafeInteger(soTien) || soTien <= 0))) {
      throw new DomainError('INVALID_INPUT', 'Số lượng / số tiền phải lớn hơn 0');
    }
    return this.declareAsset(sender, { loai: ASSET_TYPE.VANG, soTien, phan }, key, tenHu);
  }

  private async declareAsset(
    sender: ThanhVienRecord,
    asset: { loai: AssetType; soTien: number | null; phan: number | null },
    key: string,
    tenHu: string | null,
  ): Promise<{ move: HuTietKiemRecord; jar: HuRecord; duplicate: boolean }> {
    // Cùng điều kiện với đường nhắn tin: chỉ vợ / chồng
    if (memberGroup(sender) === null) {
      throw new DomainError('FORBIDDEN', 'HU_NGUOI_GUI_KHONG_HOP_LE');
    }
    const existing = await getSavingsMoveByIdempotencyKey(this.db, key);
    if (existing) {
      return { move: existing, jar: await this.requireJar(existing), duplicate: true };
    }
    const jar = await this.resolveJar(this.db, tenHu ? normalizeJarName(tenHu).key : null);
    if (!jar) {
      throw new DomainError('NOT_FOUND', 'HU_KHONG_CO');
    }
    const nowIso = this.now().toISOString();
    try {
      const move = await this.db.transaction((tx) =>
        this.insert(tx, {
          chieu: SAVINGS_DIRECTION.KHAI_BAO,
          huId: jar.id,
          loaiTaiSan: asset.loai,
          soLuongPhan: asset.phan,
          soTien: asset.soTien,
          nguon: null,
          memberId: sender.id as MemberId,
          ngay: toVnDate(this.now()),
          messageId: null,
          giaoDichId: null,
          key,
          ghiChu: 'Khai báo qua bot',
          nowIso,
        }),
      );
      return { move, jar, duplicate: false };
    } catch (error) {
      const raced = isUniqueViolation(error) ? await getSavingsMoveByIdempotencyKey(this.db, key) : null;
      if (raced) {
        return { move: raced, jar, duplicate: true };
      }
      throw error;
    }
  }

  // /taohu <tên> [mục tiêu]. Đã có tên đó → trả hũ cũ (created = false).
  async createJar(sender: ThanhVienRecord, rawName: string, mucTieu: number | null): Promise<{ jar: HuRecord; created: boolean }> {
    if (memberGroup(sender) === null) {
      throw new DomainError('FORBIDDEN', 'HU_NGUOI_GUI_KHONG_HOP_LE');
    }
    const { ten, key } = normalizeJarName(rawName);
    // "chung …" bị luật quỹ chung bắt trước ("quỹ chung cư") → không cho đặt
    if (!key || ten.length > JAR_NAME_MAX || /\d/.test(ten) || RESERVED_JAR_NAMES.has(key) || key.startsWith('chung ')) {
      throw new DomainError('INVALID_INPUT', `Tên hũ 1–${JAR_NAME_MAX} ký tự, không có chữ số, không phải "chung"`);
    }
    if (mucTieu !== null && (!Number.isSafeInteger(mucTieu) || mucTieu <= 0)) {
      throw new DomainError('INVALID_INPUT', 'Mục tiêu phải lớn hơn 0');
    }
    const existing = await getJarByNormalizedName(this.db, key);
    if (existing) {
      return { jar: existing, created: false };
    }
    this.jarNamesCache = null;
    const nowIso = this.now().toISOString();
    try {
      const jar = await this.db.transaction(async (tx) => {
        const created = await insertJar(tx, {
          id: newId('HU'),
          ten,
          ten_khong_dau: key,
          muc_tieu: mucTieu,
          nguoi_tao_id: sender.id as MemberId,
          nowIso,
        });
        await audit(tx, TABLE_NAME.HU, created.id, AUDIT_ACTION.CREATE, null, created, sender.id as MemberId, nowIso);
        return created;
      });
      return { jar, created: true };
    } catch (error) {
      const raced = isUniqueViolation(error) ? await getJarByNormalizedName(this.db, key) : null;
      if (raced) {
        return { jar: raced, created: false };
      }
      throw error;
    }
  }

  // Người ghi huỷ dòng nhập nhầm → số dư trả lại. Dòng đi kèm khoản chi chỉ huỷ qua huỷ khoản chi.
  async cancel(moveId: string, nguoiHuyId: MemberId): Promise<SavingsCancelResult & { jar: HuRecord }> {
    const nowIso = this.now().toISOString();
    return this.db.transaction(async (tx) => {
      const move = await getSavingsMoveById(tx, moveId);
      if (!move) {
        throw new DomainError('NOT_FOUND', `Không tìm thấy dòng hũ tiết kiệm ${moveId}`);
      }
      if (move.thanh_vien_id !== nguoiHuyId) {
        throw new DomainError('FORBIDDEN', 'Chỉ người ghi được huỷ');
      }
      if (move.giao_dich_id) {
        throw new DomainError('CANCEL_BLOCKED', 'Khoản này đi kèm khoản chi — huỷ khoản chi đó');
      }
      const jar = await this.requireJar(move, tx);
      if ((await markSavingsMoveCancelled(tx, move.id, nowIso)) === 0) {
        return { changed: false, move: (await getSavingsMoveById(tx, move.id)) ?? move, jar };
      }
      const after = (await getSavingsMoveById(tx, move.id)) ?? move;
      await audit(tx, TABLE_NAME.HU_TIET_KIEM, move.id, AUDIT_ACTION.CANCEL, move, after, nguoiHuyId, nowIso);
      return { changed: true, move: after, jar };
    });
  }

  // B: khoản chi trả từ hũ → dòng RUT đi kèm (cùng ngày, cùng số tiền), tiền về nhóm người trả. Gọi trong transaction của giao dịch.
  async insertLinkedWithdrawal(
    tx: DatabaseAdapter,
    i: { huId: string; soTien: number; nguon: SavingsSourceId; memberId: MemberId; ngay: string; giaoDichId: string; messageId: string | null; key: string; nowIso: string },
  ): Promise<HuTietKiemRecord> {
    return this.insert(tx, { ...i, chieu: SAVINGS_DIRECTION.RUT, loaiTaiSan: ASSET_TYPE.TIEN, soLuongPhan: null, ghiChu: null });
  }

  // Huỷ khoản chi trả từ hũ → huỷ luôn dòng RUT đi kèm (cùng transaction)
  async cancelLinked(tx: DatabaseAdapter, giaoDichId: string, actor: MemberId, nowIso: string): Promise<void> {
    const move = await getSavingsMoveByTransaction(tx, giaoDichId);
    if (!move || (await markSavingsMoveCancelled(tx, move.id, nowIso)) === 0) {
      return;
    }
    const after = (await getSavingsMoveById(tx, move.id)) ?? move;
    await audit(tx, TABLE_NAME.HU_TIET_KIEM, move.id, AUDIT_ACTION.CANCEL, move, after, actor, nowIso);
  }

  // Hũ của khoản chi trả từ hũ (để trả lời / chặn đổi loại); không có → null
  async jarOfTransaction(db: DatabaseAdapter, giaoDichId: string): Promise<HuRecord | null> {
    const move = await getSavingsMoveByTransaction(db, giaoDichId);
    return move ? this.requireJar(move, db) : null;
  }

  async jarBalance(asOf: string, huId: string): Promise<number> {
    return (await sumSavingsCash(this.db, asOf, huId)).tien;
  }

  // Mọi hũ + giá vàng đang dùng (dùng chung /tietkiem, /sodu, câu hỏi).
  // rows: hũ đang dùng (hũ trống vẫn hiện); tổng tính cả hũ đã ẩn (tiền vẫn là tài sản).
  async summary(asOf: string): Promise<SavingsSummary> {
    const [jars, cash, gold, gia] = await Promise.all([
      listActiveJars(this.db),
      sumSavingsCashByJar(this.db, asOf),
      sumGoldByJar(this.db, asOf),
      this.goldPrice(asOf),
    ]);
    const rows = jars.map((jar) => ({ jar, tien: cash.get(jar.id) ?? 0, vangPhan: gold.get(jar.id) ?? 0 }));
    const vangPhan = sumValues(gold);
    return { rows, gia, tien: sumValues(cash), vangPhan, vangGiaTri: goldValue(vangPhan, gia) };
  }

  async goldPrice(asOf: string, db: DatabaseAdapter = this.db): Promise<GoldPrice | null> {
    const row = await latestGoldPrice(db, asOf);
    return row && row.so_tien !== null && row.so_luong_phan
      ? { soTien: row.so_tien, phan: row.so_luong_phan, ngay: row.ngay, khaiBao: row.chieu === SAVINGS_DIRECTION.KHAI_BAO }
      : null;
  }

  // Bán vàng không nêu hũ: đúng 1 hũ đang dùng có vàng → hũ đó; nhiều hũ → 'NHIEU'; không hũ nào → hũ mặc định
  private async goldSellJar(db: DatabaseAdapter, asOf: string): Promise<HuRecord | 'NHIEU' | null> {
    const [jars, gold] = await Promise.all([listActiveJars(db), sumGoldByJar(db, asOf)]);
    const holding = jars.filter((j) => (gold.get(j.id) ?? 0) > 0);
    if (holding.length > 1) {
      return 'NHIEU';
    }
    return holding[0] ?? (await this.resolveJar(db, null));
  }

  listJars(): Promise<HuRecord[]> {
    return listActiveJars(this.db);
  }

  listRecent(limit: number): Promise<HuTietKiemRecord[]> {
    return listRecentSavingsMoves(this.db, limit);
  }

  private async requireJar(move: HuTietKiemRecord, db: DatabaseAdapter = this.db): Promise<HuRecord> {
    const jar = await getJarById(db, move.hu_id ?? DEFAULT_JAR_ID);
    if (!jar) {
      throw new Error(`Dòng hũ ${move.id} trỏ tới hũ không có: ${move.hu_id}`);
    }
    return jar;
  }

  private async insert(
    tx: DatabaseAdapter,
    i: {
      chieu: HuTietKiemRecord['chieu'];
      huId: string;
      loaiTaiSan: AssetType;
      soLuongPhan: number | null;
      soTien: number | null;
      nguon: SavingsSourceId | null;
      memberId: MemberId;
      ngay: string;
      messageId: string | null;
      giaoDichId: string | null;
      key: string;
      ghiChu: string | null;
      nowIso: string;
    },
  ): Promise<HuTietKiemRecord> {
    const move = await insertSavingsMove(tx, {
      id: newId('HK'),
      chieu: i.chieu,
      loai_tai_san: i.loaiTaiSan,
      so_luong_phan: i.soLuongPhan,
      so_tien: i.soTien,
      nguon_id: i.nguon,
      hu_id: i.huId,
      giao_dich_id: i.giaoDichId,
      thanh_vien_id: i.memberId,
      ngay: i.ngay,
      source_message_id: i.messageId,
      idempotency_key: i.key,
      ghi_chu: i.ghiChu,
      nowIso: i.nowIso,
    });
    await audit(tx, TABLE_NAME.HU_TIET_KIEM, move.id, AUDIT_ACTION.CREATE, null, move, i.memberId, i.nowIso);
    return move;
  }

  // Cảnh báo sau commit (không chặn): bỏ vào → nguồn âm (trừ chuyển đang chờ của người đó); lấy ra → hũ đó âm.
  private async isOverBalance(move: HuTietKiemRecord): Promise<boolean> {
    if (move.chieu === SAVINGS_DIRECTION.NOP && move.nguon_id !== null) {
      const member = move.nguon_id === 'QUY_CHUNG' ? null : move.thanh_vien_id;
      return this.balances.isOverBalance(move.nguon_id, member, move.ngay);
    }
    if (move.chieu !== SAVINGS_DIRECTION.RUT) {
      return false;
    }
    try {
      const huId = move.hu_id ?? DEFAULT_JAR_ID;
      if (move.loai_tai_san === ASSET_TYPE.VANG) {
        return ((await sumGoldByJar(this.db, move.ngay)).get(huId) ?? 0) < 0;
      }
      return (await sumSavingsCash(this.db, move.ngay, huId)).tien < 0;
    } catch (error) {
      console.error('Hũ tiết kiệm: tính cảnh báo lỗi, bỏ cảnh báo', error);
      return false;
    }
  }
}

// Đơn giá dòng mới lệch > 30% giá đang dùng → giá đang dùng (đồng/chỉ); không thì null
function priceDeviation(move: HuTietKiemRecord, gia: GoldPrice | null): number | null {
  if (!gia || move.so_tien === null || !move.so_luong_phan) {
    return null;
  }
  const ref = goldPricePerChi(gia);
  const unit = pricePerChi(move.so_tien, move.so_luong_phan);
  return Math.abs(unit - ref) > ref * GOLD_PRICE_DEVIATION ? ref : null;
}

function sumValues(m: Map<string, number>): number {
  return [...m.values()].reduce((s, v) => s + v, 0);
}

// Lý do không ghi (null = ghi được)
function rejectReason(parsed: ParsedSavingsResult, group: 'VO' | 'CHONG' | null, today: string): string | null {
  if (parsed.ly_do_chua_ho_tro) {
    return parsed.ly_do_chua_ho_tro;
  }
  if (parsed.loai_tai_san === ASSET_TYPE.VANG) {
    // Vàng: tiền không bắt buộc (chỉ số lượng) — trừ khi bán (tiền về ai?)
    if (parsed.so_tien_mo_ho) return 'VANG_SO_TIEN_MO_HO';
    if (parsed.so_luong_phan === null) return 'VANG_THIEU_SO_LUONG';
    if (parsed.chieu === SAVINGS_DIRECTION.RUT && parsed.so_tien === null) return 'VANG_BAN_THIEU_TIEN';
  } else if (parsed.so_tien === null) {
    return parsed.so_tien_mo_ho ? 'SO_TIEN_MO_HO' : 'THIEU_SO_TIEN';
  }
  if (group === null) {
    return 'HU_NGUOI_GUI_KHONG_HOP_LE';
  }
  return parsed.ngay > today ? 'NGAY_TUONG_LAI' : null;
}

async function audit(
  tx: DatabaseAdapter,
  table: typeof TABLE_NAME.HU_TIET_KIEM | typeof TABLE_NAME.HU,
  id: string,
  action: (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION],
  before: unknown,
  after: unknown,
  actor: MemberId,
  nowIso: string,
): Promise<void> {
  await insertAuditLog(tx, {
    ten_bang: table,
    ban_ghi_id: id,
    hanh_dong: action,
    du_lieu_truoc: before,
    du_lieu_sau: after,
    nguoi_thuc_hien_id: actor,
    ly_do: null,
    nowIso,
  });
}
