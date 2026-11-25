// Kepper GĐ2b — truy vấn dùng chung cho báo cáo tuần (API và lịch nhắc tự động).
const { permissionScope, isItAdmin, isBoard, NOT_IT_WHERE, BOARD_WHERE } = require('../lib/permissions');
const P = require('../lib/policy');
const { notify } = require('./events');
const approval = require('./approval');
const WK = require('./weekly');

const CONFIG_KEY = 'weekly.config';
const ACTIVE_USER = { isActive: true, ...NOT_IT_WHERE };

async function weeklyConfig(prisma) {
  const row = await prisma.appSetting.findUnique({ where: { key: CONFIG_KEY } });
  const v = row?.value && typeof row.value === 'object' ? row.value : {};
  return {
    departments: Array.isArray(v.departments) ? v.departments.map(Number).filter(Number.isInteger) : [],
    startWeek: WK.isDay(v.startWeek) ? v.startWeek : null,
    points: v.points && typeof v.points === 'object' ? v.points : null,
    // Bộ phận làm thư ký giao ban (QC-TH-01 Điều 2, 5: Phòng Tổng hợp & Nhân sự) — thành viên bộ phận này có quyền thư ký.
    secretaryDepartmentId: Number.isInteger(v.secretaryDepartmentId) ? v.secretaryDepartmentId : null,
    // PMO do Ban TGĐ chỉ định (không suy từ việc tự tạo / làm chủ một dự án MTL — tránh tự nâng quyền).
    pmoUserIds: Array.isArray(v.pmoUserIds) ? v.pmoUserIds.map(Number).filter(Number.isInteger) : [],
    pmoConfigured: Array.isArray(v.pmoUserIds),
  };
}
// Ban Tổng Giám đốc (vai BTGĐ, lib/permissions.js isBoard): chủ trì giao ban, nhận báo cáo — KHÔNG lập báo cáo tuần (QC-TH-01 Điều 2, 5).
// Vai trò nghiệp vụ trong giao ban (subject của lib/policy.js), suy ra từ vai trò + phòng ban đã gán cho tài khoản:
// - director: tài khoản vai trò Ban TGĐ — chủ trì, kết luận, KHÔNG lập báo cáo tuần;
// - secretary: thành viên bộ phận thư ký (Ban TGĐ chọn trong thiết lập) — tổng hợp, điểm danh, Action Log, nhập thay, chấm điểm;
// - pmo: người Ban TGĐ chỉ định làm PMO (chưa thiết lập danh sách: tạm dùng quyền "Xem tổng hợp" toàn đơn vị) — xem đầy đủ, không sửa;
// - leader: có quyền "Xem tổng hợp" (trưởng / phó bộ phận) — nhận bản tổng hợp mức tóm tắt (Điều 5);
// - mustReport: có phòng ban và không phải Ban TGĐ.
async function rolesOf(prisma, user, cfg = null) {
  if (isItAdmin(user)) return { it: true, director: false, secretary: false, pmo: false, leader: false, mustReport: false, departmentId: user.departmentId ?? null, userId: user.id, manage: false, summary: false, full: false };
  const c = cfg || await weeklyConfig(prisma);
  const scope = permissionScope(user, 'reports.summary', 'VIEW');
  const director = isBoard(user);
  // Ban TGĐ không kiêm thư ký (không tự trình rồi tự duyệt bảng điểm, không nhập thay).
  const secretary = !director && c.secretaryDepartmentId != null && user.departmentId === c.secretaryDepartmentId;
  // PMO = danh sách Ban TGĐ chỉ định. Chỉ khi Ban TGĐ CHƯA thiết lập danh sách mới tạm dùng quyền "Xem tổng hợp" toàn đơn vị (khởi tạo).
  const pmo = !director && (c.pmoConfigured ? c.pmoUserIds.includes(user.id) : scope === 'SYSTEM');
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
  // Bộ phận của Ban TGĐ không nộp (Ban TGĐ nhận báo cáo).
  const bgd = new Set((await prisma.user.findMany({ where: { isActive: true, ...BOARD_WHERE, departmentId: { not: null } }, distinct: ['departmentId'], select: { departmentId: true } })).map(u => u.departmentId));
  return { list: all.filter(d => ids.has(d.id) && !bgd.has(d.id)), all, configured: false };
}
async function userNames(prisma, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  const rows = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, fullName: true } });
  return Object.fromEntries(rows.map(u => [u.id, u.fullName]));
}
const rowOwnerIds = data => [...(data?.results || []), ...(data?.ongoing || []), ...(data?.risks || []), ...(data?.plans || [])].flatMap(r => r.ownerIds || []);
const meetingOf = (prisma, week) => prisma.weeklyMeeting.findUnique({ where: { week } });

