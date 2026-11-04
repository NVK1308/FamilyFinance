# FAMILYFINANCE – AGENT RUNBOOK V3.0

**Phiên bản:** 3.0  
**Mục tiêu:** Xây dựng hệ thống quản lý thu chi gia đình qua Telegram Bot, có khả năng thống kê theo người thực hiện, đối tượng thụ hưởng, quản lý số tiền đang giữ, theo dõi chuyển tiền nội bộ và tổng hợp báo cáo.

---

# 1. MỤC TIÊU DỰ ÁN

FamilyFinance là hệ thống quản lý tài chính gia đình dành cho hai vợ chồng thông qua Telegram Bot.

Người dùng có thể:

- Gửi tin nhắn tự nhiên để ghi nhận THU, CHI.
- Theo dõi tổng số tiền gia đình còn lại.
- Theo dõi số tiền hiện vợ và chồng đang giữ.
- Ghi nhận lịch sử chuyển tiền giữa vợ và chồng.
- Theo dõi chi phí theo từng đối tượng: con gái, con trai, vợ, chồng, gia đình...
- Thống kê thu nhập và chi tiêu theo người thực hiện.
- Truy vấn số liệu theo ngày, tuần, tháng, năm hoặc khoảng thời gian tùy chọn.
- Xuất báo cáo HTML có bảng biểu và biểu đồ.
- Đồng bộ dữ liệu từ hệ thống trực tuyến về máy tính cá nhân.
- Sao lưu dữ liệu và tạo báo cáo trên máy tính Windows.

## 1.1. Nguyên tắc nghiệp vụ quan trọng nhất

FamilyFinance quản lý **một dòng tiền chung của gia đình**, không xây dựng hai hệ thống tài chính độc lập cho vợ và chồng.

Tuy nhiên, hệ thống vẫn phải theo dõi được:

1. Tổng tiền gia đình còn lại.
2. Tiền vợ đang giữ.
3. Tiền chồng đang giữ.
4. Tiền quỹ chung hoặc tiền chưa xác định người giữ.
5. Chi tiêu do vợ thực hiện.
6. Chi tiêu do chồng thực hiện.
7. Chi phí cho từng đối tượng thụ hưởng.
8. Lịch sử chuyển tiền giữa hai vợ chồng.

Chuyển tiền giữa vợ và chồng không làm tăng hoặc giảm tổng tiền gia đình.

---

# 2. KIẾN TRÚC HỆ THỐNG ĐÃ THỐNG NHẤT

## 2.1. Kiến trúc tổng thể

| Thành phần | Công nghệ | Nhiệm vụ |
|---|---|---|
| Telegram Bot | Telegram Bot API | Nhận tin nhắn, gửi phản hồi |
| Backend | Cloudflare Workers | Xử lý webhook, nghiệp vụ và API |
| Ngôn ngữ Backend | TypeScript | Chạy trên Cloudflare Workers |
| Cơ sở dữ liệu trực tuyến | Neon PostgreSQL | Lưu dữ liệu chính |
| Lưu trữ file | Cloudflare R2 | Lưu backup và archive |
| Ứng dụng máy tính | C#/.NET | Đồng bộ, backup, báo cáo |
| Database máy tính | SQLite | Lưu bản sao dữ liệu cục bộ |
| Báo cáo | HTML/CSS/JavaScript | Bảng biểu và biểu đồ |
| Quản lý mã nguồn | GitHub | Lưu source code |

**Lưu ý:** Cloudflare Workers sử dụng môi trường JavaScript/TypeScript. Không giả định có thể chạy trực tiếp ứng dụng .NET trên Workers.

Backend TypeScript và ứng dụng C#/.NET cần được phân tách rõ ràng thông qua API và hợp đồng dữ liệu.

## 2.2. Nguồn dữ liệu chính

Neon PostgreSQL là cơ sở dữ liệu trực tuyến chính thức.

SQLite trên máy tính là bản sao phục vụ:

- Tra cứu cục bộ.
- Đồng bộ dữ liệu.
- Tạo báo cáo.
- Backup.
- Khôi phục khi chuyển máy.

Giai đoạn MVP chỉ triển khai đồng bộ một chiều:

`Neon PostgreSQL → SQLite`

Không triển khai đồng bộ hai chiều khi chưa có thiết kế xử lý xung đột và được chủ dự án phê duyệt.

## 2.3. Lưu trữ và backup

- Cloudflare R2 lưu các file backup và dữ liệu archive.
- Máy tính Windows lưu backup độc lập.
- Không xóa dữ liệu cũ khi chưa có chính sách lưu trữ được phê duyệt.
- Trước khi archive hoặc xóa dữ liệu phải kiểm tra checksum, manifest, số lượng bản ghi và tổng tiền.
- Phải có quy trình kiểm tra khôi phục backup.

Các giới hạn và chính sách miễn phí của dịch vụ cần được kiểm tra tại thời điểm triển khai.

---

# 3. CẤU TRÚC THƯ MỤC

Thư mục gốc:

