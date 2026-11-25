// Đề nghị gia hạn chạy qua đúng route thật (routes/dispatch.js, routes/approvals.js, services/task-access.js) trên CSDL GIẢ trong bộ nhớ:
// ai nhận thông báo, ai quyết được, hàng chờ "Chờ tôi duyệt → Đề nghị gia hạn" và số đỏ — nhất là khi thiếu phạm vi phụ trách
// (chưa ai phụ trách Toàn công ty, Phó TGĐ phụ trách đã khoá / chưa có). Tài khoản, bộ phận, việc đều GIẢ.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mountDispatch = require('./dispatch');
const mountApprovals = require('./approvals');

// Lọc theo điều kiện Prisma — đủ cho các truy vấn của các route này: so bằng, in / notIn / not, OR / AND, quan hệ lồng (workItem, project).
function match(row, where = {}) {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return v.some(w => match(row, w));
    if (k === 'AND') return v.every(w => match(row, w));
    const x = row[k] ?? null;
    if (v === null || typeof v !== 'object' || v instanceof Date) return x === v;
    if ('in' in v || 'notIn' in v || 'not' in v) return (!('in' in v) || v.in.includes(x)) && (!('notIn' in v) || !v.notIn.includes(x)) && (!('not' in v) || x !== v.not);
    return x !== null && typeof x === 'object' && match(x, v);
  });
}

// CSDL giả: người dùng, bộ phận, một dự án, các việc; ghi lại đề nghị gia hạn và thông báo.
function world({ users, depts, project, items }) {
  const byId = new Map(items.map(i => [i.id, { ...i }]));
  const state = { extensions: [], notifications: [] };
  const withItem = x => ({ ...x, workItem: { ...byId.get(x.workItemId), project } });
  const db = {
    $transaction: async fn => fn(db),
    $executeRaw: async () => 0,
    user: {
      findMany: async ({ where } = {}) => users.filter(u => match(u, where)),
      findUnique: async ({ where }) => users.find(u => u.id === where.id) || null,
      findFirst: async ({ where } = {}) => users.find(u => match(u, where)) || null,
    },
    department: {
      findMany: async ({ where } = {}) => depts.filter(d => match(d, where)),
      findUnique: async ({ where }) => depts.find(d => d.id === where.id) || null,
    },
    delegation: { findMany: async () => [], findFirst: async () => null },
    project: { findUnique: async ({ where }) => (where.id === project.id ? project : null) },
    projectMember: { findUnique: async () => null },
    approvalAction: { count: async () => 0 },
    approvalRequest: { findFirst: async () => null, findMany: async () => [] },
    approvalStep: { findMany: async () => [] },
    progressReport: { count: async () => 0, findMany: async () => [] },
    workItem: {
      findUnique: async ({ where }) => (byId.has(where.id) ? { ...byId.get(where.id), project } : null),
      update: async ({ where, data }) => Object.assign(byId.get(where.id), data),
    },
    dueExtension: {
      count: async ({ where }) => state.extensions.filter(x => match(x, where)).length,
      create: async ({ data }) => { const x = { id: state.extensions.length + 1, status: 'PENDING', createdAt: new Date(Date.UTC(2026, 10, 1) + state.extensions.length), ...data }; state.extensions.push(x); return x; },
      findUnique: async ({ where }) => state.extensions.find(x => x.id === where.id) || null,
      update: async ({ where, data }) => Object.assign(state.extensions.find(x => x.id === where.id), data),
      findMany: async ({ where, take = 1000 }) => state.extensions.map(withItem).filter(x => match(x, where)).sort((a, b) => a.createdAt - b.createdAt).slice(0, take),
    },
    activity: { create: async ({ data }) => data },
    notification: { createMany: async ({ data }) => { state.notifications.push(...data); return { count: data.length }; } },
  };
  return { db, state, items: byId };
}

async function serve(db, users) {
  const app = express();
  app.use(express.json());
  const auth = (req, res, next) => { req.user = users.find(u => u.id === Number(req.headers['x-user'])); next(); };
  const ctx = { prisma: db, auth, audit: async () => {}, config: {} };
  mountDispatch(app, ctx);
  mountApprovals(app, ctx);
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message, code: error.code }));
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (who, method, path, body) => fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-user': String(who) }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
  return { call, close: () => server.close() };
}

