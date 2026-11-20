// Chụp ảnh cho bộ hướng dẫn sử dụng (docs/huong-dan-su-dung/anh/*.png).
//
// CHỈ chạy trên BẢN CÀI THỬ có dữ liệu GIẢ (seed mẫu + kịch bản simulate-project.mjs). Script tự từ chối nếu:
//   - địa chỉ không phải localhost / 127.0.0.1;
//   - không có dự án mẫu "BM — Khu nhà ở Bình Minh (giả)".
// Script đổi dữ liệu thử (tạo việc nhánh, gửi duyệt, duyệt, vào sổ văn bản giả, đơn nghỉ giả…) — không bao giờ chạy trên bản thật.
//
// Cách dựng bản thử và chạy: xem docs/huong-dan-su-dung/chup-anh.md
//   cd app/e2e && npm ci
//   BASE=http://localhost:4530 node huong-dan/chup-anh.mjs            # chụp tất cả
//   BASE=http://localhost:4530 ONLY=du-an node huong-dan/chup-anh.mjs # chỉ nhóm ảnh có tên bắt đầu bằng "du-an"
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = String(process.env.BASE || 'http://localhost:4530').replace(/\/+$/, '');
const PW = process.env.PLAY_PW || 'Play@2026';
const OUT = process.env.OUT || path.join(HERE, '..', '..', '..', 'docs', 'huong-dan-su-dung', 'anh');
const ONLY = process.env.ONLY || '';
const VIEWPORT = { width: 1440, height: 900 };

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`Từ chối: ${BASE} không phải bản cài thử trên máy này (chỉ localhost / 127.0.0.1).`);
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

