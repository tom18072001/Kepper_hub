// Trang chủ Kepper: Dashboard các dự án theo Master Timeline — tháng T hiện tại, kế hoạch / thực tế, SPI, KPI tiến độ,
// hạng mục cần chú ý (đường găng / mốc / của bộ phận mình đang chậm, trễ), mốc kế tiếp; phần "của tôi / bộ phận tôi".
import { api } from '../api.js';
import { store, can } from '../store.js';
import { esc, fmtDate } from '../util.js';
import { icon } from '../icons.js';

const num = (v, d = 1) => (v == null ? '—' : Number(v).toLocaleString('vi-VN', { maximumFractionDigits: d }));
const pct = v => (v == null ? '—' : `${num(v)}%`);
const spiTone = s => (s == null ? '' : s >= 0.95 ? 'ok' : s >= 0.8 ? 'warn' : 'danger');
const TONE = { OVERDUE: 'danger', BEHIND: 'warn', LATE_START: 'warn' };

export async function renderHome(root, params, setCrumbs) {
  setCrumbs('Dashboard');
  const d = await api('/api/mtl/portfolio');
  const card = p => {
    const s = p.summary, m = p.mine, link = `#/projects/${p.id}`;
    const bar = (v, cls) => `<span class="hm-bar ${cls}" style="width:${Math.max(0, Math.min(100, v || 0))}%"></span>`;
    return `<section class="card hm-card" data-testid="home-project-${esc(p.key)}">
      <div class="hm-head"><a href="${link}?view=mtl" class="hm-title"><b>${esc(p.name)}</b> <span class="code">${esc(p.key)}</span></a>
        ${p.currentT == null ? '<span class="muted sm">Chưa đặt T0</span>' : `<span class="muted sm">Tháng T${p.currentT}/${p.totalT}</span>`}</div>
      <div class="hm-prog" title="Kế hoạch ${pct(s.plannedPct)} · thực tế ${pct(s.actualPct)}"><div class="hm-track">${bar(s.plannedPct, 'plan')}${bar(s.actualPct, 'act')}</div>
        <span class="sm">KH <b>${pct(s.plannedPct)}</b> · TT <b>${pct(s.actualPct)}</b></span></div>
      <div class="hm-kpis">
        <a href="${link}?view=plan" class="hm-k ${spiTone(s.spi)}"><b>${s.spi == null ? '—' : num(s.spi, 2)}</b><span>SPI</span></a>
        <a href="${link}?view=mtl#mtlDepts" class="hm-k"><b>${s.score ?? '—'}</b><span>KPI tiến độ</span></a>
        <a href="${link}?view=plan&st=attn" class="hm-k${s.behind ? ' warn' : ''}"><b>${s.behind}</b><span>Chậm</span></a>
        <a href="${link}?view=plan&st=OVERDUE" class="hm-k${s.overdue ? ' danger' : ''}"><b>${s.overdue}</b><span>Trễ hạn</span></a>
        <a href="${link}?view=plan&st=critical" class="hm-k${s.criticalLate ? ' danger' : ''}"><b>${s.criticalLate}</b><span>Găng trễ</span></a>
      </div>
      ${p.currentSprint ? `<a class="hm-sprint" href="${link}?view=sprint&s=${p.currentSprint.index}" data-testid="home-sprint-${esc(p.key)}"><b>Sprint ${p.currentSprint.index + 1}/${p.currentSprint.count}:</b> ${esc(p.currentSprint.name)} <span class="muted">${esc(p.currentSprint.stepsLabel || '')} · ${p.currentSprint.stepsDone}/${p.currentSprint.steps} bước xong · TT ${pct(p.currentSprint.actualPct)} / KH ${pct(p.currentSprint.plannedPct)}</span> <span class="pill ${TONE[p.currentSprint.status] || ''}">${esc(p.currentSprint.statusLabel || '')}</span></a>` : ''}
      ${p.nextMilestone ? `<a class="hm-ms" href="${link}?view=mtl&item=${p.nextMilestone.id}">◆ <b>Mốc kế tiếp:</b> ${esc(p.nextMilestone.title)} · ${fmtDate(p.nextMilestone.baselineEnd)} <span class="pill ${TONE[p.nextMilestone.status] || ''}">${esc(p.nextMilestone.statusLabel)}</span></a>` : ''}
      ${m.items ? `<div class="hm-mine"><span class="muted sm">Của tôi / bộ phận tôi:</span> ${m.items} hạng mục · KH ${pct(m.plannedPct)} · TT ${pct(m.actualPct)}${m.behind ? ` · <b class="warn-t">${m.behind} chậm</b>` : ''}${m.overdue ? ` · <b class="danger-t">${m.overdue} trễ</b>` : ''}</div>` : ''}
      ${p.attention.length ? `<div class="hm-attn"><div class="muted xs">Cần chú ý</div>${p.attention.map(i => `<a href="${link}?view=plan&item=${i.id}" class="hm-row"><span class="code">${esc(i.code)}</span><span class="grow">${i.critical ? '<span class="crit" title="Đường găng">●</span> ' : ''}${esc(i.title)}${i.milestone ? ' ◆' : ''}</span><span class="pill ${TONE[i.status] || ''}">${esc(i.statusLabel)}${i.lateDays ? ` ${i.lateDays} ngày` : i.status === 'BEHIND' && i.variance != null ? ` ${num(i.variance)}` : ''}</span></a>`).join('')}</div>` : '<p class="muted sm">Không có hạng mục đường găng / mốc / của bạn đang chậm.</p>'}
    </section>`;
  };
  const canCreate = can('projects.manage', 'operate');
  root.onclick = null;
  root.innerHTML = `<div class="page-head"><h1>Dashboard dự án</h1><span class="muted sm">Theo Master Timeline · cập nhật ${fmtDate(d.generatedAt)} · cảnh báo tự động 07:30 hằng ngày</span>
      ${d.projects.length ? `<a class="btn btn-primary hm-quick" href="#/sprint" data-testid="home-quick">${icon('checklist')}Cập nhật nhanh việc của tôi</a>` : ''}</div>
    ${d.projects.length ? `<div class="hm-grid">${d.projects.map(card).join('')}</div>`
      : `<div class="card empty" data-testid="home-empty"><p>Chưa có dự án theo Master Timeline.</p>${canCreate ? `<p class="muted sm">Tạo dự án (nút + ở mục Dự án), chọn kiểu <b>Theo Master Timeline</b>, đặt tháng T0 rồi nhập bảng MTL từ Excel.</p>` : ''}<p><a class="btn" href="#/my">${icon('target')}Việc của tôi</a></p></div>`}`;
}
