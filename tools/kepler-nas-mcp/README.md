# Kepler NAS — Claude đọc kho file nội bộ

Tiện ích Claude Desktop (MCP chạy trên máy người dùng). Claude đọc được kho file `\\192.168.130.2\DATA`
**chỉ đọc**, bằng **chính tài khoản Windows của người dùng** — quyền thư mục IT cấp (NTFS) được áp nguyên.
Không liên quan Kepler Hub; dùng được trong mọi Project của Claude Desktop, kể cả "Hỏi Keplerholdings".

| Công cụ | Việc |
| --- | --- |
| `nas_roots` | Thư mục được phép đọc, tài khoản hiện tại có mở được không |
| `nas_list` | Liệt kê thư mục |
| `nas_search` | Tìm tệp theo tên (không dấu), tối đa 20 giây / 5.000 thư mục |
| `nas_read` | Đọc chữ: TXT/CSV/MD, DOCX, XLSX, PPTX, PDF có lớp chữ (PDF scan: không) |

Không có công cụ ghi, sửa, xoá, chép tệp ra ngoài. Không thư viện ngoài (chỉ Node ≥ 18 có sẵn trong Claude Desktop).

## Đóng gói và cài

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File pack.ps1   # → dist/kepler-nas.mcpb
node --test test/server.test.mjs
```

Người dùng: nhấn đúp `kepler-nas.mcpb` → Claude Desktop mở hộp cài → **Install**. Máy phải ở văn phòng hoặc bật VPN,
và mở được `\\192.168.130.2\DATA` trong File Explorer (máy trong domain tự đăng nhập; máy ngoài domain đăng nhập
một lần bằng tài khoản `KEPLER\...`, chọn "Remember my credentials").

## Giới hạn

- Chỉ chạy trong **Claude Desktop** trên máy Windows có mạng công ty; không chạy trên claude.ai (web) hay điện thoại.
- Nội dung tệp Claude đọc được gửi lên Claude như mọi tin nhắn — tuân quy định sử dụng AI QC-IT-01; tài liệu mật
  nên để ở thư mục mà người dùng không có quyền đọc, hoặc chặn bằng quyền NTFS.
