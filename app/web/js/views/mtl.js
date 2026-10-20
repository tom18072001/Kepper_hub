// Kepper — dự án theo Master Timeline: Tổng quan dự án (Dashboard), Kế hoạch & Gantt (kế hoạch gốc so với thực tế),
// nhập MTL tổng / MTL bộ phận từ Excel, cài đặt T0 và ngưỡng cảnh báo, KPI tiến độ theo bộ phận / người.
import { api } from '../api.js';
import { store, deptLink, personLink } from '../store.js';
import { $, $$, esc, fmtDate, toast, openModal, closeModal, errorMessage, uiPref, replaceHashParams, ago } from '../util.js';
import { icon } from '../icons.js';

const TONE = { NOT_DUE: '', LATE_START: 'warn', ON_TRACK: 'ok', BEHIND: 'warn', AHEAD: 'info', OVERDUE: 'danger', DONE_ON_TIME: 'ok', DONE_LATE: 'warn', CANCELLED: '', NO_PLAN: '' };
const ATTN = ['OVERDUE', 'BEHIND', 'LATE_START'];
const num = (v, d = 1) => (v == null ? '—' : Number(v).toLocaleString('vi-VN', { maximumFractionDigits: d }));
const pct = v => (v == null ? '—' : `${num(v)}%`);
const spiTone = s => (s == null ? '' : s >= 0.95 ? 'ok' : s >= 0.8 ? 'warn' : 'danger');
const scoreTone = s => (s == null ? '' : s >= 85 ? 'ok' : s >= 70 ? 'warn' : 'danger');
const statusPill = i => `<span class="pill mtl-st ${TONE[i.status] || ''}" data-testid="mtl-status">${esc(i.statusLabel || '')}${i.status === 'OVERDUE' && i.lateDays ? ` ${i.lateDays} ngày` : ''}</span>`;
const tLabel = i => (i.startT != null ? `T${num(i.startT, 0)}–T${num(i.endT, 0)}` : '');
const planLink = (project, extra = {}) => `#/projects/${project.id}?${new URLSearchParams({ view: 'plan', ...extra })}`;
const itemLink = (project, id) => { const [path, q = ''] = location.hash.split('?'); const u = new URLSearchParams(q); u.set('item', id); return `${path}?${u}`; };

let cache = null; // { id, at, data } — tránh tải lại khi chỉ mở / đóng panel
async function load(project, fresh = false) {
  if (!fresh && cache && cache.id === project.id && Date.now() - cache.at < 4000) return cache.data;
  const data = await api(`/api/projects/${project.id}/mtl`);
  cache = { id: project.id, at: Date.now(), data };
  return data;
}
export function invalidateMtl() { cache = null; }

// ---------- Thanh thao tác của dự án MTL ----------
export function mtlActions(project) {
  if (!project.rights.canManage) return '';
  return `<button class="menu-item" data-mtl="import" data-testid="mtl-import">${icon('upload')}<span>Nhập MTL từ Excel</span></button>
    <button class="menu-item" data-mtl="settings" data-testid="mtl-settings">${icon('settings')}<span>T0 &amp; ngưỡng cảnh báo</span></button>
    <button class="menu-item" data-mtl="run" data-testid="mtl-run-alerts">${icon('bell')}<span>Kiểm tra cảnh báo ngay</span></button>`;
}
export function bindMtlActions(root, project, reload) {
  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-mtl]'); if (!b) return;
    const act = b.dataset.mtl;
    if (act === 'import') importDialog(project, () => { invalidateMtl(); reload(); });
    if (act === 'settings') settingsDialog(project, () => { invalidateMtl(); reload(); });
    if (act === 'run') { try { const r = await api(`/api/projects/${project.id}/mtl-alerts/run`, { method: 'POST' }); toast(r.alerts ? `Đã gửi ${r.alerts} cảnh báo (${r.notified} thông báo)` : 'Không có cảnh báo mới', 'ok'); invalidateMtl(); reload(); } catch (error) { toast(errorMessage(error), 'err'); } }
  });
}

