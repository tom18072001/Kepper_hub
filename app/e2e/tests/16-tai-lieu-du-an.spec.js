// Tài liệu (thay mục "Văn thư"): kho tài liệu theo dự án — dữ liệu GIẢ, kho file NAS giả (NAS_ROOT trong playwright.config.js).
// Menu "Tài liệu"; duyệt kiểu thư mục: Tất cả dự án → dự án → "Theo công việc" (tệp tải lên Hub theo hạng mục → việc) và
// "Thư mục dự án trên NAS" (mọi tệp có sẵn, kể cả không tải qua Hub — chỉ đọc); bộ lọc dự án, tìm theo tên tệp không dấu.
// Quyền ở máy chủ: chỉ thành viên dự án + Ban TGĐ; người ngoài nhận 404; chặn path traversal. Văn thư, Quy chế nội bộ là tab bên trong.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { login, apiAs } = require('./helpers');
const { NAS_ROOT } = require('../playwright.config');

test.describe.configure({ mode: 'serial' });

const KEY = 'TLDX';
const PROJ_DIR = path.join(NAS_ROOT, `${KEY}-DuongXaGia`);
const go = (page, hash) => page.evaluate(h => { location.hash = h; }, hash);
let projectId, itemCode, fileId;

test('T1. Chuẩn bị: dự án giả có thư mục trên NAS, một tệp tải lên trong việc, tệp có sẵn trên NAS', async ({ browser }) => {
  // Tệp có sẵn trên NAS (không qua Hub) + một tệp ngoài thư mục dự án để thử path traversal.
  fs.mkdirSync(path.join(PROJ_DIR, '01.PhapLy', 'GiayPhep'), { recursive: true });
  fs.mkdirSync(path.join(PROJ_DIR, '02.ThietKe'), { recursive: true });
  fs.writeFileSync(path.join(PROJ_DIR, '01.PhapLy', 'Quyết định chủ trương (giả).pdf'), '%PDF-1.4\n%%EOF');
  fs.writeFileSync(path.join(PROJ_DIR, '01.PhapLy', 'GiayPhep', 'GPXD-gia.pdf'), '%PDF-1.4\n%%EOF');
  fs.writeFileSync(path.join(PROJ_DIR, '02.ThietKe', 'mat-bang-gia.dwg'), 'dwg');
  fs.writeFileSync(path.join(PROJ_DIR, 'Thumbs.db'), 'x');
  fs.writeFileSync(path.join(NAS_ROOT, 'ngoai-du-an.txt'), 'khong duoc doc');

  const page = await (await browser.newContext()).newPage();
  await login(page, 'giamdoc');
  const people = await (await apiAs(page, '/api/users/directory')).json();
  const uid = u => people.find(p => p.username === u)?.id;
  const r = await apiAs(page, '/api/projects', { method: 'POST', data: { key: KEY, name: 'Nhà ở xã hội Dương Xá (giả)', visibility: 'PUBLIC' } });
  expect(r.status(), await r.text()).toBe(201);
  projectId = (await r.json()).id;
  const m = await apiAs(page, `/api/projects/${projectId}/members`, { method: 'PUT', data: { members: [{ userId: uid('giamdoc'), role: 'OWNER' }, { userId: uid('nv.kinhdoanh1'), role: 'MEMBER' }] } });
  expect(m.status(), await m.text()).toBeLessThan(300);
  const root = await (await apiAs(page, `/api/projects/${projectId}/items`, { method: 'POST', data: { title: 'Pháp lý dự án' } })).json();
  const child = await apiAs(page, `/api/projects/${projectId}/items`, { method: 'POST', data: { title: 'Xin giấy phép xây dựng', parentId: root.id } });
  expect(child.status(), await child.text()).toBe(201);
  const c = await child.json();
  itemCode = `${KEY}-${c.number}`;
  const up = await apiAs(page, `/api/items/${c.id}/attachments`, { method: 'POST', multipart: { files: { name: 'ho-so-xin-phep.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF') } } });
  expect(up.status(), await up.text()).toBe(201);
  const saved = (await up.json())[0];
  fileId = saved.id;
  expect(saved.storedIn).toBe('NAS'); // dự án có thư mục trên kho → bản gốc lưu vào NAS
});

