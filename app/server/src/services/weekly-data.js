// Kepper GĐ2b — truy vấn dùng chung cho báo cáo tuần (API và lịch nhắc tự động).
const { permissionScope, isItAdmin } = require('../lib/permissions');
const { notify } = require('./events');
const approval = require('./approval');
const WK = require('./weekly');

const CONFIG_KEY = 'weekly.config';
const ACTIVE_USER = { isActive: true, isRootAdmin: false, role: { not: 'admin' } };

async function weeklyConfig(prisma) {
  const row = await prisma.appSetting.findUnique({ where: { key: CONFIG_KEY } });
  const v = row?.value && typeof row.value === 'object' ? row.value : {};
  return { departments: Array.isArray(v.departments) ? v.departments.map(Number).filter(Number.isInteger) : [], startWeek: WK.isDay(v.startWeek) ? v.startWeek : null, points: v.points && typeof v.points === 'object' ? v.points : null };
}
// PMO: trưởng dự án hoặc chủ dự án (OWNER) của một dự án MTL đang chạy.
async function isPmo(prisma, user) {
  return !!(await prisma.project.findFirst({ where: { kind: 'MTL', archivedAt: null, deletedAt: null, OR: [{ leadId: user.id }, { members: { some: { userId: user.id, role: 'OWNER' } } }] }, select: { id: true } }));
}
// manage: thư ký giao ban (quyền "Xem tổng hợp" toàn đơn vị), Ban GĐ, PMO. summary: thêm trưởng / phó bộ phận.
async function rolesOf(prisma, user) {
  if (isItAdmin(user)) return { manage: false, summary: false, it: true };
  const scope = permissionScope(user, 'reports.summary', 'VIEW');
  const manage = scope === 'SYSTEM' || await isPmo(prisma, user);
  return { manage, summary: manage || !!scope, it: false };
}
// Bộ phận phải nộp: theo thiết lập (thứ tự trình bày giao ban); chưa thiết lập → bộ phận chủ trì hạng mục MTL đang chạy.
async function requiredDepartments(prisma, cfg) {
  const all = await prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
  if (cfg.departments.length) return { list: cfg.departments.map(id => all.find(d => d.id === id)).filter(Boolean), all, configured: true };
  const rows = await prisma.workItem.findMany({ where: { archivedAt: null, leadDepartmentId: { not: null }, project: { kind: 'MTL', archivedAt: null, deletedAt: null } }, distinct: ['leadDepartmentId'], select: { leadDepartmentId: true } });
  const ids = new Set(rows.map(r => r.leadDepartmentId));
  return { list: all.filter(d => ids.has(d.id)), all, configured: false };
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
  const users = await prisma.user.findMany({ where: ACTIVE_USER, include: { permissions: true } });
  const out = [];
  for (const u of users) if (await test(u)) out.push(u.id);
  return out;
}
// Thư ký / Ban GĐ / PMO — nhận thông báo nộp muộn, vắng.
const managerIds = prisma => usersWhere(prisma, async u => permissionScope(u, 'reports.summary', 'VIEW') === 'SYSTEM' || isPmo(prisma, u));
// Người nhận bản tổng hợp: TGĐ, thư ký, PMO và trưởng / phó các bộ phận (Điều 5).
const summaryViewerIds = prisma => usersWhere(prisma, async u => !!permissionScope(u, 'reports.summary', 'VIEW') || isPmo(prisma, u));

async function summaryOf(prisma, week, now = new Date()) {
  const cfg = await weeklyConfig(prisma), rd = await requiredDepartments(prisma, cfg);
  const [reports, notices, meeting, prevMeeting] = await Promise.all([
    prisma.weeklyReport.findMany({ where: { week } }), prisma.weeklyNotice.findMany({ where: { week }, orderBy: { id: 'asc' } }), meetingOf(prisma, week), meetingOf(prisma, WK.addDays(week, -7)),
  ]);
  // Bộ phận đã nộp nhưng không có trong danh sách vẫn hiện (cuối danh sách).
  const extra = rd.all.filter(d => !rd.list.some(x => x.id === d.id) && reports.some(r => r.departmentId === d.id && r.firstSubmittedAt));
  const depts = [...rd.list, ...extra];
  const ids = [...reports.flatMap(r => [r.submittedById, r.preparerId, ...rowOwnerIds(r.data)]), ...notices.flatMap(n => [n.createdById, n.substituteId]),
    ...(prevMeeting?.data?.actions || []).map(a => a.ownerId), ...(meeting?.data?.actions || []).map(a => a.ownerId)];
  const names = await userNames(prisma, ids);
  const sum = WK.buildSummary({ week, depts, reports, notices, meeting, prevMeeting, now, userName: id => names[id] || '' });
  return { sum, names, depts, all: rd.all, configured: rd.configured, cfg };
}

// ---------- Lịch tự động ----------
// 15:00 ngày hạn nộp (thứ Sáu, hoặc ngày làm việc liền trước khi nghỉ lễ): nhắc trưởng bộ phận + người lập tuần trước chưa nộp.
async function runReportReminder(prisma, now = new Date()) {
  const week = WK.currentFriday(now), S = WK.scheduleOf(week, await meetingOf(prisma, week));
  if (WK.dayOf(now) !== S.deadlineDay) return { skipped: true, sent: 0 };
  const cfg = await weeklyConfig(prisma), rd = await requiredDepartments(prisma, cfg);
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
    if (S.meetingDay !== today) continue;
    const { sum } = await summaryOf(prisma, week, now);
    const k = sum.kpis;
    const sent = await notify(prisma, await summaryViewerIds(prisma), { type: 'WEEKLY_SUMMARY', title: `Tổng hợp giao ban ${WK.fmtD(today)}: ${k.submitted}/${k.total} bộ phận đã nộp`, body: `${k.stuck} chậm/vướng · ${k.overdue} quá hạn · ${k.helps} yêu cầu hỗ trợ`, link: `#/tuan/tong-hop?w=${week}` });
    return { week, sent };
  }
  return { skipped: true, sent: 0 };
}

module.exports = { CONFIG_KEY, ACTIVE_USER, weeklyConfig, isPmo, rolesOf, requiredDepartments, userNames, rowOwnerIds, meetingOf, managerIds, summaryViewerIds, summaryOf, runReportReminder, runSummaryNotice };
