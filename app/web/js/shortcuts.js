// Phím tắt kiểu Linear / Jira: "?" xem danh sách, "/" tìm nhanh, G rồi một chữ để chuyển trang, J/K di chuyển trong danh sách,
// Enter mở, C tạo việc; trong panel: S trạng thái, P ưu tiên, A phân công / người chủ trì, D hạn, R báo cáo tiến độ, M bình luận,
// V tới vùng "Cần bạn xử lý", E xin gia hạn, L nhãn.
// Không chạy khi đang gõ (ô nhập, vùng soạn thảo, danh sách chọn), khi bộ gõ tiếng Việt (Telex/VNI, Unikey/EVKey) đang ghép chữ,
// khi mở hộp thoại hoặc có phím Ctrl/Alt/⌘. Phím một chữ tắt được (WCAG 2.1.4). Khớp theo vị trí phím (e.code) để không vướng bộ gõ.
import { $, $$, esc, openModal, closeModal, uiPref } from './util.js';
import { store } from './store.js';

// G + chữ → trang (chỉ khi mục menu tương ứng đang hiện với người dùng).
const GO = [
  ['o', 'nav-ops', 'Tổng quan'], ['m', 'nav-my', 'Việc của tôi'], ['a', 'nav-approvals', 'Chờ tôi xử lý'], ['d', 'nav-dept', 'Việc phòng được giao / Uỷ quyền'],
  ['b', 'nav-dashboard', 'Dashboard'], ['k', 'nav-kpi', 'KPI'], ['t', 'nav-summary', 'Tổng hợp giao việc'], ['r', 'nav-trash', 'Thùng rác'], ['l', 'nav-schedule', 'Lịch công tác'],
  ['n', null, 'Ghi chú của tôi', () => '#/my?mode=notes'],
  ['s', null, 'Sổ giao việc của đơn vị', () => { const p = store.projects.find(x => x.visibility === 'ASSIGNED'); return p ? `#/projects/${p.id}?view=register` : null; }],
];
const HELP_PANEL = ['Trong panel việc', [['J / K', 'Việc sau / trước trong danh sách'], ['V', 'Tới vùng "Cần bạn xử lý" (ý kiến duyệt, trả lời, gia hạn)'], ['S', 'Đổi trạng thái'], ['P', 'Đổi ưu tiên'],
  ['A', 'Tiếp nhận & phân công / chọn người chủ trì'], ['D', 'Sửa hạn'], ['E', 'Xin gia hạn'], ['R', 'Báo cáo tiến độ'], ['L', 'Nhãn'], ['M', 'Viết bình luận'], ['Ctrl Enter', 'Gửi bình luận / báo cáo / trả lời, lưu hộp thoại'], ['Ctrl S', 'Lưu mô tả (khi đang soạn)']]];
export const HELP = [
  ['Chung', [['Ctrl K', 'Bảng lệnh: tìm trang, dự án, mã việc, số văn bản'], ['/', 'Tìm nhanh'], ['?', 'Danh sách phím tắt'], ['Esc', 'Đóng từng lớp: danh sách chọn → ô đang gõ → hộp thoại → panel'], ['C', 'Tạo việc (trong dự án; nơi khác: chọn dự án)']]],
  ['Chuyển trang (gõ G rồi chữ)', GO.map(([k, , label]) => [`G ${k.toUpperCase()}`, label])],
  ['Danh sách, bảng, sổ', [['J / K', 'Xuống / lên một việc'], ['Enter', 'Mở việc đang chọn'], ['F', 'Đến ô tìm / lọc của trang']]],
  HELP_PANEL,
];

const singleOn = () => uiPref('kbd:single') !== 'off';
const typing = el => !!el && (el.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !/^(checkbox|radio|range|button|submit)$/.test(el.type)) || !!el.closest?.('.multi-list, [role=listbox], [role=menu]'));
const visible = el => !!el && !el.closest('.hidden') && el.getClientRects().length > 0;
const overlayOpen = () => !$('#modalRoot').classList.contains('hidden') || !$('#paletteRoot').classList.contains('hidden');
const panelOpen = () => !$('#itemPanel').classList.contains('hidden');
// Chữ cái theo vị trí phím (KeyJ → 'j'), không theo ký tự bộ gõ tạo ra.
const letter = e => (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : null);

