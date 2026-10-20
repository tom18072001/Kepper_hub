// Trang dự án: Bảng Kanban, Sổ giao việc, Danh sách, Lịch, Tiến độ kế hoạch + một hệ lọc dùng chung cho mọi kiểu xem:
// ô tìm, chip nhanh, "Thêm bộ lọc", chip đang áp, đếm kết quả, lưu trên URL, nhớ bộ lọc cuối theo người, bộ lọc đã lưu.
import { api, download, ApiError } from '../api.js';
import { store, can, labelsFor, createProjectLabel, deptName, userById } from '../store.js';
import { scheduleFields, bindSchedule, readSchedule } from './recurring-form.js';
import { drawRegister, openPlanImport, openRegisterImport, exportRegister, REG_DL, registerFull, setRegisterFull } from './register.js';
import { $, $$, esc, avatars, labelChip, prioChip, stateChip, fmtDate, dueClass, PRIORITY, toast, openModal, closeModal, multiSelect, readMulti, bindMulti, formData, fromDateInput, confirmDialog, errorMessage, dateInput, deadlineStatus, uiPref, replaceHashParams, debounce } from '../util.js';
import { icon } from '../icons.js';
import { refreshCounters } from '../main.js';
import { drawCycles, drawIntake, currentCycle } from './project-extra.js';
import { isLive } from '../realtime.js';
import { drawGantt } from './gantt.js';
import { stagePill } from './dispatch-panel.js';
import { calendarHtml, calState, bindCalendar } from './calendar-view.js';
import { drawMtlOverview, drawMtlPlan, mtlActions, bindMtlActions, invalidateMtl } from './mtl.js';

const VIEWS = [['board', 'Bảng'], ['register', 'Sổ giao việc'], ['list', 'Danh sách'], ['calendar', 'Lịch'], ['timeline', 'Tiến độ kế hoạch'], ['cycles', 'Chu kỳ'], ['intake', 'Tiếp nhận']];
// Dự án theo Master Timeline: Tổng quan (Dashboard) + Kế hoạch & Gantt đứng đầu; Kanban / danh sách / lịch để cowork theo hạng mục.
const MTL_VIEWS = [['mtl', 'Tổng quan dự án'], ['plan', 'Kế hoạch & Gantt'], ['board', 'Bảng'], ['list', 'Danh sách'], ['calendar', 'Lịch']];
const VIEW_LABEL = Object.fromEntries(VIEWS);
const ITEM_VIEWS = ['board', 'register', 'list', 'calendar', 'timeline'];
// Khoá bộ lọc → tham số URL. Chỉ id và mã (riêng q là từ khoá tìm); không chứa nội dung việc.
const PARAMS = { q: 'q', mine: 'mine', dl: 'dl', assignee: 'assignee', dept: 'dept', type: 'type', stage: 'stage', priority: 'prio', label: 'label', cycle: 'cycle', source: 'source', plan: 'plan', assigner: 'by' };
const KEYS = Object.keys(PARAMS);
const KEY_OF = Object.fromEntries(Object.entries(PARAMS).map(([k, p]) => [p, k]));
const FACETS = ['assignee', 'dept', 'type', 'stage', 'priority', 'label', 'cycle', 'source', 'plan', 'assigner']; // nằm trong "Thêm bộ lọc"
const EMPTY_FILTERS = () => Object.fromEntries(KEYS.map(k => [k, '']));
const LANES = ['none', 'assignee', 'priority'];
const STAGES = { PENDING_ACCEPT: 'Chờ phòng tiếp nhận', TODO: 'Chưa bắt đầu', DOING: 'Đang thực hiện', RETURNED: 'Bị trả lại', WAIT_DEPT: 'Chờ phòng duyệt', WAIT_BGD: 'Chờ BGĐ cho ý kiến', WAIT_APPROVAL: 'Chờ duyệt', DONE: 'Hoàn thành', CANCELLED: 'Huỷ' };
const ATTENTION = ['PENDING_ACCEPT', 'RETURNED', 'WAIT_DEPT', 'WAIT_BGD']; // khâu cần chú ý: hiện trên thẻ và danh sách
const DL_LABEL = Object.fromEntries(REG_DL.filter(([k]) => k));
const TYPE_LABEL = { PLAN: 'Kế hoạch năm', ADHOC: 'Đột xuất' };
// Biểu tượng nét 1.75 cùng bộ với icons.js.
const svg = d => `<svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const I_FILTER = svg('<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>');
const I_VIEW = svg('<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>');
const I_SAVED = svg('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>');

export const current = { project: null, items: [], cycles: [], views: [], plans: [], filters: EMPTY_FILTERS(), order: [], saved: null, restored: false, lanes: 'none', root: null, params: null, sort: { key: 'position', dir: 1 } };

function openItemHrefFor(id) {
  const [path, query = ''] = location.hash.split('?');
  const params = new URLSearchParams(query); params.set('item', id);
  return path + '?' + params.toString();
}
export function openItemHash(id) { location.hash = openItemHrefFor(id); }
function setParam(key, value) {
  const [path, query = ''] = location.hash.split('?');
  const params = new URLSearchParams(query);
  if (value == null || value === '') params.delete(key); else params.set(key, value);
  params.delete('item');
  location.hash = path + (params.toString() ? '?' + params.toString() : '');
}
// Phần URL quyết định trang nền (bỏ item/focus của panel). Bộ lọc ghi bằng replaceState nên router không biết:
// lần mở việc kế tiếp sẽ đổi URL "khác" — nhận ra đúng URL mình vừa ghi thì không vẽ lại cả trang.
const hashKey = () => { const [path, query = ''] = location.hash.split('?'); const p = new URLSearchParams(query); p.delete('item'); p.delete('focus'); return path + '?' + p.toString(); };
let writtenKey = '';
const isAssigned = () => current.project?.visibility === 'ASSIGNED';
const personWord = () => (isAssigned() ? 'Người chủ trì' : 'Người nhận');
const prefKey = what => `proj:${current.project.id}:${what}`;
const viewOf = () => $('#viewBody', current.root)?.dataset.view || 'board';

export async function renderProject(root, id, params, setCrumbs, stillCurrent) {
  if (params.get('item') && current.project?.id === id && current.root === root && $('#viewBody', root) && hashKey() === writtenKey) { current.params = params; return; }
  const [project, itemsRes, cycles, views, plans] = await Promise.all([api(`/api/projects/${id}`), api(`/api/projects/${id}/items`, { raw: true }), api(`/api/projects/${id}/cycles`), api(`/api/projects/${id}/views`), api(`/api/projects/${id}/plans`)]);
  const items = await itemsRes.json();
  current.totalCount = Number(itemsRes.headers.get('x-total-count')) || null;
  if (!stillCurrent()) return;
  closePop(false);
  Object.assign(current, { project, items, cycles, views, plans, root, params });
  const fromUrl = readFilters(params);
  if (fromUrl) persist(); // mở từ liên kết cũng là "bộ lọc cuối" của tôi trong dự án này
  const showIntake = false; // "Gửi yêu cầu / Tiếp nhận" đã bỏ khỏi giao diện (GĐ3f)
  // Bảng toàn cột tự do (lịch tuần, theo chủ đề…): bỏ các kiểu xem theo quy trình / sổ giao việc.
  const freeBoard = project.visibility !== 'ASSIGNED' && project.states.every(s => s.category === 'OTHER');
  const mtl = project.kind === 'MTL';
  const tabs = mtl ? MTL_VIEWS : VIEWS.filter(([k]) => (k !== 'intake' || showIntake) && k !== 'register' && !(freeBoard && ['timeline', 'cycles'].includes(k)));
  const view = tabs.some(([k]) => k === params.get('view')) ? params.get('view') : mtl ? 'mtl' : 'board';
  const itemView = ITEM_VIEWS.includes(view);
  setCrumbs(`<span class="muted">${esc(project.department.name)} /</span> ${esc(project.name)} <span class="code">${esc(project.key)}</span>`);
  const r = project.rights;
  const canCreate = r.canEdit && (project.visibility !== 'ASSIGNED' || r.canManage || r.memberRole);
  const steps = project.approvalSteps.map(s => s.name).join(' → ');
  root.innerHTML = `<div class="proj">
    <div class="page-head">
      <div class="ph-title"><h1>${esc(project.name)}</h1><span class="live hidden" id="liveDot" title="Đang cập nhật trực tiếp">Trực tiếp</span></div>
      <div class="ph-actions">
        ${(() => { const items = `${r.canManage ? `<a class="menu-item" href="#/projects/${id}/settings" data-testid="project-settings" title="Cài đặt dự án">${icon('settings')}<span>Cài đặt</span></a>` : ''}
        ${mtl ? mtlActions(project) : ''}
        ${canCreate && !mtl ? `<button class="menu-item" id="importBtn" data-testid="import-excel" title="Nhập danh sách việc từ Excel">${icon('upload')}<span>Nhập</span></button>` : ''}`.trim(); return items ? `<details class="ph-more-menu"><summary class="btn btn-ghost" data-testid="ph-more" aria-label="Thao tác khác" title="Giao nhiều việc, nhập / xuất Excel, cài đặt">${icon('menu')}<span class="t">Khác</span></summary><div class="ph-menu" role="menu">${items}</div></details>` : ''; })()}
        ${canCreate ? `<button class="btn btn-primary" id="newItemBtn" data-testid="new-item" title="Tạo việc (C)" aria-keyshortcuts="C">${icon('plus')}Tạo việc</button>` : ''}
      </div>
    </div>
    ${project.description ? `<div class="ph-desc-wrap"><p class="ph-desc clamp1" id="phDesc">${esc(project.description)}</p><button type="button" class="fx-link ph-more hidden" data-fx="desc" aria-expanded="false" aria-controls="phDesc">Xem thêm</button></div>` : ''}
    <div class="viewbar">
      <div class="tabs" role="tablist" aria-label="Kiểu xem">${tabs.map(([k, label]) => `<a href="${tabHref(k)}" class="${k === view ? 'active' : ''}" role="tab" aria-selected="${k === view}" data-view-tab="${k}" data-testid="view-${k}">${label}</a>`).join('')}</div>
      ${steps ? `<span class="flow" title="Quy trình duyệt: ${esc(steps)}">${icon('approve')}<b>Duyệt ${project.approvalSteps.length} cấp</b> <span class="flow-steps">${esc(steps)}</span></span>` : ''}
    </div>
    ${itemView ? filterBar(view) : ''}
    <div id="viewBody" data-view="${view}"></div>
  </div>`;
  $('#liveDot', root).classList.toggle('hidden', !isLive());
  const desc = $('#phDesc', root);
  if (desc && desc.scrollHeight > desc.clientHeight + 1) $('.ph-more', root).classList.remove('hidden');
  bindPage($('.proj', root));
  $('#newItemBtn', root)?.addEventListener('click', () => openCreateItem());
  $('#bulkDispatchBtn', root)?.addEventListener('click', () => openBulkDispatch());
  $('#exportBtn', root)?.addEventListener('click', () => exportRegister(project));
  $('#importBtn', root)?.addEventListener('click', openImportChooser);
  if (mtl) bindMtlActions($('.proj', root), project, () => reloadProject());
  // Bộ lọc lấy từ bộ nhớ / mặc định / bộ lọc đã lưu: ghi lên URL để sao chép, tải lại vẫn giữ.
  if (itemView) writeUrl(); else writtenKey = hashKey();
  drawBody();
}

// URL có tham số lọc → dùng URL. Không có → bộ lọc cuối của tôi trong dự án (trừ ô tìm) → bộ lọc mặc định của tôi.
function readFilters(params) {
  const f = EMPTY_FILTERS(), order = [];
  for (const [p, v] of params) { const k = Object.hasOwn(KEY_OF, p) ? KEY_OF[p] : null; if (k && v && !order.includes(k)) { f[k] = v.slice(0, 100); order.push(k); } }
  let saved = Number(params.get('saved')) || null, restored = false, linked = null;
  const fromUrl = order.length > 0;
  const take = src => { for (const k of KEYS) if (k !== 'q' && src?.[k] != null && src[k] !== '') { f[k] = String(src[k]).slice(0, 100); order.push(k); } };
  if (!fromUrl) {
    linked = (saved && current.views.find(v => v.id === saved)) || null;
    const memory = uiPref(prefKey('filters'));
    const def = current.views.find(v => v.id === uiPref(prefKey('default')));
    if (linked) { take(linked.filters); if (linked.filters?.q) { f.q = String(linked.filters.q); order.push('q'); } }
    else if (memory && typeof memory === 'object' && Object.keys(memory).length) { take(memory); saved = current.views.some(v => v.id === memory.saved) ? memory.saved : null; restored = order.length > 0; }
    else if (def) { take(def.filters); saved = def.id; }
    else saved = null;
  }
  try { const q = sessionStorage.getItem('workhub_search'); if (q) { f.q = q.slice(0, 100); if (!order.includes('q')) order.push('q'); sessionStorage.removeItem('workhub_search'); } } catch { /* bỏ qua */ }
  if (saved && !current.views.some(v => v.id === saved)) saved = null; // bộ lọc riêng của người khác, hoặc đã xoá
  const lanes = [params.get('lanes'), linked?.filters?.lanes, uiPref(prefKey('lanes'))].find(v => LANES.includes(v)) || 'none';
  Object.assign(current, { filters: f, order, saved, restored, lanes });
  return fromUrl;
}
function filterParams(view) {
  const out = { view };
  for (const k of KEYS) if (current.filters[k]) out[PARAMS[k]] = current.filters[k];
  if (current.lanes !== 'none') out.lanes = current.lanes;
  if (current.saved) out.saved = current.saved;
  return out;
}
function tabHref(view) { return `#/projects/${current.project.id}?${new URLSearchParams(filterParams(view))}`; }
// Tab kiểu xem mang theo bộ lọc hiện tại (kể cả từ khoá).
function syncTabs() { $$('[data-view-tab]', current.root).forEach(a => { a.href = tabHref(a.dataset.viewTab); }); }
function writeUrl() {
  // Hẹn giờ ghi URL có thể chạy sau khi người dùng đã sang trang khác: chỉ ghi khi vẫn đang ở đúng dự án.
  if (!current.root?.isConnected || !new RegExp(`^#/projects/${current.project.id}(\\?|$)`).test(location.hash)) return;
  const upd = {}; for (const k of KEYS) upd[PARAMS[k]] = current.filters[k] || null;
  Object.assign(upd, { lanes: current.lanes !== 'none' ? current.lanes : null, saved: current.saved || null });
  replaceHashParams(upd);
  writtenKey = hashKey();
  syncTabs();
}
const writeUrlSoon = debounce(writeUrl, 300);
// Bộ nhớ theo người, theo dự án: chỉ id / mã của bộ lọc và chia làn — không lưu từ khoá tìm.
function persist() {
  const keep = {};
  for (const k of KEYS) if (k !== 'q' && current.filters[k]) keep[k] = current.filters[k];
  if (current.saved && Object.keys(keep).length) keep.saved = current.saved;
  uiPref(prefKey('filters'), Object.keys(keep).length ? keep : null);
  uiPref(prefKey('lanes'), current.lanes !== 'none' ? current.lanes : null);
}
function changed({ url = true } = {}) {
  current.restored = false;
  persist();
  if (url) writeUrl(); else { syncTabs(); writeUrlSoon(); }
  drawBody(); // vẽ lại cả thanh lọc (đếm, chip đang áp)
}
function setFilter(key, value) {
  value = value == null ? '' : String(value);
  if (current.filters[key] === value) return;
  current.filters[key] = value;
  current.order = current.order.filter(k => k !== key);
  if (value) current.order.push(key);
  changed({ url: key !== 'q' });
}
function clearFilters() {
  Object.assign(current, { filters: EMPTY_FILTERS(), order: [], saved: null });
  changed();
}
const isActive = () => KEYS.some(k => current.filters[k]);

