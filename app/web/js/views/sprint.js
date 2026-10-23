// Kepper — tab Sprint của dự án Master Timeline.
// Sprint = một giai đoạn gồm một nhóm bước MTL tổng (vd. "Chuyển nhượng dự án (B1–9)", "Đề xuất NƠXH → CTĐT"), PMO thiết lập.
// - Theo sprint (mặc định): lộ trình các sprint trên trục tháng T (tiến độ theo đầu việc, tình trạng, mốc ◆), chi tiết sprint chọn:
//   các bước theo thứ tự, mỗi bước kèm việc con (MTL bộ phận) — xong 1 trong 5 việc con = bước được 20%; cập nhật một chạm.
// - Theo tháng: trong tháng T phải xong gì / đang chạy / chuẩn bị tháng sau, tổng kết theo ban.
import { api } from '../api.js';
import { $, esc, fmtDate, uiPref, replaceHashParams, openModal, closeModal, toast, errorMessage } from '../util.js';
import { icon } from '../icons.js';
import { sprintCard, bindQuick, SPRINT_TONE as TONE } from './sprint-card.js';
import { invalidateMtl } from './mtl.js';

const num = (v, d = 2) => (v == null ? '—' : Number(v).toLocaleString('vi-VN', { maximumFractionDigits: d }));
const pct = v => (v == null ? '—' : `${num(v, 1)}%`);
const spiTone = s => (s == null ? '' : s >= 0.95 ? 'ok' : s >= 0.8 ? 'warn' : 'danger');
const itemHref = id => { const [path, q = ''] = location.hash.split('?'); const u = new URLSearchParams(q); u.set('item', id); return `${path}?${u}`; };
const hrefWith = (set, del = []) => { const [path, q = ''] = location.hash.split('?'); const u = new URLSearchParams(q); u.delete('item'); u.set('view', 'sprint'); for (const k of del) u.delete(k); for (const [k, v] of Object.entries(set)) { if (v == null) u.delete(k); else u.set(k, v); } return `${path}?${u}`; };
const paramsNow = () => new URLSearchParams(location.hash.split('?')[1] || '');
const isDone = st => String(st).startsWith('DONE');

export async function drawMtlSprint(body, project, params) {
  if (!body.dataset.quickBound) {
    body.dataset.quickBound = '1';
    bindQuick(body, async () => { invalidateMtl(); await drawMtlSprint(body, project, paramsNow()); });
  }
  const mode = params.get('mode') === 'month' ? 'month' : 'sprint';
  const modes = `<div class="sp-modes"><div class="chips" role="group" aria-label="Cách xem">
      <a class="chip${mode === 'sprint' ? ' on' : ''}" href="${hrefWith({}, ['mode', 't', 's'])}" data-testid="sp-mode-sprint">Theo sprint (giai đoạn)</a>
      <a class="chip${mode === 'month' ? ' on' : ''}" href="${hrefWith({ mode: 'month' }, ['s'])}" data-testid="sp-mode-month">Theo tháng</a></div>
    ${project.rights.canManage ? `<button type="button" class="btn btn-sm" data-sp-setup data-testid="sp-setup">${icon('settings')}Thiết lập sprint</button>` : ''}</div>`;
  if (mode === 'month') return drawMonth(body, project, params, modes);
  return drawPhases(body, project, params, modes);
}

