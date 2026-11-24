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

// Nộp / gửi lại như routes/weekly.js POST /api/weekly/submit (services/weekly-submit.js): visible = việc NGƯỜI GỬI xem được,
// saved = bản đã lưu (gửi lại), phạm vi bộ phận = mọi việc của bộ phận (DEPT_SCOPE).
function submitAs(visible, raw, saved = null, prev = null) {
  const deptItems = all(), seen = deptItems.filter(i => visible.has(i.id));
  const prefill = WK.buildPrefill({ week: F, deptId: 1, items: seen, memberIds: members, prev });
  const { data, errors } = WS.prepareSubmit({ raw: raw(prefill), ctx: { ...ctxOf(seen), items: seen }, prefill, now: FRI, week: F, saved, scopeItems: deptItems, editAll: visible === SEEN_BY_SECRETARY });
  if (errors.length) return { prefill, errors, data };
  const full = WK.buildPrefill({ week: F, deptId: 1, items: deptItems, memberIds: members, prev });
  const { final, added } = WS.finishSubmit(data, F, { full, visibleIds: new Set(seen.map(i => i.id)), parentOf: new Map(deptItems.map(i => [i.id, i.parentId])) });
  return { prefill, errors, added, fin: final };
}
const submitAsStaff = (prev = null) => submitAs(VISIBLE_TO_STAFF, p => fill(structuredClone(p)), null, prev);
const SEEN_BY_HEAD = new Set([101, 900, 901]), SEEN_BY_SECRETARY = new Set(); // thư ký: bộ phận khác, không xem được việc nào của Ban A
const staffView = data => WK.viewFor(data, id => VISIBLE_TO_STAFF.has(id)); // như routes/weekly.js hideUnseen với nhân viên
const kpis = data => { const k = sumOf(data).kpis; return { done: k.done, ongoing: k.ongoing, risk: k.risk }; };
const sumOf = data => WK.buildSummary({ week: F, depts: [{ id: 1, name: 'Ban A (giả)' }, { id: 2, name: 'Ban B (giả)' }],
  reports: [{ departmentId: 1, firstSubmittedAt: FRI_PM, submittedAt: FRI_PM, submitCount: 1, submittedById: 50, data }], notices: [], now: MON });
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

test('S10: số liệu tổng hợp giống nhau với MỌI người xem; tên dòng tự bổ sung chỉ trong Hub cho người được xem, bản email không nêu tên', () => {
  const { fin } = submitAsStaff();
  const gd = subj('director', null), head1 = subj('manager', 1), headB = subj('manager', 2);
  assert.equal(gd.full, true); assert.equal(head1.full, false); assert.equal(headB.full, false);
  const sum = sumOf(fin); // routes/weekly.js: summaryOf luôn đếm đủ
  const forGd = WK.summaryView(sum, { full: true, departmentId: null });
  assert.ok(forGd.fullText.includes('Đàm phán giá đất lô C (giả) (hệ thống tự bổ sung)'));
  assert.ok(forGd.fullText.includes('Nộp hồ sơ đấu giá lô D (giả) (hệ thống tự bổ sung)'));
  // Trưởng phòng Ban A vốn xem được việc → thấy trên trang Tổng hợp; trưởng phòng Ban B thì không.
  const forHead1 = WK.summaryView(sum, { full: false, departmentId: 1, canSee: id => SEEN_BY_HEAD.has(id) });
  const forHeadB = WK.summaryView(sum, { full: false, departmentId: 2, canSee: () => false });
  assert.ok(JSON.stringify(forHead1.view.rows.find(r => r.id === 1).report).includes('lô C'));
  assert.ok(forHead1.view.risks.some(x => x.task.includes('lô D') && x.auto));
  assert.equal(JSON.stringify(forHeadB.view).includes('lô C'), false); assert.equal(JSON.stringify(forHeadB.view).includes('lô D'), false);
  for (const v of [forGd, forHead1, forHeadB]) {
    // Bản gửi email: số liệu như nhau bất kể ai sao chép; dòng tự bổ sung chỉ được đếm, không nêu tên.
    assert.deepEqual({ ongoing: v.view.kpis.ongoing, risk: v.view.kpis.risk }, { ongoing: 2, risk: 1 });
    assert.ok(v.text.includes('2 đang thực hiện · 1 nguy cơ chậm'));
    assert.ok(v.text.includes('- Ban A (giả): Đúng hạn') && v.text.includes('xong 0, đang làm 2, nguy cơ chậm 1'));
    for (const t of ['Đàm phán giá đất', 'Nộp hồ sơ đấu giá', 'Việc 101']) assert.equal(v.text.includes(t), false, t);
  }
  assert.ok(forGd.text.includes('(1 việc hệ thống tự bổ sung / dự án kín / không nêu tên — xem trong Kepler Hub)'));
});

test('S10: xem báo cáo bộ phận — ẩn / hiện theo NGƯỜI XEM: nhân viên không thấy; trưởng phòng (vốn xem được việc) thấy', () => {
  const { fin } = submitAsStaff();
  const sv = staffView(fin);
  assert.equal(JSON.stringify(sv).includes('lô C'), false); assert.equal(JSON.stringify(sv).includes('lô D'), false);
  assert.equal(where(sv, 101), 'ongoing');
  const hv = WK.viewFor(fin, id => SEEN_BY_HEAD.has(id));
  assert.equal(where(hv, 900), 'ongoing'); assert.equal(where(hv, 901), 'risks');
});

