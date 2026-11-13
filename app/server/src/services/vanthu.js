// Văn thư — quy tắc của "Quy định văn thư, lưu trữ" (QyĐ-GA-01): dãy số, số và ký hiệu, hạn xử lý theo độ khẩn, quyền xem.
// Thuần (không đụng CSDL) trừ vanthuConfig — để kiểm thử từng quy tắc (vanthu.test.js).
const WK = require('./weekly');

const CONFIG_KEY = 'vanthu.config';
const BOOKS = { DEN: 'Văn bản đến', DI: 'Văn bản đi', NOIBO: 'Văn bản nội bộ' };
// Điều 7.2 — dãy số nội bộ (D5–D7), đi (D9), đến (D10). Hợp đồng (D11, D12) theo dõi ở mục Đối tác / Nhân sự.
const SERIES = {
  D5: { book: 'NOIBO', label: 'D5 · Quyết định của TGĐ / GĐ' },
  D6: { book: 'NOIBO', label: 'D6 · Văn bản cấp Ban Điều hành (tờ trình, thông báo, kế hoạch, báo cáo)' },
  D7: { book: 'NOIBO', label: 'D7 · Văn bản nội bộ của bộ phận' },
  D9: { book: 'DI', label: 'D9 · Văn bản đi' },
  D10: { book: 'DEN', label: 'D10 · Văn bản đến' },
};
const SECURITY = { CONG_KHAI: 'Công khai', NOI_BO: 'Nội bộ', HAN_CHE: 'Hạn chế', BAO_MAT_CAO: 'Bảo mật cao' };
const URGENCY = { THUONG: 'Thường', KHAN: 'Khẩn', THUONG_KHAN: 'Thượng khẩn', HOA_TOC: 'Hỏa tốc' };
// Điều 12 — thời hạn xử lý văn bản đến khi văn bản không ghi hạn (ngày làm việc).
const DUE_WORKDAYS = { HOA_TOC: 0, THUONG_KHAN: 1, KHAN: 3, THUONG: 7 };
// Điều 11 — trạng thái theo dõi.
const STATUS = {
  DEN: { RECEIVED: 'Đã tiếp nhận', SUBMITTED: 'Đã trình', ASSIGNED: 'Đã giao xử lý', PROCESSING: 'Đang xử lý', DONE: 'Đã hoàn thành', FILED: 'Đã lập hồ sơ' },
  DI: { NUMBERED: 'Đã cấp số', SENT: 'Đã gửi', CONFIRMED: 'Bên nhận đã xác nhận', REPLIED: 'Đã có phản hồi' },
  NOIBO: { ISSUED: 'Đã ban hành', EFFECTIVE: 'Hiệu lực', EXPIRED: 'Hết hiệu lực / thay thế' },
};
const FIRST = { DEN: 'RECEIVED', DI: 'NUMBERED', NOIBO: 'ISSUED' };
const CLOSED = new Set(['DONE', 'FILED', 'CONFIRMED', 'REPLIED', 'EXPIRED']);
// Phụ lục 1 (rút gọn) — tên loại viết tắt hay dùng; người dùng được nhập loại khác (chữ in hoa, 2–6 ký tự).
const DOC_TYPES = { CV: 'Công văn', TB: 'Thông báo', QĐ: 'Quyết định', TTr: 'Tờ trình', BC: 'Báo cáo', KH: 'Kế hoạch', BB: 'Biên bản', GUQ: 'Giấy ủy quyền', GGT: 'Giấy giới thiệu', ĐX: 'Đề xuất', CT: 'Chỉ thị' };

const DEFAULTS = { entities: [{ code: 'HLD', name: 'Công ty mẹ' }], clerkUserIds: [], legalUserIds: [] };
async function vanthuConfig(prisma) {
  const row = await prisma.appSetting.findUnique({ where: { key: CONFIG_KEY } });
  const v = row?.value && typeof row.value === 'object' ? row.value : {};
  const entities = Array.isArray(v.entities) ? v.entities.filter(e => /^[A-Z]{2,6}$/.test(e?.code) && e.name).map(e => ({ code: e.code, name: String(e.name).slice(0, 120) })) : [];
  const ids = k => (Array.isArray(v[k]) ? v[k].map(Number).filter(Number.isInteger) : []);
  return { entities: entities.length ? entities : DEFAULTS.entities, clerkUserIds: ids('clerkUserIds'), legalUserIds: ids('legalUserIds') };
}