// ---------- Theo sprint (giai đoạn) ----------
async function drawPhases(body, project, params, modes) {
  const asked = params.get('s');
  const d = await api(`/api/projects/${project.id}/mtl-sprints${asked != null && asked !== '' ? `?s=${encodeURIComponent(asked)}` : ''}`);
  if (!d.sprints.length) {
    body.innerHTML = `<div class="mtl sp">${modes}<div class="card empty" data-testid="mtl-empty"><p>${d.project.t0Date ? 'Chưa có Master Timeline.' : 'Chưa đặt tháng T0.'}</p>${project.rights.canManage ? (d.project.t0Date ? '<button class="btn btn-primary" data-mtl="import">Nhập MTL từ Excel</button>' : '<button class="btn btn-primary" data-mtl="settings">Đặt T0</button>') : ''}</div></div>`;
    bindSetup(body, project, d);
    return;
  }
  const k = d.selected, sp = d.sprints[k], T = Math.max(1, d.project.totalT), cur = d.project.currentT;
  // Trục tháng T cho lộ trình: vị trí theo ngày (tháng + phần ngày trong tháng).
  const t0 = new Date(d.project.t0Date);
  const dayT = v => { const a = new Date(new Date(v).getTime() + 7 * 3_600_000), b = new Date(t0.getTime() + 7 * 3_600_000); return (a.getUTCFullYear() - b.getUTCFullYear()) * 12 + a.getUTCMonth() - b.getUTCMonth() + (a.getUTCDate() - 1) / 30.5; };
  const x = tf => Math.max(0, Math.min(100, tf / (T + 1) * 100));
  const now = dayT(new Date());
  const step = T > 40 ? 6 : T > 20 ? 3 : 1;
  const axis = Array.from({ length: Math.floor(T / step) + 1 }, (_, n) => n * step).map(t => `<span style="left:${x(t)}%">T${t}</span>`).join('');
  const road = d.sprints.map(s => {
    const has = s.start && s.end, l = has ? x(dayT(s.start)) : 0, r = has ? x(dayT(s.end)) : 0, w = Math.max(0.8, r - l);
    const tone = isDone(s.status) ? 'ok' : TONE[s.status] || '';
    return `<a class="rd-row${s.index === k ? ' sel' : ''}" href="${hrefWith({ s: s.index })}" data-testid="sp-road-${s.index}">
      <span class="rd-name"><b>${s.index + 1}. ${esc(s.name)}</b><span class="muted xs">${esc(s.stepsLabel || '')}${has ? ` · T${s.startT}–T${s.endT}` : ''}</span></span>
      <span class="rd-track">${has ? `<i class="rd-bar ${tone}" style="left:${l}%;width:${w}%"><i class="rd-fill" style="width:${Math.min(100, s.actualPct || 0)}%"></i>${s.plannedPct != null && !isDone(s.status) ? `<b class="rd-goal" style="left:${Math.min(100, s.plannedPct)}%"></b>` : ''}</i>` : ''}
        ${s.milestones.map(m => `<span class="rd-ms${m.done ? ' done' : ''}" style="left:${x(dayT(m.baselineEnd))}%" title="${esc(`◆ ${m.planCode ? 'Bước ' + m.planCode + ' · ' : ''}${m.title}`)}">◆</span>`).join('')}
        ${now >= 0 && now <= T + 1 ? `<span class="rd-today" style="left:${x(now)}%"></span>` : ''}</span>
      <span class="rd-num"><b>${pct(s.actualPct)}</b><span class="muted xs">KH ${pct(s.plannedPct)}</span><span class="pill ${tone}">${esc(s.statusLabel || '')}</span></span></a>`;
  }).join('');
  // Lọc ban (nhớ theo người dùng).
  const prefKey = `proj:${project.id}:sprintDept`;
  const deptCounts = new Map();
  for (const r of d.rows) if (r.leadDepartmentId) deptCounts.set(r.leadDepartmentId, { name: r.leadDepartmentName, n: (deptCounts.get(r.leadDepartmentId)?.n || 0) + 1 });
  let dept = params.get('dept') ?? uiPref(prefKey) ?? '';
  if (dept && !deptCounts.has(Number(dept))) dept = '';
  // Bước tổng + việc con: lọc ban giữ bước khi bước hoặc một việc con thuộc ban đó.
  const groups = [];
  for (const r of d.rows) { if (r.depth === 0) groups.push({ top: r, kids: [] }); else groups[groups.length - 1]?.kids.push(r); }
  const passG = g => !dept || String(g.top.leadDepartmentId) === String(dept) || g.kids.some(c => String(c.leadDepartmentId) === String(dept));
  const href = i => itemHref(i.id);
  const card = (i, extra = {}) => sprintCard(i, { goal: 'today', href, canEdit: d.canEdit, showDept: true, compactDone: true, ...extra });
  const stepCard = g => {
    const i = g.top;
    if (!i.children) return `<div class="sp-step leaf">${card(i)}</div>`;
    const tone = i.done ? 'ok' : TONE[i.status] || '';
    const doneKids = g.kids.filter(c => c.done).length;
    return `<div class="sp-step" data-testid="sp-step-${esc(i.planCode || i.code)}">
      <div class="sc sc-parent ${tone ? 'sc-' + tone : ''}">
        <div class="sc-top"><a class="code" href="${href(i)}">${esc(i.code)}</a><span class="muted xs">Bước ${esc(i.planCode || '')}</span>${i.critical ? '<span class="crit" title="Đường găng">●</span>' : ''}${i.milestone ? '<span class="ms" title="Mốc">◆</span>' : ''}<span class="grow"></span><span class="pill ${tone}">${esc(i.done ? 'Đã xong' : i.statusLabel || '')}</span></div>
        <a class="sc-title" href="${href(i)}">${esc(i.title)}</a>
        <div class="sc-meta muted xs"><span>${esc(i.leadDepartmentName)}</span><span>T${num(i.startT, 0)}–T${num(i.endT, 0)} · ${fmtDate(i.baselineStart)} – ${fmtDate(i.baselineEnd)}</span></div>
        <div class="sc-prog"><div class="sc-track"><i class="sc-fill ${tone || 'ok'}" style="width:${Math.min(100, i.actual || 0)}%"></i><b class="sc-goal" style="left:${Math.min(100, i.planned || 0)}%"></b></div>
          <span class="sc-nums"><b>${pct(i.actual)}</b><span class="muted"> / KH ${pct(i.planned)}</span></span></div>
        <div class="muted xs" data-testid="sp-kids-${esc(i.planCode || i.code)}"><b>${doneKids}/${g.kids.length}</b> việc con đã xong — mỗi việc con ${num(100 / Math.max(1, g.kids.length), 1)}% của bước (tự tính, không cần khai %)</div>
      </div>
      <div class="sp-kids">${g.kids.filter(c => !dept || String(c.leadDepartmentId) === String(dept) || String(i.leadDepartmentId) === String(dept)).map(c => card(c)).join('')}</div>
    </div>`;
  };
  const tone = isDone(sp.status) ? 'ok' : TONE[sp.status] || '';
  const when = isDone(sp.status) ? 'Đã hoàn thành' : sp.status === 'OVERDUE' ? `Trễ ${sp.lateDays} ngày so với kế hoạch` : sp.status === 'NOT_DUE' ? `Bắt đầu sau ${sp.startsIn} ngày` : sp.daysLeft != null ? `Còn ${sp.daysLeft} ngày` : '';
  const ms = sp.milestones.map(m => `<a href="${itemHref(m.id)}" class="sp-ms-i">◆ ${esc(m.planCode ? `Bước ${m.planCode} · ` : '')}${esc(m.title)} <span class="pill ${m.done ? 'ok' : ['OVERDUE', 'BEHIND', 'LATE_START'].includes(m.status) ? 'danger' : ''}">${m.done ? 'Đã xong' : esc(m.statusLabel || '')}</span></a>`).join('');
  const deptRows = d.byDepartment.map(r => `<tr class="${dept && String(r.id) === String(dept) ? 'sel' : ''}"><td><b>${esc(r.name)}</b></td><td class="num">${r.items}</td><td class="num">${r.done}</td>
    <td class="num">${pct(r.plannedPct)}</td><td class="num"><b>${pct(r.actualPct)}</b></td><td class="num"><span class="pill ${spiTone(r.spi)}">${num(r.spi)}</span></td>
    <td class="num${r.behind ? ' warn-t' : ''}">${r.behind}</td><td class="num${r.overdue ? ' danger-t' : ''}">${r.overdue}</td></tr>`).join('');
  const shown = groups.filter(passG);
  body.innerHTML = `<div class="mtl sp" data-testid="sprint-view">
    ${modes}
    ${!d.configured ? `<div class="card sp-note" data-testid="sp-suggested">${icon('bell')}<span>Đây là <b>sprint gợi ý</b> (cắt theo mốc ◆ trên đường găng). ${project.rights.canManage ? 'Bấm <b>Thiết lập sprint</b> để đặt tên và gộp bước, ví dụ <code>Chuyển nhượng DA | 1-9</code>.' : 'PMO sẽ đặt tên và gộp bước cho đúng các giai đoạn của dự án.'}</span></div>` : ''}
    ${d.unassigned.length && d.configured ? `<div class="card sp-note warn">Bước chưa thuộc sprint nào: ${d.unassigned.map(esc).join(', ')}</div>` : ''}
    <section class="card sp-road" data-testid="sp-road"><div class="mtl-h"><h3>Lộ trình ${d.sprints.length} sprint</h3><span class="muted xs">thanh = thời gian kế hoạch · phần tô = % thực tế (theo đầu việc) · vạch = % kế hoạch hôm nay · ◆ mốc · đỏ dọc = hôm nay</span></div>
      <div class="rd"><div class="rd-row rd-head"><span class="rd-name"></span><span class="rd-track rd-axis">${axis}</span><span class="rd-num"></span></div>${road}</div></section>
    <section class="card sp-head">
      <div class="sp-nav">
        ${k > 0 ? `<a class="btn btn-ghost btn-sm" href="${hrefWith({ s: k - 1 })}" aria-label="Sprint trước" data-testid="sp-prev">${icon('left')}</a>` : '<span class="sp-navgap"></span>'}
        <div class="sp-title"><h2 data-testid="sp-title">Sprint ${k + 1} · ${esc(sp.name)}</h2>
          <span class="muted sm">${esc(sp.stepsLabel || '')}${sp.start ? ` · ${fmtDate(sp.start)} – ${fmtDate(sp.end)} (T${sp.startT}–T${sp.endT})` : ''}${when ? ` · ${when}` : ''}${k === d.current ? ' · <b>đang làm</b>' : ''}</span></div>
        ${k < d.sprints.length - 1 ? `<a class="btn btn-ghost btn-sm" href="${hrefWith({ s: k + 1 })}" aria-label="Sprint sau" data-testid="sp-next">${icon('right')}</a>` : '<span class="sp-navgap"></span>'}
        ${k !== d.current && d.current != null ? `<a class="btn btn-sm" href="${hrefWith({}, ['s'])}" data-testid="sp-now">Về sprint đang làm</a>` : ''}
      </div>
      ${sp.goal ? `<p class="sp-goal"><b>Mục tiêu:</b> ${esc(sp.goal)}</p>` : ''}
      <div class="sp-kpis">
        <div class="${tone}"><span class="muted xs">Tiến độ sprint</span><b data-testid="sp-actual">${pct(sp.actualPct)}</b><small class="muted">kế hoạch hôm nay ${pct(sp.plannedPct)} · ${esc(sp.statusLabel || '')}</small></div>
        <div class="${spiTone(sp.spi)}"><span class="muted xs">SPI</span><b>${num(sp.spi)}</b><small class="muted">thực tế / kế hoạch</small></div>
        <div><span class="muted xs">Bước đã xong</span><b data-testid="sp-steps">${sp.stepsDone ?? 0}/${sp.steps ?? 0}</b><small class="muted">${sp.done ?? 0}/${sp.leaves ?? 0} đầu việc</small></div>
        <div class="${sp.overdue ? 'danger' : sp.behind ? 'warn' : ''}"><span class="muted xs">Chậm / trễ</span><b>${sp.behind ?? 0} / ${sp.overdue ?? 0}</b><small class="muted">${sp.criticalLate ? `${sp.criticalLate} trên đường găng` : 'đầu việc'}</small></div>
      </div>
      ${ms ? `<div class="sp-ms" data-testid="sp-milestones"><b>Mốc của sprint:</b> ${ms}</div>` : ''}
    </section>
    <div class="chips sp-depts" role="group" aria-label="Lọc theo ban" data-testid="sp-depts">
      <button type="button" class="chip${!dept ? ' on' : ''}" data-dept="" aria-pressed="${!dept}">Tất cả ban<b>${d.rows.length}</b></button>
      ${[...deptCounts].sort((a, b) => a[1].name.localeCompare(b[1].name, 'vi')).map(([id, v]) => `<button type="button" class="chip${String(id) === String(dept) ? ' on' : ''}" data-dept="${id}" aria-pressed="${String(id) === String(dept)}" data-testid="sp-dept-${id}">${esc(v.name)}<b>${v.n}</b></button>`).join('')}
    </div>
    <section class="sp-steps" data-testid="sp-steps-list"><div class="sp-lh"><h3>Các bước của sprint</h3><span class="pill">${shown.length}</span><span class="muted xs">bấm <b>✓ Xong</b> khi xong một việc · đang làm dở thì chọn %</span></div>
      ${shown.map(stepCard).join('') || '<p class="muted sm">Không có bước nào của ban này trong sprint.</p>'}</section>
    <section class="card"><div class="mtl-h"><h3>Sprint ${k + 1} theo ban</h3><span class="muted xs">tiến độ theo đầu việc của ban chủ trì</span></div>
      <div class="tbl-scroll"><table class="table" data-testid="sp-summary"><thead><tr><th>Ban</th><th class="num">Đầu việc</th><th class="num">Đã xong</th><th class="num">% KH</th><th class="num">% TT</th><th class="num">SPI</th><th class="num">Chậm</th><th class="num">Trễ</th></tr></thead>
      <tbody>${deptRows || '<tr><td colspan="8" class="muted">—</td></tr>'}</tbody></table></div></section>
  </div>`;
  bindDept(body, project, prefKey);
  bindSetup(body, project, d);
}

