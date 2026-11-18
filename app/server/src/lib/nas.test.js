// Kho file dự án: đặt tên theo quy ước, thư mục mảng theo phòng chủ trì, phiên bản không ghi đè, xoá trên Hub = chuyển vào lưu trữ.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-test-'));
process.env.NAS_ROOT = ROOT;
process.env.NAS_DEPT_FOLDERS = 'PC=01.PhapLy, TKKT=ThietKe';
const nas = require('./nas');
for (const d of ['01.PhapLy', '03.ThietKe', '99.LuuTru']) fs.mkdirSync(path.join(ROOT, 'NOXH-DuongXa', d), { recursive: true });

test('chỉ dự án đã có thư mục trong kho mới lưu vào kho', () => {
  assert.equal(nas.projectFolder('NOXH'), 'NOXH-DuongXa');
  assert.equal(nas.planPath({ projectKey: 'KT', root: { number: 1, title: 'x' }, item: { number: 1 }, fileName: 'a.pdf' }), null);
});

test('hạng mục vào thư mục mảng theo phòng chủ trì; tên theo quy ước; phiên bản tăng, không ghi đè', () => {
  const meta = { projectKey: 'NOXH', root: { number: 1, title: 'Pháp lý dự án' }, item: { number: 12 }, deptCode: 'PC', rootDeptCode: 'PC', fileName: 'Hợp đồng tư vấn.PDF', date: new Date('2026-11-18T03:00:00Z') };
  const p1 = nas.planPath(meta);
  assert.equal(p1.rel, 'NOXH-DuongXa/01.PhapLy/NOXH-1_PhapLyDuAn/NOXH-12_PC_HopDongTuVan_v01_20261118.pdf');
  nas.save(p1.rel, Buffer.from('a'));
  assert.equal(nas.planPath(meta).version, 2);
  assert.throws(() => nas.save(p1.rel, Buffer.from('b'))); // không ghi đè
  // Việc con do phòng khác chủ trì vẫn nằm trong thư mục mảng của hạng mục; mã phòng trong tên tệp là của việc.
  assert.match(nas.planPath({ ...meta, deptCode: 'TCKT' }).rel, /^NOXH-DuongXa\/01\.PhapLy\/NOXH-1_PhapLyDuAn\/NOXH-12_TCKT_/);
  // Khớp theo phần sau "NN."; phòng không có trong bảng → thư mục dự án.
  assert.match(nas.planPath({ ...meta, root: { number: 3, title: 'TK' }, rootDeptCode: 'TKKT' }).rel, /^NOXH-DuongXa\/03\.ThietKe\/NOXH-3_TK\//);
  assert.match(nas.planPath({ ...meta, root: { number: 4, title: 'Khac' }, rootDeptCode: 'HCNS' }).rel, /^NOXH-DuongXa\/NOXH-4_Khac\//);
});

test('xoá trên Hub chuyển tệp vào thư mục lưu trữ có sẵn (99.LuuTru), không xoá hẳn', () => {
  const p = nas.planPath({ projectKey: 'NOXH', root: { number: 2, title: 'Thiết kế' }, item: { number: 2 }, rootDeptCode: 'TKKT', fileName: 'ban-ve.dwg' });
  const key = nas.save(p.rel, Buffer.from('x'));
  nas.archive(key);
  assert.equal(fs.existsSync(nas.absOf(key)), false);
  assert.ok(fs.readdirSync(path.join(ROOT, 'NOXH-DuongXa', '99.LuuTru')).some(n => n.endsWith('_BanVe_v01_' + nas.ymd() + '.dwg')));
  assert.equal(fs.existsSync(path.join(ROOT, 'NOXH-DuongXa', '_LuuTru')), false);
});

test('chặn đường dẫn ra ngoài kho', () => {
  assert.throws(() => nas.absOf('nas:../etc/passwd'), e => e.code === 'INVALID_OBJECT_KEY');
});
