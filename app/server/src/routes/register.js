// Sổ theo dõi, kiểm soát giao việc: danh mục, mẫu nhóm việc, tổng hợp theo cán bộ chủ trì / phòng chủ trì,
// nhập Kế hoạch công tác năm (.docx), nhập / xuất sổ Excel đúng mẫu.
const path = require('node:path');
const MG = require('../services/mtl-guard');
const fs = require('node:fs/promises');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { fail, intParam, optionalInt, optionalDate, text, oneOf } = require('../lib/http');
const { permissionScope, isItAdmin } = require('../lib/permissions');
const { loadProject, loadItem, itemVisibleWhere, visibleProjectsWhere } = require('../services/access');
const { verifyUpload } = require('../lib/files');
const { activity, notify } = require('../services/events');
const { deptLeaderIds } = require('../services/approval');
const { stageOf } = require('../services/stage');
const bus = require('../services/bus');
const W = require('../services/workitems');
const R = require('../services/register');
const { parsePlanDocx, norm } = require('../services/plan-parser');
const { departmentMatcher, splitUnits } = require('../services/dept-match');

const PRIORITY_LABEL = { URGENT: 'Khẩn', HIGH: 'Cao', MEDIUM: 'Bình thường', LOW: 'Thấp', NONE: '' };
const PRIORITY_BY_LABEL = { 'khan': 'URGENT', 'khan cap': 'URGENT', 'cao': 'HIGH', 'binh thuong': 'MEDIUM', 'trung binh': 'MEDIUM', 'thap': 'LOW' };
const H7 = 7 * 3_600_000;
const fmt = d => (d ? new Date(new Date(d).getTime() + H7).toISOString().slice(0, 10).split('-').reverse().join('/') : '');
// Giờ Việt Nam cho dòng "Xuất bởi … lúc …" (không dùng ISO UTC).
const fmtTime = d => { const v = new Date(new Date(d).getTime() + H7).toISOString(); return `${v.slice(11, 16)} ngày ${fmt(d)}`; };
// Ô ngày Excel thật (lọc / sắp xếp được): ngày lịch theo giờ Việt Nam, ghi dạng UTC 00:00 để Excel hiện đúng ngày.
const excelDay = d => { if (!d) return null; const v = new Date(new Date(d).getTime() + H7); return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())); };
const DATE_FMT = 'dd/mm/yyyy';
const REGISTER_COLUMNS = [
  ['STT', 6], ['Mã CV', 10], ['Nội dung công việc', 60], ['Nguồn giao việc', 16], ['Người giao', 18], ['Người chủ trì', 20], ['Người phối hợp', 24],
  ['Ngày giao', 12], ['Hạn hoàn thành', 12], ['Mức độ ưu tiên', 12], ['Tiến độ (%)', 10], ['Ngày hoàn thành thực tế', 14], ['Trạng thái', 18],
  ['Số ngày còn lại (âm = trễ)', 12], ['Sản phẩm đầu ra', 40], ['Sản phẩm đã có theo tiến độ', 50], ['Kết quả / Khó khăn, kiến nghị', 40], ['Đánh giá của người giao', 28], ['Ghi chú', 30],
  ['Loại nhiệm vụ', 14], ['Đơn vị chủ trì', 22], ['Xếp loại', 16], ['Văn bản căn cứ', 36], ['Khâu', 20],
];
const DATE_COLUMNS = [8, 9, 12]; // Ngày giao, Hạn hoàn thành, Ngày hoàn thành thực tế
const TASK_TYPE_LABEL = { PLAN: 'Kế hoạch năm', ADHOC: 'Đột xuất' };
const RATING_LABEL = { EXCELLENT: 'Hoàn thành xuất sắc', GOOD: 'Hoàn thành tốt', PASS: 'Hoàn thành', FAIL: 'Không hoàn thành' };
const STATUS_FILL = { OVERDUE: 'FFFDE2E2', DUE_SOON: 'FFFFEDD5', DONE_ON_TIME: 'FFDCFCE7', DONE_LATE: 'FFFEF3C7' };
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A4D8C' } };
const SUB_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } };

// Xuất Excel của một dự án / sổ: quyền "Xuất Excel" (toàn đơn vị, hoặc phòng mình với dự án của phòng), thành viên sổ
// (Chủ / Thành viên — không gồm Người xem) hoặc người quản lý dự án.
function canExport(user, project, member = null, rights = null) {
  const scope = permissionScope(user, 'reports.export', 'OPERATE');
  if (scope === 'SYSTEM' || (scope === 'UNIT' && Number(user.departmentId) === Number(project.departmentId))) return true;
  if (member && ['OWNER', 'MEMBER'].includes(member.role) && !isItAdmin(user)) return true;
  return !!rights?.canManage;
}
function canEditCatalog(user) {
  // Danh mục dùng chung: quản trị hệ thống hoặc Ban giám đốc (quản lý dự án toàn đơn vị).
  return isItAdmin(user) || permissionScope(user, 'projects.manage', 'OPERATE') === 'SYSTEM';
}
// Mẫu nhóm việc: ai quản lý dự án (kể cả trưởng / phó phòng — phạm vi phòng ban) được tạo mẫu; sửa / xoá mẫu của mình.
// Quản trị và Ban giám đốc (quản lý dự án toàn đơn vị) sửa được mọi mẫu.
const canCreateTemplate = user => canEditCatalog(user) || !!permissionScope(user, 'projects.manage', 'OPERATE');
const canEditTemplate = (user, tpl) => canEditCatalog(user) || (tpl.createdById != null && tpl.createdById === user.id && canCreateTemplate(user));
function cellText(cell) {
  const v = cell?.value;
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') return String(v.text ?? v.result ?? (v.richText ? v.richText.map(r => r.text).join('') : '')).trim();
  return typeof v === 'number' ? v : String(v).trim();
}
// Ngày trong sổ: ô ngày Excel, "dd/mm/yyyy", hoặc "yyyy-mm-dd".
function parseDay(v, label, row) {
  if (v === '' || v == null) return null;
  if (v instanceof Date) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()) - H7);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) - H7);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - H7);
  fail(422, `Dòng ${row}: ${label} "${s}" không hợp lệ (dùng dd/mm/yyyy)`, 'IMPORT_INVALID');
}
// Ngày nhập từ API: "yyyy-mm-dd" (ngày lịch giờ Việt Nam) hoặc thời điểm ISO.
function dayInput(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - H7);
  return optionalDate(value, label);
}
function sendXlsx(res, wb, fileName) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return wb.xlsx.writeBuffer().then(b => res.send(Buffer.from(b)));
}
// Dấu người xuất: dòng cuối trang tính + chân trang khi in.
function watermark(ws, user, now) {
  const line = `Xuất bởi ${user.fullName} (${user.username}) lúc ${fmtTime(now)} (giờ Việt Nam) — tài liệu nội bộ, không chuyển ra ngoài đơn vị.`;
  ws.addRow([]);
  ws.addRow([line]).font = { italic: true, color: { argb: 'FF6B7280' } };
  ws.headerFooter.oddFooter = `&L&8${line.replace(/&/g, '&&')}&R&8Trang &P/&N`;
}
// Khớp tên cán bộ (không phân biệt hoa thường, dấu) với tài khoản; trả về { ids, unmatched }.
function matcher(users) {
  const byName = new Map();
  for (const u of users) { byName.set(norm(u.fullName), u.id); byName.set(norm(u.username), u.id); if (u.displayTitle) byName.set(norm(u.displayTitle), byName.get(norm(u.displayTitle)) ?? u.id); }
  return value => {
    const parts = String(value || '').split(/[,;\n]+/).map(s => s.replace(/^\s*(đ\/c|đồng chí)\s+/i, '').trim()).filter(Boolean);
    const ids = [], unmatched = [];
    for (const p of parts) { const id = byName.get(norm(p)); if (id) { if (!ids.includes(id)) ids.push(id); } else unmatched.push(p); }
    return { ids, unmatched };
  };
}
async function directory(prisma) {
  return prisma.user.findMany({ where: { isActive: true, isRootAdmin: false, role: { not: 'admin' } }, select: { id: true, username: true, fullName: true, displayTitle: true } });
}
async function activeDepartments(prisma) {
  return prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true } });
}
// Nhập hàng loạt vào sổ giao việc của đơn vị không gửi thông báo từng việc; báo gộp cho lãnh đạo mỗi phòng được giao.
async function notifyDispatchBatch(prisma, project, counts, actorId, what) {
  for (const [departmentId, c] of counts) {
    const ids = await deptLeaderIds(prisma, departmentId);
    await notify(prisma, ids, { type: 'DISPATCH', title: `Phòng được giao chủ trì ${c.total} việc ${what}${c.pending ? ` — ${c.pending} việc chờ tiếp nhận, phân công` : ''}`, body: project.name, link: '#/dept' }, actorId);
  }
}
const bumpDispatch = (counts, departmentId, pending) => {
  if (departmentId == null) return;
  const c = counts.get(departmentId) || { total: 0, pending: 0 };
  c.total++; if (pending) c.pending++;
  counts.set(departmentId, c);
};

