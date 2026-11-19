// Ma trận vai × trường / hành động của taskCapabilities (bảng quyền tối thiểu chủ dự án chốt 20/11/2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const TA = require('./task-access');

// Tài khoản giả: 1 TGĐ, 2 PGĐ phụ trách bộ phận chủ trì, 3 người giao, 4 chủ trì, 5 phối hợp, 6 lãnh đạo bộ phận chủ trì,
// 7 PMO (vai director, không thuộc Ban Giám đốc), 8 thành viên không liên quan, 9 lãnh đạo phòng của người chủ trì (phòng khác),
// 10 lãnh đạo phòng phối hợp, 11 người nhập thay, 12 quản trị IT, 13 chủ dự án (OWNER).
const U = {
  tgd: { id: 1, role: 'director' }, pgd: { id: 2, role: 'director' }, assigner: { id: 3, role: 'member' }, lead: { id: 4, role: 'member' },
  support: { id: 5, role: 'member' }, deptLead: { id: 6, role: 'manager' }, pmo: { id: 7, role: 'director' }, other: { id: 8, role: 'member' },
  staffLead: { id: 9, role: 'manager' }, supportLead: { id: 10, role: 'manager' }, reporter: { id: 11, role: 'member' }, it: { id: 12, role: 'admin' },
  owner: { id: 13, role: 'member' },
};
const RIGHTS = { canView: true, canEdit: true, canManage: false, canDelete: false };
const item = (extra = {}) => ({ id: 100, assignedById: 3, reporterId: 11, assigneeIds: [4], supporterIds: [5], category: 'STARTED', archivedAt: null, dispatchStatus: null, parentId: null, ...extra });
const ctx = (extra = {}) => ({ project: { kind: 'KANBAN', visibility: 'PUBLIC', leadId: null }, rights: RIGHTS, memberRole: 'MEMBER',
  topIds: [1], supervisorId: 2, leadDeptId: 50, leadLeaderIds: [6], staffLeaderIds: [6, 9], supportLeaderIds: [10], approver: false, ...extra });
// Quyền theo vai: người quản lý dự án / OWNER có canManage hoặc memberRole OWNER.
const capsOf = (who, it = item(), c = {}) => {
  const base = ctx(c);
  if (who === U.pmo) base.rights = { ...base.rights, canManage: true, ...(c.rights || {}) };
  if (who === U.owner) base.memberRole = 'OWNER';
  return TA.taskCapabilities(who, it, base);
};

test('vai trên một việc: A, B (TGĐ + PGĐ phụ trách), L, S, D, O, U', () => {
  assert.deepEqual(capsOf(U.assigner).roles, ['A']);
  assert.deepEqual(capsOf(U.tgd).roles, ['B', 'O']); // TGĐ có vai director → cũng là O, nhưng quyền theo B
  assert.deepEqual(capsOf(U.pgd).roles, ['B', 'O']);
  assert.deepEqual(capsOf(U.lead).roles, ['L']);
  assert.deepEqual(capsOf(U.support).roles, ['S']);
  assert.deepEqual(capsOf(U.deptLead).roles, ['D']);
  assert.deepEqual(capsOf(U.staffLead).roles, ['D']);
  assert.deepEqual(capsOf(U.pmo).roles, ['O']);
  assert.deepEqual(capsOf(U.owner).roles, ['O']);
  assert.deepEqual(capsOf(U.other).roles, ['U']);
});

test('vai director KHÔNG tự động là Ban Giám đốc: PMO xem toàn bộ, không sửa kế hoạch việc người khác giao', () => {
  const c = capsOf(U.pmo);
  assert.equal(c.view, 'FULL');
  for (const k of ['plan', 'assign', 'assigner', 'delete', 'recur', 'progress', 'children', 'docsGive', 'docsBack', 'rebaseline', 'decideExtension']) assert.equal(c[k], false, k);
  assert.equal(c.state, null);
  assert.equal(c.comment, true);
  assert.equal(c.approvalLevels, true); // quy trình duyệt là việc của người quản lý dự án
  // Cùng tài khoản đó là người giao → sửa kế hoạch được (44 việc NOXH do PMO giao).
  assert.equal(capsOf(U.pmo, item({ assignedById: 7 })).plan, true);
});

