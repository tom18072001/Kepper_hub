// MỘT HỆ QUY CHIẾU PHÂN QUYỀN (chủ dự án duyệt 24/11/2026 — docs/de-xuat-mot-he-quy-chieu-phan-quyen.md).
// "Người này là ai trong công ty" chỉ trả lời bằng VAI (User.role), đúng một trong 4 vai:
//   director = Ban Tổng Giám đốc (BTGĐ) · manager = Lãnh đạo bộ phận · member = Nhân viên · admin = Quản trị hệ thống.
// Thành viên BTGĐ có thêm PHẠM VI PHỤ TRÁCH: Toàn công ty (User.boardAll) hoặc các bộ phận (Department.supervisorId).
// Quyền chung SUY HOÀN TOÀN TỪ VAI (ROLE_PROFILES) — không còn chỉnh quyền từng người (bảng UserPermission giữ lại, không đọc).
// Mọi nơi khác hỏi vai qua isBoard / isDeptLeader / isItAdmin / các điều kiện *_WHERE ở đây; test quét mã (role-matrix.test.js)
// cấm so chuỗi vai ngoài tệp này.
// Tên quyền kỹ thuật bên dưới (work.view…) chỉ là tên ô của ma trận: mỗi quyền có action (VIEW/OPERATE) và phạm vi
// (UNIT = bộ phận của tài khoản, SYSTEM = toàn công ty). OPERATE bao hàm VIEW.
const ACTIONS = ['VIEW', 'OPERATE'];
const SCOPES = ['UNIT', 'SYSTEM'];
const P = (group, key, label, description, actions = ACTIONS, scopes = SCOPES) => ({ group, key, label, description, actions, scopes });

