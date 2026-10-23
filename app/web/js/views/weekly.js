// Kepper GĐ2b — "Tuần này": Báo cáo tuần bộ phận theo QC-TH-01 / QT-TH-01 / BM-TH-01, một trang, vài tab:
//   Nộp báo cáo · Báo muộn / vắng · Tổng hợp (TGĐ, thư ký, trưởng bộ phận) · Chấm điểm (thư ký / TGĐ) · Tiến độ dự án.
// Báo cáo tự điền sẵn từ MTL + kế hoạch tuần trước + Action Log giao ban; tự lưu nháp; gửi một lần — % ghi ngược vào MTL.
import { api } from '../api.js';
import { store } from '../store.js';
import { $, $$, esc, toast, errorMessage, debounce } from '../util.js';
import { rerender } from '../main.js';

const DAY = 86_400_000, H7 = 7 * 3_600_000;
const DONE = 'Hoàn thành', SELF = 'SELF', BGD = 'BGD';
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const fmtD = s => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
const fmtDY = s => (s ? `${fmtD(s)}/${s.slice(0, 4)}` : '');
const wday = s => WD[new Date(Date.parse(s + 'T00:00:00Z')).getUTCDay()];
const fmtTime = t => { if (!t) return ''; const x = new Date(new Date(t).getTime() + H7); return `${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')} ${WD[x.getUTCDay()]} ${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}`; };
const localInput = t => { if (!t) return ''; const x = new Date(new Date(t).getTime() + H7); return x.toISOString().slice(0, 16); };
const fromLocal = v => (v ? new Date(v + ':00+07:00').toISOString() : null);
const isOverdue = (r, f) => !!r.due && r.status !== DONE && r.due <= f;
const needsIssue = (r, f) => r.status === 'Chậm' || r.status === 'Vướng' || isOverdue(r, f);
const issueLabel = (r, f) => [r.status === 'Chậm' || r.status === 'Vướng' ? r.status : null, isOverdue(r, f) ? 'Quá hạn' : null].filter(Boolean).join(' · ');
const opts = (list, sel) => list.map(o => (Array.isArray(o) ? o : [o, o])).map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
const toneOf = t => ({ good: 'c-good', warn: 'c-warn', bad: 'c-bad' }[t] || 'c-idle');
const statusChip = (r, f) => `<span class="wk-chip ${r.status === DONE ? 'c-good' : needsIssue(r, f) ? 'c-bad' : 'c-idle'}">${esc(r.status)}${isOverdue(r, f) ? ' · Quá hạn' : ''}</span>`;
let keySeq = 0;
const newKey = () => `f${Date.now().toString(36)}${(keySeq++).toString(36)}`;
const blankIssue = () => ({ cause: '', solution: '', helpFrom: '', helpWhat: '', helpBy: '' });

const TABS = [['', 'Nộp báo cáo'], ['bao', 'Báo muộn / vắng'], ['tong-hop', 'Tổng hợp'], ['diem', 'Chấm điểm'], ['tien-do', 'Tiến độ dự án']];
let ctx = null; // danh mục + quyền, nạp một lần mỗi phiên
const st = { tab: '', week: null, dept: null, rep: null, form: null, dirty: false, saveTimer: null, sum: null, schedule: null };

export async function renderWeekly(root, tab, params, setCrumbs) {
  if (st.saveTimer && st.pending) { clearTimeout(st.saveTimer); st.saveTimer = null; saveDraft(); } // rời trang khi nháp chưa kịp lưu
  ctx = ctx && ctx.userId === store.me.id ? ctx : { ...(await api('/api/weekly/context')), userId: store.me.id };
  st.tab = TABS.some(t => t[0] === tab) ? tab : '';
  if ((st.tab === 'tong-hop' && !ctx.me.canSummary) || (st.tab === 'diem' && !ctx.me.canManage)) st.tab = '';
  // Thư ký / Ban GĐ không thuộc bộ phận phải nộp: mặc định mở Tổng hợp.
  if (!tab && !params.get('d') && ctx.me.canManage && !ctx.required.includes(ctx.me.departmentId) && !params.has('nop')) st.tab = 'tong-hop';
  st.week = ctx.weeks.includes(params.get('w')) ? params.get('w') : ctx.week;
  st.dept = Number(params.get('d')) || ctx.me.departmentId || ctx.required[0] || null;
  setCrumbs(`Tuần này · ${TABS.find(t => t[0] === st.tab)[1]}`);
  root.innerHTML = `<div class="wk" data-testid="weekly">
    <header class="wk-top"><div class="wk-bar">
      <div class="wk-brand"><b>BÁO CÁO TUẦN</b><span>BM-TH-01 · giao ban thứ Hai</span></div>
      <label class="wk-week">Tuần báo cáo (thứ Sáu)<select id="wkWeek" data-testid="wk-week">${ctx.weeks.map(f => `<option value="${f}"${f === st.week ? ' selected' : ''}>${fmtD(addDays(f, -4))} – ${fmtDY(f)}${f === ctx.week ? ' · tuần này' : ''}</option>`).join('')}</select></label>
      <span class="wk-chip c-idle" id="wkDeadline" data-testid="wk-deadline">—</span></div>
      <nav class="wk-tabs" role="tablist">${TABS.filter(([k]) => (k !== 'tong-hop' || ctx.me.canSummary) && (k !== 'diem' || ctx.me.canManage)).map(([k, l]) => `<a role="tab" href="${hrefOf(k)}" aria-selected="${k === st.tab}" data-testid="wk-tab-${k || 'nop'}">${l}</a>`).join('')}</nav>
    </header>
    <div id="wkBody" class="wk" style="gap:18px"></div></div>`;
  $('#wkWeek', root).onchange = e => { location.hash = hrefOf(st.tab, { w: e.target.value }); };
  const body = $('#wkBody', root);
  if (st.tab === '') await drawReport(body);
  else if (st.tab === 'bao') await drawNotices(body);
  else if (st.tab === 'tong-hop') await drawSummary(body);
  else if (st.tab === 'diem') await drawCompliance(body, params);
  else await drawProgress(body);
  drawDeadline();
}
function hrefOf(tab, { w = st.week, d = null } = {}) {
  const q = new URLSearchParams();
  if (w && w !== ctx.week) q.set('w', w);
  if (d) q.set('d', d); else if (!tab && st.dept && st.dept !== ctx.me.departmentId) q.set('d', st.dept);
  if (!tab && ctx.me.canManage && !ctx.required.includes(ctx.me.departmentId) && !q.has('d')) q.set('nop', '1');
  const s = q.toString();
  return `#/tuan${tab ? '/' + tab : ''}${s ? '?' + s : ''}`;
}
const scheduleNow = () => st.schedule || ctx.schedule;
// Vẽ lại một tab trên khung mới (bỏ trình xử lý sự kiện cũ, tránh gắn trùng).
function freshBody() { const old = $('#wkBody'), b = old.cloneNode(false); old.replaceWith(b); return b; }
function drawDeadline() {
  const c = $('#wkDeadline'); if (!c) return;
  const S = scheduleNow(), now = Date.now();
  if (!S) return;
  const dl = Date.parse(S.deadline), gr = Date.parse(S.grace);
  if (st.week !== ctx.week) { c.className = 'wk-chip c-idle'; c.textContent = `Giao ban ${wday(S.meetingDay)} ${fmtD(S.meetingDay)}`; return; }
  if (now <= dl) { const m = Math.round((dl - now) / 60000); c.className = `wk-chip ${m < 180 ? 'c-warn' : 'c-idle'}`; c.textContent = m < 1440 ? `Hạn nộp còn ${Math.floor(m / 60)} giờ ${m % 60} phút` : `Hạn nộp 17:30 ${wday(S.deadlineDay)} ${fmtD(S.deadlineDay)}`; }
  else if (now <= gr) { c.className = 'wk-chip c-bad'; c.textContent = `Quá 17:30 · nộp muộn đến 12:00 ${wday(addDays(S.deadlineDay, 1))}`; }
  else { c.className = 'wk-chip c-idle'; c.textContent = `Giao ban 08:30 ${wday(S.meetingDay)} ${fmtD(S.meetingDay)}`; }
}
const deptName = id => ctx.departments.find(d => d.id === Number(id))?.name || '';
const nameOf = id => st.rep?.names?.[id] || store.users.find(u => u.id === Number(id))?.fullName || '';
const ownersText = ids => (ids || []).map(nameOf).filter(Boolean).join(', ') || '<span class="muted">chưa giao người</span>';

