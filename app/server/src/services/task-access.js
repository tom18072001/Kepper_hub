// PHÂN QUYỀN TỐI THIỂU TRÊN MỘT VIỆC — một nguồn quyền duy nhất ở máy chủ (bảng chủ dự án chốt 20/11/2026).
// Nguyên tắc: kế hoạch là chỉ đạo của Ban Tổng Giám đốc qua người giao; ai làm phần nào thì chỉ thấy và sửa phần đó.
//
// Vai của người dùng trên MỘT việc:
//   A  người giao (assignedById)
//   B  BTGĐ phụ trách của việc: thành viên Ban Tổng Giám đốc (vai) có phạm vi phụ trách "Toàn công ty" (User.boardAll) — mọi việc;
//      hoặc phụ trách bộ phận chủ trì của việc (Department.supervisorId) — chỉ việc do bộ phận đó chủ trì
//      (lib/permissions.js; hệ quy chiếu một trục vai, chủ dự án duyệt 24/11/2026).
//      Riêng duyệt gia hạn: việc chưa có B nào → mọi thành viên Ban Tổng Giám đốc (extensionDeciderIds).
//   L  người chủ trì · S  người phối hợp
//   D  lãnh đạo bộ phận chủ trì (Dl) hoặc lãnh đạo phòng của người chủ trì — xem toàn bộ, không sửa kế hoạch
//   O  chủ dự án (người quản lý dự án, thành viên vai OWNER, người đứng tên dự án) và thành viên BTGĐ — xem đầy đủ, bình luận
//   U  thành viên dự án không thuộc các vai trên — chỉ xem TÓM TẮT (tên, người chủ trì, hạn, trạng thái, %)
//
// taskCapabilities() là hàm THUẦN (không chạm CSDL, test ma trận trong task-access.test.js). Route nạp ngữ cảnh bằng loadTask()
// rồi kiểm bằng assertCap(); payload chi tiết việc trả `capabilities` để giao diện chỉ dựng ô nhập / nút khi có quyền.
const { fail } = require('../lib/http');
const { isItAdmin, isBoard, isDeptApprover, DEPT_APPROVER_WHERE, NOT_IT_WHERE } = require('../lib/permissions');

// ---------- Trường của việc theo phần ----------
// Kế hoạch: A, B (việc chưa có người giao: chỉ B).
const PLAN_FIELDS = ['title', 'descriptionHtml', 'deliverable', 'note', 'priority', 'dueDate', 'startDate', 'critical', 'milestone', 'milestoneNote',
  'source', 'assignedAt', 'labelIds', 'coordinatorText', 'supportDepartmentIds', 'internalDueDate', 'taskType', 'leadDepartmentId', 'parentId',
  'cycleId', 'estimate', 'weight', 'planCode', 'planSection', 'ownerText', 'externalParty', 'period', 'location', 'budget', 'supervisorText', 'refCode'];
// Tiến độ: L (báo cáo tiến độ, %, khó khăn / kiến nghị, dự báo hoàn thành).
const PROGRESS_FIELDS = ['progress', 'forecastEnd', 'resultNote'];
// Sản phẩm bên thực hiện ghi bằng chữ: L, S.
const BACK_FIELDS = ['outputs'];
const ASSIGN_FIELDS = ['assigneeIds', 'supporterIds'];
// Trường không còn ghi qua PATCH: ô "Đánh giá của người giao" viết tay đã bỏ (đánh giá = mức chấm + nhận xét lúc duyệt).
const REMOVED_FIELDS = ['review'];

const CLOSED = ['COMPLETED', 'CANCELLED'];
// Người chủ trì: Chưa bắt đầu → Đang thực hiện → Gửi duyệt (Hoàn thành khi chưa duyệt = vào "Chờ duyệt").
const WORK_FROM = ['BACKLOG', 'UNSTARTED', 'STARTED'];
const WORK_TO = ['BACKLOG', 'UNSTARTED', 'STARTED', 'REVIEW', 'COMPLETED'];

