// GĐ3b — quản trị: đổi vai trò áp hồ sơ quyền, bàn giao khi nghỉ việc, nhật ký (che nội dung nghiệp vụ, lọc), phòng ban vòng.
const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('./admin');
const { failedLogin } = require('./auth');
const { ROLE_PROFILES, canGrant } = require('../lib/permissions');

const { profileDiff, grantsToCheck, sensitiveGrants, profileMismatch, wouldCreateCycle, planHandover, presentAudit, auditWhere, runHandover } = admin;
const g = (permissionKey, action, scope) => ({ permissionKey, action, scope });

test('đổi vai trò: khác biệt quyền giữa Nhân viên và Phó phòng / Trưởng phòng → Nhân viên', () => {
  const up = profileDiff(ROLE_PROFILES.member, ROLE_PROFILES.deputy);
  assert.deepEqual(up.added.map(x => x.permissionKey).sort(), ['projects.manage', 'reports.export', 'reports.summary', 'work.approve', 'work.delete']);
  assert.equal(up.removed.length, 0);
  assert.equal(up.mismatch, true);
  const down = profileDiff(ROLE_PROFILES.manager, ROLE_PROFILES.member);
  assert.ok(down.removed.some(x => x.permissionKey === 'work.approve'), 'TP → NV phải bỏ quyền duyệt');
  assert.equal(down.added.length, 0);
  // Đổi phạm vi được tính là "đổi", không phải thêm + bỏ.
  const scope = profileDiff([g('work.view', 'VIEW', 'UNIT')], [g('work.view', 'VIEW', 'SYSTEM')]);
  assert.deepEqual(scope.changed, [{ permissionKey: 'work.view', action: 'VIEW', scope: 'SYSTEM', from: 'UNIT', to: 'SYSTEM' }]);
  assert.equal(profileDiff(ROLE_PROFILES.manager, ROLE_PROFILES.deputy).mismatch, false);
});

test('áp hồ sơ vai trò: kiểm tra canGrant từng quyền, quyền rác luôn gỡ được', () => {
  const diff = profileDiff([g('work.view', 'VIEW', 'UNIT'), g('old.removed', 'VIEW', 'UNIT')], ROLE_PROFILES.director);
  const checked = grantsToCheck(diff);
  assert.ok(!checked.some(x => x.permissionKey === 'old.removed'));
  assert.ok(checked.some(x => x.permissionKey === 'work.view' && x.scope === 'UNIT') && checked.some(x => x.permissionKey === 'work.view' && x.scope === 'SYSTEM'));
  // Trưởng phòng (không phải quản trị) không tự nâng người khác lên Ban giám đốc.
  const manager = { id: 9, role: 'manager', departmentId: 2, permissions: ROLE_PROFILES.manager };
  assert.equal(checked.every(x => canGrant(manager, x)), false);
  // Admin IT có quyền phân quyền vẫn cấp được quyền nghiệp vụ cho người khác (giữ luồng cũ).
  const it = { id: 1, role: 'admin', permissions: ROLE_PROFILES.admin };
  assert.equal(checked.every(x => canGrant(it, x)), true);
});

test('báo Giám đốc: chỉ khi cấp quyền nghiệp vụ phạm vi toàn tổ chức', () => {
  assert.deepEqual(sensitiveGrants(profileDiff(ROLE_PROFILES.member, ROLE_PROFILES.manager)), []);
  assert.deepEqual(sensitiveGrants(profileDiff(ROLE_PROFILES.member, [...ROLE_PROFILES.member, g('admin.audit', 'VIEW', 'SYSTEM')])), []);
  const s = sensitiveGrants(profileDiff(ROLE_PROFILES.member, [g('work.view', 'VIEW', 'SYSTEM'), g('work.edit', 'OPERATE', 'UNIT'), g('reports.dashboard', 'VIEW', 'UNIT')]));
  assert.deepEqual(s, [g('work.view', 'VIEW', 'SYSTEM')]);
  assert.equal(sensitiveGrants(profileDiff([], ROLE_PROFILES.director)).length, ROLE_PROFILES.director.length);
});

test('cảnh báo lệch quyền so với hồ sơ vai trò (không áp cho quản trị gốc)', () => {
  assert.equal(profileMismatch({ role: 'deputy' }, ROLE_PROFILES.member), true);
  assert.equal(profileMismatch({ role: 'member' }, ROLE_PROFILES.member), false);
  assert.equal(profileMismatch({ role: 'admin', isRootAdmin: true }, []), false);
  assert.equal(profileMismatch({ role: 'admin' }, ROLE_PROFILES.admin), false);
});

