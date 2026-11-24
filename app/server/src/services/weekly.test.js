const test = require('node:test');
const assert = require('node:assert/strict');
const WK = require('./weekly');

// Dữ liệu GIẢ. Tuần báo cáo: thứ Sáu 30/10/2026 (T2 26/10 – T6 30/10); tuần mới 02/11 – 06/11.
const F = '2026-10-30';
const d = s => new Date(`${s}T00:00:00+07:00`);
const end = s => new Date(`${s}T23:59:59+07:00`);
const M = require('./mtl');
const A = require('./alerts');
// Ngày cố định (không phụ thuộc hôm nay): 10:00 thứ Sáu 30/10/2026, giờ VN.
const NOW = new Date('2026-10-30T10:00:00+07:00');
// Hạng mục MTL giả (cat = cột trạng thái, progress = %), và việc thường giả (kind TASK, chỉ có startDate / dueDate).
const mtl = (id, s, e, cat = 'STARTED', progress = 40, extra = {}) => ({ id, kind: 'MTL', code: `DA-${id}`, projectKey: 'DA', planCode: String(id), title: `Hạng mục ${id} (giả)`, parentId: null,
  baselineStart: s ? d(s) : null, baselineEnd: e ? end(e) : null, state: { category: cat }, progress, startedAt: null, progressAt: null, completedAt: null, assignees: [], leadDepartmentId: 1, ...extra });
const task = (id, due, cat = 'UNSTARTED', progress = 0, extra = {}) => ({ id, kind: 'TASK', code: `CV-${id}`, projectKey: 'CV', title: `Việc ${id} (giả)`, parentId: null, startDate: null, dueDate: due ? end(due) : null,
  state: { category: cat }, progress, startedAt: null, progressAt: null, returnedAt: null, completedAt: null, assignees: [], leadDepartmentId: 1, ...extra });
// Tính sẵn như routes/weekly.js: trạng thái MTL (M.statusOf), "đã bắt đầu" và "nguy cơ chậm" (services/alerts.js — một định nghĩa).
function prep(items, day = NOW) {
  const cfg = M.DEFAULT_ALERTS;
  return items.map(i => {
    const done = M.isDone(i), cancelled = M.isCancelled(i), actual = i.progress;
    if (i.kind === 'TASK') return { ...i, done, cancelled, actual, started: A.isStarted(i), risk: done ? null : A.riskOf(i, { day }) };
    const st = M.statusOf(i, actual, day, cfg);
    return { ...i, done, cancelled, actual, status: st.code, started: A.isStarted(i, actual), risk: A.riskOf(i, { st, cfg, day }) };
  });
}
const item = (id, s, e, extra = {}) => prep([mtl(id, s, e, 'STARTED', 40, extra)])[0];

test('tuần theo giờ VN: thứ Sáu của tuần, mốc hạn nộp / nộp muộn / giao ban, đổi khi nghỉ lễ', () => {
  assert.equal(WK.currentFriday(new Date('2026-10-26T09:00:00+07:00')), F); // thứ Hai
  assert.equal(WK.currentFriday(new Date('2026-10-30T23:59:00+07:00')), F); // thứ Sáu
  assert.equal(WK.currentFriday(new Date('2026-10-31T10:00:00+07:00')), F); // thứ Bảy → thứ Sáu vừa qua
  assert.equal(WK.currentFriday(new Date('2026-11-01T10:00:00+07:00')), F); // Chủ nhật
  assert.equal(WK.currentFriday(new Date('2026-10-30T17:30:00Z')), '2026-10-30'); // 00:30 thứ Bảy giờ VN vẫn là tuần 30/10
  const S = WK.scheduleOf(F);
  assert.equal(S.from, '2026-10-26'); assert.equal(S.meetingDay, '2026-11-02'); assert.equal(S.nextTo, '2026-11-06');
  assert.equal(S.deadline.toISOString(), new Date('2026-10-30T17:30:00+07:00').toISOString());
  assert.equal(S.grace.toISOString(), new Date('2026-10-31T12:00:00+07:00').toISOString());
  const H = WK.scheduleOf(F, { data: { deadlineDay: '2026-10-29', meetingDay: '2026-11-03' } }); // thứ Sáu nghỉ → nộp thứ Năm; thứ Hai nghỉ → họp thứ Ba
  assert.equal(H.deadline.toISOString(), new Date('2026-10-29T17:30:00+07:00').toISOString());
  assert.equal(H.grace.toISOString(), new Date('2026-10-30T12:00:00+07:00').toISOString());
  assert.equal(H.meetingAt.toISOString(), new Date('2026-11-03T08:30:00+07:00').toISOString());
  assert.equal(WK.isFriday('2026-10-30'), true); assert.equal(WK.isFriday('2026-10-29'), false);
});

