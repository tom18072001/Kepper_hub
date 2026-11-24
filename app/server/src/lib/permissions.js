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
  P('Công việc', 'work.approve', 'Duyệt công việc', 'Tham gia các bước duyệt (trưởng phòng ở phạm vi bộ phận, ban giám đốc ở phạm vi toàn tổ chức).', ['OPERATE']),
  P('Dự án', 'projects.manage', 'Quản lý dự án', 'Tạo dự án, sửa trạng thái/WIP, quy trình duyệt và thành viên.', ['OPERATE']),
  P('Báo cáo', 'reports.dashboard', 'Xem dashboard', 'Xem số liệu tổng hợp tiến độ, khối lượng việc.', ['VIEW']),
  P('Báo cáo', 'reports.kpi', 'Xem KPI theo bộ phận / cá nhân', 'Xem tỷ lệ đúng hạn, số việc hoàn thành, thời gian xử lý của từng bộ phận và từng người (dữ liệu cá nhân — chỉ ban giám đốc).', ['VIEW'], ['SYSTEM']),
  P('Báo cáo', 'reports.summary', 'Xem tổng hợp giao việc', 'Bảng tổng hợp tình hình thực hiện nhiệm vụ theo cán bộ chủ trì (giao ban): phạm vi bộ phận hoặc toàn đơn vị.', ['VIEW']),
  P('Báo cáo', 'reports.export', 'Xuất Excel', 'Xuất danh sách công việc ra Excel.', ['OPERATE']),
  P('Quản trị', 'admin.departments', 'Quản lý bộ phận', 'Thêm, sửa, khoá bộ phận.', ACTIONS, ['SYSTEM']),
  P('Quản trị', 'admin.users', 'Quản lý tài khoản', 'Tạo, sửa, khoá tài khoản, reset mật khẩu.', ACTIONS, ['SYSTEM']),
  P('Quản trị', 'admin.permissions', 'Vai & phạm vi phụ trách', 'Xem quyền theo vai của tài khoản; đặt phạm vi phụ trách của thành viên Ban Tổng Giám đốc.', ACTIONS, ['SYSTEM']),
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
// Người duyệt / tiếp nhận ở cấp MỘT bộ phận (một định nghĩa cho hàng chờ duyệt, ngữ cảnh việc, cảnh báo): Lãnh đạo bộ phận của bộ phận
// đó; với bộ phận Ban Tổng Giám đốc là các thành viên BTGĐ trong bộ phận. Lọc theo bộ phận ở nơi gọi (user.departmentId).
const isDeptApprover = user => isDeptLeader(user) || (isBoard(user) && user.departmentId != null);
// Điều kiện Prisma theo vai (thay cho so chuỗi rải rác).
const IT_WHERE = Object.freeze({ OR: [{ isRootAdmin: true }, { role: 'admin' }] });
const NOT_IT_WHERE = Object.freeze({ isRootAdmin: false, role: { not: 'admin' } });
const BOARD_WHERE = Object.freeze({ isRootAdmin: false, role: 'director' });
// Chủ thể NỘI BỘ của hệ thống (không phải tài khoản, id 0): xem mọi việc để dựng phạm vi của một bộ phận (vd. báo cáo tuần: mọi việc
// của bộ phận, routes/weekly.js). Quyền lấy từ vai như mọi người dùng (work.view toàn đơn vị) — không mang bảng quyền riêng.
const SYSTEM_VIEWER = Object.freeze({ id: 0, isRootAdmin: false, role: 'director', departmentId: null });
const DEPT_APPROVER_WHERE = Object.freeze({ isRootAdmin: false, role: { in: ['director', 'manager', 'deputy'] }, departmentId: { not: null } });
// Bộ phận Ban Tổng Giám đốc (theo mã): vai BTGĐ nên trùng đúng thành viên bộ phận này — lệch thì quản trị được cảnh báo.
// Dữ liệu GIẢ (SEED_DEMO=true: bản thử, e2e) đặt mã 'BGD' cho bộ phận này; máy chạy thật chỉ nhận 'BTGD'.
const BOARD_DEPT_CODES = Object.freeze(['BTGD', ...(process.env.SEED_DEMO === 'true' ? ['BGD'] : [])]);
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

// Vai mặc định của tài khoản mới (Nhân viên).
const DEFAULT_ROLE = 'member';
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

