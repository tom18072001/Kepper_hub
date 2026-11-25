// Sửa 5 lỗi mức Cao nhóm "dự án" (25/11/2026; de-xuat-sua-3-du-an.md C1–C4, kiem-cheo-thiet-lap.md #13 / #35) — server thật, dữ liệu GIẢ.
// Mỗi kịch bản tự tạo dự án riêng (mã kèm TAG của lượt chạy), không đổi thiết lập dùng chung; chỉ thêm một tài khoản giả đã khoá (#13).
//   C1  hộp Tạo dự án nói đúng bước người giao; trang dự án "Duyệt N cấp" và panel việc "Quy trình duyệt N cấp" cùng một con số;
//       bảng không có duyệt (Lịch tuần) không có nhãn.
//   C2  xoá dự án / việc không huỷ phiếu chờ duyệt; phiếu trong Thùng rác bị chặn (409); khôi phục → phiếu hiện lại, duyệt được.
//   C3  nhập "Danh sách đơn giản (Excel)": người nhập là người giao — sửa kế hoạch, giao người, xoá được việc vừa nhập.
//   C4  cột còn việc không đổi nhóm được (409, kể cả việc trong Thùng rác); đổi tên / WIP, cột trống thì được; Cài đặt khoá ô nhóm.
//   #13 / #35  tài khoản Quản trị hệ thống không làm Người đứng tên / thành viên (422), không có trong các ô chọn người.
const path = require('node:path');
const ExcelJS = require(path.join(__dirname, '../../server/node_modules/exceljs'));
const { test, expect, login, apiAs, vnDate, toast, sharedPage, closeSharedPages } = require('./helpers');

// Các kịch bản độc lập (mỗi kịch bản tự tạo dự án): không chạy nối tiếp bắt buộc — một kịch bản hỏng không làm bỏ qua kịch bản sau.
test.afterAll(closeSharedPages); // trang đăng nhập từng người dùng chung cho cả tệp

const TAG = Date.now().toString(36).slice(-4).toUpperCase(); // mã dự án: 2 chữ + TAG (chữ in hoa / số), riêng cho lượt chạy
const pages = {};
let users = [], kd = null;
const U = name => users.find(u => u.username === name);
const go = (page, hash) => page.evaluate(h => { location.hash = h; }, hash);
async function as(browser, username) {
  if (!pages[username]) { pages[username] = await sharedPage(browser); await login(pages[username], username); }
  return pages[username];
}
async function json(r, status) { const t = await r.text(); expect(r.status(), t).toBe(status); return t ? JSON.parse(t) : null; }
const newProject = async (page, key, data = {}) => json(await apiAs(page, '/api/projects', { method: 'POST',
  data: { key: key + TAG, name: `Dự án ${key} ${TAG} (giả)`, departmentId: kd.id, approvalSteps: [], ...data } }), 201);
const newItem = async (page, project, data = {}) => json(await apiAs(page, `/api/projects/${project.id}/items`, { method: 'POST', data: { title: `Việc ${TAG} (giả)`, ...data } }), 201);
const stateOf = (project, category) => project.states.find(s => s.category === category);
const levels = async loc => Number((await loc.textContent()).match(/(\d+) cấp/)[1]);

test.beforeAll(async ({ browser }) => {
  const lead = await as(browser, 'tp.kinhdoanh');
  users = await json(await apiAs(lead, '/api/users/directory'), 200);
  kd = (await json(await apiAs(lead, '/api/departments'), 200)).find(d => d.code === 'KD');
});

