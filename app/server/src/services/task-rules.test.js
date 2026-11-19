// Luật hoàn thành công việc: chuyển trạng thái, quyền duyệt của người giao, ràng buộc việc cha – việc con (dữ liệu giả).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./task-rules');
const { stageOf } = require('./stage');

const code = fn => { try { fn(); } catch (e) { return e.code; } return null; };

test('chuyển trạng thái: các bước trung gian giữ nguyên; "Hoàn thành" khi chưa duyệt → "Chờ duyệt"', () => {
  assert.equal(R.completionTarget({ fromCategory: 'UNSTARTED', toCategory: 'STARTED', approved: false }), 'STARTED');
  assert.equal(R.completionTarget({ fromCategory: 'STARTED', toCategory: 'UNSTARTED', approved: false }), 'UNSTARTED');
  assert.equal(R.completionTarget({ fromCategory: 'STARTED', toCategory: 'CANCELLED', approved: false }), 'CANCELLED');
  assert.equal(R.completionTarget({ fromCategory: 'STARTED', toCategory: 'COMPLETED', approved: false }), 'REVIEW');
  assert.equal(R.completionTarget({ fromCategory: undefined, toCategory: 'COMPLETED', approved: false }), 'REVIEW'); // tạo việc thẳng vào Hoàn thành
  // Đã được duyệt (phiếu APPROVED gần nhất) → được vào Hoàn thành.
  assert.equal(R.completionTarget({ fromCategory: 'REVIEW', toCategory: 'COMPLETED', approved: true }), 'COMPLETED');
  // Đang chờ duyệt mà tự kéo sang Hoàn thành → chặn.
  assert.equal(code(() => R.completionTarget({ fromCategory: 'REVIEW', toCategory: 'COMPLETED', approved: false })), 'APPROVAL_PENDING');
  // Nhập hàng loạt dữ liệu lịch sử do người quản lý → ghi thẳng.
  assert.equal(R.completionTarget({ fromCategory: undefined, toCategory: 'COMPLETED', approved: false, allowDirect: true }), 'COMPLETED');
});

test('chuỗi duyệt: cấp 1 luôn là người giao, các cấp dự án dời lên; phiếu cũ giữ nguyên', () => {
  const project = [{ level: 2, name: 'BGĐ', approverType: 'DIRECTOR' }, { level: 1, name: 'Trưởng phòng', approverType: 'DEPARTMENT_MANAGER' }];
  const chain = R.chainOf(project, true);
  assert.deepEqual(chain.map(s => [s.level, s.approverType]), [[1, 'ASSIGNER'], [2, 'DEPARTMENT_MANAGER'], [3, 'DIRECTOR']]);
  assert.deepEqual(R.chainOf([], true).map(s => s.approverType), ['ASSIGNER']); // dự án không cấu hình duyệt: chỉ người giao
  assert.deepEqual(R.chainOf(project, false).map(s => [s.level, s.approverType]), [[1, 'DEPARTMENT_MANAGER'], [2, 'DIRECTOR']]);
  assert.equal(project[0].level, 2, 'không sửa mảng gốc');
  assert.equal(R.stepAt(chain, 3).name, 'BGĐ');
});

test('khâu "Chờ người giao duyệt" cho phiếu mới; phiếu cũ vẫn tính khâu theo bước dự án', () => {
  const steps = [{ level: 1, name: 'Trưởng phòng', approverType: 'DEPARTMENT_MANAGER' }];
  const review = { category: 'REVIEW' };
  assert.equal(stageOf({ state: review, pendingApproval: { currentLevel: 1, withAssigner: true } }, steps).code, 'WAIT_ASSIGNER');
  assert.equal(stageOf({ state: review, pendingApproval: { currentLevel: 2, withAssigner: true } }, steps).code, 'WAIT_DEPT');
  assert.equal(stageOf({ state: review, pendingApproval: { currentLevel: 1, withAssigner: false } }, steps).code, 'WAIT_DEPT');
});

test('tiến độ con x/y không tính việc huỷ; việc cha bị chặn khi còn con chưa được duyệt', () => {
  const kids = [{ state: { category: 'COMPLETED' } }, { state: { category: 'REVIEW' } }, { state: { category: 'CANCELLED' } }, { state: { category: 'STARTED' } }];
  assert.deepEqual(R.childProgress(kids), { done: 1, total: 3, open: 2 });
  assert.deepEqual(R.childProgress([]), { done: 0, total: 0, open: 0 });
  const err = (() => { try { R.assertChildrenDone(kids, 'gửi duyệt'); } catch (e) { return e; } })();
  assert.equal(err.code, 'CHILDREN_OPEN');
  assert.equal(err.status, 409);
  assert.match(err.message, /2 việc con.*\(1\/3\).*gửi duyệt/);
  // Con "Chờ duyệt" chưa tính là xong: cha cần con đã được DUYỆT hoàn thành.
  assert.equal(code(() => R.assertChildrenDone([{ state: { category: 'REVIEW' } }])), 'CHILDREN_OPEN');
  assert.deepEqual(R.assertChildrenDone([{ state: { category: 'COMPLETED' } }, { state: { category: 'CANCELLED' } }]), { done: 1, total: 1, open: 0 });
});

// Công ty giả: phòng 10 (trưởng 2, phó 3), phòng 20 (trưởng 5); PGĐ 7 phụ trách phòng 10; BGĐ 7, 8; người 9 đã nghỉ.
const active = new Map([[1, { departmentId: 10 }], [2, { departmentId: 10 }], [3, { departmentId: 10 }], [4, { departmentId: 10 }], [5, { departmentId: 20 }], [6, { departmentId: 20 }], [7, { departmentId: 1 }], [8, { departmentId: 1 }]]);
const ctx = (over = {}) => ({ active, leaders: d => ({ 10: [2, 3], 20: [5] })[d] || [], projectLeadId: 6, supervisorOf: d => (d === 10 ? 7 : null), directors: [7, 8], ...over });

