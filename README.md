# Kepper Hub — theo dõi tiến độ dự án theo Master Timeline

Kế hoạch nghiệp vụ: [`docs/PLAN-kepper.md`](docs/PLAN-kepper.md). Đánh giá bảo vệ dữ liệu: [`docs/data-protection-assessment.md`](docs/data-protection-assessment.md).

Kepper Hub được khởi tạo từ WorkHub (repo `tom18072001/ND57`, nhánh `workhub-kanban`). Phần lõi giữ nguyên:
- dự án, Kanban, danh sách, lịch, việc con;
- duyệt nhiều cấp, bình luận @nhắc tên, tệp đính kèm hai chiều;
- thông báo, phân quyền theo bộ phận, nhật ký, sao lưu.

Đã bỏ các nghiệp vụ riêng của NQ57:
- sổ giao việc Trung tâm, Kế hoạch năm (Word);
- giao về phòng, tiếp nhận, uỷ quyền;
- kiến nghị, BGĐ cho ý kiến;
- Lịch công tác, Tổng hợp giao việc, Gửi yêu cầu.

## Tính năng Kepper (GĐ1)

| Nhóm | Nội dung |
|---|---|
| Dự án theo Master Timeline | Kiểu dự án **MTL** có tháng **T0**. Hạng mục theo tháng T, gồm: bước, đầu mối, đường găng ●, mốc ◆, cơ quan / đơn vị ngoài. Mặc định **dùng chung toàn công ty**. Cán bộ các bộ phận có hạng mục tự thành thành viên để cowork |
| Nhập MTL từ Excel | **MTL tổng** và **MTL bộ phận** cùng cấu trúc cột: Bước, Hạng mục công việc, Đầu mối, Bắt đầu (T), Kết thúc (T), Thời lượng, Đường găng, Mốc. MTL bộ phận thêm cột "Thuộc bước". Có xem trước và chọn sheet. Đầu mối được ánh xạ: bộ phận chủ trì / phối hợp, cơ quan ngoài (UBND, Sở…). Nhập lại thì cập nhật theo Bước, **giữ kế hoạch gốc** trừ khi chọn "đặt lại". Tệp chỉ đọc rồi xoá; lưu băm SHA-256 để truy vết |
| Kế hoạch gốc | Là căn cứ tính chậm / trễ và KPI. Chỉ đổi được qua **Điều chỉnh kế hoạch gốc** (người quản lý dự án, bắt buộc lý do, ghi nhật ký) hoặc khi đổi T0 (bắt buộc lý do) |
| Tiến độ | % kế hoạch tuyến tính theo kế hoạch gốc; % thực tế do người chủ trì cập nhật. Hạng mục cha lấy bình quân các việc con (chia đều, xem "Thang tiến độ theo đầu việc"). Cập nhật % thì việc tự chuyển cột: > 0% sang Đang thực hiện; 100% sang Hoàn thành nếu không cần duyệt. Có ô **dự báo hoàn thành** |
| Tình trạng | Chưa đến kỳ · Chậm khởi động · Đúng tiến độ · **Chậm tiến độ** · **Vượt tiến độ** · **Trễ hạn** (số ngày) · Hoàn thành đúng hạn / trễ hạn. Ngưỡng chỉnh theo dự án |
| Cảnh báo tự động | Chạy **07:30 hằng ngày**, có nút chạy ngay. Gồm: sắp bắt đầu, chậm khởi động, sắp đến hạn, chậm / vượt tiến độ, trễ hạn, lâu chưa cập nhật. Gửi người chủ trì, lãnh đạo bộ phận và PMO; hạng mục **đường găng / mốc** bị chậm hoặc trễ thì thêm Ban lãnh đạo. Chống lặp theo chu kỳ. Hiện trong chuông thông báo và Dashboard |
| KPI tiến độ | Bộ phận và người chủ trì: **SPI**, tỷ lệ đúng hạn, số hạng mục chậm / trễ, đường găng trễ. Điểm = 50% SPI + 30% đúng hạn + 20% đường găng không trễ. KPI theo người chỉ Ban lãnh đạo, trưởng bộ phận (bộ phận mình) và PMO xem; mỗi lần xem ghi nhật ký |
| Dashboard | **Tiến độ dự án** (menu; trang chủ là Báo cáo tuần) hiện thẻ từng dự án: T hiện tại, kế hoạch / thực tế, SPI, KPI, chậm, trễ, mốc kế tiếp, cần chú ý, phần của tôi / bộ phận tôi. **Tổng quan dự án** gồm: ô số liệu bấm được, **đường cong S**, cảnh báo gần đây, bảng theo bộ phận, KPI theo người, mốc chính |
| Kế hoạch & Gantt | Bảng MTL kèm Gantt theo tháng T: thanh kế hoạch gốc, % thực tế tô đậm, đường găng viền đỏ, mốc ◆, dự báo trễ, vạch hôm nay. Lọc theo bộ phận, tình trạng, kế hoạch (tổng / bộ phận) |
| Sprint (GĐ2a) | **Sprint = một giai đoạn gồm một nhóm bước MTL tổng**, vd. "Chuyển nhượng DA (B1–9)", "Đề xuất NƠXH → CTĐT (B10–12)". PMO thiết lập ở tab Sprint → **Thiết lập sprint**: mỗi dòng `Tên | các bước | mục tiêu` hoặc `Tên (B1–9)`; chưa thiết lập thì gợi ý theo mốc ◆ đường găng. Việc con của MTL bộ phận thuộc sprint của bước tổng. Tab **Sprint** (trang mở đầu của dự án MTL): lộ trình các sprint trên trục tháng T (tiến độ, kế hoạch hôm nay, mốc, hôm nay), chi tiết sprint chọn — các bước theo thứ tự kèm việc con, cập nhật một chạm, theo ban. **Kế hoạch & Gantt** gom hàng theo sprint (thanh tổng sprint, thu gọn, lọc theo sprint); **Tổng quan** có bảng theo sprint; trang chủ hiện sprint đang làm. Chế độ **Theo tháng**: trong tháng T phải xong gì / đang chạy / chuẩn bị tháng sau |
| Thang tiến độ theo đầu việc (GĐ2a) | Việc cha = bình quân các việc con, **mỗi việc con một phần bằng nhau** (5 việc con → xong 1 việc = 20%); bước tổng, sprint, ban, dự án tính lên theo cây. Cột "Trọng số" trong MTL ghi đè khi cần. Việc lá có **checklist** → % = số mục đã xong / tổng, đủ mục tự Hoàn thành. Người dùng chỉ cần bấm **✓ Xong** từng việc |
| Cập nhật nhanh (GĐ2a) | Trang **Cập nhật nhanh**: việc của tôi (lãnh đạo ban: thêm việc của ban chưa giao người) đang trong kỳ thực hiện (tháng hiện tại hoặc trễ chưa xong) ở mọi dự án, kèm tên sprint; bấm **✓ Xong** hoặc 25 / 50 / 75 / nhập % khi đang làm dở, ghi chú gửi thành bình luận. Có cả trên thẻ của tab Sprint. Nhắc cập nhật **15:00 thứ Năm** (thông báo trong ứng dụng, trước hạn báo cáo tuần) cho việc đã bắt đầu mà ≥ 5 ngày chưa cập nhật |
| MTL bộ phận điền sẵn (GĐ2a) | "Khác → Tải mẫu MTL bộ phận": Excel gồm hạng mục bộ phận đang có + một dòng gợi ý cho mỗi bước MTL tổng bộ phận **chủ trì** chưa chi tiết hoá, danh sách chọn người phụ trách, sheet MTL tổng tham khảo, hướng dẫn. **Lãnh đạo bộ phận** tự tải và tự nhập MTL của bộ phận mình (không đặt lại kế hoạch gốc, không nhập MTL tổng). Chi tiết hoá lần đầu một bước đang làm dở: dòng con nhận % hiện tại của bước đó để tiến độ không tụt. Mỗi lần tải ghi nhật ký `MTL_TEMPLATE_EXPORT` |
| Báo cáo tuần (GĐ2b) | **Trang chủ = "Báo cáo tuần"** theo Quy chế QC-TH-01 / Quy trình QT-TH-01 / Biểu mẫu BM-TH-01: một trang, thanh chọn tuần (thứ Sáu) + hạn nộp, các tab **Nộp báo cáo · Báo muộn / vắng · Tổng hợp · Chấm điểm · Tiến độ dự án**. Báo cáo **tự điền sẵn**: Phần I = hạng mục MTL của bộ phận đến hạn / quá hạn / xong trong tuần + kế hoạch tuần trước + Action Log giao ban ("TGĐ giao"); Phần II = việc MTL chạy nhiều tuần + việc chưa xong tuần trước ("việc sẽ làm tuần tới" lấy mục checklist kế tiếp); Phần III = hạng mục MTL bắt đầu tuần tới. Tình trạng, % tự tính; người lập chỉ sửa chỗ khác thực tế. Chậm / Vướng / Quá hạn bắt buộc nguyên nhân, giải pháp, đề nghị hỗ trợ (máy chủ kiểm tra). Tự lưu nháp; **gửi một lần → % ghi luôn vào MTL** (hạng mục người gửi có quyền sửa, không dùng checklist). Giờ nộp tính lần gửi đầu; muộn có / không báo; 12:00 thứ Bảy |
| Giao ban (GĐ2b) | **Tổng hợp** (TGĐ, thư ký, PMO, trưởng / phó bộ phận): tình trạng nộp theo thứ tự trình bày, KPI, rà Action Log tuần trước, yêu cầu hỗ trợ gom theo nơi nhận, chi tiết từng bộ phận, **Sao chép bản tổng hợp** (nhãn BẢO MẬT, không có họ tên). Thư ký / TGĐ / PMO: điểm danh, đánh dấu báo cáo không đạt, **kết luận của TGĐ** cho từng yêu cầu, **Action Log** → phát hành (thông báo trưởng bộ phận; việc tự vào Phần I báo cáo tuần sau), nhập thay cho bộ phận gửi email (giờ nộp = giờ nhận email), thiết lập bộ phận phải nộp / thứ tự / hạn nộp và ngày họp khi nghỉ lễ. **Chấm điểm tuân thủ tháng** theo Phụ lục 1 (100 điểm, mức trừ đề xuất, ghi đè bằng `AppSetting weekly.config.points`). Nhắc 15:00 ngày hạn nộp cho bộ phận chưa nộp; 07:35 ngày giao ban gửi tóm tắt tổng hợp |
| Phân quyền dữ liệu (GĐ2b) | Vai trò giao ban suy ra từ tài khoản và hai lựa chọn của Ban GĐ (bộ phận thư ký, PMO). Mọi quyền trên báo cáo tuần, tổng hợp, thông báo vắng, giao ban, chấm điểm, % / kế hoạch MTL, KPI cá nhân, AI và gửi ra ngoài nằm ở **một file `lib/policy.js`**, có test từng ô. AI tắt mặc định; khi bật chỉ được dùng bản tổng hợp tóm tắt |
| Viber (đề xuất) | Có sẵn nhưng **mặc định tắt**. Người dùng tự liên kết bằng mã 6 số và phải đồng ý; tin nhắn chỉ có mã hạng mục, loại cảnh báo, liên kết. Chỉ bật (`VIBER_ENABLED=1`, `VIBER_AUTH_TOKEN`, `APP_ORIGIN` công khai HTTPS cho webhook `/api/viber/webhook`) sau khi có hồ sơ đánh giá tác động chuyển DLCN ra nước ngoài |

