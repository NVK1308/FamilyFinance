# FamilyFinance — Hướng dẫn sử dụng bot (ngắn gọn)

Cập nhật: 10/11/2026 (sau Phase 5c-2). Ví dụ theo một tháng của gia đình. Gõ `/help` trong bot để xem nhanh.

## 1. Bắt đầu (làm 1 lần)

| Nhắn | Bot làm gì |
|---|---|
| `/sodudau 5tr 3tr 2tr` | Số dư ban đầu: vợ 5tr, chồng 3tr, quỹ chung 2tr |
| `/taohu Mua nhà 2 tỷ` · `/taohu Y tế` | Tạo hũ để dành (mục tiêu không bắt buộc) |
| `/tietkiemdau 50tr mua nhà` · `/tietkiemdau 3 chỉ vàng 42tr` | Khai báo tiền / vàng đang có sẵn (không trừ ai) |

## 2. Thu chi hằng ngày — nhắn như nói chuyện

| Nhắn | Kết quả |
|---|---|
| `tiền ăn 50k` · `cafe 30k hôm qua` | Ghi Chi, tự chọn danh mục, đúng ngày |
| `lương 20tr` | Ghi Thu Lương |
| `mua đồ 200k` (chưa rõ) | Bot hỏi bằng nút: Thu/Chi, danh mục |
| `lấy quỹ chung đi chợ 300k` | Chi, tiền trừ ở quỹ chung |
| Bấm **Huỷ** dưới tin bot | Xoá khoản nhập nhầm |
| **Sửa số tiền** (trong 1 ngày, chỉ khoản mình nhập): sửa lại chính tin đã nhắn ("tiền ăn 50k" → "tiền ăn 80k"), hoặc bấm **✏️ Sửa số tiền** dưới tin bot rồi **trả lời** tin nhắc bằng số mới ("80k") | Khoản được sửa tại chỗ, người kia được báo. Chỉ đổi số tiền — đổi danh mục dùng nút danh mục, đổi khác thì Huỷ rồi nhắn lại |

Mỗi khoản ghi xong, người kia nhận tin báo.

## 3. Tiền qua lại giữa 2 người

| Nhắn | Kết quả |
|---|---|
| `chuyển vợ 3tr` | Vợ bấm **Đã nhận** thì số dư mới đổi. Xem khoản đang chờ: `/cho` |
| `bỏ vào quỹ chung 2tr` · `rút quỹ chung 1tr` | Nộp / rút quỹ chung |
| `chuyển vợ 2tr từ quỹ chung` · `rút quỹ chung cho vợ 2tr` | Quỹ chung đưa thẳng cho vợ: ghi ngay, vợ nhận tin kèm nút Huỷ |

## 4. Để dành (hũ) và vàng

| Nhắn | Kết quả |
|---|---|
| `bỏ hũ mua nhà 5tr` · `rút quỹ y tế 2tr` | Tiền vào / ra hũ |
| `khám bệnh 500k lấy từ quỹ y tế` | Chi, tiền lấy từ hũ Y tế |
| `mua vàng 2 chỉ 14tr/chỉ` · `bán vàng 1 chỉ 15tr` | Vàng vào / ra hũ (mặc định hũ Tiết kiệm), tiền mặt trừ / cộng người nhắn |
| `/giavang 15tr` · `/giavang 150tr lượng` · `/giavang` | Cập nhật / xem giá vàng hôm nay (1 chỉ) |
| `/tietkiem` | Từng hũ: tiền + vàng (≈ giá trị) + % mục tiêu |

**Xoá hũ** — `/xoahu mua nhà` (tiền còn lại về **quỹ chung**) · `/xoahu mua nhà vợ` (về vợ): bot hỏi lại, bấm **Xoá hũ** mới xoá.
- Hũ còn vàng: chọn **chuyển vàng sang hũ khác** (giữ nguyên số chỉ) hoặc **bán** theo giá đang dùng (tiền về quỹ chung / người đã nói).
- Tổng tài sản không đổi (tiền chỉ đổi chỗ). Lịch sử bỏ / lấy giữ nguyên; khoản cũ của hũ đã xoá **không huỷ / sửa được**. Tên hũ dùng lại được.
- Hũ đang âm → không xoá được (kiểm tra / huỷ khoản nhập sai trước). Hũ Tiết kiệm mặc định không xoá được.
- Sau khi xoá, nhắn "rút quỹ y tế 2tr" (hũ không còn) sẽ thành khoản chi Y tế như hũ lạ.

Vàng: 1 chỉ = 10 phân, 1 lượng = 1 cây = 10 chỉ. Giá trị vàng tính theo giá mới nhất: `/giavang` hoặc lần mua/bán gần nhất. Giá gõ nhầm khi mua/bán → bấm Huỷ; `/giavang` nhầm → gõ lại giá đúng. Rút tiền hũ để mua vàng: nhắn 2 tin (`rút hũ 28tr` rồi `mua vàng 2 chỉ 28tr`).

