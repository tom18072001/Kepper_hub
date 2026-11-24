// Kepper GĐ2b — Báo cáo tuần bộ phận (BM-TH-01), báo nộp muộn / vắng, tổng hợp giao ban, Action Log, chấm điểm tuân thủ.
// MỌI quyết định quyền đi qua lib/policy.js (ma trận vai trò × dữ liệu × hành động); vai trò suy ra bằng weekly-data.rolesOf()
// từ vai trò + phòng ban của tài khoản, bộ phận thư ký và danh sách PMO do Ban GĐ chọn. Quản trị IT không xem nội dung nghiệp vụ.
const crypto = require('node:crypto');
const { fail, intParam } = require('../lib/http');
const P = require('../lib/policy');
const { visibleProjectsWhere, itemVisibleWhere, loadItem } = require('../services/access');
const A = require('../services/alerts');
const { notify } = require('../services/events');
const approval = require('../services/approval');
const bus = require('../services/bus');
const M = require('../services/mtl');
const MP = require('../services/mtl-project');
const WK = require('../services/weekly');
const D = require('../services/weekly-data');
const { setProgress } = require('../services/mtl-progress');
const R = require('../services/register'); // thiết lập số ngày cảnh báo sắp đến hạn (dueSoonDays)

const { weeklyConfig, requiredDepartments, userNames, rowOwnerIds, ACTIVE_USER } = D;
const weekParam = (v, now = new Date()) => {
  if (v == null || v === '') return WK.currentFriday(now);
  if (!WK.isFriday(String(v))) fail(422, 'Tuần báo cáo phải là một ngày thứ Sáu (YYYY-MM-DD)', 'INVALID_WEEK');
  return String(v);
};
const reportOut = (r, names) => r && ({
  id: r.id, status: r.status, data: r.data, firstSubmittedAt: r.firstSubmittedAt, submittedAt: r.submittedAt, submitCount: r.submitCount,
  submittedBy: names[r.submittedById] || null, preparer: names[r.preparerId] || null, updatedAt: r.updatedAt,
});
// Băm trên JSON chuẩn hoá (khoá sắp xếp): kiểm lại được từ bản đọc ra CSDL (JSONB đổi thứ tự khoá).
const sha256 = v => crypto.createHash('sha256').update(WK.stableStringify(v)).digest('hex');
// Một khoá cho mọi lần ghi báo cáo của một bộ phận / tuần (nháp, nộp): không có hai lần ghi chen nhau.
const reportLock = (tx, departmentId, week) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'weekly:' + departmentId + ':' + week}))`;
// Dòng có actionRef không thuộc Action Log đang mở của CHÍNH bộ phận này → bỏ liên kết (không đóng hộ việc của bộ phận khác).
// Chuỗi xử lý khi nộp + bỏ liên kết Action Log của bộ phận khác: services/weekly-submit.js (route và test dùng chung).
const WS = require('../services/weekly-submit');
const { stripForeignActions } = WS;
const COMPLIANCE_KEY = month => `weekly.compliance.${month}`;
// Phạm vi BỘ PHẬN (mục S10): đọc mọi việc như người xem toàn hệ thống — chỉ để tính tập việc phải báo cáo của bộ phận và dòng
// "Hệ thống tự bổ sung" lúc nộp; không bao giờ trả thẳng cho người dùng (đầu ra lọc theo quyền xem: hideUnseen bên dưới).
const DEPT_SCOPE = Object.freeze({ id: 0, role: 'system', departmentId: null, permissions: [{ permissionKey: 'work.view', action: 'VIEW', scope: 'SYSTEM' }] });

module.exports = function mountWeekly(app, { prisma, auth, audit }) {
  const subjectOf = async req => {
    const s = await D.rolesOf(prisma, req.user);
    if (s.it) fail(403, 'Tài khoản quản trị hệ thống không xem nội dung nghiệp vụ', 'FORBIDDEN');
    return s;
  };
  const meetingOf = week => D.meetingOf(prisma, week);
  // Quyền trên báo cáo của một bộ phận (policy weekly.report).
  const deptAccess = async (s, departmentId, need) => {
    const dept = await prisma.department.findFirst({ where: { id: departmentId, isActive: true }, select: { id: true, name: true } });
    if (!dept) fail(404, 'Không tìm thấy bộ phận', 'NOT_FOUND');
    const ctx = { departmentId };
    if (need === 'edit') P.assertCan(s, 'edit', 'weekly.report', ctx); else P.assertCan(s, 'view', 'weekly.report', ctx);
    const own = s.departmentId === departmentId && !s.director;
    const canEdit = P.can(s, 'edit', 'weekly.report', ctx);
    return { dept, own, canEdit, onBehalf: canEdit && !own };
  };

  // ---------- Danh mục, tuần, quyền (giao diện dựng theo đây; máy chủ vẫn kiểm từng lời gọi) ----------
  app.get('/api/weekly/context', auth, async (req, res) => {
    const s = await subjectOf(req);
    const cfg = await weeklyConfig(prisma), rd = await requiredDepartments(prisma, cfg);
    const now = new Date(), cur = WK.currentFriday(now), prevWeek = WK.addDays(cur, -7);
    // Buổi giao ban sáng thứ Hai xét tuần TRƯỚC (tuần hiện tại đã sang tuần mới): giao diện chỉ đường tới tuần đó khi chưa phát hành.
    const prevMeeting = s.summary ? await meetingOf(prevWeek) : null;
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      week: cur, weeks: Array.from({ length: 10 }, (_, k) => WK.addDays(cur, (1 - k) * 7)), schedule: WK.scheduleOf(cur, await meetingOf(cur)),
      ...(s.summary ? { prev: { week: prevWeek, schedule: WK.scheduleOf(prevWeek, prevMeeting), publishedAt: prevMeeting?.publishedAt || null } } : {}),
      me: { departmentId: req.user.departmentId, role: req.user.role, director: s.director, secretary: s.secretary, pmo: s.pmo, leader: s.leader, mustReport: s.mustReport,
        canManage: s.manage, canSummary: s.summary, canDetail: s.full, canOnBehalf: s.secretary, canConfig: P.can(s, 'edit', 'weekly.config'), canRoles: P.can(s, 'edit', 'weekly.roles'),
        canCompliance: P.can(s, 'view', 'weekly.compliance'), canApprove: s.director },
      ...(P.can(s, 'view', 'weekly.roles') ? { secretaryDepartmentId: cfg.secretaryDepartmentId, pmoUserIds: cfg.pmoUserIds } : { secretaryDepartmentId: null, pmoUserIds: [] }),
      departments: rd.all.map(d => ({ id: d.id, name: d.name })), required: rd.list.map(d => d.id), configured: rd.configured, startWeek: cfg.startWeek,
      sources: WK.SOURCES, statuses: WK.STATUSES, reasons: WK.REASONS, attendance: WK.ATTENDANCE, decisions: WK.DECISIONS, points: { ...WK.POINTS, ...(cfg.points || {}) }, pointLabels: WK.POINT_LABEL,
    });
  });

  // Hạng mục MTL người dùng xem được (cùng bộ lọc hiển thị như bảng theo dõi) + cấu hình cảnh báo của dự án.
  async function mtlItemsFor(user, now) {
    // Hạng mục MTL chưa có kế hoạch gốc: "sắp đến hạn" theo cùng thiết lập số ngày như việc thường và bản Word (dueSoonDays).
    const [{ dueSoonDays }, projects] = await Promise.all([R.getSettings(prisma), prisma.project.findMany({ where: { kind: 'MTL', archivedAt: null, ...visibleProjectsWhere(user) } })]);
    const out = [];
    for (const p of projects) {
      const { items, cfg } = await MP.computeProject(prisma, p, user, now);
      for (const i of items) {
        const st = { code: i.status, planned: i.planned, variance: i.variance, daysLeft: i.daysLeft, lateDays: i.lateDays, startsIn: i.startsIn };
        out.push({ ...i, kind: 'MTL', projectKey: p.key, projectId: p.id, cfg, dueSoonDays, done: M.isDone(i), cancelled: M.isCancelled(i),
          started: A.isStarted(i), risk: A.riskOf(i, { st, cfg, day: now, taskDueSoonDays: dueSoonDays }) });
      }
    }
    return out;
  }
  // Việc thường (dự án bảng công việc, không phải MTL) người dùng xem được, của MỘT bộ phận (chủ trì / phòng của dự án / người phụ trách
  // thuộc bộ phận): còn mở, hoặc xong từ ngày `since`. "Đang làm" / "nguy cơ chậm" theo services/alerts.js (isStarted, riskOf) —
  // cùng định nghĩa với hạng mục MTL; "sắp đến hạn" theo thiết lập số ngày cảnh báo của sổ giao việc.
  async function taskItemsFor(user, now, since, departmentId) {
    const [{ dueSoonDays }, rows] = await Promise.all([R.getSettings(prisma), prisma.workItem.findMany({
      where: { archivedAt: null, project: { kind: { not: 'MTL' }, archivedAt: null, ...visibleProjectsWhere(user) },
        AND: [itemVisibleWhere(user), { OR: [{ state: { category: { notIn: ['COMPLETED', 'CANCELLED'] } } }, { completedAt: { gte: since } }] },
          { OR: [{ leadDepartmentId: departmentId }, { leadDepartmentId: null, project: { departmentId } }, { assignees: { some: { user: { departmentId } } } }] }] },
      select: { id: true, number: true, title: true, parentId: true, leadDepartmentId: true, startDate: true, dueDate: true, progress: true, progressAt: true,
        startedAt: true, completedAt: true, returnedAt: true, state: { select: { category: true } }, assignees: { select: { user: { select: { id: true, fullName: true } } } },
        project: { select: { id: true, key: true, departmentId: true } } },
    })]);
    return rows.map(r => {
      const done = r.state.category === 'COMPLETED', started = A.isStarted(r), risk = done ? null : A.riskOf(r, { day: now, taskDueSoonDays: dueSoonDays });
      return { ...r, kind: 'TASK', code: `${r.project.key}-${r.number}`, projectKey: r.project.key, projectId: r.project.id, project: undefined,
        leadDepartmentId: r.leadDepartmentId ?? r.project.departmentId, assignees: r.assignees.map(a => a.user), actual: r.progress, children: 0,
        done, cancelled: r.state.category === 'CANCELLED', started, risk };
    });
  }
  const workItemsFor = async (user, now, since, departmentId) => [...await mtlItemsFor(user, now), ...await taskItemsFor(user, now, since, departmentId)];
  // Việc xong được báo "xong trong tuần" từ thứ Bảy tuần trước (WK.placeOf) — lấy việc xong từ 00:00 thứ Bảy đó.
  const doneSince = WK.doneSince; // 00:00 thứ Hai tuần trước (cùng cửa sổ WK.placeOf; loại trùng bằng prevDone)
  // Điền sẵn cho một bộ phận (dùng khi xem và khi nộp — máy chủ tự xác định hạng mục bắt buộc).
  async function prefillFor(user, departmentId, week, now) {
    const [prevRep, members, items] = await Promise.all([
      prisma.weeklyReport.findUnique({ where: { departmentId_week: { departmentId, week: WK.addDays(week, -7) } } }),
      prisma.user.findMany({ where: { departmentId, ...ACTIVE_USER }, select: { id: true, fullName: true, displayTitle: true }, orderBy: { fullName: 'asc' } }),
      workItemsFor(user, now, doneSince(week), departmentId),
    ]);
    const memberIds = new Set(members.map(u => u.id));
    const cand = WK.deptCandidates(items, departmentId, memberIds);
    for (const i of items) i.pctAuto = i.children > 0; // % việc có việc nhánh tự tính từ việc nhánh
    const { actions } = await D.openActions(prisma, week, departmentId);
    const prev = prevRep?.firstSubmittedAt ? prevRep.data : null; // chỉ bản ĐÃ NỘP tuần trước
    const prefill = WK.buildPrefill({ week, deptId: departmentId, items, memberIds, prev, actions });
    return { prefill, members, memberIds, prev, items, cand, hasPrev: !!prev, actions };
  }

  // Ẩn / hiện theo NGƯỜI XEM (không theo người nộp): người xem tổng hợp đầy đủ (Ban GĐ, thư ký, PMO) thấy mọi dòng; người khác chỉ thấy
  // dòng gắn việc họ xem được — kể cả dòng do trưởng phòng / thư ký nhập (báo cáo bộ phận mọi thành viên đều xem). API, MCP dùng chung.
  const seeWhich = async (user, ids) => new Set(ids.length ? (await prisma.workItem.findMany({ where: { id: { in: [...new Set(ids)] }, project: visibleProjectsWhere(user), AND: [itemVisibleWhere(user)] }, select: { id: true } })).map(i => i.id) : []);
  async function hideUnseen(s, user, data) {
    if (!data || P.can(s, 'view', 'weekly.summary.detail')) return data;
    const ok = await seeWhich(user, [...WK.allRows(data), ...(data.plans || [])].map(r => r.itemId).filter(Boolean));
    return WK.viewFor(data, id => ok.has(id));
  }

  // ---------- Báo cáo của một bộ phận ----------
  app.get('/api/weekly/report', auth, async (req, res) => {
    const s = await subjectOf(req);
    const week = weekParam(req.query.week);
    if (!req.query.departmentId && s.director) fail(422, 'Ban giám đốc không lập báo cáo tuần — xem bản Tổng hợp', 'DIRECTOR_NO_REPORT');
    const departmentId = req.query.departmentId ? intParam(req.query.departmentId, 'Bộ phận') : req.user.departmentId;
    if (!departmentId) fail(422, 'Tài khoản chưa thuộc bộ phận nào — liên hệ quản trị để gán bộ phận', 'NO_DEPARTMENT');
    const acc = await deptAccess(s, departmentId, 'view');
    const now = new Date();
    const [savedRaw, meeting, leaders, noticesRaw] = await Promise.all([
      prisma.weeklyReport.findUnique({ where: { departmentId_week: { departmentId, week } } }),
      meetingOf(week), approval.deptLeaderIds(prisma, departmentId),
      prisma.weeklyNotice.findMany({ where: { week, departmentId }, orderBy: { id: 'asc' } }),
    ]);
    // Người chỉ được XEM (Ban GĐ, PMO) không thấy nháp chưa nộp của bộ phận khác.
    const saved0 = acc.canEdit || savedRaw?.firstSubmittedAt ? savedRaw : null;
    const saved = saved0 && { ...saved0, data: await hideUnseen(s, req.user, saved0.data) };
    // Thư ký (xem đầy đủ + sửa): dòng gắn việc họ không xem được → chỉ sửa giải trình, không bỏ được (K2) — giao diện ẩn nút "Bỏ".
    if (saved?.data && acc.canEdit && P.can(s, 'view', 'weekly.summary.detail')) {
      const ids = [...WK.allRows(saved.data), ...(saved.data.plans || [])].map(r => r.itemId).filter(Boolean);
      const ok = await seeWhich(req.user, ids);
      saved.data = { ...saved.data };
      for (const k of ['results', 'ongoing', 'risks', 'plans']) saved.data[k] = (saved.data[k] || []).map(r => (r.itemId && !ok.has(r.itemId) ? { ...r, noDelete: true } : r));
    }
    const { prefill, members, hasPrev, actions } = await prefillFor(req.user, departmentId, week, now);
    const notices = noticesRaw.filter(n => P.can(s, 'view', 'weekly.notice', { departmentId, createdById: n.createdById }));
    const names = await userNames(prisma, [...members.map(u => u.id), ...leaders, ...rowOwnerIds(prefill), ...rowOwnerIds(saved?.data), saved?.submittedById, saved?.preparerId, ...notices.flatMap(n => [n.createdById, n.substituteId])]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      week, schedule: WK.scheduleOf(week, meeting), department: acc.dept, canEdit: acc.canEdit, onBehalf: acc.onBehalf,
      leaders: leaders.map(id => names[id]).filter(Boolean), members: members.map(u => ({ id: u.id, fullName: u.fullName, title: u.displayTitle || '' })), names,
      report: reportOut(saved, names), prefill: acc.canEdit ? prefill : null, hasPrev, actions: actions.length,
      notices: notices.map(n => noticeOut(n, names, s)),
      status: WK.submissionStatus(saved?.firstSubmittedAt ? saved : null, noticesRaw, WK.scheduleOf(week, meeting), now),
      lockedAfter: WK.scheduleOf(week, meeting).meetingAt,
    });
  });
  const noticeOut = (n, names, s) => {
    const showNote = P.can(s, 'view', 'weekly.notice', { departmentId: n.departmentId, createdById: n.createdById, field: 'note' });
    return { id: n.id, departmentId: n.departmentId, week: n.week, type: n.type, typeLabel: WK.NOTICE_TYPES[n.type], reason: n.reason, reasonLabel: WK.REASONS[n.reason] || '',
      note: showNote ? n.note : '', expectedAt: n.expectedAt, receivedAt: n.receivedAt, substituteId: n.substituteId, substitute: names[n.substituteId] || null,
      createdBy: names[n.createdById] || null, createdById: n.createdById, createdAt: n.createdAt,
      canDelete: P.can(s, 'edit', 'weekly.notice', { departmentId: n.departmentId, createdById: n.createdById, op: 'delete' }) };
  };

  // Ngữ cảnh làm sạch: người phụ trách hợp lệ (tài khoản đang hoạt động), bộ phận, hạng mục MTL + việc thường người lập xem được.
  async function cleanCtx(user, now, week, departmentId) {
    const [users, depts, items] = await Promise.all([
      prisma.user.findMany({ where: ACTIVE_USER, select: { id: true } }),
      prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
      workItemsFor(user, now, WK.at(WK.addDays(week, -13), 0, 0), departmentId),
    ]);
    return { userIds: new Set(users.map(u => u.id)), deptIds: new Set(depts.map(d => d.id)), itemIds: new Set(items.map(i => i.id)),
      taskIds: new Set(items.filter(i => i.kind === 'TASK').map(i => i.id)), deptName: id => depts.find(d => d.id === id)?.name || '', items };
  }
  // Thư ký (quyền sửa báo cáo + xem tổng hợp đầy đủ): sửa được trường do người nhập của MỌI dòng (quy chế: sửa căn cứ sau họp).
  const editsAll = (s, acc) => acc.canEdit && P.can(s, 'view', 'weekly.summary.detail');
  // K4: mọi thay đổi máy chủ bỏ qua đều báo lại (web lẫn MCP).
  const ignoredMsg = n => `${n} thay đổi trên dòng gắn việc bạn không có quyền thêm / sửa / bỏ (hoặc % do hệ thống tính) không được lưu — máy chủ giữ theo việc và bản đã lưu`;
  const removedMsg = n => `${n} dòng của việc đã lưu trữ / huỷ đã được bỏ khỏi báo cáo`;
  const notes = (ignored, removed) => ({ ignored, removed, ...(ignored || removed ? { warning: [ignored ? ignoredMsg(ignored) : '', removed ? removedMsg(removed) : ''].filter(Boolean).join('. ') } : {}) });
  // Có khoá baseUpdatedAt mà = null trong khi máy chủ đã có báo cáo → bản đang mở đã cũ (409) — WS.baseOf / WS.isStale.
  const bodyDept = req => { const id = req.body?.departmentId ? intParam(req.body.departmentId, 'Bộ phận') : req.user.departmentId; if (!id) fail(422, 'Tài khoản chưa thuộc bộ phận nào', 'NO_DEPARTMENT'); return id; };

  // Lưu nháp (tự lưu). Hai người cùng lập: gửi kèm updatedAt đã đọc — lệch thì trả 409, không ghi đè phần người kia vừa sửa.
  app.put('/api/weekly/report', auth, async (req, res) => {
    const s = await subjectOf(req);
    const week = weekParam(req.body?.week), departmentId = bodyDept(req);
    const acc = await deptAccess(s, departmentId, 'edit');
    const ctx = await cleanCtx(req.user, new Date(), week, departmentId);
    // Phạm vi bộ phận: trường do máy tính của MỌI dòng tính lại ở mỗi lần lưu; dòng của việc đã lưu trữ / huỷ bị bỏ.
    const deptItems = await workItemsFor(DEPT_SCOPE, new Date(), doneSince(week), departmentId);
    const editAll = editsAll(s, acc);
    const { actions } = await D.openActions(prisma, week, departmentId);
    const base = req.body?.baseUpdatedAt ? new Date(req.body.baseUpdatedAt).getTime() : null;
    let ignoredOut = 0, removedOut = 0;
    // Đọc – kiểm – ghi trong cùng khoá: lần tự lưu chạy chậm không ghi đè được bản vừa nộp hay bản người khác vừa lưu.
    const out = await prisma.$transaction(async tx => {
      await reportLock(tx, departmentId, week);
      const existing = await tx.weeklyReport.findUnique({ where: { departmentId_week: { departmentId, week } } });
      if (existing?.status === 'SUBMITTED') fail(409, 'Báo cáo đã nộp — sửa xong bấm "Gửi lại" để cập nhật', 'ALREADY_SUBMITTED');
      if (existing && base !== existing.updatedAt.getTime()) return { conflict: existing };
      // Quy tắc gốc: gộp theo itemId với bản nháp đã lưu — dòng của việc người lưu không xem được giữ NGUYÊN (services/weekly-submit.js).
      const { data, ignored, removed } = WS.mergeDraft(req.body?.data, ctx, existing?.data || null, { scopeItems: deptItems, editAll });
      stripForeignActions(data, actions);
      ignoredOut = ignored; removedOut = removed;
      return { saved: existing
        ? await tx.weeklyReport.update({ where: { id: existing.id }, data: { data, preparerId: req.user.id } })
        : await tx.weeklyReport.create({ data: { departmentId, week, data, preparerId: req.user.id } }) };
    });
    if (out.conflict) {
      const who = await userNames(prisma, [out.conflict.preparerId]);
      return res.status(409).json({ error: `${who[out.conflict.preparerId] || 'Người khác'} vừa lưu bản nháp này — tải lại để không ghi đè phần đã sửa`, code: 'DRAFT_CONFLICT', updatedAt: out.conflict.updatedAt });
    }
    // Thay đổi gửi cho dòng người lưu không được sửa: máy chủ bỏ qua và BÁO LẠI (giao diện hiện cảnh báo, MCP trả về).
    res.json({ ok: true, updatedAt: out.saved.updatedAt, ...notes(ignoredOut, removedOut) });
  });

  // Nộp / gửi lại. Giờ nộp = lần gửi đầu (Điều 6); thư ký nhập thay ghi giờ nhận email. Mỗi lần nộp lưu một phiên bản bất biến + SHA-256.
  app.post('/api/weekly/submit', auth, async (req, res) => {
    const s = await subjectOf(req);
    const now = new Date();
    const week = weekParam(req.body?.week, now), departmentId = bodyDept(req);
    const acc = await deptAccess(s, departmentId, 'edit');
    if (week > WK.currentFriday(now)) fail(422, 'Chưa đến tuần này', 'FUTURE_WEEK');
    const meeting = await meetingOf(week), S = WK.scheduleOf(week, meeting);
    if (S.skip) fail(409, 'Tuần nghỉ — không giao ban, không cần nộp', 'WEEK_SKIPPED');
    const pre = await prisma.weeklyReport.findUnique({ where: { departmentId_week: { departmentId, week } }, select: { firstSubmittedAt: true, data: true, updatedAt: true } });
    // Sau giờ giao ban, bản đã nộp không gửi lại được (trừ thư ký) — giữ nguyên căn cứ của buổi họp. (Kiểm lại trong khoá bên dưới.)
    const lockedAfterMeeting = r => r?.firstSubmittedAt && now > S.meetingAt && !s.secretary;
    if (lockedAfterMeeting(pre)) fail(409, 'Đã qua giờ giao ban — muốn sửa báo cáo, liên hệ thư ký giao ban', 'REPORT_LOCKED');
    // Như lưu nháp: bản đang mở đã cũ (có người vừa lưu / nộp) → 409, không ghi đè phần người kia vừa sửa.
    const stale = r => WS.isStale(req.body, r);
    // K1: tuần đã họp (đã có bản nộp, đã qua giờ giao ban) → đóng băng trường máy tính theo bản nộp trước đó.
    const frozen = !!pre?.firstSubmittedAt && now > S.meetingAt;
    const conflict = () => fail(409, 'Có người vừa sửa báo cáo này — tải lại để không ghi đè phần đã sửa', 'REPORT_CONFLICT');
    if (stale(pre)) conflict();
    const ctx = await cleanCtx(req.user, now, week, departmentId);
    const { prefill, cand, actions, memberIds, prev, items: seen } = await prefillFor(req.user, departmentId, week, now);
    // Làm sạch → dòng bắt buộc còn ở Phần IV về đúng phần → tính lại dòng gắn việc → xếp lại phần → kiểm tra (services/weekly-submit.js).
    // Phạm vi bộ phận (mục S10) — tính ở MỌI lần nộp / gửi lại: dòng tự bổ sung, dòng của việc người gửi không xem được (giữ từ bản đã lưu).
    const deptItems = await workItemsFor(DEPT_SCOPE, now, doneSince(week), departmentId);
    const { data, errors, ignored, removed } = WS.prepareSubmit({ raw: req.body?.data, ctx, prefill, actions, now, week, saved: pre?.data || null, scopeItems: deptItems, editAll: editsAll(s, acc), frozen }); // bản đã lưu: nháp hoặc đã nộp
    const candIds = new Set(cand.map(i => i.id)), byId = new Map(ctx.items.map(i => [i.id, i]));
    // Trả lại dữ liệu đã tính lại (tình trạng dòng MTL) để giao diện hiện đúng khối giải trình cần điền.
    if (errors.length) return res.status(422).json({ error: `Còn ${errors.length} mục cần sửa`, code: 'REPORT_INCOMPLETE', errors, data: await hideUnseen(s, req.user, data), ...notes(ignored, removed) });
    // Mục S10: việc của bộ phận người nộp không xem được → máy chủ tự bổ sung (tiến độ / hạn / nguy cơ từ hệ thống, không bắt ghi giải pháp).
    const full = WK.buildPrefill({ week, deptId: departmentId, items: deptItems, memberIds, prev });
    const autoCtx = { full, visibleIds: new Set(seen.map(i => i.id)), parentOf: new Map(deptItems.map(i => [i.id, i.parentId])) };
    if (!pre?.firstSubmittedAt && acc.onBehalf && req.body?.receivedAt) {
      const t = new Date(req.body.receivedAt);
      if (Number.isNaN(t.getTime()) || t > now || t < WK.at(WK.addDays(week, -4), 0, 0)) fail(422, 'Giờ nhận email không hợp lệ', 'INVALID_DATE');
    }
    // Ghi ngược % vào MTL — chỉ khi: không phải nhập thay; hạng mục của chính bộ phận này; người nộp được cập nhật tiến độ
    // hạng mục đó (policy mtl.progress); và % trong MTL vẫn bằng % lúc điền sẵn (không đè số người khác vừa cập nhật).
    // Kiểm quyền trước; GHI trong cùng transaction với bản nộp + phiên bản (nộp lỗi thì % không vào MTL).
    const skipped = [], plan = [];
    if (!acc.onBehalf) {
      for (const w of WK.writeBacks(data)) {
        if (!candIds.has(w.itemId)) { skipped.push(w.itemId); continue; }
        try {
          const { project, rights } = await loadItem(prisma, req.user, w.itemId, 'edit');
          const it = byId.get(w.itemId);
          if (project.kind !== 'MTL' || !P.can(s, 'edit', 'mtl.progress', { item: { assigneeIds: (it.assignees || []).map(a => a.id) } })) { skipped.push(w.itemId); continue; }
          plan.push({ w, project, rights, code: it.code, row: [...data.results, ...data.ongoing, ...data.risks].find(r => r.itemId === w.itemId) });
        } catch (error) { if (error.status && error.status < 500) skipped.push(w.itemId); else throw error; }
      }
    }
    const done = await prisma.$transaction(async tx => {
      await reportLock(tx, departmentId, week);
      const existing = await tx.weeklyReport.findUnique({ where: { departmentId_week: { departmentId, week } } });
      if (lockedAfterMeeting(existing)) fail(409, 'Đã qua giờ giao ban — muốn sửa báo cáo, liên hệ thư ký giao ban', 'REPORT_LOCKED');
      if (stale(existing) || (existing && pre && existing.updatedAt.getTime() !== pre.updatedAt.getTime())) conflict(); // có người lưu chen giữa lúc đọc và lúc ghi
      let first = existing?.firstSubmittedAt || now, receivedAt = null;
      if (!existing?.firstSubmittedAt && acc.onBehalf && req.body?.receivedAt) first = receivedAt = new Date(req.body.receivedAt);
      const updated = [], conflicts = [];
      // Khoá hạng mục theo thứ tự id (hai bộ phận nộp cùng lúc có chung hạng mục không khoá chéo nhau → không deadlock).
      plan.sort((a, b) => a.w.itemId - b.w.itemId);
      for (const p of plan) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'item:' + p.w.itemId}))`;
        const item = await tx.workItem.findUnique({ where: { id: p.w.itemId }, include: { state: true, _count: { select: { children: { where: { archivedAt: null } } } } } });
        // Việc đã xong / huỷ: người chủ trì không mở lại bằng % (mở lại là của người giao / Ban Giám đốc).
        if (!item || item.archivedAt || item._count.children || ['COMPLETED', 'CANCELLED'].includes(item.state.category)) { skipped.push(p.w.itemId); continue; }
        if (item.progress !== p.row.pct0) { conflicts.push(p.code); continue; }
        if (await setProgress(tx, { user: req.user, project: p.project, rights: p.rights, item, pct: p.w.pct, via: 'WEEKLY_REPORT' })) updated.push(p);
        p.row.pct0 = p.w.pct;
      }
      // Dòng gắn việc về đúng phần theo tình trạng vừa tính lại (xong → I, đã bắt đầu → II) trước khi lưu bản bất biến.
      const { final, added: autoAdded } = WS.finishSubmit(data, week, autoCtx, { frozen });
      const hash = sha256(final);
      const r = existing
        ? await tx.weeklyReport.update({ where: { id: existing.id }, data: { data: final, status: 'SUBMITTED', preparerId: req.user.id, firstSubmittedAt: first, submittedAt: now, submittedById: req.user.id, submitCount: { increment: 1 } } })
        : await tx.weeklyReport.create({ data: { departmentId, week, data: final, status: 'SUBMITTED', preparerId: req.user.id, firstSubmittedAt: first, submittedAt: now, submittedById: req.user.id, submitCount: 1 } });
      await tx.weeklyReportVersion.create({ data: { reportId: r.id, n: r.submitCount, departmentId, week, data: final, sha256: hash, submittedAt: now, submittedById: req.user.id, onBehalf: acc.onBehalf } });
      return { saved: r, final, hash, receivedAt, updated, conflicts, autoAdded };
    }, { timeout: 60_000, maxWait: 10_000 });
    const { saved, final, hash, receivedAt, conflicts, autoAdded } = done;
    const updated = done.updated.map(p => p.w.itemId);
    for (const p of done.updated) bus.item(p.project.id, p.w.itemId, req.user.id);
    await audit(req, 'WEEKLY_REPORT_SUBMIT', 'WeeklyReport', saved.id, null, { departmentId, week, n: saved.submitCount, sha256: hash, onBehalf: acc.onBehalf, receivedAt, firstSubmittedAt: saved.firstSubmittedAt,
      items: final.results.length + final.ongoing.length + final.risks.length, plans: final.plans.length, progressUpdated: updated.length, progressSkipped: skipped.length, progressConflicts: conflicts.length, autoAdded, ignored, removed, frozen });
    const notices = await prisma.weeklyNotice.findMany({ where: { week, departmentId } });
    res.json({ ok: true, submittedAt: saved.submittedAt, firstSubmittedAt: saved.firstSubmittedAt, submitCount: saved.submitCount, sha256: hash,
      progressUpdated: updated.length, progressSkipped: skipped.length, progressConflicts: conflicts, onBehalf: acc.onBehalf, updatedAt: saved.updatedAt,
      ...notes(ignored, removed), frozen, status: WK.submissionStatus(saved, notices, S, now) });
  });

  // Các phiên bản đã nộp (người xem đầy đủ): đối chiếu bản đúng hạn với bản sửa sau hạn.
  app.get('/api/weekly/report/versions', auth, async (req, res) => {
    const s = await subjectOf(req);
    const week = weekParam(req.query.week), departmentId = intParam(req.query.departmentId, 'Bộ phận');
    P.assertCan(s, 'view', 'weekly.report', { departmentId });
    const rows = await prisma.weeklyReportVersion.findMany({ where: { week, departmentId }, orderBy: { n: 'asc' } });
    const names = await userNames(prisma, rows.map(v => v.submittedById));
    for (const v of rows) v.data = await hideUnseen(s, req.user, v.data); // bản lọc; sha256 vẫn là của bản đã nộp đầy đủ
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(rows.map(v => ({ n: v.n, submittedAt: v.submittedAt, submittedBy: names[v.submittedById] || '', onBehalf: v.onBehalf, sha256: v.sha256, data: v.data })));
  });

  // ---------- Báo nộp muộn / vắng (Điều 6, 7) ----------
  app.get('/api/weekly/notices', auth, async (req, res) => {
    const s = await subjectOf(req);
    const week = weekParam(req.query.week);
    const rows = (await prisma.weeklyNotice.findMany({ where: { week }, orderBy: { id: 'desc' } }))
      .filter(n => P.can(s, 'view', 'weekly.notice', { departmentId: n.departmentId, createdById: n.createdById }));
    const names = await userNames(prisma, rows.flatMap(n => [n.createdById, n.substituteId]));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(rows.map(n => noticeOut(n, names, s)));
  });
  app.post('/api/weekly/notices', auth, async (req, res) => {
    const s = await subjectOf(req);
    const b = req.body || {}, now = new Date();
    const week = weekParam(b.week, now), departmentId = bodyDept(req);
    const dept = await prisma.department.findFirst({ where: { id: departmentId, isActive: true }, select: { id: true, name: true } });
    if (!dept) fail(404, 'Không tìm thấy bộ phận', 'NOT_FOUND');
    P.assertCan(s, 'edit', 'weekly.notice', { departmentId });
    // Chỉ báo cho tuần đang diễn ra (hoặc tuần vừa qua khi chưa đến giờ giao ban) — không báo "đặt trước" để né trừ điểm.
    // Thư ký ghi nhận cho tuần hiện tại hoặc đã qua.
    const cur = WK.currentFriday(now);
    const open = week === cur || (week === WK.addDays(cur, -7) && now < WK.scheduleOf(week, await meetingOf(week)).meetingAt);
    if (s.secretary ? week > cur : !open) fail(422, 'Chỉ báo muộn / vắng cho tuần báo cáo hiện tại', 'INVALID_WEEK');
    if (!WK.NOTICE_TYPES[b.type]) fail(422, 'Loại thông báo không hợp lệ', 'INVALID_VALUE');
    if (!WK.REASONS[b.reason]) fail(422, 'Chọn lý do', 'REQUIRED');
    const note = String(b.note ?? '').trim();
    if (note.length > 200) fail(422, 'Ghi chú tối đa 200 ký tự', 'TOO_LONG');
    if (b.reason === 'KHAC' && !note) fail(422, 'Lý do khác: ghi ngắn gọn lý do', 'REQUIRED');
    const data = { week, departmentId, type: b.type, reason: b.reason, note, createdById: req.user.id };
    // Thư ký nhập hộ tin nhắn báo (qua điện thoại / chat): ghi giờ nhận tin để tính đúng hạn.
    if (b.receivedAt) {
      if (!s.secretary) fail(403, 'Chỉ thư ký giao ban ghi giờ nhận tin', 'FORBIDDEN');
      const t = new Date(b.receivedAt);
      if (Number.isNaN(t.getTime()) || t > now || t < WK.at(WK.addDays(week, -4), 0, 0)) fail(422, 'Giờ nhận tin không hợp lệ', 'INVALID_DATE');
      data.receivedAt = t;
    }
    if (b.type === 'LATE') {
      const t = b.expectedAt ? new Date(b.expectedAt) : null;
      if (!t || Number.isNaN(t.getTime())) fail(422, 'Ghi giờ nộp dự kiến', 'REQUIRED');
      data.expectedAt = t;
    } else {
      const sub = b.substituteId ? intParam(b.substituteId, 'Người dự thay') : null;
      if (!sub) fail(422, 'Cử cấp phó hoặc người được ủy quyền dự thay', 'REQUIRED');
      // Người dự thay: cấp phó / người được ủy quyền của CHÍNH bộ phận đó.
      if (!(await prisma.user.findFirst({ where: { id: sub, departmentId, ...ACTIVE_USER } }))) fail(422, 'Người dự thay phải là người của bộ phận này', 'INVALID_VALUE');
      data.substituteId = sub;
    }
    const n = await prisma.weeklyNotice.create({ data });
    await audit(req, 'WEEKLY_NOTICE', 'WeeklyNotice', n.id, null, { departmentId, week, type: n.type, reason: n.reason, receivedAt: n.receivedAt });
    // Báo thư ký / Ban GĐ (Điều 6, 7). Thông báo chỉ ghi nhãn lý do — ghi chú tự do không rời bảng WeeklyNotice.
    const S = WK.scheduleOf(week, await meetingOf(week));
    await notify(prisma, await D.managerIds(prisma), { type: 'WEEKLY_NOTICE', title: n.type === 'LATE' ? `${dept.name} báo nộp báo cáo tuần muộn` : `${dept.name} báo vắng giao ban ${WK.fmtD(S.meetingDay)}`, body: WK.REASONS[n.reason], link: '#/tuan/bao' }, req.user.id);
    const names = await userNames(prisma, [n.createdById, n.substituteId]);
    res.status(201).json(noticeOut(n, names, s));
  });
  app.delete('/api/weekly/notices/:id', auth, async (req, res) => {
    const s = await subjectOf(req);
    const n = await prisma.weeklyNotice.findUnique({ where: { id: intParam(req.params.id) } });
    if (!n || !P.can(s, 'edit', 'weekly.notice', { departmentId: n.departmentId, createdById: n.createdById, op: 'delete' })) fail(404, 'Không tìm thấy thông báo', 'NOT_FOUND');
    await prisma.weeklyNotice.delete({ where: { id: n.id } });
    await audit(req, 'WEEKLY_NOTICE_DELETE', 'WeeklyNotice', n.id, { departmentId: n.departmentId, week: n.week, type: n.type }, null);
    res.status(204).end();
  });

  // ---------- Tổng hợp giao ban ----------
  app.get('/api/weekly/summary', auth, async (req, res) => {
    const s = await subjectOf(req);
    P.assertCan(s, 'view', 'weekly.summary');
    const week = weekParam(req.query.week);
    const full = P.can(s, 'view', 'weekly.summary.detail');
    // Số liệu giống nhau với MỌI người xem (dòng tự bổ sung luôn được đếm). Trưởng / phó: bản tóm tắt (không họ tên, không ghi chú vắng,
    // không chi tiết bộ phận khác); dòng / tên việc họ không xem được bị bỏ, kể cả trong text (bản gửi email) — mục S10.
    const { sum, names, all, configured } = await D.summaryOf(prisma, week);
    const own = sum.rows.find(r => r.id === s.departmentId)?.report;
    const ownHelps = (sum.helps || []).flatMap(g => g.list).filter(h => h.fromId === s.departmentId);
    const ok = full ? null : await seeWhich(req.user, [...WK.allRows(own), ...(sum.risks || []).filter(x => x.departmentId === s.departmentId), ...ownHelps].map(r => r.itemId).filter(Boolean));
    // Việc thuộc dự án KÍN (Chỉ thành viên / Sổ giao việc): bản email và bản tóm tắt cho bộ phận khác không nêu tên, chỉ đếm.
    const ids = [...new Set([...(sum.risks || []), ...(sum.helps || []).flatMap(g => g.list)].map(x => x.itemId).filter(Boolean))];
    const secret = new Set(ids.length ? (await prisma.workItem.findMany({ where: { id: { in: ids }, project: { visibility: { in: ['PRIVATE', 'ASSIGNED'] } } }, select: { id: true } })).map(i => i.id) : []);
    const { view, text, fullText } = WK.summaryView(sum, { full, departmentId: s.departmentId, canSee: id => !!ok?.has(id), isSecret: id => secret.has(id) });
    let out = view;
    // Ghi chú lý do vắng / muộn (có thể là DLCN nhạy cảm): chỉ Ban GĐ, thư ký (policy weekly.notice · field note) — PMO không thấy.
    if (full && !P.can(s, 'view', 'weekly.notice', { field: 'note', departmentId: -1, createdById: -1 }))
      out = { ...out, rows: out.rows.map(r => ({ ...r, absent: r.absent ? { ...r.absent, note: '' } : null, late: (r.late || []).map(l => ({ ...l, note: '' })) })) };
    res.setHeader('Cache-Control', 'private, no-store');
    const m = await meetingOf(week);
    res.json({ ...out, names: full ? names : {}, departments: all.map(d => ({ id: d.id, name: d.name })), configured, canManage: s.manage, canDetail: full,
      // text: BẢN GỬI EMAIL (không có danh sách mục I, II; không nêu tên dòng tự bổ sung) — mọi người dùng, API và MCP kepper_weekly_summary.
      // fullText: bản đầy đủ I, II, III — chỉ người xem đầy đủ, chỉ dùng nội bộ Ban GĐ, không gửi email.
      text, ...(fullText ? { fullText } : {}),
      ...(s.manage ? { actionsVersion: sha256(m?.data?.actions || []) } : {}) });
  });
  app.post('/api/weekly/summary/copied', auth, async (req, res) => {
    const s = await subjectOf(req);
    P.assertCan(s, 'export', 'weekly.summary');
    const week = weekParam(req.body?.week);
    const kind = req.body?.kind === 'full' ? 'full' : 'email';
    if (kind === 'full') P.assertCan(s, 'view', 'weekly.summary.detail');
    await audit(req, 'WEEKLY_SUMMARY_COPY', 'WeeklyMeeting', week, null, { week, kind });
    res.status(204).end();
  });

  // ---------- Buổi giao ban: tuần nghỉ, hạn nộp / ngày họp, điểm danh, không đạt, kết luận TGĐ, Action Log, phát hành ----------
  app.put('/api/weekly/meeting', auth, async (req, res) => {
    const s = await subjectOf(req);
    P.assertCan(s, 'edit', 'weekly.meeting');
    const b = req.body || {}, week = weekParam(b.week), now = new Date();
    const depts = new Set((await prisma.department.findMany({ where: { isActive: true }, select: { id: true } })).map(d => d.id));
    const users = b.actions !== undefined ? new Map((await prisma.user.findMany({ where: ACTIVE_USER, select: { id: true, departmentId: true } })).map(u => [u.id, u])) : null;
    // Phát hành: TGĐ kết luận TỪNG yêu cầu hỗ trợ trước (Điều 5). summaryOf có thể chụp danh sách phải nộp → gọi TRƯỚC khoá.
    const helps = b.publish === true ? (await D.summaryOf(prisma, week)).sum.helps.flatMap(g => g.list) : [];
    // Đọc – gộp – ghi trong khoá 'meeting:<tuần>': TGĐ lưu kết luận và thư ký lưu Action Log cùng lúc không làm mất phần của nhau.
    const result = await prisma.$transaction(async tx => {
      await D.meetingLock(tx, week);
      const existing = await tx.weeklyMeeting.findUnique({ where: { week } });
      // Action Log do người khác vừa sửa (so phiên bản lúc tải) → không ghi đè cả danh sách.
      if (b.actions !== undefined && b.baseActions !== sha256(existing?.data?.actions || []))
        fail(409, 'Action Log vừa được người khác cập nhật — tải lại trước khi lưu', 'MEETING_CONFLICT');
      const data = { ...(existing?.data || {}) };
      // Đổi lịch (tuần nghỉ, hạn nộp, ngày họp) sau hạn nộp làm đổi điểm đã phát sinh → chỉ TGĐ / Ban GĐ.
      const schedChange = ['skip', 'deadlineDay', 'meetingDay'].some(k => b[k] !== undefined && (k === 'skip' ? !!b[k] !== !!data[k] : (b[k] || null) !== (data[k] || null)));
      if (schedChange && now > WK.scheduleOf(week, existing).deadline && !s.director) fail(403, 'Đã qua hạn nộp — chỉ Ban giám đốc đổi lịch của tuần này', 'FORBIDDEN');
      if (b.skip !== undefined) data.skip = !!b.skip; // tuần nghỉ Tết / lễ: không giao ban, không chấm điểm
      if (b.deadlineDay !== undefined) { if (b.deadlineDay && (!WK.isDay(b.deadlineDay) || b.deadlineDay > week || b.deadlineDay < WK.addDays(week, -4))) fail(422, 'Hạn nộp phải là một ngày từ thứ Hai đến thứ Sáu của tuần báo cáo', 'INVALID_DATE'); data.deadlineDay = b.deadlineDay || null; }
      if (b.meetingDay !== undefined) { if (b.meetingDay && (!WK.isDay(b.meetingDay) || b.meetingDay <= week || b.meetingDay > WK.addDays(week, 10))) fail(422, 'Ngày giao ban phải sau thứ Sáu của tuần báo cáo', 'INVALID_DATE'); data.meetingDay = b.meetingDay || null; }
      // Điểm danh và phát hành chỉ từ giờ giao ban (theo ngày họp đã đổi nếu có) — chặn bấm nhầm trước buổi họp.
      const S = WK.scheduleOf(week, data), started = WK.meetingStarted(S, now);
      const notYet = what => fail(409, `Chưa tới giờ giao ban (${WK.fmtTime(S.meetingAt)}) — ${what} từ giờ họp`, 'MEETING_NOT_STARTED');
      if (b.attendance !== undefined) {
        const att = {};
        for (const [k, v] of Object.entries(b.attendance || {})) if (depts.has(Number(k)) && WK.ATTENDANCE[v]) att[Number(k)] = v;
        if (!started && WK.stableStringify(att) !== WK.stableStringify(data.attendance || {})) notYet('điểm danh');
        data.attendance = att;
      }
      if (b.failed !== undefined) { const f = {}; for (const [k, v] of Object.entries(b.failed || {})) if (depts.has(Number(k)) && v) f[Number(k)] = true; data.failed = f; }
      if (b.conclusions !== undefined) {
        // Gộp theo từng yêu cầu (khoá "<bộ phận>:<dòng>"); giá trị null = xoá kết luận đó.
        const c = { ...(data.conclusions || {}) };
        for (const [k, v] of Object.entries(b.conclusions || {})) {
          if (!/^\d+:[\w-]{1,40}$/.test(k)) fail(422, 'Mã yêu cầu hỗ trợ không hợp lệ — tải lại trang', 'INVALID_KEY');
          if (v === null || !v.decision) { delete c[k]; continue; }
          if (!WK.DECISIONS[v.decision]) continue;
          c[k] = { decision: v.decision, departmentId: v.decision === 'ASSIGN' && depts.has(Number(v.departmentId)) ? Number(v.departmentId) : null, note: String(v.note ?? '').trim().slice(0, 500) };
        }
        data.conclusions = c;
      }
      if (b.actions !== undefined) {
        let next = Math.max(0, ...(data.actions || []).map(a => a.id || 0)) + 1;
        data.actions = (Array.isArray(b.actions) ? b.actions.slice(0, 100) : []).map(a => {
          const task = String(a?.task ?? '').trim().slice(0, 500);
          if (!task) return null;
          const departmentId = Number(a.departmentId), short = task.slice(0, 40);
          if (!depts.has(departmentId)) fail(422, `Action Log "${short}": chọn bộ phận phụ trách`, 'REQUIRED');
          if (!WK.isDay(a.due)) fail(422, `Action Log "${short}": thiếu hạn`, 'REQUIRED');
          const owner = users.get(Number(a.ownerId));
          if (!owner) fail(422, `Action Log "${short}": chọn người phụ trách`, 'REQUIRED'); // QT-TH-01 bước 7: Việc · Phụ trách · Hạn
          return { id: Number.isInteger(a.id) && a.id > 0 ? a.id : next++, task, departmentId, ownerId: owner.id, due: a.due, helpKey: a.helpKey ? String(a.helpKey).slice(0, 60) : null };
        }).filter(Boolean);
      }
      const publish = b.publish === true && !existing?.publishedAt; // kiểm trong khoá: bấm hai lần không phát hành hai lần
      if (publish && !started) notYet('phát hành kết luận và Action Log');
      if (publish) {
        const missing = helps.filter(h => !data.conclusions?.[h.key]);
        if (missing.length) fail(422, `Còn ${missing.length} yêu cầu hỗ trợ chưa có kết luận của TGĐ`, 'CONCLUSION_MISSING');
      }
      const saved = await tx.weeklyMeeting.upsert({ where: { week }, create: { week, data, updatedById: req.user.id, publishedAt: publish ? now : null }, update: { data, updatedById: req.user.id, ...(publish ? { publishedAt: now } : {}) } });
      return { saved, data, publish };
    }, { timeout: 15_000, maxWait: 10_000 });
    const { saved, data, publish } = result;
    await audit(req, publish ? 'WEEKLY_MEETING_PUBLISH' : 'WEEKLY_MEETING', 'WeeklyMeeting', week, null, { week, keys: Object.keys(b).filter(k => k !== 'week'), actions: (data.actions || []).length, skip: !!data.skip });
    if (publish) {
      const leaders = new Set(), owners = new Set();
      for (const d of depts) for (const id of await approval.deptLeaderIds(prisma, d)) leaders.add(id);
      for (const a of data.actions || []) if (a.ownerId) owners.add(a.ownerId);
      const S = WK.scheduleOf(week, saved);
      await notify(prisma, [...new Set([...leaders, ...owners, ...(await D.summaryViewerIds(prisma))])], { type: 'WEEKLY_ACTION_LOG', title: `Kết luận giao ban ${WK.fmtD(S.meetingDay)} và Action Log đã phát hành`, body: `${(data.actions || []).length} việc — tự vào Phần I báo cáo tuần sau`, link: '#/tuan/tong-hop' }, req.user.id);
    }
    res.json({ ok: true, publishedAt: saved.publishedAt, updatedAt: saved.updatedAt, actionsVersion: sha256(saved.data?.actions || []), data: saved.data, schedule: WK.scheduleOf(week, saved) });
  });

  // ---------- Thiết lập: bộ phận phải nộp (thứ tự trình bày), tuần bắt đầu chấm điểm; vai trò giao ban (chỉ Ban GĐ) ----------
  app.put('/api/weekly/config', auth, async (req, res) => {
    const s = await subjectOf(req);
    P.assertCan(s, 'edit', 'weekly.config');
    const b = req.body || {};
    const all = new Set((await prisma.department.findMany({ where: { isActive: true }, select: { id: true } })).map(d => d.id));
    const before = await weeklyConfig(prisma);
    const departments = b.departments === undefined ? before.departments : [...new Set((Array.isArray(b.departments) ? b.departments : []).map(Number))].filter(id => all.has(id));
    const startWeek = b.startWeek === undefined ? before.startWeek : b.startWeek ? weekParam(b.startWeek) : null;
    let sec = before.secretaryDepartmentId, pmo = before.pmoUserIds;
    const secIn = b.secretaryDepartmentId === undefined ? sec : Number(b.secretaryDepartmentId) || null;
    const pmoIn = b.pmoUserIds === undefined ? pmo : [...new Set((Array.isArray(b.pmoUserIds) ? b.pmoUserIds : []).map(Number).filter(Number.isInteger))];
    if (secIn !== sec || JSON.stringify(pmoIn) !== JSON.stringify(pmo)) {
      P.assertCan(s, 'edit', 'weekly.roles'); // ai làm thư ký / PMO: chỉ Ban GĐ quyết
      if (secIn != null && !all.has(secIn)) fail(422, 'Bộ phận thư ký không hợp lệ', 'INVALID_VALUE');
      const ok = new Set((await prisma.user.findMany({ where: { id: { in: pmoIn }, ...ACTIVE_USER }, select: { id: true } })).map(u => u.id));
      if (pmoIn.some(id => !ok.has(id))) fail(422, 'Danh sách PMO có tài khoản không hợp lệ', 'INVALID_VALUE');
      sec = secIn; pmo = pmoIn;
    }
    // Danh sách PMO chỉ ghi khi Ban GĐ đã chọn (chưa chọn → giữ chế độ khởi tạo, xem weekly-data.rolesOf).
    const value = { departments, startWeek, secretaryDepartmentId: sec, ...(before.pmoConfigured || b.pmoUserIds !== undefined ? { pmoUserIds: pmo } : {}), ...(before.points ? { points: before.points } : {}) };
    await prisma.appSetting.upsert({ where: { key: D.CONFIG_KEY }, create: { key: D.CONFIG_KEY, value, updatedById: req.user.id }, update: { value, updatedById: req.user.id } });
    // Danh sách phải nộp đã chụp của tuần hiện tại (chưa phát hành kết luận) đi theo thiết lập mới; các tuần đã qua giữ nguyên.
    if (b.departments !== undefined) {
      const cur = WK.currentFriday(new Date()), m = await meetingOf(cur);
      if (m && !m.publishedAt && Array.isArray(m.data?.required)) {
        const rd = await requiredDepartments(prisma, await weeklyConfig(prisma));
        await D.snapshotRequired(prisma, cur, rd.list.map(d => d.id));
      }
    }
    await audit(req, 'WEEKLY_CONFIG', 'WeeklyConfig', D.CONFIG_KEY, { departments: before.departments, startWeek: before.startWeek, secretaryDepartmentId: before.secretaryDepartmentId, pmoUserIds: before.pmoUserIds },
      { departments, startWeek, secretaryDepartmentId: sec, pmoUserIds: pmo });
    res.json({ ok: true, ...value });
  });

  // ---------- Chấm điểm tuân thủ tháng (Phụ lục 1): thư ký lập → trình; TGĐ duyệt → khoá ----------
  async function complianceRows(month, now) {
    const cfg = await weeklyConfig(prisma), rd = await requiredDepartments(prisma, cfg);
    const weeks = WK.fridaysOf(month, now, cfg.startWeek);
    const [reports, notices, meetings] = await Promise.all([
      prisma.weeklyReport.findMany({ where: { week: { in: weeks } }, select: { departmentId: true, week: true, firstSubmittedAt: true } }),
      prisma.weeklyNotice.findMany({ where: { week: { in: weeks } } }),
      prisma.weeklyMeeting.findMany({ where: { week: { in: weeks } } }),
    ]);
    const byWeek = Object.fromEntries(weeks.map(f => [f, { reports: reports.filter(r => r.week === f), notices: notices.filter(n => n.week === f), meeting: meetings.find(m => m.week === f) || null }]));
    // Bộ phận được chấm = bộ phận phải nộp ở ÍT NHẤT một tuần của tháng (theo danh sách đã chụp), hoặc danh sách hiện tại.
    const snap = new Set(meetings.flatMap(m => (Array.isArray(m.data?.required) ? m.data.required : [])));
    const depts = snap.size ? rd.all.filter(d => snap.has(d.id)) : rd.list;
    const rows = WK.compliance({ weeks, depts, byWeek, points: cfg.points, now });
    for (const r of rows) { const ids = await approval.deptLeaderIds(prisma, r.id); const n = await userNames(prisma, ids); r.leaders = ids.map(id => n[id]).filter(Boolean); }
    return { weeks, startWeek: cfg.startWeek, points: { ...WK.POINTS, ...(cfg.points || {}) }, rows };
  }
  const monthParam = (v, now) => (/^\d{4}-\d{2}$/.test(String(v || '')) ? String(v) : WK.currentFriday(now).slice(0, 7));
  // Tháng đã khép: đã qua giờ giao ban của thứ Sáu cuối tháng (Phụ lục 1: lập ngày làm việc thứ 3 của tháng sau).
  const monthClosed = async (month, now) => {
    const [y, m] = month.split('-').map(Number);
    let d = new Date(Date.UTC(y, m, 0));
    while (d.getUTCDay() !== 5) d = new Date(d.getTime() - 86_400_000);
    const last = d.toISOString().slice(0, 10);
    return now > WK.scheduleOf(last, await meetingOf(last)).meetingAt;
  };
  app.get('/api/weekly/compliance', auth, async (req, res) => {
    const s = await subjectOf(req);
    P.assertCan(s, 'view', 'weekly.compliance');
    const now = new Date(), month = monthParam(req.query.month, now);
    const st = (await prisma.appSetting.findUnique({ where: { key: COMPLIANCE_KEY(month) } }))?.value || null;
    const live = await complianceRows(month, now);
    const names = st ? await userNames(prisma, [st.submittedById, st.approvedById]) : {};
    res.setHeader('Cache-Control', 'private, no-store');
    // Đã duyệt: trả bảng đã khoá (không tính lại); chưa: tính theo số liệu hiện có.
    const closed = await monthClosed(month, now);
    res.json({ month, closed, ...(st?.status === 'APPROVED' ? { ...live, rows: st.rows } : live),
      state: st ? { status: st.status, submittedAt: st.submittedAt, submittedBy: names[st.submittedById] || '', approvedAt: st.approvedAt || null, approvedBy: names[st.approvedById] || '', sha256: st.rows ? sha256(st.rows) : null } : { status: 'DRAFT' },
      // Duyệt đúng bảng đã trình: TGĐ duyệt bảng mình đang xem (st.rows), không tính lại.
      ...(st?.status === 'SUBMITTED' ? { rows: st.rows } : {}),
      canSubmit: s.secretary && closed && st?.status !== 'APPROVED', canApprove: s.director && closed && st?.status === 'SUBMITTED' });
  });
  app.post('/api/weekly/compliance/:action', auth, async (req, res) => {
    const s = await subjectOf(req);
    P.assertCan(s, 'view', 'weekly.compliance');
    const now = new Date(), month = monthParam(req.body?.month, now), key = COMPLIANCE_KEY(month);
    if (!['submit', 'approve'].includes(req.params.action)) fail(404, 'Không tìm thấy thao tác', 'NOT_FOUND');
    if (req.params.action === 'submit' && !s.secretary) fail(403, 'Thư ký giao ban lập và trình bảng điểm', 'FORBIDDEN');
    if (req.params.action === 'approve' && !s.director) fail(403, 'TGĐ duyệt bảng điểm tuân thủ', 'FORBIDDEN');
    if (!(await monthClosed(month, now))) fail(409, 'Tháng chưa khép (còn buổi giao ban trong tháng) — lập và duyệt bảng điểm từ đầu tháng sau', 'MONTH_OPEN');
    const rows = req.params.action === 'submit' ? (await complianceRows(month, now)).rows : null; // tính trước khoá (chậm)
    const value = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const cur = (await tx.appSetting.findUnique({ where: { key } }))?.value || null;
      if (cur?.status === 'APPROVED') fail(409, 'Bảng điểm tháng này đã được duyệt và khoá', 'LOCKED');
      let v;
      if (req.params.action === 'submit') v = { status: 'SUBMITTED', rows, submittedById: req.user.id, submittedAt: now.toISOString() };
      else {
        if (cur?.status !== 'SUBMITTED') fail(409, 'Thư ký chưa trình bảng điểm tháng này', 'NOT_SUBMITTED');
        if (req.body?.sha256 !== sha256(cur.rows)) fail(409, 'Bảng điểm vừa được trình lại — tải lại trước khi duyệt', 'STALE');
        v = { ...cur, status: 'APPROVED', approvedById: req.user.id, approvedAt: now.toISOString() };
      }
      await tx.appSetting.upsert({ where: { key }, create: { key, value: v, updatedById: req.user.id }, update: { value: v, updatedById: req.user.id } });
      return v;
    });
    await audit(req, req.params.action === 'approve' ? 'WEEKLY_COMPLIANCE_APPROVE' : 'WEEKLY_COMPLIANCE_SUBMIT', 'AppSetting', key, null, { month, sha256: sha256(value.rows) });
    res.json({ ok: true, status: value.status });
  });
};
