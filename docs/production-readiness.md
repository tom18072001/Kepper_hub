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

**Đo tải (K1, đo lại 01/11/2026 trên dữ liệu giả quy mô thật)** — số cũ (dự án mẫu Bình Minh, 11 lời gọi/trang) đã thay hết vì không đại diện cho quy mô thật.
- Dữ liệu giả (`scripts/perf-data.mjs`): 50 người, 13 dự án MTL ~300 việc/dự án, 3,7k việc, 75k thông báo, 112k nhật ký, 298 báo cáo tuần. Không có số liệu thật.
- Kịch bản (`scripts/perf.mjs`): trang chủ = 18 lời gọi song song, 50 luồng `/api/stream` mở suốt, 60 giây mỗi kịch bản. `NODE_ENV=production`, `connection_limit=10`.
- TRƯỚC = 4902f72 (nhánh hợp nhất, chưa tối ưu); SAU = aea4331 (gộp K1: tính MTL theo lô + bộ đệm vô hiệu khi ghi, thu gọn `/api/work` · `/api/my/items` · việc dự án, dashboard/kpi truy vấn phẳng). 189 test (188 pass, 1 skip, 0 lỗi; trước 171).
- Nghẽn trước K1 là CPU Node, không phải SQL: mỗi lời gọi portfolio / my-sprint / báo cáo tuần tính lại toàn bộ MTL của từng dự án (Prisma nạp quan hệ lồng nhau). Sau K1: một truy vấn phẳng cho mọi dự án, kết quả dùng chung cho mọi người với dự án không phải "giao riêng" (`visibility !== 'ASSIGNED'` — tương đương chính xác `itemVisibleWhere`), single-flight, xoá ngay khi có ghi (Prisma `$extends`, kể cả SQL thô và sau `$transaction`).

*Bản thử Docker (giống NAS) — tải 50 người, TRƯỚC → SAU:*

| Kịch bản | p50 | p95 | p99 | Trang chủ p95 | Lỗi | Mục tiêu | Đạt |
|---|---|---|---|---|---|---|---|
| Mỗi 15 giây (cao điểm thực tế) | 57 → 49 ms | **554 → 106 ms** | 977 → 149 ms | **1.143 → 164 ms** | 0 | p95 ≤ 150, trang ≤ 300 | có |
| Mỗi 5 giây (gấp 3 cao điểm) | 694 → 78 ms | **12.498 → 197 ms** | 18.290 → 265 ms | **17.967 → 285 ms** | 0 | p95 ≤ 500 | có |

*Máy chủ chạy thẳng trên Windows, đo TRƯỚC và SAU cùng phiên (`docs/perf/k1-ab-host.json`):* mỗi 15 giây p95 332 → 73 ms, trang chủ p95 425 → 128 ms; mỗi 5 giây p95 4.828 → 117 ms, trang chủ p95 6.674 → 163 ms; 0 lỗi.

*Một người, p50 (ms, Docker) — giám đốc / pmo / tb.qlxd (lãnh đạo bộ phận) / nv.qlxd:*

| API | TRƯỚC | SAU | Mục tiêu | Đạt |
|---|---|---|---|---|
| `/api/my/sprint` | 528 / 563 / 548 / 549 | 16 / 8 / 33 / 26 | ≤ 100 | có |
| `/api/mtl/portfolio` | 330 / 403 / 403 / 395 | 22 / 20 / 25 / 21 | ≤ 100 | có |
| `/api/weekly/report` | — / 383 / 392 / 379 | — / 18 / 20 / 18 | ≤ 100 | có |
| `/api/dashboard` | 228 / 14 / 67 / 64 | 87 / 15 / 35 / 30 | ≤ 100 | có |
| `/api/kpi` (giám đốc) | 217 | 130 | ≤ 100 | xem K1-b bên dưới |
| `/api/work` | 707 / 250 / 282 / 69 | 320 / 126 / 137 / 30 | giám đốc ≤ 250 | xem K1-b bên dưới |

Kích thước phản hồi: `/api/work` giám đốc 993 → 238 KB; `/api/my/items` lãnh đạo bộ phận 584 → 177 KB; `/api/projects/:id/items` 506 → 238 KB. `/api/projects/:id/mtl` 327,5 KB trước K1-b (xem K1-b bên dưới).

*So JSON hai máy chủ (`scripts/perf-compare.mjs`, 6 vai trò × 34 đường dẫn = 204 lời gọi, chạy lại trên aea4331):* mọi API giống hệt, trừ `/api/work`, `/api/my/items`, `/api/projects/:id/items` chỉ khác ở các trường đã bỏ có lý do (`docs/perf/allow-s2.txt`) và `/api/dashboard` đổi **thứ tự** các việc quá hạn cùng hạn (`orderBy id` làm thứ tự xác định; đã kiểm các cặp đổi chỗ có `dueDate` bằng nhau). `/api/work` đổi hợp đồng (thêm `projects`/`states`/`deptNames` ở cấp trên, client ghép lại) — chỉ `views/work.js` đọc; MCP và xuất Excel không đổi.

