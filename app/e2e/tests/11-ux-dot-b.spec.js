// Đợt B review UX (dữ liệu GIẢ của seed + dự án mẫu MTL "DA"): Cập nhật nhanh "Gửi duyệt" + hoàn tác 5 giây + thẻ "Chờ duyệt" (B1),
// tab "Tôi đã gửi" (B6), panel chi tiết 3 tab / % chỉ qua báo cáo / gộp ô trùng / mô tả tự lưu (B2), dự án MTL: tab mặc định, Lịch trong "Khác",
// Kanban (B3), form tạo việc (B4), "Của tôi" / "Tôi giao" / "Chưa giao" (B5), nhân viên không thấy "Tạo việc" trong dự án MTL (N2),
// thông báo xuống dòng và không tràn ở khổ 375 px (N3, N4). Chạy sau các spec khác trên cùng CSDL test.
const { test, expect } = require('@playwright/test');
const { login, apiAs, toast, vnDate } = require('./helpers');

test.describe.configure({ mode: 'serial' });

const projectDA = async page => (await (await apiAs(page, '/api/projects')).json()).find(p => p.key === 'DA');
const itemOf = async (page, id) => (await apiAs(page, `/api/items/${id}`)).json();

test('B1 + B6. Cập nhật nhanh: nút "Gửi duyệt", hoàn tác trong 5 giây, thẻ ghi "Chờ duyệt"; tab "Tôi đã gửi" rút lại được', async ({ browser }) => {
  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.phaply');
  const mine = await (await apiAs(staff, '/api/my/sprint')).json();
  const g = mine.projects.find(x => x.project.key === 'DA');
  const it = g.items.find(i => !i.done && !i.inReview && i.canProgress && i.needsApproval && (i.actual || 0) < 100);
  expect(it, 'nv.phaply cần một việc đang làm trong kỳ (dữ liệu mẫu)').toBeTruthy();
  const before = await itemOf(staff, it.id);
  // Người duyệt cấp 1 = người giao (tb.phaply): đếm thông báo "Cần duyệt" chưa đọc của việc này trước khi gửi.
  const lead = await (await browser.newContext()).newPage();
  await login(lead, 'tb.phaply');
  const pendingNotes = async () => (await (await apiAs(lead, '/api/notifications')).json()).items.filter(n => n.type === 'APPROVAL_REQUESTED' && !n.readAt && n.link?.endsWith(`item=${it.id}`)).length;
  const notesBefore = await pendingNotes();

  await staff.getByTestId('nav-sprint').click();
  const card = staff.getByTestId(`sc-${it.code}`);
  await expect(card.getByTestId(`qk-${it.code}-100`)).toHaveText(/Gửi duyệt/);
  // 1) Gửi duyệt → thanh "đã gửi duyệt · Hoàn tác" (5 giây) → thẻ hiện "Chờ duyệt", không còn "Vượt tiến độ".
  await card.getByTestId(`qk-${it.code}-100`).click();
  const bar = staff.locator('.toast', { hasText: `${it.code}: đã gửi duyệt` });
  await expect(bar).toBeVisible();
  await expect(bar.getByTestId('toast-action')).toHaveText('Hoàn tác');
  await expect(staff.getByTestId(`sc-${it.code}`).getByTestId('sc-status')).toHaveText('Chờ duyệt');
  await expect(staff.getByTestId(`sc-${it.code}`)).not.toContainText('Vượt tiến độ');
  await expect(staff.getByTestId(`qk-${it.code}-100`)).toHaveCount(0);
  expect((await itemOf(staff, it.id)).state.category).toBe('REVIEW');
  // 2) Hoàn tác → việc về trạng thái và % cũ, phiếu huỷ, thông báo "Cần duyệt" chưa đọc của người duyệt được gỡ.
  await bar.getByTestId('toast-action').click();
  await toast(staff, `${it.code}: đã rút lại`);
  const after = await itemOf(staff, it.id);
  expect(after.state.category).toBe(before.state.category);
  expect(after.progress).toBe(before.progress);
  expect(after.approvals[0].status).toBe('CANCELLED');
  expect(await pendingNotes()).toBe(notesBefore);
  // Thanh tự tắt sau 5 giây.
  await staff.getByTestId(`qk-${it.code}-100`).click();
  const bar2 = staff.locator('.toast', { hasText: `${it.code}: đã gửi duyệt` });
  await expect(bar2).toBeVisible();
  await expect(bar2).toHaveCount(0, { timeout: 7000 });
  expect((await itemOf(staff, it.id)).state.category).toBe('REVIEW');

  // 3) Chờ tôi duyệt → "Tôi đã gửi": phiếu đang chờ ai, bước nào; rút lại được khi chưa cấp nào xử lý.
  await staff.goto('/#/approvals?tab=sent');
  await expect(staff.getByTestId('approvals-tab-sent')).toHaveClass(/active/);
  const row = staff.getByTestId(`sent-${it.code}`);
  await expect(row).toContainText('Đang chờ duyệt');
  await expect(row).toContainText('Lý Thanh Hằng');
  await row.getByTestId(`sent-withdraw-${it.code}`).click();
  await staff.locator('#modal').getByRole('button', { name: 'Rút lại' }).click();
  await toast(staff, 'Đã rút lại phiếu');
  await expect(staff.getByTestId(`sent-${it.code}`)).toContainText('Đã rút / huỷ');
  expect((await itemOf(staff, it.id)).state.category).not.toBe('REVIEW');
});