// ---------- Lọc ----------
const soonDays = () => store.settings?.dueSoonDays ?? 3;
const dlCache = new WeakMap();
function dlOf(i) {
  let s = dlCache.get(i);
  if (!s) { s = deadlineStatus({ ...i, state: current.project.states.find(x => x.id === i.stateId) }, soonDays()); dlCache.set(i, s); }
  return s;
}
// "Của tôi": việc tôi chủ trì, phối hợp hoặc là người giao.
const isMine = i => i.assignees.some(a => a.id === store.me.id) || (i.supporters || []).some(a => a.id === store.me.id) || i.assignedById === store.me.id;
// Trong một lượt vẽ (drawBody), thanh lọc, bộ đếm và bảng cùng gọi filtered() nhiều lần: tính một lần cho mỗi bộ "skip".
let passCache = null;
function filtered(skip = []) {
  if (!passCache) return filterItems(skip);
  const key = skip.join(',');
  if (!passCache.has(key)) passCache.set(key, filterItems(skip));
  return passCache.get(key).slice();
}
function filterItems(skip) {
  const f = { ...current.filters }; for (const k of skip) f[k] = '';
  const q = f.q.trim().toLowerCase(), person = v => (v === 'me' ? store.me.id : Number(v));
  const cycleId = f.cycle === 'current' ? (currentCycle(current.cycles)?.id ?? -1) : f.cycle === 'none' ? null : f.cycle ? Number(f.cycle) : undefined;
  return current.items.filter(i =>
    (cycleId === undefined || (i.cycleId ?? null) === cycleId)
    && (!q || i.title.toLowerCase().includes(q) || i.code.toLowerCase().includes(q) || (i.refCode || '').toLowerCase().includes(q) || (i.excerpt || '').toLowerCase().includes(q))
    && (!f.mine || isMine(i))
    && (!f.dl || dlOf(i).code === f.dl)
    && (!f.assignee || (f.assignee === 'none' ? !i.assignees.length : i.assignees.some(a => a.id === person(f.assignee))))
    && (!f.dept || String(i.leadDepartmentId ?? '') === f.dept)
    && (!f.type || i.taskType === f.type)
    && (!f.stage || i.stage?.code === f.stage)
    && (!f.priority || i.priority === f.priority)
    && (!f.label || i.labels.some(l => l.id === Number(f.label)))
    && (!f.source || (i.source || '') === f.source)
    && (!f.plan || String(i.planId ?? '') === f.plan)
    && (!f.assigner || i.assignedById === person(f.assigner)));
}

// Tên và lựa chọn của từng bộ lọc trong "Thêm bộ lọc".
function facetLabel(k) {
  return { assignee: personWord(), dept: 'Phòng chủ trì', type: 'Loại nhiệm vụ', stage: 'Khâu', priority: 'Ưu tiên', label: 'Nhãn', cycle: 'Chu kỳ', source: 'Nguồn giao việc', plan: 'Kế hoạch', assigner: 'Người giao', dl: 'Hạn', mine: 'Của tôi', q: 'Từ khoá' }[k];
}
const byName = (a, b) => a[1].localeCompare(b[1], 'vi');
function peopleOpts(ids) { return [...new Set(ids)].map(id => [String(id), userById(id)?.fullName]).filter(o => o[1]).sort(byName); }
function facetOptions(k) {
  const { items, project } = current;
  if (k === 'assignee') {
    const members = new Set(project.members.map(m => m.userId));
    const ids = [...store.users.filter(u => members.has(u.id) || u.departmentId === project.departmentId).map(u => u.id), ...items.flatMap(i => i.assignees.map(a => a.id))];
    return [['me', 'Tôi'], ['none', 'Chưa giao'], ...peopleOpts(ids).filter(o => o[0] !== String(store.me.id))];
  }
  if (k === 'assigner') return [['me', 'Tôi'], ...peopleOpts(items.map(i => i.assignedById).filter(Boolean)).filter(o => o[0] !== String(store.me.id))];
  if (k === 'dept') return [...new Set(items.map(i => i.leadDepartmentId).filter(Boolean))].map(id => [String(id), deptName(id)]).sort(byName);
  if (k === 'type') return Object.entries(TYPE_LABEL);
  if (k === 'stage') { const has = new Set(items.map(i => i.stage?.code)); return Object.entries(STAGES).filter(([c]) => has.has(c)); }
  if (k === 'priority') return Object.entries(PRIORITY).map(([c, p]) => [c, c === 'NONE' ? 'Chưa đặt' : p.label]);
  if (k === 'label') return labelsFor(project.id).map(l => [String(l.id), l.name]);
  if (k === 'cycle') return [['current', 'Chu kỳ hiện tại'], ['none', 'Không thuộc chu kỳ'], ...current.cycles.map(c => [String(c.id), c.name])];
  if (k === 'source') return [...new Set([...(store.settings?.sources || []), ...items.map(i => i.source).filter(Boolean)])].map(s => [s, s]);
  if (k === 'plan') return (current.plans || []).map(p => [String(p.id), p.name]);
  return [];
}
function facetVisible(k) {
  const { items, project } = current, a = isAssigned();
  if (current.filters[k]) return true;
  return { assignee: true, priority: true, dept: a, type: a || items.some(i => i.taskType === 'PLAN'), stage: a || project.approvalSteps.length > 0 || items.some(i => i.dispatchStatus),
    label: labelsFor(project.id).length > 0, cycle: current.cycles.length > 0, source: a || items.some(i => i.source), plan: (current.plans || []).length > 0, assigner: a || items.some(i => i.assignedById) }[k];
}
function valueLabel(k, v) {
  if (k === 'dl') return DL_LABEL[v] || v;
  if (k === 'q') return `“${v}”`;
  if (k === 'mine') return 'Của tôi';
  const o = facetOptions(k).find(x => x[0] === v);
  if (o) return o[1];
  if (k === 'assignee' || k === 'assigner') return userById(v)?.fullName || 'Người dùng #' + v;
  if (k === 'dept') return deptName(v);
  return v;
}
// Mô tả ngắn của một bộ lọc đang áp, dùng cho chip, trạng thái trống và hộp lưu.
const describe = k => (k === 'mine' ? 'Của tôi' : k === 'dl' ? DL_LABEL[current.filters.dl] || current.filters.dl : k === 'q' ? `từ khoá “${current.filters.q}”` : `${facetLabel(k)}: ${valueLabel(k, current.filters[k])}`);
const activeKeys = () => [...current.order.filter(k => current.filters[k]), ...KEYS.filter(k => current.filters[k] && !current.order.includes(k))];
// Bộ lọc không có nút riêng ngoài thanh (chip nhanh, ô tìm) thì hiện thành chip đang áp.
function appliedKeys(view) {
  const quickDl = view === 'register' || ['OVERDUE', 'DUE_SOON'].includes(current.filters.dl);
  return activeKeys().filter(k => FACETS.includes(k) || (k === 'dl' && !quickDl));
}

