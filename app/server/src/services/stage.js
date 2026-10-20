// "Khâu" xử lý của một việc trong luồng điều hành (khác trạng thái hạn): chờ phòng tiếp nhận → đang thực hiện
// → chờ phòng duyệt → chờ BGĐ cho ý kiến → hoàn thành; bị trả lại. Dùng chung cho sổ, hộp việc phòng, file xuất.
const STAGES = {
  PENDING_ACCEPT: 'Chờ phòng tiếp nhận', TODO: 'Chưa bắt đầu', DOING: 'Đang thực hiện', RETURNED: 'Bị trả lại',
  WAIT_DEPT: 'Chờ phòng duyệt', WAIT_BGD: 'Chờ BGĐ cho ý kiến', WAIT_APPROVAL: 'Chờ duyệt', DONE: 'Hoàn thành', CANCELLED: 'Huỷ',
};
// item: { state: { category }, dispatchStatus, returnedAt, pendingApproval|approvals: [{ currentLevel }] }
// steps: các bước duyệt của dự án [{ level, name, approverType }]
function stageOf(item, steps = []) {
  const cat = item.state?.category;
  const out = (code, label = STAGES[code]) => ({ code, label });
  if (cat === 'CANCELLED') return out('CANCELLED');
  if (cat === 'COMPLETED') return out('DONE');
  if (item.dispatchStatus === 'PENDING') return out('PENDING_ACCEPT');
  const pending = item.pendingApproval || (Array.isArray(item.approvals) ? item.approvals.find(a => !a.status || a.status === 'PENDING') : null);
  if (cat === 'REVIEW' && pending) {
    const step = steps.find(s => s.level === pending.currentLevel);
    if (step?.approverType === 'DEPARTMENT_MANAGER') return out('WAIT_DEPT');
    if (step?.approverType === 'DIRECTOR' || step?.approverType === 'SUPERVISOR') return out('WAIT_BGD');
    return out('WAIT_APPROVAL', step ? `Chờ duyệt: ${step.name}` : STAGES.WAIT_APPROVAL);
  }
  if (item.returnedAt) return out('RETURNED');
  if (cat === 'BACKLOG' || cat === 'UNSTARTED' || cat === 'OTHER') return out('TODO');
  return out('DOING');
}
module.exports = { STAGES, stageOf };
