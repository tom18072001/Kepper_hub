// Kepper (MTL) — cổng kiểm quy định phân quyền dữ liệu (lib/policy.js) dùng chung cho MỌI đường ghi vào dự án MTL:
// PATCH / kéo thả / checklist (routes/items.js), tạo việc (items, notes, dispatch, register), báo cáo tiến độ (dispatch),
// nhập Excel (excel), xuất (excel, reports, sprint).
//   mtl.progress  % / trạng thái / checklist: người được giao, lãnh đạo bộ phận chủ trì, người quản lý dự án.
//   mtl.plan      kế hoạch (tên, găng, mốc, hạn, trọng số, cấu trúc cây, bộ phận chủ trì): người quản lý dự án;
//                 lãnh đạo bộ phận chủ trì: chi tiết hoá (thêm việc con, sửa việc con) và phân công trong hạng mục bộ phận mình.
// Một nguồn sự thật cho %: việc cha = tổng hợp từ việc con, việc có checklist = theo checklist — không nhập tay.
const { fail, optionalInt } = require('../lib/http');
const { isItAdmin } = require('../lib/permissions');
const Policy = require('../lib/policy');
const approval = require('./approval');

const MTL_PLAN_KEYS = ['title', 'critical', 'milestone', 'ownerText', 'externalParty', 'weight', 'planCode', 'planSection', 'dueDate', 'startDate'];
// Nội dung thực hiện (dự báo hoàn thành, kết quả, mô tả, sản phẩm…): cùng quyền với cập nhật tiến độ (mtl.progress).
const MTL_WORK_KEYS = ['forecastEnd', 'resultNote', 'descriptionHtml', 'deliverable', 'outputs', 'note', 'budget', 'priority', 'internalDueDate'];
const MTL_STRUCT_KEYS = ['parentId', 'leadDepartmentId', 'supportDepartmentIds'];
// Trường người không phải quản lý dự án không được tự đặt khi thêm việc con (máy chủ tự tính / kế thừa).
const CREATE_STRIP = ['progress', 'weight', 'critical', 'milestone', 'planCode', 'planSection', 'stateId', 'leadDepartmentId', 'supportDepartmentIds', 'approvalLevels'];

const subjectOf = user => ({ userId: user.id, it: isItAdmin(user), director: user.role === 'director' });

async function itemCtx(client, project, rights, itemId) {
  const it = await client.workItem.findUnique({ where: { id: itemId }, select: { parentId: true, leadDepartmentId: true, progress: true, assignees: { select: { userId: true } },
    parent: { select: { leadDepartmentId: true } },
    _count: { select: { children: { where: { archivedAt: null, state: { category: { notIn: ['COMPLETED', 'CANCELLED'] } } } }, checklist: { where: { done: false } } } } } });
  if (!it) fail(404, 'Không tìm thấy việc', 'NOT_FOUND');
  const allKids = await client.workItem.count({ where: { parentId: itemId, archivedAt: null } });
  const allChecks = await client.checklistItem.count({ where: { workItemId: itemId } });
  const own = await approval.deptLeaderIds(client, it.leadDepartmentId);
  // Chi tiết hoá (sửa kế hoạch việc con): lãnh đạo bộ phận chủ trì BƯỚC CHA — không để bộ phận khác đổi trọng số / mốc trong bước của mình.
  const stepLeaders = it.parentId ? await approval.deptLeaderIds(client, it.parent?.leadDepartmentId) : own;
  return { it: { ...it, openKids: it._count.children, openChecks: it._count.checklist, allKids, allChecks },
    item: { assigneeIds: it.assignees.map(a => a.userId), leadLeaderIds: own, projectManager: !!rights.canManage },
    detail: { assigneeIds: [], leadLeaderIds: stepLeaders.filter(id => own.includes(id)), projectManager: !!rights.canManage } };
}

