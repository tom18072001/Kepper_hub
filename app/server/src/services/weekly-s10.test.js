// Mục S10 (quyết định chủ dự án 24/11/2026: "Tự đưa vào"): tập việc phải báo cáo của bộ phận tính theo PHẠM VI BỘ PHẬN, không theo quyền
// xem của người lập. Việc người lập không xem được → máy chủ tự bổ sung lúc nộp, nhãn "Hệ thống tự bổ sung"; chỉ người xem tổng hợp đầy đủ
// và người vốn xem được việc đó thấy. Dữ liệu GIẢ, ngày CỐ ĐỊNH (tuần 26–30/10/2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const WK = require('./weekly');
const WS = require('./weekly-submit');
const A = require('./alerts');
const M = require('./mtl');
const P = require('../lib/policy');
const { permissionScope, ROLE_PROFILES } = require('../lib/permissions');
const { reportData } = require('../routes/reports');

const F = '2026-10-30';
const d = s => new Date(`${s}T00:00:00+07:00`), end = s => new Date(`${s}T23:59:59+07:00`);
const FRI = new Date('2026-10-30T10:00:00+07:00'), FRI_PM = new Date('2026-10-30T16:00:00+07:00'), MON = new Date('2026-11-02T07:00:00+07:00');
// Bộ phận 1: nhân viên 50 (người lập), trưởng phòng 60. TGĐ (id 1) giao trưởng phòng việc 900 qua sổ giao việc (dự án ASSIGNED) —
// nhân viên 50 không xem được việc đó. Việc 101 là việc nhân viên tự làm (xem được).
const task = (id, due, cat, progress, extra = {}) => ({ id, kind: 'TASK', code: `SO-${id}`, projectKey: 'SO', title: `Việc ${id} (giả)`, parentId: null, startDate: null, dueDate: due ? end(due) : null,
  state: { category: cat }, progress, startedAt: null, progressAt: null, returnedAt: null, completedAt: null, assignees: [{ id: 50 }], leadDepartmentId: 1, children: 0, ...extra });
const prep = (items, day) => items.map(i => {
  const done = M.isDone(i), cancelled = M.isCancelled(i);
  return { ...i, done, cancelled, actual: i.progress, started: A.isStarted(i), risk: done ? null : A.riskOf(i, { day }) };
});
const S10 = { title: 'Đàm phán giá đất lô C (giả)', assignees: [{ id: 60 }], assignedById: 1 };
const all = () => prep([
  task(101, '2026-12-15', 'STARTED', 20),
  task(900, '2026-12-20', 'STARTED', 30, S10), // đang làm
  task(901, '2026-10-27', 'UNSTARTED', 0, { ...S10, title: 'Nộp hồ sơ đấu giá lô D (giả)' }), // trễ hạn, chưa khởi động
], FRI);
const VISIBLE_TO_STAFF = new Set([101]);
const members = new Set([50, 60]);
const ctxOf = items => ({ userIds: new Set([50, 60]), deptIds: new Set([1, 2]), itemIds: new Set(items.map(i => i.id)), taskIds: new Set(items.map(i => i.id)) });
const fill = data => { for (const r of [...data.results, ...data.ongoing, ...data.risks]) Object.assign(r, { ownerIds: r.ownerIds.length ? r.ownerIds : [50], next: r.next || 'Tiếp tục (giả)', cause: r.cause || 'x', solution: r.solution || 'y', helpFrom: r.helpFrom || 'SELF' }); return data; };

// Nộp như routes/weekly.js POST /api/weekly/submit: người lập chỉ có việc mình xem được; máy chủ bổ sung theo phạm vi bộ phận.
function submitAsStaff(prev = null) {
  const deptItems = all(), seen = deptItems.filter(i => VISIBLE_TO_STAFF.has(i.id));
  const prefill = WK.buildPrefill({ week: F, deptId: 1, items: seen, memberIds: members, prev });
  // Đúng chuỗi của route (services/weekly-submit.js).
  const { data, errors } = WS.prepareSubmit({ raw: fill(structuredClone(prefill)), ctx: { ...ctxOf(seen), items: seen }, prefill, now: FRI, week: F });
  const full = WK.buildPrefill({ week: F, deptId: 1, items: deptItems, memberIds: members, prev });
  const { final, added } = WS.finishSubmit(data, F, { full, visibleIds: new Set(seen.map(i => i.id)), parentOf: new Map(deptItems.map(i => [i.id, i.parentId])) });
  return { prefill, errors, added, fin: final };
}
const sumOf = (data, { auto = true } = {}) => WK.buildSummary({ week: F, depts: [{ id: 1, name: 'Ban A (giả)' }, { id: 2, name: 'Ban B (giả)' }],
  reports: [{ departmentId: 1, firstSubmittedAt: FRI_PM, submittedAt: FRI_PM, submitCount: 1, submittedById: 50, data: auto ? data : WK.withoutAuto(data) }], notices: [], now: MON });
