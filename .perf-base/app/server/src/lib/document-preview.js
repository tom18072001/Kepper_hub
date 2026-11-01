const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');

const DOCX_MAGIC = Buffer.from('504b0304', 'hex');
const DOC_MAGIC = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const PDF_MAGIC = Buffer.from('%PDF-');
function envLimit(name, fallback, min, max) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}
const MAX_INPUT_BYTES = envLimit('PREVIEW_MAX_INPUT_BYTES', 25 * 1024 * 1024, 1024, 25 * 1024 * 1024);
const MAX_OUTPUT_BYTES = envLimit('PREVIEW_MAX_OUTPUT_BYTES', 50 * 1024 * 1024, 1024, 100 * 1024 * 1024);
const TIMEOUT_MS = envLimit('PREVIEW_TIMEOUT_MS', 60_000, 1000, 5 * 60_000);
const MAX_QUEUE = envLimit('PREVIEW_MAX_QUEUE', 4, 0, 100);
let active = 0;
const waiters = [];

function previewError(code, message) { const error = new Error(message); error.code = code; return error; }
function hasMagic(buffer, magic) { return buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic); }
function validateWordInput(fileName, buffer) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (!['.doc', '.docx'].includes(ext)) throw previewError('PREVIEW_UNSUPPORTED', 'Định dạng tệp không hỗ trợ xem trước');
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_INPUT_BYTES) throw previewError('PREVIEW_INVALID_INPUT', 'Tệp Word rỗng hoặc vượt giới hạn');
  let validDocx = false;
  if (ext === '.docx' && hasMagic(buffer, DOCX_MAGIC)) {
    try {
      const PizZip = require('pizzip'), zip = new PizZip(buffer);
      const names = Object.keys(zip.files);
      let expandedBytes = 0;
      validDocx = names.length <= 5000;
      for (const name of names) {
        if (name.startsWith('/') || name.split('/').includes('..')) { validDocx = false; break; }
        const file = zip.file(name), uncompressedSize = file && file._data && file._data.uncompressedSize;
        if (file && (!Number.isFinite(uncompressedSize) || uncompressedSize < 0)) { validDocx = false; break; }
        expandedBytes += uncompressedSize || 0;
        if (expandedBytes > 100 * 1024 * 1024) { validDocx = false; break; }
      }
      validDocx = validDocx && !!zip.file('[Content_Types].xml') && !!zip.file('word/document.xml');
    } catch { validDocx = false; }
  }
  // OLE Compound File header; LibreOffice performs the full WordDocument stream parse.
  const validDoc = hasMagic(buffer, DOC_MAGIC);
  if (ext === '.docx' ? !validDocx : !validDoc) throw previewError('PREVIEW_INVALID_INPUT', 'Nội dung tệp không khớp định dạng Word');
  return ext;
}
function officeBin() {
  return process.env.OFFICE_BIN || (process.platform === 'win32' ? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe' : 'soffice');
}
function killTree(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.unref();
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
  }
}
function runOffice(inputPath, outputDir, profileDir, options = {}) {
  const bin = options.officeBin || officeBin(), timeoutMs = options.timeoutMs || TIMEOUT_MS;
  const args = ['--headless', '--nologo', '--nodefault', '--nolockcheck', '--norestore', `-env:UserInstallation=${pathToFileURL(profileDir).href}`, '--convert-to', 'pdf:writer_pdf_Export', '--outdir', outputDir, inputPath];
  return new Promise((resolve, reject) => {
    let stderr = '', settled = false;
    const child = (options.spawn || spawn)(bin, args, { shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => {
      if (settled) return; settled = true; (options.killTree || killTree)(child); reject(previewError('PREVIEW_TIMEOUT', 'Tạo bản xem trước Word quá thời gian'));
    }, timeoutMs);
    child.stderr && child.stderr.on('data', chunk => { if (stderr.length < 4096) stderr += chunk; });
    child.on('error', error => {
      if (settled) return; settled = true; clearTimeout(timer);
      reject(previewError(error.code === 'ENOENT' ? 'PREVIEW_UNAVAILABLE' : 'PREVIEW_CONVERSION_FAILED', error.code === 'ENOENT' ? 'Chưa cấu hình LibreOffice để xem file Word' : 'Không thể chạy bộ chuyển đổi Word'));
    });
    child.on('close', code => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (code !== 0) return reject(previewError('PREVIEW_CONVERSION_FAILED', `LibreOffice không chuyển đổi được tệp${stderr.trim() ? ': ' + stderr.trim().slice(0, 300) : ''}`));
      resolve();
    });
  });
}
async function convertLocally(fileName, buffer, options = {}) {
  const ext = validateWordInput(fileName, buffer), root = await fs.mkdtemp(path.join(os.tmpdir(), 'nq57-preview-'));
  const inputDir = path.join(root, 'input'), outputDir = path.join(root, 'output'), profileDir = path.join(root, 'profile');
  const stem = randomUUID(), inputPath = path.join(inputDir, stem + ext), outputPath = path.join(outputDir, stem + '.pdf');
  try {
    await Promise.all([fs.mkdir(inputDir), fs.mkdir(outputDir), fs.mkdir(profileDir)]);
    await fs.writeFile(inputPath, buffer, { mode: 0o600 });
    await runOffice(inputPath, outputDir, profileDir, options);
    const stat = await fs.stat(outputPath).catch(() => null);
    if (!stat || !stat.size || stat.size > MAX_OUTPUT_BYTES) throw previewError('PREVIEW_CONVERSION_FAILED', 'LibreOffice không tạo được bản PDF hợp lệ');
    const pdf = await fs.readFile(outputPath);
    if (!hasMagic(pdf, PDF_MAGIC)) throw previewError('PREVIEW_CONVERSION_FAILED', 'Kết quả chuyển đổi không phải PDF');
    return pdf;
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
async function streamToBuffer(stream, limit = MAX_INPUT_BYTES) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) { if (stream.destroy) stream.destroy(); throw previewError('PREVIEW_INVALID_INPUT', 'Tệp Word vượt giới hạn xem trước'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function convertRemote(fileName, buffer) {
  const base = String(process.env.PREVIEW_URL || '').replace(/\/$/, '');
  const token = process.env.PREVIEW_TOKEN;
  if (base && String(token || '').length < 32) throw previewError('PREVIEW_UNAVAILABLE', 'Token bộ chuyển đổi Word không hợp lệ');
  if (!base) return convertLocally(fileName, buffer);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(base + '/convert?name=' + encodeURIComponent(fileName), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: buffer, signal: controller.signal });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw previewError(body.code || 'PREVIEW_CONVERSION_FAILED', body.error || 'Bộ chuyển đổi Word không khả dụng'); }
    const pdf = Buffer.from(await response.arrayBuffer());
    if (pdf.length > MAX_OUTPUT_BYTES || !hasMagic(pdf, PDF_MAGIC)) throw previewError('PREVIEW_CONVERSION_FAILED', 'Bộ chuyển đổi trả dữ liệu không hợp lệ');
    return pdf;
  } catch (error) {
    if (error.name === 'AbortError') throw previewError('PREVIEW_TIMEOUT', 'Tạo bản xem trước Word quá thời gian');
    throw error.code ? error : previewError('PREVIEW_UNAVAILABLE', 'Không kết nối được bộ chuyển đổi Word');
  } finally { clearTimeout(timer); }
}
function acquireSlot() {
  if (!active) { active = 1; return Promise.resolve(); }
  if (waiters.length >= MAX_QUEUE) return Promise.reject(previewError('PREVIEW_QUEUE_FULL', 'Bộ xem Word đang bận, vui lòng thử lại'));
  return new Promise((resolve, reject) => {
    const waiter = { resolve, timer: setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(previewError('PREVIEW_TIMEOUT', 'Chờ bộ xem Word quá thời gian'));
    }, TIMEOUT_MS) };
    waiters.push(waiter);
  });
}
function releaseSlot() {
  const next = waiters.shift();
  if (next) { clearTimeout(next.timer); next.resolve(); } else active = 0;
}
async function convertWord(fileName, input) {
  let buffer;
  try { buffer = Buffer.isBuffer(input) ? input : await streamToBuffer(input); }
  catch (error) { if (input && input.destroy && !input.destroyed) input.destroy(); throw error; }
  validateWordInput(fileName, buffer);
  await acquireSlot();
  try { return await convertRemote(fileName, buffer); }
  finally { releaseSlot(); }
}

module.exports = { convertWord, convertLocally, validateWordInput, runOffice, streamToBuffer, previewError, constants: { MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, TIMEOUT_MS } };