## Chạy trên máy (Docker)

Yêu cầu: Docker Desktop (Windows / macOS) hoặc Docker Engine + Compose v2.

```bash
cp .env.example .env          # sửa POSTGRES_PASSWORD, JWT_SECRET, ROOT_ADMIN_PASSWORD; dùng thử: SEED_DEMO=true
docker compose up -d --build
```

Mở http://localhost:4100 (cổng mặc định khác WorkHub để chạy song song trên cùng máy; đổi bằng `APP_PORT`). Tên dự án Docker `kepper` — volume, image tách biệt với WorkHub.

Dữ liệu mẫu **giả** (`SEED_DEMO=true`) gồm:
- **Dự án mẫu NƠXH (giả)** — mã `DA`, T0 = 10 tháng trước, đủ các tình trạng, kèm MTL Ban Pháp lý;
- các bộ phận Ban Giám đốc, Pháp lý, Tài chính, Thiết kế, QLXD, Kinh doanh, Đối ngoại – GPMB;
- tài khoản `pmo`, `giamdoc`, `tb.phaply`, `nv.phaply`, `tb.taichinh`, `tb.thietke`, `tb.qlxd`, `nv.qlxd`, `tb.doingoai`, `tp.kinhdoanh`…;
- mật khẩu ban đầu `12345678`, phải đổi khi đăng nhập lần đầu.

