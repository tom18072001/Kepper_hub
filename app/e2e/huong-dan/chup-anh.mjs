// Chụp ảnh cho bộ hướng dẫn sử dụng (docs/huong-dan-su-dung/anh/*.png).
//
// CHỈ chạy trên BẢN CÀI THỬ có dữ liệu GIẢ (seed mẫu + kịch bản simulate-project.mjs). Script tự từ chối nếu:
//   - địa chỉ không phải localhost / 127.0.0.1;
//   - không có dự án mẫu "BM — Khu nhà ở Bình Minh (giả)".
// Script đổi dữ liệu thử (tạo việc nhánh, gửi duyệt, duyệt, vào sổ văn bản giả, đơn nghỉ giả, thiết lập văn thư mẫu, quy chế mẫu,
// nộp báo cáo tuần mẫu, đưa một việc giả vào thùng rác…) — không bao giờ chạy trên bản thật.
// Chạy lại trên cùng bản thử được: mỗi nhóm tự kiểm dữ liệu đã có; chuỗi "báo tiến độ → gửi duyệt → duyệt" mỗi lần lấy một việc còn mở
// (hết thì tạo việc giả mới).
//
// Ảnh nhóm 30-quan-tri (Quản trị hệ thống) cần mật khẩu quản trị gốc CỦA BẢN THỬ trong biến môi trường ADMIN_PW
// (đọc từ tệp .env của bản thử lúc chạy). Không ghi mật khẩu này vào tệp nào trong repo; thiếu ADMIN_PW thì nhóm đó bị bỏ qua.
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
const ADMIN = process.env.ADMIN_USER || 'admin';
const ADMIN_PW = process.env.ADMIN_PW || '';
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
  // Quản trị gốc: chỉ đăng nhập, KHÔNG đổi mật khẩu (mật khẩu của bản thử, lấy từ ADMIN_PW).
  if (u === ADMIN) {
    if (!ADMIN_PW) throw new Error('Chưa đặt ADMIN_PW (mật khẩu quản trị gốc của bản thử)');
    const r = await raw('POST', '/api/auth/login', { body: { username: u, password: ADMIN_PW } });
    if (r.s !== 200) throw new Error(`Không đăng nhập được ${u} (${r.s}) — kiểm ADMIN_PW`);
    return (tokens[u] = r.j.token);
  }
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
// Tải tệp (vd. mẫu MTL Excel) / gửi tệp (multipart) bằng quyền của một tài khoản thử.
async function fetchBuf(u, p) {
  const r = await fetch(BASE + p, { headers: { authorization: 'Bearer ' + await login(u) } });
  if (!r.ok) throw new Error(`${u} GET ${p} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
async function upload(u, p, field, name, type, buf) {
  const fd = new FormData();
  fd.append(field, new Blob([buf], { type }), name);
  const r = await fetch(BASE + p, { method: 'POST', headers: { authorization: 'Bearer ' + await login(u) }, body: fd });
  if (!r.ok) console.warn(`  ! ${u} POST ${p} (tệp) → ${r.status} ${(await r.json().catch(() => null))?.error || ''}`);
  return r.ok;
}
const ascii = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
// PDF giả hợp lệ (một trang, chữ không dấu) có kích thước như bản scan nhỏ — để danh sách tệp không ghi "0 KB".
function fakePdf(title) {
  const text = ascii(title).replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '');
  const stream = `BT /F1 16 Tf 60 780 Td (${text}) Tj ET\nBT /F1 11 Tf 60 750 Td (Tai lieu mau - du lieu gia, chi dung cho ban cai thu Kepler Hub) Tj ET\n`
    + `% ${'Du lieu gia de minh hoa huong dan su dung. '.repeat(600)}\n`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`
    + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const PDF = 'application/pdf';
const vnDay = (n = 0) => new Date(Date.now() + n * 864e5 + 7 * 3600e3).toISOString().slice(0, 10);

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
// Đánh dấu chỗ cần bấm: khung đỏ + số thứ tự. Số đặt lại đúng chỗ ngay trước khi chụp (placeBadges), nên cuộn trang sau khi đánh dấu vẫn đúng.
let markSeq = 0;
async function mark(page, locator, n = '') {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator.first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.evaluate((node, [label, id]) => {
    node.setAttribute('data-hd-mark', id);
    node.style.outline = '3px solid #e5383b';
    node.style.outlineOffset = '3px';
    node.style.borderRadius = getComputedStyle(node).borderRadius || '6px';
    if (label) {
      const b = document.createElement('span');
      b.className = 'hd-badge';
      b.dataset.hdFor = id;
      b.textContent = label;
      Object.assign(b.style, { position: 'fixed', zIndex: 99999, background: '#e5383b', color: '#fff', pointerEvents: 'none',
        font: '700 14px/24px system-ui, sans-serif', width: '24px', height: '24px', borderRadius: '50%', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,.35)' });
      document.body.appendChild(b);
    }
  }, [String(n), String(++markSeq)]);
}
async function placeBadges(page) {
  await page.evaluate(() => document.querySelectorAll('.hd-badge').forEach(b => {
    const node = document.querySelector(`[data-hd-mark="${b.dataset.hdFor}"]`);
    if (!node) return b.remove();
    const r = node.getBoundingClientRect();
    b.style.left = `${Math.max(2, r.left - 14)}px`;
    b.style.top = `${Math.max(2, r.top - 14)}px`;
    b.style.display = r.bottom < 0 || r.top > innerHeight ? 'none' : '';
  }));
}
async function unmark(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-hd-mark]').forEach(n => { n.style.outline = ''; n.style.outlineOffset = ''; n.removeAttribute('data-hd-mark'); });
    document.querySelectorAll('.hd-badge').forEach(n => n.remove());
  });
}
// Bỏ viền tiêu điểm của nút vừa bấm (vd. sau khi đóng hộp thoại tiêu điểm quay về nút) để ảnh không có khung lạ.
const blur = page => page.evaluate(() => document.activeElement?.blur?.());
const noToast = page => page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
// Cuộn cửa sổ để phần tử nằm cách mép trên `offset` px (trừ thanh đầu trang / thanh tiêu đề dính của trang).
async function scrollTo(page, locator, offset = 90) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator.first();
  await el.evaluate((n, off) => window.scrollTo(0, n.getBoundingClientRect().top + window.scrollY - off), offset);
  await page.waitForTimeout(300);
}
// Đóng hộp thoại đang mở: Esc; đã nhập gì thì hệ thống hỏi "Bỏ nội dung đã nhập?" → Bỏ nội dung. Không lưu gì.
async function closeModal(page) {
  const open = () => page.locator('#modalRoot:not(.hidden)').count();
  for (let i = 0; i < 3 && await open(); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const yes = page.getByTestId('discard-yes');
    if (await yes.isVisible().catch(() => false)) { await yes.click(); await page.waitForTimeout(300); }
  }
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
async function shot(page, name, { el, fullPage = false, maxHeight, clip } = {}) {
  const file = path.join(OUT, `${name}.png`);
  // Chuột ra chỗ trống trên thanh đầu trang (không để lại nền "rê chuột" trên nút / dòng bảng); tắt gạch đỏ kiểm chính tả trong ô nhập.
  await page.mouse.move(340, 6).catch(() => {});
  await page.evaluate(() => document.querySelectorAll('input, textarea').forEach(e => { e.spellcheck = false; }));
  await page.waitForTimeout(250);
  await showPublicOrigin(page);
  await placeBadges(page);
  if (clip) await page.screenshot({ path: file, clip });
  else if (el) {
    const loc = typeof el === 'string' ? page.locator(el).first() : el.first();
    const box = maxHeight ? await loc.boundingBox() : null;
    if (box) await page.screenshot({ path: file, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, maxHeight) } });
    else await loc.screenshot({ path: file });
  } else await page.screenshot({ path: file, fullPage });
  await unmark(page);
  shots.push(name);
  console.log(`  ✓ ${name}.png`);
}
// Hộp thoại có thể cao hơn màn hình: tạm kéo cao khung nhìn để chụp trọn hộp (#modal), rồi trả lại kích thước cũ.
async function shotModal(page, name, { height = 1300 } = {}) {
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width, height });
  await page.waitForTimeout(400);
  try { await shot(page, name, { el: '#modal' }); } finally { await page.setViewportSize(vp); await page.waitForTimeout(200); }
}
// Chụp vùng bao quanh các phần tử (vd. chuông + bảng thông báo), chừa lề cho số đánh dấu. toRight: kéo vùng chụp tới mép phải màn hình.
async function shotAround(page, name, locators, { pad = 24, toRight = false } = {}) {
  const boxes = [];
  for (const l of locators) { const b = await (typeof l === 'string' ? page.locator(l) : l).first().boundingBox(); if (b) boxes.push(b); }
  const vp = page.viewportSize();
  const x0 = Math.max(0, Math.min(...boxes.map(b => b.x)) - pad), y0 = Math.max(0, Math.min(...boxes.map(b => b.y)) - pad);
  const x1 = toRight ? vp.width : Math.min(vp.width, Math.max(...boxes.map(b => b.x + b.width)) + pad), y1 = Math.min(vp.height, Math.max(...boxes.map(b => b.y + b.height)) + pad);
  await shot(page, name, { clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
}
// Trang ít nội dung: chụp từ đầu trang tới hết nội dung (cả menu trái), bỏ khoảng trống phía dưới.
async function shotContent(page, name, pad = 24) {
  const bottom = await page.evaluate(() => [...(document.querySelector('#view')?.children || [])].reduce((m, c) => Math.max(m, c.getBoundingClientRect().bottom), 0));
  const vp = page.viewportSize();
  await shot(page, name, { clip: { x: 0, y: 0, width: vp.width, height: Math.min(vp.height, Math.max(280, Math.ceil(bottom + pad))) } });
}
// Trang dài hơn màn hình: tạm kéo cao (và / hoặc rộng) khung nhìn, chụp như màn hình thường (không dùng fullPage: thanh đầu trang
// cố định sẽ bị vẽ giữa ảnh). fn (tuỳ chọn) chạy sau khi đổi khung nhìn, trả về tuỳ chọn cho shot() (vd. { clip }).
async function shotTall(page, name, { height, width, fn } = {}) {
  const vp = page.viewportSize();
  await page.setViewportSize({ width: width || vp.width, height: height || vp.height });
  await page.waitForTimeout(500);
  try {
    await page.evaluate(() => window.scrollTo(0, 0));
    const opts = fn ? await fn() : {};
    await shot(page, name, opts || {});
  } finally { await page.setViewportSize(vp); await page.waitForTimeout(200); }
}
const want = group => !ONLY || ONLY.split(',').some(g => group.startsWith(g));

// ---------- Dữ liệu ----------
const ctx = {};
async function prepare() {
  const projects = (await as('pmo', 'GET', '/api/projects')).j;
  const bm = projects.find(p => p.key === 'BM' && /\(giả\)/.test(p.name));
  if (!bm) { console.error('Từ chối: không thấy dự án mẫu "BM — Khu nhà ở Bình Minh (giả)". Chạy simulate-project.mjs trên bản thử trước.'); process.exit(2); }
  ctx.bm = bm;
  ctx.kd = (await as('giamdoc', 'GET', '/api/projects')).j.find(p => p.key === 'KD') || null;
  const proj = (await as('pmo', 'GET', `/api/projects/${bm.id}`)).j;
  ctx.states = Object.fromEntries(proj.states.map(s => [s.category, s]));
  const items = (await as('pmo', 'GET', `/api/projects/${bm.id}/items`)).j;
  ctx.items = items;
  ctx.byCode = c => items.find(i => i.code === c);
  ctx.users = Object.fromEntries((await as('pmo', 'GET', '/api/users/directory')).j.map(u => [u.username, u]));
  ctx.dept = Object.fromEntries(((await as('pmo', 'GET', '/api/departments')).j || []).map(d => [d.code, d]));
}
const itemHash = (id, extra = '') => `#/projects/${ctx.bm.id}?item=${id}${extra}`;

// Việc cho chuỗi ảnh "báo cáo tiến độ → xin gia hạn → gửi duyệt → duyệt": nv.phaply chủ trì, tb.phaply giao, đang mở, chưa gửi duyệt,
// chưa xin gia hạn, không có việc nhánh. Mỗi lần chụp chuỗi này "dùng hết" một việc (gửi duyệt rồi duyệt xong): lần sau lấy việc khác,
// hết thì tb.phaply giao một việc giả mới dưới BM-1, nv.phaply báo 60% để việc ở "Đang thực hiện".
async function flowItem() {
  const items = (await as('pmo', 'GET', `/api/projects/${ctx.bm.id}/items`)).j || [];
  const me = ctx.users['nv.phaply'].id, lead = ctx.users['tb.phaply'].id;
  const open = new Set([ctx.states.UNSTARTED?.id, ctx.states.STARTED?.id].filter(Boolean));
  const hasKids = new Set(items.map(i => i.parentId).filter(Boolean));
  const mine = i => (i.assignees || []).some(a => (a.userId ?? a.user?.id ?? a.id) === me);
  const ok = i => i.assignedById === lead && mine(i) && open.has(i.stateId) && !hasKids.has(i.id) && !i.pendingApproval && !i.pendingExtension && i.dueDate;
  let it = items.filter(ok).sort((a, b) => a.number - b.number)[0];
  if (!it) {
    const parent = items.find(i => i.code === 'BM-1');
    const r = await as('tb.phaply', 'POST', `/api/projects/${ctx.bm.id}/items`, { title: 'Soạn báo cáo rà soát pháp lý bổ sung (giả)', parentId: parent?.id, assigneeIds: [me],
      startDate: new Date(vnDay(-3) + 'T08:00:00+07:00').toISOString(), dueDate: new Date(vnDay(6) + 'T17:00:00+07:00').toISOString() });
    it = r.j;
    console.log(`  · tạo việc giả mới cho chuỗi gửi duyệt: ${it?.code}`);
  }
  if (it && !it.progress) await as('nv.phaply', 'POST', `/api/items/${it.id}/progress-reports`, { progress: 60, content: 'Đã soạn xong dự thảo, đang rà soát lần cuối (giả).' });
  return it;
}

// Thiết lập văn thư mẫu (như ví dụ ở thiet-lap.md mục 4.6.13, tên giả): thêm pháp nhân DXA; Văn thư = nv.hcns, Pháp chế = tb.phaply,
// Người phê duyệt = giamdoc — chỉ điền ô đang trống. Kèm 3 tài liệu nội bộ mẫu: 2 đã phê duyệt, 1 dự thảo có PDF chờ phê duyệt.
async function ensureVanthu() {
  const U = ctx.users;
  const meta = (await as('giamdoc', 'GET', '/api/vanthu/meta')).j;
  if (!meta?.config) { console.warn('  ! Chưa bật phân hệ Văn thư — bỏ qua thiết lập mẫu'); return; }
  const c = meta.config, entities = [...(meta.entities || [])];
  if (!entities.some(e => e.code === 'DXA')) entities.push({ code: 'DXA', name: 'Công ty con (giả)' });
  const body = { entities, clerkUserIds: c.clerkUserIds.length ? c.clerkUserIds : [U['nv.hcns'].id], legalUserIds: c.legalUserIds.length ? c.legalUserIds : [U['tb.phaply'].id],
    approverUserIds: c.approverUserIds.length ? c.approverUserIds : [U.giamdoc.id] };
  if (entities.length !== meta.entities.length || !c.clerkUserIds.length || !c.legalUserIds.length || !c.approverUserIds.length) await as('giamdoc', 'PUT', '/api/vanthu/config', body);
  const entity = (meta.entities[0] || entities[0]).code;
  const have = (await as('giamdoc', 'GET', '/api/vanthu/docs?book=NOIBO')).j || [];
  const samples = [
    { who: 'nv.hcns', title: 'Quy chế quản lý dự án đầu tư (giả)', series: 'D6', docType: 'QC', viewLevel: 'ALL', docCode: 'QC-DA-01', approve: true },
    { who: 'tb.phaply', title: 'Quy trình kiểm soát hồ sơ pháp lý dự án (giả)', series: 'D7', departmentId: ctx.dept.PL?.id, docType: 'QT', viewLevel: 'LEADERS', docCode: 'QT-PL-01', approve: true },
    { who: 'nv.hcns', title: 'Quy định quản lý và sử dụng con dấu (giả)', series: 'D6', docType: 'QyĐ', viewLevel: 'ALL', docCode: 'QyĐ-HC-02', approve: false },
  ];
  for (const s of samples) {
    if (have.some(d => d.title === s.title && !d.cancelled)) continue;
    const { who, approve, ...b } = s;
    const r = await as(who, 'POST', '/api/vanthu/docs', { ...b, entity, note: 'Tài liệu mẫu cho hướng dẫn (giả).' });
    if (!r.j?.id) continue;
    await upload(who, `/api/vanthu/docs/${r.j.id}/files`, 'files', `${ascii(s.docCode).replace(/[^A-Za-z0-9-]/g, '')}-du-thao-gia.pdf`, PDF, fakePdf(s.title));
    if (approve) await as('giamdoc', 'POST', `/api/vanthu/docs/${r.j.id}/approve`, { note: 'Đồng ý ban hành (giả).' });
  }
}

// Báo cáo tuần mẫu của Ban Đối ngoại – GPMB (tb.doingoai) có đề nghị hỗ trợ Ban TGĐ: để "Tổng hợp" có mục Yêu cầu hỗ trợ.
// Không đụng báo cáo Ban Pháp lý (ảnh 06 cần bản chưa nộp).
async function ensureWeeklyHelp() {
  const gr = ctx.dept.GR;
  if (!gr) return;
  const rep = (await as('tb.doingoai', 'GET', `/api/weekly/report?departmentId=${gr.id}`)).j;
  if (!rep || rep.report?.firstSubmittedAt || (!rep.report && !rep.prefill)) return;
  const fill = d => {
    let asked = false;
    for (const r of ['results', 'ongoing', 'risks'].flatMap(k => d[k] || [])) {
      r.cause ||= 'Một số hộ dân chưa đồng ý lịch kiểm đếm (giả)';
      r.solution ||= 'Phối hợp UBND phường vận động, hẹn lại lịch kiểm đếm (giả)';
      if (!r.helpFrom) {
        if (!asked) { r.helpFrom = 'BGD'; r.helpWhat = 'Đề nghị Ban TGĐ làm việc với UBND phường Mẫu về lịch kiểm đếm (giả)'; r.helpBy = vnDay(5); asked = true; }
        else r.helpFrom = 'SELF';
      }
      r.next ||= 'Kiểm đếm đợt 2 khu đất dự án (giả)';
      if (!r.ownerIds?.length && rep.members?.length) r.ownerIds = [rep.members[0].id];
      if (!r.due) r.due = vnDay(7);
    }
    d.plans ||= [];
    if (!d.plans.length) d.plans.push({ task: 'Kiểm đếm đợt 2 khu đất dự án (giả)', basis: 'KH tháng', ownerIds: [rep.members?.[0]?.id].filter(Boolean), due: vnDay(7), output: 'Biên bản kiểm đếm (giả)' });
    for (const p of d.plans) p.output ||= 'Biên bản kiểm đếm (giả)';
    return d;
  };
  let data = fill(structuredClone(rep.report?.data || rep.prefill));
  for (let i = 0; i < 3; i++) {
    const r = await raw('POST', '/api/weekly/submit', { token: await login('tb.doingoai'), body: { week: rep.week, departmentId: gr.id, data } });
    if (r.s < 300) return;
    if (r.j?.code !== 'REPORT_INCOMPLETE') { console.warn(`  ! nộp báo cáo tuần mẫu ${gr.name}: ${r.s} ${r.j?.error || ''}`); return; }
    data = fill(r.j.data || data);
  }
}

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

// Kết nối đã thu hồi của các lần chụp trước vẫn nằm trong danh sách (dòng "Đã thu hồi"): ẩn khỏi ảnh để giống máy dùng lần đầu.
const hideRevoked = page => page.evaluate(() => {
  const body = document.querySelector('section.cl-list tbody');
  if (!body) return;
  body.querySelectorAll('tr').forEach(tr => { if (/Đã thu hồi/.test(tr.textContent)) tr.remove(); });
  if (!body.querySelector('tr')) body.innerHTML = '<tr><td colspan="5" class="empty">Chưa có máy nào kết nối.</td></tr>';
});

group('03-ket-noi', async () => {
  // Bắt đầu từ "chưa có máy nào kết nối": thu hồi kết nối do lần chụp trước để lại (chỉ trên bản thử).
  const old = await as('nv.phaply', 'GET', '/api/me/tokens');
  for (const t of Array.isArray(old.j) ? old.j : (old.j?.tokens || [])) if (!t.revokedAt) await as('nv.phaply', 'DELETE', `/api/me/tokens/${t.id}`);
  const page = await pageAs('nv.phaply');
  await go(page, '#/today');
  await page.getByTestId('user-menu').click();
  await page.waitForTimeout(400);
  await mark(page, page.getByTestId('nav-claude'), '1');
  await shot(page, '03-menu-ket-noi-claude');
  await page.keyboard.press('Escape');
  await blur(page); // không để viền tiêu điểm quanh nút tài khoản ở các ảnh sau
  await go(page, '#/claude');
  await mark(page, page.getByTestId('claude-mcpb'), '1');
  await hideRevoked(page);
  await shot(page, '03-trang-ket-noi-claude');
  const start = await raw('POST', '/api/claude/connect/start', { body: { device: 'LAPTOP-PHAPLY-01' } });
  await go(page, `#/claude?connect=${start.j.userCode}`);
  await page.waitForSelector('[data-testid="claude-connect"]');
  await mark(page, page.getByTestId('claude-connect-approve'), '2');
  await hideRevoked(page);
  await shot(page, '03-cho-phep');
  await page.getByTestId('claude-connect-approve').click();
  await page.waitForTimeout(1200);
  await hideRevoked(page);
  await shot(page, '03-da-ket-noi');
  await page.locator('details.cl-manual summary').click();
  await page.waitForTimeout(400);
  await hideRevoked(page);
  await shot(page, '03-token-thu-cong', { el: 'section.cl-list' });
  await page.context().close();
});

group('04-du-an', async () => {
  const bm11 = ctx.byCode('BM-11');
  // Việc nhánh dưới BM-11 (người chủ trì tự chia việc của mình).
  const detail11 = (await as('nv.phaply', 'GET', `/api/items/${bm11.id}`)).j;
  if (!(detail11.children || []).length) {
    for (const [t, d] of [['Chuẩn bị bộ hồ sơ gửi Sở (giả)', 3], ['Gửi công văn xin ý kiến Sở (giả)', 6], ['Theo dõi, giải trình ý kiến của Sở (giả)', 14]])
      await as('nv.phaply', 'POST', `/api/projects/${ctx.bm.id}/items`, { title: t, parentId: bm11.id, assigneeIds: [ctx.users['nv.phaply'].id], dueDate: new Date(Date.now() + d * 864e5).toISOString().slice(0, 10) });
  }
  const flow = await flowItem();
  if (!flow) throw new Error('không có việc cho chuỗi báo cáo tiến độ / gửi duyệt');
  console.log(`  · việc dùng cho chuỗi báo cáo tiến độ / gia hạn / gửi duyệt: ${flow.code}`);
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
  await shot(page, '04-vai-cua-toi', { el: '[data-testid="item-panel"]', maxHeight: 290 });
  const childInput = page.getByTestId('child-input');
  if (await childInput.count()) { await mark(page, childInput, '1'); await shot(page, '04-viec-nhanh', { el: '[data-testid="item-panel"]' }); }
  // Việc đang làm dở của người chủ trì: xin gia hạn, báo cáo tiến độ, gửi duyệt.
  await go(page, itemHash(flow.id));
  await page.waitForSelector('[data-testid="item-panel"]:not(.hidden)');
  await page.waitForTimeout(900);
  // Nút Xin gia hạn trong khối "Điều hành" (đang mở), chụp từ đầu panel: thấy tên việc, "Vai của bạn: Người chủ trì".
  const ext = page.getByTestId('request-extension');
  if (await ext.count()) {
    await mark(page, ext, '1');
    await shot(page, '04-xin-gia-han-nut', { el: '[data-testid="item-panel"]', maxHeight: 690 });
  } else console.warn('  ! không thấy nút Xin gia hạn');
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
  if (await ext.count()) {
    await ext.click();
    await page.waitForTimeout(700);
    await shot(page, '04-xin-gia-han');
    await closeModal(page);
  }
  const submit = page.getByTestId('submit-approval');
  if (await submit.count()) {
    await blur(page);
    await mark(page, submit, '1');
    await shot(page, '04-gui-duyet', { el: '[data-testid="item-panel"]' });
    await submit.click();
    await page.waitForTimeout(1200);
    await shot(page, '04-da-gui-duyet', { el: '[data-testid="item-panel"]' });
  }
  await page.context().close();

  // Người duyệt: Chờ tôi duyệt + chấm mức.
  const d = (await as('pmo', 'GET', `/api/items/${flow.id}`)).j;
  ctx.approver = d.assignedBy?.username || 'tb.phaply';
  console.log(`  · người duyệt ${flow.code}: ${ctx.approver}`);
  const appr = await pageAs(ctx.approver);
  await go(appr, '#/approvals');
  await shot(appr, '04-cho-toi-duyet');
  await go(appr, `#/approvals?item=${flow.id}`);
  await appr.waitForTimeout(900);
  const rate = appr.getByTestId('rating-GOOD');
  if (await rate.count()) {
    await rate.check();
    await appr.locator('#approval-zone textarea, [data-testid="approval-comment"]').first().fill('Báo cáo đủ ý, trình đúng hạn (giả).').catch(() => {});
    await blur(appr);
    await mark(appr, appr.locator('.rating-opts'), '1');
    await mark(appr, appr.getByTestId('approve-btn'), '2');
    await shot(appr, '04-duyet-cham-muc', { el: '[data-testid="item-panel"]', maxHeight: 560 });
    await appr.getByTestId('approve-btn').click();
    await appr.waitForTimeout(1200);
  }
  await appr.context().close();
  // Người chủ trì thấy kết quả duyệt + mức chấm (panel từ đầu: tên việc, khối Điều hành có Xếp loại).
  const back = await pageAs('nv.phaply');
  await go(back, itemHash(flow.id));
  await back.waitForTimeout(900);
  const rated = back.getByTestId('item-assessment').or(back.getByTestId('item-rating')).first();
  if (await rated.count()) await mark(back, rated, '');
  await shot(back, '04-ket-qua-duyet', { el: '[data-testid="item-panel"]', maxHeight: 872 });
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
  // Nút Gửi báo cáo ở cuối trang: cuộn hẳn xuống cuối rồi mới đánh dấu (số (2) phải nằm cạnh nút).
  const submit = page.getByTestId('wk-submit');
  if (await submit.count()) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);
    await mark(page, submit, '2');
    await shot(page, '06-gui-bao-cao');
  }
  await page.context().close();
  await ensureWeeklyHelp();
  const gd = await pageAs('giamdoc');
  await go(gd, '#/tuan/tong-hop');
  await shot(gd, '06-tong-hop-giao-ban');
  await gd.context().close();
});

