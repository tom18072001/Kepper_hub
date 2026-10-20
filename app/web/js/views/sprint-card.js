// Kepper — thẻ hạng mục trong sprint (màn hình Sprint của dự án và trang "Cập nhật nhanh") + nút cập nhật % một chạm.
// Cập nhật % dùng PATCH /api/items/:id (máy chủ tự chuyển cột: > 0% → Đang thực hiện, 100% → Hoàn thành); ghi chú = bình luận của hạng mục.
import { api } from '../api.js';
import { personLink } from '../store.js';
import { $, esc, fmtDate, ago, toast, errorMessage } from '../util.js';

const TONE = { NOT_DUE: '', LATE_START: 'warn', ON_TRACK: 'ok', BEHIND: 'warn', AHEAD: 'ok', OVERDUE: 'danger', DONE_ON_TIME: 'ok', DONE_LATE: 'warn', CANCELLED: '', NO_PLAN: '' };
const num = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('vi-VN', { maximumFractionDigits: d }));
const vnDay = v => Math.floor((new Date(v).getTime() + 7 * 3_600_000) / 86_400_000);
export const STEPS = [25, 50, 75];
export { TONE as SPRINT_TONE };

// Hạn và số ngày còn / trễ của hạng mục, theo kế hoạch gốc.
function dueText(i) {
  if (i.done) return `xong ${fmtDate(i.completedAt)}`;
  const left = vnDay(i.baselineEnd) - vnDay(Date.now());
  return left < 0 ? `hạn ${fmtDate(i.baselineEnd)} · trễ ${-left} ngày` : left === 0 ? `hạn hôm nay` : `hạn ${fmtDate(i.baselineEnd)} · còn ${left} ngày`;
}

// Thanh tiến độ: phần tô = % thực tế; vạch = mục tiêu % cuối sprint theo kế hoạch gốc.
function progressBar(i, t) {
  const a = Math.max(0, Math.min(100, i.actual || 0)), g = Math.max(0, Math.min(100, i.targetTo ?? 0));
  const short = !i.done && a + 0.5 < g;
  return `<div class="sc-prog" title="Thực tế ${num(a, 1)}% · mục tiêu cuối T${t} ${num(g, 1)}%">
    <div class="sc-track"><i class="sc-fill ${i.done ? 'ok' : short ? (TONE[i.status] || 'warn') : 'ok'}" style="width:${a}%"></i><b class="sc-goal" style="left:${g}%"></b></div>
    <span class="sc-nums"><b>${num(a, 1)}%</b><span class="muted"> / mục tiêu ${num(g, 1)}%</span></span></div>`;
}

// Nút cập nhật nhanh: 25 / 50 / 75 / Xong + ô số; ghi chú gửi thành bình luận.
function quickControls(i) {
  const a = Math.round(i.actual || 0);
  return `<div class="qk" data-qk="${i.id}" data-code="${esc(i.code)}">
    <span class="qk-seg" role="group" aria-label="Cập nhật tiến độ ${esc(i.code)}">${STEPS.map(v => `<button type="button" class="qk-b${a === v ? ' on' : ''}" data-qv="${v}" data-testid="qk-${esc(i.code)}-${v}">${v}%</button>`).join('')}<button type="button" class="qk-b qk-done" data-qv="100" data-testid="qk-${esc(i.code)}-100">Xong</button></span>
    <label class="qk-n-wrap" title="Nhập % khác rồi bấm Enter"><input type="number" class="qk-n" min="0" max="100" step="5" value="${a}" aria-label="Tiến độ % khác ${esc(i.code)}" data-testid="qk-${esc(i.code)}-n">%</label>
    <button type="button" class="link-btn qk-note-btn" data-qnote aria-expanded="false">Ghi chú</button>
    <form class="qk-note" hidden><textarea rows="2" maxlength="2000" placeholder="Vướng mắc, kết quả, cần ai hỗ trợ… (gửi thành bình luận của hạng mục)" aria-label="Ghi chú ${esc(i.code)}"></textarea><button class="btn btn-sm">Gửi</button></form>
  </div>`;
}