test('B2. Panel chi tiết việc: 3 tab, % chỉ qua "Báo cáo tiến độ", gộp ô trùng (giữ dữ liệu cũ), mô tả tự lưu, "Mở tất cả các mục"', async ({ page, browser }) => {
  await login(page, 'nv.kinhdoanh2');
  const kd = (await (await apiAs(page, '/api/projects')).json()).find(p => p.key === 'KD');
  const items = await (await apiAs(page, `/api/projects/${kd.id}/items`)).json();
  const it = items.find(i => i.title === 'Soạn báo giá gói dịch vụ doanh nghiệp');
  // Dữ liệu cũ của hai ô đã gộp (ghi thẳng qua API như trước đây): phải hiện ở chỗ mới, không mất.
  expect((await apiAs(page, `/api/items/${it.id}`, { method: 'PATCH', data: { resultNote: 'Khách hẹn trả lời tuần sau (giả)', outputs: 'Báo giá số 01/BG (giả)' } })).status()).toBe(200);
  await page.goto(`/#/projects/${kd.id}?view=list&item=${it.id}`);
  const panel = page.getByTestId('item-panel');
  await expect(panel.getByTestId('item-code')).toHaveText(it.code);
  // Ba tab; mở việc → Tổng quan.
  for (const t of ['overview', 'results', 'talk']) await expect(panel.getByTestId(`ip-tab-${t}`)).toBeVisible();
  await expect(panel.getByTestId('ip-tab-overview')).toHaveAttribute('aria-selected', 'true');
  await expect(panel.locator('#ipPane-results')).toBeHidden();
  // % tiến độ: chỉ hiển thị (không còn thanh trượt / ô số), cập nhật qua Báo cáo tiến độ.
  await expect(panel.locator('input[type=range], #ipProgress')).toHaveCount(0);
  await expect(panel.getByTestId('item-progress')).toHaveText(`${it.progress}%`);
  // Không còn ô "Kết quả / Khó khăn, kiến nghị" riêng — nội dung cũ hiện trong Báo cáo tiến độ.
  await expect(panel.getByTestId('item-resultNote')).toHaveCount(0);
  await expect(panel.getByTestId('item-result-legacy')).toContainText('Khách hẹn trả lời tuần sau (giả)');
  await panel.getByTestId('side-report').click();
  await panel.getByTestId('report-progress').fill('40');
  await panel.getByTestId('report-content').fill('Đã gửi bản nháp báo giá (giả)');
  await panel.getByTestId('report-difficulties').fill('Chờ đơn giá nhà cung cấp (giả)');
  await panel.getByTestId('report-submit').click();
  await toast(page, 'Đã gửi báo cáo tiến độ');
  await expect(panel.getByTestId('item-progress')).toHaveText('40%');
  expect((await itemOf(page, it.id)).progress).toBe(40);
  // Kết quả & tài liệu: một khối hai chiều; sản phẩm ghi bằng chữ (dữ liệu cũ) nằm ở cột bên thực hiện; không còn khối "Văn bản liên quan" riêng.
  await panel.getByTestId('ip-tab-results').click();
  await expect(panel.locator('#ipPane-results')).toBeVisible();
  await expect(panel.getByTestId('tw-back').getByTestId('tw-output')).toContainText('Báo giá số 01/BG (giả)');
  await expect(panel.getByTestId('documents-section')).toHaveCount(0);
  await panel.getByTestId('document-open').click();
  await panel.getByTestId('document-number').fill('02/BG-KD');
  await panel.getByTestId('document-summary').fill('Báo giá điều chỉnh (giả)');
  await panel.getByTestId('document-submit').click();
  await toast(page, 'Đã thêm văn bản');
  await expect(panel.getByTestId('tw-back')).toContainText('02/BG-KD');
  await expect(panel.getByTestId('ip-tab-results')).toHaveAttribute('aria-selected', 'true'); // vẽ lại vẫn giữ tab
  // Trao đổi: bình luận + lịch sử.
  await panel.getByTestId('ip-tab-talk').click();
  await expect(panel.getByTestId('activity')).toContainText('báo cáo tiến độ 40%');
  // Mô tả là kế hoạch: người chủ trì chỉ xem (không ô soạn); người giao sửa, tự lưu (không còn nút "Lưu mô tả").
  await panel.getByTestId('ip-tab-overview').click();
  await expect(panel.getByTestId('save-description')).toHaveCount(0);
  await expect(panel.locator('#ipDesc[contenteditable="true"]')).toHaveCount(0);
  const boss = await (await browser.newContext()).newPage();
  await login(boss, 'tp.kinhdoanh');
  await boss.goto(`/#/projects/${kd.id}?view=list&item=${it.id}`);
  const bp = boss.getByTestId('item-panel');
  const desc = bp.getByTestId('item-description');
  await desc.click();
  await boss.keyboard.press('End');
  await boss.keyboard.type(' Gồm phí lắp đặt (giả).');
  await expect(bp.getByTestId('description-state')).toHaveText('Đã lưu', { timeout: 5000 });
  await expect.poll(async () => (await itemOf(page, it.id)).descriptionHtml).toContain('Gồm phí lắp đặt (giả).');
  // "Ngày giao" chỉ một chỗ; không còn chữ "Cột tự do"; nút đổi chế độ tên "Mở tất cả các mục" / "Thu gọn các mục".
  await expect(panel.locator('label', { hasText: /^Ngày giao/ })).toHaveCount(1);
  await expect(panel.getByTestId('item-state')).not.toContainText('Cột tự do');
  await expect(panel.getByTestId('panel-full-toggle')).toHaveText('Thu gọn các mục');
  await panel.getByTestId('panel-full-toggle').click();
  await expect(panel.getByTestId('panel-full-toggle')).toHaveText('Mở tất cả các mục');
  await expect(panel.getByTestId('item-priority')).toBeHidden();
  await panel.getByTestId('panel-full-toggle').click();
  await expect(panel.getByTestId('item-priority')).toBeVisible();
  // Phím M (bình luận) tự chuyển sang tab Trao đổi.
  await panel.getByTestId('ip-tab-overview').click();
  await page.locator('.ip-head').focus();
  await page.keyboard.press('m');
  await expect(panel.getByTestId('comment-input')).toBeFocused();
});

