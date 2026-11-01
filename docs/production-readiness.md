# Phản biện: Kepper Hub lên production — 40–50 người, laptop, NAS công ty (23/10/2026)

Phạm vi: bản `kepper/ui-shell` (gồm GĐ2a sprint, GĐ2b báo cáo tuần, GĐ3 Claude, playground CRM / HRM, giao diện mới).
Bối cảnh triển khai: nhân viên dùng laptop trong văn phòng, hệ thống chạy trên NAS công ty, tài liệu để trên NAS và máy cá nhân,
ứng dụng điện thoại để sau. Cách cài trên NAS: `docs/deploy-nas.md`.

## 1. Tóm tắt

**Kết luận: ĐẠT CÓ ĐIỀU KIỆN.** Phần mềm đủ sức cho 40–50 người trên một máy (đo bên dưới); thứ chưa đạt là **chỗ chạy và vận hành**:
hiện chạy trên PC cá nhân, laptop chưa vào được qua HTTPS, sao lưu chưa có bản ngoài máy / mã hoá.

Ba rủi ro lớn nhất:
1. **Máy chạy là PC cá nhân** (Docker Desktop): tắt máy / Windows Update / chưa đăng nhập = cả công ty dừng; laptop trong mạng không vào được (cổng chỉ mở cho chính máy đó). → Chuyển lên NAS — bộ cài đã sẵn.
2. **Mất dữ liệu**: bản sao lưu nằm cùng máy với dữ liệu, chưa mã hoá. NAS hỏng / ransomware là mất cả hai. → Bản thứ hai ngoài NAS + snapshot bất biến + khoá age.
3. **Đăng nhập yếu khi mở cho cả công ty**: mật khẩu tối thiểu 6 ký tự, không giới hạn số lần sai, không MFA. Trong LAN + HTTPS thì chấp nhận được ngắn hạn; cần anh quyết chính sách trước khi có dữ liệu HRM thật.

**Đo tải (K1, đo lại ngày 01/11/2026 trên dữ liệu giả quy mô thật)** — số cũ ở bản trước (dự án mẫu Bình Minh, 11 lời gọi/trang) được thay hết vì không còn đại diện cho quy mô thật.
- Dữ liệu giả (`scripts/perf-data.mjs`): 50 người, 13 dự án MTL ~300 việc/dự án, 3,7k việc, 75k thông báo, 112k nhật ký, 298 báo cáo tuần. Không có số liệu thật.
- Môi trường: máy chủ Node chạy thẳng trên Windows, Postgres 127.0.0.1:5437, `NODE_ENV=production`, `connection_limit=10`. **Không phải Docker/NAS** — số trên NAS sẽ chậm hơn. Một trang chủ = 18 lời gọi song song, 50 luồng `/api/stream` mở suốt, chạy 60 giây mỗi kịch bản.
- TRƯỚC = commit 4902f72 (`docs/perf/before-4902f72.json`); SAU = nhánh `ccoding/t-20261101-160149-489` đã gộp S1–S4 (185 test, 184 pass, 1 skip, 0 fail; trước: 171/171).

*Một người, p50 (5 lần gọi, ms) — giám đốc / tb.qlxd (cán bộ thường):*

| API | TRƯỚC | SAU | Mục tiêu | Đạt |
|---|---|---|---|---|
| `/api/mtl/portfolio` | 290 / 424 | 35 / 29 | ≤ 100 | có |
| `/api/weekly/report` | (pmo) 324 / 323 | (pmo) 24 / 27 | ≤ 100 | có |
| `/api/my/sprint` | 582 / 651 | 20 / 29 | ≤ 100 | có |
| `/api/dashboard` | 229 / 59 | 123 / 42 | ≤ 100 | giám đốc: không |
| `/api/kpi` (giám đốc) | 198 | 148 | ≤ 100 | không |
| `/api/work` | 640 / 283 | 433 / 169 | giám đốc ≤ 250 | không |

Kích thước phản hồi (KB): `/api/work` 993 → 238 (giám đốc); `/api/my/items` 584 → 177 (tb.qlxd); `/api/projects/:id/items` 506 → 238. Còn **`/api/projects/:id/mtl` = 327,5 KB (không đổi, vượt mục tiêu 300 KB)**.
Bộ đệm MTL chỉ hiệu quả khi người dùng dùng chung một khoá phạm vi xem (giám đốc); với cán bộ thường, số trên là khi bộ đệm đã nóng và ≤ 40 người dùng đã nạp (xem tải bên dưới).

