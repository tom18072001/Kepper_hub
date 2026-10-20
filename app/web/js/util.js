// Tiện ích giao diện dùng chung.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const PRIORITY = {
  URGENT: { label: 'Khẩn', short: 'KHẨN' }, HIGH: { label: 'Cao', short: 'CAO' }, MEDIUM: { label: 'Bình thường', short: 'BT' },
  LOW: { label: 'Thấp', short: 'THẤP' }, NONE: { label: 'Không', short: '' },
};
export const CATEGORY = {
  BACKLOG: 'Tồn đọng', UNSTARTED: 'Chưa bắt đầu', STARTED: 'Đang thực hiện', REVIEW: 'Chờ duyệt', COMPLETED: 'Hoàn thành', CANCELLED: 'Huỷ',
  OTHER: 'Cột tự do',
};
export const ROLE_LABEL = { admin: 'Quản trị hệ thống', director: 'Ban giám đốc', manager: 'Trưởng phòng', deputy: 'Phó phòng', member: 'Nhân viên' };
export const VISIBILITY = { DEPARTMENT: 'Cả phòng ban', PRIVATE: 'Chỉ thành viên', PUBLIC: 'Toàn tổ chức', ASSIGNED: 'Sổ giao việc của đơn vị — mỗi người thấy việc liên quan đến mình' };
export const APPROVER = { PROJECT_LEAD: 'Trưởng dự án', DEPARTMENT_MANAGER: 'Trưởng phòng', DIRECTOR: 'Ban giám đốc', SUPERVISOR: 'Người giao / PGĐ phụ trách', USER: 'Người được chỉ định' };

const DAY = 86_400_000;
export function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
}
export function fmtDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
}
export function ago(value) {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return 'vừa xong';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' phút trước';
  if (diff < DAY) return Math.floor(diff / 3_600_000) + ' giờ trước';
  if (diff < 7 * DAY) return Math.floor(diff / DAY) + ' ngày trước';
  return fmtDate(value);
}
// yyyy-mm-dd theo giờ Việt Nam (dùng cho input type=date).
export function dateInput(value) {
  if (!value) return '';
  const d = new Date(new Date(value).getTime() + 7 * 3_600_000);
  return d.toISOString().slice(0, 10);
}
export function fromDateInput(value) { return value ? new Date(value + 'T00:00:00+07:00').toISOString() : null; }
export function dueClass(item) {
  if (!item.dueDate || ['COMPLETED', 'CANCELLED'].includes(item.state?.category) || item.completedAt) return '';
  const diff = new Date(item.dueDate).getTime() - Date.now();
  return diff < 0 ? 'overdue' : diff < 2 * DAY ? 'soon' : '';
}

