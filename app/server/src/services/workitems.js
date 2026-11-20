// Quy tắc dùng chung cho công việc: tạo việc, chuyển trạng thái (WIP, duyệt), thứ tự trên bảng.
const { fail, intParam, optionalInt, optionalDate, text, oneOf } = require('../lib/http');
const { sanitizeHtml, htmlToText } = require('../lib/rich-text');
const { activity, notify, notifyRequesterIfDone } = require('./events');
const approval = require('./approval');
const MTL = require('./mtl');
const tree = require('./tree');
const rules = require('./task-rules');

const PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NONE'];
const BOARD_INCLUDE = {
  assignees: { include: { user: { select: { id: true, fullName: true, username: true } } } },
  supporters: { include: { user: { select: { id: true, fullName: true, username: true } } } },
  labels: { include: { label: true } },
  approvals: { where: { status: 'PENDING' }, select: { id: true, currentLevel: true, totalLevels: true, withAssigner: true, withBoard: true } },
  // Việc con hiện ở mọi view: nhãn việc cha + tiến độ con x/y.
  parent: { select: { id: true, number: true, title: true } },
  children: { where: { archivedAt: null }, select: { state: { select: { category: true } } } },
  supportDepartments: { select: { departmentId: true } },
  extensions: { where: { status: 'PENDING' }, select: { id: true, newDue: true } },
  documents: { where: { kind: 'BASIS' }, select: { number: true, issuedOn: true }, take: 5 },
  _count: { select: { comments: true, attachments: true, children: true } },
};
function boardItem(project, item) {
  const { assignees, supporters, labels, approvals, _count, descriptionHtml, descriptionText, supportDepartments, extensions, documents, parent, children, ...rest } = item;
  const kids = rules.childProgress(children || []);
  return {
    ...rest, code: `${project.key}-${item.number}`, excerpt: (descriptionText || '').slice(0, 160),
    supportDepartmentIds: (supportDepartments || []).map(d => d.departmentId), pendingExtension: extensions?.[0] || null,
    basisDocs: (documents || []).filter(d => !d.kind || d.kind === 'BASIS').map(d => ({ number: d.number, issuedOn: d.issuedOn })),
    assignees: assignees.map(a => a.user), supporters: (supporters || []).map(a => a.user), labels: labels.map(l => l.label),
    pendingApproval: approvals[0] || null,
    parentRef: parent ? { id: parent.id, code: `${project.key}-${parent.number}`, title: parent.title } : null,
    counts: { comments: _count.comments, attachments: _count.attachments, children: _count.children, childrenDone: kids.done, childrenTotal: kids.total },
  };
}
const link = (project, item) => `#/projects/${project.id}?item=${item.id}`;
const endPosition = (client, stateId) => approval.endPosition(client, stateId);

async function positionBetween(tx, stateId, afterId, beforeId) {
  const near = async id => id ? tx.workItem.findFirst({ where: { id, stateId }, select: { position: true } }) : null;
  const above = await near(afterId), below = await near(beforeId);
  if (!above && !below) return endPosition(tx, stateId);
  if (above && !below) return above.position + 1024;
  if (!above && below) return below.position - 1024;
  if (Math.abs(below.position - above.position) > 1e-6) return (above.position + below.position) / 2;
  // Hết khoảng trống: đánh số lại cột rồi tính lại.
  const items = await tx.workItem.findMany({ where: { stateId }, orderBy: { position: 'asc' }, select: { id: true } });
  for (const [i, it] of items.entries()) await tx.workItem.update({ where: { id: it.id }, data: { position: (i + 1) * 1024 } });
  return positionBetween(tx, stateId, afterId, beforeId);
}

const childStates = (tx, itemId) => tx.workItem.findMany({ where: { parentId: itemId, archivedAt: null }, select: { state: { select: { category: true } } } });

