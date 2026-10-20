// Kiểu xem "Tiến độ kế hoạch" (Gantt) của trang dự án.
// - Thước thời gian Quý / Tháng / Tuần (số tuần ISO "T42"); phóng to tới mức ngày thì có thêm hàng ngày.
// - Mức phóng: Toàn bộ (vừa mọi việc đang lọc) · Tuần · Tháng · Quý · Năm; lùi/tiến theo đơn vị, nút "Hôm nay".
// - Mỗi việc một dòng, việc nhánh thụt vào dưới việc cha, gập/mở được (nhớ bằng localStorage).
// - Thanh từ ngày bắt đầu (startDate ?? assignedAt ?? createdAt) tới hạn, tô theo % tiến độ; hạn nội bộ là vạch nhỏ.
// Vẽ một lần bằng HTML/CSS, mọi toạ độ (px) tính trước từ số ngày — không đo từng phần tử — nên ~2000 việc vẫn mượt.
// Gắn: drawGantt(body, { items, project, openItemHash }) — items là danh sách đã lọc, project có states [{id, category}].
import { esc } from '../util.js';
import { icon } from '../icons.js';

const DAY = 86_400_000, VN_OFFSET = 7 * 3_600_000;
export const ZOOMS = [['fit', 'Toàn bộ'], ['week', 'Tuần'], ['month', 'Tháng'], ['quarter', 'Quý'], ['year', 'Năm']];
const UNITS = ['week', 'month', 'quarter', 'year'];
const STEP = { fit: ['Lùi', 'Tiến'], week: ['Tuần trước', 'Tuần sau'], month: ['Tháng trước', 'Tháng sau'], quarter: ['Quý trước', 'Quý sau'], year: ['Năm trước', 'Năm sau'] };
const ROMAN = ['I', 'II', 'III', 'IV'];
const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const PRINT = { name: 420, track: 620 }; // khổ A4 ngang, lề 10 mm (~1040px)
const OUTLIER = 7305; // bỏ qua ngày lệch quá ±20 năm khi tính khung (dữ liệu nhập nhầm)
const MAX_PAD = 50, SLACK = 2; // SLACK: chừa 2 ngày cuối vùng vẽ để cuộn tới trọn đơn vị cuối (thanh cuộn chiếm chỗ)

// ---------- Ngày theo giờ Việt Nam: số thứ tự ngày (0 = 01/01/1970) ----------
export function vnDay(value) {
  if (value == null || value === '') return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? Math.floor((t + VN_OFFSET) / DAY) : null;
}
const ymd = day => { const d = new Date(day * DAY); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() }; };
const dayOf = (y, m, d = 1) => Date.UTC(y, m, d) / DAY;
const pad2 = n => String(n).padStart(2, '0');
export const fmtDay = day => { if (day == null) return ''; const { y, m, d } = ymd(day); return `${pad2(d)}/${pad2(m + 1)}/${y}`; };
const fmtShort = day => { const { m, d } = ymd(day); return `${pad2(d)}/${pad2(m + 1)}`; };
export const isoDow = day => ((day + 3) % 7 + 7) % 7 + 1; // 1 = Thứ Hai … 7 = Chủ nhật
export function isoWeek(day) {
  const thursday = day - isoDow(day) + 4;
  const year = ymd(thursday).y;
  return { year, week: Math.floor((thursday - dayOf(year, 0, 1)) / 7) + 1 };
}
export function unitStart(day, unit) {
  if (unit === 'week') return day - isoDow(day) + 1;
  const { y, m } = ymd(day);
  if (unit === 'month') return dayOf(y, m);
  if (unit === 'quarter') return dayOf(y, m - (m % 3));
  return dayOf(y, 0);
}
// Cộng n đơn vị vào một ngày đầu đơn vị (đầu tuần / tháng / quý / năm).
export function addUnits(day, unit, n) {
  if (unit === 'week') return day + 7 * n;
  const { y, m } = ymd(day);
  if (unit === 'month') return dayOf(y, m + n);
  if (unit === 'quarter') return dayOf(y, m + 3 * n);
  return dayOf(y + n, 0);
}