test('điểm danh / phát hành kết luận chỉ mở từ giờ giao ban (08:30 ngày họp, theo ngày họp đã đổi)', () => {
  const S = WK.scheduleOf(F); // giao ban 08:30 T2 02/11
  assert.equal(WK.meetingStarted(S, new Date('2026-10-29T10:00:00+07:00')), false); // thứ Năm trước buổi họp
  assert.equal(WK.meetingStarted(S, new Date('2026-11-02T08:29:59+07:00')), false);
  assert.equal(WK.meetingStarted(S, new Date('2026-11-02T08:30:00+07:00')), true);
  assert.equal(WK.meetingStarted(S, new Date('2026-11-09T09:00:00+07:00')), true); // tuần đã qua: vẫn mở
  const H = WK.scheduleOf(F, { data: { meetingDay: '2026-11-03' } }); // thứ Hai nghỉ lễ → họp thứ Ba
  assert.equal(WK.meetingStarted(H, new Date('2026-11-02T09:00:00+07:00')), false);
  assert.equal(WK.meetingStarted(H, new Date('2026-11-03T08:30:00+07:00')), true);
  // Lịch đã qua JSON (API → giao diện): meetingAt là chuỗi ISO.
  assert.equal(WK.meetingStarted(JSON.parse(JSON.stringify(S)), new Date('2026-11-02T08:31:00+07:00')), true);
});

test('đang làm / nguy cơ chậm (alerts.isStarted, alerts.riskOf): một định nghĩa, ngày cố định', () => {
  // Đã bắt đầu: đang làm, chờ duyệt, bị trả lại, đã bấm bắt đầu / báo tiến độ, % > 0. Xong / huỷ: không.
  assert.equal(A.isStarted({ state: { category: 'STARTED' }, progress: 0 }), true);
  assert.equal(A.isStarted({ state: { category: 'REVIEW' }, progress: 0 }), true);
  assert.equal(A.isStarted({ state: { category: 'UNSTARTED' }, returnedAt: NOW, progress: 0 }), true);
  assert.equal(A.isStarted({ state: { category: 'BACKLOG' }, progress: 5 }), true);
  assert.equal(A.isStarted({ state: { category: 'UNSTARTED' }, progress: 0 }), false);
  assert.equal(A.isStarted({ state: { category: 'COMPLETED' }, progress: 100 }), false);
  // Việc thường: quá hạn → Trễ hạn; còn ≤ 3 ngày → Sắp đến hạn; còn 4 ngày → không.
  assert.deepEqual(A.riskOf(task(1, '2026-10-20'), { day: NOW }), { code: 'OVERDUE', label: 'Trễ hạn', days: 10 });
  assert.deepEqual(A.riskOf(task(1, '2026-11-02'), { day: NOW }), { code: 'DUE_SOON', label: 'Sắp đến hạn', days: 3 });
  assert.equal(A.riskOf(task(1, '2026-11-03'), { day: NOW }), null);
  assert.equal(A.riskOf(task(1, '2026-10-20', 'COMPLETED', 100), { day: NOW }), null);
  // MTL: cùng mức cảnh báo hằng ngày; "sắp đến hạn" (≤ 7 ngày) chỉ khi % thực tế thấp hơn % kế hoạch.
  const r = (...a) => prep([mtl(...a)])[0].risk?.code ?? null;
  assert.equal(r(1, '2026-10-01', '2026-10-28', 'STARTED', 60), 'OVERDUE');
  assert.equal(r(1, '2026-10-01', '2026-12-31', 'UNSTARTED', 0), 'LATE_START');
  assert.equal(r(1, '2026-10-01', '2026-11-05', 'STARTED', 40), 'BEHIND'); // kế hoạch 83% · thực tế 40%
  assert.equal(r(1, '2026-10-01', '2026-11-05', 'STARTED', 78), 'DUE_SOON'); // lệch −5 điểm (< 10), còn 6 ngày
  assert.equal(r(1, '2026-10-01', '2026-11-05', 'STARTED', 90), null); // vượt kế hoạch, sắp hạn: không phải nguy cơ
  assert.equal(r(1, '2026-10-01', '2026-12-31', 'STARTED', 30), null); // đúng tiến độ, hạn còn xa
  assert.equal(r(1, '2026-10-28', '2026-12-31', 'UNSTARTED', 0), null); // mới tới ngày bắt đầu (trong ân hạn): chưa tính chậm
});

