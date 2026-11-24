const test = require('node:test');
const assert = require('node:assert/strict');
const { permissionScope, ROLE_PROFILES, ROLES, canResetPassword, validGrant, isBoard, isDeptLeader, isItAdmin, roleOf, rolesWith, roleRank,
  boardDeptMismatch, isBoardDept } = require('./permissions');

test('một trục vai: đúng 4 vai — Ban Tổng Giám đốc, Lãnh đạo bộ phận, Nhân viên, Quản trị hệ thống', () => {
  assert.deepEqual(Object.keys(ROLES).sort(), ['admin', 'director', 'manager', 'member']);
  assert.equal(ROLES.director.label, 'Ban Tổng Giám đốc');
  assert.equal(ROLES.manager.label, 'Lãnh đạo bộ phận');
  assert.equal(ROLES.member.label, 'Nhân viên');
  assert.equal(ROLES.admin.label, 'Quản trị hệ thống');
  assert.deepEqual(Object.keys(ROLE_PROFILES).sort(), Object.keys(ROLES).sort());
});

test('quyền suy hoàn toàn từ vai: bộ quyền lưu riêng của tài khoản bị bỏ qua (không nới, không thu hẹp)', () => {
  const narrowed = { id: 6, role: 'director', departmentId: 3, permissions: [{ permissionKey: 'work.view', action: 'VIEW', scope: 'UNIT' }] };
  assert.equal(permissionScope(narrowed, 'work.view', 'VIEW'), 'SYSTEM', 'vai BTGĐ → toàn công ty, dù bộ quyền cũ đã thu hẹp');
  assert.equal(permissionScope(narrowed, 'reports.kpi', 'VIEW'), 'SYSTEM');
  const widened = { id: 7, role: 'member', departmentId: 3, permissions: [{ permissionKey: 'reports.kpi', action: 'VIEW', scope: 'SYSTEM' }] };
  assert.equal(permissionScope(widened, 'reports.kpi', 'VIEW'), null, 'nhân viên không có KPI dù bộ quyền cũ có');
});

test('OPERATE bao hàm VIEW; quyền không có trong bảng của vai → null', () => {
  const lead = { id: 2, role: 'manager', departmentId: 5 };
  assert.equal(permissionScope(lead, 'work.edit', 'VIEW'), 'UNIT');
  assert.equal(permissionScope(lead, 'work.approve', 'OPERATE'), 'UNIT');
  assert.equal(permissionScope({ id: 3, role: 'member', departmentId: 5 }, 'work.delete', 'OPERATE'), null);
});

test('vai cũ "Phó phòng" (deputy) đọc như Lãnh đạo bộ phận', () => {
  const dep = { id: 5, role: 'deputy', departmentId: 2 };
  assert.equal(roleOf(dep), 'manager');
  assert.equal(isDeptLeader(dep), true);
  assert.equal(permissionScope(dep, 'work.approve', 'OPERATE'), 'UNIT');
  assert.ok(rolesWith('work.approve', 'OPERATE').includes('deputy'));
});

test('hàm vai: isBoard / isDeptLeader / isItAdmin / roleRank', () => {
  assert.equal(isBoard({ role: 'director' }), true);
  assert.equal(isBoard({ role: 'manager', departmentId: 1 }), false);
  assert.equal(isBoard({ role: 'director', isRootAdmin: true }), false, 'quản trị gốc không là BTGĐ');
  assert.equal(isDeptLeader({ role: 'manager', departmentId: 1 }), true);
  assert.equal(isDeptLeader({ role: 'manager', departmentId: null }), false, 'lãnh đạo bộ phận phải thuộc một bộ phận');
  assert.equal(isItAdmin({ role: 'admin' }), true);
  assert.equal(isItAdmin({ role: 'member', isRootAdmin: true }), true);
  assert.deepEqual([{ role: 'director' }, { role: 'manager' }, { role: 'member' }, { role: 'admin' }].map(roleRank), [0, 1, 2, null]);
  assert.deepEqual(rolesWith('reports.kpi').sort(), ['director']);
});

test('quản trị gốc có mọi quyền quản trị; quản trị IT không có quyền nghiệp vụ', () => {
  const root = { id: 1, isRootAdmin: true, role: 'admin' };
  const admin = { id: 3, role: 'admin' };
  assert.equal(permissionScope(root, 'admin.permissions', 'OPERATE'), 'SYSTEM');
  for (const u of [root, admin]) {
    for (const k of ['work.view', 'work.approve', 'reports.dashboard', 'reports.kpi', 'projects.manage']) assert.equal(permissionScope(u, k, k === 'work.view' || k.startsWith('reports.') ? 'VIEW' : 'OPERATE'), null, k);
  }
  assert.equal(permissionScope(admin, 'admin.users', 'OPERATE'), 'SYSTEM');
});

test('bảng quyền của vai chỉ chứa quyền hợp lệ; nhân viên không có quyền quản trị; quản trị chỉ có quyền quản trị', () => {
  for (const [role, grants] of Object.entries(ROLE_PROFILES)) for (const g of grants) assert.ok(validGrant(g), role + ' ' + g.permissionKey);
  assert.ok(!ROLE_PROFILES.member.some(g => g.permissionKey.startsWith('admin.')));
  assert.ok(ROLE_PROFILES.admin.every(g => g.permissionKey.startsWith('admin.')));
});

test('cảnh báo vai BTGĐ lệch bộ phận Ban Tổng Giám đốc', () => {
  const btgd = { code: 'BTGD' }, th = { code: 'TH' };
  assert.equal(isBoardDept(btgd), true);
  assert.equal(boardDeptMismatch('director', btgd), null);
  assert.equal(boardDeptMismatch('member', th), null);
  assert.match(boardDeptMismatch('director', th), /không thuộc bộ phận Ban Tổng Giám đốc/);
  assert.match(boardDeptMismatch('member', btgd), /không có vai Ban Tổng Giám đốc/);
  assert.equal(boardDeptMismatch('admin', btgd), null);
});

test('không reset được mật khẩu của chính mình hoặc tài khoản gốc', () => {
  const actor = { id: 2, role: 'admin' };
  assert.equal(canResetPassword(actor, { id: 9 }), true);
  assert.equal(canResetPassword(actor, { id: 2 }), false);
  assert.equal(canResetPassword(actor, { id: 9, isRootAdmin: true }), false);
  assert.equal(canResetPassword({ id: 4, role: 'director' }, { id: 9 }), false, 'BTGĐ không quản lý tài khoản');
});
