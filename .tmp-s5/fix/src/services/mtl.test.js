const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./mtl');

// Dữ liệu GIẢ, cùng cấu trúc cột với bảng Master Timeline.
const ROWS = [
  ['MASTER TIMELINE — DỰ ÁN MẪU (giả)'],
  ['Bước', 'Hạng mục công việc', 'Đầu mối', 'Bắt đầu (T)', 'Kết thúc (T)', 'Thời lượng (tháng)', 'Đường găng', 'Mốc'],
  [1, 'Hạng mục A (giả)', 'CT/PL', 0, 2, 3, 'ĐƯỜNG GĂNG', ''],
  [2, 'Hạng mục B (giả)', 'Tài chính', 0, 1, 2, '', ''],
  [3, 'Hạng mục C (giả)', 'PL/Sở TC-KH', 2, 4, 3, 'ĐƯỜNG GĂNG', '60 ngày'],
  [4, 'Văn bản chấp thuận (giả)', 'UBND TP', 5, 5, 1, 'ĐƯỜNG GĂNG', '◆'],
  ['PHẦN II — PHÂN KỲ 2 (giả)'],
  ['II.1', 'Hạng mục phân kỳ 2 (giả)', 'Thiết kế/PL', 3, 6, 4, '', ''],
  ['Ghi chú: dòng ghi chú (giả)'],
];
const DEPTS = [{ id: 1, code: 'BLD', name: 'Ban lãnh đạo' }, { id: 2, code: 'PL', name: 'Pháp lý' }, { id: 3, code: 'TC', name: 'Tài chính' }, { id: 4, code: 'TK', name: 'Thiết kế' }];

test('đọc bảng MTL: bước, đầu mối, tháng T, đường găng, mốc, phần', () => {
  const p = M.parseMtlRows(ROWS);
  assert.equal(p.items.length, 5);
  const [a, , c, d, e] = p.items;
  assert.deepEqual([a.step, a.startT, a.endT, a.critical, a.milestone], ['1', 0, 2, true, false]);
  assert.equal(c.milestone, false); assert.equal(c.milestoneNote, '60 ngày');
  assert.equal(d.milestone, true);
  assert.equal(e.step, 'II.1'); assert.match(e.section, /PHẦN II/);
  assert.equal(M.parseMtlRows([['a', 'b'], ['c']]), null);
});

test('MTL bộ phận: ngày cụ thể và cột "Thuộc bước"', () => {
  const p = M.parseMtlRows([
    ['STT', 'Hạng mục', 'Phụ trách', 'Bắt đầu', 'Kết thúc', 'Thuộc bước'],
    ['1.1', 'Soạn hồ sơ (giả)', 'Pháp lý', '05/01/2027', '20/01/2027', '1'],
    ['1.2', 'Sai ngày (giả)', 'Pháp lý', '20/01/2027', '05/01/2027', '1'],
  ]);
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].parentStep, '1');
  assert.ok(p.items[0].startDate instanceof Date && p.items[0].startT == null);
  assert.equal(p.warnings.length, 1);
});

test('quy đổi T → ngày (giờ Việt Nam), thời lượng khớp cột tháng', () => {
  const t0 = new Date('2027-01-10T03:00:00Z');
  const { start, end } = M.tToDates(t0, 0, 2);
  assert.equal(M.vnDay(start), M.vnDay(new Date('2027-01-01T00:00:00+07:00')));
  assert.equal(M.vnDay(end), M.vnDay(new Date('2027-03-31T12:00:00+07:00')));
  const y = M.tToDates(t0, 12, 13);
  assert.equal(M.vnDay(y.start), M.vnDay(new Date('2028-01-01T00:00:00+07:00')));
  assert.equal(M.currentT(t0, new Date('2027-04-15T00:00:00+07:00')), 3);
});

test('đầu mối → bộ phận chủ trì / phối hợp / cơ quan ngoài', () => {
  assert.deepEqual(M.splitOwner('CT/GĐĐH/PL', DEPTS), { leadDepartmentId: 1, supportDepartmentIds: [2], externalParty: '' });
  assert.deepEqual(M.splitOwner('PL/Sở TC-KH', DEPTS), { leadDepartmentId: 2, supportDepartmentIds: [], externalParty: 'Sở TC-KH' });
  assert.deepEqual(M.splitOwner('UBND TP', DEPTS), { leadDepartmentId: null, supportDepartmentIds: [], externalParty: 'UBND TP' });
  assert.equal(M.splitOwner('Thiết kế/PL', DEPTS).leadDepartmentId, 4);
});

