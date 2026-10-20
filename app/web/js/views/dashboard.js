// Dashboard: số liệu chính (bấm để xem chi tiết), phân bố trạng thái, throughput 8 tuần, theo loại nhiệm vụ, khối lượng theo người,
// việc quá hạn / sắp đến hạn / tồn lâu, theo phòng chủ trì và theo dự án / sổ. Xuất báo cáo tuần / kỳ (Word, tối đa 93 ngày).
import { api, download } from '../api.js';
import { store, can, personLink } from '../store.js';
import { icon } from '../icons.js';
import { $, esc, fmtDate, CATEGORY, dateInput, toast, errorMessage, replaceHashParams } from '../util.js';

const DAY = 86_400_000;
const iso = d => d.toISOString().slice(0, 10);

// ---------- Dùng chung cho Dashboard / KPI / Tổng hợp: kỳ nhanh và bộ lọc ghi trên URL ----------
// Các kỳ theo giờ Việt Nam: [nhãn, từ ngày, đến ngày] (yyyy-mm-dd).
export function periods(now = new Date()) {
  const today = new Date(dateInput(now) + 'T00:00:00Z');
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY);
  const y = today.getUTCFullYear(), m = today.getUTCMonth(), q = Math.floor(m / 3) * 3;
  const d = (yy, mm, dd) => iso(new Date(Date.UTC(yy, mm, dd)));
  return {
    week: ['Tuần này', iso(monday), iso(new Date(monday.getTime() + 6 * DAY))],
    lastWeek: ['Tuần trước', iso(new Date(monday.getTime() - 7 * DAY)), iso(new Date(monday.getTime() - DAY))],
    month: ['Tháng này', d(y, m, 1), d(y, m + 1, 0)],
    lastMonth: ['Tháng trước', d(y, m - 1, 1), d(y, m, 0)],
    quarter: ['Quý này', d(y, q, 1), d(y, q + 3, 0)],
    year: ['Năm nay', d(y, 0, 1), d(y, 11, 31)],
  };
}
const dm = s => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
// "01/10 – 31/10/2026" (cùng năm) hoặc "15/12/2025 – 15/01/2026".
export function rangeText(from, to) {
  if (!from) return '';
  if (!to || to === from) return `${dm(from)}/${from.slice(0, 4)}`;
  return from.slice(0, 4) === to.slice(0, 4) ? `${dm(from)} – ${dm(to)}/${to.slice(0, 4)}` : `${dm(from)}/${from.slice(0, 4)} – ${dm(to)}/${to.slice(0, 4)}`;
}
export const daysBetween = (from, to) => Math.round((new Date(to) - new Date(from)) / DAY) + 1;
// Điều khiển kỳ (phân đoạn): kỳ nhanh + "Tuỳ chọn…" (hiện ô ngày). opts.all: nhãn cho lựa chọn "không lọc theo kỳ".
export function periodSeg({ id, P, keys, active, label, all = '', testid = () => '', groupTestid = '' }) {
  const btn = (k, text) => `<button type="button" id="${id}-${k}" data-period="${k}" aria-pressed="${k === active}"${testid(k) ? ` data-testid="${testid(k)}"` : ''}>${esc(text)}</button>`;
  return `<div class="st-seg" id="${id}" role="group" aria-label="${esc(label)}"${groupTestid ? ` data-testid="${groupTestid}"` : ''}>${all ? btn('all', all) : ''}${keys.map(k => btn(k, P[k][0])).join('')}${btn('custom', 'Tuỳ chọn…')}</div>`;
}
export function customRange({ id, from, to, show, apply = '', testids = {} }) {
  return `<span class="st-custom${show ? '' : ' hidden'}" id="${id}Custom">
      <label class="st-date">Từ <input type="date" id="${id}From" value="${esc(from || '')}" aria-describedby="${id}Msg"${testids.from ? ` data-testid="${testids.from}"` : ''}></label>
      <label class="st-date">đến <input type="date" id="${id}To" value="${esc(to || '')}" aria-describedby="${id}Msg"${testids.to ? ` data-testid="${testids.to}"` : ''}></label>
      ${apply ? `<button type="button" class="btn btn-ghost btn-sm" id="${id}Apply">${esc(apply)}</button>` : ''}</span>`;
}
// Khoảng ngày dạng chữ (ô ngày của trình duyệt có thể hiện mm/dd/yyyy): "01/07 – 30/09/2026 · 92 ngày".
export const describeRange = (f, t) => (f && t ? `${rangeText(f, t)} · ${daysBetween(f, t)} ngày` : f ? 'Từ ' + rangeText(f) : t ? 'Đến ' + rangeText(t) : '');
// Gắn hành vi: bấm kỳ nhanh → onPick(key); "Tuỳ chọn…" → hiện ô ngày, chưa tải lại; khi gõ ngày → kiểm tra, hiện khoảng ngày
// ở #<id>Msg, gọi onInput(from, to, ok); Enter / nút áp dụng → onApply(from, to) nếu hợp lệ. Trả về { check }.
export function bindPeriod(root, id, { onPick, onApply, onCustom, onInput, validate = () => '' }) {
  const seg = root.querySelector('#' + id), box = root.querySelector(`#${id}Custom`), msg = root.querySelector(`#${id}Msg`);
  const fromEl = root.querySelector(`#${id}From`), toEl = root.querySelector(`#${id}To`);
  const check = (strict = false) => {
    if (!fromEl) return true;
    const f = fromEl.value, t = toEl.value, err = f || t || strict ? validate(f, t) : '';
    if (msg) { msg.textContent = err || describeRange(f, t); msg.classList.toggle('st-bad', !!err); msg.classList.toggle('hidden', !msg.textContent); }
    return !err;
  };
  if (!seg) return { check };
  seg.addEventListener('click', e => {
    const b = e.target.closest('[data-period]'); if (!b) return;
    if (b.dataset.period === 'custom') {
      pressSeg(seg, 'custom'); box?.classList.remove('hidden');
      const ok = check(); onCustom?.(fromEl?.value, toEl?.value, ok);
      fromEl?.focus();
      return;
    }
    onPick(b.dataset.period);
  });
  for (const el of [fromEl, toEl]) el?.addEventListener('change', () => { const ok = check(); onInput?.(fromEl.value, toEl.value, ok); });
  // Màn hẹp: hàng kỳ cuộn ngang, mép phải mờ khi còn lựa chọn phía sau; đưa lựa chọn đang áp vào tầm nhìn.
  const fade = () => { seg.classList.toggle('st-more', seg.scrollLeft + seg.clientWidth < seg.scrollWidth - 2); seg.classList.toggle('st-less', seg.scrollLeft > 2); };
  seg.addEventListener('scroll', fade, { passive: true });
  requestAnimationFrame(() => {
    const on = seg.querySelector('[aria-pressed="true"]');
    if (on && seg.scrollWidth > seg.clientWidth && on.offsetLeft + on.offsetWidth > seg.clientWidth - 24) seg.scrollLeft = on.offsetLeft - 32;
    fade();
  });
  const fire = () => { if (check(true)) onApply?.(fromEl.value, toEl.value); else fromEl.focus(); };
  if (box && !box.classList.contains('hidden')) check();
  root.querySelector(`#${id}Apply`)?.addEventListener('click', fire);
  box?.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); fire(); } });
  return { check };
}
export function pressSeg(seg, key) { for (const b of seg.querySelectorAll('[data-period]')) b.setAttribute('aria-pressed', String(b.dataset.period === key)); }
export const clearBtn = (show, id) => (show ? `<button type="button" class="st-clear" id="${id}" data-testid="${id}">${icon('x')}Xoá lọc</button>` : '');