// Kiểm tra trước khi chuyển trạng thái; trả về dữ liệu cập nhật và cột đích THỰC SỰ (`toState`):
// chuyển sang "Hoàn thành" mà chưa được người giao duyệt → vào cột "Chờ duyệt" (mở phiếu duyệt ở afterTransition).
// allowDirectComplete: nhập hàng loạt dữ liệu lịch sử (sổ Excel, kế hoạch năm) — ghi thẳng Hoàn thành như trước.
async function transition(tx, { project, rights, item, toState, overrideWip, allowDirectComplete = false }) {
  const fromState = item.state, requested = toState;
  if (toState.projectId !== project.id) fail(422, 'Trạng thái không thuộc dự án', 'INVALID_STATE');
  if (fromState && fromState.id === toState.id) return { data: {}, fromState, steps: [], toState };
  const approved = toState.category === 'COMPLETED' && !!(item.id && await approval.hasApproval(tx, item.id));
  const target = rules.completionTarget({ fromCategory: fromState?.category, toCategory: toState.category, approved, allowDirect: allowDirectComplete });
  if (target !== toState.category) {
    toState = await tx.workflowState.findFirst({ where: { projectId: project.id, category: target }, orderBy: { position: 'asc' } });
    if (!toState) fail(409, 'Dự án chưa có cột "Chờ duyệt" — người quản lý dự án cần thêm cột nhóm REVIEW', 'MISSING_REVIEW_STATE');
  }
  // Việc cha: chỉ gửi duyệt / hoàn thành khi mọi việc con (trừ việc huỷ) đã được duyệt hoàn thành.
  if (item.id && ['REVIEW', 'COMPLETED'].includes(toState.category) && !allowDirectComplete)
    rules.assertChildrenDone(await childStates(tx, item.id), toState.category === 'REVIEW' ? 'gửi duyệt' : 'hoàn thành');
  if (toState.wipLimit) {
    const count = await tx.workItem.count({ where: { stateId: toState.id, archivedAt: null, id: { not: item.id || 0 } } });
    if (count >= toState.wipLimit && !(overrideWip === 'bulk' || (overrideWip && rights.canManage)))
      fail(409, `Cột "${toState.name}" đã đạt giới hạn WIP ${toState.wipLimit} việc`, 'WIP_LIMIT');
  }
  const steps = toState.category === 'REVIEW' ? await approval.stepsForItem(tx, project, item) : [];
  const data = { stateId: toState.id };
  if (['STARTED', 'REVIEW'].includes(toState.category) && !item.startedAt) data.startedAt = new Date();
  if (toState.category === 'COMPLETED') { data.completedAt = new Date(); data.progress = 100; }
  else if (fromState && ['COMPLETED', 'CANCELLED'].includes(fromState.category)) data.completedAt = null;
  return { data, fromState, steps, toState, redirected: toState.id !== requested.id };
}
async function afterTransition(tx, { user, project, item, fromState, toState }) {
  if (!fromState || fromState.id === toState.id) return;
  await activity(tx, item.id, user.id, 'STATE', { from: fromState.name, to: toState.name, fromId: fromState.id, toId: toState.id });
  await notifyRequesterIfDone(tx, item, project, toState.category, user.id);
  if (fromState.category === 'REVIEW' && toState.category !== 'REVIEW') await approval.cancelPending(tx, { item, actor: user, reason: 'Chuyển khỏi cột chờ duyệt' });
  if (fromState.category === 'COMPLETED' && toState.category !== 'COMPLETED') {
    const last = await tx.approvalRequest.findFirst({ where: { workItemId: item.id, status: 'APPROVED' }, orderBy: { id: 'desc' } });
    if (last) await tx.approvalRequest.update({ where: { id: last.id }, data: { status: 'REOPENED' } });
  }
  if (toState.category === 'REVIEW') await approval.openRequest(tx, { project, item, fromStateId: fromState.id, actor: user });
  // Việc con đã xong / đã huỷ được mở lại → việc cha (đang chờ duyệt / đã hoàn thành) không còn "đủ con" nữa.
  if (item.parentId && ['COMPLETED', 'CANCELLED'].includes(fromState.category) && !['COMPLETED', 'CANCELLED'].includes(toState.category))
    await reopenAncestors(tx, { user, parentId: item.parentId, reason: `Việc con ${project.key}-${item.number} được mở lại` });
}

