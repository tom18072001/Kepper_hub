// Lượt vẽ về muộn không đè trang người dùng vừa chuyển tới (dữ liệu GIẢ).
// Trước đây chỉ Trang chủ và trang dự án kiểm "còn là trang đang xem": trang khác (Chờ tôi duyệt, Nhân sự, Đối tác, Báo cáo tuần,
// Quản trị…) chậm dữ liệu mà người dùng đã bấm sang trang khác thì lượt vẽ cũ ghi đè lên trang mới — URL một nơi, nội dung một nẻo
// (e2e 13 H9 từng hỏng đúng như vậy khi chạy toàn bộ). Nay mỗi lần sang trang, #view là phần tử mới; lượt vẽ cũ chỉ ghi vào phần tử đã
// tách khỏi trang; thanh vị trí, địa chỉ, chuyển hướng cũng không bị lượt vẽ cũ đụng tới. Báo cáo tuần còn giữ trạng thái chung của
// trang (bản nháp đang sửa): lượt vẽ cũ dừng trước khi đổi trạng thái đó (V7).
// Cách làm chậm có chủ đích: giữ phản hồi API của trang trước (page.route) cho tới khi trang mới đã vẽ xong rồi mới thả.
const { test, expect, login, apiAs, vnDate } = require('./helpers');

