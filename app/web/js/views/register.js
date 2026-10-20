// Kiểu xem "Sổ giao việc": bảng theo đúng mẫu Sổ theo dõi, kiểm soát giao việc nội bộ
// (nhóm việc / việc nhánh, trạng thái hạn tô màu, tiến độ %, sản phẩm, kết quả, đánh giá) + nhập Kế hoạch năm, nhập/xuất sổ Excel.
import { api, download } from '../api.js';
import { store, userById, deptName } from '../store.js';
import { $, esc, fmtDate, PRIORITY, deadlineStatus, deadlineChip, toast, errorMessage, openModal, closeModal, uiPref } from '../util.js';
import { icon } from '../icons.js';
import { stagePill } from './dispatch-panel.js';

// Trạng thái hạn theo mẫu sổ — hàng chip nằm trong thanh lọc chung của trang dự án (project.js, testid reg-filter-*).
export const REG_DL = [['', 'Tất cả'], ['OVERDUE', 'Quá hạn'], ['DUE_SOON', 'Sắp đến hạn'], ['IN_PROGRESS', 'Đang thực hiện'], ['DONE_ON_TIME', 'HT đúng hạn'], ['DONE_LATE', 'HT trễ hạn'], ['NO_DUE', 'Chưa có hạn']];
// Bộ lọc (hạn, kế hoạch, loại, phòng chủ trì…) đọc từ current.filters; ở đây chỉ còn trạng thái giao diện riêng của sổ.
const ui = { full: false, collapsed: new Set() };
// "Hiện đủ cột": nhớ theo người dùng (menu Hiển thị của trang dự án).
export function registerFull() { const v = uiPref('reg:full'); if (v != null) return !!v; try { return localStorage.getItem('workhub_register_full') === '1'; } catch { return false; } }
export function setRegisterFull(on) { ui.full = !!on; uiPref('reg:full', ui.full); }

const multiline = s => esc(s || '').replace(/\n/g, '<br>');
const names = list => list.map(u => esc(u.fullName)).join(', ');

