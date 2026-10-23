// Gọi API kèm token; tự xử lý hết phiên và yêu cầu đổi mật khẩu.
const TOKEN_KEY = 'workhub_token';
let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch { token = null; }

const listeners = { unauthorized: () => {}, mustChangePassword: () => {} };
export function onAuthEvent(name, fn) { listeners[name] = fn; }
export function getToken() { return token; }
export function setToken(value) {
  token = value;
  try { if (value) localStorage.setItem(TOKEN_KEY, value); else localStorage.removeItem(TOKEN_KEY); } catch { /* bộ nhớ trình duyệt bị chặn */ }
}

export class ApiError extends Error {
  constructor(status, body) { super(body?.error || `Lỗi ${status}`); this.status = status; this.code = body?.code; this.body = body; }
}

// Đồng hồ máy chủ lệch (PC ngủ / VM Docker lệch giờ) làm sai giờ nộp báo cáo và điểm tuân thủ: cảnh báo một lần mỗi phiên.
let clockChecked = false;
function checkClock(res) {
  if (clockChecked) return;
  const d = Date.parse(res.headers.get('date') || '');
  if (!Number.isFinite(d)) return;
  clockChecked = true;
  const skew = Math.round((d - Date.now()) / 60_000);
  if (Math.abs(skew) >= 3) setTimeout(() => listeners.clockSkew?.(skew), 0);
}

// Thời điểm người dùng vừa tự thay đổi dữ liệu (để bỏ qua sự kiện realtime do chính mình gây ra — giao diện đã tự tải lại).
export let lastLocalWrite = 0;
export async function api(path, { method = 'GET', body, form, raw = false, signal } = {}) {
  if (method !== 'GET') lastLocalWrite = Date.now();
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(path, { method, headers, body: payload, signal });
  checkClock(res);
  if (raw && res.ok) return res;
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) listeners.unauthorized();
    if (res.status === 403 && data?.code === 'PASSWORD_CHANGE_REQUIRED') listeners.mustChangePassword();
    throw new ApiError(res.status, data);
  }
  return data;
}

// Tải tệp có xác thực về dạng blob.
export async function fetchBlob(path) {
  const res = await api(path, { raw: true });
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="([^"]+)"/i);
  return { blob: await res.blob(), fileName: match ? decodeURIComponent(match[1]) : 'tep' };
}
export async function download(path) {
  const { blob, fileName } = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return fileName;
}
export async function openPreview(path) {
  const win = window.open('', '_blank');
  const { blob } = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  if (win) win.location.href = url; else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
