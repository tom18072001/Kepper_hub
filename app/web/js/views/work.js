// Tổng thể công việc: mọi việc trên tất cả dự án của một người (chủ trì / phối hợp / người giao) hoặc một phòng.
// Mở bằng cách bấm tên người / phòng ở bất kỳ đâu, hoặc chọn ở đầu trang. Phạm vi: BGĐ — mọi người; lãnh đạo phòng — phòng mình; cán bộ — chính mình.
import { api } from '../api.js';
import { store, workScope, personLink, deptLink } from '../store.js';
import { $, $$, esc, fmtDate, dueCountdown, uiPref, replaceHashParams, debounce } from '../util.js';
import { icon } from '../icons.js';
import { calendarHtml, calState, bindCalendar } from './calendar-view.js';

const STATUS = [['open', 'Đang mở'], ['overdue', 'Quá hạn'], ['soon', 'Sắp đến hạn'], ['done', 'Đã xong'], ['all', 'Tất cả']];
const ROLES = [['', 'Mọi vai trò'], ['LEAD', 'Chủ trì'], ['SUPPORT', 'Phối hợp'], ['ASSIGNER', 'Người giao']];
const ROLE_PILL = { LEAD: 'Chủ trì', SUPPORT: 'Phối hợp', ASSIGNER: 'Người giao' };
const SUBJECT_KEYS = ['user', 'dept', 'all', 'status', 'role', 'metric', 'from', 'to'];
const FILTER_ICON = '<svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/></svg>';

