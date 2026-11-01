// Tìm nhanh (Ctrl K): theo mã (DA-12), tên việc, số văn bản — trong phạm vi người dùng được xem.
const { visibleProjectsWhere, itemVisibleWhere } = require('../services/access');

module.exports = function mountSearch(app, { prisma, auth }) {
  app.get('/api/search', auth, async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q.length < 2) return res.json([]);
    const m = q.match(/^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/);
    const rows = await prisma.workItem.findMany({
      where: { archivedAt: null, project: { ...visibleProjectsWhere(req.user), archivedAt: null }, AND: [itemVisibleWhere(req.user), { OR: [
        { title: { contains: q, mode: 'insensitive' } }, { documents: { some: { number: { contains: q, mode: 'insensitive' } } } },
        ...(m ? [{ number: Number(m[2]), project: { key: m[1].toUpperCase() } }] : []),
      ] }] },
      select: { id: true, number: true, title: true, project: { select: { id: true, key: true, name: true } }, documents: { where: { number: { contains: q, mode: 'insensitive' } }, select: { number: true }, take: 1 } },
      orderBy: { updatedAt: 'desc' }, take: 15,
    });
    res.json(rows.map(r => ({ id: r.id, code: `${r.project.key}-${r.number}`, title: r.title, projectId: r.project.id, projectName: r.project.name, matchedDocument: r.documents[0]?.number || null })));
  });
};
