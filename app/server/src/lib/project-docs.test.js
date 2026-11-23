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
const rejects = (p, check, msg) => assert.rejects(p, check, msg);
const real = { ...PD.fsp };
const restore = () => Object.assign(PD.fsp, real);

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

test('thư mục dự án tìm theo KEY; liệt kê thư mục trước, tệp sau, sắp theo số tự nhiên; ẩn tệp hệ thống', async () => {
  const b = await base();
  assert.equal(b.folder, 'DXA-DuongXa');
  assert.equal(await PD.projectRoot('KHONGCO'), null);
  const names = await PD.rootFolders(); // đọc gốc NAS một lần, dùng cho nhiều dự án
  assert.equal(PD.folderFor(names, 'dxa'), 'DXA-DuongXa');
  assert.equal(PD.folderFor(names, 'DX'), null); // "DX" không khớp "DXA-…"
  const top = await PD.listDir(b.abs, '');
  assert.deepEqual(top.entries.filter(e => e.name !== 'link-ra-ngoai').map(e => e.name), ['01.PhapLy', '02.ThietKe']);
  const tk = await PD.listDir(b.abs, '02.ThietKe');
  assert.deepEqual(tk.entries.map(e => e.name), ['ban-ve-2.dwg', 'ban-ve-10.dwg']);
  assert.equal(tk.entries[0].path, '02.ThietKe/ban-ve-2.dwg');
  assert.equal(tk.entries[0].size, 3);
  // Dấu "\" kiểu Windows và "/" thừa vẫn hiểu.
  assert.equal((await PD.listDir(b.abs, '\\01.PhapLy\\GiayPhep/')).entries[0].name, 'GPXD_v01.pdf');
});

test('chặn path traversal: "../", "..\\", đường dẫn tuyệt đối, ổ đĩa, NUL, thư mục ẩn', async () => {
  const b = (await base()).abs;
  for (const bad of ['..', '../', '../KHAC-DuAnKhac', '../KHAC-DuAnKhac/bi-mat.pdf', '01.PhapLy/../../KHAC-DuAnKhac/bi-mat.pdf', '..\\..\\ngoai-kho.txt',
    '01.PhapLy/..', 'C:/Windows/win.ini', 'C:\\Windows', 'a\0b', '@eaDir', './01.PhapLy'])
    await rejects(PD.resolveIn(b, bad), e => e.status === 400 && e.code === 'INVALID_PATH', JSON.stringify(bad));
  // Đường dẫn tuyệt đối ("/etc/passwd", đường dẫn thật tới tệp ngoài kho) bị coi là tương đối trong thư mục dự án → không ra ngoài (404).
  for (const abs of ['/etc/passwd', path.join(TMP, 'ngoai-kho.txt'), path.join(ROOT, 'KHAC-DuAnKhac', 'bi-mat.pdf').replace(/^[A-Za-z]:/, '')])
    await rejects(PD.resolveIn(b, abs), e => e.status === 404 || e.status === 400, abs);
  await rejects(PD.resolveIn(b, 'khong-co.pdf'), e => e.status === 404);
  assert.equal((await PD.resolveIn(b, '01.PhapLy/Quyết định giao đất.pdf')).rel, '01.PhapLy/Quyết định giao đất.pdf');
  assert.equal((await PD.resolveIn(b, '/01.PhapLy/Quyết định giao đất.pdf')).rel, '01.PhapLy/Quyết định giao đất.pdf');
});

test('symlink / junction trỏ ra ngoài thư mục dự án: không liệt kê, không đọc được', { skip: !symlinkOk && 'không tạo được symlink trên máy này' }, async () => {
  const b = (await base()).abs;
  assert.equal((await PD.listDir(b, '')).entries.some(e => e.name === 'link-ra-ngoai'), false);
  await rejects(PD.resolveIn(b, 'link-ra-ngoai/bi-mat.pdf'), e => e.status === 400);
  assert.equal((await PD.search(b, 'bi-mat')).entries.length, 0);
});

