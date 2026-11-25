// Dự án, cột trạng thái (WIP), thành viên, quy trình duyệt nhiều cấp.
const { fail, intParam, optionalInt, optionalDate, text, oneOf } = require('../lib/http');
const { loadProject, projectRights, visibleProjectsWhere, canCreateProjectIn } = require('../services/access');
const { APPROVER_TYPES, approverIds } = require('../services/approval');
const rules = require('../services/task-rules');
const { permissionScope, isBoard, isItAdmin } = require('../lib/permissions');

const CATEGORIES = ['BACKLOG', 'UNSTARTED', 'STARTED', 'REVIEW', 'COMPLETED', 'CANCELLED', 'OTHER'];
// OTHER = cột tự do (lịch tuần, danh sách theo chủ đề…): chỉ là nhãn cột, không tính tiến độ, không kích hoạt duyệt.
// Mẫu "Lịch tuần": mỗi cột một ngày, để báo ai ở / không ở văn phòng, ai đi công tác.
const WEEK_STATES = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Cuối tuần'].map((name, i) => ({ name, category: 'OTHER', color: ['#2563eb', '#0891b2', '#16a34a', '#d97706', '#9333ea', '#64748b'][i] }));
// Nhóm cột bắt buộc theo cách dùng dự án: có duyệt thì cần cột Chờ duyệt + Hoàn thành (+ Đang làm để trả lại);
// sổ giao việc của đơn vị còn cần Chưa bắt đầu (tiếp nhận) — dự án thường thì tự do.
// Mọi việc hoàn thành phải qua người giao duyệt: có cột "Hoàn thành" thì cần cột "Chờ duyệt" và "Đang làm" (để trả lại).
// Bảng chỉ gồm cột tự do (vd. "Lịch tuần") không có khái niệm hoàn thành nên không bắt buộc.
function requiredCategories(project, stepsCount, states = []) {
  if (project.visibility === 'ASSIGNED') return ['UNSTARTED', 'STARTED', 'REVIEW', 'COMPLETED'];
  return stepsCount || states.some(s => s.category === 'COMPLETED') ? ['STARTED', 'REVIEW', 'COMPLETED'] : [];
}
const DEFAULT_STATES = [
  { name: 'Tồn đọng', category: 'BACKLOG', color: '#94a3b8' },
  { name: 'Cần làm', category: 'UNSTARTED', color: '#64748b' },
  { name: 'Đang làm', category: 'STARTED', color: '#2563eb', wipLimit: 5 },
  { name: 'Chờ duyệt', category: 'REVIEW', color: '#d97706' },
  { name: 'Hoàn thành', category: 'COMPLETED', color: '#16a34a' },
  { name: 'Huỷ', category: 'CANCELLED', color: '#9ca3af' },
];
// Dự án theo Master Timeline: cột theo tình trạng hạng mục (tiến độ tính theo % và kế hoạch gốc, không theo cột).
const MTL_STATES = [
  { name: 'Chưa bắt đầu', category: 'UNSTARTED', color: '#64748b' },
  { name: 'Đang thực hiện', category: 'STARTED', color: '#2563eb' },
  { name: 'Chờ duyệt', category: 'REVIEW', color: '#d97706' },
  { name: 'Hoàn thành', category: 'COMPLETED', color: '#16a34a' },
  { name: 'Tạm dừng', category: 'OTHER', color: '#9333ea' },
  { name: 'Huỷ', category: 'CANCELLED', color: '#9ca3af' },
];
const VISIBILITY = ['DEPARTMENT', 'PRIVATE', 'PUBLIC', 'ASSIGNED'];
const MEMBER_ROLES = ['OWNER', 'MEMBER', 'VIEWER'];

