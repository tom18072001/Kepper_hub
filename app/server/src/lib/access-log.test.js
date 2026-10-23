const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAccessLog, purgeAccessLogs } = require('./access-log');
const { loadConfig } = require('../app');

test('Nhật ký truy cập: một dòng JSON / request, không query; dọn tệp quá 400 ngày', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acl-'));
  const lines = [];
  const log = createAccessLog({ dir, out: { write: l => lines.push(l) } });
  const handlers = {};
  const res = { statusCode: 200, on: (ev, fn) => { handlers[ev] = fn; } };
  log.middleware({ path: '/weekly/report', originalUrl: '/api/weekly/report?q=Bí-mật', method: 'GET', ip: '10.0.0.5', user: { id: 7 } }, res, () => {});
  handlers.finish();
  const row = JSON.parse(lines[0]);
  assert.equal(row.path, '/api/weekly/report'); assert.equal(row.uid, 7); assert.equal(row.status, 200);
  assert.ok(!lines[0].includes('Bí-mật'));
  log.close(); await new Promise(r => setTimeout(r, 50));
  assert.equal(fs.readdirSync(dir).filter(f => f.startsWith('access-')).length, 1);
  fs.writeFileSync(path.join(dir, 'access-2024-01-01.jsonl'), '');
  assert.equal(purgeAccessLogs({ dir, now: new Date('2026-10-24T00:00:00Z') }), 1);
});

test('Cấu hình máy chạy: từ chối JWT_SECRET mẫu; mặc định không tin X-Forwarded-For', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'change-to-a-long-random-secret' }), /JWT_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' }), /JWT_SECRET/);
  assert.equal(loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(64) }).trustProxy, false);
  assert.equal(loadConfig({ JWT_SECRET: 'x', TRUST_PROXY: '1' }).trustProxy, 1);
});
