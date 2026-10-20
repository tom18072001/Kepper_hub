// Việc phòng được giao (lãnh đạo phòng, người được uỷ quyền): chờ tiếp nhận → đang thực hiện → chờ phòng duyệt → đã xong;
// việc phòng phối hợp. Lọc nhanh (tìm, quá hạn, có kiến nghị / gia hạn) lưu trên URL. Uỷ quyền có thời hạn thu gọn ở cuối trang.
import { api, ApiError } from '../api.js';
import { store } from '../store.js';
import { $, $$, esc, fmtDate, avatars, dueCountdown, toast, errorMessage, dateInput, fromDateInput, uiPref, replaceHashParams, debounce } from '../util.js';
import { icon } from '../icons.js';
import { TASK_TYPES, stagePill } from './dispatch-panel.js';
import { calendarHtml, calState, bindCalendar } from './calendar-view.js';

const TABS = [['PENDING', 'Chờ tiếp nhận'], ['ACTIVE', 'Đang thực hiện'], ['WAIT_DEPT', 'Chờ phòng duyệt'], ['WAIT_BGD', 'Chờ BGĐ cho ý kiến'], ['SUPPORT', 'Phòng phối hợp'], ['DONE', 'Đã xong (30 ngày)'], ['CAL', 'Lịch']];
const isDirector = () => store.me?.permissions?.['work.approve']?.operate === 'SYSTEM';
const short = d => new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });

