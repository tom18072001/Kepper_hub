// GĐ3a — các khối điều hành trong panel việc: giao về phòng (tiếp nhận, phân công), báo cáo tiến độ + kiến nghị,
// đề nghị gia hạn, văn bản liên quan, nộp sản phẩm (phiếu trình), xếp loại khi nghiệm thu.
import { api } from '../api.js';
import { store, personLink } from '../store.js';
import { $, esc, fmtDate, fmtDateTime, ago, toast, errorMessage, openModal, closeModal, multiSelect, readMulti, bindMulti, dateInput, fromDateInput, dueCountdown, draft } from '../util.js';
import { icon } from '../icons.js';

export const TASK_TYPES = { PLAN: 'Kế hoạch năm', ADHOC: 'Đột xuất (theo chỉ đạo)' };
export const RATINGS = { EXCELLENT: 'Hoàn thành xuất sắc', GOOD: 'Hoàn thành tốt', PASS: 'Hoàn thành', FAIL: 'Không hoàn thành' };
const DOC_KINDS = { BASIS: 'Căn cứ giao việc', OUTPUT: 'Sản phẩm tham mưu', ISSUED: 'Văn bản đã phát hành' };
const deptList = () => store.departments.filter(d => d.isActive !== false);
const userOpts = (prefer) => {
  const list = store.users.filter(u => u.role !== 'admin');
  const rank = u => (u.departmentId === prefer ? 0 : 1);
  return list.sort((a, b) => rank(a) - rank(b) || a.fullName.localeCompare(b.fullName, 'vi')).map(u => ({ id: u.id, label: u.fullName + (u.departmentId === prefer ? '' : ` — ${store.departments.find(d => d.id === u.departmentId)?.name || ''}`) }));
};

const ROLE_TEXT = { LEAD: 'Bạn chủ trì', SUPPORT: 'Bạn phối hợp', LEADER: 'Lãnh đạo phòng chủ trì', ASSIGNER: 'Bạn là người giao' };
const STAGE_TONE = { PENDING_ACCEPT: 'warn', RETURNED: 'danger', WAIT_DEPT: 'info', WAIT_BGD: 'info', WAIT_APPROVAL: 'info', DONE: 'ok' };
const dayDiff = (a, b) => Math.round((new Date(a) - new Date(b)) / 86_400_000);
export const stagePill = (st, testid) => (st ? `<span class="pill stage ${STAGE_TONE[st.code] || ''}"${testid ? ` data-testid="${testid}"` : ''}>${esc(st.label)}</span>` : '');
const isOpen = d => !['COMPLETED', 'CANCELLED'].includes(d.state.category) && !d.archivedAt;
// Kiến nghị chờ tôi: lãnh đạo phòng — chưa trình BGĐ; người giao / BGĐ — mọi kiến nghị (kể cả phòng đã trình).
const unanswered = d => (d.progressReports || []).filter(r => r.proposals && !r.answer && r.authorId !== store.me.id && (!r.forwardedAt || d.can?.bgd));
const pendingExt = d => (d.extensions || []).find(x => x.status === 'PENDING');
export const canDecideExtNow = d => { const x = pendingExt(d); return !!x && !!d.can?.decideExtension && x.requestedById !== store.me.id; };
export const countdownPill = (d, testid = '') => { const c = dueCountdown(d, store.settings?.dueSoonDays ?? 3); return `<span class="pill${c.tone ? ' ' + c.tone : ''}"${testid ? ` data-testid="${testid}"` : ''}>${esc(c.text)}</span>`; };

// Thanh tóm tắt đầu panel: khâu, vai trò của tôi, hạn đếm ngược (và hạn nộp phòng), MỘT hành động chính + tối đa 2 phụ.
// Duyệt / gia hạn / kiến nghị không có nút ở đây — ô xử lý nằm ngay bên dưới (vùng "Cần bạn xử lý").
export function summaryBar(d, { review, editable }) {
  const can = d.can || {};
  const pending = d.approvals.find(a => a.status === 'PENDING');
  const cand = []; // [mức ưu tiên, html không lớp màu]
  const btn = (attrs, iconName, label, title) => ({ attrs, iconName, label, title });
  if (editable && can.accept) cand.push(btn('data-act="accept" data-testid="bar-accept"', 'users', 'Tiếp nhận &amp; phân công', 'Tiếp nhận & phân công (A)'));
  if (isOpen(d) && editable && !pending && d.dispatchStatus !== 'PENDING' && can.work && review && d.dispatchStatus && (d.approvalSteps || []).length)
    cand.push(btn('data-act="submit-product" data-testid="bar-submit"', 'send', d.submitRounds ? `Nộp lại (lần ${d.submitRounds + 1})` : 'Nộp sản phẩm', 'Nộp sản phẩm (phiếu trình)'));
  if (isOpen(d) && editable && !pending && d.dispatchStatus !== 'PENDING' && (can.work || can.support))
    cand.push(btn('data-act="open-report" data-testid="bar-report"', 'send', can.work ? 'Báo cáo tiến độ' : 'Báo cáo phần phối hợp', 'Báo cáo tiến độ (R)'));
  if (editable && can.supportLead && isOpen(d)) cand.push(btn('data-act="support-staff" data-testid="bar-support-staff"', 'users', 'Cử cán bộ phối hợp', ''));
  const acts = cand.slice(0, 3).map((b, i) => `<button class="btn ${i === 0 ? 'btn-primary' : 'btn-ghost'} btn-sm" ${b.attrs}${b.title ? ` title="${esc(b.title)}"` : ''}>${icon(b.iconName)}${b.label}</button>`);
  const internal = d.internalDueDate ? `<span class="muted sm">nộp phòng <b>${fmtDate(d.internalDueDate)}</b></span>` : '';
  return `<div class="ip-summary" data-testid="item-summary">
      <div class="row wrap">${stagePill(d.stage, 'item-stage')}${can.myRole ? `<span class="pill role" data-testid="my-role">${ROLE_TEXT[can.myRole]}</span>` : ''}
        ${countdownPill(d, 'item-countdown')}<span class="muted sm">${d.dueDate ? `hạn ${fmtDate(d.dueDate)}` : ''}</span>${internal}
        ${d.assignedByName ? `<span class="muted sm">giao bởi ${personLink({ id: d.assignedById, fullName: d.assignedByName })}</span>` : ''}</div>
      ${acts.length ? `<div class="row wrap ip-actions">${acts.join('')}</div>` : ''}
    </div>`;
}

