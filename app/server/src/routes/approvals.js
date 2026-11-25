// Hàng chờ của lãnh đạo: phiếu trình chờ duyệt, đề nghị gia hạn chờ quyết định, kiến nghị chờ trả lời.
const { intParam, text, fail } = require('../lib/http');
const { permissionScope, isBoard } = require('../lib/permissions');
const approval = require('../services/approval');
const rules = require('../services/task-rules');
const W = require('../services/workitems');
const TA = require('../services/task-access');

const { activity } = require('../services/events');
const bus = require('../services/bus');

const DAY = 86_400_000;
const deptOf = item => item.leadDepartmentId ?? item.project.departmentId;

// Việc mà người dùng có thẩm quyền quyết định gia hạn / trả lời kiến nghị:
// người giao; lãnh đạo bộ phận chủ trì (kể cả uỷ quyền); BTGĐ phụ trách (toàn công ty / bộ phận chủ trì).
async function decisionScope(prisma, user) {
  const now = new Date();
  const fromIds = (await prisma.delegation.findMany({ where: { toUserId: user.id, revokedAt: null, startsAt: { lte: now }, endsAt: { gte: now } }, select: { fromUserId: true } })).map(d => d.fromUserId);
  const leaderDepts = new Set();
  if (permissionScope(user, 'work.approve', 'OPERATE') === 'UNIT' && user.departmentId != null) leaderDepts.add(user.departmentId);
  for (const u of fromIds.length ? await prisma.user.findMany({ where: { id: { in: fromIds }, isActive: true }, select: { departmentId: true, role: true, isRootAdmin: true } }) : []) if (u.departmentId != null && !isBoard(u)) leaderDepts.add(u.departmentId);
  const supervised = (await prisma.department.findMany({ where: { supervisorId: { in: [user.id, ...fromIds] } }, select: { id: true } })).map(d => d.id);
  // BTGĐ phụ trách của việc (services/task-access.js): TGĐ — mọi việc; Phó TGĐ phụ trách — việc của phòng mình phụ trách.
  const org = await TA.orgContext(prisma, now);
  // board: thành viên Ban Tổng Giám đốc đang hoạt động — có thể quyết gia hạn cả việc ngoài phạm vi trên (việc chưa có BTGĐ phụ trách;
  // việc nhánh kế thừa bộ phận chủ trì mình phụ trách).
  return { assigners: [user.id, ...fromIds], leaderDepts: [...leaderDepts], supervised, org, top: org.topIds.includes(user.id), board: org.boardIds.includes(user.id) };
}
// Kiến nghị "của tôi": người giao / Phó TGĐ phụ trách luôn thấy; lãnh đạo phòng chỉ thấy kiến nghị chưa trình lên BTGĐ.
const proposalScope = s => ({ OR: [{ workItem: { assignedById: { in: s.assigners } } }, ...(s.supervised.length ? [{ workItem: { leadDepartmentId: { in: s.supervised } } }] : []),
  ...(s.leaderDepts.length ? [{ forwardedAt: null, workItem: { leadDepartmentId: { in: s.leaderDepts } } }] : [])] });
const scopeWhere = s => (s.top ? {} : { OR: [{ assignedById: { in: s.assigners } }, ...(s.leaderDepts.length ? [{ leadDepartmentId: { in: s.leaderDepts } }] : []), ...(s.supervised.length ? [{ leadDepartmentId: { in: s.supervised } }] : [])] });
// CÙNG điều kiện với POST /api/extensions/:id/decide (quyền decideExtension, services/task-access.js extensionDeciderIds): BTGĐ phụ trách
// của việc (Toàn công ty; Phó TGĐ phụ trách bộ phận chủ trì, kể cả bộ phận kế thừa từ việc cha); việc chưa có BTGĐ phụ trách nào → mọi
// thành viên Ban Tổng Giám đốc. Người giao, lãnh đạo bộ phận chủ trì vẫn thấy đề nghị để nắm (không có nút).
async function canDecideExt(prisma, s, userId, item) {
  if (s.top) return true; // phụ trách Toàn công ty: BTGĐ phụ trách của mọi việc
  const task = TA.taskOf(item);
  const ctx = TA.itemContext(s.org, { project: item.project, item: task, chain: await TA.leadChain(prisma, task) });
  return TA.extensionDeciderIds(ctx).includes(userId);
}
const ITEM_SELECT = { id: true, number: true, title: true, dueDate: true, priority: true, taskType: true, assignedById: true, leadDepartmentId: true, parentId: true, archivedAt: true,
  project: { select: { id: true, key: true, name: true, departmentId: true, deletedAt: true } }, assignees: { select: { user: { select: { id: true, fullName: true } } } } };