// Bộ lọc ghi lên URL bằng replaceHashParams (không tạo lịch sử) rồi tự vẽ lại. Router chỉ biết địa chỉ lúc nó vẽ, nên
// khi người dùng bấm lại menu tới đúng địa chỉ cũ (router coi là không đổi) thì trang tự vẽ lại theo URL.
const live = {};
let watching = false;
const keyOf = params => { const p = new URLSearchParams(params); p.delete('item'); p.sort(); return p.toString(); };
const hashPage = () => location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[0];
const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');
function onHash() {
  const page = hashPage(), v = live[page];
  if (!v || keyOf(hashParams()) === v.key || !v.root.querySelector(`[data-st-page="${page}"]`)) return;
  v.render(v.root, hashParams(), v.setCrumbs).catch(error => toast(errorMessage(error), 'err'));
}
// Gọi đồng bộ ở đầu hàm render. current(): còn là lần vẽ mới nhất của trang đang xem (bỏ kết quả về muộn).
export function filterView(page, root, params, setCrumbs, render) {
  const seq = (live[page]?.seq || 0) + 1;
  live[page] = { key: keyOf(params), seq, root, setCrumbs, render };
  if (!watching) { watching = true; window.addEventListener('hashchange', onHash); }
  return {
    current: () => live[page]?.seq === seq && hashPage() === page,
    async apply(changes, { focus = '' } = {}) {
      const before = location.hash, active = document.activeElement?.id;
      replaceHashParams(changes);
      const body = root.querySelector('.st-body');
      body?.classList.add('st-busy'); root.setAttribute('aria-busy', 'true');
      try {
        await render(root, hashParams(), setCrumbs);
        const el = (focus && root.querySelector(focus)) || (active && document.getElementById(active));
        if (el && root.contains(el)) el.focus({ preventScroll: true });
      } catch (error) {
        history.replaceState(null, '', before);
        if (live[page]) live[page].key = keyOf(hashParams());
        body?.classList.remove('st-busy');
        toast(errorMessage(error), 'err');
      } finally { root.removeAttribute('aria-busy'); }
    },
  };
}

