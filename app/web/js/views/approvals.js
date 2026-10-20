// Chờ tôi xử lý: phiếu trình chờ duyệt, đề nghị gia hạn chờ quyết định, kiến nghị chờ trả lời. Mở việc ngay trên trang.
// Mặc định phiếu chờ lâu nhất lên trước (chuyển được sang "Hạn gần nhất"); chip Dự án / Phòng tự sinh khi có từ 2 nguồn trở lên.
import { api } from '../api.js';
import { store } from '../store.js';
import { $, $$, esc, fmtDate, ago, prioChip, avatars, toast, errorMessage, confirmDialog, uiPref, replaceHashParams } from '../util.js';
import { refreshCounters } from '../main.js';
import { scrollFade } from './ops.js';

const TABS = [['queue', 'Phiếu trình'], ['extensions', 'Đề nghị gia hạn'], ['proposals', 'Kiến nghị']];
const DAY = 86_400_000;
const vnDay = v => Math.floor((new Date(v).getTime() + 7 * 3_600_000) / DAY);
// Số ngày làm việc (thứ Hai – thứ Sáu) đã trôi qua kể từ ngày gửi.
function workDaysSince(v) {
  let n = 0;
  for (let x = vnDay(v) + 1, end = vnDay(Date.now()); x <= end; x++) { const wd = new Date(x * DAY).getUTCDay(); if (wd && wd !== 6) n++; }
  return n;
}
// "Lần trình 2 — Kính trình…" (ghi khi nộp lại) → { round: 2, note: 'Kính trình…' }.
function parseSubmit(note) {
  const m = /^Lần trình (\d+)(?:\s*[—–-]\s*)?/.exec(note || '');
  return m ? { round: Number(m[1]), note: note.slice(m[0].length).trim() } : { round: 1, note: note || '' };
}

