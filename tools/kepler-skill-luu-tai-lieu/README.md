# Skill "kepler-luu-tai-lieu" — Claude chỉ nhân viên lưu tài liệu đúng chỗ

Skill cho Claude (claude.ai / Claude Desktop của tài khoản Team Kepler): chọn thư mục phòng ban trên NAS
`\\192.168.130.2\DATA`, đặt tên tệp đúng quy ước, chuyển văn bản đến / đi / nội bộ và tài liệu dự án sang Kepler Hub.
Claude chỉ chỉ đường dẫn; người dùng tự chép tệp. Kết hợp tốt nhất với tiện ích Claude Desktop `tools/kepler-nas-mcp`
(chỉ đọc) để Claude xem được thư mục thật mà tài khoản Windows của người dùng mở được.

## Đóng gói

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File pack.ps1   # → dist/kepler-luu-tai-lieu.zip
```

## Cài cho cả công ty

Quản trị viên tài khoản Claude Team tải `dist/kepler-luu-tai-lieu.zip` lên mục Skills của tổ chức (claude.ai, phần cài
đặt quản trị) và bật cho thành viên. Mỗi người cũng có thể tự tải lên trong Settings → Capabilities → Skills.

## Sửa

Đổi cấu trúc thư mục trên NAS → sửa `kepler-luu-tai-lieu/references/thu-muc.md` và bảng "Chọn chỗ lưu" trong
`SKILL.md`, đóng gói lại, tải lên thay bản cũ.
