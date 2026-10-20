// Tổng hợp tình hình thực hiện nhiệm vụ được giao — theo phòng chủ trì và theo cán bộ chủ trì (dùng cho giao ban tuần/tháng).
// Ban giám đốc: toàn đơn vị; Trưởng phòng: phòng mình. Xuất Excel cùng bộ lọc (ghi nhật ký, có dấu người xuất).
import { api, download } from '../api.js';
import { store, personLink, deptLink } from '../store.js';
import { icon } from '../icons.js';
import { $, esc, fmtDateTime, toast, errorMessage } from '../util.js';
import { periods, periodSeg, customRange, bindPeriod, describeRange, clearBtn, filterView } from './dashboard.js';

const SUM_KEYS = ['month', 'quarter', 'year'];

export async function renderSummary(root, params, setCrumbs) {
  setCrumbs('Tổng hợp giao việc');
  const view = filterView('summary', root, params, setCrumbs, renderSummary);
  // Kỳ giao việc: mặc định mọi lúc; kỳ nhanh lưu là p=month|quarter|year (tự tính theo ngày hôm nay), tuỳ chọn lưu from/to.
  const P = periods(), key = SUM_KEYS.includes(params.get('p')) ? params.get('p') : (params.get('from') || params.get('to')) ? 'custom' : 'all';
  const from = key === 'custom' ? params.get('from') || '' : key === 'all' ? '' : P[key][1], to = key === 'custom' ? params.get('to') || '' : key === 'all' ? '' : P[key][2];
  const q = new URLSearchParams();
  for (const k of ['departmentId', 'projectId', 'taskType']) if (params.get(k)) q.set(k, params.get(k));
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const d = await api('/api/summary?' + q);
  if (!view.current()) return;
  const showAll = params.get('all') === '1';
  const dirty = key !== 'all' || ['departmentId', 'projectId', 'taskType'].some(k => params.get(k));
  const go = (changes, opts) => view.apply(changes, opts);
  const rangeLabel = key === 'all' ? '' : describeRange(from, to);
  const rate = v => (v == null ? '<span class="muted">—</span>' : `<span class="rate ${v >= 90 ? 'good' : v >= 70 ? 'mid' : 'bad'}">${v}%</span>`);
  const cell = (n, cls = '') => `<td class="num${n && cls ? ' ' + cls : ''}">${n || 0}</td>`;
  const counts = r => `${cell(r.total)}${cell(r.inProgress)}${cell(r.dueSoon, 'due soon')}${cell(r.overdue, 'due overdue')}${cell(r.doneOnTime)}${cell(r.doneLate, 'due soon')}<td class="num">${rate(r.onTimeRate)}</td>`;
  const projects = store.projects.filter(p => d.scope === 'SYSTEM' || p.departmentId === store.me.departmentId);

  // ---- Theo phòng chủ trì ----
  const byDept = d.byDepartment || { rows: [], total: null };
  const deptRows = byDept.rows.filter(r => r.total || showAll);
  const share = (t, label) => (t.total
    ? `<span class="sum-share" title="${label}: ${t.done} hoàn thành / ${t.total} việc"><span class="frac"><b>${t.done}</b>/${t.total}</span><span class="bar-mini"><i style="width:${t.rate}%"></i></span></span>`
    : '<span class="muted">—</span>');
  const deptName = r => (d.scope === 'SYSTEM' && !params.get('departmentId')
    ? `<button type="button" class="sum-link" data-dept="${r.departmentId}" title="Chỉ xem ${esc(r.name)}">${esc(r.name)}</button>` : `<b>${esc(r.name)}</b>`);
  const deptLine = (r, name) => `<td>${name}</td>${counts(r)}<td class="num">${r.pendingAccept ? `<span class="pill warn">${r.pendingAccept}</span>` : '0'}</td><td class="num">${share(r.plan, 'Kế hoạch năm')}</td><td class="num">${share(r.adhoc, 'Đột xuất')}</td>`;
  const deptTable = `<table class="table sum-table" data-testid="summary-dept-table"><thead><tr><th>Phòng chủ trì</th><th class="num">Tổng việc</th><th class="num">Đang thực hiện</th><th class="num">Sắp đến hạn</th><th class="num">Quá hạn</th><th class="num">HT đúng hạn</th><th class="num">HT trễ hạn</th><th class="num">Tỷ lệ đúng hạn</th><th class="num">Chờ phòng tiếp nhận</th><th class="num">Kế hoạch năm<span class="th-sub">hoàn thành / tổng</span></th><th class="num">Đột xuất<span class="th-sub">hoàn thành / tổng</span></th></tr></thead><tbody>
      ${deptRows.map(r => `<tr data-testid="summary-dept-${r.departmentId}">${deptLine(r, deptName(r))}</tr>`).join('') || '<tr><td colspan="11" class="empty">Chưa có việc trong phạm vi.</td></tr>'}
    </tbody>${deptRows.length > 1 && byDept.total ? `<tfoot><tr class="total" data-testid="summary-dept-sum">${deptLine(byDept.total, '<b>Cộng</b>')}</tr></tfoot>` : ''}</table>`;

  // ---- Theo cán bộ chủ trì, có dòng cộng theo phòng ----
  const rows = d.rows.filter(r => r.total || r.supporting || showAll);
  const groups = [];
  for (const r of rows) { const g = groups.at(-1); if (g && g.departmentId === r.departmentId) g.rows.push(r); else groups.push({ departmentId: r.departmentId, rows: [r] }); }
  const subOf = new Map((d.staffSubtotals || []).map(s => [s.departmentId, s]));
  const staffRow = r => `<tr data-testid="summary-${r.userId}"><td><b>${personLink({ id: r.userId, fullName: r.fullName })}</b>${r.title ? `<div class="muted xs">${esc(r.title)}</div>` : ''}</td><td class="muted sm nowrap">${r.departmentId ? deptLink(r.departmentId, r.department || '') : esc(r.department || '')}</td>${counts(r)}${cell(r.supporting)}</tr>`;
  const subRow = s => `<tr class="sum-sub" data-testid="summary-sub-${s.departmentId ?? 'none'}"><td colspan="2">Cộng ${esc(s.name)}</td>${counts(s)}${cell(s.supporting)}</tr>`;
  const staffBody = groups.map(g => g.rows.map(staffRow).join('') + (groups.length > 1 && subOf.get(g.departmentId) ? subRow(subOf.get(g.departmentId)) : '')).join('');

  root.innerHTML = `<div class="page-head" data-st-page="summary"><h1>Tổng hợp tình hình thực hiện nhiệm vụ được giao</h1><span class="muted sm">Tính đến ${fmtDateTime(d.generatedAt)}</span>
      <button class="btn btn-ghost" id="sExport" data-testid="summary-export" title="Xuất Excel theo bộ lọc đang chọn (ghi nhật ký)">${icon('download')}<span>Xuất Excel</span></button></div>
    <div class="filters st-filters" data-testid="summary-filters">
      ${d.scope === 'SYSTEM' ? `<select id="sDept" aria-label="Phòng ban" data-testid="summary-dept"><option value="">Toàn đơn vị</option>${store.departments.filter(x => x.isActive).map(x => `<option value="${x.id}"${String(x.id) === params.get('departmentId') ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : `<span class="pill">${esc(store.me.departmentName || 'Phòng của tôi')}</span>`}
      <select id="sProject" aria-label="Dự án / sổ" data-testid="summary-project"><option value="">Mọi dự án / sổ</option>${projects.map(p => `<option value="${p.id}"${String(p.id) === params.get('projectId') ? ' selected' : ''}>${esc(p.key)} · ${esc(p.name)}</option>`).join('')}</select>
      <select id="sType" aria-label="Loại nhiệm vụ" data-testid="summary-type"><option value="">Mọi loại nhiệm vụ</option><option value="PLAN"${params.get('taskType') === 'PLAN' ? ' selected' : ''}>Kế hoạch năm</option><option value="ADHOC"${params.get('taskType') === 'ADHOC' ? ' selected' : ''}>Đột xuất</option></select>
      <div class="st-field"><span class="st-lbl">Ngày giao</span>${periodSeg({ id: 'sm', P, keys: SUM_KEYS, active: key, label: 'Ngày giao việc', all: 'Mọi lúc', groupTestid: 'summary-period' })}</div>
      ${customRange({ id: 'sm', from, to, show: key === 'custom', apply: 'Lọc' })}
      <span class="st-range muted sm${rangeLabel ? '' : ' hidden'}" id="smMsg" aria-live="polite">${esc(rangeLabel)}</span>
      ${clearBtn(dirty, 'summary-clear')}
      <label class="check sm st-push"><input type="checkbox" id="sAll" ${showAll ? 'checked' : ''}> Hiện cả phòng / cán bộ chưa có việc</label>
    </div>
    <div class="st-body">
    <section class="card sum-section" aria-labelledby="sumDeptH"><div class="sum-head"><h3 id="sumDeptH">Theo phòng chủ trì</h3><span class="muted sm">Phòng của việc = đơn vị chủ trì; việc chưa giao về phòng tính cho phòng sở hữu dự án / sổ.</span></div>
      <div class="tbl-scroll">${deptTable}</div></section>
    <section class="card sum-section" aria-labelledby="sumStaffH"><div class="sum-head"><h3 id="sumStaffH">Theo cán bộ chủ trì</h3></div>
      <div class="tbl-scroll"><table class="table sum-table" data-testid="summary-table"><thead><tr><th>Cán bộ chủ trì</th><th>Phòng ban</th><th class="num">Tổng việc</th><th class="num">Đang thực hiện</th><th class="num">Sắp đến hạn</th><th class="num">Quá hạn</th><th class="num">HT đúng hạn</th><th class="num">HT trễ hạn</th><th class="num">Tỷ lệ đúng hạn</th><th class="num">Số việc phối hợp</th></tr></thead><tbody>
      ${staffBody || '<tr><td colspan="10" class="empty">Chưa có việc được giao.</td></tr>'}
      </tbody><tfoot><tr class="total" data-testid="summary-total"><td><b>TỔNG CỘNG</b></td><td></td>${counts(d.total)}<td></td></tr></tfoot></table></div>
      <p class="muted xs sum-note">Tỷ lệ đúng hạn = HT đúng hạn / (HT đúng hạn + HT trễ hạn). "Sắp đến hạn" = còn 0–${d.dueSoonDays} ngày. "Chờ phòng tiếp nhận" = việc giao về phòng chưa được lãnh đạo phòng tiếp nhận, phân công. Mỗi việc (kể cả việc nhánh) tính một lần cho phòng chủ trì; không tính việc huỷ.
        Ở bảng cán bộ, việc có nhiều người chủ trì được tính cho từng người; dòng "Cộng" của phòng và dòng Tổng cộng tính mỗi việc một lần. Số liệu gồm việc ở mọi dự án và sổ giao việc (kể cả việc Ban Giám đốc giao). Bảng tự tính, mỗi lần xem hoặc xuất được ghi nhật ký.</p></section></div>`;
  $('#sDept', root)?.addEventListener('change', e => go({ departmentId: e.target.value, projectId: '' }));
  $('#sProject', root).onchange = e => go({ projectId: e.target.value });
  $('#sType', root).onchange = e => go({ taskType: e.target.value });
  $('#sAll', root).onchange = e => go({ all: e.target.checked ? '1' : '' });
  $('#summary-clear', root)?.addEventListener('click', () => go({ departmentId: '', projectId: '', taskType: '', p: '', from: '', to: '' }, { focus: '#sm-all' }));
  root.querySelectorAll('button[data-dept]').forEach(b => { b.onclick = () => go({ departmentId: b.dataset.dept, projectId: '' }, { focus: '#sDept' }); });
  bindPeriod(root, 'sm', {
    validate: (f, t) => (!f && !t ? 'Chọn ít nhất một ngày' : f && t && t < f ? 'Ngày kết thúc trước ngày bắt đầu' : ''),
    onPick: k => go({ p: k === 'all' ? '' : k, from: '', to: '' }, { focus: `#sm-${k}` }),
    onApply: (f, t) => go({ p: '', from: f, to: t }, { focus: '#smApply' }),
  });
  $('#sExport', root).onclick = async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const x = new URLSearchParams(q);
      if (showAll) x.set('all', '1');
      const name = await download('/api/summary.xlsx?' + x);
      toast('Đã tải ' + name, 'ok');
    } catch (error) { toast(errorMessage(error), 'err'); } finally { btn.disabled = false; }
  };
}