const isApi = r => r.url().includes('/api/') && !r.url().includes('/api/stream');
// Giữ các yêu cầu khớp `match` cho tới khi release(); seen(): đã có yêu cầu bị giữ.
async function holdApi(page, match) {
  const held = [];
  await page.route('**/api/**', async route => {
    if (!isApi(route.request()) || !match(route.request().url())) return route.continue();
    await new Promise(r => held.push(r));
    await route.continue().catch(() => {});
  });
  return { seen: () => held.length > 0, release: () => held.splice(0).forEach(r => r()) };
}
// Giữ MỌI API (trừ luồng realtime) trong lúc bật; idle(): không còn yêu cầu API nào đang chạy.
async function apiGate(page) {
  const held = [], inflight = new Set(); let on = false;
  page.on('request', r => { if (isApi(r)) inflight.add(r); });
  page.on('requestfinished', r => inflight.delete(r));
  page.on('requestfailed', r => inflight.delete(r));
  await page.route('**/api/**', async route => {
    if (!on || !isApi(route.request())) return route.continue();
    await new Promise(r => held.push(r));
    await route.continue().catch(() => {});
  });
  return {
    hold() { on = true; }, pass() { on = false; }, held: () => held.length,
    release() { held.splice(0).forEach(r => r()); },
    idle: () => expect.poll(() => inflight.size, { timeout: 20_000 }).toBe(0),
  };
}
const go = (page, hash) => page.evaluate(h => { location.hash = h; }, hash);
const h1 = page => page.locator('#view h1').first();
const hashOf = page => page.url().replace(/^[^#]*/, '');
const weekdayAhead = n => { for (let i = n; ; i++) { const d = vnDate(i); const w = new Date(d + 'T00:00:00Z').getUTCDay(); if (w >= 1 && w <= 5) return d; } };
// Trang Nhân sự (tab Chờ duyệt) vẫn đang hiện, không bị "Chờ tôi duyệt" về muộn đè lên.
async function expectHrmStays(tb) {
  await expect(h1(tb)).toHaveText('Nhân sự');
  await expect(tb.getByTestId('hrm-approve-count')).toBeVisible();
  await expect(tb.getByTestId('approvals-tab-hr')).toHaveCount(0);
  await expect(tb.locator('#crumbs')).toHaveText('Nhân sự');
  expect(hashOf(tb)).toBe('#/hrm/approve');
}
// Thả phản hồi đang giữ rồi chờ lượt vẽ cũ chạy xong (tải xong, đã ghi — nếu có — vào phần tử cũ).
async function releaseAndSettle(page, gate, pattern) {
  const done = page.waitForResponse(r => r.url().includes(pattern));
  gate.release();
  await done;
  await page.waitForTimeout(300);
}

test('V1. Điều hướng: "Chờ tôi duyệt" về muộn sau khi đã sang Nhân sự — không đè', async ({ browser }) => {
  const tb = await (await browser.newContext()).newPage();
  await login(tb, 'tb.phaply');
  await go(tb, '#/hrm');
  await expect(h1(tb)).toHaveText('Nhân sự');
  const gate = await holdApi(tb, u => u.endsWith('/api/approvals/queue'));
  await go(tb, '#/approvals?tab=hr');
  await expect.poll(gate.seen).toBe(true);
  await go(tb, '#/hrm/approve');
  await expect(tb.getByTestId('hrm-approve-count')).toBeVisible();
  await releaseAndSettle(tb, gate, '/api/approvals/queue');
  await expectHrmStays(tb);
});

test('V2. Vẽ nền khi có thông báo mới (trang "Chờ tôi duyệt") về muộn sau khi đã sang Nhân sự — không đè', async ({ browser }) => {
  const nv = await (await browser.newContext()).newPage();
  await login(nv, 'nv.phaply');
  const tb = await (await browser.newContext()).newPage();
  const live = tb.waitForResponse(r => r.url().includes('/api/stream'));
  await login(tb, 'tb.phaply');
  await live; // luồng realtime đã nối: nhận được "notify"
  await go(tb, '#/approvals?tab=hr');
  await expect(tb.getByTestId('approvals-tab-hr')).toHaveClass(/active/);
  const gate = await holdApi(tb, u => u.endsWith('/api/approvals/queue'));
  // Nhân viên gửi đơn nghỉ → máy chủ báo lãnh đạo bộ phận (notify) → trang đang xem của lãnh đạo tự vẽ lại nền.
  const day = weekdayAhead(40);
  const r = await apiAs(nv, '/api/hrm/leaves', { method: 'POST', data: { type: 'UNPAID', fromDate: day, toDate: day, reason: 'Vẽ đè V2 (giả)' } });
  expect(r.status(), await r.text()).toBe(201);
  await expect.poll(gate.seen, { timeout: 15_000 }).toBe(true);
  await go(tb, '#/hrm/approve');
  await expect(tb.getByTestId('hrm-approve-count')).toBeVisible();
  await releaseAndSettle(tb, gate, '/api/approvals/queue');
  await expectHrmStays(tb);
});

test('V3. Bấm Duyệt ngay tại tab "Đơn nghỉ & giải trình" rồi sang Nhân sự khi danh sách còn đang tải lại — không đè', async ({ browser }) => {
  const nv = await (await browser.newContext()).newPage();
  await login(nv, 'nv.phaply');
  const day = weekdayAhead(45);
  const created = await apiAs(nv, '/api/hrm/leaves', { method: 'POST', data: { type: 'UNPAID', fromDate: day, toDate: day, reason: 'Vẽ đè V3 (giả)' } });
  expect(created.status(), await created.text()).toBe(201);
  const leaveId = (await created.json()).id;
  const tb = await (await browser.newContext()).newPage();
  await login(tb, 'tb.phaply');
  await go(tb, '#/approvals?tab=hr');
  const row = tb.getByTestId(`hrm-leave-row-${leaveId}`);
  await expect(row).toBeVisible();
  const gate = await holdApi(tb, u => u.endsWith('/api/approvals/queue'));
  await row.getByTestId('hrm-approve').click();
  await expect.poll(gate.seen).toBe(true); // danh sách đang tải lại sau khi duyệt
  await go(tb, '#/hrm/approve');
  await expect(tb.getByTestId('hrm-approve-count')).toBeVisible();
  await releaseAndSettle(tb, gate, '/api/approvals/queue');
  await expectHrmStays(tb);
});

test('V4. Đổi tab "Chờ tôi duyệt" khi tab trước còn đang tải: nội dung và địa chỉ theo tab mới', async ({ browser }) => {
  const tb = await (await browser.newContext()).newPage();
  await login(tb, 'tb.phaply');
  await go(tb, '#/me');
  await expect(h1(tb)).toHaveText('Thông tin cá nhân');
  const gate = await holdApi(tb, u => u.endsWith('/api/approvals/queue'));
  await go(tb, '#/approvals'); // chưa chọn tab: lượt vẽ này tự chọn tab và ghi ?tab= lên địa chỉ
  await expect.poll(gate.seen).toBe(true);
  await tb.unroute('**/api/**'); // yêu cầu mới không bị giữ nữa (yêu cầu đang giữ chờ release)
  await go(tb, '#/approvals?tab=sent');
  await expect(tb.getByTestId('approvals-tab-sent')).toHaveClass(/active/);
  gate.release();
  await tb.waitForTimeout(500);
  await expect(tb.getByTestId('approvals-tab-sent')).toHaveClass(/active/);
  expect(hashOf(tb)).toBe('#/approvals?tab=sent');
});

test('V5. "Việc của tôi" (nhớ bộ lọc vai trò) về muộn: không ghi ?role= lên địa chỉ trang mới', async ({ browser }) => {
  const nv = await (await browser.newContext()).newPage();
  await login(nv, 'nv.phaply');
  // Bộ lọc vai trò đã nhớ từ lần trước: vào "Việc của tôi" không có ?role= thì trang tự ghi lên địa chỉ.
  await nv.evaluate(() => { const t = localStorage.getItem('workhub_token'); const id = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).id; localStorage.setItem(`workhub:u${id}:my:role`, JSON.stringify('LEAD')); });
  await go(nv, '#/me');
  await expect(h1(nv)).toHaveText('Thông tin cá nhân');
  const gate = await holdApi(nv, u => u.includes('/api/my/'));
  await go(nv, '#/my');
  await expect.poll(gate.seen).toBe(true);
  await nv.unroute('**/api/**');
  await go(nv, '#/trash');
  await expect(h1(nv)).toHaveText('Thùng rác');
  gate.release();
  await nv.waitForTimeout(500);
  expect(hashOf(nv)).toBe('#/trash');
  await expect(h1(nv)).toHaveText('Thùng rác');
});

test('V6. "Tài liệu" của người không thuộc dự án nào về muộn: không kéo người dùng sang Văn thư khi đã ở trang khác', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await login(admin, 'admin');
  const hcns = (await (await apiAs(admin, '/api/departments')).json()).find(d => d.code === 'HCNS');
  const r = await apiAs(admin, '/api/admin/users', { method: 'POST', data: { username: 'vt.hcns.gia', fullName: 'Văn thư HCNS (giả)', displayTitle: 'Văn thư (giả)', role: 'member', departmentId: hcns.id } });
  expect([200, 201, 409], await r.text()).toContain(r.status());
  const vt = await (await browser.newContext()).newPage();
  await login(vt, 'vt.hcns.gia');
  await go(vt, '#/me');
  await expect(h1(vt)).toHaveText('Thông tin cá nhân');
  const gate = await holdApi(vt, u => u.includes('/api/documents/projects'));
  await go(vt, '#/tai-lieu');
  await expect.poll(gate.seen).toBe(true);
  await vt.unroute('**/api/**');
  await go(vt, '#/trash');
  await expect(h1(vt)).toHaveText('Thùng rác');
  gate.release();
  await vt.waitForTimeout(500);
  expect(hashOf(vt)).toBe('#/trash');
  await expect(h1(vt)).toHaveText('Thùng rác');
});

