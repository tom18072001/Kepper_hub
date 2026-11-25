// Thùng rác: việc / dự án bị xoá được giữ 7 ngày để khôi phục, sau đó hệ thống xoá hẳn (kể cả tệp đính kèm).
// Phiếu duyệt đang chờ của việc / dự án bị xoá KHÔNG bị huỷ: phiếu vẫn PENDING, ẩn khỏi hàng chờ và bị chặn mọi thao tác
// (services/approval.js assertNotInTrash) — khôi phục là phiếu hiện lại ở "Chờ tôi duyệt".
const storage = require('../lib/storage');
const { descendantIds } = require('./tree');
const { activity } = require('./events');

const TRASH_DAYS = 7;
const DAY = 86_400_000;
const purgeAt = deletedAt => new Date(new Date(deletedAt).getTime() + TRASH_DAYS * DAY);

// ---------- Chuyển tiếp: phiếu bị huỷ khi xoá vào Thùng rác ở bản cũ ----------
// Bản cũ huỷ phiếu PENDING lúc xoá (status CANCELLED, closedAt = lúc xoá):
//   • xoá dự án: một lệnh updateMany — KHÔNG ghi lượt CANCEL, KHÔNG ghi hoạt động APPROVAL_CANCELLED;
//   • xoá việc: approval.cancelPending — đúng một lượt CANCEL ghi chú "Xoá công việc" (kèm hoạt động APPROVAL_CANCELLED).
// Rút phiếu, chuyển khỏi cột Chờ duyệt, mở lại theo việc con… luôn có lượt CANCEL với lý do khác. Khôi phục bằng bản này thì mở lại
// đúng các phiếu do lần xoá đó huỷ: việc còn ở nhóm Chờ duyệt và chưa có phiếu nào mới hơn.
const TRASH_CANCEL_REASON = 'Xoá công việc';
const TRASH_CANCEL_WINDOW_MS = 10_000; // closedAt sát lúc xoá: cùng một thao tác, chênh vài giây
function cancelledByTrash(request, { trashedAt, by, itemCategory, hasNewer = false, cancelLogged = false } = {}) {
  if (!request || request.status !== 'CANCELLED' || !request.closedAt || !trashedAt) return false;
  const lag = new Date(request.closedAt).getTime() - new Date(trashedAt).getTime();
  if (!(lag >= -1000 && lag <= TRASH_CANCEL_WINDOW_MS)) return false;
  if (itemCategory !== 'REVIEW' || hasNewer) return false;
  const cancels = (request.actions || []).filter(a => a.decision === 'CANCEL');
  if (by === 'PROJECT') return cancels.length === 0 && !cancelLogged;
  if (by === 'ITEM') return cancels.length === 1 && cancels[0].comment === TRASH_CANCEL_REASON;
  return false;
}
// Mở lại (PENDING, closedAt null) các phiếu của những việc khớp `itemWhere` bị huỷ do lần xoá lúc `trashedAt`; ghi lịch sử việc.
// by: 'PROJECT' (khôi phục dự án) | 'ITEM' (khôi phục việc). Trả số phiếu đã mở lại.
async function reopenTrashCancelled(tx, { itemWhere, trashedAt, by, actorId }) {
  if (!trashedAt) return 0;
  const at = new Date(trashedAt).getTime();
  const candidates = await tx.approvalRequest.findMany({
    where: { status: 'CANCELLED', closedAt: { gte: new Date(at - 1000), lte: new Date(at + TRASH_CANCEL_WINDOW_MS) }, workItem: itemWhere },
    include: { actions: { select: { decision: true, comment: true } }, workItem: { select: { state: { select: { category: true } } } } },
  });
  if (!candidates.length) return 0;
  const itemIds = [...new Set(candidates.map(r => r.workItemId))];
  const all = await tx.approvalRequest.findMany({ where: { workItemId: { in: itemIds } }, select: { id: true, workItemId: true } });
  const latest = new Map();
  for (const r of all) latest.set(r.workItemId, Math.max(latest.get(r.workItemId) ?? 0, r.id));
  const logged = by === 'PROJECT'
    ? new Set((await tx.activity.findMany({ where: { workItemId: { in: itemIds }, type: 'APPROVAL_CANCELLED' }, select: { data: true } })).map(a => Number(a.data?.requestId)))
    : new Set();
  let reopened = 0;
  for (const r of candidates) {
    if (!cancelledByTrash(r, { trashedAt, by, itemCategory: r.workItem?.state?.category, hasNewer: latest.get(r.workItemId) !== r.id, cancelLogged: logged.has(r.id) })) continue;
    await tx.approvalRequest.update({ where: { id: r.id }, data: { status: 'PENDING', closedAt: null } });
    await activity(tx, r.workItemId, actorId, 'APPROVAL_REOPENED', { requestId: r.id, reason: by === 'PROJECT' ? 'PROJECT_RESTORED' : 'ITEM_RESTORED' });
    reopened++;
  }
  return reopened;
}

