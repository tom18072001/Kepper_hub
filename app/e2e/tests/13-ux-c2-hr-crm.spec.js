// Đợt C2 — UX Nhân sự (HRM) và Đối tác (CRM), MODULES=crm,hrm, dữ liệu mẫu GIẢ.
// H6 chấm ra khi chưa chấm vào; H9 đơn nghỉ / giải trình trong "Chờ tôi duyệt" + số đếm; H8 hộp xác nhận "Giữ đơn" / "Huỷ đơn";
// H1 / H5 / H10 / H11 trang "Của tôi", nút hiện / ẩn, tên tab, xem trước đơn nghỉ; R4 tìm không dấu; R1 lọc ngay; R6 tiêu đề tab đối tác.
const { test, expect, login, apiAs, toast, vnDate, NEW_PASSWORD } = require('./helpers');

const weekdayAhead = n => { for (let i = n; ; i++) { const d = vnDate(i); const w = new Date(d + 'T00:00:00Z').getUTCDay(); if (w >= 1 && w <= 5) return d; } };
const weekdayBack = n => { for (let i = n; ; i++) { const d = vnDate(-i); const w = new Date(d + 'T00:00:00Z').getUTCDay(); if (w >= 1 && w <= 5) return d; } };
async function newPage(browser, username) {
  const page = await (await browser.newContext()).newPage();
  await login(page, username);
  return page;
}
// Hộp thoại gốc của trình duyệt (confirm / alert) không được dùng: đếm để khẳng định bằng 0.
const countDialogs = page => { const n = { v: 0 }; page.on('dialog', d => { n.v++; d.dismiss().catch(() => {}); }); return n; };

// Kịch bản chấm công "hôm nay" chỉ có nghĩa vào ngày làm việc: cuối tuần bảng công (hrm-sheet) hiện ô ngày nghỉ (T7/CN)
// thay cho "Thiếu giờ vào", nên bỏ qua để CI không đỏ theo thứ trong tuần (chạy lại vào ngày thường vẫn phủ đủ).
const isWeekendVN = [0, 6].includes(new Date(vnDate(0) + 'T00:00:00Z').getUTCDay());

test('H6. Chấm ra khi chưa chấm vào: nút khoá kèm lý do, máy chủ chặn; xác nhận trên trang thì ghi "thiếu giờ vào"', async ({ browser }) => {
  test.skip(isWeekendVN, 'Chấm công "hôm nay": cuối tuần bảng công hiện ngày nghỉ, không áp dụng — chạy ngày thường');
  const nv = await newPage(browser, 'nv.kythuat'); // không có dữ liệu chấm công mẫu
  const dialogs = countDialogs(nv);
  await nv.goto('/#/hrm');
  await expect(nv.getByTestId('hrm-check-in')).toBeVisible();
  await expect(nv.getByTestId('hrm-check-out')).toBeDisabled();
  await expect(nv.getByTestId('hrm-out-why')).toContainText('Chưa chấm vào hôm nay');
  // Máy chủ cũng chặn (gọi thẳng API, không qua nút).
  const r = await apiAs(nv, '/api/hrm/attendance/check', { method: 'POST', data: { kind: 'out' } });
  expect(r.status()).toBe(409);
  expect((await r.json()).code).toBe('NO_CHECK_IN');
  await expect(nv.getByTestId('hrm-out')).toHaveText('—');

  // Hỏi lại ngay trên trang (không dùng confirm()); "Thôi" thì không ghi gì.
  await nv.getByTestId('hrm-out-noin').click();
  await expect(nv.getByTestId('hrm-noin-confirm')).toBeVisible();
  await expect(nv.getByTestId('hrm-noin-confirm')).toContainText('thiếu giờ vào');
  await nv.getByTestId('hrm-noin-cancel').click();
  await expect(nv.getByTestId('hrm-noin-confirm')).toBeHidden();
  await nv.getByTestId('hrm-out-noin').click();
  await nv.getByTestId('hrm-noin-ok').click();
  await toast(nv, 'thiếu giờ vào');
  await expect(nv.getByTestId('hrm-in')).toHaveText('—');
  await expect(nv.getByTestId('hrm-out')).not.toHaveText('—');
  await expect(nv.getByTestId('hrm-no-in')).toHaveText('Thiếu giờ vào');
  await expect(nv.getByTestId('hrm-check-in')).toHaveCount(0);
  await expect(nv.getByTestId('hrm-explain-today')).toBeVisible();
  await expect(nv.getByTestId('hrm-sheet')).toContainText('Thiếu giờ vào');
  // Đã chấm ra (thiếu giờ vào) thì không chấm vào chồng lên được — bổ sung bằng giải trình.
  expect((await apiAs(nv, '/api/hrm/attendance/check', { method: 'POST', data: { kind: 'in' } })).status()).toBe(409);
  const me = await (await apiAs(nv, '/api/hrm/me')).json();
  expect(me.today.checkIn).toBeNull();
  expect(me.today.note).toContain('thiếu giờ vào');
  expect(dialogs.v).toBe(0);

  // Đã chấm vào: nút "Chấm vào" thành giờ đã chấm, "Chấm ra" bấm được.
  const kd = await newPage(browser, 'nv.kinhdoanh1');
  await kd.goto('/#/hrm');
  await kd.getByTestId('hrm-check-in').click();
  await toast(kd, 'Đã chấm vào');
  await expect(kd.getByTestId('hrm-checked-in')).toContainText(/Đã chấm vào \d{2}:\d{2}/);
  await expect(kd.getByTestId('hrm-check-in')).toHaveCount(0);
  await expect(kd.getByTestId('hrm-check-out')).toBeEnabled();
  await kd.getByTestId('hrm-check-out').click();
  await toast(kd, 'Đã chấm ra');
  await expect(kd.getByTestId('hrm-out')).not.toHaveText('—');
});

