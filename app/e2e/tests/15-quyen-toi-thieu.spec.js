// Quyền tối thiểu theo vai trên MỘT việc (bảng chủ dự án chốt 20/11/2026) — dữ liệu GIẢ.
// Tái hiện lỗi bản thật: việc do TGĐ giao, người chủ trì là tài khoản vai "Giám đốc" không thuộc Ban Tổng Giám đốc (mô phỏng PMO).
// Vai: BTGĐ phụ trách toàn công ty = giamdoc (seed giả đánh dấu riêng, không theo phòng); Phó TGĐ phụ trách Phòng Kinh doanh = tài khoản giả tạo trong kịch bản;
// người chủ trì = tài khoản giả vai director (PMO); người phối hợp = nv.kinhdoanh2; lãnh đạo bộ phận chủ trì = tp.kinhdoanh;
// thành viên dự án không liên quan = nv.kythuat.
const { test, expect } = require('@playwright/test');
const { login, apiAs } = require('./helpers');

test.describe.configure({ mode: 'serial' });

const PMO_DIR = 'pmo.giamdoc', PGD = 'pgd.kinhdoanh';
let ctx = null; // { projectId, itemId, code, depts }

async function as(browser, username) {
  const page = await (await browser.newContext()).newPage();
  await login(page, username);
  return page;
}
const json = async res => { expect(res.status(), await res.text()).toBeLessThan(300); return res.json(); };
const openItem = async (page, projectId, itemId) => {
  await page.goto(`/#/projects/${projectId}?item=${itemId}`);
  await expect(page.locator('#itemPanel [data-testid="item-code"]')).toBeVisible();
  return page.locator('#itemPanel');
};

test('Q1. Chuẩn bị: TGĐ giao việc trong dự án MTL cho tài khoản vai Giám đốc không thuộc Ban Tổng Giám đốc', async ({ browser }) => {
  const admin = await as(browser, 'admin');
  const depts = await json(await apiAs(admin, '/api/departments'));
  const D = code => depts.find(d => d.code === code);
  // Tài khoản giả: PMO vai director (phòng "Ban Tổng Giám đốc", KHÔNG phải Ban Tổng Giám đốc) và Phó TGĐ phụ trách Phòng Kinh doanh.
  for (const [username, fullName, title] of [[PMO_DIR, 'Trợ lý PMO (giả)', 'Trợ lý – PMO (giả)'], [PGD, 'Phó GĐ Kinh doanh (giả)', 'Phó Tổng Giám đốc (giả)']]) {
    const r = await apiAs(admin, '/api/admin/users', { method: 'POST', data: { username, fullName, displayTitle: title, role: 'director', departmentId: D('BGD').id } });
    expect([201, 200, 409]).toContain(r.status());
  }
  const users = await json(await apiAs(admin, '/api/users/directory'));
  const U = name => users.find(u => u.username === name);
  await json(await apiAs(admin, `/api/departments/${D('KD').id}`, { method: 'PUT', data: { supervisorId: U(PGD).id } }));

  const tgd = await as(browser, 'giamdoc');
  const project = (await json(await apiAs(tgd, '/api/projects'))).find(p => p.key === 'DA');
  const due = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const item = await json(await apiAs(tgd, `/api/projects/${project.id}/items`, { method: 'POST', data: {
    title: 'Bảng phòng họp (giả)', leadDepartmentId: D('KD').id, assigneeIds: [U(PMO_DIR).id], supporterIds: [U('nv.kinhdoanh2').id], dueDate: due, source: 'Họp giao ban',
  } }));
  expect(item.assignedById).toBe(U('giamdoc').id); // người giao = TGĐ
  ctx = { projectId: project.id, itemId: item.id, code: item.code, U, D };
  const detail = await json(await apiAs(tgd, `/api/items/${item.id}`));
  expect(detail.capabilities.roles).toEqual(expect.arrayContaining(['A', 'B']));
  expect(detail.capabilities.plan).toBe(true);
});

