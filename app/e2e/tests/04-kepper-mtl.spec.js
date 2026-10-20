// Kepper — dự án theo Master Timeline (dữ liệu GIẢ): tạo dự án MTL, nhập MTL tổng + MTL bộ phận từ Excel (xem trước, đầu mối → bộ phận,
// cơ quan ngoài), nhập lại giữ / đặt lại kế hoạch gốc, cập nhật tiến độ tự chuyển cột, cảnh báo tự động, Dashboard, KPI theo người (phân quyền),
// điều chỉnh kế hoạch gốc bắt buộc lý do + nhật ký, Viber mặc định tắt.
const path = require('node:path');
const os = require('node:os');
const { test, expect } = require('@playwright/test');
const ExcelJS = require(path.join(__dirname, '../../server/node_modules/exceljs'));
const { login, apiAs, toast, openProject } = require('./helpers');

test.describe.configure({ mode: 'serial' });
const HEAD = ['Bước', 'Hạng mục công việc', 'Đầu mối', 'Bắt đầu (T)', 'Kết thúc (T)', 'Thời lượng (tháng)', 'Đường găng', 'Mốc'];
async function xlsx(name, rows, header = HEAD) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('MTL overall');
  ws.addRow(['MASTER TIMELINE — DỰ ÁN E2E (giả)']); ws.addRow(header);
  for (const r of rows) ws.addRow(r);
  const file = path.join(os.tmpdir(), `kepper-e2e-${name}-${process.pid}.xlsx`);
  await wb.xlsx.writeFile(file);
  return file;
}
// T0 = tháng hiện tại − 3 → hạng mục T0–T1 đã quá hạn, T2–T5 đang trong kỳ, T8–T9 chưa đến kỳ.
const t0Month = () => { const d = new Date(Date.now() + 7 * 3_600_000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 3); return d.toISOString().slice(0, 7); };
const MASTER = [
  [1, 'Pháp lý dự án E2E (giả)', 'CT/PL', 0, 1, 2, 'ĐƯỜNG GĂNG', ''],
  [2, 'Hồ sơ đề xuất E2E (giả)', 'Pháp lý/Tài chính', 2, 5, 4, 'ĐƯỜNG GĂNG', '◆'],
  [3, 'Chấp thuận của thành phố E2E (giả)', 'UBND TP', 3, 4, 2, '', ''],
  [4, 'Thiết kế cơ sở E2E (giả)', 'Thiết kế', 8, 9, 2, '', ''],
];

