// Kepper — dữ liệu nền dùng chung cho /api/kpi và /api/dashboard của người xem toàn hệ thống (Ban giám đốc).
// Một lần nạp phẳng (việc chưa lưu trữ của dự án đang hoạt động + người được giao + trạng thái + dự án + cán bộ) thay cho hai bộ truy vấn
// riêng của hai route; kết quả giữ trong bộ đệm của services/mtl-cache theo PHIÊN BẢN DỮ LIỆU (tự vô hiệu khi ghi vào WorkItem, WorkItemAssignee,
// WorkflowState, Project, User…; có single-flight). Không phải TTL thuần: khoá có phiên bản nên mục cũ không bao giờ được dùng lại.
// Chỉ phạm vi "toàn hệ thống" (không có điều kiện quyền xem theo người) được đệm; người xem khác đi đường truy vấn riêng như cũ.
// Dữ liệu KHÔNG nằm trong tập theo dõi của bộ đệm (ApprovalAction, Department, Setting) được route đọc lại mỗi lần.
const { visibleProjectsWhere, itemVisibleWhere } = require('./access');

const ROW_SELECT = {
  id: true, number: true, projectId: true, taskType: true, leadDepartmentId: true, dispatchStatus: true, dueDate: true, assignedAt: true, createdAt: true,
  startedAt: true, completedAt: true, rating: true, ratedAt: true, stateId: true,
};
const USER_SELECT = { id: true, fullName: true, displayTitle: true, isActive: true, department: { select: { id: true, name: true } } };
const TERMINAL = new Set(['COMPLETED', 'CANCELLED']);

// Người xem thấy toàn bộ việc của mọi dự án chưa xoá (không có điều kiện theo người) → dùng chung được một tập dữ liệu.
const isSystemWide = user => Object.keys(itemVisibleWhere(user)).length === 0
  && JSON.stringify(visibleProjectsWhere(user)) === JSON.stringify({ deletedAt: null });

async function fetchLive(prisma) {
  // Một đợt song song duy nhất; việc / người được giao của dự án đã lưu trữ hoặc đã xoá được loại trong JS (ít, rẻ hơn nối bảng trong SQL).
  const [projects, states, users, allRows, allAssignees] = await Promise.all([
    prisma.project.findMany({ where: { archivedAt: null, deletedAt: null }, select: { id: true, key: true, name: true, departmentId: true, visibility: true } }),
    prisma.workflowState.findMany({ select: { id: true, category: true } }),
    prisma.user.findMany({ select: USER_SELECT, orderBy: { id: 'asc' } }),
    prisma.workItem.findMany({ where: { archivedAt: null }, orderBy: { id: 'asc' }, select: ROW_SELECT }),
    prisma.workItemAssignee.findMany({ where: { workItem: { archivedAt: null } }, select: { workItemId: true, userId: true } }),
  ]);
  const projectOf = new Map(projects.map(p => [p.id, p]));
  const rows = allRows.filter(r => projectOf.has(r.projectId));
  const rowIds = new Set(rows.map(r => r.id));
  const stateOf = new Map(states.map(s => [s.id, { category: s.category }]));
  const userOf = new Map(users.map(u => [u.id, u]));
  const userIdsOf = new Map(); // workItemId → [userId] theo thứ tự truy vấn
  for (const r of allAssignees) if (rowIds.has(r.workItemId)) (userIdsOf.get(r.workItemId) || userIdsOf.set(r.workItemId, []).get(r.workItemId)).push(r.userId);
  return { rows, projects, stateOf, projectOf, userOf, userIdsOf };
}

// Nạp (hoặc lấy từ bộ đệm) tập dữ liệu nền. Client không qua withMtlCache → luôn đọc thẳng CSDL.
async function loadLive(prisma) {
  const cache = typeof prisma.$mtlCache === 'function' ? prisma.$mtlCache() : null;
  if (!cache) return fetchLive(prisma);
  const key = cache.key(cache.version(), 'kpi-data', 'ALL', 0); // phiên bản đọc TRƯỚC truy vấn: ghi xen giữa → mục mang phiên bản cũ, không dùng lại
  const hit = cache.get(key);
  if (hit) return hit;
  const flying = cache.flight(key);
  if (flying) return flying;
  const loading = fetchLive(prisma);
  cache.fly(key, loading);
  const data = await loading;
  cache.set(key, data);
  return data;
}

// Việc "có thể liên quan đến kỳ" — đúng điều kiện OR của routes/kpi.js loadItems (đến hạn / hoàn thành / được giao / xếp loại trong kỳ, hoặc đang mở).
function inKpiRange(r, category, from, to) {
  const within = d => d != null && d >= from && d <= to;
  return within(r.dueDate) || within(r.completedAt) || within(r.assignedAt) || (r.assignedAt == null && within(r.createdAt)) || within(r.ratedAt) || !TERMINAL.has(category);
}

// Việc cho computeKpi: cùng hình dạng với loadItems của routes/kpi.js. Trả thêm users (cán bộ được giao, sắp theo id).
async function kpiItems(prisma, { from, to }) {
  const data = await loadLive(prisma);
  const range = { gte: from, lte: to };
  const rejects = await prisma.approvalAction.findMany({ where: { decision: 'REJECT', createdAt: range }, select: { createdAt: true, request: { select: { workItemId: true } } } });
  const rejectsOf = new Map();
  for (const r of rejects) { const id = r.request.workItemId; (rejectsOf.get(id) || rejectsOf.set(id, []).get(id)).push(r.createdAt); }
  const items = [], userIds = new Set();
  for (const r of data.rows) {
    const state = data.stateOf.get(r.stateId);
    if (!inKpiRange(r, state?.category, from, to)) continue;
    const ids = data.userIdsOf.get(r.id);
    for (const id of ids || []) userIds.add(id);
    items.push({
      id: r.id, taskType: r.taskType, leadDepartmentId: r.leadDepartmentId, dueDate: r.dueDate, assignedAt: r.assignedAt, createdAt: r.createdAt,
      startedAt: r.startedAt, completedAt: r.completedAt, rating: r.rating, ratedAt: r.ratedAt,
      state, project: { departmentId: data.projectOf.get(r.projectId)?.departmentId },
      assignees: ids ? ids.map(userId => ({ userId })) : [], rejectionDates: rejectsOf.get(r.id) || [],
    });
  }
  const users = [...userIds].sort((a, b) => a - b).map(id => data.userOf.get(id)).filter(Boolean);
  return { items, users };
}

// Việc cho summarize() của dashboard (mọi việc chưa lưu trữ của dự án đang hoạt động) + danh sách dự án.
async function dashboardItems(prisma) {
  const data = await loadLive(prisma);
  const items = data.rows.map(r => ({
    ...r, state: data.stateOf.get(r.stateId), project: { key: data.projectOf.get(r.projectId)?.key, departmentId: data.projectOf.get(r.projectId)?.departmentId },
    assignees: (data.userIdsOf.get(r.id) || []).map(id => ({ user: { id, fullName: data.userOf.get(id)?.fullName } })),
  }));
  return { items, projects: data.projects };
}

module.exports = { isSystemWide, loadLive, kpiItems, dashboardItems, USER_SELECT };