async function usersWhere(prisma, test) {
  const cfg = await weeklyConfig(prisma);
  const users = await prisma.user.findMany({ where: ACTIVE_USER });
  const out = [];
  for (const u of users) if (test(await rolesOf(prisma, u, cfg))) out.push(u.id);
  return out;
}
// Thư ký / Ban TGĐ / PMO — nhận thông báo nộp muộn, vắng.
const managerIds = prisma => usersWhere(prisma, r => r.manage);
// Người nhận bản tổng hợp: TGĐ, thư ký, PMO và trưởng / phó các bộ phận (Điều 5).
const summaryViewerIds = prisma => usersWhere(prisma, r => r.summary);
// Thư ký giao ban: thành viên đang hoạt động của bộ phận thư ký, trừ vai Ban TGĐ, Quản trị hệ thống (rolesOf).
const secretaryIds = prisma => usersWhere(prisma, r => r.secretary);
// Thành viên Ban Tổng Giám đốc đang hoạt động (lib/permissions.js BOARD_WHERE).
const boardIds = async prisma => (await prisma.user.findMany({ where: { ...BOARD_WHERE, isActive: true }, select: { id: true } })).map(u => u.id);
// Chỉ giữ tài khoản đang hoạt động, không phải Quản trị hệ thống; bỏ trùng. Người được uỷ quyền, người lập báo cáo tuần trước
// có thể đã nghỉ việc / đổi sang vai quản trị — không gửi thông báo nghiệp vụ cho họ.
async function activeIds(prisma, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return [];
  return (await prisma.user.findMany({ where: { id: { in: list }, ...ACTIVE_USER }, select: { id: true } })).map(u => u.id);
}
// Lãnh đạo (kể cả người đang được uỷ quyền) của các bộ phận; leaderIdsOf: chỉ tài khoản đang hoạt động.
const leadersOf = async (prisma, deptIds) => (await Promise.all(deptIds.map(id => approval.deptLeaderIds(prisma, id)))).flat();
const leaderIdsOf = async (prisma, deptIds) => activeIds(prisma, await leadersOf(prisma, deptIds));

// ---------- Đổi lịch một tuần: báo các bộ phận (QC-TH-01 Điều 3) ----------
// Người nhận: lãnh đạo các bộ phận phải nộp tuần đó (danh sách đã chụp của tuần; chưa chụp thì theo thiết lập), người lập báo cáo
// tuần trước và người đang lập báo cáo tuần đó của các bộ phận ấy (như nhắc 15:00). Chỉ tài khoản đang hoạt động, không Quản trị hệ thống.
async function scheduleRecipients(prisma, week, meeting = null) {
  const rd = await requiredDepartments(prisma, await weeklyConfig(prisma));
  const snap = Array.isArray(meeting?.data?.required) ? meeting.data.required : null;
  const ids = (snap ? rd.all.filter(d => snap.includes(d.id)) : rd.list).map(d => d.id);
  if (!ids.length) return [];
  const reps = await prisma.weeklyReport.findMany({ where: { departmentId: { in: ids }, week: { in: [WK.addDays(week, -7), week] } }, select: { preparerId: true } });
  return activeIds(prisma, [...await leadersOf(prisma, ids), ...reps.map(r => r.preparerId)]);
}
// Lịch hiệu lực của tuần đổi thật (WK.scheduleChange) → một thông báo cho mỗi người nhận, trừ người vừa đổi. Trả số người được báo
// (0: không đổi gì, tuần đã họp, hoặc không có ai để báo). Liên kết mở thẳng tab Nộp báo cáo của đúng tuần đó.
async function notifyScheduleChange(prisma, { week, before, after, meeting = null, now = new Date(), actorId = null }) {
  const msg = WK.scheduleChange(before, after, now);
  if (!msg) return 0;
  return notify(prisma, await scheduleRecipients(prisma, week, meeting), { type: 'WEEKLY_SCHEDULE', ...msg, link: `#/tuan?w=${week}` }, actorId);
}

