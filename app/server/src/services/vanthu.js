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
  // Sổ nội bộ (quy chế, quy định — docs/de-xuat-quy-che-phe-duyet.md): dự thảo chưa có số; số cấp lúc Người phê duyệt bấm Phê duyệt.
  NOIBO: { DRAFT: 'Chưa phê duyệt', RETURNED: 'Đã trả lại', APPROVED: 'Đã phê duyệt', EFFECTIVE: 'Hiệu lực', EXPIRED: 'Hết hiệu lực / thay thế' },
};
const FIRST = { DEN: 'RECEIVED', DI: 'NUMBERED', NOIBO: 'DRAFT' };
const CLOSED = new Set(['DONE', 'FILED', 'CONFIRMED', 'REPLIED', 'EXPIRED']);
// Phụ lục 1 (rút gọn) — tên loại viết tắt hay dùng; người dùng được nhập loại khác (chữ in hoa, 2–6 ký tự).
const DOC_TYPES = { CV: 'Công văn', TB: 'Thông báo', QĐ: 'Quyết định', TTr: 'Tờ trình', BC: 'Báo cáo', KH: 'Kế hoạch', BB: 'Biên bản', GUQ: 'Giấy ủy quyền', GGT: 'Giấy giới thiệu', ĐX: 'Đề xuất', CT: 'Chỉ thị' };

