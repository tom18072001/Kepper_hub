const test = require('node:test');
const assert = require('node:assert/strict');
const { nextOccurrence, describe } = require('./recurring');
const { withStats } = require('../routes/cycles');
const { defaultWeek } = require('../routes/reports');

// Mốc: Thứ 6, 16/10/2026 12:00 giờ Việt Nam (05:00Z).
const FRI_NOON = new Date('2026-10-16T05:00:00Z');
const vn = d => new Date(d.getTime() + 7 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);

test('hằng ngày: 07:00 ngày kế tiếp nếu đã qua 07:00 hôm nay', () => {
  assert.equal(vn(nextOccurrence({ frequency: 'DAILY', interval: 1 }, FRI_NOON)), '2026-10-17 07:00');
  assert.equal(vn(nextOccurrence({ frequency: 'DAILY', interval: 1 }, new Date('2026-10-15T23:00:00Z'))), '2026-10-16 07:00');
  assert.equal(vn(nextOccurrence({ frequency: 'DAILY', interval: 3 }, FRI_NOON)), '2026-10-19 07:00');
});

test('hằng tuần: đúng thứ trong tuần, bỏ qua nếu hôm nay đã qua giờ chạy', () => {
  assert.equal(vn(nextOccurrence({ frequency: 'WEEKLY', interval: 1, weekday: 1 }, FRI_NOON)), '2026-10-19 07:00');
  assert.equal(vn(nextOccurrence({ frequency: 'WEEKLY', interval: 1, weekday: 5 }, FRI_NOON)), '2026-10-23 07:00');
  assert.equal(vn(nextOccurrence({ frequency: 'WEEKLY', interval: 2, weekday: 5 }, FRI_NOON)), '2026-10-30 07:00');
});

test('hằng tháng: ngày cố định, qua năm mới đúng', () => {
  assert.equal(vn(nextOccurrence({ frequency: 'MONTHLY', interval: 1, monthDay: 20 }, FRI_NOON)), '2026-10-20 07:00');
  assert.equal(vn(nextOccurrence({ frequency: 'MONTHLY', interval: 1, monthDay: 5 }, FRI_NOON)), '2026-11-05 07:00');
  assert.equal(vn(nextOccurrence({ frequency: 'MONTHLY', interval: 3, monthDay: 1 }, new Date('2026-12-15T00:00:00Z'))), '2027-03-01 07:00');
  assert.equal(describe({ frequency: 'WEEKLY', interval: 1, weekday: 7 }), 'Mỗi tuần vào Chủ nhật');
});

test('tiến độ chu kỳ không tính việc huỷ vào phạm vi', () => {
  const s = withStats({ id: 1, name: 'C1', startDate: new Date('2026-10-12T17:00:00Z'), endDate: new Date('2026-10-18T17:00:00Z'),
    items: ['COMPLETED', 'COMPLETED', 'STARTED', 'CANCELLED'].map(category => ({ state: { category } })) }, FRI_NOON);
  assert.equal(s.status, 'ACTIVE');
  assert.deepEqual([s.total, s.scope, s.done, s.open, s.progress], [4, 3, 2, 1, 67]);
  assert.equal(withStats({ startDate: new Date('2026-10-19T17:00:00Z'), endDate: new Date('2026-10-25T17:00:00Z'), items: [] }, FRI_NOON).status, 'UPCOMING');
});

test('tuần mặc định của báo cáo là Thứ 2 → Chủ nhật giờ Việt Nam', () => {
  const { from, to } = defaultWeek(FRI_NOON);
  assert.equal(vn(from), '2026-10-12 00:00');
  assert.equal(vn(to), '2026-10-18 00:00');
});
