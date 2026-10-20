// Panel chi tiết công việc: sửa nhanh, duyệt nhiều cấp, checklist, việc con, tệp, bình luận, lịch sử.
import { api, download, openPreview, ApiError } from '../api.js';
import { store, labelsFor, createProjectLabel, personLink } from '../store.js';
import { $, $$, esc, avatar, labelChip, fmtDate, fmtDateTime, ago, PRIORITY, toast, multiSelect, bindMulti, dateInput, fromDateInput, confirmDialog, errorMessage, CATEGORY, draft, draftLater, uiPref } from '../util.js';
import { reloadProject, assignableUsers } from './project.js';
import { refreshCounters, refreshBackground } from '../main.js';
import { openRepeatDialog } from './recurring-form.js';
import { openCycleForm } from './project-extra.js';
import { icon } from '../icons.js';
import { dispatchParts, progressParts, documentsParts, ratingPick, handleDispatchClick, bindDispatchInputs, summaryBar, actionZone, stagePill, countdownPill, acceptDialog } from './dispatch-panel.js';
import { sec, compact, bindSectionMemory, resetSectionMemory } from './sections.js';
import { help as showShortcuts } from '../shortcuts.js';

let openId = null, data = null, project = null;
const panel = () => $('#itemPanel');

export function isItemOpen() { return openId != null; }
export function openItemId() { return openId; }
// Tải lại panel khi có cập nhật từ người khác — bỏ qua nếu người dùng đang gõ trong panel.
// Người dùng đang thao tác trong panel: đang gõ, có bình luận/mô tả chưa lưu, đang mở danh sách chọn, hoặc đang mở hộp thoại.
function panelBusy() {
  const p = panel(), active = document.activeElement;
  if (active && p.contains(active) && active.matches('input:not([type=checkbox]), textarea, select, [contenteditable="true"]')) return true;
  if ($('#newComment', p)?.value.trim() || $('#newCheck', p)?.value.trim() || $('#newChild', p)?.value.trim()) return true;
  if ($('#rpContent', p)?.value.trim() || $('#docNumber', p)?.value.trim() || p.querySelector('[data-answer-input]')?.value.trim()) return true;
  if ($('#saveDesc', p) && !$('#saveDesc', p).classList.contains('hidden')) return true;
  if (p.querySelector('.multi-list:not(.hidden)')) return true;
  return !$('#modalRoot').classList.contains('hidden');
}
// Có cập nhật trong lúc đang gõ: không vẽ lại (mất chữ), mà báo "Có cập nhật mới · Tải lại".
function markStale() {
  const head = $('.ip-head', panel());
  if (head && !$('[data-testid="panel-stale"]', head)) head.querySelector('.grow')?.insertAdjacentHTML('afterend', '<button class="pill info stale-chip" data-act="reload-panel" data-testid="panel-stale">Có cập nhật mới · Tải lại</button>');
}
export async function reloadOpenItem() {
  if (openId == null) return;
  if (panelBusy()) return markStale();
  try { await load({ soft: true }); } catch { /* việc có thể đã bị lưu trữ hoặc mất quyền */ }
}
let opener = null; // phần tử đã mở panel — trả tiêu điểm về khi đóng
export function closeItem(updateHash = false) {
  if (openId == null) return;
  const closedId = openId;
  openId = null; data = null; lastRendered = null;
  panel().classList.add('hidden'); $('#panelBackdrop').classList.add('hidden');
  panel().innerHTML = '';
  // Trả tiêu điểm + vạch chọn về đúng hàng / thẻ vừa mở (bàn phím đi tiếp được).
  const back = (opener && document.body.contains(opener) ? opener : null)
    || [...document.querySelectorAll('#view [data-href], #view [data-open], #view .ops-row, #view .kcard, #view tr[data-id]')].find(el => rowItemId(el) === closedId);
  opener = null;
  if (back) { document.querySelectorAll('.kb-cursor').forEach(x => x.classList.remove('kb-cursor')); back.classList.add('kb-cursor'); if (back.tabIndex < 0 && !back.matches('a,button')) back.tabIndex = -1; back.focus({ preventScroll: true }); }
  if (updateHash && location.hash.includes('item=')) {
    const [path, query = ''] = location.hash.split('?');
    const params = new URLSearchParams(query); params.delete('item'); params.delete('focus');
    history.replaceState(null, '', path + (params.toString() ? '?' + params : ''));
  }
}
$('#panelBackdrop').addEventListener('click', () => closeItem(true));

// Id việc mà một hàng / thẻ trong danh sách trỏ tới (để J/K và trả tiêu điểm khi đóng).
export function rowItemId(el) {
  const href = el.getAttribute('data-href') || el.getAttribute('href') || '';
  const m = href.match(/[?&]item=(\d+)/);
  if (m) return Number(m[1]);
  return Number(el.dataset.open || el.dataset.id || el.dataset.itemId) || null;
}
let focusTarget = null, lastRendered = null;
export async function openItem(id, { focus } = {}) {
  const fresh = openId !== id;
  openId = id; focusTarget = focus || new URLSearchParams(location.hash.split('?')[1] || '').get('focus');
  if (focusTarget && !/^[a-z][\w-]{0,40}$/i.test(focusTarget)) focusTarget = null; // giá trị từ URL đi vào bộ chọn CSS
  if (fresh) { const a = document.activeElement; opener = a && $('#view').contains(a) ? a : opener; }
  panel().classList.remove('hidden'); $('#panelBackdrop').classList.remove('hidden');
  if (fresh) { panel().innerHTML = '<div class="empty">Đang tải…</div>'; lastRendered = null; }
  try { await load(); } catch (error) { panel().innerHTML = `<div class="ip-head"><b class="grow">Không mở được công việc</b><button class="icon-btn" data-close aria-label="Đóng"><svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div><div class="empty">${esc(errorMessage(error))}</div>`; panel().querySelector('[data-close]').onclick = () => closeItem(true); }
}
async function load({ soft = false } = {}) {
  const id = openId;
  if (id == null) return; // panel đã đóng trong lúc chờ
  const item = await api(`/api/items/${id}`);
  if (openId !== id) return;
  if (!project || project.id !== item.project.id) {
    const [p, cycles] = await Promise.all([api(`/api/projects/${item.project.id}`), api(`/api/projects/${item.project.id}/cycles`)]);
    project = { ...p, cycles };
  }
  if (openId !== id) return;
  if (soft && panelBusy()) return; // người dùng bắt đầu thao tác trong lúc đang tải
  data = item;
  const first = lastRendered !== id;
  if (first) import('./palette.js').then(m => m.rememberRecent?.(id, item.project.id)).catch(() => {});
  render();
  lastRendered = id;
  if (focusTarget) {
    const t = focusTarget; focusTarget = null;
    if (t === 'accept' && data.can?.accept) return acceptDialog(data, refresh);
    const el = panel().querySelector({ approval: '#approval-zone', extension: '#extension-zone', proposal: '#proposal-zone', returned: '#returned-zone' }[t] || `[data-testid="${t}"]`)
      || panel().querySelector({ approval: '#approval-section', extension: '[data-testid="extension-pending"]', proposal: '#progress-section' }[t] || '#__none');
    if (el && !el.getClientRects().length) panel().classList.remove('ip-lite');
    if (el) { el.closest('details')?.setAttribute('open', ''); requestAnimationFrame(() => { el.scrollIntoView({ block: 'start' }); (el.querySelector('textarea, input, button') || $('.ip-summary .btn-primary', panel()))?.focus({ preventScroll: true }); }); }
  } else if (first) $('.ip-head', panel())?.focus({ preventScroll: true });
}
async function refresh() { await load(); reloadProject(); refreshCounters(); refreshBackground(); }
async function patch(body) {
  try { await api(`/api/items/${data.id}`, { method: 'PATCH', body }); await refresh(); return true; }
  catch (error) {
    if (error instanceof ApiError && error.code === 'WIP_LIMIT' && project.rights.canManage && body.stateId) {
      if (await confirmDialog(error.message + '. Vẫn chuyển vượt giới hạn?', { okText: 'Vẫn chuyển' })) return patch({ ...body, overrideWip: true });
    } else toast(errorMessage(error), 'err');
    await load(); return false;
  }
}

