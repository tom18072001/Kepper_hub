// Đợt A3 của review UX — số liệu và cảnh báo nhất quán (dữ liệu GIẢ):
// ô "Cảnh báo gần đây" mỗi việc một dòng và ghi "đã hết" khi cảnh báo không còn đúng; thông báo gộp theo việc, số liệu ghi "(lúc gửi)";
// không nhắc lại "Chậm khởi động" sau khi việc đã cập nhật; tooltip SPI dự án / KPI / Chậm tiến độ, đơn vị trục tháng;
// trang Thống kê dùng chữ tiếng Việt và ghi phạm vi số liệu; tab "Kỳ cập nhật tháng".
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const ExcelJS = require(path.join(__dirname, '../../server/node_modules/exceljs'));
const { test, expect, login, apiAs, toast } = require('./helpers');

const HEAD = ['Bước', 'Hạng mục công việc', 'Đầu mối', 'Bắt đầu (T)', 'Kết thúc (T)', 'Thời lượng (tháng)', 'Đường găng', 'Mốc'];
// T0 = tháng hiện tại − 3 → bước 1 (T0–T1) đã trễ hạn; bước 2 (T2–T4) đã tới ngày bắt đầu từ tháng trước mà chưa khởi động.
const t0Month = () => { const d = new Date(Date.now() + 7 * 3_600_000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 3); return d.toISOString().slice(0, 7); };

