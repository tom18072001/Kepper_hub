// Tiện ích Claude: tên người dùng thấy là "kepler" (góp ý người dùng — "kepper" trông như gõ nhầm), mã định danh giữ nguyên.
//   • Tệp tải: kepler-claude.mcpb — Dockerfile đóng gói, CI lấy ra khởi động thử, script pack, máy chủ phục vụ: CÙNG một tên.
//   • Đường cũ /downloads/kepper-claude.mcpb vẫn tải được, ra cùng gói (người quản trị tổ chức Claude từng tải ở đường này).
//   • Giao diện (app/web) không còn chữ "kepper" hiện cho người dùng, trừ mẫu được phép (tên tệp CSS nội bộ, tên công cụ MCP kepper_*).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const JSZip = require('jszip');
const { createApp, loadConfig } = require('../app');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const APP = path.join(ROOT, 'app');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NAME = 'kepler-claude.mcpb';

test('tên gói tiện ích thống nhất: Dockerfile, CI, script pack cùng ra kepler-claude.mcpb', () => {
  const docker = read('Dockerfile');
  assert.match(docker, /mcpb pack \. \/out\/kepler-claude\.mcpb/);
  assert.deepEqual([...docker.matchAll(/\/app\/web\/downloads\/([\w.-]+\.mcpb)/g)].map(m => m[1]), [NAME]);
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /docker cp "\$id:\/app\/web\/downloads\/kepler-claude\.mcpb"/);
  assert.match(ci, /unzip -q "\$RUNNER_TEMP\/kepler-claude\.mcpb"/);
  assert.equal(JSON.parse(read('app/mcp/package.json')).scripts.pack, 'mcpb pack . ../web/downloads/kepler-claude.mcpb');
  for (const [file, src] of [['Dockerfile', docker], ['ci.yml', ci]]) assert.doesNotMatch(src, /kepper-claude\.mcpb/, file);
});

