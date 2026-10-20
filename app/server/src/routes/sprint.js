// Kepper — Sprint theo tháng T của Master Timeline (mỗi tháng T là một sprint, tự sinh từ T0, không ai phải tạo tay):
// - màn hình Sprint của dự án: phải xong trong sprint / đang chạy (mục tiêu % cuối sprint) / chuẩn bị sprint sau, tổng kết theo ban;
// - "Cập nhật nhanh": việc của tôi (và việc chưa giao người của ban tôi, nếu tôi là lãnh đạo ban) trong sprint hiện tại;
// - mẫu Excel MTL bộ phận điền sẵn (tải → sửa → nhập lại bằng "Nhập MTL bộ phận").
const ExcelJS = require('exceljs');
const { fail, intParam } = require('../lib/http');
const { isItAdmin } = require('../lib/permissions');
const { loadProject, visibleProjectsWhere } = require('../services/access');
const approval = require('../services/approval');
const M = require('../services/mtl');
const MP = require('../services/mtl-project');

const ATTN = ['OVERDUE', 'BEHIND', 'LATE_START'];
// Thứ tự trong một làn: chưa xong trước; trễ / chậm trước; đường găng, mốc; rồi theo hạn kế hoạch.
const rank = i => [i.done ? 1 : 0, ATTN.includes(i.status) ? 0 : 1, i.critical || i.milestone ? 0 : 1, new Date(i.baselineEnd).getTime()];
const byRank = (a, b) => { const x = rank(a), y = rank(b); for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] - y[k]; return a.id - b.id; };
const vnDate = d => { if (!d) return null; const x = new Date(new Date(d).getTime() + 7 * 3_600_000); return `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${x.getUTCFullYear()}`; };

// Một hạng mục trên thẻ sprint: chỉ trường cần hiển thị.
function card(i, { sprint, project, deptName, byId }) {
  const parent = i.parentId ? byId.get(i.parentId) : null;
  const target = M.sprintTarget(i, sprint);
  const done = M.isDone(i);
  return {
    id: i.id, code: i.code, planCode: i.planCode, title: i.title, leadDepartmentId: i.leadDepartmentId, leadDepartmentName: deptName[i.leadDepartmentId] || '',
    assignees: i.assignees, critical: i.critical, milestone: i.milestone, baselineStart: i.baselineStart, baselineEnd: i.baselineEnd,
    actual: i.actual, planned: i.planned, status: i.status, statusLabel: i.statusLabel, variance: i.variance, lateDays: i.lateDays, daysLeft: i.daysLeft,
    progressAt: i.progressAt, completedAt: i.completedAt, done, targetFrom: target.from, targetTo: target.to,
    carriedFrom: !done && i.baselineEnd < sprint.start ? M.currentT(project.t0Date, i.baselineEnd) : null,
    parentCode: parent?.planCode || null, parentTitle: parent?.title || null,
  };
}

