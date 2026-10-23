# Đánh giá bảo vệ dữ liệu — Kepper Hub

Kepper Hub kế thừa mã nguồn và các biện pháp đã đánh giá của WorkHub. Các mục §1–§16 nằm trong `docs/data-protection-assessment.md` của repo tom18072001/ND57, nhánh `workhub-kanban`. Tài liệu này đánh giá lại cho nghiệp vụ mới của Kepper.

## Đánh giá bảo vệ dữ liệu — Kepper Hub GĐ1 (MTL, cảnh báo tiến độ, KPI, Viber) — 20/10/2026

**Giả định** (chưa được xác nhận, nên áp mức nhạy cảm cao hơn):
- Triển khai on-prem: một máy chủ / PC của công ty chạy Docker, chỉ truy cập trong mạng nội bộ hoặc qua VPN.
- Dưới 500 nhân viên.
- Không xử lý dữ liệu khách hàng mua / thuê nhà ở xã hội. Bước "bán hàng" trong MTL chỉ là hạng mục công việc, không có danh sách khách hàng.
- Không có bí mật nhà nước.

**Kết luận cổng: ĐẠT CÓ ĐIỀU KIỆN.**
- Phần trong ứng dụng ĐẠT.
- Kênh **Viber** chỉ được bật sau khi chủ dự án làm xong 3 việc:
  1. Hồ sơ đánh giá tác động chuyển DLCN ra nước ngoài, vì máy chủ Viber ở ngoài Việt Nam.
  2. Nội dung tin nhắn tối thiểu hoá (đã thiết kế sẵn).
  3. Ghi nhận sự đồng ý của từng nhân viên khi liên kết Viber.

  Mặc định Viber **tắt**.

### 1. Phân loại

| Tập dữ liệu | Nhãn nội bộ | Phân loại pháp lý | Số chủ thể | Cấp độ HTTT |
|---|---|---|---|---|
| MTL tổng / MTL bộ phận: hạng mục, mốc, đường găng, thời gian, đầu mối, cơ quan phê duyệt | **Bảo mật** (bí mật kinh doanh: chiến lược pháp lý, tiến độ đầu tư) | Dữ liệu khác, dùng riêng của doanh nghiệp | — | Cấp 2 (đề xuất); nâng cấp 3 nếu công ty xếp hệ thống quản trị dự án là trọng yếu |
| Tài khoản nhân viên (họ tên, chức danh, bộ phận, email nội bộ) | Nội bộ | DLCN cơ bản | < 500 | — |
| Tiến độ / KPI tiến độ theo bộ phận, theo người | **Bảo mật** | DLCN cơ bản (đánh giá hiệu quả công việc của cá nhân) | < 500 | — |
| Viber ID gắn với tài khoản (nếu bật) | **Bảo mật** | DLCN cơ bản; chuyển ra nước ngoài | < 500 | — |
| Tệp đính kèm, bình luận cowork | Bảo mật (mặc định) | Tuỳ nội dung | — | — |
| Nhật ký hệ thống / nhật ký cảnh báo | Nội bộ | Nhật ký HTTT | — | — |

Khi có nhiều tiêu chí thì áp mức cao nhất, nên các tập kế hoạch và KPI đều là **Bảo mật**.

### 2. Dòng dữ liệu

1. **Tệp MTL Excel**, do Ban lãnh đạo hoặc PMO lập.
   - Nhập trên máy chạy qua "Nhập MTL từ Excel". Tệp tạm bị xoá ngay sau khi đọc.
   - Dữ liệu được lưu vào PostgreSQL trên máy chạy.
2. **Cập nhật tiến độ**: các bộ phận cập nhật %, ngày thực tế, tệp và bình luận trên giao diện web, qua HTTPS nội bộ (**chưa có** — hiện chạy HTTP trên `127.0.0.1`; bắt buộc đặt reverse proxy TLS trước khi mở cho máy khác).
3. **Job hằng ngày** tính kế hoạch so với thực tế, sinh cảnh báo và KPI.
   - Thông báo trong ứng dụng.
   - **[Nhạy cảm, xuyên biên giới]** Viber Bot API (Rakuten Viber). Tin nhắn chỉ gồm mã hạng mục, loại cảnh báo và liên kết nội bộ. Không gửi số liệu tiến độ chi tiết, tên người khác hay tài liệu.
4. **Người dùng**: Ban lãnh đạo, trưởng bộ phận, nhân viên. Mỗi người chỉ xem trong phạm vi quyền của mình.
5. **Sao lưu**: thư mục `backups/` trên máy chạy, cần thêm bản ngoại tuyến (xem RES-01).

### 3. Rà năng lực

| Mã | Trạng thái | Khuyến nghị cụ thể | Ưu tiên |
|---|---|---|---|
| GOV-01 | Một phần | Ban hành quy chế dùng Kepper Hub: ai cập nhật MTL, chu kỳ cập nhật (tuần), ai phê duyệt điều chỉnh kế hoạch gốc. Điều chỉnh kế hoạch gốc phải có lý do và được ghi nhật ký (đã thiết kế) | Bắt buộc |
| GOV-02 | Chưa có | Chỉ định: chủ sở hữu dữ liệu dự án (GĐĐH), người cập nhật MTL (PMO), người chịu trách nhiệm bảo vệ DLCN, người quản trị hệ thống. Lập bảng RACI theo bộ phận | Bắt buộc |
| GOV-03 | Một phần | Danh mục dữ liệu ghi ở tài liệu này và trong `schema.prisma` (chú thích). Chưa cần công cụ catalog | Nên có |
| GOV-04 | Một phần | Gắn nhãn "Bảo mật" cho dự án MTL trên giao diện; không cho đặt dự án ở chế độ "Toàn tổ chức" khi chưa có phê duyệt | Nên có |
| GOV-05 | Một phần | Bản đồ luồng ở mục 2; mỗi lần nhập ghi nguồn tệp (tên, băm SHA-256, người nhập) | Nên có |
| GOV-06 | N/A → Bắt buộc khi bật Viber | Thoả thuận với Rakuten Viber theo điều khoản Bot API; ghi phạm vi tin nhắn tối thiểu. Không chia sẻ dữ liệu cho đối tác hay cơ quan bên ngoài qua hệ thống | Bắt buộc (khi bật Viber) |
| PRE-01 | Đầy đủ (kế thừa) | RBAC theo vai trò và phạm vi bộ phận, đặc quyền tối thiểu, khoá tài khoản nghỉ việc có bàn giao. Khuyến nghị bật MFA khi mở truy cập ngoài mạng nội bộ | Bắt buộc |
| PRE-02 | Một phần | Tài khoản quản trị IT tách khỏi nghiệp vụ (đã có). Quyền SSH / Docker trên máy chạy chỉ cho người quản trị, có ghi phiên | Nên có |
| PRE-03 | Một phần | HTTPS (TLS 1.2+) qua reverse proxy khi truy cập từ máy khác; mã hoá ổ đĩa máy chạy (BitLocker); mật khẩu băm (đã có); token Viber chỉ để trong biến môi trường | Bắt buộc |
| PRE-04 | Đầy đủ | Repo / seed / test chỉ dùng dữ liệu giả. MTL thật chỉ có trên máy chạy. Không dùng bản sao lưu thật cho DEV | Bắt buộc |
| PRE-05 | Một phần | Kiểm tra loại và dung lượng tệp đính kèm (đã có). Xuất Excel ghi nhật ký người xuất | Nên có |
| PRE-06 | Một phần | KPI theo người chỉ Ban lãnh đạo, trưởng bộ phận (bộ phận mình) và PMO (người quản lý dự án, trong dự án mình điều phối) xem được; ghi nhật ký `VIEW_KPI` / `VIEW_WORK`. KPI chỉ dùng tham khảo, không tự động gắn thưởng phạt | Bắt buộc |
| PRE-07 | Một phần | API chỉ trả trường cần thiết. **Đính chính 23/10/2026: chưa có giới hạn số lần đăng nhập** (`/api/auth` được loại khỏi rate limit để giữ tiêu chí đăng nhập) — chờ chủ dự án quyết (xem mục rà soát 23/10). Webhook Viber kiểm chữ ký HMAC `X-Viber-Content-Signature` | Bắt buộc (khi bật Viber) |
| DET-01 | Một phần | AuditLog cho nhập MTL, điều chỉnh kế hoạch gốc, cập nhật tiến độ, xuất dữ liệu, xem KPI. Giữ ≥ 12 tháng | Bắt buộc |
| DET-02 | N/A | Quy mô nhỏ, on-prem. Rà định kỳ quyền thành viên dự án mỗi quý | Nâng cao |
| DET-03 | N/A | Nâng cao. Có thể cảnh báo khi một tài khoản xuất dữ liệu nhiều lần trong ngày | Nâng cao |
| DET-04 | Một phần | Log ứng dụng có cấu trúc (JSON). Khuyến nghị đẩy về SIEM / Elastic của công ty nếu có. Giữ ≥ 12 tháng | Nên có |
| DET-05 | Chưa có | Chỉ cần khi nhật ký dùng làm chứng cứ. Nên xuất nhật ký hằng tháng ra tệp có băm SHA-256 | Nâng cao |
| PRI-01 | Chưa có → Bắt buộc khi bật Viber | Liên kết Viber là lựa chọn của từng người; màn hình liên kết ghi rõ dữ liệu gửi đi và nơi lưu; lưu thời điểm đồng ý; huỷ liên kết được | Bắt buộc (khi bật Viber) |
| PRI-02 | Đầy đủ | Tin nhắn Viber tối thiểu hoá; thông báo trong ứng dụng chỉ gửi người liên quan | Bắt buộc |
| PRI-03 | Một phần | Nhân viên xem được dữ liệu và KPI của mình; yêu cầu sửa / xoá qua quản trị viên | Nên có |
| PRI-04 | Chưa có | Lập hồ sơ đánh giá tác động xử lý DLCN (nhân viên, KPI) và hồ sơ chuyển DLCN ra nước ngoài (Viber), gửi trong 60 ngày kể từ khi bắt đầu xử lý | Bắt buộc |
| RES-01 | Một phần | Sao lưu hằng ngày (kế thừa). Thêm một bản ngoại tuyến hằng tuần, kiểm thử khôi phục mỗi quý | Bắt buộc |
| RES-02 | Một phần | Thời hạn giữ: dự án kết thúc thì lưu trữ 5 năm (theo quy chế công ty), nhật ký 12 tháng, cảnh báo 12 tháng | Nên có |
| RES-03 | Chưa có | Kịch bản sự cố: lộ MTL hoặc lộ tài khoản → khoá tài khoản, thu hồi phiên (`sessionVersion`), thông báo vi phạm DLCN ≤ 72 giờ | Bắt buộc |

### 4. Nghĩa vụ pháp lý phát sinh

