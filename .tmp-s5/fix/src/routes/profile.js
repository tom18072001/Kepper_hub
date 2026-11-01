// Thông tin cá nhân: xem thông tin tài khoản của mình, đổi ảnh đại diện, xem mình trong cây tổ chức (ai ở trên, ai ở dưới).
// Họ tên, chức danh, bộ phận, vai trò do quản trị cấp khi tạo tài khoản — ở đây chỉ xem (không đổi luồng cấp quyền).
// Ảnh đại diện: tuỳ chọn, chính người dùng tải lên / xoá; ảnh đã thu nhỏ ≤ 512 px ở trình duyệt, máy chủ kiểm chữ ký tệp.
// Đường dẫn ảnh là mã ngẫu nhiên (uuid) chỉ trả cho người đã đăng nhập — <img> không gửi được token nên ảnh phục vụ không qua auth.
const { fail } = require('../lib/http');
const storage = require('../lib/storage');
const { ROLES, isItAdmin } = require('../lib/permissions');

const ACTIVE = { isActive: true, isRootAdmin: false, role: { not: 'admin' } };
const AVATAR_RE = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;
const MAX_AVATAR = 400 * 1024;
const avatarUrl = u => (u?.avatarFile ? '/' + u.avatarFile : null);
const RANK = { director: 0, manager: 1, deputy: 2, member: 3 };

