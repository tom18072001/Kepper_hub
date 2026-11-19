// Mã bản giao diện (N10): đổi mã giao diện thì đổi mã bản; máy chủ trả mã trên mọi phản hồi API, /api/health và trang chính.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { computeBuildId } = require('./build-id');
const { createApp, loadConfig } = require('../app');

function webDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-id-'));
  fs.mkdirSync(path.join(dir, 'js'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<head><meta name="kepler-build" content=""></head>');
  fs.writeFileSync(path.join(dir, 'js', 'main.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'assets', 'logo.png'), 'png-1');
  return dir;
}

test('mã bản: cố định khi giao diện không đổi, đổi khi sửa JS / CSS / HTML, không đổi theo ảnh', () => {
  const dir = webDir();
  const first = computeBuildId(dir);
  assert.match(first, /^[0-9a-f]{12}$/);
  assert.equal(computeBuildId(dir), first);
  fs.writeFileSync(path.join(dir, 'assets', 'logo.png'), 'png-2');
  assert.equal(computeBuildId(dir), first, 'đổi ảnh không bắt tải lại');
  fs.writeFileSync(path.join(dir, 'js', 'main.js'), 'console.log(2)');
  const second = computeBuildId(dir);
  assert.notEqual(second, first);
  fs.writeFileSync(path.join(dir, 'styles.css'), 'body{}');
  assert.notEqual(computeBuildId(dir), second);
});

test('mã bản: đổi tên tệp cũng đổi mã (nội dung giống nhau)', () => {
  const dir = webDir();
  const before = computeBuildId(dir);
  fs.renameSync(path.join(dir, 'js', 'main.js'), path.join(dir, 'js', 'app.js'));
  assert.notEqual(computeBuildId(dir), before);
});

async function serve({ dir, buildId } = {}) {
  const config = loadConfig({ JWT_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/db' });
  config.webDir = dir || path.join(__dirname, '../../../web');
  config.accessLog = { middleware: (req, res, next) => next() };
  if (buildId) config.buildId = buildId;
  const app = createApp({ prisma: { $queryRaw: async () => [{ '?column?': 1 }] }, config });
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  return { app, base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('máy chủ: /api/health trả mã bản, mọi phản hồi API có header X-Kepler-Build (kể cả 401, 404)', async () => {
  const s = await serve();
  try {
    const build = s.app.locals.buildId;
    assert.match(build, /^[0-9a-f]{12}$/);
    const health = await fetch(s.base + '/api/health');
    assert.deepEqual(await health.json(), { ok: true, build });
    assert.equal(health.headers.get('x-kepler-build'), build);
    assert.equal((await fetch(s.base + '/api/khong-co')).headers.get('x-kepler-build'), build);
    const unauth = await fetch(s.base + '/api/me');
    assert.equal(unauth.status, 401);
    assert.equal(unauth.headers.get('x-kepler-build'), build);
  } finally { s.close(); }
});

test('máy chủ: trang chính ghi mã bản vào <meta name="kepler-build">, không đệm (no-cache), tệp tĩnh không có header', async () => {
  const s = await serve({ buildId: 'abc123def456' });
  try {
    for (const url of ['/', '/index.html']) {
      const r = await fetch(s.base + url);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /text\/html/);
      assert.equal(r.headers.get('cache-control'), 'no-cache');
      assert.match(await r.text(), /<meta name="kepler-build" content="abc123def456">/);
    }
    const js = await fetch(s.base + '/js/version.js');
    assert.equal(js.status, 200);
    assert.equal(js.headers.get('x-kepler-build'), null);
  } finally { s.close(); }
});

test('máy chủ: mã bản tính từ chính thư mục web đang phục vụ', async () => {
  const dir = webDir();
  const s = await serve({ dir });
  try {
    assert.equal(s.app.locals.buildId, computeBuildId(dir));
    assert.match(await (await fetch(s.base + '/')).text(), new RegExp(`content="${computeBuildId(dir)}"`));
  } finally { s.close(); }
});
