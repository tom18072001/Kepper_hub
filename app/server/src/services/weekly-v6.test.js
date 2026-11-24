// Báo cáo tuần — nghiệm thu PR #40 vòng 6: KHUNG NGUYÊN TẮC K1–K5 (services/weekly-submit.js) cho mọi đường lưu.
// Gọi ĐÚNG các hàm routes/weekly.js dùng (mergeDraft / prepareSubmit / finishSubmit / viewFor / summaryView). Dữ liệu GIẢ, ngày CỐ ĐỊNH.
const test = require('node:test');
const assert = require('node:assert/strict');
const WK = require('./weekly');
const WS = require('./weekly-submit');
const A = require('./alerts');
const M = require('./mtl');

const F = '2026-10-30';
const d = s => new Date(`${s}T00:00:00+07:00`), end = s => new Date(`${s}T23:59:59+07:00`);
const FRI_PM = new Date('2026-10-30T16:00:00+07:00'), MON = new Date('2026-11-02T07:00:00+07:00');
const task = (id, title, due, cat, progress, extra = {}) => ({ id, kind: 'TASK', code: `CV-${id}`, projectKey: 'CV', title, parentId: null, startDate: null, dueDate: due ? end(due) : null,
  state: { category: cat }, progress, startedAt: null, progressAt: null, returnedAt: null, completedAt: null, assignees: [{ id: 50 }], leadDepartmentId: 1, children: 0, ...extra });
const mtl = (id, title, s, e, cat, progress, extra = {}) => ({ id, kind: 'MTL', code: `DA-${id}`, projectKey: 'DA', planCode: String(id), title, parentId: null, baselineStart: d(s), baselineEnd: end(e),
  state: { category: cat }, progress, startedAt: null, progressAt: null, completedAt: null, assignees: [{ id: 50 }], leadDepartmentId: 1, children: 0, ...extra });
function prep(items, day) {
  const cfg = M.DEFAULT_ALERTS;
  return items.map(i => {
    const done = M.isDone(i), cancelled = M.isCancelled(i), actual = i.progress;
    if (i.kind === 'TASK') return { ...i, done, cancelled, actual, started: A.isStarted(i), risk: done ? null : A.riskOf(i, { day }) };
    const st = M.statusOf(i, actual, day, cfg);
    return { ...i, done, cancelled, actual, cfg, status: st.code, started: A.isStarted(i, actual), risk: A.riskOf(i, { st, cfg, day }) };
  });
}
const HO = { assignees: [{ id: 60 }] }; // chỉ trưởng phòng
const TITLES = {
  101: 'Việc 101 của nhân viên (giả)', 900: 'Đàm phán giá đất lô C (giả)', 901: 'Nộp hồ sơ đấu giá lô D (giả)', 950: 'Kỷ luật nhân sự X (kín, giả)',
  960: 'Thương lượng hợp đồng Y (kín, giả)', 970: 'Việc riêng dự án kín của nhân viên (giả)', 980: 'Đàm phán mua lại công ty Z (kín, giả)', 990: 'Hạng mục MTL kín 990 (giả)',
};
const SECRET = new Set([900, 901, 950, 960, 980, 990]);
let world = {}; // ghi đè theo ca: { [id]: { progress, state, archived } }
const items = (day = FRI_PM) => prep([
  task(101, TITLES[101], '2026-12-15', 'STARTED', 30),
  task(900, TITLES[900], '2026-12-20', 'STARTED', 30, HO),
  task(901, TITLES[901], '2026-10-29', 'UNSTARTED', 0, HO),
  task(950, TITLES[950], '2026-12-01', 'STARTED', 20, HO),
  task(960, TITLES[960], '2026-11-20', 'UNSTARTED', 0, { ...HO, startDate: d('2026-11-03') }),
  task(970, TITLES[970], '2026-12-10', 'STARTED', 40),
  task(980, TITLES[980], '2027-06-30', 'UNSTARTED', 0, { ...HO, startDate: d('2027-03-01') }), // chưa từng vào báo cáo
  mtl(990, TITLES[990], '2026-10-01', '2026-11-30', 'STARTED', 20, HO),
].map(i => ({ ...i, ...(world[i.id] || {}) })).filter(i => !i.archived), day);
const VIS = { staff: new Set([101, 970]), head: new Set([101, 900, 901, 950, 960, 980, 990]), secr: new Set(), headB: new Set() };
const EDIT_ALL = { staff: false, head: false, secr: true };
const members = new Set([50, 60]);
const ctxOf = (who, day) => { const seen = items(day).filter(i => VIS[who].has(i.id)); return { userIds: new Set([50, 60]), deptIds: new Set([1, 2]), itemIds: new Set(seen.map(i => i.id)), taskIds: new Set(seen.filter(i => i.kind === 'TASK').map(i => i.id)), items: seen, deptName: () => '' }; };
const prefillOf = (who, day = FRI_PM) => WK.buildPrefill({ week: F, deptId: 1, items: items(day).filter(i => VIS[who].has(i.id)), memberIds: members });
const fill = x => { for (const r of WK.allRows(x)) Object.assign(r, { ownerIds: r.ownerIds?.length ? r.ownerIds : [50], next: r.next || 'Tiếp tục (giả)', cause: r.cause || 'Nguyên nhân (giả)', solution: r.solution || 'Giải pháp (giả)', helpFrom: r.helpFrom || 'SELF' });
  for (const p of x.plans) Object.assign(p, { ownerIds: p.ownerIds?.length ? p.ownerIds : [60], output: p.output || 'Đầu ra (giả)' }); return x; };
