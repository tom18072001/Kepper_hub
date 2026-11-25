// Quản trị: bộ phận, nhãn, tài khoản (vai, phạm vi phụ trách của BTGĐ), bảng quyền theo vai (chỉ xem), nhật ký. Danh bạ người dùng.
// Một hệ quy chiếu phân quyền (24/11/2026): quyền suy hoàn toàn từ vai — không còn chỉnh quyền từng người.
const bcrypt = require('bcryptjs');
const { ROLES, DEFAULT_ROLE, ROLE_PROFILES, isItAdmin, isBoard, isBoardDept, roleOf: roleKey, BOARD_WHERE, boardDeptMismatch, canResetPassword, catalog, syncRoleGrants } = require('../lib/permissions');
const { DEFAULT_PASSWORD, MIN_PASSWORD_LENGTH } = require('../lib/passwords');
const { fail, intParam, optionalInt, text } = require('../lib/http');
const { activity, notify } = require('../services/events');
const approval = require('../services/approval');
const bus = require('../services/bus');

const USER_SELECT = { id: true, username: true, fullName: true, displayTitle: true, email: true, phone: true, role: true, departmentId: true,
  isRootAdmin: true, isActive: true, boardAll: true, mustChangePw: true, lastLoginAt: true, createdAt: true, department: { select: { id: true, name: true } } };
const DAY = 86_400_000;

// ---------- Hàm thuần (unit test trong admin.test.js) ----------
const grantSlot = g => g.permissionKey + '|' + g.action;
const grantOf = (slot, scope) => { const [permissionKey, action] = slot.split('|'); return { permissionKey, action, scope }; };
// So sánh quyền hiện có với một bộ quyền đích (vd. hồ sơ vai trò): quyền thêm, bỏ, đổi phạm vi.
function profileDiff(current = [], target = []) {
  const cur = new Map(current.map(g => [grantSlot(g), g.scope])), next = new Map(target.map(g => [grantSlot(g), g.scope]));
  const added = [], removed = [], changed = [];
  for (const [slot, scope] of next) {
    if (!cur.has(slot)) added.push(grantOf(slot, scope));
    else if (cur.get(slot) !== scope) changed.push({ ...grantOf(slot, scope), from: cur.get(slot), to: scope });
  }
  for (const [slot, scope] of cur) if (!next.has(slot)) removed.push(grantOf(slot, scope));
  return { added, removed, changed, mismatch: added.length + removed.length + changed.length > 0 };
}
// Đặt `parentId` làm cha của phòng `id` có tạo vòng không (cha là chính nó hoặc nằm trong cây con của nó).
function wouldCreateCycle(departments, id, parentId) {
  if (parentId == null) return false;
  const parentOf = new Map(departments.map(d => [d.id, d.parentId ?? null]));
  const seen = new Set();
  for (let cur = parentId; cur != null; cur = parentOf.get(cur) ?? null) {
    if (cur === id) return true;
    if (seen.has(cur)) return true; // dữ liệu cũ đã có vòng
    seen.add(cur);
  }
  return false;
}
// Kế hoạch bàn giao khi khoá tài khoản `userId`: mỗi việc đang mở người đó chủ trì / phối hợp.
//   lead: gỡ khỏi chủ trì; sole: là người chủ trì duy nhất; reset: việc giao về phòng → trả về "Chờ phòng tiếp nhận";
//   notify: LEADERS (lãnh đạo phòng chủ trì) | ASSIGNER (người giao / trưởng dự án) | null; support: gỡ khỏi phối hợp.
function planHandover(items, userId) {
  return items.map(item => {
    const lead = item.assignees.some(a => a.userId === userId), support = item.supporters.some(s => s.userId === userId);
    const sole = lead && item.assignees.every(a => a.userId === userId);
    // Việc đang chờ duyệt (đã nộp sản phẩm): giữ nguyên để lãnh đạo duyệt tiếp; chỉ báo lãnh đạo phòng phân công người theo dõi.
    const reset = sole && !!item.dispatchStatus && item.state?.category !== 'REVIEW';
    return { itemId: item.id, lead, support, sole, reset, notify: sole ? (reset || item.dispatchStatus ? 'LEADERS' : 'ASSIGNER') : null };
  }).filter(p => p.lead || p.support);
}

