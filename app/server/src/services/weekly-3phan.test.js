// Báo cáo tuần 3 phần — các ca nghiệm thu PR #40 vòng 1 (dữ liệu GIẢ, ngày CỐ ĐỊNH: tuần 26–30/10/2026, không phụ thuộc hôm nay).
const test = require('node:test');
const assert = require('node:assert/strict');
const WK = require('./weekly');
const WS = require('./weekly-submit');
const M = require('./mtl');
const A = require('./alerts');
const P = require('../lib/policy');
const { permissionScope, ROLE_PROFILES } = require('../lib/permissions');
const { reportData } = require('../routes/reports');

const F = '2026-10-30';
const d = s => new Date(`${s}T00:00:00+07:00`), end = s => new Date(`${s}T23:59:59+07:00`);
const THU = new Date('2026-10-29T10:00:00+07:00'), FRI = new Date('2026-10-30T10:00:00+07:00'), FRI_PM = new Date('2026-10-30T16:00:00+07:00');
const mtl = (id, s, e, cat = 'STARTED', progress = 40, extra = {}) => ({ id, kind: 'MTL', code: `DA-${id}`, projectKey: 'DA', planCode: String(id), title: `Hạng mục ${id} (giả)`, parentId: null,
  baselineStart: s ? d(s) : null, baselineEnd: e ? end(e) : null, state: { category: cat }, progress, startedAt: null, progressAt: null, completedAt: null, assignees: [{ id: 50 }], leadDepartmentId: 1, children: 0, ...extra });
const task = (id, due, cat = 'UNSTARTED', progress = 0, extra = {}) => ({ id, kind: 'TASK', code: `CV-${id}`, projectKey: 'CV', title: `Việc ${id} (giả)`, parentId: null, startDate: null, dueDate: due ? end(due) : null,
  state: { category: cat }, progress, startedAt: null, progressAt: null, returnedAt: null, completedAt: null, assignees: [{ id: 50 }], leadDepartmentId: 1, children: 0, ...extra });
// Như routes/weekly.js (mtlItemsFor / taskItemsFor): trạng thái MTL, "đã bắt đầu", "nguy cơ chậm" từ services/alerts.js.
function prep(items, day) {
  const cfg = M.DEFAULT_ALERTS;
  return items.map(i => {
    const done = M.isDone(i), cancelled = M.isCancelled(i), actual = i.progress;
    if (i.kind === 'TASK') return { ...i, done, cancelled, actual, started: A.isStarted(i), risk: done ? null : A.riskOf(i, { day }) };
    const st = M.statusOf(i, actual, day, cfg);
    return { ...i, done, cancelled, actual, cfg, status: st.code, started: A.isStarted(i, actual), risk: A.riskOf(i, { st, cfg, day }) };
  });
}
const ctxOf = items => ({ userIds: new Set([50, 51]), deptIds: new Set([1, 2]), itemIds: new Set(items.map(i => i.id)), taskIds: new Set(items.filter(i => i.kind === 'TASK').map(i => i.id)) });
const fillAll = data => {
  for (const r of [...data.results, ...data.ongoing, ...data.risks]) Object.assign(r, { ownerIds: r.ownerIds.length ? r.ownerIds : [50], cause: r.cause || 'Nguyên nhân (giả)', solution: r.solution || 'Giải pháp (giả)', helpFrom: r.helpFrom || 'SELF', next: r.next || 'Tiếp tục (giả)' });
  for (const p of data.plans) Object.assign(p, { ownerIds: p.ownerIds.length ? p.ownerIds : [50], output: p.output || 'Đầu ra (giả)' });
  return data;
};
const where = (p, id) => ['results', 'ongoing', 'risks', 'plans'].filter(k => (p[k] || []).some(r => r.itemId === id)).join(',') || '-';
const sumOf = data => WK.buildSummary({ week: F, depts: [{ id: 1, name: 'Ban A (giả)' }, { id: 2, name: 'Ban B (giả)' }],
  reports: [{ departmentId: 1, firstSubmittedAt: FRI_PM, submittedAt: FRI_PM, submitCount: 1, submittedById: 50, data }], notices: [], now: new Date('2026-11-02T07:00:00+07:00') });
