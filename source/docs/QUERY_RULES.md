# FamilyFinance — Quy tắc trả lời câu hỏi thống kê (Phase 5b)

Bot trả lời câu hỏi tự nhiên bằng **luật cố định theo từ khoá** (không dùng AI). Thứ tự từ trong câu tự do, gõ có dấu hay không dấu đều được. Số liệu luôn tính bằng SQL. Câu không hiểu thì bot gợi ý câu mẫu.

Code: [intent-classifier.ts](../backend/src/parser/intent-classifier.ts) (tách câu hỏi khỏi câu ghi), [period-parser.ts](../backend/src/query/period-parser.ts), [query-parser.ts](../backend/src/query/query-parser.ts), [query-service.ts](../backend/src/services/query-service.ts), [query-repository.ts](../backend/src/db/repositories/query-repository.ts), [query-replies.ts](../backend/src/bot/query-replies.ts). Test: [phase5b-query.test.ts](../backend/tests/phase5b-query.test.ts).

## 1. Câu hỏi hay câu ghi (classifier)

Xét theo thứ tự sau, dừng ở bước đầu tiên khớp:

1. Câu có tiền tố có dấu hai chấm (`thu:`, `chi:`, `vay:`…) → **ghi**.
2. Câu yêu cầu xuất báo cáo HTML → báo chưa hỗ trợ.
3. **Từ hỏi mạnh** (`bao nhiêu`, `liệt kê`, `so sánh`, `lịch sử`, `thống kê`, `khoản chi nào`, `ai đã thanh toán`, `chi nhiều nhất`) hoặc **trợ từ hỏi** → **câu hỏi**, kể cả khi câu có số tiền.
   - Trợ từ hỏi chỉ xét trên chuỗi **có dấu**: cuối câu `à, hả, hở, chưa, không, nhỉ, sao, phải không, được không, rồi à, hay`; đầu câu `sao, tại sao, có phải, ai`; chữ `mấy` ở bất kỳ đâu.
   - Câu có số tiền thì câu trả lời kèm gợi ý cách ghi.
4. Câu **không có tiền**:
   - Có luật hỏi yếu (`?` cuối câu, bắt đầu bằng `tổng` hoặc `số dư`) → câu hỏi.
   - Có từ chỉ kỳ hoặc từ thống kê → câu hỏi. Ngoại lệ: câu chuyển tiền, nộp/rút quỹ, hoặc câu nợ thì vẫn **ghi** ("hôm qua bỏ quỹ chung", "hôm qua vay anh Nam").
     - Từ chỉ kỳ: hôm nay/qua/kia, tuần/tháng/quý/năm này/trước, `tháng N`, `quý N`, `năm YYYY`, `từ đầu…`, `dd/mm`.
     - Từ thống kê: lớn nhất, nhiều nhất, tiết kiệm, chưa xác nhận, bị huỷ, theo danh mục, từng người, chi phí, tổng, còn lại, số dư, đang giữ, thu chi.
     - Câu chuyển tiền có "vợ/chồng" mà không có từ hỏi ("chồng chuyển vợ tháng này") vẫn đi luồng ghi chuyển → bot báo thiếu số tiền. Muốn hỏi thì thêm "bao nhiêu".
5. Câu **có tiền** và có luật hỏi yếu (Q6):

   | Trường hợp | Kết quả |
   |---|---|
   | Bắt đầu bằng `số dư` ("số dư 3tr") | Không ghi, nhắc dùng /sodudau |
   | Có từ chỉ kỳ ("hôm nay tiền ăn 50k?") | Không ghi, nhắc nhắn rõ |
   | Các trường hợp còn lại | Bỏ `?` và chữ `tổng` ở đầu câu, phân loại lại. Nhận ra loại thu/chi hoặc danh mục thì **ghi** ("tiền ăn 50k?" → Thức ăn; "tổng thu 5tr" → Thu khác). Không nhận ra ("abc 50k?") thì nhắc |

6. Còn lại → chuyển tiền / ghi như trước.

