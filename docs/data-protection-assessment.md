# Đánh giá bảo vệ dữ liệu — WorkHub (quản lý công việc Kanban cho công ty/phòng ban)

Giai đoạn: lập kế hoạch (branch `workhub-kanban`), **cập nhật sau khi triển khai GĐ0–GĐ1 ngày 16/10/2026 — xem mục 7**. Căn cứ pháp lý cập nhật đến 28/9/2026; soát lại với Công báo trước khi trích dẫn trong hồ sơ chính thức.

**Giả định** (chủ dự án đã chốt: một tổ chức nhiều phòng ban, mỗi tổ chức một hệ thống, chạy trên máy của mình; phần còn lại áp mức nhạy cảm cao hơn):
- Một công ty, dưới 10.000 người dùng; dữ liệu cá nhân của nhân viên ở mức **cơ bản** (họ tên, tài khoản, điện thoại, phòng ban, chức danh).
- Mô tả việc, bình luận và tệp đính kèm **có thể** chứa thông tin mật của công ty và dữ liệu cá nhân của khách hàng/đối tác → xếp **Bảo mật**.
- Triển khai tự host (Docker trên máy của chủ dự án / máy chủ nội bộ), không chia sẻ dữ liệu ra ngoài tổ chức.
- Tính năng AI (GĐ3) gọi API bên ngoài → có thể là chuyển dữ liệu xuyên biên giới; **tắt mặc định**.
- Không xử lý dữ liệu bí mật nhà nước. Nhật ký có thể cần làm căn cứ khi có tranh chấp/sự cố.

**Kết luận cổng: ĐẠT CÓ ĐIỀU KIỆN** — được triển khai GĐ0–GĐ1 nếu các mục **[Bắt buộc]** ở phần 5 nằm trong phạm vi GĐ0–GĐ1; chưa bật AI/xuất dữ liệu ra ngoài cho tới khi có hồ sơ đánh giá tác động.

## 1. Phân loại

| Tập dữ liệu | Nhãn nội bộ | Phân loại pháp lý | Số chủ thể | Cấp độ HTTT |
|---|---|---|---|---|
| Tài khoản, hồ sơ nhân viên | Bảo mật | DLCN cơ bản | < 10.000 (giả định) | Dưới ngưỡng cấp độ 3 theo số chủ thể; xác định cấp độ cụ thể khi lập hồ sơ |
| Dự án, công việc, bình luận | Bảo mật | Dữ liệu dùng riêng ("dữ liệu khác"); có thể lẫn DLCN | — | như trên |
| Tệp đính kèm / minh chứng | Bảo mật | Như trên, rủi ro cao nhất vì nội dung không kiểm soát | — | như trên |
| Audit log, lịch sử thay đổi | Bảo mật | Nhật ký hệ thống / nhật ký xử lý | — | như trên |
| Danh mục (phòng ban, nhãn, trạng thái) | Nội bộ | Dữ liệu khác | — | — |
| Dữ liệu gửi sang AI (GĐ3) | Hạn chế | Chuyển DLCN có thể xuyên biên giới | — | — |

## 2. Dòng dữ liệu

Người dùng (trình duyệt/PWA) → nginx (TLS) → API Express → PostgreSQL (công việc, tài khoản, log) + MinIO (tệp) → LibreOffice worker (xem trước, mạng nội bộ) → Xuất Excel/Word cho người dùng.
Chặng có dữ liệu nhạy cảm: **tệp đính kèm** (MinIO, worker), **xuất file** (dữ liệu rời hệ thống), **email thông báo** (GĐ3), **AI API bên ngoài** (GĐ3, xuyên biên giới).

## 3. Rà năng lực

| Mã | Trạng thái | Khuyến nghị cụ thể | Ưu tiên |
|---|---|---|---|
| GOV-01 | Chưa có | Quy chế sử dụng hệ thống: loại dữ liệu được/không được nhập, thời hạn lưu, phê duyệt ngoại lệ | Nên có |
| GOV-02 | Chưa có | Chỉ định chủ sở hữu hệ thống, người phụ trách bảo vệ dữ liệu; mỗi dự án có `leadId` làm data steward | Bắt buộc |
| GOV-03 | Một phần | `registry.js` đã là danh mục thực thể; bổ sung mô tả trường + nhãn nhạy cảm trong registry | Nên có |
| GOV-04 | Chưa có | Gắn nhãn nhạy cảm ở cấp dự án/việc ("Bảo mật"/"Hạn chế"); quét PII cơ bản trong tệp ở GĐ3 (Presidio) | Nên có |
| GOV-05 | Chưa có | Sơ đồ luồng dữ liệu ở mục 2 lưu trong repo, cập nhật khi thêm tích hợp | Nên có |
| GOV-06 | N/A ở GĐ0–2 | Không chia sẻ ra ngoài; khi bật AI/tích hợp ngoài phải có thỏa thuận xử lý dữ liệu | Bắt buộc khi bật AI |
| PRE-01 | Một phần | Đã có RBAC + phạm vi + thu hồi phiên; thêm quyền theo dự án (`ProjectMember`), rà soát quyền định kỳ từ màn quản trị; SSO/MFA để GĐ3. Không đổi tiêu chí đăng nhập theo yêu cầu chủ dự án → ghi là rủi ro chấp nhận | Bắt buộc (phần quyền dự án) |
| PRE-02 | Chưa có | Tách tài khoản quản trị máy chủ/DB khỏi tài khoản ứng dụng; truy cập DB qua bastion | Nên có |
| PRE-03 | Một phần | TLS ở nginx; bật mã hóa đĩa máy chủ, SSE trên MinIO; khóa/secret trong file `.env` quyền 600, luân chuyển `JWT_SECRET` | Bắt buộc (TLS, secret) |
| PRE-04 | Chưa có | Seed chỉ dùng dữ liệu giả; không chép DB thật về DEV | Bắt buộc |
| PRE-05 | Chưa có | Allowlist loại tệp, giới hạn dung lượng; ghi log mọi lượt tải xuống/xuất file | Nên có |
| PRE-06 | Chưa có | Quyền xuất Excel/Word tách riêng (`reports.export`); watermark người xuất + thời gian trên file Word/PDF | Nên có |
| PRE-07 | Một phần | Thêm rate limit chung cho API, CORS theo `APP_ORIGIN`, helmet/CSP; API chỉ trả trường cần thiết (đã có `publicUser`) | Bắt buộc (CORS, CSP) |
| DET-01 | Một phần | Audit log ứng dụng đã có; bật pgAudit cho thao tác quản trị DB | Nên có |
| DET-02 | N/A | Quy mô nhỏ, một máy chủ; xem lại khi lên cloud | — |
| DET-03 | Chưa có | Cảnh báo tải xuống hàng loạt / xuất dữ liệu ngoài giờ từ audit log (GĐ3) | Nâng cao |
| DET-04 | Một phần | Gom log app + nginx về Elastic/OpenSearch; giữ ≥ 12 tháng; ghi đúng IP thật (`trust proxy`) | Bắt buộc |
| DET-05 | Chưa có | Băm chuỗi audit log (mỗi bản ghi chứa hash bản trước), sao lưu log sang MinIO Object Lock | Nên có |
| PRI-01 | N/A | Dữ liệu nhân viên xử lý trên cơ sở hợp đồng lao động; nếu thu thập thêm ngoài mục đích công việc thì cần đồng ý | — |
| PRI-02 | Một phần | Phạm vi UNIT/SYSTEM + quyền dự án PRIVATE; chỉ thu trường hồ sơ cần thiết | Bắt buộc |
| PRI-03 | Chưa có | Chức năng xuất/sửa hồ sơ cá nhân; quy trình xử lý yêu cầu xóa khi nghỉ việc (ẩn danh hóa tên trong lịch sử) | Nên có |
| PRI-04 | Chưa có | Lập hồ sơ đánh giá tác động xử lý DLCN của nhân viên; thêm hồ sơ chuyển xuyên biên giới nếu bật AI | Bắt buộc |
| RES-01 | Một phần | Có hướng dẫn backup trong DEPLOY; bổ sung backup tự động PostgreSQL + MinIO theo 3-2-1-1-0, diễn tập khôi phục | Bắt buộc |
| RES-02 | Chưa có | Thời hạn lưu theo loại (việc đã lưu trữ, tệp, log); xóa tệp trong MinIO khi xóa việc | Nên có |
| RES-03 | Chưa có | Kịch bản sự cố + quy trình thông báo vi phạm DLCN ≤ 72 giờ | Bắt buộc |

