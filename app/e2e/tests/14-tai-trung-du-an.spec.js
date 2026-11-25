// Trang dự án không tải trùng API: mỗi lần mở trang, bộ dữ liệu dự án (dự án, việc, chu kỳ, bộ lọc đã lưu, kế hoạch,
// phạm vi tạo việc, giai đoạn) chỉ tải một lần; đổi tab / bấm lại dự án đang xem dùng lại bộ đã tải; mở việc không gọi lại dự án và chu kỳ.
// Số liệu MTL (Tổng quan, Kế hoạch & Gantt) vẫn tải mới mỗi lần vẽ; realtime vẫn cập nhật bảng. Dữ liệu GIẢ của seed (dự án DA).
const { test, expect, login, apiAs } = require('./helpers');

const SET = ['', '/items', '/cycles', '/views', '/plans', '/create-scope', '/mtl-sprints']; // bộ dữ liệu trang dự án MTL

// Ghi mọi yêu cầu API (trừ luồng realtime) theo đường dẫn, không tính tham số.
function recorder(page) {
  const log = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') && u.pathname !== '/api/stream') log.push(u.pathname); });
  return {
    clear() { log.length = 0; },
    count(path) { return log.filter(p => p === path).length; },
    // Số lần gọi từng API của bộ dữ liệu dự án.
    set(pid) { return Object.fromEntries(SET.map(s => [`/api/projects/${pid}${s}`, log.filter(p => p === `/api/projects/${pid}${s}`).length])); },
  };
}
const each = (pid, n) => Object.fromEntries(SET.map(s => [`/api/projects/${pid}${s}`, n]));
// Chờ phản hồi cuối của lượt vẽ, rồi chờ thêm để bắt lượt tải trùng (nếu có) chạy sau.
async function settle(page, done) { await done; await page.waitForTimeout(1200); }
const responseOf = (page, path) => page.waitForResponse(r => new URL(r.url()).pathname === path);

// Đổi tên việc qua API (như người khác sửa) tới khi trang nhận được qua realtime. Máy chủ giữ tối đa 5 luồng realtime mỗi người:
// trong lượt chạy dài, trang của kịch bản khác cùng tài khoản có thể đẩy luồng của trang này ra — chờ nối lại rồi đổi tên khác, thử lại.
let renames = 0;
async function renameUntilSeen(page, itemId, base, seen) {
  let name = '';
  await expect(async () => {
    await expect(page.locator('#liveDot')).toBeVisible({ timeout: 8000 });
    name = `${base} (đổi tên realtime ${++renames})`;
    expect((await apiAs(page, `/api/items/${itemId}`, { method: 'PATCH', data: { title: name } })).ok()).toBeTruthy();
    await expect(seen).toContainText(name, { timeout: 4000 });
  }).toPass({ timeout: 45_000 });
  return name;
}

async function setup(page) {
  await login(page, 'giamdoc');
  const project = (await (await apiAs(page, '/api/projects')).json()).find(p => p.key === 'DA');
  const items = await (await apiAs(page, `/api/projects/${project.id}/items`)).json();
  return { pid: project.id, item: items.find(i => !i.parentId) || items[0] };
}

test('Mở trang dự án MTL: mỗi API của trang chỉ gọi một lần (bấm sidebar, tải lại trang, đổi địa chỉ lúc đang vào ứng dụng)', async ({ page }) => {
  const { pid } = await setup(page);
  const rec = recorder(page);
  const mtl = `/api/projects/${pid}/mtl`;

  // Bấm dự án ở sidebar.
  rec.clear();
  let done = responseOf(page, mtl);
  await page.getByTestId('nav-project-DA').click();
  await expect(page.getByTestId('mtl-tile-spi')).toBeVisible();
  await settle(page, done);
  expect(rec.set(pid)).toEqual(each(pid, 1));
  expect(rec.count(mtl)).toBe(1);

  // Tải lại trang (F5) đang ở dự án.
  rec.clear();
  done = responseOf(page, mtl);
  await page.reload();
  await expect(page.getByTestId('mtl-tile-spi')).toBeVisible();
  await settle(page, done);
  expect(rec.set(pid)).toEqual(each(pid, 1));
  expect(rec.count(mtl)).toBe(1);

  // Đổi địa chỉ sang dự án trong lúc ứng dụng còn đang vào (danh mục chưa tải xong), mạng chậm: vẽ một lần khi vào xong
  // (trước đây: lượt vẽ theo hashchange + lượt vẽ của lúc vào ứng dụng chạy song song, mỗi API gọi hai lần).
  await page.evaluate(() => { location.hash = '#/today'; });
  await expect(page.getByTestId('today-project-DA')).toBeVisible();
  const slow = ms => async route => { await new Promise(r => setTimeout(r, ms)); await route.continue(); };
  await page.route('**/api/templates', slow(1500));
  await page.route(`**/api/projects/${pid}/items`, slow(2500));
  const me = responseOf(page, '/api/me');
  await page.reload();
  await me;
  await page.waitForTimeout(300); // đã có người dùng, danh mục còn đang tải
  rec.clear();
  done = responseOf(page, mtl);
  await page.evaluate(id => { location.hash = '#/projects/' + id; }, pid);
  await expect(page.getByTestId('mtl-tile-spi')).toBeVisible();
  await settle(page, done);
  await page.unroute('**/api/templates');
  await page.unroute(`**/api/projects/${pid}/items`);
  expect(rec.set(pid)).toEqual(each(pid, 1));
  expect(rec.count(mtl)).toBe(1);
});