const PALETTE = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2', '#4f46e5', '#b45309'];
export function avatar(user, title = true) {
  if (!user) return '';
  const name = user.fullName || user.username || '?';
  const parts = name.trim().split(/\s+/);
  const initials = ((parts.length > 1 ? parts[parts.length - 2][0] : '') + parts[parts.length - 1][0]).toUpperCase();
  const color = PALETTE[(user.id || 0) % PALETTE.length];
  return `<span class="avatar" style="background:${color}"${title ? ` title="${esc(name)}"` : ''}>${esc(initials)}</span>`;
}
export function avatars(users = []) { return users.length ? `<span class="avatars">${users.slice(0, 4).map(u => avatar(u)).join('')}</span>` : ''; }
export function labelChip(l) { return `<span class="label"><i style="background:${esc(l.color)}"></i>${esc(l.name)}</span>`; }
// Trạng thái hạn tự tính — cùng quy tắc với server (services/register.js) và mẫu Sổ giao việc.
const vnDay = d => Math.floor((new Date(d).getTime() + 7 * 3_600_000) / DAY);
export function deadlineStatus(item, dueSoonDays = 3, now = new Date()) {
  const cat = item.state?.category;
  if (cat === 'CANCELLED') return { code: 'CANCELLED', label: 'Huỷ', daysLeft: null };
  const due = item.dueDate ? vnDay(item.dueDate) : null;
  if (cat === 'COMPLETED') {
    if (due == null || !item.completedAt) return { code: 'DONE', label: 'Hoàn thành', daysLeft: null };
    return vnDay(item.completedAt) > due ? { code: 'DONE_LATE', label: 'Hoàn thành trễ hạn', daysLeft: null } : { code: 'DONE_ON_TIME', label: 'Hoàn thành đúng hạn', daysLeft: null };
  }
  if (due == null) return { code: 'NO_DUE', label: 'Chưa có hạn', daysLeft: null };
  const daysLeft = due - vnDay(now);
  if (daysLeft < 0) return { code: 'OVERDUE', label: 'Quá hạn', daysLeft };
  if (daysLeft <= dueSoonDays) return { code: 'DUE_SOON', label: 'Sắp đến hạn', daysLeft };
  return { code: 'IN_PROGRESS', label: 'Đang thực hiện', daysLeft };
}
export function deadlineChip(s) { return `<span class="dl dl-${s.code}" data-testid="deadline-status">${esc(s.label)}</span>`; }
export function stateChip(s) { return s ? `<span class="pill"><span class="state-dot" style="background:${esc(s.color)}"></span>${esc(s.name)}</span>` : ''; }
export function prioChip(p) { return p && p !== 'NONE' ? `<span class="prio prio-${p}">${PRIORITY[p].short}</span>` : ''; }

// toast(message, kind, { action: { label, run }, ms }) — có nút hành động (vd. "Hoàn tác") thì giữ 8 giây.
export function toast(message, kind = '', { action = null, ms = null } = {}) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  const text = document.createElement('span'); text.textContent = message; el.append(text);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'toast-action'; b.textContent = action.label;
    b.setAttribute('data-testid', 'toast-action');
    b.onclick = async () => { b.disabled = true; el.remove(); try { await action.run(); } catch (error) { toast(errorMessage(error), 'err'); } };
    el.append(b);
  }
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms ?? (action ? 8000 : kind === 'err' ? 6000 : 3500));
}

// Hạn dạng đếm ngược theo ngày Việt Nam: "Còn 4 ngày", "Hôm nay đến hạn", "Quá hạn 2 ngày", "Xong đúng hạn"…
export function dueCountdown(item, dueSoonDays = 3, now = new Date()) {
  const due = item.dueDate;
  if (!due) return { text: 'Chưa có hạn', tone: '' };
  const day = v => Math.floor((new Date(v).getTime() + 7 * 3_600_000) / 86_400_000);
  const cat = item.state?.category;
  if (cat === 'COMPLETED') { const late = item.completedAt && day(item.completedAt) > day(due); return { text: late ? `Xong trễ ${day(item.completedAt) - day(due)} ngày` : 'Xong đúng hạn', tone: late ? 'warn' : 'ok' }; }
  if (cat === 'CANCELLED') return { text: 'Đã huỷ', tone: '' };
  const left = day(due) - day(now);
  if (left < 0) return { text: `Quá hạn ${-left} ngày`, tone: 'danger' };
  if (left === 0) return { text: 'Hôm nay đến hạn', tone: 'warn' };
  return { text: left === 1 ? 'Còn 1 ngày' : `Còn ${left} ngày`, tone: left <= dueSoonDays ? 'warn' : '' };
}

