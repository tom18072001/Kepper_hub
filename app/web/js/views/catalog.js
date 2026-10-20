// Danh mục dùng chung: nguồn giao việc, ngưỡng "sắp đến hạn", trọng số KPI, mẫu nhóm việc (vd. "Nhiệm vụ chuẩn – Cuộc thi/Hội thi").
// Thiết lập: Ban giám đốc / quản trị. Mẫu nhóm việc: lãnh đạo phòng (quản lý dự án) tạo được và sửa mẫu của mình.
import { api } from '../api.js';
import { store } from '../store.js';
import { $, $$, esc, toast, errorMessage, confirmDialog } from '../util.js';

const WEIGHTS = [['onTime', 'Đúng hạn'], ['rating', 'Xếp loại'], ['volume', 'Khối lượng']];

export async function renderCatalog(root, setCrumbs) {
  setCrumbs('Danh mục');
  const [settings, templates] = await Promise.all([api('/api/settings'), api('/api/templates')]);
  Object.assign(store, { settings, templates });
  const ro = settings.canEdit ? '' : 'disabled';
  const w = settings.kpiWeights || { onTime: 40, rating: 40, volume: 20 };
  const tplCard = t => {
    const editable = t.id ? !!t.canEdit : !!settings.canCreateTemplate;
    const tro = editable ? '' : 'disabled';
    const owner = t.id ? (t.createdByName ? `Mẫu của ${esc(t.createdByName)}` : 'Mẫu dùng chung') : 'Mẫu mới';
    return `<div class="card tpl-card" data-tpl="${t.id ?? ''}"><div class="row"><input name="name" value="${esc(t.name || '')}" placeholder="Tên mẫu" class="grow" ${tro} aria-label="Tên mẫu" data-testid="tpl-name">
        ${editable ? `<button class="btn btn-primary btn-sm" data-save-tpl>Lưu mẫu</button>${t.id ? '<button class="btn btn-ghost btn-sm" data-del-tpl>Xoá</button>' : ''}` : ''}</div>
      <div class="muted xs tpl-owner">${owner}${t.id && !editable ? (t.createdById ? ' · chỉ người tạo, Ban giám đốc hoặc quản trị được sửa' : ' · chỉ Ban giám đốc hoặc quản trị được sửa') : ''}</div>
      <div class="tbl-scroll"><table class="table tpl-table"><thead><tr><th class="num">#</th><th>Việc nhánh · sản phẩm đầu ra</th><th>Hạn so với ngày mốc</th>${editable ? '<th><span class="sr-only">Thao tác</span></th>' : ''}</tr></thead><tbody>
        ${(t.items || []).map((i, k) => tplRow(i, k, tro)).join('')}</tbody></table></div>
      ${editable ? '<button class="btn btn-ghost btn-sm" data-add-row>+ Thêm việc nhánh</button>' : ''}</div>`;
  };
  const notice = settings.canEdit ? '' : `<span class="muted sm">${settings.canCreateTemplate ? 'Thiết lập do Ban giám đốc hoặc quản trị sửa. Bạn tạo được mẫu nhóm việc và sửa mẫu của mình.' : 'Chỉ Ban giám đốc hoặc quản trị được sửa.'}</span>`;
  root.innerHTML = `<div class="page-head"><h1>Danh mục dùng chung</h1>${notice}</div>
    <div class="dash-grid catalog-grid">
      <form class="card" id="setForm"><h3>Thiết lập</h3>
        <label class="field">Số ngày cảnh báo "Sắp đến hạn"<input type="number" name="dueSoonDays" min="0" max="30" value="${settings.dueSoonDays}" ${ro} style="max-width:140px" data-testid="due-soon-days"></label>
        <label class="field">Nguồn giao việc <span class="muted xs">(mỗi dòng một nguồn)</span><textarea name="sources" rows="7" ${ro} data-testid="sources">${esc(settings.sources.join('\n'))}</textarea></label>
        <fieldset class="kpi-weights" data-testid="kpi-weights"><legend>Trọng số điểm KPI tổng hợp (%)</legend>
          <div class="kw-grid">${WEIGHTS.map(([k, label]) => `<label class="field">${label}<input type="number" name="w_${k}" min="0" max="100" step="1" value="${Number(w[k]) || 0}" ${ro} data-testid="kpi-w-${k}"></label>`).join('')}</div>
          <p class="kw-sum sm" id="kwSum" aria-live="polite"></p>
          <div class="kw-formula sm">
            <p><b>Điểm tổng hợp (0–100)</b> = Đúng hạn × <span data-w="onTime"></span> + Xếp loại × <span data-w="rating"></span> + Khối lượng × <span data-w="volume"></span></p>
            <ul>
              <li><b>Đúng hạn</b>: tỷ lệ việc hoàn thành đúng hạn trong kỳ (%), tính theo hạn đã được người giao duyệt — gia hạn được duyệt không bị tính trễ.</li>
              <li><b>Xếp loại</b>: điểm xếp loại bình quân khi nghiệm thu, quy về thang 100 (Hoàn thành xuất sắc cao nhất, Không hoàn thành thấp nhất).</li>
              <li><b>Khối lượng</b>: số việc chủ trì đã hoàn thành trong kỳ so với người (phòng) nhiều nhất cùng phạm vi, quy về thang 100.</li>
            </ul>
            <p class="muted" id="kwExample"></p>
            <p class="muted xs">Ba trọng số là số nguyên, tổng bằng 100. Điểm và cách quy đổi chi tiết hiển thị ở màn hình KPI; KPI chỉ dùng làm căn cứ đánh giá chính thức sau khi đã thông báo cho người lao động.</p>
          </div>
        </fieldset>
        ${settings.canEdit ? '<button class="btn btn-primary" data-testid="save-settings">Lưu thiết lập</button>' : ''}</form>
      <div><h3 class="tpl-title">Mẫu nhóm việc</h3>
        <p class="muted sm tpl-help">Trong chi tiết một nhóm việc, chọn "Tạo việc nhánh từ mẫu" để sinh sẵn các việc nhánh và sản phẩm đầu ra. Đặt hạn từng việc so với <b>ngày mốc</b> (vd. ngày tổ chức Hội thi):
          khi áp mẫu nhập ngày mốc, hạn = ngày mốc trước / sau N ngày, không muộn hơn hạn của nhóm việc. Việc không đặt thì lấy hạn của nhóm việc.</p>
        <div id="tpls">${templates.map(tplCard).join('')}</div>${settings.canCreateTemplate ? '<button class="btn btn-ghost" id="addTpl" data-testid="add-template">+ Thêm mẫu</button>' : ''}</div>
    </div>`;

  const form = $('#setForm', root);
  const weights = () => Object.fromEntries(WEIGHTS.map(([k]) => [k, Number(form[`w_${k}`].value)]));
  const showWeights = () => {
    const v = weights(), sum = v.onTime + v.rating + v.volume, ok = sum === 100 && Object.values(v).every(x => Number.isInteger(x) && x >= 0);
    const el = $('#kwSum', root);
    el.textContent = ok ? `Tổng: ${sum}%` : `Tổng: ${Number.isFinite(sum) ? sum : '?'}% — cần đúng 100% (số nguyên)`;
    el.className = 'kw-sum sm ' + (ok ? 'ok' : 'bad');
    for (const s of $$('[data-w]', root)) s.textContent = `${Number.isFinite(v[s.dataset.w]) ? v[s.dataset.w] : 0}%`;
    const ex = Math.round((90 * v.onTime + 80 * v.rating + 50 * v.volume) / 100);
    $('#kwExample', root).textContent = `Ví dụ: đúng hạn 90%, xếp loại 80 điểm, khối lượng 50 điểm → 90 × ${v.onTime}% + 80 × ${v.rating}% + 50 × ${v.volume}% ≈ ${Number.isFinite(ex) ? ex : '?'} điểm.`;
    return ok;
  };
  showWeights();
  form.addEventListener('input', e => { if (e.target.name?.startsWith('w_')) showWeights(); });
  form.onsubmit = async e => {
    e.preventDefault();
    if (!showWeights()) { toast('Trọng số KPI phải là số nguyên, tổng bằng 100%', 'err'); return; }
    try {
      store.settings = await api('/api/settings', { method: 'PUT', body: { dueSoonDays: Number(form.dueSoonDays.value), sources: form.sources.value.split('\n').map(s => s.trim()).filter(Boolean), kpiWeights: weights() } });
      toast('Đã lưu thiết lập', 'ok');
    } catch (error) { toast(errorMessage(error), 'err'); }
  };
  root.onchange = e => {
    const dir = e.target.closest('[name=offDir]');
    if (dir) syncOffset(dir.closest('tr'));
  };
  root.onclick = async e => {
    const card = e.target.closest('[data-tpl]');
    if (e.target.closest('#addTpl')) { $('#tpls', root).insertAdjacentHTML('beforeend', tplCard({ name: '', items: [{ title: '', deliverable: '' }] })); $('#tpls', root).lastElementChild.querySelector('[name=name]').focus(); return; }
    if (!card) return;
    if (e.target.closest('[data-add-row]')) { const tb = card.querySelector('tbody'); tb.insertAdjacentHTML('beforeend', tplRow({}, tb.children.length, '')); tb.lastElementChild.querySelector('[name=title]').focus(); return; }
    if (e.target.closest('[data-del-row]')) { e.target.closest('tr').remove(); renumber(card); return; }
    if (e.target.closest('[data-del-tpl]')) {
      if (!(await confirmDialog('Xoá mẫu này? Các việc đã tạo từ mẫu không bị ảnh hưởng.', { danger: true, okText: 'Xoá' }))) return;
      try { await api(`/api/templates/${card.dataset.tpl}`, { method: 'DELETE' }); toast('Đã xoá mẫu', 'ok'); } catch (error) { toast(errorMessage(error), 'err'); }
      return renderCatalog(root, setCrumbs);
    }
    if (e.target.closest('[data-save-tpl]')) {
      let bad = null;
      const items = $$('tbody tr', card).map(tr => {
        const item = { title: tr.querySelector('[name=title]').value, deliverable: tr.querySelector('[name=deliverable]').value };
        const off = offsetOf(tr);
        if (off === false) bad = bad || item.title || 'việc nhánh';
        else if (off !== null) item.offsetDays = off;
        return item;
      }).filter(i => i.title.trim());
      if (bad) { toast(`"${bad}": số ngày so với ngày mốc phải là số nguyên từ 0 đến 3650`, 'err'); return; }
      const body = { name: card.querySelector('[name=name]').value, items };
      try { await api(card.dataset.tpl ? `/api/templates/${card.dataset.tpl}` : '/api/templates', { method: card.dataset.tpl ? 'PUT' : 'POST', body }); toast('Đã lưu mẫu', 'ok'); }
      catch (error) { toast(errorMessage(error), 'err'); return; }
      return renderCatalog(root, setCrumbs);
    }
  };
}

