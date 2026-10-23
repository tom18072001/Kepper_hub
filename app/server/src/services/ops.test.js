const test = require('node:test');
const assert = require('node:assert/strict');
const { opsProblems } = require('./ops');

const now = new Date('2026-10-23T02:00:00Z');
test('Giám sát vận hành: sao lưu quá hạn / lỗi / chưa mã hoá, job lỗi', () => {
  assert.deepEqual(opsProblems({ backup: { lastOk: '2026-10-22T20:00:00Z', encrypted: true, copied: true }, ledger: {}, now }), []);
  assert.match(opsProblems({ backup: null, ledger: {}, now })[0], /Chưa ghi nhận/);
  assert.match(opsProblems({ backup: { lastOk: '2026-10-20T20:00:00Z', encrypted: true, copied: true }, now })[0], /54 giờ/);
  const p = opsProblems({ backup: { lastOk: '2026-10-22T20:00:00Z', lastFailAt: '2026-10-22T21:00:00Z', error: 'pg_dump', encrypted: false, copied: false },
    ledger: { mtl_alerts: { at: '2026-10-22T00:30:00Z', ok: false }, due_soon: { at: '2026-10-22T01:00:00Z', ok: true }, old: { at: '2026-10-10T00:00:00Z', ok: false } }, now });
  assert.equal(p.length, 4);
  assert.ok(p.some(x => /lỗi: pg_dump/.test(x)) && p.some(x => /chưa mã hoá/.test(x)) && p.some(x => /ngoài máy/.test(x)) && p.some(x => /mtl_alerts\./.test(x)));
});
