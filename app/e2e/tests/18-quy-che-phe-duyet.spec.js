// Quy chế, quy định nội bộ (sổ NOIBO) — docs/de-xuat-quy-che-phe-duyet.md, chủ dự án duyệt 24/11/2026. Dữ liệu mẫu GIẢ.
// - Ma trận 3 cấp xem (Mọi người / Lãnh đạo / Ban TGĐ) × vai (BTGĐ, BTGĐ không phải Người phê duyệt, Lãnh đạo bộ phận, Nhân viên,
//   Văn thư vai Nhân viên, Quản trị hệ thống) trên danh sách / chi tiết / tệp / tìm / "gắn vào việc".
// - Luồng: tạo là DỰ THẢO chưa có số; chỉ Người phê duyệt phê duyệt / trả lại (403 người khác, 403 qua token, 422 thiếu PDF);
//   số cấp lúc phê duyệt, liên tục khi có dự thảo bị trả lại / huỷ; phê duyệt đồng thời không trùng số.
// - Claude (token): tạo dự thảo kèm PDF qua /api/vanthu/drafts; không vào sổ, không phê duyệt; không đọc dự thảo người khác / cấp Ban TGĐ.
const { test, expect } = require('@playwright/test');
const { login, apiAs, toast, vnDate } = require('./helpers');

test.describe.configure({ mode: 'serial' });

const PDF = { name: 'quy-che-gia.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF') };
const PNG = { name: 'anh.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex') };
const TAG = 'QCPD' + Date.now().toString(36); // từ khoá duy nhất cho lượt chạy này
const pages = {};
let cfgBefore = null, btgd2 = null;
const go = (page, hash) => page.evaluate(h => { location.hash = h; }, hash);

async function as(browser, username) {
  if (pages[username]) return pages[username];
  const page = await (await browser.newContext()).newPage();
  await login(page, username);
  return (pages[username] = page);
}
async function json(r, status) { const t = await r.text(); expect(r.status(), t).toBe(status); return t ? JSON.parse(t) : null; }
async function draft(page, data, status = 201) {
  return json(await apiAs(page, '/api/vanthu/docs', { method: 'POST', data: { series: 'D6', entity: 'HLD', docType: 'QC', viewLevel: 'ALL', ...data } }), status);
}
const pdfUp = (page, id, file = PDF) => apiAs(page, `/api/vanthu/docs/${id}/files`, { method: 'POST', multipart: { files: file } });
const approve = (page, id, data = {}) => apiAs(page, `/api/vanthu/docs/${id}/approve`, { method: 'POST', data });
async function tokenOf(page) { return (await json(await apiAs(page, '/api/me/tokens', { method: 'POST', data: { name: 'e2e quy chế', scopes: ['read', 'write'], days: 1 } }), 201)).token; }
const viaToken = (page, token, path, init = {}) => page.request.fetch(path, { ...init, headers: { authorization: 'Bearer ' + token } });

test.beforeAll(async ({ browser }) => {
  const dir = await as(browser, 'giamdoc');
  const admin = await as(browser, 'admin');
  // Văn thư = một Nhân viên (Phòng HCNS) — kiểm "Văn thư không vượt cấp xem theo vai".
  const meta = await json(await apiAs(dir, '/api/vanthu/meta'), 200);
  cfgBefore = meta.config;
  const users = await json(await apiAs(dir, '/api/users/directory'), 200);
  const hcns = users.find(u => u.username === 'nv.hcns');
  await json(await apiAs(dir, '/api/vanthu/config', { method: 'PUT', data: { clerkUserIds: [hcns.id], approverUserIds: [] } }), 200);
  // Thành viên Ban TGĐ thứ hai, KHÔNG phụ trách "Toàn công ty" → không phải Người phê duyệt.
  const bgd = (await json(await apiAs(admin, '/api/departments'), 200)).find(d => d.code === 'BGD');
  const r = await apiAs(admin, '/api/admin/users', { method: 'POST', data: { username: 'btgd2.gia', fullName: 'Phó TGĐ (giả)', displayTitle: 'Phó Tổng Giám đốc (giả)', role: 'director', departmentId: bgd.id } });
  expect([200, 201, 409], await r.text()).toContain(r.status());
  btgd2 = await as(browser, 'btgd2.gia');
});
test.afterAll(async () => {
  if (cfgBefore && pages.giamdoc) await apiAs(pages.giamdoc, '/api/vanthu/config', { method: 'PUT', data: { clerkUserIds: cfgBefore.clerkUserIds, approverUserIds: cfgBefore.approverUserIds } });
});