test('tìm theo tên không dấu, không phân biệt hoa thường, có giới hạn số kết quả', async () => {
  const b = (await base()).abs;
  assert.deepEqual((await PD.search(b, 'QUYET DINH')).entries.map(e => e.path), ['01.PhapLy/Quyết định giao đất.pdf']);
  assert.deepEqual((await PD.search(b, 'gpxd')).entries.map(e => e.path), ['01.PhapLy/GiayPhep/GPXD_v01.pdf']);
  assert.deepEqual((await PD.search(b, 'ban ve 10')).entries.map(e => e.path), ['02.ThietKe/ban-ve-10.dwg']); // "-" ≈ khoảng trắng
  const r = await PD.search(b, 'ban-ve', { limit: 1 });
  assert.equal(r.entries.length, 1);
  assert.equal(r.truncated, true);
  assert.equal((await PD.search(b, '   ')).entries.length, 0);
  assert.equal((await PD.search(b, 'thumbs')).entries.length, 0); // tệp hệ thống không hiện
  assert.equal((await PD.search(b, 'ban', { maxVisited: 2 })).truncated, true);
  assert.equal((await PD.search(b, 'gpxd', { maxDepth: 1 })).entries.length, 0); // GPXD ở tầng 3
});

test('tìm kiếm có ngân sách thời gian: NAS chậm → dừng đúng hạn, trả kết quả đã có + truncated', async () => {
  const b = (await base()).abs;
  PD.fsp.readdir = async (p, o) => { if (p !== b) await new Promise(r => setTimeout(r, 400)); return real.readdir(p, o); };
  try {
    const t0 = Date.now();
    const r = await PD.search(b, 'ban', { budgetMs: 150 });
    assert.ok(Date.now() - t0 < 1000, 'dừng theo ngân sách, không chờ hết cây');
    assert.equal(r.truncated, true);
    assert.equal((await PD.search(b, 'ban', { budgetMs: 0 })).truncated, true);
  } finally { restore(); }
});

test('liệt kê giới hạn số thao tác đĩa song song', async () => {
  const dir = path.join(PROJ, '03.Nhieu');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(dir, `tep-${i}.pdf`), 'x');
  let now = 0, peak = 0;
  PD.fsp.stat = async p => { now++; peak = Math.max(peak, now); await new Promise(r => setTimeout(r, 5)); try { return await real.stat(p); } finally { now--; } };
  try {
    const r = await PD.listDir((await base()).abs, '03.Nhieu', { concurrency: 4 });
    assert.equal(r.entries.length, 30);
    assert.ok(peak <= 4, `tối đa 4 stat cùng lúc (thực tế ${peak})`);
  } finally { restore(); fs.rmSync(dir, { recursive: true }); }
});

test('NAS lỗi kết nối → 503 "Kho file đang không truy cập được"; không có thư mục → 404 / null', async () => {
  const b = (await base()).abs;
  const fail = code => async () => { throw Object.assign(new Error(code), { code }); };
  try {
    for (const code of ['EIO', 'EHOSTDOWN', 'ETIMEDOUT', 'ENOTCONN']) {
      PD.fsp.readdir = fail(code);
      await rejects(PD.rootFolders(), e => e.status === 503 && e.code === 'NAS_UNAVAILABLE' && /không truy cập được/.test(e.message), code);
      await rejects(PD.projectRoot('DXA'), e => e.status === 503, code);
      await rejects(PD.listDir(b, ''), e => e.status === 503, code);
    }
    restore();
    PD.fsp.realpath = fail('EHOSTDOWN');
    await rejects(PD.resolveIn(b, '01.PhapLy'), e => e.status === 503);
    await rejects(PD.projectRoot('DXA'), e => e.status === 503);
    restore();
    PD.fsp.stat = fail('EIO');
    await rejects(PD.statOf(path.join(b, '01.PhapLy')), e => e.status === 503);
    restore();
    // Không có: 404 (đường dẫn) / null (thư mục dự án) — không phải 503.
    PD.fsp.readdir = fail('ENOENT');
    assert.equal(await PD.rootFolders(), null);
    restore();
    await rejects(PD.resolveIn(b, 'khong-co'), e => e.status === 404);
    assert.equal(PD.nasError(Object.assign(new Error('x'), { code: 'ENOTDIR' })).status, 404);
  } finally { restore(); }
});
