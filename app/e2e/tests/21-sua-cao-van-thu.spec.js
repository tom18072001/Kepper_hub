// Sửa 4 lỗi mức Cao nhóm "văn thư / tài liệu" (đề xuất C1–C4, T14) — dữ liệu GIẢ; mọi văn bản do spec tự tạo, mỗi test tự đặt trạng thái
// mình cần. Thiết lập văn thư (Văn thư, Người phê duyệt) đổi trong spec được khôi phục ở afterAll; tài khoản Ban TGĐ giả do spec tạo được
// khoá lại khi xong (như chưa từng có với mọi danh sách "đang hoạt động").
// - Lỗi 6 (C1 / T14): danh sách Người phê duyệt chỉ còn người đã khoá → BTGĐ "Toàn công ty" xem, duyệt được (không kẹt); màn Thiết lập gạch tên
//   người không còn hợp lệ kèm lý do, nói ai đang áp dụng và vì sao; Lưu không âm thầm xoá; người mới vào tập nhận "Tài liệu chờ phê duyệt".
// - Lỗi 7 (C2): hộp hỏi "Gỡ" tệp lưu trong Hub nói rõ xoá hẳn (tệp NAS: chuyển vào _LuuTru); bấm Huỷ thì tệp còn nguyên.
// - Lỗi 8 (C3): "Hủy số" / "Huỷ dự thảo" / "Trả lại" mà ô lý do trống: hộp giữ mở, dòng đỏ "Nhập lý do", không đổi gì; gõ lý do thì làm được.
// - Lỗi 9 (C4): MỌI nút bước trạng thái hỏi lại, nêu tên bước và "không quay lại được"; Huỷ thì trạng thái không đổi, đồng ý thì đổi.
const { test, expect, login, apiAs, toast, sharedPage, closeSharedPages } = require('./helpers');

test.describe.configure({ mode: 'serial' });

const TAG = 'SCVT' + Date.now().toString(36); // từ khoá duy nhất cho lượt chạy này
const PDF = { name: 'ban-scan-gia.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF') };
const X_USER = { username: 'btgd.pheduyet21', fullName: 'Phó TGĐ phê duyệt (giả)', displayTitle: 'Phó Tổng Giám đốc (giả)' };
const pages = {};
let cfgBefore = null, X = null, giamdocId = null, kd = null;
const go = (page, hash) => page.evaluate(h => { location.hash = h; }, hash);
const modal = page => page.locator('#modal');

async function as(browser, username) {
  if (pages[username]) return pages[username];
  const page = await sharedPage(browser);
  await login(page, username);
  return (pages[username] = page);
}
async function json(r, status) { const t = await r.text(); expect(r.status(), t).toBe(status); return t ? JSON.parse(t) : null; }
const setApprovers = ids => apiAs(pages.giamdoc, '/api/vanthu/config', { method: 'PUT', data: { approverUserIds: ids } }).then(r => json(r, 200));
const lockX = locked => apiAs(pages.admin, `/api/admin/users/${X.id}`, { method: 'PUT', data: { isActive: !locked } }).then(r => json(r, 200));
// Khoá tài khoản làm phiên cũ hết hạn: mở khoá rồi đăng nhập lại khi cần dùng X.
async function activeX() { await lockX(false); await login(pages[X_USER.username], X_USER.username); return pages[X_USER.username]; }
// Danh sách Người phê duyệt "kẹt" kiểu cũ: chỉ có X, rồi Quản trị khoá X.
async function stuckOnLockedX() { await lockX(false); await setApprovers([X.id]); await lockX(true); }
const doc = (page, id) => apiAs(page, `/api/vanthu/docs/${id}`).then(r => json(r, 200));
async function draftKD(title, { pdf = true } = {}) { // dự thảo D7 của Phòng Kinh doanh do Lãnh đạo bộ phận soạn
  const lead = pages['tp.kinhdoanh'];
  const d = await json(await apiAs(lead, '/api/vanthu/docs', { method: 'POST', data: { series: 'D7', entity: 'HLD', departmentId: kd.id, docType: 'QT', viewLevel: 'ALL', title: `${TAG} ${title} (giả)` } }), 201);
  if (pdf) await json(await apiAs(lead, `/api/vanthu/docs/${d.id}/files`, { method: 'POST', multipart: { files: PDF } }), 201);
  return d;
}
const register = data => apiAs(pages.giamdoc, '/api/vanthu/docs', { method: 'POST', data: { series: 'D10', entity: 'HLD', ...data, title: `${TAG} ${data.title} (giả)` } }).then(r => json(r, 201));

