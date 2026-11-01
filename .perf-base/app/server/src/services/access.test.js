const test = require('node:test');
const assert = require('node:assert/strict');
const { projectRights, visibleProjectsWhere } = require('./access');
const { ROLE_PROFILES } = require('../lib/permissions');

const as = (role, departmentId, extra = {}) => ({ id: 10, role, departmentId, permissions: ROLE_PROFILES[role], ...extra });
const project = (visibility, departmentId = 1, extra = {}) => ({ id: 1, departmentId, visibility, archivedAt: null, ...extra });

test('nhân viên làm việc được trong dự án phòng ban mình, không thấy dự án phòng khác', () => {
  const staff = as('member', 1);
  assert.deepEqual(projectRights(staff, project('DEPARTMENT', 1), null), { canView: true, canEdit: true, canManage: false, canDelete: false, memberRole: null });
  assert.equal(projectRights(staff, project('DEPARTMENT', 2), null).canView, false);
  assert.equal(projectRights(staff, project('PRIVATE', 1), null).canView, false);
});

test('dự án PUBLIC: người phòng khác xem được nhưng chỉ thành viên mới sửa được', () => {
  const other = as('member', 2);
  const rights = projectRights(other, project('PUBLIC', 1), null);
  assert.equal(rights.canView, true);
  assert.equal(rights.canEdit, false);
  assert.equal(projectRights(other, project('PUBLIC', 1), { role: 'MEMBER' }).canEdit, true);
  assert.equal(projectRights(other, project('PUBLIC', 1), { role: 'VIEWER' }).canEdit, false);
});

test('trưởng phòng quản lý dự án phòng mình; ban giám đốc xem toàn tổ chức', () => {
  assert.equal(projectRights(as('manager', 1), project('DEPARTMENT', 1), null).canManage, true);
  assert.equal(projectRights(as('manager', 1), project('DEPARTMENT', 2), null).canView, false);
  const director = projectRights(as('director', null), project('PRIVATE', 3), null);
  assert.equal(director.canView, true);
});

test('dự án đã lưu trữ chỉ đọc', () => {
  assert.equal(projectRights(as('manager', 1), project('DEPARTMENT', 1, { archivedAt: new Date() }), null).canEdit, false);
});

test('điều kiện lọc dự án theo phạm vi xem', () => {
  assert.deepEqual(visibleProjectsWhere(as('director', null)), { deletedAt: null });
  assert.deepEqual(visibleProjectsWhere({ id: 1, isRootAdmin: true, role: 'admin', permissions: [] }), { id: -1 }); // admin IT không thấy dự án
  const where = visibleProjectsWhere(as('member', 4));
  assert.equal(where.deletedAt, null); // dự án trong thùng rác bị ẩn
  assert.deepEqual(where.OR, [{ members: { some: { userId: 10 } } }, { visibility: { in: ['PUBLIC', 'ASSIGNED'] } }, { visibility: 'DEPARTMENT', departmentId: 4 }]);
});
