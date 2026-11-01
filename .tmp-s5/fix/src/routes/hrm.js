// Playground HRM — hồ sơ nhân sự, hợp đồng lao động, nghỉ phép, chấm công (không tính lương, không bảo hiểm).
// Bật bằng MODULES=hrm. Quyền: lib/policy.js (hrm.*); người phụ trách nhân sự (hr) do Ban GĐ chỉ định trong Thiết lập HRM.
// Dữ liệu Hạn chế: số CCCD, lương — mã hoá theo trường gắn chủ sở hữu (lib/crypto-field.js). Xem đầy đủ: chỉ trên giao diện,
// NHẬP LẠI MẬT KHẨU (Claude / computer use không được nhập mật khẩu), mỗi lượt ghi nhật ký; qua token Claude: 4 số cuối CCCD, không lương.
// Qua token Claude chỉ ghi được: tạo đơn nghỉ của chính mình (lib/tokens.js). Duyệt, chấm công, giải trình, hồ sơ: trên giao diện.
const bcrypt = require('bcryptjs');
const { fail, intParam, optionalInt, optionalDate, text, oneOf } = require('../lib/http');
const P = require('../lib/policy');
const H = require('../services/hrm');
const WK = require('../services/weekly');
const C = require('../lib/crypto-field');
const { notify } = require('../services/events');
const approval = require('../services/approval');

const ACTIVE_USER = { isActive: true, isRootAdmin: false, role: { not: 'admin' } };
const BASIC = ['employeeCode', 'startDate', 'status'];
const PRIVATE = ['birthDate', 'gender', 'phone', 'personalEmail', 'address', 'emergencyName', 'emergencyPhone', 'education'];
const CONTACT = ['phone', 'personalEmail', 'address', 'emergencyName', 'emergencyPhone'];
const GENDERS = { MALE: 'Nam', FEMALE: 'Nữ', OTHER: 'Khác' };
const LOCK_LEAVE = 730102; // pg_advisory_xact_lock(LOCK_LEAVE, userId): tạo đơn nghỉ tuần tự theo người (chống trùng / vượt phép khi gửi song song)
const dayStart = d => new Date(Date.parse(d + 'T00:00:00+07:00'));
const dayParam = (v, label) => { if (!WK.isDay(v)) fail(422, label + ' không hợp lệ (YYYY-MM-DD)', 'INVALID_DATE'); return v; };
const monthParam = v => (typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : WK.dayOf(new Date()).slice(0, 7));
const timeOn = (day, hhmm, label) => {
  if (hhmm == null || hhmm === '') return null;
  const t = H.normTime(hhmm);
  if (!t) fail(422, label + ' không hợp lệ (HH:MM)', 'INVALID_VALUE');
  return new Date(Date.parse(`${day}T${t}:00+07:00`));
};
const phone = (v, label) => { const s = text(v, label, { max: 30 }); if (s && !/^[0-9+().\s-]{6,30}$/.test(s)) fail(422, label + ' không hợp lệ', 'INVALID_VALUE'); return s || null; };
const emailOf = v => { const s = text(v, 'Email cá nhân', { max: 120 }); if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) fail(422, 'Email cá nhân không hợp lệ', 'INVALID_VALUE'); return s || null; };
const fmtRange = (a, b) => WK.fmtD(a) + (b && b !== a ? '–' + WK.fmtD(b) : '');