test('18. Dự án MTL: tạo, nhập MTL tổng / bộ phận, tiến độ, cảnh báo, Dashboard, KPI, kế hoạch gốc', async ({ browser }) => {
  test.setTimeout(180_000);
  const pmo = await (await browser.newContext()).newPage();
  await login(pmo, 'giamdoc');
  // 1) Tạo dự án theo Master Timeline (mặc định dùng chung toàn công ty).
  await pmo.getByTestId('new-project').click();
  await pmo.getByTestId('project-key').fill('MT');
  await pmo.getByTestId('project-name').fill('Dự án E2E (giả)');
  await expect(pmo.getByTestId('project-template')).toHaveValue('MTL');
  await pmo.getByTestId('project-t0').fill(t0Month());
  await pmo.getByTestId('project-save').click();
  await toast(pmo, 'Đã tạo dự án MT');
  await expect(pmo.getByTestId('mtl-empty')).toBeVisible();
  const project = (await (await apiAs(pmo, '/api/projects')).json()).find(p => p.key === 'MT');
  expect(project.kind).toBe('MTL'); expect(project.visibility).toBe('PUBLIC');

  // 2) Nhập MTL tổng: xem trước (đầu mối → bộ phận, cơ quan ngoài) rồi nhập.
  const file = await xlsx('master', MASTER);
  await pmo.getByTestId('ph-more').click(); await pmo.getByTestId('mtl-import').click();
  await pmo.getByTestId('mtl-import-file').setInputFiles(file);
  await pmo.getByTestId('mtl-import-preview').click();
  const sum = pmo.getByTestId('mtl-import-summary');
  await expect(sum).toContainText('4 hạng mục');
  await expect(sum).toContainText('tạo mới 4');
  await expect(sum).toContainText('UBND TP');
  await pmo.getByTestId('mtl-import-go').click();
  await toast(pmo, 'Đã nhập MTL: tạo 4');
  const d1 = await (await apiAs(pmo, `/api/projects/${project.id}/mtl`)).json();
  const step = s => d1.items.find(i => i.planCode === String(s));
  expect(step(1).critical).toBe(true); expect(step(2).milestone).toBe(true);
  expect(step(2).leadDepartmentName).toBe('Ban Pháp lý');
  expect(step(3).externalParty).toBe('UBND TP');
  expect(step(1).status).toBe('OVERDUE');
  expect(step(4).status).toBe('NOT_DUE');

  // 3) Nhập lại với thời gian đổi: mặc định giữ kế hoạch gốc; chọn "đặt lại" mới đổi (ghi nhật ký).
  const moved = await xlsx('moved', MASTER.map(r => (r[0] === 4 ? [4, r[1], r[2], 9, 10, 2, '', ''] : r)));
  const send = async (rebaseline) => apiAs(pmo, `/api/projects/${project.id}/mtl-import`, { method: 'POST', multipart: { file: { name: 'mtl.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: require('node:fs').readFileSync(moved) }, kind: 'MASTER', planName: 'MTL — MTL overall', ...(rebaseline ? { rebaseline: '1' } : {}) } });
  const keep = await (await send(false)).json();
  expect(keep.updated).toBe(4); expect(keep.baselineChanged).toBe(1); expect(keep.rebased).toBe(0);
  const d2 = await (await apiAs(pmo, `/api/projects/${project.id}/mtl`)).json();
  expect(d2.items.find(i => i.planCode === '4').baselineStart).toBe(step(4).baselineStart);
  expect((await (await send(true)).json()).rebased).toBe(1);

  // 4) MTL bộ phận (Ban Pháp lý): gắn vào bước 2 qua cột "Thuộc bước", người phụ trách khớp tài khoản.
  const users = await (await apiAs(pmo, '/api/users/directory')).json();
  const D = Object.fromEntries((await (await apiAs(pmo, '/api/departments')).json()).map(d => [d.code, d]));
  const deptFile = await xlsx('pl', [['2.1', 'Soạn hồ sơ đề xuất E2E (giả)', users.find(u => u.username === 'nv.phaply').fullName, 2, 3, 2, '', '', '2']], [...HEAD, 'Thuộc bước']);
  await pmo.getByTestId('ph-more').click(); await pmo.getByTestId('mtl-import').click();
  await pmo.getByTestId('mtl-import-file').setInputFiles(deptFile);
  await pmo.getByTestId('mtl-import-kind').selectOption('DEPARTMENT');
  await pmo.getByTestId('mtl-import-dept').selectOption(String(D.PL.id));
  await pmo.getByTestId('mtl-import-preview').click();
  await expect(pmo.getByTestId('mtl-import-summary')).toContainText('thuộc 2');
  await pmo.getByTestId('mtl-import-go').click();
  await toast(pmo, 'Đã nhập MTL: tạo 1');
  const d3 = await (await apiAs(pmo, `/api/projects/${project.id}/mtl`)).json();
  const child = d3.items.find(i => i.planCode === '2.1');
  expect(child.parentId).toBe(d3.items.find(i => i.planCode === '2').id);
  expect(child.assignees.map(a => a.id)).toContain(users.find(u => u.username === 'nv.phaply').id);

  // 5) Cán bộ cập nhật tiến độ ngay trong chi tiết (dạng gọn) → tự chuyển "Đang thực hiện"; hạng mục cha lấy % từ con.
  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.phaply');
  await staff.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.endsWith(':ip:full')) localStorage.removeItem(k); });
  await staff.goto(`/#/projects/${project.id}?view=plan&item=${child.id}`);
  await expect(staff.getByTestId('mtl-box')).toBeVisible();
  await staff.getByTestId('item-progress').fill('60');
  await staff.getByTestId('item-progress').press('Tab');
  await expect.poll(async () => (await (await apiAs(staff, `/api/items/${child.id}`)).json()).state.category).toBe('STARTED');
  const d4 = await (await apiAs(pmo, `/api/projects/${project.id}/mtl`)).json();
  expect(d4.items.find(i => i.planCode === '2').actual).toBe(60);

  // 6) Cảnh báo tự động (chạy ngay): trưởng ban Pháp lý nhận cảnh báo hạng mục của ban; chạy lại không lặp.
  await pmo.goto(`/#/projects/${project.id}?view=mtl`); await pmo.reload();
  await pmo.getByTestId('ph-more').click(); await pmo.getByTestId('mtl-run-alerts').click();
  await toast(pmo, 'Đã gửi');
  const lead = await (await browser.newContext()).newPage();
  await login(lead, 'tb.phaply');
  const notes = await (await apiAs(lead, '/api/notifications')).json();
  expect(notes.items.some(n => n.type === 'MTL_ALERT' && n.title.includes(`MT-${child.number}`))).toBe(true);
  expect((await (await apiAs(pmo, `/api/projects/${project.id}/mtl-alerts/run`, { method: 'POST' })).json()).alerts).toBe(0);
  await pmo.reload();
  await expect(pmo.getByTestId('mtl-alerts')).toContainText('Trễ hạn');
  await expect(pmo.getByTestId('mtl-departments')).toContainText('Ban Pháp lý');
  await expect(pmo.getByTestId('mtl-curve')).toBeVisible();
  // Ô "Trễ hạn" → Kế hoạch & Gantt lọc trễ hạn.
  await pmo.getByTestId('mtl-tile-overdue').click();
  await expect(pmo.getByTestId('mtl-f-status')).toHaveValue('OVERDUE');
  await expect(pmo.getByTestId(`mtl-row-1`)).toBeVisible();
  await expect(pmo.getByTestId(`mtl-row-4`)).toHaveCount(0);

  // 7) KPI theo người: Ban lãnh đạo, trưởng bộ phận (bộ phận mình); cán bộ không.
  expect((await apiAs(staff, `/api/projects/${project.id}/mtl-kpi`)).status()).toBe(403);
  const k = await (await apiAs(lead, `/api/projects/${project.id}/mtl-kpi`)).json();
  expect(k.scope).toBe('UNIT'); expect(k.rows.every(r => r.departmentId === D.PL.id)).toBe(true);
  await pmo.goto(`/#/projects/${project.id}?view=mtl`);
  await expect(pmo.getByTestId('mtl-people')).toBeVisible();
  // Chỉ người quản lý dự án nhập MTL / điều chỉnh kế hoạch gốc; điều chỉnh bắt buộc lý do và ghi nhật ký.
  expect((await apiAs(staff, `/api/projects/${project.id}/mtl-import`, { method: 'POST', multipart: { file: { name: 'a.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') } } })).status()).toBe(403);
  expect((await apiAs(pmo, `/api/items/${step(3).id}/rebaseline`, { method: 'POST', data: { startT: 3, endT: 6 } })).status()).toBe(422);
  expect((await apiAs(pmo, `/api/items/${step(3).id}/rebaseline`, { method: 'POST', data: { startT: 3, endT: 6, reason: 'Thành phố lùi lịch họp (giả)' } })).status()).toBe(200);
  const admin = await (await browser.newContext()).newPage();
  await login(admin, 'admin');
  expect(JSON.stringify(await (await apiAs(admin, '/api/admin/audit?action=MTL_REBASELINE')).json())).toContain('MTL_REBASELINE');
  expect((await apiAs(admin, '/api/mtl/portfolio')).status()).toBe(403);

  // 8) Dashboard dự án (trang chủ) và Viber mặc định tắt.
  await lead.goto('/#/home');
  await expect(lead.getByTestId('home-project-MT')).toContainText('Dự án E2E (giả)');
  await expect(lead.getByTestId('home-project-DA')).toBeVisible();
  const v = await (await apiAs(lead, '/api/me/viber')).json();
  expect(v.enabled).toBe(false);
  expect((await apiAs(lead, '/api/me/viber/code', { method: 'POST', data: { consent: true } })).status()).toBe(409);
  expect((await lead.request.post('/api/viber/webhook', { data: { event: 'message' } })).status()).toBe(404);
});