const part = (text, a, b) => text.slice(text.indexOf(a), b ? text.indexOf(b) : undefined);
const II = text => part(text, 'II. ĐANG', 'III. NGUY CƠ'), III = text => part(text, 'III. NGUY CƠ', 'YÊU CẦU HỖ TRỢ');
// Nộp: ĐÚNG chuỗi của routes/weekly.js (services/weekly-submit.js prepareSubmit → finishSubmit). fill: phần người lập điền trên biểu mẫu.
function submit(draft, items, now, prefill, fill = fillAll, actions = []) {
  const { data, errors } = WS.prepareSubmit({ raw: fill(structuredClone(draft)), ctx: { ...ctxOf(items), items }, prefill, actions, now, week: F });
  return { errors, data, fin: WS.finishSubmit(data, F).final };
}

test('1. Dòng chưa xong ở Phần I (kế hoạch tuần trước, việc phát sinh 30%) có ở "đang thực hiện" của KPI và văn bản giao ban', () => {
  const items = prep([task(101, '2026-12-15', 'STARTED', 20)], FRI);
  const prev = { plans: [{ key: 'pp1', itemId: null, task: 'Họp với Sở X (giả)', basis: 'KH tháng', ownerIds: [50], due: '2026-11-13', output: 'Biên bản' }], results: [], ongoing: [], risks: [] };
  const p = WK.buildPrefill({ week: F, deptId: 1, items, memberIds: new Set([50]), prev });
  p.results.push({ key: 'fx1', itemId: null, task: 'Làm việc với phường (giả)', source: 'Phát sinh', ownerIds: [50], due: '2026-11-04', status: 'Đúng tiến độ', pct: 30 });
  const data = WK.finalize(fillAll(WK.sanitize(p, ctxOf(items))), F);
  const sum = sumOf(data), text = WK.summaryText(sum);
  assert.equal(sum.kpis.ongoing, 3); assert.equal(sum.rows[0].ongoing, 3);
  for (const t of ['Làm việc với phường (giả)', 'Họp với Sở X (giả)', 'Việc 101 (giả)']) assert.ok(II(text).includes(t), t);
});

test('2. Dòng Phần III đã bắt đầu / hết nguy cơ lúc nộp: máy chủ xếp lại sang Phần II, có trong KPI, văn bản, chi tiết', () => {
  // S2a: việc thường chưa khởi động (sắp hạn) → thứ Sáu bấm bắt đầu 20% và được gia hạn; người lập nộp bản nháp cũ.
  const t = task(201, '2026-10-31'), other = task(202, '2026-12-01', 'STARTED', 50);
  const draft = WK.buildPrefill({ week: F, deptId: 1, items: prep([t, other], THU), memberIds: new Set([50]) });
  assert.equal(where(draft, 201), 'risks');
  const fri = prep([{ ...t, state: { category: 'STARTED' }, progress: 20, startedAt: FRI, dueDate: end('2026-11-30') }, other], FRI_PM);
  const a = submit(draft, fri, FRI_PM, WK.buildPrefill({ week: F, deptId: 1, items: fri, memberIds: new Set([50]) }));
  assert.deepEqual(a.errors, []);
  assert.equal(where(a.fin, 201), 'ongoing');
  const r201 = a.fin.ongoing.find(r => r.itemId === 201);
  assert.equal(r201.started, true); assert.equal(r201.risk, null); assert.equal(r201.pct, 20);
  const sa = sumOf(a.fin);
  assert.ok(II(WK.summaryText(sa)).includes('Việc 201 (giả)')); assert.equal(sa.kpis.ongoing, 2);
  assert.ok(WK.partsOf(a.fin, F).ongoing.some(r => r.itemId === 201)); // chi tiết bộ phận (giao diện) dùng cùng quy tắc

  // S2b: MTL "Chậm khởi động" ở Phần III → người lập ghi 30% → hết nguy cơ, đang làm.
  const items = prep([mtl(211, '2026-09-28', '2026-12-31', 'UNSTARTED', 0), mtl(212, '2026-10-01', '2026-12-31', 'STARTED', 35)], FRI);
  const p = WK.buildPrefill({ week: F, deptId: 1, items, memberIds: new Set([50]) });
  assert.equal(where(p, 211), 'risks'); assert.equal(p.risks[0].risk, 'LATE_START'); assert.equal(p.risks[0].started, false);
  const d30 = structuredClone(p); d30.risks.find(r => r.itemId === 211).pct = 30;
  const b = submit(d30, items, FRI_PM, p);
  assert.deepEqual(b.errors, []);
  assert.equal(where(b.fin, 211), 'ongoing');
  assert.equal(b.fin.ongoing.find(r => r.itemId === 211).status, 'Đúng tiến độ');
  assert.deepEqual(WK.writeBacks(b.fin), [{ itemId: 211, pct: 30 }]);
  assert.ok(II(WK.summaryText(sumOf(b.fin))).includes('Hạng mục 211 (giả)'));

  // S15: ghi 15% → vẫn chậm tiến độ: có ở II (đang làm) VÀ III (nguy cơ), started = true.
  const d15 = structuredClone(p); d15.risks.find(r => r.itemId === 211).pct = 15;
  const c = submit(d15, items, FRI_PM, p), sc = sumOf(c.fin), tc = WK.summaryText(sc);
  assert.equal(where(c.fin, 211), 'ongoing');
  assert.ok(II(tc).includes('Hạng mục 211 (giả)')); assert.ok(III(tc).includes('Hạng mục 211 (giả) — Chậm tiến độ'));
  assert.deepEqual(sc.risks.filter(x => x.task.includes('211')).map(x => x.started), [true]);
  assert.equal(sc.kpis.ongoing, 2);

  // S9: Phần III ghi 100% → xếp về Phần I, liệt kê ở mục I.
  const d100 = structuredClone(p); d100.risks.find(r => r.itemId === 211).pct = 100;
  const e = submit(d100, items, FRI_PM, p);
  assert.equal(where(e.fin, 211), 'results');
  assert.ok(part(WK.summaryText(sumOf(e.fin)), 'I. ĐÃ HOÀN THÀNH', 'II. ĐANG').includes('Hạng mục 211 (giả)'));
});