| Nghĩa vụ | Căn cứ | Hạn / ngưỡng | Người phụ trách |
|---|---|---|---|
| Hồ sơ đánh giá tác động xử lý DLCN (nhân viên, KPI) | Luật BVDLCN Đ21 | ≤ 60 ngày từ khi bắt đầu xử lý | Người chịu trách nhiệm bảo vệ DLCN |
| Hồ sơ đánh giá tác động chuyển DLCN ra nước ngoài (Viber) | Luật BVDLCN Đ20; Luật Dữ liệu Đ23; NĐ 165/2025 Đ12 | Trước khi bật Viber | Như trên |
| Sự đồng ý khi liên kết Viber | Luật BVDLCN (đồng ý theo mục đích; im lặng không phải đồng ý) | Từng người | Quản trị hệ thống |
| Thông báo vi phạm DLCN | Luật BVDLCN Đ23 | ≤ 72 giờ | Người chịu trách nhiệm bảo vệ DLCN |
| Nhật ký hệ thống truy xuất được | NĐ 333/2026 | ≥ 12 tháng | Quản trị hệ thống |

Soát lại với Công báo trước khi trích dẫn trong hồ sơ chính thức.

### 5. Khuyến nghị ưu tiên

1. [Bắt buộc] Không đưa MTL thật vào git, seed hay test. Chỉ nhập trên máy chạy (đã áp dụng).
2. [Bắt buộc] Chỉ định chủ sở hữu dữ liệu, người cập nhật MTL, người bảo vệ DLCN (GOV-02).
3. [Bắt buộc] Viber mặc định tắt. Chỉ bật sau khi có hồ sơ chuyển DLCN ra nước ngoài và sự đồng ý của từng người. Tin nhắn chỉ có mã hạng mục, loại cảnh báo và liên kết.
4. [Bắt buộc] Điều chỉnh kế hoạch gốc (baseline) phải có lý do và được ghi nhật ký. KPI tính trên kế hoạch gốc, để không "đẹp số" bằng cách sửa kế hoạch.
5. [Bắt buộc] KPI theo người chỉ BLĐ và trưởng bộ phận xem; mỗi lần xem ghi nhật ký.
6. [Bắt buộc] HTTPS và mã hoá ổ đĩa khi mở truy cập từ máy khác; thêm bản sao lưu ngoại tuyến.
7. [Nên có] Đẩy log về SIEM của công ty; rà quyền thành viên dự án mỗi quý.

### 6. Rủi ro còn lại và câu hỏi mở

- Máy chạy là PC cá nhân thì rủi ro mất / hỏng máy cao. Nên chuyển sang máy chủ của công ty.
- Cần xác nhận "GR" trong cột đầu mối là bộ phận nào. Tạm hiểu là Đối ngoại / quan hệ chính quyền.
- Cơ quan bên ngoài (UBND TP, các Sở, Cục, VP ĐKĐĐ) chỉ lưu dạng chữ "đơn vị phê duyệt / phối hợp", không có tài khoản.

## Đánh giá bảo vệ dữ liệu — Kepper Hub GĐ2a (sprint theo tháng T, Cập nhật nhanh, MTL bộ phận điền sẵn) — 20/10/2026

**Giả định:** như GĐ1 (on-prem, < 500 nhân viên, không có dữ liệu khách hàng, không có bí mật nhà nước).
**Kết luận cổng: ĐẠT CÓ ĐIỀU KIỆN** — điều kiện chỉ còn các mục Bắt buộc đã nêu ở GĐ1 (GOV-02, PRI-04, RES-01, RES-03) và ban hành quy chế ai nhập MTL bộ phận (GOV-01).

Thay đổi về dữ liệu so với GĐ1:
- Sprint (giai đoạn) lưu ở **một trường mới `Project.sprintPlan`** (JSON: tên giai đoạn, khoảng bước, mục tiêu) — nhãn **Bảo mật** như MTL, không có dữ liệu cá nhân; chỉ PMO (người quản lý dự án) sửa, mỗi lần sửa ghi nhật ký `MTL_SPRINT_PLAN`. Tiến độ sprint / tháng là dữ liệu suy ra.
- Thang tiến độ theo đầu việc và tiến độ theo checklist: đổi cách tính, không thêm dữ liệu; cập nhật % từ checklist ghi vào nhật ký hoạt động của hạng mục.
- **Xuất tệp mới**: mẫu Excel MTL bộ phận chứa hạng mục MTL (Bảo mật) và **họ tên nhân viên** của bộ phận (danh sách chọn người phụ trách).
- **Mở quyền**: lãnh đạo bộ phận tự nhập MTL của bộ phận mình (trước đây chỉ PMO).
- Thông báo nhắc cập nhật 15:00 thứ Năm (chạy bù đến 20:00 nếu máy tắt): chỉ trong ứng dụng, không qua Viber.

### 1. Phân loại

| Tập dữ liệu | Nhãn nội bộ | Phân loại pháp lý | Số chủ thể | Cấp độ HTTT |
|---|---|---|---|---|
| Thiết lập sprint (`Project.sprintPlan`); tiến độ sprint / tháng, tổng kết theo ban (suy ra từ MTL) | **Bảo mật** | Dữ liệu khác, dùng riêng | — | Như GĐ1 |
| Tệp "MTL bộ phận" xuất ra (hạng mục, ngày, đường găng, mốc, tên người phụ trách, danh sách tên nhân viên bộ phận) | **Bảo mật** | Dữ liệu khác + DLCN cơ bản (họ tên) | Nhân viên một bộ phận | — |
| Danh sách "Cập nhật nhanh" của từng người | Nội bộ | DLCN cơ bản (việc được giao) | < 500 | — |

### 2. Dòng dữ liệu

1. MTL trong PostgreSQL → API `mtl-sprint` / `my/sprint` → trình duyệt người dùng có quyền xem (cùng bộ lọc hiển thị `itemVisibleWhere` như GĐ1).
2. **[Bảo mật, rời hệ thống]** PMO / lãnh đạo bộ phận → `mtl-template.xlsx` → máy tính cá nhân → sửa → nhập lại qua "Nhập MTL bộ phận" (tệp tạm xoá ngay, lưu băm SHA-256).
3. Cập nhật % / ghi chú → `PATCH /api/items/:id`, bình luận → nhật ký hoạt động của hạng mục.

### 3. Rà năng lực (chỉ ghi thay đổi; mã không nêu thay đổi giữ nguyên trạng thái GĐ1)

| Mã | Trạng thái | Khuyến nghị cụ thể | Ưu tiên |
|---|---|---|---|
| GOV-01 | Một phần | Bổ sung vào quy chế: lãnh đạo bộ phận được tự nhập MTL bộ phận của bộ phận mình; PMO duyệt định kỳ; chỉ PMO đặt lại kế hoạch gốc (đã cưỡng chế trong mã) | Bắt buộc |
| GOV-02 | Chưa có | Như GĐ1 | Bắt buộc |
| GOV-03 | Một phần | Không đổi (không có tập dữ liệu lưu mới) | Nên có |
| GOV-04 | Một phần | Tệp xuất ghi dòng "Tài liệu BẢO MẬT, chỉ dùng nội bộ" ở đầu sheet và sheet Hướng dẫn (đã làm); nên thêm thuộc tính phân loại vào metadata tệp khi công ty có nhãn Office/MIP | Nên có |
| GOV-05 | Một phần | Luồng xuất / nhập lại ở mục 2; mỗi lần nhập lưu băm tệp, mỗi lần tải ghi nhật ký | Nên có |
| GOV-06 | N/A | Không chia sẻ ra ngoài tổ chức ở giai đoạn này | — |
| PRE-01 | Đầy đủ | Tải mẫu: PMO mọi bộ phận, lãnh đạo bộ phận chỉ bộ phận mình (máy chủ kiểm tra `deptLeaderIds`); nhân viên bị từ chối (đã có kiểm thử e2e) | Bắt buộc |
| PRE-02 | Một phần | Không đổi | Nên có |
| PRE-03 | Một phần | Không đổi — HTTPS khi truy cập từ máy khác; mã hoá ổ đĩa máy nhân viên lưu tệp MTL (BitLocker) | Bắt buộc |
| PRE-04 | Đầy đủ | Repo / seed / test chỉ dữ liệu giả (đã giữ: dự án mẫu DA, tên giả) | Bắt buộc |
| PRE-05 | Một phần | Tệp MTL bộ phận chỉ lưu trong thư mục dùng chung nội bộ của bộ phận; không gửi qua email / chat ngoài. Khi có DLP: chặn tệp `MTL-bo-phan-*.xlsx` ra ngoài miền công ty | Nên có |
| PRE-06 | Một phần | Phản hồi tải tệp `Cache-Control: no-store`; lãnh đạo bộ phận không đặt lại kế hoạch gốc, không đổi tên kế hoạch, không nhập MTL tổng / bộ phận khác; tên kế hoạch trùng kế hoạch khác loại bị từ chối | Bắt buộc |
| PRE-07 | Đầy đủ | API sprint chỉ trả trường hiển thị trên thẻ | Bắt buộc |
| DET-01 | Một phần | Thêm hành động nhật ký `MTL_TEMPLATE_EXPORT` (bộ phận, số dòng), `MTL_SPRINT_PLAN` (trước / sau) và `MTL_IMPORT` có `byDepartmentLeader`; giữ ≥ 12 tháng | Bắt buộc |
| DET-02 | N/A | Quy mô nhỏ | — |
| DET-03 | Nâng cao | Có thể cảnh báo khi một tài khoản tải mẫu MTL nhiều lần trong ngày | Nâng cao |
| DET-04 | Một phần | Không đổi | Nên có |
| DET-05 | Chưa có | Không đổi | Nâng cao |
| PRI-01 | N/A | Không phát sinh xử lý cần đồng ý mới (Viber vẫn tắt) | — |
| PRI-02 | Đầy đủ | "Cập nhật nhanh" chỉ hiện việc của chính người dùng (và việc chưa giao người của bộ phận nếu là lãnh đạo); tệp mẫu chỉ chứa nhân viên của đúng bộ phận | Bắt buộc |
| PRI-03 | Một phần | Không đổi | Nên có |
| PRI-04 | Chưa có | Bổ sung vào hồ sơ đánh giá tác động xử lý DLCN: tệp MTL bộ phận chứa họ tên nhân viên | Bắt buộc |
| RES-01 | Một phần | Không đổi | Bắt buộc |
| RES-02 | Một phần | Quy chế: tệp MTL bộ phận trên máy cá nhân xoá sau khi nhập lại; bản gốc nằm trong hệ thống | Nên có |
| RES-03 | Chưa có | Kịch bản sự cố thêm trường hợp lộ tệp MTL bộ phận | Bắt buộc |

### 4. Nghĩa vụ pháp lý phát sinh

Không phát sinh nghĩa vụ mới ngoài GĐ1. Cập nhật nội dung hồ sơ đánh giá tác động xử lý DLCN (Luật BVDLCN Đ21) cho luồng xuất tệp có họ tên nhân viên.

### 5. Khuyến nghị ưu tiên

