// Lịch dùng chung (Việc của tôi, Việc phòng được giao, lịch dự án): xem theo Tháng hoặc Tuần.
// Tháng: việc nằm ở ngày hạn. Tuần: việc trải từ ngày bắt đầu đến ngày hạn (tối đa 31 ngày; dài hơn thì chỉ hiện ở ngày hạn),
// để xem nhanh "tuần này ai làm gì / ai đi công tác". Không lưu gì phía máy chủ.
import { esc, dateInput } from '../util.js';
import { icon } from '../icons.js';

const DAY = 86_400_000;
const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
// Ngày theo giờ Việt Nam, dạng YYYY-MM-DD.
export const vnKey = d => new Date(new Date(d).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
const utc = k => new Date(k + 'T00:00:00Z');
const keyOf = d => d.toISOString().slice(0, 10);
const mondayOf = k => { const d = utc(k); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY); };

// Mốc đang xem: tháng "YYYY-MM" hoặc tuần (ngày bất kỳ trong tuần "YYYY-MM-DD").
export function calState(params, prefMode) {
  const mode = ['week', 'month'].includes(params.get('cal')) ? params.get('cal') : prefMode === 'week' ? 'week' : 'month';
  const raw = params.get('at') || '';
  const today = dateInput(new Date());
  const at = mode === 'month' ? (/^\d{4}-\d{2}$/.test(raw) ? raw : /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw.slice(0, 7) : today.slice(0, 7))
    : (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : /^\d{4}-\d{2}$/.test(raw) ? raw + '-01' : today);
  return { mode, at };
}
export function shiftAt({ mode, at }, delta) {
  if (!delta) return '';
  if (mode === 'month') { const [y, m] = at.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7); }
  return keyOf(new Date(utc(at).getTime() + delta * 7 * DAY));
}

