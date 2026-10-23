// Dựng Express app (tách khỏi server.js để test được).
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { createAuth } = require('./lib/auth');
const { hasPermission, permissionScope } = require('./lib/permissions');
const { HttpError } = require('./lib/http');
const { auditFor } = require('./services/events');
const { createAccessLog } = require('./lib/access-log');

function createApp({ prisma, config }) {
  const app = express();
  app.disable('x-powered-by');
  // Đếm request đang xử lý (server.js dừng êm: chờ các request này xong rồi mới tắt).
  let inflight = 0;
  app.use((req, res, next) => { inflight++; res.once('close', () => { inflight--; }); next(); });
  app.locals.inflight = () => inflight;
  // Đứng sau nginx/reverse proxy: lấy IP thật của người dùng cho audit log.
  app.set('trust proxy', config.trustProxy);
  // Nén phản hồi (danh sách việc của sổ lớn ~3 MB → ~0,2 MB). Kênh realtime (SSE) đặt Cache-Control: no-transform nên không bị nén.
  app.use(compression());

  app.use(helmet({
    contentSecurityPolicy: { useDefaults: true, directives: {
      'default-src': ["'self'"], 'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:'], 'font-src': ["'self'"], 'connect-src': ["'self'"],
      'frame-src': ["'self'", 'blob:'], 'object-src': ["'none'"], 'frame-ancestors': ["'none'"], 'base-uri': ["'self'"], 'form-action': ["'self'"],
      'upgrade-insecure-requests': null,
    } },
    crossOriginEmbedderPolicy: false,
  }));
  // CORS: chỉ các origin khai báo trong APP_ORIGIN (phân tách bằng dấu phẩy).
  app.use('/api', cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new HttpError(403, 'Origin không được phép', 'CORS_FORBIDDEN'));
    },
  }));
  // Giới hạn tần suất chung cho API (không áp lên /api/auth để giữ nguyên tiêu chí đăng nhập).
  // Tính theo tài khoản (nhiều nhân viên văn phòng dùng chung một IP ra Internet); chưa đăng nhập thì theo IP.
  app.use('/api', rateLimit({
    windowMs: 60_000, limit: config.apiRateLimit, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: req => {
      const header = req.headers.authorization || '';
      // Chỉ tin token đã xác minh chữ ký (token giả không đẩy được yêu cầu vào hạn mức của người khác).
      let payload = null;
      try { payload = header.startsWith('Bearer ') ? jwt.verify(header.slice(7), config.jwtSecret) : null; } catch { payload = null; }
      return Number.isInteger(payload?.id) ? 'user:' + payload.id : 'ip:' + ipKeyGenerator(req.ip || '');
    },
    skip: req => req.path.startsWith('/auth/') || req.path === '/stream',
    message: { error: 'Quá nhiều yêu cầu, vui lòng thử lại sau', code: 'RATE_LIMITED' },
  }));
  // Webhook Viber cần body thô để kiểm chữ ký: bỏ qua bộ đọc JSON chung cho đường này.
  // Nhật ký truy cập (≥ 12 tháng, lib/access-log.js). Đặt sau auth không được vì auth gắn theo route → đọc req.user khi 'finish'.
  app.use('/api', (config.accessLog || createAccessLog()).middleware);
  const json = express.json({ limit: '2mb' });
  app.use((req, res, next) => (req.path === '/api/viber/webhook' ? next() : json(req, res, next)));

  const auth = createAuth(prisma, config.jwtSecret);
  const audit = auditFor(prisma);
  const requirePermission = (key, action = 'VIEW', requiredScope = null) => (req, res, next) => {
    const scope = permissionScope(req.user, key, action);
    if (!scope || (requiredScope && scope !== requiredScope)) return res.status(403).json({ error: 'Không đủ quyền', code: 'FORBIDDEN' });
    next();
  };
  const ctx = { prisma, config, auth, audit, requirePermission, hasPermission };

  app.get('/api/health', async (req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });
  for (const mount of [
    require('./routes/auth'), require('./routes/admin'), require('./routes/labels'), require('./routes/projects'), require('./routes/items'), require('./routes/trash'),
    require('./routes/attachments'), require('./routes/approvals'), require('./routes/me'), require('./routes/notes'), require('./routes/dashboard'), require('./routes/kpi'), require('./routes/register'), require('./routes/dispatch'), require('./routes/excel'),
    require('./routes/cycles'), require('./routes/recurring'), require('./routes/views'), require('./routes/reports'), require('./routes/work'), require('./routes/search'),
    require('./routes/mtl'), require('./routes/sprint'), require('./routes/weekly'), require('./routes/viber'), require('./routes/realtime'),
  ]) mount(app, ctx);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API', code: 'NOT_FOUND' }));
  // HTML/JS/CSS luôn kiểm tra lại (ETag) để bản cập nhật hiện ngay; font giữ cache 7 ngày.
  app.use(express.static(config.webDir, { index: 'index.html', setHeaders(res, file) {
    res.setHeader('Cache-Control', /\.woff2$/.test(file) ? 'public, max-age=604800' : 'no-cache');
  } }));

  // Lỗi thống nhất dạng JSON.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    let status = error.status || error.statusCode || 500, code = error.code, message = error.message;
    if (error.name === 'MulterError') { status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400; code = error.code; message = error.code === 'LIMIT_FILE_SIZE' ? 'Tệp vượt 25 MB' : 'Tải tệp không hợp lệ'; }
    else if (error.code === 'P2002') { status = 409; code = 'DUPLICATE'; message = 'Dữ liệu bị trùng: ' + [].concat(error.meta?.target || []).join(', '); }
    else if (error.code === 'P2025') { status = 404; code = 'NOT_FOUND'; message = 'Không tìm thấy dữ liệu'; }
    else if (error.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; message = 'JSON không hợp lệ'; }
    if (status >= 500) {
      console.error(JSON.stringify({ level: 'error', msg: 'request_failed', method: req.method, path: req.path, error: error.message, stack: error.stack }));
      message = 'Lỗi hệ thống, vui lòng thử lại';
    }
    if (res.headersSent) return res.end();
    res.status(status).json({ error: message, code: code || (status >= 500 ? 'INTERNAL' : undefined) });
  });
  return app;
}

