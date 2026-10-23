// Playground HRM — của tôi (hồ sơ, phép, chấm công, đơn nghỉ), chờ duyệt, nhân sự, bảng công, thiết lập.
// Quyền do máy chủ quyết (lib/policy.js hrm.*). Số CCCD chỉ hiện khi bấm "Hiện" (mỗi lượt ghi nhật ký); lương chỉ chính người đó, HR, Ban GĐ thấy.
import { api } from '../api.js';
import { store, deptName } from '../store.js';
import { $, esc, fmtDate, toast, openModal, closeModal, confirmDialog, errorMessage, dateInput, fromDateInput } from '../util.js';

let meta = null;
const getMeta = async () => (meta ||= await api('/api/hrm/meta'));
const opts = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
const formObj = form => Object.fromEntries(new FormData(form).entries());
const hhmm = t => (t ? new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : '—');
const num = v => (v == null ? '' : Number(v).toLocaleString('vi-VN'));
const vnd = v => (v == null ? '—' : Number(v).toLocaleString('vi-VN') + ' đ');
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthOf = params => { const m = params.get('month'); return m && MONTH_RE.test(m) ? m : new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7); };
const ST = { HALF_LEAVE: ['Nghỉ nửa ngày', 'info'], NOT_EMPLOYED: ['Chưa vào làm', ''], OK: ['Đủ công', 'ok'], LATE_EARLY: ['Muộn / sớm', 'warn'], MISSING: ['Thiếu công', 'danger'], NO_OUT: ['Thiếu giờ ra', 'danger'], LEAVE: ['Nghỉ phép', 'info'],
  ADJUSTED: ['Đã giải trình', 'ok'], HOLIDAY: ['Nghỉ lễ', ''], OFF: ['Nghỉ', ''], WEEKEND_WORK: ['Làm ngày nghỉ', 'info'], TODAY: ['Hôm nay', 'info'], FUTURE: ['', ''] };
const leavePill = s => `<span class="pill ${s.code === 'APPROVED' ? 'ok' : s.code === 'PENDING' ? 'warn' : s.code === 'REJECTED' ? 'danger' : ''}">${esc(s.label)}</span>`;

