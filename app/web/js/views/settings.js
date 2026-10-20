// Tạo dự án và cài đặt dự án: thông tin chung, cột trạng thái + WIP, thành viên, quy trình duyệt nhiều cấp.
import { api } from '../api.js';
import { store, reloadProjects, labelsFor } from '../store.js';
import { $, $$, esc, VISIBILITY, APPROVER, CATEGORY, PRIORITY, toast, openModal, closeModal, formData, errorMessage, fmtDateTime, labelChip, multiSelect, readMulti, bindMulti } from '../util.js';
import { scheduleFields, bindSchedule, readSchedule, openRepeatDialog } from './recurring-form.js';
import { renderProjectNav } from '../main.js';

export function openCreateProject(onCreated) {
  const system = store.me.isRootAdmin || store.me.permissions['projects.manage']?.operate === 'SYSTEM';
  const depts = store.departments.filter(d => d.isActive && (system || d.id === store.me.departmentId));
  const modal = openModal(`<h2>Tạo dự án</h2><form>
    <div class="grid2"><label class="field">Mã dự án<input name="key" required maxlength="10" pattern="[A-Za-z][A-Za-z0-9]{1,9}" placeholder="VD: MKT" data-testid="project-key"></label>
    <label class="field">Tên dự án<input name="name" required maxlength="160" data-testid="project-name"></label>
    <label class="field">Phòng ban<select name="departmentId" data-testid="project-department">${depts.map(d => `<option value="${d.id}"${d.id === store.me.departmentId ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
    <label class="field">Ai được xem<select name="visibility" data-testid="project-visibility">${Object.entries(VISIBILITY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
    <label class="field">Mô tả<textarea name="description" rows="2"></textarea></label>
    <label class="field">Kiểu dự án<select name="template" data-testid="project-template">
      <option value="MTL" selected>Theo Master Timeline — hạng mục theo tháng T, đường găng, mốc; dùng chung giữa các bộ phận</option>
      <option value="">Quy trình công việc — Tồn đọng → Cần làm → Đang làm → Chờ duyệt → Hoàn thành</option>
      <option value="WEEK">Lịch tuần — cột Thứ 2 … Cuối tuần, không duyệt (vd. ai ở / không ở văn phòng)</option></select></label>
    <label class="field mtl-t0">Tháng T0 (bắt đầu Master Timeline)<input type="month" name="t0" data-testid="project-t0"></label>
    <fieldset class="approval-setup"><legend>Quy trình duyệt</legend>
      <label class="field">Số cấp duyệt<select name="tpl" data-testid="project-approval-template">
        <option value="1" selected>1 cấp — Trưởng phòng duyệt</option><option value="2">2 cấp — Trưởng phòng → Ban giám đốc</option><option value="0">Không cần duyệt</option></select></label>
      <div class="grid2">
        <label class="field" data-lvl="1">Người duyệt cấp 1<select name="ap1" data-testid="project-approver-1"><option value="DEPARTMENT_MANAGER">Trưởng phòng (tự động)</option><option value="PROJECT_LEAD">Trưởng dự án</option>${approverUserOptions()}</select></label>
        <label class="field" data-lvl="2">Người duyệt cấp 2<select name="ap2" data-testid="project-approver-2"><option value="DIRECTOR">Ban giám đốc (bất kỳ ai)</option><option value="SUPERVISOR">Người giao / PGĐ phụ trách phòng</option>${approverUserOptions()}</select></label>
        <label class="field" data-lvl="2">Việc mới mặc định cần<select name="defaultLevels" data-testid="project-default-levels"><option value="1">Chỉ cấp 1</option><option value="">Đủ 2 cấp</option></select></label>
      </div>
      <p class="muted xs">Mặc định "Chỉ cấp 1": việc quan trọng trưởng phòng chọn thêm cấp 2, hoặc đặt quy tắc tự động. Có thể đổi người duyệt, thêm quy tắc tự động (theo nhãn / mức ưu tiên) trong Cài đặt dự án; trưởng phòng chọn được mức duyệt cho từng việc.</p>
    </fieldset>
    <p class="muted xs">Dự án MTL: cột Chưa bắt đầu, Đang thực hiện, Chờ duyệt, Hoàn thành, Tạm dừng, Huỷ; sau khi tạo, vào "Khác → Nhập MTL từ Excel". Dự án quy trình: Tồn đọng, Cần làm, Đang làm (giới hạn 5), Chờ duyệt, Hoàn thành, Huỷ.</p>
    <p class="error" id="projError"></p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="project-save">Tạo dự án</button></div></form>`);
  const syncTpl = () => { const n = Number(modal.querySelector('[name=tpl]').value); $$('[data-lvl]', modal).forEach(el => el.classList.toggle('hidden', Number(el.dataset.lvl) > n)); };
  modal.querySelector('[name=tpl]').onchange = syncTpl; syncTpl();
  // Lịch tuần: các cột là ngày, không có luồng duyệt.
  const syncKind = () => {
    const v = modal.querySelector('[name=template]').value, noFlow = v === 'WEEK' || v === 'MTL';
    modal.querySelector('.approval-setup').hidden = noFlow; if (noFlow) { modal.querySelector('[name=tpl]').value = '0'; syncTpl(); }
    modal.querySelector('.mtl-t0').hidden = v !== 'MTL'; modal.querySelector('[name=t0]').required = v === 'MTL';
    // Dự án MTL dùng chung: mặc định toàn công ty xem được.
    const vis = modal.querySelector('[name=visibility]');
    if (v === 'MTL' && !vis.dataset.touched) { vis.value = 'PUBLIC'; vis.dataset.auto = '1'; }
    else if (v !== 'MTL' && vis.dataset.auto) { vis.value = 'DEPARTMENT'; delete vis.dataset.auto; }
  };
  modal.querySelector('[name=visibility]').addEventListener('change', e => { e.target.dataset.touched = '1'; delete e.target.dataset.auto; });
  modal.querySelector('[name=template]').onchange = syncKind; syncKind();
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const { tpl, ap1, ap2, defaultLevels, t0, ...f } = formData(e.target);
    if (f.template === 'MTL') Object.assign(f, { kind: 'MTL', t0Date: new Date(t0 + '-01T00:00:00+07:00').toISOString() });
    const step = (v, name) => v.startsWith('USER:') ? { approverType: 'USER', approverUserId: Number(v.slice(5)), name } : { approverType: v, name };
    const approvalSteps = [step(ap1, 'Trưởng phòng duyệt'), step(ap2, 'Giám đốc duyệt')].slice(0, Number(tpl));
    if (approvalSteps[0]?.approverType === 'PROJECT_LEAD') approvalSteps[0].name = 'Trưởng dự án duyệt';
    if (approvalSteps[0]?.approverType === 'USER') approvalSteps[0].name = 'Duyệt cấp 1';
    if (approvalSteps[1]?.approverType === 'USER') approvalSteps[1].name = 'Duyệt cấp 2';
    try {
      const project = await api('/api/projects', { method: 'POST', body: { ...f, key: f.key.toUpperCase(), departmentId: Number(f.departmentId), approvalSteps,
        defaultApprovalLevels: Number(tpl) === 2 && defaultLevels !== '' ? Number(defaultLevels) : null } });
      closeModal(); toast('Đã tạo dự án ' + project.key, 'ok'); onCreated?.(project);
    } catch (error) { $('#projError', modal).textContent = errorMessage(error); }
  };
}

// Người duyệt được chọn đích danh: chỉ trưởng phòng / ban giám đốc (tài khoản không phải admin IT).
function approverUserOptions(selected) {
  const list = store.users.filter(u => ['director', 'manager'].includes(u.role));
  return list.length ? `<optgroup label="Chọn đích danh">${list.map(u => `<option value="USER:${u.id}"${selected === u.id ? ' selected' : ''}>${esc(u.fullName)}</option>`).join('')}</optgroup>` : '';
}

export async function renderProjectSettings(root, id, setCrumbs) {
  const p = await api(`/api/projects/${id}`);
  setCrumbs(`<span class="muted">${esc(p.name)} /</span> Cài đặt`);
  if (!p.rights.canManage) { root.innerHTML = '<div class="card empty">Bạn không có quyền quản lý dự án này.</div>'; return; }
  const users = store.users;
  root.innerHTML = `<div class="page-head"><h1>Cài đặt dự án ${esc(p.key)}</h1><a class="btn btn-ghost" href="#/projects/${id}"><svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>Về bảng công việc</a></div>
  <div class="dash-grid" style="grid-template-columns:1fr">
    <form class="card" id="generalForm"><h3 style="margin-bottom:10px">Thông tin chung</h3>
      <div class="grid2"><label class="field">Tên<input name="name" required value="${esc(p.name)}"></label>
      <label class="field">Ai được xem<select name="visibility">${Object.entries(VISIBILITY).map(([k, v]) => `<option value="${k}"${p.visibility === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field">Trưởng dự án<select name="leadId" data-testid="settings-lead"><option value="">—</option>${users.map(u => `<option value="${u.id}"${p.leadId === u.id ? ' selected' : ''}>${esc(u.fullName)}</option>`).join('')}</select></label>
      <label class="field">Mô tả<input name="description" value="${esc(p.description || '')}"></label></div>
      <div class="row"><button class="btn btn-primary" data-testid="settings-save">Lưu</button><label class="check"><input type="checkbox" name="archived" ${p.archivedAt ? 'checked' : ''}> Lưu trữ dự án (chỉ đọc)</label></div></form>

    <div class="card danger-zone"><h3>Xoá dự án</h3><p class="muted sm">Dự án và toàn bộ công việc chuyển vào <b>Thùng rác</b>: không ai xem được nữa, khôi phục được trong 7 ngày; sau đó hệ thống xoá hẳn (kể cả tệp đính kèm). Muốn giữ lại để tra cứu thì dùng "Lưu trữ dự án".</p>
      <div class="row"><input id="confirmKey" placeholder="Nhập mã ${esc(p.key)} để xác nhận" maxlength="10" style="max-width:260px" data-testid="delete-project-key"><button class="btn btn-danger" id="deleteProject" data-testid="delete-project">Xoá dự án</button></div></div>

    <div class="card"><h3>Cột trạng thái & giới hạn WIP</h3><p class="muted sm">Cột đặt tên tuỳ ý. Nhóm của cột quyết định cách tính tiến độ và luồng duyệt: kéo vào cột nhóm "Chờ duyệt" là gửi duyệt, vào "Hoàn thành" là xong việc. Bảng chỉ để sắp xếp (lịch tuần, theo chủ đề…) thì chọn "Cột tự do". Dự án có duyệt cần cột Đang thực hiện, Chờ duyệt, Hoàn thành. Bỏ trống WIP = không giới hạn.</p>
      <div class="row state-presets"><span class="muted sm">Dùng mẫu:</span><button type="button" class="btn btn-ghost btn-sm" data-preset="week" data-testid="states-preset-week">Lịch tuần</button><button type="button" class="btn btn-ghost btn-sm" data-preset="flow">Quy trình công việc</button><button type="button" class="btn btn-ghost btn-sm" data-preset="free">Đổi hết thành cột tự do</button></div>
      <div id="statesEditor" data-testid="states-editor">${p.states.map(stateRow).join('')}</div>
      <div class="row"><button class="btn btn-ghost btn-sm" id="addState"><svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14"/><path d="M12 5v14"/></svg>Thêm cột</button><button class="btn btn-primary" id="saveStates" data-testid="save-states">Lưu cột</button></div></div>

    <div class="card"><h3>Quy trình duyệt nhiều cấp</h3><p class="muted sm">Khi việc được chuyển vào cột nhóm <b>Chờ duyệt</b>, hệ thống gửi lần lượt qua các cấp dưới đây. Duyệt hết các cấp → việc tự chuyển sang Hoàn thành; trả lại ở bất kỳ cấp nào → việc quay về cột trước đó. Để trống = không cần duyệt.</p>
      <div id="stepsEditor" data-testid="steps-editor">${p.approvalSteps.map(s => stepRow(s, users)).join('')}</div>
      ${p.approvalSteps.length ? `<label class="field" style="max-width:460px;margin-top:10px">Việc mới mặc định cần<select id="defaultLevels" data-testid="default-levels"><option value="">Đủ ${p.approvalSteps.length} cấp</option>${Array.from({ length: p.approvalSteps.length }, (_, n) => `<option value="${n}"${p.defaultApprovalLevels === n ? ' selected' : ''}>${n === 0 ? 'Không cần duyệt' : `${n} cấp đầu (${p.approvalSteps.slice(0, n).map(x => esc(x.name)).join(' → ')})`}</option>`).join('')}</select></label>` : ''}
      <div class="row"><button class="btn btn-ghost btn-sm" id="addStep" data-testid="add-step"><svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14"/><path d="M12 5v14"/></svg>Thêm cấp duyệt</button><button class="btn btn-primary" id="saveSteps" data-testid="save-steps">Lưu quy trình duyệt</button></div>
      ${p.approvalSteps.length ? `<h4 style="margin:22px 0 6px">Quy tắc tự động</h4>
      <p class="muted sm">Việc khớp quy tắc sẽ tự lấy số cấp duyệt tương ứng (nhiều quy tắc khớp → lấy số cấp cao nhất). Trưởng phòng vẫn chọn tay được cho từng việc; chọn tay luôn được ưu tiên.</p>
      <div id="rulesEditor" data-testid="rules-editor">${p.approvalRules.map(r => ruleRow(r, p)).join('')}</div>
      <div class="row"><button class="btn btn-ghost btn-sm" id="addRule" data-testid="add-rule">+ Thêm quy tắc</button><button class="btn btn-primary" id="saveRules" data-testid="save-rules">Lưu quy tắc</button></div>` : ''}
    </div>

    <div class="card"><h3>Nhãn của dự án</h3><p class="muted sm">Thành viên cũng tạo được nhãn mới ngay khi gắn nhãn cho việc (gõ tên trong ô Nhãn). Nhãn chung do quản trị hệ thống quản lý.</p>
      <div class="row" style="margin-bottom:10px">${labelsFor(p.id).filter(l => l.projectId == null).map(labelChip).join(' ') || '<span class="muted sm">Chưa có nhãn chung.</span>'}<span class="muted xs">(nhãn chung)</span></div>
      <div id="labelsEditor" data-testid="project-labels">${labelsFor(p.id).filter(l => l.projectId === p.id).map(l => `<div class="row" data-label="${l.id}" style="margin-bottom:6px"><input type="color" value="${esc(l.color)}" name="color" aria-label="Màu" style="width:44px"><input name="name" value="${esc(l.name)}" maxlength="40" style="max-width:260px" aria-label="Tên nhãn"><button type="button" class="btn btn-ghost btn-sm" data-save-label>Lưu</button><button type="button" class="btn btn-ghost btn-sm" data-del-label>Xoá</button></div>`).join('') || '<div class="muted sm">Dự án chưa có nhãn riêng.</div>'}</div>
      <div class="row" style="margin-top:8px"><input id="newLabel" placeholder="Tên nhãn mới" maxlength="40" style="max-width:260px" data-testid="new-project-label"><button class="btn btn-ghost btn-sm" id="addLabel" data-testid="add-project-label">+ Thêm nhãn</button></div></div>

    <div class="card"><h3>Việc lặp lại</h3><p class="muted sm">Hệ thống tự tạo việc lúc 07:00 (giờ Việt Nam) theo lịch. Dùng cho việc định kỳ như báo cáo tuần, kiểm tra sao lưu.</p>
      <div id="recurringList" data-testid="recurring-list"><div class="muted sm">Đang tải…</div></div>
      <form id="recurringForm" class="grid2" style="margin-top:10px">
        <label class="field">Tiêu đề việc<input name="title" required maxlength="300" data-testid="rec-title"></label>
        <div class="field">Người nhận${multiSelect('recAssignees', users.map(u => ({ id: u.id, label: u.fullName })), [], 'Chưa giao')}</div>
        <div style="grid-column:1/-1">${scheduleFields({}, { prefix: 'rec' })}</div>
        <div><button class="btn btn-primary" data-testid="rec-save">Thêm việc lặp lại</button></div>
      </form></div>

    <div class="card"><h3>Thành viên</h3><p class="muted sm">Chủ dự án quản lý cài đặt; Thành viên tạo và cập nhật việc; Người xem chỉ đọc. Với phạm vi "Cả phòng ban", nhân viên trong phòng ban cũng làm việc được mà không cần thêm.</p>
      <div id="membersEditor" data-testid="members-editor">${p.members.map(m => memberRow(m.userId, m.role, users)).join('')}</div>
      <div class="row"><select id="newMember" style="width:auto" data-testid="new-member">${users.filter(u => !p.members.some(m => m.userId === u.id)).map(u => `<option value="${u.id}">${esc(u.fullName)} (${esc(u.username)})</option>`).join('')}</select>
        <button class="btn btn-ghost btn-sm" id="addMember" data-testid="add-member"><svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14"/><path d="M12 5v14"/></svg>Thêm</button><button class="btn btn-primary" id="saveMembers" data-testid="save-members">Lưu thành viên</button></div></div>
  </div>`;

  root.querySelector('#generalForm').onsubmit = async e => {
    e.preventDefault();
    const f = formData(e.target);
    await save(`/api/projects/${id}`, { name: f.name, visibility: f.visibility, leadId: f.leadId ? Number(f.leadId) : null, description: f.description, archived: !!e.target.archived.checked, intakeEnabled: e.target.intakeEnabled ? !!e.target.intakeEnabled.checked : undefined }, 'Đã lưu thông tin');
    await reloadProjects(); renderProjectNav();
  };
  root.onclick = async e => {
    // Dùng closest(): nút có icon SVG bên trong thì e.target có thể là icon.
    if (e.target.closest('#addState')) {
      const rows = $$('#statesEditor [data-row]', root);
      const free = rows.length && rows.every(r => r.querySelector('[name=category]').value === 'OTHER');
      $('#statesEditor', root).insertAdjacentHTML('beforeend', stateRow({ name: '', category: free ? 'OTHER' : 'STARTED', color: '#64748b', wipLimit: null }));
    }
    // Mẫu cột: điền vào các dòng hiện có theo thứ tự (giữ id để không mất việc trong cột), thiếu thì thêm dòng. Bấm "Lưu cột" mới áp dụng.
    const preset = e.target.closest('[data-preset]');
    if (preset) {
      const editor = $('#statesEditor', root);
      const rows = () => $$('[data-row]', editor);
      const set = (r, s) => { r.querySelector('[name=name]').value = s.name; r.querySelector('[name=category]').value = s.category; r.querySelector('[name=color]').value = s.color; r.querySelector('[name=wip]').value = s.wipLimit ?? ''; };
      if (preset.dataset.preset === 'free') { for (const r of rows()) { r.querySelector('[name=category]').value = 'OTHER'; r.querySelector('[name=wip]').value = ''; } }
      else {
        const list = preset.dataset.preset === 'week'
          ? ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Cuối tuần'].map((name, i) => ({ name, category: 'OTHER', color: ['#2563eb', '#0891b2', '#16a34a', '#d97706', '#9333ea', '#64748b'][i], wipLimit: null }))
          : [['Tồn đọng', 'BACKLOG', '#94a3b8'], ['Cần làm', 'UNSTARTED', '#64748b'], ['Đang làm', 'STARTED', '#2563eb', 5], ['Chờ duyệt', 'REVIEW', '#d97706'], ['Hoàn thành', 'COMPLETED', '#16a34a'], ['Huỷ', 'CANCELLED', '#9ca3af']].map(([name, category, color, wipLimit]) => ({ name, category, color, wipLimit: wipLimit ?? null }));
        list.forEach((s, i) => { const r = rows()[i]; if (r) set(r, s); else editor.insertAdjacentHTML('beforeend', stateRow(s)); });
        if (rows().length > list.length) toast(`Còn ${rows().length - list.length} cột thừa ở cuối — bấm "Xoá" nếu không dùng (cột còn việc thì chuyển việc trước)`, 'ok');
      }
      toast('Đã điền mẫu — bấm "Lưu cột" để áp dụng', 'ok');
    }
    if (e.target.closest('#addStep')) $('#stepsEditor', root).insertAdjacentHTML('beforeend', stepRow({ approverType: 'DEPARTMENT_MANAGER', name: '' }, users));
    if (e.target.closest('#addMember')) { const sel = $('#newMember', root); if (sel.value) { $('#membersEditor', root).insertAdjacentHTML('beforeend', memberRow(Number(sel.value), 'MEMBER', users)); sel.selectedOptions[0].remove(); } }
    const rm = e.target.closest('[data-remove]'); if (rm) rm.closest('[data-row]').remove();
    const mv = e.target.closest('[data-up]'); if (mv) { const row = mv.closest('[data-row]'); row.previousElementSibling?.before(row); }
    if (e.target.closest('#saveStates')) {
      const states = $$('#statesEditor [data-row]', root).map(r => ({ id: r.dataset.id ? Number(r.dataset.id) : undefined, name: r.querySelector('[name=name]').value, category: r.querySelector('[name=category]').value, color: r.querySelector('[name=color]').value, wipLimit: r.querySelector('[name=wip]').value || null }));
      if (await save(`/api/projects/${id}/states`, { states }, 'Đã lưu cột')) renderProjectSettings(root, id, setCrumbs);
    }
    if (e.target.closest('#saveSteps')) {
      const steps = $$('#stepsEditor [data-row]', root).map(r => ({ name: r.querySelector('[name=name]').value, approverType: r.querySelector('[name=type]').value, approverUserId: r.querySelector('[name=user]').value || null }));
      const dl = $('#defaultLevels', root);
      const defaultApprovalLevels = dl && dl.value !== '' && Number(dl.value) < steps.length ? Number(dl.value) : null;
      if (await save(`/api/projects/${id}/approval-steps`, { steps, defaultApprovalLevels }, 'Đã lưu quy trình duyệt')) renderProjectSettings(root, id, setCrumbs);
    }
    if (e.target.closest('#deleteProject')) {
      try {
        await api(`/api/projects/${id}`, { method: 'DELETE', body: { confirmKey: $('#confirmKey', root).value.trim() } });
        toast(`Đã chuyển dự án ${p.key} vào thùng rác`, 'ok'); await reloadProjects(); renderProjectNav(); location.hash = '#/trash';
      } catch (error) { toast(errorMessage(error), 'err'); }
      return;
    }
    if (e.target.closest('#addRule')) $('#rulesEditor', root).insertAdjacentHTML('beforeend', ruleRow({ levels: p.approvalSteps.length }, p));
    if (e.target.closest('#saveRules')) {
      const rules = $$('#rulesEditor [data-row]', root).map(r => ({ labelId: r.querySelector('[name=label]').value || null, priority: r.querySelector('[name=priority]').value || null, levels: Number(r.querySelector('[name=levels]').value) }));
      if (await save(`/api/projects/${id}/approval-rules`, { rules }, 'Đã lưu quy tắc duyệt')) renderProjectSettings(root, id, setCrumbs);
    }
    const labelRow = e.target.closest('[data-label]');
    if (labelRow && (e.target.matches('[data-save-label]') || e.target.matches('[data-del-label]'))) {
      try {
        if (e.target.matches('[data-del-label]')) {
          await api(`/api/labels/${labelRow.dataset.label}`, { method: 'DELETE' }); store.labels = store.labels.filter(l => l.id !== Number(labelRow.dataset.label)); toast('Đã xoá nhãn', 'ok');
        } else {
          const row = await api(`/api/labels/${labelRow.dataset.label}`, { method: 'PUT', body: { name: labelRow.querySelector('[name=name]').value, color: labelRow.querySelector('[name=color]').value } });
          Object.assign(store.labels.find(l => l.id === row.id) || {}, row); toast('Đã lưu nhãn', 'ok');
        }
        renderProjectSettings(root, id, setCrumbs);
      } catch (error) { toast(errorMessage(error), 'err'); }
    }
    if (e.target.closest('#addLabel')) {
      const name = $('#newLabel', root).value.trim(); if (!name) return;
      try { const l = await api(`/api/projects/${id}/labels`, { method: 'POST', body: { name } }); if (!store.labels.some(x => x.id === l.id)) store.labels.push(l); toast('Đã thêm nhãn ' + l.name, 'ok'); renderProjectSettings(root, id, setCrumbs); }
      catch (error) { toast(errorMessage(error), 'err'); }
    }
    if (e.target.closest('#saveMembers')) {
      const members = $$('#membersEditor [data-row]', root).map(r => ({ userId: Number(r.dataset.user), role: r.querySelector('select').value }));
      if (await save(`/api/projects/${id}/members`, { members }, 'Đã lưu thành viên')) renderProjectSettings(root, id, setCrumbs);
    }
  };
  root.onchange = e => {
    if (e.target.name === 'type') e.target.closest('[data-row]').querySelector('[name=user]').classList.toggle('hidden', e.target.value !== 'USER');
  };
  const drawRules = async () => {
    const rules = await api(`/api/projects/${id}/recurring`);
    $('#recurringList', root).innerHTML = rules.length ? `<table class="table"><tbody>${rules.map(r => `<tr data-testid="rule-${esc(r.title)}"><td><b>${esc(r.title)}</b><div class="muted xs">${esc(r.schedule)} · hạn sau ${r.dueOffsetDays} ngày${r.assigneeIds.length ? ' · ' + esc(r.assigneeIds.map(uid => users.find(u => u.id === uid)?.fullName || '#' + uid).join(', ')) : ''}</div></td>
      <td class="muted sm">${r.isActive ? 'Lần tới: ' + fmtDateTime(r.nextRunAt) : 'Đang tạm dừng'}</td>
      <td class="actions"><button class="btn btn-ghost btn-sm" data-editrule="${r.id}">Sửa lịch</button><button class="btn btn-ghost btn-sm" data-run="${r.id}" data-testid="rule-run">Tạo ngay</button><button class="btn btn-ghost btn-sm" data-toggle="${r.id}" data-active="${r.isActive}">${r.isActive ? 'Tạm dừng' : 'Bật lại'}</button><button class="btn btn-ghost btn-sm" data-delrule="${r.id}">Xoá</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="muted sm">Chưa có việc lặp lại.</div>';
  };
  drawRules();
  bindMulti(root); bindSchedule($('#recurringForm', root));
  root.querySelector('#recurringForm').onsubmit = async e => {
    e.preventDefault();
    const f = formData(e.target);
    const body = { title: f.title, ...readSchedule(e.target), assigneeIds: readMulti(e.target, 'recAssignees') };
    try { await api(`/api/projects/${id}/recurring`, { method: 'POST', body }); toast('Đã thêm việc lặp lại', 'ok'); e.target.title.value = ''; drawRules(); }
    catch (error) { toast(errorMessage(error), 'err'); }
  };
  $('#recurringList', root).addEventListener('click', async e => {
    const edit = e.target.closest('[data-editrule]');
    if (edit) { const rules = await api(`/api/projects/${id}/recurring`); return openRepeatDialog({ rule: rules.find(r => r.id === Number(edit.dataset.editrule)), onDone: drawRules }); }
    const run = e.target.closest('[data-run]'), toggle = e.target.closest('[data-toggle]'), del = e.target.closest('[data-delrule]');
    try {
      if (run) { const r = await api(`/api/recurring/${run.dataset.run}/run`, { method: 'POST' }); toast(`Đã tạo ${p.key}-${r.number}`, 'ok'); }
      if (toggle) await api(`/api/recurring/${toggle.dataset.toggle}`, { method: 'PATCH', body: { isActive: toggle.dataset.active !== 'true' } });
      if (del) await api(`/api/recurring/${del.dataset.delrule}`, { method: 'DELETE' });
    } catch (error) { toast(errorMessage(error), 'err'); }
    if (run || toggle || del) drawRules();
  });
}
async function save(path, body, ok) {
  try { await api(path, { method: 'PUT', body }); toast(ok, 'ok'); return true; } catch (error) { toast(errorMessage(error), 'err'); return false; }
}
function stateRow(s) {
  return `<div class="state-edit" data-row ${s.id ? `data-id="${s.id}"` : ''}><button type="button" class="icon-btn" data-up title="Lên trên" aria-label="Lên trên"><svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m18 15-6-6-6 6"/></svg></button>
    <input name="name" value="${esc(s.name)}" placeholder="Tên cột" maxlength="40" aria-label="Tên cột">
    <select name="category" aria-label="Nhóm trạng thái">${Object.entries(CATEGORY).map(([k, v]) => `<option value="${k}"${s.category === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <input type="color" name="color" value="${esc(s.color)}" aria-label="Màu"><input name="wip" type="number" min="1" placeholder="WIP" value="${s.wipLimit ?? ''}" aria-label="Giới hạn WIP" data-testid="wip-${esc(s.name)}">
    <button type="button" class="btn btn-ghost btn-sm" data-remove>Xoá</button></div>`;
}
function ruleRow(r, p) {
  const n = p.approvalSteps.length;
  return `<div class="row rule-row" data-row style="margin-bottom:6px"><span class="muted sm">Nếu nhãn</span>
    <select name="label" style="width:auto" aria-label="Nhãn"><option value="">— bất kỳ —</option>${labelsFor(p.id).map(l => `<option value="${l.id}"${r.labelId === l.id ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
    <span class="muted sm">và ưu tiên</span><select name="priority" style="width:auto" aria-label="Ưu tiên"><option value="">— bất kỳ —</option>${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}"${r.priority === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select>
    <span class="muted sm">→ cần</span><select name="levels" style="width:auto" aria-label="Số cấp duyệt" data-testid="rule-levels">${Array.from({ length: n + 1 }, (_, k) => `<option value="${k}"${r.levels === k ? ' selected' : ''}>${k === 0 ? 'không cần duyệt' : k === n ? `đủ ${n} cấp` : `${k} cấp`}</option>`).join('')}</select>
    <button type="button" class="btn btn-ghost btn-sm" data-remove>Xoá</button></div>`;
}
function stepRow(s, users) {
  return `<div class="row" data-row style="margin-bottom:6px"><span class="pill">Cấp</span>
    <select name="type" style="width:auto" data-testid="step-type">${Object.entries(APPROVER).map(([k, v]) => `<option value="${k}"${s.approverType === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <select name="user" style="width:auto" class="${s.approverType === 'USER' ? '' : 'hidden'}"><option value="">— Chọn người —</option>${users.filter(u => u.role !== 'admin').map(u => `<option value="${u.id}"${s.approverUserId === u.id ? ' selected' : ''}>${esc(u.fullName)}</option>`).join('')}</select>
    <input name="name" value="${esc(s.name)}" placeholder="Tên bước (tuỳ chọn)" class="grow" style="width:auto" maxlength="60" data-testid="step-name">
    ${s.approvers ? `<span class="muted xs" title="Người sẽ duyệt ở cấp này">${s.approvers.length ? 'Người duyệt: ' + esc(s.approvers.map(a => a.fullName).join(', ')) : '<span class="due overdue">Chưa có người duyệt</span>'}</span>` : ''}
    <button type="button" class="btn btn-ghost btn-sm" data-remove>Xoá</button></div>`;
}
function memberRow(userId, role, users) {
  const u = users.find(x => x.id === userId);
  return `<div class="row" data-row data-user="${userId}" style="margin-bottom:6px"><span class="grow">${esc(u?.fullName || '#' + userId)} <span class="muted xs">${esc(u?.username || '')}</span></span>
    <select style="width:auto" aria-label="Vai trò">${[['OWNER', 'Chủ dự án'], ['MEMBER', 'Thành viên'], ['VIEWER', 'Người xem']].map(([k, v]) => `<option value="${k}"${role === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <button type="button" class="btn btn-ghost btn-sm" data-remove>Bỏ</button></div>`;
}
