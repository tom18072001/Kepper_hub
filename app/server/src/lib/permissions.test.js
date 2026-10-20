const test = require('node:test');
const assert = require('node:assert/strict');
const { permissionScope, canGrant, normalizeGrants, ROLE_PROFILES, canResetPassword, PERMISSIONS } = require('./permissions');

const user = (permissions, extra = {}) => ({ id: 2, departmentId: 5, permissions, ...extra });

test('OPERATE bao hàm VIEW; SYSTEM ưu tiên hơn UNIT', () => {
  const u = user([{ permissionKey: 'work.edit', action: 'OPERATE', scope: 'UNIT' }, { permissionKey: 'work.view', action: 'VIEW', scope: 'UNIT' }, { permissionKey: 'work.view', action: 'VIEW', scope: 'SYSTEM' }]);
  assert.equal(permissionScope(u, 'work.edit', 'VIEW'), 'UNIT');
  assert.equal(permissionScope(u, 'work.view', 'VIEW'), 'SYSTEM');
  assert.equal(permissionScope(u, 'work.delete', 'OPERATE'), null);
});

test('quyền chỉ có phạm vi SYSTEM không thể cấp ở phạm vi UNIT', () => {
  assert.equal(permissionScope(user([{ permissionKey: 'admin.users', action: 'OPERATE', scope: 'UNIT' }]), 'admin.users', 'OPERATE'), null);
  assert.equal(normalizeGrants([{ permissionKey: 'admin.users', action: 'OPERATE', scope: 'UNIT' }]), null);
  assert.equal(normalizeGrants([{ permissionKey: 'khong.ton.tai', action: 'VIEW', scope: 'SYSTEM' }]), null);
});

test('quản trị gốc có mọi quyền ở phạm vi SYSTEM', () => {
  assert.equal(permissionScope({ isRootAdmin: true, permissions: [] }, 'admin.permissions', 'OPERATE'), 'SYSTEM');
});

test('người cấp quyền phạm vi UNIT không cấp được phạm vi SYSTEM', () => {
  const actor = user([{ permissionKey: 'work.view', action: 'VIEW', scope: 'UNIT' }]);
  assert.equal(canGrant(actor, { permissionKey: 'work.view', action: 'VIEW', scope: 'UNIT' }), true);
  assert.equal(canGrant(actor, { permissionKey: 'work.view', action: 'VIEW', scope: 'SYSTEM' }), false);
});

test('profile vai trò chỉ chứa quyền hợp lệ; nhân viên không có quyền quản trị', () => {
  for (const [role, grants] of Object.entries(ROLE_PROFILES)) {
    assert.ok(normalizeGrants(grants), 'profile không hợp lệ: ' + role);
  }
  assert.ok(!ROLE_PROFILES.member.some(g => g.permissionKey.startsWith('admin.')));
  assert.ok(ROLE_PROFILES.admin.every(g => g.permissionKey.startsWith('admin.')), 'admin IT chỉ có quyền quản trị');
});

test('admin IT (kể cả quản trị gốc) không có quyền nghiệp vụ: không xem/duyệt công việc, không xem báo cáo', () => {
  const root = { id: 1, isRootAdmin: true, role: 'admin', permissions: [] };
  const admin = { id: 3, role: 'admin', permissions: [{ permissionKey: 'work.view', action: 'VIEW', scope: 'SYSTEM' }, { permissionKey: 'work.approve', action: 'OPERATE', scope: 'SYSTEM' }, { permissionKey: 'admin.permissions', action: 'OPERATE', scope: 'SYSTEM' }] };
  for (const u of [root, admin]) {
    for (const k of ['work.view', 'work.approve', 'reports.dashboard', 'projects.manage']) assert.equal(permissionScope(u, k, k === 'work.view' || k === 'reports.dashboard' ? 'VIEW' : 'OPERATE'), null, k);
  }
  assert.equal(permissionScope(root, 'admin.users', 'OPERATE'), 'SYSTEM');
  // Vẫn cấp được quyền nghiệp vụ cho người khác (luồng tạo tài khoản giữ nguyên).
  assert.equal(canGrant(admin, { permissionKey: 'work.view', action: 'VIEW', scope: 'UNIT' }), true);
});

test('không reset được mật khẩu của chính mình hoặc tài khoản gốc', () => {
  const actor = user([{ permissionKey: 'admin.users', action: 'OPERATE', scope: 'SYSTEM' }]);
  assert.equal(canResetPassword(actor, { id: 9 }), true);
  assert.equal(canResetPassword(actor, { id: 2 }), false);
  assert.equal(canResetPassword(actor, { id: 9, isRootAdmin: true }), false);
});