test('Q1. Ma trận cấp xem × vai: danh sách, chi tiết, tệp, tìm, gắn vào việc (tài liệu đã phê duyệt)', async ({ browser }) => {
  const dir = pages.giamdoc;
  const docs = {};
  for (const level of ['ALL', 'LEADERS', 'BOARD']) {
    const d = await draft(dir, { title: `${TAG} quy chế cấp ${level} (giả)`, viewLevel: level });
    expect(d.number).toBeNull();
    expect(d.status.code).toBe('DRAFT');
    const f = (await json(await pdfUp(dir, d.id), 201))[0];
    const a = await json(await approve(dir, d.id), 200);
    expect(a.number).toMatch(/^\d{3}\/\d{4}\/QC-TGĐ$/);
    expect(a.status.code).toBe('EFFECTIVE');
    docs[level] = { id: d.id, fileId: f.id, number: a.number };
  }
  const WHO = { 'giamdoc': ['ALL', 'LEADERS', 'BOARD'], 'btgd2.gia': ['ALL', 'LEADERS', 'BOARD'], 'tp.kinhdoanh': ['ALL', 'LEADERS'], 'nv.kinhdoanh1': ['ALL'], 'nv.hcns': ['ALL'] };
  for (const [username, want] of Object.entries(WHO)) {
    const p = await as(browser, username);
    const list = await json(await apiAs(p, `/api/vanthu/docs?book=NOIBO&q=${TAG}`), 200);
    expect(list.map(d => d.id).sort(), `${username}: danh sách + tìm`).toEqual(want.map(l => docs[l].id).sort());
    for (const [level, d] of Object.entries(docs)) {
      const ok = want.includes(level);
      expect((await apiAs(p, `/api/vanthu/docs/${d.id}`)).status(), `${username} chi tiết ${level}`).toBe(ok ? 200 : 404);
      expect((await apiAs(p, `/api/vanthu/files/${d.fileId}/download`)).status(), `${username} tệp ${level}`).toBe(ok ? 200 : 404);
    }
    // Gắn vào việc: chỉ cấp Mọi người, với mọi vai.
    const pick = await json(await apiAs(p, `/api/vanthu/pick?q=${TAG}`), 200);
    expect(pick.map(d => d.id), `${username}: gắn vào việc`).toEqual([docs.ALL.id]);
  }
  // Quản trị hệ thống: không xem nội dung.
  const admin = pages.admin;
  expect((await apiAs(admin, '/api/vanthu/docs?book=NOIBO')).status()).toBe(403);
  expect((await apiAs(admin, `/api/vanthu/docs/${docs.ALL.id}`)).status()).toBe(404);
  // Mức mật không còn trong sổ nội bộ.
  expect((await json(await apiAs(dir, `/api/vanthu/docs/${docs.BOARD.id}`), 200)).security).toBeNull();
});

