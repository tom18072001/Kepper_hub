// Khởi động ứng dụng: đăng nhập, khung giao diện, điều hướng theo hash.
import { api, setToken, getToken, onAuthEvent, lastLocalWrite } from './api.js';
import { store, can, loadBasics, reloadProjects, isItAdmin, workScope } from './store.js';
import { $, $$, esc, toast, closeModal, requestCloseModal, avatar, errorMessage, ago, setPrefUser, clearDrafts } from './util.js';
import { renderProject } from './views/project.js';
import { renderMyWork } from './views/mywork.js';
import { renderApprovals } from './views/approvals.js';
import { renderDashboard } from './views/dashboard.js';
import { renderAdmin } from './views/admin.js';
import { renderProjectSettings, openCreateProject } from './views/settings.js';
import { openItem, closeItem, isItemOpen } from './views/item-panel.js';
import { openPalette, closePalette } from './views/palette.js';
import { renderHome } from './views/home.js';
import { renderTrash } from './views/trash.js';
import { renderCatalog } from './views/catalog.js';
import { renderWork } from './views/work.js';
import { current as projectState, reloadProject } from './views/project.js';
import { reloadOpenItem, openItemId } from './views/item-panel.js';
import { startRealtime, stopRealtime, onRealtime } from './realtime.js';
import { hydrateIcons } from './icons.js';
import { initShortcuts } from './shortcuts.js';

hydrateIcons();
initShortcuts();

function show(id) {
  for (const page of ['loginPage', 'passwordPage', 'appShell']) $('#' + page).classList.toggle('hidden', page !== id);
}
// Hết phiên (401): giữ bản nháp (đã khoá theo người dùng) để đăng nhập lại vẫn còn; tự bấm Đăng xuất thì xoá.
function logout({ keepDrafts = false } = {}) {
  stopRealtime();
  setToken(null); store.me = null; if (keepDrafts !== true) clearDrafts(); closeItem(); lastViewKey = ''; $('#view').innerHTML = ''; show('loginPage'); $('#loginUser').focus();
}

// Cập nhật thời gian thực: tải lại bảng của dự án đang xem và panel đang mở (gộp nhiều sự kiện liên tiếp).
let reloadTimer = null, notifyTimer = null, pendingItems = new Set(), wholeProject = false;
onRealtime((event, data) => {
  // Có thông báo mới (được giao, bị trả lại, có kiến nghị…): gom lại rồi cập nhật số đếm và trang nền (hộp việc, điều hành…) nếu đang rảnh.
  if (event === 'notify') { clearTimeout(notifyTimer); notifyTimer = setTimeout(() => { refreshCounters(); if (!isItemOpen() && $('#modalRoot').classList.contains('hidden')) refreshBackground(); }, 800); return; }
  if (!store.me || !projectState.project || data.projectId !== projectState.project.id) return;
  // Sự kiện do chính mình vừa gây ra: giao diện đã tự tải lại sau thao tác, bỏ qua để không vẽ lại giữa lúc đang kéo/gõ.
  if (data.actorId === store.me.id && Date.now() - lastLocalWrite < 3000) return;
  if (data.itemId) pendingItems.add(data.itemId);
  if (event === 'project' || !data.itemId) wholeProject = true;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    const items = pendingItems, whole = wholeProject || items.size > 20; pendingItems = new Set(); wholeProject = false;
    // Vài việc đổi: chỉ tải lại các việc đó; thao tác hàng loạt: tải lại cả dự án.
    reloadProject({ realtime: true, ids: whole ? null : [...items] });
    if (openItemId() && (items.has(openItemId()) || whole)) reloadOpenItem();
  }, 250);
});
// Vẽ lại trang hiện tại (sau khi dữ liệu thay đổi).
export function rerender() { lastViewKey = ''; return route(); }
onAuthEvent('unauthorized', () => { if (store.me) toast('Phiên đăng nhập đã hết, vui lòng đăng nhập lại', 'err'); logout({ keepDrafts: true }); });
onAuthEvent('mustChangePassword', () => show('passwordPage'));

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#loginError').textContent = '';
  try {
    const { token, user } = await api('/api/auth/login', { method: 'POST', body: { username: $('#loginUser').value, password: $('#loginPass').value } });
    setToken(token); store.me = user; $('#loginPass').value = '';
    await enter();
  } catch (error) { $('#loginError').textContent = errorMessage(error); }
});
$('#passwordForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#pwError').textContent = '';
  if ($('#pwNew').value !== $('#pwConfirm').value) { $('#pwError').textContent = 'Mật khẩu nhập lại không khớp'; return; }
  try {
    const { token } = await api('/api/me/password', { method: 'POST', body: { currentPassword: $('#pwCurrent').value, newPassword: $('#pwNew').value } });
    setToken(token); e.target.reset(); toast('Đã đổi mật khẩu', 'ok');
    await enter();
  } catch (error) { $('#pwError').textContent = errorMessage(error); }
});
$('#pwLogout').addEventListener('click', () => logout());
$('#logoutBtn').addEventListener('click', () => logout());