`F:\FamilyFinance\`

Cấu trúc đề xuất:

```text
F:\FamilyFinance\
│
├── source\
│   ├── backend\
│   │   ├── src\
│   │   ├── migrations\
│   │   └── tests\
│   │
│   ├── desktop\
│   │   ├── FamilyFinance.App\
│   │   ├── FamilyFinance.Core\
│   │   ├── FamilyFinance.Data\
│   │   └── FamilyFinance.Tests\
│   │
│   ├── shared\
│   │   ├── contracts\
│   │   └── documentation\
│   │
│   ├── scripts\
│   ├── .gitignore
│   └── README.md
│
├── data\
│   └── familyfinance.db
│
├── backup\
│   ├── daily\
│   ├── weekly\
│   └── manual\
│
├── reports\
│   ├── monthly\
│   └── custom\
│
├── logs\
│
└── temp\
```

Chỉ thư mục `source` được đưa lên GitHub.

Không đưa các nội dung sau lên GitHub:

- Database SQLite.
- Database backup.
- Telegram Bot Token.
- Database connection string.
- File `.env`.
- File cấu hình chứa mật khẩu.
- Báo cáo tài chính thực tế.
- Dữ liệu giao dịch gia đình.
- File log có thông tin cá nhân.

---

# 4. QUY TẮC NGHIỆP VỤ THU/CHI

## 4.1. THU và CHI là loại giao dịch

`THU` và `CHI` quyết định chiều tăng giảm của tiền.

Danh mục chỉ mô tả giao dịch thuộc nhóm nào, không quyết định giao dịch tăng hay giảm tiền.

Ví dụ:

| Tin nhắn | Loại | Danh mục | Ảnh hưởng |
|---|---|---|---:|
| THU: lương 20tr | THU | Lương | +20.000.000 |
| THU: OT 2tr | THU | OT | +2.000.000 |
| THU: tiền quà 500k | THU | Quà tặng | +500.000 |
| CHI: tiền ăn 100k | CHI | Thức ăn | -100.000 |
| CHI: học phí 2tr | CHI | Học phí | -2.000.000 |

Công thức:

`Số dư = Tổng THU - Tổng CHI`

Số tiền lưu trong database luôn là số dương. Loại giao dịch quyết định chiều tăng hoặc giảm.

## 4.2. Quy tắc xác định người thực hiện THU/CHI

Đây là quy tắc bắt buộc.

**Mặc định người gửi tin nhắn Telegram chính là người thực hiện giao dịch.**

Nếu nội dung tin nhắn chỉ rõ người khác thực hiện hoặc thanh toán thì ưu tiên người được chỉ rõ trong nội dung.

Ví dụ:

| Người nhắn | Nội dung | Người thực hiện |
|---|---|---|
| Vợ | CHI: tiền ăn 500k | Vợ |
| Chồng | CHI: tiền ăn 500k | Chồng |
| Vợ | CHI: tiền ăn 500k, chồng trả | Chồng |
| Vợ | CHI: chồng mua sữa 300k | Chồng |
| Chồng | CHI: vợ mua đồ cho con 200k | Vợ |
| Chồng | THU: lương 25tr | Chồng |
| Vợ | THU: lương 12tr | Vợ |

Quy tắc xử lý:

```text
nguoi_thuc_hien =
    người được chỉ rõ trong nội dung tin nhắn
    nếu không có thì lấy người gửi Telegram
