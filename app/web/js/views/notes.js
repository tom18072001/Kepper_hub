// "Ghi chú của tôi": việc / ghi chú cá nhân, chỉ chủ sở hữu thấy. Ghi nhanh, đánh dấu xong, ghim, hạn, chuyển thành việc của dự án.
import { api } from '../api.js';
import { store } from '../store.js';
import { $, esc, fmtDate, dateInput, fromDateInput, toast, errorMessage, confirmDialog, openModal, closeModal } from '../util.js';
import { icon } from '../icons.js';

let openNote = null, showDone = false;

function dueTag(n) {
  if (!n.dueDate || n.done) return '';
  const diff = new Date(n.dueDate) - Date.now();
  const cls = diff < -86_400_000 ? 'overdue' : diff < 2 * 86_400_000 ? 'soon' : '';
  return `<span class="due ${cls}">${icon('clock')}${fmtDate(n.dueDate)}</span>`;
}
function noteRow(n) {
  const isOpen = openNote === n.id;
  return `<div class="note${n.done ? ' done' : ''}${isOpen ? ' open' : ''}" data-note="${n.id}" data-testid="note-${n.id}">
    <div class="note-head">
      <input type="checkbox" data-done ${n.done ? 'checked' : ''} aria-label="Đánh dấu xong" data-testid="note-done">
      <button type="button" class="note-title" data-toggle>${esc(n.title)}${n.body && !isOpen ? `<span class="muted xs note-excerpt">${esc(n.body.slice(0, 120))}</span>` : ''}</button>
      ${n.convertedItemId ? '<span class="pill" title="Đã chuyển thành công việc">Đã thành việc</span>' : ''}
      ${dueTag(n)}
      <button type="button" class="icon-btn${n.pinned ? ' on' : ''}" data-pin title="${n.pinned ? 'Bỏ ghim' : 'Ghim lên đầu'}" aria-label="${n.pinned ? 'Bỏ ghim' : 'Ghim'}" aria-pressed="${n.pinned}">${icon('pin')}</button>
    </div>
    ${isOpen ? `<div class="note-body">
      <input name="title" value="${esc(n.title)}" maxlength="300" aria-label="Nội dung" data-testid="note-title-input">
      <textarea name="body" rows="4" maxlength="5000" placeholder="Ghi chú chi tiết…" data-testid="note-body">${esc(n.body)}</textarea>
      <div class="row"><label class="check">Hạn <input type="date" name="dueDate" value="${dateInput(n.dueDate)}" style="width:auto" data-testid="note-due"></label>
        <span class="grow"></span>
        ${n.convertedItemId ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-convert data-testid="note-convert">${icon('send')}Chuyển thành việc…</button>`}
        <button type="button" class="btn btn-ghost btn-sm" data-delete>Xoá</button>
        <button type="button" class="btn btn-primary btn-sm" data-save data-testid="note-save">Lưu</button></div>
    </div>` : ''}
  </div>`;
}

export async function drawNotes(body) {
  const notes = await api('/api/me/notes');
  const active = notes.filter(n => !n.done), done = notes.filter(n => n.done);
  body.innerHTML = `<div class="notes" data-testid="notes">
    <form class="note-add" id="noteAdd"><input name="title" placeholder="Ghi nhanh một việc cần làm… (Enter để lưu)" maxlength="300" autocomplete="off" data-testid="note-input">
      <input type="date" name="dueDate" aria-label="Hạn (tuỳ chọn)" title="Hạn (tuỳ chọn)" data-testid="note-input-due"><button class="btn btn-primary">${icon('plus')}Thêm</button></form>
    <p class="muted xs">${icon('approve')} Chỉ bạn nhìn thấy các ghi chú này — kể cả quản trị hệ thống và cấp trên cũng không xem được.</p>
    ${active.length ? `<div class="note-list">${active.map(noteRow).join('')}</div>` : '<div class="card empty">Chưa có ghi chú. Gõ vào ô phía trên để ghi nhanh việc cần nhớ, ý tưởng hay việc phát sinh trong cuộc họp.</div>'}
    ${done.length ? `<button type="button" class="btn btn-ghost btn-sm" data-show-done style="margin-top:14px">${showDone ? 'Ẩn' : 'Hiện'} ${done.length} ghi chú đã xong</button>
      ${showDone ? `<div class="note-list" style="margin-top:8px">${done.map(noteRow).join('')}</div>` : ''}` : ''}
  </div>`;
  const redraw = () => drawNotes(body);
  $('#noteAdd', body).onsubmit = async e => {
    e.preventDefault();
    const title = e.target.title.value.trim(); if (!title) return;
    try { await api('/api/me/notes', { method: 'POST', body: { title, dueDate: fromDateInput(e.target.dueDate.value) } }); await redraw(); $('[data-testid=note-input]', body)?.focus(); }
    catch (error) { toast(errorMessage(error), 'err'); }
  };
  body.onclick = async e => {
    if (e.target.closest('[data-show-done]')) { showDone = !showDone; return redraw(); }
    const row = e.target.closest('[data-note]'); if (!row) return;
    const id = Number(row.dataset.note), note = notes.find(n => n.id === id);
    const update = data => api(`/api/me/notes/${id}`, { method: 'PATCH', body: data });
    try {
      if (e.target.closest('[data-toggle]')) { openNote = openNote === id ? null : id; return redraw(); }
      if (e.target.closest('[data-pin]')) { await update({ pinned: !note.pinned }); return redraw(); }
      if (e.target.closest('[data-save]')) {
        await update({ title: row.querySelector('[name=title]').value, body: row.querySelector('[name=body]').value, dueDate: fromDateInput(row.querySelector('[name=dueDate]').value) });
        openNote = null; toast('Đã lưu ghi chú', 'ok'); return redraw();
      }
      if (e.target.closest('[data-delete]')) {
        if (!(await confirmDialog('Xoá ghi chú này? Không khôi phục được.', { danger: true, okText: 'Xoá' }))) return;
        await api(`/api/me/notes/${id}`, { method: 'DELETE' }); openNote = null; return redraw();
      }
      if (e.target.closest('[data-convert]')) return convert(note, redraw);
    } catch (error) { toast(errorMessage(error), 'err'); }
  };
  body.onchange = async e => {
    if (!e.target.matches('[data-done]')) return;
    const id = Number(e.target.closest('[data-note]').dataset.note);
    try { await api(`/api/me/notes/${id}`, { method: 'PATCH', body: { done: e.target.checked } }); } catch (error) { toast(errorMessage(error), 'err'); }
    redraw();
  };
}

function convert(note, redraw) {
  // Sổ giao việc của đơn vị: chỉ người quản lý / thành viên sổ được tạo việc gốc (máy chủ cũng chặn).
  const projects = store.projects.filter(p => p.rights?.canEdit && (p.visibility !== 'ASSIGNED' || p.rights.canManage || p.rights.memberRole));
  if (!projects.length) { toast('Bạn chưa có dự án nào được tạo việc', 'err'); return; }
  const modal = openModal(`<h2>Chuyển thành công việc</h2><p class="muted sm">Tạo việc <b>${esc(note.title)}</b> trong dự án, giao cho bạn. Ghi chú được đánh dấu đã xong.</p>
    <form><label class="field">Dự án<select name="projectId" data-testid="convert-project">${projects.map(p => `<option value="${p.id}">${esc(p.key)} · ${esc(p.name)}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" name="assignToMe" checked> Giao cho tôi</label><p class="error" id="convertError"></p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="convert-submit">Tạo việc</button></div></form>`);
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await api(`/api/me/notes/${note.id}/convert`, { method: 'POST', body: { projectId: Number(e.target.projectId.value), assignToMe: e.target.assignToMe.checked } });
      closeModal(); toast(`Đã tạo ${r.code}`, 'ok'); openNote = null; redraw();
    } catch (error) { modal.querySelector('#convertError').textContent = errorMessage(error); }
  };
}