// ---------- Nhật ký hệ thống ----------
const AUDIT_ACTIONS = {
  LOGIN: 'Đăng nhập', LOGIN_FAILED: 'Đăng nhập không thành công', PASSWORD_CHANGE: 'Đổi mật khẩu', PASSWORD_RESET: 'Reset mật khẩu',
  CREATE: 'Tạo mới', UPDATE: 'Cập nhật', DELETE: 'Xoá', REVOKE: 'Thu hồi',
  PERMISSION_UPDATE: 'Phân quyền (cũ)', ROLE_PROFILE_APPLY: 'Đổi vai (quyền theo vai)', BOARD_SCOPE_UPDATE: 'Đổi phạm vi phụ trách (Ban Tổng Giám đốc)', HANDOVER: 'Bàn giao khi nghỉ việc',
  DISPATCH_ACCEPT: 'Tiếp nhận, phân công', DISPATCH_BULK: 'Giao việc hàng loạt về phòng', EXTENSION_APPROVE: 'Đồng ý gia hạn', EXTENSION_REJECT: 'Không đồng ý gia hạn', SUBMIT: 'Nộp sản phẩm (phiếu trình)',
  APPROVAL_APPROVE: 'Duyệt', APPROVAL_REJECT: 'Trả lại khi duyệt', MOVE: 'Chuyển trạng thái',
  TRASH: 'Chuyển vào thùng rác', RESTORE: 'Khôi phục từ thùng rác', PURGE: 'Xoá hẳn (hết hạn thùng rác)',
  UPLOAD: 'Tải tệp lên', DOWNLOAD: 'Tải tệp xuống', PREVIEW: 'Xem trước tệp', DELETE_STORAGE_ERROR: 'Lỗi xoá tệp trong kho lưu trữ',
  UPDATE_SETTINGS: 'Cập nhật danh mục', VIEW_SUMMARY: 'Xem tổng hợp giao việc', EXPORT_SUMMARY: 'Xuất tổng hợp giao việc', VIEW_KPI: 'Xem KPI', VIEW_OPS: 'Xem trang Điều hành',
  IMPORT_PLAN: 'Nhập kế hoạch năm', IMPORT_REGISTER: 'Nhập sổ giao việc', EXPORT_REGISTER: 'Xuất sổ giao việc',
  IMPORT_EXCEL: 'Nhập Excel', EXPORT_EXCEL: 'Xuất Excel', EXPORT_WORD: 'Xuất báo cáo Word',
  RECURRING_RUN: 'Tạo việc lặp lại', CYCLE_ROLLOVER: 'Chuyển việc sang chu kỳ sau',
  INTAKE_ACCEPT: 'Tiếp nhận yêu cầu', INTAKE_DECLINE: 'Từ chối yêu cầu',
  UPDATE_STATES: 'Cập nhật cột trạng thái', UPDATE_MEMBERS: 'Cập nhật thành viên dự án', UPDATE_APPROVAL_STEPS: 'Cập nhật quy trình duyệt', UPDATE_APPROVAL_RULES: 'Cập nhật quy tắc duyệt',
  MTL_SPRINT_PLAN: 'Thiết lập sprint MTL', MTL_TEMPLATE_EXPORT: 'Tải mẫu MTL bộ phận',
  WEEKLY_REPORT_SUBMIT: 'Nộp báo cáo tuần', WEEKLY_NOTICE: 'Báo nộp muộn / vắng giao ban', WEEKLY_NOTICE_DELETE: 'Xoá thông báo muộn / vắng',
  WEEKLY_SUMMARY_COPY: 'Sao chép bản tổng hợp giao ban', WEEKLY_MEETING: 'Cập nhật giao ban (điểm danh, kết luận, Action Log)', WEEKLY_MEETING_PUBLISH: 'Phát hành kết luận giao ban',
  WEEKLY_CONFIG: 'Thiết lập báo cáo tuần', WEEKLY_COMPLIANCE_SUBMIT: 'Trình bảng điểm tuân thủ giao ban', WEEKLY_COMPLIANCE_APPROVE: 'Duyệt bảng điểm tuân thủ giao ban', WEEKLY_COMPLIANCE_UNLOCK: 'Mở khoá bảng điểm tuân thủ giao ban', TOKEN_CREATE: 'Tạo token Claude', TOKEN_REVOKE: 'Thu hồi token Claude',
  CRM_PARTNER_CREATE: 'Thêm đối tác', CRM_PARTNER_UPDATE: 'Sửa đối tác', CRM_CONTACT_CREATE: 'Thêm người liên hệ đối tác', CRM_CONTACT_UPDATE: 'Sửa người liên hệ đối tác', CRM_CONTACT_DELETE: 'Xoá người liên hệ đối tác',
  CRM_INTERACTION_CREATE: 'Ghi nhật ký làm việc với đối tác', CRM_FOLLOWUP_DONE: 'Xong việc theo dõi đối tác', CRM_ENGAGEMENT_CREATE: 'Thêm hợp đồng / gói thầu', CRM_ENGAGEMENT_UPDATE: 'Sửa hợp đồng / gói thầu',
  HRM_CONFIG: 'Thiết lập nhân sự', HR_PROFILE_UPDATE: 'Sửa hồ sơ nhân sự', HR_IDENTITY_VIEW: 'Xem số định danh', HR_IDENTITY_UPDATE: 'Sửa số định danh', HR_CONTRACT_CREATE: 'Thêm hợp đồng lao động', HR_CONTRACT_UPDATE: 'Sửa hợp đồng lao động',
  HR_LEAVE_CREATE: 'Tạo đơn nghỉ', HR_LEAVE_APPROVE: 'Duyệt đơn nghỉ', HR_LEAVE_REJECT: 'Từ chối đơn nghỉ', HR_LEAVE_CANCEL: 'Huỷ đơn nghỉ',
  HR_ATT_APPROVE: 'Duyệt giải trình chấm công', HR_ATT_REJECT: 'Từ chối giải trình chấm công', HR_ATT_IMPORT: 'Nhập dữ liệu máy chấm công',
};
const AUDIT_ENTITIES = {
  User: 'Tài khoản', Auth: 'Đăng nhập', Department: 'Bộ phận', UserPermission: 'Phân quyền', Label: 'Nhãn', AppSetting: 'Danh mục',
  TaskTemplate: 'Mẫu nhóm việc', Delegation: 'Uỷ quyền', WeeklyConfig: 'Thiết lập giao ban', ApiToken: 'Token Claude',
  CrmPartner: 'Đối tác', CrmContact: 'Người liên hệ đối tác', CrmInteraction: 'Nhật ký đối tác', CrmEngagement: 'Hợp đồng / gói thầu', HrmConfig: 'Thiết lập nhân sự',
  HrProfile: 'Hồ sơ nhân sự', HrContract: 'Hợp đồng lao động', HrLeave: 'Đơn nghỉ', HrAttendance: 'Chấm công', WorkItem: 'Công việc', Project: 'Dự án / sổ', Attachment: 'Tệp đính kèm',
  ApprovalRequest: 'Yêu cầu duyệt', Cycle: 'Chu kỳ', RecurringRule: 'Việc lặp lại', IntakeRequest: 'Yêu cầu tiếp nhận', SavedView: 'Bộ lọc đã lưu',
  Plan: 'Kế hoạch năm', Summary: 'Tổng hợp giao việc', Kpi: 'KPI', WeeklyReport: 'Báo cáo tuần', WeeklyNotice: 'Thông báo muộn / vắng', WeeklyMeeting: 'Giao ban tuần', WeeklyCompliance: 'Bảng điểm tuân thủ giao ban', Ops: 'Trang Điều hành',
};
// Đối tượng kỹ thuật: admin IT xem được giá trị trước–sau. Mọi đối tượng khác là nghiệp vụ → admin IT chỉ thấy ai/lúc nào/mã đối tượng.
const NON_BUSINESS_ENTITIES = new Set(['User', 'Department', 'Label', 'UserPermission', 'Auth', 'AppSetting', 'TaskTemplate', 'Delegation', 'ApiToken']);
const isBusinessEntity = entity => !NON_BUSINESS_ENTITIES.has(entity);
function parseJson(value) { if (value == null) return null; try { return JSON.parse(value); } catch { return null; } }
function presentAudit(row, { itAdmin = false, names = {} } = {}) {
  const business = isBusinessEntity(row.entity);
  const parsed = parseJson(row.newValue);
  const out = { ...row, business, actionLabel: AUDIT_ACTIONS[row.action] || null, entityLabel: AUDIT_ENTITIES[row.entity] || null,
    entityName: names[row.entity + ':' + row.entityId] || null, sensitive: !!(parsed && !Array.isArray(parsed) && parsed.sensitive === true) };
  if (row.entity === 'Auth' && !out.entityName && parsed?.username) out.entityName = parsed.username;
  if (itAdmin && business) { out.oldValue = null; out.newValue = null; out.redacted = row.oldValue != null || row.newValue != null; }
  return out;
}
// Ngày dạng yyyy-mm-dd theo giờ Việt Nam; `to` lấy hết ngày.
function auditDate(value, label, endOfDay = false) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + (endOfDay ? 'T23:59:59.999+07:00' : 'T00:00:00+07:00')) : new Date(s);
  if (Number.isNaN(d.getTime())) fail(422, label + ' không hợp lệ', 'INVALID_DATE');
  return d;
}
function auditWhere(query = {}) {
  const where = {}, and = [];
  if (query.entity) where.entity = String(query.entity).slice(0, 60);
  if (query.action) where.action = String(query.action).slice(0, 60);
  if (query.userId) {
    const userId = intParam(query.userId, 'Người thực hiện');
    // Người thực hiện, kể cả các lần đăng nhập không thành công vào tài khoản đó.
    and.push({ OR: [{ userId }, { entity: 'Auth', entityId: String(userId) }] });
  }
  const from = auditDate(query.from, 'Từ ngày'), to = auditDate(query.to, 'Đến ngày', true);
  if (from && to && from > to) fail(422, 'Khoảng thời gian không hợp lệ', 'INVALID_RANGE');
  if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  if (and.length) where.AND = and;
  return where;
}