// Vẽ lại sau thao tác: đọc bộ lọc hiện tại trên URL (người dùng có thể đã đổi sau lần vẽ trước).
const liveParams = () => new URLSearchParams(location.hash.split('?')[1] || '');
export async function renderDept(root, params, setCrumbs, { background = false } = {}) {
  let inbox = null, note = '';
  try { inbox = await api('/api/dispatch/inbox'); }
  catch (error) { if (!(error instanceof ApiError && error.status === 403)) throw error; note = 'Bạn không phụ trách phòng nào — chỉ quản lý uỷ quyền ở đây.'; }
  const delegations = await api('/api/delegations');
  setCrumbs(inbox ? 'Việc phòng được giao' : 'Uỷ quyền');
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : inbox?.counts.PENDING ? 'PENDING' : inbox?.counts.WAIT_DEPT ? 'WAIT_DEPT' : 'ACTIVE';
  if (params.get('tab') !== tab && /^#\/dept(\?|$)/.test(location.hash)) replaceHashParams({ tab });
  // Tab "Lịch": mọi việc phòng chưa xong, xem theo tuần / tháng (hạn nộp phòng nếu có, không thì hạn hoàn thành).
  const isCal = tab === 'CAL';
  const calCount = (inbox?.items || []).filter(i => i.tab !== 'DONE').length;
  const tabRows = (inbox?.items || []).filter(i => (isCal ? i.tab !== 'DONE' : i.tab === tab));
  const f = { q: params.get('q') || '', overdue: params.get('overdue') === '1', flags: params.get('flags') === '1' };
  const link = extra => {
    const u = new URLSearchParams({ tab });
    if (f.q.trim()) u.set('q', f.q.trim());
    if (f.overdue) u.set('overdue', '1');
    if (f.flags) u.set('flags', '1');
    if (tab === 'CAL') { const c = new URLSearchParams(location.hash.split('?')[1] || ''); for (const k of ['cal', 'at']) if (c.get(k)) u.set(k, c.get(k)); }
    for (const [k, v] of Object.entries(extra)) { if (v) u.set(k, v); else u.delete(k); }
    return '#/dept?' + u;
  };

  // ---- Uỷ quyền ----
  const now = Date.now();
  const director = isDirector();
  const leaders = store.users.filter(u => (director ? ['director'] : ['director', 'manager', 'deputy']).includes(u.role) && u.id !== store.me.id);
  const mineActive = delegations.filter(x => x.fromUserId === store.me.id && x.active);
  const toMeActive = delegations.filter(x => x.toUserId === store.me.id && x.active);
  const upcoming = delegations.filter(x => x.fromUserId === store.me.id && !x.revokedAt && new Date(x.startsAt) > now);
  const current = delegations.filter(x => !x.revokedAt && new Date(x.endsAt) > now);
  const ended = delegations.filter(x => !current.includes(x));
  const names = list => esc(list[0][list === toMeActive ? 'fromName' : 'toName']) + (list.length > 1 ? ` và ${list.length - 1} người khác` : '');
  const delegSummary = mineActive.length ? `Đang uỷ quyền cho <b>${names(mineActive)}</b> đến ${short(mineActive[0].endsAt)}`
    : toMeActive.length ? `<b>${names(toMeActive)}</b> đang uỷ quyền cho bạn đến ${short(toMeActive[0].endsAt)}`
      : upcoming.length ? `Sẽ uỷ quyền cho <b>${esc(upcoming[0].toName)}</b> từ ${short(upcoming[0].startsAt)}`
        : 'Không có uỷ quyền đang hiệu lực · <span class="dp-link">Tạo uỷ quyền</span>';
  const delegOpen = director || mineActive.length || toMeActive.length || uiPref('dept:deleg') === 'open';
  const statusOf = x => (x.revokedAt ? 'Đã thu hồi' : x.active ? '<span class="pill ok">Đang hiệu lực</span>' : new Date(x.startsAt) > now ? 'Chưa bắt đầu' : 'Hết hạn');
  const delegRow = x => `<tr><td>${esc(x.fromName)}</td><td>${esc(x.toName)}</td><td class="nowrap">${fmtDate(x.startsAt)} – ${fmtDate(x.endsAt)}</td><td>${esc(x.note || '')}</td>
      <td>${statusOf(x)}</td>
      <td>${x.fromUserId === store.me.id && !x.revokedAt && new Date(x.endsAt) > now ? `<button type="button" class="btn btn-ghost btn-sm" data-revoke="${x.id}">Thu hồi</button>` : ''}</td></tr>`;
  const delegTable = list => `<div class="tbl-scroll"><table class="table compact"><thead><tr><th>Từ</th><th>Cho</th><th>Thời hạn</th><th>Nội dung</th><th>Trạng thái</th><th></th></tr></thead><tbody>${list.map(delegRow).join('')}</tbody></table></div>`;
  const delegations$ = `<details class="card dp-deleg" data-testid="delegations"${delegOpen ? ' open' : ''}>
      <summary><span class="dp-deleg-h">Uỷ quyền duyệt / tiếp nhận</span><span class="dp-deleg-s">${delegSummary}</span></summary>
      <div class="dp-deleg-body">
        <p class="muted sm">Khi đi vắng hoặc giao theo lĩnh vực: người được uỷ quyền thay bạn tiếp nhận việc của phòng và duyệt ở các bước của bạn trong thời hạn. Mọi thao tác đều ghi nhật ký.</p>
        ${current.length ? delegTable(current) : ''}
        ${ended.length ? `<details class="dp-hist"><summary>Đã kết thúc <span class="mw-n">${ended.length}</span></summary>${delegTable(ended)}</details>` : ''}
        <form id="delegForm" class="dp-form">
          <label class="field">Uỷ quyền cho<select name="toUserId" required data-testid="delegate-to"><option value="">— Chọn lãnh đạo —</option>${leaders.map(u => `<option value="${u.id}">${esc(u.fullName)}${u.displayTitle ? ' — ' + esc(u.displayTitle) : ''}</option>`).join('')}</select></label>
          <label class="field">Từ ngày<input type="date" name="startsAt" value="${dateInput(new Date())}"></label>
          <label class="field">Đến ngày<input type="date" name="endsAt" required data-testid="delegate-end"></label>
          <label class="field dp-note">Nội dung<input name="note" maxlength="300" placeholder="VD: Đi công tác; hoặc lĩnh vực truyền thông"></label>
          <button class="btn btn-primary" data-testid="delegate-save">Uỷ quyền</button>
        </form>
      </div></details>`;

  // ---- Hộp việc ----
  const dueCell = i => {
    const c = dueCountdown(i);
    if (!i.dueDate) return '<span class="muted">—</span>';
    return `<span class="dp-date">${fmtDate(i.dueDate)}</span>${i.internalDueDate ? `<span class="dp-int muted xs">nộp phòng ${fmtDate(i.internalDueDate)}</span>` : ''}<span class="pill dp-due ${c.tone}" title="Hạn ${fmtDate(i.dueDate)}">${esc(c.text)}</span>`;
  };
  const withAct = tab === 'PENDING', cols = withAct ? 8 : 7;
  const defFocus = i => (i.pendingExtensions ? 'extension' : i.openProposals ? 'proposal' : '');
  const row = i => `<tr class="reg-row" tabindex="0" data-open="${i.id}" data-def-focus="${defFocus(i)}" data-testid="dept-row-${esc(i.code)}">
      <td class="code dp-c-code">${esc(i.code)}</td>
      <td class="dp-c-task"><b class="dp-title">${esc(i.title)}</b><div class="muted xs">${esc(TASK_TYPES[i.taskType] || '')}${i.childrenTotal ? ` · ${i.childrenDone}/${i.childrenTotal} việc nhánh xong` : ''}${i.waitingDays != null ? ` · chờ tiếp nhận ${i.waitingDays ? i.waitingDays + ' ngày' : 'từ hôm nay'}` : ''}${i.assignedByName ? `<span class="dp-by-m"> · giao bởi ${esc(i.assignedByName)}</span>` : ''}</div>
        ${i.pendingExtensions || i.openProposals ? `<div class="dp-flags">${i.pendingExtensions ? `<button type="button" class="pill warn" data-focus="extension" title="Mở việc tại đề nghị gia hạn">xin gia hạn</button>` : ''}${i.openProposals ? `<button type="button" class="pill warn" data-focus="proposal" title="Mở việc tại kiến nghị chờ trả lời">${i.openProposals} kiến nghị</button>` : ''}</div>` : ''}</td>
      <td class="dp-c-stage">${stagePill(i.stage)}</td><td class="dp-c-by">${esc(i.assignedByName || '—')}</td>
      <td class="dp-c-due">${dueCell(i)}</td>
      <td class="dp-c-lead">${i.assignees.length ? avatars(i.assignees) : '<span class="muted sm">Chưa phân công</span>'}</td><td class="num dp-c-prog">${i.progress}%</td>
      ${withAct ? `<td class="dp-act">${i.tab === 'PENDING' ? `<button type="button" class="btn btn-primary btn-sm" data-accept="${i.id}" data-testid="dept-accept-${esc(i.code)}" title="Tiếp nhận & phân công cán bộ">Tiếp nhận</button>` : ''}</td>` : ''}</tr>`;
  const showHint = !uiPref('dept:hintSeen');
  const tabLabel = TABS.find(t => t[0] === tab)[1];

  root.innerHTML = `<div class="page-head"><h1>${inbox ? 'Việc phòng được giao' : 'Uỷ quyền'}</h1>${inbox ? `<span class="muted sm">${inbox.departments.map(d => esc(d.name)).join(', ')}</span>` : ''}</div>
    ${inbox ? `<div class="tabs" role="tablist" aria-label="Nhóm việc">${TABS.map(([k, label]) => { const n = k === 'CAL' ? calCount : inbox.counts[k] || 0; return `<a href="#/dept?tab=${k}" data-tab="${k}" class="${k === tab ? 'active' : ''} ${n ? 'has-n' : 'zero'}" role="tab" aria-selected="${k === tab}" data-testid="dept-tab-${k}">${label} <b>${n}</b></a>`; }).join('')}</div>
    ${tabRows.length ? `<div class="lf-bar dp-bar" role="search" aria-label="Lọc việc phòng">
      <label class="search-field lf-search">${icon('search')}<input type="search" id="deptQ" value="${esc(f.q)}" placeholder="Tìm mã, tên việc, người chủ trì" aria-label="Tìm việc phòng" autocomplete="off" data-testid="dept-q"></label>
      <div class="lf-chips" role="group" aria-label="Lọc nhanh">
        <button type="button" class="chip chip-OVERDUE" data-chip="overdue" data-testid="dept-chip-overdue">Quá hạn <b></b></button>
        <button type="button" class="chip" data-chip="flags" data-testid="dept-chip-flags">Có kiến nghị / gia hạn <b></b></button></div>
      <span class="lf-count" aria-live="polite"></span></div>` : ''}
    ${isCal ? '<div class="card dp-cal" id="deptCal"></div>' : `<div class="card dp-card"><div class="tbl-scroll"><table class="table dp-table" data-testid="dept-inbox"><thead><tr><th>Mã</th><th>Nhiệm vụ</th><th>Khâu</th><th>Người giao</th><th>Hạn</th><th>Người chủ trì</th><th class="num">Tiến độ</th>${withAct ? '<th aria-label="Thao tác"></th>' : ''}</tr></thead><tbody id="deptRows"></tbody></table></div></div>`}
    ${showHint ? '<p class="muted xs dp-hint">Nhấn một dòng để mở việc: tiếp nhận &amp; phân công cán bộ, đặt hạn nội bộ cho việc nhánh, duyệt sản phẩm trước khi trình Ban Giám đốc.</p>' : ''}`
    : isDirector() ? '' : `<div class="card empty">${esc(note)}</div>`}
    ${delegations$}`;

  const textOf = i => [i.code, i.title, i.assignedByName, ...i.assignees.map(a => a.fullName)].filter(Boolean).join(' ').toLowerCase();
  const liveCal = () => calState(new URLSearchParams(location.hash.split('?')[1] || ''), uiPref('cal:mode'));
  function draw() {
    const cal = $('#deptCal', root);
    if (cal) {
      const q = f.q.trim().toLowerCase();
      const list = tabRows.filter(i => (!q || textOf(i).includes(q)) && (!f.overdue || i.deadline?.code === 'OVERDUE') && (!f.flags || i.pendingExtensions || i.openProposals));
      for (const b of $$('[data-chip]', root)) { const on = !!f[b.dataset.chip]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.querySelector('b').textContent = tabRows.filter(b.dataset.chip === 'overdue' ? i => i.deadline?.code === 'OVERDUE' : i => i.pendingExtensions || i.openProposals).length; }
      const cnt = $('.lf-count', root); if (cnt) cnt.textContent = `${list.length}/${tabRows.length} việc`;
      cal.innerHTML = calendarHtml({ items: list, state: liveCal(), dateOf: i => i.internalDueDate || i.dueDate, hrefOf: i => link({ item: i.id, focus: defFocus(i) }), testid: 'dept-calendar', itemTestid: i => `dept-cal-${i.code}`,
        colorOf: i => (i.deadline?.code === 'OVERDUE' ? 'var(--danger)' : i.tab === 'PENDING' ? 'var(--warn)' : ''), metaOf: i => i.assignees?.[0]?.fullName?.split(' ').pop() || (i.tab === 'PENDING' ? 'chờ tiếp nhận' : '') });
      return;
    }
    const body = $('#deptRows', root); if (!body) return;
    const q = f.q.trim().toLowerCase();
    const base = tabRows.filter(i => !q || textOf(i).includes(q));
    const isOver = i => i.deadline?.code === 'OVERDUE', hasFlag = i => i.pendingExtensions || i.openProposals;
    const list = base.filter(i => (!f.overdue || isOver(i)) && (!f.flags || hasFlag(i)));
    for (const b of $$('[data-chip]', root)) {
      const k = b.dataset.chip, on = !!f[k];
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      const n = base.filter(k === 'overdue' ? isOver : hasFlag).length;
      b.querySelector('b').textContent = n; b.querySelector('b').classList.toggle('n0', !n);
    }
    const cnt = $('.lf-count', root); if (cnt) cnt.textContent = list.length === tabRows.length ? `${tabRows.length} việc` : `${list.length}/${tabRows.length} việc`;
    const filtered = q || f.overdue || f.flags;
    body.innerHTML = list.map(row).join('') || (filtered && tabRows.length
      ? `<tr class="dp-empty-row"><td colspan="${cols}" class="empty" data-testid="dept-filter-empty">Không có việc nào khớp bộ lọc ở “${esc(tabLabel)}”. <button type="button" class="btn btn-ghost btn-sm" data-clear>Xoá lọc</button></td></tr>`
      : `<tr class="dp-empty-row"><td colspan="${cols}" class="empty">Không có việc ở “${esc(tabLabel)}”.</td></tr>`);
  }
  draw();
  const calEl = $('#deptCal', root);
  if (calEl) bindCalendar(calEl, { get mode() { return liveCal().mode; }, get at() { return liveCal().at; } }, ({ mode, at }) => {
    uiPref('cal:mode', mode);
    if (/^#\/dept(\?|$)/.test(location.hash)) replaceHashParams({ cal: mode, at: at || null });
    draw();
  });
  // Vừa tiếp nhận xong trong panel (trang nền vẽ lại): đặt sẵn vạch chọn lên dòng chờ tiếp nhận kế tiếp — Enter để mở.
  const openId = Number(params.get('item'));
  if (background && tab === 'PENDING' && openId && !tabRows.some(i => i.id === openId)) $('#deptRows tr.reg-row', root)?.classList.add('kb-cursor');

  const syncUrl = () => { if (/^#\/dept(\?|$)/.test(location.hash) && root.isConnected) replaceHashParams({ q: f.q.trim(), overdue: f.overdue ? 1 : '', flags: f.flags ? 1 : '', focus: '' }); };
  const onSearch = debounce(() => { syncUrl(); draw(); }, 150);
  const open = (id, focus) => { uiPref('dept:hintSeen', true); location.hash = link({ item: id, focus }); };
  root.oninput = e => { if (e.target.id === 'deptQ') { f.q = e.target.value; onSearch(); } };
  root.onchange = null;
  root.onkeydown = e => { if (e.target.id === 'deptQ' && e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; f.q = ''; syncUrl(); draw(); } };
  const det = $('.dp-deleg', root);
  let userToggle = false;
  det.querySelector('summary').addEventListener('click', () => { userToggle = true; });
  det.ontoggle = () => {
    if (!userToggle) return; // sự kiện toggle khi vẽ trang với thuộc tính open
    userToggle = false;
    if (!director && !mineActive.length && !toMeActive.length) uiPref('dept:deleg', det.open ? 'open' : null);
    if (det.open && !current.length) $('[data-testid="delegate-to"]', det)?.focus({ preventScroll: true });
  };
  root.onclick = async e => {
    const acc = e.target.closest('[data-accept]');
    if (acc) { uiPref('dept:hintSeen', true); location.hash = link({ tab: 'PENDING', item: acc.dataset.accept, focus: 'accept' }); return; }
    const fl = e.target.closest('[data-focus]');
    if (fl) { open(fl.closest('[data-open]').dataset.open, fl.dataset.focus); return; }
    const tr = e.target.closest('[data-open]');
    if (tr) { open(tr.dataset.open, tr.dataset.defFocus); return; }
    const t = e.target.closest('[data-tab]');
    if (t) { e.preventDefault(); const u = new URLSearchParams(link({}).split('?')[1]); u.set('tab', t.dataset.tab); location.hash = '#/dept?' + u; return; }
    const chip = e.target.closest('[data-chip]');
    if (chip) { f[chip.dataset.chip] = !f[chip.dataset.chip]; syncUrl(); draw(); return; }
    if (e.target.closest('[data-clear]')) { Object.assign(f, { q: '', overdue: false, flags: false }); const qi = $('#deptQ', root); if (qi) qi.value = ''; syncUrl(); draw(); return; }
    const rv = e.target.closest('[data-revoke]');
    if (rv) { rv.disabled = true; try { await api(`/api/delegations/${rv.dataset.revoke}`, { method: 'DELETE' }); toast('Đã thu hồi uỷ quyền', 'ok'); renderDept(root, liveParams(), setCrumbs); } catch (error) { rv.disabled = false; toast(errorMessage(error), 'err'); } }
  };
  $('#delegForm', root).onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      await api('/api/delegations', { method: 'POST', body: { toUserId: Number(fd.toUserId), startsAt: fromDateInput(fd.startsAt), endsAt: fromDateInput(fd.endsAt), note: fd.note } });
      toast('Đã uỷ quyền', 'ok'); renderDept(root, liveParams(), setCrumbs);
    } catch (error) { toast(errorMessage(error), 'err'); }
  };
}
