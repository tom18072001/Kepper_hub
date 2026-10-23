// Kepper GĐ2b — Báo cáo tuần bộ phận (BM-TH-01), báo nộp muộn / vắng, tổng hợp giao ban, Action Log, chấm điểm tuân thủ.
// Quyền:
// - Lập / nộp báo cáo của bộ phận: thành viên bộ phận. Thư ký (quyền "Xem tổng hợp" toàn đơn vị) hoặc PMO nhập thay.
// - Xem Tổng hợp: TGĐ, thư ký, PMO, trưởng / phó bộ phận (quyền "Xem tổng hợp" ở bất kỳ phạm vi nào) — Điều 5, bước 4–5.
// - Thiết lập (bộ phận phải nộp, hạn nộp khi nghỉ lễ), điểm danh, kết luận, Action Log, chấm điểm: thư ký / TGĐ / PMO.
// Tài khoản quản trị hệ thống (IT) không xem nội dung nghiệp vụ.
const { fail, intParam } = require('../lib/http');
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

module.exports = function mountWeekly(app, { prisma, auth, audit }) {
  const roleCheck = async (req, need) => {
    const roles = await D.rolesOf(prisma, req.user);
    if (roles.it) fail(403, 'Tài khoản quản trị hệ thống không xem nội dung nghiệp vụ', 'FORBIDDEN');
    if (need && !roles[need]) fail(403, need === 'manage' ? 'Chỉ thư ký giao ban, Ban Giám đốc hoặc PMO được làm việc này' : 'Bạn không có quyền xem bản tổng hợp', 'FORBIDDEN');
    return roles;
  };
  const deptAccess = async (req, departmentId, roles) => {
    const dept = await prisma.department.findFirst({ where: { id: departmentId, isActive: true }, select: { id: true, name: true } });
    if (!dept) fail(404, 'Không tìm thấy bộ phận', 'NOT_FOUND');
    const own = req.user.departmentId === departmentId;
    if (!own && !roles.manage && !roles.summary) fail(403, 'Chỉ xem được báo cáo của bộ phận mình', 'FORBIDDEN');
    return { dept, own, canEdit: own || roles.manage, onBehalf: !own && roles.manage };
  };
  const meetingOf = week => D.meetingOf(prisma, week);

  // ---------- Danh mục, tuần, quyền ----------
  app.get('/api/weekly/context', auth, async (req, res) => {
    const roles = await roleCheck(req);
    const cfg = await weeklyConfig(prisma), req2 = await requiredDepartments(prisma, cfg);
    const now = new Date(), cur = WK.currentFriday(now);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      week: cur, weeks: Array.from({ length: 10 }, (_, k) => WK.addDays(cur, (1 - k) * 7)), schedule: WK.scheduleOf(cur, await meetingOf(cur)),
      me: { departmentId: req.user.departmentId, canManage: roles.manage, canSummary: roles.summary },
      departments: req2.all.map(d => ({ id: d.id, name: d.name })), required: req2.list.map(d => d.id), configured: req2.configured, startWeek: cfg.startWeek,
      sources: WK.SOURCES, statuses: WK.STATUSES, reasons: WK.REASONS, attendance: WK.ATTENDANCE, decisions: WK.DECISIONS, points: { ...WK.POINTS, ...(cfg.points || {}) }, pointLabels: WK.POINT_LABEL,
    });
  });

  // ---------- Báo cáo của một bộ phận: bản đã lưu + bản điền sẵn từ MTL / tuần trước / Action Log ----------
  app.get('/api/weekly/report', auth, async (req, res) => {
    const roles = await roleCheck(req);
    const week = weekParam(req.query.week);
    const departmentId = req.query.departmentId ? intParam(req.query.departmentId, 'Bộ phận') : req.user.departmentId;
    if (!departmentId) fail(422, 'Tài khoản chưa thuộc bộ phận nào — chọn bộ phận', 'NO_DEPARTMENT');
    const acc = await deptAccess(req, departmentId, roles);
    const now = new Date();
    const [saved, prevRep, prevMeeting, meeting, members, leaders, notices] = await Promise.all([
      prisma.weeklyReport.findUnique({ where: { departmentId_week: { departmentId, week } } }),
      prisma.weeklyReport.findUnique({ where: { departmentId_week: { departmentId, week: WK.addDays(week, -7) } } }),
      meetingOf(WK.addDays(week, -7)), meetingOf(week),
      prisma.user.findMany({ where: { departmentId, ...ACTIVE_USER }, select: { id: true, fullName: true, displayTitle: true }, orderBy: { fullName: 'asc' } }),
      approval.deptLeaderIds(prisma, departmentId),
      prisma.weeklyNotice.findMany({ where: { week, departmentId }, orderBy: { id: 'asc' } }),
    ]);
    // Hạng mục MTL người xem được (cùng bộ lọc hiển thị như bảng theo dõi).
    const memberIds = new Set(members.map(u => u.id));
    const items = await mtlItemsFor(req.user, now);
    const cand = WK.deptCandidates(items, departmentId, memberIds);
    const checklist = cand.length ? await prisma.checklistItem.findMany({ where: { workItemId: { in: cand.map(i => i.id) } }, orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { workItemId: true, title: true, done: true } }) : [];
    for (const i of items) { const cl = checklist.filter(c => c.workItemId === i.id); i.hasChecklist = cl.length > 0; i.checklistNext = cl.find(c => !c.done)?.title || ''; }
    const actions = (prevMeeting?.publishedAt ? prevMeeting.data?.actions || [] : []).filter(a => a.departmentId === departmentId).map(a => ({ ...a, ref: `${prevMeeting.week}:${a.id}` }));
    const prev = prevRep ? prevRep.data : null;
    const prefill = WK.buildPrefill({ week, deptId: departmentId, items, memberIds, prev, actions });
    const names = await userNames(prisma, [...members.map(u => u.id), ...leaders, ...rowOwnerIds(prefill), ...rowOwnerIds(saved?.data), saved?.submittedById, saved?.preparerId, ...notices.flatMap(n => [n.createdById, n.substituteId])]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      week, schedule: WK.scheduleOf(week, meeting), department: acc.dept, canEdit: acc.canEdit, onBehalf: acc.onBehalf,
      leaders: leaders.map(id => names[id]).filter(Boolean), members: members.map(u => ({ id: u.id, fullName: u.fullName, title: u.displayTitle || '' })), names,
      report: reportOut(saved, names), prefill, hasPrev: !!prevRep, actions: actions.length,
      notices: notices.map(n => noticeOut(n, names)),
      status: WK.submissionStatus(saved?.firstSubmittedAt ? saved : null, notices, WK.scheduleOf(week, meeting), now),
    });
  });

  async function mtlItemsFor(user, now) {
    const projects = await prisma.project.findMany({ where: { kind: 'MTL', archivedAt: null, ...visibleProjectsWhere(user) } });
    const out = [];
    for (const p of projects) {
      const { items } = await MP.computeProject(prisma, p, user, now);
      for (const i of items) out.push({ ...i, projectKey: p.key, projectId: p.id, done: M.isDone(i), cancelled: M.isCancelled(i) });
    }
    return out;
  }
  const noticeOut = (n, names) => ({ id: n.id, departmentId: n.departmentId, week: n.week, type: n.type, typeLabel: WK.NOTICE_TYPES[n.type], reason: n.reason, reasonLabel: WK.REASONS[n.reason] || '', note: n.note,
    expectedAt: n.expectedAt, substituteId: n.substituteId, substitute: names[n.substituteId] || null, createdBy: names[n.createdById] || null, createdById: n.createdById, createdAt: n.createdAt });

  // Ngữ cảnh làm sạch: người phụ trách hợp lệ (tài khoản đang hoạt động), bộ phận, hạng mục MTL người lập xem được.
  async function cleanCtx(user, now) {
    const [users, depts, items] = await Promise.all([
      prisma.user.findMany({ where: ACTIVE_USER, select: { id: true } }),
      prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
      mtlItemsFor(user, now),
    ]);
    return { userIds: new Set(users.map(u => u.id)), deptIds: new Set(depts.map(d => d.id)), itemIds: new Set(items.map(i => i.id)), deptName: id => depts.find(d => d.id === id)?.name || '', items };
  }
  const bodyDept = (req, roles) => { const id = req.body?.departmentId ? intParam(req.body.departmentId, 'Bộ phận') : req.user.departmentId; if (!id) fail(422, 'Chọn bộ phận', 'NO_DEPARTMENT'); return id; };

  // Lưu nháp (tự lưu khi đang lập; báo cáo đã nộp thì sửa rồi bấm "Gửi lại").
  app.put('/api/weekly/report', auth, async (req, res) => {
    const roles = await roleCheck(req);
    const week = weekParam(req.body?.week), departmentId = bodyDept(req, roles);
    const acc = await deptAccess(req, departmentId, roles);
    if (!acc.canEdit) fail(403, 'Chỉ thành viên bộ phận lập báo cáo của bộ phận mình', 'FORBIDDEN');
    const existing = await prisma.weeklyReport.findUnique({ where: { departmentId_week: { departmentId, week } } });
    if (existing?.status === 'SUBMITTED') fail(409, 'Báo cáo đã nộp — sửa xong bấm "Gửi lại" để cập nhật', 'ALREADY_SUBMITTED');
    const ctx = await cleanCtx(req.user, new Date());
    const data = WK.sanitize(req.body?.data, ctx);
    const saved = await prisma.weeklyReport.upsert({ where: { departmentId_week: { departmentId, week } }, create: { departmentId, week, data, preparerId: req.user.id }, update: { data, preparerId: req.user.id } });
    res.json({ ok: true, updatedAt: saved.updatedAt });
  });

  // Nộp / gửi lại. Giờ nộp tính theo lần gửi đầu (Điều 6); thư ký nhập thay được ghi giờ nhận email.
  app.post('/api/weekly/submit', auth, async (req, res) => {
    const roles = await roleCheck(req);
    const now = new Date();
    const week = weekParam(req.body?.week, now), departmentId = bodyDept(req, roles);
    const acc = await deptAccess(req, departmentId, roles);
    if (!acc.canEdit) fail(403, 'Chỉ thành viên bộ phận nộp báo cáo của bộ phận mình', 'FORBIDDEN');
    if (week > WK.currentFriday(now)) fail(422, 'Chưa đến tuần này', 'FUTURE_WEEK');
    const ctx = await cleanCtx(req.user, now);
    const data = WK.sanitize(req.body?.data, ctx);
    // Hạng mục dùng checklist: % do checklist tính — không lấy % từ trình duyệt.
    const locked = new Set((await prisma.checklistItem.findMany({ where: { workItemId: { in: [...data.results, ...data.ongoing].map(r => r.itemId).filter(Boolean) } }, distinct: ['workItemId'], select: { workItemId: true } })).map(c => c.workItemId));
    for (const r of [...data.results, ...data.ongoing]) r.pctLocked = !!r.itemId && locked.has(r.itemId);
    const errors = WK.validate(data, week, { deptName: ctx.deptName });
    if (errors.length) return res.status(422).json({ error: `Còn ${errors.length} mục cần sửa`, code: 'REPORT_INCOMPLETE', errors });
    const existing = await prisma.weeklyReport.findUnique({ where: { departmentId_week: { departmentId, week } } });
    let first = existing?.firstSubmittedAt || now;
    if (!existing?.firstSubmittedAt && acc.onBehalf && req.body?.receivedAt) {
      const t = new Date(req.body.receivedAt);
      if (Number.isNaN(t.getTime()) || t > now || t < WK.at(WK.addDays(week, -4), 0, 0)) fail(422, 'Giờ nhận email không hợp lệ', 'INVALID_DATE');
      first = t;
    }
    // Ghi ngược % vào MTL — chỉ hạng mục người nộp có quyền sửa; lỗi quyền thì bỏ qua (báo lại số bỏ qua).
    const wb = WK.writeBacks(data), updated = [], skipped = [];
    for (const w of wb) {
      try {
        const { project, rights } = await loadItem(prisma, req.user, w.itemId, 'edit');
        if (project.kind !== 'MTL') { skipped.push(w.itemId); continue; }
        const ok = await prisma.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'item:' + w.itemId}))`;
          const item = await tx.workItem.findUnique({ where: { id: w.itemId }, include: { state: true, _count: { select: { children: { where: { archivedAt: null } } } } } });
          if (!item || item.archivedAt || item._count.children) return false;
          return setProgress(tx, { user: req.user, project, rights, item, pct: w.pct, via: 'WEEKLY_REPORT' });
        });
        if (ok) { updated.push(w.itemId); bus.item(project.id, w.itemId, req.user.id); }
      } catch (error) { if (error.status && error.status < 500) skipped.push(w.itemId); else throw error; }
    }
    const final = WK.finalize(data, week);
    const saved = await prisma.weeklyReport.upsert({
      where: { departmentId_week: { departmentId, week } },
      create: { departmentId, week, data: final, status: 'SUBMITTED', preparerId: req.user.id, firstSubmittedAt: first, submittedAt: now, submittedById: req.user.id, submitCount: 1 },
      update: { data: final, status: 'SUBMITTED', preparerId: req.user.id, firstSubmittedAt: first, submittedAt: now, submittedById: req.user.id, submitCount: { increment: 1 } },
    });
    await audit(req, 'WEEKLY_REPORT_SUBMIT', 'WeeklyReport', saved.id, null, { departmentId, week, onBehalf: acc.onBehalf, items: final.results.length + final.ongoing.length, plans: final.plans.length, progressUpdated: updated.length, progressSkipped: skipped.length, resubmit: saved.submitCount > 1 });
    const meeting = await meetingOf(week);
    const notices = await prisma.weeklyNotice.findMany({ where: { week, departmentId } });
    res.json({ ok: true, submittedAt: saved.submittedAt, firstSubmittedAt: saved.firstSubmittedAt, submitCount: saved.submitCount, progressUpdated: updated.length, progressSkipped: skipped.length,
      status: WK.submissionStatus(saved, notices, WK.scheduleOf(week, meeting), now) });
  });

  // ---------- Báo nộp muộn / vắng (Điều 6, 7) ----------
  app.get('/api/weekly/notices', auth, async (req, res) => {
    const roles = await roleCheck(req);
    const week = weekParam(req.query.week);
    const where = roles.summary ? { week } : { week, departmentId: req.user.departmentId ?? -1 };
    const rows = await prisma.weeklyNotice.findMany({ where, orderBy: { id: 'desc' } });
    const names = await userNames(prisma, rows.flatMap(n => [n.createdById, n.substituteId]));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(rows.map(n => noticeOut(n, names)));
  });
  app.post('/api/weekly/notices', auth, async (req, res) => {
    const roles = await roleCheck(req);
    const b = req.body || {}, now = new Date();
    const week = weekParam(b.week, now), departmentId = bodyDept(req, roles);
    const acc = await deptAccess(req, departmentId, roles);
    if (!acc.canEdit) fail(403, 'Chỉ báo cho bộ phận của mình', 'FORBIDDEN');
    if (!WK.NOTICE_TYPES[b.type]) fail(422, 'Loại thông báo không hợp lệ', 'INVALID_VALUE');
    if (!WK.REASONS[b.reason]) fail(422, 'Chọn lý do', 'REQUIRED');
    const note = String(b.note ?? '').trim();
    if (note.length > 200) fail(422, 'Ghi chú tối đa 200 ký tự', 'TOO_LONG');
    if (b.reason === 'KHAC' && !note) fail(422, 'Lý do khác: ghi ngắn gọn lý do', 'REQUIRED');
    const data = { week, departmentId, type: b.type, reason: b.reason, note, createdById: req.user.id };
    if (b.type === 'LATE') {
      const t = b.expectedAt ? new Date(b.expectedAt) : null;
      if (!t || Number.isNaN(t.getTime())) fail(422, 'Ghi giờ nộp dự kiến', 'REQUIRED');
      data.expectedAt = t;
    } else {
      const sub = b.substituteId ? intParam(b.substituteId, 'Người dự thay') : null;
      if (!sub) fail(422, 'Cử cấp phó hoặc người được ủy quyền dự thay', 'REQUIRED');
      if (!(await prisma.user.findFirst({ where: { id: sub, isActive: true, isRootAdmin: false, role: { not: 'admin' } } }))) fail(422, 'Người dự thay không hợp lệ', 'INVALID_VALUE');
      data.substituteId = sub;
    }
    const n = await prisma.weeklyNotice.create({ data });
    await audit(req, 'WEEKLY_NOTICE', 'WeeklyNotice', n.id, null, { departmentId, week, type: n.type, reason: n.reason });
    // Báo thư ký / BGĐ / PMO (Điều 6: thông báo cho Phòng Tổng hợp; Điều 7: báo TGĐ).
    const S = WK.scheduleOf(week, await meetingOf(week));
    const dept = acc.dept.name;
    const to = await D.managerIds(prisma);
    await notify(prisma, to, { type: 'WEEKLY_NOTICE', title: n.type === 'LATE' ? `${dept} báo nộp báo cáo tuần muộn` : `${dept} báo vắng giao ban ${WK.fmtD(S.meetingDay)}`, body: WK.REASONS[n.reason] + (note ? ` — ${note}` : ''), link: '#/tuan/bao' }, req.user.id);
    const names = await userNames(prisma, [n.createdById, n.substituteId]);
    res.status(201).json(noticeOut(n, names));
  });
  app.delete('/api/weekly/notices/:id', auth, async (req, res) => {
    const roles = await roleCheck(req);
    const n = await prisma.weeklyNotice.findUnique({ where: { id: intParam(req.params.id) } });
    if (!n || (n.createdById !== req.user.id && !roles.manage)) fail(404, 'Không tìm thấy thông báo', 'NOT_FOUND');
    await prisma.weeklyNotice.delete({ where: { id: n.id } });
    await audit(req, 'WEEKLY_NOTICE_DELETE', 'WeeklyNotice', n.id, { departmentId: n.departmentId, week: n.week, type: n.type }, null);
    res.status(204).end();
  });
  // ---------- Tổng hợp giao ban ----------
  app.get('/api/weekly/summary', auth, async (req, res) => {
    const roles = await roleCheck(req, 'summary');
    const week = weekParam(req.query.week);
    const { sum, names, all, configured } = await D.summaryOf(prisma, week);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ...sum, names, departments: all.map(d => ({ id: d.id, name: d.name })), configured, canManage: roles.manage, text: WK.summaryText(sum) });
  });
  app.post('/api/weekly/summary/copied', auth, async (req, res) => {
    await roleCheck(req, 'summary');
    const week = weekParam(req.body?.week);
    await audit(req, 'WEEKLY_SUMMARY_COPY', 'WeeklyMeeting', week, null, { week });
    res.status(204).end();
  });

  // ---------- Buổi giao ban: hạn nộp / ngày họp, điểm danh, báo cáo không đạt, kết luận, Action Log, phát hành ----------
  app.put('/api/weekly/meeting', auth, async (req, res) => {
    await roleCheck(req, 'manage');
    const b = req.body || {}, week = weekParam(b.week);
    const depts = new Set((await prisma.department.findMany({ where: { isActive: true }, select: { id: true } })).map(d => d.id));
    const existing = await meetingOf(week);
    const data = { ...(existing?.data || {}) };
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
      const users = new Set((await prisma.user.findMany({ where: { isActive: true }, select: { id: true } })).map(u => u.id));
      let next = Math.max(0, ...(data.actions || []).map(a => a.id || 0)) + 1;
      data.actions = (Array.isArray(b.actions) ? b.actions.slice(0, 100) : []).map(a => {
        const task = String(a?.task ?? '').trim().slice(0, 500);
        if (!task) return null;
        const departmentId = Number(a.departmentId);
        if (!depts.has(departmentId)) fail(422, `Action Log "${task.slice(0, 40)}": chọn bộ phận phụ trách`, 'REQUIRED');
        if (!WK.isDay(a.due)) fail(422, `Action Log "${task.slice(0, 40)}": thiếu hạn`, 'REQUIRED');
        return { id: Number.isInteger(a.id) && a.id > 0 ? a.id : next++, task, departmentId, ownerId: users.has(Number(a.ownerId)) ? Number(a.ownerId) : null, due: a.due, helpKey: a.helpKey ? String(a.helpKey).slice(0, 60) : null };
      }).filter(Boolean);
    }
    const publish = b.publish === true && !existing?.publishedAt;
    const saved = await prisma.weeklyMeeting.upsert({ where: { week }, create: { week, data, updatedById: req.user.id, publishedAt: publish ? new Date() : null }, update: { data, updatedById: req.user.id, ...(publish ? { publishedAt: new Date() } : {}) } });
    await audit(req, publish ? 'WEEKLY_MEETING_PUBLISH' : 'WEEKLY_MEETING', 'WeeklyMeeting', week, null, { week, keys: Object.keys(b).filter(k => k !== 'week'), actions: (data.actions || []).length });
    // Phát hành Kết luận + Action Log (bước 7): báo trưởng các bộ phận; người phụ trách việc trong Action Log.
    if (publish) {
      const leaders = new Set(), owners = new Set();
      for (const d of depts) for (const id of await approval.deptLeaderIds(prisma, d)) leaders.add(id);
      for (const a of data.actions || []) if (a.ownerId) owners.add(a.ownerId);
      const S = WK.scheduleOf(week, saved);
      await notify(prisma, [...new Set([...leaders, ...owners, ...(await D.summaryViewerIds(prisma))])], { type: 'WEEKLY_ACTION_LOG', title: `Kết luận giao ban ${WK.fmtD(S.meetingDay)} và Action Log đã phát hành`, body: `${(data.actions || []).length} việc — tự vào Phần I báo cáo tuần sau`, link: '#/tuan/tong-hop' }, req.user.id);
    }
    res.json({ ok: true, publishedAt: saved.publishedAt, data: saved.data, schedule: WK.scheduleOf(week, saved) });
  });

  // ---------- Thiết lập: bộ phận phải nộp (thứ tự trình bày), tuần bắt đầu tính điểm ----------
  app.put('/api/weekly/config', auth, async (req, res) => {
    await roleCheck(req, 'manage');
    const all = new Set((await prisma.department.findMany({ where: { isActive: true }, select: { id: true } })).map(d => d.id));
    const before = await weeklyConfig(prisma);
    const departments = [...new Set((Array.isArray(req.body?.departments) ? req.body.departments : []).map(Number))].filter(id => all.has(id));
    const startWeek = req.body?.startWeek === undefined ? before.startWeek : req.body.startWeek ? weekParam(req.body.startWeek) : null;
    const value = { departments, startWeek, ...(before.points ? { points: before.points } : {}) };
    await prisma.appSetting.upsert({ where: { key: D.CONFIG_KEY }, create: { key: D.CONFIG_KEY, value, updatedById: req.user.id }, update: { value, updatedById: req.user.id } });
    await audit(req, 'WEEKLY_CONFIG', 'AppSetting', D.CONFIG_KEY, { departments: before.departments, startWeek: before.startWeek }, { departments, startWeek });
    res.json({ ok: true, departments, startWeek });
  });

  // ---------- Chấm điểm tuân thủ tháng (Phụ lục 1) ----------
  app.get('/api/weekly/compliance', auth, async (req, res) => {
    await roleCheck(req, 'manage');
    const now = new Date();
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : WK.currentFriday(now).slice(0, 7);
    const cfg = await weeklyConfig(prisma), rd = await requiredDepartments(prisma, cfg);
    const weeks = WK.fridaysOf(month, now, cfg.startWeek);
    const [reports, notices, meetings] = await Promise.all([
      prisma.weeklyReport.findMany({ where: { week: { in: weeks } }, select: { departmentId: true, week: true, firstSubmittedAt: true } }),
      prisma.weeklyNotice.findMany({ where: { week: { in: weeks } } }),
      prisma.weeklyMeeting.findMany({ where: { week: { in: weeks } } }),
    ]);
    const byWeek = Object.fromEntries(weeks.map(f => [f, { reports: reports.filter(r => r.week === f), notices: notices.filter(n => n.week === f), meeting: meetings.find(m => m.week === f) || null }]));
    const rows = WK.compliance({ weeks, depts: rd.list, byWeek, points: cfg.points, now });
    const leaderNames = {};
    for (const d of rd.list) { const ids = await approval.deptLeaderIds(prisma, d.id); const n = await userNames(prisma, ids); leaderNames[d.id] = ids.map(id => n[id]).filter(Boolean); }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ month, weeks, startWeek: cfg.startWeek, points: { ...WK.POINTS, ...(cfg.points || {}) }, rows: rows.map(r => ({ ...r, leaders: leaderNames[r.id] || [] })) });
  });

};
