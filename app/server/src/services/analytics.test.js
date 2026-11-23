const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./analytics');

const DAY = 86_400_000;
const T0 = new Date('2026-10-01T02:00:00Z');
const at = d => new Date(T0.getTime() + d * DAY);
const from = new Date('2026-10-01T00:00:00+07:00'), to = new Date('2026-10-31T23:59:59.999+07:00'), now = new Date('2026-11-05T03:00:00Z');
let seq = 0;
const item = (extra = {}) => ({ id: ++seq, number: seq, title: 'Việc ' + seq, project: { key: 'DA', departmentId: 1 }, leadDepartmentId: null,
  state: { category: 'COMPLETED' }, dueDate: null, assignedAt: null, createdAt: at(0), startedAt: null, completedAt: null, rating: null, ratedAt: null,
  assignees: [{ userId: 1 }], approvals: [], ...extra });

test('thống kê mô tả: trung vị, tứ phân vị nội suy (PERCENTILE.INC), IQR, cờ mẫu nhỏ', () => {
  const d = A.describe([1, 2, 3, 4, 100]);
  assert.deepEqual([d.n, d.median, d.q1, d.q3, d.iqr, d.mean, d.min, d.max], [5, 3, 2, 4, 2, 22, 1, 100]);
  assert.equal(d.smallSample, false);
  assert.equal(A.describe([2, 4]).median, 3);
  assert.equal(A.describe([2, 4]).smallSample, true);
  assert.deepEqual(A.describe([]), { n: 0, median: null, q1: null, q3: null, iqr: null, mean: null, min: null, max: null, smallSample: true });
  assert.equal(A.describe([null, NaN, 5]).n, 1);
});

test('gộp mức người giao chấm thành Tốt / Trung bình / Kém; điểm bình quân quy về mức', () => {
  assert.deepEqual(['EXCELLENT', 'GOOD', 'PASS', 'NEEDS_IMPROVEMENT', 'POOR', 'FAIL', null].map(A.ratingBand), ['GOOD', 'GOOD', 'AVERAGE', 'POOR', 'POOR', null, null]);
  assert.deepEqual([100, 80, 79.9, 70, 60, 59.9, null].map(A.bandOfScore), ['GOOD', 'GOOD', 'AVERAGE', 'AVERAGE', 'AVERAGE', 'POOR', null]);
});

test('thời gian làm (bắt đầu → xong) và giao → được duyệt (ngày phiếu duyệt cuối cùng)', () => {
  const i = item({ assignedAt: at(0), startedAt: at(2), completedAt: at(5),
    approvals: [{ status: 'REJECTED', closedAt: at(4), actions: [{ decision: 'REJECT' }] }, { status: 'APPROVED', closedAt: at(7), actions: [{ decision: 'APPROVE' }] }] });
  assert.equal(A.workDays(i), 3);
  assert.equal(A.leadDays(i), 7);
  assert.equal(A.rejectionsOf(i), 1);
  // Không qua duyệt → tính đến lúc hoàn thành; không có ngày bắt đầu → từ ngày giao.
  const j = item({ assignedAt: at(1), completedAt: at(4) });
  assert.equal(A.workDays(j), 3);
  assert.equal(A.leadDays(j), 3);
  // Chưa xong → không có thời gian.
  assert.equal(A.leadDays(item({ state: { category: 'STARTED' }, assignedAt: at(1) })), null);
});

test('hàng rào Tukey chỉ khi đủ 8 mẫu; Theil–Sen bền với giá trị lạ', () => {
  assert.equal(A.upperFence([1, 2, 3, 4, 5, 6, 7]), null);
  assert.equal(A.upperFence([1, 2, 2, 3, 3, 3, 4, 4]), 3.25 + 1.5 * (3.25 - 2));
  assert.equal(A.theilSen([[0, 1], [1, 2], [2, 3]]), null);
  assert.equal(A.theilSen([[0, 1], [1, 2], [2, 3], [3, 50], [4, 5]]), 1);
});

test('kỳ con: ≤ 92 ngày theo tuần (bắt đầu thứ Hai), dài hơn theo tháng', () => {
  const w = A.buckets(from, to);
  assert.equal(w.unit, 'week');
  assert.equal(w.list[0].label, 'Tuần 28/09'); // 01/10/2026 là thứ Năm
  assert.equal(w.list.length, 5);
  const m = A.buckets(new Date('2026-01-01T00:00:00+07:00'), to);
  assert.equal(m.unit, 'month');
  assert.equal(m.list.length, 10);
  assert.equal(m.list[9].label, 'Tháng 10/2026');
});