test.beforeAll(async ({ browser }) => {
  const dir = await as(browser, 'giamdoc'), admin = await as(browser, 'admin');
  await as(browser, 'tp.kinhdoanh');
  cfgBefore = (await json(await apiAs(dir, '/api/vanthu/meta'), 200)).config;
  const users = await json(await apiAs(admin, '/api/admin/users'), 200);
  giamdocId = users.find(u => u.username === 'giamdoc').id;
  const depts = await json(await apiAs(admin, '/api/departments'), 200);
  kd = depts.find(d => d.code === 'KD');
  // Thành viên Ban TGĐ giả, KHÔNG phụ trách "Toàn công ty" — dùng làm Người phê duyệt rồi khoá.
  const r = await apiAs(admin, '/api/admin/users', { method: 'POST', data: { ...X_USER, role: 'director', departmentId: depts.find(d => d.code === 'BGD').id } });
  expect([201, 409], await r.text()).toContain(r.status());
  X = (await json(await apiAs(admin, '/api/admin/users'), 200)).find(u => u.username === X_USER.username);
  if (!X.isActive) await lockX(false);
  await as(browser, X_USER.username);
  // Trạng thái biết trước: không ai kiêm Văn thư, danh sách Người phê duyệt trống (giamdoc phụ trách "Toàn công ty" là Người phê duyệt).
  await json(await apiAs(dir, '/api/vanthu/config', { method: 'PUT', data: { clerkUserIds: [], approverUserIds: [] } }), 200);
});
test.afterAll(async () => {
  try {
    if (cfgBefore && pages.giamdoc) await json(await apiAs(pages.giamdoc, '/api/vanthu/config', { method: 'PUT', data: { clerkUserIds: cfgBefore.clerkUserIds, approverUserIds: cfgBefore.approverUserIds } }), 200);
  } finally {
    try { if (X && pages.admin) await lockX(true); } finally { await closeSharedPages(); }
  }
});

test('L6a. Người phê duyệt duy nhất bị khoá → BTGĐ "Toàn công ty" xem và phê duyệt được dự thảo (không kẹt)', async () => {
  const dir = pages.giamdoc, xp = await activeX();
  await setApprovers([X.id]);
  const d = await draftKD('quy trình chờ duyệt');
  expect((await doc(xp, d.id)).can.approve).toBe(true);
  expect((await apiAs(dir, `/api/vanthu/docs/${d.id}`)).status(), 'BTGĐ không có tên trong danh sách còn hợp lệ: không thấy dự thảo').toBe(404);
  // Quản trị khoá Người phê duyệt duy nhất → danh sách chỉ còn người đã khoá → dự phòng "Toàn công ty".
  await lockX(true);
  expect((await doc(dir, d.id)).can.approve, 'trước khi sửa: 404, không ai duyệt được').toBe(true);
  const ok = await json(await apiAs(dir, `/api/vanthu/docs/${d.id}/approve`, { method: 'POST', data: {} }), 200);
  expect(ok.number).toMatch(/^\d{3}\/\d{4}\/QT-KD$/);
});

