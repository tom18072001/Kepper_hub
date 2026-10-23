# Kepper Hub — kế hoạch nghiệp vụ

## Bài toán
Công ty theo dõi dự án bất động sản (vd. SPV NƠXH) bằng **Master Timeline (MTL)**: các hạng mục theo **tháng T** tính từ T0. Mỗi hạng mục có:
- bước, hạng mục công việc, đầu mối;
- bắt đầu (T), kết thúc (T), thời lượng;
- **đường găng**, **mốc ◆**.

Có hai loại bảng:
- MTL tổng, có thể có nhiều phương án, vd. "overall" và "fast-track".
- **MTL bộ phận**: Pháp lý, Thiết kế, QLXD… chi tiết hoá từng hạng mục của MTL tổng, cùng cấu trúc cột.

Yêu cầu:
1. Theo dõi tiến độ dự án và bộ phận, có Dashboard.
2. Cảnh báo dựa trên bảng kế hoạch: tự nhắc nhanh / chậm tiến độ, đánh giá **KPI tiến độ**.
3. **Dự án dùng chung** giữa các bộ phận.
4. **Cowork** giữa các bộ phận.

## Mô hình
| Khái niệm | Lưu ở | Ghi chú |
|---|---|---|
| Dự án MTL | `Project.kind = 'MTL'`, `t0Date`, `alertConfig` | Dùng chung: mọi bộ phận là thành viên, phạm vi toàn công ty |
| Phương án kế hoạch | `Plan` (`kind` MASTER / DEPARTMENT, `departmentId`, `isActive`, tệp nguồn + băm) | MTL overall, MTL fast-track, MTL Pháp lý… |
| Hạng mục MTL tổng | `WorkItem` gốc (`planCode` = Bước, `planSection` = phần / phân kỳ) | `critical`, `milestone`, `milestoneNote`, `ownerText` (đầu mối), `externalParty` (cơ quan ngoài), `startT`, `endT` |
| Hạng mục MTL bộ phận | `WorkItem` con của hạng mục tổng (`parentId`), `leadDepartmentId` = bộ phận | Cùng các trường; Kanban, bình luận, tệp, @nhắc tên giữ nguyên |
| Kế hoạch gốc | `baselineStart`, `baselineEnd` (tính từ T0 + startT / endT) | Chỉ đổi qua "Điều chỉnh kế hoạch gốc" (bắt buộc lý do, ghi nhật ký). Hạn làm việc `startDate` / `dueDate` có thể lùi theo thực tế |
| Thực tế | `progress` %, `startedAt`, `completedAt`, `forecastEnd` (dự báo hoàn thành) | Hạng mục có con: % = bình quân gia quyền (thời lượng) của con |
| Cảnh báo | `ProgressAlert` (hạng mục, loại, mức, ngày, độ lệch) | Chống lặp theo loại / chu kỳ |
| Ảnh chụp tiến độ | `ProgressSnapshot` (dự án, bộ phận, ngày, % kế hoạch, % thực tế, SPI) | Vẽ đường cong S |
| Viber | `ViberLink` (người dùng ↔ Viber ID, thời điểm đồng ý) | Mặc định TẮT (xem đánh giá bảo vệ dữ liệu) |

### Quy đổi tháng T
- Bắt đầu = ngày đầu tháng (T0 + startT).
- Kết thúc = ngày cuối tháng (T0 + endT).
- Thời lượng = endT − startT + 1 tháng, khớp cột "Thời lượng" trong MTL.
- MTL bộ phận có thể ghi ngày cụ thể (dd/mm/yyyy) thay cho T.

### Tiến độ và trạng thái (tính hằng ngày)
- **% kế hoạch** tại ngày d: tuyến tính giữa `baselineStart` và `baselineEnd`.
- **Độ lệch** = % thực tế − % kế hoạch.
- Trạng thái của hạng mục:
  - Chưa đến kỳ.
  - **Chậm khởi động**: đã tới ngày bắt đầu mà còn 0%.
  - **Đúng tiến độ**: lệch trong ±ngưỡng (mặc định 10 điểm).
  - **Chậm tiến độ**: lệch < −ngưỡng.
  - **Vượt tiến độ**: lệch > +ngưỡng.
  - **Trễ hạn**: quá `baselineEnd` mà chưa xong.
  - Hoàn thành đúng hạn / trễ hạn.
- **SPI** (chỉ số tiến độ) = Σ(trọng số × % thực tế) / Σ(trọng số × % kế hoạch). Trọng số mặc định = thời lượng (ngày).

