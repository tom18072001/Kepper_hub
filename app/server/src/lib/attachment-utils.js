const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_DOWNLOAD_NAME_BYTES = 180;

function truncateUtf8(value, maxBytes) {
  let result = '';
  for (const char of value) {
    if (Buffer.byteLength(result + char) > maxBytes) break;
    result += char;
  }
  return result;
}

// ponytail: dấu đã bị thay bằng "_" là mất byte; khôi phục các từ đã quan sát, thêm mẫu khi gặp biến thể cũ mới.
const DAMAGED_VIETNAMESE_WORDS = [
  ['trieÌ_Ì_n', 'triển'], ['chuyeÌ_Ì_n', 'chuyển'], ['nhieÌ£Ì_m', 'nhiệm'],
  ['Ä_oÌ_Ì_i', 'đổi'], ['caÌ_c', 'các'], ['vuÌ£', 'vụ'], ['soÌ_Ì_', 'số'],
];

function repairMultipartFilename(value) {
  let current = String(value || '').normalize('NFC');
  for (let pass = 0; pass < 3; pass++) {
    if (!current || /^[\x00-\x7f]*$/.test(current) || [...current].some(char => char.charCodeAt(0) > 0xff)) break;
    const repaired = Buffer.from([...current].map(char => char.charCodeAt(0))).toString('utf8');
    if (repaired.includes('�') || repaired === current) break;
    current = repaired;
  }
  for (const [damaged, restored] of DAMAGED_VIETNAMESE_WORDS) current = current.replaceAll(damaged, restored);
  return current.normalize('NFC');
}

function downloadName(originalName) {
  let name = path.basename(repairMultipartFilename(originalName || 'minh-chung'))
    .replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, '_')
    .replace(/[. ]+$/g, '') || 'minh-chung';
  const ext = path.extname(name);
  const extBytes = Buffer.byteLength(ext);
  if (Buffer.byteLength(name) > MAX_DOWNLOAD_NAME_BYTES) {
    const keptExt = extBytes < 24 ? ext : '';
    const stem = keptExt ? name.slice(0, -ext.length) : name;
    name = truncateUtf8(stem, MAX_DOWNLOAD_NAME_BYTES - Buffer.byteLength(keptExt)) + keptExt;
  }
  return name || 'minh-chung';
}

function objectKey(folder, originalName, id = randomUUID()) {
  const safeFolder = String(folder || '').split(/[\\/]+/)
    .filter(part => part && part !== '.' && part !== '..')
    .map(part => part.replace(/[^\w.-]+/g, '_').slice(0, 64))
    .filter(Boolean).join('/');
  const ext = path.extname(downloadName(originalName));
  const safeExt = /^\.[a-z0-9]{1,12}$/i.test(ext) ? ext.toLowerCase() : '';
  return (safeFolder ? safeFolder + '/' : '') + id + safeExt;
}

function isStorageNotFound(error) {
  return !!error && (error.statusCode === 404 || ['ENOENT', 'NoSuchKey', 'NoSuchObject', 'NotFound'].includes(error.code));
}

function evidenceWhere(current, versionIds) {
  return { OR: [
    { taskId: current.taskId, periodId: current.periodId },
    ...(versionIds.length ? [{ entrySk: { in: versionIds }, OR: [{ taskId: null }, { periodId: null }] }] : []),
  ] };
}

function previewKind(fileName, mimeType) {
  const mime = String(mimeType || '').trim().toLowerCase();
  const ext = path.extname(downloadName(fileName)).toLowerCase();
  if (mime === 'application/pdf' && ext === '.pdf') return 'pdf';
  if (mime === 'image/png' && ext === '.png' || mime === 'image/jpeg' && ['.jpg', '.jpeg'].includes(ext)) return 'image';
  return ['.doc', '.docx'].includes(ext) ? 'word' : '';
}
function validPreviewSignature(kind, mimeType, buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  const mime = String(mimeType || '').trim().toLowerCase();
  if (kind === 'pdf') return buffer.subarray(0, 5).equals(Buffer.from('%PDF-'));
  if (kind === 'image' && mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (kind === 'image' && mime === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return false;
}
function contentDisposition(type, originalName) {
  const name = downloadName(originalName);
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, '_') || 'minh-chung';
  const encoded = encodeURIComponent(name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function reportExportName(period, unitName, extension, now = new Date()) {
  const month = Number((String(period?.periodKey || '').match(/M(0[1-9]|1[0-2])/) || [])[1]);
  const ext = String(extension || '').replace(/^\./, '').toLowerCase();
  if (!['docx', 'xlsx'].includes(ext)) throw new Error('Tên kỳ hoặc định dạng xuất báo cáo không hợp lệ');
  const clean = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const unit = clean(unitName || 'Tất cả đơn vị') || 'Tat ca don vi';
  const periodLabel = month ? `Thang ${month}` : clean(period?.label || period?.periodKey || 'Bao cao') || 'Bao cao';
  // ponytail: ASCII filenames only; add transliteration map when export policy requires Unicode names.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return downloadName(`NQ57_Bao Cao_${periodLabel}_${unit}_${parts.year}${parts.month}${parts.day}.${ext}`);
}

module.exports = { MAX_DOWNLOAD_NAME_BYTES, repairMultipartFilename, downloadName, objectKey, isStorageNotFound, evidenceWhere, previewKind, validPreviewSignature, contentDisposition, reportExportName };
