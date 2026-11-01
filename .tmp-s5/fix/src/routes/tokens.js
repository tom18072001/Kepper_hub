// GĐ3 — token cá nhân cho Claude (MCP trên máy người dùng). Xem lib/tokens.js.
// Người dùng tự tạo / thu hồi token của mình (chỉ qua phiên đăng nhập giao diện, không qua token).
// Quản trị IT xem siêu dữ liệu (tên, chủ, hạn, lần dùng) và thu hồi — không thấy token, không thấy nội dung nghiệp vụ.
const { fail, intParam, text } = require('../lib/http');
const { isItAdmin } = require('../lib/permissions');
const T = require('../lib/tokens');
const { notify } = require('../services/events');
const crypto = require('node:crypto');

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

  // ---------- Kết nối nhanh (không phải tạo / dán token) ----------
  // Tiện ích Claude trên máy người dùng xin kết nối → mở trình duyệt tới Kepper → người dùng (đã đăng nhập) bấm "Cho phép"
  // → Kepper tạo token cho chính người đó và trao cho tiện ích MỘT lần. Giống cách đăng nhập thiết bị (device flow).
  // Chống lừa bấm hộ: chỉ cho phép khi trình duyệt bấm "Cho phép" cùng địa chỉ IP với máy xin kết nối (cùng một máy).
  // Yêu cầu chờ chỉ giữ trong bộ nhớ 10 phút; token chỉ ở bộ nhớ tới khi tiện ích lấy (một lần) rồi xoá.
  const CONNECT_TTL = 10 * 60_000, ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pending = new Map(); // userCode -> { deviceHash, device, ip, createdAt, status, token?, userId? }
  const sameMachine = (a, b) => {
    const n = ip => String(ip || '').replace(/^::ffff:/, '');
    const loop = ip => ['127.0.0.1', '::1'].includes(n(ip));
    return n(a) === n(b) || (loop(a) && loop(b));
  };
  const sweep = () => { const now = Date.now(); for (const [k, v] of pending) if (now - v.createdAt > CONNECT_TTL) pending.delete(k); };
  const userCode = () => { const b = crypto.randomBytes(8); let c = ''; for (let i = 0; i < 8; i++) c += ALPHA[b[i] % ALPHA.length]; return c.slice(0, 4) + '-' + c.slice(4); };
  const pendingOf = code => { sweep(); const p = pending.get(String(code || '').toUpperCase()); if (!p) fail(404, 'Yêu cầu kết nối không còn (quá 10 phút) — hỏi lại Claude để tạo yêu cầu mới', 'NOT_FOUND'); return p; };

  app.post('/api/claude/connect/start', async (req, res) => {
    sweep();
    const ip = req.ip;
    if (pending.size >= 200 || [...pending.values()].filter(p => p.ip === ip).length >= 5) fail(429, 'Quá nhiều yêu cầu kết nối đang chờ — thử lại sau ít phút', 'RATE_LIMITED');
    const device = String(req.body?.device || 'Claude Desktop').replace(/[^\p{L}\p{N} ._()-]/gu, '').trim().slice(0, 40) || 'Claude Desktop';
    const deviceCode = crypto.randomBytes(32).toString('base64url');
    let code = userCode(); while (pending.has(code)) code = userCode();
    pending.set(code, { deviceHash: T.sha256(deviceCode), device, ip, createdAt: Date.now(), status: 'pending' });
    res.status(201).json({ deviceCode, userCode: code, verifyPath: `/#/claude?connect=${code}`, interval: 3, expiresIn: CONNECT_TTL / 1000 });
  });
  app.post('/api/claude/connect/poll', async (req, res) => {
    sweep();
    const hash = T.sha256(String(req.body?.deviceCode || ''));
    const entry = [...pending.entries()].find(([, p]) => p.deviceHash === hash);
    if (!entry) return res.status(410).json({ status: 'expired', error: 'Yêu cầu kết nối đã hết hạn', code: 'EXPIRED' });
    const [code, p] = entry;
    if (p.status === 'pending') return res.status(202).json({ status: 'pending' });
    pending.delete(code);
    if (p.status === 'denied') return res.status(403).json({ status: 'denied', error: 'Người dùng đã từ chối kết nối', code: 'DENIED' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'approved', token: p.token, user: p.user });
  });
  app.get('/api/claude/connect/:code', auth, async (req, res) => {
    if (req.via) fail(403, 'Chỉ xác nhận trên giao diện Kepper', 'NOT_VIA_AI');
    const p = pendingOf(req.params.code);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ code: String(req.params.code).toUpperCase(), device: p.device, status: p.status, createdAt: new Date(p.createdAt), sameMachine: sameMachine(p.ip, req.ip) });
  });
  app.post('/api/claude/connect/:code/:decision', auth, async (req, res) => {
    if (req.via) fail(403, 'Chỉ xác nhận trên giao diện Kepper', 'NOT_VIA_AI');
    if (!['approve', 'deny'].includes(req.params.decision)) fail(404, 'Không tìm thấy API', 'NOT_FOUND');
    const code = String(req.params.code).toUpperCase(), p = pendingOf(code);
    if (p.status !== 'pending') fail(409, 'Yêu cầu này đã được xử lý', 'DONE');
    if (req.params.decision === 'deny') { p.status = 'denied'; await audit(req, 'TOKEN_CONNECT_DENY', 'ApiToken', null, null, { device: p.device }); return res.json({ ok: true }); }
    if (isItAdmin(req.user)) fail(403, 'Tài khoản quản trị hệ thống không dùng Claude để truy cập dữ liệu nghiệp vụ', 'FORBIDDEN');
    if (!sameMachine(p.ip, req.ip)) fail(403, 'Chỉ bấm "Cho phép" trên chính máy đang chạy Claude Desktop (yêu cầu này đến từ máy khác)', 'OTHER_MACHINE');
    const scopes = req.body?.scope === 'read' ? ['read'] : ['read', 'write'];
    const name = `Claude Desktop — ${p.device}`.slice(0, 60);
    const token = T.newToken();
    const row = await prisma.$transaction(async tx => {
      // Kết nối lại cùng máy: thu hồi token cũ của máy đó (không dồn token, không vượt giới hạn 5).
      await tx.apiToken.updateMany({ where: { userId: req.user.id, name, revokedAt: null }, data: { revokedAt: new Date() } });
      if ((await tx.apiToken.count({ where: { userId: req.user.id, revokedAt: null, expiresAt: { gt: new Date() } } })) >= 5) fail(409, 'Mỗi người tối đa 5 máy / token còn hiệu lực — thu hồi bớt ở danh sách bên dưới', 'TOO_MANY');
      return tx.apiToken.create({ data: { userId: req.user.id, name, prefix: token.slice(0, 12), hash: T.sha256(token), scopes,
        expiresAt: new Date(Date.now() + 30 * 86_400_000), sessionVersion: Number(req.user.sessionVersion || 0) } });
    });
    Object.assign(p, { status: 'approved', token, user: { fullName: req.user.fullName } });
    await audit(req, 'TOKEN_CREATE', 'ApiToken', row.id, null, { name, scopes, days: 30, via: 'connect' });
    res.json({ ok: true, name });
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
