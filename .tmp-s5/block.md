**Đo tải (K1, đo lại ngày 01/11/2026 trên dữ liệu giả quy mô thật)** — số cũ ở bản trước (dự án mẫu Bình Minh, 11 lời gọi/trang) đã thay vì không còn đại diện.
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

*So JSON hai máy chủ (4902f72 vvs nhánh mới, cùng một CSDL, 6 vai trò × 34 đường dẫn = 204 lời gọi, `scripts/perf-compare.mjs`):* `/api/mtl/portfolio`, `/api/my/sprint`, `/api/weekly/report`, `/api/kpi`, chi tiết MTL và mọi API khác giống hệt; `/api/work`, `/api/my/items`, `/api/projects/:id/items` chỉ khác ở các trường S2 đã bỏ (0 khác biệt về giá trị). Duy nhất `/api/dashboard` (4/6 vai trò) khác **thứ tự** các việc cùng hạn trong `overdueItems` (S3 thêm `orderBy id` nên thứ tự nay xác định; hai việc cùng `dueDate` đổi chỗ) — nội dung không đổi.

Bộ nhớ khi chịu tải trước đó: app ~220 MB, Postgres ~130 MB (chưa đo lại với bộ đệm MTL).