// Một thẻ. opts: { t (số sprint), href(i) → liên kết mở hạng mục, canEdit, showDept, showProject }.
export function sprintCard(i, { t, href, canEdit = false, showDept = true } = {}) {
  const tone = i.done ? 'ok' : TONE[i.status] || '';
  const who = i.assignees?.length ? i.assignees.map(u => personLink(u)).join(', ') : '<span class="muted">chưa giao người</span>';
  return `<article class="sc ${tone ? 'sc-' + tone : ''}${i.done ? ' sc-isdone' : ''}" data-id="${i.id}" data-testid="sc-${esc(i.code)}">
    <div class="sc-top"><a class="code" href="${href(i)}">${esc(i.code)}</a>${i.planCode ? `<span class="muted xs">Bước ${esc(i.planCode)}</span>` : ''}
      ${i.critical ? '<span class="crit" title="Đường găng">●</span>' : ''}${i.milestone ? '<span class="ms" title="Mốc">◆</span>' : ''}
      <span class="grow"></span>${i.done ? '<span class="pill ok">Đã xong</span>' : `<span class="pill ${tone}" data-testid="sc-status">${esc(i.statusLabel || '')}</span>`}</div>
    <a class="sc-title" href="${href(i)}">${esc(i.title)}</a>
    ${i.parentCode && i.parentTitle ? `<div class="muted xs sc-parent">thuộc bước ${esc(i.parentCode)} · ${esc(i.parentTitle.slice(0, 70))}</div>` : ''}
    <div class="sc-meta muted xs">${showDept && i.leadDepartmentName ? `<span>${esc(i.leadDepartmentName)}</span>` : ''}<span>${who}</span><span class="${!i.done && vnDay(i.baselineEnd) < vnDay(Date.now()) ? 'danger-t' : ''}">${dueText(i)}</span>
      ${i.carriedFrom != null ? `<span class="pill danger sc-carry" title="Phải xong ở sprint T${i.carriedFrom} nhưng chưa xong">chuyển từ T${i.carriedFrom}</span>` : ''}</div>
    ${progressBar(i, t)}
    ${!i.done && i.progressAt ? `<div class="muted xs">cập nhật ${ago(i.progressAt)}</div>` : !i.done && !i.actual ? '<div class="muted xs">chưa cập nhật tiến độ</div>' : ''}
    ${canEdit && !i.done ? quickControls(i) : ''}
  </article>`;
}

// Gắn xử lý cho mọi nút cập nhật nhanh trong root; onSaved() để vẽ lại sau khi lưu.
export function bindQuick(root, onSaved) {
  const save = async (box, value) => {
    const id = Number(box.dataset.qk), code = box.dataset.code;
    const v = Math.max(0, Math.min(100, Math.round(Number(value))));
    if (!Number.isFinite(v)) return;
    box.querySelectorAll('button,input').forEach(b => { b.disabled = true; });
    try {
      await api(`/api/items/${id}`, { method: 'PATCH', body: { progress: v } });
      toast(v >= 100 ? `${code}: đã xong` : `${code}: đã cập nhật ${v}%`, 'ok');
      await onSaved();
    } catch (error) { toast(errorMessage(error), 'err'); box.querySelectorAll('button,input').forEach(b => { b.disabled = false; }); }
  };
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-qv]');
    if (b && root.contains(b)) { save(b.closest('[data-qk]'), b.dataset.qv); return; }
    const n = e.target.closest('[data-qnote]');
    if (n) { const f = n.closest('[data-qk]').querySelector('.qk-note'); f.hidden = !f.hidden; n.setAttribute('aria-expanded', String(!f.hidden)); if (!f.hidden) $('textarea', f).focus(); }
  });
  root.addEventListener('change', e => { if (e.target.matches('.qk-n')) save(e.target.closest('[data-qk]'), e.target.value); });
  root.addEventListener('submit', async e => {
    const f = e.target.closest('.qk-note'); if (!f) return;
    e.preventDefault();
    const box = f.closest('[data-qk]'), text = $('textarea', f).value.trim();
    if (!text) return;
    try { await api(`/api/items/${box.dataset.qk}/comments`, { method: 'POST', body: { body: text } }); toast(`${box.dataset.code}: đã gửi ghi chú`, 'ok'); $('textarea', f).value = ''; f.hidden = true; }
    catch (error) { toast(errorMessage(error), 'err'); }
  });
}
