// Tài liệu dự án: quyền xem (thành viên + Ban GĐ), duyệt thư mục NAS chỉ đọc, chặn path traversal / symlink ra ngoài, tìm theo tên.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pdocs-test-'));
const ROOT = path.join(TMP, 'nas');
process.env.NAS_ROOT = ROOT;
const PROJ = path.join(ROOT, 'DXA-DuongXa');
for (const d of ['01.PhapLy/GiayPhep', '02.ThietKe', '@eaDir']) fs.mkdirSync(path.join(PROJ, d), { recursive: true });
fs.writeFileSync(path.join(PROJ, '01.PhapLy', 'Quyết định giao đất.pdf'), 'pdf');
fs.writeFileSync(path.join(PROJ, '01.PhapLy', 'GiayPhep', 'GPXD_v01.pdf'), 'gp');
fs.writeFileSync(path.join(PROJ, '02.ThietKe', 'ban-ve-10.dwg'), 'dwg');
fs.writeFileSync(path.join(PROJ, '02.ThietKe', 'ban-ve-2.dwg'), 'dwg');
fs.writeFileSync(path.join(PROJ, 'Thumbs.db'), 'x');
fs.writeFileSync(path.join(PROJ, '~$tam.docx'), 'x');
fs.mkdirSync(path.join(ROOT, 'KHAC-DuAnKhac'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'KHAC-DuAnKhac', 'bi-mat.pdf'), 'secret');
fs.writeFileSync(path.join(TMP, 'ngoai-kho.txt'), 'secret');
let symlinkOk = true;
try { fs.symlinkSync(path.join(ROOT, 'KHAC-DuAnKhac'), path.join(PROJ, 'link-ra-ngoai'), 'junction'); } catch { symlinkOk = false; }

const PD = require('./project-docs');
const base = () => PD.projectRoot('DXA');

test('quyền xem tài liệu dự án: thành viên, trưởng dự án, Ban GĐ; không cho quản trị IT, người ngoài, dự án đã xoá', () => {
  const project = { id: 1, leadId: 7, deletedAt: null };
  assert.equal(PD.canViewDocs({ id: 5, role: 'member' }, project, { role: 'MEMBER' }), true);
  assert.equal(PD.canViewDocs({ id: 5, role: 'member' }, project, { role: 'VIEWER' }), true);
  assert.equal(PD.canViewDocs({ id: 7, role: 'manager' }, project, null), true);
  assert.equal(PD.canViewDocs({ id: 9, role: 'director' }, project, null), true);
  assert.equal(PD.canViewDocs({ id: 6, role: 'manager' }, project, null), false); // trưởng phòng không là thành viên
  assert.equal(PD.canViewDocs({ id: 1, role: 'admin' }, project, { role: 'OWNER' }), false);
  assert.equal(PD.canViewDocs({ id: 2, role: 'member', isRootAdmin: true }, project, { role: 'OWNER' }), false);
  assert.equal(PD.canViewDocs({ id: 9, role: 'director' }, { ...project, deletedAt: new Date() }, null), false);
});

test('thư mục dự án tìm theo KEY; liệt kê thư mục trước, tệp sau, sắp theo số tự nhiên; ẩn tệp hệ thống', () => {
  assert.equal(base().folder, 'DXA-DuongXa');
  assert.equal(PD.projectRoot('KHONGCO'), null);
  const top = PD.listDir(base().abs, '');
  assert.deepEqual(top.entries.filter(e => e.name !== 'link-ra-ngoai').map(e => e.name), ['01.PhapLy', '02.ThietKe']);
  const tk = PD.listDir(base().abs, '02.ThietKe');
  assert.deepEqual(tk.entries.map(e => e.name), ['ban-ve-2.dwg', 'ban-ve-10.dwg']);
  assert.equal(tk.entries[0].path, '02.ThietKe/ban-ve-2.dwg');
  assert.equal(tk.entries[0].size, 3);
  // Dấu "\" kiểu Windows và "/" thừa vẫn hiểu.
  assert.equal(PD.listDir(base().abs, '\\01.PhapLy\\GiayPhep/').entries[0].name, 'GPXD_v01.pdf');
});

test('chặn path traversal: "..", đường dẫn tuyệt đối, ổ đĩa, NUL, thư mục ẩn', () => {
  const b = base().abs;
  for (const bad of ['..', '../KHAC-DuAnKhac', '01.PhapLy/../../KHAC-DuAnKhac/bi-mat.pdf', '..\\..\\ngoai-kho.txt', 'C:/Windows', 'a\0b', '@eaDir', './01.PhapLy'])
    assert.throws(() => PD.resolveIn(b, bad), e => e.status === 400 && e.code === 'INVALID_PATH', bad);
  // Đường dẫn tuyệt đối bị coi là tương đối trong thư mục dự án (bỏ "/" đầu) → không tồn tại, không ra ngoài.
  assert.throws(() => PD.resolveIn(b, path.join(TMP, 'ngoai-kho.txt')), e => [400, 404].includes(e.status));
  assert.throws(() => PD.resolveIn(b, 'khong-co.pdf'), e => e.status === 404);
  assert.equal(PD.resolveIn(b, '01.PhapLy/Quyết định giao đất.pdf').rel, '01.PhapLy/Quyết định giao đất.pdf');
});

test('symlink / junction trỏ ra ngoài thư mục dự án: không liệt kê, không đọc được', { skip: !symlinkOk && 'không tạo được symlink trên máy này' }, () => {
  const b = base().abs;
  assert.equal(PD.listDir(b, '').entries.some(e => e.name === 'link-ra-ngoai'), false);
  assert.throws(() => PD.resolveIn(b, 'link-ra-ngoai/bi-mat.pdf'), e => e.status === 400);
  assert.equal(PD.search(b, 'bi-mat').entries.length, 0);
});

test('tìm theo tên không dấu, không phân biệt hoa thường, có giới hạn', () => {
  const b = base().abs;
  assert.deepEqual(PD.search(b, 'QUYET DINH').entries.map(e => e.path), ['01.PhapLy/Quyết định giao đất.pdf']);
  assert.deepEqual(PD.search(b, 'gpxd').entries.map(e => e.path), ['01.PhapLy/GiayPhep/GPXD_v01.pdf']);
  assert.deepEqual(PD.search(b, 'ban ve 10').entries.map(e => e.path), ['02.ThietKe/ban-ve-10.dwg']); // "-" ≈ khoảng trắng
  const r = PD.search(b, 'ban-ve', { limit: 1 });
  assert.equal(r.entries.length, 1);
  assert.equal(r.truncated, true);
  assert.equal(PD.search(b, '   ').entries.length, 0);
  assert.equal(PD.search(b, 'thumbs').entries.length, 0); // tệp hệ thống không hiện
});
