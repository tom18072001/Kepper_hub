// Khối thu gọn trong panel việc: <details class="section sec" data-sec=khoá>. Mặc định mở/đóng theo vai trò và khâu;
// người dùng bấm mở/đóng thì nhớ theo người (uiPref) cho lần sau. Nội dung vẫn nằm trong DOM khi đóng.
import { uiPref } from '../util.js';

export function secOpen(key, fallback) {
  const pref = uiPref('ip:sec:' + key);
  return pref == null ? !!fallback : !!pref;
}
// opts: { title, count, summary, body, open, testid, id, cls }
export function sec(key, { title, count = '', summary = '', body = '', open = true, testid = '', id = '', cls = '' }) {
  return `<details class="section sec${cls ? ' ' + cls : ''}" data-sec="${key}"${testid ? ` data-testid="${testid}"` : ''}${id ? ` id="${id}"` : ''}${secOpen(key, open) ? ' open' : ''}>
    <summary><h4><span class="sec-title">${title}</span>${count !== '' && count != null ? ` <span class="muted xs">${count}</span>` : ''}${summary ? `<span class="sec-sum muted xs">${summary}</span>` : ''}</h4></summary>
    <div class="sec-body">${body}</div></details>`;
}
// Khối rỗng: một dòng gọn (tiêu đề + ô thêm), không chiếm chỗ.
export function compact(title, body, { testid = '', id = '' } = {}) {
  return `<div class="section sec-compact"${testid ? ` data-testid="${testid}"` : ''}${id ? ` id="${id}"` : ''}><h4>${title}</h4><div class="sec-compact-body">${body}</div></div>`;
}
// Ghi nhớ khi người dùng tự bấm mở / đóng một khối (không ghi khi mã tự mở).
export function bindSectionMemory(root) {
  if (root._secMem) return;
  root._secMem = true;
  root.addEventListener('click', e => {
    const sum = e.target.closest('details[data-sec] > summary');
    if (!sum || e.target.closest('a, button, input, select, textarea')) return;
    const d = sum.parentElement;
    setTimeout(() => uiPref('ip:sec:' + d.dataset.sec, d.open), 0);
  });
}
export function resetSectionMemory(keys) { for (const k of keys) uiPref('ip:sec:' + k, null); }
