# FamilyFinance --- Master Plan & Agent Execution Runbook

**Phiên bản:** 2.0\
**Ngày:** 03/11/2026

> Tài liệu điều phối chính cho Coding Agent. Agent phải đọc toàn bộ tài
> liệu trước khi sửa mã nguồn. Triển khai theo phase, không tự ý thay
> đổi kiến trúc, xóa dữ liệu, đăng ký dịch vụ, mua gói hoặc triển khai
> production.

## 1. Vai trò và quy tắc bắt buộc của Agent

Bạn là Senior Software Engineer/Architect triển khai FamilyFinance.

1.  Khảo sát workspace, repository, file và cấu hình hiện có trước khi
    thay đổi. Không giả định dự án trống.
2.  Làm từng phase nhỏ; build/test sau mỗi phần có thể kiểm chứng.
3.  Trước khi thay đổi kiến trúc, nghiệp vụ, công nghệ hoặc thêm dịch vụ
    có phí, phải trình bày lý do và xin xác nhận.
4.  Không tự tạo GitHub repository, đăng ký dịch vụ, nhập thanh toán,
    bật production hoặc gửi tin nhắn Telegram thật.
5.  Không xóa/ghi đè/di chuyển dữ liệu nếu chưa có backup và xác nhận rõ
    ràng.
6.  Không đưa dữ liệu tài chính thật, token, mật khẩu, connection
    string, khóa mã hóa, DB hoặc backup vào Git.
7.  Không tự suy diễn giao dịch vay/trả nợ/chuyển tiền. Khi không chắc
    chắn phải hỏi lại.
8.  Không báo hoàn thành nếu chưa chạy build/test tương ứng.
9.  Cuối mỗi phase báo cáo file đã tạo/sửa, lệnh đã chạy, kết quả test,
    rủi ro và bước tiếp theo.
10. Không commit/push trừ khi người dùng yêu cầu.

Ưu tiên: an toàn dữ liệu → nghiệp vụ đã xác nhận → kiến trúc đã chốt →
đơn giản/bảo trì → tối ưu có căn cứ.

## 2. Mục tiêu hệ thống

Quản lý tài chính gia đình cho hai thành viên qua Telegram: - Ghi nhận
thu, chi và nghiệp vụ liên quan bằng tiếng Việt tự nhiên. - Hiểu số tiền
như `1tr`, `1 triệu`, `500k`, `50 nghìn`, `1.200.000`. - Chuẩn hóa danh
mục qua alias đã được xác nhận. - Hỏi lại khi loại giao dịch, số tiền,
ngày hoặc danh mục chưa rõ. - Lưu người gửi, tin nhắn gốc, thời điểm
nhận và trạng thái xử lý. - Trả lời tổng thu/chi/dòng tiền theo ngày,
tuần, tháng, khoảng thời gian, danh mục, thành viên. - Tạo báo cáo HTML
có bảng và biểu đồ khi người dùng yêu cầu hoặc theo lịch đã cấu hình. -
Đồng bộ dữ liệu về máy Windows khi máy bật; backup và hỗ trợ chuyển
máy. - Sau mỗi giao dịch chỉ phản hồi xác nhận ngắn; **không tự gửi tổng
kết sau từng giao dịch**.

## 3. Kiến trúc đã chốt

``` text
Telegram (2 thành viên)
       |
       v
Cloudflare Worker (Webhook/API)
       |
       +------> Neon PostgreSQL (CSDL online chính)
       |
       +------> Cloudflare R2 (archive/backup object)
       |
       v
Telegram phản hồi

Windows PC (khi bật)
       |
       v
FamilyFinance.Local (.NET)
       +------> Đồng bộ từ Neon
       +------> SQLite local (replica/cache)
       +------> Backup local
       +------> Báo cáo HTML/CSS/JS
```

  -----------------------------------------------------------------------
  Thành phần              Công nghệ               Vai trò
  ----------------------- ----------------------- -----------------------
  Online API              Cloudflare Workers      Webhook Telegram, xử
                                                  lý/điều phối

  Online DB               Neon PostgreSQL Free    Nguồn dữ liệu online
                          ban đầu                 chính

  Object storage          Cloudflare R2           Archive tháng và backup

  Local app               C#/.NET                 Sync, backup, quản trị,
                                                  báo cáo

  Local DB                SQLite                  Bản sao/cache và dữ
                                                  liệu báo cáo

  Reports                 HTML/CSS/JS             Báo cáo trình duyệt

  Source                  Git/GitHub              Chỉ mã nguồn và tài
                                                  liệu không nhạy cảm
  -----------------------------------------------------------------------

