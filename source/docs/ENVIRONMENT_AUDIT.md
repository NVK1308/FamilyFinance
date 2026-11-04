# Báo Cáo Khảo Sát Môi Trường (Phase 0 — Environment Audit)

**Ngày khảo sát:** 04/11/2026  
**Thư mục gốc:** `F:\FamilyFinance\`

---

## 1. Môi trường Hệ điều hành & Công cụ đã cài đặt

| Công cụ | Phiên bản hiện tại | Trạng thái | Ghi chú vận hành |
| :--- | :--- | :--- | :--- |
| **Hệ điều hành** | Windows (x64) | Sẵn sàng | Có ổ đĩa `F:\FamilyFinance\` |
| **.NET SDK** | `9.0.313` (Runtimes: 6.0, 8.0, 9.0) | Sẵn sàng | Có thể target `net8.0` hoặc `net9.0` cho ứng dụng Desktop |
| **Node.js** | `v24.20.0` | Sẵn sàng | Tương thích tốt với Cloudflare Workers / Wrangler / Vitest |
| **npm** | `11.19.0` | Sẵn sàng | Trên PowerShell cần gọi `npm.cmd` hoặc `npx.cmd` do ExecutionPolicy chặn `.ps1` |
| **Git** | `2.35.1.windows.2` | Sẵn sàng | Đã khởi tạo `.git` tại `F:\FamilyFinance\.git` |

---

## 2. Hiện trạng Thư mục & Git Repository (`F:\FamilyFinance\`)

- **Git Remote (`origin`):** `git@github.com:NVK1308/FamilyFinance.git` (nhánh `main`).
- **Các tệp tin hiện có trước khi triển khai:**
  - `FamilyFinance_Plan_MasterPrompt.md` (Bản 2.0 - 03/11/2026)
  - `FamilyFinance_Agent_Runbook_v3.md` (Bản 3.0 - 04/11/2026)
- **Các thành phần chưa tồn tại (cần khởi tạo từ Phase 1):**
  - Chưa có `.gitignore` tại gốc `F:\FamilyFinance\`.
  - Chưa có cấu trúc thư mục `source\`, `config\`, `data\`, `backup\`, `reports\`, `logs\`, `temp\`.
  - Chưa có project Backend (`source\backend\`) và Desktop (`source\desktop\`).

---

## 3. Rủi ro phát hiện & Biện pháp xử lý

1. **Chưa có `.gitignore` ở thư mục gốc `F:\FamilyFinance\`:**
   - *Rủi ro:* Vì `.git` nằm tại `F:\FamilyFinance\.git`, nếu tạo file database `data\familyfinance.db` hoặc `config\appsettings.local.json` trước khi có `.gitignore`, các file nhạy cảm có nguy cơ bị `git add .` đưa lên GitHub.
   - *Xử lý:* Tạo ngay `.gitignore` chặt chẽ ở Phase 0 trước khi tạo bất kỳ file cấu hình hoặc dữ liệu nào.
2. **PowerShell ExecutionPolicy chặn `npm.ps1`:**
   - *Rủi ro:* Chạy lệnh `npm` trực tiếp trong PowerShell sẽ báo lỗi `PSSecurityException`.
   - *Xử lý:* Sử dụng `npm.cmd` và `npx.cmd` trong mọi script/lệnh tự động hóa trên Windows PowerShell.
3. **Quyền Sandbox đối với thư mục ngoài Workspace (`F:\FamilyFinance`):**
   - *Rủi ro:* Một số lệnh CLI chạy dưới tiến trình con (như `git`, `dotnet`, `npm.cmd`) khi ghi trực tiếp vào `F:\FamilyFinance` có thể cần xác nhận quyền ngoài sandbox nếu ổ `F:\` chưa nằm trong active workspace.
   - *Xử lý:* Khuyến nghị mở `F:\FamilyFinance` làm Active Workspace trên IDE, hoặc phê duyệt lệnh khi cần chạy build/test trên `F:\FamilyFinance`.

---

## 4. Thông tin cấu hình sẽ cần ở các Phase kết nối dịch vụ thật (Phase 3, 5, 8)

*(Lưu ý: Giai đoạn Phase 1–2 thiết kế Schema, Parser và Unit Test chạy hoàn toàn độc lập với dữ liệu giả, chưa cần cung cấp secret thật)*:
- `TELEGRAM_BOT_TOKEN` & `TELEGRAM_WEBHOOK_SECRET`
- Danh sách `TELEGRAM_USER_ID` của Vợ và Chồng
- `NEON_DATABASE_URL` (Connection string PostgreSQL)
- Thông tin bucket Cloudflare R2 (nếu bật upload archive online)