### Cảnh báo tự động (07:30 hằng ngày, giờ Việt Nam)
| Loại | Khi nào | Gửi ai | Lặp lại |
|---|---|---|---|
| Sắp bắt đầu | còn ≤ 7 ngày tới ngày bắt đầu, chưa bắt đầu | chủ trì, lãnh đạo bộ phận | 1 lần |
| Chậm khởi động | đã tới ngày bắt đầu, 0% | như trên + PMO | 3 ngày / lần |
| Sắp đến hạn | còn ≤ 7 ngày, chưa xong | chủ trì, lãnh đạo bộ phận | 1 lần |
| Chậm tiến độ | lệch < −ngưỡng | chủ trì, lãnh đạo bộ phận, PMO; **đường găng / mốc** thêm Ban lãnh đạo | 7 ngày / lần, hoặc khi chuyển mức |
| Vượt tiến độ | lệch > +ngưỡng | chủ trì, lãnh đạo bộ phận (ghi nhận) | 1 lần |
| Trễ hạn | quá hạn kế hoạch gốc | như "Chậm tiến độ" | 3 ngày / lần |
| Chưa cập nhật | đang thực hiện, ≥ 7 ngày không cập nhật | chủ trì | 7 ngày / lần |

Ngưỡng và số ngày chỉnh trong cài đặt dự án.

### KPI tiến độ (bộ phận, cá nhân chủ trì)
Điểm = 50% × SPI (quy về 100, trần 1,1) + 30% × tỷ lệ hạng mục hoàn thành đúng hạn + 20% × (1 − tỷ lệ hạng mục đường găng trễ).

- Hiện kèm số hạng mục chậm / trễ và số ngày trễ bình quân.
- Tính trên **kế hoạch gốc**.
- Chỉ Ban lãnh đạo và trưởng bộ phận (bộ phận mình) xem KPI theo người.

### Dashboard dự án
- Đầu trang: T hiện tại / tổng T, % kế hoạch, % thực tế, SPI, số hạng mục chậm / trễ, mốc kế tiếp.
- Đường cong S: kế hoạch so với thực tế.
- Mốc chính: kế hoạch, dự báo, trạng thái.
- Đường găng.
- Theo bộ phận: SPI, KPI, chậm / trễ.
- Cảnh báo mới.
- **Gantt**: thanh kế hoạch gốc, thanh thực tế / % hoàn thành, đường găng màu đỏ, mốc ◆, vạch "hôm nay".

### Bộ phận (theo đầu mối trong MTL)
- Ban lãnh đạo (CT, TGĐ, GĐĐH)
- Pháp lý (PL)
- Tài chính (TC)
- Thiết kế (TK)
- Quản lý xây dựng (QLXD)
- Kinh doanh (KD)
- Đối ngoại / GPMB (GR)
- PMO: thuộc Ban lãnh đạo hoặc là một bộ phận riêng, cấu hình được

Cơ quan ngoài (UBND TP, Sở…, Cục…, VP ĐKĐĐ, ĐVTV) được lưu ở `externalParty`, không có tài khoản.

### Bỏ khỏi WorkHub (nghiệp vụ riêng NQ57)
- Sổ giao việc Trung tâm và Kế hoạch năm (Word).
- Giao về phòng / tiếp nhận / uỷ quyền.
- Kiến nghị, BGĐ cho ý kiến, phiếu trình.
- Lịch công tác.
- Tổng hợp giao việc.
- Gửi yêu cầu.

Giữ lại: dự án, Kanban, danh sách, lịch, việc con, duyệt nhiều cấp, bình luận, tệp, thông báo, phân quyền, nhật ký, sao lưu.

## Giai đoạn
- **GĐ1** (nhánh `kepper/gd1-mtl`):
  - mô hình dữ liệu;
  - nhập MTL tổng / bộ phận từ Excel (xem trước, chọn sheet);
  - tính tiến độ, trạng thái, SPI;
  - cảnh báo trong ứng dụng;
  - KPI tiến độ;
  - Dashboard dự án;
  - Gantt kế hoạch / thực tế;
  - bỏ màn hình NQ57;
  - dữ liệu mẫu giả.
- **GĐ2**: Viber bot (sau khi có hồ sơ chuyển DLCN ra nước ngoài), điều chỉnh kế hoạch gốc có duyệt, so sánh phương án overall / fast-track, báo cáo tuần Word / Excel theo MTL.

## GĐ2a — Sprint theo giai đoạn, thang tiến độ theo đầu việc, Cập nhật nhanh, MTL bộ phận điền sẵn (nhánh `kepper/gd2a-sprint`)