test('tiến độ kế hoạch, trạng thái nhanh / chậm / trễ, rollup, SPI, KPI', () => {
  const day = new Date('2027-02-15T05:00:00Z');
  const base = (id, s, e, extra = {}) => ({ id, parentId: null, state: { category: 'STARTED' }, progress: 0, baselineStart: new Date(s + 'T00:00:00+07:00'), baselineEnd: new Date(e + 'T23:59:59+07:00'), ...extra });
  const a = base(1, '2027-01-01', '2027-03-31', { progress: 10, critical: true });   // kế hoạch ~51% → chậm
  const b = base(2, '2027-01-01', '2027-01-31', { progress: 80 });                   // quá hạn
  const c = base(3, '2027-02-01', '2027-02-28', { progress: 90 });                   // vượt
  const d = base(4, '2027-03-01', '2027-03-31');                                     // chưa đến kỳ
  const e = base(5, '2027-01-01', '2027-01-20', { state: { category: 'COMPLETED' }, completedAt: new Date('2027-01-19T10:00:00+07:00') });
  assert.equal(M.statusOf(a, 10, day).code, 'BEHIND');
  assert.equal(M.statusOf(b, 80, day).code, 'OVERDUE');
  assert.equal(M.statusOf(b, 80, day).lateDays, 15);
  assert.equal(M.statusOf(c, 90, day).code, 'AHEAD');
  assert.equal(M.statusOf(d, 0, day).code, 'NOT_DUE');
  assert.equal(M.statusOf(e, 100, day).code, 'DONE_ON_TIME');
  assert.equal(M.statusOf(base(6, '2027-02-01', '2027-02-28'), 0, day).code, 'LATE_START');
  // Rollup: cha = bình quân các việc con, mỗi việc con một phần bằng nhau (trọng số MTL ghi đè).
  const parent = base(10, '2027-01-01', '2027-03-31', { progress: 0 });
  const k1 = base(11, '2027-01-01', '2027-01-31', { parentId: 10, progress: 100 }), k2 = base(12, '2027-02-01', '2027-03-02', { parentId: 10, progress: 0 });
  assert.equal(M.rollup([parent, k1, k2]).get(10), 50);
  assert.equal(M.rollup([parent, { ...k1, weight: 3 }, k2]).get(10), 75);
  // Đầu mục có 5 việc con, xong 1 việc → 20%; xong thêm 1 việc và 1 việc 50% → 50%.
  const big = base(20, '2027-01-01', '2027-03-31');
  const five = [1, 2, 3, 4, 5].map(n => base(20 + n, '2027-01-01', '2027-03-31', { parentId: 20 }));
  const doneSt = { state: { category: 'COMPLETED' } };
  assert.equal(M.rollup([big, { ...five[0], ...doneSt }, ...five.slice(1)]).get(20), 20);
  assert.equal(M.rollup([big, { ...five[0], ...doneSt }, { ...five[1], ...doneSt }, { ...five[2], progress: 50 }, five[3], five[4]]).get(20), 50);
  // Theo cây: dự án 2 bước tổng — bước A có 4 việc con (xong 2), bước B không có con (0%) → (50 + 0) / 2 = 25%.
  const A = base(30, '2027-01-01', '2027-01-31'), B = base(35, '2027-01-01', '2027-01-31');
  const four = [1, 2, 3, 4].map(n => base(30 + n, '2027-01-01', '2027-01-31', { parentId: 30, ...(n <= 2 ? doneSt : {}) }));
  const tp = M.treeProgress([A, ...four, B], i => (M.isDone(i) ? 100 : i.progress), day);
  assert.equal(tp.actualPct, 25); assert.equal(tp.plannedPct, 100); assert.equal(tp.spi, 0.25);
  const all = [a, b, c, d, e], actualOf = i => (M.isDone(i) ? 100 : i.progress);
  const s = M.spiOf(all, actualOf, day);
  assert.ok(s.spi > 0 && s.spi < 2);
  const k = M.kpiOf(all, actualOf, day);
  assert.equal(k.overdue, 1); assert.equal(k.behind, 1); assert.equal(k.ahead, 1); assert.equal(k.criticalLate, 1);
  assert.ok(k.score >= 0 && k.score <= 100);
});

