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
2. **Cập nhật tiến độ**: các bộ phận cập nhật %, ngày thực tế, tệp và bình luận trên giao diện web, qua HTTPS nội bộ.
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
| PRE-07 | Một phần | API chỉ trả trường cần thiết; rate limit đăng nhập (đã có). Webhook Viber kiểm chữ ký HMAC `X-Viber-Content-Signature` | Bắt buộc (khi bật Viber) |
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
- Thông báo nhắc cập nhật thứ Sáu: chỉ trong ứng dụng, không qua Viber.

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
