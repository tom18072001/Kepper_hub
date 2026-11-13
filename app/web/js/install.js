// Trang công khai "Cài Kepler Hub" (install.html): nút cài khi trình duyệt cho phép, tên công ty và logo nếu máy chủ có.
import { canInstall, promptInstall, onInstallChange, isInstalled } from './pwa.js';

const $ = s => document.querySelector(s);
function sync() {
  const done = isInstalled();
  $('#stDone').classList.toggle('hidden', !done);
  $('#installBtn').classList.toggle('hidden', !canInstall());
  $('#stManual').classList.toggle('hidden', canInstall() || done);
}
$('#installBtn').addEventListener('click', async () => { if (await promptInstall() === 'accepted') { $('#stDone').classList.remove('hidden'); } sync(); });
window.addEventListener('appinstalled', () => { $('#stDone').classList.remove('hidden'); sync(); });
onInstallChange(sync);
sync();

fetch('api/brand').then(r => (r.ok ? r.json() : null)).then(b => {
  if (!b) return;
  if (b.name) $('#org').textContent = `Theo dõi tiến độ dự án · ${b.name}`;
  if (b.files?.includes('mark.png')) $('#appIcon').src = 'branding/mark.png';
}).catch(() => {});
