const test = require('node:test');
const assert = require('node:assert/strict');
const WK = require('./weekly');

// Dữ liệu GIẢ. Tuần báo cáo: thứ Sáu 30/10/2026 (T2 26/10 – T6 30/10); tuần mới 02/11 – 06/11.
const F = '2026-10-30';
const d = s => new Date(`${s}T00:00:00+07:00`);
const end = s => new Date(`${s}T23:59:59+07:00`);
const item = (id, s, e, extra = {}) => ({ id, code: `DA-${id}`, projectKey: 'DA', planCode: String(id), title: `Hạng mục ${id} (giả)`, parentId: null, baselineStart: d(s), baselineEnd: end(e),
  done: false, cancelled: false, completedAt: null, status: 'ON_TRACK', actual: 40, assignees: [], leadDepartmentId: 1, ...extra });

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

test('điền sẵn từ MTL: đến hạn / quá hạn / xong trong tuần → I, chạy nhiều tuần → II, bắt đầu tuần tới → III; chỉ mức chi tiết nhất', () => {
  const items = [
    item(1, '2026-10-01', '2026-10-28', { status: 'BEHIND', actual: 60 }), // hạn T4 trong tuần, chưa xong → I, Chậm, Quá hạn
    item(2, '2026-09-01', '2026-10-15', { status: 'OVERDUE' }), // quá hạn từ trước → I
    item(3, '2026-10-01', '2026-10-31', { done: true, completedAt: d('2026-10-27'), status: 'DONE_ON_TIME' }), // xong trong tuần → I
    item(4, '2026-10-01', '2026-12-31', { status: 'ON_TRACK', actual: 30, checklistNext: 'Gửi hồ sơ (giả)', hasChecklist: true }), // → II
    item(5, '2026-11-02', '2026-11-30', { status: 'NOT_DUE', actual: 0 }), // → III
    item(6, '2026-12-01', '2026-12-31', { status: 'NOT_DUE', actual: 0 }), // còn xa → không có
    item(7, '2026-10-01', '2026-12-31', { leadDepartmentId: 2 }), // bộ phận khác
    item(8, '2026-10-01', '2026-12-31'), // có con thuộc bộ phận → chỉ lấy con
    item(81, '2026-10-01', '2026-11-30', { parentId: 8, leadDepartmentId: 2, assignees: [{ id: 50 }] }), // con giao người của bộ phận 1
    item(9, '2026-08-01', '2026-09-30', { done: true, completedAt: d('2026-09-20') }), // xong từ lâu → không có
  ];
  const p = WK.buildPrefill({ week: F, deptId: 1, items, memberIds: new Set([50]) });
  assert.deepEqual(p.results.map(r => r.itemId), [2, 1, 3]); // việc cần giải trình trước, rồi theo hạn
  assert.deepEqual(p.ongoing.map(r => r.itemId).sort(), [4, 81]);
  assert.deepEqual(p.plans.map(r => r.itemId), [5]);
  const r1 = p.results.find(r => r.itemId === 1);
  assert.equal(r1.status, 'Chậm'); assert.equal(r1.pct, 60); assert.equal(r1.pct0, 60); assert.equal(r1.due, '2026-10-28'); assert.equal(r1.source, 'MTL');
  assert.ok(WK.isOverdue(r1, F)); assert.ok(WK.needsIssue(r1, F)); assert.equal(WK.issueLabel(r1, F), 'Chậm · Quá hạn');
  assert.equal(p.results.find(r => r.itemId === 3).status, 'Hoàn thành');
  const r4 = p.ongoing.find(r => r.itemId === 4);
  assert.equal(r4.next, 'Gửi hồ sơ (giả)'); assert.equal(r4.pctLocked, true);
  assert.deepEqual(p.ongoing.find(r => r.itemId === 81).ownerIds, [50]);
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
  assert.deepEqual(p.results.map(r => r.task), ['Chốt phương án (giả)', 'Làm việc với Sở (giả)', 'Hạng mục 4 (giả)']); // quá hạn (cần giải trình) lên trước
  const a = p.results.find(r => r.actionRef === '2026-10-23:1');
  assert.equal(a.source, 'TGĐ giao'); assert.deepEqual(a.ownerIds, [50]);
  assert.equal(p.results.find(r => r.key === 'p1').source, 'KH tháng');
  assert.deepEqual(p.ongoing.map(r => r.key), ['r1']); assert.equal(p.ongoing[0].status, 'Vướng'); assert.equal(p.ongoing[0].cause, '');
  assert.equal(p.ongoing.some(r => r.itemId === 4), false); // hạng mục 4 đã ở Phần I (kế hoạch tuần trước), không lặp
});