**Cách xét "có tiền":** cắt các cụm kỳ (`năm 2026`, `tháng 10`, `quý 3`, `1/10`) trước. Sau đó số phải có đơn vị (`k`, `tr`, `đ`…) hoặc từ 10.000 trở lên. Vì vậy "tiền ăn tháng 10 năm 2026?" là câu hỏi, không phải khoản 2.026đ.

**Từ nợ:** so trên chuỗi có dấu (`nợ`, `vay`, `mượn`), nên "vậy" và "muốn" không bị hiểu là nợ. Câu gõ không dấu chỉ nhận các cụm rõ nghĩa: `no`, `vay` ở đầu câu, `đi/cho/khoản vay`, `vay/mượn anh/chị/…`.

## 2. Kỳ thời gian

- `today` là ngày theo giờ VN lúc nhận tin nhắn. Tuần bắt đầu từ thứ 2 (Q4).
- Các dạng hỗ trợ: hôm nay / qua / kia; tuần này / trước; tháng này / trước; `tháng N`, `tháng N/YYYY`, `tháng N năm YYYY|nay|ngoái|trước`; quý (cùng các dạng như tháng); năm nay / ngoái / `năm YYYY`; `từ dd/mm đến dd/mm|nay`; `từ đầu tuần|tháng|quý|năm (đến dd/mm[/yyyy])`; một ngày `dd/mm`.
- `tháng N` hoặc `quý N` không nêu năm mà chưa tới → hiểu là năm trước (hỏi "tháng 12" vào tháng 1).
- "từ đầu tháng đến 5/10" → tính từ đầu tháng chứa ngày cuối (01/10–05/10).
- Không nêu thời gian → **tháng này**. Riêng câu hỏi số dư → **hôm nay**.

## 3. Loại câu hỏi

Xét theo thứ tự:

| Loại | Nhận biết | Trả lời |
|---|---|---|
| Nợ | Có từ nợ, trừ "lãi cho vay" | "Chưa hỗ trợ thống kê nợ — xem /ghichu" |
| Chuyển tiền | `chuyển` / `ck` (so trên chuỗi có dấu: "chuyến đi", "vận chuyển" không tính; không dấu thì trừ "van chuyen", "chuyen di/xe/bay"), hoặc `chưa/chờ xác nhận`; câu có "quỹ chung" không tính | Xem mục 3a |
| Theo danh mục | theo danh mục, danh mục nào, vào gì, nhiều nhất vào | Bảng danh mục giảm dần (≤ 8 dòng). Khoản không có danh mục ghi theo loại (Lãi vay, Phí) |
| Theo đối tượng | từng người, theo đối tượng, cho ai | Bảng theo đối tượng, có dòng "Không ghi đối tượng" |
| Hũ tiết kiệm (5c) | "hũ / quỹ <tên hũ đang có>" → hỏi **1 hũ** ("quỹ y tế còn bao nhiêu"); "hũ" (có dấu; câu không dấu: `hu`), `hu tiet kiem`, `so tiet kiem`, `gui tiet kiem`; hoặc "tiết kiệm" + `còn` / `có` / `hiện có` (trừ "tiết kiệm **được**" = thu − chi). Xét trước loại Tổng | Có động từ bỏ / gửi / nộp / rút / lấy / tất toán (không có "còn") → **bỏ vào / lấy ra trong kỳ** (mặc định tháng này) + hũ hiện có. Còn lại → **số dư hũ** tại `min(cuối kỳ, hôm nay)` (mặc định hôm nay); hỏi chung → từng hũ + % mục tiêu + tổng |
| Số dư | số dư, đang giữ, chưa rõ/xác định người giữ, `còn` (có dấu; không dấu thì `con lại/bao nhiêu/tiền`, trừ "cho con …") | Số dư từng nhóm hoặc 1 nhóm, tại `min(cuối kỳ, hôm nay)`; kèm số đang chờ xác nhận chuyển (chỉ khi hỏi chung hoặc hỏi vợ/chồng). Hỏi chung → kèm hũ tiết kiệm + tổng tài sản (khi hũ ≠ 0). Xét trước "ai / nhiều nhất" ("ai đang giữ nhiều tiền nhất") |
| So sánh | so sánh | Thu / Chi / Tiết kiệm 2 kỳ + chênh (theo chỉ số cần tính). "so sánh … vợ và chồng" → theo người. Kỳ: mục 3b |
| Ai chi nhiều nhất | `ai` (trừ "chưa rõ ai giữ"), `người nào` | Tổng theo người thực hiện, giảm dần |
| Khoản lớn nhất | lớn nhất, to nhất, nhiều nhất, khoản (chi/thu) nào | Top 5 giao dịch theo số tiền (Chi mặc định, Thu nếu hỏi thu) |
| Liệt kê | liệt kê, lịch sử, danh sách, những/các khoản, chi tiết | 10 giao dịch mới nhất + tổng; hỏi cả thu và chi thì ghi thu, chi riêng (không cộng lẫn) |
| Tổng | Còn lại | Thu / Chi / Tiết kiệm / Tổng quan |