test('S10 hồi quy: trưởng phòng (xem được việc) bấm "Gửi lại" — dòng tự bổ sung giữ nguyên, không trùng, nhân viên không thấy, email không nêu tên', () => {
  const s1 = submitAsStaff();
  const before = kpis(s1.fin);
  // Trưởng phòng mở báo cáo (thấy cả dòng tự bổ sung vì xem được việc), chỉ sửa "Kiến nghị khác", bấm Gửi lại.
  const form = () => { const x = WK.viewFor(structuredClone(s1.fin), id => SEEN_BY_HEAD.has(id)); x.other = 'Bổ sung kiến nghị (giả)'; return x; };
  const r = submitAs(SEEN_BY_HEAD, form, s1.fin);
  assert.deepEqual(r.errors, []);
  assert.equal(WK.allRows(r.fin).length, 3);
  assert.equal(new Set(WK.allRows(r.fin).map(x => x.itemId)).size, 3);
  assert.equal(rowOf(r.fin, 900).auto, true); assert.equal(rowOf(r.fin, 901).auto, true);
  assert.deepEqual(kpis(r.fin), before);
  assert.equal(JSON.stringify(staffView(r.fin)).includes('lô C'), false); assert.equal(JSON.stringify(staffView(r.fin)).includes('lô D'), false);
  assert.equal(WK.summaryView(sumOf(r.fin), { full: true }).text.includes('lô D'), false);
  // Vòng 5 (nới quy tắc): trưởng phòng xem được việc → nhập giải trình vào chính dòng tự bổ sung; dòng vẫn là dòng tự bổ sung (không gỡ nhãn được).
  const edited = () => { const x = form(); Object.assign(rowOf(x, 901), { cause: 'Chờ hồ sơ (giả)', auto: false }); return x; };
  const r2 = submitAs(SEEN_BY_HEAD, edited, s1.fin);
  assert.deepEqual(r2.errors, []); assert.equal(rowOf(r2.fin, 901).auto, true); assert.equal(rowOf(r2.fin, 901).cause, 'Chờ hồ sơ (giả)');
});

test('S10 hồi quy: thư ký (không xem được việc) "Gửi lại" — bỏ dòng hoặc điền rồi gửi: không trùng dòng, KPI không đổi, không lộ tên', () => {
  const s1 = submitAsStaff();
  const before = kpis(s1.fin);
  const check = r => {
    assert.deepEqual(r.errors, []);
    const rows = WK.allRows(r.fin);
    assert.equal(rows.length, 3, JSON.stringify(rows.map(x => x.task)));
    assert.equal(rows.filter(x => !x.itemId).length, 0); // không dòng tự do nào mang tên việc
    assert.deepEqual(kpis(r.fin), before);
    assert.equal(rowOf(r.fin, 900).auto, true); assert.equal(rowOf(r.fin, 901).auto, true); assert.equal(rowOf(r.fin, 101).auto, undefined);
    const sv = JSON.stringify(staffView(r.fin));
    assert.equal(sv.includes('lô C'), false); assert.equal(sv.includes('lô D'), false);
    assert.equal(WK.summaryView(sumOf(r.fin), { full: true }).text.includes('lô D'), false);
  };
  // Thư ký xem tổng hợp đầy đủ → biểu mẫu có mọi dòng. Chỉ sửa "Kiến nghị khác".
  const base = () => { const x = structuredClone(s1.fin); x.other = 'Thư ký chỉnh (giả)'; return x; };
  check(submitAs(SEEN_BY_SECRETARY, base, s1.fin));
  // Cách 1: bỏ các dòng không sửa được.
  check(submitAs(SEEN_BY_SECRETARY, () => { const x = base(); for (const k of ['results', 'ongoing', 'risks']) x[k] = x[k].filter(r => !/lô C|lô D|Việc 101/.test(r.task)); return x; }, s1.fin));
  // Cách 2: điền thay rồi gửi — vòng 5 (a): thư ký (quyền sửa + xem tổng hợp đầy đủ) sửa được trường do người nhập; trường máy tính vẫn tính lại.
  const r3 = submitAs(SEEN_BY_SECRETARY, () => { const x = base(); for (const r of WK.allRows(x)) Object.assign(r, { next: 'Theo dõi (giả)', cause: 'Theo báo cáo (giả)', solution: 'Đôn đốc (giả)', helpFrom: 'SELF' }); return x; }, s1.fin);
  check(r3);
  assert.equal(rowOf(r3.fin, 101).next, 'Theo dõi (giả)'); assert.equal(rowOf(r3.fin, 101).task, rowOf(s1.fin, 101).task);
  assert.equal(rowOf(r3.fin, 901).solution, 'Đôn đốc (giả)'); assert.equal(rowOf(r3.fin, 901).auto, true); // giải trình vào chính dòng tự bổ sung
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
