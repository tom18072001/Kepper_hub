// GĐ3a — điều hành hai chiều Ban Giám đốc → phòng → cán bộ (theo bản ghi nghiệp vụ 16/10/2026):
// giao về phòng → trưởng phòng tiếp nhận, phân công → cán bộ báo cáo tiến độ, kiến nghị, xin gia hạn → nộp sản phẩm
// → lãnh đạo phòng duyệt → Ban Giám đốc cho ý kiến + xếp loại. Quyền xem theo việc; Phó phòng có quyền như trưởng phòng.
const { test, expect } = require('@playwright/test');
const { login, apiAs, openProject, toast, vnDate } = require('./helpers');

test.describe.configure({ mode: 'serial' });

test('14. Giao việc về phòng: tiếp nhận, phân công, báo cáo tiến độ, gia hạn, phiếu trình, phòng duyệt, BGĐ xếp loại; người không liên quan không thấy việc', async ({ browser }) => {
  const director = await (await browser.newContext()).newPage();
  await login(director, 'giamdoc');
  const depts = await (await apiAs(director, '/api/departments')).json();
  const D = Object.fromEntries(depts.map(d => [d.code, d]));
  const users = await (await apiAs(director, '/api/users/directory')).json();
  const uid = name => users.find(u => u.username === name).id;
  // Sổ giao việc của Trung tâm: mỗi người chỉ thấy việc liên quan; duyệt 2 cấp: lãnh đạo phòng chủ trì → người giao / PGĐ phụ trách.
  const created = await apiAs(director, '/api/projects', { method: 'POST', data: { key: 'TT', name: 'Sổ giao việc Trung tâm', departmentId: D.BGD.id, visibility: 'ASSIGNED',
    approvalSteps: [{ approverType: 'DEPARTMENT_MANAGER', name: 'Lãnh đạo phòng duyệt' }, { approverType: 'SUPERVISOR', name: 'Ban Giám đốc cho ý kiến' }] } });
  expect(created.status()).toBe(201);
  const register = await created.json();

  // Phó phòng Kinh doanh (vai trò mới) — tạo qua luồng tạo tài khoản sẵn có.
  const admin = await (await browser.newContext()).newPage();
  await login(admin, 'admin');
  expect((await apiAs(admin, '/api/admin/users', { method: 'POST', data: { username: 'pp.kinhdoanh', fullName: 'Phó phòng Kinh doanh', role: 'deputy', departmentId: D.KD.id } })).status()).toBe(201);

  // 1) Giám đốc giao về Phòng Kinh doanh (phối hợp: Phòng Kỹ thuật), kèm văn bản căn cứ.
  await director.reload();
  await openProject(director, 'TT');
  await director.getByTestId('new-item').click();
  await director.getByTestId('create-title').fill('Chuẩn bị báo cáo sơ kết 6 tháng');
  await director.locator('#createItemForm [name=dueDate]').fill(vnDate(5));
  await director.getByTestId('create-lead-dept').selectOption(String(D.KD.id));
  await director.getByTestId('create-more').locator('summary').click();
  await director.getByTestId('multi-createSupportDepts').click();
  await director.getByTestId(`multi-createSupportDepts-${D.KT.id}`).check();
  await director.getByTestId('create-title').click();
  await director.getByTestId('create-doc-number').fill('12/TB-TT');
  await director.getByTestId('create-doc-summary').fill('Thông báo kết luận giao ban');
  await director.getByTestId('create-submit').click();
  await toast(director, 'Đã tạo TT-1');
  const items = await (await apiAs(director, `/api/projects/${register.id}/items`)).json();
  const id = items.find(i => i.title === 'Chuẩn bị báo cáo sơ kết 6 tháng').id;

  // 2) Quyền xem theo việc: cán bộ chưa được phân công, phòng khác → không thấy (404); lãnh đạo phòng phối hợp thấy.
  const staff2 = await (await browser.newContext()).newPage();
  await login(staff2, 'nv.kinhdoanh2');
  expect((await apiAs(staff2, `/api/items/${id}`)).status()).toBe(404);
  expect((await (await apiAs(staff2, `/api/projects/${register.id}/items`)).json()).length).toBe(0);
  const otherManager = await (await browser.newContext()).newPage();
  await login(otherManager, 'tp.kythuat');
  expect((await apiAs(otherManager, `/api/items/${id}`)).status()).toBe(200);
  const hr = await (await browser.newContext()).newPage();
  await login(hr, 'nv.hcns');
  expect((await apiAs(hr, `/api/items/${id}`)).status()).toBe(404);
  // Phó phòng thấy việc phòng được giao như trưởng phòng.
  const deputy = await (await browser.newContext()).newPage();
  await login(deputy, 'pp.kinhdoanh');
  expect((await (await apiAs(deputy, '/api/dispatch/inbox')).json()).items.some(i => i.id === id && i.tab === 'PENDING')).toBe(true);

  // 3) Trưởng phòng: hộp "Việc phòng được giao" → tiếp nhận, phân công cán bộ chủ trì.
  const manager = await (await browser.newContext()).newPage();
  await login(manager, 'tp.kinhdoanh');
  await manager.getByTestId('nav-dept').click();
  await manager.getByTestId('dept-row-TT-1').click();
  await expect(manager.getByTestId('dispatch-status')).toContainText('Chờ phòng tiếp nhận');
  await expect(manager.getByTestId('documents-section')).toContainText('12/TB-TT');
  await manager.getByTestId('accept-dispatch').click();
  await manager.getByTestId('multi-acceptLead').click();
  await manager.getByTestId(`multi-acceptLead-${uid('nv.kinhdoanh1')}`).check();
  await manager.locator('#modal h2').click(); // đóng danh sách chọn
  await manager.getByTestId('accept-note').fill('An chủ trì, nộp dự thảo trước hạn 1 ngày');
  await manager.getByTestId('accept-submit').click();
  await toast(manager, 'Đã phân công');
  await expect(manager.getByTestId('dispatch-status')).toContainText('Phòng đã phân công');

  // 4) Cán bộ: báo cáo tiến độ kèm kiến nghị; không tự lùi hạn; gửi đề nghị gia hạn.
  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.kinhdoanh1');
  await staff.goto(`/#/projects/${register.id}?item=${id}`);
  await staff.getByTestId('report-progress').fill('50');
  await staff.getByTestId('report-content').fill('Đã tổng hợp số liệu các phòng');
  await staff.getByTestId('report-proposals').fill('Đề nghị Văn phòng gửi số liệu kinh phí');
  await staff.getByTestId('report-submit').click();
  await toast(staff, 'Đã gửi báo cáo tiến độ');
  const selfDue = await apiAs(staff, `/api/items/${id}`, { method: 'PATCH', data: { dueDate: vnDate(30) } });
  expect(selfDue.status()).toBe(403);
  expect((await selfDue.json()).code).toBe('USE_EXTENSION');
  await expect(staff.getByTestId('item-due')).toBeDisabled();
  await staff.getByTestId('request-extension').click();
  await staff.getByTestId('extension-due').fill(vnDate(9));
  await staff.getByTestId('extension-reason').fill('Chờ số liệu kinh phí');
  await staff.getByTestId('extension-submit').click();
  await toast(staff, 'Đã gửi đề nghị gia hạn');

  // 5) Giám đốc (người giao): trả lời kiến nghị, đồng ý gia hạn — hạn gốc được giữ để tính đúng hạn.
  await director.goto(`/#/projects/${register.id}?item=${id}`);
  await director.getByTestId('answer-input').fill('Văn phòng gửi trước thứ Sáu');
  await director.getByTestId('answer-submit').click();
  await toast(director, 'Đã duyệt kiến nghị');
  await director.getByTestId('extension-approve').click();
  await toast(director, 'Đã duyệt gia hạn');
  await expect(director.getByTestId('original-due')).toContainText('đã gia hạn');

  // 6) Cán bộ nộp sản phẩm (phiếu trình) → 7) trưởng phòng duyệt → 8) Giám đốc đồng ý + xếp loại.
  await staff.reload();
  await staff.getByTestId('submit-product').click();
  await staff.getByTestId('submit-note').fill('Kính trình dự thảo báo cáo');
  await staff.getByTestId('submit-confirm').click();
  await toast(staff, 'Đã nộp sản phẩm');
  expect((await (await apiAs(otherManager, `/api/items/${id}`)).json()).canApprove).toBe(false); // phòng phối hợp không duyệt
  await manager.reload();
  await manager.getByTestId('approval-comment').fill('Đạt, trình Ban Giám đốc');
  await manager.getByTestId('approve-btn').click();
  await toast(manager, 'Đã duyệt');
  await director.reload();
  await director.getByTestId('approval-rating').selectOption('GOOD');
  await director.getByTestId('approval-comment').fill('Báo cáo đầy đủ');
  await director.getByTestId('approve-btn').click();
  await toast(director, 'Đã duyệt');
  await expect(director.getByTestId('item-rating')).toContainText('Hoàn thành tốt');
  const done = await (await apiAs(staff, `/api/items/${id}`)).json();
  expect(done.state.category).toBe('COMPLETED');
  expect(done.rating).toBe('GOOD');
  // Nhân viên phối hợp được thêm sau vẫn không thấy việc của người khác trong sổ.
  expect((await apiAs(staff2, `/api/items/${id}`)).status()).toBe(404);
});