// ---------- Kiểm tra đầu vào ----------
function usernameOf(value) {
  const username = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,50}$/.test(username)) fail(422, 'Tài khoản chỉ gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang (3–50 ký tự)', 'INVALID_USERNAME');
  return username;
}
function roleOf(value) {
  if (value === undefined) return undefined;
  if (!ROLES[value]) fail(422, 'Vai không hợp lệ', 'INVALID_ROLE');
  return value;
}
// Vai Ban Tổng Giám đốc phải khớp bộ phận Ban Tổng Giám đốc: lệch thì yêu cầu quản trị xác nhận (confirmBoardDept: true).
async function assertBoardDept(prisma, role, departmentId, confirmed) {
  const dept = departmentId != null ? await prisma.department.findUnique({ where: { id: departmentId }, select: { code: true } }) : null;
  const warning = boardDeptMismatch(role, dept);
  if (warning && confirmed !== true) fail(422, warning + ' — kiểm tra lại, hoặc xác nhận để vẫn lưu', 'BOARD_DEPT_MISMATCH');
  return warning;
}
async function departmentOf(prisma, value) {
  if (value === undefined) return undefined;
  const id = optionalInt(value, 'Bộ phận');
  if (id == null) return null;
  const dept = await prisma.department.findFirst({ where: { id, isActive: true } });
  if (!dept) fail(422, 'Bộ phận không tồn tại hoặc đã khoá', 'INVALID_DEPARTMENT');
  return id;
}
async function parentOf(prisma, value, id = null) {
  const parentId = optionalInt(value, 'Bộ phận cha');
  if (parentId == null) return null;
  const all = await prisma.department.findMany({ select: { id: true, parentId: true } });
  if (!all.some(d => d.id === parentId)) fail(422, 'Bộ phận cha không tồn tại', 'INVALID_PARENT');
  if (id != null && wouldCreateCycle(all, id, parentId)) fail(422, 'Không thể đặt trực thuộc vòng: bộ phận được chọn làm cấp trên đang trực thuộc (trực tiếp hoặc gián tiếp) bộ phận này', 'DEPARTMENT_CYCLE');
  return parentId;
}

// Thông báo Ban Tổng Giám đốc khi quản trị gán / đổi vai / bộ phận (đặc tả 5.1(4), mục 10 DET): MỌI lần tạo tài khoản; MỌI lần đổi vai; MỌI lần chuyển người
// vào / ra bộ phận Ban Tổng Giám đốc; MỌI lần quản trị xác nhận lưu tài khoản lệch vai ↔ bộ phận BTGĐ. Hàm thuần (admin.test.js).
//   change = { username, fullName, created, oldRole, newRole, oldInBoardDept, newInBoardDept, mismatch }
function roleNotices(c) {
  const label = r => ROLES[roleKey({ role: r })]?.label || r;
  const who = `${c.fullName} (${c.username})`;
  const out = [];
  if (c.created) {
    // Tạo tài khoản = gán vai: MỌI lần tạo đều báo (một quy tắc, không ngoại lệ — bảng 5.4 "Gán vai … BTGĐ được thông báo").
    out.push({ title: `Quản trị hệ thống vừa tạo tài khoản ${c.username} — vai ${label(c.newRole)}${c.newInBoardDept ? ', bộ phận Ban Tổng Giám đốc' : ''}`,
      detail: isBoard({ role: c.newRole }) ? `${c.fullName} — xem toàn công ty theo vai Ban Tổng Giám đốc` : who });
  } else {
    if (roleKey({ role: c.newRole }) !== roleKey({ role: c.oldRole })) out.push({ title: `Quản trị hệ thống vừa đổi vai tài khoản ${c.username}: ${label(c.oldRole)} → ${label(c.newRole)}`,
      detail: isBoard({ role: c.newRole }) ? `${c.fullName} — xem toàn công ty theo vai Ban Tổng Giám đốc` : isBoard({ role: c.oldRole }) ? `${c.fullName} — bỏ vai Ban Tổng Giám đốc và phạm vi phụ trách` : c.fullName });
    if (!c.oldInBoardDept && c.newInBoardDept) out.push({ title: `Quản trị hệ thống vừa chuyển ${c.username} vào bộ phận Ban Tổng Giám đốc`, detail: `${who} — vai ${label(c.newRole)}` });
    if (c.oldInBoardDept && !c.newInBoardDept) out.push({ title: `Quản trị hệ thống vừa chuyển ${c.username} ra khỏi bộ phận Ban Tổng Giám đốc`, detail: `${who} — vai ${label(c.newRole)}` });
  }
  if (c.mismatch) out.push({ title: `Quản trị hệ thống xác nhận lưu tài khoản lệch vai / bộ phận: ${c.username}`, detail: `${c.mismatch} — ${who}` });
  return out;
}
const inBoardDept = async (client, departmentId) => departmentId != null && isBoardDept(await client.department.findUnique({ where: { id: departmentId }, select: { code: true } }));
// Báo mọi thành viên Ban Tổng Giám đốc đang hoạt động (trừ người thao tác) về thao tác quản trị nhạy cảm.
async function notifyDirectors(client, actor, title, detail = null) {
  const ids = (await client.user.findMany({ where: { ...BOARD_WHERE, isActive: true, id: { not: actor.id } }, select: { id: true } })).map(u => u.id);
  const body = [detail, `Người thực hiện: ${actor.fullName} (${actor.username})`].filter(Boolean).join(' — ').slice(0, 1000);
  return notify(client, ids, { type: 'ADMIN_SENSITIVE', title: title.slice(0, 300), body, link: null }, actor.id);
}