// ---------- Dữ liệu GIẢ ----------
// Bộ phận: 1 Ban Tổng Giám đốc, 50 bộ phận chủ trì (Phó TGĐ phụ trách là người 2 — đã khoá), 60 bộ phận của người giao,
// 70 (tên người phụ trách lỡ là tài khoản quản trị hệ thống), 80 (Phó TGĐ phụ trách là người 4, đang hoạt động).
const U = (id, role, extra = {}) => ({ id, role, fullName: `Người ${id} (giả)`, isRootAdmin: false, isActive: true, departmentId: 1, boardAll: false, sessionVersion: 0, ...extra });
const USERS = [
  U(1, 'director'), // TGĐ, chưa đánh dấu Toàn công ty
  U(2, 'director', { isActive: false }), // Phó TGĐ phụ trách bộ phận 50, đã khoá (khoá không bàn giao)
  U(4, 'director'), // Phó TGĐ phụ trách bộ phận 80
  U(5, 'director'), // Phó TGĐ chưa phụ trách bộ phận nào
  U(12, 'admin', { departmentId: null, boardAll: true }), // quản trị hệ thống
  U(20, 'manager', { departmentId: 50 }), // lãnh đạo bộ phận 50
  U(30, 'member', { departmentId: 60 }), // người giao
  U(40, 'member', { departmentId: 50 }), // người chủ trì
];
const DEPTS = [{ id: 1, supervisorId: null }, { id: 50, supervisorId: 2 }, { id: 60, supervisorId: null }, { id: 70, supervisorId: 12 }, { id: 80, supervisorId: 4 }];
const PROJECT = { id: 5, key: 'DA', name: 'Dự án mẫu (giả)', kind: 'KANBAN', visibility: 'PUBLIC', departmentId: 50, leadId: null, archivedAt: null, deletedAt: null };
const item = (id, extra = {}) => ({ id, projectId: 5, parentId: null, number: id, title: `Việc ${id} (giả)`, assignedById: 30, reporterId: 30, leadDepartmentId: 50,
  dispatchStatus: null, archivedAt: null, dueDate: new Date('2026-12-01T00:00:00Z'), originalDueDate: null, state: { category: 'STARTED' },
  assignees: [{ userId: 40 }], supporters: [], supportDepartments: [], ...extra });
const REQUEST = { newDue: '2026-12-15T00:00:00.000Z', reason: 'Chờ hồ sơ đối tác (giả)' };

async function scenario({ users = USERS, items }) {
  const w = world({ users, depts: DEPTS, project: PROJECT, items });
  return { ...w, ...(await serve(w.db, users)) };
}
const recipients = state => [...new Set(state.notifications.filter(n => n.type === 'EXTENSION_REQUESTED').map(n => n.userId))].sort((a, b) => a - b);
// Hàng chờ "Đề nghị gia hạn" của một người: [mã việc, có nút quyết định]; kèm số đỏ (chỉ đếm đề nghị quyết được).
async function queueOf(t, who) {
  const list = await t.call(who, 'GET', '/api/approvals/extensions');
  const counts = await t.call(who, 'GET', '/api/approvals/counts');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  return { rows: list.body.map(x => [x.item.code, x.canDecide]), badge: counts.body.extensions };
}

