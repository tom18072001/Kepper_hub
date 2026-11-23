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

test('đánh giá chung: dưới 5 việc được chấm KHÔNG kết luận (kể cả khi có một lần Kém); từ 5 việc mới quy về mức', () => {
  // Các ca review vòng 1: 2 Tốt + 1 Kém, 1 Xuất sắc + 1 Kém, chỉ 1 Kém → không đưa ra "Kém".
  for (const ratings of [['GOOD', 'GOOD', 'POOR'], ['EXCELLENT', 'POOR'], ['POOR'], ['GOOD', 'GOOD', 'GOOD', 'GOOD'], []])
    assert.deepEqual(A.overallRating(ratings), { score: null, band: null, mean: null }, ratings.join(','));
  // Chủ dự án chốt TRUNG VỊ: 4 Tốt + 1 Kém → trung vị 85 → Tốt (bình quân 68 sẽ ra Trung bình); 3 Kém + 2 Tốt → trung vị 0 → Kém.
  assert.deepEqual(A.overallRating(['GOOD', 'GOOD', 'GOOD', 'GOOD', 'POOR']), { score: 85, band: 'GOOD', mean: 68 });
  assert.deepEqual(A.overallRating(['POOR', 'POOR', 'POOR', 'GOOD', 'GOOD']), { score: 0, band: 'POOR', mean: 34 });
  assert.deepEqual(A.overallRating(['GOOD', 'GOOD', 'GOOD', 'PASS', 'PASS']), { score: 85, band: 'GOOD', mean: 79 });
  assert.deepEqual(A.overallRating(['PASS', 'PASS', 'PASS', 'GOOD', 'EXCELLENT', 'POOR']), { score: 70, band: 'AVERAGE', mean: 65.8 }); // n chẵn: nội suy
  // Mức cũ không thuộc thang (FAIL đã đổi thành POOR) bị bỏ, không làm đủ cỡ mẫu.
  assert.deepEqual(A.overallRating(['GOOD', 'GOOD', 'GOOD', 'GOOD', 'FAIL']), { score: null, band: null, mean: null });
});

test('thời gian làm (bắt đầu → xong) và giao → được duyệt (ngày phiếu duyệt cuối cùng)', () => {
  const i = item({ assignedAt: at(0), startedAt: at(2), completedAt: at(5),
    approvals: [{ status: 'REJECTED', closedAt: at(4), actions: [{ decision: 'REJECT' }] }, { status: 'APPROVED', closedAt: at(7), actions: [{ decision: 'APPROVE' }] }] });
  assert.equal(A.workDays(i), 3);
  assert.equal(A.leadDays(i), 7);
  assert.equal(A.rejectionsOf(i), 1);
  // Không qua duyệt → giao → duyệt tính đến lúc hoàn thành. Không ghi nhận lúc bắt đầu → KHÔNG có thời gian làm (không lấy ngày giao thay).
  const j = item({ assignedAt: at(1), completedAt: at(4) });
  assert.equal(A.workDays(j), null);
  assert.equal(A.leadDays(j), 3);
  // Ca review: giao ngày 0, bắt đầu ngày 9, xong ngày 10 → làm 1 ngày; cùng việc không bấm "Bắt đầu" → không tính (trước đây 10 ngày).
  assert.equal(A.workDays(item({ assignedAt: at(0), startedAt: at(9), completedAt: at(10) })), 1);
  assert.equal(A.workDays(item({ assignedAt: at(0), completedAt: at(10) })), null);
  // Chưa xong → không có thời gian.
  assert.equal(A.leadDays(item({ state: { category: 'STARTED' }, assignedAt: at(1) })), null);
});

test('giao → được duyệt tính từ mốc sớm hơn (giao, bắt đầu) nên luôn ≥ thời gian làm — ca KT-2 (ngày giao sau ngày bắt đầu)', () => {
  // KT-2: giao 24/11 (ngày giao sửa tay), bắt đầu 21/11, xong 24/11 → làm 3 ngày; trước đây giao → duyệt = 0.
  const kt2 = item({ assignedAt: new Date('2026-11-24T02:00:00Z'), startedAt: new Date('2026-11-21T02:00:00Z'), completedAt: new Date('2026-11-24T02:00:00Z') });
  assert.equal(A.workDays(kt2), 3);
  assert.equal(A.leadDays(kt2), 3);
  assert.equal(A.assignedAfterStart(kt2), true);
  assert.equal(A.leadStart(kt2).toISOString(), '2026-11-21T02:00:00.000Z');
  // Bình thường (giao trước bắt đầu): vẫn từ ngày giao.
  const ok = item({ assignedAt: at(0), startedAt: at(2), completedAt: at(5) });
  assert.equal(A.leadDays(ok), 5);
  assert.equal(A.assignedAfterStart(ok), false);
  // Không có ngày giao: dùng ngày tạo, rồi so với ngày bắt đầu.
  assert.equal(A.leadDays(item({ assignedAt: null, createdAt: at(3), startedAt: at(1), completedAt: at(4) })), 3);
  // Phân tích: đếm số việc ngày giao sau ngày bắt đầu, ghi chú dữ liệu, cờ trên dòng chi tiết; giao → duyệt ≥ thời gian làm ở mọi dòng.
  const r = A.analyze([kt2, ok], { from: new Date('2026-10-01T00:00:00+07:00'), to: new Date('2026-11-30T23:59:59+07:00'), now: new Date('2026-11-25T00:00:00Z'), users: [{ id: 1, fullName: 'An' }] });
  assert.equal(r.overall.assignedAfterStart, 1);
  assert.equal(r.byPerson[0].assignedAfterStart, 1);
  assert.ok(r.notes.some(n => n.startsWith('1 việc có ngày giao sau ngày bắt đầu')));
  assert.deepEqual(r.details.map(d => d.assignedAfterStart), [false, true]);
  for (const d of r.details) assert.ok(d.leadDays >= d.workDays, d.code);
});

