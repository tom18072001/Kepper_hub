// Khung giao diện kiểu bộ phần mềm văn phòng (1Office, Base…): thanh đầu trang có tìm nhanh, thông báo, menu tài khoản
// (nút "Ứng dụng" chỉ hiện khi sidebar đã thu gọn hoặc trên điện thoại); sidebar chia nhóm theo nghiệp vụ
// (Trang chủ · Công việc · Dự án · Giao ban · Nghiệp vụ · Thống kê · Quản trị), thu gọn thành dải icon, nhớ theo người dùng.
// Một nguồn khai báo (NAV) cho cả sidebar và bảng "Ứng dụng". Tên trang ở menu trùng tiêu đề trang (PAGE_TITLES).
import { canInstall, promptInstall, onInstallChange } from './pwa.js';
import { store, can, isItAdmin, workScope } from './store.js';
import { $, $$, esc, uiPref, toast } from './util.js';
import { icon } from './icons.js';

const mods = () => store.settings?.modules || [];
// Một tên cho mỗi trang: dùng chung cho menu, tiêu đề tab (document.title), bảng lệnh và tiêu đề trang.
export const PAGE_TITLES = {
  today: 'Trang chủ',
  home: 'Tiến độ dự án',
  my: 'Việc của tôi',
  approvals: 'Chờ tôi duyệt',
  sprint: 'Cập nhật nhanh',
  work: 'Việc toàn đơn vị',
  trash: 'Thùng rác',
  tuan: 'Báo cáo tuần',
  vanthu: 'Văn thư',
  'tai-lieu': 'Tài liệu',
  crm: 'Đối tác',
  hrm: 'Nhân sự',
  dashboard: 'Thống kê công việc',
  kpi: 'KPI & phân tích',
  me: 'Thông tin cá nhân',
  claude: 'Kết nối Claude',
  catalog: 'Danh mục',
};
const T = PAGE_TITLES;
// Nhóm phân hệ: màu ô icon (chỉ dùng cho ô màu và chỉ báo, không tô chữ). Nhóm "Dự án" có thêm danh sách dự án (#projectNav).
const NAV = [
  { id: 'work', name: 'Công việc', color: '#1E8A6E', icon: 'briefcase', items: [
    { href: '#/my', label: T.my, icon: 'target', testid: 'nav-my', desc: 'Việc được giao, ghi chú' },
    { href: '#/approvals', label: T.approvals, icon: 'approve', testid: 'nav-approvals', id: 'navApprovals', badge: 'approvalBadge', desc: 'Duyệt, gia hạn, kiến nghị' },
    { href: '#/sprint', label: T.sprint, icon: 'checklist', testid: 'nav-sprint', desc: 'Kỳ cập nhật tháng: cập nhật % việc tháng này' },
    { href: '#/work', label: T.work, icon: 'users', testid: 'nav-work', id: 'navWork', show: () => ['SYSTEM', 'UNIT'].includes(workScope()), desc: 'Theo người, theo phòng' },
    { href: '#/trash', label: T.trash, icon: 'trash', testid: 'nav-trash', desc: 'Khôi phục việc đã xoá' },
  ] },
  { id: 'projects', name: 'Dự án', color: '#B28A33', icon: 'folder', projects: true, items: [
    { href: '#/home', label: T.home, icon: 'dashboard', testid: 'nav-home', id: 'navHome', desc: 'Tổng các dự án theo Master Timeline' },
  ] },
  { id: 'meeting', name: 'Giao ban', color: '#2E6DB4', icon: 'calendar', items: [
    { href: '#/tuan', label: T.tuan, icon: 'calendar', testid: 'nav-tuan', match: '#/tuan', desc: 'BM-TH-01, tổng hợp giao ban, chấm điểm' },
  ] },
  { id: 'biz', name: 'Nghiệp vụ', color: '#B8641C', icon: 'building', items: [
    // "Tài liệu" (thay mục "Văn thư"): tài liệu dự án (tệp tải lên Hub + thư mục dự án trên NAS); văn thư và quy chế là các tab bên trong.
    { href: '#/tai-lieu', label: T['tai-lieu'], icon: 'file', testid: 'nav-tailieu', id: 'navTailieu', match: '#/tai-lieu|#/vanthu', desc: 'Tài liệu dự án, văn thư, quy chế nội bộ' },
    { href: '#/crm', label: T.crm, icon: 'building', testid: 'nav-crm', id: 'navCrm', match: '#/crm', show: () => mods().includes('crm'), desc: 'Nhà thầu, cơ quan, ngân hàng' },
    { href: '#/hrm', label: T.hrm, icon: 'users', testid: 'nav-hrm', id: 'navHrm', match: '#/hrm', show: () => mods().includes('hrm'), desc: 'Hồ sơ, nghỉ phép, chấm công' },
  ] },
  { id: 'stats', name: 'Thống kê', color: '#2E6DB4', icon: 'chart', items: [
    { href: '#/dashboard', label: T.dashboard, icon: 'chart', testid: 'nav-dashboard', id: 'navDashboard', show: () => can('reports.dashboard'), desc: 'Số việc, thời gian làm, KPI' },
    { href: '#/kpi', label: T.kpi, icon: 'target', testid: 'nav-kpi', show: () => can('reports.kpi'), desc: 'Thời gian xử lý, đánh giá, xu hướng (Ban giám đốc)' },
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
const groupsFor = () => isItAdmin() ? [] : NAV.map(g => ({ ...g, items: g.items.filter(visible) })).filter(g => g.items.length || g.projects);
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
  const addBtn = canNew ? `<button class="icon-btn sb-add" id="newProjectBtn" title="Tạo dự án" aria-label="Tạo dự án" data-testid="new-project">${icon('plus')}</button>` : '';
  const body = g => g.items.map(link).join('') + (g.projects ? '<div id="projectNav" class="sb-projects"></div>' : '');
  const home = isItAdmin() ? '' : `<a href="#/today" class="sb-home" data-testid="nav-today" title="${T.today}">${icon('home')}<span class="t">${T.today}</span></a>`;
  $('#sidebarNav').innerHTML = `${home}<nav id="workNav" aria-label="Điều hướng chính">${groups.map(g => group(g, body(g), g.projects ? addBtn : '')).join('')}</nav>
    ${admin.items.length ? `<nav id="adminNav" aria-label="Quản trị">${group(admin, admin.items.map(link).join(''))}</nav>` : ''}`;
  $('#newProjectBtn')?.addEventListener('click', e => { e.stopPropagation(); onNewProject?.(); });
  renderLauncher(groups.filter(g => g.items.length), admin);
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
    <button type="button" class="menu-item${canInstall() ? '' : ' hidden'}" role="menuitem" id="installApp" data-testid="install-app">${icon('download')}Cài Kepler Hub lên máy</button>
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
  $('#menuBtn').setAttribute('aria-label', $('#menuBtn').title);
  // Bảng "Ứng dụng" chép lại menu trái: chỉ cần khi menu trái đã thu gọn thành dải icon, hoặc trên điện thoại.
  const apps = $('#appsBtn')?.closest('.ab-pop');
  if (apps) {
    const need = c || mobile();
    apps.classList.toggle('hidden', !need);
    if (!need) { $('#appsPanel').classList.add('hidden'); $('#appsBtn').setAttribute('aria-expanded', 'false'); }
  }
}
export function toggleNav() {
  if (mobile()) { const o = !$('#sidebar').classList.contains('open'); $('#sidebar').classList.toggle('open', o); $('#sbScrim').classList.toggle('hidden', !o); }
  else uiPref('nav:collapsed', document.body.classList.contains('nav-collapsed') ? null : true);
  applyCollapsed();
}
export function closeMobileNav() { $('#sidebar').classList.remove('open'); $('#sbScrim').classList.add('hidden'); applyCollapsed(); }
addEventListener('resize', () => { if (!mobile()) closeMobileNav(); else { document.body.classList.remove('nav-collapsed'); applyCollapsed(); } });

export function highlightNav() {
  const hash = location.hash, base = hash.split('?')[0];
  $$('#sidebar a[href]').forEach(a => {
    const href = a.getAttribute('href'), m = a.dataset.match;
    a.classList.toggle('active', hash === href || base === href || (m && m.split('|').some(x => hash.startsWith(x)))
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
export function initShell({ onLogout }) {
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
    if (e.target.closest('#installApp')) promptInstall().then(r => { if (r === 'accepted') toast('Đã cài Kepler Hub — mở từ biểu tượng trên máy'); });
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
  $('#userBtn').setAttribute('aria-label', `Tài khoản: ${me.fullName}`);
  $('#userBtn .who').innerHTML = `<b id="meName">${esc(me.fullName)}</b><span id="meDept">${esc(me.departmentName || (me.isRootAdmin ? 'Quản trị gốc' : ''))}</span>`;
  $('#orgName').textContent = org || '';
  $('#orgName').classList.toggle('hidden', !org);
  document.title = `Kepler Hub${org ? ' · ' + org : ''}`;
}

// Hiện / ẩn "Cài Kepler Hub lên máy" khi trình duyệt cho phép cài (hoặc vừa cài xong).
onInstallChange(() => $('#installApp')?.classList.toggle('hidden', !canInstall()));