// Action Log còn theo dõi tới tuần báo cáo f: việc của các buổi giao ban đã phát hành trong 12 tuần trước,
// trạng thái = dòng mới nhất (bản đã nộp) có actionRef đó; việc đã "Hoàn thành" ở tuần trước thì đóng (trừ việc của buổi liền trước).
async function openActions(prisma, f, departmentId = null) {
  const from = WK.addDays(f, -84), prevWeek = WK.addDays(f, -7);
  const meetings = await prisma.weeklyMeeting.findMany({ where: { week: { gte: from, lte: prevWeek }, publishedAt: { not: null } }, orderBy: { week: 'asc' } });
  const list = meetings.flatMap(m => (m.data?.actions || []).map(a => ({ ...a, ref: `${m.week}:${a.id}`, meetingWeek: m.week })))
    .filter(a => departmentId == null || a.departmentId === departmentId);
  if (!list.length) return { actions: [], rows: new Map() };
  const reps = await prisma.weeklyReport.findMany({ where: { week: { gt: from, lte: f }, firstSubmittedAt: { not: null }, departmentId: { in: [...new Set(list.map(a => a.departmentId))] } }, orderBy: { week: 'asc' } });
  const rows = new Map(), rowWeek = new Map(), ownerDept = new Map(list.map(a => [a.ref, a.departmentId]));
  // Chỉ báo cáo của ĐÚNG bộ phận được giao mới cập nhật / đóng được việc trong Action Log (bộ phận khác gửi actionRef thì bỏ qua).
  for (const r of reps) for (const x of [...(r.data?.results || []), ...(r.data?.ongoing || []), ...(r.data?.risks || [])])
    if (x.actionRef && ownerDept.get(x.actionRef) === r.departmentId) { rows.set(x.actionRef, x); rowWeek.set(x.actionRef, r.week); }
  const actions = list.filter(a => a.meetingWeek === prevWeek || !(rows.get(a.ref)?.status === WK.DONE && rowWeek.get(a.ref) < f));
  return { actions, rows };
}

// auto: false → bỏ dòng "Hệ thống tự bổ sung" trước khi tổng hợp (bản tóm tắt cho trưởng / phó, thông báo gửi cả trưởng / phó) —
// số liệu bản tóm tắt không để lộ việc người nhận không được xem (services/weekly.js addAutoRows).
async function summaryOf(prisma, week, now = new Date(), { auto = true } = {}) {
  const cfg = await weeklyConfig(prisma), rd = await requiredDepartments(prisma, cfg);
  const [reports, notices, meeting] = await Promise.all([
    prisma.weeklyReport.findMany({ where: { week } }).then(rs => (auto ? rs : rs.map(r => ({ ...r, data: WK.withoutAuto(r.data) })))), prisma.weeklyNotice.findMany({ where: { week }, orderBy: { id: 'asc' } }), meetingOf(prisma, week),
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
// Ghi vào WeeklyMeeting.data luôn trong khoá 'meeting:<tuần>' và đọc lại trong khoá (không mất cập nhật của người khác).
const meetingLock = (tx, week) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'meeting:' + week}))`;
async function snapshotRequired(prisma, week, required) {
  await prisma.$transaction(async tx => {
    await meetingLock(tx, week);
    const m = await tx.weeklyMeeting.findUnique({ where: { week } });
    if (Array.isArray(m?.data?.required) && JSON.stringify(m.data.required) === JSON.stringify(required)) return;
    const data = { ...(m?.data || {}), required };
    await tx.weeklyMeeting.upsert({ where: { week }, create: { week, data }, update: { data } });
  });
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
    sent += await notify(prisma, to, { type: 'WEEKLY_REMINDER', title: `Báo cáo tuần ${d.name}: hạn nộp 17:30 hôm nay`, body: rep ? 'Bản nháp đã có — kiểm tra rồi bấm "Gửi báo cáo".' : 'Báo cáo đã điền sẵn — bạn chỉ sửa chỗ chưa đúng rồi gửi.', link: '#/tuan' });
  }
  return { departments, sent };
}
// 07:35 ngày giao ban: gửi tóm tắt tổng hợp cho TGĐ, thư ký, PMO, trưởng bộ phận.
async function runSummaryNotice(prisma, now = new Date()) {
  const today = WK.dayOf(now), cf = WK.currentFriday(now);
  for (const week of [cf, WK.addDays(cf, -7)]) {
    const S = WK.scheduleOf(week, await meetingOf(prisma, week));
    if (S.meetingDay !== today || S.skip) continue;
    const { sum } = await summaryOf(prisma, week, now); // số liệu giống nhau với mọi người nhận (dòng tự bổ sung chỉ đếm)
    const k = sum.kpis;
    const sent = await notify(prisma, await summaryViewerIds(prisma), { type: 'WEEKLY_SUMMARY', title: `Tổng hợp giao ban ${WK.fmtD(today)}: ${k.submitted}/${k.total} bộ phận đã nộp`, body: `${k.stuck} chậm/vướng · ${k.overdue} quá hạn · ${k.helps} yêu cầu hỗ trợ`, link: `#/tuan/tong-hop?w=${week}` });
    return { week, sent };
  }
  return { skipped: true, sent: 0 };
}

module.exports = { meetingLock, CONFIG_KEY, ACTIVE_USER, weeklyConfig, rolesOf, requiredDepartments, userNames, rowOwnerIds, meetingOf, managerIds, summaryViewerIds, summaryOf, openActions, snapshotRequired, runReportReminder, runSummaryNotice,
  secretaryIds, boardIds, activeIds, leaderIdsOf, scheduleRecipients, notifyScheduleChange };
