// Luật hoàn thành công việc (thuần, không chạm CSDL — có test riêng trong task-rules.test.js):
//   • Người chủ trì tự đổi trạng thái giữa các bước trung gian. Chuyển sang "Hoàn thành" thì việc chỉ vào "Chờ duyệt";
//     người giao duyệt (bắt buộc chấm mức hoàn thành) mới thành Hoàn thành, hoặc trả lại kèm lý do → "Đang làm".
//   • Cấp 1 của phiếu duyệt luôn là người giao; các cấp duyệt dự án đã cấu hình (nếu có) chạy sau.
//   • Người chủ trì không tự duyệt việc của mình. Việc tự giao cho mình → lãnh đạo bộ phận duyệt.
//   • Việc cha chỉ được gửi duyệt / hoàn thành khi mọi việc con (trừ việc huỷ) đã được duyệt hoàn thành.
const { fail } = require('../lib/http');

// Thang 5 mức hoàn thành người giao chấm khi duyệt.
const RATINGS = { EXCELLENT: 'Xuất sắc', GOOD: 'Tốt', PASS: 'Đạt', NEEDS_IMPROVEMENT: 'Cần cải thiện', POOR: 'Kém' };
// Bước duyệt ảo của người giao (cấp 1 của phiếu withAssigner).
const ASSIGNER_STEP = Object.freeze({ level: 1, name: 'Người giao duyệt', approverType: 'ASSIGNER', virtual: true });
// Việc MỐC hoặc trên ĐƯỜNG GĂNG (chủ dự án chốt 20/11/2026): cấp 1 = BTGĐ phụ trách của việc duyệt + chấm mức, thay người giao.
const BOARD_STEP = Object.freeze({ level: 1, name: 'Ban Tổng Giám đốc duyệt', approverType: 'BOARD', virtual: true });
// Bước duyệt chấm mức hoàn thành (cấp 1 của phiếu mới): người giao, hoặc Ban Tổng Giám đốc với việc mốc / đường găng.
const isGradeStep = step => step?.approverType === 'ASSIGNER' || step?.approverType === 'BOARD';
// Việc do Ban Tổng Giám đốc duyệt hoàn thành: mốc hoặc đường găng.
const isBoardItem = item => !!(item?.critical || item?.milestone);

// Chuỗi bước duyệt của một phiếu: phiếu mới = [người giao (việc mốc / găng: Ban Tổng Giám đốc), ...bước dự án dời lên 1 cấp];
// phiếu cũ = bước dự án.
function chainOf(projectSteps, withAssigner = true, { board = false } = {}) {
  const steps = [...projectSteps].sort((a, b) => a.level - b.level);
  if (!withAssigner) return steps;
  return [board ? BOARD_STEP : ASSIGNER_STEP, ...steps.map((s, i) => ({ ...s, level: i + 2 }))];
}
const stepAt = (chain, level) => chain.find(s => s.level === level) || null;
// Bảng có duyệt không — MỘT định nghĩa cho nhãn "Duyệt N cấp" ở trang dự án và mục "Quy trình duyệt" của panel việc: có cấp duyệt của
// dự án, hoặc có cột nhóm Chờ duyệt / Hoàn thành. Bảng không có các cột đó (vd. Lịch tuần, toàn Cột tự do) thì không bao giờ có duyệt.
const hasApprovalFlow = (states = [], stepsCount = 0) => stepsCount > 0 || states.some(s => s.category === 'REVIEW' || s.category === 'COMPLETED');
// Số cấp của dự án áp cho việc không chọn tay, không khớp quy tắc: mức mặc định của dự án; để trống = đủ các cấp.
const defaultLevels = (project, total) => Math.max(0, Math.min(total, Number(project?.defaultApprovalLevels ?? total)));
// Quy trình duyệt mặc định của một việc mới trong dự án: CÙNG chainOf với panel việc — bước người giao (luôn có) + các cấp dự án theo
// mức mặc định. Đếm số cấp = độ dài chuỗi (trang dự án "Duyệt N cấp" và panel việc "Quy trình duyệt N cấp" không lệch nhau).
function defaultFlow(project, projectSteps = [], states = []) {
  if (!hasApprovalFlow(states, projectSteps.length)) return [];
  const steps = [...projectSteps].sort((a, b) => a.level - b.level);
  return chainOf(steps.slice(0, defaultLevels(project, steps.length)), true);
}

// Tiến độ việc con trực tiếp: x/y không tính việc con đã huỷ. children: [{ state: { category } } | { category }].
function childProgress(children = []) {
  const cats = children.map(c => c.state?.category ?? c.category);
  const counted = cats.filter(c => c !== 'CANCELLED');
  const done = counted.filter(c => c === 'COMPLETED').length;
  return { done, total: counted.length, open: counted.length - done };
}
function assertChildrenDone(children, action = 'hoàn thành') {
  const p = childProgress(children);
  if (p.open > 0) fail(409, `Còn ${p.open} việc con chưa được duyệt hoàn thành (${p.done}/${p.total}) — chưa thể ${action} việc cha`, 'CHILDREN_OPEN');
  return p;
}

