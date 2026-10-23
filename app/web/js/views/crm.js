// Playground CRM — đối tác B2B (nhà thầu, tư vấn, cơ quan, ngân hàng, nhà cung cấp): danh bạ, người liên hệ, nhật ký làm việc,
// việc cần theo dõi, hợp đồng / gói thầu. Quyền do máy chủ quyết (lib/policy.js crm.*) — giao diện chỉ ẩn nút theo cờ "can".
import { api } from '../api.js';
import { store, deptName } from '../store.js';
import { $, esc, fmtDate, fmtDateTime, toast, openModal, closeModal, confirmDialog, errorMessage, dateInput, fromDateInput } from '../util.js';

let meta = null;
const getMeta = async () => (meta ||= await api('/api/crm/meta'));
const opts = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
const userOpts = (cur, { blank = true } = {}) => (blank ? '<option value="">—</option>' : '') + store.users.filter(u => u.role !== 'admin')
  .map(u => `<option value="${u.id}"${Number(cur) === u.id ? ' selected' : ''}>${esc(u.fullName)}${u.departmentId ? ' · ' + esc(deptName(u.departmentId)) : ''}</option>`).join('');
const stars = n => (n ? '★'.repeat(n) + '<span class="muted">' + '★'.repeat(5 - n) + '</span>' : '<span class="muted">—</span>');
const statusPill = s => `<span class="pill ${s.code === 'ACTIVE' ? 'ok' : s.code === 'PAUSED' ? 'warn' : 'info'}">${esc(s.label)}</span>`;
const money = v => (v == null ? '—' : Number(v).toLocaleString('vi-VN') + ' đ');
const formObj = form => Object.fromEntries(new FormData(form).entries());
const vnToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); // ngày giờ Việt Nam
const vnDay = d => new Date(new Date(d).getTime() + 7 * 3600e3).toISOString().slice(0, 10);