// Ma trận chính: mỗi dòng = một quyền; cột = vai. true = được, false = không.
const MATRIX = {
  //               A      B(TGĐ) B(PGĐ) L      S      D      Dstaff O(PMO) U      SL
  plan:           [true,  true,  true,  false, false, false, false, false, false, false],
  assign:         [true,  true,  true,  false, false, false, false, false, false, false],
  assigner:       [true,  true,  true,  false, false, false, false, false, false, false],
  delete:         [true,  true,  true,  false, false, false, false, false, false, false],
  recur:          [true,  true,  true,  false, false, false, false, false, false, false],
  progress:       [false, false, false, true,  false, false, false, false, false, false],
  extension:      [false, false, false, true,  false, false, false, false, false, false],
  decideExtension:[false, true,  true,  false, false, false, false, false, false, false],
  children:       [true,  true,  true,  true,  false, false, false, false, false, false],
  submit:         [true,  true,  true,  true,  false, false, false, false, false, false],
  docsGive:       [true,  true,  true,  false, false, false, false, false, false, false],
  docsBack:       [false, false, false, true,  true,  false, false, false, false, false],
  comment:        [true,  true,  true,  true,  true,  true,  true,  true,  false, true],
  answer:         [true,  true,  true,  false, false, true,  false, false, false, false],
  rebaseline:     [false, false, false, false, false, false, false, false, false, false], // dự án thường: không có kế hoạch gốc
};
const COLS = [U.assigner, U.tgd, U.pgd, U.lead, U.support, U.deptLead, U.staffLead, U.pmo, U.other, U.supportLead];
for (const [cap, row] of Object.entries(MATRIX)) {
  test(`ma trận: ${cap}`, () => {
    COLS.forEach((who, i) => assert.equal(!!capsOf(who)[cap], row[i], `${cap} · người ${who.id}`));
  });
}

test('xem theo vai: A, B, L, S, D, O, lãnh đạo phòng phối hợp, người nhập, người duyệt — đầy đủ; người khác — tóm tắt', () => {
  for (const who of [U.assigner, U.tgd, U.pgd, U.lead, U.support, U.deptLead, U.staffLead, U.pmo, U.owner, U.supportLead, U.reporter]) assert.equal(capsOf(who).view, 'FULL', `người ${who.id}`);
  assert.equal(capsOf(U.other).view, 'SUMMARY');
  assert.equal(capsOf(U.other, item(), { approver: true }).view, 'FULL'); // người duyệt theo quy trình
  assert.equal(capsOf(U.other, item(), { rights: { ...RIGHTS, delegated: true } }).view, 'FULL'); // duyệt thay theo uỷ quyền
  assert.equal(capsOf(U.other, item(), { rights: { ...RIGHTS, delegated: true } }).comment, false); // chỉ xem
  assert.equal(capsOf(U.it).view, 'NONE');
  assert.equal(capsOf(U.other, item(), { rights: { ...RIGHTS, canView: false } }).view, 'NONE');
  // Tóm tắt: không quyền gì khác.
  const u = capsOf(U.other);
  assert.equal(Object.entries(u).filter(([k, v]) => !['roles', 'view', 'fields'].includes(k) && v).length, 0);
  assert.equal(Object.values(u.fields).some(Boolean), false);
});

test('trường theo phần: kế hoạch (A, B), tiến độ (L), sản phẩm bên thực hiện (L, S); ô đánh giá viết tay không ai sửa', () => {
  const a = capsOf(U.assigner).fields, l = capsOf(U.lead).fields, s = capsOf(U.support).fields;
  for (const k of ['title', 'descriptionHtml', 'dueDate', 'startDate', 'critical', 'milestone', 'priority', 'source', 'assignedAt', 'labelIds', 'internalDueDate', 'coordinatorText', 'deliverable', 'note'])
    assert.deepEqual([a[k], l[k], s[k]], [true, false, false], k);
  for (const k of ['progress', 'forecastEnd', 'resultNote']) assert.deepEqual([a[k], l[k], s[k]], [false, true, false], k);
  assert.deepEqual([a.outputs, l.outputs, s.outputs], [false, true, true]);
  for (const who of COLS) assert.equal(capsOf(who).fields.review, false);
  assert.equal(TA.capForField('review'), 'review');
  assert.throws(() => TA.assertCap(capsOf(U.assigner), 'review'), e => e.status === 422 && e.code === 'REVIEW_REMOVED');
});