const PERMISSIONS = [
  P('Công việc', 'work.view', 'Xem công việc', 'Xem dự án và công việc trong phạm vi được cấp.', ['VIEW']),
  P('Công việc', 'work.edit', 'Tạo và cập nhật công việc', 'Tạo việc, sửa nội dung, chuyển trạng thái, giao việc, bình luận, đính kèm.', ['OPERATE']),
  P('Công việc', 'work.delete', 'Xoá công việc', 'Lưu trữ hoặc xoá công việc.', ['OPERATE']),
  P('Công việc', 'work.approve', 'Duyệt công việc', 'Tham gia các bước duyệt (trưởng phòng ở phạm vi phòng ban, ban giám đốc ở phạm vi toàn tổ chức).', ['OPERATE']),
  P('Dự án', 'projects.manage', 'Quản lý dự án', 'Tạo dự án, sửa trạng thái/WIP, quy trình duyệt và thành viên.', ['OPERATE']),
  P('Báo cáo', 'reports.dashboard', 'Xem dashboard', 'Xem số liệu tổng hợp tiến độ, khối lượng việc.', ['VIEW']),
  P('Báo cáo', 'reports.kpi', 'Xem KPI theo phòng ban / cá nhân', 'Xem tỷ lệ đúng hạn, số việc hoàn thành, thời gian xử lý của từng phòng ban và từng người (dữ liệu cá nhân — chỉ ban giám đốc).', ['VIEW'], ['SYSTEM']),
  P('Báo cáo', 'reports.summary', 'Xem tổng hợp giao việc', 'Bảng tổng hợp tình hình thực hiện nhiệm vụ theo cán bộ chủ trì (giao ban): phạm vi phòng ban hoặc toàn đơn vị.', ['VIEW']),
  P('Báo cáo', 'reports.export', 'Xuất Excel', 'Xuất danh sách công việc ra Excel.', ['OPERATE']),
  P('Quản trị', 'admin.departments', 'Quản lý phòng ban', 'Thêm, sửa, khoá phòng ban.', ACTIONS, ['SYSTEM']),
  P('Quản trị', 'admin.users', 'Quản lý tài khoản', 'Tạo, sửa, khoá tài khoản, reset mật khẩu.', ACTIONS, ['SYSTEM']),
  P('Quản trị', 'admin.permissions', 'Phân quyền', 'Cấp hoặc thu hồi quyền của tài khoản.', ACTIONS, ['SYSTEM']),
  P('Quản trị', 'admin.labels', 'Quản lý nhãn', 'Quản lý nhãn dùng chung.', ['OPERATE'], ['SYSTEM']),
  P('Quản trị', 'admin.audit', 'Xem nhật ký hệ thống', 'Xem ai đã làm gì, lúc nào, trên dữ liệu nào.', ['VIEW'], ['SYSTEM']),
];
const BY_KEY = Object.fromEntries(PERMISSIONS.map(p => [p.key, p]));
// Quyền nghiệp vụ (nội dung công việc, dự án, báo cáo). Tài khoản quản trị hệ thống (admin IT, kể cả quản trị gốc)
// KHÔNG bao giờ có các quyền này — tách quản trị kỹ thuật khỏi nội dung nghiệp vụ (quyết định của chủ dự án 16/10/2026).
const isBusinessKey = key => /^(work|projects|reports)\./.test(key);
const isItAdmin = user => !!user && (user.isRootAdmin || user.role === 'admin');
// Vai cũ "Phó phòng" (deputy) đã gộp vào Lãnh đạo bộ phận (migration); vẫn đọc như manager nếu còn sót.
const roleOf = user => (user?.role === 'deputy' ? 'manager' : user?.role) || null;
// Ban Tổng Giám đốc (vai). Phạm vi phụ trách xem services/task-access.js (Toàn công ty / bộ phận).
const isBoard = user => !!user && !isItAdmin(user) && roleOf(user) === 'director';
// Lãnh đạo bộ phận (vai) của MỘT bộ phận: phải thuộc một bộ phận.
const isDeptLeader = user => !!user && !isItAdmin(user) && roleOf(user) === 'manager' && user.departmentId != null;
// Thứ bậc trên cây tổ chức: 0 Ban Tổng Giám đốc, 1 Lãnh đạo bộ phận, 2 Nhân viên (quản trị hệ thống: null).
const roleRank = user => (isItAdmin(user) ? null : isBoard(user) ? 0 : roleOf(user) === 'manager' ? 1 : 2);
// Điều kiện Prisma theo vai (thay cho so chuỗi rải rác).
const IT_WHERE = Object.freeze({ OR: [{ isRootAdmin: true }, { role: 'admin' }] });
const NOT_IT_WHERE = Object.freeze({ isRootAdmin: false, role: { not: 'admin' } });
const BOARD_WHERE = Object.freeze({ isRootAdmin: false, role: 'director' });
const LEADER_WHERE = Object.freeze({ isRootAdmin: false, role: { in: ['manager', 'deputy'] } });
// Bộ phận Ban Tổng Giám đốc (theo mã): vai BTGĐ nên trùng đúng thành viên bộ phận này — lệch thì quản trị được cảnh báo.
const BOARD_DEPT_CODES = ['BTGD', 'BGD'];
const isBoardDept = dept => !!dept && BOARD_DEPT_CODES.includes(String(dept.code || '').toUpperCase());
// Cảnh báo khi vai BTGĐ và bộ phận BTGĐ không khớp (không chặn cứng — cơ cấu có thể đổi).
function boardDeptMismatch(role, dept) {
  if (role === 'admin') return null;
  const inBoardDept = isBoardDept(dept);
  if (role === 'director' && !inBoardDept) return 'Vai Ban Tổng Giám đốc nhưng không thuộc bộ phận Ban Tổng Giám đốc';
  if (role !== 'director' && inBoardDept) return 'Thuộc bộ phận Ban Tổng Giám đốc nhưng không có vai Ban Tổng Giám đốc';
  return null;
}
const grant = (permissionKey, action, scope) => ({ permissionKey, action, scope });
const allOf = scope => PERMISSIONS.flatMap(p => p.actions.filter(a => p.scopes.includes(scope)).map(a => grant(p.key, a, scope)));

