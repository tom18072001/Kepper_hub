// Review UX đợt C1 — Văn thư (dữ liệu mẫu GIẢ, MODULES có vanthu): trang trống mời "Vào sổ văn bản đầu tiên" (chỉ người được vào sổ),
// lọc ngay khi gõ / chọn (không còn nút "Lọc", gõ thì chờ ~300 ms, bộ lọc giữ trên URL, gõ không dấu vẫn ra), và panel chi tiết việc → "Thêm văn bản"
// → "Chọn từ sổ Văn thư": tìm theo số / trích yếu (không dấu), điền sẵn số, ngày, nơi ban hành, trích yếu, liên kết;
// chỉ văn bản Công khai / Nội bộ chưa hủy người dùng xem được — văn bản Hạn chế, Bảo mật cao không hiện kể cả với người xem được trong sổ.
const { test, expect } = require('@playwright/test');
const { login, apiAs, toast, vnDate } = require('./helpers');

test.describe.configure({ mode: 'serial' });

const go = (page, hash) => page.evaluate(h => { location.hash = h; }, hash);
const hashParams = page => new URLSearchParams(new URL(page.url()).hash.split('?')[1] || '');
async function reg(page, data) {
  const r = await apiAs(page, '/api/vanthu/docs', { method: 'POST', data: { series: 'D10', entity: 'HLD', ...data } });
  expect(r.status(), await r.text()).toBe(201);
  return r.json();
}

