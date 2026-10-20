// GĐ2c — Sổ giao việc theo mẫu "Sổ theo dõi, kiểm soát giao việc nội bộ": nhập Kế hoạch năm (.docx), nhập/xuất sổ Excel,
// trạng thái hạn tự tính, tiến độ %, tổng hợp theo cán bộ chủ trì (giám đốc toàn đơn vị, trưởng phòng chỉ phòng mình).
// Tệp nhập được sinh ngay trong test, tên cán bộ là tên GIẢ của dữ liệu mẫu.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { login, apiAs, openProject, toast } = require('./helpers');

const SERVER = path.join(__dirname, '..', '..', 'server');
const { buildPlanDocx } = require(path.join(SERVER, 'src', 'services', '__fixtures__', 'plan-docx.js'));
const ExcelJS = require(path.join(SERVER, 'node_modules', 'exceljs'));

test.describe.configure({ mode: 'serial' });

const day = offset => { const d = new Date(Date.now() + 7 * 3600_000 + offset * 86_400_000); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
async function registerXlsx() {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Theo dõi giao việc');
  ws.addRow(['SỔ THEO DÕI, KIỂM SOÁT GIAO VIỆC NỘI BỘ (MẪU KIỂM THỬ)']);
  ws.addRow(['STT', 'Mã CV', 'Nội dung công việc', 'Nguồn giao việc', 'Người giao', 'Người chủ trì', 'Người phối hợp', 'Ngày giao', 'Hạn hoàn thành',
    'Mức độ ưu tiên', 'Tiến độ (%)', 'Ngày hoàn thành thực tế', 'Trạng thái', 'Số ngày còn lại', 'Sản phẩm đầu ra', 'Đã báo Zalo']);
  ws.addRow([1, 'CV-01', 'Hội nghị khách hàng mẫu (nhóm việc)', 'Họp giao ban', 'Trần Minh Giám', 'Lê Thu Hà', 'Văn phòng', day(-20), day(10), 'Cao', 0.2, null, 'x', 'x', 'Kế hoạch tổ chức', 'Zalo-ID-giả']);
  ws.addRow([2, 'CV-01.1', '↳ Gửi giấy mời khách hàng', 'Họp giao ban', 'Trần Minh Giám', 'Phạm Văn An', 'Đỗ Thị Bình', day(-20), day(-5), 'Khẩn', 1, day(-3), '', '', 'Danh sách khách mời', '']);
  ws.addRow([3, 'CV-01.2', '↳ Đặt hội trường', 'Họp giao ban', 'Trần Minh Giám', 'Người Ngoài Danh Bạ', '', day(-20), day(-2), 'Bình thường', 0.5, null, '', '', 'Hợp đồng thuê hội trường', '']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const regRow = (page, title) => page.locator('table.reg tbody tr', { hasText: title });

test('13. Sổ giao việc: nhập Kế hoạch năm (Word) và sổ Excel, trạng thái hạn tự tính, tiến độ %, xuất sổ; tổng hợp đúng phạm vi', async ({ browser }) => {
  const manager = await (await browser.newContext()).newPage();
  await login(manager, 'tp.kinhdoanh');
  await openProject(manager, 'KD');
  await manager.getByTestId('view-register').click();
  await expect(manager.getByTestId('register')).toBeVisible();

  // a) Kế hoạch năm (.docx): xem trước → cảnh báo cán bộ chưa có tài khoản → tạo việc + mốc thành việc nhánh.
  await manager.getByTestId('ph-more').click(); await manager.getByTestId('import-excel').click();
  await manager.getByTestId('import-plan').click();
  await manager.getByTestId('plan-file').setInputFiles({ name: 'ke-hoach-mau.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await buildPlanDocx({ year: 2027 }) });
  await manager.getByTestId('plan-preview').click();
  const summary = manager.getByTestId('plan-summary');
  await expect(summary).toContainText('2 nhiệm vụ, 6 mốc (việc nhánh), 2 nhóm nhiệm vụ');
  await expect(summary).toContainText('Người Chưa Có Tài Khoản');
  await manager.getByTestId('plan-import').click();
  await toast(manager, 'Đã tạo 8 việc từ kế hoạch');
  await expect(manager.locator('tr.reg-section', { hasText: '1. Tổ chức các hội thi' })).toBeVisible();
  const planRow = regRow(manager, 'Hội thi Sáng tạo mẫu');
  await expect(planRow).toContainText('(2 việc nhánh)');
  await expect(planRow).toContainText('Lê Thu Hà');
  await expect(planRow).toContainText('31/08/2027');
  await expect(regRow(manager, 'Ban hành thể lệ')).toContainText('31/03/2027');

  // b) Tiến độ % sửa ngay trên sổ; nhóm việc hiện trung bình các việc nhánh.
  const ms = regRow(manager, 'Ban hành thể lệ').locator('[data-progress]');
  await ms.fill('60'); await ms.dispatchEvent('change');
  await toast(manager, 'Đã cập nhật tiến độ');
  await expect(regRow(manager, 'Hội thi Sáng tạo mẫu').locator('.reg-progress')).toContainText('30%');

  // c) Sổ Excel đúng mẫu: dòng ↳ là việc nhánh, khớp tên cán bộ, cột Zalo/Trạng thái bỏ qua, có ngày HT → đã hoàn thành.
  await manager.getByTestId('ph-more').click(); await manager.getByTestId('import-excel').click();
  await manager.getByTestId('import-register').click();
  await manager.getByTestId('register-file').setInputFiles({ name: 'so-giao-viec.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await registerXlsx() });
  await manager.getByTestId('register-preview').click();
  await expect(manager.getByTestId('register-summary')).toContainText('3 dòng: 1 việc / nhóm việc, 2 việc nhánh, 1 đã hoàn thành');
  await expect(manager.getByTestId('register-summary')).toContainText('Người Ngoài Danh Bạ');
  await manager.getByTestId('register-import').click();
  await toast(manager, 'Đã nhập 3 dòng vào sổ');
  await expect(regRow(manager, 'Hội nghị khách hàng mẫu')).toContainText('(2 việc nhánh)');
  await expect(regRow(manager, 'Gửi giấy mời khách hàng')).toContainText('Hoàn thành trễ hạn');
  await expect(regRow(manager, 'Gửi giấy mời khách hàng')).toContainText('Đỗ Thị Bình');
  await expect(regRow(manager, 'Đặt hội trường')).toContainText('Quá hạn');
  await expect(regRow(manager, 'Đặt hội trường').locator('[data-progress]')).toHaveValue('50');
  await expect(regRow(manager, 'Hội nghị khách hàng mẫu')).toContainText('Đang thực hiện');

  // Lọc theo trạng thái hạn.
  await manager.getByTestId('reg-filter-DONE_LATE').click();
  await expect(regRow(manager, 'Gửi giấy mời khách hàng')).toBeVisible();
  await expect(regRow(manager, 'Ban hành thể lệ')).toHaveCount(0);
  await manager.getByTestId('reg-filter-ALL').click();

  // d) Xuất sổ Excel đúng mẫu (2 trang tính) — đọc lại được.
  const project = (await (await apiAs(manager, '/api/projects')).json()).find(p => p.key === 'KD');
  const xr = await apiAs(manager, `/api/projects/${project.id}/register.xlsx`);
  expect(xr.status()).toBe(200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await xr.body());
  expect(wb.worksheets.map(w => w.name)).toEqual(['Theo dõi giao việc', 'Tổng hợp']);

  // e) Tổng hợp: trưởng phòng chỉ thấy phòng mình (không vượt phạm vi bằng tham số); giám đốc thấy toàn đơn vị; nhân viên bị chặn.
  await manager.getByTestId('nav-summary').click();
  await expect(manager.locator('table', { hasText: 'TỔNG CỘNG' })).toBeVisible();
  const mine = await (await apiAs(manager, '/api/summary?departmentId=999')).json();
  expect(mine.scope).toBe('UNIT');
  expect(mine.rows.length).toBeGreaterThan(0);
  expect(new Set(mine.rows.map(r => r.department))).toEqual(new Set(['Phòng Kinh doanh']));
  const an = mine.rows.find(r => r.fullName === 'Phạm Văn An');
  expect(an.doneLate).toBeGreaterThanOrEqual(1);

  const director = await (await browser.newContext()).newPage();
  await login(director, 'giamdoc');
  const all = await (await apiAs(director, '/api/summary')).json();
  expect(all.scope).toBe('SYSTEM');
  expect(new Set(all.rows.map(r => r.department)).size).toBeGreaterThan(1);

  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.kinhdoanh1');
  await expect(staff.getByTestId('nav-summary')).toBeHidden();
  expect((await apiAs(staff, '/api/summary')).status()).toBe(403);
  // Nhân viên được giao phối hợp thấy việc trong "Việc của tôi".
  const binh = await (await browser.newContext()).newPage();
  await login(binh, 'nv.kinhdoanh2');
  const assigned = await (await apiAs(binh, '/api/my/items?open=false')).json();
  expect(assigned.find(i => i.title === 'Gửi giấy mời khách hàng')?.myRole).toBe('SUPPORT');
});
