const jwt = require('jsonwebtoken');
const T = require('./tokens');
const { isItAdmin } = require('./permissions');

const PASSWORD_ROUTES = new Set(['GET /api/me', 'POST /api/me/password']);

function issueToken(user, secret) {
  return jwt.sign({ id: user.id, sessionVersion: user.sessionVersion || 0 }, secret, { expiresIn: '12h' });
}

function createAuth(prisma, secret) {
  return async function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
    // Token cá nhân cho Claude (MCP): cùng danh tính + quyền của người tạo; phạm vi theo lib/tokens.js.
    if (T.isToken(token)) {
      try {
        const row = await prisma.apiToken.findUnique({ where: { hash: T.sha256(token) }, include: { user: { include: { permissions: true } } } });
        const now = new Date();
        if (!row || row.revokedAt || row.expiresAt < now || !row.user?.isActive || row.sessionVersion !== Number(row.user.sessionVersion || 0))
          return res.status(401).json({ error: 'Kết nối Claude không hợp lệ, đã hết hạn hoặc đã thu hồi — kết nối lại ở trang "Kết nối Claude" của Kepper', code: 'TOKEN_INVALID' });
        if (row.user.mustChangePw) return res.status(403).json({ error: 'Tài khoản phải đổi mật khẩu trên giao diện trước', code: 'PASSWORD_CHANGE_REQUIRED' });
        // Tài khoản đã chuyển sang quản trị IT sau khi tạo token: token không dùng được (IT không truy cập dữ liệu nghiệp vụ).
        if (isItAdmin(row.user)) return res.status(403).json({ error: 'Tài khoản quản trị hệ thống không dùng token Claude', code: 'NOT_VIA_AI' });
        const denied = T.tokenDenied(req.method, req.originalUrl.split('?')[0], row.scopes);
        if (denied) return res.status(403).json({ error: denied, code: 'NOT_VIA_AI' });
        req.user = row.user; req.via = 'mcp'; req.tokenId = row.id;
        if (!row.lastUsedAt || now - row.lastUsedAt > 60_000) prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: now, lastIp: req.ip || null } }).catch(() => {});
        return next();
      } catch { return res.status(401).json({ error: 'Token Claude không hợp lệ', code: 'TOKEN_INVALID' }); }
    }
    try {
      const payload = jwt.verify(token, secret);
      const user = await prisma.user.findUnique({ where: { id: payload.id }, include: { permissions: true } });
      if (!user || !user.isActive) return res.status(401).json({ error: 'Tài khoản không tồn tại hoặc đã bị khóa' });
      if (!Number.isInteger(payload.sessionVersion) || payload.sessionVersion !== Number(user.sessionVersion || 0)) return res.status(401).json({ error: 'Phiên đăng nhập đã bị thu hồi' });
      req.user = user;
      if (user.mustChangePw && !PASSWORD_ROUTES.has(req.method + ' ' + req.path))
        return res.status(403).json({ error: 'Tài khoản phải đổi mật khẩu trước khi tiếp tục', code: 'PASSWORD_CHANGE_REQUIRED' });
      next();
    } catch { return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ' }); }
  };
}

module.exports = { PASSWORD_ROUTES, issueToken, createAuth };
