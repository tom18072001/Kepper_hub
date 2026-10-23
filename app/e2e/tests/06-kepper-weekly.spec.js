// Kepper GĐ2b — Báo cáo tuần theo QC-TH-01 / QT-TH-01 / BM-TH-01 (dữ liệu GIẢ của dự án mẫu DA):
// trang chủ "Báo cáo tuần" điền sẵn từ MTL, tự lưu nháp, kiểm tra Chậm / Vướng / Quá hạn, gửi → % ghi ngược vào MTL;
// báo nộp muộn / vắng; Tổng hợp giao ban (điểm danh, kết luận TGĐ, Action Log → báo cáo tuần sau), sao chép không có họ tên;
// chấm điểm tuân thủ; thư ký nhập thay theo giờ email; phân quyền.
const { test, expect } = require('@playwright/test');
const { login, apiAs, toast, vnDate } = require('./helpers');

test.describe.configure({ mode: 'serial' });

test('20. Báo cáo tuần: điền sẵn từ MTL, nộp, báo muộn / vắng, tổng hợp giao ban, Action Log, chấm điểm, phân quyền', async ({ browser }) => {
  test.setTimeout(240_000);
  const nv = await (await browser.newContext()).newPage();
  await login(nv, 'nv.phaply');

  // 1) Trang chủ = "Báo cáo tuần" của bộ phận mình, đã điền sẵn hạng mục MTL; nhân viên không thấy Tổng hợp / Chấm điểm.
  await expect(nv).toHaveURL(/#\/tuan/);
  await expect(nv.getByTestId('weekly')).toBeVisible();
  await expect(nv.getByTestId('wk-dept-name')).toHaveText('Ban Pháp lý');
  await expect(nv.getByTestId('wk-prefill-note')).toContainText('hạng mục MTL của bộ phận');
  await expect(nv.getByTestId('wk-tab-tong-hop')).toHaveCount(0);
  await expect(nv.getByTestId('wk-tab-diem')).toHaveCount(0);
  const ctx0 = await (await apiAs(nv, '/api/weekly/context')).json();
  const week = ctx0.week;
  const rep0 = await (await apiAs(nv, '/api/weekly/report')).json();
  const linked = [...rep0.prefill.results, ...rep0.prefill.ongoing, ...rep0.prefill.plans].filter(r => r.itemId);
  expect(linked.length).toBeGreaterThan(0);
  expect(linked.every(r => r.source === 'MTL' || r.basis === 'MTL')).toBe(true);

  // 2) Thêm việc phát sinh "Vướng" → hiện khối nguyên nhân / giải pháp / đề nghị hỗ trợ.
  await nv.getByTestId('wk-add-results').click();
  const fresh = nv.locator('[data-list="results"]').last();
  await fresh.locator('textarea[data-k="task"]').fill('Xin ý kiến Sở Xây dựng (giả)');
  await fresh.locator('select[data-k="owner"]').selectOption({ index: 1 });
  await fresh.locator('input[data-k="due"]').fill(vnDate(3));
  await fresh.locator('select[data-k="status"]').selectOption('Vướng');
  await expect(nv.locator('[data-list="results"]').last().locator('.wk-issue')).toContainText('Vướng: nêu nguyên nhân');

  // 3) Tự lưu nháp: tải lại trang vẫn còn.
  await nv.getByTestId('wk-other').fill('Đề nghị bố trí phòng họp (giả)');
  await expect(nv.getByTestId('wk-save-msg')).toContainText('Bản nháp lưu lúc');
  await nv.reload();
  await expect(nv.getByTestId('wk-other')).toHaveValue('Đề nghị bố trí phòng họp (giả)');
  await expect(nv.locator('[data-list="results"] textarea[data-k="task"]').last()).toHaveValue('Xin ý kiến Sở Xây dựng (giả)');

  // 4) Gửi khi thiếu giải trình → máy chủ từ chối, liệt kê từng mục thiếu.
  await nv.getByTestId('wk-submit').click();
  await expect(nv.getByTestId('wk-errors')).toContainText('Xin ý kiến Sở Xây dựng (giả)” (Vướng): thiếu nguyên nhân');

  // 5) Điền đủ: mọi khối Chậm / Vướng / Quá hạn, việc sẽ làm tuần tới, một kế hoạch tuần mới; đổi % một hạng mục MTL.
  for (const box of await nv.locator('.wk-issue').all()) {
    await box.locator('[data-k="cause"]').fill('Chờ ý kiến cơ quan (giả)');
    await box.locator('[data-k="solution"]').fill('Đôn đốc bằng văn bản (giả)');
    await box.locator('select[data-k="helpFrom"]').selectOption('BGD');
    await box.locator('[data-k="helpWhat"]').fill('Lãnh đạo làm việc trực tiếp (giả)');
  }
  for (const inp of await nv.locator('[data-list="ongoing"] input[data-k="next"]').all()) if (!(await inp.inputValue())) await inp.fill('Hoàn thiện tờ trình (giả)');
  if (!(await nv.locator('[data-list="plans"]').count())) {
    await nv.getByTestId('wk-add-plans').click();
    const p = nv.locator('[data-list="plans"]').last();
    await p.locator('textarea[data-k="task"]').fill('Rà soát hồ sơ pháp lý (giả)');
    await p.locator('select[data-k="owner"]').selectOption({ index: 1 });
    await p.locator('input[data-k="due"]').fill(vnDate(7));
  }
  const pctBox = nv.locator('.wk-row.linked:not(.done) input[data-k="pct"]').first();
  const pctId = (await pctBox.getAttribute('data-testid')).replace('wk-pct-', '');
  const row = [...rep0.prefill.results, ...rep0.prefill.ongoing].find(r => r.ref === pctId);
  const newPct = row.pct >= 90 ? 80 : row.pct + 5;
  await pctBox.fill(String(newPct)); await pctBox.blur();
  await nv.getByTestId('wk-submit').click();
  await toast(nv, 'Đã gửi báo cáo');
  await expect(nv.getByTestId('wk-submitted')).toContainText('Đã nộp');
  await expect(nv.getByTestId('wk-submit')).toHaveText('Gửi lại');
  const item = await (await apiAs(nv, `/api/items/${row.itemId}`)).json();
  expect(item.progress).toBe(newPct); // % trong báo cáo đã ghi vào MTL

  // 6) Phân quyền: nhân viên bộ phận khác không xem báo cáo Ban Pháp lý, không xem Tổng hợp; admin IT không vào được.
  const kd = await (await browser.newContext()).newPage();
  await login(kd, 'nv.kinhdoanh1');
  expect((await apiAs(kd, `/api/weekly/report?departmentId=${rep0.department.id}`)).status()).toBe(403);
  expect((await apiAs(kd, '/api/weekly/summary')).status()).toBe(403);
  const admin = await (await browser.newContext()).newPage();
  await login(admin, 'admin');
  expect((await apiAs(admin, '/api/weekly/context')).status()).toBe(403);

  // 7) Báo nộp muộn (Ban Tài chính); báo vắng phải cử người dự thay.
  const tc = await (await browser.newContext()).newPage();
  await login(tc, 'tb.taichinh');
  await tc.getByTestId('wk-tab-bao').click();
  await tc.getByTestId('wk-n-reason').selectOption('CONG_TAC');
  await tc.getByTestId('wk-n-send').click();
  await toast(tc, 'Đã gửi thông báo');
  await expect(tc.getByTestId('wk-n-list')).toContainText('Ban Tài chính');
  await tc.getByTestId('wk-n-type').selectOption('ABSENT');
  await tc.getByTestId('wk-n-reason').selectOption('NGHI_PHEP');
  await tc.getByTestId('wk-n-send').click();
  await expect(tc.locator('#nErrs')).toContainText('Cử cấp phó');

  // 8) Ban GĐ: thiết lập 5 bộ phận phải nộp (bỏ Ban Giám đốc, Phòng Kinh doanh) → trang chủ mở thẳng Tổng hợp.
  const gd = await (await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })).newPage();
  await login(gd, 'giamdoc');
  const depts = await (await apiAs(gd, '/api/departments')).json();
  const D = code => depts.find(d => d.code === code);
  await gd.goto('/#/tuan/tong-hop');
  await gd.getByTestId('wk-setup').locator('summary').click();
  await gd.getByTestId(`wk-set-dept-${D('BGD').id}`).uncheck();
  await gd.getByTestId(`wk-set-dept-${D('KD').id}`).uncheck();
  await gd.getByTestId('wk-set-save').click();
  await toast(gd, 'Đã lưu thiết lập');
  await expect(gd.getByTestId('wk-status-table').locator('tr')).toHaveCount(5);
  await gd.goto('/#/tuan');
  await expect(gd.getByTestId('wk-tab-tong-hop')).toHaveAttribute('aria-selected', 'true');
  const notif = await (await apiAs(gd, '/api/notifications')).json();
  expect(notif.items.some(n => n.type === 'WEEKLY_NOTICE' && /Ban Tài chính báo nộp báo cáo tuần muộn/.test(n.title))).toBe(true);

  // 9) Tổng hợp: KPI, tình trạng nộp, yêu cầu hỗ trợ gom theo nơi nhận; điểm danh; kết luận TGĐ → Action Log → phát hành.
  await expect(gd.getByTestId('wk-kpis')).toContainText('1/5');
  await expect(gd.getByTestId(`wk-srow-${D('PL').id}`)).toContainText('Tô Minh Khoa');
  await expect(gd.getByTestId(`wk-srow-${D('TC').id}`)).toContainText('báo muộn');
  await expect(gd.getByTestId('wk-helps')).toContainText('Gửi Ban Giám đốc');
  await gd.getByTestId(`wk-att-${D('TC').id}`).selectOption('ABSENT');
  await toast(gd, 'Đã ghi điểm danh');
  const help = gd.getByTestId('wk-helpitem').first();
  await help.locator('select[data-hk="decision"]').selectOption('ASSIGN');
  await help.locator('select[data-hk="departmentId"]').selectOption(String(D('TC').id));
  await toast(gd, 'Đã lưu kết luận');
  await help.locator('[data-toact]').click();
  await expect(gd.getByTestId('wk-act-task-0')).not.toHaveValue('');
  await expect(gd.getByTestId('wk-act-dept-0')).toHaveValue(String(D('TC').id));
  await gd.getByTestId('wk-act-publish').click();
  await toast(gd, 'Đã phát hành kết luận và Action Log');
  await expect(gd.getByTestId('wk-act-publish')).toBeDisabled();
  // Action Log vào Phần I báo cáo tuần sau của bộ phận được giao, nguồn "TGĐ giao".
  const next = new Date(Date.parse(week + 'T00:00:00Z') + 7 * 86_400_000).toISOString().slice(0, 10);
  const tcNext = await (await apiAs(tc, `/api/weekly/report?week=${next}`)).json();
  expect(tcNext.prefill.results.some(r => r.source === 'TGĐ giao' && r.actionRef === `${week}:1`)).toBe(true);
  const sum = await (await apiAs(gd, '/api/weekly/summary')).json();
  expect(Object.values(sum.meeting.conclusions)[0].decision).toBe('ASSIGN');

  // 10) Sao chép bản tổng hợp: nhãn Bảo mật, không có họ tên người phụ trách; ghi nhật ký.
  await gd.getByTestId('wk-copy').click();
  await expect(gd.locator('#copyMsg')).toContainText(/Đã sao chép|Bôi đen sẵn/);
  const text = await gd.evaluate(() => navigator.clipboard.readText().catch(() => document.querySelector('#copyFallback').value));
  expect(text.startsWith('BẢO MẬT – chỉ dùng nội bộ')).toBe(true);
  expect(text).toContain('Ban Pháp lý →');
  expect(text).not.toContain('Tô Minh Khoa');

  // 11) Thư ký nhập thay cho bộ phận gửi qua email: giờ nộp = giờ nhận email.
  const gr = (await (await apiAs(gd, '/api/users/directory')).json()).find(u => u.departmentId === D('GR').id);
  const received = new Date(Date.now() - 60_000).toISOString();
  const r = await apiAs(gd, '/api/weekly/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, data: { week, departmentId: D('GR').id, receivedAt: received,
    data: { results: [{ task: 'Làm việc với phường (giả)', source: 'Phát sinh', ownerIds: [gr.id], due: vnDate(5), status: 'Đúng tiến độ', pct: 30 }], ongoing: [], plans: [{ task: 'Họp dân (giả)', basis: 'KH tháng', ownerIds: [gr.id], due: vnDate(8) }], other: '' } } });
  expect(r.status()).toBe(200);
  expect((await r.json()).firstSubmittedAt).toBe(received);

  // 12) Chấm điểm tuân thủ tháng: 5 bộ phận, mỗi bộ phận tối đa 100 điểm.
  await gd.reload();
  await gd.getByTestId('wk-tab-diem').click();
  await expect(gd.getByTestId('wk-score').locator('tr')).toHaveCount(5);
  const audit = async action => (await (await apiAs(admin, `/api/admin/audit?action=${action}`)).json()).total;
  expect(await audit('WEEKLY_REPORT_SUBMIT')).toBeGreaterThanOrEqual(2);
  expect(await audit('WEEKLY_SUMMARY_COPY')).toBeGreaterThanOrEqual(1);
  expect(await audit('WEEKLY_MEETING_PUBLISH')).toBe(1);
});
