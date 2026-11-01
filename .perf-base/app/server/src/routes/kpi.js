// KPI theo phòng ban và theo cá nhân trong một kỳ (mặc định: tháng hiện tại, giờ Việt Nam) + KPI của chính mình.
// Số liệu theo người là dữ liệu cá nhân: KPI phòng / cá nhân chỉ quyền reports.kpi (ban giám đốc); mỗi cán bộ xem được số liệu của mình.
// Dùng để tham khảo, chưa gắn lương thưởng.
const { fail, optionalInt, optionalDate } = require('../lib/http');
const { permissionScope, isItAdmin } = require('../lib/permissions');
const { visibleProjectsWhere, itemVisibleWhere } = require('../services/access');
const { getSettings } = require('../services/register');
const S = require('../services/stats');

const DAY = S.DAY;
const KPI_SELECT = {
  id: true, taskType: true, leadDepartmentId: true, dueDate: true, assignedAt: true, createdAt: true, startedAt: true, completedAt: true,
  rating: true, ratedAt: true, state: { select: { category: true } }, project: { select: { departmentId: true } },
  assignees: { select: { userId: true } },
};

// Việc có thể liên quan đến kỳ: đến hạn / hoàn thành / được giao / được xếp loại trong kỳ, hoặc đang mở.
async function loadItems(prisma, { from, to, where = [] }) {
  const range = { gte: from, lte: to };
  const items = await prisma.workItem.findMany({
    where: { archivedAt: null, project: { archivedAt: null, deletedAt: null },
      AND: [...where, { OR: [{ dueDate: range }, { completedAt: range }, { assignedAt: range }, { assignedAt: null, createdAt: range }, { ratedAt: range },
        { state: { category: { notIn: ['COMPLETED', 'CANCELLED'] } } }] }] },
    select: { ...KPI_SELECT, approvals: { select: { actions: { where: { decision: 'REJECT', createdAt: range }, select: { createdAt: true } } } } },
  });
  for (const i of items) { i.rejectionDates = i.approvals.flatMap(r => r.actions.map(a => a.createdAt)); delete i.approvals; }
  return items;
}
const userRow = u => ({ id: u.id, fullName: u.fullName, displayTitle: u.displayTitle, isActive: u.isActive, departmentId: u.department?.id ?? null, departmentName: u.department?.name || '—' });
const USER_SELECT = { id: true, fullName: true, displayTitle: true, isActive: true, department: { select: { id: true, name: true } } };

function rangeOf(query, now) {
  const def = S.vnPeriod(now, 'month');
  const day = (value, label) => (value ? S.vnDayStart(value) || optionalDate(value, label) : null);
  const from = day(query.from, 'Từ ngày') || def.from;
  const to = query.to ? S.endOfLocalDay(day(query.to, 'Đến ngày')) : def.to;
  if (to < from || to - from > 400 * DAY) fail(422, 'Khoảng thời gian không hợp lệ (tối đa ~13 tháng)');
  return { from, to };
}