const draft = (who, raw, saved, day = FRI_PM) => WS.mergeDraft(structuredClone(raw), ctxOf(who, day), saved ? structuredClone(saved) : null, { scopeItems: items(day), editAll: EDIT_ALL[who], now: day });
function submit(who, raw, saved, { day = FRI_PM, frozen = false } = {}) {
  const all = items(day), ctx = ctxOf(who, day);
  const r = WS.prepareSubmit({ raw: structuredClone(raw), ctx, prefill: prefillOf(who, day), now: day, week: F, saved: saved ? structuredClone(saved) : null, scopeItems: all, editAll: EDIT_ALL[who], frozen });
  if (r.errors.length) return r;
  const full = WK.buildPrefill({ week: F, deptId: 1, items: all, memberIds: members });
  return { ...r, fin: WS.finishSubmit(r.data, F, { full, visibleIds: ctx.itemIds, parentOf: new Map(all.map(i => [i.id, i.parentId])) }, { frozen }).final };
}
const view = (who, data) => (who === 'secr' ? structuredClone(data) : WK.viewFor(structuredClone(data), id => VIS[who].has(id)));
const rowOf = (x, id) => WK.allRows(x).find(r => r.itemId === id);
const listOf = (x, id) => ['results', 'ongoing', 'risks', 'plans'].filter(k => (x[k] || []).some(r => r.itemId === id)).join(',') || '-';
const leaks = (who, obj) => Object.entries(TITLES).filter(([id]) => who !== 'secr' && !VIS[who].has(Number(id))).filter(([, t]) => JSON.stringify(obj).includes(t)).map(([id]) => Number(id));
const sumOf = data => WK.buildSummary({ week: F, depts: [{ id: 1, name: 'Ban A (giả)' }, { id: 2, name: 'Ban B (giả)' }], reports: [{ departmentId: 1, firstSubmittedAt: FRI_PM, submittedAt: FRI_PM, submitCount: 1, data }], notices: [], now: MON });
const kpis = data => { const k = sumOf(data).kpis; return { done: k.done, ongoing: k.ongoing, risk: k.risk }; };
// Bản nộp chuẩn: trưởng phòng lập (mọi việc trừ 970 của nhân viên — nhân viên lưu nháp trước), 950 "Vướng" + đề nghị Ban GĐ.
function baseReport() {
  world = {};
  const d0 = draft('staff', fill(prefillOf('staff')), null).data;
  const hp = view('head', d0), pf = prefillOf('head');
  for (const list of ['results', 'ongoing', 'risks', 'plans']) for (const n of pf[list]) if (!(hp[list] || []).some(x => x.itemId === n.itemId)) hp[list].push(structuredClone(n));
  const h = fill(hp);
  Object.assign(rowOf(h, 950), { status: 'Vướng', cause: 'Chờ hội đồng (giả)', solution: 'Họp lại (giả)', helpFrom: 'BGD', helpWhat: 'Ban GĐ chủ trì họp (giả)', helpBy: '2026-11-05' });
  const r = submit('head', h, d0);
  assert.deepEqual(r.errors, []);
  return r.fin;
}

