// Giới hạn tần suất API (app.js): mặc định bản thật 600 / phút / tài khoản, token Claude 120 / phút / token;
// tính theo tài khoản (JWT đã xác minh chữ ký), token giả không đẩy được yêu cầu vào hạn mức người khác; /api/auth/* không bị giới hạn.
// E2E nâng API_RATE_LIMIT (app/e2e/playwright.config.js) — mặc định bản thật được ghim ở đây.
// Không cần CSDL: prisma giả, mỗi trường hợp dựng app riêng (bộ đếm nằm trong bộ nhớ).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { createApp, loadConfig } = require('../app');
const { newToken } = require('./tokens');

const SECRET = 'x'.repeat(40);
const BASE_ENV = { JWT_SECRET: SECRET, DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/db' };

async function serve(env = {}) {
  const config = loadConfig({ ...BASE_ENV, ...env });
  config.webDir = path.join(__dirname, '../../../web');
  config.accessLog = { middleware: (req, res, next) => next() };
  // Đăng nhập: không có tài khoản nào → 401 (không cần CSDL).
  const prisma = { $queryRaw: async () => [{ '?column?': 1 }], user: { findUnique: async () => null }, auditLog: { create: async () => ({}) } };
  const app = createApp({ prisma, config });
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  return { config, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
}
const bearer = t => ({ authorization: 'Bearer ' + t });
const hit = (s, headers = {}, p = '/api/health') => fetch(s.base + p, { headers });
async function hitN(s, n, headers, p) {
  const out = [];
  for (let i = 0; i < n; i++) { const r = await hit(s, headers, p); out.push(r.status); await r.arrayBuffer(); }
  return out;
}

test('mặc định bản thật: không đặt API_RATE_LIMIT / TOKEN_RATE_LIMIT → 600 / 120; /api/health trả RateLimit-Policy: 600;w=60', async () => {
  const config = loadConfig(BASE_ENV);
  assert.equal(config.apiRateLimit, 600);
  assert.equal(config.tokenRateLimit, 120);
  const s = await serve();
  try {
    const r = await hit(s);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('ratelimit-policy'), '600;w=60');
  } finally { await s.close(); }
});

test('hạn mức theo tài khoản: user 1 hết hạn mức → 429 RATE_LIMITED; user 2 vẫn 200', async () => {
  const s = await serve({ API_RATE_LIMIT: '3' });
  try {
    const u1 = bearer(jwt.sign({ id: 1 }, SECRET)), u2 = bearer(jwt.sign({ id: 2 }, SECRET));
    assert.deepEqual(await hitN(s, 3, u1), [200, 200, 200]);
    const over = await hit(s, u1);
    assert.equal(over.status, 429);
    assert.equal((await over.json()).code, 'RATE_LIMITED');
    assert.equal((await hit(s, u2)).status, 200);
  } finally { await s.close(); }
});

test('token giả (JWT ký sai khoá mang id user 2) không đẩy được yêu cầu vào hạn mức của user 2', async () => {
  const s = await serve({ API_RATE_LIMIT: '3' });
  try {
    const forged = bearer(jwt.sign({ id: 2 }, 'khoa-sai-' + 'y'.repeat(32)));
    const statuses = await hitN(s, 4, forged);
    assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
    assert.equal(statuses[3], 429, 'token giả bị tính theo IP');
    // IP đã hết hạn mức nhưng user 2 thật có hạn mức riêng, chưa bị tiêu.
    assert.deepEqual(await hitN(s, 3, bearer(jwt.sign({ id: 2 }, SECRET))), [200, 200, 200]);
  } finally { await s.close(); }
});

test('token Claude: dùng TOKEN_RATE_LIMIT, hạn mức riêng theo token (không chung với người dùng / token khác)', async () => {
  const s = await serve({ API_RATE_LIMIT: '10', TOKEN_RATE_LIMIT: '2' });
  try {
    const t1 = bearer(newToken()), t2 = bearer(newToken());
    const first = await hit(s, t1);
    assert.equal(first.headers.get('ratelimit-policy'), '2;w=60');
    await first.arrayBuffer();
    assert.equal((await hit(s, t1)).status, 200);
    const over = await hit(s, t1);
    assert.equal(over.status, 429);
    assert.equal((await over.json()).code, 'RATE_LIMITED');
    assert.equal((await hit(s, t2)).status, 200, 'token khác có hạn mức riêng');
    const user = await hit(s, bearer(jwt.sign({ id: 1 }, SECRET)));
    assert.equal(user.status, 200);
    assert.equal(user.headers.get('ratelimit-policy'), '10;w=60', 'người dùng vẫn theo API_RATE_LIMIT');
  } finally { await s.close(); }
});

test('/api/auth/* không bị giới hạn tần suất (giữ nguyên tiêu chí đăng nhập), kể cả khi IP đã hết hạn mức', async () => {
  const s = await serve({ API_RATE_LIMIT: '2' });
  try {
    assert.deepEqual(await hitN(s, 3, {}), [200, 200, 429], 'chưa đăng nhập: theo IP');
    for (let i = 0; i < 5; i++) {
      const r = await fetch(s.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(r.status, 401, 'đăng nhập sai vẫn trả 401 như cũ, không 429');
      assert.equal(r.headers.get('ratelimit-policy'), null);
      await r.arrayBuffer();
    }
  } finally { await s.close(); }
});
