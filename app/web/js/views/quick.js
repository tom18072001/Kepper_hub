// Kepper — "Cập nhật nhanh": việc của tôi đang trong kỳ thực hiện (tháng hiện tại hoặc trễ chưa xong) ở mọi dự án MTL, bấm "✓ Xong" hoặc %,
// không cần mở dự án. Lãnh đạo ban thấy thêm hạng mục của ban chưa giao người.
import { api } from '../api.js';
import { esc, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import { sprintCard, bindQuick } from './sprint-card.js';

export async function renderQuick(root, params, setCrumbs) {
  setCrumbs('Cập nhật nhanh');
  const d = await api('/api/my/sprint');
  const open = g => g.items.filter(i => !i.done), done = g => g.items.filter(i => i.done);
  const total = d.projects.reduce((n, g) => n + open(g).length, 0);
  const href = (g, i) => `#/projects/${g.project.id}?view=sprint&item=${i.id}`;
  const group = g => `<section class="card qk-proj" data-testid="qk-project-${esc(g.project.key)}">
    <div class="qk-ph"><a href="#/projects/${g.project.id}?view=sprint" class="hm-title"><b>${esc(g.project.name)}</b> <span class="code">${esc(g.project.key)}</span></a>
      <span class="muted sm">Tháng T${g.sprint.t} · ${fmtDate(g.sprint.start)} – ${fmtDate(g.sprint.end)} · còn ${g.sprint.daysLeft} ngày</span></div>
    <div class="qk-list">${open(g).map(i => sprintCard(i, { t: g.sprint.t, href: x => href(g, x), canEdit: g.canEdit, showSprint: true })).join('') || '<p class="muted sm">Đã xong hết việc của bạn trong tháng này.</p>'}</div>
    ${done(g).length ? `<details class="qk-done-list"><summary class="muted sm">Đã xong trong tháng (${done(g).length})</summary><div class="qk-list">${done(g).map(i => sprintCard(i, { t: g.sprint.t, href: x => href(g, x), showSprint: true })).join('')}</div></details>` : ''}
  </section>`;
  root.onclick = null; root.onchange = null;
  root.innerHTML = `<div class="page-head"><h1>Cập nhật nhanh</h1><span class="muted sm">${total ? `${total} việc của bạn${d.leader ? ' và của ban chưa giao người' : ''} đang trong kỳ thực hiện — xong việc nào bấm <b>✓ Xong</b> việc đó (đang làm dở thì chọn %); vạch trên thanh là mục tiêu cuối tháng` : 'Việc của bạn đang trong kỳ thực hiện'}</span></div>
    <div class="qk-page" data-testid="quick-page">${d.projects.length ? d.projects.map(group).join('')
      : `<div class="card empty" data-testid="quick-empty"><p>Bạn không có việc nào đang trong kỳ thực hiện.</p><p><a class="btn" href="#/home">${icon('dashboard')}Dashboard dự án</a></p></div>`}</div>`;
  bindQuick(root.querySelector('.qk-page'), () => renderQuick(root, params, setCrumbs));
}
