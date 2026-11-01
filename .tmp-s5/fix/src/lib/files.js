// Allowlist tệp đính kèm: chỉ nhận đuôi cho phép, kiểm tra chữ ký tệp, MIME do server quyết định.
const path = require('node:path');
const fs = require('node:fs/promises');

const ZIP = Buffer.from('504b0304', 'hex');
const OLE = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const TYPES = {
  '.pdf': { mime: 'application/pdf', magic: [Buffer.from('%PDF-')] },
  '.png': { mime: 'image/png', magic: [Buffer.from('89504e470d0a1a0a', 'hex')] },
  '.jpg': { mime: 'image/jpeg', magic: [Buffer.from('ffd8ff', 'hex')] },
  '.jpeg': { mime: 'image/jpeg', magic: [Buffer.from('ffd8ff', 'hex')] },
  '.gif': { mime: 'image/gif', magic: [Buffer.from('GIF87a'), Buffer.from('GIF89a')] },
  '.webp': { mime: 'image/webp', magic: [Buffer.from('RIFF')] },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: [ZIP] },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: [ZIP] },
  '.pptx': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: [ZIP] },
  '.zip': { mime: 'application/zip', magic: [ZIP] },
  '.doc': { mime: 'application/msword', magic: [OLE] },
  '.xls': { mime: 'application/vnd.ms-excel', magic: [OLE] },
  '.ppt': { mime: 'application/vnd.ms-powerpoint', magic: [OLE] },
  '.txt': { mime: 'text/plain; charset=utf-8', text: true },
  '.csv': { mime: 'text/csv; charset=utf-8', text: true },
};
const ALLOWED_EXTENSIONS = Object.keys(TYPES);

function fileError(message) { const e = new Error(message); e.status = 415; e.code = 'FILE_TYPE_NOT_ALLOWED'; return e; }

function typeOf(fileName) { return TYPES[path.extname(String(fileName || '')).toLowerCase()] || null; }

async function readHead(filePath, bytes = 16) {
  const handle = await fs.open(filePath, 'r');
  try { const buf = Buffer.alloc(bytes); const { bytesRead } = await handle.read(buf, 0, bytes, 0); return buf.subarray(0, bytesRead); }
  finally { await handle.close(); }
}

// Trả về MIME chuẩn của server; ném lỗi 415 nếu đuôi không cho phép hoặc nội dung không khớp.
async function verifyUpload(fileName, filePath) {
  const type = typeOf(fileName);
  if (!type) throw fileError('Loại tệp không được phép. Cho phép: ' + ALLOWED_EXTENSIONS.join(', '));
  const head = await readHead(filePath);
  if (type.text) {
    if (head.includes(0)) throw fileError('Tệp văn bản chứa dữ liệu nhị phân');
  } else if (!type.magic.some(m => head.length >= m.length && head.subarray(0, m.length).equals(m))) {
    throw fileError('Nội dung tệp không khớp với đuôi tệp');
  }
  return type.mime;
}
function previewable(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return 'inline';
  if (['.doc', '.docx'].includes(ext)) return 'word';
  return null;
}

module.exports = { ALLOWED_EXTENSIONS, typeOf, verifyUpload, previewable };