// ---------- API ----------
const tokens = {};
async function raw(method, p, { token, body } = {}) {
  const headers = { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
  const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = (r.headers.get('content-type') || '').includes('json') ? await r.json().catch(() => null) : null;
  return { s: r.status, j };
}
async function login(u) {
  if (tokens[u]) return tokens[u];
  for (const pw of [PW, '12345678']) {
    const r = await raw('POST', '/api/auth/login', { body: { username: u, password: pw } });
    if (r.s !== 200) continue;
    let t = r.j.token;
    if (r.j.user?.mustChangePw || pw !== PW) {
      const c = await raw('POST', '/api/me/password', { token: t, body: { currentPassword: pw, newPassword: PW } });
      if (c.s === 200) t = c.j.token;
    }
    return (tokens[u] = t);
  }
  throw new Error(`Không đăng nhập được ${u} — đã chạy simulate-project.mjs trên bản thử chưa?`);
}
async function as(u, method, p, body) {
  const r = await raw(method, p, { token: await login(u), body });
  if (r.s >= 400) console.warn(`  ! ${u} ${method} ${p} → ${r.s} ${r.j?.error || ''}`);
  return r;
}

// ---------- Trình duyệt ----------
let browser;
async function pageAs(u) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  const token = u ? await login(u) : null;
  await ctx.addInitScript(([t, full]) => {
    try {
      if (t) localStorage.setItem('workhub_token', t);
      // Không hiện mẹo "lần đầu" / hướng dẫn nổi che nội dung.
      localStorage.setItem('workhub:tips:off', '1');
      if (t && full) { const id = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).id; localStorage.setItem(`workhub:u${id}:ip:full`, 'true'); }
    } catch { /* bỏ qua */ }
  }, [token, true]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  return page;
}
async function go(page, hash) {
  if (!page.url().startsWith(BASE)) await page.goto(BASE + '/' + hash);
  else await page.evaluate(h => { location.hash = h; }, hash);
  // Không chờ "networkidle": trang luôn giữ một kết nối realtime (SSE) nên không bao giờ "rảnh mạng".
  await page.waitForSelector('#viewBody, #appShell:not(.hidden), body', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
// Đánh dấu chỗ cần bấm: khung đỏ + số thứ tự.
async function mark(page, locator, n = '') {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator.first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.evaluate((node, label) => {
    node.setAttribute('data-hd-mark', '1');
    node.style.outline = '3px solid #e5383b';
    node.style.outlineOffset = '3px';
    node.style.borderRadius = getComputedStyle(node).borderRadius || '6px';
    if (label) {
      const b = document.createElement('span');
      b.className = 'hd-badge';
      b.textContent = label;
      const r = node.getBoundingClientRect();
      Object.assign(b.style, { position: 'fixed', left: `${Math.max(2, r.left - 14)}px`, top: `${Math.max(2, r.top - 14)}px`, zIndex: 99999, background: '#e5383b', color: '#fff',
        font: '700 14px/24px system-ui, sans-serif', width: '24px', height: '24px', borderRadius: '50%', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,.35)' });
      document.body.appendChild(b);
    }
  }, String(n));
}
async function unmark(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-hd-mark]').forEach(n => { n.style.outline = ''; n.style.outlineOffset = ''; n.removeAttribute('data-hd-mark'); });
    document.querySelectorAll('.hd-badge').forEach(n => n.remove());
  });
}
// Địa chỉ thật nhân viên dùng. Trang nào in địa chỉ máy chủ (vd. "Kết nối Claude": ô Địa chỉ Kepler Hub đã điền sẵn …)
// thì ảnh hiện địa chỉ này thay cho địa chỉ bản cài thử — chỉ đổi chữ hiển thị trước khi chụp, không đổi dữ liệu.
const PUBLIC_ORIGIN = String(process.env.PUBLIC_ORIGIN || 'https://hub.keplerholdings.vn').replace(/\/+$/, '');
async function showPublicOrigin(page) {
  const from = new URL(BASE).origin;
  await page.evaluate(([a, b]) => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.includes(a)) n.nodeValue = n.nodeValue.split(a).join(b);
  }, [from, PUBLIC_ORIGIN]);
}
const shots = [];
async function shot(page, name, { el, fullPage = false, maxHeight } = {}) {
  const file = path.join(OUT, `${name}.png`);
  await page.waitForTimeout(250);
  await showPublicOrigin(page);
  if (el) {
    const loc = typeof el === 'string' ? page.locator(el).first() : el.first();
    const box = maxHeight ? await loc.boundingBox() : null;
    if (box) await page.screenshot({ path: file, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, maxHeight) } });
    else await loc.screenshot({ path: file });
  } else await page.screenshot({ path: file, fullPage });
  await unmark(page);
  shots.push(name);
  console.log(`  ✓ ${name}.png`);
}
const want = group => !ONLY || ONLY.split(',').some(g => group.startsWith(g));

// ---------- Dữ liệu ----------
const ctx = {};
async function prepare() {
  const projects = (await as('pmo', 'GET', '/api/projects')).j;
  const bm = projects.find(p => p.key === 'BM' && /\(giả\)/.test(p.name));
  if (!bm) { console.error('Từ chối: không thấy dự án mẫu "BM — Khu nhà ở Bình Minh (giả)". Chạy simulate-project.mjs trên bản thử trước.'); process.exit(2); }
  ctx.bm = bm;
  const proj = (await as('pmo', 'GET', `/api/projects/${bm.id}`)).j;
  ctx.states = Object.fromEntries(proj.states.map(s => [s.category, s]));
  const items = (await as('pmo', 'GET', `/api/projects/${bm.id}/items`)).j;
  ctx.items = items;
  ctx.byCode = c => items.find(i => i.code === c);
  ctx.users = Object.fromEntries((await as('pmo', 'GET', '/api/users/directory')).j.map(u => [u.username, u]));
}
const itemHash = (id, extra = '') => `#/projects/${ctx.bm.id}?item=${id}${extra}`;

// ---------- Các nhóm ảnh ----------
const groups = [];
const group = (name, fn) => groups.push([name, fn]);

group('01-dang-nhap', async () => {
  const page = await pageAs(null);
  await page.goto(BASE + '/');
  await page.getByTestId('login-username').fill('nv.phaply');
  await page.getByTestId('login-password').fill('xxxxxxxx');
  await mark(page, page.getByTestId('login-submit'));
  await shot(page, '01-dang-nhap');
  await page.goto(BASE + '/install.html');
  await shot(page, '01-cai-len-may');
  await page.context().close();
});

