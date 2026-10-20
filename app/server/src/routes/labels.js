// Nhãn: nhãn chung toàn tổ chức (quản trị quản lý) và nhãn riêng của dự án (thành viên dự án tự tạo khi gắn nhãn).
const { fail, intParam, text } = require('../lib/http');
const { permissionScope } = require('../lib/permissions');
const { loadProject, visibleProjectsWhere } = require('../services/access');

const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#475569'];
function nameOf(value) { return text(String(value ?? '').replace(/\s+/g, ' ').trim(), 'Tên nhãn', { required: true, max: 40 }); }
function colorOf(value, fallback) { return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback; }
const isLabelAdmin = user => user.isRootAdmin || permissionScope(user, 'admin.labels', 'OPERATE') === 'SYSTEM';

module.exports = function mountLabels(app, { prisma, auth, audit }) {
  // Nhãn chung + nhãn của các dự án người dùng được xem.
  app.get('/api/labels', auth, async (req, res) => {
    const rows = await prisma.label.findMany({ where: { OR: [{ projectId: null }, { project: visibleProjectsWhere(req.user) }] }, orderBy: [{ projectId: 'asc' }, { name: 'asc' }] });
    res.json(rows);
  });

  // Tìm nhãn trùng tên (không phân biệt hoa thường) trong phạm vi nhãn chung + nhãn của dự án.
  const findSame = (projectId, name) => prisma.label.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])] } });

  app.post('/api/labels', auth, async (req, res) => {
    if (!isLabelAdmin(req.user)) fail(403, 'Chỉ quản trị được tạo nhãn chung', 'FORBIDDEN');
    const name = nameOf(req.body.name);
    if (await findSame(null, name)) fail(409, `Đã có nhãn "${name}"`, 'LABEL_EXISTS');
    const row = await prisma.label.create({ data: { name, color: colorOf(req.body.color, '#2563eb'), createdById: req.user.id } });
    await audit(req, 'CREATE', 'Label', row.id, null, row);
    res.status(201).json(row);
  });

  // Thành viên dự án (quyền cập nhật việc) tạo nhãn riêng của dự án; trùng tên thì trả lại nhãn có sẵn.
  app.post('/api/projects/:id/labels', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id), 'edit');
    const name = nameOf(req.body.name);
    const same = await findSame(project.id, name);
    if (same) return res.json(same);
    const count = await prisma.label.count({ where: { projectId: project.id } });
    if (count >= 100) fail(422, 'Dự án đã có tối đa 100 nhãn', 'TOO_MANY_LABELS');
    const row = await prisma.label.create({ data: { name, color: colorOf(req.body.color, PALETTE[count % PALETTE.length]), projectId: project.id, createdById: req.user.id } });
    await audit(req, 'CREATE', 'Label', row.id, null, row);
    res.status(201).json(row);
  });

  async function editable(req) {
    const label = await prisma.label.findUnique({ where: { id: intParam(req.params.id) } });
    if (!label) fail(404, 'Không tìm thấy nhãn', 'NOT_FOUND');
    if (label.projectId) await loadProject(prisma, req.user, label.projectId, 'manage');
    else if (!isLabelAdmin(req.user)) fail(403, 'Chỉ quản trị được sửa nhãn chung', 'FORBIDDEN');
    return label;
  }
  app.put('/api/labels/:id', auth, async (req, res) => {
    const label = await editable(req);
    const data = {};
    if (req.body.name !== undefined) {
      data.name = nameOf(req.body.name);
      const same = await findSame(label.projectId, data.name);
      if (same && same.id !== label.id) fail(409, `Đã có nhãn "${data.name}"`, 'LABEL_EXISTS');
    }
    if (req.body.color !== undefined) data.color = colorOf(req.body.color, label.color);
    const row = await prisma.label.update({ where: { id: label.id }, data });
    await audit(req, 'UPDATE', 'Label', label.id, label, row);
    res.json(row);
  });
  app.delete('/api/labels/:id', auth, async (req, res) => {
    const label = await editable(req);
    await prisma.label.delete({ where: { id: label.id } });
    await audit(req, 'DELETE', 'Label', label.id, label, null);
    res.json({ ok: true });
  });
};