// Đích thực sự của một lần chuyển trạng thái.
//   to = 'COMPLETED' mà chưa có phiếu đã duyệt → vào cột Chờ duyệt (REVIEW).
//   allowDirect = nhập hàng loạt dữ liệu lịch sử (sổ Excel, MTL) do người quản lý thực hiện.
function completionTarget({ fromCategory, toCategory, approved, allowDirect = false }) {
  if (toCategory !== 'COMPLETED' || approved || allowDirect) return toCategory;
  if (fromCategory === 'REVIEW') fail(409, 'Việc đang chờ người giao duyệt — người giao duyệt xong việc mới thành Hoàn thành', 'APPROVAL_PENDING');
  return 'REVIEW';
}

// Người duyệt cấp "người giao" của một việc.
//   item: { assignedById, reporterId, leadDepartmentId, assigneeIds: number[] }
//   ctx:  { active: Map<userId, { departmentId }>, leaders(deptId) → ids lãnh đạo bộ phận có quyền duyệt,
//           projectLeadId, supervisorOf(deptId) → Phó TGĐ phụ trách, directors: ids Ban Tổng Giám đốc }
// Trả { ids, reason }: ASSIGNER = người giao; DEPT_LEADER / PROJECT_LEAD / SUPERVISOR / DIRECTOR = thay vì việc tự giao
// (hoặc người giao đã nghỉ). Không bao giờ chứa người chủ trì.
function assignerApprovers(item, ctx) {
  const assignees = new Set(item.assigneeIds || []);
  const ok = id => id != null && ctx.active.has(id) && !assignees.has(id);
  const assigner = item.assignedById ?? item.reporterId ?? null;
  if (ok(assigner)) return { ids: [assigner], reason: 'ASSIGNER' };
  const firstAssignee = [...assignees].find(id => ctx.active.has(id));
  const dept = item.leadDepartmentId ?? (firstAssignee != null ? ctx.active.get(firstAssignee).departmentId : null) ?? ctx.projectDepartmentId ?? null;
  const pick = (ids, reason) => { const out = [...new Set(ids)].filter(ok); return out.length ? { ids: out, reason } : null; };
  return pick(dept != null ? ctx.leaders(dept) : [], 'DEPT_LEADER')
    || pick([ctx.projectLeadId], 'PROJECT_LEAD')
    || pick([dept != null ? ctx.supervisorOf(dept) : null], 'SUPERVISOR')
    || pick(ctx.directors || [], 'DIRECTOR')
    || { ids: [], reason: 'NONE' };
}

// Người duyệt cấp "Ban Tổng Giám đốc" của việc mốc / đường găng: BTGĐ phụ trách toàn công ty + Phó TGĐ phụ trách bộ phận chủ trì.
//   ctx: { active, topIds: ids BTGĐ phụ trách toàn công ty, supervisorOf(deptId), projectDepartmentId } (+ như assignerApprovers để dự phòng)
// Không bao giờ chứa người chủ trì: Ban Tổng Giám đốc đồng thời là người chủ trì → Ban Tổng Giám đốc khác duyệt.
// Chưa có ai (chưa đánh dấu BTGĐ phụ trách toàn công ty, phòng chưa có Phó TGĐ phụ trách) → người giao duyệt như việc thường (phiếu không bị kẹt).
function boardApprovers(item, ctx) {
  const assignees = new Set(item.assigneeIds || []);
  const ok = id => id != null && ctx.active.has(id) && !assignees.has(id);
  const dept = item.leadDepartmentId ?? ctx.projectDepartmentId ?? null;
  const ids = [...new Set([...(ctx.topIds || []), dept != null ? ctx.supervisorOf(dept) : null])].filter(ok);
  if (ids.length) return { ids, reason: 'BOARD' };
  const fallback = assignerApprovers(item, ctx);
  return { ...fallback, reason: fallback.ids.length ? 'BOARD_FALLBACK_' + fallback.reason : 'NONE' };
}

// Kiểm tra một quyết định duyệt (ngoài việc người dùng có nằm trong danh sách người duyệt của cấp hay không).
function checkDecision({ step, decision, rating, comment, userId, assigneeIds = [], requestedById }) {
  if (assigneeIds.includes(userId)) fail(403, 'Người chủ trì không tự duyệt việc của mình', 'SELF_APPROVAL');
  // Cấp chấm mức (người giao / Ban Tổng Giám đốc) duyệt phiếu của người khác gửi; các cấp dự án thì không tự duyệt phiếu mình gửi.
  if (!isGradeStep(step) && requestedById === userId) fail(403, 'Không thể tự duyệt việc do chính mình gửi duyệt', 'SELF_APPROVAL');
  if (decision === 'REJECT' && !String(comment || '').trim()) fail(422, 'Trả lại phải ghi lý do', 'REASON_REQUIRED');
  if (decision === 'APPROVE' && isGradeStep(step)) {
    if (!rating) fail(422, 'Hãy chấm mức hoàn thành (Xuất sắc / Tốt / Đạt / Cần cải thiện / Kém) trước khi duyệt', 'RATING_REQUIRED');
    if (!RATINGS[rating]) fail(422, 'Mức hoàn thành không hợp lệ', 'INVALID_RATING');
  } else if (rating && !RATINGS[rating]) fail(422, 'Mức hoàn thành không hợp lệ', 'INVALID_RATING');
}

module.exports = { RATINGS, ASSIGNER_STEP, BOARD_STEP, isGradeStep, isBoardItem, chainOf, stepAt, hasApprovalFlow, defaultLevels, defaultFlow, childProgress, assertChildrenDone, completionTarget, assignerApprovers, boardApprovers, checkDecision };
