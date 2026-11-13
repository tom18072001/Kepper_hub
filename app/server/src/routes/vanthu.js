// Văn thư — sổ văn bản đến (D10), đi (D9), nội bộ (D5–D7) theo "Quy định văn thư, lưu trữ" (QyĐ-GA-01).
// Bật bằng MODULES=vanthu. Cấp số tự động, liên tục theo dãy / pháp nhân / năm; không giữ số, nhảy số, dùng lại số đã hủy (Điều 7.1).
// Văn bản đến: hạn xử lý theo độ khẩn (Điều 12), theo dõi trạng thái (Điều 11), nhắc người xử lý trước hạn 1 ngày và khi quá hạn.
// Quyền xem theo mức bảo mật (Điều 5) — services/vanthu.js canView. Claude (token): chỉ đọc, không thấy văn bản Bảo mật cao.
const { fail, intParam, optionalInt, text, oneOf } = require('../lib/http');
const V = require('../services/vanthu');
const WD = require('../services/weekly-data');
const WK = require('../services/weekly');
const H = require('../services/hrm');
const { notify } = require('../services/events');

const LOCK = 731301; // pg_advisory_xact_lock(LOCK, hash(dãy, pháp nhân, năm)): cấp số tuần tự, không trùng / nhảy số khi vào sổ song song
const ACTIVE_USER = { isActive: true, isRootAdmin: false, role: { not: 'admin' } };
const day = v => (v == null || v === '' ? null : WK.isDay(v) ? v : fail(422, 'Ngày không hợp lệ (YYYY-MM-DD)', 'INVALID_DATE'));
const hash32 = s => { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) | 0; return h; };
const out = (map, v) => (v ? { code: v, label: map[v] || v } : null);