group('02-trang-chu', async () => {
  const page = await pageAs('nv.phaply');
  await go(page, '#/today');
  await shot(page, '02-trang-chu');
  await page.getByTestId('notif-btn').click();
  await page.waitForTimeout(600);
  await shot(page, '02-thong-bao');
  await page.keyboard.press('Escape');
  await page.getByTestId('palette-open').click();
  await page.getByTestId('palette-input').fill('to trinh');
  await page.waitForTimeout(900);
  await shot(page, '02-tim-nhanh');
  await page.context().close();
});

group('03-ket-noi', async () => {
  // Bắt đầu từ "chưa có máy nào kết nối": thu hồi kết nối do lần chụp trước để lại (chỉ trên bản thử).
  const old = await as('nv.phaply', 'GET', '/api/me/tokens');
  for (const t of Array.isArray(old.j) ? old.j : (old.j?.tokens || [])) if (!t.revokedAt) await as('nv.phaply', 'DELETE', `/api/me/tokens/${t.id}`);
  const page = await pageAs('nv.phaply');
  // Kết nối đã thu hồi của các lần chụp trước vẫn nằm trong danh sách (dòng "Đã thu hồi"): ẩn khỏi ảnh để giống máy dùng lần đầu.
  const hideRevoked = () => page.evaluate(() => {
    const body = document.querySelector('section.cl-list tbody');
    if (!body) return;
    body.querySelectorAll('tr').forEach(tr => { if (/Đã thu hồi/.test(tr.textContent)) tr.remove(); });
    if (!body.querySelector('tr')) body.innerHTML = '<tr><td colspan="5" class="empty">Chưa có máy nào kết nối.</td></tr>';
  });
  await go(page, '#/today');
  await page.getByTestId('user-menu').click();
  await page.waitForTimeout(400);
  await mark(page, page.getByTestId('nav-claude'), '1');
  await shot(page, '03-menu-ket-noi-claude');
  await page.keyboard.press('Escape');
  await go(page, '#/claude');
  await mark(page, page.getByTestId('claude-mcpb'), '1');
  await hideRevoked();
  await shot(page, '03-trang-ket-noi-claude');
  const start = await raw('POST', '/api/claude/connect/start', { body: { device: 'LAPTOP-PHAPLY-01' } });
  await go(page, `#/claude?connect=${start.j.userCode}`);
  await page.waitForSelector('[data-testid="claude-connect"]');
  await mark(page, page.getByTestId('claude-connect-approve'), '2');
  await hideRevoked();
  await shot(page, '03-cho-phep');
  await page.getByTestId('claude-connect-approve').click();
  await page.waitForTimeout(1200);
  await hideRevoked();
  await shot(page, '03-da-ket-noi');
  await page.locator('details.cl-manual summary').click();
  await page.waitForTimeout(400);
  await hideRevoked();
  await shot(page, '03-token-thu-cong', { el: 'section.cl-list' });
  await page.context().close();
});

