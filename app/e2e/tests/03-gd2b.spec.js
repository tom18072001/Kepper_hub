// GĐ2b (phản hồi 16/10/2026): duyệt linh hoạt (chọn tay + quy tắc tự động, chặn tự duyệt), lặp lại & chu kỳ ngay từ panel,
// nhãn gõ để tạo, ghi chú cá nhân riêng tư, admin IT không xem công việc, KPI cho giám đốc.
// Chạy sau 01-core trên cùng CSDL test. Dự án mẫu KD có quy trình 2 cấp: Trưởng phòng → Giám đốc.
const { test, expect } = require('@playwright/test');
const { login, apiAs, openProject, column, card, toast } = require('./helpers');

test.describe.configure({ mode: 'serial' });

async function createItem(page, title, { level, assignee } = {}) {
  await page.getByTestId('new-item').click();
  await page.getByTestId('create-title').fill(title);
  if (level !== undefined) { await page.getByTestId('create-more').locator('summary').click(); await page.getByTestId('create-approval-levels').selectOption(String(level)); }
  if (assignee) await page.getByTestId('create-lead').selectOption({ label: assignee });
  await page.getByTestId('create-submit').click();
  await toast(page, 'Đã tạo KD-');
  const c = page.locator('.kcard', { hasText: title });
  await expect(c).toBeVisible();
  return c;
}

test('9. Duyệt linh hoạt: người giao duyệt + chấm mức; việc chỉ cần trưởng phòng; nhân viên không tự hạ mức duyệt; không tự duyệt', async ({ browser }) => {
  const manager = await (await browser.newContext()).newPage();
  await login(manager, 'tp.kinhdoanh');
  await openProject(manager, 'KD');

  // a) Việc nhỏ: "Chỉ người giao duyệt". Gửi duyệt là bước của người chủ trì — trưởng phòng (người giao) không bấm "Hoàn thành"
  //    thay (ô khoá, API 403); người chủ trì gửi duyệt → người giao duyệt, bắt buộc chấm mức hoàn thành rồi mới thành Hoàn thành.
  const small = await createItem(manager, 'In 50 bộ tài liệu hội thảo', { level: 0, assignee: 'Phạm Văn An' });
  await small.click();
  await expect(manager.getByTestId('approval-section')).toContainText('Quy trình duyệt 1 cấp');
  await expect(manager.getByTestId('item-state').locator('option', { hasText: 'Hoàn thành' })).toHaveAttribute('disabled', '');
  await expect(manager.getByTestId('submit-approval')).toHaveCount(0);
  const smallId = await small.getAttribute('data-id');
  await manager.getByTestId('close-panel').click();
  const doer = await (await browser.newContext()).newPage();
  await login(doer, 'nv.kinhdoanh1');
  const kdId = (await (await apiAs(doer, '/api/projects')).json()).find(p => p.key === 'KD').id;
  const reviewState = (await (await apiAs(doer, `/api/projects/${kdId}`)).json()).states.find(s => s.category === 'REVIEW');
  expect((await apiAs(manager, `/api/items/${smallId}`, { method: 'PATCH', data: { stateId: reviewState.id } })).status()).toBe(403);
  expect((await apiAs(doer, `/api/items/${smallId}`, { method: 'PATCH', data: { stateId: reviewState.id } })).status()).toBe(200);
  await manager.reload();
  const smallCard = column(manager, 'Chờ duyệt').locator('.kcard', { hasText: 'In 50 bộ tài liệu hội thảo' });
  await expect(smallCard).toBeVisible();
  await smallCard.click();
  await manager.getByTestId('approve-btn').click();
  await toast(manager, 'Hãy chấm mức hoàn thành');
  await manager.getByTestId('rating-PASS').check();
  await manager.getByTestId('approval-comment').fill('Đúng số lượng (giả)');
  await manager.getByTestId('approve-btn').click();
  await toast(manager, 'Đã duyệt');
  await expect(column(manager, 'Hoàn thành').locator('.kcard', { hasText: 'In 50 bộ tài liệu hội thảo' })).toBeVisible();
  await expect(manager.getByTestId('item-rating')).toContainText('Đạt');
  await expect(manager.getByTestId('item-review').first()).toHaveText('Đúng số lượng (giả)');
  await manager.getByTestId('close-panel').click();

  // b) Việc thường: chỉ cần trưởng phòng duyệt (1 cấp), giao cho nhân viên.
  const item = await createItem(manager, 'Gửi báo giá cho khách hàng Minh Phát', { level: 1, assignee: 'Phạm Văn An' });
  const code = await item.locator('.code').textContent();

  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.kinhdoanh1');
  await openProject(staff, 'KD');
  await card(staff, code).click();
  // Nhân viên chỉ thấy mức duyệt, không đổi được (giao diện + API).
  await expect(staff.getByTestId('item-approval-levels')).toHaveCount(0);
  await expect(staff.getByTestId('approval-level-text')).toContainText('Người giao → 1 cấp');
  const id = await card(staff, code).getAttribute('data-id');
  expect((await apiAs(staff, `/api/items/${id}`, { method: 'PATCH', data: { approvalLevels: 0 } })).status()).toBe(403);
  await staff.getByTestId('submit-approval').click();
  await toast(staff, 'Đã gửi người giao duyệt');
  await expect(card(staff, code).getByTestId('approval-chip')).toHaveText('Chờ duyệt 1/2');
  // Người chủ trì không có nút duyệt, API trả 403.
  await expect(staff.getByTestId('approve-btn')).toHaveCount(0);
  const sp = (await (await apiAs(staff, `/api/items/${id}`)).json()).approvals.find(a => a.status === 'PENDING');
  expect((await (await apiAs(staff, `/api/approvals/${sp.id}/approve`, { method: 'POST', data: { rating: 'EXCELLENT' } })).json()).code).toBe('SELF_APPROVAL');

  // Giám đốc không bị làm phiền: việc 1 cấp không vào hàng chờ của giám đốc.
  const director = await (await browser.newContext()).newPage();
  await login(director, 'giamdoc');
  const dq = await (await apiAs(director, '/api/approvals/queue')).json();
  expect(dq.some(q => q.item.code === code)).toBe(false);

  // Trưởng phòng (người giao) duyệt + chấm mức → cấp "Trưởng phòng" của dự án cũng là chính người này nên tự qua → hoàn thành
  // (không cần cấp giám đốc). Khi đang chờ duyệt thì mức duyệt bị khoá.
  await manager.reload();
  await card(manager, code).click();
  await expect(manager.getByTestId('item-approval-levels')).toHaveCount(0);
  expect((await apiAs(manager, `/api/items/${id}`, { method: 'PATCH', data: { approvalLevels: 2 } })).status()).toBe(409);
  await manager.getByTestId('rating-GOOD').check();
  await manager.getByTestId('approve-btn').click();
  await toast(manager, 'Đã duyệt');
  await expect(manager.getByTestId('approval-status')).toHaveText('Đã duyệt');
  await expect(column(manager, 'Hoàn thành').getByTestId(`card-${code}`)).toBeVisible();
  await manager.getByTestId('close-panel').click();

  // c) Không tự duyệt: trưởng phòng tự giao cho mình (chủ trì) rồi gửi duyệt → không có nút duyệt, API trả 403.
  const own = await createItem(manager, 'Đề xuất ngân sách quảng cáo tháng 11', { level: 1, assignee: 'Lê Thu Hà (tôi)' });
  const ownCode = await own.locator('.code').textContent();
  await own.click();
  await manager.getByTestId('submit-approval').click();
  await toast(manager, 'Đã gửi người giao duyệt');
  await expect(manager.getByTestId('approval-status')).toHaveText('Đang chờ duyệt');
  await expect(manager.getByTestId('approve-btn')).toHaveCount(0);
  const ownId = await card(manager, ownCode).getAttribute('data-id');
  const detail = await (await apiAs(manager, `/api/items/${ownId}`)).json();
  const pending = detail.approvals.find(a => a.status === 'PENDING');
  const self = await apiAs(manager, `/api/approvals/${pending.id}/approve`, { method: 'POST', data: {} });
  expect(self.status()).toBe(403);
  expect((await self.json()).code).toBe('SELF_APPROVAL');
  await manager.getByTestId('close-panel').click();
});

