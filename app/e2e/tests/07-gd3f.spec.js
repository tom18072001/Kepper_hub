// GĐ3f — Lịch công tác: nhập lịch tuần từ Excel đúng mẫu văn bản (dữ liệu GIẢ), báo vắng → "Vắng mặt hôm nay",
// phân quyền sửa lịch (Trung tâm: BGĐ / Văn phòng; phòng: lãnh đạo phòng), mục "Gửi yêu cầu" đã bỏ khỏi giao diện.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const ExcelJS = require(path.join(__dirname, '../../server/node_modules/exceljs'));
const { login, apiAs, toast } = require('./helpers');

const vnToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const viDay = k => { const [y, m, d] = k.split('-'); return `${d}/${m}/${y}`; };
const WD = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

test('16. Lịch công tác: nhập lịch tuần từ Excel, báo vắng hiện ở "Vắng mặt hôm nay", phân quyền sửa lịch; bỏ "Gửi yêu cầu"', async ({ browser }) => {
  const director = await (await browser.newContext()).newPage();
  await login(director, 'giamdoc');
  const users = await (await apiAs(director, '/api/users/directory')).json();
  const D = Object.fromEntries((await (await apiAs(director, '/api/departments')).json()).map(d => [d.code, d]));
  const name = u => users.find(x => x.username === u).fullName;
  const today = vnToday(), wd = WD[new Date(today + 'T00:00:00Z').getUTCDay()];

  // Tệp lịch tuần theo mẫu văn bản (tên giả trong CSDL test).
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tuần (giả)');
  ws.addRow(['TRUNG TÂM (giả)']); ws.addRow(['LỊCH CÔNG TÁC TUẦN']); ws.addRow([]);
  ws.addRow(['Thời gian', 'Nội dung', 'Thành phần', 'Bí thư Chủ trì', 'Địa điểm', 'Ghi chú']);
  ws.addRow([`${wd}, ngày ${viDay(today)}`]);
  ws.addRow(['08h30', 'Họp giao ban tuần E2E', `- Đ/c ${name('giamdoc')}\n- Đ/c ${name('tp.kinhdoanh')}`, '', 'Phòng họp 302', '']);
  ws.addRow(['14h00', 'Khảo sát địa điểm E2E', `- Đ/c ${name('tp.kythuat')}\n- Đ/c Người Ngoài Hệ Thống`, '', 'TP. Hồ Chí Minh', 'Mang hồ sơ']);
  const file = path.join(require('node:os').tmpdir(), `workhub-e2e-lich-${process.pid}.xlsx`);
  await wb.xlsx.writeFile(file);

  // 1) Ban Giám đốc nhập lịch Trung tâm: xem trước (tên chưa khớp, mục ngoài cơ quan) rồi nhập.
  await director.goto('/#/schedule');
  await expect(director.getByTestId('nav-requests')).toHaveCount(0);
  await director.getByTestId('ph-more').click(); await director.getByTestId('sch-import').click();
  await director.getByTestId('sch-import-file').setInputFiles(file);
  await director.getByTestId('sch-import-preview').click();
  await expect(director.locator('#impErr')).toHaveText('');
  const summary = director.getByTestId('sch-import-summary');
  await expect(summary).toContainText('2 mục lịch');
  await expect(summary).toContainText('Người Ngoài Hệ Thống');
  await director.getByTestId('sch-import-go').click();
  await toast(director, 'Đã nhập 2 mục lịch');
  await expect(director.getByTestId('sch-table')).toContainText('Họp giao ban tuần E2E');
  // Khảo sát ở nơi khác → người tham gia hiện ở "Vắng mặt hôm nay".
  await expect(director.getByTestId('sch-away')).toContainText(name('tp.kythuat'));

  // 2) Nhân viên tự báo vắng; không sửa được lịch Trung tâm.
  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.kinhdoanh1');
  await staff.goto('/#/schedule');
  await expect(staff.getByTestId('sch-add')).toHaveCount(0);
  await staff.getByTestId('sch-report-away').click();
  await staff.getByTestId('away-reason').selectOption('Đi công tác');
  await staff.getByTestId('away-location').fill('Đà Nẵng (E2E)');
  await staff.getByTestId('away-save').click();
  await toast(staff, 'Đã báo vắng');
  await expect(staff.getByTestId('sch-away')).toContainText(name('nv.kinhdoanh1'));
  expect((await apiAs(staff, '/api/schedule', { method: 'POST', data: { date: today, title: 'Thử chen lịch Trung tâm' } })).status()).toBe(403);
  const others = users.find(u => u.username === 'nv.kythuat').id;
  expect((await apiAs(staff, '/api/schedule', { method: 'POST', data: { kind: 'AWAY', date: today, title: 'Nghỉ phép', participantIds: [others] } })).status()).toBe(403);

  // 3) Trưởng phòng sửa lịch phòng mình, không sửa lịch phòng khác; "Gửi yêu cầu" chuyển về Lịch công tác.
  const lead = await (await browser.newContext()).newPage();
  await login(lead, 'tp.kinhdoanh');
  expect((await apiAs(lead, '/api/schedule', { method: 'POST', data: { date: today, title: 'Họp phòng KD', departmentId: D.KD.id } })).status()).toBe(201);
  expect((await apiAs(lead, '/api/schedule', { method: 'POST', data: { date: today, title: 'Họp phòng KT', departmentId: D.KT.id } })).status()).toBe(403);
  await lead.goto('/#/requests');
  await expect(lead).toHaveURL(/#\/schedule/);
  await expect(lead.getByTestId('sch-table')).toContainText('Họp phòng KD');
});