test('Vòng 6 — mục 1 (K2): thư ký đoán itemId → không đọc được tên việc kín chưa từng có trong báo cáo; bị bỏ và có báo', () => {
  const base = baseReport();
  assert.equal(listOf(base, 980), '-');
  for (const path of ['draft', 'submit']) {
    const f = view('secr', base); f.ongoing.push({ key: 'probe', itemId: 980, task: 'x', status: 'Đúng tiến độ', pct: 10, ownerIds: [50], next: 'x' });
    f.plans.push({ key: 'probe2', itemId: 980, task: 'x', basis: 'KH tháng', ownerIds: [50], due: '2026-11-06', output: 'o' });
    const r = path === 'draft' ? draft('secr', f, base) : submit('secr', f, base);
    const out = r.fin || r.data;
    assert.equal(listOf(out, 980), '-', path); assert.equal(JSON.stringify(out).includes(TITLES[980]), false, path);
    assert.equal(r.ignored, 2, path);
  }
  // Thư ký cũng không thêm được dòng Phần I–III cho việc chỉ có ở Phần IV (960).
  const f2 = view('secr', base); f2.risks.push({ key: 'm960', itemId: 960, task: 'x', status: 'Vướng', cause: 'c', ownerIds: [50] });
  const r2 = submit('secr', f2, base);
  assert.equal(listOf(r2.fin, 960), 'plans'); assert.equal(r2.ignored, 1);
});

test('Vòng 6 — mục 2 (K3): lỗi "trùng tên" chỉ xét dòng người gửi xem được / sửa được — không xác nhận việc kín tồn tại', () => {
  const base = baseReport();
  const free = t => ({ key: `f${t.length}`, itemId: null, task: t, source: 'Phát sinh', ownerIds: [50], due: '2026-11-06', status: 'Đúng tiến độ', pct: 10, next: 'x' });
  for (const t of [TITLES[950], TITLES[950].toUpperCase(), `  ${TITLES[900]}  `, 'Việc không tồn tại (giả)']) {
    const f = view('staff', base); f.ongoing.push(free(t));
    const r = submit('staff', f, base);
    assert.deepEqual(r.errors, [], t); // cùng phản hồi cho tên việc kín và tên không tồn tại
  }
  const f = view('staff', base); f.ongoing.push(free(TITLES[101].toUpperCase()));
  assert.match(submit('staff', f, base).errors.join(), /đã có dòng gắn việc/); // việc mình xem được → vẫn hướng sửa đúng dòng
});

test('Vòng 6 — mục 3 (K1): % hạng mục MTL của dòng tự bổ sung / dòng người gửi không xem được do máy tính; % gửi lên khác bị bỏ và có báo', () => {
  world = {};
  const s1 = submit('staff', fill(prefillOf('staff')), null);
  assert.deepEqual(s1.errors, []); assert.equal(rowOf(s1.fin, 990).auto, true); assert.equal(rowOf(s1.fin, 990).pct, 20);
  world = { 990: { progress: 80 } };
  const s2 = submit('staff', view('staff', s1.fin), s1.fin);
  assert.equal(rowOf(s2.fin, 990).pct, 80); assert.notEqual(rowOf(s2.fin, 990).status, 'Chậm');
  const hf = view('head', s2.fin); rowOf(hf, 990).pct = 70;
  const h = submit('head', hf, s2.fin);
  assert.equal(rowOf(h.fin, 990).pct, 80); assert.equal(h.ignored, 1);
  // Nháp cũng vậy.
  const dd = draft('head', hf, s2.fin);
  assert.equal(rowOf(dd.data, 990).pct, 80); assert.equal(dd.ignored, 1);
  world = {};
});

test('Vòng 6 — mục 5 (K1): Phần I / II / III do máy quyết mọi hướng, kể cả với thư ký và việc không xem được', () => {
  const base = baseReport();
  const moved = who => { const f = view(who, base); for (const k of ['ongoing', 'risks']) { f.results.push(...f[k].filter(r => r.itemId)); /* chỉ đổi phần, giữ tình trạng / % */ f[k] = f[k].filter(r => !r.itemId); } return f; };
  for (const who of ['staff', 'head', 'secr']) {
    const r = submit(who, moved(who), base);
    assert.deepEqual(r.errors, [], who);
    for (const id of [101, 900, 950, 970]) assert.equal(listOf(r.fin, id), 'ongoing', `${who} ${id}`);
    assert.equal(listOf(r.fin, 901), 'risks', `${who} 901`);
    assert.deepEqual(kpis(r.fin), kpis(base), who);
  }
  // Ngược lại: việc chưa bắt đầu, quá hạn đặt ở Phần II → máy chuyển về Phần III.
  const f = view('head', base); const x = rowOf(f, 901); f.risks = f.risks.filter(r => r !== x); f.ongoing.push({ ...x, next: 'x' });
  assert.equal(listOf(submit('head', f, base).fin, 901), 'risks');
});

