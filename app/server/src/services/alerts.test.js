const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./alerts');
const M = require('./mtl');

const cfg = M.DEFAULT_ALERTS;
const day = new Date('2027-02-15T05:00:00Z');
const item = (s, e, extra = {}) => ({ id: 1, state: { category: 'STARTED' }, progress: 0, baselineStart: new Date(s + 'T00:00:00+07:00'), baselineEnd: new Date(e + 'T23:59:59+07:00'), ...extra });

test('loại cảnh báo theo trạng thái hạng mục', () => {
  const kinds = (it, a) => A.kindsFor(it, M.statusOf(it, a, day, cfg), day, cfg);
  assert.deepEqual(kinds(item('2027-02-20', '2027-03-31'), 0), ['START_SOON']);
  assert.deepEqual(kinds(item('2027-01-01', '2027-01-31', { progress: 50 }), 50), ['OVERDUE']);
  assert.deepEqual(kinds(item('2027-01-01', '2027-02-20', { progress: 10, startedAt: new Date('2027-01-02'), progressAt: new Date('2027-02-14') }), 10), ['BEHIND', 'DUE_SOON']);
  assert.deepEqual(kinds(item('2027-02-01', '2027-04-30', { progress: 40, startedAt: new Date('2027-02-01'), progressAt: new Date('2027-02-01') }), 40), ['AHEAD', 'STALE']);
  assert.deepEqual(kinds(item('2027-02-01', '2027-03-31'), 0), ['LATE_START']);
});

test('chu kỳ nhắc lại', () => {
  assert.equal(A.shouldSend('BEHIND', null, day), true);
  assert.equal(A.shouldSend('BEHIND', new Date('2027-02-10T05:00:00Z'), day), false);
  assert.equal(A.shouldSend('BEHIND', new Date('2027-02-08T05:00:00Z'), day), true);
  assert.equal(A.shouldSend('START_SOON', new Date('2027-01-01T05:00:00Z'), day), false); // chỉ một lần
  assert.equal(A.shouldSend('OVERDUE', new Date('2027-02-12T05:00:00Z'), day), true);
});

test('nhắc cập nhật hằng tuần: mỗi người một thông báo, chỉ việc trong sprint hiện tại đã tới ngày bắt đầu và lâu chưa cập nhật', async () => {
  const M = require('./mtl');
  const day = new Date('2026-06-19T08:00:00Z'); // thứ Sáu, T5 nếu T0 = 01/2026
  const t0 = M.vnMidnight(2026, 0, 1);
  const item = (id, s, e, extra = {}) => { const d = M.tToDates(t0, s, e); return { id, parentId: null, baselineStart: d.start, baselineEnd: d.end, progressAt: null, startedAt: null, completedAt: null, leadDepartmentId: 9, state: { category: 'STARTED' }, assignees: [], ...extra }; };
  const rows = [
    item(1, 4, 6, { assignees: [{ userId: 11 }], progressAt: new Date('2026-06-01T03:00:00Z') }), // đang chạy, 18 ngày chưa cập nhật → nhắc 11
    item(2, 3, 5, { assignees: [{ userId: 11 }] }), // phải xong T5, chưa cập nhật lần nào → nhắc 11
    item(3, 4, 6, { assignees: [{ userId: 12 }], progressAt: new Date('2026-06-17T03:00:00Z') }), // mới cập nhật 2 ngày → không nhắc
    item(4, 5, 7), // chưa giao người → lãnh đạo bộ phận 9 (người 20)
    item(5, 1, 2, { assignees: [{ userId: 13 }], state: { category: 'COMPLETED' }, completedAt: new Date('2026-03-01T03:00:00Z') }), // đã xong
    item(6, 7, 8, { assignees: [{ userId: 14 }] }), // sprint sau
  ];
  const sent = [];
  const prisma = {
    project: { findMany: async () => [{ id: 1, t0Date: t0 }] },
    workItem: { findMany: async () => rows },
    user: { findMany: async () => [{ id: 20, departmentId: 9, isActive: true, permissions: [{ permissionKey: 'work.approve', action: 'OPERATE', scope: 'UNIT' }] }] },
    delegation: { findMany: async () => [] },
    notification: { createMany: async ({ data }) => { sent.push(...data); return { count: data.length }; } },
  };
  const r = await A.runWeeklyUpdateReminder(prisma, day);
  assert.equal(r.users, 2);
  const by = Object.fromEntries(sent.map(n => [n.userId, n]));
  assert.match(by[11].title, /2 việc/); assert.equal(by[11].link, '#/sprint');
  assert.match(by[20].title, /1 việc/);
  assert.equal(by[12], undefined); assert.equal(by[13], undefined); assert.equal(by[14], undefined);
});

test('Viber: chặn dò mã liên kết sau 5 lần sai trong 1 giờ; gọi API có timeout', async () => {
  const V = require('./viber');
  const id = 'dò-' + Date.now(), t0 = 1_000_000;
  for (let i = 0; i < 5; i++) { assert.equal(V.linkBlocked(id, t0), false); V.linkFailed(id, t0); }
  assert.equal(V.linkBlocked(id, t0 + 1000), true);
  assert.equal(V.linkBlocked(id, t0 + 3_600_001), false, 'hết khung giờ thì mở lại');
  let opts;
  await V.call('x', {}, async (_u, o) => { opts = o; return { json: async () => ({ status: 0 }) }; });
  assert.ok(opts.signal instanceof AbortSignal);
});
