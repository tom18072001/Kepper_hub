// Bộ lọc đã lưu theo dự án: của riêng tôi hoặc chia sẻ cho người xem dự án.
const { fail, intParam, text, oneOf } = require('../lib/http');
const { loadProject } = require('../services/access');

const VIEWS = ['board', 'list', 'calendar', 'timeline', 'register'];
const FILTER_KEYS = ['q', 'assignee', 'label', 'priority', 'lanes', 'cycle', 'mine', 'dl', 'dept', 'type', 'stage', 'source', 'plan', 'assigner'];
function cleanFilters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(422, 'Bộ lọc không hợp lệ');
  const out = {};
  for (const key of FILTER_KEYS) if (value[key] != null && value[key] !== '') out[key] = String(value[key]).slice(0, 100);
  return out;
}

module.exports = function mountViews(app, { prisma, auth, audit }) {
  app.get('/api/projects/:id/views', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id));
    const rows = await prisma.savedView.findMany({ where: { projectId: project.id, OR: [{ userId: req.user.id }, { shared: true }] }, orderBy: { name: 'asc' } });
    res.json(rows.map(v => ({ ...v, mine: v.userId === req.user.id })));
  });
  app.post('/api/projects/:id/views', auth, async (req, res) => {
    const { project, rights } = await loadProject(prisma, req.user, intParam(req.params.id));
    const shared = !!req.body.shared;
    if (shared && !rights.canEdit) fail(403, 'Chỉ người làm việc trong dự án mới chia sẻ được bộ lọc', 'FORBIDDEN');
    const count = await prisma.savedView.count({ where: { projectId: project.id, userId: req.user.id } });
    if (count >= 30) fail(422, 'Tối đa 30 bộ lọc mỗi dự án');
    const row = await prisma.savedView.create({ data: {
      projectId: project.id, userId: req.user.id, name: text(req.body.name, 'Tên bộ lọc', { required: true, max: 60 }),
      view: oneOf(req.body.view || 'board', VIEWS, 'Kiểu xem'), filters: cleanFilters(req.body.filters), shared,
    } });
    await audit(req, 'CREATE', 'SavedView', row.id, null, { name: row.name, shared });
    res.status(201).json({ ...row, mine: true });
  });
  app.delete('/api/views/:id', auth, async (req, res) => {
    const view = await prisma.savedView.findUnique({ where: { id: intParam(req.params.id) } });
    if (!view) fail(404, 'Không tìm thấy bộ lọc', 'NOT_FOUND');
    const { rights } = await loadProject(prisma, req.user, view.projectId);
    if (view.userId !== req.user.id && !rights.canManage) fail(403, 'Không thể xoá bộ lọc của người khác', 'FORBIDDEN');
    await prisma.savedView.delete({ where: { id: view.id } });
    res.json({ ok: true });
  });
};