1. [Bắt buộc] Quy chế (GOV-01): lãnh đạo bộ phận tự nhập MTL bộ phận; chỉ PMO đặt lại kế hoạch gốc; tệp MTL bộ phận chỉ lưu thư mục nội bộ và xoá khỏi máy cá nhân sau khi nhập.
2. [Bắt buộc] Bổ sung luồng xuất tệp vào hồ sơ đánh giá tác động xử lý DLCN (PRI-04).
3. [Nên có] Rà nhật ký `MTL_TEMPLATE_EXPORT` hằng tháng cùng đợt rà quyền thành viên dự án.

### 6. Rủi ro còn lại & câu hỏi mở

- Lãnh đạo bộ phận phối hợp có thể thêm dòng con vào bước do bộ phận khác chủ trì (cột "Thuộc bước"), làm tiến độ bước tổng tính theo dòng con đó. Mẫu chỉ gợi ý dòng con cho bước bộ phận chủ trì và hướng dẫn ghi rõ phải thống nhất với bên chủ trì; PMO rà khi duyệt.
- Mục tiêu % theo sprint dùng kế hoạch gốc tuyến tính — với hạng mục không đều (chờ cơ quan ngoài) có thể đặt mục tiêu chưa sát; cân nhắc trọng số / mốc trung gian ở GĐ sau.

## Đánh giá bảo vệ dữ liệu — Kepper Hub GĐ2b (Báo cáo tuần bộ phận theo mẫu BM-TH-01, tự điền từ MTL) — 23/10/2026

**Giả định:** như GĐ1 (on-prem, < 500 nhân viên, không có dữ liệu khách hàng, không có bí mật nhà nước). Mẫu BM-TH-01 do chủ dự án cung cấp; tên bộ phận thật trong mẫu KHÔNG đưa vào repo, seed dùng bộ phận giả có sẵn.
**Kết luận cổng: ĐẠT CÓ ĐIỀU KIỆN**. Có hai nhóm điều kiện:
- Các mục Bắt buộc còn mở từ GĐ1/GĐ2a: GOV-02, PRI-04, RES-01, RES-03.
- Quy chế giao ban (GOV-01) quy định: ai lập và nộp báo cáo, nơi dán bản tổng hợp, và không ghi chi tiết sức khoẻ/việc riêng vào lý do vắng.

Thay đổi về dữ liệu so với GĐ2a:
- **Bảng mới `WeeklyReport`**: mỗi bộ phận × tuần (thứ Sáu) một bản. Nội dung JSON gồm:
  - Phần I–III: hạng mục; mã hạng mục MTL nếu có; tình trạng; %; hạn; người phụ trách (lưu **id tài khoản**, không lưu họ tên tự gõ); nguyên nhân; giải pháp; đề nghị hỗ trợ từ ai, việc gì, trước ngày nào.
  - Phần IV: kiến nghị.
  - Người lập và người nộp (id), giờ nộp.
- **Bảng mới `WeeklyNotice`**: báo nộp muộn / vắng giao ban.
  - Lý do chọn trong danh sách (Công tác / Nghỉ phép / Việc đột xuất / Khác), kèm ghi chú ngắn ≤ 200 ký tự.
  - Giờ nộp dự kiến hoặc người dự thay chọn từ danh sách tài khoản.
  - Tự xoá sau 12 tháng.
- **Ghi ngược % vào MTL** khi nộp: chỉ với hạng mục người nộp có quyền sửa và không dùng checklist. Đi qua cùng đường cập nhật tiến độ như "Cập nhật nhanh", có nhật ký hoạt động của hạng mục.
- **Tổng hợp giao ban** (cập nhật 23/10): Ban GĐ, thư ký giao ban (bộ phận do Ban GĐ chọn) và PMO (do Ban GĐ chỉ định) xem chi tiết mọi bộ phận. Trưởng / phó bộ phận nhận bản tóm tắt như văn bản sao chép (QC-TH-01 Điều 5) và chi tiết của bộ phận mình. Nhân viên chỉ xem báo cáo bộ phận mình.
- **Nút "Sao chép bản tổng hợp"**: văn bản rời hệ thống qua clipboard. Dòng đầu ghi "BẢO MẬT – chỉ dùng nội bộ"; không chứa họ tên người phụ trách, chỉ có tên bộ phận. Mỗi lần sao chép ghi nhật ký `WEEKLY_SUMMARY_COPY`.
- Thông báo nhắc nộp 15:00 ngày hạn nộp và tóm tắt tổng hợp 07:35 ngày giao ban (chạy bù khi máy bật lại): chỉ trong ứng dụng, chưa qua Viber.

### 1. Phân loại

| Tập dữ liệu | Nhãn nội bộ | Phân loại pháp lý | Số chủ thể | Cấp độ HTTT |
|---|---|---|---|---|
| `WeeklyReport` (tình trạng, %, nguyên nhân chậm, giải pháp, đề nghị hỗ trợ của bộ phận; người phụ trách, người lập, người nộp) | **Bảo mật** (tiến độ dự án + đánh giá công việc) | Dữ liệu khác, dùng riêng + DLCN cơ bản (gắn việc với người) | < 500 | Như GĐ1 |
| `WeeklyNotice` (báo muộn / vắng, lý do, người dự thay) | Nội bộ, nâng lên **Bảo mật** vì ghi chú tự do có thể lộ tình trạng cá nhân | DLCN cơ bản. Nếu ai đó ghi lý do sức khoẻ thì là **DLCN nhạy cảm**, nên tối thiểu hoá bằng danh sách lý do | < 500 | — |
| Bản tổng hợp sao chép (văn bản) | **Bảo mật** | Dữ liệu khác; không có họ tên | — | — |

### 2. Dòng dữ liệu

1. MTL (PostgreSQL) → `GET /api/weekly` tính sẵn Phần I–III cho bộ phận → trình duyệt của thành viên bộ phận.
2. Thành viên sửa → tự lưu nháp `PUT /api/weekly` → `WeeklyReport` (DRAFT).
3. Nộp `POST /api/weekly/submit`:
   - Máy chủ kiểm tra lại toàn bộ; nộp được ghi nhật ký `WEEKLY_REPORT_SUBMIT`.
   - % được ghi ngược vào `WorkItem` (nhật ký hoạt động `PROGRESS`).
4. Báo muộn / vắng `POST /api/weekly/notices` → `WeeklyNotice` → nhật ký `WEEKLY_NOTICE`.
5. **[Bảo mật]** Ban GĐ / thư ký / PMO → `GET /api/weekly/summary` (chi tiết) → màn hình Tổng hợp; trưởng / phó → bản tóm tắt.
6. **[Bảo mật, rời hệ thống]** "Sao chép bản tổng hợp" → clipboard → email / nhóm chat. Đây là chặng rủi ro nhất: Viber/Zalo lưu máy chủ ngoài công ty, có thể ở nước ngoài.

### 3. Rà năng lực (chỉ ghi thay đổi; mã không nêu thay đổi giữ nguyên trạng thái GĐ2a)

| Mã | Trạng thái | Khuyến nghị cụ thể | Ưu tiên |
|---|---|---|---|
| GOV-01 | Một phần | Ban hành quy chế giao ban kèm mẫu BM-TH-01, gồm 4 nội dung:<br>• Trưởng bộ phận chịu trách nhiệm; người được giao lập và nộp thay.<br>• Hạn nộp 17:30 thứ Sáu, muộn nhất 12:00 thứ Bảy.<br>• Bản tổng hợp chỉ dán vào email công ty hoặc nhóm chat được phê duyệt.<br>• Không ghi chi tiết sức khoẻ / việc riêng vào lý do vắng. | Bắt buộc |
| GOV-02 | Chưa có | Như GĐ1. Thêm: Phòng Tổng hợp & Nhân sự (hoặc PMO) là đầu mối dữ liệu giao ban | Bắt buộc |
| GOV-03 | Một phần | Ghi 2 bảng mới vào danh mục dữ liệu (README mục Dữ liệu) | Nên có |
| GOV-04 | Một phần | Gắn nhãn "BẢO MẬT" trên màn hình Tổng hợp và dòng đầu văn bản sao chép (đã làm) | Nên có |
| GOV-05 | Một phần | Dòng dữ liệu ở mục 2; % ghi ngược vào MTL có nhật ký hoạt động để truy vết nguồn | Nên có |
| GOV-06 | N/A | Không chia sẻ ra ngoài tổ chức | — |
| PRE-01 | Đầy đủ | Cưỡng chế bằng `lib/policy.js` (ma trận ở mục rà soát 23/10):<br>• Lập / nộp: chỉ thành viên đúng bộ phận; thư ký nhập thay.<br>• Xem chi tiết bộ phận khác: Ban GĐ / thư ký / PMO chỉ định.<br>• Ghi ngược %: chỉ hạng mục người nộp có quyền `mtl.progress`, MTL chưa đổi từ lúc điền sẵn, không áp dụng khi nhập thay. | Bắt buộc |
| PRE-02 | Một phần | Không đổi | Nên có |
| PRE-03 | Một phần | Không đổi — HTTPS khi truy cập từ máy khác | Bắt buộc |
| PRE-04 | Đầy đủ | Seed / test chỉ dữ liệu giả; không đưa tên bộ phận thật của mẫu vào repo | Bắt buộc |
| PRE-05 | Một phần | Clipboard không chặn được bằng ứng dụng. Có DLP thì chặn chuỗi "BẢO MẬT – chỉ dùng nội bộ" ra miền ngoài | Nên có |
| PRE-06 | Một phần | • Người phụ trách và người dự thay là id tài khoản, không phải chữ tự do.<br>• Lý do vắng chọn theo danh sách.<br>• Bản sao chép không có họ tên. | Bắt buộc |
| PRE-07 | Đầy đủ | API chỉ trả trường cần cho biểu mẫu; Tổng hợp chỉ trả tên hiển thị, không trả email / điện thoại | Bắt buộc |
| DET-01 | Một phần | Thêm nhật ký `WEEKLY_REPORT_SUBMIT` (bộ phận, tuần, số hạng mục, số % ghi ngược), `WEEKLY_NOTICE`, `WEEKLY_SUMMARY_COPY`; giữ ≥ 12 tháng | Bắt buộc |
| DET-02 | N/A | Quy mô nhỏ | — |
| DET-03 | Nâng cao | Có thể cảnh báo khi một tài khoản sao chép tổng hợp nhiều lần | Nâng cao |
| DET-04 | Một phần | Không đổi | Nên có |
| DET-05 | Một phần | Cập nhật 23/10: mỗi lần nộp lưu phiên bản bất biến kèm SHA-256 (`WeeklyReportVersion`); `AuditLog` và bảng phiên bản bị trigger chặn sửa / xoá. Còn thiếu: ký số, lưu WORM ngoài máy | Nên có |
| PRI-01 | N/A | Không phát sinh xử lý cần đồng ý mới (Viber vẫn tắt) | — |
| PRI-02 | Đầy đủ | Bộ phận chỉ thấy báo cáo của mình; Tổng hợp không có cột "người lập" trong văn bản sao chép | Bắt buộc |
| PRI-03 | Một phần | Không đổi | Nên có |
| PRI-04 | Chưa có | Bổ sung vào hồ sơ đánh giá tác động xử lý DLCN: báo cáo tuần gắn việc với người, thông báo vắng | Bắt buộc |
| RES-01 | Một phần | Không đổi (2 bảng mới nằm trong cùng cơ sở dữ liệu được sao lưu) | Bắt buộc |
| RES-02 | Một phần | `WeeklyNotice` tự xoá sau 12 tháng; `WeeklyReport` giữ như hồ sơ công việc (đề xuất 5 năm, chờ quy chế lưu trữ) | Nên có |
| RES-03 | Chưa có | Kịch bản sự cố thêm trường hợp bản tổng hợp bị dán nhầm ra nhóm ngoài | Bắt buộc |