test('phân tích: theo người / phòng, mức đánh giá, cỡ mẫu, ghi chú mẫu nhỏ; không tính việc huỷ hoặc xong ngoài kỳ', () => {
  seq = 0;
  const items = [
    item({ assignedAt: at(0), startedAt: at(1), completedAt: at(3), dueDate: at(5), rating: 'EXCELLENT', ratedAt: at(4) }),
    item({ assignedAt: at(0), startedAt: at(1), completedAt: at(9), dueDate: at(5), rating: 'PASS', ratedAt: at(10) }),
    item({ assignedAt: at(0), completedAt: at(2), assignees: [{ userId: 2 }], leadDepartmentId: 2, rating: 'POOR', ratedAt: at(3) }),
    item({ state: { category: 'CANCELLED' }, completedAt: at(2) }),
    item({ assignedAt: at(-60), completedAt: at(-40) }), // xong ngoài kỳ
    item({ state: { category: 'STARTED' }, assignedAt: at(1) }),
  ];
  const r = A.analyze(items, { from, to, now,
    users: [{ id: 2, fullName: 'Bình', departmentId: 2, departmentName: 'Phòng B' }, { id: 1, fullName: 'An', departmentId: 1, departmentName: 'Phòng A' }],
    departments: [{ id: 1, name: 'Phòng A' }, { id: 2, name: 'Phòng B' }] });
  assert.equal(r.overall.completed, 3);
  assert.deepEqual(r.overall.rating.bands, { GOOD: 1, AVERAGE: 1, POOR: 1 });
  assert.equal(r.overall.rating.avg, 56.7); // (100 + 70 + 0) / 3
  assert.equal(r.overall.rating.band, 'POOR');
  assert.deepEqual(r.overall.onTime, { judged: 2, onTime: 1, rate: 50 });
  // Sắp theo phòng rồi tên, không theo điểm.
  assert.deepEqual(r.byPerson.map(p => [p.fullName, p.completed, p.workDays.median, p.rating.band]), [['An', 2, 5, 'GOOD'], ['Bình', 1, 2, 'POOR']]);
  assert.equal(r.byPerson[0].rating.avg, 85);
  assert.equal(r.byPerson[0].workDays.smallSample, true);
  assert.deepEqual(r.byDepartment.map(d => [d.name, d.completed]), [['Phòng A', 2], ['Phòng B', 1]]);
  assert.equal(r.outliers, null);
  assert.equal(r.control, null);
  assert.equal(r.trend.direction, null);
  assert.ok(r.notes.some(n => n.includes('chưa đủ để kết luận')));
});

test('phân tích: phát hiện việc kéo dài bất thường (xong và đang mở), biểu đồ kiểm soát p, xu hướng tăng', () => {
  seq = 0;
  const items = [];
  // 5 tuần, mỗi tuần 5 việc có hạn; thời gian làm tăng dần theo tuần; tuần cuối trễ hạn cả 5.
  for (let w = 0; w < 5; w++) for (let k = 0; k < 5; k++) {
    const start = at(w * 6 + k * 0.1), days = 1 + w; // xong lần lượt trong 5 tuần khác nhau của tháng 10
    const completedAt = new Date(start.getTime() + days * DAY);
    items.push(item({ assignedAt: start, startedAt: start, completedAt, dueDate: w === 4 ? start : new Date(completedAt.getTime() + DAY) }));
  }
  items.push(item({ assignedAt: at(0), startedAt: at(0), completedAt: at(25) })); // 25 ngày: bất thường
  items.push(item({ state: { category: 'STARTED' }, assignedAt: at(0), startedAt: at(0) })); // mở 35 ngày đến now
  const r = A.analyze(items, { from, to, now, users: [{ id: 1, fullName: 'An', departmentId: 1 }], departments: [{ id: 1, name: 'Phòng A' }] });
  assert.ok(r.outliers.fence < 25);
  assert.deepEqual(r.outliers.completed.map(o => o.days), [25]);
  assert.equal(r.outliers.open.length, 1);
  assert.equal(r.outliers.completed[0].assignees[0], 'An');
  assert.equal(r.trend.direction, 'UP');
  assert.ok(r.control);
  assert.equal(r.control.center, 80);
  assert.ok(r.control.points.some(p => p.signal === 'LOW'), 'tuần trễ hạn toàn bộ phải vượt giới hạn dưới');
});
