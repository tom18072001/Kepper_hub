// Trang chủ — "hôm nay cần làm gì" (theo cách trang chủ của Base Work OS): một trang gom việc cần xử lý (phiếu trình, gia hạn,
// kiến nghị, việc của tôi quá hạn / sắp đến hạn — xếp theo hạn), dự án xếp theo mức lo, giao ban tuần này và thông báo mới.
// Chỉ đọc lại các API sẵn có theo đúng quyền người dùng; không có dữ liệu mới.
import { api } from '../api.js';
import { store } from '../store.js';
import { esc, fmtDate, ago } from '../util.js';
import { icon } from '../icons.js';

const DAY = 86_400_000, H7 = 7 * 3_600_000;
const vnDay = v => Math.floor((new Date(v).getTime() + H7) / DAY);
const daysLeft = v => vnDay(v) - vnDay(Date.now());
const num = (v, d = 1) => (v == null ? '—' : Number(v).toLocaleString('vi-VN', { maximumFractionDigits: d }));
const WEEKDAY = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const vnNow = () => new Date(Date.now() + H7);
const hhmm = v => { const d = new Date(new Date(v).getTime() + H7); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const dayLabel = v => { const d = new Date(new Date(v).getTime() + H7); return `${WEEKDAY[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

function greet() {
  const h = vnNow().getUTCHours();
  return h < 11 ? 'Chào buổi sáng' : h < 14 ? 'Chào buổi trưa' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
}
// Nhãn hạn: quá hạn / hôm nay / còn n ngày.
function duePill(due) {
  if (!due) return '<span class="pill">Chưa có hạn</span>';
  const n = daysLeft(due);
  if (n < 0) return `<span class="pill danger">Quá hạn ${-n} ngày</span>`;
  if (n === 0) return '<span class="pill warn">Hạn hôm nay</span>';
  if (n <= 2) return `<span class="pill warn">Còn ${n} ngày</span>`;
  return `<span class="pill">Còn ${n} ngày</span>`;
}
const KIND = {
  queue: { label: 'Duyệt', color: '#1E8A6E', icon: 'approve' },
  ext: { label: 'Gia hạn', color: '#B8641C', icon: 'clock' },
  prop: { label: 'Kiến nghị', color: '#B28A33', icon: 'comment' },
  item: { label: 'Việc', color: '#2E6DB4', icon: 'target' },
};
const RISK = p => [-(p.summary.criticalLate || 0), -(p.summary.overdue || 0), -(p.summary.behind || 0), p.summary.spi ?? 9];
const byRisk = (a, b) => { const x = RISK(a), y = RISK(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

export async function renderToday(root, params, setCrumbs, isCurrent = () => true) {
  setCrumbs('');
  const me = store.me;
  const [items, queue, exts, props, portfolio, ctx, notes] = await Promise.all([
    api('/api/my/items').catch(() => []),
    api('/api/approvals/queue').catch(() => []),
    api('/api/approvals/extensions').catch(() => []),
    api('/api/approvals/proposals').catch(() => []),
    api('/api/mtl/portfolio').catch(() => ({ projects: [] })),
    api('/api/weekly/context').catch(() => null),
    api('/api/notifications').catch(() => ({ items: [], unread: 0 })),
  ]);
  if (!isCurrent()) return;
  const [report, summary] = await Promise.all([
    ctx?.me?.mustReport ? api('/api/weekly/report').catch(() => null) : null,
    ctx?.me?.canSummary && !ctx?.me?.mustReport ? api('/api/weekly/summary').catch(() => null) : null,
  ]);

  // ---------- Cần xử lý: phiếu chờ duyệt, gia hạn, kiến nghị, việc của tôi quá hạn / trong 7 ngày ----------
  const todo = [
    ...queue.map(q => ({ kind: 'queue', due: q.item.dueDate, code: q.item.code, title: q.item.title, meta: `${q.stepName ? `Bước ${esc(q.stepName)} · ` : ''}${q.requestedByName ? 'trình bởi ' + esc(q.requestedByName) : ''}`,
      href: `#/approvals?tab=queue&item=${q.item.id}&focus=approval` })),
    ...exts.filter(e => e.canDecide).map(e => ({ kind: 'ext', due: e.item.dueDate, code: e.item.code, title: e.item.title, meta: `${esc(e.requestedByName || '')} xin lùi hạn đến ${fmtDate(e.newDue)}`,
      href: `#/approvals?tab=extensions&item=${e.item.id}&focus=extension` })),
    ...props.map(p => ({ kind: 'prop', due: null, wait: p.waitingDays, code: p.item.code, title: p.item.title, meta: `${esc(p.authorName || '')}: ${esc(String(p.proposals).slice(0, 90))}`,
      href: `#/approvals?tab=proposals&item=${p.item.id}&focus=proposal` })),
    ...items.filter(i => !['COMPLETED', 'CANCELLED'].includes(i.state?.category) && (i.internalDueDate || i.dueDate) && daysLeft(i.internalDueDate || i.dueDate) <= 7)
      .map(i => ({ kind: 'item', due: i.myRole === 'LEAD' && i.internalDueDate ? i.internalDueDate : i.dueDate, code: i.code, title: i.title,
        meta: `${esc(i.project?.name || '')}${i.progress != null ? ` · ${i.progress}%` : ''}`, href: `#/projects/${i.projectId}?item=${i.id}` })),
  ].sort((a, b) => (a.due ? vnDay(a.due) : 1e9) - (b.due ? vnDay(b.due) : 1e9));
  const row = t => { const k = KIND[t.kind]; return `<a class="td-row" href="${t.href}" data-testid="today-${t.kind}">
      <span class="tile" style="--g:${k.color}" title="${k.label}">${icon(k.icon)}</span>
      <span class="td-main"><span class="td-title"><span class="code">${esc(t.code)}</span> ${esc(t.title)}</span><span class="td-meta"><b>${k.label}</b> · ${t.meta}</span></span>
      <span class="td-due">${t.kind === 'prop' ? `<span class="pill${t.wait >= 3 ? ' warn' : ''}">Chờ ${t.wait} ngày</span>` : duePill(t.due)}</span></a>`; };
  const SHOW = 8;
  const todoBox = `<section class="card td-card" data-testid="today-todo">
    <div class="td-h"><h2>Việc cần xử lý</h2><span class="muted sm">${todo.length ? `${todo.length} việc · xếp theo hạn` : ''}</span></div>
    ${todo.length ? `<div class="td-list">${todo.slice(0, SHOW).map(row).join('')}</div>
      <div class="td-more">${todo.length > SHOW ? `<span class="muted sm">và ${todo.length - SHOW} việc khác</span>` : ''}<a href="#/my">Việc của tôi</a>${queue.length + exts.length + props.length ? '<a href="#/approvals">Chờ tôi duyệt</a>' : ''}</div>`
      : '<div class="td-empty">Không có việc quá hạn hay đến hạn trong 7 ngày, không có phiếu chờ duyệt.</div>'}
  </section>`;

  // ---------- Dự án xếp theo mức lo ----------
  const projs = [...(portfolio.projects || [])].sort(byRisk);
  const tone = p => (p.summary.criticalLate || p.summary.overdue ? 'danger' : p.summary.behind ? 'warn' : 'ok');
  const label = p => (p.summary.criticalLate ? `${p.summary.criticalLate} việc găng trễ` : p.summary.overdue ? `${p.summary.overdue} trễ hạn` : p.summary.behind ? `${p.summary.behind} chậm` : 'Đúng tiến độ');
  const prow = p => { const s = p.summary; const a = Math.max(0, Math.min(100, s.actualPct || 0)), pl = Math.max(0, Math.min(100, s.plannedPct || 0));
    return `<a class="td-proj" href="#/projects/${p.id}?view=mtl" data-testid="today-project-${esc(p.key)}">
      <span class="td-key">${esc(p.key)}</span>
      <span class="td-main"><span class="td-title">${esc(p.name)}</span>
        <span class="td-bar" title="Thực tế ${num(s.actualPct)}% · kế hoạch hôm nay ${num(s.plannedPct)}%"><i style="width:${a}%"></i><b style="left:${pl}%"></b></span>
        <span class="td-meta">Thực tế <b>${num(s.actualPct)}%</b> · kế hoạch ${num(s.plannedPct)}% · SPI ${s.spi == null ? '—' : num(s.spi, 2)}${p.currentSprint ? ` · ${esc(p.currentSprint.name)}` : ''}</span></span>
      <span class="td-due"><span class="pill ${tone(p)}">${label(p)}</span></span></a>`; };
  const projBox = projs.length ? `<section class="card td-card" data-testid="today-projects">
    <div class="td-h"><h2>Dự án</h2><span class="muted sm">${projs.length} dự án · xếp theo mức lo</span><a class="td-link" href="#/home">Dashboard</a></div>
    <div class="td-list">${projs.map(prow).join('')}</div></section>` : '';

  // ---------- Giao ban tuần này ----------
  let meetBox = '';
  if (ctx?.schedule) {
    const sc = ctx.schedule, left = Math.max(0, new Date(sc.meetingAt) - Date.now());
    const until = left > DAY ? `còn ${Math.floor(left / DAY)} ngày ${Math.floor((left % DAY) / 3_600_000)} giờ` : left > 0 ? `còn ${Math.floor(left / 3_600_000)} giờ ${Math.floor((left % 3_600_000) / 60_000)} phút` : 'đang / đã họp';
    let mine = '';
    if (report?.status) {
      const done = !!report.report?.firstSubmittedAt;
      mine = `<div class="td-wk"><span class="muted sm">Báo cáo ${esc(report.department?.name || 'bộ phận')}</span>
        <span class="pill ${report.status.tone === 'good' ? 'ok' : report.status.tone === 'bad' ? 'danger' : 'warn'}">${esc(report.status.label)}</span>
        ${done ? `<span class="muted xs">nộp ${hhmm(report.report.firstSubmittedAt)} ${dayLabel(report.report.firstSubmittedAt)}</span>` : `<span class="muted xs">hạn ${hhmm(sc.deadline)} ${dayLabel(sc.deadline)}</span>`}</div>`;
    } else if (summary?.rows) {
      const sent = summary.rows.filter(r => r.submittedAt).length;
      mine = `<div class="td-wk"><span class="muted sm">Bộ phận đã nộp</span><b class="td-big">${sent}/${summary.rows.length}</b></div>`;
    }
    meetBox = `<section class="card td-card td-meet" data-testid="today-meeting">
      <div class="td-h"><h2>Giao ban</h2></div>
      <div class="td-when"><b>${dayLabel(sc.meetingAt)} · ${hhmm(sc.meetingAt)}</b><span class="muted sm">${until}</span></div>
      ${mine}
      <a class="btn btn-primary btn-block" href="#/tuan" data-testid="today-weekly">${icon('calendar')}${ctx.me?.mustReport ? 'Mở báo cáo tuần' : 'Xem tổng hợp giao ban'}</a>
    </section>`;
  }

  // ---------- Thông báo mới ----------
  const notif = (notes.items || []).filter(n => !n.readAt).slice(0, 5);
  const notifBox = `<section class="card td-card" data-testid="today-notifications"><div class="td-h"><h2>Thông báo mới</h2>${notif.length ? `<span class="muted sm">${notes.unread} chưa đọc</span>` : ''}</div>
    ${notif.length ? `<div class="td-notes">${notif.map(n => `<a href="${esc(n.link || '#')}" class="td-note"><span>${esc(n.title)}</span><span class="muted xs">${ago(n.createdAt)}</span></a>`).join('')}</div>`
      : '<div class="td-empty">Không có thông báo mới.</div>'}</section>`;

  // Trang chủ gọi nhiều API: người dùng đã chuyển trang trong lúc chờ thì không vẽ đè lên trang mới.
  if (!isCurrent()) return;
  const now = vnNow();
  root.onclick = null;
  root.innerHTML = `<div class="td" data-testid="today">
    <div class="td-hello">
      <div><h1>${greet()}, ${esc(me.fullName)}</h1>
        <p class="muted">${WEEKDAY[now.getUTCDay()]}, ${String(now.getUTCDate()).padStart(2, '0')}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${now.getUTCFullYear()}${me.departmentName ? ' · ' + esc(me.departmentName) : ''}</p></div>
      <div class="td-actions"><a class="btn btn-ghost" href="#/sprint">${icon('checklist')}Cập nhật nhanh</a><a class="btn btn-ghost" href="#/tuan">${icon('calendar')}Báo cáo tuần</a></div>
    </div>
    <div class="td-grid">
      <div class="td-col">${todoBox}${projBox}</div>
      <div class="td-col td-side">${meetBox}${notifBox}</div>
    </div>
  </div>`;
}
