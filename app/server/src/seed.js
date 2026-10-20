// Tạo tài khoản quản trị gốc (từ biến môi trường) và — nếu SEED_DEMO=true — dữ liệu mẫu GIẢ.
// Không bao giờ dùng dữ liệu thật ở đây (Data Protection Gate).
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { grantInitialPermissions } = require('./lib/permissions');
const { DEFAULT_PASSWORD, MIN_PASSWORD_LENGTH } = require('./lib/passwords');
const { DEFAULT_STATES } = require('./routes/projects');

const DEPARTMENTS = [
  { code: 'BGD', name: 'Ban Giám đốc' }, { code: 'KD', name: 'Phòng Kinh doanh' },
  { code: 'KT', name: 'Phòng Kỹ thuật' }, { code: 'HCNS', name: 'Phòng Hành chính – Nhân sự' },
  // Kepper: bộ phận theo đầu mối trong Master Timeline.
  { code: 'PL', name: 'Ban Pháp lý' }, { code: 'TC', name: 'Ban Tài chính' }, { code: 'TK', name: 'Ban Thiết kế' },
  { code: 'QLXD', name: 'Ban Quản lý xây dựng' }, { code: 'GR', name: 'Ban Đối ngoại – GPMB' },
];
const USERS = [
  { username: 'giamdoc', fullName: 'Trần Minh Giám', displayTitle: 'Giám đốc', role: 'director', dept: 'BGD' },
  { username: 'tp.kinhdoanh', fullName: 'Lê Thu Hà', displayTitle: 'Trưởng phòng Kinh doanh', role: 'manager', dept: 'KD' },
  { username: 'nv.kinhdoanh1', fullName: 'Phạm Văn An', displayTitle: 'Chuyên viên kinh doanh', role: 'member', dept: 'KD' },
  { username: 'nv.kinhdoanh2', fullName: 'Đỗ Thị Bình', displayTitle: 'Chuyên viên kinh doanh', role: 'member', dept: 'KD' },
  { username: 'tp.kythuat', fullName: 'Ngô Quang Kỹ', displayTitle: 'Trưởng phòng Kỹ thuật', role: 'manager', dept: 'KT' },
  { username: 'nv.kythuat', fullName: 'Vũ Đức Cường', displayTitle: 'Kỹ sư', role: 'member', dept: 'KT' },
  { username: 'nv.hcns', fullName: 'Hoàng Mai Lan', displayTitle: 'Chuyên viên nhân sự', role: 'member', dept: 'HCNS' },
  // Kepper (tên GIẢ)
  { username: 'pmo', fullName: 'Đặng Quốc Minh', displayTitle: 'Điều phối dự án (PMO)', role: 'member', dept: 'BGD' },
  { username: 'tb.phaply', fullName: 'Lý Thanh Hằng', displayTitle: 'Trưởng ban Pháp lý', role: 'manager', dept: 'PL' },
  { username: 'nv.phaply', fullName: 'Tô Minh Khoa', displayTitle: 'Chuyên viên pháp lý', role: 'member', dept: 'PL' },
  { username: 'tb.taichinh', fullName: 'Mạc Thị Ngân', displayTitle: 'Trưởng ban Tài chính', role: 'manager', dept: 'TC' },
  { username: 'tb.thietke', fullName: 'Kha Văn Tạo', displayTitle: 'Trưởng ban Thiết kế', role: 'manager', dept: 'TK' },
  { username: 'tb.qlxd', fullName: 'Ông Đức Xây', displayTitle: 'Trưởng ban QLXD', role: 'manager', dept: 'QLXD' },
  { username: 'nv.qlxd', fullName: 'Lã Văn Công', displayTitle: 'Kỹ sư giám sát', role: 'member', dept: 'QLXD' },
  { username: 'tb.doingoai', fullName: 'Quách Thị Giao', displayTitle: 'Trưởng ban Đối ngoại – GPMB', role: 'manager', dept: 'GR' },
];
const LABELS = [{ name: 'Khách hàng', color: '#7c3aed' }, { name: 'Nội bộ', color: '#0891b2' }, { name: 'Gấp', color: '#dc2626' }];