Phản hồi của chủ dự án (20/10/2026): màn hình Kế hoạch & Gantt không rõ các sprint; cần thao tác đơn giản.
Chốt (sau khi làm rõ): **sprint = một giai đoạn gồm một nhóm bước MTL tổng**, vd. "Chuyển nhượng DA (B1–9)", "Đề xuất NƠXH → CTĐT".
**Thang tiến độ theo đầu việc**: đầu mục có 5 việc con → xong 1 việc = 20%, giảm việc phải tự khai %.

| Hạng mục | Cách làm |
|---|---|
| Sprint (giai đoạn) | `Project.sprintPlan` (JSON `[{ name, steps, goal }]`), PMO thiết lập bằng ô chữ: `Tên \| 1-9 \| mục tiêu` hoặc `Tên (B1–9)`; khoảng bước theo thứ tự tự nhiên (1…n, rồi II.1…). Kiểm tra bước không có / bước nằm ở hai sprint; báo bước chưa xếp. Chưa thiết lập → gợi ý cắt theo mốc ◆ đường găng. Việc con (MTL bộ phận) thuộc sprint của bước tổng. Hàm thuần: `services/mtl-sprints.js`. Nhật ký `MTL_SPRINT_PLAN` |
| Tab Sprint | Lộ trình các sprint trên trục tháng T (thanh kế hoạch, % thực tế, vạch kế hoạch hôm nay, mốc ◆, hôm nay) → chi tiết sprint: tiến độ, SPI, bước xong, chậm / trễ, mốc; các bước theo thứ tự, bước có việc con hiện "x/y việc con đã xong"; cập nhật một chạm; theo ban |
| Theo tháng | Chế độ phụ của tab Sprint: tháng T phải xong gì (kèm việc trễ từ tháng trước) / đang chạy (mục tiêu % cuối tháng) / chuẩn bị tháng sau, tổng kết theo ban (`/api/projects/:id/mtl-month`) |
| Gantt | Hàng gom theo sprint (đầu nhóm có thanh tổng sprint, bấm để thu gọn), lọc theo sprint; khung 12 tháng quanh hiện tại; đầu cột mở "Theo tháng" |
| Thang tiến độ | `weightOf` mặc định 1 (cột "Trọng số" ghi đè): việc cha = bình quân việc con. Dự án / ban / sprint tính theo cây (`treeProgress`), KPI đếm chậm / trễ trên việc lá. Việc lá có checklist: % = mục đã xong / tổng, đủ mục tự Hoàn thành |
| Cập nhật nhanh | `GET /api/my/sprint`: việc của tôi trong tháng hiện tại hoặc trễ chưa xong, kèm tên sprint; "✓ Xong" là thao tác chính. Nhắc 15:00 thứ Năm trong ứng dụng (trước hạn báo cáo tuần) |
| MTL bộ phận | Như trước: mẫu Excel điền sẵn, lãnh đạo bộ phận tự nhập MTL của bộ phận mình |

Còn mở: Viber / kênh tin nhắn (Viber bot, Viber Business Messages qua Infobip, Zalo ZBS/ZNS) — chọn kênh, hợp đồng, hồ sơ chuyển DLCN; tin tổng hợp 1 tin/người/ngày theo mẫu.

## GĐ2b — Giao diện gọn theo mẫu Báo cáo tuần, giao ban theo QC-TH-01 / QT-TH-01 / BM-TH-01 (nhánh `kepper/gd2b-bao-cao-tuan`)

Phản hồi của chủ dự án (23/10/2026): "rườm rà và nhiều thao tác quá" — làm theo hai mẫu: biểu mẫu web "Báo cáo tuần" (BM-TH-01) và tài liệu Quy chế / Quy trình giao ban tuần.