group('04-du-an', async () => {
  const bm10 = ctx.byCode('BM-10'), bm11 = ctx.byCode('BM-11');
  // Việc nhánh dưới BM-11 (người chủ trì tự chia việc của mình).
  const detail11 = (await as('nv.phaply', 'GET', `/api/items/${bm11.id}`)).j;
  if (!(detail11.children || []).length) {
    for (const [t, d] of [['Chuẩn bị bộ hồ sơ gửi Sở (giả)', 3], ['Gửi công văn xin ý kiến Sở (giả)', 6], ['Theo dõi, giải trình ý kiến của Sở (giả)', 14]])
      await as('nv.phaply', 'POST', `/api/projects/${ctx.bm.id}/items`, { title: t, parentId: bm11.id, assigneeIds: [ctx.users['nv.phaply'].id], dueDate: new Date(Date.now() + d * 864e5).toISOString().slice(0, 10) });
  }
  const page = await pageAs('nv.phaply');
  await go(page, `#/projects/${ctx.bm.id}?view=mtl`);
  await shot(page, '04-du-an-tong-quan');
  await go(page, `#/projects/${ctx.bm.id}?view=board`);
  await shot(page, '04-du-an-bang');
  await go(page, `#/my`);
  await shot(page, '04-viec-cua-toi');
  // Chi tiết việc: người chủ trì.
  await go(page, itemHash(bm11.id));
  await page.waitForSelector('[data-testid="item-panel"]:not(.hidden)');
  await page.waitForTimeout(800);
  await shot(page, '04-viec-chi-tiet');
  await mark(page, page.getByTestId('my-roles'), '1');
  await shot(page, '04-vai-cua-toi', { el: '[data-testid="item-panel"]' });
  const childInput = page.getByTestId('child-input');
  if (await childInput.count()) { await mark(page, childInput, '1'); await shot(page, '04-viec-nhanh', { el: '[data-testid="item-panel"]' }); }
  // BM-10: báo cáo tiến độ, xin gia hạn, gửi duyệt.
  await go(page, itemHash(bm10.id));
  await page.waitForTimeout(800);
  const report = page.getByTestId('item-panel').getByRole('button', { name: 'Báo cáo tiến độ' }).first();
  if (await report.count()) {
    await mark(page, report, '1');
    await shot(page, '04-bao-cao-tien-do-nut', { el: '[data-testid="item-panel"]', maxHeight: 420 });
    await report.click();
    await page.waitForTimeout(700);
    await shot(page, '04-bao-cao-tien-do');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  const ext = page.getByTestId('request-extension');
  if (await ext.count()) {
    await mark(page, ext, '1');
    await shot(page, '04-xin-gia-han-nut', { el: '[data-testid="item-panel"]', maxHeight: 700 });
    await ext.click();
    await page.waitForTimeout(700);
    await shot(page, '04-xin-gia-han');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  const submit = page.getByTestId('submit-approval');
  if (await submit.count()) {
    await mark(page, submit, '1');
    await shot(page, '04-gui-duyet', { el: '[data-testid="item-panel"]' });
    await submit.click();
    await page.waitForTimeout(1200);
    await shot(page, '04-da-gui-duyet', { el: '[data-testid="item-panel"]' });
  }
  await page.context().close();

  // Người duyệt: Chờ tôi duyệt + chấm mức.
  const d10 = (await as('pmo', 'GET', `/api/items/${bm10.id}`)).j;
  ctx.approver = d10.assignedBy?.username || 'tb.phaply';
  console.log(`  · người duyệt BM-10: ${ctx.approver}`);
  const appr = await pageAs(ctx.approver);
  await go(appr, '#/approvals');
  await shot(appr, '04-cho-toi-duyet');
  await go(appr, `#/approvals?item=${bm10.id}`);
  await appr.waitForTimeout(900);
  const rate = appr.getByTestId('rating-GOOD');
  if (await rate.count()) {
    await rate.check();
    await appr.locator('#approval-zone textarea, [data-testid="approval-comment"]').first().fill('Tờ trình đủ ý, trình đúng hạn (giả).').catch(() => {});
    await mark(appr, appr.locator('.rating-opts'), '1');
    await mark(appr, appr.getByTestId('approve-btn'), '2');
    await shot(appr, '04-duyet-cham-muc', { el: '[data-testid="item-panel"]', maxHeight: 560 });
    await appr.getByTestId('approve-btn').click();
    await appr.waitForTimeout(1200);
  }
  await appr.context().close();
  // Người chủ trì thấy kết quả duyệt + mức chấm.
  const back = await pageAs('nv.phaply');
  await go(back, itemHash(bm10.id));
  await back.waitForTimeout(900);
  const rated = back.getByTestId('item-assessment').or(back.getByTestId('item-rating')).first();
  if (await rated.count()) { await mark(back, rated, ''); await rated.evaluate(n => n.scrollIntoView({ block: 'center' })); }
  await shot(back, '04-ket-qua-duyet', { el: '[data-testid="item-panel"]' });
  await back.context().close();

  // Thành viên không liên quan: chỉ thấy tóm tắt.
  const other = await pageAs('nv.qlxd');
  await go(other, itemHash(bm11.id));
  await other.waitForTimeout(900);
  await shot(other, '04-chi-tom-tat', { el: '[data-testid="item-panel"]', maxHeight: 360 });
  await other.context().close();
});

group('05-cap-nhat-nhanh', async () => {
  const page = await pageAs('nv.phaply');
  await go(page, '#/today');
  await mark(page, page.getByRole('link', { name: 'Cập nhật nhanh' }).last(), '1');
  await shot(page, '05-mo-cap-nhat-nhanh', { el: 'body', maxHeight: 200 });
  await go(page, '#/sprint');
  const card = page.locator('[data-testid^="qk-project-"]').last();
  const pct = card.getByRole('button', { name: '50%' }).first();
  if (await pct.count()) await mark(page, pct, '2');
  const done = card.getByRole('button', { name: /Gửi duyệt/ }).first();
  if (await done.count()) await mark(page, done, '3');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '05-cap-nhat-nhanh');
  await page.context().close();
});

group('06-bao-cao-tuan', async () => {
  const page = await pageAs('tb.phaply');
  await go(page, '#/tuan');
  await shot(page, '06-bao-cao-tuan');
  const cause = page.locator('[data-testid^="wk-cause-"]').first();
  if (await cause.count()) {
    await cause.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -260));
    await mark(page, cause, '1');
    await shot(page, '06-nguyen-nhan-giai-phap');
  }
  const submit = page.getByTestId('wk-submit');
  if (await submit.count()) {
    await mark(page, submit, '2');
    await page.evaluate(() => window.scrollBy(0, -300));
    await shot(page, '06-gui-bao-cao');
  }
  await page.context().close();
  const gd = await pageAs('giamdoc');
  await go(gd, '#/tuan/tong-hop');
  await shot(gd, '06-tong-hop-giao-ban');
  await gd.context().close();
});

