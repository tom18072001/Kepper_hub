// Việc của tôi + thông báo.
const { intParam } = require('../lib/http');
const { visibleProjectsWhere, itemVisibleWhere } = require('../services/access');
const { BOARD_INCLUDE, boardItem } = require('../services/workitems');
const { stageOf } = require('../services/stage');

module.exports = function mountMe(app, { prisma, auth }) {
  app.get('/api/my/items', auth, async (req, res) => {
    const mode = req.query.mode === 'created' ? 'created' : 'assigned';
    const where = {
      archivedAt: null, project: { ...visibleProjectsWhere(req.user), archivedAt: null },
      ...(mode === 'created' ? { reporterId: req.user.id, AND: [itemVisibleWhere(req.user)] } : { OR: [{ assignees: { some: { userId: req.user.id } } }, { supporters: { some: { userId: req.user.id } } }] }),
      ...(req.query.open === 'false' ? {} : { state: { category: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
    };
    const rows = await prisma.workItem.findMany({ where, include: { ...BOARD_INCLUDE, _count: { select: { ...BOARD_INCLUDE._count.select, progressReports: true } }, project: { include: { approvalSteps: { select: { level: true, name: true, approverType: true } } } }, state: true }, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }], take: 500 });
    res.json(rows.map(r => ({ ...boardItem(r.project, r), stage: stageOf({ ...r, pendingApproval: r.approvals[0] }, r.project.approvalSteps), reportCount: r._count.progressReports, myRole: r.assignees.some(a => a.userId === req.user.id) ? 'LEAD' : r.supporters.some(a => a.userId === req.user.id) ? 'SUPPORT' : null, project: { id: r.project.id, key: r.project.key, name: r.project.name }, state: { id: r.state.id, name: r.state.name, category: r.state.category, color: r.state.color } })));
  });

  app.get('/api/notifications', auth, async (req, res) => {
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId: req.user.id }, orderBy: { id: 'desc' }, take: 50 }),
      prisma.notification.count({ where: { userId: req.user.id, readAt: null } }),
    ]);
    res.json({ items, unread });
  });
  app.post('/api/notifications/:id/read', auth, async (req, res) => {
    await prisma.notification.updateMany({ where: { id: intParam(req.params.id), userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
    res.json({ ok: true });
  });
  app.post('/api/notifications/read-all', auth, async (req, res) => {
    await prisma.notification.updateMany({ where: { userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
    res.json({ ok: true });
  });
};
