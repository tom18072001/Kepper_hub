// Hàng chờ của lãnh đạo: phiếu trình chờ duyệt, đề nghị gia hạn chờ quyết định, kiến nghị chờ trả lời.
const { intParam, text, fail } = require('../lib/http');
const { permissionScope } = require('../lib/permissions');
const approval = require('../services/approval');
const bus = require('../services/bus');

const DAY = 86_400_000;
const deptOf = item => item.leadDepartmentId ?? item.project.departmentId;

// Việc mà người dùng có thẩm quyền quyết định gia hạn / trả lời kiến nghị:
// người giao; lãnh đạo phòng chủ trì (kể cả uỷ quyền); PGĐ phụ trách phòng chủ trì.
async function decisionScope(prisma, user) {
  const now = new Date();
  const fromIds = (await prisma.delegation.findMany({ where: { toUserId: user.id, revokedAt: null, startsAt: { lte: now }, endsAt: { gte: now } }, select: { fromUserId: true } })).map(d => d.fromUserId);
  const leaderDepts = new Set();
  if (permissionScope(user, 'work.approve', 'OPERATE') === 'UNIT' && user.departmentId != null) leaderDepts.add(user.departmentId);
  for (const u of fromIds.length ? await prisma.user.findMany({ where: { id: { in: fromIds }, isActive: true }, select: { departmentId: true, role: true } }) : []) if (u.departmentId != null && u.role !== 'director') leaderDepts.add(u.departmentId);
  const supervised = (await prisma.department.findMany({ where: { supervisorId: { in: [user.id, ...fromIds] } }, select: { id: true } })).map(d => d.id);
  return { assigners: [user.id, ...fromIds], leaderDepts: [...leaderDepts], supervised };
}
// Kiến nghị "của tôi": người giao / PGĐ phụ trách luôn thấy; lãnh đạo phòng chỉ thấy kiến nghị chưa trình lên BGĐ.
const proposalScope = s => ({ OR: [{ workItem: { assignedById: { in: s.assigners } } }, ...(s.supervised.length ? [{ workItem: { leadDepartmentId: { in: s.supervised } } }] : []),
  ...(s.leaderDepts.length ? [{ forwardedAt: null, workItem: { leadDepartmentId: { in: s.leaderDepts } } }] : [])] });
const scopeWhere = s => ({ OR: [{ assignedById: { in: s.assigners } }, ...(s.leaderDepts.length ? [{ leadDepartmentId: { in: s.leaderDepts } }] : []), ...(s.supervised.length ? [{ leadDepartmentId: { in: s.supervised } }] : [])] });
// Giống điều kiện ở POST /api/extensions/:id/decide: người giao; việc không có người giao khác thì lãnh đạo phòng chủ trì (kể cả uỷ quyền).
const canDecideExt = (s, userId, ext, item) => item.assignedById === userId || ((!item.assignedById || item.assignedById === ext.requestedById) && s.leaderDepts.includes(item.leadDepartmentId));
const ITEM_SELECT = { id: true, number: true, title: true, dueDate: true, priority: true, taskType: true, assignedById: true, leadDepartmentId: true, archivedAt: true,
  project: { select: { id: true, key: true, name: true, departmentId: true, deletedAt: true } }, assignees: { select: { user: { select: { id: true, fullName: true } } } } };

