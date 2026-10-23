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

// GET bị chặn với token: xuất tệp, tải / xem tệp đính kèm gốc, luồng realtime (AI không cần), quản trị, token, mã liên kết Viber.
// Số định danh đầy đủ (CCCD): không bao giờ qua Claude — route cũng tự chặn (hai lớp).
const READ_DENY = [/\.(xlsx|docx|pdf|csv|zip)$/, /^\/api\/stream$/, /^\/api\/attachments\/\d+\/(download|preview)$/, /^\/api\/admin(\/|$)/, /^\/api\/me\/tokens(\/|$)/,
  /^\/api\/me\/viber(\/|$)/, /^\/api\/hrm\/people\/\d+\/identity$/, /^\/api\/claude\/connect(\/|$)/];
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

// Chuẩn hoá đường dẫn như Express 5 khớp route (không phân biệt hoa thường, bỏ "/" cuối) — và chặt hơn: giải mã %xx, gộp "//".
// Không chuẩn hoá thì "/api/projects/3/export.xlsx/" hay ".XLSX" lọt qua danh sách chặn mà vẫn tới đúng route.
function normPath(p) {
  let s = String(p || '').split('?')[0];
  try { s = decodeURIComponent(s); } catch { /* giữ nguyên */ }
  return s.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
}
// Trả về null nếu được phép, hoặc lý do từ chối.
function tokenDenied(method, rawPath, scopes) {
  const m = String(method).toUpperCase();
  const path = normPath(rawPath);
  if (m === 'GET' || m === 'HEAD') return READ_DENY.some(re => re.test(path)) ? 'Thao tác này không làm qua Claude (xuất tệp / quản trị) — làm trên giao diện Kepper' : null;
  if (!scopes.includes('write')) return 'Token chỉ đọc — tạo token có quyền ghi để Claude cập nhật';
  return WRITE_ALLOW.some(([mm, re]) => mm === m && re.test(path)) ? null
    : 'Thao tác này cần người dùng tự làm trên giao diện Kepper (nộp, phê duyệt, xoá, phát hành, quản trị)';
}

// Lớp thứ hai trong từng route xuất / tải tệp: lời gọi qua token (req.via) bị từ chối dù danh sách chặn có sót.
function assertNotVia(req) {
  if (req.via) { const e = new Error('Xuất / tải tệp không làm qua Claude — làm trên giao diện Kepper'); e.status = 403; e.code = 'NOT_VIA_AI'; throw e; }
}
module.exports = { assertNotVia, PREFIX, MAX_DAYS, SCOPES, sha256, newToken, isToken, tokenDenied, normPath, WRITE_ALLOW, READ_DENY };
