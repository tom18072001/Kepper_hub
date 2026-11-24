// Tài liệu — kho tài liệu theo dự án: (1) tệp nhân viên tải lên Hub trong các việc (theo cây hạng mục → việc → việc nhánh) và
// (2) mọi tệp có sẵn trong thư mục dự án trên kho file NAS (duyệt CHỈ ĐỌC, kể cả tệp không tải qua Hub).
// Quyền: chỉ thành viên dự án và Ban Giám đốc (lib/project-docs.js canViewDocs) — kiểm ở máy chủ cho mọi API dưới đây;
// dự án không được xem trả 404 (không lộ sự tồn tại). Tải tệp ghi nhật ký (audit DOWNLOAD); Claude (token) không tải nội dung tệp.
const { pipeline } = require('node:stream');
const storage = require('../lib/storage');
const nas = require('../lib/nas');
const PD = require('../lib/project-docs');
const { fail, intParam } = require('../lib/http');
const { contentDisposition } = require('../lib/attachment-utils');
const { typeOf } = require('../lib/files');
const { assertNotVia } = require('../lib/tokens');

module.exports = function mountDocuments(app, { prisma, auth, audit }) {
  // Dự án người dùng được xem tài liệu: Ban GĐ — mọi dự án chưa xoá; người khác — dự án mình là thành viên / trưởng dự án.
  async function visibleProjects(user) {
    const where = { deletedAt: null };
    if (!(user.role === 'director')) where.OR = [{ members: { some: { userId: user.id } } }, { leadId: user.id }];
    const rows = await prisma.project.findMany({ where, select: { id: true, key: true, name: true, kind: true, archivedAt: true, leadId: true, deletedAt: true }, orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }] });
    const members = await prisma.projectMember.findMany({ where: { userId: user.id, projectId: { in: rows.map(r => r.id) } }, select: { projectId: true } });
    const mine = new Set(members.map(m => m.projectId));
    return rows.filter(p => PD.canViewDocs(user, p, mine.has(p.id) ? {} : null));
  }
  async function loadProject(req) {
    const id = intParam(req.params.id);
    const project = await prisma.project.findUnique({ where: { id }, select: { id: true, key: true, name: true, kind: true, archivedAt: true, leadId: true, deletedAt: true } });
    const member = project && await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: id, userId: req.user.id } } });
    if (!project || !PD.canViewDocs(req.user, project, member)) fail(404, 'Không tìm thấy dự án', 'NOT_FOUND');
    return project;
  }
  const nasRoot = async project => (await PD.projectRoot(project.key)) || fail(404, 'Dự án chưa có thư mục trên kho file', 'NAS_NOT_FOUND');
  // Gửi tệp: pipeline huỷ luồng đọc khi người dùng ngắt giữa chừng (không giữ file handle trên CIFS) hoặc khi đọc lỗi.
  const send = (stream, res) => pipeline(stream, res, () => {});

  app.get('/api/documents/projects', auth, async (req, res) => {
    const list = await visibleProjects(req.user);
    const counts = list.length ? await prisma.attachment.groupBy({ by: ['workItemId'], where: { workItem: { projectId: { in: list.map(p => p.id) }, archivedAt: null } }, _count: { _all: true } }) : [];
    const itemProject = counts.length ? Object.fromEntries((await prisma.workItem.findMany({ where: { id: { in: counts.map(c => c.workItemId) } }, select: { id: true, projectId: true } })).map(i => [i.id, i.projectId])) : {};
    const perProject = {};
    for (const c of counts) perProject[itemProject[c.workItemId]] = (perProject[itemProject[c.workItemId]] || 0) + c._count._all;
    // Gốc NAS đọc MỘT lần cho cả danh sách (bất đồng bộ). NAS lỗi: danh sách vẫn hiện, kèm lý do.
    let names = null, nasError = null;
    try { names = await PD.rootFolders(); } catch (e) { nasError = e.message; }
    res.json({
      nasEnabled: names != null, nasError,
      projects: list.map(p => ({ id: p.id, key: p.key, name: p.name, kind: p.kind, archived: !!p.archivedAt, hubFiles: perProject[p.id] || 0, nasFolder: PD.folderFor(names, p.key) })),
    });
  });

  // Tệp tải lên Hub của dự án, kèm các việc chứa tệp và tổ tiên của chúng (để dựng cây hạng mục → việc → việc nhánh).
  app.get('/api/documents/projects/:id/hub', auth, async (req, res) => {
    const project = await loadProject(req);
    const items = await prisma.workItem.findMany({ where: { projectId: project.id, archivedAt: null }, select: { id: true, number: true, title: true, parentId: true } });
    const files = await prisma.attachment.findMany({ where: { workItem: { projectId: project.id, archivedAt: null } }, orderBy: { createdAt: 'desc' },
      select: { id: true, workItemId: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, objectKey: true, uploadedById: true } });
    const byId = new Map(items.map(i => [i.id, i]));
    const keep = new Set();
    for (const f of files) for (let cur = byId.get(f.workItemId), n = 0; cur && !keep.has(cur.id) && n < 50; cur = byId.get(cur.parentId), n++) keep.add(cur.id);
    const users = Object.fromEntries((await prisma.user.findMany({ where: { id: { in: [...new Set(files.map(f => f.uploadedById))] } }, select: { id: true, fullName: true } })).map(u => [u.id, u.fullName]));
    res.json({
      project: { id: project.id, key: project.key, name: project.name },
      items: items.filter(i => keep.has(i.id)).map(i => ({ id: i.id, code: `${project.key}-${i.number}`, title: i.title, parentId: keep.has(i.parentId) ? i.parentId : null })),
      files: files.map(f => ({ id: f.id, workItemId: f.workItemId, fileName: f.fileName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, createdAt: f.createdAt,
        uploadedBy: users[f.uploadedById] || null, ...storage.locationOf(f.objectKey) })),
    });
  });

  // Tải / xem nhanh tệp tải lên Hub từ mục Tài liệu. Quyền = quyền xem tài liệu dự án (thành viên + Ban GĐ) — rộng hơn quyền xem
  // đầy đủ từng việc (người không liên quan tới việc chỉ xem tóm tắt trong panel việc), theo quyết định của chủ dự án 24/11/2026.
  app.get('/api/documents/files/:fid', auth, async (req, res) => {
    assertNotVia(req);
    const a = await prisma.attachment.findUnique({ where: { id: intParam(req.params.fid) }, include: { workItem: { select: { projectId: true, archivedAt: true, number: true } } } });
    if (!a || a.workItem.archivedAt) fail(404, 'Không tìm thấy tệp', 'NOT_FOUND');
    req.params.id = String(a.workItem.projectId);
    const project = await loadProject(req).catch(() => fail(404, 'Không tìm thấy tệp', 'NOT_FOUND'));
    // Tệp nằm trên NAS: mở + đọc qua cổng toàn cục của PD (không chiếm threadpool khi NAS treo); còn lại theo storage như cũ.
    let file = null;
    if (nas.isNasKey(a.objectKey)) {
      try { file = await PD.openRead(nas.absOf(a.objectKey)); }
      catch (e) { if (e.status === 404) fail(404, 'Tệp không còn trong kho lưu trữ', 'NOT_FOUND'); throw e; }
    } else if (!(await storage.stat(a.objectKey))) fail(404, 'Tệp không còn trong kho lưu trữ', 'NOT_FOUND');
    const inline = req.query.inline === '1' && /\.(pdf|png|jpe?g|gif|webp)$/i.test(a.fileName);
    res.setHeader('Content-Type', (typeOf(a.fileName) || {}).mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', a.fileName));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    if (file) res.setHeader('Content-Length', String(file.size));
    try { await audit(req, inline ? 'PREVIEW' : 'DOWNLOAD', 'Attachment', a.id, null, { workItemId: a.workItemId, projectKey: project.key, fileName: a.fileName, via: 'documents' }); }
    catch (e) { if (file) file.stream.destroy(); throw e; }
    send(file ? file.stream : await storage.getStream(a.objectKey), res);
  });

  // Một thư mục trong thư mục dự án trên NAS (?path= tương đối, trống = gốc). Tệp đã tải qua Hub được đánh dấu kèm mã việc.
  app.get('/api/documents/projects/:id/nas', auth, async (req, res) => {
    const project = await loadProject(req);
    const base = await nasRoot(project);
    const q = String(req.query.q || '').trim().slice(0, 200);
    const result = q ? await PD.search(base.abs, q) : { ...(await PD.listDir(base.abs, req.query.path)), truncated: false };
    const keys = result.entries.filter(e => !e.dir).map(e => nas.PREFIX + `${base.folder}/${e.path}`);
    const linked = keys.length ? await prisma.attachment.findMany({ where: { objectKey: { in: keys }, workItem: { archivedAt: null } }, select: { id: true, objectKey: true, workItemId: true, workItem: { select: { number: true } } } }) : [];
    const byKey = Object.fromEntries(linked.map(a => [a.objectKey, { attachmentId: a.id, workItemId: a.workItemId, code: `${project.key}-${a.workItem.number}` }]));
    res.json({
      project: { id: project.id, key: project.key, name: project.name }, folder: base.folder, path: result.path ?? '', query: q || null, truncated: result.truncated,
      entries: result.entries.map(e => ({ ...e, hub: e.dir ? undefined : byKey[nas.PREFIX + `${base.folder}/${e.path}`] })),
    });
  });

  // Tải một tệp trong thư mục dự án trên NAS (chỉ đọc).
  app.get('/api/documents/projects/:id/nas/file', auth, async (req, res) => {
    assertNotVia(req); // Claude (token) không tải nội dung tệp
    const project = await loadProject(req);
    const base = await nasRoot(project);
    const { abs, rel } = await PD.resolveIn(base.abs, req.query.path);
    const { stream, size } = await PD.openRead(abs); // mở + stat trước header; đọc từng khối qua cổng NAS toàn cục
    const st = { size };
    const name = rel.split('/').pop();
    const inline = req.query.inline === '1' && /\.(pdf|png|jpe?g|gif|webp)$/i.test(name); // xem nhanh trên trình duyệt: chỉ PDF / ảnh
    res.setHeader('Content-Type', (typeOf(name) || {}).mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', name));
    res.setHeader('Content-Length', String(st.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    try { await audit(req, 'DOWNLOAD', 'ProjectNasFile', project.id, null, { projectKey: project.key, path: `${base.folder}/${rel}`, size: st.size }); }
    catch (e) { stream.destroy(); throw e; }
    send(stream, res);
  });
};