async function enter() {
  store.me = await api('/api/me');
  setPrefUser(store.me.id);
  if (store.me.mustChangePw) { show('passwordPage'); $('#pwCurrent').focus(); return; }
  await loadBasics();
  show('appShell');
  renderShell();
  // Trang chủ: Dashboard dự án (Master Timeline) cho mọi người dùng nghiệp vụ; admin IT: quản trị.
  const home = isItAdmin() ? '#/admin/users' : '#/home';
  if (!location.hash || location.hash === '#/' || (isItAdmin() && !/^#\/(admin|catalog)/.test(location.hash))) location.hash = home; else route();
  refreshCounters();
  startRealtime();
}


function renderShell() {
  const me = store.me;
  $('#meAvatar').outerHTML = avatar(me).replace('class="avatar"', 'class="avatar" id="meAvatar"');
  $('#meName').textContent = me.fullName;
  $('#meDept').textContent = me.departmentName || (me.isRootAdmin ? 'Quản trị gốc' : '');
  $('#navDashboard').classList.toggle('hidden', !can('reports.dashboard'));
  // Tổng thể công việc (mọi dự án, theo người / phòng): BGĐ và lãnh đạo phòng; cán bộ xem việc mình ở "Việc của tôi".
  $('#navWork').classList.toggle('hidden', !['SYSTEM', 'UNIT'].includes(workScope()));
  // Admin IT: chỉ thấy phần quản trị, không thấy công việc / dự án / báo cáo.
  $('#workNav').classList.toggle('hidden', isItAdmin());
  $('#projectSection').classList.toggle('hidden', isItAdmin());
  $('#paletteBtn').classList.toggle('hidden', isItAdmin());
  let anyAdmin = false;
  for (const a of $$('#adminNav [data-perm]')) { const ok = can(a.dataset.perm); a.classList.toggle('hidden', !ok); anyAdmin ||= ok; }
  $('#adminNav').classList.toggle('hidden', !anyAdmin);
  $('#newProjectBtn').classList.toggle('hidden', !can('projects.manage', 'operate'));
  renderProjectNav();
}
export function renderProjectNav() {
  const byDept = new Map();
  for (const p of store.projects) {
    const name = p.department?.name || '—';
    if (!byDept.has(name)) byDept.set(name, []);
    byDept.get(name).push(p);
  }
  $('#projectNav').innerHTML = [...byDept.entries()].map(([dept, list]) => `<div class="sb-dept">${esc(dept)}</div>` +
    list.map(p => `<a href="#/projects/${p.id}" data-project="${p.id}" data-testid="nav-project-${esc(p.key)}"><span class="key">${esc(p.key)}</span><span>${esc(p.name)}</span></a>`).join('')).join('')
    || '<div class="muted xs" style="padding:6px 10px">Chưa có dự án nào bạn được xem.</div>';
  highlightNav();
}
function highlightNav() {
  const hash = location.hash;
  $$('.sb-nav a, .sb-projects a').forEach(a => {
    const href = a.getAttribute('href');
    a.classList.toggle('active', hash === href || hash.split('?')[0] === href || (href.startsWith('#/projects/') && hash.startsWith(href + '/')) || (href.startsWith('#/projects/') && hash.startsWith(href + '?')));
  });
}

let countersBusy = false;
export async function refreshCounters() {
  if (!store.me || countersBusy) return;
  countersBusy = true;
  try {
    const [notif, counts] = await Promise.all([api('/api/notifications'), api('/api/approvals/counts')]);
    const dot = $('#notifDot');
    dot.textContent = notif.unread > 9 ? '9+' : String(notif.unread);
    dot.classList.toggle('hidden', !notif.unread);
    const badge = $('#approvalBadge');
    badge.textContent = counts.total; badge.classList.toggle('hidden', !counts.total);
    badge.title = `${counts.queue} chờ duyệt · ${counts.extensions} đề nghị gia hạn`;
    store.counts = counts;
    store.notifications = notif;
  } catch { /* bỏ qua lỗi đếm */ } finally { countersBusy = false; }
}
setInterval(() => { if (document.visibilityState === 'visible') refreshCounters(); }, 30_000);

// Thông báo
$('#notifBtn').addEventListener('click', async e => {
  e.stopPropagation();
  const panel = $('#notifPanel');
  if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
  await refreshCounters();
  const { items = [] } = store.notifications || {};
  panel.innerHTML = `<div class="notif-head"><span>Thông báo</span><button class="btn btn-sm btn-ghost" id="readAll">Đánh dấu đã đọc</button></div>` +
    (items.map(n => `<a class="notif-item${n.readAt ? '' : ' unread'}" href="${esc(n.link || '#')}" data-id="${n.id}" data-testid="notif-item"><b>${esc(n.title)}</b>${n.body ? `<div class="muted sm">${esc(n.body)}</div>` : ''}<div class="muted xs">${ago(n.createdAt)}</div></a>`).join('') || '<div class="empty">Chưa có thông báo</div>');
  panel.classList.remove('hidden');
});
$('#notifPanel').addEventListener('click', async e => {
  if (e.target.id === 'readAll') { await api('/api/notifications/read-all', { method: 'POST' }); $('#notifPanel').classList.add('hidden'); refreshCounters(); return; }
  const item = e.target.closest('.notif-item');
  if (item) { $('#notifPanel').classList.add('hidden'); await api(`/api/notifications/${item.dataset.id}/read`, { method: 'POST' }).catch(() => {}); refreshCounters(); }
});
document.addEventListener('click', e => { if (!e.target.closest('.notif')) $('#notifPanel').classList.add('hidden'); });

// Menu di động, tạo dự án, palette
$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#sidebar').addEventListener('click', e => { if (e.target.closest('a')) $('#sidebar').classList.remove('open'); });
$('#newProjectBtn').addEventListener('click', () => openCreateProject(async project => { await reloadProjects(); renderProjectNav(); location.hash = `#/projects/${project.id}`; }));
$('#paletteBtn').addEventListener('click', openPalette);
$('#modalRoot').addEventListener('mousedown', e => { if (e.target.id === 'modalRoot') requestCloseModal(); });
$('#paletteRoot').addEventListener('mousedown', e => { if (e.target.id === 'paletteRoot') closePalette(); });
document.addEventListener('keydown', e => {
  if (!store.me) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  // Esc đóng từng lớp, từ trong ra ngoài: danh sách chọn → rời ô đang gõ → thông báo / bảng lệnh / hộp thoại (hỏi nếu đã nhập) → panel → vạch chọn.
  if (e.key === 'Escape') {
    if (e.isComposing) return;
    // Lớp trên cùng trước: bảng lệnh, rồi trong hộp thoại (nếu đang mở) hoặc trang / panel.
    if (!$('#paletteRoot').classList.contains('hidden')) return closePalette();
    const modalOpen = !$('#modalRoot').classList.contains('hidden');
    const list = (modalOpen ? $('#modal') : document).querySelector('.multi-list:not(.hidden)');
    if (list) { e.preventDefault(); document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); list.closest('.multi')?.querySelector('.multi-btn')?.focus(); return; }
    const menu = !modalOpen && document.querySelector('details.ip-menu[open]');
    if (menu) { e.preventDefault(); menu.open = false; menu.querySelector('summary')?.focus(); return; }
    const active = document.activeElement;
    const typing = active && active !== document.body && active.matches('input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable="true"]');
    if (typing && modalOpen && !$('#modal').dataset.dirty) return closeModal(null);
    if (typing) { active.blur(); return; }
    if (!$('#notifPanel').classList.contains('hidden')) { $('#notifPanel').classList.add('hidden'); $('#notifBtn').focus(); return; }
    if (modalOpen) return requestCloseModal();
    if (isItemOpen()) return closeItem(true);
    const cur = document.querySelector('.kb-cursor'); if (cur) cur.classList.remove('kb-cursor');
  }
});

// Router
let renderToken = 0, lastViewKey = '';
// Vẽ lại trang nền (hộp việc, điều hành, chờ duyệt…) sau thao tác trong panel, không đụng tới panel đang mở.
// Chỉ các trang danh sách; bỏ qua khi người dùng đang gõ hoặc đã nhập dở trong trang (ghi chú, form uỷ quyền, danh mục…).
const LIST_PAGES = ['', 'my', 'ops', 'approvals', 'dept', 'schedule'];
let bgBusy = false;
export async function refreshBackground() {
  if (!store.me || bgBusy) return;
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const page = path.split('/')[0];
  if (!LIST_PAGES.includes(page) || new URLSearchParams(query).get('mode') === 'notes') return;
  const view = $('#view'), active = document.activeElement;
  if (active && view.contains(active) && active.matches('input, textarea, select, [contenteditable="true"]')) return;
  if ([...view.querySelectorAll('form input:not([type=date]):not([type=hidden]), form textarea')].some(el => el.value.trim())) return;
  bgBusy = true;
  try { lastViewKey = ''; await route({ background: true }); } finally { bgBusy = false; }
}
export async function route({ background = false } = {}) {
  if (!store.me) return;
  highlightNav();
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);
  // Chỉ đổi ?item= / ?focus= (mở/đóng panel) thì không vẽ lại cả trang.
  const viewParams = new URLSearchParams(query); viewParams.delete('item'); viewParams.delete('focus'); viewParams.sort();
  const viewKey = path + '?' + viewParams.toString();
  if (viewKey === lastViewKey && $('#view').childElementCount) {
    if (params.get('item')) return openItem(Number(params.get('item')));
    // Đóng panel trên các trang danh sách (không phải bảng dự án): vẽ lại danh sách để phản ánh thay đổi vừa làm.
    const wasOpen = isItemOpen(); closeItem();
    if (wasOpen && parts[0] !== 'projects') { lastViewKey = ''; return route({ background: true }); }
    return;
  }
  lastViewKey = viewKey;
  const view = $('#view');
  // Trang trước có thể đã gán trình xử lý lên #view — gỡ để không chạy nhầm ở trang sau.
  if (!background) { view.onclick = null; view.onchange = null; view.oninput = null; view.onkeydown = null; }
  const token = ++renderToken;
  const setCrumbs = html => { $('#crumbs').innerHTML = html; };
  const syncPanel = () => { if (background) return; if (params.get('item')) openItem(Number(params.get('item'))); else closeItem(); };
  try {
    if (isItAdmin() && !['admin', 'catalog'].includes(parts[0])) { location.hash = '#/admin/users'; return; }
    if (parts[0] === 'projects' && parts[1]) {
      const id = Number(parts[1]);
      if (parts[2] === 'settings') await renderProjectSettings(view, id, setCrumbs);
      else {
        await renderProject(view, id, params, setCrumbs, () => token === renderToken);
        // Bảng lệnh "Tạo việc trong …": mở hộp tạo việc ngay khi vào dự án.
        try { if (sessionStorage.getItem('workhub_create')) { sessionStorage.removeItem('workhub_create'); $('#newItemBtn')?.click(); } } catch { /* bỏ qua */ }
      }
      if (params.get('item')) openItem(Number(params.get('item'))); else closeItem();
    } else if (parts[0] === 'approvals') { await renderApprovals(view, params, setCrumbs); syncPanel(); }
    else if (['requests', 'schedule', 'ops', 'dept', 'summary', 'kpi'].includes(parts[0])) { location.replace('#/home'); return; } // nghiệp vụ NQ57 đã bỏ (Kepper)
    else if (parts[0] === 'home') { await renderHome(view, params, setCrumbs); syncPanel(); }
    else if (parts[0] === 'dashboard') { closeItem(); await renderDashboard(view, params, setCrumbs); }
    else if (parts[0] === 'trash') { closeItem(); await renderTrash(view, setCrumbs); }
    else if (parts[0] === 'catalog') { closeItem(); await renderCatalog(view, setCrumbs); }
    else if (parts[0] === 'work') { await renderWork(view, params, setCrumbs); syncPanel(); }
    else if (parts[0] === 'admin') { closeItem(); await renderAdmin(view, parts[1] || 'users', params, setCrumbs); }
    else { await renderMyWork(view, params, setCrumbs); syncPanel(); }
  } catch (error) {
    if (token !== renderToken) return;
    lastViewKey = '';
    view.innerHTML = `<div class="card empty">${esc(errorMessage(error))}</div>`;
    setCrumbs('Lỗi');
  }
}
window.addEventListener('hashchange', route);
// Tên người / phòng bấm được ở mọi nơi → "Tổng thể công việc" của người / phòng đó (bắt ở pha capture để hàng chứa nó không mở việc).
function goPersonOrDept(e) {
  const el = e.target.closest?.('[data-person],[data-dept-link]');
  if (!el || (e.type === 'keydown' && e.key !== 'Enter')) return;
  e.preventDefault(); e.stopPropagation();
  location.hash = el.dataset.person ? `#/work?user=${el.dataset.person}` : `#/work?dept=${el.dataset.deptLink}`;
}
document.addEventListener('click', goPersonOrDept, true);
document.addEventListener('keydown', goPersonOrDept, true);
// Menu "Khác" ở đầu trang: bấm một mục hoặc bấm ra ngoài thì đóng.
document.addEventListener('click', e => {
  for (const m of document.querySelectorAll('details.ph-more-menu[open]')) if (!m.contains(e.target) || e.target.closest('.menu-item')) m.open = false;
});
// Trang tự ghi bộ lọc lên URL (replaceState): cập nhật khoá trang hiện tại để mở / đóng panel sau đó không vẽ lại cả trang.
window.addEventListener('workhub:hashreplaced', () => {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const p = new URLSearchParams(query); p.delete('item'); p.delete('focus'); p.sort();
  if (lastViewKey) lastViewKey = path + '?' + p.toString();
});

(async function init() {
  if (!getToken()) { show('loginPage'); return; }
  try { await enter(); } catch { logout(); }
})();
