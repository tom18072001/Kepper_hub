// Playground CRM / HRM (MODULES=crm,hrm, dữ liệu mẫu GIẢ): quyền theo bộ phận phụ trách / người phụ trách nhân sự; đơn nghỉ → lãnh đạo duyệt;
// chấm công trên giao diện; số CCCD chỉ hiện khi bấm (ghi nhật ký), không qua token Claude.
const { test, expect } = require('@playwright/test');
const { login, apiAs, toast, vnDate } = require('./helpers');

const weekdayAhead = n => { for (let i = n; ; i++) { const d = vnDate(i); const w = new Date(d + 'T00:00:00Z').getUTCDay(); if (w >= 1 && w <= 5) return d; } };

test('22. CRM: bộ phận phụ trách ghi nhật ký; bộ phận khác chỉ thấy thông tin chung', async ({ browser }) => {
  const nv = await (await browser.newContext()).newPage();
  await login(nv, 'nv.phaply');
  await nv.getByTestId('nav-crm').click();
  await expect(nv.getByTestId('crm-partners')).toContainText('Sở Xây dựng tỉnh Mẫu (giả)');
  await nv.getByTestId('crm-partners').getByText('Sở Xây dựng tỉnh Mẫu (giả)').click();
  await expect(nv.getByTestId('crm-contacts')).toContainText('Phạm Thẩm Định (giả)');
  await nv.getByTestId('crm-i-summary').fill('Gọi Sở hỏi tiến độ thẩm định (giả) — e2e');
  await nv.getByTestId('crm-i-save').click();
  await toast(nv, 'Đã ghi nhật ký');
  await expect(nv.getByTestId('crm-interactions')).toContainText('Gọi Sở hỏi tiến độ thẩm định (giả) — e2e');
  const partnerUrl = nv.url();

  const tc = await (await browser.newContext()).newPage();
  await login(tc, 'tb.taichinh');
  await tc.goto(partnerUrl);
  await expect(tc.getByText('Người liên hệ, nhật ký làm việc và hợp đồng chỉ bộ phận phụ trách')).toBeVisible();
  await expect(tc.getByTestId('crm-contacts')).toHaveCount(0);
  await expect(tc.getByTestId('crm-interactions')).not.toContainText('— e2e');
  const id = partnerUrl.split('/').pop();
  expect((await apiAs(tc, `/api/crm/partners/${id}/interactions`, { method: 'POST', data: { type: 'CALL', summary: 'x' } })).status()).toBe(403);
  // IT không thấy CRM.
  const it = await (await browser.newContext()).newPage();
  await login(it, 'admin');
  expect((await apiAs(it, '/api/crm/partners')).status()).toBe(403);
});

test('23. HRM: xin nghỉ → lãnh đạo bộ phận duyệt; chấm công; CCCD chỉ người phụ trách nhân sự / chính mình xem', async ({ browser }) => {
  const day = weekdayAhead(30);
  const nv = await (await browser.newContext()).newPage();
  await login(nv, 'nv.phaply');
  await nv.getByTestId('nav-hrm').click();
  await expect(nv.getByTestId('hrm-leave-remaining')).toBeVisible();
  await nv.getByTestId('hrm-leave-new').click();
  await nv.getByTestId('hrm-l-from').fill(day);
  await nv.getByTestId('hrm-l-to').fill(day);
  await nv.getByTestId('hrm-l-reason').fill('Việc gia đình (giả) — e2e');
  await nv.getByTestId('hrm-l-save').click();
  await toast(nv, 'Đã gửi đơn 1 ngày');
  await expect(nv.getByTestId('hrm-my-leaves')).toContainText('Việc gia đình (giả) — e2e');
  // Tự duyệt đơn của mình: không được.
  const mine = (await (await apiAs(nv, '/api/hrm/leaves?scope=mine&year=' + day.slice(0, 4))).json()).find(l => l.reason === 'Việc gia đình (giả) — e2e');
  expect((await apiAs(nv, `/api/hrm/leaves/${mine.id}/decide`, { method: 'POST', data: { decision: 'APPROVE' } })).status()).toBe(403);
  // Chấm công trên giao diện (giờ máy chủ).
  if (await nv.getByTestId('hrm-check-in').isVisible()) { await nv.getByTestId('hrm-check-in').click(); await toast(nv, 'Đã chấm vào'); }
  await expect(nv.getByTestId('hrm-in')).not.toHaveText('—');

  const tb = await (await browser.newContext()).newPage();
  await login(tb, 'tb.phaply');
  await tb.goto('/#/hrm/approve');
  const row = tb.getByTestId('hrm-approve-leaves').locator('tr', { hasText: 'Việc gia đình (giả) — e2e' });
  await row.getByTestId('hrm-approve').click();
  await toast(tb, 'Đã duyệt');
  // Lãnh đạo bộ phận: thấy trường cơ bản của nhân viên, không thấy ngày sinh / CCCD.
  const person = await (await apiAs(tb, `/api/hrm/people/${mine.user.id}`)).json();
  expect(person.employeeCode).toBeTruthy();
  expect(person.birthDate).toBeUndefined();
  expect(person.identity).toBeUndefined();
  expect((await apiAs(tb, `/api/hrm/people/${mine.user.id}/identity`)).status()).toBe(403);

  await nv.reload();
  await expect(nv.getByTestId('hrm-my-leaves').locator('tr', { hasText: 'Việc gia đình (giả) — e2e' })).toContainText('Đã duyệt');

  // Người phụ trách nhân sự: hiện số CCCD (ghi nhật ký).
  const hr = await (await browser.newContext()).newPage();
  await login(hr, 'nv.hcns');
  await hr.goto(`/#/hrm/people/${mine.user.id}`);
  await hr.getByTestId('hrm-reveal').click();
  await expect(hr.locator(`[data-id-for="${mine.user.id}"]`)).toHaveText(/^\d{12}$/);
  await toast(hr, 'ghi nhật ký');
});
