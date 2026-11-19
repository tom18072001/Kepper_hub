// Duyệt nhiều cấp: mỗi dự án khai báo các bước (level 1..n). Khi việc vào cột thuộc nhóm REVIEW,
// hệ thống mở yêu cầu duyệt ở level 1; duyệt hết các level thì việc tự chuyển sang Hoàn thành;
// từ chối ở bất kỳ level nào thì việc quay lại trạng thái trước khi gửi duyệt.
const { permissionScope } = require('../lib/permissions');
const { fail } = require('../lib/http');
const { activity, notify, notifyRequesterIfDone } = require('./events');
const rules = require('./task-rules');

const APPROVER_TYPES = {
  PROJECT_LEAD: 'Trưởng dự án',
  DEPARTMENT_MANAGER: 'Trưởng phòng',
  DIRECTOR: 'Ban giám đốc',
  SUPERVISOR: 'Người giao / PGĐ phụ trách',
  USER: 'Người được chỉ định',
  ASSIGNER: 'Người giao việc',
};
const { RATINGS, ASSIGNER_STEP } = rules;
const assigneeIdsOf = item => (item?.assignees || []).map(a => a.userId ?? a.user?.id ?? a.id).filter(id => id != null);
// Người làm của một phiếu: người chủ trì; việc chưa giao ai thì người gửi duyệt được coi là người làm (không tự duyệt).
const withDoers = (item, requestedById) => (assigneeIdsOf(item).length || requestedById == null ? item : { ...item, assignees: [{ userId: requestedById }] });

