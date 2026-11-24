// Đợt C2 (UX Nhân sự): thiếu giờ vào (H6), một nguồn đơn / giải trình chờ duyệt cho "Chờ tôi duyệt" và số đếm (H9),
// phát hiện đơn trùng dùng chung cho xem trước và gửi đơn (H11). Dữ liệu giả, CSDL giả trong bộ nhớ.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./hrm');

const cfg = { ...H.DEFAULTS, holidays: ['2026-09-02'] };
const vn = d => new Date(d + 'T00:00:00+07:00');

test('Bảng công: chấm ra khi chưa chấm vào → "thiếu giờ vào" (NO_IN), không tính đủ công', () => {
  const recs = [
    { day: '2026-09-07', checkIn: null, checkOut: '2026-09-07T10:30:00Z' }, // 17:30 giờ VN, không có giờ vào
    { day: '2026-09-15', checkIn: null, checkOut: '2026-09-14T17:20:00Z' }, // hôm nay 00:20 (bấm nhầm, đã xác nhận)
    { day: '2026-09-08', checkIn: null, checkOut: '2026-09-08T10:30:00Z', adjust: { status: 'APPROVED', in: '2026-09-08T01:00:00Z' } },
  ];
  const sheet = H.monthSheet('2026-09', recs, [], cfg, '2026-09-15');
  const st = d => sheet.find(x => x.day === d).status;
  assert.equal(st('2026-09-07'), 'NO_IN');
  assert.equal(st('2026-09-15'), 'NO_IN');
  assert.equal(st('2026-09-08'), 'ADJUSTED', 'giải trình giờ vào đã duyệt → đã giải trình');
  const t = H.sheetTotals(sheet);
  assert.equal(t.ok, 0);
  assert.ok(t.missing >= 2, 'ngày thiếu giờ vào cộng vào "Thiếu"');
});

// CSDL giả: lọc theo where đơn giản (status / adjustStatus, userId.not, id.in).
function fakeDb({ users, leaves = [], atts = [] }) {
  const match = (row, where) => Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && !(v instanceof Date)
    ? ('not' in v ? row[k] !== v.not : 'in' in v ? v.in.includes(row[k]) : true) : row[k] === v));
  return {
    hrLeave: { findMany: async ({ where }) => leaves.filter(l => match(l, where)) },
    hrAttendance: { findMany: async ({ where }) => atts.filter(a => match(a, where)) },
    user: { findMany: async ({ where }) => users.filter(u => where.id.in.includes(u.id)).map(u => ({ ...u, department: { id: u.departmentId, name: 'Bộ phận ' + u.departmentId } })) },
  };
}
const leaderGrant = [{ permissionKey: 'reports.summary', action: 'VIEW', scope: 'UNIT' }];
const users = [
  { id: 1, departmentId: 5, role: 'manager', permissions: leaderGrant }, // lãnh đạo bộ phận 5 (người duyệt)
  { id: 2, departmentId: 5, role: 'member', permissions: [] }, // nhân viên bộ phận 5
  { id: 3, departmentId: 6, role: 'member', permissions: [] }, // nhân viên bộ phận khác
  { id: 4, departmentId: 5, role: 'manager', permissions: leaderGrant }, // phó bộ phận 5: đơn do Ban TGĐ duyệt
  { id: 9, departmentId: 1, role: 'director', permissions: [] },
];
const db = fakeDb({
  users,
  leaves: [
    { id: 11, userId: 2, status: 'PENDING' }, { id: 12, userId: 3, status: 'PENDING' }, { id: 13, userId: 4, status: 'PENDING' },
    { id: 14, userId: 1, status: 'PENDING' }, { id: 15, userId: 2, status: 'APPROVED' },
  ],
  atts: [{ id: 21, userId: 2, adjustStatus: 'PENDING' }, { id: 22, userId: 3, adjustStatus: 'PENDING' }],
});
const subject = (id, extra = {}) => ({ it: false, director: false, leader: false, hr: false, departmentId: users.find(u => u.id === id).departmentId, userId: id, ...extra });

test('Chờ tôi duyệt (Nhân sự): lãnh đạo bộ phận thấy đơn / giải trình của nhân viên bộ phận mình, không thấy của mình, của phó, của bộ phận khác', async () => {
  const p = await H.pendingDecisions(db, subject(1, { leader: true }), cfg);
  assert.deepEqual(p.leaves.map(l => l.id), [11]);
  assert.deepEqual(p.atts.map(a => a.id), [21]);
});

test('Chờ tôi duyệt (Nhân sự): Ban TGĐ duyệt đơn của lãnh đạo bộ phận; nhân viên thường và quản trị hệ thống: không có gì', async () => {
  const d = await H.pendingDecisions(db, subject(9, { director: true }), cfg);
  assert.deepEqual(d.leaves.map(l => l.id).sort(), [11, 12, 13, 14]);
  assert.equal((await H.pendingDecisions(db, subject(2), cfg)).leaves.length, 0);
  const it = await H.pendingDecisions(db, subject(9, { it: true }), cfg);
  assert.equal(it.leaves.length + it.atts.length, 0);
});

test('Đơn trùng: khoảng ngày giao nhau là trùng; sáng một đơn, chiều một đơn cùng ngày thì không', async () => {
  const rows = [{ id: 1, userId: 2, status: 'PENDING', fromDate: vn('2026-09-10'), toDate: vn('2026-09-11'), halfDay: 'NONE' },
    { id: 2, userId: 2, status: 'APPROVED', fromDate: vn('2026-09-14'), toDate: vn('2026-09-14'), halfDay: 'AM' }];
  const fake = { hrLeave: { findMany: async ({ where }) => rows.filter(r => where.status.in.includes(r.status) && r.fromDate <= where.fromDate.lte && r.toDate >= where.toDate.gte) } };
  assert.equal((await H.findLeaveClash(fake, 2, '2026-09-11', '2026-09-12', 'NONE'))?.id, 1);
  assert.equal(await H.findLeaveClash(fake, 2, '2026-09-12', '2026-09-12', 'NONE'), null);
  assert.equal(await H.findLeaveClash(fake, 2, '2026-09-14', '2026-09-14', 'PM'), null, 'chiều cùng ngày với đơn buổi sáng');
  assert.equal((await H.findLeaveClash(fake, 2, '2026-09-14', '2026-09-14', 'AM'))?.id, 2);
  assert.equal((await H.findLeaveClash(fake, 2, '2026-09-14', '2026-09-14', 'NONE'))?.id, 2);
});
