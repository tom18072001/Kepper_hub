// Cảnh báo tiến độ Master Timeline (chạy 07:30 hằng ngày, giờ Việt Nam): so tiến độ thực tế với kế hoạch gốc,
// nhắc sắp bắt đầu / chậm khởi động / sắp đến hạn / chậm tiến độ / vượt tiến độ / trễ hạn / lâu chưa cập nhật.
// Chống lặp theo loại và chu kỳ; ghi ProgressAlert; thông báo trong ứng dụng (+ Viber nếu bật); chụp tiến độ cho đường cong S.
const M = require('./mtl');
const { notify } = require('./events');
const approval = require('./approval');
const viber = require('./viber');
const { permissionScope } = require('../lib/permissions');

const KIND_LABEL = { START_SOON: 'Sắp bắt đầu', LATE_START: 'Chậm khởi động', DUE_SOON: 'Sắp đến hạn', BEHIND: 'Chậm tiến độ', AHEAD: 'Vượt tiến độ', OVERDUE: 'Trễ hạn', STALE: 'Lâu chưa cập nhật' };
// Chu kỳ nhắc lại (ngày); 0 = chỉ một lần cho mỗi hạng mục.
const REPEAT = { START_SOON: 0, LATE_START: 3, DUE_SOON: 0, BEHIND: 7, AHEAD: 0, OVERDUE: 3, STALE: 7 };
const LEVEL = { START_SOON: 'INFO', DUE_SOON: 'WARN', AHEAD: 'INFO', STALE: 'WARN', LATE_START: 'WARN', BEHIND: 'WARN', OVERDUE: 'DANGER' };

// Loại cảnh báo của một hạng mục hôm nay (hàm thuần).
function kindsFor(item, st, day, cfg) {
  const out = [];
  if (st.code === 'NOT_DUE' && st.startsIn != null && st.startsIn <= cfg.startSoonDays) out.push('START_SOON');
  if (st.code === 'LATE_START') out.push('LATE_START');
  if (st.code === 'BEHIND') out.push('BEHIND');
  if (st.code === 'AHEAD') out.push('AHEAD');
  if (st.code === 'OVERDUE') out.push('OVERDUE');
  if (['ON_TRACK', 'BEHIND', 'AHEAD', 'LATE_START'].includes(st.code) && st.daysLeft != null && st.daysLeft <= cfg.dueSoonDays) out.push('DUE_SOON');
  const last = item.progressAt || item.startedAt;
  if (['ON_TRACK', 'BEHIND', 'AHEAD'].includes(st.code) && last && M.vnDay(day) - M.vnDay(last) >= cfg.staleDays) out.push('STALE');
  return out;
}
// Đã nhắc gần đây chưa (theo chu kỳ của loại)?
function shouldSend(kind, lastAt, day) {
  if (!lastAt) return true;
  const every = REPEAT[kind];
  return every > 0 && M.vnDay(day) - M.vnDay(lastAt) >= every;
}
const num = n => String(n).replace('.', ',');
const fmt = d => (d ? new Date(new Date(d).getTime() + 7 * 3_600_000).toISOString().slice(0, 10).split('-').reverse().join('/') : '—');