### 4. Nghĩa vụ pháp lý phát sinh

Không phát sinh nghĩa vụ mới ngoài GĐ1. Hồ sơ đánh giá tác động xử lý DLCN (Luật BVDLCN Đ21) cần bổ sung hai luồng: báo cáo tuần và thông báo vắng. Nếu sau này gửi bản tổng hợp qua Viber/Zalo tự động, đó là chuyển DLCN cho bên thứ ba, có thể xuyên biên giới. Khi đó phải có hồ sơ đánh giá tác động chuyển DLCN ra nước ngoài (Đ20) trước khi bật.

### 5. Khuyến nghị ưu tiên

1. [Bắt buộc] Quy chế giao ban (GOV-01): người lập, hạn nộp, nơi dán bản tổng hợp, lý do vắng không ghi chi tiết sức khoẻ.
2. [Bắt buộc] Bổ sung báo cáo tuần và thông báo vắng vào hồ sơ đánh giá tác động xử lý DLCN (PRI-04).
3. [Nên có] Hằng tháng rà nhật ký `WEEKLY_SUMMARY_COPY`, cùng đợt rà `MTL_TEMPLATE_EXPORT`.
4. [Nâng cao] Băm từng lần nộp nếu báo cáo tuần là căn cứ KPI (DET-05).

### 6. Rủi ro còn lại & câu hỏi mở

- Báo cáo nộp xong vẫn nộp lại được đến giờ họp (08:30 thứ Hai); sau đó chỉ thư ký mở lại. Mỗi lần nộp là một phiên bản có băm (cập nhật 23/10).
- % ghi ngược: chỉ ghi khi % MTL vẫn bằng % lúc điền sẵn; nếu MTL đã đổi thì bỏ qua và báo xung đột. Hạng mục dùng checklist hoặc có việc con thì không ghi ngược.
- Danh sách bộ phận phải nộp được tính tự động: bộ phận chủ trì ít nhất một hạng mục MTL đang chạy, cộng bộ phận đã nộp. Bộ phận không có MTL nhưng vẫn phải báo cáo (vd. Tổng hợp & Nhân sự) cần một thiết lập riêng. Cập nhật 23/10: Ban GĐ / thư ký chọn danh sách bộ phận phải nộp ở Thiết lập; danh sách được chụp theo từng tuần để chấm điểm không đổi khi thiết lập đổi.


## Rà soát độc lập GĐ2b và quy định phân quyền dữ liệu (23/10/2026)

Ba subagent rà độc lập, chỉ đọc mã: (1) luồng nghiệp vụ so với QC-TH-01 / QT-TH-01, (2) bảo mật và phân quyền (AI, dữ liệu, dự án, vai trò), (3) khung hệ thống kỹ thuật theo checklist phản biện. Phát hiện mức Chặn / Cao đã sửa trong mã. Các điểm thuộc quyền quyết định của chủ dự án được liệt kê riêng.
**Kết luận cổng: ĐẠT CÓ ĐIỀU KIỆN.** Điều kiện gồm các mục Bắt buộc còn mở của GĐ1–GĐ2b và 4 quyết định ở cuối mục này.

### Quy định phân quyền dữ liệu — thực thi bằng mã

Nguồn duy nhất là `app/server/src/lib/policy.js`. `lib/policy.test.js` kiểm từng ô ma trận, nên đổi quyền mà không sửa test thì test hỏng.

Vai trò giao ban **suy ra** từ vai trò và phòng ban đã gán cho tài khoản, cộng hai lựa chọn của Ban GĐ (bộ phận thư ký, danh sách PMO). Không có quyền mới nào được cấp cho từng tài khoản, và luồng đăng nhập không đổi.

| Tập dữ liệu (nhãn) | IT | Ban GĐ | Thư ký | PMO (chỉ định) | Trưởng / phó | Nhân viên |
|---|---|---|---|---|---|---|
| Báo cáo tuần bộ phận mình (Bảo mật) | — | xem (không lập) | lập, nộp | xem | lập, nộp | lập, nộp |
| Báo cáo tuần bộ phận khác | — | xem bản đã nộp | xem, nhập thay (không ghi % MTL) | xem bản đã nộp | — | — |
| Tổng hợp tóm tắt (như văn bản sao chép, không họ tên) | — | xem, sao chép | xem, sao chép | xem, sao chép | xem, sao chép (Điều 5) | — |
| Tổng hợp chi tiết (mọi báo cáo, người nộp, ghi chú vắng) | — | xem | xem | xem | chỉ bộ phận mình | — |
| Thông báo muộn / vắng | — | xem mọi bộ phận | xem, nhập hộ (giờ nhận tin), xoá | xem | xem bộ phận mình, tạo | tạo, xoá của mình |
| Ghi chú lý do vắng | — | xem | xem | — | — | chỉ người tạo |
| Giao ban (điểm danh, kết luận, Action Log, tuần nghỉ) | — | sửa (TGĐ kết luận) | sửa | xem | xem | — |
| Bảng điểm tuân thủ | — | xem, duyệt và khoá | xem, lập, trình | — | — | — |
| Thiết lập giao ban | — | sửa | sửa | xem | xem | — |
| Vai trò giao ban (bộ phận thư ký, PMO) | — | sửa | — | — | — | — |
| % tiến độ / checklist hạng mục MTL | — | khi là người quản lý dự án | như nhân viên | khi là người quản lý dự án | lãnh đạo bộ phận chủ trì | người được giao |
| Kế hoạch hạng mục MTL (tên, găng, mốc, đầu mối) | — | người quản lý dự án | | | | |
| KPI cá nhân | — | xem | — | — | bộ phận mình | của mình |

**Quy tắc bắt buộc đã có trong mã:**
- **QĐ-01** Quản trị IT không có quyền nào trên dữ liệu nghiệp vụ.
- **QĐ-AI** AI tắt mặc định (`AI_ENABLED`). Khi bật, chỉ gửi bản tổng hợp tóm tắt, do Ban GĐ / thư ký. Không bao giờ gửi: KPI cá nhân, thông báo vắng, bảng điểm, báo cáo chi tiết, kế hoạch / % MTL.
- **QĐ-EXT** Gửi ra ngoài (mail / Teams / Viber): chỉ bản tóm tắt, do thư ký / Ban GĐ. KPI cá nhân, thông báo vắng, báo cáo chi tiết không bao giờ rời hệ thống.
- **Một nguồn sự thật cho %:**
  - việc cha tổng hợp từ việc con, việc có checklist tính theo checklist; nhập tay vào hai loại này bị từ chối (422);
  - báo cáo tuần chỉ ghi % khi MTL chưa đổi kể từ lúc điền sẵn;
  - nhập thay không ghi % vào MTL.
- **Bằng chứng:**
  - mỗi lần nộp lưu một phiên bản bất biến kèm SHA-256 (`WeeklyReportVersion`);
  - `AuditLog` và `WeeklyReportVersion` chỉ được ghi thêm (trigger chặn UPDATE / DELETE / TRUNCATE);
  - nhật ký ghi `receivedAt` khi nhập thay.
- **Thời hạn lưu:** thông báo vắng và thông báo trong ứng dụng giữ 12 tháng; thông báo chỉ mang nhãn lý do, không mang ghi chú.

**Đã sửa theo các rà soát (trích):**
- **Chặn:**
  - tự nâng quyền PMO bằng cách tự tạo dự án MTL → PMO giờ do Ban GĐ chỉ định;
  - ghi % chéo bộ phận qua báo cáo tuần hoặc `PATCH` → áp policy `mtl.progress` / `mtl.plan`;
  - gửi lại báo cáo đè % mới bằng số cũ → kiểm `pct0`;
  - sao lưu báo "xong" khi `pg_dump` lỗi rồi xoá bản cũ → kiểm lỗi từng bước, chỉ dọn khi bản mới đạt, ghi `LAST_OK`.
- **Cao:**
  - trưởng / phó đọc báo cáo và ghi chú của bộ phận khác → chỉ nhận bản tóm tắt;
  - hai người sửa cùng bản nháp → trả 409;
  - bỏ được hạng mục bắt buộc;
  - chấm điểm dùng danh sách bộ phận hiện tại cho các tuần cũ → chụp danh sách theo từng tuần;
  - thiếu cờ tuần nghỉ;
  - bảng điểm thiếu bước trình / duyệt / khoá;
  - phát hành khi còn yêu cầu chưa kết luận;
  - Action Log không có người phụ trách và chỉ rà một tuần;
  - job lỗi làm dừng máy chủ, máy tắt thì mất job → lập lịch có chạy bù.
- **Trung bình / Thấp:**
  - "Quá hạn" tính từ hạn **trước** thứ Sáu báo cáo;
  - báo vắng sau 17:30 chỉ được miễn trừ khi là "Việc đột xuất";
  - đi muộn bị trừ độc lập với báo vắng;
  - bắt buộc nhập "cần trước ngày" và "sản phẩm đầu ra";
  - tên người hiển thị qua `esc()`;
  - `jwt.verify` trong bộ giới hạn tần suất;
  - Prisma `errorFormat: 'minimal'`;
  - `bcrypt` bất đồng bộ;
  - xoay vòng log Docker, tag image theo phiên bản;
  - CI (unit, kiểm migration, `npm audit`, e2e);
  - nâng `compression` lên 1.8.2 (lỗ hổng mức cao).

**Chờ chủ dự án quyết** (mã chưa đổi vì thuộc tiêu chí đăng nhập / phạm vi dữ liệu đã chốt trước):
1. **Đăng nhập:**
   - giới hạn số lần sai và mật khẩu tạm ngẫu nhiên thay `12345678`;
   - hoặc đăng nhập bằng tài khoản Microsoft 365 (Entra ID, có MFA).
2. **Phạm vi MTL:** hiện mặc định "dùng chung toàn công ty" (GĐ1) → có chuyển sang "chỉ thành viên" cho dữ liệu Bảo mật không.
3. **Triển khai:**
   - chuyển từ PC cá nhân sang máy chủ / VM luôn bật, có reverse proxy TLS;
   - sao lưu mã hoá đặt ngoài máy, thử khôi phục hằng quý;
   - đề xuất cấp độ HTTT 2 (không phải cấp 4) — cần tra văn bản hiện hành.
