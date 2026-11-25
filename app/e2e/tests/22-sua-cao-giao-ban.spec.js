// Sửa ba lỗi mức Cao nhóm giao ban / báo cáo tuần (đề xuất C1–C3). Dữ liệu mẫu GIẢ.
//  - Lỗi 10: ba ô lịch trong khối Thiết lập ghi đúng TUẦN ĐANG CHỌN (không ghi "tuần này"), đổi tuần ở đầu trang thì nhãn đổi theo;
//    tuần đã qua hạn nộp: hỏi lại trước khi lưu (nói hệ quả với điểm tuân thủ), Huỷ thì không lưu gì.
//  - Lỗi 11: đổi lịch tuần → lãnh đạo bộ phận phải nộp nhận thông báo mở đúng tuần; lưu lại y nguyên thì không gửi.
//  - Lỗi 12: "Duyệt và khoá" hỏi lại; "Mở khoá" (chỉ Ban TGĐ) bắt buộc lý do; trình / duyệt / mở khoá đều có thông báo; vai khác bị chặn.
// Chạy SAU 01–21 trên cùng CSDL (06 đã đổi thiết lập giao ban, duyệt bảng điểm hai tháng trước; 18 thêm một thành viên Ban TGĐ):
// không giả định dữ liệu seed còn nguyên. Mọi thiết lập dùng chung bị đổi (thiết lập giao ban, lịch hai tuần, trạng thái bảng điểm)
// được khôi phục ở test.afterAll. Tuần lấy từ máy chủ (/api/weekly/context): tuần sau luôn chưa tới hạn nộp, tuần trước luôn đã qua.
const { test, expect, login, apiAs, toast, sharedPage, closeSharedPages } = require('./helpers');

test.describe.configure({ mode: 'serial' });

const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const fmtD = s => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const wd = s => ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(s + 'T00:00:00Z').getUTCDay()];
const weekText = S => `${fmtD(S.from)} – ${fmtD(S.to)}/${S.to.slice(0, 4)}`; // như ô "Tuần báo cáo (thứ Sáu)"
const monthText = ym => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
// Lãnh đạo bộ phận trong dữ liệu mẫu (đăng nhập được bằng mật khẩu mặc định của helpers.login).
const SEED_LEADERS = ['tb.taichinh', 'tb.phaply', 'tb.thietke', 'tb.qlxd', 'tb.doingoai', 'tp.kinhdoanh', 'tp.kythuat'];

const pages = {};
async function as(browser, username) {
  if (pages[username]) return pages[username];
  const page = await sharedPage(browser);
  await login(page, username);
  return (pages[username] = page);
}
async function json(r, status = 200) { const t = await r.text(); expect(r.status(), t).toBe(status); return t ? JSON.parse(t) : null; }
const put = (page, path, data) => apiAs(page, path, { method: 'PUT', data });
const post = (page, path, data) => apiAs(page, path, { method: 'POST', data });
const summaryOf = async (page, week) => json(await apiAs(page, `/api/weekly/summary?week=${week}`));
const notifs = async page => (await json(await apiAs(page, '/api/notifications'))).items;
const lastId = async page => Math.max(0, ...(await notifs(page)).map(n => n.id));
const newSince = async (page, id, type) => (await notifs(page)).filter(n => n.id > id && n.type === type);

let ctx = null, dir = [], leader = null;
const restore = []; // khôi phục ngược thứ tự ở afterAll (mỗi mục đặt TRƯỚC khi đổi dữ liệu dùng chung)

test.beforeAll(async ({ browser }) => {
  const gd = await as(browser, 'giamdoc');
  ctx = await json(await apiAs(gd, '/api/weekly/context'));
  dir = await json(await apiAs(gd, '/api/users/directory'));
  // "Lưu thiết lập" lưu cả thiết lập chung (bộ phận phải nộp, tuần bắt đầu, thư ký, PMO); test 2 đặt bộ phận thư ký → trả lại như cũ.
  const cfg = { departments: ctx.configured ? ctx.required : [], startWeek: ctx.startWeek, secretaryDepartmentId: ctx.secretaryDepartmentId, pmoUserIds: ctx.pmoUserIds };
  restore.push(() => put(gd, '/api/weekly/config', cfg));
  // Một lãnh đạo bộ phận phải nộp (nhận thông báo đổi lịch, thông báo bảng điểm đã duyệt).
  leader = SEED_LEADERS.map(n => dir.find(u => u.username === n)).find(u => u && u.role === 'manager' && ctx.required.includes(u.departmentId));
  expect(leader, 'cần một lãnh đạo bộ phận phải nộp trong dữ liệu mẫu').toBeTruthy();
});
test.afterAll(async () => {
  try {
    for (const fn of restore.reverse()) {
      const r = await fn().catch(e => e);
      if (r instanceof Error || (r?.status && r.status() >= 400)) console.error('22-sua-cao-giao-ban: khôi phục không được —', r instanceof Error ? r.message : await r.text());
    }
  } finally { await closeSharedPages(); }
});