test('B3 + B4 + B5 + N2. Dự án MTL: tab mặc định, Lịch trong "Khác", Kanban; form tạo việc; "Của tôi" / "Tôi giao" / "Chưa giao"; nhân viên không thấy "Tạo việc"', async ({ browser }) => {
  const pmo = await (await browser.newContext()).newPage();
  await login(pmo, 'pmo');
  const project = await projectDA(pmo);
  const me = (await (await apiAs(pmo, '/api/me')).json());
  const items = await (await apiAs(pmo, `/api/projects/${project.id}/items`)).json();

  // B3: vào dự án → tab Tổng quan dự án (đầu tiên, mặc định); tab "Giai đoạn" thay chữ "Sprint"; Lịch nằm trong menu "Khác".
  await pmo.goto(`/#/projects/${project.id}`);
  await expect(pmo.getByTestId('view-mtl')).toHaveAttribute('aria-selected', 'true');
  await expect(pmo.locator('.viewbar [role=tab]')).toHaveText(['Tổng quan dự án', 'Giai đoạn', 'Kế hoạch & Gantt', 'Bảng', 'Danh sách']);
  await expect(pmo.getByTestId('view-calendar')).toHaveCount(0);
  await pmo.getByTestId('ph-more').click();
  await pmo.getByTestId('more-view-calendar').click();
  await expect(pmo.getByTestId('view-calendar')).toHaveAttribute('aria-selected', 'true');
  // Bấm ô ngày trên Lịch → form tạo việc, hạn điền sẵn ngày đó.
  const day = vnDate(3);
  await pmo.getByTestId(`calendar-add-${day}`).click({ force: true });
  await expect(pmo.locator('#modal input[name="dueDate"]')).toHaveValue(day);
  await pmo.keyboard.press('Escape');
  await expect(pmo.locator('#modalRoot')).toBeHidden();

  // Tab Giai đoạn: bấm một giai đoạn trên lộ trình → chi tiết vẽ tại chỗ và cuộn tới.
  await pmo.getByTestId('view-sprint').click();
  await pmo.getByTestId('sp-road-2').click();
  await expect(pmo.getByTestId('sp-title')).toHaveText(/^Giai đoạn 3 · /);
  await expect(pmo.getByTestId('sp-title')).toBeInViewport();
  await expect(pmo.getByTestId('sprint-view')).not.toContainText('Sprint');
  // Banner "các giai đoạn gợi ý" (khi chưa thiết lập giai đoạn): "Đã hiểu" ẩn hẳn, nhớ theo người dùng. Tạm bỏ thiết lập của DA rồi khôi phục.
  const plan = await (await apiAs(pmo, `/api/projects/${project.id}/mtl-sprints`)).json();
  expect((await apiAs(pmo, `/api/projects/${project.id}/mtl-sprints`, { method: 'PUT', data: { text: '' } })).status()).toBe(200);
  try {
    await pmo.goto(`/#/projects/${project.id}?view=sprint`); await pmo.reload();
    await expect(pmo.getByTestId('sp-suggested')).toBeVisible();
    await pmo.getByTestId('sp-guide-ok').click();
    await expect(pmo.getByTestId('sp-suggested')).toHaveCount(0);
    await pmo.reload();
    await expect(pmo.getByTestId('sprint-view')).toBeVisible();
    await expect(pmo.getByTestId('sp-suggested')).toHaveCount(0);
  } finally {
    expect((await apiAs(pmo, `/api/projects/${project.id}/mtl-sprints`, { method: 'PUT', data: { text: plan.text } })).status()).toBe(200);
  }

  // Kanban (bỏ chia làn): không có "+ Thêm việc" ở cột Huỷ / Tạm dừng; thẻ có người chủ trì (hoặc bộ phận chủ trì).
  await pmo.goto(`/#/projects/${project.id}?view=board&lanes=none`);
  await expect(pmo.getByTestId('quick-add-Chưa bắt đầu')).toBeVisible();
  await expect(pmo.getByTestId('quick-add-Huỷ')).toHaveCount(0);
  await expect(pmo.getByTestId('quick-add-Tạm dừng')).toHaveCount(0);
  const withLead = items.find(i => i.assignees.length && !i.parentId);
  await expect(pmo.getByTestId(`card-${withLead.code}`).locator('.who-name')).toContainText(withLead.assignees[0].fullName.split(' ').pop());
  // Mặc định Bảng MTL chia làn theo giai đoạn (cột không phải cuộn lồng).
  await pmo.goto(`/#/projects/${project.id}?view=board`);
  await expect(pmo.locator('.lane-title').first()).toContainText('Giai đoạn 1');
  expect(await pmo.locator('.col-body').first().evaluate(el => getComputedStyle(el).overflowY)).toBe('visible');

  // B5 / N6: "Của tôi" = chủ trì hoặc phối hợp (PMO đứng tên người giao gần hết việc MTL nhưng không vì thế mà "của tôi").
  await pmo.goto(`/#/projects/${project.id}?view=list`);
  const mineN = items.filter(i => i.assignees.some(a => a.id === me.id) || (i.supporters || []).some(a => a.id === me.id)).length;
  const byMeN = items.filter(i => i.assignedById === me.id).length;
  const noneN = items.filter(i => !i.assignees.length).length;
  await expect(pmo.getByTestId('filter-mine').locator('b')).toHaveText(String(mineN));
  expect(byMeN).toBeGreaterThan(mineN);
  await expect(pmo.getByTestId('filter-by-me').locator('b')).toHaveText(String(byMeN));
  await pmo.getByTestId('filter-by-me').click();
  await expect(pmo.getByTestId('filter-count')).toHaveText(`${byMeN}/${items.length} việc`);
  await pmo.getByTestId('filter-by-me').click();
  if (noneN) {
    await pmo.getByTestId('filter-unassigned').click();
    await expect(pmo.getByTestId('filter-count')).toHaveText(`${noneN}/${items.length} việc`);
    await pmo.getByTestId('filter-unassigned').click();
  }
  // Danh sách gom theo giai đoạn; các nút lọc chỉ có biểu tượng có tên (N7).
  await expect(pmo.getByTestId('list-group-0')).toContainText('Giai đoạn 1');
  await expect(pmo.getByTestId('filter-more')).toHaveAttribute('aria-label', /Thêm bộ lọc/);
  await expect(pmo.getByTestId('saved-views')).toHaveAttribute('aria-label', /Bộ lọc đã lưu/);

  // B4: form tạo việc (PMO): giai đoạn + việc cha, ưu tiên mặc định "Bình thường", Trạng thái trong "Thêm thông tin",
  // Chủ trì 1 người theo phòng ban + "Giao cho tôi", Phối hợp; một trường "Nguồn giao việc"; nút luôn ở đáy; Esc hỏi lại khi đã nhập.
  await pmo.getByTestId('new-item').click();
  const modal = pmo.locator('#modal');
  await expect(modal.getByLabel('Tiêu đề')).toBeFocused();
  await expect(pmo.getByTestId('create-priority')).toHaveValue('MEDIUM');
  await expect(pmo.getByTestId('create-state')).toBeHidden();
  await expect(pmo.getByTestId('create-phase')).toBeVisible();
  await expect(pmo.getByTestId('create-parent')).toBeVisible();
  await expect(pmo.getByTestId('create-task-type')).toHaveCount(0);
  await expect(modal.getByLabel(/^Chủ trì/)).toBeVisible();
  await expect(modal.getByLabel(/^Ưu tiên/)).toBeVisible();
  await expect(modal.getByRole('button', { name: /^Người phối hợp/ })).toBeVisible();
  await expect(pmo.getByTestId('create-lead').locator('optgroup').first()).toHaveAttribute('label', /.+/);
  await pmo.getByTestId('create-assign-me').click();
  await expect(pmo.getByTestId('create-lead')).toHaveValue(String(me.id));
  await pmo.getByTestId('create-more').locator('summary').click();
  await expect(pmo.getByTestId('create-state')).toBeVisible();
  await expect(pmo.getByTestId('create-submit')).toBeInViewport();
  await pmo.getByTestId('create-title').fill('Rà soát hồ sơ pháp lý bổ sung (giả)');
  await pmo.keyboard.press('Escape');
  await expect(pmo.getByTestId('discard-yes')).toBeVisible();
  await pmo.getByRole('button', { name: 'Tiếp tục nhập' }).click();
  // Giai đoạn 2 → việc cha là bước của giai đoạn đó; nguồn "Kế hoạch năm" → nhiệm vụ kế hoạch năm.
  await pmo.getByTestId('create-phase').selectOption('1');
  const step8 = items.find(i => i.planCode === '8');
  await pmo.getByTestId('create-parent').selectOption(String(step8.id));
  await pmo.getByTestId('create-source').selectOption('Kế hoạch năm');
  await pmo.getByTestId('create-submit').click();
  await toast(pmo, 'Đã tạo DA-');
  const created = (await (await apiAs(pmo, `/api/projects/${project.id}/items`)).json()).find(i => i.title === 'Rà soát hồ sơ pháp lý bổ sung (giả)');
  expect(created.parentId).toBe(step8.id);
  expect(created.priority).toBe('MEDIUM');
  expect(created.taskType).toBe('PLAN');
  expect(created.assignees.map(a => a.id)).toEqual([me.id]);

  // N2 (quyền tối thiểu theo vai): thành viên không chủ trì việc nào trong dự án MTL không thấy "Tạo việc";
  // người chủ trì chỉ thêm việc nhánh dưới việc mình chủ trì.
  const outsider = await (await browser.newContext()).newPage();
  await login(outsider, 'nv.kythuat');
  expect(await (await apiAs(outsider, `/api/projects/${project.id}/create-scope`)).json()).toEqual({ root: false, parents: [], reason: 'MTL_CHILD_ONLY' });
  await outsider.goto(`/#/projects/${project.id}?view=board`);
  await expect(outsider.locator('#viewBody')).toBeVisible();
  await expect(outsider.getByTestId('new-item')).toHaveCount(0);
  await expect(outsider.locator('[data-testid^="quick-add-"]')).toHaveCount(0);
  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.phaply');
  const staffMe = await (await apiAs(staff, '/api/me')).json();
  const ss = await (await apiAs(staff, `/api/projects/${project.id}/create-scope`)).json();
  expect(ss.root).toBe(false);
  expect(ss.parents.length).toBeGreaterThan(0);
  const all = await (await apiAs(pmo, `/api/projects/${project.id}/items`)).json();
  for (const id of ss.parents) expect(all.find(i => i.id === id).assignees.map(a => a.id)).toContain(staffMe.id);
  // Lãnh đạo bộ phận: thấy "Tạo việc" nhưng chỉ thêm việc con trong hạng mục bộ phận mình; thiếu việc cha → báo ngay trên form.
  const lead = await (await browser.newContext()).newPage();
  await login(lead, 'tb.phaply');
  const scope = await (await apiAs(lead, `/api/projects/${project.id}/create-scope`)).json();
  expect(scope.root).toBe(false); expect(scope.parents).toContain(step8.id);
  await lead.goto(`/#/projects/${project.id}?view=list`);
  await lead.getByTestId('new-item').click();
  await expect(lead.getByTestId('create-scope-note')).toBeVisible();
  await lead.getByTestId('create-phase').selectOption('');
  const opts = await lead.getByTestId('create-parent').locator('option').evaluateAll(os => os.map(o => o.value).filter(Boolean).map(Number));
  expect(opts.length).toBeGreaterThan(0);
  expect(opts.every(id => scope.parents.includes(id))).toBe(true);
  await lead.getByTestId('create-title').fill('Xin ý kiến sở về hồ sơ (giả)');
  await lead.getByTestId('create-submit').click();
  await expect(lead.locator('#createItemError')).toHaveText('Chọn việc cha thuộc phần bộ phận bạn chủ trì');
  await lead.getByTestId('create-parent').selectOption(String(step8.id));
  await lead.getByTestId('create-submit').click();
  await toast(lead, 'Đã tạo DA-');
});

