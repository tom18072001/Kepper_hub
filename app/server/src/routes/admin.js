// Quản trị: phòng ban, nhãn, tài khoản, phân quyền, nhật ký. Danh bạ người dùng cho việc giao việc.
const bcrypt = require('bcryptjs');
const { ROLES, ROLE_PROFILES, PERMISSIONS, isBusinessKey, isItAdmin, permissionScope, validGrant, canResetPassword, canGrant, normalizeGrants, replaceGrants, grantInitialPermissions, catalog } = require('../lib/permissions');
const { DEFAULT_PASSWORD, MIN_PASSWORD_LENGTH } = require('../lib/passwords');
const { fail, intParam, optionalInt, text } = require('../lib/http');
const { activity, notify } = require('../services/events');
const approval = require('../services/approval');
const bus = require('../services/bus');

const USER_SELECT = { id: true, username: true, fullName: true, displayTitle: true, email: true, phone: true, role: true, departmentId: true,
  isRootAdmin: true, isActive: true, mustChangePw: true, lastLoginAt: true, createdAt: true, department: { select: { id: true, name: true } } };
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
// Các quyền phải qua canGrant khi chuyển từ bộ hiện tại sang bộ đích (quyền rác không hợp lệ luôn được gỡ).
function grantsToCheck(diff) {
  return [...diff.added, ...diff.removed.filter(validGrant), ...diff.changed.flatMap(c => [{ ...c, scope: c.from }, { ...c, scope: c.to }].map(({ permissionKey, action, scope }) => ({ permissionKey, action, scope })).filter(validGrant))];
}
// Quyền nghiệp vụ phạm vi toàn tổ chức vừa được cấp (thêm mới hoặc nâng phạm vi) → báo Giám đốc.
function sensitiveGrants(diff) {
  return [...diff.added, ...diff.changed.map(({ permissionKey, action, to }) => ({ permissionKey, action, scope: to }))]
    .filter(g => isBusinessKey(g.permissionKey) && g.scope === 'SYSTEM');
}
function profileMismatch(user, grants) {
  if (user.isRootAdmin) return false;
  return profileDiff(grants, ROLE_PROFILES[user.role] || []).mismatch;
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
  PERMISSION_UPDATE: 'Phân quyền', ROLE_PROFILE_APPLY: 'Áp quyền mặc định theo vai trò', HANDOVER: 'Bàn giao khi nghỉ việc',
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
  WEEKLY_CONFIG: 'Thiết lập báo cáo tuần', WEEKLY_COMPLIANCE_SUBMIT: 'Trình bảng điểm tuân thủ giao ban', WEEKLY_COMPLIANCE_APPROVE: 'Duyệt bảng điểm tuân thủ giao ban',
};
const AUDIT_ENTITIES = {
  User: 'Tài khoản', Auth: 'Đăng nhập', Department: 'Phòng ban', UserPermission: 'Phân quyền', Label: 'Nhãn', AppSetting: 'Danh mục',
  TaskTemplate: 'Mẫu nhóm việc', Delegation: 'Uỷ quyền', WeeklyConfig: 'Thiết lập giao ban', WorkItem: 'Công việc', Project: 'Dự án / sổ', Attachment: 'Tệp đính kèm',
  ApprovalRequest: 'Yêu cầu duyệt', Cycle: 'Chu kỳ', RecurringRule: 'Việc lặp lại', IntakeRequest: 'Yêu cầu tiếp nhận', SavedView: 'Bộ lọc đã lưu',
  Plan: 'Kế hoạch năm', Summary: 'Tổng hợp giao việc', Kpi: 'KPI', WeeklyReport: 'Báo cáo tuần', WeeklyNotice: 'Thông báo muộn / vắng', WeeklyMeeting: 'Giao ban tuần', Ops: 'Trang Điều hành',
};
// Đối tượng kỹ thuật: admin IT xem được giá trị trước–sau. Mọi đối tượng khác là nghiệp vụ → admin IT chỉ thấy ai/lúc nào/mã đối tượng.
const NON_BUSINESS_ENTITIES = new Set(['User', 'Department', 'Label', 'UserPermission', 'Auth', 'AppSetting', 'TaskTemplate', 'Delegation']);
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
  if (!ROLES[value]) fail(422, 'Nhóm tài khoản không hợp lệ', 'INVALID_ROLE');
  return value;
}
async function departmentOf(prisma, value) {
  if (value === undefined) return undefined;
  const id = optionalInt(value, 'Phòng ban');
  if (id == null) return null;
  const dept = await prisma.department.findFirst({ where: { id, isActive: true } });
  if (!dept) fail(422, 'Phòng ban không tồn tại hoặc đã khoá', 'INVALID_DEPARTMENT');
  return id;
}
// PGĐ phụ trách phòng: tài khoản Ban giám đốc đang hoạt động.
async function supervisorOf(prisma, value) {
  if (value === undefined) return undefined;
  const id = optionalInt(value, 'PGĐ phụ trách');
  if (id == null) return null;
  if (!(await prisma.user.findFirst({ where: { id, isActive: true, role: 'director' } }))) fail(422, 'PGĐ phụ trách phải là tài khoản Ban giám đốc đang hoạt động', 'INVALID_SUPERVISOR');
  return id;
}
async function parentOf(prisma, value, id = null) {
  const parentId = optionalInt(value, 'Phòng ban cha');
  if (parentId == null) return null;
  const all = await prisma.department.findMany({ select: { id: true, parentId: true } });
  if (!all.some(d => d.id === parentId)) fail(422, 'Phòng ban cha không tồn tại', 'INVALID_PARENT');
  if (id != null && wouldCreateCycle(all, id, parentId)) fail(422, 'Không thể đặt trực thuộc vòng: phòng ban được chọn làm cấp trên đang trực thuộc (trực tiếp hoặc gián tiếp) phòng ban này', 'DEPARTMENT_CYCLE');
  return parentId;
}