## 5. Hỏi và xem tổng hợp

| Nhắn | Kết quả |
|---|---|
| `/sodu` · `gia đình còn bao nhiêu` | Số dư từng người + quỹ + hũ = tổng tài sản |
| `/tuan` · `/thang trước` · `/thang 10 vợ` | Thu, chi, danh mục lớn, theo người |
| `tháng này vợ chi bao nhiêu` · `chi theo danh mục` | Số liệu |
| `ai chi nhiều nhất` · `khoản chi lớn nhất tháng này` | Xếp hạng |
| `so sánh tháng này với tháng trước` | So 2 kỳ |
| `liệt kê chi tiết vợ chi tuần trước` | Từng khoản: người → Thu/Chi → danh mục → ngày (tối đa 31 ngày) |
| `vàng còn mấy chỉ` · `quỹ y tế còn bao nhiêu` | Số dư hũ / vàng |
| `/baocao` · `/baocao trước` · `/baocao 10` | Báo cáo tháng: **ảnh tóm tắt** + **file HTML** đầy đủ. **20:00 ngày 1** hằng tháng tự gửi báo cáo tháng trước cho cả 2 người (lỗi thì gửi bù tới ngày 3; đổi ngày / giờ bằng `/cauhinh`) |
| `/dieuchinh vợ +12tr [lý do]` · `/dieuchinh vợ = 3tr` | Chỉnh số dư cho khớp tiền thật (quên khai số dư ban đầu, lệch tiền mặt). Không tính thu/chi; người kia được báo; có nút Huỷ |
| `/ghichu` · `/help` | Ghi chú nợ · danh sách lệnh |

## 4b. Nợ — vay / cho vay (tính vào số dư)

| Nhắn | Ghi | Số dư |
|---|---|---|
| `vay anh Nam 5tr` | Mình nợ anh Nam 5tr | Quỹ chung **+5tr** |
| `trả anh Nam 2tr` | Trả gốc (khoản cũ nhất với anh Nam) | Quỹ chung −2tr |
| `trả lãi anh Nam 200k` | Lãi vay — **tính vào chi** | −200k |
| `cho chị Lan vay 3tr` | Chị Lan nợ mình 3tr | Quỹ chung **−3tr** |
| `chị Lan trả 1tr` · `chị Lan trả lãi 200k` | Thu gốc · lãi cho vay (tính vào thu) | +1tr · +200k |
| `/no` · `còn nợ ai bao nhiêu` | Mình nợ ai, ai nợ mình, còn bao nhiêu | — |
| `/nodau vay anh Tú 50tr` · `/nodau cho chị Lan vay 3tr` | Nợ **có từ trước khi dùng bot** (tiền đã nằm trong số dư ban đầu) | Không đổi |

- Tiền mặc định vào / ra **quỹ chung**. Nói rõ người thì vào / ra người đó: `vợ vay anh Nam 5tr`, `vay anh Nam 5tr vào vợ`, `tôi vay …` (người nhắn).
- "trả / thu" chỉ thành trả nợ khi người đó **đang có khoản nợ đúng chiều** — `trả anh thợ 500k` vẫn là khoản chi. Trả nhiều hơn số còn nợ của khoản cũ nhất → bot báo, nhắn tách từng khoản (xem `/no`).
- Ghi nhầm → **Huỷ** (khoản vay đã có lần trả: huỷ các lần trả trước). Khoản nợ / lãi vay **không sửa số tiền** — Huỷ rồi nhắn lại.
- Câu không rõ người / chiều ("nợ 2tr", "trả nợ 2tr", "nợ chị Lan 1tr") vẫn chỉ lưu **ghi chú nợ** như trước (`/ghichu`).
- `/sodu` thêm **Đang nợ · Cho vay · Tài sản ròng** (= tài sản − đang nợ + cho vay); báo cáo tháng cũng có.
- Gõ không dấu "tra lai" (lãi hay lại?) bot không đoán — gõ có dấu.

## 4c. Ngân sách theo danh mục

| Gõ | Kết quả |
|---|---|
| `/ngansach thức ăn 5tr` · `/ngansach tiền ăn 5tr` | Đặt hạn mức tháng (tên danh mục hoặc từ khoá) — gõ lại = sửa |
| `/ngansach thức ăn 0` | Bỏ ngân sách |
| `/ngansach` | Bảng tháng này: đã chi / hạn mức · còn lại · thanh % |

- Tính **chi của cả nhà** (vợ + chồng + quỹ chung + chi từ hũ), theo **ngày của khoản chi**.
- Chi vượt **80%** và **100%** → bot báo **cả 2 người**, mỗi mốc 1 lần / tháng (kể cả khi sửa số tiền, đổi danh mục, bấm "đã trả" khoản định kỳ). Đổi mốc: `/cauhinh ngan_sach.canh_bao_phan_tram 90`. Đổi hạn mức giữa tháng → tính lại mốc theo hạn mức mới.
- Báo cáo tháng có bảng ngân sách.

