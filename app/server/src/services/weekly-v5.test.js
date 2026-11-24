// Báo cáo tuần — nghiệm thu PR #40 vòng 5: trường DO MÁY TÍNH (tên, hạn, %, tình trạng hệ thống, nguy cơ, phần I/II/III) luôn tính lại ở mọi
// lần lưu với MỌI dòng; trường DO NGƯỜI NHẬP chỉ người được sửa đổi (người xem được việc; thư ký: quyền sửa + xem tổng hợp đầy đủ); thay
// đổi bị bỏ qua phải được báo lại; dòng tự bổ sung nhận giải trình; không dòng tự do trùng tên việc. Gọi ĐÚNG hàm của routes/weekly.js.
// Dữ liệu GIẢ, ngày CỐ ĐỊNH.
const test = require('node:test');
const assert = require('node:assert/strict');
const WK = require('./weekly');
const WS = require('./weekly-submit');
const A = require('./alerts');
const M = require('./mtl');

const F = '2026-10-30';
const end = s => new Date(`${s}T23:59:59+07:00`);
const WED = new Date('2026-10-28T10:00:00+07:00'), FRI_PM = new Date('2026-10-30T16:00:00+07:00'), MON = new Date('2026-11-02T07:00:00+07:00');
const task = (id, due, cat, progress, extra = {}) => ({ id, kind: 'TASK', code: `SO-${id}`, projectKey: 'SO', title: `Việc ${id} (giả)`, parentId: null, startDate: null, dueDate: due ? end(due) : null,
  state: { category: cat }, progress, startedAt: null, progressAt: null, returnedAt: null, completedAt: null, assignees: [{ id: 50 }], leadDepartmentId: 1, children: 0, ...extra });
const prep = (items, day) => items.map(i => { const done = M.isDone(i); return { ...i, done, cancelled: M.isCancelled(i), actual: i.progress, started: A.isStarted(i), risk: done ? null : A.riskOf(i, { day }) }; });
const HEAD_ONLY = { assignees: [{ id: 60 }] };
// Thời điểm: thứ Tư trưởng phòng lưu nháp; thứ Năm 950 xong, 970 bị lưu trữ; thứ Sáu nhân viên nộp.
const at = day => {
  const thu = day >= new Date('2026-10-29T09:00:00+07:00');
  return prep([
    task(101, '2026-12-15', 'STARTED', 20),
    task(901, '2026-10-29', 'UNSTARTED', 0, { ...HEAD_ONLY, title: 'Nộp hồ sơ đấu giá lô D (giả)' }), // hạn thứ Năm
    thu ? task(950, '2026-12-10', 'COMPLETED', 100, { ...HEAD_ONLY, title: 'Kỷ luật nhân sự X (kín, giả)', completedAt: new Date('2026-10-29T11:00:00+07:00') })
      : task(950, '2026-12-10', 'STARTED', 20, { ...HEAD_ONLY, title: 'Kỷ luật nhân sự X (kín, giả)' }),
    ...(thu ? [] : [task(970, '2026-12-01', 'STARTED', 10, { ...HEAD_ONLY, title: 'Việc sẽ bị lưu trữ (giả)' })]), // routes: archivedAt → không còn trong phạm vi
  ], day);
};
const STAFF = new Set([101]), HEAD = new Set([101, 901, 950, 970]), SECRETARY = new Set();
const members = new Set([50, 60]);
const ctxOf = seen => ({ userIds: new Set([50, 60]), deptIds: new Set([1, 2]), itemIds: new Set(seen.map(i => i.id)), taskIds: new Set(seen.map(i => i.id)), items: seen, deptName: () => '' });
const fill = x => { for (const r of WK.allRows(x)) Object.assign(r, { ownerIds: r.ownerIds?.length ? r.ownerIds : [50], next: r.next || 'Tiếp tục (giả)', cause: r.cause || 'Nguyên nhân (giả)', solution: r.solution || 'Giải pháp (giả)', helpFrom: r.helpFrom || 'SELF' });
  for (const p of x.plans) Object.assign(p, { ownerIds: p.ownerIds?.length ? p.ownerIds : [60], output: p.output || 'Đầu ra (giả)' }); return x; };
