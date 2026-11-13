// Cài Kepler Hub như một ứng dụng (Edge / Chrome): đăng ký service worker, giữ lời mời cài để hiện nút "Cài ứng dụng".
let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());

export const isInstalled = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
export const canInstall = () => !!deferred && !isInstalled();
export const onInstallChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export async function promptInstall() {
  if (!deferred) return 'unavailable';
  const ev = deferred; deferred = null; notify();
  ev.prompt();
  const { outcome } = await ev.userChoice;
  return outcome; // 'accepted' | 'dismissed'
}

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {}));
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; notify(); });
window.addEventListener('appinstalled', () => { deferred = null; notify(); });