test('Q2. Người chủ trì (vai Giám đốc, không thuộc BTGĐ): không có ô sửa đường găng / mốc / hạn / người giao / đánh giá; API trả 403', async ({ browser }) => {
  const lead = await as(browser, PMO_DIR);
  const detail = await json(await apiAs(lead, `/api/items/${ctx.itemId}`));
  expect(detail.capabilities.roles).toEqual(expect.arrayContaining(['L', 'O']));
  expect(detail.capabilities.roles).not.toContain('B');
  const panel = await openItem(lead, ctx.projectId, ctx.itemId);
  await expect(panel.getByTestId('my-roles')).toContainText('Người chủ trì');
  // Kế hoạch hiện dạng chữ: không ô nhập.
  for (const sel of ['#ipDue', '#ipCritical', '#ipMilestone', '#ipAssigner', '#ipAssignedAt', '#ipSource', '#ipPriority', 'textarea#ipTitle', '[data-field="review"]', '[data-field="deliverable"]'])
    await expect(panel.locator(sel)).toHaveCount(0);
  await expect(panel.getByTestId('rebaseline-open')).toHaveCount(0);
  await expect(panel.getByTestId('item-due')).not.toBeEmpty();
  await expect(panel.getByTestId('item-assigner')).toContainText('Trần Minh Giám');
  // Phần của người chủ trì: báo cáo tiến độ, dự báo hoàn thành, đổi trạng thái đang làm.
  await expect(panel.getByTestId('item-forecast')).toHaveAttribute('type', 'date');
  await expect(panel.getByTestId('item-state')).toBeEnabled();
  await expect(panel.locator('#ipState option', { hasText: 'Huỷ' })).toHaveAttribute('disabled', '');
  await expect(panel.locator('#ipState option', { hasText: 'Tạm dừng' })).toHaveAttribute('disabled', '');
  // API: mọi trường kế hoạch → 403; ô đánh giá viết tay đã bỏ → 422.
  const patch = data => apiAs(lead, `/api/items/${ctx.itemId}`, { method: 'PATCH', data });
  expect((await patch({ dueDate: new Date(Date.now() + 40 * 86_400_000).toISOString() })).status()).toBe(403);
  expect((await patch({ critical: true })).status()).toBe(403);
  expect((await patch({ milestone: true })).status()).toBe(403);
  expect((await patch({ title: 'Đổi tên (giả)' })).status()).toBe(403);
  expect((await patch({ source: 'Văn bản cấp trên' })).status()).toBe(403);
  expect((await patch({ assignedAt: new Date().toISOString() })).status()).toBe(403);
  expect((await patch({ assignedById: ctx.U(PMO_DIR).id })).status()).toBe(403);
  expect((await patch({ review: 'Tự đánh giá (giả)' })).status()).toBe(422);
  expect((await apiAs(lead, `/api/items/${ctx.itemId}/rebaseline`, { method: 'POST', data: { reason: 'thử (giả)', baselineStart: new Date().toISOString(), baselineEnd: new Date(Date.now() + 86_400_000).toISOString() } })).status()).toBe(403);
  expect((await patch({ stateId: (await json(await apiAs(lead, `/api/projects/${ctx.projectId}`))).states.find(s => s.category === 'CANCELLED').id })).status()).toBe(403);
  // Được: chuyển Đang thực hiện, dự báo hoàn thành, tạo việc nhánh của việc mình (khi đó là người giao của việc nhánh), đề nghị gia hạn.
  const states = (await json(await apiAs(lead, `/api/projects/${ctx.projectId}`))).states;
  await json(await patch({ stateId: states.find(s => s.category === 'STARTED').id }));
  await json(await patch({ forecastEnd: new Date(Date.now() + 25 * 86_400_000).toISOString() }));
  const child = await json(await apiAs(lead, `/api/projects/${ctx.projectId}/items`, { method: 'POST', data: { title: 'Khảo sát phòng họp (giả)', parentId: ctx.itemId, assignedById: ctx.U('giamdoc').id } }));
  expect(child.assignedById).toBe(ctx.U(PMO_DIR).id);
  await json(await apiAs(lead, `/api/items/${ctx.itemId}/extensions`, { method: 'POST', data: { newDue: new Date(Date.now() + 30 * 86_400_000).toISOString(), reason: 'Chờ báo giá (giả)' } }));
});

