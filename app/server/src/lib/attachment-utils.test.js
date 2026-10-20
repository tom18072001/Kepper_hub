const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_DOWNLOAD_NAME_BYTES, repairMultipartFilename, downloadName, objectKey, isStorageNotFound, evidenceWhere, previewKind, validPreviewSignature, contentDisposition, reportExportName } = require('./attachment-utils');

test('multipart filename repair restores raw UTF-8 decoded as Latin-1', () => {
  assert.equal(repairMultipartFilename('BÃ¡o cÃ¡o thÃ¡ng 8.pdf'), 'Báo cáo tháng 8.pdf');
  assert.equal(repairMultipartFilename('BÃÂ¡o cÃÂ¡o thÃÂ¡ng 8.pdf'), 'Báo cáo tháng 8.pdf');
  assert.equal(repairMultipartFilename('Báo cáo tháng 8.pdf'), 'Báo cáo tháng 8.pdf');
  assert.equal(repairMultipartFilename('report.pdf'), 'report.pdf');
  assert.equal(repairMultipartFilename('caf\xE9.pdf'), 'caf\xE9.pdf');
  assert.equal(repairMultipartFilename('BÃ¡o\xFF.pdf'), 'BÃ¡o\xFF.pdf');
});

test('download name repairs legacy mojibake', () => {
  assert.equal(downloadName('BÃ¡o cÃ¡o thÃ¡ng 8.pdf'), 'Báo cáo tháng 8.pdf');
  assert.equal(
    downloadName('2. KH trieÌ_Ì_n khai caÌ_c nhieÌ£Ì_m vuÌ£ chuyeÌ_Ì_n Ä_oÌ_Ì_i soÌ_Ì__dadongdau.pdf'),
    '2. KH triển khai các nhiệm vụ chuyển đổi số_dadongdau.pdf',
  );
  assert.equal(downloadName('Biên bản hợp lệ.pdf'), 'Biên bản hợp lệ.pdf');
  assert.equal(downloadName('du_lieu_goc.pdf'), 'du_lieu_goc.pdf');
  assert.equal(downloadName('KH trieÌ_Ì_n khai.pdf'), 'KH triển khai.pdf');
  assert.equal(downloadName('Ä_oÌ_Ì_i moÌ_Ì_i.pdf'), 'đổi moÌ_Ì_i.pdf');
  // Ký tự "_" đã thay byte UTF-8 trong dữ liệu cũ nên phần ngoài mẫu biết trước không thể suy ngược an toàn.
  assert.equal(downloadName('unknown_Ì_.pdf'), 'unknown_Ì_.pdf');
  const disposition = contentDisposition('attachment', 'BÃ¡o cÃ¡o thÃ¡ng 8.pdf');
  assert.match(disposition, /filename\*=UTF-8''B%C3%A1o%20c%C3%A1o%20th%C3%A1ng%208\.pdf$/);
  assert.equal(disposition.includes('B%C3%83%C2%A1o'), false);
  assert.equal(/[\r\n]/.test(disposition), false);
});

test('download name stays bounded and preserves normal extension', () => {
  const name = downloadName('Báo cáo_' + 'rất-dài-'.repeat(80) + '.pdf');
  assert.ok(Buffer.byteLength(name) <= MAX_DOWNLOAD_NAME_BYTES);
  assert.equal(name.endsWith('.pdf'), true);
});

