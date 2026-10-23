// Xuất / nhập Excel danh sách công việc của một dự án.
const path = require('node:path');
const MG = require('../services/mtl-guard');
const fs = require('node:fs/promises');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { fail, intParam } = require('../lib/http');
const { permissionScope } = require('../lib/permissions');
const { loadProject, itemVisibleWhere } = require('../services/access');
const { verifyUpload } = require('../lib/files');
const { activity } = require('../services/events');
const { endPosition } = require('../services/approval');

const PRIORITY_LABEL = { URGENT: 'Khẩn cấp', HIGH: 'Cao', MEDIUM: 'Trung bình', LOW: 'Thấp', NONE: 'Không' };
const PRIORITY_BY_LABEL = Object.fromEntries(Object.entries(PRIORITY_LABEL).flatMap(([k, v]) => [[v.toLowerCase(), k], [k.toLowerCase(), k]]));
const COLUMNS = [
  { header: 'Mã', key: 'code', width: 12 }, { header: 'Tiêu đề', key: 'title', width: 48 }, { header: 'Trạng thái', key: 'state', width: 16 },
  { header: 'Ưu tiên', key: 'priority', width: 12 }, { header: 'Người nhận', key: 'assignees', width: 30 }, { header: 'Bắt đầu', key: 'startDate', width: 12 },
  { header: 'Hạn', key: 'dueDate', width: 12 }, { header: 'Hoàn thành lúc', key: 'completedAt', width: 18 }, { header: 'Nhãn', key: 'labels', width: 20 }, { header: 'Mô tả', key: 'description', width: 60 },
];
const IMPORT_COLUMNS = ['Tiêu đề', 'Mô tả', 'Người nhận (tài khoản, cách nhau dấu phẩy)', 'Ưu tiên', 'Bắt đầu (YYYY-MM-DD)', 'Hạn (YYYY-MM-DD)', 'Trạng thái'];

function canExport(user, project) {
  const scope = permissionScope(user, 'reports.export', 'OPERATE');
  return scope === 'SYSTEM' || (scope === 'UNIT' && Number(user.departmentId) === Number(project.departmentId));
}
function cellText(cell) {
  const v = cell?.value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return String(v.text ?? v.result ?? (v.richText ? v.richText.map(r => r.text).join('') : ''));
  return String(v);
}
function dateOf(value, row, label) {
  if (!value) return null;
  const d = new Date(value.length === 10 ? value + 'T00:00:00+07:00' : value);
  if (Number.isNaN(d.getTime())) fail(422, `Dòng ${row}: ${label} không hợp lệ`, 'IMPORT_INVALID');
  return d;
}
async function sendWorkbook(res, workbook, fileName) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
}

