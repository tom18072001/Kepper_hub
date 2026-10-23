// Thông tin cá nhân: thông tin tài khoản (chỉ xem — quản trị sửa), đổi ảnh đại diện, đổi mật khẩu, vị trí trong cây tổ chức.
import { api, setToken } from '../api.js';
import { store } from '../store.js';
import { $, esc, avatar, fmtDate, fmtDateTime, toast, errorMessage, openModal, closeModal, setAvatarDirectory } from '../util.js';
import { icon } from '../icons.js';

const MAX_SIDE = 512;

// Thu nhỏ + cắt vuông ở trình duyệt (ảnh gốc chụp điện thoại vài MB không gửi lên máy chủ).
async function squareImage(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Chọn ảnh PNG, JPEG hoặc WebP');
  if (file.size > 15 * 1024 * 1024) throw new Error('Ảnh gốc quá lớn (tối đa 15 MB)');
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height), out = Math.min(MAX_SIDE, side);
  const c = document.createElement('canvas'); c.width = out; c.height = out;
  c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
  bmp.close?.();
  for (const q of [0.86, 0.75, 0.6]) {
    const url = c.toDataURL('image/jpeg', q);
    if (url.length * 0.75 < 380 * 1024) return url;
  }
  throw new Error('Ảnh quá lớn sau khi thu nhỏ');
}

function passwordDialog() {
  const modal = openModal(`<h2>Đổi mật khẩu</h2>
    <form id="pwForm2">
      <label class="field">Mật khẩu hiện tại<input type="password" id="pw0" autocomplete="current-password" required autofocus></label>
      <label class="field">Mật khẩu mới<input type="password" id="pw1" autocomplete="new-password" required minlength="6"></label>
      <label class="field">Nhập lại mật khẩu mới<input type="password" id="pw2" autocomplete="new-password" required minlength="6"></label>
      <p class="error" id="pwErr2" role="alert"></p>
      <p class="muted xs">Đổi mật khẩu sẽ làm các kết nối Claude của bạn mất hiệu lực (kết nối lại khi hỏi Claude).</p>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">Huỷ</button><button class="btn btn-primary">Lưu mật khẩu</button></div>
    </form>`);
  modal.querySelector('[data-act="cancel"]').onclick = () => closeModal(null);
  modal.querySelector('#pwForm2').onsubmit = async e => {
    e.preventDefault();
    const err = modal.querySelector('#pwErr2');
    if (modal.querySelector('#pw1').value !== modal.querySelector('#pw2').value) { err.textContent = 'Mật khẩu nhập lại không khớp'; return; }
    try {
      const { token } = await api('/api/me/password', { method: 'POST', body: { currentPassword: modal.querySelector('#pw0').value, newPassword: modal.querySelector('#pw1').value } });
      setToken(token); closeModal(null); toast('Đã đổi mật khẩu', 'ok');
    } catch (error) { err.textContent = errorMessage(error); }
  };
}

const chip = p => `<div class="org-person" title="${esc(p.fullName)}">${avatar(p, false)}<span><b>${esc(p.fullName)}</b>
  <span class="muted xs">${esc(p.displayTitle || p.roleLabel)}${p.department ? ' · ' + esc(p.department) : ''}</span></span></div>`;