## 4. Nghĩa vụ pháp lý phát sinh

| Nghĩa vụ | Căn cứ | Hạn/ngưỡng | Người phụ trách |
|---|---|---|---|
| Hồ sơ đánh giá tác động xử lý DLCN | Luật BVDLCN Đ21 | ≤ 60 ngày từ khi bắt đầu xử lý | Công ty sử dụng hệ thống (bên kiểm soát dữ liệu) |
| Hồ sơ chuyển DLCN xuyên biên giới (nếu bật AI API nước ngoài) | Luật BVDLCN Đ20; Luật Dữ liệu Đ23; NĐ 165/2025 Đ12 | Trước khi chuyển | Công ty sử dụng |
| Kiểm soát dữ liệu dùng cho AI | Luật Trí tuệ nhân tạo 134/2025 Đ7 | Khi bật AI | Chủ dự án |
| Thông báo vi phạm DLCN | Luật BVDLCN Đ23 | ≤ 72 giờ | Người phụ trách bảo vệ dữ liệu |
| Nhật ký hệ thống truy xuất được | NĐ 333/2026 | ≥ 12 tháng | Vận hành |
| Cấm mua bán DLCN | Luật BVDLCN Đ7 k6 | Luôn áp dụng | Toàn bộ |

## 5. Khuyến nghị ưu tiên

1. **[Bắt buộc]** Quyền theo dự án + phạm vi phòng ban cho mọi API công việc, tệp, xuất file; có integration test chứng minh (GĐ0–1).
2. **[Bắt buộc]** CORS theo `APP_ORIGIN`, helmet/CSP, rate limit API chung, `trust proxy` (GĐ0).
3. **[Bắt buộc]** Log tập trung ≥ 12 tháng, ghi đúng IP, ghi mọi lượt tải xuống/xuất file (GĐ0–1).
4. **[Bắt buộc]** Backup tự động PostgreSQL + MinIO, diễn tập khôi phục (trước khi dùng thật).
5. **[Bắt buộc]** Chỉ dùng dữ liệu giả cho seed/DEV; xóa tài khoản seed tên thật của NQ57 (GĐ0).
6. **[Bắt buộc]** Hồ sơ đánh giá tác động DLCN + kịch bản sự cố 72 giờ (trước khi dùng thật).
7. **[Nên có]** Băm chuỗi audit log, watermark file xuất, allowlist tệp đính kèm.
8. **[Nên có]** Xóa tệp MinIO khi xóa việc; thời hạn lưu trữ theo loại dữ liệu.
9. **[Nâng cao]** Cảnh báo tải xuống bất thường; quét PII trong tệp; SSO/MFA.

## 6. Rủi ro còn lại và câu hỏi mở

- **Rủi ro chấp nhận theo quyết định chủ dự án:** không giới hạn thử đăng nhập, mật khẩu mặc định cố định, luồng tạo user có thể cấp vai trò admin (xem review commit 17eaea0). Khuyến nghị xử lý trước khi mở Internet.
- Chưa rõ số người dùng và có lưu dữ liệu khách hàng hay không → ảnh hưởng phân loại và cấp độ HTTT. (Đã chốt: một tổ chức/hệ thống, không multi-tenant.)
- AI (GĐ3) chưa chốt nhà cung cấp/vị trí xử lý dữ liệu.

## 7. Cập nhật sau triển khai GĐ0–GĐ1 (16/10/2026, branch `workhub/gd0-gd1`)

**Kết luận cổng: vẫn ĐẠT CÓ ĐIỀU KIỆN** — đủ để chạy thử trên máy với dữ liệu giả; trước khi dùng dữ liệu thật cần xong 4 mục Bắt buộc còn mở bên dưới.

| Mã | Trạng thái mới | Đã làm (có kiểm thử) |
|---|---|---|
| PRE-01 | Một phần → **Một phần (tốt hơn)** | Quyền cấp dự án (Chủ/Thành viên/Người xem) giao với phạm vi phòng ban; dự án không được xem trả 404 (không lộ sự tồn tại); E2E #8 + unit test `access.test.js` |
| PRE-04 | Chưa có → **Đầy đủ (DEV)** | Seed chỉ dữ liệu giả; bỏ tài khoản seed tên thật của NQ57; E2E bắt buộc CSDL tên `_e2e`/`_test` |
| PRE-05 | Chưa có → **Một phần** | Allowlist đuôi tệp + kiểm tra chữ ký tệp + MIME do server quyết định; tải xuống/xem trước đều ghi audit; E2E #5 |
| PRE-06 | Chưa có → **Một phần** | Xuất Excel tách quyền `reports.export` theo phạm vi; file xuất có dòng "Xuất bởi … lúc …"; E2E #9 |
| PRE-07 | Một phần → **Một phần (tốt hơn)** | CORS chỉ `APP_ORIGIN`, helmet + CSP (`script-src 'self'`, `frame-ancestors 'none'`), rate limit 600 yêu cầu/phút/IP cho API (trừ đăng nhập theo quyết định chủ dự án), danh bạ người dùng chỉ trả trường tối thiểu; E2E #11 |
| DET-04 | Một phần → **Một phần** | `trust proxy` để audit ghi đúng IP; log lỗi dạng JSON ra stdout sẵn sàng gom bằng Elastic Agent/Filebeat. **Chưa** có gom tập trung ≥ 12 tháng |
| PRI-02 | Một phần → **Đầy đủ** | Lọc dự án/việc theo phạm vi ở mọi API danh sách, dashboard theo phạm vi quyền |
| RES-02 | Chưa có → **Một phần** | Xoá tệp vật lý khi xoá đính kèm (lỗi kho lưu trữ ghi audit để dọn) |

