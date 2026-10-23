// Khung giao diện kiểu bộ phần mềm văn phòng (1Office, Base…): thanh đầu trang có "Ứng dụng", tìm nhanh, thông báo, menu tài khoản;
// sidebar chia nhóm theo phân hệ (Tiến độ · Công việc · Nghiệp vụ · Dự án · Quản trị), thu gọn thành dải icon, nhớ theo người dùng.
// Một nguồn khai báo (NAV) cho cả sidebar và bảng "Ứng dụng".
import { store, can, isItAdmin, workScope } from './store.js';
import { $, $$, esc, uiPref } from './util.js';
import { icon } from './icons.js';

const mods = () => store.settings?.modules || [];
// Nhóm phân hệ: màu ô icon (chỉ dùng cho ô màu và chỉ báo, không tô chữ).
const NAV = [
  { id: 'progress', name: 'Tiến độ', color: '#2E6DB4', icon: 'trend', items: [
    { href: '#/home', label: 'Tiến độ dự án', icon: 'dashboard', testid: 'nav-home', id: 'navHome', desc: 'Dashboard các dự án theo MTL' },
    { href: '#/sprint', label: 'Cập nhật nhanh', icon: 'checklist', testid: 'nav-sprint', desc: 'Bấm % việc trong kỳ' },
    { href: '#/tuan', label: 'Báo cáo tuần', icon: 'calendar', testid: 'nav-tuan', match: '#/tuan', desc: 'BM-TH-01, tổng hợp giao ban' },
  ] },
  { id: 'work', name: 'Công việc', color: '#1E8A6E', icon: 'briefcase', items: [
    { href: '#/my', label: 'Việc của tôi', icon: 'target', testid: 'nav-my', desc: 'Việc được giao, ghi chú' },
    { href: '#/approvals', label: 'Chờ tôi duyệt', icon: 'approve', testid: 'nav-approvals', id: 'navApprovals', badge: 'approvalBadge', desc: 'Duyệt, gia hạn, kiến nghị' },
    { href: '#/work', label: 'Tổng thể công việc', icon: 'users', testid: 'nav-work', id: 'navWork', show: () => ['SYSTEM', 'UNIT'].includes(workScope()), desc: 'Theo người, theo phòng' },
    { href: '#/dashboard', label: 'Số liệu công việc', icon: 'chart', testid: 'nav-dashboard', id: 'navDashboard', show: () => can('reports.dashboard'), desc: 'Thống kê, KPI' },
  ] },
  { id: 'biz', name: 'Nghiệp vụ', color: '#B8641C', icon: 'building', items: [
    { href: '#/crm', label: 'Đối tác', icon: 'building', testid: 'nav-crm', id: 'navCrm', match: '#/crm', show: () => mods().includes('crm'), desc: 'Nhà thầu, cơ quan, ngân hàng' },
    { href: '#/hrm', label: 'Nhân sự', icon: 'users', testid: 'nav-hrm', id: 'navHrm', match: '#/hrm', show: () => mods().includes('hrm'), desc: 'Hồ sơ, nghỉ phép, chấm công' },
  ] },
];
const ADMIN = { id: 'admin', name: 'Quản trị', color: '#5B6676', icon: 'shield', items: [
  { href: '#/admin/users', label: 'Tài khoản', icon: 'users', testid: 'nav-admin-users', perm: 'admin.users' },
  { href: '#/admin/departments', label: 'Phòng ban', icon: 'building', testid: 'nav-admin-departments', perm: 'admin.departments' },
  { href: '#/admin/labels', label: 'Nhãn', icon: 'tag', testid: 'nav-admin-labels', perm: 'admin.labels' },
  { href: '#/catalog', label: 'Danh mục', icon: 'list', testid: 'nav-admin-catalog', perm: 'admin.departments' },
  { href: '#/admin/audit', label: 'Nhật ký hệ thống', icon: 'history', testid: 'nav-admin-audit', perm: 'admin.audit' },
  { href: '#/admin/tokens', label: 'Token Claude', icon: 'send', testid: 'nav-admin-tokens', perm: 'admin.users' },
] };

const visible = it => (it.perm ? can(it.perm) : true) && (!it.show || it.show());
const groupsFor = () => isItAdmin() ? [] : NAV.map(g => ({ ...g, items: g.items.filter(visible) })).filter(g => g.items.length);
const adminFor = () => ({ ...ADMIN, items: ADMIN.items.filter(visible) });
const tile = (g, size = '') => `<span class="tile${size}" style="--g:${g.color}">${icon(g.icon)}</span>`;
const open = id => uiPref('nav:g:' + id) !== false;