// Chọn mức duyệt của việc (chỉ người quản lý dự án; khoá khi đang chờ duyệt).
function levelControl(pending) {
  const all = data.allApprovalSteps || [];
  if (!all.length) return '';
  const label = n => n === 0 ? 'Không cần duyệt' : n >= all.length ? `Đủ ${all.length} cấp (${all.map(s => s.name).join(' → ')})` : `${n} cấp: ${all.slice(0, n).map(s => s.name).join(' → ')}`;
  const source = { MANUAL: 'chọn tay', RULE: 'theo quy tắc tự động', DEFAULT: 'mặc định của dự án', CHILD: 'việc nhánh — lãnh đạo phòng duyệt' }[data.approvalSource] || '';
  if (!data.rights.canManage || pending || data.archivedAt) return `<p class="muted sm" data-testid="approval-level-text">Mức duyệt: <b>${esc(label(data.approvalSteps.length))}</b>${source ? ` · ${source}` : ''}</p>`;
  const opts = [['', data.approvalSource === 'MANUAL' ? 'Tự động (theo quy tắc / mặc định dự án)' : `Tự động — ${data.approvalSteps.length === 0 ? 'không cần duyệt' : data.approvalSteps.length >= all.length ? `đủ ${all.length} cấp` : `${data.approvalSteps.length} cấp`}`], ...Array.from({ length: all.length + 1 }, (_, n) => [String(n), label(n)])];
  return `<label class="field level-pick">Mức duyệt của việc này<select id="ipLevels" data-testid="item-approval-levels">${opts.map(([v, t]) => `<option value="${v}"${String(data.approvalLevels ?? '') === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
    <span class="muted xs">Hiện tại: ${esc(label(data.approvalSteps.length))} · ${source}</span></label>`;
}
function approverNames(level) {
  if (data.stepApprovers?.[level]) return data.stepApprovers[level].join(', ') || 'Chưa có người duyệt';
  const step = (project.approvalSteps || []).find(s => s.level === level);
  return step?.approvers?.length ? step.approvers.map(a => a.fullName).join(', ') : 'Chưa có người duyệt';
}

// Khối duyệt của người đang được duyệt (vùng "Cần bạn xử lý").
function approvalBox() {
  const pending = data.approvals.find(a => a.status === 'PENDING');
  if (!pending || !data.canApprove) return '';
  const step = data.approvalSteps.find(s => s.level === pending.currentLevel);
  const submit = pending.actions.filter(a => a.decision === 'SUBMIT').at(-1);
  return `<div class="approval-box zone-box" id="approval-zone"><b>Bạn đang duyệt bước ${pending.currentLevel}/${pending.totalLevels}${step ? ` · ${esc(step.name)}` : ''}${data.lastLevel ? ' — bước cuối, nghiệm thu' : ''}</b>${data.submitRounds > 1 ? ` <span class="pill warn">Lần trình ${data.submitRounds}</span>` : ''}
      ${submit ? `<div class="muted sm" style="margin-top:4px">${esc(submit.actorName || '')} trình ${ago(submit.createdAt)}${submit.comment ? `: “${esc(submit.comment)}”` : ''}</div>` : ''}
      ${data.attachments.length ? `<div class="muted xs">Tệp mới nhất: ${esc(data.attachments[0].fileName)} · ${ago(data.attachments[0].createdAt)}</div>` : ''}
      <textarea id="approvalComment" placeholder="Ý kiến (bắt buộc khi không duyệt)" rows="2" style="margin-top:8px" data-testid="approval-comment" aria-describedby="approvalCommentHelp"></textarea>
      <div class="field-error" id="approvalCommentHelp" role="alert"></div>${data.lastLevel ? ratingPick() : ''}
      <div class="row" style="margin-top:8px"><button class="btn btn-ok" data-act="approve" data-testid="approve-btn">Duyệt</button><button class="btn btn-danger" data-act="reject" data-testid="reject-btn">Không duyệt</button></div></div>`;
}
function approvalSection(open) {
  if (!(data.allApprovalSteps || []).length) return '';
  const latest = data.approvals[0];
  const pendingNow = latest?.status === 'PENDING' ? latest : null;
  if (!data.approvalSteps.length) return sec('approval', { title: 'Duyệt', summary: 'không cần duyệt', open, testid: 'approval-section', id: 'approval-section', body: `${levelControl(pendingNow)}
    <p class="muted sm" data-testid="no-approval-needed">Việc này không cần duyệt — chuyển thẳng sang Hoàn thành khi xong.</p>` });
  const pending = latest?.status === 'PENDING' ? latest : null;
  const stepClass = s => {
    if (!latest || latest.status === 'CANCELLED' || latest.status === 'REOPENED') return '';
    if (latest.status === 'APPROVED') return 'done';
    if (latest.status === 'REJECTED') return s.level < latest.actions.at(-1)?.level ? 'done' : s.level === latest.actions.at(-1)?.level ? 'rejected' : '';
    return s.level < latest.currentLevel ? 'done' : s.level === latest.currentLevel ? 'current' : '';
  };
  const review = project.states.find(s => s.category === 'REVIEW');
  const canSubmit = data.rights.canEdit && !pending && review && !['REVIEW', 'COMPLETED', 'CANCELLED'].includes(data.state.category) && data.dispatchStatus !== 'PENDING';
  const history = data.approvals.flatMap(r => r.actions.map(a => ({ ...a, request: r }))).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const word = { SUBMIT: 'gửi duyệt', APPROVE: 'duyệt', REJECT: 'trả lại', CANCEL: 'huỷ yêu cầu' };
  const statusText = latest ? { PENDING: 'Đang chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Bị trả lại', CANCELLED: 'Đã huỷ', REOPENED: 'Mở lại' }[latest.status] : '';
  const cur = pending ? data.approvalSteps.find(s => s.level === pending.currentLevel) : null;
  const act = a => `<div class="act"><b>${esc(a.actorName || '')}</b> ${a.onBehalfOfName ? `(thay ${esc(a.onBehalfOfName)}) ` : ''}${word[a.decision] || a.decision}${a.level ? ` ở bước ${a.level}` : ''} · ${ago(a.createdAt)}${a.comment ? `<div class="comment" style="margin-top:4px">${esc(a.comment)}</div>` : ''}</div>`;
  // Lượt trả lại gần nhất luôn hiện; các thao tác duyệt cũ hơn thu vào "Lịch sử duyệt".
  const lastReject = latest?.status === 'REJECTED' ? history.find(a => a.decision === 'REJECT' && a.request.id === latest.id) : null;
  const body = `${levelControl(pending)}
    <div class="steps">${data.approvalSteps.map(s => `<div class="step ${stepClass(s)}"><span class="n">${s.level}</span><span class="grow">${esc(s.name)}</span><span class="muted xs">${esc(approverNames(s.level))}</span></div>`).join('')}</div>
    ${canSubmit && (!data.dispatchStatus || data.can?.work) ? (data.dispatchStatus ? `<button class="btn btn-ghost btn-sm" style="margin-top:10px" data-act="submit-product" data-testid="submit-product">${icon('send')}Nộp sản phẩm (phiếu trình)</button>` : `<button class="btn btn-primary btn-sm" style="margin-top:10px" data-act="submit-approval" data-testid="submit-approval">Gửi duyệt</button>`) : ''}
    ${lastReject ? `<div class="timeline-list" style="margin-top:10px">${act(lastReject)}</div>` : ''}
    ${history.length ? `<details class="older" data-sub="approvalHistory"><summary class="link-btn">Lịch sử duyệt (${history.length})</summary><div class="timeline-list">${history.map(act).join('')}</div></details>` : ''}`;
  return sec('approval', { title: `Quy trình duyệt ${data.approvalSteps.length} cấp`, open, testid: 'approval-section', id: 'approval-section',
    summary: `${latest ? `<span class="pill" data-testid="approval-status">${statusText}</span>` : ''}${cur ? ` đang ở bước ${pending.currentLevel}/${pending.totalLevels} · ${esc(cur.name)} · gửi ${ago(pending.createdAt)}` : ''}`, body });
}

const ACT_TEXT = {
  CREATED: d => 'đã tạo việc' + ({ INTAKE: ' từ yêu cầu tiếp nhận', RECURRING: ' (việc lặp lại)', EXCEL: ' (nhập Excel)', NOTE: ' từ ghi chú cá nhân', PLAN: ' từ kế hoạch năm', REGISTER: ' (nhập sổ giao việc)' }[d?.source] || ''), UPDATED: d => 'đã cập nhật ' + Object.keys(d || {}).map(k => ({ title: 'tiêu đề', descriptionHtml: 'mô tả', descriptionText: '', priority: 'ưu tiên', dueDate: 'hạn', startDate: 'ngày bắt đầu', estimate: 'ước lượng', labels: 'nhãn', parentId: 'việc cha', cycleId: 'chu kỳ', approvalLevels: 'mức duyệt', progress: 'tiến độ', internalDueDate: 'hạn nộp phòng', returnedAt: '', returnNote: '', deliverable: 'sản phẩm đầu ra', outputs: 'sản phẩm đã có', resultNote: 'kết quả / khó khăn', review: 'đánh giá', note: 'ghi chú', taskType: 'loại nhiệm vụ', leadDepartmentId: 'đơn vị chủ trì', supportDepartmentIds: 'đơn vị phối hợp', originalDueDate: '', dispatchStatus: '', dispatchedAt: '', acceptedAt: '', acceptedById: '', source: 'nguồn giao việc', assignedById: 'người giao', assignedAt: 'ngày giao', coordinatorText: 'đơn vị phối hợp', completedAt: 'ngày hoàn thành' }[k] ?? (k === 'cycle' ? 'chu kỳ: ' + esc(d.cycle) : k))).filter(Boolean).join(', '),  STATE: d => `chuyển <b>${esc(d.from)}</b> → <b>${esc(d.to)}</b>`, ASSIGNEES: () => 'đã thay đổi người nhận', COMMENT: () => 'đã bình luận',
  ATTACHMENT: d => 'đã đính kèm ' + esc((d.files || []).join(', ')), ATTACHMENT_DELETED: d => 'đã xoá tệp ' + esc(d.fileName || ''),
  SUPPORTERS: () => 'đã thay đổi người phối hợp', TEMPLATE_APPLIED: d => `tạo ${d.count} việc nhánh từ mẫu "${esc(d.template)}"`, CHECKLIST_ADDED: d => 'thêm checklist: ' + esc(d.title), CHECKLIST_DONE: d => 'hoàn thành checklist: ' + esc(d.title), CHECKLIST_UNDONE: d => 'bỏ đánh dấu: ' + esc(d.title),
  APPROVAL_SUBMITTED: d => 'gửi duyệt (' + esc(d.step || '') + ')', APPROVAL_APPROVED: d => `duyệt bước ${d.level}${d.next ? ', chuyển tiếp ' + esc(d.next) : ''}`,
  APPROVAL_COMPLETED: d => 'duyệt bước cuối — việc hoàn thành' + (d?.rating ? ` (xếp loại: ${({ EXCELLENT: 'Hoàn thành xuất sắc', GOOD: 'Hoàn thành tốt', PASS: 'Hoàn thành', FAIL: 'Không hoàn thành' })[d.rating]})` : ''),
  DISPATCHED: d => d?.direct ? 'giao trực tiếp cán bộ (phòng vẫn duyệt trước khi trình)' : 'giao về phòng chủ trì', DISPATCH_ACCEPTED: d => 'tiếp nhận và phân công' + (d?.onBehalfOf ? ` (thay ${esc(d.onBehalfOf)})` : '') + (d?.internalDueDate ? `, hạn nộp phòng ${fmtDate(d.internalDueDate)}` : '') + (d?.note ? ': ' + esc(d.note) : ''), DISPATCH_REASSIGNED: () => 'phân công lại',
  PROGRESS_REPORT: d => (d.asSupporter ? `báo cáo phần phối hợp ${d.progress}%` : `báo cáo tiến độ ${d.progress}%`) + (d.hasProposal ? ' (có kiến nghị)' : ''), PROPOSAL_ANSWERED: () => 'trả lời kiến nghị',
  PROPOSAL_FORWARDED: () => 'trình kiến nghị lên Ban Giám đốc',
  EXTENSION_REQUESTED: () => 'đề nghị gia hạn', EXTENSION_APPROVED: () => 'đồng ý gia hạn', EXTENSION_REJECTED: () => 'không đồng ý gia hạn',
  CHILDREN_BULK: d => `chia ${d.count} việc nhánh`, SUPPORT_STAFF: () => 'cử cán bộ phối hợp', HANDOVER: d => 'bàn giao: cán bộ nghỉ việc được gỡ khỏi việc' + (d?.reset ? ', trả về phòng để phân công lại' : ''),
  DOCUMENT_ADDED: d => 'thêm văn bản ' + esc(d.number || ''), DOCUMENT_REMOVED: d => 'gỡ văn bản ' + esc(d.number || ''), APPROVAL_REJECTED: d => 'trả lại: ' + esc(d.comment || ''), APPROVAL_CANCELLED: () => 'huỷ yêu cầu duyệt', ARCHIVED: () => 'đã xoá việc (vào thùng rác)', RESTORED: () => 'đã khôi phục việc từ thùng rác',
};

// Khối "Giao việc & kết quả" theo mẫu Sổ theo dõi, kiểm soát giao việc. Ô có nội dung hiện sẵn; ô trống gom thành một dòng "+ …".
function registerParts(editable, outputsEditable = editable) {
  const d = data;
  const canReview = !d.archivedAt && (d.rights.canManage || d.assignedById === store.me.id);
  const fields = [
    ['deliverable', 'Sản phẩm đầu ra', d.deliverable, { rows: 2 }],
    ['outputs', 'Sản phẩm đã có theo tiến độ', d.outputs, { canWrite: outputsEditable, rows: 3, hint: 'mỗi dòng một văn bản (tờ trình, công văn, quyết định…)' }],
    ['resultNote', 'Kết quả / Khó khăn, kiến nghị', d.resultNote, { rows: 3, hint: d.dispatchStatus ? 'tự cập nhật từ báo cáo tiến độ mới nhất' : '' }],
    ['review', 'Đánh giá của người giao', d.review, { canWrite: canReview, rows: 2, hint: d.reviewedByName ? `— ${esc(d.reviewedByName)}, ${fmtDateTime(d.reviewedAt)}` : '' }],
    ['note', 'Ghi chú', d.note, { rows: 2 }],
  ].filter(([key, , value, o]) => key !== 'review' || canReview || value);
  const rowsFor = (v, min) => Math.min(8, Math.max(min, String(v || '').split('\n').length));
  const area = ([key, label, value, { canWrite = editable, rows = 3, hint = '' }]) => `<label class="field reg-field" data-reg="${key}"${!value && canWrite ? ' hidden' : ''}>${label}${hint ? ` <span class="muted xs">${hint}</span>` : ''}
    ${canWrite ? `<textarea data-field="${key}" rows="${rowsFor(value, rows)}" data-testid="item-${key}">${esc(value || '')}</textarea>` : `<div class="reg-readonly">${esc(value || '—').replace(/\n/g, '<br>')}</div>`}</label>`;
  const empties = fields.filter(([, , value, o]) => !value && (o.canWrite ?? editable));
  const plan = d.plan || d.planCode || d.period || d.location || d.budget != null || d.supervisorText ? `<div class="plan-box" data-testid="item-plan">
      ${d.plan ? `<div><span class="muted xs">Kế hoạch</span><b>${esc(d.plan.name)}</b>${d.planCode ? ` · nhiệm vụ ${esc(d.planCode)}` : ''}</div>` : ''}
      ${d.planSection ? `<div><span class="muted xs">Nhóm nhiệm vụ</span>${esc(d.planSection)}</div>` : ''}
      ${d.period ? `<div><span class="muted xs">Thời gian</span>${esc(d.period)}</div>` : ''}${d.location ? `<div><span class="muted xs">Địa điểm</span>${esc(d.location)}</div>` : ''}
      ${d.budget != null ? `<div><span class="muted xs">Kinh phí</span>${Number(d.budget).toLocaleString('vi-VN')} triệu đồng</div>` : ''}${d.supervisorText ? `<div><span class="muted xs">Lãnh đạo phụ trách</span>${esc(d.supervisorText)}</div>` : ''}
    </div>` : '';
  const filled = fields.filter(([, , v]) => v).length;
  const body = `${plan}${fields.map(area).join('')}
    ${empties.length ? `<div class="add-links">${empties.map(([key, label]) => `<button type="button" class="link-btn" data-reveal="${key}">+ ${esc(label)}</button>`).join('')}</div>` : ''}`;
  return { body, filled, summary: d.deliverable ? esc(String(d.deliverable).split('\n')[0].slice(0, 60)) : '' };
}

function repeatBlock(editable) {
  const rule = data.recurring;
  if (rule) return `<div class="repeat-box" data-testid="item-repeat"><span class="muted xs">Lặp lại</span><b>${esc(rule.schedule)}</b>${rule.isActive ? '' : '<span class="pill">Đang tạm dừng</span>'}
    ${project.rights.canManage ? '<button class="btn btn-ghost btn-sm" data-act="repeat" data-testid="repeat-edit">Sửa lịch</button>' : ''}</div>`;
  if (!editable || !project.rights.canManage) return '';
  return `<button class="btn btn-ghost btn-sm" data-act="repeat" data-testid="repeat-open">${icon('history')}Lặp lại việc này…</button>`;
}

// Chia việc nhánh: người quản lý, người giao, lãnh đạo phòng chủ trì, người chủ trì (giống máy chủ).
const canSplit = d => d.rights.canManage || d.can?.isAssigner || d.can?.isLeadLeader || d.can?.myRole === 'LEAD' || !d.dispatchStatus;
// Bảng việc nhánh: ai làm, hạn, khâu, tiến độ — lãnh đạo phòng nắm được ngay.
function childrenSection(d, editable, open) {
  const link = c => `${location.hash.split('?')[0]}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || '')), item: c.id })}`;
  const rows = d.children.map(c => `<tr><td><a href="${link(c)}" class="code" data-testid="child-${esc(d.project.key)}-${c.number}">${esc(d.project.key)}-${c.number}</a></td>
      <td>${esc(c.title)}</td><td class="muted sm">${(c.assignees || []).map(a => esc(a.fullName)).join(', ') || '—'}</td>
      <td class="nowrap">${c.dueDate ? fmtDate(c.dueDate) : '—'}${c.internalDueDate ? `<div class="muted xs">nộp phòng ${fmtDate(c.internalDueDate)}</div>` : ''}</td>
      <td>${stagePill(c.stage)}</td><td class="num">${c.stage?.code === 'DONE' ? 100 : c.progress}%</td></tr>`).join('');
  const done = d.children.filter(c => c.stage?.code === 'DONE').length;
  const add = editable && !d.parent && canSplit(d) ? `<div class="row wrap add-row"><input id="newChild" class="grow" placeholder="Thêm một việc nhánh, Enter để tạo" data-testid="child-input" maxlength="300" aria-label="Thêm việc nhánh">
      <button class="btn btn-ghost btn-sm" data-act="bulk-children" data-testid="bulk-children-open">${icon('list')}Chia nhiều việc…</button>
      ${(store.templates || []).length ? `<button class="btn btn-ghost btn-sm" data-act="template-children" data-testid="template-open">${icon('checklist')}Từ mẫu…</button>` : ''}</div>` : '';
  if (!rows) return add ? compact('Việc nhánh', add, { testid: 'children-section' }) : '';
  return sec('children', { title: 'Việc nhánh', count: `${done}/${d.children.length} xong`, open, testid: 'children-section',
    body: `<div class="tbl-scroll"><table class="table compact children-table"><thead><tr><th>Mã</th><th>Việc</th><th>Cán bộ</th><th>Hạn</th><th>Khâu</th><th class="num">%</th></tr></thead><tbody>${rows}</tbody></table></div>${add}` });
}

// Hạn do người khác giao: người thực hiện không tự sửa (giống kiểm tra ở máy chủ).
const dueEditable = d => !d.assignedById || d.assignedById === store.me.id || d.rights.canManage || (d.parent && d.can?.isLeadLeader);

// Khối nào mở sẵn theo vai trò và khâu (SPEC GĐ3c 2.1a). Người dùng tự mở/đóng thì nhớ, thắng quy tắc này.
function sectionPlan(d) {
  const role = d.can?.myRole, st = d.stage?.code;
  const dispatched = !!d.dispatchStatus || project.visibility === 'ASSIGNED';
  const closed = ['COMPLETED', 'CANCELLED'].includes(d.state.category);
  const approver = !!(d.approvals.find(a => a.status === 'PENDING') && d.canApprove);
  const o = { desc: true, dispatch: false, register: false, approval: true, progress: dispatched, docs: dispatched, check: true, children: true, files: true, comments: true, history: false };
  if (!dispatched) return { ...o, register: true };
  if (approver) Object.assign(o, { desc: false, progress: true, docs: true, check: false, children: false, files: true, comments: false });
  else if (role === 'LEADER' && st === 'PENDING_ACCEPT') Object.assign(o, { desc: true, dispatch: true, docs: true, children: true, progress: false, check: false });
  else if (role === 'LEADER') Object.assign(o, { dispatch: true, children: true, progress: true, check: false });
  else if (role === 'LEAD' && st === 'RETURNED') Object.assign(o, { files: true, docs: true, progress: false, check: false });
  else if (role === 'LEAD' && ['WAIT_DEPT', 'WAIT_BGD', 'WAIT_APPROVAL'].includes(st)) Object.assign(o, { progress: false, files: true, check: false });
  else if (role === 'LEAD') Object.assign(o, { dispatch: true }); // hạn nộp phòng, xin gia hạn
  else if (role === 'SUPPORT') Object.assign(o, { approval: false, check: false, children: false, docs: false });
  else if (role === 'ASSIGNER') Object.assign(o, { children: true, progress: true });
  if (closed) Object.assign(o, { progress: false, register: true, check: false });
  return o;
}
const SEC_KEYS = ['desc', 'dispatch', 'register', 'approval', 'progress', 'docs', 'check', 'children', 'files', 'comments', 'history', 'more'];
const X = '<svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const FILE = '<svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h6"/></svg>';

// Bản nháp trong sessionStorage (mất khi đóng tab, xoá khi đăng xuất): bình luận, báo cáo, ý kiến duyệt / trả lời / gia hạn.
const DRAFT_SEL = '#newComment, #rpContent, #rpDiff, #rpProp, #approvalComment, #extNote, [data-answer-input]';
const draftKey = el => `${data.id}:${el.dataset.answerInput ? 'answer-' + el.dataset.answerInput : el.id}`;
function restoreDrafts(p) {
  for (const el of $$(DRAFT_SEL, p)) {
    const v = draft(draftKey(el));
    if (v && !el.value) { el.value = v; el.closest('details')?.setAttribute('open', ''); el.closest('details.sec')?.setAttribute('open', ''); }
  }
}

function render() {
  const d = data, r = d.rights, editable = r.canEdit && !d.archivedAt;
  // Việc điều hành: người phối hợp / lãnh đạo phòng phối hợp chỉ báo cáo, bình luận, đính kèm — không sửa nội dung, trạng thái (máy chủ cũng chặn).
  const full = (!d.dispatchStatus && project.visibility !== 'ASSIGNED') || r.canManage || d.can?.isAssigner || d.can?.work || d.reporterId === store.me.id;
  const fe = editable && full;
  const users = assignableUsers(project);
  const done = d.checklist.filter(c => c.done).length;
  const states = project.states;
  // Việc cần duyệt: không kéo thẳng sang Hoàn thành (máy chủ cũng chặn) — đi qua "Gửi duyệt" / "Nộp sản phẩm".
  const needsApproval = (d.approvalSteps || []).length > 0 && !d.approvals.some(x => x.status === 'APPROVED');
  const progEdit = fe && d.state.category !== 'COMPLETED' && d.can?.progress !== false;
  const plan = sectionPlan(d);
  // Gọn (mặc định): chỉ tên việc, người được phân công, hạn, tài liệu hai chiều (+ vùng cần xử lý); báo cáo, bình luận thu lại.
  const lite = uiPref('ip:full') !== true;
  if (lite) Object.assign(plan, { files: true, progress: false, comments: false });
  const p = panel();
  // Vẽ lại cùng một việc: giữ vị trí cuộn, khối đang mở / đóng, tiêu điểm (không nhảy về đầu sau mỗi thao tác).
  const same = lastRendered === d.id;
  const keep = same ? { top: $('.ip-body', p)?.scrollTop || 0, open: new Map($$('details[data-sec], details[data-sub]', p).map(x => [x.dataset.sec || 'sub:' + x.dataset.sub, x.open])), focus: document.activeElement && p.contains(document.activeElement) ? document.activeElement.id : null } : null;
  const dispatchedView = d.dispatchStatus || d.leadDepartmentId || d.taskType === 'PLAN' || project.visibility === 'ASSIGNED';
  const disp = dispatchedView ? dispatchParts(d, editable && !r.delegated, project.visibility === 'ASSIGNED') : null;
  const prog = progressParts(d, editable);
  const docs = documentsParts(d, editable);
  const reg = registerParts(fe, editable);
  const zone = approvalBox() + actionZone(d);
  const descEmpty = !String(d.descriptionText || '').trim() && !/<(img|li|table)/i.test(d.descriptionHtml || '');
  const descBody = `${fe ? `<div class="toolbar"><button data-cmd="bold" title="Đậm">B</button><button data-cmd="italic" title="Nghiêng"><i>I</i></button><button data-cmd="insertUnorderedList" title="Danh sách">•</button><button data-cmd="insertOrderedList" title="Danh sách số">1.</button></div>` : ''}
          <div class="editor rich" id="ipDesc" ${fe ? 'contenteditable="true"' : ''} data-placeholder="Thêm mô tả…" data-testid="item-description">${d.descriptionHtml}</div>
          ${fe ? '<div class="row" style="margin-top:6px"><button class="btn btn-sm btn-primary hidden" id="saveDesc" data-testid="save-description" title="Lưu (Ctrl S)">Lưu mô tả</button></div>' : ''}`;
  const checklistBody = `<div data-testid="checklist">${d.checklist.map(c => `<div class="checklist-row${c.done ? ' done' : ''}"><input type="checkbox" data-check="${c.id}" ${c.done ? 'checked' : ''} ${editable ? '' : 'disabled'} aria-label="${esc(c.title)}"><span class="grow">${esc(c.title)}</span>${editable ? `<button class="icon-btn" data-del-check="${c.id}" aria-label="Xoá mục checklist" title="Xoá mục này">${X}</button>` : ''}</div>`).join('')}</div>
          ${editable ? '<input id="newCheck" placeholder="Thêm mục checklist, Enter để lưu" data-testid="checklist-input" maxlength="300" aria-label="Thêm mục checklist">' : ''}`;
  // Tài liệu hai chiều: bên giao gửi (căn cứ, tài liệu kèm khi giao) ↔ bên thực hiện gửi lại (sản phẩm, kết quả).
  // Tệp xếp theo người tải lên: người chủ trì / phối hợp → "Bên thực hiện"; còn lại (người giao, lãnh đạo) → "Bên giao".
  const doers = new Set([...d.assignees.map(a => a.id), ...(d.supporters || []).map(a => a.id)]);
  const attRow = a => `<div class="att">${FILE}<span class="name" title="${esc(a.fileName)}">${esc(a.fileName)}</span><span class="muted xs">${(a.sizeBytes / 1024).toFixed(0)} KB · ${esc(a.uploadedByName || '')} · <span title="${fmtDateTime(a.createdAt)}">${ago(a.createdAt)}</span></span>
            ${/\.(pdf|png|jpe?g|gif|webp|docx?)$/i.test(a.fileName) ? `<button class="btn btn-ghost btn-sm" data-preview="${a.id}">Xem</button>` : ''}<button class="btn btn-ghost btn-sm" data-download="${a.id}" data-testid="download-${esc(a.fileName)}">Tải</button>${editable ? `<button class="icon-btn" data-del-att="${a.id}" aria-label="Xoá tệp" title="Xoá tệp">${X}</button>` : ''}</div>`;
  const docRow = x => `<div class="att tw-doc" data-testid="tw-doc"><span class="pill">${x.kind === 'BASIS' ? 'Căn cứ' : x.kind === 'ISSUED' ? 'Đã phát hành' : 'Sản phẩm'}</span><b>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.number)}</a>` : esc(x.number)}</b><span class="name" title="${esc(x.summary)}">${esc(x.summary)}</span></div>`;
  const giveFiles = d.attachments.filter(a => !doers.has(a.uploadedById)), backFiles = d.attachments.filter(a => doers.has(a.uploadedById));
  const giveDocs = (d.documents || []).filter(x => x.kind === 'BASIS'), backDocs = (d.documents || []).filter(x => x.kind !== 'BASIS');
  const iAmDoer = doers.has(store.me.id);
  const twCol = (title, who, docsList, files, testid) => `<div class="tw-col" data-testid="${testid}"><div class="tw-h">${title}${who ? ` <span class="muted xs">· ${who}</span>` : ''}</div>
      ${docsList.map(docRow).join('')}${files.map(attRow).join('')}${!docsList.length && !files.length ? '<div class="muted xs tw-empty">Chưa có</div>' : ''}</div>`;
  const filesBody = `<div data-testid="attachments" class="two-way">
      ${twCol('Bên giao gửi', d.assignedByName ? esc(d.assignedByName) : '', giveDocs, giveFiles, 'tw-give')}
      ${twCol('Bên thực hiện gửi lại', d.assignees.map(a => esc(a.fullName)).join(', '), backDocs, backFiles, 'tw-back')}</div>
          ${editable ? `<label class="btn ${iAmDoer ? 'btn-primary' : 'btn-ghost'} btn-sm" style="margin-top:6px">${icon('plus')}${iAmDoer ? 'Gửi kết quả (đính kèm tệp)' : 'Đính kèm tài liệu giao'}<input type="file" id="attInput" multiple hidden data-testid="attach-input"></label><span class="muted xs"> PDF, Office, ảnh, ZIP, TXT/CSV · tối đa 25 MB</span>` : ''}`;
  const commentsBody = `<div class="timeline-list" data-testid="comments">${d.comments.map(c => `<div class="comment"><div class="who">${esc(c.authorName || '')} <span>· ${ago(c.createdAt)}</span></div><div class="rich">${c.bodyHtml}</div></div>`).join('')}</div>
          ${editable ? '<textarea id="newComment" placeholder="Viết bình luận… dùng @tàikhoản để nhắc ai đó" rows="3" style="margin-top:8px" data-testid="comment-input" aria-label="Bình luận"></textarea><div class="row" style="margin-top:6px"><button class="btn btn-primary btn-sm" data-act="comment" data-testid="comment-submit" title="Gửi (Ctrl Enter)">Gửi bình luận</button></div>' : ''}`;
  const lastAct = d.activities[0];
  const historyBody = `<div class="timeline-list" data-testid="activity">${d.activities.map(a => `<div class="act"><b>${esc(a.actorName)}</b> ${(ACT_TEXT[a.type] || (() => esc(a.type)))(a.data)} · <span title="${fmtDateTime(a.createdAt)}">${ago(a.createdAt)}</span></div>`).join('')}</div>`;
  const stateLabel = st => (st.name === CATEGORY[st.category] ? esc(st.name) : `${esc(st.name)} · ${CATEGORY[st.category]}`);
  // Cột phải: phần chính luôn hiện; trường ít dùng vào "Thêm thông tin" (đếm số trường đã có giá trị).
  const moreFilled = [d.coordinatorText, d.source, d.assignedAt, d.startDate, d.estimate, d.cycleId, d.recurring].filter(v => v != null && v !== '').length;
  const showLabels = project.visibility !== 'ASSIGNED' || d.labels.length;
  p.innerHTML = `
    <div class="ip-head" tabindex="-1"><span class="code" data-testid="item-code">${esc(d.code)}</span><span class="muted sm grow">${esc(d.project.name)}${d.parent ? ` · thuộc <a href="#/projects/${d.project.id}?item=${d.parent.id}">${esc(d.project.key)}-${d.parent.number}</a>` : ''}</span>
      <details class="ip-menu"><summary class="icon-btn" aria-label="Thao tác khác" title="Thao tác khác">⋯</summary><div class="ip-menu-list" role="menu">
        ${r.canDelete && !d.archivedAt ? `<button class="menu-item danger" role="menuitem" data-act="archive" data-testid="archive-item">${icon('trash')}Xoá (vào thùng rác)</button>` : ''}
        ${fe && project.rights.canManage && !d.recurring ? `<button class="menu-item" role="menuitem" data-act="repeat">${icon('history')}Lặp lại việc này…</button>` : ''}
        <button class="menu-item" role="menuitem" data-act="reset-layout">Về bố cục mặc định</button>
        <button class="menu-item" role="menuitem" data-act="shortcuts">Phím tắt (?)</button></div></details>
      <button class="icon-btn" data-act="close" aria-label="Đóng" title="Đóng (Esc)" data-testid="close-panel">${X}</button></div>
    <div class="ip-body">
      <div class="ip-main">
        ${d.archivedAt ? `<div class="approval-box" data-testid="item-deleted">Việc đang ở trong thùng rác (xoá lúc ${fmtDateTime(d.archivedAt)}), sẽ bị xoá hẳn sau 7 ngày.${r.canDelete ? ' <button class="btn btn-ghost btn-sm" data-act="restore" data-testid="restore-item">Khôi phục</button>' : ''}</div>` : ''}
        <textarea class="ip-title" id="ipTitle" rows="1" ${fe ? '' : 'readonly'} aria-label="Tiêu đề" data-testid="item-title" maxlength="300">${esc(d.title)}</textarea>
        ${summaryBar(d, { review: project.states.find(s => s.category === 'REVIEW'), editable })}
        ${zone ? `<div class="action-zone" data-testid="action-zone" aria-label="Cần bạn xử lý">${zone}</div>` : ''}
        ${descEmpty && fe ? `<div class="section sec-compact desc-add"><button type="button" class="link-btn" data-act="add-desc">+ Thêm mô tả</button><div class="hidden" id="descWrap">${descBody}</div></div>`
          : descEmpty ? '' : sec('desc', { title: 'Mô tả', open: plan.desc, body: descBody })}
        ${disp ? sec('dispatch', { title: 'Điều hành', summary: `${disp.status} ${disp.summary}`, open: plan.dispatch, testid: 'dispatch-section', cls: 'dispatch', body: disp.body }) : ''}
        ${sec('register', { title: 'Giao việc &amp; kết quả', count: reg.filled ? `${reg.filled} mục` : '', summary: reg.summary, open: plan.register, testid: 'register-section', body: reg.body })}
        ${approvalSection(plan.approval)}
        ${prog.empty ? '' : sec('progress', { title: 'Báo cáo tiến độ', count: prog.count || '', summary: prog.summary, open: plan.progress || prog.formOpen, testid: 'progress-section', id: 'progress-section', body: prog.body })}
        ${docs.empty && !editable ? '' : sec('docs', { title: 'Văn bản liên quan', cls: 'lite-hide', count: docs.count || '', summary: docs.summary, open: plan.docs || (!docs.empty && plan.docs !== false), testid: 'documents-section', body: docs.body || '<div class="muted sm">Chưa có văn bản.</div>' })}
        ${d.checklist.length ? sec('check', { title: `Checklist <span class="muted xs">${done}/${d.checklist.length}</span><span class="progress"><i style="width:${done / d.checklist.length * 100}%"></i></span>`, open: plan.check, body: checklistBody })
          : editable ? compact('Checklist', checklistBody) : ''}
        ${childrenSection(d, editable, plan.children)}
        ${d.attachments.length || (d.documents || []).length || editable ? sec('files', { title: 'Tài liệu', count: d.attachments.length + (d.documents || []).length || '', summary: `bên giao ${giveFiles.length + giveDocs.length} · bên thực hiện ${backFiles.length + backDocs.length}`, open: plan.files, testid: 'files-section', body: filesBody }) : ''}
        ${sec('comments', { title: 'Bình luận', count: d.comments.length || '', open: plan.comments || !!d.comments.length, body: commentsBody })}
        ${sec('history', { title: 'Lịch sử', count: d.activities.length, summary: lastAct ? `gần nhất: ${esc(lastAct.actorName)} ${ago(lastAct.createdAt)}` : '', open: plan.history, body: historyBody })}
      </div>
      <div class="ip-side">
        <div class="ip-core">
        <label class="${project.visibility === 'ASSIGNED' ? 'lite-hide' : ''}">Trạng thái<select id="ipState" ${fe ? '' : 'disabled'} data-testid="item-state" title="Trạng thái (S)">${states.map(s => { const locked = s.id !== d.stateId && ((needsApproval && s.category === 'COMPLETED') || (s.category === 'CANCELLED' && (d.dispatchStatus || project.visibility === 'ASSIGNED') && !(r.canManage || d.can?.isAssigner || d.reporterId === store.me.id))); return `<option value="${s.id}"${s.id === d.stateId ? ' selected' : ''}${locked ? ' disabled' : ''}>${stateLabel(s)}${locked ? (s.category === 'CANCELLED' ? ' (người giao)' : ' (qua duyệt)') : ''}</option>`; }).join('')}</select></label>
        <label class="lite-hide">Ưu tiên<select id="ipPriority" ${fe ? '' : 'disabled'} data-testid="item-priority" title="Ưu tiên (P)">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}"${k === d.priority ? ' selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <label class="lite-hide">Tiến độ (%)<span class="row progress-edit"><input type="range" min="0" max="100" step="5" id="ipProgressRange" value="${d.progress}" ${progEdit ? '' : 'disabled'} aria-label="Tiến độ"><input type="number" min="0" max="100" id="ipProgress" value="${d.progress}" ${progEdit ? '' : 'disabled'} data-testid="item-progress" style="width:72px" aria-label="Tiến độ %"></span>${editable && d.can?.progress === false ? '<span class="muted xs">Do người chủ trì cập nhật</span>' : ''}</label>
        <div><label>Người chủ trì</label>${fe ? multiSelect('assignees', users.map(u => ({ id: u.id, label: u.fullName })), d.assignees.map(a => a.id), 'Chưa giao') : `<div>${d.assignees.map(a => avatar(a) + ' ' + personLink(a)).join('<br>') || '—'}</div>`}</div>
        <div class="${(d.supporters || []).length ? '' : 'lite-hide'}"><label>Người phối hợp</label>${fe ? multiSelect('supporters', users.map(u => ({ id: u.id, label: u.fullName })), (d.supporters || []).map(a => a.id), 'Không') : `<div>${(d.supporters || []).map(a => personLink(a)).join(', ') || '—'}</div>`}</div>
        <label>Hạn hoàn thành<input type="date" id="ipDue" value="${dateInput(d.dueDate)}" ${fe && dueEditable(d) ? '' : 'disabled'} data-testid="item-due" title="Hạn (D)">${d.dueDate ? `<span class="muted xs">${countdownPill(d)}</span>` : ''}${fe && !dueEditable(d) ? '<span class="muted xs">Hạn do người giao đặt — dùng "Xin gia hạn"</span>' : ''}</label>
        ${d.state.category === 'COMPLETED' ? `<label>Ngày hoàn thành thực tế<input type="date" id="ipCompleted" value="${dateInput(d.completedAt)}" ${r.canManage ? '' : 'disabled'} data-testid="item-completed"></label>` : ''}
        <label class="lite-hide">Người giao${fe && d.can?.assigner !== false ? `<select id="ipAssigner" data-testid="item-assigner"><option value="">—</option>${store.users.filter(u => u.role !== 'admin').map(u => `<option value="${u.id}"${u.id === d.assignedById ? ' selected' : ''}>${esc(u.fullName)}</option>`).join('')}</select>` : `<div class="side-text" data-testid="item-assigner">${d.assignedById ? personLink({ id: d.assignedById, fullName: d.assignedByName }) : '—'}</div>`}</label>
        ${showLabels ? `<div class="lite-hide"><label>Nhãn</label>${fe ? multiSelect('labels', labelsFor(d.project.id).map(l => ({ id: l.id, label: l.name, chip: labelChip(l) })), d.labels.map(l => l.id), 'Không có', { create: true }) : d.labels.map(labelChip).join(' ') || '—'}</div>` : ''}
        ${d.intake ? `<div class="pill" data-testid="item-intake" style="white-space:normal">Từ yêu cầu của ${esc(d.intake.requesterName || '')}</div>` : ''}
        </div>
        <details class="ip-more" data-sec="more"${plan.more || false ? ' open' : ''}><summary>Thêm thông tin${moreFilled ? ` <span class="muted xs">${moreFilled} mục đã có</span>` : ''}</summary>
        <div class="ip-more-body">
        <label>Đơn vị / người phối hợp khác<input id="ipCoord" value="${esc(d.coordinatorText || '')}" ${fe ? '' : 'disabled'} placeholder="VD: Văn phòng; đơn vị thi công" data-testid="item-coordinator"></label>
        <label>Nguồn giao việc<select id="ipSource" ${fe ? '' : 'disabled'} data-testid="item-source"><option value="">—</option>${[...new Set([...(store.settings?.sources || []), ...(d.source ? [d.source] : [])])].map(x => `<option${x === d.source ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        <label>Ngày giao<input type="date" id="ipAssignedAt" value="${dateInput(d.assignedAt)}" ${fe ? '' : 'disabled'}></label>
        <label>Ngày bắt đầu<input type="date" id="ipStart" value="${dateInput(d.startDate)}" ${fe ? '' : 'disabled'}></label>
        <label>Ước lượng (giờ)<input type="number" min="0" step="0.5" id="ipEstimate" value="${d.estimate ?? ''}" ${fe ? '' : 'disabled'}></label>
        ${(project.cycles || []).length || d.cycleId ? `<label>Chu kỳ<select id="ipCycle" ${fe ? '' : 'disabled'} data-testid="item-cycle"><option value="">— Không —</option>${(project.cycles || []).map(c => `<option value="${c.id}"${c.id === d.cycleId ? ' selected' : ''}>${esc(c.name)}${c.status === 'COMPLETED' ? ' (đã kết thúc)' : ''}</option>`).join('')}${editable ? '<option value="__new">+ Tạo chu kỳ mới…</option>' : ''}</select></label>` : ''}
        ${repeatBlock(fe)}
        <div class="muted xs">Người tạo: ${esc(d.reporterName || '—')}<br>Tạo lúc: ${fmtDateTime(d.createdAt)}${d.startedAt ? '<br>Bắt đầu: ' + fmtDateTime(d.startedAt) : ''}${d.completedAt ? '<br>Hoàn thành: ' + fmtDateTime(d.completedAt) : ''}</div>
        </div></details>
        ${[d.source && `Nguồn: ${esc(d.source)}`, d.assignedAt && `Ngày giao ${fmtDate(d.assignedAt)}`, d.coordinatorText && `Phối hợp khác: ${esc(d.coordinatorText)}`, d.recurring && `Lặp lại: ${esc(d.recurring.schedule)}`].filter(Boolean).map(x => `<div class="muted xs side-fact">${x}</div>`).join('')}
      </div>
    </div>`;
  // Gọn (mặc định): chỉ hiện việc cần làm ngay — vùng cần xử lý, mô tả, báo cáo tiến độ, bình luận, các mục đã có nội dung;
  // người chủ trì, hạn, tiến độ ở cột phải. "Xem đầy đủ" mở mọi mục (nhớ theo người).
  const fullView = !lite;
  p.classList.toggle('ip-lite', lite);
  $('.ip-main', p).insertAdjacentHTML('beforeend', `<button type="button" class="link-btn ip-mode" data-act="toggle-full" data-testid="panel-full-toggle">${fullView ? 'Thu gọn — chỉ hiện phần cần làm' : 'Xem đầy đủ: điều hành, giao việc &amp; kết quả, quy trình duyệt, tiến độ, checklist, việc nhánh, văn bản, lịch sử…'}</button>`);
  if (keep) {
    for (const x of $$('details[data-sec], details[data-sub]', p)) { const k = x.dataset.sec || 'sub:' + x.dataset.sub; if (keep.open.has(k)) x.open = keep.open.get(k); }
    const body = $('.ip-body', p); if (body) body.scrollTop = keep.top;
    if (keep.focus) document.getElementById(keep.focus)?.focus({ preventScroll: true });
  }
  restoreDrafts(p);
  const t = $('#ipTitle', p); if (t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
  bind(editable);
}

// Sau khi duyệt từ "Chờ tôi xử lý": mời mở phiếu tiếp theo.
async function offerNextApproval(doneId) {
  if (!location.hash.startsWith('#/approvals')) return;
  try {
    const q = (await api('/api/approvals/queue')).filter(x => x.item.id !== doneId);
    if (!q.length) return;
    // Theo đúng thứ tự người dùng đang xem (sắp xếp / lọc của trang): lấy dòng ngay sau phiếu vừa duyệt.
    const rows = [...document.querySelectorAll('#view [data-testid^="queue-"][data-href]')].filter(r => !r.dataset.testid.startsWith('queue-round-'));
    const ids = new Set(q.map(x => x.item.id)), idOf = r => Number(new URLSearchParams(r.dataset.href.split('?')[1] || '').get('item'));
    const at = rows.findIndex(r => idOf(r) === doneId);
    const next = [...rows.slice(at + 1), ...rows.slice(0, Math.max(at, 0))].find(r => ids.has(idOf(r)));
    const go = next ? next.dataset.href : `#/approvals?${new URLSearchParams({ tab: 'queue', item: q[0].item.id, focus: 'approval' })}`;
    toast(`Còn ${q.length} phiếu chờ bạn`, 'ok', { action: { label: 'Mở phiếu tiếp theo', run: () => { location.hash = go; } } });
  } catch { /* bỏ qua */ }
}
const saveDraft = (key, value) => draftLater(key, value, 300);

