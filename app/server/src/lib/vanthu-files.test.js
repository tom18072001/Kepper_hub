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
