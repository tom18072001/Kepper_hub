// Dữ liệu TRÌNH DIỄN đầy đủ (dữ liệu GIẢ — không dùng dữ liệu thật, Data Protection Gate) để thử hết tính năng:
// duyệt nhiều cấp đang chờ ở từng cấp + quy tắc tự động, chia làn theo người, chu kỳ, việc lặp lại, yêu cầu liên phòng ban,
// nhãn riêng dự án, checklist, bình luận, lịch sử hoàn thành 3 tháng (cho KPI), ghi chú cá nhân, thùng rác.
// Chạy: npm run seed:showcase   (sau khi đã chạy seed thường với SEED_DEMO=true). Chạy lại không tạo trùng.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { grantInitialPermissions } = require('./lib/permissions');
const { DEFAULT_PASSWORD } = require('./lib/passwords');
const { DEFAULT_STATES } = require('./routes/projects');
const { nextOccurrence } = require('./services/recurring');

const DAY = 86_400_000;
const now = new Date();
const daysFromNow = n => new Date(now.getTime() + n * DAY);
const EXTRA_USERS = [
  { username: 'tp.hcns', fullName: 'Bùi Thanh Hương', displayTitle: 'Trưởng phòng Hành chính – Nhân sự', role: 'manager', dept: 'HCNS' },
  { username: 'nv.kinhdoanh3', fullName: 'Trịnh Quốc Bảo', displayTitle: 'Chuyên viên kinh doanh', role: 'member', dept: 'KD' },
  { username: 'nv.kythuat2', fullName: 'Lý Hoàng Nam', displayTitle: 'Kỹ thuật viên', role: 'member', dept: 'KT' },
  { username: 'pgd', fullName: 'Đặng Thị Phó', displayTitle: 'Phó Giám đốc', role: 'director', dept: 'BGD' },
];

