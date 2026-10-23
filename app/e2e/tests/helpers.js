const { expect } = require('@playwright/test');

const DEFAULT_PASSWORD = '12345678';
const NEW_PASSWORD = 'Moi@2026';
const changed = new Set(['admin']); // tài khoản đã đổi mật khẩu trong lượt chạy này
const passwordOf = user => user === 'admin' ? 'Admin@2026' : changed.has(user) ? NEW_PASSWORD : DEFAULT_PASSWORD;

// Đăng nhập qua giao diện; nếu bị buộc đổi mật khẩu thì đổi rồi vào ứng dụng.
async function login(page, username) {
  await page.goto('/');
  const pw = page.locator('#passwordPage:not(.hidden)'), app = page.locator('#appShell:not(.hidden)'), err = page.locator('#loginError:not(:empty)');
  // Sau khi một test hỏng, Playwright khởi động lại worker và mất danh sách tài khoản đã đổi mật khẩu → thử cả mật khẩu mới.
  for (const password of [...new Set([passwordOf(username), NEW_PASSWORD, DEFAULT_PASSWORD])]) {
    await page.getByTestId('login-username').fill(username);
    await page.getByTestId('login-password').fill(password);
    await page.getByTestId('login-submit').click();
    await expect(pw.or(app).or(err)).toBeVisible();
    if (!(await err.isVisible())) { if (password === NEW_PASSWORD) changed.add(username); break; }
    await page.evaluate(() => { document.querySelector('#loginError').textContent = ''; });
  }
  await expect(pw.or(app)).toBeVisible();
  if (await pw.isVisible()) {
    await page.getByTestId('pw-current').fill(DEFAULT_PASSWORD);
    await page.getByTestId('pw-new').fill(NEW_PASSWORD);
    await page.getByTestId('pw-confirm').fill(NEW_PASSWORD);
    await page.getByTestId('pw-submit').click();
    changed.add(username);
  }
  await expect(app).toBeVisible();
  // Menu "Công cụ khác" (Việc của tôi, Chờ duyệt, Số liệu, Thùng rác…) mặc định thu gọn: mở ra để kịch bản bấm được.
  await page.evaluate(() => { const m = document.querySelector('#navMore'); if (m) m.open = true; });
  // Kịch bản E2E thao tác mọi mục trong panel việc: bật "Xem đầy đủ" (mặc định giao diện là dạng gọn).
  await page.evaluate(() => { const t = localStorage.getItem('workhub_token'); const id = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).id; localStorage.setItem(`workhub:u${id}:ip:full`, 'true'); });
}
async function token(page) { return page.evaluate(() => localStorage.getItem('workhub_token')); }
async function apiAs(page, path, init = {}) {
  const t = await token(page);
  return page.request.fetch(path, { ...init, headers: { authorization: 'Bearer ' + t, ...(init.headers || {}) } });
}
function vnDate(offsetDays = 0) {
  const d = new Date(Date.now() + 7 * 3600_000 + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}
async function openProject(page, key) {
  await page.getByTestId(`nav-project-${key}`).click();
  await expect(page.locator('#viewBody')).toBeVisible();
}
function column(page, name) { return page.getByTestId(`column-${name}`); }
function card(page, code) { return page.getByTestId(`card-${code}`); }
async function toast(page, text) { await expect(page.locator('.toast', { hasText: text }).first()).toBeVisible(); }

module.exports = { login, token, apiAs, vnDate, openProject, column, card, toast, DEFAULT_PASSWORD, NEW_PASSWORD };