module.exports = function mountVanthu(app, { prisma, auth, audit, config }) {
  if (!(config.modules || []).includes('vanthu')) return;

  const workCfg = async () => { try { const c = await H.hrmConfig(prisma); return { workDays: c.workDays, holidays: c.holidays }; } catch { return { workDays: [1, 2, 3, 4, 5], holidays: [] }; } };
  async function subject(req) {
    const [s, cfg] = await Promise.all([WD.rolesOf(prisma, req.user), V.vanthuConfig(prisma)]);
    return { ...s, clerk: !s.it && cfg.clerkUserIds.includes(req.user.id), legal: !s.it && cfg.legalUserIds.includes(req.user.id), ai: req.via === 'mcp', cfg };
  }
  const visible = (doc, s) => V.canView(doc, s) && !(s.ai && doc.security === 'BAO_MAT_CAO');
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
    users ||= await WD.userNames(prisma, [d.handlerId, d.createdById]);
    depts ||= Object.fromEntries((await prisma.department.findMany({ select: { id: true, name: true } })).map(x => [x.id, x.name]));
    const today = WK.dayOf(new Date());
    return {
      id: d.id, book: out(V.BOOKS, d.book), series: d.series, entity: d.entity, year: d.year, number: d.number, docType: d.docType, title: d.title,
      counterpart: d.counterpart, externalNumber: d.externalNumber, docDate: d.docDate, registeredAt: d.registeredAt,
      security: out(V.SECURITY, d.security), urgency: out(V.URGENCY, d.urgency), dueDate: d.dueDate, overdue: V.isOverdue(d, today),
      status: out(V.STATUS[d.book], d.status), closed: V.CLOSED.has(d.status),
      handler: d.handlerId ? { id: d.handlerId, fullName: users[d.handlerId] || null } : null,
      department: d.departmentId ? { id: d.departmentId, name: depts[d.departmentId] || null } : null,
      signerName: d.signerName, channel: d.channel, trackingCode: d.trackingCode, toLegal: d.toLegal, note: d.note,
      viewerIds: (s.director || s.clerk) && d.security === 'BAO_MAT_CAO' ? d.viewerIds : undefined,
      cancelled: d.cancelledAt ? { at: d.cancelledAt, reason: d.cancelReason } : null,
      createdBy: { id: d.createdById, fullName: users[d.createdById] || null },
      can: { edit: !s.ai && !d.cancelledAt && (s.director || s.clerk), status: (ks => ks.filter((k, i) => i > ks.indexOf(d.status) && !s.ai && V.canStatus(d, s, k)))(Object.keys(V.STATUS[d.book])) }, // chỉ các bước kế tiếp
    };
  }

  app.get('/api/vanthu/meta', auth, async (req, res) => {
    const s = await subject(req);
    const depts = await prisma.department.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } });
    res.json({
      books: V.BOOKS, series: V.SERIES, security: V.SECURITY, urgency: V.URGENCY, status: V.STATUS, docTypes: V.DOC_TYPES, dueWorkdays: V.DUE_WORKDAYS,
      entities: s.cfg.entities, departments: depts,
      me: { clerk: s.clerk, director: s.director, leader: s.leader, departmentId: s.departmentId, it: s.it },
      canRegister: Object.fromEntries(Object.keys(V.SERIES).map(k => [k, !s.ai && V.canRegister(s, k, s.departmentId)])),
      config: s.director ? { clerkUserIds: s.cfg.clerkUserIds, legalUserIds: s.cfg.legalUserIds } : undefined,
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
    if (q.q) { const t = String(q.q).slice(0, 100); where.OR = [{ title: { contains: t, mode: 'insensitive' } }, { number: { contains: t, mode: 'insensitive' } }, { counterpart: { contains: t, mode: 'insensitive' } }, { externalNumber: { contains: t, mode: 'insensitive' } }]; }
    const rows = (await prisma.docRecord.findMany({ where, orderBy: [{ year: 'desc' }, { registeredAt: 'desc' }, { seq: 'desc' }], take: 500 })).filter(d => visible(d, s));
    const today = WK.dayOf(new Date());
    const list = q.overdue === '1' ? rows.filter(d => V.isOverdue(d, today)) : rows;
    const users = await WD.userNames(prisma, list.flatMap(d => [d.handlerId, d.createdById]));
    const depts = Object.fromEntries((await prisma.department.findMany({ select: { id: true, name: true } })).map(x => [x.id, x.name]));
    res.json(await Promise.all(list.map(d => docOut(d, s, { users, depts }))));
  });

  app.get('/api/vanthu/docs/:id', auth, async (req, res) => {
    const s = await subject(req);
    const d = await load(req.params.id, s);
    const events = await prisma.docEvent.findMany({ where: { docId: d.id }, orderBy: { createdAt: 'asc' } });
    const names = await WD.userNames(prisma, [...events.map(e => e.userId), d.handlerId, d.createdById]);
    res.json({ ...(await docOut(d, s)), events: events.map(e => ({ ...e, user: e.userId ? names[e.userId] || null : null })) });
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
    if (!V.canRegister(s, seriesIn, dept?.id ?? null)) fail(403, seriesIn === 'D7' ? 'Chỉ văn thư, Ban GĐ hoặc lãnh đạo bộ phận đó cấp số văn bản của bộ phận' : 'Chỉ văn thư (do Ban GĐ chỉ định) hoặc Ban GĐ vào sổ văn bản', 'FORBIDDEN');
    const docType = text(b.docType, 'Tên loại', { max: 6 }) || null;
    if (docType && !/^[A-ZĐa-zđ]{2,6}$/.test(docType)) fail(422, 'Tên loại viết tắt 2–6 chữ (vd. CV, TB, QĐ, TTr)', 'INVALID_VALUE');
    const handler = await userOk(optionalInt(b.handlerId, 'Người xử lý'), 'Người xử lý');
    const security = oneOf(b.security || 'NOI_BO', Object.keys(V.SECURITY), 'Mức bảo mật');
    const urgency = oneOf(b.urgency || 'THUONG', Object.keys(V.URGENCY), 'Độ khẩn');
    const viewerIds = Array.isArray(b.viewerIds) ? [...new Set(b.viewerIds.map(Number).filter(Number.isInteger))].slice(0, 50) : [];
    if (security === 'BAO_MAT_CAO' && !s.director && viewerIds.length) fail(403, 'Danh sách được xem văn bản Bảo mật cao do TGĐ / Chủ tịch duyệt — Ban GĐ nhập', 'FORBIDDEN');
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
    if (s.ai || d.cancelledAt || !(s.director || s.clerk)) fail(403, 'Chỉ văn thư hoặc Ban GĐ sửa thông tin vào sổ', 'FORBIDDEN');
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
      if (!s.director) fail(403, 'Danh sách được xem văn bản Bảo mật cao do Ban GĐ nhập', 'FORBIDDEN');
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

  app.post('/api/vanthu/docs/:id/status', auth, async (req, res) => {
    const s = await subject(req);
    const d = await load(req.params.id, s);
    const to = oneOf(String(req.body?.to || ''), Object.keys(V.STATUS[d.book]), 'Trạng thái');
    if (s.ai || !V.canStatus(d, s, to)) fail(403, 'Bạn không đổi được trạng thái này', 'FORBIDDEN');
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
    if (s.ai || d.cancelledAt || !(s.director || s.clerk)) fail(403, 'Chỉ văn thư hoặc Ban GĐ hủy số', 'FORBIDDEN');
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

  // Thiết lập: pháp nhân (mã + tên), văn thư, Pháp chế — Ban GĐ chỉ định (không suy từ phòng ban, tránh tự nâng quyền).
  app.put('/api/vanthu/config', auth, async (req, res) => {
    const s = await subject(req);
    if (s.ai || !s.director) fail(403, 'Chỉ Ban GĐ thiết lập văn thư', 'FORBIDDEN');
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
    const value = { entities: entities ?? cur.entities, clerkUserIds: (await ids(b.clerkUserIds, 'Văn thư')) ?? cur.clerkUserIds, legalUserIds: (await ids(b.legalUserIds, 'Pháp chế')) ?? cur.legalUserIds };
    await prisma.appSetting.upsert({ where: { key: V.CONFIG_KEY }, update: { value, updatedById: req.user.id }, create: { key: V.CONFIG_KEY, value, updatedById: req.user.id } });
    await audit(req, 'UPDATE', 'AppSetting', V.CONFIG_KEY, null, value);
    res.json(value);
  });
};

// Hằng ngày 08:20: văn bản đến sắp đến hạn (hạn = ngày làm việc kế tiếp) hoặc đã quá hạn → người xử lý + lãnh đạo bộ phận xử lý;
// văn bản đến chưa giao ai quá 1 ngày → văn thư. Thứ Hai: tổng hợp văn bản quá hạn gửi Ban GĐ (Điều 11: báo cáo hằng tuần).
module.exports.runVanthuReminders = async function runVanthuReminders(prisma, now = new Date()) {
  const today = WK.dayOf(now);
  let cfgW; try { const c = await H.hrmConfig(prisma); cfgW = { workDays: c.workDays, holidays: c.holidays }; } catch { cfgW = { workDays: [1, 2, 3, 4, 5], holidays: [] }; }
  if (!cfgW.workDays.includes(WK.weekday(today)) || cfgW.holidays.includes(today)) return { sent: 0, skipped: 'ngày nghỉ' };
  const next = V.addWorkdays(WK.addDays(today, 1), 0, cfgW);
  const cfg = await V.vanthuConfig(prisma);
  const open = await prisma.docRecord.findMany({ where: { book: 'DEN', cancelledAt: null, status: { notIn: [...V.CLOSED] }, dueDate: { not: null, lte: next } } });
  const leaders = new Map();
  const leadersOf = async deptId => {
    if (!deptId) return [];
    if (!leaders.has(deptId)) leaders.set(deptId, (await prisma.user.findMany({ where: { ...ACTIVE_USER, departmentId: deptId }, include: { permissions: true } })).filter(H.isLeader).map(u => u.id));
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
      const directors = (await prisma.user.findMany({ where: { ...ACTIVE_USER, role: 'director' }, select: { id: true } })).map(u => u.id);
      sent += await notify(prisma, directors, { type: 'DOC_WEEKLY', title: `${overdue.length} văn bản đến quá hạn xử lý`, body: overdue.slice(0, 10).map(d => d.number).join(', '), link: '#/vanthu?book=DEN&overdue=1' });
    }
  }
  return { sent, open: open.length };
};
