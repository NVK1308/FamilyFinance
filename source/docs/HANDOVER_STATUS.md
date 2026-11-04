# FamilyFinance — Trạng Thái Bàn Giao Phiên Làm Việc (Handover Status)

**Cập nhật lần cuối:** 04/11/2026 (xong Phase 3)  
**Conversation ID hiện tại:** `4833f210-ef60-4d7d-8ff3-6eebe30b1039`  
**Thư mục Workspace chuẩn:** `F:\FamilyFinance`

---

## 1. Các Quyết Định Nghiệp Vụ & Kiến Trúc Đã Chốt (Bắt buộc tuân thủ)

1. **Quy tắc `nguoi_giu_tien_id` (Q2 — đổi ngày 04/11/2026, thay "Hướng B"):**
   - Câu nói rõ người giữ ("tiền vợ giữ", "lấy quỹ chung") → theo câu; không nói → **người giữ = người thực hiện** ("lương chồng" → `CHONG`; không nêu ai → người nhắn). Ghi `HOAN_TAT` ngay, không hỏi lại người giữ tiền cho THU/CHI thường.
   - Chỉ chuyển tiền nội bộ mới cần xác nhận (Phase 4). Migration 0002 chặn giao dịch `HOAN_TAT` thiếu người giữ.
   - *Lịch sử:* trước 04/11/2026 dùng "Hướng B" (không tự suy, bot hỏi lại bằng nút chọn) — người dùng bỏ vì quá nhiều bước.
