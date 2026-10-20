// Kepper — Master Timeline: nhập MTL tổng / MTL bộ phận từ Excel, bảng theo dõi tiến độ (kế hoạch gốc so với thực tế),
// Dashboard dự án, KPI tiến độ theo bộ phận / người, danh mục dự án, điều chỉnh kế hoạch gốc (bắt buộc lý do, ghi nhật ký).
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { fail, intParam, optionalInt, optionalDate, text } = require('../lib/http');
const { permissionScope, isItAdmin } = require('../lib/permissions');
const { verifyUpload } = require('../lib/files');
const { loadProject, loadItem, visibleProjectsWhere, itemVisibleWhere } = require('../services/access');
const MP = require('../services/mtl-project');
const { activity } = require('../services/events');
const { matchPeople } = require('../services/people');
const approval = require('../services/approval');
const bus = require('../services/bus');
const M = require('../services/mtl');
const A = require('../services/alerts');

// Xem KPI theo người: Ban lãnh đạo (SYSTEM) mọi người; trưởng / phó bộ phận (UNIT) bộ phận mình.
const kpiScope = user => (isItAdmin(user) ? null : permissionScope(user, 'reports.kpi', 'VIEW') === 'SYSTEM' || permissionScope(user, 'work.approve', 'OPERATE') === 'SYSTEM' ? 'SYSTEM' : permissionScope(user, 'work.approve', 'OPERATE') === 'UNIT' ? 'UNIT' : null);

