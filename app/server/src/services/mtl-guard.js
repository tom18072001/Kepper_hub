// Kepper (MTL) — luật dữ liệu riêng của dự án Master Timeline. QUYỀN trên từng việc (ai sửa kế hoạch, ai cập nhật %, ai tạo việc nhánh…)
// đi qua MỘT nguồn: services/task-access.js. File này chỉ giữ:
//   • một nguồn %: việc cha = tổng hợp từ việc con — không nhập tay, không "đóng" tay việc cha còn việc con mở;
//   • tạo việc: việc gốc (bước MTL tổng) chỉ người quản lý dự án; việc nhánh do người chủ trì tạo thì máy chủ tự đặt cấu trúc;
//   • thao tác hàng loạt (nhập Excel, ghi chú → việc) và xuất tệp theo lib/policy.js.
const { fail, optionalInt } = require('../lib/http');
const { isItAdmin, isBoard } = require('../lib/permissions');
const Policy = require('../lib/policy');

// Trường người không phải người giao / Ban Giám đốc của việc cha không được tự đặt khi thêm việc nhánh (máy chủ tự tính / kế thừa).
const CREATE_STRIP = ['progress', 'weight', 'critical', 'milestone', 'planCode', 'planSection', 'stateId', 'leadDepartmentId', 'supportDepartmentIds', 'approvalLevels'];

const subjectOf = user => ({ userId: user.id, it: isItAdmin(user), director: isBoard(user) });

async function itemCtx(client, itemId) {
  const it = await client.workItem.findUnique({ where: { id: itemId }, select: { parentId: true, leadDepartmentId: true, progress: true,
    _count: { select: { children: { where: { archivedAt: null, state: { category: { notIn: ['COMPLETED', 'CANCELLED'] } } } } } } } });
  if (!it) fail(404, 'Không tìm thấy việc', 'NOT_FOUND');
  const allKids = await client.workItem.count({ where: { parentId: itemId, archivedAt: null } });
  return { ...it, openKids: it._count.children, allKids };
}

// Đổi % / trạng thái một hạng mục MTL (quyền đã kiểm bằng task-access): một nguồn %.
async function mtlGuard(client, user, project, rights, itemId, { manualPct = false, toState = null } = {}) {
  if (project.kind !== 'MTL' || (!manualPct && toState?.category !== 'COMPLETED')) return;
  const it = await itemCtx(client, itemId);
  if (manualPct && it.allKids) fail(422, 'Tiến độ việc cha tính tự động từ các việc con — cập nhật ở việc con', 'PROGRESS_FROM_CHILDREN');
  if (toState?.category === 'COMPLETED' && it.openKids) fail(422, `Còn ${it.openKids} việc con chưa xong — việc cha chỉ gửi duyệt được khi mọi việc con đã được duyệt hoàn thành`, 'PROGRESS_FROM_CHILDREN');
}

// Tạo việc trong dự án MTL. Việc gốc (bước MTL tổng): người quản lý dự án. Việc nhánh: quyền "tạo việc nhánh" của việc cha
// (task-access: người chủ trì, người giao, Ban Giám đốc) đã kiểm ở route; `planParent` = người tạo là người giao / BGĐ của việc cha.
// Người chủ trì thêm việc nhánh: bỏ các trường cấu trúc (kế thừa); việc nhánh đầu tiên nhận % hiện tại của cha để tiến độ không tụt.
async function mtlCreateGuard(client, user, project, rights, input = {}, { planParent = false } = {}) {
  if (project.kind !== 'MTL') return input;
  const parentId = optionalInt(input.parentId, 'Việc cha');
  if (!parentId) {
    Policy.assertCan(subjectOf(user), 'edit', 'mtl.plan', { item: { projectManager: !!rights.canManage } });
    return input;
  }
  const it = await itemCtx(client, parentId);
  const clean = { ...input };
  if (!planParent) for (const k of CREATE_STRIP) delete clean[k];
  if (!it.allKids && it.progress > 0 && clean.progress === undefined) clean.progress = Math.min(99, it.progress);
  return clean;
}

// Thao tác hàng loạt (nhập Excel, chuyển ghi chú thành việc): chỉ người quản lý dự án.
function mtlBulkGuard(user, project, rights) {
  if (project.kind !== 'MTL') return;
  Policy.assertCan(subjectOf(user), 'edit', 'mtl.plan', { item: { projectManager: !!rights.canManage } });
}

// Xuất dữ liệu MTL ra tệp: người quản lý dự án, Ban GĐ; lãnh đạo bộ phận chỉ phần bộ phận mình (deptLeader = true).
function mtlExportGuard(user, project, rights, { deptLeader = false } = {}) {
  if (project.kind !== 'MTL') return;
  Policy.assertCan(subjectOf(user), 'export', 'mtl.plan', { op: deptLeader ? 'dept' : undefined, item: { projectManager: !!rights.canManage, leadLeaderIds: deptLeader ? [user.id] : [] } });
}

module.exports = { CREATE_STRIP, subjectOf, mtlGuard, mtlCreateGuard, mtlBulkGuard, mtlExportGuard };
