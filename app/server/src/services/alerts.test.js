const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./alerts');
const M = require('./mtl');

const cfg = M.DEFAULT_ALERTS;
const day = new Date('2027-02-15T05:00:00Z');
const item = (s, e, extra = {}) => ({ id: 1, state: { category: 'STARTED' }, progress: 0, baselineStart: new Date(s + 'T00:00:00+07:00'), baselineEnd: new Date(e + 'T23:59:59+07:00'), ...extra });

test('loại cảnh báo theo trạng thái hạng mục', () => {
  const kinds = (it, a) => A.kindsFor(it, M.statusOf(it, a, day, cfg), day, cfg);
  assert.deepEqual(kinds(item('2027-02-20', '2027-03-31'), 0), ['START_SOON']);
  assert.deepEqual(kinds(item('2027-01-01', '2027-01-31', { progress: 50 }), 50), ['OVERDUE']);
  assert.deepEqual(kinds(item('2027-01-01', '2027-02-20', { progress: 10, startedAt: new Date('2027-01-02'), progressAt: new Date('2027-02-14') }), 10), ['BEHIND', 'DUE_SOON']);
  assert.deepEqual(kinds(item('2027-02-01', '2027-04-30', { progress: 40, startedAt: new Date('2027-02-01'), progressAt: new Date('2027-02-01') }), 40), ['AHEAD', 'STALE']);
  assert.deepEqual(kinds(item('2027-02-01', '2027-03-31'), 0), ['LATE_START']);
});

test('chu kỳ nhắc lại', () => {
  assert.equal(A.shouldSend('BEHIND', null, day), true);
  assert.equal(A.shouldSend('BEHIND', new Date('2027-02-10T05:00:00Z'), day), false);
  assert.equal(A.shouldSend('BEHIND', new Date('2027-02-08T05:00:00Z'), day), true);
  assert.equal(A.shouldSend('START_SOON', new Date('2027-01-01T05:00:00Z'), day), false); // chỉ một lần
  assert.equal(A.shouldSend('OVERDUE', new Date('2027-02-12T05:00:00Z'), day), true);
});