4. **Quản trị IT:** báo Ban GĐ mỗi khi admin IT cấp quyền nghiệp vụ hoặc tạo tài khoản quản lý (thuộc luồng cấp quyền).

## Vòng lặp rà soát – sửa bằng AI (24/10/2026)

Quy trình: các agent độc lập rà mã (chỉ đọc) → sửa → agent mới rà lại bản sửa. Lặp cho tới khi không còn mục Chặn / Cao sửa được bằng mã. Mỗi vòng gồm hai hướng: khung kỹ thuật (checklist /pha) và bảo mật / phân quyền (tìm đường vượt `lib/policy.js`).

### Vòng 1 — phát hiện chính và cách sửa

| Mức | Phát hiện | Đã sửa |
|---|---|---|
| Chặn | Tạo việc trong dự án MTL (POST việc, ghi chú → việc, nhập Excel, áp mẫu, chia việc nhánh) không qua policy. Nhân viên bộ phận A thêm việc con 100% vào hạng mục của B, đẩy % / KPI của B lên | `services/mtl-guard.js` — một cổng cho mọi đường ghi MTL:<br>• chỉ quản lý dự án tạo hạng mục;<br>• lãnh đạo bộ phận chủ trì thêm việc con dưới hạng mục bộ phận mình;<br>• máy chủ bỏ % / trọng số / găng / mốc / trạng thái do người khác gửi;<br>• nhập hàng loạt chỉ quản lý dự án. |
| Chặn | PATCH đổi người được giao / việc cha / bộ phận chủ trì của hạng mục bộ phận khác (tự thành "người được giao" rồi ghi %) | Đổi cấu trúc = quản lý dự án. Phân công = quản lý dự án hoặc lãnh đạo bộ phận chủ trì. Hạn / ngày bắt đầu MTL là kế hoạch. |
| Cao | Báo cáo tiến độ (luồng cũ) ghi thẳng % vào MTL, không qua policy / một nguồn % | Qua `mtl-guard` + `setProgress`, có khoá theo hạng mục |
| Cao | Tự lưu nháp ghi đè bản vừa nộp; hai lần nộp đồng thời ghi % mà không có phiên bản | Khoá theo bộ phận / tuần cho nháp và nộp. Ghi % trong cùng transaction với bản nộp và phiên bản. |
| Cao | Kết luận TGĐ bị thay bằng bản cũ khi thư ký lưu Action Log; phát hành hai lần | Khoá theo tuần. Gộp kết luận theo từng yêu cầu. Action Log kiểm phiên bản. Phát hành kiểm trong khoá. |
| Cao | PMO đọc ghi chú lý do vắng (có thể là DLCN nhạy cảm) | Chỉ Ban GĐ / thư ký (policy `weekly.notice · note`) |
| Cao | Bộ phận A đóng được việc Action Log của bộ phận B bằng `actionRef` | Chỉ báo cáo đúng bộ phận được giao; máy chủ bỏ `actionRef` lạ |
| Cao | Khôi phục đè thẳng lên CSDL đang dùng, lỗi giữa chừng hỏng cả hai | Khôi phục vào CSDL mới rồi đổi tên. Chặn khi còn kết nối. Có chế độ thử `RESTORE_TEST`. |
| Cao | `JWT_SECRET` mẫu vẫn được chấp nhận | Máy chạy từ chối khoá mẫu / ngắn hơn 32 ký tự |
| Cao | Admin IT tự đổi tài khoản mình sang Ban GĐ | Không tự đổi nhóm tài khoản của chính mình. Đổi sang Ban GĐ vẫn báo Ban GĐ (đã có). |
| TB | Trưởng / phó phòng sở hữu dự án MTL có toàn quyền kế hoạch, KPI cả dự án; bất kỳ trưởng phòng nào tạo được dự án MTL | Quản lý dự án MTL = quyền toàn công ty / OWNER / trưởng dự án. Tạo dự án MTL: Ban GĐ / PMO chỉ định. |
| TB | PMO suy ra từ quyền xem tổng hợp; Ban GĐ kiêm thư ký tự trình rồi tự duyệt | PMO theo danh sách Ban GĐ (chưa chọn thì tạm dùng quyền cũ). Ban GĐ không kiêm thư ký. |
| TB | Bảng điểm duyệt được khi tháng chưa khép, không gắn với bảng đã trình | Chỉ lập / duyệt khi tháng đã khép. Duyệt kèm SHA-256 bảng đã trình. Khoá CSDL. |
| TB | Báo vắng "đặt trước" cho cả năm để né trừ điểm; người dự thay bộ phận khác | Chỉ tuần hiện tại; người dự thay cùng bộ phận |
| TB | SHA-256 phiên bản không kiểm lại được (JSONB đổi thứ tự khoá) | Băm trên JSON chuẩn hoá |
| TB | Xuất Excel / Word / mẫu MTL không qua policy | Luật `export` cho `mtl.plan` / `mtl.progress` |
| TB | Job lỗi không thử lại; hai tiến trình chạy trùng; tắt máy giữa job gửi đôi | Nhận việc nguyên tử (khoá + trạng thái "running"), thử lại 3 lần, `ops_check` báo job treo |
| TB | Sao lưu đánh dấu "đã chạy" trước khi chạy; chép "ngoài máy" vào chính nó; không kiểm ổ trống | Chỉ đánh dấu khi đạt, thử lại 3 lần / ngày, phát hiện thư mục trùng, kiểm ổ trống |
| TB | Không có nhật ký truy cập hệ thống ≥ 12 tháng | `./logs/access-*.jsonl`, giữ 400 ngày, không ghi nội dung |
| TB | Tin `X-Forwarded-For` của mọi IP nội bộ (giả IP trong nhật ký) | `TRUST_PROXY` mặc định không tin; sau proxy đặt `1` |
| TB | Dừng máy chủ cắt ngang lần nộp; nhập MTL lớn quá 5 giây; tệp Excel định dạng cả cột chặn máy chủ | Dừng êm 15 giây, timeout 120 giây, giới hạn 3.000 dòng / 40 cột |
| Thấp | Trigger chưa chặn TRUNCATE bảng phiên bản; audit thiết lập giao ban lộ cho IT; SSE không giới hạn, gọi lại vô hạn khi 401; lệch giờ máy chủ | Đã sửa. Thêm cảnh báo lệch giờ ≥ 3 phút. |

Chờ chủ dự án quyết (không đổi trong mã):
- đăng nhập (giới hạn sai / SSO Entra ID);
- MTL mặc định PUBLIC;
- máy chủ + TLS + NTP;
- tách role CSDL (ứng dụng đang dùng superuser nên vẫn tắt được trigger);
- báo Ban GĐ khi admin IT cấp quyền nghiệp vụ.

## GĐ3 — AI native: Claude dùng đúng quyền người dùng (24/10/2026)

**Quyết định của chủ dự án.** Mọi người được dùng AI trong công việc. Bỏ quy định cũ "AI tắt mặc định / chỉ gửi bản tóm tắt". AI duy nhất được dùng là Claude, qua tài khoản Claude Team công ty cấp. Không xây AI riêng.

**Kết luận cổng:** ĐẠT CÓ ĐIỀU KIỆN. Điều kiện bắt buộc: hồ sơ đánh giá tác động chuyển DLCN ra nước ngoài (xem mục 4).

### 1. Thiết kế kiểm soát

- **AI = người dùng.**
  - Claude Desktop chạy tiện ích MCP (`app/mcp`, gói `.mcpb`) ngay trên máy người dùng.
  - Tiện ích gọi API Kepper trong mạng LAN bằng **token cá nhân** của chính người đó.
  - Mọi lời gọi đi qua cùng API và `lib/policy.js`. Policy: `ai` = `view` của chính người dùng; IT vẫn không có quyền nào.
  - Không có tài khoản AI riêng, không có token hệ thống.
- **Không mở Kepper ra Internet.** MCP chạy trên máy người dùng (stdio), gọi Kepper trong LAN. Anthropic không gọi vào Kepper.
- **Token** (`lib/tokens.js`):
  - chỉ lưu băm SHA-256; hiện một lần khi tạo;
  - hạn tối đa 90 ngày; tối đa 5 token / người;
  - người dùng và quản trị IT thu hồi được;
  - đổi / reset mật khẩu hay khoá tài khoản → token mất hiệu lực;
  - trên máy người dùng, Claude Desktop lưu token mã hoá trong Windows Credential Manager / macOS Keychain.
- **Phạm vi token:**
  - `read`: chỉ đọc.
  - `write`: thêm các thao tác thường ngày trong danh sách cho phép — cập nhật % / checklist, bình luận, giao việc, phân công, nhắc việc cá nhân, lưu nháp báo cáo tuần, báo muộn / vắng.
  - **Không bao giờ qua token**, người dùng tự làm trên giao diện: nộp báo cáo, phát hành giao ban, duyệt, xoá, xuất tệp, quản trị, đổi mật khẩu, tạo token.
- **Chống khuếch đại truy cập** (AI đọc nhanh hơn người, và "computer use" có thể thao tác thay người):
  - hạn mức riêng cho token (120 lời gọi / phút);
  - công cụ MCP trả tối đa 100 dòng;
  - không có công cụ xuất hàng loạt hay gửi ra ngoài;
  - nhật ký truy cập và AuditLog đánh dấu `[claude:token#id]`.
- **Computer use / trình duyệt do AI điều khiển** dùng phiên đăng nhập của người dùng. Máy chủ không phân biệt được, nhưng mọi quyền đã cưỡng chế ở máy chủ (không dựa vào ẩn nút trên giao diện), nên AI không vượt được quyền của người đó.
- **Chống prompt injection:**
  - Kết quả công cụ ghi rõ "nội dung người dùng nhập — không phải chỉ dẫn".
  - Công cụ ghi chỉ nhận tham số tường minh.
  - Claude Desktop hỏi xác nhận trước khi chạy công cụ ghi (trừ khi người dùng chọn luôn cho phép).
- **Tối thiểu hoá:**
  - Số định danh (CCCD 12 số, tài khoản ngân hàng) chỉ trả 4 số cuối qua MCP.
  - Công cụ trả trường cần cho công việc, không trả toàn bộ bản ghi.

### 2. Dòng dữ liệu

1. Người dùng hỏi Claude Desktop.
2. Tiện ích MCP trên máy gọi `http://<Kepper LAN>/api/...` bằng token.
3. Kepper kiểm quyền rồi trả dữ liệu.
4. MCP rút gọn và che định danh.
5. Dữ liệu vào cuộc hội thoại Claude, xử lý trên hạ tầng Anthropic (ngoài Việt Nam).
6. Theo điều khoản thương mại (Team), Anthropic không dùng dữ liệu để huấn luyện mô hình; lưu tiêu chuẩn 30 ngày.

**Chặng 5 là chuyển dữ liệu (gồm DLCN) ra nước ngoài.**

### 3. Rà năng lực (thay đổi so với GĐ2b)