test('Q3. Người phối hợp chỉ gửi tài liệu, bình luận; thành viên không liên quan chỉ thấy tóm tắt', async ({ browser }) => {
  const sup = await as(browser, 'nv.kinhdoanh2');
  const panel = await openItem(sup, ctx.projectId, ctx.itemId);
  await expect(panel.getByTestId('report-open')).toHaveCount(0);
  await expect(panel.getByTestId('bar-report')).toHaveCount(0);
  await expect(panel.locator('#ipState')).toHaveCount(0);
  await panel.getByTestId('ip-tab-results').click();
  await panel.getByTestId('attach-input').setInputFiles({ name: 'ket-qua-gia.txt', mimeType: 'text/plain', buffer: Buffer.from('Kết quả phối hợp (giả)') });
  await expect(panel.getByTestId('tw-back')).toContainText('ket-qua-gia.txt');
  await panel.getByTestId('ip-tab-talk').click();
  await panel.getByTestId('comment-input').fill('Đã gửi bản vẽ (giả)');
  await panel.getByTestId('comment-submit').click();
  await expect(panel.getByTestId('comments')).toContainText('Đã gửi bản vẽ (giả)');
  for (const [data, code] of [[{ progress: 30 }, 403], [{ title: 'x' }, 403], [{ dueDate: new Date().toISOString() }, 403]])
    expect((await apiAs(sup, `/api/items/${ctx.itemId}`, { method: 'PATCH', data })).status()).toBe(code);
  expect((await apiAs(sup, `/api/items/${ctx.itemId}/progress-reports`, { method: 'POST', data: { content: 'phần phối hợp (giả)' } })).status()).toBe(403);
  expect((await apiAs(sup, `/api/items/${ctx.itemId}/documents`, { method: 'POST', data: { kind: 'BASIS', number: '01/GIA', summary: 'Căn cứ (giả)' } })).status()).toBe(403);
  expect((await apiAs(sup, `/api/items/${ctx.itemId}/documents`, { method: 'POST', data: { kind: 'OUTPUT', number: '02/GIA', summary: 'Sản phẩm (giả)' } })).status()).toBe(201);

  const other = await as(browser, 'nv.kythuat');
  const s = await json(await apiAs(other, `/api/items/${ctx.itemId}`));
  expect(s.summary).toBe(true);
  for (const k of ['comments', 'attachments', 'documents', 'progressReports', 'descriptionHtml', 'rating', 'review', 'assessment']) expect(s[k]).toBeUndefined();
  expect(s.assignees.map(a => a.username)).toContain(PMO_DIR);
  expect(typeof s.progress).toBe('number');
  const p2 = await openItem(other, ctx.projectId, ctx.itemId);
  await expect(p2.getByTestId('item-summary-only')).toBeVisible();
  await expect(p2.getByTestId('comments')).toHaveCount(0);
  const full = await json(await apiAs(sup, `/api/items/${ctx.itemId}`));
  const att = full.attachments.find(a => a.fileName === 'ket-qua-gia.txt');
  expect((await apiAs(other, `/api/attachments/${att.id}/download`)).status()).toBe(403);
  expect((await apiAs(other, `/api/items/${ctx.itemId}/comments`, { method: 'POST', data: { body: 'xin chào' } })).status()).toBe(403);
  // Danh sách: thẻ tóm tắt — không văn bản, mô tả, số bình luận / tệp.
  const card = (await json(await apiAs(other, `/api/projects/${ctx.projectId}/items`))).find(i => i.id === ctx.itemId);
  expect(card.my.view).toBe('SUMMARY');
  expect(card.counts.comments).toBe(0);
  ctx.attId = att.id;
});

