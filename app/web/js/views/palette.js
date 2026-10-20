// Bảng lệnh (Ctrl+K): hành động nhanh, việc mở gần đây, trang, dự án; tìm việc theo mã, tên hoặc số hiệu văn bản (trên máy chủ, trong phạm vi được xem).
// Chế độ "Tạo việc trong…" (openPalette({ mode: 'create' })): chỉ liệt kê dự án người dùng tạo được việc gốc.
// Gần đây: chỉ lưu id việc (và id dự án) theo người dùng; tên việc tải lại qua API mỗi lần mở, nên việc đã mất quyền xem không hiện.
import { api } from '../api.js';
import { store, can, isItAdmin } from '../store.js';
import { $, esc, debounce, uiPref } from '../util.js';
import * as shortcuts from '../shortcuts.js';

const RECENT_MAX = 5;
let mode = 'normal', selected = 0, entries = [], found = [], lastQ = '', seq = 0, searching = false, moved = false;
let recent = [], recentUser = null;
const recentCache = new Map(); // id → { id, code, title, projectId, projectName } — chỉ trong bộ nhớ của phiên

// So khớp không dấu: "tao viec" khớp "Tạo việc"; mọi từ gõ vào đều phải có mặt.
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const matches = (e, q) => !q || fold(q).split(/\s+/).filter(Boolean).every(t => fold(`${e.label} ${e.words || ''}`).includes(t));