const MESSAGES = {
  view: 'Bạn chỉ xem được tóm tắt việc này (tên, người chủ trì, hạn, trạng thái, %)',
  plan: 'Kế hoạch của việc (tên, mô tả, hạn, mốc, đường găng, ưu tiên, nguồn, nhãn, kế hoạch gốc…) do người giao hoặc Ban Tổng Giám đốc sửa',
  assign: 'Chỉ người giao hoặc Ban Tổng Giám đốc đổi người chủ trì / người phối hợp',
  assignOwnDept: 'Lãnh đạo bộ phận chủ trì chỉ chọn người trong phòng mình cho bước giao cho bộ phận mà chưa có người',
  assigner: 'Chỉ người giao (chuyển giao) hoặc Ban Tổng Giám đốc đổi người giao',
  selfAssigner: 'Không tự nhận làm người giao của việc chưa có người giao',
  delete: 'Chỉ người giao hoặc Ban Tổng Giám đốc xoá việc',
  recur: 'Chỉ người giao hoặc Ban Tổng Giám đốc đặt lặp lại việc',
  state: 'Bạn không đổi được trạng thái này — người chủ trì: Chưa bắt đầu → Đang thực hiện → Gửi duyệt; người giao / Ban Tổng Giám đốc: duyệt hoàn thành (qua phiếu duyệt), tạm dừng, huỷ, mở lại',
  progress: 'Tiến độ, khó khăn, kiến nghị, dự báo hoàn thành do người chủ trì cập nhật',
  submit: 'Chỉ người chủ trì gửi duyệt / nộp sản phẩm',
  extension: 'Chỉ người chủ trì đề nghị gia hạn',
  decideExtension: 'Chỉ BTGĐ phụ trách của việc (phụ trách Toàn công ty, Phó TGĐ phụ trách bộ phận chủ trì) duyệt đề nghị gia hạn; việc chưa có BTGĐ phụ trách thì thành viên Ban Tổng Giám đốc nào cũng duyệt được',
  children: 'Chỉ người chủ trì, người giao hoặc Ban Tổng Giám đốc tạo việc nhánh',
  comment: 'Chỉ người liên quan đến việc (người giao, Ban Tổng Giám đốc, chủ trì, phối hợp, lãnh đạo bộ phận, chủ dự án / PMO) bình luận',
  docsGive: 'Văn bản "Căn cứ giao việc" và tài liệu bên giao do người giao hoặc Ban Tổng Giám đốc gửi',
  docsBack: 'Sản phẩm, tài liệu bên thực hiện do người chủ trì / người phối hợp gửi',
  deleteFile: 'Chỉ người đã gửi tệp / văn bản này được xoá',
  answer: 'Chỉ người giao, Ban Tổng Giám đốc hoặc lãnh đạo bộ phận chủ trì trả lời kiến nghị',
  forward: 'Chỉ lãnh đạo bộ phận chủ trì trình kiến nghị lên Ban Tổng Giám đốc',
  supportStaff: 'Chỉ lãnh đạo phòng phối hợp được cử cán bộ phối hợp',
  approvalLevels: 'Chỉ Ban Tổng Giám đốc hoặc người quản lý dự án đổi mức duyệt của việc',
  completedAt: 'Chỉ người giao hoặc Ban Tổng Giám đốc sửa ngày hoàn thành thực tế',
  rebaseline: 'Chỉ người giao hoặc Ban Tổng Giám đốc điều chỉnh kế hoạch gốc',
  review: 'Ô "Đánh giá của người giao" viết tay đã bỏ — đánh giá là mức chấm và nhận xét khi duyệt hoàn thành',
};

const has = (list, id) => id != null && (list || []).some(x => Number(x) === Number(id));
const uniq = list => [...new Set(list.filter(x => x != null).map(Number))];

