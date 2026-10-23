const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('./jobs');

const at = s => new Date(s);
const JOBS = [
  { name: 'alerts', at: '07:30' },
  { name: 'reminder', at: '15:00', until: '17:30', days: [1, 2, 3, 4, 5] },
  { name: 'summary', at: '07:35', until: '12:00', days: [1] },
];

test('job đến hạn theo giờ VN: đúng thứ, sau giờ chạy, trước giờ cuối, hôm nay chưa chạy', () => {
  const names = (ledger, t) => J.dueJobs(JOBS, ledger, at(t)).map(j => j.name);
  assert.deepEqual(names({}, '2026-10-30T07:00:00+07:00'), []); // chưa tới giờ
  assert.deepEqual(names({}, '2026-10-30T09:10:00+07:00'), ['alerts']); // PC bật 9:10 → chạy bù cảnh báo 7:30
  assert.deepEqual(names({ alerts: { day: '2026-10-30' } }, '2026-10-30T16:00:00+07:00'), ['reminder']);
  assert.deepEqual(names({ alerts: { day: '2026-10-30' } }, '2026-10-30T18:00:00+07:00'), []); // quá 17:30: nhắc nộp không còn ý nghĩa
  assert.deepEqual(names({ alerts: { day: '2026-10-30' } }, '2026-11-02T08:00:00+07:00'), ['alerts', 'summary']); // thứ Hai
  assert.deepEqual(names({ alerts: { day: '2026-10-29' } }, '2026-10-29T23:45:00Z'), []); // 06:45 thứ Sáu giờ VN: chưa tới giờ
  assert.deepEqual(names({ alerts: { day: '2026-10-29' } }, '2026-10-30T00:40:00Z'), ['alerts']); // 07:40 giờ VN: ngày mới theo giờ VN
});

test('bộ lập lịch: chạy một lần / ngày, lỗi của job không làm dừng, ghi sổ lần chạy', async () => {
  let store = null; const calls = [];
  const prisma = { appSetting: {
    findUnique: async () => (store ? { value: store } : null),
    upsert: async ({ create, update }) => { store = (store ? update : create).value; },
  } };
  const jobs = [
    { name: 'ok', at: '07:00', run: async () => { calls.push('ok'); return { sent: 2 }; } },
    { name: 'boom', at: '07:00', run: async () => { calls.push('boom'); throw new Error('db down'); } },
  ];
  const quiet = { log: () => {}, error: () => {} };
  const s = J.scheduler(prisma, jobs, { log: quiet });
  assert.deepEqual(await s.tick(at('2026-10-30T08:00:00+07:00')), ['ok', 'boom']);
  assert.deepEqual(await s.tick(at('2026-10-30T08:01:00+07:00')), []); // không chạy lại trong ngày
  assert.equal(store.ok.ok, true); assert.equal(store.boom.ok, false); assert.match(store.boom.error, /db down/);
  assert.deepEqual(await s.tick(at('2026-10-31T08:00:00+07:00')), ['ok', 'boom']); // ngày mới
  assert.deepEqual(calls, ['ok', 'boom', 'ok', 'boom']);
});
