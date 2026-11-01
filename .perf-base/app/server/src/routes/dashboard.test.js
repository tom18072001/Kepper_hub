const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('./dashboard');
const { reportData, MAX_DAYS } = require('./reports');

const DAY = 86_400_000, now = new Date('2026-10-16T05:00:00Z');
const item = (id, category, extra = {}) => ({ id, number: id, title: 'Việc ' + id, projectId: 1, project: { key: 'KD', departmentId: 1 }, state: { category }, assignees: [], dueDate: null, startedAt: null, completedAt: null, taskType: 'ADHOC', leadDepartmentId: null, dispatchStatus: null, ...extra });

test('tổng hợp quá hạn, khối lượng, throughput và cycle time', () => {
  const an = { user: { id: 1, fullName: 'An' } };
  const items = [
    item(1, 'STARTED', { assignees: [an], dueDate: new Date(now - DAY), startedAt: new Date(now - 10 * DAY) }),
    item(2, 'UNSTARTED', { assignees: [an], dueDate: new Date(now.getTime() + 3 * DAY) }),
    item(3, 'COMPLETED', { startedAt: new Date(now - 6 * DAY), completedAt: new Date(now - 2 * DAY) }),
    item(4, 'COMPLETED', { startedAt: new Date(now - 3 * DAY), completedAt: new Date(now - DAY) }),
    item(5, 'CANCELLED'),
    // Bắt đầu ghi sau khi hoàn thành (dữ liệu lỗi) → không làm cycle time âm.
    item(6, 'COMPLETED', { startedAt: new Date(now - DAY), completedAt: new Date(now - 2 * DAY) }),
  ];
  const s = summarize(items, { now, departments: [{ id: 1, name: 'Kinh doanh' }], projects: [{ id: 1, key: 'KD', name: 'Q4' }] });
  assert.deepEqual(s.totals, { total: 6, open: 2, completed: 3, overdue: 1, dueSoon: 1, inReview: 0, pendingAccept: 0 });
  assert.deepEqual(s.workload[0], { userId: 1, fullName: 'An', open: 2, overdue: 1, inProgress: 1 });
  assert.equal(s.throughput.length, 8);
  assert.equal(s.throughput.reduce((n, w) => n + w.completed, 0), 3);
  assert.deepEqual(s.cycleTime, { samples: 2, avgDays: 3, medianDays: 3 });
  assert.equal(s.aging[0].code, 'KD-1');
  assert.equal(s.byDepartment[0].overdue, 1);
  assert.equal(s.overdueItems[0].id, 1);
  assert.equal(s.dueSoonItems[0].id, 2);
});

test('dashboard tính việc của sổ BGĐ cho đơn vị chủ trì, đếm việc chờ phòng tiếp nhận, chia loại nhiệm vụ', () => {
  const reg = { key: 'TT', departmentId: 1 };
  const items = [
    item(1, 'UNSTARTED', { projectId: 11, project: reg, leadDepartmentId: 6, dispatchStatus: 'PENDING', taskType: 'PLAN' }),
    item(2, 'STARTED', { projectId: 11, project: reg, leadDepartmentId: 6, dueDate: new Date(now - 2 * DAY) }),
    item(3, 'COMPLETED', { projectId: 11, project: reg, leadDepartmentId: 7, completedAt: new Date(now - DAY) }),
    item(4, 'STARTED', { projectId: 13, project: { key: 'KHCN', departmentId: 6 } }),
  ];
  const s = summarize(items, { now, departments: [{ id: 1, name: 'Ban Giám đốc' }, { id: 6, name: 'Phòng KHCN' }, { id: 7, name: 'Phòng TNT' }],
    projects: [{ id: 11, key: 'TT', name: 'Sổ giao việc Trung tâm', visibility: 'ASSIGNED' }, { id: 13, key: 'KHCN', name: 'Việc nội bộ', visibility: 'DEPARTMENT' }] });
  assert.deepEqual(s.byDepartment.map(d => [d.name, d.total, d.open, d.overdue, d.pendingAccept]), [['Phòng KHCN', 3, 3, 1, 1], ['Phòng TNT', 1, 0, 0, 0]]);
  assert.equal(s.totals.pendingAccept, 1);
  assert.deepEqual(s.byTaskType.PLAN, { total: 1, open: 1, completed: 0, overdue: 0, pendingAccept: 1 });
  assert.equal(s.byTaskType.ADHOC.total, 3);
  assert.deepEqual(s.byProject.map(p => [p.id, p.total, p.visibility]), [[11, 3, 'ASSIGNED'], [13, 1, 'DEPARTMENT']]);
});

