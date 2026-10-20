// GĐ3h — Tổng thể công việc theo người / phòng (mọi dự án), tên người / phòng bấm được, ô "Số liệu của tôi" mở đúng danh sách việc,
// kiến nghị: lãnh đạo phòng "Trình BGĐ" → Ban Giám đốc Duyệt / Không duyệt; tài liệu hai chiều trong chi tiết việc. Dữ liệu GIẢ.
const { test, expect } = require('@playwright/test');
const { login, apiAs, toast, vnDate } = require('./helpers');

test('17. Tổng thể công việc theo người / phòng, ô số liệu bấm được, trình kiến nghị lên BGĐ, tài liệu hai chiều', async ({ browser }) => {
  const director = await (await browser.newContext()).newPage();
  await login(director, 'giamdoc');
  const D = Object.fromEntries((await (await apiAs(director, '/api/departments')).json()).map(d => [d.code, d]));
  const users = await (await apiAs(director, '/api/users/directory')).json();
  const uid = u => users.find(x => x.username === u).id;
  const tt = (await (await apiAs(director, '/api/projects')).json()).find(p => p.key === 'TT');
  const res = await apiAs(director, `/api/projects/${tt.id}/items`, { method: 'POST', data: { title: 'Tổng hợp số liệu GĐ3h (E2E)', dueDate: vnDate(2), leadDepartmentId: D.KD.id, assigneeIds: [uid('nv.kinhdoanh1')] } });
  expect(res.status()).toBe(201);
  const item = await res.json();
  const code = `TT-${item.number}`;

  // 1) Cán bộ báo cáo tiến độ kèm kiến nghị (vượt thẩm quyền phòng).
  const staff = await (await browser.newContext()).newPage();
  await login(staff, 'nv.kinhdoanh1');
  expect((await apiAs(staff, `/api/items/${item.id}/progress-reports`, { method: 'POST', data: { progress: 30, content: 'Đã tổng hợp tổ 1', proposals: 'Đề nghị Phòng Kỹ thuật cung cấp số liệu' } })).status()).toBe(201);

  // 2) Trưởng phòng: Duyệt / Không duyệt / Trình BGĐ — chọn Trình BGĐ kèm ý kiến phòng; kiến nghị rời hàng chờ của phòng.
  const manager = await (await browser.newContext()).newPage();
  await login(manager, 'tp.kinhdoanh');
  const before = (await (await apiAs(manager, '/api/approvals/counts')).json()).proposals;
  await manager.goto(`/#/ops?item=${item.id}&focus=proposal`);
  await manager.getByTestId('answer-input').fill('Phòng đề nghị BGĐ chỉ đạo Phòng Kỹ thuật');
  await manager.getByTestId('proposal-forward').click();
  await toast(manager, 'Đã trình kiến nghị lên Ban Giám đốc');
  await expect(manager.getByTestId('proposal-forward')).toHaveCount(0);
  expect((await (await apiAs(manager, '/api/approvals/counts')).json()).proposals).toBe(before - 1);
  expect((await apiAs(manager, `/api/progress-reports/${(await (await apiAs(manager, `/api/items/${item.id}`)).json()).progressReports[0].id}/forward`, { method: 'POST', data: {} })).status()).toBe(409);

  // 3) Ban Giám đốc thấy "Phòng trình BGĐ" và duyệt kèm ý kiến.
  await director.goto(`/#/ops?all=1&item=${item.id}&focus=proposal`);
  await expect(director.getByTestId('proposal-forwarded')).toContainText('Phòng đề nghị BGĐ chỉ đạo');
  await expect(director.getByTestId('proposal-forward')).toHaveCount(0);
  await director.getByTestId('answer-input').fill('Giao Phòng Kỹ thuật gửi trước thứ Sáu');
  await director.getByTestId('answer-submit').click();
  await toast(director, 'Đã duyệt kiến nghị');
  const answered = (await (await apiAs(staff, `/api/items/${item.id}`)).json()).progressReports[0];
  expect(answered.answer).toBe('Duyệt. Giao Phòng Kỹ thuật gửi trước thứ Sáu');
  // Tài liệu hai chiều: hai cột bên giao / bên thực hiện.
  await expect(director.getByTestId('tw-give')).toBeVisible();
  await expect(director.getByTestId('tw-back')).toBeVisible();

  // 4) Tổng thể công việc: phòng → bấm tên cán bộ → mọi việc của người đó trên mọi dự án.
  await expect(director.getByTestId('nav-work')).toBeVisible();
  await director.goto(`/#/work?dept=${D.KD.id}`);
  await expect(director.getByTestId(`work-${code}`)).toBeVisible();
  await director.getByTestId(`work-${code}`).locator(`[data-person="${uid('nv.kinhdoanh1')}"]`).first().click();
  await expect(director).toHaveURL(new RegExp(`#/work\\?user=${uid('nv.kinhdoanh1')}`));
  await expect(director.locator('.wk-who h1')).toHaveText(users.find(x => x.username === 'nv.kinhdoanh1').fullName);
  await expect(director.getByTestId(`work-${code}`)).toContainText('Chủ trì');
  await director.getByTestId('work-filter-more').click();
  await director.getByTestId('work-f-status').selectOption('soon');
  await expect(director.getByTestId('work-chip-status')).toContainText('Sắp đến hạn');
  await expect(director.getByTestId('work-f-status')).toBeVisible(); // ô bộ lọc vẫn mở sau khi tải lại
  await expect(director.getByTestId(`work-${code}`)).toBeVisible();
  await director.locator('#wkMore [data-pop-close]').click();
  await director.getByTestId('work-chip-status').click();
  await expect(director.getByTestId('work-chip-status')).toHaveCount(0);

  // Tổng hợp giao việc: bấm tên cán bộ → Tổng thể công việc lọc theo người đó.
  await director.goto('/#/summary');
  await director.getByTestId(`summary-${uid('nv.kinhdoanh1')}`).locator('[data-person]').click();
  await expect(director).toHaveURL(new RegExp(`#/work\\?user=${uid('nv.kinhdoanh1')}`));

  // 5) Phạm vi: lãnh đạo phòng chỉ phòng mình; cán bộ chỉ chính mình; admin IT không có số liệu. Xem người khác được ghi nhật ký.
  expect((await apiAs(manager, `/api/work?user=${uid('nv.kinhdoanh1')}`)).status()).toBe(200);
  expect((await apiAs(manager, `/api/work?dept=${D.KT.id}`)).status()).toBe(403);
  expect((await apiAs(manager, `/api/work?user=${uid('tp.kythuat')}`)).status()).toBe(403);
  expect((await apiAs(staff, `/api/work?user=${uid('tp.kinhdoanh')}`)).status()).toBe(403);
  expect((await apiAs(staff, '/api/work')).status()).toBe(200);
  await expect(staff.getByTestId('nav-work')).toBeHidden();
  const admin = await (await browser.newContext()).newPage();
  await login(admin, 'admin');
  expect((await apiAs(admin, '/api/work')).status()).toBe(403);
  const audit = await (await apiAs(admin, '/api/admin/audit?action=VIEW_WORK')).json();
  expect(JSON.stringify(audit)).toContain('VIEW_WORK');

  // 6) Ô "Số liệu của tôi" bấm được → đúng tập việc (được giao trong kỳ).
  await staff.goto('/#/my');
  await staff.getByTestId('my-kpi-tile-assigned').click();
  await expect(staff).toHaveURL(/#\/work\?.*metric=assigned/);
  await expect(staff.getByTestId('work-metric')).toContainText('Được giao trong kỳ');
  await expect(staff.getByTestId(`work-${code}`)).toBeVisible();
});
