const test = require('node:test');
const assert = require('node:assert/strict');
const MP = require('./mtl-project');
const { createMtlCache, withMtlCache } = require('./mtl-cache');

// Dữ liệu GIẢ. prisma giả: workItem.findMany lọc theo projectId in […] và đếm số lần gọi.
const P = (key, action, scope) => ({ permissionKey: key, action, scope });
const director = { id: 1, departmentId: 9, role: 'user', permissions: [P('work.view', 'VIEW', 'SYSTEM')] };
const staffA = { id: 3, departmentId: 5, role: 'user', permissions: [P('work.view', 'VIEW', 'UNIT')] };
const staffB = { id: 4, departmentId: 6, role: 'user', permissions: [P('work.view', 'VIEW', 'UNIT')] };
const day1 = new Date('2026-11-02T03:00:00Z'), day2 = new Date('2026-11-03T03:00:00Z');
const PROJECTS = [1, 2, 3].map(id => ({ id, key: `P${id}`, kind: 'MTL', t0Date: new Date('2026-01-01T00:00:00Z'), alertConfig: null }));
const row = (id, projectId, over = {}) => ({ id, projectId, number: id, title: `Việc ${id}`, parentId: null, planId: null, planCode: String(id), planSection: null, ownerText: null, externalParty: null,
  leadDepartmentId: 5, critical: false, milestone: false, milestoneNote: null, startT: 0, endT: 2, baselineStart: new Date('2026-10-01T00:00:00Z'), baselineEnd: new Date('2026-12-30T00:00:00Z'),
  startDate: null, dueDate: null, forecastEnd: null, weight: 1, progress: 10, progressAt: null, startedAt: null, completedAt: null, stateId: 1,
  state: { id: 1, name: 'Đang làm', category: 'ACTIVE', color: '#000' }, assignees: [{ user: { id: 3, fullName: 'Người giả' } }], supportDepartments: [{ departmentId: 6 }], ...over });
function fakePrisma(data, { cached = true } = {}) {
  const cache = createMtlCache();
  const calls = [];
  return { calls, cache, data, ...(cached ? { $mtlCache: () => cache } : {}),
    workItem: { findMany: async args => { calls.push(args); return data.filter(r => args.where.projectId.in.includes(r.projectId)).map(r => ({ ...r })); } } };
}
const DATA = () => [row(1, 1), row(2, 1, { parentId: 1 }), row(3, 2), row(4, 3, { progress: 50 })];

test('bản lô giống hệt N lần gọi computeProject, và chỉ một truy vấn', async () => {
  const lone = fakePrisma(DATA(), { cached: false });
  const batch = fakePrisma(DATA(), { cached: false });
  const one = [];
  for (const p of PROJECTS) one.push(await MP.computeProject(lone, p, director, day1));
  assert.equal(lone.calls.length, 3);
  const m = await MP.computeProjects(batch, PROJECTS, director, day1);
  assert.equal(batch.calls.length, 1);
  PROJECTS.forEach((p, k) => {
    assert.deepEqual(m.get(p.id).items, one[k].items);
    assert.deepEqual(m.get(p.id).cfg, one[k].cfg);
    for (const i of one[k].items) assert.equal(m.get(p.id).actualOf(i), one[k].actualOf(i));
  });
  assert.equal(m.get(1).items.find(i => i.id === 1).children, 1);
  assert.equal(m.get(1).items[0].projectId, undefined);
});

test('lần hai trúng bộ đệm; caller sửa kết quả không làm bẩn bộ đệm', async () => {
  const pr = fakePrisma(DATA());
  const a = await MP.computeProjects(pr, PROJECTS, director, day1);
  a.get(1).items[0].hasChecklist = true; a.get(1).items.reverse();
  const b = await MP.computeProjects(pr, PROJECTS, director, day1);
  assert.equal(pr.calls.length, 1);
  assert.equal(b.get(1).items[0].hasChecklist, undefined);
  assert.deepEqual(b.get(1).items.map(i => i.id), [1, 2]);
});

test('ghi (bump) làm bộ đệm hết hiệu lực ngay; thiếu một phần thì chỉ tải phần thiếu', async () => {
  const pr = fakePrisma(DATA());
  await MP.computeProjects(pr, PROJECTS, director, day1);
  pr.data.find(r => r.id === 3).progress = 77; pr.cache.bump();
  const b = await MP.computeProjects(pr, PROJECTS, director, day1);
  assert.equal(pr.calls.length, 2);
  assert.equal(b.get(2).items[0].actual, 77);
  const only = fakePrisma(DATA());
  await MP.computeProjects(only, [PROJECTS[0]], director, day1);
  await MP.computeProjects(only, PROJECTS, director, day1);
  assert.deepEqual(only.calls[1].where.projectId.in, [2, 3]);
});