// ---------- Thanh lọc ----------
function filterBar(view) {
  return `<div class="filters fx" id="filters" role="search" aria-label="Lọc việc trong dự án">
    <div class="fx-main">
      <label class="search-field">${icon('search')}<input type="search" id="fQ" placeholder="Tìm tiêu đề, mã…" aria-label="Tìm trong dự án" aria-keyshortcuts="F" value="${esc(current.filters.q)}" autocomplete="off" data-testid="filter-q"></label>
      <div class="chips fx-quick${view === 'register' ? ' wide' : ''}" id="fxQuick" role="group" aria-label="Lọc nhanh"></div>
      <div class="fx-pop-wrap fx-desk">
        <button type="button" class="btn btn-ghost btn-sm fx-btn" id="fxMoreBtn" data-pop="fxMore" aria-expanded="false" aria-controls="fxMore" data-testid="filter-more">${I_FILTER}<span id="fxMoreLabel">Thêm bộ lọc</span></button>
        <div class="fx-pop" id="fxMore" role="dialog" aria-label="Thêm bộ lọc" hidden></div>
      </div>
      <span class="fx-count fx-desk" id="fxCount" role="status" data-testid="filter-count"></span>
      <div class="fx-pop-wrap fx-desk">
        <button type="button" class="btn btn-ghost btn-sm fx-btn" id="fxSavedBtn" data-pop="fxSaved" aria-haspopup="menu" aria-expanded="false" aria-controls="fxSaved" data-testid="saved-views"></button>
        <div class="fx-pop fx-right fx-menu" id="fxSaved" role="menu" aria-label="Bộ lọc đã lưu" hidden></div>
      </div>
      ${['board', 'register', 'list'].includes(view) ? `<div class="fx-pop-wrap fx-desk">
        <button type="button" class="btn btn-ghost btn-sm fx-btn" id="fxDisplayBtn" data-pop="fxDisplay" aria-expanded="false" aria-controls="fxDisplay" data-testid="display-menu">${I_VIEW}Hiển thị</button>
        <div class="fx-pop fx-right" id="fxDisplay" role="dialog" aria-label="Hiển thị" hidden>${displayHtml(view, true)}</div>
      </div>` : ''}
      <button type="button" class="btn btn-ghost btn-sm fx-btn fx-mob" id="fxSheetBtn" data-fx="sheet" aria-haspopup="dialog" data-testid="filter-sheet">${I_FILTER}<span id="fxSheetLabel">Lọc</span></button>
    </div>
    <div class="fx-applied" id="fxApplied" hidden></div>
  </div>`;
}
function quickHtml(view) {
  const f = current.filters, base = filtered(['dl']);
  const n = Object.fromEntries(REG_DL.map(([k]) => [k, k ? 0 : base.length]));
  for (const i of base) { const c = dlOf(i).code; if (c in n) n[c]++; }
  const mine = filtered(['mine']).filter(isMine).length;
  const chip = (attr, on, label, count, cls, testid) => `<button type="button" class="chip${on ? ' on' : ''}${cls}" data-quick-f="${attr}" aria-pressed="${on}" data-testid="${testid}">${esc(label)} <b${count ? '' : ' class="zero"'}>${count}</b></button>`;
  const head = chip('mine', !!f.mine, 'Của tôi', mine, '', 'filter-mine');
  if (view === 'register') return head + '<span class="fx-sep" aria-hidden="true"></span>' + REG_DL.map(([k, label]) => chip('dl:' + k, f.dl === k, label, n[k], ` chip-${k || 'ALL'}`, `reg-filter-${k || 'ALL'}`)).join('');
  return head + ['OVERDUE', 'DUE_SOON'].map(k => chip('dl:' + k, f.dl === k, DL_LABEL[k], n[k], ` chip-${k}`, `filter-dl-${k}`)).join('');
}
function appliedHtml(view) {
  const keys = appliedKeys(view);
  if (!keys.length && !current.restored) return '';
  return `${current.restored ? '<span class="fx-note">Bộ lọc lần trước</span>' : ''}
    ${keys.map(k => `<button type="button" class="fx-chip" data-fx-clear="${k}" aria-label="Bỏ lọc ${esc(describe(k))}"><span>${esc(k === 'dl' ? 'Hạn' : facetLabel(k))}:</span> <b>${esc(k === 'dl' ? describe(k) : valueLabel(k, current.filters[k]))}</b>${icon('x')}</button>`).join('')}
    <button type="button" class="fx-link" data-fx="clear" data-testid="filter-clear">Xoá lọc</button>`;
}
// Ô chọn của từng bộ lọc. withIds: bản trong thanh (giữ id / data-testid cũ); bản trong tấm lọc di động không có id.
const FACET_IDS = { assignee: ' id="fAssignee" data-testid="filter-assignee"', cycle: ' id="fCycle" data-testid="filter-cycle"', label: ' id="fLabel" data-testid="filter-label"', priority: ' id="fPriority" data-testid="filter-priority"',
  dept: ' id="regDept" data-testid="reg-dept"', type: ' id="regType" data-testid="reg-type"', plan: ' id="regPlan" data-testid="filter-plan"', stage: ' data-testid="filter-stage"', source: ' data-testid="filter-source"', assigner: ' data-testid="filter-assigner"' };