module.exports = function mountRegister(app, { prisma, auth, audit, config }) {
  const upload = multer({ dest: path.join(config.uploadTmpDir, 'workhub-import'), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  const withProject = need => async (req, res, next) => { req.projectCtx = await loadProject(prisma, req.user, intParam(req.params.id), need); next(); };

  // ---------- Danh mục ----------
  app.get('/api/settings', auth, async (req, res) => res.json({ ...(await R.getSettings(prisma)), canEdit: canEditCatalog(req.user), canCreateTemplate: canCreateTemplate(req.user), modules: config?.modules || [] }));
  app.put('/api/settings', auth, async (req, res) => {
    if (!canEditCatalog(req.user)) fail(403, 'Chỉ Ban giám đốc hoặc quản trị được sửa danh mục', 'FORBIDDEN');
    const old = await R.getSettings(prisma);
    const next = {};
    if (req.body.dueSoonDays !== undefined) {
      const n = Number(req.body.dueSoonDays);
      if (!Number.isInteger(n) || n < 0 || n > 30) fail(422, 'Số ngày cảnh báo phải từ 0 đến 30');
      next.dueSoonDays = n;
    }
    if (req.body.sources !== undefined) {
      if (!Array.isArray(req.body.sources) || req.body.sources.length > 30) fail(422, 'Danh sách nguồn giao việc không hợp lệ');
      next.sources = [...new Set(req.body.sources.map(s => text(s, 'Nguồn giao việc', { max: 120 })).filter(Boolean))];
    }
    if (req.body.kpiWeights !== undefined) {
      const w = req.body.kpiWeights || {};
      const vals = ['onTime', 'rating', 'volume'].map(k => Number(w[k]));
      if (vals.some(v => !Number.isInteger(v) || v < 0 || v > 100) || vals.reduce((a, b) => a + b, 0) !== 100) fail(422, 'Trọng số KPI phải là số nguyên 0–100, tổng bằng 100');
      next.kpiWeights = { onTime: vals[0], rating: vals[1], volume: vals[2] };
    }
    for (const [key, value] of Object.entries(next)) await prisma.appSetting.upsert({ where: { key }, update: { value, updatedById: req.user.id }, create: { key, value, updatedById: req.user.id } });
    await audit(req, 'UPDATE_SETTINGS', 'AppSetting', null, old, next);
    res.json({ ...(await R.getSettings(prisma)), canEdit: true, canCreateTemplate: canCreateTemplate(req.user) });
  });

  // ---------- Mẫu nhóm việc ----------
  // items: [{ title, deliverable, offsetDays? }] — offsetDays: số ngày so với ngày mốc khi áp mẫu (âm = trước ngày mốc).
  const templateInput = body => {
    const name = text(body.name, 'Tên mẫu', { required: true, max: 120 });
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 30) fail(422, 'Mẫu cần 1–30 việc nhánh');
    return { name, items: body.items.map(i => {
      const out = { title: text(i?.title, 'Tên việc nhánh', { required: true, max: 300 }), deliverable: text(i?.deliverable, 'Sản phẩm đầu ra', { max: 500 }) || '' };
      if (i?.offsetDays !== undefined && i?.offsetDays !== null && i?.offsetDays !== '') {
        const n = Number(i.offsetDays);
        if (!Number.isInteger(n) || Math.abs(n) > 3650) fail(422, `"${out.title}": số ngày so với ngày mốc phải là số nguyên từ -3650 đến 3650`);
        out.offsetDays = n;
      }
      return out;
    }) };
  };
  const templateView = (user, names) => t => ({ ...t, canEdit: canEditTemplate(user, t), createdByName: t.createdById ? names[t.createdById] || null : null });
  app.get('/api/templates', auth, async (req, res) => {
    const rows = await prisma.taskTemplate.findMany({ orderBy: { name: 'asc' } });
    const names = Object.fromEntries((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map(t => t.createdById).filter(Boolean))] } }, select: { id: true, fullName: true } })).map(u => [u.id, u.fullName]));
    res.json(rows.map(templateView(req.user, names)));
  });
  app.post('/api/templates', auth, async (req, res) => {
    if (!canCreateTemplate(req.user)) fail(403, 'Chỉ Ban giám đốc, lãnh đạo phòng (quản lý dự án) hoặc quản trị được tạo mẫu', 'FORBIDDEN');
    const data = templateInput(req.body || {});
    if (await prisma.taskTemplate.findUnique({ where: { name: data.name } })) fail(409, 'Đã có mẫu cùng tên', 'EXISTS');
    const row = await prisma.taskTemplate.create({ data: { ...data, createdById: req.user.id } });
    await audit(req, 'CREATE', 'TaskTemplate', row.id, null, row);
    res.status(201).json(templateView(req.user, { [req.user.id]: req.user.fullName })(row));
  });
  const ownTemplate = async (req, id) => {
    const tpl = await prisma.taskTemplate.findUnique({ where: { id } }) || fail(404, 'Không tìm thấy mẫu', 'NOT_FOUND');
    if (!canEditTemplate(req.user, tpl)) fail(403, 'Chỉ người tạo mẫu, Ban giám đốc hoặc quản trị được sửa / xoá mẫu này', 'FORBIDDEN');
    return tpl;
  };
  app.put('/api/templates/:id', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const old = await ownTemplate(req, id);
    const data = templateInput(req.body || {});
    if (data.name !== old.name && await prisma.taskTemplate.findUnique({ where: { name: data.name } })) fail(409, 'Đã có mẫu cùng tên', 'EXISTS');
    const row = await prisma.taskTemplate.update({ where: { id }, data }); // giữ nguyên người tạo (createdById)
    await audit(req, 'UPDATE', 'TaskTemplate', id, old, row);
    res.json(templateView(req.user, {})(row));
  });
  app.delete('/api/templates/:id', auth, async (req, res) => {
    const id = intParam(req.params.id);
    await ownTemplate(req, id);
    await prisma.taskTemplate.delete({ where: { id } });
    await audit(req, 'DELETE', 'TaskTemplate', id);
    res.json({ ok: true });
  });

  // Tạo việc nhánh từ mẫu cho một nhóm việc.
  // body: { templateId, prefix?, anchorDate?, rows?: [{ index, title?, assigneeIds?, dueDate?, skip? }] }; ?dryRun=1 → chỉ tính, không tạo.
  // Việc nhánh: người giao = người áp mẫu; chủ trì = rows[i].assigneeIds ?? chủ trì việc cha;
  // hạn = rows[i].dueDate ?? (anchorDate + offsetDays) ?? hạn việc cha, không muộn hơn hạn việc cha (cắt về hạn cha, báo trong `warnings`).
  app.post('/api/items/:id/apply-template', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project, rights } = await loadItem(prisma, req.user, id, 'edit');
    const body = req.body || {};
    const tpl = await prisma.taskTemplate.findUnique({ where: { id: intParam(body.templateId, 'Mẫu') } }) || fail(404, 'Không tìm thấy mẫu', 'NOT_FOUND');
    const parent = await prisma.workItem.findUnique({ where: { id }, include: { assignees: true } });
    if (parent.parentId) fail(422, 'Chỉ áp mẫu cho nhóm việc (việc không phải việc nhánh)', 'NOT_GROUP');
    // Giống "chia nhiều việc nhánh": người quản lý, người giao, lãnh đạo phòng chủ trì, người chủ trì.
    const allowed = rights.canManage || parent.assignedById === req.user.id || parent.assignees.some(a => a.userId === req.user.id)
      || (await deptLeaderIds(prisma, parent.leadDepartmentId ?? project.departmentId)).includes(req.user.id);
    if (!allowed) fail(403, 'Chỉ người quản lý dự án, người giao việc hoặc lãnh đạo phòng chủ trì được áp mẫu', 'FORBIDDEN');
    MG.mtlBulkGuard(req.user, project, rights); // MTL: áp mẫu (tạo hàng loạt) chỉ người quản lý dự án
    const prefix = text(body.prefix, 'Ký hiệu', { max: 12 }) || null;
    const anchorDate = dayInput(body.anchorDate, 'Ngày mốc');
    if (body.rows !== undefined && body.rows !== null && (!Array.isArray(body.rows) || body.rows.length > 30)) fail(422, 'Danh sách việc nhánh không hợp lệ');
    const rows = (body.rows || []).map(r => {
      const index = Number(r?.index);
      if (!Number.isInteger(index) || index < 0 || index >= tpl.items.length) fail(422, 'Thứ tự việc trong mẫu không hợp lệ', 'INVALID_INDEX');
      return { index, skip: r.skip === true, title: r.title == null ? undefined : text(r.title, 'Tên việc nhánh', { max: 300 }),
        assigneeIds: r.assigneeIds == null ? undefined : W.idList(r.assigneeIds, 'Người chủ trì'), dueDate: dayInput(r.dueDate, 'Hạn') };
    });
    const plan = R.planTemplateItems(tpl.items, { rows, anchorDate, parentDue: parent.dueDate, parentAssigneeIds: parent.assignees.map(a => a.userId), prefix });
    if (!plan.items.length) fail(422, 'Không còn việc nhánh nào để tạo (đã bỏ hết)', 'EMPTY');
    const warnings = plan.items.filter(p => p.clampedFrom).map(p => `"${p.title}": hạn ${fmt(p.clampedFrom)} muộn hơn hạn việc cha — đã đặt bằng hạn việc cha ${fmt(parent.dueDate)}`);
    const people = Object.fromEntries((await prisma.user.findMany({ where: { id: { in: [...new Set(plan.items.flatMap(p => p.assigneeIds))] } }, select: { id: true, fullName: true } })).map(u => [u.id, u.fullName]));
    const view = (p, item = null) => ({ ...(item ? { id: item.id, code: `${project.key}-${item.number}` } : {}), index: p.index, title: p.title, dueDate: p.dueDate, dueBasis: p.basis,
      clampedFrom: p.clampedFrom, assignees: p.assigneeIds.map(uid => ({ id: uid, fullName: people[uid] || null })) });
    if (req.query.dryRun === '1') return res.json({ dryRun: true, template: tpl.name, anchorDate, parentDueDate: parent.dueDate, skipped: plan.skipped, warnings, items: plan.items.map(p => view(p)) });
    const created = await prisma.$transaction(async tx => {
      const out = [];
      for (const p of plan.items) {
        const item = await W.createWorkItem(tx, { project, user: req.user, rights, input: {
          title: p.title, deliverable: p.deliverable, parentId: id, priority: parent.priority, assigneeIds: p.assigneeIds,
          assignedById: req.user.id, source: parent.source, dueDate: p.dueDate, overrideWip: 'bulk',
        } });
        out.push(view(p, item));
      }
      await activity(tx, id, req.user.id, 'TEMPLATE_APPLIED', { template: tpl.name, count: out.length, skipped: plan.skipped, anchorDate: anchorDate ? anchorDate.toISOString() : null });
      return out;
    }, { timeout: 60_000 });
    bus.project(project.id, req.user.id);
    res.status(201).json({ created: created.length, skipped: plan.skipped, template: tpl.name, anchorDate, parentDueDate: parent.dueDate, warnings, items: created });
  });

  // ---------- Tổng hợp giao việc: theo phòng chủ trì + theo cán bộ chủ trì (giao ban) ----------
  async function summaryData(req) {
    const scope = permissionScope(req.user, 'reports.summary', 'VIEW');
    if (!scope) fail(403, 'Bạn không có quyền xem tổng hợp giao việc', 'FORBIDDEN');
    const settings = await R.getSettings(prisma);
    const departmentId = scope === 'SYSTEM' ? optionalInt(req.query.departmentId, 'Phòng ban') : req.user.departmentId ?? -1;
    // Phạm vi theo NGƯỜI: trưởng phòng xem cán bộ phòng mình ở mọi dự án/sổ (kể cả việc Ban Giám đốc giao) — chỉ số đếm, không lộ nội dung việc.
    const projectWhere = { deletedAt: null };
    const projectId = optionalInt(req.query.projectId, 'Dự án');
    if (projectId) projectWhere.id = projectId;
    // Ngày lọc theo giờ Việt Nam (yyyy-mm-dd → 00:00 giờ VN).
    const from = dayInput(req.query.from, 'Từ ngày'), to = dayInput(req.query.to, 'Đến ngày');
    const taskType = req.query.taskType ? oneOf(req.query.taskType, ['PLAN', 'ADHOC'], 'Loại nhiệm vụ') : null;
    const common = { archivedAt: null, project: projectWhere, ...(taskType ? { taskType } : {}), ...(from || to ? { assignedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: new Date(to.getTime() + 86_400_000 - 1) } : {}) } } : {}) };
    const people = departmentId ? (await prisma.user.findMany({ where: { departmentId, isRootAdmin: false, role: { not: 'admin' } }, select: { id: true } })).map(u => u.id) : null;
    const items = await prisma.workItem.findMany({
      where: { ...common, ...(people ? { OR: [{ assignees: { some: { userId: { in: people } } } }, { supporters: { some: { userId: { in: people } } } }] } : {}) },
      select: { dueDate: true, completedAt: true, state: { select: { category: true } }, assignees: { select: { userId: true } }, supporters: { select: { userId: true } } },
    });
    const leadIds = [...new Set(items.flatMap(i => [...i.assignees, ...i.supporters].map(a => a.userId)))];
    const users = await prisma.user.findMany({
      where: { isRootAdmin: false, role: { not: 'admin' }, ...(departmentId ? { departmentId } : {}), OR: [{ id: { in: leadIds } }, { isActive: true }] },
      select: { id: true, fullName: true, displayTitle: true, departmentId: true, department: { select: { name: true } } }, orderBy: [{ departmentId: 'asc' }, { fullName: 'asc' }],
    });
    const opts = { dueSoonDays: settings.dueSoonDays };
    const result = R.summarize(items, users, opts);
    const deptOf = new Map(users.map(u => [u.id, u.departmentId ?? null]));
    result.rows = result.rows.map(r => ({ ...r, departmentId: deptOf.get(r.userId) ?? null }));
    // Phạm vi theo PHÒNG CHỦ TRÌ: phòng của việc = đơn vị chủ trì ?? phòng sở hữu dự án/sổ.
    const deptScope = departmentId ? { OR: [{ leadDepartmentId: departmentId }, { leadDepartmentId: null, project: { departmentId } }] } : {};
    const deptItems = await prisma.workItem.findMany({ where: { ...common, ...deptScope },
      select: { dueDate: true, completedAt: true, dispatchStatus: true, taskType: true, leadDepartmentId: true, state: { select: { category: true } }, project: { select: { departmentId: true } } } });
    const departments = await prisma.department.findMany({ where: departmentId ? { id: departmentId } : {}, select: { id: true, name: true, isActive: true }, orderBy: { id: 'asc' } });
    const byDepartment = R.summarizeDepartments(deptItems, departments, opts);
    const active = new Set(departments.filter(d => d.isActive).map(d => d.id));
    byDepartment.rows = byDepartment.rows.filter(r => active.has(r.departmentId) || r.total);
    const filters = { scope, departmentId: departmentId > 0 ? departmentId : null, projectId: projectId ?? null, taskType, from: req.query.from || null, to: req.query.to || null };
    return { scope, settings, filters, users, result, byDepartment, staffSubtotals: R.subtotalsByDepartment(items, users, opts) };
  }
  app.get('/api/summary', auth, async (req, res) => {
    const d = await summaryData(req);
    await audit(req, 'VIEW_SUMMARY', 'Summary', null, null, { ...d.filters, people: d.result.rows.length });
    res.json({ scope: d.scope, generatedAt: new Date(), dueSoonDays: d.settings.dueSoonDays, ...d.result, byDepartment: d.byDepartment, staffSubtotals: d.staffSubtotals });
  });
  // Xuất Excel bảng tổng hợp: cùng bộ lọc, cùng phạm vi quyền với /api/summary; ghi nhật ký EXPORT_SUMMARY; dấu người xuất.
  app.get('/api/summary.xlsx', auth, async (req, res) => {
    const d = await summaryData(req);
    const now = new Date();
    const deptName = d.filters.departmentId ? (await prisma.department.findUnique({ where: { id: d.filters.departmentId }, select: { name: true } }))?.name : null;
    // Chỉ ghi tên dự án / sổ khi người xuất được xem dự án đó.
    const project = d.filters.projectId ? await prisma.project.findFirst({ where: { id: d.filters.projectId, ...visibleProjectsWhere(req.user) }, select: { key: true, name: true } }) : null;
    const scopeText = [`Phạm vi: ${deptName || (d.scope === 'SYSTEM' ? 'Toàn đơn vị' : 'Phòng của tôi')}`, project ? `Dự án / sổ: ${project.key} · ${project.name}` : null,
      d.filters.taskType ? `Loại nhiệm vụ: ${TASK_TYPE_LABEL[d.filters.taskType]}` : null,
      d.filters.from || d.filters.to ? `Giao từ ${d.filters.from ? fmt(dayInput(d.filters.from)) : '…'} đến ${d.filters.to ? fmt(dayInput(d.filters.to)) : '…'}` : null].filter(Boolean).join(' · ');
    const pct = v => (v == null ? null : v / 100);
    const wb = new ExcelJS.Workbook();
    wb.creator = `WorkHub - ${req.user.username}`;
    const head = (ws, title, columns, headerRow = 5) => {
      ws.columns = columns.map(([, width]) => ({ width }));
      ws.getCell(1, 1).value = title; ws.getCell(1, 1).font = { bold: true, size: 13 };
      ws.getCell(2, 1).value = scopeText;
      ws.getCell(3, 1).value = `Tính đến: ${fmtTime(now)} (giờ Việt Nam). Sắp đến hạn = còn 0–${d.settings.dueSoonDays} ngày.`;
      const h = ws.getRow(headerRow);
      columns.forEach(([label], i) => { const c = h.getCell(i + 1); c.value = label; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD_FILL; c.alignment = { wrapText: true, vertical: 'middle' }; });
      h.height = 32;
      ws.views = [{ state: 'frozen', xSplit: 1, ySplit: headerRow }];
    };
    const counts = r => [r.total, r.inProgress, r.dueSoon, r.overdue, r.doneOnTime, r.doneLate, pct(r.onTimeRate)];
    // Sheet 1: theo phòng chủ trì.
    const ds = wb.addWorksheet('Theo phòng chủ trì');
    head(ds, 'TỔNG HỢP TÌNH HÌNH THỰC HIỆN NHIỆM VỤ THEO PHÒNG CHỦ TRÌ', [['Phòng chủ trì', 30], ['Tổng việc', 10], ['Đang thực hiện', 12], ['Sắp đến hạn', 11], ['Quá hạn', 10], ['HT đúng hạn', 11], ['HT trễ hạn', 11],
      ['Tỷ lệ đúng hạn', 11], ['Chờ phòng tiếp nhận', 12], ['Kế hoạch năm: hoàn thành', 13], ['Kế hoạch năm: tổng', 11], ['Đột xuất: hoàn thành', 12], ['Đột xuất: tổng', 10]]);
    const deptLine = r => [r.name, ...counts(r), r.pendingAccept, r.plan.done, r.plan.total, r.adhoc.done, r.adhoc.total];
    for (const r of d.byDepartment.rows) ds.addRow(deptLine(r));
    if (d.byDepartment.rows.length > 1) { const t = ds.addRow(deptLine(d.byDepartment.total)); t.font = { bold: true }; t.eachCell(c => { c.fill = SUB_FILL; }); }
    ds.getColumn(8).numFmt = '0%';
    ds.addRow([]);
    ds.addRow(['Phòng của việc = đơn vị chủ trì (việc Ban Giám đốc giao về phòng); việc chưa giao về phòng tính cho phòng sở hữu dự án / sổ. Mỗi việc (kể cả việc nhánh) tính một lần; không tính việc huỷ.']);
    ds.addRow(['Tỷ lệ đúng hạn = HT đúng hạn / (HT đúng hạn + HT trễ hạn). "Chờ phòng tiếp nhận" = việc giao về phòng chưa được lãnh đạo phòng tiếp nhận, phân công.']);
    watermark(ds, req.user, now);
    // Sheet 2: theo cán bộ chủ trì, có dòng cộng theo phòng.
    const ss = wb.addWorksheet('Theo cán bộ');
    head(ss, 'TỔNG HỢP TÌNH HÌNH THỰC HIỆN NHIỆM VỤ ĐƯỢC GIAO — THEO CÁN BỘ CHỦ TRÌ', [['Cán bộ chủ trì', 26], ['Chức danh', 26], ['Phòng ban', 24], ['Tổng việc', 10], ['Đang thực hiện', 12], ['Sắp đến hạn', 11],
      ['Quá hạn', 10], ['HT đúng hạn', 11], ['HT trễ hạn', 11], ['Tỷ lệ đúng hạn', 11], ['Số việc phối hợp', 12]]);
    const all = req.query.all === '1';
    const rows = d.result.rows.filter(r => all || r.total || r.supporting);
    const groups = [];
    for (const r of rows) { const g = groups.at(-1); if (g && g.departmentId === r.departmentId) g.rows.push(r); else groups.push({ departmentId: r.departmentId, rows: [r] }); }
    const subOf = new Map(d.staffSubtotals.map(s => [s.departmentId, s]));
    for (const g of groups) {
      for (const r of g.rows) ss.addRow([r.fullName, r.title || '', r.department || '', ...counts(r), r.supporting || 0]);
      const s = subOf.get(g.departmentId);
      if (s && groups.length > 1) { const row = ss.addRow([`Cộng ${s.name}`, '', '', ...counts(s), s.supporting || 0]); row.font = { bold: true }; row.eachCell(c => { c.fill = SUB_FILL; }); }
    }
    const total = ss.addRow(['TỔNG CỘNG', '', '', ...counts(d.result.total), '']);
    total.font = { bold: true };
    ss.getColumn(10).numFmt = '0%';
    ss.addRow([]);
    ss.addRow(['Việc có nhiều người chủ trì được tính cho từng người; dòng "Cộng" của phòng và dòng TỔNG CỘNG tính mỗi việc một lần. Số việc phối hợp của phòng = số việc có cán bộ của phòng phối hợp.']);
    watermark(ss, req.user, now);
    await audit(req, 'EXPORT_SUMMARY', 'Summary', null, null, { ...d.filters, people: rows.length, departments: d.byDepartment.rows.length });
    await sendXlsx(res, wb, `Tong_hop_giao_viec_${fmt(now).replace(/\//g, '-')}.xlsx`);
  });

  // ---------- Kế hoạch công tác năm (.docx) ----------
  app.get('/api/projects/:id/plans', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id));
    res.json(await prisma.plan.findMany({ where: { projectId: project.id }, orderBy: { id: 'desc' }, include: { _count: { select: { items: true } } } }));
  });
  app.post('/api/projects/:id/plan-import', auth, withProject('manage'), upload.single('file'), async (req, res) => {
    const file = req.file;
    try {
      if (!file) fail(400, 'Chưa chọn tệp Word', 'REQUIRED');
      if (!/\.docx$/i.test(file.originalname)) fail(415, 'Chỉ nhận tệp .docx', 'FILE_TYPE_NOT_ALLOWED');
      await verifyUpload('plan.docx', file.path);
      const { project, rights } = req.projectCtx;
      let plan;
      try { plan = parsePlanDocx(await fs.readFile(file.path)); } catch (error) { fail(error.status || 422, error.message, 'PLAN_INVALID'); }
      const match = matcher(await directory(prisma));
      const matchDept = departmentMatcher(await activeDepartments(prisma));
      const assigned = project.visibility === 'ASSIGNED';
      const preview = plan.tasks.map(t => {
        const lead = match(t.leadNames.join(', ')), support = match(t.coordinatorNames.join(', '));
        // Đơn vị chủ trì: phần đầu của "Chủ trì: …"; các đơn vị còn lại (nếu có) và "Phối hợp: …" khớp được thì là phòng phối hợp.
        const leadParts = splitUnits(t.leadUnit, matchDept);
        const leadDept = leadParts.length ? matchDept(leadParts[0]) : null;
        const supportDepts = [...leadParts.slice(1), ...splitUnits(t.coordinator, matchDept)].map(matchDept).filter(x => x && x.id !== leadDept?.id)
          .filter((x, i, arr) => arr.findIndex(y => y.id === x.id) === i);
        return { ...t, leadIds: lead.ids, unmatchedLeads: lead.unmatched, supporterIds: support.ids.filter(id => !lead.ids.includes(id)), leadDept, supportDepts };
      });
      const warnings = [...plan.warnings, ...[...new Set(preview.flatMap(t => t.unmatchedLeads))].map(n => `Chưa có tài khoản cho "${n}" — việc sẽ chưa có người chủ trì`)];
      const unmatchedUnits = new Map();
      for (const t of preview) if (t.leadUnit && !t.leadDept) unmatchedUnits.set(t.leadUnit, [...(unmatchedUnits.get(t.leadUnit) || []), t.code]);
      for (const [unit, codes] of unmatchedUnits) warnings.push(`Không khớp đơn vị chủ trì "${unit}" (nhiệm vụ ${codes.join(', ')}) với phòng ban nào — ${assigned ? 'nhiệm vụ chưa giao về phòng, ' : ''}chỉ ghi vào Ghi chú`);
      if (!assigned && preview.some(t => t.leadDept && t.leadDept.id !== project.departmentId))
        warnings.push(`"${project.name}" không phải sổ giao việc của đơn vị: đơn vị chủ trì chỉ ghi vào Ghi chú, việc không giao về phòng`);
      if (req.query.dryRun === '1') {
        return res.json({ name: plan.name, year: plan.year, sections: plan.sections, warnings, dispatch: assigned,
          departments: { matched: preview.filter(t => t.leadDept).length, unmatched: [...unmatchedUnits.keys()] },
          tasks: preview.map(t => ({ code: t.code, section: t.section, title: t.title, due: t.due, budget: t.budget, leadUnit: t.leadUnit, leadIds: t.leadIds, unmatchedLeads: t.unmatchedLeads, coordinator: t.coordinator,
            leadDepartment: t.leadDept, leadUnitMatched: !t.leadUnit || !!t.leadDept, supportDepartments: t.supportDepts, milestones: t.milestones.length,
            milestoneList: t.milestones.map(m => ({ title: m.title, label: m.monthLabel || null, due: m.due })), warnings: t.warnings })) });
      }
      const assignedById = optionalInt(req.body.assignedById, 'Người giao') ?? req.user.id;
      const dispatchCounts = new Map();
      const created = await prisma.$transaction(async tx => {
        const p = await tx.plan.create({ data: { projectId: project.id, name: text(req.body.name, 'Tên kế hoạch', { max: 200 }) || plan.name, year: plan.year, fileName: file.originalname.slice(0, 200), createdById: req.user.id } });
        let count = 0;
        for (const t of preview) {
          const dispatch = assigned && t.leadDept;
          const notes = [t.leadUnit && !dispatch ? `Đơn vị chủ trì: ${t.leadUnit}` : null, t.unmatchedLeads.length ? `Người chủ trì (chưa có tài khoản): ${t.unmatchedLeads.join(', ')}` : null, t.advisors ? `Chuyên viên tham mưu: ${t.advisors}` : null].filter(Boolean).join('\n');
          const parent = await W.createWorkItem(tx, { project, user: req.user, rights, silent: true, source: 'PLAN', input: {
            title: t.title, descriptionHtml: t.description ? t.description.split('\n').map(l => `<p>${l.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</p>`).join('') : '',
            assigneeIds: t.leadIds, supporterIds: t.supporterIds, assignedById, source: 'Kế hoạch năm', dueDate: t.due, deliverable: t.deliverable, coordinatorText: t.coordinator || '',
            note: notes, period: t.period, location: t.location, budget: t.budget, supervisorText: t.supervisor, planCode: t.code, planSection: t.section, refCode: `KH${plan.year}-${t.code}`,
            priority: 'MEDIUM', ...(dispatch ? { leadDepartmentId: t.leadDept.id, supportDepartmentIds: t.supportDepts.map(x => x.id) } : {}),
          } });
          await tx.workItem.update({ where: { id: parent.id }, data: { planId: p.id } });
          if (dispatch) bumpDispatch(dispatchCounts, parent.leadDepartmentId, parent.dispatchStatus === 'PENDING');
          count++;
          for (const [k, m] of t.milestones.entries()) {
            const child = await W.createWorkItem(tx, { project, user: req.user, rights, silent: true, source: 'PLAN', input: {
              title: `${t.code}.${k + 1} – ${m.title}`, parentId: parent.id, assigneeIds: t.leadIds, assignedById, source: 'Kế hoạch năm', dueDate: m.due, priority: 'MEDIUM',
              planCode: `${t.code}.${k + 1}`, planSection: t.section, period: m.monthLabel || m.title, ...(m.start ? { startDate: m.start } : {}),
            } });
            await tx.workItem.update({ where: { id: child.id }, data: { planId: p.id } });
            count++;
          }
        }
        await audit(req, 'IMPORT_PLAN', 'Plan', p.id, null, { name: p.name, year: p.year, items: count }, tx);
        return { planId: p.id, count };
      }, { timeout: 120_000 });
      await notifyDispatchBatch(prisma, project, dispatchCounts, req.user.id, 'từ Kế hoạch năm');
      bus.project(project.id, req.user.id);
      res.status(201).json({ ...created, warnings, dispatched: [...dispatchCounts.values()].reduce((n, c) => n + c.total, 0) });
    } finally { if (file) await fs.rm(file.path, { force: true }); }
  });

  // ---------- Sổ giao việc Excel (đúng mẫu "Sổ theo dõi, kiểm soát giao việc nội bộ") ----------
  app.get('/api/projects/:id/register.xlsx', auth, async (req, res) => {
    const { project, member, rights } = await loadProject(prisma, req.user, intParam(req.params.id));
    if (!canExport(req.user, project, member, rights)) fail(403, 'Bạn không có quyền xuất Excel dự án này', 'FORBIDDEN');
    MG.mtlExportGuard(req.user, project, rights); // MTL: quy định xuất (người quản lý dự án / Ban GĐ)
    const settings = await R.getSettings(prisma);
    const items = await prisma.workItem.findMany({ where: { projectId: project.id, archivedAt: null, AND: [itemVisibleWhere(req.user)] }, orderBy: { number: 'asc' },
      include: { state: true, assignees: { include: { user: true } }, supporters: { include: { user: true } },
        approvals: { where: { status: 'PENDING' }, select: { currentLevel: true, status: true } }, documents: { where: { kind: 'BASIS' }, orderBy: { id: 'asc' } } } });
    const steps = await prisma.approvalStep.findMany({ where: { projectId: project.id }, orderBy: { level: 'asc' } });
    const names = Object.fromEntries((await prisma.user.findMany({ where: { id: { in: [...new Set(items.map(i => i.assignedById).filter(Boolean))] } }, select: { id: true, fullName: true } })).map(u => [u.id, u.fullName]));
    const deptNames = Object.fromEntries((await prisma.department.findMany({ select: { id: true, name: true } })).map(d => [d.id, d.name]));
    const ordered = [];
    for (const p of items.filter(i => !i.parentId)) { ordered.push(p); for (const c of items.filter(i => i.parentId === p.id)) ordered.push(c); }
    for (const c of items.filter(i => i.parentId && !ordered.includes(i))) ordered.push(c);
    const now = new Date();
    const wb = new ExcelJS.Workbook();
    wb.creator = `WorkHub - ${req.user.username}`;
    const ws = wb.addWorksheet('Theo dõi giao việc', { views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }] });
    ws.columns = REGISTER_COLUMNS.map(([header, width]) => ({ width }));
    ws.mergeCells(1, 1, 1, REGISTER_COLUMNS.length);
    ws.getCell(1, 1).value = `SỔ THEO DÕI, KIỂM SOÁT GIAO VIỆC — ${project.name}`;
    ws.getCell(1, 1).font = { bold: true, size: 14 };
    ws.getCell(2, 1).value = `Cập nhật đến ngày: ${fmt(now)}`;
    const head = ws.getRow(4);
    REGISTER_COLUMNS.forEach(([h], i) => { const c = head.getCell(i + 1); c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD_FILL; c.alignment = { wrapText: true, vertical: 'middle' }; });
    head.height = 36;
    ordered.forEach((i, k) => {
      const s = R.deadlineStatus(i, now, settings.dueSoonDays);
      const row = ws.addRow([k + 1, `${project.key}-${i.number}`, (i.parentId ? '↳ ' : '') + i.title, i.source || '', names[i.assignedById] || '', i.assignees.map(a => a.user.fullName).join(', '),
        [...i.supporters.map(a => a.user.fullName), i.coordinatorText].filter(Boolean).join('; '), excelDay(i.assignedAt), excelDay(i.dueDate), PRIORITY_LABEL[i.priority], i.progress,
        i.state.category === 'COMPLETED' ? excelDay(i.completedAt) : null, s.label, s.daysLeft ?? '', i.deliverable, i.outputs, i.resultNote, i.review, i.note,
        TASK_TYPE_LABEL[i.taskType] || '', deptNames[i.leadDepartmentId] || '', RATING_LABEL[i.rating] || '', R.formatDocumentRefs(i.documents), stageOf(i, steps).label]);
      row.alignment = { wrapText: true, vertical: 'top' };
      for (const c of DATE_COLUMNS) row.getCell(c).numFmt = DATE_FMT;
      if (!i.parentId && items.some(c => c.parentId === i.id)) row.getCell(3).font = { bold: true };
      if (STATUS_FILL[s.code]) { row.getCell(13).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_FILL[s.code] } }; row.getCell(14).fill = row.getCell(13).fill; }
    });
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: REGISTER_COLUMNS.length } };
    watermark(ws, req.user, now);
    // Sheet Tổng hợp theo cán bộ chủ trì của dự án.
    const leadIds = [...new Set(items.flatMap(i => [...i.assignees, ...i.supporters].map(a => a.userId)))];
    const users = await prisma.user.findMany({ where: { id: { in: leadIds } }, select: { id: true, fullName: true, displayTitle: true, department: { select: { name: true } } }, orderBy: { fullName: 'asc' } });
    const sum = R.summarize(items.map(i => ({ ...i, assignees: i.assignees.map(a => ({ userId: a.userId })), supporters: i.supporters.map(a => ({ userId: a.userId })) })), users, { now, dueSoonDays: settings.dueSoonDays });
    const ts = wb.addWorksheet('Tổng hợp');
    ts.columns = [24, 10, 14, 12, 10, 12, 12, 14, 16].map(width => ({ width }));
    ts.getCell(1, 1).value = 'TỔNG HỢP TÌNH HÌNH THỰC HIỆN NHIỆM VỤ ĐƯỢC GIAO'; ts.getCell(1, 1).font = { bold: true, size: 13 };
    ts.getCell(2, 1).value = `Tính đến ngày: ${fmt(now)}`;
    const th = ts.getRow(4); ['Cán bộ chủ trì', 'Tổng việc', 'Đang thực hiện', 'Sắp đến hạn', 'Quá hạn', 'HT đúng hạn', 'HT trễ hạn', 'Tỷ lệ đúng hạn', 'Số việc phối hợp'].forEach((h, i) => { th.getCell(i + 1).value = h; th.getCell(i + 1).font = { bold: true }; });
    for (const r of [...sum.rows, sum.total]) ts.addRow([r.fullName, r.total, r.inProgress, r.dueSoon, r.overdue, r.doneOnTime, r.doneLate, r.onTimeRate == null ? '' : r.onTimeRate + '%', r.supporting || '']);
    ts.lastRow.font = { bold: true };
    ts.addRow([]); ts.addRow(['Tỷ lệ đúng hạn = HT đúng hạn / (HT đúng hạn + HT trễ hạn).']);
    await audit(req, 'EXPORT_REGISTER', 'Project', project.id, null, { rows: ordered.length });
    await sendXlsx(res, wb, `So_giao_viec_${project.key}_${fmt(now).replace(/\//g, '-')}.xlsx`);
  });

  app.post('/api/projects/:id/register-import', auth, withProject('manage'), upload.single('file'), async (req, res) => {
    const file = req.file;
    try {
      if (!file) fail(400, 'Chưa chọn tệp Excel', 'REQUIRED');
      if (!/\.xlsx$/i.test(file.originalname)) fail(415, 'Chỉ nhận tệp .xlsx', 'FILE_TYPE_NOT_ALLOWED');
      await verifyUpload('import.xlsx', file.path);
      const { project, rights } = req.projectCtx;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file.path);
      // Tìm trang tính có dòng tiêu đề chứa "Nội dung công việc".
      let ws = null, headerRow = 0;
      for (const sheet of wb.worksheets) {
        sheet.eachRow((row, n) => { if (!ws && n <= 15 && row.values.some(v => typeof v === 'string' && norm(v) === 'noi dung cong viec')) { ws = sheet; headerRow = n; } });
        if (ws) break;
      }
      if (!ws) fail(422, 'Không tìm thấy dòng tiêu đề "Nội dung công việc" (dùng đúng mẫu sổ giao việc)', 'IMPORT_INVALID');
      const cols = {};
      ws.getRow(headerRow).eachCell((c, i) => { cols[norm(cellText(c))] = i; });
      const col = (...names) => names.map(n => cols[n]).find(Boolean);
      const C = {
        code: col('ma cv'), title: col('noi dung cong viec'), source: col('nguon giao viec'), assigner: col('nguoi giao'), lead: col('nguoi chu tri'), support: col('nguoi phoi hop'),
        assignedAt: col('ngay giao'), due: col('han hoan thanh'), priority: col('muc do uu tien'), progress: col('tien do (%)', 'tien do'), done: col('ngay hoan thanh thuc te'),
        deliverable: col('san pham dau ra'), outputs: col('san pham da co theo tien do'), result: col('ket qua / kho khan, kien nghi', 'ket qua / kho khan'), review: col('danh gia cua nguoi giao'), note: col('ghi chu'), taskType: col('loai nhiem vu'),
        leadDept: col('don vi chu tri', 'phong chu tri'), basis: col('van ban can cu', 'can cu giao viec'),
      };
      const match = matcher(await directory(prisma));
      const matchDept = departmentMatcher(await activeDepartments(prisma));
      const assigned = project.visibility === 'ASSIGNED';
      const rows = [], warnings = new Set(), docErrors = [], unmatchedDepts = new Map();
      let ignoredDeptRows = 0;
      ws.eachRow((row, n) => {
        if (n <= headerRow) return;
        const get = k => (C[k] ? cellText(row.getCell(C[k])) : '');
        let title = String(get('title') || '').trim();
        if (!title) return;
        const isChild = /^↳/.test(title);
        title = title.replace(/^↳\s*/, '').trim();
        if (title.length > 300) title = title.slice(0, 297) + '…';
        const lead = match(get('lead')), support = match(get('support')), assigner = match(get('assigner'));
        for (const u of [...lead.unmatched, ...assigner.unmatched]) warnings.add(`Chưa có tài khoản cho "${u}"`);
        let progress = get('progress');
        progress = progress === '' ? 0 : Number(progress);
        if (progress > 0 && progress <= 1) progress *= 100;
        const pr = PRIORITY_BY_LABEL[norm(get('priority'))] || (get('priority') ? 'MEDIUM' : 'NONE');
        // Đơn vị chủ trì: chỉ giao về phòng trong sổ giao việc của đơn vị.
        const deptText = String(get('leadDept') || '').trim();
        const dept = deptText ? matchDept(deptText) : null;
        if (deptText && !dept) unmatchedDepts.set(deptText, (unmatchedDepts.get(deptText) || 0) + 1);
        if (deptText && !assigned && dept?.id !== project.departmentId) ignoredDeptRows++;
        const basis = parseDocumentRefsSafe(get('basis'));
        for (const e of basis.errors) docErrors.push(`Dòng ${n}: ${e}`);
        rows.push({
          n, isChild, refCode: String(get('code') || '') || null, title, source: String(get('source') || '') || null,
          taskType: /^ke hoach/.test(norm(get('taskType'))) ? 'PLAN' : /^dot xuat/.test(norm(get('taskType'))) ? 'ADHOC' : undefined,
          assignedById: assigner.ids[0] || null, leadIds: lead.ids, supporterIds: support.ids.filter(id => !lead.ids.includes(id)),
          coordinatorText: support.unmatched.join('; '), assignedAt: parseDay(get('assignedAt'), 'Ngày giao', n), dueDate: parseDay(get('due'), 'Hạn hoàn thành', n),
          completedAt: parseDay(get('done'), 'Ngày hoàn thành thực tế', n), priority: pr, progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : 0,
          deliverable: String(get('deliverable') || ''), outputs: String(get('outputs') || ''), resultNote: String(get('result') || ''), review: String(get('review') || ''),
          note: [String(get('note') || ''), lead.unmatched.length ? `Người chủ trì (chưa có tài khoản): ${lead.unmatched.join(', ')}` : '', assigner.unmatched.length ? `Người giao: ${assigner.unmatched.join(', ')}` : '',
            deptText && !(assigned && dept) && dept?.id !== project.departmentId ? `Đơn vị chủ trì: ${deptText}` : ''].filter(Boolean).join('\n'),
          leadDepartmentId: assigned && dept ? dept.id : undefined, docs: basis.docs,
        });
      });
      if (!rows.length) fail(422, 'Không có dòng dữ liệu nào', 'IMPORT_EMPTY');
      if (rows.length > 2000) fail(422, 'Tối đa 2000 dòng mỗi lần nhập', 'IMPORT_TOO_LARGE');
      for (const [name, count] of unmatchedDepts) warnings.add(`Không khớp đơn vị chủ trì "${name}" với phòng ban nào (${count} dòng) — ${assigned ? 'việc chưa giao về phòng, ' : ''}chỉ ghi vào Ghi chú`);
      if (ignoredDeptRows) warnings.add(`"${project.name}" không phải sổ giao việc của đơn vị: bỏ qua cột "Đơn vị chủ trì" (${ignoredDeptRows} dòng), chỉ ghi vào Ghi chú`);
      for (const e of docErrors.slice(0, 20)) warnings.add(`Văn bản căn cứ — ${e}`);
      if (docErrors.length > 20) warnings.add(`Văn bản căn cứ: còn ${docErrors.length - 20} lỗi khác`);
      const withDocs = rows.filter(r => r.docs.length);
      const docCount = withDocs.reduce((n, r) => n + r.docs.length, 0);
      const dispatchRows = rows.filter(r => r.leadDepartmentId);
      if (req.query.dryRun === '1') {
        const notes = [withDocs.length ? `${withDocs.length} dòng có Văn bản căn cứ (${docCount} văn bản sẽ được ghi vào mục "Văn bản liên quan")` : null,
          assigned && dispatchRows.length ? `${dispatchRows.length} dòng giao về phòng chủ trì (${dispatchRows.filter(r => !r.isChild && !r.leadIds.length).length} việc sẽ chờ phòng tiếp nhận)` : null].filter(Boolean);
        return res.json({ rows: rows.length, groups: rows.filter(r => !r.isChild).length, children: rows.filter(r => r.isChild).length, completed: rows.filter(r => r.completedAt).length, warnings: [...warnings], notes,
          departments: { column: !!C.leadDept, dispatch: assigned, matched: dispatchRows.length, unmatched: [...unmatchedDepts.keys()], ignored: ignoredDeptRows },
          documents: { rows: withDocs.length, count: docCount },
          sample: rows.slice(0, 8).map(r => ({ n: r.n, title: r.title, isChild: r.isChild, leads: r.leadIds.length, due: r.dueDate, completedAt: r.completedAt, leadDepartmentId: r.leadDepartmentId ?? null, documents: r.docs.length })) });
      }
      const states = await prisma.workflowState.findMany({ where: { projectId: project.id }, orderBy: { position: 'asc' } });
      const st = c => states.find(s => s.category === c);
      const dispatchCounts = new Map();
      const created = await prisma.$transaction(async tx => {
        let parentId = null, count = 0;
        for (const r of rows) {
          const state = r.progress > 0 && st('STARTED') ? st('STARTED') : st('UNSTARTED');
          const item = await W.createWorkItem(tx, { project, user: req.user, rights, silent: true, source: 'REGISTER', strictAssignees: false, input: {
            title: r.title, assigneeIds: r.leadIds, supporterIds: r.supporterIds, assignedById: r.assignedById, assignedAt: r.assignedAt, source: r.source, dueDate: r.dueDate,
            priority: r.priority, progress: r.progress, deliverable: r.deliverable, outputs: r.outputs, resultNote: r.resultNote, coordinatorText: r.coordinatorText, note: r.note,
            refCode: r.refCode, stateId: state.id, parentId: r.isChild ? parentId : null, overrideWip: true, ...(r.taskType ? { taskType: r.taskType } : {}),
            ...(r.leadDepartmentId ? { leadDepartmentId: r.leadDepartmentId } : {}),
          } });
          if (!r.isChild) parentId = item.id;
          if (item.dispatchStatus && !r.completedAt) bumpDispatch(dispatchCounts, item.leadDepartmentId, item.dispatchStatus === 'PENDING');
          // Việc đã có ngày hoàn thành thực tế trong sổ: ghi nhận hoàn thành (dữ liệu lịch sử, không qua duyệt).
          if (r.completedAt) await tx.workItem.update({ where: { id: item.id }, data: { stateId: st('COMPLETED').id, completedAt: r.completedAt, progress: 100, startedAt: r.assignedAt || r.completedAt } });
          if (r.review) await tx.workItem.update({ where: { id: item.id }, data: { review: r.review.slice(0, 2000), reviewedById: req.user.id, reviewedAt: new Date() } });
          if (r.docs.length) await tx.workItemDocument.createMany({ data: r.docs.map(d => ({ workItemId: item.id, kind: 'BASIS', number: d.number, issuedOn: d.issuedOn, summary: d.summary, createdById: req.user.id })) });
          count++;
        }
        await audit(req, 'IMPORT_REGISTER', 'Project', project.id, null, { rows: count, documents: docCount, dispatched: dispatchRows.length }, tx);
        return count;
      }, { timeout: 120_000 });
      await notifyDispatchBatch(prisma, project, dispatchCounts, req.user.id, 'từ sổ Excel');
      bus.project(project.id, req.user.id);
      res.status(201).json({ created, documents: docCount, warnings: [...warnings] });
    } finally { if (file) await fs.rm(file.path, { force: true }); }
  });
};

// Văn bản căn cứ trong ô Excel (ô có thể là chữ, số hoặc ngày) → { docs, errors }.
function parseDocumentRefsSafe(value) {
  if (value === '' || value == null) return { docs: [], errors: [] };
  return R.parseDocumentRefs(value instanceof Date ? '' : String(value));
}

module.exports.canExport = canExport;
module.exports.canEditTemplate = canEditTemplate;
module.exports.canCreateTemplate = canCreateTemplate;