const isDirector = () => store.me?.permissions?.['work.approve']?.operate === 'SYSTEM';
const panel = () => { const p = $('#itemPanel'); return p && !p.classList.contains('hidden') ? p : null; };
const projectInView = () => Number((location.hash.match(/^#\/projects\/(\d+)/) || [])[1]) || null;
// Phím G + chữ: đọc từ tooltip menu do shortcuts.js gắn ("Điều hành (G O)") — chỉ hiện gợi ý khi phím thật sự chạy.
const navKeys = testid => (($(`[data-testid="${testid}"]`)?.title || '').match(/\(G ([A-Z])\)\s*$/) || [])[1];
const helpKeys = () => (shortcuts.HELP || []).flatMap(g => g[1] || []).map(([k]) => k);
const hasKey = k => helpKeys().includes(k);
const keysOf = s => (s ? s.split(' ') : []);

// Dự án người dùng tạo được việc gốc (sổ giao việc của đơn vị: chỉ người quản lý sổ / thành viên ghi).
export function canCreateRoot(p) {
  const r = p.rights || {};
  return !!r.canEdit && (p.visibility !== 'ASSIGNED' || !!r.canManage || (!!r.memberRole && r.memberRole !== 'VIEWER'));
}

function pages() {
  if (isItAdmin()) return [
    ...(can('admin.users') ? [{ label: 'Quản trị tài khoản', href: '#/admin/users', nav: 'nav-admin-users' }] : []),
    ...(can('admin.departments') ? [{ label: 'Phòng ban', href: '#/admin/departments', nav: 'nav-admin-departments' }] : []),
    ...(can('admin.audit') ? [{ label: 'Nhật ký hệ thống', href: '#/admin/audit', nav: 'nav-admin-audit' }] : []),
    { label: 'Danh mục', href: '#/catalog', nav: 'nav-catalog' },
  ];
  const ops = can('work.approve', 'operate');
  return [
    ...(ops ? [{ label: 'Tổng quan', href: '#/ops', nav: 'nav-ops', words: 'dieu hanh tong quan cho toi xu ly' }] : []),
    { label: 'Việc của tôi', href: '#/my', nav: 'nav-my' },
    { label: 'Ghi chú của tôi', href: '#/my?mode=notes', keys: hasKey('G N') ? 'G N' : '', words: 'ghi chu ca nhan' },
    { label: 'Chờ tôi xử lý', hint: 'Duyệt, gia hạn, kiến nghị', href: '#/approvals', nav: 'nav-approvals', words: 'duyet gia han kien nghi phieu trinh' },
    ...(ops ? [isDirector()
      ? { label: 'Uỷ quyền', href: '#/dept', nav: 'nav-dept', words: 'uy quyen duyet thay' }
      : { label: 'Việc phòng được giao', href: '#/dept', nav: 'nav-dept', words: 'tiep nhan phan cong uy quyen' }] : []),
    ...(store.projects.some(x => x.visibility === 'ASSIGNED') ? [{ label: 'Sổ giao việc của đơn vị', href: `#/projects/${store.projects.find(x => x.visibility === 'ASSIGNED').id}?view=register`, keys: hasKey('G S') ? 'G S' : '', words: 'so giao viec theo doi' }] : []),
    { label: 'Lịch công tác', hint: 'Lịch tuần Trung tâm, các phòng; ai vắng hôm nay', href: '#/schedule', nav: 'nav-schedule', keys: hasKey('G L') ? 'G L' : '', words: 'lich cong tac tuan vang di cong tac nghi phep hop' },
    ...(can('reports.dashboard') ? [{ label: 'Dashboard', href: '#/dashboard', nav: 'nav-dashboard', words: 'so lieu bao cao tuan' }] : []),
    ...(can('reports.kpi') ? [{ label: 'KPI phòng ban & cá nhân', href: '#/kpi', nav: 'nav-kpi', words: 'kpi diem dung han' }] : []),
    ...(can('reports.summary') ? [{ label: 'Tổng hợp giao việc', href: '#/summary', nav: 'nav-summary', words: 'giao ban thong ke' }] : []),
    { label: 'Thùng rác', href: '#/trash', nav: 'nav-trash', words: 'khoi phuc da xoa' },
    { label: 'Danh mục', href: '#/catalog', nav: 'nav-catalog' },
    ...(can('admin.users') ? [{ label: 'Quản trị tài khoản', href: '#/admin/users', nav: 'nav-admin-users' }] : []),
  ].map(e => ({ ...e, group: 'Trang', key: 'page:' + e.href, keys: e.keys || (e.nav && navKeys(e.nav) ? `G ${navKeys(e.nav)}` : '') }));
}
function projectEntries(q) {
  if (isItAdmin()) return [];
  return store.projects.flatMap(p => [
    { group: 'Dự án', key: 'proj:' + p.id, label: `${p.key} · ${p.name}`, hint: p.department?.name || '', href: `#/projects/${p.id}` },
    ...(q ? [{ group: 'Dự án', key: 'projlist:' + p.id, label: `${p.key} · ${p.name} — Danh sách`, href: `#/projects/${p.id}?view=list`, words: 'danh sach' }] : []),
  ]);
}
const createEntry = (p, here) => ({
  group: mode === 'create' ? 'Tạo việc trong…' : 'Hành động', key: 'create:' + p.id, label: `Tạo việc trong ${p.key} · ${p.name}`, words: 'tao viec moi them',
  hint: here ? 'Dự án đang xem' : '', keys: here ? 'C' : '', href: `#/projects/${p.id}`, run: () => createIn(p),
});
function actions(q) {
  if (isItAdmin()) return [];
  const out = [], p = panel(), code = p?.querySelector('[data-testid="item-code"]')?.textContent.trim();
  if (p && (p.querySelector('[data-act="open-report"]') || p.querySelector('[data-testid="report-open"]'))) {
    out.push({ key: 'act:report', label: `Báo cáo tiến độ${code ? ' cho ' + code : ''}`, words: 'bao cao tien do', keys: 'R', run: () => (p.querySelector('[data-act="open-report"]') || p.querySelector('[data-testid="report-open"]'))?.click() });
  }
  if (p?.querySelector('[data-testid="approval-comment"]')) {
    out.push({ key: 'act:approval', label: `Đi tới khối duyệt${code ? ' của ' + code : ''}`, words: 'duyet y kien phieu trinh', keys: hasKey('V') ? 'V' : '', run: () => { const el = p.querySelector('[data-testid="approval-comment"]'); el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true }); } });
  }
  const creatable = store.projects.filter(canCreateRoot), here = creatable.find(x => x.id === projectInView());
  if (q) out.push(...creatable.map(x => createEntry(x, x === here)));
  else if (creatable.length) {
    if (here) out.push(createEntry(here, true));
    if (!here || creatable.length > 1) out.push({ key: 'act:create', label: here ? 'Tạo việc trong dự án khác…' : 'Tạo việc trong…', words: 'tao viec moi', keys: here ? '' : 'C', keep: true, run: () => setMode('create') });
  }
  out.push({ key: 'act:keys', label: 'Phím tắt', hint: 'Xem và bật / tắt phím tắt', words: 'phim tat ban phim', keys: '?', run: showShortcuts });
  return out.map(e => ({ group: 'Hành động', ...e }));
}

function build() {
  const q = $('#paletteInput').value.trim();
  if (mode === 'create') {
    const here = projectInView();
    const list = store.projects.filter(canCreateRoot).sort((a, b) => (b.id === here) - (a.id === here));
    return list.map(p => createEntry(p, p.id === here)).filter(e => matches(e, q));
  }
  const items = found.map(r => ({ group: 'Việc', key: 'item:' + r.id, label: `${r.code} · ${r.title}`, hint: r.matchedDocument ? `VB ${r.matchedDocument}` : r.projectName, href: `#/projects/${r.projectId}?item=${r.id}` }));
  const rec = q ? [] : recent.map(r => ({ group: 'Mở gần đây', key: 'item:' + r.id, label: `${r.code} · ${r.title}`, hint: r.projectName, href: `#/projects/${r.projectId}?item=${r.id}` }));
  return [...actions(q).filter(e => matches(e, q)), ...rec, ...items, ...pages().filter(e => matches(e, q)), ...projectEntries(q).filter(e => matches(e, q))];
}

const kbd = s => keysOf(s).map(k => `<kbd>${esc(k)}</kbd>`).join('');
function row(e, i) {
  return `<a href="${esc(e.href || '#')}" id="pal-opt-${i}" role="option" aria-selected="${i === selected}" class="${i === selected ? 'sel' : ''}" data-i="${i}" data-testid="palette-entry"${e.keys && !e.keys.includes(' ') ? ` aria-keyshortcuts="${esc(e.keys)}"` : ''}>`
    + `<span class="grow pal-label">${esc(e.label)}</span>${e.hint ? `<span class="muted xs pal-hint">${esc(e.hint)}</span>` : ''}${e.keys ? `<span class="pal-keys" aria-hidden="true">${kbd(e.keys)}</span>` : ''}</a>`;
}
function draw({ keep = false } = {}) {
  const input = $('#paletteInput'), list = $('#paletteList'), q = input.value.trim();
  const prevKey = entries[selected]?.key;
  entries = build().slice(0, 40);
  const at = keep && prevKey ? entries.findIndex(e => e.key === prevKey) : -1;
  selected = at >= 0 ? at : Math.min(keep ? selected : 0, Math.max(0, entries.length - 1));
  let html = '', group = null;
  entries.forEach((e, i) => {
    if (e.group !== group) { if (group !== null) html += '</div>'; group = e.group; html += `<div role="group" aria-label="${esc(group)}"><div class="pal-group" aria-hidden="true">${esc(group)}</div>`; }
    html += row(e, i);
  });
  if (group !== null) html += '</div>';
  const busy = mode === 'normal' && searching && q.length >= 2 ? '<div class="pal-note muted xs" role="status">Đang tìm việc…</div>' : '';
  const empty = mode === 'create'
    ? `<div class="empty">${q ? 'Không có dự án khớp' : 'Bạn chưa tạo được việc trong dự án nào'}</div>`
    : `<div class="empty">${q.length >= 2 && !searching ? `Không tìm thấy “${esc(q)}”. Thử mã việc (TT-12), tên việc hoặc số văn bản.` : 'Gõ mã việc (VD: TT-12), tên việc hoặc số văn bản'}</div>`;
  list.innerHTML = html ? html + busy : busy || empty;
  input.setAttribute('aria-activedescendant', entries.length ? `pal-opt-${selected}` : '');
  list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}
// Đổi dòng đang chọn mà không vẽ lại (di chuột / phím mũi tên): mỗi lúc chỉ một dòng sáng.
function select(i) {
  if (i === selected || i < 0 || i >= entries.length) return;
  const list = $('#paletteList');
  const old = list.querySelector('.sel'); if (old) { old.classList.remove('sel'); old.setAttribute('aria-selected', 'false'); }
  selected = i;
  const el = list.querySelector(`[data-i="${i}"]`);
  if (el) { el.classList.add('sel'); el.setAttribute('aria-selected', 'true'); el.scrollIntoView({ block: 'nearest' }); }
  $('#paletteInput').setAttribute('aria-activedescendant', `pal-opt-${i}`);
}

const search = debounce(async () => {
  const q = $('#paletteInput').value.trim();
  if (mode !== 'normal' || q === lastQ) return;
  lastQ = q;
  const my = ++seq;
  if (q.length < 2) { found = []; searching = false; return draw({ keep: moved }); }
  try { const r = await api('/api/search?q=' + encodeURIComponent(q)); if (my === seq) { found = r; searching = false; draw({ keep: moved }); } } catch { if (my === seq) { searching = false; draw({ keep: moved }); } }
}, 200);

// ---- Mở gần đây ----
function recentList() {
  const v = uiPref('recent');
  return (Array.isArray(v) ? v : []).map(r => (typeof r === 'number' ? { id: r } : r)).filter(r => r && Number.isInteger(Number(r.id)) && Number(r.id) > 0).slice(0, RECENT_MAX);
}
// Panel gọi khi mở một việc. Chỉ lưu id (kèm id dự án nếu có) — không lưu tên hay nội dung việc.
export function rememberRecent(id, projectId) {
  id = Number(id); if (!store.me || !Number.isInteger(id) || id <= 0) return;
  const p = Number(projectId) || Number((location.hash.match(/^#\/projects\/(\d+)/) || [])[1]) || null;
  const list = recentList().filter(r => Number(r.id) !== id);
  uiPref('recent', [p ? { id, p } : { id }, ...list].slice(0, RECENT_MAX));
}
async function loadRecent() {
  if (recentUser !== store.me?.id) { recentCache.clear(); recentUser = store.me?.id; }
  const list = recentList();
  const visible = new Set(store.projects.map(p => p.id));
  const show = () => list.map(r => recentCache.get(Number(r.id))).filter(Boolean);
  recent = show(); // hiện ngay bản đã kiểm tra trong phiên này, rồi kiểm tra lại quyền xem
  if (!list.length || isItAdmin()) { recent = []; return; }
  const byProject = new Map(), loose = [];
  for (const r of list) {
    if (r.p) { if (visible.has(Number(r.p))) byProject.set(Number(r.p), [...(byProject.get(Number(r.p)) || []), Number(r.id)]); }
    else loose.push(Number(r.id));
  }
  const ok = new Map(), dead = new Set(list.map(r => Number(r.id)));
  const keep = (x, pid) => { const p = store.projects.find(y => y.id === pid); ok.set(x.id, { id: x.id, code: x.code, title: x.title, projectId: pid, projectName: p?.name || x.project?.name || '' }); dead.delete(x.id); };
  await Promise.all([
    ...[...byProject].map(async ([pid, ids]) => { try { for (const x of await api(`/api/projects/${pid}/items?ids=${ids.join(',')}`)) keep(x, pid); } catch { /* mất quyền xem dự án */ } }),
    ...loose.map(async id => { try { const x = await api('/api/items/' + id); keep(x, x.project?.id ?? x.projectId); } catch { /* mất quyền / đã xoá */ } }),
  ]);
  recentCache.clear();
  for (const [id, v] of ok) recentCache.set(id, v);
  recent = show();
  // Bỏ việc đã mất quyền / đã xoá; bổ sung id dự án cho mục cũ thiếu.
  const next = list.filter(r => !dead.has(Number(r.id))).map(r => ({ id: Number(r.id), p: ok.get(Number(r.id))?.projectId || r.p || undefined }));
  if (JSON.stringify(next) !== JSON.stringify(list)) uiPref('recent', next);
}

// ---- Hành động ----
function createIn(p) {
  if (projectInView() === p.id) {
    const btn = $('#view #newItemBtn');
    if (btn) { btn.click(); return; }
  }
  try { sessionStorage.setItem('workhub_create', '1'); } catch { /* trình duyệt chặn lưu trữ */ }
  location.hash = `#/projects/${p.id}`;
}
// shortcuts.js nghe sự kiện này để mở màn "Phím tắt".
const showShortcuts = () => window.dispatchEvent(new CustomEvent('workhub:shortcuts'));
function setMode(m) {
  mode = m === 'create' ? 'create' : 'normal';
  const input = $('#paletteInput');
  input.value = ''; lastQ = ''; found = []; searching = false; moved = false; selected = 0;
  input.placeholder = mode === 'create' ? 'Tạo việc trong dự án nào? Gõ mã hoặc tên dự án…' : 'Gõ để tìm dự án, trang hoặc mã việc (VD: KD-12)…';
  input.setAttribute('aria-label', mode === 'create' ? 'Chọn dự án để tạo việc' : 'Tìm nhanh');
  $('#paletteRoot .palette')?.setAttribute('aria-label', mode === 'create' ? 'Tạo việc trong…' : 'Tìm nhanh');
  draw();
  input.focus();
}

export function openPalette(opts) {
  const root = $('#paletteRoot'), input = $('#paletteInput'), list = $('#paletteList');
  root.classList.remove('hidden');
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-controls', 'paletteList'); input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-autocomplete', 'list');
  input.autocomplete = 'off'; input.spellcheck = false;
  list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Kết quả');
  setMode(opts && opts.mode === 'create' ? 'create' : 'normal');
  if (mode === 'normal') loadRecent().then(() => { if (!root.classList.contains('hidden') && mode === 'normal' && !input.value.trim()) draw({ keep: moved }); });
}
export function closePalette() { $('#paletteRoot').classList.add('hidden'); seq++; searching = false; }
function go(entry) {
  if (!entry) return;
  if (entry.keep) return entry.run();
  closePalette();
  if (entry.run) return entry.run();
  location.hash = entry.href;
}
$('#paletteInput').addEventListener('input', () => {
  selected = 0; moved = false;
  const q = $('#paletteInput').value.trim();
  if (mode === 'normal') { if (q.length < 2) found = []; searching = q.length >= 2 && q !== lastQ; search(); }
  draw();
});
$('#paletteInput').addEventListener('keydown', e => {
  if (e.isComposing) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); moved = true;
    if (entries.length) select((selected + (e.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length);
  } else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); moved = true; select(0); }
  else if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); moved = true; select(entries.length - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); go(entries[selected]); }
  else if (e.key === 'Backspace' && mode === 'create' && !e.target.value) { e.preventDefault(); setMode('normal'); loadRecent().then(() => { if (mode === 'normal' && !$('#paletteInput').value.trim()) draw({ keep: moved }); }); }
});
// Di chuột đổi dòng đang chọn (dùng chung trạng thái với phím mũi tên) — không còn hai dòng cùng sáng.
$('#paletteList').addEventListener('mousemove', e => { const a = e.target.closest('[data-i]'); if (a) { moved = true; select(Number(a.dataset.i)); } });
$('#paletteList').addEventListener('mousedown', e => { if (e.target.closest('[data-i]')) e.preventDefault(); }); // giữ tiêu điểm ở ô gõ
$('#paletteList').addEventListener('click', e => { const a = e.target.closest('[data-i]'); if (a) { e.preventDefault(); go(entries[Number(a.dataset.i)]); } });