const OPEN_ITEM = { archivedAt: null, project: { deletedAt: null }, state: { category: { notIn: ['COMPLETED', 'CANCELLED'] } } };
// Khối lượng đang có của một tài khoản — CHỈ số đếm, không trả tiêu đề / nội dung việc cho quản trị.
async function workloadOf(client, user, now = new Date()) {
  const id = user.id;
  const [lead, supportOpen, delegationsFrom, delegationsTo, supervisedDepartments, queue] = await Promise.all([
    client.workItem.findMany({ where: { ...OPEN_ITEM, assignees: { some: { userId: id } } }, select: { id: true, dispatchStatus: true, _count: { select: { assignees: true } } } }),
    client.workItem.count({ where: { ...OPEN_ITEM, supporters: { some: { userId: id } } } }),
    client.delegation.count({ where: { fromUserId: id, revokedAt: null, endsAt: { gte: now } } }),
    client.delegation.count({ where: { toUserId: id, revokedAt: null, endsAt: { gte: now } } }),
    client.department.count({ where: { supervisorId: id } }),
    approval.queueFor(client, { id }),
  ]);
  const sole = lead.filter(i => i._count.assignees === 1);
  return { leadOpen: lead.length, leadOnly: sole.length, leadOnlyDispatched: sole.filter(i => i.dispatchStatus).length, supportOpen,
    approvalsPending: queue.length, delegationsFrom, delegationsTo, supervisedDepartments };
}

// Bàn giao khi khoá tài khoản (chạy trong transaction, SAU khi tài khoản đã bị khoá để không tính người đó là lãnh đạo phòng).
async function runHandover(tx, { userId, actorId, now = new Date() }) {
  const counts = { leadRemoved: 0, returnedToDept: 0, reassignNotices: 0, supportRemoved: 0, delegationsRevoked: 0, departmentsCleared: 0, notified: 0 };
  counts.delegationsRevoked = (await tx.delegation.updateMany({ where: { OR: [{ fromUserId: userId }, { toUserId: userId }], revokedAt: null, endsAt: { gte: now } }, data: { revokedAt: now } })).count;
  const items = await tx.workItem.findMany({
    where: { ...OPEN_ITEM, OR: [{ assignees: { some: { userId } } }, { supporters: { some: { userId } } }] },
    select: { id: true, number: true, title: true, projectId: true, dispatchStatus: true, leadDepartmentId: true, assignedById: true, state: { select: { category: true } },
      project: { select: { id: true, key: true, leadId: true, departmentId: true } }, assignees: { select: { userId: true } }, supporters: { select: { userId: true } } },
    orderBy: { id: 'asc' },
  });
  const byId = new Map(items.map(i => [i.id, i]));
  const leaderCache = new Map();
  const leaders = async deptId => {
    if (deptId == null) return [];
    if (!leaderCache.has(deptId)) leaderCache.set(deptId, (await approval.deptLeaderIds(tx, deptId)).filter(x => x !== userId));
    return leaderCache.get(deptId);
  };
  const touched = [];
  for (const step of planHandover(items, userId)) {
    const item = byId.get(step.itemId), key = { workItemId: item.id, userId };
    if (step.lead) { await tx.workItemAssignee.delete({ where: { workItemId_userId: key } }); counts.leadRemoved++; }
    if (step.support) { await tx.workItemSupporter.delete({ where: { workItemId_userId: key } }); counts.supportRemoved++; }
    if (step.reset) { await tx.workItem.update({ where: { id: item.id }, data: { dispatchStatus: 'PENDING', acceptedAt: null, acceptedById: null } }); counts.returnedToDept++; }
    await activity(tx, item.id, actorId, 'HANDOVER', { userId, lead: step.lead, support: step.support, reset: step.reset });
    if (step.notify) {
      let to = step.notify === 'LEADERS' ? await leaders(item.leadDepartmentId) : [];
      if (!to.length) to = [item.assignedById !== userId ? item.assignedById : null].filter(Boolean);
      if (!to.length) to = [item.project.leadId !== userId ? item.project.leadId : null].filter(Boolean);
      if (!to.length) to = await leaders(item.leadDepartmentId ?? item.project.departmentId);
      const code = `${item.project.key}-${item.number}`;
      counts.notified += await notify(tx, to.filter(x => x !== userId), { type: 'HANDOVER', title: `Cần phân công lại ${code} (cán bộ nghỉ việc)`, body: item.title.slice(0, 300), link: `#/projects/${item.projectId}?item=${item.id}` }, actorId);
      counts.reassignNotices++;
    }
    touched.push({ projectId: item.projectId, itemId: item.id });
  }
  const depts = await tx.department.findMany({ where: { supervisorId: userId }, select: { id: true, name: true } });
  if (depts.length) {
    await tx.department.updateMany({ where: { supervisorId: userId }, data: { supervisorId: null } });
    counts.departmentsCleared = depts.length;
    const directors = (await tx.user.findMany({ where: { ...BOARD_WHERE, isActive: true, id: { not: userId } }, select: { id: true } })).map(u => u.id);
    const names = depts.map(d => d.name).join(', ');
    counts.notified += await notify(tx, directors, { type: 'SUPERVISOR_REMOVED', title: `Cần chỉ định Phó Tổng Giám đốc phụ trách: ${names}`.slice(0, 300), body: 'Phó Tổng Giám đốc phụ trách vừa bị khoá tài khoản (nghỉ việc); phiếu trình của bộ phận tạm chuyển về Ban Tổng Giám đốc.', link: null }, actorId);
  }
  return { counts, touched, departments: depts.map(d => d.id) };
}