test('chưa ai phụ trách Toàn công ty, Phó TGĐ phụ trách bộ phận chủ trì đã khoá: mọi thành viên BTGĐ đang hoạt động nhận và quyết được', async () => {
  const t = await scenario({ items: [item(100)] });
  try {
    const sent = await t.call(40, 'POST', '/api/items/100/extensions', REQUEST);
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    // Thành viên BTGĐ đang hoạt động (1, 4, 5) + người giao (30). Không: Phó TGĐ đã khoá (2), quản trị hệ thống (12), lãnh đạo bộ phận (20).
    assert.deepEqual(recipients(t.state), [1, 4, 5, 30]);
    // Hàng chờ + số đỏ: thành viên BTGĐ có nút; người giao, lãnh đạo bộ phận chủ trì thấy để nắm, không có nút, không tính số đỏ.
    for (const who of [1, 4, 5]) assert.deepEqual(await queueOf(t, who), { rows: [['DA-100', true]], badge: 1 }, `người ${who}`);
    for (const who of [20, 30]) assert.deepEqual(await queueOf(t, who), { rows: [['DA-100', false]], badge: 0 }, `người ${who}`);
    // Lãnh đạo bộ phận chủ trì, người giao, quản trị hệ thống: không quyết được.
    const lead = await t.call(20, 'POST', `/api/extensions/${sent.body.id}/decide`, { decision: 'APPROVE' });
    assert.equal(lead.status, 403);
    assert.match(lead.body.error, /việc chưa có BTGĐ phụ trách thì thành viên Ban Tổng Giám đốc nào cũng duyệt được/);
    assert.equal((await t.call(30, 'POST', `/api/extensions/${sent.body.id}/decide`, { decision: 'APPROVE' })).status, 403);
    assert.ok([403, 404].includes((await t.call(12, 'POST', `/api/extensions/${sent.body.id}/decide`, { decision: 'APPROVE' })).status));
    assert.equal(t.state.extensions[0].status, 'PENDING');
    // Thành viên BTGĐ (chưa phụ trách bộ phận nào) quyết: hạn đổi, người đề nghị được báo.
    const ok = await t.call(5, 'POST', `/api/extensions/${sent.body.id}/decide`, { decision: 'APPROVE' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(t.state.extensions[0].status, 'APPROVED');
    assert.equal(t.items.get(100).dueDate.toISOString(), REQUEST.newDue);
    assert.ok(t.state.notifications.some(n => n.type === 'EXTENSION_APPROVE' && n.userId === 40));
  } finally { t.close(); }
});

test('có người phụ trách: người phụ trách Toàn công ty và Phó TGĐ phụ trách bộ phận chủ trì nhận; thành viên BTGĐ khác không nhận, không quyết', async () => {
  const users = USERS.map(u => (u.id === 1 ? { ...u, boardAll: true } : u));
  const t = await scenario({ users, items: [item(100, { leadDepartmentId: 80 })] });
  try {
    const sent = await t.call(40, 'POST', '/api/items/100/extensions', REQUEST);
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.deepEqual(recipients(t.state), [1, 4, 30]);
    assert.deepEqual(await queueOf(t, 5), { rows: [], badge: 0 });
    assert.deepEqual(await queueOf(t, 4), { rows: [['DA-100', true]], badge: 1 });
    assert.equal((await t.call(5, 'POST', `/api/extensions/${sent.body.id}/decide`, { decision: 'APPROVE' })).status, 403);
    const no = await t.call(1, 'POST', `/api/extensions/${sent.body.id}/decide`, { decision: 'REJECT', note: 'Chưa đủ căn cứ (giả)' });
    assert.equal(no.status, 200, JSON.stringify(no.body));
    assert.equal(t.state.extensions[0].status, 'REJECTED');
    assert.equal(t.items.get(100).dueDate.toISOString(), '2026-12-01T00:00:00.000Z');
  } finally { t.close(); }
});

test('việc nhánh không ghi bộ phận chủ trì: Phó TGĐ phụ trách bộ phận của việc cha nhận, thấy ở hàng chờ và quyết', async () => {
  const t = await scenario({ items: [item(100, { leadDepartmentId: 80 }), item(101, { leadDepartmentId: null, parentId: 100 })] });
  try {
    const sent = await t.call(40, 'POST', '/api/items/101/extensions', REQUEST);
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.deepEqual(recipients(t.state), [4, 30]);
    assert.deepEqual(await queueOf(t, 4), { rows: [['DA-101', true]], badge: 1 });
    for (const who of [1, 5]) assert.deepEqual(await queueOf(t, who), { rows: [], badge: 0 }, `người ${who}`);
    assert.equal((await t.call(5, 'POST', `/api/extensions/${sent.body.id}/decide`, { decision: 'APPROVE' })).status, 403);
    assert.equal((await t.call(4, 'POST', `/api/extensions/${sent.body.id}/decide`, { decision: 'APPROVE' })).status, 200);
  } finally { t.close(); }
});

test('không báo chính người gửi, người gửi không tự quyết; quản trị hệ thống đứng tên phụ trách bộ phận vẫn không nhận', async () => {
  // Thành viên BTGĐ (5) chủ trì việc của bộ phận 70 — "người phụ trách" bộ phận 70 lỡ là tài khoản quản trị hệ thống.
  const t = await scenario({ items: [item(100, { leadDepartmentId: 70, assignees: [{ userId: 5 }] })] });
  try {
    const sent = await t.call(5, 'POST', '/api/items/100/extensions', REQUEST);
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.deepEqual(recipients(t.state), [1, 4, 30]);
    assert.deepEqual(await queueOf(t, 5), { rows: [], badge: 0 });
    const self = await t.call(5, 'POST', `/api/extensions/${sent.body.id}/decide`, { decision: 'APPROVE' });
    assert.equal(self.status, 403);
    assert.equal(self.body.code, 'SELF_APPROVAL');
    assert.equal((await t.call(4, 'POST', `/api/extensions/${sent.body.id}/decide`, { decision: 'APPROVE' })).status, 200);
  } finally { t.close(); }
});
