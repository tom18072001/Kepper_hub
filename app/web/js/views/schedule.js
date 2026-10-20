// Lịch công tác: lịch tuần của Trung tâm và từng phòng theo mẫu văn bản (nhóm theo ngày: Thời gian | Nội dung | Thành phần |
// Chủ trì | Địa điểm | Ghi chú); "Vắng mặt hôm nay" (đi công tác, họp bên ngoài, nghỉ phép); báo vắng; nhập / xuất Excel; in.
import { api, download } from '../api.js';
import { store } from '../store.js';
import { $, $$, esc, toast, openModal, closeModal, multiSelect, readMulti, bindMulti, errorMessage, confirmDialog, dateInput, uiPref, replaceHashParams } from '../util.js';
import { icon } from '../icons.js';

const DAY = 86_400_000;
const WD = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const utc = k => new Date(k + 'T00:00:00Z');
const key = d => d.toISOString().slice(0, 10);
const mondayOf = k => { const d = utc(k); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY); };
const dm = d => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const REASONS = ['Đi công tác', 'Họp / làm việc bên ngoài', 'Nghỉ phép', 'Nghỉ ốm', 'Học tập, tập huấn', 'Khác'];
const lines = s => esc(s || '').replace(/\n/g, '<br>');
const deptName = id => store.departments.find(d => d.id === id)?.name || '';
const people = () => store.users.filter(u => u.role !== 'admin' && !u.isRootAdmin);