1b. **Tổng gia đình là số chính:** tổng 4 nhóm phải bằng số dư gia đình tính độc lập; lệch → `checkConsistency` chỉ ra bản ghi nghi vấn; tiền thật lệch → `proposeReconciliation` (chỉ tính) rồi `applyReconciliation` ghi `DIEU_CHINH` khi người dùng đồng ý.
1c. **Thiếu thông tin thì không ghi (Q9):** thiếu số tiền, không rõ tiền gì, danh mục mới → chỉ lưu tin + yêu cầu `GIAO_DICH_MO_HO`/`DANH_MUC_MOI`; vay/trả nợ/điều chỉnh từ tin nhắn cũng hỏi lại (Q8), ghi nợ qua `DebtService`.
2. **Ranh giới TypeScript vs .NET:**
   - **Cloudflare Worker (TypeScript)** tại `source/backend/`: Đảm nhận toàn bộ Webhook Telegram, Parser tiếng Việt, Nghiệp vụ Bot, API đồng bộ và xuất file `.html` gửi trực tiếp trên Telegram.
   - **Ứng dụng Windows (.NET)** tại `source/desktop/`: Đảm nhận Sync 1 chiều (`Neon PostgreSQL → SQLite`), Backup/Restore an toàn (WAL-safe), Archive R2 và xuất Báo cáo HTML offline ra `F:\FamilyFinance\reports\`.
3. **Quản lý Khoản nợ:** Giữ đủ 2 bảng `khoan_no` và `lich_su_no` (tổng cộng 16 bảng vật lý đồng nhất 1-1 giữa PostgreSQL và SQLite).
4. **Cấu trúc Git:** Giữ `.git` tại `F:\FamilyFinance\.git` kèm `.gitignore` chặn toàn bộ dữ liệu thật/secret ngoài `source/`.

---

## 2. Tiến Độ Các Phase Đã Hoàn Thành

### ✅ Phase 0 — Khảo sát môi trường & Chuẩn hóa Git (HOÀN THÀNH)
- [FamilyFinance_Master_Code_Plan_v4.md](file:///F:/FamilyFinance/FamilyFinance_Master_Code_Plan_v4.md)
- [.gitignore](file:///F:/FamilyFinance/.gitignore)
- [appsettings.local.example.json](file:///F:/FamilyFinance/config/appsettings.local.example.json)
- [ENVIRONMENT_AUDIT.md](file:///F:/FamilyFinance/source/docs/ENVIRONMENT_AUDIT.md)

### ✅ Phase 1 — Thiết kế Schema, ERD, Migrations, Seeds & Contracts (HOÀN THÀNH & ĐÃ PASS TEST)
- [DATABASE_DESIGN.md](file:///F:/FamilyFinance/source/docs/DATABASE_DESIGN.md)
- [0001_initial_schema.postgres.sql](file:///F:/FamilyFinance/source/backend/migrations/0001_initial_schema.postgres.sql)
- [0001_initial_schema.sqlite.sql](file:///F:/FamilyFinance/source/desktop/FamilyFinance.Data/Migrations/0001_initial_schema.sqlite.sql)
- [0001_seed_reference_data.sql](file:///F:/FamilyFinance/source/backend/seeds/0001_seed_reference_data.sql)
- [domain-contracts.json](file:///F:/FamilyFinance/source/shared/contracts/domain-contracts.json)
- [parser-test-cases.json](file:///F:/FamilyFinance/source/shared/contracts/parser-test-cases.json)
- [verify-schema.mjs](file:///F:/FamilyFinance/source/scripts/verify-schema.mjs) *(Đã chạy pass 100%)*

### ✅ Phase 2 — Khởi tạo Backend Cloudflare Worker & Core Parser TypeScript (HOÀN THÀNH & ĐÃ PASS 20/20 UNIT TESTS)
- [package.json](file:///F:/FamilyFinance/source/backend/package.json), [tsconfig.json](file:///F:/FamilyFinance/source/backend/tsconfig.json), [wrangler.toml.example](file:///F:/FamilyFinance/source/backend/wrangler.toml.example)
- [constants.ts](file:///F:/FamilyFinance/source/backend/src/config/constants.ts) & [index.ts](file:///F:/FamilyFinance/source/backend/src/index.ts)
- Bộ **Vietnamese Finance Parser** (`F:\FamilyFinance\source\backend\src\parser\`):
  - [types.ts](file:///F:/FamilyFinance/source/backend/src/parser/types.ts), [normalizer.ts](file:///F:/FamilyFinance/source/backend/src/parser/normalizer.ts), [intent-classifier.ts](file:///F:/FamilyFinance/source/backend/src/parser/intent-classifier.ts), [date-parser.ts](file:///F:/FamilyFinance/source/backend/src/parser/date-parser.ts), [amount-parser.ts](file:///F:/FamilyFinance/source/backend/src/parser/amount-parser.ts), [role-resolver.ts](file:///F:/FamilyFinance/source/backend/src/parser/role-resolver.ts), [category-matcher.ts](file:///F:/FamilyFinance/source/backend/src/parser/category-matcher.ts), [index.ts](file:///F:/FamilyFinance/source/backend/src/parser/index.ts)
- [parser.test.ts](file:///F:/FamilyFinance/source/backend/tests/parser.test.ts) *(Pass 20/20 tests gồm 13 test cases chuẩn trong `parser-test-cases.json` + 7 bộ edge cases)*
- [PARSER_RULES.md](file:///F:/FamilyFinance/source/docs/PARSER_RULES.md)

---

### ✅ Phase 3 — Data Access + nghiệp vụ THU/CHI/Nợ (HOÀN THÀNH, 96/96 test pass trên SQLite + PGlite, typecheck sạch)
- Adapter: [pg-core.ts](file:///F:/FamilyFinance/source/backend/src/db/pg-core.ts), [neon-ws-adapter.ts](file:///F:/FamilyFinance/source/backend/src/db/neon-ws-adapter.ts) (transaction thật qua `@neondatabase/serverless`), [sqlite-memory-adapter.ts](file:///F:/FamilyFinance/source/backend/src/db/sqlite-memory-adapter.ts) (nạp 0001+0002, transaction xếp hàng), [pglite-adapter.ts](file:///F:/FamilyFinance/source/backend/tests/helpers/pglite-adapter.ts) (Postgres thật cho test)
- Repositories: [src/db/repositories/](file:///F:/FamilyFinance/source/backend/src/db/repositories/)
- Services: [transaction-service.ts](file:///F:/FamilyFinance/source/backend/src/services/transaction-service.ts), [balance-service.ts](file:///F:/FamilyFinance/source/backend/src/services/balance-service.ts), [debt-service.ts](file:///F:/FamilyFinance/source/backend/src/services/debt-service.ts)
- Migration 0002 (`chieu_dieu_chinh` + CHECK `HOAN_TAT` có người giữ): [Postgres](file:///F:/FamilyFinance/source/backend/migrations/0002_giao_dich_chieu_dieu_chinh.postgres.sql), [SQLite](file:///F:/FamilyFinance/source/desktop/FamilyFinance.Data/Migrations/0002_giao_dich_chieu_dieu_chinh.sqlite.sql); seed [0002](file:///F:/FamilyFinance/source/backend/seeds/0002_seed_lai_cho_vay.sql) (danh mục `LAI_CHO_VAY`). **Chưa chạy trên Neon thật** — chạy câu SQL kiểm vi phạm ở đầu file trước.
- Parser theo Q2 (holder mặc định = người thực hiện) + ca "lãi cho vay 500k".
- Test: [phase3-transaction.test.ts](file:///F:/FamilyFinance/source/backend/tests/phase3-transaction.test.ts), [phase3-balance-debt.test.ts](file:///F:/FamilyFinance/source/backend/tests/phase3-balance-debt.test.ts)
- Còn để phase sau: kết nối WebSocket Neon thật chưa test (Phase 10); parser còn nhầm "cho vay" → VAY, "thu hồi nợ" → THU, chưa nhận diện đối tượng lạ (`DOI_TUONG_MOI`) (Phase 5); xác nhận VAY/TRA_NO từ câu hỏi lại cần nối sang `DebtService` (Phase 5); chuyển `HET_HAN` do job (Phase 5); seed 0001 ghi `version` cố định nên sequence Postgres không tăng theo — xem lại khi làm sync watermark (Phase 7).

---

## 3. Công Việc Tiếp Theo Cần Làm: PHASE 4

Theo mục 5 của `FamilyFinance_Master_Code_Plan_v4.md`: chuyển tiền nội bộ Vợ ↔ Chồng (tạo/xác nhận/từ chối, không đổi tổng gia đình) và phân bổ giao dịch cho nhiều đối tượng thụ hưởng (`PHAN_BO`). Phase 3 đã đọc `chuyen_tien_noi_bo` khi tính số dư nhóm.