test('việc chưa có người giao: kế hoạch chỉ Ban Giám đốc; không ai tự nhận làm người giao (kiểm ở route)', () => {
  const it = item({ assignedById: null });
  assert.equal(capsOf(U.assigner, it).plan, false);
  assert.equal(capsOf(U.lead, it).plan, false);
  assert.equal(capsOf(U.pmo, it).plan, false);
  assert.equal(capsOf(U.tgd, it).plan, true);
  assert.equal(capsOf(U.pgd, it).plan, true);
});

test('trạng thái: người chủ trì Chưa bắt đầu → Đang thực hiện → Gửi duyệt; người giao / BGĐ mọi trạng thái', () => {
  const l = capsOf(U.lead), a = capsOf(U.assigner);
  assert.equal(l.state, 'WORK');
  assert.equal(a.state, 'ALL');
  assert.equal(TA.canMove(l, 'UNSTARTED', 'STARTED'), true);
  assert.equal(TA.canMove(l, 'STARTED', 'REVIEW'), true);
  assert.equal(TA.canMove(l, 'STARTED', 'COMPLETED'), true); // máy chủ đưa vào "Chờ duyệt"
  assert.equal(TA.canMove(l, 'STARTED', 'CANCELLED'), false);
  assert.equal(TA.canMove(l, 'STARTED', 'OTHER'), false); // "Tạm dừng" (MTL) là của người giao / BGĐ
  assert.equal(TA.canMove(l, 'REVIEW', 'STARTED'), false);
  assert.equal(TA.canMove(l, 'COMPLETED', 'STARTED'), false); // mở lại: người giao / BGĐ
  for (const [f, t] of [['STARTED', 'CANCELLED'], ['COMPLETED', 'STARTED'], ['STARTED', 'OTHER'], ['CANCELLED', 'UNSTARTED']]) assert.equal(TA.canMove(a, f, t), true);
  assert.equal(TA.canMove(capsOf(U.support), 'UNSTARTED', 'STARTED'), false);
  assert.equal(TA.canMove(capsOf(U.deptLead), 'UNSTARTED', 'STARTED'), false);
  // Việc đã xong: người chủ trì không đổi gì nữa.
  const done = capsOf(U.lead, item({ category: 'COMPLETED' }));
  assert.equal(done.state, null);
  assert.equal(done.progress, false);
  assert.equal(capsOf(U.assigner, item({ category: 'COMPLETED' })).completedAt, true);
});

test('lãnh đạo bộ phận chủ trì: chọn người cho bước giao cho bộ phận mà chưa có người, không sửa kế hoạch', () => {
  const unassigned = item({ assigneeIds: [], supporterIds: [] });
  const d = capsOf(U.deptLead, unassigned);
  assert.equal(d.assignOwnDept, true);
  assert.equal(d.assign, false);
  assert.equal(d.plan, false);
  assert.equal(capsOf(U.deptLead).assignOwnDept, false); // đã có người chủ trì: chỉ A / B phân công lại
  assert.equal(capsOf(U.deptLead, unassigned, { leadDeptId: null }).assignOwnDept, false); // không giao cho bộ phận
  assert.equal(capsOf(U.staffLead, unassigned).assignOwnDept, false);
});

test('dự án MTL: điều chỉnh kế hoạch gốc theo kế hoạch (A, B); người chủ trì tạo việc nhánh của việc mình', () => {
  const mtl = { project: { kind: 'MTL', visibility: 'PUBLIC', leadId: 7 } };
  assert.equal(capsOf(U.assigner, item(), mtl).rebaseline, true);
  assert.equal(capsOf(U.tgd, item(), mtl).rebaseline, true);
  assert.equal(capsOf(U.pmo, item(), mtl).rebaseline, false); // trưởng dự án MTL (PMO) không sửa kế hoạch việc người khác giao
  assert.equal(capsOf(U.lead, item(), mtl).children, true);
  assert.equal(capsOf(U.deptLead, item(), mtl).children, false);
});

