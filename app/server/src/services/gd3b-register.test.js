// GĐ3b — Sổ, nhập/xuất, kế hoạch năm, tổng hợp theo phòng chủ trì, mẫu nhóm việc có hạn tương đối (dữ liệu giả).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./register');
const P = require('./plan-parser');
const { departmentMatcher, splitUnits } = require('./dept-match');
const { buildPlanDocx, buildPlanDocxWeeks } = require('./__fixtures__/plan-docx');
const { ROLE_PROFILES } = require('../lib/permissions');
const routes = require('../routes/register');

const H7 = 7 * 3_600_000;
const vn = (y, m, d, h = 0) => new Date(Date.UTC(y, m - 1, d, h) - H7);
const iso = d => d.toISOString();
const now = vn(2026, 10, 16, 20);

test('mốc theo tuần: "Tuần N tháng M/YYYY" → hạn ngày min(7N, cuối tháng); nhiều tuần lấy tuần cuối', () => {
  const m = P.parseMilestoneLine('Tuần 2 tháng 2/2027: họp Ban tổ chức');
  assert.equal(m.title, 'Họp Ban tổ chức');
  assert.equal(m.monthLabel, 'Tuần 2 tháng 2/2027');
  assert.equal(iso(m.due), iso(vn(2027, 2, 14)));
  assert.equal(iso(m.start), iso(vn(2027, 2, 8)));
  assert.equal(iso(P.parseMilestoneLine('Tuần 1, 2 tháng 3/2027: Phát động').due), iso(vn(2027, 3, 14)));
  assert.equal(iso(P.parseMilestoneLine('Tuần 3 - 4 tháng 4 năm 2027: X').due), iso(vn(2027, 4, 28)));
  assert.equal(iso(P.parseMilestoneLine('Tuần 5 tháng 2/2027: X').due), iso(vn(2027, 2, 28))); // tuần 5 → hết tháng
  assert.match(P.parseMilestoneLine('Tuần 6 tháng 2/2027: X').error, /tuần/);
  assert.equal(iso(P.dueFromPeriod('Tuần 3 tháng 4/2027', 2027)), iso(vn(2027, 4, 21)));
});

test('các dạng mốc khác và dòng trông giống mốc nhưng không đọc được', () => {
  assert.equal(iso(P.parseMilestoneLine('Tháng 6 - 7/2027: Chung kết').due), iso(vn(2027, 7, 31)));
  assert.equal(iso(P.parseMilestoneLine('Cuối tháng 6/2027: Tổng kết').due), iso(vn(2027, 6, 30)));
  assert.equal(iso(P.parseMilestoneLine('Đầu tháng 9 năm 2027: Khai giảng').due), iso(vn(2027, 9, 10)));
  assert.equal(iso(P.parseMilestoneLine('Quý II/2027: Sơ kết').due), iso(vn(2027, 6, 30)));
  assert.equal(iso(P.parseMilestoneLine('Ngày 15/3/2027: Hội nghị').due), iso(vn(2027, 3, 15)));
  assert.match(P.parseMilestoneLine('Tháng 3: thiếu năm').error, /thiếu năm/);
  assert.match(P.parseMilestoneLine('Trước 31/2/2027: sai ngày').error, /không hợp lệ/);
  assert.equal(P.parseMilestoneLine('Hội thi được tổ chức tại Hà Nội'), null);
  const d = P.parseDescription('- Tháng 3/2027: A\n- Tháng 13/2027: B\n- Nội dung khác', 2027);
  assert.equal(d.milestones.length, 1);
  assert.equal(d.warnings.length, 1);
  assert.match(d.description, /Tháng 13\/2027: B\nNội dung khác/); // dòng không đọc được vẫn giữ trong mô tả
});

