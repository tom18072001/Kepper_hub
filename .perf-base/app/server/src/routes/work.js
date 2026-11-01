// Tổng thể công việc trên mọi dự án theo một người (chủ trì / phối hợp / người giao) hoặc một phòng (chủ trì, phối hợp,
// có cán bộ tham gia). Phạm vi: Ban Giám đốc — mọi người, mọi phòng; lãnh đạo phòng — phòng mình; cán bộ — chính mình.
// Luôn giao với quyền xem từng việc của người xem. Xem việc của người khác là thao tác trên dữ liệu cá nhân → ghi nhật ký.
const { fail, optionalInt, optionalDate } = require('../lib/http');
const { visibleProjectsWhere, itemVisibleWhere } = require('../services/access');
const { BOARD_INCLUDE, boardItem } = require('../services/workitems');
const { stageOf } = require('../services/stage');
const { getSettings, deadlineStatus } = require('../services/register');
const W = require('../services/work');
const S = require('../services/stats');

const LIMIT = 500, DAY = 86_400_000;
const ROLE_KEYS = ['LEAD', 'SUPPORT', 'ASSIGNER'];

module.exports = function mountWork(app, { prisma, auth, audit }) {
  app.get('/api/work', auth, async (req, res) => {
    const scope = W.workScope(req.user);
    if (!scope) fail(403, 'Tài khoản quản trị hệ thống không có số liệu công việc', 'FORBIDDEN');
    const now = new Date();
    const settings = await getSettings(prisma);
    const departments = await prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const deptName = Object.fromEntries(departments.map(d => [d.id, d.name]));

    // Đối tượng xem: ?user= | ?dept= | ?all=1; mặc định theo phạm vi.
    const userId = req.query.user === 'me' ? req.user.id : optionalInt(req.query.user, 'Người');
    const deptId = optionalInt(req.query.dept, 'Phòng');
    let subject;
    if (userId != null) {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true, displayTitle: true, departmentId: true, role: true, isRootAdmin: true } });
      if (!u || u.role === 'admin' || u.isRootAdmin) fail(404, 'Không tìm thấy người này', 'NOT_FOUND');
      subject = { type: 'user', id: u.id, name: u.fullName, title: u.displayTitle || '', departmentId: u.departmentId, departmentName: deptName[u.departmentId] || '' };
    } else if (deptId != null) {
      if (!deptName[deptId]) fail(404, 'Không tìm thấy phòng', 'NOT_FOUND');
      subject = { type: 'dept', id: deptId, name: deptName[deptId] };
    } else if (scope === 'SYSTEM') subject = { type: 'all', name: 'Toàn Trung tâm' };
    else if (scope === 'UNIT') subject = { type: 'dept', id: req.user.departmentId, name: deptName[req.user.departmentId] || 'Phòng của tôi' };
    else subject = { type: 'user', id: req.user.id, name: req.user.fullName, departmentId: req.user.departmentId, departmentName: deptName[req.user.departmentId] || '' };
    if (!W.canViewSubject(req.user, scope, subject)) fail(403, scope === 'SELF' ? 'Bạn chỉ xem được việc của chính mình' : 'Bạn chỉ xem được việc trong phòng mình', 'FORBIDDEN');

    // Lọc theo chỉ số "Số liệu của tôi" (chỉ khi xem một người): cùng định nghĩa với KPI, trên việc người đó chủ trì.
    const metric = subject.type === 'user' && W.METRICS[req.query.metric] ? req.query.metric : null;
    let period = null;
    if (metric) {
      const from = optionalDate(req.query.from, 'Từ ngày'), to = optionalDate(req.query.to, 'Đến ngày');
      if (!from || !to || to < from || to - from > 400 * DAY) fail(422, 'Khoảng thời gian không hợp lệ');
      period = { from, to };
    }
    const status = metric ? 'all' : W.STATUSES.includes(req.query.status) ? req.query.status : 'open';
    const role = subject.type === 'user' && !metric && ROLE_KEYS.includes(req.query.role) ? req.query.role : '';

    const involve = subject.type === 'user'
      ? (metric ? { assignees: { some: { userId: subject.id } } }
        : { OR: [{ assignees: { some: { userId: subject.id } } }, { supporters: { some: { userId: subject.id } } }, { assignedById: subject.id }] })
      : subject.type === 'dept'
        ? { OR: [S.departmentWhere(subject.id), { supportDepartments: { some: { departmentId: subject.id } } }, { assignees: { some: { user: { departmentId: subject.id } } } }] }
        : {};
    // Việc đang mở + việc xong / xếp loại trong ~13 tháng gần đây (đủ cho "Đã xong" và chỉ số theo kỳ).
    const since = new Date(now.getTime() - 400 * DAY);
    const rows = await prisma.workItem.findMany({
      where: { archivedAt: null, project: { ...visibleProjectsWhere(req.user), archivedAt: null }, AND: [itemVisibleWhere(req.user), involve, { OR: [
        { state: { category: { notIn: ['COMPLETED', 'CANCELLED'] } } }, { completedAt: { gte: since } }, { ratedAt: { gte: since } }, { dueDate: { gte: since } },
      ] }] },
      include: { ...BOARD_INCLUDE, state: true, project: { include: { approvalSteps: { select: { level: true, name: true, approverType: true } } } } },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }], take: 3000,
    });
    const rolesOf = r => (subject.type === 'user' ? W.rolesOf({ assignees: r.assignees.map(a => ({ userId: a.userId })), supporters: r.supporters.map(a => ({ userId: a.userId })), assignedById: r.assignedById }, subject.id) : []);
    let base = rows.map(r => ({ r, roles: rolesOf(r) }));
    if (metric) { const ok = W.metricPredicate(metric, { ...period, now }); base = base.filter(x => ok(x.r)); }

    const statusMatch = x => W.matchStatus(x.r, status, now, settings.dueSoonDays);
    const roleMatch = x => !role || x.roles.includes(role);
    const counts = Object.fromEntries(W.STATUSES.map(s => [s, base.filter(x => roleMatch(x) && W.matchStatus(x.r, s, now, settings.dueSoonDays)).length]));
    const roleCounts = subject.type === 'user' && !metric ? Object.fromEntries(['', ...ROLE_KEYS].map(k => [k || 'ALL', base.filter(x => statusMatch(x) && (!k || x.roles.includes(k))).length])) : null;
    let list = base.filter(x => statusMatch(x) && roleMatch(x));
    if (status === 'done') list.sort((a, b) => (b.r.completedAt?.getTime() || 0) - (a.r.completedAt?.getTime() || 0));
    const truncated = list.length > LIMIT;
    list = list.slice(0, LIMIT);

    // Danh sách đối tượng chọn được (theo phạm vi) cho ô chọn người / phòng.
    const userWhere = { isActive: true, role: { not: 'admin' }, isRootAdmin: false,
      ...(scope === 'SYSTEM' ? {} : scope === 'UNIT' ? { departmentId: req.user.departmentId } : { id: req.user.id }) };
    const people = await prisma.user.findMany({ where: userWhere, select: { id: true, fullName: true, displayTitle: true, departmentId: true }, orderBy: { fullName: 'asc' } });
    const subjects = {
      all: scope === 'SYSTEM',
      departments: scope === 'SYSTEM' ? departments : scope === 'UNIT' ? departments.filter(d => d.id === req.user.departmentId) : [],
      users: people,
    };

    const isSelf = subject.type === 'user' && subject.id === req.user.id;
    if (!isSelf) await audit(req, 'VIEW_WORK', subject.type === 'user' ? 'User' : subject.type === 'dept' ? 'Department' : 'Work', subject.id ?? null, null, { status, role: role || null, metric, count: list.length });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      scope, subject, status, role, generatedAt: now, dueSoonDays: settings.dueSoonDays, truncated,
      metric: metric ? { key: metric, label: W.METRICS[metric], ...period } : null,
      counts, roleCounts, subjects,
      items: list.map(({ r, roles }) => {
        const { project, state, ...rest } = r;
        return { ...boardItem(project, rest), roles, stage: stageOf({ ...r, pendingApproval: r.approvals[0] }, project.approvalSteps),
          deadline: deadlineStatus(r, now, settings.dueSoonDays).code,
          leadDeptId: r.leadDepartmentId ?? project.departmentId ?? null, leadDepartmentName: deptName[r.leadDepartmentId ?? project.departmentId] || '',
          project: { id: project.id, key: project.key, name: project.name }, state: { id: state.id, name: state.name, category: state.category, color: state.color } };
      }),
    });
  });
};
