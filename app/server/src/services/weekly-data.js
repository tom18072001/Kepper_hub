// Kepper GĐ2b — truy vấn dùng chung cho báo cáo tuần (API và lịch nhắc tự động).
const { permissionScope, isItAdmin } = require('../lib/permissions');
const P = require('../lib/policy');
const { notify } = require('./events');
const approval = require('./approval');
const WK = require('./weekly');

const CONFIG_KEY = 'weekly.config';
const ACTIVE_USER = { isActive: true, isRootAdmin: false, role: { not: 'admin' } };

async function weeklyConfig(prisma) {
  const row = await prisma.appSetting.findUnique({ where: { key: CONFIG_KEY } });
  const v = row?.value && typeof row.value === 'object' ? row.value : {};
  return {
    departments: Array.isArray(v.departments) ? v.departments.map(Number).filter(Number.isInteger) : [],
    startWeek: WK.isDay(v.startWeek) ? v.startWeek : null,
    points: v.points && typeof v.points === 'object' ? v.points : null,
    // Bộ phận làm thư ký giao ban (QC-TH-01 Điều 2, 5: Phòng Tổng hợp & Nhân sự) — thành viên bộ phận này có quyền thư ký.
    secretaryDepartmentId: Number.isInteger(v.secretaryDepartmentId) ? v.secretaryDepartmentId : null,
    // PMO do Ban GĐ chỉ định (không suy từ việc tự tạo / làm chủ một dự án MTL — tránh tự nâng quyền).
    pmoUserIds: Array.isArray(v.pmoUserIds) ? v.pmoUserIds.map(Number).filter(Number.isInteger) : [],
  };
}
// Ban giám đốc (vai trò director): chủ trì giao ban, nhận báo cáo — KHÔNG lập báo cáo tuần (QC-TH-01 Điều 2, 5).
const isDirector = user => user?.role === 'director';
// Vai trò nghiệp vụ trong giao ban (subject của lib/policy.js), suy ra từ vai trò + phòng ban đã gán cho tài khoản:
// - director: tài khoản vai trò Ban giám đốc — chủ trì, kết luận, KHÔNG lập báo cáo tuần;
// - secretary: thành viên bộ phận thư ký (Ban GĐ chọn trong thiết lập) — tổng hợp, điểm danh, Action Log, nhập thay, chấm điểm;
// - pmo: người Ban GĐ chỉ định làm PMO, hoặc tài khoản có quyền "Xem tổng hợp" toàn đơn vị mà không phải Ban GĐ — xem đầy đủ, không sửa;
// - leader: có quyền "Xem tổng hợp" (trưởng / phó bộ phận) — nhận bản tổng hợp mức tóm tắt (Điều 5);
// - mustReport: có phòng ban và không phải Ban GĐ.
async function rolesOf(prisma, user, cfg = null) {
  if (isItAdmin(user)) return { it: true, director: false, secretary: false, pmo: false, leader: false, mustReport: false, departmentId: user.departmentId ?? null, userId: user.id, manage: false, summary: false, full: false };
  const c = cfg || await weeklyConfig(prisma);
  const scope = permissionScope(user, 'reports.summary', 'VIEW');
  const director = isDirector(user);
  const secretary = c.secretaryDepartmentId != null && user.departmentId === c.secretaryDepartmentId;
  const pmo = c.pmoUserIds.includes(user.id) || (scope === 'SYSTEM' && !director);
  const s = { it: false, director, secretary, pmo, leader: !!scope, mustReport: !director && user.departmentId != null, departmentId: user.departmentId ?? null, userId: user.id };
  // Tiện cho giao diện / route: manage = sửa giao ban; summary = xem bản tổng hợp; full = xem chi tiết mọi bộ phận.
  return { ...s, manage: P.can(s, 'edit', 'weekly.meeting'), summary: P.can(s, 'view', 'weekly.summary'), full: P.can(s, 'view', 'weekly.summary.detail') };
}
// Bộ phận phải nộp: theo thiết lập (thứ tự trình bày giao ban); chưa thiết lập → bộ phận chủ trì hạng mục MTL đang chạy.
async function requiredDepartments(prisma, cfg) {
  const all = await prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
  if (cfg.departments.length) return { list: cfg.departments.map(id => all.find(d => d.id === id)).filter(Boolean), all, configured: true };
  const rows = await prisma.workItem.findMany({ where: { archivedAt: null, leadDepartmentId: { not: null }, project: { kind: 'MTL', archivedAt: null, deletedAt: null } }, distinct: ['leadDepartmentId'], select: { leadDepartmentId: true } });
  const ids = new Set(rows.map(r => r.leadDepartmentId));
  // Bộ phận của Ban giám đốc không nộp (Ban GĐ nhận báo cáo).
  const bgd = new Set((await prisma.user.findMany({ where: { ...ACTIVE_USER, role: 'director', departmentId: { not: null } }, distinct: ['departmentId'], select: { departmentId: true } })).map(u => u.departmentId));
  return { list: all.filter(d => ids.has(d.id) && !bgd.has(d.id)), all, configured: false };
}
async function userNames(prisma, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  const rows = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, fullName: true } });
  return Object.fromEntries(rows.map(u => [u.id, u.fullName]));
}
const rowOwnerIds = data => [...(data?.results || []), ...(data?.ongoing || []), ...(data?.plans || [])].flatMap(r => r.ownerIds || []);
const meetingOf = (prisma, week) => prisma.weeklyMeeting.findUnique({ where: { week } });