function keyOf(value) {
  const key = String(value || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) fail(422, 'Mã dự án gồm 2–10 ký tự chữ in hoa/số, bắt đầu bằng chữ', 'INVALID_KEY');
  return key;
}
// Đọc danh sách cấp duyệt từ body (dùng khi tạo dự án và khi sửa quy trình).
function parseSteps(list) {
  if (!Array.isArray(list)) fail(422, 'Danh sách bước duyệt không hợp lệ');
  if (list.length > 5) fail(422, 'Tối đa 5 cấp duyệt');
  return list.map((s, index) => {
    const approverType = oneOf(s.approverType, Object.keys(APPROVER_TYPES), 'Người duyệt') || fail(422, 'Thiếu loại người duyệt');
    const approverUserId = approverType === 'USER' ? intParam(s.approverUserId, 'Người duyệt') : null;
    return { level: index + 1, name: text(s.name, 'Tên bước', { max: 60 }) || APPROVER_TYPES[approverType], approverType, approverUserId };
  });
}
function defaultLevelsInput(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 5) fail(422, 'Mức duyệt mặc định không hợp lệ');
  return n;
}
async function checkApprovers(client, steps) {
  const ids = steps.filter(s => s.approverUserId).map(s => s.approverUserId);
  if (ids.length && (await client.user.count({ where: { id: { in: ids }, isActive: true } })) !== new Set(ids).size) fail(422, 'Người duyệt không tồn tại hoặc đã khoá', 'INVALID_APPROVER');
}
// Người đứng tên dự án: tài khoản nghiệp vụ đang hoạt động. Tài khoản Quản trị hệ thống không xem nội dung nghiệp vụ (đứng tên thì lại nhận
// "Cần duyệt …" của cấp "Người đứng tên dự án" và cảnh báo MTL phần "PMO"); tài khoản đã khoá / không tồn tại thì không ai đứng tên thật.
// Để trống vẫn được (cấp "Người đứng tên dự án" khi đó do Chủ dự án duyệt thay — services/approval.js).
async function checkLead(client, leadId) {
  if (leadId == null) return;
  const u = await client.user.findUnique({ where: { id: leadId }, select: { id: true, isActive: true, role: true, isRootAdmin: true } });
  if (!u || !u.isActive || isItAdmin(u)) fail(422, 'Người đứng tên dự án phải là tài khoản nghiệp vụ đang hoạt động', 'INVALID_LEAD');
}
// Cột có sẵn ĐỔI nhóm khi còn việc (đếm như khi xoá cột, kể cả việc trong Thùng rác): đổi nhóm là đổi nghĩa mọi việc trong cột — vd. "Đang làm"
// → Hoàn thành thì việc thành xong mà không qua người giao duyệt; → Cột tự do thì việc rời khỏi tiến độ. Đổi tên, màu, WIP, thứ tự vẫn được.
// existing: [{ id, name, category, _count: { items } }]; states: danh sách gửi lên [{ id?, category }]. Trả các cột bị khoá.
function categoryLocks(existing, states) {
  return states.filter(s => s.id).map(s => [s, existing.find(e => e.id === s.id)])
    .filter(([s, e]) => e && e.category !== s.category && e._count.items > 0).map(([, e]) => e);
}
// usage: kèm số việc của từng cột (kể cả việc trong Thùng rác) — màn Cài đặt khoá ô nhóm của cột còn việc.
async function projectDetail(prisma, id, user, { usage = false } = {}) {
  const project = await prisma.project.findUnique({ where: { id }, include: {
    department: { select: { id: true, name: true } },
    states: { orderBy: { position: 'asc' } },
    members: { include: { user: { select: { id: true, fullName: true, username: true, departmentId: true } } }, orderBy: { id: 'asc' } },
    approvalSteps: { orderBy: { level: 'asc' } },
    approvalRules: { orderBy: { id: 'asc' } },
  } });
  const member = project.members.find(m => m.userId === user.id);
  // Tên người sẽ thực sự duyệt ở mỗi cấp (để trưởng phòng thấy rõ ai duyệt, phát hiện cấp không có người duyệt).
  const ids = new Map();
  for (const step of project.approvalSteps) ids.set(step.id, await approverIds(prisma, project, step));
  const names = Object.fromEntries((await prisma.user.findMany({ where: { id: { in: [...new Set([...ids.values()].flat())] } }, select: { id: true, fullName: true } })).map(u => [u.id, u.fullName]));
  const approvalSteps = project.approvalSteps.map(s => ({ ...s, approvers: ids.get(s.id).map(uid => ({ id: uid, fullName: names[uid] })) }));
  // Quy trình duyệt mặc định của việc mới (nhãn "Duyệt N cấp" ở trang dự án): cùng hàm dựng chuỗi với panel việc — đếm cả bước người giao.
  const approvalFlow = rules.defaultFlow(project, project.approvalSteps, project.states).map(s => ({ level: s.level, name: s.name, approverType: s.approverType }));
  let states = project.states;
  if (usage) {
    const count = async where => new Map((await prisma.workItem.groupBy({ by: ['stateId'], where: { projectId: id, ...where }, _count: { _all: true } })).map(r => [r.stateId, r._count._all]));
    const [all, trashed] = await Promise.all([count({}), count({ archivedAt: { not: null } })]);
    states = states.map(s => ({ ...s, itemCount: all.get(s.id) || 0, trashCount: trashed.get(s.id) || 0 }));
  }
  return { ...project, states, approvalSteps, approvalFlow, rights: projectRights(user, project, member) };
}

