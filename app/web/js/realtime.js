// Nhận cập nhật thời gian thực qua fetch streaming (gửi token trong header, không đưa lên URL).
import { getToken } from './api.js';

let controller = null, retryTimer = null, handlers = {}, connected = false;
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
    if (!res.ok || !res.body) throw new Error('stream ' + res.status);
    setLive(true);
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
  retryTimer = setTimeout(connect, 3000);
}
