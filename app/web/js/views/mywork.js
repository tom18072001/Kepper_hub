// Việc của tôi: "Cần tôi làm" (bị trả lại, rồi theo hạn) và "Đang chờ người khác" (đã nộp / chờ duyệt / chờ phòng tiếp nhận) —
// mỗi việc chỉ xuất hiện một lần. Lọc theo vai trò, dự án, từ khoá (lưu trên URL; vai trò nhớ theo người).
import { api } from '../api.js';
import { store } from '../store.js';
import { $, $$, esc, fmtDate, ago, prioChip, labelChip, dueCountdown, uiPref, replaceHashParams, debounce } from '../util.js';
import { icon } from '../icons.js';
import { drawNotes } from './notes.js';
import { calendarHtml, calState, bindCalendar } from './calendar-view.js';

const GROUPS = [
  ['overdue', 'Quá hạn'], ['today', 'Đến hạn trong 2 ngày'], ['week', 'Trong 7 ngày tới'], ['later', 'Sau đó'], ['nodue', 'Chưa có hạn'],
];
const ROLE = { LEAD: 'Chủ trì', SUPPORT: 'Phối hợp' };
// Khâu đang nằm ở người khác: đã nộp phòng / BGĐ, chờ duyệt, chờ phòng tiếp nhận.
const WAITING = new Set(['WAIT_DEPT', 'WAIT_BGD', 'WAIT_APPROVAL', 'PENDING_ACCEPT']);
const vnDay = v => Math.floor((new Date(v).getTime() + 7 * 3_600_000) / 86_400_000);
// Hạn tôi phải làm theo: người chủ trì làm theo hạn nộp phòng (nếu phòng đặt), còn lại theo hạn chính thức.
const myDue = i => (i.myRole === 'LEAD' && i.internalDueDate ? i.internalDueDate : i.dueDate);
function groupOf(item) {
  const due = myDue(item);
  if (!due) return 'nodue';
  const left = vnDay(due) - vnDay(Date.now());
  return left < 0 ? 'overdue' : left <= 1 ? 'today' : left <= 7 ? 'week' : 'later';
}
const isWaiting = i => WAITING.has(i.stage?.code);
const isReturned = i => i.stage?.code === 'RETURNED' && i.myRole === 'LEAD';

// "Việc tiếp theo" của tôi với việc này — một cụm động từ ngắn.
function nextStep(i) {
  const st = i.stage?.code;
  if (isReturned(i)) return { text: 'Sửa & nộp lại', tone: 'danger' };
  if (st === 'PENDING_ACCEPT') return { text: 'Chờ phòng tiếp nhận', tone: 'wait' };
  if (st === 'WAIT_DEPT') return { text: 'Chờ phòng duyệt', tone: 'wait' };
  if (st === 'WAIT_BGD') return { text: 'Chờ BGĐ cho ý kiến', tone: 'wait' };
  if (st === 'WAIT_APPROVAL') return { text: i.stage.label || 'Chờ duyệt', tone: 'wait' };
  if (!i.myRole) return { text: (i.dispatchStatus ? i.stage?.label : i.state?.name) || 'Theo dõi', tone: 'wait', plain: true };
  if (i.myRole === 'SUPPORT') return { text: 'Báo cáo phần phối hợp', tone: '' };
  if (i.progress >= 100) return { text: i.dispatchStatus ? 'Nộp sản phẩm' : 'Gửi duyệt / hoàn thành', tone: 'go' };
  if (dueCountdown({ ...i, dueDate: myDue(i) }).tone === 'danger') return { text: 'Nộp hoặc xin gia hạn', tone: 'danger' };
  // Việc giao về phòng: "Báo cáo lần đầu" khi chưa có báo cáo tiến độ nào (máy chủ trả reportCount).
  const firstReport = i.reportCount != null ? i.reportCount === 0 : st === 'TODO' && !i.progress;
  if (i.dispatchStatus && firstReport) return { text: 'Báo cáo lần đầu', tone: 'go' };
  if (!i.dispatchStatus && st === 'TODO' && !i.progress) return { text: 'Bắt đầu làm', tone: 'go' };
  return { text: 'Báo cáo tiến độ', tone: '' };
}