**Bắt buộc còn mở trước khi dùng dữ liệu thật:**
1. Gom log app + audit về Elastic/OpenSearch, giữ ≥ 12 tháng (DET-04).
2. Backup tự động `pg_dump` + volume tệp theo 3-2-1, diễn tập khôi phục (RES-01) — README có lệnh sao lưu thủ công.
3. Hồ sơ đánh giá tác động xử lý DLCN nhân viên + kịch bản sự cố 72 giờ (PRI-04, RES-03).
4. Chỉ định chủ sở hữu hệ thống và người phụ trách bảo vệ dữ liệu (GOV-02).

**Rủi ro chấp nhận (giữ nguyên theo yêu cầu chủ dự án):** không giới hạn số lần đăng nhập sai, mật khẩu mặc định/reset cố định `12345678`, người có quyền quản lý tài khoản tạo được tài khoản vai trò admin. Khuyến nghị xử lý trước khi mở ra Internet.

**Phụ thuộc còn cảnh báo:** 4 lỗi mức moderate trong thư viện con của client MinIO (`query-string`, `stream-json`), chỉ khai thác được qua phản hồi từ máy chủ MinIO — mặc định không dùng MinIO (lưu tệp trên volume). Không còn lỗi high/critical.

## 8. Cập nhật GĐ2 (16/10/2026, branch `workhub/gd2`)

**Kết luận cổng: vẫn ĐẠT CÓ ĐIỀU KIỆN.** GĐ2 thêm 4 luồng dữ liệu; không thêm loại dữ liệu cá nhân mới.

