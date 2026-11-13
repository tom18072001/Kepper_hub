// Nhập cơ cấu tổ chức và tài khoản nhân sự từ tệp JSON — CHẠY TRÊN MÁY CHẠY, dữ liệu thật KHÔNG đưa vào git.
//   docker compose exec -T app node scripts/import-org.js < org.json        (đọc từ stdin)
//   docker compose exec app node scripts/import-org.js /data/import/org.json --dry-run
// Tệp JSON:
//   { "departments": [{ "code": "TH", "name": "Phòng Tổng hợp", "parentCode": null, "supervisorUsername": null }],
//     "users": [{ "username": "nguyen.van.a", "fullName": "...", "displayTitle": "Trưởng phòng", "email": "...", "phone": "...",
//                 "role": "manager", "departmentCode": "TH" }] }
//     "settings": {   // tuỳ chọn — tham số lấy từ quy chế của công ty, tham chiếu người bằng tài khoản, bộ phận bằng mã
//       "vanthu": { "entities": [{ "code": "HLD", "name": "..." }], "clerks": ["user"], "legal": ["user"] },
//       "hrm": { "hr": ["user"], "workStart": "08:00", "workEnd": "17:00", "lunchStart": "12:00", "lunchEnd": "13:00", "workDays": [1,2,3,4,5], "holidays": ["2026-11-24"], "annualDays": 12 },
//       "weekly": { "secretaryDepartmentCode": "TH" } } }
// Chạy lại được nhiều lần: phòng ban trùng mã thì cập nhật tên / cấp trên; tài khoản đã có thì GIỮ NGUYÊN (không đổi mật khẩu, quyền).
// settings: ghi đè đúng các khoá có trong tệp, giữ nguyên khoá khác đã đặt trên giao diện.
// Tài khoản mới: mật khẩu mặc định của hệ thống + bắt đổi ở lần đăng nhập đầu, quyền theo vai trò — giống tạo trong trang Quản trị.
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { ROLES, grantInitialPermissions } = require('../src/lib/permissions');
const { DEFAULT_PASSWORD } = require('../src/lib/passwords');

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const file = args.find(a => !a.startsWith('--'));
const input = JSON.parse(fs.readFileSync(file || 0, 'utf8'));
const prisma = new PrismaClient();

const clean = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);
async function main() {
  const report = { departments: { created: 0, updated: 0 }, users: { created: 0, skipped: 0 }, errors: [] };
  await prisma.$transaction(async tx => {
    const root = await tx.user.findFirst({ where: { isRootAdmin: true }, select: { id: true } });
    const depts = input.departments || [];
    for (const d of depts) {
      const code = clean(d.code, 30)?.toUpperCase(); const name = clean(d.name, 200);
      if (!code || !name) { report.errors.push(`Phòng ban thiếu mã / tên: ${JSON.stringify(d)}`); continue; }
      const old = await tx.department.findUnique({ where: { code } });
      if (old) { await tx.department.update({ where: { code }, data: { name } }); report.departments.updated++; }
      else { await tx.department.create({ data: { code, name } }); report.departments.created++; }
    }
    for (const d of depts) { // cấp trên — sau khi mọi phòng đã có
      if (!d.parentCode) continue;
      const parent = await tx.department.findUnique({ where: { code: String(d.parentCode).toUpperCase() } });
      if (!parent) { report.errors.push(`Không có phòng cấp trên ${d.parentCode}`); continue; }
      await tx.department.update({ where: { code: String(d.code).toUpperCase() }, data: { parentId: parent.id } });
    }
    const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    for (const u of input.users || []) {
      const username = String(u.username || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,50}$/.test(username)) { report.errors.push(`Tài khoản không hợp lệ: ${u.username}`); continue; }
      if (!ROLES[u.role || 'member']) { report.errors.push(`Vai trò không hợp lệ cho ${username}: ${u.role}`); continue; }
      if (await tx.user.findUnique({ where: { username } })) { report.users.skipped++; continue; }
      const dept = u.departmentCode ? await tx.department.findUnique({ where: { code: String(u.departmentCode).toUpperCase() } }) : null;
      if (u.departmentCode && !dept) { report.errors.push(`Không có phòng ${u.departmentCode} cho ${username}`); continue; }
      const created = await tx.user.create({ data: {
        username, fullName: clean(u.fullName, 120) || username, displayTitle: clean(u.displayTitle, 120), email: clean(u.email, 160),
        phone: clean(u.phone, 30), role: u.role || 'member', departmentId: dept?.id ?? null, passwordHash: hash, mustChangePw: true,
      } });
      const granted = await grantInitialPermissions(tx, created, root?.id ?? null);
      await tx.auditLog.create({ data: { userId: root?.id ?? null, action: 'CREATE', entity: 'User', entityId: String(created.id),
        newValue: JSON.stringify({ username, role: created.role, departmentId: created.departmentId, granted, via: 'import-org' }) } });
      report.users.created++;
    }
    for (const d of depts) { // PGĐ phụ trách — sau khi tài khoản đã có
      if (!d.supervisorUsername) continue;
      const sup = await tx.user.findUnique({ where: { username: String(d.supervisorUsername).toLowerCase() } });
      if (!sup || sup.role !== 'director') { report.errors.push(`PGĐ phụ trách ${d.supervisorUsername} không phải tài khoản Ban giám đốc`); continue; }
      await tx.department.update({ where: { code: String(d.code).toUpperCase() }, data: { supervisorId: sup.id } });
    }
    const st = input.settings || {};
    const uids = async (names, label) => {
      const out = [];
      for (const n of names || []) { const u = await tx.user.findUnique({ where: { username: String(n).toLowerCase() } }); if (u) out.push(u.id); else report.errors.push(`${label}: không có tài khoản ${n}`); }
      return out;
    };
    const merge = async (key, patch) => {
      const row = await tx.appSetting.findUnique({ where: { key } });
      const value = { ...(row?.value && typeof row.value === 'object' ? row.value : {}), ...patch };
      await tx.appSetting.upsert({ where: { key }, update: { value, updatedById: root?.id ?? null }, create: { key, value, updatedById: root?.id ?? null } });
      report.settings = [...(report.settings || []), key];
    };
    if (st.vanthu) await merge('vanthu.config', { ...(st.vanthu.entities && { entities: st.vanthu.entities }), ...(st.vanthu.clerks && { clerkUserIds: await uids(st.vanthu.clerks, 'Văn thư') }), ...(st.vanthu.legal && { legalUserIds: await uids(st.vanthu.legal, 'Pháp chế') }) });
    if (st.hrm) { const { hr, ...rest } = st.hrm; await merge('hrm.config', { ...rest, ...(hr && { hrUserIds: await uids(hr, 'Nhân sự') }) }); }
    if (st.weekly?.secretaryDepartmentCode) {
      const d = await tx.department.findUnique({ where: { code: String(st.weekly.secretaryDepartmentCode).toUpperCase() } });
      if (d) await merge('weekly.config', { secretaryDepartmentId: d.id }); else report.errors.push(`Không có bộ phận thư ký ${st.weekly.secretaryDepartmentCode}`);
    }
    if (dry) throw Object.assign(new Error('dry-run'), { dry: true });
  }).catch(e => { if (!e.dry) throw e; });
  console.log(JSON.stringify({ dryRun: dry, ...report }, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