// Bảng quyền của từng vai BẰNG LỜI (ma trận 5.4, docs/de-xuat-mot-he-quy-chieu-phan-quyen.md) — hiện ở Quản trị → Tài khoản → "Quyền".
// Quyền thật thực thi ở máy chủ (permissionScope, lib/policy.js, services/task-access.js…); role-matrix.test.js chốt từng ô.
const ROLE_SUMMARY = {
  director: [
    ['Xem dự án, công việc', 'Toàn công ty; xem đầy đủ mọi việc, bình luận được'],
    ['Tạo, quản lý dự án', 'Mọi bộ phận, kể cả dự án Master Timeline (MTL)'],
    ['Kế hoạch của việc, duyệt gia hạn, duyệt việc mốc / đường găng', 'Việc trong phạm vi phụ trách (Toàn công ty hoặc các bộ phận được chọn) và việc mình giao'],
    ['Xoá, đặt lặp lại việc', 'Việc trong phạm vi phụ trách và việc mình giao'],
    ['Báo cáo tuần', 'Không lập; xem bản tổng hợp đầy đủ; kết luận giao ban; chọn thư ký, PMO'],
    ['KPI & phân tích', 'Mọi người, mọi bộ phận'],
    ['Tài liệu dự án', 'Mọi dự án (Hub + NAS)'],
    ['Văn thư', 'Mọi mức mật; vào sổ, sửa, huỷ'],
    ['Nhân sự, đối tác', 'Mọi bộ phận (số CCCD: chỉ người phụ trách nhân sự)'],
  ],
  manager: [
    ['Xem dự án, công việc', 'Dự án của bộ phận, dự án dùng chung, dự án mình là thành viên; sổ giao việc: việc liên quan đến mình và bộ phận'],
    ['Tạo, quản lý dự án', 'Dự án thường của bộ phận mình; dự án mình là Chủ dự án'],
    ['Kế hoạch của việc', 'Việc mình giao; chọn người cho việc giao về bộ phận'],
    ['Duyệt', 'Việc mình giao; cấp "Lãnh đạo bộ phận chủ trì" của quy trình duyệt'],
    ['Báo cáo tuần', 'Lập cho bộ phận; xem bản tổng hợp tóm tắt'],
    ['KPI', 'Của chính mình'],
    ['Tài liệu dự án', 'Dự án mình là thành viên'],
    ['Văn thư', 'Công khai / Nội bộ; Hạn chế của bộ phận mình; vào sổ dãy D7 của bộ phận'],
    ['Nhân sự, đối tác', 'Thông tin cơ bản người trong bộ phận, duyệt nghỉ phép / chấm công; đối tác của bộ phận (gồm giá trị hợp đồng)'],
  ],
  member: [
    ['Xem dự án, công việc', 'Dự án của bộ phận, dự án dùng chung, dự án mình là thành viên; sổ giao việc: việc liên quan đến mình'],
    ['Tạo, quản lý dự án', 'Không tạo; quản lý dự án mình là Chủ dự án'],
    ['Kế hoạch của việc', 'Việc mình giao; làm phần việc mình chủ trì / phối hợp'],
    ['Báo cáo tuần', 'Lập cho bộ phận'],
    ['KPI', 'Của chính mình'],
    ['Tài liệu dự án', 'Dự án mình là thành viên'],
    ['Văn thư', 'Công khai / Nội bộ; Hạn chế của bộ phận mình; văn bản mình xử lý'],
    ['Nhân sự, đối tác', 'Hồ sơ của mình; đối tác của bộ phận (trừ giá trị hợp đồng)'],
  ],
  admin: [
    ['Quản trị', 'Tài khoản, bộ phận, nhãn, nhật ký hệ thống; đặt phạm vi phụ trách của Ban Tổng Giám đốc'],
    ['Nội dung nghiệp vụ', 'Không xem: dự án, công việc, báo cáo, KPI, tài liệu, văn thư, nhân sự, đối tác'],
  ],
};
const ROLE_SUMMARY_NOTE = 'Cộng thêm theo quan hệ với từng việc / dự án (người giao, người chủ trì, Chủ dự án…) và theo kiêm nhiệm (Thư ký giao ban, PMO, Phụ trách nhân sự, Văn thư, Pháp chế). Quan hệ chỉ cộng quyền, không bớt quyền của vai.';
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
// GIAI ĐOẠN CHUYỂN TIẾP (để quay lại bản cũ): ghi bảng UserPermission đúng bộ quyền mặc định của vai. Mã mới KHÔNG đọc bảng này;
// mã cũ đọc nó. Gọi khi tạo tài khoản và khi đổi vai; scripts/sync-role-grants.js đồng bộ toàn bộ trước khi quay lại bản cũ.
async function syncRoleGrants(tx, user, grantedById = null) {
  if (!user || user.isRootAdmin) return 0;
  const grants = ROLE_PROFILES[roleOf(user)] || [];
  await tx.userPermission.deleteMany({ where: { userId: user.id } });
  if (grants.length) await tx.userPermission.createMany({ data: grants.map(g => ({ ...g, userId: user.id, grantedById, source: 'ROLE_PROFILE' })) });
  return grants.length;
}
function catalog() {
  return { permissions: PERMISSIONS, actions: ACTIONS, scopes: SCOPES, roles: ROLES, roleProfiles: ROLE_PROFILES, roleSummary: ROLE_SUMMARY, roleSummaryNote: ROLE_SUMMARY_NOTE, boardDeptCodes: BOARD_DEPT_CODES };
}

module.exports = {
  PERMISSIONS, ROLES, DEFAULT_ROLE, ROLE_PROFILES, isBusinessKey, isItAdmin, isBoard, isDeptLeader, roleOf, NOT_IT_WHERE, BOARD_WHERE, SYSTEM_VIEWER, isDeptApprover, DEPT_APPROVER_WHERE,
  BOARD_DEPT_CODES, isBoardDept, rolesWith, IT_WHERE, roleRank, boardDeptMismatch, validGrant, permissionScope, hasPermission, canAccessDepartment, accessMap, canResetPassword, catalog, syncRoleGrants,
};
