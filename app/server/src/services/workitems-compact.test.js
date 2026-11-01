const test = require('node:test');
const assert = require('node:assert/strict');
const { compactItem, aggregateItem, AGG_KEYS } = require('./workitems');

const full = {
  id: 7, projectId: 3, number: 12, code: 'PF01-12', title: 'Việc mẫu (giả)', stateId: 5, priority: 'HIGH',
  startDate: '2026-01-01T00:00:00.000Z', dueDate: '2026-02-01T00:00:00.000Z', baselineStart: '2026-01-01T00:00:00.000Z', baselineEnd: '2026-02-01T00:00:00.000Z',
  progress: 40, critical: false, milestone: false, estimate: null, deliverable: '', outputs: 'Biên bản', note: '', excerpt: '',
  recurringRuleId: null, reviewedById: 9, milestoneNote: 'x', weight: 2, ratedById: 4, deletedById: null,
  startedAt: '2026-01-02T00:00:00.000Z', reporterId: 1, reviewedAt: null, updatedAt: '2026-01-03T00:00:00.000Z', progressAt: null,
  assignees: [{ id: 1, fullName: 'Người A', username: 'a' }], supporters: [], labels: [], supportDepartmentIds: [],
  counts: { comments: 0, attachments: 0, children: 0, checklistDone: 0, checklistTotal: 0 },
  stage: { code: 'DOING', label: 'Đang thực hiện' }, project: { id: 3, key: 'PF01', name: 'Dự án mẫu (giả)' }, state: { id: 5, name: 'Đang làm', category: 'STARTED', color: '#000' },
  descriptionHtml: '<p>không trả</p>', leadDepartmentName: 'Phòng A', deadline: 'IN_PROGRESS', leadDeptId: 2,
};

test('danh sách việc dự án: giữ trường giao diện, bỏ null / false / chuỗi rỗng văn bản và trường chỉ chi tiết đọc', () => {
  const o = compactItem(full);
  for (const k of ['id', 'code', 'title', 'stateId', 'dueDate', 'baselineEnd', 'progress', 'outputs', 'assignees', 'supporters', 'labels', 'supportDepartmentIds', 'counts', 'stage']) assert.ok(k in o, k);
  for (const k of ['critical', 'milestone', 'estimate', 'deliverable', 'note', 'excerpt', 'recurringRuleId', 'reviewedById', 'milestoneNote', 'weight', 'ratedById', 'deletedById', 'startedAt', 'reporterId', 'updatedAt']) assert.ok(!(k in o), k);
  assert.deepEqual(o.supporters, []);
});

test('danh sách tổng hợp: chỉ trường trong danh sách cho phép, mảng người luôn có, người chỉ còn id + tên', () => {
  const o = aggregateItem({ ...full, supporters: [] });
  for (const k of Object.keys(o)) assert.ok(AGG_KEYS.includes(k), k);
  for (const k of ['id', 'code', 'title', 'dueDate', 'progress', 'assignees', 'supporters', 'labels', 'stage', 'deadline', 'leadDeptId', 'project', 'stateId']) assert.ok(k in o, k);
  for (const k of ['counts', 'number', 'outputs', 'excerpt', 'descriptionHtml', 'startedAt', 'critical']) assert.ok(!(k in o), k);
  assert.deepEqual(o.assignees, [{ id: 1, fullName: 'Người A' }]);
  assert.deepEqual(o.state, { name: 'Đang làm', category: 'STARTED', color: '#000' });
  assert.ok(!('baselineStart' in o) && !('baselineEnd' in o), 'mốc gốc trùng ngày hiện tại thì bỏ');
});

test('mốc gốc khác ngày hiện tại thì giữ (MCP đọc baselineEnd khi thiếu dueDate)', () => {
  const o = aggregateItem({ ...full, dueDate: '2026-03-01T00:00:00.000Z' });
  assert.equal(o.baselineEnd, full.baselineEnd);
});