test('Đổi tab, bấm lại dự án đang xem: không tải lại bộ dữ liệu dự án; số liệu MTL vẫn tải mới', async ({ page }) => {
  const { pid } = await setup(page);
  const rec = recorder(page);
  const mtl = `/api/projects/${pid}/mtl`, sprints = `/api/projects/${pid}/mtl-sprints`;
  // Vào từ thẻ dự án ở Trang chủ (#/projects/id?view=mtl).
  let done = responseOf(page, mtl);
  await page.getByTestId('today-project-DA').click();
  await expect(page.getByTestId('mtl-tile-spi')).toBeVisible();
  await settle(page, done);

  // Bấm dự án ở sidebar (#/projects/id — cùng dự án, cùng tab Tổng quan): chỉ số liệu MTL tải lại.
  rec.clear();
  done = responseOf(page, mtl);
  await page.getByTestId('nav-project-DA').click();
  await settle(page, done);
  expect(rec.set(pid)).toEqual(each(pid, 0));
  expect(rec.count(mtl)).toBe(1);

  // Sang tab Bảng: chỉ lấy lại giai đoạn của hạng mục (chia làn theo giai đoạn).
  rec.clear();
  done = responseOf(page, sprints);
  await page.getByTestId('view-board').click();
  await expect(page.locator('#viewBody[data-view="board"] .kcard').first()).toBeVisible();
  await settle(page, done);
  expect(rec.set(pid)).toEqual({ ...each(pid, 0), [sprints]: 1 });

  // Sang Kế hoạch & Gantt, về Tổng quan: số liệu MTL tải mới mỗi lần, bộ dữ liệu dự án không tải lại.
  for (const tab of ['plan', 'mtl']) {
    rec.clear();
    done = responseOf(page, mtl);
    await page.getByTestId(`view-${tab}`).click();
    await expect(page.locator(`#viewBody[data-view="${tab}"]`)).toBeVisible();
    await settle(page, done);
    expect(rec.set(pid)).toEqual(each(pid, 0));
    expect(rec.count(mtl)).toBe(1);
  }
});

test('Mở việc trên trang dự án / ngay sau khi xem dự án: không gọi lại dự án và chu kỳ; realtime vẫn cập nhật bảng, giữ khung Gantt đang xem', async ({ page }) => {
  const { pid, item } = await setup(page);
  const rec = recorder(page);
  // Bảng của dự án, mở một việc.
  await page.evaluate(id => { location.hash = `#/projects/${id}?view=board`; }, pid);
  const cardEl = page.getByTestId(`card-${item.code}`);
  await expect(cardEl).toBeAttached();
  await page.waitForTimeout(800);
  rec.clear();
  let done = responseOf(page, `/api/items/${item.id}`);
  await page.evaluate(id => { location.hash = location.hash + '&item=' + id; }, item.id);
  await expect(page.locator('#itemPanel:not(.hidden) .ip-head')).toBeVisible();
  await settle(page, done);
  expect(rec.count(`/api/items/${item.id}`)).toBe(1);
  expect(rec.set(pid)).toEqual(each(pid, 0));

  // Realtime: người dùng sửa việc từ nơi khác (API) → thẻ trên bảng cập nhật, không phải tải lại trang.
  await page.evaluate(() => { location.hash = location.hash.replace(/&item=\d+/, ''); });
  await expect(page.locator('#itemPanel.hidden')).toBeAttached();
  const title = item.title;
  await renameUntilSeen(page, item.id, title, cardEl);

  // Realtime trên tab Kế hoạch & Gantt: vẽ lại theo URL hiện tại — giữ khung Gantt người dùng vừa dời, không nhảy về khung mặc định.
  await page.evaluate(id => { location.hash = `#/projects/${id}?view=plan`; }, pid);
  const range = page.getByTestId('gz-range');
  await expect(range).toBeVisible();
  const first = await range.textContent();
  await page.getByTestId('gz-fwd').click();
  await expect(range).not.toHaveText(first);
  const moved = await range.textContent();
  await renameUntilSeen(page, item.id, title, page.locator('#viewBody'));
  await expect(range).toHaveText(moved);
  expect(await (await apiAs(page, `/api/items/${item.id}`, { method: 'PATCH', data: { title } })).ok()).toBeTruthy(); // trả tên gốc

  // Tải lại trang ở dự án (panel chưa có dữ liệu dự án), rồi mở thẳng việc ở "Việc của tôi": dùng dự án trang vừa tải.
  await page.evaluate(id => { location.hash = `#/projects/${id}?view=board`; }, pid);
  await expect(cardEl).toBeAttached();
  done = responseOf(page, `/api/projects/${pid}/mtl-sprints`);
  await page.reload();
  await expect(cardEl).toBeAttached();
  await settle(page, done);
  rec.clear();
  done = responseOf(page, `/api/items/${item.id}`);
  await page.evaluate(id => { location.hash = '#/my?item=' + id; }, item.id);
  await expect(page.locator('#itemPanel:not(.hidden) .ip-head')).toBeVisible();
  await settle(page, done);
  expect(rec.count(`/api/items/${item.id}`)).toBe(1);
  expect(rec.count(`/api/projects/${pid}`)).toBe(0);
  expect(rec.count(`/api/projects/${pid}/cycles`)).toBe(0);
});
