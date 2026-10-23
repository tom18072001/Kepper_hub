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
const MTL_STRUCT_KEYS = ['parentId', 'leadDepartmentId', 'supportDepartmentIds'];
// Trường người không phải quản lý dự án không được tự đặt khi thêm việc con (máy chủ tự tính / kế thừa).
const CREATE_STRIP = ['progress', 'weight', 'critical', 'milestone', 'planCode', 'planSection', 'stateId', 'leadDepartmentId', 'supportDepartmentIds', 'approvalLevels'];

const subjectOf = user => ({ userId: user.id, it: isItAdmin(user), director: user.role === 'director' });

async function itemCtx(client, project, rights, itemId) {
  const it = await client.workItem.findUnique({ where: { id: itemId }, select: { parentId: true, leadDepartmentId: true, progress: true, assignees: { select: { userId: true } },
    _count: { select: { children: { where: { archivedAt: null } }, checklist: true } } } });
  if (!it) fail(404, 'Không tìm thấy việc', 'NOT_FOUND');
  return { it, item: { assigneeIds: it.assignees.map(a => a.userId), leadLeaderIds: await approval.deptLeaderIds(client, it.leadDepartmentId), projectManager: !!rights.canManage } };
}

// PATCH / chuyển trạng thái / checklist / báo cáo tiến độ.
async function mtlGuard(client, user, project, rights, itemId, { progress = false, plan = false, struct = false, assign = false, manualPct = false } = {}) {
  if (project.kind !== 'MTL' || (!progress && !plan && !struct && !assign)) return;
  const { it, item } = await itemCtx(client, project, rights, itemId);
  const s = subjectOf(user);
  if (progress) Policy.assertCan(s, 'edit', 'mtl.progress', { item });
  // Bước MTL tổng (không có cha): kế hoạch chỉ người quản lý dự án; việc con: thêm lãnh đạo bộ phận chủ trì (MTL bộ phận).
  if (plan) Policy.assertCan(s, 'edit', 'mtl.plan', { item, op: it.parentId ? 'detail' : undefined });
  if (struct) Policy.assertCan(s, 'edit', 'mtl.plan', { item });
  if (assign) Policy.assertCan(s, 'edit', 'mtl.plan', { item, op: 'assign' });
  if (manualPct && it._count.children) fail(422, 'Tiến độ việc cha tính tự động từ các việc con — cập nhật ở việc con', 'PROGRESS_FROM_CHILDREN');
  if (manualPct && it._count.checklist) fail(422, 'Tiến độ việc này tính theo checklist — đánh dấu các mục đã xong', 'PROGRESS_FROM_CHECKLIST');
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
  if (!it._count.children && it.progress > 0) clean.progress = it.progress;
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

module.exports = { MTL_PLAN_KEYS, MTL_STRUCT_KEYS, CREATE_STRIP, subjectOf, mtlGuard, mtlCreateGuard, mtlBulkGuard, mtlExportGuard };