test('việc trong thùng rác / dự án lưu trữ: chỉ xem (khôi phục: người giao, BGĐ)', () => {
  const trashed = item({ archivedAt: new Date() });
  const a = capsOf(U.assigner, trashed);
  assert.equal(a.plan, false);
  assert.equal(a.delete, true);
  assert.equal(capsOf(U.lead, trashed).progress, false);
  const ro = capsOf(U.assigner, item(), { rights: { ...RIGHTS, canEdit: false } });
  assert.equal(ro.view, 'FULL');
  assert.equal(ro.plan || ro.comment || ro.delete, false);
});

test('cấu hình phòng TGĐ: theo mã hoặc tên, nhiều giá trị', () => {
  assert.deepEqual(TA.topDepartmentKeys({}), ['tgd', 'ban tổng giám đốc']);
  assert.equal(TA.isTopDepartment({ code: 'X1', name: 'Ban Tổng Giám đốc' }, TA.topDepartmentKeys({})), true);
  assert.equal(TA.isTopDepartment({ code: 'tgd', name: 'Khác' }, TA.topDepartmentKeys({})), true);
  assert.equal(TA.isTopDepartment({ code: 'BGD', name: 'Ban Giám đốc' }, TA.topDepartmentKeys({})), false);
  assert.equal(TA.isTopDepartment({ code: 'BGD', name: 'Ban Giám đốc' }, TA.topDepartmentKeys({ TOP_DEPARTMENT: 'BGD, HĐQT' })), true);
  assert.equal(TA.isTopDepartment({ code: 'TGD', name: 'Ban Tổng Giám đốc', isActive: false }, TA.topDepartmentKeys({})), false);
});

test('quyền cho từng khoá PATCH', () => {
  assert.equal(TA.capForField('dueDate'), 'plan');
  assert.equal(TA.capForField('critical'), 'plan');
  assert.equal(TA.capForField('assignedAt'), 'plan');
  assert.equal(TA.capForField('progress'), 'progress');
  assert.equal(TA.capForField('forecastEnd'), 'progress');
  assert.equal(TA.capForField('outputs'), 'docsBack');
  assert.equal(TA.capForField('assigneeIds'), 'assign');
  assert.equal(TA.capForField('assignedById'), 'assigner');
  assert.equal(TA.capForField('approvalLevels'), 'approvalLevels');
  assert.equal(TA.capForField('overrideWip'), null);
});

test('ngữ cảnh một việc: phòng chủ trì kế thừa từ việc cha, PGĐ phụ trách, lãnh đạo phòng người chủ trì', () => {
  const org = { topIds: [1], supervisor: new Map([[50, 2]]), deptOf: new Map([[4, 60]]), leaders: d => ({ 50: [6], 60: [9], 70: [10] }[d] || []) };
  const c = TA.itemContext(org, { project: { kind: 'MTL', departmentId: 99, leadId: 7 }, rights: RIGHTS, member: { role: 'MEMBER' },
    item: { leadDepartmentId: null, assigneeIds: [4], supportDepartmentIds: [70] }, chain: [{ leadDepartmentId: null }, { leadDepartmentId: 50 }] });
  assert.equal(c.leadDeptId, 50);
  assert.equal(c.supervisorId, 2);
  assert.deepEqual(c.leadLeaderIds, [6]);
  assert.deepEqual(c.staffLeaderIds, [9]);
  assert.deepEqual(c.supportLeaderIds, [10]);
  // Dự án thường không giao cho bộ phận: PGĐ phụ trách / lãnh đạo theo phòng của dự án, nhưng không có "bước giao cho bộ phận".
  const k = TA.itemContext(org, { project: { kind: 'KANBAN', departmentId: 50 }, rights: RIGHTS, item: { leadDepartmentId: null, assigneeIds: [] } });
  assert.equal(k.leadDeptId, null);
  assert.equal(k.supervisorId, 2);
});
