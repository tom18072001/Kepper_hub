// Thùng rác: việc và dự án đã xoá, khôi phục được trong 7 ngày; quá hạn hệ thống xoá hẳn.
import { api } from '../api.js';
import { reloadProjects } from '../store.js';
import { esc, fmtDateTime, toast, errorMessage } from '../util.js';
import { renderProjectNav } from '../main.js';

const left = d => { const ms = new Date(d) - Date.now(); const days = Math.ceil(ms / 86_400_000); return ms <= 0 ? 'sắp xoá hẳn' : days <= 1 ? 'còn dưới 1 ngày' : `còn ${days} ngày`; };

export async function renderTrash(root, setCrumbs) {
  setCrumbs('Thùng rác');
  const t = await api('/api/trash');
  root.innerHTML = `<div class="page-head"><h1>Thùng rác</h1><span class="muted sm">Khôi phục được trong ${t.days} ngày kể từ lúc xoá; sau đó hệ thống xoá hẳn, kể cả tệp đính kèm.</span></div>
    ${t.projects.length ? `<div class="card" style="margin-bottom:16px"><h3>Dự án đã xoá</h3><table class="table" data-testid="trash-projects"><thead><tr><th>Dự án</th><th>Phòng ban</th><th>Số việc</th><th>Xoá bởi</th><th>Xoá lúc</th><th>Thời hạn</th><th></th></tr></thead><tbody>
      ${t.projects.map(p => `<tr data-testid="trash-project-${esc(p.key)}"><td><span class="code">${esc(p.key)}</span> <b>${esc(p.name)}</b></td><td>${esc(p.department || '')}</td><td class="num">${p.items}</td><td>${esc(p.deletedBy || '')}</td><td class="muted sm">${fmtDateTime(p.deletedAt)}</td>
        <td><span class="pill">${left(p.purgeAt)}</span></td><td class="actions"><button class="btn btn-ghost btn-sm" data-restore-project="${p.id}" data-testid="restore-project">Khôi phục</button></td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="card"><h3>Công việc đã xoá</h3>${t.items.length ? `<table class="table" data-testid="trash-items"><thead><tr><th>Mã</th><th>Công việc</th><th>Dự án</th><th>Xoá bởi</th><th>Xoá lúc</th><th>Thời hạn</th><th></th></tr></thead><tbody>
      ${t.items.map(i => `<tr data-testid="trash-${esc(i.code)}"><td class="code">${esc(i.code)}</td><td>${esc(i.title)}${i.isChild ? ' <span class="muted xs">(việc con)</span>' : ''}</td><td>${esc(i.projectName)}</td><td>${esc(i.deletedBy || '')}</td><td class="muted sm">${fmtDateTime(i.deletedAt)}</td>
        <td><span class="pill">${left(i.purgeAt)}</span></td><td class="actions"><button class="btn btn-ghost btn-sm" data-restore-item="${i.id}" data-testid="restore-item">Khôi phục</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty" data-testid="trash-empty">Thùng rác trống.</div>'}</div>`;
  root.onclick = async e => {
    const ri = e.target.closest('[data-restore-item]'), rp = e.target.closest('[data-restore-project]');
    try {
      if (ri) { await api(`/api/items/${ri.dataset.restoreItem}/restore`, { method: 'POST' }); toast('Đã khôi phục công việc', 'ok'); }
      if (rp) { await api(`/api/projects/${rp.dataset.restoreProject}/restore`, { method: 'POST' }); toast('Đã khôi phục dự án', 'ok'); await reloadProjects(); renderProjectNav(); }
    } catch (error) { toast(errorMessage(error), 'err'); }
    if (ri || rp) renderTrash(root, setCrumbs);
  };
}
