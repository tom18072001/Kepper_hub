// Văn thư — sổ văn bản đến / đi / nội bộ (QyĐ-GA-01): vào sổ cấp số tự động, hạn xử lý theo độ khẩn, theo dõi trạng thái.
// Quyền do máy chủ quyết (routes/vanthu.js) — giao diện chỉ ẩn nút theo cờ "can" / "canRegister".
import { api, download } from '../api.js';
import { store, deptName } from '../store.js';
import { docTabs } from './tai-lieu.js';
import { esc, fmtDate, fmtDateTime, toast, openModal, closeModal, confirmDialog, errorMessage, debounce, replaceHashParams, isItUser } from '../util.js';

let meta = null;
const getMeta = async (fresh = false) => (meta = !fresh && meta ? meta : await api('/api/vanthu/meta'));
const opts = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(typeof v === 'string' ? v : v.label)}</option>`).join('');
const userOpts = cur => '<option value="">— chưa giao —</option>' + store.users.filter(u => !isItUser(u) && u.isActive !== false)
  .map(u => `<option value="${u.id}"${Number(cur) === u.id ? ' selected' : ''}>${esc(u.fullName)}${u.departmentId ? ' · ' + esc(deptName(u.departmentId)) : ''}</option>`).join('');
const formObj = form => Object.fromEntries(new FormData(form).entries());
const vnDay = d => new Date(new Date(d).getTime() + 7 * 3600e3).toISOString().slice(0, 10);
const dmy = s => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—');
const TONE = { HOA_TOC: 'danger', THUONG_KHAN: 'danger', KHAN: 'warn', THUONG: '' };
const SEC_TONE = { HAN_CHE: 'warn', BAO_MAT_CAO: 'danger' };
const NOIBO_TONE = { DRAFT: 'warn', RETURNED: 'danger', APPROVED: 'info', EFFECTIVE: 'ok', EXPIRED: '' };
const statusPill = d => d.cancelled ? '<span class="pill">Đã hủy</span>'
  : d.book.code === 'NOIBO' ? `<span class="pill ${NOIBO_TONE[d.status.code] ?? 'info'}" data-testid="vt-status">${esc(d.status.label)}</span>`
    : `<span class="pill ${d.closed ? 'ok' : d.overdue ? 'danger' : 'info'}">${esc(d.status.label)}</span>`;
// Sổ nội bộ: dự thảo chưa có số (cấp lúc phê duyệt).
const numOf = d => (d.number ? esc(d.number) : '<i class="muted">Dự thảo</i>');
const LEVEL_TONE = { LEADERS: 'warn', BOARD: 'danger' };
// Trong mục "Tài liệu": tab "Văn thư" gồm sổ đến / đi / việc tôi xử lý; sổ nội bộ (D5–D7: quyết định, quy chế, quy định…) là tab riêng
// "Quy chế, quy định nội bộ" (docTabs). Dữ liệu và luồng vào sổ, cấp số không đổi.
const TABS = [['DEN', 'Văn bản đến'], ['DI', 'Văn bản đi'], ['NOIBO', 'Nội bộ'], ['mine', 'Tôi xử lý']];
const crumbHome = '<a href="#/tai-lieu">Tài liệu</a>';

export async function renderVanthu(root, id, params, setCrumbs) {
  const m = await getMeta();
  if (id === 'thiet-lap') return renderSettings(root, setCrumbs, m);
  if (id) return renderDoc(root, Number(id), setCrumbs, m);
  const tab = TABS.some(t => t[0] === params.get('book')) ? params.get('book') : 'DEN';
  setCrumbs(`${crumbHome} / ${tab === 'NOIBO' ? 'Quy chế, quy định nội bộ' : 'Văn thư'}`);
  const thisYear = String(new Date().getFullYear());
  const init = { year: params.get('year') || thisYear, q: params.get('q') || '', overdue: params.get('overdue') === '1', entity: params.get('entity') || '' };
  const fetchRows = f => api('/api/vanthu/docs?' + new URLSearchParams({ year: f.year, ...(tab === 'mine' ? { mine: '1' } : { book: tab }), ...(f.q && { q: f.q }), ...(f.overdue && { overdue: '1' }), ...(f.entity && { entity: f.entity }) }));
  const rows = await fetchRows(init);
  const series = Object.entries(m.series).filter(([k, s]) => (tab === 'mine' ? s.book !== 'NOIBO' : s.book === tab) && m.canRegister[k]);
  const isIn = tab === 'DEN' || tab === 'mine';
  const register = () => (tab === 'NOIBO' ? openDraft : openRegister)(m, series, tab, d => { location.hash = `#/vanthu/${d.id}`; });
  // Trang trống: sổ năm hiện tại chưa có văn bản → mời vào sổ (chỉ người được vào sổ dãy của sổ này); đang lọc → gợi ý xoá bộ lọc.
  const emptyHtml = f => (f.q || f.overdue || f.entity
    ? '<div class="empty" data-testid="vt-empty"><p>Không có văn bản khớp bộ lọc.</p><button type="button" class="btn btn-ghost btn-sm" data-act="vt-clear" data-testid="vt-clear">Xoá bộ lọc</button></div>'
    : tab === 'mine' ? '<div class="empty" data-testid="vt-empty">Không có văn bản nào giao bạn xử lý.</div>'
      : `<div class="empty" data-testid="vt-empty"><p>Chưa có văn bản trong sổ năm này.</p>${series.length && f.year === thisYear ? `<button type="button" class="btn btn-primary" data-act="vt-new-first" data-testid="vt-new-first">${tab === 'NOIBO' ? 'Tạo dự thảo đầu tiên' : 'Vào sổ văn bản đầu tiên'}</button>` : ''}</div>`);
  const noiboRow = d => `<tr class="clickable" data-href="#/vanthu/${d.id}"><td class="code nowrap"><a href="#/vanthu/${d.id}">${numOf(d)}</a></td>
        <td>${esc(d.title)}${d.docCode ? ` <span class="muted xs">${esc(d.docCode)}</span>` : ''}</td><td>${esc(m.noiboTypes[d.docType] || d.docType || '—')}</td>
        <td>${LEVEL_TONE[d.viewLevel.code] ? `<span class="pill ${LEVEL_TONE[d.viewLevel.code]}">${esc(d.viewLevel.label)}</span>` : esc(d.viewLevel.label)}</td>
        <td class="nowrap">${d.issueDate ? dmy(d.issueDate) : '—'}</td><td>${statusPill(d)}</td></tr>`;
  const listHtml = (list, f) => (!list.length ? emptyHtml(f) : tab === 'NOIBO'
    ? `<div class="tbl-scroll"><table class="table" data-testid="vt-list"><thead><tr><th>Số</th><th>Tên tài liệu</th><th>Loại</th><th>Cấp xem</th><th>Ngày ban hành</th><th>Trạng thái</th></tr></thead><tbody>${list.map(noiboRow).join('')}</tbody></table></div>`
    : `<div class="tbl-scroll"><table class="table" data-testid="vt-list"><thead><tr><th>Số</th><th>Trích yếu</th><th>${tab === 'DI' ? 'Nơi nhận' : 'Nơi gửi'}</th>${isIn ? '<th>Người xử lý</th><th>Hạn</th>' : '<th>Ngày</th>'}<th>Trạng thái</th></tr></thead><tbody>
      ${list.map(d => `<tr class="clickable" data-href="#/vanthu/${d.id}"><td class="code nowrap"><a href="#/vanthu/${d.id}">${numOf(d)}</a></td>
        <td>${esc(d.title)}${d.urgency.code !== 'THUONG' ? ` <span class="pill ${TONE[d.urgency.code]}">${esc(d.urgency.label)}</span>` : ''}${d.security && SEC_TONE[d.security.code] ? ` <span class="pill ${SEC_TONE[d.security.code]}">${esc(d.security.label)}</span>` : ''}</td>
        <td>${esc((d.book.code === 'NOIBO' ? m.noiboTypes[d.docType] : d.counterpart) || '—')}</td>
        ${isIn ? `<td>${esc(d.handler?.fullName || '—')}</td><td class="nowrap">${d.overdue ? `<b class="danger-text">${dmy(d.dueDate)}</b>` : dmy(d.dueDate)}</td>` : `<td class="nowrap">${dmy(d.docDate || vnDay(d.registeredAt))}</td>`}
        <td>${statusPill(d)}</td></tr>`).join('')}</tbody></table></div>`);
  root.innerHTML = `<div class="page-head"><h1>Tài liệu</h1><span class="muted sm">${tab === 'NOIBO' ? 'Quy chế, quy định, quyết định nội bộ (D5–D7). Tạo là dự thảo "Chưa phê duyệt"; số cấp khi Người phê duyệt bấm Phê duyệt. Mỗi tài liệu có cấp xem: Mọi người / Lãnh đạo / Ban TGĐ.' : 'Vào sổ là có số ngay, theo đúng dãy của từng pháp nhân. Văn bản đến tự tính hạn theo độ khẩn.'}</span>
      ${m.me.director ? '<a class="btn btn-ghost" href="#/vanthu/thiet-lap" data-testid="vt-settings">Thiết lập</a>' : ''}
      ${series.length ? `<button class="btn btn-primary" id="vtNew" data-testid="vt-new">${tab === 'NOIBO' ? 'Tạo dự thảo' : 'Vào sổ'}</button>` : ''}</div>
    ${docTabs(tab === 'NOIBO' ? 'noibo' : 'vanthu')}
    ${tab === 'NOIBO' ? '' : `<div class="seg vt-tabs" role="tablist">${TABS.filter(t => t[0] !== 'NOIBO').map(([k, l]) => `<a role="tab" href="#/vanthu?book=${k}" class="${k === tab ? 'on' : ''}" data-testid="vt-tab-${k}">${l}</a>`).join('')}</div>`}
    <form class="row pg-filters" id="vtFilter" role="search" aria-label="Lọc văn bản">
      <input name="q" type="search" value="${esc(init.q)}" placeholder="Số, trích yếu, nơi gửi / nhận" class="grow" aria-label="Tìm văn bản" data-testid="vt-q">
      <select name="year" aria-label="Năm" data-testid="vt-year">${[0, 1, 2].map(i => String(new Date().getFullYear() - i)).map(y => `<option${y === init.year ? ' selected' : ''}>${y}</option>`).join('')}</select>
      ${m.entities.length > 1 ? `<select name="entity" aria-label="Pháp nhân" data-testid="vt-entity"><option value="">Mọi pháp nhân</option>${m.entities.map(e => `<option value="${e.code}"${e.code === init.entity ? ' selected' : ''}>${esc(e.code)} · ${esc(e.name)}</option>`).join('')}</select>` : ''}
      ${isIn ? `<label class="check"><input type="checkbox" name="overdue" value="1"${init.overdue ? ' checked' : ''} data-testid="vt-overdue"> Quá hạn</label>` : ''}</form>
    <div id="vtList" aria-live="polite">${listHtml(rows, init)}</div>`;
  const form = root.querySelector('#vtFilter'), listEl = root.querySelector('#vtList');
  const bindRows = () => listEl.querySelectorAll('tr[data-href]').forEach(tr => tr.addEventListener('click', e => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));
  bindRows();
  // Lọc ngay khi gõ / chọn (không có nút "Lọc"): vẽ lại riêng danh sách, ghi bộ lọc lên URL bằng replaceState để tải lại trang vẫn giữ.
  let seq = 0;
  const reload = async () => {
    // Đã chuyển trang trong lúc chờ gõ. root (không phải form): nội dung cũ còn hiện tới khi trang mới vẽ xong nên form vẫn gắn trên trang.
    if (!root.isConnected || !form.isConnected) return;
    const b = formObj(form), my = ++seq;
    const f = { year: b.year || thisYear, q: String(b.q || '').trim(), overdue: b.overdue === '1', entity: b.entity || '' };
    replaceHashParams({ q: f.q, year: f.year, entity: f.entity, overdue: f.overdue ? '1' : null });
    listEl.setAttribute('aria-busy', 'true');
    try {
      const list = await fetchRows(f);
      if (my !== seq || !root.isConnected || !form.isConnected) return; // kết quả cũ về muộn
      listEl.innerHTML = listHtml(list, f); bindRows();
    } catch (error) { if (my === seq && form.isConnected) listEl.innerHTML = `<div class="empty">${esc(errorMessage(error))}</div>`; }
    finally { if (my === seq) listEl.removeAttribute('aria-busy'); }
  };
  const typed = debounce(reload, 300);
  form.q.addEventListener('input', typed);
  form.addEventListener('change', e => { if (e.target !== form.q) reload(); });
  form.addEventListener('submit', e => { e.preventDefault(); reload(); }); // Enter: lọc ngay, không chờ
  listEl.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'vt-new-first') register();
    if (act === 'vt-clear') { form.q.value = ''; if (form.overdue) form.overdue.checked = false; if (form.entity) form.entity.value = ''; reload(); form.q.focus(); }
  });
  root.querySelector('#vtNew')?.addEventListener('click', register);
}

