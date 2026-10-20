// Trang "Điều hành": bức tranh buổi sáng cho Ban Giám đốc (toàn Trung tâm / phòng mình phụ trách) và lãnh đạo phòng (phòng mình):
// chờ BGĐ cho ý kiến, chờ phòng duyệt, chờ phòng tiếp nhận, kiến nghị chưa trả lời, đề nghị gia hạn, quá hạn, sắp đến hạn, bị trả lại;
// bảng theo phòng chủ trì: Kế hoạch năm (x/y) và nhiệm vụ đột xuất (giao / hoàn thành / đúng hạn). Tìm nhanh theo mã, tên, số văn bản.
const { fail } = require('../lib/http');
const { permissionScope } = require('../lib/permissions');
const { itemVisibleWhere, visibleProjectsWhere } = require('../services/access');
const { getSettings, deadlineStatus, vnDayNumber } = require('../services/register');
const { stageOf } = require('../services/stage');

const DAY = 86_400_000, H7 = 7 * 3_600_000;
const vnNow = () => new Date(Date.now() + H7);
// Kỳ theo giờ Việt Nam: [đầu kỳ, đầu kỳ sau).
function periodRange(period) {
  const n = vnNow(), y = n.getUTCFullYear(), m = n.getUTCMonth();
  const [start, end] = period === 'month' ? [Date.UTC(y, m, 1), Date.UTC(y, m + 1, 1)]
    : period === 'quarter' ? [Date.UTC(y, Math.floor(m / 3) * 3, 1), Date.UTC(y, Math.floor(m / 3) * 3 + 3, 1)] : [Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1)];
  return { from: new Date(start - H7), to: new Date(end - H7) };
}
const LIST_LIMIT = 30;