const CAT_COLORS = { BACKLOG: '#94a3b8', UNSTARTED: '#64748b', STARTED: '#2563eb', REVIEW: '#d97706', COMPLETED: '#16a34a', CANCELLED: '#cbd5e1' };
const TYPE_LABEL = { PLAN: 'Kế hoạch năm', ADHOC: 'Đột xuất' };

// Thẻ số liệu: có đích thì bấm được (liên kết trang khác hoặc cuộn tới khu vực trên trang).
function card({ value, label, tone = '', testid = '', href = '', scroll = '', hint = '' }) {
  const inner = `<div class="v"${testid ? ` data-testid="${testid}"` : ''}>${value}</div><div class="l">${label}</div>`;
  const cls = `kpi${tone ? ' ' + tone : ''}`;
  if (href) return `<a class="${cls} kpi-link" href="${href}" title="${esc(hint)}">${inner}</a>`;
  if (scroll) return `<button type="button" class="${cls} kpi-link" data-scroll="${scroll}" title="${esc(hint)}">${inner}</button>`;
  return `<div class="${cls}">${inner}</div>`;
}
const listRows = (rows, right) => rows.map(o => `<div class="hbar" style="grid-template-columns:70px 1fr 90px"><a class="code" href="#/projects/${o.projectId}?item=${o.id}">${esc(o.code)}</a><span>${esc(o.title)}</span>${right(o)}</div>`).join('');
const cnt = (n, bad = false) => `<td class="num${bad && n ? ' due overdue' : ''}">${n}</td>`;

const REPORT_KEYS = ['week', 'lastWeek', 'month', 'quarter'];
const REPORT_MAX_DAYS = 93;