test('hai người khác phạm vi không dùng chung mục bộ đệm; cùng phạm vi thì dùng chung', async () => {
  const pr = fakePrisma(DATA());
  await MP.computeProjects(pr, PROJECTS, staffA, day1);
  await MP.computeProjects(pr, PROJECTS, staffB, day1);
  assert.equal(pr.calls.length, 2);
  assert.notDeepEqual(pr.calls[0].where.AND, pr.calls[1].where.AND);
  await MP.computeProjects(pr, PROJECTS, { ...staffA }, day1);
  assert.equal(pr.calls.length, 2);
  await MP.computeProjects(pr, PROJECTS, director, day1);
  assert.equal(pr.calls.length, 3);
});

test('sang ngày VN mới thì khoá đổi; cùng ngày VN (khác giờ) vẫn trúng', async () => {
  const pr = fakePrisma(DATA());
  await MP.computeProjects(pr, PROJECTS, director, day1);
  await MP.computeProjects(pr, PROJECTS, director, new Date('2026-11-02T10:00:00Z')); // 17:00 VN, cùng ngày
  assert.equal(pr.calls.length, 1);
  await MP.computeProjects(pr, PROJECTS, director, new Date('2026-11-02T17:30:00Z')); // 00:30 VN ngày kế
  assert.equal(pr.calls.length, 2);
  await MP.computeProjects(pr, PROJECTS, director, day2);
  assert.equal(pr.calls.length, 2);
});

test('ghi xen giữa lúc đang tải: kết quả cũ không được dùng lại', async () => {
  const pr = fakePrisma(DATA());
  const orig = pr.workItem.findMany;
  pr.workItem.findMany = async a => { const r = await orig(a); pr.cache.bump(); return r; }; // có ghi ngay sau khi đọc
  await MP.computeProjects(pr, PROJECTS, director, day1);
  await MP.computeProjects(pr, PROJECTS, director, day1);
  assert.equal(pr.calls.length, 2);
});

test('LRU giới hạn kích thước và lưới an toàn hết hạn', () => {
  let t = 0;
  const c = createMtlCache({ max: 2, safetyMs: 100, now: () => t });
  c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3);
  assert.equal(c.get('b'), undefined); assert.equal(c.get('a'), 1); assert.equal(c.size, 2);
  t = 500; assert.equal(c.get('a'), undefined);
});

// Tích hợp với PostgreSQL thật: MTL_CACHE_TEST_DATABASE_URL=postgresql://…/kp_<tên> (CSDL bản sao dữ liệu giả; bỏ qua nếu không đặt).
const URL = process.env.MTL_CACHE_TEST_DATABASE_URL;
test('$extends: update / updateMany / $executeRaw / $transaction / createMany đều làm bộ đệm hết hiệu lực', { skip: !URL && 'không đặt MTL_CACHE_TEST_DATABASE_URL' }, async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = withMtlCache(new PrismaClient({ datasources: { db: { url: URL } } }));
  try {
    const project = await prisma.project.findFirstOrThrow({ where: { kind: 'MTL', archivedAt: null, items: { some: { archivedAt: null } } } });
    const user = { id: 0, departmentId: null, role: 'user', permissions: [P('work.view', 'VIEW', 'SYSTEM')] };
    const read = async () => (await MP.computeProjects(prisma, [project], user, new Date())).get(project.id).items;
    const v = () => prisma.$mtlCache().version();
    const first = (await read())[0];
    const v0 = v(); await read(); assert.equal(v(), v0); // đọc không đổi phiên bản
    const titleOf = async () => (await read()).find(i => i.id === first.id).title;
    await prisma.workItem.update({ where: { id: first.id }, data: { title: 'Tên mới (giả) 1' } });
    assert.equal(await titleOf(), 'Tên mới (giả) 1');
    await prisma.workItem.updateMany({ where: { id: first.id }, data: { title: 'Tên mới (giả) 2' } });
    assert.equal(await titleOf(), 'Tên mới (giả) 2');
    await prisma.$executeRaw`UPDATE "WorkItem" SET title = ${'Tên mới (giả) 3'} WHERE id = ${first.id}`;
    assert.equal(await titleOf(), 'Tên mới (giả) 3');
    await prisma.$transaction(async tx => { await tx.workItem.update({ where: { id: first.id }, data: { title: 'Tên mới (giả) 4' } }); });
    assert.equal(await titleOf(), 'Tên mới (giả) 4');
    const before = v(); await prisma.$queryRaw`SELECT 1`; assert.equal(v(), before); // SELECT không làm mất bộ đệm
    const n = (await read()).length;
    const reporter = await prisma.user.findFirstOrThrow();
    const made = await prisma.workItem.createMany({ data: [{ projectId: project.id, number: 9000001, title: 'Việc giả tạm', reporterId: reporter.id, stateId: first.stateId }] });
    assert.equal(made.count, 1);
    assert.equal((await read()).length, n + 1);
    await prisma.workItem.deleteMany({ where: { number: 9000001, projectId: project.id } });
    assert.equal((await read()).length, n);
    await prisma.workItem.update({ where: { id: first.id }, data: { title: first.title } });
  } finally { await prisma.$disconnect(); }
});