**MTL thật của công ty chỉ nhập trên máy chạy** ("Khác → Nhập MTL từ Excel"), không đưa vào git.

Sao lưu tự động hằng ngày vào `./backups` (CSDL + tệp + SHA-256). Bản lỗi bị xoá ngay, bản cũ chỉ dọn khi bản mới đạt. `backups/LAST_OK` ghi lần sao lưu đạt gần nhất. Khôi phục: xem `deploy/restore.sh`.

Lịch nền (nhắc, cảnh báo, dọn dữ liệu) **chạy bù** khi máy bật lại, trong khung giờ còn ý nghĩa. Sổ chạy nằm ở `AppSetting jobs.lastRun`.

Trước khi dùng thật cho nhiều người:
- chạy trên máy chủ / VM luôn bật, không phải PC cá nhân;
- đặt reverse proxy TLS (HTTPS) phía trước cổng 4100;
- chép `./backups` ra ổ khác hoặc nơi lưu trữ có mã hoá;
- thử khôi phục mỗi quý.

## Chạy không cần Docker (phát triển)

```bash
cd app/server && cp .env.example .env && npm install
npx prisma migrate deploy && SEED_DEMO=true npm run seed && npm start   # http://localhost:4000
```

## Kiểm thử

```bash
cd app/server && npm test            # unit test (node:test)
cd app/e2e && npm install && npx playwright install chromium
E2E_DATABASE_URL=postgresql://<user>:<mật khẩu>@127.0.0.1:5432/kepper_e2e npx playwright test
```