test('H9. Đơn nghỉ & giải trình nằm trong "Chờ tôi duyệt" (tab riêng, có số đếm), huy hiệu và Trang chủ tính cả; duyệt ngay tại tab', async ({ browser }) => {
  // Đơn bổ sung (đã nghỉ ~4 tuần trước): xếp đầu "Việc cần xử lý" ở Trang chủ (theo ngày bắt đầu nghỉ).
  const day = weekdayBack(26);
  const nv = await newPage(browser, 'nv.phaply');
  const created = await apiAs(nv, '/api/hrm/leaves', { method: 'POST', data: { type: 'UNPAID', fromDate: day, toDate: day, reason: 'Việc riêng (giả) — e2e H9' } });
  expect(created.status()).toBe(201);
  const leaveId = (await created.json()).id;
  expect((await apiAs(nv, '/api/hrm/attendance/explain', { method: 'POST', data: { day: vnDate(-2), in: '08:00', out: '17:30', reason: 'Quên chấm công (giả) — e2e H9' } })).status()).toBe(200);

  const tb = await newPage(browser, 'tb.phaply');
  const before = await (await apiAs(tb, '/api/approvals/counts')).json();
  expect(before.hr).toBeGreaterThanOrEqual(2);
  expect(before.total).toBe(before.queue + before.extensions + before.proposals + before.hr);
  // Huy hiệu menu "Chờ tôi duyệt" tính cả đơn nghỉ / giải trình.
  await expect(tb.locator('#approvalBadge')).toHaveText(String(before.total));

  // Trang chủ → "Việc cần xử lý": có đơn nghỉ và giải trình, dẫn tới tab Nhân sự của "Chờ tôi duyệt" (không lộ loại nghỉ / lý do).
  await tb.goto('/#/today');
  const todo = tb.getByTestId('today-todo');
  await expect(todo.getByTestId('today-leave').filter({ hasText: 'Tô Minh Khoa xin nghỉ 1 ngày' }).first()).toBeVisible();
  await expect(todo.getByTestId('today-att').first()).toContainText('giải trình chấm công');
  await expect(todo).not.toContainText('e2e H9');
  await todo.getByTestId('today-leave').first().click();
  await expect(tb).toHaveURL(/#\/approvals\?tab=hr/);

  // Tab "Đơn nghỉ & giải trình" có số đếm; duyệt ngay tại đây.
  const tab = tb.getByTestId('approvals-tab-hr');
  await expect(tab).toHaveClass(/active/);
  await expect(tab).toContainText(`Đơn nghỉ & giải trình ${before.hr}`);
  const row = tb.getByTestId(`hrm-leave-row-${leaveId}`);
  await expect(row).toContainText('Việc riêng (giả) — e2e H9');
  await row.getByTestId('hrm-approve').click();
  await toast(tb, 'Đã duyệt');
  await expect(tb.getByTestId(`hrm-leave-row-${leaveId}`)).toHaveCount(0);
  await expect(tab).toContainText(`Đơn nghỉ & giải trình ${before.hr - 1}`);
  await expect(tb.locator('#approvalBadge')).toHaveText(String(before.total - 1));
  // Giải trình: duyệt cũng ngay tại tab.
  await tb.getByTestId('hrm-approve-atts').locator('tr', { hasText: 'e2e H9' }).getByTestId('hrm-att-approve').click();
  await toast(tb, 'Đã duyệt');
  await expect(tab).toContainText(`Đơn nghỉ & giải trình ${before.hr - 2}`);

  // Nhân sự → tab "Chờ duyệt" cũng có số đếm, khớp "Chờ tôi duyệt".
  const after = await (await apiAs(tb, '/api/approvals/counts')).json();
  expect(after.hr).toBe(before.hr - 2);
  await tb.goto('/#/hrm/approve');
  await expect(tb.getByTestId('hrm-approve-count')).toHaveText(String(after.hr));
  await expect(tb.getByTestId('hrm-tab-people')).toHaveText('Danh sách nhân sự');

  // Nhân viên thường: tab có nhưng 0, không có nút duyệt.
  await nv.goto('/#/approvals?tab=hr');
  await expect(nv.getByTestId('approvals-tab-hr')).toContainText('0');
  await expect(nv.getByTestId('hrm-approve')).toHaveCount(0);
  const mine = (await (await apiAs(nv, '/api/hrm/leaves?scope=mine&year=' + day.slice(0, 4))).json()).find(l => l.id === leaveId);
  expect(mine.status.code).toBe('APPROVED');
});

test('H8. Huỷ đơn nghỉ: hai nút "Giữ đơn" / "Huỷ đơn"; đơn đã duyệt ghi rõ lãnh đạo bộ phận sẽ được báo', async ({ browser }) => {
  const nv = await newPage(browser, 'nv.phaply');
  const dialogs = countDialogs(nv);
  const pendingDay = weekdayAhead(70), approvedDay = weekdayAhead(80);
  const a = await (await apiAs(nv, '/api/hrm/leaves', { method: 'POST', data: { type: 'UNPAID', fromDate: pendingDay, toDate: pendingDay, reason: 'Chờ duyệt (giả) — e2e H8' } })).json();
  const b = await (await apiAs(nv, '/api/hrm/leaves', { method: 'POST', data: { type: 'UNPAID', fromDate: approvedDay, toDate: approvedDay, reason: 'Đã duyệt (giả) — e2e H8' } })).json();
  const tb = await newPage(browser, 'tb.phaply');
  expect((await apiAs(tb, `/api/hrm/leaves/${b.id}/decide`, { method: 'POST', data: { decision: 'APPROVE' } })).status()).toBe(200);

  await nv.goto('/#/hrm');
  const leaves = nv.getByTestId('hrm-my-leaves');
  const pendingRow = leaves.locator('tr', { hasText: 'Chờ duyệt (giả) — e2e H8' });
  await pendingRow.getByTestId('hrm-leave-cancel').click();
  const modal = nv.locator('#modal');
  await expect(nv.getByTestId('confirm-cancel')).toHaveText('Giữ đơn');
  await expect(nv.getByTestId('confirm-ok')).toHaveText('Huỷ đơn');
  await expect(modal).not.toContainText('sẽ được báo');
  // "Giữ đơn": đơn còn nguyên.
  await nv.getByTestId('confirm-cancel').click();
  await expect(modal).toBeHidden();
  await expect(pendingRow).toContainText('Chờ duyệt');
  await pendingRow.getByTestId('hrm-leave-cancel').click();
  await nv.getByTestId('confirm-ok').click();
  await toast(nv, 'Đã huỷ đơn nghỉ');
  await expect(leaves.locator('tr', { hasText: 'Chờ duyệt (giả) — e2e H8' })).toContainText('Đã huỷ');

  // Đơn đã duyệt: hộp xác nhận ghi rõ lãnh đạo bộ phận (người đã duyệt) sẽ được báo.
  const approvedRow = leaves.locator('tr', { hasText: 'Đã duyệt (giả) — e2e H8' });
  await approvedRow.getByTestId('hrm-leave-cancel').click();
  await expect(modal).toContainText('Lãnh đạo bộ phận (Lý Thanh Hằng) sẽ được báo');
  await nv.getByTestId('confirm-ok').click();
  await toast(nv, 'Đã huỷ đơn nghỉ');
  await expect(leaves.locator('tr', { hasText: 'Đã duyệt (giả) — e2e H8' })).toContainText('Đã huỷ');
  const notes = await (await apiAs(tb, '/api/notifications')).json();
  expect(notes.items.some(n => n.title.includes('huỷ đơn nghỉ'))).toBe(true);
  expect(a.id).toBeTruthy();
  expect(dialogs.v).toBe(0);
});

test('H1 + H5 + H10 + H11. "Của tôi": Hôm nay và Đơn nghỉ lên đầu, hồ sơ thu gọn; "Hiện / Ẩn CCCD", "Hiện lương"; form xin nghỉ xem trước số ngày, phép còn lại, đơn trùng', async ({ browser }) => {
  const nv = await newPage(browser, 'nv.phaply');
  await nv.goto('/#/hrm');
  const top = await nv.getByTestId('hrm-today').boundingBox();
  const leavesBox = await nv.getByTestId('hrm-my-leaves').boundingBox();
  const sheet = await nv.getByTestId('hrm-sheet').boundingBox();
  expect(Math.abs(top.y - leavesBox.y)).toBeLessThan(5); // cùng hàng đầu trang
  expect(sheet.y).toBeGreaterThan(top.y);
  const profile = nv.getByTestId('hrm-profile');
  await expect(profile).not.toHaveAttribute('open', '');
  const profBox = await profile.boundingBox();
  expect(profBox.y).toBeGreaterThan(sheet.y);
  expect(profBox.height).toBeLessThan(90); // thu gọn: chỉ dòng tiêu đề
  await profile.locator('summary').click();
  await expect(nv.getByTestId('hrm-salary-reveal')).toHaveText('Hiện lương');
  await expect(nv.getByTestId('hrm-reveal')).toHaveText('Hiện CCCD');
  // Hiện rồi ẩn lại CCCD (nhập lại mật khẩu, lượt xem ghi nhật ký).
  await nv.getByTestId('hrm-reveal').click();
  await nv.getByTestId('hrm-pw').fill(NEW_PASSWORD);
  await nv.getByTestId('hrm-pw-ok').click();
  const meId = (await (await apiAs(nv, '/api/hrm/me')).json()).profile.userId;
  await expect(nv.locator(`[data-id-for="${meId}"]`)).toHaveText(/^\d{12}$/);
  await nv.getByTestId('hrm-unreveal').click();
  await expect(nv.locator(`[data-id-for="${meId}"]`)).toHaveText(/^•+ \d{4}$/);
  await expect(nv.getByTestId('hrm-reveal')).toHaveText('Hiện CCCD');
  await nv.getByTestId('hrm-salary-reveal').click();
  await nv.getByTestId('hrm-pw').fill(NEW_PASSWORD);
  await nv.getByTestId('hrm-pw-ok').click();
  await expect(nv.getByTestId('hrm-salary')).toContainText('đ');
  await nv.getByTestId('hrm-salary-hide').click();
  await expect(nv.getByTestId('hrm-salary-reveal')).toHaveText('Hiện lương');
  // Mở lại trang: khối hồ sơ nhớ trạng thái mở.
  await nv.reload();
  await expect(nv.getByTestId('hrm-profile')).toHaveAttribute('open', '');

  // H11: xem trước khi chọn ngày — số ngày làm việc, phép năm còn lại sau đơn; trùng đơn báo ngay, chưa cho gửi.
  const free = weekdayAhead(90);
  await nv.getByTestId('hrm-leave-new').click();
  await nv.getByTestId('hrm-l-from').fill(free);
  await nv.getByTestId('hrm-l-to').fill(free);
  await expect(nv.getByTestId('hrm-l-days')).toHaveText('1');
  await expect(nv.getByTestId('hrm-l-preview')).toContainText(/Phép năm( \d{4})? còn \d+ → còn \d+ sau đơn này/);
  await expect(nv.getByTestId('hrm-l-save')).toBeEnabled();
  const existing = (await (await apiAs(nv, '/api/hrm/leaves?scope=mine')).json()).find(l => l.status.code === 'PENDING');
  await nv.getByTestId('hrm-l-from').fill(existing.fromDate);
  await nv.getByTestId('hrm-l-to').fill(existing.fromDate);
  await expect(nv.getByTestId('hrm-l-warn')).toContainText('Trùng đơn nghỉ');
  await expect(nv.getByTestId('hrm-l-save')).toBeDisabled();
});

test('R4 + R1 + R6. Đối tác: tìm không dấu, lọc ngay khi gõ / đổi ô chọn (không còn nút "Lọc"); tiêu đề tab là tên đối tác', async ({ browser }) => {
  const nv = await newPage(browser, 'nv.phaply');
  // R4 trên API: không dấu, hoa / thường đều ra; ký tự % _ hiểu theo nghĩa đen.
  const names = async q => (await (await apiAs(nv, '/api/crm/partners?q=' + encodeURIComponent(q))).json()).map(p => p.name);
  expect(await names('xay dung')).toEqual(expect.arrayContaining(['Công ty CP Xây dựng Mẫu An Phát (giả)', 'Sở Xây dựng tỉnh Mẫu (giả)']));
  expect(await names('XÂY DỰNG')).toEqual(await names('xay dung'));
  expect(await names('100%')).toEqual([]);
  expect(await names('0100000004')).toEqual(['Ngân hàng TMCP Mẫu (giả)']);

  await nv.goto('/#/crm');
  const list = nv.getByTestId('crm-partners');
  await expect(list).toContainText('Ngân hàng TMCP Mẫu (giả)');
  await expect(nv.locator('#crmFilter').getByRole('button', { name: 'Lọc' })).toHaveCount(0);
  // R1: gõ là lọc (không bấm Enter / nút), ô tìm giữ con trỏ.
  const q = nv.getByTestId('crm-q');
  await q.click();
  await q.pressSequentially('xay dung', { delay: 30 });
  await expect(list).toContainText('Công ty CP Xây dựng Mẫu An Phát (giả)');
  await expect(list).toContainText('Sở Xây dựng tỉnh Mẫu (giả)');
  await expect(list).not.toContainText('Ngân hàng TMCP Mẫu (giả)');
  await expect(q).toBeFocused();
  await expect(nv).toHaveURL(/#\/crm\?q=xay\+dung/);
  // Đổi ô chọn: lọc ngay.
  await nv.getByTestId('crm-kind').selectOption('AUTHORITY');
  await expect(list).toContainText('Sở Xây dựng tỉnh Mẫu (giả)');
  await expect(list).not.toContainText('Công ty CP Xây dựng Mẫu An Phát (giả)');
  await expect(nv.getByTestId('crm-count')).toHaveText('1 đối tác');
  // Bộ lọc nằm trên URL: tải lại vẫn giữ.
  await nv.reload();
  await expect(nv.getByTestId('crm-q')).toHaveValue('xay dung');
  await expect(nv.getByTestId('crm-kind')).toHaveValue('AUTHORITY');
  await expect(list).not.toContainText('Công ty CP Xây dựng Mẫu An Phát (giả)');
  // Xoá chữ: hiện lại đủ.
  await nv.getByTestId('crm-kind').selectOption('');
  await nv.getByTestId('crm-q').fill('');
  await expect(list).toContainText('Ngân hàng TMCP Mẫu (giả)');
  await expect(nv.getByTestId('crm-partners-empty')).toHaveCount(0);

  // R6: trang chi tiết đối tác — tiêu đề tab là tên đối tác.
  await list.getByText('Công ty CP Xây dựng Mẫu An Phát (giả)').click();
  await expect(nv).toHaveTitle('Công ty CP Xây dựng Mẫu An Phát (giả) · Kepler Hub');
  await nv.goBack();
  await expect(nv).toHaveTitle('Đối tác · Kepler Hub');
});
