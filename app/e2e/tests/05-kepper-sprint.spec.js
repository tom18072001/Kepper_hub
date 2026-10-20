// Kepper GĐ2a — sprint theo tháng T (dữ liệu GIẢ của dự án mẫu DA, T0 = 10 tháng trước → sprint hiện tại luôn là T10):
// màn hình Sprint (mặc định của dự án MTL, làn phải xong / đang chạy / chuẩn bị, lọc ban, chuyển sprint), Gantt theo sprint,
// "Cập nhật nhanh" một chạm + ghi chú, mẫu MTL bộ phận điền sẵn do lãnh đạo ban tự tải / nhập lại (giữ tiến độ, không đặt lại kế hoạch gốc).
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const ExcelJS = require(path.join(__dirname, '../../server/node_modules/exceljs'));
const { login, apiAs, toast } = require('./helpers');

test.describe.configure({ mode: 'serial' });

test('19. Sprint theo tháng T: màn hình Sprint, Gantt theo sprint, cập nhật nhanh, MTL bộ phận do lãnh đạo ban tự nhập', async ({ browser }) => {
  test.setTimeout(180_000);
  const pmo = await (await browser.newContext()).newPage();
  await login(pmo, 'pmo');
  const project = (await (await apiAs(pmo, '/api/projects')).json()).find(p => p.key === 'DA');
  const PL = (await (await apiAs(pmo, '/api/departments')).json()).find(d => d.code === 'PL');

  // 1) Mở dự án MTL → mặc định là màn hình Sprint của sprint hiện tại.
  await pmo.goto(`/#/projects/${project.id}`);
  await expect(pmo.getByTestId('sprint-view')).toBeVisible();
  await expect(pmo.getByTestId('sp-title')).toHaveText('Sprint T10');
  const api = await (await apiAs(pmo, `/api/projects/${project.id}/mtl-sprint`)).json();
  expect(api.sprint.state).toBe('CURRENT');
  // Bước 5 kết thúc T7, chưa xong → nằm ở "Phải xong" của sprint hiện tại, ghi "chuyển từ T7".
  await expect(pmo.getByTestId('sp-lane-due').getByTestId('sc-DA-5')).toContainText('chuyển từ T7');
  // Sprint T2 đã qua: bước 1, 2 (T0–T2) phải xong và đã xong đúng hạn.
  const t2 = await (await apiAs(pmo, `/api/projects/${project.id}/mtl-sprint?t=2`)).json();
  expect(t2.sprint.state).toBe('PAST'); expect(t2.sprint.due).toBe(2); expect(t2.sprint.done).toBe(2);
  expect(api.sprints[2]).toMatchObject({ due: 2, doneInTime: 2, open: 0 });

  // 2) Lọc ban Pháp lý: chỉ còn thẻ của Ban Pháp lý; nhớ lựa chọn.
  await pmo.getByTestId(`sp-dept-${PL.id}`).click();
  const plDue = api.lanes.due.filter(i => i.leadDepartmentId === PL.id).length;
  await expect(pmo.getByTestId('sp-lane-due').locator('.sc')).toHaveCount(plDue);
  await pmo.getByTestId('sp-depts').getByText('Tất cả ban').click();
  await expect(pmo.getByTestId('sp-lane-due').locator('.sc')).toHaveCount(api.lanes.due.length);

  // 3) Chuyển sprint: trước / về hiện tại / bấm ô trên dải sprint.
  await pmo.getByTestId('sp-prev').click();
  await expect(pmo.getByTestId('sp-title')).toHaveText('Sprint T9');
  await pmo.getByTestId('sp-now').click();
  await expect(pmo.getByTestId('sp-title')).toHaveText('Sprint T10');
  await pmo.getByTestId('sp-cell-12').click();
  await expect(pmo.getByTestId('sp-title')).toHaveText('Sprint T12');

  // 4) Gantt theo sprint: mặc định 12 sprint quanh hiện tại (T8–T19), đầu cột mở màn hình Sprint; "Toàn bộ dự án" bỏ khung.
  await pmo.goto(`/#/projects/${project.id}?view=plan`);
  await expect(pmo.getByTestId('gz-range')).toHaveText('T8–T19');
  await pmo.getByTestId('gz-fwd').click();
  await expect(pmo.getByTestId('gz-range')).toHaveText('T14–T25');
  await pmo.getByTestId('gz-all').click();
  await expect(pmo.getByTestId('gz-range')).toHaveCount(0);
  await pmo.getByTestId('gz-near').click();
  await pmo.getByTestId('g-head-10').click();
  await expect(pmo.getByTestId('sp-title')).toHaveText('Sprint T10');

  // 5) Cập nhật nhanh (nhân viên): chỉ việc của mình trong sprint; bấm 50% → lưu; ghi chú → bình luận của hạng mục.
  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.phaply');
  await staff.getByTestId('nav-sprint').click();
  await expect(staff.getByTestId('quick-page')).toBeVisible();
  const mine = await (await apiAs(staff, '/api/my/sprint')).json();
  const first = mine.projects.find(g => g.project.key === 'DA').items.find(i => !i.done);
  expect(first.assignees.some(a => a.fullName)).toBe(true);
  await staff.getByTestId(`qk-${first.code}-50`).click();
  await toast(staff, `${first.code}: đã cập nhật 50%`);
  expect((await (await apiAs(staff, `/api/items/${first.id}`)).json()).progress).toBe(50);
  const box = staff.getByTestId(`sc-${first.code}`);
  await box.getByText('Ghi chú').click();
  await box.locator('textarea').fill('Đang chờ ý kiến sở (giả)');
  await box.getByRole('button', { name: 'Gửi' }).click();
  await toast(staff, `${first.code}: đã gửi ghi chú`);
  expect((await (await apiAs(staff, `/api/items/${first.id}`)).json()).comments.some(c => c.bodyText.includes('Đang chờ ý kiến sở'))).toBe(true);
  // Nhân viên không tải / nhập được MTL bộ phận.
  expect((await apiAs(staff, `/api/projects/${project.id}/mtl-template.xlsx?departmentId=${PL.id}`)).status()).toBe(403);

  // 6) Lãnh đạo Ban Pháp lý: tải MTL bộ phận điền sẵn (hạng mục đang có + gợi ý cho bước chủ trì chưa chi tiết hoá), nhập lại.
  const lead = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await login(lead, 'tb.phaply');
  await lead.goto(`/#/projects/${project.id}`);
  await lead.getByTestId('ph-more').click();
  const [dl] = await Promise.all([lead.waitForEvent('download'), lead.getByTestId('mtl-template').click()]);
  expect(dl.suggestedFilename()).toBe('MTL-bo-phan-PL-DA.xlsx');
  const file = path.join(os.tmpdir(), `kepper-e2e-tpl-${process.pid}.xlsx`);
  await dl.saveAs(file);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  expect(wb.worksheets.map(w => w.name)).toEqual(['MTL bộ phận', 'Danh sách', 'MTL tổng (tham khảo)', 'Hướng dẫn']);
  const steps = []; wb.worksheets[0].eachRow((r, n) => { if (n > 2) steps.push(String(r.getCell(1).value)); });
  expect(steps).toEqual(expect.arrayContaining(['8.1', '8.2', '8.3', '8.4', 'II.1.1']));
  const before = (await (await apiAs(lead, `/api/projects/${project.id}/mtl`)).json()).items.find(i => i.planCode === 'II.1');
  expect(before.children).toBe(0);
  // Nhập lại qua giao diện: loại khoá ở "MTL bộ phận", bộ phận của mình, không có ô đặt lại kế hoạch gốc.
  await lead.getByTestId('ph-more').click(); await lead.getByTestId('mtl-import').click();
  await expect(lead.getByTestId('mtl-import-dept')).toHaveValue(String(PL.id));
  await expect(lead.locator('input[name=rebaseline]')).toHaveCount(0);
  await lead.getByTestId('mtl-import-file').setInputFiles(file);
  await lead.getByTestId('mtl-import-preview').click();
  const sum = lead.getByTestId('mtl-import-summary');
  await expect(sum).toContainText('cập nhật 4');
  await expect(sum).toContainText('tạo mới 1');
  await expect(sum).toContainText(`nhận ${before.actual}% của bước II.1`);
  await lead.getByTestId('mtl-import-go').click();
  await toast(lead, 'Đã nhập MTL: tạo 1, cập nhật 4');
  // Chi tiết hoá lần đầu bước đang làm dở: dòng con nhận % của bước tổng → tiến độ bước tổng không tụt; tiến độ 8.x giữ nguyên.
  const after = (await (await apiAs(lead, `/api/projects/${project.id}/mtl`)).json()).items;
  expect(after.find(i => i.planCode === 'II.1')).toMatchObject({ children: 1, actual: before.actual });
  expect(after.find(i => i.id === first.id).actual).toBe(50);
  // Lãnh đạo ban không đặt lại kế hoạch gốc, không nhập MTL tổng / bộ phận khác.
  const buffer = fs.readFileSync(file);
  const send = form => apiAs(lead, `/api/projects/${project.id}/mtl-import`, { method: 'POST', multipart: { file: { name: 'mtl.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer }, dryRun: '1', ...form } });
  expect((await send({ kind: 'DEPARTMENT', departmentId: String(PL.id), rebaseline: '1' })).status()).toBe(403);
  expect((await send({ kind: 'MASTER' })).status()).toBe(403);
  const TK = (await (await apiAs(lead, '/api/departments')).json()).find(d => d.code === 'TK');
  expect((await send({ kind: 'DEPARTMENT', departmentId: String(TK.id) })).status()).toBe(403);
  // Mỗi lần tải mẫu được ghi nhật ký.
  const admin = await (await browser.newContext()).newPage();
  await login(admin, 'admin');
  const audit = await (await apiAs(admin, '/api/admin/audit?action=MTL_TEMPLATE_EXPORT')).json();
  expect(JSON.stringify(audit)).toContain('MTL_TEMPLATE_EXPORT');
  fs.rmSync(file, { force: true });
});