// Đưa các việc tổ tiên đang "Chờ duyệt" / "Hoàn thành" về "Đang làm" (huỷ phiếu chờ, đánh dấu phiếu đã duyệt là mở lại).
async function reopenAncestors(tx, { user, parentId, reason }) {
  const seen = new Set();
  for (let pid = parentId; pid != null && !seen.has(pid); ) {
    seen.add(pid);
    const p = await tx.workItem.findUnique({ where: { id: pid }, include: { state: true, project: true, assignees: true } });
    if (!p || p.archivedAt || !['REVIEW', 'COMPLETED'].includes(p.state.category)) break;
    const started = await tx.workflowState.findFirst({ where: { projectId: p.projectId, category: 'STARTED' }, orderBy: { position: 'asc' } });
    if (!started) break;
    await tx.workItem.update({ where: { id: p.id }, data: { stateId: started.id, completedAt: null, position: await endPosition(tx, started.id) } });
    if (p.state.category === 'REVIEW') await approval.cancelPending(tx, { item: p, actor: user, reason });
    else {
      const last = await tx.approvalRequest.findFirst({ where: { workItemId: p.id, status: 'APPROVED' }, orderBy: { id: 'desc' } });
      if (last) await tx.approvalRequest.update({ where: { id: last.id }, data: { status: 'REOPENED' } });
    }
    await activity(tx, p.id, user.id, 'REOPENED_BY_CHILD', { from: p.state.name, to: started.name, reason });
    await notify(tx, p.assignees.map(a => a.userId), { type: 'REOPENED', title: `${p.project.key}-${p.number} mở lại: ${reason}`, body: p.title, link: link(p.project, p) }, user.id);
    pid = p.parentId;
  }
}

// Tự chuyển cột theo % (MTL, báo cáo tuần): 100% chỉ gửi duyệt khi chưa chờ duyệt và mọi việc con đã xong —
// còn việc con mở thì chỉ ghi %, không báo lỗi (để không chặn báo cáo tuần).
async function canAutoSubmit(tx, item) {
  if (['REVIEW', 'COMPLETED', 'CANCELLED'].includes(item.state.category)) return false;
  return rules.childProgress(await childStates(tx, item.id)).open === 0;
}

