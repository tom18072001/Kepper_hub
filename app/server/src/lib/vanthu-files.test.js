// Kho văn thư trên NAS: thư mục phòng + sổ (kể cả HCNS đánh số khác), phòng mặc định, tên theo số văn bản, không ghi đè, gỡ = lưu trữ.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'vanthu-test-'));
process.env.VANTHU_NAS_ROOT = ROOT;
delete process.env.VANTHU_DEPT_FOLDERS; // bảng mặc định
process.env.VANTHU_DEFAULT_DEPT = 'HCNS';
const vt = require('./vanthu-files');
for (const d of ['#2.HCNS/02.VanBanDi', '#2.HCNS/03.VanBanDen', '#6.PhongTongHop/01.VanBanDen', '#6.PhongTongHop/02.VanBanDi', '#6.PhongTongHop/03.VanBanNoiBo'])
  fs.mkdirSync(path.join(ROOT, d), { recursive: true });

const day = new Date('2026-11-19T03:00:00Z');
const den = { book: 'DEN', year: 2026, number: '0001/2026/Đ-HLD' };

test('thư mục sổ theo phòng; HCNS đánh số khác vẫn đúng; thiếu thư mục → null (giữ trong Hub)', () => {
  assert.equal(vt.bookFolder('TH', 'DEN'), path.join('#6.PhongTongHop', '01.VanBanDen'));
  assert.equal(vt.bookFolder('HCNS', 'DEN'), path.join('#2.HCNS', '03.VanBanDen'));
  assert.equal(vt.bookFolder(null, 'DI'), path.join('#2.HCNS', '02.VanBanDi')); // chưa gắn bộ phận → văn thư HCNS
  assert.equal(vt.bookFolder('HCNS', 'NOIBO'), null); // chưa tạo thư mục nội bộ → không tự tạo
  assert.equal(vt.bookFolder('PC', 'DEN'), null); // thư mục phòng chưa có
  assert.equal(vt.bookFolder('XYZ', 'DEN'), null); // phòng không có trong bảng
});

test('tên tệp theo số văn bản, thư mục năm, phiên bản tăng, không ghi đè', () => {
  const meta = { doc: den, deptCode: 'TH', fileName: 'Công văn UBND (bản scan).PDF', date: day };
  const p1 = vt.planPath(meta);
  assert.equal(p1.rel, '#6.PhongTongHop/01.VanBanDen/2026/0001-2026-D-HLD_CongVanUBNDBanScan_v01_20261119.pdf');
  const key = vt.save(p1.rel, Buffer.from('a'));
  assert.ok(vt.isKey(key));
  assert.equal(vt.planPath(meta).version, 2);
  assert.throws(() => vt.save(p1.rel, Buffer.from('b')));
  assert.throws(() => vt.absOf('vt:../ngoai.txt'), /không hợp lệ/);
});

test('gỡ tệp: chuyển vào _LuuTru của thư mục sổ, không xoá hẳn', () => {
  const p = vt.planPath({ doc: { book: 'DI', year: 2026, number: '005/2026/HLD-TH' }, deptCode: 'TH', fileName: 'a.pdf', date: day });
  const key = vt.save(p.rel, Buffer.from('x'));
  vt.archive(key);
  assert.equal(fs.existsSync(vt.absOf(key)), false);
  const kept = fs.readdirSync(path.join(ROOT, '#6.PhongTongHop', '02.VanBanDi', '_LuuTru'));
  assert.equal(kept.length, 1);
  assert.match(kept[0], /005-2026-HLD-TH_A_v01_20261119\.pdf$/);
});

test('thư mục phòng nhiều tầng (kho sắp xếp lại 26/11/2026: BTGD=I.KeplerHLD/#1.BOD): lưu vào sổ, gỡ = _LuuTru của sổ', t => {
  const saved = { VANTHU_DEPT_FOLDERS: process.env.VANTHU_DEPT_FOLDERS, VANTHU_DEFAULT_DEPT: process.env.VANTHU_DEFAULT_DEPT };
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  process.env.VANTHU_DEPT_FOLDERS = 'BTGD=I.KeplerHLD/#1.BOD';
  process.env.VANTHU_DEFAULT_DEPT = 'BTGD'; // như máy chủ thật: dự thảo chưa gắn bộ phận → BOD
  const bod = path.join(ROOT, 'I.KeplerHLD', '#1.BOD');
  for (const d of ['01.VanBanDen', '06.VanBanNoiBo/2026', '99.LuuTru']) fs.mkdirSync(path.join(bod, d), { recursive: true });
  const p = vt.planPath({ doc: { book: 'NOIBO', year: 2026, number: 'DuThao-1' }, deptCode: null, fileName: 'Hướng dẫn sử dụng.pdf', date: day });
  assert.equal(p.rel, 'I.KeplerHLD/#1.BOD/06.VanBanNoiBo/2026/DuThao-1_HuongDanSuDung_v01_20261119.pdf');
  const key = vt.save(p.rel, Buffer.from('x'));
  vt.archive(key);
  assert.equal(fs.existsSync(vt.absOf(key)), false);
  assert.deepEqual(fs.readdirSync(path.join(bod, '06.VanBanNoiBo', '_LuuTru')).map(n => n.replace(/^\d+_/, '')), ['DuThao-1_HuongDanSuDung_v01_20261119.pdf']);
  assert.equal(fs.existsSync(path.join(bod, '_LuuTru')), false); // không rơi ra thư mục phòng
  assert.equal(fs.existsSync(path.join(ROOT, 'I.KeplerHLD', '_LuuTru')), false);
  assert.equal(vt.planPath({ doc: den, deptCode: 'BTGD', fileName: 'a.pdf', date: day }).rel, 'I.KeplerHLD/#1.BOD/01.VanBanDen/2026/0001-2026-D-HLD_A_v01_20261119.pdf');
});

test('gỡ dòng tệp đã mất trên NAS (thư mục cũ bị xoá) không lỗi; tệp nằm ngoài thư mục sổ → _LuuTru cạnh tệp', () => {
  assert.doesNotThrow(() => vt.archive('vt:#2.HCNS/07.VanBanNoiBo/2026/DuThao-1_KhongCon_v01_20261125.pdf'));
  const key = vt.save('Khac/2026/le.pdf', Buffer.from('y'));
  vt.archive(key);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'Khac', '2026', '_LuuTru')).map(n => n.replace(/^\d+_/, '')), ['le.pdf']);
});
