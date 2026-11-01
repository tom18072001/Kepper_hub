const test = require('node:test');
const assert = require('node:assert/strict');
const { loadItems } = require('./kpi');
const S = require('../services/stats');

// Prisma giả: trả hàng phẳng như CSDL; kiểm loadItems ghép lại đúng hình dạng cũ { state, project, assignees, rejectionDates }
// và computeKpi cho số liệu đúng như khi đưa việc đã lồng sẵn.
const from = new Date('2026-10-01T00:00:00Z'), to = new Date('2026-10-31T23:59:59Z'), now = new Date('2026-10-20T05:00:00Z');
const base = { taskType: 'PLAN', leadDepartmentId: null, assignedAt: null, createdAt: new Date('2026-09-01T00:00:00Z'), startedAt: null, completedAt: null, rating: null, ratedAt: null };
const flat = [
  { ...base, id: 1, dueDate: new Date('2026-10-10T00:00:00Z'), completedAt: new Date('2026-10-09T00:00:00Z'), stateId: 3, projectId: 10 },
  { ...base, id: 2, dueDate: new Date('2026-10-05T00:00:00Z'), stateId: 2, projectId: 10, taskType: 'ADHOC' },
  { ...base, id: 3, dueDate: null, stateId: 1, projectId: 11, leadDepartmentId: 7 },
];
const fakePrisma = {
  workItem: { findMany: async () => flat.map(i => ({ ...i })) },
  workflowState: { findMany: async () => [{ id: 1, category: 'UNSTARTED' }, { id: 2, category: 'STARTED' }, { id: 3, category: 'COMPLETED' }] },
  project: { findMany: async () => [{ id: 10, departmentId: 5 }, { id: 11, departmentId: 6 }] },
  workItemAssignee: { findMany: async () => [{ workItemId: 1, userId: 100 }, { workItemId: 2, userId: 100 }, { workItemId: 2, userId: 101 }] },
  approvalAction: { findMany: async () => [{ createdAt: new Date('2026-10-06T00:00:00Z'), request: { workItemId: 2 } }] },
};
const nested = [
  { ...flat[0], state: { category: 'COMPLETED' }, project: { departmentId: 5 }, assignees: [{ userId: 100 }], rejectionDates: [] },
  { ...flat[1], state: { category: 'STARTED' }, project: { departmentId: 5 }, assignees: [{ userId: 100 }, { userId: 101 }], rejectionDates: [new Date('2026-10-06T00:00:00Z')] },
  { ...flat[2], state: { category: 'UNSTARTED' }, project: { departmentId: 6 }, assignees: [], rejectionDates: [] },
].map(i => { delete i.stateId; delete i.projectId; return i; });

test('loadItems ghép hàng phẳng về đúng hình dạng cũ (state/project/assignees/rejectionDates)', async () => {
  const items = await loadItems(fakePrisma, { from, to });
  assert.deepEqual(items, nested);
});

test('computeKpi trên kết quả loadItems giống hệt trên việc lồng sẵn', async () => {
  const users = [{ id: 100, fullName: 'An', departmentId: 5, departmentName: 'P5' }, { id: 101, fullName: 'Bình', departmentId: 5, departmentName: 'P5' }];
  const opt = { users, departments: [{ id: 5, name: 'P5' }, { id: 6, name: 'P6' }], from, to, now };
  const a = S.computeKpi(await loadItems(fakePrisma, { from, to }), opt), b = S.computeKpi(nested, opt);
  assert.deepEqual(a, b);
  assert.equal(a.total.rejections, 1);
  assert.equal(a.total.completed, 1);
});
