// Quản trị: tài khoản (tạo/sửa/khoá + bàn giao/reset/phân quyền), phòng ban, nhãn, nhật ký hệ thống.
import { api } from '../api.js';
import { store, can, loadBasics } from '../store.js';
import { $, $$, esc, ROLE_LABEL, fmtDateTime, toast, openModal, closeModal, formData, confirmDialog, errorMessage, labelChip } from '../util.js';

const ICON = {
  plus: '<svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
  prev: '<svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m15 18-6-6 6-6"/></svg>',
  next: '<svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"/></svg>',
  undo: '<svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
};

export async function renderAdmin(root, section, params, setCrumbs) {
  const map = { users: renderUsers, departments: renderDepartments, labels: renderLabels, audit: renderAudit };
  setCrumbs('<span class="muted">Quản trị /</span> ' + ({ users: 'Tài khoản', departments: 'Phòng ban', labels: 'Nhãn', audit: 'Nhật ký hệ thống' }[section] || ''));
  await (map[section] || renderUsers)(root, params);
}

// ---------- Quyền: nhãn tiếng Việt + so sánh với hồ sơ vai trò ----------
let catalogCache = null;
const getCatalog = async () => (catalogCache ||= await api('/api/permissions/catalog'));
const ACTION_TEXT = { VIEW: 'Xem', OPERATE: 'Thao tác' }, SCOPE_TEXT = { UNIT: 'Phòng ban', SYSTEM: 'Toàn tổ chức' };
const slot = g => g.permissionKey + '|' + g.action;
function grantName(cat, g) {
  const p = cat.permissions.find(x => x.key === g.permissionKey);
  return `${esc(p ? p.label : g.permissionKey)} <span class="muted xs">· ${ACTION_TEXT[g.action] || esc(g.action)}</span>`;
}
// Cùng quy tắc với server (routes/admin.js profileDiff): thêm / bỏ / đổi phạm vi theo từng ô quyền + hành động.
function diffGrants(current = [], target = []) {
  const cur = new Map(current.map(g => [slot(g), g.scope])), next = new Map(target.map(g => [slot(g), g.scope]));
  const rows = [];
  for (const [k, scope] of next) {
    const [permissionKey, action] = k.split('|');
    if (!cur.has(k)) rows.push({ kind: 'add', permissionKey, action, to: scope });
    else if (cur.get(k) !== scope) rows.push({ kind: 'change', permissionKey, action, from: cur.get(k), to: scope });
  }
  for (const [k, scope] of cur) if (!next.has(k)) { const [permissionKey, action] = k.split('|'); rows.push({ kind: 'remove', permissionKey, action, from: scope }); }
  const order = new Map(permOrder);
  return rows.sort((a, b) => (order.get(a.permissionKey) ?? 99) - (order.get(b.permissionKey) ?? 99));
}
function diffSummary(rows) {
  const n = k => rows.filter(r => r.kind === k).length;
  return [n('add') && `thêm ${n('add')}`, n('remove') && `bỏ ${n('remove')}`, n('change') && `đổi phạm vi ${n('change')}`].filter(Boolean).join(', ');
}
function diffTable(cat, rows, testid = 'perm-diff') {
  if (!rows.length) return '<p class="muted sm">Không có khác biệt.</p>';
  const tag = { add: '<span class="pill ok">Thêm</span>', remove: '<span class="pill warn">Bỏ</span>', change: '<span class="pill">Đổi phạm vi</span>' };
  return `<table class="table diff-table" data-testid="${testid}"><thead><tr><th>Thay đổi</th><th>Quyền</th><th>Phạm vi</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="diff-${r.kind}"><td>${tag[r.kind]}</td><td>${grantName(cat, r)}</td><td class="sm">${r.kind === 'add' ? SCOPE_TEXT[r.to] : r.kind === 'remove' ? `<s>${SCOPE_TEXT[r.from]}</s>` : `${SCOPE_TEXT[r.from]} → <b>${SCOPE_TEXT[r.to]}</b>`}</td></tr>`).join('')}</tbody></table>`;
}
let permOrder = [];
function rememberOrder(cat) { permOrder = cat.permissions.map((p, i) => [p.key, i]); }

// ---------- Tài khoản ----------
async function renderUsers(root) {
  const users = await api('/api/admin/users');
  adminUsersCache = null;
  const canEdit = can('admin.users', 'operate'), canPerm = can('admin.permissions');
  root.innerHTML = `<div class="page-head"><h1>Tài khoản</h1>${canEdit ? `<button class="btn btn-primary" id="addUser" data-testid="add-user">${ICON.plus}Tạo tài khoản</button>` : ''}</div>
    <div class="admin-scroll"><table class="table admin-cards adm-users" data-testid="users-table"><thead><tr><th>Tài khoản</th><th>Họ tên</th><th>Nhóm</th><th>Phòng ban</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th></th></tr></thead><tbody>
    ${users.map(u => `<tr data-testid="user-${esc(u.username)}"><td class="card-title" data-label="Tài khoản"><b>${esc(u.username)}</b>${u.isRootAdmin ? ' <span class="pill">Gốc</span>' : ''}</td>
      <td class="adm-name" data-label="Họ tên"><span>${esc(u.fullName)}<span class="muted xs adm-block">${esc(u.displayTitle || '')}</span></span></td>
      <td data-label="Nhóm"><span>${ROLE_LABEL[u.role] || esc(u.role)}${u.profileMismatch ? ` <span class="pill warn" title="Quyền hiện tại khác quyền mặc định của nhóm tài khoản — mở Phân quyền để xem và khôi phục" data-testid="mismatch-${esc(u.username)}">Lệch quyền</span>` : ''}</span></td>
      <td data-label="Phòng ban"><span>${esc(u.department?.name || '—')}${u.department && store.departments.find(d => d.id === u.department.id)?.isActive === false ? ' <span class="muted xs">(đã khoá)</span>' : ''}</span></td>
      <td data-label="Trạng thái">${u.isActive ? (u.mustChangePw ? '<span class="pill">Chờ đổi mật khẩu</span>' : '<span class="pill">Hoạt động</span>') : '<span class="pill">Đã khoá</span>'}</td>
      <td class="muted sm" data-label="Đăng nhập gần nhất">${u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '—'}</td>
      <td class="actions">${canEdit && !u.isRootAdmin ? `<button class="btn btn-ghost btn-sm" data-edit="${u.id}" data-testid="edit-${esc(u.username)}">Sửa</button><button class="btn btn-ghost btn-sm" data-reset="${u.id}">Reset MK</button>` : ''}${canPerm && !u.isRootAdmin ? `<button class="btn btn-ghost btn-sm" data-perm="${u.id}" data-testid="perm-${esc(u.username)}">Phân quyền</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  root.onclick = async e => {
    if (e.target.closest('#addUser')) return userForm(root);
    const edit = e.target.closest('[data-edit]'); if (edit) return userForm(root, users.find(u => u.id === Number(edit.dataset.edit)));
    const reset = e.target.closest('[data-reset]');
    if (reset) {
      const u = users.find(x => x.id === Number(reset.dataset.reset));
      const extra = u.role === 'director' ? ' Đây là tài khoản Ban giám đốc — Ban giám đốc sẽ được thông báo.' : '';
      if (await confirmDialog(`Reset mật khẩu của ${u.username} về mật khẩu mặc định? Tài khoản sẽ phải đổi mật khẩu ở lần đăng nhập tới.${extra}`, { okText: 'Reset' }))
        await api(`/api/admin/users/${u.id}/reset-password`, { method: 'POST' }).then(() => toast('Đã reset mật khẩu', 'ok')).catch(err => toast(errorMessage(err), 'err'));
      return;
    }
    const perm = e.target.closest('[data-perm]'); if (perm) return permissionEditor(root, Number(perm.dataset.perm), users);
  };
}

// Ô chọn phòng ban: phòng đang hoạt động + phòng hiện tại của tài khoản kể cả khi đã khoá (không làm mất phòng khi sửa).
function departmentOptions(currentId) {
  return store.departments.filter(d => d.isActive || d.id === currentId)
    .map(d => `<option value="${d.id}"${currentId === d.id ? ' selected' : ''}>${esc(d.name)}${d.isActive ? '' : ' (đã khoá)'}</option>`).join('');
}
function countsBox(w) {
  const item = (n, label, hint = '') => `<div><b>${n}</b><span class="muted xs">${label}</span>${hint ? `<span class="muted xs">${hint}</span>` : ''}</div>`;
  return `<div class="admin-counts" data-testid="workload">
    ${item(w.leadOpen, 'việc đang chủ trì', w.leadOnly ? `${w.leadOnly} việc chỉ người này chủ trì` : '')}
    ${item(w.supportOpen, 'việc đang phối hợp')}
    ${item(w.approvalsPending, 'yêu cầu duyệt đang chờ')}
    ${item(w.delegationsFrom + w.delegationsTo, 'uỷ quyền còn hiệu lực', w.delegationsFrom + w.delegationsTo ? `${w.delegationsFrom} giao đi · ${w.delegationsTo} nhận` : '')}
    ${item(w.supervisedDepartments, 'phòng đang làm PGĐ phụ trách')}</div>`;
}
const hasWork = w => !!(w.leadOpen || w.supportOpen || w.delegationsFrom || w.delegationsTo || w.supervisedDepartments);

function userForm(root, user = null) {
  const canPermWrite = can('admin.permissions', 'operate');
  const modal = openModal(`<h2>${user ? 'Sửa tài khoản ' + esc(user.username) : 'Tạo tài khoản'}</h2><form>
    <div class="grid2"><label class="field">Tài khoản<input name="username" required value="${esc(user?.username || '')}" pattern="[a-z0-9._\\-]{3,50}" title="Chữ thường, số, . _ -" data-testid="user-username"></label>
    <label class="field">Họ tên<input name="fullName" required value="${esc(user?.fullName || '')}" data-testid="user-fullname"></label>
    <label class="field">Chức danh<input name="displayTitle" value="${esc(user?.displayTitle || '')}"></label>
    <label class="field">Email<input name="email" type="email" value="${esc(user?.email || '')}"></label>
    <label class="field">Nhóm tài khoản<select name="role" data-testid="user-role">${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}"${(user?.role || 'member') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="field">Phòng ban<select name="departmentId" data-testid="user-department"><option value="">— Không thuộc phòng ban —</option>${departmentOptions(user?.departmentId ?? null)}</select></label>
    ${user ? `<label class="check"><input type="checkbox" name="isActive" ${user.isActive ? 'checked' : ''} data-testid="user-active"> Đang hoạt động</label>` : '<label class="field">Mật khẩu ban đầu<input name="password" type="password" placeholder="Để trống: mật khẩu mặc định" autocomplete="new-password"></label>'}</div>
    ${user ? '<div id="roleBox" class="hidden"></div><div id="lockBox" class="hidden"></div>' : '<p class="muted xs">Quyền ban đầu được cấp theo nhóm tài khoản; có thể chỉnh ở mục Phân quyền.</p>'}
    <p class="error" id="userError"></p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="user-save">Lưu</button></div></form>`);
  modal.querySelector('[data-close]').onclick = () => closeModal();
  const form = modal.querySelector('form');
  let grantsCache = null, workload = null;

  // Đổi Nhóm tài khoản: hỏi có áp quyền mặc định của vai trò mới không, kèm bảng khác biệt.
  const roleBox = $('#roleBox', modal), lockBox = $('#lockBox', modal);
  async function showRoleBox() {
    const role = form.elements.role.value;
    if (!user || role === user.role) { roleBox.classList.add('hidden'); roleBox.innerHTML = ''; return; }
    roleBox.className = 'admin-box';
    if (!canPermWrite) { roleBox.innerHTML = `<h4>Đổi nhóm sang ${esc(ROLE_LABEL[role])}</h4><p class="muted sm">Bạn không có quyền Phân quyền: quyền hiện tại của tài khoản được giữ nguyên. Báo người phụ trách phân quyền dùng "Khôi phục quyền theo vai trò".</p>`; return; }
    roleBox.innerHTML = '<p class="muted sm">Đang so sánh quyền…</p>';
    try {
      const [cat, data] = await Promise.all([getCatalog(), grantsCache || api(`/api/admin/users/${user.id}/permissions`)]);
      grantsCache = data; rememberOrder(cat);
      if (form.elements.role.value !== role) return;
      const rows = diffGrants(data.grants, cat.roleProfiles[role] || []);
      roleBox.innerHTML = `<h4>Áp quyền mặc định của vai trò mới?</h4>
        <p class="muted sm">${esc(ROLE_LABEL[user.role] || user.role)} → <b>${esc(ROLE_LABEL[role])}</b>. ${rows.length ? `Quyền hiện tại sẽ được thay bằng quyền mặc định của nhóm mới (${diffSummary(rows)}):` : 'Quyền hiện tại đã trùng quyền mặc định của nhóm mới.'}</p>
        ${rows.length ? `${diffTable(cat, rows)}
        <label class="check"><input type="radio" name="applyProfile" value="1" checked data-testid="apply-profile-yes"> Áp quyền mặc định của vai trò mới (khuyến nghị)</label>
        <label class="check"><input type="radio" name="applyProfile" value="0" data-testid="apply-profile-no"> Giữ nguyên quyền hiện tại</label>
        ${role === 'director' ? '<p class="muted xs">Tài khoản Ban giám đốc có quyền xem, duyệt công việc toàn tổ chức — Ban giám đốc sẽ được thông báo.</p>' : ''}` : ''}`;
    } catch (error) { roleBox.innerHTML = `<p class="error">${esc(errorMessage(error))}</p>`; }
  }
  // Khoá tài khoản (nghỉ việc): hiện số đếm khối lượng đang có + tuỳ chọn trả việc về lãnh đạo phòng.
  async function showLockBox() {
    if (!user) return;
    const active = form.elements.isActive.checked, locking = user.isActive && !active, lockedAlready = !user.isActive && !active;
    if (!locking && !lockedAlready) { lockBox.className = 'hidden'; return; }
    lockBox.className = 'admin-box warn';
    lockBox.innerHTML = '<p class="muted sm">Đang đếm việc đang có…</p>';
    try {
      workload ||= await api(`/api/admin/users/${user.id}/workload`);
      if (lockedAlready && !hasWork(workload)) { lockBox.className = 'hidden'; return; }
      lockBox.innerHTML = `<h4>${locking ? 'Khoá tài khoản (nghỉ việc)' : 'Tài khoản đã khoá nhưng còn việc'}</h4>
        <p class="muted sm">Chỉ hiện số đếm, không hiện nội dung công việc.</p>${countsBox(workload)}
        ${hasWork(workload) ? `<label class="check"><input type="checkbox" name="handover" ${locking ? 'checked' : ''} data-testid="user-handover"> Trả việc về lãnh đạo phòng để phân công lại</label>
        <p class="muted xs">Gỡ người này khỏi các việc đang mở (chủ trì, phối hợp). Việc chỉ người này chủ trì: việc giao về phòng trở lại "Chờ phòng tiếp nhận" và lãnh đạo phòng chủ trì được báo; việc khác báo người giao / trưởng dự án. Thu hồi uỷ quyền; bỏ vai trò PGĐ phụ trách và báo Giám đốc.</p>` : '<p class="muted sm">Không có việc đang mở cần bàn giao.</p>'}
        ${workload.approvalsPending ? '<p class="muted xs">Yêu cầu duyệt đang chờ: cấp Trưởng phòng / Ban giám đốc tự chuyển cho người còn lại; cấp "Trưởng dự án" hoặc "Người được chỉ định" cần đổi người duyệt trong cài đặt dự án.</p>' : ''}`;
    } catch (error) { lockBox.innerHTML = `<p class="error">${esc(errorMessage(error))}</p>`; }
  }
  if (user) {
    form.elements.role.addEventListener('change', showRoleBox);
    form.elements.isActive.addEventListener('change', showLockBox);
    if (!user.isActive) showLockBox();
  }

  form.onsubmit = async e => {
    e.preventDefault();
    const f = formData(e.target);
    const body = { username: f.username, fullName: f.fullName, displayTitle: f.displayTitle, email: f.email, role: f.role, departmentId: f.departmentId ? Number(f.departmentId) : null };
    if (user) {
      body.isActive = !!e.target.isActive.checked;
      if (f.role !== user.role && canPermWrite && f.applyProfile === '1') body.applyRoleProfile = true;
      if (e.target.handover?.checked && !body.isActive) body.handover = true;
    } else if (f.password) body.password = f.password;
    try {
      const saved = await api(user ? `/api/admin/users/${user.id}` : '/api/admin/users', { method: user ? 'PUT' : 'POST', body });
      const notes = [];
      if (saved.profileApplied) notes.push('đã áp quyền mặc định của vai trò mới');
      if (saved.handover) notes.push(`bàn giao: gỡ khỏi ${saved.handover.leadRemoved + saved.handover.supportRemoved} việc, ${saved.handover.reassignNotices} việc chờ phân công lại`);
      closeModal(); toast('Đã lưu tài khoản' + (notes.length ? ' — ' + notes.join('; ') : ''), 'ok'); await loadBasics(); renderUsers(root);
    } catch (error) { $('#userError', modal).textContent = errorMessage(error); }
  };
}

async function permissionEditor(root, userId, users = []) {
  const [{ user, grants }, cat] = await Promise.all([api(`/api/admin/users/${userId}/permissions`), getCatalog()]);
  rememberOrder(cat);
  const current = new Map(grants.map(g => [slot(g), g.scope]));
  const canWrite = can('admin.permissions', 'operate');
  const profile = cat.roleProfiles[user.role] || [];
  const mismatch = diffGrants(grants, profile);
  const modal = openModal(`<h2>Phân quyền: ${esc(user.fullName)} (${esc(user.username)})</h2>
    <p class="muted sm">Phạm vi <b>Phòng ban</b> = chỉ dữ liệu của phòng ban tài khoản; <b>Toàn tổ chức</b> = mọi phòng ban. Nhóm tài khoản: <b>${esc(ROLE_LABEL[user.role] || user.role)}</b>.</p>
    <div class="admin-box${mismatch.length ? ' warn' : ''}" id="permState" data-testid="perm-state">${mismatch.length
      ? `<span>Quyền hiện tại khác quyền mặc định của nhóm ${esc(ROLE_LABEL[user.role] || user.role)} (${diffSummary(mismatch)}).</span>`
      : `<span class="muted">Quyền hiện tại trùng quyền mặc định của nhóm ${esc(ROLE_LABEL[user.role] || user.role)}.</span>`}
      ${canWrite && mismatch.length ? `<button type="button" class="btn btn-ghost btn-sm" data-restore data-testid="perm-restore">${ICON.undo}Khôi phục quyền theo vai trò</button>` : ''}</div>
    <div class="admin-scroll"><table class="table perm-grid"><thead><tr><th>Nhóm</th><th>Quyền</th><th>Xem</th><th>Thao tác</th></tr></thead><tbody>
    ${cat.permissions.map(p => `<tr data-row="${p.key}"><td class="muted sm">${esc(p.group)}</td><td><b>${esc(p.label)}</b><div class="muted xs">${esc(p.description)}</div></td>
      ${['VIEW', 'OPERATE'].map(action => p.actions.includes(action) ? `<td><select data-key="${p.key}" data-action="${action}" ${canWrite ? '' : 'disabled'} data-testid="grant-${p.key}-${action}" aria-label="${esc(p.label)} — ${ACTION_TEXT[action]}"><option value="">—</option>${p.scopes.map(s => `<option value="${s}"${current.get(p.key + '|' + action) === s ? ' selected' : ''}>${SCOPE_TEXT[s]}</option>`).join('')}</select></td>` : '<td></td>').join('')}</tr>`).join('')}
    </tbody></table></div><p class="muted sm" id="permNote" aria-live="polite"></p><p class="error" id="permError"></p>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Đóng</button>${canWrite ? '<button class="btn btn-primary" data-save data-testid="perm-save">Lưu phân quyền</button>' : ''}</div>`, { wide: true });
  const selects = () => $$('select[data-key]', modal);
  const picked = () => selects().filter(s => s.value).map(s => ({ permissionKey: s.dataset.key, action: s.dataset.action, scope: s.value }));
  // Đánh dấu các ô đã đổi so với quyền đang lưu.
  const mark = () => {
    for (const s of selects()) s.closest('td').classList.toggle('perm-changed', (current.get(s.dataset.key + '|' + s.dataset.action) || '') !== s.value);
    const rows = diffGrants(grants, picked());
    $('#permNote', modal).textContent = rows.length ? `Chưa lưu: ${diffSummary(rows)} quyền so với hiện tại.` : '';
  };
  modal.addEventListener('change', e => { if (e.target.matches('select[data-key]')) mark(); });
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('[data-restore]')?.addEventListener('click', () => {
    const want = new Map(profile.map(g => [slot(g), g.scope]));
    for (const s of selects()) s.value = want.get(s.dataset.key + '|' + s.dataset.action) || '';
    mark();
    $('#permNote', modal).textContent = `Đã điền quyền mặc định của nhóm ${ROLE_LABEL[user.role] || user.role} (${diffSummary(mismatch)}) — kiểm tra rồi bấm "Lưu phân quyền".`;
  });
  modal.querySelector('[data-save]')?.addEventListener('click', async () => {
    try {
      await api(`/api/admin/users/${userId}/permissions`, { method: 'PUT', body: { grants: picked() } });
      closeModal(); toast('Đã lưu phân quyền', 'ok');
      if (users.some(u => u.id === userId)) renderUsers(root);
    } catch (error) { $('#permError', modal).textContent = errorMessage(error); }
  });
}

// ---------- Phòng ban ----------
// Phòng `id` và mọi phòng trực thuộc nó (không được chọn làm cấp trên — tránh vòng).
function subtreeOf(id) {
  const out = new Set([id]);
  for (let grew = true; grew;) { grew = false; for (const d of store.departments) if (d.parentId != null && out.has(d.parentId) && !out.has(d.id)) { out.add(d.id); grew = true; } }
  return out;
}
async function renderDepartments(root) {
  await loadBasics();
  const canEdit = can('admin.departments', 'operate');
  const supervisorCell = d => {
    const s = d.supervisor || (d.supervisorId ? store.users.find(u => u.id === d.supervisorId) : null);
    if (!d.supervisorId) return '—';
    if (s && s.isActive === false) return `<span>${esc(s.fullName)} <span class="pill warn" title="PGĐ phụ trách đã bị khoá tài khoản — phiếu trình của phòng chuyển về Ban giám đốc; hãy chọn PGĐ khác" data-testid="supervisor-locked-${esc(d.code)}">Đã khoá</span></span>`;
    return esc(s?.fullName || '—');
  };
  root.innerHTML = `<div class="page-head"><h1>Phòng ban</h1>${canEdit ? `<button class="btn btn-primary" id="addDept" data-testid="add-department">${ICON.plus}Thêm phòng ban</button>` : ''}</div>
    <div class="admin-scroll"><table class="table admin-cards" data-testid="departments-table"><thead><tr><th>Mã</th><th>Tên</th><th>Trực thuộc</th><th>PGĐ phụ trách</th><th>Tài khoản</th><th>Dự án</th><th>Trạng thái</th><th></th></tr></thead><tbody>
    ${store.departments.map(d => {
      const locked = d._count.users - (d.activeUsers ?? d._count.users);
      return `<tr data-testid="dept-${esc(d.code)}"><td class="code card-title" data-label="Mã">${esc(d.code)}</td><td data-label="Tên">${esc(d.name)}</td><td data-label="Trực thuộc">${esc(store.departments.find(x => x.id === d.parentId)?.name || '—')}</td>
      <td data-label="PGĐ phụ trách">${supervisorCell(d)}</td><td data-label="Tài khoản"><span>${d._count.users}${locked > 0 ? ` <span class="muted xs">(${locked} đã khoá)</span>` : ''}</span></td><td data-label="Dự án">${d._count.projects}</td>
      <td data-label="Trạng thái"><span>${d.isActive ? 'Hoạt động' : `<span class="pill">Đã khoá</span>${d.activeUsers ? ` <span class="pill warn" title="Phòng đã khoá nhưng còn tài khoản đang hoạt động">${d.activeUsers} người còn hoạt động</span>` : ''}`}</span></td>
      <td class="actions">${canEdit ? `<button class="btn btn-ghost btn-sm" data-edit="${d.id}" data-testid="dept-edit-${esc(d.code)}">Sửa</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  root.onclick = e => {
    if (e.target.closest('#addDept')) return deptForm(root);
    const edit = e.target.closest('[data-edit]'); if (edit) deptForm(root, store.departments.find(d => d.id === Number(edit.dataset.edit)));
  };
}
function deptForm(root, dept = null) {
  const blocked = dept ? subtreeOf(dept.id) : new Set();
  const directors = store.users.filter(u => u.role === 'director');
  const lockedSup = dept?.supervisorId && !directors.some(u => u.id === dept.supervisorId) ? (dept.supervisor || { id: dept.supervisorId, fullName: '#' + dept.supervisorId }) : null;
  const modal = openModal(`<h2>${dept ? 'Sửa phòng ban' : 'Thêm phòng ban'}</h2><form>
    <div class="grid2"><label class="field">Mã<input name="code" required maxlength="30" value="${esc(dept?.code || '')}" data-testid="dept-code"></label>
    <label class="field">Tên<input name="name" required maxlength="200" value="${esc(dept?.name || '')}" data-testid="dept-name"></label></div>
    <label class="field">Trực thuộc${dept && blocked.size > 1 ? ' <span class="muted xs">(không chọn được các phòng đang trực thuộc phòng này)</span>' : ''}<select name="parentId" data-testid="dept-parent"><option value="">— Không —</option>${store.departments.filter(d => !blocked.has(d.id)).map(d => `<option value="${d.id}"${dept?.parentId === d.id ? ' selected' : ''}>${esc(d.name)}${d.isActive ? '' : ' (đã khoá)'}</option>`).join('')}</select></label>
    <label class="field">PGĐ phụ trách <span class="muted xs">(nhận phiếu trình của phòng ở cấp Ban Giám đốc)</span><select name="supervisorId" data-testid="dept-supervisor"><option value="">— Không —</option>${lockedSup ? `<option value="${lockedSup.id}" selected>${esc(lockedSup.fullName)} (đã khoá — hãy chọn PGĐ khác)</option>` : ''}${directors.map(u => `<option value="${u.id}"${dept?.supervisorId === u.id ? ' selected' : ''}>${esc(u.fullName)}${u.displayTitle ? ' — ' + esc(u.displayTitle) : ''}</option>`).join('')}</select></label>
    ${dept ? `<label class="check"><input type="checkbox" name="isActive" ${dept.isActive ? 'checked' : ''} data-testid="dept-active"> Đang hoạt động</label><div id="deptLockBox" class="hidden"></div>` : ''}
    <p class="error" id="deptError"></p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="dept-save">Lưu</button></div></form>`);
  modal.querySelector('[data-close]').onclick = () => closeModal();
  const form = modal.querySelector('form'), lockBox = $('#deptLockBox', modal);
  // Khoá phòng còn tài khoản đang hoạt động: hỏi xác nhận kèm số người (server vẫn cho khoá).
  const needConfirm = () => !!dept && dept.isActive && !form.elements.isActive.checked && (dept.activeUsers || 0) > 0;
  form.elements.isActive?.addEventListener('change', () => {
    if (!needConfirm()) { lockBox.className = 'hidden'; lockBox.innerHTML = ''; return; }
    lockBox.className = 'admin-box warn';
    lockBox.innerHTML = `<h4>Phòng còn ${dept.activeUsers} tài khoản đang hoạt động</h4>
      <p class="muted sm">Khoá phòng không khoá các tài khoản này; họ vẫn thuộc phòng (hiển thị "đã khoá") cho tới khi được chuyển sang phòng khác. Không chọn được phòng này cho tài khoản mới hay dự án mới.</p>
      <label class="check"><input type="checkbox" name="confirmLock" data-testid="dept-confirm-lock"> Tôi đã hiểu, vẫn khoá phòng</label>`;
  });
  form.onsubmit = async e => {
    e.preventDefault();
    const f = formData(e.target), body = { code: f.code, name: f.name, parentId: f.parentId ? Number(f.parentId) : null, supervisorId: f.supervisorId ? Number(f.supervisorId) : null };
    if (dept) body.isActive = !!e.target.isActive.checked;
    if (needConfirm() && !e.target.confirmLock?.checked) { $('#deptError', modal).textContent = `Phòng còn ${dept.activeUsers} tài khoản đang hoạt động — đánh dấu "Tôi đã hiểu, vẫn khoá phòng" để tiếp tục.`; return; }
    try { await api(dept ? `/api/departments/${dept.id}` : '/api/departments', { method: dept ? 'PUT' : 'POST', body }); closeModal(); toast('Đã lưu phòng ban', 'ok'); renderDepartments(root); }
    catch (error) { $('#deptError', modal).textContent = errorMessage(error); }
  };
}

// ---------- Nhãn ----------
async function renderLabels(root) {
  await loadBasics();
  root.innerHTML = `<div class="page-head"><h1>Nhãn</h1></div>
    <form class="row card" id="labelForm" style="margin-bottom:12px"><input name="name" placeholder="Tên nhãn" required maxlength="60" class="grow" style="width:auto"><input type="color" name="color" value="#2563eb" style="width:60px"><button class="btn btn-primary">Thêm nhãn</button></form>
    <div class="row">${store.labels.map(l => `<span class="row" style="gap:4px">${labelChip(l)}<button class="icon-btn" data-del="${l.id}" aria-label="Xoá nhãn ${esc(l.name)}"><svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></span>`).join('') || '<span class="muted">Chưa có nhãn.</span>'}</div>`;
  root.querySelector('#labelForm').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/labels', { method: 'POST', body: formData(e.target) }); renderLabels(root); } catch (error) { toast(errorMessage(error), 'err'); }
  };
  root.onclick = async e => {
    const del = e.target.closest('[data-del]');
    if (del && await confirmDialog('Xoá nhãn này khỏi mọi công việc?', { danger: true, okText: 'Xoá' })) { await api(`/api/labels/${del.dataset.del}`, { method: 'DELETE' }).catch(err => toast(errorMessage(err), 'err')); renderLabels(root); }
  };
}

// ---------- Nhật ký ----------
const AUDIT_FILTERS = ['action', 'entity', 'userId', 'from', 'to'];
const LOGIN_REASON = { NOT_FOUND: 'tài khoản không tồn tại', INACTIVE: 'tài khoản đã khoá', WRONG_PASSWORD: 'sai mật khẩu' };
const FIELD = {
  username: 'Tài khoản', fullName: 'Họ tên', displayTitle: 'Chức danh', email: 'Email', phone: 'Điện thoại', role: 'Nhóm tài khoản', departmentId: 'Phòng ban',
  isActive: 'Đang hoạt động', mustChangePw: 'Phải đổi mật khẩu', isRootAdmin: 'Quản trị gốc', granted: 'Số quyền cấp ban đầu', code: 'Mã', name: 'Tên', parentId: 'Trực thuộc',
  supervisorId: 'PGĐ phụ trách', color: 'Màu', projectId: 'Dự án', toUserId: 'Người nhận uỷ quyền', startsAt: 'Từ', endsAt: 'Đến', reason: 'Lý do', items: 'Danh sách việc',
  leadRemoved: 'Gỡ khỏi chủ trì', returnedToDept: 'Trả về "Chờ phòng tiếp nhận"', reassignNotices: 'Việc cần phân công lại', supportRemoved: 'Gỡ khỏi phối hợp',
  delegationsRevoked: 'Uỷ quyền đã thu hồi', departmentsCleared: 'Phòng bỏ PGĐ phụ trách', notified: 'Số thông báo đã gửi', dueSoonDays: 'Số ngày "sắp đến hạn"', sources: 'Nguồn giao việc',
};
const HIDDEN_FIELDS = new Set(['id', 'sensitive', 'department', 'createdAt', 'lastLoginAt', 'createdById', 'updatedById', 'updatedAt', 'passwordHash']);
let adminUsersCache = null;
async function renderAudit(root, params) {
  const page = Number(params.get('page')) || 1;
  const q = new URLSearchParams({ page, pageSize: 50 });
  for (const k of AUDIT_FILTERS) if (params.get(k)) q.set(k, params.get(k));
  const [d, people] = await Promise.all([api('/api/admin/audit?' + q), adminUsersCache || (can('admin.users') ? api('/api/admin/users') : Promise.resolve(store.users)).catch(() => store.users)]);
  adminUsersCache = people;
  const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  const { actions, entities } = d.labels;
  const sortBy = obj => Object.entries(obj).sort((a, b) => a[1].localeCompare(b[1], 'vi'));
  const opt = (value, label, key) => `<option value="${esc(value)}"${params.get(key) === String(value) ? ' selected' : ''}>${esc(label)}</option>`;
  const link = p => { const x = new URLSearchParams(); for (const k of AUDIT_FILTERS) if (params.get(k)) x.set(k, params.get(k)); x.set('page', p); return '#/admin/audit?' + x; };
  const filtered = AUDIT_FILTERS.some(k => params.get(k));
  root.innerHTML = `<div class="page-head"><h1>Nhật ký hệ thống</h1><span class="muted">${d.total} bản ghi</span></div>
    <form class="filters" id="auditFilters" data-testid="audit-filters">
      <select name="action" aria-label="Hành động" data-testid="audit-action"><option value="">Mọi hành động</option>${sortBy(actions).map(([k, v]) => opt(k, v, 'action')).join('')}</select>
      <select name="entity" aria-label="Đối tượng" data-testid="audit-entity"><option value="">Mọi đối tượng</option>${sortBy(entities).map(([k, v]) => opt(k, v, 'entity')).join('')}</select>
      <select name="userId" aria-label="Người thực hiện" data-testid="audit-user"><option value="">Mọi người thực hiện</option>${people.map(u => opt(u.id, `${u.fullName} (${u.username})`, 'userId')).join('')}</select>
      <label class="audit-date"><span class="muted xs">Từ</span><input type="date" name="from" value="${esc(params.get('from') || '')}" data-testid="audit-from"></label>
      <label class="audit-date"><span class="muted xs">Đến</span><input type="date" name="to" value="${esc(params.get('to') || '')}" data-testid="audit-to"></label>
      ${filtered ? '<button type="button" class="btn btn-ghost btn-sm" data-clear>Xoá lọc</button>' : ''}
    </form>
    <div class="admin-scroll"><table class="table admin-cards audit-table" data-testid="audit-table"><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>IP</th><th></th></tr></thead><tbody>
    ${d.items.map(r => auditRow(r)).join('') || '<tr><td colspan="6" class="empty">Không có bản ghi phù hợp.</td></tr>'}</tbody></table></div>
    <div class="row" style="margin-top:10px">${page > 1 ? `<a class="btn btn-ghost btn-sm" href="${link(page - 1)}">${ICON.prev}Trước</a>` : ''}<span class="muted sm">Trang ${page}/${pages}</span>${page < pages ? `<a class="btn btn-ghost btn-sm" href="${link(page + 1)}">Sau${ICON.next}</a>` : ''}</div>`;
  const form = $('#auditFilters', root);
  form.addEventListener('change', () => {
    const x = new URLSearchParams();
    for (const [k, v] of new FormData(form)) if (v) x.set(k, v);
    location.hash = '#/admin/audit' + (x.toString() ? '?' + x : '');
  });
  form.onsubmit = e => e.preventDefault();
  root.onclick = async e => {
    if (e.target.closest('[data-clear]')) { location.hash = '#/admin/audit'; return; }
    const det = e.target.closest('[data-detail]');
    if (det) auditDetail(d.items.find(r => r.id === Number(det.dataset.detail)), d.labels, people);
  };
}
function parseValue(v) { if (v == null) return null; try { return JSON.parse(v); } catch { return v; } }
function auditRow(r) {
  const nv = parseValue(r.newValue);
  const reason = r.action === 'LOGIN_FAILED' && nv?.reason ? `<span class="muted xs adm-block">${esc(LOGIN_REASON[nv.reason] || nv.reason)}</span>` : '';
  const target = r.entityName ? esc(r.entityName) : r.entityId ? '#' + esc(r.entityId) : '';
  const detail = !r.business && (r.oldValue || r.newValue)
    ? `<button class="btn btn-ghost btn-sm" data-detail="${r.id}" data-testid="audit-detail-${r.id}">Trước – sau</button>`
    : r.redacted ? '<span class="muted xs" title="Nội dung nghiệp vụ không hiển thị cho quản trị hệ thống">Ẩn nội dung nghiệp vụ</span>' : '';
  return `<tr><td class="sm" data-label="Thời gian">${fmtDateTime(r.createdAt)}</td><td data-label="Người thực hiện">${esc(r.actorName)}</td>
    <td data-label="Hành động"><span><span class="pill">${esc(r.actionLabel || r.action)}</span>${r.sensitive ? ' <span class="pill warn" title="Thao tác nhạy cảm — đã thông báo Ban giám đốc">Đã báo Giám đốc</span>' : ''}${reason}<span class="audit-code adm-block">${esc(r.action)}</span></span></td>
    <td data-label="Đối tượng"><span>${esc(r.entityLabel || r.entity)} ${target}<span class="audit-code adm-block">${esc(r.entity)}${r.entityId ? ' · ' + esc(r.entityId) : ''}</span></span></td>
    <td class="muted sm" data-label="IP">${esc(r.ip || '')}</td><td class="actions">${detail}</td></tr>`;
}
function fieldValue(key, v, people) {
  if (v == null || v === '') return '<span class="muted">—</span>';
  if (key === 'role') return esc(ROLE_LABEL[v] || v);
  if (key === 'departmentId' || key === 'parentId') return esc(store.departments.find(d => d.id === Number(v))?.name || '#' + v);
  if (key === 'supervisorId' || key === 'toUserId') { const u = people.find(x => x.id === Number(v)); return esc(u ? `${u.fullName} (${u.username})` : '#' + v); }
  if (key === 'reason' && LOGIN_REASON[v]) return esc(LOGIN_REASON[v]);
  if (typeof v === 'boolean') return v ? 'Có' : 'Không';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v);
  if (typeof v === 'object') return `<code class="audit-json">${esc(JSON.stringify(v).slice(0, 600))}</code>`;
  return esc(v);
}
async function auditDetail(r, labels, people) {
  if (!r) return;
  const before = parseValue(r.oldValue), after = parseValue(r.newValue);
  const head = `<h2>${esc(labels.actions[r.action] || r.action)} · ${esc(labels.entities[r.entity] || r.entity)} ${esc(r.entityName || (r.entityId ? '#' + r.entityId : ''))}</h2>
    <p class="muted sm">${fmtDateTime(r.createdAt)} — ${esc(r.actorName)}${r.ip ? ' — IP ' + esc(r.ip) : ''}</p>`;
  let body;
  const grantsOf = v => (Array.isArray(v) ? v : Array.isArray(v?.grants) ? v.grants : null);
  if (grantsOf(before) || grantsOf(after)) {
    const cat = await getCatalog(); rememberOrder(cat);
    const roleLine = before?.role || after?.role ? `<p class="sm">Nhóm tài khoản: ${fieldValue('role', before?.role, people)} → <b>${fieldValue('role', after?.role, people)}</b></p>` : '';
    body = roleLine + diffTable(cat, diffGrants(grantsOf(before) || [], grantsOf(after) || []), 'audit-diff');
  } else {
    const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
    const b = isObj(before) ? before : {}, a = isObj(after) ? after : {};
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(k => !HIDDEN_FIELDS.has(k) && JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null));
    body = keys.length ? `<table class="table diff-table" data-testid="audit-diff"><thead><tr><th>Trường</th><th>Trước</th><th>Sau</th></tr></thead><tbody>
      ${keys.map(k => `<tr><td><b>${esc(FIELD[k] || k)}</b></td><td data-label="Trước">${fieldValue(k, b[k], people)}</td><td data-label="Sau">${fieldValue(k, a[k], people)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted sm">Không có trường nào thay đổi.</p>';
  }
  const modal = openModal(`${head}${body}<div class="modal-actions"><button class="btn btn-ghost" data-close>Đóng</button></div>`, { wide: true });
  modal.querySelector('[data-close]').onclick = () => closeModal();
}
