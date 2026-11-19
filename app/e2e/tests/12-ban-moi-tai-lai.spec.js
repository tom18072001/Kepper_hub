// N10 — Có bản mới sau khi nâng cấp máy chủ: tab đang mở biết mình chạy giao diện cũ và mời tải lại.
// "Nâng cấp" được giả lập bằng cách chặn phản hồi trong trình duyệt: trang chính và API trả mã bản MỚI (máy chủ test giữ nguyên).
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

const NEW_BUILD = 'ban-moi-e2e';
// Service worker (PWA) tự fetch trang chính, page.route không thấy yêu cầu đó: tắt trong các kịch bản này.
test.use({ serviceWorkers: 'block' });
// Trang vừa tải lại còn yêu cầu API đang đi qua route lúc test kết thúc: bỏ qua, không tính là lỗi.
test.afterEach(({ page }) => page.unrouteAll({ behavior: 'ignoreErrors' }));

// Từ lúc này máy chủ "đã nâng cấp": trang chính ghi mã mới vào <meta>, mọi API trả header mã mới.
async function upgradeServer(page) {
  await page.route(url => url.pathname === '/' || url.pathname === '/index.html', async route => {
    const res = await route.fetch();
    const html = (await res.text()).replace(/(<meta name="kepler-build" content=")[^"]*"/, `$1${NEW_BUILD}"`);
    await route.fulfill({ response: res, body: html, headers: withBuild(res.headers()) });
  });
  await page.route(url => url.pathname.startsWith('/api/') && url.pathname !== '/api/stream', async route => {
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: withBuild(res.headers()) });
  });
  // Luồng realtime giữ kết nối lâu, không đi qua route.fetch được: trả luồng ngắn (như máy chủ vừa khởi động lại).
  await streamFromNewServer(page);
}
function withBuild(headers) {
  const h = { ...headers, 'x-kepler-build': NEW_BUILD };
  delete h['content-encoding']; delete h['content-length']; // thân đã được giải nén khi route.fetch
  return h;
}
async function streamFromNewServer(page) {
  await page.route(url => url.pathname === '/api/stream', route => route.fulfill({
    status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'x-kepler-build': NEW_BUILD }, body: 'retry: 5000\n\n',
  }));
}
// Đánh dấu trang hiện tại: sau khi tải lại, dấu này mất.
const markPage = page => page.evaluate(() => { window.__trangCu = true; });
const isSamePage = page => page.evaluate(() => window.__trangCu === true);
const metaBuild = page => page.locator('meta[name="kepler-build"]').getAttribute('content');
// Giả lập tab bị ẩn / hiện lại (thu nhỏ cửa sổ, chuyển sang tab khác).
const setHidden = (page, hidden) => page.evaluate(h => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);
// Mạng có lại → giao diện hỏi /api/health ngay (cách kích hoạt kiểm tra mà không rời trang).
const networkBack = page => page.evaluate(() => window.dispatchEvent(new Event('online')));

test('N10: trang chính, /api/health và mọi API cùng một mã bản; bình thường không hiện thanh "Có bản mới"', async ({ page }) => {
  await login(page, 'nv.phaply');
  const build = await metaBuild(page);
  expect(build).toMatch(/^[0-9a-f]{12}$/);
  const health = await page.request.get('/api/health');
  expect(health.headers()['x-kepler-build']).toBe(build);
  expect((await health.json()).build).toBe(build);
  expect((await page.request.get('/api/brand')).headers()['x-kepler-build']).toBe(build);
  await page.evaluate(() => { location.hash = '#/my?mode=notes'; });
  await expect(page.getByTestId('note-input')).toBeVisible();
  await expect(page.getByTestId('update-bar')).toHaveCount(0);
});

test('N10: nâng cấp xong, thao tác kế tiếp hiện "Có bản mới · Tải lại"; bấm Tải lại thì nạp bản mới, vẫn đăng nhập', async ({ page }) => {
  await login(page, 'nv.phaply');
  await markPage(page);
  await upgradeServer(page);
  await page.evaluate(() => { location.hash = '#/my?mode=notes'; }); // thao tác bất kỳ có gọi API
  const bar = page.getByTestId('update-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Có bản mới');
  await expect(bar).toHaveAttribute('role', 'status');
  const reload = page.getByTestId('update-reload');
  await expect(reload).toHaveText('Tải lại');
  expect(await isSamePage(page)).toBe(true); // không tự tải lại khi tab đang hiện

  await Promise.all([page.waitForEvent('load'), reload.click()]);
  expect(await isSamePage(page)).toBe(false);
  expect(await metaBuild(page)).toBe(NEW_BUILD);
  await expect(page.locator('#appShell:not(.hidden)')).toBeVisible();
  await expect(page.getByTestId('note-input')).toBeVisible(); // giữ nguyên trang đang xem (route trong URL)
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/health')), networkBack(page)]);
  await expect(page.getByTestId('update-bar')).toHaveCount(0);
});

test('N10: đang gõ dở thì không tự tải lại (kể cả khi tab ẩn lâu); bấm Tải lại thì hỏi trước', async ({ page }) => {
  await login(page, 'nv.phaply');
  await page.evaluate(() => { location.hash = '#/my?mode=notes'; });
  const input = page.getByTestId('note-input');
  await input.fill('Gọi lại cho bên tư vấn (giả)');
  await page.clock.install();
  await markPage(page);
  await upgradeServer(page);
  await networkBack(page);
  await expect(page.getByTestId('update-bar')).toBeVisible();

  // Tab ẩn quá 1 phút nhưng ô còn nội dung chưa lưu: không tải lại.
  await setHidden(page, true);
  await page.clock.runFor(3 * 60_000);
  expect(await isSamePage(page)).toBe(true);
  await setHidden(page, false);
  await expect(input).toHaveValue('Gọi lại cho bên tư vấn (giả)');

  // Bấm Tải lại khi đang nhập dở: hỏi lại, "Để sau" giữ nguyên nội dung.
  await page.getByTestId('update-reload').click();
  await expect(page.getByTestId('update-bar')).toContainText('Bạn đang nhập dở');
  await page.getByTestId('update-later').click();
  await expect(page.getByTestId('update-reload')).toBeVisible();
  expect(await isSamePage(page)).toBe(true);
  await expect(input).toHaveValue('Gọi lại cho bên tư vấn (giả)');

  // Người dùng chọn "Vẫn tải lại".
  await page.getByTestId('update-reload').click();
  await Promise.all([page.waitForEvent('load'), page.getByTestId('update-reload-force').click()]);
  expect(await isSamePage(page)).toBe(false);
  expect(await metaBuild(page)).toBe(NEW_BUILD);
});

test('N10: tab ẩn quá 1 phút, không có gì nhập dở thì tự tải lại sang bản mới (chỉ một lần)', async ({ page }) => {
  await login(page, 'nv.phaply');
  await page.clock.install();
  await markPage(page);
  await upgradeServer(page);
  await setHidden(page, true);
  await networkBack(page);
  await expect(page.getByTestId('update-bar')).toBeAttached();
  await page.clock.runFor(30_000);
  expect(await isSamePage(page)).toBe(true); // ẩn chốc lát: chưa tải lại

  await Promise.all([page.waitForEvent('load'), page.clock.runFor(31_000)]);
  expect(await isSamePage(page)).toBe(false);
  expect(await metaBuild(page)).toBe(NEW_BUILD);
  await expect(page.locator('#appShell:not(.hidden)')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('kepler:auto-reloaded'))).toBe(NEW_BUILD);
});

test('N10: máy chủ khởi động lại, luồng realtime nối lại với mã mới thì hiện thanh ngay', async ({ page }) => {
  await streamFromNewServer(page); // chỉ luồng realtime đến từ máy chủ mới; trang và API còn lại vẫn bản cũ
  await login(page, 'nv.phaply');
  await expect(page.getByTestId('update-bar')).toBeVisible();
  await expect(page.getByTestId('update-bar')).toContainText('Có bản mới');
});

test('N10: Đăng xuất thì tải lại trang và nạp giao diện mới nhất', async ({ page }) => {
  await login(page, 'nv.phaply');
  await markPage(page);
  await upgradeServer(page); // máy chủ đã nâng cấp nhưng tab chưa gọi API nào nên chưa biết
  await page.getByTestId('user-menu').click();
  await Promise.all([page.waitForEvent('load'), page.getByTestId('logout').click()]);
  expect(await isSamePage(page)).toBe(false);
  expect(await metaBuild(page)).toBe(NEW_BUILD);
  await expect(page.locator('#loginPage:not(.hidden)')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('workhub_token'))).toBeNull();
  await expect(page.getByTestId('update-bar')).toHaveCount(0);
});
