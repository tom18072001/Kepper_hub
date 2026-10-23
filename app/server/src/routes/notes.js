// Ghi chú / việc cá nhân trong "Việc của tôi". Chỉ chủ sở hữu đọc/sửa được — không có ngoại lệ cho quản trị.
// Nội dung ghi chú không được ghi vào nhật ký hệ thống (chỉ ghi siêu dữ liệu khi chuyển thành công việc).
const { fail, intParam, optionalDate, text } = require('../lib/http');
const MG = require('../services/mtl-guard');
const { loadProject, assertRegisterManager } = require('../services/access');
const W = require('../services/workitems');
const bus = require('../services/bus');

const MAX_NOTES = 500;
const plain = (value, label, max) => text(String(value ?? '').replace(/\r\n/g, '\n'), label, { max, multiline: true });

module.exports = function mountNotes(app, { prisma, auth, audit }) {
  async function own(req) {
    const note = await prisma.personalNote.findUnique({ where: { id: intParam(req.params.id) } });
    // Ghi chú của người khác: trả 404 như không tồn tại.
    if (!note || note.userId !== req.user.id) fail(404, 'Không tìm thấy ghi chú', 'NOT_FOUND');
    return note;
  }

  app.get('/api/me/notes', auth, async (req, res) => {
    const rows = await prisma.personalNote.findMany({ where: { userId: req.user.id }, orderBy: [{ done: 'asc' }, { pinned: 'desc' }, { position: 'asc' }, { id: 'desc' }], take: MAX_NOTES });
    res.json(rows);
  });

  app.post('/api/me/notes', auth, async (req, res) => {
    if (await prisma.personalNote.count({ where: { userId: req.user.id } }) >= MAX_NOTES) fail(422, `Tối đa ${MAX_NOTES} ghi chú — hãy xoá bớt ghi chú đã xong`, 'TOO_MANY_NOTES');
    const first = await prisma.personalNote.findFirst({ where: { userId: req.user.id }, orderBy: { position: 'asc' }, select: { position: true } });
    const row = await prisma.personalNote.create({ data: {
      userId: req.user.id, title: text(req.body.title, 'Nội dung', { required: true, max: 300 }), body: plain(req.body.body, 'Ghi chú', 5000) || '',
      dueDate: optionalDate(req.body.dueDate, 'Hạn') ?? null, position: (first ? first.position : 0) - 1024,
    } });
    res.status(201).json(row);
  });

  app.patch('/api/me/notes/:id', auth, async (req, res) => {
    const note = await own(req);
    const b = req.body || {}, data = {};
    if (b.title !== undefined) data.title = text(b.title, 'Nội dung', { required: true, max: 300 });
    if (b.body !== undefined) data.body = plain(b.body, 'Ghi chú', 5000) || '';
    if (b.dueDate !== undefined) data.dueDate = optionalDate(b.dueDate, 'Hạn');
    if (b.pinned !== undefined) data.pinned = !!b.pinned;
    if (b.done !== undefined) { data.done = !!b.done; data.doneAt = data.done ? (note.doneAt || new Date()) : null; }
    res.json(await prisma.personalNote.update({ where: { id: note.id }, data }));
  });

  app.delete('/api/me/notes/:id', auth, async (req, res) => {
    const note = await own(req);
    await prisma.personalNote.delete({ where: { id: note.id } });
    res.json({ ok: true });
  });

  // Chuyển ghi chú thành công việc trong một dự án (người dùng phải có quyền cập nhật việc trong dự án đó).
  app.post('/api/me/notes/:id/convert', auth, async (req, res) => {
    const note = await own(req);
    if (note.convertedItemId) fail(409, 'Ghi chú đã được chuyển thành công việc', 'ALREADY_CONVERTED');
    const { project, rights, member } = await loadProject(prisma, req.user, intParam(req.body.projectId, 'Dự án'), 'edit');
    assertRegisterManager(project, rights, member);
    // MTL: thêm hạng mục từ ghi chú = sửa kế hoạch → chỉ người quản lý dự án (services/mtl-guard.js).
    MG.mtlBulkGuard(req.user, project, rights);
    const item = await prisma.$transaction(async tx => {
      const created = await W.createWorkItem(tx, { project, user: req.user, rights, source: 'NOTE', input: {
        title: note.title, descriptionHtml: note.body ? '<p>' + note.body.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])).replace(/\n/g, '<br>') + '</p>' : '',
        dueDate: note.dueDate, assigneeIds: req.body.assignToMe === false ? [] : [req.user.id],
      } });
      await tx.personalNote.update({ where: { id: note.id }, data: { convertedItemId: created.id, done: true, doneAt: new Date() } });
      await audit(req, 'CREATE', 'WorkItem', created.id, null, { code: `${project.key}-${created.number}`, source: 'NOTE' }, tx);
      return created;
    });
    bus.item(project.id, item.id, req.user.id);
    res.status(201).json({ id: item.id, code: `${project.key}-${item.number}`, projectId: project.id });
  });
};
