// MA TRẬN QUYỀN THEO MỘT TRỤC VAI — HTTP trên server thật (dữ liệu GIẢ của seed). Bảng 5.4 trong
// docs/de-xuat-mot-he-quy-chieu-phan-quyen.md; ma trận hàm quyền đầy đủ: server/src/lib/role-matrix.test.js.
// Vai: giamdoc = Ban Tổng Giám đốc (phụ trách Toàn công ty) · tp.kinhdoanh = Lãnh đạo bộ phận · nv.kinhdoanh1 = Nhân viên ·
// admin = Quản trị hệ thống (quản trị gốc).
const { test, expect } = require('@playwright/test');
const { login, apiAs } = require('./helpers');

test.describe.configure({ mode: 'serial' });

const ROLES = { giamdoc: 'Ban Tổng Giám đốc', 'tp.kinhdoanh': 'Lãnh đạo bộ phận', 'nv.kinhdoanh1': 'Nhân viên', admin: 'Quản trị hệ thống' };
const WHO = Object.keys(ROLES);
const pages = {};
let users = [];
const U = name => users.find(u => u.username === name);

test('chuẩn bị: đăng nhập từng vai', async ({ browser }) => {
  for (const name of WHO) {
    pages[name] = await (await browser.newContext()).newPage();
    await login(pages[name], name);
  }
  users = await (await apiAs(pages.giamdoc, '/api/users/directory')).json();
});

// Mỗi dòng: endpoint → mã trả về mong đợi theo vai.
const MATRIX = [
  { label: 'KPI & phân tích (theo bộ phận / người)', url: () => '/api/kpi', expect: { giamdoc: 200, 'tp.kinhdoanh': 403, 'nv.kinhdoanh1': 403, admin: 403 } },
  { label: 'KPI & phân tích thống kê', url: () => '/api/kpi/analytics?from=2026-01-01&to=2026-12-31', expect: { giamdoc: 200, 'tp.kinhdoanh': 403, 'nv.kinhdoanh1': 403, admin: 403 } },
  { label: 'KPI của chính mình', url: () => '/api/kpi/me', expect: { giamdoc: 200, 'tp.kinhdoanh': 200, 'nv.kinhdoanh1': 200, admin: 403 } },
  { label: 'Quản trị: danh sách tài khoản', url: () => '/api/admin/users', expect: { giamdoc: 403, 'tp.kinhdoanh': 403, 'nv.kinhdoanh1': 403, admin: 200 } },
  { label: 'Quản trị: nhật ký hệ thống', url: () => '/api/admin/audit', expect: { giamdoc: 403, 'tp.kinhdoanh': 403, 'nv.kinhdoanh1': 403, admin: 200 } },
  { label: 'Quyền của vai (chỉ xem)', url: () => `/api/admin/users/${U('nv.kinhdoanh1').id}/permissions`, expect: { giamdoc: 403, 'tp.kinhdoanh': 403, 'nv.kinhdoanh1': 403, admin: 200 } },
  { label: 'Chỉnh quyền từng người: đã bỏ (410 với quản trị)', method: 'PUT', data: { grants: [] }, url: () => `/api/admin/users/${U('nv.kinhdoanh1').id}/permissions`,
    expect: { giamdoc: 403, 'tp.kinhdoanh': 403, 'nv.kinhdoanh1': 403, admin: 410 } },
  { label: 'Phạm vi phụ trách: chỉ cho tài khoản vai BTGĐ', method: 'PUT', data: { all: true, departmentIds: [] }, url: () => `/api/admin/users/${U('tp.kinhdoanh').id}/scope`,
    expect: { giamdoc: 403, 'tp.kinhdoanh': 403, 'nv.kinhdoanh1': 403, admin: 422 } },
  { label: 'Tài liệu dự án: danh sách', url: () => '/api/documents/projects', expect: { giamdoc: 200, 'tp.kinhdoanh': 200, 'nv.kinhdoanh1': 200, admin: [403, 404] } },
];

for (const row of MATRIX) {
  test(`ma trận: ${row.label}`, async () => {
    const got = {};
    for (const name of WHO) got[name] = (await apiAs(pages[name], row.url(), row.method ? { method: row.method, data: row.data } : undefined)).status();
    for (const name of WHO) {
      const want = row.expect[name];
      if (Array.isArray(want)) expect(want, `${row.label} — ${name}`).toContain(got[name]);
      else expect(got[name], `${row.label} — ${name}`).toBe(want);
    }
  });
}

