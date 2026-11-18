// Kho file dự án: đặt tên theo quy ước, phiên bản không ghi đè, xoá trên Hub = chuyển vào _LuuTru.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-test-'));
process.env.NAS_ROOT = ROOT;
const nas = require('./nas');
fs.mkdirSync(path.join(ROOT, 'NOXH-DuongXa'));

test('chỉ dự án đã có thư mục trong kho mới lưu vào kho', () => {
  assert.equal(nas.projectFolder('NOXH'), 'NOXH-DuongXa');
  assert.equal(nas.projectFolder('KT'), null);
  assert.equal(nas.planPath({ projectKey: 'KT', root: { number: 1, title: 'x' }, item: { number: 1 }, fileName: 'a.pdf' }), null);
});

test('tên theo quy ước, phiên bản tăng, không ghi đè', () => {
  const meta = { projectKey: 'NOXH', root: { number: 1, title: 'Pháp lý dự án' }, item: { number: 12 }, deptCode: 'PC', fileName: 'Hợp đồng tư vấn.PDF', date: new Date('2026-11-18T03:00:00Z') };
  const p1 = nas.planPath(meta);
  assert.equal(p1.rel, 'NOXH-DuongXa/NOXH-1_PhapLyDuAn/NOXH-12_PC_HopDongTuVan_v01_20261118.pdf');
  const k1 = nas.save(p1.rel, Buffer.from('a'));
  assert.ok(nas.isNasKey(k1));
  const p2 = nas.planPath(meta);
  assert.equal(p2.version, 2);
  assert.throws(() => nas.save(p1.rel, Buffer.from('b'))); // không ghi đè bản cũ
  // Thư mục hạng mục đã có (tên đổi sau) thì dùng lại.
  assert.match(nas.planPath({ ...meta, root: { number: 1, title: 'Tên mới' } }).rel, /^NOXH-DuongXa\/NOXH-1_PhapLyDuAn\//);
});

test('xoá trên Hub chuyển tệp vào _LuuTru, không xoá hẳn', () => {
  const p = nas.planPath({ projectKey: 'NOXH', root: { number: 2, title: 'Thiết kế' }, item: { number: 2 }, fileName: 'ban-ve.dwg' });
  const key = nas.save(p.rel, Buffer.from('x'));
  nas.archive(key);
  assert.equal(fs.existsSync(nas.absOf(key)), false);
  assert.equal(fs.readdirSync(path.join(ROOT, 'NOXH-DuongXa', '_LuuTru')).some(n => n.endsWith(`NOXH-2_CHUNG_BanVe_v01_${nas.ymd()}.dwg`)), true);
});

test('chặn đường dẫn ra ngoài kho', () => {
  assert.throws(() => nas.absOf('nas:../etc/passwd'), e => e.code === 'INVALID_OBJECT_KEY');
});