export async function renderDashboard(root, params, setCrumbs) {
  setCrumbs('Dashboard');
  const view = filterView('dashboard', root, params, setCrumbs, renderDashboard);
  const deptParam = params.get('departmentId') || '';
  const q = new URLSearchParams();
  if (deptParam) q.set('departmentId', deptParam);
  const d = await api('/api/dashboard?' + q);
  if (!view.current()) return;
  // Kỳ của báo cáo Word (số liệu trên trang là hiện trạng, không theo kỳ): mặc định tuần này; lưu trên URL (p, from, to).
  const P = periods();
  const rp = REPORT_KEYS.includes(params.get('p')) ? params.get('p') : params.get('from') ? 'custom' : 'week';
  const rFrom = rp === 'custom' ? params.get('from') : P[rp][1], rTo = rp === 'custom' ? (params.get('to') || params.get('from')) : P[rp][2];
  const t = d.totals, maxTp = Math.max(1, ...d.throughput.map(w => w.completed)), maxLoad = Math.max(1, ...d.workload.map(w => w.open));
  const catTotal = Object.values(d.byCategory).reduce((a, b) => a + b, 0) || 1;
  const deptLabel = d.scope === 'UNIT' ? 'phòng ban của tôi' : d.departmentId ? store.departments.find(x => x.id === d.departmentId)?.name : '';
  const isLeader = store.me.permissions?.['work.approve']?.operate === 'UNIT'; // lãnh đạo phòng: có hộp "Việc phòng được giao"
  const showDepts = d.byDepartment.length > 1 || d.scope === 'SYSTEM';
  const canApprove = can('work.approve', 'operate');
  const canExport = can('reports.export', 'operate');
  const types = d.byTaskType || {};
  const dirty = d.scope === 'SYSTEM' && !!deptParam; // "Xoá lọc" chỉ cho bộ lọc số liệu; kỳ báo cáo không lọc số liệu trên trang
  const deptHref = id => { const u = new URLSearchParams(params); u.delete('item'); u.set('departmentId', id); return '#/dashboard?' + u; };
  // Đầu trang: phạm vi số liệu (Ban Giám đốc) + Xoá lọc. Thanh dưới: xuất báo cáo Word theo kỳ (không lọc số liệu trên trang).
  const scopeCtl = d.scope === 'SYSTEM' ? `<span class="st-field st-scope"><select id="dashDept" aria-label="Phạm vi số liệu" data-testid="dash-dept"><option value="">Toàn Trung tâm</option>${store.departments.filter(x => x.isActive).map(x => `<option value="${x.id}"${String(x.id) === deptParam ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>${clearBtn(dirty, 'dash-clear')}</span>` : '';
  const reportBar = canExport ? `<div class="filters st-filters st-reportbar" role="group" aria-labelledby="repLbl" data-testid="dash-report">
      <span class="st-lbl" id="repLbl">Báo cáo Word</span>
      ${periodSeg({ id: 'rep', P, keys: REPORT_KEYS, active: rp, label: 'Kỳ báo cáo', groupTestid: 'report-preset' })}
      ${customRange({ id: 'rep', from: rFrom, to: rTo, show: rp === 'custom', testids: { from: 'report-from', to: 'report-to' } })}
      <span class="st-range muted sm" id="repMsg" aria-live="polite"></span>
      <button class="btn btn-ghost st-push" id="weeklyBtn" data-testid="weekly-report" title="Báo cáo tuần / kỳ, tối đa ${REPORT_MAX_DAYS} ngày">${icon('download')}<span>Tải báo cáo</span></button>
    </div>` : '';
  root.innerHTML = `<div class="page-head" data-st-page="dashboard"><h1>Dashboard ${deptLabel ? `<span class="muted sm">· ${esc(deptLabel)}</span>` : ''}</h1>
      ${scopeCtl}<span class="muted xs">Hiện trạng lúc ${new Date(d.generatedAt).toLocaleTimeString('vi-VN')}</span></div>
    ${reportBar}
    <div class="st-body">
    <div class="kpis" data-testid="kpis">
      ${card({ value: t.open, label: 'Việc đang mở', testid: 'kpi-open', scroll: showDepts ? 'dashDepartments' : 'dashOverdue', hint: 'Xem theo phòng' })}
      ${card({ value: t.overdue, label: 'Quá hạn', tone: 'bad', testid: 'kpi-overdue', scroll: 'dashOverdue', hint: 'Xem danh sách việc quá hạn' })}
      ${card({ value: t.dueSoon, label: 'Đến hạn trong 7 ngày', tone: 'warn', testid: 'kpi-duesoon', scroll: 'dashDueSoon', hint: 'Xem danh sách việc sắp đến hạn' })}
      ${t.pendingAccept || isLeader ? card({ value: t.pendingAccept || 0, label: 'Chờ phòng tiếp nhận', tone: 'warn', testid: 'kpi-pending-accept', href: isLeader ? '#/dept?tab=PENDING' : '', scroll: !isLeader && showDepts ? 'dashDepartments' : '', hint: 'Việc giao về phòng chưa được tiếp nhận, phân công' }) : ''}
      ${card({ value: d.pendingApprovals, label: 'Đang chờ duyệt', tone: 'warn', testid: 'kpi-pending', href: canApprove ? '#/approvals' : '', hint: 'Mở hàng chờ duyệt của tôi' })}
      ${card({ value: t.completed, label: 'Đã hoàn thành', testid: 'kpi-completed', scroll: 'dashThroughput', hint: 'Xem throughput theo tuần' })}
      ${card({ value: d.cycleTime.medianDays ?? '—', label: 'Cycle time trung vị (ngày, 30 ngày qua)' })}
    </div>
    <div class="dash-grid st-dash">
      <div class="card"><h3>Phân bố trạng thái</h3>
        <div class="stack">${Object.entries(d.byCategory).map(([k, v]) => `<i style="width:${v / catTotal * 100}%;background:${CAT_COLORS[k]}" title="${CATEGORY[k]}: ${v}"></i>`).join('')}</div>
        <div class="legend">${Object.entries(d.byCategory).map(([k, v]) => `<span><span class="state-dot" style="background:${CAT_COLORS[k]}"></span> ${CATEGORY[k]}: <b>${v}</b></span>`).join('')}</div></div>
      <div class="card" id="dashThroughput"><h3>Throughput — việc hoàn thành mỗi tuần</h3>
        <div class="bars" data-testid="throughput">${d.throughput.map(w => `<div class="bar"><b>${w.completed}</b><i style="height:${w.completed / maxTp * 110}px"></i><span>${w.week.slice(8, 10)}/${w.week.slice(5, 7)}</span></div>`).join('')}</div></div>
      <div class="card"><h3>Theo loại nhiệm vụ</h3><div class="tbl-scroll"><table class="table" data-testid="dash-types"><thead><tr><th>Loại</th><th class="num">Tổng</th><th class="num">Đang mở</th><th class="num">Hoàn thành</th><th class="num">Quá hạn</th></tr></thead><tbody>
        ${['PLAN', 'ADHOC'].map(k => types[k] || { total: 0, open: 0, completed: 0, overdue: 0 }).map((x, n) => `<tr><td class="nowrap"><span class="type-tag type-${n ? 'ADHOC' : 'PLAN'}">${n ? 'ĐX' : 'KH'}</span> ${TYPE_LABEL[n ? 'ADHOC' : 'PLAN']}</td>${cnt(x.total)}${cnt(x.open)}${cnt(x.completed)}${cnt(x.overdue, true)}</tr>`).join('')}</tbody></table></div></div>
      ${d.peopleVisible === false ? '' : `<div class="card"><h3>Khối lượng việc theo người <span class="muted xs">(đang mở / quá hạn)</span></h3>
        ${d.workload.map(w => `<div class="hbar"><span title="${esc(w.fullName)}">${personLink({ id: w.userId, fullName: w.fullName })}</span><span class="track"><i style="width:${(w.open - w.overdue) / maxLoad * 100}%"></i><i class="bad" style="width:${w.overdue / maxLoad * 100}%"></i></span><b>${w.open}</b></div>`).join('') || '<div class="empty">Không có việc đang mở.</div>'}</div>`}
      <div class="card" id="dashOverdue"><h3>Việc quá hạn <span class="muted sm">${t.overdue}</span></h3>${listRows(d.overdueItems, o => `<span class="due overdue">${fmtDate(o.dueDate)}</span>`) || '<div class="empty">Không có việc quá hạn.</div>'}
        ${t.overdue > d.overdueItems.length ? `<p class="muted xs">Hiện ${d.overdueItems.length} việc quá hạn lâu nhất; xem đủ ở bảng theo dự án / sổ bên dưới.</p>` : ''}</div>
      <div class="card" id="dashDueSoon"><h3>Đến hạn trong 7 ngày <span class="muted sm">${t.dueSoon}</span></h3>${listRows(d.dueSoonItems || [], o => `<span class="due">${fmtDate(o.dueDate)}</span>`) || '<div class="empty">Không có việc sắp đến hạn.</div>'}</div>
      <div class="card"><h3>Việc đang làm quá 7 ngày</h3>
        ${d.aging.map(a => `<div class="hbar" style="grid-template-columns:70px 1fr 60px"><a class="code" href="#/projects/${a.projectId}?item=${a.id}">${esc(a.code)}</a><span>${esc(a.title)}</span><b>${a.days} ngày</b></div>`).join('') || '<div class="empty">Không có việc tồn lâu.</div>'}</div>
      ${showDepts ? `<div class="card" id="dashDepartments"><h3>Theo phòng chủ trì</h3><div class="tbl-scroll"><table class="table" data-testid="dash-departments"><thead><tr><th>Phòng ban</th><th class="num">Đang mở</th><th class="num">Chờ tiếp nhận</th><th class="num">Hoàn thành</th><th class="num">Quá hạn</th></tr></thead><tbody>
        ${d.byDepartment.map(x => `<tr><td>${d.scope === 'SYSTEM' && !d.departmentId ? `<a href="${esc(deptHref(x.id))}" title="Xem dashboard của phòng">${esc(x.name)}</a>` : esc(x.name)}</td>${cnt(x.open)}${cnt(x.pendingAccept || 0)}${cnt(x.completed)}${cnt(x.overdue, true)}</tr>`).join('') || '<tr><td colspan="5" class="empty">Chưa có số liệu.</td></tr>'}</tbody></table></div>
        <p class="muted xs">Việc tính cho đơn vị chủ trì; việc không giao về phòng nào tính cho phòng sở hữu dự án / sổ.</p></div>` : ''}
    </div></div>`;
  root.querySelector('#dashDept')?.addEventListener('change', e => view.apply({ departmentId: e.target.value }));
  root.querySelector('#dash-clear')?.addEventListener('click', () => view.apply({ departmentId: '' }, { focus: '#dashDept' }));
  root.querySelectorAll('[data-scroll]').forEach(b => b.addEventListener('click', () => {
    const target = root.querySelector('#' + b.dataset.scroll);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.remove('st-flash'); void target.offsetWidth; target.classList.add('st-flash');
  }));
  if (!canExport) return;
  // Kỳ báo cáo: không cần tải lại số liệu — chỉ ghi lên URL và cập nhật ô ngày, dòng khoảng ngày.
  const seg = $('#rep', root), fromEl = $('#repFrom', root), toEl = $('#repTo', root), btn = $('#weeklyBtn', root);
  const saveCustom = (f, t, ok) => { btn.disabled = !ok; replaceHashParams({ p: '', from: f, to: t }); };
  const { check } = bindPeriod(root, 'rep', {
    validate: (f, t) => (!f || !t ? 'Chọn đủ hai ngày' : t < f ? 'Ngày kết thúc trước ngày bắt đầu' : daysBetween(f, t) > REPORT_MAX_DAYS ? `Tối đa ${REPORT_MAX_DAYS} ngày` : ''),
    onPick: k => {
      pressSeg(seg, k); $('#repCustom', root).classList.add('hidden');
      fromEl.value = P[k][1]; toEl.value = P[k][2]; btn.disabled = !check();
      replaceHashParams({ p: k === 'week' ? '' : k, from: '', to: '' });
    },
    onCustom: saveCustom, onInput: saveCustom,
  });
  btn.disabled = !check();
  btn.addEventListener('click', async () => {
    if (!check(true)) return;
    const q = new URLSearchParams({ from: fromEl.value, to: toEl.value });
    if (deptParam) q.set('departmentId', deptParam);
    btn.disabled = true;
    try { const name = await download('/api/reports/weekly.docx?' + q); toast('Đã tải ' + name, 'ok'); } catch (error) { toast(errorMessage(error), 'err'); } finally { btn.disabled = !check(); }
  });
}