| Hạng mục | Cách làm |
|---|---|
| Điều hướng | Trang chủ `#/tuan`. Menu chính còn 3 mục: **Báo cáo tuần · Tiến độ dự án · Cập nhật nhanh**; các trang khác (Việc của tôi, Chờ duyệt, Số liệu, Thùng rác, Danh mục) gom vào "Công cụ khác" (thu gọn, có số việc chờ duyệt). Tông navy / vàng đồng của mẫu áp cho cả ứng dụng |
| Báo cáo tuần | Một cột 920 px như mẫu; `GET /api/weekly/report` trả bản đã lưu + bản điền sẵn (`services/weekly.js#buildPrefill`): MTL của bộ phận (mức chi tiết nhất, không đếm cha – con hai lần), kế hoạch tuần trước, Action Log giao ban đã phát hành. Tự lưu nháp `PUT`; nộp `POST /api/weekly/submit` — làm sạch, kiểm tra theo Điều 4 (trả danh sách lỗi), ghi ngược % vào MTL (`services/mtl-progress.js`, dùng chung với checklist), lưu bản nộp; giờ nộp lần đầu không đổi khi gửi lại |
| Báo muộn / vắng | `WeeklyNotice`: lý do chọn danh sách + ghi chú ≤ 200 ký tự; muộn: giờ nộp dự kiến; vắng: bắt buộc người dự thay. Báo thư ký / Ban GĐ / PMO. Tự xoá sau 12 tháng |
| Tổng hợp | `GET /api/weekly/summary` (TGĐ, thư ký, PMO, trưởng / phó bộ phận): tình trạng nộp (Điều 6), vắng (Điều 7), rà Action Log tuần trước, yêu cầu hỗ trợ theo nơi nhận, chi tiết, văn bản sao chép (`summaryText`: nhãn BẢO MẬT, không họ tên) |
| Giao ban | `WeeklyMeeting` mỗi tuần: hạn nộp / ngày họp khi nghỉ lễ, điểm danh, báo cáo không đạt, kết luận TGĐ (Chấp thuận / Giao bộ phận phối hợp / Phương án khác), Action Log; phát hành một lần → thông báo |
| Chấm điểm | `GET /api/weekly/compliance?month=` theo Phụ lục 1: nộp muộn có báo 5, không báo 15, không nộp 25, không đạt 5, đi muộn 5, vắng không báo 25, vắng có báo + người dự thay 0; tính từ "tuần bắt đầu chấm điểm" |
| Thiết lập | `AppSetting weekly.config`: bộ phận phải nộp theo thứ tự trình bày, tuần bắt đầu chấm điểm, (tuỳ chọn) mức trừ. Chưa thiết lập → bộ phận chủ trì hạng mục MTL |
| Lịch | 15:00 thứ Năm: nhắc từng người cập nhật % (GĐ2a); 15:00 ngày hạn nộp: nhắc bộ phận chưa nộp; 07:35 ngày giao ban: tóm tắt tổng hợp; 02:35: xoá thông báo muộn / vắng quá 12 tháng |
| Quyền | Vai trò **suy ra tự động** từ tài khoản (không chọn vai trò trên màn hình), cưỡng chế bằng `lib/policy.js`:<br>• **Ban GĐ** = tài khoản vai trò giám đốc: không lập báo cáo, xem mọi bộ phận, kết luận, duyệt và khoá bảng điểm, chọn bộ phận thư ký và PMO.<br>• **Thư ký** = thành viên bộ phận do Ban GĐ chọn: nhập thay (giờ nhận email), ghi điểm danh / Action Log, lập và trình bảng điểm, mở lại báo cáo sau giờ họp.<br>• **PMO** = người Ban GĐ chỉ định: xem chi tiết mọi bộ phận.<br>• **Trưởng / phó bộ phận** (có quyền xem tổng hợp của bộ phận): bản tóm tắt + chi tiết bộ phận mình.<br>• **Nhân viên**: lập / nộp báo cáo bộ phận mình.<br>• Admin IT không xem. |

Cài đặt trên máy chạy:
1. Tạo đúng 5 bộ phận theo quy chế (tên thật chỉ nhập trên máy chạy), gán trưởng bộ phận.
2. Đăng nhập tài khoản giám đốc → Báo cáo tuần → Thiết lập:
   - chọn bộ phận thư ký và PMO;
   - chọn bộ phận phải nộp theo thứ tự trình bày;
   - tuần bắt đầu chấm điểm 30/10/2026.
3. Không cần cấp thêm quyền cho thư ký.

### Rà soát GĐ2b (23/10/2026)

Ba rà soát độc lập (nghiệp vụ theo quy chế, bảo mật / phân quyền, khung kỹ thuật). Phát hiện mức Chặn / Cao đã sửa trong mã; chi tiết và ma trận ở `docs/data-protection-assessment.md`, mục "Rà soát độc lập GĐ2b".

