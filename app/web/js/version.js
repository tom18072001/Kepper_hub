// Có bản mới sau khi nâng cấp máy chủ: tab đang mở vẫn chạy JS cũ cho tới khi tải lại trang, mà JS cũ gọi API mới có thể lỗi.
// Máy chủ ghi mã bản giao diện vào trang (<meta name="kepler-build">) và vào mọi phản hồi API (header X-Kepler-Build, /api/health).
// Mã khác → thanh "Có bản mới · Tải lại". Không tự tải lại khi người dùng đang gõ dở: chỉ tự tải lại khi tab đã ẩn quá 1 phút
// mà không còn nội dung nhập dở và không có yêu cầu ghi đang gửi.
const HIDDEN_RELOAD_MS = 60_000;   // chuyển sang tab khác chốc lát thì không bị tải lại
const CHECK_EVERY_MS = 5 * 60_000; // trang đăng nhập, tab không gọi API nào: hỏi /api/health định kỳ
const RELOADED_KEY = 'kepler:auto-reloaded';
const FIELDS = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea';

let mine = document.querySelector('meta[name="kepler-build"]')?.content || '';
let latest = '', lastSeen = 0, writes = 0, hiddenTimer = null;

// Mã bản trên mỗi phản hồi API (api.js, realtime.js, /api/health).
export function noteBuild(id) {
  if (!id) return;
  lastSeen = Date.now();
  // Trang không qua máy chủ điền mã (không có meta): mã đầu tiên nhận được là mã của bản đang chạy.
  if (!mine) { mine = id; return; }
  if (id === mine || id === latest) return;
  latest = id;
  showBar();
  if (document.visibilityState === 'hidden') scheduleHiddenReload();
}
export const updateReady = () => !!latest;

// Yêu cầu ghi đang gửi (lưu, tải tệp lên): không tự tải lại giữa chừng. Trả về hàm báo xong.
export function writeStarted() {
  writes++;
  let done = false;
  return () => { if (!done) { done = true; writes--; } };
}

export async function checkBuild() {
  try { noteBuild((await fetch('/api/health', { cache: 'no-store' })).headers.get('x-kepler-build')); } catch { /* mất mạng: lần sau */ }
}

// Còn nội dung nhập dở: hộp thoại đã nhập, đang sửa mô tả, hoặc ô đang hiện có giá trị khác lúc vẽ.
export function hasUnsavedInput() {
  if (document.querySelector('#modal[data-dirty="1"]')) return true;
  if (document.activeElement?.isContentEditable) return true;
  return [...document.querySelectorAll(FIELDS)].some(el => el.getClientRects().length > 0 && el.value.trim() !== el.defaultValue.trim());
}

function showBar() {
  let bar = document.getElementById('updateBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'updateBar';
    bar.className = 'update-bar';
    bar.setAttribute('role', 'status');
    bar.dataset.testid = 'update-bar';
    bar.addEventListener('click', e => {
      const act = e.target.closest('[data-update]')?.dataset.update;
      if (act === 'reload') { if (hasUnsavedInput()) renderBar(bar, true); else location.reload(); }
      else if (act === 'force') location.reload();
      else if (act === 'later') renderBar(bar, false);
    });
    document.body.append(bar);
  }
  renderBar(bar, false);
}
function renderBar(bar, confirming) {
  bar.classList.toggle('confirming', confirming);
  bar.innerHTML = confirming
    ? `<span class="ub-text">Bạn đang nhập dở. Tải lại sẽ mất nội dung chưa lưu.</span>
      <button type="button" class="ub-btn" data-update="force" data-testid="update-reload-force">Vẫn tải lại</button>
      <button type="button" class="ub-btn ub-ghost" data-update="later" data-testid="update-later">Để sau</button>`
    : `<span class="ub-dot" aria-hidden="true"></span><span class="ub-text">Có bản mới</span><span class="ub-sep" aria-hidden="true">·</span>
      <button type="button" class="ub-btn" data-update="reload" title="Kepler Hub vừa được nâng cấp. Tải lại trang để dùng bản mới." data-testid="update-reload">Tải lại</button>`;
  if (confirming) bar.querySelector('[data-update="later"]').focus();
}

// Tab ẩn (thu nhỏ, chuyển tab khác) quá 1 phút và không có gì dở dang: tự tải lại để khi quay lại đã là bản mới.
function scheduleHiddenReload() {
  clearTimeout(hiddenTimer);
  hiddenTimer = setTimeout(() => {
    if (!latest || document.visibilityState !== 'hidden') return;
    if (writes > 0 || hasUnsavedInput()) return scheduleHiddenReload();
    // Mỗi mã bản chỉ tự tải lại một lần: tải lại rồi mà vẫn nhận trang cũ thì chỉ hiện thanh, không tải lại liên tục.
    try { if (sessionStorage.getItem(RELOADED_KEY) === latest) return; sessionStorage.setItem(RELOADED_KEY, latest); } catch { return; }
    location.reload();
  }, HIDDEN_RELOAD_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { if (latest) scheduleHiddenReload(); return; }
  clearTimeout(hiddenTimer);
  if (Date.now() - lastSeen > 60_000) checkBuild();
});
// Trang lấy lại từ bộ nhớ "quay lại" của trình duyệt (bfcache) vẫn là JS cũ: hỏi lại ngay.
addEventListener('pageshow', e => { if (e.persisted) checkBuild(); });
addEventListener('online', () => checkBuild());
setInterval(() => { if (Date.now() - lastSeen >= CHECK_EVERY_MS - 5_000) checkBuild(); }, CHECK_EVERY_MS);
checkBuild();
