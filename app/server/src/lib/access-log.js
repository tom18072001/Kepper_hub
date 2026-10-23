// Nhật ký truy cập hệ thống (CLAUDE.md: nhật ký hệ thống truy xuất được ≥ 12 tháng).
// Mỗi request API một dòng JSON: thời điểm, tài khoản, phương thức, đường dẫn (không query, không body), mã trả về, thời gian xử lý, IP.
// Ghi ra ACCESS_LOG_DIR/access-YYYY-MM-DD.jsonl (giờ VN) nếu có thư mục (mount ra máy chủ, ngoài vòng đời container); luôn ghi stdout.
// Không ghi nội dung nghiệp vụ / tham số tìm kiếm → không lộ dữ liệu Bảo mật qua log.
const fs = require('node:fs');
const path = require('node:path');

const KEEP_DAYS = 400; // > 12 tháng
const H7 = 7 * 3_600_000;
const dayOf = d => new Date(d.getTime() + H7).toISOString().slice(0, 10);

function createAccessLog({ dir = process.env.ACCESS_LOG_DIR, out = process.stdout } = {}) {
  let day = null, stream = null, disabled = !dir;
  const fileStream = now => {
    if (disabled) return null;
    const d = dayOf(now);
    if (d !== day) {
      try { stream?.end(); fs.mkdirSync(dir, { recursive: true }); stream = fs.createWriteStream(path.join(dir, `access-${d}.jsonl`), { flags: 'a' }); day = d; stream.on('error', () => { disabled = true; }); }
      catch (error) { disabled = true; out.write(JSON.stringify({ level: 'warn', msg: 'access_log_disabled', error: error.message }) + '\n'); return null; }
    }
    return stream;
  };
  function middleware(req, res, next) {
    if (req.path === '/stream' || req.path === '/health') return next();
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      const now = new Date();
      const line = JSON.stringify({ ts: now.toISOString(), level: 'info', msg: 'http', uid: req.user?.id ?? null, method: req.method,
        path: req.originalUrl.split('?')[0].slice(0, 200), status: res.statusCode, ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10, ip: req.ip }) + '\n';
      out.write(line);
      fileStream(now)?.write(line);
    });
    next();
  }
  return { middleware, close: () => stream?.end() };
}

// Xoá tệp nhật ký truy cập cũ hơn KEEP_DAYS ngày.
function purgeAccessLogs({ dir = process.env.ACCESS_LOG_DIR, now = new Date(), keepDays = KEEP_DAYS } = {}) {
  if (!dir || !fs.existsSync(dir)) return 0;
  const cutoff = dayOf(new Date(now.getTime() - keepDays * 86_400_000));
  let n = 0;
  for (const f of fs.readdirSync(dir)) { const m = /^access-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f); if (m && m[1] < cutoff) { fs.rmSync(path.join(dir, f), { force: true }); n++; } }
  return n;
}

module.exports = { createAccessLog, purgeAccessLogs, KEEP_DAYS };
