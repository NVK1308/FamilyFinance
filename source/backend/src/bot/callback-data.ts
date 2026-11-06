// callback_data của nút bấm (Telegram giới hạn 64 byte; dài nhất hiện nay ≈ 56 với dm:<GD_uuid>:TIEN_DUOC_CHO)
export type CallbackData =
  | { kind: 'yc'; id: string; accept: boolean } // Đã nhận / Chưa nhận
  | { kind: 'dm'; id: string; code: string } // đổi danh mục giao dịch
  | { kind: 'lt'; id: string; to: 'THU' | 'CHI' } // đổi sang Thu / Chi (ghi loại đích: bấm lặp không lật lại)
  | { kind: 'gd'; id: string } // huỷ giao dịch
  | { kind: 'ct'; id: string } // huỷ chuyển tiền
  | { kind: 'qc'; id: string } // huỷ dòng quỹ chung
  | { kind: 'hk'; id: string }; // huỷ dòng hũ tiết kiệm

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
  [new RegExp(`^(gd|ct|qc|hk):(${ID})$`), (m) => ({ kind: m[1] as 'gd' | 'ct' | 'qc' | 'hk', id: m[2]! })],
];

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
