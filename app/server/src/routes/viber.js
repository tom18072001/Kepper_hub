// Liên kết Viber (đề xuất, mặc định TẮT). Người dùng tự chọn liên kết và đồng ý; huỷ liên kết bất cứ lúc nào.
const express = require('express');
const { fail } = require('../lib/http');
const V = require('../services/viber');

module.exports = function mountViber(app, { prisma, auth, audit }) {
  app.get('/api/me/viber', auth, async (req, res) => {
    const link = await prisma.viberLink.findUnique({ where: { userId: req.user.id } });
    res.json({ enabled: V.enabled(), botName: process.env.VIBER_BOT_NAME || 'Kepper Hub', linked: !!link?.viberId, linkedAt: link?.linkedAt || null, consentAt: link?.consentAt || null,
      pendingCode: link?.code && link.codeExpiresAt > new Date() ? link.code : null, codeExpiresAt: link?.codeExpiresAt || null });
  });
  // Lấy mã liên kết (hết hạn sau 15 phút). Bắt buộc tick đồng ý (gửi thông báo qua Viber — máy chủ ở nước ngoài).
  app.post('/api/me/viber/code', auth, async (req, res) => {
    if (!V.enabled()) fail(409, 'Thông báo qua Viber chưa được bật trên hệ thống', 'VIBER_DISABLED');
    if (req.body?.consent !== true) fail(422, 'Cần đồng ý nhận thông báo qua Viber', 'CONSENT_REQUIRED');
    const code = V.newCode(), codeExpiresAt = new Date(Date.now() + 15 * 60_000), consentAt = new Date();
    await prisma.viberLink.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id, code, codeExpiresAt, consentAt }, update: { code, codeExpiresAt, consentAt } });
    await audit(req, 'VIBER_CONSENT', 'User', req.user.id, null, { consentAt });
    res.json({ code, codeExpiresAt });
  });
  app.delete('/api/me/viber', auth, async (req, res) => {
    await prisma.viberLink.deleteMany({ where: { userId: req.user.id } });
    await audit(req, 'VIBER_UNLINK', 'User', req.user.id, null, null);
    res.json({ ok: true });
  });
  // Webhook của bot: kiểm chữ ký; tin nhắn là mã 6 số → gắn Viber ID cho tài khoản đã xin mã; huỷ đăng ký → gỡ liên kết.
  app.post('/api/viber/webhook', express.raw({ type: '*/*', limit: '100kb' }), async (req, res) => {
    if (!V.enabled()) return res.status(404).json({ error: 'Không tìm thấy API', code: 'NOT_FOUND' });
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    if (!V.validSignature(raw, req.get('X-Viber-Content-Signature'))) return res.status(401).json({ error: 'Sai chữ ký', code: 'BAD_SIGNATURE' });
    let ev; try { ev = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'JSON không hợp lệ' }); }
    const viberId = ev.sender?.id || ev.user?.id || ev.user_id;
    if (ev.event === 'unsubscribed' && viberId) await prisma.viberLink.updateMany({ where: { viberId }, data: { viberId: null, linkedAt: null } });
    if (ev.event === 'message' && viberId) {
      const code = String(ev.message?.text || '').trim();
      const link = /^\d{6}$/.test(code) ? await prisma.viberLink.findFirst({ where: { code, codeExpiresAt: { gt: new Date() } } }) : null;
      if (link) {
        await prisma.$transaction([prisma.viberLink.updateMany({ where: { viberId, NOT: { id: link.id } }, data: { viberId: null, linkedAt: null } }),
          prisma.viberLink.update({ where: { id: link.id }, data: { viberId, linkedAt: new Date(), code: null, codeExpiresAt: null } })]);
        await V.sendText(viberId, 'Đã liên kết tài khoản Kepper Hub. Bạn sẽ nhận nhắc việc tiến độ tại đây. Huỷ trong "Tài khoản của tôi".').catch(() => {});
      } else await V.sendText(viberId, 'Gửi mã 6 số lấy trong Kepper Hub (Tài khoản của tôi → Viber) để liên kết.').catch(() => {});
    }
    res.json({ ok: true });
  });
};
