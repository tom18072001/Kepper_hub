// Báo cáo tuần — nghiệm thu PR #40 vòng 4: QUY TẮC GỐC cho mọi đường lưu (nháp, tự lưu, nộp, gửi lại, MCP kepper_save_weekly_draft):
// "Một dòng gắn việc chỉ được THÊM / SỬA / XOÁ bởi người xem được việc đó. Mọi lần lưu GỘP theo itemId với bản đã lưu: dòng của việc người
// thao tác không xem được giữ NGUYÊN — mọi phần I–IV, mọi trường, đúng phần cũ. Hiển thị lọc theo NGƯỜI XEM."
// + yêu cầu hỗ trợ lọc theo người xem; việc thuộc dự án KÍN không nêu tên trong bản email / bản tóm tắt cho bộ phận khác.
// Gọi ĐÚNG các hàm của routes/weekly.js (services/weekly-submit.js, WK.viewFor, WK.summaryView). Dữ liệu GIẢ, ngày CỐ ĐỊNH.
const test = require('node:test');
const assert = require('node:assert/strict');
const WK = require('./weekly');
const WS = require('./weekly-submit');
const A = require('./alerts');
const M = require('./mtl');

const F = '2026-10-30';
const d = s => new Date(`${s}T00:00:00+07:00`), end = s => new Date(`${s}T23:59:59+07:00`);
const FRI = new Date('2026-10-30T10:00:00+07:00'), FRI_PM = new Date('2026-10-30T16:00:00+07:00'), MON = new Date('2026-11-02T07:00:00+07:00');
const task = (id, due, cat, progress, extra = {}) => ({ id, kind: 'TASK', code: `SO-${id}`, projectKey: 'SO', title: `Việc ${id} (giả)`, parentId: null, startDate: null, dueDate: due ? end(due) : null,
  state: { category: cat }, progress, startedAt: null, progressAt: null, returnedAt: null, completedAt: null, assignees: [{ id: 50 }], leadDepartmentId: 1, children: 0, ...extra });
const prep = items => items.map(i => { const done = M.isDone(i); return { ...i, done, cancelled: M.isCancelled(i), actual: i.progress, started: A.isStarted(i), risk: done ? null : A.riskOf(i, { day: FRI }) }; });
// Ban A (bộ phận 1): nhân viên 50, trưởng phòng 60. Thư ký (bộ phận 3) không xem được việc nào của Ban A.
const HEAD_ONLY = { assignees: [{ id: 60 }] };
const ITEMS = () => prep([
  task(101, '2026-12-15', 'STARTED', 20), // dự án phòng (thường), nhân viên xem được
  task(900, '2026-12-20', 'STARTED', 30, { ...HEAD_ONLY, title: 'Đàm phán giá đất lô C (giả)' }), // sổ giao việc (kín)
  task(901, '2026-10-27', 'UNSTARTED', 0, { ...HEAD_ONLY, title: 'Nộp hồ sơ đấu giá lô D (giả)' }), // sổ giao việc (kín), trễ hạn
  task(950, '2026-12-10', 'STARTED', 20, { ...HEAD_ONLY, title: 'Kỷ luật nhân sự X (kín, giả)' }), // dự án "Chỉ thành viên" (kín)
  task(960, '2026-11-20', 'UNSTARTED', 0, { ...HEAD_ONLY, title: 'Thương lượng hợp đồng Y (giả)', startDate: d('2026-11-03') }), // kế hoạch tuần mới
]);
const SECRET = new Set([900, 901, 950]);
const STAFF = new Set([101]), HEAD = new Set([101, 900, 901, 950, 960]), SECRETARY = new Set();
const members = new Set([50, 60]);
const ctxOf = (seen, items) => ({ userIds: new Set([50, 60]), deptIds: new Set([1, 2]), itemIds: new Set(seen.map(i => i.id)), taskIds: new Set(seen.map(i => i.id)), items: seen, deptName: () => '' });
const fill = x => { for (const r of WK.allRows(x)) Object.assign(r, { ownerIds: r.ownerIds?.length ? r.ownerIds : [50], next: r.next || 'Tiếp tục (giả)', cause: r.cause || 'Nguyên nhân (giả)', solution: r.solution || 'Giải pháp (giả)', helpFrom: r.helpFrom || 'SELF' });
  for (const p of x.plans) Object.assign(p, { ownerIds: p.ownerIds?.length ? p.ownerIds : [60], output: p.output || 'Đầu ra (giả)' }); return x; };
