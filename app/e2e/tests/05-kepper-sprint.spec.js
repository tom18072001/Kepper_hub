// Kepper GĐ2a — sprint = giai đoạn gồm nhóm bước MTL (dữ liệu GIẢ của dự án mẫu DA, T0 = 10 tháng trước → tháng hiện tại luôn là T10):
// tab Sprint (lộ trình, thiết lập sprint, tiến độ theo đầu việc con, checklist), Kế hoạch & Gantt gom theo sprint, Theo tháng,
// "Cập nhật nhanh" một chạm + ghi chú, mẫu MTL bộ phận điền sẵn do lãnh đạo ban tự tải / nhập lại (giữ tiến độ, không đặt lại kế hoạch gốc).
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const ExcelJS = require(path.join(__dirname, '../../server/node_modules/exceljs'));
const { login, apiAs, toast } = require('./helpers');

test.describe.configure({ mode: 'serial' });

test('19. Sprint theo giai đoạn: lộ trình, thiết lập sprint, tiến độ theo đầu việc, Gantt gom sprint, theo tháng, cập nhật nhanh, MTL bộ phận', async ({ browser }) => {
  test.setTimeout(180_000);
  const pmo = await (await browser.newContext()).newPage();
  await login(pmo, 'pmo');
  const project = (await (await apiAs(pmo, '/api/projects')).json()).find(p => p.key === 'DA');
  const PL = (await (await apiAs(pmo, '/api/departments')).json()).find(d => d.code === 'PL');

  // 1) Mở dự án MTL → mặc định tab Sprint theo giai đoạn: lộ trình 5 sprint của dự án mẫu, chọn sẵn sprint đang làm.
  await pmo.goto(`/#/projects/${project.id}`);
  await expect(pmo.getByTestId('sprint-view')).toBeVisible();
  await expect(pmo.getByTestId('sp-title')).toHaveText('Sprint 1 · Chuyển nhượng dự án (mẫu)');
  await expect(pmo.getByTestId('sp-road').locator('.rd-row:not(.rd-head)')).toHaveCount(5);
  const api = await (await apiAs(pmo, `/api/projects/${project.id}/mtl-sprints`)).json();
  expect(api.configured).toBe(true); expect(api.current).toBe(0);
  expect(api.sprints.map(x => x.stepsLabel)).toEqual(['B1–7', 'B8–9', 'B10–14', 'B15–16', 'II.1–II.2']);

  // 2) Thiết lập sprint (PMO): lỗi bước không có → báo ngay; thiếu Phân kỳ 2 → còn bước chưa xếp; khôi phục.
  await pmo.getByTestId('sp-setup').click();
  await pmo.getByTestId('sp-setup-text').fill('Chuyển nhượng DA (B1–7)\nSai bước | 8-99');
  await pmo.getByTestId('sp-setup-save').click();
  await expect(pmo.locator('#spErr')).toContainText('không có bước 99');
  await pmo.getByTestId('sp-setup-text').fill('Chuyển nhượng DA (B1–7)\nĐề xuất → CTĐT | 8-9 | Có QĐ chấp thuận (giả)\nThiết kế → GPXD | 10-14\nThi công → mở bán | 15-16');
  await pmo.getByTestId('sp-setup-save').click();
  await toast(pmo, 'Đã lưu 4 sprint — còn 2 bước chưa xếp');
  await expect(pmo.getByTestId('sprint-view')).toContainText('Bước chưa thuộc sprint nào: II.1, II.2');
  await pmo.getByTestId('sp-setup').click();
  await pmo.getByTestId('sp-setup-text').fill(api.text);
  await pmo.getByTestId('sp-setup-save').click();
  await toast(pmo, 'Đã lưu 5 sprint');

  // 3) Sprint 2: bước 8 có 4 việc con (MTL Ban Pháp lý) → tiến độ bước = số việc con xong / 4; bấm "✓ Xong" một việc con → +25%.
  await pmo.getByTestId('sp-road-1').click();
  await expect(pmo.getByTestId('sp-title')).toHaveText('Sprint 2 · Đề xuất dự án → chấp thuận chủ trương (mẫu)');
  await expect(pmo.getByTestId('sp-kids-8')).toContainText('1/4 việc con đã xong');
  const step8 = async () => (await (await apiAs(pmo, `/api/projects/${project.id}/mtl`)).json()).items.find(i => i.planCode === '8');
  const b8 = await step8();
  await pmo.getByTestId('qk-DA-21-100').click();
  await toast(pmo, 'DA-21: đã xong');
  await expect(pmo.getByTestId('sp-kids-8')).toContainText('2/4 việc con đã xong');
  expect((await step8()).actual).toBe(b8.actual + 25);
  // Checklist: việc lá có checklist → % = số mục đã xong / tổng (không phải tự khai); đủ mục → Hoàn thành.
  const id22 = (await (await apiAs(pmo, `/api/projects/${project.id}/mtl`)).json()).items.find(i => i.code === 'DA-22').id;
  const c1 = await (await apiAs(pmo, `/api/items/${id22}/checklist`, { method: 'POST', data: { title: 'Soạn tờ trình (giả)' } })).json();
  const c2 = await (await apiAs(pmo, `/api/items/${id22}/checklist`, { method: 'POST', data: { title: 'Trình ký (giả)' } })).json();
  await apiAs(pmo, `/api/checklist/${c1.id}`, { method: 'PATCH', data: { done: true } });
  expect((await (await apiAs(pmo, `/api/items/${id22}`)).json()).progress).toBe(50);
  await apiAs(pmo, `/api/checklist/${c2.id}`, { method: 'PATCH', data: { done: true } });
  const i22 = await (await apiAs(pmo, `/api/items/${id22}`)).json();
  expect(i22.progress).toBe(100); expect(i22.state.category).toBe('COMPLETED');
  expect((await step8()).actual).toBe(b8.actual + 50); // 8.3 xong (+25) và 8.4 xong qua checklist (+25)

  // 4) Kế hoạch & Gantt: hàng gom theo sprint, thu gọn / mở; lọc theo sprint; khung 12 tháng; đầu cột mở "Theo tháng".
  await pmo.goto(`/#/projects/${project.id}?view=plan`);
  await expect(pmo.getByTestId('mtl-sprint-0')).toContainText('Sprint 1 · Chuyển nhượng dự án (mẫu)');
  await expect(pmo.getByTestId('mtl-row-3')).toBeVisible();
  await pmo.getByTestId('mtl-sprint-0').click();
  await expect(pmo.getByTestId('mtl-row-3')).toHaveCount(0);
  await pmo.getByTestId('mtl-sprint-0').click();
  await expect(pmo.getByTestId('mtl-row-3')).toBeVisible();
  await pmo.getByTestId('mtl-f-sprint').selectOption('4');
  await expect(pmo.getByTestId('mtl-row-II.1')).toBeVisible();
  await expect(pmo.getByTestId('mtl-row-3')).toHaveCount(0);
  await pmo.getByTestId('mtl-f-sprint').selectOption('');
  await expect(pmo.getByTestId('gz-range')).toHaveText('T8–T19');
  await pmo.getByTestId('gz-fwd').click();
  await expect(pmo.getByTestId('gz-range')).toHaveText('T14–T25');
  await pmo.getByTestId('gz-all').click();
  await expect(pmo.getByTestId('gz-range')).toHaveCount(0);
  await pmo.getByTestId('gz-near').click();
  await pmo.getByTestId('g-head-10').click();
  await expect(pmo.getByTestId('mo-title')).toHaveText('Tháng T10');
  // Theo tháng: bước 5 kết thúc T7, chưa xong → "Phải xong" của tháng hiện tại, ghi "trễ từ T7"; thẻ ghi tên sprint.
  const sc5 = pmo.getByTestId('sp-lane-due').getByTestId('sc-DA-5');
  await expect(sc5).toContainText('trễ từ T7'); await expect(sc5).toContainText('Chuyển nhượng dự án (mẫu)');
  await pmo.getByTestId('mo-prev').click();
  await expect(pmo.getByTestId('mo-title')).toHaveText('Tháng T9');
  await pmo.getByTestId('mo-now').click();
  await expect(pmo.getByTestId('mo-title')).toHaveText('Tháng T10');
  const t2 = await (await apiAs(pmo, `/api/projects/${project.id}/mtl-month?t=2`)).json();
  expect(t2.sprint.state).toBe('PAST'); expect(t2.sprint.due).toBe(2); expect(t2.sprint.done).toBe(2);
  // Tổng quan có bảng theo sprint.
  await pmo.goto(`/#/projects/${project.id}?view=mtl`);
  await expect(pmo.getByTestId('mtl-sprints')).toContainText('Phân kỳ 2 (mẫu)');

  // 5) Cập nhật nhanh (nhân viên): chỉ việc của mình trong sprint; bấm 50% → lưu; ghi chú → bình luận của hạng mục.
  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.phaply');
  await staff.getByTestId('nav-sprint').click();
  await expect(staff.getByTestId('quick-page')).toBeVisible();
  const mine = await (await apiAs(staff, '/api/my/sprint')).json();
  const first = mine.projects.find(g => g.project.key === 'DA').items.find(i => !i.done);
  expect(first.assignees.some(a => a.fullName)).toBe(true);
  await expect(staff.getByTestId(`sc-${first.code}`)).toContainText(first.sprintName);
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