export async function renderSchedule(root, params, setCrumbs) {
  setCrumbs('Lịch công tác');
  const today = dateInput(new Date());
  const at = /^\d{4}-\d{2}-\d{2}$/.test(params.get('at') || '') ? params.get('at') : today;
  const mon = mondayOf(at), sun = new Date(mon.getTime() + 6 * DAY);
  const days = Array.from({ length: 7 }, (_, i) => new Date(mon.getTime() + i * DAY));
  const depts = store.departments.filter(d => d.isActive !== false && d.code !== 'BGD');
  const scopes = [['all', 'Tất cả'], ['centre', 'Trung tâm'], ...depts.map(d => [`dept:${d.id}`, d.name.replace(/^Phòng\s+/, '')]), ['me', 'Của tôi']];
  const scope = scopes.some(([k]) => k === params.get('scope')) ? params.get('scope') : (scopes.some(([k]) => k === uiPref('sch:scope')) ? uiPref('sch:scope') : 'all');
  const range = `from=${key(mon)}&to=${key(sun)}`;
  const inWeek = today >= key(mon) && today <= key(sun);
  const [week, todayRes] = await Promise.all([
    api(`/api/schedule?${range}&scope=${encodeURIComponent(scope)}`),
    inWeek && scope === 'all' ? null : api(`/api/schedule?from=${today}&to=${today}&scope=all`),
  ]);
  const rights = week.rights;
  const canCentre = rights.centre, leadDepts = rights.departments || [];
  const canAdd = canCentre || leadDepts.length > 0;
  const events = week.events;
  const todayEvents = (todayRes || week).events.filter(e => e.date <= today && (e.endDate || e.date) >= today);

  // Vắng mặt hôm nay: thành phần của lịch "ngoài cơ quan" và báo vắng.
  const away = new Map();
  for (const e of todayEvents.filter(x => x.away || x.kind === 'AWAY')) for (const p of e.participants) {
    if (!away.has(p.id)) away.set(p.id, { p, why: [] });
    away.get(p.id).why.push(`${e.kind === 'AWAY' ? e.title : e.title}${e.location ? ' — ' + e.location : ''}${e.timeText && e.timeText !== 'Cả ngày' ? ' (' + e.timeText + ')' : ''}`);
  }
  const awayHtml = `<section class="card sch-away" data-testid="sch-away"><h3>Vắng mặt hôm nay <span class="muted sm">${WD[utc(today).getUTCDay()]}, ${dm(utc(today))}</span> <span class="mw-n">${away.size}</span></h3>
    ${away.size ? `<ul class="sch-away-list">${[...away.values()].sort((a, b) => a.p.fullName.localeCompare(b.p.fullName, 'vi')).map(({ p, why }) => `<li><b>${esc(p.fullName)}</b>${p.departmentId ? ` <span class="muted xs">${esc(deptName(p.departmentId))}</span>` : ''}<span class="muted sm"> · ${esc(why.join('; '))}</span></li>`).join('')}</ul>`
      : '<p class="muted sm">Không có ai báo vắng hay đi công tác hôm nay.</p>'}</section>`;

  const evRow = e => {
    const tag = e.departmentId ? `<span class="pill sch-unit">${esc(deptName(e.departmentId))}</span>` : '';
    const span = e.endDate && e.endDate !== e.date ? `<span class="muted xs"> (${dm(utc(e.date))}–${dm(utc(e.endDate))})</span>` : '';
    return `<tr class="sch-row${e.kind === 'AWAY' ? ' sch-awayrow' : ''}" data-id="${e.id}" data-testid="sch-ev-${e.id}">
      <td class="sch-time">${esc(e.timeText || '')}</td>
      <td class="sch-title"><b>${esc(e.title)}</b>${span} ${tag}${e.kind === 'AWAY' ? ' <span class="pill warn">Vắng</span>' : ''}</td>
      <td class="sch-people">${e.participantsText ? lines(e.participantsText) : e.participants.map(p => esc(p.fullName)).join('<br>')}</td>
      <td class="sch-chair">${lines(e.chairText)}</td>
      <td class="sch-loc">${esc(e.location)}${e.away && e.kind !== 'AWAY' ? ' <span class="pill sch-out" title="Thành phần vắng mặt ở cơ quan">ngoài cơ quan</span>' : ''}</td>
      <td class="sch-note">${lines(e.note)}</td>
      <td class="sch-act no-print">${e.canEdit ? `<button type="button" class="icon-btn" data-edit="${e.id}" aria-label="Sửa mục lịch" title="Sửa">${icon('settings')}</button>` : ''}</td></tr>`;
  };
  const dayBlock = d => {
    const k = key(d);
    const list = events.filter(e => e.date <= k && (e.endDate || e.date) >= k);
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    if (!list.length && weekend) return '';
    return `<tbody class="sch-day${k === today ? ' today' : ''}" data-day="${k}"><tr class="sch-dayhead"><th colspan="7">${WD[d.getUTCDay()]}, ngày ${dm(d)}/${d.getUTCFullYear()}${k === today ? ' <span class="pill">Hôm nay</span>' : ''}
        ${canAdd ? `<button type="button" class="btn btn-ghost btn-sm no-print sch-addday" data-add-day="${k}" aria-label="Thêm lịch ngày ${dm(d)}">${icon('plus')}</button>` : ''}</th></tr>
      ${list.length ? list.map(evRow).join('') : '<tr class="sch-empty"><td colspan="7" class="muted sm">Không có lịch</td></tr>'}</tbody>`;
  };

  root.innerHTML = `<div class="page-head"><h1>Lịch công tác</h1>
      <div class="ph-actions no-print">
        <button class="btn btn-ghost" id="schAway" data-testid="sch-report-away">${icon('send')}Báo vắng / đi công tác</button>
        <details class="ph-more-menu"><summary class="btn btn-ghost" data-testid="ph-more" aria-label="Thao tác khác" title="Nhập / xuất Excel, in">${icon('menu')}<span class="t">Khác</span></summary><div class="ph-menu" role="menu">
        ${canAdd ? `<button class="menu-item" id="schImport" data-testid="sch-import" title="Nhập lịch tuần từ Excel (đúng mẫu văn bản)">${icon('upload')}<span>Nhập</span></button>` : ''}
        <button class="menu-item" id="schExport" data-testid="sch-export" title="Xuất lịch tuần ra Excel">${icon('download')}<span>Xuất Excel</span></button>
        <button class="menu-item" id="schPrint" title="In lịch tuần">${icon('file')}<span>In</span></button></div></details>
        ${canAdd ? `<button class="btn btn-primary" id="schAdd" data-testid="sch-add">${icon('plus')}Thêm lịch</button>` : ''}
      </div></div>
    ${awayHtml}
    <div class="row nav-row sch-nav no-print">
      <span class="btn-group"><button type="button" class="btn btn-ghost btn-sm" data-week="${key(new Date(mon.getTime() - 7 * DAY))}" aria-label="Tuần trước" title="Tuần trước">${icon('left')}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-week="">Tuần này</button><button type="button" class="btn btn-ghost btn-sm" data-week="${key(new Date(mon.getTime() + 7 * DAY))}" aria-label="Tuần sau" title="Tuần sau">${icon('right')}</button></span>
      <span class="seg" role="group" aria-label="Phạm vi lịch">${scopes.map(([k, label]) => `<button type="button" data-scope="${esc(k)}" class="${k === scope ? 'on' : ''}" aria-pressed="${k === scope}" data-testid="sch-scope-${esc(k.replace(':', '-'))}">${esc(label)}</button>`).join('')}</span>
    </div>
    <div class="card sch-card">
      <h2 class="sch-title-print" data-testid="sch-week-title">LỊCH CÔNG TÁC TUẦN <span class="muted">(Từ ngày ${dm(mon)} đến ngày ${dm(sun)}/${sun.getUTCFullYear()})</span>${scope !== 'all' ? ` — ${esc(scopes.find(s => s[0] === scope)[1])}` : ''}</h2>
      <div class="tbl-scroll"><table class="table sch-table" data-testid="sch-table">
        <thead><tr><th class="sch-time">Thời gian</th><th>Nội dung</th><th>Thành phần</th><th>Chủ trì</th><th>Địa điểm</th><th>Ghi chú</th><th class="no-print" aria-label="Thao tác"></th></tr></thead>
        ${days.map(dayBlock).join('')}
      </table></div>
      ${!events.length ? `<p class="muted sm sch-none">Tuần này chưa có lịch${scope !== 'all' ? ' trong phạm vi đã chọn' : ''}.${canAdd ? ' Bấm "Thêm lịch" hoặc "Nhập" để đưa lịch tuần từ Excel vào.' : ''}</p>` : ''}
    </div>`;

  const reload = () => renderSchedule(root, new URLSearchParams(location.hash.split('?')[1] || ''), setCrumbs);
  root.onclick = async e => {
    const w = e.target.closest('[data-week]');
    if (w) { replaceHashParams({ at: w.dataset.week || null }); return reload(); }
    const sc = e.target.closest('[data-scope]');
    if (sc) { uiPref('sch:scope', sc.dataset.scope === 'all' ? null : sc.dataset.scope); replaceHashParams({ scope: sc.dataset.scope === 'all' ? null : sc.dataset.scope }); return reload(); }
    if (e.target.closest('#schAdd')) return eventDialog({ date: at < key(mon) || at > key(sun) ? key(mon) : at }, rights, reload);
    const ad = e.target.closest('[data-add-day]'); if (ad) return eventDialog({ date: ad.dataset.addDay }, rights, reload);
    const ed = e.target.closest('[data-edit]'); if (ed) return eventDialog(events.find(x => x.id === Number(ed.dataset.edit)), rights, reload);
    if (e.target.closest('#schAway')) return awayDialog(rights, reload);
    if (e.target.closest('#schImport')) return importDialog(rights, reload);
    if (e.target.closest('#schExport')) { try { await download(`/api/schedule/export.xlsx?${range}&scope=${encodeURIComponent(scope)}`); } catch (error) { toast(errorMessage(error), 'err'); } return; }
    if (e.target.closest('#schPrint')) window.print();
  };
  root.onchange = null; root.oninput = null; root.onkeydown = null;
}