test('T2. Menu "Tài liệu" → dự án → "Theo công việc" (hạng mục → việc → tệp) và "Thư mục dự án trên NAS" (chỉ đọc)', async ({ page }) => {
  await login(page, 'nv.kinhdoanh1');
  await expect(page.getByTestId('nav-tailieu')).toHaveText('Tài liệu');
  await page.getByTestId('nav-tailieu').click();
  await expect(page.locator('#view h1')).toHaveText('Tài liệu');
  await expect(page.getByTestId('doc-tab-projects')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('doc-tab-vanthu')).toBeVisible();
  await expect(page.getByTestId('doc-tab-noibo')).toHaveText('Quy chế, quy định nội bộ');

  // Bộ lọc dự án.
  await page.getByTestId('doc-project').selectOption(String(projectId));
  await expect(page.getByTestId('doc-src-hub')).toContainText('1 tệp');
  await expect(page.getByTestId('doc-src-nas')).toContainText(`${KEY}-DuongXaGia`);

  // Theo công việc: hạng mục → việc → tệp.
  await page.getByTestId('doc-src-hub').locator('a').click();
  await page.getByTestId(`doc-item-${KEY}-1`).locator('a').click();
  await page.getByTestId(`doc-item-${itemCode}`).locator('a').click();
  await expect(page.getByTestId('doc-file')).toHaveCount(1);
  await expect(page.getByTestId('doc-file')).toContainText('ho-so-xin-phep.pdf');
  await expect(page.getByTestId('doc-path')).toContainText('Theo công việc');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('doc-dl').click()]);
  expect(dl.suggestedFilename()).toBe('ho-so-xin-phep.pdf');

  // Thư mục NAS: thư mục trước, tệp hệ thống ẩn; tệp tải qua Hub được đánh dấu mã việc.
  await go(page, `#/tai-lieu?p=${projectId}&src=nas`);
  const names = page.getByTestId('doc-list').locator('tbody tr td:first-child');
  await expect(names).toHaveText(['01.PhapLy', '02.ThietKe', `${KEY}-1_PhapLyDuAn`]); // thư mục hạng mục do Hub tạo khi tải tệp lên
  await expect(page.getByTestId('doc-list')).not.toContainText('Thumbs.db');
  await page.getByTestId('doc-dir').filter({ hasText: '01.PhapLy' }).locator('a').click();
  await expect(page.getByTestId('doc-file')).toContainText('Quyết định chủ trương (giả).pdf');
  await page.getByTestId('doc-dir').filter({ hasText: 'GiayPhep' }).locator('a').click();
  await expect(page.getByTestId('doc-path')).toContainText('GiayPhep');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('doc-dl').click()]);
  expect(dl2.suggestedFilename()).toBe('GPXD-gia.pdf');
  // Tệp tải lên Hub nằm trong thư mục hạng mục trên NAS, có liên kết về việc.
  await go(page, `#/tai-lieu?p=${projectId}&src=nas&path=${encodeURIComponent(`${KEY}-1_PhapLyDuAn`)}`);
  await expect(page.getByTestId('doc-file')).toContainText(itemCode);

  // Tìm theo tên tệp (không dấu): ra cả tệp Hub và tệp NAS.
  await go(page, `#/tai-lieu?p=${projectId}`);
  await expect(page.getByTestId('doc-src-hub')).toBeVisible();
  await page.getByTestId('doc-q').fill('quyet dinh');
  await expect(page.getByTestId('doc-file').first()).toContainText('Quyết định chủ trương (giả).pdf');
  await page.getByTestId('doc-q').fill('ho so');
  await expect(page.getByTestId('doc-file').first()).toContainText('ho-so-xin-phep.pdf');
});