test('N9. Dự án MTL: việc có việc nhánh — ô % trong "Báo cáo tiến độ" chỉ hiển thị, gửi báo cáo không bị từ chối', async ({ browser }) => {
  const pmo = await (await browser.newContext()).newPage();
  await login(pmo, 'pmo');
  const project = await projectDA(pmo);
  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.phaply');
  const me = await (await apiAs(staff, '/api/me')).json();
  // Một việc lá đang làm của nv.phaply: người chủ trì chia 2 việc nhánh của việc mình (Checklist đã bỏ — khi đó là người giao của
  // việc nhánh); việc nhánh 1 báo 100% → % việc cha = 50 (tự tính từ việc nhánh).
  const items = await (await apiAs(pmo, `/api/projects/${project.id}/items`)).json();
  const states = Object.fromEntries((await (await apiAs(pmo, `/api/projects/${project.id}`)).json()).states.map(s => [s.id, s.category]));
  const it = items.find(i => i.assignees.some(a => a.id === me.id) && !i.counts.children && ['UNSTARTED', 'STARTED'].includes(states[i.stateId]));
  expect(it, 'nv.phaply cần một việc lá đang mở (dữ liệu mẫu)').toBeTruthy();
  const k1 = await (await apiAs(staff, `/api/projects/${project.id}/items`, { method: 'POST', data: { title: 'Soạn hồ sơ (giả)', parentId: it.id, assigneeIds: [me.id] } })).json();
  expect(k1.assignedById).toBe(me.id);
  expect((await apiAs(staff, `/api/projects/${project.id}/items`, { method: 'POST', data: { title: 'Nộp hồ sơ (giả)', parentId: it.id, assigneeIds: [me.id] } })).status()).toBe(201);
  expect((await apiAs(staff, `/api/items/${k1.id}`, { method: 'PATCH', data: { progress: 100 } })).status()).toBe(200);
  expect((await itemOf(pmo, it.id)).mtl.actual).toBe(50);

  await staff.goto(`/#/projects/${project.id}?view=list&item=${it.id}`);
  const panel = staff.getByTestId('item-panel');
  await expect(panel.getByTestId('item-code')).toHaveText(it.code);
  await panel.getByTestId('report-open').click();
  const pct = panel.getByTestId('report-progress');
  await expect(pct).toHaveValue('50');
  await expect(pct).toHaveAttribute('readonly', '');
  await expect(panel.getByTestId('report-progress-auto')).toContainText('tính theo việc nhánh');
  await expect(panel.getByTestId('side-report')).toHaveCount(0); // cột phải ghi "tự tính từ việc nhánh"
  await panel.getByTestId('report-content').fill('Đã soạn xong hồ sơ, chờ nộp (giả)');
  await panel.getByTestId('report-submit').click();
  await toast(staff, 'Đã gửi báo cáo tiến độ');
  const after = await itemOf(staff, it.id);
  expect(after.mtl.actual).toBe(50);
  expect(after.progressReports[0].content).toBe('Đã soạn xong hồ sơ, chờ nộp (giả)');
});