test('điền sẵn 3 phần: xong trong tuần → I · MỌI việc đang làm → II · chưa khởi động mà có nguy cơ chậm → III · chưa bắt đầu → không báo cáo', () => {
  const items = prep([
    mtl(1, '2026-10-01', '2026-10-28', 'STARTED', 60), // đang làm, trễ hạn → II (nguy cơ: Trễ hạn 2 ngày)
    mtl(2, '2026-09-01', '2026-10-15', 'UNSTARTED', 0), // chưa làm, quá hạn → III
    mtl(3, '2026-10-01', '2026-10-31', 'COMPLETED', 100, { completedAt: d('2026-10-27') }), // xong trong tuần → I
    mtl(4, '2026-10-01', '2026-12-31', 'STARTED', 30, { pctAuto: true }), // đang làm, hạn còn xa → II
    mtl(5, '2026-11-02', '2026-11-30', 'UNSTARTED', 0), // bắt đầu tuần sau → IV (kế hoạch)
    mtl(6, '2026-12-01', '2026-12-31', 'UNSTARTED', 0), // chưa tới kỳ → không báo cáo
    mtl(7, '2026-10-01', '2026-12-31', 'STARTED', 40, { leadDepartmentId: 2 }), // bộ phận khác
    mtl(8, '2026-10-01', '2026-12-31'), // có con thuộc bộ phận → chỉ lấy con
    mtl(81, '2026-10-01', '2026-11-30', 'STARTED', 45, { parentId: 8, leadDepartmentId: 2, assignees: [{ id: 50 }] }), // con giao người của bộ phận 1
    mtl(9, '2026-08-01', '2026-09-30', 'COMPLETED', 100, { completedAt: d('2026-09-20') }), // xong từ lâu → không có
    mtl(10, '2026-10-01', '2026-12-31', 'UNSTARTED', 0), // quá ngày bắt đầu, chưa khởi động → III
    mtl(11, '2026-10-01', '2026-11-05', 'STARTED', 40), // đang làm, chậm tiến độ → II
    mtl(12, null, null, 'STARTED', 10), // MTL chưa có kế hoạch gốc nhưng đang làm → II (trước đây bị sót)
    task(13, '2026-11-01', 'REVIEW', 80), // việc thường chờ duyệt, còn 2 ngày → II (nguy cơ: sắp đến hạn)
    task(14, '2026-10-20'), // việc thường chưa làm, quá hạn → III
    task(15, '2026-11-20'), // việc thường chưa làm, hạn xa → không báo cáo
    task(16, '2026-12-15', 'UNSTARTED', 0, { returnedAt: d('2026-10-29') }), // bị trả lại → đang làm → II
    task(17, '2026-10-30', 'COMPLETED', 100, { completedAt: new Date('2026-10-31T09:00:00+07:00') }), // xong thứ Bảy → I
    task(18, '2026-11-05'), // chưa làm, hạn tuần sau → IV
    task(19, '2026-11-02'), // chưa làm, còn 3 ngày → III
  ]);
  const p = WK.buildPrefill({ week: F, deptId: 1, items, memberIds: new Set([50]) });
  assert.deepEqual(p.results.map(r => r.itemId), [17, 3]);
  assert.deepEqual(p.ongoing.map(r => r.itemId), [1, 13, 11, 81, 16, 4, 12]); // có nguy cơ lên trước, rồi theo hạn
  assert.deepEqual(p.risks.map(r => r.itemId), [2, 14, 19, 10]);
  assert.deepEqual(p.plans.map(r => r.itemId), [18, 5]);
  // Không có việc chưa bắt đầu ở I / II.
  for (const r of [...p.results, ...p.ongoing]) assert.notEqual(r.status, 'Chưa bắt đầu');
  const row = id => [...p.results, ...p.ongoing, ...p.risks].find(r => r.itemId === id);
  assert.equal(row(1).status, 'Chậm'); assert.equal(row(1).pct, 60); assert.equal(row(1).pct0, 60); assert.equal(row(1).due, '2026-10-28'); assert.equal(row(1).source, 'MTL');
  assert.equal(row(1).risk, 'OVERDUE'); assert.equal(WK.rowRisk(row(1), F), 'Trễ hạn 2 ngày'); assert.ok(WK.needsIssue(row(1), F));
  assert.equal(WK.rowRisk(row(2), F), 'Trễ hạn 15 ngày'); assert.equal(WK.rowRisk(row(10), F), 'Chậm khởi động');
  assert.equal(WK.rowRisk(row(11), F), 'Chậm tiến độ'); assert.equal(row(11).status, 'Chậm');
  assert.equal(WK.rowRisk(row(4), F), ''); assert.equal(row(4).pctLocked, true); assert.equal(row(4).next, '');
  assert.equal(row(3).status, 'Hoàn thành'); assert.equal(row(3).risk, null);
  const t13 = row(13);
  assert.equal(t13.source, 'Công việc'); assert.equal(t13.ref, 'CV-13'); assert.equal(t13.pctLocked, true); assert.equal(t13.pct, 80); assert.equal(t13.status, 'Đúng tiến độ');
  assert.equal(WK.rowRisk(t13, F), 'Sắp đến hạn (còn 2 ngày)');
  assert.equal(row(14).status, 'Chậm'); assert.equal(WK.rowRisk(row(14), F), 'Trễ hạn 10 ngày');
  assert.deepEqual(row(81).ownerIds, [50]);
  // Danh sách nguy cơ chậm (Phần III cho lãnh đạo): việc đang làm có nguy cơ + việc chưa khởi động có nguy cơ.
  assert.deepEqual(WK.riskRows(p, F).map(r => r.itemId).sort((a, b) => a - b), [1, 2, 10, 11, 13, 14, 19]);
});