// ---------- Thiết lập sprint (PMO) ----------
function bindSetup(body, project, d) {
  const btn = $('[data-sp-setup]', body);
  if (!btn) return;
  btn.onclick = async () => {
    if (!d) { try { d = await api(`/api/projects/${project.id}/mtl-sprints`); } catch (error) { toast(errorMessage(error), 'err'); return; } }
    const modal = openModal(`<h2>Thiết lập sprint — ${esc(project.name)}</h2><form>
      <p class="muted sm">Mỗi dòng một sprint, theo thứ tự: <b>Tên sprint | các bước | mục tiêu (không bắt buộc)</b>. Các bước ghi khoảng hoặc danh sách: <code>1-9</code>, <code>10-12</code>, <code>II.1-II.8</code>, <code>13, 14, 16</code>. Cũng có thể ghi <code>Chuyển nhượng DA (B1–9)</code>.
        Việc con của MTL bộ phận tự thuộc sprint của bước tổng. Để trống rồi lưu = dùng sprint gợi ý theo mốc.</p>
      <textarea name="text" rows="10" class="sp-text" spellcheck="false" data-testid="sp-setup-text" placeholder="Chuyển nhượng DA | 1-9 | SPV kế thừa CĐT, có QSDĐ&#10;Đề xuất NƠXH → CTĐT | 10-12 | Có QĐ chấp thuận CTĐT + giao CĐT&#10;Phân kỳ 2 | II.1-II.8">${esc(d.configured ? d.text : '')}</textarea>
      ${!d.configured && d.text ? `<p class="muted xs">Gợi ý hiện tại (theo mốc ◆ đường găng) — <button type="button" class="link-btn" data-fill>chép vào ô để sửa</button></p>` : ''}
      <p class="error" id="spErr"></p>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="sp-setup-save">Lưu</button></div></form>`, { wide: true });
    const form = modal.querySelector('form');
    modal.querySelector('[data-close]').onclick = () => closeModal();
    const fill = modal.querySelector('[data-fill]'); if (fill) fill.onclick = () => { form.text.value = d.text; form.text.focus(); };
    form.onsubmit = async e => {
      e.preventDefault();
      try {
        const r = await api(`/api/projects/${project.id}/mtl-sprints`, { method: 'PUT', body: { text: form.text.value } });
        closeModal(); toast(r.sprints ? `Đã lưu ${r.sprints} sprint${r.unassigned.length ? ` — còn ${r.unassigned.length} bước chưa xếp` : ''}` : 'Đã bỏ thiết lập — dùng sprint gợi ý', 'ok');
        invalidateMtl(); replaceHashParams({ s: null }); await drawMtlSprint(body, project, paramsNow());
      } catch (error) { $('#spErr', modal).textContent = errorMessage(error); }
    };
  };
}
function bindDept(body, project, prefKey) {
  body.onclick = e => {
    const c = e.target.closest('[data-dept]');
    if (c) { const v = c.dataset.dept; uiPref(prefKey, v || null); replaceHashParams({ dept: v || null }); drawMtlSprint(body, project, paramsNow()); }
  };
}

