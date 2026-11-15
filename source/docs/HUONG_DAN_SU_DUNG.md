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
2. **Quản lý hũ**: đổi tên / ẩn / sửa mục tiêu.
3. **Thống kê nợ**: hỏi nợ → "chưa hỗ trợ"; ghi chú nợ không vào số dư.
4. ✅ **Điều chỉnh số dư qua chat**: `/dieuchinh` (đã code 11/11).

**Đã chốt 10/11**

5. ~~Đổi tiền hũ ↔ vàng trong 1 tin~~ — **không làm**, giữ nhắn 2 tin.
6. ✅ `/giavang` cập nhật giá vàng thị trường (đã code).
7. ✅ Chuyển từ quỹ chung thẳng cho vợ/chồng (đã code).
8. ✅ **Báo cáo tháng** (Phase 6, đã code 11/11): 20:00 ngày 1 hằng tháng (đổi bằng `/cauhinh`) gửi về Telegram **ảnh tóm tắt** + **file HTML**; `/baocao` khi cần. Sau đó: web xem báo cáo + đồng bộ về máy (phiên web), khoá kỳ đã chốt.

**Gợi ý thêm (chưa có trong kế hoạch)**

9. **Ngân sách theo danh mục** ("tiền ăn tối đa 5tr/tháng") + cảnh báo gần vượt.
10. ✅ **Khoản định kỳ** (đã code 14/11): mục 5b. Để sau: nhắc theo ngày riêng từng khoản, chu kỳ quý / năm, chuyển tiền định kỳ.
11. **Tách ví / tài khoản ngân hàng**: hiện số dư gộp chung.

Còn lại nên làm: **2** (quản lý hũ), **3** (thống kê nợ), **9** (ngân sách theo danh mục).
