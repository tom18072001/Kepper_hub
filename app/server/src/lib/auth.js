const jwt = require('jsonwebtoken');

const PASSWORD_ROUTES = new Set(['GET /api/me', 'POST /api/me/password']);

function issueToken(user, secret) {
  return jwt.sign({ id: user.id, sessionVersion: user.sessionVersion || 0 }, secret, { expiresIn: '12h' });
}

function createAuth(prisma, secret) {
  return async function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
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