// ---------- Dữ liệu việc ----------
// "Đinh Quang Huy" → "Quang Huy"; bỏ phần trong ngoặc như "(thử)".
export function shortName(full) {
  const parts = String(full || '').replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(Boolean);
  return parts.slice(-2).join(' ');
}
const clampPct = p => Math.max(0, Math.min(100, Math.round(Number(p) || 0)));
export function itemSchedule(item) {
  return { start: vnDay(item.startDate ?? item.assignedAt ?? item.createdAt), due: vnDay(item.dueDate), internal: vnDay(item.internalDueDate) };
}
// Trạng thái màu: hoàn thành (xanh) / quá hạn (đỏ: chưa xong và hạn < hôm nay theo ngày VN) / huỷ / đang làm (màu brand).
export function statusOf(item, category, today) {
  const cat = category ?? item.state?.category;
  if (cat === 'CANCELLED') return 'cancelled';
  if (cat === 'COMPLETED' || (!cat && item.completedAt)) return 'done';
  const due = vnDay(item.dueDate);
  return due != null && due < today ? 'overdue' : 'active';
}
export function prepareItems(items, states = [], today) {
  const cat = new Map((states || []).map(s => [s.id, s.category]));
  return items.map(item => ({ item, ...itemSchedule(item), status: statusOf(item, cat.get(item.stateId), today) }));
}
// Sắp xếp: hạn sớm trước (chưa có hạn cuối), rồi ngày bắt đầu, rồi số thứ tự.
const order = (a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || a.start - b.start || (a.item.number ?? 0) - (b.item.number ?? 0) || a.item.id - b.item.id;
// Cây việc → các dòng hiển thị. Việc nhánh có cha nằm ngoài danh sách (bị lọc) thì hiện như việc gốc.
export function buildRows(entries, collapsed = new Set()) {
  const byId = new Map(entries.map(e => [e.item.id, e]));
  const kids = new Map(), roots = [];
  for (const e of entries) {
    const pid = e.item.parentId;
    if (pid != null && pid !== e.item.id && byId.has(pid)) { if (!kids.has(pid)) kids.set(pid, []); kids.get(pid).push(e); } else roots.push(e);
  }
  roots.sort(order);
  for (const list of kids.values()) list.sort(order);
  const rows = [], seen = new Set();
  const walk = (e, depth, hidden) => {
    seen.add(e.item.id);
    const children = (kids.get(e.item.id) || []).filter(c => !seen.has(c.item.id));
    const open = !collapsed.has(e.item.id);
    if (!hidden) rows.push({ ...e, depth, childCount: children.length, open });
    for (const c of children) walk(c, depth + 1, hidden || !open);
  };
  for (const e of roots) walk(e, 0, false);
  // Dữ liệu lỗi có vòng cha–con: những việc chưa được duyệt tới thì đưa lên làm việc gốc.
  for (const e of [...entries].sort(order)) if (!seen.has(e.item.id)) walk(e, 0, false);
  return { rows, parentIds: [...kids.keys()] };
}
export function summarize(entries) {
  const s = { total: entries.length, overdue: 0, done: 0, cancelled: 0, noDue: 0 };
  for (const e of entries) { if (e.status === 'overdue') s.overdue++; else if (e.status === 'done') s.done++; else if (e.status === 'cancelled') s.cancelled++; if (e.due == null) s.noDue++; }
  return s;
}

// ---------- Khung thời gian ----------
// Vừa toàn bộ việc: từ ngày bắt đầu sớm nhất tới hạn muộn nhất, có lề; tối thiểu 14 ngày. end là ngày ngay sau khung.
export function fitRange(entries, today) {
  let lo = Infinity, hi = -Infinity;
  for (const e of entries) for (const v of [e.start, e.due, e.internal]) if (v != null && Math.abs(v - today) <= OUTLIER) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (lo > hi) lo = hi = today;
  const margin = Math.max(3, Math.round((hi - lo + 1) * 0.04));
  let start = lo - margin, end = hi + 1 + margin;
  if (end - start < 14) { const mid = Math.floor((start + end) / 2); start = mid - 7; end = mid + 7; }
  return { start, end };
}
// Vùng vẽ (cuộn ngang được): trọn năm, chứa khung vừa và hôm nay, đủ rộng cho một khung nhìn; pad = số năm thêm hai đầu.
export function canvasRange(fit, today, windowDays, pad = { before: 0, after: 0 }) {
  const lo = Math.min(fit.start, today - 7), hi = Math.max(fit.end, today + 8);
  const start = addUnits(unitStart(lo, 'year'), 'year', -pad.before);
  let end = addUnits(unitStart(hi - 1, 'year'), 'year', 1 + pad.after);
  while (end - start < windowDays + SLACK) end = addUnits(end, 'year', 1);
  return { start, end };
}
export const unitDays = (day, unit) => { const u = unitStart(day, unit); return addUnits(u, unit, 1) - u; };
// Mức "Tuần/Tháng/Quý/Năm": khung nhìn vừa đúng một đơn vị (tuần, tháng… chứa ngày đầu khung); "Toàn bộ": vừa khung việc.
export function pxPerDay(zoom, trackWidth, fit, leftDay) {
  const w = Math.max(160, trackWidth);
  return UNITS.includes(zoom) ? w / unitDays(Math.floor(leftDay + 1e-6), zoom) : w / (fit.end - fit.start);
}

// ---------- Thước thời gian ----------
const quarterLabel = (day, w) => { const { y, m } = ymd(day), q = ROMAN[Math.floor(m / 3)]; return w >= 100 ? `Quý ${q}/${y}` : w >= 44 ? `${q}/${String(y).slice(2)}` : ''; };
const monthLabel = (day, w) => { const { y, m } = ymd(day); return w >= 120 ? `Tháng ${m + 1}/${y}` : w >= 64 ? `Tháng ${m + 1}` : w >= 14 ? String(m + 1) : ''; };
function weekLabel(monday, w, week) {
  if (w >= 120) return `T${week} · ${fmtShort(monday)}–${fmtShort(monday + 6)}`;
  return w >= 30 ? `T${week}` : w >= 18 || (w >= 14 && week % 2) ? String(week) : ''; // ô hẹp: ghi tuần lẻ cho thoáng
}
const px = v => Math.round(v * 10) / 10;
export function buildScale(canvas, ppd) {
  const { start, end } = canvas;
  // Kiểu nhãn chọn theo bề rộng ô ngắn nhất của hàng (tháng 28 ngày, quý 90 ngày) để cả hàng cùng một kiểu; ô bị cắt ở mép thì rút gọn thêm.
  const cell = (list, a, b, base, make) => {
    const s = Math.max(a, start), e = Math.min(b, end), w = Math.min(base, (e - s) * ppd);
    if (e > s) list.push({ x: px((s - start) * ppd), w: px((e - s) * ppd), narrow: w < 40, ...make(w) });
  };
  const quarters = [], months = [], weeks = [], days = [], lines = [], weekends = [];
  for (let d = unitStart(start, 'quarter'); d < end; d = addUnits(d, 'quarter', 1)) cell(quarters, d, addUnits(d, 'quarter', 1), 90 * ppd, w => ({ label: quarterLabel(d, w) }));
  for (let d = unitStart(start, 'month'); d < end; d = addUnits(d, 'month', 1)) {
    cell(months, d, addUnits(d, 'month', 1), 28 * ppd, w => ({ label: monthLabel(d, w), title: `Tháng ${ymd(d).m + 1}/${ymd(d).y}` }));
    if (d > start) lines.push({ x: px((d - start) * ppd), k: ymd(d).m % 3 ? 'm' : 'q' });
  }
  const weekPx = 7 * ppd;
  for (let d = unitStart(start, 'week'); d < end; d += 7) {
    const { week } = isoWeek(d);
    cell(weeks, d, d + 7, 7 * ppd, w => ({ label: weekLabel(d, w, week), title: `Tuần ${week}: ${fmtDay(d)} – ${fmtDay(d + 6)}` }));
    if (weekPx >= 14 && d > start && ymd(d).d !== 1) lines.push({ x: px((d - start) * ppd), k: 'w' });
    if (ppd >= 8) cell(weekends, d + 5, d + 7, 2 * ppd, () => ({}));
  }
  if (ppd >= 18) for (let d = start; d < end; d++) { const { d: n, dow } = ymd(d); days.push({ x: px((d - start) * ppd), w: px(ppd), label: ppd >= 44 ? `${DOW[dow]} ${n}` : String(n), we: dow === 0 || dow === 6 }); }
  return { quarters, months, weeks, days, lines, weekends, width: px((end - start) * ppd) };
}

// ---------- Mô hình (thuần, không đụng DOM — dùng cho unit test) ----------
// Phần dữ liệu: không phụ thuộc bề rộng màn hình.
export function buildData(items, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const today = vnDay(now), nowDay = (now.getTime() + VN_OFFSET) / DAY;
  const collapsed = opts.collapsed || new Set();
  const entries = prepareItems(items || [], opts.states, today);
  const { rows, parentIds } = buildRows(entries, collapsed);
  let codeLen = 4;
  for (const r of rows) codeLen = Math.max(codeLen, String(r.item.code ?? '').length);
  return {
    entries, rows, parentIds, stats: summarize(entries), today, nowDay, deptName: opts.deptName,
    zoom: opts.print ? 'fit' : (UNITS.includes(opts.zoom) ? opts.zoom : 'fit'), codeCh: Math.min(12, codeLen) + 1,
    anyOpen: parentIds.some(id => !collapsed.has(id)),
  };
}
// Phần toạ độ: tỉ lệ px/ngày, vùng vẽ, ngày đầu khung nhìn, thước thời gian.
export function layoutModel(data, opts = {}) {
  const { zoom, today } = data;
  const trackWidth = opts.print ? PRINT.track : Math.max(160, opts.trackWidth || 0);
  const fit = fitRange(data.entries, today);
  let leftDay = opts.print ? fit.start : opts.leftDay ?? (zoom === 'fit' ? fit.start : unitStart(today, zoom));
  const ppd = pxPerDay(zoom, trackWidth, fit, leftDay), windowDays = trackWidth / ppd;
  const pad = { before: 0, after: 0, ...(opts.pad || {}) };
  let canvas;
  if (opts.print) canvas = { ...fit }; else {
    canvas = canvasRange(fit, today, windowDays, pad);
    while (leftDay < canvas.start && pad.before < MAX_PAD) { pad.before++; canvas = canvasRange(fit, today, windowDays, pad); }
    while (leftDay + windowDays + SLACK > canvas.end && pad.after < MAX_PAD) { pad.after++; canvas = canvasRange(fit, today, windowDays, pad); }
    leftDay = Math.max(canvas.start, Math.min(leftDay, canvas.end - windowDays));
  }
  const nowX = data.nowDay >= canvas.start && data.nowDay <= canvas.end ? px((data.nowDay - canvas.start) * ppd) : null;
  return { ...data, fit, canvas, ppd, windowDays, trackWidth, leftDay, pad, nowX, scale: buildScale(canvas, ppd) };
}
export const buildModel = (items, opts = {}) => layoutModel(buildData(items, opts), opts);

// ---------- HTML ----------
// Nội dung tooltip (title) của thanh/mốc: bắt đầu – hạn, %, người. Gán khi rê chuột tới để HTML 2000 dòng gọn hơn.
export function tooltipText(r, today) {
  const i = r.item, pct = r.status === 'done' ? 100 : clampPct(i.progress), names = (i.assignees || []).map(a => a.fullName).filter(Boolean).join(', ');
  const lines = [`${i.code ?? ''} · ${i.title ?? ''}`, `Bắt đầu ${fmtDay(r.start)} – Hạn ${fmtDay(r.due)}`];
  if (r.internal != null) lines.push(`Hạn nội bộ ${fmtDay(r.internal)}`);
  lines.push(`Tiến độ ${pct}%${names ? ' · ' + names : ''}`);
  if (r.status === 'overdue') lines.push(`Quá hạn ${today - r.due} ngày`);
  else if (r.status === 'done') lines.push('Đã hoàn thành' + (i.completedAt ? ' ngày ' + fmtDay(vnDay(i.completedAt)) : ''));
  else if (r.status === 'cancelled') lines.push('Đã huỷ');
  return lines.join('\n');
}
function trackHtml(r, m, pct) {
  const { canvas, ppd, today } = m, i = r.item, code = esc(i.code ?? '');
  const x = d => px((Math.max(canvas.start, Math.min(canvas.end, d)) - canvas.start) * ppd);
  if (r.due == null) return `<span class="g-nodue" style="margin-left:${Math.min(x(r.start ?? today), Math.max(0, m.scale.width - 90))}px" data-testid="gantt-nodue-${code}">chưa có hạn</span>`;
  const late = r.status === 'overdue' ? today - r.due : 0;
  const start = r.start ?? r.due;
  if (i.parentId != null && start >= r.due) { // việc nhánh có bắt đầu ≥ hạn → mốc hình thoi
    const cx = x(r.due + 0.5);
    return `<i class="g-ms st-${r.status}" style="left:${cx}px" data-testid="gantt-ms-${code}"></i><span class="g-lab${late ? ' late' : ''}" style="left:${px(cx + 11)}px">${fmtShort(r.due)}${late ? ` · trễ ${late} ngày` : ''}</span>`;
  }
  const left = x(Math.min(start, r.due)), w = Math.max(4, px(x(r.due + 1) - left));
  const fill = (r.status === 'active' || r.status === 'overdue') && pct > 0 ? `<i style="width:${pct}%"></i>` : '';
  const idue = r.internal != null && r.internal !== r.due ? `<i class="g-idue" style="left:${x(r.internal + 1)}px" title="Hạn nội bộ ${fmtDay(r.internal)}"></i>` : '';
  return `<div class="g-bar st-${r.status}" style="left:${left}px;width:${w}px" data-testid="gantt-bar-${code}">${fill}</div>${idue}${late ? `<span class="g-lab late" style="left:${px(left + w + 6)}px">Trễ ${late} ngày</span>` : ''}`;
}
function rowHtml(r, m) {
  const i = r.item, code = esc(i.code ?? ''), title = esc(i.title ?? ''), parent = r.childCount > 0;
  const pct = r.status === 'done' ? 100 : clampPct(i.progress);
  const names = (i.assignees || []).map(a => a.fullName).filter(Boolean);
  let who = names.length ? shortName(names[0]) + (names.length > 1 ? ` +${names.length - 1}` : '') : '', whoTitle = names.join(', ');
  if (!who && m.deptName && i.leadDepartmentId) { whoTitle = m.deptName(i.leadDepartmentId) || ''; who = whoTitle; }
  const tog = parent ? `<button type="button" class="g-tog" data-tog="${i.id}" aria-expanded="${r.open}" aria-label="${r.open ? 'Gập' : 'Mở'} ${r.childCount} việc nhánh của ${code}" data-testid="gantt-toggle-${code}"></button>` : '';
  const kids = parent ? `<span class="g-kids">${r.childCount}<span class="g-sr"> việc nhánh</span></span>` : '';
  return `<div class="g-row st-${r.status}${parent ? ' is-parent' : ''}${r.depth ? ' is-child' : ''}" data-id="${i.id}" data-testid="gantt-row-${code}">`
    + `<div class="g-name" style="--d:${Math.min(r.depth, 6)}">${tog}<span class="code">${code}</span>`
    + `<button type="button" class="g-open" title="${title}"><span class="t">${title}</span>${kids}</button>`
    + `<span class="g-who" title="${esc(whoTitle)}">${esc(who) || '—'}</span><span class="g-pct">${pct}%</span></div>`
    + `<div class="g-track">${trackHtml(r, m, pct)}</div></div>`;
}
const tierHtml = (cls, cells) => `<div class="g-tier ${cls}">${cells.map(c => `<span class="g-cell${c.we ? ' we' : ''}${c.narrow ? ' n' : ''}" style="left:${c.x}px;width:${c.w}px"${c.title ? ` title="${esc(c.title)}"` : ''}>${c.label ? `<b>${esc(c.label)}</b>` : ''}</span>`).join('')}</div>`;
export function chartHtml(m) {
  const { scale, nowX } = m;
  const head = `<div class="g-head"><div class="g-corner"><div class="g-cols"><span></span><span>Mã</span><span>Công việc <span class="g-count">${m.stats.total}</span></span><span>Chủ trì</span><span>%</span></div></div>`
    + `<div class="g-scale">${tierHtml('q', scale.quarters)}${tierHtml('m', scale.months)}${tierHtml('w', scale.weeks)}${scale.days.length ? tierHtml('d', scale.days) : ''}`
    + `${nowX != null ? `<span class="g-flag" style="left:${nowX}px">Hôm nay</span>` : ''}</div></div>`;
  const grid = `<div class="g-grid" aria-hidden="true">${scale.weekends.map(w => `<i class="g-we" style="left:${w.x}px;width:${w.w}px"></i>`).join('')}`
    + `${scale.lines.map(l => `<i class="g-line ${l.k}" style="left:${l.x}px"></i>`).join('')}</div>`;
  const rows = new Array(m.rows.length);
  for (let k = 0; k < m.rows.length; k++) rows[k] = rowHtml(m.rows[k], m);
  return `${head}<div class="g-rows">${grid}${rows.join('')}</div>`;
}
function legendHtml(stats) {
  return `<div class="legend gantt-legend" data-testid="gantt-legend">
    <span><i class="lg lg-bar"><i></i></i>Đang thực hiện, phần đậm là % đã làm</span>
    <span><i class="lg lg-bar st-overdue"><i></i></i>Quá hạn: chưa xong mà đã qua hạn</span>
    <span><i class="lg lg-bar st-done"></i>Hoàn thành</span>
    ${stats.cancelled ? '<span><i class="lg lg-bar st-cancelled"></i>Huỷ</span>' : ''}
    <span><i class="lg lg-ms"></i>Mốc: việc nhánh trong một ngày</span>
    <span><i class="lg lg-idue"></i>Hạn nội bộ</span>
    <span><i class="lg lg-now"></i>Hôm nay</span>
  </div>`;
}
function frameHtml(m, project) {
  const s = m.stats, [prev, next] = STEP[m.zoom];
  const stats = `${s.total} việc${s.overdue ? ` · <b>${s.overdue} quá hạn</b>` : ''}${s.done ? ` · ${s.done} hoàn thành` : ''}${s.noDue ? ` · ${s.noDue} chưa có hạn` : ''}`;
  return `<section class="gantt" data-testid="gantt" data-project="${esc(project?.id ?? '')}">
    <p class="gantt-print-head"><b>Tiến độ kế hoạch</b> — ${esc(project?.name || '')} · ${stats} · in ngày ${fmtDay(m.today)}</p>
    <div class="gantt-bar">
      <div class="tabs gantt-zoom" role="group" aria-label="Mức phóng">${ZOOMS.map(([k, label]) => `<button type="button" data-zoom="${k}" class="${k === m.zoom ? 'active' : ''}" aria-pressed="${k === m.zoom}" data-testid="gantt-zoom-${k}"${k === 'fit' ? ' title="Vừa toàn bộ việc đang lọc"' : ''}>${label}</button>`).join('')}</div>
      <span class="btn-group">
        <button type="button" class="btn btn-ghost btn-sm" data-nav="-1" aria-label="${prev}" title="${prev}" data-testid="gantt-prev">${icon('left')}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-nav="0" data-testid="gantt-today">Hôm nay</button>
        <button type="button" class="btn btn-ghost btn-sm" data-nav="1" aria-label="${next}" title="${next}" data-testid="gantt-next">${icon('right')}</button>
      </span>
      <span class="gantt-range" data-testid="gantt-range"></span>
      <span class="gantt-stats">${stats}</span>
      <span class="gantt-tools">
        ${m.parentIds.length ? `<button type="button" class="btn btn-ghost btn-sm" data-fold="${m.anyOpen ? 'close' : 'open'}" data-testid="gantt-fold">${m.anyOpen ? 'Gập tất cả' : 'Mở tất cả'}</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-print data-testid="gantt-print">In</button>
      </span>
    </div>
    <div class="gantt-scroll" tabindex="0" role="region" aria-label="Biểu đồ tiến độ, cuộn ngang để xem các tháng khác"></div>
    ${legendHtml(s)}
  </section>`;
}

// ---------- Trạng thái theo dự án + DOM ----------
const views = new Map(); // projectId → { zoom, leftDay, pad, collapsed, sig, lastW }
let last = null, printing = false, observer = null;
const collapseKey = id => `workhub_gantt_collapsed_${id}`;
function loadCollapsed(projectId) {
  try { const arr = JSON.parse(localStorage.getItem(collapseKey(projectId)) || '[]'); return new Set(Array.isArray(arr) ? arr.filter(Number.isInteger) : []); } catch { return new Set(); }
}
function saveCollapsed(projectId, set) {
  try { if (set.size) localStorage.setItem(collapseKey(projectId), JSON.stringify([...set].slice(-3000))); else localStorage.removeItem(collapseKey(projectId)); } catch { /* trình duyệt chặn lưu trữ: chỉ nhớ trong phiên */ }
}
function viewState(projectId) {
  if (!views.has(projectId)) views.set(projectId, { zoom: 'fit', leftDay: null, pad: { before: 0, after: 0 }, collapsed: loadCollapsed(projectId), sig: null, lastW: 0 });
  return views.get(projectId);
}
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const signature = items => items.length + ':' + items.reduce((h, i) => (h * 31 + (Number(i.id) || 0)) | 0, 7);
// Vẽ lại (gập/mở, đổi mức phóng, cập nhật trực tiếp…) thì trả lại tiêu điểm bàn phím cho đúng nút cũ.
function focusSelector(el) {
  const row = el.closest('.g-row');
  if (row && el.matches('.g-tog, .g-open')) return `.g-row[data-id="${row.dataset.id}"] .${el.classList.contains('g-tog') ? 'g-tog' : 'g-open'}`;
  for (const a of ['data-zoom', 'data-nav']) if (el.hasAttribute(a)) return `[${a}="${el.getAttribute(a)}"]`;
  for (const a of ['data-fold', 'data-print']) if (el.hasAttribute(a)) return `[${a}]`;
  return el.classList.contains('gantt-scroll') ? '.gantt-scroll' : null;
}

export function drawGantt(body, opts = {}) {
  const { items = [], project, openItemHash } = opts;
  const pid = project?.id ?? 0, st = viewState(pid);
  const prevRoot = body.querySelector('.gantt');
  const keepTop = prevRoot && prevRoot.dataset.project === String(pid) ? prevRoot.querySelector('.gantt-scroll')?.scrollTop || 0 : 0;
  const active = document.activeElement, refocus = active && prevRoot?.contains(active) ? focusSelector(active) : null;
  last = { body, opts, print: printing };
  if (!printing) { const sig = signature(items); if (st.sig !== sig) { if (st.zoom === 'fit') st.leftDay = null; st.sig = sig; } }
  if (!items.length) { body.innerHTML = '<div class="card empty" data-testid="gantt-empty">Không có việc phù hợp bộ lọc.</div>'; return; }
  const data = buildData(items, { states: project?.states, collapsed: st.collapsed, now: opts.now, deptName: opts.deptName, zoom: st.zoom, print: printing });
  // Dựng khung (thanh công cụ, chú thích) rồi đo bề rộng một lần; biểu đồ vẽ một lượt với toạ độ đã tính.
  body.innerHTML = frameHtml(data, project);
  const root = body.querySelector('.gantt'), scroll = root.querySelector('.gantt-scroll');
  const nameW = printing ? PRINT.name : parseFloat(getComputedStyle(root).getPropertyValue('--gantt-name-w')) || 320;
  const m = layoutModel(data, { trackWidth: scroll.clientWidth - nameW, leftDay: st.leftDay, pad: st.pad, print: printing });
  if (!printing) st.pad = m.pad;
  root.style.setProperty('--gantt-canvas-w', m.scale.width + 'px');
  root.style.setProperty('--code-w', m.codeCh + 'ch');
  // Vạch hôm nay vẽ bằng ::after của từng dòng (đè lên thanh, dưới cột tên) — không thêm phần tử.
  if (m.nowX != null) { root.style.setProperty('--now-x', m.nowX + 'px'); root.classList.add('has-now'); }
  if (printing) root.style.setProperty('--gantt-name-w', PRINT.name + 'px');
  scroll.innerHTML = chartHtml(m);
  scroll.scrollTop = keepTop;
  scroll.scrollLeft = (m.leftDay - m.canvas.start) * m.ppd;
  if (printing) return;
  st.lastW = scroll.clientWidth;
  if (refocus) body.querySelector(refocus)?.focus({ preventScroll: true });

  const rangeEl = root.querySelector('.gantt-range');
  const leftNow = () => m.canvas.start + scroll.scrollLeft / m.ppd;
  const tol = Math.min(0.5, 1 / m.ppd); // sai số 1px do scrollLeft làm tròn
  const showRange = () => { const a = leftNow(); rangeEl.textContent = `${fmtDay(Math.floor(a + tol))} – ${fmtDay(Math.ceil(a + m.windowDays - tol) - 1)}`; };
  showRange();
  let ticking = false;
  scroll.onscroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; if (!scroll.isConnected) return; st.leftDay = leftNow(); showRange(); });
  };
  const again = () => { st.leftDay = leftNow(); drawGantt(body, opts); };
  const goTo = day => {
    st.leftDay = day;
    const sameScale = Math.abs(pxPerDay(m.zoom, m.trackWidth, m.fit, day) - m.ppd) < 1e-9; // tháng 28–31 ngày, năm nhuận… thì vẽ lại theo tỉ lệ mới
    if (!sameScale || day < m.canvas.start || day + m.windowDays + SLACK > m.canvas.end) { drawGantt(body, opts); return; }
    scroll.scrollTo({ left: (day - m.canvas.start) * m.ppd, behavior: reduceMotion() ? 'auto' : 'smooth' });
  };
  const navigate = dir => {
    const left = leftNow(), z = m.zoom;
    if (dir === 0) {
      if (z === 'fit' && m.nowDay >= left + m.windowDays * 0.1 && m.nowDay <= left + m.windowDays * 0.9) return; // hôm nay đang hiện rõ
      const target = z === 'fit' ? m.nowDay - m.windowDays / 2 : unitStart(m.today, z);
      return goTo(Math.max(m.canvas.start, Math.min(target, m.canvas.end - m.windowDays)));
    }
    if (z === 'fit') return goTo(left + dir * Math.max(7, Math.round(m.windowDays * 0.8)));
    const cur = Math.floor(left + tol), u = unitStart(cur, z);
    goTo(dir > 0 ? addUnits(u, z, 1) : u < cur ? u : addUnits(u, z, -1));
  };
  const setZoom = z => {
    const left = leftNow(), right = left + m.windowDays;
    st.zoom = z; st.pad = { before: 0, after: 0 };
    st.leftDay = z === 'fit' ? null : unitStart(m.nowDay >= left && m.nowDay <= right ? m.today : Math.floor((left + right) / 2), z);
    drawGantt(body, opts);
  };
  const toggle = id => {
    if (st.collapsed.has(id)) st.collapsed.delete(id); else st.collapsed.add(id);
    saveCollapsed(pid, st.collapsed);
    again();
  };
  root.onclick = e => {
    const t = e.target;
    const z = t.closest('[data-zoom]'); if (z) return setZoom(z.dataset.zoom);
    const n = t.closest('[data-nav]'); if (n) return navigate(Number(n.dataset.nav));
    const f = t.closest('[data-fold]');
    if (f) {
      for (const id of m.parentIds) { if (f.dataset.fold === 'close') st.collapsed.add(id); else st.collapsed.delete(id); }
      saveCollapsed(pid, st.collapsed);
      return again();
    }
    if (t.closest('[data-print]')) return window.print();
    const tog = t.closest('[data-tog]'); if (tog) return toggle(Number(tog.dataset.tog));
    const row = t.closest('.g-row'); if (row && openItemHash) openItemHash(row.dataset.id);
  };
  const byId = new Map(m.rows.map(r => [String(r.item.id), r]));
  scroll.onmouseover = e => {
    const el = e.target.closest?.('.g-bar, .g-ms');
    if (el && !el.title) { const r = byId.get(el.closest('.g-row')?.dataset.id); if (r) el.title = tooltipText(r, m.today); }
  };
  root.onkeydown = e => {
    const row = e.target.closest?.('.g-row');
    if (!row || !e.target.matches('.g-open, .g-tog')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const next = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
      if (!next?.classList.contains('g-row')) return;
      e.preventDefault();
      next.querySelector('.g-open').focus({ preventScroll: true });
      const headH = scroll.querySelector('.g-head').offsetHeight, top = next.offsetTop + next.offsetParent.offsetTop, h = next.offsetHeight;
      if (top - headH < scroll.scrollTop) scroll.scrollTop = top - headH; else if (top + h > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = top + h - scroll.clientHeight;
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && row.classList.contains('is-parent')) {
      const open = !st.collapsed.has(Number(row.dataset.id));
      if (open !== (e.key === 'ArrowLeft')) return;
      e.preventDefault();
      toggle(Number(row.dataset.id));
    }
  };
  watchResize(scroll, st, again);
}

// Đổi bề rộng khung (xoay điện thoại, thu sidebar…) thì tính lại tỉ lệ; giữ nguyên ngày đang xem.
function watchResize(scroll, st, redraw) {
  if (typeof ResizeObserver === 'undefined') return;
  observer?.disconnect();
  observer = new ResizeObserver(entries => {
    if (!scroll.isConnected) { observer?.disconnect(); return; }
    const w = entries[0]?.contentRect.width ?? 0;
    if (Math.abs(w - st.lastW) > 16) { st.lastW = w; requestAnimationFrame(() => { if (scroll.isConnected) redraw(); }); }
  });
  observer.observe(scroll);
}

// In: vẽ lại vừa khổ giấy A4 ngang (toàn bộ khung việc đang lọc), in xong trả lại như cũ.
// Nghe cả beforeprint/afterprint và media "print" (trình duyệt báo theo một trong hai cách).
if (typeof window !== 'undefined') {
  const mql = typeof matchMedia === 'function' ? matchMedia('print') : null;
  const enter = () => {
    if (printing || !last?.body.isConnected || !last.body.querySelector('.gantt')) return;
    printing = true; drawGantt(last.body, last.opts);
  };
  const exit = () => {
    printing = false;
    if (mql?.matches || !last?.print) return; // còn đang ở chế độ in, hoặc chưa vẽ bản in
    setTimeout(() => { if (!printing && last?.print && last.body.isConnected) drawGantt(last.body, last.opts); }, 0);
  };
  window.addEventListener('beforeprint', enter);
  window.addEventListener('afterprint', exit);
  mql?.addEventListener?.('change', e => (e.matches ? enter() : exit()));
}
