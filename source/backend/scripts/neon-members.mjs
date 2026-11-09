// Helper cho deploy.ps1 bước đăng ký Telegram ID (Q9). Đọc chuỗi kết nối từ biến môi trường FF_NEON_URL,
// không in chuỗi kết nối. Dùng:
//   node scripts/neon-members.mjs check          → đếm bảng / danh mục / thành viên, có CAC_CON chưa
//   node scripts/neon-members.mjs list           → tin của người lạ gần nhất (để lấy Telegram ID)
//   node scripts/neon-members.mjs set CHONG <id> [VO <id>] → cập nhật telegram_user_id thật
import { neon } from '@neondatabase/serverless';

const url = process.env.FF_NEON_URL;
if (!url) {
  console.error('Thieu bien moi truong FF_NEON_URL');
  process.exit(2);
}
const sql = neon(url);
const [cmd, ...args] = process.argv.slice(2);

async function main() {
  if (cmd === 'check') {
    const rows = await sql.query(
      `SELECT
         (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public')::int AS so_bang,
         (SELECT COUNT(*) FROM danh_muc)::int AS so_danh_muc,
         (SELECT COUNT(*) FROM thanh_vien)::int AS so_thanh_vien,
         (SELECT COUNT(*) FROM doi_tuong_thu_huong WHERE id = 'CAC_CON')::int AS co_cac_con,
         (SELECT COUNT(*) FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'hu_tiet_kiem')::int AS co_hu_tiet_kiem,
         (SELECT COUNT(*) FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'hu_tiet_kiem' AND column_name = 'hu_id')::int AS co_nhieu_hu`,
    );
    console.log(JSON.stringify(rows[0]));
    return;
  }
  if (cmd === 'list') {
    const rows = await sql.query(
      `SELECT telegram_chat_id::text AS id, noi_dung_goc AS tin, thoi_gian_nhan::text AS luc
       FROM tin_nhan_goc WHERE nguoi_gui_id IS NULL
       ORDER BY thoi_gian_nhan DESC LIMIT 10`,
    );
    const members = await sql.query('SELECT id, ten, telegram_user_id::text AS telegram_user_id FROM thanh_vien ORDER BY id');
    console.log(JSON.stringify({ tin: rows, thanh_vien: members }));
    return;
  }
  if (cmd === 'set') {
    // set CHONG <id> [VO <id>] — đăng ký từng người hoặc cả hai
    const pairs = [];
    for (let i = 0; i < args.length; i += 2) {
      pairs.push([args[i], args[i + 1]]);
    }
    const valid =
      pairs.length > 0 &&
      pairs.every(([role, id]) => (role === 'CHONG' || role === 'VO') && /^\d{5,15}$/.test(id ?? '')) &&
      new Set(pairs.map((p) => p[0])).size === pairs.length &&
      new Set(pairs.map((p) => p[1])).size === pairs.length;
    if (!valid) {
      console.error('Tham so: set CHONG <id> [VO <id>] (ID la so, 2 nguoi khac nhau)');
      process.exit(2);
    }
    // ID đang thuộc người kia (vd hoán đổi) → đổi qua ID tạm âm trước để không vướng UNIQUE
    const queries = pairs.map(([role], i) =>
      sql.query('UPDATE thanh_vien SET telegram_user_id = $1 WHERE id = $2', [-(i + 1), role]),
    );
    for (const [role, id] of pairs) {
      queries.push(
        sql.query(
          `UPDATE thanh_vien SET telegram_user_id = $1, version = nextval('sync_version_seq'), updated_at = NOW()
           WHERE id = $2`,
          [id, role],
        ),
      );
    }
    await sql.transaction(queries);
    const members = await sql.query('SELECT id, ten, telegram_user_id::text AS telegram_user_id FROM thanh_vien ORDER BY id');
    console.log(JSON.stringify(members));
    return;
  }
  console.error('Lenh: check | list | set <chong> <vo>');
  process.exit(2);
}

main().catch((error) => {
  // Không in error đầy đủ vì có thể chứa chuỗi kết nối
  console.error(`Loi Neon: ${String(error?.message ?? error).replace(url, '***')}`);
  process.exit(1);
});