// Người đang được uỷ quyền thay (trong thời hạn) cho các tài khoản `ids`.
async function withDelegates(client, ids, now = new Date()) {
  if (!ids.length) return ids;
  const rows = await client.delegation.findMany({ where: { fromUserId: { in: ids }, revokedAt: null, startsAt: { lte: now }, endsAt: { gte: now } }, select: { toUserId: true } });
  return [...new Set([...ids, ...rows.map(r => r.toUserId)])];
}
// Lãnh đạo phòng (trưởng / phó phòng, kể cả người được uỷ quyền) của một phòng ban.
async function deptLeaderIds(client, departmentId) {
  if (departmentId == null) return [];
  const users = await client.user.findMany({ where: { isActive: true, departmentId, permissions: { some: { permissionKey: 'work.approve' } } }, include: { permissions: true } });
  return withDelegates(client, users.filter(u => permissionScope(u, 'work.approve', 'OPERATE')).map(u => u.id));
}
// Ngữ cảnh duyệt nạp một lần (người có quyền duyệt, PGĐ phụ trách từng phòng, uỷ quyền đang hiệu lực, các bước duyệt):
// tính người duyệt cho nhiều phiếu trong bộ nhớ thay vì vài truy vấn cho mỗi phiếu (hàng chờ, số đếm huy hiệu).
async function approvalContext(client, projectIds = [], now = new Date()) {
  const [users, depts, delegations, steps, active] = await Promise.all([
    client.user.findMany({ where: { isActive: true, permissions: { some: { permissionKey: 'work.approve' } } }, include: { permissions: true } }),
    client.department.findMany({ select: { id: true, supervisorId: true } }),
    client.delegation.findMany({ where: { revokedAt: null, startsAt: { lte: now }, endsAt: { gte: now } }, select: { fromUserId: true, toUserId: true } }),
    projectIds.length ? client.approvalStep.findMany({ where: { projectId: { in: projectIds } }, orderBy: { level: 'asc' } }) : [],
    client.user.findMany({ where: { isActive: true, isRootAdmin: false, role: { not: 'admin' } }, select: { id: true, departmentId: true } }),
  ]);
  const scope = new Map(users.map(u => [u.id, permissionScope(u, 'work.approve', 'OPERATE')]));
  const steps_ = new Map(projectIds.map(id => [id, []]));
  for (const st of steps) steps_.get(st.projectId)?.push(st);
  return { users, scope, sys: new Set(users.filter(u => scope.get(u.id) === 'SYSTEM').map(u => u.id)), supervisor: new Map(depts.map(d => [d.id, d.supervisorId])), delegations, steps: steps_,
    active: new Map(active.map(u => [u.id, { departmentId: u.departmentId }])) };
}
const withDelegatesSync = (ctx, ids) => (ids.length ? [...new Set([...ids, ...ctx.delegations.filter(d => ids.includes(d.fromUserId)).map(d => d.toUserId)])] : ids);
// `item` (tuỳ chọn): việc giao về phòng thì cấp "Trưởng phòng" là lãnh đạo PHÒNG CHỦ TRÌ, không phải phòng sở hữu sổ;
// cấp "Người giao / PGĐ phụ trách" là người giao (nếu thuộc Ban Giám đốc) và PGĐ phụ trách phòng chủ trì.
// `delegates: false` → chỉ người duyệt "chính chủ" (để biết ai đang duyệt thay theo uỷ quyền).
// DIRECTOR ("Ban giám đốc"): PGĐ phụ trách phòng của việc (+ người giao nếu thuộc BGĐ); phòng chưa có PGĐ phụ trách thì bất kỳ ai trong BGĐ.
// ASSIGNER: người giao (việc tự giao / người giao đã nghỉ → lãnh đạo bộ phận…), không bao giờ là người chủ trì,
// kể cả qua uỷ quyền.
function assignerApproversSync(ctx, project, item) {
  return rules.assignerApprovers({ assignedById: item?.assignedById, reporterId: item?.reporterId, leadDepartmentId: item?.leadDepartmentId, assigneeIds: assigneeIdsOf(item) }, {
    active: ctx.active || new Map(), projectLeadId: project.leadId ?? null, projectDepartmentId: project.departmentId ?? null,
    leaders: dept => ctx.users.filter(u => Number(u.departmentId) === Number(dept) && ctx.scope.get(u.id)).map(u => u.id),
    supervisorOf: dept => ctx.supervisor.get(dept) ?? null, directors: [...ctx.sys],
  });
}
function approverIdsSync(ctx, project, step, item = null, { delegates = true } = {}) {
  if (!step) return [];
  let ids = [];
  if (step.approverType === 'ASSIGNER') {
    ids = assignerApproversSync(ctx, project, item).ids;
    if (!delegates) return ids;
    const mine = new Set(assigneeIdsOf(item));
    return withDelegatesSync(ctx, ids).filter(id => !mine.has(id));
  }
  if (step.approverType === 'PROJECT_LEAD') ids = project.leadId ? [project.leadId] : [];
  else if (step.approverType === 'USER') ids = step.approverUserId ? [step.approverUserId] : [];
  else if (step.approverType === 'DEPARTMENT_MANAGER') {
    const dept = item?.leadDepartmentId ?? project.departmentId;
    ids = ctx.users.filter(u => Number(u.departmentId) === Number(dept) && ctx.scope.get(u.id)).map(u => u.id);
  } else if (step.approverType === 'DIRECTOR') {
    const deptId = item?.leadDepartmentId ?? project.departmentId;
    const sup = deptId != null ? ctx.supervisor.get(deptId) : null;
    if (sup && ctx.sys.has(sup)) {
      ids = [sup];
      if (item?.assignedById && ctx.sys.has(item.assignedById) && !ids.includes(item.assignedById)) ids.push(item.assignedById);
    } else ids = [...ctx.sys];
  } else if (step.approverType === 'SUPERVISOR') {
    if (item?.assignedById && ctx.sys.has(item.assignedById)) ids.push(item.assignedById);
    const sup = item?.leadDepartmentId ? ctx.supervisor.get(item.leadDepartmentId) : null;
    if (sup && ctx.sys.has(sup) && !ids.includes(sup)) ids.push(sup);
    if (!ids.length) ids = [...ctx.sys];
  }
  return delegates ? withDelegatesSync(ctx, ids) : ids;
}
async function approverIds(client, project, step, item = null, opts = {}) {
  if (!step) return [];
  if (step.approverType === 'PROJECT_LEAD' || step.approverType === 'USER') {
    const ids = approverIdsSync({ users: [], scope: new Map(), sys: new Set(), supervisor: new Map(), delegations: [] }, project, step, item, { delegates: false });
    return opts.delegates === false ? ids : withDelegates(client, ids);
  }
  return approverIdsSync(await approvalContext(client), project, step, item, opts);
}
// Người duyệt đang hành động thay cho ai (uỷ quyền) — null nếu là người duyệt chính chủ.
function actingForSync(ctx, user, project, step, item) {
  const base = approverIdsSync(ctx, project, step, item, { delegates: false });
  if (base.includes(user.id)) return null;
  return ctx.delegations.find(d => d.toUserId === user.id && base.includes(d.fromUserId))?.fromUserId ?? null;
}
async function actingFor(client, user, project, step, item) {
  return actingForSync(await approvalContext(client), user, project, step, item);
}