test('C1: hộp Tạo dự án nói đúng bước người giao; trang dự án và panel việc cùng đếm số cấp; Lịch tuần không có nhãn duyệt', async ({ browser }) => {
  const lead = await as(browser, 'tp.kinhdoanh');
  await lead.getByTestId('new-project').click();
  const tpl = lead.getByTestId('project-approval-template');
  await expect(tpl.locator('xpath=..')).toContainText('Cấp duyệt thêm sau người giao');
  await expect(tpl.locator('option')).toHaveText(['Người giao → Lãnh đạo bộ phận', 'Người giao → Lãnh đạo bộ phận → BTGĐ phụ trách', 'Chỉ người giao duyệt']);
  await expect(tpl).toHaveValue('1');
  await lead.getByTestId('project-key').fill('CA' + TAG);
  await lead.getByTestId('project-name').fill(`Duyệt một cấp ${TAG} (giả)`);
  await lead.getByTestId('project-template').selectOption('');
  await lead.getByTestId('project-save').click();
  // Dự án "Người giao → Lãnh đạo bộ phận": trang dự án ghi 2 cấp (đếm cả bước người giao), panel việc cũng 2 cấp.
  const flow = lead.getByTestId('approval-flow');
  await expect(flow).toContainText('Duyệt 2 cấp');
  await expect(flow).toContainText('Người giao → Lãnh đạo bộ phận duyệt');
  const one = (await json(await apiAs(lead, '/api/projects'), 200)).find(p => p.key === 'CA' + TAG);
  const item = await newItem(lead, one, { assigneeIds: [U('nv.kinhdoanh1').id] });
  await go(lead, `#/projects/${one.id}?item=${item.id}`);
  const panel = lead.getByTestId('approval-section');
  await expect(panel).toContainText('Quy trình duyệt 2 cấp');
  expect(await levels(flow.locator('b'))).toBe(await levels(panel.locator('.sec-title')));

  // Cài đặt: "Để trống = chỉ người giao duyệt …"; mức mặc định và quy tắc tự động nói rõ bước người giao.
  await go(lead, `#/projects/${one.id}/settings`);
  await expect(lead.getByTestId('steps-help')).toContainText('Để trống = chỉ người giao duyệt (việc mốc / đường găng: BTGĐ phụ trách).');
  await expect(lead.getByTestId('default-levels').locator('option')).toHaveText(['Người giao → đủ 1 cấp (Lãnh đạo bộ phận duyệt)', 'Chỉ người giao duyệt']);
  await lead.getByTestId('add-rule').click();
  await expect(lead.getByTestId('rule-levels').locator('option')).toHaveText(['chỉ người giao duyệt', 'người giao + đủ 1 cấp']);

  // Dự án chỉ người giao duyệt (0 cấp, có cột Hoàn thành): "Duyệt 1 cấp: Người giao"; panel việc 1 cấp.
  const zero = await newProject(lead, 'CB');
  const zeroItem = await newItem(lead, zero, { assigneeIds: [U('nv.kinhdoanh1').id] });
  await go(lead, `#/projects/${zero.id}?item=${zeroItem.id}`);
  await expect(panel).toContainText('Quy trình duyệt 1 cấp');
  await expect(flow).toContainText('Duyệt 1 cấp');
  await expect(flow.locator('.flow-steps')).toHaveText('Người giao');
  expect(await levels(flow.locator('b'))).toBe(await levels(panel.locator('.sec-title')));

  // Lịch tuần (không có cột Chờ duyệt / Hoàn thành): không có nhãn, panel việc nói bảng không có duyệt.
  const week = await newProject(lead, 'CW', { template: 'WEEK' });
  const weekItem = await newItem(lead, week);
  await go(lead, `#/projects/${week.id}?item=${weekItem.id}`);
  await expect(lead.getByTestId('no-approval-needed')).toBeVisible();
  await expect(lead.locator('#crumbs')).toContainText(week.name);
  await expect(flow).toHaveCount(0);
});

