// Điều hành: bức tranh buổi sáng của Ban Giám đốc / lãnh đạo phòng. Khối chia hai nhóm theo vai trò — "Cần xử lý" (việc của chính
// người xem) và "Theo dõi"; mỗi khối mở ra danh sách việc, bấm việc để mở chi tiết đúng chỗ cần xử lý (focus theo khối).
import { api } from '../api.js';
import { store, personLink, deptLink } from '../store.js';
import { $, $$, esc, fmtDate, fmtDateTime, uiPref, replaceHashParams } from '../util.js';
import { icon } from '../icons.js';

const BLOCKS = {
  waitBgd: ['Chờ BGĐ cho ý kiến', 'approve', 'Phiếu trình đã qua phòng, đang chờ Ban Giám đốc'],
  proposals: ['Kiến nghị chưa trả lời', 'comment', 'Cán bộ đề xuất trong báo cáo tiến độ'],
  extensions: ['Đề nghị gia hạn', 'clock', 'Chờ người giao quyết định'],
  pendingAccept: ['Chờ phòng tiếp nhận', 'inbox', 'Đã giao về phòng, chưa phân công cán bộ'],
  overdue: ['Quá hạn', 'clock', 'Chưa hoàn thành, đã qua hạn'],
  dueSoon: ['Sắp đến hạn', 'clock', 'Còn ít ngày'],
  waitDept: ['Chờ phòng duyệt', 'checklist', 'Cán bộ đã nộp, chờ lãnh đạo phòng'],
  returned: ['Bị trả lại', 'back', 'Đang làm lại theo ý kiến'],
  // Gộp phiếu trình chờ duyệt + kiến nghị + đề nghị gia hạn: cùng một thao tác "Duyệt / Không duyệt + ý kiến".
  decide: ['Chờ tôi duyệt', 'approve', 'Phiếu trình, kiến nghị, đề nghị gia hạn — duyệt hoặc không duyệt kèm ý kiến'],
};
const KIND = { waitBgd: 'Phiếu trình', waitDept: 'Phiếu trình', proposals: 'Kiến nghị', extensions: 'Gia hạn' };
// Thứ tự theo vai trò: BGĐ (phạm vi SYSTEM) và lãnh đạo phòng (UNIT).
const ORDER = {
  SYSTEM: { act: ['decide'], merge: ['waitBgd', 'proposals', 'extensions'], watch: ['overdue', 'dueSoon', 'pendingAccept', 'waitDept', 'returned'] },
  UNIT: { act: ['pendingAccept', 'decide'], merge: ['waitDept', 'proposals', 'extensions'], watch: ['overdue', 'dueSoon', 'returned', 'waitBgd'] },
};
const PERIODS = [['year', 'Năm', 'năm nay']];
let open = null;

