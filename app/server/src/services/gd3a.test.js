// GĐ3a — quyền xem theo việc trong sổ giao việc của đơn vị, vai trò Phó phòng.
const test = require('node:test');
const assert = require('node:assert/strict');
const { canSeeItem, itemVisibleWhere, projectRights, isDeptLeader } = require('./access');
const { ROLE_PROFILES, permissionScope } = require('../lib/permissions');

const as = (id, role, departmentId) => ({ id, role, departmentId, permissions: ROLE_PROFILES[role] });
const register = { id: 1, departmentId: 1, visibility: 'ASSIGNED', archivedAt: null };
const item = (extra = {}) => ({ assignedById: 1, leadDepartmentId: 2, assignees: [{ userId: 21 }], supporters: [{ userId: 31 }], supportDepartments: [{ departmentId: 3 }], ...extra });

test('Phó phòng có quyền như trưởng phòng (tiếp nhận, phân công, duyệt cấp phòng)', () => {
  assert.deepEqual(ROLE_PROFILES.deputy, ROLE_PROFILES.manager);
  assert.equal(permissionScope(as(5, 'deputy', 2), 'work.approve', 'OPERATE'), 'UNIT');
  assert.equal(isDeptLeader(as(5, 'deputy', 2)), true);
  assert.equal(isDeptLeader(as(6, 'member', 2)), false);
});

test('sổ giao việc của đơn vị: chỉ người liên quan thấy việc, cán bộ khác không thấy', () => {
  const it = item();
  assert.equal(projectRights(as(40, 'member', 4), register, null).canView, true); // thấy sổ, không thấy việc
  assert.equal(canSeeItem(as(1, 'director', 1), register, null, it), true); // Ban Giám đốc
  assert.equal(canSeeItem(as(22, 'manager', 2), register, null, it), true); // lãnh đạo phòng chủ trì
  assert.equal(canSeeItem(as(23, 'deputy', 2), register, null, it), true); // phó phòng chủ trì
  assert.equal(canSeeItem(as(32, 'manager', 3), register, null, it), true); // lãnh đạo phòng phối hợp
  assert.equal(canSeeItem(as(21, 'member', 2), register, null, it), true); // cán bộ chủ trì
  assert.equal(canSeeItem(as(31, 'member', 5), register, null, it), true); // cán bộ phối hợp
  assert.equal(canSeeItem(as(24, 'member', 2), register, null, it), false); // cán bộ cùng phòng nhưng không được phân công
  assert.equal(canSeeItem(as(42, 'manager', 4), register, null, it), false); // trưởng phòng khác
  assert.equal(canSeeItem(as(42, 'manager', 4), register, { role: 'MEMBER' }, it), true); // thành viên sổ (vd. Văn phòng nhập thay)
  // Việc nhánh: người được giao việc cha thấy việc nhánh.
  assert.equal(canSeeItem(as(21, 'member', 2), register, null, item({ assignees: [], supporters: [], supportDepartments: [], leadDepartmentId: null, assignedById: 9 }), it), true);
  // Dự án thường: không áp quyền theo việc.
  assert.equal(canSeeItem(as(24, 'member', 2), { ...register, visibility: 'DEPARTMENT' }, null, it), true);
});

test('điều kiện Prisma tương ứng: Ban Giám đốc không lọc; lãnh đạo phòng thêm điều kiện theo phòng', () => {
  assert.deepEqual(itemVisibleWhere(as(1, 'director', 1)), {});
  const staff = itemVisibleWhere(as(21, 'member', 2));
  assert.equal(JSON.stringify(staff).includes('leadDepartmentId'), false);
  assert.deepEqual(staff.OR[0], { project: { visibility: { not: 'ASSIGNED' } } });
  const lead = JSON.stringify(itemVisibleWhere(as(22, 'manager', 2)));
  assert.ok(lead.includes('"leadDepartmentId":2') && lead.includes('"supportDepartments":{"some":{"departmentId":2}}'));
});
