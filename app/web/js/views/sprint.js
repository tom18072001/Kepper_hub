// Kepper — màn hình Sprint của dự án Master Timeline. Mỗi tháng T là một sprint (tự sinh từ T0).
// Ba làn: Phải xong trong sprint (gồm việc trễ chuyển từ sprint trước) · Đang chạy (mục tiêu % cuối sprint) · Chuẩn bị cho sprint sau.
// Lọc theo ban (nhớ theo người dùng), dải sprint để chuyển nhanh, tổng kết sprint theo ban. Cập nhật % một chạm ngay trên thẻ.
import { api } from '../api.js';
import { $, esc, fmtDate, uiPref, replaceHashParams } from '../util.js';
import { icon } from '../icons.js';
import { sprintCard, bindQuick } from './sprint-card.js';
import { invalidateMtl } from './mtl.js';

const num = (v, d = 2) => (v == null ? '—' : Number(v).toLocaleString('vi-VN', { maximumFractionDigits: d }));
const spiTone = s => (s == null ? '' : s >= 0.95 ? 'ok' : s >= 0.8 ? 'warn' : 'danger');
const itemHref = id => { const [path, q = ''] = location.hash.split('?'); const u = new URLSearchParams(q); u.set('item', id); return `${path}?${u}`; };
const STATE_LABEL = { CURRENT: 'Sprint hiện tại', PAST: 'Sprint đã qua', FUTURE: 'Sprint sắp tới' };