// Các dòng có thể chọn bằng J/K trên trang đang xem (theo thứ tự hiển thị).
const ROWS = '[data-href], [data-open], .ops-row, .attention, .kcard, tr.reg-row[data-id], .list-row[data-id], tr[data-id].clickable';
function rows() { return $$(ROWS, $('#view')).filter(visible); }
function rowId(el) {
  const href = el.getAttribute('data-href') || el.getAttribute('href') || '';
  const m = href.match(/[?&]item=(\d+)/);
  return m ? Number(m[1]) : Number(el.dataset.open || el.dataset.id) || null;
}
function openId() { const m = location.hash.match(/[?&]item=(\d+)/); return m ? Number(m[1]) : null; }
function mark(list, i) {
  $$('.kb-cursor').forEach(el => el.classList.remove('kb-cursor'));
  const el = list[i]; if (!el) return null;
  el.classList.add('kb-cursor');
  el.scrollIntoView({ block: 'nearest' });
  return el;
}
function activate(el) {
  if (!el) return;
  if (el.matches('a[href]')) { location.hash = el.getAttribute('href'); return; }
  el.click();
}
function move(delta, { open = false } = {}) {
  const list = rows(); if (!list.length) return;
  let cur = list.findIndex(el => el.classList.contains('kb-cursor'));
  // Panel đang mở (mở bằng chuột): đi tiếp từ đúng việc đang mở, không quay về đầu danh sách.
  if (open && (cur < 0 || rowId(list[cur]) !== openId())) { const k = list.findIndex(el => rowId(el) === openId()); if (k >= 0) cur = k; }
  const next = Math.max(0, Math.min(list.length - 1, (cur < 0 ? (delta > 0 ? -1 : list.length) : cur) + delta));
  const el = mark(list, next);
  if (open && next !== cur) activate(el);
}

