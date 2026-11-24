// Vai giao ban sau "một hệ quy chiếu": quyền thư ký / PMO của báo cáo tuần đến từ KIÊM NHIỆM (bộ phận thư ký, danh sách PMO do Ban TGĐ
// chọn — weekly.config), không từ vai. Tình huống chốt: tài khoản PMO kiêm thành viên bộ phận thư ký đổi vai sang Nhân viên vẫn giữ
// nguyên quyền báo cáo tuần. Dữ liệu GIẢ (id, bộ phận là số giả; không tên người thật).
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('./weekly-data');
const P = require('../lib/policy');
const { SYSTEM_VIEWER, permissionScope } = require('../lib/permissions');
const { itemVisibleWhere, visibleProjectsWhere } = require('./access');

const SECRETARY_DEPT = 20, OTHER_DEPT = 21;
const fakePrisma = cfg => ({ appSetting: { findUnique: async () => ({ key: D.CONFIG_KEY, value: cfg }) } });
const CFG = { secretaryDepartmentId: SECRETARY_DEPT, pmoUserIds: [6, 7] };

// Quyền báo cáo tuần của một người, đúng như routes/weekly.js dùng (P.can trên subject của rolesOf).
async function weeklyRights(user, cfg = CFG) {
  const s = await D.rolesOf(fakePrisma(cfg), user);
  const other = { departmentId: OTHER_DEPT };
  return {
    secretary: s.secretary, pmo: s.pmo, director: s.director,
    // Chi tiết mọi bộ phận (weekly.summary.detail) — cũng là điều kiện để hideUnseen KHÔNG lọc dòng.
    detail: P.can(s, 'view', 'weekly.summary.detail'),
    noHideUnseen: P.can(s, 'view', 'weekly.summary.detail'),
    // editsAll (routes/weekly.js) = sửa được báo cáo bộ phận + xem chi tiết; với bộ phận khác: nhập thay của thư ký.
    editsAllOther: P.can(s, 'edit', 'weekly.report', other) && P.can(s, 'view', 'weekly.summary.detail'),
    viewOther: P.can(s, 'view', 'weekly.report', other),
    // Sửa sau họp: điểm danh, kết luận, Action Log (weekly.meeting), thiết lập tuần (weekly.config), bảng điểm tuân thủ.
    meetingEdit: P.can(s, 'edit', 'weekly.meeting'),
    configEdit: P.can(s, 'edit', 'weekly.config'),
    compliance: P.can(s, 'view', 'weekly.compliance'),
    noticeNote: P.can(s, 'view', 'weekly.notice', { field: 'note' }),
    summary: P.can(s, 'view', 'weekly.summary'),
    rolesEdit: P.can(s, 'edit', 'weekly.roles'),
  };
}

test('PMO kiêm thư ký đổi vai Lãnh đạo bộ phận → Nhân viên: quyền báo cáo tuần GIỮ NGUYÊN (theo kiêm nhiệm, không theo vai)', async () => {
  const before = await weeklyRights({ id: 6, role: 'manager', departmentId: SECRETARY_DEPT, isRootAdmin: false });
  const after = await weeklyRights({ id: 6, role: 'member', departmentId: SECRETARY_DEPT, isRootAdmin: false });
  assert.deepEqual(after, before);
  assert.deepEqual(after, {
    secretary: true, pmo: true, director: false, detail: true, noHideUnseen: true, editsAllOther: true, viewOther: true,
    meetingEdit: true, configEdit: true, compliance: true, noticeNote: true, summary: true, rolesEdit: false,
  });
});

test('PMO (không thuộc bộ phận thư ký) là Nhân viên: xem đầy đủ mọi bộ phận, KHÔNG sửa / nhập thay', async () => {
  const r = await weeklyRights({ id: 7, role: 'member', departmentId: OTHER_DEPT + 1, isRootAdmin: false });
  assert.equal(r.pmo, true); assert.equal(r.secretary, false);
  assert.equal(r.detail, true); assert.equal(r.noHideUnseen, true); assert.equal(r.viewOther, true);
  assert.equal(r.editsAllOther, false); assert.equal(r.meetingEdit, false); assert.equal(r.noticeNote, false);
});

test('Nhân viên bộ phận thư ký (không trong danh sách PMO): quyền thư ký đủ; Nhân viên thường: chỉ bộ phận mình', async () => {
  const sec = await weeklyRights({ id: 8, role: 'member', departmentId: SECRETARY_DEPT, isRootAdmin: false });
  assert.equal(sec.secretary, true); assert.equal(sec.pmo, false);
  assert.equal(sec.editsAllOther, true); assert.equal(sec.meetingEdit, true); assert.equal(sec.noHideUnseen, true);
  const staff = await weeklyRights({ id: 9, role: 'member', departmentId: OTHER_DEPT, isRootAdmin: false });
  assert.equal(staff.detail, false); assert.equal(staff.noHideUnseen, false); assert.equal(staff.meetingEdit, false);
  assert.equal(staff.viewOther, true, 'bộ phận mình (OTHER_DEPT) — xem được');
  const staffElsewhere = await weeklyRights({ id: 9, role: 'member', departmentId: OTHER_DEPT + 5, isRootAdmin: false });
  assert.equal(staffElsewhere.viewOther, false, 'bộ phận khác — không xem');
});

test('Ban TGĐ (vai): chủ trì, không kiêm thư ký / PMO kể cả khi có tên trong danh sách hoặc thuộc bộ phận thư ký', async () => {
  const r = await weeklyRights({ id: 6, role: 'director', departmentId: SECRETARY_DEPT, isRootAdmin: false });
  assert.equal(r.director, true); assert.equal(r.secretary, false); assert.equal(r.pmo, false);
  assert.equal(r.detail, true); assert.equal(r.rolesEdit, true); assert.equal(r.editsAllOther, false);
});

test('chưa thiết lập danh sách PMO: Nhân viên / Lãnh đạo bộ phận KHÔNG tự thành PMO (chỉ vai có "Xem tổng hợp" toàn đơn vị)', async () => {
  for (const role of ['member', 'manager']) {
    const r = await weeklyRights({ id: 6, role, departmentId: OTHER_DEPT, isRootAdmin: false }, { secretaryDepartmentId: SECRETARY_DEPT });
    assert.equal(r.pmo, false, role);
  }
});

test('phạm vi bộ phận của báo cáo tuần (routes/weekly.js DEPT_SCOPE): chủ thể nội bộ thấy MỌI việc, quyền lấy theo vai', () => {
  assert.equal(permissionScope(SYSTEM_VIEWER, 'work.view', 'VIEW'), 'SYSTEM');
  assert.deepEqual(itemVisibleWhere(SYSTEM_VIEWER), {});
  assert.deepEqual(visibleProjectsWhere(SYSTEM_VIEWER), { deletedAt: null });
  assert.equal(SYSTEM_VIEWER.permissions, undefined, 'không mang bảng quyền riêng');
});
