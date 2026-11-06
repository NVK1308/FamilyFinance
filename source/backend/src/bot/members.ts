import type { MemberId } from '../config/constants.ts';
import { getMemberById, isActiveMember } from '../db/repositories/index.ts';
import type { DatabaseAdapter } from '../db/types.ts';

// Chat Telegram của thành viên (chat riêng = telegram_user_id); không active → null
export async function memberChatId(db: DatabaseAdapter, id: string): Promise<number | null> {
  const m = await getMemberById(db, id);
  return isActiveMember(m) ? Number(m.telegram_user_id) : null;
}

export function otherMember(id: string): MemberId {
  return id === 'VO' ? 'CHONG' : 'VO';
}