// Mép mờ cho hàng chip / phân đoạn cuộn ngang: báo còn nội dung ở phía nào.
export function scrollFade(el) {
  if (!el) return;
  const upd = () => {
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('fade-r', max > 2 && el.scrollLeft < max - 2);
    el.classList.toggle('fade-l', max > 2 && el.scrollLeft > 2);
  };
  el.addEventListener('scroll', upd, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(upd).observe(el); else upd();
  upd();
}

export async function renderOps(root, params, setCrumbs, { background = false } = {}) {
  setCrumbs('Tổng quan');
  // Phạm vi (một lựa chọn): Toàn Trung tâm hoặc một phòng. URL thắng; không có thì lấy lựa chọn cuối đã nhớ.
  const eff = { departmentIds: /^\d+$/.test(params.get('departmentIds') || '') ? params.get('departmentIds') : '', all: '' };
  let fromPref = false;
  if (!eff.departmentIds && params.get('all') !== '1') {
    const pref = uiPref('ops:dept');
    if (Number.isInteger(pref)) { eff.departmentIds = String(pref); fromPref = true; }
  }
  if (!eff.departmentIds) eff.all = '1';
  const q = new URLSearchParams();
  if (eff.departmentIds) q.set('departmentIds', eff.departmentIds);
  if (eff.all) q.set('all', '1');
  q.set('period', 'year');
  if (background) q.set('bg', '1');
  const d = await api('/api/ops/overview?' + q);
  const sys = d.scope === 'SYSTEM';
  if (fromPref && sys) replaceHashParams(eff);
  const order = ORDER[sys ? 'SYSTEM' : 'UNIT'];
  // Khối gộp: mỗi dòng nhớ khối gốc (_k) để mở đúng chỗ cần xử lý.
  d.blocks.decide = { count: order.merge.reduce((n, k) => n + (d.blocks[k]?.count || 0), 0),
    items: order.merge.flatMap(k => (d.blocks[k]?.items || []).map(i => ({ ...i, _k: k }))) };
  const all = [...order.act, ...order.watch];
  const count = k => d.blocks[k]?.count || 0;
  const wanted = params.get('block');
  if (wanted && Object.hasOwn(d.blocks, wanted)) open = wanted;
  else if (!(background && open && Object.hasOwn(d.blocks, open))) open = order.act.find(count) || order.watch.find(count) || order.act[0];
  // Ghi khối đang mở lên URL: mở việc (link có block=) sau đó không vẽ lại cả trang.
  if (!background && wanted !== open && /^#\/ops(\?|$)/.test(location.hash)) replaceHashParams({ block: open });
  const focusOf = k => ({ waitBgd: 'approval', proposals: 'proposal', extensions: 'extension', returned: 'returned', ...(sys ? {} : { pendingAccept: 'accept', waitDept: 'approval' }) }[k] || '');

  const base = () => { const u = new URLSearchParams(); for (const [k, v] of params) if (!['item', 'focus'].includes(k)) u.set(k, v); for (const [k, v] of Object.entries(eff)) { if (v) u.set(k, v); else u.delete(k); } return u; };
  const go = extra => { const u = base(); for (const [k, v] of Object.entries(extra)) { if (v) u.set(k, v); else u.delete(k); } location.hash = '#/ops?' + u; };
  const itemHref = (key, i) => { const u = base(); u.set('block', key); const f = focusOf(i._k || key); if (f) u.set('focus', f); u.set('item', i.id); return '#/ops?' + u; };

  const days = n => (n == null ? '' : n === 0 ? 'hôm nay' : `${n} ngày`);
  const list = key => {
    const b = d.blocks[key];
    const [label, , hint] = BLOCKS[key];
    const head = `<div class="ops-panel-h"><b>${esc(label)}</b><span class="muted sm">${esc(hint)}</span><span class="grow"></span><span class="muted sm">${b.count} việc</span></div>`;
    if (!b.items.length) return `${head}<div class="empty">Không có việc ở khối này.</div>`;
    return `${head}<div class="ops-list" data-testid="ops-list-${key}">${b.items.map(i => `<a class="ops-row" href="${itemHref(key, i)}" data-testid="ops-item-${esc(i.code)}">
        <span class="code">${esc(i.code)}</span><span class="grow"><b>${i._k ? `<span class="pill">${KIND[i._k]}</span> ` : ''}${esc(i.title)}</b><span class="muted xs">${esc(i.department || '')}${i.assignees.length ? ' · ' + i.assignees.map(u => personLink(u)).join(', ') : ''} · ${esc(i.stage)}</span>
        ${key === 'returned' && i.returnNote ? `<span class="muted xs">Lý do: ${esc(i.returnNote)}</span>` : ''}${(i._k || key) === 'extensions' && i.newDue ? `<span class="muted xs">Xin đến ${fmtDate(i.newDue)}</span>` : ''}</span>
        <span class="ops-meta">${i.dueDate ? `<span class="due ${i.deadlineCode === 'OVERDUE' ? 'overdue' : i.deadlineCode === 'DUE_SOON' ? 'soon' : ''}">${fmtDate(i.dueDate)}</span>` : ''}
          ${i.lateDays ? `<span class="pill warn">trễ ${i.lateDays} ngày</span>` : ''}${i.waitingDays != null ? `<span class="pill${i.waitingDays >= 2 ? ' warn' : ''}">chờ ${days(i.waitingDays)}</span>` : ''}</span></a>`).join('')}
      ${b.count > b.items.length ? `<div class="muted xs" style="padding:8px 14px">Hiện ${b.items.length}/${b.count} việc.</div>` : ''}</div>`;
  };
  const block = (k, act) => {
    const n = count(k), [label, ic, hint] = BLOCKS[k];
    const hot = n && (act || k === 'overdue');
    return `<button type="button" class="ops-block${open === k ? ' on' : ''}${hot ? ' hot' : ''}${n ? '' : ' zero'}" data-block="${k}" aria-pressed="${open === k}" aria-controls="opsPanel" title="${esc(hint)}" data-testid="ops-block-${k}">
        ${icon(ic)}<b>${n}</b><span>${label}</span></button>`;
  };

  // Một hàng chọn phạm vi: Toàn Trung tâm | từng phòng (chỉ Ban Giám đốc; lãnh đạo phòng luôn xem phòng mình).
  const sel = eff.departmentIds ? Number(eff.departmentIds) : null;
  const short = n => n.replace(/^Phòng\s+/, '');
  const scopeBar = sys ? `<div class="ops-scope"><div class="seg" role="group" aria-label="Phạm vi">
      <button type="button" data-dept="" aria-pressed="${sel == null}" data-testid="ops-scope-all">Toàn Trung tâm</button>
      ${d.departments.map(x => `<button type="button" data-dept="${x.id}" aria-pressed="${sel === x.id}" data-testid="ops-dept-${x.id}">${esc(short(x.name))}</button>`).join('')}</div></div>` : '';
  const period = PERIODS[0];
  const pct = (a, b) => (b ? Math.round(a / b * 100) + '%' : '—');

  root.oninput = null; root.onchange = null; root.onkeydown = null;
  root.innerHTML = `<div class="page-head"><h1>Tổng quan</h1><span class="muted sm">${sys ? '' : `${esc(store.me.departmentName || 'Phòng của tôi')} · `}Cập nhật ${fmtDateTime(d.generatedAt)} · <a href="#/dashboard" data-testid="ops-more-stats">Số liệu chi tiết →</a></span></div>
    ${scopeBar}
    <section class="ops-group ops-g-act" aria-labelledby="opsGAct"><h2 class="ops-gh" id="opsGAct">Cần xử lý</h2>
      <div class="ops-blocks ops-act" style="--n:${order.act.length}">${order.act.map(k => block(k, true)).join('')}</div></section>
    <section class="ops-group ops-g-watch" aria-labelledby="opsGWatch"><h2 class="ops-gh" id="opsGWatch">Theo dõi</h2>
      <div class="ops-blocks ops-watch" style="--n:${order.watch.length}">${order.watch.map(k => block(k, false)).join('')}</div></section>
    <div class="card ops-panel" id="opsPanel">${list(open)}</div>
    <div class="ops-depts-head"><h3>Theo phòng chủ trì <span class="muted sm">(nhiệm vụ gốc · ${esc(period[2])})</span></h3>
    </div>
    <div class="card ops-depts-card"><div class="tbl-scroll"><table class="table ops-depts" data-testid="ops-departments"><thead><tr><th>Phòng</th><th class="num">Đang mở</th><th class="num">Quá hạn</th><th class="num">Sắp đến hạn</th><th class="num">Chờ tiếp nhận</th><th class="num">Chờ phòng duyệt</th><th class="num">Chờ BGĐ</th><th class="num">Kế hoạch năm</th><th class="num">Đột xuất</th></tr></thead><tbody>
      ${d.byDept.map(r => `<tr><td><b>${deptLink(r.departmentId, r.department)}</b></td><td class="num">${r.open}</td><td class="num${r.overdue ? ' due overdue' : ''}">${r.overdue}</td><td class="num${r.dueSoon ? ' due soon' : ''}">${r.dueSoon}</td>
        <td class="num">${r.pendingAccept}</td><td class="num">${r.waitDept}</td><td class="num">${r.waitBgd}</td>
        <td class="num" title="Hoàn thành / tổng nhiệm vụ Kế hoạch năm có hạn trong kỳ; tiến độ bình quân">${r.plan.total ? `${r.plan.done}/${r.plan.total} · ${pct(r.plan.done, r.plan.total)}<div class="muted xs">tiến độ TB ${r.plan.avgProgress}%</div>` : '—'}</td>
        <td class="num" title="Hoàn thành / giao trong kỳ; đúng hạn">${r.adhoc.total ? `${r.adhoc.done}/${r.adhoc.total}<div class="muted xs">đúng hạn ${pct(r.adhoc.onTime, r.adhoc.done)}</div>` : '—'}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Chưa có dữ liệu.</td></tr>'}
    </tbody></table></div></div>`;
  for (const s of $$('.seg, .ops-watch', root)) scrollFade(s);

  root.onclick = e => {
    const b = e.target.closest('[data-block]'); if (b) { open = b.dataset.block; return go({ block: open, item: '', focus: '' }); }
    const s = e.target.closest('[data-dept]');
    if (s) {
      const id = s.dataset.dept ? Number(s.dataset.dept) : null;
      uiPref('ops:dept', id);
      eff.departmentIds = id ? String(id) : ''; eff.all = id ? '' : '1';
      return go({ item: '', focus: '' });
    }
  };
}