*Tải 50 người mở trang chủ (18 lời gọi), SAU so với TRƯỚC:*

| Kịch bản | | Lời gọi/s | p50 | p95 | p99 | Trang chủ p95 | Lỗi | Mục tiêu |
|---|---|---|---|---|---|---|---|---|
| Mỗi 15 giây | TRƯỚC | 48 | 30 ms | 344 ms | 394 ms | 420 ms | 0 | p95 ≤ 150, trang ≤ 300 |
| | SAU | 48 | 332 ms | **1.612 ms** | 2.430 ms | **2.767 ms** | 0 | **không đạt** |
| | (TRƯỚC, đo lại cùng phiên với SAU) | 48 | 32 ms | 347 ms | 663 ms | 1.145 ms | 0 | |
| Mỗi 5 giây | TRƯỚC | 147 | 1.092 ms | 4.529 ms | 6.052 ms | 6.312 ms | 0 | p95 ≤ 500 |
| | SAU | 157 | 1.187 ms | **4.489 ms** | 7.031 ms | **8.084 ms** | 0 | **không đạt** |

**Kết luận đo tải: mục tiêu K1 về tải CHƯA đạt; kịch bản 15 giây còn tệ hơn trước.** Nguyên nhân đã khoanh được (S5 review S1): khoá bộ đệm theo (dự án, phạm vi xem) mà phạm vi của cán bộ thường chứa `user.id`, nên mỗi người một khoá; 50 người × ~13 dự án ≈ 650 mục > giới hạn LRU 600 (`services/mtl-cache.js`) → bộ đệm quay vòng và luôn trượt (đo: 40 người → lần 2 portfolio 22 ms; 50 người → vẫn ~420 ms). Nâng giới hạn lên 5.000 thử trên bản sao tạm chỉ cải thiện p50 (55 ms) chứ không hạ p95 (1,8 s) vì 50 người nạp nguội cùng lúc, mỗi lần tính ~400 ms CPU. Hướng sửa: tính một lần cho cả dự án rồi lọc theo người trong JS (bộ đệm theo dự án, không theo người).

*So JSON hai máy chủ (4902f72 so với nhánh mới, cùng một CSDL, 6 vai trò × 34 đường dẫn = 204 lời gọi, `scripts/perf-compare.mjs`):* `/api/mtl/portfolio`, `/api/my/sprint`, `/api/weekly/report`, `/api/kpi`, chi tiết MTL và mọi API khác giống hệt; `/api/work`, `/api/my/items`, `/api/projects/:id/items` chỉ khác ở các trường S2 đã bỏ (0 khác biệt về giá trị). Duy nhất `/api/dashboard` (4/6 vai trò) khác **thứ tự** các việc cùng hạn trong `overdueItems` (S3 thêm `orderBy id` nên thứ tự nay xác định; hai việc cùng `dueDate` đổi chỗ) — nội dung không đổi.

Bộ nhớ khi chịu tải trước đó: app ~220 MB, Postgres ~130 MB (chưa đo lại với bộ đệm MTL).

**Đã sửa trong vòng này:** biến `APP_BIND`, `PGDATA_PATH`, `UPLOADS_PATH`; `deploy/nas-setup.sh`, `deploy/upgrade.sh` (bản Linux); `docs/deploy-nas.md`;
báo lỗi rõ khi mở sai địa chỉ ("Địa chỉ … chưa được phép — mở Kepper bằng …"); app báo khi thư mục mount không ghi được;
tiện ích Claude tự điền địa chỉ theo `APP_ORIGIN` và kết nối bằng nút "Cho phép" (bỏ bước tạo token tay).
Đã cài thử theo đúng bộ cài NAS trên máy Linux: thư mục dữ liệu đúng chủ / quyền, tải lên ảnh, nhật ký truy cập, sao lưu, thử khôi phục — đạt.

## 2. Bảng phát hiện