test('L6b. Màn Thiết lập: người đã khoá hiện gạch tên "(đã khoá)", "Đang áp dụng … vì danh sách không còn ai hợp lệ"; Lưu không âm thầm xoá; bỏ tick mới xoá', async () => {
  const dir = pages.giamdoc;
  await stuckOnLockedX();
  // Máy chủ: cờ Người phê duyệt của giamdoc và thông tin màn Thiết lập đi qua cùng một hàm tính.
  const m = await json(await apiAs(dir, '/api/vanthu/meta'), 200);
  expect(m.approver, 'trước khi sửa: false — không ai là Người phê duyệt').toBe(true);
  expect(m.config.approvers.source).toBe('BOARD_ALL');
  expect(m.config.approvers.effective.map(u => u.id)).toContain(giamdocId);
  expect(m.config.approvers.stored).toEqual([{ id: X.id, fullName: X_USER.fullName, problems: ['INACTIVE'] }]);
  expect(m.config.approverUserIds).toEqual([X.id]);
  // Giao diện.
  await dir.reload();
  await go(dir, '#/vanthu/thiet-lap');
  const box = dir.getByTestId('vt-c-approver-box');
  await expect(box).toContainText('để trống hoặc không còn ai hợp lệ = thành viên Ban TGĐ phụ trách "Toàn công ty"; không ai phụ trách "Toàn công ty" = mọi thành viên Ban TGĐ');
  await expect(dir.getByTestId('vt-c-approvers').locator('option', { hasText: X_USER.fullName })).toHaveCount(0);
  const stale = dir.getByTestId('vt-c-stale');
  await expect(stale.locator('s')).toHaveText(X_USER.fullName);
  await expect(stale).toContainText(`${X_USER.fullName} (đã khoá) — giữ tên trong danh sách`);
  await expect(dir.getByTestId(`vt-c-keep-${X.id}`)).toBeChecked();
  const eff = dir.getByTestId('vt-c-effective');
  await expect(eff).toContainText('Đang áp dụng: ');
  await expect(eff).toContainText('Trần Minh Giám');
  await expect(eff).toContainText('theo "Toàn công ty" vì danh sách không còn ai hợp lệ.');
  await expect(dir.getByTestId('vt-c-no-approver')).toHaveCount(0);
  // Lưu mà không đụng ô Người phê duyệt: người đã khoá vẫn nằm trong danh sách (trước khi sửa: bị xoá âm thầm).
  const saved = async () => (await json(await apiAs(dir, '/api/vanthu/meta'), 200)).config.approverUserIds;
  await dir.getByTestId('vt-c-save').click();
  await toast(dir, 'Đã lưu thiết lập');
  await expect(dir).toHaveURL(/#\/vanthu$/);
  expect(await saved()).toEqual([X.id]);
  // Bỏ tick "giữ" rồi Lưu: xoá khỏi danh sách → danh sách trống. (Thông báo lần lưu trước có thể còn hiện → chờ máy chủ, không chờ thông báo.)
  await go(dir, '#/vanthu/thiet-lap');
  await dir.getByTestId(`vt-c-keep-${X.id}`).uncheck();
  await dir.getByTestId('vt-c-save').click();
  await expect.poll(saved).toEqual([]);
  await expect(dir).toHaveURL(/#\/vanthu$/);
  await go(dir, '#/vanthu/thiet-lap');
  await expect(dir.getByTestId('vt-c-effective')).toContainText('theo "Toàn công ty" vì danh sách trống.');
  await expect(dir.getByTestId('vt-c-stale')).toHaveCount(0);
});

test('L6c. Đổi Thiết lập có Người phê duyệt hiệu lực mới → người đó nhận "Tài liệu chờ phê duyệt" của dự thảo đang chờ', async () => {
  const xp = await activeX();
  await setApprovers([]);
  const d = await draftKD('dự thảo chờ từ trước', { pdf: false }); // danh sách trống: chỉ BTGĐ "Toàn công ty" được báo lúc tạo
  const mine = async () => (await json(await apiAs(xp, '/api/notifications'), 200)).items.filter(n => n.type === 'DOC_APPROVAL' && n.link === `#/vanthu/${d.id}`);
  expect(await mine()).toEqual([]);
  await setApprovers([X.id]);
  const got = await mine();
  expect(got.length, 'trước khi sửa: người mới không được báo dự thảo đang chờ').toBe(1);
  expect(got[0].title).toBe(`Tài liệu chờ phê duyệt: ${TAG} dự thảo chờ từ trước (giả)`);
  expect(got[0].body).toContain('Bạn vừa thành Người phê duyệt');
  // Lưu lại không đổi tập hiệu lực → không báo lại.
  await setApprovers([X.id]);
  expect((await mine()).length).toBe(1);
  await json(await apiAs(pages['tp.kinhdoanh'], `/api/vanthu/docs/${d.id}/cancel`, { method: 'POST', data: { reason: 'Dọn dữ liệu thử (giả)' } }), 200);
  await setApprovers([]);
});

test('L6d. Màn Thiết lập: băng đỏ khi không có Người phê duyệt hợp lệ; dòng "mọi thành viên Ban TGĐ" khi không ai "Toàn công ty"', async () => {
  // Trạng thái này không dựng được thật khi chính người mở màn là Ban TGĐ đang hoạt động (họ luôn thuộc tập dự phòng) → giả câu trả lời
  // /api/vanthu/meta chỉ để kiểm cách màn hình trình bày; không bấm Lưu.
  const dir = pages.giamdoc;
  const fake = approvers => dir.route('**/api/vanthu/meta', async route => {
    const r = await route.fetch(); const j = await r.json();
    j.config.approvers = approvers;
    await route.fulfill({ response: r, json: j });
  });
  try {
    await fake({ source: 'NONE', effective: [], stored: [{ id: 990001, fullName: 'Người đã nghỉ (giả)', problems: ['INACTIVE', 'NOT_BOARD'] }] });
    await dir.reload();
    await go(dir, '#/vanthu/thiet-lap');
    await expect(dir.getByTestId('vt-c-no-approver')).toHaveText('Hiện không có Người phê duyệt hợp lệ — dự thảo sẽ không ai duyệt.');
    await expect(dir.getByTestId('vt-c-effective')).toHaveCount(0);
    await expect(dir.getByTestId('vt-c-stale')).toContainText('Người đã nghỉ (giả) (đã khoá, không còn vai Ban Tổng Giám đốc)');
    await dir.unroute('**/api/vanthu/meta');
    await fake({ source: 'BOARD', effective: [{ id: 990002, fullName: 'Thành viên A (giả)' }, { id: 990003, fullName: 'Thành viên B (giả)' }], stored: [] });
    await dir.reload();
    await go(dir, '#/vanthu/thiet-lap');
    await expect(dir.getByTestId('vt-c-effective')).toHaveText('Đang áp dụng: Thành viên A (giả), Thành viên B (giả) — mọi thành viên Ban TGĐ, vì danh sách trống và không ai phụ trách "Toàn công ty".');
    await expect(dir.getByTestId('vt-c-no-approver')).toHaveCount(0);
  } finally {
    await dir.unroute('**/api/vanthu/meta').catch(() => {});
    await dir.reload().catch(() => {});
  }
});

test('L7. Gỡ tệp lưu trong Hub: hộp hỏi nói rõ "xoá hẳn, không khôi phục được"; Huỷ thì tệp còn; tệp NAS: chuyển vào _LuuTru', async () => {
  const dir = pages.giamdoc;
  const d = await register({ title: 'văn bản đến gỡ tệp' });
  const f = (await json(await apiAs(dir, `/api/vanthu/docs/${d.id}/files`, { method: 'POST', multipart: { files: PDF } }), 201))[0];
  expect(f.storedIn).toBe('HUB'); // máy chạy e2e không có kho văn thư NAS
  const files = async () => (await doc(dir, d.id)).files.map(x => x.id);
  const rm = () => dir.locator('[data-rm]'); // nút "Gỡ" của tệp
  // Tệp trong Hub (thật): hộp hỏi nói xoá hẳn; Huỷ → tệp còn.
  await go(dir, `#/vanthu/${d.id}`);
  await expect(dir.getByTestId('vt-file-nas')).toHaveCount(0);
  await rm().click();
  await expect(modal(dir).locator('p').first()).toHaveText('Gỡ tệp khỏi văn bản? Tệp lưu trong Hub sẽ bị xoá hẳn, không khôi phục được.');
  await expect(dir.getByTestId('confirm-ok')).toHaveText('Gỡ tệp');
  await dir.getByTestId('confirm-cancel').click();
  await expect(dir.locator('#modalRoot')).toBeHidden();
  expect(await files()).toEqual([f.id]);
  await expect(rm()).toHaveCount(1);
  // Tệp có nhãn NAS (giả câu trả lời chi tiết để có nhãn NAS): câu hỏi về _LuuTru giữ nguyên. Chỉ mở hộp rồi Huỷ.
  const url = `**/api/vanthu/docs/${d.id}`;
  await dir.route(url, async route => {
    const r = await route.fetch(); const j = await r.json();
    j.files = j.files.map(x => ({ ...x, storedIn: 'NAS', nasPath: 'HCNS/01.VanBanDen/gia/ban-scan-gia.pdf', version: 1 }));
    await route.fulfill({ response: r, json: j });
  });
  try {
    await go(dir, '#/vanthu');
    await go(dir, `#/vanthu/${d.id}`);
    await expect(dir.getByTestId('vt-file-nas')).toBeVisible();
    await rm().click();
    await expect(modal(dir).locator('p').first()).toHaveText('Gỡ tệp khỏi văn bản? Bản trên NAS được chuyển vào thư mục _LuuTru của sổ, không xoá hẳn.');
    await dir.getByTestId('confirm-cancel').click();
  } finally { await dir.unroute(url).catch(() => {}); }
  // Tệp trong Hub, đồng ý → gỡ thật.
  await go(dir, '#/vanthu');
  await go(dir, `#/vanthu/${d.id}`);
  await rm().click();
  await dir.getByTestId('confirm-ok').click();
  await toast(dir, 'Đã gỡ tệp');
  expect(await files()).toEqual([]);
});

// Chung cho L8: nút đã bấm mở hộp có ô "(bắt buộc)" → đồng ý khi trống / chỉ khoảng trắng → dòng đỏ, hộp còn mở, ô viền đỏ, con trỏ về ô.
async function emptyReasonRefused(page, label, okText) {
  await expect(modal(page).locator('label.field')).toContainText(label);
  await expect(page.getByTestId('confirm-ok')).toHaveText(okText);
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('confirm-error')).toHaveText('Nhập lý do');
  await expect(page.getByTestId('confirm-input')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('confirm-input')).toBeFocused();
  await page.getByTestId('confirm-input').fill('   ');
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('confirm-error')).toHaveText('Nhập lý do');
  await expect(page.locator('#modalRoot')).toBeVisible();
}

