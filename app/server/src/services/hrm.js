// Playground HRM — thiết lập, vai trò, tính ngày nghỉ, chấm công. Quyền: lib/policy.js (hrm.*).
const { permissionScope } = require('../lib/permissions');
const WK = require('./weekly');
const WD = require('./weekly-data');

const CONFIG_KEY = 'hrm.config';
const LEAVE_TYPES = { ANNUAL: 'Nghỉ phép năm', SICK: 'Nghỉ ốm', PERSONAL_PAID: 'Việc riêng có lương (cưới, tang…)', UNPAID: 'Nghỉ không lương', MATERNITY: 'Thai sản', OTHER: 'Khác' };
const LEAVE_STATUS = { PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Từ chối', CANCELLED: 'Đã huỷ' };
const CONTRACT_TYPES = { PROBATION: 'Thử việc', FIXED: 'Xác định thời hạn', INDEFINITE: 'Không xác định thời hạn', SERVICE: 'Dịch vụ / khoán việc' };
const PROFILE_STATUS = { PROBATION: 'Thử việc', OFFICIAL: 'Chính thức', LEFT: 'Đã nghỉ việc' };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULTS = { hrUserIds: [], workStart: '08:00', workEnd: '17:30', graceMinutes: 5, workDays: [1, 2, 3, 4, 5], holidays: [], officeNetworks: [], annualDays: 12 };

async function hrmConfig(prisma) {
  const row = await prisma.appSetting.findUnique({ where: { key: CONFIG_KEY } });
  const v = row?.value && typeof row.value === 'object' ? row.value : {};
  return {
    hrUserIds: Array.isArray(v.hrUserIds) ? v.hrUserIds.map(Number).filter(Number.isInteger) : [],
    workStart: HHMM.test(v.workStart) ? v.workStart : DEFAULTS.workStart,
    workEnd: HHMM.test(v.workEnd) ? v.workEnd : DEFAULTS.workEnd,
    graceMinutes: Number.isInteger(v.graceMinutes) && v.graceMinutes >= 0 && v.graceMinutes <= 60 ? v.graceMinutes : DEFAULTS.graceMinutes,
    workDays: Array.isArray(v.workDays) && v.workDays.length ? v.workDays.map(Number).filter(n => n >= 0 && n <= 6) : DEFAULTS.workDays,
    holidays: Array.isArray(v.holidays) ? v.holidays.filter(WK.isDay) : [],
    officeNetworks: Array.isArray(v.officeNetworks) ? v.officeNetworks.filter(cidrValid) : [],
    annualDays: Number.isInteger(v.annualDays) && v.annualDays >= 12 && v.annualDays <= 30 ? v.annualDays : DEFAULTS.annualDays,
  };
}
// Subject của policy + hr (người phụ trách nhân sự do Ban GĐ chỉ định; không suy từ phòng ban — tránh tự nâng quyền).
async function subjectOf(prisma, user, cfg = null) {
  const s = await WD.rolesOf(prisma, user);
  const c = cfg || await hrmConfig(prisma);
  return { ...s, hr: !s.it && c.hrUserIds.includes(user.id) };
}
// Người đó có phải lãnh đạo bộ phận (trưởng / phó: quyền "Xem tổng hợp") — đơn của họ do Ban GĐ duyệt.
const isLeader = user => !!user && !!permissionScope(user, 'reports.summary', 'VIEW');
const isDirector = user => user?.role === 'director';

// ---------- Ngày công ----------
const isWorkday = (day, cfg) => cfg.workDays.includes(WK.weekday(day)) && !cfg.holidays.includes(day);
function workdaysBetween(from, to, cfg, max = 400) {
  const out = [];
  for (let d = from, n = 0; d <= to && n < max; d = WK.addDays(d, 1), n++) if (isWorkday(d, cfg)) out.push(d);
  return out;
}
function leaveDays(from, to, halfDay, cfg) {
  const days = workdaysBetween(from, to, cfg).length;
  if (halfDay && halfDay !== 'NONE') return from === to && days === 1 ? 0.5 : NaN;
  return days;
}
// Phép năm (BLLĐ 2019 Đ113, Đ114): annualDays; đủ 5 năm làm việc +1 ngày; vào làm trong năm → theo số tháng làm việc.
// Con số THAM KHẢO cho người lao động tự theo dõi — người phụ trách nhân sự chốt.
function annualQuota(year, startDate, cfg) {
  const base = cfg.annualDays;
  if (!startDate) return base;
  const start = WK.dayOf(startDate);
  const y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
  if (y > year) return 0;
  if (y === year) return Math.round(base * (12 - m + 1) / 12 * 2) / 2; // làm chưa đủ 12 tháng: theo tháng, làm tròn 0,5
  return base + Math.floor((year - y) / 5); // số năm tròn tính đến 31/12 của năm đang xét
}

// ---------- Chấm công ----------
const vnMinutes = t => { const x = new Date(new Date(t).getTime() + 7 * 3_600_000); return x.getUTCHours() * 60 + x.getUTCMinutes(); };
const hm = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
function lateEarly(checkIn, checkOut, cfg) {
  const start = hm(cfg.workStart), end = hm(cfg.workEnd);
  const inM = checkIn ? vnMinutes(checkIn) : null, outM = checkOut ? vnMinutes(checkOut) : null;
  return {
    minutesLate: inM != null && inM > start + cfg.graceMinutes ? inM - start : 0,
    minutesEarly: outM != null && outM < end ? end - outM : 0,
  };
}
// Mạng văn phòng (IPv4 CIDR). Docker Desktop trên Windows thường KHÔNG giữ IP thật của máy người dùng → kiểm tra "IP Kepper thấy" trong Thiết lập trước khi bật.
function cidrValid(c) { return typeof c === 'string' && /^(\d{1,3}\.){3}\d{1,3}\/(\d|[12]\d|3[0-2])$/.test(c) && c.split('/')[0].split('.').every(n => Number(n) <= 255); }
const ip4 = ip => { const m = String(ip || '').replace(/^::ffff:/, '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/); return m ? ((+m[1] << 24) >>> 0) + (+m[2] << 16) + (+m[3] << 8) + +m[4] : null; };
function inNetworks(ip, nets) {
  const n = ip4(ip);
  if (n == null) return false;
  return nets.some(c => { const [base, bits] = c.split('/'); const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0; return ((n & mask) >>> 0) === ((ip4(base) & mask) >>> 0); });
}
// Bảng công một tháng của một người: mỗi ngày làm việc → bản ghi / nghỉ phép đã duyệt / ngày lễ / thiếu.
function monthSheet(month, records, leaves, cfg, today = WK.dayOf(new Date())) {
  const from = month + '-01', last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const byDay = new Map(records.map(r => [r.day, r]));
  const out = [];
  for (let d = from; d <= last; d = WK.addDays(d, 1)) {
    const r = byDay.get(d);
    const leave = leaves.find(l => l.status === 'APPROVED' && WK.dayOf(l.fromDate) <= d && d <= WK.dayOf(l.toDate));
    const work = isWorkday(d, cfg);
    let status;
    if (cfg.holidays.includes(d)) status = 'HOLIDAY';
    else if (!work) status = r ? 'WEEKEND_WORK' : 'OFF';
    else if (leave && !(leave.halfDay && leave.halfDay !== 'NONE')) status = 'LEAVE';
    else if ((r?.adjustStatus || r?.adjust?.status) === 'APPROVED') status = 'ADJUSTED';
    else if (!r?.checkIn && !r?.checkOut) status = d < today ? 'MISSING' : d === today ? 'TODAY' : 'FUTURE';
    else if (!r.checkOut && d < today) status = 'NO_OUT';
    else if (r.minutesLate || r.minutesEarly) status = 'LATE_EARLY';
    else status = 'OK';
    out.push({ day: d, weekday: WK.weekday(d), status, record: r || null, leave: leave ? { id: leave.id, type: leave.type, halfDay: leave.halfDay } : null });
  }
  return out;
}

module.exports = { CONFIG_KEY, LEAVE_TYPES, LEAVE_STATUS, CONTRACT_TYPES, PROFILE_STATUS, HHMM, DEFAULTS, hrmConfig, subjectOf, isLeader, isDirector,
  isWorkday, workdaysBetween, leaveDays, annualQuota, lateEarly, cidrValid, inNetworks, monthSheet, vnMinutes };