Mỗi dòng giao dịch: `ngày số tiền danh mục (người thực hiện)`; khoản thu có dấu `+`; danh mục Khác / không danh mục thì kèm 30 ký tự đầu của tin gốc.

### 3a. Chuyển tiền nội bộ

| Từ trong câu | Trạng thái | Trả lời |
|---|---|---|
| (mặc định) | Đã nhận | Tổng + số khoản |
| chưa/chờ xác nhận, đang chờ, chưa nhận | Chờ xác nhận | Danh sách (≤ 10). Không nêu kỳ → mọi khoản còn chờ ("tính đến hôm nay") |
| bị huỷ, đã huỷ, từ chối | Huỷ + từ chối | Danh sách |
| hết hạn | Hết hạn | Danh sách |
| lịch sử, liệt kê, danh sách | Mọi trạng thái | Danh sách; dòng đầu ghi số khoản và **chỉ cộng khoản đã nhận** |

- Chiều: "chồng chuyển vợ", "vợ chuyển", "chuyển cho chồng". Chỉ có vợ và chồng nên biết 1 bên là suy ra bên kia.
- Kỳ theo `ngay_chuyen`.

### 3b. Kỳ khi so sánh

- 2 kỳ trong câu → xếp theo thứ tự xuất hiện. Kỳ sau là tương đối ("tháng trước", "quý trước", "năm ngoái") hoặc trùng kỳ đầu → kỳ liền trước của kỳ đầu ("so sánh tháng 10 với tháng trước" = tháng 10 vs tháng 9).
- Chỉ 1 kỳ, đứng ngay sau "với" ("so sánh với năm ngoái") → năm nay vs năm ngoái (cùng loại tuần/tháng/quý/năm/ngày).
- Chỉ 1 kỳ khác → kỳ đó vs kỳ liền trước. Không nêu → tháng này vs tháng trước.
- Kỳ liền trước: tháng/quý/năm đủ → tháng/quý/năm trước; kỳ dở dang từ đầu tháng/quý/năm ("từ đầu năm" 01/01–06/11) → cùng đoạn kỳ trước (01/01–06/11 năm trước); kỳ khác → lùi đúng số ngày.

**Chỉ số cần tính:**
- Tiết kiệm: có từ `tiết kiệm`, `dư ra`, `chênh lệch`.
- Thu chi (tổng quan): có cụm `thu chi`.
- Theo phạm vi danh mục.
- Động từ thu (`thu`, `kiếm`, `lương`…) hoặc động từ chi (`chi`, `tiêu`, `xài`, `thanh toán`, `trả`, `mua`, `hết`, `chi phí`…).
- Có đối tượng → Chi.
- Không có gì → Tổng quan.

**Yêu cầu huỷ / xoá / sửa:** câu có `huỷ`, `xoá`, `hoàn tác`, `sửa lại/tin/khoản` (so trên chuỗi có dấu; "bị huỷ / đã huỷ" là trạng thái, không tính; "tiền sửa xe" không tính) → bot không thống kê, không ghi, không lưu tin, chỉ trả hướng dẫn: bấm "Huỷ" dưới tin ✅, chuyển đang chờ dùng /cho. Câu **bắt đầu** bằng huỷ/xoá có kèm tiền ("hủy khoản tiền ăn 50k") cũng không ghi.

