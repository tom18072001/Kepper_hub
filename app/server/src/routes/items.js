// Công việc: danh sách theo dự án (Board/List/Calendar/Timeline), tạo, sửa, kéo-thả, checklist, bình luận.
const { fail, intParam, optionalInt, optionalDate, text, oneOf } = require('../lib/http');
const { sanitizeHtml, htmlToText, mentions } = require('../lib/rich-text');
const { permissionScope } = require('../lib/permissions');
const MTL = require('../services/mtl');
const { loadProject, loadItem, projectRights, itemVisibleWhere, isDeptLeader, canSeeItem, isRegisterWriter, ITEM_ACCESS_SELECT } = require('../services/access');
const { activity, notify } = require('../services/events');
const approval = require('../services/approval');
const bus = require('../services/bus');
const W = require('../services/workitems');
const { describe: describeRule } = require('../services/recurring');
const { stageOf } = require('../services/stage');

const { PRIORITIES, BOARD_INCLUDE, boardItem } = W;

function itemFilters(query) {
  const where = {};
  if (query.archived !== 'true') where.archivedAt = null;
  if (query.q) {
    const q = String(query.q).slice(0, 100);
    const n = Number(q.replace(/^[A-Z0-9]+-/i, ''));
    where.OR = [{ title: { contains: q, mode: 'insensitive' } }, { descriptionText: { contains: q, mode: 'insensitive' } }, { documents: { some: { number: { contains: q, mode: 'insensitive' } } } }, ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : [])];
  }
  if (query.assignee === 'none') where.assignees = { none: {} };
  else if (query.assignee) where.assignees = { some: { userId: intParam(query.assignee, 'Người nhận') } };
  if (query.label) where.labels = { some: { labelId: intParam(query.label, 'Nhãn') } };
  if (query.priority) where.priority = oneOf(query.priority, PRIORITIES, 'Ưu tiên');
  if (query.stateId) where.stateId = intParam(query.stateId, 'Trạng thái');
  if (query.cycleId === 'none') where.cycleId = null;
  else if (query.cycleId) where.cycleId = intParam(query.cycleId, 'Chu kỳ');
  if (query.taskType) where.taskType = oneOf(query.taskType, W.TASK_TYPES, 'Loại nhiệm vụ');
  // Cập nhật thời gian thực: chỉ tải lại vài việc vừa đổi.
  if (query.ids) { const ids = String(query.ids).split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 50); where.id = { in: ids }; }
  if (query.leadDepartmentId) where.leadDepartmentId = intParam(query.leadDepartmentId, 'Đơn vị chủ trì');
  if (query.dueFrom || query.dueTo) where.dueDate = { ...(query.dueFrom ? { gte: optionalDate(query.dueFrom, 'Từ ngày') } : {}), ...(query.dueTo ? { lte: optionalDate(query.dueTo, 'Đến ngày') } : {}) };
  return where;
}

// Việc điều hành (giao về phòng, hoặc mọi việc trong sổ của đơn vị): ai được làm gì ngoài báo cáo / bình luận.
// - Người giao, người nhập thay (Văn phòng), người quản lý: toàn quyền.
// - Người thực hiện (chủ trì, lãnh đạo phòng chủ trì kể cả uỷ quyền): đổi nội dung, trạng thái (trừ Huỷ).
// - Người khác có quyền sửa (người phối hợp, lãnh đạo phòng phối hợp…): chỉ "sản phẩm đã có theo tiến độ".
const SUPPORT_FIELDS = new Set(['outputs', 'overrideWip']);
async function dispatchRole(tx, user, rights, project, item) {
  if (!item.dispatchStatus && project.visibility !== 'ASSIGNED') return 'FULL';
  if (rights.canManage || item.assignedById === user.id || item.reporterId === user.id) return 'FULL';
  if (item.assignees.some(a => a.userId === user.id)) return 'WORKER';
  let dept = item.leadDepartmentId;
  if (dept == null && item.parentId) dept = (await tx.workItem.findUnique({ where: { id: item.parentId }, select: { leadDepartmentId: true } }))?.leadDepartmentId ?? null;
  return (await approval.deptLeaderIds(tx, dept)).includes(user.id) ? 'WORKER' : 'SUPPORT';
}
function assertDispatchChange(role, { toState, keys = [] }) {
  if (role === 'FULL') return;
  if (toState?.category === 'CANCELLED') fail(403, 'Chỉ người giao việc hoặc người quản lý được huỷ việc này', 'FORBIDDEN');
  if (role === 'SUPPORT' && (toState || keys.some(k => !SUPPORT_FIELDS.has(k))))
    fail(403, 'Người phối hợp chỉ báo cáo phần phối hợp (Báo cáo tiến độ), bình luận, đính kèm — không đổi nội dung hay trạng thái việc', 'SUPPORT_ONLY');
}

const ITEMS_LIMIT = 5000;