// Máy chủ thật (createApp) trên thư mục web tạm có gói GIẢ đặt đúng tên Dockerfile đóng gói, kèm "Caddy" giả phát chứng chỉ gốc GIẢ.
async function serveWith(files) {
  const web = fs.mkdtempSync(path.join(os.tmpdir(), 'tien-ich-claude-'));
  fs.mkdirSync(path.join(web, 'downloads'));
  for (const [name, buf] of Object.entries(files)) fs.writeFileSync(path.join(web, 'downloads', name), buf);
  const pem = '-----BEGIN CERTIFICATE-----\nMIIB-chung-chi-gia\n-----END CERTIFICATE-----\n';
  const ca = http.createServer((req, res) => res.end(pem));
  await new Promise(r => ca.listen(0, '127.0.0.1', r));
  const config = loadConfig({ JWT_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/db', WEB_DIR: web,
    APP_ORIGIN: 'https://hub.vi-du.invalid', HUB_CA_URL: `http://127.0.0.1:${ca.address().port}/ca.crt` });
  config.accessLog = { middleware: (req, res, next) => next() };
  const server = await new Promise(r => { const s = createApp({ prisma: {}, config }).listen(0, () => r(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, pem, close: () => { server.close(); ca.close(); fs.rmSync(web, { recursive: true, force: true }); } };
}
async function fakePackage() {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ manifest_version: '0.3', name: 'kepper-hub', version: '0.0.0-gia',
    server: { type: 'node', entry_point: 'server.js', mcp_config: { command: 'node', args: ['${__dirname}/server.js'], env: { KEPPER_URL: '${user_config.kepper_url}' } } },
    user_config: { kepper_url: { type: 'string', title: 'Địa chỉ Kepler Hub', default: 'http://localhost:4000' } } }));
  zip.file('server.js', '// gói GIẢ\n');
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('tải tiện ích: đường mới và đường cũ cùng ra một gói đã điền địa chỉ + chứng chỉ gốc, tên tệp tải về kepler-claude.mcpb', async () => {
  const name = read('Dockerfile').match(/\/app\/web\/downloads\/([\w.-]+\.mcpb)/)[1]; // đúng tệp image có
  const s = await serveWith({ [name]: await fakePackage() });
  try {
    const bodies = [];
    for (const url of ['/downloads/kepler-claude.mcpb', '/downloads/kepper-claude.mcpb']) {
      const r = await fetch(s.base + url);
      assert.equal(r.status, 200, url);
      assert.equal(r.headers.get('content-type'), 'application/octet-stream', url);
      assert.equal(r.headers.get('content-disposition'), 'attachment; filename="kepler-claude.mcpb"', url);
      const buf = Buffer.from(await r.arrayBuffer());
      const zip = await JSZip.loadAsync(buf);
      const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
      assert.equal(manifest.name, 'kepper-hub', url); // mã định danh tiện ích không đổi
      assert.equal(manifest.user_config.kepper_url.default, 'https://hub.vi-du.invalid', url); // địa chỉ Hub điền sẵn
      assert.equal(await zip.file('kepler-hub-ca.pem').async('string'), s.pem, url); // chứng chỉ gốc đóng vào gói
      assert.equal(manifest.server.mcp_config.env.NODE_EXTRA_CA_CERTS, '${__dirname}/kepler-hub-ca.pem', url);
      bodies.push(buf);
    }
    assert.ok(bodies[0].equals(bodies[1]), 'hai đường ra cùng một gói');
  } finally { s.close(); }
});

test('tải tiện ích: máy chưa có gói (chạy cục bộ, chưa đóng gói) → 404 ở cả hai đường, không phát tệp cũ còn sót', async () => {
  const s = await serveWith({ 'kepper-claude.mcpb': Buffer.from('goi cu con sot') });
  try {
    for (const url of ['/downloads/kepler-claude.mcpb', '/downloads/kepper-claude.mcpb']) assert.equal((await fetch(s.base + url)).status, 404, url);
  } finally { s.close(); }
});

// ---------- Quét app/web: chữ "kepper" không hiện cho người dùng ----------
// Phần người dùng có thể thấy: JS — chỉ chuỗi (bỏ chú thích; cùng cách tách như role-matrix.test.js); CSS — bỏ chú thích;
// HTML / SVG — bỏ chú thích <!-- --> và /* */.
const TOKENS = /('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g;
function visibleText(file, src) {
  if (/\.m?js$/.test(file)) return [...src.matchAll(TOKENS)].filter(m => m[1]).map(m => m[1]).join('\n');
  return src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}
// Mẫu được phép (không phải chữ hiện ra): tên tệp CSS nội bộ (index.html nạp css/kepper.css), tên công cụ MCP kepper_* (mã định danh).
const ALLOWED = [/\bkepper\.css\b/gi, /\bkepper_[a-z_]+/gi];
const kepperIn = text => ALLOWED.reduce((t, re) => t.replace(re, ''), text).match(/kepper/gi) || [];

test('quét giao diện: bộ quét bắt chữ "kepper" trong chuỗi / HTML, bỏ qua chú thích và mẫu được phép', () => {
  assert.equal(kepperIn(visibleText('a.js', "// Kepper — chú thích\nconst a = `tải <a>kepper-claude.mcpb</a>`;")).length, 1);
  assert.equal(kepperIn(visibleText('a.js', "x('Kepper Hub')")).length, 1);
  assert.equal(kepperIn(visibleText('a.js', "/* Kepper */ x('kepper_whoami'); // kepper\ny('css/kepper.css');")).length, 0);
  assert.equal(kepperIn(visibleText('a.html', '<!-- Kepper --><a href="downloads/kepper-claude.mcpb">Tải</a>')).length, 1);
  assert.equal(kepperIn(visibleText('a.html', '<link rel="stylesheet" href="css/kepper.css"><style>/* Kepper */</style>')).length, 0);
  assert.equal(kepperIn(visibleText('a.css', '/* Kepper — giao diện */ .x::after { content: "Kepper" }')).length, 1);
});

test('quét giao diện: app/web không còn chữ "kepper" hiện cho người dùng (HTML, JS, CSS, SVG)', () => {
  const files = [];
  const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'vendor', 'downloads'].includes(e.name)) walk(p); } else if (/\.(html|m?js|css|svg|json|webmanifest)$/i.test(e.name)) files.push(p);
  } };
  walk(path.join(APP, 'web'));
  assert.ok(files.length > 40, 'quét được giao diện');
  const hits = files.flatMap(f => kepperIn(visibleText(f, fs.readFileSync(f, 'utf8'))).map(() => path.relative(APP, f).split(path.sep).join('/')));
  assert.deepEqual(hits, [], 'Chữ hiện cho người dùng viết "Kepler", không "Kepper":\n' + hits.join('\n'));
  // Trang Kết nối Claude và trang cài đặt trỏ đúng đường tải mới.
  assert.match(read('app/web/js/views/claude.js'), /href="\/downloads\/kepler-claude\.mcpb"[^>]*>kepler-claude\.mcpb<\/a>/);
  assert.match(read('app/web/install.html'), /href="downloads\/kepler-claude\.mcpb"/);
});

test('manifest tiện ích: chữ người dùng thấy không có "kepper"; mã định danh, khoá cấu hình, tên công cụ giữ nguyên', () => {
  const m = JSON.parse(read('app/mcp/manifest.json'));
  const shown = [m.display_name, m.description, m.long_description, m.author?.name,
    ...Object.values(m.user_config || {}).flatMap(c => [c.title, c.description]), ...(m.tools || []).map(t => t.description)];
  assert.deepEqual(shown.filter(s => /kepper/i.test(s || '')), []);
  assert.equal(m.display_name, 'Kepler Hub');
  // Đổi các mã này sinh tiện ích thứ hai trùng tên trên máy người dùng / mất token đã lưu / Claude gọi sai công cụ.
  assert.equal(m.name, 'kepper-hub');
  assert.deepEqual(Object.keys(m.user_config).sort(), ['kepper_token', 'kepper_url']);
  assert.ok(m.tools.length > 0 && m.tools.every(t => /^kepper_[a-z_]+$/.test(t.name)));
});
