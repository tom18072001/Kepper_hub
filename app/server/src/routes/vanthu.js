// Văn thư — sổ văn bản đến (D10), đi (D9), nội bộ (D5–D7) theo "Quy định văn thư, lưu trữ" (QyĐ-GA-01).
// Bật bằng MODULES=vanthu. Cấp số tự động, liên tục theo dãy / pháp nhân / năm; không giữ số, nhảy số, dùng lại số đã hủy (Điều 7.1).
// Văn bản đến: hạn xử lý theo độ khẩn (Điều 12), theo dõi trạng thái (Điều 11), nhắc người xử lý trước hạn 1 ngày và khi quá hạn.
// Quyền xem theo mức bảo mật (Điều 5) — services/vanthu.js canView. Claude (token): chỉ đọc, không thấy văn bản Bảo mật cao.
// Sổ nội bộ (quy chế, quy định — docs/de-xuat-quy-che-phe-duyet.md): tạo là DỰ THẢO chưa có số; Người phê duyệt (vai Ban TGĐ, danh sách
// trong Thiết lập văn thư) bấm Phê duyệt trên giao diện thì mới cấp số; cấp xem theo vai (Mọi người / Lãnh đạo / Ban TGĐ) thay mức mật.
// Claude (token) chỉ TẠO DỰ THẢO kèm PDF (POST /api/vanthu/drafts) — không phê duyệt, không trả lại, không cấp số.
const { NOT_IT_WHERE, BOARD_WHERE, isBoard, roleRank } = require('../lib/permissions');
const { Prisma } = require('@prisma/client');
const { fail, intParam, optionalInt, text, oneOf } = require('../lib/http');
const V = require('../services/vanthu');
const WD = require('../services/weekly-data');
const WK = require('../services/weekly');
const H = require('../services/hrm');
const { notify } = require('../services/events');
const fsp = require('node:fs/promises');
const nodePath = require('node:path');
const multer = require('multer');
const storage = require('../lib/storage');
const { downloadName, contentDisposition } = require('../lib/attachment-utils');
const { verifyUpload, typeOf } = require('../lib/files');
const { assertNotVia } = require('../lib/tokens');

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const LOCK = 731301; // pg_advisory_xact_lock(LOCK, hash(dãy, pháp nhân, năm)): cấp số tuần tự, không trùng / nhảy số khi vào sổ song song
const ACTIVE_USER = { isActive: true, ...NOT_IT_WHERE };
const day = v => (v == null || v === '' ? null : WK.isDay(v) ? v : fail(422, 'Ngày không hợp lệ (YYYY-MM-DD)', 'INVALID_DATE'));
const hash32 = s => { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) | 0; return h; };
const out = (map, v) => (v ? { code: v, label: map[v] || v } : null);
// Tìm theo số, trích yếu, nơi gửi / nhận, số của bên gửi — không phân biệt hoa thường và dấu, như Tìm nhanh (routes/search.js):
// unaccent(lower(cột)) LIKE unaccent(lower(từ khoá)) (extension unaccent, migration 20261119200000_search_unaccent). % _ \ trong từ khoá hiểu nghĩa đen.
const TEXT_COLS = ['number', 'title', 'counterpart', 'externalNumber'];
function textMatch(q) {
  const pat = '%' + q.replace(/[\\%_]/g, c => '\\' + c) + '%';
  return Prisma.sql`(${Prisma.join(TEXT_COLS.map(c => Prisma.sql`unaccent(lower(coalesce(${Prisma.raw(`"${c}"`)}, ''))) LIKE unaccent(lower(${pat}))`), ' OR ')})`;
}