test('V7. Báo cáo tuần: chọn nhầm tuần rồi chọn lại khi báo cáo tuần kia còn đang tải — trang và bản nháp tự lưu giữ đúng tuần đang mở', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await login(page, 'tb.thietke'); // bộ phận Thiết kế: spec khác không dùng báo cáo tuần của bộ phận này
  const ctx = await (await apiAs(page, '/api/weekly/context')).json();
  const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
  const wA = addDays(ctx.week, -42), wB = addDays(ctx.week, -49); // hai tuần cũ trong danh sách chọn, spec khác không dùng
  expect(ctx.weeks).toEqual(expect.arrayContaining([wA, wB]));
  // Bản nháp tuần A có một dòng chỉ tuần A mới có.
  const ONLY_A = 'Chỉ có ở tuần A (giả)';
  const formA = (await (await apiAs(page, `/api/weekly/report?week=${wA}`)).json()).prefill;
  (formA.results ||= []).push({ key: 'v9-a', itemId: null, task: ONLY_A, source: 'Phát sinh', ownerIds: [], due: '', status: 'Đúng tiến độ', pct: '', cause: '', solution: '', helpFrom: '', helpWhat: '', helpBy: '' });
  const saved = await apiAs(page, '/api/weekly/report', { method: 'PUT', data: { week: wA, data: formA, baseUpdatedAt: null } });
  expect(saved.status(), await saved.text()).toBeLessThan(300);

  await go(page, `#/tuan?nop=1&w=${wB}`);
  await expect(page.getByTestId('wk-week')).toHaveValue(wB);
  await expect(page.getByTestId('wk-dept-name')).toBeVisible();
  // Chọn nhầm tuần A (báo cáo tuần A đang tải — bị giữ), chọn lại tuần B.
  const gate = await holdApi(page, u => u.includes('/api/weekly/report?') && u.includes(`week=${wA}`));
  await page.getByTestId('wk-week').selectOption(wA);
  await expect.poll(gate.seen).toBe(true);
  await page.getByTestId('wk-week').selectOption(wB);
  await expect(page.getByTestId('wk-dept-name')).toBeVisible();
  const deadline = await page.getByTestId('wk-deadline').textContent();
  await releaseAndSettle(page, gate, `week=${wA}`);
  await expect(page.getByTestId('wk-week')).toHaveValue(wB);
  await expect(page.getByTestId('wk-deadline')).toHaveText(deadline); // lịch giao ban vẫn của tuần B
  await expect(page.locator('#wkL-results')).not.toContainText(ONLY_A);
  // Sửa báo cáo tuần B (thêm hạng mục) → danh sách vẽ lại từ bản nháp đang sửa và tự lưu: vẫn là tuần B, không có dòng của tuần A.
  const put = page.waitForRequest(r => r.method() === 'PUT' && r.url().endsWith('/api/weekly/report'));
  await page.getByTestId('wk-add-results').click();
  const body = (await put).postDataJSON();
  expect(body.week).toBe(wB);
  expect(JSON.stringify(body.data)).not.toContain(ONLY_A);
  await expect(page.locator('#wkL-results')).not.toContainText(ONLY_A);
});