const prefillOf = visible => WK.buildPrefill({ week: F, deptId: 1, items: ITEMS().filter(i => visible.has(i.id)), memberIds: members });
// Lưu nháp như PUT /api/weekly/report; nộp / gửi lại như POST /api/weekly/submit.
const saveDraft = (visible, raw, saved) => WS.mergeDraft(raw, ctxOf(ITEMS().filter(i => visible.has(i.id))), saved);
function submit(visible, raw, saved) {
  const items = ITEMS(), seen = items.filter(i => visible.has(i.id)), prefill = prefillOf(visible);
  const { data, errors, autoIds, held } = WS.prepareSubmit({ raw, ctx: ctxOf(seen), prefill, now: FRI_PM, week: F, saved, scopeItems: items });
  if (errors.length) return { errors, data };
  const full = WK.buildPrefill({ week: F, deptId: 1, items, memberIds: members });
  return { errors, fin: WS.finishSubmit(data, F, { full, visibleIds: new Set(seen.map(i => i.id)), parentOf: new Map(items.map(i => [i.id, i.parentId])), autoIds }, held).final };
}
const view = (data, visible) => WK.viewFor(structuredClone(data), id => visible.has(id)); // trang báo cáo của người xem (không phải người xem đầy đủ)
const rowOf = (x, id) => WK.allRows(x).find(r => r.itemId === id);
const listOf = (x, id) => ['results', 'ongoing', 'risks', 'plans'].filter(k => (x[k] || []).some(r => r.itemId === id)).join(',') || '-';
const sumOf = data => WK.buildSummary({ week: F, depts: [{ id: 1, name: 'Ban A (giả)' }, { id: 2, name: 'Ban B (giả)' }],
  reports: [{ departmentId: 1, firstSubmittedAt: FRI_PM, submittedAt: FRI_PM, submitCount: 1, submittedById: 60, data }], notices: [], now: MON });
// Trưởng phòng lập và nộp: dòng 950 "Vướng" kèm giải pháp + đề nghị Ban GĐ hỗ trợ; Phần IV có việc 960.
function headSubmits() {
  const p = fill(prefillOf(HEAD));
  Object.assign(rowOf(p, 950), { status: 'Vướng', cause: 'Chờ hội đồng (giả)', solution: 'Họp lại thứ Hai (giả)', helpFrom: 'BGD', helpWhat: 'Ban GĐ chủ trì họp (giả)', helpBy: '2026-11-05' });
  const r = submit(HEAD, p, null);
  assert.deepEqual(r.errors, []);
  return r.fin;
}

test('Vòng 4 — A: gửi lại của người không xem được việc giữ NGUYÊN Phần IV (và Phần I–III) của việc đó', () => {
  const h1 = headSubmits();
  assert.equal(listOf(h1, 960), 'plans'); assert.equal(listOf(h1, 950), 'ongoing');
  for (const [who, vis] of [['nhân viên', STAFF], ['thư ký', SECRETARY]]) {
    const form = vis === SECRETARY ? structuredClone(h1) : view(h1, vis); // thư ký xem tổng hợp đầy đủ → thấy mọi dòng
    form.other = `${who} gửi lại (giả)`;
    const r = submit(vis, form, h1);
    assert.deepEqual(r.errors, [], who);
    assert.equal(listOf(r.fin, 960), 'plans', who); assert.deepEqual(r.fin.plans.find(x => x.itemId === 960), h1.plans.find(x => x.itemId === 960), who);
    assert.deepEqual(rowOf(r.fin, 950), rowOf(h1, 950), who); assert.equal(listOf(r.fin, 950), 'ongoing', who);
  }
});

test('Vòng 4 — B: bản NHÁP hai người cùng sửa — người xem được ít hơn tự lưu / nộp không xoá dòng của người kia; trưởng phòng vẫn khôi phục được', () => {
  const tp = fill(prefillOf(HEAD));
  Object.assign(rowOf(tp, 950), { status: 'Vướng', cause: 'Chờ hội đồng (giả)', solution: 'Họp lại thứ Hai (giả)', helpFrom: 'SELF' });
  const d1 = saveDraft(HEAD, tp, null);
  // Nhân viên mở nháp (chỉ thấy dòng của mình), sửa, tự lưu.
  const sv = view(d1, STAFF); sv.other = 'Nhân viên tự lưu (giả)';
  assert.equal(JSON.stringify(sv).includes('Kỷ luật'), false);
  const d2 = saveDraft(STAFF, sv, d1);
  for (const id of [950, 900, 901, 960]) { assert.deepEqual(rowOf(d2, id) || d2.plans.find(x => x.itemId === id), rowOf(d1, id) || d1.plans.find(x => x.itemId === id), `nháp giữ ${id}`); assert.equal(listOf(d2, id), listOf(d1, id)); }
  assert.equal(d2.other, 'Nhân viên tự lưu (giả)');
  // Nhân viên nộp bản nháp đó → 950 vẫn "Vướng" + giải pháp, 960 vẫn ở Phần IV.
  const r = submit(STAFF, fill(view(d2, STAFF)), d2);
  assert.deepEqual(r.errors, []);
  assert.equal(rowOf(r.fin, 950).status, 'Vướng'); assert.equal(rowOf(r.fin, 950).solution, 'Họp lại thứ Hai (giả)'); assert.equal(rowOf(r.fin, 950).auto, undefined);
  assert.equal(listOf(r.fin, 960), 'plans');
  // Trưởng phòng gửi lại, sửa giải pháp của dòng mình xem được → nhận.
  const tf = view(r.fin, HEAD); rowOf(tf, 950).solution = 'Họp với công đoàn (giả)';
  const r2 = submit(HEAD, tf, r.fin);
  assert.deepEqual(r2.errors, []); assert.equal(rowOf(r2.fin, 950).solution, 'Họp với công đoàn (giả)');
});