test('T3. Quyền ở máy chủ: người không là thành viên không thấy dự án (404), không đọc được NAS; chặn path traversal', async ({ browser }) => {
  const out = await (await browser.newContext()).newPage();
  await login(out, 'nv.kinhdoanh2'); // cùng phòng, không là thành viên dự án
  const list = await (await apiAs(out, '/api/documents/projects')).json();
  expect(list.projects.some(p => p.key === KEY)).toBe(false);
  for (const u of [`/api/documents/files/${fileId}`, `/api/documents/projects/${projectId}/hub`, `/api/documents/projects/${projectId}/nas`, `/api/documents/projects/${projectId}/nas/file?path=02.ThietKe/mat-bang-gia.dwg`])
    expect((await apiAs(out, u)).status(), u).toBe(404);
  await go(out, `#/tai-lieu?p=${projectId}`);
  await expect(out.getByTestId('doc-path')).toHaveText('Tất cả dự án'); // dự án không có trong bộ lọc → về danh sách
  await expect(out.getByTestId('doc-list').or(out.getByTestId('doc-empty'))).not.toContainText(KEY);

  // Quản trị IT không đọc tài liệu nghiệp vụ.
  const it = await (await browser.newContext()).newPage();
  await login(it, 'admin');
  expect((await apiAs(it, `/api/documents/projects/${projectId}/nas`)).status()).toBe(404);

  // Thành viên: đường dẫn ra ngoài thư mục dự án bị chặn.
  const mem = await (await browser.newContext()).newPage();
  await login(mem, 'nv.kinhdoanh1');
  for (const p of ['../ngoai-du-an.txt', '..%2Fngoai-du-an.txt', '01.PhapLy/../../ngoai-du-an.txt', '..\\ngoai-du-an.txt']) {
    const r = await apiAs(mem, `/api/documents/projects/${projectId}/nas/file?path=${p.includes('%') ? p : encodeURIComponent(p)}`);
    expect(r.status(), p).toBe(400);
  }
  expect((await apiAs(mem, `/api/documents/projects/${projectId}/nas?path=..`)).status()).toBe(400);
  // Ban TGĐ (không cần là thành viên) xem được.
  const pgd = await (await browser.newContext()).newPage();
  await login(pgd, 'giamdoc');
  expect((await apiAs(pgd, `/api/documents/projects/${projectId}/nas?path=02.ThietKe`)).status()).toBe(200);
  // Tải bằng đường dẫn tuyệt đối: bị coi là tương đối trong thư mục dự án → không ra ngoài.
  const absPath = require('node:path').join(NAS_ROOT, 'ngoai-du-an.txt');
  expect([400, 404], absPath).toContain((await apiAs(pgd, `/api/documents/projects/${projectId}/nas/file?path=${encodeURIComponent(absPath)}`)).status());
  expect((await apiAs(pgd, `/api/documents/projects/${projectId}/nas/file?path=${encodeURIComponent('/etc/passwd')}`)).status()).toBe(404);

  // Claude (token) xem danh sách được nhưng KHÔNG tải nội dung tệp — cả tệp Hub lẫn tệp NAS.
  const tk = await apiAs(mem, '/api/me/tokens', { method: 'POST', data: { name: 'Thử tải tệp (giả)' } });
  expect(tk.status(), await tk.text()).toBe(201);
  const token = (await tk.json()).token;
  const T = u => mem.request.fetch(u, { headers: { authorization: 'Bearer ' + token } });
  expect((await T(`/api/documents/projects/${projectId}/nas`)).status()).toBe(200);
  expect((await T(`/api/documents/files/${fileId}`)).status()).toBe(403);
  expect((await T(`/api/documents/projects/${projectId}/nas/file?path=02.ThietKe/mat-bang-gia.dwg`)).status()).toBe(403);

  // Việc đã xoá (thùng rác): tệp của việc không tải được qua mục Tài liệu, không còn trong cây.
  const extra = await (await apiAs(pgd, `/api/projects/${projectId}/items`, { method: 'POST', data: { title: 'Việc sẽ xoá (giả)' } })).json();
  const up = await apiAs(pgd, `/api/items/${extra.id}/attachments`, { method: 'POST', multipart: { files: { name: 'se-xoa.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF') } } });
  expect(up.status(), await up.text()).toBe(201);
  const extraFile = (await up.json())[0].id;
  expect((await apiAs(mem, `/api/documents/files/${extraFile}`)).status()).toBe(200);
  expect((await apiAs(pgd, `/api/items/${extra.id}`, { method: 'DELETE' })).status()).toBeLessThan(300);
  expect((await apiAs(mem, `/api/documents/files/${extraFile}`)).status()).toBe(404);
  expect((await (await apiAs(mem, `/api/documents/projects/${projectId}/hub`)).json()).files.some(f => f.id === extraFile)).toBe(false);
});

