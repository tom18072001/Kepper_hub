// Công việc: danh sách theo dự án (Board/List/Calendar/Timeline), tạo, sửa, kéo-thả, bình luận.
// Quyền trên từng việc: services/task-access.js (một nguồn duy nhất, bảng quyền tối thiểu theo vai 20/11/2026).
const { fail, intParam, optionalInt, optionalDate, text, oneOf } = require('../lib/http');
const { sanitizeHtml, htmlToText, mentions } = require('../lib/rich-text');
const { isItAdmin, rolesWith } = require('../lib/permissions');
const TA = require('../services/task-access');
const MTL = require('../services/mtl');
const { loadProject, projectRights, itemVisibleWhere, canSeeItem, isRegisterWriter, ITEM_ACCESS_SELECT } = require('../services/access');
const { activity, notify } = require('../services/events');
const approval = require('../services/approval');
const bus = require('../services/bus');
const W = require('../services/workitems');
const tree = require('../services/tree');
const rules = require('../services/task-rules');
const storage = require('../lib/storage');
const { describe: describeRule } = require('../services/recurring');
const { stageOf } = require('../services/stage');

// Kepper (MTL) — luật dữ liệu riêng (một nguồn %, bước tổng chỉ người quản lý dự án tạo): services/mtl-guard.js.
const { mtlGuard, mtlCreateGuard } = require('../services/mtl-guard');
const sameIds = (a, b) => { const x = [...new Set(a.map(Number))].sort(), y = [...new Set(b.map(Number))].sort(); return x.length === y.length && x.every((v, i) => v === y[i]); };
const dayOf = v => (v == null || v === '' ? null : new Date(v).getTime());
const DATE_KEYS = new Set(['dueDate', 'startDate', 'assignedAt', 'forecastEnd', 'internalDueDate', 'completedAt']);
const fieldChanged = (body, item, k) => body[k] !== undefined && (DATE_KEYS.has(k) ? dayOf(body[k]) !== (item[k] ? item[k].getTime() : null) : String(body[k] ?? '') !== String(item[k] ?? ''));

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

// Thẻ của người chỉ xem tóm tắt (thành viên dự án không liên quan): tên, người chủ trì, hạn, trạng thái, % — bỏ mô tả, văn bản,
// đánh giá, số bình luận / tệp.
function summaryCard(card) {
  const { excerpt, basisDocs, rating, ratedById, ratedAt, review, reviewedById, reviewedAt, resultNote, outputs, deliverable, note, returnNote, counts, ...rest } = card;
  return { ...rest, excerpt: '', basisDocs: [], counts: { children: counts.children, childrenDone: counts.childrenDone, childrenTotal: counts.childrenTotal, comments: 0, attachments: 0 } };
}
// Người dùng chọn người chủ trì / phối hợp: lãnh đạo bộ phận chủ trì chỉ chọn người trong phòng mình (bước chưa có người).
async function assertOwnDeptPeople(tx, caps, leadDeptId, ids) {
  if (caps.assign) return;
  if (!caps.assignOwnDept || leadDeptId == null) TA.assertCap(caps, 'assign');
  const n = ids.length ? await tx.user.count({ where: { id: { in: ids }, departmentId: leadDeptId, isActive: true } }) : 0;
  if (n !== ids.length) fail(403, TA.MESSAGES.assignOwnDept, 'FORBIDDEN');
}

// Phòng chủ trì của cây việc (của chính việc, nếu trống thì của tổ tiên gần nhất).
async function leadDeptOf(tx, item) {
  if (item.leadDepartmentId != null || !item.parentId) return item.leadDepartmentId ?? null;
  return tree.effectiveDept(item, await tree.ancestors(tx, item.parentId, { leadDepartmentId: true }));
}

const ITEMS_LIMIT = 5000;