export async function renderMyWork(root, params, setCrumbs) {
  const mode = ['created', 'notes'].includes(params.get('mode')) ? params.get('mode') : 'assigned';
  setCrumbs('Việc của tôi');
  const tabs = `<div class="tabs"><a href="#/my" class="${mode === 'assigned' ? 'active' : ''}" data-testid="my-assigned">Được giao cho tôi</a><a href="#/my?mode=created" class="${mode === 'created' ? 'active' : ''}" data-testid="my-created">Tôi tạo</a><a href="#/my?mode=notes" class="${mode === 'notes' ? 'active' : ''}" data-testid="my-notes">Ghi chú của tôi</a></div>`;
  root.oninput = null; root.onchange = null; root.onkeydown = null;
  if (mode === 'notes') {
    root.onclick = null;
    root.innerHTML = `<div class="page-head"><h1>Ghi chú của tôi</h1>${tabs}</div><div id="notesBody"></div>`;
    return drawNotes(root.querySelector('#notesBody'));
  }
  const items = await api(`/api/my/items?mode=${mode}`);
  const assigned = mode === 'assigned';
  const projects = [...new Map(items.map(i => [i.project.id, i.project])).values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const multiProject = projects.length > 1;

  // Bộ lọc: URL thắng; không có trên URL thì lấy vai trò đã nhớ (chỉ mã vai trò, không lưu từ khoá).
  const urlRole = params.get('role');
  const f = {
    role: assigned ? (['LEAD', 'SUPPORT'].includes(urlRole) ? urlRole : urlRole === null ? (['LEAD', 'SUPPORT'].includes(uiPref('my:role')) ? uiPref('my:role') : '') : '') : '',
    q: params.get('q') || '',
    project: projects.some(p => String(p.id) === params.get('project')) ? params.get('project') : '',
    // Kiểu xem: danh sách theo việc cần làm, hoặc lịch tuần / tháng (nhớ theo người).
    view: params.get('view') === 'cal' || (params.get('view') == null && uiPref('my:view') === 'cal') ? 'cal' : 'list',
  };
  if (assigned && f.role && urlRole !== f.role) replaceHashParams({ role: f.role });

  const linkParams = extra => {
    const u = new URLSearchParams();
    if (!assigned) u.set('mode', mode);
    if (f.role) u.set('role', f.role);
    if (f.project) u.set('project', f.project);
    if (f.q) u.set('q', f.q);
    if (f.view === 'cal') { u.set('view', 'cal'); const c = new URLSearchParams(location.hash.split('?')[1] || ''); for (const k of ['cal', 'at']) if (c.get(k)) u.set(k, c.get(k)); }
    for (const [k, v] of Object.entries(extra)) if (v) u.set(k, v);
    return '#/my?' + u;
  };
  const href = (i, focus) => linkParams({ item: i.id, focus });

  const dueCell = i => {
    const due = myDue(i), c = dueCountdown({ ...i, dueDate: due });
    if (!due) return '<span class="muted sm">Chưa có hạn</span>';
    return `<span class="mw-due ${c.tone}">${esc(c.text)}</span><span class="mw-date">${fmtDate(due)}${due !== i.dueDate && i.dueDate ? ` · nộp phòng, hạn ${fmtDate(i.dueDate)}` : ''}</span>`;
  };
  const nextCell = i => {
    const n = nextStep(i);
    const st = i.stage?.code;
    // Khâu/trạng thái chỉ hiện thêm khi khác với "việc tiếp theo".
    const sub = n.plain || WAITING.has(st) || st === 'RETURNED' ? '' : i.dispatchStatus ? (i.stage?.label || '') : (i.state?.name || '');
    return `<span class="mw-next ${n.tone}">${esc(n.text)}</span>${sub ? `<span class="mw-sub">${esc(sub)}</span>` : ''}`;
  };
  const row = i => `<tr class="clickable" tabindex="0" data-href="${href(i)}" data-testid="my-${esc(i.code)}">
      <td class="code mw-c-code">${esc(i.code)}</td>
      <td class="mw-c-title"><span class="mw-title">${esc(i.title)}</span><span class="mw-tags">${i.myRole ? `<span class="pill role">${ROLE[i.myRole]}</span>` : ''}${prioChip(i.priority) ? `<span class="mw-prio">${prioChip(i.priority)}</span>` : ''}${i.labels.map(labelChip).join('')}</span></td>
      <td class="mw-c-next">${nextCell(i)}</td>
      ${multiProject ? `<td class="mw-c-proj muted sm">${esc(i.project.name)}</td>` : ''}
      <td class="mw-c-due">${dueCell(i)}</td></tr>`;
  const table = (list, testid) => `<table class="table mw-table" data-testid="${testid}"><thead><tr><th class="mw-c-code">Mã</th><th>Việc</th><th class="mw-c-next">${assigned ? 'Việc tiếp theo' : 'Khâu / trạng thái'}</th>${multiProject ? '<th class="mw-c-proj">Dự án</th>' : ''}<th class="mw-c-due">${assigned ? 'Hạn của tôi' : 'Hạn'}</th></tr></thead>
      <tbody>${list.map(row).join('')}</tbody></table>`;
  const attentionCard = i => `<a class="attention mw-attn" href="${href(i, 'returned')}" data-testid="attention-${esc(i.code)}">
      <span class="code">${esc(i.code)}</span>
      <span class="grow"><b class="mw-attn-title">${esc(i.title)}</b><span class="muted sm mw-attn-note">Bị trả lại${i.returnedAt ? ' ' + ago(i.returnedAt) : ''}${i.returnNote ? ': ' + esc(i.returnNote) : ''}</span></span>
      <span class="pill danger">Sửa &amp; nộp lại</span></a>`;
  const groupHead = (title, n, tag = 'h3') => `<${tag} class="mw-gh">${title} <span class="mw-n">${n}</span></${tag}>`;

  const filterBar = `<div class="lf-bar mw-bar" role="search" aria-label="Lọc việc của tôi">
      ${assigned ? `<div class="lf-chips" role="group" aria-label="Vai trò của tôi">
        <button type="button" class="chip" data-role="" data-testid="my-role-ALL">Tất cả <b></b></button>
        <button type="button" class="chip" data-role="LEAD" data-testid="my-role-LEAD">Chủ trì <b></b></button>
        <button type="button" class="chip" data-role="SUPPORT" data-testid="my-role-SUPPORT">Phối hợp <b></b></button></div>` : ''}
      <label class="search-field lf-search">${icon('search')}<input type="search" id="myQ" value="${esc(f.q)}" placeholder="Tìm mã hoặc tên việc" aria-label="Tìm việc" autocomplete="off" data-testid="my-q"></label>
      ${multiProject ? `<select id="myProject" class="lf-select" aria-label="Dự án" data-testid="my-project"><option value="">Mọi dự án</option>${projects.map(p => `<option value="${p.id}"${String(p.id) === f.project ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}
      <span class="lf-count" aria-live="polite"></span>
      <span class="seg" role="group" aria-label="Kiểu xem"><button type="button" data-myview="list" aria-pressed="${f.view === 'list'}" class="${f.view === 'list' ? 'on' : ''}" data-testid="my-view-list">Danh sách</button><button type="button" data-myview="cal" aria-pressed="${f.view === 'cal'}" class="${f.view === 'cal' ? 'on' : ''}" data-testid="my-view-cal">Lịch</button></span>
    </div>`;

  root.innerHTML = `<div class="page-head"><h1>Chào ${esc(store.me.fullName)}</h1>${tabs}</div>
    <p class="muted mw-lead" id="myLead"></p>
    ${items.length ? filterBar : ''}
    <div id="myBody"></div>
    ${assigned ? '<div id="myKpi" class="my-kpi-slot" style="margin-top:24px"></div>' : ''}`;

  const body = $('#myBody', root);
  const matchesText = i => { const q = f.q.trim().toLowerCase(); return !q || i.code.toLowerCase().includes(q) || i.title.toLowerCase().includes(q); };
  const matchesProject = i => !f.project || String(i.project.id) === f.project;

  function draw() {
    const base = items.filter(i => matchesText(i) && matchesProject(i));
    const list = base.filter(i => !f.role || i.myRole === f.role);
    // Đếm trên chip theo các bộ lọc khác (từ khoá, dự án).
    for (const b of $$('[data-role]', root)) {
      const k = b.dataset.role, n = k ? base.filter(i => i.myRole === k).length : base.length;
      b.querySelector('b').textContent = n;
      b.classList.toggle('on', k === f.role); b.setAttribute('aria-pressed', String(k === f.role));
    }
    const countEl = $('.lf-count', root);
    if (countEl) countEl.textContent = list.length === items.length ? `${items.length} việc` : `${list.length}/${items.length} việc`;

    const attention = assigned ? list.filter(isReturned) : [];
    const waiting = assigned ? list.filter(i => isWaiting(i) && !isReturned(i)) : [];
    const shown = new Set([...attention, ...waiting]);
    const todo = list.filter(i => !shown.has(i));
    const grouped = Object.fromEntries(GROUPS.map(([k]) => [k, []]));
    for (const i of todo) grouped[groupOf(i)].push(i);
    const byDue = (a, b) => (myDue(a) ? +new Date(myDue(a)) : Infinity) - (myDue(b) ? +new Date(myDue(b)) : Infinity);
    for (const k in grouped) grouped[k].sort(byDue);

    const lead = $('#myLead', root);
    const projCount = new Set(items.map(i => i.project.id)).size;
    if (lead) lead.textContent = !items.length ? '' : assigned
      ? `${items.filter(i => !isWaiting(i) || isReturned(i)).length} việc cần bạn làm · ${items.filter(i => isWaiting(i) && !isReturned(i)).length} việc đang chờ người khác · trên ${projCount} dự án.`
      : `${items.length} việc đang mở trên ${projCount} dự án.`;

    if (!items.length) {
      // Không có việc giao trực tiếp: chỉ sang nơi đang có việc chờ (phiếu duyệt, việc phòng) thay vì một trang trống.
      const c = store.counts || {};
      const next = [c.total ? `<a class="btn btn-primary" href="#/approvals" data-testid="my-empty-approvals">Chờ tôi xử lý · ${c.total}</a>` : '',
        '<a class="btn" href="#/home">Dashboard dự án</a>'].filter(Boolean).join(' ');
      body.innerHTML = `<div class="card empty"><p>Không có việc nào giao trực tiếp cho bạn đang mở.</p>${next ? `<p class="mw-empty-next">${next}</p>` : ''}<p class="muted xs">Ghi nhanh việc cá nhân ở tab <a href="#/my?mode=notes">Ghi chú của tôi</a>.</p></div>`;
      return;
    }
    if (!list.length) {
      const what = [f.role && `<b>${ROLE[f.role]}</b>`, f.project && `trong <b>${esc(projects.find(p => String(p.id) === f.project)?.name || '')}</b>`, f.q.trim() && `khớp “${esc(f.q.trim())}”`].filter(Boolean).join(' ');
      body.innerHTML = `<div class="card empty lf-empty" data-testid="my-filter-empty"><p>Không có việc ${what} đang mở.</p><button type="button" class="btn btn-ghost btn-sm" data-clear>Xem tất cả</button></div>`;
      return;
    }
    if (f.view === 'cal') {
      // Lịch: mọi việc đang mở (kể cả đang chờ người khác) theo hạn của tôi (hạn nộp phòng nếu có).
      const state = calState(new URLSearchParams(location.hash.split('?')[1] || ''), uiPref('cal:mode'));
      body.innerHTML = `<div class="card my-cal">${calendarHtml({ items: list, state, dateOf: myDue, hrefOf: i => href(i), testid: 'my-calendar', itemTestid: i => `my-cal-${i.code}`,
        colorOf: i => (isReturned(i) ? 'var(--danger)' : isWaiting(i) ? 'var(--warn)' : i.state?.color), doneOf: () => false, metaOf: i => (i.myRole === 'SUPPORT' ? 'phối hợp' : '') })}</div>`;
      return;
    }
    const todoGroups = GROUPS.filter(([k]) => grouped[k].length).map(([k, title]) => `<section class="mw-group">${groupHead(title, grouped[k].length)}${table(grouped[k], `my-group-${k}`)}</section>`).join('');
    const openWaiting = uiPref('my:waitingOpen') === true;
    body.innerHTML = `
      ${assigned ? `<section class="mw-zone"><h2 class="mw-zh">Cần tôi làm <span class="mw-n">${attention.length + todo.length}</span></h2>` : '<section class="mw-zone">'}
        ${attention.length ? `<section class="mw-group">${groupHead('Bị trả lại', attention.length)}<div class="attention-list" data-testid="my-attention">${attention.map(attentionCard).join('')}</div></section>` : ''}
        ${todoGroups || (assigned ? '<p class="muted sm mw-none">Không còn việc nào cần bạn làm ngay.</p>' : '')}
      </section>
      ${waiting.length ? `<details class="mw-wait" data-testid="my-waiting"${openWaiting ? ' open' : ''}>
        <summary><span class="mw-zh">Đang chờ người khác <span class="mw-n">${waiting.length}</span></span><span class="muted sm mw-wait-hint">Đã nộp, đang chờ duyệt hoặc chờ phòng tiếp nhận</span></summary>
        ${table(waiting.sort(byDue), 'my-group-waiting')}</details>` : ''}`;
    const det = $('.mw-wait', body);
    if (det) det.ontoggle = () => uiPref('my:waitingOpen', det.open ? true : null);
  }
  draw();
  bindCalendar(body, { get mode() { return calState(new URLSearchParams(location.hash.split('?')[1] || ''), uiPref('cal:mode')).mode; }, get at() { return calState(new URLSearchParams(location.hash.split('?')[1] || ''), uiPref('cal:mode')).at; } }, ({ mode, at }) => {
    uiPref('cal:mode', mode);
    if (/^#\/(my)?(\?|$)/.test(location.hash || '#/')) replaceHashParams({ cal: mode, at: at || null });
    draw();
  });

  // Chỉ ghi khi vẫn đang ở Việc của tôi (ô tìm có hẹn giờ, người dùng có thể đã sang trang khác).
  const syncUrl = () => { if (/^#\/(my)?(\?|$)/.test(location.hash || '#/') && root.isConnected) replaceHashParams({ role: f.role, q: f.q.trim(), project: f.project, focus: '' }); };
  const onSearch = debounce(() => { syncUrl(); draw(); }, 150);
  root.oninput = e => { if (e.target.id === 'myQ') { f.q = e.target.value; onSearch(); } };
  root.onchange = e => { if (e.target.id === 'myProject') { f.project = e.target.value; syncUrl(); draw(); } };
  root.onkeydown = e => { if (e.target.id === 'myQ' && e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; f.q = ''; syncUrl(); draw(); } };
  root.onclick = e => {
    const chip = e.target.closest('[data-role]');
    if (chip) { f.role = chip.dataset.role; uiPref('my:role', f.role || null); syncUrl(); draw(); return; }
    const vb = e.target.closest('[data-myview]');
    if (vb) {
      f.view = vb.dataset.myview; uiPref('my:view', f.view === 'cal' ? 'cal' : null);
      for (const b of $$('[data-myview]', root)) { const on = b.dataset.myview === f.view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
      if (/^#\/(my)?(\?|$)/.test(location.hash || '#/')) replaceHashParams({ view: f.view === 'cal' ? 'cal' : null });
      draw(); return;
    }
    if (e.target.closest('[data-clear]')) {
      Object.assign(f, { role: '', q: '', project: '' }); uiPref('my:role', null);
      const q = $('#myQ', root); if (q) q.value = '';
      const p = $('#myProject', root); if (p) p.value = '';
      syncUrl(); draw(); return;
    }
    const r = e.target.closest('[data-href]'); if (r) location.hash = r.dataset.href;
  };
  // Số liệu của chính tôi (đúng hạn, xếp loại) — không chặn trang nếu chưa tải được.
  const slot = root.querySelector('#myKpi');
  if (slot) import('./my-kpi.js').then(m => m.renderMyKpi?.(slot)).catch(() => slot.remove());
}