// Xác nhận lại mật khẩu trước khi hiện CCCD / lương: chặn AI điều khiển trình duyệt (không được nhập mật khẩu) và máy bỏ quên chưa khoá.
// Sai 5 lần → khoá chức năng hiện 15 phút (theo tài khoản).
const revealFails = new Map();
async function stepUp(req, audit) {
  if (req.via) fail(403, 'Không hiện số định danh / lương qua Claude — xem trên giao diện Kepper', 'NOT_VIA_AI');
  const now = Date.now(), f = revealFails.get(req.user.id);
  if (f && f.until > now) fail(429, 'Nhập sai mật khẩu nhiều lần — thử lại sau 15 phút', 'RATE_LIMITED');
  if (!(await bcrypt.compare(String(req.body?.password || ''), req.user.passwordHash || ''))) {
    const fresh = f && now - f.first < 15 * 60_000;
    const n = (fresh ? f.n : 0) + 1;
    revealFails.set(req.user.id, { n, first: fresh ? f.first : now, until: n >= 5 ? now + 15 * 60_000 : 0 });
    await audit(req, 'HR_REVEAL_FAILED', 'HrProfile', null, null, { attempt: n });
    fail(422, 'Mật khẩu không đúng', 'BAD_PASSWORD');
  }
  revealFails.delete(req.user.id);
}

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
  const tctx = (u, cfg, extra = {}) => ({ targetUserId: u.id, departmentId: u.departmentId, targetLeader: H.isLeader(u) || H.isDirector(u), targetDirector: H.isDirector(u),
    targetHr: cfg.hrUserIds.includes(u.id), ...extra });
  const activeIds = async ids => (ids.length ? (await prisma.user.findMany({ where: { id: { in: ids }, ...ACTIVE_USER }, select: { id: true } })).map(x => x.id) : []);
  // Người duyệt đơn / giải trình: lãnh đạo bộ phận (trừ chính người đó); lãnh đạo bộ phận / bộ phận không có lãnh đạo → Ban GĐ;
  // đơn của Ban GĐ → Ban GĐ khác + người phụ trách nhân sự (ghi nhận).
  async function approverIds(u, cfg) {
    const directors = (await prisma.user.findMany({ where: { ...ACTIVE_USER, role: 'director' }, select: { id: true } })).map(x => x.id).filter(id => id !== u.id);
    if (H.isDirector(u)) return [...new Set([...directors, ...(await activeIds(cfg.hrUserIds))])].filter(id => id !== u.id);
    if (H.isLeader(u) || u.departmentId == null) return directors;
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
      config: { workStart: cfg.workStart, workEnd: cfg.workEnd, lunchStart: cfg.lunchStart, lunchEnd: cfg.lunchEnd, graceMinutes: cfg.graceMinutes, workDays: cfg.workDays, holidays: cfg.holidays,
        annualDays: cfg.annualDays, officeNetworkOnly: cfg.officeNetworks.length > 0, ...(admin ? { officeNetworks: cfg.officeNetworks, hrUserIds: cfg.hrUserIds } : {}) },
      // IP Kepper nhìn thấy: kiểm tra trước khi bật "chỉ chấm công trong mạng văn phòng" (Docker Desktop thường che IP thật).
      yourIp: admin ? req.ip : undefined,
      me: { hr: s.hr, director: s.director, leader: s.leader, departmentId: s.departmentId, canConfig: admin, canRoles: P.can(s, 'edit', 'hrm.config', { field: 'roles' }), canImport: s.hr || s.director },
    });
  });
  app.put('/api/hrm/config', auth, async (req, res) => {
    if (req.via) fail(403, 'Thiết lập nhân sự làm trên giao diện Kepper', 'NOT_VIA_AI');
    const { cfg, s } = await ctxFor(req);
    P.assertCan(s, 'edit', 'hrm.config');
    const b = req.body || {}, next = { ...cfg };
    for (const [k, label] of [['workStart', 'Giờ vào'], ['workEnd', 'Giờ ra'], ['lunchStart', 'Giờ bắt đầu nghỉ trưa'], ['lunchEnd', 'Giờ hết nghỉ trưa']])
      if (b[k] !== undefined) { if (!H.HHMM.test(b[k])) fail(422, label + ' không hợp lệ'); next[k] = b[k]; }
    if (!(next.workStart < next.lunchStart && next.lunchStart <= next.lunchEnd && next.lunchEnd < next.workEnd)) fail(422, 'Cần: giờ vào < nghỉ trưa ≤ hết nghỉ trưa < giờ ra');
    if (b.graceMinutes !== undefined) { const n = Number(b.graceMinutes); if (!Number.isInteger(n) || n < 0 || n > 60) fail(422, 'Số phút cho phép đi muộn từ 0 đến 60'); next.graceMinutes = n; }
    if (b.annualDays !== undefined) { const n = Number(b.annualDays); if (!Number.isInteger(n) || n < 12 || n > 30) fail(422, 'Ngày phép năm từ 12 đến 30 (BLLĐ 2019 Đ113: tối thiểu 12)'); next.annualDays = n; }
    if (b.workDays !== undefined) { const w = [...new Set([].concat(b.workDays).map(Number))].filter(n => Number.isInteger(n) && n >= 0 && n <= 6); if (!w.length) fail(422, 'Chọn ít nhất một ngày làm việc'); next.workDays = w.sort(); }
    if (b.holidays !== undefined) { const h = [...new Set([].concat(b.holidays))]; if (h.length > 80 || h.some(d => !WK.isDay(d))) fail(422, 'Danh sách ngày lễ không hợp lệ (YYYY-MM-DD, tối đa 80)'); next.holidays = h.sort(); }
    if (b.officeNetworks !== undefined) { const n = [...new Set([].concat(b.officeNetworks).map(x => String(x).trim()).filter(Boolean))]; if (n.length > 10 || n.some(x => !H.cidrValid(x))) fail(422, 'Mạng văn phòng dạng 192.168.1.0/24 (tối đa 10)'); next.officeNetworks = n; }
    if (b.hrUserIds !== undefined) {
      P.assertCan(s, 'edit', 'hrm.config', { field: 'roles' });
      const ids = [...new Set([].concat(b.hrUserIds).map(Number))].filter(Number.isInteger);
      if (ids.length > 5) fail(422, 'Tối đa 5 người phụ trách nhân sự');
      // Hai người kiểm soát: Ban GĐ không tự chỉ định mình (người phụ trách nhân sự xem được CCCD, lương).
      if (ids.includes(s.userId) && !cfg.hrUserIds.includes(s.userId)) fail(403, 'Ban giám đốc không tự chỉ định mình phụ trách nhân sự — nhờ thành viên Ban giám đốc khác', 'FORBIDDEN');
      if (ids.length && (await prisma.user.count({ where: { id: { in: ids }, ...ACTIVE_USER } })) !== ids.length) fail(422, 'Người phụ trách nhân sự không hợp lệ');
      next.hrUserIds = ids;
    }
    await prisma.appSetting.upsert({ where: { key: H.CONFIG_KEY }, update: { value: next }, create: { key: H.CONFIG_KEY, value: next } });
    // Đổi ngày lễ / ngày làm việc: tính lại số ngày của đơn chưa kết thúc (số dư phép luôn tính theo lịch hiện tại).
    let recalculated = 0;
    if (b.holidays !== undefined || b.workDays !== undefined) {
      const open = await prisma.hrLeave.findMany({ where: { status: { in: ['PENDING', 'APPROVED'] }, toDate: { gte: dayStart(WK.dayOf(new Date())) } } });
      for (const l of open) {
        const d = H.leaveDays(WK.dayOf(l.fromDate), WK.dayOf(l.toDate), l.halfDay, next);
        if (Number.isFinite(d) && d !== l.days) { await prisma.hrLeave.update({ where: { id: l.id }, data: { days: d } }); recalculated++; }
      }
    }
    await audit(req, 'HRM_CONFIG', 'HrmConfig', null, { hrUserIds: cfg.hrUserIds }, { fields: Object.keys(b), hrUserIds: next.hrUserIds, recalculated });
    const added = next.hrUserIds.filter(id => !cfg.hrUserIds.includes(id));
    if (added.length) await notify(prisma, added, { type: 'HRM_ROLE', title: 'Bạn được Ban giám đốc chỉ định phụ trách nhân sự trên Kepper', body: 'Bạn xem / sửa hồ sơ, hợp đồng, số định danh của nhân sự (trừ của chính mình). Mọi lượt xem số định danh / lương được ghi nhật ký.', link: '#/hrm/people' });
    res.json({ ok: true, recalculated });
  });

  // ---------- Hồ sơ ----------
  function profileOut(u, prof, s, cfg, { via = false } = {}) {
    const c = tctx(u, cfg);
    const out = { userId: u.id, fullName: u.fullName, username: u.username, displayTitle: u.displayTitle, department: u.department || null, isActive: u.isActive };
    for (const k of BASIC) out[k] = prof?.[k] ?? null;
    if (P.can(s, 'view', 'hrm.profile', { ...c, field: 'private' })) for (const k of PRIVATE) out[k] = prof?.[k] ?? null;
    if (P.can(s, 'view', 'hrm.identity', c)) out.identity = { last4: prof?.idNumberLast4 || null, issuedOn: prof?.idIssuedOn || null, issuedPlace: prof?.idIssuedPlace || null, canReveal: !via && !!prof?.idNumberEnc };
    out.can = { edit: P.can(s, 'edit', 'hrm.profile', c), editContact: P.can(s, 'edit', 'hrm.profile', { ...c, op: 'contact' }), identity: P.can(s, 'edit', 'hrm.identity', c),
      contracts: P.can(s, 'view', 'hrm.contract', c), editContracts: P.can(s, 'edit', 'hrm.contract', c) };
    return out;
  }
  // Lương không nằm trong phản hồi thường — chỉ hiện khi bấm "Hiện" + nhập lại mật khẩu (POST …/salary/reveal); không bao giờ qua Claude.
  function contractOut(k, s, u, cfg, via) {
    const salaryOk = !via && P.can(s, 'view', 'hrm.contract', tctx(u, cfg));
    return { id: k.id, number: k.number, type: { code: k.type, label: H.CONTRACT_TYPES[k.type] || k.type }, position: k.position, startDate: k.startDate, endDate: k.endDate,
      status: k.status, signedAt: k.signedAt, note: k.note, hasSalary: salaryOk ? !!k.salaryEnc : undefined, editable: P.can(s, 'edit', 'hrm.contract', tctx(u, cfg)) };
  }
  // Số dư phép năm: đơn qua năm tính phần rơi vào năm đó; theo lịch ngày lễ HIỆN TẠI.
  async function balance(u, prof, cfg, year) {
    const rows = await prisma.hrLeave.findMany({ where: { userId: u.id, type: 'ANNUAL', status: { in: ['APPROVED', 'PENDING'] }, fromDate: { lt: dayStart(`${year + 1}-01-01`) }, toDate: { gte: dayStart(`${year}-01-01`) } } });
    let used = 0, pending = 0;
    for (const l of rows) { const d = H.leaveDaysInYear(WK.dayOf(l.fromDate), WK.dayOf(l.toDate), l.halfDay, year, cfg); if (l.status === 'APPROVED') used += d; else pending += d; }
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
    res.json({ profile: profileOut(u, prof, s, cfg, { via: !!req.via }), contracts: contracts.map(k => contractOut(k, s, u, cfg, !!req.via)),
      leave: await balance(u, prof, cfg, Number(WK.dayOf(new Date()).slice(0, 4))), today: today ? attOut(today, s, req) : null, workday: H.isWorkday(WK.dayOf(new Date()), cfg) });
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
    const rows = users.filter(u => P.can(s, 'view', 'hrm.profile', tctx(u, cfg))).map(u => {
      const o = profileOut(u, pm.get(u.id), s, cfg, { via: !!req.via });
      if (P.can(s, 'view', 'hrm.contract', tctx(u, cfg))) {
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
    P.assertCan(s, 'view', 'hrm.profile', tctx(u, cfg));
    const prof = await prisma.hrProfile.findUnique({ where: { userId: u.id } });
    const out = profileOut(u, prof, s, cfg, { via: !!req.via });
    if (out.can.contracts) out.contracts = (await prisma.hrContract.findMany({ where: { userId: u.id }, orderBy: { startDate: 'desc' } })).map(k => contractOut(k, s, u, cfg, !!req.via));
    out.leave = P.can(s, 'view', 'hrm.leave', tctx(u, cfg)) ? await balance(u, prof, cfg, Number(WK.dayOf(new Date()).slice(0, 4))) : undefined;
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(out);
  });
  app.put('/api/hrm/people/:userId/profile', auth, async (req, res) => {
    if (req.via) fail(403, 'Hồ sơ nhân sự sửa trên giao diện Kepper', 'NOT_VIA_AI');
    const { cfg, s } = await ctxFor(req);
    const u = await target(intParam(req.params.userId));
    const full = P.can(s, 'edit', 'hrm.profile', tctx(u, cfg));
    if (!full) P.assertCan(s, 'edit', 'hrm.profile', tctx(u, cfg, { op: 'contact' }));
    const b = req.body || {}, data = {};
    const allowed = full ? [...BASIC, ...PRIVATE] : CONTACT;
    for (const k of Object.keys(b)) if (![...BASIC, ...PRIVATE].includes(k)) fail(422, `Trường không hợp lệ: ${k}`, 'INVALID_FIELD');
    for (const k of Object.keys(b)) if (!allowed.includes(k)) fail(403, 'Bạn chỉ sửa được thông tin liên hệ của mình — thông tin khác do người phụ trách nhân sự (của người phụ trách nhân sự: Ban giám đốc) cập nhật', 'FORBIDDEN');
    if (b.employeeCode !== undefined) {
      // Mã NV so khớp không phân biệt hoa thường (nhập máy chấm công so theo mã) → lưu chữ in hoa, kiểm trùng.
      data.employeeCode = (text(b.employeeCode, 'Mã nhân viên', { max: 20 }) || '').toUpperCase() || null;
      if (data.employeeCode && await prisma.hrProfile.findFirst({ where: { employeeCode: { equals: data.employeeCode, mode: 'insensitive' }, userId: { not: u.id } } })) fail(409, 'Mã nhân viên đã dùng cho người khác', 'DUPLICATE');
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

  // Số định danh: hiện đầy đủ chỉ trên giao diện + nhập lại mật khẩu; mỗi lượt ghi nhật ký.
  app.post('/api/hrm/people/:userId/identity/reveal', auth, async (req, res) => {
    const { cfg, s } = await ctxFor(req);
    const u = await target(intParam(req.params.userId));
    P.assertCan(s, 'view', 'hrm.identity', tctx(u, cfg));
    await stepUp(req, audit);
    const prof = await prisma.hrProfile.findUnique({ where: { userId: u.id } });
    await audit(req, 'HR_IDENTITY_VIEW', 'HrProfile', u.id, null, { self: u.id === req.user.id });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ idNumber: prof?.idNumberEnc ? C.tryDecrypt(prof.idNumberEnc, C.AAD.identity(u.id)) : null, issuedOn: prof?.idIssuedOn || null, issuedPlace: prof?.idIssuedPlace || null });
  });
  app.put('/api/hrm/people/:userId/identity', auth, async (req, res) => {
    if (req.via) fail(403, 'Số định danh cập nhật trên giao diện Kepper', 'NOT_VIA_AI');
    const { cfg, s } = await ctxFor(req);
    const u = await target(intParam(req.params.userId));
    P.assertCan(s, 'edit', 'hrm.identity', tctx(u, cfg));
    const b = req.body || {}, data = {};
    if (b.idNumber !== undefined) {
      const n = String(b.idNumber || '').replace(/\s/g, '');
      if (n && !/^\d{12}$/.test(n)) fail(422, 'Số CCCD gồm 12 chữ số', 'INVALID_VALUE');
      data.idNumberEnc = n ? C.encrypt(n, C.AAD.identity(u.id)) : null; data.idNumberLast4 = n ? C.last4(n) : null;
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
    if (d.type === 'INDEFINITE') d.endDate = null;
    return d;
  };
  // Lương: không gửi trường = giữ nguyên; null = xoá.
  const salaryOf = b => {
    if (b.salary === undefined) return undefined;
    if (b.salary === null || b.salary === '') return null;
    const n = Number(b.salary);
    if (!Number.isFinite(n) || n < 0 || n > 1e10) fail(422, 'Mức lương không hợp lệ', 'INVALID_VALUE');
    return String(Math.round(n));
  };
  app.post('/api/hrm/people/:userId/contracts', auth, async (req, res) => {
    if (req.via) fail(403, 'Hợp đồng lao động cập nhật trên giao diện Kepper', 'NOT_VIA_AI');
    const { cfg, s } = await ctxFor(req);
    const u = await target(intParam(req.params.userId));
    P.assertCan(s, 'edit', 'hrm.contract', tctx(u, cfg));
    const d = contractData(req.body || {}, false), salary = salaryOf(req.body || {});
    if (d.endDate && d.endDate < d.startDate) fail(422, 'Ngày kết thúc trước ngày bắt đầu', 'INVALID_DATE');
    const row = await prisma.$transaction(async tx => {
      const k = await tx.hrContract.create({ data: { userId: u.id, ...d, createdById: req.user.id } });
      return salary ? tx.hrContract.update({ where: { id: k.id }, data: { salaryEnc: C.encrypt(salary, C.AAD.salary(k.id)) } }) : k;
    });
    await audit(req, 'HR_CONTRACT_CREATE', 'HrContract', row.id, null, { userId: u.id, type: row.type, fields: [...Object.keys(d), ...(salary ? ['salary'] : [])] });
    res.status(201).json({ id: row.id });
  });
  app.patch('/api/hrm/contracts/:id', auth, async (req, res) => {
    if (req.via) fail(403, 'Hợp đồng lao động cập nhật trên giao diện Kepper', 'NOT_VIA_AI');
    const { cfg, s } = await ctxFor(req);
    const k = await prisma.hrContract.findUnique({ where: { id: intParam(req.params.id) } });
    if (!k) fail(404, 'Không tìm thấy hợp đồng', 'NOT_FOUND');
    const u = await target(k.userId);
    P.assertCan(s, 'edit', 'hrm.contract', tctx(u, cfg));
    const d = contractData(req.body || {}, true), salary = salaryOf(req.body || {});
    if (salary !== undefined) d.salaryEnc = salary ? C.encrypt(salary, C.AAD.salary(k.id)) : null;
    const start = d.startDate || k.startDate, end = d.endDate !== undefined ? d.endDate : k.endDate;
    if (end && end < start) fail(422, 'Ngày kết thúc trước ngày bắt đầu', 'INVALID_DATE');
    await prisma.hrContract.update({ where: { id: k.id }, data: d });
    await audit(req, 'HR_CONTRACT_UPDATE', 'HrContract', k.id, null, { userId: u.id, fields: Object.keys(d).map(x => (x === 'salaryEnc' ? 'salary' : x)) });
    res.json({ ok: true });
  });
  app.post('/api/hrm/contracts/:id/salary/reveal', auth, async (req, res) => {
    const { cfg, s } = await ctxFor(req);
    const k = await prisma.hrContract.findUnique({ where: { id: intParam(req.params.id) } });
    if (!k) fail(404, 'Không tìm thấy hợp đồng', 'NOT_FOUND');
    const u = await target(k.userId);
    P.assertCan(s, 'view', 'hrm.contract', tctx(u, cfg));
    await stepUp(req, audit);
    await audit(req, 'HR_SALARY_VIEW', 'HrContract', k.id, null, { userId: u.id, self: u.id === req.user.id });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ salary: k.salaryEnc ? Number(C.tryDecrypt(k.salaryEnc, C.AAD.salary(k.id))) || null : null });
  });

  // ---------- Nghỉ phép ----------
  // Qua Claude, đơn của NGƯỜI KHÁC: nghỉ ốm / thai sản (thông tin sức khoẻ — DLCN nhạy cảm) gộp thành "Nghỉ theo chế độ", bỏ lý do
  // (tối thiểu hoá dữ liệu chuyển ra nước ngoài). Trên giao diện, người duyệt vẫn thấy đủ để quyết định.
  const leaveOut = (l, s, cfg, users, u, via = false) => {
    const masked = via && l.userId !== s.userId;
    const type = masked && ['SICK', 'MATERNITY'].includes(l.type) ? { code: 'PROTECTED', label: 'Nghỉ theo chế độ' } : { code: l.type, label: H.LEAVE_TYPES[l.type] || l.type };
    const started = WK.dayOf(l.fromDate) <= WK.dayOf(new Date());
    return { id: l.id, user: { id: l.userId, fullName: users[l.userId]?.fullName || null, department: users[l.userId]?.department || null },
      type, fromDate: WK.dayOf(l.fromDate), toDate: WK.dayOf(l.toDate), halfDay: l.halfDay, days: l.days, reason: masked ? undefined : l.reason,
      status: { code: l.status, label: H.LEAVE_STATUS[l.status] }, approver: l.approverId ? users[l.approverId]?.fullName || null : null, decidedAt: l.decidedAt, decisionNote: masked ? undefined : l.decisionNote, createdAt: l.createdAt,
      can: u ? { decide: l.status === 'PENDING' && P.can(s, 'edit', 'hrm.leave', tctx(u, cfg, { op: 'approve' })),
        cancel: (l.status === 'PENDING' || (l.status === 'APPROVED' && (!started || s.hr))) && P.can(s, 'edit', 'hrm.leave', tctx(u, cfg, { op: 'cancel' })) } : undefined };
  };
  async function usersMap(ids) {
    const rows = await prisma.user.findMany({ where: { id: { in: [...new Set(ids.filter(Boolean))] } }, include: { permissions: true, department: { select: { id: true, name: true } } } });
    return Object.fromEntries(rows.map(u => [u.id, u]));
  }
  // Người duyệt thấy trước khi duyệt: việc người nghỉ đang chủ trì đến hạn trong thời gian nghỉ (chỉ mã việc — nội dung xem trong dự án
  // theo quyền) và buổi giao ban thứ Hai trùng ngày nghỉ nếu người nghỉ là lãnh đạo bộ phận (cần cử người dự thay / báo vắng).
  async function leaveConflicts(u, from, to) {
    const items = await prisma.workItem.findMany({ where: { archivedAt: null, assignees: { some: { userId: u.id } }, state: { category: { notIn: ['COMPLETED', 'CANCELLED'] } },
      dueDate: { gte: dayStart(from), lt: dayStart(WK.addDays(to, 1)) }, project: { archivedAt: null, deletedAt: null } },
    select: { number: true, project: { select: { key: true } } }, orderBy: { dueDate: 'asc' }, take: 10 });
    const leader = u.departmentId != null && (await approval.deptLeaderIds(prisma, u.departmentId)).includes(u.id);
    const meetings = [];
    if (leader) for (let d = from; d <= to && meetings.length < 10; d = WK.addDays(d, 1)) if (new Date(d + 'T00:00:00Z').getUTCDay() === 1) meetings.push(d);
    return { due: items.map(i => `${i.project.key}-${i.number}`), meetings };
  }
  // scope: mine (của tôi) | approve (chờ tôi duyệt) | team (bộ phận HIỆN TẠI của tôi / mọi người với HR, Ban GĐ)
  app.get('/api/hrm/leaves', auth, async (req, res) => {
    const { cfg, s } = await ctxFor(req);
    const scope = ['mine', 'approve', 'team'].includes(req.query.scope) ? req.query.scope : 'mine';
    const year = /^\d{4}$/.test(String(req.query.year || '')) ? Number(req.query.year) : Number(WK.dayOf(new Date()).slice(0, 4));
    const where = { fromDate: { lt: dayStart(`${year + 1}-01-01`) }, toDate: { gte: dayStart(`${year}-01-01`) } };
    if (scope === 'mine') where.userId = s.userId;
    else if (scope === 'approve') { where.status = 'PENDING'; where.userId = { not: s.userId }; delete where.fromDate; delete where.toDate; }
    else if (!s.hr && !s.director) {
      if (!s.leader) fail(403, 'Chỉ lãnh đạo bộ phận, người phụ trách nhân sự, Ban giám đốc xem đơn nghỉ của bộ phận', 'FORBIDDEN');
      // Theo bộ phận hiện tại của người nghỉ (người chuyển bộ phận: lãnh đạo mới thấy cả đơn cũ).
      where.userId = { in: (await prisma.user.findMany({ where: { departmentId: s.departmentId ?? -1 }, select: { id: true } })).map(x => x.id) };
    }
    const rows = await prisma.hrLeave.findMany({ where, orderBy: [{ fromDate: 'desc' }], take: 1000 });
    const users = await usersMap(rows.flatMap(l => [l.userId, l.approverId]));
    const out = [];
    for (const l of rows) {
      const u = users[l.userId];
      if (!u || !P.can(s, 'view', 'hrm.leave', tctx(u, cfg))) continue;
      const o = leaveOut(l, s, cfg, users, u, !!req.via);
      if (scope === 'approve') {
        if (!o.can.decide) continue;
        // Người duyệt thấy số phép còn lại (đã trừ chính đơn này nếu là phép năm) để biết đơn có vượt không.
        if (l.type === 'ANNUAL') { const prof = await prisma.hrProfile.findUnique({ where: { userId: u.id } }); o.balance = await balance(u, prof, cfg, Number(o.fromDate.slice(0, 4))); }
        if (!req.via) o.conflicts = await leaveConflicts(u, o.fromDate, o.toDate);
      }
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
    P.assertCan(s, 'edit', 'hrm.leave', tctx(u, cfg, { op: 'create' }));
    const type = oneOf(b.type, Object.keys(H.LEAVE_TYPES), 'Loại nghỉ') || 'ANNUAL';
    const from = dayParam(b.fromDate, 'Từ ngày'), to = dayParam(b.toDate || b.fromDate, 'Đến ngày');
    if (to < from) fail(422, 'Đến ngày phải sau từ ngày', 'INVALID_DATE');
    if (WK.addDays(from, H.MAX_LEAVE_DAYS) < to) fail(422, `Một đơn tối đa ${H.MAX_LEAVE_DAYS} ngày`, 'INVALID_DATE');
    const today = WK.dayOf(new Date());
    if (from < WK.addDays(today, -30) && !s.hr) fail(422, 'Đơn nghỉ bổ sung tối đa 30 ngày trước — quá hạn liên hệ người phụ trách nhân sự', 'INVALID_DATE');
    if (from > WK.addDays(today, 366)) fail(422, 'Chỉ xin nghỉ trong vòng một năm tới', 'INVALID_DATE');
    const halfDay = oneOf(b.halfDay || 'NONE', ['NONE', 'AM', 'PM'], 'Nửa ngày');
    const days = H.leaveDays(from, to, halfDay, cfg);
    if (Number.isNaN(days)) fail(422, 'Nghỉ nửa ngày chỉ áp dụng khi từ ngày = đến ngày và là ngày làm việc', 'INVALID_VALUE');
    if (!days) fail(422, 'Khoảng ngày chọn không có ngày làm việc nào', 'INVALID_VALUE');
    const reason = text(b.reason, 'Lý do', { max: 200 }) || '';
    const row = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_LEAVE}::int, ${u.id}::int)`;
      const overlaps = await tx.hrLeave.findMany({ where: { userId: u.id, status: { in: ['PENDING', 'APPROVED'] }, fromDate: { lte: dayStart(to) }, toDate: { gte: dayStart(from) } } });
      // Sáng một loại, chiều một loại trong cùng ngày: không trùng.
      const clash = overlaps.find(o => !(from === to && halfDay !== 'NONE' && WK.dayOf(o.fromDate) === from && WK.dayOf(o.toDate) === from && o.halfDay !== 'NONE' && o.halfDay !== halfDay));
      if (clash) fail(409, `Trùng đơn nghỉ ${WK.fmtDY(WK.dayOf(clash.fromDate))}–${WK.fmtDY(WK.dayOf(clash.toDate))} (${H.LEAVE_STATUS[clash.status]})`, 'OVERLAP');
      if (type === 'ANNUAL' && !(s.hr && b.force === true)) {
        const prof = await tx.hrProfile.findUnique({ where: { userId: u.id } });
        for (const y of H.yearsOf(from, to)) {
          const need = H.leaveDaysInYear(from, to, halfDay, y, cfg);
          if (!need) continue;
          const bal = await balance(u, prof, cfg, y);
          if (need > bal.remaining) fail(422, `Phép năm ${y} còn ${bal.remaining} ngày (đã dùng ${bal.used}, chờ duyệt ${bal.pending}), đơn cần ${need} ngày của năm ${y} — chọn "Nghỉ không lương" hoặc liên hệ người phụ trách nhân sự`, 'QUOTA');
        }
      }
      return tx.hrLeave.create({ data: { userId: u.id, departmentId: u.departmentId, type, fromDate: dayStart(from), toDate: dayStart(to), halfDay, days, reason, createdById: req.user.id } });
    }, { timeout: 20_000 });
    await audit(req, 'HR_LEAVE_CREATE', 'HrLeave', row.id, null, { userId: u.id, type, from, to, days, forced: type === 'ANNUAL' && s.hr && b.force === true });
    // Thông báo trung tính (không ghi loại nghỉ — nghỉ ốm là thông tin sức khoẻ; thông báo còn đi qua Claude / ứng dụng khác).
    await notify(prisma, await approverIds(u, cfg), { type: 'HR_LEAVE_REQUEST', title: `${u.fullName} gửi đơn nghỉ ${String(days).replace('.', ',')} ngày (${fmtRange(from, to)})`, body: 'Duyệt trên Kepper → Nhân sự → Chờ duyệt', link: '#/hrm/approve' }, req.user.id);
    const noHoliday = H.yearsOf(from, to).filter(y => !H.hasHolidays(y, cfg));
    res.status(201).json({ id: row.id, days, status: 'PENDING', next: 'Đơn đã gửi người duyệt (Claude không duyệt thay).',
      warning: noHoliday.length ? `Năm ${noHoliday.join(', ')} chưa có danh sách ngày lễ — số ngày sẽ được tính lại khi người phụ trách nhân sự cập nhật` : undefined });
  });
  app.post('/api/hrm/leaves/:id/decide', auth, async (req, res) => {
    if (req.via) fail(403, 'Duyệt đơn làm trên giao diện Kepper', 'NOT_VIA_AI');
    const { cfg, s } = await ctxFor(req);
    const l = await prisma.hrLeave.findUnique({ where: { id: intParam(req.params.id) } });
    if (!l) fail(404, 'Không tìm thấy đơn', 'NOT_FOUND');
    const u = await target(l.userId);
    P.assertCan(s, 'edit', 'hrm.leave', tctx(u, cfg, { op: 'approve' }));
    const decision = oneOf(req.body?.decision, ['APPROVE', 'REJECT'], 'Quyết định');
    const note = text(req.body?.note, 'Ý kiến', { max: 300 }) || null;
    if (decision === 'REJECT' && !note) fail(422, 'Từ chối cần ghi ý kiến', 'REQUIRED');
    const done = await prisma.hrLeave.updateMany({ where: { id: l.id, status: 'PENDING' }, data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', approverId: req.user.id, decidedAt: new Date(), decisionNote: note } });
    if (!done.count) fail(409, 'Đơn đã được xử lý', 'CONFLICT');
    await audit(req, decision === 'APPROVE' ? 'HR_LEAVE_APPROVE' : 'HR_LEAVE_REJECT', 'HrLeave', l.id, null, { userId: l.userId });
    await notify(prisma, [l.userId], { type: 'HR_LEAVE_DECIDED', title: `Đơn nghỉ ${fmtRange(WK.dayOf(l.fromDate), WK.dayOf(l.toDate))} ${decision === 'APPROVE' ? 'đã được duyệt' : 'bị từ chối'}`, body: note, link: '#/hrm' });
    res.json({ ok: true });
  });
  app.post('/api/hrm/leaves/:id/cancel', auth, async (req, res) => {
    if (req.via) fail(403, 'Huỷ đơn làm trên giao diện Kepper', 'NOT_VIA_AI');
    const { cfg, s } = await ctxFor(req);
    const l = await prisma.hrLeave.findUnique({ where: { id: intParam(req.params.id) } });
    if (!l) fail(404, 'Không tìm thấy đơn', 'NOT_FOUND');
    const u = await target(l.userId);
    P.assertCan(s, 'edit', 'hrm.leave', tctx(u, cfg, { op: 'cancel' }));
    if (!['PENDING', 'APPROVED'].includes(l.status)) fail(409, 'Đơn không còn hiệu lực', 'CONFLICT');
    if (l.status === 'APPROVED' && WK.dayOf(l.fromDate) <= WK.dayOf(new Date()) && !s.hr) fail(409, 'Đơn đã duyệt và đã bắt đầu — liên hệ người phụ trách nhân sự để điều chỉnh', 'CONFLICT');
    // Có điều kiện trạng thái: đơn vừa được duyệt / từ chối giữa chừng → báo tải lại, không huỷ nhầm.
    const done = await prisma.hrLeave.updateMany({ where: { id: l.id, status: l.status }, data: { status: 'CANCELLED' } });
    if (!done.count) fail(409, 'Đơn vừa thay đổi trạng thái — tải lại trang', 'CONFLICT');
    await audit(req, 'HR_LEAVE_CANCEL', 'HrLeave', l.id, null, { userId: l.userId, was: l.status });
    if (l.status === 'APPROVED' && l.approverId) await notify(prisma, [l.approverId], { type: 'HR_LEAVE_CANCELLED', title: `${u.fullName} huỷ đơn nghỉ ${fmtRange(WK.dayOf(l.fromDate), WK.dayOf(l.toDate))}`, link: '#/hrm/approve' }, req.user.id);
    res.json({ ok: true });
  });

  // ---------- Chấm công ----------
  // Qua Claude, bản ghi của NGƯỜI KHÁC: bỏ lý do giải trình / ghi chú (có thể chứa thông tin sức khoẻ, đời tư).
  function attOut(r, s, req) {
    const masked = !!req?.via && r.userId !== s?.userId;
    return { id: r.id, day: r.day, checkIn: r.checkIn, checkOut: r.checkOut, minutesLate: r.minutesLate, minutesEarly: r.minutesEarly, note: masked ? undefined : r.note,
      adjust: r.adjustStatus ? { status: r.adjustStatus, reason: masked ? undefined : r.adjustReason, note: masked ? undefined : r.adjustNote, in: r.adjustIn, out: r.adjustOut, at: r.adjustAt } : null };
  }
  // Chấm công: chỉ chính người đó, trên giao diện (không qua Claude); giờ lấy từ máy chủ, không tin giờ máy người dùng.
  app.post('/api/hrm/attendance/check', auth, async (req, res) => {
    if (req.via) fail(403, 'Chấm công không làm qua Claude — bấm trên Kepper', 'NOT_VIA_AI');
    const { cfg, s } = await ctxFor(req);
    const u = await target(req.user.id);
    P.assertCan(s, 'edit', 'hrm.attendance', tctx(u, cfg, { op: 'check' }));
    if (cfg.officeNetworks.length && !H.inNetworks(req.ip, cfg.officeNetworks)) fail(403, 'Chỉ chấm công trong mạng văn phòng — ở ngoài: gửi giải trình', 'OUTSIDE_OFFICE');
    const kind = oneOf(req.body?.kind, ['in', 'out'], 'Loại chấm công');
    const now = new Date(), day = WK.dayOf(now);
    let row = await prisma.hrAttendance.findUnique({ where: { userId_day: { userId: u.id, day } } });
    if (!row) {
      try { row = await prisma.hrAttendance.create({ data: { userId: u.id, departmentId: u.departmentId, day, ...(kind === 'in' ? { checkIn: now, inIp: req.ip || null } : { checkOut: now, outIp: req.ip || null }), ...H.lateEarly(kind === 'in' ? now : null, kind === 'out' ? now : null, cfg) } }); }
      catch (error) { if (error.code !== 'P2002') throw error; row = await prisma.hrAttendance.findUnique({ where: { userId_day: { userId: u.id, day } } }); if (kind === 'in') fail(409, 'Đã chấm vào hôm nay', 'CONFLICT'); }
      if (row.checkIn?.getTime() === now.getTime() || row.checkOut?.getTime() === now.getTime()) return res.json(attOut(row, s, req));
    }
    const checkIn = kind === 'in' ? now : row.checkIn, checkOut = kind === 'out' ? now : row.checkOut;
    // Giải trình đã duyệt: giữ kết quả, không tính lại phút muộn / sớm từ giờ gốc.
    const le = row.adjustStatus === 'APPROVED' ? {} : H.lateEarly(checkIn, checkOut, cfg);
    // Chấm vào: chỉ ghi khi chưa có giờ vào (bấm hai lần / hai thiết bị không ghi đè giờ vào).
    const done = await prisma.hrAttendance.updateMany({ where: { id: row.id, ...(kind === 'in' ? { checkIn: null } : {}) },
      data: kind === 'in' ? { checkIn: now, inIp: req.ip || null, ...le } : { checkOut: now, outIp: req.ip || null, ...le } });
    if (!done.count) fail(409, 'Đã chấm vào hôm nay', 'CONFLICT');
    res.json(attOut(await prisma.hrAttendance.findUnique({ where: { id: row.id } }), s, req));
  });
  // Giải trình (quên chấm, đi công tác, đi muộn có lý do) — ngày trong 31 ngày gần nhất.
  app.post('/api/hrm/attendance/explain', auth, async (req, res) => {
    if (req.via) fail(403, 'Giải trình chấm công làm trên giao diện Kepper', 'NOT_VIA_AI');
    const { cfg, s } = await ctxFor(req);
    const u = await target(req.user.id);
    P.assertCan(s, 'edit', 'hrm.attendance', tctx(u, cfg, { op: 'explain' }));
    const b = req.body || {}, today = WK.dayOf(new Date());
    const day = dayParam(b.day, 'Ngày');
    if (day > today || day < WK.addDays(today, -31)) fail(422, 'Giải trình cho ngày trong 31 ngày gần nhất', 'INVALID_DATE');
    const reason = text(b.reason, 'Lý do', { required: true, max: 300 });
    const data = { adjustStatus: 'PENDING', adjustReason: reason, adjustNote: null, adjustIn: timeOn(day, b.in, 'Giờ vào'), adjustOut: timeOn(day, b.out, 'Giờ ra'), adjustById: null, adjustAt: new Date() };
    if (data.adjustIn && data.adjustOut && data.adjustOut <= data.adjustIn) fail(422, 'Giờ ra phải sau giờ vào', 'INVALID_VALUE');
    const cur = await prisma.hrAttendance.findUnique({ where: { userId_day: { userId: u.id, day } } });
    if (cur?.adjustStatus === 'APPROVED') fail(409, 'Ngày này đã được duyệt giải trình', 'CONFLICT');
    const row = await prisma.hrAttendance.upsert({ where: { userId_day: { userId: u.id, day } }, update: data, create: { userId: u.id, departmentId: u.departmentId, day, ...data } });
    await notify(prisma, await approverIds(u, cfg), { type: 'HR_ATT_EXPLAIN', title: `${u.fullName} gửi giải trình chấm công ${WK.fmtDY(day)}`, body: 'Duyệt trên Kepper → Nhân sự → Chờ duyệt', link: '#/hrm/approve' }, req.user.id);
    res.json(attOut(row, s, req));
  });
  app.post('/api/hrm/attendance/:id/decide', auth, async (req, res) => {
    if (req.via) fail(403, 'Duyệt giải trình làm trên giao diện Kepper', 'NOT_VIA_AI');
    const { cfg, s } = await ctxFor(req);
    const r = await prisma.hrAttendance.findUnique({ where: { id: intParam(req.params.id) } });
    if (!r || r.adjustStatus !== 'PENDING') fail(404, 'Không có giải trình chờ duyệt', 'NOT_FOUND');
    const u = await target(r.userId);
    P.assertCan(s, 'edit', 'hrm.attendance', tctx(u, cfg, { op: 'approve' }));
    const decision = oneOf(req.body?.decision, ['APPROVE', 'REJECT'], 'Quyết định');
    const note = text(req.body?.note, 'Ý kiến', { max: 300 }) || null;
    if (decision === 'REJECT' && !note) fail(422, 'Từ chối cần ghi ý kiến', 'REQUIRED');
    // Giữ nguyên giờ gốc (bằng chứng); duyệt thì tính đi muộn / về sớm theo giờ giải trình.
    const le = decision === 'APPROVE' ? H.lateEarly(r.adjustIn || r.checkIn, r.adjustOut || r.checkOut, cfg) : {};
    const done = await prisma.hrAttendance.updateMany({ where: { id: r.id, adjustStatus: 'PENDING' }, data: { adjustStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', adjustNote: note, adjustById: req.user.id, adjustAt: new Date(), ...le } });
    if (!done.count) fail(409, 'Giải trình đã được xử lý', 'CONFLICT');
    await audit(req, decision === 'APPROVE' ? 'HR_ATT_APPROVE' : 'HR_ATT_REJECT', 'HrAttendance', r.id, null, { userId: r.userId, day: r.day });
    await notify(prisma, [r.userId], { type: 'HR_ATT_DECIDED', title: `Giải trình chấm công ${WK.fmtDY(r.day)} ${decision === 'APPROVE' ? 'đã được duyệt' : 'bị từ chối'}`, body: note, link: '#/hrm' });
    res.json({ ok: true });
  });
  app.get('/api/hrm/attendance/pending', auth, async (req, res) => {
    const { cfg, s } = await ctxFor(req);
    const rows = await prisma.hrAttendance.findMany({ where: { adjustStatus: 'PENDING', userId: { not: s.userId } }, orderBy: { day: 'asc' }, take: 300 });
    const users = await usersMap(rows.map(r => r.userId));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(rows.filter(r => users[r.userId] && P.can(s, 'edit', 'hrm.attendance', tctx(users[r.userId], cfg, { op: 'approve' })))
      .map(r => ({ ...attOut(r, s, req), user: { id: r.userId, fullName: users[r.userId].fullName, department: users[r.userId].department } })));
  });
  const monthRange = month => ({ from: dayStart(month + '-01'), to: dayStart(WK.addDays(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10), 1)) });
  // Bảng công tháng của một người.
  app.get('/api/hrm/attendance', auth, async (req, res) => {
    const { cfg, s } = await ctxFor(req);
    const u = await target(optionalInt(req.query.userId, 'Nhân sự') ?? s.userId);
    P.assertCan(s, 'view', 'hrm.attendance', tctx(u, cfg));
    const month = monthParam(req.query.month), mr = monthRange(month);
    const [records, leaves, prof] = await Promise.all([
      prisma.hrAttendance.findMany({ where: { userId: u.id, day: { startsWith: month } } }),
      prisma.hrLeave.findMany({ where: { userId: u.id, status: 'APPROVED', fromDate: { lt: mr.to }, toDate: { gte: mr.from } } }),
      prisma.hrProfile.findUnique({ where: { userId: u.id }, select: { startDate: true } }),
    ]);
    const sheet = H.monthSheet(month, records.map(r => attOut(r, s, req)), leaves, cfg, undefined, { startDate: prof?.startDate });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ user: { id: u.id, fullName: u.fullName }, month, sheet, totals: H.sheetTotals(sheet), self: u.id === s.userId });
  });
  // Tổng hợp công tháng theo người: lãnh đạo bộ phận (bộ phận mình), người phụ trách nhân sự, Ban GĐ. Gồm người đã nghỉ việc có công trong tháng.
  app.get('/api/hrm/attendance/team', auth, async (req, res) => {
    const { cfg, s } = await ctxFor(req);
    if (!s.hr && !s.director && !s.leader) fail(403, 'Tổng hợp công dành cho lãnh đạo bộ phận, người phụ trách nhân sự, Ban giám đốc', 'FORBIDDEN');
    const month = monthParam(req.query.month), mr = monthRange(month);
    const withRecords = (await prisma.hrAttendance.findMany({ where: { day: { startsWith: month } }, distinct: ['userId'], select: { userId: true } })).map(r => r.userId);
    const where = { isRootAdmin: false, role: { not: 'admin' }, OR: [{ isActive: true }, { id: { in: withRecords } }] };
    if (!s.hr && !s.director) where.departmentId = s.departmentId ?? -1;
    else if (req.query.departmentId) where.departmentId = optionalInt(req.query.departmentId, 'Bộ phận');
    const users = (await prisma.user.findMany({ where, include: { permissions: true, department: { select: { id: true, name: true } } }, orderBy: [{ departmentId: 'asc' }, { fullName: 'asc' }] }))
      .filter(u => P.can(s, 'view', 'hrm.attendance', tctx(u, cfg)));
    const ids = users.map(u => u.id);
    const [records, leaves, profiles] = await Promise.all([
      prisma.hrAttendance.findMany({ where: { userId: { in: ids }, day: { startsWith: month } } }),
      prisma.hrLeave.findMany({ where: { userId: { in: ids }, status: 'APPROVED', fromDate: { lt: mr.to }, toDate: { gte: mr.from } } }),
      prisma.hrProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, startDate: true } }),
    ]);
    const starts = new Map(profiles.map(p => [p.userId, p.startDate]));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ month, rows: users.map(u => ({ user: { id: u.id, fullName: u.fullName, department: u.department, isActive: u.isActive },
      totals: H.sheetTotals(H.monthSheet(month, records.filter(r => r.userId === u.id).map(r => attOut(r, s, req)), leaves.filter(l => l.userId === u.id), cfg, undefined, { startDate: starts.get(u.id) })) })) });
  });
  // Nhập từ máy chấm công (CSV đã đọc ở trình duyệt). Mỗi dòng: { employeeCode, day, in, out } hoặc một lần chấm { employeeCode, day, time }.
  // Gộp theo (mã NV, ngày): giờ vào = sớm nhất, giờ ra = muộn nhất (≥ 2 lần chấm). Không ghi đè giá trị có sẵn bằng ô trống.
  // Người phụ trách nhân sự nhập; dòng của chính họ: Ban GĐ nhập.
  app.post('/api/hrm/attendance/import', auth, async (req, res) => {
    if (req.via) fail(403, 'Nhập chấm công làm trên giao diện Kepper', 'NOT_VIA_AI');
    const { cfg, s } = await ctxFor(req);
    if (!s.hr && !s.director) fail(403, 'Chỉ người phụ trách nhân sự (hoặc Ban giám đốc) nhập dữ liệu máy chấm công', 'FORBIDDEN');
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length || rows.length > 20000) fail(422, 'Cần 1–20000 dòng', 'INVALID_VALUE');
    const profiles = await prisma.hrProfile.findMany({ where: { employeeCode: { not: null } }, select: { userId: true, employeeCode: true } });
    const byCode = new Map(profiles.map(p => [p.employeeCode.toUpperCase(), p.userId]));
    const users = await usersMap(profiles.map(p => p.userId));
    const errors = []; let skipped = 0;
    const groups = new Map();
    const err = (line, m) => { skipped++; if (errors.length < 50) errors.push(`Dòng ${line}: ${m}`); };
    for (const [i, r] of rows.entries()) {
      const line = Number(r?.line) || i + 1;
      const code = String(r?.employeeCode || '').trim().toUpperCase(), userId = byCode.get(code);
      if (!userId || !users[userId]) { err(line, `mã NV "${code.slice(0, 20)}" không có`); continue; }
      if (!P.can(s, 'edit', 'hrm.attendance', tctx(users[userId], cfg, { op: 'hr' }))) { err(line, 'không nhập chấm công của chính mình (Ban giám đốc nhập)'); continue; }
      const day = H.normDay(r.day);
      if (!day) { err(line, 'ngày không hợp lệ (YYYY-MM-DD hoặc D/M/YYYY)'); continue; }
      const times = ['in', 'out', 'time'].map(k => (r[k] == null || r[k] === '' ? null : H.normTime(r[k])));
      if (['in', 'out', 'time'].some((k, j) => r[k] != null && r[k] !== '' && !times[j])) { err(line, 'giờ không hợp lệ (H:MM hoặc HH:MM:SS)'); continue; }
      if (!times.some(Boolean)) { err(line, 'thiếu giờ'); continue; }
      const key = `${userId}|${day}`, g = groups.get(key) || { userId, day, ins: [], outs: [], punches: [] };
      if (times[0]) g.ins.push(times[0]); if (times[1]) g.outs.push(times[1]); if (times[2]) g.punches.push(times[2]);
      groups.set(key, g);
    }
    let saved = 0;
    for (const g of groups.values()) {
      const p = [...g.punches].sort();
      const inT = [...g.ins, ...(p.length ? [p[0]] : [])].sort()[0] || null;
      const outT = [...g.outs, ...(p.length >= 2 ? [p[p.length - 1]] : [])].sort().pop() || null;
      const cur = await prisma.hrAttendance.findUnique({ where: { userId_day: { userId: g.userId, day: g.day } } });
      const checkIn = inT ? timeOn(g.day, inT, 'Giờ vào') : cur?.checkIn || null, checkOut = outT ? timeOn(g.day, outT, 'Giờ ra') : cur?.checkOut || null;
      if (checkIn && checkOut && checkOut < checkIn) { err('—', `${g.day}: giờ ra trước giờ vào`); continue; }
      const le = cur?.adjustStatus === 'APPROVED' ? {} : H.lateEarly(checkIn, checkOut, cfg);
      const data = { checkIn, checkOut, ...le, note: 'Máy chấm công' };
      await prisma.hrAttendance.upsert({ where: { userId_day: { userId: g.userId, day: g.day } }, update: data, create: { userId: g.userId, departmentId: users[g.userId].departmentId, day: g.day, ...data } });
      saved++;
    }
    await audit(req, 'HR_ATT_IMPORT', 'HrAttendance', null, null, { rows: rows.length, days: saved, skipped });
    res.json({ saved, skipped, errors });
  });
};

// Nhắc người phụ trách nhân sự (còn hoạt động, không phải IT): hợp đồng hết hạn sau 30 / 7 ngày (08:15). Xoá IP chấm công quá 90 ngày (03:10).
async function runHrmReminders(prisma, now = new Date()) {
  const cfg = await H.hrmConfig(prisma);
  const hr = cfg.hrUserIds.length ? (await prisma.user.findMany({ where: { id: { in: cfg.hrUserIds }, ...ACTIVE_USER }, select: { id: true } })).map(x => x.id) : [];
  if (!hr.length) return { sent: 0 };
  const today = WK.dayOf(now);
  let sent = 0;
  for (const n of [30, 7]) {
    const d = WK.addDays(today, n);
    const rows = await prisma.hrContract.findMany({ where: { status: 'ACTIVE', endDate: { gte: dayStart(d), lt: new Date(dayStart(d).getTime() + 86_400_000) } } });
    const names = await require('../services/weekly-data').userNames(prisma, rows.map(r => r.userId));
    for (const r of rows) sent += await notify(prisma, hr, { type: 'HR_CONTRACT_END', title: `Hợp đồng ${r.number} (${names[r.userId] || ''}) hết hạn sau ${n} ngày`, body: `${H.CONTRACT_TYPES[r.type]} — kết thúc ${WK.fmtDY(d)}`, link: `#/hrm/people/${r.userId}` }, r.userId);
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
