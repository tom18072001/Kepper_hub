// Kịch bản E2E chạy tuần tự trên cùng một CSDL test (dữ liệu giả từ seed).
const { test, expect } = require('@playwright/test');
const ExcelJS = require('../../server/node_modules/exceljs');
const { login, apiAs, vnDate, openProject, column, card, toast } = require('./helpers');

test.describe.configure({ mode: 'serial' });

test('1. Đăng nhập: sai mật khẩu bị từ chối, tài khoản mới phải đổi mật khẩu', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-username').fill('nv.kinhdoanh1');
  await page.getByTestId('login-password').fill('sai-mat-khau');
  await page.getByTestId('login-submit').click();
  await expect(page.locator('#loginError')).toHaveText('Tài khoản hoặc mật khẩu không đúng');

  await login(page, 'nv.kinhdoanh1');
  await expect(page.locator('#meName')).toHaveText('Phạm Văn An');
  // Việc của tôi: KD-1 và KD-4 được giao cho nhân viên này
  await expect(page.getByTestId('my-KD-1')).toBeVisible();
  await expect(page.getByTestId('my-KD-4')).toBeVisible();
  await expect(page.getByTestId('my-group-overdue')).toContainText('KD-4');
  // Nhân viên không thấy menu quản trị
  await expect(page.locator('#adminNav')).toBeHidden();
});

test('2. Quản trị: tạo phòng ban, tạo tài khoản, phân quyền, nhật ký hệ thống', async ({ page }) => {
  await login(page, 'admin');
  await page.getByTestId('nav-admin-departments').click();
  await page.getByTestId('add-department').click();
  await page.getByTestId('dept-code').fill('MKT');
  await page.getByTestId('dept-name').fill('Phòng Marketing');
  await page.getByTestId('dept-save').click();
  await expect(page.getByTestId('dept-MKT')).toContainText('Phòng Marketing');

  await page.getByTestId('nav-admin-users').click();
  await page.getByTestId('add-user').click();
  await page.getByTestId('user-username').fill('nv.marketing');
  await page.getByTestId('user-fullname').fill('Trịnh Thu Trang');
  await page.getByTestId('user-role').selectOption('member');
  await page.getByTestId('user-department').selectOption({ label: 'Phòng Marketing' });
  await page.getByTestId('user-save').click();
  await expect(page.getByTestId('user-nv.marketing')).toContainText('Chờ đổi mật khẩu');

  // Phân quyền: cấp thêm quyền xem dashboard toàn tổ chức
  await page.getByTestId('perm-nv.marketing').click();
  await expect(page.getByTestId('grant-work.view-VIEW')).toHaveValue('UNIT');
  await page.getByTestId('grant-reports.dashboard-VIEW').selectOption('SYSTEM');
  await page.getByTestId('perm-save').click();
  await toast(page, 'Đã lưu phân quyền');

  await page.getByTestId('nav-admin-audit').click();
  const audit = page.getByTestId('audit-table');
  await expect(audit).toContainText('PERMISSION_UPDATE');
  await expect(audit).toContainText('Department');
  await expect(audit).toContainText('LOGIN');
});

test('3. Trưởng phòng tạo dự án, cấu hình WIP, thành viên và quy trình duyệt 2 cấp', async ({ page }) => {
  await login(page, 'tp.kinhdoanh');
  await page.getByTestId('new-project').click();
  await page.getByTestId('project-key').fill('SK');
  await page.getByTestId('project-name').fill('Sự kiện khách hàng');
  // Trưởng phòng chỉ tạo được dự án cho phòng ban của mình
  await expect(page.getByTestId('project-department').locator('option')).toHaveCount(1);
  // Tạo dự án chưa có duyệt; các cấp duyệt được cấu hình sau trong Cài đặt.
  await page.getByTestId('project-approval-template').selectOption('0');
  await page.getByTestId('project-save').click();
  await expect(page.locator('#crumbs')).toContainText('Sự kiện khách hàng');
  await expect(column(page, 'Cần làm')).toBeVisible();

  await page.getByTestId('ph-more').click(); await page.getByTestId('project-settings').click();
  await page.getByTestId('wip-Đang làm').fill('1');
  await page.getByTestId('save-states').click();
  await toast(page, 'Đã lưu cột');
  await expect(page.getByTestId('wip-Đang làm')).toHaveValue('1');

  await page.getByTestId('add-step').click();
  await page.getByTestId('add-step').click();
  await page.getByTestId('step-type').nth(0).selectOption('DEPARTMENT_MANAGER');
  await page.getByTestId('step-name').nth(0).fill('Trưởng phòng duyệt');
  await page.getByTestId('step-type').nth(1).selectOption('DIRECTOR');
  await page.getByTestId('step-name').nth(1).fill('Giám đốc duyệt');
  await page.getByTestId('save-steps').click();
  await toast(page, 'Đã lưu quy trình duyệt');
  await expect(page.getByTestId('steps-editor')).toContainText('Người duyệt:'); // trang cài đặt đã tải lại xong

  await page.getByTestId('new-member').selectOption({ label: 'Đỗ Thị Bình (nv.kinhdoanh2)' });
  await page.getByTestId('add-member').click();
  await page.getByTestId('save-members').click();
  await toast(page, 'Đã lưu thành viên');
  await expect(page.getByTestId('members-editor')).toContainText('Đỗ Thị Bình');
});