async function usersWhere(prisma, test) {
  const cfg = await weeklyConfig(prisma);
  const users = await prisma.user.findMany({ where: ACTIVE_USER, include: { permissions: true } });
  const out = [];
  for (const u of users) if (test(await rolesOf(prisma, u, cfg))) out.push(u.id);
  return out;
}
// Thư ký / Ban GĐ / PMO — nhận thông báo nộp muộn, vắng.
const managerIds = prisma => usersWhere(prisma, r => r.manage);
// Người nhận bản tổng hợp: TGĐ, thư ký, PMO và trưởng / phó các bộ phận (Điều 5).
const summaryViewerIds = prisma => usersWhere(prisma, r => r.summary);

// Action Log còn theo dõi tới tuần báo cáo f: việc của các buổi giao ban đã phát hành trong 12 tuần trước,
// trạng thái = dòng mới nhất (bản đã nộp) có actionRef đó; việc đã "Hoàn thành" ở tuần trước thì đóng (trừ việc của buổi liền trước).
async function openActions(prisma, f, departmentId = null) {
  const from = WK.addDays(f, -84), prevWeek = WK.addDays(f, -7);
  const meetings = await prisma.weeklyMeeting.findMany({ where: { week: { gte: from, lte: prevWeek }, publishedAt: { not: null } }, orderBy: { week: 'asc' } });
  const list = meetings.flatMap(m => (m.data?.actions || []).map(a => ({ ...a, ref: `${m.week}:${a.id}`, meetingWeek: m.week })))
    .filter(a => departmentId == null || a.departmentId === departmentId);
  if (!list.length) return { actions: [], rows: new Map() };
  const reps = await prisma.weeklyReport.findMany({ where: { week: { gt: from, lte: f }, firstSubmittedAt: { not: null }, departmentId: { in: [...new Set(list.map(a => a.departmentId))] } }, orderBy: { week: 'asc' } });
  const rows = new Map(), rowWeek = new Map();
  for (const r of reps) for (const x of [...(r.data?.results || []), ...(r.data?.ongoing || [])]) if (x.actionRef) { rows.set(x.actionRef, x); rowWeek.set(x.actionRef, r.week); }
  const actions = list.filter(a => a.meetingWeek === prevWeek || !(rows.get(a.ref)?.status === WK.DONE && rowWeek.get(a.ref) < f));
  return { actions, rows };
}

