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

test('ân hạn "Chậm khởi động": chỉ gắn nhãn sau N ngày làm việc kể từ ngày bắt đầu (mặc định 2)', () => {
  assert.equal(cfg.lateStartGraceDays, 2);
  const at = s => new Date(s + 'T03:00:00Z'); // 10:00 giờ VN
  const it = item('2027-02-15', '2027-02-19'); // thứ Hai → thứ Sáu, giao hôm nay
  const st = d => M.statusOf(it, 0, at(d), cfg);
  assert.equal(st('2027-02-15').code, 'ON_TRACK', 'giao trong ngày: chưa gắn nhãn');
  assert.equal(st('2027-02-15').grace, true);
  assert.equal(st('2027-02-16').code, 'ON_TRACK', 'mới qua 1 ngày làm việc');
  assert.equal(st('2027-02-17').code, 'LATE_START', 'qua 2 ngày làm việc');
  assert.deepEqual(A.kindsFor(it, st('2027-02-15'), at('2027-02-15'), cfg).includes('LATE_START'), false);
  // Bắt đầu thứ Sáu: thứ Bảy, Chủ nhật không tính.
  const fri = item('2027-02-19', '2027-03-05');
  assert.equal(M.statusOf(fri, 0, at('2027-02-22'), cfg).code, 'ON_TRACK'); // thứ Hai: 1 ngày làm việc
  assert.equal(M.statusOf(fri, 0, at('2027-02-23'), cfg).code, 'LATE_START'); // thứ Ba: 2 ngày
  // Cấu hình theo dự án: 0 = gắn ngay như trước.
  assert.equal(M.statusOf(it, 0, at('2027-02-15'), { ...cfg, lateStartGraceDays: 0 }).code, 'LATE_START');
  assert.equal(M.alertConfigOf({ alertConfig: { lateStartGraceDays: 5 } }).lateStartGraceDays, 5);
  assert.equal(M.workdaysBetween(M.vnDay(at('2027-02-19')), M.vnDay(at('2027-02-22'))), 1);
});

test('không nhắc lại "Chậm khởi động" khi việc đã có cập nhật tiến độ', () => {
  const it = item('2027-02-01', '2027-03-31', { progressAt: new Date('2027-02-14T03:00:00Z') });
  const st = M.statusOf(it, 0, day, cfg);
  assert.notEqual(st.code, 'LATE_START');
  assert.equal(A.kindsFor(it, st, day, cfg).includes('LATE_START'), false);
  // Trạng thái cũ còn ghi LATE_START (vd. tính trước khi cập nhật) cũng không sinh cảnh báo.
  assert.deepEqual(A.kindsFor(it, { code: 'LATE_START', daysLeft: 40 }, day, cfg), []);
});

test('thông báo gộp một việc: nêu mọi loại cảnh báo, số liệu ghi "(lúc gửi)"', () => {
  const r = { id: 7, number: 2, title: 'Xin chủ trương đầu tư', critical: true, baselineStart: new Date('2027-01-01'), baselineEnd: new Date('2027-02-20T16:59:59Z') };
  const st = { code: 'BEHIND', planned: 80, variance: -70, daysLeft: 5 };
  const m = A.mergedMessage({ id: 3, key: 'DEMO' }, r, st, 10, ['DUE_SOON', 'BEHIND', 'BEHIND'], day);
  assert.equal(m.title, '[Chậm tiến độ · Sắp đến hạn] DEMO-2 · Xin chủ trương đầu tư (đường găng)');
  assert.equal(m.link, '#/projects/3?item=7');
  const lines = m.body.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Kế hoạch 80% · thực tế 10%, lệch -70 điểm \(lúc gửi\)$/);
  assert.match(lines[1], /thực tế 10% \(lúc gửi\)$/);
  assert.match(lines[2], /^Gửi ngày 15\/02\/2027/);
});

test('chạy cảnh báo: nhiều loại của cùng một việc → một thông báo; thông báo cũ chưa đọc của việc được đánh dấu đã đọc', async () => {
  const project = { id: 1, key: 'DEMO', kind: 'MTL', t0Date: new Date('2026-12-31T17:00:00Z'), leadId: 50 };
  const rows = [{ id: 1, number: 1, title: 'Việc A', parentId: null, leadDepartmentId: null, critical: false, milestone: false, weight: null, progress: 10,
    progressAt: new Date('2027-02-14T03:00:00Z'), startedAt: new Date('2027-01-02'), completedAt: null,
    baselineStart: new Date('2026-12-31T17:00:00Z'), baselineEnd: new Date('2027-02-20T16:59:59Z'), state: { category: 'STARTED' }, assignees: [{ userId: 11 }] }];
  const created = [], notes = [], marked = [];
  const prisma = {
    workItem: { findMany: async () => rows },
    progressAlert: { groupBy: async () => [], createMany: async ({ data }) => { created.push(...data); return { count: 1 }; } },
    projectMember: { findMany: async () => [] },
    user: { findMany: async () => [] },
    notification: { createMany: async ({ data }) => { notes.push(...data); return { count: data.length }; }, updateMany: async a => { marked.push(a.where); return { count: 0 }; } },
    progressSnapshot: { upsert: async () => ({}) },
  };
  const r = await A.runProjectAlerts(prisma, project, day);
  assert.deepEqual(created.map(c => c.kind).sort(), ['BEHIND', 'DUE_SOON']);
  assert.equal(r.alerts, 2);
  assert.equal(notes.length, 2, 'một thông báo cho mỗi người nhận (người chủ trì + PMO)');
  assert.ok(notes.every(n => n.title.startsWith('[Chậm tiến độ · Sắp đến hạn] DEMO-1')));
  assert.equal(new Set(notes.map(n => n.userId)).size, 2);
  assert.equal(marked.length, 1);
  assert.equal(marked[0].link, '#/projects/1?item=1');
});

test('nhắc cập nhật tuần dùng chữ "kỳ này", không dùng "sprint"', async () => {
  const src = require('node:fs').readFileSync(require.resolve('./alerts'), 'utf8');
  assert.match(src, /việc trong kỳ này chưa cập nhật/);
});