module.exports = function mountProjects(app, { prisma, auth, audit }) {
  app.get('/api/projects', auth, async (req, res) => {
    const where = { ...visibleProjectsWhere(req.user), ...(req.query.archived === 'true' ? {} : { archivedAt: null }) };
    const rows = await prisma.project.findMany({ where, orderBy: [{ departmentId: 'asc' }, { name: 'asc' }], include: {
      department: { select: { id: true, name: true } }, members: { where: { userId: req.user.id } },
      _count: { select: { items: { where: { archivedAt: null } } } },
    } });
    res.json(rows.map(({ members, ...p }) => ({ ...p, rights: projectRights(req.user, p, members[0]) })));
  });

  app.post('/api/projects', auth, async (req, res) => {
    const departmentId = intParam(req.body.departmentId ?? req.user.departmentId, 'Bộ phận');
    const mtlReq = req.body.kind === 'MTL' || req.body.template === 'MTL';
    // Dự án MTL: quyền tạo theo vai trò giao ban (Ban TGĐ / quản lý toàn công ty / PMO chỉ định — kiểm bên dưới), không theo bộ phận.
    if (!mtlReq && !canCreateProjectIn(req.user, departmentId)) fail(403, 'Bạn không có quyền tạo dự án cho bộ phận này', 'FORBIDDEN');
    const dept = await prisma.department.findFirst({ where: { id: departmentId, isActive: true } });
    if (!dept) fail(422, 'Bộ phận không hợp lệ', 'INVALID_DEPARTMENT');
    const leadId = optionalInt(req.body.leadId, 'Người đứng tên dự án') ?? req.user.id;
    await checkLead(prisma, leadId);
    const steps = req.body.approvalSteps === undefined ? [] : parseSteps(req.body.approvalSteps);
    await checkApprovers(prisma, steps);
    const defaultApprovalLevels = defaultLevelsInput(req.body.defaultApprovalLevels) ?? null;
    const mtl = req.body.kind === 'MTL' || req.body.template === 'MTL';
    // Dự án MTL là kế hoạch chính thức (vào báo cáo tuần, cảnh báo của mọi bộ phận): chỉ Ban Tổng Giám đốc tạo (ma trận 5.4).
    // PMO (kiêm nhiệm) điều phối bằng cách được BTGĐ đưa vào làm Chủ dự án — không tự tạo MTL.
    if (mtl && !isBoard(req.user)) fail(403, 'Chỉ Ban Tổng Giám đốc tạo dự án theo Master Timeline; PMO được đưa vào làm Chủ dự án để điều phối', 'FORBIDDEN');
    const t0 = mtl ? optionalDate(req.body.t0Date, 'Ngày T0') : null;
    if (mtl && !t0) fail(422, 'Nhập ngày T0 (tháng bắt đầu của Master Timeline)', 'T0_REQUIRED');
    const project = await prisma.$transaction(async tx => {
      const created = await tx.project.create({ data: {
        key: keyOf(req.body.key), name: text(req.body.name, 'Tên dự án', { required: true, max: 160 }),
        description: text(req.body.description, 'Mô tả', { max: 2000 }) || null, departmentId, leadId,
        // MTL: dự án dùng chung — mặc định toàn công ty xem được; T0 bắt buộc để quy đổi tháng T.
        visibility: oneOf(req.body.visibility, VISIBILITY, 'Phạm vi') || (mtl ? 'PUBLIC' : 'DEPARTMENT'), createdById: req.user.id,
        kind: mtl ? 'MTL' : 'BOARD', t0Date: mtl ? t0 : null, defaultApprovalLevels: mtl && defaultApprovalLevels == null ? 0 : defaultApprovalLevels,
        states: { create: (mtl ? MTL_STATES : req.body.template === 'WEEK' && !steps.length ? WEEK_STATES : DEFAULT_STATES).map((s, position) => ({ ...s, position })) },
        approvalSteps: { create: steps },
      } });
      const memberIds = [...new Set([req.user.id, leadId])];
      await tx.projectMember.createMany({ data: memberIds.map(userId => ({ projectId: created.id, userId, role: 'OWNER' })) });
      await audit(req, 'CREATE', 'Project', created.id, null, created, tx);
      return created;
    });
    res.status(201).json(await projectDetail(prisma, project.id, req.user));
  });

  app.get('/api/projects/:id', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id));
    res.json(await projectDetail(prisma, project.id, req.user, { usage: req.query.usage === '1' }));
  });

  app.put('/api/projects/:id', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id), 'manage');
    const data = {};
    if (req.body.name !== undefined) data.name = text(req.body.name, 'Tên dự án', { required: true, max: 160 });
    if (req.body.description !== undefined) data.description = text(req.body.description, 'Mô tả', { max: 2000 }) || null;
    if (req.body.visibility !== undefined) data.visibility = oneOf(req.body.visibility, VISIBILITY, 'Phạm vi');
    // MTL không dùng phạm vi "sổ giao việc" (luồng giao về phòng / tiếp nhận cũ không đi qua quy định MTL).
    if (project.kind === 'MTL' && data.visibility === 'ASSIGNED') fail(422, 'Dự án MTL không dùng phạm vi sổ giao việc', 'INVALID_VALUE');
    if (req.body.leadId !== undefined) {
      data.leadId = optionalInt(req.body.leadId, 'Người đứng tên dự án');
      await checkLead(prisma, data.leadId);
    }
    if (req.body.archived !== undefined) data.archivedAt = req.body.archived ? new Date() : null;
    if (req.body.intakeEnabled !== undefined) data.intakeEnabled = !!req.body.intakeEnabled;
    if (req.body.defaultApprovalLevels !== undefined) data.defaultApprovalLevels = defaultLevelsInput(req.body.defaultApprovalLevels);
    const row = await prisma.project.update({ where: { id: project.id }, data });
    await audit(req, 'UPDATE', 'Project', project.id, project, row);
    res.json(await projectDetail(prisma, project.id, req.user));
  });

  // Thay toàn bộ danh sách cột. Cột có id cũ được cập nhật; cột bị bỏ phải không còn việc.
  app.put('/api/projects/:id/states', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id), 'manage');
    const list = Array.isArray(req.body.states) ? req.body.states : fail(422, 'Danh sách cột không hợp lệ');
    if (!list.length || list.length > 15) fail(422, 'Dự án cần 1–15 cột');
    const states = list.map((s, position) => ({
      id: s.id ? intParam(s.id) : null, name: text(s.name, 'Tên cột', { required: true, max: 40 }), category: oneOf(s.category, CATEGORIES, 'Nhóm trạng thái') || fail(422, 'Thiếu nhóm trạng thái'),
      color: /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : '#64748b', wipLimit: s.wipLimit == null || s.wipLimit === '' ? null : Math.max(1, Math.min(999, Number(s.wipLimit) | 0)), position,
    }));
    const stepsCount = await prisma.approvalStep.count({ where: { projectId: project.id } });
    const LABEL = { UNSTARTED: 'Chưa bắt đầu', STARTED: 'Đang thực hiện', REVIEW: 'Chờ duyệt', COMPLETED: 'Hoàn thành' };
    for (const required of requiredCategories(project, stepsCount, states)) if (!states.some(s => s.category === required))
      fail(422, `${project.visibility === 'ASSIGNED' ? 'Sổ giao việc' : 'Dự án có cột Hoàn thành (việc xong phải qua người giao duyệt)'} cần ít nhất một cột thuộc nhóm "${LABEL[required]}"`, 'MISSING_CATEGORY');
    await prisma.$transaction(async tx => {
      const existing = await tx.workflowState.findMany({ where: { projectId: project.id }, include: { _count: { select: { items: true } } } });
      const keep = new Set(states.filter(s => s.id).map(s => s.id));
      for (const s of states) if (s.id && !existing.some(e => e.id === s.id)) fail(422, 'Cột không thuộc dự án');
      for (const e of existing) if (!keep.has(e.id) && e._count.items) fail(409, `Cột "${e.name}" còn ${e._count.items} việc, hãy chuyển việc trước khi xoá`, 'STATE_NOT_EMPTY');
      const [locked] = categoryLocks(existing, states);
      if (locked) {
        const trashed = await tx.workItem.count({ where: { stateId: locked.id, archivedAt: { not: null } } });
        fail(409, `Cột "${locked.name}" còn ${locked._count.items} việc — chuyển việc sang cột khác rồi mới đổi nhóm`
          + (trashed ? `. Trong đó ${trashed} việc đang ở Thùng rác nên Bảng không hiện: khôi phục rồi chuyển đi, hoặc chờ hệ thống xoá hẳn sau 7 ngày` : ''), 'STATE_CATEGORY_LOCKED');
      }
      await tx.workflowState.deleteMany({ where: { projectId: project.id, id: { notIn: [...keep] } } });
      for (const s of states) {
        const { id, ...data } = s;
        if (id) await tx.workflowState.update({ where: { id }, data }); else await tx.workflowState.create({ data: { ...data, projectId: project.id } });
      }
      await audit(req, 'UPDATE_STATES', 'Project', project.id, existing.map(({ _count, ...e }) => e), states, tx);
    });
    res.json(await projectDetail(prisma, project.id, req.user));
  });

  app.put('/api/projects/:id/members', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id), 'manage');
    const list = Array.isArray(req.body.members) ? req.body.members : fail(422, 'Danh sách thành viên không hợp lệ');
    const members = [...new Map(list.map(m => [intParam(m.userId, 'Thành viên'), oneOf(m.role || 'MEMBER', MEMBER_ROLES, 'Vai trò')])).entries()];
    if (!members.some(([, role]) => role === 'OWNER')) fail(422, 'Dự án cần ít nhất một chủ dự án (OWNER)', 'NO_OWNER');
    const accounts = await prisma.user.findMany({ where: { id: { in: members.map(([id]) => id) } }, select: { id: true, isActive: true, role: true, isRootAdmin: true } });
    // Quản trị hệ thống không xem nội dung nghiệp vụ: không làm thành viên (Chủ dự án ở dự án MTL thì lại nhận cảnh báo tiến độ phần "PMO").
    if (accounts.some(isItAdmin)) fail(422, 'Tài khoản Quản trị hệ thống không làm thành viên dự án được', 'IT_MEMBER');
    if (accounts.filter(u => u.isActive).length !== members.length) fail(422, 'Có thành viên không tồn tại hoặc đã khoá');
    await prisma.$transaction(async tx => {
      const old = await tx.projectMember.findMany({ where: { projectId: project.id } });
      await tx.projectMember.deleteMany({ where: { projectId: project.id } });
      await tx.projectMember.createMany({ data: members.map(([userId, role]) => ({ projectId: project.id, userId, role })) });
      await audit(req, 'UPDATE_MEMBERS', 'Project', project.id, old.map(m => ({ userId: m.userId, role: m.role })), members.map(([userId, role]) => ({ userId, role })), tx);
    });
    res.json(await projectDetail(prisma, project.id, req.user));
  });

  app.put('/api/projects/:id/approval-steps', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id), 'manage');
    const steps = parseSteps(req.body.steps);
    await checkApprovers(prisma, steps);
    if (steps.length) {
      const states = await prisma.workflowState.findMany({ where: { projectId: project.id } });
      if (!states.some(s => s.category === 'REVIEW')) fail(422, 'Cần có cột thuộc nhóm REVIEW (Chờ duyệt) để bật duyệt', 'MISSING_REVIEW_STATE');
      for (const c of ['STARTED', 'COMPLETED']) if (!states.some(s => s.category === c)) fail(422, `Cần có cột thuộc nhóm ${c === 'STARTED' ? '"Đang thực hiện"' : '"Hoàn thành"'} để bật duyệt`, 'MISSING_CATEGORY');
    }
    await prisma.$transaction(async tx => {
      const old = await tx.approvalStep.findMany({ where: { projectId: project.id }, orderBy: { level: 'asc' } });
      const sig = list => JSON.stringify(list.map(s => [s.level, s.name, s.approverType, s.approverUserId ?? null]));
      const stepsChanged = sig(old) !== sig(steps);
      // Chỉ chặn khi thực sự đổi các bước (người duyệt / số cấp) mà còn yêu cầu đang chờ; đổi mức mặc định thì luôn được.
      // Phiếu của việc đang ở Thùng rác vẫn PENDING (xoá không huỷ phiếu) nên vẫn chặn — nói rõ để người dùng biết vì sao.
      const pending = stepsChanged ? await tx.approvalRequest.findMany({ where: { status: 'PENDING', workItem: { projectId: project.id } }, select: { workItem: { select: { archivedAt: true } } } }) : [];
      const trashed = pending.filter(r => r.workItem.archivedAt).length;
      if (pending.length) fail(409, `Còn ${pending.length} yêu cầu đang chờ duyệt, hãy xử lý xong trước khi đổi các bước duyệt`
        + (trashed ? `. Trong đó ${trashed} yêu cầu của việc đang ở Thùng rác: khôi phục việc để xử lý, hoặc chờ hệ thống xoá hẳn sau 7 ngày` : ''), 'APPROVALS_PENDING');
      if (stepsChanged) {
        await tx.approvalStep.deleteMany({ where: { projectId: project.id } });
        if (steps.length) await tx.approvalStep.createMany({ data: steps.map(s => ({ ...s, projectId: project.id })) });
      }
      if (req.body.defaultApprovalLevels !== undefined) await tx.project.update({ where: { id: project.id }, data: { defaultApprovalLevels: defaultLevelsInput(req.body.defaultApprovalLevels) } });
      await audit(req, 'UPDATE_APPROVAL_STEPS', 'Project', project.id, old, steps, tx);
    });
    res.json(await projectDetail(prisma, project.id, req.user));
  });

  // Quy tắc tự động chọn mức duyệt theo nhãn / ưu tiên (thay toàn bộ danh sách).
  app.put('/api/projects/:id/approval-rules', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id), 'manage');
    const list = Array.isArray(req.body.rules) ? req.body.rules : fail(422, 'Danh sách quy tắc không hợp lệ');
    if (list.length > 20) fail(422, 'Tối đa 20 quy tắc');
    const rules = list.map(r => {
      const labelId = optionalInt(r.labelId, 'Nhãn') ?? null;
      const priority = r.priority ? oneOf(r.priority, ['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NONE'], 'Ưu tiên') : null;
      if (labelId == null && priority == null) fail(422, 'Mỗi quy tắc cần chọn nhãn hoặc mức ưu tiên', 'EMPTY_RULE');
      const levels = Number(r.levels);
      if (!Number.isInteger(levels) || levels < 0 || levels > 5) fail(422, 'Số cấp duyệt của quy tắc không hợp lệ');
      return { labelId, priority, levels };
    });
    const labelIds = [...new Set(rules.filter(r => r.labelId).map(r => r.labelId))];
    if (labelIds.length && (await prisma.label.count({ where: { id: { in: labelIds }, OR: [{ projectId: null }, { projectId: project.id }] } })) !== labelIds.length) fail(422, 'Có nhãn không thuộc dự án', 'INVALID_LABEL');
    await prisma.$transaction(async tx => {
      const old = await tx.approvalRule.findMany({ where: { projectId: project.id } });
      await tx.approvalRule.deleteMany({ where: { projectId: project.id } });
      if (rules.length) await tx.approvalRule.createMany({ data: rules.map(r => ({ ...r, projectId: project.id })) });
      await audit(req, 'UPDATE_APPROVAL_RULES', 'Project', project.id, old, rules, tx);
    });
    res.json(await projectDetail(prisma, project.id, req.user));
  });
};
module.exports.DEFAULT_STATES = DEFAULT_STATES;
module.exports.MTL_STATES = MTL_STATES;
module.exports.categoryLocks = categoryLocks;