module.exports = function mountVanthu(app, { prisma, auth, audit, config }) {
  if (!(config.modules || []).includes('vanthu')) return;

  const workCfg = async () => { try { const c = await H.hrmConfig(prisma); return { workDays: c.workDays, holidays: c.holidays }; } catch { return { workDays: [1, 2, 3, 4, 5], holidays: [] }; } };
  async function subject(req) {
    const [s, cfg] = await Promise.all([WD.rolesOf(prisma, req.user), V.vanthuConfig(prisma)]);
    return { ...s, clerk: !s.it && cfg.clerkUserIds.includes(req.user.id), legal: !s.it && cfg.legalUserIds.includes(req.user.id), ai: req.via === 'mcp', cfg,
      rank: roleRank(req.user), approver: !s.it && V.isApprover(req.user, cfg, isBoard(req.user)) };
  }
  const visible = (doc, s) => V.canView(doc, s) && !V.aiHidden(doc, s);
  // Người nhận thông báo "có tài liệu chờ phê duyệt": danh sách Người phê duyệt; trống → Ban TGĐ phụ trách "Toàn công ty".
  const approverIds = async cfg => (await prisma.user.findMany({ where: { isActive: true, ...BOARD_WHERE, ...(cfg.approverUserIds.length ? { id: { in: cfg.approverUserIds } } : { boardAll: true }) }, select: { id: true } })).map(u => u.id);
  const label = d => d.number || `dự thảo "${d.title.slice(0, 60)}"`;
  const userOk = async (id, label) => {
    if (id == null) return null;
    const u = await prisma.user.findFirst({ where: { id, ...ACTIVE_USER }, select: { id: true, fullName: true, departmentId: true } });
    if (!u) fail(422, label + ' không hợp lệ', 'INVALID_USER');
    return u;
  };
  const deptOk = async id => {
    if (id == null) return null;
    const d = await prisma.department.findFirst({ where: { id, isActive: true }, select: { id: true, code: true, name: true } });
    if (!d) fail(422, 'Bộ phận không hợp lệ', 'INVALID_DEPARTMENT');
    return d;
  };
  const load = async (id, s) => {
    const doc = await prisma.docRecord.findUnique({ where: { id: intParam(id) } });
    if (!doc || !visible(doc, s)) fail(404, 'Không tìm thấy văn bản', 'NOT_FOUND');
    return doc;
  };
  async function docOut(d, s, { users = null, depts = null } = {}) {
    users ||= await WD.userNames(prisma, [d.handlerId, d.createdById, d.approvedById]);
    const noibo = d.book === 'NOIBO';
    depts ||= Object.fromEntries((await prisma.department.findMany({ select: { id: true, name: true } })).map(x => [x.id, x.name]));
    const today = WK.dayOf(new Date());
    return {
      id: d.id, book: out(V.BOOKS, d.book), series: d.series, entity: d.entity, year: d.year, number: d.number, docType: d.docType, title: d.title,
      counterpart: d.counterpart, externalNumber: d.externalNumber, docDate: d.docDate, registeredAt: d.registeredAt,
      security: noibo ? null : out(V.SECURITY, d.security), urgency: out(V.URGENCY, d.urgency), dueDate: d.dueDate, overdue: V.isOverdue(d, today),
      status: out(V.STATUS[d.book], d.status), closed: V.CLOSED.has(d.status),
      handler: d.handlerId ? { id: d.handlerId, fullName: users[d.handlerId] || null } : null,
      department: d.departmentId ? { id: d.departmentId, name: depts[d.departmentId] || null } : null,
      signerName: d.signerName, channel: d.channel, trackingCode: d.trackingCode, toLegal: d.toLegal, note: d.note,
      viewerIds: (s.director || s.clerk) && d.security === 'BAO_MAT_CAO' ? d.viewerIds : undefined,
      cancelled: d.cancelledAt ? { at: d.cancelledAt, reason: d.cancelReason } : null,
      createdBy: { id: d.createdById, fullName: users[d.createdById] || null },
      ...(noibo ? {
        draft: V.isDraft(d), viewLevel: out(V.VIEW_LEVELS, d.viewLevel || 'ALL'), docCode: d.docCode, effectiveDate: d.effectiveDate, replacesId: d.replacesId, viaAi: d.viaAi,
        approvedBy: d.approvedById ? { id: d.approvedById, fullName: users[d.approvedById] || null } : null, approvedAt: d.approvedAt,
        issueDate: d.docDate || (d.approvedAt ? WK.dayOf(d.approvedAt) : null), // ngày ban hành: ngày ban hành gốc (văn bản có từ trước) hoặc ngày phê duyệt
      } : {}),
      can: noibo ? noiboCan(d, s) : { edit: !s.ai && !d.cancelledAt && (s.director || s.clerk), cancel: !s.ai && !d.cancelledAt && (s.director || s.clerk), upload: canUpload(d, s), deleteFile: !s.ai && (s.director || s.clerk), status: (ks => ks.filter((k, i) => i > ks.indexOf(d.status) && !s.ai && V.canStatus(d, s, k)))(Object.keys(V.STATUS[d.book])) }, // chỉ các bước kế tiếp
    };
  }
  // Nút trên giao diện (máy chủ vẫn kiểm lại từng thao tác). Đã phê duyệt: khoá nội dung và tệp; Văn thư / Ban TGĐ chỉ sửa ghi chú, cấp xem,
  // ngày hiệu lực (khi chưa hiệu lực), đánh dấu Hiệu lực / Hết hiệu lực, huỷ số.
  function noiboCan(d, s) {
    const draft = V.isDraft(d), office = !s.ai && !d.cancelledAt && (s.director || s.clerk);
    return {
      edit: draft ? V.canEditDraft(d, s) : office, upload: V.canEditDraft(d, s), deleteFile: V.canEditDraft(d, s),
      cancel: draft ? V.canEditDraft(d, s) : office,
      approve: !V.approveCheck(d, s, [{ mimeType: 'application/pdf' }]), return: !V.returnCheck(d, s),
      resubmit: d.status === 'RETURNED' && V.canEditDraft(d, s),
      status: draft || !office ? [] : V.NOIBO_MANUAL[d.status] || [],
    };
  }

  // Tải tệp lên: người vào sổ, Ban TGĐ, người xử lý, lãnh đạo bộ phận xử lý. Claude (token) không tải lên.
  const canUpload = (d, s) => d.book === 'NOIBO' ? V.canEditDraft(d, s) : !s.ai && !s.it && !d.cancelledAt && (s.director || s.clerk || d.handlerId === s.userId || d.createdById === s.userId || (s.leader && d.departmentId != null && d.departmentId === s.departmentId));
  const fileOut = (f, names = {}) => ({ id: f.id, fileName: f.fileName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, createdAt: f.createdAt, uploadedBy: names[f.uploadedById] || null, ...storage.locationOf(f.objectKey) });

  app.get('/api/vanthu/meta', auth, async (req, res) => {
    const s = await subject(req);
    const depts = await prisma.department.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } });
    res.json({
      books: V.BOOKS, series: V.SERIES, security: V.SECURITY, urgency: V.URGENCY, status: V.STATUS, docTypes: V.DOC_TYPES, dueWorkdays: V.DUE_WORKDAYS,
      entities: s.cfg.entities, departments: depts,
      me: { clerk: s.clerk, director: s.director, leader: s.leader, departmentId: s.departmentId, it: s.it },
      canRegister: Object.fromEntries(Object.keys(V.SERIES).map(k => [k, !s.ai && V.canRegister(s, k, s.departmentId)])),
      viewLevels: V.VIEW_LEVELS, myViewLevels: V.levelsFor(s), noiboTypes: V.NOIBO_TYPES,
      approver: s.approver,
      config: s.director ? { clerkUserIds: s.cfg.clerkUserIds, legalUserIds: s.cfg.legalUserIds, approverUserIds: s.cfg.approverUserIds,
        boardUsers: await prisma.user.findMany({ where: { isActive: true, ...BOARD_WHERE }, select: { id: true, fullName: true, boardAll: true }, orderBy: { fullName: 'asc' } }) } : undefined,
    });
  });

  app.get('/api/vanthu/docs', auth, async (req, res) => {
    const s = await subject(req);
    if (s.it) fail(403, 'Quản trị hệ thống không xem nội dung văn bản', 'FORBIDDEN');
    const q = req.query;
    const where = {};
    if (q.book) where.book = oneOf(String(q.book), Object.keys(V.BOOKS), 'Sổ');
    const year = optionalInt(q.year, 'Năm'); if (year) where.year = year;
    if (q.entity) where.entity = String(q.entity).slice(0, 6);
    if (q.status) where.status = String(q.status).slice(0, 20);
    if (q.mine === '1') where.handlerId = req.user.id;
    const t = String(q.q || '').trim().slice(0, 100);
    if (t) {
      // Từ khoá không phân biệt dấu: bước 1 lấy id khớp bằng SQL có tham số trong cùng phạm vi sổ / năm / pháp nhân / trạng thái / người xử lý,
      // bước 2 đọc và lọc quyền bằng Prisma như cũ (visible) — phạm vi xem không đổi.
      const cond = [textMatch(t)];
      if (where.book) cond.push(Prisma.sql`"book" = ${where.book}`);
      if (where.year) cond.push(Prisma.sql`"year" = ${where.year}`);
      if (where.entity) cond.push(Prisma.sql`"entity" = ${where.entity}`);
      if (where.status) cond.push(Prisma.sql`"status" = ${where.status}`);
      if (where.handlerId) cond.push(Prisma.sql`"handlerId" = ${where.handlerId}`);
      const ids = await prisma.$queryRaw`SELECT "id" FROM "DocRecord" WHERE ${Prisma.join(cond, ' AND ')} ORDER BY "year" DESC, "registeredAt" DESC, "seq" DESC LIMIT 500`;
      where.id = { in: ids.map(r => Number(r.id)) };
    }
    const rows = (await prisma.docRecord.findMany({ where, orderBy: [{ year: 'desc' }, { registeredAt: 'desc' }, { seq: 'desc' }], take: 500 })).filter(d => visible(d, s));
    const today = WK.dayOf(new Date());
    const list = q.overdue === '1' ? rows.filter(d => V.isOverdue(d, today)) : rows;
    const users = await WD.userNames(prisma, list.flatMap(d => [d.handlerId, d.createdById]));
    const depts = Object.fromEntries((await prisma.department.findMany({ select: { id: true, name: true } })).map(x => [x.id, x.name]));
    res.json(await Promise.all(list.map(d => docOut(d, s, { users, depts }))));
  });

  // Chọn văn bản trong sổ để gắn vào "Văn bản liên quan" của việc (panel chi tiết việc): chỉ trả văn bản V.canLink — Công khai / Nội bộ,
  // chưa hủy, người hỏi xem được trong sổ. Không đổi quyền xem sổ. Tìm theo số, trích yếu, nơi gửi / nhận, số của bên gửi —
  // không phân biệt hoa thường và dấu (unaccent, như Tìm nhanh). Trả ít trường: đủ để điền sẵn số, ngày, nơi ban hành, trích yếu.
  app.get('/api/vanthu/pick', auth, async (req, res) => {
    const s = await subject(req);
    if (s.it) fail(403, 'Quản trị hệ thống không xem nội dung văn bản', 'FORBIDDEN');
    const q = String(req.query.q || '').trim().slice(0, 100);
    const match = q ? Prisma.sql`AND ${textMatch(q)}` : Prisma.empty;
    // Sổ nội bộ: chỉ tài liệu đã phê duyệt cấp "Mọi người" (V.canLink kiểm lại).
    const ids = (await prisma.$queryRaw`SELECT "id" FROM "DocRecord" WHERE "cancelledAt" IS NULL AND "security" IN (${Prisma.join(V.LINKABLE_SECURITY)})
      AND ("book" <> 'NOIBO' OR (coalesce("viewLevel", 'ALL') = 'ALL' AND "status" NOT IN ('DRAFT', 'RETURNED'))) ${match}
      ORDER BY "registeredAt" DESC, "id" DESC LIMIT 20`).map(r => Number(r.id));
    const rows = ids.length ? (await prisma.docRecord.findMany({ where: { id: { in: ids } }, orderBy: [{ registeredAt: 'desc' }, { id: 'desc' }] })).filter(d => V.canLink(d, s) && visible(d, s)) : [];
    const depts = Object.fromEntries((await prisma.department.findMany({ where: { id: { in: rows.map(d => d.departmentId).filter(Boolean) } }, select: { id: true, name: true } })).map(x => [x.id, x.name]));
    const entityName = code => s.cfg.entities.find(e => e.code === code)?.name || null;
    res.json(rows.map(d => ({
      id: d.id, number: d.number, title: d.title, book: out(V.BOOKS, d.book), security: out(V.SECURITY, d.security),
      docDate: d.docDate || WK.dayOf(d.registeredAt), issuer: V.issuerOf(d, { entityName: entityName(d.entity), deptName: depts[d.departmentId] || null }),
    })));
  });

  app.get('/api/vanthu/docs/:id', auth, async (req, res) => {
    const s = await subject(req);
    const d = await load(req.params.id, s);
    const [events, files] = await Promise.all([prisma.docEvent.findMany({ where: { docId: d.id }, orderBy: { createdAt: 'asc' } }), prisma.docFile.findMany({ where: { docId: d.id }, orderBy: { createdAt: 'asc' } })]);
    const names = await WD.userNames(prisma, [...events.map(e => e.userId), ...files.map(f => f.uploadedById), d.handlerId, d.createdById]);
    res.json({ ...(await docOut(d, s)), files: files.map(f => fileOut(f, names)), events: events.map(e => ({ ...e, user: e.userId ? names[e.userId] || null : null })) });
  });

  // ---- Sổ nội bộ: tạo DỰ THẢO (chưa có số). Ai tạo được: như vào sổ trên giao diện (Văn thư, Ban TGĐ; D7: lãnh đạo bộ phận đó).
  // Cấp xem không vượt vai người tạo. file (tuỳ chọn): PDF kèm theo, lưu sau khi có id (tên tệp trên NAS cần id dự thảo).
  const noiboFields = async (b, s, cur = {}) => {
    const data = {};
    if (b.title !== undefined || !cur.id) data.title = text(b.title, 'Trích yếu', { required: true, max: 500 });
    if (b.docType !== undefined || !cur.id) data.docType = oneOf(String(b.docType || ''), Object.keys(V.NOIBO_TYPES), 'Loại tài liệu');
    if (b.viewLevel !== undefined || !cur.id) {
      data.viewLevel = oneOf(String(b.viewLevel || 'ALL'), Object.keys(V.VIEW_LEVELS), 'Cấp xem');
      if (!V.levelOk(data.viewLevel, s)) fail(403, 'Cấp xem không được cao hơn vai của bạn', 'FORBIDDEN');
    }
    if (b.docCode !== undefined) data.docCode = text(b.docCode, 'Mã tài liệu', { max: 40 }) || null;
    if (b.effectiveDate !== undefined) data.effectiveDate = day(b.effectiveDate);
    if (b.docDate !== undefined) data.docDate = day(b.docDate); // ngày ban hành gốc — văn bản có từ trước khi đưa vào Hub
    if (b.note !== undefined) data.note = text(b.note, 'Ghi chú', { max: 1000 }) || null;
    if (b.replacesId !== undefined) {
      const rid = optionalInt(b.replacesId, 'Văn bản được thay thế');
      if (rid != null) {
        const old = await prisma.docRecord.findUnique({ where: { id: rid } });
        if (!old || old.book !== 'NOIBO' || V.isDraft(old) || old.cancelledAt || old.id === cur.id || !visible(old, s)) fail(422, 'Văn bản được thay thế không hợp lệ (phải là tài liệu nội bộ đã phê duyệt, bạn xem được)', 'INVALID_VALUE');
      }
      data.replacesId = rid;
    }
    return data;
  };
  async function createDraft(req, s, b, { seriesIn, entity, dept }, file = null) {
    const fields = await noiboFields(b, s);
    const year = Number(WK.dayOf(new Date()).slice(0, 4));
    const doc = await prisma.$transaction(async tx => {
      const created = await tx.docRecord.create({ data: {
        book: 'NOIBO', series: V.seriesKey(seriesIn, dept?.code), entity, year, seq: null, number: null, security: V.legacySecurity('DRAFT', fields.viewLevel), status: 'DRAFT',
        departmentId: dept?.id ?? null, viaAi: !!s.ai, createdById: req.user.id, ...fields,
      } });
      await tx.docEvent.create({ data: { docId: created.id, userId: req.user.id, action: 'CREATE', toValue: 'DRAFT', note: s.ai ? 'Tạo qua Claude' : null } });
      await audit(req, 'CREATE', 'DocRecord', created.id, null, { book: 'NOIBO', draft: true, viewLevel: created.viewLevel, viaAi: !!s.ai }, tx);
      return created;
    });
    if (file) {
      try { await attachFiles(req, doc, [file]); }
      catch (error) { await prisma.docRecord.delete({ where: { id: doc.id } }).catch(() => {}); throw error; } // dự thảo chưa có số: xoá được, không để dự thảo thiếu tệp
    }
    const to = (await approverIds(s.cfg)).filter(id => id !== req.user.id);
    if (to.length) await notify(prisma, to, { type: 'DOC_APPROVAL', title: `Tài liệu chờ phê duyệt: ${doc.title.slice(0, 120)}`, body: `${V.NOIBO_TYPES[doc.docType] || ''} · ${V.VIEW_LEVELS[doc.viewLevel]}${s.ai ? ' · tạo qua Claude' : ''}`, link: `#/vanthu/${doc.id}` }, req.user.id);
    return doc;
  }

  // Claude (token, phạm vi ghi): tạo dự thảo kèm MỘT tệp PDF (multipart: các trường như form + "file"). Không cấp số, không phê duyệt.
  // Kiểm quyền thô TRƯỚC khi nhận tệp (có được tạo dự thảo ở dãy nào không), kiểm đủ sau khi đọc trường.
  const draftUpload = multer({ dest: nodePath.join(config.uploadTmpDir, 'workhub-upload'), limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
  app.post('/api/vanthu/drafts', auth, async (req, res, next) => {
    const s = await subject(req);
    if (!(['D5', 'D6'].some(k => V.canRegister(s, k)) || V.canRegister(s, 'D7', s.departmentId))) fail(403, 'Chỉ Văn thư, Ban TGĐ hoặc lãnh đạo bộ phận tạo dự thảo tài liệu nội bộ', 'FORBIDDEN');
    req.vt = { s };
    next();
  }, draftUpload.single('file'), async (req, res) => {
    const file = req.file;
    try {
      const { s } = req.vt, b = req.body || {};
      if (!file) fail(422, 'Thiếu tệp PDF của dự thảo', 'PDF_REQUIRED');
      const seriesIn = oneOf(String(b.series || ''), ['D5', 'D6', 'D7'], 'Dãy số');
      const entity = String(b.entity || '');
      if (!s.cfg.entities.some(e => e.code === entity)) fail(422, 'Pháp nhân không hợp lệ', 'INVALID_VALUE');
      const dept = await deptOk(optionalInt(b.departmentId, 'Bộ phận'));
      if (seriesIn === 'D7' && !dept) fail(422, 'Văn bản nội bộ của bộ phận cần chọn bộ phận', 'REQUIRED');
      if (!V.canRegister(s, seriesIn, dept?.id ?? null)) fail(403, 'Bạn không tạo được dự thảo ở dãy này', 'FORBIDDEN');
      const doc = await createDraft(req, s, b, { seriesIn, entity, dept }, file);
      res.status(201).json(await docOut(doc, s));
    } finally { if (file) await fsp.rm(file.path, { force: true }).catch(() => {}); }
  });

  app.post('/api/vanthu/docs', auth, async (req, res) => {
    const s = await subject(req);
    if (s.ai) fail(403, 'Vào sổ văn bản làm trên giao diện', 'FORBIDDEN');
    const b = req.body || {};
    const seriesIn = oneOf(String(b.series || ''), Object.keys(V.SERIES), 'Dãy số');
    const book = V.SERIES[seriesIn].book;
    const entity = String(b.entity || '');
    if (!s.cfg.entities.some(e => e.code === entity)) fail(422, 'Pháp nhân không hợp lệ', 'INVALID_VALUE');
    const dept = await deptOk(optionalInt(b.departmentId, 'Bộ phận'));
    if (seriesIn === 'D7' && !dept) fail(422, 'Văn bản nội bộ của bộ phận cần chọn bộ phận', 'REQUIRED');
    if (!V.canRegister(s, seriesIn, dept?.id ?? null)) fail(403, seriesIn === 'D7' ? 'Chỉ văn thư, Ban TGĐ hoặc lãnh đạo bộ phận đó cấp số văn bản của bộ phận' : 'Chỉ văn thư (do Ban TGĐ chỉ định) hoặc Ban TGĐ vào sổ văn bản', 'FORBIDDEN');
    if (book === 'NOIBO') return res.status(201).json(await docOut(await createDraft(req, s, b, { seriesIn, entity, dept }), s));
    const docType = text(b.docType, 'Tên loại', { max: 6 }) || null;
    if (docType && !/^[A-ZĐa-zđ]{2,6}$/.test(docType)) fail(422, 'Tên loại viết tắt 2–6 chữ (vd. CV, TB, QĐ, TTr)', 'INVALID_VALUE');
    const handler = await userOk(optionalInt(b.handlerId, 'Người xử lý'), 'Người xử lý');
    const security = oneOf(b.security || 'NOI_BO', Object.keys(V.SECURITY), 'Mức bảo mật');
    const urgency = oneOf(b.urgency || 'THUONG', Object.keys(V.URGENCY), 'Độ khẩn');
    const viewerIds = Array.isArray(b.viewerIds) ? [...new Set(b.viewerIds.map(Number).filter(Number.isInteger))].slice(0, 50) : [];
    if (security === 'BAO_MAT_CAO' && !s.director && viewerIds.length) fail(403, 'Danh sách được xem văn bản Bảo mật cao do TGĐ / Chủ tịch duyệt — Ban TGĐ nhập', 'FORBIDDEN');
    const today = WK.dayOf(new Date());
    const year = Number(today.slice(0, 4));
    const series = V.seriesKey(seriesIn, dept?.code);
    const dueDate = day(b.dueDate) || (book === 'DEN' ? V.dueFor(urgency, today, await workCfg()) : null);
    const legalIds = b.toLegal ? s.cfg.legalUserIds : [];
    const doc = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK}::int, ${hash32(`${series}|${entity}|${year}`)}::int)`;
      const last = await tx.docRecord.findFirst({ where: { series, entity, year }, orderBy: { seq: 'desc' }, select: { seq: true } });
      const seq = (last?.seq || 0) + 1;
      const number = V.numberOf({ series, entity, year, seq, docType, deptCode: dept?.code, holding: entity === s.cfg.entities[0].code });
      const status = book === 'DEN' && handler ? 'ASSIGNED' : V.FIRST[book];
      const created = await tx.docRecord.create({ data: {
        book, series, entity, year, seq, number, docType, title: text(b.title, 'Trích yếu', { required: true, max: 500 }),
        counterpart: text(b.counterpart, book === 'DEN' ? 'Nơi gửi' : 'Nơi nhận', { max: 300 }) || null,
        externalNumber: text(b.externalNumber, 'Số của bên gửi', { max: 80 }) || null, docDate: day(b.docDate),
        security, urgency, dueDate, status, handlerId: handler?.id ?? null, departmentId: dept?.id ?? handler?.departmentId ?? null,
        signerName: text(b.signerName, 'Người ký', { max: 120 }) || null, channel: text(b.channel, 'Kênh', { max: 60 }) || null,
        trackingCode: text(b.trackingCode, 'Mã vận đơn', { max: 60 }) || null, toLegal: !!b.toLegal, viewerIds,
        note: text(b.note, 'Ghi chú', { max: 1000 }) || null, createdById: req.user.id,
      } });
      await tx.docEvent.create({ data: { docId: created.id, userId: req.user.id, action: 'CREATE', toValue: status } });
      await audit(req, 'CREATE', 'DocRecord', created.id, null, { number, book, security }, tx);
      const link = `#/vanthu/${created.id}`;
      if (handler) await notify(tx, [handler.id], { type: 'DOC_ASSIGNED', title: `Văn bản ${number} giao bạn xử lý${dueDate ? ` · hạn ${WK.fmtDY(dueDate)}` : ''}`, body: created.title.slice(0, 200), link }, req.user.id);
      if (legalIds.length) await notify(tx, legalIds, { type: 'DOC_LEGAL', title: `Văn bản ${number} có thời hạn pháp lý — chuyển Pháp chế`, body: created.title.slice(0, 200), link }, req.user.id);
      return created;
    });
    res.status(201).json(await docOut(doc, s));
  });

  app.patch('/api/vanthu/docs/:id', auth, async (req, res) => {
    const s = await subject(req);
    const d = await load(req.params.id, s);
    if (d.book === 'NOIBO') return res.json(await docOut(await patchNoibo(req, s, d), s));
    if (s.ai || d.cancelledAt || !(s.director || s.clerk)) fail(403, 'Chỉ văn thư hoặc Ban TGĐ sửa thông tin vào sổ', 'FORBIDDEN');
    const b = req.body || {}, data = {};
    if (b.title !== undefined) data.title = text(b.title, 'Trích yếu', { required: true, max: 500 });
    for (const [k, label, max] of [['counterpart', 'Nơi gửi / nhận', 300], ['externalNumber', 'Số của bên gửi', 80], ['signerName', 'Người ký', 120], ['channel', 'Kênh', 60], ['trackingCode', 'Mã vận đơn', 60], ['note', 'Ghi chú', 1000]])
      if (b[k] !== undefined) data[k] = text(b[k], label, { max }) || null;
    if (b.docDate !== undefined) data.docDate = day(b.docDate);
    if (b.dueDate !== undefined) data.dueDate = day(b.dueDate);
    if (b.security !== undefined) data.security = oneOf(b.security, Object.keys(V.SECURITY), 'Mức bảo mật');
    if (b.urgency !== undefined) data.urgency = oneOf(b.urgency, Object.keys(V.URGENCY), 'Độ khẩn');
    if (b.toLegal !== undefined) data.toLegal = !!b.toLegal;
    if (b.viewerIds !== undefined) {
      if (!s.director) fail(403, 'Danh sách được xem văn bản Bảo mật cao do Ban TGĐ nhập', 'FORBIDDEN');
      data.viewerIds = Array.isArray(b.viewerIds) ? [...new Set(b.viewerIds.map(Number).filter(Number.isInteger))].slice(0, 50) : [];
    }
    let handler = null;
    if (b.handlerId !== undefined) {
      handler = await userOk(optionalInt(b.handlerId, 'Người xử lý'), 'Người xử lý');
      data.handlerId = handler?.id ?? null;
      if (handler && b.departmentId === undefined) data.departmentId = handler.departmentId ?? d.departmentId;
      if (handler && d.book === 'DEN' && ['RECEIVED', 'SUBMITTED'].includes(d.status)) data.status = 'ASSIGNED';
    }
    if (b.departmentId !== undefined) data.departmentId = (await deptOk(optionalInt(b.departmentId, 'Bộ phận')))?.id ?? null;
    const updated = await prisma.$transaction(async tx => {
      const u = await tx.docRecord.update({ where: { id: d.id }, data });
      if (handler && handler.id !== d.handlerId) {
        await tx.docEvent.create({ data: { docId: d.id, userId: req.user.id, action: 'ASSIGN', fromValue: d.handlerId ? String(d.handlerId) : null, toValue: String(handler.id) } });
        await notify(tx, [handler.id], { type: 'DOC_ASSIGNED', title: `Văn bản ${d.number} giao bạn xử lý${u.dueDate ? ` · hạn ${WK.fmtDY(u.dueDate)}` : ''}`, body: u.title.slice(0, 200), link: `#/vanthu/${d.id}` }, req.user.id);
      } else await tx.docEvent.create({ data: { docId: d.id, userId: req.user.id, action: 'UPDATE', toValue: Object.keys(data).join(', ').slice(0, 200) } });
      if (data.toLegal && !d.toLegal && s.cfg.legalUserIds.length) await notify(tx, s.cfg.legalUserIds, { type: 'DOC_LEGAL', title: `Văn bản ${d.number} có thời hạn pháp lý — chuyển Pháp chế`, body: u.title.slice(0, 200), link: `#/vanthu/${d.id}` }, req.user.id);
      await audit(req, 'UPDATE', 'DocRecord', d.id, null, { fields: Object.keys(data) }, tx);
      return u;
    });
    res.json(await docOut(updated, s));
  });

  // Sổ nội bộ: dự thảo sửa được (người soạn / Văn thư) mọi trường metadata; đã phê duyệt: khoá nội dung, Văn thư / Ban TGĐ chỉ sửa
  // ghi chú, cấp xem (không vượt vai mình) và ngày hiệu lực khi chưa hiệu lực. Đổi nội dung → tạo bản mới "thay thế".
  async function patchNoibo(req, s, d) {
    const b = req.body || {};
    if (V.isDraft(d)) {
      if (!V.canEditDraft(d, s)) fail(403, 'Chỉ người soạn hoặc Văn thư sửa dự thảo', 'FORBIDDEN');
    } else {
      if (s.ai || d.cancelledAt || !(s.director || s.clerk)) fail(403, 'Chỉ Văn thư hoặc Ban TGĐ sửa thông tin tài liệu đã phê duyệt', 'FORBIDDEN');
      const locked = Object.keys(b).filter(k => !['note', 'viewLevel', 'effectiveDate'].includes(k));
      if (locked.length) fail(422, 'Tài liệu đã phê duyệt: không sửa nội dung — tạo bản mới, chọn "Thay thế văn bản"', 'LOCKED');
      if (b.effectiveDate !== undefined && d.status !== 'APPROVED') fail(422, 'Tài liệu đã hiệu lực: không đổi ngày hiệu lực', 'LOCKED');
    }
    const data = await noiboFields(b, s, d);
    const levelChanged = data.viewLevel !== undefined && data.viewLevel !== d.viewLevel;
    if (data.viewLevel !== undefined) data.security = V.legacySecurity(d.status, data.viewLevel);
    return prisma.$transaction(async tx => {
      const u = await tx.docRecord.update({ where: { id: d.id }, data });
      await tx.docEvent.create({ data: { docId: d.id, userId: req.user.id, action: 'UPDATE', fromValue: levelChanged ? d.viewLevel : null,
        toValue: ((levelChanged ? `cấp xem ${data.viewLevel}; ` : '') + Object.keys(data).join(', ')).slice(0, 200) } });
      await audit(req, 'UPDATE', 'DocRecord', d.id, null, { fields: Object.keys(data), ...(levelChanged ? { viewLevel: [d.viewLevel, data.viewLevel] } : {}) }, tx);
      return u;
    });
  }

  // ---- Phê duyệt (chỉ Người phê duyệt, trên giao diện): cấp số ngay lúc bấm, cùng khoá chống trùng số với vào sổ; ghi mã băm SHA-256
  // của từng tệp vào nhật ký (chứng minh đúng bản PDF đó được duyệt, thay cho ký số). Ngày hiệu lực trống / đã qua → Hiệu lực ngay.
  app.post('/api/vanthu/docs/:id/approve', auth, async (req, res) => {
    const s = await subject(req);
    const d = await load(req.params.id, s);
    const files = await prisma.docFile.findMany({ where: { docId: d.id }, orderBy: { createdAt: 'asc' } });
    const e = V.approveCheck(d, s, files);
    if (e) fail(...e);
    const note = text(req.body?.note, 'Ý kiến', { max: 500 }) || null;
    const now = new Date(), today = WK.dayOf(now), year = Number(today.slice(0, 4));
    const status = V.statusOnApprove(d.effectiveDate, today);
    const hashes = files.map(f => ({ name: f.fileName, sha256: f.checksum }));
    const u = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK}::int, ${hash32(`${d.series}|${d.entity}|${year}`)}::int)`;
      const last = await tx.docRecord.findFirst({ where: { series: d.series, entity: d.entity, year, seq: { not: null } }, orderBy: { seq: 'desc' }, select: { seq: true } });
      const seq = (last?.seq || 0) + 1;
      const number = V.numberOf({ series: d.series, entity: d.entity, year, seq, docType: d.docType, holding: d.entity === s.cfg.entities[0].code });
      // Chỉ dự thảo còn chờ (chưa số, chưa huỷ): hai người bấm cùng lúc → người sau nhận 409, không cấp hai số.
      const r = await tx.docRecord.updateMany({ where: { id: d.id, status: 'DRAFT', number: null, cancelledAt: null }, data: { year, seq, number, status, security: V.legacySecurity(status, d.viewLevel), approvedById: req.user.id, approvedAt: now, registeredAt: now } });
      if (r.count !== 1) fail(409, 'Tài liệu vừa được xử lý ở nơi khác — tải lại trang', 'CONFLICT');
      await tx.docEvent.create({ data: { docId: d.id, userId: req.user.id, action: 'APPROVE', fromValue: 'DRAFT', toValue: status,
        note: [`Số ${number}`, note, ...hashes.map(h => `${h.name} · SHA-256 ${h.sha256}`)].filter(Boolean).join('\n').slice(0, 2000) } });
      await audit(req, 'APPROVE', 'DocRecord', d.id, { status: 'DRAFT' }, { number, status, files: hashes }, tx);
      // Bản cũ được thay thế → Hết hiệu lực / thay thế.
      if (d.replacesId) {
        const old = await tx.docRecord.findUnique({ where: { id: d.replacesId } });
        if (old && !old.cancelledAt && old.status !== 'EXPIRED' && !V.isDraft(old)) {
          await tx.docRecord.update({ where: { id: old.id }, data: { status: 'EXPIRED' } });
          await tx.docEvent.create({ data: { docId: old.id, userId: req.user.id, action: 'STATUS', fromValue: old.status, toValue: 'EXPIRED', note: `Thay thế bởi ${number}` } });
        }
      }
      if (d.createdById !== req.user.id) await notify(tx, [d.createdById], { type: 'DOC_APPROVED', title: `Tài liệu đã được phê duyệt: ${number}`, body: d.title.slice(0, 200), link: `#/vanthu/${d.id}` }, req.user.id);
      return tx.docRecord.findUnique({ where: { id: d.id } });
    });
    res.json(await docOut(u, s));
  });
  // Trả lại (chỉ Người phê duyệt): bắt buộc lý do; người soạn sửa rồi "Gửi lại".
  app.post('/api/vanthu/docs/:id/return', auth, async (req, res) => {
    const s = await subject(req);
    const d = await load(req.params.id, s);
    const e = V.returnCheck(d, s);
    if (e) fail(...e);
    const reason = text(req.body?.reason, 'Lý do trả lại', { required: true, max: 500 });
    const u = await prisma.$transaction(async tx => {
      const r = await tx.docRecord.updateMany({ where: { id: d.id, status: 'DRAFT', cancelledAt: null }, data: { status: 'RETURNED', security: V.legacySecurity('RETURNED', d.viewLevel) } });
      if (r.count !== 1) fail(409, 'Tài liệu vừa được xử lý ở nơi khác — tải lại trang', 'CONFLICT');
      await tx.docEvent.create({ data: { docId: d.id, userId: req.user.id, action: 'RETURN', fromValue: 'DRAFT', toValue: 'RETURNED', note: reason } });
      await audit(req, 'RETURN', 'DocRecord', d.id, null, { reason }, tx);
      if (d.createdById !== req.user.id) await notify(tx, [d.createdById], { type: 'DOC_RETURNED', title: `Tài liệu bị trả lại: ${d.title.slice(0, 120)}`, body: reason.slice(0, 200), link: `#/vanthu/${d.id}` }, req.user.id);
      return tx.docRecord.findUnique({ where: { id: d.id } });
    });
    res.json(await docOut(u, s));
  });
  // Gửi lại sau khi sửa (người soạn / Văn thư).
  app.post('/api/vanthu/docs/:id/resubmit', auth, async (req, res) => {
    const s = await subject(req);
    const d = await load(req.params.id, s);
    if (d.status !== 'RETURNED' || !V.canEditDraft(d, s)) fail(403, 'Chỉ người soạn hoặc Văn thư gửi lại dự thảo đã bị trả lại', 'FORBIDDEN');
    const note = text(req.body?.note, 'Ghi chú', { max: 500 }) || null;
    const u = await prisma.$transaction(async tx => {
      const r = await tx.docRecord.updateMany({ where: { id: d.id, status: 'RETURNED', cancelledAt: null }, data: { status: 'DRAFT', security: V.legacySecurity('DRAFT', d.viewLevel) } });
      if (r.count !== 1) fail(409, 'Tài liệu vừa được xử lý ở nơi khác — tải lại trang', 'CONFLICT');
      await tx.docEvent.create({ data: { docId: d.id, userId: req.user.id, action: 'RESUBMIT', fromValue: 'RETURNED', toValue: 'DRAFT', note } });
      await audit(req, 'RESUBMIT', 'DocRecord', d.id, null, null, tx);
      return tx.docRecord.findUnique({ where: { id: d.id } });
    });
    const to = (await approverIds(s.cfg)).filter(id => id !== req.user.id);
    if (to.length) await notify(prisma, to, { type: 'DOC_APPROVAL', title: `Tài liệu gửi lại chờ phê duyệt: ${d.title.slice(0, 120)}`, body: note || '', link: `#/vanthu/${d.id}` }, req.user.id);
    res.json(await docOut(u, s));
  });

  app.post('/api/vanthu/docs/:id/status', auth, async (req, res) => {
    const s = await subject(req);
    const d = await load(req.params.id, s);
    const to = oneOf(String(req.body?.to || ''), Object.keys(V.STATUS[d.book]), 'Trạng thái');
    if (s.ai || !V.canStatus(d, s, to)) fail(403, 'Bạn không đổi được trạng thái này', 'FORBIDDEN');
    // Sổ nội bộ: dự thảo chỉ đi qua Phê duyệt / Trả lại; sau phê duyệt chỉ đánh dấu Hiệu lực / Hết hiệu lực.
    if (d.book === 'NOIBO' && !(V.NOIBO_MANUAL[d.status] || []).includes(to)) fail(422, V.isDraft(d) ? 'Dự thảo chỉ đổi trạng thái qua Phê duyệt / Trả lại' : 'Trạng thái chỉ đi tiếp, không quay lại', 'INVALID_STATUS');
    const order = Object.keys(V.STATUS[d.book]);
    if (order.indexOf(to) <= order.indexOf(d.status)) fail(422, 'Trạng thái chỉ đi tiếp, không quay lại', 'INVALID_STATUS');
    const note = text(req.body?.note, 'Ghi chú', { max: 500 }) || null;
    const u = await prisma.$transaction(async tx => {
      const r = await tx.docRecord.update({ where: { id: d.id }, data: { status: to } });
      await tx.docEvent.create({ data: { docId: d.id, userId: req.user.id, action: 'STATUS', fromValue: d.status, toValue: to, note } });
      // Người xử lý báo xong → văn thư lập hồ sơ (Điều 10, 11).
      if (to === 'DONE' && !(s.clerk || s.director) && s.cfg.clerkUserIds.length)
        await notify(tx, s.cfg.clerkUserIds, { type: 'DOC_DONE', title: `Văn bản ${d.number} đã xử lý xong — lập hồ sơ`, body: d.title.slice(0, 200), link: `#/vanthu/${d.id}` }, req.user.id);
      return r;
    });
    res.json(await docOut(u, s));
  });

  app.post('/api/vanthu/docs/:id/cancel', auth, async (req, res) => {
    const s = await subject(req);
    const d = await load(req.params.id, s);
    // Dự thảo (chưa có số): người soạn / Văn thư huỷ — không mất số. Có số: Văn thư / Ban TGĐ huỷ số như cũ.
    const draft = d.book === 'NOIBO' && V.isDraft(d);
    if (draft ? !V.canEditDraft(d, s) : (s.ai || d.cancelledAt || !(s.director || s.clerk))) fail(403, draft ? 'Chỉ người soạn hoặc Văn thư huỷ dự thảo' : 'Chỉ văn thư hoặc Ban TGĐ hủy số', 'FORBIDDEN');
    const reason = text(req.body?.reason, 'Lý do hủy', { required: true, max: 300 });
    // Điều 7.1.5: giữ nguyên số trong sổ, ghi "Hủy – lý do – người xác nhận"; số không cấp lại.
    const u = await prisma.$transaction(async tx => {
      const r = await tx.docRecord.update({ where: { id: d.id }, data: { cancelledAt: new Date(), cancelReason: reason, cancelledById: req.user.id } });
      await tx.docEvent.create({ data: { docId: d.id, userId: req.user.id, action: 'CANCEL', note: reason } });
      await audit(req, 'CANCEL', 'DocRecord', d.id, null, { number: d.number, reason }, tx);
      return r;
    });
    res.json(await docOut(u, s));
  });

  // Tệp văn bản: bản gốc vào thư mục văn thư của phòng trên NAS (lib/vanthu-files.js); phòng chưa có thư mục sổ → lưu trong Hub.
  const upload = multer({ dest: nodePath.join(config.uploadTmpDir, 'workhub-upload'), limits: { fileSize: MAX_FILE_BYTES, files: 5 } });
  app.post('/api/vanthu/docs/:id/files', auth, async (req, res, next) => {
    const s = await subject(req);
    const d = await load(req.params.id, s);
    if (!canUpload(d, s)) fail(403, d.book === 'NOIBO' ? (V.isDraft(d) ? 'Chỉ người soạn hoặc Văn thư thêm tệp cho dự thảo' : 'Tài liệu đã phê duyệt: không thêm tệp — tạo bản mới thay thế') : 'Chỉ văn thư, Ban TGĐ, người xử lý hoặc lãnh đạo bộ phận xử lý tải tệp văn bản', 'FORBIDDEN');
    req.vt = { d }; // kiểm tra quyền TRƯỚC khi nhận tệp
    next();
  }, upload.array('files', 5), async (req, res) => {
    const files = req.files || [];
    try {
      if (!files.length) fail(400, 'Chưa chọn tệp', 'REQUIRED');
      const rows = await attachFiles(req, req.vt.d, files);
      res.status(201).json(rows.map(f => fileOut(f, { [req.user.id]: req.user.fullName })));
    } finally {
      await Promise.allSettled(files.map(f => fsp.rm(f.path, { force: true })));
    }
  });
  // Lưu tệp (multer) vào thư mục văn thư của bộ phận trên NAS (chưa có thư mục sổ → trong Hub) và ghi DocFile + nhật ký.
  // Dự thảo sổ nội bộ chưa có số: tên tệp trên NAS dùng "DuThao-<id>". Dự thảo tạo qua Claude chỉ nhận PDF.
  async function attachFiles(req, d, files) {
    const saved = [];
    try {
      const deptCode = d.departmentId ? (await prisma.department.findUnique({ where: { id: d.departmentId }, select: { code: true } }))?.code ?? null : null;
      for (const file of files) {
        const fileName = downloadName(file.originalname);
        const mimeType = await verifyUpload(fileName, file.path);
        if (d.viaAi && mimeType !== 'application/pdf') fail(422, 'Dự thảo tạo qua Claude chỉ nhận tệp PDF', 'PDF_REQUIRED');
        const buffer = await fsp.readFile(file.path);
        const named = { ...d, number: d.number || `DuThao-${d.id}` };
        const stored = storage.saveToVanthu({ doc: named, deptCode, fileName }, buffer) || await storage.save(fileName, buffer, `vanthu/${d.year}/${d.id}`);
        saved.push({ fileName, mimeType, stored });
      }
      return await prisma.$transaction(async tx => {
        const out = [];
        for (const x of saved) out.push(await tx.docFile.create({ data: { docId: d.id, fileName: x.fileName, objectKey: x.stored.objectKey, mimeType: x.mimeType, sizeBytes: x.stored.size, checksum: x.stored.checksum, uploadedById: req.user.id } }));
        await tx.docEvent.create({ data: { docId: d.id, userId: req.user.id, action: 'FILE', note: out.map(f => f.fileName).join(', ').slice(0, 500) } });
        await audit(req, 'UPLOAD', 'DocFile', out.map(f => f.id).join(','), null, { docId: d.id, number: d.number, files: out.map(f => ({ name: f.fileName, sha256: f.checksum })) }, tx);
        return out;
      });
    } catch (error) {
      await Promise.allSettled(saved.map(x => storage.discard(x.stored.objectKey)));
      throw error;
    }
  }

  const fileFor = async (req, s) => {
    const f = await prisma.docFile.findUnique({ where: { id: intParam(req.params.fid) } });
    if (!f) fail(404, 'Không tìm thấy tệp', 'NOT_FOUND');
    return { f, d: await load(f.docId, s) }; // quyền xem tệp = quyền xem văn bản
  };
  app.get('/api/vanthu/files/:fid/download', auth, async (req, res) => {
    assertNotVia(req); // Claude (token) không tải nội dung tệp
    const s = await subject(req);
    const { f, d } = await fileFor(req, s);
    if (!(await storage.stat(f.objectKey))) fail(404, 'Tệp không còn trong kho lưu trữ', 'NOT_FOUND');
    res.setHeader('Content-Type', (typeOf(f.fileName) || {}).mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition('attachment', f.fileName));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    await audit(req, 'DOWNLOAD', 'DocFile', f.id, null, { docId: d.id, number: d.number, fileName: f.fileName });
    const stream = await storage.getStream(f.objectKey);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
  app.delete('/api/vanthu/files/:fid', auth, async (req, res) => {
    const s = await subject(req);
    const { f, d } = await fileFor(req, s);
    if (d.book === 'NOIBO' ? !V.canEditDraft(d, s) : (s.ai || !(s.director || s.clerk))) fail(403, d.book === 'NOIBO' ? 'Chỉ gỡ tệp của dự thảo (người soạn hoặc Văn thư); tài liệu đã phê duyệt khoá tệp' : 'Chỉ văn thư hoặc Ban TGĐ gỡ tệp văn bản', 'FORBIDDEN');
    await prisma.$transaction(async tx => {
      await tx.docFile.delete({ where: { id: f.id } });
      await tx.docEvent.create({ data: { docId: d.id, userId: req.user.id, action: 'FILE_DELETED', note: f.fileName.slice(0, 500) } });
      await audit(req, 'DELETE', 'DocFile', f.id, { fileName: f.fileName, objectKey: f.objectKey }, null, tx);
    });
    // Tệp trên NAS chuyển vào _LuuTru của thư mục sổ, không xoá hẳn.
    await storage.remove(f.objectKey).catch(error => audit(req, 'DELETE_STORAGE_ERROR', 'DocFile', f.id, null, { objectKey: f.objectKey, error: error.message }));
    res.json({ ok: true });
  });

  // Thiết lập: pháp nhân (mã + tên), văn thư, Pháp chế — Ban TGĐ chỉ định (không suy từ bộ phận, tránh tự nâng quyền).
  app.put('/api/vanthu/config', auth, async (req, res) => {
    const s = await subject(req);
    if (s.ai || !s.director) fail(403, 'Chỉ Ban TGĐ thiết lập văn thư', 'FORBIDDEN');
    const b = req.body || {}, cur = s.cfg;
    const ids = async (v, label) => {
      if (v === undefined) return undefined;
      const list = [...new Set((Array.isArray(v) ? v : []).map(Number).filter(Number.isInteger))].slice(0, 30);
      const ok = await prisma.user.count({ where: { id: { in: list }, ...ACTIVE_USER } });
      if (ok !== list.length) fail(422, label + ' có tài khoản không hợp lệ', 'INVALID_USER');
      return list;
    };
    let entities;
    if (b.entities !== undefined) {
      entities = (Array.isArray(b.entities) ? b.entities : []).map(e => ({ code: String(e?.code || '').trim().toUpperCase(), name: String(e?.name || '').trim().slice(0, 120) }));
      if (!entities.length || entities.some(e => !/^[A-Z]{2,6}$/.test(e.code) || !e.name)) fail(422, 'Pháp nhân: mã 2–6 chữ in hoa (vd. HLD, DXA) và tên', 'INVALID_VALUE');
      if (new Set(entities.map(e => e.code)).size !== entities.length) fail(422, 'Mã pháp nhân bị trùng', 'INVALID_VALUE');
    }
    // Người phê duyệt tài liệu nội bộ: chỉ chọn được tài khoản vai Ban TGĐ (đề xuất 9.1).
    let approverUserIds = cur.approverUserIds;
    if (b.approverUserIds !== undefined) {
      approverUserIds = [...new Set((Array.isArray(b.approverUserIds) ? b.approverUserIds : []).map(Number).filter(Number.isInteger))].slice(0, 10);
      if ((await prisma.user.count({ where: { id: { in: approverUserIds }, isActive: true, ...BOARD_WHERE } })) !== approverUserIds.length) fail(422, 'Người phê duyệt phải là tài khoản vai Ban Tổng Giám đốc đang hoạt động', 'INVALID_USER');
    }
    const value = { entities: entities ?? cur.entities, clerkUserIds: (await ids(b.clerkUserIds, 'Văn thư')) ?? cur.clerkUserIds, legalUserIds: (await ids(b.legalUserIds, 'Pháp chế')) ?? cur.legalUserIds, approverUserIds };
    await prisma.appSetting.upsert({ where: { key: V.CONFIG_KEY }, update: { value, updatedById: req.user.id }, create: { key: V.CONFIG_KEY, value, updatedById: req.user.id } });
    await audit(req, 'UPDATE', 'AppSetting', V.CONFIG_KEY, null, value);
    res.json(value);
  });
};

// Hằng ngày 08:20: văn bản đến sắp đến hạn (hạn = ngày làm việc kế tiếp) hoặc đã quá hạn → người xử lý + lãnh đạo bộ phận xử lý;
// văn bản đến chưa giao ai quá 1 ngày → văn thư. Thứ Hai: tổng hợp văn bản quá hạn gửi Ban TGĐ (Điều 11: báo cáo hằng tuần).
// Tài liệu nội bộ đã phê duyệt, tới ngày hiệu lực → Hiệu lực (chạy cả ngày nghỉ).
async function runNoiboEffective(prisma, today) {
  const due = await prisma.docRecord.findMany({ where: { book: 'NOIBO', status: 'APPROVED', cancelledAt: null, effectiveDate: { not: null, lte: today } }, select: { id: true } });
  for (const d of due) {
    const r = await prisma.docRecord.updateMany({ where: { id: d.id, status: 'APPROVED' }, data: { status: 'EFFECTIVE' } });
    if (r.count) await prisma.docEvent.create({ data: { docId: d.id, userId: null, action: 'STATUS', fromValue: 'APPROVED', toValue: 'EFFECTIVE', note: 'Tới ngày hiệu lực' } });
  }
  return due.length;
}
module.exports.runNoiboEffective = runNoiboEffective;

module.exports.runVanthuReminders = async function runVanthuReminders(prisma, now = new Date()) {
  const today = WK.dayOf(now);
  await runNoiboEffective(prisma, today);
  let cfgW; try { const c = await H.hrmConfig(prisma); cfgW = { workDays: c.workDays, holidays: c.holidays }; } catch { cfgW = { workDays: [1, 2, 3, 4, 5], holidays: [] }; }
  if (!cfgW.workDays.includes(WK.weekday(today)) || cfgW.holidays.includes(today)) return { sent: 0, skipped: 'ngày nghỉ' };
  const next = V.addWorkdays(WK.addDays(today, 1), 0, cfgW);
  const cfg = await V.vanthuConfig(prisma);
  const open = await prisma.docRecord.findMany({ where: { book: 'DEN', cancelledAt: null, status: { notIn: [...V.CLOSED] }, dueDate: { not: null, lte: next } } });
  const leaders = new Map();
  const leadersOf = async deptId => {
    if (!deptId) return [];
    if (!leaders.has(deptId)) leaders.set(deptId, (await prisma.user.findMany({ where: { ...ACTIVE_USER, departmentId: deptId } })).filter(H.isLeader).map(u => u.id));
    return leaders.get(deptId);
  };
  let sent = 0;
  for (const d of open) {
    const overdue = d.dueDate < today;
    const to = d.handlerId ? [d.handlerId, ...(overdue ? await leadersOf(d.departmentId) : [])] : cfg.clerkUserIds;
    sent += await notify(prisma, to, { type: overdue ? 'DOC_OVERDUE' : 'DOC_DUE', title: `Văn bản ${d.number} ${overdue ? `quá hạn xử lý (hạn ${WK.fmtDY(d.dueDate)})` : d.dueDate === today ? 'đến hạn xử lý hôm nay' : `đến hạn ${WK.fmtDY(d.dueDate)}`}${d.handlerId ? '' : ' — chưa giao người xử lý'}`, body: d.title.slice(0, 200), link: `#/vanthu/${d.id}` });
  }
  if (WK.weekday(today) === 1) {
    const overdue = open.filter(d => d.dueDate < today);
    if (overdue.length) {
      const directors = (await prisma.user.findMany({ where: { ...ACTIVE_USER, ...BOARD_WHERE }, select: { id: true } })).map(u => u.id);
      sent += await notify(prisma, directors, { type: 'DOC_WEEKLY', title: `${overdue.length} văn bản đến quá hạn xử lý`, body: overdue.slice(0, 10).map(d => d.number).join(', '), link: '#/vanthu?book=DEN&overdue=1' });
    }
  }
  return { sent, open: open.length };
};

module.exports.textMatch = textMatch;