test('C2: xoá dự án / việc không huỷ phiếu chờ duyệt; trong Thùng rác bị chặn (409); khôi phục → phiếu hiện lại, duyệt được', async ({ browser }) => {
  const lead = await as(browser, 'tp.kinhdoanh'), doer = await as(browser, 'nv.kinhdoanh1');
  const project = await newProject(lead, 'CC');
  const review = stateOf(project, 'REVIEW');
  const queued = async id => (await json(await apiAs(lead, '/api/approvals/queue'), 200)).some(q => q.id === id);
  // Người giao (tp.kinhdoanh) giao cho nhân viên; nhân viên gửi duyệt → phiếu vào "Chờ tôi duyệt" của người giao.
  const submitted = async title => {
    const it = await newItem(lead, project, { title, assigneeIds: [U('nv.kinhdoanh1').id] });
    await json(await apiAs(doer, `/api/items/${it.id}`, { method: 'PATCH', data: { stateId: review.id } }), 200);
    const req = (await json(await apiAs(lead, '/api/approvals/queue'), 200)).find(q => q.item.id === it.id);
    expect(req, 'phiếu vào hàng chờ của người giao').toBeTruthy();
    return { it, req };
  };
  const approve = id => apiAs(lead, `/api/approvals/${id}/approve`, { method: 'POST', data: { rating: 'GOOD' } });
  const blocked = async (r, code, error) => expect(await json(r, 409)).toMatchObject({ code, error });

  // Dự án vào Thùng rác: phiếu ẩn khỏi hàng chờ, duyệt / trả lại / rút đều 409.
  const a = await submitted(`Phiếu của dự án ${TAG} (giả)`);
  await json(await apiAs(lead, `/api/projects/${project.id}`, { method: 'DELETE', data: { confirmKey: project.key } }), 200);
  expect(await queued(a.req.id)).toBe(false);
  const IN_TRASH = 'Dự án đang ở Thùng rác — khôi phục dự án trước';
  await blocked(await approve(a.req.id), 'PROJECT_IN_TRASH', IN_TRASH);
  await blocked(await apiAs(lead, `/api/approvals/${a.req.id}/reject`, { method: 'POST', data: { comment: 'Trả lại (giả)' } }), 'PROJECT_IN_TRASH', IN_TRASH);
  await blocked(await apiAs(doer, `/api/approvals/${a.req.id}/withdraw`, { method: 'POST', data: {} }), 'PROJECT_IN_TRASH', IN_TRASH);
  // Khôi phục: phiếu vẫn PENDING nên tự hiện lại; duyệt được.
  expect((await json(await apiAs(lead, `/api/projects/${project.id}/restore`, { method: 'POST' }), 200)).reopenedApprovals).toBe(0);
  expect(await queued(a.req.id)).toBe(true);
  expect((await json(await approve(a.req.id), 200)).status).toBe('APPROVED');
  expect((await json(await apiAs(lead, `/api/items/${a.it.id}`), 200)).state.category).toBe('COMPLETED');

  // Một việc vào Thùng rác: cùng cách.
  const b = await submitted(`Phiếu của việc ${TAG} (giả)`);
  await json(await apiAs(lead, `/api/items/${b.it.id}`, { method: 'DELETE' }), 200);
  expect(await queued(b.req.id)).toBe(false);
  const ITEM_IN_TRASH = 'Việc đang ở Thùng rác — khôi phục việc trước';
  await blocked(await approve(b.req.id), 'ITEM_IN_TRASH', ITEM_IN_TRASH);
  await blocked(await apiAs(doer, `/api/approvals/${b.req.id}/withdraw`, { method: 'POST', data: {} }), 'ITEM_IN_TRASH', ITEM_IN_TRASH);
  expect((await json(await apiAs(lead, `/api/items/${b.it.id}`), 200)).canApprove).toBe(false);
  // Đổi các cấp duyệt khi còn phiếu của việc trong Thùng rác: vẫn chặn, thông báo nói rõ.
  const steps = await json(await apiAs(lead, `/api/projects/${project.id}/approval-steps`, { method: 'PUT', data: { steps: [{ approverType: 'DEPARTMENT_MANAGER' }] } }), 409);
  expect(steps.error).toContain('Trong đó 1 yêu cầu của việc đang ở Thùng rác');
  await json(await apiAs(lead, `/api/items/${b.it.id}/restore`, { method: 'POST' }), 200);
  expect(await queued(b.req.id)).toBe(true);
  expect((await json(await approve(b.req.id), 200)).status).toBe('APPROVED');
});