async function showcase(prisma) {
  // Máy đã bỏ thiết kế mẫu cũ (npm run tidy:demo): chỉ bổ sung phần bộ máy Trung tâm.
  if (!(await prisma.department.findFirst({ where: { code: 'KD', isActive: true } })) && await prisma.department.findFirst({ where: { code: 'VP' } }))
    return { skipped: true, centre: await centreShowcase(prisma) };
  if (await prisma.project.findUnique({ where: { key: 'TK' } })) return { skipped: true, register: await registerShowcase(prisma), centre: await centreShowcase(prisma) };
  const root = await prisma.user.findFirst({ where: { isRootAdmin: true } });
  const dept = Object.fromEntries((await prisma.department.findMany()).map(d => [d.code, d]));
  if (!dept.KD || !dept.HCNS || !dept.KT) throw new Error('Cần chạy seed thường với SEED_DEMO=true trước');
  for (const u of EXTRA_USERS) {
    if (await prisma.user.findUnique({ where: { username: u.username } })) continue;
    await prisma.$transaction(async tx => {
      const created = await tx.user.create({ data: { username: u.username, fullName: u.fullName, displayTitle: u.displayTitle, role: u.role, departmentId: dept[u.dept].id, passwordHash: bcrypt.hashSync(DEFAULT_PASSWORD, 10), mustChangePw: true } });
      await grantInitialPermissions(tx, created, root.id);
    });
  }
  const U = Object.fromEntries((await prisma.user.findMany()).map(u => [u.username, u]));
  const globalLabel = async name => prisma.label.findFirst({ where: { name, projectId: null } });

  // ---- Tạo một dự án kèm việc ----
  async function project({ key, name, deptCode, lead, members, steps = [], defaultApprovalLevels = null, intakeEnabled = false, labels = [], deletedDaysAgo = null }) {
    const p = await prisma.project.create({ data: { key, name, departmentId: dept[deptCode].id, leadId: U[lead].id, createdById: U[lead].id, intakeEnabled, defaultApprovalLevels,
      description: `Dự án mẫu để trình diễn (${name}).`, deletedAt: deletedDaysAgo != null ? daysFromNow(-deletedDaysAgo) : null, deletedById: deletedDaysAgo != null ? U[lead].id : null,
      states: { create: DEFAULT_STATES.map((s, position) => ({ ...s, position })) },
      members: { create: members.map(([username, role]) => ({ userId: U[username].id, role })) },
      approvalSteps: { create: steps.map((s, i) => ({ level: i + 1, name: s.name, approverType: s.type, approverUserId: s.user ? U[s.user].id : null })) } }, include: { states: true, approvalSteps: true } });
    const L = {};
    for (const l of labels) L[l.name] = await prisma.label.create({ data: { ...l, projectId: p.id, createdById: U[lead].id } });
    for (const n of ['Khách hàng', 'Nội bộ', 'Gấp']) L[n] = L[n] || await globalLabel(n);
    return { ...p, L, n: 0, state: c => p.states.find(s => s.category === c) };
  }

  async function item(p, it) {
    p.n++;
    const state = p.state(it.cat);
    const due = it.due == null ? null : daysFromNow(it.due);
    const started = ['STARTED', 'REVIEW', 'COMPLETED'].includes(it.cat) ? daysFromNow(-(it.startedAgo ?? 4)) : null;
    const completed = it.cat === 'COMPLETED' ? (it.doneAt != null ? daysFromNow(it.doneAt) : daysFromNow(-1)) : null;
    const reporter = U[it.by || p.lead || 'tp.kinhdoanh'];
    const row = await prisma.workItem.create({ data: {
      projectId: p.id, number: p.n, title: it.title, descriptionHtml: it.desc ? `<p>${it.desc}</p>` : '', descriptionText: it.desc || '',
      stateId: state.id, priority: it.pri || 'MEDIUM', reporterId: reporter.id, dueDate: due, startDate: due ? new Date(due.getTime() - (it.span ?? 5) * DAY) : null,
      position: p.n * 1024, startedAt: started, completedAt: completed, cycleId: it.cycle ?? null, approvalLevels: it.levels ?? null, parentId: it.parent ?? null,
      archivedAt: it.deletedAgo != null ? daysFromNow(-it.deletedAgo) : null, deletedById: it.deletedAgo != null ? reporter.id : null, estimate: it.est ?? null,
      assignees: { create: (it.to || []).map(u => ({ userId: U[u].id })) },
      labels: { create: (it.labels || []).map(l => ({ labelId: p.L[l].id })) },
      checklist: { create: (it.check || []).map(([title, done], i) => ({ title, done, position: i })) },
      comments: { create: (it.comments || []).map(([who, body], i) => ({ authorId: U[who].id, bodyHtml: `<p>${body}</p>`, bodyText: body, createdAt: daysFromNow(-(it.comments.length - i) * 0.3) })) },
      activities: { create: [{ actorId: reporter.id, type: 'CREATED', data: { title: it.title, source: 'SEED' }, createdAt: daysFromNow(-(it.startedAgo ?? 4) - 1) },
        ...(completed ? [{ actorId: (U[(it.to || [])[0]] || reporter).id, type: 'STATE', data: { from: 'Đang làm', to: 'Hoàn thành' }, createdAt: completed }] : [])] },
    } });
    // Việc đang chờ duyệt: tạo yêu cầu duyệt ở đúng cấp (cấp trước đã duyệt).
    if (it.cat === 'REVIEW' && it.atLevel) {
      const total = it.levels ?? p.approvalSteps.length;
      const submitter = U[(it.to || [])[0]] || reporter;
      const actions = [{ level: 0, actorId: submitter.id, decision: 'SUBMIT', createdAt: daysFromNow(-1.5) }];
      for (let lv = 1; lv < it.atLevel; lv++) actions.push({ level: lv, actorId: U[p.approverOf(lv)].id, decision: 'APPROVE', comment: 'Đồng ý, chuyển cấp tiếp.', createdAt: daysFromNow(-1) });
      if (it.rejectedBefore) actions.unshift({ level: 1, actorId: U[p.approverOf(1)].id, decision: 'REJECT', comment: it.rejectedBefore, createdAt: daysFromNow(-3) }, { level: 0, actorId: submitter.id, decision: 'SUBMIT', createdAt: daysFromNow(-3.2) });
      await prisma.approvalRequest.create({ data: { workItemId: row.id, status: 'PENDING', currentLevel: it.atLevel, totalLevels: total, fromStateId: p.state('STARTED').id, requestedById: submitter.id, createdAt: daysFromNow(-1.5), actions: { create: actions } } });
      const step = p.approvalSteps.find(s => s.level === it.atLevel);
      for (const uid of p.notifyApprover(step)) await prisma.notification.create({ data: { userId: U[uid].id, type: 'APPROVAL_REQUESTED', title: `Cần duyệt ${p.key}-${row.number} (${step.name})`, body: it.title, link: `#/projects/${p.id}?item=${row.id}` } });
    }
    if (it.cat === 'COMPLETED' && it.approved && p.approvalSteps.length) {
      const total = it.levels ?? p.approvalSteps.length;
      await prisma.approvalRequest.create({ data: { workItemId: row.id, status: 'APPROVED', currentLevel: total, totalLevels: total, requestedById: (U[(it.to || [])[0]] || reporter).id, closedAt: completed,
        actions: { create: [{ level: 0, actorId: (U[(it.to || [])[0]] || reporter).id, decision: 'SUBMIT' }, ...Array.from({ length: total }, (_, k) => ({ level: k + 1, actorId: U[p.approverOf(k + 1)].id, decision: 'APPROVE' }))] } } });
    }
    return row;
  }
  const done = async p => prisma.project.update({ where: { id: p.id }, data: { nextNumber: p.n + 1 } });

  // ================= 1. Kinh doanh: Triển khai khách hàng (duyệt 2 cấp, mặc định 1 cấp, quy tắc tự động) =================
  const tk = await project({ key: 'TK', name: 'Triển khai khách hàng doanh nghiệp', deptCode: 'KD', lead: 'tp.kinhdoanh', defaultApprovalLevels: 1,
    members: [['tp.kinhdoanh', 'OWNER'], ['nv.kinhdoanh1', 'MEMBER'], ['nv.kinhdoanh2', 'MEMBER'], ['nv.kinhdoanh3', 'MEMBER'], ['giamdoc', 'VIEWER']],
    steps: [{ name: 'Trưởng phòng duyệt', type: 'DEPARTMENT_MANAGER' }, { name: 'Giám đốc duyệt', type: 'DIRECTOR' }],
    labels: [{ name: 'Hợp đồng', color: '#b45309' }, { name: 'Báo giá', color: '#16a34a' }, { name: 'Khách VIP', color: '#db2777' }] });
  tk.lead = 'tp.kinhdoanh';
  tk.approverOf = lv => (lv === 1 ? 'tp.kinhdoanh' : 'giamdoc');
  tk.notifyApprover = step => (step.level === 1 ? ['tp.kinhdoanh'] : ['giamdoc', 'pgd']);
  await prisma.approvalRule.createMany({ data: [{ projectId: tk.id, labelId: tk.L['Hợp đồng'].id, levels: 2 }, { projectId: tk.id, priority: 'URGENT', levels: 2 }] });
  const c1 = await prisma.cycle.create({ data: { projectId: tk.id, name: 'Đợt 1 (tháng 9)', startDate: daysFromNow(-45), endDate: daysFromNow(-16), createdById: U['tp.kinhdoanh'].id } });
  const c2 = await prisma.cycle.create({ data: { projectId: tk.id, name: 'Đợt 2 (hiện tại)', startDate: daysFromNow(-15), endDate: daysFromNow(13), createdById: U['tp.kinhdoanh'].id } });
  await prisma.cycle.create({ data: { projectId: tk.id, name: 'Đợt 3 (tháng 11)', startDate: daysFromNow(14), endDate: daysFromNow(42), createdById: U['tp.kinhdoanh'].id } });
  const TKI = [
    // Đang chờ duyệt ở các cấp khác nhau
    { title: 'Ký hợp đồng triển khai với Công ty Minh Phát', cat: 'REVIEW', to: ['nv.kinhdoanh1'], labels: ['Hợp đồng', 'Khách VIP'], pri: 'HIGH', due: 2, atLevel: 2, cycle: c2.id, comments: [['nv.kinhdoanh1', 'Đã gửi bản hợp đồng cuối, khách đồng ý điều khoản thanh toán 3 đợt.'], ['tp.kinhdoanh', 'Đã duyệt cấp 1, chuyển @giamdoc ký.']] },
    { title: 'Báo giá gói bảo trì năm 2027 cho Hưng Thịnh', cat: 'REVIEW', to: ['nv.kinhdoanh2'], labels: ['Báo giá'], due: 3, atLevel: 1, cycle: c2.id, rejectedBefore: 'Thiếu bảng so sánh giá với năm ngoái.', check: [['Lập bảng giá', true], ['So sánh giá năm 2026', true], ['Gửi khách xác nhận', false]] },
    { title: 'Phụ lục hợp đồng gia hạn cho Thành Công', cat: 'REVIEW', to: ['nv.kinhdoanh3'], labels: ['Hợp đồng'], due: 1, atLevel: 1, cycle: c2.id },
    { title: 'Xử lý khiếu nại giao hàng chậm của Đại Việt', cat: 'REVIEW', to: ['nv.kinhdoanh1'], pri: 'URGENT', due: 0, atLevel: 1, cycle: c2.id, comments: [['nv.kinhdoanh1', 'Đã gọi điện xin lỗi và đề xuất giảm 5% đơn tiếp theo.']] },
    // Đang làm (chia làn theo người)
    { title: 'Khảo sát nhu cầu phần mềm kế toán của An Khang', cat: 'STARTED', to: ['nv.kinhdoanh1'], labels: ['Khách hàng'], due: 4, cycle: c2.id, est: 6, check: [['Gửi bảng câu hỏi', true], ['Họp với kế toán trưởng', false]] },
    { title: 'Chuẩn bị demo sản phẩm cho Phương Nam', cat: 'STARTED', to: ['nv.kinhdoanh2'], labels: ['Khách VIP'], pri: 'HIGH', due: 1, cycle: c2.id, startedAgo: 9 },
    { title: 'Cập nhật CRM danh sách khách hàng quý III', cat: 'STARTED', to: ['nv.kinhdoanh3'], due: -2, cycle: c2.id, startedAgo: 12 },
    { title: 'Soạn hồ sơ năng lực công ty bản 2026', cat: 'STARTED', to: ['nv.kinhdoanh2', 'nv.kinhdoanh3'], due: 6, cycle: c2.id },
    // Cần làm / tồn đọng
    { title: 'Gọi chăm sóc 20 khách hàng cũ', cat: 'UNSTARTED', to: ['nv.kinhdoanh1'], due: 7, cycle: c2.id },
    { title: 'Lên kế hoạch hội nghị khách hàng cuối năm', cat: 'UNSTARTED', to: ['nv.kinhdoanh2'], labels: ['Khách VIP'], pri: 'HIGH', due: 20 },
    { title: 'Báo giá thiết bị mạng cho Sao Mai', cat: 'UNSTARTED', to: ['nv.kinhdoanh3'], labels: ['Báo giá'], due: 5, levels: 0 },
    { title: 'Tìm hiểu đối thủ cạnh tranh mảng giáo dục', cat: 'BACKLOG', to: [], pri: 'LOW' },
    { title: 'Viết bài giới thiệu sản phẩm mới', cat: 'BACKLOG', to: [], pri: 'NONE' },
    // Lịch sử hoàn thành (KPI): đúng hạn và trễ hạn trong 3 tháng
    ...[[-80, -82, 'nv.kinhdoanh1'], [-70, -68, 'nv.kinhdoanh2'], [-60, -61, 'nv.kinhdoanh3'], [-50, -47, 'nv.kinhdoanh1'], [-40, -41, 'nv.kinhdoanh2'],
      [-30, -30, 'nv.kinhdoanh1'], [-25, -22, 'nv.kinhdoanh3'], [-18, -19, 'nv.kinhdoanh2'], [-12, -13, 'nv.kinhdoanh1'], [-8, -6, 'nv.kinhdoanh3'],
      [-5, -5, 'nv.kinhdoanh2'], [-3, -4, 'nv.kinhdoanh1'], [-2, -1, 'nv.kinhdoanh2']].map(([due, doneAt, who], i) => ({
      title: ['Gửi báo giá', 'Hoàn thiện hợp đồng', 'Thu hồi công nợ', 'Gặp khách hàng', 'Báo cáo doanh số tuần'][i % 5] + ` #${i + 1}`, cat: 'COMPLETED', to: [who], due, doneAt, startedAgo: -due + 6,
      labels: i % 4 === 0 ? ['Hợp đồng'] : [], approved: true, levels: i % 4 === 0 ? 2 : 1, cycle: due < -16 ? c1.id : c2.id })),
    // Thùng rác
    { title: 'Bản nháp báo giá cũ (đã thay thế)', cat: 'UNSTARTED', to: ['nv.kinhdoanh2'], deletedAgo: 2 },
  ];
  for (const it of TKI) await item(tk, it);
  await done(tk);
  const rr = { projectId: tk.id, createdById: U['tp.kinhdoanh'].id };
  for (const r of [
    { title: 'Báo cáo doanh số tuần', frequency: 'WEEKLY', weekday: 5, dueOffsetDays: 1, assigneeIds: [U['nv.kinhdoanh1'].id, U['nv.kinhdoanh2'].id] },
    { title: 'Cập nhật cơ hội bán hàng trên CRM', frequency: 'DAILY', workdaysOnly: true, dueOffsetDays: 0, assigneeIds: [U['nv.kinhdoanh3'].id] },
    { title: 'Đối chiếu công nợ khách hàng', frequency: 'MONTHLY', monthDay: 0, dueOffsetDays: 3, assigneeIds: [U['nv.kinhdoanh2'].id] },
  ]) await prisma.recurringRule.create({ data: { ...rr, interval: 1, ...r, nextRunAt: nextOccurrence({ interval: 1, ...r }, now) } });

  // ================= 2. HCNS: Tuyển dụng (1 cấp, trưởng phòng HCNS duyệt) =================
  const td = await project({ key: 'TD', name: 'Tuyển dụng Quý IV', deptCode: 'HCNS', lead: 'tp.hcns',
    members: [['tp.hcns', 'OWNER'], ['nv.hcns', 'MEMBER']], steps: [{ name: 'Trưởng phòng HCNS duyệt', type: 'DEPARTMENT_MANAGER' }],
    labels: [{ name: 'Phỏng vấn', color: '#0891b2' }, { name: 'Onboarding', color: '#65a30d' }] });
  td.lead = 'tp.hcns'; td.approverOf = () => 'tp.hcns'; td.notifyApprover = () => ['tp.hcns'];
  const tdParent = await item(td, { title: 'Tuyển 2 kỹ sư phần mềm', cat: 'STARTED', to: ['nv.hcns'], pri: 'HIGH', due: 20, check: [['Đăng tin tuyển dụng', true], ['Lọc hồ sơ', true], ['Phỏng vấn vòng 1', false], ['Phỏng vấn vòng 2', false]] });
  for (const it of [
    { title: 'Phỏng vấn ứng viên vòng 1 (5 người)', cat: 'UNSTARTED', to: ['nv.hcns'], labels: ['Phỏng vấn'], due: 4, parent: tdParent.id },
    { title: 'Kế hoạch đào tạo hội nhập tháng 11', cat: 'REVIEW', to: ['nv.hcns'], labels: ['Onboarding'], due: 5, atLevel: 1 },
    { title: 'Cập nhật quy chế lương thưởng (bản nháp)', cat: 'BACKLOG', to: [], pri: 'LOW' },
    { title: 'Chuẩn bị hợp đồng lao động cho nhân viên mới', cat: 'COMPLETED', to: ['nv.hcns'], due: -6, doneAt: -7, approved: true },
    { title: 'Tổ chức sinh nhật nhân viên quý IV', cat: 'UNSTARTED', to: ['nv.hcns'], due: 14 },
  ]) await item(td, it);
  await done(td);

  // ================= 3. Kỹ thuật: Vận hành CNTT (nhận yêu cầu liên phòng ban, không cần duyệt) =================
  const ht = await project({ key: 'HT', name: 'Vận hành CNTT', deptCode: 'KT', lead: 'tp.kythuat', intakeEnabled: true,
    members: [['tp.kythuat', 'OWNER'], ['nv.kythuat', 'MEMBER'], ['nv.kythuat2', 'MEMBER']], labels: [{ name: 'Sự cố', color: '#dc2626' }, { name: 'Bảo trì', color: '#475569' }] });
  ht.lead = 'tp.kythuat';
  const accepted = await item(ht, { title: 'Cài phần mềm kế toán cho phòng HCNS', cat: 'STARTED', to: ['nv.kythuat2'], due: 2, by: 'tp.kythuat' });
  for (const it of [
    { title: 'Máy in tầng 3 báo kẹt giấy liên tục', cat: 'UNSTARTED', to: ['nv.kythuat'], labels: ['Sự cố'], pri: 'URGENT', due: 0 },
    { title: 'Bảo trì định kỳ điều hoà phòng máy chủ', cat: 'UNSTARTED', to: ['nv.kythuat2'], labels: ['Bảo trì'], due: 9 },
    { title: 'Gia hạn tên miền công ty', cat: 'COMPLETED', to: ['nv.kythuat'], due: -10, doneAt: -12 },
    { title: 'Thay ổ cứng máy chủ dự phòng', cat: 'COMPLETED', to: ['nv.kythuat2'], due: -20, doneAt: -17, labels: ['Bảo trì'] },
    { title: 'Cấu hình Wi-Fi khách cho phòng họp lớn', cat: 'STARTED', to: ['nv.kythuat'], due: 3 },
  ]) await item(ht, it);
  await done(ht);
  const req = (who, title, extra = {}) => ({ projectId: ht.id, requesterId: U[who].id, title, descriptionHtml: `<p>${title}.</p>`, descriptionText: title + '.', priority: 'MEDIUM', ...extra });
  await prisma.intakeRequest.createMany({ data: [
    req('nv.hcns', 'Cấp laptop cho 2 nhân viên mới tuần sau', { priority: 'HIGH', dueDate: daysFromNow(5) }),
    req('nv.kinhdoanh1', 'Mở quyền truy cập CRM cho nhân viên Bảo'),
    req('tp.kinhdoanh', 'Hỗ trợ máy chiếu cho buổi demo khách hàng thứ 5', { dueDate: daysFromNow(3) }),
  ] });
  await prisma.intakeRequest.create({ data: { ...req('tp.hcns', 'Cài phần mềm kế toán cho phòng HCNS'), status: 'ACCEPTED', workItemId: accepted.id, decidedById: U['tp.kythuat'].id, decidedAt: daysFromNow(-1) } });
  await prisma.recurringRule.create({ data: { projectId: ht.id, createdById: U['tp.kythuat'].id, title: 'Kiểm tra bản sao lưu hằng tuần', frequency: 'WEEKLY', interval: 1, weekday: 1, dueOffsetDays: 1, assigneeIds: [U['nv.kythuat'].id], nextRunAt: nextOccurrence({ frequency: 'WEEKLY', interval: 1, weekday: 1 }, now) } });

  // ================= 4. Dự án đã xoá (thùng rác — khôi phục được) =================
  const old = await project({ key: 'SK25', name: 'Sự kiện tri ân khách hàng 2025', deptCode: 'KD', lead: 'tp.kinhdoanh', members: [['tp.kinhdoanh', 'OWNER']], deletedDaysAgo: 3 });
  old.lead = 'tp.kinhdoanh';
  await item(old, { title: 'Đặt nhà hàng tiệc tri ân', cat: 'COMPLETED', to: ['tp.kinhdoanh'], due: -300, doneAt: -301 });
  await done(old);

  // ================= Ghi chú cá nhân (chỉ chủ sở hữu thấy) =================
  const notes = {
    'tp.kinhdoanh': [['Họp 1-1 với Bảo về mục tiêu quý', 'Hỏi về khó khăn khi tiếp cận khách mảng giáo dục.', 2, true], ['Xem lại ngân sách marketing tháng 11', '', 5, false], ['Gửi lời cảm ơn khách Minh Phát sau khi ký', '', null, false]],
    'nv.kinhdoanh1': [['Gọi lại anh Nam bên An Khang', 'Hỏi lịch họp với kế toán trưởng.', 1, true], ['Chuẩn bị slide giao ban thứ 2', '', 3, false], ['Học thêm tính năng báo cáo CRM', '', null, false]],
    giamdoc: [['Xem báo cáo KPI tháng của các phòng', '', 1, true], ['Duyệt hợp đồng Minh Phát', '', 0, false]],
  };
  for (const [u, list] of Object.entries(notes)) for (const [i, [title, body, due, pinned]] of list.entries())
    await prisma.personalNote.create({ data: { userId: U[u].id, title, body, pinned, dueDate: due == null ? null : daysFromNow(due), position: i * 1024 } });
  await prisma.personalNote.create({ data: { userId: U['nv.kinhdoanh1'].id, title: 'Nộp phiếu đề nghị tạm ứng công tác', done: true, doneAt: daysFromNow(-1), position: 9000 } });

  const register = await registerShowcase(prisma);
  const centre = await centreShowcase(prisma);
  return { projects: ['TK', 'TD', 'HT', 'SK25 (thùng rác)'], users: EXTRA_USERS.map(u => u.username), register, centre };
}