async function runProjectAlerts(prisma, project, day = new Date()) {
  if (project.kind !== 'MTL' || !project.t0Date || project.archivedAt || project.deletedAt) return { project: project.id, alerts: 0, notified: 0 };
  const cfg = M.alertConfigOf(project);
  const rows = await prisma.workItem.findMany({ where: { projectId: project.id, archivedAt: null },
    select: { id: true, number: true, title: true, parentId: true, leadDepartmentId: true, critical: true, milestone: true, weight: true, progress: true, progressAt: true,
      startedAt: true, completedAt: true, baselineStart: true, baselineEnd: true, state: { select: { category: true } }, assignees: { select: { userId: true } } } });
  const actual = M.rollup(rows);
  const parents = new Set(rows.map(r => r.parentId).filter(Boolean));
  const last = await prisma.progressAlert.groupBy({ by: ['workItemId', 'kind'], where: { projectId: project.id }, _max: { createdAt: true } });
  const lastAt = new Map(last.map(l => [`${l.workItemId}:${l.kind}`, l._max.createdAt]));
  // Người nhận: người chủ trì; lãnh đạo bộ phận chủ trì; PMO = trưởng dự án + chủ dự án; đường găng / mốc mức nặng: thêm Ban lãnh đạo.
  const owners = (await prisma.projectMember.findMany({ where: { projectId: project.id, role: 'OWNER' }, select: { userId: true } })).map(m => m.userId);
  const pmo = [...new Set([project.leadId, ...owners].filter(Boolean))];
  const directors = (await prisma.user.findMany({ where: { isActive: true, permissions: { some: { permissionKey: 'work.approve', scope: 'SYSTEM' } } }, include: { permissions: true } }))
    .filter(u => permissionScope(u, 'work.approve', 'OPERATE') === 'SYSTEM').map(u => u.id);
  const leaderCache = new Map();
  const leadersOf = async id => { if (!leaderCache.has(id)) leaderCache.set(id, await approval.deptLeaderIds(prisma, id)); return leaderCache.get(id); };
  const dayDate = new Date(Date.UTC(...(d => [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()])(new Date(day.getTime() + 7 * 3_600_000))));
  let alerts = 0, notified = 0;
  for (const r of rows) {
    const a = actual.get(r.id) ?? r.progress;
    const st = M.statusOf(r, a, day, cfg);
    for (const kind of kindsFor(r, st, day, cfg)) {
      if (!shouldSend(kind, lastAt.get(`${r.id}:${kind}`), day)) continue;
      const level = LEVEL[kind];
      const leaders = await leadersOf(r.leadDepartmentId);
      const hasKids = parents.has(r.id);
      let to = hasKids ? [...leaders] : [...r.assignees.map(x => x.userId), ...leaders];
      if (['LATE_START', 'BEHIND', 'OVERDUE'].includes(kind)) to.push(...pmo);
      if ((r.critical || r.milestone) && ['BEHIND', 'OVERDUE'].includes(kind)) to.push(...directors);
      if (kind === 'STALE') to = r.assignees.map(x => x.userId).length ? r.assignees.map(x => x.userId) : leaders;
      to = [...new Set(to)];
      const code = `${project.key}-${r.number}`;
      const detail = kind === 'START_SOON' ? `Bắt đầu theo kế hoạch ${fmt(r.baselineStart)} (còn ${st.startsIn} ngày)`
        : kind === 'OVERDUE' ? `Quá hạn kế hoạch ${st.lateDays} ngày (hạn ${fmt(r.baselineEnd)}) · thực tế ${num(a)}%`
          : kind === 'DUE_SOON' ? `Hạn kế hoạch ${fmt(r.baselineEnd)} (còn ${st.daysLeft} ngày) · thực tế ${num(a)}%`
            : kind === 'STALE' ? `Chưa cập nhật tiến độ từ ${fmt(r.progressAt || r.startedAt)}`
              : `Kế hoạch ${num(st.planned)}% · thực tế ${num(a)}% (${st.variance > 0 ? '+' : ''}${num(st.variance)} điểm)`;
      const created = await prisma.progressAlert.createMany({ data: [{ projectId: project.id, workItemId: r.id, kind, level, day: dayDate, variance: st.variance ?? null, lateDays: st.lateDays ?? null, recipients: to.length }], skipDuplicates: true });
      if (!created.count) continue;
      alerts++;
      const link = `#/projects/${project.id}?item=${r.id}`;
      notified += await notify(prisma, to, { type: 'MTL_ALERT', title: `[${KIND_LABEL[kind]}] ${code} · ${String(r.title).slice(0, 80)}${r.critical ? ' (đường găng)' : ''}`, body: detail, link });
      // Viber: tối thiểu hoá — chỉ mã hạng mục, loại cảnh báo, liên kết nội bộ (không tên việc, không số liệu).
      await viber.sendToUsers(prisma, to, `Kepper Hub — ${KIND_LABEL[kind]}: ${code}. Mở: ${viber.appLink(link)}`).catch(() => {});
    }
  }
  // Ảnh chụp tiến độ hôm nay: toàn dự án + từng bộ phận (đường cong S thực tế).
  const leaves = rows.filter(r => !parents.has(r.id));
  const actualOf = i => actual.get(i.id) ?? i.progress;
  const snap = async (departmentId, list) => {
    const s = M.spiOf(list, actualOf, day);
    if (s.plannedPct == null) return;
    await prisma.progressSnapshot.upsert({ where: { projectId_departmentId_day: { projectId: project.id, departmentId, day: dayDate } },
      create: { projectId: project.id, departmentId, day: dayDate, plannedPct: s.plannedPct, actualPct: s.actualPct, spi: s.spi },
      update: { plannedPct: s.plannedPct, actualPct: s.actualPct, spi: s.spi } }).catch(async e => {
      // Prisma không upsert được khoá có null (departmentId = null) → cập nhật / tạo tay.
      if (departmentId !== null) throw e;
      const ex = await prisma.progressSnapshot.findFirst({ where: { projectId: project.id, departmentId: null, day: dayDate } });
      if (ex) await prisma.progressSnapshot.update({ where: { id: ex.id }, data: { plannedPct: s.plannedPct, actualPct: s.actualPct, spi: s.spi } });
      else await prisma.progressSnapshot.create({ data: { projectId: project.id, departmentId: null, day: dayDate, plannedPct: s.plannedPct, actualPct: s.actualPct, spi: s.spi } });
    });
  };
  await snap(null, leaves);
  for (const d of new Set(leaves.map(r => r.leadDepartmentId).filter(Boolean))) await snap(d, leaves.filter(r => r.leadDepartmentId === d));
  return { project: project.id, alerts, notified };
}