const subj = (role, departmentId) => {
  const user = { id: 1, role, departmentId, permissions: ROLE_PROFILES[role] };
  const s = { it: false, director: role === 'director', secretary: false, pmo: false, leader: !!permissionScope(user, 'reports.summary', 'VIEW'), mustReport: role !== 'director', departmentId, userId: 1 };
  return { ...s, full: P.can(s, 'view', 'weekly.summary.detail') };
};
const where = (data, id) => ['results', 'ongoing', 'risks', 'plans'].filter(k => (data[k] || []).some(r => r.itemId === id)).join(',') || '-';
const rowOf = (data, id) => [...data.results, ...data.ongoing, ...data.risks].find(r => r.itemId === id);

test('S10: việc TGĐ giao trưởng phòng qua sổ, nhân viên lập báo cáo → biểu mẫu không có; bản nộp có, nhãn tự bổ sung, không bắt ghi giải pháp', () => {
  const { prefill, errors, added, fin } = submitAsStaff();
  // Biểu mẫu người lập: chỉ việc họ xem được.
  assert.equal(where(prefill, 900), '-'); assert.equal(where(prefill, 901), '-'); assert.equal(where(prefill, 101), 'ongoing');
  // Không có lỗi "thiếu giải pháp" cho việc người lập không thấy.
  assert.deepEqual(errors, []);
  assert.equal(added, 2);
  assert.equal(where(fin, 900), 'ongoing'); assert.equal(where(fin, 901), 'risks');
  const a = rowOf(fin, 900), b = rowOf(fin, 901);
  assert.equal(a.auto, true); assert.equal(b.auto, true);
  assert.equal(a.pct, 30); assert.equal(a.due, '2026-12-20'); assert.deepEqual(a.ownerIds, [60]);
  assert.equal(b.risk, 'OVERDUE'); assert.equal(b.status, 'Chậm'); assert.equal(b.solution, ''); assert.equal(b.overdue, true);
  assert.equal(rowOf(fin, 101).auto, undefined);
  // Không ghi ngược % cho dòng tự bổ sung.
  assert.deepEqual(WK.writeBacks(fin).filter(w => w.itemId >= 900), []);
});

test('S10: tổng hợp đầy đủ (Ban GĐ) có việc tự bổ sung và đếm vào KPI; bản tóm tắt / văn bản tóm tắt không có, không đếm', () => {
  const { fin } = submitAsStaff();
  const gd = subj('director', null), head1 = subj('manager', 1), headB = subj('manager', 2);
  assert.equal(gd.full, true); assert.equal(head1.full, false); assert.equal(headB.full, false);
  // Như routes/weekly.js: người xem đầy đủ → summaryOf({auto:true}); còn lại → summaryOf({auto:false}).
  const forGd = WK.summaryView(sumOf(fin, { auto: gd.full }), { full: gd.full, departmentId: null });
  assert.equal(forGd.view.kpis.ongoing, 2); assert.equal(forGd.view.kpis.risk, 1);
  // Bản đầy đủ (chỉ trong Hub / nội bộ Ban GĐ): có tên kèm nhãn.
  assert.ok(forGd.fullText.includes('Đàm phán giá đất lô C (giả) (hệ thống tự bổ sung)'));
  assert.ok(forGd.fullText.includes('Nộp hồ sơ đấu giá lô D (giả) (hệ thống tự bổ sung)'));
  // Bản gửi email (thư ký / Ban GĐ sao chép, gửi mọi trưởng bộ phận): KHÔNG nêu tên dòng tự bổ sung, nhưng số liệu vẫn đếm đủ.
  for (const t of ['Đàm phán giá đất', 'Nộp hồ sơ đấu giá', 'tự bổ sung', 'Việc 101']) assert.equal(forGd.text.includes(t), false, t);
  assert.ok(forGd.text.includes('2 đang thực hiện · 1 nguy cơ chậm'));
  assert.ok(forGd.text.includes('xong 0, đang làm 2, nguy cơ chậm 1'));
  assert.equal(forGd.view.risks.find(x => x.task.startsWith('Nộp hồ sơ')).auto, true);
  for (const s of [head1, headB]) {
    const v = WK.summaryView(sumOf(fin, { auto: s.full }), { full: s.full, departmentId: s.departmentId });
    for (const t of ['Đàm phán giá đất', 'Nộp hồ sơ đấu giá', 'tự bổ sung']) assert.equal(v.text.includes(t), false, `${s.departmentId}: ${t}`);
    assert.equal(v.view.kpis.ongoing, 1); assert.equal(v.view.kpis.risk, 0);
    assert.equal(JSON.stringify(v.view).includes('Đàm phán giá đất'), false);
  }
});