test('L8a. Hủy số với lý do trống: hộp giữ mở, dòng đỏ "Nhập lý do", văn bản không đổi; gõ lý do thì hủy được', async () => {
  const dir = pages.giamdoc;
  const a = await register({ title: 'văn bản đến hủy số' });
  await go(dir, `#/vanthu/${a.id}`);
  await dir.getByTestId('vt-cancel').click();
  await emptyReasonRefused(dir, 'Lý do hủy (bắt buộc)', 'Hủy số');
  expect((await doc(dir, a.id)).cancelled, 'ô trống: chưa hủy').toBeNull();
  await dir.getByTestId('confirm-input').fill('Vào sổ nhầm (giả)');
  await expect(dir.getByTestId('confirm-error')).toHaveText('');
  await expect(dir.getByTestId('confirm-input')).not.toHaveAttribute('aria-invalid', 'true');
  await dir.getByTestId('confirm-ok').click();
  await toast(dir, 'Đã hủy số');
  expect((await doc(dir, a.id)).cancelled.reason).toBe('Vào sổ nhầm (giả)');
});

test('L8b. Huỷ dự thảo / Trả lại với lý do trống: hộp giữ mở, "Nhập lý do", dự thảo không đổi; hộp không bắt buộc (Phê duyệt) như cũ', async () => {
  const dir = pages.giamdoc, lead = pages['tp.kinhdoanh'];
  await setApprovers([]); // giamdoc phụ trách "Toàn công ty" là Người phê duyệt
  // Huỷ dự thảo (người soạn).
  const b = await draftKD('dự thảo sẽ huỷ', { pdf: false });
  await go(lead, `#/vanthu/${b.id}`);
  await lead.getByTestId('vt-cancel').click();
  await emptyReasonRefused(lead, 'Lý do huỷ (bắt buộc)', 'Huỷ dự thảo');
  expect((await doc(lead, b.id)).cancelled).toBeNull();
  await lead.getByTestId('confirm-input').fill('Không ban hành nữa (giả)');
  await lead.getByTestId('confirm-ok').click();
  await toast(lead, 'Đã huỷ dự thảo');
  expect((await doc(lead, b.id)).cancelled.reason).toBe('Không ban hành nữa (giả)');
  // Trả lại (Người phê duyệt).
  const c = await draftKD('dự thảo sẽ trả lại');
  await go(dir, `#/vanthu/${c.id}`);
  await dir.getByTestId('vt-return').click();
  await emptyReasonRefused(dir, 'Lý do trả lại (bắt buộc)', 'Trả lại');
  expect((await doc(dir, c.id)).status.code, 'ô trống: dự thảo vẫn chờ').toBe('DRAFT');
  await dir.getByTestId('confirm-input').fill('Bổ sung phụ lục (giả)');
  await dir.getByTestId('confirm-ok').click();
  await toast(dir, 'Đã trả lại');
  expect((await doc(dir, c.id)).status.code).toBe('RETURNED');
  // Hộp hỏi có ô không bắt buộc ("Ý kiến (không bắt buộc)" của Phê duyệt) vẫn như cũ: đồng ý với ô trống là làm luôn.
  await json(await apiAs(lead, `/api/vanthu/docs/${c.id}/resubmit`, { method: 'POST', data: {} }), 200);
  await go(dir, '#/vanthu');
  await go(dir, `#/vanthu/${c.id}`);
  await dir.getByTestId('vt-approve').click();
  await expect(dir.getByTestId('confirm-error')).toHaveCount(0);
  await dir.getByTestId('confirm-ok').click();
  await toast(dir, 'Đã phê duyệt');
});