test('Q2. Luồng phê duyệt: dự thảo chưa có số; 403 không phải Người phê duyệt / qua token; 422 thiếu PDF; trả lại → gửi lại → phê duyệt, mã băm PDF', async ({ browser }) => {
  const dir = pages.giamdoc, lead = await as(browser, 'tp.kinhdoanh'), staff = await as(browser, 'nv.kinhdoanh1'), clerk = await as(browser, 'nv.hcns');
  const kd = (await json(await apiAs(dir, '/api/departments'), 200)).find(d => d.code === 'KD');
  // Ai tạo: Lãnh đạo bộ phận chỉ dãy D7 của bộ phận mình, cấp xem không cao hơn vai; Nhân viên không tạo.
  await draft(staff, { title: 'Nhân viên tạo (giả)' }, 403);
  await draft(lead, { series: 'D6', title: 'Lãnh đạo bộ phận tạo D6 (giả)' }, 403);
  await draft(lead, { series: 'D7', departmentId: kd.id, title: 'Cấp Ban TGĐ (giả)', viewLevel: 'BOARD' }, 403);
  await draft(lead, { series: 'D7', departmentId: kd.id, title: 'Thiếu loại (giả)', docType: 'XYZ' }, 422);
  const d = await draft(lead, { series: 'D7', departmentId: kd.id, title: `${TAG} quy trình bộ phận (giả)`, docType: 'QT', viewLevel: 'ALL', docCode: 'QT-KD-01' });
  expect(d.number).toBeNull();
  expect(d.can.approve).toBe(false);
  // Dự thảo: người soạn, Người phê duyệt, Văn thư thấy; người khác không.
  for (const [p, st] of [[lead, 200], [dir, 200], [clerk, 200], [btgd2, 404], [staff, 404]]) expect((await apiAs(p, `/api/vanthu/docs/${d.id}`)).status()).toBe(st);
  expect((await json(await apiAs(dir, `/api/vanthu/docs/${d.id}`), 200)).can.approve).toBe(true);
  // 403: người soạn, Văn thư không phê duyệt / trả lại.
  for (const p of [lead, clerk]) {
    expect((await approve(p, d.id)).status()).toBe(403);
    expect((await apiAs(p, `/api/vanthu/docs/${d.id}/return`, { method: 'POST', data: { reason: 'x' } })).status()).toBe(403);
  }
  // 403 qua Claude (token) kể cả Người phê duyệt.
  const tok = await tokenOf(dir);
  expect((await viaToken(dir, tok, `/api/vanthu/docs/${d.id}/approve`, { method: 'POST', data: {} })).status()).toBe(403);
  // 422 thiếu PDF.
  const noPdf = await approve(dir, d.id);
  expect(noPdf.status()).toBe(422);
  expect((await noPdf.json()).code).toBe('PDF_REQUIRED');
  // Trả lại (bắt buộc lý do) → không phê duyệt được tới khi gửi lại.
  expect((await apiAs(dir, `/api/vanthu/docs/${d.id}/return`, { method: 'POST', data: {} })).status()).toBe(422);
  const ret = await json(await apiAs(dir, `/api/vanthu/docs/${d.id}/return`, { method: 'POST', data: { reason: 'Bổ sung phạm vi áp dụng (giả)' } }), 200);
  expect(ret.status.code).toBe('RETURNED');
  expect((await approve(dir, d.id)).status()).toBe(422);
  await json(await apiAs(lead, `/api/vanthu/docs/${d.id}`, { method: 'PATCH', data: { title: `${TAG} quy trình bộ phận — bản sửa (giả)` } }), 200);
  await json(await pdfUp(lead, d.id), 201);
  expect((await json(await apiAs(lead, `/api/vanthu/docs/${d.id}/resubmit`, { method: 'POST', data: {} }), 200)).status.code).toBe('DRAFT');
  const ok = await json(await approve(dir, d.id, { note: 'Đồng ý (giả)' }), 200);
  expect(ok.number).toMatch(/^\d{3}\/\d{4}\/QT-KD$/);
  expect(ok.approvedBy.fullName).toBeTruthy();
  const detail = await json(await apiAs(lead, `/api/vanthu/docs/${d.id}`), 200);
  const ev = detail.events.find(e => e.action === 'APPROVE');
  expect(ev.note).toContain('SHA-256 ');
  expect(detail.events.map(e => e.action)).toEqual(expect.arrayContaining(['CREATE', 'FILE', 'RETURN', 'UPDATE', 'RESUBMIT', 'APPROVE']));
  // Đã phê duyệt: khoá nội dung và tệp; phê duyệt lần hai → 422.
  expect((await pdfUp(lead, d.id)).status()).toBe(403);
  expect((await apiAs(dir, `/api/vanthu/docs/${d.id}`, { method: 'PATCH', data: { title: 'Sửa sau duyệt' } })).status()).toBe(422);
  expect((await approve(dir, d.id)).status()).toBe(422);
  await json(await apiAs(dir, `/api/vanthu/docs/${d.id}`, { method: 'PATCH', data: { note: 'Ghi chú sau duyệt (giả)' } }), 200);
});

