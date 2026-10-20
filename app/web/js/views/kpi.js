// KPI theo phòng ban và theo cá nhân (chỉ Ban giám đốc): đúng hạn, Kế hoạch năm / Đột xuất, xếp loại, điểm tổng hợp.
// Số liệu tham khảo, chưa gắn lương thưởng.
import { api } from '../api.js';
import { store, personLink } from '../store.js';
import { $, esc, fmtDate } from '../util.js';
import { periods, periodSeg, customRange, bindPeriod, daysBetween, clearBtn, filterView } from './dashboard.js';

const KPI_KEYS = ['month', 'lastMonth', 'quarter', 'year'];
const KPI_MAX_DAYS = 400; // máy chủ nhận tối đa ~13 tháng
const dash = '<span class="muted">—</span>';
const rate = v => v == null ? dash : `<span class="rate ${v >= 90 ? 'good' : v >= 70 ? 'mid' : 'bad'}">${v}%</span>`;
const score = (v, c) => v == null ? dash
  : `<span class="rate st-score ${v >= 85 ? 'good' : v >= 70 ? 'mid' : 'bad'}" title="Đúng hạn ${c?.onTime ?? '—'} · Xếp loại ${c?.rating ?? '—'} · Khối lượng ${c?.volume ?? '—'}">${v}</span>`;
const num = v => v == null ? dash : v;
const bad = v => v ? `<span class="due overdue">${v}</span>` : 0;
// Thứ tự cột dùng chung cho bảng phòng và bảng cá nhân.
const GROUPS = [
  ['Đúng hạn', [['Đến hạn', r => num(r.dueInPeriod)], ['Đúng', r => num(r.onTime)], ['Trễ', r => bad(r.late)], ['Tỷ lệ', r => rate(r.onTimeRate)]]],
  ['Kế hoạch năm', [['Đến hạn', r => num(r.plan.total)], ['HT', r => num(r.plan.completed)], ['%', r => (r.plan.total ? `${r.plan.rate}%` : dash)]]],
  ['Đột xuất', [['Giao', r => num(r.adhoc.assigned)], ['HT', r => num(r.adhoc.completed)], ['Đúng hạn', r => num(r.adhoc.onTime)]]],
  ['Xếp loại', [['Số việc', r => num(r.rated)], ['Điểm TB', r => num(r.ratingAvg)]]],
  ['Khác', [['HT trong kỳ', r => num(r.completed)], ['Ngày xử lý TB', r => num(r.avgDays)], ['Đang quá hạn', r => bad(r.overdueNow)], ['Bị trả lại', r => num(r.rejections)]]],
];
const head = lead => `<thead><tr>${lead.map(t => `<th rowspan="2" class="${t === 'Điểm tổng hợp' ? 'num' : ''}">${t}</th>`).join('')}${GROUPS.map(([g, cols]) => `<th colspan="${cols.length}" class="st-group">${g}</th>`).join('')}</tr>
  <tr>${GROUPS.map(([, cols]) => cols.map(([c], k) => `<th class="num${k === 0 ? ' st-sep' : ''}">${c}</th>`).join('')).join('')}</tr></thead>`;
const cells = r => GROUPS.map(([, cols]) => cols.map(([, f], k) => `<td class="num${k === 0 ? ' st-sep' : ''}">${f(r)}</td>`).join('')).join('');

function formula(d) {
  const w = d.weights || { onTime: 40, rating: 40, volume: 20 }, p = d.ratingPoints || { EXCELLENT: 100, GOOD: 85, PASS: 70, FAIL: 0 };
  return `<div class="card st-formula" data-testid="kpi-formula"><h3>Cách tính điểm tổng hợp</h3>
    <p class="st-eq">Điểm = (<b>${w.onTime}</b> × Đúng hạn + <b>${w.rating}</b> × Xếp loại + <b>${w.volume}</b> × Khối lượng) ÷ ${w.onTime + w.rating + w.volume}</p>
    <ul class="st-terms">
      <li><b>Đúng hạn</b>: % việc hoàn thành trước hết ngày hạn, trong số việc có hạn trong kỳ đã tới hạn hoặc đã xong.</li>
      <li><b>Xếp loại</b>: điểm bình quân của việc được xếp loại trong kỳ — Xuất sắc ${p.EXCELLENT} · Tốt ${p.GOOD} · Hoàn thành ${p.PASS} · Không hoàn thành ${p.FAIL}.</li>
      <li><b>Khối lượng</b>: cá nhân = min(100, việc hoàn thành trong kỳ ÷ bình quân của cán bộ cùng phòng × 100), chỉ tính khi phòng có từ ${d.minPeers ?? 3} cán bộ có số liệu; phòng = việc hoàn thành bình quân mỗi cán bộ so với bình quân các phòng.</li>
      <li>Thành phần không có dữ liệu được bỏ qua, trọng số chia lại cho các thành phần còn lại; chưa có số liệu đúng hạn lẫn xếp loại thì chưa chấm điểm (—). Trọng số chỉnh ở <a href="#/catalog">Danh mục</a>.</li>
    </ul></div>`;
}

