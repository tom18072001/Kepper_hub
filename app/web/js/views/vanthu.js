// Văn thư — sổ văn bản đến / đi / nội bộ (QyĐ-GA-01): vào sổ cấp số tự động, hạn xử lý theo độ khẩn, theo dõi trạng thái.
// Quyền do máy chủ quyết (routes/vanthu.js) — giao diện chỉ ẩn nút theo cờ "can" / "canRegister".
import { api } from '../api.js';
import { store, deptName } from '../store.js';
import { esc, fmtDate, fmtDateTime, toast, openModal, closeModal, confirmDialog, errorMessage } from '../util.js';

let meta = null;
const getMeta = async (fresh = false) => (meta = !fresh && meta ? meta : await api('/api/vanthu/meta'));
const opts = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(typeof v === 'string' ? v : v.label)}</option>`).join('');
const userOpts = cur => '<option value="">— chưa giao —</option>' + store.users.filter(u => u.role !== 'admin' && u.isActive !== false)
  .map(u => `<option value="${u.id}"${Number(cur) === u.id ? ' selected' : ''}>${esc(u.fullName)}${u.departmentId ? ' · ' + esc(deptName(u.departmentId)) : ''}</option>`).join('');
const formObj = form => Object.fromEntries(new FormData(form).entries());
const vnDay = d => new Date(new Date(d).getTime() + 7 * 3600e3).toISOString().slice(0, 10);
const dmy = s => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—');
const TONE = { HOA_TOC: 'danger', THUONG_KHAN: 'danger', KHAN: 'warn', THUONG: '' };
const SEC_TONE = { HAN_CHE: 'warn', BAO_MAT_CAO: 'danger' };
const statusPill = d => d.cancelled ? '<span class="pill">Đã hủy</span>' : `<span class="pill ${d.closed ? 'ok' : d.overdue ? 'danger' : 'info'}">${esc(d.status.label)}</span>`;
const TABS = [['DEN', 'Văn bản đến'], ['DI', 'Văn bản đi'], ['NOIBO', 'Nội bộ'], ['mine', 'Tôi xử lý']];

export async function renderVanthu(root, id, params, setCrumbs) {
  const m = await getMeta();
  if (id === 'thiet-lap') return renderSettings(root, setCrumbs, m);
  if (id) return renderDoc(root, Number(id), setCrumbs, m);
  setCrumbs('Văn thư');
  const tab = TABS.some(t => t[0] === params.get('book')) ? params.get('book') : 'DEN';
  const year = params.get('year') || String(new Date().getFullYear()), q = params.get('q') || '', overdue = params.get('overdue') === '1', entity = params.get('entity') || '';
  const qs = new URLSearchParams({ year, ...(tab === 'mine' ? { mine: '1' } : { book: tab }), ...(q && { q }), ...(overdue && { overdue: '1' }), ...(entity && { entity }) });
  const rows = await api('/api/vanthu/docs?' + qs);
  const series = Object.entries(m.series).filter(([k, s]) => (tab === 'mine' || s.book === tab) && m.canRegister[k]);
  const isIn = tab === 'DEN' || tab === 'mine';
  root.innerHTML = `<div class="page-head"><h1>Văn thư</h1><span class="muted sm">Vào sổ là có số ngay, theo đúng dãy của từng pháp nhân. Văn bản đến tự tính hạn theo độ khẩn.</span>
      ${m.me.director ? '<a class="btn btn-ghost" href="#/vanthu/thiet-lap" data-testid="vt-settings">Thiết lập</a>' : ''}
      ${series.length ? `<button class="btn btn-primary" id="vtNew" data-testid="vt-new">Vào sổ</button>` : ''}</div>
    <div class="seg vt-tabs" role="tablist">${TABS.map(([k, l]) => `<a role="tab" href="#/vanthu?book=${k}" class="${k === tab ? 'on' : ''}" data-testid="vt-tab-${k}">${l}</a>`).join('')}</div>
    <form class="row pg-filters" id="vtFilter">
      <input name="q" value="${esc(q)}" placeholder="Số, trích yếu, nơi gửi / nhận" class="grow" data-testid="vt-q">
      <select name="year">${[0, 1, 2].map(i => String(new Date().getFullYear() - i)).map(y => `<option${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
      ${m.entities.length > 1 ? `<select name="entity"><option value="">Mọi pháp nhân</option>${m.entities.map(e => `<option value="${e.code}"${e.code === entity ? ' selected' : ''}>${esc(e.code)} · ${esc(e.name)}</option>`).join('')}</select>` : ''}
      ${isIn ? `<label class="check"><input type="checkbox" name="overdue" value="1"${overdue ? ' checked' : ''}> Quá hạn</label>` : ''}
      <button class="btn btn-ghost">Lọc</button></form>
    ${rows.length ? `<div class="tbl-scroll"><table class="table" data-testid="vt-list"><thead><tr><th>Số</th><th>Trích yếu</th><th>${tab === 'DI' ? 'Nơi nhận' : tab === 'NOIBO' ? 'Người ký' : 'Nơi gửi'}</th>${isIn ? '<th>Người xử lý</th><th>Hạn</th>' : '<th>Ngày</th>'}<th>Trạng thái</th></tr></thead><tbody>
      ${rows.map(d => `<tr class="clickable" data-href="#/vanthu/${d.id}"><td class="code nowrap"><a href="#/vanthu/${d.id}">${esc(d.number)}</a></td>
        <td>${esc(d.title)}${d.urgency.code !== 'THUONG' ? ` <span class="pill ${TONE[d.urgency.code]}">${esc(d.urgency.label)}</span>` : ''}${SEC_TONE[d.security.code] ? ` <span class="pill ${SEC_TONE[d.security.code]}">${esc(d.security.label)}</span>` : ''}</td>
        <td>${esc((tab === 'NOIBO' ? d.signerName : d.counterpart) || '—')}</td>
        ${isIn ? `<td>${esc(d.handler?.fullName || '—')}</td><td class="nowrap">${d.overdue ? `<b class="danger-text">${dmy(d.dueDate)}</b>` : dmy(d.dueDate)}</td>` : `<td class="nowrap">${dmy(d.docDate || vnDay(d.registeredAt))}</td>`}
        <td>${statusPill(d)}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${tab === 'mine' ? 'Không có văn bản nào giao bạn xử lý.' : 'Chưa có văn bản trong sổ năm này.'}</div>`}`;
  root.querySelector('#vtFilter').onsubmit = e => {
    e.preventDefault();
    const b = formObj(e.target);
    location.hash = '#/vanthu?' + new URLSearchParams({ book: tab, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v)) });
  };
  root.querySelectorAll('tr[data-href]').forEach(tr => tr.addEventListener('click', e => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));
  root.querySelector('#vtNew')?.addEventListener('click', () => openRegister(m, series, tab, d => { location.hash = `#/vanthu/${d.id}`; }));
}

function openRegister(m, series, tab, done) {
  const first = series[0][0];
  const modal = openModal(`<h2>Vào sổ văn bản</h2><form class="pg-grid" data-testid="vt-form">
    <label class="field span2">Dãy số<select name="series" id="vtSeries">${series.map(([k, s]) => `<option value="${k}"${k === first ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
    <label class="field">Pháp nhân<select name="entity">${m.entities.map(e => `<option value="${e.code}">${esc(e.code)} · ${esc(e.name)}</option>`).join('')}</select></label>
    <label class="field">Tên loại<input name="docType" list="vtTypes" maxlength="6" placeholder="CV, TB, QĐ, TTr…"><datalist id="vtTypes">${Object.entries(m.docTypes).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</datalist></label>
    <label class="field span2">Trích yếu<input name="title" required maxlength="500" data-testid="vt-f-title"></label>
    <label class="field" data-for="DEN DI"><span data-lbl>Nơi gửi</span><input name="counterpart" maxlength="300"></label>
    <label class="field" data-for="DEN">Số, ký hiệu của bên gửi<input name="externalNumber" maxlength="80"></label>
    <label class="field" data-for="DI NOIBO">Người ký<input name="signerName" maxlength="120"></label>
    <label class="field">Ngày văn bản<input name="docDate" type="date"></label>
    <label class="field">Mức bảo mật<select name="security">${opts(m.security, 'NOI_BO')}</select></label>
    <label class="field">Độ khẩn<select name="urgency" data-testid="vt-f-urgency">${opts(m.urgency, 'THUONG')}</select></label>
    <label class="field" data-for="DEN DI NOIBO">Bộ phận<select name="departmentId"><option value="">—</option>${m.departments.map(d => `<option value="${d.id}"${d.id === m.me.departmentId ? '' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
    <label class="field" data-for="DEN">Người xử lý<select name="handlerId" data-testid="vt-f-handler">${userOpts(null)}</select></label>
    <label class="field" data-for="DEN DI">Hạn <span class="muted xs" data-due-hint></span><input name="dueDate" type="date"></label>
    <label class="field" data-for="DI">Kênh gửi<input name="channel" maxlength="60" placeholder="Bưu điện, trực tiếp, email…"></label>
    <label class="check span2" data-for="DEN"><input type="checkbox" name="toLegal" value="1"> Văn bản có thời hạn pháp lý (cơ quan nhà nước, tòa án, thuế, khiếu nại, đòi nợ…) — chuyển Pháp chế đồng thời</label>
    <label class="field span2">Ghi chú<textarea name="note" maxlength="1000" rows="2"></textarea></label>
    <p class="error span2" id="vtErr"></p>
    <div class="modal-actions span2"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="vt-f-save">Vào sổ và cấp số</button></div></form>`, { wide: true });
  const form = modal.querySelector('form');
  const sync = () => {
    const book = m.series[form.series.value].book;
    form.querySelectorAll('[data-for]').forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(book); });
    form.querySelector('[data-lbl]').textContent = book === 'DI' ? 'Nơi nhận' : 'Nơi gửi';
    form.querySelector('[data-due-hint]').textContent = book === 'DEN' ? `(để trống: tự tính ${m.dueWorkdays[form.urgency.value] || 'trong'} ngày làm việc)` : '(hạn chờ phản hồi)';
    form.departmentId.required = form.series.value === 'D7';
  };
  form.series.onchange = sync; form.urgency.onchange = sync; sync();
  modal.querySelector('[data-close]').onclick = () => closeModal();
  form.onsubmit = async e => {
    e.preventDefault();
    const b = formObj(form);
    const book = m.series[b.series].book;
    for (const el of form.querySelectorAll('[data-for]')) if (el.hidden) for (const i of el.querySelectorAll('[name]')) delete b[i.name];
    b.toLegal = b.toLegal === '1';
    b.handlerId = b.handlerId ? Number(b.handlerId) : null;
    b.departmentId = b.departmentId ? Number(b.departmentId) : null;
    if (book !== 'DEN') delete b.handlerId;
    for (const k of ['docDate', 'dueDate', 'docType']) if (!b[k]) delete b[k];
    try {
      const r = await api('/api/vanthu/docs', { method: 'POST', body: b });
      closeModal(); toast(`Đã vào sổ: ${r.number}`, 'ok'); done(r);
    } catch (error) { modal.querySelector('#vtErr').textContent = errorMessage(error); }
  };
}

async function renderDoc(root, id, setCrumbs, m) {
  const d = await api('/api/vanthu/docs/' + id);
  setCrumbs(`<a href="#/vanthu?book=${d.book.code}">Văn thư</a> / ${esc(d.number)}`);
  const row = (k, v) => (v ? `<div class="kv"><span class="muted">${k}</span><span>${v}</span></div>` : '');
  const STEP_LABEL = { PROCESSING: 'Bắt đầu xử lý', DONE: 'Báo xong', FILED: 'Lập hồ sơ', SUBMITTED: 'Đã trình', ASSIGNED: 'Đã giao', SENT: 'Đã gửi', CONFIRMED: 'Bên nhận đã xác nhận', REPLIED: 'Đã có phản hồi', EFFECTIVE: 'Có hiệu lực', EXPIRED: 'Hết hiệu lực', RECEIVED: 'Về "Đã tiếp nhận"', NUMBERED: 'Về "Đã cấp số"', ISSUED: 'Về "Đã ban hành"' };
  const ACT = { CREATE: 'Vào sổ', STATUS: 'Đổi trạng thái', ASSIGN: 'Giao xử lý', UPDATE: 'Sửa thông tin', CANCEL: 'Hủy số' };
  const st = m.status[d.book.code];
  root.innerHTML = `<div class="page-head"><h1>${esc(d.number)}</h1>${statusPill(d)}
      ${d.can.edit ? '<button class="btn btn-ghost" id="vtEdit" data-testid="vt-edit">Sửa / giao xử lý</button><button class="btn btn-ghost danger" id="vtCancel" data-testid="vt-cancel">Hủy số</button>' : ''}</div>
    <section class="card pg-section"><h2 style="margin-top:0">${esc(d.title)}</h2>
      ${d.cancelled ? `<p class="danger-text">Đã hủy ${fmtDateTime(d.cancelled.at)} — ${esc(d.cancelled.reason)}. Số này giữ nguyên trong sổ, không cấp lại.</p>` : ''}
      <div class="vt-kv">
        ${row('Sổ', esc(d.book.label) + ' · ' + esc(d.series) + ' · ' + esc(d.entity))}
        ${row(d.book.code === 'DI' ? 'Nơi nhận' : 'Nơi gửi', esc(d.counterpart || ''))}
        ${row('Số của bên gửi', esc(d.externalNumber || ''))}
        ${row('Ngày văn bản', d.docDate ? dmy(d.docDate) : '')}
        ${row('Vào sổ', fmtDateTime(d.registeredAt) + ' · ' + esc(d.createdBy.fullName || ''))}
        ${row('Mức bảo mật', esc(d.security.label))}
        ${row('Độ khẩn', esc(d.urgency.label))}
        ${row('Người xử lý', esc(d.handler?.fullName || ''))}
        ${row('Bộ phận', esc(d.department?.name || ''))}
        ${row(d.book.code === 'DI' ? 'Hạn chờ phản hồi' : 'Hạn xử lý', d.dueDate ? (d.overdue ? `<b class="danger-text">${dmy(d.dueDate)} · quá hạn</b>` : dmy(d.dueDate)) : '')}
        ${row('Người ký', esc(d.signerName || ''))}
        ${row('Kênh / mã vận đơn', esc([d.channel, d.trackingCode].filter(Boolean).join(' · ')))}
        ${row('Pháp chế', d.toLegal ? 'Đã chuyển đồng thời' : '')}
        ${row('Ghi chú', esc(d.note || ''))}
      </div>
      ${d.can.status.length ? `<div class="row wrap" style="margin-top:14px">${d.can.status.map(k => `<button class="btn ${['DONE', 'FILED', 'SENT', 'EFFECTIVE'].includes(k) ? 'btn-primary' : 'btn-ghost'} btn-sm" data-to="${k}" data-testid="vt-to-${k}">${esc(STEP_LABEL[k] || st[k])}</button>`).join('')}</div>` : ''}
    </section>
    <section class="card pg-section"><h3 style="margin-top:0">Lịch sử</h3><ol class="vt-log">
      ${d.events.map(e => `<li><span class="muted xs">${fmtDateTime(e.createdAt)}</span> <b>${esc(e.user || '')}</b> · ${esc(ACT[e.action] || e.action)}${e.action === 'STATUS' ? `: ${esc(st[e.fromValue] || e.fromValue || '')} → ${esc(st[e.toValue] || e.toValue)}` : ''}${e.note ? ` — ${esc(e.note)}` : ''}</li>`).join('')}</ol></section>`;
  root.querySelectorAll('[data-to]').forEach(b => b.onclick = async () => {
    const to = b.dataset.to;
    let note = null;
    if (to === 'DONE') { note = await confirmDialog(`Báo đã xử lý xong ${d.number}?`, { okText: 'Báo xong', input: 'Kết quả xử lý (không bắt buộc)' }); if (note === null) return; }
    try { await api(`/api/vanthu/docs/${d.id}/status`, { method: 'POST', body: { to, note: typeof note === 'string' ? note : null } }); toast('Đã cập nhật', 'ok'); renderDoc(root, id, setCrumbs, m); }
    catch (error) { toast(errorMessage(error), 'error'); }
  });
  root.querySelector('#vtCancel')?.addEventListener('click', async () => {
    const reason = await confirmDialog(`Hủy số ${d.number}? Số vẫn giữ trong sổ và không cấp lại cho văn bản khác.`, { okText: 'Hủy số', danger: true, input: 'Lý do hủy' });
    if (!reason) return;
    try { await api(`/api/vanthu/docs/${d.id}/cancel`, { method: 'POST', body: { reason } }); toast('Đã hủy số', 'ok'); renderDoc(root, id, setCrumbs, m); }
    catch (error) { toast(errorMessage(error), 'error'); }
  });
  root.querySelector('#vtEdit')?.addEventListener('click', () => {
    const modal = openModal(`<h2>Sửa ${esc(d.number)}</h2><p class="muted sm">Số và ký hiệu không đổi được. Văn bản sai số: hủy số rồi vào sổ lại.</p><form class="pg-grid">
      <label class="field span2">Trích yếu<input name="title" required maxlength="500" value="${esc(d.title)}"></label>
      <label class="field">${d.book.code === 'DI' ? 'Nơi nhận' : 'Nơi gửi'}<input name="counterpart" maxlength="300" value="${esc(d.counterpart || '')}"></label>
      <label class="field">Người xử lý<select name="handlerId" data-testid="vt-e-handler">${userOpts(d.handler?.id)}</select></label>
      <label class="field">Hạn<input name="dueDate" type="date" value="${esc(d.dueDate || '')}"></label>
      <label class="field">Mức bảo mật<select name="security">${opts(m.security, d.security.code)}</select></label>
      <label class="field">Độ khẩn<select name="urgency">${opts(m.urgency, d.urgency.code)}</select></label>
      <label class="field">Mã vận đơn<input name="trackingCode" maxlength="60" value="${esc(d.trackingCode || '')}"></label>
      <label class="check span2"><input type="checkbox" name="toLegal" value="1"${d.toLegal ? ' checked' : ''}> Chuyển Pháp chế đồng thời</label>
      <label class="field span2">Ghi chú<textarea name="note" maxlength="1000" rows="2">${esc(d.note || '')}</textarea></label>
      <p class="error span2" id="veErr"></p>
      <div class="modal-actions span2"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="vt-e-save">Lưu</button></div></form>`, { wide: true });
    modal.querySelector('[data-close]').onclick = () => closeModal();
    modal.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const b = formObj(e.target);
      b.toLegal = b.toLegal === '1'; b.handlerId = b.handlerId ? Number(b.handlerId) : null; if (!b.dueDate) b.dueDate = null;
      if (b.handlerId === (d.handler?.id ?? null)) delete b.handlerId;
      try { await api(`/api/vanthu/docs/${d.id}`, { method: 'PATCH', body: b }); closeModal(); toast('Đã lưu', 'ok'); renderDoc(root, id, setCrumbs, m); }
      catch (error) { modal.querySelector('#veErr').textContent = errorMessage(error); }
    };
  });
}

async function renderSettings(root, setCrumbs, m) {
  setCrumbs('<a href="#/vanthu">Văn thư</a> / Thiết lập');
  if (!m.me.director) { root.innerHTML = '<div class="empty">Chỉ Ban Giám đốc thiết lập văn thư.</div>'; return; }
  const people = (ids, name) => `<select name="${name}" multiple size="6">${store.users.filter(u => u.role !== 'admin').map(u => `<option value="${u.id}"${ids.includes(u.id) ? ' selected' : ''}>${esc(u.fullName)}${u.departmentId ? ' · ' + esc(deptName(u.departmentId)) : ''}</option>`).join('')}</select>`;
  root.innerHTML = `<div class="page-head"><h1>Thiết lập văn thư</h1><span class="muted sm">Pháp nhân có dãy số riêng. Văn thư được vào sổ mọi dãy; Pháp chế nhận văn bản có thời hạn pháp lý.</span></div>
    <form class="card pg-section pg-grid" id="vtCfg">
      <label class="field span2">Pháp nhân <span class="muted xs">(mỗi dòng: MÃ · Tên — pháp nhân đầu tiên là công ty mẹ, dãy D6 ký hiệu TGĐ)</span>
        <textarea name="entities" rows="3" data-testid="vt-c-entities">${esc(m.entities.map(e => `${e.code} · ${e.name}`).join('\n'))}</textarea></label>
      <label class="field">Văn thư<br>${people(m.config.clerkUserIds, 'clerkUserIds')}</label>
      <label class="field">Pháp chế<br>${people(m.config.legalUserIds, 'legalUserIds')}</label>
      <p class="error span2" id="vcErr"></p>
      <div class="modal-actions span2"><button class="btn btn-primary" data-testid="vt-c-save">Lưu</button></div></form>`;
  root.querySelector('#vtCfg').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const entities = f.entities.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [code, ...rest] = l.split(/\s*[·\-–|:]\s*/); return { code: (code || '').toUpperCase(), name: rest.join(' - ') }; });
    const sel = n => [...f[n].selectedOptions].map(o => Number(o.value));
    try { await api('/api/vanthu/config', { method: 'PUT', body: { entities, clerkUserIds: sel('clerkUserIds'), legalUserIds: sel('legalUserIds') } }); await getMeta(true); toast('Đã lưu thiết lập', 'ok'); location.hash = '#/vanthu'; }
    catch (error) { root.querySelector('#vcErr').textContent = errorMessage(error); }
  };
}