test('điền sẵn: kế hoạch tuần trước → I, việc chưa xong → II, Action Log giao ban → I "TGĐ giao"', () => {
  const items = [item(4, '2026-10-01', '2026-12-31')];
  const prev = {
    plans: [{ key: 'p1', task: 'Làm việc với Sở (giả)', basis: 'KH tháng', ownerIds: [50], due: '2026-10-29' }, { key: 'm4', itemId: 4, task: 'x', basis: 'MTL' }],
    results: [{ key: 'r1', task: 'Việc phát sinh chưa xong (giả)', source: 'Phát sinh', status: 'Vướng', ownerIds: [50], due: '2026-10-22', pct: 20 }, { key: 'r2', task: 'Đã xong', status: 'Hoàn thành' }],
    ongoing: [],
  };
  const actions = [{ ref: '2026-10-23:1', task: 'Chốt phương án (giả)', ownerId: 50, due: '2026-10-28', departmentId: 1 }];
  const p = WK.buildPrefill({ week: F, deptId: 1, items, memberIds: new Set([50]), prev, actions });
  assert.deepEqual(p.results.map(r => r.task), ['Chốt phương án (giả)', 'Làm việc với Sở (giả)']); // quá hạn (cần giải trình) lên trước
  const a = p.results.find(r => r.actionRef === '2026-10-23:1');
  assert.equal(a.source, 'TGĐ giao'); assert.deepEqual(a.ownerIds, [50]);
  assert.equal(p.results.find(r => r.key === 'p1').source, 'KH tháng');
  // Kế hoạch tuần trước gắn hạng mục đang làm → Phần II (đúng tình trạng), không lặp.
  assert.deepEqual(p.ongoing.map(r => r.key), ['r1', 'm4']); assert.equal(p.ongoing[0].status, 'Vướng'); assert.equal(p.ongoing[0].cause, '');
  assert.equal(p.ongoing.filter(r => r.itemId === 4).length, 1);
});

test('chuyển tiếp: việc dở tuần trước sang đúng phần tuần này; việc tuần trước đã thành chưa bắt đầu, hết nguy cơ → không báo cáo', () => {
  const items = prep([
    mtl(4, '2026-10-01', '2026-12-31', 'STARTED', 40), // tuần trước ở III (chưa khởi động), nay đã làm → II
    mtl(5, '2026-10-01', '2026-12-31', 'UNSTARTED', 0), // vẫn chưa khởi động → III
    mtl(6, '2026-12-01', '2026-12-31', 'UNSTARTED', 0, { leadDepartmentId: 2 }), // dời kế hoạch, chưa tới kỳ → không báo cáo
    task(7, '2026-10-29', 'COMPLETED', 100, { completedAt: d('2026-10-28'), leadDepartmentId: 2 }), // xong trong tuần (bộ phận khác chủ trì) → I
  ]);
  const prev = { plans: [], results: [], ongoing: [{ key: 'm6', itemId: 6, task: 'x', status: 'Đúng tiến độ' }, { key: 'm7', itemId: 7, task: 'x', status: 'Đúng tiến độ' }],
    risks: [{ key: 'm4', itemId: 4, task: 'x', status: 'Chậm', cause: 'Thiếu người (giả)', solution: 'Bổ sung (giả)' }, { key: 'm5', itemId: 5, task: 'x', status: 'Chậm' }] };
  const p = WK.buildPrefill({ week: F, deptId: 1, items, memberIds: new Set([50]), prev });
  assert.deepEqual(p.ongoing.map(r => r.itemId), [4]); assert.equal(p.ongoing[0].cause, ''); // đúng tiến độ: không chép nguyên nhân
  assert.deepEqual(p.risks.map(r => r.itemId), [5]);
  assert.deepEqual(p.results.map(r => r.itemId), [7]);
  assert.equal([...p.results, ...p.ongoing, ...p.risks, ...p.plans].some(r => r.itemId === 6), false);
});