test('phòng ban: chặn đặt trực thuộc thành vòng', () => {
  const depts = [{ id: 1, parentId: null }, { id: 2, parentId: 1 }, { id: 3, parentId: 2 }, { id: 4, parentId: null }];
  assert.equal(wouldCreateCycle(depts, 1, 2), true); // A ↔ B
  assert.equal(wouldCreateCycle(depts, 1, 3), true); // cháu
  assert.equal(wouldCreateCycle(depts, 2, 2), true); // chính nó
  assert.equal(wouldCreateCycle(depts, 3, 4), false);
  assert.equal(wouldCreateCycle(depts, 4, 3), false);
  assert.equal(wouldCreateCycle(depts, 4, null), false);
  assert.equal(wouldCreateCycle([{ id: 5, parentId: 6 }, { id: 6, parentId: 5 }], 7, 5), true); // dữ liệu cũ đã vòng: không lặp vô hạn
});

test('kế hoạch bàn giao: chủ trì duy nhất / nhiều người chủ trì / phối hợp', () => {
  const items = [
    { id: 1, dispatchStatus: 'ACCEPTED', assignees: [{ userId: 7 }], supporters: [] },
    { id: 2, dispatchStatus: null, assignees: [{ userId: 7 }], supporters: [] },
    { id: 3, dispatchStatus: 'ACCEPTED', assignees: [{ userId: 7 }, { userId: 8 }], supporters: [] },
    { id: 4, dispatchStatus: null, assignees: [{ userId: 8 }], supporters: [{ userId: 7 }] },
    { id: 5, dispatchStatus: null, assignees: [{ userId: 8 }], supporters: [] },
  ];
  assert.deepEqual(planHandover(items, 7), [
    { itemId: 1, lead: true, support: false, sole: true, reset: true, notify: 'LEADERS' },
    { itemId: 2, lead: true, support: false, sole: true, reset: false, notify: 'ASSIGNER' },
    { itemId: 3, lead: true, support: false, sole: false, reset: false, notify: null },
    { itemId: 4, lead: false, support: true, sole: false, reset: false, notify: null },
  ]);
});

// CSDL giả tối thiểu cho runHandover: ghi lại các lệnh ghi.
function fakeTx({ items, leadersByDept = {}, directors = [], supervised = [] }) {
  const log = [];
  const user = (id, departmentId, role = 'manager') => ({ id, departmentId, role, isActive: true, permissions: ROLE_PROFILES[role] });
  return { log, tx: {
    delegation: { updateMany: async a => { log.push(['revoke', a.where]); return { count: 2 }; }, findMany: async () => [] },
    workItem: { findMany: async () => items, update: async a => log.push(['item', a.where.id, a.data]) },
    workItemAssignee: { delete: async a => log.push(['unassign', a.where.workItemId_userId.workItemId]) },
    workItemSupporter: { delete: async a => log.push(['unsupport', a.where.workItemId_userId.workItemId]) },
    activity: { create: async a => log.push(['activity', a.data.workItemId, a.data.type, a.data.data]) },
    notification: { createMany: async a => log.push(['notify', a.data.map(n => n.userId), a.data[0].title]) },
    user: { findMany: async ({ where }) => where.role === 'director' ? directors.map(id => ({ id })) : (leadersByDept[where.departmentId] || []).map(id => user(id, where.departmentId)) },
    department: { findMany: async () => supervised, updateMany: async a => log.push(['clearSupervisor', a.where.supervisorId]) },
  } };
}

test('bàn giao: trả việc giao về phòng cho lãnh đạo phòng, việc thường báo người giao, thu hồi uỷ quyền, bỏ PGĐ phụ trách', async () => {
  const P = { id: 3, key: 'SO', leadId: 2, departmentId: 1 };
  const items = [
    { id: 11, number: 1, title: 'Việc A', projectId: 3, project: P, dispatchStatus: 'ACCEPTED', leadDepartmentId: 6, assignedById: 2, assignees: [{ userId: 29 }], supporters: [] },
    { id: 12, number: 2, title: 'Việc B', projectId: 3, project: P, dispatchStatus: null, leadDepartmentId: null, assignedById: 16, assignees: [{ userId: 29 }], supporters: [] },
    { id: 13, number: 3, title: 'Việc C', projectId: 3, project: P, dispatchStatus: 'ACCEPTED', leadDepartmentId: 6, assignedById: 2, assignees: [{ userId: 29 }, { userId: 18 }], supporters: [{ userId: 19 }] },
    { id: 14, number: 4, title: 'Việc D', projectId: 3, project: P, dispatchStatus: null, leadDepartmentId: null, assignedById: 29, assignees: [{ userId: 18 }], supporters: [{ userId: 29 }] },
  ];
  const { tx, log } = fakeTx({ items, leadersByDept: { 6: [16, 17, 29] }, directors: [2, 12], supervised: [{ id: 7, name: 'Phòng Tài năng trẻ' }] });
  const { counts, touched } = await runHandover(tx, { userId: 29, actorId: 1 });
  assert.deepEqual(counts, { leadRemoved: 3, returnedToDept: 1, reassignNotices: 2, supportRemoved: 1, delegationsRevoked: 2, departmentsCleared: 1, notified: 5 });
  assert.deepEqual(log.find(l => l[0] === 'item'), ['item', 11, { dispatchStatus: 'PENDING', acceptedAt: null, acceptedById: null }]);
  const notices = log.filter(l => l[0] === 'notify');
  assert.deepEqual(notices[0], ['notify', [16, 17], 'Cần phân công lại SO-1 (cán bộ nghỉ việc)']); // lãnh đạo phòng chủ trì (không gồm người nghỉ)
  assert.deepEqual(notices[1], ['notify', [16], 'Cần phân công lại SO-2 (cán bộ nghỉ việc)']); // người giao
  assert.deepEqual(notices[2][1], [2, 12]); // Giám đốc: phòng mất PGĐ phụ trách
  assert.deepEqual(log.filter(l => l[0] === 'unassign').map(l => l[1]), [11, 12, 13]);
  assert.deepEqual(log.filter(l => l[0] === 'unsupport').map(l => l[1]), [14]);
  assert.equal(log.filter(l => l[0] === 'activity' && l[2] === 'HANDOVER').length, 4);
  assert.ok(log.filter(l => l[0] === 'activity').every(l => !JSON.stringify(l[3]).includes('Việc')), 'activity không chép nội dung việc');
  assert.deepEqual(log.find(l => l[0] === 'clearSupervisor'), ['clearSupervisor', 29]);
  assert.equal(touched.length, 4);
});

