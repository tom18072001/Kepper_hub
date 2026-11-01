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

// Tính một dự án từ các dòng đã tải (đã lọc theo phạm vi xem). Kết quả dùng chung được cache → không bị caller sửa (xem clone ở dưới).
function computeFromRows(project, rows, day) {
  const cfg = M.alertConfigOf(project);
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
  return { items: items.sort(byStep), cfg, actual };
}
// Trả bản sao nông từng hạng mục: caller được phép gán thêm trường / sắp xếp lại mà không làm bẩn bộ đệm.
const present = ({ items, cfg, actual }) => ({ items: items.map(i => ({ ...i })), cfg, actualOf: i => actual.get(i.id) ?? i.progress });

// Tính nhiều dự án bằng MỘT truy vấn (projectId in […]); trả Map(projectId → { items, cfg, actualOf }).
// Dùng bộ đệm nếu prisma là client đã qua withMtlCache (khoá: dự án + phạm vi xem + ngày VN + phiên bản dữ liệu).
async function computeProjects(prisma, projects, user, day = new Date()) {
  const out = new Map();
  if (!projects.length) return out;
  const cache = typeof prisma.$mtlCache === 'function' ? prisma.$mtlCache() : null;
  const where = itemVisibleWhere(user);
  const scope = cache ? JSON.stringify(where) : '', dayKey = M.vnDay(day), version = cache ? cache.version() : 0;
  const miss = [];
  for (const p of projects) {
    const hit = cache?.get(cache.key(version, p.id, scope, dayKey));
    if (hit) out.set(p.id, present(hit)); else miss.push(p);
  }
  if (!miss.length) return out;
  const rows = await prisma.workItem.findMany({ where: { projectId: { in: miss.map(p => p.id) }, archivedAt: null, AND: [where] }, select: { ...ITEM_SELECT, projectId: true } });
  const byProject = new Map(miss.map(p => [p.id, []]));
  for (const { projectId, ...r } of rows) byProject.get(projectId)?.push(r); // bỏ projectId để hạng mục giống hệt bản tính từng dự án
  for (const p of miss) {
    const computed = computeFromRows(p, byProject.get(p.id), day);
    // Khoá theo phiên bản đọc TRƯỚC truy vấn: nếu có ghi xen giữa, mục này mang phiên bản cũ và không bao giờ được dùng lại.
    cache?.set(cache.key(version, p.id, scope, dayKey), computed);
    out.set(p.id, present(computed));
  }
  return out;
}

async function computeProject(prisma, project, user, day = new Date()) {
  return (await computeProjects(prisma, [project], user, day)).get(project.id);
}

module.exports = { ITEM_SELECT, stepKey, byStep, computeProject, computeProjects };
