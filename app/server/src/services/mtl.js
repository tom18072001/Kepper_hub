// Master Timeline (MTL): đọc bảng kế hoạch theo tháng T, quy đổi T → ngày, tính tiến độ kế hoạch / thực tế,
// trạng thái nhanh / chậm / trễ, SPI và KPI tiến độ. Hàm thuần — kiểm thử được, không đụng CSDL.
const { norm } = require('./plan-parser');

const DAY = 86_400_000, H7 = 7 * 3_600_000;
const DEFAULT_ALERTS = { behindPct: 10, aheadPct: 10, startSoonDays: 7, dueSoonDays: 7, staleDays: 7 };
const alertConfigOf = project => ({ ...DEFAULT_ALERTS, ...(project?.alertConfig && typeof project.alertConfig === 'object' ? project.alertConfig : {}) });

// ---------- Ngày theo giờ Việt Nam ----------
const vnDay = d => Math.floor((new Date(d).getTime() + H7) / DAY); // số ngày lịch VN
const vnMidnight = (y, m, d) => new Date(Date.UTC(y, m, d) - H7); // 00:00 giờ VN của ngày y-m-d (m: 0–11)
const vnParts = d => { const x = new Date(new Date(d).getTime() + H7); return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate() }; };

// T0 = đầu tháng chứa t0Date. Tháng T bắt đầu ngày 1 của (T0 + T); kết thúc ngày cuối của tháng (T0 + endT).
// Thời lượng = endT − startT + 1 (khớp cột "Thời lượng (tháng)" của MTL).
function monthStart(t0Date, t) {
  const { y, m } = vnParts(t0Date);
  return vnMidnight(y, m + Math.floor(t), 1);
}
function tToDates(t0Date, startT, endT) {
  if (!t0Date || startT == null || endT == null) return { start: null, end: null };
  const start = monthStart(t0Date, startT);
  const end = new Date(monthStart(t0Date, Math.floor(endT) + 1).getTime() - 1); // 23:59:59.999 ngày cuối tháng
  return { start, end };
}
// Tháng T hiện tại (0-based) của một ngày so với T0.
function currentT(t0Date, day = new Date()) {
  if (!t0Date) return null;
  const a = vnParts(t0Date), b = vnParts(day);
  return (b.y - a.y) * 12 + (b.m - a.m);
}

// ---------- Đọc bảng MTL (tổng hoặc bộ phận) ----------
const HEADERS = {
  step: ['buoc', 'stt', 'tt', 'ma', 'ma buoc'],
  title: ['hang muc cong viec', 'hang muc', 'noi dung', 'cong viec', 'noi dung cong viec', 'ten hang muc'],
  owner: ['dau moi', 'phu trach', 'nguoi phu trach', 'don vi chu tri', 'chu tri', 'bo phan'],
  start: ['bat dau (t)', 'bat dau', 'tu (t)', 'bat dau t', 'ngay bat dau', 'tu ngay'],
  end: ['ket thuc (t)', 'ket thuc', 'den (t)', 'ket thuc t', 'ngay ket thuc', 'den ngay', 'han'],
  duration: ['thoi luong (thang)', 'thoi luong', 'so thang'],
  critical: ['duong gang', 'gang', 'critical'],
  milestone: ['moc', 'moc chinh', 'milestone'],
  parent: ['thuoc buoc', 'buoc mtl', 'hang muc mtl', 'thuoc hang muc', 'buoc tong'],
  weight: ['trong so'],
  note: ['ghi chu'],
};
const headerKey = cell => { const c = norm(String(cell ?? '')); for (const [k, keys] of Object.entries(HEADERS)) if (keys.includes(c)) return k; return null; };

