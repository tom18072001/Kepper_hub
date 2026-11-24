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

  // 1) Trang chủ có thẻ Giao ban → "Báo cáo tuần" của bộ phận mình, đã điền sẵn hạng mục MTL; nhân viên không thấy Tổng hợp / Chấm điểm.
  await expect(nv).toHaveURL(/#\/today/);
  await nv.getByTestId('today-weekly').click();
  await expect(nv).toHaveURL(/#\/tuan/);
  await expect(nv.getByTestId('weekly')).toBeVisible();
  await expect(nv.getByTestId('wk-dept-name')).toHaveText('Ban Pháp lý');
  await expect(nv.getByTestId('wk-prefill-note')).toContainText('hạng mục MTL / công việc của bộ phận');
  await expect(nv.getByTestId('wk-tab-tong-hop')).toHaveCount(0);
  await expect(nv.getByTestId('wk-tab-diem')).toHaveCount(0);
  const ctx0 = await (await apiAs(nv, '/api/weekly/context')).json();
  const week = ctx0.week;
  const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
  const rep0 = await (await apiAs(nv, '/api/weekly/report')).json();
  const P0 = rep0.prefill;
  const linked = [...P0.results, ...P0.ongoing, ...P0.risks, ...P0.plans].filter(r => r.itemId);
  expect(linked.length).toBeGreaterThan(0);
  expect(linked.every(r => ['MTL', 'Công việc'].includes(r.source || r.basis))).toBe(true);
  // Báo cáo 3 phần: I chỉ có việc đã xong (dòng tự điền) · II mọi việc đang làm chưa xong · III việc chưa khởi động mà có nguy cơ chậm.
  // Việc chưa bắt đầu (chưa tới kỳ, không có nguy cơ) không có ở I / II / III.
  expect(P0.results.filter(r => r.itemId).every(r => r.status === 'Hoàn thành')).toBe(true);
  expect(P0.ongoing.every(r => r.status !== 'Hoàn thành' && r.status !== 'Chưa bắt đầu')).toBe(true);
  expect(P0.risks.every(r => r.risk && r.status !== 'Hoàn thành')).toBe(true);
  await expect(nv.getByTestId('wk-risk-section')).toBeVisible();
  for (const r of P0.risks) await expect(nv.getByTestId(`wk-riskchip-${r.ref}`)).toBeVisible();
  for (const r of P0.ongoing.filter(x => x.risk)) await expect(nv.getByTestId(`wk-risk-${r.ref}`)).toBeVisible(); // đang làm có nguy cơ: liệt kê ở Phần III

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
  // % của một hạng mục MTL do chính nhân viên này phụ trách (quy định: chỉ người được giao / lãnh đạo bộ phận chủ trì ghi %).
  const me = await (await apiAs(nv, '/api/me')).json();
  const row = [...rep0.prefill.results, ...rep0.prefill.ongoing, ...rep0.prefill.risks].find(r => r.itemId && r.status !== 'Hoàn thành' && !r.pctLocked && r.ownerIds.includes(me.id));
  const newPct = row.pct >= 90 ? 80 : row.pct + 5;
  const pctBox = nv.getByTestId(`wk-pct-${row.ref}`);
  await pctBox.fill(String(newPct)); await pctBox.blur();
  const fillAll = async () => {
    for (const box of await nv.locator('.wk-issue').all()) {
      await box.locator('[data-k="cause"]').fill('Chờ ý kiến cơ quan (giả)');
      await box.locator('[data-k="solution"]').fill('Đôn đốc bằng văn bản (giả)');
      await box.locator('select[data-k="helpFrom"]').selectOption('BGD');
      await box.locator('[data-k="helpWhat"]').fill('Lãnh đạo làm việc trực tiếp (giả)');
      await box.locator('[data-k="helpBy"]').fill(vnDate(4));
    }
    for (const sel of await nv.locator('[data-list] select[data-k="owner"]').all()) if (!(await sel.inputValue())) await sel.selectOption({ index: 1 });
    for (const inp of await nv.locator('[data-list="ongoing"] input[data-k="next"]').all()) if (!(await inp.inputValue())) await inp.fill('Hoàn thiện tờ trình (giả)');
    if (!(await nv.locator('[data-list="plans"]').count())) {
      await nv.getByTestId('wk-add-plans').click();
      const p = nv.locator('[data-list="plans"]').last();
      await p.locator('textarea[data-k="task"]').fill('Rà soát hồ sơ pháp lý (giả)');
      await p.locator('select[data-k="owner"]').selectOption({ index: 1 });
      await p.locator('input[data-k="due"]').fill(vnDate(7));
    }
    for (const inp of await nv.locator('[data-list="plans"] input[data-k="output"]').all()) if (!(await inp.inputValue())) await inp.fill('Biên bản (giả)');
  };
  await fillAll();
  await nv.getByTestId('wk-submit').click();
  // Máy chủ tính lại tình trạng dòng MTL theo % mới: nếu còn khối giải trình mới hiện ra thì điền nốt rồi gửi lại.
  await expect(nv.getByTestId('wk-submitted').or(nv.getByTestId('wk-errors'))).toBeVisible();
  if (await nv.getByTestId('wk-errors').isVisible()) { await fillAll(); await nv.getByTestId('wk-submit').click(); }
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
  // Quy định phân quyền MTL: nhân viên bộ phận khác (dù là thành viên dự án dùng chung) không sửa % / kế hoạch hạng mục của Ban Pháp lý.
  const qx = await (await browser.newContext()).newPage();
  await login(qx, 'nv.qlxd');
  const patch = data => apiAs(qx, `/api/items/${row.itemId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, data });
  expect((await patch({ progress: 99 })).status()).toBe(403);
  expect((await patch({ critical: true })).status()).toBe(403);
  // Rà soát vòng 1 (Chặn): không tự gán mình làm người được giao, không đổi cây / bộ phận chủ trì, không thêm việc con vào hạng mục bộ phận khác.
  const qxMe = await (await apiAs(qx, '/api/me')).json();
  expect((await patch({ assigneeIds: [qxMe.id] })).status()).toBe(403);
  expect((await patch({ leadDepartmentId: qxMe.departmentId })).status()).toBe(403);
  const plItem = await (await apiAs(nv, `/api/items/${row.itemId}`)).json();
  const child = await apiAs(qx, `/api/projects/${plItem.projectId}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, data: { title: 'Việc con giả', parentId: row.itemId, progress: 100, weight: 1000 } });
  expect(child.status()).toBe(403);
  expect((await (await apiAs(nv, `/api/items/${row.itemId}`)).json()).progress).toBe(newPct);
  const admin = await (await browser.newContext()).newPage();
  await login(admin, 'admin');
  expect((await apiAs(admin, '/api/weekly/context')).status()).toBe(403);

  // 7) Báo nộp muộn (Ban Tài chính); báo vắng phải cử người dự thay.
  const tc = await (await browser.newContext()).newPage();
  await login(tc, 'tb.taichinh');
  await tc.getByTestId('nav-tuan').click();
  await expect(tc.getByTestId('wk-dept-name')).toHaveText('Ban Tài chính'); // bộ phận theo tài khoản, không phải chọn
  await expect(tc.getByTestId('wk-preparer')).toContainText('trưởng bộ phận');
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
  await gd.getByTestId('wk-set-secretary').selectOption(String(D('HCNS').id)); // thư ký giao ban = Phòng Hành chính – Nhân sự (giả)
  await gd.getByTestId('wk-set-save').click();
  await toast(gd, 'Đã lưu thiết lập');
  await expect(gd.getByTestId('wk-status-table').locator('tr')).toHaveCount(5);
  await gd.goto('/#/tuan');
  await expect(gd.getByTestId('wk-tab-tong-hop')).toHaveAttribute('aria-selected', 'true');
  await expect(gd.getByTestId('wk-tab-nop')).toHaveCount(0); // Ban giám đốc không lập báo cáo tuần
  expect((await apiAs(gd, '/api/weekly/report')).status()).toBe(422);
  const notif = await (await apiAs(gd, '/api/notifications')).json();
  expect(notif.items.some(n => n.type === 'WEEKLY_NOTICE' && /Ban Tài chính báo nộp báo cáo tuần muộn/.test(n.title))).toBe(true);

  // 9) Tổng hợp: KPI, tình trạng nộp, yêu cầu hỗ trợ gom theo nơi nhận.
  await expect(gd.getByTestId('wk-kpis')).toContainText('1/5');
  await expect(gd.getByTestId('wk-kpis')).toContainText('Đang thực hiện, chưa xong');
  await expect(gd.getByTestId('wk-kpis')).toContainText('Nguy cơ chậm tiến độ');
  await expect(gd.getByTestId(`wk-detail-risk-${D('PL').id}`)).toHaveCount(1); // chi tiết bộ phận: phần III nguy cơ chậm
  await expect(gd.getByTestId(`wk-srow-${D('PL').id}`)).toContainText('Tô Minh Khoa');
  await expect(gd.getByTestId(`wk-srow-${D('TC').id}`)).toContainText('báo muộn');
  await expect(gd.getByTestId('wk-helps')).toContainText('Gửi Ban Giám đốc');
  // 9a) Trước giờ giao ban (tuần hiện tại luôn họp vào thứ Hai SAU tuần đó): ô Điểm danh và nút Phát hành bị khoá, ghi rõ lý do;
  // máy chủ cũng chặn (gọi API thẳng). Cột "Không đạt" vẫn chọn-là-lưu, hiện "Đã lưu ✓" rồi mờ đi.
  await expect(gd.getByTestId(`wk-att-${D('TC').id}`)).toBeDisabled();
  await expect(gd.getByTestId('wk-att-note')).toContainText('điểm danh mở từ 08:30');
  await expect(gd.getByTestId('wk-act-publish')).toBeDisabled();
  await expect(gd.getByTestId('wk-publish-lock')).toContainText('Chưa tới giờ giao ban: nút mở lúc 08:30');
  // Buổi giao ban gần nhất xét tuần TRƯỚC (chưa phát hành): có lối mở thẳng bản tổng hợp tuần đó.
  await expect(gd.getByTestId('wk-prev-meeting-link')).toHaveAttribute('href', `#/tuan/tong-hop?w=${addDays(week, -7)}`);
  const putMeeting = (page, data) => apiAs(page, '/api/weekly/meeting', { method: 'PUT', headers: { 'content-type': 'application/json' }, data });
  for (const data of [{ week, publish: true }, { week, attendance: { [D('TC').id]: 'ABSENT' } }]) {
    const early = await putMeeting(gd, data);
    expect(early.status()).toBe(409);
    expect((await early.json()).code).toBe('MEETING_NOT_STARTED');
  }
  const failedPL = gd.locator(`[data-failed="${D('PL').id}"]`);
  await failedPL.check();
  await expect(gd.getByTestId('wk-att-saved')).toHaveText('Đã lưu ✓');
  await expect(gd.getByTestId('wk-att-saved')).toHaveText('', { timeout: 5000 });
  await failedPL.uncheck();
  await expect(gd.getByTestId('wk-att-saved')).toHaveText('Đã lưu ✓');
  // Kết luận TGĐ và Action Log soạn / lưu trước giờ họp được (chỉ phát hành mới phải đợi).
  const helps = await gd.getByTestId('wk-helpitem').all();
  for (const h of helps.slice(1)) await h.locator('select[data-hk="decision"]').selectOption('APPROVE');
  const help = helps[0];
  await help.locator('select[data-hk="decision"]').selectOption('ASSIGN');
  await help.locator('select[data-hk="departmentId"]').selectOption(String(D('TC').id));
  await expect(help.getByTestId('wk-help-saved')).toHaveText('Đã lưu ✓');
  await help.locator('[data-toact]').click();
  await expect(gd.getByTestId('wk-act-task-0')).not.toHaveValue('');
  await expect(gd.getByTestId('wk-act-dept-0')).toHaveValue(String(D('TC').id));
  await gd.getByTestId('wk-act-owner-0').selectOption({ index: 1 }); // Action Log: Việc · Phụ trách · Hạn (bắt buộc)
  await gd.getByTestId('wk-act-save').click();
  await toast(gd, 'Đã lưu Action Log');
  await expect(gd.getByTestId('wk-act-publish')).toBeDisabled();
  const sum = await (await apiAs(gd, '/api/weekly/summary')).json();
  expect(Object.values(sum.meeting.conclusions).some(c => c.decision === 'ASSIGN' && c.departmentId === D('TC').id)).toBe(true);
  expect(sum.meeting.actions.length).toBe(1);
  expect(sum.publishedAt).toBe(null);

  // 10) Sao chép bản tổng hợp: nút báo "Đã sao chép ✓"; nhãn Bảo mật, không có họ tên người phụ trách; ghi nhật ký.
  await gd.getByTestId('wk-copy').click();
  await expect(gd.locator('#copyMsg')).toContainText(/Đã sao chép ✓|Bôi đen sẵn/);
  if (/Đã sao chép/.test(await gd.locator('#copyMsg').textContent())) await expect(gd.getByTestId('wk-copy')).toHaveText('Đã sao chép ✓');
  const text = await gd.evaluate(() => navigator.clipboard.readText().catch(() => document.querySelector('#copyFallback').value));
  expect(text.startsWith('BẢO MẬT – chỉ dùng nội bộ')).toBe(true);
  expect(text).toContain('Ban Pháp lý →');
  expect(text).not.toContain('Tô Minh Khoa');
  expect(text).not.toContain('I. ĐÃ HOÀN THÀNH'); // bản gửi email = bản tóm tắt (không có danh sách việc xong / đang làm)
  await expect(gd.getByTestId('wk-copy-full')).toBeVisible(); // bản đầy đủ: nút riêng, chỉ dùng nội bộ

  // 10b) Trưởng bộ phận nhận bản TÓM TẮT: không chi tiết bộ phận khác, không họ tên người nộp.
  const tcSum = await (await apiAs(tc, '/api/weekly/summary')).json();
  expect(tcSum.canDetail).toBe(false);
  expect(tcSum.rows.find(x => x.id === D('PL').id).report).toBe(null);
  expect(tcSum.rows.find(x => x.id === D('PL').id).submittedBy).toBe('');
  expect((await apiAs(tc, `/api/weekly/report?departmentId=${D('PL').id}`)).status()).toBe(403);

  // 11) Thư ký (bộ phận thư ký) nhập thay cho bộ phận gửi qua email: giờ nộp = giờ nhận email; không ghi % vào MTL. Ban GĐ không nhập thay.
  const hc = await (await browser.newContext()).newPage();
  await login(hc, 'nv.hcns');
  const gr = (await (await apiAs(hc, '/api/users/directory')).json()).find(u => u.departmentId === D('GR').id);
  const pre = (await (await apiAs(hc, `/api/weekly/report?departmentId=${D('GR').id}`)).json()).prefill;
  for (const x of [...pre.results, ...pre.ongoing, ...pre.risks]) Object.assign(x, { ownerIds: x.ownerIds.length ? x.ownerIds : [gr.id], cause: 'Chờ (giả)', solution: 'Đôn đốc (giả)', helpFrom: 'SELF', next: x.next || 'Tiếp tục (giả)' });
  pre.results.push({ task: 'Làm việc với phường (giả)', source: 'Phát sinh', ownerIds: [gr.id], due: vnDate(5), status: 'Đúng tiến độ', pct: 30 });
  pre.plans.push({ task: 'Họp dân (giả)', basis: 'KH tháng', ownerIds: [gr.id], due: vnDate(8) });
  for (const p of pre.plans) Object.assign(p, { ownerIds: p.ownerIds?.length ? p.ownerIds : [gr.id], output: 'Biên bản (giả)' });
  const received = new Date(Date.now() - 60_000).toISOString();
  const body = { week, departmentId: D('GR').id, receivedAt: received, data: pre };
  expect((await apiAs(gd, '/api/weekly/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, data: body })).status()).toBe(403);
  const r = await apiAs(hc, '/api/weekly/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, data: body });
  expect(r.status()).toBe(200);
  const rj = await r.json();
  expect(rj.firstSubmittedAt).toBe(received); expect(rj.onBehalf).toBe(true); expect(rj.progressUpdated).toBe(0);
  const versions = await (await apiAs(gd, `/api/weekly/report/versions?week=${week}&departmentId=${D('GR').id}`)).json();
  expect(versions.length).toBe(1); expect(versions[0].sha256).toMatch(/^[0-9a-f]{64}$/);

  // 11b) Tuần đã họp xong (hai tuần trước — giờ giao ban chắc chắn đã qua): điểm danh mở; nút phát hành qua bước xác nhận
  // vẽ ngay trên trang (Huỷ thì không phát hành); còn yêu cầu chưa kết luận thì máy chủ chặn; kết luận đủ → phát hành.
  const past = addDays(week, -14);
  const prePast = (await (await apiAs(hc, `/api/weekly/report?week=${past}&departmentId=${D('GR').id}`)).json()).prefill;
  for (const x of [...prePast.results, ...prePast.ongoing, ...prePast.risks]) Object.assign(x, { ownerIds: x.ownerIds.length ? x.ownerIds : [gr.id], cause: 'Chờ (giả)', solution: 'Đôn đốc (giả)', helpFrom: 'SELF', next: x.next || 'Tiếp tục (giả)' });
  prePast.results.push({ task: 'Xin chủ trương GPMB (giả)', source: 'Phát sinh', ownerIds: [gr.id], due: addDays(past, 3), status: 'Vướng', pct: 20,
    cause: 'Chờ ý kiến (giả)', solution: 'Báo cáo Ban GĐ (giả)', helpFrom: 'BGD', helpWhat: 'Ban GĐ làm việc với phường (giả)', helpBy: addDays(past, 7) });
  if (!prePast.plans.length) prePast.plans.push({ task: 'Họp dân (giả)', basis: 'KH tháng', ownerIds: [gr.id], due: addDays(past, 6) });
  for (const p of prePast.plans) Object.assign(p, { ownerIds: p.ownerIds?.length ? p.ownerIds : [gr.id], output: 'Biên bản (giả)' });
  const subPast = await apiAs(hc, '/api/weekly/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, data: { week: past, departmentId: D('GR').id, data: prePast } });
  expect(subPast.status(), await subPast.text()).toBe(200);
  await gd.goto(`/#/tuan/tong-hop?w=${past}`);
  await expect(gd.getByTestId('wk-week')).toHaveValue(past);
  await expect(gd.getByTestId('wk-publish-lock')).toBeHidden();
  await expect(gd.getByTestId('wk-att-note')).toHaveText('chọn là lưu ngay');
  await gd.getByTestId(`wk-att-${D('TC').id}`).selectOption('ABSENT');
  await expect(gd.getByTestId('wk-att-saved')).toHaveText('Đã lưu ✓');
  await gd.getByTestId('wk-act-publish').click();
  await expect(gd.getByTestId('wk-publish-confirm')).toContainText('Phát hành kết luận giao ban và Action Log tuần');
  await expect(gd.getByTestId('wk-publish-missing')).toContainText(/Còn \d+ yêu cầu hỗ trợ chưa có kết luận/);
  await gd.getByTestId('wk-publish-no').click();
  await expect(gd.getByTestId('wk-publish-confirm')).toHaveCount(0);
  await expect(gd.getByTestId('wk-act-publish')).toBeFocused();
  await gd.getByTestId('wk-act-publish').click();
  await gd.getByTestId('wk-publish-yes').click();
  await toast(gd, 'chưa có kết luận của TGĐ'); // TGĐ kết luận TỪNG yêu cầu trước khi phát hành
  const pastHelps = await gd.getByTestId('wk-helpitem').all();
  for (const h of pastHelps.slice(1)) await h.locator('select[data-hk="decision"]').selectOption('APPROVE');
  await pastHelps[0].locator('select[data-hk="decision"]').selectOption('ASSIGN');
  await pastHelps[0].locator('select[data-hk="departmentId"]').selectOption(String(D('TC').id));
  await expect(pastHelps[0].getByTestId('wk-help-saved')).toHaveText('Đã lưu ✓');
  await pastHelps[0].locator('[data-toact]').click();
  await gd.getByTestId('wk-act-owner-0').selectOption({ index: 1 });
  await gd.getByTestId('wk-act-publish').click();
  await expect(gd.getByTestId('wk-publish-missing')).toHaveCount(0);
  await gd.getByTestId('wk-publish-yes').click();
  await toast(gd, 'Đã phát hành kết luận và Action Log');
  await expect(gd.getByTestId('wk-act-publish')).toHaveText('Đã phát hành');
  await expect(gd.getByTestId('wk-act-publish')).toBeDisabled();
  // Action Log vào Phần I báo cáo tuần sau của bộ phận được giao, nguồn "TGĐ giao".
  const tcNext = await (await apiAs(tc, `/api/weekly/report?week=${addDays(past, 7)}`)).json();
  expect(tcNext.prefill.results.some(r => r.source === 'TGĐ giao' && r.actionRef === `${past}:1`)).toBe(true);

  // 12) Chấm điểm tuân thủ tháng: tháng chưa khép thì chưa trình / duyệt; tháng trước: thư ký trình → TGĐ duyệt → khoá.
  await hc.goto('/#/tuan/diem');
  await expect(hc.getByTestId('wk-score').locator('tr')).toHaveCount(5);
  await expect(hc.getByTestId('wk-score-open')).toBeVisible();
  // Bộ phận chưa có trưởng bộ phận (dữ liệu mẫu đều có → giả lập một bộ phận thiếu bằng cách sửa phản hồi API): báo rõ, không để ô trống.
  const isCompliance = url => url.pathname === '/api/weekly/compliance';
  await hc.route(isCompliance, async route => {
    const res = await route.fetch(), j = await res.json();
    j.rows[0].leaders = [];
    await route.fulfill({ response: res, json: j });
  });
  await hc.reload();
  await expect(hc.getByTestId('wk-no-leader')).toContainText('1 bộ phận chưa có trưởng bộ phận');
  await expect(hc.getByTestId('wk-score').getByText('Chưa có trưởng bộ phận')).toHaveCount(1);
  await hc.unroute(isCompliance);
  await expect(hc.getByTestId('wk-score-submit')).toHaveCount(0);
  expect((await apiAs(hc, '/api/weekly/compliance/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, data: { month: week.slice(0, 7) } })).status()).toBe(409);
  // Hai tháng trước: luôn đã khép (tháng liền trước có thể chưa khép vào sáng thứ Hai đầu tháng).
  const prevMonth = new Date(Date.UTC(Number(week.slice(0, 4)), Number(week.slice(5, 7)) - 3, 1)).toISOString().slice(0, 7);
  await hc.goto(`/#/tuan/diem?m=${prevMonth}`);
  await hc.getByTestId('wk-score-submit').click();
  await toast(hc, 'Đã trình TGĐ bảng điểm');
  await gd.goto(`/#/tuan/diem?m=${prevMonth}`);
  await gd.getByTestId('wk-score-approve').click();
  await toast(gd, 'Đã duyệt và khoá bảng điểm');
  await expect(gd.getByTestId('wk-score-state')).toContainText('Đã duyệt');
  // 13) Thư ký = thành viên bộ phận thư ký (theo phòng ban, không cấp quyền riêng): mở thẳng Tổng hợp, có Chấm điểm.
  await hc.goto('/#/tuan');
  await expect(hc.getByTestId('wk-tab-tong-hop')).toHaveAttribute('aria-selected', 'true');
  await expect(hc.getByTestId('wk-tab-diem')).toBeVisible();
  // Thứ tự tab theo tần suất dùng; không còn tab "Tiến độ dự án" (link cũ chuyển sang trang Tiến độ dự án).
  await expect(hc.locator('.wk-tabs a')).toHaveText(['Tổng hợp', 'Nộp báo cáo', 'Chấm điểm', 'Báo muộn / vắng']);
  // Ô chọn tuần: tuần hiện tại đầu danh sách, tuần sau ở cuối.
  const weekOpts = hc.getByTestId('wk-week').locator('option');
  await expect(weekOpts.first()).toHaveAttribute('value', week);
  await expect(weekOpts.first()).toContainText('tuần này');
  await expect(weekOpts.last()).toHaveAttribute('value', addDays(week, 7));
  await expect(weekOpts.last()).toContainText('tuần sau');
  await hc.goto('/#/tuan/tien-do');
  await expect(hc).toHaveURL(/#\/home$/);
  expect((await apiAs(kd, '/api/weekly/compliance')).status()).toBe(403);
  const audit = async action => (await (await apiAs(admin, `/api/admin/audit?action=${action}`)).json()).total;
  expect(await audit('WEEKLY_REPORT_SUBMIT')).toBeGreaterThanOrEqual(2);
  expect(await audit('WEEKLY_SUMMARY_COPY')).toBeGreaterThanOrEqual(1);
  expect(await audit('WEEKLY_MEETING_PUBLISH')).toBe(1);
});

test('21. Mục S10 — việc Giám đốc giao trưởng phòng qua sổ, nhân viên lập báo cáo: hệ thống tự bổ sung, chỉ người được xem thấy', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctxs = [];
  const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
  const as = async u => { const c = await browser.newContext(); ctxs.push(c); const p = await c.newPage(); await login(p, u); return p; };
  const json = async (p, path, init) => { const r = await apiAs(p, path, init); expect(r.status(), await r.text()).toBeLessThan(300); return r.json(); };
  const post = (p, path, data) => json(p, path, { method: 'POST', headers: { 'content-type': 'application/json' }, data });
  const [gd, nv, tp, tc] = [await as('giamdoc'), await as('nv.kythuat'), await as('tp.kythuat'), await as('tb.taichinh')];
  const tpUser = await json(tp, '/api/me'), kt = tpUser.departmentId;
  // Sổ giao việc (mỗi người chỉ thấy việc liên quan đến mình); Giám đốc giao trưởng phòng Kỹ thuật, đã quá hạn, chưa khởi động.
  const reg = await post(gd, '/api/projects', { key: 'SGV', name: 'Sổ giao việc Ban GĐ (giả)', visibility: 'ASSIGNED' });
  const title = 'Đàm phán giá đất lô C (giả)';
  const item = await post(gd, `/api/projects/${reg.id}/items`, { title, assigneeIds: [tpUser.id], leadDepartmentId: kt, dueDate: vnDate(-3) });
  // Nhân viên không xem được việc → biểu mẫu không có.
  expect((await apiAs(nv, `/api/items/${item.id}`)).status()).toBeGreaterThanOrEqual(403);
  const ctx = await json(nv, '/api/weekly/context');
  const rep = await json(nv, '/api/weekly/report');
  const pre = rep.prefill;
  expect(JSON.stringify(pre).includes(title)).toBe(false);
  const me = await json(nv, '/api/me');
  for (const x of [...pre.results, ...pre.ongoing, ...pre.risks]) Object.assign(x, { ownerIds: x.ownerIds.length ? x.ownerIds : [me.id], cause: 'Chờ (giả)', solution: 'Đôn đốc (giả)', helpFrom: 'SELF', next: x.next || 'Tiếp tục (giả)' });
  pre.ongoing.push({ task: 'Kiểm tra hồ sơ kỹ thuật (giả)', source: 'Phát sinh', ownerIds: [me.id], due: vnDate(5), status: 'Đúng tiến độ', pct: 30, next: 'Hoàn thiện (giả)' });
  for (const p of pre.plans) Object.assign(p, { ownerIds: p.ownerIds?.length ? p.ownerIds : [me.id], output: 'Biên bản (giả)' });
  await post(nv, '/api/weekly/submit', { week: ctx.week, data: pre });
  const rowsOf = d => [...d.results, ...d.ongoing, ...d.risks];
  // Ban GĐ (tổng hợp đầy đủ): có việc, nhãn tự bổ sung, ở Phần III (trễ hạn), đếm vào KPI; trưởng phòng (vốn xem được việc) thấy trong báo cáo bộ phận.
  const full = await json(gd, `/api/weekly/summary?week=${ctx.week}`);
  const ktRow = full.rows.find(r => r.id === kt);
  const auto = rowsOf(ktRow.report).find(r => r.itemId === item.id);
  expect(auto.auto).toBe(true); expect(auto.risk).toBe('OVERDUE');
  expect(ktRow.report.risks.some(r => r.itemId === item.id)).toBe(true);
  expect(ktRow.risk).toBeGreaterThanOrEqual(1);
  expect(full.fullText).toContain(`${title} (hệ thống tự bổ sung)`); // bản đầy đủ: chỉ trong Hub, nội bộ Ban GĐ
  // Bản gửi email (nút "Sao chép bản tổng hợp"): không nêu tên dòng tự bổ sung, không có danh sách mục I / II; số liệu vẫn đếm.
  expect(full.text).not.toContain(title);
  expect(full.text).not.toContain('II. ĐANG THỰC HIỆN');
  expect(full.text).toContain(`nguy cơ chậm ${ktRow.risk}`);
  const gdRep = await json(gd, `/api/weekly/report?week=${ctx.week}&departmentId=${kt}`);
  expect(rowsOf(gdRep.report.data).some(r => r.itemId === item.id && r.auto)).toBe(true);
  const tpRep = await json(tp, `/api/weekly/report?week=${ctx.week}`);
  expect(rowsOf(tpRep.report.data).some(r => r.itemId === item.id && r.auto)).toBe(true);
  // Người lập: báo cáo đã nộp của bộ phận mình không có dòng đó.
  const nvRep = await json(nv, `/api/weekly/report?week=${ctx.week}`);
  expect(JSON.stringify(nvRep.report.data).includes(title)).toBe(false);
  // Hồi quy vòng 3: "Gửi lại" của trưởng phòng (xem được việc) và của thư ký (không xem được việc, nhập thay) — dòng tự bổ sung giữ nguyên,
  // một việc một dòng, số liệu không đổi, nhân viên không thấy tên, bản email không nêu tên.
  const base = { ongoing: ktRow.ongoing, risk: ktRow.risk };
  const stable = async label => {
    const sum = await json(gd, `/api/weekly/summary?week=${ctx.week}`);
    const row = sum.rows.find(r => r.id === kt);
    const mine = rowsOf(row.report).filter(r => r.itemId === item.id);
    expect(mine.length, label).toBe(1); expect(mine[0].auto, label).toBe(true);
    expect(rowsOf(row.report).filter(r => !r.itemId && r.task === title).length, label).toBe(0);
    expect({ ongoing: row.ongoing, risk: row.risk }, label).toEqual(base);
    expect(sum.text, label).not.toContain(title);
    expect(JSON.stringify((await json(nv, `/api/weekly/report?week=${ctx.week}`)).report.data).includes(title), label).toBe(false);
  };
  const tpForm = (await json(tp, `/api/weekly/report?week=${ctx.week}`)).report.data;
  expect(rowsOf(tpForm).some(r => r.itemId === item.id)).toBe(true); // trưởng phòng vốn xem được việc
  tpForm.other = 'Trưởng phòng bổ sung (giả)';
  await post(tp, '/api/weekly/submit', { week: ctx.week, data: tpForm });
  await stable('trưởng phòng gửi lại');
  const hc = await as('nv.hcns'); // thư ký giao ban: bộ phận khác, không xem được việc trong sổ
  expect((await apiAs(hc, `/api/items/${item.id}`)).status()).toBeGreaterThanOrEqual(403);
  const secForm = async () => (await json(hc, `/api/weekly/report?week=${ctx.week}&departmentId=${kt}`)).report.data;
  const drop = await secForm();
  for (const k of ['results', 'ongoing', 'risks']) drop[k] = drop[k].filter(r => r.itemId !== item.id);
  await post(hc, '/api/weekly/submit', { week: ctx.week, departmentId: kt, data: drop });
  await stable('thư ký gửi lại — bỏ dòng');
  const filled = await secForm();
  for (const r of rowsOf(filled)) Object.assign(r, { next: r.next || 'Theo dõi (giả)', cause: 'Theo báo cáo (giả)', solution: 'Đôn đốc (giả)', helpFrom: 'SELF' });
  await post(hc, '/api/weekly/submit', { week: ctx.week, departmentId: kt, data: filled });
  await stable('thư ký gửi lại — điền rồi gửi');
  // Vòng 4 — quy tắc gốc: người KHÔNG xem được việc gửi dữ liệu sửa dòng của việc đó (đoán itemId) → bản lưu không đổi, không sinh yêu cầu hỗ trợ.
  const beforeFake = rowsOf((await json(gd, `/api/weekly/report?week=${ctx.week}&departmentId=${kt}`)).report.data).find(r => r.itemId === item.id);
  const nvForm = (await json(nv, `/api/weekly/report?week=${ctx.week}`)).report.data;
  nvForm.risks.push({ key: 'gia', itemId: item.id, task: 'Giả mạo (giả)', status: 'Vướng', cause: 'Nhân viên ghi đè (giả)', solution: 'x', helpFrom: 'BGD', helpWhat: 'Xin hỗ trợ (giả)', helpBy: vnDate(5), ownerIds: [me.id], due: vnDate(5) });
  nvForm.plans.push({ key: 'giap', itemId: item.id, task: 'Giả mạo IV (giả)', basis: 'KH tháng', ownerIds: [me.id], due: vnDate(6), output: 'x' });
  const fakeRes = await post(nv, '/api/weekly/submit', { week: ctx.week, data: nvForm });
  expect(fakeRes.ignored).toBe(2); expect(fakeRes.warning).toContain('không có quyền sửa'); // báo lại, không im lặng
  await stable('nhân viên gửi dòng của việc không xem được');
  const afterFake = await json(gd, `/api/weekly/summary?week=${ctx.week}`);
  const fakeRow = rowsOf(afterFake.rows.find(r => r.id === kt).report).find(r => r.itemId === item.id);
  expect(fakeRow.cause).toBe(beforeFake.cause); expect(fakeRow.status).toBe(beforeFake.status); expect(fakeRow.helpFrom).toBe(beforeFake.helpFrom);
  expect(afterFake.rows.find(r => r.id === kt).report.plans.some(p => p.itemId === item.id)).toBe(false);
  expect(JSON.stringify(afterFake.helps)).not.toContain('Xin hỗ trợ (giả)');
  // Vòng 5 — thư ký (quyền sửa + xem tổng hợp đầy đủ) ghi giải pháp vào chính dòng tự bổ sung → được lưu; dòng vẫn là dòng tự bổ sung.
  const secForm2 = await secForm();
  Object.assign(rowsOf(secForm2).find(r => r.itemId === item.id), { solution: 'Thư ký ghi theo email (giả)', cause: 'Chờ chủ đầu tư (giả)' });
  const secRes = await post(hc, '/api/weekly/submit', { week: ctx.week, departmentId: kt, data: secForm2 });
  expect(secRes.ignored).toBe(0);
  const afterSec = rowsOf((await json(gd, `/api/weekly/report?week=${ctx.week}&departmentId=${kt}`)).report.data).find(r => r.itemId === item.id);
  expect(afterSec.auto).toBe(true); expect(afterSec.solution).toBe('Thư ký ghi theo email (giả)');
  await stable('thư ký ghi giải trình vào dòng tự bổ sung');
  // Vòng 5 — nộp kiểm xung đột như lưu nháp: nhân viên mở trang, trưởng phòng gửi lại, nhân viên nộp bằng bản cũ → 409.
  const nvOld = (await json(nv, `/api/weekly/report?week=${ctx.week}`)).report;
  const tpNow = (await json(tp, `/api/weekly/report?week=${ctx.week}`)).report;
  tpNow.data.other = 'Trưởng phòng vừa sửa (giả)';
  await post(tp, '/api/weekly/submit', { week: ctx.week, data: tpNow.data, baseUpdatedAt: tpNow.updatedAt });
  const late = await apiAs(nv, '/api/weekly/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, data: { week: ctx.week, data: nvOld.data, baseUpdatedAt: nvOld.updatedAt } });
  expect(late.status()).toBe(409); expect((await late.json()).code).toBe('REPORT_CONFLICT');
  expect((await json(gd, `/api/weekly/report?week=${ctx.week}&departmentId=${kt}`)).report.data.other).toBe('Trưởng phòng vừa sửa (giả)');
  // Vòng 6 — mục 4: nhân viên mở trang khi CHƯA có báo cáo (tuần cũ), trưởng phòng lưu nháp, nhân viên nộp với baseUpdatedAt = null → 409.
  const w0 = addDays(ctx.week, -21);
  const nvW0 = await json(nv, `/api/weekly/report?week=${w0}`);
  expect(nvW0.report).toBe(null);
  const tpW0 = (await json(tp, `/api/weekly/report?week=${w0}`)).prefill;
  tpW0.other = 'Trưởng phòng lưu trước (giả)';
  await json(tp, '/api/weekly/report', { method: 'PUT', headers: { 'content-type': 'application/json' }, data: { week: w0, data: tpW0, baseUpdatedAt: null } });
  const nullBase = await apiAs(nv, '/api/weekly/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, data: { week: w0, data: nvW0.prefill, baseUpdatedAt: null } });
  expect(nullBase.status()).toBe(409); expect((await nullBase.json()).code).toBe('REPORT_CONFLICT');
  // Vòng 6 — mục 8: thư ký nhận cờ noDelete cho dòng của việc mình không xem được (giao diện ẩn nút "Bỏ").
  const secView = (await json(hc, `/api/weekly/report?week=${ctx.week}&departmentId=${kt}`)).report.data;
  expect(rowsOf(secView).find(r => r.itemId === item.id).noDelete).toBe(true);
  // Vòng 4 — bản NHÁP hai người cùng sửa (tuần sau): trưởng phòng nháp có dòng việc trong sổ (Vướng + giải pháp) và Phần IV gắn việc đó;
  // nhân viên (không xem được việc) tự lưu → dòng và Phần IV của trưởng phòng giữ NGUYÊN.
  const w2 = addDays(ctx.week, 7);
  const tpRep2 = await json(tp, `/api/weekly/report?week=${w2}`);
  const tpDraft = tpRep2.prefill;
  const tpRow = rowsOf(tpDraft).find(r => r.itemId === item.id);
  expect(tpRow).toBeTruthy();
  Object.assign(tpRow, { status: 'Vướng', cause: 'Chờ chủ đất (giả)', solution: 'Họp lại thứ Hai (giả)', helpFrom: 'SELF' });
  tpDraft.plans.push({ key: 'tp-iv', itemId: item.id, task: title, basis: 'Công việc', ownerIds: [tpUser.id], due: addDays(w2, 5), output: 'Biên bản (giả)' });
  const tpSaved = await json(tp, '/api/weekly/report', { method: 'PUT', headers: { 'content-type': 'application/json' }, data: { week: w2, data: tpDraft, baseUpdatedAt: null } });
  const nvRep2 = await json(nv, `/api/weekly/report?week=${w2}`);
  expect(JSON.stringify(nvRep2.report.data).includes(title)).toBe(false); // nhân viên không thấy
  nvRep2.report.data.other = 'Nhân viên tự lưu (giả)';
  await json(nv, '/api/weekly/report', { method: 'PUT', headers: { 'content-type': 'application/json' }, data: { week: w2, data: nvRep2.report.data, baseUpdatedAt: nvRep2.report.updatedAt } });
  const tpAgain = (await json(tp, `/api/weekly/report?week=${w2}`)).report.data;
  const kept = rowsOf(tpAgain).find(r => r.itemId === item.id);
  expect(kept.status).toBe('Vướng'); expect(kept.solution).toBe('Họp lại thứ Hai (giả)');
  expect(tpAgain.plans.some(p => p.itemId === item.id)).toBe(true);
  expect(tpAgain.other).toBe('Nhân viên tự lưu (giả)');
  expect(tpSaved.ok).toBe(true);
  // Trưởng phòng Kỹ thuật (vốn xem được việc) thấy dòng trên trang Tổng hợp; số liệu giống Ban GĐ.
  const tpSum = await json(tp, `/api/weekly/summary?week=${ctx.week}`);
  expect(rowsOf(tpSum.rows.find(r => r.id === kt).report).some(r => r.itemId === item.id)).toBe(true);
  expect({ ongoing: tpSum.rows.find(r => r.id === kt).ongoing, risk: tpSum.rows.find(r => r.id === kt).risk }).toEqual(base);
  expect(tpSum.text).not.toContain(title);
  // Bản tóm tắt (trưởng phòng Kỹ thuật, trưởng ban Tài chính): trưởng ban Tài chính không có việc, kể cả trường text (MCP kepper_weekly_summary dùng chung).
  for (const p of [tc]) {
    const brief = await json(p, `/api/weekly/summary?week=${ctx.week}`);
    expect(JSON.stringify(brief).includes(title)).toBe(false);
    expect(brief.text.includes('tự bổ sung')).toBe(false);
    expect(brief.fullText).toBeUndefined();
  }
  // Giao diện Ban GĐ: chi tiết bộ phận có nhãn "Hệ thống tự bổ sung".
  await gd.goto(`/#/tuan/tong-hop?w=${ctx.week}`);
  await gd.getByTestId(`wk-detail-${kt}`).locator('summary').click();
  await expect(gd.getByTestId(`wk-detail-${kt}`).getByTestId(`wk-auto-${item.code}`)).toContainText('Hệ thống tự bổ sung');
  for (const c of ctxs) await c.close();
});