// Hạn tương đối của một việc trong mẫu: null = theo hạn nhóm việc; số nguyên (âm = trước ngày mốc); false = nhập sai.
function offsetOf(tr) {
  const dir = tr.querySelector('[name=offDir]').value;
  if (!dir) return null;
  if (dir === 'on') return 0;
  const raw = tr.querySelector('[name=offN]').value.trim();
  const n = Number(raw);
  if (raw === '' || !Number.isInteger(n) || n < 0 || n > 3650) return false;
  return dir === 'before' ? -n : n;
}
function syncOffset(tr) {
  const dir = tr.querySelector('[name=offDir]').value, n = tr.querySelector('[name=offN]');
  const need = dir === 'before' || dir === 'after';
  n.disabled = !need || tr.querySelector('[name=offDir]').disabled;
  n.closest('.offset-n').classList.toggle('hidden', !need);
  if (need && !n.value) n.value = '7';
}
function renumber(card) { $$('tbody tr', card).forEach((tr, k) => { tr.querySelector('td.num').textContent = k + 1; }); }
function tplRow(i, k, ro) {
  const off = Number.isInteger(i.offsetDays) ? i.offsetDays : null;
  const dir = off == null ? '' : off < 0 ? 'before' : off > 0 ? 'after' : 'on';
  const need = dir === 'before' || dir === 'after';
  const opt = (v, label) => `<option value="${v}"${dir === v ? ' selected' : ''}>${label}</option>`;
  return `<tr><td class="num">${k + 1}</td><td class="tpl-main"><input name="title" value="${esc(i.title || '')}" ${ro} placeholder="Tên việc nhánh" aria-label="Việc nhánh">
      <input name="deliverable" value="${esc(i.deliverable || '')}" ${ro} placeholder="Sản phẩm đầu ra" aria-label="Sản phẩm đầu ra" class="tpl-deliv"></td>
    <td class="tpl-off"><div class="offset-edit"><select name="offDir" ${ro} aria-label="Hạn so với ngày mốc" data-testid="tpl-offset-dir">${opt('', 'Theo hạn nhóm việc')}${opt('before', 'Trước ngày mốc')}${opt('on', 'Đúng ngày mốc')}${opt('after', 'Sau ngày mốc')}</select>
      <span class="offset-n${need ? '' : ' hidden'}"><input type="number" name="offN" min="0" max="3650" step="1" value="${off == null || off === 0 ? '' : Math.abs(off)}" ${ro || (need ? '' : 'disabled')} aria-label="Số ngày" data-testid="tpl-offset-days"><span class="muted sm">ngày</span></span></div></td>
    ${ro ? '' : '<td class="actions"><button type="button" class="btn btn-ghost btn-sm" data-del-row>Bỏ</button></td>'}</tr>`;
}