// ---------- Người quyết định đề nghị gia hạn ----------
// BTGĐ phụ trách của việc (vai B): phụ trách Toàn công ty + Phó TGĐ phụ trách bộ phận chủ trì. orgContext chỉ giữ người đang hoạt động
// còn vai BTGĐ: Phó TGĐ đã khoá / đổi vai không được tính, Quản trị hệ thống không bao giờ có.
function boardInChargeIds(ctx = {}) { return uniq([...(ctx.topIds || []), ctx.supervisorId]); }
// Người quyết định đề nghị gia hạn = BTGĐ phụ trách của việc. Việc chưa có BTGĐ phụ trách nào (chưa ai phụ trách Toàn công ty, bộ phận chủ trì
// chưa có Phó TGĐ phụ trách) → mọi thành viên Ban Tổng Giám đốc đang hoạt động (ctx.boardIds), dự phòng như cấp duyệt "BTGĐ phụ trách"
// (services/approval.js) để đề nghị không treo. MỘT danh sách cho quyền decideExtension, người nhận thông báo (routes/dispatch.js) và nút
// ở hàng chờ (routes/approvals.js). Dự phòng chỉ áp cho gia hạn: kế hoạch, giao người, xoá… vẫn theo vai B.
function extensionDeciderIds(ctx = {}) {
  const inCharge = boardInChargeIds(ctx);
  return inCharge.length ? inCharge : uniq(ctx.boardIds || []);
}

// ---------- Hàm quyền thuần ----------
// user: { id, role, isRootAdmin }
// item: { id, assignedById, reporterId, assigneeIds[], supporterIds[], category, archivedAt, dispatchStatus, parentId }
// ctx:  { project: { kind, visibility, leadId }, rights: { canView, canEdit, canManage, delegated }, memberRole,
//         topIds[], supervisorId, boardIds[] (mọi thành viên BTGĐ đang hoạt động — dự phòng duyệt gia hạn),
//         leadDeptId (phòng chủ trì của cây việc, null = không giao cho bộ phận), leadLeaderIds[],
//         staffLeaderIds[] (lãnh đạo phòng của người chủ trì), supportLeaderIds[] (lãnh đạo phòng phối hợp), approver }
function rolesOf(user, item, ctx = {}) {
  const uid = user?.id;
  const r = ctx.rights || {};
  const A = item.assignedById != null && Number(item.assignedById) === Number(uid);
  const B = has(ctx.topIds, uid) || (ctx.supervisorId != null && Number(ctx.supervisorId) === Number(uid));
  const L = has(item.assigneeIds, uid);
  const S = !L && has(item.supporterIds, uid);
  const Dl = has(ctx.leadLeaderIds, uid);
  // Lãnh đạo phòng của người chủ trì (không tính chính người chủ trì — vai director được xem là lãnh đạo phòng của mình).
  const D = Dl || (!L && has(ctx.staffLeaderIds, uid));
  const SL = has(ctx.supportLeaderIds, uid);
  const O = !!r.canManage || ctx.memberRole === 'OWNER' || (ctx.project?.leadId != null && Number(ctx.project.leadId) === Number(uid)) || isBoard(user);
  return { A, B, L, S, D, Dl, SL, O };
}

function emptyCaps(view) {
  return {
    roles: [], view, leadLeader: false, plan: false, assign: false, assignOwnDept: false, assigner: false, delete: false, recur: false, state: null,
    progress: false, submit: false, extension: false, decideExtension: false, children: false, comment: false, docsGive: false, docsBack: false,
    deleteOwnFiles: false, answer: false, forward: false, supportStaff: false, approvalLevels: false, completedAt: false, rebaseline: false,
    fields: fieldMap(false, false, false),
  };
}
function fieldMap(plan, progress, back) {
  return { ...Object.fromEntries(PLAN_FIELDS.map(k => [k, plan])), ...Object.fromEntries(PROGRESS_FIELDS.map(k => [k, progress])), ...Object.fromEntries(BACK_FIELDS.map(k => [k, back])), review: false };
}

