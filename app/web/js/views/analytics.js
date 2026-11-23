// KPI & phân tích thống kê công việc — chỉ Ban giám đốc (quyền reports.kpi toàn tổ chức; máy chủ trả 403 cho người khác).
// Thời gian làm (bắt đầu → xong), giao → được duyệt, đánh giá Tốt / Trung bình / Kém sau duyệt, xu hướng, biểu đồ kiểm soát đúng hạn,
// việc kéo dài bất thường. Luôn hiện cỡ mẫu (n); nhóm dưới 5 việc ghi "mẫu nhỏ". Không xếp hạng người: sắp theo phòng, tên.
import { api, download } from '../api.js';
import { store, can } from '../store.js';
import { icon } from '../icons.js';
import { esc, toast, errorMessage, fmtDate } from '../util.js';
import { periods, rangeText } from './dashboard.js';

const KEYS = ['month', 'lastMonth', 'quarter', 'year'];
const BAND = { GOOD: ['Tốt', 'good'], AVERAGE: ['Trung bình', 'mid'], POOR: ['Kém', 'bad'] };
const DIR = { UP: 'tăng', DOWN: 'giảm', STABLE: 'ổn định' };
const v = (x, s = '') => (x == null ? '—' : `${x}${s}`);
const band = b => (b ? `<span class="st-score ${BAND[b][1]}">${BAND[b][0]}</span>` : '<span class="muted">—</span>');
const RATING = { EXCELLENT: 'Xuất sắc', GOOD: 'Tốt', PASS: 'Đạt', NEEDS_IMPROVEMENT: 'Cần cải thiện', POOR: 'Kém' };
const small = n => (n < 5 ? ' <span class="an-small" title="Dưới 5 việc: chưa đủ để kết luận">mẫu nhỏ</span>' : '');

