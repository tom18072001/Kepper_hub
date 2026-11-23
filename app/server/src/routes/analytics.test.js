// Quyền xem / xuất KPI & phân tích thống kê: chỉ Ban giám đốc (reports.kpi toàn tổ chức); còn lại 403.
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { ROLE_PROFILES } = require('../lib/permissions');
const { assertAnalyticsAccess, workbook } = require('./analytics');
const A = require('../services/analytics');

const user = (role, extra = {}) => ({ id: 1, username: role, role, departmentId: 2, permissions: ROLE_PROFILES[role], ...extra });
const status = u => { try { assertAnalyticsAccess(u); return 200; } catch (e) { return e.status; } };

test('KPI & phân tích: Ban giám đốc xem được; nhân viên, trưởng / phó phòng, admin IT, quản trị gốc bị 403', () => {
  assert.equal(status(user('director')), 200);
  for (const role of ['member', 'manager', 'deputy', 'admin']) assert.equal(status(user(role)), 403, role);
  assert.equal(status(user('admin', { isRootAdmin: true })), 403, 'quản trị gốc vẫn không xem nội dung nghiệp vụ');
  // Nhân viên được cấp reports.kpi phạm vi phòng (không hợp lệ) vẫn bị chặn.
  assert.equal(status(user('member', { permissions: [...ROLE_PROFILES.member, { permissionKey: 'reports.kpi', action: 'VIEW', scope: 'UNIT' }] })), 403);
  assert.equal(status(null), 403);
});

test('tệp Excel: đủ các trang, có dấu người xuất và nhãn Bảo mật', async () => {
  const from = new Date('2026-10-01T00:00:00+07:00'), to = new Date('2026-10-31T23:59:59.999+07:00');
  const items = [{ id: 1, number: 1, title: 'Việc 1', project: { key: 'DA', departmentId: 1 }, state: { category: 'COMPLETED' }, assignedAt: from,
    createdAt: from, startedAt: from, completedAt: new Date(from.getTime() + 2 * 86_400_000), rating: 'GOOD', ratedAt: new Date(from.getTime() + 3 * 86_400_000), assignees: [{ userId: 1 }], approvals: [] }];
  const r = { ...A.analyze(items, { from, to, users: [{ id: 1, fullName: 'An', departmentId: 1, departmentName: 'Phòng A' }], departments: [{ id: 1, name: 'Phòng A' }] }), generatedAt: new Date('2026-11-01T02:00:00Z') };
  const wb = await workbook(r, { username: 'giamdoc', fullName: 'Giám đốc' });
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Tóm tắt', 'Theo người', 'Theo phòng', 'Xu hướng', 'Bất thường']);
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(await wb.xlsx.writeBuffer());
  const people = back.getWorksheet('Theo người');
  assert.equal(people.getRow(2).getCell(2).value, 'An');
  assert.equal(people.getRow(2).getCell(16).value, 'Tốt');
  assert.match(String(people.getRow(people.rowCount).getCell(1).value), /Xuất bởi Giám đốc .* Bảo mật/);
  const summary = back.getWorksheet('Tóm tắt');
  assert.ok(summary.getColumn(2).values.some(v => String(v).includes('Bảo mật')));
});
