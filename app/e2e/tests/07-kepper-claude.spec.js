// Kepper GĐ3 — AI native: Claude (Claude Desktop + MCP trên máy người dùng) dùng ĐÚNG quyền tài khoản Kepper qua token cá nhân.
// Giao diện "Kết nối Claude": tạo token (hiện một lần), thu hồi; token chỉ làm được thao tác thường ngày, không nộp / duyệt / xoá / xuất.
const { test, expect } = require('@playwright/test');
const { login, apiAs, toast } = require('./helpers');

test('21. Kết nối Claude: token cá nhân đúng quyền người dùng, thao tác cần người quyết định bị chặn, thu hồi ngay', async ({ browser, request }) => {
  const nv = await (await browser.newContext()).newPage();
  await login(nv, 'nv.phaply');
  await nv.goto('/#/claude');
  await nv.getByTestId('claude-token-name').fill('Máy văn phòng (giả)');
  await nv.getByTestId('claude-token-create').click();
  await expect(nv.getByTestId('claude-token-value')).toHaveValue(/^kpt_/);
  const token = await nv.getByTestId('claude-token-value').inputValue();
  await expect(nv.getByTestId('claude-tokens')).toContainText('Máy văn phòng (giả)');
  const T = (path, method = 'GET', data) => request.fetch(path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, data });

  // Đọc theo quyền của chính người dùng: thấy việc của mình, không thấy tổng hợp giao ban (nhân viên).
  expect((await T('/api/me')).status()).toBe(200);
  expect((await T('/api/my/items')).status()).toBe(200);
  expect((await T('/api/weekly/summary')).status()).toBe(403);
  // Thao tác thường ngày được: nhắc việc cá nhân.
  expect((await T('/api/me/notes', 'POST', { title: 'Nhắc (giả) qua Claude', dueDate: '2026-12-01' })).status()).toBe(201);
  // Cần người quyết định / xuất / quản trị: chặn.
  for (const [p, m] of [['/api/weekly/submit', 'POST'], ['/api/me/tokens', 'POST'], ['/api/projects', 'POST'], ['/api/admin/users', 'GET']])
    expect((await T(p, m, {})).status(), `${m} ${p}`).toBe(403);
  const projects = await (await T('/api/projects')).json();
  expect((await T(`/api/projects/${projects[0].id}/export.xlsx`)).status()).toBe(403);
  // Biến thể đường dẫn (Express 5 không phân biệt hoa thường, bỏ "/" cuối) cũng bị chặn.
  for (const p of [`/api/projects/${projects[0].id}/export.xlsx/`, `/api/projects/${projects[0].id}/export.XLSX`, '/api/stream/', '/API/me/tokens'])
    expect((await T(p)).status(), p).toBe(403);
  // Nhật ký đánh dấu thao tác qua Claude.
  const admin = await (await browser.newContext()).newPage();
  await login(admin, 'admin');
  await admin.goto('/#/admin/tokens');
  await expect(admin.getByTestId('admin-tokens')).toContainText('Máy văn phòng (giả)');

  // Thu hồi → hết hiệu lực ngay.
  await nv.goto('/#/claude');
  await nv.locator('[data-revoke]').first().click();
  await nv.getByTestId('confirm-ok').click();
  await toast(nv, 'Đã thu hồi');
  expect((await T('/api/me')).status()).toBe(401);
});