test('Vòng 6 — mục 6 (K1): tuần đã họp đóng băng — gửi lại sau họp không bỏ dòng vì việc bị lưu trữ, không tính lại trường máy', () => {
  const base = baseReport();
  const before = kpis(base);
  world = { 101: { archived: true }, 950: { state: { category: 'COMPLETED' }, progress: 100, completedAt: d('2026-11-03') } };
  const f = view('secr', base); rowOf(f, 950).solution = 'Kết luận họp (thư ký ghi)';
  const r = submit('secr', f, base, { day: new Date('2026-11-03T10:00:00+07:00'), frozen: true });
  assert.deepEqual(r.errors, []);
  assert.equal(listOf(r.fin, 101), 'ongoing'); assert.deepEqual(kpis(r.fin), before);
  assert.equal(listOf(r.fin, 950), 'ongoing'); assert.equal(rowOf(r.fin, 950).pct, rowOf(base, 950).pct); // đóng băng theo bản nộp
  assert.equal(rowOf(r.fin, 950).solution, 'Kết luận họp (thư ký ghi)'); // trường người nhập vẫn sửa được
  // Tuần đang mở thì dòng việc đã lưu trữ bị bỏ và có báo (removed).
  const open = submit('head', view('head', base), base);
  assert.equal(listOf(open.fin, 101), '-'); assert.equal(open.removed, 1);
  world = {};
});

test('Vòng 6 — mục 7 (K5): kết luận giao ban của yêu cầu hỗ trợ bị ẩn không đến người xem', () => {
  const base = baseReport();
  const sum = sumOf(base);
  const helpKey = sum.helps.flatMap(g => g.list).find(h => h.itemId === 950).key;
  sum.meeting = { conclusions: { [helpKey]: { decision: 'ASSIGN', departmentId: 1, note: `Giao Ban A xử lý ${TITLES[950]}` } } };
  const headB = WK.summaryView(sum, { full: false, departmentId: 2, canSee: () => false, isSecret: id => SECRET.has(id) });
  assert.deepEqual(headB.view.meeting.conclusions, {}); assert.equal(JSON.stringify(headB).includes(TITLES[950]), false);
  const headA = WK.summaryView(sum, { full: false, departmentId: 1, canSee: id => VIS.head.has(id), isSecret: id => SECRET.has(id) });
  assert.ok(headA.view.meeting.conclusions[helpKey]);
  assert.equal(headA.text.includes(TITLES[950]), false); // email: việc kín không nêu tên, kể cả kết luận
});

test('Vòng 6 — mục 8 (K4): thư ký bỏ dòng của việc mình không xem được → máy chủ giữ dòng và BÁO LẠI; nhân viên bỏ dòng ẩn (không có trên biểu mẫu) không bị báo', () => {
  const base = baseReport();
  const f = view('secr', base); f.ongoing = f.ongoing.filter(r => r.itemId !== 950);
  for (const r of [submit('secr', f, base), draft('secr', f, base)]) {
    assert.equal(listOf(r.fin || r.data, 950), 'ongoing'); assert.equal(r.ignored, 1);
  }
  const s = submit('staff', view('staff', base), base);
  assert.equal(s.ignored, 0); assert.equal(listOf(s.fin, 950), 'ongoing');
});

