// Unit test GĐ3c: việc nhánh trong sổ của đơn vị mặc định chỉ lãnh đạo phòng duyệt; người duyệt tính trong bộ nhớ.
const test = require('node:test');
const assert = require('node:assert/strict');
const { levelsForItem, approverIdsSync, actingForSync } = require('./approval');

const steps = [{ level: 1, name: 'Lãnh đạo phòng duyệt', approverType: 'DEPARTMENT_MANAGER' }, { level: 2, name: 'BGĐ cho ý kiến', approverType: 'SUPERVISOR' }];
const client = { approvalRule: { findMany: async () => [] }, workItem: { findUnique: async () => null } };

test('việc nhánh trong sổ của đơn vị: chỉ cấp lãnh đạo phòng; việc gốc đủ cấp; chọn tay vẫn thắng', async () => {
  const register = { id: 1, visibility: 'ASSIGNED', defaultApprovalLevels: null };
  assert.deepEqual(await levelsForItem(client, register, steps, { parentId: 9, approvalLevels: null }), { levels: 1, source: 'CHILD' });
  assert.equal((await levelsForItem(client, register, steps, { parentId: null, approvalLevels: null })).levels, 2);
  assert.equal((await levelsForItem(client, register, steps, { parentId: 9, approvalLevels: 2 })).levels, 2);
  assert.equal((await levelsForItem(client, { ...register, visibility: 'DEPARTMENT' }, steps, { parentId: 9, approvalLevels: null })).levels, 2);
});

test('người duyệt: lãnh đạo phòng chủ trì, PGĐ phụ trách + người giao, uỷ quyền và "duyệt thay"', () => {
  const perm = scope => [{ permissionKey: 'work.approve', action: 'OPERATE', scope }];
  const users = [{ id: 1, departmentId: 10, permissions: perm('SYSTEM') }, { id: 2, departmentId: 10, permissions: perm('SYSTEM') }, { id: 3, departmentId: 20, permissions: perm('UNIT') }, { id: 4, departmentId: 20, permissions: perm('UNIT') }];
  const scope = new Map(users.map(u => [u.id, u.permissions[0].scope]));
  const ctx = { users, scope, sys: new Set([1, 2]), supervisor: new Map([[20, 2]]), delegations: [{ fromUserId: 3, toUserId: 5 }] };
  const project = { id: 1, departmentId: 10 }, item = { leadDepartmentId: 20, assignedById: 1 };
  assert.deepEqual(approverIdsSync(ctx, project, steps[0], item).sort(), [3, 4, 5]);
  assert.deepEqual(approverIdsSync(ctx, project, steps[1], item).sort(), [1, 2]);
  assert.deepEqual(approverIdsSync(ctx, project, { approverType: 'DIRECTOR' }, { leadDepartmentId: 20, assignedById: null }), [2]);
  assert.equal(actingForSync(ctx, { id: 5 }, project, steps[0], item), 3);
  assert.equal(actingForSync(ctx, { id: 4 }, project, steps[0], item), null);
});