function groupCells(g) {
  const b = g.rating.bands;
  return `<td class="num">${g.completed}</td>
    <td class="num st-sep nowrap">${v(g.workDays.mean)} / ${v(g.workDays.median)}${g.workDays.n ? `<div class="muted xs">n = ${g.workDays.n}</div>` : ''}</td>
    <td class="num st-sep nowrap">${v(g.leadDays.mean)} / ${v(g.leadDays.median)}</td>
    <td class="num st-sep">${v(g.onTime.rate, '%')}<div class="muted xs">${g.onTime.onTime}/${g.onTime.judged}</div></td>
    <td class="num">${g.rejections}</td>
    <td class="num st-sep nowrap">${b.GOOD} · ${b.AVERAGE} · ${b.POOR}<div class="muted xs">n = ${g.rating.n}</div></td>
    <td class="num">${v(g.rating.median)}</td><td>${g.rating.band ? band(g.rating.band) : `<span class="muted xs" title="Cần ít nhất 5 việc được chấm mới đánh giá chung">— (n &lt; 5)</span>`}</td>`;
}
const HEAD = `<th class="num">Việc xong</th>
  <th class="num st-sep" title="Bắt đầu làm → hoàn thành; chỉ việc có ghi nhận lúc bắt đầu">Thời gian làm<br><span class="muted xs">TB / trung vị, ngày</span></th>
  <th class="num st-sep" title="Ngày giao (hoặc ngày bắt đầu nếu sớm hơn) → ngày được duyệt (việc không qua duyệt: → hoàn thành)">Giao → duyệt<br><span class="muted xs">TB / trung vị, ngày</span></th>
  <th class="num st-sep">Đúng hạn</th><th class="num" title="Số lần phiếu duyệt bị trả lại">Trả lại</th>
  <th class="num st-sep" title="Số việc người giao chấm khi duyệt, theo mức; n = số việc được chấm">Tốt · TB · Kém</th><th class="num" title="Trung vị điểm các lần chấm (100/85/70/50/0)">Điểm trung vị</th><th>Đánh giá chung</th>`;

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
  // Máy chủ vẫn trả 403; ở đây chỉ để người không có quyền thấy lời giải thích thay vì lỗi thô.
  if (!can('reports.kpi')) {
    root.innerHTML = `<div class="page-head"><h1>KPI & phân tích</h1></div><div class="card empty" data-testid="an-forbidden">Trang này chỉ dành cho Ban giám đốc. Số liệu của chính bạn xem ở <a href="#/my">Việc của tôi</a>.</div>`;
    return;
  }
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
      <span class="muted sm" id="anRange" aria-live="polite">${esc(rangeText(from, to))}</span>
      <button class="btn btn-ghost st-push" id="anExport" data-testid="an-export">${icon('download')}<span>Xuất Excel</span></button>
    </div>
    ${r.notes.length ? `<div class="card an-notes" data-testid="an-notes"><b>Lưu ý về dữ liệu</b><ul>${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
    <div class="kpis" data-testid="an-tiles">
      ${tile(o.completed, 'Việc hoàn thành', 'trong kỳ')}
      ${tile(`${v(o.workDays.mean)} <span class="st-of">/ ${v(o.workDays.median)}</span>`, 'Thời gian làm, TB / trung vị (ngày)', o.workDays.n ? `Q1–Q3: ${o.workDays.q1}–${o.workDays.q3} · n = ${o.workDays.n}${o.noStart ? ` · ${o.noStart} việc không ghi lúc bắt đầu` : ''}` : '')}
      ${tile(`${v(o.leadDays.mean)} <span class="st-of">/ ${v(o.leadDays.median)}</span>`, 'Giao → được duyệt, TB / trung vị (ngày)', o.leadDays.n ? `n = ${o.leadDays.n}` : '')}
      ${tile(v(o.onTime.rate, '%'), 'Xong đúng hạn', `${o.onTime.onTime}/${o.onTime.judged} việc có hạn`)}
      ${tile(o.rating.band ? BAND[o.rating.band][0] : '—', 'Đánh giá sau duyệt', `Tốt ${o.rating.bands.GOOD} · TB ${o.rating.bands.AVERAGE} · Kém ${o.rating.bands.POOR}${o.rating.band ? ` · điểm trung vị ${o.rating.median}` : ` · chưa đủ ${r.thresholds.minSample} việc được chấm`}`)}
    </div>
    <div class="card"><h3>Theo người <span class="muted xs">(sắp theo phòng, tên — không phải xếp hạng)</span></h3>
      <div class="tbl-scroll"><table class="table st-kpi" data-testid="an-people"><thead><tr><th>Phòng</th><th>Họ tên</th>${HEAD}</tr></thead><tbody>
      ${r.byPerson.map(p => `<tr><td>${esc(p.department)}</td><td class="st-name">${esc(p.fullName)}${small(p.workDays.n)}</td>${groupCells(p)}</tr>`).join('') || '<tr><td colspan="10" class="empty">Chưa có việc hoàn thành / được chấm trong kỳ.</td></tr>'}
      </tbody></table></div></div>
    <div class="card"><h3>Theo phòng chủ trì</h3>
      <div class="tbl-scroll"><table class="table st-kpi" data-testid="an-depts"><thead><tr><th>Phòng</th>${HEAD}</tr></thead><tbody>
      ${r.byDepartment.map(d => `<tr><td class="st-name">${esc(d.name)}${small(d.workDays.n)}</td>${groupCells(d)}</tr>`).join('') || '<tr><td colspan="9" class="empty">Chưa có số liệu.</td></tr>'}
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
          : [...r.outliers.completed.map(x => ({ ...x, k: 'Đã xong' })), ...r.outliers.open.map(x => ({ ...x, k: x.notStarted ? 'Đang mở · chưa bắt đầu (tính từ ngày giao)' : 'Đang mở' }))].map(x => `<div class="hbar" style="grid-template-columns:70px 1fr 70px"><a class="code" href="#/projects/${x.projectId}?item=${x.id}">${esc(x.code)}</a><span>${esc(x.title)} <span class="muted xs">· ${x.k}${x.assignees.length ? ' · ' + esc(x.assignees.join(', ')) : ''}</span></span><b>${x.days} ngày</b></div>`).join('') || '<div class="empty">Không có việc nào vượt ngưỡng.</div>'}</div>
    </div>
    <details class="card an-detail" data-testid="an-details"><summary><b>Chi tiết từng việc hoàn thành</b> <span class="muted xs">(${r.details.length} việc — mỗi việc mất bao lâu)</span></summary>
      <div class="tbl-scroll"><table class="table st-kpi"><thead><tr><th>Mã</th><th>Tiêu đề</th><th>Phòng chủ trì</th><th>Người làm</th><th>Giao</th><th>Bắt đầu</th><th>Xong</th><th>Được duyệt</th>
        <th class="num">Thời gian làm</th><th class="num">Giao → duyệt</th><th>Đúng hạn</th><th class="num">Trả lại</th><th>Mức chấm</th></tr></thead><tbody>
      ${r.details.map(d => `<tr><td class="nowrap"><a class="code" href="#/projects/${d.projectId}?item=${d.id}">${esc(d.code)}</a></td><td>${esc(d.title)}</td><td>${esc(d.department)}</td><td>${esc(d.assignees.join(', '))}</td>
        <td class="nowrap">${fmtDate(d.assignedAt)}${d.assignedAfterStart ? ' <span class="an-small" title="Ngày giao sau ngày bắt đầu — giao → duyệt tính từ ngày bắt đầu">sau bắt đầu</span>' : ''}</td><td class="nowrap">${d.startedAt ? fmtDate(d.startedAt) : '<span class="muted xs">không ghi</span>'}</td><td class="nowrap">${fmtDate(d.completedAt)}</td><td class="nowrap">${fmtDate(d.approvedAt)}</td>
        <td class="num">${v(d.workDays)}</td><td class="num">${v(d.leadDays)}</td><td>${d.onTime == null ? '<span class="muted xs">không có hạn</span>' : d.onTime ? 'Có' : 'Không'}</td><td class="num">${d.rejections}</td><td>${d.rating ? esc(RATING[d.rating]) : ''}</td></tr>`).join('') || '<tr><td colspan="13" class="empty">Chưa có việc hoàn thành trong kỳ.</td></tr>'}
      </tbody></table></div></details>
    <p class="muted xs">Phương pháp: trung bình (TB), trung vị, tứ phân vị (Q1–Q3); thời gian làm chỉ tính việc có ghi nhận lúc bắt đầu; đánh giá chung chỉ khi có ít nhất 5 việc được chấm; "Tốt" = Xuất sắc + Tốt, "Trung bình" = Đạt, "Kém" = Cần cải thiện + Kém theo mức người giao chấm khi duyệt; đánh giá chung theo trung vị điểm (100/85/70/50/0): ≥ 80 là Tốt, ≥ 60 là Trung bình, còn lại Kém.
      Phạm vi phòng = phòng chủ trì việc. Số liệu để tham khảo, không xếp hạng, không gắn lương thưởng.</p>`;

  const sel = root.querySelector('#anPeriod');
  sel.addEventListener('change', () => { if (sel.value === 'custom') { root.querySelector('#anFrom').disabled = false; root.querySelector('#anTo').disabled = false; } else go({ p: sel.value, from: '', to: '' }); });
  for (const id of ['#anFrom', '#anTo']) root.querySelector(id).addEventListener('change', () => {
    const f = root.querySelector('#anFrom').value, t = root.querySelector('#anTo').value;
    const msg = root.querySelector('#anRange');
    if (!f || !t) { msg.textContent = 'Chọn đủ hai ngày'; msg.classList.add('an-err'); return; }
    if (t < f) { msg.textContent = 'Ngày kết thúc trước ngày bắt đầu'; msg.classList.add('an-err'); return; }
    go({ p: '', from: f, to: t });
  });
  root.querySelector('#anDept').addEventListener('change', e => go({ departmentId: e.target.value }));
  root.querySelector('#anExport').addEventListener('click', async e => {
    const btn = e.currentTarget; btn.disabled = true;
    try { toast('Đã tải ' + await download('/api/kpi/analytics.xlsx?' + q), 'ok'); } catch (error) { toast(errorMessage(error), 'err'); } finally { btn.disabled = false; }
  });
}