| Luồng mới | Rủi ro | Biện pháp đã làm | Còn lại |
|---|---|---|---|
| Yêu cầu liên phòng ban (Intake) | Người phòng khác thấy nội dung dự án; người gửi đưa dữ liệu nhạy cảm vào yêu cầu | Người gửi chỉ thấy trạng thái + mã việc + ghi chú xử lý, không xem được dự án (E2E #13 kiểm 404); danh sách dự án nhận yêu cầu chỉ trả trường tối thiểu; form nhắc không nhập mật khẩu/số tài khoản/giấy tờ; mọi tiếp nhận/từ chối ghi audit | Quy chế nội bộ về loại thông tin được gửi qua yêu cầu (GOV-01) |
| Bản sao lưu (`./backups`) | Chứa toàn bộ dữ liệu thật, nằm ngoài kiểm soát của ứng dụng | Sao lưu hằng ngày CSDL + tệp, tổng kiểm SHA-256, tự kiểm `pg_restore --list`, giữ N ngày, `restore.sh` kiểm tổng trước khi khôi phục — đã diễn tập sao lưu → khôi phục khớp dữ liệu; `backups/` trong `.gitignore` | **[Bắt buộc]** mã hoá thư mục sao lưu hoặc ổ chứa (BitLocker/LUKS) và giữ một bản ngoài máy (3-2-1); phân quyền thư mục chỉ quản trị viên. RES-01: Một phần → **Một phần (tốt hơn)** |
| Báo cáo tuần Word | Dữ liệu rời hệ thống | Quyền `reports.export` theo phạm vi (nhân viên bị chặn — E2E #18); phạm vi phòng ban không lẫn dữ liệu phòng khác; dòng "Xuất bởi … lúc …" trong tệp; audit `EXPORT_WORD` (PRE-06) | — |
| Kênh thời gian thực (SSE) | Lộ nội dung qua luồng sự kiện; token lộ trên URL/log | Sự kiện chỉ mang ID (dự án, việc), client tự tải lại qua API có kiểm quyền; chỉ gửi cho người được xem dự án (kiểm quyền mỗi 60 giây); token gửi qua header, không qua URL; luồng tự đóng sau 30 phút để xác thực lại | — |

Ngoài ra: giới hạn tần suất API chuyển sang tính **theo tài khoản** (chưa đăng nhập thì theo IP) để không chặn nhầm cả văn phòng dùng chung một IP; đăng nhập vẫn không áp giới hạn theo yêu cầu chủ dự án.

**Bắt buộc còn mở trước khi dùng dữ liệu thật:** (1) gom log ≥ 12 tháng (DET-04); (2) mã hoá + bản sao ngoài máy cho thư mục sao lưu (RES-01); (3) hồ sơ đánh giá tác động DLCN + kịch bản sự cố 72 giờ (PRI-04, RES-03); (4) chỉ định người phụ trách bảo vệ dữ liệu (GOV-02).

## 9. Cập nhật GĐ2b (16/10/2026, branch `workhub/gd2-ui`): phản hồi của chủ dự án và phản biện nghiệp vụ

**Kết luận cổng: vẫn ĐẠT CÓ ĐIỀU KIỆN.** Lần này có **thêm dữ liệu cá nhân mới**: ghi chú cá nhân và số liệu KPI theo từng người. Cả hai đã có biện pháp riêng. Ba điểm sau thu hẹp quyền và **làm giảm** rủi ro: tách admin IT khỏi dữ liệu nghiệp vụ, chặn tự duyệt, có thời hạn lưu.

| Thay đổi | Phân loại | Rủi ro | Biện pháp đã làm (có kiểm thử) | Còn lại |
|---|---|---|---|---|
| **Ghi chú cá nhân** ("Việc của tôi") | Bảo mật · DLCN cơ bản (có thể chứa thông tin đời tư do người dùng tự ghi) | Cấp trên, admin hoặc người khác đọc được; ghi chú bị lộ qua log, audit, báo cáo; giữ ghi chú quá lâu sau khi người dùng nghỉ việc | Bảng riêng, API chỉ trả ghi chú của chính chủ (của người khác trả 404, kể cả quản trị gốc; E2E #13). **Không** ghi nội dung vào audit, không vào dashboard, file xuất hay tìm kiếm chung. Lưu dạng văn bản thuần (không HTML). **Thời hạn lưu theo quyết định của chủ dự án: xoá 30 ngày sau khi tài khoản bị khoá** (`deactivatedAt`, job 02:30 hằng ngày, chỉ ghi số lượng; có unit test). Tối đa 500 ghi chú/người | Thông báo cho nhân viên biết thời hạn lưu (PRI-03) |
| **KPI theo phòng ban / cá nhân** | Bảo mật · DLCN (đánh giá hiệu suất của người lao động) | Lộ số liệu cá nhân cho người không có thẩm quyền; dùng số liệu để tính lương thưởng khi chưa thông báo cho nhân viên | Quyền mới `reports.kpi`, chỉ cấp cho Ban giám đốc (migration bổ sung quyền cho giám đốc hiện có). Mỗi lần xem đều ghi audit `VIEW_KPI` (chỉ ghi kỳ và số người, không ghi số liệu). Trang ghi rõ "chỉ tham khảo, chưa áp dụng tính lương thưởng". Dashboard **bỏ khối lượng việc theo tên người** với tài khoản không có quyền duyệt (E2E #14) | **[Bắt buộc trước khi dùng KPI để tính lương thưởng]** thông báo mục đích xử lý cho người lao động và cho phép họ phản hồi số liệu (Luật BVDLCN, NĐ 13/2023) |
| **Admin IT không xem nội dung công việc** (quyết định của chủ dự án) | — | Trước đây quản trị gốc xem và duyệt được mọi việc | `permissionScope` luôn trả rỗng cho quyền `work.*`, `projects.*`, `reports.*` của tài khoản vai trò admin và quản trị gốc. Không cấp được quyền nghiệp vụ cho tài khoản admin. Admin không được giao việc. Luồng cấp quyền khi tạo tài khoản giữ nguyên. Kiểm thử: unit test + E2E #14 (API trả 404/403, giao diện chỉ còn phần quản trị). PRE-01 → **Đầy đủ** về tách nhiệm vụ | Nhật ký hệ thống (admin xem được) vẫn có tiêu đề việc trong trường `newValue` của một số hành động, nhưng trang Nhật ký không hiển thị trường này. Khuyến nghị che `newValue` của nhóm WorkItem khi đưa log sang Elastic |
| **Duyệt linh hoạt** (chọn tay + quy tắc tự động) | Nội bộ | Nhân viên tự hạ mức duyệt; người gửi tự duyệt việc của mình | Chỉ người quản lý dự án đổi được mức duyệt. Mức duyệt bị khoá khi đang chờ duyệt (409). Người gửi không tự duyệt được (403 `SELF_APPROVAL`). Hiện tên người duyệt thực tế ở từng cấp. Mọi thay đổi quy trình, quy tắc và mức duyệt đều ghi audit hoặc lịch sử (E2E #11, #12) | Uỷ quyền duyệt khi người duyệt vắng mặt (P0 theo phản biện) |
| **Thùng rác 7 ngày** | — | Xoá nhầm; dữ liệu đã xoá vẫn tồn tại vô thời hạn | Việc hoặc dự án bị xoá được ẩn khỏi mọi API (dự án đã xoá trả 404). Khôi phục được trong 7 ngày. Job 02:45 hằng ngày **xoá hẳn** cả tệp đính kèm trong kho, chỉ ghi audit `PURGE` với số lượng hoặc mã. Xoá dự án phải nhập lại mã dự án. Nhân viên không có quyền xoá (E2E #15, unit test). RES-02 → **Đầy đủ** | Bản sao lưu vẫn còn dữ liệu đã xoá cho tới khi bản sao lưu hết hạn (`BACKUP_KEEP_DAYS`). Cần ghi rõ điều này trong chính sách lưu trữ |
| **Nhãn riêng dự án** | Nội bộ | Đặt tên khách hàng hoặc cá nhân làm nhãn, rồi tên đó hiện trên báo cáo | Nhãn riêng chỉ hiện trong dự án đó. So trùng không phân biệt hoa thường. Tối đa 100 nhãn mỗi dự án. Tạo, sửa, xoá đều ghi audit | Quy ước đặt tên nhãn: không dùng tên cá nhân (GOV-01) |
| **Dữ liệu mẫu trình diễn** (`npm run seed:showcase`) | Công khai (dữ liệu giả) | Lẫn với dữ liệu thật | Chỉ dùng tên, công ty và nội dung giả. Không chạy tự động. Ghi chú trong mã nguồn cấm dùng dữ liệu thật (PRE-04) | Không chạy lệnh này trên máy chủ thật |

Ngoài ra, bộ nhớ đệm trình duyệt cho HTML/JS/CSS đã chuyển sang `no-cache` (kiểm tra ETag), để bản vá bảo mật có hiệu lực ngay ở mọi máy.

**Bắt buộc còn mở trước khi dùng dữ liệu thật** (giữ nguyên 4 mục ở mục 8, thêm 1 mục):
1. Gom log ≥ 12 tháng (DET-04).
2. Mã hoá thư mục sao lưu và giữ một bản ngoài máy (RES-01).
3. Hồ sơ đánh giá tác động DLCN, bổ sung **ghi chú cá nhân và KPI theo người**, cùng kịch bản sự cố 72 giờ (PRI-04, RES-03).
4. Chỉ định người phụ trách bảo vệ dữ liệu (GOV-02).
5. **Mới:** thông báo cho người lao động về việc xử lý số liệu KPI cá nhân và thời hạn lưu ghi chú, trước khi bật KPI cho dữ liệu thật.

## 10. Cập nhật GĐ2c (16/10/2026, branch `workhub/gd2c`): Sổ giao việc, nhập Kế hoạch năm, tổng hợp theo cán bộ

**Kết luận cổng: vẫn ĐẠT CÓ ĐIỀU KIỆN.** Thay đổi đưa vào hai nguồn dữ liệu mới từ ngoài hệ thống (sổ giao việc Excel, văn bản kế hoạch Word) và một báo cáo hiệu suất theo từng người (bảng Tổng hợp).

| Thay đổi | Phân loại | Rủi ro | Biện pháp đã làm (có kiểm thử) | Còn lại |
|---|---|---|---|---|
| **Trường giao việc mới** (người giao, ngày giao, nguồn, tiến độ %, sản phẩm đầu ra, sản phẩm đã có, kết quả / khó khăn, đánh giá của người giao, ghi chú, đơn vị phối hợp, người phối hợp) | Nội bộ; **đánh giá của người giao** = Bảo mật · DLCN (nhận xét về người lao động) | Nhân viên tự sửa đánh giá về mình; lộ nhận xét cho người ngoài dự án | Chỉ người giao hoặc quản lý dự án sửa được đánh giá (403 với người khác). Chỉ quản lý sửa được "Ngày hoàn thành thực tế", để nhân viên không tự sửa tỷ lệ đúng hạn. Các trường chỉ hiện trong dự án theo quyền xem hiện có. Mọi thay đổi ghi lịch sử việc | Quy ước: đánh giá ghi về kết quả công việc, không nhận xét đời tư (GOV-01) |
| **Tổng hợp theo cán bộ chủ trì** (`reports.summary`) | Bảo mật · DLCN (hiệu suất cá nhân) | Nhân viên xem số liệu của đồng nghiệp; trưởng phòng xem phòng khác | Giám đốc: phạm vi SYSTEM. Trưởng phòng: phạm vi UNIT, **máy chủ ép về phòng của mình** (tham số `departmentId` bị bỏ qua; E2E #16). Nhân viên: 403, không có menu. Admin IT không có quyền này. Bảng chỉ có **số đếm**, không có tiêu đề hay nội dung việc. Mỗi lần xem ghi audit `VIEW_SUMMARY` (chỉ phạm vi và số người) | Như KPI: thông báo cho người lao động trước khi dùng số liệu để đánh giá chính thức |
| **Nhập sổ giao việc Excel** | Theo nội dung tệp; có thể chứa DLCN (tên, **Zalo ID**) | Đưa dữ liệu không cần thiết vào hệ thống; tên người ngoài danh bạ | Chỉ quản lý dự án được nhập. Có xem trước (dry-run). Kiểm tra loại tệp theo nội dung. **Cột "Đã báo Zalo" và các cột tự tính bị bỏ qua, không lưu** (tối thiểu hoá, PRI-02). Tên không khớp tài khoản chỉ lưu dạng văn bản trong ghi chú / đơn vị phối hợp. Tối đa 2000 dòng. Tệp tải lên bị xoá sau khi xử lý. Audit `IMPORT_REGISTER` (số dòng) | — |
| **Nhập Kế hoạch công tác năm (.docx)** | Nội bộ (văn bản dự thảo của đơn vị); tên cán bộ "đ/c …" = DLCN cơ bản | Như trên | Chỉ đọc bảng "Phân công công việc cụ thể". Tên cán bộ chỉ dùng để khớp tài khoản; tên không khớp lưu trong ghi chú việc và hiện cảnh báo khi xem trước. Không lưu bản gốc .docx (chỉ lưu tên tệp). Audit `IMPORT_PLAN` | — |
| **Xuất sổ Excel** | Theo nhãn dữ liệu của dự án | Phát tán ngoài hệ thống | Cần quyền xem dự án; có watermark người xuất và thời điểm; audit `EXPORT_REGISTER` | DLP cho tệp xuất (PRE-05) chưa có |
| **Dữ liệu kiểm thử và dữ liệu mẫu** | Công khai (giả) | Dùng nhầm tệp thật của đơn vị | Tệp thật chủ dự án gửi (sổ giao việc, kế hoạch 2027) **chỉ được đọc tạm để đối chiếu cấu trúc, không đưa vào git, seed hay test**. Unit test và E2E sinh tệp Word, Excel giả ngay khi chạy (`__fixtures__/plan-docx.js`). Sổ mẫu "GV" trong `seed:showcase` dùng tên giả và số văn bản giả (PRE-04) | — |

**Bắt buộc còn mở trước khi dùng dữ liệu thật:** giữ nguyên 5 mục ở mục 9. Mục 3 bổ sung **bảng Tổng hợp theo cán bộ và trường "Đánh giá của người giao"** vào hồ sơ đánh giá tác động DLCN.

## 11. Cập nhật GĐ3a (16/10/2026, branch `workhub/gd3a`): điều hành hai chiều Ban Giám đốc → phòng → cán bộ

Căn cứ: bản ghi nghiệp vụ của chủ dự án và thiết kế `docs/DESIGN-gd3-dieu-hanh.md` (mục 5 là đánh giá trước khi làm). Bản ghi âm chỉ được chuyển thành chữ trong môi trường làm việc tạm, **không đưa vào git**.

**Kết luận cổng: vẫn ĐẠT CÓ ĐIỀU KIỆN.** Thay đổi này **thu hẹp** quyền xem (theo việc thay vì theo dự án công khai), đồng thời thêm vài loại dữ liệu đánh giá cá nhân.

| Thay đổi | Phân loại | Rủi ro | Biện pháp đã làm (có kiểm thử) | Còn lại |
|---|---|---|---|---|
| **Sổ giao việc của đơn vị — quyền xem theo việc** (`visibility = ASSIGNED`) | Nội bộ / Bảo mật tuỳ việc | Việc Ban Giám đốc giao lộ cho toàn Trung tâm | Chỉ những người sau thấy việc: Ban Giám đốc (xem toàn tổ chức), thành viên sổ, người giao, người chủ trì / phối hợp, lãnh đạo phòng chủ trì và phòng phối hợp, người đang được uỷ quyền. Việc nhánh thấy theo việc cha. Người khác nhận **404** (không lộ việc có tồn tại). Bộ lọc áp ở mọi danh sách: bảng, sổ, lịch, dashboard, báo cáo tuần, xuất Excel (unit test `gd3a.test.js`; E2E #17). Chỉ Ban Giám đốc / người quản lý sổ tạo được việc gốc và nhập hàng loạt | Mức "Hạn chế" cho việc nhạy cảm (chỉ người giao + người làm) — chưa làm |
| **Vai trò Phó phòng** | — | Mở rộng quyền | Hồ sơ quyền giống trưởng phòng (quyết định của chủ dự án), cấp qua luồng tạo tài khoản sẵn có. Tiêu chí đăng nhập và mật khẩu giữ nguyên | — |
| **Uỷ quyền có thời hạn** | Nội bộ | Lạm quyền; uỷ quyền vô thời hạn | Chỉ người có quyền duyệt mới uỷ quyền, và chỉ cho lãnh đạo có quyền duyệt. Tối đa 1 năm, thu hồi được, hết hạn thì tự mất hiệu lực. Ghi audit `CREATE` / `REVOKE Delegation` (đã kiểm tra bằng script gọi API). Người được uỷ quyền thay lãnh đạo phòng tiếp nhận / phân công được việc của phòng đó; thay người duyệt khác thì **chỉ xem** đúng những việc người uỷ quyền xem được, để duyệt từ hàng chờ, không sửa được. Hết hạn hoặc thu hồi → 404 | Hiện chữ "duyệt thay cho …" trong lịch sử duyệt |
| **Xếp loại khi nghiệm thu, đánh giá, hạn gốc / gia hạn** | Bảo mật · DLCN cơ bản (đánh giá người lao động) | Nhân viên tự sửa hạn để đẹp tỷ lệ đúng hạn; lộ xếp loại | Người thực hiện **không tự đổi hạn** do người khác giao (403 `USE_EXTENSION`); phải gửi đề nghị gia hạn, người giao quyết định; hạn gốc được giữ. Chỉ người duyệt cấp cuối xếp loại. Xếp loại hiện trong việc theo quyền xem theo việc. Gia hạn ghi audit `EXTENSION_*` (E2E #17) | Thông báo cho người lao động trước khi dùng xếp loại làm căn cứ đánh giá chính thức (đã nêu ở mục 9) |
| **Báo cáo tiến độ, kiến nghị** | Nội bộ | Ghi đè, mất vết | Mỗi báo cáo là một dòng lịch sử, không sửa, không xoá qua API. Câu trả lời kiến nghị ghi người trả lời và thời điểm | — |
| **Văn bản liên quan** | Nội bộ, có thể cao hơn | **Văn bản mật nhà nước** bị đưa lên hệ thống chưa đủ điều kiện (Luật Bảo vệ bí mật nhà nước 2018) | Chỉ lưu số hiệu, trích yếu, liên kết (http/https). Giao diện ghi rõ "Không nhập văn bản Mật / Tối mật / Tuyệt mật". Tối đa 50 văn bản mỗi việc | **[Bắt buộc trước khi dùng thật]** quy định nội bộ cấm nhập văn bản mật, đưa vào hướng dẫn sử dụng |
| **Dữ liệu mẫu bộ máy Trung tâm** (`seed:showcase`, sổ `TT`) | Công khai (giả) | Lẫn tên thật | Tên phòng theo bộ máy, **tên cán bộ, số văn bản đều là giả** | — |

Một agent độc lập (không tham gia viết mã) đã rà soát phần phân quyền của GĐ3a. Các lỗi tìm được đã sửa và có kiểm tra lại:
- Cán bộ tự đổi "người giao" để vượt kiểm tra hạn: nay bị chặn.
- Người phối hợp tự phân công lại việc giao về phòng: nay bị chặn.
- Giao về phòng từ dự án thường: nay chỉ cho phép trong sổ giao việc của đơn vị.
- Tạo việc gốc vào sổ qua đường tiếp nhận yêu cầu hoặc chuyển ghi chú: nay bị chặn.
- Lộ tiêu đề việc qua thùng rác, "việc tôi tạo", @nhắc tên, quy tắc lặp và tiêu đề việc cha: nay chỉ hiện cho người được xem.
- Việc nhánh không đổi theo khi đổi đơn vị chủ trì: nay đổi theo.
- Thao tác trên việc đã vào thùng rác: nay bị chặn.

**Bắt buộc còn mở trước khi dùng dữ liệu thật:** giữ nguyên 5 mục ở mục 9, thêm mục 6: **quy định không nhập văn bản mật** vào WorkHub.

## 12. Cập nhật GĐ3b (16/10/2026, branch `workhub/gd3b`): vòng phản hồi 6 vai trò

Căn cứ: 6 agent đóng vai Giám đốc, PGĐ, Văn phòng, Trưởng phòng, Chuyên viên, Admin dùng thử trên dữ liệu **giả** (`seed:showcase`), phản hồi tổng hợp và quyết định xử lý của agent chủ trì (chủ dự án uỷ quyền "tự quyết, không cần hỏi lại"). Không dùng dữ liệu thật; tệp tải lên của chủ dự án và bản ghi âm không vào git, seed hay test.

**Kết luận cổng: vẫn ĐẠT CÓ ĐIỀU KIỆN.** Phần lớn thay đổi **thu hẹp** quyền hoặc **giảm lộ** dữ liệu. Có thêm một số tập dữ liệu đánh giá cá nhân (KPI cá nhân, tổng hợp xuất Excel), nên cần chú ý nhãn và nhật ký.

| Thay đổi | Phân loại | Rủi ro | Biện pháp đã làm | Còn lại |
|---|---|---|---|---|
| **Trang Điều hành** (`/api/ops/overview`), tìm nhanh theo số văn bản (`/api/search`) | Nội bộ / Bảo mật tuỳ việc | Gom việc của nhiều phòng lên một trang, lộ ra ngoài phạm vi | Chỉ Ban Giám đốc (toàn Trung tâm, mặc định là phòng mình phụ trách) và lãnh đạo phòng (chỉ phòng mình) xem được; cán bộ nhận 403. Mọi truy vấn đi qua `itemVisibleWhere` + `visibleProjectsWhere`. Mỗi lần xem ghi audit `VIEW_OPS`. Tìm nhanh chỉ trả việc trong phạm vi được xem; Admin IT nhận rỗng (E2E #15) | — |
| **Người duyệt cấp Ban Giám đốc theo phòng phụ trách** | — | Mọi thành viên BGĐ duyệt được mọi phiếu trình (lạm quyền) | Bước "Ban Giám đốc" chỉ gồm PGĐ phụ trách phòng chủ trì và người giao; chỉ khi phòng chưa có người phụ trách mới mở cho cả BGĐ. Một người không được duyệt hai cấp của cùng một phiếu (403 `DOUBLE_APPROVAL`). Duyệt thay ghi `onBehalfOfId` và hiện "thay …" trong lịch sử | — |
| **Bàn giao khi khoá tài khoản (nghỉ việc)** | Nội bộ | Việc mồ côi; người đã nghỉ vẫn giữ uỷ quyền | Hệ thống gỡ người đó khỏi các việc đang mở và trả việc giao về phòng để phân công lại; việc đang chờ duyệt thì giữ nguyên để duyệt tiếp. Thu hồi uỷ quyền, bỏ vai trò PGĐ phụ trách, thông báo cho lãnh đạo. Admin chỉ thấy **số đếm**, không thấy tiêu đề việc. Ghi audit `HANDOVER` | — |
| **Đổi vai trò ↔ quyền** | — | Đổi Nhóm tài khoản nhưng quyền giữ nguyên (NV→PP vẫn quyền NV, TP→NV vẫn duyệt được) | Có thể "Áp quyền mặc định của vai trò mới" (cần quyền Phân quyền, kiểm tra `canGrant` từng quyền, ghi audit `ROLE_PROFILE_APPLY`). Tài khoản có quyền lệch với vai trò được cảnh báo. Luồng cấp quyền khi **tạo** tài khoản và tiêu chí đăng nhập / mật khẩu **không đổi** | — |
| **Nhật ký hệ thống** | Bảo mật | Admin IT đọc tiêu đề việc, tên tệp qua nhật ký (lộ nội dung nghiệp vụ) | Với Admin IT, giá trị trên bản ghi nghiệp vụ bị ẩn; có nhãn tiếng Việt và bộ lọc (hành động, đối tượng, người, ngày) | Nên giữ nhật ký ≥ 12 tháng và chuyển sang lưu bất biến (WORM, băm) như mục 7 |
| **Ghi đăng nhập sai** (`LOGIN_FAILED`) | DLCN cơ bản (tên tài khoản, IP) | Ghi nhầm mật khẩu khi người dùng gõ mật khẩu vào ô tài khoản | Chỉ ghi chuỗi có dạng tên tài khoản; chuỗi khác **không lưu**. Thông báo lỗi, mã trạng thái, quy tắc khoá giữ nguyên | Endpoint đăng nhập chưa giới hạn tần suất, nên nhật ký có thể phình. Khuyến nghị thêm giới hạn ở reverse proxy (không đổi tiêu chí đăng nhập) |
| **KPI cá nhân** (`/api/kpi/me`), điểm tổng hợp, xếp loại | Bảo mật · DLCN cơ bản (đánh giá người lao động) | Suy ra số liệu của đồng nghiệp | Mỗi người chỉ thấy số của mình. Điểm khối lượng và trung bình phòng chỉ tính khi phòng có ≥ 3 cán bộ có dữ liệu. Không có dữ liệu đúng hạn và xếp loại thì không chấm điểm. Trang KPI vẫn ghi audit | Thông báo cho người lao động trước khi dùng điểm làm căn cứ đánh giá chính thức (mục 9) |
| **Tổng hợp giao việc xuất Excel** (`/api/summary.xlsx`) | Bảo mật · DLCN | Tệp chứa số liệu từng cán bộ bị chuyển tiếp | Cùng phạm vi và quyền với màn hình; ghi audit `EXPORT_SUMMARY`; đóng dấu người xuất và giờ xuất (giờ VN) | Quy định nội bộ về chia sẻ tệp tổng hợp |
| **Văn phòng nhập thay** (thành viên sổ TT; giao nhiều việc một lần, ghi "người giao") | Nội bộ | Thành viên sổ sửa việc không phải của mình | Thành viên sổ xem cả sổ nhưng chỉ sửa việc mình giao hoặc liên quan (403). Ai nhập thay được ghi trong lịch sử. Không nhập nội dung văn bản mật (nhắc trên biểu mẫu) | — |
| **Hạn nộp phòng (nội bộ), tiến độ qua báo cáo, người phối hợp** | Nội bộ | Cán bộ tự sửa tiến độ / hạn để đẹp số liệu | Hạn nội bộ do lãnh đạo phòng đặt, không muộn hơn hạn của người giao. Tiến độ việc giao về phòng chỉ người chủ trì / lãnh đạo phòng cập nhật, mỗi lần thành một dòng báo cáo. Người phối hợp chỉ báo phần mình, không đổi tiến độ chung, không nộp hay xin gia hạn (E2E #15) | — |

**Bắt buộc còn mở trước khi dùng dữ liệu thật:** không đổi so với mục 11.

**Rà soát độc lập sau khi làm (agent review code + agent review hiệu năng, không tham gia viết mã).** Các lỗi đã sửa và có kiểm tra lại (unit 102/102, E2E 15/15):
- Người phối hợp đổi được trạng thái (gửi duyệt, huỷ), tiêu đề, sản phẩm: nay chỉ được báo cáo phần phối hợp, bình luận, đính kèm, ghi "sản phẩm đã có" (403 `SUPPORT_ONLY`). Huỷ việc điều hành: chỉ người giao / người nhập thay / người quản lý.
- Thành viên "Người xem" của sổ vẫn giao được việc: nay chặn. "Người giao" chỉ được ghi là chính mình hoặc Ban Giám đốc (sổ của đơn vị), trừ người quản lý sổ.
- Văn phòng không sửa được việc mình nhập thay: nay sửa được (theo người tạo).
- Nhật ký đăng nhập sai có thể lưu nguyên văn chuỗi lạ (có thể là mật khẩu): nay chỉ ghi tên khi tài khoản có thật.
- File Excel tổng hợp ghi tên dự án người xuất không được xem: nay chỉ ghi khi được xem. Lọc ngày theo giờ Việt Nam.
- Người được uỷ quyền thay lãnh đạo phòng trả lời kiến nghị: giữ (đang thay lãnh đạo phòng), nhưng lịch sử ghi "thay …".
- Hiệu năng: hàng chờ duyệt / huy hiệu tính người duyệt trong bộ nhớ (từ khoảng 1.300 truy vấn xuống khoảng 15 ở 3.000 việc); gom sự kiện thông báo sau khi commit; nén phản hồi; tải lại từng việc khi cập nhật trực tiếp; Điều hành không nạp việc cũ đã xong và không ghi nhật ký khi làm mới nền; thêm chỉ mục.

## 13. Cập nhật GĐ3c (16/10/2026, branch `workhub/gd3c-ux`): cải thiện UI/UX

Căn cứ: đặc tả UX do agent đánh giá viết dựa trên giao diện thật (dữ liệu giả), các nguồn NN/g, Visa Design System, W3C WCAG 2.1.4, Linear, Jira, GitHub, và các skill impeccable / frontend-design. Đây là thay đổi giao diện, không đổi API quyền.

**Kết luận cổng: ĐẠT.** Không có tập dữ liệu cá nhân mới. Chỉ thêm lưu trữ phía trình duyệt cho trạng thái giao diện.

| Thay đổi | Phân loại | Rủi ro | Biện pháp |
|---|---|---|---|
| `localStorage` lưu trạng thái giao diện: khối mở / đóng, bộ lọc cuối, phạm vi Điều hành, công tắc phím tắt, id việc mở gần đây | Nội bộ | Máy dùng chung để lộ thói quen / nội dung | Khoá theo từng người dùng (`workhub:u<id>:…`). Chỉ lưu id, mã, cờ — **không** lưu tiêu đề, nội dung việc hay từ khoá tìm kiếm. Tên việc "gần đây" tải lại qua API, nên việc đã mất quyền xem sẽ không hiện |
| `sessionStorage` lưu bản nháp bình luận, báo cáo tiến độ, ý kiến duyệt, trả lời, ý kiến gia hạn | Nội bộ / Bảo mật tuỳ việc | Nội dung nghiệp vụ ở lại trên máy | Khoá theo từng người dùng (`workhub:draft:u<id>:…`). Bản nháp mất khi đóng tab, bị xoá khi tự bấm Đăng xuất, và xoá ngay sau khi gửi thành công (huỷ cả lần ghi trễ đang chờ). Hết phiên (401) thì giữ lại để người đó đăng nhập lại không mất nội dung đang viết |
| Bộ lọc trong URL (`#/…?prio=…&q=…`) | Nội bộ | Chia sẻ liên kết làm lộ việc hoặc từ khoá tìm | URL chứa id, mã và từ khoá tìm người dùng tự gõ. Phần sau `#` không gửi lên máy chủ nên không vào nhật ký truy cập / proxy. Người nhận liên kết vẫn chỉ thấy việc trong phạm vi quyền của mình, vì máy chủ kiểm tra. Bộ lọc nhớ theo người (`localStorage`) **không** lưu ô tìm. Bộ lọc người dùng chủ động "Lưu" lên máy chủ thì giữ cả từ khoá (`q`) — xem dòng dưới |
| Bộ lọc đã lưu trên máy chủ (`SavedView`, thêm khoá `mine, dl, dept, type, stage, source, plan, assigner` và kiểu xem Sổ) | Nội bộ | Bộ lọc chia sẻ để lộ tiêu chí | Chỉ nhận danh sách khoá cố định, mỗi giá trị ≤ 100 ký tự, tối đa 30 bộ lọc / người / dự án; từ khoá tìm chỉ lưu khi người dùng tự bấm Lưu (khuyến nghị: không gõ dữ liệu cá nhân vào ô tìm của bộ lọc chia sẻ); chia sẻ cần quyền sửa dự án; chỉ người xem được dự án mới đọc được. Tạo bộ lọc ghi nhật ký `CREATE SavedView` |
| Hoàn tác thay cho hỏi xác nhận (xoá vào thùng rác, xoá mục checklist, gỡ văn bản) | — | Mất dữ liệu | Chỉ áp cho thao tác khôi phục được. Xoá tệp vẫn hỏi, vì xoá hẳn |
| Phím tắt một chữ | — | Thao tác nhầm; người dùng phần mềm đọc màn hình | Tắt được trong màn "?" (WCAG 2.1.4). Không chạy khi đang gõ, khi bộ gõ tiếng Việt đang ghép chữ, hoặc khi đang mở hộp thoại |

## 14. Cập nhật GĐ3d (17/10/2026, branch `workhub/gd3d-mau-cuoi`): dữ liệu mẫu cuối, bỏ thiết kế mẫu cũ

**Kết luận cổng: ĐẠT.** Không có dữ liệu thật; không đổi tiêu chí đăng nhập / luồng cấp quyền khi tạo tài khoản.

| Thay đổi | Phân loại | Rủi ro | Biện pháp |
|---|---|---|---|
| Thêm 2 tài khoản mẫu `pp.tnt`, `pgd2` (tên giả) | Nội bộ (dữ liệu giả) | Tài khoản mẫu có mật khẩu mặc định | Dùng đúng luồng tạo tài khoản + quyền khởi tạo; bắt đổi mật khẩu lần đầu; khoá được trong Quản trị |
| `npm run tidy:demo`: dự án mẫu cũ vào Thùng rác, khoá tài khoản / phòng mẫu cũ | Nội bộ | Mất dữ liệu nếu chạy nhầm trên máy có dữ liệu thật | Không xoá hẳn: dự án khôi phục được 7 ngày, tài khoản / phòng mở lại được; có `--dry` xem trước; chỉ nhắm mã phòng mẫu (KD, KT, HCNS), sổ "GV" và dự án thử rỗng tên toàn số; ghi `AuditLog` (ip `script:tidy-demo`). Khuyến nghị sao lưu CSDL trước khi chạy |
| Kế hoạch năm 2027 (mẫu), bảng việc nội bộ 3 phòng | Nội bộ (dữ liệu giả) | — | Nội dung chung, tên giả, số văn bản ghi "(giả)" |

## 15. Cập nhật GĐ3e–3f (17/10/2026, branch `workhub/gd3e-lich`): cột tự do, xem dạng lịch, Lịch công tác; bỏ "Gửi yêu cầu"

**Kết luận cổng: ĐẠT, kèm khuyến nghị.** Tập dữ liệu mới: **Lịch công tác** (`ScheduleEvent`, `ScheduleParticipant`).

| Thay đổi | Phân loại | Rủi ro | Biện pháp |
|---|---|---|---|
| Lịch công tác: ngày giờ, nội dung, thành phần (tên người), chủ trì, địa điểm | Nội bộ; DLCN cơ bản (họ tên, lịch làm việc) | Lộ lịch di chuyển của lãnh đạo / cán bộ ra ngoài | Chỉ người đăng nhập xem (tài khoản quản trị IT không xem); không có liên kết công khai; xuất Excel ghi người xuất + nhật ký `EXPORT`; mọi thêm / sửa / xoá / nhập ghi `AuditLog` |
| Báo vắng (đi công tác, nghỉ phép, nghỉ ốm…) | Nội bộ; lý do "Nghỉ ốm" có thể chạm dữ liệu sức khoẻ | Ghi chi tiết bệnh trạng | Lý do chọn từ danh sách chung ("Nghỉ ốm" — không ghi bệnh); form nhắc không ghi chi tiết sức khoẻ; chỉ người đó / lãnh đạo phòng / BGĐ / Văn phòng báo thay |
| Nhập lịch tuần từ Excel | Nội bộ | Tệp chứa tên người ngoài hệ thống | Tên không khớp tài khoản chỉ lưu dạng chữ trên lịch, không tạo tài khoản; tối đa 500 mục / lần; tệp tạm xoá ngay sau khi đọc; nhập lại cùng tuần thay bản đã nhập (không nhân bản) |
| Bỏ giao diện "Gửi yêu cầu" | — | — | Dữ liệu yêu cầu cũ giữ nguyên trong CSDL (không xoá), chỉ ẩn khỏi giao diện |

**Khuyến nghị cho chủ dự án:** khi đưa tên thật và lịch thật vào máy chạy, coi máy đó là môi trường vận hành: không dùng làm DEV/UAT, sao lưu (`backups/`, `backups-manual/`) giữ ở nơi chỉ người quản trị đọc được; dữ liệu mẫu trong git vẫn chỉ dùng tên giả.


## 16. Cập nhật GĐ3g–3h (17/10/2026, branch `workhub/gd3g-gon`, `workhub/gd3h-tong-the`): tối giản thao tác, Tổng thể công việc theo người / phòng

**Kết luận cổng: ĐẠT, kèm khuyến nghị.** Không có tập dữ liệu mới. Có thêm một **cách nhìn mới trên dữ liệu đã có**: danh sách việc theo từng người trên mọi dự án. Đây là xử lý dữ liệu cá nhân cơ bản (họ tên, khối lượng / tiến độ công việc). Chiếu theo Nghị định 13/2023/NĐ-CP, nguyên tắc tối thiểu hoá và đúng mục đích, cùng các lớp GOV / PRE / DET của khung.

| Thay đổi | Phân loại | Rủi ro | Biện pháp |
|---|---|---|---|
| "Tổng thể công việc" (`GET /api/work`): việc của một người (chủ trì / phối hợp / người giao) hoặc một phòng trên mọi dự án | Nội bộ; DLCN cơ bản | Theo dõi, so sánh cá nhân vượt mục đích điều hành; lộ việc của dự án người xem không được thấy | Phạm vi kiểm ở máy chủ: BGĐ xem mọi người; lãnh đạo phòng chỉ phòng mình và cán bộ trong phòng; cán bộ chỉ chính mình; tài khoản quản trị IT bị chặn (403). Danh sách luôn giao với quyền xem từng việc của người xem. Xem việc của người khác ghi `AuditLog` `VIEW_WORK` (không ghi nội dung việc). Phản hồi `Cache-Control: private, no-store`. Không có xuất tệp. Tối đa 500 dòng |
| Tên người / phòng bấm được ở Tổng quan, Dashboard, KPI, chi tiết việc | Nội bộ | Người không có quyền thử mở | Tên chỉ là liên kết khi người xem có quyền (tính phía trình duyệt). Máy chủ vẫn kiểm lại và trả 403 nếu không có quyền |
| Ô "Số liệu của tôi" mở đúng danh sách việc đã đếm | Nội bộ | — | Cùng định nghĩa với KPI. Cán bộ chỉ mở được của chính mình |
| Kiến nghị: lãnh đạo phòng "Trình BGĐ" (cột `forwardedAt`, `forwardedById`, `forwardNote` trong `ProgressReport`) | Nội bộ | Ý kiến phòng gửi nhầm người | Chỉ lãnh đạo phòng chủ trì trình được. Người nhận là người giao và PGĐ phụ trách. Người kiến nghị được báo. Ghi `AuditLog` `PROPOSAL_FORWARD`. Kiến nghị đã trình thì rời hàng chờ của phòng |
| Duyệt / Không duyệt + ý kiến dùng chung cho phiếu trình, kiến nghị, gia hạn; chi tiết việc dạng gọn; tài liệu hai chiều | — | — | Chỉ đổi giao diện. Tệp vẫn qua kiểm tra loại / dung lượng như trước. Cột "bên giao / bên thực hiện" chỉ xếp theo người tải lên |

**Khuyến nghị cho chủ dự án:**
1. Thông báo cho cán bộ rằng Ban Giám đốc và lãnh đạo phòng xem được danh sách việc theo từng người, phục vụ điều hành, và lần xem được ghi nhật ký. Đây là minh bạch xử lý DLCN theo NĐ 13/2023.
2. Giữ nhật ký `VIEW_WORK` ít nhất 12 tháng, theo yêu cầu nhật ký truy xuất của khung.
3. Không dùng màn hình này làm căn cứ đánh giá thi đua tự động. KPI vẫn chỉ để tham khảo.