test('xu hướng không hiện kỳ chưa tới; việc mở chưa bắt đầu trong danh sách bất thường gắn cờ chưa bắt đầu', () => {
  seq = 0;
  const items = [];
  for (let k = 0; k < 10; k++) items.push(item({ assignedAt: at(k), startedAt: at(k), completedAt: at(k + 1 + (k % 3)) }));
  items.push(item({ state: { category: 'STARTED' }, assignedAt: at(0), startedAt: at(0) }));
  items.push(item({ state: { category: 'UNSTARTED' }, assignedAt: at(0) }));
  const r = A.analyze(items, { from: new Date('2026-01-01T00:00:00+07:00'), to: new Date('2026-12-31T23:59:59+07:00'), now: new Date('2026-11-05T03:00:00Z'), users: [] });
  assert.equal(r.trend.unit, 'month');
  assert.equal(r.trend.series.at(-1).label, 'Tháng 11/2026'); // không có Tháng 12/2026
  assert.deepEqual(r.outliers.open.map(o => o.notStarted).sort(), [false, true]);
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
    item({ assignedAt: at(0), completedAt: at(2), assignees: [{ userId: 2 }], leadDepartmentId: 2, rating: 'POOR', ratedAt: at(3), dueDate: at(1) }),
    item({ state: { category: 'CANCELLED' }, completedAt: at(2) }),
    item({ assignedAt: at(-60), completedAt: at(-40) }), // xong ngoài kỳ
    item({ state: { category: 'STARTED' }, assignedAt: at(1) }),
  ];
  const r = A.analyze(items, { from, to, now,
    users: [{ id: 2, fullName: 'Bình', departmentId: 2, departmentName: 'Phòng B' }, { id: 1, fullName: 'An', departmentId: 1, departmentName: 'Phòng A' }],
    departments: [{ id: 1, name: 'Phòng A' }, { id: 2, name: 'Phòng B' }] });
  assert.equal(r.overall.completed, 3);
  assert.deepEqual(r.overall.rating.bands, { GOOD: 1, AVERAGE: 1, POOR: 1 });
  // 3 việc được chấm (Xuất sắc, Đạt, Kém) < 5 → không kết luận; chỉ có phân bố.
  assert.equal(r.overall.rating.median, null);
  assert.equal(r.overall.rating.mean, null);
  assert.equal(r.overall.rating.band, null);
  assert.deepEqual(r.overall.onTime, { judged: 3, onTime: 1, rate: 33 });
  // Thời gian làm chỉ từ việc có ghi nhận bắt đầu (2 việc của An: 2 và 8 ngày) → TB 5, trung vị 5; việc của Bình không có bắt đầu.
  assert.deepEqual([r.overall.workDays.n, r.overall.workDays.mean, r.overall.workDays.median, r.overall.noStart], [2, 5, 5, 1]);
  assert.deepEqual([r.overall.leadDays.n, r.overall.leadDays.mean], [3, 4.7]); // (3 + 9 + 2) / 3
  assert.ok(r.notes.some(n => n.startsWith('1 việc không ghi nhận lúc bắt đầu')));
  assert.ok(r.notes.some(n => n.includes('chưa đưa ra đánh giá chung')));
  // Sắp theo phòng rồi tên, không theo điểm.
  assert.deepEqual(r.byPerson.map(p => [p.fullName, p.completed, p.workDays.median, p.workDays.n, p.rating.band]), [['An', 2, 5, 2, null], ['Bình', 1, null, 0, null]]);
  assert.deepEqual(r.byPerson[1].rating.bands, { GOOD: 0, AVERAGE: 0, POOR: 1 });
  assert.equal(r.byPerson[0].workDays.smallSample, true);
  // Chi tiết từng việc hoàn thành trong kỳ, theo ngày xong.
  assert.deepEqual(r.details.map(d => [d.code, d.workDays, d.leadDays, d.onTime, d.rating]), [
    ['DA-3', null, 2, false, 'POOR'], ['DA-1', 2, 3, true, 'EXCELLENT'], ['DA-2', 8, 9, false, 'PASS']]);
  assert.equal(r.details[1].department, 'Phòng A');
  assert.deepEqual(r.details[0].assignees, ['Bình']);
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
