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
| `/ghichu` · `/help` | Ghi chú nợ · danh sách lệnh |

## 6. Còn thiếu (cập nhật 10/11/2026)

**Thiếu khi dùng hằng ngày — nên làm sớm**
1. **Sửa khoản đã ghi**: hiện chỉ Huỷ rồi nhắn lại.
2. **Quản lý hũ**: đổi tên / ẩn / sửa mục tiêu.
3. **Thống kê nợ**: hỏi nợ → "chưa hỗ trợ"; ghi chú nợ không vào số dư.
4. **Điều chỉnh số dư qua chat** (khi lệch với tiền thật).

**Đã chốt 10/11**

5. ~~Đổi tiền hũ ↔ vàng trong 1 tin~~ — **không làm**, giữ nhắn 2 tin.
6. ✅ `/giavang` cập nhật giá vàng thị trường (đã code).
7. ✅ Chuyển từ quỹ chung thẳng cho vợ/chồng (đã code).
8. ⏳ **Báo cáo tháng** (Phase 6): ngày 1 hằng tháng gửi về Telegram **ảnh tóm tắt** (xem nhanh) + **file HTML** (đầy đủ); `/baocao` khi cần — đang lập plan. Sau đó: đồng bộ app máy tính (Phase 7), khoá kỳ đã chốt (Phase 8).

**Gợi ý thêm (chưa có trong kế hoạch)**

9. **Ngân sách theo danh mục** ("tiền ăn tối đa 5tr/tháng") + cảnh báo gần vượt.
10. **Khoản định kỳ** (điện, học phí, tiền nhà): nhắc hằng tháng, bấm 1 nút là ghi.
11. **Tách ví / tài khoản ngân hàng**: hiện số dư gộp chung.

Đề xuất làm trước: **1** (sửa khoản) và **10** (khoản định kỳ) — gặp hằng ngày.