const prefillOf = (vis, day) => WK.buildPrefill({ week: F, deptId: 1, items: at(day).filter(i => vis.has(i.id)), memberIds: members });
const saveDraft = (vis, raw, saved, day, editAll = false) => WS.mergeDraft(raw, ctxOf(at(day).filter(i => vis.has(i.id))), saved, { scopeItems: at(day), editAll, now: day });
function submit(vis, raw, saved, day, editAll = vis === SECRETARY) {
  const items = at(day), seen = items.filter(i => vis.has(i.id));
  const r = WS.prepareSubmit({ raw, ctx: ctxOf(seen), prefill: prefillOf(vis, day), now: day, week: F, saved, scopeItems: items, editAll });
  if (r.errors.length) return r;
  const full = WK.buildPrefill({ week: F, deptId: 1, items, memberIds: members });
  return { ...r, fin: WS.finishSubmit(r.data, F, { full, visibleIds: new Set(seen.map(i => i.id)), parentOf: new Map(items.map(i => [i.id, i.parentId])) }).final };
}
const view = (data, vis) => WK.viewFor(structuredClone(data), id => vis.has(id));
const rowOf = (x, id) => WK.allRows(x).find(r => r.itemId === id);
const listOf = (x, id) => ['results', 'ongoing', 'risks', 'plans'].filter(k => (x[k] || []).some(r => r.itemId === id)).join(',') || '-';
const kpis = data => { const k = WK.buildSummary({ week: F, depts: [{ id: 1, name: 'Ban A (giả)' }], reports: [{ departmentId: 1, firstSubmittedAt: FRI_PM, submittedAt: FRI_PM, submitCount: 1, data }], notices: [], now: MON }).kpis; return { done: k.done, ongoing: k.ongoing, risk: k.risk }; };

test('Vòng 5 — mục 1: thời gian trôi giữa lúc trưởng phòng lưu nháp và lúc nhân viên nộp → dòng giữ lại được TÍNH LẠI; việc đã lưu trữ bị bỏ', () => {
  const tp = fill(prefillOf(HEAD, WED));
  Object.assign(rowOf(tp, 950), { status: 'Vướng', cause: 'Chờ hội đồng (giả)', solution: 'Họp lại (giả)', helpFrom: 'SELF' });
  const { data: d1 } = saveDraft(HEAD, tp, null, WED);
  assert.equal(rowOf(d1, 901).risk, 'DUE_SOON'); assert.equal(listOf(d1, 950), 'ongoing'); assert.equal(listOf(d1, 970), 'ongoing');
  // Thứ Sáu nhân viên (chỉ xem được 101) nộp.
  const r = submit(STAFF, fill(view(d1, STAFF)), d1, FRI_PM);
  assert.deepEqual(r.errors, []);
  assert.equal(rowOf(r.fin, 901).risk, 'OVERDUE'); assert.equal(rowOf(r.fin, 901).riskNote, 'Trễ hạn 1 ngày');
  assert.equal(listOf(r.fin, 950), 'results'); assert.equal(rowOf(r.fin, 950).status, 'Hoàn thành'); assert.equal(rowOf(r.fin, 950).pct, 100);
  assert.equal(listOf(r.fin, 970), '-'); // đã lưu trữ → bỏ
  // Số liệu giống hệt khi trưởng phòng tự nộp cùng dữ liệu.
  const byHead = submit(HEAD, fill(view(d1, HEAD)), d1, FRI_PM);
  assert.deepEqual(byHead.errors, []);
  assert.deepEqual(kpis(r.fin), kpis(byHead.fin));
  assert.deepEqual(kpis(r.fin), { done: 1, ongoing: 1, risk: 1 });
  // Lưu nháp cũng tính lại (không chỉ lúc nộp).
  const { data: d2 } = saveDraft(STAFF, view(d1, STAFF), d1, FRI_PM);
  assert.equal(rowOf(d2, 901).risk, 'OVERDUE'); assert.equal(listOf(d2, 950), 'results'); assert.equal(listOf(d2, 970), '-');
});

