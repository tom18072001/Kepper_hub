// GĐ3b — vòng phản hồi 6 vai trò: Văn phòng / Ban Giám đốc giao nhiều việc một lần, trang Điều hành, hạn nộp phòng,
// chia việc nhánh hàng loạt, người phối hợp chỉ báo phần mình, trả lại → nộp lại (lần 2), PGĐ phụ trách duyệt,
// quyết định gia hạn ngay trong "Chờ tôi xử lý". Chạy sau 05 (dùng sổ TT đã tạo).
const { test, expect } = require('@playwright/test');
const { login, apiAs, openProject, toast, vnDate } = require('./helpers');

test.describe.configure({ mode: 'serial' });

test('15. Điều hành: giao nhiều việc, tiếp nhận + hạn nộp phòng, chia việc nhánh, phối hợp, trả lại → nộp lại, PGĐ phụ trách duyệt, gia hạn từ hàng chờ', async ({ browser }) => {
  const director = await (await browser.newContext()).newPage();
  await login(director, 'giamdoc');
  const D = Object.fromEntries((await (await apiAs(director, '/api/departments')).json()).map(d => [d.code, d]));
  const projects = await (await apiAs(director, '/api/projects')).json();
  const register = projects.find(p => p.key === 'TT');
  expect(register).toBeTruthy();

  // Phó Giám đốc phụ trách Phòng Kinh doanh (tạo qua luồng tạo tài khoản sẵn có).
  const admin = await (await browser.newContext()).newPage();
  await login(admin, 'admin');
  const pgdRes = await apiAs(admin, '/api/admin/users', { method: 'POST', data: { username: 'pgd.e2e', fullName: 'Phó Giám đốc E2E', role: 'director', departmentId: D.BGD.id } });
  expect(pgdRes.status()).toBe(201);
  const pgdId = (await pgdRes.json()).id;
  expect((await apiAs(admin, `/api/departments/${D.KD.id}`, { method: 'PUT', data: { supervisorId: pgdId } })).status()).toBe(200);
  const users = await (await apiAs(director, '/api/users/directory')).json();
  const uid = name => users.find(u => u.username === name).id;

  // 1) Giao nhiều việc một lần (lưới nhập) → các việc chờ phòng tiếp nhận, hiện trên trang Điều hành.
  await director.reload();
  await openProject(director, 'TT');
  await director.getByTestId('ph-more').click(); await director.getByTestId('bulk-dispatch').click();
  const grid = director.getByTestId('bulk-dispatch-grid');
  for (const [i, title] of ['Tổng hợp số liệu quý III', 'Rà soát quy chế chi tiêu nội bộ'].entries()) {
    const row = grid.locator('tbody tr').nth(i);
    await row.locator('[data-col=title]').fill(title);
    await row.locator('[data-col=dept]').selectOption(String(D.KD.id));
    await row.locator('[data-col=due]').fill(vnDate(10));
  }
  await grid.locator('tbody tr').nth(0).locator('[data-col=doc]').fill('45/TB-TT');
  await director.getByTestId('bulk-dispatch-submit').click();
  await toast(director, 'Đã giao 2 nhiệm vụ');
  const items = await (await apiAs(director, `/api/projects/${register.id}/items`)).json();
  const A = items.find(i => i.title === 'Tổng hợp số liệu quý III'), B = items.find(i => i.title === 'Rà soát quy chế chi tiêu nội bộ');
  expect(A.dispatchStatus).toBe('PENDING');
  expect(A.basisDocs.map(d => d.number)).toContain('45/TB-TT');
  await director.getByTestId('nav-ops').click();
  await director.getByTestId('ops-block-pendingAccept').click();
  await expect(director.getByTestId('ops-list-pendingAccept')).toContainText(A.code);

  // 2) Trưởng phòng tiếp nhận ngay trên hộp việc phòng: chủ trì + phối hợp + hạn nộp phòng (không muộn hơn hạn của người giao).
  const manager = await (await browser.newContext()).newPage();
  await login(manager, 'tp.kinhdoanh');
  expect((await apiAs(manager, `/api/items/${A.id}/accept`, { method: 'POST', data: { assigneeIds: [uid('nv.kinhdoanh1')], internalDueDate: vnDate(20) } })).status()).toBe(422);
  await manager.getByTestId('nav-dept').click();
  await manager.getByTestId(`dept-row-${A.code}`).click();
  await expect(manager.getByTestId('item-stage')).toHaveText('Chờ phòng tiếp nhận');
  await manager.getByTestId('bar-accept').click();
  await manager.getByTestId('multi-acceptLead').click();
  await manager.getByTestId(`multi-acceptLead-${uid('nv.kinhdoanh1')}`).check();
  await manager.locator('#modal h2').click();
  await manager.getByTestId('multi-acceptSupport').click();
  await manager.getByTestId(`multi-acceptSupport-${uid('nv.kinhdoanh2')}`).check();
  await manager.locator('#modal h2').click();
  await manager.getByTestId('accept-internal-due').fill(vnDate(8));
  await manager.getByTestId('accept-submit').click();
  await toast(manager, 'Đã phân công');
  await expect(manager.getByTestId('item-internal-due')).toHaveValue(vnDate(8));

  // 3) Chia việc nhánh hàng loạt.
  await manager.getByTestId('bulk-children-open').click();
  const kids = manager.getByTestId('bulk-children');
  await kids.locator('tbody tr').nth(0).locator('[data-col=title]').fill('Thu số liệu các tổ');
  await kids.locator('tbody tr').nth(1).locator('[data-col=title]').fill('Viết dự thảo báo cáo');
  await manager.getByTestId('bulk-children-submit').click();
  await toast(manager, 'Đã tạo 2 việc nhánh');
  await expect(manager.getByTestId('children-section')).toContainText('Viết dự thảo báo cáo');

  // 4) Người phối hợp: không sửa tiến độ chung; báo cáo phần phối hợp không đổi tiến độ việc.
  const supporter = await (await browser.newContext()).newPage();
  await login(supporter, 'nv.kinhdoanh2');
  const p403 = await apiAs(supporter, `/api/items/${A.id}`, { method: 'PATCH', data: { progress: 90 } });
  expect(p403.status()).toBe(403);
  expect((await apiAs(supporter, `/api/items/${A.id}/progress-reports`, { method: 'POST', data: { progress: 100, content: 'Đã gửi số liệu tổ 2' } })).status()).toBe(201);
  expect((await (await apiAs(supporter, `/api/items/${A.id}`)).json()).progress).toBe(0);
  expect((await apiAs(supporter, `/api/items/${A.id}/submit`, { method: 'POST', data: {} })).status()).toBe(403);
  const states = (await (await apiAs(director, `/api/projects/${register.id}`)).json()).states;
  const sid = c => states.find(x => x.category === c).id;
  expect((await apiAs(supporter, `/api/items/${A.id}/move`, { method: 'POST', data: { stateId: sid('REVIEW') } })).status()).toBe(403);
  expect((await apiAs(supporter, `/api/items/${A.id}`, { method: 'PATCH', data: { title: 'Sửa trộm' } })).status()).toBe(403);
  // Lãnh đạo phòng chủ trì không tự huỷ việc Ban Giám đốc giao; người giao ghi được phải là chính mình hoặc Ban Giám đốc.
  expect((await apiAs(manager, `/api/items/${A.id}`, { method: 'PATCH', data: { stateId: sid('CANCELLED') } })).status()).toBe(403);
  expect((await apiAs(manager, `/api/items/${A.id}`, { method: 'PATCH', data: { assignedById: uid('nv.kinhdoanh2') } })).status()).toBe(403);

  // 5) Cán bộ chủ trì: xin gia hạn → người giao đồng ý ngay trong "Chờ tôi xử lý".
  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.kinhdoanh1');
  expect((await apiAs(staff, `/api/items/${A.id}/extensions`, { method: 'POST', data: { newDue: vnDate(14), reason: 'Chờ số liệu tổ 3' } })).status()).toBe(201);
  await director.goto('/#/approvals?tab=extensions');
  await director.getByTestId(`ext-approve-${A.code}`).click();
  await toast(director, 'Đã duyệt gia hạn');

  // 6) Nộp sản phẩm → trưởng phòng trả lại → cán bộ thấy "Bị trả lại" ở Việc của tôi → nộp lại lần 2.
  await staff.goto(`/#/my?item=${A.id}`);
  await expect(staff.getByTestId('my-role')).toHaveText('Bạn chủ trì');
  await staff.getByTestId('bar-submit').click();
  await staff.getByTestId('submit-note').fill('Kính trình dự thảo');
  await staff.getByTestId('submit-confirm').click();
  await toast(staff, 'Đã nộp sản phẩm');
  await manager.goto('/#/approvals');
  await manager.getByTestId(`queue-${A.code}`).click();
  await manager.getByTestId('approval-comment').fill('Bổ sung số liệu tổ 3');
  await manager.getByTestId('reject-btn').click();
  await toast(manager, 'Đã trả lại');
  await staff.goto('/#/my');
  await expect(staff.getByTestId(`attention-${A.code}`)).toContainText('Bổ sung số liệu tổ 3');
  await staff.getByTestId(`attention-${A.code}`).click();
  await expect(staff.getByTestId('returned-banner')).toBeVisible();
  await expect(staff.getByTestId('bar-submit')).toContainText('lần 2');
  await staff.getByTestId('bar-submit').click();
  await staff.getByTestId('submit-confirm').click();
  await toast(staff, 'Đã nộp sản phẩm');

  // 7) Phòng duyệt → PGĐ phụ trách (không phải mọi Ban Giám đốc) cho ý kiến cấp cuối + xếp loại; trưởng phòng không duyệt 2 cấp.
  await manager.goto('/#/approvals');
  await manager.getByTestId(`queue-${A.code}`).click();
  await expect(manager.getByTestId('approval-section')).toContainText('Lần trình 2');
  await manager.getByTestId('approve-btn').click();
  await toast(manager, 'Đã duyệt');
  const pgd = await (await browser.newContext()).newPage();
  await login(pgd, 'pgd.e2e');
  await expect(pgd).toHaveURL(/#\/ops/);
  await pgd.goto('/#/approvals');
  await pgd.getByTestId(`queue-${A.code}`).click();
  await pgd.getByTestId('approval-rating').selectOption('EXCELLENT');
  await pgd.getByTestId('approve-btn').click();
  await toast(pgd, 'Đã duyệt');
  const done = await (await apiAs(staff, `/api/items/${A.id}`)).json();
  expect(done.state.category).toBe('COMPLETED');
  expect(done.rating).toBe('EXCELLENT');

  // 8) Điều hành của trưởng phòng chỉ có phòng mình; cán bộ không vào được.
  const ops = await (await apiAs(manager, '/api/ops/overview')).json();
  expect(ops.scope).toBe('UNIT');
  expect(ops.byDept.map(r => r.departmentId)).toEqual([D.KD.id]);
  expect(ops.blocks.pendingAccept.items.map(i => i.id)).toContain(B.id);
  expect((await apiAs(staff, '/api/ops/overview')).status()).toBe(403);
  // Tìm nhanh theo số văn bản, trong phạm vi được xem.
  expect((await (await apiAs(director, '/api/search?q=45/TB')).json()).map(r => r.id)).toContain(A.id);
  const itSearch = await apiAs(admin, '/api/search?q=45/TB');
  expect(itSearch.status() === 403 || (await itSearch.json()).length === 0).toBe(true);
});
