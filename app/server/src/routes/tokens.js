// GĐ3 — token cá nhân cho Claude (MCP trên máy người dùng). Xem lib/tokens.js.
// Người dùng tự tạo / thu hồi token của mình (chỉ qua phiên đăng nhập giao diện, không qua token).
// Quản trị IT xem siêu dữ liệu (tên, chủ, hạn, lần dùng) và thu hồi — không thấy token, không thấy nội dung nghiệp vụ.
const { fail, intParam, text } = require('../lib/http');
const { isItAdmin } = require('../lib/permissions');
const T = require('../lib/tokens');
const { notify } = require('../services/events');

const out = t => ({ id: t.id, name: t.name, prefix: t.prefix, scopes: t.scopes, expiresAt: t.expiresAt, lastUsedAt: t.lastUsedAt, revokedAt: t.revokedAt, createdAt: t.createdAt,
  active: !t.revokedAt && t.expiresAt > new Date() });

module.exports = function mountTokens(app, { prisma, auth, audit, requirePermission }) {
  app.get('/api/me/tokens', auth, async (req, res) => {
    const rows = await prisma.apiToken.findMany({ where: { userId: req.user.id }, orderBy: { id: 'desc' }, take: 50 });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(rows.map(out));
  });
  app.post('/api/me/tokens', auth, async (req, res) => {
    if (req.via) fail(403, 'Token chỉ tạo trên giao diện Kepper', 'NOT_VIA_AI');
    if (isItAdmin(req.user)) fail(403, 'Tài khoản quản trị hệ thống không dùng Claude để truy cập dữ liệu nghiệp vụ', 'FORBIDDEN');
    const name = text(req.body?.name, 'Tên', { required: true, max: 60 });
    const scopes = (Array.isArray(req.body?.scopes) ? req.body.scopes : ['read']).filter(x => T.SCOPES.includes(x));
    if (!scopes.includes('read')) scopes.unshift('read');
    const days = Math.min(T.MAX_DAYS, Math.max(1, Number(req.body?.days) || 30));
    if ((await prisma.apiToken.count({ where: { userId: req.user.id, revokedAt: null, expiresAt: { gt: new Date() } } })) >= 5) fail(409, 'Mỗi người tối đa 5 token còn hiệu lực — thu hồi token cũ trước', 'TOO_MANY');
    const token = T.newToken();
    const row = await prisma.apiToken.create({ data: { userId: req.user.id, name, prefix: token.slice(0, 12), hash: T.sha256(token), scopes,
      expiresAt: new Date(Date.now() + days * 86_400_000), sessionVersion: Number(req.user.sessionVersion || 0) } });
    await audit(req, 'TOKEN_CREATE', 'ApiToken', row.id, null, { name, scopes, days });
    res.status(201).json({ ...out(row), token }); // hiện MỘT lần
  });
  app.delete('/api/me/tokens/:id', auth, async (req, res) => {
    const row = await prisma.apiToken.findFirst({ where: { id: intParam(req.params.id), userId: req.user.id } });
    if (!row) fail(404, 'Không tìm thấy token', 'NOT_FOUND');
    if (!row.revokedAt) await prisma.apiToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await audit(req, 'TOKEN_REVOKE', 'ApiToken', row.id, null, { name: row.name });
    res.status(204).end();
  });

  // Quản trị: danh sách token (siêu dữ liệu) và thu hồi.
  app.get('/api/admin/tokens', auth, requirePermission('admin.users', 'VIEW', 'SYSTEM'), async (req, res) => {
    const rows = await prisma.apiToken.findMany({ orderBy: { id: 'desc' }, take: 500, include: { user: { select: { id: true, username: true, fullName: true } } } });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(rows.map(t => ({ ...out(t), user: t.user, lastIp: t.lastIp })));
  });
  app.post('/api/admin/tokens/:id/revoke', auth, requirePermission('admin.users', 'OPERATE', 'SYSTEM'), async (req, res) => {
    const row = await prisma.apiToken.findUnique({ where: { id: intParam(req.params.id) } });
    if (!row) fail(404, 'Không tìm thấy token', 'NOT_FOUND');
    if (!row.revokedAt) await prisma.apiToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await audit(req, 'TOKEN_REVOKE', 'ApiToken', row.id, null, { name: row.name, byAdmin: true });
    await notify(prisma, [row.userId], { type: 'TOKEN_REVOKED', title: `Quản trị đã thu hồi token Claude "${row.name}"`, body: 'Tạo token mới trong "Kết nối Claude" nếu vẫn cần dùng.', link: '#/claude' });
    res.json({ ok: true });
  });
};