// =====================================================================
// Tab 1 — Nộp báo cáo
// =====================================================================
async function drawReport(body) {
  if (!st.dept) { body.innerHTML = '<div class="wk-empty">Tài khoản chưa thuộc bộ phận nào. Liên hệ quản trị để gán bộ phận.</div>'; return; }
  const r = await api(`/api/weekly/report?week=${st.week}&departmentId=${st.dept}`);
  st.rep = r; st.schedule = r.schedule; st.dirty = false;
  st.form = structuredClone(r.report ? r.report.data : r.prefill);
  for (const k of ['results', 'ongoing', 'plans']) st.form[k] ||= [];
  st.form.other ||= '';
  const S = r.schedule, sub = r.report?.firstSubmittedAt;
  const editable = r.canEdit;
  body.innerHTML = `
    <div><h1>Báo cáo công việc tuần ${fmtD(S.from)} – ${fmtDY(S.to)}</h1>
      <p class="wk-lead">Nộp trước <b>17:30 ${wday(S.deadlineDay)} ${fmtD(S.deadlineDay)}</b>. Báo cáo đã <b>điền sẵn từ MTL</b>, kế hoạch tuần trước và Action Log giao ban — chỉ sửa chỗ khác thực tế. Hạng mục <b>Chậm</b>, <b>Vướng</b> hoặc <b>Quá hạn</b> phải có nguyên nhân, giải pháp và đề nghị hỗ trợ. Khi gửi, % tiến độ được ghi luôn vào MTL.</p></div>
    <section class="wk-card"><h2>Thông tin</h2>
      <div class="wk-grid">
        <label class="wk-f">Bộ phận${ctx.me.canManage || ctx.me.canSummary ? `<select id="wkDept" data-testid="wk-dept">${opts(ctx.departments.map(d => [d.id, d.name + (ctx.required.includes(d.id) ? '' : ' (không bắt buộc)')]), st.dept)}</select>` : `<span class="wk-ro" data-testid="wk-dept-name">${esc(r.department.name)}</span>`}</label>
        <label class="wk-f">Trưởng bộ phận (chịu trách nhiệm)<span class="wk-ro">${esc(r.leaders.join(', ') || '—')}</span></label>
        <label class="wk-f">Người lập<span class="wk-ro">${esc(r.report?.preparer || store.me.fullName)}</span></label>
      </div>
      ${sub ? `<div class="wk-banner ${toneOf(r.status.tone)}" data-testid="wk-submitted">Đã nộp ${fmtTime(sub)} — <b>${esc(r.status.label)}</b>${r.report.submitCount > 1 ? ` · đã gửi lại ${r.report.submitCount - 1} lần (lần cuối ${fmtTime(r.report.submittedAt)})` : ''}${r.report.submittedBy ? ` · người gửi: ${esc(r.report.submittedBy)}` : ''}. Sửa nếu cần rồi bấm <b>Gửi lại</b> — giờ nộp vẫn tính theo lần gửi đầu.</div>` : ''}
      ${!editable ? '<div class="wk-banner c-idle">Bạn chỉ xem báo cáo của bộ phận này.</div>' : ''}
      ${r.onBehalf && !sub ? `<div class="wk-banner c-warn">Bạn đang <b>nhập thay</b> cho ${esc(r.department.name)} (bộ phận gửi bằng Excel / email). Ghi giờ nhận email để tính đúng giờ nộp.
        <label class="wk-f" style="margin-top:8px;max-width:260px">Giờ nhận email<input type="datetime-local" id="wkReceived" data-testid="wk-received"></label></div>` : ''}
    </section>
    <section class="wk-card"><div class="wk-actions" style="justify-content:space-between">
      <p class="wk-note" style="max-width:60ch" data-testid="wk-prefill-note">${prefillNote(r)}</p>
      ${editable ? '<button class="btn" type="button" id="wkRefresh" data-testid="wk-refresh">Làm mới từ MTL</button>' : ''}</div></section>
    <section class="wk-card"><h2>I. Công việc tuần trước <small>${fmtD(S.from)} – ${fmtD(S.to)} · kế hoạch đã đăng ký, việc TGĐ giao, việc phát sinh</small></h2>
      <div class="wk-list" id="wkL-results"></div>
      ${editable ? '<div class="wk-actions"><button class="btn ghost" type="button" data-add="results" data-testid="wk-add-results">+ Thêm hạng mục</button></div>' : ''}</section>
    <section class="wk-card"><h2>II. Công việc đang thực hiện <small>việc kéo dài nhiều tuần</small></h2>
      <div class="wk-list" id="wkL-ongoing"></div>
      ${editable ? '<div class="wk-actions"><button class="btn ghost" type="button" data-add="ongoing" data-testid="wk-add-ongoing">+ Thêm việc đang thực hiện</button></div>' : ''}</section>
    <section class="wk-card"><h2>III. Kế hoạch tuần mới <small>${fmtD(S.nextFrom)} – ${fmtD(S.nextTo)}</small></h2>
      <div class="wk-list" id="wkL-plans"></div>
      ${editable ? '<div class="wk-actions"><button class="btn ghost" type="button" data-add="plans" data-testid="wk-add-plans">+ Thêm hạng mục</button></div>' : ''}</section>
    <section class="wk-card"><h2>IV. Kiến nghị khác</h2>
      <label class="wk-f">Nội dung (nếu có)<textarea id="wkOther" rows="3" placeholder="Đề xuất, kiến nghị không gắn với một việc cụ thể" ${editable ? '' : 'readonly'} data-testid="wk-other">${esc(st.form.other)}</textarea></label></section>
    ${editable ? `<section class="wk-card"><ul class="wk-errs" id="wkErrs" hidden data-testid="wk-errors"></ul>
      <div class="wk-actions"><button class="btn btn-primary" type="button" id="wkSubmit" data-testid="wk-submit">${sub ? 'Gửi lại' : 'Gửi báo cáo'}</button>
        <span class="wk-note" id="wkSaveMsg" data-testid="wk-save-msg">${r.report && !sub ? `Bản nháp lưu lúc ${fmtTime(r.report.updatedAt)}` : sub ? '' : 'Bản nháp tự lưu khi bạn sửa.'}</span></div></section>` : ''}`;
  drawLists();
  bindReport(body);
}
function prefillNote(r) {
  const p = r.prefill, linked = [...p.results, ...p.ongoing, ...p.plans].filter(x => x.itemId).length;
  const parts = [`${linked} hạng mục MTL của bộ phận`];
  if (r.hasPrev) parts.push('kế hoạch tuần trước');
  if (r.actions) parts.push(`${r.actions} việc trong Action Log giao ban`);
  return r.report ? `Đang mở bản đã lưu. Bấm “Làm mới từ MTL” để thêm hạng mục mới / cập nhật hạn, người phụ trách từ MTL (giữ nguyên phần bạn đã sửa).`
    : `Đã điền sẵn từ: ${parts.join(', ')}. Kiểm tra tình trạng, % và bổ sung việc phát sinh.`;
}
function drawLists() { for (const k of ['results', 'ongoing', 'plans']) drawList(k); }
function drawList(list) {
  const box = $(`#wkL-${list}`); if (!box) return;
  const rows = st.form[list];
  box.innerHTML = rows.map((r, i) => (list === 'plans' ? planHtml(r, i) : rowHtml(list, r, i))).join('')
    || `<div class="wk-empty">${list === 'results' ? 'Không có hạng mục đến hạn trong tuần. Bấm “Thêm hạng mục” để ghi việc phát sinh / TGĐ giao.' : list === 'ongoing' ? 'Không có việc kéo dài nhiều tuần.' : 'Chưa có hạng mục cho tuần mới.'}</div>`;
}
function redrawRow(list, i) {
  const el = $(`[data-list="${list}"][data-i="${i}"]`);
  if (el) el.outerHTML = list === 'plans' ? planHtml(st.form[list][i], i) : rowHtml(list, st.form[list][i], i);
}
const members = () => st.rep?.members || [];
const ownerSelect = (r, key = 'owner') => `<select data-k="${key}"><option value="">— Chọn —</option>${opts(members().map(u => [u.id, u.fullName + (u.title ? ` · ${u.title}` : '')]), r.ownerIds?.[0] ?? '')}</select>`;
const testKey = r => esc(r.ref || r.key);