// PATCH / chuyển trạng thái / checklist / báo cáo tiến độ.
// toState / fromCategory: đổi trạng thái. Vào / ra "Huỷ" = sửa kế hoạch (huỷ làm hạng mục biến khỏi tiến độ, KPI, báo cáo tuần).
// Sang "Hoàn thành" khi còn việc con / mục checklist chưa xong → từ chối (một nguồn %: không "đóng" tay việc cha).
async function mtlGuard(client, user, project, rights, itemId, { progress = false, plan = false, struct = false, assign = false, manualPct = false, toState = null, fromCategory = null } = {}) {
  if (project.kind !== 'MTL') return;
  const cancel = !!toState && (toState.category === 'CANCELLED' || fromCategory === 'CANCELLED');
  if (cancel) plan = true;
  if (!progress && !plan && !struct && !assign && !toState) return;
  const { it, item, detail } = await itemCtx(client, project, rights, itemId);
  const s = subjectOf(user);
  if (progress || toState) Policy.assertCan(s, 'edit', 'mtl.progress', { item });
  // Bước MTL tổng (không có cha): kế hoạch chỉ người quản lý dự án; việc con: lãnh đạo bộ phận chủ trì bước cha (MTL bộ phận).
  if (plan) Policy.assertCan(s, 'edit', 'mtl.plan', it.parentId ? { item: detail, op: 'detail' } : { item });
  if (struct) Policy.assertCan(s, 'edit', 'mtl.plan', { item });
  if (assign) Policy.assertCan(s, 'edit', 'mtl.plan', { item, op: 'assign' });
  if (manualPct && it.allKids) fail(422, 'Tiến độ việc cha tính tự động từ các việc con — cập nhật ở việc con', 'PROGRESS_FROM_CHILDREN');
  if (manualPct && it.allChecks) fail(422, 'Tiến độ việc này tính theo checklist — đánh dấu các mục đã xong', 'PROGRESS_FROM_CHECKLIST');
  if (toState?.category === 'COMPLETED' && it.openKids) fail(422, `Còn ${it.openKids} việc con chưa xong — việc cha tự hoàn thành khi các việc con xong`, 'PROGRESS_FROM_CHILDREN');
  if (toState?.category === 'COMPLETED' && it.openChecks) fail(422, `Còn ${it.openChecks} mục checklist chưa xong`, 'PROGRESS_FROM_CHECKLIST');
}

// Xoá / khôi phục hạng mục MTL: bước tổng = cấu trúc (người quản lý dự án); việc con = chi tiết hoá (lãnh đạo bộ phận chủ trì bước cha).
async function mtlDeleteGuard(client, user, project, rights, itemId) {
  if (project.kind !== 'MTL') return;
  const { it, item, detail } = await itemCtx(client, project, rights, itemId);
  Policy.assertCan(subjectOf(user), 'edit', 'mtl.plan', it.parentId ? { item: detail, op: 'detail' } : { item });
}

// Tạo việc trong dự án MTL. Trả về input đã làm sạch (người không phải quản lý dự án: chỉ thêm việc con
// dưới hạng mục bộ phận mình chủ trì; kế thừa bộ phận chủ trì; việc con đầu tiên nhận % hiện tại của cha để tiến độ không tụt).
async function mtlCreateGuard(client, user, project, rights, input = {}) {
  if (project.kind !== 'MTL') return input;
  const s = subjectOf(user);
  if (rights.canManage && !s.it) return input;
  const parentId = optionalInt(input.parentId, 'Việc cha');
  if (!parentId) Policy.assertCan(s, 'edit', 'mtl.plan', { item: { projectManager: false } });
  const { it, item } = await itemCtx(client, project, rights, parentId);
  Policy.assertCan(s, 'edit', 'mtl.plan', { item, op: 'child' });
  const clean = { ...input };
  for (const k of CREATE_STRIP) delete clean[k];
  if (!it.allKids && it.progress > 0) clean.progress = Math.min(99, it.progress);
  return clean;
}

// Thao tác hàng loạt (nhập Excel, áp mẫu): chỉ người quản lý dự án.
function mtlBulkGuard(user, project, rights) {
  if (project.kind !== 'MTL') return;
  Policy.assertCan(subjectOf(user), 'edit', 'mtl.plan', { item: { projectManager: !!rights.canManage } });
}

// Xuất dữ liệu MTL ra tệp: người quản lý dự án, Ban GĐ; lãnh đạo bộ phận chỉ phần bộ phận mình (deptLeader = true).
function mtlExportGuard(user, project, rights, { deptLeader = false } = {}) {
  if (project.kind !== 'MTL') return;
  Policy.assertCan(subjectOf(user), 'export', 'mtl.plan', { op: deptLeader ? 'dept' : undefined, item: { projectManager: !!rights.canManage, leadLeaderIds: deptLeader ? [user.id] : [] } });
}

module.exports = { MTL_PLAN_KEYS, MTL_WORK_KEYS, MTL_STRUCT_KEYS, CREATE_STRIP, subjectOf, mtlGuard, mtlDeleteGuard, mtlCreateGuard, mtlBulkGuard, mtlExportGuard };
