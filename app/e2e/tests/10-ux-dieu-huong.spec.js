// Review UX đợt A1 — điều hướng, tên gọi, đăng nhập, trang "chưa bật" (dữ liệu mẫu GIẢ):
// mỗi trang một tên (menu = tiêu đề tab = tiêu đề trang = bảng lệnh); menu trái theo nhóm Công việc · Dự án · Giao ban · Nghiệp vụ · Thống kê;
// nút "Ứng dụng" chỉ hiện khi thu gọn menu; menu tài khoản không còn Phím tắt / Thùng rác; HR, CRM chưa bật thì hiện trang giải thích.
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

// Trang có tiêu đề (h1) đúng bằng tên ở menu. Các trang còn lại do gói khác sửa phần tiêu đề; ở đây chỉ kiểm tiêu đề tab.
const H1_SAME_AS_MENU = new Set(['#/home', '#/approvals', '#/sprint', '#/trash', '#/crm', '#/hrm', '#/vanthu']);

test('25. Đăng nhập: nhãn gắn với ô nhập, nút hiện mật khẩu, lối quên mật khẩu', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('label[for="loginUser"]')).toBeVisible();
  await expect(page.locator('label[for="loginPass"]')).toBeVisible();
  await expect(page.locator('#loginPage').getByLabel('Tài khoản', { exact: true })).toHaveAttribute('id', 'loginUser');
  await expect(page.locator('#loginPage').getByLabel('Mật khẩu', { exact: true })).toHaveAttribute('id', 'loginPass');
  const pass = page.getByTestId('login-password');
  await pass.fill('bi-mat-gia');
  await expect(pass).toHaveAttribute('type', 'password');
  await page.getByTestId('login-show-password').click();
  await expect(pass).toHaveAttribute('type', 'text');
  await expect(page.getByTestId('login-show-password')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('login-show-password').click();
  await expect(pass).toHaveAttribute('type', 'password');
  await expect(page.getByTestId('caps-warn')).toBeHidden();
  await expect(page.getByTestId('login-forgot')).toContainText('Quên mật khẩu? Liên hệ quản trị');
});

test('26. Menu trái: nhãn menu khớp tiêu đề trang, nhóm mới, không còn chữ "Dashboard"', async ({ page }) => {
  await login(page, 'giamdoc');
  await expect(page.getByTestId('today')).toBeVisible();
  const nav = page.locator('#workNav');
  // Thứ tự nhóm.
  await expect(nav.locator('.sb-group')).toHaveCount(5);
  expect(await nav.locator('.sb-group .sb-gt .t').allTextContents()).toEqual(['Công việc', 'Dự án', 'Giao ban', 'Nghiệp vụ', 'Thống kê']);
  // Mục trong từng nhóm.
  const group = id => nav.locator(`.sb-group[data-group="${id}"] .sb-items > a`);
  expect(await group('work').locator('.t').allTextContents()).toEqual(expect.arrayContaining(['Việc của tôi', 'Chờ tôi duyệt', 'Cập nhật nhanh', 'Thùng rác']));
  await expect(group('projects').first()).toHaveText('Tiến độ dự án');
  await expect(page.locator('#projectNav')).toBeAttached();
  await expect(group('meeting')).toHaveText(['Báo cáo tuần']);
  await expect(group('stats')).toHaveText(['Thống kê công việc']);
  await expect(page.locator('#sidebar')).not.toContainText('Dashboard');
  await expect(page.getByTestId('nav-sprint')).not.toHaveAttribute('title', /sprint/i);

  // Mỗi mục menu: tiêu đề tab = "<nhãn> · Kepler Hub"; trang đã thống nhất tên thì h1 cũng là nhãn đó.
  const links = await nav.locator('.sb-items > a[data-testid^="nav-"]').evaluateAll(as => as.map(a => ({ href: a.getAttribute('href'), testid: a.dataset.testid, label: a.querySelector('.t').textContent.trim() })));
  expect(links.length).toBeGreaterThanOrEqual(8);
  for (const { href, testid, label } of links) {
    await page.getByTestId(testid).click();
    await expect(page, `${href}`).toHaveTitle(`${label} · Kepler Hub`);
    // Chờ trang tải xong trước khi bấm mục sau (work.js chưa bỏ kết quả về muộn khi đã chuyển trang).
    await page.waitForLoadState('networkidle');
    if (H1_SAME_AS_MENU.has(href)) await expect(page.locator('#view h1').first(), href).toHaveText(label);
  }
  await expect(page.getByTestId('nav-home')).toHaveText('Tiến độ dự án');
  await page.getByTestId('nav-home').click();
  await expect(page.locator('#crumbs')).toHaveText('Tiến độ dự án');
  await page.getByTestId('nav-approvals').click();
  await expect(page.locator('#crumbs')).toHaveText('Chờ tôi duyệt');

  // Trang chủ: thẻ Dự án dẫn tới "Xem tiến độ"; đầu trang không còn nút "Báo cáo tuần" trùng với thẻ Giao ban.
  await page.getByTestId('nav-today').click();
  await expect(page).toHaveTitle('Trang chủ · Kepler Hub');
  const progress = page.getByTestId('today-projects-progress');
  if (await page.getByTestId('today-projects').count()) {
    await expect(progress).toHaveText('Xem tiến độ');
    await expect(progress).toHaveAttribute('href', '#/home');
  }
  await expect(page.locator('.td-actions')).not.toContainText('Báo cáo tuần');

  // Bảng lệnh dùng cùng tên.
  await page.getByTestId('palette-open').click();
  await page.getByTestId('palette-input').fill('tien do');
  await expect(page.locator('#paletteList')).toContainText('Tiến độ dự án');
  await expect(page.locator('#paletteList')).not.toContainText('Dashboard');
  await page.getByTestId('palette-input').fill('thong ke');
  await expect(page.locator('#paletteList')).toContainText('Thống kê công việc');
  await page.keyboard.press('Escape');
});

