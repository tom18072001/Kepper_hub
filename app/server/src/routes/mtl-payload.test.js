const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const MP = require('../services/mtl-project');
const { mtlRow } = require('./mtl');

// Dữ liệu GIẢ. Kiểm hạng mục trả cho GET /api/projects/:id/mtl: đủ trường màn MTL / MCP / e2e đọc, không còn trường đã bỏ (docs/perf/allow-k1b.txt).
const DROPPED = ['state', 'stateId', 'number', 'progress', 'progressAt', 'startedAt', 'startDate', 'dueDate', 'weight', 'milestoneNote', 'planSection', 'daysLeft', 'startsIn'];
const NEEDED = ['id', 'code', 'planCode', 'planId', 'title', 'parentId', 'children', 'critical', 'milestone', 'assignees', 'ownerText', 'externalParty', 'leadDepartmentId', 'leadDepartmentName',
  'supportDepartmentIds', 'startT', 'endT', 'baselineStart', 'baselineEnd', 'forecastEnd', 'completedAt', 'planned', 'actual', 'status', 'statusLabel', 'variance', 'lateDays', 'sprint'];
const project = { id: 1, key: 'DA', kind: 'MTL', t0Date: new Date('2026-01-01T00:00:00Z'), alertConfig: null };
const user = { id: 1, departmentId: 9, role: 'user', permissions: [{ permissionKey: 'work.view', action: 'VIEW', scope: 'SYSTEM' }] };
const row = (id, over = {}) => ({ id, projectId: 1, number: id, title: `Việc ${id}`, parentId: null, planId: 7, planCode: String(id), planSection: null, ownerText: 'Bộ phận giả', externalParty: 'Đối tác giả',
  leadDepartmentId: 5, critical: false, milestone: false, milestoneNote: null, startT: 0, endT: 2, baselineStart: new Date('2026-10-01T00:00:00Z'), baselineEnd: new Date('2026-12-30T00:00:00Z'),
  startDate: new Date('2026-10-01T00:00:00Z'), dueDate: new Date('2026-12-30T00:00:00Z'), forecastEnd: null, weight: 1, progress: 10, progressAt: null, startedAt: null, completedAt: null, stateId: 1,
  state: { id: 1, name: 'Đang làm', category: 'ACTIVE', color: '#000' }, assignees: [{ user: { id: 3, fullName: 'Người giả' } }], supportDepartments: [{ departmentId: 6 }], ...over });
const prisma = { workItem: { findMany: async () => [row(1), row(2, { parentId: 1 })] } };
const day = new Date('2026-11-02T03:00:00Z');

test('mtlRow bỏ trường không nơi nào đọc, giữ đủ trường giao diện / MCP / e2e', async () => {
  const { items } = await MP.computeProject(prisma, project, user, day);
  assert.ok(DROPPED.every(k => k in items[0]), 'dữ liệu nguồn vẫn có đủ trường (chỉ route rút gọn)');
  const out = items.map(i => mtlRow(i, 'Phòng giả', 0));
  for (const o of out) {
    for (const k of DROPPED) assert.ok(!(k in o), `không còn ${k}`);
    for (const k of NEEDED) assert.ok(k in o, `còn ${k}`);
    assert.deepEqual(o.assignees, [{ id: 3, fullName: 'Người giả' }]);
    assert.equal(o.leadDepartmentName, 'Phòng giả');
  }
  assert.equal(out.find(o => o.planCode === '1').children, 1);
  assert.ok(JSON.stringify(out).length < JSON.stringify(items).length * 0.7, 'payload nhỏ đi rõ rệt');
});

test('mtlRow không làm bẩn hạng mục gốc (bộ đệm dùng chung)', async () => {
  const { items } = await MP.computeProject(prisma, project, user, day);
  const before = JSON.stringify(items[0]);
  mtlRow(items[0], 'X', 1);
  assert.equal(JSON.stringify(items[0]), before);
});

test('màn MTL (web) không đọc trường đã bỏ trên hạng mục', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'web', 'js', 'views', 'mtl.js'), 'utf8');
  for (const k of DROPPED) assert.ok(!new RegExp(`\\b(i|it|row)\\.${k}\\b`).test(src), `mtl.js đọc i.${k}`);
});