async function activeUsers(tx, ids, { strict = true } = {}) {
  if (!ids.length) return [];
  // Admin IT không nhận việc (không có quyền xem nội dung công việc).
  const found = (await tx.user.findMany({ where: { id: { in: ids }, isActive: true, isRootAdmin: false, role: { not: 'admin' } }, select: { id: true } })).map(u => u.id);
  if (strict && found.length !== ids.length) fail(422, 'Có người nhận không tồn tại hoặc đã khoá', 'INVALID_ASSIGNEE');
  return found;
}
function idList(value, label) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 50) fail(422, label + ' không hợp lệ');
  return [...new Set(value.map(v => intParam(v, label)))];
}
// Mức duyệt riêng của việc: chỉ người quản lý dự án được đặt (tránh nhân viên tự bỏ qua bước duyệt).
function approvalLevelsInput(value, rights) {
  if (value === undefined) return undefined;
  if (!rights.canManage) fail(403, 'Chỉ trưởng dự án / người quản lý dự án được đổi mức duyệt của việc', 'FORBIDDEN');
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 5) fail(422, 'Mức duyệt không hợp lệ');
  return n;
}
// Các trường của Sổ giao việc (dùng chung khi tạo và khi sửa). Chỉ trả về các trường có trong input.
// ctx = { user, rights, project }: ghi "người giao" là người khác (nhập thay) chỉ được ghi lãnh đạo — Ban Giám đốc
// (sổ của đơn vị) hoặc Ban Giám đốc / lãnh đạo phòng (dự án thường); người quản lý dự án ghi được bất kỳ ai.
async function registerFields(tx, input, ctx = null) {
  const out = {};
  if (input.assignedById !== undefined) {
    out.assignedById = optionalInt(input.assignedById, 'Người giao') ?? null;
    const u = out.assignedById ? await tx.user.findFirst({ where: { id: out.assignedById, isActive: true, isRootAdmin: false, role: { not: 'admin' } }, select: { id: true, role: true } }) : null;
    if (out.assignedById && !u) fail(422, 'Người giao không hợp lệ', 'INVALID_ASSIGNER');
    if (u && ctx && u.id !== ctx.user.id && !ctx.rights.canManage) {
      const roles = ctx.project?.visibility === 'ASSIGNED' ? ['director'] : ['director', 'manager', 'deputy'];
      if (!roles.includes(u.role)) fail(403, ctx.project?.visibility === 'ASSIGNED' ? 'Chỉ ghi người giao là chính bạn hoặc một thành viên Ban Giám đốc' : 'Chỉ ghi người giao là chính bạn hoặc lãnh đạo', 'INVALID_ASSIGNER');
    }
  }
  if (input.assignedAt !== undefined) out.assignedAt = optionalDate(input.assignedAt, 'Ngày giao');
  if (input.source !== undefined) out.source = text(input.source, 'Nguồn giao việc', { max: 120 }) || null;
  if (input.progress !== undefined) {
    const n = Number(input.progress);
    if (!Number.isFinite(n) || n < 0 || n > 100) fail(422, 'Tiến độ phải từ 0 đến 100%');
    out.progress = Math.round(n);
  }
  for (const [key, label, max] of [['deliverable', 'Sản phẩm đầu ra', 2000], ['outputs', 'Sản phẩm đã có', 10000], ['resultNote', 'Kết quả / khó khăn', 5000], ['coordinatorText', 'Đơn vị phối hợp', 500], ['note', 'Ghi chú', 2000]]) {
    if (input[key] !== undefined) out[key] = String(input[key] ?? '').replace(/\r\n/g, '\n').trim().slice(0, max + 1) || '';
    if (out[key] && out[key].length > max) fail(422, `${label} vượt ${max} ký tự`, 'TOO_LONG');
  }
  if (input.refCode !== undefined) out.refCode = text(input.refCode, 'Mã CV', { max: 40 }) || null;
  for (const [key, label, max] of [['period', 'Thời gian', 200], ['location', 'Địa điểm', 300], ['supervisorText', 'Lãnh đạo phụ trách', 200], ['planCode', 'Số thứ tự kế hoạch', 20], ['planSection', 'Nhóm nhiệm vụ', 300]])
    if (input[key] !== undefined) out[key] = text(input[key], label, { max }) || null;
  // Kepper: hạng mục Master Timeline (kế hoạch gốc chỉ đổi qua "Điều chỉnh kế hoạch gốc").
  for (const key of ['critical', 'milestone']) if (input[key] !== undefined) out[key] = !!input[key];
  if (input.forecastEnd !== undefined) out.forecastEnd = optionalDate(input.forecastEnd, 'Dự báo hoàn thành') ?? null;
  if (input.ownerText !== undefined) out.ownerText = text(input.ownerText, 'Đầu mối', { max: 200 }) || '';
  if (input.externalParty !== undefined) out.externalParty = text(input.externalParty, 'Cơ quan / đơn vị ngoài', { max: 200 }) || '';
  if (input.weight !== undefined) {
    out.weight = input.weight === null || input.weight === '' ? null : Number(input.weight);
    if (out.weight != null && (!Number.isFinite(out.weight) || out.weight <= 0)) fail(422, 'Trọng số phải lớn hơn 0');
  }
  if (input.progress !== undefined) out.progressAt = new Date();
  if (input.budget !== undefined) {
    out.budget = input.budget === null || input.budget === '' ? null : Number(input.budget);
    if (out.budget != null && (!Number.isFinite(out.budget) || out.budget < 0)) fail(422, 'Kinh phí không hợp lệ');
  }
  return out;
}

