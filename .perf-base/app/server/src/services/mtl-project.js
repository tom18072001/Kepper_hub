// Kepper — tải hạng mục Master Timeline người xem được và tính tiến độ / trạng thái của từng hạng mục.
// Dùng chung cho bảng theo dõi, Dashboard, KPI, màn hình Sprint và "Cập nhật nhanh".
const M = require('./mtl');
const { itemVisibleWhere } = require('./access');

const ITEM_SELECT = {
  id: true, number: true, title: true, parentId: true, planId: true, planCode: true, planSection: true, ownerText: true, externalParty: true,
  leadDepartmentId: true, critical: true, milestone: true, milestoneNote: true, startT: true, endT: true, baselineStart: true, baselineEnd: true,
  startDate: true, dueDate: true, forecastEnd: true, weight: true, progress: true, progressAt: true, startedAt: true, completedAt: true, stateId: true,
  state: { select: { id: true, name: true, category: true, color: true } }, assignees: { select: { user: { select: { id: true, fullName: true } } } },
  supportDepartments: { select: { departmentId: true } },
};
// Thứ tự bước tự nhiên: 1, 2, …, 10, II.1, II.2 (số trước, rồi La Mã).
const stepKey = s => { const m = String(s || '').match(/^(\d+)(?:\.(\d+))?/); if (m) return [0, Number(m[1]), Number(m[2] || 0), '']; return [1, 0, 0, String(s || '')]; };
const byStep = (a, b) => { const x = stepKey(a.planCode), y = stepKey(b.planCode); for (let i = 0; i < 4; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; } return a.id - b.id; };

async function computeProject(prisma, project, user, day = new Date()) {
  const cfg = M.alertConfigOf(project);
  const rows = await prisma.workItem.findMany({ where: { projectId: project.id, archivedAt: null, AND: [itemVisibleWhere(user)] }, select: ITEM_SELECT });
  const actual = M.rollup(rows);
  const items = rows.map(r => {
    const a = actual.get(r.id) ?? r.progress;
    const st = M.statusOf(r, a, day, cfg);
    return { ...r, assignees: r.assignees.map(x => x.user), supportDepartmentIds: r.supportDepartments.map(x => x.departmentId), supportDepartments: undefined,
      code: `${project.key}-${r.number}`, actual: a, planned: st.planned ?? M.plannedPct(r, day), status: st.code, statusLabel: M.STATUS[st.code], variance: st.variance ?? null,
      lateDays: st.lateDays ?? null, daysLeft: st.daysLeft ?? null, startsIn: st.startsIn ?? null, children: 0 };
  });
  const byId = new Map(items.map(i => [i.id, i]));
  for (const i of items) if (i.parentId && byId.has(i.parentId)) byId.get(i.parentId).children++;
  return { items: items.sort(byStep), cfg, actualOf: i => actual.get(i.id) ?? i.progress };
}

module.exports = { ITEM_SELECT, stepKey, byStep, computeProject };