async function stepsOf(client, projectId) {
  return client.approvalStep.findMany({ where: { projectId }, orderBy: { level: 'asc' } });
}
// Số cấp duyệt áp dụng cho một việc, theo thứ tự ưu tiên:
//   1. mức trưởng phòng chọn tay trên việc (MANUAL)
//   2. quy tắc tự động khớp nhãn/ưu tiên — nhiều quy tắc khớp thì lấy số cấp lớn nhất (RULE)
//   3. mức mặc định của dự án, không đặt = đủ các cấp (DEFAULT)
// `item` cần approvalLevels; priority/labelIds nếu thiếu sẽ đọc từ CSDL theo item.id.
async function levelsForItem(client, project, steps, item = {}) {
  const clamp = n => Math.max(0, Math.min(steps.length, Number(n)));
  if (item.approvalLevels != null) return { levels: clamp(item.approvalLevels), source: 'MANUAL' };
  // Sổ của đơn vị: việc nhánh là việc nội bộ của phòng — mặc định chỉ lãnh đạo phòng duyệt (các bước "Trưởng phòng" đầu tiên);
  // nhiệm vụ gốc mới trình Ban Giám đốc.
  if (project.visibility === 'ASSIGNED' && item.parentId) {
    let n = 0; while (n < steps.length && steps[n].approverType === 'DEPARTMENT_MANAGER') n++;
    if (n > 0) return { levels: n, source: 'CHILD' };
  }
  const rules = await client.approvalRule.findMany({ where: { projectId: project.id } });
  if (rules.length) {
    let { priority, labelIds } = item;
    if (item.id && (priority === undefined || labelIds === undefined)) {
      const row = await client.workItem.findUnique({ where: { id: item.id }, select: { priority: true, labels: { select: { labelId: true } } } });
      priority ??= row?.priority; labelIds ??= row?.labels.map(l => l.labelId) || [];
    }
    const hit = rules.filter(r => (r.labelId == null || (labelIds || []).includes(r.labelId)) && (r.priority == null || r.priority === (priority || 'NONE')));
    if (hit.length) { const best = hit.reduce((a, b) => (b.levels > a.levels ? b : a)); return { levels: clamp(best.levels), source: 'RULE', ruleId: best.id }; }
  }
  return { levels: clamp(project.defaultApprovalLevels ?? steps.length), source: 'DEFAULT' };
}
// Chuỗi duyệt khi gửi duyệt một việc: luôn có người giao ở cấp 1, sau đó các cấp dự án áp dụng cho việc.
async function stepsForItem(client, project, item) {
  const steps = await stepsOf(client, project.id);
  return rules.chainOf(steps.slice(0, (await levelsForItem(client, project, steps, item)).levels), true);
}
// Chuỗi duyệt của một phiếu đã mở (phiếu cũ không có cấp người giao).
async function chainFor(client, project, request) {
  return rules.chainOf(await stepsOf(client, project.id), !!request.withAssigner).filter(s => s.level <= request.totalLevels);
}
// n = số cấp dự án (không tính cấp người giao, luôn có).
function levelsLabel(n, total) {
  if (!total || n === 0) return 'Chỉ người giao duyệt';
  return n >= total ? `Người giao + đủ ${total} cấp` : `Người giao + ${n} cấp đầu`;
}

function itemLink(project, item) { return `#/projects/${project.id}?item=${item.id}`; }
function itemCode(project, item) { return `${project.key}-${item.number}`; }

// Gọi trong transaction khi việc vừa được chuyển vào cột REVIEW.
async function openRequest(tx, { project, item, fromStateId, actor }) {
  const steps = await stepsForItem(tx, project, item);
  const pending = await tx.approvalRequest.findFirst({ where: { workItemId: item.id, status: 'PENDING' } });
  if (pending) return pending;
  if (!item.assignees) item = { ...item, assignees: await tx.workItemAssignee.findMany({ where: { workItemId: item.id } }) };
  item = withDoers(item, actor.id);
  const request = await tx.approvalRequest.create({ data: {
    workItemId: item.id, totalLevels: steps.length, currentLevel: 1, fromStateId, requestedById: actor.id, withAssigner: true,
    actions: { create: { level: 0, actorId: actor.id, decision: 'SUBMIT' } },
  } });
  await tx.workItem.update({ where: { id: item.id }, data: { returnedAt: null, returnNote: null } });
  await activity(tx, item.id, actor.id, 'APPROVAL_SUBMITTED', { requestId: request.id, level: 1, step: steps[0].name });
  await notify(tx, await approverIds(tx, project, steps[0], item), {
    type: 'APPROVAL_REQUESTED', title: `Cần duyệt ${itemCode(project, item)} (${steps[0].name})`, body: item.title, link: itemLink(project, item),
  }, actor.id);
  return request;
}