test('27. Đầu trang: "Ứng dụng" chỉ khi thu gọn menu; menu tài khoản gọn; nút biểu tượng có tên', async ({ page }) => {
  await login(page, 'nv.phaply');
  await expect(page.getByTestId('today')).toBeVisible();
  await expect(page.getByTestId('apps-open')).toBeHidden();
  await page.getByTestId('menu-toggle').click();
  await expect(page.getByTestId('apps-open')).toBeVisible();
  await page.getByTestId('apps-open').click();
  await expect(page.locator('#appsPanel')).toContainText('Tiến độ dự án');
  await page.keyboard.press('Escape');
  await page.getByTestId('menu-toggle').click();
  await expect(page.getByTestId('apps-open')).toBeHidden();

  await page.getByTestId('user-menu').click();
  await expect(page.locator('#userPanel')).not.toContainText('Phím tắt');
  await expect(page.locator('#userPanel')).not.toContainText('Thùng rác');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shortcuts-open')).toBeVisible();
  await expect(page.getByTestId('user-menu')).toHaveAttribute('aria-label', /^Tài khoản/);
  await expect(page.getByTestId('menu-toggle')).toHaveAttribute('aria-label', /menu/);
  await expect(page.getByTestId('notif-btn')).toHaveAttribute('aria-label', 'Thông báo');
});

test('28. HR, CRM chưa bật cho đơn vị: hiện trang "Tính năng chưa bật", không lộ "Không tìm thấy API"', async ({ page }) => {
  await login(page, 'nv.phaply');
  await expect(page.getByTestId('today')).toBeVisible();
  // Giả lập máy chạy không bật phân hệ: API của phân hệ rơi vào 404 chung.
  const off = route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Không tìm thấy API', code: 'NOT_FOUND' }) });
  await page.route('**/api/hrm/**', off);
  await page.route('**/api/crm/**', off);
  for (const hash of ['#/hrm', '#/crm', '#/hrm/people']) {
    await page.evaluate(h => { location.hash = h; }, hash);
    await expect(page.getByTestId('feature-off'), hash).toBeVisible();
    await expect(page.getByTestId('feature-off')).toContainText('Tính năng chưa bật cho đơn vị');
    await expect(page.locator('#view')).not.toContainText('Không tìm thấy API');
  }
  await page.getByTestId('feature-off-home').click();
  await expect(page.getByTestId('today')).toBeVisible();
  await expect(page).toHaveTitle('Trang chủ · Kepler Hub');
});