const grantLabel = g => {
  const p = PERMISSIONS.find(x => x.key === g.permissionKey);
  return (p ? p.label : g.permissionKey) + (g.scope === 'SYSTEM' ? ' (toàn tổ chức)' : ' (phòng ban)');
};
// Báo mọi tài khoản Ban giám đốc đang hoạt động (trừ người thao tác) về thao tác quản trị nhạy cảm.
async function notifyDirectors(client, actor, title, detail = null) {
  const ids = (await client.user.findMany({ where: { role: 'director', isActive: true, id: { not: actor.id } }, select: { id: true } })).map(u => u.id);
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
    const directors = (await tx.user.findMany({ where: { role: 'director', isActive: true, id: { not: userId } }, select: { id: true } })).map(u => u.id);
    const names = depts.map(d => d.name).join(', ');
    counts.notified += await notify(tx, directors, { type: 'SUPERVISOR_REMOVED', title: `Cần chỉ định PGĐ phụ trách: ${names}`.slice(0, 300), body: 'PGĐ phụ trách vừa bị khoá tài khoản (nghỉ việc); phiếu trình của phòng tạm chuyển về Ban Giám đốc.', link: null }, actorId);
  }
  return { counts, touched, departments: depts.map(d => d.id) };
}

module.exports = function mountAdmin(app, { prisma, auth, audit, requirePermission }) {
  // ---------- Phòng ban ----------
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
    const data = { code: text(req.body.code, 'Mã phòng ban', { required: true, max: 30 }).toUpperCase(), name: text(req.body.name, 'Tên phòng ban', { required: true, max: 200 }), parentId: await parentOf(prisma, req.body.parentId), supervisorId: await supervisorOf(prisma, req.body.supervisorId) ?? null };
    const row = await prisma.department.create({ data });
    await audit(req, 'CREATE', 'Department', row.id, null, row);
    res.status(201).json(row);
  });
  app.put('/api/departments/:id', auth, requirePermission('admin.departments', 'OPERATE', 'SYSTEM'), async (req, res) => {
    const id = intParam(req.params.id);
    const old = await prisma.department.findUnique({ where: { id } });
    if (!old) fail(404, 'Không tìm thấy phòng ban', 'NOT_FOUND');
    const data = {};
    if (req.body.code !== undefined) data.code = text(req.body.code, 'Mã phòng ban', { required: true, max: 30 }).toUpperCase();
    if (req.body.name !== undefined) data.name = text(req.body.name, 'Tên phòng ban', { required: true, max: 200 });
    if (req.body.parentId !== undefined) data.parentId = await parentOf(prisma, req.body.parentId, id);
    if (req.body.isActive !== undefined) data.isActive = !!req.body.isActive;
    if (req.body.supervisorId !== undefined) {
      // Giữ nguyên PGĐ phụ trách hiện tại (kể cả đã khoá) thì không kiểm tra lại; chọn người mới phải là BGĐ đang hoạt động.
      const sup = optionalInt(req.body.supervisorId, 'PGĐ phụ trách');
      data.supervisorId = sup != null && sup === old.supervisorId ? sup : await supervisorOf(prisma, req.body.supervisorId);
    }
    const row = await prisma.department.update({ where: { id }, data });
    await audit(req, 'UPDATE', 'Department', id, old, row);
    res.json(row);
  });

  // ---------- Danh bạ (tối thiểu hoá trường trả về) ----------
  app.get('/api/users/directory', auth, async (req, res) => {
    res.json(await prisma.user.findMany({ where: { isActive: true }, orderBy: { fullName: 'asc' },
      select: { id: true, username: true, fullName: true, displayTitle: true, role: true, departmentId: true } }));
  });

  // ---------- Tài khoản ----------
  app.get('/api/admin/users', auth, requirePermission('admin.users', 'VIEW', 'SYSTEM'), async (req, res) => {
    const rows = await prisma.user.findMany({ orderBy: { id: 'asc' }, select: { ...USER_SELECT, permissions: { select: { permissionKey: true, action: true, scope: true } } } });
    res.json(rows.map(({ permissions, ...u }) => ({ ...u, profileMismatch: profileMismatch(u, permissions) })));
  });
  app.post('/api/admin/users', auth, requirePermission('admin.users', 'OPERATE', 'SYSTEM'), async (req, res) => {
    if (req.body.isRootAdmin !== undefined) fail(403, 'Không thể cấp tài khoản quản trị gốc qua API này', 'FORBIDDEN');
    const password = req.body.password ? String(req.body.password) : DEFAULT_PASSWORD;
    if (password.length < MIN_PASSWORD_LENGTH || !password.trim()) fail(422, 'Mật khẩu phải có ít nhất 6 ký tự và không chỉ gồm khoảng trắng');
    const data = {
      username: usernameOf(req.body.username), fullName: text(req.body.fullName, 'Họ tên', { required: true, max: 120 }),
      displayTitle: text(req.body.displayTitle, 'Chức danh', { max: 120 }) || null, email: text(req.body.email, 'Email', { max: 160 }) || null,
      phone: text(req.body.phone, 'Điện thoại', { max: 30 }) || null, role: roleOf(req.body.role) || 'member',
      departmentId: await departmentOf(prisma, req.body.departmentId) ?? null, passwordHash: await bcrypt.hash(password, 10), mustChangePw: true,
    };
    const sensitive = data.role === 'director';
    const user = await prisma.$transaction(async tx => {
      const created = await tx.user.create({ data });
      const granted = await grantInitialPermissions(tx, created, req.user.id);
      await audit(req, 'CREATE', 'User', created.id, null, { username: created.username, role: created.role, departmentId: created.departmentId, granted, ...(sensitive ? { sensitive: true } : {}) }, tx);
      if (sensitive) await notifyDirectors(tx, req.user, `Quản trị hệ thống vừa tạo tài khoản Ban giám đốc ${created.username}`, `${created.fullName} — được cấp quyền xem, duyệt công việc toàn tổ chức theo nhóm Ban giám đốc`);
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
    // Không tự đổi nhóm tài khoản của chính mình (vd. quản trị IT tự chuyển sang Ban giám đốc để đọc dữ liệu giao ban — QĐ-01).
    if (id === req.user.id && data.role !== undefined && data.role !== old.role) fail(403, 'Không tự đổi nhóm tài khoản của chính mình — nhờ một quản trị khác', 'SELF_ROLE_CHANGE');
    if (req.body.departmentId !== undefined) {
      // Giữ phòng hiện tại (kể cả phòng đã khoá) khi sửa thông tin khác; chuyển sang phòng mới thì phòng đó phải đang hoạt động.
      const dept = optionalInt(req.body.departmentId, 'Phòng ban');
      data.departmentId = dept != null && dept === old.departmentId ? dept : await departmentOf(prisma, req.body.departmentId);
    }
    if (req.body.isActive !== undefined) {
      data.isActive = !!req.body.isActive;
      if (old.isActive && !data.isActive) { data.sessionVersion = { increment: 1 }; data.deactivatedAt = new Date(); }
      if (!old.isActive && data.isActive) data.deactivatedAt = null;
    }
    const newRole = data.role ?? old.role;
    // Đổi vai trò kèm "Áp quyền mặc định của vai trò mới": thay toàn bộ quyền bằng hồ sơ vai trò (cần quyền Phân quyền).
    let profile = null;
    if (req.body.applyRoleProfile === true) {
      if (old.isRootAdmin) fail(403, 'Không thể thay đổi quyền tài khoản quản trị gốc', 'FORBIDDEN');
      if (permissionScope(req.user, 'admin.permissions', 'OPERATE') !== 'SYSTEM') fail(403, 'Cần quyền Phân quyền để áp quyền mặc định của vai trò', 'FORBIDDEN');
      const current = await prisma.userPermission.findMany({ where: { userId: id }, select: { permissionKey: true, action: true, scope: true } });
      const target = ROLE_PROFILES[newRole] || [];
      const diff = profileDiff(current, target);
      if (grantsToCheck(diff).some(g => !canGrant(req.user, g))) fail(403, 'Không thể cấp hoặc thu hồi quyền vượt phạm vi của bạn', 'FORBIDDEN');
      profile = { current, target, diff, sensitive: sensitiveGrants(diff) };
    }
    const toDirector = newRole === 'director' && old.role !== 'director';
    const handover = req.body.handover === true && (data.isActive === false || (data.isActive === undefined && !old.isActive));
    const result = await prisma.$transaction(async tx => {
      const row = await tx.user.update({ where: { id }, data, select: USER_SELECT });
      await audit(req, 'UPDATE', 'User', id, old, toDirector ? { ...row, sensitive: true } : row, tx);
      let applied = null;
      if (profile) {
        await replaceGrants(tx, id, profile.target, req.user.id);
        await tx.userPermission.updateMany({ where: { userId: id }, data: { source: 'ROLE_PROFILE' } });
        applied = { added: profile.diff.added.length, removed: profile.diff.removed.length, changed: profile.diff.changed.length };
        await audit(req, 'ROLE_PROFILE_APPLY', 'User', id, { role: old.role, grants: profile.current }, { role: newRole, grants: profile.target, ...(profile.sensitive.length || toDirector ? { sensitive: true } : {}) }, tx);
      }
      let done = null;
      if (handover) {
        done = await runHandover(tx, { userId: id, actorId: req.user.id });
        for (const deptId of done.departments) await audit(req, 'UPDATE', 'Department', deptId, { supervisorId: id }, { supervisorId: null, reason: 'HANDOVER' }, tx);
        await audit(req, 'HANDOVER', 'User', id, null, done.counts, tx);
      }
      if (toDirector) await notifyDirectors(tx, req.user, `Quản trị hệ thống vừa đổi tài khoản ${row.username} sang nhóm Ban giám đốc`, row.fullName + (profile ? ' — đã áp quyền mặc định của Ban giám đốc (toàn tổ chức)' : ''));
      else if (profile?.sensitive.length) await notifyDirectors(tx, req.user, `Quản trị hệ thống vừa cấp quyền toàn tổ chức cho tài khoản ${row.username}`, profile.sensitive.map(grantLabel).join(', '));
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
    const sensitive = target.role === 'director';
    await prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: target.id }, data: { passwordHash: await bcrypt.hash(DEFAULT_PASSWORD, 10), mustChangePw: true, sessionVersion: { increment: 1 } } });
      await audit(req, 'PASSWORD_RESET', 'User', target.id, null, sensitive ? { sensitive: true } : null, tx);
      if (sensitive) await notifyDirectors(tx, req.user, `Quản trị hệ thống vừa reset mật khẩu tài khoản ${target.username} (Ban giám đốc)`, 'Tài khoản phải đổi mật khẩu ở lần đăng nhập tới');
    });
    res.json({ ok: true });
  });

  // ---------- Phân quyền ----------
  app.get('/api/permissions/catalog', auth, (req, res) => res.json(catalog()));
  app.get('/api/admin/users/:id/permissions', auth, requirePermission('admin.permissions', 'VIEW', 'SYSTEM'), async (req, res) => {
    const id = intParam(req.params.id);
    const user = await prisma.user.findUnique({ where: { id }, select: { ...USER_SELECT, permissions: true } });
    if (!user) fail(404, 'Không tìm thấy tài khoản', 'NOT_FOUND');
    res.json({ user, grants: user.permissions.map(({ permissionKey, action, scope, source }) => ({ permissionKey, action, scope, source })) });
  });
  app.put('/api/admin/users/:id/permissions', auth, requirePermission('admin.permissions', 'OPERATE', 'SYSTEM'), async (req, res) => {
    const id = intParam(req.params.id);
    const user = await prisma.user.findUnique({ where: { id }, include: { permissions: true } });
    if (!user) fail(404, 'Không tìm thấy tài khoản', 'NOT_FOUND');
    if (user.isRootAdmin) fail(403, 'Không thể thay đổi quyền tài khoản quản trị gốc', 'FORBIDDEN');
    const requested = normalizeGrants(req.body.grants);
    if (!requested) fail(422, 'Danh sách quyền không hợp lệ', 'INVALID_GRANTS');
    if (user.role === 'admin' && requested.some(g => isBusinessKey(g.permissionKey)))
      fail(422, 'Tài khoản quản trị hệ thống không được cấp quyền xem/duyệt công việc, dự án, báo cáo', 'IT_ADMIN_NO_BUSINESS');
    const key = g => g.permissionKey + '|' + g.action + '|' + g.scope;
    const before = new Set(user.permissions.map(key)), after = new Set(requested.map(key));
    const changed = [...requested.filter(g => !before.has(key(g))), ...user.permissions.filter(g => !after.has(key(g)))];
    if (changed.some(g => !canGrant(req.user, g))) fail(403, 'Không thể cấp hoặc thu hồi quyền vượt phạm vi của bạn', 'FORBIDDEN');
    const sensitive = sensitiveGrants(profileDiff(user.permissions, requested));
    const grants = await prisma.$transaction(async tx => {
      const next = await replaceGrants(tx, id, requested, req.user.id);
      await audit(req, 'PERMISSION_UPDATE', 'User', id, user.permissions.map(({ permissionKey, action, scope }) => ({ permissionKey, action, scope })), sensitive.length ? { grants: requested, sensitive: true } : requested, tx);
      if (sensitive.length) await notifyDirectors(tx, req.user, `Quản trị hệ thống vừa cấp quyền toàn tổ chức cho tài khoản ${user.username}`, sensitive.map(grantLabel).join(', '));
      return next;
    });
    res.json({ ok: true, grants });
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
Object.assign(module.exports, { profileDiff, grantsToCheck, sensitiveGrants, profileMismatch, wouldCreateCycle, planHandover, presentAudit, auditWhere, isBusinessEntity, workloadOf, runHandover, AUDIT_ACTIONS, AUDIT_ENTITIES, NON_BUSINESS_ENTITIES });