export async function renderProfile(root, setCrumbs) {
  setCrumbs('Thông tin cá nhân');
  const p = await api('/api/me/profile');
  const mods = store.settings?.modules || [];
  const row = (k, v) => `<div class="pf-row"><dt>${k}</dt><dd>${v || '<span class="muted">—</span>'}</dd></div>`;
  const org = p.org;
  const orgBox = !org ? '' : `<section class="card pf-org" data-testid="profile-org">
    <h2>Vị trí trong tổ chức</h2>
    <ol class="org-tree">
      ${org.above.map(l => `<li class="org-level"><div class="org-label">${esc(l.label)}</div><div class="org-people">${l.people.map(chip).join('')}</div></li>`).join('')}
      <li class="org-level org-me" data-testid="profile-org-me"><div class="org-label">Bạn${org.peers.length ? ` · ${org.peers.length} người cùng cấp` : ''}</div>
        <div class="org-people">${chip(org.me)}</div>
        ${org.peers.length ? `<details class="org-peers"><summary class="muted sm">Cùng cấp trong bộ phận</summary><div class="org-people">${org.peers.map(chip).join('')}</div></details>` : ''}</li>
      ${org.below.map(l => `<li class="org-level org-below"><div class="org-label">${esc(l.label)} <span class="muted xs">${l.people.length} người</span></div><div class="org-people">${l.people.map(chip).join('')}</div></li>`).join('')}
    </ol>
    ${!org.above.length && !org.below.length ? '<p class="muted sm">Chưa có thông tin cấp trên / cấp dưới — quản trị cần gán bộ phận, vai trò (trưởng / phó / nhân viên) và Phó GĐ phụ trách bộ phận.</p>' : ''}
  </section>`;

  root.innerHTML = `<div class="page-head"><h1>Thông tin cá nhân</h1></div>
    <div class="pf-grid">
      <section class="card pf-card" data-testid="profile">
        <div class="pf-head">
          <div class="pf-avatar">${avatar({ ...p }, false)}</div>
          <div class="pf-name"><h2>${esc(p.fullName)}</h2><p class="muted">${esc(p.displayTitle || p.roleLabel)}${p.department ? ' · ' + esc(p.department.name) : ''}</p>
            <div class="row pf-actions">
              <label class="btn btn-ghost btn-sm" data-testid="profile-avatar-change">${icon('upload')}Đổi ảnh<input type="file" id="pfFile" accept="image/png,image/jpeg,image/webp" hidden></label>
              ${p.avatarUrl ? `<button class="btn btn-ghost btn-sm" id="pfDel" data-testid="profile-avatar-delete">Xoá ảnh</button>` : ''}
              <button class="btn btn-ghost btn-sm" id="pfPw" data-testid="profile-password">Đổi mật khẩu</button>
            </div></div>
        </div>
        <dl class="pf-dl">
          ${row('Tài khoản', `<code>${esc(p.username)}</code>`)}
          ${row('Họ và tên', esc(p.fullName))}
          ${row('Chức danh', esc(p.displayTitle || ''))}
          ${row('Bộ phận', esc(p.department?.name || ''))}
          ${row('Vai trò', esc(p.roleLabel))}
          ${row('Email', esc(p.email || ''))}
          ${row('Điện thoại', esc(p.phone || ''))}
          ${row('Tạo tài khoản', esc(fmtDate(p.createdAt)))}
          ${row('Đăng nhập gần nhất', p.lastLoginAt ? esc(fmtDateTime(p.lastLoginAt)) : '')}
        </dl>
        <p class="muted xs">Thông tin sai hoặc thiếu (họ tên, chức danh, bộ phận, email, điện thoại): báo quản trị hệ thống sửa.
          Ảnh đại diện do bạn tự đặt, ai đăng nhập Kepper cũng thấy; xoá được bất cứ lúc nào.</p>
        ${mods.includes('hrm') ? `<a class="pf-link" href="#/hrm">${icon('users')}<span><b>Hồ sơ nhân sự, nghỉ phép, chấm công</b><span class="muted xs">Mở phân hệ Nhân sự</span></span></a>` : ''}
        <a class="pf-link" href="#/claude">${icon('send')}<span><b>Kết nối Claude</b><span class="muted xs">Máy đã kết nối, thu hồi</span></span></a>
      </section>
      ${orgBox}
    </div>`;

  const refreshAvatar = url => {
    store.me.avatarUrl = url;
    const u = store.users.find(x => x.id === store.me.id); if (u) u.avatarUrl = url;
    setAvatarDirectory(store.users);
    const old = $('#meAvatar'); if (old) old.outerHTML = avatar(store.me).replace(/^<(\w+) class="avatar/, '<$1 id="meAvatar" class="avatar');
  };
  $('#pfFile', root).onchange = async e => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const { avatarUrl } = await api('/api/me/avatar', { method: 'PUT', body: { image: await squareImage(f) } });
      refreshAvatar(avatarUrl); toast('Đã đổi ảnh đại diện', 'ok'); await renderProfile(root, setCrumbs);
    } catch (error) { toast(errorMessage(error), 'err'); }
  };
  const del = $('#pfDel', root);
  if (del) del.onclick = async () => { try { await api('/api/me/avatar', { method: 'DELETE' }); refreshAvatar(null); toast('Đã xoá ảnh đại diện', 'ok'); await renderProfile(root, setCrumbs); } catch (error) { toast(errorMessage(error), 'err'); } };
  $('#pfPw', root).onclick = passwordDialog;
}
