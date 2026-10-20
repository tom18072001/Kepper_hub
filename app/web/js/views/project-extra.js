// Tab Chu kỳ và tab Tiếp nhận của trang dự án.
import { api } from '../api.js';
import { $, esc, fmtDate, prioChip, stateChip, toast, openModal, closeModal, formData, confirmDialog, errorMessage, dateInput, PRIORITY } from '../util.js';

const CYCLE_STATUS = { ACTIVE: 'Đang chạy', UPCOMING: 'Sắp tới', COMPLETED: 'Đã kết thúc' };
export function currentCycle(cycles) { return cycles.find(c => c.status === 'ACTIVE') || null; }

// ---------- Chu kỳ ----------
export function drawCycles(body, current, { openItemHash, reload }) {
  const { project, cycles, items } = current;
  const states = Object.fromEntries(project.states.map(s => [s.id, s]));
  const canEdit = project.rights.canEdit;
  const noCycle = items.filter(i => !i.cycleId && !['COMPLETED', 'CANCELLED'].includes(states[i.stateId]?.category)).length;
  body.innerHTML = `<div class="row" style="margin-bottom:12px">${canEdit ? '<button class="btn btn-primary btn-sm" data-act="new" data-testid="new-cycle"><svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14"/><path d="M12 5v14"/></svg>Tạo chu kỳ</button>' : ''}
      <span class="muted sm">${noCycle} việc đang mở chưa thuộc chu kỳ nào.</span></div>
    ${cycles.length ? [...cycles].reverse().map(c => {
      const list = items.filter(i => i.cycleId === c.id);
      const next = cycles.find(x => x.startDate > c.startDate);
      return `<div class="card cycle-card" data-testid="cycle-${esc(c.name)}" style="margin-bottom:12px">
        <div class="row"><h3 class="grow">${esc(c.name)} <span class="pill">${CYCLE_STATUS[c.status]}</span></h3>
          <span class="muted sm">${fmtDate(c.startDate)} – ${fmtDate(c.endDate)}${c.daysLeft != null ? ` · còn ${c.daysLeft} ngày` : ''}</span>
          ${canEdit && next && c.open ? `<button class="btn btn-ghost btn-sm" data-roll="${c.id}" data-to="${next.id}" data-testid="rollover-${esc(c.name)}">Chuyển ${c.open} việc chưa xong → ${esc(next.name)}</button>` : ''}
          ${project.rights.canManage ? `<button class="btn btn-ghost btn-sm" data-del="${c.id}">Xoá</button>` : ''}</div>
        <div class="row" style="margin:8px 0"><span class="progress" style="max-width:360px"><i style="width:${c.progress}%"></i></span><b data-testid="cycle-progress-${esc(c.name)}">${c.done}/${c.scope} việc · ${c.progress}%</b></div>
        ${list.length ? `<table class="table"><tbody>${list.map(i => `<tr class="clickable" data-id="${i.id}"><td class="code" style="width:80px">${esc(i.code)}</td><td>${esc(i.title)}</td><td style="width:170px">${stateChip(states[i.stateId])}</td><td style="width:60px">${prioChip(i.priority)}</td><td style="width:110px" class="muted sm">${fmtDate(i.dueDate)}</td></tr>`).join('')}</tbody></table>`
          : '<div class="muted sm">Chưa có việc. Chọn chu kỳ trong panel chi tiết việc hoặc lọc theo chu kỳ rồi thêm nhanh trên Bảng.</div>'}
      </div>`;
    }).join('') : '<div class="card empty">Chưa có chu kỳ. Chu kỳ giúp nhóm lập kế hoạch theo tuần hoặc 2 tuần và theo dõi tiến độ.</div>'}`;
  body.onclick = async e => {
    if (e.target.closest('[data-act="new"]')) return openCycleForm(current, reload);
    const roll = e.target.closest('[data-roll]');
    if (roll) {
      try { const r = await api(`/api/cycles/${roll.dataset.roll}/rollover`, { method: 'POST', body: { toCycleId: Number(roll.dataset.to) } }); toast(`Đã chuyển ${r.moved} việc`, 'ok'); }
      catch (error) { toast(errorMessage(error), 'err'); }
      return reload();
    }
    const del = e.target.closest('[data-del]');
    if (del && await confirmDialog('Xoá chu kỳ? Các việc trong chu kỳ vẫn được giữ lại.', { danger: true, okText: 'Xoá' })) {
      await api(`/api/cycles/${del.dataset.del}`, { method: 'DELETE' }).catch(err => toast(errorMessage(err), 'err'));
      return reload();
    }
    const row = e.target.closest('tr[data-id]'); if (row) openItemHash(row.dataset.id);
  };
}
export function openCycleForm(current, reload) {
  const last = (current.cycles || []).at(-1);
  const DAY = 86_400_000;
  const start = last ? new Date(new Date(last.endDate).getTime() + DAY) : new Date();
  const modal = openModal(`<h2>Tạo chu kỳ</h2><form>
    <label class="field">Tên (để trống: tự đặt)<input name="name" maxlength="80" data-testid="cycle-name"></label>
    <div class="grid2"><label class="field">Bắt đầu<input type="date" name="startDate" required value="${dateInput(start)}" data-testid="cycle-start"></label>
    <label class="field">Kết thúc<input type="date" name="endDate" required value="${dateInput(new Date(start.getTime() + 13 * DAY))}" data-testid="cycle-end"></label></div>
    <p class="muted xs">Các chu kỳ trong một dự án không được trùng thời gian.</p><p class="error" id="cycleError"></p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="cycle-save">Tạo</button></div></form>`);
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    try { const created = await api(`/api/projects/${current.project.id}/cycles`, { method: 'POST', body: formData(e.target) }); closeModal(); toast('Đã tạo chu kỳ', 'ok'); reload(created); }
    catch (error) { modal.querySelector('#cycleError').textContent = errorMessage(error); }
  };
}

