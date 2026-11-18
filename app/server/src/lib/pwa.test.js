// Cài như ứng dụng (PWA): manifest, service worker và trang hướng dẫn công khai; service worker không đệm dữ liệu.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createApp, loadConfig } = require('../app');

async function serve(extraEnv = {}) {
  const config = loadConfig({ JWT_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/db', WEB_DIR: path.join(__dirname, '../../../web'), ...extraEnv });
  config.webDir = path.join(__dirname, '../../../web');
  config.accessLog = { middleware: (req, res, next) => next() };
  const app = createApp({ prisma: {}, config });
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('manifest: tên Kepler Hub, chế độ standalone, đủ biểu tượng 192/512 và maskable', async () => {
  const s = await serve();
  try {
    const r = await fetch(s.base + '/manifest.webmanifest');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /application\/manifest\+json/);
    const m = await r.json();
    assert.equal(m.name, 'Kepler Hub');
    assert.equal(m.display, 'standalone');
    assert.ok(m.icons.some(i => i.sizes === '192x192') && m.icons.some(i => i.sizes === '512x512'));
    assert.ok(m.icons.some(i => i.purpose === 'maskable'));
    for (const i of m.icons) assert.equal((await fetch(s.base + '/' + i.src)).status, 200, i.src);
  } finally { s.close(); }
});

test('logo không vuông không dùng làm biểu tượng ứng dụng', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'));
  const b = Buffer.alloc(33); b.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); b.writeUInt32BE(160, 16); b.writeUInt32BE(76, 20);
  fs.writeFileSync(path.join(dir, 'mark.png'), b);
  const s = await serve({ BRANDING_DIR: dir });
  try { const m = await (await fetch(s.base + '/manifest.webmanifest')).json(); assert.notEqual(m.icons[0].src, 'branding/mark.png'); } finally { s.close(); }
});

test('manifest dùng logo công ty (BRANDING_DIR/mark.png) khi có, kèm kích thước thật', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'));
  fs.copyFileSync(path.join(__dirname, '../../../web/assets/app-icon-512.png'), path.join(dir, 'mark.png'));
  const s = await serve({ BRANDING_DIR: dir, ORG_NAME: 'Công ty mẫu (giả)' });
  try {
    const m = await (await fetch(s.base + '/manifest.webmanifest')).json();
    assert.equal(m.icons[0].src, 'branding/mark.png');
    assert.equal(m.icons[0].sizes, '512x512');
    assert.match(m.description, /Công ty mẫu/);
  } finally { s.close(); }
});

test('service worker và trang install.html phục vụ công khai; sw không dùng Cache Storage', async () => {
  const s = await serve();
  try {
    const sw = await fetch(s.base + '/sw.js');
    assert.equal(sw.status, 200);
    const code = await sw.text();
    assert.doesNotMatch(code, /caches\.|cache\.put/);
    const page = await fetch(s.base + '/install.html');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Cài Kepler Hub/);
  } finally { s.close(); }
});