export function drawRegister(body, current, { filtered, openItemHash, reload }) {
  const { project } = current;
  ui.full = registerFull();
  const soon = store.settings?.dueSoonDays ?? 3;
  const states = Object.fromEntries(project.states.map(s => [s.id, s]));
  // Mọi bộ lọc trừ trạng thái hạn: nhóm việc vẫn hiện khi có việc nhánh khớp trạng thái hạn đang chọn.
  const scoped = filtered(['dl']).map(i => ({ ...i, state: states[i.stateId], dl: deadlineStatus({ ...i, state: states[i.stateId] }, soon) }));
  const status = current.filters.dl || '';
  // Tiến độ việc giao về phòng: chỉ người chủ trì / lãnh đạo phòng chủ trì sửa (máy chủ kiểm tra lại).
  const me = store.me, leader = ['manager', 'deputy'].includes(me.role);
  const canProgress = i => !i.dispatchStatus || i.assignees.some(a => a.id === me.id) || (leader && me.departmentId === i.leadDepartmentId) || project.rights.canManage;
  const cols = 17 + (ui.full ? 4 : 0);
  const byParent = new Map();
  for (const i of scoped) if (i.parentId) { if (!byParent.has(i.parentId)) byParent.set(i.parentId, []); byParent.get(i.parentId).push(i); }
  const ids = new Set(scoped.map(i => i.id));
  const order = (a, b) => (a.planCode && b.planCode ? a.planCode.localeCompare(b.planCode, 'vi', { numeric: true }) : a.number - b.number);
  const roots = scoped.filter(i => !i.parentId || !ids.has(i.parentId)).sort(order);
  const statusOk = i => !status || i.dl.code === status || (byParent.get(i.id) || []).some(c => c.dl.code === status);
  const canEdit = project.rights.canEdit;
  const pr = p => (p === 'NONE' ? '' : `<span class="prio prio-${p}">${esc(PRIORITY[p].label)}</span>`);
  const row = (i, stt, child) => {
    const kids = byParent.get(i.id) || [];
    const group = !child && kids.length;
    // Nhóm việc: tiến độ = trung bình các việc nhánh (chỉ hiển thị, sửa ở từng việc nhánh).
    const progress = group ? Math.round(kids.reduce((n, c) => n + (c.progress || 0), 0) / kids.length) : i.progress;
    const assigner = i.assignedById ? userById(i.assignedById)?.fullName || '' : '';
    return `<tr class="reg-row${child ? ' child' : ''}${group ? ' group' : ''}" data-id="${i.id}" data-testid="reg-${esc(i.code)}">
      <td class="num">${stt}</td><td class="code">${esc(i.code)}${i.refCode ? `<div class="muted xs">${esc(i.refCode)}</div>` : ''}</td>
      <td class="reg-title">${group ? `<button class="icon-btn reg-toggle" data-toggle="${i.id}" aria-label="${ui.collapsed.has(i.id) ? 'Mở' : 'Thu'} việc nhánh">${icon(ui.collapsed.has(i.id) ? 'right' : 'down')}</button>` : ''}${child ? '<span class="reg-arrow">↳</span>' : ''}${!child ? `<span class="type-tag type-${i.taskType}" title="${i.taskType === 'PLAN' ? 'Kế hoạch năm' : 'Đột xuất (theo chỉ đạo)'}">${i.taskType === 'PLAN' ? 'KH' : 'ĐX'}</span>` : ''}<span>${i.planCode && !child ? `<b>${esc(i.planCode)}</b> ` : ''}${esc(i.title)}</span>${i.dispatchStatus === 'PENDING' ? ' <span class="pill warn">Chờ phòng tiếp nhận</span>' : ''}${group ? ` <span class="muted xs">(${kids.length} việc nhánh)</span>` : ''}</td>
      <td class="nowrap">${fmtDate(i.dueDate)}</td>
      <td class="nowrap">${deadlineChip(i.dl)}</td><td class="nowrap">${i.dispatchStatus || i.stage?.code === 'RETURNED' || i.stage?.code?.startsWith('WAIT') ? stagePill(i.stage) : ''}</td><td class="num ${i.dl.daysLeft < 0 ? 'due overdue' : ''}">${i.dl.daysLeft ?? ''}</td>
      <td class="reg-people">${names(i.assignees)}${i.leadDepartmentId && !child ? `<div class="muted xs">${esc(deptName(i.leadDepartmentId))}</div>` : ''}</td>
      <td class="reg-progress">${group ? `<b title="Trung bình các việc nhánh">${progress}%</b>` : canEdit && canProgress(i) && !['COMPLETED', 'CANCELLED'].includes(i.state?.category)
        ? `<input type="number" min="0" max="100" step="5" value="${i.progress}" data-progress="${i.id}" aria-label="Tiến độ % ${esc(i.code)}" data-testid="progress-${esc(i.code)}">`
        : `<b>${i.progress}%</b>`}<span class="bar-mini"><i style="width:${progress}%"></i></span></td>
      <td class="nowrap">${i.state?.category === 'COMPLETED' ? fmtDate(i.completedAt) : ''}</td>
      <td class="nowrap">${pr(i.priority)}</td>
      <td class="reg-people">${[names(i.supporters || []), esc(i.coordinatorText || '')].filter(Boolean).join('; ')}</td>
      <td class="reg-people">${esc(assigner)}</td><td class="nowrap">${fmtDate(i.assignedAt)}</td><td class="reg-src">${esc(i.source || '')}</td>
      <td class="reg-src">${(i.basisDocs || []).map(d => `<div>${esc(d.number)}${d.issuedOn ? ` <span class="muted xs">${fmtDate(d.issuedOn)}</span>` : ''}</div>`).join('')}</td>
      <td class="reg-text">${multiline(i.deliverable)}</td>
      ${ui.full ? `<td class="reg-text">${multiline(i.outputs)}</td><td class="reg-text">${multiline(i.resultNote)}</td><td class="reg-text">${multiline(i.review)}</td><td class="reg-text">${multiline(i.note)}</td>` : ''}
    </tr>`;
  };
  let stt = 0, lastSection = null;
  const rows = [];
  for (const r of roots) {
    const kids = (byParent.get(r.id) || []).sort(order);
    if (!statusOk(r)) continue;
    if (r.planSection && r.planSection !== lastSection) { lastSection = r.planSection; rows.push(`<tr class="reg-section"><td colspan="${cols}">${esc(r.planSection)}</td></tr>`); }
    rows.push(row(r, ++stt, false));
    if (!ui.collapsed.has(r.id)) for (const c of kids) if (!status || c.dl.code === status || r.dl.code === status) rows.push(row(c, ++stt, true));
  }
  body.innerHTML = `<div class="reg-wrap"><table class="table reg" data-testid="register">
      <thead><tr><th>STT</th><th>Mã CV</th><th>Nội dung công việc</th><th>Hạn hoàn thành</th><th>Trạng thái</th><th>Khâu</th><th>Còn lại (ngày)</th><th>Người chủ trì</th><th>Tiến độ</th><th>Ngày HT thực tế</th><th>Ưu tiên</th><th>Người phối hợp</th><th>Người giao</th><th>Ngày giao</th><th>Nguồn giao việc</th><th>Văn bản căn cứ</th><th>Sản phẩm đầu ra</th>
        ${ui.full ? '<th>Sản phẩm đã có theo tiến độ</th><th>Kết quả / Khó khăn, kiến nghị</th><th>Đánh giá của người giao</th><th>Ghi chú</th>' : ''}</tr></thead>
      <tbody>${rows.join('') || `<tr><td colspan="${cols}" class="empty">Sổ chưa có việc nào. Dùng Tạo việc, Giao nhiều việc hoặc Nhập sổ Excel.</td></tr>`}</tbody></table></div>
    <p class="muted xs">Trạng thái tự tính: <b>Quá hạn</b> = đã qua hạn mà chưa hoàn thành; <b>Sắp đến hạn</b> = còn 0–${soon} ngày; HT đúng/trễ hạn so ngày hoàn thành thực tế với hạn. Nhấn một dòng để mở chi tiết. Tệp "Xuất sổ Excel" giữ đúng thứ tự cột của mẫu sổ.</p>`;
  body.onclick = e => {
    const tg = e.target.closest('[data-toggle]'); if (tg) { const id = Number(tg.dataset.toggle); ui.collapsed.has(id) ? ui.collapsed.delete(id) : ui.collapsed.add(id); return drawRegister(body, current, { filtered, openItemHash, reload }); }
    if (e.target.closest('input,select,label')) return;
    const tr = e.target.closest('tr[data-id]'); if (tr) openItemHash(tr.dataset.id);
  };
  body.onchange = async e => {
    const p = e.target.dataset.progress;
    if (p) {
      try { await api(`/api/items/${p}`, { method: 'PATCH', body: { progress: Number(e.target.value) } }); toast('Đã cập nhật tiến độ', 'ok'); }
      catch (error) { toast(errorMessage(error), 'err'); }
      reload();
    }
  };
}