// Phạm vi lịch được sửa: Trung tâm (BGĐ, Văn phòng) và / hoặc các phòng mình lãnh đạo.
function unitOptions(rights, selected) {
  const opts = [];
  if (rights.centre) opts.push(['', 'Lịch Trung tâm']);
  for (const d of store.departments.filter(x => x.isActive !== false && x.code !== 'BGD' && (rights.centre || (rights.departments || []).includes(x.id)))) opts.push([String(d.id), `Lịch ${d.name}`]);
  return opts.map(([v, l]) => `<option value="${v}"${String(selected ?? '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
}

function eventDialog(ev, rights, done) {
  const isNew = !ev.id;
  const modal = openModal(`<h2>${isNew ? 'Thêm lịch công tác' : 'Sửa lịch công tác'}</h2><form id="schForm">
    <div class="grid2"><label class="field">Ngày<input type="date" name="date" required value="${esc(ev.date || '')}" data-testid="sch-date"></label>
      <label class="field">Đến ngày <span class="muted xs">(nhiều ngày)</span><input type="date" name="endDate" value="${esc(ev.endDate || '')}"></label></div>
    <div class="grid2"><label class="field">Thời gian<input name="timeText" maxlength="60" placeholder="VD: 08h30 · 09h30 - 11h30 · Cả ngày" value="${esc(ev.timeText || '')}" data-testid="sch-time"></label>
      <label class="field">Thuộc lịch<select name="departmentId" data-testid="sch-unit">${unitOptions(rights, ev.departmentId)}</select></label></div>
    <label class="field">Nội dung<textarea name="title" rows="2" required maxlength="500" data-testid="sch-title">${esc(ev.title || '')}</textarea></label>
    <div class="field">Thành phần (có tài khoản — sẽ nhận thông báo)${multiSelect('schPeople', people().map(u => ({ id: u.id, label: u.fullName })), (ev.participants || []).map(p => p.id), 'Chọn người')}</div>
    <label class="field">Thành phần ghi trên lịch <span class="muted xs">(mỗi dòng một người / đơn vị; bỏ trống = dùng danh sách trên)</span><textarea name="participantsText" rows="3" maxlength="2000" placeholder="- Đ/c …&#10;- Tập thể phòng …">${esc(ev.participantsText || '')}</textarea></label>
    <div class="grid2"><label class="field">Chủ trì<input name="chairText" maxlength="300" value="${esc(ev.chairText || '')}"></label>
      <label class="field">Địa điểm<input name="location" maxlength="300" value="${esc(ev.location || '')}" data-testid="sch-location"></label></div>
    <label class="field">Ghi chú<input name="note" maxlength="1000" value="${esc(ev.note || '')}"></label>
    <label class="check"><input type="checkbox" name="away"${ev.away ? ' checked' : ''} data-testid="sch-away-flag"> Ngoài cơ quan — thành phần vắng mặt ở cơ quan (hiện ở "Vắng mặt hôm nay")</label>
    <p class="error" id="schErr"></p>
    <div class="modal-actions">${!isNew ? '<button type="button" class="btn btn-danger btn-ghost" data-del>Xoá</button>' : ''}<span class="grow"></span><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="sch-save">${isNew ? 'Thêm' : 'Lưu'}</button></div></form>`, { wide: true });
  bindMulti(modal, () => {});
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Xoá mục lịch "${ev.title}"? Thành phần sẽ nhận thông báo huỷ.`, { okText: 'Xoá', danger: true }))) return;
    try { await api(`/api/schedule/${ev.id}`, { method: 'DELETE' }); toast('Đã xoá mục lịch', 'ok'); done(); } catch (error) { toast(errorMessage(error), 'err'); }
  });
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const body = { date: f.date.value, endDate: f.endDate.value || null, timeText: f.timeText.value, departmentId: f.departmentId.value || null, title: f.title.value, participantIds: readMulti(modal, 'schPeople'),
      participantsText: f.participantsText.value, chairText: f.chairText.value, location: f.location.value, note: f.note.value, away: f.away.checked, kind: ev.kind === 'AWAY' ? 'AWAY' : 'EVENT' };
    try {
      await api(isNew ? '/api/schedule' : `/api/schedule/${ev.id}`, { method: isNew ? 'POST' : 'PUT', body });
      closeModal(); toast(isNew ? 'Đã thêm vào lịch công tác' : 'Đã lưu', 'ok'); done();
    } catch (error) { $('#schErr', modal).textContent = errorMessage(error); }
  };
}