test('4. Kanban: tạo việc (form + thêm nhanh), kéo-thả giữa các cột, chặn vượt giới hạn WIP', async ({ page }) => {
  await login(page, 'nv.kinhdoanh2');
  await openProject(page, 'SK');
  await page.getByTestId('new-item').click();
  await page.getByTestId('create-title').fill('Đặt hội trường hội nghị khách hàng');
  await page.getByTestId('create-more').locator('summary').click();
  await page.getByTestId('create-description').fill('Sức chứa 200 người, có màn hình LED.');
  await page.getByTestId('create-priority').selectOption('HIGH');
  await page.getByTestId('create-start').fill(vnDate(0));
  await page.getByTestId('create-due').fill(vnDate(2));
  await page.getByTestId('multi-assignees').click();
  await page.locator('[data-multi="assignees"] label', { hasText: 'Đỗ Thị Bình' }).locator('input').check();
  await page.getByTestId('create-submit').click();
  await toast(page, 'Đã tạo SK-1');
  await expect(card(page, 'SK-1')).toContainText('CAO');

  await page.getByTestId('quick-add-Cần làm').click();
  await page.getByTestId('quick-input').fill('In thư mời');
  await page.getByTestId('quick-input').press('Enter');
  await expect(card(page, 'SK-2')).toBeVisible();
  await expect(page.getByTestId('count-Cần làm')).toHaveText('2');

  // Kéo SK-1 sang Đang làm
  await card(page, 'SK-1').dragTo(column(page, 'Đang làm').locator('.col-body'));
  await expect(column(page, 'Đang làm').getByTestId('card-SK-1')).toBeVisible();
  await expect(page.getByTestId('count-Đang làm')).toHaveText('1');
  // Kéo SK-2 sang Đang làm: vượt WIP = 1 → bị chặn, thẻ ở lại cột cũ
  await card(page, 'SK-2').dragTo(column(page, 'Đang làm').locator('.col-body'));
  await toast(page, 'đã đạt giới hạn WIP 1');
  await expect(column(page, 'Cần làm').getByTestId('card-SK-2')).toBeVisible();
  await expect(column(page, 'Đang làm')).toHaveClass(/over-wip/);
  // Không được chuyển thẳng sang Hoàn thành khi dự án yêu cầu duyệt (qua panel chi tiết)
  await card(page, 'SK-2').click();
  const doneValue = await page.getByTestId('item-state').locator('option', { hasText: 'Hoàn thành' }).getAttribute('value');
  await page.getByTestId('item-state').selectOption(doneValue);
  await toast(page, 'Việc cần được duyệt trước khi hoàn thành');
  await expect(page.getByTestId('item-state')).not.toHaveValue(doneValue);
  await page.getByTestId('close-panel').click();
  await expect(column(page, 'Cần làm').getByTestId('card-SK-2')).toBeVisible();
});