test('"mỗi Quý" kèm mốc tháng: giữ cả hai, sắp theo hạn, bỏ mốc Quý đã có mốc riêng', () => {
  const quarterly = P.quarterlySplit('Trước ngày 25 tháng cuối mỗi Quý', 2027);
  const explicit = P.parseDescription('- Tháng 12/2027: Báo cáo tổng kết năm\n- Tháng 3/2027: Báo cáo Quý I gửi cấp trên', 2027).milestones;
  const merged = P.mergeMilestones(explicit, quarterly);
  assert.deepEqual(merged.map(m => m.title), ['Báo cáo Quý I gửi cấp trên', 'Quý II', 'Quý III', 'Quý IV', 'Báo cáo tổng kết năm']);
  assert.equal(P.mergeMilestones([...explicit, ...explicit]).length, 2); // trùng tên + ngày → giữ một
});

test('đọc Kế hoạch năm có mốc tuần, cảnh báo mốc không đọc được; mẫu cũ giữ nguyên 2 nhiệm vụ, 6 mốc', async () => {
  const old = P.parsePlanDocx(await buildPlanDocx({ year: 2027 }));
  assert.equal(old.tasks.reduce((n, t) => n + t.milestones.length, 0), 6);
  assert.deepEqual(old.warnings, []);
  const plan = P.parsePlanDocx(await buildPlanDocxWeeks({ year: 2027 }));
  const [t1, t2, t3] = plan.tasks;
  assert.deepEqual(t1.milestones.map(m => m.monthLabel), ['Tuần 2 tháng 2/2027', 'Tuần 1, 2 tháng 3/2027', 'Tháng 6/2027']);
  assert.equal(t1.budget, 1200);
  assert.equal(t1.leadUnit, 'Phòng KHCN');
  assert.equal(plan.warnings.length, 2);
  assert.match(plan.warnings[0], /^Nhiệm vụ 1\.1: chưa đọc được mốc "Tuần 6 tháng 7\/2027: Tổng kết"/);
  assert.match(plan.warnings[1], /Tháng 9: Rút kinh nghiệm.*thiếu năm/);
  assert.equal(t2.milestones.length, 5);
  assert.equal(iso(t2.due), iso(vn(2027, 12, 31)));
  assert.equal(iso(t3.due), iso(vn(2027, 4, 21))); // "Thời gian: Tuần 3 tháng 4/2027"
});

test('khớp đơn vị chủ trì với phòng ban: không dấu, viết tắt KHCN/TNT/VP, chứa nhau', () => {
  const depts = [{ id: 1, code: 'BGD', name: 'Ban Giám đốc' }, { id: 5, code: 'VP', name: 'Văn phòng' }, { id: 6, code: 'KHCN', name: 'Phòng Khoa học Công nghệ' },
    { id: 7, code: 'TNT', name: 'Phòng Tài năng trẻ' }, { id: 4, code: 'HCNS', name: 'Phòng Hành chính – Nhân sự' }];
  const m = departmentMatcher(depts);
  const id = s => m(s)?.id ?? null;
  assert.equal(id('Phòng KHCN'), 6);
  assert.equal(id('phong khoa hoc va cong nghe'), 6);
  assert.equal(id('Phòng TNT (đ/c A)'), 7);
  assert.equal(id('VP'), 5);
  assert.equal(id('Văn phòng'), 5);
  assert.equal(id('Phòng Hành chính'), 4); // tên ghi tắt nằm trong tên phòng
  assert.equal(id('Phòng Tài năng trẻ Trung tâm'), 7); // tên ghi dài chứa trọn tên phòng
  assert.equal(id('Phòng'), null);
  assert.equal(id('Phòng Đối ngoại'), null);
  assert.deepEqual(splitUnits('Văn phòng (đ/c A, đ/c B), Phòng TNT', m), ['Văn phòng', 'Phòng TNT']);
  assert.deepEqual(splitUnits('Phòng KHCN và Phòng TNT', m), ['Phòng KHCN', 'Phòng TNT']);
  assert.deepEqual(splitUnits('Phòng Khoa học và Công nghệ', m), ['Phòng Khoa học và Công nghệ']);
});