function taskCapabilities(user, item, ctx = {}) {
  const r = ctx.rights || {};
  if (!user || isItAdmin(user) || !r.canView) return emptyCaps('NONE');
  const { A, B, L, S, D, Dl, SL, O } = rolesOf(user, item, ctx);
  const roles = [A && 'A', B && 'B', L && 'L', S && 'S', D && 'D', O && 'O'].filter(Boolean);
  const related = A || B || L || S || D || O;
  // Người nhập việc, người duyệt (đang / đã duyệt), người duyệt thay theo uỷ quyền: xem đầy đủ, không sửa.
  const full = related || SL || (item.reporterId != null && Number(item.reporterId) === Number(user.id)) || !!ctx.approver || !!r.delegated;
  const caps = emptyCaps(full ? 'FULL' : 'SUMMARY');
  caps.roles = roles.length ? roles : ['U'];
  caps.leadLeader = Dl; // lãnh đạo bộ phận chủ trì (tiếp nhận bước giao cho bộ phận, kiến nghị)
  if (!full) return caps;
  const write = !!r.canEdit && !r.delegated;
  const live = write && !item.archivedAt;
  const open = live && !CLOSED.includes(item.category);
  const boss = A || B; // kế hoạch là chỉ đạo của Ban Tổng Giám đốc qua người giao
  const plan = live && boss;
  Object.assign(caps, {
    plan,
    assign: plan,
    // Bước giao cho bộ phận mà chưa có người: lãnh đạo bộ phận chủ trì chọn người trong phòng mình (không sửa kế hoạch).
    assignOwnDept: !plan && open && Dl && ctx.leadDeptId != null && !(item.assigneeIds || []).length,
    assigner: plan,
    delete: write && boss,
    recur: plan,
    state: live && boss ? 'ALL' : open && L ? 'WORK' : null,
    progress: open && L,
    submit: open && L, // gửi duyệt là bước của người chủ trì (người giao / BTGĐ duyệt, tạm dừng, huỷ, mở lại)
    extension: open && L,
    decideExtension: write && has(extensionDeciderIds(ctx), user.id), // B; việc chưa có BTGĐ phụ trách → mọi thành viên BTGĐ
    children: (live && boss) || (open && L),
    comment: write && (related || SL),
    docsGive: live && boss,
    docsBack: live && (L || S),
    deleteOwnFiles: write,
    answer: write && (boss || Dl),
    forward: write && Dl && !boss,
    supportStaff: open && SL,
    approvalLevels: live && (B || !!r.canManage),
    completedAt: live && boss && item.category === 'COMPLETED',
    rebaseline: plan && ctx.project?.kind === 'MTL',
    fields: fieldMap(plan, open && L, live && (L || S)),
  });
  return caps;
}

// Đổi trạng thái: người chủ trì trong nhóm đang làm và GỬI DUYỆT (vào "Chờ duyệt" / chọn "Hoàn thành" khi chưa duyệt);
// người giao / Ban Tổng Giám đốc: duyệt (qua phiếu), tạm dừng, huỷ, mở lại — không gửi duyệt thay người chủ trì.
const SUBMIT_TO = ['REVIEW', 'COMPLETED'];
function canMove(caps, fromCategory, toCategory) {
  if (!caps?.state) return false;
  if (fromCategory !== toCategory && SUBMIT_TO.includes(toCategory) && !caps.submit) return false;
  if (caps.state === 'ALL') return true;
  if (fromCategory === toCategory) return WORK_FROM.includes(fromCategory);
  return WORK_FROM.includes(fromCategory) && WORK_TO.includes(toCategory);
}

// Quyền cần cho từng khoá của PATCH /api/items/:id (chỉ khoá thực sự đổi giá trị).
function capForField(key) {
  if (PLAN_FIELDS.includes(key)) return 'plan';
  if (PROGRESS_FIELDS.includes(key)) return 'progress';
  if (BACK_FIELDS.includes(key)) return 'docsBack';
  if (ASSIGN_FIELDS.includes(key)) return 'assign';
  if (REMOVED_FIELDS.includes(key)) return 'review';
  if (key === 'assignedById') return 'assigner';
  if (key === 'approvalLevels') return 'approvalLevels';
  if (key === 'completedAt') return 'completedAt';
  return null; // stateId kiểm riêng (canMove); khoá lạ bị bỏ qua như trước
}

