// Đưa máy đang chạy về đúng bộ máy GĐ3 (Trung tâm) và bỏ thiết kế mẫu cũ — theo yêu cầu chủ dự án (17/10/2026):
//   Ban Giám đốc: Giám đốc + các Phó Giám đốc. Ba phòng: Văn phòng (Chánh / Phó Chánh VP, chuyên viên),
//   Phòng Khoa học Công nghệ, Phòng Tài năng trẻ (trưởng phòng, phó phòng, chuyên viên).
// Thiết kế cũ = 3 phòng mẫu Kinh doanh / Kỹ thuật / Hành chính – Nhân sự, mọi dự án của chúng, "Sổ giao việc Ban Giám đốc" (GV,
// mẫu GĐ2c giao cho các phòng cũ) và dự án thử rỗng đặt tên toàn chữ số (vd. "123").
// Cách bỏ giống hệt thao tác trong ứng dụng, KHÔNG xoá hẳn gì:
//   - dự án cũ → Thùng rác (khôi phục được trong 7 ngày, sau đó hệ thống tự xoá hẳn như mọi dự án bị xoá);
//   - tài khoản mẫu và phòng cũ → khoá (ẩn khỏi mọi danh sách chọn; mở lại được trong Quản trị).
// Sau đó bổ sung cán bộ còn thiếu của bộ máy và dữ liệu mẫu cuối (kế hoạch năm, bảng việc nội bộ 3 phòng) — TÊN GIẢ, xem seed-showcase.js.
// Mỗi thao tác ghi nhật ký hệ thống (ip = 'script:tidy-demo').
// Chạy: npm run tidy:demo -- --dry   (xem trước, không đổi gì)   |   npm run tidy:demo   (áp dụng — nên sao lưu CSDL trước)
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const { ensureCentreStaff, centreFinal } = require('./seed-showcase');

const LEGACY_DEPTS = ['KD', 'KT', 'HCNS'];
const LEGACY_REGISTER = 'GV';
const TAG = 'script:tidy-demo';

async function plan(prisma) {
  const legacyDepts = await prisma.department.findMany({ where: { code: { in: LEGACY_DEPTS } } });
  const deptIds = legacyDepts.map(d => d.id);
  const all = await prisma.project.findMany({ include: { _count: { select: { items: true } } } });
  const projects = all.filter(p => !p.deletedAt && (deptIds.includes(p.departmentId) || (/^\s*\d+\s*$/.test(p.name) && p._count.items === 0)
    || (p.key === LEGACY_REGISTER && p.visibility !== 'ASSIGNED')));
  const users = deptIds.length ? await prisma.user.findMany({ where: { departmentId: { in: deptIds }, isRootAdmin: false, isActive: true } }) : [];
  return { legacyDepts: legacyDepts.filter(d => d.isActive), projects, users };
}

async function apply(prisma, p) {
  const now = new Date();
  const log = (action, entity, id, oldValue, newValue) => prisma.auditLog.create({ data: { userId: null, action, entity, entityId: String(id),
    oldValue: oldValue ? JSON.stringify(oldValue) : null, newValue: JSON.stringify({ ...(newValue || {}), reason: 'TIDY_DEMO' }), ip: TAG } });
  const result = { trashedProjects: [], lockedUsers: [], lockedDepts: [], createdStaff: [], finalSample: '' };

  // 1) Dự án cũ → Thùng rác (như nút "Xoá dự án"): huỷ phiếu duyệt đang chờ trong dự án.
  for (const pr of p.projects) {
    await prisma.$transaction([
      prisma.project.update({ where: { id: pr.id }, data: { deletedAt: now, deletedById: null } }),
      prisma.approvalRequest.updateMany({ where: { status: 'PENDING', workItem: { projectId: pr.id } }, data: { status: 'CANCELLED', closedAt: now } }),
    ]);
    await log('TRASH', 'Project', pr.id, null, { key: pr.key, name: pr.name, items: pr._count.items });
    result.trashedProjects.push(pr.key);
  }
  // 2) Tài khoản mẫu của phòng cũ → khoá (giữ nguyên phòng để mở lại được).
  for (const u of p.users) {
    await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    await log('UPDATE', 'User', u.id, { username: u.username, isActive: true }, { isActive: false });
    result.lockedUsers.push(u.username);
  }
  // 3) Phòng cũ → khoá.
  for (const d of p.legacyDepts) {
    await prisma.department.update({ where: { id: d.id }, data: { isActive: false } });
    await log('UPDATE', 'Department', d.id, { code: d.code, isActive: true }, { isActive: false });
    result.lockedDepts.push(d.code);
  }
  // 4) Cán bộ còn thiếu của bộ máy Trung tâm (tên giả, cùng luồng tạo tài khoản + quyền khởi tạo như seed).
  result.createdStaff = await ensureCentreStaff(prisma);
  for (const username of result.createdStaff) {
    const u = await prisma.user.findUnique({ where: { username } });
    await log('CREATE', 'User', u.id, null, { username, role: u.role, departmentId: u.departmentId });
  }
  // 5) Dữ liệu mẫu cuối: kế hoạch năm 2027 + nhiệm vụ bổ sung trong sổ TT, bảng việc nội bộ cho từng phòng.
  result.finalSample = await centreFinal(prisma);
  await prisma.auditLog.create({ data: { action: 'CREATE', entity: 'Showcase', entityId: null, newValue: JSON.stringify({ summary: result.finalSample, reason: 'TIDY_DEMO' }), ip: TAG } });
  return result;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const dry = process.argv.includes('--dry');
    const p = await plan(prisma);
    const preview = {
      dry,
      toTrash: p.projects.map(x => `${x.key} ${x.name} (${x._count.items} việc)`),
      lockUsers: p.users.map(u => u.username),
      lockDepartments: p.legacyDepts.map(d => `${d.code} ${d.name}`),
      then: 'bổ sung cán bộ còn thiếu (pp.tnt, pgd2) + dữ liệu mẫu cuối (kế hoạch năm 2027, bảng việc nội bộ 3 phòng)',
    };
    if (dry) { console.log(JSON.stringify(preview, null, 2)); return; }
    console.log(JSON.stringify({ ...preview, result: await apply(prisma, p) }, null, 2));
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exit(1); });
module.exports = { plan, apply, LEGACY_DEPTS };