test('Q3. Số liên tục: dự thảo bị trả lại / huỷ không chiếm số; phê duyệt đồng thời không trùng số', async () => {
  const dir = pages.giamdoc;
  const mk = async t => { const d = await draft(dir, { entity: 'HLD', series: 'D6', docType: 'HD', title: `${TAG} ${t} (giả)` }); await json(await pdfUp(dir, d.id), 201); return d; };
  const a = await mk('A'), b = await mk('B'), c = await mk('C');
  await json(await apiAs(dir, `/api/vanthu/docs/${b.id}/cancel`, { method: 'POST', data: { reason: 'Không ban hành (giả)' } }), 200);
  await json(await apiAs(dir, `/api/vanthu/docs/${a.id}/return`, { method: 'POST', data: { reason: 'Sửa (giả)' } }), 200);
  const seqOf = n => Number(n.split('/')[0]);
  const nc = (await json(await approve(dir, c.id), 200)).number;
  await json(await apiAs(dir, `/api/vanthu/docs/${a.id}/resubmit`, { method: 'POST', data: {} }), 200);
  const na = (await json(await approve(dir, a.id), 200)).number;
  expect(seqOf(na)).toBe(seqOf(nc) + 1);
  expect((await approve(dir, b.id)).status()).toBe(422); // dự thảo đã huỷ
  // Ba dự thảo phê duyệt cùng lúc → ba số khác nhau, liền nhau.
  const ds = [await mk('P1'), await mk('P2'), await mk('P3')];
  const nums = (await Promise.all(ds.map(d => approve(dir, d.id).then(r => json(r, 200))))).map(r => seqOf(r.number)).sort((x, y) => x - y);
  expect(new Set(nums).size).toBe(3);
  expect(nums[2] - nums[0]).toBe(2);
  expect(nums[0]).toBe(seqOf(na) + 1);
});

test('Q4. Ngày hiệu lực trong quá khứ / tương lai; thay thế văn bản → bản cũ Hết hiệu lực', async () => {
  const dir = pages.giamdoc;
  const old = await draft(dir, { title: `${TAG} quy trình mua hàng cũ (giả)`, docType: 'QT', docDate: '2026-10-22', effectiveDate: '2026-10-22' });
  await json(await pdfUp(dir, old.id), 201);
  const o = await json(await approve(dir, old.id), 200);
  expect(o.status.code).toBe('EFFECTIVE');
  expect(o.issueDate).toBe('2026-10-22'); // ngày ban hành gốc
  expect(o.approvedAt.slice(0, 4)).toBe(vnDate().slice(0, 4)); // ngày phê duyệt vẫn là ngày bấm
  const later = await draft(dir, { title: `${TAG} quy trình mua hàng mới (giả)`, docType: 'QT', effectiveDate: vnDate(30), replacesId: old.id });
  await json(await pdfUp(dir, later.id), 201);
  const l = await json(await approve(dir, later.id), 200);
  expect(l.status.code).toBe('APPROVED');
  expect((await json(await apiAs(dir, `/api/vanthu/docs/${old.id}`), 200)).status.code).toBe('EXPIRED');
  await json(await apiAs(dir, `/api/vanthu/docs/${later.id}/status`, { method: 'POST', data: { to: 'EFFECTIVE' } }), 200);
});

