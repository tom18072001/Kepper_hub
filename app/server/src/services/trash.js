// Thùng rác: việc / dự án bị xoá được giữ 7 ngày để khôi phục, sau đó hệ thống xoá hẳn (kể cả tệp đính kèm).
const storage = require('../lib/storage');
const { descendantIds } = require('./tree');

const TRASH_DAYS = 7;
const DAY = 86_400_000;
const purgeAt = deletedAt => new Date(new Date(deletedAt).getTime() + TRASH_DAYS * DAY);

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

module.exports = { TRASH_DAYS, purgeAt, trashItem, restoreItem, purgeTrash };