test('Q4. Lãnh đạo bộ phận chủ trì chỉ xem (bình luận được); Phó TGĐ phụ trách sửa kế hoạch, duyệt gia hạn; xoá tệp chỉ người gửi', async ({ browser }) => {
  const head = await as(browser, 'tp.kinhdoanh');
  const panel = await openItem(head, ctx.projectId, ctx.itemId);
  await expect(panel.getByTestId('my-roles')).toContainText('Lãnh đạo bộ phận');
  for (const sel of ['#ipDue', 'textarea#ipTitle', '#ipCritical', '#ipAssigner', '#ipState']) await expect(panel.locator(sel)).toHaveCount(0);
  await panel.getByTestId('ip-tab-talk').click();
  await expect(panel.getByTestId('comments')).toContainText('Đã gửi bản vẽ (giả)'); // xem toàn bộ
  expect((await apiAs(head, `/api/items/${ctx.itemId}`, { method: 'PATCH', data: { dueDate: new Date().toISOString() } })).status()).toBe(403);
  expect((await apiAs(head, `/api/items/${ctx.itemId}`, { method: 'PATCH', data: { assigneeIds: [ctx.U('nv.kinhdoanh1').id] } })).status()).toBe(403);
  const ext = (await json(await apiAs(head, `/api/items/${ctx.itemId}`))).extensions.find(x => x.status === 'PENDING');
  expect((await apiAs(head, `/api/extensions/${ext.id}/decide`, { method: 'POST', data: { decision: 'APPROVE' } })).status()).toBe(403);
  expect((await apiAs(head, `/api/items/${ctx.itemId}/comments`, { method: 'POST', data: { body: 'Phòng nắm (giả)' } })).status()).toBe(201);

  // PMO (chủ dự án / trưởng dự án MTL) không sửa kế hoạch việc người khác giao.
  const pmo = await as(browser, 'pmo');
  expect((await apiAs(pmo, `/api/items/${ctx.itemId}`, { method: 'PATCH', data: { critical: true } })).status()).toBe(403);

  // Phó TGĐ phụ trách bộ phận chủ trì = BTGĐ phụ trách của việc: sửa kế hoạch, duyệt gia hạn.
  const pgd = await as(browser, PGD);
  const p3 = await openItem(pgd, ctx.projectId, ctx.itemId);
  await expect(p3.locator('#ipDue')).toHaveCount(1);
  await expect(p3.locator('#ipCritical')).toHaveCount(1);
  await expect(p3.getByTestId('extension-approve')).toBeVisible();
  await json(await apiAs(pgd, `/api/items/${ctx.itemId}`, { method: 'PATCH', data: { critical: true, milestone: true } }));
  await json(await apiAs(pgd, `/api/extensions/${ext.id}/decide`, { method: 'POST', data: { decision: 'APPROVE' } }));

  // Xoá tệp: chỉ người đã gửi (TGĐ cũng không xoá được tệp của người phối hợp).
  const tgd = await as(browser, 'giamdoc');
  const p4 = await openItem(tgd, ctx.projectId, ctx.itemId);
  await p4.getByTestId('ip-tab-results').click();
  await expect(p4.getByTestId('tw-back')).toContainText('ket-qua-gia.txt');
  await expect(p4.locator(`[data-del-att="${ctx.attId}"]`)).toHaveCount(0);
  expect((await apiAs(tgd, `/api/attachments/${ctx.attId}`, { method: 'DELETE' })).status()).toBe(403);
  const sup = await as(browser, 'nv.kinhdoanh2');
  const p5 = await openItem(sup, ctx.projectId, ctx.itemId);
  await p5.getByTestId('ip-tab-results').click();
  await expect(p5.locator(`[data-del-att="${ctx.attId}"]`)).toHaveCount(1);
  await json(await apiAs(sup, `/api/attachments/${ctx.attId}`, { method: 'DELETE' }));

  // Không ai tự nhận làm người giao của việc chưa có người giao (kể cả TGĐ).
  await json(await apiAs(tgd, `/api/items/${ctx.itemId}`, { method: 'PATCH', data: { assignedById: null } }));
  expect((await apiAs(tgd, `/api/items/${ctx.itemId}`, { method: 'PATCH', data: { assignedById: ctx.U('giamdoc').id } })).status()).toBe(403);
  await json(await apiAs(pgd, `/api/items/${ctx.itemId}`, { method: 'PATCH', data: { assignedById: ctx.U('giamdoc').id } }));
});

