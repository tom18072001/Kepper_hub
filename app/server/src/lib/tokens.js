// Token cá nhân cho Claude (MCP chạy trên máy người dùng, kết nối qua Claude Desktop của tài khoản Claude Team công ty).
// NGUYÊN TẮC: AI = người dùng. Token mang danh tính và quyền của chính người tạo; không có token hệ thống / tài khoản dịch vụ.
// - Lưu băm SHA-256; token chỉ hiện một lần; hạn tối đa 90 ngày; thu hồi được; khoá tài khoản / đổi mật khẩu → token mất hiệu lực.
// - Phạm vi: read = chỉ đọc (GET); write = thêm các thao tác thường ngày trong danh sách cho phép bên dưới.
// - Thao tác không thể hoàn tác / mang tính phê duyệt (nộp báo cáo, phát hành giao ban, duyệt, xoá, xuất tệp, quản trị, mật khẩu)
//   KHÔNG làm qua token: người dùng tự làm trên giao diện (người quyết định cuối cùng là con người).
const crypto = require('node:crypto');

const PREFIX = 'kpt_';
const MAX_DAYS = 90;
const SCOPES = ['read', 'write'];
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => PREFIX + crypto.randomBytes(32).toString('base64url');
const isToken = s => typeof s === 'string' && s.startsWith(PREFIX) && s.length > 20;

// GET bị chặn với token: xuất tệp hàng loạt, luồng realtime (AI không cần), tải tệp đính kèm gốc.
const READ_DENY = [/\.(xlsx|docx|pdf)$/, /^\/api\/stream$/, /^\/api\/attachments\/\d+\/download$/, /^\/api\/admin\//, /^\/api\/me\/tokens/];
// Ghi cho phép với phạm vi write (khớp method + đường dẫn). Mọi đường khác → 403 "làm trên giao diện".
const WRITE_ALLOW = [
  ['PATCH', /^\/api\/items\/\d+$/],                 // % / nội dung / người phụ trách — vẫn qua mtl-guard + policy
  ['POST', /^\/api\/items\/\d+\/comments$/],
  ['POST', /^\/api\/items\/\d+\/checklist$/], ['PATCH', /^\/api\/checklist\/\d+$/],
  ['POST', /^\/api\/items\/\d+\/move$/],
  ['POST', /^\/api\/projects\/\d+\/items$/],        // giao việc (MTL: mtl-guard)
  ['POST', /^\/api\/items\/\d+\/progress-reports$/],
  ['POST', /^\/api\/items\/\d+\/extensions$/],      // đề nghị gia hạn (người giao quyết định trên giao diện)
  ['POST', /^\/api\/me\/notes$/], ['PATCH', /^\/api\/me\/notes\/\d+$/], // nhắc việc cá nhân
  ['POST', /^\/api\/notifications\/(\d+\/read|read-all)$/],
  ['PUT', /^\/api\/weekly\/report$/],               // lưu NHÁP báo cáo tuần (nộp: trên giao diện)
  ['POST', /^\/api\/weekly\/notices$/],
  // Playground CRM / HRM (khi có module): nhật ký làm việc với đối tác, đơn nghỉ phép của chính mình.
  ['POST', /^\/api\/crm\/partners\/\d+\/interactions$/], ['POST', /^\/api\/crm\/followups\/\d+\/done$/],
  ['POST', /^\/api\/hrm\/leaves$/],
];

// Trả về null nếu được phép, hoặc lý do từ chối.
function tokenDenied(method, path, scopes) {
  const m = String(method).toUpperCase();
  if (m === 'GET' || m === 'HEAD') return READ_DENY.some(re => re.test(path)) ? 'Thao tác này không làm qua Claude (xuất tệp / quản trị) — làm trên giao diện Kepper' : null;
  if (!scopes.includes('write')) return 'Token chỉ đọc — tạo token có quyền ghi để Claude cập nhật';
  return WRITE_ALLOW.some(([mm, re]) => mm === m && re.test(path)) ? null
    : 'Thao tác này cần người dùng tự làm trên giao diện Kepper (nộp, phê duyệt, xoá, phát hành, quản trị)';
}

module.exports = { PREFIX, MAX_DAYS, SCOPES, sha256, newToken, isToken, tokenDenied, WRITE_ALLOW, READ_DENY };