test('Lỗi 10, 11 — ba ô lịch ghi đúng tuần đang chọn; tuần đã qua hạn nộp hỏi lại, Huỷ không lưu; đổi lịch báo lãnh đạo bộ phận', async ({ browser }) => {
  test.setTimeout(180_000);
  const gd = await as(browser, 'giamdoc');
  const next = addDays(ctx.week, 7), past = addDays(ctx.week, -7);
  expect(ctx.weeks).toEqual(expect.arrayContaining([next, past]));
  const S = {};
  for (const w of [next, past]) {
    const s = await summaryOf(gd, w);
    S[w] = s.schedule;
    const orig = { skip: !!s.meeting?.skip, deadlineDay: s.meeting?.deadlineDay || null, meetingDay: s.meeting?.meetingDay || null };
    restore.push(() => put(gd, '/api/weekly/meeting', { week: w, ...orig }));
  }
  const curSkip = (await summaryOf(gd, ctx.week)).schedule.skip;
  const setup = gd.getByTestId('wk-setup'), sched = gd.getByTestId('wk-set-sched'), head = gd.getByTestId('wk-set-sched-head');
  // Nhãn của từng ô lịch (thẻ <label> bọc ô).
  const label = id => gd.getByTestId(id).locator('xpath=ancestor::label[1]');
  // Khối Thiết lập đóng sẵn mỗi lần trang vẽ (cả sau "Lưu thiết lập"): đợi bản vẽ mới (đang đóng) rồi mở.
  const openSetup = async () => { await expect.poll(() => setup.evaluate(d => d.open)).toBe(false); await setup.locator('summary').click(); await expect(gd.getByTestId('wk-set-skip')).toBeVisible(); };

  // 1) Tuần sau: nhãn ba ô lịch và tiêu đề khối ghi đúng tuần đó — không còn "tuần này".
  const W = weekText(S[next]);
  await gd.goto(`/#/tuan/tong-hop?w=${next}`);
  await expect(gd.getByTestId('wk-week')).toHaveValue(next);
  await openSetup();
  await expect(label('wk-set-skip')).toHaveText(`Tuần ${W} nghỉ (Tết, lễ) — không giao ban, không chấm điểm`);
  await expect(label('wk-set-deadline')).toHaveText(`Hạn nộp tuần ${W} (nghỉ lễ thứ Sáu → ngày làm việc liền trước)`);
  await expect(label('wk-set-meeting')).toHaveText(`Ngày giao ban của tuần ${W} (nghỉ lễ thứ Hai → ngày làm việc kế tiếp)`);
  await expect(head).toHaveText(`Lịch tuần ${W}`);
  await expect(setup).not.toContainText(/tuần này/i);
  await expect(sched).not.toContainText('đã qua hạn nộp');
  await expect(gd.getByTestId('wk-set-note')).toContainText('Kepler Hub tự báo lãnh đạo các bộ phận phải nộp');

  // 2) Lỗi 11: dời hạn nộp tuần sau (chưa tới hạn → không hỏi lại) → lãnh đạo bộ phận phải nộp nhận thông báo mở đúng tuần.
  const ld = await as(browser, leader.username);
  const since = await lastId(ld);
  const dl = S[next].deadlineDay === addDays(next, -1) ? addDays(next, -2) : addDays(next, -1); // khác hạn đang có
  await gd.getByTestId('wk-set-deadline').fill(dl);
  let saved = gd.waitForResponse(r => r.url().endsWith('/api/weekly/meeting') && r.request().method() === 'PUT');
  await gd.getByTestId('wk-set-save').click();
  const r1 = await (await saved).json();
  await expect(gd.locator('#modalRoot')).toBeHidden();
  expect(r1.notified).toBeGreaterThan(0);
  await toast(gd, `Đã lưu thiết lập — đã báo lịch mới tới ${r1.notified} người`);
  expect((await summaryOf(gd, next)).schedule.deadlineDay).toBe(dl);
  const got = await newSince(ld, since, 'WEEKLY_SCHEDULE');
  const md = S[next].meetingDay, old = S[next].deadlineDay;
  expect(got.map(n => [n.title, n.body, n.link])).toEqual([[`Lịch giao ban tuần ${W}: hạn nộp 17:30 ${wd(dl)} ${fmtD(dl)}, giao ban 08:30 ${wd(md)} ${fmtD(md)}`,
    `Lịch cũ: hạn nộp 17:30 ${wd(old)} ${fmtD(old)}, giao ban 08:30 ${wd(md)} ${fmtD(md)}.`, `#/tuan?w=${next}`]]);
  await ld.goto('/' + got[0].link); // liên kết mở đúng tuần trên trang Báo cáo tuần
  await expect(ld.getByTestId('wk-week')).toHaveValue(next);
  // Lưu lại y nguyên: không gửi thông báo nào.
  await openSetup();
  await expect(gd.getByTestId('wk-set-deadline')).toHaveValue(dl);
  saved = gd.waitForResponse(r => r.url().endsWith('/api/weekly/meeting') && r.request().method() === 'PUT');
  await gd.getByTestId('wk-set-save').click();
  expect((await (await saved).json()).notified).toBe(0);
  expect(await newSince(ld, since, 'WEEKLY_SCHEDULE')).toHaveLength(1);

  // 3) Đổi tuần ở ô "Tuần báo cáo (thứ Sáu)" sang tuần trước → nhãn đổi theo; tuần đã qua hạn nộp ghi rõ.
  const Wp = weekText(S[past]);
  await gd.getByTestId('wk-week').selectOption(past);
  await expect(gd).toHaveURL(new RegExp(`w=${past}`));
  // Đợi trang vẽ lại cho tuần trước (nhãn có trong trang cả khi khối đang đóng) rồi mới mở khối.
  await expect(label('wk-set-skip')).toHaveText(`Tuần ${Wp} nghỉ (Tết, lễ) — không giao ban, không chấm điểm`);
  await openSetup();
  await expect(label('wk-set-deadline')).toHaveText(`Hạn nộp tuần ${Wp} (nghỉ lễ thứ Sáu → ngày làm việc liền trước)`);
  await expect(head).toHaveText(`Lịch tuần ${Wp}`);
  await expect(sched).toContainText('đã qua hạn nộp');

  // 4) Tuần đã qua hạn nộp: hỏi lại, nói hệ quả; Huỷ → không lưu gì (cả thiết lập chung).
  const writes = [];
  const onReq = r => { if (r.method() === 'PUT' && /\/api\/weekly\/(meeting|config)$/.test(r.url())) writes.push(r.url()); };
  gd.on('request', onReq);
  await gd.getByTestId('wk-set-skip').setChecked(!S[past].skip);
  await gd.getByTestId('wk-set-save').click();
  const modal = gd.locator('#modal');
  await expect(modal).toContainText(`Tuần ${Wp} đã qua hạn nộp`);
  await expect(modal).toContainText(`Đổi lịch tuần đã qua hạn nộp sẽ đổi điểm tuân thủ tháng ${monthText(past)}`);
  await gd.getByTestId('confirm-cancel').click();
  await expect(gd.locator('#modalRoot')).toBeHidden();
  expect(writes).toEqual([]);
  expect((await summaryOf(gd, past)).schedule.skip).toBe(S[past].skip);

  // 5) Đồng ý → lưu đúng tuần đang chọn; trả lại như cũ (lại hỏi, đồng ý).
  await gd.getByTestId('wk-set-save').click();
  await expect(modal).toContainText('Đổi lịch tuần đã qua hạn nộp');
  await gd.getByTestId('confirm-ok').click();
  await expect.poll(async () => (await summaryOf(gd, past)).schedule.skip).toBe(!S[past].skip);
  expect((await summaryOf(gd, ctx.week)).schedule.skip).toBe(curSkip); // tuần này không bị đánh dấu nhầm
  await expect(gd.getByTestId('wk-week')).toHaveValue(past);
  await openSetup();
  await gd.getByTestId('wk-set-skip').setChecked(S[past].skip);
  await gd.getByTestId('wk-set-save').click();
  await gd.getByTestId('confirm-ok').click();
  await expect.poll(async () => (await summaryOf(gd, past)).schedule.skip).toBe(S[past].skip);
  gd.off('request', onReq);
});