// Vùng "Cần bạn xử lý" (không bao giờ thu gọn): bị trả lại, quyết định gia hạn, kiến nghị chờ trả lời. Khối duyệt do item-panel thêm vào.
export function actionZone(d) {
  const out = [];
  if (d.stage?.code === 'RETURNED') out.push(`<div class="returned-banner" role="status" data-testid="returned-banner" id="returned-zone"><b>Bị trả lại${d.returnedAt ? ` ${ago(d.returnedAt)}` : ''}</b>${d.returnNote ? `: ${esc(d.returnNote)}` : ''}
      <div class="muted xs">Chỉnh sửa theo ý kiến, cập nhật tệp / văn bản rồi nộp lại${d.submitRounds ? ` (lần trình ${d.submitRounds + 1})` : ''}.</div></div>`);
  const ext = pendingExt(d);
  if (ext && canDecideExtNow(d)) out.push(`<div class="approval-box zone-box" data-testid="extension-pending" id="extension-zone"><b>Đề nghị gia hạn đến ${fmtDate(ext.newDue)}</b>${ext.oldDue ? ` <span class="pill warn">+${dayDiff(ext.newDue, ext.oldDue)} ngày so với hạn ${fmtDate(ext.oldDue)}</span>` : ''} <span class="muted xs">— ${esc(ext.requestedByName || '')}, ${ago(ext.createdAt)}</span>
      <div class="comment" style="margin-top:4px">${esc(ext.reason)}</div>
      <input id="extNote" placeholder="Ý kiến (bắt buộc khi không duyệt)" style="margin-top:8px" data-testid="extension-note" aria-label="Ý kiến về đề nghị gia hạn">
      <div class="row" style="margin-top:8px"><button class="btn btn-ok btn-sm" data-ext="${ext.id}" data-decision="APPROVE" data-testid="extension-approve">Duyệt</button><button class="btn btn-danger btn-sm" data-ext="${ext.id}" data-decision="REJECT" data-testid="extension-reject">Không duyệt</button></div></div>`);
  const props = d.can?.answer ? unanswered(d) : [];
  if (props.length) out.push(`<div class="approval-box zone-box" id="proposal-zone"><b>Kiến nghị chờ bạn cho ý kiến (${props.length})</b>
      ${d.can?.forward ? '<div class="muted xs">Trong thẩm quyền phòng: Duyệt / Không duyệt. Cần Ban Giám đốc quyết: Trình BGĐ (kèm ý kiến của phòng).</div>' : ''}
      ${props.map(r => `<div class="report" style="margin-top:8px"><div class="who"><b>${esc(r.authorName || '')}</b> · ${r.progress}% · <span title="${fmtDateTime(r.createdAt)}">${ago(r.createdAt)}</span></div>
        <div class="proposal"><b>Kiến nghị:</b> ${esc(r.proposals)}${r.difficulties ? `<div class="muted sm"><b>Khó khăn:</b> ${esc(r.difficulties)}</div>` : ''}
          ${r.forwardedAt ? `<div class="muted sm" data-testid="proposal-forwarded"><b>Phòng trình BGĐ</b> (${esc(r.forwardedByName || '')}, ${ago(r.forwardedAt)})${r.forwardNote ? `: ${esc(r.forwardNote)}` : ''}</div>` : ''}</div>
        <input data-answer-input="${r.id}" placeholder="Ý kiến (bắt buộc khi không duyệt)" style="margin-top:6px" data-testid="answer-input" aria-label="Ý kiến về kiến nghị">
        <div class="row" style="margin-top:6px"><button class="btn btn-ok btn-sm" data-answer="${r.id}" data-verdict="OK" data-testid="answer-submit">Duyệt</button><button class="btn btn-danger btn-sm" data-answer="${r.id}" data-verdict="NO" data-testid="answer-reject">Không duyệt</button>${d.can?.forward && !r.forwardedAt ? `<button class="btn btn-ghost btn-sm" data-forward="${r.id}" data-testid="proposal-forward" title="Trình kiến nghị lên Ban Giám đốc kèm ý kiến của phòng">${icon('send')}Trình BGĐ</button>` : ''}</div></div>`).join('')}</div>`);
  return out.join('');
}

