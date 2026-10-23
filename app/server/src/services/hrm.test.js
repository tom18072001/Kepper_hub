const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./hrm');
const C = require('../lib/crypto-field');

const cfg = { ...H.DEFAULTS, holidays: ['2026-09-02'] };

test('Ngày nghỉ: bỏ cuối tuần, ngày lễ; nửa ngày chỉ khi một ngày làm việc', () => {
  assert.equal(H.leaveDays('2026-08-31', '2026-09-04', 'NONE', cfg), 4); // T2–T6, trừ 2/9
  assert.equal(H.leaveDays('2026-09-05', '2026-09-06', 'NONE', cfg), 0); // T7, CN
  assert.equal(H.leaveDays('2026-09-07', '2026-09-07', 'AM', cfg), 0.5);
  assert.ok(Number.isNaN(H.leaveDays('2026-09-07', '2026-09-08', 'AM', cfg)));
  assert.ok(Number.isNaN(H.leaveDays('2026-09-02', '2026-09-02', 'PM', cfg))); // ngày lễ
});

test('Phép năm: 12 ngày, +1 mỗi 5 năm, vào làm trong năm tính theo tháng', () => {
  assert.equal(H.annualQuota(2026, null, cfg), 12);
  assert.equal(H.annualQuota(2026, new Date('2021-03-01T00:00:00+07:00'), cfg), 13);
  assert.equal(H.annualQuota(2026, new Date('2016-03-01T00:00:00+07:00'), cfg), 14);
  assert.equal(H.annualQuota(2026, new Date('2026-07-01T00:00:00+07:00'), cfg), 6);
  assert.equal(H.annualQuota(2026, new Date('2027-01-05T00:00:00+07:00'), cfg), 0);
});

test('Đi muộn / về sớm theo giờ Việt Nam, có phút cho phép', () => {
  const t = s => new Date(`2026-09-07T${s}:00+07:00`);
  assert.deepEqual(H.lateEarly(t('08:04'), t('17:30'), cfg), { minutesLate: 0, minutesEarly: 0 });
  assert.deepEqual(H.lateEarly(t('08:20'), t('17:00'), cfg), { minutesLate: 20, minutesEarly: 30 });
  assert.deepEqual(H.lateEarly(null, null, cfg), { minutesLate: 0, minutesEarly: 0 });
});

test('Mạng văn phòng (CIDR IPv4, cả dạng ::ffff:)', () => {
  assert.ok(H.cidrValid('192.168.1.0/24'));
  assert.ok(!H.cidrValid('192.168.1.0/33'));
  assert.ok(!H.cidrValid('300.1.1.1/8'));
  assert.ok(H.inNetworks('192.168.1.77', ['192.168.1.0/24']));
  assert.ok(H.inNetworks('::ffff:10.0.5.9', ['10.0.0.0/8']));
  assert.ok(!H.inNetworks('192.168.2.1', ['192.168.1.0/24']));
  assert.ok(!H.inNetworks('fe80::1', ['192.168.1.0/24']));
});

test('Bảng công tháng: lễ, cuối tuần, nghỉ phép, thiếu công, giải trình đã duyệt', () => {
  const recs = [
    { day: '2026-09-07', checkIn: '2026-09-07T01:00:00Z', checkOut: '2026-09-07T10:30:00Z', minutesLate: 0, minutesEarly: 0 },
    { day: '2026-09-08', checkIn: '2026-09-08T01:30:00Z', checkOut: null, minutesLate: 30, minutesEarly: 0 },
    { day: '2026-09-09', adjust: { status: 'APPROVED' } },
  ];
  const leaves = [{ id: 1, status: 'APPROVED', type: 'ANNUAL', halfDay: 'NONE', fromDate: new Date('2026-09-10T00:00:00+07:00'), toDate: new Date('2026-09-11T00:00:00+07:00') }];
  const sheet = H.monthSheet('2026-09', recs, leaves, cfg, '2026-09-15');
  const st = d => sheet.find(x => x.day === d).status;
  assert.equal(sheet.length, 30);
  assert.equal(st('2026-09-02'), 'HOLIDAY');
  assert.equal(st('2026-09-05'), 'OFF');
  assert.equal(st('2026-09-07'), 'OK');
  assert.equal(st('2026-09-08'), 'NO_OUT');
  assert.equal(st('2026-09-09'), 'ADJUSTED');
  assert.equal(st('2026-09-10'), 'LEAVE');
  assert.equal(st('2026-09-14'), 'MISSING');
  assert.equal(st('2026-09-15'), 'TODAY');
  assert.equal(st('2026-09-16'), 'FUTURE');
});

test('Mã hoá theo trường: AES-256-GCM, khoá sai → lỗi, máy chạy thiếu khoá → không chạy', () => {
  const env = { HR_ENC_KEY: 'a'.repeat(64) };
  C._reset();
  const enc = C.encrypt('001090012345', env);
  assert.match(enc, /^v1:/);
  assert.notEqual(enc, C.encrypt('001090012345', env)); // IV ngẫu nhiên
  assert.equal(C.decrypt(enc, env), '001090012345');
  C._reset();
  assert.throws(() => C.decrypt(enc, { HR_ENC_KEY: 'b'.repeat(64) }));
  C._reset();
  assert.equal(C.tryDecrypt(enc, { HR_ENC_KEY: 'b'.repeat(64) }), null);
  C._reset();
  assert.throws(() => C.keyOf({ NODE_ENV: 'production' }), /HR_ENC_KEY/);
  C._reset();
  assert.throws(() => C.keyOf({ HR_ENC_KEY: 'short' }), /32 byte/);
  C._reset();
  assert.equal(C.last4('0010 9001 2345'), '2345');
  assert.equal(C.encrypt('', env), null);
  C._reset();
});