// Sổ nội bộ: tạo DỰ THẢO (chưa có số). Cấp xem chỉ hiện các cấp không cao hơn vai người tạo; tệp PDF tải lên ngay sau khi tạo.
async function openDraft(m, series, tab, done) {
  const first = series[0][0];
  const olds = (await api('/api/vanthu/docs?book=NOIBO').catch(() => [])).filter(d => d.number && !d.cancelled && !d.draft);
  const modal = openModal(`<h2>Tạo dự thảo tài liệu nội bộ</h2>
    <p class="muted sm">Tài liệu ở trạng thái <b>Chưa phê duyệt</b>, chưa có số. Người phê duyệt xem tệp PDF rồi bấm Phê duyệt — lúc đó hệ thống cấp số.</p>
    <form class="pg-grid" data-testid="vt-draft-form">
    <label class="field span2">Dãy số<select name="series" id="vtSeries">${series.map(([k, s]) => `<option value="${k}"${k === first ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
    <label class="field">Pháp nhân<select name="entity">${m.entities.map(e => `<option value="${e.code}">${esc(e.code)} · ${esc(e.name)}</option>`).join('')}</select></label>
    <label class="field">Loại<select name="docType" required data-testid="vt-d-type"><option value="">— chọn —</option>${opts(m.noiboTypes, '')}</select></label>
    <label class="field span2">Tên / trích yếu<input name="title" required maxlength="500" data-testid="vt-d-title"></label>
    <label class="field">Cấp xem<select name="viewLevel" data-testid="vt-d-level">${m.myViewLevels.map(k => `<option value="${k}">${esc(m.viewLevels[k])}</option>`).join('')}</select></label>
    <label class="field">Mã tài liệu <span class="muted xs">(nếu có)</span><input name="docCode" maxlength="40" placeholder="vd. QC-IT-01"></label>
    <label class="field" data-d7>Bộ phận<select name="departmentId"><option value="">—</option>${m.departments.map(d => `<option value="${d.id}"${d.id === m.me.departmentId ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
    <label class="field">Ngày hiệu lực <span class="muted xs">(trống: từ lúc phê duyệt)</span><input name="effectiveDate" type="date"></label>
    <label class="field">Ngày ban hành gốc <span class="muted xs">(chỉ văn bản đã ban hành trước khi đưa vào Hub)</span><input name="docDate" type="date"></label>
    <label class="field span2">Thay thế văn bản <span class="muted xs">(nếu là bản mới của tài liệu đã có)</span><select name="replacesId"><option value="">—</option>${olds.map(d => `<option value="${d.id}">${esc(d.number)} · ${esc(d.title.slice(0, 80))}</option>`).join('')}</select></label>
    <label class="field span2">Tệp PDF <span class="muted xs">(bắt buộc trước khi phê duyệt)</span><input name="pdf" type="file" accept="application/pdf,.pdf" data-testid="vt-d-file"></label>
    <label class="field span2">Ghi chú<textarea name="note" maxlength="1000" rows="2"></textarea></label>
    <p class="error span2" id="vtErr"></p>
    <div class="modal-actions span2"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="vt-d-save">Tạo dự thảo</button></div></form>`, { wide: true });
  const form = modal.querySelector('form');
  const sync = () => { const d7 = form.series.value === 'D7'; form.querySelector('[data-d7]').hidden = !d7; form.departmentId.required = d7; };
  form.series.onchange = sync; sync();
  modal.querySelector('[data-close]').onclick = () => closeModal();
  form.onsubmit = async e => {
    e.preventDefault();
    const b = formObj(form), pdf = form.pdf.files[0];
    delete b.pdf;
    b.departmentId = b.series === 'D7' && b.departmentId ? Number(b.departmentId) : null;
    b.replacesId = b.replacesId ? Number(b.replacesId) : null;
    for (const k of ['docDate', 'effectiveDate', 'docCode', 'note']) if (!b[k]) delete b[k];
    try {
      const r = await api('/api/vanthu/docs', { method: 'POST', body: b });
      if (pdf) {
        const fd = new FormData(); fd.append('files', pdf);
        try { await api(`/api/vanthu/docs/${r.id}/files`, { method: 'POST', form: fd }); }
        catch (error) { toast(`Đã tạo dự thảo nhưng chưa tải được tệp: ${errorMessage(error)}`, 'error'); }
      }
      closeModal(); toast('Đã tạo dự thảo — chờ phê duyệt', 'ok'); done(r);
    } catch (error) { modal.querySelector('#vtErr').textContent = errorMessage(error); }
  };
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
  const noibo = d.book.code === 'NOIBO';
  setCrumbs(`${crumbHome} / <a href="#/vanthu?book=${d.book.code}">${noibo ? 'Quy chế, quy định nội bộ' : 'Văn thư'}</a> / ${d.number ? esc(d.number) : 'Dự thảo'}`);
  const row = (k, v) => (v ? `<div class="kv"><span class="muted">${k}</span><span>${v}</span></div>` : '');
  const STEP_LABEL = { PROCESSING: 'Bắt đầu xử lý', DONE: 'Báo xong', FILED: 'Lập hồ sơ', SUBMITTED: 'Đã trình', ASSIGNED: 'Đã giao', SENT: 'Đã gửi', CONFIRMED: 'Bên nhận đã xác nhận', REPLIED: 'Đã có phản hồi', EFFECTIVE: 'Có hiệu lực', EXPIRED: 'Hết hiệu lực', RECEIVED: 'Về "Đã tiếp nhận"', NUMBERED: 'Về "Đã cấp số"', ISSUED: 'Về "Đã ban hành"' };
  const ACT = { CREATE: noibo ? 'Tạo dự thảo' : 'Vào sổ', STATUS: 'Đổi trạng thái', ASSIGN: 'Giao xử lý', UPDATE: 'Sửa thông tin', CANCEL: noibo && !d.number ? 'Huỷ dự thảo' : 'Hủy số', FILE: 'Thêm tệp', FILE_DELETED: 'Gỡ tệp',
    APPROVE: 'Phê duyệt', RETURN: 'Trả lại', RESUBMIT: 'Gửi lại', MIGRATE: 'Chuyển sang luồng phê duyệt (văn bản có từ trước)' };
  const st = m.status[d.book.code];
  const hasPdf = d.files.some(f => f.mimeType === 'application/pdf');
  const lastReturn = noibo && d.status.code === 'RETURNED' ? [...d.events].reverse().find(e => e.action === 'RETURN') : null;
  const noiboKv = () => `
        ${row('Loại', esc(m.noiboTypes[d.docType] || d.docType || ''))}
        ${row('Mã tài liệu', esc(d.docCode || ''))}
        ${row('Cấp xem', `<span data-testid="vt-level">${esc(d.viewLevel.label)}</span>`)}
        ${row('Sổ', esc(d.series) + ' · ' + esc(d.entity))}
        ${row('Bộ phận', esc(d.department?.name || ''))}
        ${row('Người soạn', esc(d.createdBy.fullName || '') + ' · ' + fmtDateTime(d.events.find(e => e.action === 'CREATE')?.createdAt || d.registeredAt) + (d.viaAi ? ' · <span class="pill">tạo qua Claude</span>' : ''))}
        ${row('Người phê duyệt', d.approvedBy ? `${esc(d.approvedBy.fullName || '')} · ${fmtDateTime(d.approvedAt)}` : '')}
        ${row('Ngày ban hành', d.issueDate ? dmy(d.issueDate) + (d.docDate ? ' <span class="muted xs">(ngày ban hành gốc)</span>' : '') : '')}
        ${row('Ngày hiệu lực', d.effectiveDate ? dmy(d.effectiveDate) : d.approvedAt ? 'Từ lúc phê duyệt' : '')}
        ${row('Thay thế văn bản', d.replacesId ? `<a href="#/vanthu/${d.replacesId}">xem bản cũ</a>` : '')}
        ${row('Ghi chú', esc(d.note || ''))}`;
  const noiboBtns = () => [
    d.can.approve ? `<button class="btn btn-primary" id="vtApprove" data-testid="vt-approve"${hasPdf ? '' : ' disabled title="Chưa có tệp PDF"'}>Phê duyệt</button>` : '',
    d.can.return ? '<button class="btn btn-ghost" id="vtReturn" data-testid="vt-return">Trả lại</button>' : '',
    d.can.resubmit ? '<button class="btn btn-primary" id="vtResubmit" data-testid="vt-resubmit">Gửi lại</button>' : '',
    d.can.edit ? '<button class="btn btn-ghost" id="vtEdit" data-testid="vt-edit">Sửa</button>' : '',
    d.can.cancel ? `<button class="btn btn-ghost danger" id="vtCancel" data-testid="vt-cancel">${d.number ? 'Hủy số' : 'Huỷ dự thảo'}</button>` : '',
  ].join('');
  root.innerHTML = `<div class="page-head"><h1>${d.number ? esc(d.number) : 'Dự thảo'}</h1>${statusPill(d)}
      ${noibo ? noiboBtns() : `${d.can.edit ? '<button class="btn btn-ghost" id="vtEdit" data-testid="vt-edit">Sửa / giao xử lý</button>' : ''}${d.can.cancel ? '<button class="btn btn-ghost danger" id="vtCancel" data-testid="vt-cancel">Hủy số</button>' : ''}`}</div>
    ${noibo && d.draft && !d.cancelled ? `<p class="${lastReturn ? 'danger-text' : 'muted'} sm" data-testid="vt-draft-note">${lastReturn ? `Đã trả lại: ${esc(lastReturn.note || '')} — người soạn sửa rồi bấm "Gửi lại".` : `Chưa phê duyệt — chưa có số. ${hasPdf ? 'Người phê duyệt xem tệp PDF rồi bấm Phê duyệt.' : '<b>Chưa có tệp PDF</b>: tải tệp lên trước khi phê duyệt.'}`}</p>` : ''}
    <section class="card pg-section"><h2 style="margin-top:0">${esc(d.title)}</h2>
      ${d.cancelled ? `<p class="danger-text">Đã hủy ${fmtDateTime(d.cancelled.at)} — ${esc(d.cancelled.reason)}. Số này giữ nguyên trong sổ, không cấp lại.</p>` : ''}
      <div class="vt-kv">${noibo ? noiboKv() : `
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
        ${row('Ghi chú', esc(d.note || ''))}`}
      </div>
      ${d.can.status.length ? `<div class="row wrap" style="margin-top:14px">${d.can.status.map(k => `<button class="btn ${['DONE', 'FILED', 'SENT', 'EFFECTIVE'].includes(k) ? 'btn-primary' : 'btn-ghost'} btn-sm" data-to="${k}" data-testid="vt-to-${k}">${esc(STEP_LABEL[k] || st[k])}</button>`).join('')}</div>` : ''}
    </section>
    <section class="card pg-section" data-testid="vt-files"><h3 style="margin-top:0">Tệp văn bản</h3>
      ${d.files.length ? `<ul class="vt-files">${d.files.map(f => `<li><span>${esc(f.fileName)}</span> <span class="muted xs">${(f.sizeBytes / 1024).toFixed(0)} KB · ${esc(f.uploadedBy || '')} · ${fmtDateTime(f.createdAt)}</span>
        ${f.storedIn === 'NAS' ? ` <span class="pill ok" title="Bản gốc trên NAS: \\\\192.168.130.2\\DATA\\${esc(f.nasPath.replace(/\//g, '\\'))}" data-testid="vt-file-nas">NAS${f.version ? ` · v${String(f.version).padStart(2, '0')}` : ''}</span>` : ''}
        <button class="btn btn-ghost btn-sm" data-dl="${f.id}">Tải</button>${d.can.deleteFile ? `<button class="btn btn-ghost btn-sm danger" data-rm="${f.id}"${f.storedIn === 'NAS' ? ' data-nas="1"' : ''}>Gỡ</button>` : ''}</li>`).join('')}</ul>`
        : '<p class="muted sm">Chưa có tệp. Bản scan văn bản lưu vào thư mục văn thư của bộ phận trên NAS.</p>'}
      ${d.can.upload ? '<label class="btn btn-ghost btn-sm">Tải tệp lên<input type="file" id="vtFiles" multiple hidden data-testid="vt-file-input"></label>' : ''}
    </section>
    <section class="card pg-section"><h3 style="margin-top:0">Lịch sử</h3><ol class="vt-log">
      ${d.events.map(e => `<li><span class="muted xs">${fmtDateTime(e.createdAt)}</span> <b>${esc(e.user || '')}</b> · ${esc(ACT[e.action] || e.action)}${e.action === 'STATUS' ? `: ${esc(st[e.fromValue] || e.fromValue || '')} → ${esc(st[e.toValue] || e.toValue)}` : ''}${e.note ? ` — <span style="white-space:pre-line">${esc(e.note)}</span>` : ''}</li>`).join('')}</ol></section>`;
  root.querySelectorAll('[data-to]').forEach(b => b.onclick = async () => {
    const to = b.dataset.to;
    let note = null;
    if (to === 'DONE') { note = await confirmDialog(`Báo đã xử lý xong ${d.number}?`, { okText: 'Báo xong', input: 'Kết quả xử lý (không bắt buộc)' }); if (note === null) return; }
    try { await api(`/api/vanthu/docs/${d.id}/status`, { method: 'POST', body: { to, note: typeof note === 'string' ? note : null } }); toast('Đã cập nhật', 'ok'); renderDoc(root, id, setCrumbs, m); }
    catch (error) { toast(errorMessage(error), 'error'); }
  });
  root.querySelector('#vtFiles')?.addEventListener('change', async e => {
    if (!e.target.files.length) return;
    const form = new FormData();
    for (const f of e.target.files) form.append('files', f);
    try { await api(`/api/vanthu/docs/${d.id}/files`, { method: 'POST', form }); toast('Đã tải tệp lên', 'ok'); renderDoc(root, id, setCrumbs, m); }
    catch (error) { toast(errorMessage(error), 'error'); e.target.value = ''; }
  });
  root.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => download(`/api/vanthu/files/${b.dataset.dl}/download`).catch(err => toast(errorMessage(err), 'error')));
  // Máy chủ (storage.remove): tệp trên NAS chuyển vào _LuuTru của thư mục sổ; tệp lưu trong Hub (không nhãn NAS) bị xoá thật — hộp hỏi nói rõ.
  root.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    const msg = b.dataset.nas ? 'Gỡ tệp khỏi văn bản? Bản trên NAS được chuyển vào thư mục _LuuTru của sổ, không xoá hẳn.' : 'Gỡ tệp khỏi văn bản? Tệp lưu trong Hub sẽ bị xoá hẳn, không khôi phục được.';
    if (!(await confirmDialog(msg, { okText: 'Gỡ tệp', danger: true }))) return;
    try { await api(`/api/vanthu/files/${b.dataset.rm}`, { method: 'DELETE' }); toast('Đã gỡ tệp', 'ok'); renderDoc(root, id, setCrumbs, m); }
    catch (error) { toast(errorMessage(error), 'error'); }
  });
  root.querySelector('#vtCancel')?.addEventListener('click', async () => {
    const reason = d.number
      ? await confirmDialog(`Hủy số ${d.number}? Số vẫn giữ trong sổ và không cấp lại cho văn bản khác.`, { okText: 'Hủy số', danger: true, input: 'Lý do hủy' })
      : await confirmDialog('Huỷ dự thảo này? Dự thảo chưa có số nên không ảnh hưởng sổ.', { okText: 'Huỷ dự thảo', danger: true, input: 'Lý do huỷ' });
    if (!reason) return;
    try { await api(`/api/vanthu/docs/${d.id}/cancel`, { method: 'POST', body: { reason } }); toast(d.number ? 'Đã hủy số' : 'Đã huỷ dự thảo', 'ok'); renderDoc(root, id, setCrumbs, m); }
    catch (error) { toast(errorMessage(error), 'error'); }
  });
  const act = async (path, body, msg) => {
    try { await api(`/api/vanthu/docs/${d.id}/${path}`, { method: 'POST', body }); toast(msg, 'ok'); renderDoc(root, id, setCrumbs, m); }
    catch (error) { toast(errorMessage(error), 'error'); }
  };
  root.querySelector('#vtApprove')?.addEventListener('click', async () => {
    const note = await confirmDialog(`Phê duyệt "${d.title}"? Hệ thống cấp số ngay và khoá nội dung, tệp của tài liệu.`, { okText: 'Phê duyệt', input: 'Ý kiến (không bắt buộc)' });
    if (note === null || note === false) return;
    act('approve', { note: typeof note === 'string' ? note : null }, 'Đã phê duyệt và cấp số');
  });
  root.querySelector('#vtReturn')?.addEventListener('click', async () => {
    const reason = await confirmDialog(`Trả lại "${d.title}" cho người soạn?`, { okText: 'Trả lại', danger: true, input: 'Lý do trả lại (bắt buộc)' });
    if (!reason) return;
    act('return', { reason }, 'Đã trả lại');
  });
  root.querySelector('#vtResubmit')?.addEventListener('click', () => act('resubmit', {}, 'Đã gửi lại chờ phê duyệt'));
  if (noibo) { root.querySelector('#vtEdit')?.addEventListener('click', () => openNoiboEdit(d, m, () => renderDoc(root, id, setCrumbs, m))); return; }
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

// Sửa tài liệu nội bộ: dự thảo — mọi trường; đã phê duyệt — chỉ ghi chú, cấp xem, ngày hiệu lực (khi chưa hiệu lực).
async function openNoiboEdit(d, m, done) {
  const draft = d.draft;
  const levels = m.myViewLevels.includes(d.viewLevel.code) ? m.myViewLevels : [...m.myViewLevels, d.viewLevel.code];
  const olds = draft ? (await api('/api/vanthu/docs?book=NOIBO').catch(() => [])).filter(x => x.number && !x.cancelled && !x.draft && x.id !== d.id) : [];
  const modal = openModal(`<h2>Sửa ${draft ? 'dự thảo' : esc(d.number)}</h2>
    ${draft ? '' : '<p class="muted sm">Tài liệu đã phê duyệt: nội dung và tệp đã khoá. Muốn đổi nội dung, tạo dự thảo mới và chọn "Thay thế văn bản".</p>'}
    <form class="pg-grid">
    ${draft ? `<label class="field span2">Tên / trích yếu<input name="title" required maxlength="500" value="${esc(d.title)}"></label>
      <label class="field">Loại<select name="docType" required>${opts(m.noiboTypes, d.docType)}</select></label>
      <label class="field">Mã tài liệu<input name="docCode" maxlength="40" value="${esc(d.docCode || '')}"></label>
      <label class="field">Ngày ban hành gốc<input name="docDate" type="date" value="${esc(d.docDate || '')}"></label>
      <label class="field span2">Thay thế văn bản<select name="replacesId"><option value="">—</option>${olds.map(x => `<option value="${x.id}"${x.id === d.replacesId ? ' selected' : ''}>${esc(x.number)} · ${esc(x.title.slice(0, 80))}</option>`).join('')}</select></label>` : ''}
    <label class="field">Cấp xem<select name="viewLevel" data-testid="vt-e-level">${levels.map(k => `<option value="${k}"${k === d.viewLevel.code ? ' selected' : ''}>${esc(m.viewLevels[k])}</option>`).join('')}</select></label>
    ${draft || d.status.code === 'APPROVED' ? `<label class="field">Ngày hiệu lực<input name="effectiveDate" type="date" value="${esc(d.effectiveDate || '')}"></label>` : ''}
    <label class="field span2">Ghi chú<textarea name="note" maxlength="1000" rows="2">${esc(d.note || '')}</textarea></label>
    <p class="error span2" id="veErr"></p>
    <div class="modal-actions span2"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="vt-e-save">Lưu</button></div></form>`, { wide: true });
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const b = formObj(e.target);
    if ('replacesId' in b) b.replacesId = b.replacesId ? Number(b.replacesId) : null;
    for (const k of ['effectiveDate', 'docDate']) if (k in b && !b[k]) b[k] = null;
    if (b.viewLevel === d.viewLevel.code) delete b.viewLevel;
    try { await api(`/api/vanthu/docs/${d.id}`, { method: 'PATCH', body: b }); closeModal(); toast('Đã lưu', 'ok'); done(); }
    catch (error) { modal.querySelector('#veErr').textContent = errorMessage(error); }
  };
}