group('07-van-thu', async () => {
  await ensureVanthu();
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
  await closeModal(page);
  await go(page, '#/vanthu?book=DI');
  await shot(page, '07-van-thu-di');
  await go(page, '#/vanthu?book=NOIBO');
  await shot(page, '07-van-thu-noi-bo');
  await page.context().close();
  // Người xử lý: tab "Tôi xử lý" → mở văn bản → tải bản scan lên (bản chạy thật: Hub lưu thẳng vào NAS).
  const nv = await pageAs('nv.phaply');
  await go(nv, '#/vanthu?book=mine');
  await shot(nv, '07-van-thu-toi-xu-ly');
  const first = nv.getByTestId('vt-list').locator('a').first();
  if (await first.count()) {
    await first.click(); await nv.waitForTimeout(900);
    const input = nv.getByTestId('vt-file-input');
    // Chỉ tải bản scan giả khi văn bản chưa có tệp (chạy lại không tải thêm bản thứ hai).
    if (await input.count() && !(await nv.locator('[data-testid="vt-files"] li').count())) {
      await input.setInputFiles({ name: 'scan-cong-van-mau-gia.pdf', mimeType: PDF, buffer: fakePdf('Cong van mau cua So Xay dung tinh Mau (gia)') });
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
  if (!mine.some(l => (l.status?.code ?? l.status) === 'PENDING')) {
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

// ---------- Ảnh riêng cho tài liệu lãnh đạo (Ban Tổng Giám đốc, lãnh đạo bộ phận, PMO, thư ký) ----------
group('20-lanh-dao', async () => {
  await ensureWeeklyHelp();
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
  // Kiến nghị: chụp bằng lãnh đạo đang có kiến nghị chờ trả lời (thường là người giao — lãnh đạo bộ phận), để ảnh không trống.
  const proposer = (((await as('giamdoc', 'GET', '/api/approvals/proposals')).j || []).length) ? null : 'tb.phaply';
  const kn = proposer ? await pageAs(proposer) : gd;
  await go(kn, '#/approvals?tab=proposals');
  // Khung đỏ trên ô tên việc (viền của cả dòng bảng không hiện rõ): bấm dòng để mở việc và trả lời kiến nghị.
  const prop = kn.locator('[data-testid^="prop-"] td').nth(1);
  if (await prop.count()) await mark(kn, prop, '1');
  await shot(kn, '20-ld-kien-nghi');
  if (proposer) await kn.context().close();
  // Tổng hợp giao ban: mỗi khối cuộn tới ngay dưới thanh tiêu đề dính của trang Báo cáo tuần.
  await go(gd, '#/tuan/tong-hop');
  for (const [id, name] of [['wk-helps', '20-ld-yeu-cau-ho-tro'], ['wk-act-list', '20-ld-action-log']]) {
    const sec = gd.getByTestId(id).first();
    if (!(await sec.count())) continue;
    await sec.evaluate(n => { const s = n.closest('section, .wk-card') || n; window.scrollTo(0, s.getBoundingClientRect().top + window.scrollY - 180); });
    await gd.waitForTimeout(300);
    await shot(gd, name);
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
    await closeModal(tb); // đã gõ tiêu đề: hệ thống hỏi "Bỏ nội dung đã nhập?" → Bỏ nội dung (không tạo việc)
  }
  await go(tb, '#/hrm/team');
  await shot(tb, '20-ld-bang-cong-bo-phan');
  await tb.context().close();
});

// ---------- Ảnh cho tài liệu thiết lập (thiet-lap.md) ----------
// Dự án: tạo dự án, menu Khác, màn Cài đặt (từng khối), thiết lập riêng của dự án MTL. Chỉ mở hộp thoại / điền thử, không bấm lưu.
group('30-du-an', async () => {
  // Khối Nhãn của Cài đặt BM: thêm một nhãn riêng mẫu nếu dự án chưa có (để khối không trống). Tạo trước khi mở trình duyệt:
  // danh sách nhãn nạp một lần lúc vào ứng dụng.
  const labels = (await as('pmo', 'GET', '/api/labels')).j || [];
  if (!labels.some(l => l.projectId === ctx.bm.id)) await as('pmo', 'POST', `/api/projects/${ctx.bm.id}/labels`, { name: 'Hồ sơ trình Sở (giả)' });
  const gd = await pageAs('giamdoc');
  await go(gd, '#/today');
  const plus = gd.getByTestId('new-project');
  await mark(gd, plus, '1');
  await shot(gd, '30-du-an-nut-tao', { clip: { x: 0, y: 0, width: 720, height: 560 } });
  await plus.click();
  await gd.waitForTimeout(600);
  await gd.getByTestId('project-key').fill('HTX');
  await gd.getByTestId('project-name').fill('Khu đô thị Hạ Tầng Xanh (giả)');
  await gd.locator('#modal textarea[name="description"]').fill('Dự án mẫu minh hoạ hướng dẫn thiết lập (giả).');
  await gd.getByTestId('project-t0').fill('2027-01').catch(() => {});
  await blur(gd);
  await mark(gd, gd.getByTestId('project-template'), '1');
  await mark(gd, gd.getByTestId('project-t0'), '2');
  await mark(gd, gd.getByTestId('project-save'), '3');
  await shotModal(gd, '30-du-an-tao');
  await closeModal(gd);
  await gd.context().close();

  // Lãnh đạo bộ phận: chỉ có kiểu Quy trình công việc / Lịch tuần; nhóm Quy trình duyệt (chọn 2 cấp để thấy đủ ô).
  const tb = await pageAs('tb.phaply');
  await go(tb, '#/today');
  await tb.getByTestId('new-project').click();
  await tb.waitForTimeout(600);
  await tb.getByTestId('project-key').fill('PLNB');
  await tb.getByTestId('project-name').fill('Hồ sơ pháp lý nội bộ (giả)');
  await tb.getByTestId('project-approval-template').selectOption('2');
  await blur(tb);
  await mark(tb, tb.getByTestId('project-template'), '1');
  await mark(tb, tb.getByTestId('project-approval-template'), '2');
  await shotModal(tb, '30-du-an-tao-quy-trinh');
  await closeModal(tb);
  await tb.context().close();

  // PMO (Chủ dự án của dự án MTL BM): menu Khác, T0 & ngưỡng cảnh báo, nhập MTL (xem trước), tab Giai đoạn.
  const pmo = await pageAs('pmo');
  const openMore = async () => {
    await go(pmo, `#/projects/${ctx.bm.id}?view=mtl`);
    await pmo.getByTestId('ph-more').click();
    await pmo.waitForTimeout(400);
  };
  await openMore();
  await mark(pmo, pmo.getByTestId('ph-more'), '1');
  const menu = pmo.locator('.ph-more-menu .ph-menu');
  const mb = await menu.boundingBox();
  await shot(pmo, '30-du-an-menu-khac', { clip: { x: 256, y: 62, width: VIEWPORT.width - 256, height: Math.min(VIEWPORT.height - 62, (mb ? mb.y + mb.height : 420) - 62 + 24) } });
  await pmo.getByTestId('mtl-settings').click();
  await pmo.waitForSelector('[data-testid="mtl-settings-save"]');
  await pmo.waitForTimeout(400);
  await blur(pmo);
  await shotModal(pmo, '30-mtl-t0-nguong');
  await closeModal(pmo);
  // Nhập MTL bộ phận: tệp là mẫu MTL bộ phận Ban Pháp lý tải từ chính dự án (điền sẵn) → Xem trước. Không bấm Nhập.
  await openMore();
  await pmo.getByTestId('mtl-import').click();
  await pmo.waitForSelector('[data-testid="mtl-import-file"]', { state: 'attached' });
  const pl = ctx.dept.PL;
  if (pl) {
    await pmo.getByTestId('mtl-import-kind').selectOption('DEPARTMENT');
    await pmo.getByTestId('mtl-import-dept').selectOption(String(pl.id));
    const xlsx = await fetchBuf('pmo', `/api/projects/${ctx.bm.id}/mtl-template.xlsx?departmentId=${pl.id}`);
    await pmo.getByTestId('mtl-import-file').setInputFiles({ name: 'MTL-bo-phan-Ban-Phap-ly.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx });
    await pmo.getByTestId('mtl-import-preview').click();
    await pmo.waitForSelector('[data-testid="mtl-import-summary"]', { timeout: 20_000 }).catch(() => console.warn('  ! xem trước MTL không ra kết quả'));
    await pmo.waitForTimeout(500);
    await blur(pmo);
    await mark(pmo, pmo.getByTestId('mtl-import-preview'), '1');
    await mark(pmo, pmo.getByTestId('mtl-import-go'), '2');
    await shotModal(pmo, '30-mtl-nhap-xem-truoc', { height: 1500 });
  }
  await pmo.locator('#modal [data-close]').click().catch(() => {});
  await closeModal(pmo);
  // Tab Giai đoạn + hộp Thiết lập giai đoạn.
  await go(pmo, `#/projects/${ctx.bm.id}?view=sprint`);
  await pmo.waitForSelector('[data-testid="sp-setup"]').catch(() => {});
  await mark(pmo, pmo.getByTestId('sp-setup'), '1');
  await shot(pmo, '30-mtl-giai-doan');
  await pmo.getByTestId('sp-setup').click();
  await pmo.waitForSelector('[data-testid="sp-setup-text"]');
  await pmo.waitForTimeout(300);
  await blur(pmo);
  await shotModal(pmo, '30-mtl-thiet-lap-giai-doan');
  await closeModal(pmo);
  // Màn Cài đặt dự án BM: trang + từng khối.
  await go(pmo, `#/projects/${ctx.bm.id}/settings`);
  await pmo.waitForSelector('#generalForm');
  await pmo.waitForTimeout(600);
  await shot(pmo, '30-cai-dat-du-an');
  const card = sel => pmo.locator('.card', { has: pmo.locator(sel) });
  // Khối Việc lặp lại: gõ thử tiêu đề (không bấm "Thêm việc lặp lại").
  await pmo.getByTestId('rec-title').fill('Báo cáo tiến độ tuần gửi PMO (giả)').catch(() => {});
  await blur(pmo);
  for (const [loc, name] of [[pmo.locator('#generalForm'), '30-cai-dat-thong-tin-chung'], [pmo.locator('.card.danger-zone'), '30-cai-dat-xoa-du-an'],
    [card('#statesEditor'), '30-cai-dat-cot-trang-thai'], [card('#labelsEditor'), '30-cai-dat-nhan'], [card('#recurringList'), '30-cai-dat-viec-lap-lai'],
    [card('#membersEditor'), '30-cai-dat-thanh-vien']]) {
    if (!(await loc.count())) { console.warn(`  ! không thấy khối cho ${name}`); continue; }
    await scrollTo(pmo, loc, 90);
    await shot(pmo, name, { el: loc });
  }
  await pmo.context().close();

  // Khối Quy trình duyệt nhiều cấp: dự án thường KD (2 cấp). Thêm thử một dòng quy tắc tự động (không bấm Lưu quy tắc).
  if (ctx.kd) {
    const g2 = await pageAs('giamdoc');
    await go(g2, `#/projects/${ctx.kd.id}/settings`);
    await g2.waitForSelector('#stepsEditor');
    const add = g2.getByTestId('add-rule');
    if (await add.count()) {
      await add.click();
      const row = g2.locator('#rulesEditor [data-row]').last();
      await row.locator('select[name="label"]').selectOption({ label: 'Gấp' }).catch(() => {});
      await row.locator('select[name="priority"]').selectOption('URGENT').catch(() => {});
      await blur(g2);
      await mark(g2, row, '1');
      await mark(g2, g2.getByTestId('save-rules'), '2');
    }
    const steps = g2.locator('.card', { has: g2.locator('#stepsEditor') });
    await scrollTo(g2, steps, 90);
    await shot(g2, '30-cai-dat-quy-trinh-duyet', { el: steps });
    await g2.context().close();
  }
});

// Tài liệu: tài liệu dự án, thiết lập văn thư, vào sổ, quy chế (danh sách, tạo dự thảo, phê duyệt).
group('30-tai-lieu', async () => {
  await ensureVanthu();
  // Tài liệu dự án: người chủ trì đã gửi vài tệp kết quả trong việc của BM (tệp giả), để danh sách không toàn "Chưa có tệp tải lên".
  const docProjects = (await as('giamdoc', 'GET', '/api/documents/projects')).j?.projects || [];
  if (!docProjects.find(p => p.id === ctx.bm.id)?.hubFiles) {
    for (const [code, file, title] of [['BM-11', 'Du-thao-cong-van-xin-y-kien-So-gia.pdf', 'Du thao cong van xin y kien So Xay dung (gia)'], ['BM-15', 'Bo-ho-so-gui-So-gia.pdf', 'Bo ho so gui So Xay dung (gia)']]) {
      const it = ctx.byCode(code);
      if (it) await upload('nv.phaply', `/api/items/${it.id}/attachments`, 'files', file, PDF, fakePdf(title));
    }
  }
  const gd = await pageAs('giamdoc');
  await go(gd, '#/tai-lieu?tab=du-an');
  await shotContent(gd, '30-tai-lieu-du-an');
  await go(gd, `#/tai-lieu?tab=du-an&p=${ctx.bm.id}`);
  await shotContent(gd, '30-tai-lieu-mot-du-an');
  // "Theo công việc (tải lên Hub)" trong việc BM-11: thư mục việc nhánh + tệp của chính việc, liên kết Mở việc.
  const bm11 = ctx.byCode('BM-11');
  if (bm11) {
    await go(gd, `#/tai-lieu?tab=du-an&p=${ctx.bm.id}&src=hub&path=${bm11.id}`);
    await gd.waitForSelector('[data-testid="doc-list"], [data-testid="doc-empty"]').catch(() => {});
    await shotContent(gd, '30-tai-lieu-theo-cong-viec');
  }
  await go(gd, '#/vanthu/thiet-lap');
  await gd.waitForSelector('#vtCfg').catch(() => {});
  await mark(gd, gd.getByTestId('vt-c-save'), '1');
  await shot(gd, '30-van-thu-thiet-lap');
  await go(gd, '#/vanthu?book=NOIBO');
  await mark(gd, gd.getByTestId('vt-new'), '1');
  await shot(gd, '30-quy-che-danh-sach');
  // Dự thảo có PDF chờ phê duyệt, mở bằng Người phê duyệt (giamdoc): nút Phê duyệt / Trả lại.
  const list = (await as('giamdoc', 'GET', '/api/vanthu/docs?book=NOIBO')).j || [];
  const draft = list.find(d => d.title === 'Quy định quản lý và sử dụng con dấu (giả)' && !d.cancelled && d.status?.code === 'DRAFT');
  if (draft) {
    await go(gd, `#/vanthu/${draft.id}`);
    await gd.waitForSelector('[data-testid="vt-approve"]').catch(() => {});
    await mark(gd, gd.getByTestId('vt-approve'), '1');
    await mark(gd, gd.getByTestId('vt-return'), '2');
    await shot(gd, '30-quy-che-phe-duyet');
  } else console.warn('  ! không thấy dự thảo mẫu chờ phê duyệt');
  await gd.context().close();

  // Văn thư (nv.hcns, do Ban TGĐ chỉ định): hộp Vào sổ văn bản và hộp Tạo dự thảo, điền thử — không bấm lưu.
  const vt = await pageAs('nv.hcns');
  await go(vt, '#/vanthu?book=DEN');
  await vt.getByTestId('vt-new').click();
  await vt.waitForSelector('[data-testid="vt-form"]');
  const f = vt.locator('[data-testid="vt-form"]');
  await vt.getByTestId('vt-f-title').fill('Công văn của UBND phường Mẫu về lịch kiểm đếm đất (giả)');
  await f.locator('input[name="counterpart"]').fill('UBND phường Mẫu (giả)');
  await f.locator('input[name="externalNumber"]').fill('45/UBND-ĐC');
  await f.locator('input[name="docType"]').fill('CV');
  await vt.getByTestId('vt-f-urgency').selectOption('KHAN');
  await vt.getByTestId('vt-f-handler').selectOption(String(ctx.users['tb.doingoai'].id)).catch(() => {});
  await blur(vt);
  await mark(vt, f.locator('select[name="series"]'), '1');
  await mark(vt, vt.getByTestId('vt-f-handler'), '2');
  await mark(vt, vt.getByTestId('vt-f-save'), '3');
  await shotModal(vt, '30-van-thu-vao-so');
  await closeModal(vt);
  await go(vt, '#/vanthu?book=NOIBO');
  await vt.getByTestId('vt-new').click();
  await vt.waitForSelector('[data-testid="vt-draft-form"]');
  const df = vt.locator('[data-testid="vt-draft-form"]');
  await df.locator('select[name="series"]').selectOption('D6');
  await vt.getByTestId('vt-d-type').selectOption('QyĐ');
  await vt.getByTestId('vt-d-title').fill('Quy định về công tác văn thư, lưu trữ (giả)');
  await df.locator('input[name="docCode"]').fill('QyĐ-HC-03');
  await vt.getByTestId('vt-d-file').setInputFiles({ name: 'QyD-HC-03-du-thao-gia.pdf', mimeType: PDF, buffer: fakePdf('Quy dinh ve cong tac van thu, luu tru (gia)') });
  await blur(vt);
  await mark(vt, vt.getByTestId('vt-d-level'), '1');
  await mark(vt, vt.getByTestId('vt-d-file'), '2');
  await mark(vt, vt.getByTestId('vt-d-save'), '3');
  await shotModal(vt, '30-quy-che-tao-du-thao');
  await closeModal(vt);
  await vt.context().close();
});

// Báo cáo tuần: khối Thiết lập ở cuối tab Tổng hợp (Ban TGĐ).
group('30-bao-cao-tuan', async () => {
  const gd = await pageAs('giamdoc');
  await go(gd, '#/tuan/tong-hop');
  const setup = gd.getByTestId('wk-setup');
  await setup.locator('summary').click();
  await gd.waitForTimeout(500);
  await mark(gd, gd.getByTestId('wk-set-save'), '1');
  // Khối cao gần bằng màn hình và trang có thanh tiêu đề "BÁO CÁO TUẦN" dính ở trên: kéo cao khung nhìn, cuộn khối xuống dưới thanh đó
  // rồi chụp đúng khung của khối.
  await shotTall(gd, '30-bao-cao-tuan-thiet-lap', { height: 1500, fn: async () => {
    await scrollTo(gd, setup, 190);
    const b = await setup.boundingBox();
    return { clip: { x: b.x - 4, y: b.y - 4, width: b.width + 8, height: b.height + 8 } };
  } });
  await gd.context().close();
});

// Nhân sự → Thiết lập; Đối tác: thêm đối tác (Ban TGĐ chọn bộ phận phụ trách), sửa / ngừng theo dõi (lãnh đạo bộ phận phụ trách).
group('30-nhan-su-doi-tac', async () => {
  const gd = await pageAs('giamdoc');
  await go(gd, '#/hrm/settings');
  await gd.waitForSelector('[data-testid="hrm-settings"]').catch(() => {});
  await mark(gd, gd.locator('#cfgForm button.btn-primary'), '1');
  await shotTall(gd, '30-nhan-su-thiet-lap', { height: 1180 });
  await go(gd, '#/crm');
  await gd.getByTestId('crm-new').click();
  await gd.waitForSelector('[data-testid="crm-f-name"]');
  await gd.getByTestId('crm-f-name').fill('Công ty CP Tư vấn Mẫu Hòa Bình (giả)');
  const m = gd.locator('#modal');
  await m.locator('select[name="kind"]').selectOption('CONSULTANT').catch(() => {});
  if (ctx.dept.PL) await m.locator('select[name="ownerDepartmentId"]').selectOption(String(ctx.dept.PL.id)).catch(() => {});
  await m.locator('select[name="ownerUserId"]').selectOption(String(ctx.users['tb.phaply'].id)).catch(() => {});
  await blur(gd);
  await mark(gd, m.locator('select[name="ownerDepartmentId"]'), '1');
  await mark(gd, m.locator('select[name="ownerUserId"]'), '2');
  await mark(gd, gd.getByTestId('crm-f-save'), '3');
  await shotModal(gd, '30-doi-tac-them');
  await closeModal(gd);
  await gd.context().close();
  const partners = (await as('tb.phaply', 'GET', `/api/crm/partners?q=${encodeURIComponent('Sở Xây dựng')}`)).j;
  const so = (Array.isArray(partners) ? partners : partners?.rows || partners?.items || []).find(p => /Sở Xây dựng/.test(p.name));
  if (so) {
    const tb = await pageAs('tb.phaply');
    await go(tb, `#/crm/${so.id}`);
    await tb.waitForSelector('[data-testid="crm-edit"]');
    await mark(tb, tb.getByTestId('crm-edit'), '1');
    await mark(tb, tb.locator('#pArchive'), '2');
    await shot(tb, '30-doi-tac-chi-tiet', { clip: { x: 256, y: 62, width: VIEWPORT.width - 256, height: 300 } });
    await tb.getByTestId('crm-edit').click();
    await tb.waitForSelector('#modal select[name="ownerUserId"]');
    await mark(tb, tb.locator('#modal select[name="ownerUserId"]'), '1');
    await shotModal(tb, '30-doi-tac-sua');
    await closeModal(tb);
    await tb.context().close();
  } else console.warn('  ! không thấy đối tác "Sở Xây dựng" để chụp ảnh sửa đối tác');
});

// Quản trị hệ thống (tài khoản quản trị gốc của bản thử): chỉ xem và mở hộp thoại, không lưu.
group('30-quan-tri', async () => {
  if (!ADMIN_PW) { console.warn('  ! Bỏ qua: chưa đặt ADMIN_PW (mật khẩu quản trị gốc của bản thử)'); return; }
  const ad = await pageAs(ADMIN);
  await go(ad, '#/admin/users');
  await ad.waitForSelector('[data-testid="users-table"]');
  // Bảng tài khoản rộng hơn màn 1440: mở rộng khung nhìn cho vừa bảng (không cuộn ngang mất cột Tài khoản / Họ tên).
  const extra = await ad.evaluate(() => { const s = document.querySelector('[data-testid="users-table"]')?.closest('.admin-scroll'); return s ? s.scrollWidth - s.clientWidth : 0; });
  await shotTall(ad, '30-qt-tai-khoan', { width: Math.min(1920, VIEWPORT.width + Math.max(0, extra) + 8), height: 1000, fn: async () => {
    await mark(ad, ad.getByTestId('add-user'), '1');
    await mark(ad, ad.getByTestId('edit-giamdoc'), '2');
    await mark(ad, ad.getByTestId('perm-giamdoc'), '3');
    await ad.evaluate(() => { document.querySelectorAll('.admin-scroll').forEach(s => { s.scrollLeft = 0; }); window.scrollTo(0, 0); });
    return {};
  } });
  await ad.getByTestId('edit-nv.phaply').click();
  await ad.waitForSelector('[data-testid="user-save"]');
  await blur(ad);
  await shotModal(ad, '30-qt-sua-tai-khoan');
  await closeModal(ad);
  await ad.getByTestId('perm-giamdoc').click();
  await ad.waitForSelector('[data-testid="role-grid"]');
  await blur(ad);
  await mark(ad, ad.getByTestId('perm-board-all-box'), '1');
  await mark(ad, ad.getByTestId('perm-save'), '2');
  await shotModal(ad, '30-qt-quyen-phu-trach', { height: 1700 });
  await closeModal(ad);
  await go(ad, '#/admin/departments');
  await ad.waitForSelector('[data-testid="departments-table"]');
  await mark(ad, ad.getByTestId('add-department'), '1');
  await shot(ad, '30-qt-bo-phan');
  await go(ad, '#/admin/labels');
  await shotContent(ad, '30-qt-nhan');
  // Nhật ký: khối "Tình trạng vận hành" (mở sẵn khi có việc cần xử lý) + các dòng nhật ký đầu tiên.
  await go(ad, '#/admin/audit');
  await ad.waitForSelector('[data-testid="audit-table"]');
  await shotTall(ad, '30-qt-nhat-ky', { height: 1500 });
  await go(ad, '#/admin/tokens');
  await ad.waitForSelector('[data-testid="admin-tokens"]');
  await shotContent(ad, '30-qt-token-claude');
  await go(ad, '#/catalog');
  await ad.waitForTimeout(500);
  await shotTall(ad, '30-qt-danh-muc', { height: 1250 });
  await ad.context().close();
});

// Thiết lập cá nhân: thông tin cá nhân, kết nối Claude, chuông, ghi chú, phím tắt, thùng rác.
group('30-ca-nhan', async () => {
  // Có ít nhất một máy đã kết nối Claude (nhóm 03 tạo; chạy riêng nhóm này thì tạo kết nối giả).
  const toks = (await as('nv.phaply', 'GET', '/api/me/tokens')).j;
  if (!(Array.isArray(toks) ? toks : toks?.tokens || []).some(t => !t.revokedAt)) await as('nv.phaply', 'POST', '/api/me/tokens', { name: 'Claude Desktop — LAPTOP-PHAPLY-01', scopes: ['read', 'write'], days: 30 });
  // Hai ghi chú mẫu: một có hạn (nhắc), một không.
  const notes = (await as('nv.phaply', 'GET', '/api/me/notes')).j || [];
  if (!notes.length) await as('nv.phaply', 'POST', '/api/me/notes', { title: 'Gọi Sở Xây dựng hỏi tiến độ góp ý (giả)', dueDate: vnDay(2) });
  if (notes.length < 2) await as('nv.phaply', 'POST', '/api/me/notes', { title: 'Chuẩn bị số liệu cho họp giao ban thứ Hai (giả)' });
  const page = await pageAs('nv.phaply');
  await go(page, '#/me');
  await page.waitForSelector('[data-testid="profile"]').catch(() => {});
  await mark(page, page.getByTestId('profile-avatar-change'), '1');
  await mark(page, page.getByTestId('profile-password'), '2');
  await shot(page, '30-ca-nhan-thong-tin');
  await go(page, '#/claude');
  await page.waitForSelector('section.cl-list');
  await hideRevoked(page);
  await mark(page, page.getByTestId('claude-mcpb'), '1');
  const revoke = page.locator('section.cl-list tbody button', { hasText: 'Thu hồi' }).first();
  if (await revoke.count()) await mark(page, revoke, '2');
  await shot(page, '30-ca-nhan-ket-noi-claude');
  await go(page, '#/today');
  await page.getByTestId('notif-btn').click();
  await page.waitForSelector('#notifPanel:not(.hidden)');
  await page.waitForTimeout(500);
  await mark(page, page.locator('#readAll'), '1');
  await shotAround(page, '30-ca-nhan-thong-bao', [page.getByTestId('notif-btn'), page.locator('#notifPanel')], { toRight: true });
  await page.keyboard.press('Escape');
  await go(page, '#/my?mode=notes');
  await page.waitForSelector('[data-testid="note-input"]').catch(() => {});
  await blur(page);
  await mark(page, page.getByTestId('note-input'), '1');
  await mark(page, page.getByTestId('note-input-due'), '2');
  await mark(page, page.locator('#noteAdd button.btn-primary'), '3');
  await shotContent(page, '30-ca-nhan-ghi-chu', 40);
  await page.getByTestId('shortcuts-open').click();
  await page.waitForSelector('[data-testid="shortcuts-single"]');
  await blur(page);
  await mark(page, page.getByTestId('shortcuts-single'), '1');
  await shotModal(page, '30-ca-nhan-phim-tat', { height: 1200 });
  await closeModal(page);
  await page.context().close();
  // Thùng rác (giamdoc): đưa một việc giả của dự án KD vào thùng rác nếu thùng rác đang trống.
  const trash = (await as('giamdoc', 'GET', '/api/trash')).j;
  if (ctx.kd && !(trash?.items || []).length) {
    const it = (await as('giamdoc', 'POST', `/api/projects/${ctx.kd.id}/items`, { title: 'Việc tạo nhầm, đã xoá (giả)' })).j;
    if (it?.id) await as('giamdoc', 'DELETE', `/api/items/${it.id}`);
  }
  const gd = await pageAs('giamdoc');
  await go(gd, '#/trash');
  const restore = gd.getByTestId('restore-item').first();
  if (await restore.count()) await mark(gd, restore, '1');
  await shotContent(gd, '30-ca-nhan-thung-rac', 40);
  await gd.context().close();
});

// ---------- Chạy ----------
// --lang=vi-VN: ô ngày hiện dd/mm/yyyy như máy nhân viên (Windows tiếng Việt).
browser = await chromium.launch({ channel: 'chromium', args: ['--lang=vi-VN'] });
let failed = 0;
try {
  await prepare();
  for (const [name, fn] of groups) {
    if (!want(name)) continue;
    console.log(`▶ ${name}`);
    try { await fn(); } catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message.split('\n')[0]}`); }
  }
} finally { await browser.close(); }
console.log(`Xong: ${shots.length} ảnh → ${OUT}${failed ? ` · ${failed} nhóm lỗi` : ''}`);
