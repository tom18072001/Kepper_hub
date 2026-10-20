const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { verifyUpload, previewable } = require('./files');

async function tmp(content) {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'wh-files-')), 'f');
  await fs.writeFile(file, content);
  return file;
}

test('nhận PDF/PNG/DOCX đúng chữ ký và trả MIME của server', async () => {
  assert.equal(await verifyUpload('a.pdf', await tmp('%PDF-1.7 ...')), 'application/pdf');
  assert.equal(await verifyUpload('a.PNG', await tmp(Buffer.from('89504e470d0a1a0a0000', 'hex'))), 'image/png');
  assert.match(await verifyUpload('a.docx', await tmp(Buffer.from('504b030414', 'hex'))), /wordprocessingml/);
  assert.match(await verifyUpload('ghi-chu.txt', await tmp('xin chào')), /text\/plain/);
});

test('từ chối đuôi không cho phép và nội dung giả mạo', async () => {
  await assert.rejects(verifyUpload('setup.exe', await tmp('MZ')), { code: 'FILE_TYPE_NOT_ALLOWED' });
  await assert.rejects(verifyUpload('trang.html', await tmp('<html>')), { code: 'FILE_TYPE_NOT_ALLOWED' });
  await assert.rejects(verifyUpload('gia.pdf', await tmp('<html><script>')), { code: 'FILE_TYPE_NOT_ALLOWED' });
  await assert.rejects(verifyUpload('nhiphan.txt', await tmp(Buffer.from([0x41, 0x00, 0x42]))), { code: 'FILE_TYPE_NOT_ALLOWED' });
});

test('chỉ xem trước PDF, ảnh và Word', () => {
  assert.equal(previewable('a.pdf'), 'inline');
  assert.equal(previewable('a.docx'), 'word');
  assert.equal(previewable('a.xlsx'), null);
});
