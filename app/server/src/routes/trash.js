// Thùng rác: xoá dự án (người quản lý dự án), xem và khôi phục việc / dự án trong vòng 7 ngày.
const { fail, intParam, text } = require('../lib/http');
const { loadProject, loadItem, projectRights, visibleProjectsWhere, itemVisibleWhere } = require('../services/access');
const { activity } = require('../services/events');
const approval = require('../services/approval');
const bus = require('../services/bus');
const T = require('../services/trash');
const MG = require('../services/mtl-guard');

module.exports = function mountTrash(app, { prisma, auth, audit }) {
  // Xoá việc → thùng rác (kèm việc con). Thay cho "Lưu trữ" trước đây.
  app.delete('/api/items/:id', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project, rights } = await loadItem(prisma, req.user, id, 'delete');
    await MG.mtlDeleteGuard(prisma, req.user, project, rights, id); // MTL: xoá bước tổng = người quản lý dự án
    const ids = await prisma.$transaction(async tx => {
      const item = await tx.workItem.findUnique({ where: { id } });
      if (item.archivedAt) fail(409, 'Việc đã ở trong thùng rác', 'ALREADY_DELETED');
      const removed = await T.trashItem(tx, id, req.user);
      for (const x of removed) await approval.cancelPending(tx, { item: { id: x }, actor: req.user, reason: 'Xoá công việc' });
      await activity(tx, id, req.user.id, 'ARCHIVED', { children: removed.length - 1 });
      await audit(req, 'TRASH', 'WorkItem', id, null, { code: `${project.key}-${item.number}`, children: removed.length - 1 }, tx);
      return removed;
    });
    bus.item(project.id, id, req.user.id);
    res.json({ ok: true, count: ids.length, purgeAt: T.purgeAt(new Date()) });
  });

  app.post('/api/items/:id/restore', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project, rights } = await loadItem(prisma, req.user, id, 'delete');
    await MG.mtlDeleteGuard(prisma, req.user, project, rights, id);
    await prisma.$transaction(async tx => {
      const item = await tx.workItem.findUnique({ where: { id } });
      if (!item.archivedAt) fail(409, 'Việc không nằm trong thùng rác', 'NOT_DELETED');
      if (item.parentId && (await tx.workItem.findUnique({ where: { id: item.parentId } }))?.archivedAt) fail(409, 'Hãy khôi phục việc cha trước', 'PARENT_DELETED');
      await T.restoreItem(tx, item);
      await activity(tx, id, req.user.id, 'RESTORED');
      await audit(req, 'RESTORE', 'WorkItem', id, null, { code: `${project.key}-${item.number}` }, tx);
    });
    bus.item(project.id, id, req.user.id);
    res.json({ ok: true });
  });

  // Xoá dự án → thùng rác. Bắt buộc nhập lại mã dự án để xác nhận.
  app.delete('/api/projects/:id', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id), 'manage');
    if (text(req.body?.confirmKey, 'Mã xác nhận', { max: 20 })?.toUpperCase() !== project.key) fail(422, `Nhập đúng mã dự án "${project.key}" để xác nhận xoá`, 'CONFIRM_KEY');
    await prisma.project.update({ where: { id: project.id }, data: { deletedAt: new Date(), deletedById: req.user.id } });
    await prisma.approvalRequest.updateMany({ where: { status: 'PENDING', workItem: { projectId: project.id } }, data: { status: 'CANCELLED', closedAt: new Date() } });
    await audit(req, 'TRASH', 'Project', project.id, null, { key: project.key });
    bus.project(project.id, req.user.id);
    res.json({ ok: true, purgeAt: T.purgeAt(new Date()) });
  });

  app.post('/api/projects/:id/restore', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id), 'manage', { allowDeleted: true });
    if (!project.deletedAt) fail(409, 'Dự án không nằm trong thùng rác', 'NOT_DELETED');
    await prisma.project.update({ where: { id: project.id }, data: { deletedAt: null, deletedById: null } });
    await audit(req, 'RESTORE', 'Project', project.id, null, { key: project.key });
    res.json({ ok: true });
  });

  // Nội dung thùng rác mà người dùng được khôi phục.
  app.get('/api/trash', auth, async (req, res) => {
    const visible = await prisma.project.findMany({ where: visibleProjectsWhere(req.user), include: { members: { where: { userId: req.user.id } } } });
    const canDelete = visible.filter(p => projectRights(req.user, p, p.members[0]).canDelete);
    const byId = Object.fromEntries(canDelete.map(p => [p.id, p]));
    const items = await prisma.workItem.findMany({
      where: { archivedAt: { not: null }, projectId: { in: canDelete.map(p => p.id) }, AND: [itemVisibleWhere(req.user)] }, orderBy: { archivedAt: 'desc' }, take: 300,
      select: { id: true, number: true, title: true, projectId: true, archivedAt: true, deletedById: true, parentId: true },
    });
    // Dự án đã xoá: chỉ hiện cho người quản lý được dự án đó (kiểm tra như khi chưa xoá).
    const deleted = await prisma.project.findMany({ where: { deletedAt: { not: null } }, include: { members: { where: { userId: req.user.id } }, department: { select: { name: true } }, _count: { select: { items: true } } }, orderBy: { deletedAt: 'desc' } });
    const projects = deleted.filter(p => projectRights(req.user, { ...p, archivedAt: null }, p.members[0]).canManage);
    const userIds = [...new Set([...items.map(i => i.deletedById), ...projects.map(p => p.deletedById)].filter(Boolean))];
    const names = Object.fromEntries((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })).map(u => [u.id, u.fullName]));
    res.json({
      days: T.TRASH_DAYS,
      items: items.map(i => ({ id: i.id, code: `${byId[i.projectId].key}-${i.number}`, title: i.title, projectId: i.projectId, projectName: byId[i.projectId].name, isChild: !!i.parentId,
        deletedAt: i.archivedAt, deletedBy: names[i.deletedById] || null, purgeAt: T.purgeAt(i.archivedAt) })),
      projects: projects.map(p => ({ id: p.id, key: p.key, name: p.name, department: p.department?.name, items: p._count.items, deletedAt: p.deletedAt, deletedBy: names[p.deletedById] || null, purgeAt: T.purgeAt(p.deletedAt) })),
    });
  });
};