// Báo vắng: mỗi người cho mình; lãnh đạo phòng cho cán bộ trong phòng; BGĐ / Văn phòng cho bất kỳ ai.
function awayDialog(rights, done) {
  const me = store.me;
  const pickable = people().filter(u => u.id === me.id || rights.centre || (u.departmentId && (rights.departments || []).includes(u.departmentId)));
  const today = dateInput(new Date());
  const modal = openModal(`<h2>Báo vắng / đi công tác</h2><form>
    ${pickable.length > 1 ? `<div class="field">Người vắng${multiSelect('awayPeople', pickable.map(u => ({ id: u.id, label: u.fullName })), [me.id], 'Chọn người')}</div>` : ''}
    <div class="grid2"><label class="field">Từ ngày<input type="date" name="date" required value="${today}" data-testid="away-date"></label><label class="field">Đến ngày<input type="date" name="endDate" value=""></label></div>
    <div class="grid2"><label class="field">Lý do<select name="reason" data-testid="away-reason">${REASONS.map(r => `<option>${r}</option>`).join('')}</select></label>
      <label class="field">Thời gian<input name="timeText" maxlength="60" value="Cả ngày" placeholder="Cả ngày · Sáng · Chiều"></label></div>
    <div class="grid2"><label class="field">Nơi đến / nội dung<input name="location" maxlength="300" placeholder="VD: TP. Hồ Chí Minh — khảo sát địa điểm" data-testid="away-location"></label><label class="field">Ghi chú<input name="note" maxlength="1000"></label></div>
    <p class="muted xs">Hiện ở "Vắng mặt hôm nay" và trên lịch tuần. Không ghi lý do sức khoẻ chi tiết — chỉ cần "Nghỉ ốm".</p>
    <p class="error" id="awayErr"></p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-testid="away-save">Báo vắng</button></div></form>`);
  bindMulti(modal, () => {});
  modal.querySelector('[data-close]').onclick = () => closeModal();
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const ids = pickable.length > 1 ? readMulti(modal, 'awayPeople') : [me.id];
    if (!ids.length) { $('#awayErr', modal).textContent = 'Chọn ít nhất một người'; return; }
    try {
      await api('/api/schedule', { method: 'POST', body: { kind: 'AWAY', date: f.date.value, endDate: f.endDate.value || null, title: f.reason.value, timeText: f.timeText.value, location: f.location.value, note: f.note.value, participantIds: ids,
        participantsText: ids.map(id => store.users.find(u => u.id === id)?.fullName || '').filter(Boolean).join('\n') } });
      closeModal(); toast('Đã báo vắng', 'ok'); done();
    } catch (error) { $('#awayErr', modal).textContent = errorMessage(error); }
  };
}