test('Vòng 5 — mục 2: thư ký sửa được trường do người nhập (cả dòng tự bổ sung); người không được sửa gửi thay đổi → máy chủ bỏ và BÁO LẠI', () => {
  const tp = fill(prefillOf(HEAD, FRI_PM));
  const h = submit(HEAD, tp, null, FRI_PM);
  assert.deepEqual(h.errors, []);
  // Thư ký (không xem được việc nào, xem tổng hợp đầy đủ + quyền sửa): sửa giải pháp dòng 901 rồi gửi lại → nhận.
  const sf = structuredClone(h.fin); Object.assign(rowOf(sf, 901), { solution: 'Thư ký ghi theo email (giả)' });
  const s = submit(SECRETARY, sf, h.fin, FRI_PM);
  assert.deepEqual(s.errors, []); assert.equal(s.ignored, 0);
  assert.equal(rowOf(s.fin, 901).solution, 'Thư ký ghi theo email (giả)');
  assert.equal(rowOf(s.fin, 901).task, 'Nộp hồ sơ đấu giá lô D (giả)'); // trường máy tính lấy từ việc
  // Lưu nháp của thư ký cũng nhận (không còn trả ok mà không lưu).
  const dd = saveDraft(SECRETARY, sf, h.fin, FRI_PM, true);
  assert.equal(dd.ignored, 0); assert.equal(rowOf(dd.data, 901).solution, 'Thư ký ghi theo email (giả)');
  // Nhân viên (không được sửa dòng 901) gửi thay đổi → bỏ qua, báo lại số thay đổi bị bỏ.
  const nf = view(h.fin, STAFF); nf.risks.push({ key: 'm901', itemId: 901, task: 'x', status: 'Vướng', cause: 'Nhân viên ghi (giả)', ownerIds: [50] });
  const n = submit(STAFF, nf, h.fin, FRI_PM);
  assert.deepEqual(n.errors, []); assert.equal(n.ignored, 1);
  assert.equal(rowOf(n.fin, 901).cause, rowOf(h.fin, 901).cause);
  const nd = saveDraft(STAFF, nf, h.fin, FRI_PM);
  assert.equal(nd.ignored, 1);
});

test('Vòng 5 — nới quy tắc: người xem được việc / thư ký nhập giải trình, "Vướng", đề nghị hỗ trợ vào CHÍNH dòng tự bổ sung; không tạo dòng tự do trùng', () => {
  // Nhân viên nộp trước → 901, 950 thành dòng tự bổ sung.
  const s1 = submit(STAFF, fill(prefillOf(STAFF, FRI_PM)), null, FRI_PM);
  assert.deepEqual(s1.errors, []); assert.equal(rowOf(s1.fin, 901).auto, true);
  const before = kpis(s1.fin);
  // Trưởng phòng ghi "Vướng" + đề nghị Ban GĐ hỗ trợ cho 901 ngay trên dòng tự bổ sung.
  const tf = view(s1.fin, HEAD);
  Object.assign(rowOf(tf, 901), { status: 'Vướng', cause: 'Chờ Sở (giả)', solution: 'Đôn đốc (giả)', helpFrom: 'BGD', helpWhat: 'Ban GĐ làm việc với Sở (giả)', helpBy: '2026-11-04' });
  const r = submit(HEAD, tf, s1.fin, FRI_PM);
  assert.deepEqual(r.errors, []);
  const x = rowOf(r.fin, 901);
  assert.equal(x.auto, true); assert.equal(x.status, 'Vướng'); assert.equal(x.helpWhat, 'Ban GĐ làm việc với Sở (giả)');
  assert.equal(WK.allRows(r.fin).filter(y => y.itemId === 901).length, 1);
  assert.deepEqual(kpis(r.fin), before);
  const helps = WK.buildSummary({ week: F, depts: [{ id: 1, name: 'Ban A (giả)' }], reports: [{ departmentId: 1, firstSubmittedAt: FRI_PM, submittedAt: FRI_PM, submitCount: 1, data: r.fin }], notices: [], now: MON }).helps.flatMap(g => g.list);
  assert.deepEqual(helps.map(h => h.itemId), [901]);
  // Nhân viên không xem được → không thấy dòng, không sửa được.
  assert.equal(JSON.stringify(view(r.fin, STAFF)).includes('lô D'), false);
  // Thư ký gõ dòng tự do trùng tên dòng tự bổ sung → lỗi, hướng sửa chính dòng đó; không tạo 2 dòng mâu thuẫn.
  const sf = structuredClone(r.fin); sf.ongoing.push({ key: 'fdup', itemId: null, task: 'Nộp hồ sơ đấu giá lô D (giả)', source: 'Phát sinh', ownerIds: [50], due: '2026-11-06', status: 'Chậm', pct: 0, next: 'x', cause: 'c', solution: 's', helpFrom: 'SELF' });
  const dup = submit(SECRETARY, sf, r.fin, FRI_PM);
  assert.equal(dup.errors.length, 1); assert.match(dup.errors[0], /đã có dòng gắn việc trong báo cáo \(dòng “Hệ thống tự bổ sung”\) — ghi tình trạng/);
});