async function cancelPending(tx, { item, actor, reason }) {
  const pending = await tx.approvalRequest.findFirst({ where: { workItemId: item.id, status: 'PENDING' } });
  if (!pending) return null;
  await tx.approvalRequest.update({ where: { id: pending.id }, data: { status: 'CANCELLED', closedAt: new Date(),
    actions: { create: { level: pending.currentLevel, actorId: actor.id, decision: 'CANCEL', comment: reason || null } } } });
  await activity(tx, item.id, actor.id, 'APPROVAL_CANCELLED', { requestId: pending.id });
  return pending;
}

async function hasApproval(tx, itemId) {
  const last = await tx.approvalRequest.findFirst({ where: { workItemId: itemId }, orderBy: { id: 'desc' } });
  return !!last && last.status === 'APPROVED';
}

// Người gửi duyệt không tự duyệt yêu cầu của chính mình (kể cả khi là trưởng phòng/trưởng dự án).
async function canAct(client, user, project, request, item = request.workItem) {
  item = withDoers(item, request.requestedById);
  const chain = await chainFor(client, project, request);
  const step = rules.stepAt(chain, request.currentLevel);
  if (assigneeIdsOf(item).includes(user.id)) return false;
  if (step?.approverType !== 'ASSIGNER' && request.requestedById === user.id) return false;
  // Một người không duyệt hai cấp của cùng một phiếu (vd. vừa duyệt cấp phòng, vừa được uỷ quyền cấp BGĐ).
  const actions = request.actions || await client.approvalAction.findMany({ where: { requestId: request.id }, select: { actorId: true, decision: true, level: true } });
  if (actions.some(a => a.actorId === user.id && a.decision === 'APPROVE' && a.level < request.currentLevel)) return false;
  return (await approverIds(client, project, step, item)).includes(user.id);
}

