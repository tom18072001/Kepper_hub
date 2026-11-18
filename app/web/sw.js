// Kepler Hub — service worker tối thiểu để cài như ứng dụng (PWA).
// KHÔNG lưu dữ liệu nghiệp vụ / API vào bộ nhớ đệm (dữ liệu Nội bộ / Bảo mật): mọi yêu cầu đi thẳng lên máy chủ.
// Chỉ khi mất mạng mà mở trang, hiện thông báo ngắn thay cho trang lỗi của trình duyệt.
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kepler Hub</title><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#09334C">
<div style="text-align:center;max-width:320px"><h1 style="font-size:20px">Chưa kết nối được Kepler Hub</h1>
<p style="color:#566270">Kiểm tra mạng công ty hoặc VPN, rồi bấm thử lại.</p>
<button onclick="location.reload()" style="padding:10px 18px;border-radius:8px;border:0;background:#09334C;color:#fff;font-size:15px">Thử lại</button></div>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return; // để trình duyệt tự xử lý, không đệm
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