function assertCap(caps, cap, message) {
  const ok = cap === 'state' ? !!caps?.state : cap === 'view' ? caps?.view === 'FULL' : !!caps?.[cap];
  if (!ok) {
    if (cap === 'review') fail(422, MESSAGES.review, 'REVIEW_REMOVED');
    fail(403, message || MESSAGES[cap] || 'Bạn không có quyền với phần này của việc', cap === 'view' ? 'SUMMARY_ONLY' : 'FORBIDDEN');
  }
}
function assertMove(caps, fromCategory, toCategory) {
  if (!canMove(caps, fromCategory, toCategory)) fail(403, MESSAGES.state, 'STATE_FORBIDDEN');
}

// ---------- Nạp ngữ cảnh từ CSDL ----------
// Ngữ cảnh tổ chức (nạp một lần cho cả danh sách): BTGĐ phụ trách toàn công ty, Phó TGĐ phụ trách từng phòng, lãnh đạo từng phòng
// (kể cả uỷ quyền), phòng của từng người.
async function orgContext(db, now = new Date()) {
  const [depts, approvers, delegations, active] = await Promise.all([
    db.department.findMany({ select: { id: true, supervisorId: true } }),
    db.user.findMany({ where: { ...DEPT_APPROVER_WHERE, isActive: true } }),
    db.delegation.findMany({ where: { revokedAt: null, startsAt: { lte: now }, endsAt: { gte: now } }, select: { fromUserId: true, toUserId: true } }),
    db.user.findMany({ where: { isActive: true, ...NOT_IT_WHERE }, select: { id: true, departmentId: true, boardAll: true, role: true, isRootAdmin: true } }),
  ]);
  const activeIds = new Set(active.map(u => u.id));
  const boardIds = new Set(active.filter(isBoard).map(u => u.id)); // phạm vi phụ trách chỉ có nghĩa với vai BTGĐ
  const deptOf = new Map(active.map(u => [u.id, u.departmentId]));
  const supervisor = new Map(depts.filter(d => d.supervisorId != null && boardIds.has(d.supervisorId)).map(d => [d.id, d.supervisorId]));
  const byDept = new Map();
  for (const u of approvers) {
    if (!isDeptApprover(u)) continue;
    if (!byDept.has(u.departmentId)) byDept.set(u.departmentId, []);
    byDept.get(u.departmentId).push(u.id);
  }
  const leaderCache = new Map();
  const leaders = deptId => {
    if (deptId == null) return [];
    if (!leaderCache.has(deptId)) {
      const own = byDept.get(Number(deptId)) || [];
      leaderCache.set(deptId, uniq([...own, ...delegations.filter(d => own.includes(d.fromUserId)).map(d => d.toUserId)]));
    }
    return leaderCache.get(deptId);
  };
  // BTGĐ phụ trách Toàn công ty: chỉ tài khoản vai BTGĐ đang hoạt động. boardIds: mọi thành viên BTGĐ đang hoạt động (dự phòng duyệt gia hạn).
  return { topIds: active.filter(u => u.boardAll && boardIds.has(u.id)).map(u => u.id), boardIds: [...boardIds], supervisor, leaders, deptOf };
}

// Ngữ cảnh của MỘT việc (đồng bộ, dùng lại orgContext). chain = tổ tiên [cha, ông, …] (để lấy phòng chủ trì kế thừa).
function itemContext(org, { project, rights, member, item, chain = [], approver = false }) {
  const leadDeptId = item.leadDepartmentId ?? chain.find(a => a.leadDepartmentId != null)?.leadDepartmentId ?? null;
  const dept = leadDeptId ?? project.departmentId ?? null; // dự án thường: phòng của dự án là phòng chủ trì
  return {
    project: { kind: project.kind, visibility: project.visibility, leadId: project.leadId ?? null }, rights: rights || {}, memberRole: member?.role ?? null,
    topIds: org.topIds, supervisorId: dept != null ? org.supervisor.get(dept) ?? null : null, boardIds: org.boardIds || [],
    leadDeptId, leadLeaderIds: org.leaders(dept),
    staffLeaderIds: uniq((item.assigneeIds || []).flatMap(id => org.leaders(org.deptOf.get(id)))),
    supportLeaderIds: uniq((item.supportDepartmentIds || []).flatMap(d => org.leaders(d))),
    approver,
  };
}