test('T4. Văn thư vẫn chạy như cũ, nằm trong "Tài liệu": tab Văn thư (đến / đi / tôi xử lý) và tab Quy chế, quy định nội bộ', async ({ page }) => {
  await login(page, 'giamdoc');
  await page.getByTestId('nav-tailieu').click();
  await page.getByTestId('doc-tab-vanthu').click();
  await expect(page.getByTestId('vt-tab-DEN')).toBeVisible();
  await expect(page.getByTestId('vt-tab-NOIBO')).toHaveCount(0);
  await expect(page.getByTestId('nav-tailieu')).toHaveClass(/active/);
  await expect(page.locator('#crumbs')).toContainText('Tài liệu / Văn thư');
  await page.getByTestId('doc-tab-noibo').click();
  await expect(page.getByTestId('doc-tab-noibo')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#crumbs')).toContainText('Quy chế, quy định nội bộ');
  // Vào sổ văn bản nội bộ (D5 quyết định) vẫn cấp số như cũ.
  const r = await apiAs(page, '/api/vanthu/docs', { method: 'POST', data: { series: 'D5', entity: 'HLD', title: 'Quyết định ban hành quy chế (giả)' } });
  expect(r.status(), await r.text()).toBe(201);
  expect((await r.json()).number).toMatch(/^\d{3}\/\d{4}\/QĐ-HLD$/);
});

test('T5. Người không thuộc dự án nào (vd. văn thư HCNS) bấm "Tài liệu" → vào thẳng tab Văn thư; tab "Tài liệu dự án" vẫn mở được', async ({ page, browser }) => {
  // Tài khoản giả mới ở phòng HCNS, chưa thuộc dự án nào (mọi tài khoản seed đều đã có dự án).
  const admin = await (await browser.newContext()).newPage();
  await login(admin, 'admin');
  const hcns = (await (await apiAs(admin, '/api/departments')).json()).find(d => d.code === 'HCNS');
  const r = await apiAs(admin, '/api/admin/users', { method: 'POST', data: { username: 'vt.hcns.gia', fullName: 'Văn thư HCNS (giả)', displayTitle: 'Văn thư (giả)', role: 'member', departmentId: hcns.id } });
  expect([200, 201, 409], await r.text()).toContain(r.status());
  await login(page, 'vt.hcns.gia');
  expect((await (await apiAs(page, '/api/documents/projects')).json()).projects).toEqual([]);
  await page.getByTestId('nav-tailieu').click();
  await expect(page).toHaveURL(/#\/vanthu\?book=DEN$/);
  await expect(page.getByTestId('doc-tab-vanthu')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('vt-tab-DEN')).toBeVisible();
  await page.getByTestId('doc-tab-projects').click();
  await expect(page.getByTestId('doc-empty')).toContainText('chưa là thành viên dự án nào');
  // Người có dự án: menu mở tab Tài liệu dự án như cũ (kiểm ở T2).
});