// ---------- Tổng quan dự án (Dashboard) ----------
export async function drawMtlOverview(body, project) {
  const d = await load(project);
  const s = d.summary, p = d.project;
  const tile = (label, value, sub, tone, href, testid) => `<a class="mtl-tile ${tone || ''}" href="${href}" data-testid="${testid}"><span class="mtl-tl">${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</a>`;
  const nm = d.nextMilestone;
  const tiles = `<div class="mtl-tiles">
    ${tile('Tháng hiện tại', p.currentT == null ? '—' : `T${p.currentT}<span class="muted">/${p.totalT}</span>`, p.t0Date ? `T0 = ${fmtDate(p.t0Date).slice(3)}` : 'Chưa đặt T0', '', planLink(project), 'mtl-tile-t')}
    ${tile('Kế hoạch / thực tế', `${pct(s.plannedPct)} <span class="muted">/</span> ${pct(s.actualPct)}`, 'tiến độ có trọng số (thời lượng)', '', planLink(project), 'mtl-tile-progress')}
    ${tile('SPI', s.spi == null ? '—' : num(s.spi, 2), s.spi == null ? 'chưa có hạng mục tới kỳ' : s.spi >= 1 ? 'đúng / vượt kế hoạch' : 'chậm so với kế hoạch', spiTone(s.spi), planLink(project), 'mtl-tile-spi')}
    ${tile('KPI tiến độ', s.score == null ? '—' : s.score, s.onTimeRate == null ? '' : `đúng hạn ${s.onTimeRate}%`, scoreTone(s.score), '#mtlDepts', 'mtl-tile-kpi')}
    ${tile('Chậm tiến độ', s.behind, 'gồm chậm khởi động', s.behind ? 'warn' : '', planLink(project, { st: 'attn' }), 'mtl-tile-behind')}
    ${tile('Trễ hạn', s.overdue, s.criticalLate ? `${s.criticalLate} trên đường găng` : 'theo kế hoạch gốc', s.overdue ? 'danger' : '', planLink(project, { st: 'OVERDUE' }), 'mtl-tile-overdue')}
    ${tile('Mốc kế tiếp', nm ? '◆' : '—', nm ? `${esc(nm.title.slice(0, 48))} · ${fmtDate(nm.baselineEnd)}` : 'không còn mốc', nm && ATTN.includes(nm.status) ? 'danger' : '', nm ? itemLink(project, nm.id) : planLink(project), 'mtl-tile-milestone')}
  </div>`;
  const deptRows = d.byDepartment.map(r => `<tr class="clickable" data-href="${planLink(project, { dept: r.id })}" data-testid="mtl-dept-${r.code || r.id}"><td><b>${deptLink(r.id, r.name)}</b></td><td class="num">${r.items}</td>
      <td class="num">${pct(r.plannedPct)}</td><td class="num">${pct(r.actualPct)}</td><td class="num"><span class="pill ${spiTone(r.spi)}">${r.spi == null ? '—' : num(r.spi, 2)}</span></td>
      <td class="num${r.behind ? ' warn-t' : ''}">${r.behind}</td><td class="num${r.overdue ? ' danger-t' : ''}">${r.overdue}</td><td class="num">${r.criticalLate || 0}</td><td class="num"><b class="${scoreTone(r.score)}-t">${r.score ?? '—'}</b></td></tr>`).join('');
  const ms = d.milestones.map(m => `<tr class="clickable" data-href="${itemLink(project, m.id)}"><td class="code">${esc(m.step || '')}</td><td>${m.critical ? '<span class="crit" title="Đường găng">●</span> ' : ''}${esc(m.title)}</td><td class="nowrap">${fmtDate(m.baselineEnd)}</td>
      <td class="nowrap">${m.completedAt ? `xong ${fmtDate(m.completedAt)}` : m.forecastEnd ? `dự báo ${fmtDate(m.forecastEnd)}` : '—'}</td><td>${statusPill(m)}</td></tr>`).join('');
  const alerts = d.alerts.map(a => `<a class="mtl-alert ${a.level === 'DANGER' ? 'danger' : a.level === 'WARN' ? 'warn' : ''}" href="${itemLink(project, a.item.id)}"><span class="pill">${esc(a.label)}</span><span class="grow"><b>${esc(a.item.code)}</b> ${esc(a.item.title)}<span class="muted xs"> · ${esc(a.item.department)}</span></span><span class="muted xs nowrap">${fmtDate(a.day)}</span></a>`).join('');
  body.innerHTML = `<div class="mtl">
    ${!p.t0Date ? '<div class="card empty">Chưa đặt ngày T0 — vào "Khác → T0 &amp; ngưỡng cảnh báo".</div>' : ''}
    ${d.items.length ? '' : `<div class="card empty" data-testid="mtl-empty"><p>Chưa có Master Timeline.</p>${project.rights.canManage ? '<button class="btn btn-primary" data-mtl="import">Nhập MTL từ Excel</button>' : ''}</div>`}
    ${tiles}
    <div class="mtl-grid">
      <section class="card mtl-curve"><div class="mtl-h"><h3>Đường cong S — kế hoạch / thực tế</h3><span class="muted xs">% tích luỹ theo tháng T</span></div>${curveSvg(d)}</section>
      <section class="card"><div class="mtl-h"><h3>Cảnh báo gần đây</h3><span class="muted xs">tự động 07:30 hằng ngày</span></div><div class="mtl-alerts" data-testid="mtl-alerts">${alerts || '<p class="muted sm">Chưa có cảnh báo.</p>'}</div></section>
    </div>
    <section class="card" id="mtlDepts"><div class="mtl-h"><h3>Theo bộ phận chủ trì</h3><span class="muted xs">KPI = 50% SPI + 30% đúng hạn + 20% đường găng không trễ · tính trên kế hoạch gốc</span></div>
      <div class="tbl-scroll"><table class="table mtl-depts" data-testid="mtl-departments"><thead><tr><th>Bộ phận</th><th class="num">Hạng mục</th><th class="num">% KH</th><th class="num">% TT</th><th class="num">SPI</th><th class="num">Chậm</th><th class="num">Trễ</th><th class="num">Găng trễ</th><th class="num">KPI</th></tr></thead><tbody>${deptRows || '<tr><td colspan="9" class="muted">—</td></tr>'}</tbody></table></div></section>
    <section class="card" id="mtlPeople" hidden></section>
    <section class="card"><div class="mtl-h"><h3>Mốc chính ◆</h3></div><div class="tbl-scroll"><table class="table" data-testid="mtl-milestones"><thead><tr><th>Bước</th><th>Mốc</th><th>Kế hoạch</th><th>Thực tế / dự báo</th><th>Trạng thái</th></tr></thead><tbody>${ms || '<tr><td colspan="5" class="muted">—</td></tr>'}</tbody></table></div></section>
  </div>`;
  body.onclick = e => { const r = e.target.closest('tr[data-href]'); if (r && !e.target.closest('a,[data-person],[data-dept-link]')) location.hash = r.dataset.href; };
  // KPI theo người: chỉ Ban lãnh đạo / trưởng bộ phận (máy chủ chặn người khác).
  if (project.rights.canManage || store.me.permissions?.['work.approve']?.operate) api(`/api/projects/${project.id}/mtl-kpi`).then(k => {
    const el = $('#mtlPeople', body); if (!el || !k.rows.length) return;
    el.hidden = false;
    el.innerHTML = `<div class="mtl-h"><h3>KPI tiến độ theo người chủ trì</h3><span class="muted xs">${k.scope === 'UNIT' ? 'bộ phận của bạn' : 'mọi bộ phận'} · chỉ để tham khảo · lần xem được ghi nhật ký</span></div>
      <div class="tbl-scroll"><table class="table" data-testid="mtl-people"><thead><tr><th>Người</th><th>Bộ phận</th><th class="num">Hạng mục</th><th class="num">SPI</th><th class="num">Đúng hạn</th><th class="num">Chậm</th><th class="num">Trễ</th><th class="num">KPI</th></tr></thead>
      <tbody>${k.rows.map(r => `<tr><td><b>${personLink({ id: r.id, fullName: r.fullName })}</b>${r.title ? `<div class="muted xs">${esc(r.title)}</div>` : ''}</td><td class="muted sm">${esc(r.department)}</td><td class="num">${r.items}</td>
        <td class="num"><span class="pill ${spiTone(r.spi)}">${r.spi == null ? '—' : num(r.spi, 2)}</span></td><td class="num">${r.onTimeRate == null ? '—' : r.onTimeRate + '%'}</td><td class="num">${r.behind}</td><td class="num">${r.overdue}</td><td class="num"><b class="${scoreTone(r.score)}-t">${r.score ?? '—'}</b></td></tr>`).join('')}</tbody></table></div>`;
  }).catch(() => {});
}

