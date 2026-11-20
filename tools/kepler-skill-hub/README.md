# Skill "kepler-hub" — Claude làm việc với Kepler Hub đúng quyền, đúng quy trình

Skill cho Claude (claude.ai / Claude Desktop của tài khoản Team Kepler), dùng cùng tiện ích Claude Desktop `app/mcp`
(bộ tool `kepper_*`): xem việc, việc nhánh, dự án, việc chờ duyệt, soạn nháp báo cáo tuần, giao ban, HR, CRM, nhắc việc.
Skill dạy Claude quyền tối thiểu theo vai trên một việc, luồng Gửi duyệt → duyệt + chấm mức, và những bước người dùng
phải tự làm trên giao diện (gửi duyệt, duyệt, chấm mức, gia hạn, duyệt đơn nghỉ, nộp báo cáo).

Hỏi chuyện lưu tài liệu lên NAS → skill `tools/kepler-skill-luu-tai-lieu`.

## Đóng gói

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File pack.ps1   # → dist/kepler-hub.zip
```

## Cài cho cả công ty

Quản trị viên tài khoản Claude Team tải `dist/kepler-hub.zip` lên mục Skills của tổ chức (claude.ai, phần cài đặt
quản trị), **thay bản `kepler-hub` cũ**, và bật cho thành viên. Mỗi người cũng có thể tự tải lên trong
Settings → Capabilities → Skills.

## Sửa

Đổi quyền, luồng duyệt hay bộ tool `kepper_*` → sửa `kepler-hub/SKILL.md` cùng PR với thay đổi mã, đóng gói lại, tải lên
thay bản cũ. Khi quy chế quản lý dự án (RACI) ban hành: thay mục "Giới hạn hiện tại".
