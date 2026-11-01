const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { issueToken, createAuth } = require('./auth');

const SECRET = 'test-secret-that-is-long-enough';
function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function request(token, path = '/api/tasks', method = 'GET') {
  return { headers: { authorization: 'Bearer ' + token }, path, method };
}

async function run(user, token, path, method) {
  const prisma = { user: { findUnique: async () => user } };
  const req = request(token, path, method), res = response(); let called = false;
  await createAuth(prisma, SECRET)(req, res, () => { called = true; });
  return { req, res, called };
}

test('token carries only user id and session version', () => {
  const token = issueToken({ id: 7, sessionVersion: 3, role: 'admin', unitId: 99 }, SECRET);
  const payload = jwt.verify(token, SECRET);
  assert.equal(payload.id, 7);
  assert.equal(payload.sessionVersion, 3);
  assert.equal(payload.role, undefined);
  assert.equal(payload.unitId, undefined);
});

test('auth reloads current user and rejects inactive or revoked sessions', async () => {
  const token = issueToken({ id: 7, sessionVersion: 0 }, SECRET);
  const current = { id: 7, role: 'staff', unitId: 2, sessionVersion: 0, isActive: true, permissions: [] };
  const ok = await run(current, token);
  assert.equal(ok.called, true);
  assert.equal(ok.req.user, current);
  const inactive = await run({ ...current, isActive: false }, token);
  assert.equal(inactive.res.statusCode, 401);
  const revoked = await run({ ...current, sessionVersion: 1 }, token);
  assert.equal(revoked.res.statusCode, 401);
});

test('legacy tokens without session version are rejected', async () => {
  const token = jwt.sign({ id: 7, role: 'admin', unitId: 99 }, SECRET, { expiresIn: '1h' });
  const current = { id: 7, role: 'staff', unitId: 2, sessionVersion: 0, isActive: true, permissions: [] };
  assert.equal((await run(current, token)).res.statusCode, 401);
});

test('must-change-password allows only profile and password endpoints', async () => {
  const user = { id: 7, sessionVersion: 0, isActive: true, mustChangePw: true, permissions: [] };
  const token = issueToken(user, SECRET);
  const blocked = await run(user, token, '/api/tasks', 'GET');
  assert.equal(blocked.res.statusCode, 403);
  assert.equal(blocked.res.body.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await run(user, token, '/api/me', 'GET')).called, true);
  assert.equal((await run(user, token, '/api/me/password', 'POST')).called, true);
});