const TASK_SELECT = { id: true, projectId: true, parentId: true, number: true, title: true, assignedById: true, reporterId: true, leadDepartmentId: true,
  dispatchStatus: true, archivedAt: true, state: { select: { category: true } }, assignees: { select: { userId: true } }, supporters: { select: { userId: true } },
  supportDepartments: { select: { departmentId: true } } };
// Chuẩn hoá một bản ghi WorkItem (đã include assignees / supporters / supportDepartments / state) về dạng hàm quyền dùng.
function taskOf(row) {
  const ids = list => (list || []).map(a => a.userId ?? a.user?.id ?? a.id).filter(x => x != null);
  return { id: row.id, projectId: row.projectId, parentId: row.parentId ?? null, assignedById: row.assignedById ?? null, reporterId: row.reporterId ?? null,
    leadDepartmentId: row.leadDepartmentId ?? null, dispatchStatus: row.dispatchStatus ?? null, archivedAt: row.archivedAt ?? null,
    category: row.state?.category ?? row.category ?? null, assigneeIds: ids(row.assignees), supporterIds: ids(row.supporters),
    supportDepartmentIds: (row.supportDepartments || []).map(d => d.departmentId ?? d.id).filter(x => x != null) };
}

// Người duyệt của việc (đang ở cấp mình hoặc đã từng duyệt / trả lại): xem đầy đủ để duyệt.
async function isApprover(db, user, project, itemId) {
  if (await db.approvalAction.count({ where: { actorId: user.id, decision: { in: ['APPROVE', 'REJECT'] }, request: { workItemId: itemId } } })) return true;
  const pending = await db.approvalRequest.findFirst({ where: { workItemId: itemId, status: 'PENDING' }, include: { workItem: { include: { assignees: true } }, actions: { select: { actorId: true, decision: true, level: true } } } });
  if (!pending) return false;
  return require('./approval').canAct(db, user, project, pending, pending.workItem);
}

// Tổ tiên [cha, ông, …] để lấy bộ phận chủ trì kế thừa — chỉ đọc khi việc không ghi bộ phận chủ trì.
async function leadChain(db, task) {
  return task.leadDepartmentId == null && task.parentId ? require('./tree').ancestors(db, task.parentId, { leadDepartmentId: true }) : [];
}

// Nạp việc + quyền: loadItem (quyền xem theo dự án / sổ) rồi tính capabilities. Trả { project, member, rights, task, caps, org, ctx }
// (ctx = ngữ cảnh của việc đã dùng để tính quyền — route dùng lại, vd. người nhận đề nghị gia hạn).
async function loadTask(db, user, itemId, { need = 'view', org = null } = {}) {
  const { loadItem } = require('./access');
  const base = await loadItem(db, user, itemId, 'view');
  const row = await db.workItem.findUnique({ where: { id: itemId }, select: TASK_SELECT });
  const task = taskOf(row);
  const chain = await leadChain(db, task);
  const o = org || await orgContext(db);
  const approver = !base.rights.delegated && await isApprover(db, user, base.project, itemId);
  const ctx = itemContext(o, { project: base.project, rights: base.rights, member: base.member, item: task, chain, approver });
  const caps = taskCapabilities(user, task, ctx);
  if (need !== 'view') assertCap(caps, need);
  return { ...base, task, caps, org: o, ctx };
}

// Quyền nhẹ cho từng thẻ trong danh sách (không xét người duyệt): { view, state }.
function listCaps(user, org, { project, rights, member }, row) {
  const task = taskOf(row);
  const caps = taskCapabilities(user, task, itemContext(org, { project, rights, member, item: task }));
  return { view: caps.view, state: caps.state, submit: caps.submit, progress: caps.progress, children: caps.children, roles: caps.roles };
}

module.exports = {
  PLAN_FIELDS, PROGRESS_FIELDS, BACK_FIELDS, ASSIGN_FIELDS, REMOVED_FIELDS, WORK_FROM, WORK_TO, MESSAGES, TASK_SELECT,
  rolesOf, taskCapabilities, canMove, capForField, assertCap, assertMove, extensionDeciderIds,
  orgContext, itemContext, taskOf, isApprover, leadChain, loadTask, listCaps,
};