// ================= Sổ giao việc của Ban Giám đốc (theo mẫu "Sổ theo dõi, kiểm soát giao việc") — TÊN GIẢ =================
async function registerShowcase(prisma) {
  if (await prisma.project.findUnique({ where: { key: 'GV' } })) return 'GV đã có';
  const dept = Object.fromEntries((await prisma.department.findMany()).map(d => [d.code, d]));
  if (!dept.BGD) return 'Thiếu dữ liệu mẫu cơ bản';
  const U = Object.fromEntries((await prisma.user.findMany()).map(u => [u.username, u]));
  const need = ['giamdoc', 'tp.kinhdoanh', 'tp.kythuat', 'nv.kinhdoanh1', 'nv.kinhdoanh2', 'nv.kythuat', 'nv.hcns'];
  if (need.some(u => !U[u])) return 'Thiếu tài khoản mẫu';
  const pgd = U.pgd || U.giamdoc, tphc = U['tp.hcns'] || U['tp.kythuat'];
  const p = await prisma.project.create({ data: { key: 'GV', name: 'Sổ giao việc Ban Giám đốc', departmentId: dept.BGD.id, leadId: U.giamdoc.id, createdById: U.giamdoc.id, visibility: 'PUBLIC',
    description: 'Sổ theo dõi, kiểm soát giao việc nội bộ (dữ liệu mẫu, tên giả).', defaultApprovalLevels: 0,
    states: { create: DEFAULT_STATES.map((s, position) => ({ ...s, position, wipLimit: null })) },
    members: { create: [[U.giamdoc, 'OWNER'], [pgd, 'OWNER'], [U['tp.kinhdoanh'], 'MEMBER'], [U['tp.kythuat'], 'MEMBER'], [tphc, 'MEMBER'], [U['nv.kinhdoanh1'], 'MEMBER'], [U['nv.kinhdoanh2'], 'MEMBER'], [U['nv.kythuat'], 'MEMBER'], [U['nv.hcns'], 'MEMBER']].filter(([u], i, a) => a.findIndex(([x]) => x.id === u.id) === i).map(([u, role]) => ({ userId: u.id, role })) } },
    include: { states: true } });
  const st = c => p.states.find(s => s.category === c);
  const plan = await prisma.plan.create({ data: { projectId: p.id, name: 'KẾ HOẠCH CÔNG TÁC NĂM 2027 (mẫu)', year: 2027, createdById: U.giamdoc.id } });
  let n = 0;
  const make = async (it, parentId = null) => {
    n++;
    const cat = it.done != null ? 'COMPLETED' : it.progress ? 'STARTED' : 'UNSTARTED';
    const row = await prisma.workItem.create({ data: {
      projectId: p.id, number: n, title: it.title, stateId: st(cat).id, priority: it.pri || 'HIGH', reporterId: pgd.id, position: n * 1024, parentId,
      assignedById: (it.by || pgd).id, assignedAt: daysFromNow(it.given ?? -39), source: it.source || 'Họp giao ban', dueDate: it.due != null ? daysFromNow(it.due) : null,
      progress: it.done != null ? 100 : it.progress || 0, completedAt: it.done != null ? daysFromNow(it.done) : null, startedAt: cat !== 'UNSTARTED' ? daysFromNow((it.given ?? -39) + 2) : null,
      deliverable: it.out || '', outputs: (it.docs || []).map(d => '• ' + d).join('\n'), resultNote: it.result || '', review: it.review || '', reviewedById: it.review ? pgd.id : null, reviewedAt: it.review ? daysFromNow(-2) : null,
      coordinatorText: it.coord || '', note: it.note || '', planId: it.plan ? plan.id : null, planCode: it.plan?.code || null, planSection: it.plan?.section || null,
      budget: it.plan?.budget ?? null, period: it.plan?.period || null, location: it.plan?.location || null, supervisorText: it.plan ? 'Lãnh đạo Trung tâm' : null,
      assignees: { create: (it.lead || []).map(u => ({ userId: u.id })) }, supporters: { create: (it.support || []).map(u => ({ userId: u.id })) },
      activities: { create: { actorId: pgd.id, type: 'CREATED', data: { title: it.title, source: 'SEED' } } },
    } });
    for (const c of it.children || []) await make({ lead: it.lead, by: it.by, source: it.source, pri: it.pri, given: it.given, ...c }, row.id);
    return row;
  };
  const A = U['tp.kinhdoanh'], B = U['tp.kythuat'], C = tphc, a1 = U['nv.kinhdoanh1'], a2 = U['nv.kinhdoanh2'], b1 = U['nv.kythuat'], c1 = U['nv.hcns'];
  const G = [
    { title: 'HỘI THI TIN HỌC TRẺ KHU VỰC 2026 (nhóm việc)', lead: [A], coord: 'Văn phòng; Phòng Kỹ thuật', due: -6, out: 'Nhóm việc gồm 05 việc nhánh', note: 'Hoàn thiện toàn bộ phương án tổ chức; trình Giám đốc',
      docs: ['112-TTr ngày 16/9/2026: Tờ trình điều chỉnh thời gian tổ chức Vòng Chung kết', '118-CV ngày 23/9/2026: Công văn phối hợp tổ chức Hội thi'], children: [
      { title: 'HT.1 – Lập Timeline tổng thể và phân công nhiệm vụ chi tiết', support: [a1], due: -16, out: 'Timeline tổng thể; bảng phân công nhiệm vụ', progress: 60 },
      { title: 'HT.2 – Khảo sát địa điểm tổ chức', support: [a1], due: -9, out: 'Báo cáo khảo sát; đề xuất địa điểm', done: -12, review: 'Đạt yêu cầu, đề xuất địa điểm hợp lý.' },
      { title: 'HT.3 – Xây dựng Ban Tổ chức, Ban Ra đề, Ban Chấm thi, Ban Coi thi', support: [a2], due: -13, out: 'Dự thảo Quyết định thành lập các Ban', docs: ['120-TTr ngày 17/9/2026: Tờ trình ký Quyết định thành lập Ban Tổ chức'], done: -10, result: 'Chậm 3 ngày do chờ danh sách giám khảo từ đơn vị phối hợp.' },
      { title: 'HT.4 – Công tác truyền thông', support: [a2], due: 2, out: 'Kế hoạch truyền thông; dự thảo thông cáo báo chí', progress: 40 },
      { title: 'HT.5 – Xây dựng dự toán kinh phí', support: [a1], due: -31, out: 'Dự toán kinh phí tổ chức', progress: 80, result: 'Đang chờ báo giá thiết bị.' },
    ] },
    { title: 'GIẢI THƯỞNG SÁNG TẠO TRẺ 2026 (nhóm việc)', lead: [B], coord: 'Văn phòng; Phòng Kinh doanh', due: 76, out: 'Nhóm việc gồm 04 việc nhánh', children: [
      { title: 'ST.1 – Tổng hợp, kiểm tra, thẩm định hồ sơ', support: [b1], due: -19, done: -28, out: 'Bảng tổng hợp hồ sơ đã thẩm định', review: 'Tốt.' },
      { title: 'ST.2 – Ban hành quyết định thành lập Hội đồng, Ban Thư ký', support: [b1], due: -26, done: -28, out: 'Quyết định thành lập Hội đồng; Ban Thư ký', docs: ['QĐ số 95 ngày 15/9/2026: Quyết định thành lập Hội đồng giải thưởng'] },
      { title: 'ST.3 – Xây dựng tiến độ chi tiết đến khi trao giải và quyết toán', support: [b1], due: -16, out: 'Bảng tiến độ chi tiết' },
      { title: 'ST.4 – Triển khai truyền thông theo kế hoạch', support: [b1, c1], due: 76, pri: 'MEDIUM', out: 'Sản phẩm truyền thông theo kế hoạch đã duyệt', progress: 30 },
    ] },
    { title: 'Rà soát hệ thống quy chế, quy định nội bộ; phân loại văn bản tiếp tục thực hiện / sửa đổi / thay thế; báo cáo Giám đốc', lead: [C], coord: 'Các phòng', due: -16, out: 'Danh mục quy chế đã phân loại kèm đề xuất tiến độ xử lý' },
    { title: 'Cải tạo, sửa chữa cơ sở vật chất tầng 1', lead: [C], coord: 'Đơn vị thi công', due: 2, out: 'Hạng mục cải tạo hoàn thành, nghiệm thu', progress: 70, docs: ['QĐ số 46 ngày 07/9/2026: Phê duyệt kế hoạch lựa chọn nhà thầu cải tạo'] },
    { title: 'Bảng theo dõi nhiệm vụ của đơn vị từ tháng 9 đến hết năm, dùng tại giao ban', lead: [C], support: [A, B], due: -16, pri: 'URGENT', out: 'Bảng theo dõi nhiệm vụ chung (đủ 09 trường thông tin)', done: -15 },
    { title: 'Bảng tiến độ thanh, quyết toán từng chương trình năm 2026', lead: [C], support: [c1], due: 9, out: 'Bảng tiến độ thanh quyết toán; báo cáo cảnh báo nội dung có nguy cơ chậm', progress: 20, source: 'Chỉ đạo của lãnh đạo', by: U.giamdoc },
    { title: 'Phương án tiếp nhận và khai thác không gian tầng 7', lead: [C], coord: 'Các phòng', due: 14, pri: 'MEDIUM', out: 'Phương án tiếp nhận và khai thác', source: 'Phát sinh', by: U.giamdoc },
    // Từ Kế hoạch năm 2027 (mẫu)
    { title: 'Hội thi Tin học trẻ năm 2027 (Vòng Khu vực và Vòng Chung kết)', lead: [A], coord: 'Văn phòng, Phòng Kỹ thuật', source: 'Kế hoạch năm', given: -2, due: 318, pri: 'MEDIUM', out: 'Tổ chức Hội thi đổi mới; 2.000 - 2.200 thí sinh dự thi',
      plan: { code: '2.2', section: '2. Tổ chức các hội thi, cuộc thi khoa học, công nghệ', budget: 1400, period: 'Quý II, III (trước 31/8/2027)', location: '03 miền Bắc, Trung, Nam' }, children: [
      { title: '2.2.1 – Vòng Khu vực (01 ngày, tại 03 miền)', due: 287, out: '' }, { title: '2.2.2 – Vòng Chung kết, Lễ tổng kết, trao giải', due: 318 } ] },
    { title: 'Xây dựng chương trình công tác Quý; chế độ báo cáo định kỳ', lead: [C], source: 'Kế hoạch năm', given: -2, due: 160, pri: 'MEDIUM', out: 'Chương trình công tác Quý; báo cáo định kỳ đúng hạn',
      plan: { code: '6.1', section: '6. Công việc khác (văn phòng, tổng hợp, tài chính)', period: 'Trước ngày 25 tháng cuối mỗi Quý' }, children: [
      { title: '6.1.1 – Quý I', due: 160 }, { title: '6.1.2 – Quý II', due: 251 } ] },
  ];
  for (const g of G) await make(g);
  await prisma.project.update({ where: { id: p.id }, data: { nextNumber: n + 1 } });
  return `GV: ${n} việc`;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  showcase(prisma).then(r => { console.log(JSON.stringify({ level: 'info', msg: 'showcase_done', ...r })); return prisma.$disconnect(); })
    .catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
}