// Giá trị thời gian trong ô: số / "T5" / "5" → tháng T; Date / "dd/mm/yyyy" → ngày cụ thể.
function timeValue(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return { date: v };
  if (typeof v === 'number' && Number.isFinite(v)) return { t: v };
  const s = String(v).trim();
  let m = s.match(/^t\s*(\d+(?:[.,]\d+)?)$/i) || s.match(/^(\d+(?:[.,]\d+)?)$/);
  if (m) return { t: Number(m[1].replace(',', '.')) };
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return { date: vnMidnight(Number(m[3]), Number(m[2]) - 1, Number(m[1])) };
  return null;
}
const flag = v => { const s = norm(String(v ?? '')); return !!s && !['khong', 'no', '0', 'false', '-'].includes(s); };
const isMilestoneMark = v => /[◆♦]/.test(String(v ?? '')) || /^(x|có|co|yes|mốc|moc)$/i.test(String(v ?? '').trim());

// rows: mảng dòng (mảng ô). Trả { items, sections, warnings, header } hoặc null nếu không phải bảng MTL.
function parseMtlRows(rows) {
  let at = -1, cols = null;
  for (let r = 0; r < Math.min(rows.length, 30) && at < 0; r++) {
    const keys = rows[r].map(headerKey);
    if (keys.includes('title') && (keys.includes('start') || keys.includes('end'))) {
      at = r; cols = {};
      keys.forEach((k, i) => { if (k && cols[k] == null) cols[k] = i; });
    }
  }
  if (at < 0) return null;
  const get = (row, k) => (cols[k] == null ? null : row[cols[k]]);
  const items = [], warnings = [];
  let section = null;
  for (let r = at + 1; r < rows.length; r++) {
    const row = rows[r];
    const filled = row.filter(c => c != null && String(c).trim() !== '');
    if (!filled.length) continue;
    const title = String(get(row, 'title') ?? '').trim();
    const start = timeValue(get(row, 'start')), end = timeValue(get(row, 'end'));
    const stepRaw = get(row, 'step'); const step = stepRaw == null ? '' : String(stepRaw).trim();
    // Dòng nhóm / phần: chỉ một ô có chữ, không có thời gian (vd. "PHẦN II — PHÂN KỲ 2").
    if (!start && !end) {
      if (filled.length === 1 && /^(phần|phan|phân kỳ|phan ky|giai đoạn|giai doan|[ivx]+[.)])/i.test(String(filled[0]).trim())) { section = String(filled[0]).trim().slice(0, 200); continue; }
      if (/^ghi chú|^lưu ý|^chú thích/i.test(String(filled[0]).trim())) continue;
      if (title) warnings.push(`Dòng ${r + 1}: "${title.slice(0, 50)}" thiếu bắt đầu / kết thúc — bỏ qua`);
      continue;
    }
    if (!title) { warnings.push(`Dòng ${r + 1}: thiếu tên hạng mục — bỏ qua`); continue; }
    const s = start || end, e = end || start;
    if ((s.t != null) !== (e.t != null)) { warnings.push(`Dòng ${r + 1}: bắt đầu và kết thúc phải cùng kiểu (tháng T hoặc ngày) — bỏ qua`); continue; }
    if (s.t != null && e.t < s.t) { warnings.push(`Dòng ${r + 1}: kết thúc (T${e.t}) trước bắt đầu (T${s.t}) — bỏ qua`); continue; }
    if (s.date && e.date < s.date) { warnings.push(`Dòng ${r + 1}: ngày kết thúc trước ngày bắt đầu — bỏ qua`); continue; }
    const ms = get(row, 'milestone');
    const weightRaw = Number(get(row, 'weight'));
    items.push({
      row: r + 1, step: step.slice(0, 20), title: title.slice(0, 300), ownerText: String(get(row, 'owner') ?? '').trim().slice(0, 200),
      startT: s.t ?? null, endT: e.t ?? null, startDate: s.date ?? null, endDate: e.date ?? null,
      critical: flag(get(row, 'critical')), milestone: ms != null && String(ms).trim() !== '' && isMilestoneMark(ms),
      milestoneNote: ms != null && String(ms).replace(/[◆♦]/g, '').trim() && !isMilestoneMark(String(ms).replace(/[◆♦]/g, '').trim()) ? String(ms).replace(/[◆♦]/g, '').trim().slice(0, 100) : null,
      parentStep: get(row, 'parent') == null ? null : String(get(row, 'parent')).trim().slice(0, 20) || null,
      weight: Number.isFinite(weightRaw) && weightRaw > 0 ? weightRaw : null,
      note: String(get(row, 'note') ?? '').trim().slice(0, 1000),
      section: section || (/^[ivx]+\./i.test(step) ? `Phần ${step.split('.')[0].toUpperCase()}` : null),
    });
  }
  // Bước trùng trong cùng bảng → cảnh báo (bước dùng để cập nhật lại khi nhập lại).
  const seen = new Set();
  for (const it of items) { if (it.step && seen.has(it.step)) warnings.push(`Bước "${it.step}" bị trùng — các lần nhập lại sẽ chỉ khớp dòng đầu`); seen.add(it.step); }
  return { items, warnings, header: at + 1 };
}