export async function drawMtlSprint(body, project, params) {
  const asked = params.get('t');
  const d = await api(`/api/projects/${project.id}/mtl-sprint${asked != null && asked !== '' ? `?t=${encodeURIComponent(asked)}` : ''}`);
  if (d.empty || !d.sprint) {
    body.innerHTML = `<div class="card empty" data-testid="mtl-empty"><p>Chưa đặt tháng T0 nên chưa chia được sprint.</p>${project.rights.canManage ? '<button class="btn btn-primary" data-mtl="settings">Đặt T0</button>' : ''}</div>`;
    return;
  }
  const s = d.sprint, t = s.t, cur = d.project.currentT;
  const all = [...d.lanes.due, ...d.lanes.running, ...d.lanes.next];
  if (!all.length && !d.sprints.some(x => x.due)) {
    body.innerHTML = `<div class="card empty" data-testid="mtl-empty"><p>Chưa có Master Timeline.</p>${project.rights.canManage ? '<button class="btn btn-primary" data-mtl="import">Nhập MTL từ Excel</button>' : ''}</div>`;
    return;
  }
  // Lọc ban: URL (?dept=) → lựa chọn lần trước của tôi trong dự án này → tất cả.
  const prefKey = `proj:${project.id}:sprintDept`;
  const deptCounts = new Map();
  for (const i of all) if (i.leadDepartmentId) deptCounts.set(i.leadDepartmentId, { name: i.leadDepartmentName, n: (deptCounts.get(i.leadDepartmentId)?.n || 0) + 1 });
  let dept = params.get('dept') ?? uiPref(prefKey) ?? '';
  if (dept && !deptCounts.has(Number(dept))) dept = '';
  const pass = i => !dept || String(i.leadDepartmentId) === String(dept);
  const lanes = { due: d.lanes.due.filter(pass), running: d.lanes.running.filter(pass), next: d.lanes.next.filter(pass) };
  const href = i => itemHref(i.id);
  const cards = (list, empty) => list.length ? list.map(i => sprintCard(i, { t, href, canEdit: d.canEdit && s.state !== 'FUTURE', showDept: !dept })).join('') : `<p class="muted sm sp-empty">${empty}</p>`;
  const sprintHref = k => { const [path, q = ''] = location.hash.split('?'); const u = new URLSearchParams(q); u.delete('item'); u.set('view', 'sprint'); if (k === cur) u.delete('t'); else u.set('t', k); return `${path}?${u}`; };
  // Dải sprint: mỗi ô một tháng T; màu theo kết quả "phải xong" (sprint đã qua), ◆ = có mốc.
  const cell = x => {
    const past = cur != null && x.t < cur, isCur = x.t === cur;
    const tone = !x.due ? '' : past ? (x.open ? 'danger' : x.doneInTime === x.due ? 'ok' : 'warn') : isCur ? (x.open ? 'cur' : 'ok') : '';
    const tip = `T${x.t}${x.due ? ` · ${x.due} hạng mục phải xong${past || isCur ? `, đã xong đúng hạn ${x.doneInTime}${x.open ? `, chưa xong ${x.open}` : ''}` : ''}` : ' · không có hạng mục phải xong'}${x.milestone ? ' · có mốc ◆' : ''}`;
    return `<a href="${sprintHref(x.t)}" class="sp-cell ${tone}${x.t === t ? ' sel' : ''}${isCur ? ' now' : ''}" title="${esc(tip)}" aria-label="${esc(tip)}" data-testid="sp-cell-${x.t}"><span>${x.t}</span>${x.milestone ? '<i>◆</i>' : ''}</a>`;
  };
  const deptRows = d.byDepartment.map(r => `<tr class="${dept && String(r.id) === String(dept) ? 'sel' : ''}"><td><b>${esc(r.name)}</b></td><td class="num">${r.due}</td><td class="num ok-t">${r.done}</td>
    <td class="num${r.open && s.state === 'PAST' ? ' danger-t' : ''}">${r.open}</td><td class="num${r.carried ? ' danger-t' : ''}">${r.carried || 0}</td><td class="num">${r.running}</td>
    <td class="num${r.behind ? ' warn-t' : ''}">${r.behind ?? '—'}</td><td class="num"><span class="pill ${spiTone(r.spi)}">${num(r.spi)}</span></td></tr>`).join('');
  const ms = d.milestones.length ? `<div class="sp-ms" data-testid="sp-milestones"><b>◆ Mốc trong sprint:</b> ${d.milestones.map(m => `<a href="${itemHref(m.id)}">${esc(m.planCode ? `Bước ${m.planCode} · ` : '')}${esc(m.title)}</a> <span class="pill ${m.done ? 'ok' : ['OVERDUE', 'BEHIND', 'LATE_START'].includes(m.status) ? 'danger' : ''}">${m.done ? 'Đã xong' : esc(m.statusLabel)}</span>`).join(' · ')}</div>` : '';
  const doneDue = s.due ? Math.round(s.done / s.due * 100) : null;
  body.innerHTML = `<div class="mtl sp" data-testid="sprint-view">
    <section class="card sp-head">
      <div class="sp-nav">
        ${t > 0 ? `<a class="btn btn-ghost btn-sm" href="${sprintHref(t - 1)}" aria-label="Sprint trước" data-testid="sp-prev">${icon('left')}</a>` : '<span class="sp-navgap"></span>'}
        <div class="sp-title"><h2 data-testid="sp-title">Sprint T${t}</h2><span class="muted sm">${fmtDate(s.start)} – ${fmtDate(s.end)} · ${STATE_LABEL[s.state]}${s.state === 'CURRENT' ? ` · còn ${s.daysLeft} ngày` : ''}</span></div>
        ${t < d.project.totalT ? `<a class="btn btn-ghost btn-sm" href="${sprintHref(t + 1)}" aria-label="Sprint sau" data-testid="sp-next">${icon('right')}</a>` : '<span class="sp-navgap"></span>'}
        ${t !== cur && cur != null && cur >= 0 ? `<a class="btn btn-sm" href="${sprintHref(cur)}" data-testid="sp-now">Về sprint hiện tại (T${cur})</a>` : ''}
      </div>
      <div class="sp-kpis">
        <div><span class="muted xs">Phải xong trong sprint</span><b data-testid="sp-due">${s.done}/${s.due}</b><small class="muted">${doneDue == null ? 'không có' : `đã xong ${doneDue}%`}</small></div>
        <div class="${s.carried ? 'danger' : ''}"><span class="muted xs">Trễ chuyển sang</span><b>${s.carried}</b><small class="muted">từ sprint trước, chưa xong</small></div>
        <div><span class="muted xs">Đang chạy</span><b>${s.running}</b><small class="muted">kết thúc ở sprint sau</small></div>
        <div class="${spiTone(s.spi)}"><span class="muted xs">SPI ${s.state === 'PAST' ? 'cuối sprint' : 'hôm nay'}</span><b>${num(s.spi)}</b><small class="muted">${s.state === 'FUTURE' ? 'chưa tới sprint' : 'thực tế / kế hoạch'}</small></div>
      </div>
      <div class="sp-strip" role="navigation" aria-label="Chọn sprint" data-testid="sp-strip">${d.sprints.map(cell).join('')}</div>
      <div class="mtl-legend"><span><i class="lg-ok"></i>Xong đúng hạn</span><span><i class="lg-warn"></i>Có hạng mục xong trễ</span><span><i class="lg-danger"></i>Còn hạng mục chưa xong</span><span><i class="lg-cur"></i>Sprint hiện tại</span><span>◆ Có mốc</span></div>
    </section>
    <div class="chips sp-depts" role="group" aria-label="Lọc theo ban" data-testid="sp-depts">
      <button type="button" class="chip${!dept ? ' on' : ''}" data-dept="" aria-pressed="${!dept}">Tất cả ban<b>${all.length}</b></button>
      ${[...deptCounts].sort((a, b) => a[1].name.localeCompare(b[1].name, 'vi')).map(([id, x]) => `<button type="button" class="chip${String(id) === String(dept) ? ' on' : ''}" data-dept="${id}" aria-pressed="${String(id) === String(dept)}" data-testid="sp-dept-${id}">${esc(x.name)}<b>${x.n}</b></button>`).join('')}
    </div>
    ${ms}
    <div class="sp-lanes">
      <section class="sp-lane" data-testid="sp-lane-due"><div class="sp-lh"><h3>Phải xong trong sprint</h3><span class="pill">${lanes.due.length}</span></div><p class="muted xs">Kế hoạch gốc kết thúc trong T${t}${s.state === 'CURRENT' ? ', và việc trễ từ sprint trước' : ''}</p>${cards(lanes.due, 'Không có hạng mục phải xong.')}</section>
      <section class="sp-lane" data-testid="sp-lane-running"><div class="sp-lh"><h3>Đang chạy</h3><span class="pill">${lanes.running.length}</span></div><p class="muted xs">Kết thúc sau T${t} · vạch trên thanh = mục tiêu % cuối sprint</p>${cards(lanes.running, 'Không có hạng mục đang chạy.')}</section>
      <section class="sp-lane sp-lane-next" data-testid="sp-lane-next"><div class="sp-lh"><h3>Chuẩn bị cho T${t + 1}</h3><span class="pill">${lanes.next.length}</span></div><p class="muted xs">Bắt đầu ở sprint sau — chuẩn bị hồ sơ, nguồn lực</p>${cards(lanes.next, 'Sprint sau chưa có hạng mục bắt đầu.')}</section>
    </div>
    <section class="card"><div class="mtl-h"><h3>Tổng kết sprint T${t} theo ban</h3><span class="muted xs">${s.state === 'PAST' ? '"Đã xong" = xong trước khi sprint kết thúc · SPI theo ảnh chụp tiến độ ngày cuối sprint' : s.state === 'CURRENT' ? 'tính đến hôm nay' : 'sprint chưa bắt đầu'}</span></div>
      <div class="tbl-scroll"><table class="table" data-testid="sp-summary"><thead><tr><th>Ban</th><th class="num">Phải xong</th><th class="num">Đã xong</th><th class="num">Chưa xong</th><th class="num">Trễ chuyển sang</th><th class="num">Đang chạy</th><th class="num">Đang chạy chậm</th><th class="num">SPI</th></tr></thead>
      <tbody>${deptRows || '<tr><td colspan="8" class="muted">—</td></tr>'}</tbody></table></div></section>
  </div>`;
  body.onclick = e => {
    const c = e.target.closest('[data-dept]');
    if (c) { const v = c.dataset.dept; uiPref(prefKey, v || null); replaceHashParams({ dept: v || null }); drawMtlSprint(body, project, new URLSearchParams(location.hash.split('?')[1] || '')); }
  };
  if (!body.dataset.quickBound) {
    body.dataset.quickBound = '1';
    bindQuick(body, async () => { invalidateMtl(); await drawMtlSprint(body, project, new URLSearchParams(location.hash.split('?')[1] || '')); });
  }
}