Bộ nhớ sau khi chịu tải (Docker): app ~396 MB (trước ~220 MB ở dữ liệu nhỏ — nay có bộ đệm MTL và dữ liệu lớn hơn), Postgres ~327 MB. NAS cần ≥ 2 GB RAM trống cho Kepper.

**K1-b (01/11/2026, máy chủ chạy thẳng trên Windows, cùng phiên, CSDL giả `kepper_perf`; QA đo)** — TRƯỚC = bản xuất phát 3d7a687 (cổng 4390), SAU = nhánh nhiệm vụ gộp S1–S3. Một người, p50 (ms) của 3 lượt xen kẽ TRƯỚC/SAU (mỗi lượt 5 lần gọi), số liệu thô `docs/perf/k1b-single-{A,B}-r{1,2,3}.json`:

| API | giám đốc TRƯỚC → SAU (3 lượt) | pmo | tb.qlxd | nv.qlxd | Mục tiêu | Đạt |
|---|---|---|---|---|---|---|
| `/api/work` | 384 / 570 / 317 → **128 / 135 / 135** | 121 → 77 | 136 → 76 | 44 → 31 | giám đốc ≤ 250 | có |
| `/api/kpi` | 128 / 86 / 83 → **33 / 35 / 38** | 3 → 3 | 3 → 3 | 3 → 3 | ≤ 100 | có |
| `/api/dashboard` | 101 / 75 / 63 → **22 / 26 / 28** | 14 → 17 | 31 → 36 | 34 → 29 | ≤ 100 | có |
| `/api/projects/:id/mtl` (dự án lớn nhất) | 34–43 → 41 ms; **327,5 → 230,2 KB** | 327,5 → 230,2 KB | 327,5 → 230,2 KB | 327,5 → 230,2 KB | ≤ 300 KB | có |

Ghi chú: pmo / tb.qlxd / nv.qlxd ở `/api/kpi`, `/api/dashboard` không đổi trong sai số đo (đường truy vấn riêng, không đổi). Kích thước `/api/work`, `/api/kpi`, `/api/dashboard` không đổi (JSON giống hệt).

So JSON (`docs/perf/compare-k1b.txt`): 204 lời gọi, 0 khác biệt ngoài danh sách cho phép ở mọi API trừ `/api/projects/:id/mtl-kpi` (42 dòng, giám đốc / pmo / tb.qlxd): cùng tập dòng và cùng điểm, chỉ khác thứ tự các dòng bằng điểm — route này không đổi trong K1-b, `users.findMany` không có `orderBy` nên thứ tự hoà phụ thuộc CSDL (lỗi có sẵn).

Tải 50 người, 60 giây mỗi kịch bản, TRƯỚC → SAU (`docs/perf/k1b-load-*.json`):

| Kịch bản | p50 | p95 | p99 | Trang chủ p95 | Lỗi |
|---|---|---|---|---|---|
| Mỗi 5 giây | 55 → 62 ms | **916 → 173 ms** | 1.752 → 305 ms | 1.794 → 313 ms | 0 → 0 |
| Mỗi 15 giây — lượt 1 | 34 → 59 ms | 76 → **316 ms** | 171 → 1.691 ms | 234 → 571 ms | 0 → 0 |
| Mỗi 15 giây — lượt 2 (SAU chạy trước) | 33 → 36 ms | 71 → 153 ms | 153 → 267 ms | 165 → 287 ms | 0 → 0 |
| Mỗi 15 giây — lượt 3 (SAU chạy trước) | 30 → 35 ms | 87 → 119 ms | 357 → 264 ms | 249 → 291 ms | 630 (kết nối bị ngắt) → 0 |

**Chưa đạt "tải 15 giây không xấu hơn bản xuất phát":** cả 3 lượt cho p95 SAU > TRƯỚC (316 / 153 / 119 so với 76 / 71 / 87 ms) và lượt 1 vượt mục tiêu p95 ≤ 150. Mức chậm giảm dần theo lượt và có mặt ở mọi API (kể cả `/api/brand`), gợi ý tiến trình / CSDL mới khởi động còn lạnh, nhưng chưa được kiểm chứng. Máy chủ TRƯỚC (4390) và cả máy chủ SAU (4341) bị tắt sau lượt 3 (không rõ nguyên nhân, không phải do lệnh của QA) nên không đo thêm được; cần đo lại cả hai ở trạng thái nguội/ấm có kiểm soát và trên Docker. Ở kịch bản 5 giây bản SAU tốt hơn rõ rệt.

e2e (Playwright) màn "Tổng thể công việc": **chưa chạy** (`app/e2e` chưa cài `node_modules` / trình duyệt; không tự tải). `npm test`: 203 test (202 pass, 1 skip, 0 lỗi; trước K1-b 189).

Còn mở: đo lại tải 15 giây (xem trên); e2e màn "Tổng thể công việc". Giới hạn bộ đệm: script ghi thẳng CSDL bằng PrismaClient riêng (`seed*.js`, `tidy-demo.js`, `perf-data.mjs`) khi máy chủ đang chạy có thể làm số cũ tối đa 20 giây.

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