test('sprint theo tháng T: khung ngày, trạng thái, làn phải xong / đang chạy / chuẩn bị, mục tiêu %', () => {
  const t0 = M.vnMidnight(2026, 0, 1); // T0 = 01/2026
  const sp = M.sprintOf(t0, 5); // T5 = 06/2026
  assert.equal(sp.start.toISOString(), '2026-05-31T17:00:00.000Z');
  assert.equal(sp.end.toISOString(), '2026-06-30T16:59:59.999Z');
  assert.equal(sp.days, 30);
  assert.equal(M.sprintState(sp, new Date('2026-06-15T03:00:00Z')), 'CURRENT');
  assert.equal(M.sprintState(sp, new Date('2026-07-01T03:00:00Z')), 'PAST');
  assert.equal(M.sprintState(sp, new Date('2026-05-31T16:00:00Z')), 'FUTURE');
  const next = M.sprintOf(t0, 6);
  const item = (s, e, extra = {}) => { const d = M.tToDates(t0, s, e); return { baselineStart: d.start, baselineEnd: d.end, progress: 0, ...extra }; };
  const done = { state: { category: 'COMPLETED' } };
  // Kết thúc trong sprint → DUE; kéo qua sprint → RUNNING; bắt đầu sprint sau → NEXT; không liên quan → null.
  assert.equal(M.sprintLane(item(3, 5), sp, next), 'DUE');
  assert.equal(M.sprintLane(item(5, 5), sp, next), 'DUE');
  assert.equal(M.sprintLane(item(4, 8), sp, next), 'RUNNING');
  assert.equal(M.sprintLane(item(6, 7), sp, next), 'NEXT');
  assert.equal(M.sprintLane(item(7, 9), sp, next), null);
  assert.equal(M.sprintLane(item(1, 2), sp, next), null);
  // Trễ từ sprint trước, chưa xong: chỉ sprint hiện tại nhận về làn "phải xong"; đã xong thì không.
  assert.equal(M.sprintLane(item(1, 3), sp, next, { current: true }), 'DUE');
  assert.equal(M.sprintLane(item(1, 3, { ...done, completedAt: M.vnMidnight(2026, 3, 20) }), sp, next, { current: true }), null);
  // Đang chạy nhưng đã xong trước khi sprint bắt đầu → không còn trong sprint; xong trong sprint → vẫn hiện.
  assert.equal(M.sprintLane(item(4, 8, { ...done, completedAt: M.vnMidnight(2026, 4, 10) }), sp, next), null);
  assert.equal(M.sprintLane(item(4, 8, { ...done, completedAt: M.vnMidnight(2026, 5, 10) }), sp, next), 'RUNNING');
  // Phải xong trong sprint nhưng đã xong sớm: vẫn ở làn DUE (đã xong).
  assert.equal(M.sprintLane(item(3, 5, { ...done, completedAt: M.vnMidnight(2026, 2, 10) }), sp, next), 'DUE');
  assert.equal(M.sprintLane({ baselineStart: null, baselineEnd: null }, sp, next), null);
  // Mục tiêu: hạng mục T4–T5 (61 ngày) → đầu T5 ≈ 50%, cuối T5 = 100%; hạng mục T5–T6 → 0% → ≈ 49%.
  const tg = M.sprintTarget(item(4, 5), sp);
  assert.equal(tg.to, 100); assert.ok(tg.from > 48 && tg.from < 52, String(tg.from));
  const tg2 = M.sprintTarget(item(5, 6), sp);
  assert.equal(tg2.from, 0); assert.ok(tg2.to > 47 && tg2.to < 51, String(tg2.to));
});

test('kế hoạch gốc cho hạng mục lập trên ứng dụng: [bắt đầu || hôm nay, hạn]; không có hạn → không có kế hoạch', () => {
  const now = new Date('2026-10-23T10:00:00+07:00');
  assert.equal(M.initialBaseline(null, null, now), null);
  const due = new Date('2026-10-30');
  const b = M.initialBaseline(null, due, now);
  assert.equal(b.baselineStart.toISOString(), new Date('2026-10-23T00:00:00+07:00').toISOString());
  assert.equal(b.baselineEnd, due);
  const s = new Date('2026-10-01');
  assert.equal(M.initialBaseline(s, due, now).baselineStart, s);
  // Bắt đầu sau hạn (nhập nhầm): kế hoạch gốc không đảo ngược.
  assert.equal(M.initialBaseline(new Date('2026-11-05'), due, now).baselineStart, due);
  // Có kế hoạch gốc → hạng mục có trạng thái tiến độ (không còn "Chưa có kế hoạch").
  assert.notEqual(M.statusOf({ ...b, progress: 0, state: { category: 'UNSTARTED' } }, 0, now, M.DEFAULT_ALERTS).code, 'NO_PLAN');
  assert.equal(M.statusOf({ progress: 0, state: { category: 'UNSTARTED' } }, 0, now, M.DEFAULT_ALERTS).code, 'NO_PLAN');
});