export async function renderHrm(root, parts, params, setCrumbs) {
  meta = null;
  const m = await getMeta();
  const tab = parts[1] || 'me';
  const tabs = [['me', 'Của tôi', true], ['approve', 'Chờ duyệt', m.me.leader || m.me.director || m.me.hr], ['people', 'Nhân sự', m.me.leader || m.me.director || m.me.hr],
    ['team', 'Bảng công', m.me.leader || m.me.director || m.me.hr], ['settings', 'Thiết lập', m.me.canConfig]].filter(t => t[2]);
  setCrumbs('Nhân sự');
  root.innerHTML = `<div class="page-head"><h1>Nhân sự</h1><nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<a href="#/hrm/${k === 'me' ? '' : k}" class="${k === tab ? 'active' : ''}" data-testid="hrm-tab-${k}">${l}</a>`).join('')}</nav></div><div id="hrmBody"></div>`;
  const body = $('#hrmBody', root);
  root.onclick = null;
  if (tab === 'approve') return renderApprove(body, m);
  if (tab === 'people' && parts[2]) return renderPerson(body, Number(parts[2]), m, setCrumbs);
  if (tab === 'people') return renderPeople(body, m);
  if (tab === 'team') return renderTeam(body, m, params);
  if (tab === 'settings') return renderSettings(body, m);
  return renderMe(body, m, params);
}

// ---------- Của tôi ----------
async function renderMe(root, m, params) {
  const month = monthOf(params);
  const [me, leaves, sheet] = await Promise.all([api('/api/hrm/me'), api('/api/hrm/leaves?scope=mine'), api('/api/hrm/attendance?month=' + month)]);
  const p = me.profile, t = me.today;
  root.innerHTML = `<div class="kpis">
      <div class="kpi"><div class="v" data-testid="hrm-leave-remaining">${num(me.leave.remaining)}</div><div class="l">Ngày phép năm còn lại / ${num(me.leave.quota)}</div></div>
      <div class="kpi"><div class="v">${num(me.leave.used)}</div><div class="l">Đã nghỉ phép năm ${me.leave.year}</div></div>
      <div class="kpi ${me.leave.pending ? 'warn' : ''}"><div class="v">${num(me.leave.pending)}</div><div class="l">Ngày đang chờ duyệt</div></div>
      <div class="kpi"><div class="l">Hôm nay${me.workday ? '' : ' (ngày nghỉ)'} · giờ làm ${esc(m.config.workStart)}–${esc(m.config.workEnd)}</div>
        <div class="row" style="margin-top:8px"><span>Vào <b data-testid="hrm-in">${hhmm(t?.checkIn)}</b></span><span>Ra <b data-testid="hrm-out">${hhmm(t?.checkOut)}</b></span></div>
        <div class="row" style="margin-top:8px">${!t?.checkIn ? '<button class="btn btn-primary btn-sm" data-check="in" data-testid="hrm-check-in">Chấm vào</button>' : ''}<button class="btn btn-sm" data-check="out" data-testid="hrm-check-out">Chấm ra</button></div></div></div>
    <div class="pg-cols">
      <section class="card pg-section"><div class="row"><h3 class="grow">Hồ sơ của tôi</h3>${p.can.editContact ? '<button class="btn btn-sm" id="editContact">Sửa liên hệ</button>' : ''}</div>${profileDl(p, m)}</section>
      <section class="card pg-section"><h3>Hợp đồng lao động</h3>${contractsTable(me.contracts)}</section>
    </div>
    <section class="card pg-section" data-testid="hrm-my-leaves"><div class="row"><h3 class="grow">Đơn nghỉ của tôi</h3><button class="btn btn-primary btn-sm" id="newLeave" data-testid="hrm-leave-new">Xin nghỉ</button></div>
      ${leaves.length ? `<table class="table"><thead><tr><th>Loại</th><th>Ngày</th><th class="num">Số ngày</th><th>Lý do</th><th>Trạng thái</th><th></th></tr></thead><tbody>
        ${leaves.map(l => `<tr><td>${esc(l.type.label)}</td><td>${fmtDate(l.fromDate)}${l.toDate !== l.fromDate ? ' – ' + fmtDate(l.toDate) : ''}${l.halfDay !== 'NONE' ? ` (${l.halfDay === 'AM' ? 'sáng' : 'chiều'})` : ''}</td>
          <td class="num">${num(l.days)}</td><td>${esc(l.reason)}</td><td>${leavePill(l.status)}${l.decisionNote ? `<div class="muted xs">${esc(l.decisionNote)}</div>` : ''}</td>
          <td class="actions">${l.can?.cancel ? `<button class="btn btn-ghost btn-sm" data-cancel="${l.id}">Huỷ</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Chưa có đơn nghỉ.</div>'}
    </section>
    <section class="card pg-section"><div class="row"><h3 class="grow">Bảng công tháng</h3><input type="month" id="mPick" value="${esc(month)}"></div>${sheetHtml(sheet, true)}</section>`;
  $('#mPick', root).onchange = e => { if (MONTH_RE.test(e.target.value)) location.hash = '#/hrm?month=' + encodeURIComponent(e.target.value); };
  root.onclick = async e => {
    const t2 = e.target;
    try {
      const ck = t2.closest('[data-check]');
      if (ck) { await api('/api/hrm/attendance/check', { method: 'POST', body: { kind: ck.dataset.check } }); toast(ck.dataset.check === 'in' ? 'Đã chấm vào' : 'Đã chấm ra', 'ok'); return renderMe(root, m, params); }
      if (t2.id === 'newLeave') return leaveForm(m, me.leave, () => renderMe(root, m, params));
      if (t2.id === 'editContact') return profileForm(p, m, false, () => renderMe(root, m, params));
      const c = t2.closest('[data-cancel]');
      if (c && await confirmDialog('Huỷ đơn nghỉ này?', { okText: 'Huỷ đơn', danger: true })) { await api(`/api/hrm/leaves/${c.dataset.cancel}/cancel`, { method: 'POST' }); return renderMe(root, m, params); }
      const ex = t2.closest('[data-explain]');
      if (ex) return explainForm(ex.dataset.explain, () => renderMe(root, m, params));
      if (t2.closest('[data-reveal]')) return await reveal(t2.closest('[data-reveal]'));
      if (t2.closest('[data-salary]')) return await revealSalary(t2.closest('[data-salary]'));
    } catch (error) { toast(errorMessage(error), 'err'); }
  };
}

function profileDl(p, m) {
  const row = (l, v) => `<dt>${l}</dt><dd>${v}</dd>`;
  return `<dl class="pg-dl">${row('Mã nhân viên', esc(p.employeeCode || '—'))}${row('Bộ phận', esc(p.department?.name || '—'))}${row('Chức danh', esc(p.displayTitle || '—'))}
    ${row('Ngày vào làm', p.startDate ? fmtDate(p.startDate) : '—')}${row('Trạng thái', esc(m.profileStatus[p.status] || '—'))}
    ${'birthDate' in p ? row('Ngày sinh', p.birthDate ? fmtDate(p.birthDate) : '—') + row('Giới tính', esc(m.genders[p.gender] || '—')) + row('Điện thoại', esc(p.phone || '—'))
      + row('Email cá nhân', esc(p.personalEmail || '—')) + row('Địa chỉ', esc(p.address || '—')) + row('Liên hệ khẩn cấp', esc([p.emergencyName, p.emergencyPhone].filter(Boolean).join(' · ') || '—'))
      + row('Học vấn', esc(p.education || '—')) : ''}
    ${p.identity ? row('Số CCCD', `<span data-id-for="${p.userId}">${p.identity.last4 ? '•••••••• ' + esc(p.identity.last4) : '—'}</span>${p.identity.last4 && p.identity.canReveal ? ` <button class="btn btn-ghost btn-sm" data-reveal="${p.userId}" data-testid="hrm-reveal">Hiện</button>` : ''}`)
      + row('Ngày / nơi cấp', esc([p.identity.issuedOn ? fmtDate(p.identity.issuedOn) : '', p.identity.issuedPlace || ''].filter(Boolean).join(' · ') || '—')) : ''}</dl>`;
}
// Hiện CCCD / lương: nhập lại mật khẩu (Claude / trình duyệt do AI điều khiển không được nhập mật khẩu); mỗi lượt ghi nhật ký.
function askPassword(title) {
  return new Promise(resolve => {
    const modal = openModal(`<h2>${esc(title)}</h2><p class="muted sm">Nhập lại mật khẩu Kepper để xem. Lượt xem được ghi nhật ký.</p><form>
      <label class="field">Mật khẩu<input type="password" name="pw" autocomplete="current-password" required data-testid="hrm-pw"></label><p class="error" id="pwErr"></p>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="hrm-pw-ok">Xem</button></div></form>`);
    modal.querySelector('[data-close]').onclick = () => { closeModal(); resolve(null); };
    modal.querySelector('form').onsubmit = e => { e.preventDefault(); const v = e.target.pw.value; closeModal(); resolve(v); };
  });
}
async function reveal(btn) {
  const pw = await askPassword('Hiện số CCCD');
  if (pw == null) return;
  const r = await api(`/api/hrm/people/${btn.dataset.reveal}/identity/reveal`, { method: 'POST', body: { password: pw } });
  const span = document.querySelector(`[data-id-for="${btn.dataset.reveal}"]`);
  if (span) span.textContent = r.idNumber || '—';
  btn.remove();
  toast('Lượt xem số định danh đã được ghi nhật ký', '');
}
async function revealSalary(btn) {
  const pw = await askPassword('Hiện mức lương');
  if (pw == null) return;
  const r = await api(`/api/hrm/contracts/${btn.dataset.salary}/salary/reveal`, { method: 'POST', body: { password: pw } });
  btn.outerHTML = `<span data-testid="hrm-salary">${vnd(r.salary)}</span>`;
}
function contractsTable(list) {
  if (!list?.length) return '<div class="empty">Chưa có hợp đồng.</div>';
  return `<div class="pg-scroll"><table class="table"><tbody>${list.map(k => `<tr><td><b>${esc(k.type.label)}</b><div class="muted xs code">${esc(k.number)}</div></td><td class="sm">${fmtDate(k.startDate)}${k.endDate ? ' – ' + fmtDate(k.endDate) : ' – không thời hạn'}</td>
    <td>${esc(k.position || '')}</td>${k.hasSalary !== undefined ? `<td class="num">${k.hasSalary ? `<button class="btn btn-ghost btn-sm" data-salary="${k.id}" data-testid="hrm-salary-reveal">Lương: hiện</button>` : '<span class="muted">—</span>'}</td>` : ''}<td>${k.status === 'ACTIVE' ? '<span class="pill ok">Hiệu lực</span>' : '<span class="pill">Đã kết thúc</span>'}</td>
    ${k.editable ? `<td class="actions"><button class="btn btn-ghost btn-sm" data-kedit="${k.id}">Sửa</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
function sheetHtml(s, self) {
  return `<div class="row sm" style="margin-bottom:8px">${Object.entries({ 'Ngày làm việc': s.totals.workdays, 'Đủ công': s.totals.ok, 'Muộn / sớm': s.totals.lateEarly, 'Thiếu': s.totals.missing, 'Nghỉ có lương': s.totals.leavePaid, 'Nghỉ không lương': s.totals.leaveUnpaid, 'Phút muộn': s.totals.minutesLate })
    .map(([k, v]) => `<span class="pill">${k}: <b>${v}</b></span>`).join('')}</div>
    <div class="pg-cal" data-testid="hrm-sheet">${s.sheet.map(d => {
      const [label, cls] = ST[d.status] || ['', ''];
      const r = d.record, canExplain = self && ['MISSING', 'NO_OUT', 'LATE_EARLY'].includes(d.status) && r?.adjust?.status !== 'PENDING';
      return `<div class="pg-day ${cls}${['OFF', 'HOLIDAY', 'NOT_EMPLOYED'].includes(d.status) ? ' off' : ''}"><div class="row"><b>${d.day.slice(8)}</b><span class="muted xs">${WD[d.weekday]}</span></div>
        ${r?.checkIn || r?.checkOut ? `<div class="xs">${hhmm(r.checkIn)}–${hhmm(r.checkOut)}</div>` : ''}<div class="xs">${label}${d.minutesLate ? ` · muộn ${d.minutesLate}′` : ''}${d.minutesEarly ? ` · sớm ${d.minutesEarly}′` : ''}</div>
        ${r?.adjust?.status === 'PENDING' ? '<div class="xs muted">Giải trình chờ duyệt</div>' : ''}${r?.adjust?.status === 'REJECTED' ? `<div class="xs">Giải trình bị từ chối${r.adjust.note ? ': ' + esc(r.adjust.note) : ''}</div>` : ''}
        ${canExplain ? `<button class="btn btn-ghost btn-sm" data-explain="${d.day}">Giải trình</button>` : ''}</div>`;
    }).join('')}</div>`;
}
function leaveForm(m, bal, done) {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const modal = openModal(`<h2>Xin nghỉ</h2><p class="muted sm">Phép năm còn <b>${num(bal.remaining)}</b> ngày (tham khảo). Đơn gửi lãnh đạo bộ phận duyệt; đơn của lãnh đạo bộ phận do Ban giám đốc duyệt.</p><form class="pg-grid">
    <label class="field">Loại nghỉ<select name="type" data-testid="hrm-l-type">${opts(m.leaveTypes, 'ANNUAL')}</select></label>
    <label class="field">Nửa ngày<select name="halfDay"><option value="NONE">Cả ngày</option><option value="AM">Buổi sáng</option><option value="PM">Buổi chiều</option></select></label>
    <label class="field">Từ ngày<input type="date" name="fromDate" required value="${today}" data-testid="hrm-l-from"></label>
    <label class="field">Đến ngày<input type="date" name="toDate" required value="${today}" data-testid="hrm-l-to"></label>
    <label class="field span2">Lý do <span class="muted xs">(ngắn gọn — KHÔNG ghi tên bệnh / chẩn đoán)</span><input name="reason" maxlength="200" data-testid="hrm-l-reason"></label>
    <p class="error span2" id="lfErr"></p><div class="modal-actions span2"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="hrm-l-save">Gửi đơn</button></div></form>`);
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    try { const r = await api('/api/hrm/leaves', { method: 'POST', body: formObj(e.target) }); closeModal(); toast(`Đã gửi đơn ${num(r.days)} ngày${r.warning ? '. ' + r.warning : ''}`, r.warning ? '' : 'ok'); done(); }
    catch (error) { modal.querySelector('#lfErr').textContent = errorMessage(error); }
  };
}
function explainForm(day, done) {
  const modal = openModal(`<h2>Giải trình chấm công ${esc(day.split('-').reverse().join('/'))}</h2><form class="pg-grid">
    <label class="field">Giờ vào thực tế<input type="time" name="in"></label><label class="field">Giờ ra thực tế<input type="time" name="out"></label>
    <label class="field span2">Lý do<input name="reason" required maxlength="300" placeholder="Quên chấm công / đi công tác / làm việc với cơ quan…" data-testid="hrm-x-reason"></label>
    <p class="error span2" id="xfErr"></p><div class="modal-actions span2"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="hrm-x-save">Gửi giải trình</button></div></form>`);
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/hrm/attendance/explain', { method: 'POST', body: { day, ...formObj(e.target) } }); closeModal(); toast('Đã gửi giải trình', 'ok'); done(); }
    catch (error) { modal.querySelector('#xfErr').textContent = errorMessage(error); }
  };
}
function profileForm(p, m, full, done) {
  const f = (name, label, type = 'text', max = 120) => `<label class="field">${label}<input name="${name}" type="${type}" maxlength="${max}" value="${type === 'date' ? dateInput(p[name]) : esc(p[name] || '')}"></label>`;
  const modal = openModal(`<h2>${full ? 'Hồ sơ nhân sự' : 'Sửa thông tin liên hệ'} — ${esc(p.fullName)}</h2><form class="pg-grid">
    ${full ? f('employeeCode', 'Mã nhân viên', 'text', 20) + f('startDate', 'Ngày vào làm', 'date') + `<label class="field">Trạng thái<select name="status">${opts(m.profileStatus, p.status || 'OFFICIAL')}</select></label>`
      + f('birthDate', 'Ngày sinh', 'date') + `<label class="field">Giới tính<select name="gender"><option value="">—</option>${opts(m.genders, p.gender)}</select></label>` : ''}
    ${f('phone', 'Điện thoại', 'text', 30)}${f('personalEmail', 'Email cá nhân', 'email')}<label class="field span2">Địa chỉ<input name="address" maxlength="300" value="${esc(p.address || '')}"></label>
    ${f('emergencyName', 'Người liên hệ khẩn cấp')}${f('emergencyPhone', 'Điện thoại khẩn cấp', 'text', 30)}${full ? `<label class="field span2">Học vấn<input name="education" maxlength="300" value="${esc(p.education || '')}"></label>` : ''}
    <p class="error span2" id="pfErr"></p><div class="modal-actions span2"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary">Lưu</button></div></form>`, { wide: true });
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const b = formObj(e.target);
    for (const k of ['startDate', 'birthDate']) if (k in b) b[k] = b[k] ? fromDateInput(b[k]) : null;
    try { await api(`/api/hrm/people/${p.userId}/profile`, { method: 'PUT', body: b }); closeModal(); toast('Đã lưu', 'ok'); done(); }
    catch (error) { modal.querySelector('#pfErr').textContent = errorMessage(error); }
  };
}

// ---------- Chờ duyệt ----------
async function renderApprove(root, m) {
  const [leaves, atts] = await Promise.all([api('/api/hrm/leaves?scope=approve'), api('/api/hrm/attendance/pending')]);
  root.innerHTML = `<section class="card pg-section" data-testid="hrm-approve-leaves"><h3>Đơn nghỉ chờ duyệt</h3>
      ${leaves.length ? `<table class="table"><thead><tr><th>Người nghỉ</th><th>Loại</th><th>Ngày</th><th class="num">Số ngày</th><th>Lý do</th><th></th></tr></thead><tbody>
        ${leaves.map(l => `<tr><td><b>${esc(l.user.fullName)}</b><div class="muted xs">${esc(l.user.department?.name || '')}</div></td><td>${esc(l.type.label)}</td>
          <td>${fmtDate(l.fromDate)}${l.toDate !== l.fromDate ? ' – ' + fmtDate(l.toDate) : ''}${l.halfDay !== 'NONE' ? ` (${l.halfDay === 'AM' ? 'sáng' : 'chiều'})` : ''}</td><td class="num">${num(l.days)}${l.balance ? `<div class="muted xs">phép còn ${num(l.balance.remaining)}/${num(l.balance.quota)}</div>` : ''}</td><td>${esc(l.reason || '')}</td>
          <td class="actions"><button class="btn btn-primary btn-sm" data-ldec="${l.id}" data-d="APPROVE" data-testid="hrm-approve">Duyệt</button><button class="btn btn-ghost btn-sm" data-ldec="${l.id}" data-d="REJECT">Từ chối</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Không có đơn chờ duyệt.</div>'}</section>
    <section class="card pg-section"><h3>Giải trình chấm công chờ duyệt</h3>
      ${atts.length ? `<table class="table"><thead><tr><th>Người</th><th>Ngày</th><th>Giờ chấm</th><th>Giờ giải trình</th><th>Lý do</th><th></th></tr></thead><tbody>
        ${atts.map(a => `<tr><td><b>${esc(a.user.fullName)}</b></td><td>${esc(a.day.split('-').reverse().join('/'))}</td><td>${hhmm(a.checkIn)}–${hhmm(a.checkOut)}</td>
          <td>${hhmm(a.adjust.in)}–${hhmm(a.adjust.out)}</td><td>${esc(a.adjust.reason)}</td>
          <td class="actions"><button class="btn btn-primary btn-sm" data-adec="${a.id}" data-d="APPROVE">Duyệt</button><button class="btn btn-ghost btn-sm" data-adec="${a.id}" data-d="REJECT">Từ chối</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Không có giải trình chờ duyệt.</div>'}</section>`;
  root.onclick = async e => {
    const l = e.target.closest('[data-ldec]'), a = e.target.closest('[data-adec]');
    if (!l && !a) return;
    const d = (l || a).dataset.d;
    let note = null;
    if (d === 'REJECT') { note = await confirmDialog(l ? 'Từ chối đơn nghỉ?' : 'Từ chối giải trình?', { okText: 'Từ chối', danger: true, input: 'Ý kiến (bắt buộc)' }); if (note === null) return; }
    try {
      await api(l ? `/api/hrm/leaves/${l.dataset.ldec}/decide` : `/api/hrm/attendance/${a.dataset.adec}/decide`, { method: 'POST', body: { decision: d, note } });
      toast(d === 'APPROVE' ? 'Đã duyệt' : 'Đã từ chối', 'ok'); renderApprove(root, m);
    } catch (error) { toast(errorMessage(error), 'err'); }
  };
}

// ---------- Nhân sự ----------
async function renderPeople(root, m) {
  const rows = await api('/api/hrm/people');
  root.innerHTML = `<div class="card" style="padding:0"><table class="table" data-testid="hrm-people"><thead><tr><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Chức danh</th><th>Ngày vào</th><th>Trạng thái</th>${rows.some(r => r.contract !== undefined) ? '<th>Hợp đồng</th>' : ''}</tr></thead><tbody>
    ${rows.map(p => `<tr><td class="code">${esc(p.employeeCode || '')}</td><td><a href="#/hrm/people/${p.userId}"><b>${esc(p.fullName)}</b></a></td><td>${esc(p.department?.name || '')}</td><td>${esc(p.displayTitle || '')}</td>
      <td>${p.startDate ? fmtDate(p.startDate) : ''}</td><td>${esc(m.profileStatus[p.status] || '—')}</td>
      ${p.contract !== undefined ? `<td>${p.contract ? `${esc(p.contract.type.label)}${p.contract.endDate ? ` · đến ${fmtDate(p.contract.endDate)}` : ''}${p.contract.expiringSoon ? ' <span class="pill warn">Sắp hết hạn</span>' : ''}` : '<span class="pill danger">Chưa có</span>'}</td>` : ''}</tr>`).join('')
      || '<tr><td colspan="7" class="empty">Không có nhân sự.</td></tr>'}</tbody></table></div>`;
}
async function renderPerson(root, userId, m, setCrumbs) {
  const p = await api(`/api/hrm/people/${userId}`);
  setCrumbs(`<a href="#/hrm/people">Nhân sự</a> / ${esc(p.fullName)}`);
  for (const k of p.contracts || []) k.editable = p.can.editContracts;
  root.innerHTML = `<div class="pg-cols">
      <section class="card pg-section"><div class="row"><h3 class="grow">${esc(p.fullName)}</h3>${p.can.edit ? '<button class="btn btn-sm" id="pEdit" data-testid="hrm-p-edit">Sửa hồ sơ</button>' : ''}${p.can.identity ? '<button class="btn btn-sm" id="idEdit">Số CCCD</button>' : ''}</div>${profileDl(p, m)}
        ${p.leave ? `<p class="sm">Phép năm ${p.leave.year}: còn <b>${num(p.leave.remaining)}</b> / ${num(p.leave.quota)} (đã dùng ${num(p.leave.used)}, chờ duyệt ${num(p.leave.pending)})</p>` : ''}
        <a class="btn btn-ghost btn-sm" href="#/hrm/team?userId=${p.userId}">Bảng công</a></section>
      ${p.can.contracts ? `<section class="card pg-section"><div class="row"><h3 class="grow">Hợp đồng lao động</h3>${p.can.editContracts ? '<button class="btn btn-sm" id="kNew" data-testid="hrm-k-new">Thêm</button>' : ''}</div>${contractsTable(p.contracts)}</section>` : ''}
    </div>`;
  root.onclick = async e => {
    const t = e.target, redraw = () => renderPerson(root, userId, m, setCrumbs);
    try {
      if (t.id === 'pEdit') return profileForm(p, m, true, redraw);
      if (t.id === 'idEdit') return identityForm(p, redraw);
      if (t.id === 'kNew' || t.closest('[data-kedit]')) return contractForm(p, m, (p.contracts || []).find(k => k.id === Number(t.closest('[data-kedit]')?.dataset.kedit)) || null, redraw);
      if (t.closest('[data-reveal]')) return await reveal(t.closest('[data-reveal]'));
      if (t.closest('[data-salary]')) return await revealSalary(t.closest('[data-salary]'));
    } catch (error) { toast(errorMessage(error), 'err'); }
  };
}
function identityForm(p, done) {
  const modal = openModal(`<h2>Số CCCD — ${esc(p.fullName)}</h2><p class="muted sm">Lưu mã hoá; chỉ chính người đó và người phụ trách nhân sự xem; Claude chỉ thấy 4 số cuối.</p><form class="pg-grid">
    <label class="field span2">Số CCCD (12 số; để trống = giữ nguyên)<input name="idNumber" inputmode="numeric" maxlength="12" autocomplete="off"></label>
    <label class="field">Ngày cấp<input type="date" name="issuedOn" value="${dateInput(p.identity?.issuedOn)}"></label><label class="field">Nơi cấp<input name="issuedPlace" maxlength="200" value="${esc(p.identity?.issuedPlace || '')}"></label>
    <p class="error span2" id="ifErr"></p><div class="modal-actions span2"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary">Lưu</button></div></form>`);
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const b = formObj(e.target);
    if (!b.idNumber) delete b.idNumber;
    b.issuedOn = b.issuedOn ? fromDateInput(b.issuedOn) : null;
    try { await api(`/api/hrm/people/${p.userId}/identity`, { method: 'PUT', body: b }); closeModal(); toast('Đã lưu', 'ok'); done(); }
    catch (error) { modal.querySelector('#ifErr').textContent = errorMessage(error); }
  };
}
function contractForm(p, m, k, done) {
  const modal = openModal(`<h2>${k ? 'Sửa' : 'Thêm'} hợp đồng — ${esc(p.fullName)}</h2><form class="pg-grid">
    <label class="field">Số hợp đồng<input name="number" required maxlength="60" value="${esc(k?.number || '')}"></label>
    <label class="field">Loại<select name="type">${opts(m.contractTypes, k?.type.code || 'FIXED')}</select></label>
    <label class="field">Bắt đầu<input type="date" name="startDate" required value="${dateInput(k?.startDate)}"></label>
    <label class="field">Kết thúc<input type="date" name="endDate" value="${dateInput(k?.endDate)}"></label>
    <label class="field">Chức danh<input name="position" maxlength="120" value="${esc(k?.position || p.displayTitle || '')}"></label>
    <label class="field">Lương (đồng / tháng)<input name="salary" type="number" min="0" step="1" placeholder="${k?.hasSalary ? 'để trống = giữ nguyên' : ''}" autocomplete="off"></label>
    <label class="field">Ngày ký<input type="date" name="signedAt" value="${dateInput(k?.signedAt)}"></label>
    <label class="field">Trạng thái<select name="status"><option value="ACTIVE"${k?.status !== 'ENDED' ? ' selected' : ''}>Hiệu lực</option><option value="ENDED"${k?.status === 'ENDED' ? ' selected' : ''}>Đã kết thúc</option></select></label>
    <p class="error span2" id="kfErr"></p><div class="modal-actions span2"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary">Lưu</button></div></form>`, { wide: true });
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const b = formObj(e.target);
    for (const x of ['startDate', 'endDate', 'signedAt']) b[x] = b[x] ? fromDateInput(b[x]) : null;
    if (b.salary === '') delete b.salary; else b.salary = Number(b.salary); // để trống: giữ nguyên lương đã lưu
    try { await api(k ? `/api/hrm/contracts/${k.id}` : `/api/hrm/people/${p.userId}/contracts`, { method: k ? 'PATCH' : 'POST', body: b }); closeModal(); toast('Đã lưu', 'ok'); done(); }
    catch (error) { modal.querySelector('#kfErr').textContent = errorMessage(error); }
  };
}

// ---------- Bảng công ----------
async function renderTeam(root, m, params) {
  const month = monthOf(params);
  const userId = /^\d+$/.test(params.get('userId') || '') ? params.get('userId') : null;
  if (userId) {
    const s = await api(`/api/hrm/attendance?userId=${Number(userId)}&month=${month}`);
    root.innerHTML = `<section class="card pg-section"><div class="row"><h3 class="grow">Bảng công — ${esc(s.user.fullName)}</h3><input type="month" id="mPick" value="${esc(month)}"><a class="btn btn-ghost btn-sm" href="#/hrm/team?month=${encodeURIComponent(month)}">Về tổng hợp</a></div>${sheetHtml(s, false)}</section>`;
  } else {
    const d = await api(`/api/hrm/attendance/team?month=${month}`);
    root.innerHTML = `<div class="row" style="margin-bottom:12px"><input type="month" id="mPick" value="${esc(month)}">${m.me.canImport ? '<button class="btn" id="imp" data-testid="hrm-import">Nhập từ máy chấm công (CSV)</button>' : ''}</div>
      <div class="card pg-scroll" style="padding:0"><table class="table" data-testid="hrm-team"><thead><tr><th>Họ tên</th><th>Bộ phận</th><th class="num">Ngày làm việc</th><th class="num">Đủ công</th><th class="num">Muộn / sớm</th><th class="num">Thiếu</th><th class="num">Nghỉ có lương</th><th class="num">Nghỉ không lương</th><th class="num">Đã giải trình</th><th class="num">Phút muộn</th></tr></thead><tbody>
      ${d.rows.map(r => `<tr${r.user.isActive ? '' : ' class="muted"'}><td><a href="#/hrm/team?userId=${r.user.id}&month=${encodeURIComponent(month)}">${esc(r.user.fullName)}</a>${r.user.isActive ? '' : ' <span class="xs">(đã nghỉ)</span>'}</td><td>${esc(r.user.department?.name || '')}</td>
        ${['workdays', 'ok', 'lateEarly', 'missing', 'leavePaid', 'leaveUnpaid', 'adjusted', 'minutesLate'].map(k => `<td class="num">${r.totals[k] || ''}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="10" class="empty">Không có dữ liệu.</td></tr>'}</tbody></table></div>`;
  }
  $('#mPick', root).onchange = e => { if (!MONTH_RE.test(e.target.value)) return; const p = new URLSearchParams(params); p.set('month', e.target.value); location.hash = '#/hrm/team?' + p; };
  const imp = $('#imp', root);
  if (imp) imp.onclick = () => importForm(() => renderTeam(root, m, params));
}
function importForm(done) {
  const modal = openModal(`<h2>Nhập dữ liệu máy chấm công</h2><p class="muted sm">Tệp CSV xuất từ máy chấm công. Mỗi dòng: <code>mã NV, ngày, giờ vào, giờ ra</code>, hoặc mỗi lần chấm một dòng <code>mã NV, ngày, giờ</code> (giờ vào = lần sớm nhất, giờ ra = lần muộn nhất). Ngày dạng 2026-09-05 hoặc 5/9/2026; giờ 8:05 hoặc 08:05:12. Không nhập dữ liệu vân tay / khuôn mặt — chỉ giờ.</p>
    <form><label class="field">Tệp CSV<input type="file" name="f" accept=".csv,text/csv" required></label><p class="error" id="imErr"></p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary">Nhập</button></div></form>`);
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const file = e.target.f.files[0];
    if (!file || file.size > 2e6) { modal.querySelector('#imErr').textContent = 'Chọn tệp CSV dưới 2 MB'; return; }
    // Bỏ BOM, dòng tiêu đề (không có chữ số ở cột ngày) và dòng trống; dòng 3 cột = một lần chấm.
    const lines = (await file.text()).replace(/^\uFEFF/, '').split(/\r?\n/);
    const rows = [];
    lines.forEach((l, i) => {
      const c = l.split(/[,;\t]/).map(x => x.trim().replace(/^"|"$/g, ''));
      if (!l.trim() || c.length < 3 || !/\d/.test(c[1] || '')) return;
      rows.push(c.length === 3 ? { line: i + 1, employeeCode: c[0], day: c[1], time: c[2] } : { line: i + 1, employeeCode: c[0], day: c[1], in: c[2] || null, out: c[3] || null });
    });
    if (!rows.length) { modal.querySelector('#imErr').textContent = 'Không đọc được dòng nào (cần ít nhất: mã NV, ngày, giờ)'; return; }
    try {
      const r = await api('/api/hrm/attendance/import', { method: 'POST', body: { rows } });
      closeModal(); toast(`Đã cập nhật ${r.saved} ngày công${r.skipped ? `; bỏ qua ${r.skipped} dòng: ${r.errors.slice(0, 3).join('; ')}` : ''}`, r.skipped ? 'err' : 'ok', { ms: r.skipped ? 12000 : null }); done();
    }
    catch (error) { modal.querySelector('#imErr').textContent = errorMessage(error); }
  };
}

// ---------- Thiết lập ----------
async function renderSettings(root, m) {
  const c = m.config;
  const people = store.users.filter(u => u.role !== 'admin');
  root.innerHTML = `<form class="card pg-section pg-grid" id="cfgForm" data-testid="hrm-settings">
    <label class="field">Giờ vào<input type="time" name="workStart" value="${esc(c.workStart)}"></label><label class="field">Giờ ra<input type="time" name="workEnd" value="${esc(c.workEnd)}"></label>
    <label class="field">Nghỉ trưa từ<input type="time" name="lunchStart" value="${esc(c.lunchStart)}"></label><label class="field">Nghỉ trưa đến<input type="time" name="lunchEnd" value="${esc(c.lunchEnd)}"></label>
    <label class="field">Phút cho phép đi muộn<input type="number" name="graceMinutes" min="0" max="60" value="${c.graceMinutes}"></label>
    <label class="field">Ngày phép năm (≥ 12)<input type="number" name="annualDays" min="12" max="30" value="${c.annualDays}"></label>
    <fieldset class="field span2"><legend>Ngày làm việc</legend><div class="row">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="check"><input type="checkbox" name="wd" value="${d}"${c.workDays.includes(d) ? ' checked' : ''}> ${WD[d]}</label>`).join('')}</div></fieldset>
    <label class="field span2">Ngày lễ / nghỉ bù (mỗi dòng một ngày YYYY-MM-DD)<textarea name="holidays" rows="4">${esc(c.holidays.join('\n'))}</textarea></label>
    <label class="field span2">Chỉ cho chấm công trong mạng văn phòng (mỗi dòng một dải, vd. 192.168.1.0/24; để trống = không giới hạn)
      <textarea name="officeNetworks" rows="2">${esc((c.officeNetworks || []).join('\n'))}</textarea>
      <span class="muted xs">IP Kepper đang thấy từ máy bạn: <code>${esc(m.yourIp || '')}</code>. Nếu là 172.x / 192.168.65.x (Docker Desktop) thì Kepper KHÔNG thấy IP thật — đừng bật giới hạn này.</span></label>
    ${m.me.canRoles ? `<label class="field span2">Người phụ trách nhân sự (Ban giám đốc chỉ định — xem / sửa hồ sơ, hợp đồng, số định danh)
      <select name="hrUserIds" multiple size="6" data-testid="hrm-hr-users">${people.map(u => `<option value="${u.id}"${(c.hrUserIds || []).includes(u.id) ? ' selected' : ''}>${esc(u.fullName)} · ${esc(deptName(u.departmentId))}</option>`).join('')}</select></label>` : ''}
    <p class="error span2" id="cfgErr"></p><div class="modal-actions span2"><button class="btn btn-primary">Lưu thiết lập</button></div></form>`;
  $('#cfgForm', root).onsubmit = async e => {
    e.preventDefault();
    const f = e.target, b = { workStart: f.workStart.value, workEnd: f.workEnd.value, lunchStart: f.lunchStart.value, lunchEnd: f.lunchEnd.value, graceMinutes: Number(f.graceMinutes.value), annualDays: Number(f.annualDays.value),
      workDays: [...f.querySelectorAll('[name=wd]:checked')].map(x => Number(x.value)), holidays: f.holidays.value.split(/\s+/).filter(Boolean), officeNetworks: f.officeNetworks.value.split(/\s+/).filter(Boolean) };
    if (f.hrUserIds) b.hrUserIds = [...f.hrUserIds.selectedOptions].map(o => Number(o.value));
    try { const r = await api('/api/hrm/config', { method: 'PUT', body: b }); meta = null; toast(`Đã lưu thiết lập${r.recalculated ? ` — tính lại số ngày ${r.recalculated} đơn nghỉ` : ''}`, 'ok'); } catch (error) { $('#cfgErr', root).textContent = errorMessage(error); }
  };
}
