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

### ✅ Phase 5c-1 — Hũ tiết kiệm, phần tiền (một hũ: commit `33be996`; **nhiều hũ v3: CODE XONG 09/11, 263/263 test, typecheck + verify-schema sạch, CHƯA COMMIT, CHƯA DEPLOY**)
- v3 (plan mục 8–9, review_2): bảng `hu` + `hu_tiet_kiem.hu_id/giao_dich_id` (migration 0005, Neon `temp/neon/06_nhieu_hu.sql`); `/taohu <tên> [mục tiêu]`, `/tietkiem` từng hũ + % mục tiêu, `/tietkiemdau <tiền> [hũ]`; "bỏ hũ mua nhà 10tr", "rút quỹ y tế 2tr"; **chi trả từ hũ** ("khám bệnh 2tr lấy từ quỹ y tế" = giao dịch Chi + dòng lấy ra đi kèm, huỷ cả cặp, không đổi sang Thu, cảnh báo hũ âm, báo người kia); câu hỏi theo hũ; "tỷ". Chi tiết DATABASE_DESIGN 3.1d, PARSER_RULES 4a.
- Plan v2 + review vòng 1: `E:\QuangIch\AIWorkspace\sessions\FamilyFinance\2026-11-06_hu-tiet-kiem\`. Người dùng chốt: hũ là tài sản chung, khai báo + đắp dần như quỹ chung, giá trị lúc giao dịch; vàng (5c-2) định giá theo giá mua/bán gần nhất, không tự ghi lãi/lỗ.
- Bảng `hu_tiet_kiem` (migration 0004, Postgres + SQLite desktop, Neon `temp/neon/05_hu_tiet_kiem.sql`) — chi tiết [DATABASE_DESIGN.md](DATABASE_DESIGN.md) 3.1c. Đủ cột cho vàng (số phân) để 5c-2 không cần migration.
- Parser `savings-detector.ts` (trước quỹ chung) → `SAVINGS_MOVE`; `SavingsService` (ghi ngay, huỷ `hk:`, báo người kia, cảnh báo vượt số dư dùng chung `BalanceService.isOverBalance`); số dư tiền mặt 2 cách đều tính dòng hũ (cùng bộ lọc); `/tietkiem`, `/tietkiemdau <tiền>` (khoá `tg:<update_id>`); `/sodu` + câu hỏi số dư chung có hũ + tổng tài sản; câu hỏi số dư hũ / bỏ vào trong kỳ.
- Contract: `SAVINGS_MOVE`, `hu_tiet_kiem` trong `syncTablesOrder` (desktop Phase 7 phải đồng bộ bảng này). `neon-members check` + deploy bước 5 kiểm có bảng.
- Test: [phase5c-savings.test.ts](file:///F:/FamilyFinance/source/backend/tests/phase5c-savings.test.ts).

---

### ✅ Phase 5d — Lệnh tắt tổng hợp + liệt kê chi tiết (CODE XONG 09/11, 277/277 test; CHƯA COMMIT, CHƯA DEPLOY)
- Plan: `E:\QuangIch\AIWorkspace\sessions\FamilyFinance\2026-11-09_lenh-tat-liet-ke\`. Chi tiết [QUERY_RULES.md](QUERY_RULES.md) mục 3 (Liệt kê chi tiết) + 3c.
- "liệt kê chi tiết / tất cả …" → mọi khoản, nhóm người → Thu/Chi → danh mục → ngày; tối đa 31 ngày cuối kỳ đã chọn, 300 khoản; tự tách tin dài.
- `/tuan`, `/thang` [trước | 10 | 10/2025] [vợ | chồng] → 1 tin tổng hợp (dùng lại QueryService). `/thang` cũ thay bằng bản tổng hợp.
- Kèm các sửa sau sự cố bảng `hu` trên Neon: tin thường không lỗi khi bảng hũ lỗi, `/taohu` bỏ dấu `<>[]`, cảnh báo đầu file migration SQLite, deploy bước 5 kiểm kiểu bảng `hu` (`temp/neon/07_sua_bang_hu.sql`).

### ✅ Phase 5c-2 — Vàng trong hũ (CODE XONG 10/11, 294/294 test, typecheck sạch; CHƯA COMMIT, CHƯA DEPLOY; không cần SQL Neon)
- Plan v1 + review vòng 1 + v2 (mục 9): `E:\QuangIch\AIWorkspace\sessions\FamilyFinance\2026-11-10_vang-5c-2\`. Người dùng chốt V1–V4 theo đề xuất.
- Không migration: dùng cột sẵn có của `hu_tiet_kiem` (`loai_tai_san = 'VANG'`, `so_luong_phan` = số **phân**: 1 chỉ = 10 phân, 1 lượng = 1 cây = 100 phân).
- Parser `src/parser/gold-detector.ts`, chạy **trước** hũ tiền / quỹ chung / chi trả từ hũ:
  - `mua vàng 1 chỉ 14tr` → NOP (trừ tiền người nhắn / quỹ chung); `bán vàng 1 chỉ 15tr [bỏ / về quỹ chung]` → RUT (tiền về người bán); `khai báo vàng 3 chỉ [giá]`, `bỏ / cất 2 chỉ vàng vào hũ X` → KHAI_BAO (không trừ ai). Không ghi Thu/Chi, không lãi/lỗ.
  - Số lượng: `0,5 chỉ`, `nửa chỉ`, `1 chỉ rưỡi`, `1 chỉ 5 phân`, `1 lượng 2 chỉ`, `1 cây`; lẻ hơn phân → nhắc. Đơn giá: `14tr/chỉ`, `mỗi chỉ 14tr`, `giá 14tr 1 chỉ` (khi còn số lượng khác).
  - Câu có "vàng" + số lượng nhưng là trang sức / quà / có tiền tố loại → vẫn bỏ cụm số lượng trước khi khớp danh mục ("1 lượng" không còn thành Thu Lương).
  - Nhắc, không ghi: thiếu số lượng, tiền mơ hồ / số trần, bán không có tiền, `rút hũ … mua vàng` (đổi tiền hũ sang vàng — để sau), vàng ở nhiều hũ mà không nêu hũ.
- Định giá (Q1 c): giá trị = số phân × giá của dòng vàng có giá gần nhất (ưu tiên mua / bán; giá khai báo chỉ khi chưa có mua / bán). Đơn giá lệch > 30% giá đang dùng → cảnh báo gõ nhầm. Chưa có giá → "chưa định giá", không cộng vào tổng.
- Hiển thị: `/tietkiem`, `/sodu`, câu hỏi hũ / vàng (QUERY_RULES mục 3). `/tietkiemdau 3 chỉ vàng [42tr | 14tr/chỉ] [hũ]`. Không đặt được tên hũ "vàng".
- Test: [phase5c-gold.test.ts](file:///F:/FamilyFinance/source/backend/tests/phase5c-gold.test.ts). Code review high: 10 điểm, đã sửa hết.

### ✅ Quỹ chung → vợ/chồng + `/giavang` (CODE XONG 10/11, 304/304 test, typecheck + verify-schema sạch; CHƯA COMMIT, CHƯA DEPLOY)
- Người dùng chốt (10/11): bỏ "đổi tiền hũ ↔ vàng" (giữ nhắn 2 tin); làm `/giavang`; làm chuyển quỹ chung thẳng cho vợ/chồng; Phase 6 = báo cáo tháng gửi Telegram (HTML + ảnh tóm tắt).
- **Quỹ chung → người kia**: "chuyển vợ 2tr từ quỹ chung", "đưa vợ 2tr tiền quỹ chung", "rút / lấy quỹ chung cho / đưa vợ 2tr", "chuyển quỹ chung cho vợ 2tr" → 1 dòng `chuyen_quy_chung` RUT, `thanh_vien_id` = người ghi, `nhom_id` = người nhận (không migration). Ghi ngay (như mọi dòng quỹ chung), báo người nhận **kèm nút Huỷ** — người ghi hoặc người nhận huỷ được. Câu mơ hồ ("chuyển vợ 2tr cho quỹ chung", "…, quỹ chung còn 5tr") → nhắc; "chuyển chồng … từ quỹ chung" do chồng nhắn → không chuyển cho mình.
- **`/giavang`**: bảng mới `gia_vang` (migration 0006, Neon `temp/neon/08_gia_vang.sql`; deploy bước 5 kiểm `co_gia_vang`). `/giavang 15tr` (1 chỉ), `/giavang 150tr lượng`, `/giavang` (xem giá đang dùng). Giá đang dùng = giá `/giavang` nếu mới hơn (ngày, rồi thứ tự ghi) lần mua/bán có giá gần nhất (chưa có mua/bán thì so với khai báo). Lệch > 30% giá trước → cảnh báo gõ nhầm. Neon chưa có bảng → chỉ bỏ qua giá thị trường (đọc ngoài transaction), mua/bán vàng vẫn ghi.
- Test: [phase5e-fund-to-member.test.ts](file:///F:/FamilyFinance/source/backend/tests/phase5e-fund-to-member.test.ts), phase5c-gold (mục /giavang). Code review high: 10 điểm, đã sửa hết.

### ✅ `/dieuchinh` + Phase 6 báo cáo tháng (CODE XONG 11/11, 327/327 test, typecheck + verify-schema sạch; CHƯA COMMIT, CHƯA DEPLOY)
- Nguồn: số dư vợ âm −11.892.000đ (Neon 11/11, `temp/neon/kiem_tra_so_du_vo.sql`): số dư ban đầu 5tr, 0 khoản thu, 21 khoản chi 16,9tr — không phải vay mà là khai thiếu / chưa ghi thu.
- **`/dieuchinh <vợ|chồng|quỹ> <+tiền|-tiền|= số thực tế> [lý do]`** → `giao_dich` DIEU_CHINH TANG/GIAM (đổi số dư, không vào thu/chi), trả lời số dư trước → sau + nút Huỷ, báo người kia. Key `api:<update_id hex>` (Telegram gửi lại không ghi 2 lần).
- **Phase 6** (plan + review_1 + v2 mục 7–8: `E:\QuangIch\AIWorkspace\sessions\FamilyFinance\2026-11-10_bao-cao-thang\`; người dùng chốt: gói Workers **Free**, 8h ngày 1, cả 2 người):
  - `ReportService` (chỉ đọc, không giới hạn nhóm như tin nhắn; tổng các dòng = tổng chi). Tháng đang chạy so với cùng đoạn ngày tháng trước.
  - `report-html.ts`: trang tóm tắt 1080×1350 (chụp thành ảnh) + file HTML đầy đủ (danh mục, người, đối tượng, số dư cuối kỳ, hũ/vàng, chuyển tiền, quỹ chung, mọi khoản). Escape mọi chữ, CSP, không JS.
  - Ảnh: **Cloudflare Browser Rendering REST `/screenshot`** (`CF_ACCOUNT_ID`, `CF_BROWSER_TOKEN`); 2 người dùng chung 1 lần chụp; lỗi / thiếu cấu hình → tin chữ tóm tắt. File HTML dựng sau khi gửi ảnh.
  - `/baocao [trước | 10 | 10/2025]`: dựng sau khi webhook trả 200 (`BotAction` `deferred`).
  - Cron `0 1-14 1-3 * *` (`REPORT_CRON`, worker rẽ nhánh theo `controller.cron`) + bảng `bao_cao_da_gui` (migration 0007, Neon `temp/neon/09_bao_cao.sql`) — mỗi người 1 lần, gửi lại khi lỗi tối đa 3 lần.
- Sửa test P11 (phase4) phụ thuộc ngày chạy (yêu cầu xác nhận hết hạn 7 ngày) → đồng hồ cố định.
- Test: [phase5f-adjust.test.ts](file:///F:/FamilyFinance/source/backend/tests/phase5f-adjust.test.ts), [phase6-report.test.ts](file:///F:/FamilyFinance/source/backend/tests/phase6-report.test.ts). Ảnh tóm tắt + HTML đã xem thử bằng trình duyệt (Playwright). Code review high: 10 điểm (cron chưa đăng ký, lý do bị đọc thành đơn vị tiền, gửi lại vô hạn, dựng báo cáo trước khi trả 200, CPU…), đã sửa hết.

## 3. Công Việc Tiếp Theo

- **Deploy 5b + 5c-1 (nhiều hũ)**: Neon chạy lần lượt `temp/neon/04_them_cac_con.sql` → `05_hu_tiet_kiem.sql` → `06_nhieu_hu.sql` (file nào đã chạy thì bỏ qua; chạy lại cũng không sao), sau đó `deploy.ps1 -From 3 -To 4 -Yes`. Thử câu hỏi thật, câu sai → bổ sung luật (xem tin `CAU_HOI_CHUA_HIEU`).
- **Deploy đợt 10–11/11** (quỹ → vợ/chồng, /giavang, /dieuchinh, báo cáo tháng): Neon chạy `temp/neon/08_gia_vang.sql` → `09_bao_cao.sql`; tạo API token Browser Rendering + `wrangler secret put CF_ACCOUNT_ID` / `CF_BROWSER_TOKEN` (DEPLOY.md mục 3); rồi `deploy.ps1 -From 2 -To 4 -Yes` (**từ bước 2** để thêm lịch cron báo cáo). Sau deploy: `/baocao`, `/dieuchinh vợ = <số thực tế>` để sửa số dư vợ âm.
- Theo dõi log Worker lần chạy báo cáo đầu (gói Free 10 ms CPU: nếu lỗi 1102 thì tách dựng HTML / giảm số dòng).
- **Để sau**: quản lý hũ (đổi tên / ẩn / sửa mục tiêu); khoản "mua vàng" đã ghi Chi trước 5c-2 không tự chuyển. **Không làm** (người dùng chốt 10/11): đổi tiền hũ ↔ vàng trong 1 tin — giữ nhắn 2 tin.
- **Còn thiếu khi dùng hằng ngày** (rà theo [HUONG_DAN_SU_DUNG.md](HUONG_DAN_SU_DUNG.md) mục 6): sửa khoản đã ghi (hiện chỉ Huỷ + nhắn lại), thống kê nợ, điều chỉnh số dư qua chat. Gợi ý mới (chưa chốt): ngân sách theo danh mục + cảnh báo, khoản định kỳ (nhắc hằng tháng, 1 nút ghi), tách ví / tài khoản ngân hàng. Đề xuất ưu tiên: sửa khoản + khoản định kỳ.
- Dồn lại: version seed (Phase 7), khoá kỳ đã chốt (Phase 8), test kết nối Neon WS thật (Phase 10).