module.exports = function mountMtl(app, { prisma, auth, audit, config }) {
  const upload = multer({ dest: path.join(config.uploadTmpDir, 'workhub-import'), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  const mtlProject = async (req, need = 'view') => {
    const ctx = await loadProject(prisma, req.user, intParam(req.params.id), need);
    if (ctx.project.kind !== 'MTL') fail(422, 'Dự án này không theo Master Timeline', 'NOT_MTL');
    return ctx;
  };

  const computeProject = (project, user, day) => MP.computeProject(prisma, project, user, day);
  const isDeptLeader = async (user, departmentId) => departmentId != null && (await approval.deptLeaderIds(prisma, departmentId)).includes(user.id);

  // ---------- Nhập MTL từ Excel ----------
  // multipart: file (.xlsx), sheet?, kind = MASTER | DEPARTMENT, departmentId (MTL bộ phận), planName?, dryRun, rebaseline (đặt lại kế hoạch gốc).
  app.post('/api/projects/:id/mtl-import', auth, upload.single('file'), async (req, res) => {
    const file = req.file;
    try {
      const { project, rights } = await mtlProject(req);
      const kind = req.body.kind === 'DEPARTMENT' ? 'DEPARTMENT' : 'MASTER';
      const departmentId = kind === 'DEPARTMENT' ? intParam(req.body.departmentId, 'Bộ phận') : null;
      // PMO (người quản lý dự án) nhập mọi kế hoạch. Lãnh đạo bộ phận tự nhập MTL của bộ phận mình — không đặt lại kế hoạch gốc, không đổi tên kế hoạch.
      const asLeader = !rights.canManage;
      if (asLeader && !(kind === 'DEPARTMENT' && rights.canEdit && departmentId === req.user.departmentId && await isDeptLeader(req.user, departmentId)))
        fail(403, 'Chỉ PMO nhập MTL tổng; lãnh đạo bộ phận nhập MTL của bộ phận mình', 'FORBIDDEN');
      if (!file) fail(400, 'Chưa chọn tệp Excel', 'REQUIRED');
      if (!/\.xlsx$/i.test(file.originalname)) fail(415, 'Chỉ nhận tệp .xlsx', 'FILE_TYPE_NOT_ALLOWED');
      await verifyUpload('import.xlsx', file.path);
      const buf = await fs.readFile(file.path);
      const fileHash = crypto.createHash('sha256').update(buf).digest('hex');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const cell = c => { const v = c?.value; if (v == null) return null; if (v instanceof Date) return v; if (typeof v === 'object') { const r = v.result ?? v.text ?? (v.richText ? v.richText.map(t => t.text).join('') : null); return r instanceof Date || typeof r === 'number' ? r : r == null ? null : String(r); } return v; };
      const sheets = [];
      for (const ws of wb.worksheets) {
        const rows = [];
        ws.eachRow({ includeEmpty: true }, (row, n) => { const vals = []; for (let i = 1; i <= Math.max(row.cellCount, 10); i++) vals.push(cell(row.getCell(i))); rows[n - 1] = vals; });
        for (let i = 0; i < rows.length; i++) rows[i] = rows[i] || [];
        const parsed = M.parseMtlRows(rows);
        if (parsed && parsed.items.length) sheets.push({ name: ws.name, ...parsed });
      }
      if (!sheets.length) fail(422, 'Không tìm thấy bảng MTL: cần dòng tiêu đề có "Hạng mục công việc" và "Bắt đầu (T)" / "Kết thúc (T)"', 'IMPORT_INVALID');
      const sheet = sheets.find(s => s.name === req.body.sheet) || sheets[0];
      const departments = await prisma.department.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } });
      if (departmentId != null && !departments.some(d => d.id === departmentId)) fail(422, 'Bộ phận không hợp lệ', 'INVALID_DEPARTMENT');
      const people = kind === 'DEPARTMENT' ? await prisma.user.findMany({ where: { isActive: true, role: { not: 'admin' }, isRootAdmin: false, departmentId }, select: { id: true, fullName: true, username: true } }) : [];
      // MTL bộ phận không ghi tên: bộ phận đã có đúng một kế hoạch → cập nhật kế hoạch đó (tải mẫu → sửa → nhập lại).
      const deptPlans = kind === 'DEPARTMENT' ? await prisma.plan.findMany({ where: { projectId: project.id, kind: 'DEPARTMENT', departmentId }, select: { name: true } }) : [];
      const planName = (!asLeader && text(req.body.planName, 'Tên kế hoạch', { max: 160 }))
        || (kind === 'DEPARTMENT' ? (deptPlans.length === 1 ? deptPlans[0].name : `MTL ${departments.find(d => d.id === departmentId).name}`) : `MTL — ${sheet.name}`);
      const existingPlan = await prisma.plan.findFirst({ where: { projectId: project.id, name: planName } });
      if (existingPlan && (existingPlan.kind !== kind || (kind === 'DEPARTMENT' && existingPlan.departmentId !== departmentId)))
        fail(409, `Tên kế hoạch "${planName}" đang dùng cho kế hoạch khác — đặt tên khác`, 'PLAN_NAME_TAKEN');
      const existing = existingPlan ? await prisma.workItem.findMany({ where: { planId: existingPlan.id, archivedAt: null }, select: { id: true, planCode: true, baselineStart: true, baselineEnd: true } }) : [];
      const byCode = new Map(existing.filter(e => e.planCode).map(e => [e.planCode, e]));
      // MTL bộ phận: khớp "Thuộc bước" với hạng mục MTL tổng (kế hoạch MASTER mới nhất).
      const master = kind === 'DEPARTMENT' ? await prisma.workItem.findMany({ where: { projectId: project.id, archivedAt: null, plan: { kind: 'MASTER' } }, select: { id: true, planCode: true, title: true, progress: true, state: { select: { category: true } }, _count: { select: { children: { where: { archivedAt: null } } } } }, orderBy: { id: 'desc' } }) : [];
      const masterByCode = new Map(); for (const m of master) if (m.planCode && !masterByCode.has(m.planCode)) masterByCode.set(m.planCode, m);
      const rebaseline = req.body.rebaseline === '1' || req.body.rebaseline === 'true';
      if (rebaseline && asLeader) fail(403, 'Chỉ PMO được đặt lại kế hoạch gốc', 'FORBIDDEN');
      const unmatchedOwners = new Map(), unmatchedParents = new Set();
      const plan = sheet.items.map(it => {
        const dates = it.startT != null ? M.tToDates(project.t0Date, it.startT, it.endT) : { start: it.startDate, end: it.endDate ? new Date(it.endDate.getTime() + 86_400_000 - 1) : null };
        const owner = kind === 'DEPARTMENT' ? { leadDepartmentId: departmentId, supportDepartmentIds: [], externalParty: '' } : M.splitOwner(it.ownerText, departments);
        const assignees = kind === 'DEPARTMENT' ? matchPeople(it.ownerText.replace(/\//g, '\n'), people) : { ids: [], unmatched: [] };
        if (kind === 'MASTER' && !owner.leadDepartmentId) unmatchedOwners.set(it.ownerText || '(trống)', (unmatchedOwners.get(it.ownerText || '(trống)') || 0) + 1);
        const parent = it.parentStep ? masterByCode.get(it.parentStep) : null;
        if (it.parentStep && !parent) unmatchedParents.add(it.parentStep);
        const prev = it.step ? byCode.get(it.step) : null;
        const baselineChanged = !!prev && !!prev.baselineStart && (prev.baselineStart.getTime() !== dates.start?.getTime() || prev.baselineEnd?.getTime() !== dates.end?.getTime());
        return { ...it, ...owner, leadDepartmentId: owner.leadDepartmentId ?? project.departmentId, assigneeIds: assignees.ids, unmatchedPeople: assignees.unmatched,
          parentId: parent?.id ?? null, parentTitle: parent?.title ?? null, baselineStart: dates.start, baselineEnd: dates.end, existingId: prev?.id ?? null, baselineChanged,
          // Chi tiết hoá lần đầu một bước tổng đang làm dở: dòng con mới nhận % hiện tại của bước tổng, để tiến độ bước tổng (tính từ các dòng con) không bị tụt.
          inheritProgress: !prev && parent && !parent._count.children && parent.progress > 0 && parent.state?.category !== 'COMPLETED' ? Math.min(99, parent.progress) : 0 };
      });
      const summary = { sheet: sheet.name, sheets: sheets.map(s => ({ name: s.name, items: s.items.length })), planName, kind, items: plan.length,
        create: plan.filter(p => !p.existingId).length, update: plan.filter(p => p.existingId).length, baselineChanged: plan.filter(p => p.baselineChanged).length,
        critical: plan.filter(p => p.critical).length, milestones: plan.filter(p => p.milestone).length,
        unmatchedOwners: [...unmatchedOwners].map(([k, n]) => ({ text: k, count: n })), unmatchedParents: [...unmatchedParents], warnings: sheet.warnings.slice(0, 50), fileHash };
      const deptName = Object.fromEntries(departments.map(d => [d.id, d.name]));
      if (req.body.dryRun === '1' || req.body.dryRun === 'true') {
        return res.json({ ...summary, preview: plan.slice(0, 300).map(p => ({ step: p.step, title: p.title, ownerText: p.ownerText, lead: deptName[p.leadDepartmentId] || '', support: p.supportDepartmentIds.map(id => deptName[id]), externalParty: p.externalParty,
          startT: p.startT, endT: p.endT, baselineStart: p.baselineStart, baselineEnd: p.baselineEnd, critical: p.critical, milestone: p.milestone, parent: p.parentTitle ? `${p.parentStep} · ${p.parentTitle}` : p.parentStep || '',
          action: p.existingId ? (p.baselineChanged ? (rebaseline ? 'Cập nhật + đặt lại kế hoạch gốc' : 'Cập nhật (giữ kế hoạch gốc)') : 'Cập nhật') : p.inheritProgress ? `Tạo mới (nhận ${p.inheritProgress}% của bước ${p.parentStep})` : 'Tạo mới' })) });
      }
      const states = await prisma.workflowState.findMany({ where: { projectId: project.id }, orderBy: { position: 'asc' } });
      const todo = states.find(s => s.category === 'UNSTARTED') || states[0];
      const doing = states.find(s => s.category === 'STARTED') || todo;
      const result = await prisma.$transaction(async tx => {
        const planRow = existingPlan
          ? await tx.plan.update({ where: { id: existingPlan.id }, data: { fileName: file.originalname.slice(0, 200), fileHash, sheetName: sheet.name } })
          : await tx.plan.create({ data: { projectId: project.id, name: planName, year: new Date().getFullYear(), kind, departmentId, sheetName: sheet.name, fileName: file.originalname.slice(0, 200), fileHash, createdById: req.user.id } });
        let created = 0, updated = 0, rebased = 0, position = (await tx.workItem.aggregate({ where: { stateId: todo.id }, _max: { position: true } }))._max.position || 0;
        for (const p of plan) {
          const fields = { title: p.title, planCode: p.step || null, planSection: p.section, ownerText: p.ownerText, externalParty: p.externalParty, critical: p.critical, milestone: p.milestone,
            milestoneNote: p.milestoneNote, startT: p.startT, endT: p.endT, weight: p.weight, leadDepartmentId: p.leadDepartmentId, note: p.note || '', planId: planRow.id, taskType: 'PLAN',
            ...(p.parentId ? { parentId: p.parentId } : {}) };
          if (p.existingId) {
            const base = rebaseline || !p.baselineChanged ? { baselineStart: p.baselineStart, baselineEnd: p.baselineEnd } : {};
            if (rebaseline && p.baselineChanged) rebased++;
            await tx.workItem.update({ where: { id: p.existingId }, data: { ...fields, ...base } });
            await tx.workItemDepartment.deleteMany({ where: { workItemId: p.existingId } });
            if (p.supportDepartmentIds.length) await tx.workItemDepartment.createMany({ data: p.supportDepartmentIds.map(departmentId => ({ workItemId: p.existingId, departmentId })), skipDuplicates: true });
            updated++;
          } else {
            const { nextNumber } = await tx.project.update({ where: { id: project.id }, data: { nextNumber: { increment: 1 } }, select: { nextNumber: true } });
            position += 1024;
            const inherit = p.inheritProgress ? { progress: p.inheritProgress, progressAt: new Date(), startedAt: new Date() } : {};
            const item = await tx.workItem.create({ data: { ...fields, ...inherit, projectId: project.id, number: nextNumber - 1, stateId: (p.inheritProgress ? doing : todo).id, position, reporterId: req.user.id, assignedById: req.user.id, assignedAt: new Date(),
              baselineStart: p.baselineStart, baselineEnd: p.baselineEnd, startDate: p.baselineStart, dueDate: p.baselineEnd, originalDueDate: p.baselineEnd,
              supportDepartments: { create: p.supportDepartmentIds.map(departmentId => ({ departmentId })) }, assignees: { create: p.assigneeIds.map(userId => ({ userId })) } } });
            await activity(tx, item.id, req.user.id, 'CREATED', { source: 'MTL', plan: planName });
            created++;
          }
        }
        // Dự án dùng chung: cán bộ các bộ phận có hạng mục trở thành thành viên (cowork, cập nhật hạng mục của bộ phận mình).
        const deptIds = [...new Set(plan.flatMap(p => [p.leadDepartmentId, ...p.supportDepartmentIds]).filter(Boolean))];
        const staff = await tx.user.findMany({ where: { isActive: true, role: { not: 'admin' }, isRootAdmin: false, departmentId: { in: deptIds } }, select: { id: true } });
        await tx.projectMember.createMany({ data: staff.map(u => ({ projectId: project.id, userId: u.id, role: 'MEMBER' })), skipDuplicates: true });
        await audit(req, 'MTL_IMPORT', 'Plan', planRow.id, null, { projectId: project.id, kind, departmentId, sheet: sheet.name, fileHash, created, updated, rebased, byDepartmentLeader: asLeader }, tx);
        return { planId: planRow.id, created, updated, rebased, members: staff.length };
      });
      bus.project(project.id, req.user.id);
      res.json({ ...summary, ...result });
    } finally { if (file) await fs.rm(file.path, { force: true }).catch(() => {}); }
  });

  // ---------- Bảng theo dõi + Dashboard dự án ----------
  app.get('/api/projects/:id/mtl', auth, async (req, res) => {
    const { project } = await mtlProject(req);
    const now = new Date();
    const { items, cfg, actualOf } = await computeProject(project, req.user, now);
    const departments = await prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
    const deptName = Object.fromEntries(departments.map(d => [d.id, d.name]));
    const leaves = M.leavesOf(items);
    const totalT = Math.max(0, ...items.map(i => i.endT ?? 0), project.t0Date ? M.currentT(project.t0Date, items.reduce((m, i) => (i.baselineEnd && i.baselineEnd > m ? i.baselineEnd : m), now)) ?? 0 : 0);
    const summary = M.kpiOf(leaves, actualOf, now, cfg);
    const byDepartment = departments.map(d => ({ id: d.id, name: d.name, code: d.code, ...M.kpiOf(leaves.filter(i => i.leadDepartmentId === d.id), actualOf, now, cfg) })).filter(r => r.items);
    const milestones = items.filter(i => i.milestone).map(i => ({ id: i.id, code: i.code, step: i.planCode, title: i.title, baselineEnd: i.baselineEnd, forecastEnd: i.forecastEnd, completedAt: i.completedAt, status: i.status, statusLabel: i.statusLabel, critical: i.critical }));
    const nextMilestone = milestones.filter(m => !m.completedAt && m.baselineEnd).sort((a, b) => a.baselineEnd - b.baselineEnd)[0] || null;
    const curve = project.t0Date ? M.plannedCurve(leaves, project.t0Date, totalT) : [];
    const snaps = await prisma.progressSnapshot.findMany({ where: { projectId: project.id, departmentId: null }, orderBy: { day: 'asc' }, select: { day: true, plannedPct: true, actualPct: true, spi: true } });
    const alerts = await prisma.progressAlert.findMany({ where: { projectId: project.id, workItem: { archivedAt: null, AND: [itemVisibleWhere(req.user)] } }, orderBy: { createdAt: 'desc' }, take: 40,
      select: { id: true, kind: true, level: true, day: true, variance: true, lateDays: true, workItem: { select: { id: true, number: true, title: true, leadDepartmentId: true } } } });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      project: { id: project.id, key: project.key, name: project.name, t0Date: project.t0Date, currentT: M.currentT(project.t0Date, now), totalT, alertConfig: cfg },
      generatedAt: now, summary, byDepartment, milestones, nextMilestone, curve, actualCurve: snaps,
      items: items.map(i => ({ ...i, leadDepartmentName: deptName[i.leadDepartmentId] || '' })),
      alerts: alerts.map(a => ({ ...a, label: A.KIND_LABEL[a.kind], item: { id: a.workItem.id, code: `${project.key}-${a.workItem.number}`, title: a.workItem.title, department: deptName[a.workItem.leadDepartmentId] || '' }, workItem: undefined })),
      plans: await prisma.plan.findMany({ where: { projectId: project.id }, select: { id: true, name: true, kind: true, departmentId: true, sheetName: true, fileName: true, createdAt: true }, orderBy: { id: 'asc' } }),
    });
  });

  // ---------- Cài đặt MTL: T0, ngưỡng cảnh báo ----------
  app.put('/api/projects/:id/mtl-settings', auth, async (req, res) => {
    const { project } = await mtlProject(req, 'manage');
    const data = {};
    if (req.body.alertConfig !== undefined) {
      const c = req.body.alertConfig || {}, out = {};
      for (const [k, min, max] of [['behindPct', 1, 50], ['aheadPct', 1, 50], ['startSoonDays', 0, 60], ['dueSoonDays', 0, 60], ['staleDays', 1, 60]]) {
        if (c[k] === undefined || c[k] === null || c[k] === '') continue;
        const n = Number(c[k]); if (!Number.isFinite(n) || n < min || n > max) fail(422, `Ngưỡng ${k} phải từ ${min} đến ${max}`);
        out[k] = Math.round(n);
      }
      data.alertConfig = out;
    }
    let reason = null;
    if (req.body.t0Date !== undefined) {
      const t0 = optionalDate(req.body.t0Date, 'Ngày T0'); if (!t0) fail(422, 'Nhập ngày T0', 'T0_REQUIRED');
      if (!project.t0Date || M.currentT(project.t0Date, t0) !== 0) {
        reason = text(req.body.reason, 'Lý do', { max: 500 });
        if (project.t0Date && !reason) fail(422, 'Đổi T0 làm dời toàn bộ kế hoạch gốc — nhập lý do', 'REASON_REQUIRED');
        data.t0Date = t0;
      }
    }
    const result = await prisma.$transaction(async tx => {
      const p = await tx.project.update({ where: { id: project.id }, data });
      let moved = 0;
      if (data.t0Date) {
        const rows = await tx.workItem.findMany({ where: { projectId: project.id, startT: { not: null }, endT: { not: null } }, select: { id: true, startT: true, endT: true } });
        for (const r of rows) { const d = M.tToDates(data.t0Date, r.startT, r.endT); await tx.workItem.update({ where: { id: r.id }, data: { baselineStart: d.start, baselineEnd: d.end } }); moved++; }
      }
      await audit(req, data.t0Date ? 'MTL_T0_CHANGE' : 'UPDATE', 'Project', project.id, { t0Date: project.t0Date, alertConfig: project.alertConfig }, { ...data, reason, moved }, tx);
      return { project: p, moved };
    });
    res.json({ ok: true, moved: result.moved, alertConfig: M.alertConfigOf(result.project), t0Date: result.project.t0Date });
  });

  // ---------- Điều chỉnh kế hoạch gốc của một hạng mục (bắt buộc lý do, ghi nhật ký) ----------
  app.post('/api/items/:id/rebaseline', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project, rights } = await loadItem(prisma, req.user, id, 'edit');
    if (project.kind !== 'MTL') fail(422, 'Chỉ dùng cho hạng mục Master Timeline', 'NOT_MTL');
    if (!rights.canManage) fail(403, 'Chỉ người quản lý dự án điều chỉnh kế hoạch gốc', 'FORBIDDEN');
    const reason = text(req.body.reason, 'Lý do điều chỉnh', { required: true, max: 500 });
    const item = await prisma.workItem.findUnique({ where: { id }, select: { id: true, startT: true, endT: true, baselineStart: true, baselineEnd: true } });
    let data;
    if (req.body.startT !== undefined || req.body.endT !== undefined) {
      const s = Number(req.body.startT ?? item.startT), e = Number(req.body.endT ?? item.endT);
      if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < s) fail(422, 'Tháng T không hợp lệ');
      const d = M.tToDates(project.t0Date, s, e); data = { startT: s, endT: e, baselineStart: d.start, baselineEnd: d.end };
    } else {
      const s = optionalDate(req.body.baselineStart, 'Bắt đầu'), e = optionalDate(req.body.baselineEnd, 'Kết thúc');
      if (!s || !e || e < s) fail(422, 'Ngày kế hoạch không hợp lệ');
      data = { baselineStart: s, baselineEnd: e, startT: null, endT: null };
    }
    await prisma.$transaction(async tx => {
      await tx.workItem.update({ where: { id }, data });
      await activity(tx, id, req.user.id, 'REBASELINE', { from: [item.baselineStart, item.baselineEnd], to: [data.baselineStart, data.baselineEnd], reason });
      await audit(req, 'MTL_REBASELINE', 'WorkItem', id, { baselineStart: item.baselineStart, baselineEnd: item.baselineEnd, startT: item.startT, endT: item.endT }, { ...data, reason }, tx);
    });
    bus.item(project.id, id, req.user.id);
    res.json({ ok: true, ...data });
  });

  // ---------- KPI tiến độ theo người (chủ trì) ----------
  app.get('/api/projects/:id/mtl-kpi', auth, async (req, res) => {
    const { project, rights } = await mtlProject(req);
    // PMO (người quản lý dự án) xem KPI theo người trong dự án mình điều phối.
    const scope = kpiScope(req.user) || (rights.canManage ? 'SYSTEM' : null);
    if (!scope) fail(403, 'KPI theo người dành cho Ban lãnh đạo và trưởng bộ phận', 'FORBIDDEN');
    const now = new Date();
    const { items, cfg, actualOf } = await computeProject(project, req.user, now);
    const leaves = M.leavesOf(items);
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(leaves.flatMap(i => i.assignees.map(a => a.id)))] }, ...(scope === 'UNIT' ? { departmentId: req.user.departmentId } : {}) },
      select: { id: true, fullName: true, displayTitle: true, departmentId: true, department: { select: { name: true } } } });
    const rows = users.map(u => ({ id: u.id, fullName: u.fullName, title: u.displayTitle, departmentId: u.departmentId, department: u.department?.name || '', ...M.kpiOf(leaves.filter(i => i.assignees.some(a => a.id === u.id)), actualOf, now, cfg) }))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    await audit(req, 'VIEW_KPI', 'Project', project.id, null, { mtl: true, people: rows.length });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ scope, rows });
  });

  // ---------- Danh mục dự án MTL (trang chủ Dashboard) ----------
  app.get('/api/mtl/portfolio', auth, async (req, res) => {
    if (isItAdmin(req.user)) fail(403, 'Tài khoản quản trị hệ thống không có số liệu công việc', 'FORBIDDEN');
    const now = new Date();
    const projects = await prisma.project.findMany({ where: { ...visibleProjectsWhere(req.user), kind: 'MTL', archivedAt: null }, orderBy: { name: 'asc' } });
    const out = [];
    for (const p of projects) {
      const { items, cfg, actualOf } = await computeProject(p, req.user, now);
      const leaves = M.leavesOf(items);
      const mine = leaves.filter(i => i.assignees.some(a => a.id === req.user.id) || (req.user.departmentId != null && i.leadDepartmentId === req.user.departmentId));
      const next = items.filter(i => i.milestone && !i.completedAt && i.baselineEnd).sort((a, b) => a.baselineEnd - b.baselineEnd)[0];
      out.push({ id: p.id, key: p.key, name: p.name, t0Date: p.t0Date, currentT: M.currentT(p.t0Date, now), totalT: Math.max(0, ...items.map(i => i.endT ?? 0)),
        summary: M.kpiOf(leaves, actualOf, now, cfg), mine: M.kpiOf(mine, actualOf, now, cfg),
        attention: items.filter(i => ['OVERDUE', 'BEHIND', 'LATE_START'].includes(i.status) && (i.critical || i.milestone || mine.includes(i))).slice(0, 12)
          .map(i => ({ id: i.id, code: i.code, title: i.title, status: i.status, statusLabel: i.statusLabel, variance: i.variance, lateDays: i.lateDays, critical: i.critical, milestone: i.milestone, leadDepartmentId: i.leadDepartmentId })),
        nextMilestone: next ? { id: next.id, code: next.code, title: next.title, baselineEnd: next.baselineEnd, status: next.status, statusLabel: next.statusLabel } : null });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ generatedAt: now, projects: out });
  });

  // Chạy kiểm tra cảnh báo ngay cho một dự án (người quản lý dự án; job hằng ngày tự chạy 07:30).
  app.post('/api/projects/:id/mtl-alerts/run', auth, async (req, res) => {
    const { project } = await mtlProject(req, 'manage');
    const r = await A.runProjectAlerts(prisma, project, new Date());
    await audit(req, 'MTL_ALERTS_RUN', 'Project', project.id, null, r);
    res.json(r);
  });
};
module.exports.kpiScope = kpiScope;