**Không đoán bừa — câu không hiểu:** câu tổng thu/chi chỉ được trả lời khi có ít nhất 1 dấu hiệu: hỏi số tiền (`bao nhiêu`, `mấy`, `hết`, `tổng`, `thống kê`, `tình hình`, `thu chi`, `tiết kiệm`), hoặc nêu kỳ, danh mục, đối tượng, quỹ chung. Chỉ có trợ từ hỏi + động từ ("vợ chi chưa", "nhận được chưa") → không hiểu. "ai" chỉ hiểu khi đi cùng chi/thu/nhiều nhất. Bot gợi ý câu mẫu và lưu tin vào `tin_nhan_goc` với trạng thái `DA_BO_QUA`, `chi_tiet_loi = CAU_HOI_CHUA_HIEU` (Q7) để bổ sung luật sau. Câu hỏi hiểu được thì không lưu.

## 4. Bộ lọc

- **Người thực hiện:** "vợ/chồng" đứng trước động từ ("vợ chi", "chồng đã thanh toán"), hoặc "lương (của) vợ". Lọc theo `nguoi_thuc_hien_id`, kể cả khoản lấy tiền quỹ chung (Q2). Câu không có chủ ngữ thì không lọc theo người gửi.
- **Đối tượng:** `cho / của / dành cho` + con gái / con trai / các con / hai con / gia đình / cả nhà / vợ / chồng. Viết trần "con gái", "con trai", "các con", "gia đình chung" cũng được.
  - "Các con" = CON_GAI + CON_TRAI + CAC_CON.
  - Câu trả lời ghi chú "chỉ tính khoản có ghi rõ cho …".
- **Danh mục:** dùng từ khoá danh mục sẵn có. Có thêm 3 nhóm:

  | Từ khoá | Danh mục tính vào |
  |---|---|
  | `học` (không phải học phí/học thêm) | Học phí + Học thêm |
  | `y tế` | Y tế + Thuốc |
  | `ăn uống` | Thức ăn + Đi chợ + Sữa |

- **Quỹ chung:** câu có "quỹ chung" → chỉ tính khoản có người giữ là quỹ chung.
  - Câu hỏi Chi không lọc theo người giữ thì có thêm dòng "Trong đó từ quỹ chung" (cùng mọi bộ lọc khác). Khoản "rút quỹ rồi chi" có người giữ là vợ/chồng, nên không tính vào dòng này.

## 5. Quy tắc số liệu

- Chi = CHI + PHI + LAI_VAY; Thu = THU.
- Chỉ tính giao dịch `HOAN_TAT`, chưa xoá (`TX_IN_RANGE`).
- Không tính vào thu/chi: VAY, TRA_NO, DIEU_CHINH, chuyển nội bộ, nộp/rút quỹ, ghi chú nợ.
- Câu hỏi chỉ đọc DB.
- Giá trị trong SQL luôn truyền qua tham số; tên cột cố định trong code.

## 6. Đối tượng "Các con" (Q8)

- Câu ghi có "các con", hoặc "cho/của 2 con / hai con", hoặc đủ cả "con gái" và "con trai" → đối tượng `CAC_CON`.
- Có thêm đối tượng khác ("cho các con và cho vợ") → không gán đối tượng (NULL).
- "mua 2 con gà" không phải các con.
- Seed: [0003_seed_cac_con.sql](../backend/seeds/0003_seed_cac_con.sql).
- Neon đang chạy: chạy `temp/neon/04_them_cac_con.sql` **trước** khi deploy code 5b, vì cột đối tượng của giao dịch có khoá ngoại.
- Khoản cũ đã ghi "các con" vẫn để NULL.

## 7. Đã biết, chấp nhận

- "lương tháng 10" (không có tiền) giờ là câu hỏi tổng lương tháng 10. Trước đây bot báo thiếu số tiền.
- Trợ từ hỏi gõ không dấu ("tien an 50k roi a?") không nhận ra là câu hỏi. Theo Q6 thì câu này được ghi.
- Câu không dấu có chữ "con" có thể nhầm giữa "còn" và "con".
- Từ khoá `sua` khớp cả "sữa" và "sửa", tương tự như parser ghi.
