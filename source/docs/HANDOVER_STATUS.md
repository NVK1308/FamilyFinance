# FamilyFinance — Trạng Thái Bàn Giao Phiên Làm Việc (Handover Status)

**Cập nhật lần cuối:** 05/11/2026 (xong Phase 4)  
**Conversation ID hiện tại:** `4833f210-ef60-4d7d-8ff3-6eebe30b1039`  
**Thư mục Workspace chuẩn:** `F:\FamilyFinance`

---

## 1. Các Quyết Định Nghiệp Vụ & Kiến Trúc Đã Chốt (Bắt buộc tuân thủ)

1. **Quy tắc `nguoi_giu_tien_id` (Q2 — đổi ngày 04/11/2026, thay "Hướng B"):**
   - Câu nói rõ người giữ ("tiền vợ giữ", "lấy quỹ chung") → theo câu; không nói → **người giữ = người thực hiện** ("lương chồng" → `CHONG`; không nêu ai → người nhắn). Ghi `HOAN_TAT` ngay, không hỏi lại người giữ tiền cho THU/CHI thường.
   - Chỉ chuyển tiền nội bộ mới cần xác nhận (Phase 4). Migration 0002 chặn giao dịch `HOAN_TAT` thiếu người giữ.
   - *Lịch sử:* trước 04/11/2026 dùng "Hướng B" (không tự suy, bot hỏi lại bằng nút chọn) — người dùng bỏ vì quá nhiều bước.
1b. **Tổng gia đình là số chính:** tổng 4 nhóm phải bằng số dư gia đình tính độc lập; lệch → `checkConsistency` chỉ ra bản ghi nghi vấn; tiền thật lệch → `proposeReconciliation` (chỉ tính) rồi `applyReconciliation` ghi `DIEU_CHINH` khi người dùng đồng ý.
1d. **Chuyển tiền & quỹ chung (Phase 4, 05/11/2026):** chuyển vợ ↔ chồng chờ người nhận bấm "Đã nhận"; "Chưa nhận" vẫn chờ; người chuyển huỷ được khi còn chờ; đã nhận thì sửa bằng chuyển ngược. Nộp/rút **1 quỹ chung** ghi ngay không cần xác nhận. **Bỏ phân bổ** đối tượng (giữ bảng).
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