module.exports = function mountKpi(app, { prisma, auth, audit }) {
  app.get('/api/kpi', auth, async (req, res) => {
    if (permissionScope(req.user, 'reports.kpi', 'VIEW') !== 'SYSTEM') fail(403, 'Chỉ Ban giám đốc được xem KPI', 'FORBIDDEN');
    const now = new Date();
    const { from, to } = rangeOf(req.query, now);
    const departmentId = optionalInt(req.query.departmentId, 'Phòng ban');
    const { kpiWeights } = await getSettings(prisma);
    const weights = S.normalizeWeights(kpiWeights);

    // Tôn trọng quyền xem: chỉ đếm việc người xem thấy được (Ban giám đốc: toàn bộ).
    const items = await loadItems(prisma, { from, to, where: [{ project: visibleProjectsWhere(req.user) }, itemVisibleWhere(req.user)] });
    const departments = await prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const userIds = [...new Set(items.flatMap(i => i.assignees.map(a => a.userId)))];
    const users = (await prisma.user.findMany({ where: { id: { in: userIds } }, select: USER_SELECT })).map(userRow);
    // Tính trên toàn bộ rồi mới lọc phòng: điểm khối lượng cần bình quân của cả phòng / các phòng.
    const kpi = S.computeKpi(items, { users, departments, from, to, now, weights });
    const byDepartment = departmentId ? kpi.byDepartment.filter(r => r.id === departmentId) : kpi.byDepartment;
    const byPerson = departmentId ? kpi.byPerson.filter(r => r.departmentId === departmentId) : kpi.byPerson;
    const total = departmentId ? S.metrics(items.filter(i => S.inDepartment(i, departmentId) && S.relevant(i, { from, to })), { from, to, now }) : kpi.total;

    // Xem số liệu cá nhân là thao tác trên dữ liệu cá nhân → ghi nhật ký (không ghi số liệu).
    await audit(req, 'VIEW_KPI', 'Kpi', null, null, { from, to, departmentId: departmentId ?? null, people: byPerson.length });
    res.json({ from, to, generatedAt: now, weights, ratingPoints: S.RATING_POINTS, minPeers: S.MIN_PEERS, total, byDepartment, byPerson });
  });

  // KPI của chính người gọi: tháng này và quý này (mọi tài khoản nghiệp vụ; admin IT không có số liệu nghiệp vụ).
  app.get('/api/kpi/me', auth, async (req, res) => {
    if (isItAdmin(req.user)) fail(403, 'Tài khoản quản trị hệ thống không có số liệu công việc', 'FORBIDDEN');
    const now = new Date();
    const periods = [S.vnPeriod(now, 'month'), S.vnPeriod(now, 'quarter')];
    const from = new Date(Math.min(...periods.map(p => p.from.getTime()))), to = new Date(Math.max(...periods.map(p => p.to.getTime())));
    const { kpiWeights } = await getSettings(prisma);
    const weights = S.normalizeWeights(kpiWeights);
    // Cán bộ cùng phòng (để so khối lượng với bình quân phòng); chỉ trả về số liệu tổng hợp của phòng, không trả số liệu từng người khác.
    const peers = req.user.departmentId != null
      ? await prisma.user.findMany({ where: { departmentId: req.user.departmentId, role: { not: 'admin' }, isRootAdmin: false }, select: USER_SELECT })
      : await prisma.user.findMany({ where: { id: req.user.id }, select: USER_SELECT });
    if (!peers.some(u => u.id === req.user.id)) peers.push(...await prisma.user.findMany({ where: { id: req.user.id }, select: USER_SELECT }));
    const items = await loadItems(prisma, { from, to, where: [{ assignees: { some: { userId: { in: peers.map(u => u.id) } } } }] });
    const users = peers.map(userRow);
    const out = periods.map(p => {
      const kpi = S.computeKpi(items, { users, departments: [], from: p.from, to: p.to, now, weights });
      const me = kpi.byPerson.find(r => r.id === req.user.id);
      const mine = me || { ...S.metrics([], { from: p.from, to: p.to, now }), peers: 0, components: { onTime: null, rating: null, volume: null }, score: null };
      const crew = me ? kpi.byPerson.filter(r => r.departmentId === me.departmentId) : [];
      const scores = crew.map(r => r.score).filter(s => s != null);
      return {
        key: p.kind, label: p.label, from: p.from, to: p.to,
        assigned: mine.assigned, completed: mine.completed, dueInPeriod: mine.dueInPeriod, judged: mine.judged, onTime: mine.onTime, late: mine.late, onTimeRate: mine.onTimeRate,
        rated: mine.rated, ratingAvg: mine.ratingAvg, openNow: mine.openNow, overdueNow: mine.overdueNow, plan: mine.plan, adhoc: mine.adhoc,
        components: mine.components, score: mine.score,
        // So với phòng: chỉ khi phòng có đủ số cán bộ có số liệu (không suy ra được số liệu của một người).
        department: crew.length >= S.MIN_PEERS ? { officers: crew.length, scored: scores.length,
          avgScore: scores.length >= S.MIN_PEERS ? S.round1(scores.reduce((a, b) => a + b, 0) / scores.length) : null } : null,
      };
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ generatedAt: now, weights, ratingPoints: S.RATING_POINTS, minPeers: S.MIN_PEERS, periods: out });
  });
};
module.exports.metrics = S.metrics;