test('điền sẵn: hạng mục còn chậm nhận lại nguyên nhân / giải pháp tuần trước (đánh dấu để xem lại), không chép đề nghị hỗ trợ', () => {
  const items = prep([mtl(4, '2026-10-01', '2026-12-31', 'STARTED', 10), mtl(5, '2026-10-01', '2026-12-31', 'STARTED', 10)]); // chậm tiến độ
  const prev = { plans: [], ongoing: [
    { key: 'm4', itemId: 4, task: 'x', status: 'Chậm', cause: 'Chờ Sở phản hồi (giả)', solution: 'Bám Sở hằng ngày (giả)', helpFrom: 'BGD', helpWhat: 'Gọi Sở (giả)' },
    { key: 'r9', task: 'Việc phát sinh (giả)', status: 'Vướng', cause: 'Thiếu hồ sơ (giả)', solution: 'Bổ sung (giả)' },
  ], results: [] };
  const p = WK.buildPrefill({ week: F, deptId: 1, items, memberIds: new Set([50]), prev });
  const r4 = p.ongoing.find(r => r.itemId === 4), r5 = p.ongoing.find(r => r.itemId === 5), r9 = p.ongoing.find(r => r.key === 'r9');
  assert.equal(r4.cause, 'Chờ Sở phản hồi (giả)'); assert.equal(r4.solution, 'Bám Sở hằng ngày (giả)'); assert.equal(r4.carried, true);
  assert.equal(r4.helpFrom, ''); assert.equal(r4.helpWhat, '');
  assert.equal(r5.cause, ''); assert.equal(r5.carried, undefined);
  assert.equal(r9.cause, 'Thiếu hồ sơ (giả)');
  assert.equal(WK.sanitize({ ongoing: [r4] }).ongoing[0].carried, undefined); // cờ chỉ để hiển thị, không lưu
});

test('làm sạch + kiểm tra: Chậm / Vướng / Quá hạn bắt buộc nguyên nhân, giải pháp, đề nghị hỗ trợ; ghi ngược % chỉ khi đổi', () => {
  const raw = {
    results: [
      { key: 'm1', itemId: 1, task: 'Hạng mục 1', status: 'Chậm', pct: 70, pct0: 60, due: '2026-10-28', helpFrom: 'D2' },
      { key: 'f1', task: '  Việc phát sinh  ', source: 'Phát sinh', status: 'Đúng tiến độ', pct: 100, ownerIds: [50, 999], due: '2026-11-04' },
      { key: 'm9', itemId: 9, task: 'Không được xem', status: 'Đúng tiến độ', pct: 10, pct0: 0, due: '2026-11-04' },
    ],
    ongoing: [{ key: 'm4', itemId: 4, task: 'Hạng mục 4', status: 'Đúng tiến độ', pct: 30, pct0: 30, due: '2026-12-31', next: '' }],
    plans: [{ key: 'x', task: 'Kế hoạch (giả)', basis: 'Không hợp lệ', ownerIds: [], due: '' }],
    other: 'Kiến nghị (giả)', extra: 'bỏ',
  };
  const data = WK.sanitize(raw, { userIds: new Set([50]), deptIds: new Set([1, 2]), itemIds: new Set([1, 4]) });
  assert.equal(data.results[1].task, 'Việc phát sinh'); assert.equal(data.results[1].status, 'Hoàn thành'); assert.deepEqual(data.results[1].ownerIds, [50]);
  // Không xem được hạng mục 9 → BỎ dòng (không thành dòng tự do giữ nguyên tên việc — nghiệm thu vòng 3).
  assert.equal(data.results.length, 2); assert.equal(data.results.some(r => r.task === 'Không được xem'), false);
  assert.equal(data.plans[0].basis, 'KH tháng'); assert.equal(data.extra, undefined);
  const errs = WK.validate(data, F, { deptName: id => (id === 2 ? 'Ban Tài chính (giả)' : '') });
  assert.ok(errs.some(e => /Hạng mục 1.*Chậm · Quá hạn.*thiếu nguyên nhân/.test(e)));
  assert.ok(errs.some(e => /thiếu giải pháp/.test(e)));
  assert.ok(errs.some(e => /cần Ban Tài chính \(giả\) hỗ trợ việc gì/.test(e)));
  assert.ok(errs.some(e => /Phần II “Hạng mục 4”: ghi việc sẽ làm tuần tới/.test(e)));
  assert.ok(errs.some(e => /Phần IV “Kế hoạch \(giả\)”: thiếu người phụ trách/.test(e)));
  assert.equal(errs.some(e => /Không được xem/.test(e)), false);
  assert.ok(errs.some(e => /Hạng mục 1.*thiếu người phụ trách/.test(e))); // dòng MTL chưa giao người: phải chọn người phụ trách
  Object.assign(data.results[0], { cause: 'Chờ Sở (giả)', solution: 'Đôn đốc (giả)', helpWhat: 'Làm việc với Sở', helpBy: '2026-11-03', ownerIds: [50] });
  data.ongoing[0].next = 'Nộp hồ sơ'; data.ongoing[0].ownerIds = [50]; data.plans[0].ownerIds = [50]; data.plans[0].due = '2026-11-05'; data.plans[0].output = 'Biên bản (giả)';
  assert.deepEqual(WK.validate(data, F), []);
  // Dòng gắn việc (vd. việc thường đã xong, chưa từng đặt hạn): hạn lấy từ việc, không bắt nhập. Dòng tự do vẫn bắt buộc.
  assert.deepEqual(WK.validate({ ...data, results: [...data.results, { key: 'm7', itemId: 7, task: 'Việc thường (giả)', status: 'Hoàn thành', due: '', ownerIds: [50] }] }, F), []);
  assert.ok(WK.validate({ ...data, results: [...data.results, { key: 'f7', itemId: null, task: 'Tự do (giả)', status: 'Hoàn thành', due: '', ownerIds: [50] }] }, F).some(e => /Tự do.*thiếu deadline/.test(e)));
  // Hạng mục bắt buộc (MTL quá hạn, việc TGĐ giao…) không được bỏ khỏi báo cáo.
  assert.ok(WK.validate(data, F, { mandatory: [{ itemId: 77, task: 'Bước găng (giả)', ref: 'DA-77' }] }).some(e => /Không được bỏ “Bước găng \(giả\)” \(DA-77\)/.test(e)));
  assert.deepEqual(WK.writeBacks(data), [{ itemId: 1, pct: 70 }]); // hạng mục 4 không đổi %
  data.results[0].pctLocked = true;
  assert.deepEqual(WK.writeBacks(data), []); // hạng mục có việc nhánh (% tự tính): không ghi ngược
  const fin = WK.finalize(data, F);
  assert.equal(fin.results[0].overdue, true); assert.equal(fin.results[1].cause, '');
});

