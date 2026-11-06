# FamilyFinance — Hướng dẫn deploy Telegram bot (Phase 5a)

Tài liệu không chứa giá trị thật. Token bot, secret webhook và chuỗi kết nối Neon chỉ nhập qua `wrangler secret put` hoặc biến môi trường trên máy, **không** ghi vào file trong repo, **không** dán vào chat.

Thư mục làm việc: `F:\FamilyFinance\source\backend`.

## Cách nhanh: script chạy bước 3 → 7

Sau khi xong bước 1–2 (Neon đã có bảng, bot đã tạo):
```powershell
powershell -ExecutionPolicy Bypass -File F:\FamilyFinance\source\backend\scripts\deploy.ps1
```
Script lần lượt: kiểm công cụ + `wrangler login` → tạo `wrangler.toml` (production) → test → deploy → nhập token + chuỗi Neon (gõ ẩn, kiểm `getMe` và số bảng Neon) → sinh secret webhook + `setWebhook` → đăng ký Telegram ID thật (đọc/ghi Neon qua [neon-members.mjs](../backend/scripts/neon-members.mjs)). Mỗi bước ghi ra ngoài đều hỏi xác nhận. Chạy lại từ bước N: thêm `-From N` (vd `-From 6` để đổi secret webhook). Các mục dưới là cách làm tay tương đương.

## 1. Tạo database Neon

1. Tạo project trên Neon, lấy connection string (dạng `postgresql://...`).
2. Mở SQL Editor của Neon, chạy lần lượt:
   - `F:\FamilyFinance\temp\neon\01_kiem_tra.sql` (kiểm tra DB trống / phiên bản)
   - `F:\FamilyFinance\temp\neon\03_setup_db_moi.sql` (tạo bảng + dữ liệu mẫu)

## 2. Cấu hình bot trên BotFather

- `/setjoingroups` → **Disable** (bot chỉ dùng chat riêng).
- (Tuỳ chọn) `/setcommands`:
  ```
  sodu - Số dư từng người
  thang - Tổng thu chi tháng này
  cho - Khoản chuyển đang chờ
  ghichu - Ghi chú nợ
  sodudau - Nhập số dư ban đầu (1 lần)
  help - Hướng dẫn
  ```

## 3. Tạo file cấu hình Worker và nhập secret

```powershell
Copy-Item wrangler.toml.example wrangler.toml   # wrangler.toml không commit
```
Trong `wrangler.toml` đổi `ENVIRONMENT = "production"` (tắt `/api/parser/preview`). Giữ khối `[triggers] crons = ["0 18 * * *"]` (1h sáng giờ VN).

Tạo secret webhook ngẫu nhiên (chỉ chữ, số, `_`, `-`; 32–64 ký tự), ví dụ:
```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
```

Nhập 3 secret (wrangler hỏi giá trị, không hiện lên màn hình):
```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put NEON_DATABASE_URL
```
Thiếu `TELEGRAM_WEBHOOK_SECRET` → webhook từ chối mọi request (401).

## 4. Deploy

```powershell
npm test
npm run typecheck
npx wrangler deploy
```
Ghi lại URL Worker (dạng `https://family-finance-worker.<tài-khoản>.workers.dev`). Kiểm: mở `<URL>/health` → `{"status":"ok",...}`.

## 5. Đăng ký webhook với Telegram

Đặt token và secret vào biến môi trường của phiên PowerShell (không lưu file):
```powershell
$env:TG_TOKEN = Read-Host 'Bot token'
$env:TG_SECRET = Read-Host 'Webhook secret'
$body = @{
  url = 'https://<URL-worker>/telegram/webhook'
  secret_token = $env:TG_SECRET
  allowed_updates = @('message', 'edited_message', 'callback_query')
  drop_pending_updates = $true
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$($env:TG_TOKEN)/setWebhook" -ContentType 'application/json' -Body $body
Invoke-RestMethod "https://api.telegram.org/bot$($env:TG_TOKEN)/getWebhookInfo"
```
`getWebhookInfo` phải có đúng `url`, `pending_update_count` nhỏ, không có `last_error_message`.

## 6. Đăng ký Telegram ID thật cho vợ và chồng (Q9)

Dữ liệu mẫu đang dùng ID giả (`100000001`, `100000002`), nên lúc đầu bot coi cả hai là người lạ: chỉ lưu tin, không trả lời.

1. Mỗi người mở bot, nhắn 1 tin bất kỳ (vd "chồng đây", "vợ đây").
2. Trên Neon SQL Editor, đọc ID:
   ```sql
   SELECT telegram_chat_id, noi_dung_goc, thoi_gian_nhan
   FROM tin_nhan_goc
   WHERE nguoi_gui_id IS NULL
   ORDER BY thoi_gian_nhan DESC
   LIMIT 10;
   ```
   Chat riêng nên `telegram_chat_id` = Telegram user ID của người nhắn.
3. Cập nhật (thay `<ID_CHONG>`, `<ID_VO>` bằng số vừa đọc):
   ```sql
   UPDATE thanh_vien SET telegram_user_id = <ID_CHONG>, version = nextval('sync_version_seq'), updated_at = NOW()
   WHERE id = 'CHONG';
   UPDATE thanh_vien SET telegram_user_id = <ID_VO>, version = nextval('sync_version_seq'), updated_at = NOW()
   WHERE id = 'VO';
   SELECT id, ten, telegram_user_id FROM thanh_vien;
   ```
4. Nhắn `/start` → bot chào theo tên là xong.

## 7. Nhập số dư ban đầu và thử

1. Một người gõ: `/sodudau <vợ> <chồng> <quỹ chung>`, vd `/sodudau 5tr 3tr 2tr`. Chỉ nhập được 1 lần, ngày áp dụng = hôm nay. Nên nhập trước khi ghi giao dịch nào.
2. Thử lần lượt:
   - `tiền ăn 50k` → ✅ + nút Huỷ → bấm Huỷ.
   - `cafe 30k` → ghi Chi khác + nút danh mục → chọn "Thức ăn".
   - `chuyển vợ 100k` (chồng nhắn) → vợ nhận tin có nút → bấm "Đã nhận".
   - `/sodu`, `/thang`, `/cho`, `/ghichu`.

## 8. Vận hành

- **Đổi token / secret**: `npx wrangler secret put ...` rồi chạy lại bước 5 (setWebhook với secret mới).
- **Tắt bot tạm thời**: `Invoke-RestMethod "https://api.telegram.org/bot$($env:TG_TOKEN)/deleteWebhook"`.
- **Xem log**: `npx wrangler tail`.
- **Rollback code**: `git` về commit trước rồi `npx wrangler deploy`; hoặc `deleteWebhook`.
- Tin lỗi được lưu ở `tin_nhan_goc` với `trang_thai_xu_ly = 'LOI'` và `chi_tiet_loi`.