test('10. Quy tắc duyệt tự động + nhãn: mặc định 1 cấp, nhãn "Hợp đồng" tự cần 2 cấp; gõ để tạo nhãn mới ngay trong việc', async ({ page }) => {
  await login(page, 'tp.kinhdoanh');
  await openProject(page, 'KD');

  // Nhãn mới tạo ngay khi gắn nhãn cho việc (không cần vào trang quản trị).
  const c = page.locator('.kcard', { hasText: 'Lập danh sách khách hàng tiềm năng' });
  await c.click();
  await page.getByTestId('multi-labels').click();
  await page.getByTestId('multi-labels-search').fill('Hợp đồng');
  await page.getByTestId('multi-labels-create').click();
  await page.getByTestId('item-title').click(); // đóng danh sách → lưu nhãn
  await expect(c.locator('.label', { hasText: 'Hợp đồng' })).toBeVisible();
  // Gõ lại tên khác hoa/thường không tạo nhãn trùng.
  await page.getByTestId('multi-labels').click();
  await page.getByTestId('multi-labels-search').fill('hợp đồng');
  await expect(page.getByTestId('multi-labels-create')).toBeHidden();
  await page.getByTestId('item-title').click();
  await page.getByTestId('close-panel').click();

  // Cài đặt: mặc định chỉ cấp 1; quy tắc nhãn "Hợp đồng" → đủ 2 cấp.
  await page.getByTestId('ph-more').click(); await page.getByTestId('project-settings').click();
  await page.getByTestId('default-levels').selectOption('1');
  await page.getByTestId('save-steps').click();
  await toast(page, 'Đã lưu quy trình duyệt');
  const rule = page.getByTestId('rules-editor').locator('[data-row]').first();
  // Trang cài đặt có thể vẽ lại sau khi lưu quy trình (sự kiện thời gian thực) → thêm hàng quy tắc lại tới khi chọn được nhãn.
  await expect(async () => {
    if (!(await rule.locator('[name=label]').isVisible())) await page.getByTestId('add-rule').click();
    await rule.locator('[name=label]').selectOption({ label: 'Hợp đồng' }, { timeout: 2000 });
  }).toPass();
  await rule.getByTestId('rule-levels').selectOption('2');
  await page.getByTestId('save-rules').click();
  await toast(page, 'Đã lưu quy tắc duyệt');
  await expect(page.getByTestId('steps-editor')).toContainText('Người duyệt: Lê Thu Hà');

  await page.getByRole('link', { name: 'Về bảng công việc' }).click();
  await c.click();
  await expect(page.getByTestId('approval-section')).toContainText('Quy trình duyệt 3 cấp'); // người giao + 2 cấp dự án
  await expect(page.getByTestId('approval-section')).toContainText('theo quy tắc tự động');
  await page.getByTestId('close-panel').click();
  await page.locator('.kcard', { hasText: 'Tổng hợp doanh số tháng' }).click();
  await expect(page.getByTestId('approval-section')).toContainText('Quy trình duyệt 2 cấp');
  await expect(page.getByTestId('approval-section')).toContainText('mặc định của dự án');
  // Chọn tay luôn thắng quy tắc.
  await page.getByTestId('item-approval-levels').selectOption('2');
  await expect(page.getByTestId('approval-section')).toContainText('Quy trình duyệt 3 cấp');
  await expect(page.getByTestId('approval-section')).toContainText('chọn tay');
  await page.getByTestId('close-panel').click();
});