test('tình trạng nộp theo Điều 6: giờ nộp lần đầu, báo muộn trước hạn, 12:00 thứ Bảy', () => {
  const S = WK.scheduleOf(F);
  const at = s => new Date(s);
  const told = [{ type: 'LATE', createdAt: at('2026-10-30T16:00:00+07:00') }];
  assert.equal(WK.submissionStatus(null, [], S, at('2026-10-30T15:00:00+07:00')).code, 'PENDING');
  assert.equal(WK.submissionStatus(null, told, S, at('2026-10-30T20:00:00+07:00')).code, 'LATE_TOLD_PENDING');
  assert.equal(WK.submissionStatus(null, [], S, at('2026-10-30T20:00:00+07:00')).code, 'LATE_PENDING');
  assert.equal(WK.submissionStatus(null, [], S, at('2026-10-31T12:01:00+07:00')).points, 'NOT_SUBMITTED');
  assert.equal(WK.submissionStatus({ firstSubmittedAt: at('2026-10-30T17:29:00+07:00') }, [], S).code, 'ON_TIME');
  assert.equal(WK.submissionStatus({ firstSubmittedAt: at('2026-10-31T09:00:00+07:00') }, told, S).points, 'LATE_NOTICED');
  assert.equal(WK.submissionStatus({ firstSubmittedAt: at('2026-10-31T09:00:00+07:00') }, [{ type: 'LATE', createdAt: at('2026-10-30T18:00:00+07:00') }], S).points, 'LATE_UNNOTICED');
  assert.equal(WK.submissionStatus({ firstSubmittedAt: at('2026-10-31T13:00:00+07:00') }, told, S).points, 'NOT_SUBMITTED');
});