// Tuỳ chọn giao diện theo người dùng (khối mở/đóng, bộ lọc cuối, công tắc phím tắt) — chỉ trạng thái giao diện, không lưu nội dung việc.
let prefUser = 'anon';
export function setPrefUser(id) { prefUser = 'u' + (id ?? 'anon'); }
export function uiPref(key, value) {
  const k = `workhub:${prefUser}:${key}`;
  try {
    if (value === undefined) { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); }
    if (value === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(value));
  } catch { /* trình duyệt chặn lưu trữ */ }
  return value ?? null;
}
// Nháp (bình luận, báo cáo, ý kiến) trong sessionStorage — mất khi đóng tab, xoá khi đăng xuất.
// Khoá theo người dùng: máy dùng chung, người sau không thấy nháp của người trước.
const draftTimers = new Map();
export function draft(key, value) {
  const k = `workhub:draft:${prefUser}:${key}`;
  if (value !== undefined) { clearTimeout(draftTimers.get(key)); draftTimers.delete(key); }
  try {
    if (value === undefined) return sessionStorage.getItem(k) || '';
    if (value) sessionStorage.setItem(k, value); else sessionStorage.removeItem(k);
  } catch { /* bỏ qua */ }
  return value || '';
}
// Ghi nháp trễ theo từng ô (mỗi khoá một bộ hẹn giờ); draft(key, '') sau khi gửi sẽ huỷ lần ghi đang chờ.
export function draftLater(key, value, ms = 300) {
  clearTimeout(draftTimers.get(key));
  draftTimers.set(key, setTimeout(() => { draftTimers.delete(key); draft(key, value); }, ms));
}
export function clearDrafts() { try { for (const k of Object.keys(sessionStorage)) if (k.startsWith('workhub:draft:')) sessionStorage.removeItem(k); } catch { /* bỏ qua */ } }
// Ghi tham số lên URL (bộ lọc, tab…) mà không tạo mục lịch sử và không vẽ lại trang.
export function replaceHashParams(updates) {
  const [path, query = ''] = location.hash.split('?');
  const params = new URLSearchParams(query);
  for (const [k, v] of Object.entries(updates)) { if (v == null || v === '' || v === false) params.delete(k); else params.set(k, String(v)); }
  const qs = params.toString();
  history.replaceState(null, '', (path || '#/') + (qs ? '?' + qs : ''));
  window.dispatchEvent(new CustomEvent('workhub:hashreplaced'));
}

// Modal đơn giản: trả về phần tử modal; đóng bằng closeModal().
let modalResolve = null, modalOpener = null;
export function openModal(html, { wide = false } = {}) {
  const root = $('#modalRoot'), old = $('#modal');
  if (root.classList.contains('hidden')) modalOpener = document.activeElement;
  // Mỗi lần mở dùng một phần tử #modal mới: trình xử lý của hộp trước (onclick / addEventListener) không còn chạy ở hộp sau.
  const modal = old.cloneNode(false);
  old.replaceWith(modal);
  modal.className = 'modal' + (wide ? ' wide' : '');
  modal.innerHTML = html;
  // Đã nhập gì trong hộp thoại thì bấm ra nền / Esc sẽ hỏi trước khi bỏ (xem requestCloseModal). Dán (paste) cũng tính.
  modal.dataset.dirty = '';
  const dirty = () => { modal.dataset.dirty = '1'; };
  modal.addEventListener('input', dirty); modal.addEventListener('paste', dirty);
  root.classList.remove('hidden');
  setTimeout(() => (modal.querySelector('[autofocus]') || modal.querySelector('input,select,textarea,button'))?.focus(), 0);
  return modal;
}
// Đóng do bấm ra nền / Esc: nếu đã nhập dữ liệu thì hỏi ngay trong hộp thoại (không thay nội dung đang nhập).
export function requestCloseModal() {
  const modal = $('#modal');
  if (!modal.dataset.dirty) return closeModal(null);
  if (modal.querySelector('.discard-bar')) return;
  modal.insertAdjacentHTML('afterbegin', `<div class="discard-bar" role="alertdialog" aria-label="Bỏ nội dung đã nhập?"><span>Bỏ nội dung đã nhập?</span>
    <button type="button" class="btn btn-danger btn-sm" data-discard="yes" data-testid="discard-yes">Bỏ nội dung</button><button type="button" class="btn btn-ghost btn-sm" data-discard="no">Tiếp tục nhập</button></div>`);
  const bar = modal.querySelector('.discard-bar');
  bar.querySelector('[data-discard="no"]').focus();
  bar.onclick = e => { const v = e.target.closest('[data-discard]')?.dataset.discard; if (v === 'yes') closeModal(null); else if (v === 'no') bar.remove(); };
}
export function closeModal(value) {
  const root = $('#modalRoot'), had = !root.classList.contains('hidden');
  root.classList.add('hidden');
  $('#modal').innerHTML = '';
  if (modalResolve) { modalResolve(value); modalResolve = null; }
  // Trả tiêu điểm về phần tử đã mở hộp (nếu luồng sau không mở hộp khác / không tự đặt tiêu điểm).
  const back = modalOpener; modalOpener = null;
  if (had && back?.isConnected) setTimeout(() => { if (root.classList.contains('hidden') && (document.activeElement === document.body || !document.activeElement)) back.focus?.({ preventScroll: true }); }, 0);
}
export function confirmDialog(message, { okText = 'Đồng ý', danger = false, input = null } = {}) {
  return new Promise(resolve => {
    const modal = openModal(`<h2>Xác nhận</h2><p>${esc(message)}</p>${input ? `<label class="field">${esc(input)}<textarea id="confirmInput" autofocus data-testid="confirm-input"></textarea></label>` : ''}
      <div class="modal-actions"><button class="btn btn-ghost" data-act="cancel">Huỷ</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok" data-testid="confirm-ok">${esc(okText)}</button></div>`);
    modalResolve = resolve;
    modal.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') closeModal(null);
      if (act === 'ok') closeModal(input ? (modal.querySelector('#confirmInput').value.trim() || '') : true);
    });
  });
}
export function formData(form) {
  return Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
}
export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function errorMessage(error) { return error?.message || 'Có lỗi xảy ra'; }