const pad = (n, w) => String(n).padStart(w, '0');
// Điều 7.1: tối thiểu 3 chữ số (đến: 4), vượt ngưỡng thì thêm chữ số. Ký hiệu theo 7.2; mã pháp nhân HLD / DXA.
function numberOf({ series, entity, year, seq, docType, deptCode, holding = true }) {
  if (series === 'D10') return `${pad(seq, 4)}/${year}/Đ-${entity}`;
  if (series === 'D9') return `${pad(seq, 3)}/${year}/${!docType || docType === 'CV' ? `${entity}${deptCode ? '-' + deptCode : ''}` : `${docType}-${entity}`}`;
  if (series === 'D5') return `${pad(seq, 3)}/${year}/QĐ-${entity}`;
  if (series === 'D6') return `${pad(seq, 3)}/${year}/${docType || 'TB'}-${holding ? 'TGĐ' : 'GĐ.' + entity}`;
  if (series.startsWith('D7-')) return `${pad(seq, 3)}/${year}/${docType || 'BC'}-${series.slice(3)}`;
  throw new Error('Dãy số không hợp lệ: ' + series);
}
// Dãy D7 tách theo bộ phận (mỗi bộ phận một dãy, đầu mối văn thư bộ phận cấp số).
const seriesKey = (series, deptCode) => (series === 'D7' ? `D7-${deptCode}` : series);

// Cộng n ngày làm việc (n = 0: trong ngày). cfg: { workDays, holidays } như thiết lập Nhân sự.
function addWorkdays(day, n, cfg) {
  const ok = d => cfg.workDays.includes(WK.weekday(d)) && !cfg.holidays.includes(d);
  let d = day;
  while (!ok(d)) d = WK.addDays(d, 1); // nhận ngày nghỉ → tính từ ngày làm việc kế tiếp
  for (let i = 0; i < n; i++) { d = WK.addDays(d, 1); while (!ok(d)) d = WK.addDays(d, 1); }
  return d;
}
const dueFor = (urgency, receivedDay, cfg) => addWorkdays(receivedDay, DUE_WORKDAYS[urgency] ?? 7, cfg);

// Quyền xem (Điều 5): Công khai / Nội bộ — mọi cán bộ; Hạn chế — văn thư, Ban GĐ, người xử lý, bộ phận xử lý, Pháp chế khi được chuyển;
// Bảo mật cao — Ban GĐ, văn thư vào sổ, người xử lý và danh sách đích danh.
function canView(doc, s) {
  if (s.it) return false; // quản trị IT không đọc nội dung nghiệp vụ
  if (doc.security === 'CONG_KHAI' || doc.security === 'NOI_BO') return true;
  if (s.director || doc.handlerId === s.userId || doc.createdById === s.userId) return true;
  if (doc.security === 'BAO_MAT_CAO') return (doc.viewerIds || []).includes(s.userId);
  return s.clerk || (doc.departmentId != null && doc.departmentId === s.departmentId) || (doc.toLegal && s.legal);
}
// Vào sổ, sửa, hủy: văn thư (do Ban GĐ chỉ định) và Ban GĐ; dãy D7 thêm lãnh đạo bộ phận đó (đầu mối văn thư bộ phận).
const canRegister = (s, series, deptId = null) => !s.it && (s.director || s.clerk || (series === 'D7' && s.leader && deptId === s.departmentId));
// Đổi trạng thái: người vào sổ được mọi bước; người xử lý / lãnh đạo bộ phận xử lý được các bước xử lý của mình.
const HANDLER_STEPS = new Set(['PROCESSING', 'DONE']);
function canStatus(doc, s, to) {
  if (s.it || doc.cancelledAt) return false;
  if (s.director || s.clerk) return true;
  return HANDLER_STEPS.has(to) && (doc.handlerId === s.userId || (s.leader && doc.departmentId === s.departmentId));
}
const isOverdue = (doc, today) => !!doc.dueDate && !doc.cancelledAt && !CLOSED.has(doc.status) && doc.dueDate < today;

module.exports = { CONFIG_KEY, BOOKS, SERIES, SECURITY, URGENCY, DUE_WORKDAYS, STATUS, FIRST, CLOSED, DOC_TYPES, vanthuConfig, numberOf, seriesKey,
  addWorkdays, dueFor, canView, canRegister, canStatus, isOverdue };
