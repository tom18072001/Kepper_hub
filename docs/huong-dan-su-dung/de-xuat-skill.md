# Đề xuất sửa skill `kepler-hub` (và tiện ích MCP) để hướng dẫn chạy trơn tru

Rà bản skill `kepler-hub` đang chờ duyệt, đối chiếu với `app/mcp/server.js`, `app/server/src/lib/tokens.js`, `app/server/src/routes/items.js` trên `main` (`203cbaf`). Chưa sửa skill — chỉ đề xuất.

## A. Sửa trong skill (không cần đổi mã)

| # | Mức | Vấn đề | Đề xuất |
|---|---|---|---|
| 1 | **Cao** | Skill ghi "gửi duyệt" thuộc nhóm *không có qua Claude*. Thực tế với việc trong dự án MTL, `kepper_update_progress` đặt `progress = 100` thì Hub **tự chuyển sang "Chờ duyệt"** (`routes/items.js:380-388`) — tức là gửi duyệt. | Thêm quy tắc: "100% trên việc MTL = gửi duyệt. Trước khi đặt 100%, nói rõ cho người dùng *việc sẽ chuyển sang Chờ duyệt, người giao / Ban Tổng Giám đốc sẽ nhận phiếu* và chờ họ đồng ý. Người dùng chỉ muốn ghi gần xong thì đặt 90–99%." |
| 2 | **Cao** | Bản chạy thật đang `MODULES=vanthu`: **Nhân sự và Đối tác tắt**. Gọi `kepper_hr_*`, `kepper_crm_*` sẽ lỗi 404 "Không tìm thấy API". Quy trình "Hôm nay tôi có gì?" lại gọi `kepper_hr_leaves scope=approve`. | Thêm: "Tool HR / CRM báo *Không tìm thấy API* = phân hệ chưa bật trên Kepler Hub. Nói một câu cho người dùng, không thử lại, bỏ phần đó khỏi tổng hợp." |
| 3 | Trung bình | Mục Kết nối: "Không thấy tool `kepper_*` → liên hệ IT để cài". Người dùng tự cài được. | Đổi thành: "Vào Kepler Hub → tên tài khoản → **Kết nối Claude** → tải `kepper-claude.mcpb`, kéo vào Claude desktop → Install, để trống ô Token." |
| 4 | Trung bình | Lỗi "Chưa xác thực" có hai nguồn: kết nối nhanh hết hạn (tự mở lại trang Cho phép) và **token tạo tay** (ô Token đã điền) — trường hợp sau không tự mở trang Cho phép. | Thêm: "Nếu đã dán token tay: tạo token mới ở trang Kết nối Claude, dán lại vào cấu hình tiện ích; hoặc xoá ô Token để dùng kết nối nhanh." |
| 5 | Trung bình | Thiếu hai thông báo lỗi người dùng sẽ gặp: "Tài khoản phải đổi mật khẩu trên giao diện trước" (`PASSWORD_CHANGE_REQUIRED`) và "Token chỉ đọc — tạo token có quyền ghi…" (lúc Cho phép đã chọn **Chỉ xem**). | Thêm vào mục Kết nối: đổi mật khẩu trên giao diện rồi kết nối lại; kết nối Chỉ xem → thu hồi, kết nối lại chọn **Xem và cập nhật**. |
| 6 | Trung bình | **Xin gia hạn**: server cho token gọi `POST /api/items/:id/extensions` nhưng MCP chưa có tool. Skill chỉ nói "duyệt gia hạn" là việc trên giao diện, không nói xin gia hạn. Người chủ trì hỏi Claude "xin gia hạn BM-11" sẽ không rõ đường. | Thêm: "Xin gia hạn: hướng dẫn người dùng mở việc → **Xin gia hạn** trên giao diện (Claude có thể soạn sẵn lý do)." |
| 7 | Trung bình | **Văn thư** không có tool MCP nào, skill không nói. Người dùng hỏi "văn bản nào giao tôi xử lý?" Claude dễ đoán. | Thêm: "Sổ văn thư (đến / đi / nội bộ) chưa xem được qua Claude — mở Kepler Hub → Văn thư → *Tôi xử lý*. Hỏi lưu tài liệu ở đâu → skill `kepler-luu-tai-lieu`." |
| 8 | Thấp | `kepper_update_progress` kèm `note` ghi thành **bình luận**, không phải "Báo cáo tiến độ" (không có ô khó khăn / **kiến nghị** gửi lãnh đạo). | Thêm: "Muốn gửi kiến nghị cho lãnh đạo: dùng *Báo cáo tiến độ* trên giao diện; bình luận qua Claude không tạo kiến nghị." |
| 9 | Thấp | Skill gọi tool là `Kepler_Hub__kepper_*`; tên tiền tố phụ thuộc client. | Ghi "bộ tool `kepper_*` của tiện ích Kepler Hub". |
| 10 | Thấp | "Tổng hợp giao ban (chỉ khi `canSummary`)" — đúng; nên thêm câu: Claude chỉ có bản tổng hợp **tóm tắt**, không có điểm danh, kết luận TGĐ, Action Log, chấm điểm. | Thêm một câu để Claude không hứa làm các bước đó. |
| 11 | Thấp | Thiếu câu mẫu "Tôi là ai trong Kepler Hub?" làm bước kiểm tra đầu — tài liệu hướng dẫn dùng câu này. | Giữ bước 1 (`kepper_whoami`), thêm: khi người dùng hỏi "tôi là ai / tôi được làm gì qua Claude", trả lời kèm danh sách việc chỉ làm trên giao diện. |

## B. Đề xuất đổi tiện ích MCP (việc riêng, cần PR khác)

| # | Đề xuất | Lý do |
|---|---|---|
| B1 | `kepper_whoami` trả thêm `boardAll` (BTGĐ phụ trách toàn công ty), danh sách bộ phận Phó TGĐ phụ trách và `modules` đang bật | Claude biết người dùng có quyền BTGĐ phụ trách của việc nào, và biết HR / CRM có bật không mà không phải thử lỗi |
| B2 | Thêm tool `kepper_request_extension` (đề nghị gia hạn — server đã cho phép) | Người chủ trì xin gia hạn qua Claude; quyết định vẫn là Ban Tổng Giám đốc trên giao diện |
| B3 | Thêm tool `kepper_progress_report` (POST `/api/items/:id/progress-reports`, server đã cho phép) | Gửi báo cáo tiến độ có khó khăn / kiến nghị, đúng luồng kiến nghị của lãnh đạo |
| B4 | Cân nhắc chặn `progress = 100` qua token, hoặc trả về rõ "đã gửi duyệt" trong kết quả `kepper_update_progress` | Hiện tool trả lại tóm tắt việc, Claude phải tự nhận ra trạng thái đã thành "Chờ duyệt" |
| B5 | Tool chỉ đọc cho Văn thư (`kepper_vanthu_mine`: văn bản giao tôi xử lý, hạn) | Câu hỏi hay gặp của nhân viên; dữ liệu theo đúng quyền sổ văn thư |