test('3. Dòng còn ở Phần IV mà nay phải báo cáo (sắp hạn, làm sớm): máy chủ chuyển đúng phần, không chặn "Không được bỏ"', () => {
  const T = task(701, '2026-11-02'), E = mtl(711, '2026-11-02', '2026-11-30', 'UNSTARTED', 0), other = task(702, '2026-12-01', 'STARTED', 50);
  const thu = WK.buildPrefill({ week: F, deptId: 1, items: prep([T, E, other], THU), memberIds: new Set([50]) });
  assert.equal(where(thu, 701), 'plans'); assert.equal(where(thu, 711), 'plans');
  const friItems = prep([T, { ...E, state: { category: 'STARTED' }, startedAt: FRI, progress: 10 }, other], FRI);
  const fri = WK.buildPrefill({ week: F, deptId: 1, items: friItems, memberIds: new Set([50]) });
  assert.equal(where(fri, 701), 'risks'); assert.equal(where(fri, 711), 'ongoing');
  // Nộp bản nháp thứ Năm: không chặn "Không được bỏ"; hạng mục làm sớm vừa sang Phần II → hỏi đúng MỘT việc: "việc sẽ làm tuần tới".
  const r = submit(thu, friItems, FRI, fri);
  assert.deepEqual(r.errors, ['Phần II “Hạng mục 711 (giả)”: ghi việc sẽ làm tuần tới.']);
  assert.equal(where(r.data, 701), 'risks'); assert.equal(where(r.data, 711), 'ongoing');
  // Giao diện nhận lại bản đã xếp (422 kèm data), người lập điền bước tiếp rồi nộp lại → đạt.
  const again = submit(r.data, friItems, FRI, fri);
  assert.deepEqual(again.errors, []);
  assert.equal(where(again.fin, 701), 'risks'); assert.equal(where(again.fin, 711), 'ongoing');
  assert.equal(again.fin.ongoing.find(x => x.itemId === 711).status, 'Đúng tiến độ'); // làm sớm: không ghi "Chưa bắt đầu"
});