test('Vòng 4 — C + quy tắc gốc: người KHÔNG xem được việc gửi MỌI kiểu dữ liệu sửa dòng của việc đó → bản lưu không đổi, không sinh yêu cầu hỗ trợ', () => {
  const h1 = headSubmits();
  const attacks = {
    'ghi đè giải trình / tình trạng / đề nghị hỗ trợ': x => x.ongoing.push({ key: 'm950', itemId: 950, task: 'x', status: 'Vướng', cause: 'Nhân viên ghi đè (giả)', solution: 's', helpFrom: 'D2', helpWhat: 'w', helpBy: '2026-11-04', ownerIds: [50] }),
    'khoá dòng khác': x => x.risks.push({ key: 'zz', itemId: 950, task: 'x', status: 'Hoàn thành', pct: 100, ownerIds: [50] }),
    'chuyển phần': x => x.results.push({ key: 'm950', itemId: 950, task: 'x', status: 'Hoàn thành', ownerIds: [50] }),
    'giả cờ tự bổ sung': x => x.ongoing.push({ key: 'm950', itemId: 950, task: 'x', auto: true, status: 'Chậm', ownerIds: [50] }),
    'sửa / xoá Phần IV': x => { x.plans.push({ key: 'p', itemId: 960, task: 'Sửa IV (giả)', basis: 'KH tháng', ownerIds: [50], due: '2026-11-06', output: 'o' }); },
    'dòng tự bổ sung / sổ giao việc': x => x.risks.push({ key: 'm901', itemId: 901, task: 'x', status: 'Vướng', cause: 'c', solution: 's', helpFrom: 'BGD', helpWhat: 'w', helpBy: '2026-11-04', ownerIds: [50] }),
    'việc ngoài báo cáo (đoán id)': x => x.ongoing.push({ key: 'g', itemId: 777, task: 'Đoán (giả)', status: 'Vướng', cause: 'c', solution: 's', helpFrom: 'BGD', helpWhat: 'w', helpBy: '2026-11-04', ownerIds: [50] }),
  };
  for (const [name, attack] of Object.entries(attacks)) {
    for (const [who, vis] of [['nhân viên', STAFF], ['thư ký', SECRETARY]]) {
      const form = view(h1, vis); attack(form);
      const r = submit(vis, form, h1);
      assert.deepEqual(r.errors.filter(e => /Kỷ luật|lô D|Thương lượng|Đoán/.test(e)), [], `${who} · ${name}: lỗi không nêu tên`);
      const fin = r.fin || r.data;
      for (const id of [950, 900, 901]) assert.deepEqual(rowOf(fin, id), rowOf(h1, id), `${who} · ${name}: dòng ${id}`);
      assert.deepEqual(fin.plans.filter(p => p.itemId === 960), h1.plans.filter(p => p.itemId === 960), `${who} · ${name}: Phần IV`);
      assert.equal(WK.allRows(fin).some(x => x.itemId === 777), false);
      const helps = sumOf(fin).helps.flatMap(g => g.list);
      assert.deepEqual(helps.map(h => h.itemId), [950], `${who} · ${name}: chỉ yêu cầu hỗ trợ trưởng phòng ghi`);
      assert.equal(helps[0].what, 'Ban GĐ chủ trì họp (giả)');
    }
  }
  // Lưu nháp cùng quy tắc.
  const d0 = saveDraft(HEAD, fill(prefillOf(HEAD)), null);
  const evil = view(d0, STAFF); attacks['ghi đè giải trình / tình trạng / đề nghị hỗ trợ'](evil); attacks['sửa / xoá Phần IV'](evil);
  const d1 = saveDraft(STAFF, evil, d0);
  assert.deepEqual(rowOf(d1, 950), rowOf(d0, 950)); assert.deepEqual(d1.plans.filter(p => p.itemId === 960), d0.plans.filter(p => p.itemId === 960));
});