function loadConfig(env = process.env) {
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET là bắt buộc');
  // Máy chạy thật: không chấp nhận khoá mẫu trong .env.example (ai đọc repo cũng ký được phiên của mọi tài khoản).
  if (env.NODE_ENV === 'production' && (env.JWT_SECRET.length < 32 || /change|doi-chuoi|example|secret-here/i.test(env.JWT_SECRET)))
    throw new Error('JWT_SECRET còn giá trị mẫu hoặc ngắn hơn 32 ký tự — tạo bằng: openssl rand -hex 32');
  // Mặc định KHÔNG tin X-Forwarded-For (người dùng trong LAN tự đặt được header này để giả IP trong nhật ký).
  // Đứng sau reverse proxy: TRUST_PROXY=1 (đúng một tầng) hoặc IP của proxy.
  const trust = env.TRUST_PROXY ?? 'false';
  return {
    port: Number(env.PORT || 4000),
    jwtSecret: env.JWT_SECRET,
    production: env.NODE_ENV === 'production',
    allowedOrigins: String(env.APP_ORIGIN || 'http://localhost:4000').split(',').map(s => s.trim()).filter(Boolean),
    trustProxy: trust === 'false' ? false : trust === 'true' ? true : /^\d+$/.test(trust) ? Number(trust) : trust,
    apiRateLimit: Number(env.API_RATE_LIMIT || 600),
    webDir: env.WEB_DIR ? path.resolve(env.WEB_DIR) : path.join(__dirname, '..', '..', 'web'),
    uploadTmpDir: env.UPLOAD_TMP_DIR || require('node:os').tmpdir(),
    enableCron: env.ENABLE_CRON !== 'false',
  };
}

module.exports = { createApp, loadConfig };