// Duyệt hoặc từ chối ở level hiện tại. Trả về yêu cầu sau khi cập nhật.
async function decide(prisma, user, requestId, decision, comment, { rating } = {}) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'approval:' + requestId}))`;
    const request = await tx.approvalRequest.findUnique({ where: { id: requestId }, include: { workItem: { include: { project: true, assignees: true } }, actions: true } });
    if (!request) fail(404, 'Không tìm thấy yêu cầu duyệt', 'NOT_FOUND');
    if (request.status !== 'PENDING') fail(409, 'Yêu cầu đã được xử lý', 'APPROVAL_CLOSED');
    const item = withDoers(request.workItem, request.requestedById), project = item.project;
    const steps = await chainFor(tx, project, request);
    const step = rules.stepAt(steps, request.currentLevel);
    rules.checkDecision({ step, decision, rating, comment, userId: user.id, assigneeIds: assigneeIdsOf(item), requestedById: request.requestedById });
    if (request.actions.some(a => a.actorId === user.id && a.decision === 'APPROVE' && a.level < request.currentLevel)) fail(403, 'Bạn đã duyệt ở bước trước của phiếu này — bước sau do người khác duyệt', 'DOUBLE_APPROVAL');
    if (!(await canAct(tx, user, project, request))) fail(403, step?.approverType === 'ASSIGNER' ? 'Chỉ người giao việc (hoặc người duyệt thay theo uỷ quyền) được duyệt và chấm mức hoàn thành' : 'Bạn không phải người duyệt ở bước này', 'NOT_APPROVER');
    const graded = decision === 'APPROVE' && step?.approverType === 'ASSIGNER';
    const watchers = [request.requestedById, item.reporterId, ...item.assignees.map(a => a.userId)];
    const onBehalfOfId = await actingFor(tx, user, project, step, item);
    const onBehalfOf = onBehalfOfId ? (await tx.user.findUnique({ where: { id: onBehalfOfId }, select: { fullName: true } }))?.fullName : null;
    await tx.approvalAction.create({ data: { requestId, level: request.currentLevel, actorId: user.id, decision, comment: comment || null, onBehalfOfId, rating: graded ? rating : null } });
    // Người giao chấm mức hoàn thành (kèm nhận xét) ngay ở cấp của mình — lưu ai, lúc nào, mức nào, nhận xét gì.
    if (graded) await tx.workItem.update({ where: { id: item.id }, data: { rating, ratedById: user.id, ratedAt: new Date(),
      review: comment ? comment.slice(0, 2000) : '', reviewedById: user.id, reviewedAt: new Date() } });
    // Thông báo "Cần duyệt" của bước này hết hiệu lực với mọi người (đã có người xử lý).
    await tx.notification.updateMany({ where: { type: 'APPROVAL_REQUESTED', link: itemLink(project, item), readAt: null }, data: { readAt: new Date() } });
    const label = `${itemCode(project, item)} · ${item.title.slice(0, 80)}`;

    if (decision === 'REJECT') {
      // Phiếu mới: trả lại luôn về "Đang làm". Phiếu cũ: về trạng thái trước khi gửi duyệt.
      const back = request.fromStateId && !request.withAssigner
        ? await tx.workflowState.findFirst({ where: { id: request.fromStateId, projectId: project.id } })
        : null;
      const target = back || await tx.workflowState.findFirst({ where: { projectId: project.id, category: 'STARTED' }, orderBy: { position: 'asc' } });
      await tx.workItem.update({ where: { id: item.id }, data: { stateId: target.id, completedAt: null, returnedAt: new Date(), returnNote: comment ? comment.slice(0, 2000) : null } });
      const updated = await tx.approvalRequest.update({ where: { id: requestId }, data: { status: 'REJECTED', closedAt: new Date() } });
      await activity(tx, item.id, user.id, 'APPROVAL_REJECTED', { requestId, level: request.currentLevel, step: step?.name, comment, toStateId: target.id, ...(onBehalfOf ? { onBehalfOf } : {}) });
      await notify(tx, watchers, { type: 'APPROVAL_REJECTED', title: `${label} bị trả lại ở bước ${step?.name || request.currentLevel}`, body: comment, link: itemLink(project, item) }, user.id);
      return updated;
    }

    // Người giao vừa duyệt mà cũng là người duyệt (chính chủ) của các cấp dự án kế tiếp (vd. người giao là trưởng phòng,
    // cấp 2 là "Trưởng phòng") → các cấp đó tự qua, ghi rõ trong lịch sử — tránh phiếu kẹt vì "một người không duyệt hai cấp".
    let nextLevel = request.currentLevel + 1;
    if (graded) while (nextLevel <= request.totalLevels) {
      const st = rules.stepAt(steps, nextLevel);
      if (!(await approverIds(tx, project, st, item, { delegates: false })).includes(user.id)) break;
      await tx.approvalAction.create({ data: { requestId, level: nextLevel, actorId: user.id, decision: 'APPROVE', comment: `Tự động qua: ${user.fullName || 'người giao'} đã duyệt ở cấp người giao` } });
      nextLevel++;
    }
    if (nextLevel <= request.totalLevels) {
      const next = steps.find(s => s.level === nextLevel);
      const updated = await tx.approvalRequest.update({ where: { id: requestId }, data: { currentLevel: nextLevel } });
      await activity(tx, item.id, user.id, 'APPROVAL_APPROVED', { requestId, level: request.currentLevel, step: step?.name, comment, next: next?.name, ...(onBehalfOf ? { onBehalfOf } : {}) });
      await notify(tx, (await approverIds(tx, project, next, item)).filter(id => !assigneeIdsOf(item).includes(id)), { type: 'APPROVAL_REQUESTED', title: `Cần duyệt ${label} (${next?.name})`, body: comment || item.title, link: itemLink(project, item) }, user.id);
      await notify(tx, watchers, { type: 'APPROVAL_PROGRESS', title: `${label}: đã qua bước "${step?.name}", chuyển "${next?.name}"`, body: comment || null, link: itemLink(project, item) }, user.id);
      return updated;
    }

    // Việc cha: mọi việc con phải đã được duyệt hoàn thành (con có thể bị mở lại trong lúc cha chờ duyệt).
    rules.assertChildrenDone(await tx.workItem.findMany({ where: { parentId: item.id, archivedAt: null }, select: { state: { select: { category: true } } } }), 'duyệt hoàn thành');
    const done = await tx.workflowState.findFirst({ where: { projectId: project.id, category: 'COMPLETED' }, orderBy: { position: 'asc' } });
    const position = await endPosition(tx, done.id);
    // Phiếu cũ: cấp cuối có thể xếp loại tuỳ chọn. Phiếu mới: mức đã chấm ở cấp người giao.
    const legacyGrade = !graded && rating && RATINGS[rating] ? { rating, ratedById: user.id, ratedAt: new Date(), ...(comment ? { review: comment.slice(0, 2000), reviewedById: user.id, reviewedAt: new Date() } : {}) } : {};
    // KPI "đúng hạn" tính theo ngày người chủ trì gửi duyệt (người duyệt chậm không làm người làm bị tính trễ).
    const completedAt = request.withAssigner ? request.createdAt : new Date();
    await tx.workItem.update({ where: { id: item.id }, data: { stateId: done.id, completedAt, position, progress: 100, returnedAt: null, returnNote: null, ...legacyGrade } });
    const finalRating = graded ? rating : legacyGrade.rating || (await tx.workItem.findUnique({ where: { id: item.id }, select: { rating: true } }))?.rating;
    const updated = await tx.approvalRequest.update({ where: { id: requestId }, data: { status: 'APPROVED', closedAt: new Date(), currentLevel: request.totalLevels } });
    await activity(tx, item.id, user.id, 'APPROVAL_COMPLETED', { requestId, level: request.currentLevel, step: step?.name, comment, toStateId: done.id, ...(finalRating ? { rating: finalRating } : {}), ...(onBehalfOf ? { onBehalfOf } : {}) });
    await notify(tx, watchers, { type: 'APPROVAL_COMPLETED', title: `${label} đã được duyệt hoàn thành${finalRating && RATINGS[finalRating] ? ` — ${RATINGS[finalRating]}` : ''}`, body: comment || null, link: itemLink(project, item) }, user.id);
    await notifyRequesterIfDone(tx, item, project, 'COMPLETED', user.id);
    return updated;
  });
}

async function endPosition(client, stateId) {
  const last = await client.workItem.findFirst({ where: { stateId, archivedAt: null }, orderBy: { position: 'desc' }, select: { position: true } });
  return (last ? last.position : 0) + 1024;
}

// Hàng chờ duyệt của người dùng: các yêu cầu PENDING mà người dùng là người duyệt ở level hiện tại.
// Hàng chờ duyệt của một người: nạp mọi phiếu đang chờ + ngữ cảnh duyệt một lần (không N+1).
// Trả { request, step, onBehalfOfId } và kèm ngữ cảnh để nơi gọi dùng lại.
async function queueFor(prisma, user, { withContext = false } = {}) {
  const pending = await prisma.approvalRequest.findMany({
    where: { status: 'PENDING', workItem: { archivedAt: null, project: { deletedAt: null }, assignees: { none: { userId: user.id } } } }, orderBy: { createdAt: 'asc' },
    include: { workItem: { include: { project: true, state: true, assignees: { include: { user: { select: { id: true, fullName: true } } } } } }, actions: { orderBy: { id: 'asc' } } },
  });
  const ctx = await approvalContext(prisma, [...new Set(pending.map(r => r.workItem.projectId))]);
  const out = [];
  for (const request of pending) {
    // Một người không duyệt hai cấp của cùng một phiếu.
    if (request.actions.some(a => a.actorId === user.id && a.decision === 'APPROVE' && a.level < request.currentLevel)) continue;
    const project = request.workItem.project;
    const step = rules.stepAt(rules.chainOf(ctx.steps.get(project.id) || [], !!request.withAssigner), request.currentLevel);
    if (step?.approverType !== 'ASSIGNER' && request.requestedById === user.id) continue;
    const it = withDoers(request.workItem, request.requestedById);
    if (assigneeIdsOf(it).includes(user.id)) continue;
    if (approverIdsSync(ctx, project, step, it).includes(user.id)) out.push({ request, step, onBehalfOfId: actingForSync(ctx, user, project, step, it) });
  }
  return withContext ? { items: out, ctx } : out;
}

module.exports = { APPROVER_TYPES, RATINGS, ASSIGNER_STEP, chainFor, assigneeIdsOf, withDoers, withDelegates, deptLeaderIds, approvalContext, approverIdsSync, approverIds, actingFor, actingForSync, canAct, stepsOf, stepsForItem, levelsForItem, levelsLabel, openRequest, cancelPending, hasApproval, decide, queueFor, endPosition };