group('07-van-thu', async () => {
  const meta = (await as('giamdoc', 'GET', '/api/vanthu/meta')).j;
  const entity = meta?.entities?.[0]?.code || meta?.config?.entities?.[0]?.code;
  const have = (await as('giamdoc', 'GET', '/api/vanthu/docs?book=DEN')).j;
  if (entity && !(Array.isArray(have) ? have : have?.items || []).length) {
    const h = ctx.users['nv.phaply'].id;
    await as('giamdoc', 'POST', '/api/vanthu/docs', { series: 'D10', entity, title: 'Công văn mẫu của Sở Xây dựng tỉnh Mẫu về hồ sơ chủ trương đầu tư (giả)', counterpart: 'Sở Xây dựng tỉnh Mẫu (giả)', externalNumber: '123/SXD-QLN', docType: 'CV', urgency: 'KHAN', handlerId: h });
    await as('giamdoc', 'POST', '/api/vanthu/docs', { series: 'D10', entity, title: 'Thông báo mẫu lịch tiếp công dân quý IV (giả)', counterpart: 'UBND phường Mẫu (giả)', docType: 'TB' });
    await as('giamdoc', 'POST', '/api/vanthu/docs', { series: 'D9', entity, title: 'Công văn đề nghị cung cấp thông tin quy hoạch (giả)', counterpart: 'Sở Quy hoạch – Kiến trúc tỉnh Mẫu (giả)', docType: 'CV' });
    await as('giamdoc', 'POST', '/api/vanthu/docs', { series: 'D6', entity, title: 'Tờ trình mẫu phê duyệt kế hoạch tháng 12 (giả)', docType: 'TTr' });
  } else if (!entity) console.warn('  ! Văn thư chưa có pháp nhân — bỏ qua tạo văn bản mẫu');
  const page = await pageAs('giamdoc');
  await go(page, '#/vanthu?book=DEN');
  await mark(page, page.getByTestId('vt-new'), '1');
  await shot(page, '07-van-thu-den');
  await page.getByTestId('vt-new').click().catch(() => {});
  await page.waitForTimeout(700);
  await shot(page, '07-van-thu-vao-so');
  await page.keyboard.press('Escape');
  await go(page, '#/vanthu?book=DI');
  await shot(page, '07-van-thu-di');
  await go(page, '#/vanthu?book=NOIBO');
  await shot(page, '07-van-thu-noi-bo');
  await page.context().close();
  // Người xử lý: tab "Tôi xử lý" → mở văn bản → tải bản scan lên (Hub lưu thẳng vào NAS).
  const nv = await pageAs('nv.phaply');
  await go(nv, '#/vanthu?book=mine');
  await shot(nv, '07-van-thu-toi-xu-ly');
  const first = nv.getByTestId('vt-list').locator('a').first();
  if (await first.count()) {
    await first.click(); await nv.waitForTimeout(900);
    const input = nv.getByTestId('vt-file-input');
    if (await input.count() && !(await nv.getByTestId('vt-file-nas').count())) {
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
      await input.setInputFiles({ name: 'scan-cong-van-mau-gia.pdf', mimeType: 'application/pdf', buffer: pdf });
      await nv.waitForTimeout(1500);
    }
    const nas = nv.getByTestId('vt-file-nas').first();
    if (await nas.count()) await mark(nv, nas, '');
    await shot(nv, '07-van-thu-chi-tiet');
  }
  await nv.context().close();
});

