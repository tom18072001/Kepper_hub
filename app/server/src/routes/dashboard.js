// Dashboard: số liệu tiến độ, khối lượng việc, số liệu dòng chảy (throughput, cycle time, việc tồn lâu).
// Phòng ban của việc = đơn vị chủ trì ?? phòng sở hữu dự án / sổ (services/stats.js).
const { fail, optionalInt } = require('../lib/http');
const { visibleProjectsWhere, itemVisibleWhere, dashboardScope } = require('../services/access');
const { permissionScope } = require('../lib/permissions');
const { departmentOf, departmentWhere, isOpen, isOverdue, vnDay } = require('../services/stats');

const DAY = 86_400_000;
function weekStart(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // Thứ 2 = 0
  return new Date(d.getTime() - dow * DAY);
}
function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const round1 = n => n == null ? null : Math.round(n * 10) / 10;
const TASK_TYPES = ['PLAN', 'ADHOC'];

function summarize(items, { now = new Date(), departments = [], projects = [] } = {}) {
  const open = items.filter(isOpen);
  const byCategory = {};
  for (const i of items) byCategory[i.state.category] = (byCategory[i.state.category] || 0) + 1;
  const overdue = open.filter(i => isOverdue(i, now));
  const today = vnDay(now);
  const dueSoon = open.filter(i => i.dueDate && vnDay(i.dueDate) >= today && vnDay(i.dueDate) < today + 7);
  const brief = i => ({ id: i.id, projectId: i.projectId, code: `${i.project.key}-${i.number}`, title: i.title, dueDate: i.dueDate });

  const workloadMap = new Map();
  for (const i of open) for (const a of i.assignees.length ? i.assignees.map(x => x.user) : [{ id: 0, fullName: 'Chưa giao' }]) {
    const w = workloadMap.get(a.id) || { userId: a.id, fullName: a.fullName, open: 0, overdue: 0, inProgress: 0 };
    w.open++; if (isOverdue(i, now)) w.overdue++; if (i.state.category === 'STARTED') w.inProgress++;
    workloadMap.set(a.id, w);
  }
  const thisWeek = weekStart(now);
  const throughput = Array.from({ length: 8 }, (_, k) => {
    const from = new Date(thisWeek.getTime() - (7 - k) * 7 * DAY), to = new Date(from.getTime() + 7 * DAY);
    return { week: from.toISOString().slice(0, 10), completed: items.filter(i => i.state.category === 'COMPLETED' && i.completedAt && i.completedAt >= from && i.completedAt < to).length };
  });
  const recent = items.filter(i => i.state.category === 'COMPLETED' && i.completedAt && i.startedAt && now - i.completedAt <= 30 * DAY && i.completedAt >= i.startedAt);
  const cycle = recent.map(i => (i.completedAt - i.startedAt) / DAY);
  const aging = open.filter(i => i.state.category === 'STARTED' && i.startedAt)
    .map(i => ({ id: i.id, projectId: i.projectId, code: `${i.project.key}-${i.number}`, title: i.title, days: Math.floor((now - i.startedAt) / DAY) }))
    .filter(i => i.days >= 7).sort((a, b) => b.days - a.days).slice(0, 10);
  const counts = own => {
    const ownOpen = own.filter(isOpen);
    return { total: own.length, open: ownOpen.length, completed: own.filter(i => i.state.category === 'COMPLETED').length,
      overdue: ownOpen.filter(i => isOverdue(i, now)).length, pendingAccept: ownOpen.filter(i => i.dispatchStatus === 'PENDING').length };
  };
  const group = (key, list, nameOf, extra = () => ({})) => list.map(entry => ({ id: entry.id, name: nameOf(entry), ...extra(entry), ...counts(items.filter(i => key(i) === entry.id)) }))
    .filter(r => r.total > 0);

  return {
    totals: { total: items.length, open: open.length, completed: byCategory.COMPLETED || 0, overdue: overdue.length, dueSoon: dueSoon.length, inReview: byCategory.REVIEW || 0,
      pendingAccept: open.filter(i => i.dispatchStatus === 'PENDING').length },
    byCategory, throughput,
    cycleTime: { samples: cycle.length, avgDays: round1(cycle.length ? cycle.reduce((a, b) => a + b, 0) / cycle.length : null), medianDays: round1(median(cycle)) },
    workload: [...workloadMap.values()].sort((a, b) => b.open - a.open).slice(0, 20),
    aging,
    byTaskType: Object.fromEntries(TASK_TYPES.map(t => [t, counts(items.filter(i => (i.taskType === 'PLAN' ? 'PLAN' : 'ADHOC') === t))])),
    byDepartment: group(departmentOf, departments, d => d.name).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    byProject: group(i => i.projectId, projects, p => `${p.key} · ${p.name}`, p => ({ visibility: p.visibility || null })),
    overdueItems: overdue.sort((a, b) => a.dueDate - b.dueDate).slice(0, 10).map(brief),
    dueSoonItems: dueSoon.sort((a, b) => a.dueDate - b.dueDate).slice(0, 10).map(brief),
  };
}

module.exports = function mountDashboard(app, { prisma, auth }) {
  app.get('/api/dashboard', auth, async (req, res) => {
    const scope = dashboardScope(req.user);
    if (!scope) fail(403, 'Không đủ quyền xem dashboard', 'FORBIDDEN');
    const departmentId = optionalInt(req.query.departmentId, 'Phòng ban');
    const projectId = optionalInt(req.query.projectId, 'Dự án');
    const projectWhere = { ...visibleProjectsWhere(req.user), archivedAt: null };
    if (projectId) projectWhere.id = projectId;
    const projects = await prisma.project.findMany({ where: projectWhere, select: { id: true, key: true, name: true, departmentId: true, visibility: true } });
    // Phạm vi UNIT ("phòng ban của tôi"): việc phòng tôi chủ trì, hoặc không có đơn vị chủ trì mà dự án thuộc phòng tôi.
    // Luôn chỉ đếm việc người xem thấy được (itemVisibleWhere + visibleProjectsWhere).
    const unit = scope === 'UNIT' ? (req.user.departmentId ?? -1) : departmentId;
    const items = await prisma.workItem.findMany({
      where: { archivedAt: null, projectId: { in: projects.map(p => p.id) }, AND: [itemVisibleWhere(req.user), ...(unit != null ? [departmentWhere(unit)] : [])] },
      select: { id: true, number: true, title: true, projectId: true, dueDate: true, startedAt: true, completedAt: true, taskType: true, leadDepartmentId: true, dispatchStatus: true,
        project: { select: { key: true, departmentId: true } }, state: { select: { category: true } },
        assignees: { select: { user: { select: { id: true, fullName: true } } } } },
    });
    const deptIds = [...new Set(items.map(departmentOf).filter(id => id != null))];
    const departments = await prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } });
    const pendingApprovals = items.length ? await prisma.approvalRequest.count({ where: { status: 'PENDING', workItemId: { in: items.map(i => i.id) } } }) : 0;
    const summary = summarize(items, { departments, projects });
    // Khối lượng việc theo TÊN từng người là dữ liệu cá nhân: chỉ người có quyền duyệt (trưởng phòng trở lên) mới xem.
    const peopleVisible = !!permissionScope(req.user, 'work.approve', 'OPERATE');
    if (!peopleVisible) summary.workload = [];
    res.json({ scope, departmentId: scope === 'UNIT' ? req.user.departmentId ?? null : departmentId, generatedAt: new Date(), pendingApprovals, peopleVisible, ...summary });
  });
};
module.exports.summarize = summarize;