// Nhập Kế hoạch công tác năm (.docx): xem trước rồi mới tạo việc.
export function openPlanImport(project, reload) {
  const leaders = store.users.filter(u => ['director', 'manager'].includes(u.role));
  const modal = openModal(`<h2>Nhập Kế hoạch công tác năm</h2>
    <p class="muted sm">Chọn văn bản Word (.docx) có bảng <b>"Phân công công việc cụ thể"</b> (TT · Nội dung · Thời gian · Địa điểm · Mô tả · Kết quả dự kiến · Thực hiện).
      Mỗi nhiệm vụ thành một dòng trong Sổ giao việc (nguồn "Kế hoạch năm"); các mốc "Tháng …: …" thành việc nhánh; "Kết quả dự kiến" thành sản phẩm đầu ra.</p>
    <form><label class="field">Tệp kế hoạch (.docx)<input type="file" name="file" accept=".docx" required data-testid="plan-file"></label>
    <label class="field">Người giao việc<select name="assignedById" data-testid="plan-assigner"><option value="">${esc(store.me.fullName)} (tôi)</option>${leaders.filter(u => u.id !== store.me.id).map(u => `<option value="${u.id}">${esc(u.fullName)}${u.displayTitle ? ' — ' + esc(u.displayTitle) : ''}</option>`).join('')}</select></label>
    <div id="planPreview"></div><p class="error" id="planError"></p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-ghost" data-testid="plan-preview" data-act="preview">Xem trước</button><button type="button" class="btn btn-primary hidden" data-act="import" data-testid="plan-import">Tạo việc từ kế hoạch</button></div></form>`, { wide: true });
  const form = modal.querySelector('form');
  modal.querySelector('[data-close]').onclick = () => closeModal();
  const send = async dry => {
    const fd = new FormData(form);
    return api(`/api/projects/${project.id}/plan-import${dry ? '?dryRun=1' : ''}`, { method: 'POST', form: fd });
  };
  form.onsubmit = async e => {
    e.preventDefault();
    $('#planError', modal).textContent = '';
    try {
      const p = await send(true);
      const ms = p.tasks.reduce((n, t) => n + t.milestones, 0);
      $('#planPreview', modal).innerHTML = `<div class="card" data-testid="plan-summary"><b>${esc(p.name)}</b> — ${p.tasks.length} nhiệm vụ, ${ms} mốc (việc nhánh), ${p.sections.length} nhóm nhiệm vụ
        ${p.warnings.length ? `<ul class="warn-list">${p.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul><p class="muted xs">Có thể tạo tài khoản cho các cán bộ trên rồi nhập lại, hoặc giao người chủ trì sau.</p>` : ''}
        ${p.dispatch ? `<p class="muted sm">${p.departments.matched} nhiệm vụ giao về phòng chủ trì (chờ phòng tiếp nhận)${p.departments.unmatched.length ? ` · chưa khớp phòng: ${p.departments.unmatched.map(esc).join(', ')}` : ''}.</p>` : ''}
        <div class="reg-wrap" style="max-height:320px"><table class="table"><thead><tr><th>TT</th><th>Nhiệm vụ</th><th>Hạn</th><th>Kinh phí (tr.đ)</th><th>Chủ trì</th><th>Mốc</th></tr></thead><tbody>
        ${p.tasks.map(t => `<tr><td class="code">${esc(t.code)}</td><td>${esc(t.title)}</td><td class="nowrap">${fmtDate(t.due)}</td><td class="num">${t.budget ?? ''}</td><td>${t.leadDepartment ? `<b>${esc(t.leadDepartment.name)}</b>${(t.supportDepartments || []).length ? ` <span class="muted xs">+ ${t.supportDepartments.map(x => esc(x.name)).join(', ')}</span>` : ''}<br>` : ''}${t.leadUnit && !t.leadDepartment ? `<span class="due soon">${esc(t.leadUnit)} (chưa khớp phòng)</span>` : t.leadDepartment ? '' : esc(t.leadUnit || '')}${t.leadIds.length ? ' · ' + t.leadIds.map(id => esc(userById(id)?.fullName || '')).join(', ') : t.unmatchedLeads.length ? ' · <span class="due soon">chưa có tài khoản</span>' : ''}</td><td class="num">${t.milestones}</td></tr>`).join('')}</tbody></table></div></div>`;
      modal.querySelector('[data-act="import"]').classList.remove('hidden');
    } catch (error) { $('#planError', modal).textContent = errorMessage(error); }
  };
  modal.querySelector('[data-act="import"]').onclick = async () => {
    try { const r = await send(false); closeModal(); toast(`Đã tạo ${r.count} việc từ kế hoạch`, 'ok'); reload(); }
    catch (error) { $('#planError', modal).textContent = errorMessage(error); }
  };
}

// Nhập sổ giao việc Excel đúng mẫu (có xem trước).
export function openRegisterImport(project, reload) {
  const modal = openModal(`<h2>Nhập sổ giao việc từ Excel</h2>
    <p class="muted sm">Dùng file theo mẫu <b>"Sổ theo dõi, kiểm soát giao việc"</b> (dòng tiêu đề có cột "Nội dung công việc"). Dòng bắt đầu bằng <b>↳</b> là việc nhánh của dòng phía trên.
      Tên người giao / chủ trì / phối hợp được khớp với tài khoản; dòng có "Ngày hoàn thành thực tế" được ghi nhận đã hoàn thành. Cột Trạng thái, Số ngày còn lại tự tính lại; cột "Đã báo Zalo" bỏ qua.</p>
    <form><label class="field">Tệp .xlsx<input type="file" name="file" accept=".xlsx" required data-testid="register-file"></label>
    <div id="regPreview"></div><p class="error" id="regError"></p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-ghost" data-testid="register-preview">Xem trước</button><button type="button" class="btn btn-primary hidden" data-act="import" data-testid="register-import">Nhập vào sổ</button></div></form>`, { wide: true });
  const form = modal.querySelector('form');
  modal.querySelector('[data-close]').onclick = () => closeModal();
  const send = dry => api(`/api/projects/${project.id}/register-import${dry ? '?dryRun=1' : ''}`, { method: 'POST', form: new FormData(form) });
  form.onsubmit = async e => {
    e.preventDefault();
    $('#regError', modal).textContent = '';
    try {
      const p = await send(true);
      $('#regPreview', modal).innerHTML = `<div class="card" data-testid="register-summary">${p.rows} dòng: ${p.groups} việc / nhóm việc, ${p.children} việc nhánh, ${p.completed} đã hoàn thành.
        ${(p.notes || []).length ? `<ul class="sm">${p.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        ${p.warnings.length ? `<ul class="warn-list">${p.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '<div class="muted sm">Đã khớp toàn bộ tên cán bộ.</div>'}</div>`;
      modal.querySelector('[data-act="import"]').classList.remove('hidden');
    } catch (error) { $('#regError', modal).textContent = errorMessage(error); }
  };
  modal.querySelector('[data-act="import"]').onclick = async () => {
    try { const r = await send(false); closeModal(); toast(`Đã nhập ${r.created} dòng vào sổ`, 'ok'); reload(); }
    catch (error) { $('#regError', modal).textContent = errorMessage(error); }
  };
}

export async function exportRegister(project) {
  try { const name = await download(`/api/projects/${project.id}/register.xlsx`); toast('Đã tải ' + name, 'ok'); } catch (error) { toast(errorMessage(error), 'err'); }
}