// ================= GĐ3a: bộ máy Trung tâm + Sổ giao việc Trung tâm (điều hành hai chiều) — TÊN GIẢ =================
const CENTRE_DEPTS = [{ code: 'VP', name: 'Văn phòng' }, { code: 'KHCN', name: 'Phòng Khoa học Công nghệ' }, { code: 'TNT', name: 'Phòng Tài năng trẻ' }];
const CENTRE_USERS = [
  { username: 'cvp', fullName: 'Hồ Minh Chánh', displayTitle: 'Chánh Văn phòng', role: 'manager', dept: 'VP' },
  { username: 'pcvp', fullName: 'Tạ Thu Phương', displayTitle: 'Phó Chánh Văn phòng', role: 'deputy', dept: 'VP' },
  { username: 'cv.vp1', fullName: 'Lương Gia Hân', displayTitle: 'Chuyên viên Văn phòng', role: 'member', dept: 'VP' },
  { username: 'tp.khcn', fullName: 'Phan Đức Khoa', displayTitle: 'Trưởng phòng Khoa học Công nghệ', role: 'manager', dept: 'KHCN' },
  { username: 'pp.khcn', fullName: 'Vương Bích Ngọc', displayTitle: 'Phó trưởng phòng Khoa học Công nghệ', role: 'deputy', dept: 'KHCN' },
  { username: 'cv.khcn1', fullName: 'Đinh Quang Huy', displayTitle: 'Chuyên viên', role: 'member', dept: 'KHCN' },
  { username: 'cv.khcn2', fullName: 'Mai Anh Thư', displayTitle: 'Chuyên viên', role: 'member', dept: 'KHCN' },
  { username: 'tp.tnt', fullName: 'Kiều Văn Tài', displayTitle: 'Trưởng phòng Tài năng trẻ', role: 'manager', dept: 'TNT' },
  { username: 'pp.tnt', fullName: 'Doãn Hải Yến', displayTitle: 'Phó trưởng phòng Tài năng trẻ', role: 'deputy', dept: 'TNT' },
  { username: 'cv.tnt1', fullName: 'Châu Ngọc Lan', displayTitle: 'Chuyên viên', role: 'member', dept: 'TNT' },
  // Ban Giám đốc gồm Giám đốc và các Phó Giám đốc: Phó Giám đốc thứ hai phụ trách Phòng Tài năng trẻ.
  { username: 'pgd2', fullName: 'Nghiêm Thế Bảo', displayTitle: 'Phó Giám đốc', role: 'director', dept: 'BGD' },
];
// Bổ sung cán bộ còn thiếu của bộ máy (máy đã có dữ liệu): cùng luồng tạo tài khoản + quyền khởi tạo như khi tạo mới.
// PGĐ thứ hai vừa tạo thì nhận phụ trách Phòng Tài năng trẻ (nếu phòng đang do PGĐ thứ nhất phụ trách). Trả về tên đăng nhập đã tạo.
async function ensureCentreStaff(prisma) {
  const root = await prisma.user.findFirst({ where: { isRootAdmin: true } });
  const D = Object.fromEntries((await prisma.department.findMany({ where: { isActive: true } })).map(d => [d.code, d]));
  const created = [];
  for (const u of CENTRE_USERS) {
    if (!D[u.dept] || await prisma.user.findUnique({ where: { username: u.username } })) continue;
    await prisma.$transaction(async tx => {
      const row = await tx.user.create({ data: { username: u.username, fullName: u.fullName, displayTitle: u.displayTitle, role: u.role, departmentId: D[u.dept].id, passwordHash: bcrypt.hashSync(DEFAULT_PASSWORD, 10), mustChangePw: true } });
      await grantInitialPermissions(tx, row, root?.id ?? null);
    });
    created.push(u.username);
  }
  if (created.includes('pgd2') && D.TNT) {
    const [pgd, pgd2] = await Promise.all(['pgd', 'pgd2'].map(username => prisma.user.findUnique({ where: { username } })));
    if (pgd2 && (!D.TNT.supervisorId || D.TNT.supervisorId === pgd?.id)) await prisma.department.update({ where: { id: D.TNT.id }, data: { supervisorId: pgd2.id } });
  }
  // Mọi Giám đốc / Phó Giám đốc đang hoạt động là chủ sổ giao việc Trung tâm (giao việc, xếp loại).
  const tt = await prisma.project.findUnique({ where: { key: 'TT' } });
  if (tt && D.BGD) for (const d of await prisma.user.findMany({ where: { departmentId: D.BGD.id, role: 'director', isActive: true } }))
    await prisma.projectMember.upsert({ where: { projectId_userId: { projectId: tt.id, userId: d.id } }, update: { role: 'OWNER' }, create: { projectId: tt.id, userId: d.id, role: 'OWNER' } });
  return created;
}
// Văn phòng (Chánh VP, chuyên viên VP) là thành viên sổ TT: nhập chỉ đạo thay mặt Ban Giám đốc, tổng hợp và xuất sổ toàn Trung tâm.
async function centreOfficeAccess(prisma) {
  const tt = await prisma.project.findUnique({ where: { key: 'TT' } });
  if (!tt) return;
  for (const username of ['cvp', 'cv.vp1']) {
    const u = await prisma.user.findUnique({ where: { username } });
    if (!u) continue;
    await prisma.projectMember.upsert({ where: { projectId_userId: { projectId: tt.id, userId: u.id } }, update: {}, create: { projectId: tt.id, userId: u.id, role: 'MEMBER' } });
    for (const [permissionKey, action] of [['reports.summary', 'VIEW'], ['reports.export', 'OPERATE']])
      await prisma.userPermission.upsert({ where: { userId_permissionKey_action: { userId: u.id, permissionKey, action } }, update: { scope: 'SYSTEM' }, create: { userId: u.id, permissionKey, action, scope: 'SYSTEM', source: 'CUSTOM' } });
  }
}
// Tạo một việc trong Sổ giao việc Trung tâm (giao về phòng, tiếp nhận, báo cáo, gia hạn, phiếu trình…). Dùng cho dữ liệu mẫu.
function centreMaker(prisma, p, D, U, gd, start = 0) {
  const st = c => p.states.find(x => x.category === c);
  let n = start;
  const make = async it => {
    n++;
    const cat = it.cat || (it.lead ? 'STARTED' : 'UNSTARTED');
    const due = it.due != null ? daysFromNow(it.due) : null;
    const row = await prisma.workItem.create({ data: {
      projectId: p.id, number: n, title: it.title, stateId: st(cat).id, priority: it.pri || 'HIGH', reporterId: (it.by || gd).id, position: n * 1024, parentId: it.parentId || null,
      assignedById: (it.by || gd).id, assignedAt: daysFromNow(it.given ?? -10), source: it.source || 'Chỉ đạo của lãnh đạo', taskType: it.type || 'ADHOC',
      leadDepartmentId: it.dept ? D[it.dept].id : null, dispatchStatus: it.parentId ? null : it.dept ? (it.lead ? 'ACCEPTED' : 'PENDING') : null,
      dispatchedAt: it.dept && !it.parentId ? daysFromNow(it.given ?? -10) : null, acceptedAt: it.lead && !it.parentId ? daysFromNow((it.given ?? -10) + 1) : null, acceptedById: it.lead && it.dept && !it.parentId ? U[it.acceptedBy || ({ KHCN: 'tp.khcn', TNT: 'tp.tnt', VP: 'cvp' })[it.dept]].id : null,
      dueDate: due, originalDueDate: it.originalDue != null ? daysFromNow(it.originalDue) : due, progress: cat === 'COMPLETED' ? 100 : it.progress || 0,
      startedAt: ['STARTED', 'REVIEW', 'COMPLETED'].includes(cat) ? daysFromNow((it.given ?? -10) + 1) : null, completedAt: cat === 'COMPLETED' ? daysFromNow(it.doneAt ?? -1) : null,
      rating: it.rating || null, ratedById: it.rating ? (it.by || gd).id : null, ratedAt: it.rating ? daysFromNow(it.doneAt ?? -1) : null,
      review: it.review || '', reviewedById: it.review ? (it.by || gd).id : null, reviewedAt: it.review ? daysFromNow(it.doneAt ?? -1) : null,
      deliverable: it.out || '', planCode: it.planCode || null, planSection: it.planSection || null, planId: it.planId || null,
      budget: it.budget ?? null, period: it.period || null, location: it.location || null, coordinatorText: it.coord || '', note: it.note || '',
      assignees: { create: (it.lead || []).map(u => ({ userId: U[u].id })) }, supporters: { create: (it.support || []).map(u => ({ userId: U[u].id })) },
      supportDepartments: { create: (it.supportDepts || []).map(c => ({ departmentId: D[c].id })) },
      documents: { create: (it.docs || []).map(d => ({ ...d, createdById: (it.by || gd).id })) },
      progressReports: { create: (it.reports || []).map(r => ({ authorId: U[r.by].id, progress: r.progress, content: r.content, difficulties: r.diff || '', proposals: r.prop || '', answer: r.answer || null, answeredById: r.answer ? (it.by || gd).id : null, answeredAt: r.answer ? daysFromNow(-1) : null, createdAt: daysFromNow(r.at) })) },
      extensions: { create: (it.ext || []).map(x => ({ requestedById: U[x.by].id, oldDue: daysFromNow(x.old), newDue: daysFromNow(x.new), reason: x.reason, status: x.status || 'PENDING', decidedById: x.status ? (it.by || gd).id : null, decidedAt: x.status ? daysFromNow(-2) : null, decisionNote: x.note || null })) },
      activities: { create: { actorId: (it.by || gd).id, type: 'CREATED', data: { title: it.title, source: 'SEED' } } },
    } });
    // Đang chờ duyệt: cấp 1 (lãnh đạo phòng) hoặc cấp 2 (Ban Giám đốc).
    if (it.waitLevel) await prisma.approvalRequest.create({ data: { workItemId: row.id, totalLevels: 2, currentLevel: it.waitLevel, fromStateId: st('STARTED').id, requestedById: U[it.lead[0]].id,
      actions: { create: [{ level: 0, actorId: U[it.lead[0]].id, decision: 'SUBMIT', comment: it.submitNote || null }, ...(it.waitLevel === 2 ? [{ level: 1, actorId: U[({ KHCN: 'tp.khcn', TNT: 'tp.tnt', VP: 'cvp' })[it.dept]].id, decision: 'APPROVE', comment: 'Đạt yêu cầu, kính trình Ban Giám đốc' }] : [])] } } });
    if (cat === 'COMPLETED' && it.rating) await prisma.approvalRequest.create({ data: { workItemId: row.id, totalLevels: 2, currentLevel: 2, status: 'APPROVED', fromStateId: st('STARTED').id, requestedById: U[it.lead[0]].id, closedAt: daysFromNow(it.doneAt ?? -1),
      actions: { create: [{ level: 0, actorId: U[it.lead[0]].id, decision: 'SUBMIT' }, { level: 1, actorId: U[({ KHCN: 'tp.khcn', TNT: 'tp.tnt', VP: 'cvp' })[it.dept]].id, decision: 'APPROVE' }, { level: 2, actorId: (it.by || gd).id, decision: 'APPROVE', comment: it.review || null }] } } });
    return row;
  };
  return { make, count: () => n };
}
async function centreShowcase(prisma) {
  if (await prisma.project.findUnique({ where: { key: 'TT' } })) {
    const added = await ensureCentreStaff(prisma);
    await centreOfficeAccess(prisma);
    const extra = await centreFinal(prisma);
    return ['TT đã có', added.length && `thêm cán bộ ${added.join(', ')}`, extra].filter(Boolean).join('; ');
  }
  const bgd = await prisma.department.findUnique({ where: { code: 'BGD' } });
  const gd = await prisma.user.findUnique({ where: { username: 'giamdoc' } });
  if (!bgd || !gd) return 'Thiếu dữ liệu mẫu cơ bản';
  const pgd = (await prisma.user.findUnique({ where: { username: 'pgd' } })) || gd;
  for (const d of CENTRE_DEPTS) if (!(await prisma.department.findUnique({ where: { code: d.code } }))) await prisma.department.create({ data: d });
  const D = Object.fromEntries((await prisma.department.findMany()).map(d => [d.code, d]));
  // PGĐ phụ trách: Văn phòng → Giám đốc; Khoa học Công nghệ → Phó Giám đốc; Tài năng trẻ → Phó Giám đốc thứ hai (ensureCentreStaff).
  await prisma.department.update({ where: { id: D.VP.id }, data: { supervisorId: gd.id } });
  for (const c of ['KHCN', 'TNT']) await prisma.department.update({ where: { id: D[c].id }, data: { supervisorId: pgd.id } });
  await ensureCentreStaff(prisma);
  const U = Object.fromEntries((await prisma.user.findMany()).map(u => [u.username, u]));
  const p = await prisma.project.create({ data: {
    key: 'TT', name: 'Sổ giao việc Trung tâm', departmentId: bgd.id, leadId: gd.id, createdById: gd.id, visibility: 'ASSIGNED',
    description: 'Ban Giám đốc giao nhiệm vụ về các phòng; mỗi người chỉ thấy việc liên quan đến mình (dữ liệu mẫu, tên giả).',
    states: { create: DEFAULT_STATES.map((st, position) => ({ ...st, position, wipLimit: null })) },
    members: { create: [[gd, 'OWNER'], [pgd, 'OWNER'], [U['cv.vp1'], 'MEMBER']].filter(([u], i, a) => a.findIndex(([x]) => x.id === u.id) === i).map(([u, role]) => ({ userId: u.id, role })) },
    approvalSteps: { create: [{ level: 1, name: 'Lãnh đạo phòng duyệt', approverType: 'DEPARTMENT_MANAGER' }, { level: 2, name: 'Ban Giám đốc cho ý kiến', approverType: 'SUPERVISOR' }] },
  }, include: { states: true } });
  const { make, count } = centreMaker(prisma, p, D, U, gd);
  const doc = (number, summary, extra = {}) => ({ kind: 'BASIS', number, summary, issuer: 'Trung tâm (giả)', issuedOn: daysFromNow(-12), ...extra });
  await make({ title: 'Xây dựng kế hoạch tổ chức Ngày hội sáng tạo trẻ', dept: 'KHCN', supportDepts: ['TNT'], due: 7, given: -1, out: 'Kế hoạch tổ chức; dự toán kinh phí', docs: [doc('88/TB-TT (giả)', 'Thông báo kết luận giao ban tuần')] });
  await make({ title: 'Rà soát danh sách tài năng trẻ đề cử giải thưởng', dept: 'TNT', due: 4, given: -3, by: pgd, source: 'Văn bản cấp trên', docs: [doc('215-CV/TWĐ (giả)', 'Công văn đề nghị giới thiệu ứng viên', { issuer: 'Cơ quan cấp trên (giả)' })] });
  await make({ title: 'Báo cáo sơ kết 9 tháng hoạt động khoa học công nghệ', dept: 'KHCN', lead: ['cv.khcn1'], support: ['cv.khcn2'], due: 2, given: -14, progress: 60, out: 'Báo cáo sơ kết; phụ lục số liệu',
    reports: [{ by: 'cv.khcn1', progress: 30, content: 'Đã tổng hợp số liệu từ các đơn vị', at: -8 }, { by: 'cv.khcn1', progress: 60, content: 'Hoàn thành dự thảo phần I, II', diff: 'Chưa nhận đủ số liệu tài chính', prop: 'Đề nghị Văn phòng cung cấp số liệu kinh phí trước ngày 20', at: -1 }],
    ext: [{ by: 'cv.khcn1', old: 2, new: 6, reason: 'Chờ số liệu tài chính từ Văn phòng' }] });
  await make({ title: 'Dự thảo thể lệ Cuộc thi Ý tưởng sáng tạo', dept: 'KHCN', lead: ['cv.khcn2'], due: 3, given: -9, progress: 90, cat: 'REVIEW', waitLevel: 1, submitNote: 'Kính trình phòng xem xét dự thảo thể lệ', docs: [doc('Dự thảo (giả)', 'Thể lệ Cuộc thi Ý tưởng sáng tạo', { kind: 'OUTPUT' })] });
  await make({ title: 'Phương án truyền thông Tháng thanh niên', dept: 'TNT', lead: ['cv.tnt1'], due: 5, given: -12, progress: 95, cat: 'REVIEW', waitLevel: 2, by: pgd, submitNote: 'Kính trình phương án truyền thông' });
  await make({ title: 'Tổng hợp đề xuất nhiệm vụ khoa học năm sau', dept: 'KHCN', lead: ['cv.khcn1'], due: -6, given: -25, cat: 'COMPLETED', doneAt: -8, rating: 'GOOD', review: 'Tổng hợp đầy đủ, đúng hạn' });
  await make({ title: 'Chuẩn bị hồ sơ tổng kết chương trình học bổng', dept: 'TNT', lead: ['cv.tnt1'], due: -3, originalDue: -9, given: -30, cat: 'COMPLETED', doneAt: -2, rating: 'PASS', by: pgd, review: 'Đạt, cần chủ động hơn về tiến độ',
    ext: [{ by: 'cv.tnt1', old: -9, new: -3, reason: 'Đơn vị phối hợp gửi hồ sơ chậm', status: 'APPROVED', note: 'Đồng ý' }] });
  await make({ title: 'Soạn thư mời đối tác dự Diễn đàn khởi nghiệp', dept: 'TNT', lead: ['cv.tnt1'], due: 1, given: -2, progress: 50, acceptedBy: 'tp.tnt' });
  await make({ title: 'Chuẩn bị nội dung giao ban Ban Giám đốc tháng', dept: 'VP', lead: ['cv.vp1'], due: 9, given: -2, progress: 20, pri: 'MEDIUM', source: 'Họp giao ban' });
  const plan = await make({ title: 'Hội thi Tin học trẻ năm 2027', type: 'PLAN', source: 'Kế hoạch năm', dept: 'KHCN', lead: ['cv.khcn1'], support: ['cv.khcn2'], supportDepts: ['VP'], due: 300, given: -5, progress: 10, planCode: '2.2', planSection: '2. Tổ chức các hội thi, cuộc thi khoa học, công nghệ', out: 'Tổ chức Hội thi; 2.000 thí sinh' });
  for (const [title, due, lead, prog] of [['Ban hành thể lệ Hội thi', 60, 'cv.khcn1', 20], ['Phát động, tuyên truyền Hội thi', 120, 'cv.khcn2', 0], ['Tổ chức Vòng Chung kết', 280, 'cv.khcn1', 0]])
    await make({ title, type: 'PLAN', source: 'Kế hoạch năm', dept: 'KHCN', parentId: plan.id, lead: [lead], due, given: -5, progress: prog, pri: 'MEDIUM', by: U['tp.khcn'] });
  await prisma.project.update({ where: { id: p.id }, data: { nextNumber: count() + 1 } });
  await ensureCentreStaff(prisma); // PGĐ là chủ sổ TT
  await centreOfficeAccess(prisma);
  const extra = await centreFinal(prisma);
  return `TT: ${count()} việc, ${CENTRE_USERS.length} cán bộ; ${extra}`;
}