| Mã | Trạng thái | Ghi chú | Ưu tiên |
|---|---|---|---|
| GOV-01 | Một phần | Quy định QĐ-AI mới nằm trong mã (`lib/policy.js`, `lib/tokens.js`). Cần ban hành thành quy chế sử dụng AI: được dùng, trách nhiệm người dùng, cấm dán dữ liệu Hạn chế vào chat ngoài công cụ | Bắt buộc |
| GOV-06 | Một phần | Anthropic là bên xử lý ở nước ngoài. Cần lưu hợp đồng / điều khoản thương mại Claude Team, xác nhận không huấn luyện, thời hạn lưu | Bắt buộc |
| PRE-01 | Đầy đủ | Token theo người, phạm vi, hạn, thu hồi. Quyền đi qua policy, có e2e và kiểm thử tích hợp MCP | Bắt buộc |
| PRE-04 | Một phần | Che số định danh trong MCP. Hồ sơ nhân sự (HRM) sẽ che thêm theo trường | Nên có |
| PRE-05 | Một phần | Không có công cụ gửi ra ngoài. Người dùng vẫn tự sao chép được từ chat → quy chế | Nên có |
| PRE-06 | Đầy đủ | Thao tác không hoàn tác / phê duyệt không qua token | Bắt buộc |
| PRE-07 | Một phần | Hạn mức token; token chỉ ở LAN | Bắt buộc |
| DET-01 | Một phần | AuditLog và nhật ký truy cập đánh dấu thao tác qua Claude. Admin xem danh sách token, lần dùng, IP | Bắt buộc |
| DET-03 | Chưa có | Nên cảnh báo khi một token đọc dồn bất thường (vd. > 500 hạng mục / giờ) | Nên có |
| PRI-04 | Chưa có | **Hồ sơ đánh giá tác động chuyển DLCN ra nước ngoài** (Claude / Anthropic) | **Bắt buộc** |
| RES-03 | Một phần | Kịch bản sự cố: lộ token / máy mất → thu hồi token, đổi mật khẩu, rà nhật ký `[claude:token#]` | Bắt buộc |

### 4. Nghĩa vụ pháp lý (soát lại với Công báo trước khi trích dẫn chính thức)

- **Chuyển DLCN ra nước ngoài** (dữ liệu nhân viên, người phụ trách, đối tác trong nội dung hỏi Claude):
  - lập và lưu hồ sơ đánh giá tác động chuyển DLCN ra nước ngoài (Luật BVDLCN Điều 20; Luật Dữ liệu Điều 23; NĐ 165/2025 Điều 12);
  - thông báo cho người lao động về việc xử lý bằng AI.
- **AI trong công việc** (Luật Trí tuệ nhân tạo 134/2025 Điều 7): kiểm soát dữ liệu AI truy cập → đã có bằng policy và token theo người.
- **Sự cố DLCN** (lộ token, gửi nhầm dữ liệu): thông báo ≤ 72 giờ (Luật BVDLCN Điều 23).

## Playground CRM đối tác + HRM (hồ sơ, hợp đồng, nghỉ phép, chấm công) — 24/10/2026

**Phạm vi.** Module tuỳ chọn, MẶC ĐỊNH TẮT (`MODULES=crm,hrm`). Chạy trước trên **bản thử riêng** (cổng 4200, CSDL riêng, dữ liệu mẫu GIẢ — `deploy/playground.ps1`); bản đang chạy (4100) không có module này cho tới khi Ban GĐ duyệt.
- CRM: đối tác B2B của dự án bất động sản — nhà thầu, tư vấn, cơ quan quản lý, ngân hàng, nhà cung cấp. Không có khách hàng cá nhân (người mua nhà).
- HRM: hồ sơ, hợp đồng lao động, nghỉ phép, chấm công. **Không** tính lương, không bảo hiểm, không sinh trắc học.
- Quy mô: ~40 người lao động; hệ thống thông tin cấp độ 2 (theo chủ dự án).

**Giả định** (chưa có xác nhận của bộ phận nhân sự / pháp chế): bảng công dùng làm căn cứ tính lương ở hệ thống khác; máy chấm công vân tay / thẻ (nếu có) giữ dữ liệu sinh trắc trên thiết bị, Kepper chỉ nhận giờ.

**Kết luận cổng:** ĐẠT CÓ ĐIỀU KIỆN cho bản thử (dữ liệu giả). **CHƯA ĐẠT** để bật trên bản chạy thật cho tới khi có: (1) thông báo xử lý DLCN cho người lao động; (2) chỉ định người phụ trách nhân sự trên hệ thống và người chịu trách nhiệm bảo vệ DLCN; (3) thời hạn lưu hồ sơ người đã nghỉ việc; (4) quản lý khoá `HR_ENC_KEY` ngoài máy chạy; (5) hồ sơ đánh giá tác động chuyển DLCN ra nước ngoài (GĐ3) bổ sung dữ liệu nhân sự / đối tác.

### 1. Phân loại

| Tập dữ liệu | Nhãn nội bộ | Phân loại pháp lý | Số chủ thể | Ghi chú |
|---|---|---|---|---|
| `crm.partner` (tên, loại, MST, địa chỉ, tổng đài tổ chức) | Nội bộ | Dữ liệu khác (tổ chức) | — | Mọi cán bộ xem để phối hợp; nhận xét nội bộ chỉ bộ phận phụ trách |
| `crm.contact` (họ tên, chức danh, điện thoại, email công việc người của đối tác) | Bảo mật | DLCN cơ bản | vài trăm | Không ghi số định danh, địa chỉ nhà riêng |
| `crm.interaction` (nhật ký làm việc, việc theo dõi) | Bảo mật | DLCN cơ bản; bí mật kinh doanh | — | Nhật ký không sửa / xoá |
| `crm.engagement` (hợp đồng, gói thầu, MOU, hồ sơ cấp phép, giá trị) | Bảo mật | Bí mật kinh doanh | — | Chỉ lãnh đạo bộ phận phụ trách, người phụ trách, Ban GĐ |
| `hrm.profile` (mã NV, ngày vào, trạng thái; riêng tư: ngày sinh, giới tính, liên hệ, địa chỉ, người liên hệ khẩn cấp, học vấn) | Bảo mật | DLCN cơ bản (cả người thân: họ tên + điện thoại khẩn cấp) | ~40 + người thân | Lãnh đạo bộ phận chỉ thấy trường cơ bản |
| `hrm.identity` (số CCCD, ngày / nơi cấp) | **Hạn chế** | DLCN cơ bản — rủi ro mạo danh cao | ~40 | Mã hoá AES-256-GCM theo trường; chỉ chính người đó + người phụ trách nhân sự |
| `hrm.contract` (hợp đồng lao động, **lương**) | **Hạn chế** | DLCN cơ bản + tài chính cá nhân | ~40 | Lương mã hoá theo trường; không bao giờ gửi Claude |
| `hrm.leave` (đơn nghỉ) | Bảo mật; **nghỉ ốm / thai sản = Hạn chế** | DLCN cơ bản; loại nghỉ ốm / thai sản tiết lộ **tình trạng sức khoẻ → DLCN nhạy cảm** | ~40 | Lý do ≤ 200 ký tự, giao diện nhắc không ghi chẩn đoán |
| `hrm.attendance` (giờ vào / ra, IP, đi muộn, giải trình) | Bảo mật | DLCN cơ bản (IP là dữ liệu vị trí gián tiếp) | ~40 | IP xoá sau 90 ngày |
| `hrm.config` | Nội bộ | Dữ liệu khác | — | Người phụ trách nhân sự do Ban GĐ chỉ định |

Số chủ thể rất thấp so với ngưỡng "dữ liệu quan trọng / cốt lõi" (QĐ 20/2025/QĐ-TTg) → không phát sinh nghĩa vụ của dữ liệu quan trọng; vẫn đủ nghĩa vụ DLCN (cơ bản + nhạy cảm).

### 2. Dòng dữ liệu

```
Người dùng (trình duyệt, LAN) ──► Kepper API ──► lib/policy.js (crm.* / hrm.*) ──► PostgreSQL (CCCD, lương: bản mã) ──► bản sao lưu (age)
                                                       │
Claude Desktop (máy người dùng) ─ MCP + token ──►──────┘   trả về: CCCD 4 số cuối; KHÔNG lương; đơn của người khác:
        │                                                  nghỉ ốm / thai sản → "Nghỉ theo chế độ", không lý do
        └──► Anthropic (ngoài Việt Nam) — chặng chuyển DLCN ra nước ngoài (GĐ3)
Máy chấm công ──CSV (mã NV, ngày, giờ)──► người phụ trách nhân sự ──► Kepper (không nhận dữ liệu sinh trắc)
```

### 3. Thiết kế kiểm soát

- **Quyền theo dữ liệu, cưỡng chế ở máy chủ** (`lib/policy.js`, kiểm từng ô trong `policy-playground.test.js`; IT không có quyền nào):
  - CRM: mỗi đối tác thuộc **một bộ phận phụ trách** + người phụ trách. Danh bạ tổ chức mọi cán bộ xem; người liên hệ / nhật ký / hợp đồng chỉ bộ phận phụ trách, người phụ trách, Ban GĐ; người được giao việc theo dõi chỉ thấy dòng của mình. Giá trị hợp đồng: lãnh đạo bộ phận phụ trách, người phụ trách, Ban GĐ. Chuyển bộ phận / ngừng theo dõi: lãnh đạo bộ phận, Ban GĐ.
  - HRM: **người phụ trách nhân sự do Ban GĐ chỉ định** (không suy từ phòng ban — chống tự nâng quyền; Ban GĐ không tự chỉ định mình). Người phụ trách nhân sự **không tự sửa** hồ sơ / hợp đồng / lương / CCCD / chấm công của chính mình — Ban GĐ làm. Đơn nghỉ của Ban GĐ: Ban GĐ khác hoặc người phụ trách nhân sự ghi nhận. Hồ sơ: chính người đó, người phụ trách nhân sự, Ban GĐ; lãnh đạo bộ phận chỉ trường cơ bản người trong bộ phận. Số CCCD: chính người đó + người phụ trách nhân sự (Ban GĐ không cần). Đơn nghỉ: lãnh đạo bộ phận duyệt nhân viên, Ban GĐ duyệt đơn của lãnh đạo bộ phận; không ai tự duyệt của mình. Giải trình chấm công: lãnh đạo bộ phận / người phụ trách nhân sự / Ban GĐ duyệt, không tự duyệt. Người phụ trách nhân sự không nhập / sửa chấm công của chính mình.
