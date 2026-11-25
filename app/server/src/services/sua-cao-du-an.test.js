// Unit test 5 lỗi mức Cao nhóm "dự án" (de-xuat-sua-3-du-an.md C1–C4, kiem-cheo-thiet-lap.md #13 / #35), dữ liệu GIẢ:
//   C1 chữ số cấp duyệt đếm cả bước người giao · C2 xoá / khôi phục dự án, việc không mất phiếu duyệt đang chờ ·
//   C4 khoá đổi nhóm của cột còn việc · #13 cấp "Người đứng tên dự án" không về tài khoản Quản trị hệ thống, không kẹt.
// Luồng HTTP thật (cả C3 nhập "Danh sách đơn giản", 422 Người đứng tên / thành viên): app/e2e/tests/20-sua-cao-du-an.spec.js;
// người nhận cảnh báo MTL (#35): alerts.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('./task-rules');
const T = require('./trash');
const approval = require('./approval');
const { categoryLocks } = require('../routes/projects');

// Bảng giả lọc theo điều kiện Prisma đơn giản: bằng, { not }, { in } — đủ cho NOT_IT_WHERE, DEPT_APPROVER_WHERE, lọc theo dự án.
const match = (row, where = {}) => Object.entries(where).every(([k, c]) => (c && typeof c === 'object'
  ? ('not' in c ? row[k] !== c.not : true) && ('in' in c ? c.in.includes(row[k]) : true) : row[k] === c));
const table = rows => ({ findMany: async ({ where } = {}) => rows.filter(r => match(r, where)) });
const account = (id, role, extra = {}) => ({ id, role, isRootAdmin: false, isActive: true, departmentId: 10, boardAll: false, ...extra });

// ---------- C1: chữ số cấp duyệt ----------
const WEB = path.join(__dirname, '..', '..', '..', 'web', 'js');
function webSources() {
  const out = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.m?js$/.test(e.name)) out.push([path.relative(WEB, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')]);
  } };
  walk(WEB);
  return out;
}