function bind(editable) {
  const p = panel();
  bindSectionMemory(p);
  p.oninput = e => {
    if (e.target.matches?.(DRAFT_SEL) && data) saveDraft(draftKey(e.target), e.target.value);
    if (e.target.id === 'ipTitle') { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }
    if (e.target.id === 'approvalComment' && e.target.value.trim()) $('#approvalCommentHelp', p).textContent = '';
  };
  p.onclick = async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') return closeItem(true);
    if (act === 'reload-panel') return load();
    if (act === 'toggle-full') { uiPref('ip:full', uiPref('ip:full') === true ? null : true); lastRendered = null; render(); return; }
    if (act === 'reset-layout') { resetSectionMemory(SEC_KEYS); lastRendered = null; render(); toast('Đã về bố cục mặc định', 'ok'); return; }
    if (act === 'shortcuts') { e.target.closest('details')?.removeAttribute('open'); return showShortcuts(); }
    if (act === 'add-desc') { const w = $('#descWrap', p); w?.classList.remove('hidden'); e.target.closest('[data-act]').remove(); $('#ipDesc', p)?.focus(); return; }
    const reveal = e.target.closest('[data-reveal]');
    if (reveal) { const f = p.querySelector(`[data-reg="${reveal.dataset.reveal}"]`); if (f) { f.hidden = false; f.querySelector('textarea')?.focus(); } reveal.remove(); return; }
    if (await handleDispatchClick(e, p, data, refresh, patch)) return;
    if (act === 'repeat') { e.target.closest('details')?.removeAttribute('open'); return openRepeatDialog({ item: data, rule: data.recurring, onDone: refresh }); }
    if (act === 'archive') {
      // Xoá vào thùng rác khôi phục được: không hỏi, cho hoàn tác ngay.
      const d = data;
      try {
        await api(`/api/items/${d.id}`, { method: 'DELETE' }); closeItem(true); reloadProject(); refreshBackground();
        toast(`Đã chuyển ${d.code}${d.children.length ? ` cùng ${d.children.length} việc con` : ''} vào thùng rác`, 'ok', { action: { label: 'Hoàn tác', run: async () => { await api(`/api/items/${d.id}/restore`, { method: 'POST' }); reloadProject(); refreshBackground(); toast(`Đã khôi phục ${d.code}`, 'ok'); } } });
      } catch (err) { toast(errorMessage(err), 'err'); }
      return;
    }
    if (act === 'restore') { try { await api(`/api/items/${data.id}/restore`, { method: 'POST' }); toast('Đã khôi phục', 'ok'); } catch (err) { toast(errorMessage(err), 'err'); } return refresh(); }
    if (act === 'submit-approval') { const review = project.states.find(s => s.category === 'REVIEW'); if (await patch({ stateId: review.id })) toast('Đã gửi duyệt', 'ok'); return; }
    if (act === 'approve' || act === 'reject') {
      const pending = data.approvals.find(a => a.status === 'PENDING');
      const comment = $('#approvalComment', p).value.trim();
      if (act === 'reject' && !comment) { $('#approvalCommentHelp', p).textContent = 'Nhập lý do trả lại để người trình sửa theo.'; toast('Hãy nhập lý do trả lại', 'err'); $('#approvalComment', p).focus(); return; }
      const rating = act === 'approve' ? $('#approvalRating', p)?.value || undefined : undefined;
      const doneId = data.id;
      try { await api(`/api/approvals/${pending.id}/${act}`, { method: 'POST', body: { comment, rating } }); draft(`${doneId}:approvalComment`, ''); toast(act === 'approve' ? 'Đã duyệt' : 'Đã trả lại', 'ok'); offerNextApproval(doneId); }
      catch (error) { toast(errorMessage(error), 'err'); }
      return refresh();
    }
    if (act === 'comment') {
      const text = $('#newComment', p).value.trim(); if (!text) return;
      try { await api(`/api/items/${data.id}/comments`, { method: 'POST', body: { body: text } }); draft(`${data.id}:newComment`, ''); $('#newComment', p).value = ''; await refresh(); } catch (error) { toast(errorMessage(error), 'err'); }
      return;
    }
    const cmd = e.target.closest('[data-cmd]')?.dataset.cmd;
    if (cmd) { e.preventDefault(); document.execCommand(cmd); $('#ipDesc', p).focus(); $('#saveDesc', p)?.classList.remove('hidden'); return; }
    const dl = e.target.closest('[data-download]'); if (dl) return download(`/api/attachments/${dl.dataset.download}/download`).catch(err => toast(errorMessage(err), 'err'));
    const pv = e.target.closest('[data-preview]'); if (pv) return openPreview(`/api/attachments/${pv.dataset.preview}/preview`).catch(err => toast(errorMessage(err), 'err'));
    const da = e.target.closest('[data-del-att]');
    if (da && await confirmDialog('Xoá tệp đính kèm này? Tệp bị xoá hẳn, không khôi phục được.', { danger: true, okText: 'Xoá tệp' })) { await api(`/api/attachments/${da.dataset.delAtt}`, { method: 'DELETE' }).catch(err => toast(errorMessage(err), 'err')); return refresh(); }
    const dc = e.target.closest('[data-del-check]');
    if (dc) {
      const c = data.checklist.find(x => String(x.id) === dc.dataset.delCheck), itemId = data.id;
      try {
        await api(`/api/checklist/${dc.dataset.delCheck}`, { method: 'DELETE' }); await refresh();
        if (c) toast(`Đã xoá "${c.title}"`, 'ok', { action: { label: 'Hoàn tác', run: async () => { const n = await api(`/api/items/${itemId}/checklist`, { method: 'POST', body: { title: c.title } }); if (c.done && n?.id) await api(`/api/checklist/${n.id}`, { method: 'PATCH', body: { done: true } }); refresh(); } } });
      } catch (err) { toast(errorMessage(err), 'err'); }
      return;
    }
    if (e.target.id === 'saveDesc') { await patch({ descriptionHtml: $('#ipDesc', p).innerHTML }); toast('Đã lưu mô tả', 'ok'); }
  };
  if (!editable) return;
  const title = $('#ipTitle', p);
  title.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } };
  title.onchange = () => { const v = title.value.replace(/\s*\n\s*/g, ' ').trim(); if (v && v !== data.title) patch({ title: v }); };
  const desc = $('#ipDesc', p);
  if (desc) {
    desc.oninput = () => $('#saveDesc', p)?.classList.remove('hidden');
    // Ctrl/⌘ S trong mô tả: lưu (không mở hộp "Lưu trang" của trình duyệt).
    desc.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('#saveDesc', p)?.click(); } };
  }
  const on = (sel, fn) => { const el = $(sel, p); if (el) el.onchange = fn; };
  on('#ipState', e => patch({ stateId: Number(e.target.value) }));
  on('#ipPriority', e => patch({ priority: e.target.value }));
  on('#ipStart', e => patch({ startDate: fromDateInput(e.target.value) }));
  on('#ipDue', e => patch({ dueDate: fromDateInput(e.target.value) }));
  on('#ipEstimate', e => patch({ estimate: e.target.value === '' ? null : Number(e.target.value) }));
  on('#ipCycle', e => {
    const v = e.target.value; e.target.blur();
    if (v === '__new') {
      e.target.value = data.cycleId ?? '';
      return openCycleForm({ project, cycles: project.cycles }, async created => {
        project.cycles = await api(`/api/projects/${project.id}/cycles`);
        if (created?.id) await patch({ cycleId: created.id }); else await load();
      });
    }
    patch({ cycleId: v ? Number(v) : null });
  });
  $('#ipLevels', p)?.addEventListener('change', e => patch({ approvalLevels: e.target.value === '' ? null : Number(e.target.value) }));
  const prog = v => patch({ progress: Math.max(0, Math.min(100, Number(v) || 0)) });
  $('#ipProgress', p)?.addEventListener('change', e => prog(e.target.value));
  $('#ipProgressRange', p)?.addEventListener('input', e => { $('#ipProgress', p).value = e.target.value; });
  $('#ipProgressRange', p)?.addEventListener('change', e => prog(e.target.value));
  $('#ipCoord', p)?.addEventListener('change', e => patch({ coordinatorText: e.target.value }));
  $('#ipAssigner', p)?.addEventListener('change', e => patch({ assignedById: e.target.value ? Number(e.target.value) : null }));
  $('#ipSource', p)?.addEventListener('change', e => patch({ source: e.target.value || null }));
  $('#ipAssignedAt', p)?.addEventListener('change', e => patch({ assignedAt: fromDateInput(e.target.value) }));
  $('#ipCompleted', p)?.addEventListener('change', e => patch({ completedAt: fromDateInput(e.target.value) }));
  for (const ta of $$('textarea[data-field]', p)) ta.addEventListener('change', e => patch({ [e.target.dataset.field]: e.target.value }));
  bindDispatchInputs(p, patch);
  bindMulti(p, (name, ids) => patch(name === 'assignees' ? { assigneeIds: ids } : name === 'supporters' ? { supporterIds: ids } : name === 'supportDepts' ? { supportDepartmentIds: ids } : { labelIds: ids }), {
    creators: { labels: async name => { const l = await createProjectLabel(data.project.id, name); return { id: l.id, label: l.name, chip: labelChip(l) }; } },
  });
  p.onchange = async e => {
    if (e.target.dataset.check) {
      await api(`/api/checklist/${e.target.dataset.check}`, { method: 'PATCH', body: { done: e.target.checked } }).catch(err => toast(errorMessage(err), 'err'));
      return refresh();
    }
    if (e.target.id === 'attInput' && e.target.files.length) {
      const form = new FormData();
      for (const f of e.target.files) form.append('files', f);
      try { await api(`/api/items/${data.id}/attachments`, { method: 'POST', form }); toast('Đã tải tệp lên', 'ok'); }
      catch (error) { toast(errorMessage(error), 'err'); e.target.value = ''; return; }
      return refresh();
    }
  };
  for (const [sel, handler] of [
    ['#newCheck', v => api(`/api/items/${data.id}/checklist`, { method: 'POST', body: { title: v } })],
    ['#newChild', v => api(`/api/projects/${data.project.id}/items`, { method: 'POST', body: { title: v, parentId: data.id } })],
  ]) {
    const input = $(sel, p); if (!input) continue;
    input.onkeydown = async e => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      input.disabled = true;
      try { await handler(input.value.trim()); await refresh(); $(sel, panel())?.focus(); } catch (error) { toast(errorMessage(error), 'err'); input.disabled = false; }
    };
  }
}