test('S10: xem báo cáo bộ phận — người lập không thấy dòng tự bổ sung; người vốn xem được việc đó (trưởng phòng) thì thấy', () => {
  const { fin } = submitAsStaff();
  // Như routes/weekly.js hideAuto: giữ dòng tự bổ sung khi người xem xem được việc (truy vấn quyền xem việc).
  const staffView = WK.withoutAuto(fin, r => VISIBLE_TO_STAFF.has(r.itemId));
  assert.equal(JSON.stringify(staffView).includes('lô C'), false); assert.equal(JSON.stringify(staffView).includes('lô D'), false);
  assert.equal(where(staffView, 101), 'ongoing');
  const headView = WK.withoutAuto(fin, r => [900, 901].includes(r.itemId));
  assert.equal(where(headView, 900), 'ongoing'); assert.equal(where(headView, 901), 'risks');
});

test('S10: tuần sau người lập dựng biểu mẫu từ bản đã nộp (có dòng tự bổ sung) — không lộ việc họ không xem được', () => {
  const { fin } = submitAsStaff();
  const nextWeek = WK.addDays(F, 7);
  const seen = all().filter(i => VISIBLE_TO_STAFF.has(i.id));
  const p = WK.buildPrefill({ week: nextWeek, deptId: 1, items: seen, memberIds: members, prev: fin });
  const txt = JSON.stringify(p);
  assert.equal(txt.includes('lô C'), false); assert.equal(txt.includes('lô D'), false);
});

test('S10: dữ liệu gửi lên không tự gắn được nhãn tự bổ sung; dòng con không bổ sung khi việc cha đã có trong báo cáo', () => {
  const clean = WK.sanitize({ results: [], ongoing: [{ key: 'k', itemId: 101, task: 'x', auto: true, status: 'Đúng tiến độ' }], risks: [], plans: [] }, ctxOf([{ id: 101 }]));
  assert.equal(clean.ongoing[0].auto, undefined);
  // Việc cha 101 (người lập xem được) có việc con 902 người lập không xem được → không bổ sung con (không đếm hai lần).
  const items = prep([task(101, '2026-12-15', 'STARTED', 20), task(902, '2026-12-10', 'STARTED', 10, { parentId: 101, assignees: [{ id: 60 }] })], FRI);
  const data = { results: [], ongoing: [{ key: 'm101', itemId: 101, task: 'Việc 101 (giả)', ownerIds: [50], status: 'Đúng tiến độ', pct: 20 }], risks: [], plans: [], other: '' };
  const full = WK.buildPrefill({ week: F, deptId: 1, items, memberIds: members });
  assert.equal(where(full, 902), 'ongoing');
  const out = WK.addAutoRows(data, full, new Set([101]), new Map(items.map(i => [i.id, i.parentId])));
  assert.equal(out.added, 0); assert.equal(where(out.data, 902), '-');
});

test('S10: bản Word của Ban GĐ đếm việc theo quyền xem của Ban GĐ (toàn hệ thống) — có việc người lập không xem được', () => {
  assert.equal(permissionScope({ id: 1, role: 'director', permissions: ROLE_PROFILES.director }, 'work.view', 'VIEW'), 'SYSTEM');
  const mk = (id, due, cat, progress, extra = {}) => ({ id, number: id, title: `Việc ${id} (giả)`, project: { key: 'SO', departmentId: 1 }, state: { category: cat }, assignees: [], dueDate: end(due),
    taskType: 'ADHOC', leadDepartmentId: 1, progress, approvals: [], progressReports: [], ...extra });
  const items = [mk(101, '2026-12-15', 'STARTED', 20), mk(900, '2026-12-20', 'STARTED', 30), mk(901, '2026-10-27', 'UNSTARTED', 0)];
  const rd = reportData(items, { from: d('2026-10-26'), end: d('2026-11-02'), now: FRI, departments: [{ id: 1, name: 'Ban A (giả)' }] });
  assert.deepEqual(rd.sections.ongoing.map(i => i.id).sort(), [101, 900]);
  assert.deepEqual(rd.sections.risk.map(i => i.id), [901]);
});