// Chuyển việc (và mọi việc con cháu) vào thùng rác. Trả về mã các việc bị xoá.
async function trashItem(tx, itemId, user, at = new Date()) {
  const ids = [itemId, ...(await descendantIds(tx, [itemId], { archivedAt: null }))];
  await tx.workItem.updateMany({ where: { id: { in: ids } }, data: { archivedAt: at, deletedById: user.id } });
  return ids;
}
// Khôi phục việc và các việc con cháu bị xoá cùng lúc.
async function restoreItem(tx, item) {
  const ids = [item.id, ...(await descendantIds(tx, [item.id], { archivedAt: item.archivedAt }))];
  await tx.workItem.updateMany({ where: { id: { in: ids } }, data: { archivedAt: null, deletedById: null } });
  return ids;
}

async function hardDeleteItems(prisma, where) {
  const items = await prisma.workItem.findMany({ where, select: { id: true, attachments: { select: { objectKey: true } } } });
  if (!items.length) return 0;
  const ids = items.map(i => i.id);
  // Việc con của việc bị xoá hẳn (nếu còn) được tách thành việc độc lập.
  await prisma.workItem.updateMany({ where: { parentId: { in: ids }, id: { notIn: ids } }, data: { parentId: null } });
  await prisma.workItem.deleteMany({ where: { id: { in: ids } } });
  await Promise.allSettled(items.flatMap(i => i.attachments.map(a => storage.remove(a.objectKey))));
  return ids.length;
}

// Xoá hẳn những gì đã nằm trong thùng rác quá 7 ngày. Ghi nhật ký (chỉ số lượng / mã, không ghi nội dung).
async function purgeTrash(prisma, now = new Date()) {
  const cutoff = new Date(now.getTime() - TRASH_DAYS * DAY);
  const projects = await prisma.project.findMany({ where: { deletedAt: { lte: cutoff } }, select: { id: true, key: true } });
  for (const p of projects) {
    await hardDeleteItems(prisma, { projectId: p.id });
    await prisma.project.delete({ where: { id: p.id } });
    await prisma.auditLog.create({ data: { action: 'PURGE', entity: 'Project', entityId: String(p.id), newValue: JSON.stringify({ key: p.key }) } });
  }
  const items = await hardDeleteItems(prisma, { archivedAt: { lte: cutoff }, project: { deletedAt: null } });
  if (items) await prisma.auditLog.create({ data: { action: 'PURGE', entity: 'WorkItem', entityId: null, newValue: JSON.stringify({ count: items }) } });
  return { projects: projects.length, items };
}

module.exports = { TRASH_DAYS, purgeAt, trashItem, restoreItem, purgeTrash, TRASH_CANCEL_REASON, TRASH_CANCEL_WINDOW_MS, cancelledByTrash, reopenTrashCancelled };
