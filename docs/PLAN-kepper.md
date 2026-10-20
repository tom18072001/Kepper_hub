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