// ---------- Đầu mối → bộ phận ----------
// Bí danh viết tắt trong MTL → mã bộ phận. Cơ quan ngoài (UBND, Sở, Cục, VP ĐKĐĐ…) → externalParty.
const ALIASES = [
  { codes: ['BLD', 'BGD', 'BLĐ'], keys: ['ct', 'chu tich', 'tgd', 'tong giam doc', 'gddh', 'giam doc dieu hanh', 'bld', 'bgd', 'ban lanh dao', 'ban giam doc', 'hdqt', 'spv'] },
  { codes: ['PL'], keys: ['pl', 'phap ly', 'phap che'] }, { codes: ['TC'], keys: ['tc', 'tai chinh', 'ke toan'] }, { codes: ['TK'], keys: ['tk', 'thiet ke'] },
  { codes: ['QLXD'], keys: ['qlxd', 'quan ly xay dung', 'xay dung'] }, { codes: ['KD'], keys: ['kd', 'kinh doanh', 'ban hang'] },
  { codes: ['GR'], keys: ['gr', 'doi ngoai', 'gpmb', 'giai phong mat bang'] }, { codes: ['PMO'], keys: ['pmo', 'ql du an', 'quan ly du an'] },
];
const EXTERNAL = /^(ubnd|so |so$|cuc |bo |vp dkdd|vpdkdd|ub |dvtv|tu van|chu dat|uy ban|hoi dong|ngan hang)/;
function splitOwner(text, departments) {
  const byCode = new Map(departments.map(d => [String(d.code || '').toUpperCase(), d]));
  const byName = new Map(departments.map(d => [norm(d.name), d]));
  const tokens = String(text || '').split(/[/,;+&]| và |–|—/i).map(t => t.trim()).filter(Boolean);
  const internal = [], external = [];
  for (const t of tokens) {
    const n = norm(t);
    let dept = byCode.get(t.toUpperCase()) || byName.get(n) || byName.get(norm('Phòng ' + t)) || byName.get(norm('Ban ' + t));
    if (!dept) for (const a of ALIASES) if (a.keys.includes(n)) { const c = a.codes.find(x => byCode.get(x)); if (c) { dept = byCode.get(c); break; } }
    if (dept) { if (!internal.includes(dept.id)) internal.push(dept.id); }
    else if (EXTERNAL.test(n + ' ') || /^(ubnd|sở|cục|bộ|vp)/i.test(t)) external.push(t);
    else external.push(t);
  }
  return { leadDepartmentId: internal[0] ?? null, supportDepartmentIds: internal.slice(1), externalParty: external.join(' / ').slice(0, 200) };
}

