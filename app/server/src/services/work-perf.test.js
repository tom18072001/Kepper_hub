const test = require('node:test');
const assert = require('node:assert/strict');
const { attachRelations } = require('./work');

// Client Prisma giả: ghi lại truy vấn, trả dữ liệu mẫu (giả) theo điều kiện `in`.
function fakePrisma(data) {
  const calls = [];
  const pick = (name, rows, key) => ({ findMany: async args => { calls.push({ name, args }); const w = args.where[key]?.in; return rows.filter(r => !w || w.includes(r[key])); } });
  return {
    calls,
    workItemAssignee: pick('assignee', data.assignees, 'workItemId'), workItemSupporter: pick('supporter', data.supporters, 'workItemId'),
    workItemLabel: pick('label', data.labels, 'workItemId'),
    approvalRequest: { findMany: async args => { calls.push({ name: 'approval', args }); return data.approvals.filter(r => args.where.workItemId.in.includes(r.workItemId) && r.status === args.where.status); } },
    workflowState: pick('state', data.states, 'id'), project: pick('project', data.projects, 'id'), user: pick('user', data.users, 'id'),
  };
}
const data = {
  users: [{ id: 1, fullName: 'Người A' }, { id: 2, fullName: 'Người B' }, { id: 3, fullName: 'Người C' }],
  assignees: [{ workItemId: 10, userId: 1 }, { workItemId: 10, userId: 2 }, { workItemId: 12, userId: 3 }],
  supporters: [{ workItemId: 10, userId: 3 }],
  labels: [{ workItemId: 11, label: { id: 7, name: 'Gấp' } }, { workItemId: 11, label: { id: 8, name: 'Pháp lý' } }],
  approvals: [{ workItemId: 12, status: 'PENDING', currentLevel: 2 }, { workItemId: 12, status: 'PENDING', currentLevel: 3 }, { workItemId: 11, status: 'APPROVED', currentLevel: 1 }],
  states: [{ id: 5, name: 'Đang làm', category: 'STARTED', color: '#111' }],
  projects: [{ id: 3, key: 'PF01', name: 'Dự án mẫu (giả)', departmentId: 2, approvalSteps: [{ level: 1, name: 'Trưởng phòng', approverType: 'DEPT' }] }],
};
const flat = [10, 11, 12].map(id => ({ id, projectId: 3, stateId: 5, title: 'Việc ' + id }));

test('ghép assignees / supporters / labels / state / project theo Map, giữ thứ tự dòng đầu vào', async () => {
  const rows = await attachRelations(fakePrisma(data), flat);
  assert.deepEqual(rows.map(r => r.id), [10, 11, 12]);
  assert.deepEqual(rows[0].assignees, [{ userId: 1, user: { id: 1, fullName: 'Người A' } }, { userId: 2, user: { id: 2, fullName: 'Người B' } }]);
  assert.deepEqual(rows[0].supporters.map(a => a.user.fullName), ['Người C']);
  assert.deepEqual(rows[1].labels, [{ label: { id: 7, name: 'Gấp' } }, { label: { id: 8, name: 'Pháp lý' } }]);
  assert.deepEqual(rows[1].assignees, []);
  assert.equal(rows[0].state.name, 'Đang làm');
  assert.equal(rows[2].project.key, 'PF01');
  assert.equal(rows[2].project.approvalSteps[0].level, 1);
});

test('chỉ lấy yêu cầu duyệt đang chờ, và chỉ yêu cầu đầu tiên của mỗi việc', async () => {
  const rows = await attachRelations(fakePrisma(data), flat);
  assert.deepEqual(rows[2].approvals, [{ currentLevel: 2 }]);
  assert.deepEqual(rows[1].approvals, []); // yêu cầu đã duyệt không tính
  assert.deepEqual(rows[0].approvals, []);
});

test('thứ tự quan hệ xác định (khoá chính) và truy vấn theo danh sách id, không N+1', async () => {
  const p = fakePrisma(data);
  await attachRelations(p, flat);
  const by = n => p.calls.filter(c => c.name === n);
  assert.deepEqual(by('assignee')[0].args.orderBy, [{ workItemId: 'asc' }, { userId: 'asc' }]);
  assert.deepEqual(by('label')[0].args.orderBy, [{ workItemId: 'asc' }, { labelId: 'asc' }]);
  assert.deepEqual(by('assignee')[0].args.where.workItemId.in, [10, 11, 12]);
  for (const n of ['assignee', 'supporter', 'label', 'approval', 'state', 'project', 'user']) assert.equal(by(n).length, 1, n);
});

test('không có việc nào → không truy vấn quan hệ', async () => {
  const p = fakePrisma(data);
  assert.deepEqual(await attachRelations(p, []), []);
  assert.equal(p.calls.length, 0);
});