async function runAllAlerts(prisma, day = new Date()) {
  const projects = await prisma.project.findMany({ where: { kind: 'MTL', archivedAt: null, deletedAt: null, t0Date: { not: null } } });
  const out = [];
  for (const p of projects) out.push(await runProjectAlerts(prisma, p, day));
  return out;
}

// Nhắc cập nhật tiến độ hằng tuần (chiều thứ Sáu): mỗi người MỘT thông báo trong ứng dụng — số việc trong sprint hiện tại
// đã tới ngày bắt đầu mà chưa cập nhật từ 5 ngày trở lên — mở "Cập nhật nhanh". Người nhận: người phụ trách;
// hạng mục chưa giao người → lãnh đạo bộ phận chủ trì. Chỉ thông báo trong ứng dụng (không qua Viber).
async function runWeeklyUpdateReminder(prisma, day = new Date(), { staleDays = 5 } = {}) {
  const projects = await prisma.project.findMany({ where: { kind: 'MTL', archivedAt: null, deletedAt: null, t0Date: { not: null } } });
  const count = new Map(), leaderCache = new Map();
  for (const p of projects) {
    const t = M.currentT(p.t0Date, day);
    if (t == null || t < 0) continue;
    const sprint = M.sprintOf(p.t0Date, t);
    const rows = await prisma.workItem.findMany({ where: { projectId: p.id, archivedAt: null },
      select: { id: true, parentId: true, baselineStart: true, baselineEnd: true, progressAt: true, startedAt: true, completedAt: true, leadDepartmentId: true, state: { select: { category: true } }, assignees: { select: { userId: true } } } });
    for (const r of M.leavesOf(rows)) {
      if (M.isDone(r) || M.isCancelled(r) || !r.baselineStart || r.baselineStart > day) continue;
      if (!['DUE', 'RUNNING'].includes(M.sprintLane(r, sprint, null, { current: true }))) continue;
      const last = r.progressAt || r.startedAt;
      if (last && M.vnDay(day) - M.vnDay(last) < staleDays) continue;
      let to = r.assignees.map(a => a.userId);
      if (!to.length) {
        if (!leaderCache.has(r.leadDepartmentId)) leaderCache.set(r.leadDepartmentId, await approval.deptLeaderIds(prisma, r.leadDepartmentId));
        to = leaderCache.get(r.leadDepartmentId);
      }
      for (const u of new Set(to)) count.set(u, (count.get(u) || 0) + 1);
    }
  }
  let sent = 0;
  for (const [userId, n] of count) sent += await notify(prisma, [userId], { type: 'MTL_UPDATE_REMINDER', title: `Cập nhật tiến độ tuần này: ${n} việc trong sprint chưa cập nhật`, body: 'Mở "Cập nhật nhanh" và bấm % hoàn thành cho từng việc.', link: '#/sprint' });
  return { users: count.size, sent };
}

module.exports = { KIND_LABEL, REPEAT, LEVEL, kindsFor, shouldSend, runProjectAlerts, runAllAlerts, runWeeklyUpdateReminder };