// Đề nghị gia hạn đang chờ, kèm cờ canDecide: trong phạm vi của tôi (người giao, lãnh đạo bộ phận chủ trì, BTGĐ phụ trách) như trước;
// thành viên BTGĐ (không phụ trách Toàn công ty) thấy thêm đề nghị ngoài phạm vi đó mà mình quyết được — việc chưa có BTGĐ phụ trách
// (dự phòng), việc nhánh kế thừa bộ phận chủ trì mình phụ trách.
async function pendingExtensions(prisma, user, s, take) {
  const where = scope => ({ status: 'PENDING', requestedById: { not: user.id }, workItem: { archivedAt: null, project: { deletedAt: null }, ...scope } });
  const args = { include: { workItem: { select: ITEM_SELECT } }, orderBy: { createdAt: 'asc' }, take };
  const [mine, more] = await Promise.all([
    prisma.dueExtension.findMany({ where: where(scopeWhere(s)), ...args }),
    s.board && !s.top ? prisma.dueExtension.findMany({ where: where({}), ...args }) : [],
  ]);
  const out = new Map();
  for (const r of mine) out.set(r.id, { ...r, canDecide: await canDecideExt(prisma, s, user.id, r.workItem) });
  for (const r of more) if (!out.has(r.id) && await canDecideExt(prisma, s, user.id, r.workItem)) out.set(r.id, { ...r, canDecide: true });
  return [...out.values()].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id).slice(0, take);
}

// Đơn nghỉ + giải trình chấm công chờ tôi duyệt (khi bật phân hệ Nhân sự): cùng nguồn với Nhân sự → Chờ duyệt.
async function hrPending(prisma, user) {
  const H = require('../services/hrm');
  const cfg = await H.hrmConfig(prisma);
  const s = await H.subjectOf(prisma, user, cfg);
  if (s.it || !(s.leader || s.director || s.hr)) return 0;
  const p = await H.pendingDecisions(prisma, s, cfg);
  return p.leaves.length + p.atts.length;
}

