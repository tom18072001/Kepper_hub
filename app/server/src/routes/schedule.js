// Lịch công tác (GĐ3f): lịch tuần của Trung tâm và từng phòng; báo vắng / đi công tác; nhập / xuất Excel đúng mẫu văn bản.
// Ai cũng xem được (lịch nội bộ). Sửa:
//   - Lịch Trung tâm: Ban Giám đốc và cán bộ Văn phòng (đơn vị soạn lịch tuần).
//   - Lịch của phòng: lãnh đạo phòng đó (trưởng / phó), Ban Giám đốc, Văn phòng.
//   - Báo vắng (AWAY): mỗi người tự báo cho mình; lãnh đạo phòng báo được cho cán bộ trong phòng.
const path = require('node:path');
const fs = require('node:fs/promises');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { fail, intParam, text } = require('../lib/http');
const { isItAdmin } = require('../lib/permissions');
const { verifyUpload } = require('../lib/files');
const { notify } = require('../services/events');
const S = require('../services/schedule');

const DAY = 86_400_000;
const isoDay = d => new Date(d).toISOString().slice(0, 10);
function dayParam(v, label) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) fail(422, `${label} không hợp lệ (yyyy-mm-dd)`, 'VALIDATION');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isoDay(d) !== v) fail(422, `${label} không hợp lệ`, 'VALIDATION');
  return d;
}
const WEEKDAY = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const fmtDay = d => { const x = new Date(d); return `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${x.getUTCFullYear()}`; };