function facetGrid(withIds) {
  return FACETS.filter(facetVisible).map(k => {
    const v = current.filters[k], opts = facetOptions(k);
    if (v && !opts.some(o => o[0] === v)) opts.push([v, valueLabel(k, v)]);
    return `<label class="field fx-field">${esc(facetLabel(k))}<select data-facet="${k}"${withIds ? FACET_IDS[k] : ''}${v ? ' class="set"' : ''}><option value="">Tất cả</option>${opts.map(([val, lab]) => `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select></label>`;
  }).join('');
}
function moreHtml() {
  return `<div class="fx-grid">${facetGrid(true)}</div>
    <div class="fx-pop-foot">${FACETS.some(k => current.filters[k]) ? '<button type="button" class="fx-link" data-fx="clear-facets">Bỏ các bộ lọc này</button>' : ''}<span class="grow"></span><button type="button" class="btn btn-ghost btn-sm" data-pop-close>Xong</button></div>`;
}
const SORT_OPTS = () => [['position', 'Theo cột trạng thái'], ['code', 'Mã'], ['title', 'Tiêu đề'], ['state', 'Trạng thái'], ['priority', 'Ưu tiên'], ['assignee', personWord()], ['due', 'Hạn']];
function displayHtml(view, withIds) {
  if (view === 'board') return `<label class="field fx-field">Chia làn<select data-display="lanes"${withIds ? ' id="fLanes" data-testid="filter-lanes"' : ''}>${[['none', 'Không chia làn'], ['assignee', 'Theo ' + personWord().toLowerCase()], ['priority', 'Theo ưu tiên']].map(([k, l]) => `<option value="${k}"${current.lanes === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
  if (view === 'register') return `<label class="check sm fx-check"><input type="checkbox" data-display="full"${withIds ? ' id="regFull" data-testid="reg-full"' : ''}${registerFull() ? ' checked' : ''}> Hiện đủ cột</label><p class="muted xs fx-hint">Thêm Sản phẩm đã có, Kết quả / khó khăn, Đánh giá, Ghi chú.</p>`;
  if (view === 'list') return `<label class="field fx-field">Sắp xếp<select data-display="sort"${withIds ? ' id="fSort"' : ''}>${SORT_OPTS().map(([k, l]) => `<option value="${k}"${current.sort.key === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <label class="check sm fx-check"><input type="checkbox" data-display="desc"${current.sort.dir < 0 ? ' checked' : ''}> Giảm dần</label>`;
  return '';
}
const savedView = () => current.views.find(v => v.id === current.saved) || null;
// Bộ lọc đang khác bộ lọc đã lưu (so với những gì máy chủ đã lưu).
function savedDirty(v) {
  const vf = v.filters || {};
  return KEYS.some(k => (current.filters[k] || '') !== String(vf[k] ?? '')) || current.lanes !== (vf.lanes || 'none');
}
function savedBtnHtml() {
  const v = savedView();
  if (!v) return `${I_SAVED}<span>Bộ lọc</span>${icon('down', 'chev')}`;
  const dirty = savedDirty(v);
  return `${I_SAVED}<span class="fx-saved-name">${esc(v.name)}</span>${dirty ? '<span class="fx-dot" title="Đã thay đổi so với bộ lọc đã lưu"></span><span class="sr-only">(đã thay đổi)</span>' : ''}${icon('down', 'chev')}`;
}
function savedMenuHtml() {
  const def = uiPref(prefKey('default'));
  const mine = current.views.filter(v => v.mine), shared = current.views.filter(v => !v.mine);
  const item = v => `<button type="button" role="menuitemradio" aria-checked="${current.saved === v.id}" data-fx-saved="${v.id}"><span class="fx-mi-name">${esc(v.name)}</span>${v.id === def ? '<span class="pill">mặc định</span>' : ''}${v.mine && v.shared ? '<span class="pill">chung</span>' : ''}<span class="fx-mi-view">${esc(VIEW_LABEL[v.view] || '')}</span></button>`;
  return `${mine.length ? `<div class="fx-menu-h" role="presentation">Của tôi</div>${mine.map(item).join('')}` : ''}
    ${shared.length ? `<div class="fx-menu-h" role="presentation">Chung</div>${shared.map(item).join('')}` : ''}
    ${current.views.length ? '' : '<p class="fx-menu-empty" role="presentation">Chưa có bộ lọc đã lưu. Chọn bộ lọc rồi lưu lại để dùng lần sau.</p>'}
    <div class="fx-menu-sep" role="separator"></div>
    <button type="button" role="menuitem" data-fx="save" data-testid="save-view">Lưu bộ lọc hiện tại…</button>
    ${current.saved ? `<button type="button" role="menuitem" data-fx="default">${def === current.saved ? 'Bỏ mặc định của tôi' : 'Đặt làm mặc định của tôi'}</button>` : ''}
    ${mine.length ? '<button type="button" role="menuitem" data-fx="manage">Quản lý…</button>' : ''}`;
}
// Vẽ lại phần động của thanh lọc (giữ tiêu điểm nếu đang ở một chip).
function syncControls() {
  const bar = $('#filters', current.root);
  if (!bar) return;
  const view = viewOf(), act = document.activeElement;
  // Chip đang có tiêu điểm sẽ được vẽ lại: nhớ để trả tiêu điểm về đúng chip (hoặc chip kế bên nếu nó vừa bị bỏ).
  const had = act && bar.contains(act) && (act.dataset.quickF ? `[data-quick-f="${act.dataset.quickF}"]` : act.dataset.fxClear || act.dataset.fx === 'clear' ? '[data-fx-clear]' : '');
  const q = $('#fQ', bar); if (q && document.activeElement !== q && q.value !== current.filters.q) q.value = current.filters.q;
  $('#fxQuick', bar).innerHTML = quickHtml(view);
  const applied = appliedHtml(view), ap = $('#fxApplied', bar);
  ap.innerHTML = applied; ap.hidden = !applied;
  const n = FACETS.filter(k => current.filters[k]).length, hidden = appliedKeys(view).length;
  $('#fxMoreLabel', bar).textContent = n ? `Thêm bộ lọc · ${n}` : 'Thêm bộ lọc';
  $('#fxMoreBtn', bar).classList.toggle('on', n > 0);
  $('#fxSheetLabel', bar).textContent = hidden ? `Lọc (${hidden})` : 'Lọc';
  $('#fxSheetBtn', bar).classList.toggle('on', hidden > 0);
  $('#fxCount', bar).textContent = isActive() ? `${filtered().length}/${current.items.length} việc` : `${current.items.length} việc`;
  $('#fxSavedBtn', bar).innerHTML = savedBtnHtml();
  for (const sel of $$('[data-facet]', bar)) { sel.value = current.filters[sel.dataset.facet]; sel.classList.toggle('set', !!sel.value); }
  if (had && !bar.contains(document.activeElement)) [$(had, bar), $('#fxMoreBtn', bar), $('#fxSheetBtn', bar), $('#fQ', bar)].find(el => el?.getClientRects().length)?.focus();
}

// ---------- Popover (Thêm bộ lọc, Bộ lọc đã lưu, Hiển thị) ----------
let openPop = null;
function togglePop(btn) {
  const id = btn.dataset.pop;
  if (openPop?.id === id) return closePop(true);
  closePop(false);
  const pop = $('#' + id, current.root);
  if (!pop) return;
  if (id === 'fxMore') pop.innerHTML = moreHtml();
  if (id === 'fxSaved') pop.innerHTML = savedMenuHtml();
  pop.style.left = ''; pop.style.right = '';
  pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
  openPop = { id, pop, btn };
  // Giữ trong màn hình.
  const r = pop.getBoundingClientRect(), pad = 12;
  if (r.right > innerWidth - pad) pop.style.left = `${Math.round(innerWidth - pad - r.width - btn.parentElement.getBoundingClientRect().left)}px`;
  else if (r.left < pad) { pop.style.right = 'auto'; pop.style.left = `${Math.round(pad - btn.parentElement.getBoundingClientRect().left)}px`; }
  $('select, input, [role^=menuitem]', pop)?.focus();
}
function closePop(returnFocus) {
  if (!openPop) return;
  const { pop, btn } = openPop;
  openPop = null;
  pop.hidden = true; btn.setAttribute('aria-expanded', 'false');
  if (returnFocus && document.body.contains(btn)) btn.focus();
}
document.addEventListener('mousedown', e => { if (openPop && !openPop.pop.contains(e.target) && !openPop.btn.contains(e.target)) closePop(false); });
// Esc đóng popover trước mọi lớp khác (chạy ở pha bắt, trước main.js).
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !openPop || e.isComposing) return;
  if (!$('#modalRoot').classList.contains('hidden') || !$('#paletteRoot').classList.contains('hidden')) return; // hộp thoại / bảng lệnh ở trên
  if (!document.body.contains(openPop.pop)) { openPop = null; return; }
  e.preventDefault(); e.stopPropagation(); closePop(true);
}, true);

function bindPage(page) {
  // Ô tìm: chờ ngừng gõ một chút và không lọc giữa lúc bộ gõ tiếng Việt đang ghép chữ.
  const searchSoon = debounce(v => setFilter('q', v), 150);
  page.addEventListener('input', e => { if (e.target.id === 'fQ' && !e.isComposing) searchSoon(e.target.value); });
  page.addEventListener('compositionend', e => { if (e.target.id === 'fQ') searchSoon(e.target.value); });
  page.addEventListener('change', e => {
    const facet = e.target.dataset.facet; if (facet) return setFilter(facet, e.target.value);
    if (e.target.dataset.display) return setDisplay(e.target.dataset.display, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
  });
  page.addEventListener('click', e => {
    const t = e.target.closest('button, a'); if (!t || !page.contains(t)) return;
    if (t.dataset.pop) return togglePop(t);
    if (t.hasAttribute('data-pop-close')) return closePop(true);
    if (t.dataset.quickF) {
      const [k, v = ''] = t.dataset.quickF.split(':');
      if (k === 'mine') return setFilter('mine', current.filters.mine ? '' : '1');
      return setFilter('dl', viewOf() === 'register' ? v : current.filters.dl === v ? '' : v);
    }
    if (t.dataset.fxClear) { const inBody = t.closest('#viewBody'); setFilter(t.dataset.fxClear, ''); if (inBody) focusAfterEmpty(); return; }
    if (t.dataset.fxSaved) return applySavedView(t.dataset.fxSaved);
    const act = t.dataset.fx;
    if (act === 'clear') { const inBody = t.closest('#viewBody'); clearFilters(); if (inBody) focusAfterEmpty(); return; }
    if (act === 'clear-facets') {
      for (const k of FACETS) current.filters[k] = '';
      current.order = current.order.filter(k => !FACETS.includes(k));
      changed();
      if (openPop?.id === 'fxMore') { openPop.pop.innerHTML = moreHtml(); $('select', openPop.pop)?.focus(); }
      return;
    }
    if (act === 'save') { closePop(false); return saveViewDialog(viewOf()); }
    if (act === 'manage') { closePop(false); return manageViews(); }
    if (act === 'default') { const on = uiPref(prefKey('default')) === current.saved; uiPref(prefKey('default'), on ? null : current.saved); closePop(true); return toast(on ? 'Đã bỏ bộ lọc mặc định' : `Đã đặt "${savedView()?.name}" làm bộ lọc mặc định của bạn`, 'ok'); }
    if (act === 'sheet') return openSheet(t);
    if (act === 'desc') { const d = $('#phDesc', current.root), open = d.classList.toggle('clamp1'); t.textContent = open ? 'Xem thêm' : 'Thu gọn'; t.setAttribute('aria-expanded', String(!open)); }
  });
  page.addEventListener('focusout', e => { if (openPop && e.relatedTarget && !openPop.pop.contains(e.relatedTarget) && !openPop.btn.contains(e.relatedTarget)) closePop(false); });
  page.addEventListener('keydown', e => {
    // Menu bộ lọc đã lưu: mũi tên lên / xuống.
    const menu = e.target.closest('[role=menu]'); if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = $$('[role^=menuitem]', menu), i = items.indexOf(e.target);
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  });
}
function focusAfterEmpty() { ($('#viewBody .kcard, #viewBody tr[data-id], #viewBody .cal-item', current.root) || $('#fQ', current.root))?.focus(); }
function setDisplay(what, value) {
  if (what === 'lanes') { current.lanes = LANES.includes(value) ? value : 'none'; persist(); writeUrl(); return drawBody(); }
  if (what === 'full') { setRegisterFull(!!value); return drawBody(); }
  if (what === 'sort') { current.sort = { key: value, dir: current.sort.dir }; return drawBody(); }
  if (what === 'desc') { current.sort = { key: current.sort.key, dir: value ? -1 : 1 }; return drawBody(); }
}

// Di động: tấm lọc từ đáy màn hình (dùng hộp thoại chung).
function openSheet(btn) {
  const view = viewOf();
  const savedList = () => current.views.map(v => `<button type="button" class="chip${current.saved === v.id ? ' on' : ''}" data-fx-saved="${v.id}" aria-pressed="${current.saved === v.id}">${esc(v.name)}</button>`).join('') || '<p class="muted xs">Chưa có bộ lọc đã lưu.</p>';
  const modal = openModal(`<div class="sheet-head"><h2 id="sheetTitle">Bộ lọc</h2><button type="button" class="icon-btn" data-close aria-label="Đóng">${icon('x')}</button></div>
    <div class="fx-grid" id="sheetGrid">${facetGrid(false)}</div>
    ${['board', 'register', 'list'].includes(view) ? `<h3 class="sheet-h">Hiển thị</h3><div class="sheet-display">${displayHtml(view, false)}</div>` : ''}
    <h3 class="sheet-h">Bộ lọc đã lưu</h3><div class="chips sheet-saved" id="sheetSaved">${savedList()}</div>
    <button type="button" class="fx-link" data-fx="save">Lưu bộ lọc hiện tại…</button>
    <div class="sheet-foot"><button type="button" class="btn btn-ghost" data-fx="clear">Xoá lọc</button><button type="button" class="btn btn-primary grow" data-close id="sheetGo"></button></div>`);
  modal.classList.add('sheet');
  modal.setAttribute('aria-labelledby', 'sheetTitle');
  modal.addEventListener('input', () => { modal.dataset.dirty = ''; }); // đổi bộ lọc áp ngay, không phải "nội dung đã nhập"
  // Đóng bằng Esc / bấm ra nền: trả tiêu điểm về nút "Lọc".
  const root = $('#modalRoot'), watch = new MutationObserver(() => {
    if (!root.classList.contains('hidden')) return;
    watch.disconnect();
    if ((document.activeElement === document.body || !document.activeElement) && document.body.contains(btn)) btn.focus();
  });
  watch.observe(root, { attributes: true, attributeFilter: ['class'] });
  const refresh = () => {
    $('#sheetGo', modal).textContent = `Xem ${filtered().length} việc`;
    for (const sel of $$('[data-facet]', modal)) { sel.value = current.filters[sel.dataset.facet]; sel.classList.toggle('set', !!sel.value); }
    $('#sheetSaved', modal).innerHTML = savedList();
  };
  refresh();
  modal.onchange = e => {
    const facet = e.target.dataset.facet;
    if (facet) setFilter(facet, e.target.value);
    else if (e.target.dataset.display) setDisplay(e.target.dataset.display, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
    refresh();
  };
  modal.onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-close')) { closeModal(); btn.focus(); return; }
    if (t.dataset.fx === 'clear') { clearFilters(); refresh(); return; }
    if (t.dataset.fx === 'save') return saveViewDialog(view);
    if (t.dataset.fxSaved) { closeModal(); applySavedView(t.dataset.fxSaved); }
  };
}

// ---------- Bộ lọc đã lưu ----------
function applySavedView(id) {
  const v = current.views.find(x => String(x.id) === String(id));
  if (!v) return;
  closePop(false);
  const f = EMPTY_FILTERS(), order = [];
  for (const k of KEYS) if (v.filters?.[k] != null && v.filters[k] !== '') { f[k] = String(v.filters[k]); order.push(k); }
  Object.assign(current, { filters: f, order, saved: v.id, restored: false, lanes: LANES.includes(v.filters?.lanes) ? v.filters.lanes : 'none' });
  persist();
  if (ITEM_VIEWS.includes(v.view) && v.view !== viewOf()) location.hash = tabHref(v.view); // kiểu xem của bộ lọc: vẽ lại trang
  else { writeUrl(); drawBody(); }
  toast(`Đã áp dụng bộ lọc "${v.name}"`);
}
function saveViewDialog(view) {
  const desc = activeKeys().map(describe);
  const modal = openModal(`<h2>Lưu bộ lọc</h2><form><label class="field">Tên bộ lọc<input name="name" required maxlength="60" autofocus data-testid="view-name"></label>
    ${current.project.rights.canEdit ? '<label class="check"><input type="checkbox" name="shared" data-testid="view-shared"> Chia sẻ cho mọi người trong dự án</label>' : ''}
    <p class="muted sm">Lưu kiểu xem <b>${esc(VIEW_LABEL[view] || view)}</b>${desc.length ? ' với: ' + esc(desc.join(', ')) : ' (chưa áp bộ lọc nào)'}${view === 'board' && current.lanes !== 'none' ? ', chia làn' : ''}.</p>
    <p class="error" id="viewError"></p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="view-save">Lưu</button></div></form>`);
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const filters = { lanes: current.lanes };
    for (const k of KEYS) if (current.filters[k]) filters[k] = current.filters[k];
    try {
      const saved = await api(`/api/projects/${current.project.id}/views`, { method: 'POST', body: { name: e.target.name.value, view, shared: !!e.target.shared?.checked, filters } });
      current.views = [...current.views, saved].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      current.saved = saved.id;
      closeModal();
      // Máy chủ chỉ giữ các bộ lọc nó biết: nói rõ phần chưa lưu được thay vì âm thầm bỏ.
      const lost = KEYS.filter(k => current.filters[k] && String(saved.filters?.[k] ?? '') !== current.filters[k]);
      toast(lost.length ? `Đã lưu bộ lọc. Chưa lưu được: ${lost.map(facetLabel).join(', ')}` : 'Đã lưu bộ lọc', lost.length ? '' : 'ok');
      persist(); writeUrl(); syncControls();
    } catch (error) { $('#viewError', modal).textContent = errorMessage(error); }
  };
}
function manageViews() {
  const mine = current.views.filter(v => v.mine);
  const modal = openModal(`<h2>Bộ lọc của tôi</h2>${mine.map(v => `<div class="row" style="margin-bottom:6px"><span class="grow">${esc(v.name)}${v.shared ? ' <span class="pill">chung</span>' : ''} <span class="muted xs">${esc(VIEW_LABEL[v.view] || '')}</span></span><button class="btn btn-ghost btn-sm" data-del="${v.id}">Xoá</button></div>`).join('')}
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Đóng</button></div>`);
  modal.onclick = async e => {
    if (e.target.closest('[data-close]')) return closeModal();
    const del = e.target.closest('[data-del]');
    if (!del) return;
    try {
      await api(`/api/views/${del.dataset.del}`, { method: 'DELETE' });
      const id = Number(del.dataset.del);
      current.views = current.views.filter(v => v.id !== id);
      if (current.saved === id) current.saved = null;
      if (uiPref(prefKey('default')) === id) uiPref(prefKey('default'), null);
      del.parentElement.remove();
      persist(); writeUrl(); syncControls();
    } catch (error) { toast(errorMessage(error), 'err'); }
  };
}

function emptyHtml() {
  const keys = activeKeys(), last = keys[keys.length - 1];
  return `<div class="card fx-empty" role="status" data-testid="filter-empty"><p>Không có việc nào khớp <b>${esc(keys.map(describe).join(' + '))}</b>.</p>
    <div class="row">${keys.length > 1 ? `<button type="button" class="btn btn-primary btn-sm" data-fx-clear="${last}">Bỏ “${esc(describe(last))}”</button><button type="button" class="btn btn-ghost btn-sm" data-fx="clear">Xoá lọc</button>` : '<button type="button" class="btn btn-primary btn-sm" data-fx="clear">Xoá lọc</button>'}</div></div>`;
}

// Cập nhật thời gian thực không vẽ lại bảng khi người dùng đang thêm nhanh hoặc kéo thẻ; vẽ lại ngay khi họ xong.
let deferredReload = false;
let pressingCard = false;
function userBusy() {
  const r = current.root;
  return pressingCard || !!(r && (r.querySelector('[data-testid="quick-input"]:not(:disabled)') || r.querySelector('.kcard.dragging')));
}
// Đang giữ chuột trên một thẻ (sắp kéo) cũng tính là đang thao tác.
document.addEventListener('mouseup', () => { if (pressingCard) { pressingCard = false; if (deferredReload) setTimeout(() => { if (!userBusy() && deferredReload) reloadProject(); }, 50); } });
function finishInteraction() { if (deferredReload) reloadProject(); else drawBody(); }

export function assignableUsers(project) {
  const ids = new Set(project.members.map(m => m.userId));
  return store.users.filter(u => u.role !== 'admin' && (ids.has(u.id) || u.departmentId === project.departmentId || ['PUBLIC', 'ASSIGNED'].includes(project.visibility)));
}

export async function reloadProject({ realtime = false, ids = null } = {}) {
  if (!current.project || !document.body.contains(current.root) || !location.hash.startsWith(`#/projects/${current.project.id}`) || location.hash.includes('/settings')) return;
  if (realtime && userBusy()) { deferredReload = true; return; }
  deferredReload = false;
  invalidateMtl();
  const id = current.project.id;
  if (ids?.length) {
    // Cập nhật thời gian thực vài việc: tải đúng các việc đó, thay vào danh sách (việc đã xoá / không còn được xem thì bỏ ra).
    const rows = await api(`/api/projects/${id}/items?ids=${ids.join(',')}`);
    if (current.project?.id !== id) return;
    current.items = [...current.items.filter(i => !ids.includes(i.id)), ...rows].sort((a, b) => a.position - b.position || a.id - b.id);
  } else {
    const [res, cycles, plans] = await Promise.all([api(`/api/projects/${id}/items`, { raw: true }), api(`/api/projects/${id}/cycles`), api(`/api/projects/${id}/plans`)]);
    const items = await res.json();
    if (current.project?.id !== id) return;
    Object.assign(current, { items, cycles, plans, totalCount: Number(res.headers.get('x-total-count')) || null });
  }
  // Người dùng bắt đầu thao tác trong lúc đang tải: giữ dữ liệu mới, vẽ lại khi họ xong.
  if (userBusy()) { deferredReload = true; return; }
  drawBody();
}

function drawBody() {
  passCache = new Map();
  try { drawBodyPass(); } finally { passCache = null; }
}
function drawBodyPass() {
  const body = $('#viewBody', current.root);
  if (!body) return;
  const view = body.dataset.view;
  if (ITEM_VIEWS.includes(view)) {
    syncControls();
    if (isActive() && !filtered().length) { body.innerHTML = emptyHtml(); return; }
  }
  if (view === 'mtl' || view === 'plan') {
    const p = view === 'mtl' ? drawMtlOverview(body, current.project) : drawMtlPlan(body, current.project, current.params || new URLSearchParams(location.hash.split('?')[1] || ''));
    p.catch(error => { body.innerHTML = `<div class="card empty">${esc(errorMessage(error))}</div>`; });
    return;
  }
  if (view === 'list') drawList(body);
  else if (view === 'register') drawRegister(body, current, { filtered, openItemHash, reload: reloadProject });
  else if (view === 'cycles') drawCycles(body, current, { openItemHash, reload: reloadProject });
  else if (view === 'intake') drawIntake(body, current, { reload: reloadProject });
  else if (view === 'calendar') drawCalendar(body);
  else if (view === 'timeline') drawGantt(body, { items: filtered(), project: current.project, openItemHash, deptName });
  else drawBoard(body);
  // Sổ quá lớn: máy chủ chỉ gửi phần đầu — nói rõ thay vì âm thầm thiếu việc.
  body.querySelector('.trunc-note')?.remove();
  if (current.totalCount && current.totalCount > current.items.length) body.insertAdjacentHTML('afterbegin', `<p class="muted sm trunc-note" role="status">Đang hiện ${current.items.length}/${current.totalCount} việc. Dùng bộ lọc hoặc ô tìm để thu hẹp.</p>`);
}

// Khâu cần chú ý (chờ phòng tiếp nhận, bị trả lại, chờ phòng duyệt, chờ BGĐ) và phiếu duyệt đang chờ.
// Việc giao về phòng: chip khâu (kèm bước duyệt); việc Kanban thường giữ chip "Chờ duyệt n/m".
function stageBits(i) {
  const st = i.stage, attn = !!st && ATTENTION.includes(st.code), dispatched = isAssigned() || !!i.dispatchStatus;
  const p = i.pendingApproval;
  if (p) return dispatched && attn ? stagePill({ ...st, label: `${st.label} ${p.currentLevel}/${p.totalLevels}` }, 'approval-chip') : `<span class="pill approval-chip" data-testid="approval-chip">Chờ duyệt ${p.currentLevel}/${p.totalLevels}</span>`;
  return attn && (dispatched || st.code === 'RETURNED') ? stagePill(st) : '';
}

// ---------- Bảng Kanban ----------
function cardHtml(i) {
  const c = i.counts, dc = dueClass(i);
  return `<article class="kcard" draggable="${current.project.rights.canEdit}" data-id="${i.id}" data-testid="card-${esc(i.code)}" tabindex="0" aria-label="${esc(i.code + ' ' + i.title)}">
    <div class="top"><span class="code">${esc(i.code)}</span>${prioChip(i.priority)}</div>
    <div class="title">${esc(i.title)}</div>
    ${i.labels.length ? `<div class="labels">${i.labels.map(labelChip).join('')}</div>` : ''}
    <div class="meta">
      ${stageBits(i)}
      ${i.dueDate ? `<span class="due ${dc}" title="Hạn">${icon('clock')}${fmtDate(i.dueDate)}</span>` : ''}
      ${i.progress && i.progress < 100 ? `<span title="Tiến độ" class="card-progress"><span class="bar-mini"><i style="width:${i.progress}%"></i></span>${i.progress}%</span>` : ''}
      ${c.checklistTotal ? `<span title="Checklist" data-meta="checklist">${icon('checklist')}${c.checklistDone}/${c.checklistTotal}</span>` : ''}
      ${c.comments ? `<span title="Bình luận" data-meta="comments">${icon('comment')}${c.comments}</span>` : ''}${c.attachments ? `<span title="Tệp đính kèm" data-meta="attachments">${icon('clip')}${c.attachments}</span>` : ''}
      <span class="push">${avatars(i.assignees)}</span>
    </div></article>`;
}
function lanesOf(items) {
  if (current.lanes === 'assignee') {
    const map = new Map([[0, { key: 0, title: 'Chưa giao', items: [] }]]);
    for (const i of items) for (const a of (i.assignees.length ? i.assignees : [{ id: 0 }])) {
      if (!map.has(a.id)) map.set(a.id, { key: a.id, title: a.fullName, items: [] });
      map.get(a.id).items.push(i);
    }
    return [...map.values()].filter(l => l.items.length);
  }
  if (current.lanes === 'priority') return Object.entries(PRIORITY).map(([k, v]) => ({ key: k, title: v.label, items: items.filter(i => i.priority === k) })).filter(l => l.items.length);
  return [{ key: 'all', title: '', items }];
}
function drawBoard(body) {
  const { project } = current, items = filtered();
  const totals = Object.fromEntries(project.states.map(s => [s.id, current.items.filter(i => i.stateId === s.id).length]));
  const lanes = lanesOf(items);
  body.innerHTML = lanes.map(lane => `${lane.title ? `<div class="lane-title">${esc(lane.title)} · ${lane.items.length}</div>` : ''}
    <div class="board" data-lane="${esc(lane.key)}">${project.states.map(s => {
      const list = lane.items.filter(i => i.stateId === s.id).sort((a, b) => a.position - b.position);
      const over = s.wipLimit && totals[s.id] >= s.wipLimit;
      return `<section class="column${over ? ' over-wip' : ''}${list.length ? '' : ' is-empty'}" data-state="${s.id}" data-testid="column-${esc(s.name)}" aria-label="${esc(s.name)}">
        <div class="col-head"><span class="state-dot" style="background:${esc(s.color)}"></span>${esc(s.name)} <span class="count" data-testid="count-${esc(s.name)}">${list.length}</span>
          ${s.wipLimit ? `<span class="wip" title="Giới hạn WIP">${totals[s.id]}/${s.wipLimit}</span>` : ''}</div>
        <div class="col-body" data-state="${s.id}">${list.map(cardHtml).join('')}</div>
        ${project.rights.canEdit && lane.key === 'all' && !['REVIEW', 'COMPLETED'].includes(s.category) ? `<div class="quick-add"><button data-quick="${s.id}" data-testid="quick-add-${esc(s.name)}">${icon('plus')}Thêm việc</button></div>` : ''}
      </section>`;
    }).join('')}</div>`).join('') || '<div class="card empty">Dự án chưa có việc nào.</div>';
  bindBoard(body);
}
let dragId = null, marker = null;
function bindBoard(body) {
  body.onclick = e => {
    const quick = e.target.closest('[data-quick]');
    if (quick) return showQuickAdd(quick);
    const card = e.target.closest('.kcard');
    if (card) openItemHash(card.dataset.id);
  };
  body.onkeydown = e => { const card = e.target.closest('.kcard'); if (card && e.key === 'Enter') openItemHash(card.dataset.id); };
  if (!current.project.rights.canEdit) return;
  // dragId và marker ở cấp module: bảng có vẽ lại giữa lúc kéo thì thao tác thả vẫn hoạt động.
  if (!marker) { marker = document.createElement('div'); marker.className = 'drop-marker'; }
  body.ondragstart = e => {
    const card = e.target.closest('.kcard'); if (!card) return;
    dragId = Number(card.dataset.id); card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragId));
  };
  body.onmousedown = e => { if (e.button === 0 && e.target.closest('.kcard')) pressingCard = true; };
  body.ondragend = e => {
    pressingCard = false;
    e.target.closest('.kcard')?.classList.remove('dragging'); marker.remove(); $$('.column.drop-target', body).forEach(c => c.classList.remove('drop-target'));
    if (deferredReload && dragId) { dragId = null; reloadProject(); } // kéo bị huỷ giữa chừng
  };
  body.ondragover = e => {
    // Tự cuộn ngang khi kéo gần mép bảng.
    const board = e.target.closest('.board');
    if (board && dragId) {
      const rect = board.getBoundingClientRect();
      if (e.clientX > rect.right - 70) board.scrollLeft += 24; else if (e.clientX < rect.left + 70) board.scrollLeft -= 24;
    }
    const col = e.target.closest('.col-body'); if (!col || !dragId) return;
    e.preventDefault();
    $$('.column.drop-target', body).forEach(c => c.classList.remove('drop-target'));
    col.closest('.column').classList.add('drop-target');
    const after = [...col.querySelectorAll('.kcard:not(.dragging)')].find(c => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
    if (after) col.insertBefore(marker, after); else col.append(marker);
  };
  body.ondrop = async e => {
    const col = e.target.closest('.col-body'); if (!col) return;
    dragId ||= Number(e.dataTransfer.getData('text/plain')) || null;
    if (!dragId) return;
    e.preventDefault();
    const isCard = n => n && n.classList.contains('kcard') && !n.classList.contains('dragging');
    let prev = marker.parentElement ? marker.previousElementSibling : null; while (prev && !isCard(prev)) prev = prev.previousElementSibling;
    let next = marker.parentElement ? marker.nextElementSibling : null; while (next && !isCard(next)) next = next.nextElementSibling;
    const id = dragId; dragId = null; marker.remove();
    await moveItem(id, Number(col.dataset.state), prev?.dataset.id, next?.dataset.id);
  };
}
export async function moveItem(id, stateId, afterId, beforeId, overrideWip = false) {
  try {
    await api(`/api/items/${id}/move`, { method: 'POST', body: { stateId, afterId: afterId ? Number(afterId) : null, beforeId: beforeId ? Number(beforeId) : null, overrideWip } });
    const state = current.project.states.find(s => s.id === stateId);
    if (state?.category === 'REVIEW' && current.project.approvalSteps.length) toast('Đã gửi duyệt: ' + current.project.approvalSteps[0].name, 'ok');
  } catch (error) {
    if (error instanceof ApiError && error.code === 'WIP_LIMIT' && current.project.rights.canManage && !overrideWip) {
      if (await confirmDialog(error.message + '. Bạn là quản lý dự án — vẫn chuyển vượt giới hạn?', { okText: 'Vẫn chuyển' })) return moveItem(id, stateId, afterId, beforeId, true);
    } else toast(errorMessage(error), 'err');
  }
  await reloadProject();
  refreshCounters();
}
function showQuickAdd(btn) {
  const wrap = btn.parentElement, stateId = Number(btn.dataset.quick);
  wrap.innerHTML = `<input placeholder="Tiêu đề việc, Enter để lưu" data-testid="quick-input" maxlength="300">`;
  const input = wrap.querySelector('input');
  input.focus();
  input.addEventListener('keydown', async e => {
    if (e.key === 'Escape') return finishInteraction();
    if (e.key !== 'Enter' || !input.value.trim()) return;
    input.disabled = true;
    // Đang lọc theo một chu kỳ thì việc thêm nhanh được gắn luôn vào chu kỳ đó; đang lọc "Của tôi" thì giao luôn cho tôi.
    const f = current.filters.cycle, cycleId = f === 'current' ? currentCycle(current.cycles)?.id : /^\d+$/.test(f) ? Number(f) : undefined;
    const mine = current.filters.mine || current.filters.assignee === 'me' ? { assigneeIds: [store.me.id] } : {};
    try { await api(`/api/projects/${current.project.id}/items`, { method: 'POST', body: { title: input.value.trim(), stateId, cycleId, ...mine } }); await reloadProject(); }
    catch (error) { toast(errorMessage(error), 'err'); input.disabled = false; }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (document.body.contains(input) && !input.value.trim()) finishInteraction(); }, 150));
}

// ---------- Danh sách ----------
const SORTERS = {
  code: i => i.number, title: i => i.title.toLowerCase(), state: i => current.project.states.findIndex(s => s.id === i.stateId),
  priority: i => ['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NONE'].indexOf(i.priority), due: i => i.dueDate ? new Date(i.dueDate).getTime() : Infinity,
  assignee: i => i.assignees[0]?.fullName || '~', position: i => current.project.states.findIndex(s => s.id === i.stateId) * 1e9 + i.position,
};
function drawList(body) {
  const { key, dir } = current.sort, states = Object.fromEntries(current.project.states.map(s => [s.id, s]));
  const rows = filtered().sort((a, b) => { const x = SORTERS[key](a), y = SORTERS[key](b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
  const th = (k, label) => `<th data-sort="${k}" aria-sort="${key === k ? (dir > 0 ? 'ascending' : 'descending') : 'none'}">${label}${key === k ? icon(dir > 0 ? 'up' : 'down', 'sort') : ''}</th>`;
  // Sổ giao việc: cột Khâu (chờ phòng tiếp nhận, chờ phòng duyệt, chờ BGĐ…). Dự án thường: khâu cần chú ý hiện cạnh tiêu đề.
  const reg = isAssigned(), cols = reg ? 8 : 7;
  const stageCell = i => (i.dispatchStatus || i.stage?.code === 'RETURNED' || i.stage?.code?.startsWith('WAIT') ? stagePill(i.stage) : '');
  body.innerHTML = `<div class="tbl-scroll"><table class="table" data-testid="list-table"><thead><tr>${th('code', 'Mã')}${th('title', 'Tiêu đề')}${th('state', 'Trạng thái')}${reg ? '<th>Khâu</th>' : ''}${th('priority', 'Ưu tiên')}${th('assignee', personWord())}${th('due', 'Hạn')}<th>Nhãn</th></tr></thead>
    <tbody>${rows.map(i => `<tr class="clickable" data-id="${i.id}" data-testid="row-${esc(i.code)}"><td class="code">${esc(i.code)}</td><td>${esc(i.title)}${reg ? '' : ' ' + stageBits(i)}</td>
      <td>${stateChip(states[i.stateId])}</td>${reg ? `<td class="nowrap">${stageCell(i)}</td>` : ''}<td class="nowrap">${i.priority === 'NONE' ? '' : `<span class="prio prio-${i.priority}">${PRIORITY[i.priority].label}</span>`}</td>
      <td>${i.assignees.map(a => esc(a.fullName)).join(', ')}</td><td class="due ${dueClass({ ...i, state: states[i.stateId] })}">${fmtDate(i.dueDate)}</td><td>${i.labels.map(labelChip).join(' ')}</td></tr>`).join('')
      || `<tr><td colspan="${cols}" class="empty">Dự án chưa có việc nào.</td></tr>`}</tbody></table></div>`;
  const sortSel = $('#fSort', current.root); if (sortSel) sortSel.value = key;
  body.onclick = e => {
    const sort = e.target.closest('[data-sort]');
    if (sort) { current.sort = { key: sort.dataset.sort, dir: current.sort.key === sort.dataset.sort ? -current.sort.dir : 1 }; return drawList(body); }
    const row = e.target.closest('tr[data-id]'); if (row) openItemHash(row.dataset.id);
  };
}

// ---------- Lịch (theo hạn) ----------
function vnDay(value) { return dateInput(value); }
function drawCalendar(body) {
  const state = calState(current.params, uiPref('cal:mode'));
  const states = Object.fromEntries(current.project.states.map(s => [s.id, s]));
  body.innerHTML = calendarHtml({ items: filtered(), state, hrefOf: i => openItemHrefFor(i.id), colorOf: i => states[i.stateId]?.color,
    doneOf: i => ['COMPLETED', 'CANCELLED'].includes(states[i.stateId]?.category), metaOf: i => i.assignees?.[0]?.fullName?.split(' ').pop() || '' });
  if (!body._calBound) {
    body._calBound = true;
    bindCalendar(body, { get mode() { return calState(current.params, uiPref('cal:mode')).mode; }, get at() { return calState(current.params, uiPref('cal:mode')).at; } }, ({ mode, at }) => {
      uiPref('cal:mode', mode);
      current.params.set('cal', mode); if (at) current.params.set('at', at); else current.params.delete('at');
      replaceHashParams({ cal: mode, at: at || null });
      drawCalendar(body);
    });
    body.addEventListener('click', e => { const it = e.target.closest('.cal-item'); if (it && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openItemHash(it.dataset.id); } });
  }
}

// ---------- Tạo việc ----------
// Sổ giao việc của đơn vị: loại nhiệm vụ, giao về phòng chủ trì / phối hợp, văn bản căn cứ.
function dispatchFields(project, defaults) {
  if (defaults.parentId) return { main: '', extra: '' };
  const types = `<label class="field">Loại nhiệm vụ<select name="taskType" data-testid="create-task-type"><option value="ADHOC">Đột xuất (theo chỉ đạo)</option><option value="PLAN">Kế hoạch năm</option></select></label>`;
  if (project.visibility !== 'ASSIGNED') return { main: '', extra: types };
  const depts = store.departments.filter(d => d.isActive !== false && d.id !== project.departmentId);
  // Một ô "Giao cho": về phòng (phòng tự phân công) hoặc giao thẳng một người (đại diện phòng, vd. trưởng phòng).
  return {
    main: `<div class="grid2">
      <label class="field">Giao cho<select name="leadDepartmentId" required data-testid="create-lead-dept"><option value="">— Chọn phòng hoặc người —</option>${giaoChoOptions(depts)}</select></label>
      <label class="field">Người giao<select name="assignedById" data-testid="create-assigner">${assignerOptions()}</select></label></div>`,
    extra: `<div class="grid2">${types}
      <label class="field">Nguồn giao việc<select name="source" data-testid="create-source"><option value="">—</option>${(store.settings?.sources || []).map(x => `<option>${esc(x)}</option>`).join('')}</select></label></div>
    <div class="field">Đơn vị phối hợp${multiSelect('createSupportDepts', depts.map(d => ({ id: d.id, label: d.name })), [], 'Không')}</div>
    <label class="field">Sản phẩm đầu ra<input name="deliverable" maxlength="500" placeholder="VD: Báo cáo trình BGĐ; Kế hoạch tổ chức" data-testid="create-deliverable"></label>
    <div class="grid2"><label class="field">Văn bản căn cứ — số, ký hiệu<input name="docNumber" maxlength="80" placeholder="VD: 123/TB-TTPT" data-testid="create-doc-number"></label><label class="field">Ngày văn bản<input type="date" name="docDate"></label></div>
    <label class="field">Trích yếu văn bản<input name="docSummary" maxlength="500" data-testid="create-doc-summary"></label>
    <p class="muted xs">Không nhập nội dung văn bản Mật / Tối mật / Tuyệt mật — chỉ ghi số hiệu, trích yếu.</p>`,
  };
}
// "Giao cho": mỗi phòng một nhóm — dòng đầu là cả phòng (trưởng phòng tiếp nhận, phân công), sau đó từng người (lãnh đạo trước).
// Giá trị: id phòng, hoặc "u:<id người>" (giao thẳng; phòng chủ trì = phòng của người đó, việc coi như đã tiếp nhận).
function giaoChoOptions(depts, selected = '') {
  const rank = { manager: 0, deputy: 1, member: 2 };
  return depts.map(d => {
    const people = store.users.filter(u => u.departmentId === d.id && u.role !== 'admin').sort((a, b) => (rank[a.role] ?? 3) - (rank[b.role] ?? 3) || a.fullName.localeCompare(b.fullName, 'vi'));
    return `<optgroup label="${esc(d.name)}"><option value="${d.id}"${String(selected) === String(d.id) ? ' selected' : ''}>${esc(d.name)} (phòng phân công)</option>${people.map(u => `<option value="u:${u.id}"${selected === 'u:' + u.id ? ' selected' : ''}>${esc(u.fullName)}${u.displayTitle ? ' — ' + esc(u.displayTitle) : ''}</option>`).join('')}</optgroup>`;
  }).join('');
}
const giaoChoValue = v => (!v ? {} : String(v).startsWith('u:') ? { assigneeIds: [Number(String(v).slice(2))] } : { leadDepartmentId: Number(v) });
// Người giao: Ban Giám đốc + chính mình (mặc định là mình nếu là lãnh đạo, ngược lại là Giám đốc).
function assignerOptions(selected) {
  const leaders = store.users.filter(u => u.role === 'director' && u.id !== store.me.id);
  const meDefault = store.me.role === 'director' || !leaders.length;
  const pick = selected ?? (meDefault ? store.me.id : leaders[0].id);
  return [{ id: store.me.id, fullName: store.me.fullName + ' (tôi)' }, ...leaders].map(u => `<option value="${u.id}"${u.id === pick ? ' selected' : ''}>${esc(u.fullName)}</option>`).join('');
}
export function openCreateItem(defaults = {}) {
  const { project } = current;
  const users = assignableUsers(project);
  const states = project.states.filter(s => !['REVIEW', 'COMPLETED'].includes(s.category) || !project.approvalSteps.length);
  // Sổ giao việc của đơn vị: việc giao về phòng bắt đầu ở "Chưa bắt đầu", phòng tiếp nhận mới chuyển; ưu tiên mặc định Cao.
  const reg = project.visibility === 'ASSIGNED' && !defaults.parentId;
  const dispatch = dispatchFields(project, defaults);
  // Gọn: chỉ để ngoài những gì cần để giao việc (tiêu đề, giao cho / người nhận, hạn, ưu tiên); còn lại trong "Thêm thông tin".
  const modal = openModal(`<h2>Tạo việc trong ${esc(project.name)}</h2><form id="createItemForm">
    <label class="field">Tiêu đề<input name="title" required maxlength="300" autofocus data-testid="create-title"></label>
    ${dispatch.main}
    ${reg ? '' : `<div class="field">Người nhận${multiSelect('assignees', users.map(u => ({ id: u.id, label: u.fullName + '' })), defaults.assigneeIds || [])}</div>`}
    <div class="grid2">
      <label class="field">Hạn<input type="date" name="dueDate" data-testid="create-due"></label>
      <label class="field">Ưu tiên<select name="priority" data-testid="create-priority">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}"${k === (reg ? 'HIGH' : 'NONE') ? ' selected' : ''}>${v.label}</option>`).join('')}</select></label>
      ${reg ? `<input type="hidden" name="stateId" value="${(states.find(s => s.category === 'UNSTARTED') || states[0]).id}">` : `<label class="field">Trạng thái<select name="stateId" data-testid="create-state">${states.map(s => `<option value="${s.id}"${s.category === 'UNSTARTED' ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>`}
    </div>
    <details class="more-fields" data-testid="create-more"><summary>Thêm thông tin: mô tả, ngày bắt đầu, nhãn${project.visibility === 'ASSIGNED' && !defaults.parentId ? ', phối hợp, văn bản căn cứ, sản phẩm' : ''}${project.rights.canManage && project.approvalSteps.length ? ', mức duyệt' : ''}${project.rights.canManage && !defaults.parentId ? ', lặp lại' : ''}</summary>
    <label class="field">Mô tả<textarea name="description" rows="3" data-testid="create-description"></textarea></label>
    <div class="grid2"><label class="field">Bắt đầu<input type="date" name="startDate" data-testid="create-start"></label>
      ${current.cycles.length ? `<label class="field">Chu kỳ<select name="cycleId" data-testid="create-cycle"><option value="">— Không —</option>${current.cycles.filter(c => c.status !== 'COMPLETED').map(c => `<option value="${c.id}"${currentCycle(current.cycles)?.id === c.id && current.filters.cycle ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}</div>
    ${dispatch.extra}
    <div class="field">Nhãn${multiSelect('labels', labelsFor(project.id).map(l => ({ id: l.id, label: l.name, chip: labelChip(l) })), [], 'Chọn hoặc gõ nhãn mới…', { create: true })}</div>
    ${project.rights.canManage && project.approvalSteps.length ? `<label class="field">Mức duyệt<select name="approvalLevels" data-testid="create-approval-levels"><option value="">Tự động (theo quy tắc / mặc định dự án)</option>${Array.from({ length: project.approvalSteps.length + 1 }, (_, n) => `<option value="${n}">${n === 0 ? 'Không cần duyệt' : n === project.approvalSteps.length ? `Đủ ${n} cấp` : `${n} cấp: ${project.approvalSteps.slice(0, n).map(x => esc(x.name)).join(' → ')}`}</option>`).join('')}</select></label>` : ''}
    ${project.rights.canManage && !defaults.parentId ? scheduleFields({}, { allowNone: true, prefix: 'create' }) : ''}
    </details>
    ${defaults.parentId ? `<input type="hidden" name="parentId" value="${defaults.parentId}">` : ''}
    <p class="error" id="createItemError"></p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="create-submit">Tạo việc</button></div></form>`);
  bindMulti(modal, null, { creators: { labels: async name => { const l = await createProjectLabel(project.id, name); return { id: l.id, label: l.name, chip: labelChip(l) }; } } });
  bindSchedule(modal);
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const f = formData(e.target);
    const body = { title: f.title, descriptionHtml: f.description ? f.description.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join('') : '', stateId: Number(f.stateId), priority: f.priority,
      startDate: fromDateInput(f.startDate), dueDate: fromDateInput(f.dueDate), assigneeIds: reg ? [] : readMulti(modal, 'assignees'), labelIds: readMulti(modal, 'labels'), parentId: f.parentId ? Number(f.parentId) : null, cycleId: f.cycleId ? Number(f.cycleId) : null,
      ...(f.approvalLevels !== undefined && f.approvalLevels !== '' ? { approvalLevels: Number(f.approvalLevels) } : {}),
      ...(f.taskType ? { taskType: f.taskType } : {}), ...(f.leadDepartmentId ? { ...giaoChoValue(f.leadDepartmentId), supportDepartmentIds: readMulti(modal, 'createSupportDepts') } : {}),
      ...(f.assignedById ? { assignedById: Number(f.assignedById) } : {}), ...(f.source ? { source: f.source } : {}), ...(f.deliverable ? { deliverable: f.deliverable } : {}) };
    const repeat = readSchedule(modal);
    try {
      const item = await api(`/api/projects/${project.id}/items`, { method: 'POST', body });
      if (f.docNumber && f.docSummary) await api(`/api/items/${item.id}/documents`, { method: 'POST', body: { kind: 'BASIS', number: f.docNumber, summary: f.docSummary, issuedOn: fromDateInput(f.docDate) } }).catch(error => toast('Đã tạo việc nhưng chưa lưu được văn bản căn cứ: ' + errorMessage(error), 'err'));
      // Việc lặp lại: việc vừa tạo là lần đầu; các lần sau hệ thống tự tạo theo lịch.
      if (repeat) await api(`/api/items/${item.id}/recurring`, { method: 'POST', body: repeat }).catch(error => toast('Đã tạo việc nhưng chưa bật được lặp lại: ' + errorMessage(error), 'err'));
      closeModal(); toast(`Đã tạo ${item.code}${repeat ? ' (có lặp lại)' : ''}`, 'ok');
      await reloadProject();
      defaults.onCreated?.(item);
    } catch (error) { $('#createItemError', modal).textContent = errorMessage(error); }
  };
}

// Giao nhiều việc một lần (Văn phòng nhập chỉ đạo sau giao ban): lưới nhập hoặc dán từ Excel.
// Cột dán: Nội dung ⇥ Phòng chủ trì (tên hoặc mã) ⇥ Hạn dd/mm/yyyy ⇥ Số văn bản ⇥ Sản phẩm.
function openBulkDispatch() {
  const { project } = current;
  const depts = store.departments.filter(d => d.isActive !== false && d.id !== project.departmentId);
  const findDept = v => { const t = String(v || '').trim().toLowerCase(); return t ? depts.find(d => d.name.toLowerCase() === t || (d.code || '').toLowerCase() === t || d.name.toLowerCase().includes(t)) : null; };
  const toIso = v => { const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : ''; };
  const row = (r = {}) => `<tr><td><input data-col="title" maxlength="300" value="${esc(r.title || '')}" aria-label="Nội dung nhiệm vụ"></td>
    <td><select data-col="dept" aria-label="Giao cho (phòng hoặc người)"><option value="">— Phòng / người —</option>${giaoChoOptions(depts, r.dept ? String(r.dept) : '')}</select></td>
    <td><input type="date" data-col="due" value="${esc(r.due || '')}" aria-label="Hạn"></td><td><input data-col="doc" maxlength="80" value="${esc(r.doc || '')}" placeholder="Số VB" aria-label="Số văn bản căn cứ"></td>
    <td><input data-col="deliverable" maxlength="500" value="${esc(r.deliverable || '')}" aria-label="Sản phẩm"></td><td><button class="icon-btn" type="button" data-del-row aria-label="Bỏ dòng">${icon('x')}</button></td></tr>`;
  const modal = openModal(`<h2>Giao nhiều việc</h2><p class="muted sm">Mỗi dòng một nhiệm vụ, giao về phòng chủ trì — phòng sẽ tiếp nhận và phân công. Dán được nhiều dòng từ Excel vào ô đầu tiên.</p>
    <div class="grid2"><label class="field">Người giao<select id="bdAssigner" data-testid="bulk-assigner">${assignerOptions()}</select></label>
      <label class="field">Nguồn giao việc<select id="bdSource"><option value="">—</option>${(store.settings?.sources || []).map(x => `<option>${esc(x)}</option>`).join('')}</select></label>
      <label class="field">Loại nhiệm vụ<select id="bdType"><option value="ADHOC">Đột xuất (theo chỉ đạo)</option><option value="PLAN">Kế hoạch năm</option></select></label>
      <label class="field">Ngày văn bản căn cứ <span class="muted xs">(chung cho các dòng có số VB)</span><input type="date" id="bdDocDate"></label></div>
    <div class="tbl-scroll"><table class="table grid-input" data-testid="bulk-dispatch-grid"><thead><tr><th>Nội dung nhiệm vụ</th><th>Giao cho</th><th>Hạn</th><th>Số VB căn cứ</th><th>Sản phẩm</th><th></th></tr></thead><tbody>${row()}${row()}${row()}</tbody></table></div>
    <div class="row" style="margin-top:8px"><button class="btn btn-ghost btn-sm" type="button" data-add-row>${icon('plus')}Thêm dòng</button><span class="muted xs" id="bdCount"></span></div>
    <p class="error" id="bdError"></p>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-act="ok" data-testid="bulk-dispatch-submit">Giao việc</button></div>`, { wide: true });
  const body = () => $('tbody', modal);
  const count = () => { $('#bdCount', modal).textContent = `${[...body().rows].filter(tr => $('[data-col=title]', tr).value.trim()).length} nhiệm vụ`; };
  modal.oninput = count;
  modal.onclick = async e => {
    if (e.target.closest('[data-close]')) return closeModal();
    if (e.target.closest('[data-add-row]')) { body().insertAdjacentHTML('beforeend', row()); return; }
    const del = e.target.closest('[data-del-row]'); if (del) { del.closest('tr').remove(); count(); return; }
    const ok = e.target.closest('[data-act="ok"]'); if (!ok) return;
    const docDate = fromDateInput($('#bdDocDate', modal).value);
    const rows = [...body().rows].map(tr => ({ title: $('[data-col=title]', tr).value.trim(), ...giaoChoValue($('[data-col=dept]', tr).value), dueDate: fromDateInput($('[data-col=due]', tr).value),
      docNumber: $('[data-col=doc]', tr).value.trim() || undefined, docDate, deliverable: $('[data-col=deliverable]', tr).value.trim(), taskType: $('#bdType', modal).value })).filter(r => r.title);
    if (!rows.length) { $('#bdError', modal).textContent = 'Nhập ít nhất một nhiệm vụ'; return; }
    const miss = rows.findIndex(r => !r.leadDepartmentId && !(r.assigneeIds || []).length);
    if (miss >= 0) { $('#bdError', modal).textContent = `Dòng ${miss + 1}: chọn phòng hoặc người được giao`; return; }
    ok.disabled = true;
    try {
      const r = await api(`/api/projects/${project.id}/dispatch/bulk`, { method: 'POST', body: { rows, assignedById: Number($('#bdAssigner', modal).value), source: $('#bdSource', modal).value || null } });
      closeModal(); toast(`Đã giao ${r.created.length} nhiệm vụ: ${r.created.map(x => x.code).join(', ')}`, 'ok'); await reloadProject();
    } catch (error) { ok.disabled = false; $('#bdError', modal).textContent = errorMessage(error); }
  };
  modal.addEventListener('paste', e => {
    const t = e.target.closest('[data-col=title]'); if (!t) return;
    const lines = (e.clipboardData?.getData('text') || '').split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2 && !lines[0]?.includes('\t')) return;
    e.preventDefault();
    const parsed = lines.map(l => { const [title, dept, due, doc, deliverable] = l.split('\t'); return { title: (title || '').trim(), dept: findDept(dept)?.id, due: toIso(due), doc: (doc || '').trim(), deliverable: (deliverable || '').trim() }; });
    const tr = t.closest('tr');
    [...body().rows].filter(r => !$('[data-col=title]', r).value.trim() && r !== tr).forEach(r => r.remove());
    tr.outerHTML = parsed.map(row).join('');
    count();
  });
}

// Chọn kiểu nhập: Sổ giao việc (Excel), Kế hoạch năm (Word), hoặc danh sách đơn giản.
function openImportChooser() {
  const { project } = current, m = project.rights.canManage;
  const modal = openModal(`<h2>Nhập công việc</h2><div class="choice-list">
    ${m ? `<button class="choice" data-kind="register" data-testid="import-register">${icon('upload')}<span><b>Sổ giao việc (Excel)</b><span class="muted sm">Đúng mẫu "Sổ theo dõi, kiểm soát giao việc": nhóm việc / việc nhánh, người giao, chủ trì, phối hợp, hạn, tiến độ, sản phẩm…</span></span></button>
    <button class="choice" data-kind="plan" data-testid="import-plan">${icon('file')}<span><b>Kế hoạch công tác năm (Word)</b><span class="muted sm">Đọc bảng "Phân công công việc cụ thể" → nhiệm vụ + mốc tháng thành việc nhánh, nguồn "Kế hoạch năm"</span></span></button>` : ''}
    <button class="choice" data-kind="simple" data-testid="import-simple">${icon('checklist')}<span><b>Danh sách đơn giản (Excel)</b><span class="muted sm">Tiêu đề, mô tả, người nhận, ưu tiên, hạn — theo tệp mẫu</span></span></button>
  </div><div class="modal-actions"><button class="btn btn-ghost" data-close>Huỷ</button></div>`);
  modal.onclick = e => {
    if (e.target.closest('[data-close]')) return closeModal();
    const k = e.target.closest('[data-kind]')?.dataset.kind; if (!k) return;
    closeModal();
    if (k === 'register') openRegisterImport(project, reloadProject);
    else if (k === 'plan') openPlanImport(project, reloadProject);
    else openImport();
  };
}
function openImport() {
  const { project } = current;
  const modal = openModal(`<h2>Nhập công việc từ Excel</h2>
    <p class="muted sm">Dùng tệp mẫu: Tiêu đề, Mô tả, Người nhận (tên tài khoản), Ưu tiên, Bắt đầu, Hạn, Trạng thái. Tối đa 1000 dòng.</p>
    <p><button class="btn btn-ghost btn-sm" id="tplBtn">Tải tệp mẫu</button></p>
    <form id="importForm"><label class="field">Tệp .xlsx<input type="file" name="file" accept=".xlsx" required data-testid="import-file"></label>
    <p class="error" id="importError"></p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="import-submit">Nhập</button></div></form>`);
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('#tplBtn').onclick = () => download(`/api/projects/${project.id}/import-template.xlsx`).catch(error => toast(errorMessage(error), 'err'));
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    try {
      const result = await api(`/api/projects/${project.id}/import`, { method: 'POST', form: new FormData(e.target) });
      closeModal(); toast(`Đã nhập ${result.created} việc`, 'ok'); await reloadProject();
    } catch (error) { $('#importError', modal).textContent = errorMessage(error); }
  };
}
