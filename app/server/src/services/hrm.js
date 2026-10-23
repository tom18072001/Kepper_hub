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
const DEFAULTS = { hrUserIds: [], workStart: '08:00', workEnd: '17:30', lunchStart: '12:00', lunchEnd: '13:30', graceMinutes: 5, workDays: [1, 2, 3, 4, 5], holidays: [], officeNetworks: [], annualDays: 12 };
const MAX_LEAVE_DAYS = 200; // một đơn: đủ cho thai sản 6 tháng

async function hrmConfig(prisma) {
  const row = await prisma.appSetting.findUnique({ where: { key: CONFIG_KEY } });
  const v = row?.value && typeof row.value === 'object' ? row.value : {};
  const t = (k) => (HHMM.test(v[k]) ? v[k] : DEFAULTS[k]);
  return {
    hrUserIds: Array.isArray(v.hrUserIds) ? v.hrUserIds.map(Number).filter(Number.isInteger) : [],
    workStart: t('workStart'), workEnd: t('workEnd'), lunchStart: t('lunchStart'), lunchEnd: t('lunchEnd'),
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
// Số ngày của một đơn rơi vào năm `year` (đơn qua năm tính tách theo từng năm; theo danh sách ngày lễ HIỆN TẠI).
function leaveDaysInYear(from, to, halfDay, year, cfg) {
  const a = from > `${year}-01-01` ? from : `${year}-01-01`, b = to < `${year}-12-31` ? to : `${year}-12-31`;
  if (a > b) return 0;
  if (halfDay && halfDay !== 'NONE') return isWorkday(from, cfg) && from.slice(0, 4) === String(year) ? 0.5 : 0;
  return workdaysBetween(a, b, cfg).length;
}
const yearsOf = (from, to) => { const out = []; for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) out.push(y); return out; };
const hasHolidays = (year, cfg) => cfg.holidays.some(d => d.startsWith(String(year)));
// Phép năm (BLLĐ 2019 Đ113, Đ114; NĐ 145/2020 Đ66): annualDays; +1 ngày mỗi 5 năm làm việc; vào làm trong năm → theo số tháng làm việc,
// tháng vào làm chỉ tính khi số ngày làm việc từ ngày vào ≥ 50% ngày làm việc của tháng. Con số THAM KHẢO — người phụ trách nhân sự chốt.
function annualQuota(year, startDate, cfg) {
  const base = cfg.annualDays;
  if (!startDate) return base;
  const start = WK.dayOf(startDate);
  const y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
  if (y > year) return 0;
  if (y === year) {
    const monthStart = start.slice(0, 8) + '01', monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const all = workdaysBetween(monthStart, monthEnd, cfg).length, worked = workdaysBetween(start, monthEnd, cfg).length;
    const months = 12 - m + (all && worked * 2 >= all ? 1 : 0);
    return Math.round(base * months / 12 * 2) / 2; // làm tròn 0,5
  }
  return base + Math.floor((year - y) / 5); // số năm tròn tính đến 31/12 của năm đang xét
}

// ---------- Chấm công ----------
const vnMinutes = t => { const x = new Date(new Date(t).getTime() + 7 * 3_600_000); return x.getUTCHours() * 60 + x.getUTCMinutes(); };
const hm = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
// Nghỉ nửa ngày: buổi sáng → giờ vào tính từ hết nghỉ trưa; buổi chiều → giờ ra tính tới đầu nghỉ trưa.
function lateEarly(checkIn, checkOut, cfg, halfDay = 'NONE') {
  const start = hm(halfDay === 'AM' ? cfg.lunchEnd : cfg.workStart), end = hm(halfDay === 'PM' ? cfg.lunchStart : cfg.workEnd);
  const inM = checkIn ? vnMinutes(checkIn) : null, outM = checkOut ? vnMinutes(checkOut) : null;
  return {
    minutesLate: inM != null && inM > start + cfg.graceMinutes ? inM - start : 0,
    minutesEarly: outM != null && outM < end ? end - outM : 0,
  };
}
// Giờ CSV máy chấm công: "8:05", "08:05", "08:05:12" → "08:05". Ngày: YYYY-MM-DD hoặc D/M/YYYY.
function normTime(v) {
  const m = String(v ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}
function normDay(v) {
  const s = String(v ?? '').trim();
  if (WK.isDay(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const d = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return WK.isDay(d) ? d : null;
}
// Mạng văn phòng (IPv4 CIDR). Docker Desktop trên Windows thường KHÔNG giữ IP thật của máy người dùng → kiểm tra "IP Kepper thấy" trong Thiết lập trước khi bật.
function cidrValid(c) { return typeof c === 'string' && /^(\d{1,3}\.){3}\d{1,3}\/(\d|[12]\d|3[0-2])$/.test(c) && c.split('/')[0].split('.').every(n => Number(n) <= 255); }
const ip4 = ip => { const m = String(ip || '').replace(/^::ffff:/, '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/); return m ? ((+m[1] << 24) >>> 0) + (+m[2] << 16) + (+m[3] << 8) + +m[4] : null; };
function inNetworks(ip, nets) {
  const n = ip4(ip);
  if (n == null) return false;
  return nets.some(c => { const [base, bits] = c.split('/'); const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0; return ((n & mask) >>> 0) === ((ip4(base) & mask) >>> 0); });
}
const adjustOf = r => (r ? r.adjust || (r.adjustStatus ? { status: r.adjustStatus, in: r.adjustIn, out: r.adjustOut } : null) : null);
// Bảng công một tháng của một người: mỗi ngày → ngoài thời gian làm việc / lễ / nghỉ / nghỉ phép (cả nửa ngày) / đã giải trình / thiếu / muộn – sớm / đủ.
// Phút muộn / sớm TÍNH LẠI từ giờ chấm (hoặc giờ giải trình đã duyệt) + nửa ngày nghỉ của ngày đó — không dùng số lưu sẵn.
function monthSheet(month, records, leaves, cfg, today = WK.dayOf(new Date()), { startDate = null } = {}) {
  const from = month + '-01', last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const startDay = startDate ? WK.dayOf(startDate) : null;
  const byDay = new Map(records.map(r => [r.day, r]));
  const out = [];
  for (let d = from; d <= last; d = WK.addDays(d, 1)) {
    const r = byDay.get(d), adj = adjustOf(r);
    const leave = leaves.find(l => l.status === 'APPROVED' && WK.dayOf(l.fromDate) <= d && d <= WK.dayOf(l.toDate));
    const half = leave && leave.halfDay && leave.halfDay !== 'NONE' ? leave.halfDay : null;
    const work = isWorkday(d, cfg);
    const inT = adj?.status === 'APPROVED' ? adj.in || r?.checkIn : r?.checkIn, outT = adj?.status === 'APPROVED' ? adj.out || r?.checkOut : r?.checkOut;
    const le = lateEarly(inT, outT, cfg, half || 'NONE');
    let status;
    if (startDay && d < startDay) status = 'NOT_EMPLOYED';
    else if (cfg.holidays.includes(d)) status = 'HOLIDAY';
    else if (!work) status = r?.checkIn || r?.checkOut ? 'WEEKEND_WORK' : 'OFF';
    else if (leave && !half) status = 'LEAVE';
    else if (adj?.status === 'APPROVED') status = 'ADJUSTED';
    else if (!inT && !outT) status = d < today ? 'MISSING' : d === today ? 'TODAY' : 'FUTURE';
    else if (!outT && d < today) status = 'NO_OUT';
    else if (le.minutesLate || le.minutesEarly) status = 'LATE_EARLY';
    else status = half ? 'HALF_LEAVE' : 'OK';
    out.push({ day: d, weekday: WK.weekday(d), status, ...le, record: r || null, leave: leave ? { id: leave.id, type: leave.type, halfDay: leave.halfDay } : null });
  }
  return out;
}
// Tổng hợp công: ngày nghỉ có lương / không lương (cả nửa ngày); ngày ngoài thời gian làm việc không tính.
function sheetTotals(sheet) {
  const t = { workdays: 0, ok: 0, lateEarly: 0, missing: 0, leavePaid: 0, leaveUnpaid: 0, adjusted: 0, minutesLate: 0 };
  for (const d of sheet) {
    if (['OFF', 'HOLIDAY', 'WEEKEND_WORK', 'NOT_EMPLOYED'].includes(d.status)) continue;
    t.workdays++;
    const leaveDay = d.leave ? (d.leave.halfDay && d.leave.halfDay !== 'NONE' ? 0.5 : 1) : 0;
    if (leaveDay) { if (d.leave.type === 'UNPAID') t.leaveUnpaid += leaveDay; else t.leavePaid += leaveDay; }
    if (d.status === 'OK' || d.status === 'HALF_LEAVE') t.ok++;
    else if (d.status === 'LATE_EARLY') t.lateEarly++;
    else if (d.status === 'MISSING' || d.status === 'NO_OUT') t.missing++;
    else if (d.status === 'ADJUSTED') t.adjusted++;
    t.minutesLate += d.minutesLate || 0;
  }
  return t;
}

module.exports = { CONFIG_KEY, LEAVE_TYPES, LEAVE_STATUS, CONTRACT_TYPES, PROFILE_STATUS, HHMM, DEFAULTS, MAX_LEAVE_DAYS, hrmConfig, subjectOf, isLeader, isDirector,
  isWorkday, workdaysBetween, leaveDays, leaveDaysInYear, yearsOf, hasHolidays, annualQuota, lateEarly, normTime, normDay, cidrValid, inNetworks, monthSheet, sheetTotals, vnMinutes };
