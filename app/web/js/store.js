// Trạng thái dùng chung của ứng dụng (người dùng hiện tại, danh mục).
import { api } from './api.js';

export const store = { me: null, projects: [], departments: [], labels: [], users: [], settings: { dueSoonDays: 3, sources: [] }, templates: [] };

export function can(key, action = 'view') {
  const p = store.me?.permissions?.[key];
  return !!(p && p[action]);
}
export async function loadBasics() {
  const [projects, departments, labels, users, settings, templates] = await Promise.all([
    api('/api/projects'), api('/api/departments'), api('/api/labels'), api('/api/users/directory'), api('/api/settings'), api('/api/templates'),
  ]);
  Object.assign(store, { projects, departments, labels, users, settings, templates });
}
export async function reloadProjects() { store.projects = await api('/api/projects'); return store.projects; }
// Nhãn dùng được trong một dự án: nhãn chung + nhãn riêng của dự án đó.
export const labelsFor = projectId => store.labels.filter(l => l.projectId == null || l.projectId === Number(projectId));
// Tạo (hoặc lấy lại nếu đã có, không phân biệt hoa thường) nhãn riêng của dự án.
export async function createProjectLabel(projectId, name) {
  const label = await api(`/api/projects/${projectId}/labels`, { method: 'POST', body: { name } });
  if (!store.labels.some(l => l.id === label.id)) store.labels.push(label);
  return label;
}
export const isItAdmin = () => !!store.me && (store.me.isRootAdmin || store.me.role === 'admin');
export const userById = id => store.users.find(u => u.id === Number(id));
export const deptName = id => store.departments.find(d => d.id === Number(id))?.name || '—';
// Phạm vi xem "Tổng thể công việc" (khớp services/work.js): SYSTEM mọi người / phòng; UNIT phòng mình; SELF chính mình.
export function workScope() {
  if (!store.me || isItAdmin()) return null;
  const p = store.me.permissions || {};
  if (p['work.view']?.view === 'SYSTEM') return 'SYSTEM';
  if (store.me.departmentId != null && p['work.approve']?.operate === 'UNIT') return 'UNIT';
  return 'SELF';
}
// Người xem có mở được trang việc của người / phòng này không (để chỉ hiện tên dạng liên kết khi bấm được).
export function canSeeWorkOf(kind, id) {
  const s = workScope(), me = store.me;
  if (!s || id == null) return false;
  if (s === 'SYSTEM') return true;
  if (kind === 'user') {
    if (Number(id) === me.id) return true;
    return s === 'UNIT' && Number(userById(id)?.departmentId) === Number(me.departmentId);
  }
  return s === 'UNIT' && Number(id) === Number(me.departmentId);
}
const escH = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Tên người / phòng bấm được → "Tổng thể công việc" lọc theo người / phòng đó. Dùng span + data-* để đặt được trong hàng là liên kết.
export function personLink(user, text = user?.fullName) {
  if (!user) return '';
  return canSeeWorkOf('user', user.id) ? `<span class="plink" role="link" tabindex="0" data-person="${Number(user.id)}" title="Xem mọi việc của ${escH(user.fullName)}">${escH(text)}</span>` : escH(text);
}
export function deptLink(id, name = deptName(id)) {
  return canSeeWorkOf('dept', id) ? `<span class="plink" role="link" tabindex="0" data-dept-link="${Number(id)}" title="Xem mọi việc của ${escH(name)}">${escH(name)}</span>` : escH(name);
}