export async function renderWork(root, params, setCrumbs) {
  setCrumbs('Tổng thể công việc');
  if (!workScope()) { root.innerHTML = '<div class="card empty">Tài khoản quản trị hệ thống không có số liệu công việc.</div>'; return; }
  const q = new URLSearchParams();
  for (const k of SUBJECT_KEYS) if (params.get(k)) q.set(k, params.get(k));
  const d = await api('/api/work?' + q);
  const isUser = d.subject.type === 'user';
  const self = isUser && d.subject.id === store.me.id;
  const items = d.items;
  const projects = [...new Map(items.map(i => [i.project.id, i.project])).values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const f = {
    q: params.get('q') || '',
    project: projects.some(p => String(p.id) === params.get('project')) ? params.get('project') : '',
    stage: params.get('stage') || '', type: ['PLAN', 'ADHOC'].includes(params.get('type')) ? params.get('type') : '',
    view: params.get('view') === 'cal' || (params.get('view') == null && uiPref('work:view') === 'cal') ? 'cal' : 'list',
  };

  // Liên kết giữ đối tượng + bộ lọc hiện tại, thay một vài tham số.
  const hrefWith = extra => {
    const u = new URLSearchParams();
    for (const k of SUBJECT_KEYS) if (params.get(k)) u.set(k, params.get(k));
    for (const k of ['project', 'stage', 'type', 'q']) if (f[k]) u.set(k, f[k]);
    if (f.view === 'cal') u.set('view', 'cal');
    for (const [k, v] of Object.entries(extra)) { if (v) u.set(k, v); else u.delete(k); }
    return '#/work?' + u;
  };

  // "Thêm bộ lọc" (giống trang dự án): Phòng, Người, Vai trò, Trạng thái hạn, Dự án, Khâu, Loại nhiệm vụ trong một ô bật ra;
  // bộ lọc đang áp hiện thành chip bấm để bỏ. Đổi Phòng / Người / Vai trò / Trạng thái thì tải lại từ máy chủ (giữ ô bật ra mở).
  const curDept = d.subject.type === 'dept' ? d.subject.id : d.subject.type === 'user' ? d.subject.departmentId : null;
  const deptNameOf = id => d.subjects.departments.find(x => x.id === id)?.name || store.departments.find(x => x.id === id)?.name || 'Chưa thuộc phòng';
  const crew = curDept != null ? d.subjects.users.filter(u => u.departmentId === curDept) : d.subjects.users;
  const groups = new Map();
  for (const u of crew) { const k = u.departmentId ?? 0; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(u); }
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  const stages = [...new Map(items.filter(i => i.stage?.code).map(i => [i.stage.code, i.stage.label])).entries()];
  const field = (key, label, html, show = true) => (show ? `<label class="field fx-field">${label}<select data-wf="${key}" data-testid="work-f-${key}"${html.set ? ' class="set"' : ''}>${html.opts}</select></label>` : '');
  const ownDeptOnly = !d.subjects.all;
  const F = {
    dept: { label: 'Phòng', show: d.subjects.all || d.subjects.departments.length > 1, set: d.subject.type !== 'all' && !ownDeptOnly,
      opts: (d.subjects.all ? opt('', 'Toàn Trung tâm', d.subject.type === 'all') : '') + d.subjects.departments.map(x => opt(x.id, x.name, curDept === x.id)).join('') },
    user: { label: 'Người', show: d.subjects.users.length > 1, set: isUser && !(self && d.scope === 'SELF'),
      opts: opt('', curDept != null ? 'Cả phòng' : 'Tất cả', !isUser) + [...groups.entries()].map(([k, list]) => (groups.size > 1 ? `<optgroup label="${esc(deptNameOf(k))}">` : '') + list.map(u => opt(u.id, u.fullName + (u.displayTitle ? ` — ${u.displayTitle}` : ''), isUser && d.subject.id === u.id)).join('') + (groups.size > 1 ? '</optgroup>' : '')).join('') },
    role: { label: 'Vai trò', show: !!d.roleCounts, set: !!d.role, opts: ROLES.map(([k, t]) => opt(k, `${t} (${d.roleCounts?.[k || 'ALL'] ?? 0})`, d.role === k)).join('') },
    status: { label: 'Trạng thái', show: !d.metric, set: d.status !== 'open', opts: STATUS.map(([k, t]) => opt(k, `${t} (${d.counts[k]})`, d.status === k)).join('') },
    project: { label: 'Dự án', show: projects.length > 1 || !!f.project, set: !!f.project, opts: opt('', 'Tất cả', !f.project) + projects.map(p => opt(p.id, p.name, String(p.id) === f.project)).join('') },
    stage: { label: 'Khâu', show: stages.length > 1 || !!f.stage, set: !!f.stage, opts: opt('', 'Tất cả', !f.stage) + stages.map(([c, l]) => opt(c, l, f.stage === c)).join('') },
    type: { label: 'Loại nhiệm vụ', show: items.some(i => i.taskType), set: !!f.type, opts: opt('', 'Tất cả', !f.type) + [['PLAN', 'Kế hoạch năm'], ['ADHOC', 'Đột xuất']].map(([k, t]) => opt(k, t, f.type === k)).join('') },
  };
  const ORDER_F = ['dept', 'user', 'role', 'status', 'project', 'stage', 'type'];
  const nSet = ORDER_F.filter(k => F[k].show && F[k].set).length;
  const moreHtml = `<div class="fx-grid">${ORDER_F.map(k => field(k, F[k].label, F[k], F[k].show)).join('')}</div>
    <div class="fx-pop-foot">${nSet ? '<button type="button" class="fx-link" data-wf-clear="all">Bỏ các bộ lọc này</button>' : ''}<span class="grow"></span><button type="button" class="btn btn-ghost btn-sm" data-pop-close>Xong</button></div>`;
  const selLabel = k => { const m = F[k].opts.match(/<option value="[^"]*" selected>([^<]*)<\/option>/); return m ? m[1].replace(/ \(\d+\)$/, '') : ''; };
  const applied = ORDER_F.filter(k => F[k].show && F[k].set).map(k => `<button type="button" class="fx-chip" data-wf-clear="${k}" aria-label="Bỏ lọc ${esc(F[k].label)}" data-testid="work-chip-${k}"><span>${esc(F[k].label)}:</span> <b>${selLabel(k)}</b>${icon('x')}</button>`).join('');
  const picker = '';

  const who = isUser
    ? `<h1>${esc(d.subject.name)}</h1><span class="muted sm">${[d.subject.title, d.subject.departmentId ? deptLink(d.subject.departmentId, d.subject.departmentName) : ''].filter(Boolean).join(' · ')}</span>`
    : `<h1>${esc(d.subject.name)}</h1>`;
  const metricBar = d.metric ? `<div class="wk-metric" data-testid="work-metric"><b>${esc(d.metric.label)}</b> <span class="muted sm">${fmtDate(d.metric.from)} – ${fmtDate(d.metric.to)} · việc ${self ? 'bạn' : 'người này'} chủ trì</span>
      <a class="btn btn-ghost btn-sm" href="${hrefWith({ metric: '', from: '', to: '' })}" data-testid="work-metric-clear">Xem mọi việc đang mở</a></div>` : '';

  root.oninput = null; root.onchange = null; root.onkeydown = null;
  root.innerHTML = `<div class="page-head wk-head"><div class="wk-who">${who}</div>${picker}</div>
    ${metricBar}
    <div class="fx wk-fx" role="search" aria-label="Lọc việc">
      <div class="wk-fx-main">
        <label class="search-field lf-search">${icon('search')}<input type="search" id="wkQ" value="${esc(f.q)}" placeholder="Tìm mã hoặc tên việc" aria-label="Tìm việc" autocomplete="off" data-testid="work-q"></label>
        <div class="fx-pop-wrap">
          <button type="button" class="btn btn-ghost btn-sm fx-btn${nSet ? ' on' : ''}" id="wkMoreBtn" aria-expanded="false" aria-controls="wkMore" data-testid="work-filter-more">${FILTER_ICON}<span>${nSet ? `Thêm bộ lọc · ${nSet}` : 'Thêm bộ lọc'}</span></button>
          <div class="fx-pop" id="wkMore" role="dialog" aria-label="Thêm bộ lọc" hidden>${moreHtml}</div>
        </div>
        <span class="lf-count" aria-live="polite"></span>
        <span class="grow"></span>
        <span class="seg" role="group" aria-label="Kiểu xem"><button type="button" data-wkview="list" aria-pressed="${f.view === 'list'}" class="${f.view === 'list' ? 'on' : ''}" data-testid="work-view-list">Danh sách</button><button type="button" data-wkview="cal" aria-pressed="${f.view === 'cal'}" class="${f.view === 'cal' ? 'on' : ''}" data-testid="work-view-cal">Lịch</button></span>
      </div>
      ${applied ? `<div class="fx-applied">${applied}<button type="button" class="fx-link" data-wf-clear="all" data-testid="work-filter-clear">Xoá lọc</button></div>` : ''}
    </div>
    <div id="wkBody"></div>
    ${d.truncated ? '<p class="muted xs">Chỉ hiện 500 việc đầu — thu hẹp bằng bộ lọc.</p>' : ''}`;

  const body = $('#wkBody', root);
  const itemHref = i => hrefWith({ item: String(i.id) });
  const people = list => list.map(u => personLink(u)).join(', ');
  const dueCell = i => {
    if (!i.dueDate) return '<span class="muted sm">Chưa có hạn</span>';
    if (i.state?.category === 'COMPLETED') return `<span class="mw-date">${fmtDate(i.dueDate)}</span><span class="mw-sub">${i.deadline === 'DONE_LATE' ? 'xong trễ' : 'xong'}${i.completedAt ? ' ' + fmtDate(i.completedAt) : ''}</span>`;
    const c = dueCountdown(i, d.dueSoonDays);
    return `<span class="mw-due ${c.tone}">${esc(c.text)}</span><span class="mw-date">${fmtDate(i.dueDate)}</span>`;
  };
  const row = i => `<tr class="clickable" tabindex="0" data-href="${itemHref(i)}" data-testid="work-${esc(i.code)}">
      <td class="code mw-c-code">${esc(i.code)}</td>
      <td class="mw-c-title"><span class="mw-title">${esc(i.title)}</span><span class="mw-tags">${(i.roles || []).map(r => `<span class="pill role">${ROLE_PILL[r]}</span>`).join('')}<span class="muted xs">${esc(i.project.name)}</span></span></td>
      <td class="wk-c-people">${people(i.assignees) || '<span class="muted sm">Chưa phân công</span>'}${i.supporters.length ? `<span class="mw-sub">phối hợp: ${people(i.supporters)}</span>` : ''}${i.leadDeptId && !isUser && !(d.subject.type === 'dept' && i.leadDeptId === d.subject.id) ? `<span class="mw-sub">${d.subject.type === 'dept' ? 'chủ trì: ' : ''}${deptLink(i.leadDeptId, i.leadDepartmentName)}</span>` : ''}</td>
      <td class="mw-c-next"><span class="mw-sub">${esc(i.stage?.label || i.state?.name || '')}</span></td>
      <td class="mw-c-due">${dueCell(i)}</td></tr>`;

  function draw() {
    const qq = f.q.trim().toLowerCase();
    const list = items.filter(i => (!f.project || String(i.project.id) === f.project) && (!f.stage || i.stage?.code === f.stage) && (!f.type || i.taskType === f.type) && (!qq || i.code.toLowerCase().includes(qq) || i.title.toLowerCase().includes(qq)));
    const cnt = $('.lf-count', root); if (cnt) cnt.textContent = list.length === items.length ? `${items.length} việc` : `${list.length}/${items.length} việc`;
    if (!list.length) { body.innerHTML = `<div class="card empty" data-testid="work-empty">Không có việc nào khớp.</div>`; return; }
    if (f.view === 'cal') {
      const state = calState(new URLSearchParams(location.hash.split('?')[1] || ''), uiPref('cal:mode'));
      body.innerHTML = `<div class="card my-cal">${calendarHtml({ items: list, state, dateOf: i => i.dueDate, hrefOf: itemHref, testid: 'work-calendar', itemTestid: i => `work-cal-${i.code}`,
        colorOf: i => i.state?.color, doneOf: i => i.state?.category === 'COMPLETED', metaOf: i => i.assignees.map(u => u.fullName).join(', ') })}</div>`;
      return;
    }
    body.innerHTML = `<div class="card"><div class="tbl-scroll"><table class="table mw-table wk-table" data-testid="work-table"><thead><tr><th class="mw-c-code">Mã</th><th>Việc · dự án</th><th>Người được phân công</th><th class="mw-c-next">Khâu</th><th class="mw-c-due">Hạn</th></tr></thead>
      <tbody>${list.map(row).join('')}</tbody></table></div></div>`;
  }
  draw();
  const calNow = () => calState(new URLSearchParams(location.hash.split('?')[1] || ''), uiPref('cal:mode'));
  bindCalendar(body, { get mode() { return calNow().mode; }, get at() { return calNow().at; } }, ({ mode, at }) => {
    uiPref('cal:mode', mode);
    if (/^#\/work(\?|$)/.test(location.hash)) replaceHashParams({ cal: mode, at: at || null });
    draw();
  });

  const syncUrl = () => { if (/^#\/work(\?|$)/.test(location.hash) && root.isConnected) replaceHashParams({ q: f.q.trim(), focus: '' }); };
  const onSearch = debounce(() => { syncUrl(); draw(); }, 150);
  root.oninput = e => { if (e.target.id === 'wkQ') { f.q = e.target.value; onSearch(); } };
  // Đổi một bộ lọc → URL mới (tải lại), nhớ để mở lại ô bộ lọc và trả tiêu điểm về đúng ô.
  const go = (changes, keepOpen) => {
    const u = new URLSearchParams();
    for (const k of SUBJECT_KEYS) if (params.get(k)) u.set(k, params.get(k));
    for (const k of ['project', 'stage', 'type', 'q']) if (f[k]) u.set(k, f[k]);
    if (f.view === 'cal') u.set('view', 'cal');
    for (const [k, v] of Object.entries(changes)) { if (v) u.set(k, v); else u.delete(k); }
    reopen = keepOpen || null;
    location.hash = '#/work?' + u;
  };
  const subjectChange = (key, v) => {
    // Đổi người / phòng: bỏ vai trò và chỉ số theo kỳ (gắn với đối tượng cũ).
    const base = { user: '', dept: '', all: '', role: '', metric: '', from: '', to: '' };
    if (key === 'user') return v ? { ...base, user: v } : curDept != null ? { ...base, dept: String(curDept) } : { ...base, all: '1' };
    return v ? { ...base, dept: v } : { ...base, all: '1' };
  };
  root.onchange = e => {
    const k = e.target.dataset.wf; if (!k) return;
    const v = e.target.value;
    if (k === 'dept' || k === 'user') return go(subjectChange(k, v), k);
    if (k === 'status') return go({ status: v === 'open' ? '' : v }, k);
    if (k === 'role') return go({ role: v }, k);
    f[k] = v; go({ [k]: v }, k);
  };
  const pop = $('#wkMore', root), popBtn = $('#wkMoreBtn', root);
  const setPop = open => { pop.hidden = !open; popBtn.setAttribute('aria-expanded', String(open)); };
  root.onclick = e => {
    if (e.target.closest('#wkMoreBtn')) { setPop(pop.hidden); if (!pop.hidden) $('select', pop)?.focus(); return; }
    if (e.target.closest('[data-pop-close]')) { setPop(false); popBtn.focus(); return; }
    const clr = e.target.closest('[data-wf-clear]');
    if (clr) {
      const k = clr.dataset.wfClear, inPop = !!clr.closest('#wkMore');
      if (k === 'all') { Object.assign(f, { project: '', stage: '', type: '' }); return go({ ...(d.subjects.all ? subjectChange('dept', '') : {}), status: '', role: '', project: '', stage: '', type: '' }, inPop ? 'dept' : null); }
      if (k === 'dept') return go(subjectChange('dept', ''));
      if (k === 'user') return go(subjectChange('user', ''));
      if (k === 'status' || k === 'role') return go({ [k]: '' });
      f[k] = ''; return go({ [k]: '' });
    }
    const vb = e.target.closest('[data-wkview]');
    if (vb) {
      f.view = vb.dataset.wkview; uiPref('work:view', f.view === 'cal' ? 'cal' : null);
      for (const b of $$('[data-wkview]', root)) { const on = b.dataset.wkview === f.view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
      replaceHashParams({ view: f.view === 'cal' ? 'cal' : null });
      draw(); return;
    }
    const r = e.target.closest('[data-href]'); if (r && !e.target.closest('a')) location.hash = r.dataset.href;
  };
  root.onkeydown = e => {
    if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); setPop(false); popBtn.focus(); return; }
    if (e.key === 'Enter' && e.target.matches('tr[data-href]')) location.hash = e.target.dataset.href;
  };
  if (reopen) { setPop(true); $(`[data-wf="${reopen}"]`, pop)?.focus(); reopen = null; }
}
let reopen = null;
// Bấm ra ngoài thì đóng ô bộ lọc.
document.addEventListener('mousedown', e => {
  const pop = document.getElementById('wkMore');
  if (pop && !pop.hidden && !pop.contains(e.target) && !e.target.closest('#wkMoreBtn')) { pop.hidden = true; document.getElementById('wkMoreBtn')?.setAttribute('aria-expanded', 'false'); }
});