test('văn bản căn cứ trong sổ Excel: "số ngày dd/mm/yyyy" nối bằng "; " — đọc lại được', () => {
  const r = R.parseDocumentRefs('123/QĐ-TT ngày 15/03/2027; 45/KH-TT\n07/CV-VP, 2/1/2027 về kế hoạch; 9/TB 31/02/2027');
  assert.deepEqual(r.docs.map(d => d.number), ['123/QĐ-TT', '45/KH-TT', '07/CV-VP', '9/TB']);
  assert.equal(iso(r.docs[0].issuedOn), iso(vn(2027, 3, 15)));
  assert.equal(r.docs[1].summary, 'Văn bản căn cứ');
  assert.equal(r.docs[2].summary, 'về kế hoạch');
  assert.equal(r.docs[3].issuedOn, null);
  assert.equal(r.errors.length, 1);
  const text = R.formatDocumentRefs([{ number: '123/QĐ-TT', issuedOn: vn(2027, 3, 15) }, { number: '45/KH-TT', issuedOn: null }]);
  assert.equal(text, '123/QĐ-TT ngày 15/03/2027; 45/KH-TT');
  assert.deepEqual(R.parseDocumentRefs(text).docs.map(d => [d.number, d.issuedOn && iso(d.issuedOn)]), [['123/QĐ-TT', iso(vn(2027, 3, 15))], ['45/KH-TT', null]]);
});

test('áp mẫu: hạn = ngày mốc ± N ngày, chọn người/hạn/bỏ từng việc, không muộn hơn hạn việc cha', () => {
  const tpl = [{ title: 'Ban hành thể lệ', offsetDays: -90 }, { title: 'Truyền thông', offsetDays: -30 }, { title: 'Tổng kết', offsetDays: 10 }, { title: 'Dự toán' }];
  const anchorDate = vn(2027, 6, 30), parentDue = vn(2027, 7, 5);
  const p = R.planTemplateItems(tpl, { anchorDate, parentDue, parentAssigneeIds: [7], prefix: '1.1', rows: [{ index: 1, assigneeIds: [9], title: 'Truyền thông trên báo' }] });
  assert.deepEqual(p.items.map(i => i.title), ['1.1.1 – Ban hành thể lệ', '1.1.2 – Truyền thông trên báo', '1.1.3 – Tổng kết', '1.1.4 – Dự toán']);
  assert.equal(iso(p.items[0].dueDate), iso(vn(2027, 4, 1)));
  assert.deepEqual(p.items[1].assigneeIds, [9]);
  assert.deepEqual(p.items[0].assigneeIds, [7]);
  assert.equal(iso(p.items[2].dueDate), iso(parentDue)); // 10/7 muộn hơn hạn cha 5/7 → cắt về hạn cha
  assert.equal(iso(p.items[2].clampedFrom), iso(vn(2027, 7, 10)));
  assert.equal(p.items[3].basis, 'PARENT');
  const q = R.planTemplateItems(tpl, { parentDue, rows: [{ index: 0, skip: true }, { index: 1, dueDate: vn(2027, 5, 2), assigneeIds: [] }] });
  assert.equal(q.skipped, 1);
  assert.equal(q.items.length, 3);
  assert.equal(q.items[0].basis, 'ROW');
  assert.deepEqual(q.items[0].assigneeIds, []); // [] tường minh = chưa giao người
  assert.equal(q.items[1].basis, 'PARENT'); // không có ngày mốc → hạn việc cha
});