test('tổng hợp giao ban: gom yêu cầu hỗ trợ theo nơi nhận, Action Log tuần trước, văn bản sao chép không có họ tên', () => {
  const depts = [{ id: 1, name: 'Dự án A (giả)' }, { id: 2, name: 'Tài chính (giả)' }, { id: 3, name: 'Tổng hợp (giả)' }];
  const row = (key, extra) => ({ key, task: `Việc ${key}`, status: 'Đúng tiến độ', due: '2026-11-10', ownerIds: [50], pct: 50, ...extra });
  const reports = [
    { departmentId: 1, firstSubmittedAt: new Date('2026-10-30T16:00:00+07:00'), submittedAt: new Date('2026-10-30T16:00:00+07:00'), submitCount: 2, submittedById: 50,
      data: { results: [row('a', { status: 'Vướng', cause: 'C', solution: 'S', helpFrom: 'BGD', helpWhat: 'Ký văn bản', actionRef: '2026-10-23:1' }), row('b', { due: '2026-10-28', solution: 'S2', helpFrom: 'D2', helpWhat: 'Bố trí vốn' }), row('x', { status: 'Hoàn thành', pct: 100 })],
        ongoing: [row('c', { next: 'Trình ký' }), row('d', { risk: 'BEHIND', riskNote: 'Chậm tiến độ', status: 'Chậm', cause: 'C3', solution: 'S3', helpFrom: 'SELF' })],
        risks: [row('e', { risk: 'LATE_START', riskNote: 'Chậm khởi động', status: 'Chậm', pct: 0, started: false, solution: 'S4', helpFrom: 'SELF' })], plans: [], other: '' } },
    { departmentId: 2, firstSubmittedAt: null, data: { results: [], ongoing: [], plans: [] } },
  ];
  const notices = [{ departmentId: 3, type: 'ABSENT', reason: 'CONG_TAC', note: '', substituteId: 51, createdAt: new Date('2026-10-30T10:00:00+07:00') }];
  const actions = [{ id: 1, ref: '2026-10-23:1', task: 'Chốt phương án', departmentId: 1, ownerId: 50, due: '2026-10-28' }, { id: 2, ref: '2026-10-23:2', task: 'Gửi số liệu', departmentId: 2, due: '2026-10-27' }];
  const actionRows = new Map([['2026-10-23:1', reports[0].data.results[0]]]);
  const sum = WK.buildSummary({ week: F, depts, reports, notices, actions, actionRows, now: new Date('2026-11-02T07:00:00+07:00'), userName: id => ({ 50: 'Người A (giả)', 51: 'Người B (giả)' }[id] || '') });
  assert.deepEqual(sum.kpis, { submitted: 1, total: 3, overdue: 1, stuck: 3, helps: 2, done: 1, ongoing: 4, risk: 4 }); // đang làm: a, b (Phần I chưa xong) + c, d
  assert.deepEqual([sum.rows[0].done, sum.rows[0].ongoing, sum.rows[0].risk], [1, 4, 4]); assert.equal(sum.rows[1].risk, null);
  assert.deepEqual(sum.risks.map(x => [x.task, x.risk, x.started]), [['Việc a', 'Vướng', true], ['Việc b', 'Quá hạn', true], ['Việc d', 'Chậm tiến độ', true], ['Việc e', 'Chậm khởi động', false]]);
  assert.deepEqual(sum.rows.map(r => r.status.code), ['ON_TIME', 'MISSING', 'MISSING']);
  assert.equal(sum.rows[0].resubmits, 1); assert.equal(sum.rows[1].draft, true);
  assert.equal(sum.rows[2].absent.noticed, true); assert.equal(sum.rows[2].absent.substitute, 'Người B (giả)');
  assert.deepEqual(sum.helps.map(g => [g.to, g.list.length]), [['Ban Giám đốc', 1], ['Tài chính (giả)', 1]]);
  assert.deepEqual(sum.actionReview.map(a => [a.task, a.status, a.overdue]), [['Chốt phương án', 'Vướng', false], ['Gửi số liệu', null, true]]);
  const text = WK.summaryText(sum);
  assert.match(text, /^BẢO MẬT – chỉ dùng nội bộ/);
  assert.match(text, /Dự án A \(giả\) → Ban Giám đốc: Ký văn bản/);
  assert.match(text, /\[Dự án A \(giả\)\] Việc b — Quá hạn \(hạn 28\/10\) · 50% — Giải pháp: S2/);
  // Ba phần: xong trong tuần · đang làm chưa xong (kể cả không có nguy cơ) · nguy cơ chậm (kể cả việc chưa khởi động).
  const part = (a, b) => text.slice(text.indexOf(a), text.indexOf(b));
  assert.match(part('I. ĐÃ HOÀN THÀNH', 'II. ĐANG'), /\[Dự án A \(giả\)\] Việc x/);
  assert.match(part('II. ĐANG', 'III. NGUY CƠ'), /Việc c · 50% · hạn 10\/11 — Tuần tới: Trình ký/);
  assert.match(part('II. ĐANG', 'III. NGUY CƠ'), /Việc d · 50% · hạn 10\/11 · Chậm tiến độ/);
  assert.doesNotMatch(part('II. ĐANG', 'III. NGUY CƠ'), /Việc e/);
  assert.match(part('III. NGUY CƠ', 'YÊU CẦU HỖ TRỢ'), /Việc e — Chậm khởi động/);
  assert.doesNotMatch(part('III. NGUY CƠ', 'YÊU CẦU HỖ TRỢ'), /Việc c/);
  assert.doesNotMatch(text, /Người A|Người B/);
  // Bản tóm tắt cho trưởng / phó bộ phận: không họ tên, không ghi chú vắng, không chi tiết bộ phận khác.
  const brief = WK.briefSummary(sum, 2);
  assert.equal(brief.rows[0].report, null); assert.equal(brief.rows[0].submittedBy, ''); assert.deepEqual(brief.risks, []);
  assert.deepEqual(brief.rows[2].absent, { noticed: true, hasSubstitute: true }); assert.equal(brief.actionReview[0].owner, '');
  assert.equal(WK.summaryText(brief).includes('có người dự thay'), true);
});

