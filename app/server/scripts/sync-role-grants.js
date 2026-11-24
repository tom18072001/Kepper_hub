// Đồng bộ bảng quyền lưu riêng (UserPermission) về đúng bộ quyền mặc định của VAI từng tài khoản — chạy TRƯỚC KHI quay lại bản cũ
// (bản trước "một hệ quy chiếu" đọc quyền từ bảng này). Bản hiện tại không đọc bảng này; khi tạo tài khoản / đổi vai đã tự ghi.
//   docker compose exec app node scripts/sync-role-grants.js --dry-run   (chỉ in số tài khoản sẽ đổi)
//   docker compose exec app node scripts/sync-role-grants.js
// Không đụng quản trị gốc. Ghi một dòng nhật ký hệ thống cho mỗi tài khoản được đồng bộ (chỉ số quyền, không tên người ra màn hình).
const { PrismaClient } = require('@prisma/client');
const { ROLE_PROFILES, roleOf, syncRoleGrants } = require('../src/lib/permissions');

async function main(prisma = new PrismaClient(), dryRun = process.argv.includes('--dry-run')) {
  const key = g => `${g.permissionKey}|${g.action}|${g.scope}`;
  const users = await prisma.user.findMany({ where: { isRootAdmin: false }, include: { permissions: true } });
  let changed = 0;
  for (const u of users) {
    const want = new Set((ROLE_PROFILES[roleOf(u)] || []).map(key)), have = new Set(u.permissions.map(key));
    if (want.size === have.size && [...want].every(k => have.has(k))) continue;
    changed++;
    if (dryRun) continue;
    await prisma.$transaction(async tx => {
      const n = await syncRoleGrants(tx, u, null);
      await tx.auditLog.create({ data: { userId: null, action: 'ROLE_PROFILE_APPLY', entity: 'User', entityId: String(u.id), newValue: JSON.stringify({ role: u.role, grants: n, via: 'sync-role-grants' }) } });
    });
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}${changed}/${users.length} tài khoản ${dryRun ? 'sẽ được' : 'đã được'} đồng bộ bộ quyền theo vai`);
  await prisma.$disconnect();
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = main;