## 5b. Khoản định kỳ (tiền điện, học phí, lương...)

| Nhắn | Kết quả |
|---|---|
| `/dinhky tiền điện 1tr5` | Thêm khoản định kỳ: Chi, danh mục Điện, người gõ trả |
| `/dinhky học phí 3tr quỹ` · `/dinhky lương 15tr chồng` | Chữ cuối `vợ` / `chồng` / `quỹ` = ai trả (khoản thu: ai nhận) |
| `/dinhky tiền điện 1tr8` (đã có) | Gõ lại cùng tên = sửa số tiền / người trả |
| `/dinhky` | Danh sách + tháng này đã ghi chưa; nút 🗑 Dừng từng khoản |

- **Ngày 2 hằng tháng lúc 20:00** bot gửi **1 tin chung** cho mỗi người: các khoản mình trả + khoản quỹ chung. Mỗi khoản 1 hàng nút:
  - **✅** đã trả (khoản thu: đã nhận) đúng số → ghi luôn, ngày ghi = hôm bấm.
  - **✏️** số khác (tiền điện mỗi tháng một khác) → **trả lời** tin bot gửi bằng số tiền, vd `1tr45`.
  - **⏭** tháng này không có → không ghi.
- Bấm xong, tin chung tự cập nhật (✅ đã ghi / ⏭). Khoản quỹ chung: ai bấm trước thì ghi, người kia bấm sau được báo "đã ghi".
- Lỡ tự nhắn khoản đó rồi (vd `tiền điện 1tr4`) → tin nhắc ghi "⚠️ Tháng này đã ghi …" để bấm ⏭, tránh ghi 2 lần.
- Chưa bấm → **3 ngày sau** nhắc lại 1 lần; quá **10 ngày** sau ngày nhắc → tự đóng, không ghi (nhắn khoản như thường nếu cần).
- Ghi nhầm → bấm **Huỷ** dưới tin kết quả: khoản về chờ, nút ✅ ✏️ ⏭ hiện lại. Sửa số tiền trong 1 ngày như khoản thường.
- Khoản thêm sau ngày nhắc của tháng → bắt đầu nhắc từ tháng sau.

**Cấu hình lịch — `/cauhinh`**: xem; `/cauhinh dinh_ky.ngay_nhac 5` đổi ngày nhắc. Đổi được: ngày / giờ nhắc khoản định kỳ, số ngày nhắc lại, số ngày tự đóng, ngày / giờ gửi báo cáo tháng, số ngày gửi bù. Giờ chọn trong 7–22. Đổi xong áp dụng từ lượt sau (tin đã gửi giữ lịch cũ). Sau này sửa được trên web.

## 6. Còn thiếu (cập nhật 14/11/2026)

**Thiếu khi dùng hằng ngày — nên làm sớm**
1. ✅ **Sửa số tiền khoản đã ghi** (đã code 12/11): trong 1 ngày, chỉ số tiền, chỉ người nhập.
2. ✅ **Xoá hũ** (đã code 15/11, mục 4): tiền về quỹ chung / người đã nói; vàng chuyển hũ hoặc bán. Không làm đổi tên (người dùng chốt).
3. ✅ **Nợ** (đã code 15/11, mục 4b): vay / cho vay / trả / lãi tính vào số dư, `/no`, `/nodau`.
4. ✅ **Điều chỉnh số dư qua chat**: `/dieuchinh` (đã code 11/11).

**Đã chốt 10/11**

5. ~~Đổi tiền hũ ↔ vàng trong 1 tin~~ — **không làm**, giữ nhắn 2 tin.
6. ✅ `/giavang` cập nhật giá vàng thị trường (đã code).
7. ✅ Chuyển từ quỹ chung thẳng cho vợ/chồng (đã code).
8. ✅ **Báo cáo tháng** (Phase 6, đã code 11/11): 20:00 ngày 1 hằng tháng (đổi bằng `/cauhinh`) gửi về Telegram **ảnh tóm tắt** + **file HTML**; `/baocao` khi cần. Sau đó: web xem báo cáo + đồng bộ về máy (phiên web), khoá kỳ đã chốt.

**Gợi ý thêm (chưa có trong kế hoạch)**

9. ✅ **Ngân sách theo danh mục** (đã code 15/11, mục 4c).
10. ✅ **Khoản định kỳ** (đã code 14/11): mục 5b. Để sau: nhắc theo ngày riêng từng khoản, chu kỳ quý / năm, chuyển tiền định kỳ.
11. **Tách ví / tài khoản ngân hàng**: hiện số dư gộp chung.

Còn lại: **11** (tách ví / tài khoản ngân hàng).