test('B7 + N1 + N3 + N4. Việc của tôi: "Ghi chú của tôi" ngoài dãy tab lọc; thông báo xuống dòng, không tràn ở khổ 375 px', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 375, height: 760 } })).newPage();
  await login(page, 'tb.phaply');
  await page.goto('/#/my');
  await expect(page.locator('.tabs').filter({ has: page.getByTestId('my-assigned') }).getByTestId('my-notes')).toHaveCount(0);
  await expect(page.getByTestId('my-notes')).toBeVisible();
  await page.getByTestId('my-notes').click();
  await expect(page.getByTestId('note-input')).toBeVisible();
  await expect(page.getByTestId('my-back')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Dashboard dự án');
  // Thông báo: nội dung nhiều dòng giữ xuống dòng; bảng thông báo nằm trọn trong màn hình 375 px.
  // Bảng chỉ hiện sau khi tải xong danh sách thông báo (bất đồng bộ): chờ hiện rồi mới đọc vị trí.
  await page.getByTestId('notif-btn').click();
  const notif = page.locator('#notifPanel');
  await expect(notif).toBeVisible();
  await expect.poll(async () => { const b = await notif.boundingBox(); return b && b.x >= 0 && b.x + b.width <= 375; }).toBe(true);
  const body = notif.locator('.notif-body').first();
  if (await body.count()) expect(await body.evaluate(el => getComputedStyle(el).whiteSpace)).toBe('pre-line');
});