test('4. Việc cha đang làm có việc con chưa bắt đầu → báo việc cha; con đang làm → chỉ báo con; cha xong cùng con → chỉ con', () => {
  const P1 = task(401, '2026-12-31', 'STARTED', 40), C1 = task(402, '2026-12-20', 'UNSTARTED', 0, { parentId: 401 });
  const C2 = task(403, '2026-10-28', 'COMPLETED', 100, { parentId: 401, completedAt: d('2026-10-28') });
  const p = WK.buildPrefill({ week: F, deptId: 1, items: prep([P1, C1, C2], FRI), memberIds: new Set([50]) });
  assert.equal(where(p, 401), 'ongoing'); assert.equal(where(p, 403), 'results'); assert.equal(where(p, 402), '-');
  const p2 = WK.buildPrefill({ week: F, deptId: 1, items: prep([P1, { ...C1, state: { category: 'STARTED' }, progress: 10 }], FRI), memberIds: new Set([50]) });
  assert.equal(where(p2, 401), '-'); assert.equal(where(p2, 402), 'ongoing');
  const done = [task(411, '2026-10-29', 'COMPLETED', 100, { completedAt: d('2026-10-29') }), task(412, '2026-10-28', 'COMPLETED', 100, { parentId: 411, completedAt: d('2026-10-28') })];
  const p3 = WK.buildPrefill({ week: F, deptId: 1, items: prep(done, FRI), memberIds: new Set([50]) });
  assert.equal(where(p3, 411), '-'); assert.equal(where(p3, 412), 'results');
  const m = WK.buildPrefill({ week: F, deptId: 1, items: prep([mtl(421, '2026-10-01', '2026-12-31', 'STARTED', 30), mtl(422, '2026-12-01', '2026-12-31', 'UNSTARTED', 0, { parentId: 421 })], FRI), memberIds: new Set([50]) });
  assert.equal(where(m, 421), 'ongoing');
  // Vòng 2: cha đang làm có con CHƯA bắt đầu mà trễ hạn / chậm khởi động → cha vẫn ở Phần II, con ở Phần III.
  const p4 = WK.buildPrefill({ week: F, deptId: 1, items: prep([P1, task(404, '2026-10-27', 'UNSTARTED', 0, { parentId: 401 })], FRI), memberIds: new Set([50]) });
  assert.equal(where(p4, 401), 'ongoing'); assert.equal(where(p4, 404), 'risks');
  const m2 = WK.buildPrefill({ week: F, deptId: 1, items: prep([mtl(411, '2026-09-01', '2026-12-31', 'STARTED', 40), mtl(412, '2026-10-01', '2026-11-30', 'UNSTARTED', 0, { parentId: 411 })], FRI), memberIds: new Set([50]) });
  assert.equal(where(m2, 411), 'ongoing'); assert.equal(where(m2, 412), 'risks');
  // Cha CHƯA bắt đầu, con chưa bắt đầu mà có nguy cơ → chỉ báo con (báo thay cha).
  const p5 = WK.buildPrefill({ week: F, deptId: 1, items: prep([task(405, '2026-12-31', 'UNSTARTED', 0), task(406, '2026-10-27', 'UNSTARTED', 0, { parentId: 405 })], FRI), memberIds: new Set([50]) });
  assert.equal(where(p5, 405), '-'); assert.equal(where(p5, 406), 'risks');
});

test('5. Văn bản tổng hợp theo quyền: trưởng / phó bộ phận khác không nhận tên việc của bộ phận khác (API + MCP dùng summaryView)', () => {
  const data = { results: [{ key: 'a', itemId: 9, task: 'Xử lý kỷ luật nhân viên Y (giả)', status: 'Hoàn thành', pct: 100, due: '2026-10-29', ownerIds: [50] }],
    ongoing: [{ key: 'b', itemId: 10, task: 'Rà soát lương nhóm Z (giả)', status: 'Đúng tiến độ', pct: 40, due: '2026-11-20', ownerIds: [50], next: 'Trình TGĐ (giả)' }],
    risks: [{ key: 'c', itemId: 11, task: 'Thanh lý HĐ ông K (giả)', status: 'Chậm', risk: 'LATE_START', riskNote: 'Chậm khởi động', started: false, pct: 0, due: '2026-11-10', ownerIds: [50], solution: 'Đẩy nhanh (giả)' }], plans: [], other: '' };
  const sum = sumOf(data);
  const subj = (role, departmentId) => {
    const user = { id: 1, role, departmentId, permissions: ROLE_PROFILES[role] };
    const s = { it: false, director: role === 'director', secretary: false, pmo: false, leader: !!permissionScope(user, 'reports.summary', 'VIEW'), mustReport: role !== 'director', departmentId, userId: 1 };
    return { ...s, full: P.can(s, 'view', 'weekly.summary.detail') };
  };
  const headB = subj('manager', 2), gd = subj('director', null);
  assert.equal(headB.full, false); assert.equal(gd.full, true);
  const secret = ['Xử lý kỷ luật nhân viên Y', 'Rà soát lương nhóm Z', 'Trình TGĐ', 'Thanh lý HĐ ông K', 'Đẩy nhanh'];
  const forHead = WK.summaryView(sum, { full: headB.full, departmentId: headB.departmentId });
  for (const t of secret) assert.equal(forHead.text.includes(t), false, t);
  assert.deepEqual(forHead.view.risks, []);
  assert.equal(forHead.fullText, undefined); // trưởng / phó không có bản đầy đủ
  const forGd = WK.summaryView(sum, { full: gd.full, departmentId: null });
  for (const t of secret) assert.equal(forGd.fullText.includes(t), true, t); // bản đầy đủ: chỉ trong Hub, chỉ dùng nội bộ
  // Bản gửi email (chủ dự án chọn "Bản tóm tắt"), kể cả khi thư ký / Ban GĐ sao chép: không có danh sách mục I, II; mục III có tên, nguy cơ, hạn, giải pháp.
  for (const t of ['Xử lý kỷ luật nhân viên Y', 'Rà soát lương nhóm Z', 'Trình TGĐ']) assert.equal(forGd.text.includes(t), false, t);
  assert.ok(forGd.text.includes('- [Ban A (giả)] Thanh lý HĐ ông K (giả) — Chậm khởi động (hạn 10/11) · 0% — Giải pháp: Đẩy nhanh (giả)'));
  assert.ok(forGd.text.includes('Ban A (giả): ') && forGd.text.includes('xong 1, đang làm 1, nguy cơ chậm 1'));
  assert.equal(forGd.text.includes('I. ĐÃ HOÀN THÀNH'), false); assert.equal(forGd.text.includes('II. ĐANG THỰC HIỆN'), false);
  // Trưởng / phó của chính bộ phận: mục III có việc bộ phận mình.
  assert.ok(WK.summaryView(sum, { full: false, departmentId: 1 }).text.includes('Thanh lý HĐ ông K'));
});

