// Tệp đính kèm: lưu tạm ra đĩa (không giữ trong RAM), kiểm tra loại tệp, lưu vào MinIO/ổ đĩa.
const fs = require('node:fs/promises');
const path = require('node:path');
const multer = require('multer');
const storage = require('../lib/storage');
const { downloadName, contentDisposition } = require('../lib/attachment-utils');
const { verifyUpload, previewable, typeOf } = require('../lib/files');
const { convertWord, streamToBuffer } = require('../lib/document-preview');
const { fail, intParam } = require('../lib/http');
const TA = require('../services/task-access');
const tree = require('../services/tree');
const { activity } = require('../services/events');
const bus = require('../services/bus');

const MAX_FILE_BYTES = 25 * 1024 * 1024;

module.exports = function mountAttachments(app, { prisma, auth, audit, config }) {
  const upload = multer({ dest: path.join(config.uploadTmpDir, 'workhub-upload'), limits: { fileSize: MAX_FILE_BYTES, files: 5 } });

  app.post('/api/items/:id/attachments', auth, async (req, res, next) => {
    // Kiểm tra quyền TRƯỚC khi nhận tệp: tài liệu bên giao (người giao, Ban Giám đốc) hoặc bên thực hiện (chủ trì, phối hợp).
    const ctx = await TA.loadTask(prisma, req.user, intParam(req.params.id));
    if (!ctx.caps.docsGive && !ctx.caps.docsBack) TA.assertCap(ctx.caps, 'docsBack', 'Chỉ người giao, Ban Giám đốc, người chủ trì hoặc người phối hợp gửi tệp cho việc này');
    req.itemCtx = { ...ctx, itemId: ctx.task.id };
    next();
  }, upload.array('files', 5), async (req, res) => {
    const files = req.files || [];
    const saved = [];
    try {
      if (!files.length) fail(400, 'Chưa chọn tệp', 'REQUIRED');
      const { project, itemId } = req.itemCtx;
      // Kho file dự án (bản gốc): việc gốc của cây = thư mục hạng mục; mã bộ phận = phòng chủ trì (theo cây), không có thì phòng người gửi.
      const item = await prisma.workItem.findUnique({ where: { id: itemId }, select: { id: true, number: true, title: true, parentId: true, leadDepartmentId: true } });
      const chain = item.parentId ? await tree.ancestors(prisma, item.parentId, { number: true, title: true, leadDepartmentId: true }) : [];
      const deptId = tree.effectiveDept(item, chain) ?? req.user.departmentId ?? null;
      const codeOf = async id => (id ? (await prisma.department.findUnique({ where: { id }, select: { code: true } }))?.code ?? null : null);
      const root = chain.at(-1) || item;
      const deptCode = await codeOf(deptId);
      const rootDeptCode = (await codeOf(root.leadDepartmentId)) ?? deptCode; // thư mục mảng theo phòng chủ trì hạng mục
      for (const file of files) {
        const fileName = downloadName(file.originalname);
        const mimeType = await verifyUpload(fileName, file.path);
        const buffer = await fs.readFile(file.path);
        const stored = storage.saveToProject({ projectKey: project.key, root, item, deptCode, rootDeptCode, fileName }, buffer)
          || await storage.save(fileName, buffer, `${project.key}/${itemId}`);
        saved.push({ fileName, mimeType, stored });
      }
      const rows = await prisma.$transaction(async tx => {
        const out = [];
        for (const s of saved) out.push(await tx.attachment.create({ data: {
          workItemId: req.itemCtx.itemId, fileName: s.fileName, objectKey: s.stored.objectKey, mimeType: s.mimeType,
          sizeBytes: s.stored.size, checksum: s.stored.checksum, uploadedById: req.user.id,
        } }));
        await activity(tx, req.itemCtx.itemId, req.user.id, 'ATTACHMENT', { files: out.map(a => a.fileName) });
        await audit(req, 'UPLOAD', 'Attachment', out.map(a => a.id).join(','), null, { workItemId: req.itemCtx.itemId, files: out.map(a => ({ name: a.fileName, sha256: a.checksum })) }, tx);
        return out;
      });
      bus.item(project.id, itemId, req.user.id);
      res.status(201).json(rows.map(a => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, createdAt: a.createdAt, ...storage.locationOf(a.objectKey) })));
    } catch (error) {
      await Promise.allSettled(saved.map(s => storage.discard(s.stored.objectKey)));
      throw error;
    } finally {
      await Promise.allSettled(files.map(f => fs.rm(f.path, { force: true })));
    }
  });

  // Tệp của việc: chỉ người xem đầy đủ việc mới tải / xem (người xem tóm tắt không thấy tài liệu). Xoá: chỉ người đã gửi tệp.
  async function attachmentFor(req, need = 'view') {
    const row = await prisma.attachment.findUnique({ where: { id: intParam(req.params.id) } });
    if (!row) fail(404, 'Không tìm thấy tệp', 'NOT_FOUND');
    const ctx = await TA.loadTask(prisma, req.user, row.workItemId);
    TA.assertCap(ctx.caps, 'view');
    if (need === 'delete' && (row.uploadedById !== req.user.id || !ctx.caps.deleteOwnFiles)) fail(403, TA.MESSAGES.deleteFile, 'FORBIDDEN');
    return { ...row, projectId: ctx.project.id };
  }

  app.get('/api/attachments/:id/download', auth, async (req, res) => {
    require('../lib/tokens').assertNotVia(req);
    const a = await attachmentFor(req);
    if (!(await storage.stat(a.objectKey))) fail(404, 'Tệp không còn trong kho lưu trữ', 'NOT_FOUND');
    res.setHeader('Content-Type', (typeOf(a.fileName) || {}).mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition('attachment', a.fileName));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    await audit(req, 'DOWNLOAD', 'Attachment', a.id, null, { workItemId: a.workItemId, fileName: a.fileName });
    const stream = await storage.getStream(a.objectKey);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });

  app.get('/api/attachments/:id/preview', auth, async (req, res) => {
    require('../lib/tokens').assertNotVia(req);
    const a = await attachmentFor(req);
    const kind = previewable(a.fileName);
    if (!kind) fail(415, 'Định dạng tệp không hỗ trợ xem trước', 'PREVIEW_UNSUPPORTED');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const source = await streamToBuffer(await storage.getStream(a.objectKey));
    await audit(req, 'PREVIEW', 'Attachment', a.id, null, { workItemId: a.workItemId, fileName: a.fileName });
    if (kind === 'word') {
      const pdf = await convertWord(a.fileName, source).catch(error => {
        const status = { PREVIEW_TIMEOUT: 504, PREVIEW_UNAVAILABLE: 503, PREVIEW_QUEUE_FULL: 429 }[error.code] || 422;
        fail(status, error.message, error.code);
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', contentDisposition('inline', a.fileName.replace(/\.docx?$/i, '.pdf')));
      return res.send(pdf);
    }
    res.setHeader('Content-Type', typeOf(a.fileName).mime);
    res.setHeader('Content-Disposition', contentDisposition('inline', a.fileName));
    res.send(source);
  });

  app.delete('/api/attachments/:id', auth, async (req, res) => {
    const a = await attachmentFor(req, 'delete');
    await prisma.$transaction(async tx => {
      await tx.attachment.delete({ where: { id: a.id } });
      await activity(tx, a.workItemId, req.user.id, 'ATTACHMENT_DELETED', { fileName: a.fileName });
      await audit(req, 'DELETE', 'Attachment', a.id, { fileName: a.fileName, objectKey: a.objectKey }, null, tx);
    });
    // Xoá tệp vật lý sau khi xoá bản ghi; lỗi kho lưu trữ được ghi audit để dọn sau.
    await storage.remove(a.objectKey).catch(error => audit(req, 'DELETE_STORAGE_ERROR', 'Attachment', a.id, null, { objectKey: a.objectKey, error: error.message }));
    bus.item(a.projectId, a.workItemId, req.user.id);
    res.json({ ok: true });
  });
};
