// KPI & phân tích thống kê: quyền (403 cho mọi người trừ Ban giám đốc) kiểm qua HTTP thật trên cả 2 endpoint,
// kiểm tra khoảng ngày, lọc phòng, chặn xuất qua token Claude, nội dung tệp Excel. Dữ liệu GIẢ.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const ExcelJS = require('exceljs');
const { ROLE_PROFILES } = require('../lib/permissions');
const mountAnalytics = require('./analytics');
const { assertAnalyticsAccess, workbook, rangeOf } = mountAnalytics;
const A = require('../services/analytics');

const DAY = 86_400_000;
const user = (role, extra = {}) => ({ id: 1, username: role, fullName: 'Người ' + role, role, departmentId: 2, permissions: ROLE_PROFILES[role], ...extra });
const status = u => { try { assertAnalyticsAccess(u); return 200; } catch (e) { return e.status; } };

test('assertAnalyticsAccess: Ban giám đốc qua; nhân viên, trưởng / phó phòng, admin IT, quản trị gốc, quyền phạm vi phòng → 403', () => {
  assert.equal(status(user('director')), 200);
  for (const role of ['member', 'manager', 'deputy', 'admin']) assert.equal(status(user(role)), 403, role);
  assert.equal(status(user('admin', { isRootAdmin: true })), 403);
  assert.equal(status(user('member', { permissions: [...ROLE_PROFILES.member, { permissionKey: 'reports.kpi', action: 'VIEW', scope: 'UNIT' }] })), 403);
  assert.equal(status(null), 403);
});

test('khoảng ngày: mặc định quý hiện tại; đến < từ, quá 400 ngày, sai định dạng → 422', () => {
  const now = new Date('2026-11-24T03:00:00Z');
  const def = rangeOf({}, now);
  assert.equal(def.from.toISOString(), '2026-09-30T17:00:00.000Z'); // 01/10/2026 00:00 giờ VN
  const r = rangeOf({ from: '2026-10-01', to: '2026-10-31' }, now);
  assert.equal(r.to.toISOString(), '2026-10-31T16:59:59.999Z');
  const code = q => { try { rangeOf(q, now); return 200; } catch (e) { return e.status; } };
  assert.equal(code({ from: '2026-10-31', to: '2026-10-01' }), 422);
  assert.equal(code({ from: '2025-01-01', to: '2026-10-01' }), 422);
  assert.equal(code({ from: 'abc' }), 422);
});

// ---------- HTTP thật: express + prisma giả ----------
const from = new Date('2026-10-01T00:00:00+07:00');
const at = d => new Date(from.getTime() + 2 * 3_600_000 + d * DAY);
const ITEMS = [
  { id: 1, projectId: 9, number: 1, title: '=HYPERLINK("http://x")', leadDepartmentId: 1, dueDate: at(5), assignedAt: at(0), createdAt: at(0), startedAt: at(1), completedAt: at(3),
    rating: 'GOOD', ratedAt: at(4), state: { category: 'COMPLETED' }, project: { key: 'DA', name: 'Dự án mẫu', departmentId: 1 }, assignees: [{ userId: 11 }],
    approvals: [{ status: 'APPROVED', closedAt: at(4), actions: [{ decision: 'APPROVE' }] }] },
  { id: 2, projectId: 9, number: 2, title: 'Việc phòng B', leadDepartmentId: 2, dueDate: null, assignedAt: at(0), createdAt: at(0), startedAt: null, completedAt: at(6),
    rating: null, ratedAt: null, state: { category: 'COMPLETED' }, project: { key: 'DA', name: 'Dự án mẫu', departmentId: 1 }, assignees: [{ userId: 12 }], approvals: [] },
];
const fakePrisma = {
  workItem: { findMany: async () => ITEMS.map(i => ({ ...i })) },
  user: { findMany: async ({ where }) => [{ id: 11, fullName: 'An (giả)', department: { id: 1, name: 'Phòng A' } }, { id: 12, fullName: 'Bình (giả)', department: { id: 2, name: 'Phòng B' } }]
    .filter(u => where.id.in.includes(u.id)) },
  department: { findMany: async () => [{ id: 1, name: 'Phòng A' }, { id: 2, name: 'Phòng B' }] },
};
async function server() {
  const audits = [];
  const app = express();
  const ROLES = { giamdoc: user('director'), nv: user('member'), tp: user('manager'), pp: user('deputy'), admin: user('admin'), root: user('admin', { isRootAdmin: true }) };
  const auth = (req, res, next) => { req.user = ROLES[req.get('x-user')]; if (!req.user) return res.status(401).end(); if (req.get('x-via')) req.via = 'claude'; next(); };
  mountAnalytics(app, { prisma: fakePrisma, auth, audit: async (req, action, ...rest) => audits.push([req.user.username, action, rest[3]]) });
  app.use((err, req, res, next) => res.status(err.status || 500).json({ code: err.code, error: err.message })); // eslint-disable-line no-unused-vars
  const srv = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { audits, close: () => new Promise(r => srv.close(r)), get: (path, who, headers = {}) => fetch(base + path, { headers: { 'x-user': who, ...headers } }) };
}

test('HTTP: mọi tài khoản không phải Ban giám đốc nhận 403 ở CẢ HAI endpoint, không ghi nhật ký xem / xuất', async () => {
  const s = await server();
  try {
    for (const who of ['nv', 'tp', 'pp', 'admin', 'root']) for (const path of ['/api/kpi/analytics', '/api/kpi/analytics.xlsx']) {
      const res = await s.get(path + '?from=2026-10-01&to=2026-10-31', who);
      assert.equal(res.status, 403, `${who} ${path}`);
      assert.equal((await res.json()).code, 'FORBIDDEN');
    }
    assert.equal(s.audits.length, 0);
  } finally { await s.close(); }
});