test('6. Bản Word: hạng mục MTL dùng trạng thái MTL (cùng định nghĩa báo cáo tuần); việc thường theo số ngày cảnh báo', () => {
  const mk = (id, s, e, cat, progress) => ({ ...mtl(id, s, e, cat, progress), number: id, project: { key: 'DA', departmentId: 1, kind: 'MTL' }, dueDate: end(e), taskType: 'PLAN', priority: 'NONE', approvals: [], progressReports: [] });
  const items = [mk(501, '2026-09-01', '2026-12-31', 'UNSTARTED', 0), mk(502, '2026-09-01', '2026-12-31', 'STARTED', 10), mk(503, '2026-10-01', '2026-11-01', 'STARTED', 98), mk(504, '2026-10-01', '2026-11-05', 'STARTED', 60)];
  const weekly = prep(items, FRI);
  const rd = reportData(items, { from: d('2026-10-26'), end: d('2026-11-02'), now: FRI, departments: [{ id: 1, name: 'Ban A (giả)' }] });
  for (const w of weekly) assert.equal(rd.riskOf(items.find(i => i.id === w.id))?.code ?? null, w.risk?.code ?? null, `hạng mục ${w.id}`);
  assert.deepEqual(rd.sections.risk.map(i => i.id).sort(), [501, 502, 504]);
  assert.equal(rd.status(items[0]).endsWith('· chậm khởi động'), true);
  // Việc thường: số ngày "sắp đến hạn" theo thiết lập (vd. 5 ngày).
  const t = { id: 9, number: 9, title: 'X', project: { key: 'TT', departmentId: 1 }, state: { category: 'STARTED' }, assignees: [], dueDate: end('2026-11-04'), taskType: 'ADHOC', leadDepartmentId: 1, approvals: [], progressReports: [] };
  assert.equal(reportData([t], { from: d('2026-10-26'), end: d('2026-11-02'), now: FRI }).riskOf(t), null);
  assert.equal(reportData([t], { from: d('2026-10-26'), end: d('2026-11-02'), now: FRI, dueSoonDays: 5 }).riskOf(t).code, 'DUE_SOON');
  // Kế hoạch năm đến hạn trong kỳ (đếm ở cột KH năm) có trong bảng của phòng.
  const plan = { ...t, id: 5, taskType: 'PLAN', state: { category: 'UNSTARTED' }, dueDate: d('2026-10-30') };
  const rdp = reportData([plan], { from: d('2026-10-26'), end: d('2026-11-02'), now: new Date('2026-10-26T09:00:00+07:00'), departments: [{ id: 1, name: 'P' }] });
  assert.deepEqual(rdp.byDepartment[0].types[0].items.map(i => i.id), [5]);
});