// Vẽ lại sau thao tác: đọc bộ lọc hiện tại trên URL (người dùng có thể đã đổi sau lần vẽ trước).
const liveParams = () => new URLSearchParams(location.hash.split('?')[1] || '');
export async function renderApprovals(root, params, setCrumbs) {
  setCrumbs('Chờ tôi xử lý');
  const [queue, extensions, proposals] = await Promise.all([api('/api/approvals/queue'), api('/api/approvals/extensions'), api('/api/approvals/proposals')]);
  const counts = { queue: queue.length, extensions: extensions.filter(x => x.canDecide).length, proposals: proposals.length };
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : counts.queue || (!counts.extensions && !counts.proposals) ? 'queue' : counts.extensions ? 'extensions' : 'proposals';
  if (params.get('tab') !== tab && /^#\/approvals(\?|$)/.test(location.hash)) replaceHashParams({ tab });
  const lists = { queue, extensions, proposals };
  const rows = lists[tab];
  const deptId = name => store.departments.find(d => d.name === name)?.id;

  // Nguồn để lọc: dự án và phòng có trong danh sách của tab đang xem (chỉ hiện khi ≥ 2 nguồn).
  const projects = [...new Map(rows.map(x => [x.project.id, x.project])).values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const depts = [...new Map(rows.filter(x => deptId(x.item.departmentName)).map(x => [deptId(x.item.departmentName), { id: deptId(x.item.departmentName), name: x.item.departmentName }])).values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const sortPref = uiPref('appr:sort');
  const f = {
    sort: ['wait', 'due'].includes(params.get('sort')) ? params.get('sort') : sortPref === 'due' ? 'due' : 'wait',
    project: projects.length > 1 && projects.some(p => String(p.id) === params.get('project')) ? params.get('project') : '',
    dept: depts.length > 1 && depts.some(d => String(d.id) === params.get('dept')) ? params.get('dept') : '',
  };
  const linkParams = extra => {
    const u = new URLSearchParams({ tab });
    if (f.sort === 'due') u.set('sort', 'due');
    if (f.project) u.set('project', f.project);
    if (f.dept) u.set('dept', f.dept);
    for (const [k, v] of Object.entries(extra)) { if (v) u.set(k, v); else u.delete(k); }
    return '#/approvals?' + u;
  };
  const href = (id, focus) => linkParams({ item: id, focus });
  const meta = i => [i.departmentName, i.assignedByName && `giao bởi ${i.assignedByName}`].filter(Boolean).map(esc).join(' · ');
  const waitChip = created => {
    const n = vnDay(Date.now()) - vnDay(created), w = workDaysSince(created);
    return `<span class="pill ap-wait${w > 1 ? ' warn' : ''}" title="Gửi ${esc(ago(created))} · ${w} ngày làm việc">${n ? `chờ ${n} ngày` : 'chờ hôm nay'}</span>`;
  };

  const queueRow = q => {
    const s = parseSubmit(q.submitNote);
    return `<tr class="clickable" tabindex="0" data-href="${href(q.item.id, 'approval')}" data-testid="queue-${esc(q.item.code)}">
      <td class="code ap-c-code" data-label="Mã">${esc(q.item.code)}</td>
      <td class="ap-c-task" data-label="Công việc"><b>${esc(q.item.title)}</b> ${prioChip(q.item.priority)}${q.item.taskType === 'PLAN' ? ' <span class="pill info">KH năm</span>' : ''}
        <div class="muted xs">${esc(q.project.name)}${meta(q.item) ? ' · ' + meta(q.item) : ''}</div>
        ${s.note ? `<div class="muted sm clamp2">“${esc(s.note)}”</div>` : ''}</td>
      <td class="ap-c-step" data-label="Bước"><span class="pill approval-chip">${q.currentLevel}/${q.totalLevels} · ${esc(q.stepName || '')}</span>
        <div class="ap-tags">${s.round > 1 ? `<span class="pill ap-round" data-testid="queue-round-${esc(q.item.code)}">Lần trình ${s.round}</span>` : ''}${q.lastLevel ? '<span class="muted xs">bước cuối · xếp loại</span>' : ''}</div>
        ${q.onBehalfOf ? `<div class="muted xs">duyệt thay ${esc(q.onBehalfOf)}</div>` : ''}</td>
      <td class="ap-c-who" data-label="Người trình"><span class="ap-who">${esc(q.requestedByName || '')}</span><div class="ap-av">${avatars(q.item.assignees)}</div></td>
      <td class="nowrap ap-c-due" data-label="Hạn">${q.item.dueDate ? `<span class="ap-due-l">Hạn </span>${fmtDate(q.item.dueDate)}` : '<span class="muted">—</span>'}</td>
      <td class="nowrap ap-c-wait" data-label="Chờ">${waitChip(q.createdAt)}</td></tr>`;
  };
  const extRow = x => `<tr class="clickable" tabindex="0" data-href="${href(x.item.id, 'extension')}" data-testid="ext-${esc(x.item.code)}">
      <td class="code" data-label="Mã"><a href="${href(x.item.id, 'extension')}">${esc(x.item.code)}</a></td>
      <td data-label="Công việc"><b>${esc(x.item.title)}</b><div class="muted xs">${meta(x.item)}</div></td>
      <td data-label="Đề nghị" class="nowrap">${x.oldDue ? fmtDate(x.oldDue) + ' → ' : ''}<b>${fmtDate(x.newDue)}</b>${x.days != null ? ` <span class="pill warn">+${x.days} ngày</span>` : ''}</td>
      <td data-label="Lý do" class="sm">${esc(x.reason)}</td><td data-label="Người đề nghị">${esc(x.requestedByName || '')}<div class="muted xs">${ago(x.createdAt)}</div></td>
      <td data-label="">${x.canDecide ? `<div class="row nowrap"><button type="button" class="btn btn-ok btn-sm" data-ext="${x.id}" data-decision="APPROVE" data-testid="ext-approve-${esc(x.item.code)}">Duyệt</button><button type="button" class="btn btn-ghost btn-sm" data-ext="${x.id}" data-decision="REJECT">Không duyệt</button></div>` : '<span class="muted xs">Người giao quyết định — bạn theo dõi</span>'}</td></tr>`;
  const propRow = x => `<tr class="clickable" tabindex="0" data-href="${href(x.item.id, 'proposal')}" data-testid="prop-${esc(x.item.code)}">
      <td class="code" data-label="Mã">${esc(x.item.code)}</td><td data-label="Công việc"><b>${esc(x.item.title)}</b><div class="muted xs">${meta(x.item)}</div></td>
      <td data-label="Kiến nghị" class="sm">${esc(x.proposals)}${x.difficulties ? `<div class="muted xs">Khó khăn: ${esc(x.difficulties)}</div>` : ''}</td>
      <td data-label="Người đề xuất">${esc(x.authorName || '')}<div class="muted xs">tiến độ ${x.progress}%</div></td>
      <td data-label="Chờ"><span class="pill${x.waitingDays >= 2 ? ' warn' : ''}">${x.waitingDays ? x.waitingDays + ' ngày' : 'hôm nay'}</span></td></tr>`;
  const TABLE = {
    queue: ['approval-queue', '<th>Mã</th><th>Công việc</th><th>Bước</th><th>Người trình</th><th>Hạn</th><th>Chờ</th>', queueRow, 6],
    extensions: ['extension-queue', '<th>Mã</th><th>Công việc</th><th>Đề nghị</th><th>Lý do</th><th>Người đề nghị</th><th aria-label="Quyết định"></th>', extRow, 6],
    proposals: ['proposal-queue', '<th>Mã</th><th>Công việc</th><th>Kiến nghị</th><th>Người đề xuất</th><th>Chờ</th>', propRow, 5],
  };
  const EMPTY = {
    queue: '<div class="card empty" data-testid="approval-empty">Không có phiếu trình nào chờ bạn duyệt.</div>',
    extensions: '<div class="card empty">Không có đề nghị gia hạn nào.</div>',
    proposals: '<div class="card empty">Không có kiến nghị nào chờ trả lời.</div>',
  };

  const chipGroup = (key, label, list) => list.length > 1 ? `<div class="lf-chips ap-src" role="group" aria-label="${label}"><span class="lf-label">${label}</span>
      <button type="button" class="chip" data-src="${key}" data-val="" aria-pressed="false">Tất cả <b></b></button>
      ${list.map(s => `<button type="button" class="chip" data-src="${key}" data-val="${s.id}" aria-pressed="false" data-testid="appr-${key}-${s.id}">${esc(s.name)} <b></b></button>`).join('')}</div>` : '';
  const toolbar = rows.length && (tab === 'queue' || projects.length > 1 || depts.length > 1) ? `<div class="lf-bar ap-bar">
      ${tab === 'queue' ? `<div class="seg" role="group" aria-label="Sắp xếp"><button type="button" data-sort="wait" aria-pressed="${f.sort === 'wait'}" data-testid="appr-sort-wait">Chờ lâu nhất</button><button type="button" data-sort="due" aria-pressed="${f.sort === 'due'}" data-testid="appr-sort-due">Hạn gần nhất</button></div>` : ''}
      ${chipGroup('project', 'Dự án', projects)}${chipGroup('dept', 'Phòng', depts)}
      <span class="lf-count" aria-live="polite"></span></div>` : '';

  root.oninput = null; root.onchange = null; root.onkeydown = null;
  root.innerHTML = `<div class="page-head"><h1>Chờ tôi xử lý</h1><span class="muted">${counts.queue + counts.extensions + counts.proposals} việc</span></div>
    <div class="tabs" role="tablist" aria-label="Loại">${TABS.map(([k, label]) => `<a href="#/approvals?tab=${k}" data-tab="${k}" class="${k === tab ? 'active' : ''} ${counts[k] ? 'has-n' : 'zero'}" role="tab" aria-selected="${k === tab}" data-testid="approvals-tab-${k}">${label} <b>${counts[k]}</b></a>`).join('')}</div>
    <div class="ap-body">${toolbar}<div id="apList"></div></div>`;
  for (const s of $$('.ap-src', root)) scrollFade(s);

  function draw() {
    const box = $('#apList', root);
    if (!rows.length) { box.innerHTML = EMPTY[tab]; return; }
    const inProject = x => !f.project || String(x.project.id) === f.project;
    const inDept = x => !f.dept || String(deptId(x.item.departmentName)) === f.dept;
    let list = rows.filter(x => inProject(x) && inDept(x));
    if (tab === 'queue') {
      const t = v => (v ? +new Date(v) : Infinity);
      list = [...list].sort(f.sort === 'due' ? (a, b) => t(a.item.dueDate) - t(b.item.dueDate) || t(a.createdAt) - t(b.createdAt) : (a, b) => t(a.createdAt) - t(b.createdAt));
    }
    for (const b of $$('[data-src]', root)) {
      const k = b.dataset.src, v = b.dataset.val, on = (f[k] || '') === v;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      const other = k === 'project' ? inDept : inProject, mine = x => (k === 'project' ? String(x.project.id) : String(deptId(x.item.departmentName))) === v;
      b.querySelector('b').textContent = rows.filter(x => other(x) && (!v || mine(x))).length;
    }
    for (const b of $$('[data-sort]', root)) b.setAttribute('aria-pressed', String(b.dataset.sort === f.sort));
    const cnt = $('.lf-count', root); if (cnt) cnt.textContent = list.length === rows.length ? `${rows.length} mục` : `${list.length}/${rows.length} mục`;
    const [testid, head, rowFn] = TABLE[tab];
    box.innerHTML = list.length ? `<div class="tbl-scroll"><table class="table ${tab === 'queue' ? 'ap-queue' : 'rcards'} ap-table" data-testid="${testid}"><thead><tr>${head}</tr></thead><tbody>${list.map(rowFn).join('')}</tbody></table></div>`
      : `<div class="card empty lf-empty" data-testid="approval-filter-empty"><p>Không có mục nào khớp bộ lọc.</p><button type="button" class="btn btn-ghost btn-sm" data-clear>Xoá lọc</button></div>`;
  }
  draw();
  const syncUrl = () => replaceHashParams({ sort: f.sort === 'due' ? 'due' : '', project: f.project, dept: f.dept, focus: '' });

  root.onclick = async e => {
    const btn = e.target.closest('[data-ext]');
    if (btn) {
      e.stopPropagation();
      let note = '';
      if (btn.dataset.decision === 'REJECT') {
        note = await confirmDialog('Không duyệt gia hạn — người đề nghị sẽ nhận được lý do.', { okText: 'Không duyệt', danger: true, input: 'Lý do' });
        if (note === null) return; if (!note) { toast('Nhập lý do không duyệt', 'err'); return; }
      }
      btn.disabled = true;
      try { await api(`/api/extensions/${btn.dataset.ext}/decide`, { method: 'POST', body: { decision: btn.dataset.decision, note } }); toast(btn.dataset.decision === 'APPROVE' ? 'Đã duyệt gia hạn' : 'Đã không duyệt gia hạn', 'ok'); refreshCounters(); renderApprovals(root, liveParams(), setCrumbs); }
      catch (error) { btn.disabled = false; toast(errorMessage(error), 'err'); }
      return;
    }
    const s = e.target.closest('[data-sort]');
    if (s) { f.sort = s.dataset.sort; uiPref('appr:sort', f.sort === 'due' ? 'due' : null); syncUrl(); draw(); return; }
    const src = e.target.closest('[data-src]');
    if (src) { f[src.dataset.src] = src.dataset.val; syncUrl(); draw(); return; }
    if (e.target.closest('[data-clear]')) { f.project = ''; f.dept = ''; syncUrl(); draw(); return; }
    const t = e.target.closest('[data-tab]');
    if (t) { e.preventDefault(); location.hash = `#/approvals?${new URLSearchParams({ tab: t.dataset.tab, ...(f.sort === 'due' ? { sort: 'due' } : {}) })}`; return; }
    const row = e.target.closest('[data-href]'); if (row && !e.target.closest('a')) location.hash = row.dataset.href;
  };
}