module.exports = function mountApprovals(app, { prisma, auth, audit }) {
  async function names(ids) {
    return Object.fromEntries((await prisma.user.findMany({ where: { id: { in: [...new Set(ids.filter(Boolean))] } }, select: { id: true, fullName: true } })).map(u => [u.id, u.fullName]));
  }
  async function deptNames() { return Object.fromEntries((await prisma.department.findMany({ select: { id: true, name: true } })).map(d => [d.id, d.name])); }

  // Hàng chờ duyệt của tôi (theo cấp hiện tại của từng yêu cầu).
  app.get('/api/approvals/queue', auth, async (req, res) => {
    const queue = await approval.queueFor(prisma, req.user);
    const n = await names(queue.flatMap(({ request, onBehalfOfId }) => [request.workItem.assignedById, request.requestedById, onBehalfOfId]));
    const d = await deptNames();
    const out = [];
    for (const { request, step, onBehalfOfId } of queue) {
      const item = request.workItem, project = item.project;
      const submit = request.actions.filter(a => a.decision === 'SUBMIT').at(-1);
      out.push({
        id: request.id, status: request.status, currentLevel: request.currentLevel, totalLevels: request.totalLevels, stepName: step?.name || null, createdAt: request.createdAt,
        lastLevel: request.currentLevel === request.totalLevels, submitNote: submit?.comment || null, requestedByName: n[request.requestedById] || null,
        onBehalfOf: onBehalfOfId ? n[onBehalfOfId] || null : null,
        item: { id: item.id, code: `${project.key}-${item.number}`, title: item.title, priority: item.priority, dueDate: item.dueDate, state: item.state.name, taskType: item.taskType,
          assignees: item.assignees.map(a => a.user), assignedByName: n[item.assignedById] || null, departmentName: d[deptOf(item)] || null },
        project: { id: project.id, key: project.key, name: project.name },
      });
    }
    res.json(out);
  });

  // Đề nghị gia hạn chờ tôi quyết định.
  app.get('/api/approvals/extensions', auth, async (req, res) => {
    const s = await decisionScope(prisma, req.user);
    const rows = await prisma.dueExtension.findMany({
      where: { status: 'PENDING', requestedById: { not: req.user.id }, workItem: { archivedAt: null, project: { deletedAt: null }, ...scopeWhere(s) } },
      include: { workItem: { select: ITEM_SELECT } }, orderBy: { createdAt: 'asc' }, take: 200,
    });
    const n = await names(rows.flatMap(r => [r.requestedById, r.workItem.assignedById])); const d = await deptNames();
    // Chỉ người được quyết định thật (người giao; nếu không có người giao khác thì lãnh đạo phòng / người quản lý) mới có nút; PGĐ phụ trách xem để nắm.
    res.json(rows.map(r => {
      const it = r.workItem;
      const canDecide = canDecideExt(s, req.user.id, r, it);
      return { id: r.id, newDue: r.newDue, oldDue: r.oldDue, reason: r.reason, createdAt: r.createdAt, requestedByName: n[r.requestedById], canDecide,
        days: r.oldDue ? Math.round((r.newDue - r.oldDue) / DAY) : null,
        item: { id: it.id, code: `${it.project.key}-${it.number}`, title: it.title, dueDate: it.dueDate, taskType: it.taskType, departmentName: d[deptOf(it)] || null, assignedByName: n[it.assignedById] || null },
        project: { id: it.project.id, key: it.project.key, name: it.project.name } };
    }));
  });

  // Kiến nghị chưa được trả lời trong phạm vi của tôi.
  app.get('/api/approvals/proposals', auth, async (req, res) => {
    const s = await decisionScope(prisma, req.user);
    const rows = await prisma.progressReport.findMany({
      where: { proposals: { not: '' }, answer: null, authorId: { not: req.user.id }, workItem: { archivedAt: null, project: { deletedAt: null } }, AND: [proposalScope(s)] },
      include: { workItem: { select: ITEM_SELECT } }, orderBy: { createdAt: 'asc' }, take: 200,
    });
    const n = await names(rows.flatMap(r => [r.authorId, r.workItem.assignedById])); const d = await deptNames();
    res.json(rows.map(r => ({ id: r.id, proposals: r.proposals, difficulties: r.difficulties, progress: r.progress, createdAt: r.createdAt, authorName: n[r.authorId],
      waitingDays: Math.floor((Date.now() - r.createdAt) / DAY),
      item: { id: r.workItem.id, code: `${r.workItem.project.key}-${r.workItem.number}`, title: r.workItem.title, dueDate: r.workItem.dueDate, departmentName: d[deptOf(r.workItem)] || null, assignedByName: n[r.workItem.assignedById] || null },
      project: { id: r.workItem.project.id, key: r.workItem.project.key, name: r.workItem.project.name } })));
  });

  // Số đếm cho huy hiệu menu.
  app.get('/api/approvals/counts', auth, async (req, res) => {
    const s = await decisionScope(prisma, req.user);
    const [queue, extensions, proposals] = await Promise.all([
      approval.queueFor(prisma, req.user).then(q => q.length),
      // Chỉ đếm đề nghị mình được quyết định (khớp tab "Đề nghị gia hạn"); PGĐ phụ trách xem để nắm nhưng không đếm.
      prisma.dueExtension.findMany({ where: { status: 'PENDING', requestedById: { not: req.user.id }, workItem: { archivedAt: null, project: { deletedAt: null }, ...scopeWhere(s) } },
        select: { requestedById: true, workItem: { select: { assignedById: true, leadDepartmentId: true } } }, take: 500 }).then(rows => rows.filter(r => canDecideExt(s, req.user.id, r, r.workItem)).length),
      prisma.progressReport.count({ where: { proposals: { not: '' }, answer: null, authorId: { not: req.user.id }, workItem: { archivedAt: null, project: { deletedAt: null } }, AND: [proposalScope(s)] } }),
    ]);
    res.json({ queue, extensions, proposals, total: queue + extensions + proposals });
  });

  // Gửi duyệt = chuyển việc vào cột thuộc nhóm REVIEW (PATCH /api/items/:id hoặc kéo-thả).
  for (const [path, decision] of [['approve', 'APPROVE'], ['reject', 'REJECT']]) {
    app.post(`/api/approvals/:id/${path}`, auth, async (req, res) => {
      const comment = text(req.body?.comment, 'Ý kiến', { max: 2000, required: decision === 'REJECT' });
      const rating = decision === 'APPROVE' && req.body?.rating ? String(req.body.rating) : undefined;
      if (rating && !approval.RATINGS[rating]) fail(422, 'Xếp loại không hợp lệ', 'INVALID_RATING');
      const result = await approval.decide(prisma, req.user, intParam(req.params.id), decision, comment, { rating });
      await audit(req, 'APPROVAL_' + decision, 'ApprovalRequest', result.id, null, { level: result.currentLevel, status: result.status, comment });
      const item = await prisma.workItem.findUnique({ where: { id: result.workItemId }, select: { id: true, projectId: true } });
      if (item) bus.item(item.projectId, item.id, req.user.id);
      res.json(result);
    });
  }
};
