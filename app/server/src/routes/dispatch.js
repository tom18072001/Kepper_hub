// GĐ3a — điều hành hai chiều Ban Giám đốc → phòng → cán bộ:
// hộp "Việc phòng được giao", tiếp nhận + phân công, báo cáo tiến độ (kiến nghị), đề nghị gia hạn, văn bản liên quan,
// nộp sản phẩm (phiếu trình), uỷ quyền có thời hạn.
const { fail, intParam, optionalDate, text, oneOf } = require('../lib/http');
const { permissionScope, hasPermission } = require('../lib/permissions');
const { loadItem, loadProject, isDeptLeader, assertRegisterManager } = require('../services/access');
const { activity, notify } = require('../services/events');
const approval = require('../services/approval');
const bus = require('../services/bus');
const W = require('../services/workitems');
const { getSettings, deadlineStatus } = require('../services/register');
const { stageOf } = require('../services/stage');
const MG = require('../services/mtl-guard');
const { setProgress } = require('../services/mtl-progress');

const DOC_KINDS = { BASIS: 'Căn cứ giao việc', OUTPUT: 'Sản phẩm tham mưu', ISSUED: 'Văn bản đã phát hành' };
const DAY = 86_400_000;

async function itemWithProject(prisma, id, { open = true } = {}) {
  const item = await prisma.workItem.findUnique({ where: { id }, include: { project: true, state: true, assignees: true, supporters: true } });
  if (open && item.archivedAt) fail(409, 'Việc đang ở trong thùng rác', 'ARCHIVED');
  return item;
}
async function leadersOf(client, item) { return approval.deptLeaderIds(client, item.leadDepartmentId); }
const code = (project, item) => `${project.key}-${item.number}`;
// Nhãn thông báo: mã + tên việc (rút gọn) để người nhận biết ngay việc nào.
const label = (project, item) => `${code(project, item)} · ${String(item.title || '').slice(0, 80)}`;
// Người được uỷ quyền đang thao tác thay lãnh đạo phòng nào (null nếu là lãnh đạo phòng chính chủ).
async function onBehalfOfLeader(client, user, deptId) {
  if (deptId == null || (isDeptLeader(user) && user.departmentId === deptId)) return null;
  const now = new Date();
  const d = await client.delegation.findFirst({ where: { toUserId: user.id, revokedAt: null, startsAt: { lte: now }, endsAt: { gte: now } }, orderBy: { id: 'desc' } });
  if (!d) return null;
  const from = await client.user.findUnique({ where: { id: d.fromUserId }, select: { fullName: true, departmentId: true } });
  return from && from.departmentId === deptId ? from.fullName : null;
}
async function supervisorOf(client, deptId) {
  if (deptId == null) return null;
  return (await client.department.findUnique({ where: { id: deptId }, select: { supervisorId: true } }))?.supervisorId ?? null;
}
// Người thực hiện việc: chủ trì, lãnh đạo phòng chủ trì (kể cả uỷ quyền), người giao hoặc người quản lý.
// `supporters: true` → tính cả người phối hợp (báo cáo phần phối hợp).
async function canWorkOn(client, user, rights, item, { supporters = false } = {}) {
  if (rights.canManage || item.assignedById === user.id) return true;
  if (item.assignees.some(a => a.userId === user.id) || (supporters && item.supporters.some(a => a.userId === user.id))) return true;
  return (await leadersOf(client, item)).includes(user.id);
}

