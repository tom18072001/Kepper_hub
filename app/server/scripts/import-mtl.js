// Nhập MTL tổng từ Excel trên MÁY CHẠY, thay mặt PMO do Ban GĐ / chủ dự án chỉ định — cùng lõi và quy tắc với nút "Nhập MTL từ Excel".
// Tệp MTL thật là dữ liệu Bảo mật: chỉ đặt trên máy chạy, xoá sau khi nhập; KHÔNG đưa vào git.
//   docker compose exec -T app node scripts/import-mtl.js --file /tmp/mtl.xlsx --key NOXH --name "Dự án NƠXH Dương Xá" \
//        --t0 2026-10-01 --dept BGD --pmo huong.ptt --sheet "MTL overall" [--dry-run]
// Chưa có dự án mã --key thì tạo dự án MTL (T0 = --t0, phòng ban chủ quản --dept, PMO làm trưởng dự án + được chỉ định PMO).
// Có rồi: nhập / cập nhật kế hoạch theo tên (mặc định "MTL — <sheet>"), giữ kế hoạch gốc trừ khi --rebaseline.
const fs = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const { createApp, loadConfig } = require('../src/app');
const { MTL_STATES } = require('../src/routes/projects');

const arg = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes('--' + k);

async function main() {
  const prisma = new PrismaClient();
  try {
    const config = loadConfig(process.env);
    const app = createApp({ prisma, config });
    const file = arg('file'), key = String(arg('key') || '').toUpperCase(), sheet = arg('sheet');
    if (!file || !fs.existsSync(file) || !key) throw new Error('Thiếu --file <đường dẫn .xlsx> hoặc --key <mã dự án>');
    const pmo = await prisma.user.findFirst({ where: { username: String(arg('pmo') || '').toLowerCase(), isActive: true } });
    if (!pmo) throw new Error('Không có tài khoản PMO ' + arg('pmo'));
    // --aliases '{"kinh doanh":"BGD"}': cách gọi đầu mối riêng của công ty → mã phòng ban (thiết lập mtl.ownerAliases, dùng chung với nút nhập trên web).
    if (arg('aliases')) {
      const v = JSON.parse(arg('aliases'));
      await prisma.appSetting.upsert({ where: { key: 'mtl.ownerAliases' }, update: { value: v }, create: { key: 'mtl.ownerAliases', value: v } });
    }
    let project = await prisma.project.findFirst({ where: { key } });
    if (!project) {
      const dept = await prisma.department.findFirst({ where: { code: String(arg('dept') || '').toUpperCase(), isActive: true } });
      const t0 = arg('t0') && /^\d{4}-\d{2}-01$/.test(arg('t0')) ? new Date(arg('t0') + 'T00:00:00+07:00') : null;
      if (!dept || !t0) throw new Error('Tạo dự án mới cần --dept <mã phòng ban> và --t0 YYYY-MM-01 (tháng T0 của MTL)');
      // Chạy thử khi chưa có dự án: dùng dự án tạm trong bộ nhớ (không ghi gì) để xem trước cách tách đầu mối, ngày theo T.
      if (has('dry-run')) project = { id: -1, key, name: String(arg('name') || key), t0Date: t0, departmentId: dept.id, wouldCreate: true };
      else project = await prisma.$transaction(async tx => {
        const p = await tx.project.create({ data: { key, name: String(arg('name') || key).slice(0, 160), departmentId: dept.id, leadId: pmo.id, visibility: 'PUBLIC', createdById: pmo.id,
          kind: 'MTL', t0Date: t0, defaultApprovalLevels: 0, states: { create: MTL_STATES.map((s, position) => ({ ...s, position })) } } });
        await tx.projectMember.create({ data: { projectId: p.id, userId: pmo.id, role: 'OWNER' } });
        await tx.auditLog.create({ data: { userId: pmo.id, action: 'CREATE', entity: 'Project', entityId: String(p.id), newValue: JSON.stringify({ key, via: 'import-mtl' }), userAgent: 'scripts/import-mtl.js' } });
        return p;
      });
      // PMO được chỉ định (weekly.config.pmoUserIds) — để PMO tự nhập lại / điều chỉnh MTL trên giao diện.
      if (project && !project.wouldCreate) {
        const row = await prisma.appSetting.findUnique({ where: { key: 'weekly.config' } });
        const v = row?.value && typeof row.value === 'object' ? row.value : {};
        const ids = [...new Set([...(v.pmoUserIds || []), pmo.id])];
        await prisma.appSetting.upsert({ where: { key: 'weekly.config' }, update: { value: { ...v, pmoUserIds: ids } }, create: { key: 'weekly.config', value: { pmoUserIds: ids } } });
      }
    }
    if (!project) return;
    const req = { user: pmo, body: { sheet, planName: arg('plan'), dryRun: has('dry-run') ? '1' : '', rebaseline: has('rebaseline') ? '1' : '' }, ip: null, headers: { 'user-agent': 'scripts/import-mtl.js' } };
    const out = await app.locals.importMtl(req, { project, kind: 'MASTER', departmentId: null, asLeader: false, buf: fs.readFileSync(file), fileName: file.split('/').pop() });
    const { preview, ...summary } = out;
    console.log(JSON.stringify({ project: { id: project.id, key: project.key, name: project.name, wouldCreate: !!project.wouldCreate }, ...summary, previewSample: (preview || []).slice(0, 5).map(p => `${p.step} · ${p.lead || '?'} · ${p.action}`) }, null, 2));
  } finally { await prisma.$disconnect(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