// ================= GĐ3d: dữ liệu mẫu cuối của Trung tâm — TÊN GIẢ =================
// Bổ sung một lần (máy mới, hoặc máy đã có sổ TT): Kế hoạch công tác năm 2027 trong sổ TT, các nhiệm vụ thường gặp của
// Văn phòng / Phòng Tài năng trẻ (nhóm việc có việc nhánh, việc quá hạn, việc chờ phòng tiếp nhận do PGĐ thứ hai giao),
// và bảng Kanban việc nội bộ cho từng phòng.
const CENTRE_BOARDS = [
  { code: 'VP', name: 'Việc nội bộ Văn phòng', items: [
    { title: 'Chuẩn bị phòng họp, tài liệu giao ban tuần', lead: 'pcvp', by: 'cvp', cat: 'STARTED', due: 1, progress: 60, pri: 'HIGH', check: ['Đặt phòng họp', 'In tài liệu', 'Gửi giấy mời'] },
    { title: 'Tổng hợp đề xuất mua sắm văn phòng phẩm Quý IV', lead: 'cv.vp1', by: 'cvp', cat: 'STARTED', due: 3, progress: 40 },
    { title: 'Cập nhật lịch trực, danh bạ nội bộ tháng 11', lead: 'cv.vp1', by: 'pcvp', cat: 'UNSTARTED', due: 8, pri: 'MEDIUM' },
    { title: 'Lưu trữ hồ sơ giao ban tháng 9', lead: 'cv.vp1', by: 'pcvp', cat: 'COMPLETED', due: -4, doneAt: -5, pri: 'LOW' },
  ] },
  { code: 'KHCN', name: 'Việc nội bộ Phòng Khoa học Công nghệ', items: [
    { title: 'Họp nhóm chuẩn bị đề cương Hội thi Tin học trẻ', lead: 'cv.khcn1', by: 'tp.khcn', cat: 'UNSTARTED', due: 5, check: ['Đặt lịch họp', 'Dự thảo đề cương', 'Gửi phòng góp ý'] },
    { title: 'Cập nhật cơ sở dữ liệu chuyên gia, giám khảo', lead: 'cv.khcn2', by: 'pp.khcn', cat: 'STARTED', due: 10, progress: 30, pri: 'MEDIUM' },
    { title: 'Rà soát hồ sơ đề tài cấp cơ sở năm 2026', lead: 'pp.khcn', by: 'tp.khcn', cat: 'BACKLOG', due: 20, pri: 'LOW' },
    { title: 'Gửi báo cáo tuần cho Văn phòng', lead: 'cv.khcn2', by: 'tp.khcn', cat: 'COMPLETED', due: -1, doneAt: -1, pri: 'MEDIUM' },
  ] },
  { code: 'TNT', name: 'Việc nội bộ Phòng Tài năng trẻ', items: [
    { title: 'Thiết kế ấn phẩm Tháng thanh niên', lead: 'cv.tnt1', by: 'tp.tnt', cat: 'STARTED', due: -1, progress: 70, pri: 'HIGH' },
    { title: 'Liên hệ cựu học viên tham gia chia sẻ kinh nghiệm', lead: 'cv.tnt1', by: 'pp.tnt', cat: 'STARTED', due: 6, progress: 50, pri: 'MEDIUM' },
    { title: 'Cập nhật danh sách tài năng trẻ theo lĩnh vực', lead: 'pp.tnt', by: 'tp.tnt', cat: 'UNSTARTED', due: 12, pri: 'MEDIUM' },
  ] },
];
async function centreFinal(prisma) {
  const out = [];
  const D = Object.fromEntries((await prisma.department.findMany({ where: { isActive: true } })).map(d => [d.code, d]));
  const U = Object.fromEntries((await prisma.user.findMany({ where: { isActive: true } })).map(u => [u.username, u]));
  const gd = U.giamdoc;
  if (!gd || !D.VP || !D.KHCN || !D.TNT) return 'Thiếu bộ máy Trung tâm';
  const pgd = U.pgd || gd, pgd2 = U.pgd2 || pgd;

  // 1) Sổ TT: Kế hoạch năm + nhiệm vụ bổ sung (chỉ khi sổ chưa có kế hoạch năm).
  const p = await prisma.project.findUnique({ where: { key: 'TT' }, include: { states: true } });
  if (p && !(await prisma.plan.findFirst({ where: { projectId: p.id } })) && ['pcvp', 'cv.vp1', 'pp.tnt', 'cv.tnt1', 'tp.tnt'].every(u => U[u])) {
    const plan = await prisma.plan.create({ data: { projectId: p.id, name: 'KẾ HOẠCH CÔNG TÁC NĂM 2027 (mẫu)', year: 2027, createdById: gd.id } });
    await prisma.workItem.updateMany({ where: { projectId: p.id, taskType: 'PLAN', planId: null }, data: { planId: plan.id } });
    const { make, count } = centreMaker(prisma, p, D, U, gd, p.nextNumber - 1);
    const start = count();
    const doc = (number, summary, extra = {}) => ({ kind: 'BASIS', number, summary, issuer: 'Trung tâm (giả)', issuedOn: daysFromNow(-20), ...extra });
    const award = await make({ title: 'Giải thưởng Sáng tạo trẻ 2026 (nhóm việc)', dept: 'TNT', lead: ['pp.tnt'], support: ['cv.tnt1'], supportDepts: ['VP'], by: pgd2, acceptedBy: 'tp.tnt',
      due: 45, given: -20, progress: 35, out: 'Xét chọn, trao giải và quyết toán', docs: [doc('95/QĐ-TT (giả)', 'Quyết định thành lập Hội đồng giải thưởng')] });
    for (const [title, due, lead, cat, progress] of [['ST.1 – Tổng hợp, thẩm định hồ sơ', -10, 'cv.tnt1', 'COMPLETED', 100], ['ST.2 – Họp Hội đồng xét chọn', 15, 'pp.tnt', 'STARTED', 20], ['ST.3 – Truyền thông, lễ trao giải', 40, 'cv.tnt1', 'UNSTARTED', 0]])
      await make({ title, dept: 'TNT', parentId: award.id, lead: [lead], by: U['tp.tnt'], due, given: -18, cat, progress, doneAt: -11, pri: 'MEDIUM' });
    await make({ title: 'Rà soát hệ thống quy chế, quy định nội bộ; đề xuất sửa đổi, thay thế', dept: 'VP', lead: ['pcvp'], due: -2, given: -25, progress: 70, coord: 'Các phòng',
      out: 'Danh mục quy chế đã phân loại kèm đề xuất', reports: [{ by: 'pcvp', progress: 70, content: 'Đã phân loại 18/24 văn bản', diff: 'Một số phòng chưa gửi góp ý', prop: 'Đề nghị Ban Giám đốc nhắc các phòng gửi góp ý trong tuần', at: -3 }] });
    await make({ title: 'Cải tạo, sửa chữa cơ sở vật chất tầng 1', dept: 'VP', lead: ['cv.vp1'], due: 4, given: -30, progress: 70, coord: 'Đơn vị thi công', out: 'Hạng mục cải tạo hoàn thành, nghiệm thu',
      docs: [doc('46/QĐ-TT (giả)', 'Phê duyệt kế hoạch lựa chọn nhà thầu cải tạo')] });
    await make({ title: 'Phương án tiếp nhận và khai thác không gian tầng 7', dept: 'VP', by: pgd2, due: 14, given: -1, pri: 'MEDIUM', source: 'Phát sinh', out: 'Phương án tiếp nhận và khai thác' });
    const planItem = { type: 'PLAN', source: 'Kế hoạch năm', planId: plan.id, given: -2, pri: 'MEDIUM' };
    const quarter = await make({ ...planItem, title: 'Xây dựng chương trình công tác Quý; chế độ báo cáo định kỳ', dept: 'VP', lead: ['cv.vp1'], due: 160, progress: 5,
      planCode: '6.1', planSection: '6. Công việc khác (văn phòng, tổng hợp, tài chính)', period: 'Trước ngày 25 tháng cuối mỗi Quý', out: 'Chương trình công tác Quý; báo cáo định kỳ đúng hạn' });
    for (const [title, due] of [['6.1.1 – Quý I', 160], ['6.1.2 – Quý II', 251]])
      await make({ ...planItem, title, dept: 'VP', parentId: quarter.id, lead: ['cv.vp1'], due, cat: 'UNSTARTED', planCode: '6.1', planSection: '6. Công việc khác (văn phòng, tổng hợp, tài chính)' });
    await make({ ...planItem, title: 'Chương trình bồi dưỡng tài năng trẻ năm 2027', dept: 'TNT', by: pgd2, due: 200, budget: 500, planCode: '3.1', planSection: '3. Phát hiện, bồi dưỡng tài năng trẻ',
      period: 'Quý II – Quý IV/2027', out: 'Tổ chức 03 khoá bồi dưỡng; 150 học viên' });
    await prisma.project.update({ where: { id: p.id }, data: { nextNumber: count() + 1 } });
    out.push(`TT: kế hoạch năm 2027 + ${count() - start} việc`);
  }

  // 2) Bảng việc nội bộ từng phòng (phòng chưa có bảng riêng): lãnh đạo phòng là chủ bảng, cán bộ trong phòng là thành viên.
  for (const b of CENTRE_BOARDS) {
    const dept = D[b.code];
    if (await prisma.project.findFirst({ where: { departmentId: dept.id, visibility: { not: 'ASSIGNED' }, deletedAt: null, archivedAt: null } })) continue;
    const staff = await prisma.user.findMany({ where: { departmentId: dept.id, isActive: true }, orderBy: { id: 'asc' } });
    const lead = staff.find(u => u.role === 'manager') || staff.find(u => u.role === 'deputy');
    if (!lead) continue;
    const used = new Set((await prisma.project.findMany({ select: { key: true } })).map(x => x.key));
    const key = [b.code, b.code + 'NB'].find(k => !used.has(k));
    if (!key) continue;
    const board = await prisma.project.create({ data: {
      key, name: b.name, departmentId: dept.id, leadId: lead.id, createdById: lead.id, visibility: 'DEPARTMENT',
      description: `Bảng Kanban cho việc nội bộ của ${dept.name} (dữ liệu mẫu, tên giả). Việc Ban Giám đốc giao về phòng nằm ở "Việc phòng được giao".`,
      states: { create: DEFAULT_STATES.map((s, position) => ({ ...s, position })) },
      members: { create: staff.map(u => ({ userId: u.id, role: ['manager', 'deputy'].includes(u.role) ? 'OWNER' : 'MEMBER' })) },
    }, include: { states: true } });
    let n = 0;
    for (const it of b.items) {
      if (!U[it.lead] || !U[it.by]) continue;
      n++;
      const due = daysFromNow(it.due);
      await prisma.workItem.create({ data: {
        projectId: board.id, number: n, title: it.title, stateId: board.states.find(s => s.category === it.cat).id, priority: it.pri || 'MEDIUM', reporterId: U[it.by].id, position: n * 1024,
        dueDate: due, originalDueDate: due, progress: it.cat === 'COMPLETED' ? 100 : it.progress || 0,
        startedAt: ['STARTED', 'COMPLETED'].includes(it.cat) ? daysFromNow(-5) : null, completedAt: it.cat === 'COMPLETED' ? daysFromNow(it.doneAt ?? -1) : null,
        assignees: { create: [{ userId: U[it.lead].id }] },
        checklist: { create: (it.check || []).map((title, i) => ({ title, position: i * 1024, done: i === 0 && it.cat === 'STARTED' })) },
        activities: { create: { actorId: U[it.by].id, type: 'CREATED', data: { title: it.title, source: 'SEED' } } },
      } });
    }
    await prisma.project.update({ where: { id: board.id }, data: { nextNumber: n + 1 } });
    out.push(`${key}: ${n} việc`);
  }
  return out.join('; ') || 'dữ liệu mẫu cuối đã có';
}

module.exports = { showcase, ensureCentreStaff, centreFinal };
