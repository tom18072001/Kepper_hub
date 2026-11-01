const test = require('node:test');
const assert = require('node:assert/strict');
const { loadItems } = require('./kpi');
const { isSystemWide, kpiItems, dashboardItems } = require('../services/kpi-data');
const { createMtlCache } = require('../services/mtl-cache');
const S = require('../services/stats');

// Prisma giả đếm số lần đọc từng bảng; dữ liệu đổi được để kiểm bộ đệm vô hiệu khi ghi.
const from = new Date('2026-10-01T00:00:00Z'), to = new Date('2026-10-31T23:59:59Z'), now = new Date('2026-10-20T05:00:00Z');
const base = { number: 1, dispatchStatus: null, taskType: 'PLAN', leadDepartmentId: null, assignedAt: null, createdAt: new Date('2026-09-01T00:00:00Z'), startedAt: null, completedAt: null, rating: null, ratedAt: null };
function makeData() {
  return {
    items: [
      { ...base, id: 1, dueDate: new Date('2026-10-10T00:00:00Z'), completedAt: new Date('2026-10-09T00:00:00Z'), stateId: 3, projectId: 10 },
      { ...base, id: 2, dueDate: new Date('2026-10-05T00:00:00Z'), stateId: 2, projectId: 10, taskType: 'ADHOC' },
      { ...base, id: 3, dueDate: null, stateId: 1, projectId: 11, leadDepartmentId: 7 },
      { ...base, id: 4, dueDate: new Date('2025-01-05T00:00:00Z'), completedAt: new Date('2025-01-04T00:00:00Z'), stateId: 3, projectId: 11 }, // xong từ năm trước → ngoài kỳ
      { ...base, id: 5, dueDate: new Date('2026-10-12T00:00:00Z'), stateId: 1, projectId: 12 }, // dự án đã lưu trữ → bị loại
    ],
    assignees: [{ workItemId: 1, userId: 100 }, { workItemId: 2, userId: 100 }, { workItemId: 2, userId: 101 }, { workItemId: 4, userId: 101 }, { workItemId: 5, userId: 100 }],
  };
}
function makePrisma(data = makeData(), cache = createMtlCache()) {
  const calls = { workItem: 0, workItemAssignee: 0 };
  const prisma = {
    calls, data, $mtlCache: () => cache,
    workItem: { findMany: async () => { calls.workItem++; return data.items.map(i => ({ ...i })); } },
    workItemAssignee: { findMany: async () => { calls.workItemAssignee++; return data.assignees.map(a => ({ ...a })); } },
    workflowState: { findMany: async () => [{ id: 1, category: 'UNSTARTED' }, { id: 2, category: 'STARTED' }, { id: 3, category: 'COMPLETED' }] },
    project: { findMany: async () => [{ id: 10, key: 'AA', name: 'Một', departmentId: 5, visibility: 'PUBLIC' }, { id: 11, key: 'BB', name: 'Hai', departmentId: 6, visibility: 'PUBLIC' }] },
    user: { findMany: async () => [{ id: 100, fullName: 'An', displayTitle: null, isActive: true, department: { id: 5, name: 'P5' } }, { id: 101, fullName: 'Bình', displayTitle: null, isActive: true, department: { id: 5, name: 'P5' } }] },
    approvalAction: { findMany: async () => [{ createdAt: new Date('2026-10-06T00:00:00Z'), request: { workItemId: 2 } }] },
  };
  return prisma;
}
const users = [{ id: 100, fullName: 'An', displayTitle: null, isActive: true, departmentId: 5, departmentName: 'P5' }, { id: 101, fullName: 'Bình', displayTitle: null, isActive: true, departmentId: 5, departmentName: 'P5' }];
const userRow = u => ({ id: u.id, fullName: u.fullName, displayTitle: u.displayTitle, isActive: u.isActive, departmentId: u.department.id, departmentName: u.department.name });