const TASK_TYPES = ['PLAN', 'ADHOC'];
// "Loại nhiệm vụ" gộp vào "Nguồn giao việc" (một trường, một danh sách ở form tạo và panel): nguồn "Kế hoạch năm" → PLAN,
// nguồn khác → ADHOC (đột xuất); không chọn nguồn → null (giữ loại hiện có / mặc định).
const taskTypeOfSource = source => { const s = String(source ?? '').trim(); return !s ? null : /^k[ếe] ?ho[ạa]ch\s*n[ăa]m/i.test(s.normalize('NFC')) ? 'PLAN' : 'ADHOC'; };
async function departmentIdOf(tx, value, label) {
  const id = optionalInt(value, label);
  if (id == null) return null;
  if (!(await tx.department.findFirst({ where: { id, isActive: true } }))) fail(422, `${label} không hợp lệ`, 'INVALID_DEPARTMENT');
  return id;
}
async function departmentIds(tx, value) {
  const ids = idList(value, 'Đơn vị phối hợp');
  if (ids === undefined) return undefined;
  if (ids.length && (await tx.department.count({ where: { id: { in: ids }, isActive: true } })) !== ids.length) fail(422, 'Đơn vị phối hợp không hợp lệ', 'INVALID_DEPARTMENT');
  return ids;
}

// Nhãn của việc phải là nhãn chung hoặc nhãn riêng của chính dự án.
async function labelsOf(tx, projectId, ids) {
  if (!ids || !ids.length) return ids;
  const ok = await tx.label.count({ where: { id: { in: ids }, OR: [{ projectId: null }, { projectId }] } });
  if (ok !== ids.length) fail(422, 'Có nhãn không thuộc dự án', 'INVALID_LABEL');
  return ids;
}
async function cycleOf(tx, projectId, value) {
  if (value === undefined) return undefined;
  const id = optionalInt(value, 'Chu kỳ');
  if (id == null) return null;
  if (!(await tx.cycle.findFirst({ where: { id, projectId } }))) fail(422, 'Chu kỳ không thuộc dự án', 'INVALID_CYCLE');
  return id;
}