const DEFAULTS = { entities: [{ code: 'HLD', name: 'Công ty mẹ' }], clerkUserIds: [], legalUserIds: [], approverUserIds: [] };
async function vanthuConfig(prisma) {
  const row = await prisma.appSetting.findUnique({ where: { key: CONFIG_KEY } });
  const v = row?.value && typeof row.value === 'object' ? row.value : {};
  const entities = Array.isArray(v.entities) ? v.entities.filter(e => /^[A-Z]{2,6}$/.test(e?.code) && e.name).map(e => ({ code: e.code, name: String(e.name).slice(0, 120) })) : [];
  const ids = k => (Array.isArray(v[k]) ? v[k].map(Number).filter(Number.isInteger) : []);
  return { entities: entities.length ? entities : DEFAULTS.entities, clerkUserIds: ids('clerkUserIds'), legalUserIds: ids('legalUserIds'), approverUserIds: ids('approverUserIds') };
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

// Quyền xem (Điều 5): Công khai / Nội bộ — mọi cán bộ; Hạn chế — văn thư, Ban TGĐ, người xử lý, bộ phận xử lý, Pháp chế khi được chuyển;
// Bảo mật cao — Ban TGĐ, văn thư vào sổ, người xử lý và danh sách đích danh.
function canView(doc, s) {
  if (s.it) return false; // quản trị IT không đọc nội dung nghiệp vụ
  if (doc.book === 'NOIBO') return canViewNoibo(doc, s);
  if (doc.security === 'CONG_KHAI' || doc.security === 'NOI_BO') return true;
  if (s.director || doc.handlerId === s.userId || doc.createdById === s.userId) return true;
  if (doc.security === 'BAO_MAT_CAO') return (doc.viewerIds || []).includes(s.userId);
  return s.clerk || (doc.departmentId != null && doc.departmentId === s.departmentId) || (doc.toLegal && s.legal);
}
// Vào sổ, sửa, hủy: văn thư (do Ban TGĐ chỉ định) và Ban TGĐ; dãy D7 thêm lãnh đạo bộ phận đó (đầu mối văn thư bộ phận).
const canRegister = (s, series, deptId = null) => !s.it && (s.director || s.clerk || (series === 'D7' && s.leader && deptId === s.departmentId));
// Đổi trạng thái: người vào sổ được mọi bước; người xử lý / lãnh đạo bộ phận xử lý được các bước xử lý của mình.
const HANDLER_STEPS = new Set(['PROCESSING', 'DONE']);
function canStatus(doc, s, to) {
  if (s.it || doc.cancelledAt) return false;
  if (s.director || s.clerk) return true;
  return HANDLER_STEPS.has(to) && (doc.handlerId === s.userId || (s.leader && doc.departmentId === s.departmentId));
}
const isOverdue = (doc, today) => !!doc.dueDate && !doc.cancelledAt && !CLOSED.has(doc.status) && doc.dueDate < today;

// Gắn văn bản trong sổ vào "Văn bản liên quan" của việc: số, trích yếu… chép sang việc thì AI XEM ĐƯỢC VIỆC đều thấy, nên chỉ cho
// gắn văn bản mọi cán bộ vốn đã xem được trong sổ (Công khai / Nội bộ) và chưa hủy số. Hạn chế / Bảo mật cao không gắn được — vẫn xem
// trong sổ theo canView như cũ (quyền xem sổ không đổi). Điều kiện cũng phải qua canView (vd. quản trị IT không thấy gì).
const LINKABLE_SECURITY = ['CONG_KHAI', 'NOI_BO'];
// Sổ nội bộ: chỉ tài liệu ĐÃ PHÊ DUYỆT cấp "Mọi người" (ai xem được việc cũng được xem tài liệu).
const canLink = (doc, s) => !doc.cancelledAt && (doc.book === 'NOIBO' ? !isDraft(doc) && (doc.viewLevel || 'ALL') === 'ALL' : LINKABLE_SECURITY.includes(doc.security)) && canView(doc, s);
// "Nơi ban hành" khi điền sẵn: văn bản đến — nơi gửi (kèm số của bên gửi); văn bản đi / nội bộ — pháp nhân (D7: bộ phận ban hành).
function issuerOf(doc, { entityName = null, deptName = null } = {}) {
  const v = doc.book === 'DEN'
    ? [doc.counterpart, doc.externalNumber && `số ${doc.externalNumber}`].filter(Boolean).join(' · ')
    : String(doc.series || '').startsWith('D7-') && deptName ? deptName : entityName || doc.entity || '';
  return String(v || '').slice(0, 200);
}

// ===================== Sổ nội bộ: quy chế, quy định — phê duyệt + cấp xem theo vai =====================
// Một trục vai (lib/permissions.js roleRank): 0 Ban TGĐ · 1 Lãnh đạo bộ phận · 2 Nhân viên · null Quản trị hệ thống (không xem nội dung).
// Cấp xem của tài liệu là hạng vai THẤP NHẤT được xem; cấp cao xem được tài liệu cấp thấp. Không xét bộ phận, phạm vi phụ trách, kiêm nhiệm.
const VIEW_LEVELS = { ALL: 'Mọi người', LEADERS: 'Lãnh đạo (Lãnh đạo bộ phận + Ban TGĐ)', BOARD: 'Ban TGĐ' };
const LEVEL_RANK = { ALL: 2, LEADERS: 1, BOARD: 0 };
// Loại tài liệu (ký hiệu trong số): người dùng chọn một trong danh sách.
const NOIBO_TYPES = { QC: 'Quy chế', QyĐ: 'Quy định', QT: 'Quy trình', HD: 'Hướng dẫn', QĐ: 'Quyết định', TB: 'Thông báo', KH: 'Kế hoạch', BC: 'Báo cáo', TTr: 'Tờ trình' };
const DRAFT_STATES = new Set(['DRAFT', 'RETURNED']);
const isDraft = doc => DRAFT_STATES.has(doc.status);
// Hạng vai của chủ thể s (s.rank do route gắn từ roleRank) có tới cấp xem của tài liệu không.
const levelOk = (level, s) => s.rank != null && s.rank <= (LEVEL_RANK[level || 'ALL'] ?? 2);
// Cấp xem người dùng được ĐẶT: không vượt vai của chính mình (Nhân viên làm Văn thư chỉ đặt "Mọi người").
const levelsFor = s => Object.keys(VIEW_LEVELS).filter(k => levelOk(k, s));
// Xem: người soạn luôn xem tài liệu mình soạn. Dự thảo: thêm Người phê duyệt, Văn thư (trong cấp xem theo vai của Văn thư).
// Đã phê duyệt: theo cấp xem.
function canViewNoibo(doc, s) {
  if (s.it) return false;
  if (doc.createdById === s.userId) return true;
  if (!levelOk(doc.viewLevel, s)) return false;
  return isDraft(doc) ? !!(s.approver || s.clerk) : true;
}
// Claude (token) — ngoài quyền người dùng: không đọc cấp Ban TGĐ, không đọc dự thảo của người khác.
const aiHidden = (doc, s) => !!s.ai && (doc.book === 'NOIBO' ? (doc.viewLevel === 'BOARD' || (isDraft(doc) && doc.createdById !== s.userId)) : doc.security === 'BAO_MAT_CAO');
// Sửa / gửi lại / huỷ dự thảo, tải / gỡ tệp của dự thảo: người soạn; Văn thư (trong cấp xem). Không qua Claude (trừ tạo dự thảo).
const canEditDraft = (doc, s) => !s.it && !s.ai && !doc.cancelledAt && isDraft(doc) && (doc.createdById === s.userId || (!!s.clerk && levelOk(doc.viewLevel, s)));
// Phê duyệt / trả lại: chỉ Người phê duyệt (danh sách trong Thiết lập văn thư, chỉ vai Ban TGĐ), trên giao diện, dự thảo đang chờ.
// Trả về null nếu được; ngược lại [mã HTTP, thông báo, mã lỗi].
function approveCheck(doc, s, files = []) {
  if (s.ai) return [403, 'Phê duyệt làm trên giao diện Kepler Hub, không qua Claude', 'NOT_VIA_AI'];
  if (!s.approver) return [403, 'Chỉ Người phê duyệt (Thiết lập văn thư) phê duyệt tài liệu', 'FORBIDDEN'];
  if (doc.book !== 'NOIBO') return [422, 'Chỉ tài liệu sổ nội bộ đi qua phê duyệt', 'INVALID_STATUS'];
  if (doc.cancelledAt) return [422, 'Dự thảo đã huỷ', 'INVALID_STATUS'];
  if (doc.status !== 'DRAFT') return [422, doc.status === 'RETURNED' ? 'Dự thảo đã trả lại — chờ người soạn sửa và gửi lại' : 'Tài liệu đã phê duyệt', 'INVALID_STATUS'];
  if (!files.some(f => f.mimeType === 'application/pdf')) return [422, 'Tài liệu chưa có tệp PDF — Người phê duyệt phải xem đúng bản được duyệt', 'PDF_REQUIRED'];
  return null;
}
const returnCheck = (doc, s) => {
  const e = approveCheck(doc, s, [{ mimeType: 'application/pdf' }]);
  return e && e[2] === 'PDF_REQUIRED' ? null : e;
};
// Người phê duyệt: tài khoản vai Ban TGĐ có trong danh sách; danh sách trống → Ban TGĐ phụ trách "Toàn công ty".
const isApprover = (user, cfg, board) => !!board && (cfg.approverUserIds.length ? cfg.approverUserIds.includes(user.id) : !!user.boardAll);
// Phê duyệt xong: chưa tới ngày hiệu lực → Đã phê duyệt; ngày hiệu lực trống / hôm nay / trong quá khứ → Hiệu lực ngay.
const statusOnApprove = (effectiveDate, today) => (effectiveDate && effectiveDate > today ? 'APPROVED' : 'EFFECTIVE');
// Sau khi phê duyệt chỉ Văn thư / Ban TGĐ đánh dấu Hiệu lực / Hết hiệu lực (đổi trạng thái tay); dự thảo không đổi trạng thái theo đường này.
const NOIBO_MANUAL = { APPROVED: ['EFFECTIVE', 'EXPIRED'], EFFECTIVE: ['EXPIRED'] };
// Mức mật GHI SONG SONG cho sổ nội bộ — chỉ để QUAY LẠI bản cũ (PR #41, canView theo mức mật) an toàn: mã cũ đọc cột này phải xem HẸP hơn,
// không rộng hơn cấp xem. Mã mới không đọc nó cho sổ nội bộ (cấp xem là khái niệm duy nhất). Dự thảo / đã trả lại → Bảo mật cao
// (mã cũ: Ban TGĐ + người soạn); đã phê duyệt: Mọi người → Nội bộ; Lãnh đạo, Ban TGĐ → Bảo mật cao. Không dùng Hạn chế (mã cũ mở cho cả
// nhân viên cùng bộ phận). Ngoại lệ duy nhất khi quay lại: mọi thành viên Ban TGĐ (không chỉ Người phê duyệt) xem dự thảo.
const legacySecurity = (status, viewLevel) => (DRAFT_STATES.has(status) || (viewLevel || 'ALL') !== 'ALL' ? 'BAO_MAT_CAO' : 'NOI_BO');

module.exports = { CONFIG_KEY, BOOKS, SERIES, SECURITY, URGENCY, DUE_WORKDAYS, STATUS, FIRST, CLOSED, DOC_TYPES, vanthuConfig, numberOf, seriesKey,
  addWorkdays, dueFor, canView, canRegister, canStatus, isOverdue, LINKABLE_SECURITY, canLink, issuerOf,
  VIEW_LEVELS, LEVEL_RANK, NOIBO_TYPES, isDraft, levelOk, levelsFor, canViewNoibo, aiHidden, canEditDraft, approveCheck, returnCheck, isApprover, statusOnApprove, NOIBO_MANUAL, legacySecurity };
