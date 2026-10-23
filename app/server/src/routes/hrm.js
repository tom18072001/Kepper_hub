// Playground HRM — hồ sơ nhân sự, hợp đồng lao động, nghỉ phép, chấm công (không tính lương, không bảo hiểm).
// Bật bằng MODULES=hrm. Quyền: lib/policy.js (hrm.*); người phụ trách nhân sự (hr) do Ban GĐ chỉ định trong Thiết lập HRM.
// Dữ liệu Hạn chế: số CCCD, lương — mã hoá theo trường (lib/crypto-field.js), KHÔNG trả qua token Claude (chỉ 4 số cuối / bỏ lương).
// Qua token Claude chỉ ghi được: tạo đơn nghỉ của chính mình (lib/tokens.js). Duyệt, chấm công, giải trình, hồ sơ: trên giao diện.
const { fail, intParam, optionalInt, optionalDate, text, oneOf } = require('../lib/http');
const P = require('../lib/policy');
const H = require('../services/hrm');
const WK = require('../services/weekly');
const C = require('../lib/crypto-field');
const { notify } = require('../services/events');

const ACTIVE_USER = { isActive: true, isRootAdmin: false, role: { not: 'admin' } };
const BASIC = ['employeeCode', 'startDate', 'status'];
const PRIVATE = ['birthDate', 'gender', 'phone', 'personalEmail', 'address', 'emergencyName', 'emergencyPhone', 'education'];
const CONTACT = ['phone', 'personalEmail', 'address', 'emergencyName', 'emergencyPhone'];
const GENDERS = { MALE: 'Nam', FEMALE: 'Nữ', OTHER: 'Khác' };
const dayStart = d => new Date(Date.parse(d + 'T00:00:00+07:00'));
const dayParam = (v, label) => { if (!WK.isDay(v)) fail(422, label + ' không hợp lệ (YYYY-MM-DD)', 'INVALID_DATE'); return v; };
const monthParam = v => (typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : WK.dayOf(new Date()).slice(0, 7));
const timeOn = (day, hhmm, label) => { if (hhmm == null || hhmm === '') return null; if (!H.HHMM.test(hhmm)) fail(422, label + ' không hợp lệ (HH:MM)', 'INVALID_VALUE'); return new Date(Date.parse(`${day}T${hhmm}:00+07:00`)); };
const phone = (v, label) => { const s = text(v, label, { max: 30 }); if (s && !/^[0-9+().\s-]{6,30}$/.test(s)) fail(422, label + ' không hợp lệ', 'INVALID_VALUE'); return s || null; };
const emailOf = v => { const s = text(v, 'Email cá nhân', { max: 120 }); if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) fail(422, 'Email cá nhân không hợp lệ', 'INVALID_VALUE'); return s || null; };