test('C3: nhập "Danh sách đơn giản (Excel)": người nhập là người giao — sửa kế hoạch, giao người, xoá được việc vừa nhập', async ({ browser }) => {
  const lead = await as(browser, 'tp.kinhdoanh'), importer = await as(browser, 'nv.kinhdoanh2');
  const project = await newProject(lead, 'CD');
  const titles = [`Nhập Excel có người nhận ${TAG} (giả)`, `Nhập Excel chưa giao ${TAG} (giả)`];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cong viec');
  ws.addRow(['Tiêu đề', 'Mô tả', 'Người nhận (tài khoản, cách nhau dấu phẩy)', 'Ưu tiên', 'Bắt đầu (YYYY-MM-DD)', 'Hạn (YYYY-MM-DD)', 'Trạng thái']);
  ws.addRow([titles[0], 'Mô tả giả', 'nv.kinhdoanh1', 'Cao', '', vnDate(5), '']);
  ws.addRow([titles[1], '', '', '', '', '', '']);
  const file = { name: 'danh-sach.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
  expect((await json(await apiAs(importer, `/api/projects/${project.id}/import`, { method: 'POST', multipart: { file } }), 201)).created).toBe(2);
  const rows = (await json(await apiAs(importer, `/api/projects/${project.id}/items`), 200)).filter(i => titles.includes(i.title));
  expect(rows).toHaveLength(2);
  const me = U('nv.kinhdoanh2');
  for (const row of rows) {
    const d = await json(await apiAs(importer, `/api/items/${row.id}`), 200);
    expect(d).toMatchObject({ assignedById: me.id, assignedByName: me.fullName });
    expect(d.assignedAt).toBeTruthy();
    expect(d.capabilities.plan, 'người nhập sửa được kế hoạch').toBe(true);
  }
  // Trước bản sửa: 403 "Kế hoạch của việc … do người giao hoặc Ban Tổng Giám đốc sửa" với mọi người trừ BTGĐ phụ trách.
  const [withAssignee, unassigned] = titles.map(t => rows.find(r => r.title === t));
  const due = vnDate(9);
  expect((await json(await apiAs(importer, `/api/items/${withAssignee.id}`, { method: 'PATCH', data: { dueDate: due } }), 200)).dueDate.slice(0, 10)).toBe(due);
  await json(await apiAs(importer, `/api/items/${unassigned.id}`, { method: 'PATCH', data: { assigneeIds: [U('nv.kinhdoanh1').id] } }), 200);
  await json(await apiAs(importer, `/api/items/${unassigned.id}`, { method: 'DELETE' }), 200);
});

test('C4: cột còn việc không đổi nhóm được (409, kể cả việc trong Thùng rác); đổi tên / WIP, cột trống thì được; Cài đặt khoá ô nhóm', async ({ browser }) => {
  const lead = await as(browser, 'tp.kinhdoanh');
  const project = await newProject(lead, 'CE');
  // Việc mới vào cột "Cần làm" (nhóm Chưa bắt đầu). Đổi cột đó sang Hoàn thành vẫn còn đủ nhóm bắt buộc — trước bản sửa là mọi việc
  // trong cột thành xong mà không qua duyệt.
  const todo = stateOf(project, 'UNSTARTED'), backlog = stateOf(project, 'BACKLOG');
  const it = await newItem(lead, project, { assigneeIds: [U('nv.kinhdoanh1').id] });
  expect(it.stateId).toBe(todo.id);
  const put = (change = {}) => apiAs(lead, `/api/projects/${project.id}/states`, { method: 'PUT',
    data: { states: project.states.map(s => ({ id: s.id, name: s.name, category: s.category, color: s.color, wipLimit: s.wipLimit, ...(change[s.id] || {}) })) } });
  const LOCKED = `Cột "${todo.name}" còn 1 việc — chuyển việc sang cột khác rồi mới đổi nhóm`;
  expect(await json(await put({ [todo.id]: { category: 'COMPLETED' } }), 409)).toMatchObject({ code: 'STATE_CATEGORY_LOCKED', error: LOCKED });
  expect((await json(await apiAs(lead, `/api/items/${it.id}`), 200)).state.category, 'việc không thành Hoàn thành').toBe('UNSTARTED');
  expect((await json(await put({ [todo.id]: { category: 'OTHER' } }), 409)).code, 'sang Cột tự do cũng khoá').toBe('STATE_CATEGORY_LOCKED');
  // Đổi tên, WIP của cột còn việc; đổi nhóm của cột trống: được.
  const saved = await json(await put({ [todo.id]: { name: 'Chưa làm', wipLimit: 3 }, [backlog.id]: { category: 'OTHER' } }), 200);
  expect(saved.states.find(s => s.id === todo.id)).toMatchObject({ name: 'Chưa làm', category: 'UNSTARTED', wipLimit: 3 });
  expect(saved.states.find(s => s.id === backlog.id).category).toBe('OTHER');
  // Màn Cài đặt: ô nhóm của cột còn việc bị khoá kèm lý do; cột trống thì không.
  await go(lead, `#/projects/${project.id}/settings`);
  const row = lead.locator(`#statesEditor [data-row][data-id="${todo.id}"]`);
  await expect(row.getByTestId('state-category-locked')).toBeDisabled();
  await expect(row).toContainText('Cột còn 1 việc — chuyển việc sang cột khác rồi mới đổi nhóm');
  await expect(lead.locator(`#statesEditor [data-row][data-id="${backlog.id}"] [name=category]`)).toBeEnabled();
  // Việc đã vào Thùng rác vẫn tính (Bảng trông trống) — thông báo nói rõ.
  await json(await apiAs(lead, `/api/items/${it.id}`, { method: 'DELETE' }), 200);
  const trashed = await json(await put({ [todo.id]: { name: 'Chưa làm', wipLimit: 3, category: 'COMPLETED' }, [backlog.id]: { category: 'OTHER' } }), 409);
  expect(trashed.error).toBe('Cột "Chưa làm" còn 1 việc — chuyển việc sang cột khác rồi mới đổi nhóm. Trong đó 1 việc đang ở Thùng rác nên Bảng không hiện: khôi phục rồi chuyển đi, hoặc chờ hệ thống xoá hẳn sau 7 ngày');
});

test('#13 / #35: tài khoản Quản trị hệ thống không làm Người đứng tên, thành viên (422); không có trong các ô chọn người', async ({ browser }) => {
  const lead = await as(browser, 'tp.kinhdoanh'), admin = await as(browser, 'admin');
  const it = U('admin'), staff = U('nv.kinhdoanh1');
  expect(it, 'quản trị gốc có trong danh bạ').toBeTruthy();
  const LEAD = { code: 'INVALID_LEAD', error: 'Người đứng tên dự án phải là tài khoản nghiệp vụ đang hoạt động' };
  expect(await json(await apiAs(lead, '/api/projects', { method: 'POST', data: { key: 'CF' + TAG, name: 'Đứng tên sai (giả)', departmentId: kd.id, leadId: it.id } }), 422)).toMatchObject(LEAD);
  const project = await newProject(lead, 'CF');
  // Người đứng tên: Quản trị hệ thống, tài khoản đã khoá (tài khoản giả tạo riêng), tài khoản không tồn tại → 422; tài khoản nghiệp vụ → được.
  const gone = await json(await apiAs(admin, '/api/admin/users', { method: 'POST', data: { username: `da.khoa.${TAG.toLowerCase()}`, fullName: `Đã nghỉ ${TAG} (giả)`, role: 'member' } }), 201);
  await json(await apiAs(admin, `/api/admin/users/${gone.id}`, { method: 'PUT', data: { isActive: false } }), 200);
  for (const leadId of [it.id, gone.id, 99_999_999]) expect(await json(await apiAs(lead, `/api/projects/${project.id}`, { method: 'PUT', data: { leadId } }), 422), `leadId ${leadId}`).toMatchObject(LEAD);
  expect((await json(await apiAs(lead, `/api/projects/${project.id}`, { method: 'PUT', data: { leadId: staff.id } }), 200)).leadId).toBe(staff.id);
  // Thành viên: Quản trị hệ thống bị từ chối (kể cả vai Chủ dự án).
  const owner = { userId: U('tp.kinhdoanh').id, role: 'OWNER' };
  expect(await json(await apiAs(lead, `/api/projects/${project.id}/members`, { method: 'PUT', data: { members: [owner, { userId: it.id, role: 'OWNER' }] } }), 422))
    .toMatchObject({ code: 'IT_MEMBER', error: 'Tài khoản Quản trị hệ thống không làm thành viên dự án được' });
  await json(await apiAs(lead, `/api/projects/${project.id}/members`, { method: 'PUT', data: { members: [owner, { userId: staff.id, role: 'MEMBER' }] } }), 200);

  // Giao diện: ô Người đứng tên, ô thêm thành viên, ô Người nhận của việc lặp lại không có tài khoản Quản trị.
  await go(lead, `#/projects/${project.id}/settings`);
  await expect(lead.getByTestId('settings-lead').locator(`option[value="${staff.id}"]`)).toHaveCount(1);
  await expect(lead.getByTestId('settings-lead').locator(`option[value="${it.id}"]`)).toHaveCount(0);
  await expect(lead.getByTestId('new-member').locator(`option[value="${it.id}"]`)).toHaveCount(0);
  await expect(lead.getByTestId(`multi-recAssignees-${staff.id}`)).toHaveCount(1);
  await expect(lead.getByTestId(`multi-recAssignees-${it.id}`)).toHaveCount(0);
  await expect(lead.getByTestId('settings-lead-invalid')).toHaveCount(0);

  // Dữ liệu cũ (lỡ đặt trước bản này — máy chủ nay chặn, nên giả lập bằng cách sửa phản hồi chi tiết dự án): màn Cài đặt báo Người đứng tên
  // không hợp lệ; dòng thành viên Quản trị có ghi chú và không được gửi lên khi Lưu thành viên.
  const detail = url => url.pathname === `/api/projects/${project.id}` && url.searchParams.get('usage') === '1';
  await lead.route(detail, async route => {
    const res = await route.fetch();
    const body = await res.json();
    body.leadId = it.id;
    body.members = [...body.members, { id: -1, projectId: project.id, userId: it.id, role: 'OWNER', user: { id: it.id, fullName: it.fullName, username: it.username } }];
    await route.fulfill({ response: res, json: body });
  });
  try {
    await go(lead, `#/projects/${project.id}`);
    await go(lead, `#/projects/${project.id}/settings`);
    await expect(lead.getByTestId('settings-lead-invalid')).toContainText('là tài khoản Quản trị hệ thống');
    await expect(lead.getByTestId('member-it-note')).toBeVisible();
    const sent = lead.waitForRequest(r => r.method() === 'PUT' && r.url().endsWith(`/api/projects/${project.id}/members`));
    await lead.getByTestId('save-members').click();
    expect((await sent).postDataJSON().members.map(m => m.userId).sort((x, y) => x - y)).toEqual([owner.userId, staff.id].sort((x, y) => x - y));
    await toast(lead, 'Đã lưu thành viên');
  } finally { await lead.unrouteAll({ behavior: 'wait' }); } // chờ lượt tải lại trang Cài đặt (sau khi lưu) đang đi qua route xong rồi mới gỡ
});
