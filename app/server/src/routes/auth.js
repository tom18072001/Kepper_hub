// Đăng nhập / tài khoản cá nhân. Giữ nguyên tiêu chí của bản NQ57 (theo yêu cầu chủ dự án).
const bcrypt = require('bcryptjs');
const { issueToken } = require('../lib/auth');
const { accessMap } = require('../lib/permissions');
const { MIN_PASSWORD_LENGTH } = require('../lib/passwords');

function publicUser(user) {
  return {
    id: user.id, username: user.username, fullName: user.fullName, displayTitle: user.displayTitle, email: user.email,
    role: user.role, departmentId: user.departmentId, departmentName: user.department ? user.department.name : null,
    isRootAdmin: user.isRootAdmin, mustChangePw: user.mustChangePw, permissions: accessMap(user),
  };
}

// Ghi nhật ký đăng nhập không thành công (chỉ ghi nhận, không đổi thông báo / mã trạng thái / tiêu chí khoá).
// Tên đăng nhập chỉ ghi khi tài khoản có thật; chuỗi không khớp tài khoản nào (có thể là mật khẩu gõ nhầm ô) không lưu.
function failedLogin(name, u) {
  const reason = !u ? 'NOT_FOUND' : !u.isActive ? 'INACTIVE' : 'WRONG_PASSWORD';
  return { entityId: u ? u.id : null, value: { username: u ? u.username : '(không có tài khoản này)', reason } };
}

module.exports = function mountAuth(app, { prisma, config, auth, audit }) {
  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body || {};
    const u = await prisma.user.findUnique({ where: { username: String(username || '').trim().toLowerCase() }, include: { department: true, permissions: true } });
    // So khớp bất đồng bộ (không chặn máy chủ khi nhiều người đăng nhập cùng lúc); tiêu chí đăng nhập giữ nguyên.
    if (!u || !u.isActive || !(await bcrypt.compare(String(password || ''), u.passwordHash))) {
      if (audit) { const f = failedLogin(String(username || '').trim().toLowerCase(), u); await audit(req, 'LOGIN_FAILED', 'Auth', f.entityId, null, f.value); }
      return res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không đúng' });
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } }),
      prisma.auditLog.create({ data: { userId: u.id, action: 'LOGIN', entity: 'User', entityId: String(u.id), ip: req.ip } }),
    ]);
    res.json({ token: issueToken(u, config.jwtSecret), user: publicUser(u) });
  });

  app.get('/api/me', auth, async (req, res) => {
    const u = await prisma.user.findUnique({ where: { id: req.user.id }, include: { department: true, permissions: true } });
    res.json(publicUser(u));
  });

  app.post('/api/me/password', auth, async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || ''), newPassword = String(req.body?.newPassword || '');
    if (!(await bcrypt.compare(currentPassword, req.user.passwordHash))) return res.status(422).json({ error: 'Mật khẩu hiện tại không đúng' });
    if (newPassword.length < MIN_PASSWORD_LENGTH || !newPassword.trim()) return res.status(422).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự và không chỉ gồm khoảng trắng' });
    if (await bcrypt.compare(newPassword, req.user.passwordHash)) return res.status(422).json({ error: 'Mật khẩu mới phải khác mật khẩu hiện tại' });
    const updated = await prisma.$transaction(async tx => {
      const user = await tx.user.update({ where: { id: req.user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10), mustChangePw: false, sessionVersion: { increment: 1 } } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'PASSWORD_CHANGE', entity: 'User', entityId: String(user.id), ip: req.ip } });
      return user;
    });
    res.json({ token: issueToken(updated, config.jwtSecret) });
  });
};
module.exports.publicUser = publicUser;
module.exports.failedLogin = failedLogin;
