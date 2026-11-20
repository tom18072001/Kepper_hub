# Hướng dẫn sử dụng Kepler Hub

Hai bộ tài liệu, chia theo người đọc:

| Tài liệu | Gửi cho | Nội dung |
|---|---|---|
| [Hướng dẫn cho nhân viên](nhan-vien.md) | Mọi nhân viên | Đăng nhập, chứng chỉ, kết nối Claude desktop, cài skill; làm việc dự án ở vai người chủ trì / phối hợp; Cập nhật nhanh; báo cáo tuần; văn bản giao xử lý; chấm công, xin nghỉ; đối tác; nhắc việc; lỗi thường gặp |
| [Hướng dẫn cho lãnh đạo](lanh-dao.md) | Ban Giám đốc, lãnh đạo bộ phận, PMO, thư ký giao ban | Vai và quyền; theo dõi tiến độ, KPI; giao việc; duyệt và chấm mức; duyệt gia hạn, kiến nghị; báo cáo tuần bộ phận; giao ban, Action Log, chấm điểm; vào sổ văn thư; duyệt đơn nghỉ, bảng công |

Không gửi tài liệu lãnh đạo cho toàn bộ nhân viên.

Mỗi nghiệp vụ có hai đường: **làm trên giao diện** (ảnh từng bước) và **làm nhanh bằng Claude desktop** với tiện ích Kepler Hub và skill `kepler-hub` / `kepler-luu-tai-lieu` (câu mẫu, Claude làm gì, việc gì vẫn phải tự làm trên giao diện).

## Ảnh

- `anh/*.png`: chụp tự động trên **bản cài thử, dữ liệu giả** bằng `app/e2e/huong-dan/chup-anh.mjs`. Cách chụp lại khi giao diện đổi: [chup-anh.md](chup-anh.md).
- Ảnh màn hình **Claude desktop** không chụp tự động được: `anh/claude-*.png` chụp tay trên máy thật (đã che thông tin cá nhân), danh sách trong [chup-anh.md](chup-anh.md).

## Đề xuất sửa skill

[de-xuat-skill.md](de-xuat-skill.md): những chỗ skill `kepler-hub` cần bổ sung để khớp hệ thống hiện tại (quan trọng nhất: đặt 100% trên việc MTL = gửi duyệt; HR / CRM đang tắt trên bản chạy thật).

## Cập nhật khi nào

- Giao diện đổi nhãn nút / bố cục → chụp lại ảnh, sửa chữ tương ứng.
- Quy chế quản lý dự án (RACI) ban hành → sửa mục "Ai làm gì" trong tài liệu lãnh đạo, mục 4.1 tài liệu nhân viên, và skill `kepler-hub`.
- Bật Nhân sự / Đối tác trên bản chạy thật → bỏ ghi chú "phân hệ chưa bật".