async function summaryOf(prisma, week, now = new Date()) {
  const cfg = await weeklyConfig(prisma), rd = await requiredDepartments(prisma, cfg);
  const [reports, notices, meeting] = await Promise.all([
    prisma.weeklyReport.findMany({ where: { week } }), prisma.weeklyNotice.findMany({ where: { week }, orderBy: { id: 'asc' } }), meetingOf(prisma, week),
  ]);
  const { actions, rows: actionRows } = await openActions(prisma, week);
  // Danh sách phải nộp của tuần được CHỤP lại sau hạn nộp — đổi thiết lập về sau không làm đổi điểm các tuần đã qua.
  const S = WK.scheduleOf(week, meeting);
  let required = Array.isArray(meeting?.data?.required) ? meeting.data.required : null;
  if (!required && now > S.deadline) { required = rd.list.map(d => d.id); await snapshotRequired(prisma, week, required); }
  const list = required ? required.map(id => rd.all.find(d => d.id === id)).filter(Boolean) : rd.list;
  // Bộ phận đã nộp nhưng không có trong danh sách vẫn hiện (cuối danh sách).
  const extra = rd.all.filter(d => !list.some(x => x.id === d.id) && reports.some(r => r.departmentId === d.id && r.firstSubmittedAt));
  const depts = [...list, ...extra];
  const ids = [...reports.flatMap(r => [r.submittedById, r.preparerId, ...rowOwnerIds(r.data)]), ...notices.flatMap(n => [n.createdById, n.substituteId]),
    ...actions.map(a => a.ownerId), ...(meeting?.data?.actions || []).map(a => a.ownerId)];
  const names = await userNames(prisma, ids);
  const sum = WK.buildSummary({ week, depts, reports, notices, meeting, actions, actionRows, now, userName: id => names[id] || '' });
  return { sum, names, depts, all: rd.all, configured: rd.configured, cfg };
}
async function snapshotRequired(prisma, week, required) {
  const m = await meetingOf(prisma, week);
  const data = { ...(m?.data || {}), required };
  await prisma.weeklyMeeting.upsert({ where: { week }, create: { week, data }, update: { data } });
}

// ---------- Lịch tự động ----------
// 15:00 ngày hạn nộp (thứ Sáu, hoặc ngày làm việc liền trước khi nghỉ lễ): nhắc trưởng bộ phận + người lập tuần trước chưa nộp.
async function runReportReminder(prisma, now = new Date()) {
  const week = WK.currentFriday(now), S = WK.scheduleOf(week, await meetingOf(prisma, week));
  if (WK.dayOf(now) !== S.deadlineDay) return { skipped: true, sent: 0 };
  const cfg = await weeklyConfig(prisma), rd = await requiredDepartments(prisma, cfg);
  if (S.skip) return { skipped: true, sent: 0 };
  await snapshotRequired(prisma, week, rd.list.map(d => d.id));
  let sent = 0, departments = 0;
  for (const d of rd.list) {
    const rep = await prisma.weeklyReport.findUnique({ where: { departmentId_week: { departmentId: d.id, week } } });
    if (rep?.firstSubmittedAt) continue;
    const prev = await prisma.weeklyReport.findUnique({ where: { departmentId_week: { departmentId: d.id, week: WK.addDays(week, -7) } } });
    const to = [...await approval.deptLeaderIds(prisma, d.id), prev?.preparerId, rep?.preparerId].filter(Boolean);
    departments++;
    sent += await notify(prisma, to, { type: 'WEEKLY_REMINDER', title: `Báo cáo tuần ${d.name}: hạn nộp 17:30 hôm nay`, body: rep ? 'Bản nháp đã có — kiểm tra rồi bấm "Gửi báo cáo".' : 'Báo cáo đã điền sẵn từ MTL — chỉ cần sửa chỗ khác thực tế rồi gửi.', link: '#/tuan' });
  }
  return { departments, sent };
}
// 07:35 ngày giao ban: gửi tóm tắt tổng hợp cho TGĐ, thư ký, PMO, trưởng bộ phận.
async function runSummaryNotice(prisma, now = new Date()) {
  const today = WK.dayOf(now), cf = WK.currentFriday(now);
  for (const week of [cf, WK.addDays(cf, -7)]) {
    const S = WK.scheduleOf(week, await meetingOf(prisma, week));
    if (S.meetingDay !== today || S.skip) continue;
    const { sum } = await summaryOf(prisma, week, now);
    const k = sum.kpis;
    const sent = await notify(prisma, await summaryViewerIds(prisma), { type: 'WEEKLY_SUMMARY', title: `Tổng hợp giao ban ${WK.fmtD(today)}: ${k.submitted}/${k.total} bộ phận đã nộp`, body: `${k.stuck} chậm/vướng · ${k.overdue} quá hạn · ${k.helps} yêu cầu hỗ trợ`, link: `#/tuan/tong-hop?w=${week}` });
    return { week, sent };
  }
  return { skipped: true, sent: 0 };
}

module.exports = { CONFIG_KEY, ACTIVE_USER, weeklyConfig, isDirector, rolesOf, requiredDepartments, userNames, rowOwnerIds, meetingOf, managerIds, summaryViewerIds, summaryOf, openActions, snapshotRequired, runReportReminder, runSummaryNotice };