| Hạng mục | Cách làm |
|---|---|
| Quy định phân quyền | `lib/policy.js` — ma trận vai trò × tập dữ liệu × hành động (xem / sửa / xuất / AI / gửi ra ngoài); `policy.test.js` kiểm từng ô |
| Một nguồn % | Việc cha theo việc con; việc có checklist theo checklist; nhập tay vào hai loại này bị từ chối. Báo cáo tuần chỉ ghi % khi MTL chưa đổi từ lúc điền sẵn; nhập thay không ghi % |
| Quyền sửa MTL | `% / checklist`: người được giao, lãnh đạo bộ phận chủ trì, người quản lý dự án. Tên, găng, mốc, kế hoạch gốc: người quản lý dự án. Thẻ sprint ẩn nút cập nhật khi không có quyền |
| Báo cáo tuần | Hạng mục bắt buộc (MTL, Action Log, việc chưa xong tuần trước) không bỏ được; tình trạng dòng liên kết do máy chủ tính, chỉ được nâng lên "Vướng"; bắt buộc người phụ trách, "cần trước ngày" khi đề nghị hỗ trợ, sản phẩm đầu ra Phần III. Hai người sửa cùng nháp → báo xung đột. Khoá nộp lại sau giờ họp |
| Bằng chứng | Mỗi lần nộp một phiên bản bất biến kèm SHA-256 (`WeeklyReportVersion`); `AuditLog` chỉ ghi thêm (trigger CSDL) |
| Giao ban | Tuần nghỉ; danh sách bộ phận phải nộp chụp theo tuần; phát hành chỉ khi mọi yêu cầu hỗ trợ đã có kết luận; Action Log bắt buộc người phụ trách, rà mọi việc mở 12 tuần |
| Chấm điểm | Báo vắng sau 17:30 chỉ miễn trừ khi "Việc đột xuất"; đi muộn luôn trừ; thư ký trình → TGĐ duyệt và khoá tháng |
| Lịch chạy | `services/jobs.js`: mỗi job một lần / ngày, **chạy bù** khi máy bật lại trong khung giờ còn ý nghĩa; lỗi một job không làm dừng máy chủ (sổ `AppSetting jobs.lastRun`) |
| Vận hành | Sao lưu kiểm lỗi từng bước, chỉ dọn bản cũ khi bản mới đạt (`LAST_OK`); xoay vòng log Docker; image gắn phiên bản; CI (unit, migration, `npm audit`, e2e) |

Chờ chủ dự án quyết: giới hạn đăng nhập sai / mật khẩu tạm hoặc SSO Microsoft 365; phạm vi mặc định của MTL; máy chủ luôn bật + TLS; báo Ban GĐ khi admin IT cấp quyền nghiệp vụ.

## GĐ3 — AI native: Claude dùng đúng quyền người dùng (nhánh `kepper/gd3-ai-native`)

Chủ dự án (24/10/2026): mọi người dùng Claude (tài khoản Claude Team công ty) trong công việc. Bỏ "AI tắt mặc định". Bộ khung phải chặn người không đủ quyền xem tài liệu mật.

| Hạng mục | Cách làm |
|---|---|
| Nguyên tắc | AI = người dùng: policy `ai` = `view` của chính người dùng. Không tài khoản AI riêng, không token hệ thống |
| Kết nối | Tiện ích MCP chạy trên máy người dùng (`app/mcp`, đóng gói `.mcpb`, Node đi kèm Claude Desktop). Gọi Kepper trong LAN — không mở Kepper ra Internet |
| Token | `ApiToken`: băm SHA-256, phạm vi `read` / `write`, hạn ≤ 90 ngày, ≤ 5 token / người. Đổi mật khẩu / khoá → mất hiệu lực. Admin xem / thu hồi |
| Công cụ | 18 công cụ: whoami, việc của tôi, việc trong kỳ, chi tiết, tìm, dự án, tiến độ MTL, thông báo, báo cáo tuần, tổng hợp (theo quyền), nhắc việc, danh bạ; cập nhật % / checklist, bình luận, tạo / giao việc, phân công, tạo nhắc việc, lưu nháp báo cáo tuần |
| Không qua AI | Nộp báo cáo, phát hành giao ban, duyệt, xoá, xuất tệp, quản trị, mật khẩu, tạo token |
| Nhắc việc | Ghi chú cá nhân có hạn → thông báo 08:05 ngày đến hạn (job `note_reminders`) |
| Kiểm thử | `lib/tokens.test.js`, `policy.test.js`, e2e `07-kepper-claude`, kiểm thử tích hợp MCP thật (`app/mcp/test`) |

Còn mở:
- hồ sơ chuyển DLCN ra nước ngoài;
- quy chế sử dụng AI;
- cảnh báo đọc dồn bất thường theo token;
- connector từ xa (claude.ai web / điện thoại) khi đã có máy chủ + TLS.