test('11. Ghi chú cá nhân riêng tư: người khác (kể cả cấp trên, admin) không đọc, sửa, xoá được', async ({ browser }) => {
  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.kinhdoanh1');
  await staff.getByTestId('nav-my').click();
  await staff.getByTestId('my-notes').click();
  await staff.getByTestId('note-input').fill('Gọi lại anh Nam về hợp đồng bảo trì');
  await staff.getByTestId('note-input').press('Enter');
  await expect(staff.locator('.note', { hasText: 'Gọi lại anh Nam' })).toBeVisible();
  const notes = await (await apiAs(staff, '/api/me/notes')).json();
  const noteId = notes.find(x => x.title.startsWith('Gọi lại anh Nam')).id;
  for (const user of ['tp.kinhdoanh', 'admin']) {
    const other = await (await browser.newContext()).newPage();
    await login(other, user);
    const list = await (await apiAs(other, '/api/me/notes')).json();
    expect(list.some(x => x.id === noteId)).toBe(false);
    expect((await apiAs(other, `/api/me/notes/${noteId}`, { method: 'PATCH', data: { title: 'x' } })).status()).toBe(404);
    expect((await apiAs(other, `/api/me/notes/${noteId}`, { method: 'DELETE' })).status()).toBe(404);
  }
});

test('12. Admin IT chỉ quản trị: không thấy dự án, công việc, dashboard, KPI; giám đốc xem KPI phòng ban & cá nhân; nhân viên không thấy khối lượng việc theo tên', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await login(admin, 'admin');
  await expect(admin.locator('#crumbs')).toContainText('Tài khoản');
  await expect(admin.getByTestId('nav-my')).toBeHidden();
  await expect(admin.locator('#projectNav')).toBeHidden();
  expect(await (await apiAs(admin, '/api/projects')).json()).toEqual([]);
  for (const path of ['/api/items/1', '/api/projects/1', '/api/projects/1/items']) expect((await apiAs(admin, path)).status()).toBe(404);
  for (const path of ['/api/dashboard', '/api/kpi']) expect((await apiAs(admin, path)).status()).toBe(403);
  expect(await (await apiAs(admin, '/api/approvals/queue')).json()).toEqual([]);
  // Mở link việc trực tiếp → quay về trang quản trị.
  await admin.goto('/#/projects/1?item=1');
  await expect(admin.locator('#crumbs')).toContainText('Tài khoản');

  const director = await (await browser.newContext()).newPage();
  await login(director, 'giamdoc');
  // KPI tổng hợp (API) chỉ Ban lãnh đạo; KPI tiến độ theo dự án nằm ở Tổng quan dự án MTL.
  const kpi = await (await apiAs(director, '/api/kpi')).json();
  expect(kpi.byDepartment.some(r => r.name === 'Phòng Kinh doanh')).toBe(true);

  const manager = await (await browser.newContext()).newPage();
  await login(manager, 'tp.kinhdoanh');
  expect((await apiAs(manager, '/api/kpi')).status()).toBe(403);

  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.kinhdoanh2');
  const dash = await (await apiAs(staff, '/api/dashboard')).json();
  expect(dash.peopleVisible).toBe(false);
  expect(dash.workload).toEqual([]);
});