test('7. Việc xong sau giờ nộp tuần trước (kể cả thứ Sáu chiều, nộp sớm thứ Năm) → báo "xong" ở tuần này; đã báo xong tuần trước thì không lặp', () => {
  const X = mtl(301, '2026-10-01', '2026-11-30', 'COMPLETED', 100, { completedAt: new Date('2026-10-24T09:00:00+07:00') });
  const prev = { results: [], risks: [], plans: [], ongoing: [{ key: 'm301', itemId: 301, task: 'x', status: 'Đúng tiến độ' }] };
  assert.equal(where(WK.buildPrefill({ week: F, deptId: 1, items: prep([X], FRI), memberIds: new Set([50]), prev }), 301), 'results');
  const prevDone = { ...prev, ongoing: [{ key: 'm301', itemId: 301, task: 'x', status: 'Hoàn thành' }] };
  assert.equal(where(WK.buildPrefill({ week: F, deptId: 1, items: prep([X], FRI), memberIds: new Set([50]), prev: prevDone }), 301), '-');
  const at = iso => where(WK.buildPrefill({ week: F, deptId: 1, items: prep([mtl(302, '2026-10-01', '2026-11-30', 'COMPLETED', 100, { completedAt: new Date(iso) })], FRI), memberIds: new Set([50]) }), 302);
  // Cửa sổ "xong" mở từ thứ Hai tuần trước: xong T6 23/10 16:30 (sau giờ nộp), T5 22/10 18:00 (đã nộp sớm T5 17:00) không bị sót.
  assert.equal(at('2026-10-23T16:30:00+07:00'), 'results');
  assert.equal(at('2026-10-22T18:00:00+07:00'), 'results');
  assert.equal(at('2026-10-19T00:00:00+07:00'), 'results');
  assert.equal(at('2026-10-18T23:59:00+07:00'), '-'); // Chủ nhật hai tuần trước
  // Tuần trước đã ghi "Hoàn thành" (vd. xong T4 21/10 trước giờ nộp) → không báo lại.
  const Y = mtl(303, '2026-10-01', '2026-11-30', 'COMPLETED', 100, { completedAt: new Date('2026-10-21T09:00:00+07:00') });
  const prevY = { results: [{ key: 'm303', itemId: 303, task: 'y', status: 'Hoàn thành' }], ongoing: [], risks: [], plans: [] };
  assert.equal(where(WK.buildPrefill({ week: F, deptId: 1, items: prep([Y], FRI), memberIds: new Set([50]), prev: prevY }), 303), '-');
  assert.equal(at('2026-10-24T00:00:00+07:00'), 'results');
  assert.equal(at('2026-11-01T23:59:59+07:00'), 'results');
  assert.equal(at('2026-11-02T00:00:00+07:00'), '-');
});

test('Kế hoạch tuần trước gắn việc mà chưa làm → Phần III "Đã đăng ký tuần trước, chưa khởi động"; vẫn chưa làm lúc nộp thì giữ', () => {
  const x = task(1, '2026-12-15', 'UNSTARTED', 0, { startDate: d('2026-10-26') });
  const prev = { results: [], ongoing: [], risks: [], plans: [{ key: 'm1', itemId: 1, task: 'x', basis: 'Công việc', ownerIds: [50], due: '2026-12-15' }, { key: 'pf', itemId: null, task: 'Tự do (giả)', basis: 'KH tháng', ownerIds: [50], due: '2026-11-05' }] };
  const items = prep([x], FRI);
  const p = WK.buildPrefill({ week: F, deptId: 1, items, memberIds: new Set([50]), prev });
  assert.equal(where(p, 1), 'risks'); assert.equal(WK.rowRisk(p.risks[0], F), 'Đã đăng ký tuần trước, chưa khởi động');
  assert.ok(p.results.some(r => r.key === 'pf'));
  const r = submit(p, items, FRI_PM, p);
  assert.deepEqual(r.errors, []); assert.equal(r.fin.risks[0].risk, 'PLAN_NOT_STARTED');
  assert.ok(III(WK.summaryText(sumOf(r.fin))).includes('Việc 1 (giả) — Đã đăng ký tuần trước, chưa khởi động'));
});

test('Chữ hiển thị: đến hạn hôm nay; MTL làm sớm không ghi "Chưa bắt đầu"', () => {
  assert.equal(WK.riskNoteOf(A.riskOf({ state: { category: 'STARTED' }, dueDate: end('2026-10-30') }, { day: FRI })), 'Đến hạn hôm nay');
  const p = WK.buildPrefill({ week: F, deptId: 1, items: prep([mtl(1, '2026-11-16', '2026-12-31', 'STARTED', 10, { startedAt: FRI })], FRI), memberIds: new Set([50]) });
  assert.equal(p.ongoing[0].status, 'Đúng tiến độ');
});

