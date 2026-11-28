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

test('kho sắp xếp lại (26/11/2026): thư mục dự án có số thứ tự "NN." đứng trước; vẫn chỉ "MÃ" hoặc "MÃ-…"; ưu tiên rõ ràng', () => {
  const pick = nas.pickProjectFolder;
  const moi = ['01.NOXH-DuongXa', '03. GFRP (CỐT LIỆU THUỶ TINH)'];
  assert.equal(pick(moi, 'noxh'), '01.NOXH-DuongXa');
  assert.equal(pick(['03. GFRP-CotLieu'], 'GFRP'), '03. GFRP-CotLieu');
  assert.equal(pick(['05.DXA02'], 'DXA02'), '05.DXA02');
  // Không khớp nhầm: mã dài hơn, mã ở giữa tên, tiền tố không phải "NN.", sau mã không phải "-"; mã rỗng không khớp gì.
  assert.equal(pick(['01.NOXH2-Khac', 'NOXHA', '1NOXH-x', 'A.NOXH-x', 'XNOXH', '01.XNOXH', 'NOXH_Cu', '02.NOXH (Cu)'], 'NOXH'), null);
  assert.equal(pick(moi, 'GFRP'), null); // "GFRP (…)": phải đổi tên thành "03.GFRP-…" khi có dự án GFRP
  assert.equal(pick(['05.DXA02'], 'DXA0'), null);
  assert.equal(pick(['-x', 'x', '01.-x'], ''), null);
  assert.equal(pick(null, 'NOXH'), null);
  // Nhiều thư mục cùng khớp: đúng mã > có mô tả; không số > có số; cùng hạng → theo tên, không theo thứ tự NAS trả về.
  assert.equal(pick(['02.NOXH-Cu', '01.NOXH-DuongXa', 'NOXH-DuongXa', 'NOXH'], 'NOXH'), 'NOXH');
  assert.equal(pick(['02.NOXH-Cu', '01.NOXH-DuongXa', 'NOXH-DuongXa'], 'NOXH'), 'NOXH-DuongXa');
  assert.equal(pick(['01.NOXH', 'NOXH-Cu'], 'NOXH'), 'NOXH-Cu');
  assert.equal(pick(['01.NOXH-A', '02.NOXH'], 'NOXH'), '02.NOXH');
  assert.equal(pick(['02.NOXH-Cu', '01.NOXH-DuongXa'], 'NOXH'), '01.NOXH-DuongXa');
  assert.equal(pick(['01.NOXH-DuongXa', '02.NOXH-Cu'], 'NOXH'), '01.NOXH-DuongXa');
});

test('dự án có thư mục đánh số (tên có khoảng trắng, ngoặc, dấu): lưu đúng thư mục, gỡ vào lưu trữ của dự án đó', () => {
  const gfrp = '03. GFRP-Cốt liệu (thuỷ tinh)';
  for (const d of ['01.PhapLy', '99.LuuTru']) fs.mkdirSync(path.join(ROOT, gfrp, d), { recursive: true });
  fs.mkdirSync(path.join(ROOT, '01.NOXH-DuongXa'), { recursive: true }); // thư mục không số "NOXH-DuongXa" vẫn được ưu tiên
  assert.equal(nas.projectFolder('NOXH'), 'NOXH-DuongXa');
  assert.equal(nas.projectFolder('gfrp'), gfrp);
  const p = nas.planPath({ projectKey: 'GFRP', root: { number: 1, title: 'Pháp lý' }, item: { number: 3 }, deptCode: 'PC', rootDeptCode: 'PC', fileName: 'Giấy phép.pdf', date: new Date('2026-11-28T03:00:00Z') });
  assert.equal(p.rel, `${gfrp}/01.PhapLy/GFRP-1_PhapLy/GFRP-3_PC_GiayPhep_v01_20261128.pdf`);
  const key = nas.save(p.rel, Buffer.from('g'));
  nas.archive(key);
  assert.equal(fs.existsSync(nas.absOf(key)), false);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, gfrp, '99.LuuTru')).map(n => n.replace(/^\d+_/, '')), ['GFRP-3_PC_GiayPhep_v01_20261128.pdf']);
});

test('chặn đường dẫn ra ngoài kho', () => {
  assert.throws(() => nas.absOf('nas:../etc/passwd'), e => e.code === 'INVALID_OBJECT_KEY');
});