// opts: items, state {mode, at}, dateOf(i) → ngày hạn hiển thị, startOf(i), hrefOf(i), colorOf(i), doneOf(i), labelOf(i), metaOf(i), testid
export function calendarHtml({ items, state, dateOf = i => i.dueDate, startOf = i => i.startDate, hrefOf, colorOf = () => '', doneOf = () => false, labelOf = i => `${i.code} ${i.title}`, metaOf = () => '', testid = 'calendar', itemTestid = i => `cal-${i.code}` }) {
  const { mode, at } = state;
  const today = dateInput(new Date());
  let days, title;
  if (mode === 'month') {
    const [y, m] = at.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const start = new Date(first.getTime() - ((first.getUTCDay() + 6) % 7) * DAY);
    days = Array.from({ length: 42 }, (_, k) => new Date(start.getTime() + k * DAY));
    title = `Tháng ${m}/${y}`;
    days.other = d => d.getUTCMonth() !== m - 1;
  } else {
    const mon = mondayOf(at);
    days = Array.from({ length: 7 }, (_, k) => new Date(mon.getTime() + k * DAY));
    const f = d => `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
    title = `Tuần ${f(days[0])} – ${f(days[6])}/${days[6].getUTCFullYear()}`;
    days.other = () => false;
  }
  const first = keyOf(days[0]), last = keyOf(days[days.length - 1]);
  const byDay = new Map();
  const put = (k, i, cont) => { if (k < first || k > last) return; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push({ i, cont }); };
  let noDate = 0;
  for (const i of items) {
    const due = dateOf(i) ? vnKey(dateOf(i)) : null;
    const st = startOf(i) ? vnKey(startOf(i)) : null;
    if (!due && !st) { noDate++; continue; }
    const end = due || st;
    const begin = mode === 'week' && st && due && st < due && (utc(due) - utc(st)) / DAY <= 31 ? st : end;
    for (let d = utc(begin < first ? first : begin); keyOf(d) <= (end > last ? last : end); d = new Date(d.getTime() + DAY)) put(keyOf(d), i, keyOf(d) !== end);
  }
  const chip = ({ i, cont }) => `<a class="cal-item${doneOf(i) ? ' done' : ''}${cont ? ' cont' : ''}" href="${esc(hrefOf(i))}" data-id="${i.id}"${colorOf(i) ? ` style="--dot:${esc(colorOf(i))}"` : ''} title="${esc(labelOf(i))}${cont ? ' (đang làm, hạn sau)' : ''}"${cont ? '' : ` data-testid="${esc(itemTestid(i))}"`}>${esc(labelOf(i))}${!cont && metaOf(i) ? `<span class="cal-meta">${esc(metaOf(i))}</span>` : ''}</a>`;
  const MAX = mode === 'month' ? 4 : 50;
  return `<div class="row nav-row cal-nav"><h3 data-testid="${testid}-title">${title}</h3>
      <span class="btn-group"><button type="button" class="btn btn-ghost btn-sm" data-cal-at="${shiftAt(state, -1)}" aria-label="${mode === 'month' ? 'Tháng' : 'Tuần'} trước" title="${mode === 'month' ? 'Tháng' : 'Tuần'} trước">${icon('left')}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-cal-at="">Hôm nay</button><button type="button" class="btn btn-ghost btn-sm" data-cal-at="${shiftAt(state, 1)}" aria-label="${mode === 'month' ? 'Tháng' : 'Tuần'} sau" title="${mode === 'month' ? 'Tháng' : 'Tuần'} sau">${icon('right')}</button></span>
      <span class="seg" role="group" aria-label="Kiểu lịch"><button type="button" class="seg-btn${mode === 'week' ? ' on' : ''}" data-cal-mode="week" aria-pressed="${mode === 'week'}" data-testid="${testid}-week">Tuần</button><button type="button" class="seg-btn${mode === 'month' ? ' on' : ''}" data-cal-mode="month" aria-pressed="${mode === 'month'}" data-testid="${testid}-month">Tháng</button></span>
      <span class="muted sm">${noDate ? noDate + ' việc chưa có hạn không hiển thị' : ''}</span></div>
    <div class="cal cal-${mode}" data-testid="${testid}">${DOW.map(d => `<div class="dow">${d}</div>`).join('')}
    ${days.map(d => { const k = keyOf(d); const list = byDay.get(k) || [];
      const more = list.length > MAX ? list.length - (MAX - 1) : 0;
      return `<div class="day${days.other(d) ? ' other' : ''}${k === today ? ' today' : ''}" data-day="${k}"><span class="num">${mode === 'week' ? `${DOW[(d.getUTCDay() + 6) % 7]} ` : ''}${d.getUTCDate()}${mode === 'week' ? '/' + (d.getUTCMonth() + 1) : ''}</span>
        ${(more ? list.slice(0, MAX - 1) : list).map(chip).join('')}${more ? `<button type="button" class="cal-more" data-cal-day="${k}">+${more} việc</button>` : ''}</div>`; }).join('')}</div>`;
}

// Gắn điều hướng: onChange({ mode, at }) — trang tự ghi URL / vẽ lại. Bấm "+n việc" ở lịch tháng → chuyển sang tuần đó.
export function bindCalendar(root, state, onChange) {
  root.addEventListener('click', e => {
    const nav = e.target.closest('[data-cal-at]');
    if (nav) { e.preventDefault(); return onChange({ mode: state.mode, at: nav.dataset.calAt || '' }); }
    const m = e.target.closest('[data-cal-mode]');
    if (m) { e.preventDefault(); return onChange({ mode: m.dataset.calMode, at: state.mode === 'month' && m.dataset.calMode === 'week' ? (state.at === dateInput(new Date()).slice(0, 7) ? '' : state.at + '-01') : state.at }); }
    const more = e.target.closest('[data-cal-day]');
    if (more) { e.preventDefault(); return onChange({ mode: 'week', at: more.dataset.calDay }); }
  });
}