export function help() {
  const groups = panelOpen() ? [HELP_PANEL, ...HELP.filter(g => g !== HELP_PANEL)] : HELP;
  const modal = openModal(`<h2>Phím tắt</h2>
    <label class="check sm kbd-toggle"><input type="checkbox" id="kbdSingle" ${singleOn() ? 'checked' : ''} data-testid="shortcuts-single"> Bật phím tắt một chữ (J, K, C, G…). Tắt nếu bạn hay bấm nhầm hoặc dùng phần mềm đọc màn hình — Ctrl K và Esc vẫn chạy.</label>
    <div class="kbd-help">${groups.map(([group, list]) => `<section><h3>${esc(group)}</h3><dl>${list.map(([k, v]) => `<div><dt>${k.split(' / ').map(g => g.split(' ').map(x => `<kbd>${esc(x)}</kbd>`).join(' ')).join(' <span class="muted">/</span> ')}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>`).join('')}</div>
    <p class="muted xs">Phím tắt không chạy khi bạn đang gõ trong ô nhập. Nếu bật Unikey / EVKey mà phím tắt không ăn, chuyển bộ gõ sang chế độ tiếng Anh (E).</p>
    <div class="modal-actions"><button class="btn btn-primary" data-close data-testid="shortcuts-close">Đóng</button></div>`, { wide: true });
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('#kbdSingle').onchange = e => { uiPref('kbd:single', e.target.checked ? null : 'off'); delete modal.dataset.dirty; };
}

function panelKey(key) {
  const p = $('#itemPanel');
  const reach = el => { el.closest('details.sec, details.ip-more')?.setAttribute('open', ''); el.closest('details:not(.sec):not(.ip-more)')?.setAttribute('open', ''); };
  const focus = sel => { const el = $(sel, p); if (!el || el.disabled) return false; reach(el); el.focus(); el.scrollIntoView({ block: 'center' }); try { el.showPicker?.(); } catch { /* trình duyệt không hỗ trợ */ } return true; };
  const click = sel => { const b = $(sel, p); if (!b) return false; reach(b); if (!visible(b)) return false; b.click(); return true; };
  if (key === 's') return focus('#ipState');
  if (key === 'p') return focus('#ipPriority');
  if (key === 'd') return focus('#ipDue') || focus('#ipInternalDue');
  if (key === 'a') return click('[data-act="accept"]') || click('[data-testid="multi-assignees"]');
  if (key === 'r') return click('[data-act="open-report"]') || click('[data-testid="report-open"]');
  if (key === 'e') return click('[data-testid="request-extension"]');
  if (key === 'l') return click('[data-testid="multi-labels"]');
  if (key === 'm') return focus('#newComment');
  if (key === 'v') {
    const z = $('.action-zone', p); if (!z) return false;
    z.scrollIntoView({ block: 'start' }); (z.querySelector('textarea, input:not([type=hidden])') || z.querySelector('button'))?.focus({ preventScroll: true });
    return true;
  }
  return false;
}

let gPending = 0, gHintTimer = null;
function gHint(show) {
  clearTimeout(gHintTimer); $('#gHint')?.remove();
  if (!show) return;
  gHintTimer = setTimeout(() => {
    const items = GO.filter(([, testid, , href]) => (testid ? visible($(`[data-testid="${testid}"]`)) : !!href?.()));
    document.body.insertAdjacentHTML('beforeend', `<div id="gHint" class="g-hint" role="status">G → ${items.map(([k, , label]) => `<kbd>${k.toUpperCase()}</kbd> ${esc(label)}`).join(' · ')}</div>`);
  }, 400);
}
export function initShortcuts() {
  // Gợi ý phím tắt trên menu.
  for (const [k, testid] of GO) { if (!testid) continue; const a = $(`[data-testid="${testid}"]`); if (a) { a.title = `${a.textContent.trim()} (G ${k.toUpperCase()})`; a.setAttribute('aria-keyshortcuts', `g ${k}`); } }
  const pb = $('#paletteBtn'); if (pb) { pb.title = 'Tìm nhanh (Ctrl K hoặc /)'; pb.setAttribute('aria-keyshortcuts', 'Control+K /'); }
  $('#shortcutsBtn')?.addEventListener('click', help);
  window.addEventListener('workhub:shortcuts', help);

  document.addEventListener('keydown', e => {
    if (!store.me || e.defaultPrevented || e.isComposing || e.key === 'Process' || e.keyCode === 229) return;
    // Ctrl/⌘ + Enter: gửi nhanh trong ô soạn hoặc lưu hộp thoại.
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const t = e.target;
      const btn = t.id === 'newComment' ? $('[data-act="comment"]', $('#itemPanel'))
        : t.closest?.('.report-form') ? $('[data-act="report"]', $('#itemPanel'))
          : t.dataset?.answerInput ? $(`[data-answer="${t.dataset.answerInput}"]`, $('#itemPanel'))
            : t.closest?.('#modal') ? $('#modal .modal-actions .btn-primary:not(.hidden)') : null;
      if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || overlayOpen()) return;
    // Ký tự do bộ gõ gửi giả lập (á, đ, ư…) hoặc phím không có vị trí: bỏ qua.
    if (e.key.length === 1 && /[^\x20-\x7e]/.test(e.key)) return;
    if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) { e.preventDefault(); return help(); }
    // Enter trên dòng đang có tiêu điểm (Tab tới) luôn mở việc — không phụ thuộc công tắc phím một chữ (người dùng trình đọc màn hình).
    if (e.key === 'Enter' && !e.shiftKey && document.activeElement?.matches?.('#view [data-href][tabindex], #view [data-open][tabindex]')) { e.preventDefault(); return activate(document.activeElement); }
    if (!singleOn()) return;
    const key = letter(e) || (e.code === 'Slash' ? '/' : e.key === 'Enter' ? 'Enter' : null);
    if (!key) return;
    if (gPending && Date.now() - gPending < 1500) {
      gPending = 0; gHint(false);
      const go = GO.find(([k]) => k === key);
      if (go) {
        const [, testid, , hrefFn] = go;
        const a = testid && $(`[data-testid="${testid}"]`);
        const href = a && visible(a) ? a.getAttribute('href') : !testid ? hrefFn?.() : null;
        if (href) { e.preventDefault(); location.hash = href; }
      }
      return;
    }
    gPending = 0; gHint(false);
    if (e.shiftKey) return;
    if (key === '/') { e.preventDefault(); return $('#paletteBtn')?.click(); }
    if (key === 'g') { gPending = Date.now(); gHint(true); return; }
    if (panelOpen()) {
      if (key === 'j' || key === 'k') { e.preventDefault(); return move(key === 'j' ? 1 : -1, { open: true }); }
      if (panelKey(key)) e.preventDefault();
      return;
    }
    if (key === 'j' || key === 'k') { e.preventDefault(); return move(key === 'j' ? 1 : -1); }
    if (key === 'Enter') { const el = $('.kb-cursor', $('#view')), a = document.activeElement; if (el && visible(el) && (!a || a === document.body || a === el || a === $('#view'))) { e.preventDefault(); activate(el); } return; }
    if (key === 'c') {
      const btn = $('#newItemBtn', $('#view')) || $('[data-testid="note-input"]', $('#view'));
      e.preventDefault();
      if (btn && visible(btn)) { btn.tagName === 'INPUT' ? btn.focus() : btn.click(); return; }
      import('./views/palette.js').then(m => m.openPalette({ mode: 'create' })).catch(() => {});
      return;
    }
    if (key === 'f') {
      const q = $('#view').querySelector('input[type=search], #fQ, .filters input, .filters select');
      if (q && visible(q)) { e.preventDefault(); q.focus(); }
    }
  });
  // Đổi trang: bỏ con trỏ cũ; Esc huỷ chuỗi G.
  window.addEventListener('hashchange', () => { if (!panelOpen()) $$('.kb-cursor').forEach(el => el.classList.remove('kb-cursor')); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && gPending) { gPending = 0; gHint(false); } }, true);
}
