const test = require('node:test');
const assert = require('node:assert/strict');
const { orgOf, imageKind } = require('./profile');

// Cây tổ chức giả: Ban GĐ (TGĐ 1, PGĐ 2 phụ trách Ban Pháp lý), Ban Pháp lý (trưởng 10, phó 11, nhân viên 12, 13), Tổ hồ sơ (con của PL: trưởng 20).
const depts = new Map([
  [1, { id: 1, name: 'Ban Giám đốc', parentId: null, supervisorId: null }],
  [5, { id: 5, name: 'Ban Pháp lý', parentId: null, supervisorId: 2 }],
  [6, { id: 6, name: 'Tổ hồ sơ', parentId: 5, supervisorId: null }],
]);
const U = (id, role, departmentId) => ({ id, fullName: 'Người ' + id, displayTitle: null, role, departmentId, avatarFile: id === 12 ? 'avatars/x.png' : null });
const users = [U(1, 'director', 1), U(2, 'director', 1), U(10, 'manager', 5), U(11, 'deputy', 5), U(12, 'member', 5), U(13, 'member', 5), U(20, 'manager', 6), U(21, 'member', 6)];
const ids = list => list.map(p => p.id);

test('nhân viên: trên mình là Ban GĐ → PGĐ phụ trách → lãnh đạo bộ phận; đồng cấp là nhân viên cùng bộ phận', () => {
  const o = orgOf(users.find(u => u.id === 12), users, depts);
  assert.deepEqual(o.above.map(l => l.label), ['Ban Giám đốc', 'Phó Giám đốc phụ trách', 'Lãnh đạo Ban Pháp lý']);
  assert.deepEqual(ids(o.above[0].people), [1]);
  assert.deepEqual(ids(o.above[1].people), [2]);
  assert.deepEqual(ids(o.above[2].people).sort(), [10, 11]);
  assert.deepEqual(ids(o.peers), [13]);
  assert.equal(o.below.length, 0);
  assert.equal(o.me.avatarUrl, '/avatars/x.png');
});

test('nhân viên bộ phận con: lãnh đạo tổ → lãnh đạo bộ phận cấp trên → PGĐ phụ trách bộ phận cấp trên → Ban GĐ', () => {
  const o = orgOf(users.find(u => u.id === 21), users, depts);
  assert.deepEqual(o.above.map(l => l.label), ['Ban Giám đốc', 'Phó Giám đốc phụ trách', 'Lãnh đạo Ban Pháp lý', 'Lãnh đạo Tổ hồ sơ']);
});

test('trưởng bộ phận: dưới mình là thành viên bộ phận và lãnh đạo bộ phận con', () => {
  const o = orgOf(users.find(u => u.id === 10), users, depts);
  assert.deepEqual(o.above.map(l => l.label), ['Ban Giám đốc', 'Phó Giám đốc phụ trách']);
  assert.deepEqual(ids(o.below[0].people).sort(), [11, 12, 13]);
  assert.deepEqual(ids(o.below[1].people), [20]);
});

test('Phó GĐ phụ trách: dưới mình là lãnh đạo các bộ phận phụ trách; TGĐ: lãnh đạo mọi bộ phận cấp 1', () => {
  const pgd = orgOf(users.find(u => u.id === 2), users, depts);
  assert.equal(pgd.above.length, 0);
  assert.deepEqual(pgd.below.map(b => b.label), ['Ban Pháp lý']);
  assert.deepEqual(ids(pgd.below[0].people).sort(), [10, 11]);
  const tgd = orgOf(users.find(u => u.id === 1), users, depts);
  assert.deepEqual(tgd.below.map(b => b.label), ['Ban Pháp lý']);
  assert.deepEqual(ids(tgd.peers), [2]);
});

test('ảnh đại diện: nhận diện theo chữ ký tệp, không theo phần mở rộng', () => {
  assert.equal(imageKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])), 'png');
  assert.equal(imageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])), 'jpg');
  assert.equal(imageKind(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])), 'webp');
  assert.equal(imageKind(Buffer.from('<svg onload=alert(1)>')), null);
});