### ✅ Phase 4 — Chuyển tiền nội bộ + Quỹ chung (HOÀN THÀNH, 155/155 test pass trên SQLite + PGlite, typecheck sạch)
- Plan + 3 vòng review: `E:\QuangIch\AIWorkspace\sessions\FamilyFinance\2026-11-05_phase4-chuyen-tien-phan-bo\`
- [transfer-service.ts](file:///F:/FamilyFinance/source/backend/src/services/transfer-service.ts): chuyển vợ↔chồng (tạo từ tin, "Đã nhận"/"Chưa nhận" qua `resolveConfirmation`, huỷ, danh sách chờ) + nộp/rút/huỷ quỹ chung; cờ cảnh báo vượt số dư (tính sau commit, gồm các chuyển đang chờ).
- [message-outcome.ts](file:///F:/FamilyFinance/source/backend/src/services/message-outcome.ts): kiểu kết quả chung (`TRANSFER`, `FUND_MOVE`), chống trùng, đọc lại kết quả cũ theo key trước nhánh bỏ qua.
- [transfer-repository.ts](file:///F:/FamilyFinance/source/backend/src/db/repositories/transfer-repository.ts); số dư nhóm cộng thêm quỹ chung ([balance-queries.ts](file:///F:/FamilyFinance/source/backend/src/db/repositories/balance-queries.ts)).
- Migration 0003 `chuyen_quy_chung` (17 bảng): [Postgres](file:///F:/FamilyFinance/source/backend/migrations/0003_chuyen_quy_chung.postgres.sql), [SQLite](file:///F:/FamilyFinance/source/desktop/FamilyFinance.Data/Migrations/0003_chuyen_quy_chung.sqlite.sql). File setup Neon gộp sẵn: `F:\FamilyFinance\temp\neon\03_setup_db_moi.sql` (chưa chạy trên Neon).
- Parser: chuyển có thời gian/chủ ngữ đứng trước, nộp/rút quỹ chung ([fund-detector.ts](file:///F:/FamilyFinance/source/backend/src/parser/fund-detector.ts)), "x hay y" mơ hồ, buổi + qua/nay, bỏ PHAN_BO.
- Test: [phase4-transfer.test.ts](file:///F:/FamilyFinance/source/backend/tests/phase4-transfer.test.ts).
- Đã biết, để sau: nhiều người hưởng ("cho vợ và con gái") → đối tượng trống (theo quyết định bỏ phân bổ); chuyển vợ↔chồng vẫn map nhóm theo `vai_tro` hiện tại (quỹ chung lưu snapshot `nhom_id`); cờ cảnh báo chạy thêm vài truy vấn sau mỗi tin chuyển (xem lại Phase 5); job HET_HAN + nút Telegram ở Phase 5.

---

### ✅ Phase 5a — Telegram Webhook + Bot (ĐÃ DEPLOY 05/11/2026, vợ/chồng đã đăng ký và chạy tích hợp)
- Plan v3 + 2 vòng review: `E:\QuangIch\AIWorkspace\sessions\FamilyFinance\2026-11-05_phase5-telegram-bot\`
- [worker.ts](file:///F:/FamilyFinance/source/backend/src/worker.ts): `createWorker({ dbFactory, telegramFactory, now })` → `fetch` + `scheduled`. Webhook `POST /telegram/webhook`: thiếu biến secret hoặc sai header → 401 trước khi đọc body (so sánh hằng thời gian); lỗi tạm thời (PG `08xxx`/`57P01`/`40001`/`40P01`, mất kết nối) → 500 để Telegram gửi lại; lỗi khác → tin `LOI` (transaction riêng) + báo người dùng, 200. Gửi Telegram trong `ctx.waitUntil` sau commit. `/api/parser/preview` chỉ bật khi `ENVIRONMENT=development`. [index.ts](file:///F:/FamilyFinance/source/backend/src/index.ts) chỉ nối Neon WS + Telegram thật.
- Bot: [handler.ts](file:///F:/FamilyFinance/source/backend/src/bot/handler.ts) (tin nhắn, nút bấm, ghi lỗi), [replies.ts](file:///F:/FamilyFinance/source/backend/src/bot/replies.ts), [commands.ts](file:///F:/FamilyFinance/source/backend/src/bot/commands.ts) (`/start /help /sodu /thang /cho /ghichu /sodudau`), [callback-data.ts](file:///F:/FamilyFinance/source/backend/src/bot/callback-data.ts) (≤ 64 byte). Telegram: [client.ts](file:///F:/FamilyFinance/source/backend/src/telegram/client.ts) (403 → ghi chú cho người chuyển; "not modified"/"query too old" bỏ qua).
- Chỉ nhận tin chữ trong chat riêng, không phải tin chuyển tiếp; sửa tin → nhắc Huỷ; người lạ → lưu DA_BO_QUA, không trả lời; lệnh không lưu vào `tin_nhan_goc`.
- Nghiệp vụ đổi (Q4/Q6, chi tiết ở PARSER_RULES 2c): có tiền chưa rõ danh mục → ghi Chi khác/Thu khác + nút đổi danh mục / đổi Thu↔Chi (`TransactionService.changeCategory`, UPDATE có điều kiện + audit `DOI_DANH_MUC`); nợ → ghi chú (`GHI_CHU_NO`); thiếu tiền / điều chỉnh → bỏ qua có lý do. `cancelTransaction(..., { chiNguoiTao: true })` chỉ bot truyền.
- "Chưa nhận" giữ nút, báo người chuyển ở lần đầu (đếm audit `CHUA_NHAN`); "Đã nhận" → báo người chuyển; người chuyển huỷ → báo người nhận. Update chuyển gửi lại → chỉ gửi lại người nhận khi còn chờ.
- Job hết hạn [expiry-service.ts](file:///F:/FamilyFinance/source/backend/src/services/expiry-service.ts): cron `0 18 * * *` (1h sáng VN), lô 50 (tối đa 20 lô), mỗi yêu cầu 1 transaction: chuyển → HET_HAN, yêu cầu → HET_HAN, tin gốc DA_BO_QUA (trừ DOI_TUONG_MOI), audit người thực hiện NULL; 0 dòng → rollback yêu cầu đó. Báo người chuyển khi chuyển hết hạn.
- Cờ vượt số dư lỗi → không cảnh báo, chỉ log (không làm hỏng tin đã ghi).
- Test: [phase5-bot.test.ts](file:///F:/FamilyFinance/source/backend/tests/phase5-bot.test.ts), [phase5-expiry.test.ts](file:///F:/FamilyFinance/source/backend/tests/phase5-expiry.test.ts). Test Phase 3–4 sửa có chủ đích theo hành vi mới: T7, T8, T9, T16, các test dùng "tiền ăn" để tạo yêu cầu (chuyển sang `legacyPending` tạo yêu cầu trực tiếp), "Danh mục lệch loại", F3/F6.
- Hướng dẫn deploy: [DEPLOY.md](DEPLOY.md).
- Đã biết, để sau: `/sodudau` gõ cùng lúc từ 2 máy có thể ghi đè nhau (rất hiếm); gửi lại update giao dịch "Quà tặng" chưa rõ loại thì bàn phím chỉ hiện khi danh mục là Khác; danh mục mã dài > ~21 ký tự không hiện nút (cần đổi sang số thứ tự khi có danh mục tự tạo); `/cho` truy vấn từng khoản (≤ 10).

### ✅ Phase 5b (5b-1 + 5b-2) — Trả lời câu hỏi thống kê (CODE XONG, 234/234 test pass trên SQLite + PGlite, typecheck sạch; CHƯA DEPLOY)
- Plan v3.1 + 2 vòng review: `E:\QuangIch\AIWorkspace\sessions\FamilyFinance\2026-11-06_phase5b-cau-hoi-thong-ke\`. Quy tắc: [QUERY_RULES.md](QUERY_RULES.md).
- Classifier tách câu hỏi khỏi câu ghi (Q6): "tiền ăn 50k?" vẫn ghi, "tiền ăn 50k rồi à?" là câu hỏi, "số dư 3tr" nhắc /sodudau.
- 5b-1: tổng thu/chi, tiết kiệm, tổng quan, số dư (cả 1 nhóm, cuối kỳ), theo danh mục, theo đối tượng, lọc người thực hiện / đối tượng / danh mục (nhóm học, y tế, ăn uống) / quỹ chung, "trong đó từ quỹ chung" (Q2). Câu nợ → xem /ghichu.
- 5b-2: khoản lớn nhất (top 5), ai chi nhiều nhất (theo người thực hiện), so sánh 2 kỳ (thứ tự theo câu, kỳ tương đối, kỳ dở dang), chuyển tiền theo trạng thái / chiều (lịch sử chỉ cộng khoản đã nhận), liệt kê (10 khoản mới nhất, thu/chi tách riêng).
- Câu hỏi chưa hiểu → lưu `tin_nhan_goc` DA_BO_QUA `CAU_HOI_CHUA_HIEU` (Q7). Câu hỏi hiểu được chỉ đọc DB.
- Đối tượng mới `CAC_CON` (Q8): seed 0003 (SQLite + PGlite), Neon chạy `temp/neon/04_them_cac_con.sql` **trước** khi deploy; `neon-members check` + deploy bước 5 kiểm có CAC_CON. Test Phase 4 A1 + contract `TC_11_V4_CAC_CON` sửa có chủ đích.
- Test: [phase5b-query.test.ts](file:///F:/FamilyFinance/source/backend/tests/phase5b-query.test.ts).

### ✅ Phase 5c-1 — Hũ tiết kiệm, phần tiền (CODE XONG, 252/252 test pass trên SQLite + PGlite, typecheck + verify-schema sạch; CHƯA DEPLOY, CHƯA COMMIT)
- Plan v2 + review vòng 1: `E:\QuangIch\AIWorkspace\sessions\FamilyFinance\2026-11-06_hu-tiet-kiem\`. Người dùng chốt: hũ là tài sản chung, khai báo + đắp dần như quỹ chung, giá trị lúc giao dịch; vàng (5c-2) định giá theo giá mua/bán gần nhất, không tự ghi lãi/lỗ.
- Bảng `hu_tiet_kiem` (migration 0004, Postgres + SQLite desktop, Neon `temp/neon/05_hu_tiet_kiem.sql`) — chi tiết [DATABASE_DESIGN.md](DATABASE_DESIGN.md) 3.1c. Đủ cột cho vàng (số phân) để 5c-2 không cần migration.
- Parser `savings-detector.ts` (trước quỹ chung) → `SAVINGS_MOVE`; `SavingsService` (ghi ngay, huỷ `hk:`, báo người kia, cảnh báo vượt số dư dùng chung `BalanceService.isOverBalance`); số dư tiền mặt 2 cách đều tính dòng hũ (cùng bộ lọc); `/tietkiem`, `/tietkiemdau <tiền>` (khoá `tg:<update_id>`); `/sodu` + câu hỏi số dư chung có hũ + tổng tài sản; câu hỏi số dư hũ / bỏ vào trong kỳ.
- Contract: `SAVINGS_MOVE`, `hu_tiet_kiem` trong `syncTablesOrder` (desktop Phase 7 phải đồng bộ bảng này). `neon-members check` + deploy bước 5 kiểm có bảng.
- Test: [phase5c-savings.test.ts](file:///F:/FamilyFinance/source/backend/tests/phase5c-savings.test.ts).

---

## 3. Công Việc Tiếp Theo

- **Deploy 5b + 5c-1**: Neon chạy `temp/neon/04_them_cac_con.sql` (nếu chưa) rồi `temp/neon/05_hu_tiet_kiem.sql`, sau đó `deploy.ps1 -From 3 -To 4 -Yes`. Thử câu hỏi thật, câu sai → bổ sung luật (xem tin `CAU_HOI_CHUA_HIEU`).
- **Phase 5c-2**: vàng (mua / bán / khai báo theo chỉ – phân – lượng, đơn giá "/chỉ", định giá theo giá gần nhất).
- Dồn lại: version seed (Phase 7), khoá kỳ đã chốt (Phase 8), test kết nối Neon WS thật (Phase 10).