test('Q5. Claude (token): tạo dự thảo kèm PDF (không số); Nhân viên không tạo; không vào sổ / phê duyệt; không đọc dự thảo người khác, cấp Ban TGĐ', async ({ browser }) => {
  const lead = await as(browser, 'tp.kinhdoanh'), staff = await as(browser, 'nv.kinhdoanh1'), dir = pages.giamdoc;
  const kd = (await json(await apiAs(dir, '/api/departments'), 200)).find(d => d.code === 'KD');
  const tLead = await tokenOf(lead), tStaff = await tokenOf(staff), tDir = await tokenOf(dir);
  const fields = { series: 'D7', entity: 'HLD', departmentId: String(kd.id), docType: 'HD', title: `${TAG} hướng dẫn qua Claude (giả)`, viewLevel: 'LEADERS' };
  expect((await viaToken(staff, tStaff, '/api/vanthu/drafts', { method: 'POST', multipart: { ...fields, file: PDF } })).status()).toBe(403);
  expect((await viaToken(lead, tLead, '/api/vanthu/drafts', { method: 'POST', multipart: { ...fields, viewLevel: 'BOARD', file: PDF } })).status()).toBe(403);
  expect((await viaToken(lead, tLead, '/api/vanthu/drafts', { method: 'POST', multipart: { ...fields, file: PNG } })).status()).toBe(422);
  expect((await viaToken(lead, tLead, '/api/vanthu/drafts', { method: 'POST', multipart: fields })).status()).toBe(422);
  const d = await json(await viaToken(lead, tLead, '/api/vanthu/drafts', { method: 'POST', multipart: { ...fields, file: PDF } }), 201);
  expect(d.number).toBeNull();
  expect(d.viaAi).toBe(true);
  expect(d.status.code).toBe('DRAFT');
  // Dự thảo tạo dở không để lại khi tệp hỏng: không có dự thảo "hướng dẫn qua Claude" nào khác.
  expect((await json(await apiAs(lead, `/api/vanthu/docs?book=NOIBO&q=${encodeURIComponent('hướng dẫn qua Claude')}`), 200)).filter(x => x.title.includes(TAG)).length).toBe(1);
  // Người soạn qua Claude đọc dự thảo của mình; Người phê duyệt qua Claude không đọc dự thảo của người khác (giao diện thì có).
  expect((await viaToken(lead, tLead, `/api/vanthu/docs/${d.id}`)).status()).toBe(200);
  expect((await viaToken(dir, tDir, `/api/vanthu/docs/${d.id}`)).status()).toBe(404);
  expect((await apiAs(dir, `/api/vanthu/docs/${d.id}`)).status()).toBe(200);
  // Không vào sổ / phê duyệt / trả lại / sửa qua Claude.
  expect((await viaToken(lead, tLead, '/api/vanthu/docs', { method: 'POST', data: { series: 'D7', entity: 'HLD', departmentId: kd.id, docType: 'HD', title: 'x' } })).status()).toBe(403);
  for (const p of ['approve', 'return', 'resubmit']) expect((await viaToken(dir, tDir, `/api/vanthu/docs/${d.id}/${p}`, { method: 'POST', data: { reason: 'x' } })).status()).toBe(403);
  expect((await viaToken(lead, tLead, `/api/vanthu/docs/${d.id}`, { method: 'PATCH', data: { title: 'x' } })).status()).toBe(403);
  // Cấp Ban TGĐ: Claude không đọc kể cả với tài khoản Ban TGĐ.
  const board = (await json(await apiAs(dir, `/api/vanthu/docs?book=NOIBO&q=${TAG}`), 200)).find(x => x.viewLevel.code === 'BOARD');
  expect((await viaToken(dir, tDir, `/api/vanthu/docs/${board.id}`)).status()).toBe(404);
  // Người phê duyệt duyệt trên giao diện.
  expect((await json(await approve(dir, d.id), 200)).number).toMatch(/\/HD-KD$/);
});

test('Q6. Giao diện: dự thảo hiện "Dự thảo", Người phê duyệt thấy nút Phê duyệt → có số; người không phải Người phê duyệt không thấy nút', async ({ browser }) => {
  const dir = pages.giamdoc, clerk = await as(browser, 'nv.hcns');
  const d = await draft(dir, { title: `${TAG} quy định giao diện (giả)`, docType: 'QyĐ' });
  await go(clerk, `#/vanthu/${d.id}`);
  await expect(clerk.locator('#view h1')).toHaveText('Dự thảo');
  await expect(clerk.getByTestId('vt-approve')).toHaveCount(0);
  await expect(clerk.getByTestId('vt-edit')).toBeVisible(); // Văn thư sửa được dự thảo cấp Mọi người
  await go(dir, `#/vanthu?book=NOIBO&q=${TAG}`);
  await expect(dir.getByTestId('vt-list')).toContainText('quy định giao diện');
  await go(dir, `#/vanthu/${d.id}`);
  await expect(dir.getByTestId('vt-draft-note')).toContainText('Chưa có tệp PDF');
  await expect(dir.getByTestId('vt-approve')).toBeDisabled();
  await json(await pdfUp(dir, d.id), 201);
  await go(dir, '#/vanthu?book=NOIBO');
  await go(dir, `#/vanthu/${d.id}`);
  await dir.getByTestId('vt-approve').click();
  await dir.getByTestId('confirm-ok').click();
  await toast(dir, 'Đã phê duyệt');
  await expect(dir.locator('#view h1')).toContainText('/QyĐ-TGĐ');
  await expect(dir.getByTestId('vt-status')).toHaveText('Hiệu lực');
  await expect(dir.getByTestId('vt-approve')).toHaveCount(0);
});