// ---------- Tiến độ ----------
const isDone = i => i.state?.category === 'COMPLETED' || i.category === 'COMPLETED';
const isCancelled = i => i.state?.category === 'CANCELLED' || i.category === 'CANCELLED';
// % kế hoạch tại ngày: tuyến tính theo ngày lịch giữa bắt đầu và kết thúc kế hoạch gốc (tính trọn ngày).
function plannedPct(item, day = new Date()) {
  if (!item.baselineStart || !item.baselineEnd) return null;
  const s = vnDay(item.baselineStart), e = vnDay(item.baselineEnd), d = vnDay(day);
  if (d < s) return 0;
  if (d >= e) return 100;
  return Math.round(((d - s + 1) / (e - s + 1)) * 1000) / 10;
}
const durationDays = i => (i.baselineStart && i.baselineEnd ? vnDay(i.baselineEnd) - vnDay(i.baselineStart) + 1 : 1);
const weightOf = i => (i.weight > 0 ? i.weight : durationDays(i));

// Tiến độ thực tế: hạng mục có hạng mục con (không huỷ) → bình quân gia quyền của con (đệ quy); ngược lại → % đã cập nhật.
function rollup(items) {
  const byParent = new Map();
  for (const i of items) if (i.parentId != null) { if (!byParent.has(i.parentId)) byParent.set(i.parentId, []); byParent.get(i.parentId).push(i); }
  const memo = new Map();
  const actual = i => {
    if (memo.has(i.id)) return memo.get(i.id);
    memo.set(i.id, isDone(i) ? 100 : i.progress || 0); // chặn vòng
    const kids = (byParent.get(i.id) || []).filter(k => !isCancelled(k));
    let v = isDone(i) ? 100 : i.progress || 0;
    if (kids.length && !isDone(i)) { const w = kids.reduce((n, k) => n + weightOf(k), 0); v = w ? Math.round(kids.reduce((n, k) => n + weightOf(k) * actual(k), 0) / w * 10) / 10 : v; }
    memo.set(i.id, v); return v;
  };
  return new Map(items.map(i => [i.id, actual(i)]));
}

// Trạng thái một hạng mục. actualPct: tiến độ thực tế (sau rollup).
const STATUS = {
  NOT_DUE: 'Chưa đến kỳ', LATE_START: 'Chậm khởi động', ON_TRACK: 'Đúng tiến độ', BEHIND: 'Chậm tiến độ', AHEAD: 'Vượt tiến độ',
  OVERDUE: 'Trễ hạn', DONE_ON_TIME: 'Hoàn thành đúng hạn', DONE_LATE: 'Hoàn thành trễ hạn', CANCELLED: 'Huỷ', NO_PLAN: 'Chưa có kế hoạch',
};
function statusOf(item, actualPct, day = new Date(), cfg = DEFAULT_ALERTS) {
  if (isCancelled(item)) return { code: 'CANCELLED' };
  if (!item.baselineStart || !item.baselineEnd) return { code: isDone(item) ? 'DONE_ON_TIME' : 'NO_PLAN' };
  const planned = plannedPct(item, day), d = vnDay(day), e = vnDay(item.baselineEnd), s = vnDay(item.baselineStart);
  if (isDone(item)) {
    const late = item.completedAt ? vnDay(item.completedAt) - e : 0;
    return { code: late > 0 ? 'DONE_LATE' : 'DONE_ON_TIME', planned: 100, variance: 0, lateDays: Math.max(0, late) };
  }
  const variance = Math.round((actualPct - planned) * 10) / 10;
  if (d > e) return { code: 'OVERDUE', planned, variance, lateDays: d - e };
  if (d < s) return { code: 'NOT_DUE', planned, variance: 0, startsIn: s - d };
  if (actualPct <= 0 && !item.startedAt && d - s >= 0 && planned >= cfg.behindPct) return { code: 'LATE_START', planned, variance, daysLeft: e - d };
  if (variance <= -cfg.behindPct) return { code: 'BEHIND', planned, variance, daysLeft: e - d };
  if (variance >= cfg.aheadPct) return { code: 'AHEAD', planned, variance, daysLeft: e - d };
  return { code: 'ON_TRACK', planned, variance, daysLeft: e - d };
}