test('chấm điểm tuân thủ tháng (Phụ lục 1): nộp muộn, không nộp, vắng có / không báo, đi muộn, báo cáo không đạt', () => {
  const depts = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }];
  const t = s => new Date(s);
  const byWeek = {
    '2026-10-23': { reports: [{ departmentId: 1, firstSubmittedAt: t('2026-10-23T17:00:00+07:00') }, { departmentId: 2, firstSubmittedAt: t('2026-10-24T10:00:00+07:00') }], notices: [{ departmentId: 2, type: 'LATE', createdAt: t('2026-10-23T16:00:00+07:00') }], meeting: { data: { attendance: { 1: 'LATE', 3: 'ABSENT' }, failed: { 1: true } } } },
    '2026-10-30': { reports: [{ departmentId: 1, firstSubmittedAt: t('2026-10-30T17:00:00+07:00') }, { departmentId: 3, firstSubmittedAt: t('2026-10-30T17:00:00+07:00') }],
      notices: [{ departmentId: 3, type: 'ABSENT', reason: 'DOT_XUAT', substituteId: 9, createdAt: t('2026-11-02T07:30:00+07:00') }], meeting: { data: { attendance: { 3: 'ABSENT' } } } },
    '2026-11-06': { reports: [], notices: [], meeting: { data: { skip: true, attendance: { 1: 'ABSENT' } } } }, // tuần nghỉ: không chấm
  };
  const rows = WK.compliance({ weeks: ['2026-10-23', '2026-10-30', '2026-11-06'], depts, byWeek, now: t('2026-11-10T09:00:00+07:00') });
  const by = Object.fromEntries(rows.map(r => [r.name, r]));
  assert.equal(by.A.score, 90); // đi muộn 5 + báo cáo không đạt 5
  assert.equal(by.B.score, 70); // muộn có báo 5 + không nộp tuần 30/10: 25
  assert.equal(by.C.score, 50); // không nộp 23/10: 25 + vắng không báo 25; tuần 30/10 vắng ĐỘT XUẤT báo trước 08:00 T2, có người dự thay: 0
  // Báo vắng sau 17:30 thứ Sáu mà không phải đột xuất → tính vắng không báo.
  const S30 = WK.scheduleOf('2026-10-30');
  assert.equal(WK.absenceNoticed([{ type: 'ABSENT', reason: 'CONG_TAC', substituteId: 9, createdAt: t('2026-11-02T07:30:00+07:00') }], S30), null);
  assert.ok(WK.absenceNoticed([{ type: 'ABSENT', reason: 'CONG_TAC', substituteId: 9, createdAt: t('2026-11-02T07:30:00+07:00'), receivedAt: t('2026-10-30T16:00:00+07:00') }], S30)); // thư ký nhập hộ tin nhận lúc 16:00 T6
  // Danh sách phải nộp đã chụp của tuần: bộ phận không có trong đó không bị chấm tuần đó.
  const snap = WK.compliance({ weeks: ['2026-10-23'], depts, byWeek: { '2026-10-23': { ...byWeek['2026-10-23'], meeting: { data: { required: [1, 2] } } } }, now: t('2026-11-10T09:00:00+07:00') });
  assert.equal(snap.find(r => r.name === 'C').score, 100);
  assert.equal(by.C.violations, 2);
  assert.deepEqual(WK.fridaysOf('2026-10', t('2026-10-28T09:00:00+07:00')), ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']);
  assert.deepEqual(WK.fridaysOf('2026-10', t('2026-10-28T09:00:00+07:00'), '2026-10-30'), ['2026-10-30']);
});

test('SHA-256 bản nộp: JSON chuẩn hoá không phụ thuộc thứ tự khoá (JSONB đọc ra kiểm lại được)', () => {
  const a = { results: [{ task: 'x', pct: 50, ownerIds: [2, 1] }], plans: [], b: { z: 1, a: null } };
  const b = { plans: [], b: { a: null, z: 1 }, results: [{ ownerIds: [2, 1], pct: 50, task: 'x' }] };
  assert.equal(WK.stableStringify(a), WK.stableStringify(b));
  assert.notEqual(WK.stableStringify(a), WK.stableStringify({ ...a, plans: [1] }));
});