module.exports = function mountApprovals(app, { prisma, auth, audit, config = {} }) {
  const hrmOn = (config.modules || []).includes('hrm');
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
        lastLevel: request.currentLevel === request.totalLevels, ratingRequired: rules.isGradeStep(step), submitNote: submit?.comment || null, requestedByName: n[request.requestedById] || null,
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
    const rows = await pendingExtensions(prisma, req.user, s, 200);
    const n = await names(rows.flatMap(r => [r.requestedById, r.workItem.assignedById])); const d = await deptNames();
    // Chỉ người quyết định (BTGĐ phụ trách của việc; chưa có ai thì mọi thành viên BTGĐ) có nút; người giao / lãnh đạo bộ phận xem để nắm.
    res.json(rows.map(r => {
      const it = r.workItem;
      return { id: r.id, newDue: r.newDue, oldDue: r.oldDue, reason: r.reason, createdAt: r.createdAt, requestedByName: n[r.requestedById], canDecide: r.canDecide,
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

  // Số đếm cho huy hiệu menu (và "Việc cần xử lý" ở Trang chủ): phiếu trình, gia hạn, kiến nghị, đơn nghỉ & giải trình (hr).
  app.get('/api/approvals/counts', auth, async (req, res) => {
    const s = await decisionScope(prisma, req.user);
    const [queue, extensions, proposals, hr] = await Promise.all([
      approval.queueFor(prisma, req.user).then(q => q.length),
      // Chỉ đếm đề nghị mình được quyết định (khớp tab "Đề nghị gia hạn"): BTGĐ phụ trách của việc; chưa có ai thì mọi thành viên BTGĐ.
      pendingExtensions(prisma, req.user, s, 500).then(rows => rows.filter(r => r.canDecide).length),
      prisma.progressReport.count({ where: { proposals: { not: '' }, answer: null, authorId: { not: req.user.id }, workItem: { archivedAt: null, project: { deletedAt: null } }, AND: [proposalScope(s)] } }),
      hrmOn ? hrPending(prisma, req.user) : 0,
    ]);
    res.json({ queue, extensions, proposals, hr, total: queue + extensions + proposals + hr });
  });

  // "Tôi đã gửi": phiếu tôi gửi duyệt — đang chờ (ở bước nào, ai duyệt) và kết quả 30 ngày gần đây.
  app.get('/api/approvals/sent', auth, async (req, res) => {
    const since = new Date(Date.now() - 30 * DAY);
    const all = await prisma.approvalRequest.findMany({
      where: { requestedById: req.user.id, workItem: { archivedAt: null, project: { deletedAt: null } }, OR: [{ status: 'PENDING' }, { closedAt: { gte: since } }] },
      include: { workItem: { include: { project: true, state: { select: { name: true, category: true } }, assignees: { include: { user: { select: { id: true, fullName: true } } } } } }, actions: { orderBy: { id: 'asc' } } },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    // Mỗi việc một dòng: phiếu gần nhất (gửi lại sau khi bị trả / rút lại thì thay dòng cũ).
    const seen = new Set();
    const rows = all.filter(r => !seen.has(r.workItemId) && seen.add(r.workItemId));
    const ctx = await approval.approvalContext(prisma, [...new Set(rows.map(r => r.workItem.projectId))]);
    const n = await names(rows.flatMap(r => [r.workItem.assignedById, ...r.actions.map(a => a.actorId)]));
    const d = await deptNames();
    const extra = new Set();
    const out = rows.map(r => {
      const item = r.workItem, project = item.project;
      const chain = rules.chainOf(ctx.steps.get(project.id) || [], !!r.withAssigner, { board: !!r.withBoard });
      const step = r.status === 'PENDING' ? rules.stepAt(chain, r.currentLevel) : null;
      const waitingOn = step ? approval.approverIdsSync(ctx, project, step, approval.withDoers(item, r.requestedById), { delegates: false }) : [];
      waitingOn.forEach(id => extra.add(id));
      const last = [...r.actions].reverse().find(a => a.decision !== 'SUBMIT') || null;
      return { id: r.id, status: r.status, currentLevel: r.currentLevel, totalLevels: r.totalLevels, stepName: step?.name || null, createdAt: r.createdAt, closedAt: r.closedAt, waitingOn,
        // Rút lại được khi phiếu còn chờ và chưa cấp nào xử lý (hoàn tác "Gửi duyệt" bấm nhầm).
        canWithdraw: r.status === 'PENDING' && r.actions.every(a => a.decision === 'SUBMIT'),
        last: last ? { decision: last.decision, actorName: n[last.actorId] || null, comment: last.comment || null, rating: last.rating || null, level: last.level, at: last.createdAt } : null,
        item: { id: item.id, code: `${project.key}-${item.number}`, title: item.title, priority: item.priority, dueDate: item.dueDate, state: item.state.name, taskType: item.taskType,
          assignees: item.assignees.map(a => a.user), assignedByName: n[item.assignedById] || null, departmentName: d[deptOf(item)] || null },
        project: { id: project.id, key: project.key, name: project.name } };
    });
    const who = await names([...extra]);
    for (const r of out) r.waitingOn = r.waitingOn.map(id => who[id]).filter(Boolean);
    res.json(out);
  });

  // Người gửi rút lại phiếu chưa cấp nào xử lý (vd. bấm nhầm "Gửi duyệt" rồi bấm "Hoàn tác"): việc về trạng thái trước khi gửi,
  // tiến độ về mức cũ nếu gửi kèm (progress), thông báo "Cần duyệt" người duyệt chưa đọc của phiếu này được gỡ.
  app.post('/api/approvals/:id/withdraw', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const head = await prisma.approvalRequest.findUnique({ where: { id }, select: { workItemId: true, requestedById: true, workItem: { select: { archivedAt: true, project: { select: { deletedAt: true } } } } } });
    if (!head) fail(404, 'Không tìm thấy yêu cầu duyệt', 'NOT_FOUND');
    if (head.requestedById !== req.user.id) fail(403, 'Chỉ người gửi duyệt được rút lại yêu cầu này', 'FORBIDDEN');
    approval.assertNotInTrash(head.workItem); // dự án / việc ở Thùng rác: 409, khôi phục trước
    const { project, rights, caps } = await TA.loadTask(prisma, req.user, head.workItemId);
    TA.assertCap(caps, 'submit');
    const want = req.body?.progress;
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'item:' + head.workItemId}))`;
      const request = await tx.approvalRequest.findUnique({ where: { id }, include: { actions: true } });
      if (request.status !== 'PENDING') fail(409, 'Yêu cầu duyệt đã được xử lý — không rút lại được', 'NOT_PENDING');
      if (request.actions.some(a => a.decision !== 'SUBMIT')) fail(409, 'Đã có cấp duyệt xử lý — không rút lại được', 'ALREADY_DECIDED');
      const item = await tx.workItem.findUnique({ where: { id: head.workItemId }, include: { state: true, assignees: true, labels: true } });
      if (item.state.category !== 'REVIEW') fail(409, 'Việc không còn ở "Chờ duyệt"', 'NOT_IN_REVIEW');
      const from = request.fromStateId ? await tx.workflowState.findFirst({ where: { id: request.fromStateId, projectId: project.id } }) : null;
      const toState = from && !['REVIEW', 'COMPLETED'].includes(from.category) ? from
        : await tx.workflowState.findFirst({ where: { projectId: project.id, category: 'STARTED' }, orderBy: { position: 'asc' } });
      if (!toState) fail(409, 'Dự án chưa có cột "Đang thực hiện"', 'INVALID_STATE');
      // % chỉ trả về mức cũ với việc nhập % tay (không có việc con) — giống quy định một nguồn %.
      const kids = await tx.workItem.count({ where: { parentId: item.id, archivedAt: null } });
      const pct = Number(want);
      const restore = want != null && Number.isInteger(pct) && pct >= 0 && pct < 100 && pct !== item.progress && !kids;
      await approval.cancelPending(tx, { item, actor: req.user, reason: 'Người gửi rút lại' });
      const t = await W.transition(tx, { project, rights, item, toState, overrideWip: 'bulk' });
      const updated = await tx.workItem.update({ where: { id: item.id }, data: { ...t.data, position: await W.endPosition(tx, t.toState.id), ...(restore ? { progress: pct, progressAt: new Date() } : {}) } });
      if (restore) await activity(tx, item.id, req.user.id, 'UPDATED', { progress: pct });
      await W.afterTransition(tx, { user: req.user, project, item: updated, fromState: item.state, toState: t.toState });
      // Thông báo "Cần duyệt" người duyệt chưa mở: gỡ (đã đọc thì giữ — lịch sử duyệt vẫn ghi gửi rồi rút).
      const stale = await tx.notification.findMany({ where: { type: 'APPROVAL_REQUESTED', readAt: null, link: W.link(project, item), createdAt: { gte: request.createdAt } }, select: { id: true, userId: true } });
      if (stale.length) await tx.notification.deleteMany({ where: { id: { in: stale.map(x => x.id) } } });
      return { item: updated, state: t.toState, notified: [...new Set(stale.map(x => x.userId))] };
    });
    await audit(req, 'APPROVAL_WITHDRAW', 'ApprovalRequest', id, null, { workItemId: head.workItemId, toStateId: result.state.id });
    bus.item(project.id, head.workItemId, req.user.id);
    if (result.notified.length) bus.notified(result.notified);
    res.json({ ok: true, stateId: result.state.id, state: result.state.name, progress: result.item.progress });
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