// Khối "Điều hành": loại nhiệm vụ, đơn vị chủ trì / phối hợp, hạn nộp phòng, hạn gốc, gia hạn. Trả { status, summary, body } để item-panel bọc vào khối thu gọn.
export function dispatchParts(d, editable, assigned = true) {
  const can = d.can || {};
  const ownerEdit = editable && (d.rights.canManage || can.isAssigner);
  const status = d.dispatchStatus === 'PENDING'
    ? `<span class="pill warn" data-testid="dispatch-status">Chờ phòng tiếp nhận${d.dispatchedAt ? ` · ${ago(d.dispatchedAt)}` : ''}</span>`
    : d.dispatchStatus === 'ACCEPTED' ? `<span class="pill ok" data-testid="dispatch-status">Phòng đã phân công${d.acceptedByName ? ` · ${esc(d.acceptedByName)}` : ''}</span>` : '';
  const ext = pendingExt(d);
  const lastExt = (d.extensions || []).find(x => x.status !== 'PENDING');
  const due = d.originalDueDate && d.dueDate && fmtDate(d.originalDueDate) !== fmtDate(d.dueDate) ? `<div class="muted xs" data-testid="original-due">Hạn gốc ${fmtDate(d.originalDueDate)} · đã gia hạn đến <b>${fmtDate(d.dueDate)}</b></div>` : '';
  const canInternal = editable && (can.isLeadLeader || can.isAssigner || d.rights.canManage) && !!d.leadDepartmentId;
  const internal = d.leadDepartmentId ? `<label title="Phòng đặt cho cán bộ, không muộn hơn hạn của người giao">Hạn nộp phòng (nội bộ)${canInternal
    ? `<input type="date" id="ipInternalDue" value="${dateInput(d.internalDueDate)}"${d.dueDate ? ` max="${dateInput(d.dueDate)}"` : ''} data-testid="item-internal-due">`
    : `<div><b>${d.internalDueDate ? fmtDate(d.internalDueDate) : '—'}</b></div>`}</label>` : '';
  const body = `<div class="dispatch-grid">
      <label>Loại nhiệm vụ${ownerEdit ? `<select id="ipTaskType" data-testid="item-task-type">${Object.entries(TASK_TYPES).map(([k, v]) => `<option value="${k}"${d.taskType === k ? ' selected' : ''}>${v}</option>`).join('')}</select>` : `<div><b>${esc(TASK_TYPES[d.taskType] || '—')}</b></div>`}</label>
      ${assigned ? `<label>Đơn vị chủ trì${ownerEdit && !d.parent ? `<select id="ipLeadDept" data-testid="item-lead-dept"><option value="">— Không giao về phòng —</option>${deptList().map(x => `<option value="${x.id}"${d.leadDepartmentId === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : `<div><b>${esc(d.leadDepartment?.name || '—')}</b></div>`}</label>
      <div><label>Đơn vị phối hợp</label>${ownerEdit && !d.parent ? multiSelect('supportDepts', deptList().filter(x => x.id !== d.leadDepartmentId).map(x => ({ id: x.id, label: x.name })), d.supportDepartmentIds || [], 'Không') : `<div>${(d.supportDepartments || []).map(x => esc(x.name)).join(', ') || '—'}</div>`}</div>` : ''}
      ${internal}
    </div>
    ${due}
    <div class="row wrap" style="margin-top:8px">
      ${(can.accept || can.reassign) && editable ? `<button class="btn btn-ghost btn-sm" data-act="accept" data-testid="accept-dispatch">${icon('users')}${can.accept ? 'Tiếp nhận &amp; phân công' : 'Phân công lại'}</button>` : ''}
      ${isOpen(d) && editable && !ext && can.work && d.dispatchStatus !== 'PENDING' ? `<button class="btn btn-ghost btn-sm" data-act="extension" data-testid="request-extension" title="Xin gia hạn (E)">${icon('clock')}Xin gia hạn</button>` : ''}
      ${isOpen(d) && editable && can.supportLead ? `<button class="btn btn-ghost btn-sm" data-act="support-staff" data-testid="support-staff">${icon('users')}Cử cán bộ phối hợp</button>` : ''}
    </div>
    ${ext && !canDecideExtNow(d) ? `<div class="muted sm" data-testid="extension-pending" style="margin-top:8px">Đề nghị gia hạn đến <b>${fmtDate(ext.newDue)}</b>${ext.oldDue ? ` (+${dayDiff(ext.newDue, ext.oldDue)} ngày)` : ''} — ${esc(ext.requestedByName || '')}, ${ago(ext.createdAt)} · chờ người giao quyết định.</div>`
      : !ext && lastExt ? `<div class="muted xs" style="margin-top:6px">Gia hạn gần nhất: ${lastExt.status === 'APPROVED' ? 'được đồng ý' : 'không được đồng ý'} (${fmtDate(lastExt.newDue)}) · ${esc(lastExt.decidedByName || '')}${lastExt.decisionNote ? ' — ' + esc(lastExt.decisionNote) : ''}</div>` : ''}
    ${d.rating ? `<div class="rating-box" data-testid="item-rating">Xếp loại: <b>${esc(d.ratingLabel || RATINGS[d.rating])}</b>${d.ratedByName ? ` · ${esc(d.ratedByName)}, ${fmtDate(d.ratedAt)}` : ''}</div>` : ''}`;
  const summary = [TASK_TYPES[d.taskType]?.split(' (')[0], d.leadDepartment?.name, d.internalDueDate ? `nộp phòng ${fmtDate(d.internalDueDate)}` : null, d.rating ? RATINGS[d.rating] : null].filter(Boolean).map(esc).join(' · ');
  return { status, summary, body };
}

// Báo cáo tiến độ: biểu mẫu + 2 báo cáo mới nhất, các báo cáo cũ hơn thu gọn. Kiến nghị chờ trả lời nằm ở vùng "Cần bạn xử lý".
export function progressParts(d, editable) {
  const reports = d.progressReports || [];
  const sup = !!d.can?.support;
  const mineLead = d.assignees.some(x => x.id === store.me.id);
  const last = reports[0];
  const stale = !last || Date.now() - new Date(last.createdAt) > 7 * 86_400_000;
  const formOpen = d.dispatchStatus === 'ACCEPTED' && mineLead && (!reports.length || stale) && !['WAIT_DEPT', 'WAIT_BGD', 'WAIT_APPROVAL'].includes(d.stage?.code);
  const row = r => `<div class="report" data-testid="progress-report">
      <div class="who"><b>${esc(r.authorName || '')}</b>${r.asSupporter ? ' <span class="pill">phối hợp</span>' : ''} · ${r.progress}% · <span title="${fmtDateTime(r.createdAt)}">${ago(r.createdAt)}</span></div>
      <div>${esc(r.content).replace(/\n/g, '<br>')}</div>
      ${r.difficulties ? `<div class="muted sm"><b>Khó khăn:</b> ${esc(r.difficulties)}</div>` : ''}
      ${r.proposals ? `<div class="proposal"><b>Kiến nghị:</b> ${esc(r.proposals)}${r.forwardedAt ? `<div class="muted xs">Phòng đã trình BGĐ${r.forwardNote ? `: ${esc(r.forwardNote)}` : ''}</div>` : ''}${r.answer ? `<div class="answer"><b>${esc(r.answeredByName || '')}:</b> ${esc(r.answer)}</div>` : `<div class="muted xs">${r.forwardedAt ? 'Chờ BGĐ cho ý kiến' : 'Chờ lãnh đạo cho ý kiến'}</div>`}</div>` : ''}
    </div>`;
  const form = isOpen(d) && editable && (d.can?.work || sup || !d.dispatchStatus) && d.dispatchStatus !== 'PENDING' ? `<details class="report-form" id="reportForm" data-sub="reportForm"${formOpen ? ' open' : ''}><summary class="btn btn-ghost btn-sm" data-testid="report-open" title="Báo cáo tiến độ (R)">${icon('send')}${sup ? 'Báo cáo phần phối hợp' : 'Báo cáo tiến độ'}</summary>
      ${sup ? '<p class="muted xs">Báo cáo phần việc phối hợp của bạn; tiến độ chung của việc do người chủ trì cập nhật.</p>' : ''}
      <div class="report-grid">
        <label>${sup ? 'Phần phối hợp đã xong (%)' : 'Tiến độ (%)'}<input type="number" min="0" max="100" step="5" id="rpProgress" value="${sup ? 0 : d.progress}" data-testid="report-progress"></label>
        <label class="wide">Đã làm được<textarea id="rpContent" rows="2" data-testid="report-content" placeholder="Nội dung đã thực hiện trong kỳ"></textarea></label>
        <label class="wide">Khó khăn, vướng mắc<textarea id="rpDiff" rows="2" data-testid="report-difficulties"></textarea></label>
        <label class="wide">Kiến nghị, đề xuất <span class="muted xs">${d.can?.isLeadLeader || !d.dispatchStatus ? '(gửi thẳng người giao / BGĐ cho ý kiến)' : '(lãnh đạo phòng cho ý kiến; vượt thẩm quyền thì phòng trình BGĐ)'}</span><textarea id="rpProp" rows="2" data-testid="report-proposals"></textarea></label>
      </div>
      <p class="muted xs" data-testid="report-to">Gửi tới: ${[d.assignedByName && `${esc(d.assignedByName)} (người giao)`, d.dispatchStatus && !d.can?.isLeadLeader && 'lãnh đạo phòng chủ trì'].filter(Boolean).join(', ') || 'người theo dõi việc'}.</p>
      <button class="btn btn-primary btn-sm" data-act="report" data-testid="report-submit" title="Gửi (Ctrl Enter)">Gửi báo cáo</button></details>` : '';
  const list = reports.length ? `<div class="timeline-list" style="margin-top:8px">${reports.slice(0, 2).map(row).join('')}
      ${reports.length > 2 ? `<details class="older" data-sub="olderReports"><summary class="link-btn">Xem ${reports.length - 2} báo cáo trước</summary>${reports.slice(2).map(row).join('')}</details>` : ''}</div>` : '';
  const summary = last ? `${last.progress}% · ${esc(last.authorName || '')} ${ago(last.createdAt)}` : 'chưa có báo cáo';
  return { count: reports.length, summary, body: form + list, empty: !reports.length && !form, formOpen };
}

// Văn bản liên quan: số hiệu từ hệ thống văn bản điện tử (không tích hợp tự động). Không nhập văn bản mật.
export function documentsParts(d, editable) {
  const rows = (d.documents || []).map(x => `<div class="doc-row" data-testid="document-row"><span class="pill">${esc(DOC_KINDS[x.kind] || x.kind)}</span>
      <b>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.number)}</a>` : esc(x.number)}</b>${x.issuedOn ? ` <span class="muted xs">ngày ${fmtDate(x.issuedOn)}</span>` : ''}
      <span class="grow">${esc(x.summary)}${x.issuer ? ` <span class="muted xs">· ${esc(x.issuer)}</span>` : ''}</span>
      ${editable && (x.createdById === store.me.id || d.rights.canManage) ? `<button class="icon-btn" data-del-doc="${x.id}" aria-label="Gỡ văn bản ${esc(x.number)}">${icon('x')}</button>` : ''}</div>`).join('');
  const form = editable ? `<details style="margin-top:8px" data-sub="docForm"><summary class="btn btn-ghost btn-sm" data-testid="document-open">${icon('plus')}Thêm văn bản</summary>
      <div class="report-grid">
        <label>Loại<select id="docKind" data-testid="document-kind">${Object.entries(DOC_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>Số, ký hiệu<input id="docNumber" maxlength="80" placeholder="VD: 45/BC-TT" data-testid="document-number"></label>
        <label>Ngày văn bản<input type="date" id="docDate"></label>
        <label>Nơi ban hành<input id="docIssuer" maxlength="200"></label>
        <label class="wide">Trích yếu<input id="docSummary" maxlength="500" data-testid="document-summary"></label>
        <label class="wide">Liên kết (tuỳ chọn)<input id="docUrl" maxlength="500" placeholder="https://…"></label>
      </div>
      <p class="muted xs">Không nhập văn bản Mật / Tối mật / Tuyệt mật — chỉ số hiệu, trích yếu.</p>
      <button class="btn btn-primary btn-sm" data-act="add-document" data-testid="document-submit">Lưu văn bản</button></details>` : '';
  const summary = (d.documents || []).slice(0, 2).map(x => esc(x.number)).join(', ');
  return { count: (d.documents || []).length, summary, body: rows + form, empty: !rows };
}

// Ô xếp loại ở bước duyệt cuối (người giao / Ban Giám đốc nghiệm thu).
export function ratingPick() {
  return `<label class="field" style="margin-top:8px">Xếp loại khi nghiệm thu<select id="approvalRating" data-testid="approval-rating"><option value="">— Không xếp loại —</option>${Object.entries(RATINGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>`;
}

// Lùi n ngày làm việc (bỏ T7, CN) — gợi ý hạn nộp phòng để phòng còn thời gian duyệt.
function minusWorkdays(date, n) {
  const x = new Date(new Date(date).getTime() + 7 * 3_600_000); let k = n;
  while (k > 0) { x.setUTCDate(x.getUTCDate() - 1); const w = x.getUTCDay(); if (w !== 0 && w !== 6) k--; }
  return x.toISOString().slice(0, 10);
}
export function acceptDialog(d, refresh) {
  const opts = userOpts(d.leadDepartmentId);
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const suggest = d.internalDueDate ? dateInput(d.internalDueDate) : d.dueDate ? (s => (s >= today ? s : ''))(minusWorkdays(d.dueDate, 2)) : '';
  const modal = openModal(`<h2>${d.dispatchStatus === 'PENDING' ? 'Tiếp nhận &amp; phân công' : 'Phân công lại'}</h2>
    <p class="muted sm">${esc(d.code)} · ${esc(d.title)}${d.dueDate ? ` · hạn ${fmtDate(d.dueDate)}` : ''}</p>
    <div class="field"><label>Cán bộ chủ trì</label>${multiSelect('acceptLead', opts, d.assignees.map(a => a.id), 'Chọn cán bộ', { search: true })}</div>
    <div class="field"><label>Cán bộ phối hợp</label>${multiSelect('acceptSupport', opts, (d.supporters || []).map(a => a.id), 'Không', { search: true })}</div>
    <label class="field">Hạn nộp phòng (nội bộ) <span class="muted xs">— để phòng còn thời gian duyệt trước hạn${d.dueDate ? ` ${fmtDate(d.dueDate)}` : ''}</span><input type="date" id="acceptInternalDue" value="${suggest}"${d.dueDate ? ` max="${dateInput(d.dueDate)}"` : ''} data-testid="accept-internal-due">${!d.internalDueDate && suggest ? '<span class="muted xs">Gợi ý: trước hạn 2 ngày làm việc — sửa được.</span>' : ''}</label>
    <label class="field">Ghi chú phân công<textarea id="acceptNote" rows="2" maxlength="1000" data-testid="accept-note"></textarea></label>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-act="ok" data-testid="accept-submit">Phân công</button></div>`, { wide: true });
  bindMulti(modal, () => {});
  modal.onclick = async e => {
    if (e.target.closest('[data-close]')) return closeModal();
    if (!e.target.closest('[data-act="ok"]')) return;
    const assigneeIds = readMulti(modal, 'acceptLead');
    if (!assigneeIds.length) { toast('Chọn ít nhất một cán bộ chủ trì', 'err'); return; }
    try {
      await api(`/api/items/${d.id}/accept`, { method: 'POST', body: { assigneeIds, supporterIds: readMulti(modal, 'acceptSupport'), note: $('#acceptNote', modal).value.trim(), internalDueDate: fromDateInput($('#acceptInternalDue', modal).value) } });
      closeModal(); toast('Đã phân công', 'ok'); refresh();
    } catch (error) { toast(errorMessage(error), 'err'); }
  };
}
function extensionDialog(d, refresh) {
  const modal = openModal(`<h2>Đề nghị gia hạn</h2><p class="muted sm">${esc(d.code)} · hạn hiện tại ${d.dueDate ? fmtDate(d.dueDate) : '—'}</p>
    <label class="field">Hạn mới đề nghị<input type="date" id="extDue" value="${dateInput(d.dueDate)}"${d.dueDate ? ` min="${dateInput(d.dueDate)}"` : ''} required data-testid="extension-due"><span class="muted xs" id="extDelta"></span></label>
    ${d.dueDate ? `<div class="row" style="gap:6px;margin:-4px 0 10px">${[3, 7, 14].map(n => `<button type="button" class="chip" data-plus="${n}">+${n} ngày</button>`).join('')}</div>` : ''}
    <label class="field">Lý do<textarea id="extReason" rows="3" maxlength="1000" required data-testid="extension-reason"></textarea></label>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-act="ok" data-testid="extension-submit">Gửi đề nghị</button></div>`);
  modal.onclick = async e => {
    if (e.target.closest('[data-close]')) return closeModal();
    const plus = e.target.closest('[data-plus]');
    if (plus) { const x = new Date(new Date(d.dueDate).getTime() + 7 * 3_600_000 + Number(plus.dataset.plus) * 86_400_000); const el = $('#extDue', modal); el.value = x.toISOString().slice(0, 10); el.dispatchEvent(new Event('input')); return; }
    if (!e.target.closest('[data-act="ok"]')) return;
    try {
      await api(`/api/items/${d.id}/extensions`, { method: 'POST', body: { newDue: fromDateInput($('#extDue', modal).value), reason: $('#extReason', modal).value.trim() } });
      closeModal(); toast('Đã gửi đề nghị gia hạn', 'ok'); refresh();
    } catch (error) { toast(errorMessage(error), 'err'); }
  };
  $('#extDue', modal).oninput = e => { const v = fromDateInput(e.target.value); $('#extDelta', modal).textContent = v && d.dueDate ? `Thêm ${dayDiff(v, d.dueDate)} ngày so với hạn hiện tại` : ''; };
}
export function submitDialog(d, refresh) {
  const round = (d.submitRounds || 0) + 1;
  const ext = (d.extensions || []).find(x => x.status === 'PENDING');
  const first = (d.approvalSteps || [])[0];
  const modal = openModal(`<h2>Nộp sản phẩm (phiếu trình)${round > 1 ? ` — lần ${round}` : ''}</h2><p class="muted sm">${esc(d.code)} · ${esc(d.title)}. ${first ? `Chuyển tới bước "${esc(first.name)}" trước, sau đó lần lượt các cấp tiếp theo.` : ''}</p>
    ${ext ? `<div class="returned-banner" role="alert">Đề nghị gia hạn đến ${fmtDate(ext.newDue)} đang chờ quyết định — nộp bây giờ vẫn được, đề nghị gia hạn giữ nguyên.</div>` : ''}
    ${d.stage?.code === 'RETURNED' && d.returnNote ? `<p class="sm"><b>Ý kiến lần trước:</b> ${esc(d.returnNote)}</p>` : ''}
    <label class="field">Ý kiến đề xuất<textarea id="submitNote" rows="3" maxlength="2000" data-testid="submit-note" placeholder="VD: Kính trình dự thảo báo cáo; đề nghị phê duyệt"></textarea></label>
    <label class="field">Đính kèm dự thảo / sản phẩm <span class="muted xs">(tuỳ chọn; tối đa 25 MB mỗi tệp)</span><input type="file" id="submitFiles" multiple data-testid="submit-files"></label>
    <p class="muted xs">Đã có ${(d.attachments || []).length} tệp đính kèm. Số hiệu văn bản trên hệ thống văn bản điện tử ghi ở mục Văn bản liên quan.</p>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-act="ok" data-testid="submit-confirm">Nộp &amp; trình</button></div>`);
  modal.onclick = async e => {
    if (e.target.closest('[data-close]')) return closeModal();
    const ok = e.target.closest('[data-act="ok"]'); if (!ok) return;
    ok.disabled = true;
    try {
      const files = $('#submitFiles', modal).files;
      if (files.length) { const form = new FormData(); for (const f of files) form.append('files', f); await api(`/api/items/${d.id}/attachments`, { method: 'POST', form }); }
      await api(`/api/items/${d.id}/submit`, { method: 'POST', body: { note: $('#submitNote', modal).value.trim() } });
      closeModal(); toast(first ? `Đã nộp sản phẩm, chờ "${first.name}"` : 'Đã nộp sản phẩm', 'ok'); refresh();
    } catch (error) { ok.disabled = false; toast(errorMessage(error), 'err'); }
  };
}

// Tạo việc nhánh từ mẫu: chọn mẫu + ngày mốc → xem trước → sửa tên, người, hạn từng việc, bỏ việc không cần → tạo.
export function applyTemplateDialog(d, refresh) {
  const tpls = store.templates || [];
  if (!tpls.length) { toast('Chưa có mẫu nhóm việc — tạo ở Danh mục', 'err'); return; }
  const people = store.users.filter(u => u.isActive !== false && u.role !== 'admin' && (!d.leadDepartmentId || u.departmentId === d.leadDepartmentId || d.assignees.some(a => a.id === u.id)));
  const modal = openModal(`<h2>Tạo việc nhánh từ mẫu</h2><p class="muted sm">${esc(d.code)} · ${esc(d.title)}${d.dueDate ? ` · hạn ${fmtDate(d.dueDate)}` : ''}</p>
    <div class="grid2"><label class="field">Mẫu<select id="tpId" data-testid="template-select">${tpls.map(t => `<option value="${t.id}">${esc(t.name)} (${t.items.length} việc)</option>`).join('')}</select></label>
      <label class="field">Ngày mốc <span class="muted xs">(hạn tương đối tính từ ngày này; để trống = theo hạn việc cha)</span><input type="date" id="tpAnchor" data-testid="template-anchor"></label>
      <label class="field">Ký hiệu đầu tên <span class="muted xs">(tuỳ chọn, VD: HT1)</span><input id="tpPrefix" maxlength="12"></label></div>
    <div id="tpPreview"></div><p class="error" id="tpError"></p>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-ghost" data-act="preview" data-testid="template-preview">Xem trước</button><button class="btn btn-primary hidden" data-act="ok" data-testid="apply-template">Tạo việc nhánh</button></div>`, { wide: true });
  const base = () => ({ templateId: Number($('#tpId', modal).value), anchorDate: $('#tpAnchor', modal).value || null, prefix: $('#tpPrefix', modal).value.trim() || null });
  const preview = async () => {
    $('#tpError', modal).textContent = '';
    try {
      const r = await api(`/api/items/${d.id}/apply-template?dryRun=1`, { method: 'POST', body: base() });
      $('#tpPreview', modal).innerHTML = `${r.warnings.length ? `<ul class="warn-list">${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        <div class="tbl-scroll"><table class="table grid-input" data-testid="template-rows"><thead><tr><th>Tạo</th><th>Việc nhánh</th><th>Cán bộ chủ trì</th><th>Hạn</th></tr></thead><tbody>
        ${r.items.map(it => `<tr data-index="${it.index}"><td><input type="checkbox" data-col="use" checked aria-label="Tạo việc này"></td><td><input data-col="title" maxlength="300" value="${esc(it.title)}" data-orig="${esc(it.title)}" aria-label="Tên việc nhánh"></td>
          <td><select data-col="assignee"><option value="">— Như việc cha —</option>${people.map(u => `<option value="${u.id}"${it.assignees.length === 1 && it.assignees[0].id === u.id ? ' selected' : ''}>${esc(u.fullName)}</option>`).join('')}</select></td>
          <td><input type="date" data-col="due" value="${dateInput(it.dueDate)}"${d.dueDate ? ` max="${dateInput(d.dueDate)}"` : ''}><div class="muted xs">${esc(it.dueBasis || '')}</div></td></tr>`).join('')}</tbody></table></div>`;
      $('[data-act="ok"]', modal).classList.remove('hidden');
    } catch (error) { $('#tpError', modal).textContent = errorMessage(error); }
  };
  modal.onclick = async e => {
    if (e.target.closest('[data-close]')) return closeModal();
    if (e.target.closest('[data-act="preview"]')) return preview();
    const ok = e.target.closest('[data-act="ok"]'); if (!ok) return;
    // Chỉ gửi tên khi người dùng sửa (tên xem trước đã có ký hiệu đầu tên — gửi lại sẽ bị gắn ký hiệu hai lần).
    const titleOf = tr => { const el = $('[data-col=title]', tr), v = el.value.trim(); return v && v !== el.dataset.orig ? v : undefined; };
    const rows = [...modal.querySelectorAll('[data-index]')].map(tr => ({ index: Number(tr.dataset.index), skip: !$('[data-col=use]', tr).checked, title: titleOf(tr),
      assigneeIds: $('[data-col=assignee]', tr).value ? [Number($('[data-col=assignee]', tr).value)] : undefined, dueDate: $('[data-col=due]', tr).value || null }));
    ok.disabled = true;
    try { const r = await api(`/api/items/${d.id}/apply-template`, { method: 'POST', body: { ...base(), rows } }); closeModal(); toast(`Đã tạo ${r.created} việc nhánh`, 'ok'); refresh(); }
    catch (error) { ok.disabled = false; $('#tpError', modal).textContent = errorMessage(error); }
  };
  modal.onchange = e => { if (e.target.id === 'tpId' || e.target.id === 'tpAnchor') { $('#tpPreview', modal).innerHTML = ''; $('[data-act="ok"]', modal).classList.add('hidden'); } };
}

// Phòng phối hợp cử cán bộ của phòng mình.
function supportStaffDialog(d, refresh) {
  const mine = store.users.filter(u => u.isActive !== false && u.departmentId === store.me.departmentId && u.id !== store.me.id && !d.assignees.some(a => a.id === u.id));
  const modal = openModal(`<h2>Cử cán bộ phối hợp</h2><p class="muted sm">${esc(d.code)} · ${esc(d.title)} — phòng ${esc(d.leadDepartment?.name || 'chủ trì')} chủ trì.</p>
    <div class="field"><label>Cán bộ phòng bạn</label>${multiSelect('supportStaff', mine.map(u => ({ id: u.id, label: u.fullName })), (d.supporters || []).filter(s => mine.some(u => u.id === s.id)).map(s => s.id), 'Chọn cán bộ', { search: true })}</div>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-act="ok" data-testid="support-staff-submit">Cử</button></div>`);
  bindMulti(modal, () => {});
  modal.onclick = async e => {
    if (e.target.closest('[data-close]')) return closeModal();
    if (!e.target.closest('[data-act="ok"]')) return;
    try { await api(`/api/items/${d.id}/support-staff`, { method: 'POST', body: { userIds: readMulti(modal, 'supportStaff') } }); closeModal(); toast('Đã cử cán bộ phối hợp', 'ok'); refresh(); }
    catch (error) { toast(errorMessage(error), 'err'); }
  };
}

// Chia nhiều việc nhánh một lần: mỗi dòng = tên, cán bộ, hạn, sản phẩm. Dán được từ Excel (tab giữa các cột).
export function bulkChildrenDialog(d, refresh) {
  const people = store.users.filter(u => u.isActive !== false && u.role !== 'admin' && (u.departmentId === d.leadDepartmentId || d.assignees.some(a => a.id === u.id) || !d.leadDepartmentId));
  const userSel = (sel = []) => `<select data-col="assignee" aria-label="Cán bộ"><option value="">— Như việc cha —</option>${people.map(u => `<option value="${u.id}"${sel.includes(u.id) ? ' selected' : ''}>${esc(u.fullName)}</option>`).join('')}</select>`;
  const row = (r = {}) => `<tr><td><input data-col="title" maxlength="300" value="${esc(r.title || '')}" aria-label="Tên việc nhánh"></td><td>${userSel(r.assignee ? [r.assignee] : [])}</td>
    <td><input type="date" data-col="due" value="${esc(r.due || '')}"${d.dueDate ? ` max="${dateInput(d.dueDate)}"` : ''} aria-label="Hạn"></td><td><input data-col="deliverable" maxlength="500" value="${esc(r.deliverable || '')}" aria-label="Sản phẩm"></td>
    <td><button class="icon-btn" data-del-row aria-label="Bỏ dòng">${icon('x')}</button></td></tr>`;
  const modal = openModal(`<h2>Chia việc nhánh</h2><p class="muted sm">${esc(d.code)} · ${esc(d.title)}${d.dueDate ? ` · hạn ${fmtDate(d.dueDate)}` : ''}. Hạn việc nhánh không muộn hơn hạn việc cha; để trống = theo hạn việc cha.</p>
    <div class="tbl-scroll"><table class="table grid-input" data-testid="bulk-children"><thead><tr><th>Tên việc nhánh</th><th>Cán bộ</th><th>Hạn</th><th>Sản phẩm</th><th></th></tr></thead><tbody>${row()}${row()}${row()}</tbody></table></div>
    <div class="row" style="margin-top:8px"><button class="btn btn-ghost btn-sm" data-add-row>${icon('plus')}Thêm dòng</button><span class="muted xs">Mẹo: dán nhiều dòng từ Excel vào ô đầu tiên (Tên ⇥ Hạn dd/mm/yyyy ⇥ Sản phẩm).</span></div>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Huỷ</button><button class="btn btn-primary" data-act="ok" data-testid="bulk-children-submit">Tạo việc nhánh</button></div>`, { wide: true });
  const body = () => $('tbody', modal);
  modal.onclick = async e => {
    if (e.target.closest('[data-close]')) return closeModal();
    if (e.target.closest('[data-add-row]')) { body().insertAdjacentHTML('beforeend', row()); return; }
    const del = e.target.closest('[data-del-row]'); if (del) { del.closest('tr').remove(); return; }
    const ok = e.target.closest('[data-act="ok"]'); if (!ok) return;
    const rows = [...body().rows].map(tr => ({ title: $('[data-col=title]', tr).value.trim(), assigneeIds: $('[data-col=assignee]', tr).value ? [Number($('[data-col=assignee]', tr).value)] : undefined, dueDate: fromDateInput($('[data-col=due]', tr).value), deliverable: $('[data-col=deliverable]', tr).value.trim() })).filter(r => r.title);
    if (!rows.length) { toast('Nhập ít nhất một việc nhánh', 'err'); return; }
    ok.disabled = true;
    try { const r = await api(`/api/items/${d.id}/children/bulk`, { method: 'POST', body: { rows } }); closeModal(); toast(`Đã tạo ${r.created.length} việc nhánh`, 'ok'); refresh(); }
    catch (error) { ok.disabled = false; toast(errorMessage(error), 'err'); }
  };
  modal.addEventListener('paste', e => {
    const t = e.target.closest('[data-col=title]'); if (!t) return;
    const lines = (e.clipboardData?.getData('text') || '').split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2 && !lines[0]?.includes('\t')) return;
    e.preventDefault();
    const parsed = lines.map(l => { const [title, due, deliverable] = l.split('\t').map(x => x.trim()); const m = (due || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return { title, due: m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '', deliverable }; });
    const tr = t.closest('tr');
    [...body().rows].filter(r => !$('[data-col=title]', r).value.trim() && r !== tr).forEach(r => r.remove());
    tr.outerHTML = parsed.map(row).join('');
  });
}

// Xử lý click/thay đổi của các khối trên. Trả về true nếu đã xử lý.
export async function handleDispatchClick(e, p, d, refresh, patch) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'accept') { acceptDialog(d, refresh); return true; }
  if (act === 'extension') { extensionDialog(d, refresh); return true; }
  if (act === 'submit-product') { submitDialog(d, refresh); return true; }
  if (act === 'support-staff') { supportStaffDialog(d, refresh); return true; }
  if (act === 'bulk-children') { bulkChildrenDialog(d, refresh); return true; }
  if (act === 'template-children') { applyTemplateDialog(d, refresh); return true; }
  if (act === 'open-report') { const f = $('#reportForm', p); if (f) { f.closest('details.sec')?.setAttribute('open', ''); f.open = true; f.scrollIntoView({ block: 'start', behavior: 'smooth' }); $('#rpContent', p)?.focus({ preventScroll: true }); } return true; }
  const go = e.target.closest('[data-goto]');
  if (go) { const el = p.querySelector('#' + go.dataset.goto) || p.querySelector(`[data-testid="${go.dataset.goto}"]`); el?.closest('details')?.setAttribute('open', ''); el?.scrollIntoView({ block: 'start', behavior: 'smooth' }); el?.querySelector('textarea, input')?.focus({ preventScroll: true }); return true; }
  if (act === 'report') {
    const body = { progress: Number($('#rpProgress', p).value), content: $('#rpContent', p).value.trim(), difficulties: $('#rpDiff', p).value.trim(), proposals: $('#rpProp', p).value.trim() };
    if (!body.content) { toast('Nhập nội dung đã làm', 'err'); $('#rpContent', p).focus(); return true; }
    try { await api(`/api/items/${d.id}/progress-reports`, { method: 'POST', body }); for (const k of ['rpContent', 'rpDiff', 'rpProp']) draft(`${d.id}:${k}`, ''); toast('Đã gửi báo cáo tiến độ', 'ok'); refresh(); } catch (error) { toast(errorMessage(error), 'err'); }
    return true;
  }
  if (act === 'add-document') {
    const body = { kind: $('#docKind', p).value, number: $('#docNumber', p).value.trim(), issuedOn: fromDateInput($('#docDate', p).value), issuer: $('#docIssuer', p).value.trim(), summary: $('#docSummary', p).value.trim(), url: $('#docUrl', p).value.trim() };
    if (!body.number || !body.summary) { toast('Nhập số, ký hiệu và trích yếu', 'err'); return true; }
    try { await api(`/api/items/${d.id}/documents`, { method: 'POST', body }); toast('Đã thêm văn bản', 'ok'); refresh(); } catch (error) { toast(errorMessage(error), 'err'); }
    return true;
  }
  const ans = e.target.closest('[data-answer]');
  if (ans) {
    const input = p.querySelector(`[data-answer-input="${ans.dataset.answer}"]`);
    const note = input.value.trim(), ok = ans.dataset.verdict !== 'NO';
    if (!ok && !note) { toast('Nhập lý do không duyệt', 'err'); input.focus(); return true; }
    // Một mẫu chung với duyệt / gia hạn: Duyệt hoặc Không duyệt + ý kiến; lưu thành câu trả lời kiến nghị.
    const answer = `${ok ? 'Duyệt' : 'Không duyệt'}${note ? `. ${note}` : '.'}`;
    try { await api(`/api/progress-reports/${ans.dataset.answer}/answer`, { method: 'POST', body: { answer } }); draft(`${d.id}:answer-${ans.dataset.answer}`, ''); toast(ok ? 'Đã duyệt kiến nghị' : 'Đã không duyệt kiến nghị', 'ok'); refresh(); } catch (error) { toast(errorMessage(error), 'err'); }
    return true;
  }
  const fwd = e.target.closest('[data-forward]');
  if (fwd) {
    const input = p.querySelector(`[data-answer-input="${fwd.dataset.forward}"]`);
    try { await api(`/api/progress-reports/${fwd.dataset.forward}/forward`, { method: 'POST', body: { note: input?.value.trim() || '' } }); draft(`${d.id}:answer-${fwd.dataset.forward}`, ''); toast('Đã trình kiến nghị lên Ban Giám đốc', 'ok'); refresh(); } catch (error) { toast(errorMessage(error), 'err'); }
    return true;
  }
  const ext = e.target.closest('[data-ext]');
  if (ext) {
    const note = $('#extNote', p)?.value.trim() || '';
    if (ext.dataset.decision === 'REJECT' && !note) { toast('Nhập lý do không duyệt', 'err'); $('#extNote', p).focus(); return true; }
    try { await api(`/api/extensions/${ext.dataset.ext}/decide`, { method: 'POST', body: { decision: ext.dataset.decision, note } }); draft(`${d.id}:extNote`, ''); toast(ext.dataset.decision === 'APPROVE' ? 'Đã duyệt gia hạn' : 'Đã không duyệt gia hạn', 'ok'); refresh(); } catch (error) { toast(errorMessage(error), 'err'); }
    return true;
  }
  const del = e.target.closest('[data-del-doc]');
  if (del) {
    // Gỡ văn bản: không hỏi, cho hoàn tác (thêm lại đúng số hiệu, trích yếu…).
    const doc = (d.documents || []).find(x => String(x.id) === del.dataset.delDoc);
    try {
      await api(`/api/documents/${del.dataset.delDoc}`, { method: 'DELETE' }); refresh();
      if (doc) toast(`Đã gỡ văn bản ${doc.number}`, 'ok', { action: { label: 'Hoàn tác', run: async () => { await api(`/api/items/${d.id}/documents`, { method: 'POST', body: { kind: doc.kind, number: doc.number, issuedOn: doc.issuedOn, issuer: doc.issuer || '', summary: doc.summary, url: doc.url || '' } }); refresh(); } } });
    } catch (error) { toast(errorMessage(error), 'err'); }
    return true;
  }
  void patch;
  return false;
}
export function bindDispatchInputs(p, patch) {
  $('#ipTaskType', p)?.addEventListener('change', e => patch({ taskType: e.target.value }));
  $('#ipLeadDept', p)?.addEventListener('change', e => patch({ leadDepartmentId: e.target.value ? Number(e.target.value) : null }));
  $('#ipInternalDue', p)?.addEventListener('change', e => patch({ internalDueDate: fromDateInput(e.target.value) }));
}