test('Vòng 2 — dòng tự do ghi "Chưa bắt đầu", 0% không tính là đang thực hiện; dòng bắt buộc chưa làm → Phần III', () => {
  const actions = [{ ref: '2026-10-26:1', task: 'Làm việc với Sở XD về GPXD (giả)', ownerId: 50, due: '2026-11-06', departmentId: 1, meetingWeek: '2026-10-23' }];
  const prev = { results: [], ongoing: [], risks: [], plans: [{ key: 'pf', itemId: null, task: 'Khảo sát địa điểm (giả)', basis: 'KH tháng', ownerIds: [50], due: '2026-11-13' }] };
  const p = WK.buildPrefill({ week: F, deptId: 1, items: [], memberIds: new Set([50]), prev, actions });
  for (const r of p.results) r.status = 'Chưa bắt đầu';
  p.results.push({ key: 'fx', itemId: null, task: 'Việc phát sinh chưa làm (giả)', source: 'Phát sinh', ownerIds: [50], due: '2026-11-20', status: 'Chưa bắt đầu', pct: 0 });
  p.ongoing.push({ key: 'fy', itemId: null, task: 'Việc tự do đang làm (giả)', source: 'Phát sinh', ownerIds: [50], due: '2026-11-20', status: 'Đúng tiến độ', pct: '', next: 'Tiếp (giả)' });
  const r = submit(p, [], FRI_PM, p, fillAll, actions);
  assert.deepEqual(r.errors, []);
  const sum = WK.buildSummary({ week: F, depts: [{ id: 1, name: 'Ban A (giả)' }], reports: [{ departmentId: 1, firstSubmittedAt: FRI_PM, submittedAt: FRI_PM, submitCount: 1, data: r.fin }], notices: [],
    actions, actionRows: new Map([[actions[0].ref, r.fin.results.find(x => x.actionRef)]]), now: new Date('2026-11-02T07:00:00+07:00') });
  const text = WK.summaryText(sum);
  assert.equal(sum.kpis.ongoing, 1); assert.equal(sum.kpis.risk, 2);
  for (const t of ['Sở XD', 'Khảo sát', 'phát sinh chưa làm']) assert.equal(II(text).includes(t), false, t);
  assert.ok(II(text).includes('Việc tự do đang làm (giả)'));
  assert.ok(III(text).includes('Làm việc với Sở XD về GPXD (giả) — TGĐ giao, chưa khởi động'));
  assert.ok(III(text).includes('Khảo sát địa điểm (giả) — Đã đăng ký tuần trước, chưa khởi động'));
  assert.equal(III(text).includes('phát sinh chưa làm'), false); // không bắt buộc, chưa làm, chưa tới hạn → không báo cáo
  // Tuần sau: dòng tự do đã đăng ký mà vẫn chưa làm giữ cờ (Phần III), người lập vẫn bỏ được (không bắt buộc).
  const F2 = WK.addDays(F, 7);
  const p2 = WK.buildPrefill({ week: F2, deptId: 1, items: [], memberIds: new Set([50]), prev: r.fin });
  const k = p2.ongoing.find(x => x.task === 'Khảo sát địa điểm (giả)');
  assert.equal(k.planned, true); assert.equal(k.mandatory, false); assert.equal(WK.rowRisk(k, F2), 'Đã đăng ký tuần trước, chưa khởi động');
});

test('Vòng 2 — "Đã đăng ký tuần trước, chưa khởi động" giữ qua các tuần tới khi việc được bắt đầu', () => {
  const x = task(1301, '2026-12-31', 'UNSTARTED', 0, { startDate: d('2026-10-27') });
  const prev = { results: [], ongoing: [], risks: [], plans: [{ key: 'm1301', itemId: 1301, task: 'x', basis: 'Công việc', ownerIds: [50], due: '2026-12-31' }] };
  const p = WK.buildPrefill({ week: F, deptId: 1, items: prep([x], FRI), memberIds: new Set([50]), prev });
  const r1 = submit(p, prep([x], FRI), FRI_PM, p);
  assert.equal(where(r1.fin, 1301), 'risks'); assert.equal(r1.fin.risks[0].risk, 'PLAN_NOT_STARTED');
  const F2 = WK.addDays(F, 7), day2 = new Date('2026-11-06T10:00:00+07:00');
  const p2 = WK.buildPrefill({ week: F2, deptId: 1, items: prep([x], day2), memberIds: new Set([50]), prev: r1.fin });
  assert.equal(where(p2, 1301), 'risks'); assert.equal(p2.risks[0].risk, 'PLAN_NOT_STARTED');
  // Đã bắt đầu → hết cờ, sang Phần II.
  const p3 = WK.buildPrefill({ week: F2, deptId: 1, items: prep([{ ...x, state: { category: 'STARTED' }, progress: 10 }], day2), memberIds: new Set([50]), prev: r1.fin });
  assert.equal(where(p3, 1301), 'ongoing'); assert.equal(p3.ongoing[0].risk, null);
});