module.exports = function mountOps(app, { prisma, auth, audit }) {
  app.get('/api/ops/overview', auth, async (req, res) => {
    const scope = permissionScope(req.user, 'work.approve', 'OPERATE');
    if (!scope) fail(403, 'Trang điều hành dành cho Ban Giám đốc và lãnh đạo phòng', 'FORBIDDEN');
    const settings = await getSettings(prisma);
    const allDepts = await prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true, supervisorId: true }, orderBy: { name: 'asc' } });
    const supervised = allDepts.filter(d => d.supervisorId === req.user.id).map(d => d.id);
    let depts;
    if (scope === 'SYSTEM') {
      const asked = String(req.query.departmentIds || '').split(',').map(Number).filter(Number.isInteger).filter(id => allDepts.some(d => d.id === id));
      depts = asked.length ? asked : req.query.all === '1' || !supervised.length ? null : supervised;
    } else depts = req.user.departmentId != null ? [req.user.departmentId] : [];
    const period = ['month', 'quarter', 'year'].includes(req.query.period) ? req.query.period : 'year';
    const { from, to } = periodRange(period);
    const deptWhere = depts ? { OR: [{ leadDepartmentId: { in: depts } }, { leadDepartmentId: null, project: { departmentId: { in: depts } } }] } : {};
    const rows = await prisma.workItem.findMany({
      // Chỉ những việc có thể rơi vào một khối hoặc vào kỳ đang xem — không nạp việc đã xong của các kỳ trước.
      where: { archivedAt: null, project: { ...visibleProjectsWhere(req.user), archivedAt: null }, AND: [itemVisibleWhere(req.user), deptWhere, { OR: [
        { state: { category: { notIn: ['COMPLETED', 'CANCELLED'] } } }, { dueDate: { gte: from } }, { assignedAt: { gte: from } }, { createdAt: { gte: from } },
        { extensions: { some: { status: 'PENDING' } } }, { progressReports: { some: { proposals: { not: '' }, answer: null, ...(scope === 'SYSTEM' ? {} : { forwardedAt: null }) } } },
      ] }] },
      orderBy: { id: 'desc' },
      select: { id: true, number: true, title: true, parentId: true, dueDate: true, internalDueDate: true, completedAt: true, assignedAt: true, createdAt: true, dispatchStatus: true, dispatchedAt: true,
        returnedAt: true, returnNote: true, taskType: true, leadDepartmentId: true, progress: true, assignedById: true,
        state: { select: { category: true } }, project: { select: { id: true, key: true, departmentId: true, approvalSteps: { select: { level: true, name: true, approverType: true } } } },
        approvals: { where: { status: 'PENDING' }, select: { currentLevel: true, createdAt: true } }, assignees: { select: { user: { select: { id: true, fullName: true } } } },
        extensions: { where: { status: 'PENDING' }, select: { id: true, newDue: true, createdAt: true } },
        progressReports: { where: { proposals: { not: '' }, answer: null, ...(scope === 'SYSTEM' ? {} : { forwardedAt: null }) }, select: { id: true, createdAt: true, forwardedAt: true } } },
      take: 6000,
    });
    const deptName = Object.fromEntries(allDepts.map(d => [d.id, d.name]));
    const today = vnDayNumber(new Date());
    const rootOnly = scope === 'SYSTEM'; // Ban Giám đốc nhìn nhiệm vụ gốc; lãnh đạo phòng nhìn cả việc nhánh của phòng
    const view = r => {
      const dept = r.leadDepartmentId ?? r.project.departmentId;
      const stage = stageOf({ ...r, pendingApproval: r.approvals[0] }, r.project.approvalSteps);
      const dl = deadlineStatus(r, new Date(), settings.dueSoonDays);
      return { r, dept, stage, dl };
    };
    const all = rows.map(view);
    const scoped = rootOnly ? all.filter(x => !x.r.parentId) : all;
    const open = scoped.filter(x => !['DONE', 'CANCELLED'].includes(x.stage.code));
    const brief = (x, extra = {}) => ({ id: x.r.id, code: `${x.r.project.key}-${x.r.number}`, title: x.r.title, projectId: x.r.project.id, department: deptName[x.dept] || null,
      dueDate: x.r.dueDate, internalDueDate: x.r.internalDueDate, stage: x.stage.label, deadline: x.dl.label, deadlineCode: x.dl.code, progress: x.r.progress,
      assignees: x.r.assignees.map(a => ({ id: a.user.id, fullName: a.user.fullName })), taskType: x.r.taskType, ...extra });
    const daysSince = d => (d ? Math.max(0, today - vnDayNumber(d)) : null);
    const pick = (list, fn, sort) => { const l = list.filter(fn).sort(sort); return { count: l.length, items: l.slice(0, LIST_LIMIT) }; };
    const byDue = (a, b) => (a.r.dueDate ? +a.r.dueDate : Infinity) - (b.r.dueDate ? +b.r.dueDate : Infinity);
    const blocks = {
      waitBgd: pick(open, x => x.stage.code === 'WAIT_BGD', (a, b) => +a.r.approvals[0].createdAt - +b.r.approvals[0].createdAt),
      waitDept: pick(open, x => x.stage.code === 'WAIT_DEPT' || x.stage.code === 'WAIT_APPROVAL', (a, b) => +a.r.approvals[0].createdAt - +b.r.approvals[0].createdAt),
      pendingAccept: pick(open, x => x.stage.code === 'PENDING_ACCEPT', (a, b) => +(a.r.dispatchedAt || 0) - +(b.r.dispatchedAt || 0)),
      returned: pick(open, x => x.stage.code === 'RETURNED', (a, b) => +b.r.returnedAt - +a.r.returnedAt),
      overdue: pick(open, x => x.dl.code === 'OVERDUE', byDue),
      dueSoon: pick(open, x => x.dl.code === 'DUE_SOON', byDue),
      proposals: pick(all, x => x.r.progressReports.length > 0, (a, b) => +a.r.progressReports[0].createdAt - +b.r.progressReports[0].createdAt),
      extensions: pick(all, x => x.r.extensions.length > 0, (a, b) => +a.r.extensions[0].createdAt - +b.r.extensions[0].createdAt),
    };
    const out = {};
    for (const [k, v] of Object.entries(blocks)) {
      out[k] = { count: v.count, items: v.items.map(x => brief(x, {
        waitingDays: k === 'pendingAccept' ? daysSince(x.r.dispatchedAt) : k.startsWith('wait') ? daysSince(x.r.approvals[0]?.createdAt) : k === 'proposals' ? daysSince(x.r.progressReports[0]?.createdAt) : k === 'extensions' ? daysSince(x.r.extensions[0]?.createdAt) : null,
        lateDays: k === 'overdue' && x.r.dueDate ? today - vnDayNumber(x.r.dueDate) : null,
        returnNote: k === 'returned' ? x.r.returnNote : undefined, newDue: k === 'extensions' ? x.r.extensions[0]?.newDue : undefined,
      })) };
    }
    // Bảng theo phòng chủ trì (nhiệm vụ gốc): đang mở, các khâu, Kế hoạch năm (hạn trong kỳ), Đột xuất (giao trong kỳ).
    const deptIds = depts || [...new Set(all.map(x => x.dept))].filter(id => deptName[id]);
    const roots = all.filter(x => !x.r.parentId);
    const byDept = deptIds.map(id => {
      const mine = roots.filter(x => x.dept === id), op = mine.filter(x => !['DONE', 'CANCELLED'].includes(x.stage.code));
      const plan = mine.filter(x => x.r.taskType === 'PLAN' && x.r.dueDate && x.r.dueDate >= from && x.r.dueDate < to && x.stage.code !== 'CANCELLED');
      const adhoc = mine.filter(x => x.r.taskType === 'ADHOC' && (x.r.assignedAt || x.r.createdAt) >= from && (x.r.assignedAt || x.r.createdAt) < to && x.stage.code !== 'CANCELLED');
      const doneAdhoc = adhoc.filter(x => x.stage.code === 'DONE');
      return { departmentId: id, department: deptName[id], open: op.length, overdue: op.filter(x => x.dl.code === 'OVERDUE').length, dueSoon: op.filter(x => x.dl.code === 'DUE_SOON').length,
        pendingAccept: op.filter(x => x.stage.code === 'PENDING_ACCEPT').length, waitDept: op.filter(x => x.stage.code === 'WAIT_DEPT').length, waitBgd: op.filter(x => x.stage.code === 'WAIT_BGD').length,
        plan: { total: plan.length, done: plan.filter(x => x.stage.code === 'DONE').length, avgProgress: plan.length ? Math.round(plan.reduce((n, x) => n + (x.stage.code === 'DONE' ? 100 : x.r.progress), 0) / plan.length) : null },
        adhoc: { total: adhoc.length, done: doneAdhoc.length, onTime: doneAdhoc.filter(x => x.dl.code === 'DONE_ON_TIME').length } };
    }).sort((a, b) => a.department.localeCompare(b.department, 'vi'));
    // Làm mới nền (sau thông báo / thao tác) không ghi thêm nhật ký xem.
    if (req.query.bg !== '1') await audit(req, 'VIEW_OPS', 'Ops', null, null, { scope, departments: depts || 'ALL', period });
    res.json({ scope, period, from, to, generatedAt: new Date(), departments: allDepts.map(d => ({ id: d.id, name: d.name })), selected: depts, supervised, blocks: out, byDept, dueSoonDays: settings.dueSoonDays });
  });

  // Tìm nhanh (Ctrl+K): mã việc, tên việc, số hiệu văn bản liên quan — chỉ trong phạm vi được xem.
  app.get('/api/search', auth, async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q.length < 2) return res.json([]);
    const m = q.match(/^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/);
    const rows = await prisma.workItem.findMany({
      where: { archivedAt: null, project: { ...visibleProjectsWhere(req.user), archivedAt: null }, AND: [itemVisibleWhere(req.user), { OR: [
        { title: { contains: q, mode: 'insensitive' } }, { documents: { some: { number: { contains: q, mode: 'insensitive' } } } },
        ...(m ? [{ number: Number(m[2]), project: { key: m[1].toUpperCase() } }] : []),
      ] }] },
      select: { id: true, number: true, title: true, project: { select: { id: true, key: true, name: true } }, documents: { where: { number: { contains: q, mode: 'insensitive' } }, select: { number: true }, take: 1 } },
      orderBy: { updatedAt: 'desc' }, take: 15,
    });
    res.json(rows.map(r => ({ id: r.id, code: `${r.project.key}-${r.number}`, title: r.title, projectId: r.project.id, projectName: r.project.name, matchedDocument: r.documents[0]?.number || null })));
  });
};