// Nhận diện ảnh theo chữ ký tệp (không tin phần mở rộng / mime trình duyệt gửi).
function imageKind(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// Cây tổ chức của một người: các tầng phía trên (Ban GĐ → Phó GĐ phụ trách → lãnh đạo bộ phận cấp trên → lãnh đạo bộ phận),
// đồng cấp trong bộ phận, phía dưới (lãnh đạo: người trong bộ phận + lãnh đạo bộ phận con; Ban GĐ: lãnh đạo các bộ phận phụ trách).
function orgOf(me, users, depts) {
  const person = u => ({ id: u.id, fullName: u.fullName, displayTitle: u.displayTitle, role: u.role, roleLabel: ROLES[u.role]?.label || u.role,
    department: depts.get(u.departmentId)?.name || null, avatarUrl: avatarUrl(u) });
  const inDept = (id, roles) => users.filter(u => u.departmentId === id && roles.includes(u.role) && u.id !== me.id);
  const above = [], seen = new Set([me.id]);
  const push = (label, list) => { const l = list.filter(u => !seen.has(u.id)); l.forEach(u => seen.add(u.id)); if (l.length) above.unshift({ label, people: l.map(person) }); };
  const dept = depts.get(me.departmentId);
  const rank = RANK[me.role] ?? 3;
  if (dept && rank >= 2) push(`Lãnh đạo ${dept.name}`, inDept(dept.id, rank === 3 ? ['manager', 'deputy'] : ['manager']));
  // Bộ phận cấp trên (cây phòng ban), rồi Phó GĐ phụ trách, rồi Ban GĐ.
  let d = dept, guard = 0, supervisor = null;
  while (d && guard++ < 10) {
    supervisor = supervisor ?? d.supervisorId;
    const parent = d.parentId ? depts.get(d.parentId) : null;
    if (parent) push(`Lãnh đạo ${parent.name}`, inDept(parent.id, ['manager']));
    d = parent;
  }
  if (rank >= 1 && supervisor) push('Phó Giám đốc phụ trách', users.filter(u => u.id === supervisor));
  if (rank >= 1) push('Ban Giám đốc', users.filter(u => u.role === 'director' && u.id !== supervisor));
  // above: tầng cao nhất trước (unshift theo thứ tự đi lên).
  const peers = dept ? users.filter(u => u.departmentId === dept.id && u.id !== me.id && (RANK[u.role] ?? 3) === rank) : [];
  let below = [];
  if (rank === 1 || rank === 2) {
    below.push({ label: `Thành viên ${dept?.name || 'bộ phận'}`, people: users.filter(u => u.departmentId === me.departmentId && (RANK[u.role] ?? 3) > rank).map(person) });
    const kids = [...depts.values()].filter(x => x.parentId === me.departmentId);
    for (const k of kids) below.push({ label: `Lãnh đạo ${k.name}`, people: inDept(k.id, ['manager']).map(person) });
  } else if (rank === 0) {
    const mine = [...depts.values()].filter(x => x.supervisorId === me.id);
    const list = (mine.length ? mine : [...depts.values()].filter(x => !x.parentId && x.id !== me.departmentId));
    below = list.map(k => ({ label: k.name, people: inDept(k.id, ['manager', 'deputy']).map(person) }));
  }
  return { above, me: person(me), peers: peers.map(person), below: below.filter(b => b.people.length) };
}

module.exports = function mountProfile(app, { prisma, auth, audit }) {
  app.get('/api/me/profile', auth, async (req, res) => {
    const me = await prisma.user.findUnique({ where: { id: req.user.id }, include: { department: true } });
    const out = { id: me.id, username: me.username, fullName: me.fullName, displayTitle: me.displayTitle, email: me.email, phone: me.phone,
      role: me.role, roleLabel: ROLES[me.role]?.label || me.role, department: me.department ? { id: me.department.id, name: me.department.name } : null,
      createdAt: me.createdAt, lastLoginAt: me.lastLoginAt, avatarUrl: avatarUrl(me), org: null };
    if (!isItAdmin(req.user)) {
      const [users, depts] = await Promise.all([
        prisma.user.findMany({ where: ACTIVE, select: { id: true, fullName: true, displayTitle: true, role: true, departmentId: true, avatarFile: true }, orderBy: { fullName: 'asc' } }),
        prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true, parentId: true, supervisorId: true } }),
      ]);
      out.org = orgOf(me, users, new Map(depts.map(d => [d.id, d])));
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(out);
  });

  app.put('/api/me/avatar', auth, async (req, res) => {
    if (req.via) fail(403, 'Đổi ảnh đại diện trên giao diện Kepper', 'NOT_VIA_AI');
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image || ''));
    if (!m) fail(422, 'Ảnh không hợp lệ', 'INVALID_IMAGE');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_AVATAR) fail(413, 'Ảnh quá lớn (tối đa 400 KB sau khi thu nhỏ)', 'TOO_LARGE');
    const kind = imageKind(buf);
    if (!kind) fail(422, 'Chỉ nhận ảnh PNG, JPEG hoặc WebP', 'INVALID_IMAGE');
    const saved = await storage.save(`avatar.${kind}`, buf, 'avatars');
    const prev = await prisma.user.findUnique({ where: { id: req.user.id }, select: { avatarFile: true } });
    await prisma.user.update({ where: { id: req.user.id }, data: { avatarFile: saved.objectKey } });
    if (prev?.avatarFile) await storage.remove(prev.avatarFile).catch(() => {});
    await audit(req, 'AVATAR_UPDATE', 'User', req.user.id, null, { size: buf.length });
    res.json({ avatarUrl: '/' + saved.objectKey });
  });
  app.delete('/api/me/avatar', auth, async (req, res) => {
    if (req.via) fail(403, 'Đổi ảnh đại diện trên giao diện Kepper', 'NOT_VIA_AI');
    const prev = await prisma.user.findUnique({ where: { id: req.user.id }, select: { avatarFile: true } });
    if (prev?.avatarFile) {
      await prisma.user.update({ where: { id: req.user.id }, data: { avatarFile: null } });
      await storage.remove(prev.avatarFile).catch(() => {});
      await audit(req, 'AVATAR_DELETE', 'User', req.user.id, null, null);
    }
    res.status(204).end();
  });
  // Ảnh đại diện: chỉ tệp đang gắn với một tài khoản còn hoạt động.
  app.get('/avatars/:file', async (req, res, next) => {
    try {
      if (!AVATAR_RE.test(req.params.file)) return res.status(404).end();
      const key = 'avatars/' + req.params.file;
      const owner = await prisma.user.findFirst({ where: { avatarFile: key, isActive: true }, select: { id: true } });
      if (!owner) return res.status(404).end();
      res.setHeader('Content-Type', { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[req.params.file.split('.').pop()]);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      (await storage.getStream(key)).on('error', () => res.destroy()).pipe(res);
    } catch (error) { next(error); }
  });
};
module.exports.orgOf = orgOf;
module.exports.imageKind = imageKind;