module.exports = function mountSprint(app, { prisma, auth, audit }) {
  const departmentsMap = async () => {
    const rows = await prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
    return { rows, name: Object.fromEntries(rows.map(d => [d.id, d.name])) };
  };
  const isDeptLeader = async (user, departmentId) => departmentId != null && (await approval.deptLeaderIds(prisma, departmentId)).includes(user.id);

  // ---------- Sprint của một dự án ----------
  // ?t= số tháng T của sprint (mặc định: sprint hiện tại).
  app.get('/api/projects/:id/mtl-sprint', auth, async (req, res) => {
    const { project, rights } = await loadProject(prisma, req.user, intParam(req.params.id));
    if (project.kind !== 'MTL') fail(422, 'Dự án này không theo Master Timeline', 'NOT_MTL');
    res.setHeader('Cache-Control', 'private, no-store');
    const base = { id: project.id, key: project.key, name: project.name, t0Date: project.t0Date };
    if (!project.t0Date) return res.json({ project: { ...base, currentT: null, totalT: 0 }, sprint: null, sprints: [], lanes: { due: [], running: [], next: [] }, milestones: [], byDepartment: [], canEdit: rights.canEdit, empty: true });
    const now = new Date();
    const { items, actualOf } = await MP.computeProject(prisma, project, req.user, now);
    const curT = M.currentT(project.t0Date, now);
    const lastT = Math.max(0, curT, ...items.map(i => (i.baselineEnd ? M.currentT(project.t0Date, i.baselineEnd) : 0)));
    const asked = req.query.t == null || req.query.t === '' ? null : Number(req.query.t);
    const t = Math.max(0, Math.min(lastT, Number.isInteger(asked) ? asked : Math.max(0, curT)));
    const sprint = M.sprintOf(project.t0Date, t), next = M.sprintOf(project.t0Date, t + 1);
    const state = M.sprintState(sprint, now);
    const dept = await departmentsMap();
    const byId = new Map(items.map(i => [i.id, i]));
    const leaves = M.leavesOf(items).filter(i => i.status !== 'CANCELLED');
    const ctx = { sprint, project, deptName: dept.name, byId };
    const lanes = { due: [], running: [], next: [] };
    for (const i of leaves) {
      const lane = M.sprintLane(i, sprint, next, { current: state === 'CURRENT' });
      if (lane) lanes[{ DUE: 'due', RUNNING: 'running', NEXT: 'next' }[lane]].push(card(i, ctx));
    }
    for (const k of Object.keys(lanes)) lanes[k].sort(byRank);
    // Dải sprint: mỗi sprint bao nhiêu hạng mục phải xong, bao nhiêu xong đúng hạn (trong sprint đó), có mốc không.
    const strip = Array.from({ length: lastT + 1 }, (_, k) => ({ t: k, due: 0, doneInTime: 0, open: 0, milestone: false }));
    for (const i of leaves) {
      if (!i.baselineEnd) continue;
      const k = M.currentT(project.t0Date, i.baselineEnd); if (k < 0 || k > lastT) continue;
      const end = M.sprintOf(project.t0Date, k).end;
      strip[k].due++;
      if (M.isDone(i) && i.completedAt && i.completedAt <= end) strip[k].doneInTime++; else if (!M.isDone(i)) strip[k].open++;
    }
    for (const i of items) if (i.milestone && i.baselineEnd) { const k = M.currentT(project.t0Date, i.baselineEnd); if (strip[k]) strip[k].milestone = true; }
    // Tổng kết theo ban. Sprint đã qua: "xong" = xong trước khi sprint kết thúc; SPI = ảnh chụp tiến độ ngày cuối sprint (nếu có).
    // Ảnh chụp lưu theo ngày lịch Việt Nam (cột kiểu Date = 00:00 UTC của ngày đó) → ngày đầu sprint = sprint.start + 7 giờ.
    const snaps = state === 'PAST' ? await prisma.progressSnapshot.findMany({ where: { projectId: project.id, day: { gte: new Date(sprint.start.getTime() + 7 * 3_600_000), lte: sprint.end } }, orderBy: { day: 'asc' } }) : [];
    const snapSpi = new Map(); for (const s of snaps) snapSpi.set(s.departmentId ?? 0, s.spi);
    const dueOf = d => lanes.due.filter(i => i.leadDepartmentId === d && i.carriedFrom == null);
    const finished = i => i.done && (state !== 'PAST' || (i.completedAt && new Date(i.completedAt) <= sprint.end));
    const live = d => leaves.filter(i => i.leadDepartmentId === d && [...lanes.due, ...lanes.running].some(x => x.id === i.id));
    const byDepartment = dept.rows.map(d => {
      const due = dueOf(d.id), running = lanes.running.filter(i => i.leadDepartmentId === d.id), carried = lanes.due.filter(i => i.leadDepartmentId === d.id && i.carriedFrom != null);
      const done = due.filter(finished).length;
      const spi = state === 'CURRENT' ? M.spiOf(live(d.id), actualOf, now).spi : state === 'PAST' ? snapSpi.get(d.id) ?? null : null;
      return { id: d.id, name: d.name, code: d.code, due: due.length, done, open: due.length - done, carried: carried.length, running: running.length,
        behind: state === 'CURRENT' ? running.filter(i => ATTN.includes(i.status)).length : null, spi };
    }).filter(r => r.due || r.running || r.carried);
    const totalDue = lanes.due.filter(i => i.carriedFrom == null);
    res.json({
      project: { ...base, currentT: curT, totalT: lastT },
      sprint: { t, start: sprint.start, end: sprint.end, days: sprint.days, state, daysLeft: state === 'CURRENT' ? M.vnDay(sprint.end) - M.vnDay(now) : null,
        due: totalDue.length, done: totalDue.filter(finished).length, carried: lanes.due.length - totalDue.length, running: lanes.running.length,
        spi: state === 'CURRENT' ? M.spiOf(leaves.filter(i => [...lanes.due, ...lanes.running].some(x => x.id === i.id)), actualOf, now).spi : state === 'PAST' ? snapSpi.get(0) ?? null : null },
      sprints: strip, lanes,
      milestones: items.filter(i => i.milestone && i.baselineEnd && i.baselineEnd >= sprint.start && i.baselineEnd <= sprint.end).map(i => card(i, ctx)),
      byDepartment, canEdit: rights.canEdit, generatedAt: now,
    });
  });

  // ---------- Cập nhật nhanh: việc của tôi trong sprint hiện tại (mọi dự án MTL) ----------
  // Gồm: hạng mục lá tôi là người phụ trách; lãnh đạo ban thêm hạng mục của ban chưa giao người. Bỏ việc đã xong trước sprint.
  app.get('/api/my/sprint', auth, async (req, res) => {
    if (isItAdmin(req.user)) fail(403, 'Tài khoản quản trị hệ thống không có số liệu công việc', 'FORBIDDEN');
    const now = new Date();
    const leader = await isDeptLeader(req.user, req.user.departmentId);
    const projects = await prisma.project.findMany({ where: { ...visibleProjectsWhere(req.user), kind: 'MTL', archivedAt: null, t0Date: { not: null } }, orderBy: { name: 'asc' } });
    const dept = await departmentsMap();
    const out = [];
    for (const p of projects) {
      const { rights } = await loadProject(prisma, req.user, p.id);
      const { items } = await MP.computeProject(prisma, p, req.user, now);
      const t = Math.max(0, M.currentT(p.t0Date, now));
      const sprint = M.sprintOf(p.t0Date, t), next = M.sprintOf(p.t0Date, t + 1);
      const byId = new Map(items.map(i => [i.id, i]));
      const ctx = { sprint, project: p, deptName: dept.name, byId };
      const rows = [];
      for (const i of M.leavesOf(items)) {
        if (i.status === 'CANCELLED') continue;
        const mineAs = i.assignees.some(a => a.id === req.user.id) ? 'ASSIGNEE' : leader && i.leadDepartmentId === req.user.departmentId && !i.assignees.length ? 'DEPARTMENT' : null;
        if (!mineAs) continue;
        const lane = M.sprintLane(i, sprint, next, { current: true });
        if (lane !== 'DUE' && lane !== 'RUNNING') continue;
        if (M.isDone(i) && !(i.completedAt && i.completedAt >= sprint.start)) continue;
        rows.push({ ...card(i, ctx), lane, mineAs });
      }
      if (rows.length) out.push({ project: { id: p.id, key: p.key, name: p.name }, canEdit: rights.canEdit,
        sprint: { t, start: sprint.start, end: sprint.end, daysLeft: M.vnDay(sprint.end) - M.vnDay(now) }, items: rows.sort(byRank) });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ generatedAt: now, leader, projects: out });
  });

  // ---------- Mẫu Excel MTL bộ phận (điền sẵn) ----------
  // PMO tải cho mọi bộ phận; lãnh đạo bộ phận tải cho bộ phận mình. Bộ phận đã có MTL → xuất đúng các hạng mục đó (sửa rồi nhập lại theo "Bước");
  // chưa có → mỗi hạng mục MTL tổng của bộ phận (chủ trì hoặc phối hợp) thành một dòng con gợi ý để chi tiết hoá.
  app.get('/api/projects/:id/mtl-template.xlsx', auth, async (req, res) => {
    const { project, rights } = await loadProject(prisma, req.user, intParam(req.params.id));
    if (project.kind !== 'MTL') fail(422, 'Dự án này không theo Master Timeline', 'NOT_MTL');
    const departmentId = intParam(req.query.departmentId, 'Bộ phận');
    if (!rights.canManage && !(departmentId === req.user.departmentId && await isDeptLeader(req.user, departmentId)))
      fail(403, 'Chỉ PMO hoặc lãnh đạo của bộ phận này tải được MTL bộ phận', 'FORBIDDEN');
    const department = await prisma.department.findFirst({ where: { id: departmentId, isActive: true }, select: { id: true, name: true, code: true } });
    if (!department) fail(422, 'Bộ phận không hợp lệ', 'INVALID_DEPARTMENT');
    const { items } = await MP.computeProject(prisma, project, req.user, new Date());
    const byId = new Map(items.map(i => [i.id, i]));
    const plans = await prisma.plan.findMany({ where: { projectId: project.id }, select: { id: true, kind: true, departmentId: true, name: true } });
    const deptPlanIds = new Set(plans.filter(p => p.kind === 'DEPARTMENT' && p.departmentId === departmentId).map(p => p.id));
    const masterPlanIds = new Set(plans.filter(p => p.kind === 'MASTER').map(p => p.id));
    const staff = await prisma.user.findMany({ where: { isActive: true, role: { not: 'admin' }, isRootAdmin: false, departmentId }, select: { fullName: true }, orderBy: { fullName: 'asc' } });
    const own = items.filter(i => deptPlanIds.has(i.planId));
    const masterOf = i => masterPlanIds.has(i.planId) && (i.leadDepartmentId === departmentId || i.supportDepartmentIds.includes(departmentId));
    const masters = items.filter(masterOf);
    // Gợi ý: hạng mục MTL tổng bộ phận CHỦ TRÌ, chưa xong, chưa có dòng con nào → một dòng con "<bước>.1" để sửa / tách / xoá.
    // Không gợi ý phần phối hợp: dòng con của bộ phận phối hợp làm tiến độ bước tổng tính theo dòng con đó (cần thống nhất với bên chủ trì trước).
    const usedSteps = new Set(own.map(i => i.planCode).filter(Boolean));
    const suggest = masters.filter(m => m.planCode && m.leadDepartmentId === departmentId && !m.children && !M.isDone(m) && m.status !== 'CANCELLED' && !usedSteps.has(`${m.planCode}.1`));
    const timeCells = i => (i.startT != null ? [i.startT, i.endT] : [vnDate(i.baselineStart), vnDate(i.baselineEnd)]);
    const rows = [
      ...own.map(i => ({ planCode: i.planCode, id: i.id, suggested: false, cells: [i.planCode || '', i.title, i.assignees.map(a => a.fullName).join(' / ') || i.ownerText || '', ...timeCells(i), i.critical ? 'x' : '', i.milestone ? '◆' : '', byId.get(i.parentId)?.planCode || '', ''] })),
      ...suggest.map(m => ({ planCode: `${m.planCode}.1`, id: 1e9 + m.id, suggested: true, cells: [`${m.planCode}.1`, m.title, '', ...timeCells(m), m.critical ? 'x' : '', '', m.planCode,
        `Gợi ý từ bước ${m.planCode} MTL tổng — sửa tên / ngày, tách thành nhiều dòng hoặc xoá dòng nếu không cần`] })),
    ].sort(MP.byStep);

    const wb = new ExcelJS.Workbook();
    wb.creator = `Kepper Hub - ${req.user.username}`; wb.created = new Date();
    const head = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E8C' } }, alignment: { vertical: 'middle', wrapText: true } };
    const ws = wb.addWorksheet('MTL bộ phận', { views: [{ state: 'frozen', ySplit: 2 }] });
    ws.columns = [{ width: 9 }, { width: 58 }, { width: 26 }, { width: 13 }, { width: 13 }, { width: 11 }, { width: 8 }, { width: 11 }, { width: 40 }];
    ws.addRow([`MTL BỘ PHẬN — ${department.name} — ${project.name}. Tài liệu BẢO MẬT, chỉ dùng nội bộ. Sửa / thêm dòng rồi nhập lại: Khác → Nhập MTL bộ phận.`]);
    ws.mergeCells('A1:I1'); ws.getRow(1).font = { bold: true, color: { argb: 'FF7A1F1F' } };
    const header = ws.addRow(['Bước', 'Hạng mục công việc', 'Người phụ trách', 'Bắt đầu', 'Kết thúc', 'Đường găng', 'Mốc', 'Thuộc bước', 'Ghi chú']);
    header.eachCell(c => Object.assign(c, head)); header.height = 30;
    for (const r of rows) { const row = ws.addRow(r.cells); if (r.suggested) for (let c = 1; c <= 9; c++) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7D6' } }; }
    const last = Math.max(ws.rowCount, 2) + 200; // để trống thêm dòng có sẵn danh sách chọn
    const list = wb.addWorksheet('Danh sách', { state: 'hidden' });
    staff.forEach((u, k) => { list.getCell(k + 1, 1).value = u.fullName; });
    for (let r = 3; r <= last; r++) {
      if (staff.length) ws.getCell(r, 3).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`'Danh sách'!$A$1:$A$${staff.length}`] };
      ws.getCell(r, 6).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: ['"x"'] };
      ws.getCell(r, 7).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: ['"◆"'] };
    }
    const ref = wb.addWorksheet('MTL tổng (tham khảo)', { views: [{ state: 'frozen', ySplit: 1 }] });
    ref.columns = [{ width: 9 }, { width: 62 }, { width: 22 }, { width: 13 }, { width: 13 }, { width: 10 }, { width: 8 }, { width: 14 }];
    const rh = ref.addRow(['Bước', 'Hạng mục MTL tổng', 'Đầu mối', 'Từ tháng T', 'Đến tháng T', 'Găng', 'Mốc', 'Vai trò']);
    rh.eachCell(c => Object.assign(c, head));
    for (const i of masters) ref.addRow([i.planCode || '', i.title, i.ownerText || '', i.startT ?? vnDate(i.baselineStart), i.endT ?? vnDate(i.baselineEnd), i.critical ? 'x' : '', i.milestone ? '◆' : '', i.leadDepartmentId === departmentId ? 'Chủ trì' : 'Phối hợp']);
    const help = wb.addWorksheet('Hướng dẫn');
    help.getColumn(1).width = 110;
    [
      'CÁCH DÙNG MẪU MTL BỘ PHẬN',
      '1. Mỗi dòng ở sheet "MTL bộ phận" là một hạng mục của bộ phận. Có thể sửa tên, thêm dòng, tách một hạng mục thành nhiều dòng (vd. 8.1, 8.2, 8.3).',
      '2. Cột "Bước": mã riêng của từng dòng, không trùng. Nhập lại tệp sẽ CẬP NHẬT dòng có cùng Bước và giữ tiến độ đã cập nhật.',
      '3. Cột "Thuộc bước": bước của MTL tổng mà dòng này chi tiết hoá (xem sheet "MTL tổng (tham khảo)"). Tiến độ bước tổng tự tính từ các dòng con; lần đầu chi tiết hoá một bước đang làm dở, các dòng con nhận % hiện tại của bước đó.',
      '   Phần việc PHỐI HỢP: chỉ thêm dòng con khi đã thống nhất với bộ phận chủ trì, vì tiến độ bước tổng sẽ tính từ mọi dòng con.',
      '4. Bắt đầu / Kết thúc: ghi tháng T (vd. 5 hoặc T5) hoặc ngày cụ thể dd/mm/yyyy. Trên cùng một dòng, hai cột phải cùng kiểu.',
      '5. Người phụ trách: chọn trong danh sách (tên tài khoản trong bộ phận). Nhiều người: cách nhau dấu "/".',
      '6. Đường găng: x. Mốc: ◆.',
      '7. Xoá dòng trong tệp KHÔNG xoá hạng mục đã có — muốn bỏ thì chuyển hạng mục sang "Huỷ" trong ứng dụng.',
      '8. Kế hoạch gốc (căn cứ tính chậm / trễ và KPI) lấy theo lần nhập đầu. Muốn đổi kế hoạch gốc: báo PMO.',
      'Tài liệu này chứa kế hoạch dự án — mức BẢO MẬT. Không gửi ra ngoài công ty.',
    ].forEach((line, k) => { const c = help.getCell(k + 1, 1); c.value = line; c.alignment = { wrapText: true }; if (k === 0 || /^Tài liệu/.test(line)) c.font = { bold: true }; });
    await audit(req, 'MTL_TEMPLATE_EXPORT', 'Project', project.id, null, { departmentId, rows: rows.length, existing: own.length, suggested: suggest.length });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="MTL-bo-phan-${String(department.code || department.id).replace(/[^A-Za-z0-9_-]/g, '')}-${project.key}.xlsx"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  });
};