module.exports = function mountExcel(app, { prisma, auth, audit, config }) {
  const upload = multer({ dest: path.join(config.uploadTmpDir, 'workhub-import'), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

  app.get('/api/projects/:id/export.xlsx', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id));
    if (!canExport(req.user, project)) fail(403, 'Bạn không có quyền xuất Excel dự án này', 'FORBIDDEN');
    MG.mtlExportGuard(req.user, project, (await loadProject(prisma, req.user, project.id)).rights); // MTL: quản lý dự án / Ban GĐ
    const items = await prisma.workItem.findMany({ where: { projectId: project.id, archivedAt: null, AND: [itemVisibleWhere(req.user)] }, orderBy: { number: 'asc' },
      include: { state: true, assignees: { include: { user: true } }, labels: { include: { label: true } } } });
    const wb = new ExcelJS.Workbook();
    wb.creator = `WorkHub - ${req.user.username}`;
    wb.created = new Date();
    const ws = wb.addWorksheet(project.key);
    ws.columns = COLUMNS;
    ws.getRow(1).font = { bold: true };
    for (const i of items) ws.addRow({
      code: `${project.key}-${i.number}`, title: i.title, state: i.state.name, priority: PRIORITY_LABEL[i.priority], assignees: i.assignees.map(a => a.user.fullName).join(', '),
      startDate: i.startDate ? i.startDate.toISOString().slice(0, 10) : '', dueDate: i.dueDate ? i.dueDate.toISOString().slice(0, 10) : '',
      completedAt: i.completedAt ? i.completedAt.toISOString().replace('T', ' ').slice(0, 16) : '', labels: i.labels.map(l => l.label.name).join(', '), description: i.descriptionText,
    });
    // Dấu vết người xuất (watermark trong file) phục vụ truy vết khi dữ liệu rời hệ thống.
    ws.addRow([]);
    ws.addRow([`Xuất bởi ${req.user.fullName} (${req.user.username}) lúc ${new Date().toISOString()}`]).font = { italic: true, color: { argb: 'FF6B7280' } };
    await audit(req, 'EXPORT_EXCEL', 'Project', project.id, null, { rows: items.length });
    await sendWorkbook(res, wb, `WorkHub_${project.key}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

  app.get('/api/projects/:id/import-template.xlsx', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id), 'edit');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cong viec');
    ws.addRow(IMPORT_COLUMNS).font = { bold: true };
    ws.addRow(['Ví dụ: Chuẩn bị báo cáo tuần', 'Tổng hợp số liệu từ các nhóm', '', 'Trung bình', '', '', 'Cần làm']);
    ws.columns.forEach(c => { c.width = 28; });
    await sendWorkbook(res, wb, `Mau_nhap_${project.key}.xlsx`);
  });

  app.post('/api/projects/:id/import', auth, async (req, res, next) => {
    req.projectCtx = await loadProject(prisma, req.user, intParam(req.params.id), 'edit');
    MG.mtlBulkGuard(req.user, req.projectCtx.project, req.projectCtx.rights); // MTL: nhập hàng loạt chỉ người quản lý dự án
    if (req.projectCtx.project.visibility === 'ASSIGNED' && !req.projectCtx.rights.canManage && !req.projectCtx.member)
      fail(403, 'Chỉ Ban Giám đốc / người quản lý sổ được nhập việc vào sổ giao việc của đơn vị', 'FORBIDDEN');
    next();
  }, upload.single('file'), async (req, res) => {
    const file = req.file;
    try {
      if (!file) fail(400, 'Chưa chọn tệp Excel', 'REQUIRED');
      if (!/\.xlsx$/i.test(file.originalname)) fail(415, 'Chỉ nhận tệp .xlsx', 'FILE_TYPE_NOT_ALLOWED');
      await verifyUpload('import.xlsx', file.path);
      const { project } = req.projectCtx;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file.path);
      const ws = wb.worksheets[0];
      if (!ws) fail(422, 'Tệp không có trang tính', 'IMPORT_INVALID');
      const states = await prisma.workflowState.findMany({ where: { projectId: project.id }, orderBy: { position: 'asc' } });
      const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, username: true } });
      const userByName = new Map(users.map(u => [u.username, u.id]));
      const rows = [];
      ws.eachRow((row, n) => { if (n > 1) rows.push({ n, values: Array.from({ length: 7 }, (_, i) => cellText(row.getCell(i + 1)).trim()) }); });
      const parsed = rows.filter(r => r.values[0] && !r.values[0].startsWith('Ví dụ:')).map(({ n, values: [title, description, assignees, priority, start, due, stateName] }) => {
        if (title.length > 300) fail(422, `Dòng ${n}: tiêu đề quá dài`, 'IMPORT_INVALID');
        const state = stateName ? states.find(s => s.name.toLowerCase() === stateName.toLowerCase()) : (states.find(s => s.category === 'UNSTARTED') || states.find(s => !['REVIEW', 'COMPLETED', 'CANCELLED'].includes(s.category)));
        if (!state) fail(422, `Dòng ${n}: không có trạng thái "${stateName}"`, 'IMPORT_INVALID');
        if (['REVIEW', 'COMPLETED'].includes(state.category)) fail(422, `Dòng ${n}: không nhập thẳng vào cột "${state.name}"`, 'IMPORT_INVALID');
        const assigneeIds = assignees ? assignees.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).map(u => userByName.get(u) ?? fail(422, `Dòng ${n}: không có tài khoản "${u}"`, 'IMPORT_INVALID')) : [];
        const p = priority ? PRIORITY_BY_LABEL[priority.toLowerCase()] : 'NONE';
        if (!p) fail(422, `Dòng ${n}: ưu tiên "${priority}" không hợp lệ`, 'IMPORT_INVALID');
        return { title, description, assigneeIds: [...new Set(assigneeIds)], priority: p, startDate: dateOf(start, n, 'Ngày bắt đầu'), dueDate: dateOf(due, n, 'Hạn'), state };
      });
      if (!parsed.length) fail(422, 'Không có dòng dữ liệu nào', 'IMPORT_EMPTY');
      if (parsed.length > 1000) fail(422, 'Tối đa 1000 dòng mỗi lần nhập', 'IMPORT_TOO_LARGE');
      const created = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'project:' + project.id}))`;
        let count = 0;
        for (const r of parsed) {
          const { nextNumber } = await tx.project.update({ where: { id: project.id }, data: { nextNumber: { increment: 1 } }, select: { nextNumber: true } });
          const descriptionHtml = r.description ? '<p>' + r.description.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) + '</p>' : '';
          const item = await tx.workItem.create({ data: {
            projectId: project.id, number: nextNumber - 1, title: r.title, descriptionHtml, descriptionText: r.description || '', stateId: r.state.id, priority: r.priority,
            reporterId: req.user.id, startDate: r.startDate, dueDate: r.dueDate, startedAt: r.state.category === 'STARTED' ? new Date() : null,
            position: await endPosition(tx, r.state.id), assignees: { create: r.assigneeIds.map(userId => ({ userId })) },
          } });
          await activity(tx, item.id, req.user.id, 'CREATED', { title: r.title, state: r.state.name, source: 'EXCEL' });
          count++;
        }
        await audit(req, 'IMPORT_EXCEL', 'Project', project.id, null, { rows: count }, tx);
        return count;
      }, { timeout: 60_000 });
      require('../services/bus').project(project.id, req.user.id);
      res.status(201).json({ created });
    } finally {
      if (file) await fs.rm(file.path, { force: true });
    }
  });
};