test('Lỗi 12 — "Duyệt và khoá" hỏi lại; "Mở khoá" chỉ Ban TGĐ, bắt buộc lý do; trình / duyệt / mở khoá có thông báo', async ({ browser }) => {
  test.setTimeout(180_000);
  const gd = await as(browser, 'giamdoc');
  // Thư ký giao ban = bộ phận của nv.hcns (06 đã chọn; chạy riêng tệp này thì tự chọn, afterAll trả lại).
  const hcUser = dir.find(u => u.username === 'nv.hcns');
  if (ctx.secretaryDepartmentId !== hcUser.departmentId) await json(await put(gd, '/api/weekly/config', { secretaryDepartmentId: hcUser.departmentId }));
  const hc = await as(browser, 'nv.hcns');
  // Tháng đã khép chắc chắn, không đụng bảng điểm 06 duyệt (hai tháng trước): ba tháng trước tháng của tuần hiện tại.
  // (Tháng liền trước có thể chưa khép vào sáng thứ Hai đầu tháng — trước buổi giao ban xét thứ Sáu cuối tháng.)
  const [y, m] = ctx.week.split('-').map(Number);
  const month = new Date(Date.UTC(y, m - 1 - 3, 1)).toISOString().slice(0, 7), M = monthText(month), link = `#/tuan/diem?m=${month}`;
  const compliance = async page => json(await apiAs(page, `/api/weekly/compliance?month=${month}`));
  const st0 = await compliance(gd);
  expect(st0.closed).toBe(true);
  expect(st0.state.status, 'bảng điểm tháng này chưa ai duyệt').not.toBe('APPROVED');
  restore.push(async () => { // dừng giữa chừng khi bảng đã khoá → về bản nháp như lúc đầu
    if ((await compliance(gd)).state.status === 'APPROVED') return post(gd, '/api/weekly/compliance/unlock', { month, reason: 'Khôi phục sau kiểm thử tự động (giả)' });
  });

  // 1) Thư ký trình → thành viên Ban TGĐ nhận "chờ duyệt".
  const gdSince = await lastId(gd);
  await hc.goto(`/#/tuan/diem?m=${month}`);
  await hc.getByTestId('wk-score-submit').click();
  await toast(hc, 'Đã trình TGĐ bảng điểm');
  const wait = await newSince(gd, gdSince, 'WEEKLY_COMPLIANCE');
  expect(wait.map(n => [n.title, n.link])).toEqual([[`Bảng điểm tuân thủ giao ban tháng ${M} chờ duyệt`, link]]);

  // 2) "Duyệt và khoá" hỏi lại; Huỷ → vẫn "Đã trình", chưa có nút Mở khoá.
  await gd.goto(`/#/tuan/diem?m=${month}`);
  await expect(gd.getByTestId('wk-score-state')).toContainText('Đã trình TGĐ');
  await gd.getByTestId('wk-score-approve').click();
  const modal = gd.locator('#modal');
  await expect(modal).toContainText(`Duyệt và khoá bảng điểm tháng ${M}? Sau khi khoá không sửa được; chỉ Ban Tổng Giám đốc mở khoá (ghi lý do).`);
  await gd.getByTestId('confirm-cancel').click();
  await expect(gd.locator('#modalRoot')).toBeHidden();
  expect((await compliance(gd)).state.status).toBe('SUBMITTED');
  await expect(gd.getByTestId('wk-score-state')).toContainText('Đã trình TGĐ');
  await expect(gd.getByTestId('wk-score-unlock')).toHaveCount(0);

  // 3) Đồng ý → khoá; thư ký và lãnh đạo các bộ phận được chấm nhận thông báo (lãnh đạo: không kèm điểm).
  const hcSince = await lastId(hc);
  const ld = await as(browser, leader.username);
  const ldSince = await lastId(ld);
  await gd.getByTestId('wk-score-approve').click();
  await gd.getByTestId('confirm-ok').click();
  await toast(gd, 'Đã duyệt và khoá bảng điểm');
  await expect(gd.getByTestId('wk-score-state')).toContainText('Đã duyệt');
  const done = `Bảng điểm tuân thủ giao ban tháng ${M} đã duyệt và khoá`;
  expect((await newSince(hc, hcSince, 'WEEKLY_COMPLIANCE')).map(n => [n.title, n.link])).toEqual([[done, link]]);
  expect((await compliance(gd)).rows.some(r => r.id === leader.departmentId)).toBe(true);
  expect((await newSince(ld, ldSince, 'WEEKLY_COMPLIANCE')).map(n => [n.title, n.link])).toEqual([[done, '#/tuan']]);

  // 4) Chỉ Ban TGĐ có nút Mở khoá; máy chủ từ chối thư ký, lãnh đạo bộ phận, Quản trị hệ thống — câu rõ, bảng vẫn khoá.
  await hc.reload();
  await expect(hc.getByTestId('wk-score-state')).toContainText('Đã duyệt');
  await expect(hc.getByTestId('wk-score-unlock')).toHaveCount(0);
  const admin = await as(browser, 'admin');
  for (const [page, error] of [[hc, 'Chỉ Ban Tổng Giám đốc mở khoá bảng điểm tuân thủ đã duyệt'], [ld, 'Chỉ Ban Tổng Giám đốc mở khoá bảng điểm tuân thủ đã duyệt'],
    [admin, 'Tài khoản quản trị hệ thống không xem nội dung nghiệp vụ']]) {
    const r = await post(page, '/api/weekly/compliance/unlock', { month, reason: 'Thử mở khoá (giả)' });
    expect(r.status()).toBe(403);
    expect((await r.json()).error).toBe(error);
  }
  expect((await compliance(gd)).state.status).toBe('APPROVED');

  // 5) Mở khoá bỏ trống lý do → báo lỗi ngay, không gửi lên máy chủ.
  const unlocks = [];
  const onReq = r => { if (r.url().includes('/api/weekly/compliance/unlock')) unlocks.push(r.url()); };
  gd.on('request', onReq);
  await gd.getByTestId('wk-score-unlock').click();
  await expect(modal).toContainText(`Mở khoá bảng điểm tháng ${M}?`);
  await gd.getByTestId('confirm-ok').click();
  await toast(gd, 'Ghi lý do mở khoá bảng điểm');
  expect(unlocks).toEqual([]);
  expect((await compliance(gd)).state.status).toBe('APPROVED');

  // 6) Có lý do → bảng về bản nháp (tính lại), hiện lý do; thư ký nhận thông báo kèm lý do và trình lại được.
  const reason = `Điểm danh tuần cuối tháng ${M} ghi nhầm (giả)`;
  const hcSince2 = await lastId(hc);
  await gd.getByTestId('wk-score-unlock').click();
  await gd.getByTestId('confirm-input').fill(reason);
  await gd.getByTestId('confirm-ok').click();
  await toast(gd, 'Đã mở khoá bảng điểm');
  gd.off('request', onReq);
  expect(unlocks).toHaveLength(1);
  await expect(gd.getByTestId('wk-score-state')).toContainText('Bản nháp');
  await expect(gd.getByTestId('wk-score-unlocked')).toContainText(`Lý do: ${reason}`);
  await expect(gd.getByTestId('wk-score-unlock')).toHaveCount(0);
  await expect(gd.getByTestId('wk-score-approve')).toHaveCount(0);
  const un = await newSince(hc, hcSince2, 'WEEKLY_COMPLIANCE');
  expect(un.map(n => [n.title, n.link])).toEqual([[`Bảng điểm tuân thủ giao ban tháng ${M} đã mở khoá`, link]]);
  expect(un[0].body).toContain(`Lý do: ${reason}.`);
  await hc.reload();
  await expect(hc.getByTestId('wk-score-unlocked')).toContainText(reason);
  await expect(hc.getByTestId('wk-score-submit')).toBeVisible();

  // 7) Nhật ký hệ thống có dòng mở khoá; Quản trị hệ thống không đọc được lý do (nội dung nghiệp vụ).
  const audit = await json(await apiAs(admin, '/api/admin/audit?action=WEEKLY_COMPLIANCE_UNLOCK'));
  expect(audit.total).toBeGreaterThanOrEqual(1);
  expect(audit.items[0].entityId).toBe(`weekly.compliance.${month}`);
  expect(audit.items[0].redacted).toBe(true);
  expect(JSON.stringify(audit.items)).not.toContain(reason);
});