test('điền sẵn: hạng mục còn chậm nhận lại nguyên nhân / giải pháp tuần trước (đánh dấu để xem lại), không chép đề nghị hỗ trợ', () => {
  const items = [item(4, '2026-10-01', '2026-12-31', { status: 'BEHIND', actual: 10 }), item(5, '2026-10-01', '2026-12-31', { status: 'BEHIND', actual: 10 })];
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
  assert.equal(data.results[2].itemId, null); // không xem được hạng mục 9 → thành dòng tự do
  assert.equal(data.plans[0].basis, 'KH tháng'); assert.equal(data.extra, undefined);
  const errs = WK.validate(data, F, { deptName: id => (id === 2 ? 'Ban Tài chính (giả)' : '') });
  assert.ok(errs.some(e => /Hạng mục 1.*Chậm · Quá hạn.*thiếu nguyên nhân/.test(e)));
  assert.ok(errs.some(e => /thiếu giải pháp/.test(e)));
  assert.ok(errs.some(e => /cần Ban Tài chính \(giả\) hỗ trợ việc gì/.test(e)));
  assert.ok(errs.some(e => /Phần II “Hạng mục 4”: ghi việc sẽ làm tuần tới/.test(e)));
  assert.ok(errs.some(e => /Phần III “Kế hoạch \(giả\)”: thiếu người phụ trách/.test(e)));
  assert.ok(errs.some(e => /Không được xem.*thiếu người phụ trách/.test(e)));
  assert.ok(errs.some(e => /Hạng mục 1.*thiếu người phụ trách/.test(e))); // dòng MTL chưa giao người: phải chọn người phụ trách
  Object.assign(data.results[0], { cause: 'Chờ Sở (giả)', solution: 'Đôn đốc (giả)', helpWhat: 'Làm việc với Sở', helpBy: '2026-11-03', ownerIds: [50] });
  data.ongoing[0].next = 'Nộp hồ sơ'; data.ongoing[0].ownerIds = [50]; data.plans[0].ownerIds = [50]; data.plans[0].due = '2026-11-05'; data.plans[0].output = 'Biên bản (giả)'; data.results[2].ownerIds = [50];
  assert.deepEqual(WK.validate(data, F), []);
  // Hạng mục bắt buộc (MTL quá hạn, việc TGĐ giao…) không được bỏ khỏi báo cáo.
  assert.ok(WK.validate(data, F, { mandatory: [{ itemId: 77, task: 'Bước găng (giả)', ref: 'DA-77' }] }).some(e => /Không được bỏ “Bước găng \(giả\)” \(DA-77\)/.test(e)));
  assert.deepEqual(WK.writeBacks(data), [{ itemId: 1, pct: 70 }]); // hạng mục 4 không đổi %
  data.results[0].pctLocked = true;
  assert.deepEqual(WK.writeBacks(data), []); // hạng mục dùng checklist: không ghi ngược
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
      data: { results: [row('a', { status: 'Vướng', cause: 'C', solution: 'S', helpFrom: 'BGD', helpWhat: 'Ký văn bản', actionRef: '2026-10-23:1' }), row('b', { due: '2026-10-28', solution: 'S2', helpFrom: 'D2', helpWhat: 'Bố trí vốn' })], ongoing: [], plans: [], other: '' } },
    { departmentId: 2, firstSubmittedAt: null, data: { results: [], ongoing: [], plans: [] } },
  ];
  const notices = [{ departmentId: 3, type: 'ABSENT', reason: 'CONG_TAC', note: '', substituteId: 51, createdAt: new Date('2026-10-30T10:00:00+07:00') }];
  const actions = [{ id: 1, ref: '2026-10-23:1', task: 'Chốt phương án', departmentId: 1, ownerId: 50, due: '2026-10-28' }, { id: 2, ref: '2026-10-23:2', task: 'Gửi số liệu', departmentId: 2, due: '2026-10-27' }];
  const actionRows = new Map([['2026-10-23:1', reports[0].data.results[0]]]);
  const sum = WK.buildSummary({ week: F, depts, reports, notices, actions, actionRows, now: new Date('2026-11-02T07:00:00+07:00'), userName: id => ({ 50: 'Người A (giả)', 51: 'Người B (giả)' }[id] || '') });
  assert.deepEqual(sum.kpis, { submitted: 1, total: 3, overdue: 1, stuck: 1, helps: 2 });
  assert.deepEqual(sum.rows.map(r => r.status.code), ['ON_TIME', 'MISSING', 'MISSING']);
  assert.equal(sum.rows[0].resubmits, 1); assert.equal(sum.rows[1].draft, true);
  assert.equal(sum.rows[2].absent.noticed, true); assert.equal(sum.rows[2].absent.substitute, 'Người B (giả)');
  assert.deepEqual(sum.helps.map(g => [g.to, g.list.length]), [['Ban Giám đốc', 1], ['Tài chính (giả)', 1]]);
  assert.deepEqual(sum.actionReview.map(a => [a.task, a.status, a.overdue]), [['Chốt phương án', 'Vướng', false], ['Gửi số liệu', null, true]]);
  const text = WK.summaryText(sum);
  assert.match(text, /^BẢO MẬT – chỉ dùng nội bộ/);
  assert.match(text, /Dự án A \(giả\) → Ban Giám đốc: Ký văn bản/);
  assert.match(text, /\[Dự án A \(giả\)\] Việc b — Quá hạn 28\/10 — Giải pháp: S2/);
  assert.doesNotMatch(text, /Người A|Người B/);
  // Bản tóm tắt cho trưởng / phó bộ phận: không họ tên, không ghi chú vắng, không chi tiết bộ phận khác.
  const brief = WK.briefSummary(sum, 2);
  assert.equal(brief.rows[0].report, null); assert.equal(brief.rows[0].submittedBy, '');
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