| # | Nhóm | Hạng mục | Hiện trạng | Rủi ro | Mức | Đề xuất / trạng thái |
|---|---|---|---|---|---|---|
| 1 | H, B | Máy chạy | PC cá nhân, Docker Desktop, cần người đăng nhập Windows mới chạy | Một điểm hỏng trên luồng chính; tắt máy = dừng toàn công ty | **Chặn** | Chạy trên NAS (`docs/deploy-nas.md`). **Bộ cài sẵn — chờ thông tin NAS** |
| 2 | A, F | Truy cập từ laptop | Cổng chỉ mở 127.0.0.1; mở thẳng `0.0.0.0` thì mật khẩu / phiên đi HTTP trên Wi-Fi | Laptop không vào được, hoặc lộ mật khẩu | **Chặn** | Reverse proxy HTTPS trên NAS + `TRUST_PROXY=1` + `APP_ORIGIN` đúng tên miền. Cần chọn cách cấp chứng chỉ (mục 4 tài liệu NAS) |
| 3 | I | Sao lưu | Hằng ngày, có kiểm tra, có thử khôi phục; **chưa mã hoá, chưa có bản ngoài máy** (trang "Tình trạng vận hành" đang nhắc) | NAS hỏng / ransomware → mất cả dữ liệu lẫn bản sao lưu | **Chặn** | `BACKUP_COPY_PATH` ra USB / NAS khác; snapshot bất biến cho thư mục `backups`; `BACKUP_AGE_RECIPIENT`, khoá bí mật cất ngoài NAS |
| 4 | H | Nhánh mã production | `main` vẫn là GĐ1; bản chạy thật ở `gd2b`, bản thử ở `ui-shell`; 5 nhánh xếp chồng chưa merge | Nâng cấp nhầm nhánh, khó quay lại, khó biết đang chạy bản nào | Cao | Duyệt và merge chuỗi PR #5 → #6 → #8 về `main`, gắn tag (vd. `v1.0.0`); NAS chạy từ tag, `APP_VERSION` = tag |
| 5 | F | Đăng nhập | Tối thiểu 6 ký tự; không giới hạn số lần sai; không MFA; JWT 12 giờ trong localStorage (thu hồi được bằng đổi mật khẩu / khoá tài khoản) | Dò mật khẩu nội bộ; laptop mất còn phiên 12 giờ | Cao | **Anh quyết** (CLAUDE.md không cho tự đổi): khoá tạm 15 phút sau 10 lần sai / tài khoản; tối thiểu 10 ký tự; về lâu dài SSO Entra ID / Google có MFA nếu công ty có |
| 6 | G | Giám sát khi hệ thống chết | Cảnh báo vận hành chỉ hiện **trong** Kepper; Docker tự khởi động lại container | App / NAS chết không ai được báo đến khi người dùng kêu | Cao | Bật thông báo email của NAS khi container dừng / ổ lỗi; hoặc chạy Uptime Kuma trên NAS kiểm `/api/health` mỗi phút |
| 7 | I | Điện | Chưa rõ NAS có UPS | Mất điện đột ngột → Postgres phải phục hồi, có thể hỏng ổ | Cao | UPS + tắt an toàn (NAS hỗ trợ sẵn qua USB) |
| 8 | J | Pháp lý dữ liệu | Hồ sơ chuyển DLCN ra nước ngoài (Claude) **anh đã hoãn**; HRM với dữ liệu thật: cổng CHƯA ĐẠT | Vi phạm khi dữ liệu nhân sự / đối tác thật đi qua Claude | Cao | Giữ `MODULES` trống trên bản thật; lập hồ sơ trước khi nhân viên hỏi Claude về dữ liệu người thật |
| 9 | F | Laptop | Phiên trình duyệt + mã kết nối Claude (tệp trong thư mục người dùng, 30 ngày) nằm trên laptop | Mất laptop → người khác vào Kepper bằng quyền người đó | Trung bình | BitLocker + khoá màn hình bắt buộc; quy trình báo mất máy: quản trị khoá tài khoản (mọi phiên và mã Claude mất hiệu lực ngay) |
| 10 | C | Thông báo | Chỉ trong ứng dụng (chuông + SSE). Viber tắt (chờ hồ sơ pháp lý), chưa có email / Teams | Người không mở Kepper bỏ lỡ hạn nộp báo cáo, cảnh báo chậm tiến độ | Trung bình | Chọn một kênh nội địa: email công ty (SMTP) hoặc Teams webhook — cần anh cho biết công ty dùng gì |
| 11 | H | Chuyển dữ liệu PC → NAS | Chưa làm | Hai nơi cùng được dùng → dữ liệu tách đôi; sai `HR_ENC_KEY` → mất dữ liệu mã hoá | Trung bình | Làm đúng mục 6 tài liệu NAS: sao lưu → dừng PC → khôi phục trên NAS; giữ PC 30 ngày làm đường lui |
| 12 | F | Khoá bí mật | `.env` (JWT, mật khẩu CSDL, `HR_ENC_KEY`) dạng chữ trên máy chạy, quyền 600 | Ai có quyền quản trị NAS đọc được | Trung bình | Chỉ 1–2 tài khoản quản trị NAS, có 2FA; tắt SSH sau khi cài; bản in / két cho `HR_ENC_KEY` và khoá age |
| 13 | J | Tài liệu trên NAS | Liên kết tài liệu trong Kepper chỉ nhận `http(s)://`; đường dẫn `\\NAS\…` không bấm mở được | Người dùng phải tự tìm tệp | Trung bình | Dùng liên kết chia sẻ web của NAS (File Station / Synology Drive, chỉ trong LAN); hoặc dán đường dẫn dạng chữ để sao chép |
| 14 | E | Mở đồng loạt | 50 người mở cùng một giây: p95 1,3 s trong vài giây đầu | Chậm thoáng qua đầu giờ giao ban | Thấp | Chấp nhận; nếu NAS yếu: tăng `connection_limit` CSDL lên 20 |
| 15 | H | Kiểm thử tự động | 168 unit + 19 e2e + MCP chạy tay trước khi đẩy; chưa có CI | Quên chạy → lỗi lên bản thật | Thấp | GitHub Actions chạy `npm test` + e2e cho mỗi PR |
| 16 | G | Nhật ký làm chứng cứ | Nhật ký truy cập 400 ngày; AuditLog + phiên bản báo cáo tuần chặn sửa / xoá bằng trigger; chưa ký số / WORM ngoài máy | Khó chứng minh toàn vẹn khi tranh chấp | Thấp | Đưa thư mục `logs` vào snapshot bất biến của NAS (cùng bước #3) |
| 17 | D | Đồng hồ | Job nhắc nộp báo cáo, sao lưu 02:00 theo giờ VN | NAS lệch giờ → nhắc sai giờ | Thấp | Bật NTP trên NAS |
| 18 | E | Điện thoại | Chưa có ứng dụng; giao diện web dùng được trên trình duyệt điện thoại qua VPN | — | Thấp | Để sau như anh định; khi làm: PWA (cài từ trình duyệt) trước khi tính app riêng |

Nhóm không soi sâu: **K8s / autoscale / sharding / multi-region** (một máy đủ — xem mục 4); **webhook, gRPC** (không dùng); **WAF / DDoS** (không mở ra Internet; truy cập từ xa qua VPN).

## 3. Câu hỏi mở

1. **NAS hãng / model / RAM / phiên bản hệ điều hành?** — quyết định build trên NAS hay trên PC rồi chép image, và NAS có chạy được Container Manager không.
2. **Tên miền công ty và ai quản lý DNS / router?** — quyết định cách cấp chứng chỉ HTTPS (mua / DNS Let's Encrypt / CA nội bộ).
3. **Chấp nhận mất tối đa bao nhiêu dữ liệu (RPO) và dừng bao lâu (RTO)?** — sao lưu 1 lần / ngày = có thể mất tới 1 ngày làm việc; nếu cần ít hơn, thêm lần sao lưu trưa hoặc lưu WAL liên tục.
4. **Công ty dùng email / chat gì (M365, Google, Zalo…)?** — chọn kênh thông báo ngoài ứng dụng và khả năng đăng nhập một lần có MFA.
5. **Đã có VPN cho làm việc ngoài văn phòng chưa?** — nếu chưa, nhân viên chỉ dùng được Kepper khi ở công ty.
6. **Ai vận hành khi anh vắng?** — cần người thứ hai biết khởi động lại, khôi phục, khoá tài khoản khi mất laptop.
7. **NAS có UPS chưa?**

## 4. Over-engineering — những thứ KHÔNG nên thêm ở quy mô này

- Kubernetes, nhiều instance, load balancer, Redis, read replica: một tiến trình Node + một Postgres đã dư 3 lần tải cao điểm.
- MinIO (`STORAGE_DRIVER=minio`) và bộ xem trước Word (`--profile full`, LibreOffice ~1 GB RAM): không cần trên NAS — lưu tệp ra thư mục là đủ.
- Máy chủ dự phòng nóng / cluster Postgres: với 50 người, khôi phục từ bản sao lưu trong vài giờ (đã diễn tập được) rẻ và đơn giản hơn nhiều.
- Viber bot: giữ tắt; nếu cần thông báo ngoài, email nội bộ đơn giản và không vướng chuyển dữ liệu ra nước ngoài.