test('báo cáo tuần: chia theo phòng chủ trì và loại nhiệm vụ, khó khăn – kiến nghị, khâu của việc quá hạn', () => {
  const from = new Date('2026-10-12T00:00:00+07:00'), end = new Date('2026-10-19T00:00:00+07:00');
  const steps = [{ level: 1, name: 'Lãnh đạo phòng duyệt', approverType: 'DEPARTMENT_MANAGER' }, { level: 2, name: 'BGĐ cho ý kiến', approverType: 'SUPERVISOR' }];
  const reg = { key: 'TT', departmentId: 1, approvalSteps: steps };
  const report = (id, extra) => ({ id, createdAt: new Date('2026-10-14T03:00:00Z'), difficulties: '', proposals: '', answer: null, ...extra });
  const items = [
    item(1, 'COMPLETED', { project: reg, leadDepartmentId: 6, taskType: 'PLAN', dueDate: new Date('2026-10-16T00:00:00+07:00'), completedAt: new Date('2026-10-13T09:00:00+07:00') }),
    item(2, 'REVIEW', { project: reg, leadDepartmentId: 6, dueDate: new Date('2026-10-10T00:00:00+07:00'), approvals: [{ status: 'PENDING', currentLevel: 2 }],
      progressReports: [report(1, { difficulties: 'Thiếu kinh phí', proposals: 'Đề nghị bổ sung', answer: 'Đồng ý' }), report(2, { difficulties: '  ' })] }),
    item(3, 'UNSTARTED', { project: reg, leadDepartmentId: 7, dispatchStatus: 'PENDING', dueDate: new Date('2026-10-14T00:00:00+07:00') }),
    item(4, 'UNSTARTED', { project: reg, leadDepartmentId: 7, dueDate: new Date('2026-10-22T00:00:00+07:00') }),
    // Kế hoạch năm chưa bắt đầu, đến hạn trong kỳ (chưa quá hạn) → vẫn có trong bảng kết quả của phòng.
    item(5, 'UNSTARTED', { project: reg, leadDepartmentId: 6, taskType: 'PLAN', dueDate: new Date('2026-10-17T00:00:00+07:00') }),
  ];
  const d = reportData(items, { from, end, now, departments: [{ id: 6, name: 'Phòng KHCN' }, { id: 7, name: 'Phòng TNT' }] });
  assert.deepEqual(d.byDepartment.map(x => [x.name, x.done, x.review, x.overdue]), [['Phòng KHCN', 1, 1, 1], ['Phòng TNT', 0, 0, 1]]);
  const khcn = d.byDepartment[0];
  assert.deepEqual(khcn.types.map(t => [t.type, t.items.map(i => i.id)]), [['PLAN', [1, 5]], ['ADHOC', [2]]]);
  assert.deepEqual(khcn.plan, { total: 2, completed: 1, rate: 50 });
  assert.equal(d.status(items[4]), 'Chưa bắt đầu');
  assert.match(d.status(items[0]), /^Hoàn thành 13\/10\/2026 \(đúng hạn\)$/);
  assert.equal(d.status(items[1]), 'Chờ BGĐ cho ý kiến · quá hạn 6 ngày');
  assert.deepEqual(d.sections.overdue.map(i => [i.id, d.stage(i).label]), [[2, 'Chờ BGĐ cho ý kiến'], [3, 'Chờ phòng tiếp nhận']]);
  assert.deepEqual(d.sections.next.map(i => i.id), [4]);
  assert.equal(d.issues.length, 1);
  assert.equal(d.issues[0].department, 'Phòng KHCN');
  assert.equal(d.issues[0].report.answer, 'Đồng ý');
  assert.equal(MAX_DAYS, 93);
});
