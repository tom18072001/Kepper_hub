// Quyền ở cấp dự án = quyền hệ thống (permissions.js) giao với thành viên dự án và phạm vi phòng ban.
const { permissionScope, hasPermission, isItAdmin } = require('../lib/permissions');
const { fail } = require('../lib/http');

function projectRights(user, project, member) {
  const viewScope = permissionScope(user, 'work.view', 'VIEW');
  const sameDept = user.departmentId != null && Number(user.departmentId) === Number(project.departmentId);
  const isMember = !!member;
  const canView = viewScope === 'SYSTEM' || (isMember && !isItAdmin(user))
    || (!!viewScope && ['PUBLIC', 'ASSIGNED'].includes(project.visibility))
    || (viewScope === 'UNIT' && sameDept && project.visibility === 'DEPARTMENT');
  const editScope = permissionScope(user, 'work.edit', 'OPERATE');
  const canEdit = canView && !project.archivedAt && (editScope === 'SYSTEM'
    || (!!editScope && isMember && member.role !== 'VIEWER')
    // Sổ giao việc của đơn vị: ai thấy việc (theo quyền xem từng việc) thì cập nhật được việc đó.
    || (!!editScope && project.visibility === 'ASSIGNED')
    || (editScope === 'UNIT' && sameDept && project.visibility !== 'PRIVATE'));
  const manageScope = permissionScope(user, 'projects.manage', 'OPERATE');
  // Dự án MTL (kế hoạch chính thức dùng chung): người quản lý = quyền quản lý toàn công ty, chủ dự án (OWNER) hoặc trưởng dự án —
  // không mở cho mọi trưởng / phó của phòng sở hữu dự án (họ là lãnh đạo bộ phận chủ trì phần của mình, xem lib/policy.js).
  const mtl = project.kind === 'MTL';
  const canManage = manageScope === 'SYSTEM' || (manageScope === 'UNIT' && sameDept && !mtl)
    || (!isItAdmin(user) && ((isMember && member.role === 'OWNER') || (mtl && project.leadId === user.id)));
  const deleteScope = permissionScope(user, 'work.delete', 'OPERATE');
  const canDelete = canEdit && (deleteScope === 'SYSTEM' || (deleteScope === 'UNIT' && sameDept) || canManage);
  return { canView, canEdit, canManage, canDelete, memberRole: member ? member.role : null };
}

async function loadProject(prisma, user, projectId, need = 'view', { allowDeleted = false } = {}) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || (project.deletedAt && !allowDeleted)) fail(404, 'Không tìm thấy dự án', 'NOT_FOUND');
  const member = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } });
  const rights = projectRights(user, project, member);
  // Không lộ sự tồn tại của dự án mà người dùng không được xem.
  if (!rights.canView) fail(404, 'Không tìm thấy dự án', 'NOT_FOUND');
  if (need === 'edit' && !rights.canEdit) fail(403, 'Bạn không có quyền cập nhật công việc trong dự án này', 'FORBIDDEN');
  if (need === 'manage' && !rights.canManage) fail(403, 'Bạn không có quyền quản lý dự án này', 'FORBIDDEN');
  if (need === 'delete' && !rights.canDelete) fail(403, 'Bạn không có quyền xoá công việc', 'FORBIDDEN');
  return { project, member, rights };
}

// Lãnh đạo phòng (trưởng / phó phòng): có quyền duyệt ở phạm vi phòng ban.
const isDeptLeader = user => !!user && user.departmentId != null && permissionScope(user, 'work.approve', 'OPERATE') === 'UNIT';
const ITEM_ACCESS_SELECT = { id: true, projectId: true, parentId: true, assignedById: true, reporterId: true, leadDepartmentId: true,
  assignees: { select: { userId: true } }, supporters: { select: { userId: true } }, supportDepartments: { select: { departmentId: true } } };