module.exports = function mountDispatch(app, { prisma, auth, audit }) {
  // ---------- Hộp "Việc phòng được giao" (lãnh đạo phòng, người được uỷ quyền) ----------
  app.get('/api/dispatch/inbox', auth, async (req, res) => {
    const now = new Date();
    // Phòng mình (trưởng / phó phòng) + phòng của người đã uỷ quyền cho mình đang còn hiệu lực.
    const delegated = await prisma.delegation.findMany({ where: { toUserId: req.user.id, revokedAt: null, startsAt: { lte: now }, endsAt: { gte: now } }, select: { fromUserId: true } });
    const fromDepts = delegated.length ? (await prisma.user.findMany({ where: { id: { in: delegated.map(d => d.fromUserId) } }, select: { departmentId: true } })).map(u => u.departmentId) : [];
    const depts = [...new Set([...(isDeptLeader(req.user) ? [req.user.departmentId] : []), ...fromDepts].filter(x => x != null))];
    if (!depts.length) fail(403, 'Chỉ lãnh đạo phòng (hoặc người được uỷ quyền) có hộp việc phòng được giao', 'FORBIDDEN');
    const settings = await getSettings(prisma);
    const rows = await prisma.workItem.findMany({
      where: { archivedAt: null, parentId: null, project: { deletedAt: null, visibility: 'ASSIGNED' }, OR: [{ leadDepartmentId: { in: depts } }, { supportDepartments: { some: { departmentId: { in: depts } } } }], dispatchStatus: { not: null } },
      include: { ...W.BOARD_INCLUDE, project: { include: { approvalSteps: true } }, state: true, children: { where: { archivedAt: null }, select: { id: true, state: { select: { category: true } } } },
        extensions: { where: { status: 'PENDING' }, select: { id: true } }, progressReports: { where: { proposals: { not: '' }, answer: null, forwardedAt: null }, select: { id: true } } },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }], take: 1000,
    });
    const names = Object.fromEntries((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map(r => r.assignedById).filter(Boolean))] } }, select: { id: true, fullName: true } })).map(u => [u.id, u.fullName]));
    const out = rows.map(r => {
      const support = !depts.includes(r.leadDepartmentId);
      const cat = r.state.category;
      const stage = stageOf({ ...r, pendingApproval: r.approvals[0] }, r.project.approvalSteps);
      const tab = support ? 'SUPPORT' : stage.code === 'PENDING_ACCEPT' ? 'PENDING' : ['DONE', 'CANCELLED'].includes(stage.code) ? 'DONE'
        : stage.code === 'WAIT_DEPT' || stage.code === 'WAIT_APPROVAL' ? 'WAIT_DEPT' : stage.code === 'WAIT_BGD' ? 'WAIT_BGD' : 'ACTIVE';
      return { ...W.boardItem(r.project, { ...r, extensions: r.extensions }), project: { id: r.project.id, key: r.project.key, name: r.project.name }, state: { name: r.state.name, category: cat }, stage,
        pendingExtensions: r.extensions.length, openProposals: r.progressReports.length,
        assignedByName: names[r.assignedById] || null, tab, deadline: deadlineStatus(r, now, settings.dueSoonDays),
        childrenTotal: r.children.length, childrenDone: r.children.filter(c => c.state.category === 'COMPLETED').length,
        waitingDays: r.dispatchStatus === 'PENDING' && r.dispatchedAt ? Math.floor((now - r.dispatchedAt) / DAY) : null };
    }).filter(r => r.tab !== 'DONE' || (r.completedAt && now - r.completedAt < 30 * DAY));
    const departments = await prisma.department.findMany({ where: { id: { in: depts } }, select: { id: true, name: true } });
    res.json({ departments, items: out, counts: Object.fromEntries(['PENDING', 'ACTIVE', 'WAIT_DEPT', 'WAIT_BGD', 'SUPPORT', 'DONE'].map(t => [t, out.filter(r => r.tab === t).length])) });
  });

  // ---------- Tiếp nhận + phân công ----------
  app.post('/api/items/:id/accept', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project, rights } = await loadItem(prisma, req.user, id, 'edit');
    const body = req.body || {};
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'item:' + id}))`;
      const item = await itemWithProject(tx, id);
      if (!item.leadDepartmentId || !item.dispatchStatus) fail(409, 'Việc này không giao về phòng', 'NOT_DISPATCHED');
      const leaders = await leadersOf(tx, item);
      if (!(leaders.includes(req.user.id) || rights.canManage)) fail(403, 'Chỉ lãnh đạo phòng chủ trì (hoặc người được uỷ quyền) được tiếp nhận, phân công', 'FORBIDDEN');
      const assigneeIds = await W.activeUsers(tx, W.idList(body.assigneeIds, 'Người chủ trì') || []);
      if (!assigneeIds.length) fail(422, 'Chọn ít nhất một cán bộ chủ trì', 'REQUIRED');
      const supporterIds = (await W.activeUsers(tx, W.idList(body.supporterIds, 'Người phối hợp') || [])).filter(x => !assigneeIds.includes(x));
      const before = item.assignees.map(a => a.userId), beforeS = item.supporters.map(s => s.userId);
      await tx.workItemAssignee.deleteMany({ where: { workItemId: id } });
      await tx.workItemAssignee.createMany({ data: assigneeIds.map(userId => ({ workItemId: id, userId })) });
      await tx.workItemSupporter.deleteMany({ where: { workItemId: id } });
      if (supporterIds.length) await tx.workItemSupporter.createMany({ data: supporterIds.map(userId => ({ workItemId: id, userId })) });
      const data = { dispatchStatus: 'ACCEPTED', acceptedById: req.user.id, ...(item.dispatchStatus === 'PENDING' ? { acceptedAt: new Date() } : {}) };
      // Hạn nội bộ do phòng đặt cho cán bộ: không muộn hơn hạn chính thức.
      if (body.internalDueDate !== undefined) {
        data.internalDueDate = optionalDate(body.internalDueDate, 'Hạn nội bộ');
        if (data.internalDueDate && item.dueDate && data.internalDueDate > item.dueDate) fail(422, 'Hạn nội bộ không được muộn hơn hạn của người giao', 'INVALID_DUE');
      }
      if (['BACKLOG', 'UNSTARTED'].includes(item.state.category)) {
        const started = await tx.workflowState.findFirst({ where: { projectId: project.id, category: 'STARTED' }, orderBy: { position: 'asc' } });
        if (started) Object.assign(data, { stateId: started.id, startedAt: item.startedAt || new Date(), position: await W.endPosition(tx, started.id) });
      }
      await tx.workItem.update({ where: { id }, data });
      const note = text(body.note, 'Ghi chú phân công', { max: 1000 });
      const onBehalfOf = await onBehalfOfLeader(tx, req.user, item.leadDepartmentId);
      await activity(tx, id, req.user.id, item.dispatchStatus === 'PENDING' ? 'DISPATCH_ACCEPTED' : 'DISPATCH_REASSIGNED', { assigneeIds, supporterIds, note, ...(onBehalfOf ? { onBehalfOf } : {}), ...(data.internalDueDate ? { internalDueDate: data.internalDueDate } : {}) });
      const c = label(project, item);
      await notify(tx, assigneeIds.filter(x => !before.includes(x)), { type: 'ASSIGNED', title: `Bạn được phân công chủ trì ${c}`, body: [data.internalDueDate ? `Hạn nộp phòng: ${data.internalDueDate.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}` : null, note].filter(Boolean).join(' · ') || null, link: W.link(project, item) }, req.user.id);
      await notify(tx, supporterIds.filter(x => !beforeS.includes(x)), { type: 'SUPPORTING', title: `Bạn được phân công phối hợp ${c}`, body: note || item.title, link: W.link(project, item) }, req.user.id);
      if (item.dispatchStatus === 'PENDING' && item.assignedById) await notify(tx, [item.assignedById], { type: 'DISPATCH_ACCEPTED', title: `Phòng đã tiếp nhận ${c}`, body: item.title, link: W.link(project, item) }, req.user.id);
      await audit(req, 'DISPATCH_ACCEPT', 'WorkItem', id, null, { assigneeIds, supporterIds }, tx);
    });
    bus.item(project.id, id, req.user.id);
    res.json({ ok: true });
  });

  // ---------- Báo cáo tiến độ (mỗi lần một dòng; kiến nghị chờ trả lời) ----------
  app.post('/api/items/:id/progress-reports', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project, rights } = await loadItem(prisma, req.user, id, 'edit');
    const body = req.body || {};
    const row = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'item:' + id}))`;
      const item = await itemWithProject(tx, id);
      if (!(await canWorkOn(tx, req.user, rights, item, { supporters: true }))) fail(403, 'Chỉ người thực hiện hoặc lãnh đạo phòng chủ trì được báo cáo tiến độ', 'FORBIDDEN');
      if (['COMPLETED', 'CANCELLED'].includes(item.state.category)) fail(409, 'Việc đã kết thúc', 'CLOSED');
      // Người phối hợp báo phần đóng góp của mình — không đổi tiến độ chung của việc.
      const asSupporter = !(await canWorkOn(tx, req.user, rights, item));
      const progress = Number(body.progress);
      if (!Number.isInteger(progress) || progress < 0 || progress > 100) fail(422, 'Tiến độ phải là số nguyên từ 0 đến 100%');
      const content = text(body.content, 'Nội dung đã làm', { required: true, max: 3000 });
      const difficulties = text(body.difficulties, 'Khó khăn', { max: 2000 }) || '';
      const proposals = text(body.proposals, 'Kiến nghị', { max: 2000 }) || '';
      const r = await tx.progressReport.create({ data: { workItemId: id, authorId: req.user.id, progress, content, difficulties, proposals, asSupporter } });
      const resultNote = difficulties || proposals ? { resultNote: [difficulties && 'Khó khăn: ' + difficulties, proposals && 'Kiến nghị: ' + proposals].filter(Boolean).join('\n') } : {};
      if (!asSupporter && project.kind === 'MTL') {
        // MTL: cùng quy định và cùng đường ghi % như Cập nhật nhanh (policy mtl.progress, một nguồn %, tự chuyển trạng thái).
        await MG.mtlGuard(tx, req.user, project, rights, id, { progress: true, manualPct: progress !== item.progress });
        if (progress !== item.progress) await setProgress(tx, { user: req.user, project, rights, item, pct: progress, via: 'PROGRESS_REPORT' });
        if (resultNote.resultNote) await tx.workItem.update({ where: { id }, data: resultNote });
      } else if (!asSupporter) await tx.workItem.update({ where: { id }, data: { progress, ...resultNote } });
      await activity(tx, id, req.user.id, 'PROGRESS_REPORT', { reportId: r.id, progress, hasProposal: !!proposals, asSupporter });
      const supervisor = proposals ? await supervisorOf(tx, item.leadDepartmentId) : null;
      const watchers = [item.assignedById, ...(await leadersOf(tx, item)), ...(asSupporter ? item.assignees.map(a => a.userId) : []), supervisor].filter(x => x && x !== req.user.id);
      await notify(tx, watchers, proposals
        ? { type: 'PROPOSAL', title: `Kiến nghị mới ở ${label(project, item)} — cần trả lời`, body: proposals.slice(0, 200), link: W.link(project, item) }
        : { type: 'PROGRESS', title: `${label(project, item)}: ${asSupporter ? 'người phối hợp báo cáo' : `tiến độ ${progress}%`}`, body: content.slice(0, 200), link: W.link(project, item) }, req.user.id);
      return r;
    });
    bus.item(project.id, id, req.user.id);
    res.status(201).json(row);
  });
  app.post('/api/progress-reports/:id/answer', auth, async (req, res) => {
    const report = await prisma.progressReport.findUnique({ where: { id: intParam(req.params.id) } });
    if (!report) fail(404, 'Không tìm thấy báo cáo', 'NOT_FOUND');
    const { project, rights } = await loadItem(prisma, req.user, report.workItemId);
    if (rights.delegated) fail(403, 'Người được uỷ quyền chỉ duyệt thay, không trả lời kiến nghị', 'FORBIDDEN');
    const item = await itemWithProject(prisma, report.workItemId);
    const leaders = await leadersOf(prisma, item);
    if (!(rights.canManage || item.assignedById === req.user.id || leaders.includes(req.user.id) || permissionScope(req.user, 'work.approve', 'OPERATE') === 'SYSTEM'))
      fail(403, 'Chỉ người giao, lãnh đạo phòng hoặc Ban Giám đốc trả lời kiến nghị', 'FORBIDDEN');
    if (report.authorId === req.user.id) fail(403, 'Không tự trả lời kiến nghị của chính mình', 'FORBIDDEN');
    const answer = text(req.body?.answer, 'Ý kiến trả lời', { required: true, max: 2000 });
    const row = await prisma.$transaction(async tx => {
      const r = await tx.progressReport.update({ where: { id: report.id }, data: { answer, answeredById: req.user.id, answeredAt: new Date() } });
      const onBehalfOf = await onBehalfOfLeader(tx, req.user, item.leadDepartmentId);
      await activity(tx, item.id, req.user.id, 'PROPOSAL_ANSWERED', { reportId: report.id, ...(onBehalfOf && item.assignedById !== req.user.id ? { onBehalfOf } : {}) });
      await notify(tx, [report.authorId], { type: 'PROPOSAL_ANSWERED', title: `Kiến nghị ở ${label(project, item)} đã có ý kiến`, body: answer.slice(0, 200), link: W.link(project, item) }, req.user.id);
      return r;
    });
    bus.item(project.id, item.id, req.user.id);
    res.json(row);
  });

  // Lãnh đạo phòng trình kiến nghị của cán bộ lên Ban Giám đốc (khi vượt thẩm quyền phòng), kèm ý kiến của phòng.
  // Kiến nghị vẫn "chờ trả lời"; người giao / PGĐ phụ trách trả lời (Duyệt / Không duyệt). Phòng không còn thấy ở hàng chờ của mình.
  app.post('/api/progress-reports/:id/forward', auth, async (req, res) => {
    const report = await prisma.progressReport.findUnique({ where: { id: intParam(req.params.id) } });
    if (!report || !report.proposals) fail(404, 'Không tìm thấy kiến nghị', 'NOT_FOUND');
    const { project } = await loadItem(prisma, req.user, report.workItemId);
    const item = await itemWithProject(prisma, report.workItemId);
    const leaders = await leadersOf(prisma, item);
    if (!leaders.includes(req.user.id)) fail(403, 'Chỉ lãnh đạo phòng chủ trì trình kiến nghị lên Ban Giám đốc', 'FORBIDDEN');
    if (report.answer) fail(409, 'Kiến nghị đã có ý kiến trả lời', 'ANSWERED');
    if (report.forwardedAt) fail(409, 'Kiến nghị đã được trình lên Ban Giám đốc', 'FORWARDED');
    const note = text(req.body?.note, 'Ý kiến của phòng', { max: 2000 }) || null;
    const supervisor = await supervisorOf(prisma, item.leadDepartmentId);
    const to = [...new Set([item.assignedById, supervisor].filter(x => x && x !== req.user.id && !leaders.includes(x)))];
    if (!to.length) fail(422, 'Việc này không có người giao / lãnh đạo phụ trách thuộc Ban Giám đốc để trình', 'NO_TARGET');
    const row = await prisma.$transaction(async tx => {
      const r = await tx.progressReport.update({ where: { id: report.id }, data: { forwardedAt: new Date(), forwardedById: req.user.id, forwardNote: note } });
      const onBehalfOf = await onBehalfOfLeader(tx, req.user, item.leadDepartmentId);
      await activity(tx, item.id, req.user.id, 'PROPOSAL_FORWARDED', { reportId: report.id, ...(onBehalfOf ? { onBehalfOf } : {}) });
      await notify(tx, to, { type: 'PROPOSAL', title: `Phòng trình kiến nghị ở ${label(project, item)} — cần BGĐ cho ý kiến`, body: [report.proposals.slice(0, 160), note && `Ý kiến phòng: ${note.slice(0, 120)}`].filter(Boolean).join(' · '), link: W.link(project, item) }, req.user.id);
      await notify(tx, [report.authorId], { type: 'PROGRESS', title: `Kiến nghị ở ${label(project, item)} đã được phòng trình Ban Giám đốc`, body: note ? note.slice(0, 200) : null, link: W.link(project, item) }, req.user.id);
      await audit(req, 'PROPOSAL_FORWARD', 'ProgressReport', report.id, null, { workItemId: item.id }, tx);
      return r;
    });
    bus.item(project.id, item.id, req.user.id);
    res.json(row);
  });

  // ---------- Đề nghị gia hạn ----------
  app.post('/api/items/:id/extensions', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project, rights } = await loadItem(prisma, req.user, id, 'edit');
    const row = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'item:' + id}))`;
      const item = await itemWithProject(tx, id);
      if (!(await canWorkOn(tx, req.user, rights, item))) fail(403, 'Chỉ người thực hiện được đề nghị gia hạn', 'FORBIDDEN');
      if (['COMPLETED', 'CANCELLED'].includes(item.state.category)) fail(409, 'Việc đã kết thúc', 'CLOSED');
      if (await tx.dueExtension.count({ where: { workItemId: id, status: 'PENDING' } })) fail(409, 'Đã có một đề nghị gia hạn đang chờ', 'EXTENSION_PENDING');
      const newDue = optionalDate(req.body?.newDue, 'Hạn mới');
      if (!newDue) fail(422, 'Chọn hạn mới', 'REQUIRED');
      if (item.dueDate && newDue <= item.dueDate) fail(422, 'Hạn mới phải sau hạn hiện tại', 'INVALID_DUE');
      const reason = text(req.body?.reason, 'Lý do', { required: true, max: 1000 });
      const x = await tx.dueExtension.create({ data: { workItemId: id, requestedById: req.user.id, oldDue: item.dueDate, newDue, reason } });
      await activity(tx, id, req.user.id, 'EXTENSION_REQUESTED', { extensionId: x.id, newDue });
      const deciders = item.assignedById && item.assignedById !== req.user.id ? [item.assignedById] : (await leadersOf(tx, item)).filter(u => u !== req.user.id);
      const sup = await supervisorOf(tx, item.leadDepartmentId);
      if (sup && sup !== req.user.id && !deciders.includes(sup)) deciders.push(sup);
      await notify(tx, deciders, { type: 'EXTENSION_REQUESTED', title: `Đề nghị gia hạn ${label(project, item)}`, body: reason.slice(0, 200), link: W.link(project, item) }, req.user.id);
      return x;
    });
    bus.item(project.id, id, req.user.id);
    res.status(201).json(row);
  });
  app.post('/api/extensions/:id/decide', auth, async (req, res) => {
    const ext = await prisma.dueExtension.findUnique({ where: { id: intParam(req.params.id) } });
    if (!ext) fail(404, 'Không tìm thấy đề nghị', 'NOT_FOUND');
    const { project, rights } = await loadItem(prisma, req.user, ext.workItemId);
    if (rights.delegated) fail(403, 'Người được uỷ quyền chỉ duyệt thay, không quyết định gia hạn', 'FORBIDDEN');
    const decision = oneOf(req.body?.decision, ['APPROVE', 'REJECT'], 'Quyết định') || fail(422, 'Thiếu quyết định');
    const note = text(req.body?.note, 'Ý kiến', { max: 1000, required: decision === 'REJECT' });
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'item:' + ext.workItemId}))`;
      const item = await itemWithProject(tx, ext.workItemId);
      const current = await tx.dueExtension.findUnique({ where: { id: ext.id } });
      if (current.status !== 'PENDING') fail(409, 'Đề nghị đã được xử lý', 'CLOSED');
      if (current.requestedById === req.user.id) fail(403, 'Không tự duyệt đề nghị gia hạn của chính mình', 'SELF_APPROVAL');
      // Người giao việc quyết định; việc không có người giao khác thì lãnh đạo phòng chủ trì / người quản lý quyết định.
      const allowed = item.assignedById === req.user.id || rights.canManage || (!item.assignedById || item.assignedById === current.requestedById) && (await leadersOf(tx, item)).includes(req.user.id);
      if (!allowed) fail(403, 'Chỉ người giao việc được duyệt gia hạn', 'FORBIDDEN');
      if (decision === 'APPROVE') await MG.mtlGuard(tx, req.user, project, rights, item.id, { plan: true }); // MTL: hạn là kế hoạch
      const x = await tx.dueExtension.update({ where: { id: ext.id }, data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedById: req.user.id, decidedAt: new Date(), decisionNote: note || null } });
      if (decision === 'APPROVE') await tx.workItem.update({ where: { id: item.id }, data: { dueDate: current.newDue, originalDueDate: item.originalDueDate ?? current.oldDue } });
      await activity(tx, item.id, req.user.id, decision === 'APPROVE' ? 'EXTENSION_APPROVED' : 'EXTENSION_REJECTED', { extensionId: ext.id, newDue: current.newDue, note });
      await notify(tx, [current.requestedById], { type: 'EXTENSION_' + decision, title: `${label(project, item)}: ${decision === 'APPROVE' ? 'đồng ý gia hạn' : 'không đồng ý gia hạn'}`, body: note || null, link: W.link(project, item) }, req.user.id);
      await audit(req, 'EXTENSION_' + decision, 'WorkItem', item.id, { dueDate: current.oldDue }, { dueDate: decision === 'APPROVE' ? current.newDue : current.oldDue }, tx);
      return x;
    });
    bus.item(project.id, ext.workItemId, req.user.id);
    res.json(result);
  });

  // ---------- Văn bản liên quan (số hiệu từ hệ thống văn bản điện tử) ----------
  app.post('/api/items/:id/documents', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project } = await loadItem(prisma, req.user, id, 'edit');
    await itemWithProject(prisma, id);
    const b = req.body || {};
    const url = text(b.url, 'Liên kết', { max: 500 }) || null;
    if (url && !/^https?:\/\//i.test(url)) fail(422, 'Liên kết phải bắt đầu bằng http:// hoặc https://');
    if (await prisma.workItemDocument.count({ where: { workItemId: id } }) >= 50) fail(422, 'Tối đa 50 văn bản mỗi việc');
    const row = await prisma.workItemDocument.create({ data: {
      workItemId: id, kind: oneOf(b.kind, Object.keys(DOC_KINDS), 'Loại văn bản') || 'BASIS', number: text(b.number, 'Số, ký hiệu', { required: true, max: 80 }),
      issuedOn: optionalDate(b.issuedOn, 'Ngày văn bản'), summary: text(b.summary, 'Trích yếu', { required: true, max: 500 }), issuer: text(b.issuer, 'Nơi ban hành', { max: 200 }) || null, url, createdById: req.user.id,
    } });
    await activity(prisma, id, req.user.id, 'DOCUMENT_ADDED', { kind: row.kind, number: row.number });
    bus.item(project.id, id, req.user.id);
    res.status(201).json(row);
  });
  app.delete('/api/documents/:id', auth, async (req, res) => {
    const row = await prisma.workItemDocument.findUnique({ where: { id: intParam(req.params.id) } });
    if (!row) fail(404, 'Không tìm thấy văn bản', 'NOT_FOUND');
    const { project, rights } = await loadItem(prisma, req.user, row.workItemId, 'edit');
    if (!(row.createdById === req.user.id || rights.canManage)) fail(403, 'Chỉ người thêm hoặc người quản lý được gỡ văn bản', 'FORBIDDEN');
    await prisma.workItemDocument.delete({ where: { id: row.id } });
    await activity(prisma, row.workItemId, req.user.id, 'DOCUMENT_REMOVED', { kind: row.kind, number: row.number });
    bus.item(project.id, row.workItemId, req.user.id);
    res.json({ ok: true });
  });

  // ---------- Nộp sản phẩm (phiếu trình) → mở yêu cầu duyệt: lãnh đạo phòng → Ban Giám đốc ----------
  app.post('/api/items/:id/submit', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project, rights } = await loadItem(prisma, req.user, id, 'edit');
    const note = text(req.body?.note, 'Ý kiến đề xuất', { max: 2000 });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'project:' + project.id}))`;
      const item = await tx.workItem.findUnique({ where: { id }, include: { state: true, assignees: true, supporters: true } });
      if (!(await canWorkOn(tx, req.user, rights, item))) fail(403, 'Chỉ người thực hiện được nộp sản phẩm', 'FORBIDDEN');
      if (item.state.category === 'REVIEW') fail(409, 'Việc đang chờ duyệt', 'APPROVAL_PENDING');
      if (['COMPLETED', 'CANCELLED'].includes(item.state.category)) fail(409, 'Việc đã kết thúc', 'CLOSED');
      const review = await tx.workflowState.findFirst({ where: { projectId: project.id, category: 'REVIEW' }, orderBy: { position: 'asc' } });
      const steps = await approval.stepsForItem(tx, project, item);
      if (!review || !steps.length) fail(409, 'Việc này không cần duyệt — chuyển thẳng sang Hoàn thành', 'NO_APPROVAL');
      const t = await W.transition(tx, { project, rights, item, toState: review, overrideWip: 'bulk' });
      const updated = await tx.workItem.update({ where: { id }, data: { ...t.data, position: await W.endPosition(tx, review.id) } });
      await W.afterTransition(tx, { user: req.user, project, item: updated, fromState: item.state, toState: review, steps: t.steps });
      // Ghi "lần trình N" + ý kiến đề xuất vào bước gửi duyệt.
      const round = await tx.approvalRequest.count({ where: { workItemId: id } });
      const reqRow = await tx.approvalRequest.findFirst({ where: { workItemId: id, status: 'PENDING' }, include: { actions: { where: { decision: 'SUBMIT' }, orderBy: { id: 'desc' }, take: 1 } } });
      if (reqRow?.actions[0]) await tx.approvalAction.update({ where: { id: reqRow.actions[0].id }, data: { comment: [round > 1 ? `Lần trình ${round}` : null, note].filter(Boolean).join(' — ') || null } });
      await audit(req, 'SUBMIT', 'WorkItem', id, null, { note: !!note }, tx);
    });
    bus.item(project.id, id, req.user.id);
    res.json({ ok: true });
  });

  // ---------- Việc nhánh hàng loạt (lãnh đạo phòng chủ trì lập kế hoạch chi tiết) ----------
  app.post('/api/items/:id/children/bulk', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project, rights } = await loadItem(prisma, req.user, id, 'edit');
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.filter(r => String(r?.title || '').trim()) : [];
    if (!rows.length) fail(422, 'Nhập ít nhất một việc nhánh', 'REQUIRED');
    if (rows.length > 100) fail(422, 'Tối đa 100 việc nhánh mỗi lần');
    const created = await prisma.$transaction(async tx => {
      const parent = await itemWithProject(tx, id);
      if (parent.parentId) fail(422, 'Chỉ thêm việc nhánh cho việc gốc');
      await MG.mtlCreateGuard(tx, req.user, project, rights, { parentId: id }); // MTL: quản lý dự án / lãnh đạo bộ phận chủ trì
      const leaders = await leadersOf(tx, parent);
      if (!(rights.canManage || parent.assignedById === req.user.id || leaders.includes(req.user.id) || parent.assignees.some(a => a.userId === req.user.id)))
        fail(403, 'Chỉ lãnh đạo phòng chủ trì, người chủ trì hoặc người giao được chia việc nhánh', 'FORBIDDEN');
      const out = [];
      for (const r of rows) {
        const dueDate = r.dueDate ? optionalDate(r.dueDate, 'Hạn') : parent.dueDate;
        if (dueDate && parent.dueDate && dueDate > parent.dueDate) fail(422, `Việc nhánh "${String(r.title).slice(0, 60)}": hạn muộn hơn hạn việc cha`, 'INVALID_DUE');
        const item = await W.createWorkItem(tx, { project, user: req.user, rights, source: 'BULK', input: {
          title: r.title, parentId: id, assigneeIds: r.assigneeIds || parent.assignees.map(a => a.userId), dueDate, priority: parent.priority, assignedById: req.user.id,
          deliverable: r.deliverable || '', overrideWip: 'bulk',
        } });
        out.push({ id: item.id, code: code(project, item), title: item.title, dueDate: item.dueDate });
      }
      await activity(tx, id, req.user.id, 'CHILDREN_BULK', { count: out.length });
      return out;
    }, { timeout: 60_000 });
    bus.project(project.id, req.user.id);
    res.status(201).json({ created });
  });

  // ---------- Giao nhiều việc một lúc (Văn phòng nhập chỉ đạo sau giao ban) ----------
  app.post('/api/projects/:id/dispatch/bulk', auth, async (req, res) => {
    const { project, rights, member } = await loadProject(prisma, req.user, intParam(req.params.id), 'edit');
    assertRegisterManager(project, rights, member);
    if (project.visibility !== 'ASSIGNED') fail(422, 'Chỉ dùng trong sổ giao việc của đơn vị', 'DISPATCH_NOT_ALLOWED');
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.filter(r => String(r?.title || '').trim()) : [];
    if (!rows.length) fail(422, 'Nhập ít nhất một nhiệm vụ', 'REQUIRED');
    if (rows.length > 100) fail(422, 'Tối đa 100 nhiệm vụ mỗi lần');
    const created = await prisma.$transaction(async tx => {
      const out = [];
      for (const [i, r] of rows.entries()) {
        if (!r.leadDepartmentId && !(r.assigneeIds || []).length) fail(422, `Dòng ${i + 1}: chọn phòng chủ trì`, 'REQUIRED');
        const item = await W.createWorkItem(tx, { project, user: req.user, rights, source: 'BULK', input: {
          title: r.title, leadDepartmentId: r.leadDepartmentId, supportDepartmentIds: r.supportDepartmentIds, dueDate: r.dueDate, priority: r.priority || 'HIGH', taskType: r.taskType || 'ADHOC',
          assignedById: req.body.assignedById ?? r.assignedById ?? req.user.id, source: req.body.source ?? r.source ?? null, deliverable: r.deliverable || '', assigneeIds: r.assigneeIds, overrideWip: 'bulk',
        } });
        if (r.docNumber) await tx.workItemDocument.create({ data: { workItemId: item.id, kind: 'BASIS', number: text(r.docNumber, 'Số văn bản', { max: 80 }), issuedOn: optionalDate(r.docDate, 'Ngày văn bản'), summary: text(r.docSummary, 'Trích yếu', { max: 500 }) || 'Văn bản căn cứ', createdById: req.user.id } });
        out.push({ id: item.id, code: code(project, item), title: item.title });
      }
      await audit(req, 'DISPATCH_BULK', 'Project', project.id, null, { count: out.length }, tx);
      return out;
    }, { timeout: 60_000 });
    bus.project(project.id, req.user.id);
    res.status(201).json({ created });
  });

  // ---------- Phòng phối hợp cử cán bộ phối hợp ----------
  app.post('/api/items/:id/support-staff', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project } = await loadItem(prisma, req.user, id);
    const ids = W.idList(req.body?.userIds, 'Cán bộ phối hợp') || [];
    await prisma.$transaction(async tx => {
      const item = await tx.workItem.findUnique({ where: { id }, include: { supportDepartments: true, supporters: true, assignees: true } });
      if (item.archivedAt) fail(409, 'Việc đang ở trong thùng rác', 'ARCHIVED');
      const mine = [];
      for (const d of item.supportDepartments) if ((await approval.deptLeaderIds(tx, d.departmentId)).includes(req.user.id)) mine.push(d.departmentId);
      if (!mine.length) fail(403, 'Chỉ lãnh đạo phòng phối hợp được cử cán bộ phối hợp', 'FORBIDDEN');
      const users = await tx.user.findMany({ where: { id: { in: ids }, isActive: true, departmentId: { in: mine } }, select: { id: true } });
      if (users.length !== ids.length) fail(422, 'Chỉ cử được cán bộ thuộc phòng phối hợp của bạn', 'INVALID_ASSIGNEE');
      // Thay danh sách người phối hợp của phòng mình, giữ người phối hợp của phòng khác.
      const others = item.supporters.map(s => s.userId);
      const ofMine = (await tx.user.findMany({ where: { id: { in: others }, departmentId: { in: mine } }, select: { id: true } })).map(u => u.id);
      const next = [...new Set([...others.filter(x => !ofMine.includes(x)), ...ids])].filter(x => !item.assignees.some(a => a.userId === x));
      await tx.workItemSupporter.deleteMany({ where: { workItemId: id } });
      if (next.length) await tx.workItemSupporter.createMany({ data: next.map(userId => ({ workItemId: id, userId })) });
      await activity(tx, id, req.user.id, 'SUPPORT_STAFF', { userIds: ids });
      await notify(tx, ids.filter(x => !others.includes(x)), { type: 'SUPPORTING', title: `Bạn được cử phối hợp ${label(project, item)}`, body: null, link: W.link(project, item) }, req.user.id);
    });
    bus.item(project.id, id, req.user.id);
    res.json({ ok: true });
  });

  // ---------- Uỷ quyền có thời hạn (duyệt, tiếp nhận việc phòng) ----------
  app.get('/api/delegations', auth, async (req, res) => {
    const rows = await prisma.delegation.findMany({ where: { OR: [{ fromUserId: req.user.id }, { toUserId: req.user.id }] }, orderBy: { id: 'desc' }, take: 100 });
    const names = Object.fromEntries((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap(r => [r.fromUserId, r.toUserId]))] } }, select: { id: true, fullName: true } })).map(u => [u.id, u.fullName]));
    const now = new Date();
    res.json(rows.map(r => ({ ...r, fromName: names[r.fromUserId], toName: names[r.toUserId], active: !r.revokedAt && r.startsAt <= now && r.endsAt >= now })));
  });
  app.post('/api/delegations', auth, async (req, res) => {
    if (!hasPermission(req.user, 'work.approve', 'OPERATE')) fail(403, 'Chỉ người có quyền duyệt mới uỷ quyền được', 'FORBIDDEN');
    const toUserId = intParam(req.body?.toUserId, 'Người nhận uỷ quyền');
    if (toUserId === req.user.id) fail(422, 'Không tự uỷ quyền cho chính mình');
    const to = await prisma.user.findFirst({ where: { id: toUserId, isActive: true, isRootAdmin: false, role: { not: 'admin' } }, include: { permissions: true } });
    if (!to || !hasPermission(to, 'work.approve', 'OPERATE')) fail(422, 'Người nhận uỷ quyền phải là lãnh đạo có quyền duyệt (trưởng / phó phòng, Ban Giám đốc)', 'INVALID_DELEGATE');
    // Không uỷ quyền bước Ban Giám đốc xuống cấp phòng.
    if (permissionScope(req.user, 'work.approve', 'OPERATE') === 'SYSTEM' && permissionScope(to, 'work.approve', 'OPERATE') !== 'SYSTEM')
      fail(422, 'Thành viên Ban Giám đốc chỉ uỷ quyền cho thành viên Ban Giám đốc khác', 'INVALID_DELEGATE');
    const startsAt = optionalDate(req.body?.startsAt, 'Từ ngày') || new Date();
    const endsRaw = optionalDate(req.body?.endsAt, 'Đến ngày');
    if (!endsRaw) fail(422, 'Chọn ngày kết thúc uỷ quyền', 'REQUIRED');
    const endsAt = new Date(endsRaw.getTime() + DAY - 1); // hết ngày cuối (giờ Việt Nam)
    if (endsAt <= startsAt || endsAt - startsAt > 366 * DAY) fail(422, 'Thời hạn uỷ quyền không hợp lệ (tối đa 1 năm)');
    const row = await prisma.delegation.create({ data: { fromUserId: req.user.id, toUserId, startsAt, endsAt, note: text(req.body?.note, 'Nội dung uỷ quyền', { max: 300 }) || null } });
    await notify(prisma, [toUserId], { type: 'DELEGATED', title: `${req.user.fullName} uỷ quyền cho bạn duyệt / tiếp nhận việc`, body: row.note, link: '#/dept' }, req.user.id);
    await audit(req, 'CREATE', 'Delegation', row.id, null, { toUserId, startsAt, endsAt });
    res.status(201).json(row);
  });
  app.delete('/api/delegations/:id', auth, async (req, res) => {
    const row = await prisma.delegation.findUnique({ where: { id: intParam(req.params.id) } });
    if (!row || row.fromUserId !== req.user.id) fail(404, 'Không tìm thấy uỷ quyền', 'NOT_FOUND');
    const updated = await prisma.delegation.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await audit(req, 'REVOKE', 'Delegation', row.id, null, { toUserId: row.toUserId });
    res.json(updated);
  });
};
module.exports.DOC_KINDS = DOC_KINDS;