// SPI trên một tập hạng mục (chỉ hạng mục "lá" để không đếm hai lần; bỏ huỷ / chưa có kế hoạch).
function spiOf(items, actualOf, day = new Date()) {
  let ev = 0, pv = 0, wsum = 0, act = 0;
  for (const i of items) {
    if (isCancelled(i) || !i.baselineStart) continue;
    const w = weightOf(i), p = plannedPct(i, day), a = actualOf(i);
    pv += w * p; ev += w * a; wsum += w; act += w * a;
  }
  return { spi: pv > 0 ? Math.round(ev / pv * 100) / 100 : null, plannedPct: wsum ? Math.round(pv / wsum * 10) / 10 : null, actualPct: wsum ? Math.round(act / wsum * 10) / 10 : null };
}
// Lá: hạng mục không có con (trong tập đang xét).
const leavesOf = items => { const parents = new Set(items.map(i => i.parentId).filter(x => x != null)); return items.filter(i => !parents.has(i.id)); };

// KPI tiến độ = 50% × SPI (quy 0–1,1 về 0–100) + 30% × tỷ lệ hoàn thành đúng hạn + 20% × (1 − tỷ lệ đường găng trễ).
// Thành phần chưa có dữ liệu thì bỏ, chia lại trọng số.
function kpiOf(items, actualOf, day = new Date(), cfg = DEFAULT_ALERTS) {
  const live = items.filter(i => !isCancelled(i) && i.baselineStart);
  const st = live.map(i => ({ i, s: statusOf(i, actualOf(i), day, cfg) }));
  const { spi, plannedPct: p, actualPct: a } = spiOf(live, actualOf, day);
  const finished = st.filter(x => ['DONE_ON_TIME', 'DONE_LATE'].includes(x.s.code));
  const dueOrDone = st.filter(x => finished.includes(x) || x.s.code === 'OVERDUE');
  const onTime = finished.filter(x => x.s.code === 'DONE_ON_TIME').length;
  const crit = st.filter(x => x.i.critical && (x.s.planned ?? 0) > 0);
  const critLate = crit.filter(x => ['OVERDUE', 'BEHIND', 'LATE_START', 'DONE_LATE'].includes(x.s.code)).length;
  const parts = [
    spi != null ? [50, Math.min(spi, 1.1) / 1.1 * 100] : null,
    dueOrDone.length ? [30, onTime / dueOrDone.length * 100] : null,
    crit.length ? [20, (1 - critLate / crit.length) * 100] : null,
  ].filter(Boolean);
  const wsum = parts.reduce((n, [w]) => n + w, 0);
  const lateList = st.filter(x => x.s.lateDays > 0);
  const count = c => st.filter(x => x.s.code === c).length;
  return {
    items: live.length, spi, plannedPct: p, actualPct: a,
    score: wsum ? Math.round(parts.reduce((n, [w, v]) => n + w * v, 0) / wsum) : null,
    onTimeRate: dueOrDone.length ? Math.round(onTime / dueOrDone.length * 100) : null,
    behind: count('BEHIND') + count('LATE_START'), overdue: count('OVERDUE'), ahead: count('AHEAD'), onTrack: count('ON_TRACK'),
    done: finished.length, criticalLate: critLate, avgLateDays: lateList.length ? Math.round(lateList.reduce((n, x) => n + x.s.lateDays, 0) / lateList.length) : null,
  };
}

// Đường cong S kế hoạch theo tháng (cuối mỗi tháng T): % kế hoạch tích luỹ có trọng số.
function plannedCurve(items, t0Date, months) {
  const live = items.filter(i => !isCancelled(i) && i.baselineStart);
  const out = [];
  for (let t = 0; t <= months; t++) {
    const day = new Date(monthStart(t0Date, t + 1).getTime() - 1);
    out.push({ t, day, planned: spiOf(live, () => 0, day).plannedPct ?? 0 });
  }
  return out;
}

module.exports = {
  DEFAULT_ALERTS, alertConfigOf, STATUS, vnDay, vnMidnight, monthStart, tToDates, currentT, timeValue, parseMtlRows, splitOwner,
  plannedPct, durationDays, weightOf, rollup, statusOf, spiOf, leavesOf, kpiOf, plannedCurve, isDone, isCancelled,
};