module.exports = function mountItems(app, { prisma, auth, audit }) {
  app.get('/api/projects/:id/items', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id));
    const where = { projectId: project.id, ...itemFilters(req.query), AND: [itemVisibleWhere(req.user)] };
    const rows = await prisma.workItem.findMany({ where, include: { ...BOARD_INCLUDE, state: { select: { category: true } } }, orderBy: [{ position: 'asc' }, { id: 'asc' }], take: ITEMS_LIMIT });
    // Bị cắt: báo tổng số để giao diện nhắc dùng bộ lọc (không âm thầm bỏ việc).
    if (rows.length === ITEMS_LIMIT) res.setHeader('X-Total-Count', String(await prisma.workItem.count({ where })));
    const steps = await approval.stepsOf(prisma, project.id);
    res.json(rows.map(r => { const { state, ...rest } = r; return { ...boardItem(project, rest), stage: stageOf({ ...r, pendingApproval: r.approvals[0] }, steps) }; }));
  });

  app.post('/api/projects/:id/items', auth, async (req, res) => {
    const { project, rights, member } = await loadProject(prisma, req.user, intParam(req.params.id), 'edit');
    // Sổ giao việc của đơn vị: việc gốc do Ban Giám đốc / người quản lý sổ / thành viên sổ giao;
    // người khác (lãnh đạo phòng, cán bộ) chỉ thêm việc nhánh dưới việc mình được thấy.
    if (project.visibility === 'ASSIGNED' && !rights.canManage && !isRegisterWriter(member)) {
      const parentId = optionalInt(req.body?.parentId, 'Việc cha');
      if (!parentId) fail(403, 'Chỉ Ban Giám đốc / người quản lý sổ được giao việc mới — bạn có thể thêm việc nhánh trong việc được giao', 'FORBIDDEN');
      const parent = await loadItem(prisma, req.user, parentId, 'edit');
      if (parent.project.id !== project.id) fail(422, 'Việc cha không thuộc dự án');
    }
    const created = await prisma.$transaction(async tx => {
      const item = await W.createWorkItem(tx, { project, user: req.user, rights, input: req.body || {} });
      await audit(req, 'CREATE', 'WorkItem', item.id, null, { code: `${project.key}-${item.number}`, title: item.title }, tx);
      return item;
    });
    bus.item(project.id, created.id, req.user.id);
    const row = await prisma.workItem.findUnique({ where: { id: created.id }, include: BOARD_INCLUDE });
    res.status(201).json(boardItem(project, row));
  });

  app.get('/api/items/:id', auth, async (req, res) => {
    const { project, rights, member } = await loadItem(prisma, req.user, intParam(req.params.id));
    const item = await prisma.workItem.findUnique({ where: { id: intParam(req.params.id) }, include: {
      ...BOARD_INCLUDE, state: true,
      progressReports: { orderBy: { id: 'desc' }, take: 100 }, extensions: { orderBy: { id: 'desc' } }, documents: { orderBy: { id: 'asc' } }, parent: { select: { id: true, number: true, title: true } }, cycle: true,
      children: { where: { archivedAt: null }, select: { id: true, number: true, title: true, dueDate: true, baselineStart: true, baselineEnd: true, weight: true, startedAt: true, internalDueDate: true, progress: true, completedAt: true, returnedAt: true, dispatchStatus: true,
        state: { select: { name: true, category: true } }, assignees: { select: { user: { select: { id: true, fullName: true } } } }, approvals: { where: { status: 'PENDING' }, select: { currentLevel: true } } }, orderBy: { id: 'asc' } },
      plan: { select: { id: true, name: true, year: true } },
      checklist: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
      comments: { orderBy: { id: 'asc' } },
      attachments: { orderBy: { id: 'desc' } },
      activities: { orderBy: { id: 'desc' }, take: 100 },
      approvals: { orderBy: { id: 'desc' }, include: { actions: { orderBy: { id: 'asc' } } } },
      intakeRequest: { select: { id: true, requesterId: true, createdAt: true } },
    } });
    const userIds = [...new Set([item.reporterId, item.assignedById, item.reviewedById, item.ratedById, item.acceptedById,
      ...item.progressReports.flatMap(r => [r.authorId, r.answeredById, r.forwardedById]), ...item.extensions.flatMap(x => [x.requestedById, x.decidedById]), ...item.documents.map(d => d.createdById), item.intakeRequest?.requesterId, ...item.comments.map(c => c.authorId), ...item.activities.map(a => a.actorId), ...item.attachments.map(a => a.uploadedById), ...item.approvals.flatMap(r => r.actions.flatMap(a => [a.actorId, a.onBehalfOfId]))].filter(Boolean))];
    const names = Object.fromEntries((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })).map(u => [u.id, u.fullName]));
    const rule = item.recurringRuleId ? await prisma.recurringRule.findUnique({ where: { id: item.recurringRuleId } }) : null;
    const allSteps = await approval.stepsOf(prisma, project.id);
    const pending = item.approvals.find(r => r.status === 'PENDING');
    // Đang chờ duyệt: hiện đúng số cấp đã chốt lúc gửi; ngược lại: số cấp hiệu lực hiện tại của việc.
    const effective = await approval.levelsForItem(prisma, project, allSteps, { id: item.id, parentId: item.parentId, approvalLevels: item.approvalLevels, priority: item.priority, labelIds: item.labels.map(l => l.labelId) });
    const steps = allSteps.slice(0, pending ? pending.totalLevels : effective.levels);
    const canApprove = pending ? await approval.canAct(prisma, req.user, project, pending, item) : false;
    const lastLevel = pending ? pending.currentLevel === pending.totalLevels : false;
    // Lãnh đạo phòng chủ trì (trưởng / phó phòng hoặc người được uỷ quyền): tiếp nhận, phân công, duyệt cấp phòng.
    const leadLeaders = item.leadDepartmentId ? await approval.deptLeaderIds(prisma, item.leadDepartmentId) : [];
    const isLeadLeader = leadLeaders.includes(req.user.id) || (isDeptLeader(req.user) && req.user.departmentId === item.leadDepartmentId);
    const isAssigner = item.assignedById === req.user.id;
    const isAssignee = item.assignees.some(a => a.userId === req.user.id), isSupporter = item.supporters.some(a => a.userId === req.user.id);
    // Lãnh đạo phòng phối hợp: cử cán bộ phối hợp.
    let supportLead = false;
    for (const sd of item.supportDepartments) if ((await approval.deptLeaderIds(prisma, sd.departmentId)).includes(req.user.id)) { supportLead = true; break; }
    const approverNames = Object.fromEntries((await prisma.user.findMany({ where: { isActive: true, permissions: { some: { permissionKey: 'work.approve' } } }, select: { id: true, fullName: true } })).map(u => [u.id, u.fullName]));
    const depts = Object.fromEntries((await prisma.department.findMany({ where: { id: { in: [item.leadDepartmentId, ...item.supportDepartments.map(d => d.departmentId)].filter(Boolean) } }, select: { id: true, name: true } })).map(d => [d.id, d.name]));
    // Sổ giao việc của đơn vị: người chỉ thấy việc nhánh thì không thấy tiêu đề việc cha.
    if (item.parent && project.visibility === 'ASSIGNED') {
      const pa = await prisma.workItem.findUnique({ where: { id: item.parent.id }, select: ITEM_ACCESS_SELECT });
      if (!canSeeItem(req.user, project, member, pa)) item.parent = { id: item.parent.id, number: item.parent.number, title: null };
    }
    const base = boardItem(project, { ...item, checklist: item.checklist, approvals: pending ? [pending] : [], extensions: item.extensions.filter(x => x.status === 'PENDING') });
    res.json({
      ...base, descriptionHtml: item.descriptionHtml, state: item.state, parent: item.parent, children: item.children, cycle: item.cycle,
      intake: item.intakeRequest ? { id: item.intakeRequest.id, requesterName: names[item.intakeRequest.requesterId], createdAt: item.intakeRequest.createdAt } : null,
      project: { id: project.id, key: project.key, name: project.name }, rights, reporterName: names[item.reporterId] || null, assignedByName: names[item.assignedById] || null, reviewedByName: names[item.reviewedById] || null, plan: item.plan,
      checklist: item.checklist, comments: item.comments.map(c => ({ ...c, authorName: names[c.authorId] })),
      attachments: item.attachments.map(a => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, createdAt: a.createdAt, uploadedById: a.uploadedById, uploadedByName: names[a.uploadedById] })),
      activities: item.activities.map(a => ({ ...a, actorName: names[a.actorId] || 'Hệ thống' })),
      recurring: rule ? { ...rule, schedule: describeRule(rule) } : null,
      approvalSteps: steps, allApprovalSteps: allSteps, approvalLevels: item.approvalLevels, approvalSource: effective.source, defaultApprovalLevels: project.defaultApprovalLevels, canApprove,
      approvals: item.approvals.map(r => ({ ...r, actions: r.actions.map(a => ({ ...a, actorName: names[a.actorId], onBehalfOfName: names[a.onBehalfOfId] || null })) })),
      leadDepartment: item.leadDepartmentId ? { id: item.leadDepartmentId, name: depts[item.leadDepartmentId] } : null,
      supportDepartments: item.supportDepartments.map(d => ({ id: d.departmentId, name: depts[d.departmentId] })),
      acceptedByName: names[item.acceptedById] || null, ratedByName: names[item.ratedById] || null, ratingLabel: item.rating ? approval.RATINGS[item.rating] : null,
      progressReports: item.progressReports.map(r => ({ ...r, authorName: names[r.authorId], answeredByName: names[r.answeredById] || null, forwardedByName: names[r.forwardedById] || null })),
      extensions: item.extensions.map(x => ({ ...x, requestedByName: names[x.requestedById], decidedByName: names[x.decidedById] || null })),
      documents: item.documents.map(d => ({ ...d, createdByName: names[d.createdById] })),
      lastLevel,
      can: {
        accept: item.dispatchStatus === 'PENDING' && (isLeadLeader || rights.canManage) && !item.archivedAt,
        reassign: item.dispatchStatus === 'ACCEPTED' && (isLeadLeader || rights.canManage),
        decideExtension: isAssigner || rights.canManage,
        answer: isAssigner || rights.canManage || isLeadLeader,
        isLeadLeader, isAssigner,
        // Kiến nghị: lãnh đạo phòng (không phải người giao / BGĐ) có thể trình lên BGĐ; người giao / BGĐ trả lời cả kiến nghị phòng đã trình.
        bgd: isAssigner || permissionScope(req.user, 'work.approve', 'OPERATE') === 'SYSTEM',
        forward: isLeadLeader && !isAssigner && permissionScope(req.user, 'work.approve', 'OPERATE') !== 'SYSTEM',
        // Người thực hiện: chủ trì, lãnh đạo phòng chủ trì (nộp sản phẩm, báo cáo tiến độ, xin gia hạn). Người phối hợp chỉ báo phần phối hợp.
        work: isLeadLeader || isAssignee, support: isSupporter && !isAssignee && !isLeadLeader, supportLead,
        progress: !item.dispatchStatus || isLeadLeader || isAssignee,
        assigner: rights.canManage || isAssigner || !item.assignedById,
        myRole: isAssignee ? 'LEAD' : isSupporter ? 'SUPPORT' : isLeadLeader ? 'LEADER' : isAssigner ? 'ASSIGNER' : null,
      },
      stage: stageOf({ ...item, pendingApproval: pending }, allSteps),
      // Kepper: tình trạng so với kế hoạch gốc (hạng mục có con: % thực tế = bình quân gia quyền của con).
      mtl: project.kind === 'MTL' ? (() => {
        const kids = item.children.map(c => ({ ...c, parentId: item.id }));
        const act = MTL.rollup([{ ...item, parentId: null }, ...kids]).get(item.id);
        const st = MTL.statusOf(item, act, new Date(), MTL.alertConfigOf(project));
        return { actual: act, planned: st.planned ?? MTL.plannedPct(item), status: st.code, statusLabel: MTL.STATUS[st.code], variance: st.variance ?? null, lateDays: st.lateDays ?? null };
      })() : null,
      submitRounds: item.approvals.length,
      children: item.children.map(c => ({ ...c, assignees: c.assignees.map(a => a.user), stage: stageOf({ ...c, pendingApproval: c.approvals[0] }, allSteps) })),
      // Người duyệt thực tế từng bước của RIÊNG việc này (việc giao về phòng: lãnh đạo phòng chủ trì, PGĐ phụ trách…).
      stepApprovers: await (async () => { const ctx = await approval.approvalContext(prisma); return Object.fromEntries(steps.map(st => [st.level, approval.approverIdsSync(ctx, project, st, item).map(id => approverNames[id]).filter(Boolean)])); })(),
    });
  });

  app.patch('/api/items/:id', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project, rights } = await loadItem(prisma, req.user, id, 'edit');
    const body = req.body || {};
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'item:' + id}))`;
      const item = await tx.workItem.findUnique({ where: { id }, include: { state: true, assignees: true, labels: true } });
      if (item.archivedAt) fail(409, 'Việc đã được lưu trữ', 'ARCHIVED');
      const role = await dispatchRole(tx, req.user, rights, project, item);
      const toStateEarly = body.stateId !== undefined && Number(body.stateId) !== item.stateId ? await tx.workflowState.findFirst({ where: { id: intParam(body.stateId, 'Trạng thái'), projectId: project.id } }) : null;
      assertDispatchChange(role, { toState: toStateEarly, keys: Object.keys(body).filter(k => k !== 'stateId') });
      const data = {}, changed = {};
      if (body.title !== undefined) data.title = text(body.title, 'Tiêu đề', { required: true, max: 300 });
      if (body.descriptionHtml !== undefined) { data.descriptionHtml = sanitizeHtml(body.descriptionHtml); data.descriptionText = htmlToText(data.descriptionHtml); }
      if (body.priority !== undefined) data.priority = oneOf(body.priority, PRIORITIES, 'Ưu tiên');
      if (body.dueDate !== undefined) {
        data.dueDate = optionalDate(body.dueDate, 'Hạn');
        const changedDue = (item.dueDate?.getTime() ?? null) !== (data.dueDate?.getTime() ?? null);
        // Hạn do người khác giao: người thực hiện không tự lùi hạn (giữ tỷ lệ đúng hạn trung thực) — gửi đề nghị gia hạn.
        // Lãnh đạo phòng chủ trì đặt được hạn nội bộ cho việc nhánh của phòng.
        if (changedDue && item.assignedById && item.assignedById !== req.user.id && !rights.canManage
          && !(item.parentId && (await approval.deptLeaderIds(tx, item.leadDepartmentId)).includes(req.user.id)))
          fail(403, 'Hạn do người giao đặt — hãy gửi đề nghị gia hạn', 'USE_EXTENSION');
        // Người có thẩm quyền đổi hạn trực tiếp = lập lại kế hoạch → hạn gốc theo hạn mới; chỉ gia hạn theo đề nghị mới giữ hạn gốc.
        if (changedDue) data.originalDueDate = data.dueDate;
        // Hạ hạn chính thức xuống trước hạn nội bộ: kéo hạn nội bộ theo (không để hạn nộp phòng muộn hơn hạn của người giao).
        if (body.internalDueDate === undefined && item.internalDueDate && data.dueDate && item.internalDueDate > data.dueDate) data.internalDueDate = data.dueDate;
      }
      if (body.internalDueDate !== undefined) {
        const leaders = await approval.deptLeaderIds(tx, item.leadDepartmentId);
        if (!(rights.canManage || item.assignedById === req.user.id || leaders.includes(req.user.id))) fail(403, 'Chỉ lãnh đạo phòng chủ trì đặt hạn nội bộ', 'FORBIDDEN');
        data.internalDueDate = optionalDate(body.internalDueDate, 'Hạn nội bộ');
        const due = data.dueDate !== undefined ? data.dueDate : item.dueDate;
        if (data.internalDueDate && due && data.internalDueDate > due) fail(422, 'Hạn nội bộ không được muộn hơn hạn của người giao', 'INVALID_DUE');
      }
      // Việc điều hành (giao về phòng): tiến độ chỉ do người chủ trì / lãnh đạo phòng chủ trì cập nhật, và mỗi lần cập nhật thành một dòng báo cáo.
      if (body.progress !== undefined && item.dispatchStatus) {
        const leaders = await approval.deptLeaderIds(tx, item.leadDepartmentId);
        if (!(item.assignees.some(a => a.userId === req.user.id) || leaders.includes(req.user.id))) fail(403, 'Tiến độ do người chủ trì cập nhật qua "Báo cáo tiến độ"', 'USE_PROGRESS_REPORT');
        const p = Number(body.progress);
        if (Number.isFinite(p) && Math.round(p) !== item.progress) await tx.progressReport.create({ data: { workItemId: id, authorId: req.user.id, progress: Math.max(0, Math.min(100, Math.round(p))), content: `Cập nhật tiến độ ${Math.round(p)}%` } });
      }
      // Loại nhiệm vụ, đơn vị chủ trì: người giao hoặc người quản lý sổ / dự án.
      if (body.taskType !== undefined || body.leadDepartmentId !== undefined) {
        if (!(rights.canManage || item.assignedById === req.user.id)) fail(403, 'Chỉ người giao việc hoặc người quản lý được đổi loại nhiệm vụ / đơn vị chủ trì', 'FORBIDDEN');
        if (body.taskType !== undefined) data.taskType = oneOf(body.taskType, W.TASK_TYPES, 'Loại nhiệm vụ') || item.taskType;
        if (body.leadDepartmentId !== undefined) {
          data.leadDepartmentId = await W.departmentIdOf(tx, body.leadDepartmentId, 'Đơn vị chủ trì');
          if (project.visibility !== 'ASSIGNED' && project.kind !== 'MTL' && data.leadDepartmentId != null && data.leadDepartmentId !== project.departmentId)
            fail(422, 'Giao về phòng khác chỉ dùng trong sổ giao việc của đơn vị', 'DISPATCH_NOT_ALLOWED');
          // Việc nhánh đi theo đơn vị chủ trì mới (quyền xem, cấp duyệt "Trưởng phòng").
          if (data.leadDepartmentId !== item.leadDepartmentId) await tx.workItem.updateMany({ where: { parentId: id, leadDepartmentId: item.leadDepartmentId }, data: { leadDepartmentId: data.leadDepartmentId } });
          if (project.visibility === 'ASSIGNED' && data.leadDepartmentId !== item.leadDepartmentId && data.leadDepartmentId != null && !item.parentId) {
            Object.assign(data, { dispatchStatus: 'PENDING', dispatchedAt: new Date(), acceptedAt: null, acceptedById: null });
            await notify(tx, await approval.deptLeaderIds(tx, data.leadDepartmentId), { type: 'DISPATCH', title: `Phòng được giao chủ trì ${project.key}-${item.number} — cần tiếp nhận, phân công`, body: item.title, link: W.link(project, item) }, req.user.id);
          }
        }
      }
      const supportDepartmentIds = await W.departmentIds(tx, body.supportDepartmentIds);
      if (supportDepartmentIds && project.visibility !== 'ASSIGNED' && project.kind !== 'MTL') fail(422, 'Đơn vị phối hợp chỉ dùng trong sổ giao việc của đơn vị', 'DISPATCH_NOT_ALLOWED');
      if (supportDepartmentIds) {
        if (!(rights.canManage || item.assignedById === req.user.id)) fail(403, 'Chỉ người giao việc hoặc người quản lý được đổi đơn vị phối hợp', 'FORBIDDEN');
        const before = (await tx.workItemDepartment.findMany({ where: { workItemId: id } })).map(d => d.departmentId);
        await tx.workItemDepartment.deleteMany({ where: { workItemId: id } });
        const next = supportDepartmentIds.filter(d => d !== (data.leadDepartmentId ?? item.leadDepartmentId));
        if (next.length) await tx.workItemDepartment.createMany({ data: next.map(departmentId => ({ workItemId: id, departmentId })) });
        changed.supportDepartmentIds = next;
        for (const d of next.filter(x => !before.includes(x))) await notify(tx, await approval.deptLeaderIds(tx, d), { type: 'DISPATCH_SUPPORT', title: `Phòng được giao phối hợp ${project.key}-${item.number}`, body: item.title, link: W.link(project, item) }, req.user.id);
      }
      if (body.startDate !== undefined) data.startDate = optionalDate(body.startDate, 'Ngày bắt đầu');
      if (body.estimate !== undefined) data.estimate = body.estimate == null || body.estimate === '' ? null : Number(body.estimate) || null;
      if (body.cycleId !== undefined) data.cycleId = await W.cycleOf(tx, project.id, body.cycleId);
      if (body.approvalLevels !== undefined) {
        data.approvalLevels = W.approvalLevelsInput(body.approvalLevels, rights);
        if (await tx.approvalRequest.count({ where: { workItemId: id, status: 'PENDING' } }))
          fail(409, 'Việc đang chờ duyệt — không đổi được mức duyệt cho tới khi duyệt xong hoặc rút lại', 'APPROVAL_PENDING');
      }
      if (body.parentId !== undefined) {
        data.parentId = optionalInt(body.parentId, 'Việc cha');
        if (data.parentId === id) fail(422, 'Việc cha không hợp lệ');
        if (data.parentId && !(await tx.workItem.findFirst({ where: { id: data.parentId, projectId: project.id } }))) fail(422, 'Việc cha không thuộc dự án');
      }
      // Người giao chỉ do người giao hiện tại hoặc người quản lý đổi (tránh tự đặt mình làm người giao để lùi hạn, tự duyệt gia hạn…).
      if (body.assignedById !== undefined && Number(body.assignedById || 0) !== Number(item.assignedById || 0) && item.assignedById && item.assignedById !== req.user.id && !rights.canManage)
        fail(403, 'Chỉ người giao việc hoặc người quản lý được đổi người giao', 'FORBIDDEN');
      Object.assign(data, await W.registerFields(tx, body, { user: req.user, rights, project }));
      // Đánh giá của người giao: chỉ người giao việc hoặc người quản lý dự án.
      if (body.review !== undefined) {
        if (!(rights.canManage || item.assignedById === req.user.id)) fail(403, 'Chỉ người giao việc hoặc người quản lý dự án được đánh giá', 'FORBIDDEN');
        data.review = String(body.review ?? '').trim().slice(0, 2000); data.reviewedById = req.user.id; data.reviewedAt = new Date();
      }
      // Ngày hoàn thành thực tế: người quản lý chỉnh được (vd. nhập bù); chỉ áp cho việc đã hoàn thành.
      if (body.completedAt !== undefined) {
        if (!rights.canManage) fail(403, 'Chỉ người quản lý dự án được sửa ngày hoàn thành thực tế', 'FORBIDDEN');
        if (item.state.category !== 'COMPLETED') fail(409, 'Việc chưa hoàn thành', 'NOT_COMPLETED');
        data.completedAt = optionalDate(body.completedAt, 'Ngày hoàn thành') || item.completedAt;
      }
      for (const key of Object.keys(data)) if (String(item[key] ?? '') !== String(data[key] ?? '')) changed[key] = key === 'descriptionHtml' || key === 'descriptionText' ? true : data[key];
      let moved = null;
      // Kepper (MTL): cập nhật % tự chuyển cột — > 0% từ "Chưa bắt đầu" sang "Đang thực hiện"; 100% (không cần duyệt) sang "Hoàn thành".
      if (project.kind === 'MTL' && data.progress !== undefined && body.stateId === undefined) {
        const cat = item.state.category;
        const want = data.progress >= 100 ? 'COMPLETED' : data.progress > 0 && ['BACKLOG', 'UNSTARTED'].includes(cat) ? 'STARTED' : null;
        if (want && want !== cat) {
          const target = await tx.workflowState.findFirst({ where: { projectId: project.id, category: want }, orderBy: { position: 'asc' } });
          if (target) {
            const steps = await approval.stepsForItem(tx, project, item);
            if (!(want === 'COMPLETED' && steps.length)) body.stateId = target.id;
          }
        }
      }
      if (body.stateId !== undefined && Number(body.stateId) !== item.stateId) {
        const toState = await tx.workflowState.findFirst({ where: { id: intParam(body.stateId, 'Trạng thái'), projectId: project.id } });
        if (!toState) fail(422, 'Trạng thái không hợp lệ', 'INVALID_STATE');
        const t = await W.transition(tx, { project, rights, item, toState, overrideWip: body.overrideWip });
        Object.assign(data, t.data, { position: await W.endPosition(tx, toState.id) });
        moved = { ...t, toState };
      }
      const assigneeIds = W.idList(body.assigneeIds, 'Người nhận');
      // Việc giao về phòng: chỉ lãnh đạo phòng chủ trì (hoặc uỷ quyền), người giao, người quản lý được phân công.
      if ((assigneeIds || body.supporterIds !== undefined) && item.dispatchStatus) {
        const leaders = await approval.deptLeaderIds(tx, item.leadDepartmentId);
        if (!(rights.canManage || item.assignedById === req.user.id || leaders.includes(req.user.id))) fail(403, 'Chỉ lãnh đạo phòng chủ trì hoặc người giao được phân công việc này', 'FORBIDDEN');
        if (assigneeIds?.length && item.dispatchStatus === 'PENDING') Object.assign(data, { dispatchStatus: 'ACCEPTED', acceptedAt: new Date(), acceptedById: req.user.id });
      }
      let added = [];
      if (assigneeIds) {
        await W.activeUsers(tx, assigneeIds);
        const before = item.assignees.map(a => a.userId);
        added = assigneeIds.filter(x => !before.includes(x));
        if (added.length || before.some(x => !assigneeIds.includes(x))) {
          await tx.workItemAssignee.deleteMany({ where: { workItemId: id } });
          if (assigneeIds.length) await tx.workItemAssignee.createMany({ data: assigneeIds.map(userId => ({ workItemId: id, userId })) });
          await activity(tx, id, req.user.id, 'ASSIGNEES', { from: before, to: assigneeIds });
        }
      }
      const supporterIds = W.idList(body.supporterIds, 'Người phối hợp');
      if (supporterIds) {
        await W.activeUsers(tx, supporterIds);
        const before = (await tx.workItemSupporter.findMany({ where: { workItemId: id } })).map(s => s.userId);
        const addedS = supporterIds.filter(x => !before.includes(x));
        await tx.workItemSupporter.deleteMany({ where: { workItemId: id } });
        if (supporterIds.length) await tx.workItemSupporter.createMany({ data: supporterIds.map(userId => ({ workItemId: id, userId })) });
        if (addedS.length || before.some(x => !supporterIds.includes(x))) await activity(tx, id, req.user.id, 'SUPPORTERS', { from: before, to: supporterIds });
        if (addedS.length) await notify(tx, addedS, { type: 'SUPPORTING', title: `Bạn được giao phối hợp ${project.key}-${item.number}`, body: item.title, link: W.link(project, item) }, req.user.id);
      }
      const labelIds = await W.labelsOf(tx, project.id, W.idList(body.labelIds, 'Nhãn'));
      if (labelIds) {
        await tx.workItemLabel.deleteMany({ where: { workItemId: id } });
        if (labelIds.length) await tx.workItemLabel.createMany({ data: labelIds.map(labelId => ({ workItemId: id, labelId })) });
        changed.labels = labelIds;
      }
      const updated = await tx.workItem.update({ where: { id }, data });
      if (Object.keys(changed).length) await activity(tx, id, req.user.id, 'UPDATED', changed);
      if (moved) await W.afterTransition(tx, { user: req.user, project, item: updated, fromState: item.state, toState: moved.toState, steps: moved.steps });
      if (added.length) await notify(tx, added, { type: 'ASSIGNED', title: `Bạn được giao ${project.key}-${item.number}`, body: updated.title, link: W.link(project, item) }, req.user.id);
      await audit(req, 'UPDATE', 'WorkItem', id, null, { ...changed, ...(moved ? { stateId: moved.toState.id } : {}), ...(assigneeIds ? { assigneeIds } : {}) }, tx);
      return updated;
    });
    bus.item(project.id, id, req.user.id);
    const row = await prisma.workItem.findUnique({ where: { id: result.id }, include: BOARD_INCLUDE });
    res.json(boardItem(project, row));
  });

  // Kéo-thả trên Board: chuyển cột và/hoặc đổi thứ tự. afterId = thẻ nằm ngay trên, beforeId = thẻ nằm ngay dưới.
  app.post('/api/items/:id/move', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project, rights } = await loadItem(prisma, req.user, id, 'edit');
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'project:' + project.id}))`;
      const item = await tx.workItem.findUnique({ where: { id }, include: { state: true } });
      if (item.archivedAt) fail(409, 'Việc đã được lưu trữ', 'ARCHIVED');
      const toState = await tx.workflowState.findFirst({ where: { id: intParam(req.body.stateId, 'Trạng thái'), projectId: project.id } });
      if (!toState) fail(422, 'Trạng thái không hợp lệ', 'INVALID_STATE');
      if (toState.id !== item.stateId) assertDispatchChange(await dispatchRole(tx, req.user, rights, project, { ...item, assignees: await tx.workItemAssignee.findMany({ where: { workItemId: id } }) }), { toState });
      const t = await W.transition(tx, { project, rights, item, toState, overrideWip: req.body.overrideWip });
      const position = await W.positionBetween(tx, toState.id, optionalInt(req.body.afterId, 'Thẻ phía trên'), optionalInt(req.body.beforeId, 'Thẻ phía dưới'));
      const updated = await tx.workItem.update({ where: { id }, data: { ...t.data, position } });
      await W.afterTransition(tx, { user: req.user, project, item: updated, fromState: item.state, toState, steps: t.steps });
      if (item.stateId !== toState.id) await audit(req, 'MOVE', 'WorkItem', id, { stateId: item.stateId }, { stateId: toState.id }, tx);
    });
    bus.item(project.id, id, req.user.id);
    const row = await prisma.workItem.findUnique({ where: { id }, include: BOARD_INCLUDE });
    res.json(boardItem(project, row));
  });

  // ---------- Checklist ----------
  app.post('/api/items/:id/checklist', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project } = await loadItem(prisma, req.user, id, 'edit');
    const count = await prisma.checklistItem.count({ where: { workItemId: id } });
    if (count >= 100) fail(422, 'Tối đa 100 mục checklist');
    const row = await prisma.checklistItem.create({ data: { workItemId: id, title: text(req.body.title, 'Nội dung', { required: true, max: 300 }), position: count } });
    await activity(prisma, id, req.user.id, 'CHECKLIST_ADDED', { title: row.title });
    bus.item(project.id, id, req.user.id);
    res.status(201).json(row);
  });
  app.patch('/api/checklist/:id', auth, async (req, res) => {
    const row = await prisma.checklistItem.findUnique({ where: { id: intParam(req.params.id) } });
    if (!row) fail(404, 'Không tìm thấy mục checklist', 'NOT_FOUND');
    const { project } = await loadItem(prisma, req.user, row.workItemId, 'edit');
    const data = {};
    if (req.body.title !== undefined) data.title = text(req.body.title, 'Nội dung', { required: true, max: 300 });
    if (req.body.done !== undefined) data.done = !!req.body.done;
    const updated = await prisma.checklistItem.update({ where: { id: row.id }, data });
    if (data.done !== undefined && data.done !== row.done) await activity(prisma, row.workItemId, req.user.id, data.done ? 'CHECKLIST_DONE' : 'CHECKLIST_UNDONE', { title: row.title });
    bus.item(project.id, row.workItemId, req.user.id);
    res.json(updated);
  });
  app.delete('/api/checklist/:id', auth, async (req, res) => {
    const row = await prisma.checklistItem.findUnique({ where: { id: intParam(req.params.id) } });
    if (!row) fail(404, 'Không tìm thấy mục checklist', 'NOT_FOUND');
    const { project } = await loadItem(prisma, req.user, row.workItemId, 'edit');
    await prisma.checklistItem.delete({ where: { id: row.id } });
    bus.item(project.id, row.workItemId, req.user.id);
    res.json({ ok: true });
  });

  // ---------- Bình luận (@mention) ----------
  app.post('/api/items/:id/comments', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project } = await loadItem(prisma, req.user, id, 'edit');
    const bodyHtml = sanitizeHtml(req.body.bodyHtml ?? String(req.body.body || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>'));
    const bodyText = htmlToText(bodyHtml);
    if (!bodyText) fail(422, 'Bình luận trống', 'REQUIRED');
    const item = await prisma.workItem.findUnique({ where: { id }, include: { assignees: true } });
    const comment = await prisma.$transaction(async tx => {
      const row = await tx.comment.create({ data: { workItemId: id, authorId: req.user.id, bodyHtml, bodyText } });
      await activity(tx, id, req.user.id, 'COMMENT', { commentId: row.id });
      const names = mentions(bodyText);
      const mentioned = names.length ? await tx.user.findMany({ where: { username: { in: names }, isActive: true }, include: { permissions: true, memberships: { where: { projectId: project.id } } } }) : [];
      const access = project.visibility === 'ASSIGNED' ? await tx.workItem.findUnique({ where: { id }, select: ITEM_ACCESS_SELECT }) : null;
      const parentAccess = access?.parentId ? await tx.workItem.findUnique({ where: { id: access.parentId }, select: ITEM_ACCESS_SELECT }) : null;
      const allowed = mentioned.filter(u => projectRights(u, project, u.memberships[0]).canView && (!access || canSeeItem(u, project, u.memberships[0], access, parentAccess))).map(u => u.id);
      const code = `${project.key}-${item.number}`;
      await notify(tx, allowed, { type: 'MENTION', title: `${req.user.fullName} nhắc bạn trong ${code}`, body: bodyText.slice(0, 200), link: W.link(project, item) }, req.user.id);
      await notify(tx, [item.reporterId, ...item.assignees.map(a => a.userId)].filter(x => !allowed.includes(x)), { type: 'COMMENT', title: `Bình luận mới ở ${code}`, body: bodyText.slice(0, 200), link: W.link(project, item) }, req.user.id);
      return row;
    });
    bus.item(project.id, id, req.user.id);
    res.status(201).json({ ...comment, authorName: req.user.fullName });
  });
};