test('5. Chi tiết việc: mô tả, checklist, việc con, đính kèm (chặn loại tệp lạ), tải xuống, bình luận @mention', async ({ page }) => {
  await login(page, 'nv.kinhdoanh2');
  await openProject(page, 'SK');
  await card(page, 'SK-1').click();
  const panel = page.getByTestId('item-panel');
  await expect(panel.getByTestId('item-code')).toHaveText('SK-1');
  await expect(panel.getByTestId('item-description')).toContainText('Sức chứa 200 người');

  await panel.getByTestId('checklist-input').fill('Xác nhận báo giá hội trường');
  await panel.getByTestId('checklist-input').press('Enter');
  await panel.getByTestId('checklist-input').fill('Ký hợp đồng thuê');
  await panel.getByTestId('checklist-input').press('Enter');
  await expect(panel.getByTestId('checklist')).toContainText('Ký hợp đồng thuê');
  await panel.getByTestId('checklist').getByLabel('Xác nhận báo giá hội trường').check();
  await expect(panel.locator('.section h4', { hasText: 'Checklist' })).toContainText('1/2');

  await panel.getByTestId('child-input').fill('Chuẩn bị âm thanh ánh sáng');
  await panel.getByTestId('child-input').press('Enter');
  await expect(panel).toContainText('SK-3');

  // Tệp PDF hợp lệ
  await panel.getByTestId('attach-input').setInputFiles({ name: 'bao-gia-hoi-truong.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF') });
  await toast(page, 'Đã tải tệp lên');
  await expect(panel.getByTestId('attachments')).toContainText('bao-gia-hoi-truong.pdf');
  // Tệp thực thi giả dạng → bị từ chối
  await panel.getByTestId('attach-input').setInputFiles({ name: 'cai-dat.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ\x90\x00') });
  await toast(page, 'Loại tệp không được phép');
  // Đuôi .pdf nhưng nội dung không phải PDF → bị từ chối
  await panel.getByTestId('attach-input').setInputFiles({ name: 'gia-mao.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html><script>alert(1)</script></html>') });
  await toast(page, 'Nội dung tệp không khớp');
  await expect(panel.getByTestId('attachments')).not.toContainText('gia-mao.pdf');

  const downloadPromise = page.waitForEvent('download');
  await panel.getByTestId('download-bao-gia-hoi-truong.pdf').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('bao-gia-hoi-truong.pdf');

  await panel.getByTestId('comment-input').fill('@tp.kinhdoanh nhờ anh/chị xem báo giá giúp em');
  await panel.getByTestId('comment-submit').click();
  await expect(panel.getByTestId('comments')).toContainText('nhờ anh/chị xem báo giá');
  await expect(panel.getByTestId('activity')).toContainText('đã đính kèm bao-gia-hoi-truong.pdf');
  await expect(panel.getByTestId('activity')).toContainText('chuyển Cần làm → Đang làm');
  await panel.getByTestId('close-panel').click();
  await expect(card(page, 'SK-1').locator('[data-meta="checklist"]')).toHaveText('1/2');
  await expect(card(page, 'SK-1').locator('[data-meta="attachments"]')).toHaveText('1');
});

test('6. Duyệt nhiều cấp: gửi duyệt → trưởng phòng trả lại → gửi lại → trưởng phòng duyệt → giám đốc duyệt → tự hoàn thành', async ({ browser }) => {
  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.kinhdoanh2');
  await openProject(staff, 'SK');
  await card(staff, 'SK-1').dragTo(column(staff, 'Chờ duyệt').locator('.col-body'));
  await toast(staff, 'Đã gửi duyệt: Trưởng phòng duyệt');
  await expect(column(staff, 'Chờ duyệt').getByTestId('card-SK-1').getByTestId('approval-chip')).toHaveText('Chờ duyệt 1/2');
  // Người gửi không tự duyệt được
  await card(staff, 'SK-1').click();
  await expect(staff.getByTestId('approve-btn')).toHaveCount(0);
  await expect(staff.getByTestId('approval-status')).toHaveText('Đang chờ duyệt');

  // Trưởng phòng: hàng chờ duyệt, trả lại có lý do
  const manager = await (await browser.newContext()).newPage();
  await login(manager, 'tp.kinhdoanh');
  await expect(manager.locator('#approvalBadge')).toHaveText('1');
  await manager.goto('/#/approvals');
  await manager.getByTestId('queue-SK-1').click();
  await manager.getByTestId('reject-btn').click();
  await toast(manager, 'Hãy nhập lý do trả lại');
  await manager.getByTestId('approval-comment').fill('Thiếu báo giá so sánh của 2 nhà cung cấp');
  await manager.getByTestId('reject-btn').click();
  await toast(manager, 'Đã trả lại');
  await expect(manager.getByTestId('approval-status')).toHaveText('Bị trả lại');
  await expect(manager.getByTestId('item-state')).toHaveValue(await manager.getByTestId('item-state').locator('option', { hasText: 'Đang làm' }).getAttribute('value'));

  // Nhân viên thấy thông báo, gửi lại từ panel
  await staff.getByTestId('close-panel').click();
  await staff.reload();
  await expect(staff.getByTestId('notif-count')).toBeVisible();
  await staff.getByTestId('notif-btn').click();
  await expect(staff.getByTestId('notif-item').first()).toContainText('bị trả lại ở bước Trưởng phòng duyệt');
  await staff.getByTestId('notif-item').first().click();
  await expect(staff.getByTestId('item-code')).toHaveText('SK-1');
  await expect(staff.getByTestId('approval-section')).toContainText('Thiếu báo giá so sánh');
  await staff.getByTestId('submit-approval').click();
  await toast(staff, 'Đã gửi duyệt');

  // Trưởng phòng duyệt cấp 1
  await manager.goto('/#/approvals');
  await manager.getByTestId('queue-SK-1').click();
  await manager.getByTestId('approval-comment').fill('Đồng ý');
  await manager.getByTestId('approve-btn').click();
  await toast(manager, 'Đã duyệt');
  await manager.goto('/#/approvals');
  await expect(manager.getByTestId('approval-empty')).toBeVisible();

  // Giám đốc duyệt cấp 2 → việc tự chuyển sang Hoàn thành
  const director = await (await browser.newContext()).newPage();
  await login(director, 'giamdoc');
  await director.goto('/#/approvals');
  await expect(director.getByTestId('queue-SK-1')).toContainText('2/2 · Giám đốc duyệt');
  await director.getByTestId('queue-SK-1').click();
  await director.getByTestId('approve-btn').click();
  await toast(director, 'Đã duyệt');
  await expect(director.getByTestId('approval-status')).toHaveText('Đã duyệt');

  await staff.goto('/');
  await openProject(staff, 'SK');
  await expect(column(staff, 'Hoàn thành').getByTestId('card-SK-1')).toBeVisible();
  await card(staff, 'SK-1').click();
  await expect(staff.getByTestId('activity')).toContainText('duyệt bước cuối — việc hoàn thành');
  // WIP đã giải phóng: SK-2 vào Đang làm được
  await staff.getByTestId('close-panel').click();
  await card(staff, 'SK-2').dragTo(column(staff, 'Đang làm').locator('.col-body'));
  await expect(column(staff, 'Đang làm').getByTestId('card-SK-2')).toBeVisible();
});