// Ô chọn nhiều (người nhận, nhãn): trả về HTML; trạng thái được đọc lại bằng readMulti().
// opts.search: có ô tìm; opts.create: cho gõ để tạo mới (hàm tạo truyền qua bindMulti(..., { creators })).
export function multiSelect(name, options, selected = [], placeholder = 'Chọn…', { search = options.length > 6, create = false } = {}) {
  const sel = new Set(selected.map(Number));
  const chipOf = o => o.chip || `<span class="pill">${esc(o.label)}</span>`;
  const chips = options.filter(o => sel.has(Number(o.id))).map(chipOf).join('') || `<span class="muted">${esc(placeholder)}</span>`;
  return `<div class="multi" data-multi="${esc(name)}" data-placeholder="${esc(placeholder)}"><button type="button" class="multi-btn" data-testid="multi-${esc(name)}">${chips}</button>
    <div class="multi-list hidden">${search || create ? `<input class="multi-search" placeholder="${create ? 'Tìm hoặc gõ tên nhãn mới…' : 'Tìm…'}" aria-label="Tìm" data-testid="multi-${esc(name)}-search">` : ''}
      <div class="multi-opts">${options.map(o => multiOption(name, o, sel.has(Number(o.id)))).join('')}</div>
      <div class="muted xs multi-empty${options.length ? ' hidden' : ''}">Không có lựa chọn</div>
      ${create ? `<button type="button" class="multi-create hidden" data-testid="multi-${esc(name)}-create"></button>` : ''}</div></div>`;
}
function multiOption(name, o, checked) {
  return `<label data-text="${esc(String(o.label).toLowerCase())}" data-chip="${esc(o.chip || `<span class="pill">${esc(o.label)}</span>`)}"><input type="checkbox" value="${o.id}"${checked ? ' checked' : ''} data-testid="multi-${esc(name)}-${o.id}">${o.chip || ''}<span>${esc(o.label)}</span></label>`;
}
function refreshChips(box) {
  const chips = $$('.multi-opts input:checked', box).map(i => i.closest('label').dataset.chip).join('');
  box.querySelector('.multi-btn').innerHTML = chips || `<span class="muted">${esc(box.dataset.placeholder || 'Chọn…')}</span>`;
}
export function readMulti(root, name) {
  return $$(`[data-multi="${name}"] input:checked`, root).map(i => Number(i.value));
}
// Gắn hành vi mở/đóng cho các ô chọn nhiều; onChange gọi khi danh sách đóng lại và có thay đổi.
// creators: { labels: async name => ({ id, label, chip }) } cho ô được phép tạo mới.
export function bindMulti(root, onChange, { creators = {} } = {}) {
  // Gắn một lần cho mỗi phần tử gốc; gọi lại (khi vẽ lại panel) chỉ cập nhật callback.
  if (root._multi) { Object.assign(root._multi, { onChange, creators }); return; }
  root._multi = { onChange, creators };
  const cfg = root._multi;
  root.addEventListener('click', async e => {
    const createBtn = e.target.closest('.multi-create');
    if (createBtn) {
      const box = createBtn.closest('.multi'), input = box.querySelector('.multi-search'), name = input.value.trim();
      const creator = cfg.creators[box.dataset.multi]; if (!creator || !name) return;
      createBtn.disabled = true;
      // Đóng danh sách trong lúc đang tạo: chờ tạo xong rồi mới so sánh / lưu (tránh mất lựa chọn vừa tạo).
      let done; box._pending = new Promise(r => { done = r; });
      try {
        const o = await creator(name);
        let opt = box.querySelector(`.multi-opts input[value="${o.id}"]`);
        if (!opt) { box.querySelector('.multi-opts').insertAdjacentHTML('beforeend', multiOption(box.dataset.multi, o, true)); opt = box.querySelector(`.multi-opts input[value="${o.id}"]`); }
        opt.checked = true; input.value = ''; filterMulti(box); refreshChips(box); input.focus();
      } catch (error) { toast(errorMessage(error), 'err'); }
      createBtn.disabled = false; done(); box._pending = null;
      return;
    }
    const btn = e.target.closest('.multi-btn');
    if (!btn) return;
    const list = btn.nextElementSibling, open = list.classList.contains('hidden');
    $$('.multi-list', root).forEach(l => l.classList.add('hidden'));
    if (open) {
      list.classList.remove('hidden');
      const search = list.querySelector('.multi-search'); if (search) { search.value = ''; filterMulti(btn.parentElement); search.focus(); }
      const before = JSON.stringify(readMulti(root, btn.parentElement.dataset.multi));
      const close = ev => {
        if (btn.parentElement.contains(ev.target)) return;
        document.removeEventListener('mousedown', close);
        list.classList.add('hidden');
        const name = btn.parentElement.dataset.multi;
        Promise.resolve(btn.parentElement._pending).then(() => { if (JSON.stringify(readMulti(root, name)) !== before) cfg.onChange?.(name, readMulti(root, name)); });
      };
      setTimeout(() => document.addEventListener('mousedown', close), 0);
    }
  });
  root.addEventListener('change', e => { if (e.target.closest('.multi-opts')) refreshChips(e.target.closest('.multi')); });
  root.addEventListener('input', e => { if (e.target.classList.contains('multi-search')) filterMulti(e.target.closest('.multi')); });
  root.addEventListener('keydown', e => {
    if (!e.target.classList.contains('multi-search') || e.key !== 'Enter') return;
    e.preventDefault();
    const box = e.target.closest('.multi'), visible = $$('.multi-opts label:not(.hidden)', box), create = box.querySelector('.multi-create:not(.hidden)');
    if (create) create.click();
    else if (visible.length === 1) { const i = visible[0].querySelector('input'); i.checked = !i.checked; refreshChips(box); }
  });
}
function filterMulti(box) {
  const q = box.querySelector('.multi-search')?.value.trim().toLowerCase() || '';
  const labels = $$('.multi-opts label', box);
  for (const l of labels) l.classList.toggle('hidden', !!q && !l.dataset.text.includes(q));
  const empty = box.querySelector('.multi-empty');
  if (empty) { empty.textContent = q ? 'Không có lựa chọn khớp' : 'Không có lựa chọn'; empty.classList.toggle('hidden', labels.some(l => !l.classList.contains('hidden')) || (!!q && !!box.querySelector('.multi-create'))); }
  const create = box.querySelector('.multi-create');
  if (create) {
    const exact = labels.some(l => l.dataset.text === q);
    create.classList.toggle('hidden', !q || exact);
    create.innerHTML = `+ Tạo nhãn mới “${esc(box.querySelector('.multi-search').value.trim())}”`;
  }
}