// ---------- Theo tháng ----------
async function drawMonth(body, project, params, modes) {
  const asked = params.get('t');
  const d = await api(`/api/projects/${project.id}/mtl-month${asked != null && asked !== '' ? `?t=${encodeURIComponent(asked)}` : ''}`);
  if (d.empty || !d.sprint) {
    body.innerHTML = `<div class="mtl sp">${modes}<div class="card empty" data-testid="mtl-empty"><p>Chưa đặt tháng T0.</p>${project.rights.canManage ? '<button class="btn btn-primary" data-mtl="settings">Đặt T0</button>' : ''}</div></div>`;
    bindSetup(body, project, null);
    return;
  }
  const s = d.sprint, t = s.t, cur = d.project.currentT;
  const all = [...d.lanes.due, ...d.lanes.running, ...d.lanes.next];
  const prefKey = `proj:${project.id}:sprintDept`;
  const deptCounts = new Map();
  for (const i of all) if (i.leadDepartmentId) deptCounts.set(i.leadDepartmentId, { name: i.leadDepartmentName, n: (deptCounts.get(i.leadDepartmentId)?.n || 0) + 1 });
  let dept = params.get('dept') ?? uiPref(prefKey) ?? '';
  if (dept && !deptCounts.has(Number(dept))) dept = '';
  const pass = i => !dept || String(i.leadDepartmentId) === String(dept);
  const lanes = { due: d.lanes.due.filter(pass), running: d.lanes.running.filter(pass), next: d.lanes.next.filter(pass) };
  const href = i => itemHref(i.id);
  const cards = (list, empty) => list.length ? list.map(i => sprintCard(i, { t, href, canEdit: d.canEdit && s.state !== 'FUTURE', showDept: !dept, showSprint: true })).join('') : `<p class="muted sm sp-empty">${empty}</p>`;
  const monthHref = n => hrefWith({ mode: 'month', t: n === cur ? null : n }, ['s']);
  const cell = c => {
    const past = cur != null && c.t < cur, isCur = c.t === cur;
    const tone = !c.due ? '' : past ? (c.open ? 'danger' : c.doneInTime === c.due ? 'ok' : 'warn') : isCur ? (c.open ? 'cur' : 'ok') : '';
    const tip = `T${c.t}${c.due ? ` · ${c.due} hạng mục phải xong${past || isCur ? `, đã xong đúng hạn ${c.doneInTime}${c.open ? `, chưa xong ${c.open}` : ''}` : ''}` : ' · không có hạng mục phải xong'}${c.milestone ? ' · có mốc ◆' : ''}`;
    return `<a href="${monthHref(c.t)}" class="sp-cell ${tone}${c.t === t ? ' sel' : ''}${isCur ? ' now' : ''}" title="${esc(tip)}" aria-label="${esc(tip)}" data-testid="sp-cell-${c.t}"><span>${c.t}</span>${c.milestone ? '<i>◆</i>' : ''}</a>`;
  };
  const deptRows = d.byDepartment.map(r => `<tr class="${dept && String(r.id) === String(dept) ? 'sel' : ''}"><td><b>${esc(r.name)}</b></td><td class="num">${r.due}</td><td class="num ok-t">${r.done}</td>
    <td class="num${r.open && s.state === 'PAST' ? ' danger-t' : ''}">${r.open}</td><td class="num${r.carried ? ' danger-t' : ''}">${r.carried || 0}</td><td class="num">${r.running}</td>
    <td class="num${r.behind ? ' warn-t' : ''}">${r.behind ?? '—'}</td><td class="num"><span class="pill ${spiTone(r.spi)}">${num(r.spi)}</span></td></tr>`).join('');
  const ms = d.milestones.length ? `<div class="sp-ms" data-testid="sp-milestones"><b>◆ Mốc trong tháng:</b> ${d.milestones.map(m => `<a href="${itemHref(m.id)}">${esc(m.planCode ? `Bước ${m.planCode} · ` : '')}${esc(m.title)}</a> <span class="pill ${m.done ? 'ok' : ['OVERDUE', 'BEHIND', 'LATE_START'].includes(m.status) ? 'danger' : ''}">${m.done ? 'Đã xong' : esc(m.statusLabel)}</span>`).join(' · ')}</div>` : '';
  const doneDue = s.due ? Math.round(s.done / s.due * 100) : null;
  const STATE = { CURRENT: 'Tháng hiện tại', PAST: 'Tháng đã qua', FUTURE: 'Tháng sắp tới' };
  body.innerHTML = `<div class="mtl sp" data-testid="month-view">
    ${modes}
    <section class="card sp-head">
      <div class="sp-nav">
        ${t > 0 ? `<a class="btn btn-ghost btn-sm" href="${monthHref(t - 1)}" aria-label="Tháng trước" data-testid="mo-prev">${icon('left')}</a>` : '<span class="sp-navgap"></span>'}
        <div class="sp-title"><h2 data-testid="mo-title">Tháng T${t}</h2><span class="muted sm">${fmtDate(s.start)} – ${fmtDate(s.end)} · ${STATE[s.state]}${s.state === 'CURRENT' ? ` · còn ${s.daysLeft} ngày` : ''}</span></div>
        ${t < d.project.totalT ? `<a class="btn btn-ghost btn-sm" href="${monthHref(t + 1)}" aria-label="Tháng sau" data-testid="mo-next">${icon('right')}</a>` : '<span class="sp-navgap"></span>'}
        ${t !== cur && cur != null && cur >= 0 ? `<a class="btn btn-sm" href="${monthHref(cur)}" data-testid="mo-now">Về tháng hiện tại (T${cur})</a>` : ''}
      </div>
      <div class="sp-kpis">
        <div><span class="muted xs">Phải xong trong tháng</span><b data-testid="mo-due">${s.done}/${s.due}</b><small class="muted">${doneDue == null ? 'không có' : `đã xong ${doneDue}%`}</small></div>
        <div class="${s.carried ? 'danger' : ''}"><span class="muted xs">Trễ từ tháng trước</span><b>${s.carried}</b><small class="muted">chưa xong</small></div>
        <div><span class="muted xs">Đang chạy</span><b>${s.running}</b><small class="muted">kết thúc ở tháng sau</small></div>
        <div class="${spiTone(s.spi)}"><span class="muted xs">SPI ${s.state === 'PAST' ? 'cuối tháng' : 'hôm nay'}</span><b>${num(s.spi)}</b><small class="muted">${s.state === 'FUTURE' ? 'chưa tới tháng' : 'thực tế / kế hoạch'}</small></div>
      </div>
      <div class="sp-strip" role="navigation" aria-label="Chọn tháng" data-testid="sp-strip">${d.sprints.map(cell).join('')}</div>
      <div class="mtl-legend"><span><i class="lg-ok"></i>Xong đúng hạn</span><span><i class="lg-warn"></i>Có hạng mục xong trễ</span><span><i class="lg-danger"></i>Còn hạng mục chưa xong</span><span><i class="lg-cur"></i>Tháng hiện tại</span><span>◆ Có mốc</span></div>
    </section>
    <div class="chips sp-depts" role="group" aria-label="Lọc theo ban" data-testid="sp-depts">
      <button type="button" class="chip${!dept ? ' on' : ''}" data-dept="" aria-pressed="${!dept}">Tất cả ban<b>${all.length}</b></button>
      ${[...deptCounts].sort((a, b) => a[1].name.localeCompare(b[1].name, 'vi')).map(([id, v]) => `<button type="button" class="chip${String(id) === String(dept) ? ' on' : ''}" data-dept="${id}" aria-pressed="${String(id) === String(dept)}" data-testid="sp-dept-${id}">${esc(v.name)}<b>${v.n}</b></button>`).join('')}
    </div>
    ${ms}
    <div class="sp-lanes">
      <section class="sp-lane" data-testid="sp-lane-due"><div class="sp-lh"><h3>Phải xong trong tháng</h3><span class="pill">${lanes.due.length}</span></div><p class="muted xs">Kế hoạch gốc kết thúc trong T${t}${s.state === 'CURRENT' ? ', và việc trễ từ tháng trước' : ''}</p>${cards(lanes.due, 'Không có hạng mục phải xong.')}</section>
      <section class="sp-lane" data-testid="sp-lane-running"><div class="sp-lh"><h3>Đang chạy</h3><span class="pill">${lanes.running.length}</span></div><p class="muted xs">Kết thúc sau T${t} · vạch trên thanh = mục tiêu % cuối tháng</p>${cards(lanes.running, 'Không có hạng mục đang chạy.')}</section>
      <section class="sp-lane sp-lane-next" data-testid="sp-lane-next"><div class="sp-lh"><h3>Chuẩn bị cho T${t + 1}</h3><span class="pill">${lanes.next.length}</span></div><p class="muted xs">Bắt đầu ở tháng sau — chuẩn bị hồ sơ, nguồn lực</p>${cards(lanes.next, 'Tháng sau chưa có hạng mục bắt đầu.')}</section>
    </div>
    <section class="card"><div class="mtl-h"><h3>Tổng kết tháng T${t} theo ban</h3><span class="muted xs">${s.state === 'PAST' ? '"Đã xong" = xong trước khi hết tháng · SPI theo ảnh chụp tiến độ ngày cuối tháng' : s.state === 'CURRENT' ? 'tính đến hôm nay' : 'tháng chưa bắt đầu'}</span></div>
      <div class="tbl-scroll"><table class="table" data-testid="mo-summary"><thead><tr><th>Ban</th><th class="num">Phải xong</th><th class="num">Đã xong</th><th class="num">Chưa xong</th><th class="num">Trễ từ tháng trước</th><th class="num">Đang chạy</th><th class="num">Đang chạy chậm</th><th class="num">SPI</th></tr></thead>
      <tbody>${deptRows || '<tr><td colspan="8" class="muted">—</td></tr>'}</tbody></table></div></section>
  </div>`;
  bindDept(body, project, prefKey);
  bindSetup(body, project, null);
}