test('tổng hợp theo phòng chủ trì: phòng = đơn vị chủ trì ?? phòng của sổ; chờ tiếp nhận; Kế hoạch năm / Đột xuất', () => {
  const it = (cat, extra = {}) => ({ dueDate: vn(2026, 10, 30), completedAt: null, state: { category: cat }, dispatchStatus: null, taskType: 'ADHOC', leadDepartmentId: null, project: { departmentId: 1 }, ...extra });
  const items = [
    it('UNSTARTED', { leadDepartmentId: 6, dispatchStatus: 'PENDING', taskType: 'PLAN' }),
    it('COMPLETED', { leadDepartmentId: 6, dispatchStatus: 'ACCEPTED', taskType: 'PLAN', dueDate: vn(2026, 10, 10), completedAt: vn(2026, 10, 9) }),
    it('STARTED', { leadDepartmentId: 6, dueDate: vn(2026, 10, 1) }),
    it('STARTED', { project: { departmentId: 6 }, dueDate: vn(2026, 10, 18) }), // việc nội bộ của phòng (dự án của phòng)
    it('STARTED'), // sổ Ban Giám đốc, chưa giao về phòng → tính cho Ban Giám đốc
    it('CANCELLED', { leadDepartmentId: 6 }),
    it('STARTED', { leadDepartmentId: 99 }), // ngoài phạm vi
  ];
  const r = R.summarizeDepartments(items, [{ id: 1, name: 'Ban Giám đốc' }, { id: 6, name: 'Phòng Khoa học Công nghệ' }], { now, dueSoonDays: 3 });
  const khcn = r.rows.find(x => x.departmentId === 6);
  assert.deepEqual([khcn.total, khcn.pendingAccept, khcn.overdue, khcn.dueSoon, khcn.inProgress, khcn.doneOnTime, khcn.onTimeRate], [4, 1, 1, 1, 1, 1, 100]);
  assert.deepEqual([khcn.plan.done, khcn.plan.total, khcn.plan.rate, khcn.adhoc.done, khcn.adhoc.total], [1, 2, 50, 0, 2]);
  assert.equal(r.rows.find(x => x.departmentId === 1).total, 1);
  assert.equal(r.total.total, 5);
});

test('dòng cộng theo phòng trong bảng cán bộ: mỗi việc tính một lần cho mỗi phòng', () => {
  const users = [{ id: 1, departmentId: 6, department: { name: 'KHCN' } }, { id: 2, departmentId: 6, department: { name: 'KHCN' } }, { id: 3, departmentId: 7, department: { name: 'TNT' } }];
  const it = (lead, sup = []) => ({ dueDate: vn(2026, 10, 30), state: { category: 'STARTED' }, assignees: lead.map(userId => ({ userId })), supporters: sup.map(userId => ({ userId })) });
  const s = R.subtotalsByDepartment([it([1, 2], [3]), it([1, 3]), it([9])], users, { now });
  const khcn = s.find(x => x.departmentId === 6), tnt = s.find(x => x.departmentId === 7);
  assert.deepEqual([khcn.total, khcn.supporting], [2, 0]);
  assert.deepEqual([tnt.total, tnt.supporting], [1, 1]);
});

test('quyền xuất sổ và mẫu nhóm việc', () => {
  const as = (id, role, departmentId) => ({ id, role, departmentId, permissions: ROLE_PROFILES[role] });
  const register = { id: 1, departmentId: 1, visibility: 'ASSIGNED' };
  const cv = as(15, 'member', 5), tp = as(16, 'manager', 6), gd = as(2, 'director', 1);
  assert.equal(routes.canExport(cv, register), false);
  assert.equal(routes.canExport(cv, register, { role: 'MEMBER' }), true); // thành viên sổ
  assert.equal(routes.canExport(cv, register, { role: 'VIEWER' }), false);
  assert.equal(routes.canExport(tp, register, null, { canManage: true }), true); // người quản lý dự án
  assert.equal(routes.canExport(tp, { ...register, departmentId: 6 }), true); // quyền Xuất Excel phạm vi phòng
  assert.equal(routes.canExport(gd, register), true);
  assert.equal(routes.canCreateTemplate(tp), true);
  assert.equal(routes.canCreateTemplate(cv), false);
  assert.equal(routes.canEditTemplate(tp, { createdById: 16 }), true);
  assert.equal(routes.canEditTemplate(tp, { createdById: 2 }), false);
  assert.equal(routes.canEditTemplate(tp, { createdById: null }), false); // mẫu mặc định: chỉ BGĐ / quản trị
  assert.equal(routes.canEditTemplate(gd, { createdById: 16 }), true);
});