group('08-nhan-su', async () => {
  // Thêm một đơn nghỉ chờ duyệt (giả) cho tb.phaply duyệt.
  const mine = (await as('nv.phaply', 'GET', '/api/hrm/leaves?scope=mine')).j || [];
  if (!mine.some(l => l.status === 'PENDING')) {
    const d = new Date(Date.now() + 14 * 864e5); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    const day = d.toISOString().slice(0, 10);
    const types = (await as('nv.phaply', 'GET', '/api/hrm/meta')).j?.leaveTypes || [];
    await as('nv.phaply', 'POST', '/api/hrm/leaves', { type: types[0]?.code || 'ANNUAL', fromDate: day, toDate: day, reason: 'Việc gia đình (giả)' });
  }
  const page = await pageAs('nv.phaply');
  await go(page, '#/hrm');
  const inOut = page.getByTestId('hrm-check-in').or(page.getByTestId('hrm-check-out')).first();
  if (await inOut.count()) await mark(page, inOut, '1');
  await mark(page, page.getByTestId('hrm-leave-new'), '2');
  await shot(page, '08-nhan-su-cua-toi');
  await page.getByTestId('hrm-leave-new').click().catch(() => {});
  await page.waitForTimeout(700);
  await page.getByTestId('hrm-l-reason').fill('Việc gia đình (giả)').catch(() => {});
  await page.waitForTimeout(300);
  await shot(page, '08-xin-nghi');
  await page.context().close();
  const lead = await pageAs('tb.phaply');
  await go(lead, '#/approvals?tab=hr');
  const ok = lead.getByRole('button', { name: 'Duyệt', exact: true }).first();
  if (await ok.count()) await mark(lead, ok, '1');
  await shot(lead, '08-cho-toi-duyet-don-nghi');
  await lead.context().close();
});

group('09-doi-tac', async () => {
  const page = await pageAs('nv.phaply');
  await go(page, '#/crm');
  await shot(page, '09-doi-tac');
  await page.getByTestId('crm-q').fill('so xay dung');
  await page.waitForTimeout(1000);
  const link = page.getByTestId('crm-partner-link').first();
  if (await link.count()) { await link.click(); await page.waitForTimeout(900); await shot(page, '09-doi-tac-chi-tiet'); }
  await page.context().close();
});

