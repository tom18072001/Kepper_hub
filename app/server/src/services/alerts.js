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
  // Việc đã có cập nhật (bắt đầu hoặc báo tiến độ) thì không nhắc "Chậm khởi động" nữa.
  if (st.code === 'LATE_START' && !item.startedAt && !item.progressAt) out.push('LATE_START');
  if (st.code === 'BEHIND') out.push('BEHIND');
  if (st.code === 'AHEAD') out.push('AHEAD');
  if (st.code === 'OVERDUE') out.push('OVERDUE');
  if (['ON_TRACK', 'BEHIND', 'AHEAD', 'LATE_START'].includes(st.code) && st.daysLeft != null && st.daysLeft <= cfg.dueSoonDays) out.push('DUE_SOON');
  const last = item.progressAt || item.startedAt;
  if (['ON_TRACK', 'BEHIND', 'AHEAD'].includes(st.code) && last && M.vnDay(day) - M.vnDay(last) >= cfg.staleDays) out.push('STALE');
  return out;
}
// ---------- "Đang làm" và "nguy cơ chậm tiến độ" — MỘT định nghĩa cho báo cáo tuần, giao ban, bản Word ----------
// Đã bắt đầu (chưa xong, chưa huỷ): đang làm / chờ duyệt / bị trả lại ở bước duyệt, đã bấm bắt đầu, đã báo tiến độ hoặc % > 0.
function isStarted(item, actual = item.actual ?? item.progress) {
  const c = item.state?.category ?? item.category;
  if (c === 'COMPLETED' || c === 'CANCELLED') return false;
  return c === 'STARTED' || c === 'REVIEW' || !!item.returnedAt || !!item.startedAt || !!item.progressAt || (Number(actual) || 0) > 0;
}
const RISK_LABEL = { OVERDUE: 'Trễ hạn', LATE_START: 'Chậm khởi động', BEHIND: 'Chậm tiến độ', DUE_SOON: 'Sắp đến hạn' };
// Việc thường (không có kế hoạch gốc MTL): "sắp đến hạn" khi còn ≤ 3 ngày.
const TASK_DUE_SOON_DAYS = 3;
// Nguy cơ chậm của một việc chưa xong hôm nay → { code, label, days } hoặc null.
// - Hạng mục MTL có kế hoạch gốc (st = M.statusOf(...), cfg = cấu hình cảnh báo của dự án): Trễ hạn, Chậm khởi động, Chậm tiến độ
//   theo đúng cảnh báo hằng ngày; "Sắp đến hạn" (≤ cfg.dueSoonDays) chỉ tính khi % thực tế thấp hơn % kế hoạch.
// - Việc thường / chưa có kế hoạch gốc: quá hạn (dueDate) hoặc còn ≤ TASK_DUE_SOON_DAYS ngày.
function riskOf(item, { st = null, cfg = M.DEFAULT_ALERTS, day = new Date() } = {}) {
  const c = item.state?.category ?? item.category;
  if (c === 'COMPLETED' || c === 'CANCELLED') return null;
  if (st && item.baselineStart && item.baselineEnd) {
    const kinds = kindsFor(item, st, day, cfg).filter(k => RISK_LABEL[k] && (k !== 'DUE_SOON' || (st.variance ?? 0) < 0));
    const k = ORDER.find(x => kinds.includes(x));
    return k ? { code: k, label: RISK_LABEL[k], days: k === 'OVERDUE' ? st.lateDays ?? null : k === 'DUE_SOON' ? st.daysLeft ?? null : null } : null;
  }
  if (!item.dueDate) return null;
  const left = M.vnDay(item.dueDate) - M.vnDay(day);
  if (left < 0) return { code: 'OVERDUE', label: RISK_LABEL.OVERDUE, days: -left };
  if (left <= TASK_DUE_SOON_DAYS) return { code: 'DUE_SOON', label: RISK_LABEL.DUE_SOON, days: left };
  return null;
}
// Đã nhắc gần đây chưa (theo chu kỳ của loại)?
function shouldSend(kind, lastAt, day) {
  if (!lastAt) return true;
  const every = REPEAT[kind];
  return every > 0 && M.vnDay(day) - M.vnDay(lastAt) >= every;
}
const num = n => String(n).replace('.', ',');
const fmt = d => (d ? new Date(new Date(d).getTime() + 7 * 3_600_000).toISOString().slice(0, 10).split('-').reverse().join('/') : '—');