async function seed(prisma = new PrismaClient(), env = process.env) {
  const out = { rootAdmin: false, demo: false };
  const rootUsername = String(env.ROOT_ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const rootPassword = String(env.ROOT_ADMIN_PASSWORD || '');
  if (!(await prisma.user.findFirst({ where: { isRootAdmin: true } }))) {
    if (rootPassword.length < MIN_PASSWORD_LENGTH) throw new Error('ROOT_ADMIN_PASSWORD phải có ít nhất 6 ký tự');
    await prisma.user.create({ data: { username: rootUsername, fullName: 'Quản trị hệ thống', role: 'admin', isRootAdmin: true, mustChangePw: false, passwordHash: bcrypt.hashSync(rootPassword, 10) } });
    out.rootAdmin = true;
  }
  // Danh mục mặc định (mẫu nhóm việc "Nhiệm vụ chuẩn – Cuộc thi/Hội thi").
  await require('./services/register').ensureDefaults(prisma);
  if (String(env.SEED_DEMO) !== 'true' || await prisma.project.count()) return out;

  const root = await prisma.user.findFirst({ where: { isRootAdmin: true } });
  const dept = {};
  for (const d of DEPARTMENTS) dept[d.code] = await prisma.department.upsert({ where: { code: d.code }, update: {}, create: d });
  const users = {};
  for (const u of USERS) {
    users[u.username] = await prisma.$transaction(async tx => {
      const existing = await tx.user.findUnique({ where: { username: u.username } });
      if (existing) return existing;
      const created = await tx.user.create({ data: { username: u.username, fullName: u.fullName, displayTitle: u.displayTitle, role: u.role,
        departmentId: dept[u.dept].id, passwordHash: bcrypt.hashSync(DEFAULT_PASSWORD, 10), mustChangePw: true } });
      await grantInitialPermissions(tx, created, root.id);
      return created;
    });
  }
  const labels = {};
  for (const l of LABELS) labels[l.name] = (await prisma.label.findFirst({ where: { name: l.name, projectId: null } })) || await prisma.label.create({ data: l });

  const makeProject = async ({ key, name, deptCode, lead, members, steps = [], items, intakeEnabled = false }) => prisma.$transaction(async tx => {
    const project = await tx.project.create({ data: { key, name, departmentId: dept[deptCode].id, leadId: users[lead].id, createdById: root.id, intakeEnabled,
      states: { create: DEFAULT_STATES.map((s, position) => ({ ...s, position })) } }, include: { states: true } });
    await tx.projectMember.createMany({ data: members.map(([username, role]) => ({ projectId: project.id, userId: users[username].id, role })) });
    if (steps.length) await tx.approvalStep.createMany({ data: steps.map((s, i) => ({ ...s, level: i + 1, projectId: project.id })) });
    const stateOf = category => project.states.find(s => s.category === category);
    let n = 0;
    for (const it of items) {
      n++;
      const state = stateOf(it.category);
      const due = it.dueInDays == null ? null : new Date(Date.now() + it.dueInDays * 86_400_000);
      await tx.workItem.create({ data: {
        projectId: project.id, number: n, title: it.title, descriptionHtml: `<p>${it.title}.</p>`, descriptionText: it.title + '.', stateId: state.id, priority: it.priority || 'MEDIUM',
        reporterId: users[lead].id, dueDate: due, startDate: due ? new Date(due.getTime() - 5 * 86_400_000) : null, position: n * 1024,
        startedAt: ['STARTED', 'REVIEW', 'COMPLETED'].includes(it.category) ? new Date(Date.now() - (it.startedDaysAgo || 3) * 86_400_000) : null,
        completedAt: it.category === 'COMPLETED' ? new Date() : null,
        assignees: { create: (it.assignees || []).map(u => ({ userId: users[u].id })) },
        labels: { create: (it.labels || []).map(l => ({ labelId: labels[l].id })) },
        activities: { create: { actorId: users[lead].id, type: 'CREATED', data: { title: it.title, source: 'SEED' } } },
      } });
    }
    await tx.project.update({ where: { id: project.id }, data: { nextNumber: n + 1 } });
    return project;
  });

  await makeProject({ key: 'KD', name: 'Kinh doanh Quý IV', deptCode: 'KD', lead: 'tp.kinhdoanh',
    members: [['tp.kinhdoanh', 'OWNER'], ['nv.kinhdoanh1', 'MEMBER'], ['nv.kinhdoanh2', 'MEMBER']],
    steps: [{ name: 'Trưởng phòng duyệt', approverType: 'DEPARTMENT_MANAGER' }, { name: 'Giám đốc duyệt', approverType: 'DIRECTOR' }],
    items: [
      { title: 'Lập danh sách khách hàng tiềm năng', category: 'UNSTARTED', assignees: ['nv.kinhdoanh1'], labels: ['Khách hàng'], dueInDays: 5, priority: 'HIGH' },
      { title: 'Soạn báo giá gói dịch vụ doanh nghiệp', category: 'STARTED', assignees: ['nv.kinhdoanh2'], labels: ['Khách hàng'], dueInDays: 2, startedDaysAgo: 9 },
      { title: 'Tổng hợp doanh số tháng', category: 'BACKLOG', assignees: [], dueInDays: 12, priority: 'LOW' },
      { title: 'Chuẩn bị hồ sơ đấu thầu', category: 'UNSTARTED', assignees: ['nv.kinhdoanh1', 'nv.kinhdoanh2'], labels: ['Gấp'], dueInDays: -1, priority: 'URGENT' },
    ] });
  await makeProject({ key: 'KT', name: 'Hạ tầng nội bộ', deptCode: 'KT', lead: 'tp.kythuat',
    members: [['tp.kythuat', 'OWNER'], ['nv.kythuat', 'MEMBER']], intakeEnabled: true,
    items: [
      { title: 'Nâng cấp máy chủ lưu trữ', category: 'STARTED', assignees: ['nv.kythuat'], labels: ['Nội bộ'], dueInDays: 7 },
      { title: 'Rà soát sao lưu hằng tuần', category: 'COMPLETED', assignees: ['nv.kythuat'], labels: ['Nội bộ'] },
      { title: 'Cấu hình VPN cho nhân viên mới', category: 'UNSTARTED', assignees: [], dueInDays: 3, priority: 'HIGH' },
    ] });
  await seedKepper(prisma, { root, users, dept });
  out.demo = true;
  return out;
}

// Dự án mẫu theo Master Timeline (nội dung GIẢ, cùng cấu trúc MTL): T0 cách đây 10 tháng để có đủ trạng thái
// đúng / chậm / vượt / trễ / hoàn thành; kèm MTL bộ phận của Ban Pháp lý (hạng mục con).
const DEMO_MTL = [
  // [bước, hạng mục, đầu mối, startT, endT, găng, mốc, tiến độ %, hoàn thành?]
  ['1', 'Thẩm định pháp lý & ký thoả thuận hợp tác (mẫu)', 'CT/GĐĐH/PL', 0, 2, true, false, 100, true],
  ['2', 'Thành lập pháp nhân dự án & góp vốn (mẫu)', 'CT/Tài chính', 0, 2, false, false, 100, true],
  ['3', 'Lập hồ sơ chuyển nhượng dự án (mẫu)', 'Pháp lý', 2, 4, true, false, 100, true],
  ['4', 'Thẩm định hồ sơ chuyển nhượng (mẫu)', 'PL/Sở KH-ĐT', 4, 6, true, false, 100, true],
  ['5', 'Văn bản chấp thuận chuyển nhượng (mẫu)', 'UBND TP', 6, 7, true, true, 40, false],
  ['6', 'Ký hợp đồng chuyển nhượng & thanh toán (mẫu)', 'Tài chính/PL', 7, 8, true, false, 0, false],
  ['7', 'Quyết định giao / cho thuê đất (mẫu)', 'UBND TP/Sở NN-MT', 8, 10, true, true, 0, false],
  ['8', 'Hồ sơ đề xuất dự án; xin chấp thuận chủ trương (mẫu)', 'Pháp lý/GĐĐH', 7, 11, true, true, 20, false],
  ['9', 'Văn bản chấp thuận độ cao tĩnh không (mẫu)', 'Thiết kế/PL', 7, 10, false, false, 85, false],
  ['10', 'Bảo vệ phương án tổng mặt bằng (mẫu)', 'Thiết kế/PL', 8, 11, false, false, 70, false],
  ['11', 'Lập & phê duyệt quy hoạch chi tiết 1/500 (mẫu)', 'Thiết kế', 10, 14, true, false, 30, false],
  ['12', 'Thoả thuận đấu nối hạ tầng kỹ thuật (mẫu)', 'TK/QLXD', 11, 13, false, false, 0, false],
  ['13', 'Thẩm tra thiết kế cơ sở (mẫu)', 'Thiết kế', 13, 15, true, false, 0, false],
  ['14', 'Cấp giấy phép xây dựng (mẫu)', 'QLXD/PL', 15, 16, true, true, 0, false],
  ['15', 'Khởi công — thi công hạ tầng & móng (mẫu)', 'QLXD', 16, 24, true, true, 0, false],
  ['16', 'Mở bán (mẫu)', 'Kinh doanh/TC/PL', 24, 26, true, true, 0, false],
  ['II.1', '(Phân kỳ 2) Thoả thuận nhận quyền sử dụng đất (mẫu)', 'Pháp lý/GR', 3, 9, true, false, 35, false],
  ['II.2', '(Phân kỳ 2) Giải phóng mặt bằng (mẫu)', 'GR/UBND TP', 5, 14, false, true, 15, false],
];
const DEMO_PL = [ // MTL bộ phận Pháp lý: chi tiết hoá bước 8 (ngày tương đối so với đầu tháng T7)
  ['8.1', 'Soạn hồ sơ đề xuất (mẫu)', 'nv.phaply', 0, 30, 100, true],
  ['8.2', 'Lấy ý kiến các sở (mẫu)', 'nv.phaply', 25, 75, 30, false],
  ['8.3', 'Hoàn thiện hồ sơ theo ý kiến (mẫu)', 'tb.phaply', 70, 110, 0, false],
  ['8.4', 'Trình chấp thuận chủ trương (mẫu)', 'tb.phaply', 105, 150, 0, false],
];
async function seedKepper(prisma, { root, users, dept }) {
  const M = require('./services/mtl');
  const { MTL_STATES } = require('./routes/projects');
  const now = new Date();
  const t = M.monthStart(now, -10); // T0 = đầu tháng, 10 tháng trước
  const departments = Object.values(dept);
  await prisma.$transaction(async tx => {
    const project = await tx.project.create({ data: { key: 'DA', name: 'Dự án mẫu NƠXH (giả)', kind: 'MTL', t0Date: t, visibility: 'PUBLIC', defaultApprovalLevels: 0,
      departmentId: dept.BGD.id, leadId: users.pmo.id, createdById: root.id, states: { create: MTL_STATES.map((s, position) => ({ ...s, position })) } }, include: { states: true } });
    const st = c => project.states.find(s => s.category === c);
    const master = await tx.plan.create({ data: { projectId: project.id, name: 'MTL tổng (mẫu)', year: now.getFullYear(), kind: 'MASTER', sheetName: 'MTL overall', createdById: users.pmo.id } });
    const pl = await tx.plan.create({ data: { projectId: project.id, name: 'MTL Ban Pháp lý (mẫu)', year: now.getFullYear(), kind: 'DEPARTMENT', departmentId: dept.PL.id, createdById: users['tb.phaply'].id } });
    let n = 0; const byStep = {};
    const leadOf = { BGD: 'giamdoc', PL: 'tb.phaply', TC: 'tb.taichinh', TK: 'tb.thietke', QLXD: 'tb.qlxd', KD: 'tp.kinhdoanh', GR: 'tb.doingoai' };
    for (const [step, title, owner, s, e, critical, milestone, progress, done] of DEMO_MTL) {
      const o = M.splitOwner(owner, departments), d = M.tToDates(t, s, e);
      const lead = o.leadDepartmentId ?? dept.BGD.id, code = Object.keys(dept).find(k => dept[k].id === lead);
      const started = progress > 0 || done;
      const item = await tx.workItem.create({ data: { projectId: project.id, number: ++n, title, planId: master.id, planCode: step, planSection: step.startsWith('II') ? 'Phần II — Phân kỳ 2 (mẫu)' : null,
        ownerText: owner, externalParty: o.externalParty, leadDepartmentId: lead, critical, milestone, startT: s, endT: e, baselineStart: d.start, baselineEnd: d.end, startDate: d.start, dueDate: d.end, originalDueDate: d.end,
        progress: done ? 100 : progress, progressAt: started ? new Date(now.getTime() - 3 * 86_400_000) : null, startedAt: started ? d.start : null,
        completedAt: done ? new Date(Math.min(d.end.getTime() - 5 * 86_400_000, now.getTime())) : null, taskType: 'PLAN',
        stateId: (done ? st('COMPLETED') : started ? st('STARTED') : st('UNSTARTED')).id, position: n * 1024, reporterId: users.pmo.id, assignedById: users.pmo.id, assignedAt: t,
        assignees: { create: leadOf[code] ? [{ userId: users[leadOf[code]].id }] : [] }, supportDepartments: { create: o.supportDepartmentIds.map(departmentId => ({ departmentId })) },
        activities: { create: { actorId: users.pmo.id, type: 'CREATED', data: { source: 'SEED_MTL' } } } } });
      byStep[step] = item;
    }
    const base = M.monthStart(t, 7).getTime();
    for (const [step, title, who, s, e, progress, done] of DEMO_PL) {
      const start = new Date(base + s * 86_400_000), end = new Date(base + (e + 1) * 86_400_000 - 1);
      await tx.workItem.create({ data: { projectId: project.id, number: ++n, title, parentId: byStep['8'].id, planId: pl.id, planCode: step, ownerText: users[who].fullName, leadDepartmentId: dept.PL.id,
        baselineStart: start, baselineEnd: end, startDate: start, dueDate: end, originalDueDate: end, progress: done ? 100 : progress, progressAt: progress ? new Date(now.getTime() - 9 * 86_400_000) : null,
        startedAt: progress || done ? start : null, completedAt: done ? new Date(end.getTime() - 2 * 86_400_000) : null, taskType: 'PLAN',
        stateId: (done ? st('COMPLETED') : progress ? st('STARTED') : st('UNSTARTED')).id, position: n * 1024, reporterId: users['tb.phaply'].id, assignedById: users['tb.phaply'].id, assignedAt: start,
        assignees: { create: [{ userId: users[who].id }] }, activities: { create: { actorId: users['tb.phaply'].id, type: 'CREATED', data: { source: 'SEED_MTL' } } } } });
    }
    await tx.project.update({ where: { id: project.id }, data: { nextNumber: n + 1 } });
    // Dự án dùng chung: mọi cán bộ các bộ phận là thành viên; PMO là chủ dự án.
    const staff = await tx.user.findMany({ where: { isActive: true, role: { not: 'admin' }, isRootAdmin: false }, select: { id: true } });
    await tx.projectMember.createMany({ data: staff.map(u => ({ projectId: project.id, userId: u.id, role: u.id === users.pmo.id || u.id === users.giamdoc.id ? 'OWNER' : 'MEMBER' })), skipDuplicates: true });
  });
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma).then(result => { console.log(JSON.stringify({ level: 'info', msg: 'seed_done', ...result })); return prisma.$disconnect(); })
    .catch(async error => { console.error(error.message); await prisma.$disconnect(); process.exit(1); });
}
module.exports = { seed };