group('10-nhac-viec', async () => {
  const notes = (await as('nv.phaply', 'GET', '/api/me/notes')).j || [];
  if (!notes.length) await as('nv.phaply', 'POST', '/api/me/notes', { title: 'Gọi Sở Xây dựng hỏi tiến độ góp ý (giả)', dueDate: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) });
  const page = await pageAs('nv.phaply');
  await go(page, '#/my?tab=notes');
  const n = page.getByTestId('my-notes');
  if (await n.count()) await n.click().catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, '10-nhac-viec');
  await page.context().close();
});

// ---------- Ảnh riêng cho tài liệu lãnh đạo (Ban Giám đốc, lãnh đạo bộ phận, PMO, thư ký) ----------
group('20-lanh-dao', async () => {
  const gd = await pageAs('giamdoc');
  await go(gd, '#/home');
  await shot(gd, '20-ld-tien-do-cac-du-an');
  await go(gd, `#/projects/${ctx.bm.id}?view=mtl`);
  await shot(gd, '20-ld-tong-quan-du-an');
  await go(gd, `#/projects/${ctx.bm.id}?view=plan`);
  await shot(gd, '20-ld-gantt');
  await go(gd, '#/work');
  await shot(gd, '20-ld-viec-toan-don-vi');
  await go(gd, '#/dashboard');
  await shot(gd, '20-ld-thong-ke');
  await go(gd, '#/approvals?tab=extensions');
  const ext = gd.locator('[data-testid^="ext-approve-"]').first();
  if (await ext.count()) await mark(gd, ext, '1');
  await shot(gd, '20-ld-duyet-gia-han');
  await go(gd, '#/approvals?tab=proposals');
  await shot(gd, '20-ld-kien-nghi');
  await go(gd, '#/tuan/tong-hop');
  for (const [id, name] of [['wk-helps', '20-ld-yeu-cau-ho-tro'], ['wk-act-list', '20-ld-action-log']]) {
    const sec = gd.getByTestId(id).first();
    if (await sec.count()) { await sec.scrollIntoViewIfNeeded(); await gd.evaluate(() => window.scrollBy(0, -140)); await shot(gd, name); }
  }
  const copy = gd.getByTestId('wk-copy');
  if (await copy.count()) { await copy.scrollIntoViewIfNeeded(); await mark(gd, copy, ''); await gd.evaluate(() => window.scrollBy(0, -200)); await shot(gd, '20-ld-sao-chep-tong-hop'); }
  await go(gd, '#/tuan/diem');
  await shot(gd, '20-ld-cham-diem');
  await go(gd, '#/tuan/bao');
  await shot(gd, '20-ld-bao-muon-vang');
  await go(gd, '#/hrm/people');
  await shot(gd, '20-ld-danh-sach-nhan-su');
  await gd.context().close();

  // Lãnh đạo bộ phận giao việc mới trong dự án.
  const tb = await pageAs('tb.phaply');
  await go(tb, `#/projects/${ctx.bm.id}?view=board`);
  const nb = tb.getByTestId('new-item');
  if (await nb.count()) {
    await mark(tb, nb, '1');
    await shot(tb, '20-ld-giao-viec-nut', { el: 'body', maxHeight: 260 });
    await nb.click(); await tb.waitForTimeout(800);
    await tb.getByTestId('create-title').fill('Rà soát hồ sơ pháp lý đất đai (giả)').catch(() => {});
    await shot(tb, '20-ld-giao-viec');
    await tb.keyboard.press('Escape');
  }
  await go(tb, '#/hrm/team');
  await shot(tb, '20-ld-bang-cong-bo-phan');
  await tb.context().close();
});

// ---------- Chạy ----------
// --lang=vi-VN: ô ngày hiện dd/mm/yyyy như máy nhân viên (Windows tiếng Việt).
browser = await chromium.launch({ channel: 'chromium', args: ['--lang=vi-VN'] });
try {
  await prepare();
  for (const [name, fn] of groups) {
    if (!want(name)) continue;
    console.log(`▶ ${name}`);
    try { await fn(); } catch (e) { console.error(`  ✗ ${name}: ${e.message.split('\n')[0]}`); }
  }
} finally { await browser.close(); }
console.log(`Xong: ${shots.length} ảnh → ${OUT}`);