// Đường cong S: đường kế hoạch (cuối mỗi tháng T) + điểm thực tế (ảnh chụp hằng ngày) + vạch hôm nay.
function curveSvg(d) {
  const pts = d.curve, T = Math.max(1, d.project.totalT);
  if (!pts.length) return '<p class="muted sm">Chưa có dữ liệu.</p>';
  const W = 640, H = 220, L = 34, R = 10, Tp = 10, B = 26;
  const x = t => L + (t + 1) / (T + 1) * (W - L - R), y = v => Tp + (1 - v / 100) * (H - Tp - B);
  const t0 = new Date(d.project.t0Date), tOf = day => { const a = new Date(new Date(day).getTime() + 7 * 3_600_000), b = new Date(t0.getTime() + 7 * 3_600_000); return (a.getUTCFullYear() - b.getUTCFullYear()) * 12 + a.getUTCMonth() - b.getUTCMonth() + (a.getUTCDate() - 1) / 31; };
  const plan = [`${x(-1)},${y(0)}`, ...pts.map(p => `${x(p.t)},${y(p.planned)}`)].join(' ');
  const act = d.actualCurve.map(s => [tOf(s.day) - 1, s.actualPct]);
  const now = tOf(new Date()) - 1;
  if (d.summary.actualPct != null) act.push([now, d.summary.actualPct]);
  const actLine = act.length > 1 ? `<polyline points="${act.map(([t, v]) => `${x(t)},${y(v)}`).join(' ')}" class="c-act"/>` : '';
  const dots = act.map(([t, v]) => `<circle cx="${x(t)}" cy="${y(v)}" r="3" class="c-act-dot"><title>Thực tế ${num(v)}%</title></circle>`).join('');
  const step = T > 40 ? 6 : T > 20 ? 3 : 1;
  const xt = Array.from({ length: Math.floor(T / step) + 1 }, (_, i) => i * step).map(t => `<text x="${x(t)}" y="${H - 8}" class="c-ax">T${t}</text>`).join('');
  const yt = [0, 25, 50, 75, 100].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="c-grid"/><text x="${L - 6}" y="${y(v) + 4}" class="c-ax" text-anchor="end">${v}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="mtl-svg" role="img" aria-label="Đường cong S tiến độ: kế hoạch ${pct(d.summary.plannedPct)}, thực tế ${pct(d.summary.actualPct)}" data-testid="mtl-curve">
    ${yt}${xt}<polyline points="${plan}" class="c-plan"/>${actLine}${dots}
    ${now >= -1 && now <= T ? `<line x1="${x(now)}" x2="${x(now)}" y1="${Tp}" y2="${H - B}" class="c-today"/><text x="${x(now) + 4}" y="${Tp + 10}" class="c-ax">hôm nay</text>` : ''}
  </svg><div class="mtl-legend"><span><i class="lg-plan"></i>Kế hoạch gốc</span><span><i class="lg-act"></i>Thực tế</span></div>`;
}

// ---------- Kế hoạch & Gantt ----------
export async function drawMtlPlan(body, project, params) {
  const d = await load(project);
  const f = { dept: params.get('dept') || '', st: params.get('st') || '', plan: params.get('plan') || '', q: params.get('q') || '' };
  const T = Math.max(1, d.project.totalT), cur = d.project.currentT;
  const byParent = new Map();
  for (const i of d.items) { const k = i.parentId && d.items.some(x => x.id === i.parentId) ? i.parentId : 0; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(i); }
  const matches = i => (!f.dept || String(i.leadDepartmentId) === f.dept || (i.supportDepartmentIds || []).map(String).includes(f.dept))
    && (!f.plan || String(i.planId) === f.plan)
    && (!f.st || (f.st === 'attn' ? ATTN.includes(i.status) : f.st === 'critical' ? i.critical : f.st === 'milestone' ? i.milestone : i.status === f.st))
    && (!f.q || (i.title + ' ' + (i.planCode || '') + ' ' + i.code).toLowerCase().includes(f.q.toLowerCase()));
  const keep = new Set();
  const walk = (list, depth) => { for (const i of list) { const kids = byParent.get(i.id) || []; walk(kids, depth + 1); if (matches(i) || kids.some(k => keep.has(k.id))) keep.add(i.id); } };
  walk(byParent.get(0) || [], 0);
  const rows = [];
  const add = (list, depth) => { for (const i of list) { if (!keep.has(i.id)) continue; rows.push([i, depth]); add(byParent.get(i.id) || [], depth + 1); } };
  add(byParent.get(0) || [], 0);
  const dayT = (day) => { if (!day) return null; const a = new Date(new Date(day).getTime() + 7 * 3_600_000), b = new Date(new Date(d.project.t0Date).getTime() + 7 * 3_600_000); return (a.getUTCFullYear() - b.getUTCFullYear()) * 12 + a.getUTCMonth() - b.getUTCMonth() + (a.getUTCDate() - 1) / 30.5; };
  const col = 100 / (T + 1);
  const bar = i => {
    const s = dayT(i.baselineStart), e = dayT(i.baselineEnd);
    if (s == null || e == null) return '';
    const left = s * col, width = Math.max(0.6, (e - s) * col);
    const fc = i.forecastEnd && !i.completedAt ? dayT(i.forecastEnd) : null;
    return `<span class="g-bar ${TONE[i.status] || ''}${i.critical ? ' crit' : ''}" style="left:${left}%;width:${width}%" title="${esc(`${i.planCode || ''} ${i.title} — KH ${fmtDate(i.baselineStart)} → ${fmtDate(i.baselineEnd)}, thực tế ${num(i.actual)}%`)}"><i style="width:${Math.min(100, i.actual)}%"></i></span>
      ${fc != null && fc > e ? `<span class="g-fc" style="left:${e * col}%;width:${(fc - e) * col}%" title="Dự báo hoàn thành ${fmtDate(i.forecastEnd)}"></span>` : ''}
      ${i.milestone ? `<span class="g-ms" style="left:${e * col}%" title="Mốc">◆</span>` : ''}`;
  };
  const step = T > 40 ? 6 : T > 20 ? 3 : 1;
  const head = Array.from({ length: T + 1 }, (_, t) => `<span style="left:${t * col}%;width:${col}%">${t % step === 0 ? `T${t}` : ''}</span>`).join('');
  const deptOpts = [...new Map(d.items.map(i => [i.leadDepartmentId, i.leadDepartmentName])).entries()].filter(([id]) => id).sort((a, b) => a[1].localeCompare(b[1], 'vi'));
  const sel = (id, label, opts, value, testid) => `<label class="field fx-field mtl-f">${label}<select id="${id}" data-testid="${testid}"${value ? ' class="set"' : ''}>${opts.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  body.innerHTML = `<div class="mtl">
    <div class="mtl-pf" role="search" aria-label="Lọc kế hoạch">
      <label class="search-field lf-search">${icon('search')}<input type="search" id="mtlQ" value="${esc(f.q)}" placeholder="Tìm bước, hạng mục…" data-testid="mtl-q"></label>
      ${sel('mtlDept', 'Bộ phận', [['', 'Tất cả'], ...deptOpts], f.dept, 'mtl-f-dept')}
      ${sel('mtlSt', 'Tình trạng', [['', 'Tất cả'], ['attn', 'Cần chú ý (chậm / trễ)'], ['OVERDUE', 'Trễ hạn'], ['BEHIND', 'Chậm tiến độ'], ['LATE_START', 'Chậm khởi động'], ['AHEAD', 'Vượt tiến độ'], ['ON_TRACK', 'Đúng tiến độ'], ['NOT_DUE', 'Chưa đến kỳ'], ['critical', 'Đường găng'], ['milestone', 'Mốc ◆']], f.st, 'mtl-f-status')}
      ${d.plans.length > 1 ? sel('mtlPlan', 'Kế hoạch', [['', 'Tất cả'], ...d.plans.map(p => [p.id, p.name])], f.plan, 'mtl-f-plan') : ''}
      <span class="lf-count">${rows.length}/${d.items.length} hạng mục</span>
    </div>
    <div class="card mtl-plan"><div class="tbl-scroll"><table class="table mtl-ptable" data-testid="mtl-plan">
      <thead><tr><th class="mp-step">Bước</th><th class="mp-title">Hạng mục</th><th class="mp-owner">Đầu mối</th><th class="mp-t">Kế hoạch</th><th class="num">% KH</th><th class="num">% TT</th><th>Tình trạng</th><th class="mp-gantt"><div class="g-head">${head}</div></th></tr></thead>
      <tbody>${rows.map(([i, depth]) => `<tr class="clickable${depth ? ' mp-child' : ''}${i.children ? ' mp-parent' : ''}" data-href="${itemLink(project, i.id)}" data-testid="mtl-row-${esc(i.planCode || i.code)}">
        <td class="code mp-step">${esc(i.planCode || '')}</td>
        <td class="mp-title" style="padding-left:${10 + depth * 18}px">${i.critical ? '<span class="crit" title="Đường găng">●</span> ' : ''}${esc(i.title)}${i.milestone ? ' <span class="ms" title="Mốc">◆</span>' : ''}${i.assignees.length ? `<span class="muted xs mp-who">${i.assignees.map(u => personLink(u)).join(', ')}</span>` : ''}</td>
        <td class="mp-owner muted sm">${esc(i.ownerText || i.leadDepartmentName)}${i.externalParty ? '' : ''}</td>
        <td class="mp-t nowrap"><span>${tLabel(i)}</span><span class="muted xs">${fmtDate(i.baselineStart)} – ${fmtDate(i.baselineEnd)}</span></td>
        <td class="num">${pct(i.planned)}</td><td class="num"><b>${pct(i.actual)}</b></td><td>${statusPill(i)}${i.variance != null && ['BEHIND', 'AHEAD', 'ON_TRACK'].includes(i.status) ? `<span class="muted xs"> ${i.variance > 0 ? '+' : ''}${num(i.variance)}</span>` : ''}</td>
        <td class="mp-gantt"><div class="g-track">${cur != null && cur <= T ? `<span class="g-today" style="left:${(dayT(new Date())) * col}%"></span>` : ''}${bar(i)}</div></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Không có hạng mục khớp bộ lọc.</td></tr>'}</tbody></table></div>
      <div class="mtl-legend"><span><i class="lg-bar"></i>Kế hoạch gốc (tô đậm = % thực tế)</span><span><i class="lg-crit"></i>Đường găng</span><span>◆ Mốc</span><span><i class="lg-fc"></i>Dự báo trễ</span><span><i class="lg-today"></i>Hôm nay</span></div></div>
  </div>`;
  const setP = (k, v) => { replaceHashParams({ [k]: v || null }); f[k] = v; drawMtlPlan(body, project, new URLSearchParams(location.hash.split('?')[1] || '')); };
  body.onchange = e => { const m = { mtlDept: 'dept', mtlSt: 'st', mtlPlan: 'plan' }[e.target.id]; if (m) setP(m, e.target.value); };
  let t = null;
  body.oninput = e => { if (e.target.id === 'mtlQ') { clearTimeout(t); t = setTimeout(() => { setP('q', e.target.value.trim()); const q = $('#mtlQ', body); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 250); } };
  body.onclick = e => { const r = e.target.closest('tr[data-href]'); if (r && !e.target.closest('a,[data-person],[data-dept-link]')) location.hash = r.dataset.href; };
}

// ---------- Khối MTL trong chi tiết hạng mục ----------
export function mtlPanelBlock(d, project, editable) {
  if (project.kind !== 'MTL') return '';
  const canManage = project.rights?.canManage;
  const st = d.mtl || {};
  return `<div class="mtl-box" data-testid="mtl-box">
    <div class="row wrap">${d.planCode ? `<span class="code">Bước ${esc(d.planCode)}</span>` : ''}${d.critical ? '<span class="pill danger">Đường găng</span>' : ''}${d.milestone ? '<span class="pill">◆ Mốc</span>' : ''}${st.statusLabel ? `<span class="pill mtl-st ${TONE[st.status] || ''}">${esc(st.statusLabel)}</span>` : ''}</div>
    <div class="mtl-facts">
      <div><span class="muted xs">Kế hoạch gốc</span><b>${fmtDate(d.baselineStart)} – ${fmtDate(d.baselineEnd)}</b>${d.startT != null ? `<span class="muted xs"> (T${num(d.startT, 0)}–T${num(d.endT, 0)})</span>` : ''}</div>
      <div><span class="muted xs">Kế hoạch / thực tế</span><b>${pct(st.planned)} / ${pct(st.actual ?? d.progress)}</b>${st.variance != null ? `<span class="muted xs"> (${st.variance > 0 ? '+' : ''}${num(st.variance)} điểm)</span>` : ''}</div>
      ${d.ownerText ? `<div><span class="muted xs">Đầu mối</span>${esc(d.ownerText)}</div>` : ''}
      ${d.externalParty ? `<div><span class="muted xs">Cơ quan / đơn vị ngoài</span>${esc(d.externalParty)}</div>` : ''}
      <label><span class="muted xs">Dự báo hoàn thành</span><input type="date" id="ipForecast" value="${d.forecastEnd ? new Date(new Date(d.forecastEnd).getTime() + 7 * 3_600_000).toISOString().slice(0, 10) : ''}" ${editable ? '' : 'disabled'} data-testid="item-forecast"></label>
    </div>
    ${canManage ? `<div class="row wrap"><label class="check sm"><input type="checkbox" id="ipCritical" ${d.critical ? 'checked' : ''}> Đường găng</label><label class="check sm"><input type="checkbox" id="ipMilestone" ${d.milestone ? 'checked' : ''}> Mốc</label>
      <button type="button" class="link-btn" data-act="rebaseline" data-testid="rebaseline-open">Điều chỉnh kế hoạch gốc…</button></div>` : ''}
  </div>`;
}
export function rebaselineDialog(d, project, done) {
  const modal = openModal(`<h2>Điều chỉnh kế hoạch gốc — ${esc(d.code)}</h2><form>
    <p class="muted sm">Kế hoạch gốc là căn cứ tính chậm / trễ và KPI tiến độ. Mỗi lần điều chỉnh phải ghi lý do và được lưu vào nhật ký.</p>
    ${d.startT != null ? `<div class="grid2"><label class="field">Bắt đầu (tháng T)<input type="number" name="startT" min="0" step="1" value="${d.startT}" required></label><label class="field">Kết thúc (tháng T)<input type="number" name="endT" min="0" step="1" value="${d.endT}" required></label></div>`
      : `<div class="grid2"><label class="field">Bắt đầu<input type="date" name="baselineStart" required></label><label class="field">Kết thúc<input type="date" name="baselineEnd" required></label></div>`}
    <label class="field">Lý do điều chỉnh<textarea name="reason" rows="2" required maxlength="500" data-testid="rebaseline-reason"></textarea></label>
    <p class="error" id="rbErr"></p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="rebaseline-save">Lưu</button></div></form>`);
  const form = modal.querySelector('form');
  modal.querySelector('[data-close]').onclick = () => closeModal();
  form.onsubmit = async e => {
    e.preventDefault();
    const body = { reason: form.reason.value };
    if (form.startT) Object.assign(body, { startT: Number(form.startT.value), endT: Number(form.endT.value) });
    else Object.assign(body, { baselineStart: new Date(form.baselineStart.value + 'T00:00:00+07:00').toISOString(), baselineEnd: new Date(form.baselineEnd.value + 'T23:59:59+07:00').toISOString() });
    try { await api(`/api/items/${d.id}/rebaseline`, { method: 'POST', body }); closeModal(); toast('Đã điều chỉnh kế hoạch gốc', 'ok'); invalidateMtl(); done(); }
    catch (error) { $('#rbErr', modal).textContent = errorMessage(error); }
  };
}

// ---------- Nhập MTL từ Excel ----------
function importDialog(project, done) {
  const depts = store.departments.filter(d => d.isActive !== false);
  const modal = openModal(`<h2>Nhập Master Timeline từ Excel</h2><form>
    <p class="muted sm">Bảng cần dòng tiêu đề <b>Bước | Hạng mục công việc | Đầu mối | Bắt đầu (T) | Kết thúc (T) | Thời lượng | Đường găng | Mốc</b>.
      Thời gian ghi theo <b>tháng T</b> (tính từ T0) hoặc ngày cụ thể. MTL bộ phận thêm cột <b>Thuộc bước</b> để gắn vào hạng mục của MTL tổng.
      Nhập lại cùng kế hoạch sẽ <b>cập nhật theo Bước</b> (giữ tiến độ đã cập nhật). Tệp chỉ đọc rồi xoá, không lưu.</p>
    <div class="grid2">
      <label class="field">Tệp .xlsx<input type="file" name="file" accept=".xlsx" required data-testid="mtl-import-file"></label>
      <label class="field">Loại<select name="kind" data-testid="mtl-import-kind"><option value="MASTER">MTL tổng (dự án)</option><option value="DEPARTMENT">MTL bộ phận</option></select></label>
      <label class="field mtl-dep" hidden>Bộ phận<select name="departmentId" data-testid="mtl-import-dept">${depts.map(d => `<option value="${d.id}"${d.id === store.me.departmentId ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
      <label class="field">Tên kế hoạch <span class="muted xs">(để trống: theo tên sheet)</span><input name="planName" maxlength="160" placeholder="VD: MTL overall"></label>
      <label class="field" hidden>Sheet<select name="sheet" data-testid="mtl-import-sheet"></select></label>
    </div>
    <label class="check sm"><input type="checkbox" name="rebaseline" value="1"> Đặt lại kế hoạch gốc theo tệp này (khi nhập lại; ghi nhật ký)</label>
    <div id="mtlPreview"></div><p class="error" id="mtlErr"></p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button type="button" class="btn" data-dry data-testid="mtl-import-preview">Xem trước</button><button class="btn btn-primary" data-testid="mtl-import-go" disabled>Nhập</button></div></form>`, { wide: true });
  const form = modal.querySelector('form'), go = $('[data-testid="mtl-import-go"]', modal);
  const reset = () => { go.disabled = true; $('#mtlPreview', modal).innerHTML = ''; };
  form.kind.onchange = () => { $('.mtl-dep', modal).hidden = form.kind.value !== 'DEPARTMENT'; reset(); };
  form.file.onchange = () => { form.sheet.innerHTML = ''; form.sheet.closest('label').hidden = true; reset(); };
  form.sheet.onchange = () => modal.querySelector('[data-dry]').click();
  const send = dry => { const fd = new FormData(form); if (!fd.get('sheet')) fd.delete('sheet'); if (dry) fd.set('dryRun', '1'); if (!form.rebaseline.checked) fd.delete('rebaseline'); if (form.kind.value !== 'DEPARTMENT') fd.delete('departmentId'); return api(`/api/projects/${project.id}/mtl-import`, { method: 'POST', form: fd }); };
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('[data-dry]').onclick = async () => {
    if (!form.file.files.length) { $('#mtlErr', modal).textContent = 'Chọn tệp Excel'; return; }
    $('#mtlErr', modal).textContent = '';
    try {
      const p = await send(true);
      if (p.sheets.length > 1) { form.sheet.innerHTML = p.sheets.map(s => `<option value="${esc(s.name)}"${s.name === p.sheet ? ' selected' : ''}>${esc(s.name)} (${s.items} hạng mục)</option>`).join(''); form.sheet.closest('label').hidden = false; }
      $('#mtlPreview', modal).innerHTML = `<div class="card mtl-preview" data-testid="mtl-import-summary">
        <p><b>${p.items}</b> hạng mục từ sheet <b>${esc(p.sheet)}</b> → kế hoạch <b>${esc(p.planName)}</b>: tạo mới ${p.create}, cập nhật ${p.update}${p.baselineChanged ? ` (${p.baselineChanged} hạng mục đổi thời gian${form.rebaseline.checked ? ' — sẽ đặt lại kế hoạch gốc' : ' — giữ kế hoạch gốc'})` : ''}. Đường găng ${p.critical}, mốc ${p.milestones}.</p>
        ${p.unmatchedOwners.length ? `<p class="muted sm">Đầu mối không khớp bộ phận (giao cho bộ phận sở hữu dự án, ghi ở "cơ quan / đơn vị ngoài"): ${p.unmatchedOwners.map(o => `${esc(o.text)} (${o.count})`).join(', ')}</p>` : ''}
        ${p.unmatchedParents.length ? `<p class="muted sm">Không tìm thấy bước MTL tổng: ${p.unmatchedParents.map(esc).join(', ')} — hạng mục sẽ không gắn vào hạng mục cha.</p>` : ''}
        ${p.warnings.length ? `<details><summary class="muted sm">${p.warnings.length} cảnh báo khi đọc tệp</summary><p class="muted sm">${p.warnings.map(esc).join('<br>')}</p></details>` : ''}
        <div class="tbl-scroll" style="max-height:320px"><table class="table compact"><thead><tr><th>Bước</th><th>Hạng mục</th><th>Đầu mối → chủ trì</th><th>Phối hợp / ngoài</th><th>Kế hoạch</th><th></th><th>Hành động</th></tr></thead>
        <tbody>${p.preview.slice(0, 80).map(r => `<tr><td class="code">${esc(r.step)}</td><td>${esc(r.title.slice(0, 70))}${r.parent ? `<div class="muted xs">thuộc ${esc(r.parent)}</div>` : ''}</td><td class="sm">${esc(r.ownerText)}<div class="muted xs">→ ${esc(r.lead)}</div></td>
          <td class="muted xs">${esc([...r.support, r.externalParty].filter(Boolean).join(', '))}</td><td class="nowrap sm">${r.startT != null ? `T${r.startT}–T${r.endT}` : ''}<div class="muted xs">${fmtDate(r.baselineStart)} – ${fmtDate(r.baselineEnd)}</div></td>
          <td>${r.critical ? '<span class="crit" title="Đường găng">●</span>' : ''}${r.milestone ? '◆' : ''}</td><td class="muted xs">${esc(r.action)}</td></tr>`).join('')}</tbody></table></div>
        ${p.preview.length > 80 ? `<p class="muted xs">… và ${p.preview.length - 80} hạng mục khác.</p>` : ''}</div>`;
      go.disabled = false;
    } catch (error) { $('#mtlErr', modal).textContent = errorMessage(error); }
  };
  form.onsubmit = async e => {
    e.preventDefault();
    try { const r = await send(false); closeModal(); toast(`Đã nhập MTL: tạo ${r.created}, cập nhật ${r.updated} hạng mục`, 'ok'); done(); }
    catch (error) { $('#mtlErr', modal).textContent = errorMessage(error); }
  };
}

// ---------- T0 & ngưỡng cảnh báo ----------
async function settingsDialog(project, done) {
  const d = await load(project, true);
  const c = d.project.alertConfig, t0 = d.project.t0Date ? new Date(new Date(d.project.t0Date).getTime() + 7 * 3_600_000).toISOString().slice(0, 7) : '';
  const modal = openModal(`<h2>T0 &amp; ngưỡng cảnh báo — ${esc(project.name)}</h2><form>
    <div class="grid2"><label class="field">Tháng T0<input type="month" name="t0" value="${t0}" required data-testid="mtl-t0"></label>
      <label class="field">Lý do đổi T0 <span class="muted xs">(bắt buộc khi đổi — dời toàn bộ kế hoạch gốc)</span><input name="reason" maxlength="500"></label></div>
    <div class="grid2">
      <label class="field">Chậm tiến độ khi thấp hơn kế hoạch (điểm %)<input type="number" name="behindPct" min="1" max="50" value="${c.behindPct}"></label>
      <label class="field">Vượt tiến độ khi cao hơn kế hoạch (điểm %)<input type="number" name="aheadPct" min="1" max="50" value="${c.aheadPct}"></label>
      <label class="field">Nhắc sắp bắt đầu trước (ngày)<input type="number" name="startSoonDays" min="0" max="60" value="${c.startSoonDays}"></label>
      <label class="field">Nhắc sắp đến hạn trước (ngày)<input type="number" name="dueSoonDays" min="0" max="60" value="${c.dueSoonDays}"></label>
      <label class="field">Nhắc khi chưa cập nhật tiến độ sau (ngày)<input type="number" name="staleDays" min="1" max="60" value="${c.staleDays}"></label>
    </div>
    <p class="muted xs">Cảnh báo chạy 07:30 hằng ngày: gửi người chủ trì, lãnh đạo bộ phận chủ trì, PMO (trưởng / chủ dự án); hạng mục đường găng hoặc mốc bị chậm / trễ thì gửi thêm Ban lãnh đạo.</p>
    <p class="error" id="msErr"></p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="mtl-settings-save">Lưu</button></div></form>`);
  const form = modal.querySelector('form');
  modal.querySelector('[data-close]').onclick = () => closeModal();
  form.onsubmit = async e => {
    e.preventDefault();
    const body = { alertConfig: Object.fromEntries(['behindPct', 'aheadPct', 'startSoonDays', 'dueSoonDays', 'staleDays'].map(k => [k, form[k].value])) };
    if (form.t0.value && form.t0.value !== t0) Object.assign(body, { t0Date: new Date(form.t0.value + '-01T00:00:00+07:00').toISOString(), reason: form.reason.value });
    try { const r = await api(`/api/projects/${project.id}/mtl-settings`, { method: 'PUT', body }); closeModal(); toast(r.moved ? `Đã lưu — dời kế hoạch gốc ${r.moved} hạng mục` : 'Đã lưu', 'ok'); done(); }
    catch (error) { $('#msErr', modal).textContent = errorMessage(error); }
  };
}
export { load as loadMtl, ATTN, TONE };