test('Q5. Duyệt: người chủ trì gửi duyệt, người giao chấm mức + nhận xét; đánh giá chỉ đọc, không ghi đè ô đánh giá cũ', async ({ browser }) => {
  const lead = await as(browser, PMO_DIR);
  const items = await json(await apiAs(lead, `/api/projects/${ctx.projectId}/items`));
  // Việc nhánh do người chủ trì tạo: người chủ trì là người giao → người chủ trì việc nhánh (chính họ) không tự duyệt.
  const child = items.find(i => i.parentId === ctx.itemId);
  expect(child).toBeTruthy();
  const tgd = await as(browser, 'giamdoc');
  const detail = await json(await apiAs(tgd, `/api/items/${ctx.itemId}`));
  const review = (await json(await apiAs(tgd, `/api/projects/${ctx.projectId}`))).states.find(s => s.category === 'REVIEW');
  // Người giao đóng việc nhánh để việc cha gửi duyệt được.
  await json(await apiAs(tgd, `/api/items/${child.id}`, { method: 'PATCH', data: { stateId: (await json(await apiAs(tgd, `/api/projects/${ctx.projectId}`))).states.find(s => s.category === 'CANCELLED').id } }));
  await json(await apiAs(lead, `/api/items/${ctx.itemId}`, { method: 'PATCH', data: { stateId: review.id } }));
  const pending = (await json(await apiAs(tgd, `/api/items/${ctx.itemId}`))).approvals.find(a => a.status === 'PENDING');
  await json(await apiAs(tgd, `/api/approvals/${pending.id}/approve`, { method: 'POST', data: { rating: 'GOOD', comment: 'Làm tốt (giả)' } }));
  const after = await json(await apiAs(lead, `/api/items/${ctx.itemId}`));
  expect(after.assessment).toMatchObject({ rating: 'GOOD', comment: 'Làm tốt (giả)' });
  expect(after.review).toBe(detail.review); // không ghi đè ô đánh giá cũ
  const panel = await openItem(lead, ctx.projectId, ctx.itemId);
  await expect(panel.getByTestId('item-rating').first()).toContainText('Tốt');
  await expect(panel.locator('[data-field="review"]')).toHaveCount(0);
  // Việc đã hoàn thành: người chủ trì không mở lại; người giao / BTGĐ mở lại được.
  const started = (await json(await apiAs(lead, `/api/projects/${ctx.projectId}`))).states.find(s => s.category === 'STARTED');
  expect((await apiAs(lead, `/api/items/${ctx.itemId}`, { method: 'PATCH', data: { stateId: started.id } })).status()).toBe(403);
  await json(await apiAs(tgd, `/api/items/${ctx.itemId}`, { method: 'PATCH', data: { stateId: started.id } }));
});

test('Q6. Bước giao cho bộ phận chưa có người: lãnh đạo bộ phận chủ trì chọn người trong phòng mình, không sửa kế hoạch', async ({ browser }) => {
  const tgd = await as(browser, 'giamdoc');
  const step = await json(await apiAs(tgd, `/api/projects/${ctx.projectId}/items`, { method: 'POST', data: { title: 'Lắp màn hình phòng họp (giả)', leadDepartmentId: ctx.D('KD').id } }));
  const head = await as(browser, 'tp.kinhdoanh');
  const caps = (await json(await apiAs(head, `/api/items/${step.id}`))).capabilities;
  expect(caps.assignOwnDept).toBe(true);
  expect(caps.plan).toBe(false);
  const patch = data => apiAs(head, `/api/items/${step.id}`, { method: 'PATCH', data });
  expect((await patch({ assigneeIds: [ctx.U('nv.kythuat').id] })).status()).toBe(403); // người phòng khác
  expect((await patch({ dueDate: new Date().toISOString() })).status()).toBe(403); // kế hoạch
  await json(await patch({ assigneeIds: [ctx.U('nv.kinhdoanh1').id] }));
  // Đã có người chủ trì: phân công lại là của người giao / Ban Tổng Giám đốc.
  expect((await patch({ assigneeIds: [ctx.U('nv.kinhdoanh2').id] })).status()).toBe(403);
});