test('download name removes path and header control characters', () => {
  const name = downloadName('../bao-cao"\r\nInjected.txt');
  assert.equal(name, 'bao-cao___Injected.txt');
  assert.equal(/[\r\n"\\/]/.test(name), false);
});

test('download name handles empty and trailing separator names', () => {
  assert.equal(downloadName(''), 'minh-chung');
  assert.equal(downloadName('...'), 'minh-chung');
  assert.equal(downloadName('report.pdf '), 'report.pdf');
});

test('download name keeps bounded long extension safe', () => {
  const name = downloadName('report.' + 'x'.repeat(200));
  assert.ok(Buffer.byteLength(name) <= MAX_DOWNLOAD_NAME_BYTES);
  assert.equal(name.startsWith('report.'), true);
  assert.equal(name.endsWith('.' + 'x'.repeat(200)), false);
});

test('object key rejects traversal in folder', () => {
  assert.match(objectKey('../outside/..', 'report.pdf', '11111111-1111-4111-8111-111111111111'), /^outside\/[0-9a-f-]{36}\.pdf$/);
});

test('object key does not contain long original name and remains unique', () => {
  const original = 'minh-chứng-' + 'x'.repeat(500) + '.docx';
  const first = objectKey('minh-chung/NV 01', original, '11111111-1111-4111-8111-111111111111');
  const second = objectKey('minh-chung/NV 01', original, '22222222-2222-4222-8222-222222222222');
  assert.match(first, /^minh-chung\/NV_01\/[0-9a-f-]{36}\.docx$/);
  assert.notEqual(first, second);
  assert.ok(Buffer.byteLength(first) < 120);
});

test('only actual missing-object errors become not found', () => {
  assert.equal(isStorageNotFound({ code: 'NoSuchKey' }), true);
  assert.equal(isStorageNotFound({ statusCode: 404 }), true);
  assert.equal(isStorageNotFound({ code: 'AccessDenied', statusCode: 403 }), false);
  assert.equal(isStorageNotFound({ code: 'ECONNREFUSED' }), false);
});

test('completion evidence stays inside exact report period', () => {
  assert.deepEqual(evidenceWhere({ taskId: 9, periodId: 4 }, [12, 13]), { OR: [
    { taskId: 9, periodId: 4 },
    { entrySk: { in: [12, 13] }, OR: [{ taskId: null }, { periodId: null }] },
  ] });
  assert.deepEqual(evidenceWhere({ taskId: 9, periodId: 4 }, []), { OR: [
    { taskId: 9, periodId: 4 },
  ] });
  const where = evidenceWhere({ taskId: 9, periodId: 4 }, [12]);
  assert.equal(where.OR.some(branch => branch.taskId === 9 && branch.periodId !== 4), false);
});

test('preview kind requires safe native extension and allows Word conversion only', () => {
  assert.equal(previewKind('report.pdf', ' application/pdf '), 'pdf');
  assert.equal(previewKind('photo.png', 'image/png'), 'image');
  assert.equal(previewKind('photo.JPEG', 'IMAGE/JPEG'), 'image');
  assert.equal(previewKind('report.bin', 'application/pdf'), '');
  assert.equal(previewKind('page.html', 'image/png'), '');
  assert.equal(previewKind('report.doc', 'application/msword'), 'word');
  assert.equal(previewKind('report.DOCX', 'application/octet-stream'), 'word');
  assert.equal(previewKind('macro.docm', 'application/octet-stream'), '');
  assert.equal(previewKind('attack.svg', 'image/svg+xml'), '');
  assert.equal(previewKind('page.html', 'text/html'), '');
});

test('native preview checks file signatures before inline rendering', () => {
  assert.equal(validPreviewSignature('pdf', 'application/pdf', Buffer.from('%PDF-1.7')), true);
  assert.equal(validPreviewSignature('pdf', 'application/pdf', Buffer.from('<script>')), false);
  assert.equal(validPreviewSignature('image', 'image/png', Buffer.from('89504e470d0a1a0a', 'hex')), true);
  assert.equal(validPreviewSignature('image', 'image/jpeg', Buffer.from('ffd8ffe0', 'hex')), true);
  assert.equal(validPreviewSignature('image', 'image/png', Buffer.from('<svg>')), false);
});

test('content disposition has safe ASCII fallback and UTF-8 name', () => {
  const value = contentDisposition('inline', 'Báo cáo "tháng 8".pdf');
  assert.match(value, /^inline; filename="Bao cao _thang 8_\.pdf"; filename\*=UTF-8''/);
  assert.equal(/[\r\n]/.test(value), false);
});

test('report export name follows month unit and Vietnam export date', () => {
  const period = { periodKey: '2026-M08' }, boundary = new Date('2026-08-05T17:30:00.000Z');
  assert.equal(reportExportName(period, null, 'docx', boundary), 'NQ57_Bao Cao_Thang 8_Tat ca don vi_20260806.docx');
  assert.equal(reportExportName(period, 'Ủy ban Trung ương Mặt trận Tổ quốc Việt Nam', 'xlsx', boundary), 'NQ57_Bao Cao_Thang 8_Uy ban Trung uong Mat tran To quoc Viet Nam_20260806.xlsx');
  const disposition = contentDisposition('attachment', reportExportName(period, 'Đơn vị\r\nX', 'docx', boundary));
  assert.equal(/[\r\n]/.test(disposition), false);
  assert.match(disposition, /NQ57_Bao%20Cao_Thang%208_Don%20vi%20X_20260806\.docx$/);
  assert.equal(
    reportExportName({ periodKey: '2026-YEAR', label: 'Năm 2026' }, null, 'docx', boundary),
    'NQ57_Bao Cao_Nam 2026_Tat ca don vi_20260806.docx'
  );
  assert.equal(
    reportExportName({ periodKey: '2026-ADHOC-01', label: 'Chuyên đề số 1' }, null, 'xlsx', boundary),
    'NQ57_Bao Cao_Chuyen de so 1_Tat ca don vi_20260806.xlsx'
  );
  assert.throws(() => reportExportName(period, null, 'pdf', boundary), /định dạng/);
});