test('Vòng 6 — KHUNG: mọi vai × mọi đường × mọi kiểu gửi → (a) không lộ tên / không xác nhận tồn tại, (b) trường máy tính đúng theo việc, (c) thay đổi bị bỏ đều có báo', () => {
  const base = baseReport();
  const attacks = {
    'không đổi': f => f,
    'ghi đè giải trình dòng ẩn': f => { f.ongoing.push({ key: 'a', itemId: 950, task: 'x', status: 'Vướng', cause: 'ghi đè', helpFrom: 'BGD', helpWhat: 'w', helpBy: '2026-11-05', ownerIds: [50] }); return f; },
    'đoán itemId mới': f => { f.ongoing.push({ key: 'b', itemId: 980, task: 'x', status: 'Đúng tiến độ', ownerIds: [50], next: 'n' }); return f; },
    'thêm Phần IV việc ẩn': f => { f.plans.push({ key: 'c', itemId: 960, task: 'x', basis: 'KH tháng', ownerIds: [50], due: '2026-11-06', output: 'o' }); return f; },
    'sửa tên / hạn / % dòng': f => { for (const r of WK.allRows(f).filter(r => r.itemId)) Object.assign(r, { task: 'Tên sửa tay', due: '2027-01-01', risk: null, riskNote: '' }); return f; },
    'chuyển phần': f => { for (const r of [...f.ongoing].filter(r => r.itemId)) { f.ongoing.splice(f.ongoing.indexOf(r), 1); f.results.push({ ...r, status: 'Hoàn thành' }); } return f; },
    'dòng tự do trùng tên việc kín': f => { f.ongoing.push({ key: 'e', itemId: null, task: TITLES[901], source: 'Phát sinh', ownerIds: [50], due: '2026-11-06', status: 'Đúng tiến độ', pct: 10, next: 'n' }); return f; },
  };
  const all = new Map(items().map(i => [i.id, i]));
  let runs = 0;
  for (const who of ['staff', 'head', 'secr']) for (const path of ['draft', 'submit']) for (const [name, attack] of Object.entries(attacks)) {
    runs++;
    const label = `${who} · ${path} · ${name}`;
    const r = path === 'draft' ? draft(who, attack(view(who, base)), base) : submit(who, attack(view(who, base)), base);
    const out = r.fin || r.data;
    // (a) không lộ tên với chính người gửi (phản hồi + lỗi), không xác nhận tồn tại.
    const shown = view(who, out); for (const k of ['results', 'ongoing', 'risks']) shown[k] = shown[k].filter(x => x.itemId); // dòng tự do: chữ người gửi tự gõ
    assert.deepEqual(leaks(who, { data: shown, errors: r.errors || [] }), [], label);
    if (who === 'staff') assert.equal((r.errors || []).some(e => /lô D|lô C|Kỷ luật|Thương lượng|công ty Z|MTL kín/.test(e)), false, label);
    // (b) trường máy tính của mọi dòng gắn việc = theo việc.
    // (Trưởng phòng xem được hạng mục MTL 990 → % do họ ghi là hợp lệ, ghi ngược MTL; bỏ qua khi so trường máy tính.)
    for (const row of WK.allRows(out).filter(x => x.itemId && !(who === 'head' && x.itemId === 990))) {
      const i = all.get(row.itemId);
      assert.equal(row.task, i.title, `${label} · ${row.itemId} tên`);
      assert.equal(row.due, WK.dayOf(i.baselineEnd || i.dueDate), `${label} · ${row.itemId} hạn`);
      assert.equal(row.risk || null, i.done ? null : (i.risk?.code || (row.risk === 'PLAN_NOT_STARTED' ? 'PLAN_NOT_STARTED' : null)), `${label} · ${row.itemId} nguy cơ`);
      const place = row.status === WK.DONE ? 'results' : WK.rowStarted(row) ? 'ongoing' : 'risks';
      assert.equal(listOf(out, row.itemId).split(',').filter(k => k !== 'plans')[0], place, `${label} · ${row.itemId} phần`);
    }
    if (who !== 'head') assert.equal(listOf(out, 980), '-', label); // trưởng phòng xem được 980 → được thêm (K2)
    // (c) thay đổi trái quyền bị bỏ → có báo.
    if (who !== 'head' && ['ghi đè giải trình dòng ẩn', 'thêm Phần IV việc ẩn'].includes(name) && who === 'staff') assert.ok(r.ignored > 0, label);
    if (name === 'đoán itemId mới' && who !== 'head') assert.ok(r.ignored > 0, label);
  }
  assert.equal(runs, 42);
});

test('Vòng 6 — mục 4: nộp kiểm xung đột kể cả khi mở trang lúc CHƯA có báo cáo (baseUpdatedAt = null) — như lưu nháp', () => {
  const saved = { updatedAt: new Date('2026-10-30T10:00:00+07:00') };
  assert.equal(WS.isStale({ baseUpdatedAt: null }, saved), true); // mở trang khi chưa có nháp, nay đã có nháp của trưởng phòng → 409
  assert.equal(WS.isStale({ baseUpdatedAt: null }, null), false); // vẫn chưa có báo cáo → nộp được
  assert.equal(WS.isStale({ baseUpdatedAt: saved.updatedAt.toISOString() }, saved), false);
  assert.equal(WS.isStale({ baseUpdatedAt: '2026-10-30T02:59:00.000Z' }, saved), true);
  assert.equal(WS.isStale({}, saved), false); // không có khoá (công cụ cũ / e2e gửi thẳng): giữ cách cũ
});