test('Q7. BTGĐ phụ trách toàn công ty (quản trị đánh dấu riêng) sửa việc mọi bộ phận; Phó TGĐ phụ trách chỉ sửa việc bộ phận mình, bộ phận khác chỉ xem', async ({ browser }) => {
  const admin = await as(browser, 'admin');
  const BOARD = 'bgd.toanquyen';
  const r = await apiAs(admin, '/api/admin/users', { method: 'POST', data: { username: BOARD, fullName: 'Phó TGĐ toàn quyền (giả)', displayTitle: 'Phó Tổng Giám đốc (giả)', role: 'director', departmentId: ctx.D('BGD').id } });
  expect([200, 201]).toContain(r.status());
  const boardId = (await r.json()).id;
  // Việc do bộ phận khác (Ban Pháp lý) chủ trì: bước 8 của dự án mẫu.
  const pmo = await as(browser, 'pmo');
  const step8 = (await json(await apiAs(pmo, `/api/projects/${ctx.projectId}/items`))).find(i => i.code === 'DA-8');
  expect(step8.leadDepartmentId).toBe(ctx.D('PL').id);

  // Chưa được đánh dấu: vai "Giám đốc" chỉ xem, không sửa kế hoạch (cùng phòng với người được đánh dấu cũng vậy).
  const board = await as(browser, BOARD);
  expect((await apiAs(board, `/api/items/${step8.id}`, { method: 'PATCH', data: { priority: 'HIGH' } })).status()).toBe(403);

  // Quản trị đánh dấu "BTGĐ phụ trách toàn công ty" trong hộp Phân quyền (không theo phòng); danh sách tài khoản hiện nhãn.
  await admin.goto('/#/admin/users');
  await admin.reload(); // trang Tài khoản đã mở sẵn từ lúc đăng nhập: tải lại để có tài khoản vừa tạo
  await admin.getByTestId(`perm-${BOARD}`).click();
  await expect(admin.getByTestId('perm-board-all')).not.toBeChecked();
  await admin.getByTestId('perm-board-all').check();
  await admin.getByTestId('perm-save').click();
  await expect(admin.locator('.toast', { hasText: 'Đã lưu phân quyền' }).first()).toBeVisible();
  await expect(admin.getByTestId(`user-${BOARD}`).getByTestId('board-all-pill')).toBeVisible();
  // Không đánh dấu được tài khoản quản trị hệ thống.
  const me = await json(await apiAs(admin, '/api/me'));
  expect((await apiAs(admin, `/api/admin/users/${me.id ?? me.user?.id}/board`, { method: 'PUT', data: { boardAll: true } })).status()).toBeGreaterThanOrEqual(403);

  // BTGĐ phụ trách toàn công ty: sửa được việc ở mọi bộ phận (Kinh doanh, Pháp lý), duyệt gia hạn.
  for (const id of [ctx.itemId, step8.id]) {
    const d = await json(await apiAs(board, `/api/items/${id}`));
    expect(d.capabilities.roles).toContain('B');
    expect(d.capabilities.plan).toBe(true);
    expect(d.capabilities.decideExtension).toBe(true);
    await json(await apiAs(board, `/api/items/${id}`, { method: 'PATCH', data: { priority: 'HIGH' } }));
  }
  const p1 = await openItem(board, ctx.projectId, step8.id);
  await expect(p1.locator('#ipDue')).toHaveCount(1);

  // Phó TGĐ phụ trách Phòng Kinh doanh: việc Kinh doanh chủ trì — sửa được; việc Ban Pháp lý chủ trì — chỉ xem (vai Giám đốc), API 403.
  const pgd = await as(browser, PGD);
  expect((await json(await apiAs(pgd, `/api/items/${ctx.itemId}`))).capabilities.plan).toBe(true);
  const other = await json(await apiAs(pgd, `/api/items/${step8.id}`));
  expect(other.summary).toBeUndefined(); // xem toàn bộ
  expect(other.capabilities.roles).not.toContain('B');
  expect(other.capabilities.plan).toBe(false);
  expect((await apiAs(pgd, `/api/items/${step8.id}`, { method: 'PATCH', data: { priority: 'LOW' } })).status()).toBe(403);
  expect((await apiAs(pgd, `/api/items/${step8.id}`, { method: 'PATCH', data: { dueDate: new Date().toISOString() } })).status()).toBe(403);
  const p2 = await openItem(pgd, ctx.projectId, step8.id);
  await expect(p2.locator('#ipDue')).toHaveCount(0);
  await expect(p2.locator('textarea#ipTitle')).toHaveCount(0);

  // Bỏ đánh dấu → mất quyền Ban Tổng Giám đốc ngay; thay đổi được ghi nhật ký.
  await json(await apiAs(admin, `/api/admin/users/${boardId}/board`, { method: 'PUT', data: { boardAll: false } }));
  expect((await apiAs(board, `/api/items/${step8.id}`, { method: 'PATCH', data: { priority: 'LOW' } })).status()).toBe(403);
  expect(JSON.stringify(await json(await apiAs(admin, '/api/admin/audit?action=BOARD_ALL_UPDATE')))).toContain('BOARD_ALL_UPDATE');
});