test('kpiItems (bộ đệm) cho cùng việc và cùng KPI như loadItems (truy vấn riêng)', async () => {
  const prisma = makePrisma();
  const slow = (await loadItems(prisma, { from, to })).filter(i => i.id <= 3); // SQL thật đã loại dự án lưu trữ và việc ngoài kỳ; Prisma giả thì không
  const fast = await kpiItems(prisma, { from, to });
  // Prisma giả không áp điều kiện kỳ của SQL → lọc tay các việc ngoài kỳ, bỏ trường chỉ dashboard cần.
  const strip = ({ number, dispatchStatus, ...i }) => i;
  assert.deepEqual(fast.items, slow.map(strip));
  assert.deepEqual(fast.items.map(i => i.id), [1, 2, 3]); // 4 ngoài kỳ, 5 thuộc dự án lưu trữ
  assert.deepEqual(fast.users.map(userRow).map(u => u.id), [100, 101]);
  const opt = { users: fast.users.map(userRow), departments: [{ id: 5, name: 'P5' }, { id: 6, name: 'P6' }], from, to, now };
  assert.deepEqual(S.computeKpi(fast.items, opt), S.computeKpi(slow, { ...opt, users }));
  assert.equal(S.computeKpi(fast.items, opt).total.rejections, 1);
});

test('dashboardItems ghép đúng hình dạng cũ và dùng chung tập nền với KPI (một lần nạp)', async () => {
  const prisma = makePrisma();
  await kpiItems(prisma, { from, to });
  const { items, projects } = await dashboardItems(prisma);
  assert.equal(prisma.calls.workItem, 1);
  assert.deepEqual(projects.map(p => p.id), [10, 11]);
  assert.deepEqual(items.map(i => i.id), [1, 2, 3, 4]);
  assert.deepEqual(items[1].assignees, [{ user: { id: 100, fullName: 'An' } }, { user: { id: 101, fullName: 'Bình' } }]);
  assert.deepEqual(items[1].state, { category: 'STARTED' });
  assert.deepEqual(items[2].project, { key: 'BB', departmentId: 6 });
  assert.equal(items[0].stateId, 3);
});

test('đọc lại cùng dữ liệu → không truy vấn lại việc, kết quả giống hệt', async () => {
  const prisma = makePrisma();
  const a = await kpiItems(prisma, { from, to }), b = await kpiItems(prisma, { from, to });
  assert.equal(prisma.calls.workItem, 1);
  assert.equal(prisma.calls.workItemAssignee, 1);
  assert.deepEqual(a, b);
});

test('yêu cầu đồng thời dùng chung một lần nạp (single-flight)', async () => {
  const prisma = makePrisma();
  await Promise.all([kpiItems(prisma, { from, to }), dashboardItems(prisma), kpiItems(prisma, { from, to })]);
  assert.equal(prisma.calls.workItem, 1);
});

test('ghi một hạng mục (bộ đệm tăng phiên bản) → KPI đổi theo', async () => {
  const cache = createMtlCache();
  const prisma = makePrisma(makeData(), cache);
  const opt = f => ({ users: f.users.map(userRow), departments: [{ id: 5, name: 'P5' }], from, to, now });
  const before = await kpiItems(prisma, { from, to });
  assert.equal(S.computeKpi(before.items, opt(before)).total.completed, 1);
  prisma.data.items.find(i => i.id === 2).stateId = 3; // hoàn thành việc 2…
  prisma.data.items.find(i => i.id === 2).completedAt = new Date('2026-10-04T00:00:00Z');
  const stale = await kpiItems(prisma, { from, to });
  assert.equal(S.computeKpi(stale.items, opt(stale)).total.completed, 1, 'chưa có ghi nào đi qua Prisma mở rộng → còn dùng bản đệm (trong giới hạn lưới an toàn)');
  cache.bump(); // …withMtlCache làm đúng việc này khi WorkItem được ghi
  const after = await kpiItems(prisma, { from, to });
  assert.equal(S.computeKpi(after.items, opt(after)).total.completed, 2);
  assert.equal(prisma.calls.workItem, 2);
  const dash = await dashboardItems(prisma);
  assert.equal(dash.items.find(i => i.id === 2).state.category, 'COMPLETED');
});

test('client không có bộ đệm (test, script) luôn đọc thẳng CSDL', async () => {
  const prisma = makePrisma();
  delete prisma.$mtlCache;
  await kpiItems(prisma, { from, to });
  await kpiItems(prisma, { from, to });
  assert.equal(prisma.calls.workItem, 2);
});

test('isSystemWide: chỉ người xem toàn hệ thống mới dùng tập chung', () => {
  const view = scope => ({ id: 1, permissions: [{ permissionKey: 'work.view', action: 'VIEW', scope }] });
  assert.equal(isSystemWide(view('SYSTEM')), true);
  assert.equal(isSystemWide(view('UNIT')), false);
  assert.equal(isSystemWide({ id: 1, permissions: [] }), false);
});