## Cấu trúc

```
app/server/   Express 5 + Prisma (PostgreSQL)
  prisma/       schema.prisma + migrations/ (dùng prisma migrate, không db push)
  src/app.js    middleware bảo mật (helmet/CSP, CORS theo APP_ORIGIN, rate limit, trust proxy), lỗi JSON
  src/routes/   auth, admin, projects, items, attachments, approvals, me, dashboard, excel,
                intake, cycles, recurring, views, reports (Word), realtime (SSE)
  src/services/ access (quyền cấp dự án), workitems (tạo việc + chuyển trạng thái dùng chung), approval (duyệt nhiều cấp),
                recurring (lịch lặp), bus (sự kiện thời gian thực), events (audit/activity/thông báo)
  src/lib/      policy (QUY ĐỊNH PHÂN QUYỀN DỮ LIỆU — ma trận + test), auth, permissions, rich-text (sanitize-html),
                files (allowlist + chữ ký tệp), storage, document-preview
  src/services/ weekly (báo cáo tuần, tổng hợp, chấm điểm — hàm thuần), weekly-data (vai trò, truy vấn), jobs (lịch chạy bù),
                mtl-progress (ghi % một đường), retention (dọn dữ liệu quá hạn)
app/web/      Giao diện JavaScript thuần (ES modules, không build): js/main.js + js/views/*
app/e2e/      Playwright
deploy/       backup.sh / restore.sh (dùng bởi service backup)
.github/workflows/ci.yml   unit test, kiểm migration khớp schema, npm audit, e2e
```

Đăng nhập, mật khẩu mặc định và luồng cấp quyền khi tạo tài khoản **giữ nguyên như bản NQ57** theo yêu cầu chủ dự án — xem mục rủi ro trong đánh giá bảo vệ dữ liệu.

## Data Protection Gate (bắt buộc)

Dự án tuân theo "Khung bảo vệ dữ liệu trong Quản trị dữ liệu".
- Trước khi chốt thiết kế, kịch bản hoặc thay đổi lớn về dữ liệu, AI/agent PHẢI chạy đánh giá bảo vệ dữ liệu
  (5 lớp, 25 năng lực GOV/PRE/DET/PRI/RES, pháp lý VN) và đưa khuyến nghị cho chủ dự án.
- Mọi tập dữ liệu mang nhãn nội bộ (Công khai/Nội bộ/Bảo mật/Hạn chế) + phân loại pháp lý; nhiều tiêu chí → mức cao nhất.
- Không dùng dữ liệu thật trên DEV/UAT; PII phải được che/token hóa trước khi vào log, index, môi trường phân tích.
- Nhật ký: xử lý dữ liệu cốt lõi/quan trọng ≥ 6 tháng; nhật ký hệ thống truy xuất ≥ 12 tháng; log làm chứng cứ phải bất biến (WORM, băm, ký số).
- Sự cố DLCN: thông báo ≤ 72 giờ. Chuyển xuyên biên giới / xử lý DLCN: hồ sơ đánh giá tác động.
- Kết quả đánh giá lưu tại: docs/data-protection-assessment.md