test('nhật ký: admin IT không thấy giá trị trước–sau của đối tượng nghiệp vụ', () => {
  const row = { id: 1, action: 'UPDATE', entity: 'WorkItem', entityId: '5', oldValue: null, newValue: JSON.stringify({ title: 'Kế hoạch mật' }) };
  const it = presentAudit(row, { itAdmin: true });
  assert.equal(it.newValue, null); assert.equal(it.redacted, true); assert.equal(it.business, true); assert.equal(it.entityLabel, 'Công việc');
  assert.equal(presentAudit(row, { itAdmin: false }).newValue, row.newValue);
  for (const entity of ['Attachment', 'Project', 'Kpi', 'Summary', 'IntakeRequest', 'ApprovalRequest'])
    assert.equal(presentAudit({ ...row, entity }, { itAdmin: true }).newValue, null, entity);
  for (const entity of ['User', 'Department', 'Label', 'UserPermission', 'Auth', 'AppSetting', 'TaskTemplate', 'Delegation'])
    assert.equal(presentAudit({ ...row, entity }, { itAdmin: true }).newValue, row.newValue, entity);
  const user = presentAudit({ id: 2, action: 'DISPATCH_ACCEPT', entity: 'User', entityId: '29', newValue: JSON.stringify({ sensitive: true }) }, { itAdmin: true, names: { 'User:29': 'tp.khcn' } });
  assert.equal(user.entityName, 'tp.khcn'); assert.equal(user.actionLabel, 'Tiếp nhận, phân công'); assert.equal(user.sensitive, true);
  assert.equal(presentAudit({ id: 3, action: 'LOGIN_FAILED', entity: 'Auth', entityId: null, newValue: JSON.stringify({ username: 'khong.co', reason: 'NOT_FOUND' }) }).entityName, 'khong.co');
});

test('nhật ký: bộ lọc server (hành động, đối tượng, người thực hiện, khoảng ngày giờ Việt Nam)', () => {
  const w = auditWhere({ action: 'LOGIN_FAILED', entity: 'Auth', userId: '29', from: '2026-10-01', to: '2026-10-16' });
  assert.equal(w.action, 'LOGIN_FAILED'); assert.equal(w.entity, 'Auth');
  assert.deepEqual(w.AND, [{ OR: [{ userId: 29 }, { entity: 'Auth', entityId: '29' }] }]);
  assert.equal(w.createdAt.gte.toISOString(), '2026-09-30T17:00:00.000Z');
  assert.equal(w.createdAt.lte.toISOString(), '2026-10-16T16:59:59.999Z');
  assert.deepEqual(auditWhere({}), {});
  assert.throws(() => auditWhere({ from: 'abc' }), /Từ ngày/);
  assert.throws(() => auditWhere({ from: '2026-10-10', to: '2026-10-01' }), /Khoảng thời gian/);
  assert.throws(() => auditWhere({ userId: 'x' }), /Người thực hiện/);
});

test('đăng nhập không thành công: lý do; chỉ ghi tên khi tài khoản có thật (chuỗi lạ có thể là mật khẩu gõ nhầm ô)', () => {
  assert.deepEqual(failedLogin('khong.co', null), { entityId: null, value: { username: '(không có tài khoản này)', reason: 'NOT_FOUND' } });
  assert.deepEqual(failedLogin('cv.khcn1', { id: 18, username: 'cv.khcn1', isActive: false }), { entityId: 18, value: { username: 'cv.khcn1', reason: 'INACTIVE' } });
  assert.equal(failedLogin('cv.khcn1', { id: 18, username: 'cv.khcn1', isActive: true }).value.reason, 'WRONG_PASSWORD');
  assert.equal(failedLogin('secretpass2026', null).value.username, '(không có tài khoản này)');
});
