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
];
const USERS = [
  { username: 'giamdoc', fullName: 'Trần Minh Giám', displayTitle: 'Giám đốc', role: 'director', dept: 'BGD' },
  { username: 'tp.kinhdoanh', fullName: 'Lê Thu Hà', displayTitle: 'Trưởng phòng Kinh doanh', role: 'manager', dept: 'KD' },
  { username: 'nv.kinhdoanh1', fullName: 'Phạm Văn An', displayTitle: 'Chuyên viên kinh doanh', role: 'member', dept: 'KD' },
  { username: 'nv.kinhdoanh2', fullName: 'Đỗ Thị Bình', displayTitle: 'Chuyên viên kinh doanh', role: 'member', dept: 'KD' },
  { username: 'tp.kythuat', fullName: 'Ngô Quang Kỹ', displayTitle: 'Trưởng phòng Kỹ thuật', role: 'manager', dept: 'KT' },
  { username: 'nv.kythuat', fullName: 'Vũ Đức Cường', displayTitle: 'Kỹ sư', role: 'member', dept: 'KT' },
  { username: 'nv.hcns', fullName: 'Hoàng Mai Lan', displayTitle: 'Chuyên viên nhân sự', role: 'member', dept: 'HCNS' },
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
  out.demo = true;
  return out;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma).then(result => { console.log(JSON.stringify({ level: 'info', msg: 'seed_done', ...result })); return prisma.$disconnect(); })
    .catch(async error => { console.error(error.message); await prisma.$disconnect(); process.exit(1); });
}
module.exports = { seed };