// ---------- Tiếp nhận ----------
const INTAKE_STATUS = { PENDING: 'Chờ xử lý', ACCEPTED: 'Đã tiếp nhận', DECLINED: 'Đã từ chối' };
export async function drawIntake(body, current, { reload }) {
  const { project } = current;
  body.innerHTML = '<div class="empty">Đang tải…</div>';
  const rows = await api(`/api/projects/${project.id}/intake`);
  const pending = rows.filter(r => r.status === 'PENDING');
  body.innerHTML = `<p class="muted sm" style="margin-top:0">Yêu cầu do các phòng ban gửi qua mục <b>Gửi yêu cầu</b>. Tiếp nhận sẽ tạo việc trong cột đầu tiên; từ chối cần lý do và người gửi được thông báo.</p>
    <h3 style="margin:10px 0">Chờ xử lý <span class="muted sm">${pending.length}</span></h3>
    ${pending.map(r => `<div class="card" style="margin-bottom:10px" data-testid="intake-${r.id}">
      <div class="row"><b class="grow">${esc(r.title)}</b>${prioChip(r.priority)}<span class="muted sm">${esc(r.requesterName || '')} · ${esc(r.requesterDepartment || '')} · ${fmtDate(r.createdAt)}</span></div>
      ${r.descriptionHtml ? `<div class="rich" style="margin-top:6px">${r.descriptionHtml}</div>` : ''}
      ${r.dueDate ? `<div class="muted sm">Hạn mong muốn: ${fmtDate(r.dueDate)}</div>` : ''}
      <div class="row" style="margin-top:8px"><button class="btn btn-ok btn-sm" data-accept="${r.id}" data-testid="intake-accept">Tiếp nhận → tạo việc</button><button class="btn btn-ghost btn-sm" data-decline="${r.id}" data-testid="intake-decline">Từ chối</button></div></div>`).join('') || '<div class="card empty" data-testid="intake-empty">Không có yêu cầu chờ xử lý.</div>'}
    ${rows.length > pending.length ? `<h3 style="margin:18px 0 8px">Đã xử lý</h3><table class="table"><thead><tr><th>Yêu cầu</th><th>Người gửi</th><th>Kết quả</th><th>Người xử lý</th><th>Ghi chú</th></tr></thead><tbody>
      ${rows.filter(r => r.status !== 'PENDING').map(r => `<tr><td>${esc(r.title)}</td><td>${esc(r.requesterName || '')}</td><td>${INTAKE_STATUS[r.status]}${r.itemCode ? ` · <span class="code">${esc(r.itemCode)}</span>` : ''}</td><td>${esc(r.decidedByName || '')}</td><td class="muted sm">${esc(r.decisionNote || '')}</td></tr>`).join('')}</tbody></table>` : ''}`;
  body.onclick = async e => {
    const accept = e.target.closest('[data-accept]');
    if (accept) {
      try { const r = await api(`/api/intake/${accept.dataset.accept}/accept`, { method: 'POST', body: {} }); toast(`Đã tiếp nhận, tạo ${r.itemCode}`, 'ok'); }
      catch (error) { toast(errorMessage(error), 'err'); }
      return reload();
    }
    const decline = e.target.closest('[data-decline]');
    if (decline) {
      const note = await confirmDialog('Từ chối yêu cầu này? Người gửi sẽ nhận được lý do.', { okText: 'Từ chối', danger: true, input: 'Lý do từ chối' });
      if (note == null) return;
      if (!note) { toast('Cần nhập lý do từ chối', 'err'); return; }
      try { await api(`/api/intake/${decline.dataset.decline}/decline`, { method: 'POST', body: { note } }); toast('Đã từ chối yêu cầu', 'ok'); }
      catch (error) { toast(errorMessage(error), 'err'); }
      return reload();
    }
  };
}

