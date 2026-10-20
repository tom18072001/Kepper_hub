// Tiếp nhận yêu cầu: phòng ban khác gửi yêu cầu vào dự án bật "Nhận yêu cầu";
// người làm việc trong dự án tiếp nhận (tạo việc) hoặc từ chối có lý do.
const { fail, intParam, optionalDate, text, oneOf } = require('../lib/http');
const { sanitizeHtml, htmlToText } = require('../lib/rich-text');
const { hasPermission } = require('../lib/permissions');
const { loadProject, assertRegisterManager } = require('../services/access');
const { notify } = require('../services/events');
const bus = require('../services/bus');
const W = require('../services/workitems');

const requestLink = request => `#/projects/${request.projectId}?view=intake`;

module.exports = function mountIntake(app, { prisma, auth, audit }) {
  // Danh sách dự án nhận yêu cầu — cho mọi tài khoản đang làm việc (chỉ trả trường tối thiểu).
  app.get('/api/intake/targets', auth, async (req, res) => {
    if (!hasPermission(req.user, 'work.view')) fail(403, 'Không đủ quyền', 'FORBIDDEN');
    res.json(await prisma.project.findMany({ where: { intakeEnabled: true, archivedAt: null, deletedAt: null }, orderBy: { name: 'asc' },
      select: { id: true, key: true, name: true, description: true, department: { select: { id: true, name: true } } } }));
  });

  app.post('/api/intake', auth, async (req, res) => {
    if (!hasPermission(req.user, 'work.view')) fail(403, 'Không đủ quyền', 'FORBIDDEN');
    const project = await prisma.project.findFirst({ where: { id: intParam(req.body.projectId, 'Dự án'), intakeEnabled: true, archivedAt: null, deletedAt: null } });
    if (!project) fail(404, 'Dự án không nhận yêu cầu', 'NOT_FOUND');
    const descriptionHtml = sanitizeHtml(req.body.descriptionHtml ?? String(req.body.description || '').split(/\n+/).filter(Boolean).map(p => `<p>${p.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</p>`).join(''));
    const request = await prisma.$transaction(async tx => {
      const row = await tx.intakeRequest.create({ data: {
        projectId: project.id, title: text(req.body.title, 'Tiêu đề', { required: true, max: 300 }), descriptionHtml, descriptionText: htmlToText(descriptionHtml),
        priority: oneOf(req.body.priority, W.PRIORITIES, 'Ưu tiên') || 'NONE', dueDate: optionalDate(req.body.dueDate, 'Hạn mong muốn') ?? null, requesterId: req.user.id,
      } });
      const owners = await tx.projectMember.findMany({ where: { projectId: project.id, role: 'OWNER' }, select: { userId: true } });
      await notify(tx, [project.leadId, ...owners.map(o => o.userId)], { type: 'INTAKE_NEW', title: `Yêu cầu mới vào ${project.name}: ${row.title}`, body: `Từ ${req.user.fullName}`, link: requestLink(row) }, req.user.id);
      await audit(req, 'CREATE', 'IntakeRequest', row.id, null, { projectId: project.id, title: row.title }, tx);
      return row;
    });
    bus.project(project.id, req.user.id);
    res.status(201).json(request);
  });

  // Yêu cầu tôi đã gửi: trạng thái + mã việc (không lộ nội dung dự án khác).
  app.get('/api/intake/mine', auth, async (req, res) => {
    const rows = await prisma.intakeRequest.findMany({ where: { requesterId: req.user.id }, orderBy: { id: 'desc' }, take: 200,
      include: { project: { select: { id: true, key: true, name: true } }, workItem: { select: { id: true, number: true, completedAt: true, state: { select: { name: true, category: true } } } } } });
    res.json(rows.map(r => ({
      id: r.id, title: r.title, priority: r.priority, dueDate: r.dueDate, status: r.status, decisionNote: r.decisionNote, createdAt: r.createdAt, decidedAt: r.decidedAt,
      project: r.project, item: r.workItem ? { id: r.workItem.id, code: `${r.project.key}-${r.workItem.number}`, state: r.workItem.state.name, category: r.workItem.state.category } : null,
    })));
  });

  // Hộp tiếp nhận của dự án.
  app.get('/api/projects/:id/intake', auth, async (req, res) => {
    const { project, rights, member } = await loadProject(prisma, req.user, intParam(req.params.id), 'edit');
    assertRegisterManager(project, rights, member);
    const status = ['PENDING', 'ACCEPTED', 'DECLINED'].includes(req.query.status) ? req.query.status : undefined;
    const rows = await prisma.intakeRequest.findMany({ where: { projectId: project.id, ...(status ? { status } : {}) }, orderBy: [{ status: 'desc' }, { id: 'desc' }], take: 500,
      include: { workItem: { select: { id: true, number: true } } } });
    const ids = [...new Set(rows.flatMap(r => [r.requesterId, r.decidedById]).filter(Boolean))];
    const users = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, department: { select: { name: true } } } })).map(u => [u.id, u]));
    res.json(rows.map(r => ({ ...r, requesterName: users.get(r.requesterId)?.fullName, requesterDepartment: users.get(r.requesterId)?.department?.name || null,
      decidedByName: users.get(r.decidedById)?.fullName || null, itemCode: r.workItem ? `${project.key}-${r.workItem.number}` : null })));
  });

  async function pending(tx, id) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'intake:' + id}))`;
    const request = await tx.intakeRequest.findUnique({ where: { id } });
    if (!request) fail(404, 'Không tìm thấy yêu cầu', 'NOT_FOUND');
    if (request.status !== 'PENDING') fail(409, 'Yêu cầu đã được xử lý', 'INTAKE_CLOSED');
    return request;
  }

  app.post('/api/intake/:id/accept', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const found = await prisma.intakeRequest.findUnique({ where: { id } });
    if (!found) fail(404, 'Không tìm thấy yêu cầu', 'NOT_FOUND');
    const { project, rights, member } = await loadProject(prisma, req.user, found.projectId, 'edit');
    assertRegisterManager(project, rights, member);
    const result = await prisma.$transaction(async tx => {
      const request = await pending(tx, id);
      const item = await W.createWorkItem(tx, { project, user: req.user, rights, reporterId: request.requesterId, source: 'INTAKE', input: {
        title: request.title, descriptionHtml: request.descriptionHtml, priority: request.priority, dueDate: request.dueDate,
        stateId: req.body?.stateId, assigneeIds: req.body?.assigneeIds, cycleId: req.body?.cycleId,
      } });
      const updated = await tx.intakeRequest.update({ where: { id }, data: { status: 'ACCEPTED', workItemId: item.id, decidedById: req.user.id, decidedAt: new Date(), decisionNote: text(req.body?.note, 'Ghi chú', { max: 1000 }) || null } });
      await notify(tx, [request.requesterId], { type: 'INTAKE_ACCEPTED', title: `Yêu cầu "${request.title}" đã được tiếp nhận (${project.key}-${item.number})`, body: project.name, link: '#/requests' }, req.user.id);
      await audit(req, 'INTAKE_ACCEPT', 'IntakeRequest', id, null, { workItemId: item.id }, tx);
      return { request: updated, item };
    });
    bus.item(project.id, result.item.id, req.user.id);
    res.json({ ...result.request, itemCode: `${project.key}-${result.item.number}`, itemId: result.item.id });
  });

  app.post('/api/intake/:id/decline', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const found = await prisma.intakeRequest.findUnique({ where: { id } });
    if (!found) fail(404, 'Không tìm thấy yêu cầu', 'NOT_FOUND');
    const { project, rights, member } = await loadProject(prisma, req.user, found.projectId, 'edit');
    assertRegisterManager(project, rights, member);
    const note = text(req.body?.note, 'Lý do từ chối', { required: true, max: 1000 });
    const updated = await prisma.$transaction(async tx => {
      const request = await pending(tx, id);
      const row = await tx.intakeRequest.update({ where: { id }, data: { status: 'DECLINED', decisionNote: note, decidedById: req.user.id, decidedAt: new Date() } });
      await notify(tx, [request.requesterId], { type: 'INTAKE_DECLINED', title: `Yêu cầu "${request.title}" bị từ chối`, body: note, link: '#/requests' }, req.user.id);
      await audit(req, 'INTAKE_DECLINE', 'IntakeRequest', id, null, { note }, tx);
      return row;
    });
    bus.project(project.id, req.user.id);
    res.json(updated);
  });
};