// Nhập lịch tuần từ Excel đúng mẫu văn bản: xem trước (số mục, khoảng ngày, tên chưa khớp tài khoản) rồi mới ghi.
function importDialog(rights, done) {
  const modal = openModal(`<h2>Nhập lịch công tác từ Excel</h2><form>
    <p class="muted sm">Dùng đúng mẫu lịch tuần: dòng tiêu đề <b>Thời gian | Nội dung | Thành phần | Chủ trì | Địa điểm | Ghi chú</b>, mỗi ngày bắt đầu bằng dòng <b>"Thứ Hai, ngày 12/10/2026"</b>. Tệp có nhiều trang tính (Tuần 1, Tuần 2…) thì nhập tất cả. Nhập lại cùng tuần sẽ thay lịch đã nhập trước đó.</p>
    <div class="grid2"><label class="field">Tệp .xlsx<input type="file" name="file" accept=".xlsx" required data-testid="sch-import-file"></label>
      <label class="field">Vào lịch<select name="departmentId">${unitOptions(rights, '')}</select></label></div>
    <div id="schPreview"></div><p class="error" id="impErr"></p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Huỷ</button><button type="button" class="btn" data-dry data-testid="sch-import-preview">Xem trước</button><button class="btn btn-primary" data-testid="sch-import-go" disabled>Nhập</button></div></form>`, { wide: true });
  const form = modal.querySelector('form');
  const send = dry => { const fd = new FormData(form); if (dry) fd.set('dryRun', '1'); return api('/api/schedule/import', { method: 'POST', form: fd }); };
  modal.querySelector('[data-close]').onclick = () => closeModal();
  form.file.onchange = () => { $('[data-testid="sch-import-go"]', modal).disabled = true; $('#schPreview', modal).innerHTML = ''; };
  modal.querySelector('[data-dry]').onclick = async () => {
    if (!form.file.files.length) { $('#impErr', modal).textContent = 'Chọn tệp Excel'; return; }
    $('#impErr', modal).textContent = '';
    try {
      const p = await send(true);
      $('#schPreview', modal).innerHTML = `<div class="card sch-preview" data-testid="sch-import-summary"><p><b>${p.count}</b> mục lịch từ ${esc(p.from)} đến ${esc(p.to)}${p.replace ? ` · thay <b>${p.replace}</b> mục đã nhập trước đó` : ''}. ${p.outside ? `<b>${p.outside}</b> mục ở ngoài cơ quan (theo địa điểm) — thành phần sẽ hiện ở "Vắng mặt"; sửa được từng mục.` : ''}</p>
        ${p.unmatched.length ? `<p class="muted sm">Chưa khớp tài khoản (vẫn ghi trên lịch, chỉ không gửi thông báo): ${p.unmatched.map(esc).join(', ')}</p>` : ''}
        ${p.warnings.length ? `<p class="muted sm">${p.warnings.map(esc).join('<br>')}</p>` : ''}
        <ul class="muted sm">${p.sample.map(s => `<li>${esc(s.date)} ${esc(s.timeText)} — ${esc(s.title.slice(0, 80))}</li>`).join('')}</ul></div>`;
      $('[data-testid="sch-import-go"]', modal).disabled = false;
    } catch (error) { $('#impErr', modal).textContent = errorMessage(error); }
  };
  form.onsubmit = async e => {
    e.preventDefault();
    try { const r = await send(false); closeModal(); toast(`Đã nhập ${r.count} mục lịch`, 'ok'); replaceHashParams({ at: r.from }); done(); }
    catch (error) { $('#impErr', modal).textContent = errorMessage(error); }
  };
}