test('vai hiện đúng một tên trên hồ sơ; quản trị không thấy dự án', async () => {
  for (const name of WHO) {
    const p = await (await apiAs(pages[name], '/api/me/profile')).json();
    expect(p.roleLabel, name).toBe(ROLES[name]);
  }
  const projects = name => apiAs(pages[name], '/api/projects').then(r => r.json());
  expect(await projects('admin')).toEqual([]);
  const all = await projects('giamdoc'), staff = await projects('nv.kinhdoanh1');
  expect(all.length).toBeGreaterThanOrEqual(staff.length);
  // Tài liệu dự án: BTGĐ thấy mọi dự án; nhân viên chỉ dự án mình là thành viên.
  const docs = name => apiAs(pages[name], '/api/documents/projects').then(r => r.json());
  const [dAll, dStaff] = [await docs('giamdoc'), await docs('nv.kinhdoanh1')];
  expect(dAll.length).toBeGreaterThanOrEqual(dStaff.length);
});

test('quản trị: vai BTGĐ ngoài bộ phận Ban Tổng Giám đốc phải xác nhận; đổi vai ghi nhật ký; bỏ vai BTGĐ thì bỏ phạm vi phụ trách', async () => {
  const admin = pages.admin;
  const depts = await (await apiAs(admin, '/api/departments')).json();
  const D = code => depts.find(d => d.code === code);
  const base = { username: 'btgd.lech', fullName: 'Lệch bộ phận (giả)', role: 'director', departmentId: D('KD').id };
  const r1 = await apiAs(admin, '/api/admin/users', { method: 'POST', data: base });
  expect(r1.status()).toBe(422);
  expect((await r1.json()).code).toBe('BOARD_DEPT_MISMATCH');
  const r2 = await apiAs(admin, '/api/admin/users', { method: 'POST', data: { ...base, confirmBoardDept: true } });
  expect(r2.status()).toBe(201);
  const id = (await r2.json()).id;
  const list = await (await apiAs(admin, '/api/admin/users')).json();
  expect(list.find(u => u.id === id).boardMismatch).toMatch(/không thuộc bộ phận Ban Tổng Giám đốc/);
  // Đặt phạm vi phụ trách (Kinh doanh) rồi đổi vai về Nhân viên → phạm vi bị bỏ, có nhật ký.
  expect((await apiAs(admin, `/api/admin/users/${id}/scope`, { method: 'PUT', data: { all: false, departmentIds: [D('KT').id] } })).status()).toBe(200);
  expect((await apiAs(admin, `/api/admin/users/${id}`, { method: 'PUT', data: { role: 'member' } })).status()).toBe(200);
  const after = (await (await apiAs(admin, '/api/admin/users')).json()).find(u => u.id === id);
  expect(after.supervisedDepartmentIds).toEqual([]);
  expect(after.boardMismatch).toBeNull();
  const audit = JSON.stringify(await (await apiAs(admin, '/api/admin/audit?action=BOARD_SCOPE_UPDATE')).json());
  expect(audit).toContain('ROLE_CHANGE');
  // Bộ phận không tự chọn Phó TGĐ phụ trách nữa (nhập ở tài khoản).
  const giamdoc = U('giamdoc');
  expect((await apiAs(admin, `/api/departments/${D('KT').id}`, { method: 'PUT', data: { supervisorId: giamdoc.id } })).status()).toBe(422);
});

test('giao diện Quản trị: cột Vai / Bộ phận / Phụ trách; quyền chỉ xem; BTGĐ có phạm vi phụ trách', async () => {
  const admin = pages.admin;
  await admin.goto('/#/admin/users');
  await admin.reload();
  const table = admin.getByTestId('users-table');
  await expect(table.locator('thead')).toContainText('Vai');
  await expect(table.locator('thead')).toContainText('Phụ trách');
  await expect(admin.getByTestId('user-giamdoc').getByTestId('board-all-pill')).toBeVisible();
  await expect(admin.getByTestId('user-tp.kinhdoanh')).toContainText('Lãnh đạo bộ phận');
  await admin.getByTestId('perm-giamdoc').click();
  await expect(admin.getByTestId('perm-board-all')).toBeChecked();
  await expect(admin.getByTestId('grant-reports.kpi-VIEW')).toHaveText('Toàn công ty');
  await expect(admin.locator('select[data-key]')).toHaveCount(0); // không còn ô chỉnh quyền từng người
});
