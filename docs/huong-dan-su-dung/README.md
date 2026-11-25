# Hướng dẫn sử dụng Kepler Hub

Ba bộ tài liệu, chia theo người đọc:

| Tài liệu | Gửi cho | Nội dung |
|---|---|---|
| [Hướng dẫn cho nhân viên](nhan-vien.md) | Mọi nhân viên | Đăng nhập, chứng chỉ, kết nối Claude desktop, cài skill; làm việc dự án ở vai người chủ trì / phối hợp; Cập nhật nhanh; báo cáo tuần; tài liệu, văn bản giao xử lý; chấm công, xin nghỉ; đối tác; nhắc việc; thiết lập cá nhân; lỗi thường gặp |
| [Hướng dẫn cho lãnh đạo](lanh-dao.md) | Ban Tổng Giám đốc, lãnh đạo bộ phận, PMO, thư ký giao ban | Vai và quyền; theo dõi tiến độ, KPI; giao việc; duyệt và chấm mức; duyệt gia hạn, kiến nghị; báo cáo tuần bộ phận; giao ban, Action Log, chấm điểm; văn thư, quy chế nội bộ; duyệt đơn nghỉ, bảng công |
| [Hướng dẫn thiết lập và quản trị](thiet-lap.md) | Ban Tổng Giám đốc, lãnh đạo bộ phận, người quản lý dự án, văn thư, thư ký giao ban, quản trị hệ thống | **Mọi màn thiết lập, từng ô, từng nút**: tạo dự án, **Cài đặt** dự án, MTL và ngưỡng cảnh báo, quy trình duyệt; **Thiết lập văn thư**, quy chế nội bộ, số văn bản; thiết lập giao ban; Nhân sự, Đối tác; Quản trị hệ thống; thiết lập cá nhân. Có bảng tra nhanh "muốn làm gì thì vào đâu" và hỏi đáp |

Không gửi tài liệu lãnh đạo và tài liệu thiết lập cho toàn bộ nhân viên. Phần thiết lập cá nhân mọi người cần đã có trong bản nhân viên.

Xuất Word / PDF: `tools/xuat-huong-dan/build_docx.py` (cả ba bộ). Không sửa tay tệp Word / PDF.

Mỗi nghiệp vụ có hai đường: **làm trên giao diện** (ảnh từng bước) và **làm nhanh bằng Claude desktop** với tiện ích Kepler Hub và skill `kepler-hub` / `kepler-luu-tai-lieu` (câu mẫu, Claude làm gì, việc gì vẫn phải tự làm trên giao diện).

## Ảnh

- `anh/*.png`: chụp tự động trên **bản cài thử, dữ liệu giả** bằng `app/e2e/huong-dan/chup-anh.mjs`. Cách chụp lại khi giao diện đổi: [chup-anh.md](chup-anh.md).
- Ảnh màn hình **Claude desktop** không chụp tự động được: `anh/claude-*.png` chụp tay trên máy thật (đã che thông tin cá nhân), danh sách trong [chup-anh.md](chup-anh.md).

## Đề xuất sửa skill

[de-xuat-skill.md](de-xuat-skill.md): những chỗ skill `kepler-hub` cần bổ sung để khớp hệ thống hiện tại (quan trọng nhất: đặt 100% trên việc MTL = gửi duyệt; HR / CRM đang tắt trên bản chạy thật).

## Cập nhật khi nào

- Giao diện đổi nhãn nút / bố cục → chụp lại ảnh, sửa chữ tương ứng.
- Đổi màn thiết lập, đổi luật quyền → sửa chương tương ứng trong `thiet-lap.md` (ảnh màn thiết lập là nhóm `anh/30-*`).
- Quy chế quản lý dự án (RACI) ban hành → sửa mục "Ai làm gì" trong tài liệu lãnh đạo, mục 4.1 tài liệu nhân viên, và skill `kepler-hub`.
- Nhân sự, Đối tác bật trên bản chạy thật từ 25/11/2026. Tắt lại (`MODULES` trong `.env`) → sửa các ghi chú "đã bật" trong ba bộ tài liệu.