test('7. Phân quyền dữ liệu: phòng ban khác không thấy dự án và không truy cập được qua URL/API', async ({ page }) => {
  await login(page, 'nv.kythuat');
  await expect(page.getByTestId('nav-project-KT')).toBeVisible();
  await expect(page.getByTestId('nav-project-SK')).toHaveCount(0);
  await expect(page.getByTestId('nav-project-KD')).toHaveCount(0);
  const projects = await (await apiAs(page, '/api/projects')).json();
  const sk = projects.find(p => p.key === 'SK');
  expect(sk).toBeUndefined();
  expect((await apiAs(page, '/api/projects/3')).status()).toBe(404);
  expect((await apiAs(page, '/api/items/8')).status()).toBe(404);
  expect((await apiAs(page, '/api/admin/users')).status()).toBe(403);
  expect((await apiAs(page, '/api/projects/1/items', { method: 'POST', data: { title: 'chen ngang' } })).status()).toBe(404);
  // Thùng rác: không xoá được việc / dự án của phòng khác, không xoá được dự án mình không quản lý.
  expect((await apiAs(page, '/api/items/8', { method: 'DELETE' })).status()).toBe(404);
  expect((await apiAs(page, '/api/projects/3', { method: 'DELETE' })).status()).toBe(404);
  const kt = projects.find(p => p.key === 'KT');
  expect((await apiAs(page, `/api/projects/${kt.id}`, { method: 'DELETE' })).status()).toBe(403);
  await page.goto('/#/projects/3');
  await expect(page.locator('#view')).toContainText('Không tìm thấy dự án');
});

test('8. Bảo mật HTTP: CSP, nosniff, chống clickjacking, CORS, chống XSS khi hiển thị', async ({ page, request, baseURL }) => {
  const res = await request.get('/');
  const csp = res.headers()['content-security-policy'];
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  const foreign = await request.get('/api/health', { headers: { origin: 'https://evil.example' } });
  expect(foreign.status()).toBe(403);
  const same = await request.get('/api/health', { headers: { origin: baseURL } });
  expect(same.status()).toBe(200);
  expect(same.headers()['ratelimit-policy']).toContain('600');
  expect((await request.get('/api/projects')).status()).toBe(401);

  await login(page, 'nv.kinhdoanh1');
  let dialog = false;
  page.on('dialog', d => { dialog = true; d.dismiss(); });
  const created = await apiAs(page, '/api/projects/1/items', { method: 'POST', data: { title: '<img src=x onerror=alert(1)>', descriptionHtml: '<p>ok</p><script>alert(2)</script><a href="javascript:alert(3)">x</a>' } });
  expect(created.status()).toBe(201);
  const item = await created.json();
  const detail = await (await apiAs(page, `/api/items/${item.id}`)).json();
  expect(detail.descriptionHtml).not.toContain('<script');
  expect(detail.descriptionHtml).not.toContain('javascript:');
  await openProject(page, 'KD');
  await expect(card(page, item.code)).toContainText('<img src=x onerror=alert(1)>');
  await card(page, item.code).click();
  await expect(page.getByTestId('item-title')).toHaveValue('<img src=x onerror=alert(1)>');
  expect(dialog).toBe(false);
});
