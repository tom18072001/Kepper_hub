// Đợt B review UX: phạm vi số liệu "phòng ban" (B5 / N6) và gộp "Loại nhiệm vụ" vào "Nguồn giao việc" (B4). Dữ liệu giả.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./stats');
const W = require('./workitems');

const OPEN = { category: 'STARTED' }, DONE = { category: 'COMPLETED' };
const item = (o) => ({ leadDepartmentId: null, project: { departmentId: 1 }, state: OPEN, assignees: [], supporters: [], ...o });

test('thống kê phòng ban: việc phòng khác chủ trì mà người trong phòng làm → đếm riêng, không cộng vào phòng', () => {
  const items = [
    item({ leadDepartmentId: 2, assignees: [{ user: { departmentId: 1 } }] }), // phòng 2 chủ trì, người phòng 1 chủ trì → ngoài phạm vi phòng 1
    item({ leadDepartmentId: 3, supporters: [{ user: { departmentId: 1 } }] }), // phòng 1 chỉ phối hợp → ngoài phạm vi
    item({ leadDepartmentId: 1, assignees: [{ user: { departmentId: 1 } }] }), // phòng 1 chủ trì → trong phạm vi, không đếm "ngoài"
    item({ leadDepartmentId: null, project: { departmentId: 1 }, assignees: [{ user: { departmentId: 1 } }] }), // không có phòng chủ trì, dự án của phòng 1
    item({ leadDepartmentId: 2, state: DONE, assignees: [{ user: { departmentId: 1 } }] }), // đã xong → không đếm
    item({ leadDepartmentId: 2, assignees: [{ user: { departmentId: 4 } }] }), // không ai của phòng 1
  ];
  assert.equal(S.outsideScope(items, 1), 2);
  assert.equal(S.outsideScope(items, null), 0);
  // Cách đếm của phòng không đổi: việc thuộc phòng = phòng chủ trì ?? phòng sở hữu dự án.
  assert.deepEqual(items.filter(i => S.inDepartment(i, 1)).length, 2);
});

test('ghi chú phạm vi: nói rõ đếm theo phòng chủ trì và số việc ngoài phạm vi', () => {
  const unit = S.scopeNote({ scope: 'UNIT', departmentId: 1, deptName: 'Phòng Tổng hợp (giả)', outside: 2 });
  assert.match(unit, /^Phạm vi: việc Phòng Tổng hợp \(giả\) chủ trì/);
  assert.match(unit, /kể cả việc trong dự án dùng chung/);
  assert.match(unit, /còn 2 việc đang mở người trong Phòng Tổng hợp \(giả\) chủ trì hoặc phối hợp nhưng phòng khác chủ trì/);
  assert.doesNotMatch(S.scopeNote({ scope: 'UNIT', departmentId: 1, deptName: 'P', outside: 0 }), /Ngoài phạm vi/);
  assert.match(S.scopeNote({ scope: 'SYSTEM', departmentId: null }), /^Phạm vi: mọi việc ở mọi phòng/);
});

test('một trường "Nguồn giao việc": "Kế hoạch năm" → nhiệm vụ kế hoạch năm, nguồn khác → đột xuất, trống → giữ loại cũ', () => {
  assert.equal(W.taskTypeOfSource('Kế hoạch năm'), 'PLAN');
  assert.equal(W.taskTypeOfSource('kế hoạch năm 2027'), 'PLAN');
  assert.equal(W.taskTypeOfSource('Ke hoach nam'), 'PLAN');
  assert.equal(W.taskTypeOfSource('Chỉ đạo của lãnh đạo'), 'ADHOC');
  assert.equal(W.taskTypeOfSource('Họp giao ban'), 'ADHOC');
  assert.equal(W.taskTypeOfSource(''), null);
  assert.equal(W.taskTypeOfSource(null), null);
});