- **Mã hoá theo trường** (`lib/crypto-field.js`): số CCCD, lương — AES-256-GCM (thẻ 16 byte), khoá `HR_ENC_KEY` + mã khoá (chuẩn bị xoay khoá). Bản mã **gắn chủ sở hữu (AAD)**: chép bản mã sang hồ sơ khác trong CSDL không giải mã được. Máy chạy thiếu khoá → không khởi động. Bản sao lưu chỉ chứa bản mã. Xoá khoá = huỷ toàn bộ dữ liệu đã mã hoá.
- **Xem số CCCD / lương đầy đủ**: không nằm trong phản hồi thường; chỉ trên giao diện, bấm "Hiện" và **nhập lại mật khẩu** (AI điều khiển trình duyệt / computer use không được nhập mật khẩu; chặn máy bỏ quên chưa khoá), sai 5 lần khoá 15 phút; **mỗi lượt ghi nhật ký** `HR_IDENTITY_VIEW` / `HR_SALARY_VIEW`; không bao giờ qua token Claude (chặn ở `lib/tokens.js` và ở route).
- **Thông báo trung tính**: thông báo đơn nghỉ / giải trình không ghi loại nghỉ, lý do (thông báo cũng được Claude đọc); qua Claude, lý do giải trình và ý kiến duyệt của người khác bị bỏ.
- **Claude (token)**: xem theo đúng quyền người dùng. Ghi được: nhật ký làm việc với đối tác, xong việc theo dõi, tạo đơn nghỉ của chính mình. **Không** qua Claude: chấm công, giải trình, duyệt đơn / giải trình, sửa hồ sơ / hợp đồng / CCCD, thiết lập, nhập máy chấm công, tạo / sửa đối tác.
- **Tối thiểu hoá**: nhật ký hệ thống chỉ ghi tên trường thay đổi (không chép DLCN); người liên hệ rời đối tác → xoá hẳn; IP chấm công xoá sau 90 ngày; không thu sinh trắc, không GPS.
- **Chấm công**: giờ lấy từ máy chủ; chỉ chính người đó bấm trên giao diện. Giới hạn "chỉ trong mạng văn phòng" là tuỳ chọn — **Docker Desktop thường che IP thật** của máy người dùng, trang Thiết lập hiện "IP Kepper đang thấy" để kiểm tra trước khi bật. Chấm công qua web là tự khai (có thể chấm từ xa nếu không giới hạn mạng) → nếu bảng công dùng tính lương, nên lấy giờ từ máy chấm công (nhập CSV).

### 4. Rà năng lực (thay đổi so với GĐ3)

| Mã | Trạng thái | Khuyến nghị cụ thể | Ưu tiên |
|---|---|---|---|
| GOV-01 | Một phần | Ma trận quyền trong mã + test. Ban hành **quy chế quản lý hồ sơ nhân sự trên Kepper** (ai xem gì, thời hạn lưu, xử lý khi nghỉ việc) | Bắt buộc |
| GOV-02 | Một phần | Ban GĐ chỉ định người phụ trách nhân sự trên hệ thống (đã có chức năng) **và** người chịu trách nhiệm bảo vệ DLCN; mỗi đối tác có bộ phận / người phụ trách | Bắt buộc |
| GOV-03 | Một phần | Danh mục tập dữ liệu ở bảng 1 + `DATASETS` trong `lib/policy.js` | Nên có |
| GOV-04 | Một phần | Nhãn theo tập dữ liệu; loại nghỉ ốm / thai sản được xử lý như dữ liệu sức khoẻ | Nên có |
| GOV-05 | Một phần | Sơ đồ mục 2; CSV máy chấm công là nguồn vào duy nhất từ ngoài | Nên có |
| GOV-06 | Một phần | Dữ liệu đối tác chỉ dùng nội bộ, không chia sẻ tiếp; Anthropic là bên xử lý (GĐ3) | Bắt buộc |
| PRE-01 | Đầy đủ | Quyền theo bộ phận phụ trách / người phụ trách nhân sự / lãnh đạo; không tự duyệt; e2e + test ma trận | Bắt buộc |
| PRE-02 | Một phần | IT không xem nội dung nhân sự; DB vẫn là superuser (đã nêu GĐ2b) — tách role CSDL | Nên có |
| PRE-03 | Một phần | CCCD, lương mã hoá theo trường. **Khoá `HR_ENC_KEY` đang nằm trong `.env` cùng máy** → bật BitLocker ổ máy chạy, giữ bản sao khoá ngoài máy cùng khoá sao lưu `age` | Bắt buộc |
| PRE-04 | Một phần | CCCD chỉ 4 số cuối (giao diện + Claude); lương không qua Claude; nghỉ ốm của người khác gộp khi qua Claude; dữ liệu thử là dữ liệu giả | Bắt buộc |
| PRE-05 | Một phần | Không có xuất tệp nhân sự; người dùng vẫn chụp / sao chép màn hình được → quy chế | Nên có |
| PRE-06 | Đầy đủ | Duyệt / chấm công / sửa hồ sơ không qua Claude; mục đích gắn với vai trò | Bắt buộc |
| PRE-07 | Một phần | Như GĐ3; thêm chặn `/api/hrm/people/:id/identity` với token | Bắt buộc |
| DET-01 | Một phần | Nhật ký: tạo / sửa / duyệt / xem CCCD / nhập máy chấm công. Ban GĐ hoặc người được giao **rà nhật ký xem CCCD hằng tháng** | Bắt buộc |
| DET-03 | Chưa có | Cảnh báo khi một người xem CCCD > 5 lượt / ngày | Nên có |
| DET-04 | Một phần | Nhật ký truy cập ≥ 12 tháng (GĐ2b) | Bắt buộc |
| PRI-01 | Chưa có | Hồ sơ nhân sự xử lý để thực hiện hợp đồng lao động — **pháp chế xác định căn cứ xử lý** (đồng ý hay ngoại lệ không cần đồng ý); ghi trong thông báo | Bắt buộc |
| PRI-02 | Đầy đủ | Trường riêng tư tách khỏi trường cơ bản; lãnh đạo chỉ thấy cơ bản | Bắt buộc |
| PRI-03 | Một phần | Người lao động tự xem hồ sơ, tự sửa liên hệ; yêu cầu sửa / xoá khác qua người phụ trách nhân sự | Nên có |
| PRI-04 | Chưa có | **Thông báo xử lý DLCN cho người lao động**; bổ sung dữ liệu nhân sự / đối tác vào hồ sơ đánh giá tác động chuyển ra nước ngoài (GĐ3) | Bắt buộc |
| RES-01 | Một phần | Bảng mới nằm trong sao lưu hằng ngày (mã hoá `age`); bản thử không sao lưu (dữ liệu giả) | Bắt buộc |
| RES-02 | Một phần | IP 90 ngày; người liên hệ xoá hẳn khi hết mục đích. **Chưa có thời hạn lưu hồ sơ người đã nghỉ việc** — nhân sự / pháp chế quyết | Bắt buộc |
| RES-03 | Một phần | Kịch bản lộ CCCD / lương: thu hồi quyền người phụ trách nhân sự, đổi khoá (mã hoá lại), thông báo ≤ 72 giờ | Bắt buộc |

### 5. Nghĩa vụ pháp lý phát sinh (soát lại với Công báo trước khi trích dẫn chính thức)

| Nghĩa vụ | Căn cứ | Hạn / ngưỡng | Người phụ trách |
|---|---|---|---|
| Hồ sơ đánh giá tác động xử lý DLCN (có dữ liệu sức khoẻ qua loại nghỉ) | Luật BVDLCN Điều 21 | ≤ 60 ngày từ khi bắt đầu xử lý (khi bật trên bản chạy thật) | Người chịu trách nhiệm bảo vệ DLCN |
| Bổ sung hồ sơ chuyển DLCN ra nước ngoài (dữ liệu nhân sự / đối tác qua Claude) | Luật BVDLCN Điều 20; Luật Dữ liệu Điều 23; NĐ 165/2025 Điều 12 | Trước khi bật trên bản chạy thật | Như trên |
| Thông báo vi phạm DLCN (lộ CCCD, lương, nghỉ ốm) | Luật BVDLCN Điều 23 | ≤ 72 giờ | Như trên + Ban GĐ |
| Nghiêm cấm mua, bán DLCN (danh bạ người liên hệ đối tác) | Luật BVDLCN Điều 7 | — | Mọi người dùng |
| Phép năm, thâm niên | BLLĐ 2019 Điều 113, 114 | 12 ngày; +1 ngày mỗi 5 năm | Người phụ trách nhân sự (số trên Kepper là tham khảo) |

### 6. Khuyến nghị ưu tiên

1. [Bắt buộc] Dùng thử trên bản 4200 với dữ liệu giả; **không nhập CCCD / lương thật** vào bản thử.
2. [Bắt buộc] Trước khi bật trên bản chạy thật: thông báo xử lý DLCN cho người lao động; chỉ định người phụ trách nhân sự; quyết định thời hạn lưu; hồ sơ đánh giá tác động (mục 5).
3. [Bắt buộc] `HR_ENC_KEY`: tạo trên máy chạy, bản sao giữ ngoài máy cùng khoá sao lưu; bật BitLocker.
4. [Bắt buộc] Rà nhật ký "Xem số định danh" hằng tháng.
5. [Nên có] Bảng công tính lương: lấy giờ từ máy chấm công (CSV), web chỉ để giải trình.
6. [Nên có] Tách role CSDL (app không phải superuser) trước khi lưu dữ liệu Hạn chế thật.

### 7. Rà soát độc lập vòng 3 (24/10/2026) — đã sửa

| Phát hiện | Mức | Cách sửa |
|---|---|---|
| Token đọc lách danh sách chặn bằng "/" cuối, chữ hoa (`/export.xlsx/`, `.XLSX`, `/api/stream/`, `/API/me/tokens`) — Express 5 khớp route không phân biệt | Cao | Chuẩn hoá đường dẫn trước khi so; chặn thêm xem trước tệp, mã Viber; lớp chặn thứ hai `assertNotVia` trong mọi route xuất / tải tệp; test hồi quy |
| Nhân viên tự gán mình làm "người phụ trách" đối tác → xem giá trị hợp đồng | Cao | Đổi / chỉ định người phụ trách chỉ lãnh đạo bộ phận / Ban GĐ; người phụ trách phải thuộc bộ phận phụ trách |
| Người phụ trách nhân sự tự sửa hợp đồng / lương / ngày vào làm của chính mình | Trung bình | `!self`; hồ sơ của người phụ trách nhân sự do Ban GĐ sửa |
| Loại nghỉ ốm lộ qua tiêu đề thông báo; lý do giải trình người khác lộ qua token | Trung bình | Thông báo trung tính; che khi qua Claude |
| IT reset mật khẩu người phụ trách nhân sự → xem CCCD, lương | Trung bình | Báo Ban GĐ khi reset (như tài khoản Ban GĐ); token của tài khoản đã thành IT bị từ chối |
| Bản mã không gắn chủ sở hữu | Trung bình | AAD theo bảng / trường / id; thẻ 16 byte; mã khoá |
| Đơn nghỉ của Giám đốc không ai duyệt; nghỉ nửa ngày bị tính đi muộn 330 phút; đơn qua năm trừ hết vào năm đầu; CSV máy chấm công ghi đè / không nhận 8:05, dd/mm/yyyy | Cao / Trung bình | Người phụ trách nhân sự ghi nhận đơn Ban GĐ; giờ nghỉ trưa + tính lại theo nửa ngày; tách số ngày theo năm, số dư tính theo lịch hiện tại; gộp lần chấm, không ghi đè bằng ô trống, chuẩn hoá giờ / ngày |
| Huỷ đơn chen lúc duyệt; bấm chấm vào hai lần; tạo đơn song song | Thấp | Cập nhật có điều kiện trạng thái; khoá tư vấn theo người khi tạo đơn |