module.exports = function mountHrm(app, { prisma, auth, audit, config }) {
  if (!(config.modules || []).includes('hrm')) return;
  C.keyOf(); // thiếu / sai HR_ENC_KEY trên máy chạy → dừng ngay khi khởi động, không đợi lần ghi đầu tiên

  const ctxFor = async req => {
    const cfg = await H.hrmConfig(prisma);
    const s = await H.subjectOf(prisma, req.user, cfg);
    if (s.it) fail(403, 'Quản trị hệ thống không xem dữ liệu nhân sự', 'FORBIDDEN');
    return { cfg, s };
  };
  const target = async userId => {
    const u = await prisma.user.findFirst({ where: { id: userId, isRootAdmin: false, role: { not: 'admin' } }, include: { permissions: true, department: { select: { id: true, name: true } } } });
    if (!u) fail(404, 'Không tìm thấy nhân sự', 'NOT_FOUND');
    return u;
  };
  const tctx = (u, extra = {}) => ({ targetUserId: u.id, departmentId: u.departmentId, targetLeader: H.isLeader(u) || H.isDirector(u), ...extra });
  // Người duyệt đơn / giải trình: lãnh đạo bộ phận (trừ chính người đó); người đó là lãnh đạo bộ phận / bộ phận không có lãnh đạo → Ban GĐ.
  async function approverIds(u) {
    const directors = (await prisma.user.findMany({ where: { ...ACTIVE_USER, role: 'director' }, select: { id: true } })).map(x => x.id).filter(id => id !== u.id);
    if (H.isLeader(u) || H.isDirector(u) || u.departmentId == null) return directors;
    const leaders = (await prisma.user.findMany({ where: { ...ACTIVE_USER, departmentId: u.departmentId, id: { not: u.id } }, include: { permissions: true } })).filter(H.isLeader).map(x => x.id);
    return leaders.length ? leaders : directors;
  }

  // ---------- Thiết lập ----------
  app.get('/api/hrm/meta', auth, async (req, res) => {
    const { cfg, s } = await ctxFor(req);
    const admin = P.can(s, 'edit', 'hrm.config');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      leaveTypes: H.LEAVE_TYPES, leaveStatus: H.LEAVE_STATUS, contractTypes: H.CONTRACT_TYPES, profileStatus: H.PROFILE_STATUS, genders: GENDERS,
      config: { workStart: cfg.workStart, workEnd: cfg.workEnd, graceMinutes: cfg.graceMinutes, workDays: cfg.workDays, holidays: cfg.holidays, annualDays: cfg.annualDays,
        officeNetworkOnly: cfg.officeNetworks.length > 0, ...(admin ? { officeNetworks: cfg.officeNetworks, hrUserIds: cfg.hrUserIds } : {}) },
      // IP Kepper nhìn thấy: kiểm tra trước khi bật "chỉ chấm công trong mạng văn phòng" (Docker Desktop thường che IP thật).
      yourIp: admin ? req.ip : undefined,
      me: { hr: s.hr, director: s.director, leader: s.leader, departmentId: s.departmentId, canConfig: admin, canRoles: P.can(s, 'edit', 'hrm.config', { field: 'roles' }) },
    });
  });
  app.put('/api/hrm/config', auth, async (req, res) => {
    if (req.via) fail(403, 'Thiết lập nhân sự làm trên giao diện Kepper', 'NOT_VIA_AI');
    const { cfg, s } = await ctxFor(req);
    P.assertCan(s, 'edit', 'hrm.config');
    const b = req.body || {}, next = { ...cfg };
    if (b.workStart !== undefined) { if (!H.HHMM.test(b.workStart)) fail(422, 'Giờ vào không hợp lệ'); next.workStart = b.workStart; }
    if (b.workEnd !== undefined) { if (!H.HHMM.test(b.workEnd)) fail(422, 'Giờ ra không hợp lệ'); next.workEnd = b.workEnd; }
    if (next.workEnd <= next.workStart) fail(422, 'Giờ ra phải sau giờ vào');
    if (b.graceMinutes !== undefined) { const n = Number(b.graceMinutes); if (!Number.isInteger(n) || n < 0 || n > 60) fail(422, 'Số phút cho phép đi muộn từ 0 đến 60'); next.graceMinutes = n; }
    if (b.annualDays !== undefined) { const n = Number(b.annualDays); if (!Number.isInteger(n) || n < 12 || n > 30) fail(422, 'Ngày phép năm từ 12 đến 30 (BLLĐ 2019 Đ113: tối thiểu 12)'); next.annualDays = n; }
    if (b.workDays !== undefined) { const w = [...new Set([].concat(b.workDays).map(Number))].filter(n => Number.isInteger(n) && n >= 0 && n <= 6); if (!w.length) fail(422, 'Chọn ít nhất một ngày làm việc'); next.workDays = w.sort(); }
    if (b.holidays !== undefined) { const h = [...new Set([].concat(b.holidays))]; if (h.length > 60 || h.some(d => !WK.isDay(d))) fail(422, 'Danh sách ngày lễ không hợp lệ (YYYY-MM-DD, tối đa 60)'); next.holidays = h.sort(); }
    if (b.officeNetworks !== undefined) { const n = [...new Set([].concat(b.officeNetworks).map(x => String(x).trim()).filter(Boolean))]; if (n.length > 10 || n.some(x => !H.cidrValid(x))) fail(422, 'Mạng văn phòng dạng 192.168.1.0/24 (tối đa 10)'); next.officeNetworks = n; }
    if (b.hrUserIds !== undefined) {
      P.assertCan(s, 'edit', 'hrm.config', { field: 'roles' });
      const ids = [...new Set([].concat(b.hrUserIds).map(Number))].filter(Number.isInteger);
      if (ids.length > 5) fail(422, 'Tối đa 5 người phụ trách nhân sự');
      if (ids.length && (await prisma.user.count({ where: { id: { in: ids }, ...ACTIVE_USER } })) !== ids.length) fail(422, 'Người phụ trách nhân sự không hợp lệ');
      next.hrUserIds = ids;
    }
    await prisma.appSetting.upsert({ where: { key: H.CONFIG_KEY }, update: { value: next }, create: { key: H.CONFIG_KEY, value: next } });
    await audit(req, 'HRM_CONFIG', 'HrmConfig', null, { hrUserIds: cfg.hrUserIds }, { fields: Object.keys(b), hrUserIds: next.hrUserIds });
    const added = next.hrUserIds.filter(id => !cfg.hrUserIds.includes(id));
    if (added.length) await notify(prisma, added, { type: 'HRM_ROLE', title: 'Bạn được Ban giám đốc chỉ định phụ trách nhân sự trên Kepper', body: 'Bạn xem / sửa hồ sơ, hợp đồng, số định danh của nhân sự. Mọi lượt xem số định danh được ghi nhật ký.', link: '#/hrm/people' });
    res.json({ ok: true });
  });

  // ---------- Hồ sơ ----------
  function profileOut(u, prof, s, cfg, { via = false } = {}) {
    const c = tctx(u);
    const out = { userId: u.id, fullName: u.fullName, username: u.username, displayTitle: u.displayTitle, department: u.department || null, isActive: u.isActive };
    for (const k of BASIC) out[k] = prof?.[k] ?? null;
    if (P.can(s, 'view', 'hrm.profile', { ...c, field: 'private' })) for (const k of PRIVATE) out[k] = prof?.[k] ?? null;
    if (P.can(s, 'view', 'hrm.identity', c)) out.identity = { last4: prof?.idNumberLast4 || null, issuedOn: prof?.idIssuedOn || null, issuedPlace: prof?.idIssuedPlace || null, canReveal: !via };
    out.can = { edit: P.can(s, 'edit', 'hrm.profile', c), editContact: P.can(s, 'edit', 'hrm.profile', { ...c, op: 'contact' }), identity: P.can(s, 'edit', 'hrm.identity', c),
      contracts: P.can(s, 'view', 'hrm.contract', c), editContracts: P.can(s, 'edit', 'hrm.contract', c) };
    return out;
  }
  function contractOut(k, s, u, via) {
    const salaryOk = !via && P.can(s, 'view', 'hrm.contract', tctx(u)); // lương: không bao giờ trả cho Claude (P.NEVER_AI_FIELDS)
    return { id: k.id, number: k.number, type: { code: k.type, label: H.CONTRACT_TYPES[k.type] || k.type }, position: k.position, startDate: k.startDate, endDate: k.endDate,
      status: k.status, signedAt: k.signedAt, note: k.note, salary: salaryOk ? (k.salaryEnc ? Number(C.tryDecrypt(k.salaryEnc)) || null : null) : undefined };
  }
  async function balance(u, prof, cfg, year) {
    const from = dayStart(`${year}-01-01`), to = dayStart(`${year + 1}-01-01`);
    const rows = await prisma.hrLeave.findMany({ where: { userId: u.id, type: 'ANNUAL', status: { in: ['APPROVED', 'PENDING'] }, fromDate: { gte: from, lt: to } }, select: { status: true, days: true } });
    const used = rows.filter(r => r.status === 'APPROVED').reduce((n, r) => n + r.days, 0), pending = rows.filter(r => r.status === 'PENDING').reduce((n, r) => n + r.days, 0);
    const quota = H.annualQuota(year, prof?.startDate, cfg);
    return { year, quota, used, pending, remaining: Math.max(0, quota - used - pending), note: 'Số tham khảo theo BLLĐ 2019 (Đ113, Đ114); người phụ trách nhân sự chốt.' };
  }

  app.get('/api/hrm/me', auth, async (req, res) => {
    const { cfg, s } = await ctxFor(req);
    const u = await target(req.user.id);
    const [prof, contracts, today] = await Promise.all([
      prisma.hrProfile.findUnique({ where: { userId: u.id } }),
      prisma.hrContract.findMany({ where: { userId: u.id }, orderBy: { startDate: 'desc' } }),
      prisma.hrAttendance.findUnique({ where: { userId_day: { userId: u.id, day: WK.dayOf(new Date()) } } }),
    ]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ profile: profileOut(u, prof, s, cfg, { via: !!req.via }), contracts: contracts.map(k => contractOut(k, s, u, !!req.via)),
      leave: await balance(u, prof, cfg, Number(WK.dayOf(new Date()).slice(0, 4))), today: today ? attOut(today) : null, workday: H.isWorkday(WK.dayOf(new Date()), cfg) });
  });

  // Danh sách nhân sự: người phụ trách nhân sự, Ban GĐ — mọi người; lãnh đạo bộ phận — bộ phận mình (trường cơ bản).
  app.get('/api/hrm/people', auth, async (req, res) => {
    const { cfg, s } = await ctxFor(req);
    if (!s.hr && !s.director && !s.leader) fail(403, 'Danh sách nhân sự dành cho người phụ trách nhân sự, Ban giám đốc, lãnh đạo bộ phận', 'FORBIDDEN');
    const where = { isRootAdmin: false, role: { not: 'admin' }, ...(req.query.inactive === '1' ? {} : { isActive: true }) };
    if (!s.hr && !s.director) where.departmentId = s.departmentId ?? -1;
    else if (req.query.departmentId) where.departmentId = optionalInt(req.query.departmentId, 'Bộ phận');
    const users = await prisma.user.findMany({ where, include: { permissions: true, department: { select: { id: true, name: true } } }, orderBy: [{ departmentId: 'asc' }, { fullName: 'asc' }] });
    const ids = users.map(u => u.id);
    const [profiles, contracts] = await Promise.all([
      prisma.hrProfile.findMany({ where: { userId: { in: ids } } }),
      prisma.hrContract.findMany({ where: { userId: { in: ids }, status: 'ACTIVE' }, orderBy: { startDate: 'desc' } }),
    ]);
    const pm = new Map(profiles.map(p => [p.userId, p]));
    const today = WK.dayOf(new Date());
    const rows = users.filter(u => P.can(s, 'view', 'hrm.profile', tctx(u))).map(u => {
      const o = profileOut(u, pm.get(u.id), s, cfg, { via: !!req.via });
      if (P.can(s, 'view', 'hrm.contract', tctx(u))) {
        const k = contracts.find(x => x.userId === u.id);
        o.contract = k ? { type: { code: k.type, label: H.CONTRACT_TYPES[k.type] }, endDate: k.endDate, expiringSoon: !!k.endDate && WK.dayOf(k.endDate) <= WK.addDays(today, 30) } : null;
      }
      return o;
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(rows);
  });
  app.get('/api/hrm/people/:userId', auth, async (req, res) => {
    const { cfg, s } = await ctxFor(req);
    const u = await target(intParam(req.params.userId));
    P.assertCan(s, 'view', 'hrm.profile', tctx(u));
    const prof = await prisma.hrProfile.findUnique({ where: { userId: u.id } });
    const out = profileOut(u, prof, s, cfg, { via: !!req.via });
    if (out.can.contracts) out.contracts = (await prisma.hrContract.findMany({ where: { userId: u.id }, orderBy: { startDate: 'desc' } })).map(k => contractOut(k, s, u, !!req.via));
    out.leave = P.can(s, 'view', 'hrm.leave', tctx(u)) ? await balance(u, prof, cfg, Number(WK.dayOf(new Date()).slice(0, 4))) : undefined;
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(out);
  });
  app.put('/api/hrm/people/:userId/profile', auth, async (req, res) => {
    if (req.via) fail(403, 'Hồ sơ nhân sự sửa trên giao diện Kepper', 'NOT_VIA_AI');
    const { s } = await ctxFor(req);
    const u = await target(intParam(req.params.userId));
    const full = P.can(s, 'edit', 'hrm.profile', tctx(u));
    if (!full) P.assertCan(s, 'edit', 'hrm.profile', tctx(u, { op: 'contact' }));
    const b = req.body || {}, data = {};
    const allowed = full ? [...BASIC, ...PRIVATE] : CONTACT;
    for (const k of Object.keys(b)) if (![...BASIC, ...PRIVATE].includes(k)) fail(422, `Trường không hợp lệ: ${k}`, 'INVALID_FIELD');
    for (const k of Object.keys(b)) if (!allowed.includes(k)) fail(403, 'Bạn chỉ sửa được thông tin liên hệ của mình — thông tin khác do người phụ trách nhân sự cập nhật', 'FORBIDDEN');
    if (b.employeeCode !== undefined) {
      data.employeeCode = text(b.employeeCode, 'Mã nhân viên', { max: 20 }) || null;
      if (data.employeeCode && await prisma.hrProfile.findFirst({ where: { employeeCode: data.employeeCode, userId: { not: u.id } } })) fail(409, 'Mã nhân viên đã dùng cho người khác', 'DUPLICATE');
    }
    if (b.startDate !== undefined) data.startDate = optionalDate(b.startDate, 'Ngày vào làm');
    if (b.status !== undefined) data.status = oneOf(b.status, Object.keys(H.PROFILE_STATUS), 'Trạng thái');
    if (b.birthDate !== undefined) data.birthDate = optionalDate(b.birthDate, 'Ngày sinh');
    if (b.gender !== undefined) data.gender = b.gender ? oneOf(b.gender, Object.keys(GENDERS), 'Giới tính') : null;
    if (b.phone !== undefined) data.phone = phone(b.phone, 'Điện thoại');
    if (b.personalEmail !== undefined) data.personalEmail = emailOf(b.personalEmail);
    if (b.address !== undefined) data.address = text(b.address, 'Địa chỉ', { max: 300 }) || null;
    if (b.emergencyName !== undefined) data.emergencyName = text(b.emergencyName, 'Người liên hệ khẩn cấp', { max: 120 }) || null;
    if (b.emergencyPhone !== undefined) data.emergencyPhone = phone(b.emergencyPhone, 'Điện thoại khẩn cấp');
    if (b.education !== undefined) data.education = text(b.education, 'Học vấn', { max: 300 }) || null;
    await prisma.hrProfile.upsert({ where: { userId: u.id }, update: { ...data, updatedById: req.user.id }, create: { userId: u.id, ...data, updatedById: req.user.id } });
    await audit(req, 'HR_PROFILE_UPDATE', 'HrProfile', u.id, null, { fields: Object.keys(data) }); // chỉ tên trường — không chép DLCN vào nhật ký
    res.json({ ok: true });
  });

  // Số định danh: xem đầy đủ chỉ trên giao diện (không qua Claude), mỗi lượt xem ghi nhật ký.
  app.get('/api/hrm/people/:userId/identity', auth, async (req, res) => {
    if (req.via) fail(403, 'Số định danh không gửi cho Claude — xem trên giao diện Kepper', 'NOT_VIA_AI');
    const { s } = await ctxFor(req);
    const u = await target(intParam(req.params.userId));
    P.assertCan(s, 'view', 'hrm.identity', tctx(u));
    const prof = await prisma.hrProfile.findUnique({ where: { userId: u.id } });
    await audit(req, 'HR_IDENTITY_VIEW', 'HrProfile', u.id, null, { self: u.id === req.user.id });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ idNumber: prof?.idNumberEnc ? C.tryDecrypt(prof.idNumberEnc) : null, issuedOn: prof?.idIssuedOn || null, issuedPlace: prof?.idIssuedPlace || null });
  });
  app.put('/api/hrm/people/:userId/identity', auth, async (req, res) => {
    if (req.via) fail(403, 'Số định danh cập nhật trên giao diện Kepper', 'NOT_VIA_AI');
    const { s } = await ctxFor(req);
    const u = await target(intParam(req.params.userId));
    P.assertCan(s, 'edit', 'hrm.identity', tctx(u));
    const b = req.body || {}, data = {};
    if (b.idNumber !== undefined) {
      const n = String(b.idNumber || '').replace(/\s/g, '');
      if (n && !/^\d{12}$/.test(n)) fail(422, 'Số CCCD gồm 12 chữ số', 'INVALID_VALUE');
      data.idNumberEnc = n ? C.encrypt(n) : null; data.idNumberLast4 = n ? C.last4(n) : null;
    }
    if (b.issuedOn !== undefined) data.idIssuedOn = optionalDate(b.issuedOn, 'Ngày cấp');
    if (b.issuedPlace !== undefined) data.idIssuedPlace = text(b.issuedPlace, 'Nơi cấp', { max: 200 }) || null;
    await prisma.hrProfile.upsert({ where: { userId: u.id }, update: { ...data, updatedById: req.user.id }, create: { userId: u.id, ...data, updatedById: req.user.id } });
    await audit(req, 'HR_IDENTITY_UPDATE', 'HrProfile', u.id, null, { fields: Object.keys(b) });
    res.json({ ok: true, last4: data.idNumberLast4 });
  });

  // ---------- Hợp đồng lao động ----------
  const contractData = (b, partial) => {
    const d = {};
    if (!partial || b.number !== undefined) d.number = text(b.number, 'Số hợp đồng', { required: true, max: 60 });
    if (!partial || b.type !== undefined) d.type = oneOf(b.type, Object.keys(H.CONTRACT_TYPES), 'Loại hợp đồng') || 'FIXED';
    if (!partial || b.startDate !== undefined) { d.startDate = optionalDate(b.startDate, 'Ngày bắt đầu'); if (!d.startDate) fail(422, 'Thiếu ngày bắt đầu', 'REQUIRED'); }
    if (b.endDate !== undefined) d.endDate = optionalDate(b.endDate, 'Ngày kết thúc');
    if (b.position !== undefined) d.position = text(b.position, 'Chức danh', { max: 120 }) || null;
    if (b.signedAt !== undefined) d.signedAt = optionalDate(b.signedAt, 'Ngày ký');
    if (b.status !== undefined) d.status = oneOf(b.status, ['ACTIVE', 'ENDED'], 'Trạng thái');
    if (b.note !== undefined) d.note = text(b.note, 'Ghi chú', { max: 1000 }) || '';
    if (b.salary !== undefined) {
      if (b.salary === null || b.salary === '') d.salaryEnc = null;
      else { const n = Number(b.salary); if (!Number.isFinite(n) || n < 0 || n > 1e10) fail(422, 'Mức lương không hợp lệ', 'INVALID_VALUE'); d.salaryEnc = C.encrypt(String(Math.round(n))); }
    }
    if (d.type === 'INDEFINITE') d.endDate = null;
    return d;
  };
  app.post('/api/hrm/people/:userId/contracts', auth, async (req, res) => {
    if (req.via) fail(403, 'Hợp đồng lao động cập nhật trên giao diện Kepper', 'NOT_VIA_AI');
    const { s } = await ctxFor(req);
    const u = await target(intParam(req.params.userId));
    P.assertCan(s, 'edit', 'hrm.contract', tctx(u));
    const d = contractData(req.body || {}, false);
    if (d.endDate && d.endDate < d.startDate) fail(422, 'Ngày kết thúc trước ngày bắt đầu', 'INVALID_DATE');
    const row = await prisma.hrContract.create({ data: { userId: u.id, ...d, createdById: req.user.id } });
    await audit(req, 'HR_CONTRACT_CREATE', 'HrContract', row.id, null, { userId: u.id, type: row.type, fields: Object.keys(d).filter(k => k !== 'salaryEnc') });
    res.status(201).json({ id: row.id });
  });
  app.patch('/api/hrm/contracts/:id', auth, async (req, res) => {
    if (req.via) fail(403, 'Hợp đồng lao động cập nhật trên giao diện Kepper', 'NOT_VIA_AI');
    const { s } = await ctxFor(req);
    const k = await prisma.hrContract.findUnique({ where: { id: intParam(req.params.id) } });
    if (!k) fail(404, 'Không tìm thấy hợp đồng', 'NOT_FOUND');
    const u = await target(k.userId);
    P.assertCan(s, 'edit', 'hrm.contract', tctx(u));
    const d = contractData(req.body || {}, true);
    const start = d.startDate || k.startDate, end = d.endDate !== undefined ? d.endDate : k.endDate;
    if (end && end < start) fail(422, 'Ngày kết thúc trước ngày bắt đầu', 'INVALID_DATE');
    await prisma.hrContract.update({ where: { id: k.id }, data: d });
    await audit(req, 'HR_CONTRACT_UPDATE', 'HrContract', k.id, null, { userId: u.id, fields: Object.keys(d).map(x => (x === 'salaryEnc' ? 'salary' : x)) });
    res.json({ ok: true });
  });

  // ---------- Nghỉ phép ----------
  // Qua Claude, đơn của NGƯỜI KHÁC: nghỉ ốm / thai sản (thông tin sức khoẻ — DLCN nhạy cảm) gộp thành "Nghỉ theo chế độ", bỏ lý do
  // (tối thiểu hoá dữ liệu chuyển ra nước ngoài). Trên giao diện, người duyệt vẫn thấy đủ để quyết định.
  const leaveOut = (l, s, users, u, via = false) => {
    const masked = via && l.userId !== s.userId;
    const type = masked && ['SICK', 'MATERNITY'].includes(l.type) ? { code: 'PROTECTED', label: 'Nghỉ theo chế độ' } : { code: l.type, label: H.LEAVE_TYPES[l.type] || l.type };
    return { id: l.id, user: { id: l.userId, fullName: users[l.userId]?.fullName || null, department: users[l.userId]?.department || null },
    type, fromDate: WK.dayOf(l.fromDate), toDate: WK.dayOf(l.toDate), halfDay: l.halfDay, days: l.days, reason: masked ? undefined : l.reason,
    status: { code: l.status, label: H.LEAVE_STATUS[l.status] }, approver: l.approverId ? users[l.approverId]?.fullName || null : null, decidedAt: l.decidedAt, decisionNote: l.decisionNote, createdAt: l.createdAt,
    can: u ? { decide: l.status === 'PENDING' && P.can(s, 'edit', 'hrm.leave', tctx(u, { op: 'approve' })), cancel: ['PENDING', 'APPROVED'].includes(l.status) && P.can(s, 'edit', 'hrm.leave', tctx(u, { op: 'cancel' })) } : undefined };
  };
  async function usersMap(ids) {
    const rows = await prisma.user.findMany({ where: { id: { in: [...new Set(ids.filter(Boolean))] } }, include: { permissions: true, department: { select: { id: true, name: true } } } });
    return Object.fromEntries(rows.map(u => [u.id, u]));
  }
  // scope: mine (của tôi) | approve (chờ tôi duyệt) | team (bộ phận tôi / mọi người với HR, Ban GĐ)
  app.get('/api/hrm/leaves', auth, async (req, res) => {
    const { s } = await ctxFor(req);
    const scope = ['mine', 'approve', 'team'].includes(req.query.scope) ? req.query.scope : 'mine';
    const year = /^\d{4}$/.test(String(req.query.year || '')) ? Number(req.query.year) : Number(WK.dayOf(new Date()).slice(0, 4));
    const where = { fromDate: { lt: dayStart(`${year + 1}-01-01`) }, toDate: { gte: dayStart(`${year}-01-01`) } };
    if (scope === 'mine') where.userId = s.userId;
    else if (scope === 'approve') { where.status = 'PENDING'; where.userId = { not: s.userId }; delete where.fromDate; delete where.toDate; }
    else if (!s.hr && !s.director) { if (!s.leader) fail(403, 'Chỉ lãnh đạo bộ phận, người phụ trách nhân sự, Ban giám đốc xem đơn nghỉ của bộ phận', 'FORBIDDEN'); where.departmentId = s.departmentId ?? -1; }
    const rows = await prisma.hrLeave.findMany({ where, orderBy: [{ fromDate: 'desc' }], take: 1000 });
    const users = await usersMap(rows.flatMap(l => [l.userId, l.approverId]));
    const out = [];
    for (const l of rows) {
      const u = users[l.userId];
      if (!u || !P.can(s, 'view', 'hrm.leave', tctx(u))) continue;
      const o = leaveOut(l, s, users, u, !!req.via);
      if (scope === 'approve' && !o.can.decide) continue;
      out.push(o);
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(out);
  });
  app.post('/api/hrm/leaves', auth, async (req, res) => {
    const { cfg, s } = await ctxFor(req);
    const b = req.body || {};
    const userId = optionalInt(b.userId, 'Người nghỉ') ?? s.userId;
    if (req.via && userId !== s.userId) fail(403, 'Claude chỉ tạo đơn nghỉ của chính bạn', 'NOT_VIA_AI');
    const u = await target(userId);
    P.assertCan(s, 'edit', 'hrm.leave', tctx(u, { op: 'create' }));
    const type = oneOf(b.type, Object.keys(H.LEAVE_TYPES), 'Loại nghỉ') || 'ANNUAL';
    const from = dayParam(b.fromDate, 'Từ ngày'), to = dayParam(b.toDate || b.fromDate, 'Đến ngày');
    if (to < from) fail(422, 'Đến ngày phải sau từ ngày', 'INVALID_DATE');
    if (WK.addDays(from, 180) < to) fail(422, 'Một đơn tối đa 180 ngày', 'INVALID_DATE');
    const today = WK.dayOf(new Date());
    if (from < WK.addDays(today, -30) && !s.hr) fail(422, 'Đơn nghỉ bổ sung tối đa 30 ngày trước — quá hạn liên hệ người phụ trách nhân sự', 'INVALID_DATE');
    const halfDay = oneOf(b.halfDay || 'NONE', ['NONE', 'AM', 'PM'], 'Nửa ngày');
    const days = H.leaveDays(from, to, halfDay, cfg);
    if (Number.isNaN(days)) fail(422, 'Nghỉ nửa ngày chỉ áp dụng khi từ ngày = đến ngày và là ngày làm việc', 'INVALID_VALUE');
    if (!days) fail(422, 'Khoảng ngày chọn không có ngày làm việc nào', 'INVALID_VALUE');
    const reason = text(b.reason, 'Lý do', { max: 200 }) || '';
    const overlap = await prisma.hrLeave.findFirst({ where: { userId: u.id, status: { in: ['PENDING', 'APPROVED'] }, fromDate: { lte: dayStart(to) }, toDate: { gte: dayStart(from) } } });
    if (overlap) fail(409, `Trùng đơn nghỉ ${WK.fmtDY(WK.dayOf(overlap.fromDate))}–${WK.fmtDY(WK.dayOf(overlap.toDate))} (${H.LEAVE_STATUS[overlap.status]})`, 'OVERLAP');
    if (type === 'ANNUAL') {
      const prof = await prisma.hrProfile.findUnique({ where: { userId: u.id } });
      const bal = await balance(u, prof, cfg, Number(from.slice(0, 4)));
      if (days > bal.remaining && !(s.hr && b.force === true)) fail(422, `Phép năm còn ${bal.remaining} ngày (đã dùng ${bal.used}, chờ duyệt ${bal.pending}) — chọn "Nghỉ không lương" hoặc liên hệ người phụ trách nhân sự`, 'QUOTA');
    }
    const row = await prisma.hrLeave.create({ data: { userId: u.id, departmentId: u.departmentId, type, fromDate: dayStart(from), toDate: dayStart(to), halfDay, days, reason, createdById: req.user.id } });
    await audit(req, 'HR_LEAVE_CREATE', 'HrLeave', row.id, null, { userId: u.id, type, from, to, days });
    await notify(prisma, await approverIds(u), { type: 'HR_LEAVE_REQUEST', title: `${u.fullName} xin ${H.LEAVE_TYPES[type].toLowerCase()} ${days} ngày (${WK.fmtD(from)}${to !== from ? '–' + WK.fmtD(to) : ''})`, body: 'Duyệt trên Kepper → Nhân sự → Chờ duyệt', link: '#/hrm/approve' }, req.user.id);
    res.status(201).json({ id: row.id, days, status: 'PENDING', next: 'Đơn đã gửi lãnh đạo bộ phận duyệt (Claude không duyệt thay).' });
  });
  app.post('/api/hrm/leaves/:id/decide', auth, async (req, res) => {
    if (req.via) fail(403, 'Duyệt đơn làm trên giao diện Kepper', 'NOT_VIA_AI');
    const { s } = await ctxFor(req);
    const l = await prisma.hrLeave.findUnique({ where: { id: intParam(req.params.id) } });
    if (!l) fail(404, 'Không tìm thấy đơn', 'NOT_FOUND');
    const u = await target(l.userId);
    P.assertCan(s, 'edit', 'hrm.leave', tctx(u, { op: 'approve' }));
    const decision = oneOf(req.body?.decision, ['APPROVE', 'REJECT'], 'Quyết định');
    const note = text(req.body?.note, 'Ý kiến', { max: 300 }) || null;
    if (decision === 'REJECT' && !note) fail(422, 'Từ chối cần ghi ý kiến', 'REQUIRED');
    const done = await prisma.hrLeave.updateMany({ where: { id: l.id, status: 'PENDING' }, data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', approverId: req.user.id, decidedAt: new Date(), decisionNote: note } });
    if (!done.count) fail(409, 'Đơn đã được xử lý', 'CONFLICT');
    await audit(req, decision === 'APPROVE' ? 'HR_LEAVE_APPROVE' : 'HR_LEAVE_REJECT', 'HrLeave', l.id, null, { userId: l.userId });
    await notify(prisma, [l.userId], { type: 'HR_LEAVE_DECIDED', title: `Đơn nghỉ ${WK.fmtD(WK.dayOf(l.fromDate))}${l.days > 1 ? '–' + WK.fmtD(WK.dayOf(l.toDate)) : ''} ${decision === 'APPROVE' ? 'đã được duyệt' : 'bị từ chối'}`, body: note, link: '#/hrm' });
    res.json({ ok: true });
  });
  app.post('/api/hrm/leaves/:id/cancel', auth, async (req, res) => {
    if (req.via) fail(403, 'Huỷ đơn làm trên giao diện Kepper', 'NOT_VIA_AI');
    const { s } = await ctxFor(req);
    const l = await prisma.hrLeave.findUnique({ where: { id: intParam(req.params.id) } });
    if (!l) fail(404, 'Không tìm thấy đơn', 'NOT_FOUND');
    const u = await target(l.userId);
    P.assertCan(s, 'edit', 'hrm.leave', tctx(u, { op: 'cancel' }));
    if (!['PENDING', 'APPROVED'].includes(l.status)) fail(409, 'Đơn không còn hiệu lực', 'CONFLICT');
    if (l.status === 'APPROVED' && WK.dayOf(l.fromDate) <= WK.dayOf(new Date()) && !s.hr) fail(409, 'Đơn đã duyệt và đã bắt đầu — liên hệ người phụ trách nhân sự để điều chỉnh', 'CONFLICT');
    await prisma.hrLeave.update({ where: { id: l.id }, data: { status: 'CANCELLED' } });
    await audit(req, 'HR_LEAVE_CANCEL', 'HrLeave', l.id, null, { userId: l.userId, was: l.status });
    if (l.status === 'APPROVED' && l.approverId) await notify(prisma, [l.approverId], { type: 'HR_LEAVE_CANCELLED', title: `${u.fullName} huỷ đơn nghỉ ${WK.fmtD(WK.dayOf(l.fromDate))}`, link: '#/hrm/approve' }, req.user.id);
    res.json({ ok: true });
  });

  // ---------- Chấm công ----------
  function attOut(r) {
    return { id: r.id, day: r.day, checkIn: r.checkIn, checkOut: r.checkOut, minutesLate: r.minutesLate, minutesEarly: r.minutesEarly, note: r.note,
      adjust: r.adjustStatus ? { status: r.adjustStatus, reason: r.adjustReason, in: r.adjustIn, out: r.adjustOut, at: r.adjustAt } : null };
  }
  // Chấm công: chỉ chính người đó, trên giao diện (không qua Claude); giờ lấy từ máy chủ, không tin giờ máy người dùng.
  app.post('/api/hrm/attendance/check', auth, async (req, res) => {
    if (req.via) fail(403, 'Chấm công không làm qua Claude — bấm trên Kepper', 'NOT_VIA_AI');
    const { cfg, s } = await ctxFor(req);
    const u = await target(req.user.id);
    P.assertCan(s, 'edit', 'hrm.attendance', tctx(u, { op: 'check' }));
    if (cfg.officeNetworks.length && !H.inNetworks(req.ip, cfg.officeNetworks)) fail(403, 'Chỉ chấm công trong mạng văn phòng — ở ngoài: gửi giải trình', 'OUTSIDE_OFFICE');
    const kind = oneOf(req.body?.kind, ['in', 'out'], 'Loại chấm công');
    const now = new Date(), day = WK.dayOf(now);
    const cur = await prisma.hrAttendance.findUnique({ where: { userId_day: { userId: u.id, day } } });
    if (kind === 'in' && cur?.checkIn) fail(409, 'Đã chấm vào hôm nay', 'CONFLICT');
    const checkIn = kind === 'in' ? now : cur?.checkIn || null, checkOut = kind === 'out' ? now : cur?.checkOut || null;
    const le = H.lateEarly(checkIn, checkOut, cfg);
    const data = kind === 'in' ? { checkIn: now, inIp: req.ip || null, ...le } : { checkOut: now, outIp: req.ip || null, ...le };
    const row = await prisma.hrAttendance.upsert({ where: { userId_day: { userId: u.id, day } }, update: data, create: { userId: u.id, departmentId: u.departmentId, day, ...data } });
    res.json(attOut(row));
  });
  // Giải trình (quên chấm, đi công tác, đi muộn có lý do) — ngày trong 31 ngày gần nhất.
  app.post('/api/hrm/attendance/explain', auth, async (req, res) => {
    if (req.via) fail(403, 'Giải trình chấm công làm trên giao diện Kepper', 'NOT_VIA_AI');
    const { s } = await ctxFor(req);
    const u = await target(req.user.id);
    P.assertCan(s, 'edit', 'hrm.attendance', tctx(u, { op: 'explain' }));
    const b = req.body || {}, today = WK.dayOf(new Date());
    const day = dayParam(b.day, 'Ngày');
    if (day > today || day < WK.addDays(today, -31)) fail(422, 'Giải trình cho ngày trong 31 ngày gần nhất', 'INVALID_DATE');
    const reason = text(b.reason, 'Lý do', { required: true, max: 300 });
    const data = { adjustStatus: 'PENDING', adjustReason: reason, adjustIn: timeOn(day, b.in, 'Giờ vào'), adjustOut: timeOn(day, b.out, 'Giờ ra'), adjustById: null, adjustAt: new Date() };
    const cur = await prisma.hrAttendance.findUnique({ where: { userId_day: { userId: u.id, day } } });
    if (cur?.adjustStatus === 'APPROVED') fail(409, 'Ngày này đã được duyệt giải trình', 'CONFLICT');
    const row = await prisma.hrAttendance.upsert({ where: { userId_day: { userId: u.id, day } }, update: data, create: { userId: u.id, departmentId: u.departmentId, day, ...data } });
    await notify(prisma, await approverIds(u), { type: 'HR_ATT_EXPLAIN', title: `${u.fullName} giải trình chấm công ${WK.fmtDY(day)}`, body: reason.slice(0, 200), link: '#/hrm/approve' }, req.user.id);
    res.json(attOut(row));
  });
  app.post('/api/hrm/attendance/:id/decide', auth, async (req, res) => {
    if (req.via) fail(403, 'Duyệt giải trình làm trên giao diện Kepper', 'NOT_VIA_AI');
    const { cfg, s } = await ctxFor(req);
    const r = await prisma.hrAttendance.findUnique({ where: { id: intParam(req.params.id) } });
    if (!r || r.adjustStatus !== 'PENDING') fail(404, 'Không có giải trình chờ duyệt', 'NOT_FOUND');
    const u = await target(r.userId);
    P.assertCan(s, 'edit', 'hrm.attendance', tctx(u, { op: 'approve' }));
    const decision = oneOf(req.body?.decision, ['APPROVE', 'REJECT'], 'Quyết định');
    // Giữ nguyên giờ gốc (bằng chứng); duyệt thì tính đi muộn / về sớm theo giờ giải trình.
    const le = decision === 'APPROVE' ? H.lateEarly(r.adjustIn || r.checkIn, r.adjustOut || r.checkOut, cfg) : {};
    const done = await prisma.hrAttendance.updateMany({ where: { id: r.id, adjustStatus: 'PENDING' }, data: { adjustStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', adjustById: req.user.id, adjustAt: new Date(), ...le } });
    if (!done.count) fail(409, 'Giải trình đã được xử lý', 'CONFLICT');
    await audit(req, decision === 'APPROVE' ? 'HR_ATT_APPROVE' : 'HR_ATT_REJECT', 'HrAttendance', r.id, null, { userId: r.userId, day: r.day });
    await notify(prisma, [r.userId], { type: 'HR_ATT_DECIDED', title: `Giải trình chấm công ${WK.fmtDY(r.day)} ${decision === 'APPROVE' ? 'đã được duyệt' : 'bị từ chối'}`, link: '#/hrm' });
    res.json({ ok: true });
  });
  app.get('/api/hrm/attendance/pending', auth, async (req, res) => {
    const { s } = await ctxFor(req);
    const rows = await prisma.hrAttendance.findMany({ where: { adjustStatus: 'PENDING', userId: { not: s.userId } }, orderBy: { day: 'asc' }, take: 300 });
    const users = await usersMap(rows.map(r => r.userId));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(rows.filter(r => users[r.userId] && P.can(s, 'edit', 'hrm.attendance', tctx(users[r.userId], { op: 'approve' })))
      .map(r => ({ ...attOut(r), user: { id: r.userId, fullName: users[r.userId].fullName, department: users[r.userId].department } })));
  });
  // Bảng công tháng của một người.
  app.get('/api/hrm/attendance', auth, async (req, res) => {
    const { cfg, s } = await ctxFor(req);
    const u = await target(optionalInt(req.query.userId, 'Nhân sự') ?? s.userId);
    P.assertCan(s, 'view', 'hrm.attendance', tctx(u));
    const month = monthParam(req.query.month);
    const [records, leaves] = await Promise.all([
      prisma.hrAttendance.findMany({ where: { userId: u.id, day: { startsWith: month } } }),
      prisma.hrLeave.findMany({ where: { userId: u.id, status: 'APPROVED', fromDate: { lt: dayStart(WK.addDays(month + '-28', 4)) }, toDate: { gte: dayStart(month + '-01') } } }),
    ]);
    const sheet = H.monthSheet(month, records.map(attOut), leaves, cfg);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ user: { id: u.id, fullName: u.fullName }, month, sheet, totals: totalsOf(sheet), self: u.id === s.userId });
  });
  function totalsOf(sheet) {
    const t = { workdays: 0, ok: 0, lateEarly: 0, missing: 0, leave: 0, adjusted: 0, minutesLate: 0 };
    for (const d of sheet) {
      if (['OFF', 'HOLIDAY', 'WEEKEND_WORK'].includes(d.status)) continue;
      t.workdays++;
      if (d.status === 'OK') t.ok++; else if (d.status === 'LATE_EARLY') t.lateEarly++; else if (['MISSING', 'NO_OUT'].includes(d.status)) t.missing++;
      else if (d.status === 'LEAVE') t.leave++; else if (d.status === 'ADJUSTED') t.adjusted++;
      t.minutesLate += d.record?.minutesLate || 0;
    }
    return t;
  }
  // Tổng hợp công tháng theo người: lãnh đạo bộ phận (bộ phận mình), người phụ trách nhân sự, Ban GĐ.
  app.get('/api/hrm/attendance/team', auth, async (req, res) => {
    const { cfg, s } = await ctxFor(req);
    if (!s.hr && !s.director && !s.leader) fail(403, 'Tổng hợp công dành cho lãnh đạo bộ phận, người phụ trách nhân sự, Ban giám đốc', 'FORBIDDEN');
    const month = monthParam(req.query.month);
    const where = { ...ACTIVE_USER };
    if (!s.hr && !s.director) where.departmentId = s.departmentId ?? -1;
    else if (req.query.departmentId) where.departmentId = optionalInt(req.query.departmentId, 'Bộ phận');
    const users = (await prisma.user.findMany({ where, include: { permissions: true, department: { select: { id: true, name: true } } }, orderBy: [{ departmentId: 'asc' }, { fullName: 'asc' }] }))
      .filter(u => P.can(s, 'view', 'hrm.attendance', tctx(u)));
    const ids = users.map(u => u.id);
    const [records, leaves] = await Promise.all([
      prisma.hrAttendance.findMany({ where: { userId: { in: ids }, day: { startsWith: month } } }),
      prisma.hrLeave.findMany({ where: { userId: { in: ids }, status: 'APPROVED', fromDate: { lt: dayStart(WK.addDays(month + '-28', 4)) }, toDate: { gte: dayStart(month + '-01') } } }),
    ]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ month, rows: users.map(u => ({ user: { id: u.id, fullName: u.fullName, department: u.department },
      totals: totalsOf(H.monthSheet(month, records.filter(r => r.userId === u.id).map(attOut), leaves.filter(l => l.userId === u.id), cfg)) })) });
  });
  // Nhập từ máy chấm công (CSV đã đọc ở trình duyệt): mã NV, ngày, giờ vào, giờ ra. Người phụ trách nhân sự; không nhập cho chính mình.
  app.post('/api/hrm/attendance/import', auth, async (req, res) => {
    if (req.via) fail(403, 'Nhập chấm công làm trên giao diện Kepper', 'NOT_VIA_AI');
    const { cfg, s } = await ctxFor(req);
    if (!s.hr) fail(403, 'Chỉ người phụ trách nhân sự nhập dữ liệu máy chấm công', 'FORBIDDEN');
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length || rows.length > 5000) fail(422, 'Cần 1–5000 dòng', 'INVALID_VALUE');
    const profiles = await prisma.hrProfile.findMany({ where: { employeeCode: { not: null } }, select: { userId: true, employeeCode: true } });
    const byCode = new Map(profiles.map(p => [p.employeeCode.toUpperCase(), p.userId]));
    const users = await usersMap(profiles.map(p => p.userId));
    const errors = []; let saved = 0;
    for (const [i, r] of rows.entries()) {
      const line = i + 1;
      try {
        const userId = byCode.get(String(r.employeeCode || '').trim().toUpperCase());
        if (!userId || !users[userId]) throw new Error('mã NV không có');
        if (!P.can(s, 'edit', 'hrm.attendance', tctx(users[userId], { op: 'hr' }))) throw new Error('không nhập cho chính mình');
        if (!WK.isDay(r.day)) throw new Error('ngày không hợp lệ');
        const checkIn = timeOn(r.day, r.in, 'Giờ vào'), checkOut = timeOn(r.day, r.out, 'Giờ ra');
        if (!checkIn && !checkOut) throw new Error('thiếu giờ');
        const data = { checkIn, checkOut, ...H.lateEarly(checkIn, checkOut, cfg), note: 'Máy chấm công' };
        await prisma.hrAttendance.upsert({ where: { userId_day: { userId, day: r.day } }, update: data, create: { userId, departmentId: users[userId].departmentId, day: r.day, ...data } });
        saved++;
      } catch (error) { if (errors.length < 50) errors.push(`Dòng ${line}: ${error.message}`); }
    }
    await audit(req, 'HR_ATT_IMPORT', 'HrAttendance', null, null, { rows: rows.length, saved, errors: errors.length });
    res.json({ saved, errors });
  });
};

// Nhắc người phụ trách nhân sự: hợp đồng hết hạn sau 30 / 7 ngày, hết thử việc sau 7 ngày (08:15). Xoá IP chấm công quá 90 ngày (03:10).
async function runHrmReminders(prisma, now = new Date()) {
  const cfg = await H.hrmConfig(prisma);
  if (!cfg.hrUserIds.length) return { sent: 0 };
  const today = WK.dayOf(now);
  let sent = 0;
  for (const n of [30, 7]) {
    const d = WK.addDays(today, n);
    const rows = await prisma.hrContract.findMany({ where: { status: 'ACTIVE', endDate: { gte: new Date(Date.parse(d + 'T00:00:00+07:00')), lt: new Date(Date.parse(d + 'T00:00:00+07:00') + 86_400_000) } } });
    const names = await require('../services/weekly-data').userNames(prisma, rows.map(r => r.userId));
    for (const r of rows) sent += await notify(prisma, cfg.hrUserIds, { type: 'HR_CONTRACT_END', title: `Hợp đồng ${r.number} (${names[r.userId] || ''}) hết hạn sau ${n} ngày`, body: `${H.CONTRACT_TYPES[r.type]} — kết thúc ${WK.fmtDY(d)}`, link: `#/hrm/people/${r.userId}` });
  }
  return { sent };
}
async function purgeAttendanceIps(prisma, now = new Date()) {
  const cut = WK.addDays(WK.dayOf(now), -90);
  const r = await prisma.hrAttendance.updateMany({ where: { day: { lt: cut }, OR: [{ inIp: { not: null } }, { outIp: { not: null } }] }, data: { inIp: null, outIp: null } });
  return { count: r.count };
}
module.exports.runHrmReminders = runHrmReminders;
module.exports.purgeAttendanceIps = purgeAttendanceIps;