// ---------- Trang "Gửi yêu cầu" (toàn hệ thống) ----------
function requestRows(mine) {
  return mine.map(r => `<tr data-testid="request-${r.id}"><td><b>${esc(r.title)}</b><div class="muted xs">${esc(r.project.name)} · ${fmtDate(r.createdAt)}</div></td>
    <td style="width:200px"><span class="pill">${INTAKE_STATUS[r.status]}</span>${r.item ? `<div class="sm"><span class="code">${esc(r.item.code)}</span> · ${esc(r.item.state)}</div>` : ''}${r.decisionNote ? `<div class="muted xs">${esc(r.decisionNote)}</div>` : ''}</td></tr>`).join('') || '<tr><td class="empty">Chưa gửi yêu cầu nào.</td></tr>';
}
export async function renderRequests(root, setCrumbs) {
  setCrumbs('Gửi yêu cầu');
  const [targets, mine] = await Promise.all([api('/api/intake/targets'), api('/api/intake/mine')]);
  root.innerHTML = `<div class="page-head"><h1>Gửi yêu cầu tới phòng ban khác</h1></div>
    <div class="dash-grid">
      <form class="card" id="intakeForm"><h3 style="margin-bottom:10px">Yêu cầu mới</h3>
        ${targets.length ? `<label class="field">Gửi tới<select name="projectId" required data-testid="intake-target">${targets.map(t => `<option value="${t.id}">${esc(t.department.name)} — ${esc(t.name)}</option>`).join('')}</select></label>
        <label class="field">Nội dung yêu cầu<input name="title" required maxlength="300" data-testid="intake-title"></label>
        <label class="field">Mô tả chi tiết<textarea name="description" rows="4" data-testid="intake-description"></textarea></label>
        <div class="grid2"><label class="field">Mức ưu tiên<select name="priority">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}"${k === 'MEDIUM' ? ' selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <label class="field">Hạn mong muốn<input type="date" name="dueDate"></label></div>
        <p class="muted xs">Không đưa mật khẩu, số tài khoản hay giấy tờ tuỳ thân vào yêu cầu.</p>
        <button class="btn btn-primary" data-testid="intake-submit">Gửi yêu cầu</button>` : '<div class="empty">Chưa có phòng ban nào mở nhận yêu cầu.</div>'}
      </form>
      <div class="card"><h3 style="margin-bottom:10px">Yêu cầu tôi đã gửi</h3>
        <table class="table" data-testid="my-requests"><tbody id="myRequests">${requestRows(mine)}</tbody></table></div>
    </div>`;
  root.querySelector('#intakeForm').onsubmit = async e => {
    e.preventDefault();
    const f = formData(e.target);
    try {
      await api('/api/intake', { method: 'POST', body: { projectId: Number(f.projectId), title: f.title, description: f.description, priority: f.priority, dueDate: f.dueDate ? new Date(f.dueDate + 'T00:00:00+07:00').toISOString() : null } });
      // Chỉ xoá nội dung đã gửi và làm mới danh sách (giữ ô "Gửi tới"), không vẽ lại cả trang để không mất chữ đang gõ.
      e.target.title.value = ''; e.target.description.value = ''; e.target.dueDate.value = '';
      toast('Đã gửi yêu cầu', 'ok');
      $('#myRequests', root).innerHTML = requestRows(await api('/api/intake/mine'));
    } catch (error) { toast(errorMessage(error), 'err'); }
  };
}