function rowHtml(list, r, i) {
  const f = st.week, ed = st.rep.canEdit, linked = !!r.itemId, od = isOverdue(r, f);
  const dis = ed ? '' : 'disabled';
  const pct = r.pctLocked
    ? `<label class="wk-f">% hoàn thành<input type="number" value="${esc(r.pct)}" readonly title="Tự tính theo checklist của hạng mục"><span class="wk-note">tự tính theo checklist</span></label>`
    : `<label class="wk-f">% hoàn thành<span class="wk-pct"><input type="number" min="0" max="100" step="5" inputmode="numeric" data-k="pct" value="${esc(r.pct)}" ${dis} data-testid="wk-pct-${testKey(r)}">${ed ? [50, 100].map(v => `<button type="button" data-pct="${v}" class="${Number(r.pct) === v ? 'on' : ''}">${v === 100 ? '✓ Xong' : v + '%'}</button>`).join('') : ''}</span></label>`;
  const status = `<label class="wk-f">Tình trạng<select data-k="status" ${dis} data-testid="wk-status-${testKey(r)}">${opts(ctx.statuses, r.status)}</select></label>`;
  return `<div class="wk-row${linked ? ' linked' : ''}${r.status === DONE ? ' done' : ''}" data-list="${list}" data-i="${i}" data-testid="wk-row-${testKey(r)}">
    <div class="wk-row-head">${linked ? `<span class="code">${esc(r.ref)}</span>${r.step ? `<span>Bước ${esc(r.step)}</span>` : ''}${r.critical ? '<span class="crit" title="Đường găng">● găng</span>' : ''}${r.milestone ? '<span title="Mốc">◆ mốc</span>' : ''}<span class="wk-chip c-idle">MTL</span>`
      : `<span>${list === 'ongoing' ? 'Việc' : 'Hạng mục'} ${i + 1}</span>${r.source === 'TGĐ giao' ? '<span class="wk-chip c-gold">TGĐ giao</span>' : ''}`}
      ${od ? '<span class="wk-chip c-bad">Quá hạn</span>' : ''}
      ${ed ? `<span class="x">${list === 'results' && r.status !== DONE && !st.form.ongoing.some(o => o.key === r.key) ? `<button class="btn x" type="button" data-move="${i}">→ Đang thực hiện</button>` : ''}<button class="btn x" type="button" data-del="${list}" data-i="${i}" title="Bỏ khỏi báo cáo tuần này">Bỏ</button></span>` : ''}</div>
    ${linked ? `<div class="wk-title">${esc(r.task)}</div>
      <p class="wk-note">Phụ trách: ${ownersText(r.ownerIds)} · Deadline <b>${fmtDY(r.due)}</b>${list === 'ongoing' && r.start ? ` · Bắt đầu ${fmtDY(r.start)}` : ''}</p>
      <div class="r-meta m3">${status}${pct}${list === 'ongoing' ? `<label class="wk-f">Việc sẽ làm tuần tới<input data-k="next" value="${esc(r.next)}" placeholder="Bước tiếp theo cụ thể" ${dis} data-testid="wk-next-${testKey(r)}"></label>` : '<span></span>'}</div>`
    : `<div class="r-main"><label class="wk-f">Hạng mục công việc<textarea data-k="task" rows="1" placeholder="Động từ + kết quả, VD: Nộp hồ sơ lên Sở" ${dis} data-testid="wk-task-${testKey(r)}">${esc(r.task)}</textarea></label>${status}</div>
      <div class="r-meta">
        <label class="wk-f">Nguồn<select data-k="source" ${dis}>${opts(ctx.sources, r.source)}</select></label>
        <label class="wk-f">Phụ trách${ed ? ownerSelect(r) : `<span class="wk-ro">${ownersText(r.ownerIds)}</span>`}</label>
        <label class="wk-f">Deadline<input type="date" data-k="due" value="${esc(r.due)}" ${dis}></label>
        ${pct}
      </div>
      ${list === 'ongoing' ? `<div class="r-meta m3"><label class="wk-f">Ngày bắt đầu<input type="date" data-k="start" value="${esc(r.start || '')}" ${dis}></label><label class="wk-f wide" style="grid-column:span 2">Việc sẽ làm tuần tới<input data-k="next" value="${esc(r.next || '')}" placeholder="Bước tiếp theo cụ thể" ${dis}></label></div>` : ''}`}
    ${needsIssue(r, f) ? issueHtml(r, dis) : ''}
  </div>`;
}
function issueHtml(r, dis) {
  const f = st.week;
  const help = [['', '— Chọn —'], [BGD, 'Ban Giám đốc'], ...ctx.departments.filter(d => d.id !== st.dept).map(d => [`D${d.id}`, d.name]), [SELF, 'Tự xử lý – không cần hỗ trợ']];
  return `<div class="wk-issue" data-testid="wk-issue-${testKey(r)}"><p>${esc(issueLabel(r, f))}: nêu nguyên nhân, giải pháp và đề nghị hỗ trợ</p>
    <label class="wk-f">Nguyên nhân / khó khăn<textarea data-k="cause" rows="1" ${dis} data-testid="wk-cause-${testKey(r)}">${esc(r.cause)}</textarea></label>
    <label class="wk-f">Giải pháp bộ phận đề xuất<textarea data-k="solution" rows="1" ${dis} data-testid="wk-solution-${testKey(r)}">${esc(r.solution)}</textarea></label>
    <div class="r-meta">
      <label class="wk-f">Đề nghị hỗ trợ từ<select data-k="helpFrom" ${dis} data-testid="wk-help-${testKey(r)}">${opts(help, r.helpFrom)}</select></label>
      <label class="wk-f">Nội dung cần hỗ trợ<input data-k="helpWhat" value="${esc(r.helpWhat)}" ${r.helpFrom === SELF ? 'disabled placeholder="Không cần"' : dis} data-testid="wk-helpwhat-${testKey(r)}"></label>
      <label class="wk-f">Cần trước ngày<input type="date" data-k="helpBy" value="${esc(r.helpBy)}" ${r.helpFrom === SELF ? 'disabled' : dis}></label>
    </div></div>`;
}
function planHtml(p, i) {
  const ed = st.rep.canEdit, dis = ed ? '' : 'disabled', linked = !!p.itemId;
  return `<div class="wk-row${linked ? ' linked' : ''}" data-list="plans" data-i="${i}" data-testid="wk-plan-${testKey(p)}">
    <div class="wk-row-head">${linked ? `<span class="code">${esc(p.ref)}</span>${p.step ? `<span>Bước ${esc(p.step)}</span>` : ''}<span class="wk-chip c-idle">MTL</span>` : `<span>Hạng mục ${i + 1}</span>`}
      ${ed ? `<span class="x"><button class="btn x" type="button" data-del="plans" data-i="${i}">Bỏ</button></span>` : ''}</div>
    ${linked ? `<div class="wk-title">${esc(p.task)}</div>
      <div class="r-meta m3"><label class="wk-f">Phụ trách${p.ownerIds?.length && !p.ownerPicked ? `<span class="wk-ro">${ownersText(p.ownerIds)}</span>` : ed ? ownerSelect(p) : '—'}</label>
        <label class="wk-f">Deadline<span class="wk-ro">${fmtDY(p.due)}</span></label>
        <label class="wk-f">Sản phẩm đầu ra<input data-k="output" value="${esc(p.output)}" placeholder="VD: Hồ sơ nộp Sở, biên bản ký" ${dis}></label></div>`
    : `<div class="r-main"><label class="wk-f">Hạng mục công việc<textarea data-k="task" rows="1" ${dis} data-testid="wk-ptask-${testKey(p)}">${esc(p.task)}</textarea></label>
        <label class="wk-f">Căn cứ<select data-k="basis" ${dis}>${opts(ctx.sources, p.basis)}</select></label></div>
      <div class="r-meta m3"><label class="wk-f">Phụ trách${ed ? ownerSelect(p) : `<span class="wk-ro">${ownersText(p.ownerIds)}</span>`}</label>
        <label class="wk-f">Deadline<input type="date" data-k="due" value="${esc(p.due)}" ${dis}></label>
        <label class="wk-f">Sản phẩm đầu ra<input data-k="output" value="${esc(p.output)}" placeholder="VD: Hồ sơ nộp Sở, biên bản ký" ${dis}></label></div>`}
  </div>`;
}