export async function renderCrm(root, id, params, setCrumbs) {
  const m = await getMeta();
  if (id) return renderPartner(root, Number(id), setCrumbs, m);
  setCrumbs('Đối tác');
  const q = params.get('q') || '', kind = params.get('kind') || '', status = params.get('status') || '', mine = params.get('mine') === '1', archived = params.get('archived') === '1', scope = params.get('fu') === 'dept' ? 'dept' : 'mine';
  const qs = new URLSearchParams({ ...(q && { q }), ...(kind && { kind }), ...(status && { status }), ...(mine && { mine: '1' }), ...(archived && { archived: '1' }) });
  const [rows, fus] = await Promise.all([api('/api/crm/partners?' + qs), api('/api/crm/followups?scope=' + scope)]);
  root.innerHTML = `<div class="page-head"><h1>Đối tác</h1><span class="muted sm">Nhà thầu, tư vấn, cơ quan quản lý, ngân hàng, nhà cung cấp. Người liên hệ, nhật ký, hợp đồng chỉ bộ phận phụ trách xem.</span>
      ${m.canCreate ? '<button class="btn btn-primary" id="crmNew" data-testid="crm-new">Thêm đối tác</button>' : ''}</div>
    <section class="card pg-section" data-testid="crm-followups">
      <div class="row"><h3 class="grow" style="margin:0">Việc cần theo dõi</h3>
        ${m.me.leader || m.me.director ? `<div class="seg"><button data-fu="mine" class="${scope === 'mine' ? 'on' : ''}">Của tôi</button><button data-fu="dept" class="${scope === 'dept' ? 'on' : ''}">${m.me.director ? 'Tất cả' : 'Bộ phận tôi'}</button></div>` : ''}</div>
      ${fus.length ? `<table class="table"><thead><tr><th>Hạn</th><th>Đối tác</th><th>Việc tiếp theo</th><th>Người theo dõi</th><th></th></tr></thead><tbody>
        ${fus.map(f => `<tr><td>${f.overdue ? '<span class="pill danger">Quá hạn</span> ' : vnDay(f.nextDue) === vnToday() ? '<span class="pill warn">Hôm nay</span> ' : ''}${fmtDate(f.nextDue)}</td><td><a href="#/crm/${f.partner.id}">${esc(f.partner.name)}</a></td>
          <td>${esc(f.nextStep || f.summary)}</td><td>${esc(f.nextOwner?.fullName || '')}</td><td class="actions"><button class="btn btn-ghost btn-sm" data-done="${f.id}" data-testid="crm-fu-done">Xong</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Không có việc cần theo dõi.</div>'}
    </section>
    <form class="row pg-filters" id="crmFilter">
      <input name="q" value="${esc(q)}" placeholder="Tên hoặc mã số thuế" class="grow" data-testid="crm-q">
      <select name="kind"><option value="">Mọi loại</option>${opts(m.kinds, kind)}</select>
      <select name="status"><option value="">Mọi trạng thái</option>${opts(m.statuses, status)}</select>
      <label class="check"><input type="checkbox" name="mine" value="1"${mine ? ' checked' : ''}> Bộ phận tôi phụ trách</label>
      <label class="check"><input type="checkbox" name="archived" value="1"${archived ? ' checked' : ''}> Gồm đối tác đã ngừng theo dõi</label>
      <button class="btn">Lọc</button></form>
    <div class="card" style="padding:0"><table class="table" data-testid="crm-partners"><thead><tr><th>Đối tác</th><th>Loại</th><th>Bộ phận phụ trách</th><th>Người phụ trách</th><th>Trạng thái</th><th>Đánh giá</th><th class="num">Theo dõi</th></tr></thead><tbody>
      ${rows.map(p => `<tr${p.archivedAt ? ' class="muted"' : ''}><td><a href="#/crm/${p.id}" data-testid="crm-partner-link"><b>${esc(p.name)}</b></a>${p.archivedAt ? ' <span class="pill warn">Ngừng theo dõi</span>' : ''}${p.taxCode ? `<div class="muted xs">MST ${esc(p.taxCode)}</div>` : ''}</td><td>${esc(p.kind.label)}</td>
        <td>${esc(p.ownerDepartment.name || '')}</td><td>${esc(p.ownerUser?.fullName || '')}</td><td>${statusPill(p.status)}</td><td>${p.rating !== undefined ? stars(p.rating) : ''}</td><td class="num">${p.openFollowups ?? ''}</td></tr>`).join('')
        || '<tr><td colspan="7" class="empty">Chưa có đối tác phù hợp.</td></tr>'}</tbody></table></div>`;
  $('#crmFilter', root).onsubmit = e => {
    e.preventDefault();
    const f = formObj(e.target), p = new URLSearchParams();
    for (const k of ['q', 'kind', 'status', 'mine', 'archived']) if (f[k]) p.set(k, f[k]);
    location.hash = '#/crm' + (p.toString() ? '?' + p : '');
  };
  root.onclick = async e => {
    const fu = e.target.closest('[data-fu]');
    if (fu) { const p = new URLSearchParams(params); p.set('fu', fu.dataset.fu); location.hash = '#/crm?' + p; return; }
    const d = e.target.closest('[data-done]');
    if (d) {
      const note = await confirmDialog('Đánh dấu việc theo dõi đã xong?', { okText: 'Xong', input: 'Kết quả (ghi vào nhật ký, không bắt buộc)' });
      if (note === null) return;
      try { await api(`/api/crm/followups/${d.dataset.done}/done`, { method: 'POST', body: { note } }); toast('Đã cập nhật', 'ok'); renderCrm(root, null, params, setCrumbs); } catch (error) { toast(errorMessage(error), 'err'); }
    }
    if (e.target.id === 'crmNew') partnerForm(null, m, p => { location.hash = `#/crm/${p.id}`; });
  };
}

function partnerForm(p, m, done) {
  const modal = openModal(`<h2>${p ? 'Sửa đối tác' : 'Thêm đối tác'}</h2><form class="pg-grid">
    <label class="field span2">Tên đối tác<input name="name" required maxlength="200" value="${esc(p?.name || '')}" data-testid="crm-f-name"></label>
    <label class="field">Loại<select name="kind">${opts(m.kinds, p?.kind.code || 'CONTRACTOR')}</select></label>
    <label class="field">Trạng thái<select name="status">${opts(m.statuses, p?.status.code || 'ACTIVE')}</select></label>
    <label class="field">Mã số thuế<input name="taxCode" maxlength="14" value="${esc(p?.taxCode || '')}" placeholder="10 số"></label>
    <label class="field">Điện thoại (tổng đài)<input name="phone" maxlength="30" value="${esc(p?.phone || '')}"></label>
    <label class="field span2">Địa chỉ<input name="address" maxlength="300" value="${esc(p?.address || '')}"></label>
    <label class="field">Website<input name="website" maxlength="200" value="${esc(p?.website || '')}"></label>
    <label class="field">Email chung<input name="email" type="email" maxlength="120" value="${esc(p?.email || '')}"></label>
    ${!p && m.me.director ? `<label class="field">Bộ phận phụ trách<select name="ownerDepartmentId">${store.departments.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label>` : ''}
    ${(p ? p.can.archive : (m.me.leader || m.me.director)) ? `<label class="field">Người phụ trách <span class="muted xs">(người trong bộ phận phụ trách)</span><select name="ownerUserId">${userOpts(p ? p.ownerUser?.id : store.me.id)}</select></label>` : ''}
    <label class="field">Đánh giá nội bộ<select name="rating"><option value="">—</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${p?.rating === n ? ' selected' : ''}>${n} ★</option>`).join('')}</select></label>
    <label class="field span2">Nhận xét nội bộ <span class="muted xs">(chỉ bộ phận phụ trách thấy)</span><textarea name="note" maxlength="2000" rows="3">${esc(p?.note || '')}</textarea></label>
    <p class="error span2" id="pfErr"></p>
    <div class="modal-actions span2"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="crm-f-save">Lưu</button></div></form>`, { wide: true });
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const b = formObj(e.target);
    if ('ownerUserId' in b) { b.ownerUserId = b.ownerUserId === '' ? null : Number(b.ownerUserId); if (p && b.ownerUserId === (p.ownerUser?.id ?? null)) delete b.ownerUserId; }
    try {
      const r = await api(p ? `/api/crm/partners/${p.id}` : '/api/crm/partners', { method: p ? 'PATCH' : 'POST', body: b });
      closeModal(); toast('Đã lưu', 'ok'); done(r);
    } catch (error) { modal.querySelector('#pfErr').textContent = errorMessage(error); }
  };
}

async function renderPartner(root, id, setCrumbs, m) {
  const p = await api(`/api/crm/partners/${id}`);
  setCrumbs(`<a href="#/crm">Đối tác</a> / ${esc(p.name)}`);
  const redraw = () => renderPartner(root, id, setCrumbs, m);
  const today = vnToday();
  root.innerHTML = `<div class="page-head"><h1>${esc(p.name)}</h1>${statusPill(p.status)}<span class="pill">${esc(p.kind.label)}</span>${p.archivedAt ? '<span class="pill warn">Ngừng theo dõi</span>' : ''}
      ${p.can.edit ? '<button class="btn" id="pEdit" data-testid="crm-edit">Sửa</button>' : ''}${p.can.archive ? `<button class="btn btn-ghost" id="pArchive">${p.archivedAt ? 'Theo dõi lại' : 'Ngừng theo dõi'}</button>` : ''}</div>
    <div class="pg-cols">
      <section class="card pg-section"><h3>Thông tin chung</h3><dl class="pg-dl">
        <dt>Mã số thuế</dt><dd>${esc(p.taxCode || '—')}</dd><dt>Địa chỉ</dt><dd>${esc(p.address || '—')}</dd>
        <dt>Điện thoại</dt><dd>${esc(p.phone || '—')}</dd><dt>Email</dt><dd>${esc(p.email || '—')}</dd><dt>Website</dt><dd>${esc(p.website || '—')}</dd>
        <dt>Bộ phận phụ trách</dt><dd>${esc(p.ownerDepartment.name || '')}</dd><dt>Người phụ trách</dt><dd>${esc(p.ownerUser?.fullName || '—')}</dd>
        ${p.rating !== undefined ? `<dt>Đánh giá nội bộ</dt><dd>${stars(p.rating)}</dd>` : ''}${p.note !== undefined ? `<dt>Nhận xét nội bộ</dt><dd class="pre">${esc(p.note || '—')}</dd>` : ''}</dl>
        ${p.can.detail ? '' : '<p class="muted sm">Người liên hệ, nhật ký làm việc và hợp đồng chỉ bộ phận phụ trách, người phụ trách và Ban giám đốc xem.</p>'}</section>
      ${p.contacts ? `<section class="card pg-section" data-testid="crm-contacts"><div class="row"><h3 class="grow">Người liên hệ</h3><button class="btn btn-sm" id="cNew" data-testid="crm-contact-new">Thêm</button></div>
        ${p.contacts.length ? `<div class="pg-scroll"><table class="table"><tbody>${p.contacts.map(c => `<tr><td><b>${esc(c.fullName)}</b>${c.isPrimary ? ' <span class="pill info">Đầu mối</span>' : ''}<div class="muted xs">${esc(c.title || '')}</div></td>
          <td>${esc(c.phone || '')}<div class="muted xs">${esc(c.email || '')}</div></td><td class="actions"><button class="btn btn-ghost btn-sm" data-cedit="${c.id}">Sửa</button><button class="btn btn-ghost btn-sm" data-cdel="${c.id}">Xoá</button></td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty">Chưa có người liên hệ.</div>'}</section>` : ''}
    </div>
    <section class="card pg-section" data-testid="crm-interactions"><h3>Nhật ký làm việc</h3>
      ${p.can.detail && !p.archivedAt ? `<form id="iForm" class="pg-grid pg-iform">
        <label class="field">Hình thức<select name="type">${opts(m.interactionTypes, 'MEETING')}</select></label>
        <label class="field">Ngày<input type="date" name="date" value="${today}" max="${today}"></label>
        <label class="field span2">Nội dung<textarea name="summary" required maxlength="4000" rows="2" data-testid="crm-i-summary" placeholder="Đã trao đổi gì, kết quả"></textarea></label>
        <label class="field">Việc tiếp theo<input name="nextStep" maxlength="1000" placeholder="(nếu có)"></label>
        <label class="field">Hạn theo dõi<input type="date" name="nextDue" min="${today}"></label>
        <label class="field">Người theo dõi<select name="nextOwnerId">${userOpts(store.me.id)}</select></label>
        <div class="row" style="align-items:flex-end"><button class="btn btn-primary" data-testid="crm-i-save">Ghi nhật ký</button></div></form>` : ''}
      ${p.interactionsLimited ? '<p class="muted sm">Bạn chỉ thấy các dòng mình ghi hoặc được giao theo dõi.</p>' : ''}
      <ol class="pg-timeline">${p.interactions.map(i => `<li><div class="row"><b>${esc(i.type.label)}</b><span class="muted sm">${fmtDate(i.date)} · ${esc(i.createdBy.fullName || '')}</span>
          ${i.nextDue ? `<span class="pill ${i.followUpDone ? 'ok' : vnDay(i.nextDue) < today ? 'danger' : 'warn'}">${i.followUpDone ? 'Đã xong' : 'Theo dõi ' + fmtDate(i.nextDue)}${i.nextOwner ? ' · ' + esc(i.nextOwner.fullName) : ''}</span>` : ''}
          ${i.canDone ? `<button class="btn btn-ghost btn-sm" data-done="${i.id}">Xong</button>` : ''}</div>
        <div class="pre">${esc(i.summary)}</div>${i.nextStep ? `<div class="muted sm">→ ${esc(i.nextStep)}</div>` : ''}</li>`).join('') || '<li class="empty">Chưa có nhật ký.</li>'}</ol>
    </section>
    ${p.engagements ? `<section class="card pg-section" data-testid="crm-engagements"><div class="row"><h3 class="grow">Hợp đồng / gói thầu / thoả thuận / hồ sơ</h3><button class="btn btn-sm" id="eNew">Thêm</button></div>
      ${p.engagements.length ? `<div class="pg-scroll"><table class="table"><thead><tr><th>Loại</th><th>Tên</th><th>Số hiệu</th><th class="num">Giá trị</th><th>Thời hạn</th><th>Trạng thái</th><th></th></tr></thead><tbody>
        ${p.engagements.map(e => `<tr><td>${esc(e.kind.label)}</td><td>${esc(e.title)}</td><td class="code">${esc(e.code || '')}</td><td class="num">${money(e.value)}</td>
          <td class="sm">${e.startAt ? fmtDate(e.startAt) : ''}${e.endAt ? ' – ' + fmtDate(e.endAt) : ''}</td><td>${esc(e.status.label)}</td><td class="actions"><button class="btn btn-ghost btn-sm" data-eedit="${e.id}">Sửa</button></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">Chưa có.</div>'}</section>` : ''}
    <p class="muted xs">Cập nhật ${fmtDateTime(p.updatedAt)}</p>`;

  const iForm = $('#iForm', root);
  if (iForm) iForm.onsubmit = async e => {
    e.preventDefault();
    const b = formObj(e.target);
    b.date = fromDateInput(b.date); b.nextDue = b.nextDue ? fromDateInput(b.nextDue) : null; b.nextOwnerId = b.nextDue && b.nextOwnerId ? Number(b.nextOwnerId) : null;
    try { await api(`/api/crm/partners/${id}/interactions`, { method: 'POST', body: b }); toast('Đã ghi nhật ký', 'ok'); redraw(); } catch (error) { toast(errorMessage(error), 'err'); }
  };
  root.onclick = async e => {
    const t = e.target;
    try {
      if (t.id === 'pEdit') return partnerForm(p, m, redraw);
      if (t.id === 'pArchive') {
        if (!(await confirmDialog(p.archivedAt ? 'Theo dõi lại đối tác này?' : 'Ngừng theo dõi đối tác này? Dữ liệu được giữ, đối tác ẩn khỏi danh sách.', { okText: 'Đồng ý' }))) return;
        await api(`/api/crm/partners/${id}`, { method: 'PATCH', body: { archived: !p.archivedAt } }); return redraw();
      }
      if (t.id === 'cNew' || t.closest('[data-cedit]')) return contactForm(id, p.contacts.find(c => c.id === Number(t.closest('[data-cedit]')?.dataset.cedit)) || null, redraw);
      const del = t.closest('[data-cdel]');
      if (del) {
        if (!(await confirmDialog('Xoá người liên hệ này? (người đó không còn làm việc với đối tác — xoá hẳn thông tin cá nhân)', { okText: 'Xoá', danger: true }))) return;
        await api(`/api/crm/contacts/${del.dataset.cdel}`, { method: 'DELETE' }); return redraw();
      }
      const d = t.closest('[data-done]');
      if (d) {
        const note = await confirmDialog('Đánh dấu việc theo dõi đã xong?', { okText: 'Xong', input: 'Kết quả (ghi vào nhật ký, không bắt buộc)' });
        if (note === null) return;
        await api(`/api/crm/followups/${d.dataset.done}/done`, { method: 'POST', body: { note } }); return redraw();
      }
      if (t.id === 'eNew' || t.closest('[data-eedit]')) return engagementForm(id, p.engagements.find(x => x.id === Number(t.closest('[data-eedit]')?.dataset.eedit)) || null, m, redraw);
    } catch (error) { toast(errorMessage(error), 'err'); }
  };
}

function contactForm(partnerId, c, done) {
  const modal = openModal(`<h2>${c ? 'Sửa người liên hệ' : 'Thêm người liên hệ'}</h2><p class="muted sm">Chỉ ghi thông tin liên hệ công việc (không ghi số định danh, địa chỉ nhà riêng).</p><form class="pg-grid">
    <label class="field">Họ tên<input name="fullName" required maxlength="120" value="${esc(c?.fullName || '')}" data-testid="crm-c-name"></label>
    <label class="field">Chức danh<input name="title" maxlength="120" value="${esc(c?.title || '')}"></label>
    <label class="field">Điện thoại<input name="phone" maxlength="30" value="${esc(c?.phone || '')}"></label>
    <label class="field">Email<input name="email" type="email" maxlength="120" value="${esc(c?.email || '')}"></label>
    <label class="check span2"><input type="checkbox" name="isPrimary"${c?.isPrimary ? ' checked' : ''}> Đầu mối chính</label>
    <label class="field span2">Ghi chú<input name="note" maxlength="500" value="${esc(c?.note || '')}"></label>
    <p class="error span2" id="cfErr"></p><div class="modal-actions span2"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary">Lưu</button></div></form>`);
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const b = formObj(e.target); b.isPrimary = !!b.isPrimary;
    try { await api(c ? `/api/crm/contacts/${c.id}` : `/api/crm/partners/${partnerId}/contacts`, { method: c ? 'PATCH' : 'POST', body: b }); closeModal(); done(); }
    catch (error) { modal.querySelector('#cfErr').textContent = errorMessage(error); }
  };
}

function engagementForm(partnerId, x, m, done) {
  const modal = openModal(`<h2>${x ? 'Sửa' : 'Thêm'} hợp đồng / gói thầu</h2><form class="pg-grid">
    <label class="field">Loại<select name="kind">${opts(m.engagementKinds, x?.kind.code || 'CONTRACT')}</select></label>
    <label class="field">Trạng thái<select name="status">${opts(m.engagementStatuses, x?.status.code || 'ACTIVE')}</select></label>
    <label class="field span2">Tên<input name="title" required maxlength="300" value="${esc(x?.title || '')}"></label>
    <label class="field">Số hiệu<input name="code" maxlength="80" value="${esc(x?.code || '')}"></label>
    <label class="field">Giá trị (đồng)<input name="value" type="number" min="0" step="1" value="${x?.value ?? ''}"></label>
    <label class="field">Ngày ký<input type="date" name="signedAt" value="${dateInput(x?.signedAt)}"></label>
    <label class="field">Dự án liên quan<select name="projectId"><option value="">—</option>${store.projects.map(pr => `<option value="${pr.id}"${x?.projectId === pr.id ? ' selected' : ''}>${esc(pr.key)} · ${esc(pr.name)}</option>`).join('')}</select></label>
    <label class="field">Bắt đầu<input type="date" name="startAt" value="${dateInput(x?.startAt)}"></label>
    <label class="field">Kết thúc<input type="date" name="endAt" value="${dateInput(x?.endAt)}"></label>
    <label class="field span2">Ghi chú<textarea name="note" maxlength="2000" rows="2">${esc(x?.note || '')}</textarea></label>
    <p class="error span2" id="efErr"></p><div class="modal-actions span2"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary">Lưu</button></div></form>`, { wide: true });
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const b = formObj(e.target);
    for (const k of ['signedAt', 'startAt', 'endAt']) b[k] = b[k] ? fromDateInput(b[k]) : null;
    b.value = b.value === '' ? null : Number(b.value); b.projectId = b.projectId ? Number(b.projectId) : null;
    try { await api(x ? `/api/crm/engagements/${x.id}` : `/api/crm/partners/${partnerId}/engagements`, { method: x ? 'PATCH' : 'POST', body: b }); closeModal(); done(); }
    catch (error) { modal.querySelector('#efErr').textContent = errorMessage(error); }
  };
}