test('Vòng 2 — dòng Phần III đã bắt đầu lúc nộp: xếp sang Phần II TRƯỚC khi kiểm tra → hỏi "việc sẽ làm tuần tới" ngay lần nộp này', () => {
  const T = mtl(211, '2026-10-01', '2026-11-30', 'UNSTARTED', 0);
  const items = prep([T], FRI);
  const p = WK.buildPrefill({ week: F, deptId: 1, items, memberIds: new Set([50]) });
  assert.equal(where(p, 211), 'risks');
  const fill = dr => { const x = fillAll(dr); x.risks[0].pct = 30; x.risks[0].next = ''; return x; };
  const r = submit(p, items, FRI, p, fill);
  assert.deepEqual(r.errors, ['Phần II “Hạng mục 211 (giả)”: ghi việc sẽ làm tuần tới.']);
  assert.equal(where(r.data, 211), 'ongoing');
});

test('Vòng 2 — bản Word xuất theo một phòng: % việc cha MTL tính trên ĐỦ việc con (rollupItems), khớp báo cáo tuần', () => {
  const mk = (id, s, e, cat, progress, extra = {}) => ({ ...mtl(id, s, e, cat, progress, extra), number: id, project: { key: 'DA', departmentId: 1, kind: 'MTL' }, dueDate: end(e), taskType: 'PLAN', priority: 'NONE', approvals: [], progressReports: [] });
  const parent = mk(511, '2026-09-01', '2026-11-30', 'STARTED', 0);
  const mine = mk(512, '2026-09-01', '2026-11-30', 'STARTED', 60, { parentId: 511 });
  const other = mk(513, '2026-09-01', '2026-11-30', 'UNSTARTED', 0, { parentId: 511, leadDepartmentId: 2 }); // con của phòng khác, ngoài phạm vi lọc
  const all = [parent, mine, other];
  const opt = { from: d('2026-10-26'), end: d('2026-11-02'), now: FRI, departments: [{ id: 1, name: 'Ban A (giả)' }] };
  const scoped = [parent, mine];
  const full = reportData(all, opt).riskOf(parent)?.code ?? null; // như báo cáo tuần: rollup trên đủ con (60% và 0% → 30%)
  assert.equal(M.rollup(all).get(511), 30);
  assert.equal(reportData(scoped, { ...opt, rollupItems: all }).riskOf(parent)?.code ?? null, full);
  assert.notEqual(full, null);
  // Không có rollupItems (cách cũ): cha thành 60% → lệch.
  assert.equal(M.rollup(scoped).get(511), 60);
});

test('Vòng 2 — MTL chưa có kế hoạch gốc: "sắp đến hạn" theo thiết lập dueSoonDays ở cả báo cáo tuần (tính lại lúc nộp) và bản Word', () => {
  const i = { id: 1, kind: 'MTL', state: { category: 'STARTED' }, progress: 10, dueDate: end('2026-11-04'), baselineStart: null, baselineEnd: null };
  const opt = { day: FRI, taskDueSoonDays: 5 };
  assert.equal(A.riskOf(i, opt).code, 'DUE_SOON');
  // weekly-recompute dùng i.dueSoonDays (routes/weekly.js mtlItemsFor gắn thiết lập vào hạng mục).
  const WRm = require('./weekly-recompute');
  const row = { key: 'm1', itemId: 1, task: 'x', status: 'Đúng tiến độ', pct: 10, pct0: 10, ownerIds: [50] };
  WRm.recomputeRows({ results: [], ongoing: [row], risks: [] }, [{ ...i, code: 'DA-1', title: 'x', cfg: M.DEFAULT_ALERTS, actual: 10, children: 0, dueSoonDays: 5, started: true }], FRI);
  assert.equal(row.risk, 'DUE_SOON');
  const t = { id: 1, number: 1, title: 'x', project: { key: 'DA', departmentId: 1, kind: 'MTL' }, state: { category: 'STARTED' }, progress: 10, assignees: [], dueDate: end('2026-11-04'), taskType: 'PLAN', leadDepartmentId: 1, approvals: [], progressReports: [] };
  assert.equal(reportData([t], { from: d('2026-10-26'), end: d('2026-11-02'), now: FRI, dueSoonDays: 5 }).riskOf(t).code, 'DUE_SOON');
});