function bindReport(body) {
  $('#wkDept')?.addEventListener('change', e => { location.hash = hrefOf('', { d: e.target.value }); });
  if (!st.rep.canEdit) return;
  const onField = e => {
    const el = e.target, row = el.closest('[data-list]');
    if (!row || !el.dataset.k) return;
    const list = row.dataset.list, i = Number(row.dataset.i), r = st.form[list][i], k = el.dataset.k;
    let redraw = false;
    if (k === 'owner') { r.ownerIds = el.value ? [Number(el.value)] : []; if (r.itemId) r.ownerPicked = true; }
    else if (k === 'pct') {
      r.pct = el.value === '' ? '' : Math.max(0, Math.min(100, Math.round(Number(el.value))));
      if (e.type === 'change') { if (r.pct === 100 && r.status !== DONE) { r.status = DONE; redraw = true; } else if (r.pct !== 100 && r.status === DONE) { r.status = 'Đúng tiến độ'; redraw = true; } }
    } else r[k] = el.value;
    if (k === 'status' && el.value === DONE) r.pct = 100;
    if (e.type === 'change' && ['status', 'helpFrom', 'due'].includes(k)) redraw = true;
    if (redraw) redrawRow(list, i);
    changed();
  };
  body.addEventListener('input', onField);
  body.addEventListener('change', onField);
  $('#wkOther', body).addEventListener('input', e => { st.form.other = e.target.value; changed(); });
  body.addEventListener('click', async e => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const list = add.dataset.add;
      st.form[list].push(list === 'plans' ? { key: newKey(), itemId: null, task: '', basis: 'KH tháng', ownerIds: [], due: '', output: '' }
        : { key: newKey(), itemId: null, task: '', source: 'Phát sinh', ownerIds: [], due: '', status: 'Đúng tiến độ', pct: '', ...blankIssue(), ...(list === 'ongoing' ? { start: '', next: '' } : {}) });
      drawList(list); changed();
      $$(`[data-list="${list}"]`).at(-1)?.querySelector('textarea')?.focus();
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) { st.form[del.dataset.del].splice(Number(del.dataset.i), 1); drawList(del.dataset.del); changed(); return; }
    const mv = e.target.closest('[data-move]');
    if (mv) { const r = st.form.results[Number(mv.dataset.move)]; st.form.ongoing.push({ ...structuredClone(r), next: r.next || '', start: r.start || '' }); drawLists(); changed(); toast('Đã thêm vào Phần II — hạng mục vẫn giữ ở Phần I để báo tình trạng tuần này', 'ok'); return; }
    const p = e.target.closest('[data-pct]');
    if (p) { const row = p.closest('[data-list]'), list = row.dataset.list, i = Number(row.dataset.i), r = st.form[list][i]; r.pct = Number(p.dataset.pct); if (r.pct === 100) r.status = DONE; else if (r.status === DONE) r.status = 'Đúng tiến độ'; redrawRow(list, i); changed(); return; }
    if (e.target.closest('#wkRefresh')) { await refreshFromMtl(); return; }
    if (e.target.closest('#wkSubmit')) await submit(e.target.closest('#wkSubmit'));
  });
}
function changed() {
  st.dirty = true;
  const sub = st.rep.report?.firstSubmittedAt;
  const msg = $('#wkSaveMsg');
  if (sub) { if (msg) msg.textContent = 'Có thay đổi chưa gửi — bấm “Gửi lại” để cập nhật báo cáo đã nộp.'; return; }
  if (msg) msg.textContent = 'Đang lưu nháp…';
  st.pending = { week: st.week, dept: st.dept, form: st.form };
  clearTimeout(st.saveTimer);
  st.saveTimer = setTimeout(saveDraft, 1200);
}
async function saveDraft() {
  const p = st.pending; st.pending = null; st.saveTimer = null;
  if (!p) return;
  const { week, dept, form: data } = p;
  try {
    const r = await api('/api/weekly/report', { method: 'PUT', body: { week, departmentId: dept, data } });
    if (week === st.week && dept === st.dept) { const m = $('#wkSaveMsg'); if (m) m.textContent = `Bản nháp lưu lúc ${fmtTime(r.updatedAt)}`; st.dirty = false; }
  } catch (error) { const m = $('#wkSaveMsg'); if (m) m.textContent = 'Chưa lưu được nháp: ' + errorMessage(error); }
}
// Làm mới từ MTL: thêm hạng mục mới, cập nhật hạn / người phụ trách / % (khi người lập chưa sửa %), giữ phần đã nhập.
async function refreshFromMtl() {
  const r = await api(`/api/weekly/report?week=${st.week}&departmentId=${st.dept}`);
  const all = () => [...st.form.results, ...st.form.ongoing, ...st.form.plans];
  let added = 0, updated = 0;
  for (const list of ['results', 'ongoing', 'plans']) for (const n of r.prefill[list]) {
    if (!n.itemId) { if (n.actionRef && !all().some(x => x.actionRef === n.actionRef)) { st.form[list].push(n); added++; } continue; }
    const mine = all().filter(x => x.itemId === n.itemId);
    if (!mine.length) { st.form[list].push(n); added++; continue; }
    for (const x of mine) {
      for (const k of ['task', 'ref', 'step', 'due', 'start', 'pctLocked', 'critical', 'milestone']) if (n[k] !== undefined) x[k] = n[k];
      if (!x.ownerPicked && n.ownerIds) x.ownerIds = n.ownerIds;
      if (n.pct0 !== undefined && (x.pct === x.pct0 || x.pctLocked)) { x.pct = n.pct; x.pct0 = n.pct0; x.status = n.status; }
      updated++;
    }
  }
  st.rep.names = { ...st.rep.names, ...r.names };
  drawLists(); changed();
  toast(`Đã làm mới từ MTL: thêm ${added}, cập nhật ${updated} hạng mục`, 'ok');
}
async function submit(btn) {
  const errs = $('#wkErrs');
  btn.disabled = true; clearTimeout(st.saveTimer); st.saveTimer = null; st.pending = null;
  try {
    const body = { week: st.week, departmentId: st.dept, data: st.form };
    const rec = $('#wkReceived')?.value; if (rec) body.receivedAt = fromLocal(rec);
    const r = await api('/api/weekly/submit', { method: 'POST', body });
    errs.hidden = true;
    toast(`Đã gửi báo cáo — ${r.status.label}${r.progressUpdated ? ` · cập nhật % ${r.progressUpdated} hạng mục MTL` : ''}${r.progressSkipped ? ` · ${r.progressSkipped} hạng mục không có quyền cập nhật %` : ''}`, 'ok');
    await drawReport(freshBody()); drawDeadline();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    btn.disabled = false;
    const list = error.body?.errors || [errorMessage(error)];
    errs.hidden = false; errs.innerHTML = list.map(x => `<li>${esc(x)}</li>`).join('');
    $('#wkSaveMsg').textContent = error.body?.errors ? `Còn ${list.length} mục cần sửa.` : '';
    errs.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// =====================================================================
// Tab 2 — Báo nộp muộn / vắng (Điều 6, 7)
// =====================================================================
async function drawNotices(body) {
  const list = await api(`/api/weekly/notices?week=${st.week}`);
  st.schedule = st.week === ctx.week ? ctx.schedule : null;
  const S = scheduleNow() || {};
  const mine = ctx.me.canManage ? ctx.departments : ctx.departments.filter(d => d.id === ctx.me.departmentId);
  const dept = mine.some(d => d.id === st.dept) ? st.dept : mine[0]?.id;
  const people = deptId => store.users.filter(u => u.departmentId === Number(deptId) && u.role !== 'admin' && u.id !== store.me.id);
  body.innerHTML = `
    <div><h1>Báo nộp muộn hoặc vắng mặt</h1>
      <p class="wk-lead">Nộp muộn: báo trước 17:30 ${S.deadlineDay ? `${wday(S.deadlineDay)} ${fmtD(S.deadlineDay)}` : 'thứ Sáu'}, nộp chậm nhất 12:00 hôm sau. Vắng giao ban: báo trước 17:30 thứ Sáu (đột xuất trước 08:00 ngày giao ban) và cử cấp phó hoặc người được ủy quyền dự thay. Vắng có báo trước vẫn phải nộp báo cáo đúng hạn.</p></div>
    ${mine.length ? `<section class="wk-card" id="wkNoticeForm">
      <div class="wk-grid">
        <label class="wk-f">Loại thông báo<select id="nType" data-testid="wk-n-type">${opts([['LATE', 'Nộp báo cáo muộn'], ['ABSENT', 'Vắng mặt giao ban']], 'LATE')}</select></label>
        <label class="wk-f">Bộ phận<select id="nDept" ${mine.length < 2 ? 'disabled' : ''}>${opts(mine.map(d => [d.id, d.name]), dept)}</select></label>
        <label class="wk-f">Lý do<select id="nReason" data-testid="wk-n-reason">${opts([['', '— Chọn —'], ...Object.entries(ctx.reasons)], '')}</select></label>
        <label class="wk-f" id="nExtraWrap">Giờ nộp dự kiến<input type="datetime-local" id="nExpected" data-testid="wk-n-expected" value="${S.deadlineDay ? `${addDays(S.deadlineDay, 1)}T10:00` : ''}"></label>
      </div>
      <label class="wk-f">Ghi chú ngắn (không bắt buộc, tối đa 200 ký tự)<input id="nNote" maxlength="200" placeholder="Không ghi chi tiết sức khoẻ / việc riêng" data-testid="wk-n-note"></label>
      <ul class="wk-errs" id="nErrs" hidden></ul>
      <div class="wk-actions"><button class="btn btn-primary" type="button" id="nSend" data-testid="wk-n-send">Gửi thông báo</button><span class="wk-note">Thư ký giao ban, Ban Giám đốc và PMO nhận thông báo ngay.</span></div>
    </section>` : '<div class="wk-empty">Tài khoản chưa thuộc bộ phận nào.</div>'}
    <section class="wk-card"><h2>Thông báo trong tuần ${fmtD(addDays(st.week, -4))} – ${fmtDY(st.week)}</h2>
      ${list.length ? `<div class="wk-table"><table><thead><tr><th>Bộ phận</th><th>Loại</th><th>Lý do</th><th>Giờ nộp dự kiến / người dự thay</th><th>Người báo · lúc</th><th></th></tr></thead><tbody data-testid="wk-n-list">
        ${list.map(n => `<tr><td><b>${esc(deptName(n.departmentId))}</b></td><td>${esc(n.typeLabel)}</td><td>${esc(n.reasonLabel)}${n.note ? `<br><span class="wk-note">${esc(n.note)}</span>` : ''}</td>
          <td>${n.type === 'LATE' ? fmtTime(n.expectedAt) : esc(n.substitute || '')}</td><td>${esc(n.createdBy || '')}<br><span class="wk-note">${fmtTime(n.createdAt)}</span></td>
          <td>${n.createdById === store.me.id || ctx.me.canManage ? `<button class="btn x" type="button" data-ndel="${n.id}">Xoá</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="wk-empty">Chưa có thông báo nào.</div>'}
    </section>`;
  const swap = () => {
    const t = $('#nType', body)?.value, d = $('#nDept', body)?.value;
    const w = $('#nExtraWrap', body); if (!w) return;
    w.innerHTML = t === 'LATE' ? `Giờ nộp dự kiến<input type="datetime-local" id="nExpected" data-testid="wk-n-expected" value="${S.deadlineDay ? `${addDays(S.deadlineDay, 1)}T10:00` : ''}">`
      : `Người dự thay (cấp phó / được ủy quyền)<select id="nSub" data-testid="wk-n-sub"><option value="">— Chọn —</option>${opts(people(d).map(u => [u.id, u.fullName + (u.displayTitle ? ` · ${u.displayTitle}` : '')]), '')}</select>`;
  };
  $('#nType', body)?.addEventListener('change', swap);
  $('#nDept', body)?.addEventListener('change', swap);
  body.addEventListener('click', async e => {
    if (e.target.closest('#nSend')) {
      const b = { week: st.week, departmentId: Number($('#nDept', body).value), type: $('#nType', body).value, reason: $('#nReason', body).value, note: $('#nNote', body).value };
      if (b.type === 'LATE') b.expectedAt = fromLocal($('#nExpected', body)?.value); else b.substituteId = Number($('#nSub', body)?.value) || null;
      try { await api('/api/weekly/notices', { method: 'POST', body: b }); toast('Đã gửi thông báo', 'ok'); await drawNotices(freshBody()); }
      catch (error) { const u = $('#nErrs', body); u.hidden = false; u.innerHTML = `<li>${esc(errorMessage(error))}</li>`; }
    }
    const del = e.target.closest('[data-ndel]');
    if (del) { try { await api(`/api/weekly/notices/${del.dataset.ndel}`, { method: 'DELETE' }); toast('Đã xoá thông báo', 'ok'); await drawNotices(freshBody()); } catch (error) { toast(errorMessage(error), 'err'); } }
  });
}

// =====================================================================
// Tab 3 — Tổng hợp giao ban (bước 4–7 QT-TH-01)
// =====================================================================
async function drawSummary(body) {
  const s = await api(`/api/weekly/summary?week=${st.week}`);
  st.sum = s; st.schedule = s.schedule;
  const S = s.schedule, f = st.week, M = s.canManage, md = s.meeting || {};
  const names = id => s.names?.[id] || '';
  const k = s.kpis;
  const actions = structuredClone(md.actions || []);
  st.actions = actions;
  body.innerHTML = `
    <div><h1>Tổng hợp giao ban <span style="color:var(--gold)">08:30 ${wday(S.meetingDay)} ${fmtDY(S.meetingDay)}</span> <span class="wk-secret">BẢO MẬT</span></h1>
      <p class="wk-lead">Báo cáo tuần ${fmtD(S.from)} – ${fmtDY(S.to)}. Thư ký rà trạng thái nộp, gom yêu cầu hỗ trợ và gửi bản tổng hợp cho TGĐ và các trưởng bộ phận trước 08:00. Trưởng bộ phận đọc trước, chuẩn bị trả lời yêu cầu gửi tới bộ phận mình.</p></div>
    <div class="wk-kpis" data-testid="wk-kpis">${[[`${k.submitted}/${k.total}`, 'Bộ phận đã nộp'], [k.overdue, 'Hạng mục quá hạn'], [k.stuck, 'Chậm / vướng'], [k.helps, 'Yêu cầu hỗ trợ']].map(([v, l]) => `<div class="wk-kpi"><b>${v}</b><span>${l}</span></div>`).join('')}</div>
    <section class="wk-card"><h2>Tình trạng nộp ${M ? '<small>điểm danh và "không đạt" ghi ngay khi chọn</small>' : ''}</h2>
      <div class="wk-table"><table><thead><tr><th>Bộ phận</th><th>Trạng thái</th><th>Giờ nộp</th><th>Hạng mục</th><th>Chậm/Vướng</th><th>Quá hạn</th><th>Vắng</th>${M ? '<th>Điểm danh</th><th>Không đạt</th>' : ''}</tr></thead><tbody data-testid="wk-status-table">
      ${s.rows.map(r => `<tr data-testid="wk-srow-${r.id}"><td><b>${esc(r.name)}</b>${r.submittedBy ? `<br><span class="wk-note">${esc(r.submittedBy)}</span>` : ''}</td>
        <td><span class="wk-chip ${toneOf(r.status.tone)}">${esc(r.status.label)}</span>${r.draft ? '<br><span class="wk-note">đang có bản nháp</span>' : ''}${M && !r.submittedAt ? `<br><a class="wk-note" href="${hrefOf('', { d: r.id })}">Nhập thay</a>` : ''}</td>
        <td>${r.submittedAt ? fmtTime(r.submittedAt) : '—'}${r.resubmits ? `<br><span class="wk-note">gửi lại ${r.resubmits} lần</span>` : ''}</td>
        <td>${r.items ?? '—'}</td><td>${r.stuck ?? '—'}</td><td>${r.overdue ?? '—'}</td>
        <td>${r.absent ? `Vắng${r.absent.substitute ? ` · thay: ${esc(r.absent.substitute)}` : ''}${r.absent.noticed ? '' : ' <span class="wk-chip c-bad">báo muộn</span>'}` : r.late.length ? `<span class="wk-note">báo muộn: ${esc(r.late[0].reason)}</span>` : ''}</td>
        ${M ? `<td><select data-att="${r.id}" data-testid="wk-att-${r.id}">${opts([['', '—'], ...Object.entries(ctx.attendance)], r.attendance || '')}</select></td><td><input type="checkbox" data-failed="${r.id}" ${r.failed ? 'checked' : ''} aria-label="Báo cáo không đạt"></td>` : ''}</tr>`).join('')}
      </tbody></table></div></section>
    ${s.actionReview.length ? `<section class="wk-card"><h2>Rà Action Log tuần trước <small>08:30 – 08:35</small></h2>
      <div class="wk-table"><table><thead><tr><th>Việc</th><th>Bộ phận</th><th>Phụ trách</th><th>Hạn</th><th>Kết quả</th></tr></thead><tbody data-testid="wk-action-review">
      ${s.actionReview.map(a => `<tr><td>${esc(a.task)}</td><td>${esc(a.department)}</td><td>${esc(a.owner || '')}</td><td>${fmtD(a.due)}</td><td>${a.status ? `<span class="wk-chip ${a.status === DONE ? 'c-good' : a.overdue || ['Chậm', 'Vướng'].includes(a.status) ? 'c-bad' : 'c-idle'}">${esc(a.status)}${a.pct !== '' && a.pct != null ? ` · ${a.pct}%` : ''}</span>` : `<span class="wk-chip ${a.overdue ? 'c-bad' : 'c-idle'}">chưa báo cáo</span>`}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    <section class="wk-card"><h2>Yêu cầu hỗ trợ, phối hợp <small>xử lý lúc 09:15 – 09:25 · TGĐ kết luận từng yêu cầu</small></h2>
      <div class="wk-help" data-testid="wk-helps">${s.helps.length ? s.helps.map(g => `<div><h3>Gửi ${esc(g.to)} · ${g.list.length}</h3><div class="wk-help">${g.list.map(h => helpHtml(h, M)).join('')}</div></div>`).join('')
        : '<div class="wk-empty">Chưa có yêu cầu hỗ trợ nào trong các báo cáo đã nộp.</div>'}</div></section>
    <section class="wk-card" id="wkActions"><h2>Kết luận giao ban & Action Log <small>${s.publishedAt ? `đã phát hành ${fmtTime(s.publishedAt)}` : 'phát hành trước 14:00 ngày giao ban'} · việc tự vào Phần I báo cáo tuần sau</small></h2>
      <div id="wkActList"></div>
      ${M ? `<div class="wk-actions"><button class="btn ghost" type="button" id="actAdd" data-testid="wk-act-add">+ Thêm việc</button>
        <button class="btn" type="button" id="actSave" data-testid="wk-act-save">Lưu Action Log</button>
        <button class="btn btn-primary" type="button" id="actPublish" ${s.publishedAt ? 'disabled' : ''} data-testid="wk-act-publish">${s.publishedAt ? 'Đã phát hành' : 'Phát hành kết luận + Action Log'}</button></div>` : ''}</section>
    <section class="wk-card"><h2>Chi tiết từng bộ phận</h2><div style="display:grid;gap:10px">${s.rows.map(r => deptDetail(r, f, names)).join('')}</div></section>
    <section class="wk-card"><div class="wk-actions"><button class="btn btn-primary" type="button" id="copySum" data-testid="wk-copy">Sao chép bản tổng hợp</button>
      <span class="wk-note" id="copyMsg">Dán vào email công ty hoặc nhóm chat đã được phê duyệt gửi TGĐ và các trưởng bộ phận. Văn bản không chứa họ tên người phụ trách.</span></div>
      <textarea id="copyFallback" rows="8" hidden readonly></textarea></section>
    ${M ? setupHtml(s) : ''}`;
  drawActions();
  bindSummary(body, s);
}
function helpHtml(h, M) {
  const c = h.conclusion || {};
  return `<div class="wk-help-item" data-help="${esc(h.key)}" data-testid="wk-helpitem">
    <div><b>${esc(h.from)}</b>: ${esc(h.what)} <span class="wk-note">— cho việc “${esc(h.task)}”${h.ref ? ` (${esc(h.ref)})` : ''} · ${esc(h.status)}${h.by ? ` · cần trước ${fmtD(h.by)}` : ''}</span></div>
    ${M ? `<div class="r-meta"><label class="wk-f">Kết luận của TGĐ<select data-hk="decision">${opts([['', '— Chưa kết luận —'], ...Object.entries(ctx.decisions)], c.decision || '')}</select></label>
      <label class="wk-f">Bộ phận phối hợp<select data-hk="departmentId" ${c.decision === 'ASSIGN' ? '' : 'disabled'}>${opts([['', '—'], ...ctx.departments.map(d => [d.id, d.name])], c.departmentId || '')}</select></label>
      <label class="wk-f">Ghi chú kết luận<input data-hk="note" value="${esc(c.note || '')}" maxlength="500"></label>
      <button class="btn x" type="button" data-toact="${esc(h.key)}" title="Thêm vào Action Log">+ Action Log</button></div>`
      : c.decision ? `<div class="wk-note"><b>Kết luận:</b> ${esc(ctx.decisions[c.decision])}${c.departmentId ? ` — ${esc(deptName(c.departmentId))}` : ''}${c.note ? `: ${esc(c.note)}` : ''}</div>` : ''}
  </div>`;
}
function drawActions() {
  const box = $('#wkActList'); if (!box) return;
  const M = st.sum.canManage, a = st.actions;
  const people = deptId => store.users.filter(u => u.departmentId === Number(deptId) && u.role !== 'admin');
  if (!a.length) { box.innerHTML = '<div class="wk-empty">Chưa có việc nào trong Action Log.</div>'; return; }
  box.innerHTML = `<div class="wk-table"><table><thead><tr><th style="width:40%">Việc</th><th>Bộ phận</th><th>Phụ trách</th><th>Hạn</th>${M ? '<th></th>' : ''}</tr></thead><tbody data-testid="wk-act-list">${a.map((x, i) => M
    ? `<tr data-ai="${i}"><td><textarea data-ak="task" rows="1" data-testid="wk-act-task-${i}">${esc(x.task)}</textarea></td>
      <td><select data-ak="departmentId" data-testid="wk-act-dept-${i}">${opts([['', '— Chọn —'], ...ctx.departments.map(d => [d.id, d.name])], x.departmentId || '')}</select></td>
      <td><select data-ak="ownerId"><option value="">—</option>${opts(people(x.departmentId).map(u => [u.id, u.fullName]), x.ownerId || '')}</select></td>
      <td><input type="date" data-ak="due" value="${esc(x.due || '')}" data-testid="wk-act-due-${i}"></td><td><button class="btn x" type="button" data-adel="${i}">Xoá</button></td></tr>`
    : `<tr><td>${esc(x.task)}</td><td>${esc(deptName(x.departmentId))}</td><td>${esc(st.sum.names?.[x.ownerId] || '')}</td><td>${fmtD(x.due)}</td></tr>`).join('')}</tbody></table></div>`;
}
function deptDetail(r, f, names) {
  if (!r.report) return `<div class="wk-empty">${esc(r.name)}: ${esc(r.status.label.toLowerCase())}.</div>`;
  const R = r.report.results || [], O = r.report.ongoing || [], P = r.report.plans || [];
  const who = ids => (ids || []).map(names).filter(Boolean).join(', ');
  const rows = list => list.map(x => `<tr><td>${x.ref ? `<span class="wk-note">${esc(x.ref)}</span> ` : ''}${esc(x.task)}${needsIssue(x, f) && (x.cause || x.solution) ? `<br><span class="wk-note">Khó khăn: ${esc(x.cause)}<br>Giải pháp: ${esc(x.solution)}</span>` : ''}${x.next ? `<br><span class="wk-note">Tuần tới: ${esc(x.next)}</span>` : ''}</td><td>${esc(who(x.ownerIds))}</td><td>${fmtD(x.due)}</td><td>${statusChip(x, f)}</td><td>${esc(x.pct)}</td></tr>`).join('');
  return `<details class="wk-dept" data-testid="wk-detail-${r.id}"><summary>${esc(r.name)} <span class="wk-chip ${toneOf(r.status.tone)}">${esc(r.status.label)}</span></summary><div>
    <div class="wk-table"><table><thead><tr><th>I. Công việc tuần trước</th><th>Phụ trách</th><th>Deadline</th><th>Tình trạng</th><th>%</th></tr></thead><tbody>${rows(R) || '<tr><td colspan="5" class="wk-note">Không có</td></tr>'}</tbody></table></div>
    ${O.length ? `<div class="wk-table"><table><thead><tr><th>II. Đang thực hiện</th><th>Phụ trách</th><th>Deadline</th><th>Tình trạng</th><th>%</th></tr></thead><tbody>${rows(O)}</tbody></table></div>` : ''}
    <div class="wk-table"><table><thead><tr><th>III. Kế hoạch tuần mới</th><th>Căn cứ</th><th>Phụ trách</th><th>Deadline</th><th>Đầu ra</th></tr></thead><tbody>${P.map(p => `<tr><td>${esc(p.task)}</td><td>${esc(p.basis)}</td><td>${esc(who(p.ownerIds))}</td><td>${fmtD(p.due)}</td><td>${esc(p.output)}</td></tr>`).join('') || '<tr><td colspan="5" class="wk-note">Không có</td></tr>'}</tbody></table></div>
    ${r.report.other ? `<p class="wk-note"><b>Kiến nghị:</b> ${esc(r.report.other)}</p>` : ''}</div></details>`;
}
function setupHtml(s) {
  const md = s.meeting || {}, S = s.schedule;
  const order = [...ctx.required.map(id => ({ id, on: true })), ...ctx.departments.filter(d => !ctx.required.includes(d.id)).map(d => ({ id: d.id, on: false }))];
  return `<details class="wk-card" id="wkSetup" data-testid="wk-setup"><summary><b>Thiết lập</b> <span class="wk-note">bộ phận phải nộp, thứ tự trình bày, tuần bắt đầu chấm điểm, hạn nộp khi nghỉ lễ</span></summary>
    <div style="display:grid;gap:14px;margin-top:12px">
      <div class="wk-order"><b style="font-size:.9rem">Bộ phận phải nộp — theo thứ tự trình bày tại giao ban</b>${ctx.configured ? '' : '<span class="wk-note">Chưa thiết lập: đang lấy tự động các bộ phận chủ trì hạng mục MTL. Chọn đúng 5 bộ phận theo quy chế rồi bấm Lưu.</span>'}
        <ol id="setOrder">${order.map(o => `<li data-id="${o.id}"><label><input type="checkbox" ${o.on ? 'checked' : ''} data-testid="wk-set-dept-${o.id}"> ${esc(deptName(o.id))}</label><button class="btn x" type="button" data-up>↑</button><button class="btn x" type="button" data-down>↓</button></li>`).join('')}</ol></div>
      <div class="wk-grid">
        <label class="wk-f">Tuần bắt đầu chấm điểm tuân thủ<input type="date" id="setStart" value="${esc(ctx.startWeek || '')}" step="7"></label>
        <label class="wk-f">Hạn nộp tuần này (nghỉ lễ thứ Sáu → ngày làm việc liền trước)<input type="date" id="setDeadline" value="${esc(md.deadlineDay || '')}" placeholder="${S.to}"></label>
        <label class="wk-f">Ngày giao ban (nghỉ lễ thứ Hai → ngày làm việc kế tiếp)<input type="date" id="setMeeting" value="${esc(md.meetingDay || '')}"></label>
      </div>
      <div class="wk-actions"><button class="btn btn-primary" type="button" id="setSave" data-testid="wk-set-save">Lưu thiết lập</button><span class="wk-note">Thay đổi hạn nộp / ngày giao ban: thông báo các bộ phận trước ít nhất 02 ngày làm việc (Điều 3).</span></div>
    </div></details>`;
}
function bindSummary(body, s) {
  const M = s.canManage;
  const saveMeeting = async (patch, msg = 'Đã lưu') => {
    try { const r = await api('/api/weekly/meeting', { method: 'PUT', body: { week: st.week, ...patch } }); if (msg) toast(msg, 'ok'); return r; }
    catch (error) { toast(errorMessage(error), 'err'); throw error; }
  };
  const collect = () => {
    const att = {}, failed = {};
    for (const el of $$('[data-att]', body)) if (el.value) att[el.dataset.att] = el.value;
    for (const el of $$('[data-failed]', body)) if (el.checked) failed[el.dataset.failed] = true;
    return { att, failed };
  };
  const conclusions = () => {
    const c = {};
    for (const el of $$('[data-help]', body)) {
      const decision = $('[data-hk="decision"]', el)?.value;
      if (decision) c[el.dataset.help] = { decision, departmentId: Number($('[data-hk="departmentId"]', el).value) || null, note: $('[data-hk="note"]', el).value };
    }
    return c;
  };
  const saveConclusions = debounce(() => saveMeeting({ conclusions: conclusions() }, 'Đã lưu kết luận'), 700);
  body.addEventListener('change', async e => {
    if (!M) return;
    if (e.target.matches('[data-att],[data-failed]')) { const { att, failed } = collect(); await saveMeeting({ attendance: att, failed }, 'Đã ghi điểm danh'); return; }
    if (e.target.matches('[data-hk]')) {
      const item = e.target.closest('[data-help]');
      if (e.target.dataset.hk === 'decision') $('[data-hk="departmentId"]', item).disabled = e.target.value !== 'ASSIGN';
      saveConclusions(); return;
    }
    const row = e.target.closest('[data-ai]');
    if (row && e.target.dataset.ak) { const x = st.actions[Number(row.dataset.ai)], k = e.target.dataset.ak; x[k] = ['departmentId', 'ownerId'].includes(k) ? Number(e.target.value) || null : e.target.value; if (k === 'departmentId') { x.ownerId = null; drawActions(); } }
  });
  body.addEventListener('input', e => {
    if (M && e.target.matches('[data-hk="note"]')) saveConclusions();
    const row = e.target.closest('[data-ai]');
    if (row && e.target.dataset.ak === 'task') st.actions[Number(row.dataset.ai)].task = e.target.value;
  });
  body.addEventListener('click', async e => {
    if (e.target.closest('#copySum')) {
      const text = st.sum.text;
      const ok = () => { $('#copyMsg').textContent = 'Đã sao chép. Dán vào email công ty hoặc nhóm chat đã được phê duyệt.'; api('/api/weekly/summary/copied', { method: 'POST', body: { week: st.week } }).catch(() => {}); };
      const fb = () => { const t = $('#copyFallback'); t.hidden = false; t.value = text; t.focus(); t.select(); $('#copyMsg').textContent = 'Bôi đen sẵn, nhấn Ctrl+C để sao chép.'; api('/api/weekly/summary/copied', { method: 'POST', body: { week: st.week } }).catch(() => {}); };
      try { navigator.clipboard.writeText(text).then(ok, fb); } catch { fb(); }
      return;
    }
    if (!M) return;
    if (e.target.closest('#actAdd')) { st.actions.push({ task: '', departmentId: null, ownerId: null, due: addDays(S0(), 4) }); drawActions(); $$('[data-ak="task"]').at(-1)?.focus(); return; }
    const del = e.target.closest('[data-adel]');
    if (del) { st.actions.splice(Number(del.dataset.adel), 1); drawActions(); return; }
    const to = e.target.closest('[data-toact]');
    if (to) {
      const h = st.sum.helps.flatMap(g => g.list).find(x => x.key === to.dataset.toact), item = to.closest('[data-help]');
      const assign = Number($('[data-hk="departmentId"]', item).value) || null;
      st.actions.push({ task: h.what || h.task, departmentId: assign || (h.toKey?.startsWith('D') ? Number(h.toKey.slice(1)) : h.fromId), ownerId: null, due: h.by || addDays(S0(), 4), helpKey: h.key });
      drawActions(); $('#wkActions').scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
    }
    if (e.target.closest('#actSave') || e.target.closest('#actPublish')) {
      const publish = !!e.target.closest('#actPublish');
      try {
        await saveMeeting({ actions: st.actions, conclusions: conclusions(), ...(publish ? { publish: true } : {}) }, publish ? 'Đã phát hành kết luận và Action Log' : 'Đã lưu Action Log');
        await drawSummary(freshBody());
      } catch { /* đã báo lỗi */ }
      return;
    }
    const up = e.target.closest('[data-up],[data-down]');
    if (up) { const li = up.closest('li'); if (up.dataset.up !== undefined && li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling); else if (up.dataset.down !== undefined && li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li); return; }
    if (e.target.closest('#setSave')) {
      const departments = $$('#setOrder li', body).filter(li => $('input', li).checked).map(li => Number(li.dataset.id));
      const startWeek = $('#setStart', body).value;
      try {
        if (startWeek && new Date(startWeek + 'T00:00:00Z').getUTCDay() !== 5) throw new Error('Tuần bắt đầu chấm điểm phải là một ngày thứ Sáu');
        await api('/api/weekly/config', { method: 'PUT', body: { departments, startWeek: startWeek || null } });
        await saveMeeting({ deadlineDay: $('#setDeadline', body).value || null, meetingDay: $('#setMeeting', body).value || null }, null);
        ctx = null; toast('Đã lưu thiết lập', 'ok');
        await rerender();
      } catch (error) { toast(errorMessage(error), 'err'); }
    }
  });
}
const S0 = () => st.sum?.schedule?.meetingDay || addDays(st.week, 3);

// =====================================================================
// Tab 4 — Chấm điểm tuân thủ tháng (Phụ lục 1)
// =====================================================================
async function drawCompliance(body, params) {
  const month = /^\d{4}-\d{2}$/.test(params.get('m') || '') ? params.get('m') : st.week.slice(0, 7);
  const d = await api(`/api/weekly/compliance?month=${month}`);
  const months = Array.from({ length: 6 }, (_, k) => { const x = new Date(Date.UTC(Number(ctx.week.slice(0, 4)), Number(ctx.week.slice(5, 7)) - 1 - k, 1)); return x.toISOString().slice(0, 7); });
  body.innerHTML = `
    <div><h1>Chấm điểm tuân thủ giao ban <span style="color:var(--gold)">tháng ${month.slice(5)}/${month.slice(0, 4)}</span></h1>
      <p class="wk-lead">Mỗi trưởng bộ phận bắt đầu tháng với 100 điểm, trừ theo Phụ lục 1 (mức đề xuất — TGĐ chốt khi ban hành). Điểm cuối tháng × trọng số tiêu chí (đề xuất 5%) đưa vào KPI. Lập ngày làm việc thứ 3 của tháng sau, trình TGĐ duyệt.</p></div>
    <section class="wk-card"><div class="wk-actions"><label class="wk-week">Tháng<select id="cMonth">${opts(months.map(m => [m, `${m.slice(5)}/${m.slice(0, 4)}`]), month)}</select></label>
      <span class="wk-note">${d.weeks.length ? `Tính ${d.weeks.length} tuần: ${d.weeks.map(fmtD).join(', ')}` : 'Chưa có tuần nào trong tháng được tính'}${d.startWeek ? ` · bắt đầu chấm từ ${fmtDY(d.startWeek)}` : ''}</span></div>
      <div class="wk-table"><table><thead><tr><th>Bộ phận</th><th>Trưởng bộ phận</th><th>Điểm</th><th>Vi phạm</th><th>Chi tiết</th></tr></thead><tbody data-testid="wk-score">
      ${d.rows.map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.leaders.join(', '))}</td><td><b style="font-size:1.1rem;color:${r.score >= 95 ? 'var(--good)' : r.score >= 80 ? 'var(--wk-warn)' : 'var(--bad)'}">${r.score}</b></td><td>${r.violations}</td>
        <td>${r.events.length ? r.events.map(e => `<div class="wk-note">${fmtD(e.week)}: ${esc(e.label)} ${e.points ? `<b>−${e.points}</b>` : '(không trừ)'}</div>`).join('') : '<span class="wk-note">Không vi phạm</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="wk-note">Chưa thiết lập bộ phận phải nộp</td></tr>'}
      </tbody></table></div>
      <p class="wk-note">Mức trừ: ${Object.entries(d.points).map(([k, v]) => `${esc(ctx.pointLabels[k])} ${v}`).join(' · ')}. Vi phạm do nhân viên được giao gửi báo cáo tính cho trưởng bộ phận. Từ 03 lần vi phạm trong một quý: nhắc nhở bằng văn bản.</p></section>`;
  $('#cMonth', body).onchange = e => { location.hash = `#/tuan/diem?m=${e.target.value}${st.week !== ctx.week ? `&w=${st.week}` : ''}`; };
}

// =====================================================================
// Tab 5 — Tiến độ dự án (gọn; Dashboard đầy đủ ở "Tiến độ dự án" trên menu)
// =====================================================================
async function drawProgress(body) {
  const d = await api('/api/mtl/portfolio');
  st.schedule = st.week === ctx.week ? ctx.schedule : null;
  const pct = v => (v == null ? '—' : `${Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`);
  const tone = s => (s == null ? '' : s >= 0.95 ? 'good' : s >= 0.8 ? 'warn' : 'bad');
  body.innerHTML = `<div><h1>Tiến độ dự án</h1><p class="wk-lead">Theo Master Timeline. Thanh xanh = thực tế, vạch vàng = kế hoạch hôm nay. Bấm vào số để mở danh sách hạng mục tương ứng.</p></div>
    <div class="wk-proj">${d.projects.map(p => { const s = p.summary, link = `#/projects/${p.id}`; return `<section class="wk-card" data-testid="wk-proj-${esc(p.key)}">
      <div class="wk-actions" style="justify-content:space-between"><h2><a href="${link}">${esc(p.name)}</a> <small>${esc(p.key)}${p.currentT == null ? '' : ` · tháng T${p.currentT}/${p.totalT}`}</small></h2><a class="btn btn-sm" href="${link}">Mở dự án</a></div>
      <div class="bar" title="Thực tế ${pct(s.actualPct)} · kế hoạch ${pct(s.plannedPct)}"><i style="width:${Math.max(0, Math.min(100, s.actualPct || 0))}%"></i><b style="left:${Math.max(0, Math.min(100, s.plannedPct || 0))}%"></b></div>
      <p class="wk-note">Thực tế <b>${pct(s.actualPct)}</b> · kế hoạch ${pct(s.plannedPct)}</p>
      <div class="kp"><a href="${link}?view=plan" class="${tone(s.spi)}"><b>${s.spi == null ? '—' : Number(s.spi).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}</b><span>SPI</span></a>
        <a href="${link}?view=plan&st=attn" class="${s.behind ? 'warn' : ''}"><b>${s.behind}</b><span>Chậm</span></a>
        <a href="${link}?view=plan&st=OVERDUE" class="${s.overdue ? 'bad' : ''}"><b>${s.overdue}</b><span>Trễ hạn</span></a>
        <a href="${link}?view=plan&st=critical" class="${s.criticalLate ? 'bad' : ''}"><b>${s.criticalLate}</b><span>Găng trễ</span></a></div>
      ${p.currentSprint ? `<p class="wk-note"><b>Đang làm:</b> <a href="${link}?view=sprint&s=${p.currentSprint.index}">${esc(p.currentSprint.name)}</a> · ${p.currentSprint.stepsDone}/${p.currentSprint.steps} bước xong · TT ${pct(p.currentSprint.actualPct)} / KH ${pct(p.currentSprint.plannedPct)}</p>` : ''}
      ${p.nextMilestone ? `<p class="wk-note">◆ <b>Mốc kế tiếp:</b> ${esc(p.nextMilestone.title)} · ${esc(new Date(p.nextMilestone.baselineEnd).toLocaleDateString('vi-VN'))}</p>` : ''}
    </section>`; }).join('') || '<div class="wk-empty">Chưa có dự án theo Master Timeline.</div>'}</div>`;
}