Chưa sửa (quyết định của chủ dự án): báo Ban GĐ khi IT đổi phòng ban / cấp quyền "Xem tổng hợp"; thông báo lại đơn đang chờ khi người lao động chuyển bộ phận; `PATCH /api/items/:id` qua token nhận mọi trường như giao diện (theo nguyên tắc "AI = người dùng").

### 8. Rủi ro còn lại và câu hỏi mở

- Người có quyền xem vẫn chụp màn hình / sao chép được (không có DRM) → quy chế + nhật ký.
- Claude Desktop "luôn cho phép" công cụ ghi → Claude ghi nhật ký đối tác / tạo đơn nghỉ không hỏi lại. Nhật ký CRM không sửa được → khuyến cáo không bật "luôn cho phép" cho công cụ ghi.
- Câu hỏi cho nhân sự / pháp chế: căn cứ xử lý hồ sơ (đồng ý hay hợp đồng); thời hạn lưu hồ sơ và bảng công sau nghỉ việc; có dùng máy chấm công sinh trắc không (nếu có: dữ liệu sinh trắc là DLCN nhạy cảm, cần đánh giá riêng cho thiết bị).

## Chạy thử một dự án theo vai trò và các sửa đổi kèm theo (23/10/2026)

Chạy thử dự án "Khu nhà ở Bình Minh (giả)" trên bản thử (dữ liệu giả): TGĐ giao việc → PMO nhập MTL → lãnh đạo bộ phận chi tiết hoá, phân công → nhân viên thực hiện (giao diện + Claude) → nghỉ phép → báo cáo tuần → giao ban. Không có tập dữ liệu mới; ba thay đổi chạm luồng dữ liệu:

| Thay đổi | Dữ liệu | Đánh giá |
|---|---|---|
| Hạng mục MTL lập trên ứng dụng nhận kế hoạch gốc (+ migration bổ sung cho hạng mục cũ) | `mtl.plan` (Bảo mật, không DLCN) | Chỉ ghi trường kế hoạch gốc của hạng mục chưa có; quyền sửa kế hoạch giữ nguyên (lib/policy.js `mtl.plan`). Không đổi bên được xem |
| Màn việc hiện nhật ký làm việc với đối tác gắn việc đó | `crm.interaction` (Bảo mật, DLCN cơ bản) | Cùng quy tắc xem như trang Đối tác: bộ phận phụ trách / Ban GĐ / người ghi / người được giao theo dõi. Người xem được việc nhưng không thuộc các nhóm trên chỉ thấy **số lượng** nhật ký ẩn |
| Người duyệt đơn nghỉ thấy việc đến hạn trong thời gian nghỉ và buổi giao ban trùng ngày nghỉ | `hrm.leave` + mã việc | Chỉ mã việc (vd. BM-10), không tên / nội dung việc; không trả qua token Claude. Người duyệt vốn là lãnh đạo bộ phận / Ban GĐ / người phụ trách nhân sự |

**Quyết định của chủ dự án (23/10/2026):** tạm chưa lập hồ sơ đánh giá tác động chuyển DLCN ra nước ngoài; không coi là điều kiện chặn cho bản thử (dữ liệu giả). Nghĩa vụ pháp lý vẫn còn (Luật BVDLCN Điều 20; Luật Dữ liệu Điều 23; NĐ 165/2025 Điều 12): phải có hồ sơ trước khi dữ liệu thật về nhân sự / đối tác đi qua Claude hoặc Viber. Các quyết định còn lại (quy chế dùng AI, người phụ trách nhân sự, thời hạn lưu hồ sơ, cấu hình Claude Team, cách đăng nhập) để sau.

**Kết luận cổng cho thay đổi này:** ĐẠT (không thêm bên nhận, không thêm trường DLCN, không đổi quyền).

## Thông tin cá nhân, kết nối Claude nhanh, chạy trên NAS công ty (23/10/2026)

Ba thay đổi theo yêu cầu của chủ dự án: trang **Thông tin cá nhân** (ảnh đại diện, xem thông tin tài khoản, vị trí trong cây tổ chức);
**kết nối Claude bằng nút "Cho phép"** thay cho tạo token tay; chuẩn bị **chạy trên NAS công ty** cho laptop truy cập qua HTTPS.
Phản biện vận hành kèm theo: `docs/production-readiness.md`; cách cài: `docs/deploy-nas.md`.

**Kết luận cổng:** ĐẠT CÓ ĐIỀU KIỆN — điều kiện: HTTPS và bản sao lưu ngoài NAS trước khi chuyển dữ liệu thật sang NAS (RES-01, PRE-03).

### 1. Phân loại

| Tập dữ liệu | Nhãn nội bộ | Phân loại pháp lý | Ghi chú |
|---|---|---|---|
| Ảnh đại diện (`User.avatarFile`, tệp `uploads/avatars/`) | Nội bộ | DLCN cơ bản (hình ảnh của cá nhân) | Tuỳ chọn, chính người dùng tải lên / xoá; không bắt buộc, không dùng nhận dạng |
| Cây tổ chức (ai trên / dưới / cùng cấp) | Nội bộ | DLCN cơ bản (họ tên, chức danh, bộ phận) | Suy ra từ vai trò + bộ phận có sẵn; không thêm trường mới |
| Mã kết nối Claude trên laptop (`%APPDATA%\kepper-claude\token-*.json`) | Bảo mật | Thông tin xác thực | Thay cho Windows Credential Manager khi tạo token tay |
| Dữ liệu trên NAS (CSDL, tệp, nhật ký, sao lưu) | Như hiện tại (cao nhất: Bảo mật; Hạn chế nếu bật HRM) | Không đổi | Đổi nơi lưu: PC → NAS công ty, vẫn trong nước, trong mạng công ty |

### 2. Dòng dữ liệu

- **Ảnh:** trình duyệt cắt vuông, thu nhỏ ≤ 512 px (ảnh gốc không rời máy) → `PUT /api/me/avatar` (≤ 400 KB, kiểm chữ ký tệp PNG / JPEG / WebP, SVG bị từ chối)
  → lưu `uploads/avatars/<uuid>` → người đã đăng nhập xem qua `/avatars/<uuid>` (đường dẫn ngẫu nhiên, chỉ ảnh đang gắn với tài khoản còn hoạt động; xoá / khoá tài khoản → 404).
  Không đi qua token Claude (`NOT_VIA_AI`), không vào nhật ký nội dung.
- **Kết nối Claude:** tiện ích trên laptop xin mã (`/api/claude/connect/start`, không cần đăng nhập, ≤ 5 mã chờ / IP) → mở trình duyệt trang "Cho phép"
  → người dùng đã đăng nhập bấm **Cho phép**, chọn phạm vi → máy chủ chỉ cho phép khi trình duyệt và tiện ích **cùng một máy** (cùng IP) → token 30 ngày trao **một lần** cho tiện ích
  → tiện ích lưu tệp quyền 600 trong thư mục người dùng. Kết nối lại cùng máy thu hồi token cũ; tối đa 5 máy / người.
- **NAS:** laptop → HTTPS (reverse proxy trên NAS) → app (chỉ nghe 127.0.0.1) → Postgres / thư mục trên ổ NAS → sao lưu → bản thứ hai ngoài NAS.

### 3. Rà năng lực (thay đổi)

| Mã | Trạng thái | Ghi chú | Ưu tiên |
|---|---|---|---|
| PRE-01 | Đầy đủ | Kết nối Claude cần người dùng đã đăng nhập bấm "Cho phép" trên chính máy đó; quản trị IT không cấp được; khoá tài khoản / đổi mật khẩu thu hồi ngay | Bắt buộc |
| PRE-03 | Một phần | Trên NAS: HTTPS bắt buộc trước khi dùng dữ liệu thật (`APP_BIND=127.0.0.1` + proxy TLS); nên đặt thư mục dữ liệu trên volume / thư mục mã hoá của NAS. Mã kết nối Claude trên laptop là tệp (không còn Credential Manager) → BitLocker bắt buộc | Bắt buộc |
| PRE-02 | Một phần | NAS: chỉ 1–2 tài khoản quản trị, 2FA, tắt SSH sau khi cài; `.env` quyền 600 | Bắt buộc |
| PRI-02 | Đầy đủ | Ảnh tuỳ chọn, thu nhỏ trước khi gửi; cây tổ chức chỉ dùng trường đã có | Bắt buộc |
| PRI-03 | Một phần | Người dùng tự xem thông tin tài khoản, tự xoá ảnh; sửa họ tên / chức danh vẫn qua quản trị (giữ luồng cấp quyền) | Nên có |
| DET-01 | Đầy đủ | AuditLog: `AVATAR_UPDATE`, `AVATAR_DELETE`, `TOKEN_CREATE` (via `connect`); nhật ký truy cập ghi IP thật khi `TRUST_PROXY=1` | Bắt buộc |
| DET-04 | Một phần | Nhật ký truy cập 400 ngày ra thư mục NAS; app báo khi thư mục không ghi được | Bắt buộc |
| RES-01 | Một phần | Bộ cài NAS + tài liệu 3-2-1-1-0; còn thiếu trên thực tế: bản ngoài NAS, snapshot bất biến, khoá age | Bắt buộc |
| RES-02 | Một phần | Ảnh cũ bị xoá khi đổi / xoá ảnh; PC cũ giữ 30 ngày sau khi chuyển rồi huỷ theo quy trình | Nên có |

### 4. Nghĩa vụ pháp lý (soát lại với Công báo trước khi trích dẫn chính thức)

- Ảnh đại diện là DLCN cơ bản: thông báo mục đích (hiển thị trong hệ thống nội bộ) trên trang — đã ghi "ai đăng nhập Kepper cũng thấy; xoá được bất cứ lúc nào".
- Chuyển máy chạy sang NAS: dữ liệu vẫn lưu trong nước; không phát sinh chuyển ra nước ngoài. Lưu bản sao lưu lên cloud nước ngoài = chuyển ra nước ngoài (cần hồ sơ) — tài liệu NAS khuyến nghị đích trong nước.
- Hồ sơ chuyển DLCN ra nước ngoài cho Claude: vẫn theo quyết định hoãn ngày 23/10 của chủ dự án.

### 5. Rủi ro còn lại

- Kiểm tra "cùng máy" dựa vào IP: sau NAT / proxy thiếu `TRUST_PROXY` thì mọi người cùng một IP → kiểm tra mất tác dụng (người bấm "Cho phép" vẫn phải đăng nhập và tự nhìn thấy mã).
- Laptop không mã hoá ổ: lộ mã kết nối Claude (30 ngày) và phiên trình duyệt (12 giờ) khi mất máy → quy trình khoá tài khoản ngay khi báo mất.
