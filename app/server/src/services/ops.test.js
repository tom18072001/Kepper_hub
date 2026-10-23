const test = require('node:test');
const assert = require('node:assert/strict');
const { opsProblems } = require('./ops');

const now = new Date('2026-10-23T02:00:00Z');
test('Giám sát vận hành: sao lưu quá hạn / lỗi / chưa mã hoá, job lỗi', () => {
  const ok = { lastOk: '2026-10-22T20:00:00Z', encrypted: true, copied: true, restoreTestOk: '2026-09-01T00:00:00Z' };
  assert.deepEqual(opsProblems({ backup: ok, ledger: {}, now }), []);
  assert.match(opsProblems({ backup: { ...ok, restoreTestOk: '2026-06-01T00:00:00Z' }, ledger: {}, now })[0], /thử khôi phục/);
  assert.match(opsProblems({ backup: ok, ledger: {}, now, demoActive: ['giamdoc'] })[0], /Tài khoản mẫu.*giamdoc/);
  assert.match(opsProblems({ backup: ok, ledger: { x: { at: '2026-10-22T00:00:00Z', running: true } }, now })[0], /dừng giữa chừng.*: x/);
  assert.match(opsProblems({ backup: null, ledger: {}, now })[0], /Chưa ghi nhận/);
  assert.match(opsProblems({ backup: { lastOk: '2026-10-20T20:00:00Z', encrypted: true, copied: true }, now })[0], /54 giờ/);
  const p = opsProblems({ backup: { lastOk: '2026-10-22T20:00:00Z', lastFailAt: '2026-10-22T21:00:00Z', error: 'pg_dump', encrypted: false, copied: false, restoreTestOk: '2026-10-01T00:00:00Z' },
    ledger: { mtl_alerts: { at: '2026-10-22T00:30:00Z', ok: false }, due_soon: { at: '2026-10-22T01:00:00Z', ok: true }, old: { at: '2026-10-10T00:00:00Z', ok: false } }, now });
  assert.equal(p.length, 4);
  assert.ok(p.some(x => /lỗi: pg_dump/.test(x)) && p.some(x => /chưa mã hoá/.test(x)) && p.some(x => /ngoài máy/.test(x)) && p.some(x => /mtl_alerts\./.test(x)));
});
