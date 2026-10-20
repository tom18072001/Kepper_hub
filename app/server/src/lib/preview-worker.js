const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { convertWord, streamToBuffer, constants } = require('./document-preview');

const PORT = Number(process.env.PREVIEW_PORT || 4100);
const TOKEN = String(process.env.PREVIEW_TOKEN || '');
if (TOKEN.length < 32) throw new Error('PREVIEW_TOKEN phải có ít nhất 32 ký tự');

function authorized(value) {
  const expected = Buffer.from(`Bearer ${TOKEN}`), actual = Buffer.from(String(value || ''));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function statusOf(error) {
  if (error.code === 'PREVIEW_INVALID_INPUT' || error.code === 'PREVIEW_UNSUPPORTED') return 415;
  if (error.code === 'PREVIEW_QUEUE_FULL') return 429;
  if (error.code === 'PREVIEW_TIMEOUT') return 504;
  if (error.code === 'PREVIEW_UNAVAILABLE') return 503;
  return 422;
}
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://office-preview');
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
  if (req.method !== 'POST' || url.pathname !== '/convert') return json(res, 404, { error: 'Không tìm thấy' });
  if (!authorized(req.headers.authorization)) return json(res, 401, { error: 'Không được phép' });
  if (Number(req.headers['content-length'] || 0) > constants.MAX_INPUT_BYTES) return json(res, 413, { error: 'Tệp vượt giới hạn', code: 'PREVIEW_INVALID_INPUT' });
  try {
    const source = await streamToBuffer(req), pdf = await convertWord(url.searchParams.get('name') || 'document.docx', source);
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(pdf);
  } catch (error) { json(res, statusOf(error), { error: error.message, code: error.code }); }
});
server.requestTimeout = constants.TIMEOUT_MS + 5_000;
server.headersTimeout = 10_000;
server.listen(PORT, '0.0.0.0', () => console.log(`office-preview listening on ${PORT}`));