module.exports = function mountItems(app, { prisma, auth, audit }) {
  app.get('/api/projects/:id/items', auth, async (req, res) => {
    const { project, rights, member } = await loadProject(prisma, req.user, intParam(req.params.id));
    const where = { projectId: project.id, ...itemFilters(req.query), AND: [itemVisibleWhere(req.user)] };
    const rows = await prisma.workItem.findMany({ where, include: { ...BOARD_INCLUDE, state: { select: { category: true } } }, orderBy: [{ position: 'asc' }, { id: 'asc' }], take: ITEMS_LIMIT });
    // Bị cắt: báo tổng số để giao diện nhắc dùng bộ lọc (không âm thầm bỏ việc).
    if (rows.length === ITEMS_LIMIT) res.setHeader('X-Total-Count', String(await prisma.workItem.count({ where })));
    const steps = await approval.stepsOf(prisma, project.id);
    const org = await TA.orgContext(prisma);
    // `my`: quyền của người xem trên từng thẻ — xem đầy đủ / tóm tắt, đổi trạng thái (kéo thẻ trên Bảng theo cùng luật với máy chủ).
    res.json(rows.map(r => {
      const my = TA.listCaps(req.user, org, { project, rights, member }, r);
      const { state, ...rest } = r;
      const card = { ...boardItem(project, rest), stage: stageOf({ ...r, pendingApproval: r.approvals[0] }, steps), my };
      return my.view === 'FULL' ? card : summaryCard(card);
    }));
  });

  // Phạm vi tạo việc của người xem (giao diện ẩn nút "Tạo việc" / giới hạn ô "Việc cha" TRƯỚC khi điền form — cùng luật với POST bên dưới):
  //   root: được tạo việc gốc; parents: null = việc cha nào cũng được (máy chủ vẫn kiểm từng lần), hoặc danh sách id việc được thêm việc nhánh.
  // Việc nhánh: người chủ trì, người giao, Ban Giám đốc của việc cha (services/task-access.js).
  // Việc gốc: dự án MTL — người quản lý dự án; sổ của đơn vị — Ban Giám đốc / người quản lý / thành viên sổ; dự án thường — thành viên.
  app.get('/api/projects/:id/create-scope', auth, async (req, res) => {
    const { project, rights, member } = await loadProject(prisma, req.user, intParam(req.params.id));
    if (!rights.canEdit) return res.json({ root: false, parents: [] });
    const root = project.kind === 'MTL' ? rights.canManage && !isItAdmin(req.user)
      : project.visibility === 'ASSIGNED' ? rights.canManage || isRegisterWriter(member) : true;
    const org = await TA.orgContext(prisma);
    if (org.topIds.includes(req.user.id)) return res.json({ root, parents: null }); // TGĐ: Ban Giám đốc của mọi việc
    const rows = await prisma.workItem.findMany({ where: { projectId: project.id, archivedAt: null, state: { category: { notIn: ['COMPLETED', 'CANCELLED'] } }, AND: [itemVisibleWhere(req.user)] },
      select: TA.TASK_SELECT });
    const parents = rows.filter(r => TA.taskCapabilities(req.user, TA.taskOf(r), TA.itemContext(org, { project, rights, member, item: TA.taskOf(r) })).children).map(r => r.id);
    res.json({ root, parents, ...(root ? {} : { reason: project.kind === 'MTL' ? 'MTL_CHILD_ONLY' : 'REGISTER_CHILD_ONLY' }) });
  });

  app.post('/api/projects/:id/items', auth, async (req, res) => {
    const { project, rights, member } = await loadProject(prisma, req.user, intParam(req.params.id), 'edit');
    const parentId = optionalInt(req.body?.parentId, 'Việc cha');
    let body = { ...(req.body || {}) }, planParent = true;
    if (parentId) {
      // Việc nhánh: người chủ trì (chia việc của mình — khi đó là người giao của việc nhánh), người giao, Ban Giám đốc của việc cha.
      const parent = await TA.loadTask(prisma, req.user, parentId, { need: 'children' });
      if (parent.project.id !== project.id) fail(422, 'Việc cha không thuộc dự án');
      planParent = parent.caps.plan;
      if (!planParent) { delete body.assignedById; delete body.leadDepartmentId; delete body.supportDepartmentIds; }
    } else if (project.visibility === 'ASSIGNED' && !rights.canManage && !isRegisterWriter(member)) {
      // Sổ giao việc của đơn vị: việc gốc do Ban Giám đốc / người quản lý sổ / thành viên sổ giao.
      fail(403, 'Chỉ Ban Giám đốc / người quản lý sổ được giao việc mới — bạn có thể thêm việc nhánh trong việc mình chủ trì', 'FORBIDDEN');
    }
    const created = await prisma.$transaction(async tx => {
      const input = await mtlCreateGuard(tx, req.user, project, rights, body, { planParent });
      const item = await W.createWorkItem(tx, { project, user: req.user, rights, input });
      await audit(req, 'CREATE', 'WorkItem', item.id, null, { code: `${project.key}-${item.number}`, title: item.title }, tx);
      return item;
    });
    bus.item(project.id, created.id, req.user.id);
    const row = await prisma.workItem.findUnique({ where: { id: created.id }, include: BOARD_INCLUDE });
    res.status(201).json(boardItem(project, row));
  });

  // Tóm tắt, chỉ đọc (thành viên dự án không liên quan): tên, người chủ trì, hạn, trạng thái, % — không tài liệu, báo cáo, đánh giá, bình luận.
  async function taskSummary(project, id, caps) {
    const row = await prisma.workItem.findUnique({ where: { id }, include: { state: { select: { id: true, name: true, category: true } },
      assignees: { include: { user: { select: { id: true, fullName: true, username: true } } } } } });
    let pct = row.progress;
    if (project.kind === 'MTL') {
      const descIds = await tree.descendantIds(prisma, [id], { archivedAt: null });
      const desc = descIds.length ? await prisma.workItem.findMany({ where: { id: { in: descIds } }, select: { id: true, parentId: true, progress: true, weight: true, state: { select: { category: true } } } }) : [];
      pct = MTL.rollup([{ ...row, parentId: null }, ...desc]).get(id) ?? row.progress;
    }
    return { id: row.id, number: row.number, code: `${project.key}-${row.number}`, title: row.title, summary: true, projectId: project.id,
      project: { id: project.id, key: project.key, name: project.name }, stateId: row.stateId, state: row.state, dueDate: row.dueDate,
      progress: Math.round(pct || 0), assignees: row.assignees.map(a => a.user), archivedAt: row.archivedAt,
      rights: { canView: true, canEdit: false, canManage: false, canDelete: false }, capabilities: caps };
  }

  app.get('/api/items/:id', auth, async (req, res) => {
    const itemId = intParam(req.params.id);
    const { project, rights, member, caps } = await TA.loadTask(prisma, req.user, itemId);
    if (caps.view !== 'FULL') return res.json(await taskSummary(project, itemId, caps));
    const item = await prisma.workItem.findUnique({ where: { id: itemId }, include: {
      ...BOARD_INCLUDE, state: true,
      progressReports: { orderBy: { id: 'desc' }, take: 100 }, extensions: { orderBy: { id: 'desc' } }, documents: { orderBy: { id: 'asc' } }, parent: { select: { id: true, number: true, title: true } }, cycle: true,
      children: { where: { archivedAt: null }, select: { id: true, number: true, title: true, dueDate: true, baselineStart: true, baselineEnd: true, weight: true, startedAt: true, internalDueDate: true, progress: true, completedAt: true, returnedAt: true, dispatchStatus: true,
        state: { select: { name: true, category: true } }, assignees: { select: { user: { select: { id: true, fullName: true } } } }, approvals: { where: { status: 'PENDING' }, select: { currentLevel: true, withAssigner: true, withBoard: true } },
        children: { where: { archivedAt: null }, select: { state: { select: { category: true } } } } }, orderBy: { id: 'asc' } },
      plan: { select: { id: true, name: true, year: true } },
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
    // Chuỗi duyệt: cấp 1 = người giao (bắt buộc chấm mức hoàn thành), sau đó các cấp dự án. Phiếu cũ giữ chuỗi cũ.
    const steps = pending ? await approval.chainFor(prisma, project, pending) : rules.chainOf(allSteps.slice(0, effective.levels), true, { board: rules.isBoardItem(item) });
    const currentStep = pending ? rules.stepAt(steps, pending.currentLevel) : null;
    const canApprove = pending ? await approval.canAct(prisma, req.user, project, pending, item) : false;
    const lastLevel = pending ? pending.currentLevel === pending.totalLevels : false;
    const roles = new Set(caps.roles);
    const isAssigner = roles.has('A'), isAssignee = roles.has('L'), isSupporter = roles.has('S');
    // Lãnh đạo bộ phận chủ trì (trưởng / phó hoặc người được uỷ quyền): tiếp nhận bước giao cho bộ phận, trả lời / trình kiến nghị.
    const isLeadLeader = caps.leadLeader;
    // Đánh giá = mức chấm + nhận xét lúc duyệt (cấp người giao). Ô "Đánh giá của người giao" cũ chỉ còn hiện đọc.
    const graded = item.rating ? item.approvals.flatMap(r => r.actions).filter(a => a.decision === 'APPROVE' && a.rating).sort((a, b) => b.id - a.id)[0] : null;
    const approverNames = Object.fromEntries((await prisma.user.findMany({ where: { isActive: true, isRootAdmin: false, role: { in: rolesWith('work.approve', 'OPERATE') } }, select: { id: true, fullName: true } })).map(u => [u.id, u.fullName]));
    const depts = Object.fromEntries((await prisma.department.findMany({ where: { id: { in: [item.leadDepartmentId, ...item.supportDepartments.map(d => d.departmentId)].filter(Boolean) } }, select: { id: true, name: true } })).map(d => [d.id, d.name]));
    // Đường dẫn cha (việc con nhiều cấp): [gốc, …, cha]. Sổ giao việc của đơn vị: việc tổ tiên người dùng không thấy thì ẩn tiêu đề.
    const chain = item.parentId ? await tree.ancestors(prisma, item.parentId, { ...ITEM_ACCESS_SELECT, number: true, title: true }) : [];
    const ancestors = chain.map((a, i) => ({ id: a.id, number: a.number,
      title: project.visibility !== 'ASSIGNED' || canSeeItem(req.user, project, member, a, chain.slice(i + 1)) ? a.title : null })).reverse();
    if (item.parent) item.parent = ancestors.at(-1) ?? item.parent;
    // Tiến độ thực tế theo cả cây con cháu (không chỉ con trực tiếp).
    const descIds = await tree.descendantIds(prisma, [item.id], { archivedAt: null });
    const desc = descIds.length ? await prisma.workItem.findMany({ where: { id: { in: descIds } }, select: { id: true, parentId: true, progress: true, weight: true, state: { select: { category: true } } } }) : [];
    const rolled = MTL.rollup([{ ...item, parentId: null }, ...desc]);
    const kidCount = new Map();
    for (const d of desc) kidCount.set(d.parentId, (kidCount.get(d.parentId) || 0) + 1);
    const base = boardItem(project, { ...item, approvals: pending ? [pending] : [], extensions: item.extensions.filter(x => x.status === 'PENDING') });
    res.json({
      ...base, descriptionHtml: item.descriptionHtml, state: item.state, parent: item.parent, children: item.children, cycle: item.cycle,
      intake: item.intakeRequest ? { id: item.intakeRequest.id, requesterName: names[item.intakeRequest.requesterId], createdAt: item.intakeRequest.createdAt } : null,
      project: { id: project.id, key: project.key, name: project.name }, rights, capabilities: caps,
      reporterName: names[item.reporterId] || null, assignedByName: names[item.assignedById] || null, reviewedByName: names[item.reviewedById] || null, plan: item.plan,
      assessment: item.rating ? { rating: item.rating, label: approval.RATINGS[item.rating] || item.rating, by: names[item.ratedById] || null, at: item.ratedAt, comment: graded?.comment || null } : null,
      legacyReview: item.review ? { text: item.review, by: names[item.reviewedById] || null, at: item.reviewedAt } : null,
      comments: item.comments.map(c => ({ ...c, authorName: names[c.authorId] })),
      attachments: item.attachments.map(a => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, createdAt: a.createdAt, uploadedById: a.uploadedById, uploadedByName: names[a.uploadedById], ...storage.locationOf(a.objectKey) })),
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
      lastLevel, ratingRequired: rules.isGradeStep(currentStep), ratings: approval.RATINGS, childProgress: rules.childProgress(item.children),
      // Cờ cũ của giao diện điều hành — suy ra từ `capabilities` (một nguồn quyền).
      can: {
        accept: item.dispatchStatus === 'PENDING' && (caps.assign || caps.assignOwnDept) && !item.archivedAt,
        reassign: item.dispatchStatus === 'ACCEPTED' && caps.assign,
        decideExtension: caps.decideExtension, answer: caps.answer, isLeadLeader, isAssigner,
        // Kiến nghị: lãnh đạo bộ phận (không phải người giao / BGĐ) trình lên BGĐ; người giao / BGĐ trả lời cả kiến nghị phòng đã trình.
        bgd: isAssigner || roles.has('B'), forward: caps.forward,
        // Người thực hiện = người chủ trì (báo cáo tiến độ, nộp sản phẩm, xin gia hạn). Người phối hợp gửi tài liệu, bình luận.
        work: caps.progress || (isAssignee && caps.submit), support: isSupporter, supportLead: caps.supportStaff,
        progress: caps.progress, assigner: caps.assigner,
        myRole: isAssignee ? 'LEAD' : isSupporter ? 'SUPPORT' : isAssigner ? 'ASSIGNER' : roles.has('B') ? 'BOARD' : isLeadLeader || roles.has('D') ? 'LEADER' : roles.has('O') ? 'OWNER' : null,
      },
      stage: stageOf({ ...item, pendingApproval: pending }, allSteps),
      // Kepper: tình trạng so với kế hoạch gốc (hạng mục có con: % thực tế = bình quân gia quyền của con).
      mtl: project.kind === 'MTL' ? (() => {
        const act = rolled.get(item.id);
        const st = MTL.statusOf(item, act, new Date(), MTL.alertConfigOf(project));
        return { actual: act, planned: st.planned ?? MTL.plannedPct(item), status: st.code, statusLabel: MTL.STATUS[st.code], variance: st.variance ?? null, lateDays: st.lateDays ?? null, grace: !!st.grace };
      })() : null,
      submitRounds: item.approvals.length,
      children: item.children.map(({ children: grand, ...c }) => ({ ...c, assignees: c.assignees.map(a => a.user), stage: stageOf({ ...c, pendingApproval: c.approvals[0] }, allSteps), childProgress: rules.childProgress(grand),
        childCount: kidCount.get(c.id) || 0, actual: rolled.get(c.id) ?? c.progress })),
      ancestors, depth: chain.length, maxDepth: tree.MAX_DEPTH, descendantCount: descIds.length,
      // Người duyệt thực tế từng bước của RIÊNG việc này (việc giao về phòng: lãnh đạo phòng chủ trì, PGĐ phụ trách…).
      stepApprovers: await (async () => {
        const ctx = await approval.approvalContext(prisma);
        const who = pending ? approval.withDoers(item, pending.requestedById) : item;
        const ids = Object.fromEntries(steps.map(st => [st.level, approval.approverIdsSync(ctx, project, st, who)]));
        const extra = [...new Set(Object.values(ids).flat())].filter(id => !approverNames[id]);
        if (extra.length) for (const u of await prisma.user.findMany({ where: { id: { in: extra } }, select: { id: true, fullName: true } })) approverNames[u.id] = u.fullName;
        return Object.fromEntries(Object.entries(ids).map(([lv, list]) => [lv, list.map(id => approverNames[id]).filter(Boolean)]));
      })(),
    });
  });

  app.patch('/api/items/:id', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project, rights, caps } = await TA.loadTask(prisma, req.user, id);
    const body = { ...(req.body || {}) };
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'item:' + id}))`;
      const item = await tx.workItem.findUnique({ where: { id }, include: { state: true, assignees: true, labels: true } });
      if (item.archivedAt) fail(409, 'Việc đã được lưu trữ', 'ARCHIVED');
      // Quyền theo TỪNG TRƯỜNG thực sự đổi giá trị (services/task-access.js): kế hoạch A, B; tiến độ L; sản phẩm bên thực hiện L, S;
      // người chủ trì / phối hợp A, B (bước giao cho bộ phận chưa có người: lãnh đạo bộ phận chủ trì chọn người trong phòng mình).
      const changedIds = async (key, current) => (Array.isArray(body[key]) && !sameIds(body[key], await current()) ? body[key].map(Number) : null);
      const arrays = {
        assigneeIds: await changedIds('assigneeIds', async () => item.assignees.map(a => a.userId)),
        supporterIds: await changedIds('supporterIds', async () => (await tx.workItemSupporter.findMany({ where: { workItemId: id } })).map(x => x.userId)),
        labelIds: await changedIds('labelIds', async () => item.labels.map(l => l.labelId)),
        supportDepartmentIds: await changedIds('supportDepartmentIds', async () => (await tx.workItemDepartment.findMany({ where: { workItemId: id } })).map(d => d.departmentId)),
      };
      const NUMERIC = ['assignedById', 'parentId', 'leadDepartmentId', 'cycleId', 'approvalLevels', 'progress', 'estimate', 'weight', 'budget'];
      for (const key of Object.keys(body)) {
        const cap = TA.capForField(key);
        if (!cap) continue;
        const differs = key in arrays ? arrays[key] != null
          : NUMERIC.includes(key) ? (body[key] == null || body[key] === '') !== (item[key] == null) || Number(body[key] ?? 0) !== Number(item[key] ?? 0)
          : ['critical', 'milestone'].includes(key) ? !!body[key] !== !!item[key]
          : key === 'review' || fieldChanged(body, item, key);
        if (!differs) { delete body[key]; continue; }
        if (cap === 'assign') { await assertOwnDeptPeople(tx, caps, caps.assignOwnDept ? await leadDeptOf(tx, item) : null, arrays[key]); continue; }
        // Người chủ trì đổi hạn: hướng sang đề nghị gia hạn; đổi % việc giao về phòng: qua "Báo cáo tiến độ".
        if (key === 'dueDate' && !caps.plan && caps.extension) fail(403, 'Hạn do người giao đặt — hãy gửi đề nghị gia hạn', 'USE_EXTENSION');
        TA.assertCap(caps, cap);
        // Không ai tự nhận làm người giao của việc chưa có người giao.
        if (key === 'assignedById' && item.assignedById == null && Number(body.assignedById) === req.user.id) fail(403, TA.MESSAGES.selfAssigner, 'FORBIDDEN');
      }
      const toStateEarly = body.stateId !== undefined && Number(body.stateId) !== item.stateId ? await tx.workflowState.findFirst({ where: { id: intParam(body.stateId, 'Trạng thái'), projectId: project.id } }) : null;
      if (body.stateId !== undefined && Number(body.stateId) === item.stateId) delete body.stateId;
      if (toStateEarly) TA.assertMove(caps, item.state.category, toStateEarly.category);
      // Kepper (MTL): một nguồn % (việc cha tự tính từ việc con), không đóng tay việc cha còn việc con mở.
      const pctChanged = body.progress !== undefined && Number(body.progress) !== item.progress;
      await mtlGuard(tx, req.user, project, rights, id, { manualPct: pctChanged, toState: toStateEarly });
      const data = {}, changed = {};
      if (body.title !== undefined) data.title = text(body.title, 'Tiêu đề', { required: true, max: 300 });
      if (body.descriptionHtml !== undefined) { data.descriptionHtml = sanitizeHtml(body.descriptionHtml); data.descriptionText = htmlToText(data.descriptionHtml); }
      if (body.priority !== undefined) data.priority = oneOf(body.priority, PRIORITIES, 'Ưu tiên');
      if (body.dueDate !== undefined) {
        data.dueDate = optionalDate(body.dueDate, 'Hạn');
        const changedDue = (item.dueDate?.getTime() ?? null) !== (data.dueDate?.getTime() ?? null);
        // Người có thẩm quyền đổi hạn trực tiếp = lập lại kế hoạch → hạn gốc theo hạn mới; chỉ gia hạn theo đề nghị mới giữ hạn gốc.
        if (changedDue) data.originalDueDate = data.dueDate;
        // Hạ hạn chính thức xuống trước hạn nội bộ: kéo hạn nội bộ theo (không để hạn nộp phòng muộn hơn hạn của người giao).
        if (body.internalDueDate === undefined && item.internalDueDate && data.dueDate && item.internalDueDate > data.dueDate) data.internalDueDate = data.dueDate;
      }
      if (body.internalDueDate !== undefined) {
        data.internalDueDate = optionalDate(body.internalDueDate, 'Hạn nội bộ');
        const due = data.dueDate !== undefined ? data.dueDate : item.dueDate;
        if (data.internalDueDate && due && data.internalDueDate > due) fail(422, 'Hạn nội bộ không được muộn hơn hạn của người giao', 'INVALID_DUE');
      }
      // Việc điều hành (giao về phòng): mỗi lần người chủ trì cập nhật % thành một dòng báo cáo.
      if (body.progress !== undefined && item.dispatchStatus) {
        const p = Number(body.progress);
        if (Number.isFinite(p) && Math.round(p) !== item.progress) await tx.progressReport.create({ data: { workItemId: id, authorId: req.user.id, progress: Math.max(0, Math.min(100, Math.round(p))), content: `Cập nhật tiến độ ${Math.round(p)}%` } });
      }
      // Loại nhiệm vụ, đơn vị chủ trì: kế hoạch (người giao, Ban Giám đốc) — đã kiểm ở trên.
      if (body.taskType !== undefined || body.leadDepartmentId !== undefined) {
        if (body.taskType !== undefined) data.taskType = oneOf(body.taskType, W.TASK_TYPES, 'Loại nhiệm vụ') || item.taskType;
        if (body.leadDepartmentId !== undefined) {
          data.leadDepartmentId = await W.departmentIdOf(tx, body.leadDepartmentId, 'Đơn vị chủ trì');
          if (project.visibility !== 'ASSIGNED' && project.kind !== 'MTL' && data.leadDepartmentId != null && data.leadDepartmentId !== project.departmentId)
            fail(422, 'Giao về phòng khác chỉ dùng trong sổ giao việc của đơn vị', 'DISPATCH_NOT_ALLOWED');
          // Việc nhánh đi theo đơn vị chủ trì mới (quyền xem, cấp duyệt "Trưởng phòng").
          // Việc con cháu đang theo đơn vị cũ thì đi theo đơn vị mới (mọi cấp); việc đã giao riêng cho đơn vị khác giữ nguyên.
          if (data.leadDepartmentId !== item.leadDepartmentId) {
            for (let frontier = [id], seen = new Set([id]), d = 0; frontier.length && d < 50; d++) {
              const kids = (await tx.workItem.findMany({ where: { parentId: { in: frontier }, leadDepartmentId: item.leadDepartmentId }, select: { id: true } })).map(k => k.id).filter(k => !seen.has(k));
              kids.forEach(k => seen.add(k));
              if (kids.length) await tx.workItem.updateMany({ where: { id: { in: kids } }, data: { leadDepartmentId: data.leadDepartmentId } });
              frontier = kids;
            }
          }
          if (project.visibility === 'ASSIGNED' && data.leadDepartmentId !== item.leadDepartmentId && data.leadDepartmentId != null && !item.parentId) {
            Object.assign(data, { dispatchStatus: 'PENDING', dispatchedAt: new Date(), acceptedAt: null, acceptedById: null });
            await notify(tx, await approval.deptLeaderIds(tx, data.leadDepartmentId), { type: 'DISPATCH', title: `Phòng được giao chủ trì ${project.key}-${item.number} — cần tiếp nhận, phân công`, body: item.title, link: W.link(project, item) }, req.user.id);
          }
        }
      }
      // Nguồn giao việc quyết định loại nhiệm vụ (một trường trên giao diện): người được đổi loại nhiệm vụ đổi nguồn thì loại đi theo.
      if (body.source !== undefined && body.taskType === undefined) {
        const derived = W.taskTypeOfSource(body.source);
        if (derived && derived !== item.taskType) data.taskType = derived;
      }
      const supportDepartmentIds = await W.departmentIds(tx, body.supportDepartmentIds);
      if (supportDepartmentIds && project.visibility !== 'ASSIGNED' && project.kind !== 'MTL') fail(422, 'Đơn vị phối hợp chỉ dùng trong sổ giao việc của đơn vị', 'DISPATCH_NOT_ALLOWED');
      if (supportDepartmentIds) {
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
        data.approvalLevels = W.approvalLevelsInput(body.approvalLevels, { canManage: caps.approvalLevels });
        if (await tx.approvalRequest.count({ where: { workItemId: id, status: 'PENDING' } }))
          fail(409, 'Việc đang chờ duyệt — không đổi được mức duyệt cho tới khi duyệt xong hoặc rút lại', 'APPROVAL_PENDING');
      }
      if (body.parentId !== undefined) {
        data.parentId = optionalInt(body.parentId, 'Việc cha');
        if (data.parentId === id) fail(422, 'Việc cha không hợp lệ');
        if (data.parentId && !(await tx.workItem.findFirst({ where: { id: data.parentId, projectId: project.id, archivedAt: null } }))) fail(422, 'Việc cha không thuộc dự án');
        if (data.parentId && data.parentId !== item.parentId) await tree.assertCanNest(tx, data.parentId, id); // chặn vòng cha–con, trần cấp
      }
      Object.assign(data, await W.registerFields(tx, body, { user: req.user, rights, project }));
      // Ngày hoàn thành thực tế: người giao / Ban Giám đốc chỉnh được (vd. nhập bù); chỉ áp cho việc đã hoàn thành.
      if (body.completedAt !== undefined) {
        if (item.state.category !== 'COMPLETED') fail(409, 'Việc chưa hoàn thành', 'NOT_COMPLETED');
        data.completedAt = optionalDate(body.completedAt, 'Ngày hoàn thành') || item.completedAt;
      }
      // MTL: hạng mục chưa có kế hoạch gốc — lần đầu người có quyền lập kế hoạch đặt hạn thì lấy làm kế hoạch gốc.
      if (project.kind === 'MTL' && !item.baselineEnd && (data.dueDate !== undefined || data.startDate !== undefined)) {
        const b = MTL.initialBaseline(data.startDate !== undefined ? data.startDate : item.startDate, data.dueDate !== undefined ? data.dueDate : item.dueDate);
        if (b) Object.assign(data, b);
      }
      for (const key of Object.keys(data)) if (String(item[key] ?? '') !== String(data[key] ?? '')) changed[key] = key === 'descriptionHtml' || key === 'descriptionText' ? true : data[key];
      let moved = null;
      // Kepper (MTL): cập nhật % tự chuyển cột — > 0% từ "Chưa bắt đầu" sang "Đang thực hiện"; 100% → gửi người giao duyệt ("Chờ duyệt")
      // khi mọi việc con đã xong (còn con mở thì chỉ ghi %).
      if (project.kind === 'MTL' && data.progress !== undefined && body.stateId === undefined) {
        const cat = item.state.category;
        const want = data.progress >= 100 ? 'COMPLETED' : data.progress > 0 && ['BACKLOG', 'UNSTARTED'].includes(cat) ? 'STARTED' : null;
        if (want && want !== cat) {
          const target = await tx.workflowState.findFirst({ where: { projectId: project.id, category: want }, orderBy: { position: 'asc' } });
          if (target && (want !== 'COMPLETED' || await W.canAutoSubmit(tx, item))) body.stateId = target.id;
        }
      }
      if (body.stateId !== undefined && Number(body.stateId) !== item.stateId) {
        const toState = await tx.workflowState.findFirst({ where: { id: intParam(body.stateId, 'Trạng thái'), projectId: project.id } });
        if (!toState) fail(422, 'Trạng thái không hợp lệ', 'INVALID_STATE');
        const t = await W.transition(tx, { project, rights, item, toState, overrideWip: body.overrideWip });
        Object.assign(data, t.data, { position: await W.endPosition(tx, t.toState.id) });
        moved = t;
      }
      const assigneeIds = W.idList(body.assigneeIds, 'Người nhận');
      // Việc giao về phòng: phân công lần đầu = phòng đã tiếp nhận (quyền đã kiểm ở trên).
      if ((assigneeIds || body.supporterIds !== undefined) && item.dispatchStatus) {
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
      // Gắn việc chưa xong vào dưới một việc cha đang chờ duyệt / đã hoàn thành → mở lại việc cha.
      if (data.parentId && data.parentId !== item.parentId && !['COMPLETED', 'CANCELLED'].includes((moved?.toState || item.state).category))
        await W.reopenAncestors(tx, { user: req.user, parentId: data.parentId, reason: `Gắn việc con ${project.key}-${item.number}` });
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
    const { project, rights, caps } = await TA.loadTask(prisma, req.user, id);
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'project:' + project.id}))`;
      const item = await tx.workItem.findUnique({ where: { id }, include: { state: true } });
      if (item.archivedAt) fail(409, 'Việc đã được lưu trữ', 'ARCHIVED');
      const toState = await tx.workflowState.findFirst({ where: { id: intParam(req.body.stateId, 'Trạng thái'), projectId: project.id } });
      if (!toState) fail(422, 'Trạng thái không hợp lệ', 'INVALID_STATE');
      // Kéo thẻ trên Bảng: cùng luật đổi trạng thái với panel (người chủ trì: đang làm → gửi duyệt; người giao / BGĐ: mọi trạng thái).
      TA.assertMove(caps, item.state.category, toState.category);
      if (toState.id !== item.stateId) await mtlGuard(tx, req.user, project, rights, id, { toState });
      const t = await W.transition(tx, { project, rights, item, toState, overrideWip: req.body.overrideWip });
      // Kéo sang "Hoàn thành" khi chưa duyệt → vào cuối cột "Chờ duyệt".
      const position = t.redirected ? await W.endPosition(tx, t.toState.id) : await W.positionBetween(tx, toState.id, optionalInt(req.body.afterId, 'Thẻ phía trên'), optionalInt(req.body.beforeId, 'Thẻ phía dưới'));
      const updated = await tx.workItem.update({ where: { id }, data: { ...t.data, position } });
      await W.afterTransition(tx, { user: req.user, project, item: updated, fromState: item.state, toState: t.toState, steps: t.steps });
      if (item.stateId !== t.toState.id) await audit(req, 'MOVE', 'WorkItem', id, { stateId: item.stateId }, { stateId: t.toState.id }, tx);
    });
    bus.item(project.id, id, req.user.id);
    const row = await prisma.workItem.findUnique({ where: { id }, include: BOARD_INCLUDE });
    res.json(boardItem(project, row));
  });

  // ---------- Bình luận (@mention) ----------
  app.post('/api/items/:id/comments', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project } = await TA.loadTask(prisma, req.user, id, { need: 'comment' });
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
      const parentAccess = access?.parentId ? await tree.ancestors(tx, access.parentId, ITEM_ACCESS_SELECT) : null;
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
