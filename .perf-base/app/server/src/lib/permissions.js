// Danh mục quyền WorkHub. Cơ chế giữ nguyên từ bản NQ57: mỗi quyền có action (VIEW/OPERATE)
// và phạm vi (UNIT = phòng ban của tài khoản, SYSTEM = toàn tổ chức). OPERATE bao hàm VIEW.
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
const grant = (permissionKey, action, scope) => ({ permissionKey, action, scope });
const allOf = scope => PERMISSIONS.flatMap(p => p.actions.filter(a => p.scopes.includes(scope)).map(a => grant(p.key, a, scope)));

const ROLES = {
  admin: { label: 'Quản trị hệ thống' },
  director: { label: 'Ban giám đốc' },
  manager: { label: 'Trưởng phòng' },
  deputy: { label: 'Phó phòng' },
  member: { label: 'Nhân viên' },
};
// Profile chỉ áp khi tạo tài khoản; runtime luôn dùng grants của từng tài khoản.
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
  // Phó phòng (và Phó Chánh Văn phòng): quyền như trưởng phòng, chịu sự phân công của trưởng phòng (quyết định 16/10/2026).
  deputy: [
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
  const grants = Array.isArray(user.permissions) ? user.permissions : [];
  const allowed = grants.filter(g => g.permissionKey === key && validGrant(g) && (g.action === action || (action === 'VIEW' && g.action === 'OPERATE')));
  if (allowed.some(g => g.scope === 'SYSTEM')) return 'SYSTEM';
  if (allowed.some(g => g.scope === 'UNIT')) return 'UNIT';
  return null;
}
function hasPermission(user, key, action = 'VIEW') { return !!permissionScope(user, key, action); }
function canAccessDepartment(user, key, action, departmentId) {
  const scope = permissionScope(user, key, action);
  return scope === 'SYSTEM' || (scope === 'UNIT' && departmentId != null && Number(departmentId) === Number(user.departmentId));
}
function accessMap(user) {
  return Object.fromEntries(PERMISSIONS.map(p => [p.key, { view: permissionScope(user, p.key, 'VIEW'), operate: permissionScope(user, p.key, 'OPERATE') }]));
}
function canGrant(actor, g) {
  if (!validGrant(g)) return false;
  if (actor && actor.isRootAdmin) return true;
  // Admin IT quản lý tài khoản vẫn cấp được quyền nghiệp vụ cho người khác (giữ luồng cấp quyền cũ), dù bản thân không dùng được.
  if (isItAdmin(actor) && isBusinessKey(g.permissionKey)) return permissionScope(actor, 'admin.permissions', 'OPERATE') === 'SYSTEM';
  const scope = permissionScope(actor, g.permissionKey, g.action);
  return scope === 'SYSTEM' || (scope === 'UNIT' && g.scope === 'UNIT');
}
function canResetPassword(actor, target) {
  return !!actor && !!target && hasPermission(actor, 'admin.users', 'OPERATE') && Number(actor.id) !== Number(target.id) && !target.isRootAdmin;
}
function normalizeGrants(value) {
  if (!Array.isArray(value) || value.length > 200) return null;
  const out = new Map();
  for (const item of value) {
    const g = { permissionKey: String(item?.permissionKey || ''), action: String(item?.action || ''), scope: String(item?.scope || '') };
    if (!validGrant(g)) return null;
    out.set(g.permissionKey + '|' + g.action, g);
  }
  return [...out.values()];
}
async function replaceGrants(tx, userId, grants, grantedById) {
  await tx.userPermission.deleteMany({ where: { userId } });
  if (grants.length) await tx.userPermission.createMany({ data: grants.map(g => ({ ...g, userId, grantedById, source: 'CUSTOM' })) });
  return tx.userPermission.findMany({ where: { userId }, orderBy: { id: 'asc' } });
}
// Giữ hành vi cũ: khi tạo tài khoản, cấp quyền theo profile của vai trò.
async function grantInitialPermissions(tx, user, grantedById) {
  if (!user || user.isRootAdmin) return 0;
  const existing = await tx.userPermission.count({ where: { userId: user.id } });
  if (existing) return 0;
  const defaults = ROLE_PROFILES[user.role] || [];
  if (defaults.length) await tx.userPermission.createMany({ data: defaults.map(g => ({ ...g, userId: user.id, grantedById, source: 'ROLE_PROFILE' })), skipDuplicates: true });
  return defaults.length;
}
function catalog() {
  return { permissions: PERMISSIONS, actions: ACTIONS, scopes: SCOPES, roles: ROLES, roleProfiles: ROLE_PROFILES };
}

module.exports = {
  PERMISSIONS, ROLES, ROLE_PROFILES, isBusinessKey, isItAdmin, validGrant, permissionScope, hasPermission, canAccessDepartment, accessMap,
  canGrant, canResetPassword, normalizeGrants, replaceGrants, grantInitialPermissions, catalog,
};