export async function renderKpi(root, params, setCrumbs) {
  setCrumbs('KPI');
  const view = filterView('kpi', root, params, setCrumbs, renderKpi);
  const P = periods(), key = KPI_KEYS.includes(params.get('p')) ? params.get('p') : (params.get('from') ? 'custom' : 'month');
  const from = key === 'custom' ? params.get('from') : P[key][1], to = key === 'custom' ? (params.get('to') || params.get('from')) : P[key][2];
  const dept = params.get('departmentId') || '';
  const q = new URLSearchParams({ from, to }); if (dept) q.set('departmentId', dept);
  const d = await api('/api/kpi?' + q);
  if (!view.current()) return;
  const t = d.total, deptName = dept ? store.departments.find(x => String(x.id) === dept)?.name || '' : '';
  root.innerHTML = `<div class="page-head" data-st-page="kpi"><h1>KPI phòng ban &amp; cá nhân</h1>
      <span class="muted sm" data-testid="kpi-range">Kỳ ${fmtDate(d.from)} – ${fmtDate(d.to)}${deptName ? ` · ${esc(deptName)}` : ''}</span></div>
    <div class="filters st-filters" data-testid="kpi-filters">
      <div class="st-field"><span class="st-lbl" id="kpLbl">Kỳ</span>${periodSeg({ id: 'kp', P, keys: KPI_KEYS, active: key, label: 'Kỳ', testid: k => (k === 'custom' ? 'kpi-custom' : `kpi-${k}`) })}</div>
      ${customRange({ id: 'kp', from, to, show: key === 'custom', apply: 'Xem' })}
      <span class="st-range muted sm${key === 'custom' ? '' : ' hidden'}" id="kpMsg" aria-live="polite"></span>
      <label class="st-field"><span class="st-lbl">Phòng ban</span><select id="kDept" data-testid="kpi-dept"><option value="">Mọi phòng ban</option>${store.departments.filter(x => x.isActive).map(x => `<option value="${x.id}"${String(x.id) === dept ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      ${clearBtn(key !== 'month' || !!dept, 'kpi-clear')}
    </div>
    <div class="st-body">
    <div class="kpis">
      <div class="kpi"><div class="v" data-testid="kpi-rate">${t.onTimeRate ?? '—'}${t.onTimeRate != null ? '%' : ''}</div><div class="l">Tỷ lệ đúng hạn (${t.onTime}/${t.judged} việc đã tới hạn)</div></div>
      <div class="kpi"><div class="v" data-testid="kpi-plan">${t.plan.total ? `${t.plan.rate}%` : '—'}</div><div class="l">Kế hoạch năm: ${t.plan.completed}/${t.plan.total} nhiệm vụ đến hạn trong kỳ đã xong</div></div>
      <div class="kpi"><div class="v" data-testid="kpi-adhoc">${t.adhoc.completed}<span class="st-of">/${t.adhoc.assigned}</span></div><div class="l">Đột xuất: hoàn thành / giao trong kỳ (${t.adhoc.onTime} đúng hạn)</div></div>
      <div class="kpi"><div class="v" data-testid="kpi-rating">${t.ratingAvg ?? '—'}</div><div class="l">Điểm xếp loại TB (${t.rated} việc được xếp loại)</div></div>
      <div class="kpi"><div class="v">${t.completed}</div><div class="l">Việc hoàn thành trong kỳ</div></div>
      <div class="kpi"><div class="v" data-testid="kpi-avgdays">${t.avgDays ?? '—'}</div><div class="l">Ngày xử lý trung bình (${t.durationSamples} việc)</div></div>
      <div class="kpi bad"><div class="v">${t.overdueNow}</div><div class="l">Việc đang quá hạn</div></div>
      <div class="kpi warn"><div class="v">${t.rejections}</div><div class="l">Lần bị trả lại khi duyệt</div></div>
    </div>
    ${formula(d)}
    <div class="card" style="margin-bottom:16px"><h3>Theo phòng chủ trì</h3>
      ${d.byDepartment.length ? `<div class="tbl-scroll"><table class="table st-kpi" data-testid="kpi-departments">${head(['Phòng ban', 'Điểm tổng hợp'])}<tbody>
        ${d.byDepartment.map(r => `<tr class="clickable${String(r.id) === dept ? ' st-picked' : ''}" data-dept="${r.id}" data-testid="kpi-dept-${r.id}"${String(r.id) === dept ? ' aria-current="true"' : ''}><td class="st-name"><button type="button" class="st-rowlink" data-dept="${r.id}" title="${String(r.id) === dept ? 'Đang xem cá nhân của phòng này' : 'Xem KPI cá nhân của phòng này'}">${esc(r.name)}</button><div class="muted xs">${r.officers} cán bộ có việc</div></td><td class="num">${score(r.score, r.components)}</td>${cells(r)}</tr>`).join('')}</tbody></table></div>` : '<div class="empty">Không có số liệu trong kỳ.</div>'}</div>
    <div class="card"><h3>Theo cá nhân ${dept ? `<span class="muted sm">· ${esc(deptName)}</span>` : ''}</h3>
      ${d.byPerson.length ? `<div class="tbl-scroll"><table class="table st-kpi" data-testid="kpi-people">${head(['Người', 'Phòng ban', 'Điểm tổng hợp'])}<tbody>
        ${d.byPerson.map(r => `<tr data-testid="kpi-person-${r.id}"><td class="st-name"><b>${personLink({ id: r.id, fullName: r.fullName })}</b>${r.title ? `<div class="muted xs">${esc(r.title)}</div>` : ''}${r.isActive ? '' : ' <span class="pill">Đã nghỉ</span>'}</td><td class="muted sm nowrap">${esc(r.department)}</td><td class="num">${score(r.score, r.components)}</td>${cells(r)}</tr>`).join('')}</tbody></table></div>` : '<div class="empty">Không có số liệu trong kỳ.</div>'}
      <p class="muted xs" style="margin-top:12px">Phòng: việc tính cho đơn vị chủ trì (việc không giao về phòng tính cho phòng sở hữu dự án / sổ). Cá nhân: theo người chủ trì, danh sách theo phòng của cán bộ; việc nhiều người chủ trì tính cho từng người.
        <b>Kế hoạch năm</b> = nhiệm vụ đến hạn trong kỳ; <b>Đột xuất</b> = việc giao trong kỳ. <b>Ngày xử lý</b> = hoàn thành − bắt đầu (chưa bắt đầu thì từ ngày giao), bỏ dữ liệu lỗi.
        Số liệu theo cá nhân là dữ liệu cá nhân — chỉ Ban giám đốc xem, mỗi lần xem được ghi nhật ký; dùng để tham khảo, chưa áp dụng tính lương thưởng.</p></div></div>`;
  $('#kDept', root).onchange = e => view.apply({ departmentId: e.target.value });
  $('#kpi-clear', root)?.addEventListener('click', () => view.apply({ p: '', from: '', to: '', departmentId: '' }, { focus: '#kp-month' }));
  // Gắn trên phần thân của trang (không gắn root.onclick: #view dùng chung cho mọi trang).
  $('.st-body', root).onclick = e => { const row = e.target.closest('[data-dept]'); if (row && row.dataset.dept !== dept) view.apply({ departmentId: row.dataset.dept }, { focus: `.st-rowlink[data-dept="${row.dataset.dept}"]` }); };
  bindPeriod(root, 'kp', {
    validate: (f, t) => (!f ? 'Chọn ngày bắt đầu' : t && t < f ? 'Ngày kết thúc trước ngày bắt đầu' : t && daysBetween(f, t) > KPI_MAX_DAYS ? 'Kỳ tối đa khoảng 13 tháng' : ''),
    onPick: k => view.apply({ p: k === 'month' ? '' : k, from: '', to: '' }, { focus: `#kp-${k}` }),
    onApply: (f, t) => view.apply({ p: '', from: f, to: t || f }, { focus: '#kpApply' }),
  });
}