// Chung cho L9: mở hộp của một nút bước, kiểm câu hỏi (tên bước, trạng thái đích, "không quay lại được") và nút đồng ý (= tên bước), rồi Huỷ.
async function askThenCancel(page, to, step, status, num) {
  await page.getByTestId(`vt-to-${to}`).click();
  await expect(modal(page).locator('p').first()).toContainText(`${step}: chuyển ${num} sang "${status}"? Không quay lại được bước trước.`);
  await expect(page.getByTestId('confirm-ok')).toHaveText(step);
  await page.getByTestId('confirm-cancel').click();
  await expect(page.locator('#modalRoot')).toBeHidden();
}

test('L9a. Văn bản đến / đi: mọi nút bước hỏi lại, nêu tên bước và "không quay lại được"; Huỷ thì không đổi; đồng ý thì đổi', async () => {
  const dir = pages.giamdoc;
  const pill = () => dir.locator('#view .page-head .pill').first();
  // Văn bản đến: đủ 5 nút bước, nút nào cũng hỏi; Huỷ cả 5 → vẫn "Đã tiếp nhận", lịch sử không có đổi trạng thái.
  const den = await register({ title: 'văn bản đến bấm bước' });
  await go(dir, `#/vanthu/${den.id}`);
  const STEPS = [['SUBMITTED', 'Đã trình', 'Đã trình'], ['ASSIGNED', 'Đã giao', 'Đã giao xử lý'], ['PROCESSING', 'Bắt đầu xử lý', 'Đang xử lý'], ['DONE', 'Báo xong', 'Đã hoàn thành'], ['FILED', 'Lập hồ sơ', 'Đã lập hồ sơ']];
  await expect(dir.locator('[data-to]')).toHaveCount(STEPS.length);
  for (const [to, step, status] of STEPS) await askThenCancel(dir, to, step, status, den.number);
  await expect(pill()).toHaveText('Đã tiếp nhận');
  const after = await doc(dir, den.id);
  expect(after.status.code).toBe('RECEIVED');
  expect(after.events.filter(e => e.action === 'STATUS')).toEqual([]);
  // Đồng ý → đổi.
  await dir.getByTestId('vt-to-PROCESSING').click();
  await dir.getByTestId('confirm-ok').click();
  await toast(dir, 'Đã cập nhật');
  await expect(pill()).toHaveText('Đang xử lý');
  // "Báo xong" cùng cách viết, kèm ô kết quả (không bắt buộc) và hệ quả "hết nhắc hạn".
  await dir.getByTestId('vt-to-DONE').click();
  await expect(modal(dir).locator('p').first()).toHaveText(`Báo xong: chuyển ${den.number} sang "Đã hoàn thành"? Không quay lại được bước trước. Văn bản được tính là đã xong, hết nhắc hạn.`);
  await expect(modal(dir).locator('label.field')).toContainText('Kết quả xử lý (không bắt buộc)');
  await dir.getByTestId('confirm-input').fill('Đã trả lời bằng công văn (giả)');
  await dir.getByTestId('confirm-ok').click();
  await expect(pill()).toHaveText('Đã hoàn thành');
  await dir.getByTestId('vt-to-FILED').click();
  await expect(modal(dir).locator('p').first()).toHaveText(`Lập hồ sơ: chuyển ${den.number} sang "Đã lập hồ sơ"? Không quay lại được bước trước. Văn bản được tính là đã xong, hết nhắc hạn.`);
  await dir.getByTestId('confirm-ok').click();
  await expect(pill()).toHaveText('Đã lập hồ sơ');
  await expect(dir.locator('[data-to]')).toHaveCount(0);
  expect((await doc(dir, den.id)).events.filter(e => e.action === 'STATUS').map(e => [e.toValue, e.note])).toEqual([['PROCESSING', null], ['DONE', 'Đã trả lời bằng công văn (giả)'], ['FILED', null]]);
  // Văn bản đi: 3 nút bước đều hỏi; Huỷ → vẫn "Đã cấp số".
  const di = await register({ series: 'D9', title: 'công văn đi bấm bước' });
  await go(dir, `#/vanthu/${di.id}`);
  for (const [to, step] of [['SENT', 'Đã gửi'], ['CONFIRMED', 'Bên nhận đã xác nhận'], ['REPLIED', 'Đã có phản hồi']]) await askThenCancel(dir, to, step, step, di.number);
  expect((await doc(dir, di.id)).status.code).toBe('NUMBERED');
  await dir.getByTestId('vt-to-SENT').click();
  await dir.getByTestId('confirm-ok').click();
  await expect(pill()).toHaveText('Đã gửi');
});