const ROLES = {
  director: { label: 'Ban Tổng Giám đốc' },
  manager: { label: 'Lãnh đạo bộ phận' },
  member: { label: 'Nhân viên' },
  admin: { label: 'Quản trị hệ thống' },
};
// Bảng quyền của từng vai — nguồn quyền DUY NHẤT lúc chạy (permissionScope đọc bảng này, không đọc quyền lưu riêng từng người).
const ROLE_PROFILES = {
  admin: allOf('SYSTEM').filter(g => !isBusinessKey(g.permissionKey)),
  director: [
    grant('work.view', 'VIEW', 'SYSTEM'), grant('work.edit', 'OPERATE', 'SYSTEM'), grant('work.approve', 'OPERATE', 'SYSTEM'),
    grant('projects.manage', 'OPERATE', 'SYSTEM'), grant('reports.dashboard', 'VIEW', 'SYSTEM'), grant('reports.export', 'OPERATE', 'SYSTEM'),
    grant('reports.kpi', 'VIEW', 'SYSTEM'), grant('reports.summary', 'VIEW', 'SYSTEM'),
  ],
  manager: [
    grant('work.view', 'VIEW', 'UNIT'), grant('work.edit', 'OPERATE', 'UNIT'), grant('work.delete', 'OPERATE', 'UNIT'),
    grant('work.approve', 'OPERATE', 'UNIT'), grant('projects.manage', 'OPERATE', 'UNIT'),
    grant('reports.dashboard', 'VIEW', 'UNIT'), grant('reports.export', 'OPERATE', 'UNIT'), grant('reports.summary', 'VIEW', 'UNIT'),
  ],
  member: [
    grant('work.view', 'VIEW', 'UNIT'), grant('work.edit', 'OPERATE', 'UNIT'), grant('reports.dashboard', 'VIEW', 'UNIT'),
  ],
};

function definition(key) { return BY_KEY[key] || null; }
function validGrant(value) {
  if (!value || typeof value !== 'object') return false;
  const p = definition(value.permissionKey);
  const actionAllowed = p && (p.actions.includes(value.action) || (value.action === 'VIEW' && p.actions.includes('OPERATE')));
  return !!actionAllowed && p.scopes.includes(value.scope);
}
function permissionScope(user, key, action = 'VIEW') {
  const p = definition(key);
  const supported = p && (p.actions.includes(action) || (action === 'VIEW' && p.actions.includes('OPERATE')));
  if (!supported || !user) return null;
  if (isItAdmin(user) && isBusinessKey(key)) return null;
  if (user.isRootAdmin) return 'SYSTEM';
  const grants = ROLE_PROFILES[roleOf(user)] || [];
  const allowed = grants.filter(g => g.permissionKey === key && validGrant(g) && (g.action === action || (action === 'VIEW' && g.action === 'OPERATE')));
  if (allowed.some(g => g.scope === 'SYSTEM')) return 'SYSTEM';
  if (allowed.some(g => g.scope === 'UNIT')) return 'UNIT';
  return null;
}
// Các vai có một quyền (để lọc trong CSDL thay cho lọc theo bảng quyền từng người). Gồm cả giá trị cũ 'deputy' nếu có manager.
function rolesWith(key, action = 'VIEW') {
  const out = Object.keys(ROLE_PROFILES).filter(role => permissionScope({ role }, key, action));
  return out.includes('manager') ? [...out, 'deputy'] : out;
}
function hasPermission(user, key, action = 'VIEW') { return !!permissionScope(user, key, action); }
function canAccessDepartment(user, key, action, departmentId) {
  const scope = permissionScope(user, key, action);
  return scope === 'SYSTEM' || (scope === 'UNIT' && departmentId != null && Number(departmentId) === Number(user.departmentId));
}
function accessMap(user) {
  return Object.fromEntries(PERMISSIONS.map(p => [p.key, { view: permissionScope(user, p.key, 'VIEW'), operate: permissionScope(user, p.key, 'OPERATE') }]));
}
function canResetPassword(actor, target) {
  return !!actor && !!target && hasPermission(actor, 'admin.users', 'OPERATE') && Number(actor.id) !== Number(target.id) && !target.isRootAdmin;
}
function catalog() {
  return { permissions: PERMISSIONS, actions: ACTIONS, scopes: SCOPES, roles: ROLES, roleProfiles: ROLE_PROFILES };
}

module.exports = {
  PERMISSIONS, ROLES, ROLE_PROFILES, isBusinessKey, isItAdmin, isBoard, isDeptLeader, roleOf, NOT_IT_WHERE, BOARD_WHERE, LEADER_WHERE,
  BOARD_DEPT_CODES, isBoardDept, rolesWith, IT_WHERE, roleRank, boardDeptMismatch, validGrant, permissionScope, hasPermission, canAccessDepartment, accessMap, canResetPassword, catalog,
};