test('A3. Cảnh báo theo số liệu hiện tại, thông báo gộp, tooltip chỉ số, chữ trang Thống kê', async ({ browser }) => {
  test.setTimeout(120_000);
  const pmo = await (await browser.newContext()).newPage();
  await login(pmo, 'giamdoc');
  await pmo.getByTestId('new-project').click();
  await pmo.getByTestId('project-key').fill('CB');
  await pmo.getByTestId('project-name').fill('Dự án cảnh báo A3 (giả)');
  await pmo.getByTestId('project-t0').fill(t0Month());
  await pmo.getByTestId('project-save').click();
  await toast(pmo, 'Đã tạo dự án CB');
  const project = (await (await apiAs(pmo, '/api/projects')).json()).find(p => p.key === 'CB');

  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('MTL overall');
  ws.addRow(['MASTER TIMELINE — A3 (giả)']); ws.addRow(HEAD);
  ws.addRow([1, 'Hồ sơ trễ hạn A3 (giả)', 'Pháp lý', 0, 1, 2, '', '']);
  ws.addRow([2, 'Việc chưa khởi động A3 (giả)', 'Pháp lý', 2, 4, 3, '', '']);
  const file = path.join(os.tmpdir(), `kepper-e2e-a3-${process.pid}.xlsx`);
  await wb.xlsx.writeFile(file);
  const imp = await apiAs(pmo, `/api/projects/${project.id}/mtl-import`, { method: 'POST', multipart: { file: { name: 'mtl.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: fs.readFileSync(file) }, kind: 'MASTER', planName: 'MTL A3' } });
  expect(imp.status()).toBe(200);
  const d1 = await (await apiAs(pmo, `/api/projects/${project.id}/mtl`)).json();
  const late = d1.items.find(i => i.planCode === '2'), overdue = d1.items.find(i => i.planCode === '1');
  expect(late.status).toBe('LATE_START');
  expect(overdue.status).toBe('OVERDUE');

  // 1) Chạy cảnh báo: mỗi việc MỘT thông báo cho mỗi người nhận; số liệu ghi "(lúc gửi)".
  const run1 = await (await apiAs(pmo, `/api/projects/${project.id}/mtl-alerts/run`, { method: 'POST' })).json();
  expect(run1.alerts).toBeGreaterThan(0);
  const notes1 = (await (await apiAs(pmo, '/api/notifications')).json()).items.filter(n => n.type === 'MTL_ALERT');
  const forLate = notes1.filter(n => n.title.includes(`CB-${late.number} `));
  expect(forLate).toHaveLength(1);
  expect(forLate[0].title).toContain('Chậm khởi động');
  expect(forLate[0].body).toContain('(lúc gửi)');

  // 2) Ô "Cảnh báo gần đây": cảnh báo đang đúng hiện bình thường.
  await pmo.goto(`/#/projects/${project.id}?view=mtl`);
  const box = pmo.getByTestId('mtl-alerts');
  await expect(box.getByTestId('mtl-alert').filter({ hasText: `CB-${late.number}` })).toContainText('Chậm khởi động');
  await expect(box.getByTestId('mtl-alert').filter({ hasText: `CB-${overdue.number}` })).toHaveCount(1);

  // 3) Việc cập nhật 50% → cảnh báo "Chậm khởi động" ghi "đã hết", không còn dòng cảnh báo đang hiệu lực của việc đó.
  //    Tiến độ do người chủ trì cập nhật (quyền tối thiểu theo vai): người giao giao chủ trì cho nv.phaply, người chủ trì báo 50%.
  expect((await apiAs(pmo, `/api/items/${late.id}`, { method: 'PATCH', data: { progress: 50 } })).status()).toBe(403);
  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.phaply');
  const sid = (await (await apiAs(staff, '/api/me')).json()).id;
  expect((await apiAs(pmo, `/api/items/${late.id}`, { method: 'PATCH', data: { assigneeIds: [sid] } })).status()).toBe(200);
  expect((await apiAs(staff, `/api/items/${late.id}`, { method: 'PATCH', data: { progress: 50 } })).status()).toBe(200);
  const d2 = await (await apiAs(pmo, `/api/projects/${project.id}/mtl`)).json();
  expect(d2.items.find(i => i.id === late.id).status).not.toBe('LATE_START');
  await pmo.reload();
  await expect(box.getByTestId('mtl-alert-ended').filter({ hasText: `CB-${late.number}` })).toContainText('đã hết');
  await expect(box.getByTestId('mtl-alert').filter({ hasText: `CB-${late.number}` })).toHaveCount(0);
  await expect(box.locator('a', { hasText: `CB-${late.number}` })).toHaveCount(1);

  // 4) Chạy lại: không gửi lại "Chậm khởi động" cho việc đã cập nhật — vẫn đúng một thông báo "Chậm khởi động", chính là thông báo ở bước 1.
  //    Chỉ đếm "Chậm khởi động": việc 50% vẫn có thể nhận ĐÚNG cảnh báo khác theo số liệu hiện tại, tuỳ ngày chạy. Bước 2 kéo dài từ đầu
  //    tháng trước tới hết tháng sau, nên khoảng tuần cuối tháng kế hoạch ≥ 60% → lệch ≤ −10 điểm → "Chậm tiến độ" (vd. 25/11/2026:
  //    kế hoạch 60,9%, thực tế 50% — CI hỏng đúng chỗ này khi còn đếm mọi cảnh báo của việc).
  await apiAs(pmo, `/api/projects/${project.id}/mtl-alerts/run`, { method: 'POST' });
  const notes2 = (await (await apiAs(pmo, '/api/notifications')).json()).items.filter(n => n.type === 'MTL_ALERT' && n.title.includes(`CB-${late.number} `) && n.title.includes('Chậm khởi động'));
  expect(notes2.map(n => n.id)).toEqual([forLate[0].id]);

  // 5) Tooltip chỉ số, đơn vị trục.
  await expect(pmo.getByTestId('mtl-tile-spi')).toContainText('SPI dự án');
  await expect(pmo.getByTestId('mtl-tile-spi').locator('.mtl-help')).toHaveAttribute('title', /SPI dự án/);
  await expect(pmo.getByTestId('mtl-tile-kpi').locator('.mtl-help')).toHaveAttribute('title', /50% SPI/);
  await expect(pmo.getByTestId('mtl-tile-behind').locator('.mtl-help')).toHaveAttribute('title', /Chậm khởi động/);
  await expect(pmo.getByTestId('mtl-curve-unit')).toHaveText('tháng');

  // 6) Tab theo tháng gọi là "Kỳ cập nhật tháng".
  await pmo.goto(`/#/projects/${project.id}?view=sprint&mode=month`);
  await expect(pmo.getByTestId('sp-mode-month')).toHaveText('Kỳ cập nhật tháng');
  await expect(pmo.getByTestId('mo-title')).toHaveText(/^Kỳ cập nhật tháng \d{2}\/\d{4} · T3$/);

  // 7) Trang Thống kê: chữ tiếng Việt, ghi phạm vi số liệu.
  await pmo.goto('/#/dashboard');
  await expect(pmo.getByTestId('dash-scope')).toContainText('Phạm vi:');
  await expect(pmo.locator('#dashThroughput h3')).toContainText('Số việc xong mỗi tuần');
  await expect(pmo.getByTestId('kpis')).toContainText('Thời gian làm trung vị (ngày)');
  await expect(pmo.locator('[data-st-page="dashboard"]').locator('..')).not.toContainText('Throughput');
  await expect(pmo.locator('[data-st-page="dashboard"]').locator('..')).not.toContainText('Cycle time');
});