module.exports = function mountSchedule(app, { prisma, auth, audit, config }) {
  const upload = multer({ dest: path.join(config.uploadTmpDir, 'workhub-import'), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

  async function rights(user) {
    const dept = user.departmentId ? await prisma.department.findUnique({ where: { id: user.departmentId }, select: { code: true } }) : null;
    const all = user.role === 'director' || dept?.code === 'VP';
    const leadOf = ['manager', 'deputy'].includes(user.role) && user.departmentId ? [user.departmentId] : [];
    return { all, leadOf, view: !isItAdmin(user) || user.isRootAdmin };
  }
  const canEdit = (r, user, ev) => r.all || (ev.departmentId != null && r.leadOf.includes(ev.departmentId))
    || (ev.kind === 'AWAY' && (ev.createdById === user.id || (ev.departmentId != null && r.leadOf.includes(ev.departmentId))));
  const viewOnly = async req => { const r = await rights(req.user); if (!r.view) fail(403, 'Tài khoản quản trị hệ thống không xem lịch công tác', 'FORBIDDEN'); return r; };

  async function directory() {
    return prisma.user.findMany({ where: { isActive: true, isRootAdmin: false, role: { not: 'admin' } }, select: { id: true, username: true, fullName: true, departmentId: true } });
  }
  const shape = (ev, r, user) => ({
    ...ev, date: isoDay(ev.date), endDate: ev.endDate ? isoDay(ev.endDate) : null,
    participants: ev.participants.map(p => ({ id: p.user.id, fullName: p.user.fullName, departmentId: p.user.departmentId })),
    canEdit: canEdit(r, user, ev),
  });
  const INCLUDE = { participants: { include: { user: { select: { id: true, fullName: true, departmentId: true } } } } };

  // Đọc & kiểm tra dữ liệu một mục lịch từ form.
  async function input(body, r, user, old = null) {
    const date = dayParam(body.date, 'Ngày');
    const endDate = body.endDate ? dayParam(body.endDate, 'Đến ngày') : null;
    if (endDate && endDate < date) fail(422, 'Đến ngày phải sau ngày bắt đầu', 'VALIDATION');
    if (endDate && (endDate - date) / DAY > 60) fail(422, 'Một mục lịch kéo dài tối đa 60 ngày', 'VALIDATION');
    const kind = body.kind === 'AWAY' ? 'AWAY' : 'EVENT';
    const departmentId = body.departmentId == null || body.departmentId === '' ? null : intParam(body.departmentId, 'Phòng');
    if (departmentId != null && !(await prisma.department.findFirst({ where: { id: departmentId, isActive: true } }))) fail(422, 'Phòng không hợp lệ', 'VALIDATION');
    const ids = [...new Set((Array.isArray(body.participantIds) ? body.participantIds : []).map(v => intParam(v, 'Thành phần')))].slice(0, 100);
    const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, departmentId: true } }) : [];
    if (users.length !== ids.length) fail(422, 'Có người trong thành phần không tồn tại hoặc đã khoá', 'VALIDATION');
    const data = {
      date, endDate, kind, departmentId,
      timeText: text(body.timeText, 'Thời gian', { max: 60 }) || (kind === 'AWAY' ? 'Cả ngày' : ''),
      title: text(body.title, 'Nội dung', { required: true, max: 500 }),
      participantsText: text(body.participantsText, 'Thành phần', { max: 2000 }) || '',
      chairText: text(body.chairText, 'Chủ trì', { max: 300 }) || '',
      location: text(body.location, 'Địa điểm', { max: 300 }) || '',
      note: text(body.note, 'Ghi chú', { max: 1000 }) || '',
      away: kind === 'AWAY' ? true : !!body.away,
    };
    data.startMin = S.parseTime(data.timeText);
    // Quyền: báo vắng cho chính mình (hoặc lãnh đạo phòng cho cán bộ trong phòng); lịch khác theo phạm vi.
    const probe = { ...data, createdById: old ? old.createdById : user.id };
    if (kind === 'AWAY') {
      if (!ids.length) { ids.push(user.id); users.push({ id: user.id, departmentId: user.departmentId }); }
      const others = users.filter(u => u.id !== user.id);
      const okOthers = r.all || others.every(u => u.departmentId != null && r.leadOf.includes(u.departmentId));
      if (!okOthers) fail(403, 'Chỉ báo vắng được cho chính mình (lãnh đạo phòng: cho cán bộ trong phòng)', 'FORBIDDEN');
      if (data.departmentId == null && !r.all) data.departmentId = user.departmentId ?? null;
    } else if (!canEdit(r, user, probe)) fail(403, departmentId == null ? 'Lịch Trung tâm do Ban Giám đốc và Văn phòng cập nhật' : 'Chỉ lãnh đạo phòng, Ban Giám đốc, Văn phòng cập nhật lịch của phòng', 'FORBIDDEN');
    return { data, ids };
  }
  const notifyPeople = (ev, ids, actorId, verb) => notify(prisma, ids, { type: 'SCHEDULE', title: `${verb}: ${ev.title}`.slice(0, 200), body: `${fmtDay(ev.date)}${ev.timeText ? ' · ' + ev.timeText : ''}${ev.location ? ' · ' + ev.location : ''}`, link: `#/schedule?at=${isoDay(ev.date)}` }, actorId);

  // Danh sách theo khoảng ngày (tối đa 62 ngày). scope: all | centre | dept:<id> | me
  app.get('/api/schedule', auth, async (req, res) => {
    const r = await viewOnly(req);
    const from = dayParam(req.query.from, 'Từ ngày'), to = dayParam(req.query.to, 'Đến ngày');
    if (to < from || (to - from) / DAY > 62) fail(422, 'Khoảng ngày tối đa 62 ngày', 'VALIDATION');
    const scope = String(req.query.scope || 'all');
    const where = { date: { lte: to }, OR: [{ endDate: null, date: { gte: from } }, { endDate: { gte: from } }] };
    if (scope === 'centre') where.departmentId = null;
    else if (scope.startsWith('dept:')) where.departmentId = intParam(scope.slice(5), 'Phòng');
    else if (scope === 'me') where.participants = { some: { userId: req.user.id } };
    const rows = await prisma.scheduleEvent.findMany({ where, include: INCLUDE, orderBy: [{ date: 'asc' }, { startMin: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }], take: 2000 });
    res.json({ events: rows.map(ev => shape(ev, r, req.user)), rights: { centre: r.all, departments: r.all ? null : r.leadOf } });
  });

  app.post('/api/schedule', auth, async (req, res) => {
    const r = await viewOnly(req);
    const { data, ids } = await input(req.body || {}, r, req.user);
    const ev = await prisma.scheduleEvent.create({ data: { ...data, createdById: req.user.id, participants: { create: ids.map(userId => ({ userId })) } }, include: INCLUDE });
    await audit(req, 'CREATE', 'ScheduleEvent', ev.id, null, { date: isoDay(ev.date), title: ev.title, kind: ev.kind, departmentId: ev.departmentId });
    if (ev.date >= new Date(Date.now() - DAY)) await notifyPeople(ev, ids, req.user.id, ev.kind === 'AWAY' ? 'Lịch vắng' : 'Lịch công tác mới');
    res.status(201).json(shape(ev, r, req.user));
  });

  app.put('/api/schedule/:id', auth, async (req, res) => {
    const r = await viewOnly(req);
    const old = await prisma.scheduleEvent.findUnique({ where: { id: intParam(req.params.id) }, include: { participants: true } });
    if (!old) fail(404, 'Không tìm thấy mục lịch', 'NOT_FOUND');
    if (!canEdit(r, req.user, old)) fail(403, 'Bạn không sửa được mục lịch này', 'FORBIDDEN');
    const { data, ids } = await input(req.body || {}, r, req.user, old);
    const ev = await prisma.$transaction(async tx => {
      await tx.scheduleParticipant.deleteMany({ where: { eventId: old.id } });
      return tx.scheduleEvent.update({ where: { id: old.id }, data: { ...data, source: old.source, participants: { create: ids.map(userId => ({ userId })) } }, include: INCLUDE });
    });
    const { participants, ...before } = old;
    await audit(req, 'UPDATE', 'ScheduleEvent', ev.id, { ...before, participantIds: participants.map(p => p.userId) }, { ...data, participantIds: ids });
    if (ev.date >= new Date(Date.now() - DAY)) await notifyPeople(ev, ids, req.user.id, 'Lịch công tác thay đổi');
    res.json(shape(ev, r, req.user));
  });

  app.delete('/api/schedule/:id', auth, async (req, res) => {
    const r = await viewOnly(req);
    const old = await prisma.scheduleEvent.findUnique({ where: { id: intParam(req.params.id) }, include: { participants: true } });
    if (!old) fail(404, 'Không tìm thấy mục lịch', 'NOT_FOUND');
    if (!canEdit(r, req.user, old)) fail(403, 'Bạn không xoá được mục lịch này', 'FORBIDDEN');
    await prisma.scheduleEvent.delete({ where: { id: old.id } });
    await audit(req, 'DELETE', 'ScheduleEvent', old.id, { date: isoDay(old.date), title: old.title, departmentId: old.departmentId }, null);
    if (old.date >= new Date(Date.now() - DAY)) await notifyPeople(old, old.participants.map(p => p.userId), req.user.id, 'Huỷ lịch');
    res.json({ ok: true });
  });

  // Nhập lịch tuần từ Excel đúng mẫu văn bản (mọi trang tính có dòng "Thời gian | Nội dung"). dryRun=1: chỉ xem trước.
  // Nhập lại cùng tuần: thay các mục đã nhập trước đó (nguồn IMPORT) trong cùng phạm vi và các ngày có trong tệp.
  app.post('/api/schedule/import', auth, upload.single('file'), async (req, res) => {
    const file = req.file;
    try {
      const r = await viewOnly(req);
      if (!file) fail(400, 'Chưa chọn tệp Excel', 'REQUIRED');
      if (!/\.xlsx$/i.test(file.originalname)) fail(415, 'Chỉ nhận tệp .xlsx', 'FILE_TYPE_NOT_ALLOWED');
      await verifyUpload('import.xlsx', file.path);
      const departmentId = req.body.departmentId ? intParam(req.body.departmentId, 'Phòng') : null;
      if (departmentId == null ? !r.all : !(r.all || r.leadOf.includes(departmentId))) fail(403, departmentId == null ? 'Lịch Trung tâm do Ban Giám đốc và Văn phòng cập nhật' : 'Chỉ lãnh đạo phòng cập nhật lịch của phòng', 'FORBIDDEN');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file.path);
      const cell = c => { const v = c?.value; if (v == null) return ''; if (v instanceof Date) return fmtDay(v); if (typeof v === 'object') return String(v.text ?? v.result ?? (v.richText ? v.richText.map(t => t.text).join('') : '')); return String(v); };
      const events = [], warnings = [];
      for (const ws of wb.worksheets) {
        const rows = [];
        ws.eachRow({ includeEmpty: true }, row => { const vals = []; for (let i = 1; i <= Math.max(row.cellCount, 8); i++) vals.push(cell(row.getCell(i))); rows.push(vals); });
        const parsed = S.parseScheduleRows(rows);
        if (!parsed) continue;
        events.push(...parsed.events.map(e => ({ ...e, sheet: ws.name })));
        warnings.push(...parsed.warnings.map(w => `${ws.name}: ${w}`));
      }
      if (!events.length) fail(422, 'Không tìm thấy lịch: cần dòng tiêu đề "Thời gian | Nội dung | Thành phần…" và các dòng ngày "Thứ Hai, ngày dd/mm/yyyy"', 'IMPORT_INVALID');
      if (events.length > 500) fail(422, 'Tối đa 500 mục lịch mỗi lần nhập', 'IMPORT_INVALID');
      const users = await directory();
      const unmatched = new Set();
      const rows = events.map(e => { const m = S.matchPeople(e.participantsText, users); for (const u of m.unmatched) if (!/tập thể|toàn thể|các đồng chí|các phòng|cán bộ/i.test(u)) unmatched.add(u); return { ...e, participantIds: m.ids }; });
      const days = [...new Set(rows.map(e => e.date))].sort();
      const replace = await prisma.scheduleEvent.count({ where: { source: 'IMPORT', departmentId, date: { in: days.map(d => new Date(d + 'T00:00:00Z')) } } });
      const preview = { count: rows.length, outside: rows.filter(e => S.isOutside(e.location)).length, from: days[0], to: days[days.length - 1], replace, unmatched: [...unmatched].slice(0, 50), warnings: warnings.slice(0, 30),
        sample: rows.slice(0, 8).map(e => ({ date: e.date, timeText: e.timeText, title: e.title, people: e.participantIds.length })) };
      if ([req.body.dryRun, req.query.dryRun].some(v => v === '1' || v === 'true')) return res.json({ dryRun: true, ...preview });
      await prisma.$transaction(async tx => {
        await tx.scheduleEvent.deleteMany({ where: { source: 'IMPORT', departmentId, date: { in: days.map(d => new Date(d + 'T00:00:00Z')) } } });
        for (const e of rows) await tx.scheduleEvent.create({ data: {
          date: new Date(e.date + 'T00:00:00Z'), timeText: e.timeText.slice(0, 60), startMin: e.startMin, title: e.title, participantsText: e.participantsText, chairText: e.chairText,
          location: e.location, note: e.note, departmentId, kind: 'EVENT', away: S.isOutside(e.location), source: 'IMPORT', createdById: req.user.id,
          participants: { create: e.participantIds.map(userId => ({ userId })) } } });
      }, { timeout: 60_000 });
      await audit(req, 'IMPORT', 'ScheduleEvent', null, null, { count: rows.length, from: preview.from, to: preview.to, replaced: replace, departmentId });
      res.json({ dryRun: false, ...preview });
    } finally { if (file) await fs.rm(file.path, { force: true }); }
  });

  // Xuất lịch tuần ra Excel theo mẫu văn bản: nhóm theo ngày, cột Thời gian | Nội dung | Thành phần | Chủ trì | Địa điểm | Ghi chú.
  app.get('/api/schedule/export.xlsx', auth, async (req, res) => {
    await viewOnly(req);
    const from = dayParam(req.query.from, 'Từ ngày'), to = dayParam(req.query.to, 'Đến ngày');
    if (to < from || (to - from) / DAY > 62) fail(422, 'Khoảng ngày tối đa 62 ngày', 'VALIDATION');
    const scope = String(req.query.scope || 'all');
    const where = { date: { lte: to }, OR: [{ endDate: null, date: { gte: from } }, { endDate: { gte: from } }] };
    let unit = 'TRUNG TÂM';
    if (scope === 'centre') where.departmentId = null;
    else if (scope.startsWith('dept:')) { where.departmentId = intParam(scope.slice(5), 'Phòng'); unit = ((await prisma.department.findUnique({ where: { id: where.departmentId } }))?.name || '').toUpperCase(); }
    const rows = await prisma.scheduleEvent.findMany({ where, orderBy: [{ date: 'asc' }, { startMin: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }], take: 2000 });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Lịch công tác', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    ws.columns = [{ width: 14 }, { width: 52 }, { width: 34 }, { width: 18 }, { width: 24 }, { width: 18 }];
    ws.mergeCells('A1:F1'); ws.getCell('A1').value = unit;
    ws.mergeCells('A2:F2'); ws.getCell('A2').value = `LỊCH CÔNG TÁC (Từ ngày ${fmtDay(from)} đến ngày ${fmtDay(to)})`;
    for (const c of ['A1', 'A2']) { ws.getCell(c).font = { bold: true, size: c === 'A2' ? 14 : 12 }; ws.getCell(c).alignment = { horizontal: 'center' }; }
    ws.addRow([]);
    const head = ws.addRow(['Thời gian', 'Nội dung', 'Thành phần', 'Chủ trì', 'Địa điểm', 'Ghi chú']);
    head.font = { bold: true }; head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } }; c.border = { top: { style: 'thin' }, bottom: { style: 'thin' } }; });
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + DAY)) {
      const list = rows.filter(e => e.date <= d && (e.endDate || e.date) >= d);
      if (!list.length) continue;
      const dr = ws.addRow([`${WEEKDAY[d.getUTCDay()]}, ngày ${fmtDay(d)}`]); ws.mergeCells(`A${dr.number}:F${dr.number}`); dr.font = { bold: true, italic: true };
      for (const e of list) {
        const row = ws.addRow([e.timeText, e.title, e.participantsText, e.chairText, e.location, [e.kind === 'AWAY' ? 'Vắng' : '', e.note].filter(Boolean).join(' · ')]);
        row.alignment = { vertical: 'top', wrapText: true };
      }
    }
    ws.addRow([]);
    ws.addRow([`Xuất bởi ${req.user.fullName} lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} — tài liệu nội bộ.`]).font = { italic: true, color: { argb: 'FF6B7280' } };
    await audit(req, 'EXPORT', 'ScheduleEvent', null, null, { from: isoDay(from), to: isoDay(to), scope, rows: rows.length });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Lich_cong_tac_${isoDay(from)}_${isoDay(to)}.xlsx"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  });
};