function link(it) {
  return `<a href="${it.href}" data-testid="${it.testid}"${it.id ? ` id="${it.id}"` : ''}${it.match ? ` data-match="${it.match}"` : ''} title="${esc(it.label)}">
    ${icon(it.icon)}<span class="t">${esc(it.label)}</span>${it.badge ? `<span class="badge hidden" id="${it.badge}"></span>` : ''}</a>`;
}
function group(g, body, extra = '') {
  const on = open(g.id);
  return `<section class="sb-group${on ? '' : ' shut'}" data-group="${g.id}" style="--g:${g.color}">
    <div class="sb-gh"><button type="button" class="sb-gt" aria-expanded="${on}" data-toggle="${g.id}" title="${esc(g.name)}">${tile(g)}<span class="t">${esc(g.name)}</span>
      ${g.id === 'work' ? '<span class="badge hidden" id="moreBadge"></span>' : ''}<span class="chev" aria-hidden="true"></span></button>${extra}</div>
    <div class="sb-items">${body}</div></section>`;
}

export function renderNav({ onNewProject } = {}) {
  const groups = groupsFor(), admin = adminFor();
  const canNew = !isItAdmin() && can('projects.manage', 'operate');
  const projects = isItAdmin() ? '' : group({ id: 'projects', name: 'Dự án', color: '#B28A33', icon: 'folder' }, '<div id="projectNav" class="sb-projects"></div>',
    canNew ? `<button class="icon-btn sb-add" id="newProjectBtn" title="Tạo dự án" aria-label="Tạo dự án" data-testid="new-project">${icon('plus')}</button>` : '');
  const home = isItAdmin() ? '' : `<a href="#/today" class="sb-home" data-testid="nav-today" title="Trang chủ">${icon('home')}<span class="t">Trang chủ</span></a>`;
  $('#sidebarNav').innerHTML = `${home}<nav id="workNav" aria-label="Điều hướng chính">${groups.map(g => group(g, g.items.map(link).join(''))).join('')}</nav>
    ${projects}
    ${admin.items.length ? `<nav id="adminNav" aria-label="Quản trị">${group(admin, admin.items.map(link).join(''))}</nav>` : ''}`;
  $('#newProjectBtn')?.addEventListener('click', e => { e.stopPropagation(); onNewProject?.(); });
  renderLauncher(groups, admin);
  renderUserMenu();
  applyCollapsed();
}

// ---------- Bảng "Ứng dụng" (lưới ô màu theo phân hệ) ----------
function renderLauncher(groups, admin) {
  const tiles = [...groups, ...(admin.items.length ? [admin] : [])].map(g => `<div class="la-group"><div class="la-name">${esc(g.name)}</div><div class="la-grid">
    ${g.items.map(it => `<a href="${it.href}" class="la-app" role="menuitem" data-testid="app-${it.testid}">${tile({ ...g, icon: it.icon }, ' lg')}<span class="la-t">${esc(it.label)}</span>${it.desc ? `<span class="la-d">${esc(it.desc)}</span>` : ''}</a>`).join('')}
  </div></div>`).join('');
  $('#appsPanel').innerHTML = `<div class="la-head">Ứng dụng</div>${isItAdmin() ? '' : `<a href="#/today" class="la-home" role="menuitem" data-testid="app-nav-today">${icon('home')}Trang chủ — việc cần xử lý hôm nay</a>`}${tiles}`;
}

// ---------- Menu tài khoản ----------
function renderUserMenu() {
  const it = isItAdmin();
  $('#userPanel').innerHTML = `<div class="um-head"><b>${esc(store.me.fullName)}</b><span class="muted xs">${esc(store.me.departmentName || (store.me.isRootAdmin ? 'Quản trị gốc' : ''))}${store.me.displayTitle ? ' — ' + esc(store.me.displayTitle) : ''}</span></div>
    <a class="menu-item" role="menuitem" href="#/me" data-testid="nav-me">${icon('users')}Thông tin cá nhân</a>
    ${it ? '' : `<a class="menu-item" role="menuitem" href="#/claude" data-testid="nav-claude">${icon('send')}Kết nối Claude</a>`}
    ${it ? '' : `<a class="menu-item" role="menuitem" href="#/trash" data-testid="nav-trash">${icon('trash')}Thùng rác</a>`}
    <button type="button" class="menu-item" role="menuitem" id="userShortcuts">${icon('settings')}Phím tắt</button>
    <div class="um-sep"></div>
    <button type="button" class="menu-item danger" role="menuitem" id="logoutBtn" data-testid="logout">${icon('logout')}Đăng xuất</button>`;
}

// ---------- Thu gọn sidebar (máy tính) / mở trượt (điện thoại) ----------
const mobile = () => matchMedia('(max-width:900px)').matches;
function applyCollapsed() {
  const c = !mobile() && uiPref('nav:collapsed') === true;
  document.body.classList.toggle('nav-collapsed', c);
  $('#menuBtn').setAttribute('aria-expanded', String(mobile() ? $('#sidebar').classList.contains('open') : !c));
  $('#menuBtn').title = mobile() ? 'Mở menu' : c ? 'Mở rộng menu' : 'Thu gọn menu';
}
export function toggleNav() {
  if (mobile()) { const o = !$('#sidebar').classList.contains('open'); $('#sidebar').classList.toggle('open', o); $('#sbScrim').classList.toggle('hidden', !o); }
  else uiPref('nav:collapsed', document.body.classList.contains('nav-collapsed') ? null : true);
  applyCollapsed();
}
export function closeMobileNav() { $('#sidebar').classList.remove('open'); $('#sbScrim').classList.add('hidden'); applyCollapsed(); }
addEventListener('resize', () => { if (!mobile()) closeMobileNav(); else document.body.classList.remove('nav-collapsed'); });

