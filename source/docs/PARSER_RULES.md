# FamilyFinance v4.0 — Đặc Tả Quy Tắc Bộ Phân Tích Tiếng Việt (Vietnamese Finance Parser)

**Phiên bản:** `4.0.0`  
**Thư mục mã nguồn:** `F:\FamilyFinance\source\backend\src\parser\`  
**Tệp kiểm thử hợp đồng:** `F:\FamilyFinance\source\shared\contracts\parser-test-cases.json`

---

## 1. Nguyên Tắc Thiết Kế Cốt Lõi

1. **Tất định 100% (Deterministic Pipeline):** Không sử dụng LLM tự do sinh SQL hay suy đoán ngầm. Mọi tin nhắn đi qua pipeline 7 bước cố định, có thể kiểm thử lặp lại (reproducible) và truy vết nguyên nhân.
2. **Dùng chung `ParseContext` (Không lặp lại biểu thức chuẩn hóa):** Chuỗi gốc (`rawText`) được chuẩn hóa Unicode NFC, tạo bản chữ thường (`normalizedText`), bản không dấu (`asciiText`) và chuỗi làm việc (`workingAsciiText`) đúng 1 lần tại `normalizer.ts`. Các bước sau tiêu thụ (consume/mask) dần trên `workingAsciiText` để tránh xung đột token.
3. **Người giữ tiền (`nguoi_giu_tien_id`, Q2):** câu nói rõ người giữ ("tiền vợ giữ", "lấy quỹ chung") → theo câu; không nói → **người giữ = người thực hiện** ("lương chồng" → `CHONG`; không nêu ai → người nhắn). Ghi `HOAN_TAT` ngay, không hỏi lại `NGUOI_GIU_TIEN` cho THU/CHI thường; chỉ chuyển tiền nội bộ mới cần xác nhận (Phase 4). *(Đổi ngày 04/11/2026, thay "Hướng B" — trước đó bot hỏi lại khi câu không nói ai giữ tiền.)* Parser không bao giờ trả `null` cho giao dịch.
4. **Độc lập giữa Loại giao dịch (`THU`/`CHI`) và Danh mục (`ma_danh_muc`):** Tiền tố loại giao dịch quyết định chiều dòng tiền (`cashflow_impact`), danh mục chỉ phân nhóm nội dung (ví dụ: `"thu: nợ của a 1tr"` và `"chi: nợ của a 1tr"` cùng khớp danh mục `NO_CUA_ANH` nhưng ngược chiều dòng tiền).

---

## 2. Thứ Tự Pipeline 7 Bước

| Bước | Module | Nhiệm vụ chính |
| :--- | :--- | :--- |
| **Bước 1** | `normalizer.ts` | Chuẩn hóa Unicode NFC, gộp khoảng trắng, chuyển `đ/Đ -> d/D`, khởi tạo `ParseContext` và ngày tham chiếu theo `Asia/Ho_Chi_Minh`. |
| **Bước 2** | `intent-classifier.ts` | Nhận diện tiền tố tường minh (`thu:`, `chi:`, `vay:`, `trả nợ:`...), phân loại `RECORD_TRANSACTION`, `INTERNAL_TRANSFER`, `QUERY_STATISTICS`, `EXPORT_HTML_REPORT`. |
| **Bước 3** | `date-parser.ts` | Tách ngày giao dịch (`hôm nay`, `hôm qua`, `hôm kia`, `dd/mm`, `dd/mm/yyyy`) và xóa token ngày khỏi `workingAsciiText` trước khi tách số tiền. |
| **Bước 4** | `amount-parser.ts` | Trích xuất số tiền VND nguyên dương (`50k`, `50 nghìn`, `1tr`, `1tr5`, `1.5 triệu`, `2,5tr`, `1.200.000`, `1,200,000d`). Bỏ qua số nhỏ `< 1000` không kèm đơn vị tiền (`2 con`); phát hiện lỗi mơ hồ khi có `>= 2` cụm số tiền độc lập. |
| **Bước 5** | `role-resolver.ts` | Xác định tuần tự: (5a) `nguoi_giu_tien_id` $\rightarrow$ (5b) `doi_tuong_thu_huong_id` / `PHAN_BO` $\rightarrow$ (5c) `nguoi_thuc_hien_id` (giữ lại động từ/danh từ nghiệp vụ như `mua`, `lương` cho bước khớp danh mục) $ightarrow$ (5d) câu không nói người giữ thì `nguoi_giu_tien_id = nguoi_thuc_hien_id`. |
| **Bước 6** | `category-matcher.ts` | Khớp từ khóa danh mục theo thứ tự ưu tiên từ khóa dài nhất trước (`longest-match first`, ví dụ `'mua do an'` khớp `THUC_AN` trước `'mua do'` của `MUA_SAM`). |
| **Bước 7** | `index.ts` | Tổng hợp kết quả, tính `cashflow_impact` và sắp xếp `requires_confirmation` theo thứ tự chuẩn: `GIAO_DICH_MO_HO` $\rightarrow$ `DANH_MUC_MOI` $\rightarrow$ `DOI_TUONG_MOI` $\rightarrow$ `PHAN_BO` (parser không còn sinh `NGUOI_GIU_TIEN`). |

---

## 3. Lệnh Kiểm Thử Nhanh

```powershell
node --experimental-strip-types --test "F:\FamilyFinance\source\backend\tests\parser.test.ts"
```