test('HTTP: Ban giám đốc xem JSON (no-store, có nhật ký), lọc phòng, 422 khi khoảng ngày sai', async () => {
  const s = await server();
  try {
    const res = await s.get('/api/kpi/analytics?from=2026-10-01&to=2026-10-31', 'giamdoc');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const body = await res.json();
    assert.equal(body.overall.completed, 2);
    assert.deepEqual([body.overall.workDays.n, body.overall.noStart], [1, 1]);
    assert.equal(body.details.length, 2);
    assert.deepEqual(s.audits[0].slice(0, 2), ['director', 'VIEW_KPI_ANALYTICS']);

    const b = await (await s.get('/api/kpi/analytics?from=2026-10-01&to=2026-10-31&departmentId=2', 'giamdoc')).json();
    assert.equal(b.overall.completed, 1);
    assert.deepEqual(b.byDepartment.map(d => d.name), ['Phòng B']);
    assert.deepEqual(b.byPerson.map(p => p.fullName), ['Bình (giả)']);
    assert.deepEqual(b.details.map(d => d.code), ['DA-2']);

    assert.equal((await s.get('/api/kpi/analytics?from=2026-10-31&to=2026-10-01', 'giamdoc')).status, 422);
    assert.equal((await s.get('/api/kpi/analytics?departmentId=abc', 'giamdoc')).status, 422);
  } finally { await s.close(); }
});

test('HTTP: Ban giám đốc tải Excel; qua token Claude bị chặn 403', async () => {
  const s = await server();
  try {
    const res = await s.get('/api/kpi/analytics.xlsx?from=2026-10-01&to=2026-10-31', 'giamdoc');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /phan-tich-kpi_2026-10-01_2026-10-31\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
    assert.ok(wb.getWorksheet('Chi tiết việc'));
    assert.deepEqual(s.audits.map(a => a[1]), ['EXPORT_KPI_ANALYTICS']);

    const via = await s.get('/api/kpi/analytics.xlsx', 'giamdoc', { 'x-via': '1' });
    assert.equal(via.status, 403);
    assert.equal((await via.json()).code, 'NOT_VIA_AI');
  } finally { await s.close(); }
});

test('tệp Excel: đủ các trang; chi tiết từng việc ghi chuỗi (không công thức); TB + trung vị; không đánh giá chung khi < 5 việc được chấm', async () => {
  const to = new Date('2026-10-31T23:59:59.999+07:00');
  const r = { ...A.analyze(ITEMS, { from, to, users: [{ id: 11, fullName: 'An (giả)', departmentId: 1, departmentName: 'Phòng A' }, { id: 12, fullName: 'Bình (giả)', departmentId: 2, departmentName: 'Phòng B' }],
    departments: [{ id: 1, name: 'Phòng A' }, { id: 2, name: 'Phòng B' }] }), generatedAt: new Date('2026-11-01T02:00:00Z') };
  const wb = await workbook(r, { username: 'giamdoc', fullName: 'Giám đốc' });
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Tóm tắt', 'Theo người', 'Theo phòng', 'Xu hướng', 'Bất thường', 'Chi tiết việc']);
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(await wb.xlsx.writeBuffer());

  const people = back.getWorksheet('Theo người');
  const head = people.getRow(1).values.slice(1);
  const col = name => head.indexOf(name) + 1;
  assert.ok(col('Thời gian làm — TB (ngày)') && col('Thời gian làm — trung vị (ngày)') && col('Giao → được duyệt — TB (ngày)') && col('Giao → được duyệt — trung vị (ngày)'));
  assert.equal(people.getRow(2).getCell(2).value, 'An (giả)');
  assert.equal(people.getRow(2).getCell(col('Thời gian làm — TB (ngày)')).value, 2);
  assert.equal(people.getRow(2).getCell(col('Đánh giá chung')).value, '—'); // 1 việc được chấm → không kết luận
  assert.equal(people.getRow(2).getCell(col('Tốt')).value, 1);
  assert.match(String(people.getRow(people.rowCount).getCell(1).value), /Xuất bởi Giám đốc .* Bảo mật/);

  const detail = back.getWorksheet('Chi tiết việc');
  const d = detail.getRow(2);
  assert.equal(d.getCell(1).value, 'DA-1');
  assert.equal(d.getCell(2).value, '=HYPERLINK("http://x")'); // tiêu đề giống công thức vẫn là chuỗi
  assert.equal(d.getCell(2).type, ExcelJS.ValueType.String);
  assert.deepEqual([d.getCell(3).value, d.getCell(4).value, d.getCell(5).value], ['Dự án mẫu', 'Phòng A', 'An (giả)']);
  assert.deepEqual([d.getCell(6).value, d.getCell(7).value, d.getCell(8).value, d.getCell(9).value], ['01/10/2026', '02/10/2026', '04/10/2026', '05/10/2026']);
  assert.deepEqual([d.getCell(10).value, d.getCell(11).value, d.getCell(12).value, d.getCell(13).value, d.getCell(14).value], [2, 4, 'Có', 0, 'Tốt (Tốt)']);
  const e = detail.getRow(3);
  assert.deepEqual([e.getCell(7).value, e.getCell(10).value, e.getCell(11).value, e.getCell(12).value], ['không ghi nhận', '', 6, 'Không có hạn']);
  assert.ok(back.getWorksheet('Tóm tắt').getColumn(2).values.some(v => String(v).includes('chưa đánh giá chung')));
});