// Phạm vi phụ trách của BTGĐ chỉ nhập ở MỘT chỗ: tài khoản (PUT /api/admin/users/:id/scope). Màn Bộ phận chỉ hiện.
function noSupervisorHere(body) {
  if (body.supervisorId !== undefined && body.supervisorId !== null && body.supervisorId !== '')
    fail(422, 'Phó Tổng Giám đốc phụ trách chọn ở tài khoản Ban Tổng Giám đốc (Phạm vi phụ trách), không chọn ở bộ phận', 'SUPERVISOR_VIA_USER');
}

module.exports = function mountAdmin(app, { prisma, auth, audit, requirePermission }) {
  // ---------- Bộ phận ----------
  app.get('/api/departments', auth, async (req, res) => {
    const rows = await prisma.department.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }], include: { _count: { select: { users: true, projects: true } } } });
    const [active, sups] = await Promise.all([
      prisma.user.groupBy({ by: ['departmentId'], where: { isActive: true, departmentId: { not: null } }, _count: { _all: true } }),
      prisma.user.findMany({ where: { id: { in: [...new Set(rows.map(r => r.supervisorId).filter(Boolean))] } }, select: { id: true, fullName: true, isActive: true } }),
    ]);
    const activeBy = new Map(active.map(a => [a.departmentId, a._count._all])), supBy = new Map(sups.map(u => [u.id, u]));
    res.json(rows.map(d => ({ ...d, activeUsers: activeBy.get(d.id) || 0, supervisor: supBy.get(d.supervisorId) || null })));
  });
  app.post('/api/departments', auth, requirePermission('admin.departments', 'OPERATE', 'SYSTEM'), async (req, res) => {
    const data = { code: text(req.body.code, 'Mã bộ phận', { required: true, max: 30 }).toUpperCase(), name: text(req.body.name, 'Tên bộ phận', { required: true, max: 200 }), parentId: await parentOf(prisma, req.body.parentId) };
    noSupervisorHere(req.body);
    const row = await prisma.department.create({ data });
    await audit(req, 'CREATE', 'Department', row.id, null, row);
    res.status(201).json(row);
  });
  app.put('/api/departments/:id', auth, requirePermission('admin.departments', 'OPERATE', 'SYSTEM'), async (req, res) => {
    const id = intParam(req.params.id);
    const old = await prisma.department.findUnique({ where: { id } });
    if (!old) fail(404, 'Không tìm thấy bộ phận', 'NOT_FOUND');
    const data = {};
    if (req.body.code !== undefined) data.code = text(req.body.code, 'Mã bộ phận', { required: true, max: 30 }).toUpperCase();
    if (req.body.name !== undefined) data.name = text(req.body.name, 'Tên bộ phận', { required: true, max: 200 });
    if (req.body.parentId !== undefined) data.parentId = await parentOf(prisma, req.body.parentId, id);
    if (req.body.isActive !== undefined) data.isActive = !!req.body.isActive;
    if (req.body.supervisorId !== undefined && (optionalInt(req.body.supervisorId, 'Phó Tổng Giám đốc phụ trách') ?? null) !== (old.supervisorId ?? null)) noSupervisorHere(req.body);
    // Đổi mã làm bộ phận trở thành / thôi là bộ phận Ban Tổng Giám đốc: đổi cách hệ thống cảnh báo vai ↔ bộ phận → nhật ký nhạy cảm + báo BTGĐ.
    const boardChanged = data.code !== undefined && isBoardDept(old) !== isBoardDept({ code: data.code });
    const row = await prisma.$transaction(async tx => {
      const updated = await tx.department.update({ where: { id }, data });
      await audit(req, 'UPDATE', 'Department', id, old, boardChanged ? { ...updated, sensitive: true } : updated, tx);
      if (boardChanged) await notifyDirectors(tx, req.user, isBoardDept(updated) ? `Quản trị hệ thống vừa đặt bộ phận ${updated.name} là bộ phận Ban Tổng Giám đốc (mã ${updated.code})`
        : `Quản trị hệ thống vừa đổi mã bộ phận ${old.name}: thôi là bộ phận Ban Tổng Giám đốc`, `Mã ${old.code} → ${updated.code}`);
      return updated;
    });
    res.json(row);
  });

  // ---------- Danh bạ (tối thiểu hoá trường trả về) ----------
  app.get('/api/users/directory', auth, async (req, res) => {
    const rows = await prisma.user.findMany({ where: { isActive: true }, orderBy: { fullName: 'asc' },
      select: { id: true, username: true, fullName: true, displayTitle: true, role: true, departmentId: true, avatarFile: true } });
    res.json(rows.map(({ avatarFile, ...u }) => ({ ...u, avatarUrl: avatarFile ? '/' + avatarFile : null })));
  });

  // ---------- Tài khoản ----------
  app.get('/api/admin/users', auth, requirePermission('admin.users', 'VIEW', 'SYSTEM'), async (req, res) => {
    const [rows, depts] = await Promise.all([
      prisma.user.findMany({ orderBy: { id: 'asc' }, select: { ...USER_SELECT, department: { select: { id: true, name: true, code: true } } } }),
      prisma.department.findMany({ where: { supervisorId: { not: null } }, select: { id: true, supervisorId: true } }),
    ]);
    // Phạm vi phụ trách (chỉ BTGĐ): Toàn công ty hoặc danh sách bộ phận; cảnh báo vai BTGĐ lệch bộ phận Ban Tổng Giám đốc.
    const D = require('../services/duties'), dutyCfg = await D.dutyConfig(prisma);
    res.json(rows.map(u => ({ ...u, supervisedDepartmentIds: depts.filter(d => d.supervisorId === u.id).map(d => d.id),
      boardMismatch: u.isActive ? boardDeptMismatch(u.role, u.department) : null, duties: D.dutiesFor(u, dutyCfg) })));
  });
  app.post('/api/admin/users', auth, requirePermission('admin.users', 'OPERATE', 'SYSTEM'), async (req, res) => {
    if (req.body.isRootAdmin !== undefined) fail(403, 'Không thể cấp tài khoản quản trị gốc qua API này', 'FORBIDDEN');
    const password = req.body.password ? String(req.body.password) : DEFAULT_PASSWORD;
    if (password.length < MIN_PASSWORD_LENGTH || !password.trim()) fail(422, 'Mật khẩu phải có ít nhất 6 ký tự và không chỉ gồm khoảng trắng');
    const data = {
      username: usernameOf(req.body.username), fullName: text(req.body.fullName, 'Họ tên', { required: true, max: 120 }),
      displayTitle: text(req.body.displayTitle, 'Chức danh', { max: 120 }) || null, email: text(req.body.email, 'Email', { max: 160 }) || null,
      phone: text(req.body.phone, 'Điện thoại', { max: 30 }) || null, role: roleOf(req.body.role) || DEFAULT_ROLE,
      departmentId: await departmentOf(prisma, req.body.departmentId) ?? null, passwordHash: await bcrypt.hash(password, 10), mustChangePw: true,
    };
    const mismatch = await assertBoardDept(prisma, data.role, data.departmentId, req.body.confirmBoardDept);
    const sensitive = isBoard(data);
    const user = await prisma.$transaction(async tx => {
      const created = await tx.user.create({ data });
      // Giai đoạn chuyển tiếp: ghi bộ quyền mặc định của vai (để quay lại bản cũ vẫn đúng quyền). Mã mới không đọc bảng này.
      await syncRoleGrants(tx, created, req.user.id);
      const notices = roleNotices({ username: created.username, fullName: created.fullName, created: true, newRole: created.role, newInBoardDept: await inBoardDept(tx, created.departmentId), mismatch });
      await audit(req, 'CREATE', 'User', created.id, null, { username: created.username, role: created.role, departmentId: created.departmentId, ...(mismatch ? { boardMismatch: mismatch } : {}), ...(sensitive || notices.length ? { sensitive: true } : {}) }, tx);
      for (const n of notices) await notifyDirectors(tx, req.user, n.title, n.detail);
      return created;
    });
    res.status(201).json(await prisma.user.findUnique({ where: { id: user.id }, select: USER_SELECT }));
  });
  app.put('/api/admin/users/:id', auth, requirePermission('admin.users', 'OPERATE', 'SYSTEM'), async (req, res) => {
    const id = intParam(req.params.id);
    const old = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!old) fail(404, 'Không tìm thấy tài khoản', 'NOT_FOUND');
    if (req.body.isRootAdmin !== undefined) fail(403, 'Không thể thay đổi tài khoản quản trị gốc qua API này', 'FORBIDDEN');
    if (req.body.password !== undefined || req.body.passwordHash !== undefined) fail(403, 'Hãy dùng chức năng Reset mật khẩu', 'FORBIDDEN');
    if (old.isRootAdmin && !req.user.isRootAdmin) fail(403, 'Không thể sửa tài khoản quản trị gốc', 'FORBIDDEN');
    if (old.isRootAdmin && req.body.isActive === false) fail(403, 'Không thể khoá tài khoản quản trị gốc', 'FORBIDDEN');
    const data = {};
    if (req.body.username !== undefined) data.username = usernameOf(req.body.username);
    if (req.body.fullName !== undefined) data.fullName = text(req.body.fullName, 'Họ tên', { required: true, max: 120 });
    for (const [key, label, max] of [['displayTitle', 'Chức danh', 120], ['email', 'Email', 160], ['phone', 'Điện thoại', 30]])
      if (req.body[key] !== undefined) data[key] = text(req.body[key], label, { max }) || null;
    if (req.body.role !== undefined) data.role = roleOf(req.body.role);
    // Không tự đổi vai của chính mình (vd. quản trị IT tự chuyển sang Ban Tổng Giám đốc để đọc dữ liệu giao ban — QĐ-01).
    if (id === req.user.id && data.role !== undefined && data.role !== old.role) fail(403, 'Không tự đổi vai của chính mình — nhờ một quản trị khác', 'SELF_ROLE_CHANGE');
    if (req.body.departmentId !== undefined) {
      // Giữ phòng hiện tại (kể cả phòng đã khoá) khi sửa thông tin khác; chuyển sang phòng mới thì phòng đó phải đang hoạt động.
      const dept = optionalInt(req.body.departmentId, 'Bộ phận');
      data.departmentId = dept != null && dept === old.departmentId ? dept : await departmentOf(prisma, req.body.departmentId);
    }
    if (req.body.isActive !== undefined) {
      data.isActive = !!req.body.isActive;
      if (old.isActive && !data.isActive) { data.sessionVersion = { increment: 1 }; data.deactivatedAt = new Date(); }
      if (!old.isActive && data.isActive) data.deactivatedAt = null;
    }
    const newRole = data.role ?? old.role;
    const newDept = data.departmentId !== undefined ? data.departmentId : old.departmentId;
    const roleChanged = roleKey({ role: newRole }) !== roleKey(old);
    const mismatch = roleChanged || newDept !== old.departmentId ? await assertBoardDept(prisma, newRole, newDept, req.body.confirmBoardDept) : null;
    const fromDirector = !isBoard({ role: newRole }) && isBoard(old);
    const deptMoved = newDept !== old.departmentId;
    const [oldInBoardDept, newInBoardDept] = deptMoved ? await Promise.all([inBoardDept(prisma, old.departmentId), inBoardDept(prisma, newDept)]) : [false, false];
    const notices = roleNotices({ username: old.username, fullName: old.fullName, oldRole: old.role, newRole, oldInBoardDept, newInBoardDept, mismatch });
    const handover = req.body.handover === true && (data.isActive === false || (data.isActive === undefined && !old.isActive));
    const result = await prisma.$transaction(async tx => {
      const row = await tx.user.update({ where: { id }, data, select: USER_SELECT });
      await audit(req, 'UPDATE', 'User', id, old, notices.length ? { ...row, ...(mismatch ? { boardMismatch: mismatch } : {}), sensitive: true } : row, tx);
      let applied = null;
      if (roleChanged) {
        // Quyền đi theo vai: ghi lại số quyền thêm / bớt do đổi vai để tra cứu.
        const diff = profileDiff(ROLE_PROFILES[roleKey(old)] || [], ROLE_PROFILES[roleKey({ role: newRole })] || []);
        applied = { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length };
        await audit(req, 'ROLE_PROFILE_APPLY', 'User', id, { role: old.role }, { role: newRole, ...applied, sensitive: true }, tx);
        // Giai đoạn chuyển tiếp: ghi lại bộ quyền theo vai mới để quay lại bản cũ vẫn đúng quyền.
        await syncRoleGrants(tx, { id, role: newRole, isRootAdmin: old.isRootAdmin }, req.user.id);
      }
      // Rời vai BTGĐ: bỏ phạm vi phụ trách (Toàn công ty, bộ phận) — phạm vi chỉ có nghĩa với vai BTGĐ.
      if (fromDirector) {
        if (old.boardAll) await tx.user.update({ where: { id }, data: { boardAll: false } });
        const depts = await tx.department.findMany({ where: { supervisorId: id }, select: { id: true } });
        if (depts.length) await tx.department.updateMany({ where: { supervisorId: id }, data: { supervisorId: null } });
        if (old.boardAll || depts.length) await audit(req, 'BOARD_SCOPE_UPDATE', 'User', id, { all: old.boardAll, departmentIds: depts.map(d => d.id) }, { all: false, departmentIds: [], reason: 'ROLE_CHANGE' }, tx);
      }
      let done = null;
      if (handover) {
        done = await runHandover(tx, { userId: id, actorId: req.user.id });
        for (const deptId of done.departments) await audit(req, 'UPDATE', 'Department', deptId, { supervisorId: id }, { supervisorId: null, reason: 'HANDOVER' }, tx);
        await audit(req, 'HANDOVER', 'User', id, null, done.counts, tx);
      }
      for (const n of notices) await notifyDirectors(tx, req.user, n.title, n.detail);
      return { row, applied, done };
    }, { timeout: 60_000 });
    for (const t of result.done?.touched || []) bus.item(t.projectId, t.itemId, req.user.id);
    res.json({ ...result.row, ...(result.applied ? { profileApplied: result.applied } : {}), ...(result.done ? { handover: result.done.counts } : {}) });
  });
  // Khối lượng đang có trước khi khoá tài khoản (nghỉ việc): chỉ số đếm.
  app.get('/api/admin/users/:id/workload', auth, requirePermission('admin.users', 'VIEW', 'SYSTEM'), async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: intParam(req.params.id) }, select: { id: true, isActive: true } });
    if (!user) fail(404, 'Không tìm thấy tài khoản', 'NOT_FOUND');
    res.json(await workloadOf(prisma, user));
  });
  app.post('/api/admin/users/:id/reset-password', auth, requirePermission('admin.users', 'OPERATE', 'SYSTEM'), async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: intParam(req.params.id) } });
    if (!target) fail(404, 'Không tìm thấy tài khoản', 'NOT_FOUND');
    if (!canResetPassword(req.user, target)) fail(403, 'Không thể reset mật khẩu tài khoản này', 'FORBIDDEN');
    // Người phụ trách nhân sự (HRM) xem được CCCD, lương của mọi người → reset mật khẩu của họ cũng là thao tác nhạy cảm, báo Ban TGĐ.
    const hrCfg = (await prisma.appSetting.findUnique({ where: { key: 'hrm.config' } }))?.value;
    const isHr = Array.isArray(hrCfg?.hrUserIds) && hrCfg.hrUserIds.map(Number).includes(target.id);
    const sensitive = isBoard(target) || isHr;
    await prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: target.id }, data: { passwordHash: await bcrypt.hash(DEFAULT_PASSWORD, 10), mustChangePw: true, sessionVersion: { increment: 1 } } });
      await audit(req, 'PASSWORD_RESET', 'User', target.id, null, sensitive ? { sensitive: true } : null, tx);
      if (sensitive) await notifyDirectors(tx, req.user, `Quản trị hệ thống vừa reset mật khẩu tài khoản ${target.username} (${isBoard(target) ? 'Ban Tổng Giám đốc' : 'người phụ trách nhân sự'})`, 'Tài khoản phải đổi mật khẩu ở lần đăng nhập tới');
    });
    res.json({ ok: true });
  });

  // ---------- Quyền theo vai (chỉ xem) ----------
  app.get('/api/permissions/catalog', auth, (req, res) => res.json(catalog()));
  app.get('/api/admin/users/:id/permissions', auth, requirePermission('admin.permissions', 'VIEW', 'SYSTEM'), async (req, res) => {
    const id = intParam(req.params.id);
    const user = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) fail(404, 'Không tìm thấy tài khoản', 'NOT_FOUND');
    res.json({ user, grants: user.isRootAdmin ? [] : (ROLE_PROFILES[roleKey(user)] || []).map(g => ({ ...g, source: 'ROLE' })), byRole: true });
  });
  // Quyền suy hoàn toàn từ vai (chủ dự án duyệt 24/11/2026): không còn chỉnh quyền từng người.
  app.put('/api/admin/users/:id/permissions', auth, requirePermission('admin.permissions', 'OPERATE', 'SYSTEM'), async () => {
    fail(410, 'Quyền đi theo vai — không chỉnh quyền từng người. Đổi vai của tài khoản, hoặc giao kiêm nhiệm / quan hệ với dự án (Chủ dự án, Thành viên)', 'PERMISSIONS_BY_ROLE');
  });

  // Phạm vi phụ trách của một thành viên Ban Tổng Giám đốc: Toàn công ty (User.boardAll) hoặc các bộ phận (Department.supervisorId).
  // BTGĐ phụ trách của một việc sửa kế hoạch, người giao, duyệt gia hạn, duyệt mốc / đường găng (services/task-access.js).
  // Chọn bộ phận đang có Phó TGĐ phụ trách khác → chuyển sang người này. Ghi nhật ký, báo Ban Tổng Giám đốc.
  app.put('/api/admin/users/:id/scope', auth, requirePermission('admin.permissions', 'OPERATE', 'SYSTEM'), async (req, res) => {
    const id = intParam(req.params.id);
    const user = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) fail(404, 'Không tìm thấy tài khoản', 'NOT_FOUND');
    if (id === req.user.id) fail(403, 'Không tự đặt phạm vi phụ trách của chính mình — nhờ một quản trị khác', 'SELF_ROLE_CHANGE');
    if (!isBoard(user)) fail(422, 'Chỉ tài khoản vai Ban Tổng Giám đốc có phạm vi phụ trách', 'NOT_BOARD');
    if (!user.isActive) fail(422, 'Tài khoản đã khoá', 'INACTIVE');
    if (typeof req.body?.all !== 'boolean') fail(422, 'Thiếu lựa chọn "Toàn công ty"', 'INVALID_VALUE');
    const raw = req.body.departmentIds ?? [];
    if (!Array.isArray(raw) || raw.length > 200) fail(422, 'Danh sách bộ phận không hợp lệ', 'INVALID_VALUE');
    const wanted = [...new Set(raw.map(v => intParam(v, 'Bộ phận')))];
    const valid = await prisma.department.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true, supervisorId: true, isActive: true } });
    if (valid.length !== wanted.length) fail(422, 'Bộ phận không tồn tại', 'INVALID_DEPARTMENT');
    const current = (await prisma.department.findMany({ where: { supervisorId: id }, select: { id: true } })).map(d => d.id);
    // Bộ phận đã khoá: chỉ giữ được nếu đang phụ trách sẵn, không nhận thêm.
    const locked = valid.filter(d => !d.isActive && !current.includes(d.id));
    if (locked.length) fail(422, 'Bộ phận đã khoá, không nhận thêm vào phạm vi phụ trách: ' + locked.map(d => d.name).join(', '), 'INACTIVE_DEPARTMENT');
    const before = { all: user.boardAll, departmentIds: [...current].sort((x, y) => x - y) };
    const after = { all: req.body.all, departmentIds: [...wanted].sort((x, y) => x - y) };
    if (JSON.stringify(before) === JSON.stringify(after)) return res.json({ ok: true, ...after });
    const takenFrom = valid.filter(d => d.supervisorId != null && d.supervisorId !== id).map(d => ({ departmentId: d.id, from: d.supervisorId }));
    await prisma.$transaction(async tx => {
      if (user.boardAll !== after.all) await tx.user.update({ where: { id }, data: { boardAll: after.all } });
      const drop = current.filter(d => !wanted.includes(d));
      if (drop.length) await tx.department.updateMany({ where: { id: { in: drop } }, data: { supervisorId: null } });
      if (wanted.length) await tx.department.updateMany({ where: { id: { in: wanted } }, data: { supervisorId: id } });
      await audit(req, 'BOARD_SCOPE_UPDATE', 'User', id, before, { ...after, ...(takenFrom.length ? { takenFrom } : {}), sensitive: true }, tx);
      const names = valid.map(d => d.name).join(', ');
      await notifyDirectors(tx, req.user, `Quản trị hệ thống vừa đổi phạm vi phụ trách của ${user.username}`,
        after.all ? 'Phụ trách Toàn công ty' + (names ? ` (trực tiếp: ${names})` : '') : names ? 'Phụ trách: ' + names : 'Không phụ trách bộ phận nào');
    });
    res.json({ ok: true, ...after });
  });

  // ---------- Tình trạng vận hành (sao lưu, job lịch chạy) — chỉ thông tin hệ thống ----------
  app.get('/api/admin/ops', auth, requirePermission('admin.audit', 'VIEW', 'SYSTEM'), async (req, res) => {
    const Ops = require('../services/ops'), { KEY } = require('../services/jobs');
    const [b, l] = await Promise.all([prisma.appSetting.findUnique({ where: { key: Ops.BACKUP_KEY } }), prisma.appSetting.findUnique({ where: { key: KEY } })]);
    const backup = b?.value || null, jobs = l?.value || {};
    res.setHeader('Cache-Control', 'private, no-store');
    const demoActive = (await prisma.user.findMany({ where: { isActive: true, username: { in: require('../seed').DEMO_USERNAMES } }, select: { username: true } })).map(u => u.username);
    res.json({ backup, jobs, problems: Ops.opsProblems({ backup, ledger: jobs, now: new Date(), demoActive }) });
  });

  // ---------- Nhật ký ----------
  app.get('/api/admin/audit', auth, requirePermission('admin.audit', 'VIEW', 'SYSTEM'), async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1), pageSize = [50, 100].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 50;
    const where = auditWhere(req.query);
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const idsOf = entities => [...new Set(rows.filter(r => entities.includes(r.entity)).map(r => Number(r.entityId)).filter(Number.isInteger))];
    const userIds = [...new Set([...rows.map(r => r.userId).filter(Boolean), ...idsOf(['User', 'Auth'])])];
    const [users, depts] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, username: true } }),
      prisma.department.findMany({ where: { id: { in: idsOf(['Department']) } }, select: { id: true, name: true } }),
    ]);
    const actor = new Map(users.map(u => [u.id, `${u.fullName} (${u.username})`]));
    const names = Object.fromEntries([...users.flatMap(u => [['User:' + u.id, u.username], ['Auth:' + u.id, u.username]]), ...depts.map(d => ['Department:' + d.id, d.name])]);
    const itAdmin = isItAdmin(req.user);
    res.json({ total, page, pageSize, labels: { actions: AUDIT_ACTIONS, entities: AUDIT_ENTITIES },
      items: rows.map(r => ({ ...presentAudit(r, { itAdmin, names }), actorName: r.userId ? actor.get(r.userId) || '#' + r.userId : (r.action === 'LOGIN_FAILED' ? 'Chưa đăng nhập' : 'Hệ thống') })) });
  });
};
Object.assign(module.exports, { profileDiff, roleNotices, wouldCreateCycle, planHandover, presentAudit, auditWhere, isBusinessEntity, workloadOf, runHandover, AUDIT_ACTIONS, AUDIT_ENTITIES, NON_BUSINESS_ENTITIES });
