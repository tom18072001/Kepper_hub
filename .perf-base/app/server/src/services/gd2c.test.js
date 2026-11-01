// GĐ2c — Sổ giao việc: trạng thái hạn, tổng hợp theo cán bộ chủ trì, đọc Kế hoạch năm (.docx giả).
const test = require('node:test');
const assert = require('node:assert/strict');
const { deadlineStatus, summarize } = require('./register');
const { parsePlanDocx } = require('./plan-parser');
const { buildPlanDocx } = require('./__fixtures__/plan-docx');

const H7 = 7 * 3_600_000;
const vn = (y, m, d, h = 9) => new Date(Date.UTC(y, m - 1, d, h) - H7);
const now = vn(2026, 10, 16, 20);

test('trạng thái hạn theo ngày lịch giờ VN, đúng quy tắc của sổ', () => {
  const st = (due, extra = {}) => deadlineStatus({ dueDate: due, state: { category: 'STARTED' }, ...extra }, now, 3).code;
  assert.equal(st(vn(2026, 10, 15, 23)), 'OVERDUE');
  assert.equal(st(vn(2026, 10, 16, 0)), 'DUE_SOON'); // hạn hôm nay = còn 0 ngày
  assert.equal(st(vn(2026, 10, 19)), 'DUE_SOON');
  assert.equal(st(vn(2026, 10, 20)), 'IN_PROGRESS');
  assert.equal(st(null), 'NO_DUE');
  const done = (c, d) => deadlineStatus({ dueDate: vn(2026, 10, 10), completedAt: c, state: { category: 'COMPLETED' } }, now).code;
  assert.equal(done(vn(2026, 10, 10, 23)), 'DONE_ON_TIME');
  assert.equal(done(vn(2026, 10, 11, 0)), 'DONE_LATE');
  assert.equal(deadlineStatus({ dueDate: vn(2026, 1, 1), state: { category: 'CANCELLED' } }, now).code, 'CANCELLED');
});

test('tổng hợp: tỷ lệ đúng hạn, việc phối hợp, tổng cộng tính mỗi việc một lần', () => {
  const users = [{ id: 1, fullName: 'A' }, { id: 2, fullName: 'B' }];
  const it = (lead, cat, due, done, sup = []) => ({ dueDate: due, completedAt: done, state: { category: cat }, assignees: lead.map(userId => ({ userId })), supporters: sup.map(userId => ({ userId })) });
  const items = [
    it([1, 2], 'COMPLETED', vn(2026, 10, 1), vn(2026, 9, 30)),
    it([1], 'COMPLETED', vn(2026, 10, 1), vn(2026, 10, 3), [2]),
    it([2], 'STARTED', vn(2026, 10, 1)),
    it([], 'STARTED', vn(2026, 10, 1)), // không có người chủ trì trong phạm vi → không vào tổng
    it([1], 'CANCELLED', vn(2026, 10, 1)),
  ];
  const r = summarize(items, users, { now });
  const a = r.rows.find(x => x.userId === 1), b = r.rows.find(x => x.userId === 2);
  assert.deepEqual([a.total, a.doneOnTime, a.doneLate, a.onTimeRate], [2, 1, 1, 50]);
  assert.deepEqual([b.total, b.overdue, b.supporting, b.onTimeRate], [2, 1, 1, 100]);
  assert.deepEqual([r.total.total, r.total.overdue, r.total.onTimeRate], [3, 1, 50]);
});

test('đọc Kế hoạch năm: nhóm, kinh phí, hạn, mốc tháng, việc định kỳ theo Quý, người chủ trì', async () => {
  const plan = parsePlanDocx(await buildPlanDocx({ year: 2027 }));
  assert.equal(plan.year, 2027);
  assert.equal(plan.sections.length, 2);
  assert.equal(plan.tasks.length, 2);
  const [t1, t2] = plan.tasks;
  assert.equal(t1.code, '1.1');
  assert.equal(t1.budget, 350);
  assert.equal(t1.due.toISOString(), vn(2027, 8, 31, 0).toISOString());
  assert.deepEqual(t1.milestones.map(m => m.title), ['Ban hành thể lệ', 'Tổ chức vòng chung kết']);
  assert.equal(t1.milestones[1].due.toISOString(), vn(2027, 7, 31, 0).toISOString());
  assert.deepEqual(t1.leadNames, ['Lê Thu Hà']);
  assert.deepEqual(t1.coordinatorNames, ['Phạm Văn An']);
  assert.match(t1.deliverable, /500 thí sinh\nBáo cáo tổng kết/);
  assert.match(t1.section, /^1\. Tổ chức/);
  assert.equal(t2.milestones.length, 4);
  assert.equal(t2.milestones[0].due.toISOString(), vn(2027, 3, 25, 0).toISOString());
  assert.equal(t2.due.toISOString(), vn(2027, 12, 25, 0).toISOString());
  assert.throws(() => parsePlanDocx(Buffer.from('không phải docx')), /Word/);
});
