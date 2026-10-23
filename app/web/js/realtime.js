// Nhận cập nhật thời gian thực qua fetch streaming (gửi token trong header, không đưa lên URL).
import { getToken } from './api.js';

let controller = null, retryTimer = null, handlers = {}, connected = false, failures = 0;
const listeners = new Set();

export function onRealtime(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function isLive() { return connected; }
function setLive(value) {
  connected = value;
  document.querySelectorAll('#liveDot').forEach(el => el.classList.toggle('hidden', !value));
  handlers.status?.(value);
}

export function startRealtime(options = {}) {
  handlers = options;
  stopRealtime();
  connect();
}
export function stopRealtime() {
  clearTimeout(retryTimer);
  if (controller) controller.abort();
  controller = null;
  setLive(false);
}

async function connect() {
  const token = getToken();
  if (!token) return;
  controller = new AbortController();
  const mine = controller;
  try {
    const res = await fetch('/api/stream', { headers: { authorization: 'Bearer ' + token }, signal: mine.signal, cache: 'no-store' });
    // Phiên hết hạn / bị thu hồi: dừng hẳn (không gọi lại mỗi 3 giây cả đêm) — api.js đưa về màn đăng nhập ở lần gọi kế tiếp.
    if (res.status === 401 || res.status === 403) { setLive(false); controller = null; return; }
    if (!res.ok || !res.body) throw new Error('stream ' + res.status);
    setLive(true); failures = 0;
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const event = (chunk.match(/^event: (.+)$/m) || [])[1];
        const data = (chunk.match(/^data: (.+)$/m) || [])[1];
        if (event) { const payload = data ? JSON.parse(data) : {}; for (const fn of listeners) fn(event, payload); }
      }
    }
  } catch { /* mất kết nối hoặc bị huỷ */ }
  if (controller !== mine) return; // đã dừng/khởi động lại
  setLive(false);
  // Kết nối lại giãn dần (3 s → 60 s) có độ lệch ngẫu nhiên: máy chủ khởi động lại không bị mọi tab gọi dồn cùng lúc.
  failures++;
  retryTimer = setTimeout(connect, Math.min(60_000, 3000 * 2 ** Math.min(failures - 1, 5)) * (0.75 + Math.random() * 0.5));
}
