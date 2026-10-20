// Dải số liệu "của tôi" (tháng này / quý này) đặt ở đầu "Việc của tôi": được giao, hoàn thành, đúng / trễ hạn,
// điểm xếp loại, đang quá hạn, điểm tổng hợp so với phòng. Chỉ chính người dùng xem được (GET /api/kpi/me).
import { api } from '../api.js';
import { esc } from '../util.js';
import { store } from '../store.js';

const KEY = 'workhub_mykpi_period';
const tone = (v, good, mid) => (v == null ? '' : v >= good ? ' ok' : v >= mid ? ' warn' : ' bad');
const val = (v, suffix = '') => (v == null ? '—' : `${v}${suffix}`);

// Mỗi ô bấm được → "Tổng thể công việc" của chính mình, lọc đúng tập việc đã đếm (cùng định nghĩa ở máy chủ).
function tiles(p) {
  const dept = p.department;
  const href = metric => `#/work?${new URLSearchParams({ user: String(store.me.id), metric, from: new Date(p.from).toISOString(), to: new Date(p.to).toISOString() })}`;
  const t = (metric, cls, value, label, extra = '') => `<a class="mk-t${cls}" href="${href(metric)}" data-testid="my-kpi-tile-${metric}" title="Xem các việc: ${esc(label)}"><b>${value}</b><span>${label}</span>${extra}</a>`;
  return `
    ${t('assigned', '', p.assigned, 'Được giao')}
    ${t('completed', '', p.completed, 'Hoàn thành')}
    ${t('onTime', p.onTime ? ' ok' : '', p.onTime, 'Đúng hạn')}
    ${t('late', p.late ? ' bad' : '', p.late, 'Trễ hạn')}
    ${t('judged', tone(p.onTimeRate, 90, 70), val(p.onTimeRate, '%'), 'Tỷ lệ đúng hạn')}
    ${t('rated', '', val(p.ratingAvg), `Xếp loại TB${p.rated ? ` · ${p.rated} việc` : ''}`)}
    ${t('overdueNow', p.overdueNow ? ' bad' : '', p.overdueNow, 'Đang quá hạn')}
    <div class="mk-t mk-score${tone(p.score, 85, 70)}" title="Đúng hạn ${val(p.components?.onTime)} · Xếp loại ${val(p.components?.rating)} · Khối lượng ${val(p.components?.volume)}">
      <b>${val(p.score)}</b><span>Điểm tổng hợp</span><small>${dept?.avgScore != null ? `TB phòng ${dept.avgScore}` : 'Chưa đủ số liệu so với phòng'}</small></div>`;
}

export async function renderMyKpi(el) {
  if (!el) return;
  let d;
  try { d = await api('/api/kpi/me'); } catch { el.innerHTML = ''; return; } // không có số liệu (vd. admin IT) → không hiện dải
  let key = 'month';
  try { const saved = localStorage.getItem(KEY); if (d.periods.some(p => p.key === saved)) key = saved; } catch { /* trình duyệt chặn lưu trữ */ }
  const w = d.weights || {};
  const draw = () => {
    const p = d.periods.find(x => x.key === key) || d.periods[0];
    el.innerHTML = `<section class="card mk" data-testid="my-kpi" aria-label="Số liệu của tôi">
      <div class="mk-head"><h3>Số liệu của tôi</h3>
        <div class="mk-seg" role="tablist" aria-label="Kỳ">${d.periods.map(x => `<button type="button" role="tab" aria-selected="${x.key === p.key}" class="${x.key === p.key ? 'on' : ''}" data-k="${x.key}" data-testid="my-kpi-${x.key}">${esc(x.label)}</button>`).join('')}</div></div>
      <div class="mk-strip">${tiles(p)}</div>
      <details class="mk-how"><summary>Cách tính</summary>
        <p>Tính trên việc bạn chủ trì. <b>Đúng / trễ hạn</b>: việc có hạn trong kỳ đã tới hạn hoặc đã xong. <b>Xếp loại</b>: Xuất sắc 100 · Tốt 85 · Hoàn thành 70 · Không hoàn thành 0.
        <b>Điểm tổng hợp</b> = ${w.onTime ?? 40}% đúng hạn + ${w.rating ?? 40}% xếp loại + ${w.volume ?? 20}% khối lượng (số việc hoàn thành so với bình quân cán bộ cùng phòng, chỉ tính khi phòng có từ ${d.minPeers ?? 3} cán bộ có số liệu); thành phần chưa có dữ liệu được bỏ qua và chia lại trọng số; chưa có việc tới hạn hay được xếp loại thì chưa chấm điểm.
        Số liệu chỉ bạn và Ban giám đốc xem được, dùng để tham khảo. Thấy chưa đúng, hãy báo lãnh đạo phòng.</p></details>
    </section>`;
    el.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => {
      key = b.dataset.k;
      try { localStorage.setItem(KEY, key); } catch { /* bỏ qua */ }
      draw();
    }));
  };
  draw();
}