```

Không được nhầm người tạo giao dịch với người thực hiện giao dịch.

## 4.3. Lưu riêng người tạo và người thực hiện

Mỗi giao dịch cần lưu:

- `nguoi_tao_id`: Người gửi tin nhắn Telegram.
- `nguoi_thuc_hien_id`: Người thực hiện THU/CHI.

Ví dụ:

Vợ nhắn:

`CHI: tiền ăn 500k, chồng thanh toán`

Dữ liệu:

```json
{
  "loai_giao_dich": "CHI",
  "so_tien": 500000,
  "nguoi_tao_id": "VO",
  "nguoi_thuc_hien_id": "CHONG",
  "danh_muc": "THUC_AN"
}
```

Giao dịch này được tính vào chi tiêu của chồng, không tính vào chi tiêu của vợ.

## 4.4. Danh mục

Danh mục cần độc lập với người thực hiện và đối tượng thụ hưởng.

Danh mục THU gợi ý:

- Lương.
- OT.
- Thưởng.
- Kinh doanh.
- Tiền được cho.
- Quà tặng.
- Thu hồi nợ.
- Thu khác.

Danh mục CHI gợi ý:

- Thức ăn.
- Đi chợ.
- Sữa.
- Học phí.
- Học thêm.
- Y tế.
- Thuốc.
- Điện.
- Nước.
- Internet.
- Nhà cửa.
- Đi lại.
- Mua sắm.
- Giải trí.
- Chi khác.

Danh mục có thể bổ sung hoặc chỉnh sửa.

Không tự ý tạo danh mục mới khi chưa kiểm tra danh mục hiện có.

## 4.5. Chuẩn hóa từ khóa

Ví dụ các từ:

- ăn
- ăn uống
- an
- an uong
- đồ ăn
- do an

Có thể được chuẩn hóa về danh mục `Thức ăn`.

Quy tắc:

1. Tìm danh mục hiện có.
2. Tìm từ khóa tương đương.
3. Nếu chắc chắn thì đề xuất danh mục phù hợp.
4. Nếu chưa chắc chắn thì hỏi người dùng.
5. Chỉ lưu alias sau khi người dùng xác nhận.

Không tự động gộp các danh mục có ý nghĩa khác nhau.

---

# 5. QUẢN LÝ SỐ DƯ GIA ĐÌNH VÀ TIỀN ĐANG GIỮ

## 5.1. Mục tiêu

Hệ thống phải trả lời được:

- Gia đình hiện còn bao nhiêu tiền?
- Vợ hiện còn bao nhiêu tiền đang giữ?
- Chồng hiện còn bao nhiêu tiền đang giữ?
- Quỹ chung còn bao nhiêu tiền?
- Có bao nhiêu tiền chưa xác định người đang giữ?

Không xây dựng hai hệ thống thu chi độc lập.

## 5.2. Cách tính

Tổng số dư gia đình:

`Số dư gia đình = Tổng THU - Tổng CHI`

Số tiền từng người đang giữ được theo dõi như một chiều thông tin bổ sung.

Các trường cần phân biệt:

- `nguoi_thuc_hien_id`: Người thực hiện THU/CHI.
- `nguoi_giu_tien_id`: Người đang giữ khoản tiền.
- `nguoi_tao_id`: Người tạo giao dịch.

Không mặc định người thực hiện luôn là người đang giữ tiền trong mọi trường hợp.

Ví dụ:

Vợ nhắn:

`THU: lương chồng 25tr`

Người thực hiện THU là chồng. Nếu tiền được nhận và chồng đang giữ thì người giữ tiền là chồng.

Nếu nội dung không xác định người giữ tiền, hệ thống cần ghi nhận trạng thái chưa xác định thay vì suy đoán.

## 5.3. Số dư ban đầu

Cần hỗ trợ nhập số dư ban đầu cho:

- Chồng đang giữ.
- Vợ đang giữ.
- Quỹ chung.
- Tiền chưa xác định người giữ.

Tổng các khoản này phải khớp với số dư ban đầu của gia đình.

Không tự đặt số dư ban đầu bằng 0 nếu người dùng chưa xác nhận.

## 5.4. Cập nhật số tiền đang giữ

Khi ghi nhận THU:

- Tăng tổng tiền gia đình.
- Cập nhật người giữ tiền nếu xác định được.
- Nếu chưa xác định người giữ thì đưa vào nhóm chưa xác định.

Khi ghi nhận CHI:

- Giảm tổng tiền gia đình.
- Giảm số tiền của người thanh toán nếu đã xác định được nguồn tiền.
- Nếu chưa xác định người giữ tiền đã thanh toán thì cần ghi nhận phần chưa xác định.

Khi cần thiết, bot hỏi thêm để cập nhật chính xác số tiền mỗi người đang giữ.

Không được dùng người nhắn Telegram thay thế thông tin người giữ tiền nếu nội dung không xác định.

---

# 6. CHUYỂN TIỀN NỘI BỘ GIỮA VỢ VÀ CHỒNG

## 6.1. Nguyên tắc

Chuyển tiền giữa vợ và chồng chỉ là dịch chuyển tiền trong nội bộ gia đình.

Không ghi nhận chuyển tiền nội bộ là THU hoặc CHI.

Ví dụ:

Chồng chuyển vợ 3 triệu:

- Tiền chồng đang giữ giảm 3 triệu.
- Tiền vợ đang giữ tăng 3 triệu.
- Tổng tiền gia đình không thay đổi.
- Lưu lịch sử chuyển tiền riêng.

## 6.2. Quy trình xác nhận

Khi chồng nhắn:

`Chuyển vợ 3 triệu`

Bot thực hiện:

1. Phân tích người chuyển.
2. Xác định người nhận.
3. Xác định số tiền.
4. Tạo bản ghi chuyển tiền.
5. Gửi yêu cầu xác nhận cho vợ.
6. Chờ vợ xác nhận đã nhận.
7. Khi xác nhận, cập nhật trạng thái và số tiền đang giữ.

Bot gửi cho vợ:

`Chồng chuyển bạn 3.000.000đ. Bạn đã nhận được tiền chưa?`

Nút lựa chọn:

- Đã nhận.
- Chưa nhận.

## 6.3. Trạng thái chuyển tiền

Các trạng thái:

- `CHO_XAC_NHAN`
- `DA_XAC_NHAN`
- `TU_CHOI`
- `DA_HUY`
- `HET_HAN`

Chỉ người nhận hợp lệ mới được xác nhận.

Không cho phép người khác xác nhận thay.

## 6.4. Xử lý khi chưa nhận

Nếu người nhận chọn chưa nhận:

- Không cập nhật số tiền người nhận đang giữ.
- Giữ trạng thái chờ xử lý hoặc chuyển sang từ chối theo quy tắc nghiệp vụ đã được phê duyệt.
- Người chuyển có thể kiểm tra và hủy giao dịch.
- Lưu toàn bộ lịch sử.

## 6.5. Dữ liệu chuyển tiền

Bảng `chuyen_tien_noi_bo` cần có:

- `id`
- `nguoi_chuyen_id`
- `nguoi_nhan_id`
- `so_tien`
- `ngay_chuyen`
- `trang_thai`
- `ngay_xac_nhan`
- `telegram_user_id_xac_nhan`
- `ghi_chu`
- `created_at`
- `updated_at`
- `version`

Bảo đảm xử lý idempotency để Telegram gửi lại webhook không làm phát sinh giao dịch trùng.

Chỉ được cập nhật số dư người giữ tiền một lần khi chuyển tiền được xác nhận hợp lệ.

Chuyển tiền không được làm thay đổi tổng số dư gia đình.

---

# 7. QUẢN LÝ ĐỐI TƯỢNG THỤ HƯỞNG

## 7.1. Mục tiêu

Theo dõi tiền đã chi cho ai, độc lập với người thực hiện giao dịch.

Các đối tượng có thể gồm:

- Vợ.
- Chồng.
- Con gái.
- Con trai.
- Thành viên khác.
- Gia đình.
- Đối tượng khác do người dùng khai báo.

Có thể khai báo nhiều con hoặc nhiều đối tượng.

Không giới hạn danh sách đối tượng ở hai vợ chồng.

## 7.2. Ví dụ

Tin nhắn:

`CHI: học phí con gái 2 triệu`

Dữ liệu:

- Loại giao dịch: CHI.
- Danh mục: Học phí.
- Người thực hiện: Người nhắn, trừ khi nội dung chỉ rõ người khác.
- Đối tượng thụ hưởng: Con gái.
- Số tiền: 2.000.000đ.

## 7.3. Phân biệt ba chiều thống kê

| Chiều dữ liệu | Câu hỏi |
|---|---|
| Người thực hiện | Ai đã THU/CHI? |
| Danh mục | Tiền dùng vào việc gì? |
| Đối tượng thụ hưởng | Tiền dành cho ai? |

Ví dụ:

`Vợ nhắn: CHI: chồng mua sữa cho con gái 500k`

Kết quả:

- Người tạo: Vợ.
- Người thực hiện: Chồng.
- Danh mục: Sữa.
- Đối tượng thụ hưởng: Con gái.
- Số tiền: 500.000đ.

Giao dịch này được tính:

- Vào tổng chi của chồng.
- Vào tổng chi cho con gái.
- Vào tổng chi gia đình đúng một lần.

## 7.4. Một giao dịch nhiều đối tượng

Hệ thống cần hỗ trợ một giao dịch có nhiều đối tượng thụ hưởng.

Ví dụ:

`CHI: mua đồ ăn cho các con 500k`

Phân bổ:

- Con gái: 200.000đ.
- Con trai: 200.000đ.
- Gia đình: 100.000đ.

Tạo bảng `phan_bo_giao_dich`.

Các trường:

- `id`
- `giao_dich_id`
- `doi_tuong_id`
- `so_tien_phan_bo`
- `ghi_chu`

Tổng số tiền phân bổ phải bằng số tiền giao dịch khi hoàn tất phân bổ.

Nếu người dùng chưa phân bổ thì có thể để trạng thái chưa phân bổ, không tự chia đều.

## 7.5. Danh sách đối tượng

Bảng `doi_tuong_thu_huong`:

- `id`
- `ten_doi_tuong`
- `loai_doi_tuong`
- `quan_he`
- `is_active`
- `created_at`
- `updated_at`

Cần hỗ trợ bí danh để bot nhận diện các cách gọi khác nhau của cùng một người.

Không tự tạo đối tượng mới nếu tên gọi chưa rõ có phải người đã tồn tại hay không.

---

# 8. MÔ HÌNH DỮ LIỆU

Thiết kế database cần hỗ trợ các bảng sau.

## 8.1. `thanh_vien`

Lưu người sử dụng hệ thống.

Trường:

- `id`
- `ten`
- `telegram_user_id`
- `vai_tro`
- `is_active`
- `created_at`
- `updated_at`

Telegram User ID phải được xác thực. Không chỉ dựa vào tên hiển thị Telegram.

## 8.2. `giao_dich`

Lưu các giao dịch THU/CHI.

Trường đề xuất:

- `id`
- `loai_giao_dich`
- `so_tien`
- `danh_muc_id`
- `nguoi_tao_id`
- `nguoi_thuc_hien_id`
- `nguoi_giu_tien_id`
- `doi_tuong_thu_huong_id` (nếu chỉ có một đối tượng chính)
- `mo_ta`
- `ngay_giao_dich`
- `trang_thai`
- `source_message_id`
- `idempotency_key`
- `created_at`
- `updated_at`
- `version`
- `deleted_at`

Không bắt buộc `nguoi_giu_tien_id` phải có giá trị nếu chưa xác định được.

Nếu giao dịch có nhiều đối tượng, dùng `phan_bo_giao_dich` thay vì chỉ dựa vào trường đối tượng chính.

## 8.3. `danh_muc`

Lưu danh mục THU/CHI.

Trường:

- `id`
- `ten_danh_muc`
- `loai_giao_dich`
- `mo_ta`
- `is_active`
- `created_at`
- `updated_at`

## 8.4. `tu_khoa_danh_muc`

Lưu các từ khóa và bí danh.

Trường:

- `id`
- `danh_muc_id`
- `tu_khoa`
- `normalized_keyword`
- `created_at`

## 8.5. `doi_tuong_thu_huong`

Lưu các đối tượng được chi tiền.

## 8.6. `phan_bo_giao_dich`

Liên kết một giao dịch với nhiều đối tượng thụ hưởng.

## 8.7. `chuyen_tien_noi_bo`

Lưu lịch sử chuyển tiền giữa vợ và chồng.

## 8.8. `so_du_ban_dau`

Lưu số tiền ban đầu của gia đình và phân bổ theo người giữ.

Trường:

- `id`
- `nguoi_giu_tien_id`
- `so_tien`
- `ngay_ap_dung`
- `ghi_chu`
- `created_at`

Hỗ trợ một nhóm quỹ chung hoặc chưa xác định người giữ.

## 8.9. `lich_su_chinh_sua`

Lưu lịch sử chỉnh sửa:

- ID giao dịch.
- Người chỉnh sửa.
- Dữ liệu trước.
- Dữ liệu sau.
- Thời gian.
- Lý do.

Không xóa lịch sử khi giao dịch bị chỉnh sửa hoặc hủy.

## 8.10. `tin_nhan_goc`

Lưu nội dung tin nhắn gốc để truy vết.

## 8.11. `yeu_cau_xac_nhan`

Lưu các yêu cầu cần người dùng xác nhận:

- Chuyển tiền.
- Danh mục chưa rõ.
- Đối tượng chưa rõ.
- Phân bổ chi phí.
- Các trường hợp nghiệp vụ khác.

## 8.12. Các bảng hệ thống

- `dong_bo`
- `bao_cao`
- `archive_manifest`
- `audit_log`

Thiết kế khóa ngoại, index, unique constraint và transaction phù hợp.

Sử dụng UUID hoặc ID ổn định để tránh trùng khi đồng bộ.

---

# 9. CÁC LOẠI GIAO DỊCH ĐẶC BIỆT

Không phải mọi biến động tiền đều là THU hoặc CHI thông thường.

Cần phân biệt:

| Loại | Ý nghĩa | Tính vào thu chi thông thường? |
|---|---|---|
| THU | Tiền thực nhận | Có |
| CHI | Tiền thực chi | Có |
| CHUYEN_NOI_BO | Chuyển tiền trong gia đình | Không |
| VAY | Nhận tiền vay | Không tính là thu nhập |
| TRA_NO | Trả nợ gốc | Không tính là chi tiêu tiêu dùng |
| DIEU_CHINH | Điều chỉnh số dư | Báo cáo riêng |
| LAI_VAY | Tiền lãi vay | Tính vào chi phí nếu xác nhận |
| PHI | Phí giao dịch | Tính vào chi phí nếu xác nhận |

Khoản vay làm tăng tiền đang giữ nhưng không làm tăng thu nhập thực tế.

Trả nợ gốc làm giảm tiền đang giữ nhưng không phải chi phí tiêu dùng.

Không được tính hai lần một giao dịch.

---

# 10. TELEGRAM BOT

## 10.1. Nhận tin nhắn

Bot cần hỗ trợ:

- Tiếng Việt có dấu.
- Tiếng Việt không dấu.
- Câu ngắn.
- Câu tự nhiên.
- Số tiền dạng 500k, 1tr, 1 triệu, 2.5 triệu.
- Ngày giao dịch cụ thể.
- Nội dung có nhiều thông tin trong một câu.

Ví dụ:

- `THU lương 20tr`
- `CHI tiền ăn 100k`
- `CHI chồng mua sữa cho con gái 300k`
- `Chuyển vợ 3tr`
- `Tháng này vợ chi bao nhiêu?`

## 10.2. Quy trình xử lý giao dịch

1. Xác thực Telegram User ID.
2. Lưu tin nhắn gốc.
3. Xác định loại yêu cầu.
4. Phân tích loại giao dịch.
5. Xác định số tiền.
6. Xác định danh mục.
7. Xác định người tạo.
8. Xác định người thực hiện theo quy tắc mặc định.
9. Xác định đối tượng thụ hưởng nếu có.
10. Xác định người giữ tiền nếu có thông tin.
11. Kiểm tra giao dịch trùng.
12. Kiểm tra thông tin bắt buộc.
13. Hỏi lại nếu có điểm chưa rõ ảnh hưởng đến việc ghi nhận.
14. Lưu giao dịch.
15. Trả lời xác nhận ngắn gọn.

## 10.3. Không tự suy đoán

Nếu tin nhắn thiếu danh mục hoặc đối tượng thụ hưởng, chỉ hỏi lại khi cần thiết cho yêu cầu đang thực hiện.

Không tự tạo danh mục, đối tượng hoặc bí danh khi chưa xác nhận.

Không tự chuyển loại giao dịch.

Không tự biến chuyển tiền nội bộ thành THU/CHI.

## 10.4. Chống ghi nhận trùng

Sử dụng:

- Telegram update ID.
- Message ID.
- Idempotency key.
- Unique constraint.

Một tin nhắn không được tạo nhiều giao dịch khi Telegram gửi lại webhook.

## 10.5. Phản hồi ngắn

Sau khi ghi nhận giao dịch, bot chỉ cần trả lời ngắn:

`Đã ghi nhận CHI 500.000đ – Thức ăn – Người thực hiện: Vợ.`

Không tự động gửi báo cáo dài sau mỗi giao dịch.

---

# 11. DANH MỤC CÂU HỎI TỔNG HỢP

Bot phải hiểu các câu hỏi tự nhiên sau.

## 11.1. Tổng quan gia đình

- Gia đình hiện còn bao nhiêu tiền?
- Tổng THU tháng này?
- Tổng CHI tháng này?
- Tháng này gia đình tiết kiệm được bao nhiêu?
- Tổng thu chi năm nay?
- So sánh tháng này với tháng trước.
- Những khoản chi lớn nhất tháng này?

## 11.2. Tiền đang giữ

- Vợ hiện còn bao nhiêu tiền?
- Chồng hiện còn bao nhiêu tiền?
- Quỹ chung còn bao nhiêu?
- Bao nhiêu tiền chưa xác định người giữ?
- Tổng tiền gia đình hiện tại?
- Số dư tại ngày cuối tháng trước?

Khi trả lời cần phân biệt:

- Số tiền đang giữ.
- Số tiền đã chi.
- Số tiền đang chờ xác nhận chuyển.
- Số tiền chưa xác định người giữ.

Không được suy ra số dư từng người chỉ từ tổng thu chi của người đó nếu không có thông tin phân bổ người giữ tiền.

## 11.3. Thống kê theo người thực hiện

- Tháng này vợ THU bao nhiêu?
- Tháng này chồng THU bao nhiêu?
- Tháng này vợ CHI bao nhiêu?
- Tháng này chồng CHI bao nhiêu?
- Từ đầu năm chồng đã chi bao nhiêu?
- Vợ chi nhiều nhất vào danh mục nào?
- Chồng chi nhiều nhất vào danh mục nào?

Chỉ cộng giao dịch theo `nguoi_thuc_hien_id`.

Không dùng `nguoi_tao_id` để thay thế.

## 11.4. Thống kê theo đối tượng thụ hưởng

- Tháng này chi cho con gái bao nhiêu?
- Tháng này chi cho con trai bao nhiêu?
- Từ đầu năm đã chi cho các con bao nhiêu?
- Chi phí học tập của con gái?
- Chi phí y tế của con trai?
- Tổng chi phí dành cho từng người?
- Chi phí gia đình chung?

## 11.5. Thống kê kết hợp

- Chồng đã chi bao nhiêu cho con gái tháng này?
- Vợ đã chi bao nhiêu cho con trai?
- Chồng chi tiền học cho các con bao nhiêu?
- Vợ chi tiền ăn cho gia đình bao nhiêu?
- Ai đã thanh toán nhiều nhất cho con gái?
- Tháng này khoản chi nào lớn nhất?

Kết quả phải lọc theo đúng hai hoặc nhiều chiều dữ liệu được hỏi.

## 11.6. Lịch sử chuyển tiền

- Tháng này chồng chuyển vợ bao nhiêu?
- Vợ đã chuyển chồng bao nhiêu?
- Những lần chuyển tiền chưa xác nhận?
- Lịch sử chuyển tiền tháng trước?
- Giao dịch chuyển tiền nào đã bị hủy?

Chuyển tiền nội bộ không được cộng vào tổng THU hoặc CHI gia đình.

## 11.7. Thời gian truy vấn

Hỗ trợ:

- Hôm nay.
- Hôm qua.
- Tuần này.
- Tuần trước.
- Tháng này.
- Tháng trước.
- Quý này.
- Quý trước.
- Năm nay.
- Năm trước.
- Từ ngày ... đến ngày ...
- Từ đầu tháng đến ngày ...
- Từ đầu năm đến ngày ...

Múi giờ mặc định: `Asia/Ho_Chi_Minh`.

---

# 12. BÁO CÁO HTML

Khi người dùng yêu cầu báo cáo, hệ thống tạo HTML.

## 12.1. Báo cáo tổng quan

Hiển thị:

- Tổng THU.
- Tổng CHI.
- Số dư.
- Biến động so với kỳ trước.
- Các khoản thu lớn.
- Các khoản chi lớn.

## 12.2. Báo cáo theo người thực hiện

Bảng:

| Người thực hiện | Tổng THU | Tổng CHI |
|---|---:|---:|
| Chồng | ... | ... |
| Vợ | ... | ... |
| Chưa xác định | ... | ... |

## 12.3. Báo cáo theo đối tượng

| Đối tượng | Tổng chi |
|---|---:|
| Con gái | ... |
| Con trai | ... |
| Gia đình | ... |
| Đối tượng khác | ... |

## 12.4. Báo cáo theo danh mục

| Danh mục | Số tiền |
|---|---:|
| Thức ăn | ... |
| Học phí | ... |
| Sữa | ... |
| Y tế | ... |

## 12.5. Báo cáo chuyển tiền

Hiển thị:

- Người chuyển.
- Người nhận.
- Số tiền.
- Ngày chuyển.
- Trạng thái xác nhận.

Không cộng các khoản chuyển tiền vào tổng chi gia đình.

## 12.6. Biểu đồ

Có thể dùng:

- Biểu đồ THU/CHI theo tháng.
- Biểu đồ chi theo danh mục.
- Biểu đồ chi theo đối tượng.
- Biểu đồ chi theo người thực hiện.
- Biểu đồ biến động số dư.

Mọi biểu đồ phải dựa trên dữ liệu đã lọc đúng, không tính trùng giao dịch.

---

# 13. ĐỒNG BỘ NEON → SQLITE

Ứng dụng Windows đồng bộ dữ liệu từ Neon PostgreSQL về SQLite.

Yêu cầu:

- Đồng bộ theo thời gian cập nhật.
- Có checkpoint.
- Có version.
- Có retry.
- Có log lỗi.
- Có xử lý bản ghi bị chỉnh sửa.
- Có xử lý bản ghi bị xóa mềm.
- Không tạo bản ghi trùng.
- Không làm mất dữ liệu cục bộ khi đồng bộ lỗi.

Không cho phép SQLite tự động ghi ngược lên Neon trong MVP.

Khi cần đồng bộ hai chiều trong tương lai, phải có thiết kế xung đột riêng và được phê duyệt.

---

# 14. BACKUP VÀ ARCHIVE

## 14.1. Backup

Hỗ trợ:

- Backup tự động hằng ngày.
- Backup hằng tuần.
- Backup thủ công.
- Kiểm tra file backup.
- Khôi phục backup.

Với SQLite đang sử dụng WAL, không được tùy tiện sao chép riêng file database chính.

Sử dụng SQLite Backup API hoặc quy trình checkpoint/đóng kết nối phù hợp.

## 14.2. Archive

Có thể lưu trữ dữ liệu cũ lên R2 khi dung lượng hoặc chi phí yêu cầu.

Nhưng:

- Không xóa dữ liệu chỉ vì đã archive.
- Phải có manifest.
- Phải kiểm tra checksum.
- Phải kiểm tra số lượng bản ghi.
- Phải kiểm tra tổng THU/CHI.
- Phải thử đọc lại dữ liệu archive.
- Chỉ được xóa bản gốc nếu có chính sách được chủ dự án phê duyệt.

---

# 15. BẢO MẬT

- Chỉ cho phép Telegram User ID đã đăng ký.
- Kiểm tra quyền ở backend.
- Không để Bot Token trong source code.
- Dùng secret/environment variables.
- Không ghi token vào log.
- Không đưa database thật lên GitHub.
- Dùng HTTPS.
- Kiểm tra webhook secret.
- Có audit log.
- Có giới hạn request.
- Chống replay và webhook trùng.
- Có quy trình thay đổi token khi bị lộ.

Dữ liệu tài chính gia đình phải được xem là dữ liệu riêng tư.

---

# 16. CÁC GIAI ĐOẠN TRIỂN KHAI

Agent không được tự ý thực hiện toàn bộ dự án trong một lần.

Mỗi giai đoạn phải có báo cáo và được chủ dự án xác nhận trước khi chuyển giai đoạn có thay đổi kiến trúc hoặc dữ liệu quan trọng.

## Phase 0 – Khảo sát

- Kiểm tra môi trường.
- Kiểm tra thư mục `F:\FamilyFinance\`.
- Kiểm tra Git.
- Kiểm tra .NET SDK.
- Kiểm tra Node.js.
- Kiểm tra cấu trúc repo.
- Đề xuất kiến trúc chi tiết.
- Báo cáo các rủi ro.

Không tạo hoặc xóa file nếu chưa được phê duyệt.

## Phase 1 – Thiết kế

- Thiết kế kiến trúc.
- Thiết kế database.
- Thiết kế API.
- Thiết kế Telegram workflow.
- Thiết kế chuyển tiền.
- Thiết kế báo cáo.
- Thiết kế đồng bộ.
- Thiết kế backup.

Phải có ERD và tài liệu nghiệp vụ.

## Phase 2 – Khởi tạo Backend

- Khởi tạo Cloudflare Worker.
- Cấu hình TypeScript.
- Cấu hình môi trường.
- Kết nối Neon.
- Tạo migration.
- Tạo health check.
- Tạo API cơ bản.

## Phase 3 – Telegram Bot

- Webhook.
- Xác thực người dùng.
- Nhận tin nhắn.
- Phân tích THU/CHI.
- Chuẩn hóa danh mục.
- Xác định người thực hiện.
- Lưu giao dịch.
- Chống trùng.

## Phase 4 – Chuyển tiền nội bộ

- Tạo object chuyển tiền.
- Xác định người chuyển/người nhận.
- Gửi yêu cầu xác nhận.
- Xác thực người nhận.
- Xử lý đã nhận/chưa nhận.
- Cập nhật số tiền đang giữ.
- Kiểm tra tổng tiền gia đình không thay đổi.

## Phase 5 – Đối tượng thụ hưởng

- Khai báo đối tượng.
- Chuẩn hóa tên.
- Phân bổ giao dịch.
- Thống kê theo đối tượng.
- Thống kê kết hợp người thực hiện và đối tượng.

## Phase 6 – Truy vấn tổng hợp

- Truy vấn theo ngày.
- Truy vấn theo tuần.
- Truy vấn theo tháng.
- Truy vấn theo năm.
- Truy vấn theo người.
- Truy vấn theo danh mục.
- Truy vấn theo đối tượng.
- Truy vấn nhiều điều kiện.

## Phase 7 – Báo cáo HTML

- Tạo báo cáo tổng quan.
- Báo cáo theo người.
- Báo cáo theo đối tượng.
- Báo cáo theo danh mục.
- Báo cáo chuyển tiền.
- Biểu đồ.

## Phase 8 – Ứng dụng Windows

- Tạo ứng dụng .NET.
- Kết nối Neon API.
- Đồng bộ về SQLite.
- Quản lý trạng thái đồng bộ.
- Backup.
- Khôi phục.
- Tạo báo cáo cục bộ.

## Phase 9 – Kiểm thử

Kiểm thử nghiệp vụ, bảo mật, hiệu năng, đồng bộ và khôi phục.

## Phase 10 – Triển khai

- Cấu hình production.
- Cấu hình webhook.
- Cấu hình database.
- Cấu hình R2.
- Kiểm tra backup.
- Kiểm tra quyền truy cập.
- Hướng dẫn vận hành.

---

# 17. TIÊU CHÍ NGHIỆM THU BẮT BUỘC

## 17.1. Xác định người thực hiện

Test 1:

Vợ nhắn:

`CHI: tiền ăn 500k`

Kết quả:

- Người tạo: Vợ.
- Người thực hiện: Vợ.

Test 2:

Vợ nhắn:

`CHI: tiền ăn 500k, chồng thanh toán`

Kết quả:

- Người tạo: Vợ.
- Người thực hiện: Chồng.

Test 3:

Chồng nhắn:

`CHI: vợ mua đồ cho con 200k`

Kết quả:

- Người tạo: Chồng.
- Người thực hiện: Vợ.
- Đối tượng thụ hưởng: Con nếu được xác định rõ trong nội dung.

## 17.2. Kiểm tra tổng tiền gia đình

Giả sử:

- Chồng có 15 triệu.
- Vợ có 10 triệu.
- Quỹ chung có 4 triệu.

Tổng: 29 triệu.

Chồng chuyển vợ 3 triệu và vợ xác nhận đã nhận.

Kết quả:

- Chồng: 12 triệu.
- Vợ: 13 triệu.
- Quỹ chung: 4 triệu.
- Tổng gia đình: 29 triệu.

Không phát sinh THU hoặc CHI.

## 17.3. Kiểm tra chi phí cho con

Vợ nhắn:

`CHI: chồng mua sữa cho con gái 500k`

Kết quả:

- Tổng chi gia đình tăng 500.000đ.
- Chi tiêu của chồng tăng 500.000đ.
- Chi phí cho con gái tăng 500.000đ.
- Không tính trùng tổng chi gia đình.

## 17.4. Kiểm tra thống kê

Bot phải trả lời chính xác:

- Tháng này vợ tiêu bao nhiêu?
- Tháng này chồng tiêu bao nhiêu?
- Tháng này chi cho con gái bao nhiêu?
- Chồng chi cho con gái bao nhiêu?
- Vợ chi cho con trai bao nhiêu?
- Gia đình còn bao nhiêu tiền?
- Vợ còn bao nhiêu tiền đang giữ?
- Chồng còn bao nhiêu tiền đang giữ?
- Có bao nhiêu khoản chuyển tiền chưa xác nhận?

## 17.5. Kiểm tra không tính trùng

- Chuyển tiền nội bộ không được tính vào THU/CHI.
- Một giao dịch nhiều đối tượng chỉ tính một lần trong tổng chi.
- Chỉnh sửa giao dịch không tạo giao dịch mới.
- Webhook gửi lại không tạo bản ghi trùng.
- Giao dịch hủy không được tính vào báo cáo chính thức.
- Khoản vay không được tính thành thu nhập.
- Trả nợ gốc không được tính thành chi tiêu tiêu dùng.

---

# 18. NHỮNG ĐIỀU AGENT KHÔNG ĐƯỢC TỰ Ý THỰC HIỆN

1. Không tự ý thay đổi kiến trúc đã phê duyệt.
2. Không tự ý chuyển sang database khác.
3. Không tự ý triển khai đồng bộ hai chiều.
4. Không tự ý xóa dữ liệu.
5. Không tự ý archive rồi xóa bản gốc.
6. Không tự ý thay đổi cách tính số dư.
7. Không tự ý tính chuyển tiền nội bộ vào THU/CHI.
8. Không tự ý gán người tạo thành người thực hiện khi nội dung chỉ rõ người khác.
9. Không tự ý gán đối tượng thụ hưởng khi chưa rõ.
10. Không tự ý tạo danh mục hoặc alias khi chưa xác nhận.
11. Không đưa dữ liệu gia đình lên GitHub.
12. Không ghi secret vào source code.
13. Không tự ý deploy production khi chưa được cho phép.
14. Không tự ý thực hiện migration phá hủy dữ liệu.
15. Không tự ý thay đổi số dư ban đầu.

Mọi thay đổi ảnh hưởng đến dữ liệu, bảo mật, chi phí hoặc kiến trúc phải báo cáo và xin phê duyệt.

---

# 19. QUY TRÌNH LÀM VIỆC CỦA AGENT

Mỗi lần làm việc:

1. Đọc tài liệu này.
2. Kiểm tra trạng thái source hiện tại.
3. Xác định phase đang thực hiện.
4. Đọc code liên quan trước khi chỉnh sửa.
5. Đề xuất kế hoạch ngắn.
6. Chỉ triển khai phạm vi đã được duyệt.
7. Chạy test.
8. Báo cáo file đã tạo/sửa.
9. Báo cáo kết quả test.
10. Báo cáo lỗi còn tồn tại.
11. Đưa ra bước tiếp theo.

Không tự làm vượt phạm vi đã được phê duyệt.

Khi phát hiện yêu cầu mâu thuẫn với tài liệu, phải dừng và hỏi chủ dự án.

---

# 20. PROMPT KHỞI ĐỘNG DÀNH CHO CODING AGENT

Sử dụng nội dung dưới đây khi bắt đầu giao việc cho Coding Agent:

---

Bạn là Coding Agent phụ trách triển khai dự án FamilyFinance.

Hãy đọc toàn bộ tài liệu `FamilyFinance_Agent_Runbook_v3.md` trước khi thực hiện bất kỳ thay đổi nào.

Thư mục gốc dự án:

`F:\FamilyFinance\`

Thư mục source:

`F:\FamilyFinance\source\`

Yêu cầu:

1. Tuân thủ toàn bộ nghiệp vụ và kiến trúc trong tài liệu.
2. Không tự ý thay đổi các nguyên tắc đã được phê duyệt.
3. Không xóa dữ liệu hoặc thực hiện thao tác phá hủy.
4. Không deploy production khi chưa có phê duyệt.
5. Không đưa dữ liệu tài chính hoặc secret lên GitHub.
6. Phải có test cho nghiệp vụ THU/CHI, chuyển tiền, số dư và thống kê.
7. Phải báo cáo rõ những gì đã làm và những gì chưa làm.

**Bắt đầu bằng Phase 0 בלבד: Khảo sát môi trường và source hiện tại.**

Ở Phase 0:

- Kiểm tra thư mục.
- Kiểm tra Git.
- Kiểm tra .NET SDK.
- Kiểm tra Node.js.
- Kiểm tra cấu trúc source hiện có.
- Kiểm tra các thành phần đã được cài đặt.
- Đánh giá khả năng triển khai kiến trúc.
- Phát hiện rủi ro và thiếu sót.

Không tự ý tạo database thật, không sửa source, không cài dịch vụ, không deploy và không xóa file.

Sau khi hoàn thành, hãy xuất báo cáo:

- Môi trường hiện tại.
- Các thành phần đã có.
- Các thành phần còn thiếu.
- Kiến trúc đề xuất.
- Các rủi ro.
- Kế hoạch Phase 1.

Dừng lại và chờ chủ dự án phê duyệt trước khi tiếp tục.

---

**KẾT THÚC FAMILYFINANCE AGENT RUNBOOK V3.0**
