const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./mtl-sprints');
const M = require('./mtl');

// Dữ liệu GIẢ, cùng cấu trúc bước với MTL: 1…12, II.1…II.3 và hạng mục con của MTL bộ phận.
const t0 = M.vnMidnight(2026, 0, 1);
const it = (id, code, s, e, extra = {}) => { const d = M.tToDates(t0, s, e); return { id, planCode: code, parentId: null, title: `Bước ${code} (giả)`, baselineStart: d.start, baselineEnd: d.end, progress: 0, state: { category: 'STARTED' }, ...extra }; };
const ITEMS = [
  ...Array.from({ length: 12 }, (_, k) => it(k + 1, String(k + 1), k, k + 1, { milestone: [5, 9, 12].includes(k + 1), critical: k + 1 !== 9 })),
  it(21, 'II.1', 2, 6), it(22, 'II.2', 6, 9), it(23, 'II.3', 9, 12, { milestone: true, critical: true }),
  it(31, '8.1', 7, 8, { parentId: 8 }), it(32, '8.2', 8, 9, { parentId: 8 }),
];

test('đọc thiết lập sprint: "Tên | bước | mục tiêu" và "Tên (B1–9)", báo lỗi thiếu bước', () => {
  const { sprints, errors } = S.parseSprintText('Chuyển nhượng DA (B1–9)\nĐề xuất → CTĐT | 10-12 | Có QĐ chấp thuận\n# ghi chú\n\nPhân kỳ 2 | II.1-3\nThiếu bước');
  assert.deepEqual(sprints.slice(0, 3).map(s => [s.name, s.steps, s.goal]), [['Chuyển nhượng DA', 'B1–9', ''], ['Đề xuất → CTĐT', '10-12', 'Có QĐ chấp thuận'], ['Phân kỳ 2', 'II.1-3', '']]);
  assert.equal(errors.length, 1); assert.match(errors[0], /Thiếu bước/);
  assert.deepEqual(S.parseSteps('B1–9, 11, II.1-8'), [{ from: '1', to: '9' }, { from: '11', to: '11' }, { from: 'II.1', to: 'II.8' }]);
  assert.ok(S.compareSteps('10', '9') > 0); assert.ok(S.compareSteps('II.1', '12') > 0); assert.ok(S.compareSteps('II.10', 'II.2') > 0);
  assert.equal(S.sprintText([{ name: 'A', steps: '1-9', goal: '' }, { name: 'B', steps: '10-12', goal: 'G' }]), 'A | 1-9\nB | 10-12 | G');
});

test('gán bước vào sprint: khoảng theo thứ tự bước, việc con theo bước tổng, lỗi bước không có / trùng, bước chưa xếp', () => {
  const plan = [{ name: 'Chuyển nhượng', steps: 'B1–9' }, { name: 'CTĐT', steps: '10-11' }, { name: 'Phân kỳ 2', steps: 'II.1-II.3' }];
  const r = S.assignSprints(ITEMS, plan);
  assert.deepEqual(r.errors, []);
  assert.equal(r.indexOf.get(9), 0); assert.equal(r.indexOf.get(10), 1); assert.equal(r.indexOf.get(23), 2);
  assert.equal(r.indexOf.get(32), 0); // 8.2 là việc con của bước 8 → sprint 1
  assert.deepEqual(r.unassigned, ['12']);
  assert.equal(S.stepsLabel(r.codesOf[0]), 'B1–9'); assert.equal(S.stepsLabel(r.codesOf[2]), 'II.1–II.3');
  assert.equal(S.specLabel('1-9'), 'B1–9'); assert.equal(S.specLabel('II.1 - II.8'), 'II.1–II.8'); assert.equal(S.specLabel('B10, 12'), 'B10, 12');
  const bad = S.assignSprints(ITEMS, [{ name: 'A', steps: '1-5' }, { name: 'B', steps: '5-7, 99' }]);
  assert.ok(bad.errors.some(e => /không có bước 99/.test(e)));
  assert.ok(bad.errors.some(e => /Bước 5 nằm trong cả sprint "A" và "B"/.test(e)));
});

test('tiến độ sprint theo đầu việc, tình trạng, mốc; sprint đang làm; gợi ý sprint theo mốc đường găng', () => {
  const day = M.vnMidnight(2026, 5, 15); // giữa T5
  const done = { state: { category: 'COMPLETED' }, completedAt: M.vnMidnight(2026, 1, 1) };
  const items = ITEMS.map(i => (['1', '2', '3'].includes(i.planCode) ? { ...i, ...done } : i)).map(i => ({ ...i, status: M.statusOf(i, M.isDone(i) ? 100 : i.progress, day).code }));
  const actualOf = i => (M.isDone(i) ? 100 : i.progress);
  const r = S.assignSprints(items, [{ name: 'Đầu', steps: '1-3' }, { name: 'Giữa', steps: '4-9' }, { name: 'Cuối', steps: '10-12' }]);
  const of = k => items.filter(i => r.indexOf.get(i.id) === k);
  const a = S.summarize(of(0), actualOf, day, M.DEFAULT_ALERTS, t0);
  assert.equal(a.status, 'DONE_ON_TIME'); assert.equal(a.actualPct, 100); assert.equal(a.stepsDone, 3);
  const b = S.summarize(of(1), actualOf, day, M.DEFAULT_ALERTS, t0);
  assert.equal(b.status, 'BEHIND'); assert.equal(b.startT, 3); assert.equal(b.endT, 9); assert.equal(b.steps, 6);
  assert.equal(b.milestones.map(m => m.planCode).join(','), '5,9');
  const c = S.summarize(of(2), actualOf, day, M.DEFAULT_ALERTS, t0);
  assert.equal(c.status, 'NOT_DUE');
  assert.equal(S.currentSprintIndex([a, b, c]), 1);
  const sug = S.suggestSprints(ITEMS);
  assert.deepEqual(sug.map(s => s.steps), ['1-5', '6-12', 'II.1-II.3']);
  assert.match(sug[0].name, /^Đến mốc/);
});