export function highlightNav() {
  const hash = location.hash, base = hash.split('?')[0];
  $$('#sidebar a[href]').forEach(a => {
    const href = a.getAttribute('href'), m = a.dataset.match;
    a.classList.toggle('active', hash === href || base === href || (m && hash.startsWith(m))
      || (href.startsWith('#/projects/') && (hash.startsWith(href + '/') || hash.startsWith(href + '?'))));
  });
  // Đang ở một trang trong nhóm đã đóng: mở nhóm ra.
  const act = $('#sidebar a.active');
  const g = act?.closest('.sb-group.shut');
  if (g) setGroup(g.dataset.group, true, false);
}
function setGroup(id, on, remember = true) {
  const g = $(`#sidebar .sb-group[data-group="${id}"]`);
  if (!g) return;
  g.classList.toggle('shut', !on);
  g.querySelector('.sb-gt')?.setAttribute('aria-expanded', String(on));
  if (remember) uiPref('nav:g:' + id, on ? null : false);
}

// ---------- Sự kiện (gắn một lần) ----------
export function initShell({ onLogout, onShortcuts }) {
  $('#menuBtn').addEventListener('click', toggleNav);
  $('#sbScrim').addEventListener('click', closeMobileNav);
  $('#sidebar').addEventListener('click', e => {
    const t = e.target.closest('[data-toggle]');
    // Sidebar thu gọn: bấm ô nhóm thì mở rộng sidebar (không gập nhóm).
    if (t) { if (document.body.classList.contains('nav-collapsed')) { toggleNav(); setGroup(t.dataset.toggle, true); return; } return setGroup(t.dataset.toggle, t.getAttribute('aria-expanded') !== 'true'); }
    if (e.target.closest('a')) closeMobileNav();
  });
  const pop = (btn, panel) => {
    $(btn).addEventListener('click', e => {
      e.stopPropagation();
      const show = $(panel).classList.contains('hidden');
      closePops();
      $(panel).classList.toggle('hidden', !show); $(btn).setAttribute('aria-expanded', String(show));
      if (show) $(panel).querySelector('a,button')?.focus();
    });
    $(panel).addEventListener('click', e => { if (e.target.closest('a,button')) closePops(); });
  };
  pop('#appsBtn', '#appsPanel');
  pop('#userBtn', '#userPanel');
  $('#userPanel').addEventListener('click', e => {
    if (e.target.closest('#logoutBtn')) onLogout?.();
    if (e.target.closest('#userShortcuts')) onShortcuts?.();
  });
  document.addEventListener('click', e => { if (!e.target.closest('.ab-pop')) closePops(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const openPanel = ['#appsPanel', '#userPanel'].find(p => !$(p).classList.contains('hidden'));
    if (openPanel) { e.stopImmediatePropagation(); closePops(); $(openPanel === '#appsPanel' ? '#appsBtn' : '#userBtn').focus(); }
  }, true);
}
export function closePops() {
  for (const [b, p] of [['#appsBtn', '#appsPanel'], ['#userBtn', '#userPanel']]) { $(p).classList.add('hidden'); $(b).setAttribute('aria-expanded', 'false'); }
}
// Nhận diện công ty: tên + logo đặt trên máy chạy (ORG_NAME, BRANDING_PATH) — trang đăng nhập và thanh đầu trang.
let brand = { name: '', files: [] };
export async function loadBrand() {
  try { const r = await fetch('/api/brand', { cache: 'no-cache' }); if (r.ok) brand = await r.json(); } catch { /* không có: dùng chữ K */ }
  const card = $('#loginForm');
  if (card && brand.files?.includes('logo.png') && !card.querySelector('.auth-logo')) {
    card.querySelector('.brand-mark')?.replaceWith(Object.assign(document.createElement('img'), { className: 'auth-logo', src: '/branding/logo.png', alt: brand.name || 'Logo' }));
    card.classList.add('branded');
  }
  return brand;
}
export function renderMe() {
  const me = store.me, org = brand.name || store.settings?.orgName;
  const mark = $('.ab-brand .brand-mark');
  if (mark && brand.files?.includes('mark.png')) mark.replaceWith(Object.assign(document.createElement('img'), { className: 'ab-logo', src: '/branding/mark.png', alt: '' }));
  $('#userBtn .who').innerHTML = `<b id="meName">${esc(me.fullName)}</b><span id="meDept">${esc(me.departmentName || (me.isRootAdmin ? 'Quản trị gốc' : ''))}</span>`;
  $('#orgName').textContent = org || '';
  $('#orgName').classList.toggle('hidden', !org);
  document.title = `Kepper Hub${org ? ' · ' + org : ''}`;
}