// Người nhận một loại cảnh báo: người chủ trì; lãnh đạo bộ phận chủ trì; PMO khi chậm / trễ; Ban lãnh đạo khi việc găng / mốc chậm, trễ.
function recipientsFor(kind, r, { leaders = [], pmo = [], directors = [], hasKids = false } = {}) {
  const assignees = r.assignees.map(x => x.userId);
  if (kind === 'STALE') return [...new Set(assignees.length ? assignees : leaders)];
  const to = hasKids ? [...leaders] : [...assignees, ...leaders];
  if (['LATE_START', 'BEHIND', 'OVERDUE'].includes(kind)) to.push(...pmo);
  if ((r.critical || r.milestone) && ['BEHIND', 'OVERDUE'].includes(kind)) to.push(...directors);
  return [...new Set(to)];
}
// Thứ tự trình bày khi gộp: nặng trước.
const ORDER = ['OVERDUE', 'LATE_START', 'BEHIND', 'DUE_SOON', 'STALE', 'AHEAD', 'START_SOON'];
// Dòng chi tiết của một loại cảnh báo; số liệu ghi rõ "(lúc gửi)" vì tiến độ có thể đã đổi khi người nhận mở thông báo.
function detailOf(kind, r, st, a) {
  if (kind === 'START_SOON') return `Bắt đầu theo kế hoạch ${fmt(r.baselineStart)} (còn ${st.startsIn} ngày)`;
  if (kind === 'OVERDUE') return `Quá hạn kế hoạch ${st.lateDays} ngày (hạn ${fmt(r.baselineEnd)}) · thực tế ${num(a)}% (lúc gửi)`;
  if (kind === 'DUE_SOON') return `Hạn kế hoạch ${fmt(r.baselineEnd)} (còn ${st.daysLeft} ngày) · thực tế ${num(a)}% (lúc gửi)`;
  if (kind === 'STALE') return `Chưa cập nhật tiến độ từ ${fmt(r.progressAt || r.startedAt)}`;
  return `Kế hoạch ${num(st.planned)}% · thực tế ${num(a)}%, lệch ${st.variance > 0 ? '+' : ''}${num(st.variance)} điểm (lúc gửi)`;
}
// Một thông báo gộp cho một việc: tiêu đề nêu mọi loại cảnh báo, nội dung mỗi loại một dòng (bỏ dòng trùng), ngày gửi.
function mergedMessage(project, r, st, a, kinds, day = new Date()) {
  const ks = [...new Set(kinds)].sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y));
  const labels = ks.map(k => KIND_LABEL[k]).join(' · ');
  const code = `${project.key}-${r.number}`;
  const lines = [...new Set(ks.map(k => detailOf(k, r, st, a)))];
  return {
    code, labels, link: `#/projects/${project.id}?item=${r.id}`,
    title: `[${labels}] ${code} · ${String(r.title).slice(0, 80)}${r.critical ? ' (đường găng)' : ''}`,
    body: [...lines, `Gửi ngày ${fmt(day)} — mở việc để xem số liệu hiện tại.`].join('\n'),
  };
}

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
    // Mọi loại cảnh báo đến hạn của một việc → MỘT thông báo gộp (không gửi nhiều thông báo rời cho cùng một việc).
    const due = [];
    for (const kind of kindsFor(r, st, day, cfg)) {
      if (!shouldSend(kind, lastAt.get(`${r.id}:${kind}`), day)) continue;
      const leaders = await leadersOf(r.leadDepartmentId);
      const to = recipientsFor(kind, r, { leaders, pmo, directors, hasKids: parents.has(r.id) });
      const created = await prisma.progressAlert.createMany({ data: [{ projectId: project.id, workItemId: r.id, kind, level: LEVEL[kind], day: dayDate, variance: st.variance ?? null, lateDays: st.lateDays ?? null, recipients: to.length }], skipDuplicates: true });
      if (!created.count) continue;
      alerts++;
      due.push({ kind, to });
    }
    if (!due.length) continue;
    const msg = mergedMessage(project, r, st, a, due.map(x => x.kind), day);
    const to = [...new Set(due.flatMap(x => x.to))];
    // Thông báo cũ chưa đọc của cùng việc đã bị thay bằng thông báo mới (số liệu cũ không còn đúng) → đánh dấu đã đọc.
    if (to.length) await prisma.notification.updateMany({ where: { type: 'MTL_ALERT', link: msg.link, userId: { in: to }, readAt: null }, data: { readAt: new Date() } });
    notified += await notify(prisma, to, { type: 'MTL_ALERT', title: msg.title, body: msg.body, link: msg.link });
    // Viber: tối thiểu hoá — chỉ mã hạng mục, loại cảnh báo, liên kết nội bộ (không tên việc, không số liệu).
    await viber.sendToUsers(prisma, to, `Kepler Hub — ${msg.labels}: ${msg.code}. Mở: ${viber.appLink(msg.link)}`).catch(() => {});
  }
  // Ảnh chụp tiến độ hôm nay: toàn dự án + từng bộ phận (đường cong S thực tế), tiến độ theo cây đầu việc như Dashboard.
  const leaves = rows.filter(r => !parents.has(r.id));
  const actualOf = i => actual.get(i.id) ?? i.progress;
  const snap = async (departmentId, list) => {
    const s = M.treeProgress(list, actualOf, day);
    if (s.plannedPct == null) return;
    await prisma.progressSnapshot.upsert({ where: { projectId_departmentId_day: { projectId: project.id, departmentId, day: dayDate } },
      create: { projectId: project.id, departmentId, day: dayDate, plannedPct: s.plannedPct, actualPct: s.actualPct, spi: s.spi },
      update: { plannedPct: s.plannedPct, actualPct: s.actualPct, spi: s.spi } }).catch(async e => {
      // Prisma không upsert được khoá có null (departmentId = null) → cập nhật / tạo tay.
      if (departmentId !== null) throw e;
      // Khoá theo dự án: bấm "Chạy ngay" trùng lúc job chạy không tạo hai điểm cùng ngày trên đường cong S.
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'snapshot:' + project.id}))`;
        const ex = await tx.progressSnapshot.findFirst({ where: { projectId: project.id, departmentId: null, day: dayDate } });
        if (ex) await tx.progressSnapshot.update({ where: { id: ex.id }, data: { plannedPct: s.plannedPct, actualPct: s.actualPct, spi: s.spi } });
        else await tx.progressSnapshot.create({ data: { projectId: project.id, departmentId: null, day: dayDate, plannedPct: s.plannedPct, actualPct: s.actualPct, spi: s.spi } });
      });
    });
  };
  await snap(null, rows);
  for (const d of new Set(leaves.map(r => r.leadDepartmentId).filter(Boolean))) await snap(d, rows.filter(r => r.leadDepartmentId === d));
  return { project: project.id, alerts, notified };
}

async function runAllAlerts(prisma, day = new Date()) {
  const projects = await prisma.project.findMany({ where: { kind: 'MTL', archivedAt: null, deletedAt: null, t0Date: { not: null } } });
  const out = [], failed = [];
  // Một dự án lỗi không chặn cảnh báo của các dự án khác; cuối vòng báo lỗi tổng hợp để lịch chạy thử lại.
  for (const p of projects) { try { out.push(await runProjectAlerts(prisma, p, day)); } catch (error) { failed.push(`${p.key}: ${error.message}`); } }
  if (failed.length) throw new Error(`Cảnh báo MTL lỗi ở ${failed.length} dự án — ${failed.join('; ').slice(0, 200)}`);
  return out;
}

// Nhắc cập nhật tiến độ hằng tuần (chiều thứ Sáu): mỗi người MỘT thông báo trong ứng dụng — số việc trong kỳ cập nhật tháng hiện tại
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
  for (const [userId, n] of count) sent += await notify(prisma, [userId], { type: 'MTL_UPDATE_REMINDER', title: `Cập nhật tiến độ tuần này: ${n} việc trong kỳ này chưa cập nhật`, body: 'Mở "Cập nhật nhanh" và bấm % hoàn thành cho từng việc.', link: '#/sprint' });
  return { users: count.size, sent };
}

module.exports = { KIND_LABEL, REPEAT, LEVEL, kindsFor, isStarted, riskOf, RISK_LABEL, TASK_DUE_SOON_DAYS, shouldSend, recipientsFor, detailOf, mergedMessage, runProjectAlerts, runAllAlerts, runWeeklyUpdateReminder };