// Mọi trang trên menu (và vài tab con): giữ MỌI API của trang chậm, sang trang khác, rồi thả — trang mới giữ nguyên nội dung,
// tiêu đề, thanh vị trí, địa chỉ. Danh sách lấy từ menu nên trang thêm sau này cũng được kiểm.
const TARGETS = { '#/me': 'Thông tin cá nhân', '#/trash': 'Thùng rác' };
async function sweep(page, slowPages) {
  const gate = await apiGate(page), bad = [];
  let raced = 0, i = 0;
  for (const slow of slowPages) {
    const base = slow.startsWith('#/me') ? '#/trash' : '#/me', title = TARGETS[base], target = `${base}?r=${++i}`; // ?r=: luôn là lượt điều hướng mới
    await go(page, target);
    await expect(h1(page)).toHaveText(title);
    await gate.idle();
    gate.hold();
    await go(page, slow);
    await expect.poll(gate.held, { message: `${slow}: không có API nào để giữ` }).toBeGreaterThan(0);
    await page.waitForTimeout(150); // các API gửi song song của trang chậm cũng đã bị giữ
    gate.pass();
    await go(page, target);
    await expect(h1(page)).toHaveText(title);
    gate.release();
    await gate.idle();
    await page.waitForTimeout(150);
    raced++;
    const now = { url: hashOf(page), h1: await h1(page).textContent(), crumbs: (await page.locator('#crumbs').textContent()).trim() };
    if (now.url !== target || now.h1 !== title || now.crumbs !== title) bad.push({ slow, ...now });
  }
  return { raced, bad };
}

test('V8. Ban Tổng Giám đốc: mọi trang trên menu và tab con — lượt vẽ trang trước về muộn không đè trang mới', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await (await browser.newContext()).newPage();
  await login(page, 'giamdoc');
  const nav = await page.$$eval('#sidebarNav a[href^="#/"]', as => as.map(a => a.getAttribute('href')));
  const project = nav.find(h => /^#\/projects\/\d+$/.test(h));
  expect(project).toBeTruthy();
  const pages = [...new Set([...nav.filter(h => !h.startsWith('#/projects/')), '#/me', '#/claude', project, `${project}/settings`,
    '#/approvals?tab=sent', '#/hrm/approve', '#/hrm/people', '#/hrm/team', '#/tuan/tong-hop', '#/tuan/diem', '#/vanthu'])];
  expect(pages.length).toBeGreaterThan(20);
  const { raced, bad } = await sweep(page, pages);
  expect(bad, 'trang bị lượt vẽ cũ đè lên').toEqual([]);
  expect(raced).toBe(pages.length);
});

test('V9. Quản trị IT: các trang quản trị — lượt vẽ trang trước về muộn không đè trang mới', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await (await browser.newContext()).newPage();
  await login(page, 'admin');
  const pages = [...new Set(await page.$$eval('#sidebarNav a[href^="#/"]', as => as.map(a => a.getAttribute('href'))))];
  expect(pages.length).toBeGreaterThan(3);
  const { raced, bad } = await sweep(page, pages);
  expect(bad, 'trang bị lượt vẽ cũ đè lên').toEqual([]);
  expect(raced).toBe(pages.length);
});

// Ô lọc chờ gõ (300–400 ms) rồi mới ghi bộ lọc lên địa chỉ / chuyển trang. Gõ xong bấm sang trang khác ngay mà trang mới chậm:
// nội dung cũ (cả ô lọc) còn hiện tới khi trang mới vẽ xong — kiểm "ô lọc còn gắn trên trang" không đủ, phải là trang cũ còn là trang đang xem.
test('V10. Gõ bộ lọc rồi sang trang khác ngay (Đối tác, Văn thư, Tài liệu): bộ lọc cũ không ghi lên địa chỉ trang mới, không kéo về trang cũ', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await login(page, 'giamdoc');
  const gate = await apiGate(page);
  for (const [slow, input] of [['#/crm', 'crm-q'], ['#/vanthu?book=DEN', 'vt-q'], ['#/tai-lieu', 'doc-q']]) {
    await go(page, slow);
    await expect(page.getByTestId(input)).toBeVisible();
    await gate.idle();
    gate.hold(); // trang mới chậm: chưa vẽ được khi bộ hẹn giờ chờ gõ của trang cũ chạy
    await page.getByTestId(input).fill('loc-cu');
    await go(page, '#/me');
    await page.waitForTimeout(800);
    gate.pass();
    gate.release();
    await expect(h1(page), slow).toHaveText('Thông tin cá nhân');
    await gate.idle();
    expect(hashOf(page), slow).toBe('#/me');
  }
});
