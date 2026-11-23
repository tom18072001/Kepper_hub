// KPI & phân tích thống kê công việc — chỉ Ban giám đốc (quyền reports.kpi toàn tổ chức; máy chủ trả 403 cho người khác).
// Thời gian làm (bắt đầu → xong), giao → được duyệt, đánh giá Tốt / Trung bình / Kém sau duyệt, xu hướng, biểu đồ kiểm soát đúng hạn,
// việc kéo dài bất thường. Luôn hiện cỡ mẫu (n); nhóm dưới 5 việc ghi "mẫu nhỏ". Không xếp hạng người: sắp theo phòng, tên.
import { api, download } from '../api.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import { esc, toast, errorMessage } from '../util.js';
import { periods, rangeText } from './dashboard.js';

const KEYS = ['month', 'lastMonth', 'quarter', 'year'];
const BAND = { GOOD: ['Tốt', 'good'], AVERAGE: ['Trung bình', 'mid'], POOR: ['Kém', 'bad'] };
const DIR = { UP: 'tăng', DOWN: 'giảm', STABLE: 'ổn định' };
const v = (x, s = '') => (x == null ? '—' : `${x}${s}`);
const band = b => (b ? `<span class="st-score ${BAND[b][1]}">${BAND[b][0]}</span>` : '<span class="muted">—</span>');
const small = n => (n < 5 ? ' <span class="an-small" title="Dưới 5 việc: chưa đủ để kết luận">mẫu nhỏ</span>' : '');

function groupCells(g) {
  const b = g.rating.bands;
  return `<td class="num">${g.completed}</td>
    <td class="num st-sep">${v(g.workDays.median)}${g.workDays.n ? `<div class="muted xs">${v(g.workDays.q1)}–${v(g.workDays.q3)}</div>` : ''}</td>
    <td class="num">${v(g.leadDays.median)}</td>
    <td class="num st-sep">${v(g.onTime.rate, '%')}<div class="muted xs">${g.onTime.onTime}/${g.onTime.judged}</div></td>
    <td class="num">${g.rejections}</td>
    <td class="num st-sep">${g.rating.n}</td><td class="num">${b.GOOD} · ${b.AVERAGE} · ${b.POOR}</td>
    <td class="num">${v(g.rating.avg)}</td><td>${band(g.rating.band)}${small(g.rating.n)}</td>`;
}
const HEAD = `<th class="num">Việc xong</th><th class="num st-sep" title="Bắt đầu làm → hoàn thành; dòng dưới: Q1–Q3">Thời gian làm<br><span class="muted xs">trung vị, ngày</span></th>
  <th class="num" title="Ngày giao → ngày được duyệt (việc không qua duyệt: → hoàn thành)">Giao → duyệt<br><span class="muted xs">trung vị, ngày</span></th>
  <th class="num st-sep">Đúng hạn</th><th class="num" title="Số lần phiếu duyệt bị trả lại">Trả lại</th>
  <th class="num st-sep" title="Số việc được người giao chấm mức khi duyệt">Được chấm</th><th class="num">Tốt · TB · Kém</th><th class="num">Điểm BQ</th><th>Đánh giá chung</th>`;

