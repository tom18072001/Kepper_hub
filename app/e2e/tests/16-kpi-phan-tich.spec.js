// KPI & phân tích thống kê: chỉ Ban Tổng Giám đốc xem / xuất; nhân viên, trưởng phòng, admin IT bị 403 và không thấy menu — dữ liệu GIẢ.
const { test, expect } = require('@playwright/test');
const { login, apiAs } = require('./helpers');

async function as(browser, username) {
  const page = await (await browser.newContext()).newPage();
  await login(page, username);
  return page;
}

test('Ban Tổng Giám đốc mở trang KPI & phân tích, xuất Excel', async ({ browser }) => {
  const director = await as(browser, 'giamdoc');
  const r = await apiAs(director, '/api/kpi/analytics?from=2026-01-01&to=2026-12-31');
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body.overall).toHaveProperty('workDays');
  expect(body.overall.rating).toHaveProperty('bands');
  expect(Array.isArray(body.notes)).toBe(true);

  await director.goto('/#/kpi');
  await expect(director.getByTestId('an-tiles')).toBeVisible();
  await expect(director.getByTestId('an-people')).toBeVisible();
  await expect(director.getByTestId('nav-kpi')).toHaveCount(1);
  await expect(director.getByTestId('an-details')).toBeVisible();
  const [download] = await Promise.all([director.waitForEvent('download'), director.getByTestId('an-export').click()]);
  expect(download.suggestedFilename()).toMatch(/^phan-tich-kpi_.*\.xlsx$/);
});

test('nhân viên, trưởng phòng, admin IT: API 403 và không có menu KPI & phân tích', async ({ browser }) => {
  for (const username of ['nv.kinhdoanh2', 'tp.kinhdoanh', 'admin']) {
    const page = await as(browser, username);
    for (const path of ['/api/kpi/analytics', '/api/kpi/analytics.xlsx']) expect((await apiAs(page, path)).status(), `${username} ${path}`).toBe(403);
    await expect(page.getByTestId('nav-kpi')).toHaveCount(0);
  }
  const staff = await as(browser, 'nv.kinhdoanh2');
  await staff.goto('/#/kpi');
  await expect(staff.getByTestId('an-forbidden')).toContainText('chỉ dành cho Ban Tổng Giám đốc');
  await expect(staff.getByTestId('an-tiles')).toHaveCount(0);
});