// Sổ giao việc của đơn vị (visibility ASSIGNED): chỉ Ban Giám đốc (xem toàn tổ chức), thành viên sổ, người giao,
// người chủ trì / phối hợp và lãnh đạo phòng chủ trì / phòng phối hợp thấy việc (quyền xem theo từng việc).
function canSeeItem(user, project, member, item, parent = null) {
  if (project.visibility !== 'ASSIGNED') return true;
  if (permissionScope(user, 'work.view', 'VIEW') === 'SYSTEM' || member) return true;
  const ok = it => !!it && (it.assignedById === user.id || it.assignees.some(a => a.userId === user.id) || it.supporters.some(a => a.userId === user.id)
    || (isDeptLeader(user) && (it.leadDepartmentId === user.departmentId || it.supportDepartments.some(d => d.departmentId === user.departmentId))));
  return ok(item) || ok(parent);
}
function itemVisibleWhere(user) {
  if (permissionScope(user, 'work.view', 'VIEW') === 'SYSTEM') return {};
  const mine = [{ assignedById: user.id }, { assignees: { some: { userId: user.id } } }, { supporters: { some: { userId: user.id } } }];
  if (isDeptLeader(user)) mine.push({ leadDepartmentId: user.departmentId }, { supportDepartments: { some: { departmentId: user.departmentId } } });
  return { OR: [{ project: { visibility: { not: 'ASSIGNED' } } }, { project: { members: { some: { userId: user.id } } } }, ...mine, { parent: { OR: mine } }] };
}
// Sổ giao việc của đơn vị: thao tác cấp sổ (giao việc gốc, nhập hàng loạt, tiếp nhận yêu cầu, chuyển ghi chú,
// chuyển chu kỳ, xem quy tắc lặp) chỉ dành cho Ban Giám đốc / người quản lý sổ / thành viên sổ.
// Thành viên "Người xem" (VIEWER) chỉ xem, không giao việc.
const isRegisterWriter = member => !!member && member.role !== 'VIEWER';
function assertRegisterManager(project, rights, member) {
  if (project.visibility === 'ASSIGNED' && !rights.canManage && !isRegisterWriter(member))
    fail(403, 'Chỉ Ban Giám đốc / người quản lý sổ được thao tác này trên sổ giao việc của đơn vị', 'FORBIDDEN');
}
// Người được uỷ quyền (trong thời hạn) xem được — chỉ xem — việc mà người uỷ quyền xem được (để duyệt thay từ hàng chờ duyệt).
async function delegatedView(prisma, user, item, parent) {
  const now = new Date();
  const rows = await prisma.delegation.findMany({ where: { toUserId: user.id, revokedAt: null, startsAt: { lte: now }, endsAt: { gte: now } }, select: { fromUserId: true } });
  if (!rows.length) return null;
  const project = await prisma.project.findUnique({ where: { id: item.projectId } });
  if (!project || project.deletedAt) return null;
  for (const r of rows) {
    const from = await prisma.user.findFirst({ where: { id: r.fromUserId, isActive: true }, include: { permissions: true } });
    if (!from) continue;
    const member = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: project.id, userId: from.id } } });
    if (projectRights(from, project, member).canView && canSeeItem(from, project, member, item, parent))
      return { project, member: null, rights: { canView: true, canEdit: false, canManage: false, canDelete: false, memberRole: null, delegated: true } };
  }
  return null;
}
async function loadItem(prisma, user, itemId, need = 'view') {
  const item = await prisma.workItem.findUnique({ where: { id: itemId }, select: ITEM_ACCESS_SELECT });
  if (!item) fail(404, 'Không tìm thấy công việc', 'NOT_FOUND');
  const parentOf = () => (item.parentId ? prisma.workItem.findUnique({ where: { id: item.parentId }, select: ITEM_ACCESS_SELECT }) : null);
  let ctx;
  try { ctx = await loadProject(prisma, user, item.projectId, need); }
  catch (error) {
    if (error.status !== 404) throw error;
    const viaDelegation = need === 'view' ? await delegatedView(prisma, user, item, await parentOf()) : null;
    if (!viaDelegation) fail(404, 'Không tìm thấy công việc', 'NOT_FOUND');
    return { ...viaDelegation, itemId: item.id, access: item };
  }
  if (ctx.project.visibility === 'ASSIGNED') {
    const parent = await parentOf();
    // Người được uỷ quyền (trong thời hạn) thay lãnh đạo phòng chủ trì cũng thấy việc của phòng đó.
    const delegated = async () => {
      const dept = item.leadDepartmentId ?? parent?.leadDepartmentId;
      return dept != null && (await require('./approval').deptLeaderIds(prisma, dept)).includes(user.id);
    };
    // Thành viên sổ (vd. Văn phòng nhập thay) xem được cả sổ nhưng chỉ sửa việc mình giao hoặc mình liên quan.
    if (need !== 'view' && ctx.member && ctx.member.role !== 'OWNER' && !ctx.rights.canManage && item.reporterId !== user.id && !canSeeItem(user, ctx.project, null, item, parent) && !(await delegated()))
      fail(403, 'Thành viên sổ chỉ cập nhật việc mình giao hoặc được giao', 'FORBIDDEN');
    if (!canSeeItem(user, ctx.project, ctx.member, item, parent) && !(await delegated())) {
      const viaDelegation = need === 'view' ? await delegatedView(prisma, user, item, parent) : null;
      if (!viaDelegation) fail(404, 'Không tìm thấy công việc', 'NOT_FOUND');
      return { ...viaDelegation, itemId: item.id, access: item };
    }
  }
  return { ...ctx, itemId: item.id, access: item };
}

// Điều kiện Prisma: các dự án người dùng được xem.
function visibleProjectsWhere(user) {
  const viewScope = permissionScope(user, 'work.view', 'VIEW');
  if (isItAdmin(user)) return { id: -1 };
  if (viewScope === 'SYSTEM') return { deletedAt: null };
  const or = [{ members: { some: { userId: user.id } } }];
  if (viewScope) or.push({ visibility: { in: ['PUBLIC', 'ASSIGNED'] } });
  if (viewScope === 'UNIT' && user.departmentId != null) or.push({ visibility: 'DEPARTMENT', departmentId: user.departmentId });
  return { deletedAt: null, OR: or };
}

function canCreateProjectIn(user, departmentId) {
  const scope = permissionScope(user, 'projects.manage', 'OPERATE');
  return scope === 'SYSTEM' || (scope === 'UNIT' && Number(departmentId) === Number(user.departmentId));
}
function dashboardScope(user) {
  return permissionScope(user, 'reports.dashboard', 'VIEW');
}

module.exports = { projectRights, loadProject, loadItem, visibleProjectsWhere, itemVisibleWhere, canSeeItem, isDeptLeader, assertRegisterManager, isRegisterWriter, ITEM_ACCESS_SELECT, canCreateProjectIn, dashboardScope, hasPermission };
