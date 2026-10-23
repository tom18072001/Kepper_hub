// Kepper GĐ2b — Báo cáo tuần bộ phận (BM-TH-01), báo nộp muộn / vắng, tổng hợp giao ban, Action Log, chấm điểm tuân thủ.
// MỌI quyết định quyền đi qua lib/policy.js (ma trận vai trò × dữ liệu × hành động); vai trò suy ra bằng weekly-data.rolesOf()
// từ vai trò + phòng ban của tài khoản, bộ phận thư ký và danh sách PMO do Ban GĐ chọn. Quản trị IT không xem nội dung nghiệp vụ.
const crypto = require('node:crypto');
const { fail, intParam } = require('../lib/http');
const P = require('../lib/policy');
const { visibleProjectsWhere, loadItem } = require('../services/access');
const { notify } = require('../services/events');
const approval = require('../services/approval');
const bus = require('../services/bus');
const M = require('../services/mtl');
const MP = require('../services/mtl-project');
const WK = require('../services/weekly');
const D = require('../services/weekly-data');
const { setProgress } = require('../services/mtl-progress');

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
const sha256 = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const COMPLIANCE_KEY = month => `weekly.compliance.${month}`;

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
    const now = new Date(), cur = WK.currentFriday(now);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      week: cur, weeks: Array.from({ length: 10 }, (_, k) => WK.addDays(cur, (1 - k) * 7)), schedule: WK.scheduleOf(cur, await meetingOf(cur)),
      me: { departmentId: req.user.departmentId, role: req.user.role, director: s.director, secretary: s.secretary, pmo: s.pmo, leader: s.leader, mustReport: s.mustReport,
        canManage: s.manage, canSummary: s.summary, canDetail: s.full, canOnBehalf: s.secretary, canConfig: P.can(s, 'edit', 'weekly.config'), canRoles: P.can(s, 'edit', 'weekly.roles'),
        canCompliance: P.can(s, 'view', 'weekly.compliance'), canApprove: s.director },
      secretaryDepartmentId: cfg.secretaryDepartmentId, pmoUserIds: cfg.pmoUserIds,
      departments: rd.all.map(d => ({ id: d.id, name: d.name })), required: rd.list.map(d => d.id), configured: rd.configured, startWeek: cfg.startWeek,
      sources: WK.SOURCES, statuses: WK.STATUSES, reasons: WK.REASONS, attendance: WK.ATTENDANCE, decisions: WK.DECISIONS, points: { ...WK.POINTS, ...(cfg.points || {}) }, pointLabels: WK.POINT_LABEL,
    });
  });

  // Hạng mục MTL người dùng xem được (cùng bộ lọc hiển thị như bảng theo dõi) + cấu hình cảnh báo của dự án.
  async function mtlItemsFor(user, now) {
    const projects = await prisma.project.findMany({ where: { kind: 'MTL', archivedAt: null, ...visibleProjectsWhere(user) } });
    const out = [];
    for (const p of projects) {
      const { items, cfg } = await MP.computeProject(prisma, p, user, now);
      for (const i of items) out.push({ ...i, projectKey: p.key, projectId: p.id, cfg, done: M.isDone(i), cancelled: M.isCancelled(i) });
    }
    return out;
  }
  // Điền sẵn cho một bộ phận (dùng khi xem và khi nộp — máy chủ tự xác định hạng mục bắt buộc).
  async function prefillFor(user, departmentId, week, now) {
    const [prevRep, members, items] = await Promise.all([
      prisma.weeklyReport.findUnique({ where: { departmentId_week: { departmentId, week: WK.addDays(week, -7) } } }),
      prisma.user.findMany({ where: { departmentId, ...ACTIVE_USER }, select: { id: true, fullName: true, displayTitle: true }, orderBy: { fullName: 'asc' } }),
      mtlItemsFor(user, now),
    ]);
    const memberIds = new Set(members.map(u => u.id));
    const cand = WK.deptCandidates(items, departmentId, memberIds);
    const checklist = cand.length ? await prisma.checklistItem.findMany({ where: { workItemId: { in: cand.map(i => i.id) } }, orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { workItemId: true, title: true, done: true } }) : [];
    for (const i of items) { const cl = checklist.filter(c => c.workItemId === i.id); i.hasChecklist = cl.length > 0; i.checklistNext = cl.find(c => !c.done)?.title || ''; }
    const { actions } = await D.openActions(prisma, week, departmentId);
    const prev = prevRep?.firstSubmittedAt ? prevRep.data : null; // chỉ bản ĐÃ NỘP tuần trước
    const prefill = WK.buildPrefill({ week, deptId: departmentId, items, memberIds, prev, actions });
    return { prefill, members, items, cand, hasPrev: !!prev, actions };
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
    const saved = acc.canEdit || savedRaw?.firstSubmittedAt ? savedRaw : null;
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

  // Ngữ cảnh làm sạch: người phụ trách hợp lệ (tài khoản đang hoạt động), bộ phận, hạng mục MTL người lập xem được.
  async function cleanCtx(user, now) {
    const [users, depts, items] = await Promise.all([
      prisma.user.findMany({ where: ACTIVE_USER, select: { id: true } }),
      prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
      mtlItemsFor(user, now),
    ]);
    return { userIds: new Set(users.map(u => u.id)), deptIds: new Set(depts.map(d => d.id)), itemIds: new Set(items.map(i => i.id)), deptName: id => depts.find(d => d.id === id)?.name || '', items };
  }
  const bodyDept = req => { const id = req.body?.departmentId ? intParam(req.body.departmentId, 'Bộ phận') : req.user.departmentId; if (!id) fail(422, 'Tài khoản chưa thuộc bộ phận nào', 'NO_DEPARTMENT'); return id; };

  // Lưu nháp (tự lưu). Hai người cùng lập: gửi kèm updatedAt đã đọc — lệch thì trả 409, không ghi đè phần người kia vừa sửa.
  app.put('/api/weekly/report', auth, async (req, res) => {
    const s = await subjectOf(req);
    const week = weekParam(req.body?.week), departmentId = bodyDept(req);
    await deptAccess(s, departmentId, 'edit');
    const existing = await prisma.weeklyReport.findUnique({ where: { departmentId_week: { departmentId, week } } });
    if (existing?.status === 'SUBMITTED') fail(409, 'Báo cáo đã nộp — sửa xong bấm "Gửi lại" để cập nhật', 'ALREADY_SUBMITTED');
    const base = req.body?.baseUpdatedAt ? new Date(req.body.baseUpdatedAt).getTime() : null;
    if (existing && base !== existing.updatedAt.getTime()) {
      const who = await userNames(prisma, [existing.preparerId]);
      return res.status(409).json({ error: `${who[existing.preparerId] || 'Người khác'} vừa lưu bản nháp này — tải lại để không ghi đè phần đã sửa`, code: 'DRAFT_CONFLICT', updatedAt: existing.updatedAt });
    }
    const ctx = await cleanCtx(req.user, new Date());
    const data = WK.sanitize(req.body?.data, ctx);
    const saved = existing
      ? await prisma.weeklyReport.update({ where: { id: existing.id }, data: { data, preparerId: req.user.id } })
      : await prisma.weeklyReport.create({ data: { departmentId, week, data, preparerId: req.user.id } });
    res.json({ ok: true, updatedAt: saved.updatedAt });
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
    const existing = await prisma.weeklyReport.findUnique({ where: { departmentId_week: { departmentId, week } } });
    // Sau giờ giao ban, bản đã nộp không gửi lại được (trừ thư ký) — giữ nguyên căn cứ của buổi họp.
    if (existing?.firstSubmittedAt && now > S.meetingAt && !s.secretary) fail(409, 'Đã qua giờ giao ban — muốn sửa báo cáo, liên hệ thư ký giao ban', 'REPORT_LOCKED');
    const ctx = await cleanCtx(req.user, now);
    const data = WK.sanitize(req.body?.data, ctx);
    const { prefill, cand } = await prefillFor(req.user, departmentId, week, now);
    const candIds = new Set(cand.map(i => i.id)), byId = new Map(ctx.items.map(i => [i.id, i]));
    const locked = new Set((await prisma.checklistItem.findMany({ where: { workItemId: { in: [...data.results, ...data.ongoing].map(r => r.itemId).filter(Boolean) } }, distinct: ['workItemId'], select: { workItemId: true } })).map(c => c.workItemId));
    // Dòng MTL: hạn, người phụ trách, khoá % lấy từ MTL; tình trạng tính lại từ MTL theo % mới — người lập chỉ nâng lên "Vướng" (một nguồn sự thật).
    for (const r of [...data.results, ...data.ongoing]) {
      const i = r.itemId && byId.get(r.itemId);
      if (!i) continue;
      r.pctLocked = locked.has(i.id) || i.children > 0;
      if (i.assignees?.length) r.ownerIds = i.assignees.map(a => a.id);
      r.due = WK.dayOf(i.baselineEnd) || r.due;
      if (r.pctLocked) r.pct = i.done ? 100 : Math.round(i.actual || 0);
      const pct = r.pct === '' ? Math.round(i.actual || 0) : r.pct;
      const done = i.done || (!r.pctLocked && pct >= 100);
      const computed = WK.statusFromMtl(M.statusOf({ ...i, progress: pct }, done ? 100 : pct, now, i.cfg).code, done);
      r.status = r.status === 'Vướng' && !done ? 'Vướng' : computed;
      if (r.status === WK.DONE) r.pct = 100;
    }
    const mandatory = [...prefill.results, ...prefill.ongoing].filter(r => r.mandatory);
    const errors = WK.validate(data, week, { deptName: ctx.deptName, mandatory });
    // Trả lại dữ liệu đã tính lại (tình trạng dòng MTL) để giao diện hiện đúng khối giải trình cần điền.
    if (errors.length) return res.status(422).json({ error: `Còn ${errors.length} mục cần sửa`, code: 'REPORT_INCOMPLETE', errors, data });
    let first = existing?.firstSubmittedAt || now, receivedAt = null;
    if (!existing?.firstSubmittedAt && acc.onBehalf && req.body?.receivedAt) {
      const t = new Date(req.body.receivedAt);
      if (Number.isNaN(t.getTime()) || t > now || t < WK.at(WK.addDays(week, -4), 0, 0)) fail(422, 'Giờ nhận email không hợp lệ', 'INVALID_DATE');
      first = receivedAt = t;
    }
    // Ghi ngược % vào MTL — chỉ khi: không phải nhập thay; hạng mục của chính bộ phận này; người nộp được cập nhật tiến độ
    // hạng mục đó (policy mtl.progress); và % trong MTL vẫn bằng % lúc điền sẵn (không đè số người khác vừa cập nhật).
    const updated = [], skipped = [], conflicts = [];
    if (!acc.onBehalf) {
      const leaderCache = new Map();
      for (const w of WK.writeBacks(data)) {
        if (!candIds.has(w.itemId)) { skipped.push(w.itemId); continue; }
        try {
          const { project, rights } = await loadItem(prisma, req.user, w.itemId, 'edit');
          const it = byId.get(w.itemId);
          if (!leaderCache.has(it.leadDepartmentId)) leaderCache.set(it.leadDepartmentId, await approval.deptLeaderIds(prisma, it.leadDepartmentId));
          if (project.kind !== 'MTL' || !P.can(s, 'edit', 'mtl.progress', { item: { assigneeIds: (it.assignees || []).map(a => a.id), leadLeaderIds: leaderCache.get(it.leadDepartmentId), projectManager: rights.canManage } })) { skipped.push(w.itemId); continue; }
          const row = [...data.results, ...data.ongoing].find(r => r.itemId === w.itemId);
          const result = await prisma.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'item:' + w.itemId}))`;
            const item = await tx.workItem.findUnique({ where: { id: w.itemId }, include: { state: true, _count: { select: { children: { where: { archivedAt: null } } } } } });
            if (!item || item.archivedAt || item._count.children) return 'skip';
            if (item.progress !== row.pct0) return 'conflict';
            return (await setProgress(tx, { user: req.user, project, rights, item, pct: w.pct, via: 'WEEKLY_REPORT' })) ? 'ok' : 'same';
          });
          if (result === 'ok' || result === 'same') { row.pct0 = w.pct; if (result === 'ok') { updated.push(w.itemId); bus.item(project.id, w.itemId, req.user.id); } }
          else if (result === 'conflict') conflicts.push(it.code); else skipped.push(w.itemId);
        } catch (error) { if (error.status && error.status < 500) skipped.push(w.itemId); else throw error; }
      }
    }
    const final = WK.finalize(data, week);
    const hash = sha256(final);
    const saved = await prisma.$transaction(async tx => {
      const r = existing
        ? await tx.weeklyReport.update({ where: { id: existing.id }, data: { data: final, status: 'SUBMITTED', preparerId: req.user.id, firstSubmittedAt: first, submittedAt: now, submittedById: req.user.id, submitCount: { increment: 1 } } })
        : await tx.weeklyReport.create({ data: { departmentId, week, data: final, status: 'SUBMITTED', preparerId: req.user.id, firstSubmittedAt: first, submittedAt: now, submittedById: req.user.id, submitCount: 1 } });
      await tx.weeklyReportVersion.create({ data: { reportId: r.id, n: r.submitCount, departmentId, week, data: final, sha256: hash, submittedAt: now, submittedById: req.user.id, onBehalf: acc.onBehalf } });
      return r;
    });
    await audit(req, 'WEEKLY_REPORT_SUBMIT', 'WeeklyReport', saved.id, null, { departmentId, week, n: saved.submitCount, sha256: hash, onBehalf: acc.onBehalf, receivedAt, firstSubmittedAt: saved.firstSubmittedAt,
      items: final.results.length + final.ongoing.length, plans: final.plans.length, progressUpdated: updated.length, progressSkipped: skipped.length, progressConflicts: conflicts.length });
    const notices = await prisma.weeklyNotice.findMany({ where: { week, departmentId } });
    res.json({ ok: true, submittedAt: saved.submittedAt, firstSubmittedAt: saved.firstSubmittedAt, submitCount: saved.submitCount, sha256: hash,
      progressUpdated: updated.length, progressSkipped: skipped.length, progressConflicts: conflicts, onBehalf: acc.onBehalf,
      status: WK.submissionStatus(saved, notices, S, now) });
  });

  // Các phiên bản đã nộp (người xem đầy đủ): đối chiếu bản đúng hạn với bản sửa sau hạn.
  app.get('/api/weekly/report/versions', auth, async (req, res) => {
    const s = await subjectOf(req);
    const week = weekParam(req.query.week), departmentId = intParam(req.query.departmentId, 'Bộ phận');
    P.assertCan(s, 'view', 'weekly.report', { departmentId });
    const rows = await prisma.weeklyReportVersion.findMany({ where: { week, departmentId }, orderBy: { n: 'asc' } });
    const names = await userNames(prisma, rows.map(v => v.submittedById));
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
      if (!(await prisma.user.findFirst({ where: { id: sub, ...ACTIVE_USER } }))) fail(422, 'Người dự thay không hợp lệ', 'INVALID_VALUE');
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
    const { sum, names, all, configured } = await D.summaryOf(prisma, week);
    const full = P.can(s, 'view', 'weekly.summary.detail');
    // Trưởng / phó bộ phận: bản tóm tắt như văn bản gửi đi (không họ tên, không ghi chú vắng, không chi tiết bộ phận khác).
    const out = full ? sum : WK.briefSummary(sum, s.departmentId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ...out, names: full ? names : {}, departments: all.map(d => ({ id: d.id, name: d.name })), configured, canManage: s.manage, canDetail: full, text: WK.summaryText(sum) });
  });
  app.post('/api/weekly/summary/copied', auth, async (req, res) => {
    const s = await subjectOf(req);
    P.assertCan(s, 'export', 'weekly.summary');
    const week = weekParam(req.body?.week);
    await audit(req, 'WEEKLY_SUMMARY_COPY', 'WeeklyMeeting', week, null, { week });
    res.status(204).end();
  });

  // ---------- Buổi giao ban: tuần nghỉ, hạn nộp / ngày họp, điểm danh, không đạt, kết luận TGĐ, Action Log, phát hành ----------
  app.put('/api/weekly/meeting', auth, async (req, res) => {
    const s = await subjectOf(req);
    P.assertCan(s, 'edit', 'weekly.meeting');
    const b = req.body || {}, week = weekParam(b.week);
    const depts = new Set((await prisma.department.findMany({ where: { isActive: true }, select: { id: true } })).map(d => d.id));
    const existing = await meetingOf(week);
    const data = { ...(existing?.data || {}) };
    if (b.skip !== undefined) data.skip = !!b.skip; // tuần nghỉ Tết / lễ: không giao ban, không chấm điểm
    if (b.deadlineDay !== undefined) { if (b.deadlineDay && (!WK.isDay(b.deadlineDay) || b.deadlineDay > week || b.deadlineDay < WK.addDays(week, -4))) fail(422, 'Hạn nộp phải là một ngày từ thứ Hai đến thứ Sáu của tuần báo cáo', 'INVALID_DATE'); data.deadlineDay = b.deadlineDay || null; }
    if (b.meetingDay !== undefined) { if (b.meetingDay && (!WK.isDay(b.meetingDay) || b.meetingDay <= week || b.meetingDay > WK.addDays(week, 10))) fail(422, 'Ngày giao ban phải sau thứ Sáu của tuần báo cáo', 'INVALID_DATE'); data.meetingDay = b.meetingDay || null; }
    if (b.attendance !== undefined) {
      const att = {};
      for (const [k, v] of Object.entries(b.attendance || {})) if (depts.has(Number(k)) && WK.ATTENDANCE[v]) att[Number(k)] = v;
      data.attendance = att;
    }
    if (b.failed !== undefined) { const f = {}; for (const [k, v] of Object.entries(b.failed || {})) if (depts.has(Number(k)) && v) f[Number(k)] = true; data.failed = f; }
    if (b.conclusions !== undefined) {
      const c = {};
      for (const [k, v] of Object.entries(b.conclusions || {})) {
        if (!/^\d+:[\w-]{1,40}$/.test(k) || !v || !WK.DECISIONS[v.decision]) continue;
        c[k] = { decision: v.decision, departmentId: v.decision === 'ASSIGN' && depts.has(Number(v.departmentId)) ? Number(v.departmentId) : null, note: String(v.note ?? '').trim().slice(0, 500) };
      }
      data.conclusions = c;
    }
    if (b.actions !== undefined) {
      const users = new Map((await prisma.user.findMany({ where: ACTIVE_USER, select: { id: true, departmentId: true } })).map(u => [u.id, u]));
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
    const publish = b.publish === true && !existing?.publishedAt;
    if (publish) { // TGĐ kết luận TỪNG yêu cầu hỗ trợ trước khi phát hành (Điều 5)
      const { sum } = await D.summaryOf(prisma, week);
      const missing = sum.helps.flatMap(g => g.list).filter(h => !data.conclusions?.[h.key]);
      if (missing.length) fail(422, `Còn ${missing.length} yêu cầu hỗ trợ chưa có kết luận của TGĐ`, 'CONCLUSION_MISSING');
    }
    const saved = await prisma.weeklyMeeting.upsert({ where: { week }, create: { week, data, updatedById: req.user.id, publishedAt: publish ? new Date() : null }, update: { data, updatedById: req.user.id, ...(publish ? { publishedAt: new Date() } : {}) } });
    await audit(req, publish ? 'WEEKLY_MEETING_PUBLISH' : 'WEEKLY_MEETING', 'WeeklyMeeting', week, null, { week, keys: Object.keys(b).filter(k => k !== 'week'), actions: (data.actions || []).length, skip: !!data.skip });
    if (publish) {
      const leaders = new Set(), owners = new Set();
      for (const d of depts) for (const id of await approval.deptLeaderIds(prisma, d)) leaders.add(id);
      for (const a of data.actions || []) if (a.ownerId) owners.add(a.ownerId);
      const S = WK.scheduleOf(week, saved);
      await notify(prisma, [...new Set([...leaders, ...owners, ...(await D.summaryViewerIds(prisma))])], { type: 'WEEKLY_ACTION_LOG', title: `Kết luận giao ban ${WK.fmtD(S.meetingDay)} và Action Log đã phát hành`, body: `${(data.actions || []).length} việc — tự vào Phần I báo cáo tuần sau`, link: '#/tuan/tong-hop' }, req.user.id);
    }
    res.json({ ok: true, publishedAt: saved.publishedAt, data: saved.data, schedule: WK.scheduleOf(week, saved) });
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
    const value = { departments, startWeek, secretaryDepartmentId: sec, pmoUserIds: pmo, ...(before.points ? { points: before.points } : {}) };
    await prisma.appSetting.upsert({ where: { key: D.CONFIG_KEY }, create: { key: D.CONFIG_KEY, value, updatedById: req.user.id }, update: { value, updatedById: req.user.id } });
    // Danh sách phải nộp đã chụp của tuần hiện tại (chưa phát hành kết luận) đi theo thiết lập mới; các tuần đã qua giữ nguyên.
    if (b.departments !== undefined) {
      const cur = WK.currentFriday(new Date()), m = await meetingOf(cur);
      if (m && !m.publishedAt && Array.isArray(m.data?.required)) {
        const rd = await requiredDepartments(prisma, await weeklyConfig(prisma));
        await D.snapshotRequired(prisma, cur, rd.list.map(d => d.id));
      }
    }
    await audit(req, 'WEEKLY_CONFIG', 'AppSetting', D.CONFIG_KEY, { departments: before.departments, startWeek: before.startWeek, secretaryDepartmentId: before.secretaryDepartmentId, pmoUserIds: before.pmoUserIds },
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
  app.get('/api/weekly/compliance', auth, async (req, res) => {
    const s = await subjectOf(req);
    P.assertCan(s, 'view', 'weekly.compliance');
    const now = new Date(), month = monthParam(req.query.month, now);
    const st = (await prisma.appSetting.findUnique({ where: { key: COMPLIANCE_KEY(month) } }))?.value || null;
    const live = await complianceRows(month, now);
    const names = st ? await userNames(prisma, [st.submittedById, st.approvedById]) : {};
    res.setHeader('Cache-Control', 'private, no-store');
    // Đã duyệt: trả bảng đã khoá (không tính lại); chưa: tính theo số liệu hiện có.
    res.json({ month, ...(st?.status === 'APPROVED' ? { ...live, rows: st.rows } : live), state: st ? { status: st.status, submittedAt: st.submittedAt, submittedBy: names[st.submittedById] || '', approvedAt: st.approvedAt || null, approvedBy: names[st.approvedById] || '' } : { status: 'DRAFT' },
      canSubmit: s.secretary && st?.status !== 'APPROVED', canApprove: s.director && st?.status === 'SUBMITTED' });
  });
  app.post('/api/weekly/compliance/:action', auth, async (req, res) => {
    const s = await subjectOf(req);
    P.assertCan(s, 'view', 'weekly.compliance');
    const now = new Date(), month = monthParam(req.body?.month, now), key = COMPLIANCE_KEY(month);
    const cur = (await prisma.appSetting.findUnique({ where: { key } }))?.value || null;
    if (cur?.status === 'APPROVED') fail(409, 'Bảng điểm tháng này đã được duyệt và khoá', 'LOCKED');
    let value;
    if (req.params.action === 'submit') {
      if (!s.secretary) fail(403, 'Thư ký giao ban lập và trình bảng điểm', 'FORBIDDEN');
      value = { status: 'SUBMITTED', rows: (await complianceRows(month, now)).rows, submittedById: req.user.id, submittedAt: now.toISOString() };
    } else if (req.params.action === 'approve') {
      if (!s.director) fail(403, 'TGĐ duyệt bảng điểm tuân thủ', 'FORBIDDEN');
      if (cur?.status !== 'SUBMITTED') fail(409, 'Thư ký chưa trình bảng điểm tháng này', 'NOT_SUBMITTED');
      value = { ...cur, status: 'APPROVED', approvedById: req.user.id, approvedAt: now.toISOString() };
    } else fail(404, 'Không tìm thấy thao tác', 'NOT_FOUND');
    await prisma.appSetting.upsert({ where: { key }, create: { key, value, updatedById: req.user.id }, update: { value, updatedById: req.user.id } });
    await audit(req, req.params.action === 'approve' ? 'WEEKLY_COMPLIANCE_APPROVE' : 'WEEKLY_COMPLIANCE_SUBMIT', 'AppSetting', key, null, { month, sha256: sha256(value.rows) });
    res.json({ ok: true, status: value.status });
  });
};
