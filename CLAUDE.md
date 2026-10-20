# Hướng dẫn cho agent — Kepper Hub

- Phạm vi: hệ thống theo dõi tiến độ dự án bất động sản của Kepper (Master Timeline — MTL tổng và MTL bộ phận),
  cảnh báo nhanh / chậm tiến độ, KPI tiến độ, dashboard, dự án dùng chung và cowork giữa các bộ phận.
  Khởi tạo từ WorkHub (repo tom18072001/ND57, nhánh `workhub-kanban`). Kế hoạch: `docs/PLAN-kepper.md`.
- Không commit thẳng vào `main`. Mỗi giai đoạn làm trên branch `kepper/<giai-đoạn>` từ `main`, merge qua PR.
- Không thay đổi tiêu chí đăng nhập/mật khẩu và luồng cấp quyền khi tạo tài khoản trừ khi chủ dự án yêu cầu.

## Dữ liệu
- Bảng MTL thật của dự án (vd. SPV NƠXH) là dữ liệu kinh doanh **Bảo mật**: chỉ nhập trên máy chạy bằng chức năng
  "Nhập MTL từ Excel"; KHÔNG đưa tệp MTL thật, tên người thật, số liệu thật vào git, seed hay test. Repo chỉ dùng dữ liệu mẫu giả.

## Data Protection Gate (bắt buộc)

Dự án tuân theo "Khung bảo vệ dữ liệu trong Quản trị dữ liệu".
- Trước khi chốt thiết kế, kịch bản hoặc thay đổi lớn về dữ liệu, AI/agent PHẢI chạy đánh giá bảo vệ dữ liệu
  (5 lớp, 25 năng lực GOV/PRE/DET/PRI/RES, pháp lý VN) và đưa khuyến nghị cho chủ dự án.
- Mọi tập dữ liệu mang nhãn nội bộ (Công khai/Nội bộ/Bảo mật/Hạn chế) + phân loại pháp lý; nhiều tiêu chí → mức cao nhất.
- Không dùng dữ liệu thật trên DEV/UAT; PII phải được che/token hóa trước khi vào log, index, môi trường phân tích.
- Nhật ký: xử lý dữ liệu cốt lõi/quan trọng ≥ 6 tháng; nhật ký hệ thống truy xuất ≥ 12 tháng; log làm chứng cứ phải bất biến (WORM, băm, ký số).
- Sự cố DLCN: thông báo ≤ 72 giờ. Chuyển xuyên biên giới / xử lý DLCN (vd. gửi thông báo qua Viber): hồ sơ đánh giá tác động.
- Kết quả đánh giá lưu tại: docs/data-protection-assessment.md
