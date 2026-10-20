// Chu kỳ (sprint) theo dự án: lập kế hoạch theo tuần/2 tuần, tiến độ, chuyển việc chưa xong sang chu kỳ sau.
const { fail, intParam, text } = require('../lib/http');
const { loadProject, assertRegisterManager } = require('../services/access');
const { activity } = require('../services/events');
const bus = require('../services/bus');

const DAY = 86_400_000;
function dayOf(value, label) {
  const s = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(422, label + ' không hợp lệ (YYYY-MM-DD)', 'INVALID_DATE');
  const d = new Date(s + 'T00:00:00+07:00');
  if (Number.isNaN(d.getTime())) fail(422, label + ' không hợp lệ', 'INVALID_DATE');
  return d;
}
async function assertNoOverlap(client, projectId, startDate, endDate, exceptId = null) {
  const clash = await client.cycle.findFirst({ where: { projectId, ...(exceptId ? { id: { not: exceptId } } : {}), startDate: { lte: endDate }, endDate: { gte: startDate } } });
  if (clash) fail(409, `Trùng thời gian với chu kỳ "${clash.name}"`, 'CYCLE_OVERLAP');
}
function withStats(cycle, now = new Date()) {
  const items = cycle.items || [];
  const done = items.filter(i => i.state.category === 'COMPLETED').length;
  const cancelled = items.filter(i => i.state.category === 'CANCELLED').length;
  const scope = items.length - cancelled;
  const end = new Date(cycle.endDate.getTime() + DAY);
  const status = now < cycle.startDate ? 'UPCOMING' : now >= end ? 'COMPLETED' : 'ACTIVE';
  const { items: _omit, ...rest } = cycle;
  return { ...rest, status, total: items.length, done, scope, open: scope - done, progress: scope ? Math.round(done / scope * 100) : 0,
    daysLeft: status === 'ACTIVE' ? Math.ceil((end - now) / DAY) : null };
}
const withItems = { items: { where: { archivedAt: null }, select: { id: true, state: { select: { category: true } } } } };

module.exports = function mountCycles(app, { prisma, auth, audit }) {
  app.get('/api/projects/:id/cycles', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id));
    const rows = await prisma.cycle.findMany({ where: { projectId: project.id }, orderBy: { startDate: 'asc' }, include: withItems });
    res.json(rows.map(c => withStats(c)));
  });

  app.post('/api/projects/:id/cycles', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id), 'edit');
    const startDate = dayOf(req.body.startDate, 'Ngày bắt đầu'), endDate = dayOf(req.body.endDate, 'Ngày kết thúc');
    if (endDate < startDate) fail(422, 'Ngày kết thúc phải sau ngày bắt đầu', 'INVALID_RANGE');
    if ((endDate - startDate) / DAY > 90) fail(422, 'Chu kỳ tối đa 90 ngày', 'INVALID_RANGE');
    const cycle = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'cycles:' + project.id}))`;
      await assertNoOverlap(tx, project.id, startDate, endDate);
      const count = await tx.cycle.count({ where: { projectId: project.id } });
      const row = await tx.cycle.create({ data: { projectId: project.id, name: text(req.body.name, 'Tên chu kỳ', { max: 80 }) || `Chu kỳ ${count + 1}`, startDate, endDate, createdById: req.user.id } });
      await audit(req, 'CREATE', 'Cycle', row.id, null, row, tx);
      return row;
    });
    bus.project(project.id, req.user.id);
    res.status(201).json(withStats({ ...cycle, items: [] }));
  });

  app.put('/api/cycles/:id', auth, async (req, res) => {
    const cycle = await prisma.cycle.findUnique({ where: { id: intParam(req.params.id) } });
    if (!cycle) fail(404, 'Không tìm thấy chu kỳ', 'NOT_FOUND');
    const { project } = await loadProject(prisma, req.user, cycle.projectId, 'edit');
    const data = {};
    if (req.body.name !== undefined) data.name = text(req.body.name, 'Tên chu kỳ', { required: true, max: 80 });
    if (req.body.startDate !== undefined) data.startDate = dayOf(req.body.startDate, 'Ngày bắt đầu');
    if (req.body.endDate !== undefined) data.endDate = dayOf(req.body.endDate, 'Ngày kết thúc');
    const start = data.startDate || cycle.startDate, end = data.endDate || cycle.endDate;
    if (end < start) fail(422, 'Ngày kết thúc phải sau ngày bắt đầu', 'INVALID_RANGE');
    await assertNoOverlap(prisma, project.id, start, end, cycle.id);
    const row = await prisma.cycle.update({ where: { id: cycle.id }, data, include: withItems });
    await audit(req, 'UPDATE', 'Cycle', cycle.id, cycle, data);
    bus.project(project.id, req.user.id);
    res.json(withStats(row));
  });

  app.delete('/api/cycles/:id', auth, async (req, res) => {
    const cycle = await prisma.cycle.findUnique({ where: { id: intParam(req.params.id) } });
    if (!cycle) fail(404, 'Không tìm thấy chu kỳ', 'NOT_FOUND');
    const { project } = await loadProject(prisma, req.user, cycle.projectId, 'manage');
    await prisma.cycle.delete({ where: { id: cycle.id } }); // việc trong chu kỳ được giữ lại, bỏ gắn chu kỳ
    await audit(req, 'DELETE', 'Cycle', cycle.id, cycle, null);
    bus.project(project.id, req.user.id);
    res.json({ ok: true });
  });

  // Chuyển việc chưa xong (không Hoàn thành/Huỷ) sang chu kỳ khác của cùng dự án.
  app.post('/api/cycles/:id/rollover', auth, async (req, res) => {
    const cycle = await prisma.cycle.findUnique({ where: { id: intParam(req.params.id) } });
    if (!cycle) fail(404, 'Không tìm thấy chu kỳ', 'NOT_FOUND');
    const { project, rights, member } = await loadProject(prisma, req.user, cycle.projectId, 'edit');
    assertRegisterManager(project, rights, member);
    const target = await prisma.cycle.findFirst({ where: { id: intParam(req.body.toCycleId, 'Chu kỳ đích'), projectId: project.id } });
    if (!target || target.id === cycle.id) fail(422, 'Chu kỳ đích không hợp lệ', 'INVALID_CYCLE');
    const moved = await prisma.$transaction(async tx => {
      const items = await tx.workItem.findMany({ where: { cycleId: cycle.id, archivedAt: null, state: { category: { notIn: ['COMPLETED', 'CANCELLED'] } } }, select: { id: true } });
      if (items.length) await tx.workItem.updateMany({ where: { id: { in: items.map(i => i.id) } }, data: { cycleId: target.id } });
      for (const i of items) await activity(tx, i.id, req.user.id, 'UPDATED', { cycle: `${cycle.name} → ${target.name}` });
      await audit(req, 'CYCLE_ROLLOVER', 'Cycle', cycle.id, null, { toCycleId: target.id, items: items.length }, tx);
      return items.length;
    });
    bus.project(project.id, req.user.id);
    res.json({ moved });
  });
};
module.exports.withStats = withStats;