Không triển khai SQL Server trong giai đoạn đầu. Thiết kế lớp truy cập
dữ liệu để có thể bổ sung SQL Server hoặc đổi nhà cung cấp PostgreSQL về
sau.

**Lưu ý runtime:** Cloudflare Workers thường dùng JavaScript/TypeScript;
không mặc định giả định có thể chạy ứng dụng .NET trực tiếp trên
Workers. Trước khi triển khai, Agent phải đề xuất cách tổ chức Worker
TypeScript và phần local/core C#; giải thích ranh giới nghiệp vụ, API và
trade-off để người dùng duyệt.

### Nguyên tắc dữ liệu

-   Neon PostgreSQL là nguồn online có thẩm quyền duy nhất.
-   SQLite là replica/cache local; MVP chỉ đồng bộ một chiều Neon →
    SQLite.
-   Không tự triển khai ghi hai chiều hoặc tự merge hai nguồn.
-   Mọi thao tác ghi có ID ổn định và idempotency.
-   R2 lưu archive/object, không thay thế DB giao dịch.

## 4. Thư mục dự án

Root: `F:\FamilyFinance\`

``` text
F:\FamilyFinance\
├── source\
│   ├── FamilyFinance.sln
│   ├── backend\FamilyFinance.Worker\
│   ├── core\FamilyFinance.Core\
│   ├── local\FamilyFinance.Local\
│   ├── database\migrations\
│   ├── database\seeds\
│   ├── reports\templates\
│   ├── tests\
│   ├── scripts\
│   ├── docs\
│   ├── .gitignore
│   └── README.md
├── config\appsettings.local.example.json
├── data\familyfinance.db
├── backup\online\
├── backup\local\
├── backup\manual\
├── import\
├── export\
├── reports\YYYY\
├── logs\
├── tools\
└── README_LOCAL.md
```

Quy định: - Repository là `F:\FamilyFinance\source\`. - SQLite thật ở
ngoài repo: `F:\FamilyFinance\data\familyfinance.db`. - Cấu hình thật,
secrets, backup, import/export, báo cáo thật không ở trong repo. - Đường
dẫn phải lấy từ cấu hình, không hard-code `F:\` trong business logic. -
Không xóa file cũ chỉ vì không khớp cấu trúc đề xuất. - Nếu Agent không
được cấp quyền vào ổ F:, phải báo rõ; không giả vờ đã kiểm tra.

## 5. Quy tắc nghiệp vụ THU/CHI

**THU/CHI là loại giao dịch; danh mục là trường độc lập. Danh mục không
quyết định dấu cộng/trừ.**

  Tin nhắn              Loại   Danh mục          Số tiền     Dòng tiền
  --------------------- ------ ------------ ------------ -------------
  `thu: lương 20tr`     THU    Lương          20.000.000   +20.000.000
  `chi: tiền ăn 50k`    CHI    Thức ăn            50.000       -50.000
  `thu: nợ của a 1tr`   THU    Nợ của anh      1.000.000    +1.000.000
  `chi: nợ của a 1tr`   CHI    Nợ của anh      1.000.000    -1.000.000

Công thức: - Tổng thu = tổng `so_tien` của THU hợp lệ. - Tổng chi = tổng
`so_tien` của CHI hợp lệ. - Dòng tiền ròng = tổng thu − tổng chi. - Lưu
`so_tien` là số nguyên dương; `loai_giao_dich` quyết định chiều tác
động. - Dùng BIGINT PostgreSQL và số nguyên 64-bit SQLite; tuyệt đối
không dùng floating point cho tiền.

### Vay, trả nợ, chuyển quỹ

Có thể hỗ trợ các loại `VAY`, `TRA_NO`, `CHUYEN_QUY`, `DIEU_CHINH` tách
biệt: - Vay làm tăng tiền/tài khoản nhưng không phải thu nhập. - Trả gốc
làm giảm tiền/tài khoản nhưng không phải chi phí tiêu dùng. - Chuyển
giữa tài khoản trong gia đình không phải thu/chi. - Lãi/phí vay có thể
là chi phí nếu người dùng xác nhận. - Theo dõi dư nợ bằng mô hình khoản
nợ riêng; không suy ra dư nợ từ tên danh mục. - Tin nhắn mơ hồ phải được
hỏi lại.

### Ngày, số tiền và danh mục

-   Hỗ trợ `k`, `nghìn`, `ngàn`, `tr`, `triệu` và định dạng số phổ biến;
    viết unit test cho trường hợp có dấu chấm/phẩy.
-   Nếu thiếu số tiền hoặc không parse chắc chắn, không tạo giao dịch.
-   Mặc định ngày nghiệp vụ theo `Asia/Ho_Chi_Minh`; lưu timestamp chuẩn
    UTC và ngày nghiệp vụ local.
-   Nếu không ghi ngày, dùng ngày nhận theo múi giờ Việt Nam.
-   Alias ví dụ `ăn`, `ăn uống`, `an`, `an uong`, `đồ ăn`, `do an` có
    thể ánh xạ về `Thức ăn` **chỉ sau khi người dùng xác nhận**.
-   Chuẩn hóa tìm kiếm có thể lowercase, bỏ dấu, gộp khoảng trắng; vẫn
    lưu nội dung gốc.
-   Không tự tạo danh mục/alias khi chưa chắc chắn; hỏi người dùng và
    chỉ lưu alias sau xác nhận.

Phản hồi sau khi ghi, ví dụ:

``` text
Đã ghi CHI 50.000đ
Danh mục: Thức ăn
Nội dung: tiền ăn
Ngày: 03/11/2026
```

## 6. Telegram và webhook

-   Dùng HTTPS webhook; xác thực secret token theo cơ chế Telegram hỗ
    trợ.
-   Chỉ cho phép Telegram user ID đã đăng ký; không dùng username làm
    định danh duy nhất.
-   Lưu `update_id`/message ID để chống ghi trùng khi Telegram retry.
-   Lưu tin nhắn gốc và trạng thái xử lý.
-   Luồng: nhận → phân tích → hỏi xác nhận hoặc ghi thành công/thất bại.
-   Xác nhận phải gắn đúng người gửi, yêu cầu chờ và thời hạn.
-   Không để người ngoài truy vấn dữ liệu gia đình.
-   Không log bot token, connection string hoặc secrets.

## 7. Mô hình dữ liệu cần thiết kế

Agent phải tạo ERD, migration và giải thích quan hệ trước khi triển khai
nghiệp vụ. Tên bảng/cột `snake_case` không dấu; nhãn hiển thị tiếng Việt
có dấu.

Bảng lõi dự kiến: 1. `thanh_vien`: Telegram user ID, tên hiển thị, vai
trò, trạng thái. 2. `tin_nhan_goc`: Telegram update/message ID unique,
người gửi, nội dung gốc, thời gian nhận, trạng thái xử lý. 3.
`danh_muc`: tên danh mục, nhóm, trạng thái. 4. `tu_khoa_danh_muc`: alias
gốc/chuẩn hóa, danh mục, người xác nhận. 5. `tai_khoan`: tên, loại tài
khoản, chủ sở hữu, đơn vị tiền. 6. `giao_dich`: ID ổn định, loại, số
tiền, danh mục, tài khoản, mô tả, ngày giao dịch, người tạo, tin nhắn
nguồn, trạng thái, created/updated, version. 7. `khoan_no`: tên khoản
nợ, chiều nợ, đối tượng, gốc, ngày phát sinh/đến hạn, trạng thái. 8.
`lich_su_no`: biến động nợ, số tiền, ngày, giao dịch liên quan. 9.
`lich_su_chinh_sua`: bảng/record, hành động, giá trị trước/sau, người
sửa, thời điểm. 10. `yeu_cau_xac_nhan`: tin nhắn nguồn, người gửi, dữ
liệu đề xuất, loại xác nhận, trạng thái, hết hạn. 11. `dong_bo`: máy
local, watermark/cursor, thời điểm, trạng thái, số bản ghi, lỗi. 12.
`archive_manifest`: tháng, object key, schema version, số dòng theo
bảng, tổng kiểm tra, SHA-256, thời điểm và trạng thái xác minh.

Có thể điều chỉnh schema sau khi trình bày ERD, nhưng không được bỏ qua
idempotency, audit, sync cursor/version, tombstone/soft-delete và khả
năng archive/restore.

## 8. Đồng bộ Neon → SQLite

-   MVP chỉ kéo dữ liệu từ Neon về SQLite.
-   Mỗi bản ghi có ID ổn định; upsert theo ID.
-   Đồng bộ thay đổi và tombstone để local không giữ dữ liệu đã xóa/ẩn.
-   Dùng cursor/version hoặc watermark kết hợp ID; không chỉ dựa
    timestamp nếu có thể trùng.
-   Batch, retry có giới hạn, timeout, checkpoint và log.
-   Chạy sync nhiều lần không được nhân đôi dữ liệu.
-   Có chế độ dry-run và trạng thái sync cuối.
-   SQLite bật foreign keys, index theo ngày/loại/danh mục/tài khoản/ID
    đồng bộ, transaction cho batch.
-   Có thể dùng WAL; backup phải xử lý đúng `-wal`/`-shm`.
-   Không copy file SQLite đang mở một cách tùy tiện. Dùng SQLite Backup
    API hoặc checkpoint/đóng kết nối theo quy trình an toàn.

## 9. Chính sách archive và backup

### Chính sách lưu online

-   Giữ đầy đủ tháng hiện tại và ít nhất tháng liền trước.
-   Các tháng cũ hơn có thể archive sang R2 khi cần tiết kiệm dung lượng
    hoặc theo chính sách được cấu hình.
-   Ví dụ tháng 11/2026: giữ chi tiết tháng 11 và tháng 10; tháng 9 trở
    về trước đủ điều kiện xem xét archive.
-   Không tự archive/xóa chỉ vì chuyển tháng; với dữ liệu gia đình nhỏ,
    không cần archive sớm nếu DB còn đủ dung lượng.

### Quy trình archive an toàn

1.  Chọn tháng đủ điều kiện; loại trừ tháng hiện tại và tháng liền
    trước.
2.  Tạo snapshot/phạm vi dữ liệu nhất quán.
3.  Xuất toàn bộ dữ liệu liên quan: giao dịch, tin nhắn gốc cần giữ,
    danh mục/alias, khoản nợ, lịch sử nợ, audit cần thiết.
4.  Tạo archive có schema version, manifest, số dòng từng bảng, tổng
    kiểm tra và SHA-256.
5.  Nén và mã hóa nếu đã thiết kế; khóa mã hóa lưu tách biệt.
6.  Upload lên R2 theo key ổn định, ví dụ `archives/YYYY/MM/...`.
7.  Đọc lại object, xác minh checksum, manifest, số dòng và khả năng
    giải nén/đọc.
8.  Ghi archive index trạng thái đã xác minh.
9.  Chỉ xóa/ẩn dữ liệu chi tiết online sau khi archive xác minh thành
    công **và người dùng đã duyệt chính sách xóa**.
10. Giữ summary/index để truy vấn lịch sử.
11. Nếu bất kỳ bước nào lỗi, dừng; tuyệt đối không xóa nguồn.
12. Ghi audit log.

Upload thành công không đồng nghĩa archive đã xác minh. Nếu lỗi backup,
giữ nguyên dữ liệu nguồn.

### Truy vấn tháng đã archive

-   Tra manifest/index.
-   Tải archive từ R2.
-   Xác minh checksum/schema.
-   Đọc và tính báo cáo; không restore toàn bộ vào primary nếu chỉ cần
    truy vấn.
-   Nếu archive lỗi/không đọc được, báo rõ, không đoán số liệu.

### Backup độc lập

-   R2 archive/backup online.
-   SQLite backup local tại `F:\FamilyFinance\backup\local\`.
-   Backup thủ công trước thao tác lớn.
-   Có restore test định kỳ.
-   Nên có thêm bản mã hóa ngoài máy chính.
-   Không lưu khóa giải mã cạnh file backup.

## 10. Báo cáo

MVP: - Tổng thu, tổng chi, dòng tiền ròng theo ngày/tuần/tháng/khoảng
thời gian. - Chi tiết theo danh mục, thành viên, tài khoản. - So sánh
hai tháng. - Danh sách giao dịch. - Báo cáo khoản vay/trả nợ riêng,
không cộng nhầm vào thu nhập/chi phí.

HTML responsive, có bảng dữ liệu dự phòng nếu chart/JS lỗi, bộ lọc
kỳ/danh mục/thành viên/tài khoản, thời điểm tạo và phạm vi dữ liệu. Hỗ
trợ SQLite và archive được tải về. Không nhúng secrets. Báo cáo thật nằm
ngoài repo, ví dụ `F:\FamilyFinance\reports\YYYY\`.

## 11. Bảo mật

-   Secrets dùng Cloudflare secrets/environment variables hoặc secret
    manager.
-   Không commit `.env`, `appsettings.local.json`, token, connection
    string, R2 key, encryption key.
-   Tài khoản DB/R2 theo nguyên tắc quyền tối thiểu.
-   Tách development/test/production.
-   Dữ liệu test phải là dữ liệu giả.
-   Hạn chế log nội dung tài chính; ưu tiên ID và trạng thái.
-   Không gửi dữ liệu tài chính sang dịch vụ AI bên ngoài nếu chưa được
    người dùng đồng ý rõ ràng; nếu có, giới hạn dữ liệu gửi và mô tả rõ
    luồng.
-   Có quy trình thu hồi/đổi token nếu nghi ngờ lộ.

## 12. Git/GitHub

GitHub chỉ chứa source, migrations, seed giả, template, tests, scripts,
docs và CI.

Không commit DB, WAL/SHM, backup, export thật, báo cáo thật, log nhạy
cảm, token, mật khẩu, connection string hoặc khóa mã hóa.

`.gitignore` tối thiểu:

``` gitignore
.env
.env.*
!.env.example
**/appsettings.local.json
**/secrets/
**/*credential*
*.db
*.db-shm
*.db-wal
*.sqlite
*.sqlite3
/backup/
/data/
/import/
/export/
/reports/
/logs/
*.bak
*.dump
*.sql.gz
*.zip
**/bin/
**/obj/
.vs/
.idea/
```

Trước commit đầu tiên, chạy `git status`, kiểm tra file được track và rà
secrets. Không commit/push nếu chưa được yêu cầu.

## 13. Các phase triển khai

### Phase 0 --- Khảo sát

-   Kiểm tra `F:\FamilyFinance\`, `source\`, repo hiện có, tài liệu và
    file cấu hình.
-   Kiểm tra Windows, .NET SDK, Git, Node.js/npm nếu cần.
-   Không in secrets.
-   Không tạo/xóa/ghi đè dữ liệu. **Đầu ra:**
    `docs/ENVIRONMENT_AUDIT.md`, kế hoạch phase, danh sách thông tin còn
    thiếu.

### Phase 1 --- Khởi tạo solution

-   Tạo solution/project nếu chưa tồn tại: Core, Local, Worker, Tests.
-   Tạo migrations, seeds, templates, scripts, docs.
-   Thiết lập nullable, analyzer, build.
-   Tạo README và `.gitignore`.
-   Xác định Worker TypeScript và phần local/core C#; giải thích ranh
    giới trước khi chốt. **Đầu ra:** solution build được, hướng dẫn
    build, không chứa secrets.

### Phase 2 --- Data model

-   Vẽ ERD.
-   Thiết kế schema PostgreSQL và SQLite.
-   Tạo migrations, indexes, constraints, seed giả.
-   Thiết kế audit, idempotency, tombstone, sync cursor.
-   Test migration/ràng buộc. **Đầu ra:** `docs/DATABASE_DESIGN.md`,
    ERD, migrations, tests.
-   Không chạy migration trên production khi chưa được duyệt.

### Phase 3 --- Core domain/parser

-   Domain model giao dịch, tài khoản, danh mục, khoản nợ.
-   Parser số tiền VND, tiền tố THU/CHI, ngày Việt Nam.
-   Alias resolver.
-   Kết quả phân tích có confidence/reason và trạng thái cần xác nhận.
-   Unit test tiếng Việt có dấu/không dấu. Test tối thiểu:

``` text
thu: lương 20tr
chi: tiền ăn 50k
thu: nợ của a 1tr
chi: nợ của a 1tr
CHI: an uong 120k
thu 1.200.000 tiền thưởng
chi 50 nghìn tiền gửi xe
```

**Đầu ra:** parser, domain, unit tests, `docs/PARSER_RULES.md`. Không
tạo alias chưa duyệt.

### Phase 4 --- PostgreSQL/repository/API

-   Data access layer và kết nối Neon qua secret.
-   Insert/update/cancel giao dịch, audit, idempotency.
-   Query tổng hợp có tham số.
-   Timeout/retry có giới hạn, health endpoint bảo vệ phù hợp.
-   Không log connection string.
-   Integration test trên DB riêng, dữ liệu giả. **Đầu ra:**
    repository/API dev hoạt động và test được.

### Phase 5 --- Telegram bot

-   Webhook HTTPS, secret validation, whitelist user ID.
-   Lưu tin nhắn gốc.
-   Phân tích → ghi hoặc hỏi xác nhận.
-   Xử lý xác nhận/hủy, hết hạn, retry.
-   Phản hồi ngắn sau giao dịch.
-   Test environment trước; không tự bật bot production. **Đầu ra:**
    luồng end-to-end trong test và hướng dẫn cấu hình.

### Phase 6 --- Truy vấn tự nhiên

MVP hỗ trợ các câu rõ ràng: "Tháng này thu bao nhiêu?", "Tháng này chi
bao nhiêu?", "Tháng trước chi tiền ăn bao nhiêu?", "Liệt kê giao dịch từ
ngày... đến ngày...", "So sánh tháng này với tháng trước". - Dùng intent
parser + query builder/SQL tham số hóa. - Không cho AI/người dùng tạo
SQL tự do chạy trực tiếp. - Hỏi lại khi khoảng thời gian/ý nghĩa mơ hồ.
**Đầu ra:** query service và tests.

### Phase 7 --- Local app/SQLite/sync

-   App .NET đọc config, khởi tạo SQLite, migration.
-   Sync Neon → SQLite theo cursor.
-   Upsert, tombstone, batch, retry, dry-run.
-   Lệnh sync thủ công và tùy chọn lịch.
-   Không bật sync hai chiều. **Đầu ra:** local app chạy, DB tại
    `F:\FamilyFinance\data\`, sync lặp không trùng.

### Phase 8 --- Backup/archive R2

-   Backup SQLite an toàn.
-   Export archive theo tháng, manifest, checksum.
-   Nén/mã hóa theo thiết kế được duyệt.
-   Upload, đọc lại, xác minh, restore test.
-   Archive index và dry-run hiển thị tháng dự kiến.
-   Mặc định không xóa dữ liệu production. **Đầu ra:** backup/restore
    test với dữ liệu giả, `docs/BACKUP_AND_ARCHIVE.md`.

### Phase 9 --- HTML reports

-   Template responsive, bảng, biểu đồ, bộ lọc.
-   Đọc SQLite và archive đã tải.
-   Xử lý dữ liệu rỗng, số lớn, archive thiếu.
-   Không nhúng secrets. **Đầu ra:** báo cáo mẫu dữ liệu giả; template
    được commit, báo cáo thật ở ngoài repo.

### Phase 10 --- Kiểm thử/vận hành

-   Unit, integration, end-to-end.
-   Webhook retry/idempotency.
-   Parser mơ hồ/sai định dạng.
-   Sync gián đoạn/chạy lại.
-   Backup/restore và truy vấn archive.
-   Rà secrets/Git.
-   Hướng dẫn cài mới trên máy Windows khác, cập nhật và rollback. **Đầu
    ra:** `docs/OPERATIONS.md`, `docs/RESTORE_GUIDE.md`,
    `docs/NEW_MACHINE_SETUP.md`, báo cáo nghiệm thu.

## 14. Cấu hình mẫu

Tạo file mẫu không chứa secrets, ví dụ:

``` json
{
  "Database": {
    "SqlitePath": "F:\\FamilyFinance\\data\\familyfinance.db"
  },
  "Sync": {
    "BatchSize": 500,
    "Enabled": false
  },
  "Reports": {
    "OutputPath": "F:\\FamilyFinance\\reports"
  },
  "Backup": {
    "LocalPath": "F:\\FamilyFinance\\backup\\local"
  },
  "TimeZone": "Asia/Ho_Chi_Minh"
}
```

Secrets cần người dùng tự cấu hình trong dashboard/secret store: -
Telegram bot token và webhook secret. - Neon connection string. - R2
bucket/access credentials. - Encryption key nếu mã hóa archive.

Không yêu cầu người dùng dán secrets vào GitHub, README, issue hoặc log.

## 15. Tiêu chí nghiệm thu MVP

1.  Hai Telegram user ID hợp lệ có thể gửi tin.
2.  THU/CHI và số tiền parse đúng.
3.  Danh mục độc lập với loại giao dịch.
4.  Tin nhắn mơ hồ được hỏi lại, không tự ghi sai.
5.  Webhook retry không tạo giao dịch trùng.
6.  Truy vấn được tổng thu/chi theo tháng và danh mục.
7.  Local app sync Neon → SQLite an toàn.
8.  Backup local và archive R2 có checksum/restore test.
9.  Có báo cáo HTML.
10. Clone source + cấu hình + khôi phục DB có thể chạy trên máy Windows
    khác.

## 16. Những việc tuyệt đối không tự làm

-   Không tạo GitHub repo.
-   Không mua/nâng cấp dịch vụ.
-   Không xóa dữ liệu online/local.
-   Không bật archive deletion.
-   Không đổi Neon thành D1/Supabase/SQL Server/MongoDB nếu chưa duyệt.
-   Không đổi SQLite thành primary.
-   Không bật ghi hai chiều.
-   Không đổi ý nghĩa THU/CHI.
-   Không gộp vay/trả nợ vào thu/chi thường.
-   Không tạo alias/danh mục chưa được xác nhận.
-   Không gửi báo cáo sau mỗi giao dịch.
-   Không commit dữ liệu thật/secrets.
-   Không deploy production khi chưa được duyệt.

## 17. Quy trình mỗi phiên làm việc

1.  Đọc README và tài liệu liên quan.
2.  Kiểm tra `git status`.
3.  Xác định phase và một mục tiêu cụ thể.
4.  Nêu kế hoạch ngắn.
5.  Thực hiện thay đổi nhỏ.
6.  Chạy build/test/lint phù hợp.
7.  Kiểm tra diff, secrets và file ngoài phạm vi.
8.  Cập nhật docs.
9.  Báo cáo kết quả; không commit/push nếu chưa được yêu cầu.

Mẫu báo cáo:

``` text
PHASE:
MỤC TIÊU:
ĐÃ THỰC HIỆN:
FILE TẠO/SỬA:
LỆNH ĐÃ CHẠY:
KẾT QUẢ BUILD/TEST:
RỦI RO / VẤN ĐỀ:
CẦN NGƯỜI DÙNG XÁC NHẬN:
BƯỚC TIẾP THEO:
```

## 18. Prompt khởi động Agent

Đặt file này tại
`F:\FamilyFinance\source\docs\FAMILYFINANCE_AGENT_RUNBOOK.md`, sau đó
gửi Agent:

> Đọc toàn bộ `docs/FAMILYFINANCE_AGENT_RUNBOOK.md` trước khi thực hiện.
> Bắt đầu **Phase 0 --- Khảo sát môi trường**. Chỉ kiểm tra và lập báo
> cáo; không tạo/xóa/ghi đè dữ liệu, không đăng ký dịch vụ, không triển
> khai production. Kiểm tra cấu trúc `F:\FamilyFinance\`, repository
> hiện có, công cụ đã cài, trạng thái Git và tài liệu hiện hữu. Tạo báo
> cáo khảo sát và đề xuất kế hoạch theo phase, liệt kê thông tin còn
> thiếu. Dừng lại chờ tôi duyệt trước khi sang Phase 1.

**Giới hạn:** Agent chỉ thao tác được trên máy/thư mục mà môi trường
Agent được cấp quyền. Nếu Agent chạy trong cloud/sandbox, cần mở đúng
workspace hoặc cấp quyền truy cập `F:\FamilyFinance\` trước.