// Biểu đồ kiểm soát p (tỷ lệ đúng hạn theo kỳ, giới hạn ±3σ).
function controlChart(c) {
  const W = 640, H = 180, pad = 28, n = c.points.length;
  const x = i => pad + (n === 1 ? (W - 2 * pad) / 2 : i * (W - 2 * pad) / (n - 1)), y = p => H - pad - p / 100 * (H - 2 * pad);
  const path = key => c.points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  return `<svg class="an-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ kiểm soát tỷ lệ đúng hạn">
    ${[0, 50, 100].map(t => `<line x1="${pad}" x2="${W - pad}" y1="${y(t)}" y2="${y(t)}" class="an-grid"/><text x="2" y="${y(t) + 4}" class="an-ax">${t}%</text>`).join('')}
    <line x1="${pad}" x2="${W - pad}" y1="${y(c.center)}" y2="${y(c.center)}" class="an-center"/>
    <path d="${path('ucl')}" class="an-limit"/><path d="${path('lcl')}" class="an-limit"/><path d="${path('rate')}" class="an-line"/>
    ${c.points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.rate)}" r="4" class="${p.signal ? 'an-sig' : 'an-pt'}"><title>${esc(p.label)}: ${p.rate}% (n = ${p.judged}), giới hạn ${p.lcl}–${p.ucl}%</title></circle>
      <text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="an-ax">${esc(p.label.replace(/^(Tuần|Tháng) /, ''))}</text>`).join('')}
  </svg>`;
}

export async function renderAnalytics(root, params, setCrumbs) {
  setCrumbs('KPI & phân tích');
  const P = periods();
  const key = KEYS.includes(params.get('p')) ? params.get('p') : params.get('from') ? 'custom' : 'quarter';
  const from = key === 'custom' ? params.get('from') : P[key][1], to = key === 'custom' ? (params.get('to') || from) : P[key][2];
  const dept = params.get('departmentId') || '';
  const q = new URLSearchParams({ from, to });
  if (dept) q.set('departmentId', dept);
  const r = await api('/api/kpi/analytics?' + q);
  const o = r.overall;
  const go = patch => { const u = new URLSearchParams({ p: key === 'custom' ? '' : key, from: key === 'custom' ? from : '', to: key === 'custom' ? to : '', departmentId: dept, ...patch });
    for (const [k, val] of [...u]) if (!val) u.delete(k); location.hash = '#/kpi?' + u; };
  const tile = (value, label, sub = '') => `<div class="kpi"><div class="v">${value}</div><div class="l">${label}</div>${sub ? `<div class="muted xs">${sub}</div>` : ''}</div>`;

  root.innerHTML = `<div class="page-head"><h1>KPI & phân tích</h1><span class="muted xs">Bảo mật · chỉ Ban giám đốc · lúc ${new Date(r.generatedAt).toLocaleTimeString('vi-VN')}</span></div>
    <div class="filters st-filters an-filters" role="group" aria-label="Kỳ phân tích">
      <select id="anPeriod" aria-label="Kỳ" data-testid="an-period">${KEYS.map(k => `<option value="${k}"${k === key ? ' selected' : ''}>${P[k][0]}</option>`).join('')}<option value="custom"${key === 'custom' ? ' selected' : ''}>Tuỳ chọn</option></select>
      <input type="date" id="anFrom" value="${esc(from)}" aria-label="Từ ngày"${key === 'custom' ? '' : ' disabled'}> – <input type="date" id="anTo" value="${esc(to)}" aria-label="Đến ngày"${key === 'custom' ? '' : ' disabled'}>
      <select id="anDept" aria-label="Phòng chủ trì" data-testid="an-dept"><option value="">Mọi phòng</option>${store.departments.filter(d => d.isActive).map(d => `<option value="${d.id}"${String(d.id) === dept ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
      <span class="muted sm">${esc(rangeText(from, to))}</span>
      <button class="btn btn-ghost st-push" id="anExport" data-testid="an-export">${icon('download')}<span>Xuất Excel</span></button>
    </div>
    ${r.notes.length ? `<div class="card an-notes" data-testid="an-notes"><b>Lưu ý về dữ liệu</b><ul>${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
    <div class="kpis" data-testid="an-tiles">
      ${tile(o.completed, 'Việc hoàn thành', 'trong kỳ')}
      ${tile(v(o.workDays.median), 'Thời gian làm trung vị (ngày)', o.workDays.n ? `Q1–Q3: ${o.workDays.q1}–${o.workDays.q3} · n = ${o.workDays.n}` : '')}
      ${tile(v(o.leadDays.median), 'Giao → được duyệt, trung vị (ngày)', o.leadDays.n ? `trung bình ${o.leadDays.mean} · n = ${o.leadDays.n}` : '')}
      ${tile(v(o.onTime.rate, '%'), 'Xong đúng hạn', `${o.onTime.onTime}/${o.onTime.judged} việc có hạn`)}
      ${tile(o.rating.band ? BAND[o.rating.band][0] : '—', 'Đánh giá sau duyệt', `Tốt ${o.rating.bands.GOOD} · TB ${o.rating.bands.AVERAGE} · Kém ${o.rating.bands.POOR} · điểm BQ ${v(o.rating.avg)}`)}
    </div>
    <div class="card"><h3>Theo người <span class="muted xs">(sắp theo phòng, tên — không phải xếp hạng)</span></h3>
      <div class="tbl-scroll"><table class="table st-kpi" data-testid="an-people"><thead><tr><th>Phòng</th><th>Họ tên</th>${HEAD}</tr></thead><tbody>
      ${r.byPerson.map(p => `<tr><td>${esc(p.department)}</td><td class="st-name">${esc(p.fullName)}${small(p.workDays.n)}</td>${groupCells(p)}</tr>`).join('') || '<tr><td colspan="11" class="empty">Chưa có việc hoàn thành / được chấm trong kỳ.</td></tr>'}
      </tbody></table></div></div>
    <div class="card"><h3>Theo phòng chủ trì</h3>
      <div class="tbl-scroll"><table class="table st-kpi" data-testid="an-depts"><thead><tr><th>Phòng</th>${HEAD}</tr></thead><tbody>
      ${r.byDepartment.map(d => `<tr><td class="st-name">${esc(d.name)}${small(d.workDays.n)}</td>${groupCells(d)}</tr>`).join('') || '<tr><td colspan="10" class="empty">Chưa có số liệu.</td></tr>'}
      </tbody></table></div></div>
    <div class="card" data-testid="an-trend"><h3>Xu hướng theo ${r.trend.unit === 'week' ? 'tuần' : 'tháng'}</h3>
        <p class="muted sm">${r.trend.direction ? `Thời gian làm đang <b>${DIR[r.trend.direction]}</b> (${r.trend.workDaysSlope > 0 ? '+' : ''}${r.trend.workDaysSlope} ngày mỗi ${r.trend.unit === 'week' ? 'tuần' : 'tháng'}, độ dốc Theil–Sen).` : 'Chưa đủ kỳ có dữ liệu để nêu xu hướng.'}</p>
        <div class="tbl-scroll"><table class="table"><thead><tr><th>Kỳ</th><th class="num">Việc xong</th><th class="num">Thời gian làm (trung vị)</th><th class="num">Đúng hạn</th></tr></thead><tbody>
        ${r.trend.series.map(s => `<tr><td>${esc(s.label)}</td><td class="num">${s.completed}</td><td class="num">${v(s.medianWorkDays)}</td><td class="num">${v(s.onTimeRate, '%')}${s.judged ? ` <span class="muted xs">(${s.onTime}/${s.judged})</span>` : ''}</td></tr>`).join('')}
        </tbody></table></div></div>
    <div class="dash-grid st-dash an-grid2">
      <div class="card" data-testid="an-control"><h3>Kiểm soát tỷ lệ đúng hạn <span class="muted xs">(biểu đồ p, ±3σ)</span></h3>
        ${r.control ? `${controlChart(r.control)}<p class="muted xs">Đường giữa ${r.control.center}%. Điểm đỏ: kỳ nằm ngoài giới hạn — khác thường, nên xem nguyên nhân.</p>` : `<div class="empty">Cần ít nhất ${r.thresholds.minControl} việc có hạn đã hoàn thành trong kỳ.</div>`}</div>
      <div class="card" data-testid="an-outliers"><h3>Việc kéo dài bất thường ${r.outliers ? `<span class="muted xs">(> ${r.outliers.fence} ngày = Q3 + 1,5 × IQR)</span>` : ''}</h3>
        ${!r.outliers ? `<div class="empty">Cần ít nhất ${r.thresholds.minOutlier} việc hoàn thành để xác định.</div>`
          : [...r.outliers.completed.map(x => ({ ...x, k: 'Đã xong' })), ...r.outliers.open.map(x => ({ ...x, k: 'Đang mở' }))].map(x => `<div class="hbar" style="grid-template-columns:70px 1fr 70px"><a class="code" href="#/projects/${x.projectId}?item=${x.id}">${esc(x.code)}</a><span>${esc(x.title)} <span class="muted xs">· ${x.k}${x.assignees.length ? ' · ' + esc(x.assignees.join(', ')) : ''}</span></span><b>${x.days} ngày</b></div>`).join('') || '<div class="empty">Không có việc nào vượt ngưỡng.</div>'}</div>
    </div>
    <p class="muted xs">Phương pháp: trung vị, tứ phân vị (Q1–Q3); "Tốt" = Xuất sắc + Tốt, "Trung bình" = Đạt, "Kém" = Cần cải thiện + Kém theo mức người giao chấm khi duyệt; điểm bình quân (100/85/70/50/0) ≥ 80 là Tốt, ≥ 60 là Trung bình.
      Phạm vi phòng = phòng chủ trì việc. Số liệu để tham khảo, không xếp hạng, không gắn lương thưởng.</p>`;

  const sel = root.querySelector('#anPeriod');
  sel.addEventListener('change', () => { if (sel.value === 'custom') { root.querySelector('#anFrom').disabled = false; root.querySelector('#anTo').disabled = false; } else go({ p: sel.value, from: '', to: '' }); });
  for (const id of ['#anFrom', '#anTo']) root.querySelector(id).addEventListener('change', () => {
    const f = root.querySelector('#anFrom').value, t = root.querySelector('#anTo').value;
    if (f && t && t >= f) go({ p: '', from: f, to: t });
  });
  root.querySelector('#anDept').addEventListener('change', e => go({ departmentId: e.target.value }));
  root.querySelector('#anExport').addEventListener('click', async e => {
    const btn = e.currentTarget; btn.disabled = true;
    try { toast('Đã tải ' + await download('/api/kpi/analytics.xlsx?' + q), 'ok'); } catch (error) { toast(errorMessage(error), 'err'); } finally { btn.disabled = false; }
  });
}