test('người duyệt cấp người giao: đúng người giao, không bao giờ là người chủ trì', () => {
  assert.deepEqual(R.assignerApprovers({ assignedById: 2, assigneeIds: [1] }, ctx()), { ids: [2], reason: 'ASSIGNER' });
  // Chưa ghi người giao → người tạo việc.
  assert.deepEqual(R.assignerApprovers({ assignedById: null, reporterId: 5, assigneeIds: [1] }, ctx()), { ids: [5], reason: 'ASSIGNER' });
  // Việc tự giao cho mình → lãnh đạo bộ phận của người chủ trì.
  assert.deepEqual(R.assignerApprovers({ assignedById: 1, assigneeIds: [1] }, ctx()), { ids: [2, 3], reason: 'DEPT_LEADER' });
  // Trưởng phòng tự giao cho mình → phó phòng (lãnh đạo khác của bộ phận).
  assert.deepEqual(R.assignerApprovers({ assignedById: 2, assigneeIds: [2] }, ctx()), { ids: [3], reason: 'DEPT_LEADER' });
  // Cả lãnh đạo bộ phận cùng chủ trì → trưởng dự án.
  assert.deepEqual(R.assignerApprovers({ assignedById: 2, assigneeIds: [2, 3] }, ctx()), { ids: [6], reason: 'PROJECT_LEAD' });
  // … trưởng dự án cũng chủ trì → PGĐ phụ trách bộ phận → Ban Giám đốc.
  assert.deepEqual(R.assignerApprovers({ assignedById: 2, assigneeIds: [2, 3, 6] }, ctx()), { ids: [7], reason: 'SUPERVISOR' });
  assert.deepEqual(R.assignerApprovers({ assignedById: 2, assigneeIds: [2, 3, 6, 7] }, ctx()), { ids: [8], reason: 'DIRECTOR' });
  // Người giao đã nghỉ → lãnh đạo bộ phận chủ trì (theo phòng chủ trì của việc nếu có).
  assert.deepEqual(R.assignerApprovers({ assignedById: 9, leadDepartmentId: 20, assigneeIds: [6] }, ctx()), { ids: [5], reason: 'DEPT_LEADER' });
  for (const item of [{ assignedById: 1, assigneeIds: [1] }, { assignedById: 2, assigneeIds: [2, 3] }, { assignedById: 2, assigneeIds: [2, 3, 6, 7] }])
    assert.ok(!R.assignerApprovers(item, ctx()).ids.some(id => item.assigneeIds.includes(id)), 'không chứa người chủ trì');
});

test('quyết định duyệt: chấm mức bắt buộc ở cấp người giao, trả lại bắt buộc lý do, không tự duyệt', () => {
  const A = R.ASSIGNER_STEP, P = { level: 2, approverType: 'DEPARTMENT_MANAGER' };
  const ok = over => R.checkDecision({ step: A, decision: 'APPROVE', rating: 'GOOD', comment: '', userId: 2, assigneeIds: [1], requestedById: 1, ...over });
  assert.doesNotThrow(() => ok());
  for (const r of Object.keys(R.RATINGS)) assert.doesNotThrow(() => ok({ rating: r }));
  assert.deepEqual(Object.values(R.RATINGS), ['Xuất sắc', 'Tốt', 'Đạt', 'Cần cải thiện', 'Kém']);
  assert.equal(code(() => ok({ rating: undefined })), 'RATING_REQUIRED');
  assert.equal(code(() => ok({ rating: 'FAIL' })), 'INVALID_RATING'); // mức cũ không còn dùng
  // Người chủ trì không tự duyệt — ở mọi cấp.
  assert.equal(code(() => ok({ userId: 1 })), 'SELF_APPROVAL');
  assert.equal(code(() => ok({ step: P, userId: 1, rating: undefined })), 'SELF_APPROVAL');
  // Người giao tự bấm Hoàn thành (là người gửi phiếu) vẫn duyệt + chấm điểm được ở cấp người giao…
  assert.doesNotThrow(() => ok({ requestedById: 2 }));
  // … nhưng ở cấp dự án thì không tự duyệt phiếu mình gửi.
  assert.equal(code(() => ok({ step: P, requestedById: 2, rating: undefined })), 'SELF_APPROVAL');
  // Cấp dự án không bắt buộc chấm mức.
  assert.doesNotThrow(() => ok({ step: P, rating: undefined }));
  // Trả lại: bắt buộc lý do, không cần chấm mức.
  assert.equal(code(() => ok({ decision: 'REJECT', rating: undefined, comment: '  ' })), 'REASON_REQUIRED');
  assert.doesNotThrow(() => ok({ decision: 'REJECT', rating: undefined, comment: 'Thiếu phụ lục' }));
});

test('việc chưa giao ai: người gửi duyệt được coi là người làm (không tự duyệt)', () => {
  const { withDoers, assigneeIdsOf } = require('./approval');
  assert.deepEqual(assigneeIdsOf(withDoers({ assignees: [] }, 4)), [4]);
  assert.deepEqual(assigneeIdsOf(withDoers({ assignees: [{ userId: 1 }] }, 4)), [1]); // đã có người chủ trì: giữ nguyên
  // Người tạo (= người giao) tự bấm Hoàn thành việc chưa giao ai → không còn là người duyệt; lãnh đạo bộ phận duyệt.
  const it = withDoers({ assignedById: 2, assignees: [] }, 2);
  assert.deepEqual(R.assignerApprovers({ assignedById: 2, assigneeIds: assigneeIdsOf(it) }, ctx()).ids, [3]);
});