test('Vòng 4 — D + E: yêu cầu hỗ trợ và mục nguy cơ lọc theo người xem; việc dự án KÍN không nêu tên trong email / bản tóm tắt bộ phận khác, bất kể ai lập', () => {
  const h1 = headSubmits(); // trưởng phòng lập: 901 (sổ giao việc) là dòng thường, 950 (Chỉ thành viên) có đề nghị hỗ trợ
  assert.equal(rowOf(h1, 901).auto, undefined);
  const sum = sumOf(h1), isSecret = id => SECRET.has(id);
  const gd = WK.summaryView(sum, { full: true, departmentId: null, isSecret });
  const headB = WK.summaryView(sum, { full: false, departmentId: 2, canSee: () => false, isSecret });
  const headA = WK.summaryView(sum, { full: false, departmentId: 1, canSee: id => HEAD.has(id), isSecret });
  const SECRETS = ['Kỷ luật nhân sự X', 'Ban GĐ chủ trì họp', 'lô D', 'lô C'];
  // Bản email (mọi người sao chép, gửi mọi trưởng bộ phận): không nêu tên việc kín, kể cả yêu cầu hỗ trợ; vẫn đếm.
  for (const v of [gd, headB, headA]) {
    for (const t of SECRETS) assert.equal(v.text.includes(t), false, t);
    assert.ok(v.text.includes("Ban A (giả) → Ban Giám đốc: (việc không nêu tên — xem trong Kepler Hub), cần trước 05/11"), v.text.slice(v.text.indexOf("YÊU CẦU")));
  }
  for (const v of [gd, headA]) assert.ok(v.text.includes('dự án kín / không nêu tên')); // mục nguy cơ: đếm, không tên (trưởng Ban B chỉ nhận nguy cơ của Ban B)
  // Bản tóm tắt trưởng Ban B (cũng là dữ liệu MCP kepper_weekly_summary trả về): không tên, không mã việc.
  const bJson = JSON.stringify(headB.view);
  for (const t of SECRETS) assert.equal(bJson.includes(t), false, t);
  assert.equal(bJson.includes('"key":"1:m950"'), false);
  // Trưởng Ban A (vốn xem được việc): thấy trên trang Tổng hợp của mình.
  assert.ok(JSON.stringify(headA.view.helps).includes('Ban GĐ chủ trì họp (giả)'));
  // Ban GĐ / thư ký (bản đầy đủ trong Hub): thấy đủ.
  assert.ok(JSON.stringify(gd.view.helps).includes('Kỷ luật nhân sự X (kín, giả)'));
  // Việc dự án thường vẫn nêu tên ở mục nguy cơ chậm (quyết định "Bản tóm tắt").
  const open = WK.summaryView(sum, { full: true, isSecret: () => false });
  assert.ok(open.text.includes('Nộp hồ sơ đấu giá lô D (giả) — Trễ hạn'));
});

test('Vòng 4 — điểm nhỏ: mục nguy cơ ẩn tên trong bản tóm tắt không giữ key / mã việc', () => {
  const sum = sumOf(headSubmits());
  const v = WK.summaryView(sum, { full: false, departmentId: 1, canSee: () => false });
  const hidden = v.view.risks.filter(x => x.hidden);
  assert.ok(hidden.length > 0);
  for (const x of hidden) { assert.equal(x.key, undefined); assert.equal(x.itemId, null); assert.equal(x.task, ''); }
});

test('Vòng 4 — một việc vừa có dòng Phần I–III vừa có kế hoạch Phần IV: cả hai được giữ (người xem được việc lưu, và khi người khác gửi lại)', () => {
  const p = fill(prefillOf(HEAD));
  p.plans.push({ key: 'k950', itemId: 950, task: 'Kỷ luật nhân sự X (kín, giả)', basis: 'Công việc', ownerIds: [60], due: '2026-11-06', output: 'Quyết định (giả)' });
  const d1 = saveDraft(HEAD, p, null);
  assert.equal(listOf(d1, 950), 'ongoing,plans');
  const d2 = saveDraft(STAFF, view(d1, STAFF), d1);
  assert.equal(listOf(d2, 950), 'ongoing,plans');
  const r = submit(STAFF, fill(view(d2, STAFF)), d2);
  assert.deepEqual(r.errors, []); assert.equal(listOf(r.fin, 950), 'ongoing,plans');
  // Trùng trong cùng phần vẫn gộp: hai dòng Phần IV cùng việc → một.
  const dup = fill(prefillOf(HEAD)); dup.plans.push({ ...dup.plans.find(x => x.itemId === 960), key: 'dup' });
  assert.equal(saveDraft(HEAD, dup, null).plans.filter(x => x.itemId === 960).length, 1);
});
