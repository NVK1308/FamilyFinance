// callback_data của nút bấm (Telegram giới hạn 64 byte; dài nhất hiện nay ≈ 56 với dm:<GD_uuid>:TIEN_DUOC_CHO)
export type CallbackData =
  | { kind: 'yc'; id: string; accept: boolean } // Đã nhận / Chưa nhận
  | { kind: 'dm'; id: string; code: string } // đổi danh mục giao dịch
  | { kind: 'lt'; id: string; to: 'THU' | 'CHI' } // đổi sang Thu / Chi (ghi loại đích: bấm lặp không lật lại)
  | { kind: 'gd'; id: string } // huỷ giao dịch
  | { kind: 'ct'; id: string } // huỷ chuyển tiền
  | { kind: 'qc'; id: string } // huỷ dòng quỹ chung
  | { kind: 'hk'; id: string } // huỷ dòng hũ tiết kiệm
  | { kind: 'sd'; id: string } // sửa số tiền giao dịch (gửi tin nhắc trả lời)
  | { kind: 'dk'; id: string; action: DueAction } // khoản định kỳ đến hạn: A đã trả / S số khác / B tháng này không có
  | { kind: 'dx'; id: string } // dừng khoản định kỳ
  // xoá hũ: hũ nguồn, đích tiền (V vợ / C chồng / Q quỹ chung), vàng: N không có / B bán / J chuyển sang hũ toJarId / X thôi không xoá
  | { kind: 'xh'; jarId: string; dest: 'V' | 'C' | 'Q'; mode: 'N' | 'B' | 'X' | 'J'; toJarId?: string };

export type DueAction = 'A' | 'S' | 'B';

export const CALLBACK_MAX_BYTES = 64;

export function encodeCallback(data: CallbackData): string {
  let text: string;
  switch (data.kind) {
    case 'yc':
      text = `yc:${data.id}:${data.accept ? 'A' : 'R'}`;
      break;
    case 'dm':
      text = `dm:${data.id}:${data.code}`;
      break;
    case 'lt':
      text = `lt:${data.id}:${data.to === 'THU' ? 'T' : 'C'}`;
      break;
    case 'dk':
      text = `dk:${data.id}:${data.action}`;
      break;
    case 'xh':
      text = `xh:${jarToken(data.jarId)}:${data.dest}:${data.mode}${data.mode === 'J' && data.toJarId ? jarToken(data.toJarId) : ''}`;
      break;
    default:
      text = `${data.kind}:${data.id}`;
  }
  if (new TextEncoder().encode(text).length > CALLBACK_MAX_BYTES) {
    throw new Error(`callback_data quá ${CALLBACK_MAX_BYTES} byte: ${text}`);
  }
  return text;
}

const ID = '[A-Za-z0-9_-]+';
const CODE_RE = /^[A-Z0-9_]+$/;

// Mã danh mục đưa được vào nút (đúng dạng, không vượt 64 byte) — mã lạ/dài bị bỏ khỏi bàn phím thay vì lỗi
export function categoryCodeFits(id: string, code: string): boolean {
  return CODE_RE.test(code) && new TextEncoder().encode(`dm:${id}:${code}`).length <= CALLBACK_MAX_BYTES;
}

const PATTERNS: ReadonlyArray<[RegExp, (m: RegExpMatchArray) => CallbackData]> = [
  [new RegExp(`^yc:(${ID}):([AR])$`), (m) => ({ kind: 'yc', id: m[1]!, accept: m[2] === 'A' })],
  [new RegExp(`^dm:(${ID}):([A-Z0-9_]+)$`), (m) => ({ kind: 'dm', id: m[1]!, code: m[2]! })],
  [new RegExp(`^lt:(${ID}):([TC])$`), (m) => ({ kind: 'lt', id: m[1]!, to: m[2] === 'T' ? 'THU' : 'CHI' })],
  [new RegExp(`^dk:(${ID}):([ASB])$`), (m) => ({ kind: 'dk', id: m[1]!, action: m[2] as DueAction })],
  [/^xh:([A-Za-z0-9_-]+):([VCQ]):([NBX]|J[A-Za-z0-9_-]+)$/, (m) => xhData(m)],
  [new RegExp(`^(gd|ct|qc|hk|sd|dx):(${ID})$`), (m) => ({ kind: m[1] as 'gd' | 'ct' | 'qc' | 'hk' | 'sd' | 'dx', id: m[2]! })],
];

// Mã hũ trong nút: 2 mã HU_<uuid> + phần khác vượt 64 byte → nén uuid thành 22 ký tự base64url; hũ mặc định = 'T'
const UUID_JAR = /^HU_([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/;

export function jarToken(id: string): string {
  if (id === 'TIET_KIEM') return 'T';
  const m = id.match(UUID_JAR);
  if (!m) return id;
  const hex = m.slice(1).join('');
  let bin = '';
  for (let i = 0; i < 32; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function jarFromToken(token: string): string {
  if (token === 'T') return 'TIET_KIEM';
  if (token.length !== 22 || token.startsWith('HU_')) return token;
  const bin = atob(token.replace(/-/g, '+').replace(/_/g, '/') + '==');
  const hex = [...bin].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return `HU_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function xhData(m: RegExpMatchArray): CallbackData {
  const mode = m[3]!.charAt(0) as 'N' | 'B' | 'X' | 'J';
  return { kind: 'xh', jarId: jarFromToken(m[1]!), dest: m[2] as 'V' | 'C' | 'Q', mode, ...(mode === 'J' ? { toJarId: jarFromToken(m[3]!.slice(1)) } : {}) };
}

// Dữ liệu lạ / sai dạng → null (bỏ qua)
export function decodeCallback(text: string | undefined): CallbackData | null {
  if (!text) {
    return null;
  }
  for (const [re, build] of PATTERNS) {
    const m = text.match(re);
    if (m) {
      return build(m);
    }
  }
  return null;
}