test('Q8. Việc mốc / đường găng: BTGĐ phụ trách của việc duyệt và chấm mức thay người giao; Ban Tổng Giám đốc là người chủ trì thì Ban Tổng Giám đốc khác duyệt', async ({ browser }) => {
  const U = ctx.U, D = ctx.D;
  const pmo = await as(browser, 'pmo'); // người giao, không thuộc Ban Tổng Giám đốc
  const states = (await json(await apiAs(pmo, `/api/projects/${ctx.projectId}`))).states;
  const REVIEW = states.find(s => s.category === 'REVIEW').id;
  const due = new Date(Date.now() + 15 * 86_400_000).toISOString();
  const create = async data => json(await apiAs(pmo, `/api/projects/${ctx.projectId}/items`, { method: 'POST', data: { dueDate: due, ...data } }));

  // a) Việc đường găng, Phòng Kinh doanh chủ trì: người duyệt = BTGĐ phụ trách toàn công ty + Phó TGĐ phụ trách Kinh doanh; người giao (PMO) không duyệt.
  const crit = await create({ title: 'Ký hợp đồng thuê phòng họp (giả)', leadDepartmentId: D('KD').id, assigneeIds: [U('nv.kinhdoanh1').id], critical: true });
  expect((await apiAs(pmo, `/api/items/${crit.id}`, { method: 'PATCH', data: { stateId: REVIEW } })).status()).toBe(403); // người giao không gửi duyệt thay
  const lead = await as(browser, 'nv.kinhdoanh1');
  // Người chủ trì bấm "Gửi duyệt" trên panel: thông báo ghi đúng người duyệt (Ban Tổng Giám đốc, không phải người giao).
  const lp = await openItem(lead, ctx.projectId, crit.id);
  await lp.getByTestId('submit-approval').click();
  await expect(lead.locator('.toast', { hasText: 'Đã gửi Ban Tổng Giám đốc duyệt' }).first()).toBeVisible();
  const d = await json(await apiAs(pmo, `/api/items/${crit.id}`));
  expect(d.approvalSteps[0]).toMatchObject({ approverType: 'BOARD', name: 'Ban Tổng Giám đốc duyệt' });
  expect(d.stepApprovers['1']).toEqual(expect.arrayContaining(['Trần Minh Giám', 'Phó GĐ Kinh doanh (giả)']));
  expect(d.stepApprovers['1']).not.toContain('Đặng Quốc Minh');
  expect(d.stage.label).toBe('Chờ Ban Tổng Giám đốc duyệt');
  expect(d.canApprove).toBe(false);
  const pending = d.approvals.find(a => a.status === 'PENDING');
  expect((await json(await apiAs(pmo, '/api/approvals/queue'))).some(q => q.item.id === crit.id)).toBe(false);
  expect((await apiAs(pmo, `/api/approvals/${pending.id}/approve`, { method: 'POST', data: { rating: 'GOOD' } })).status()).toBe(403);
  // "Chờ tôi duyệt" và thông báo "Cần duyệt" tới đúng BTGĐ phụ trách của việc.
  const tgd = await as(browser, 'giamdoc');
  const pgd = await as(browser, PGD);
  for (const page of [tgd, pgd]) {
    const q = (await json(await apiAs(page, '/api/approvals/queue'))).find(x => x.item.id === crit.id);
    expect(q).toMatchObject({ ratingRequired: true, stepName: 'Ban Tổng Giám đốc duyệt' });
    expect((await json(await apiAs(page, '/api/notifications'))).items.some(n => n.type === 'APPROVAL_REQUESTED' && n.link.endsWith(`item=${crit.id}`))).toBe(true);
  }
  expect((await json(await apiAs(pmo, '/api/notifications'))).items.some(n => n.type === 'APPROVAL_REQUESTED' && n.link.endsWith(`item=${crit.id}`))).toBe(false);
  // BTGĐ phụ trách toàn công ty duyệt + chấm mức trên giao diện.
  const panel = await openItem(tgd, ctx.projectId, crit.id);
  await panel.getByTestId('rating-GOOD').check();
  await panel.getByTestId('approval-comment').fill('Đúng tiến độ găng (giả)');
  await panel.getByTestId('approve-btn').click();
  await expect(tgd.locator('.toast', { hasText: 'Đã duyệt' }).first()).toBeVisible();
  const done = await json(await apiAs(lead, `/api/items/${crit.id}`));
  expect(done.state.category).toBe('COMPLETED');
  expect(done.assessment).toMatchObject({ rating: 'GOOD', by: 'Trần Minh Giám', comment: 'Đúng tiến độ găng (giả)' });

  // b) Việc mốc mà BTGĐ phụ trách toàn công ty chính là người chủ trì → BTGĐ phụ trách toàn công ty khác duyệt.
  const admin = await as(browser, 'admin');
  const board = (await json(await apiAs(admin, '/api/users/directory'))).find(u => u.username === 'bgd.toanquyen');
  await json(await apiAs(admin, `/api/admin/users/${board.id}/board`, { method: 'PUT', data: { boardAll: true } }));
  const ms = await create({ title: 'Mốc khai trương phòng họp (giả)', leadDepartmentId: D('PL').id, assigneeIds: [U('giamdoc').id], milestone: true });
  await json(await apiAs(tgd, `/api/items/${ms.id}`, { method: 'PATCH', data: { stateId: REVIEW } }));
  const m = await json(await apiAs(pmo, `/api/items/${ms.id}`));
  expect(m.stepApprovers['1']).toContain('Phó TGĐ toàn quyền (giả)');
  expect(m.stepApprovers['1']).not.toContain('Trần Minh Giám');
  const mp = m.approvals.find(a => a.status === 'PENDING');
  expect((await (await apiAs(tgd, `/api/approvals/${mp.id}/approve`, { method: 'POST', data: { rating: 'GOOD' } })).json()).code).toBe('SELF_APPROVAL');
  const bgd = await as(browser, 'bgd.toanquyen');
  await json(await apiAs(bgd, `/api/approvals/${mp.id}/approve`, { method: 'POST', data: { rating: 'PASS', comment: 'Đạt (giả)' } }));
  expect((await json(await apiAs(pmo, `/api/items/${ms.id}`))).state.category).toBe('COMPLETED');

  // c) Việc thường (không mốc, không găng): người giao duyệt như cũ.
  const normal = await create({ title: 'In biển tên phòng họp (giả)', leadDepartmentId: D('KD').id, assigneeIds: [U('nv.kinhdoanh1').id] });
  await json(await apiAs(lead, `/api/items/${normal.id}`, { method: 'PATCH', data: { stateId: REVIEW } }));
  const n = await json(await apiAs(pmo, `/api/items/${normal.id}`));
  expect(n.approvalSteps[0].approverType).toBe('ASSIGNER');
  expect(n.canApprove).toBe(true);
  expect((await json(await apiAs(tgd, '/api/approvals/queue'))).some(q => q.item.id === normal.id)).toBe(false);
});