test('C1: giao diện không còn "Không cần duyệt" và mẫu "1 cấp — …" — bước người giao (mốc / găng: BTGĐ phụ trách) luôn duyệt', () => {
  const files = webSources();
  assert.ok(files.length > 30, 'quét được app/web/js');
  const bad = [];
  for (const [rel, src] of files) src.split('\n').forEach((line, i) => {
    if (/không cần duyệt/i.test(line) || /\d+ cấp — /.test(line)) bad.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  assert.deepEqual(bad, [], 'còn chữ nói việc không qua duyệt / không đếm bước người giao');
  const settings = files.find(([rel]) => rel === 'views/settings.js')[1];
  for (const s of ['Cấp duyệt thêm sau người giao', 'Người giao → Lãnh đạo bộ phận</option>', 'Người giao → Lãnh đạo bộ phận → BTGĐ phụ trách</option>',
    'Chỉ người giao duyệt</option>', 'Để trống = chỉ người giao duyệt (việc mốc / đường găng: BTGĐ phụ trách)']) assert.ok(settings.includes(s), 'thiếu chữ: ' + s);
});

test('C1: nhãn "Duyệt N cấp" của dự án dựng bằng CÙNG chainOf với panel việc — đếm cả bước người giao; bảng không có duyệt thì không có nhãn', async () => {
  const steps = [{ level: 2, name: 'BTGĐ duyệt', approverType: 'DIRECTOR' }, { level: 1, name: 'Lãnh đạo bộ phận duyệt', approverType: 'DEPARTMENT_MANAGER' }];
  const flowStates = [{ category: 'STARTED' }, { category: 'REVIEW' }, { category: 'COMPLETED' }];
  const names = (project, s = steps, states = flowStates) => R.defaultFlow(project, s, states).map(x => x.name);
  assert.deepEqual(names({ defaultApprovalLevels: null }, steps.slice(1)), ['Người giao duyệt', 'Lãnh đạo bộ phận duyệt'], 'dự án 1 cấp → "Duyệt 2 cấp"');
  assert.deepEqual(names({ defaultApprovalLevels: null }), ['Người giao duyệt', 'Lãnh đạo bộ phận duyệt', 'BTGĐ duyệt']);
  assert.deepEqual(names({ defaultApprovalLevels: 1 }), ['Người giao duyệt', 'Lãnh đạo bộ phận duyệt'], 'mặc định 1 cấp đầu');
  assert.deepEqual(names({ defaultApprovalLevels: 0 }), ['Người giao duyệt'], 'chỉ người giao duyệt');
  assert.deepEqual(names({}, []), ['Người giao duyệt'], 'không có cấp dự án nhưng có cột Hoàn thành → "Duyệt 1 cấp"');
  assert.deepEqual(names({}, [], [{ category: 'OTHER' }, { category: 'OTHER' }]), [], 'Lịch tuần: không có duyệt');
  assert.equal(R.hasApprovalFlow([{ category: 'OTHER' }], 1), true, 'có cấp dự án là có duyệt');
  // Panel việc (routes/items.js): chainOf(steps.slice(0, levelsForItem(...).levels)) — việc không chọn tay, không khớp quy tắc dùng mức mặc định.
  const sorted = [...steps].sort((a, b) => a.level - b.level);
  for (const d of [null, 0, 1, 2, 7]) {
    const project = { id: 1, defaultApprovalLevels: d };
    const { levels, source } = await approval.levelsForItem({ approvalRule: { findMany: async () => [] } }, project, sorted, { approvalLevels: null });
    assert.equal(source, 'DEFAULT');
    assert.equal(R.defaultFlow(project, steps, flowStates).length, R.chainOf(sorted.slice(0, levels), true).length, `mặc định ${d}`);
  }
});

// ---------- C2: xoá / khôi phục không mất phiếu duyệt ----------
test('C2: phiếu của dự án / việc đang ở Thùng rác bị chặn mọi thao tác (409), kể cả gọi thẳng approval.decide', async () => {
  assert.throws(() => approval.assertNotInTrash({ archivedAt: null, project: { deletedAt: new Date() } }), e => e.status === 409 && e.code === 'PROJECT_IN_TRASH'
    && e.message === 'Dự án đang ở Thùng rác — khôi phục dự án trước');
  assert.throws(() => approval.assertNotInTrash({ archivedAt: new Date(), project: { deletedAt: null } }), e => e.status === 409 && e.code === 'ITEM_IN_TRASH');
  assert.doesNotThrow(() => approval.assertNotInTrash({ archivedAt: null, project: { deletedAt: null } }));
  for (const [workItem, code] of [[{ archivedAt: null, project: { id: 1, deletedAt: new Date() } }, 'PROJECT_IN_TRASH'], [{ archivedAt: new Date(), project: { id: 1, deletedAt: null } }, 'ITEM_IN_TRASH']]) {
    const request = { id: 5, status: 'PENDING', currentLevel: 1, totalLevels: 1, withAssigner: true, withBoard: false, requestedById: 3, actions: [],
      workItem: { id: 9, title: 'Việc giả', reporterId: 2, assignedById: 2, assignees: [{ userId: 3 }], ...workItem } };
    const tx = { $executeRaw: async () => 0, approvalRequest: { findUnique: async () => request } };
    await assert.rejects(approval.decide({ $transaction: fn => fn(tx) }, { id: 2 }, 5, 'APPROVE', null, { rating: 'GOOD' }), e => e.status === 409 && e.code === code);
  }
});

test('C2 chuyển tiếp: nhận đúng phiếu bản cũ huỷ khi xoá dự án / xoá việc', () => {
  const at = new Date('2026-11-20T03:00:00.000Z');
  const later = ms => new Date(at.getTime() + ms);
  const base = { status: 'CANCELLED', closedAt: later(40), actions: [{ decision: 'SUBMIT' }] };
  const ok = (r, o = {}) => T.cancelledByTrash(r, { trashedAt: at, by: 'PROJECT', itemCategory: 'REVIEW', ...o });
  assert.equal(ok(base), true, 'xoá dự án bản cũ: huỷ hàng loạt, không lượt CANCEL, không hoạt động APPROVAL_CANCELLED');
  assert.equal(ok({ ...base, actions: [{ decision: 'SUBMIT' }, { decision: 'APPROVE' }] }), true, 'đã qua cấp 1 vẫn mở lại ở cấp đang chờ');
  assert.equal(ok(base, { cancelLogged: true }), false, 'có hoạt động APPROVAL_CANCELLED = huỷ thật');
  assert.equal(ok({ ...base, actions: [...base.actions, { decision: 'CANCEL', comment: 'Người gửi rút lại' }] }), false, 'rút phiếu thật');
  assert.equal(ok({ ...base, closedAt: later(60_000) }), false, 'không sát lúc xoá');
  assert.equal(ok({ ...base, closedAt: later(-5000) }), false, 'huỷ trước lúc xoá');
  assert.equal(ok(base, { itemCategory: 'STARTED' }), false, 'việc không còn ở Chờ duyệt');
  assert.equal(ok(base, { hasNewer: true }), false, 'đã có phiếu mới hơn');
  assert.equal(ok({ ...base, status: 'REJECTED' }), false);
  const item = { ...base, actions: [{ decision: 'SUBMIT' }, { decision: 'CANCEL', comment: T.TRASH_CANCEL_REASON }] };
  assert.equal(T.TRASH_CANCEL_REASON, 'Xoá công việc');
  assert.equal(ok(item, { by: 'ITEM', cancelLogged: true }), true, 'xoá việc bản cũ: một lượt CANCEL "Xoá công việc"');
  assert.equal(ok({ ...item, actions: [{ decision: 'CANCEL', comment: 'Chuyển khỏi cột chờ duyệt' }] }, { by: 'ITEM' }), false);
  assert.equal(ok(base, { by: 'ITEM' }), false);
  assert.equal(ok(item), false, 'khôi phục dự án không mở phiếu do xoá việc');
});

test('C2 chuyển tiếp: khôi phục mở lại phiếu (PENDING, closedAt null) và ghi lịch sử việc; bỏ phiếu rút thật, việc đã rời Chờ duyệt, phiếu cũ hơn', async () => {
  const at = new Date('2026-11-20T03:00:00.000Z'), closedAt = new Date(at.getTime() + 30);
  const reqs = [
    { id: 11, workItemId: 1, status: 'CANCELLED', closedAt, actions: [{ decision: 'SUBMIT' }], workItem: { state: { category: 'REVIEW' } } }, // mở lại
    { id: 12, workItemId: 2, status: 'CANCELLED', closedAt, actions: [{ decision: 'SUBMIT' }], workItem: { state: { category: 'STARTED' } } }, // đã rời Chờ duyệt
    { id: 13, workItemId: 3, status: 'CANCELLED', closedAt, actions: [{ decision: 'SUBMIT' }, { decision: 'CANCEL', comment: 'Người gửi rút lại' }], workItem: { state: { category: 'REVIEW' } } },
    { id: 14, workItemId: 4, status: 'CANCELLED', closedAt, actions: [{ decision: 'SUBMIT' }], workItem: { state: { category: 'REVIEW' } } }, // có phiếu 15 mới hơn
  ];
  const updates = [], logs = [];
  let where = null;
  const tx = {
    approvalRequest: {
      findMany: async args => { if (args.include) { where = args.where; return reqs; } return [...reqs, { id: 15, workItemId: 4 }].filter(r => args.where.workItemId.in.includes(r.workItemId)); },
      update: async args => { updates.push(args); return args; },
    },
    activity: { findMany: async () => [], create: async ({ data }) => { logs.push(data); return data; } },
  };
  const n = await T.reopenTrashCancelled(tx, { itemWhere: { projectId: 7 }, trashedAt: at, by: 'PROJECT', actorId: 2 });
  assert.equal(n, 1);
  assert.deepEqual(updates, [{ where: { id: 11 }, data: { status: 'PENDING', closedAt: null } }]);
  assert.deepEqual(logs, [{ workItemId: 1, actorId: 2, type: 'APPROVAL_REOPENED', data: { requestId: 11, reason: 'PROJECT_RESTORED' } }]);
  assert.deepEqual(where.workItem, { projectId: 7 });
  assert.equal(where.status, 'CANCELLED');
  assert.ok(where.closedAt.gte <= at && where.closedAt.lte.getTime() - at.getTime() === T.TRASH_CANCEL_WINDOW_MS, 'chỉ tìm phiếu đóng sát lúc xoá');
  assert.equal(await T.reopenTrashCancelled(tx, { itemWhere: { projectId: 7 }, trashedAt: null, by: 'PROJECT', actorId: 2 }), 0);
});

// ---------- C4: khoá đổi nhóm cột còn việc ----------
test('C4: cột có sẵn đổi nhóm khi còn việc (kể cả việc trong Thùng rác) bị khoá; đổi tên / màu / WIP / thứ tự, cột trống, cột mới thì được', () => {
  const existing = [{ id: 1, name: 'Đang làm', category: 'STARTED', _count: { items: 3 } }, { id: 2, name: 'Tồn đọng', category: 'BACKLOG', _count: { items: 0 } },
    { id: 3, name: 'Hoàn thành', category: 'COMPLETED', _count: { items: 1 } }];
  assert.deepEqual(categoryLocks(existing, [{ id: 1, category: 'COMPLETED' }, { id: 2, category: 'UNSTARTED' }, { id: 3, category: 'COMPLETED' }]).map(e => e.name), ['Đang làm']);
  assert.deepEqual(categoryLocks(existing, [{ id: 1, category: 'OTHER' }]).map(e => e.name), ['Đang làm'], 'sang Cột tự do cũng khoá');
  assert.deepEqual(categoryLocks(existing, [{ id: 3, category: 'STARTED' }]).map(e => e.name), ['Hoàn thành'], 'mở ngược Hoàn thành → Đang làm cũng khoá');
  assert.deepEqual(categoryLocks(existing, [{ id: 3, category: 'COMPLETED' }, { id: 1, name: 'Đang triển khai', category: 'STARTED', wipLimit: 2 }, { id: 2, category: 'OTHER' }, { category: 'REVIEW' }]), []);
});

// ---------- #13: cấp "Người đứng tên dự án" không về tài khoản Quản trị hệ thống, không kẹt ----------
test('#13: cấp "Người đứng tên dự án" — Người đứng tên là Quản trị hệ thống / đã khoá / trống → Chủ dự án còn hoạt động duyệt thay, không còn ai → BTGĐ phụ trách', async () => {
  const step = { level: 1, name: 'Người đứng tên dự án duyệt', approverType: 'PROJECT_LEAD' };
  const users = [account(1, 'director', { boardAll: true, departmentId: 1 }), account(2, 'manager'), account(3, 'member'), account(4, 'member', { isActive: false }),
    account(90, 'admin', { isRootAdmin: true, departmentId: null }), account(91, 'admin', { departmentId: null })];
  const client = members => ({
    user: table(users), department: table([{ id: 10, supervisorId: null }]), delegation: table([]), approvalStep: table([]),
    projectMember: table(members.map(([userId, role]) => ({ projectId: 7, userId, role }))),
  });
  const project = leadId => ({ id: 7, departmentId: 10, leadId });
  const doer = { assignees: [{ userId: 3 }] };
  const ids = async (leadId, members, item = doer) => (await approval.approverIds(client(members), project(leadId), step, item)).sort((a, b) => a - b);
  assert.deepEqual(await ids(2, [[2, 'OWNER']]), [2], 'Người đứng tên hợp lệ');
  assert.deepEqual(await ids(90, [[90, 'OWNER'], [2, 'OWNER'], [91, 'OWNER'], [4, 'OWNER'], [3, 'MEMBER']]), [2], 'quản trị gốc đứng tên (dữ liệu cũ) → Chủ dự án còn làm việc');
  assert.deepEqual(await ids(91, [[3, 'OWNER'], [2, 'OWNER']]), [2], 'không về người chủ trì (3)');
  assert.deepEqual(await ids(4, [[2, 'OWNER']]), [2], 'Người đứng tên đã khoá');
  assert.deepEqual(await ids(null, [[2, 'OWNER']]), [2], 'để trống');
  assert.deepEqual(await ids(90, [[90, 'OWNER'], [3, 'OWNER']]), [1], 'không còn Chủ dự án duyệt được → BTGĐ phụ trách');
  // Ngữ cảnh nạp một lần (hàng chờ "Chờ tôi duyệt", "Tôi đã gửi", panel việc) cho cùng kết quả.
  const ctx = await approval.approvalContext(client([[90, 'OWNER'], [2, 'OWNER']]), [7]);
  assert.deepEqual(approval.approverIdsSync(ctx, project(90), step, doer), [2]);
  assert.ok(!approval.approverIdsSync(ctx, project(91), step, doer).includes(91));
});