// Người phê duyệt (sửa C1 / T14): máy chủ tính MỘT tập "hiệu lực" (m.config.approvers — cùng hàm với quyền phê duyệt). Màn này hiện ai đang
// thực sự duyệt và vì sao; người đã lưu nhưng không còn hợp lệ (đã khoá / đổi vai) hiện gạch tên kèm lý do, có ô "giữ" đang tick: Lưu mà không
// đụng tới thì danh sách đã lưu giữ nguyên (không âm thầm xoá ai), bỏ tick thì xoá. Không tự tính lại ở trình duyệt khi đổi ô chọn.
function approverBox(m) {
  const { approvers: a, approverProblems: why, boardUsers } = m.config;
  const valid = new Set(a.stored.filter(x => !x.problems.length).map(x => x.id));
  const stale = a.stored.filter(x => x.problems.length);
  const names = list => list.map(u => esc(u.fullName)).join(', ');
  const empty = a.stored.length ? 'danh sách không còn ai hợp lệ' : 'danh sách trống';
  const reason = { LIST: 'theo danh sách đã lưu', BOARD_ALL: `theo "Toàn công ty" vì ${empty}`, BOARD: `mọi thành viên Ban TGĐ, vì ${empty} và không ai phụ trách "Toàn công ty"` }[a.source];
  return `<div class="field span2" data-testid="vt-c-approver-box"><label for="vtApprovers">Người phê duyệt tài liệu nội bộ <span class="muted xs">(chỉ vai Ban TGĐ; để trống hoặc không còn ai hợp lệ = thành viên Ban TGĐ phụ trách "Toàn công ty"; không ai phụ trách "Toàn công ty" = mọi thành viên Ban TGĐ)</span></label>
      <select id="vtApprovers" name="approverUserIds" multiple size="4" data-testid="vt-c-approvers">${boardUsers.map(u => `<option value="${u.id}"${valid.has(u.id) ? ' selected' : ''}>${esc(u.fullName)}${u.boardAll ? ' · Toàn công ty' : ''}</option>`).join('')}</select>
      ${stale.length ? `<div data-testid="vt-c-stale"><p class="muted xs">Đã lưu nhưng không còn hợp lệ — hệ thống không tính những người này:</p>
        ${stale.map(x => `<label class="check"><input type="checkbox" name="keepApprover" value="${x.id}" checked data-testid="vt-c-keep-${x.id}"><span><s>${esc(x.fullName || `Tài khoản #${x.id}`)}</s> (${esc(x.problems.map(p => why[p] || p).join(', '))}) — giữ tên trong danh sách</span></label>`).join('')}
        <p class="muted xs">Giữ: người đó tự được phê duyệt lại khi tài khoản mở khoá / có lại vai Ban Tổng Giám đốc. Bỏ tick rồi Lưu: xoá khỏi danh sách.</p></div>` : ''}
      ${a.source === 'NONE' ? '<p class="returned-banner" role="alert" data-testid="vt-c-no-approver"><b>Hiện không có Người phê duyệt hợp lệ — dự thảo sẽ không ai duyệt.</b></p>'
        : `<p class="sm" data-testid="vt-c-effective">Đang áp dụng: <b>${names(a.effective)}</b> — ${reason}.</p>`}</div>`;
}

async function renderSettings(root, setCrumbs, m) {
  setCrumbs('<a href="#/vanthu">Văn thư</a> / Thiết lập');
  if (!m.me.director) { root.innerHTML = '<div class="empty">Chỉ Ban Tổng Giám đốc thiết lập văn thư.</div>'; return; }
  const people = (ids, name) => `<select name="${name}" multiple size="6">${store.users.filter(u => !isItUser(u)).map(u => `<option value="${u.id}"${ids.includes(u.id) ? ' selected' : ''}>${esc(u.fullName)}${u.departmentId ? ' · ' + esc(deptName(u.departmentId)) : ''}</option>`).join('')}</select>`;
  root.innerHTML = `<div class="page-head"><h1>Thiết lập văn thư</h1><span class="muted sm">Pháp nhân có dãy số riêng. Văn thư được vào sổ mọi dãy; Pháp chế nhận văn bản có thời hạn pháp lý.</span></div>
    <form class="card pg-section pg-grid" id="vtCfg">
      <label class="field span2">Pháp nhân <span class="muted xs">(mỗi dòng: MÃ · Tên — pháp nhân đầu tiên là công ty mẹ, dãy D6 ký hiệu TGĐ)</span>
        <textarea name="entities" rows="3" data-testid="vt-c-entities">${esc(m.entities.map(e => `${e.code} · ${e.name}`).join('\n'))}</textarea></label>
      <label class="field">Văn thư<br>${people(m.config.clerkUserIds, 'clerkUserIds')}</label>
      <label class="field">Pháp chế<br>${people(m.config.legalUserIds, 'legalUserIds')}</label>
      ${approverBox(m)}
      <p class="error span2" id="vcErr"></p>
      <div class="modal-actions span2"><button class="btn btn-primary" data-testid="vt-c-save">Lưu</button></div></form>`;
  root.querySelector('#vtCfg').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const entities = f.entities.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [code, ...rest] = l.split(/\s*[·\-–|:]\s*/); return { code: (code || '').toUpperCase(), name: rest.join(' - ') }; });
    const sel = n => [...f[n].selectedOptions].map(o => Number(o.value));
    // Người phê duyệt = người chọn trong ô + người không còn hợp lệ mà Ban TGĐ vẫn để tick "giữ".
    const kept = [...f.querySelectorAll('input[name="keepApprover"]:checked')].map(i => Number(i.value));
    try { await api('/api/vanthu/config', { method: 'PUT', body: { entities, clerkUserIds: sel('clerkUserIds'), legalUserIds: sel('legalUserIds'), approverUserIds: [...sel('approverUserIds'), ...kept] } }); await getMeta(true); toast('Đã lưu thiết lập', 'ok'); location.hash = '#/vanthu'; }
    catch (error) { root.querySelector('#vcErr').textContent = errorMessage(error); }
  };
}