test('L9b. Quy chế: "Có hiệu lực" / "Hết hiệu lực" hỏi lại; "Hết hiệu lực" nói phải tạo dự thảo thay thế và phê duyệt lại; Huỷ thì không đổi', async () => {
  const dir = pages.giamdoc;
  await setApprovers([]);
  const mk = async (title, data = {}) => {
    const q = await json(await apiAs(dir, '/api/vanthu/docs', { method: 'POST', data: { series: 'D6', entity: 'HLD', docType: 'HD', viewLevel: 'ALL', title: `${TAG} ${title} (giả)`, ...data } }), 201);
    await json(await apiAs(dir, `/api/vanthu/docs/${q.id}/files`, { method: 'POST', multipart: { files: PDF } }), 201);
    return json(await apiAs(dir, `/api/vanthu/docs/${q.id}/approve`, { method: 'POST', data: {} }), 200);
  };
  // Đã phê duyệt, chưa tới ngày hiệu lực: 2 nút, cả hai hỏi.
  const later = new Date(Date.now() + 7 * 3600_000 + 60 * 86_400_000).toISOString().slice(0, 10);
  const ap = await mk('hướng dẫn chờ hiệu lực', { effectiveDate: later });
  expect(ap.status.code).toBe('APPROVED');
  await go(dir, `#/vanthu/${ap.id}`);
  await askThenCancel(dir, 'EFFECTIVE', 'Có hiệu lực', 'Hiệu lực', ap.number);
  await askThenCancel(dir, 'EXPIRED', 'Hết hiệu lực', 'Hết hiệu lực / thay thế', ap.number);
  await expect(dir.getByTestId('vt-status')).toHaveText('Đã phê duyệt');
  // Đang hiệu lực: "Hết hiệu lực" nói hệ quả; Huỷ → vẫn "Hiệu lực"; đồng ý → "Hết hiệu lực / thay thế".
  const q = await mk('hướng dẫn sẽ hết hiệu lực');
  expect(q.status.code).toBe('EFFECTIVE');
  await go(dir, `#/vanthu/${q.id}`);
  await dir.getByTestId('vt-to-EXPIRED').click();
  await expect(modal(dir).locator('p').first()).toHaveText(`Hết hiệu lực: chuyển ${q.number} sang "Hết hiệu lực / thay thế"? Không quay lại được bước trước. Muốn áp dụng lại phải tạo dự thảo thay thế và phê duyệt lại.`);
  await dir.getByTestId('confirm-cancel').click();
  await expect(dir.getByTestId('vt-status')).toHaveText('Hiệu lực');
  expect((await doc(dir, q.id)).status.code).toBe('EFFECTIVE');
  await dir.getByTestId('vt-to-EXPIRED').click();
  await dir.getByTestId('confirm-ok').click();
  await toast(dir, 'Đã cập nhật');
  await expect(dir.getByTestId('vt-status')).toHaveText('Hết hiệu lực / thay thế');
});