// Tạo việc trong transaction (dùng chung cho tạo tay, tiếp nhận yêu cầu, việc lặp lại).
async function createWorkItem(tx, { project, user, rights, input, reporterId = user.id, source = null, strictAssignees = true, silent = false }) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'project:' + project.id}))`;
  const title = text(input.title, 'Tiêu đề', { required: true, max: 300 });
  const descriptionHtml = sanitizeHtml(input.descriptionHtml || '');
  const assigneeIds = await activeUsers(tx, idList(input.assigneeIds, 'Người nhận') || [], { strict: strictAssignees });
  const labelIds = await labelsOf(tx, project.id, idList(input.labelIds, 'Nhãn') || []);
  const approvalLevels = approvalLevelsInput(input.approvalLevels, rights) ?? null;
  let toState = input.stateId
    ? await tx.workflowState.findFirst({ where: { id: intParam(input.stateId, 'Trạng thái'), projectId: project.id } })
    : await tx.workflowState.findFirst({ where: { projectId: project.id, category: 'UNSTARTED' }, orderBy: { position: 'asc' } })
      // Bảng không có cột "Chưa bắt đầu" (vd. lịch tuần): cột đầu tiên không phải Chờ duyệt / Hoàn thành / Huỷ.
      || await tx.workflowState.findFirst({ where: { projectId: project.id, category: { notIn: ['REVIEW', 'COMPLETED', 'CANCELLED'] } }, orderBy: { position: 'asc' } });
  if (!toState) fail(422, 'Trạng thái không hợp lệ', 'INVALID_STATE');
  const parentId = optionalInt(input.parentId, 'Việc cha');
  const parent = parentId ? await tx.workItem.findFirst({ where: { id: parentId, projectId: project.id }, select: { id: true, leadDepartmentId: true, taskType: true } }) : null;
  if (parentId && !parent) fail(422, 'Việc cha không thuộc dự án');
  if (parent) await tree.assertCanNest(tx, parentId); // việc con nhiều cấp, trần MAX_DEPTH
  // Giao về phòng: đơn vị chủ trì (việc nhánh kế thừa của việc cha). Sổ giao việc của đơn vị mà giao thẳng cán bộ
  // thì đơn vị chủ trì = phòng của người chủ trì, để lãnh đạo phòng vẫn thấy và duyệt trước khi trình.
  let leadDepartmentId = input.leadDepartmentId !== undefined ? await departmentIdOf(tx, input.leadDepartmentId, 'Đơn vị chủ trì') : (parent?.leadDepartmentId ?? null);
  if (leadDepartmentId == null && project.visibility === 'ASSIGNED' && assigneeIds.length)
    leadDepartmentId = (await tx.user.findUnique({ where: { id: assigneeIds[0] }, select: { departmentId: true } }))?.departmentId ?? null;
  // Giao về phòng khác chỉ dùng trong sổ giao việc của đơn vị (quyền xem theo việc); dự án thường thì phòng của dự án là phòng chủ trì.
  // Dự án dùng chung (MTL): mọi bộ phận chủ trì / phối hợp hạng mục trong cùng dự án.
  const shared = project.visibility === 'ASSIGNED' || project.kind === 'MTL';
  if (!shared && input.leadDepartmentId != null && leadDepartmentId != null && leadDepartmentId !== project.departmentId)
    fail(422, 'Giao về phòng khác chỉ dùng trong sổ giao việc của đơn vị', 'DISPATCH_NOT_ALLOWED');
  const supportDepartmentIds = shared ? ((await departmentIds(tx, input.supportDepartmentIds)) || []).filter(id => id !== leadDepartmentId) : [];
  const taskType = oneOf(input.taskType, TASK_TYPES, 'Loại nhiệm vụ') || parent?.taskType || taskTypeOfSource(input.source) || 'ADHOC';
  const dispatched = !parent && leadDepartmentId != null && project.visibility === 'ASSIGNED';
  const cycleId = await cycleOf(tx, project.id, input.cycleId);
  const reg = await registerFields(tx, input, { user, rights, project });
  const supporterIds = await activeUsers(tx, idList(input.supporterIds, 'Người phối hợp') || [], { strict: strictAssignees });
  const t0 = await transition(tx, { project, rights, item: { id: null, state: null, parentId, approvalLevels, priority: oneOf(input.priority, PRIORITIES, 'Ưu tiên') || 'NONE', labelIds }, toState, overrideWip: silent ? 'bulk' : input.overrideWip, allowDirectComplete: silent });
  const { data } = t0; toState = t0.toState;
  const { nextNumber } = await tx.project.update({ where: { id: project.id }, data: { nextNumber: { increment: 1 } }, select: { nextNumber: true } });
  const startDate = optionalDate(input.startDate, 'Ngày bắt đầu') ?? null, dueDate = optionalDate(input.dueDate, 'Hạn') ?? null;
  // MTL: việc con / việc đột xuất lập trên ứng dụng nhận kế hoạch gốc ngay khi có hạn (để vào báo cáo tuần, KPI, cảnh báo).
  const baseline = project.kind === 'MTL' ? MTL.initialBaseline(startDate, dueDate) : null;
  const item = await tx.workItem.create({ data: {
    ...data, projectId: project.id, number: nextNumber - 1, title, descriptionHtml, descriptionText: htmlToText(descriptionHtml),
    priority: oneOf(input.priority, PRIORITIES, 'Ưu tiên') || 'NONE', reporterId, parentId, cycleId: cycleId ?? null,
    recurringRuleId: input.recurringRuleId ?? null, approvalLevels,
    ...reg, assignedById: reg.assignedById ?? user.id ?? null, assignedAt: reg.assignedAt ?? new Date(),
    ...(data.progress != null ? { progress: data.progress } : {}),
    startDate, dueDate, ...(baseline || {}),
    estimate: input.estimate == null || input.estimate === '' ? null : Number(input.estimate) || null,
    position: await endPosition(tx, toState.id),
    taskType, leadDepartmentId, originalDueDate: optionalDate(input.dueDate, 'Hạn') ?? null,
    ...(dispatched ? { dispatchStatus: assigneeIds.length ? 'ACCEPTED' : 'PENDING', dispatchedAt: new Date(), ...(assigneeIds.length ? { acceptedAt: new Date(), acceptedById: user.id } : {}) } : {}),
    supportDepartments: { create: supportDepartmentIds.map(departmentId => ({ departmentId })) },
    assignees: { create: assigneeIds.map(userId => ({ userId })) },
    supporters: { create: supporterIds.filter(id => !assigneeIds.includes(id)).map(userId => ({ userId })) }, labels: { create: labelIds.map(labelId => ({ labelId })) },
  }, include: { state: true } });
  await activity(tx, item.id, user.id, 'CREATED', { title, state: toState.name, ...(source ? { source } : {}) });
  if (toState.category === 'REVIEW') await approval.openRequest(tx, { project, item, fromStateId: null, actor: user });
  // Thêm việc con chưa xong dưới việc cha đang chờ duyệt / đã hoàn thành → mở lại việc cha.
  if (parentId && !['COMPLETED', 'CANCELLED'].includes(toState.category)) await reopenAncestors(tx, { user, parentId, reason: `Thêm việc con ${project.key}-${item.number}` });
  if (dispatched) await activity(tx, item.id, user.id, 'DISPATCHED', { departmentId: leadDepartmentId, supportDepartmentIds, direct: assigneeIds.length > 0,
    ...(item.assignedById && item.assignedById !== user.id ? { onBehalfOfId: item.assignedById } : {}) });
  if (silent) return item; // nhập hàng loạt (sổ Excel, kế hoạch năm): không gửi thông báo từng việc
  if (dispatched) {
    const code = `${project.key}-${item.number}`;
    await notify(tx, (await approval.deptLeaderIds(tx, leadDepartmentId)).filter(id => !assigneeIds.includes(id)), assigneeIds.length
      ? { type: 'DISPATCH_DIRECT', title: `Cán bộ của phòng được giao trực tiếp ${code}`, body: title, link: link(project, item) }
      : { type: 'DISPATCH', title: `Phòng được giao chủ trì ${code} — cần tiếp nhận, phân công`, body: title, link: link(project, item) }, user.id);
    for (const d of supportDepartmentIds) await notify(tx, await approval.deptLeaderIds(tx, d), { type: 'DISPATCH_SUPPORT', title: `Phòng được giao phối hợp ${code}`, body: title, link: link(project, item) }, user.id);
  }
  await notify(tx, assigneeIds, { type: 'ASSIGNED', title: `Bạn được giao chủ trì ${project.key}-${item.number}`, body: title, link: link(project, item) }, user.id);
  await notify(tx, supporterIds.filter(id => !assigneeIds.includes(id)), { type: 'SUPPORTING', title: `Bạn được giao phối hợp ${project.key}-${item.number}`, body: title, link: link(project, item) }, user.id);
  return item;
}

module.exports = { reopenAncestors, canAutoSubmit, TASK_TYPES, taskTypeOfSource, departmentIdOf, departmentIds, registerFields, PRIORITIES, BOARD_INCLUDE, boardItem, link, endPosition, positionBetween, transition, afterTransition, activeUsers, idList, cycleOf, labelsOf, approvalLevelsInput, createWorkItem };