test('C1.2 Văn thư trống: "Chưa có văn bản trong sổ năm này" kèm nút "Vào sổ văn bản đầu tiên" — chỉ người được vào sổ thấy nút', async ({ browser }) => {
  // Cán bộ (không phải văn thư / Ban GĐ / lãnh đạo bộ phận): thấy câu trống, không có nút vào sổ.
  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.kinhdoanh1');
  await go(staff, '#/vanthu?book=DI');
  await expect(staff.getByTestId('vt-empty')).toContainText('Chưa có văn bản trong sổ năm này');
  await expect(staff.getByTestId('vt-new-first')).toHaveCount(0);
  await expect(staff.getByTestId('vt-new')).toHaveCount(0);

  const dir = await (await browser.newContext()).newPage();
  await login(dir, 'giamdoc');
  await go(dir, '#/vanthu?book=DI');
  await expect(dir.getByTestId('vt-empty')).toContainText('Chưa có văn bản trong sổ năm này');
  await expect(dir.getByTestId('vt-new-first')).toBeVisible();
  // Sổ năm trước: vào sổ luôn cấp số năm hiện tại → không mời ở năm cũ.
  const [thisYear, lastYear] = await dir.getByTestId('vt-year').locator('option').allTextContents();
  await dir.getByTestId('vt-year').selectOption(lastYear);
  await expect(dir.getByTestId('vt-new-first')).toHaveCount(0);
  await expect(dir.getByTestId('vt-empty')).toContainText('Chưa có văn bản trong sổ năm này');
  await dir.getByTestId('vt-year').selectOption(thisYear);
  await dir.getByTestId('vt-new-first').click();
  const form = dir.getByTestId('vt-form');
  await expect(form).toBeVisible();
  await expect(form.locator('#vtSeries')).toHaveValue('D9'); // đúng dãy của sổ đang xem (Văn bản đi)
  await dir.getByTestId('vt-f-title').fill('Công văn mẫu gửi đối tác (giả)');
  await dir.getByTestId('vt-f-save').click();
  await toast(dir, 'Đã vào sổ');
  await expect(dir).toHaveURL(/#\/vanthu\/\d+$/);
  await expect(dir.locator('#view h1')).toContainText(`/${thisYear}/`);
});

test('C1.1 Văn thư lọc ngay khi gõ / chọn, không còn nút "Lọc"; gõ thì chờ ~300 ms; gõ không dấu vẫn ra; bộ lọc giữ trên URL', async ({ page }) => {
  await login(page, 'giamdoc');
  expect((await apiAs(page, '/api/vanthu/config', { method: 'PUT', data: { entities: [{ code: 'HLD', name: 'Công ty mẹ (mẫu)' }, { code: 'DXA', name: 'Công ty dự án (mẫu)' }] } })).status()).toBe(200);
  await reg(page, { title: 'Công văn mẫu về phòng cháy chữa cháy', counterpart: 'Sở Mẫu A' });
  await reg(page, { title: 'Thông báo mẫu lịch họp quý', counterpart: 'Đơn vị giả B' });
  await reg(page, { title: 'Giấy mời mẫu đã quá hạn', counterpart: 'Đơn vị giả C', dueDate: vnDate(-3) });
  await reg(page, { title: 'Công văn mẫu của công ty dự án', counterpart: 'Đơn vị giả D', entity: 'DXA' });

  await go(page, '#/vanthu?book=DEN');
  const rows = page.getByTestId('vt-list').locator('tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(page.locator('#vtFilter button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Lọc', exact: true })).toHaveCount(0);

  // Gõ: danh sách tự lọc sau khi ngừng gõ, chỉ gọi máy chủ một lần cho cả cụm phím; ô tìm không mất con trỏ.
  let calls = 0;
  page.on('request', r => { if (r.url().includes('/api/vanthu/docs?')) calls++; });
  const q = page.getByTestId('vt-q');
  await q.click();
  await q.pressSequentially('lịch họp', { delay: 25 });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Thông báo mẫu lịch họp quý');
  await expect(q).toBeFocused();
  await page.waitForTimeout(500);
  expect(calls, 'gõ 8 ký tự liền nhau chỉ lọc sau khi ngừng gõ').toBeLessThanOrEqual(2);
  expect(calls).toBeGreaterThan(0);
  await expect.poll(() => hashParams(page).get('q')).toBe('lịch họp');
  // Xoá chữ → đủ lại; Enter thì lọc ngay.
  await q.fill('');
  await expect(rows).toHaveCount(4);
  await q.fill('phòng cháy');
  await q.press('Enter');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('phòng cháy chữa cháy');
  await q.fill('');
  await expect(rows).toHaveCount(4);
  // Gõ không dấu vẫn ra (như Tìm nhanh): theo trích yếu, nơi gửi, số ("D" thay "Đ").
  await q.fill('phong chay');
  await expect(rows.first()).toContainText('Công văn mẫu về phòng cháy chữa cháy');
  await expect(rows).toHaveCount(1);
  await q.fill('don vi gia b');
  await expect(rows.first()).toContainText('Thông báo mẫu lịch họp quý');
  await expect(rows).toHaveCount(1);
  await q.fill('d-dxa');
  await expect(rows.first()).toContainText('Công văn mẫu của công ty dự án');
  await expect(rows).toHaveCount(1);
  await q.fill('');
  await expect(rows).toHaveCount(4);

  // "Quá hạn": tích là lọc ngay.
  await page.getByTestId('vt-overdue').check();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Giấy mời mẫu đã quá hạn');
  await expect.poll(() => hashParams(page).get('overdue')).toBe('1');
  // Đổi năm: năm trước không có văn bản quá hạn → "không khớp bộ lọc" + "Xoá bộ lọc".
  const [thisYear, lastYear] = await page.getByTestId('vt-year').locator('option').allTextContents();
  await page.getByTestId('vt-year').selectOption(lastYear);
  await expect(page.getByTestId('vt-empty')).toContainText('Không có văn bản khớp bộ lọc');
  await page.getByTestId('vt-clear').click();
  await expect(page.getByTestId('vt-overdue')).not.toBeChecked();
  await expect(page.getByTestId('vt-empty')).toContainText('Chưa có văn bản trong sổ năm này');
  await expect(page.getByTestId('vt-new-first')).toHaveCount(0);
  await page.getByTestId('vt-year').selectOption(thisYear);
  await expect(rows).toHaveCount(4);

  // Pháp nhân: chọn là lọc ngay; tải lại trang vẫn giữ bộ lọc.
  await page.getByTestId('vt-entity').selectOption('DXA');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Công văn mẫu của công ty dự án');
  await expect.poll(() => hashParams(page).get('entity')).toBe('DXA');
  await page.reload();
  await expect(page.getByTestId('vt-entity')).toHaveValue('DXA');
  await expect(page.getByTestId('vt-list').locator('tbody tr')).toHaveCount(1);
});

test('C1.3 Chi tiết việc → Văn bản liên quan: "Chọn từ sổ Văn thư" điền sẵn; không lộ văn bản Hạn chế / Bảo mật cao / đã hủy', async ({ page, browser }) => {
  await login(page, 'giamdoc');
  const people = await (await apiAs(page, '/api/users/directory')).json();
  const kd1 = people.find(u => u.username === 'nv.kinhdoanh1');
  const ok = await reg(page, { title: 'Công văn mẫu đề nghị cấp phép xây dựng', counterpart: 'Sở Xây dựng Mẫu', externalNumber: '12/SXD-MAU', docDate: vnDate(-5), security: 'NOI_BO' });
  const hanChe = await reg(page, { title: 'Tờ trình mẫu hạn chế về cấp phép', security: 'HAN_CHE', handlerId: kd1.id });
  await reg(page, { title: 'Văn bản mẫu bảo mật cao về cấp phép', security: 'BAO_MAT_CAO' });
  const huy = await reg(page, { title: 'Công văn mẫu cấp phép vào sổ nhầm', security: 'NOI_BO' });
  expect((await apiAs(page, `/api/vanthu/docs/${huy.id}/cancel`, { method: 'POST', data: { reason: 'Vào sổ nhầm (giả)' } })).status()).toBe(200);

  // API: chỉ văn bản Công khai / Nội bộ, chưa hủy — Giám đốc (xem mọi mức trong sổ) cũng không chọn được Hạn chế / Bảo mật cao.
  const pick = async (pg, q) => (await (await apiAs(pg, '/api/vanthu/pick?' + new URLSearchParams({ q }))).json());
  expect((await pick(page, 'cap phep')).map(d => d.id)).toEqual([ok.id]);
  const all = await pick(page, '');
  expect(all.length).toBeGreaterThan(0);
  expect(all.every(d => ['CONG_KHAI', 'NOI_BO'].includes(d.security.code))).toBe(true);
  // Người xử lý văn bản Hạn chế vẫn xem được trong sổ như cũ (quyền sổ không đổi) nhưng không gắn được vào việc.
  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.kinhdoanh1');
  expect((await apiAs(staff, `/api/vanthu/docs/${hanChe.id}`)).status()).toBe(200);
  expect((await pick(staff, 'cap phep')).map(d => d.id)).toEqual([ok.id]);

  // Giao diện: việc mẫu trong dự án KD.
  const kd = (await (await apiAs(page, '/api/projects')).json()).find(p => p.key === 'KD');
  const cr = await apiAs(page, `/api/projects/${kd.id}/items`, { method: 'POST', data: { title: 'Việc mẫu gắn văn bản từ sổ (giả)' } });
  expect(cr.status(), await cr.text()).toBe(201);
  const item = await cr.json();
  await go(page, `#/projects/${kd.id}?view=list&item=${item.id}`);
  const panel = page.getByTestId('item-panel');
  await panel.getByTestId('ip-tab-results').click();
  await panel.getByTestId('document-open').click();
  await expect(panel.getByTestId('document-pick')).toContainText('Chọn từ sổ Văn thư');
  const items = panel.getByTestId('document-pick-item');
  await expect(items.first()).toBeVisible(); // mở ra là có văn bản mới vào sổ để chọn
  // Tìm theo số (gõ không dấu "D" thay "Đ").
  await panel.getByTestId('document-pick-q').fill(ok.number.replace('Đ', 'D'));
  await expect(items).toHaveCount(1);
  await expect(items).toContainText(ok.number);
  // Tìm theo trích yếu, không dấu: chỉ văn bản Nội bộ — không có Hạn chế, Bảo mật cao, văn bản đã hủy.
  await panel.getByTestId('document-pick-q').fill('cap phep');
  await expect(items).toHaveCount(1);
  await expect(items).toContainText('Công văn mẫu đề nghị cấp phép xây dựng');
  for (const t of ['hạn chế', 'bảo mật cao', 'vào sổ nhầm']) await expect(panel.getByTestId('document-pick-list')).not.toContainText(t);
  await panel.getByTestId('document-pick-q').fill('khong co van ban nay');
  await expect(panel.getByTestId('document-pick-empty')).toContainText('Không có văn bản phù hợp');
  await panel.getByTestId('document-pick-q').fill('cap phep');
  await expect(items).toHaveCount(1);
  await items.click();
  await expect(panel.getByTestId('document-number')).toHaveValue(ok.number);
  await expect(panel.getByTestId('document-summary')).toHaveValue(ok.title);
  await expect(panel.locator('#docIssuer')).toHaveValue('Sở Xây dựng Mẫu · số 12/SXD-MAU');
  await expect(panel.locator('#docDate')).toHaveValue(vnDate(-5));
  await expect(panel.locator('#docUrl')).toHaveValue(new RegExp(`#/vanthu/${ok.id}$`));
  await expect(items).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByTestId('document-pick-note')).toContainText(ok.number);
  await panel.getByTestId('document-submit').click();
  await toast(page, 'Đã thêm văn bản');
  const row = panel.getByTestId('tw-doc').filter({ hasText: ok.number });
  await expect(row).toContainText(ok.title);
  await expect(row.locator('a')).toHaveAttribute('href', new RegExp(`#/vanthu/${ok.id}$`));
  const saved = (await (await apiAs(page, `/api/items/${item.id}`)).json()).documents.find(d => d.number === ok.number);
  expect(saved).toMatchObject({ summary: ok.title, issuer: 'Sở Xây dựng Mẫu · số 12/SXD-MAU' });
});
