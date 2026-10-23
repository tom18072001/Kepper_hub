// Dữ liệu mẫu GIẢ cho playground CRM / HRM (chỉ khi SEED_DEMO=true và MODULES có crm / hrm; chạy một lần — đã có dữ liệu thì bỏ qua).
// Tên tổ chức, người, số điện thoại, số CCCD đều GIẢ (CCCD dạng 0000000000xx, điện thoại 09000000xx) — không dùng dữ liệu thật (Data Protection Gate).
const C = require('./lib/crypto-field');
const WK = require('./services/weekly');
const H = require('./services/hrm');

const vn = (day, hhmm = '00:00') => new Date(Date.parse(`${day}T${hhmm}:00+07:00`));

async function seedPlayground(prisma, env = process.env) {
  const modules = String(env.MODULES || '').toLowerCase().split(',').map(s => s.trim());
  const out = { crm: false, hrm: false };
  const users = Object.fromEntries((await prisma.user.findMany({ where: { isRootAdmin: false } })).map(u => [u.username, u]));
  if (!users.giamdoc || !users['nv.phaply']) return out; // chưa có tài khoản mẫu
  const dept = Object.fromEntries((await prisma.department.findMany()).map(d => [d.code, d]));
  const today = WK.dayOf(new Date());

  if (modules.includes('crm') && !(await prisma.crmPartner.count())) {
    const P = async (data, contacts = [], interactions = [], engagements = []) => prisma.crmPartner.create({ data: { ...data, createdById: data.ownerUserId,
      contacts: { create: contacts }, interactions: { create: interactions }, engagements: { create: engagements } } });
    const u = n => users[n].id;
    await P({ name: 'Công ty CP Xây dựng Mẫu An Phát (giả)', kind: 'CONTRACTOR', taxCode: '0100000001', address: 'Số 1 đường Mẫu, quận Mẫu (giả)', phone: '0240000001', status: 'ACTIVE', rating: 4,
      ownerDepartmentId: dept.QLXD.id, ownerUserId: u('tb.qlxd'), note: 'Nhà thầu thi công phần thân (mẫu). Tiến độ tốt, cần nhắc hồ sơ thanh toán.' },
    [{ fullName: 'Nguyễn Văn Mẫu (giả)', title: 'Chỉ huy trưởng', phone: '0900000011', email: 'chihuy@an-phat.example', isPrimary: true },
      { fullName: 'Trần Thị Thử (giả)', title: 'Kế toán dự án', phone: '0900000012', email: 'ketoan@an-phat.example' }],
    [{ type: 'SITE_VISIT', date: vn(WK.addDays(today, -6), '09:00'), summary: 'Kiểm tra hiện trường tầng 5: đạt 80% khối lượng (mẫu).', nextStep: 'Nhận hồ sơ nghiệm thu đợt 3', nextDue: vn(today, '17:00'), nextOwnerId: u('nv.qlxd'), createdById: u('tb.qlxd') },
      { type: 'MEETING', date: vn(WK.addDays(today, -20), '14:00'), summary: 'Họp giao ban công trường tuần (mẫu).', createdById: u('nv.qlxd') }],
    [{ kind: 'CONTRACT', code: 'HĐ-TC-01/2026 (mẫu)', title: 'Thi công phần thân khối A (mẫu)', value: 45_000_000_000, signedAt: vn(WK.addDays(today, -120)), startAt: vn(WK.addDays(today, -110)), endAt: vn(WK.addDays(today, 150)), status: 'ACTIVE', createdById: u('tb.qlxd') }]);
    await P({ name: 'Công ty TNHH Tư vấn Thiết kế Mẫu Bình Minh (giả)', kind: 'CONSULTANT', taxCode: '0100000002', phone: '0240000002', status: 'ACTIVE', rating: 3,
      ownerDepartmentId: dept.TK.id, ownerUserId: u('tb.thietke'), note: 'Tư vấn thiết kế cơ sở (mẫu).' },
    [{ fullName: 'Lê Văn Vẽ (giả)', title: 'Chủ nhiệm thiết kế', phone: '0900000021', isPrimary: true }],
    [{ type: 'EMAIL', date: vn(WK.addDays(today, -3), '10:00'), summary: 'Gửi góp ý hồ sơ thiết kế cơ sở lần 2 (mẫu).', nextStep: 'Nhận bản chỉnh sửa', nextDue: vn(WK.addDays(today, 4), '17:00'), nextOwnerId: u('tb.thietke'), createdById: u('tb.thietke') }],
    [{ kind: 'CONTRACT', code: 'HĐ-TV-02/2026 (mẫu)', title: 'Tư vấn lập thiết kế cơ sở (mẫu)', value: 3_200_000_000, signedAt: vn(WK.addDays(today, -200)), status: 'ACTIVE', createdById: u('tb.thietke') }]);
    await P({ name: 'Sở Xây dựng tỉnh Mẫu (giả)', kind: 'AUTHORITY', address: 'Trung tâm hành chính tỉnh Mẫu (giả)', phone: '0240000003', status: 'ACTIVE',
      ownerDepartmentId: dept.PL.id, ownerUserId: u('tb.phaply'), note: 'Đầu mối thẩm định thiết kế, cấp phép xây dựng (mẫu).' },
    [{ fullName: 'Phạm Thẩm Định (giả)', title: 'Chuyên viên phòng Quản lý xây dựng', phone: '0900000031', isPrimary: true }],
    [{ type: 'LETTER', date: vn(WK.addDays(today, -10), '08:30'), summary: 'Nộp hồ sơ đề nghị thẩm định thiết kế (mẫu), số tiếp nhận TN-0001 (giả).', nextStep: 'Gọi hỏi tiến độ thẩm định', nextDue: vn(WK.addDays(today, -1), '09:00'), nextOwnerId: u('nv.phaply'), createdById: u('tb.phaply') }],
    [{ kind: 'PERMIT', code: 'TN-0001 (giả)', title: 'Thẩm định thiết kế cơ sở (mẫu)', status: 'ACTIVE', startAt: vn(WK.addDays(today, -10)), createdById: u('tb.phaply') }]);
    await P({ name: 'Ngân hàng TMCP Mẫu (giả)', kind: 'BANK', taxCode: '0100000004', phone: '0240000004', status: 'PROSPECT',
      ownerDepartmentId: dept.TC.id, ownerUserId: u('tb.taichinh'), note: 'Đang chào tài trợ vốn (mẫu).' },
    [{ fullName: 'Đỗ Tín Dụng (giả)', title: 'Giám đốc khách hàng doanh nghiệp', phone: '0900000041', isPrimary: true }],
    [{ type: 'MEETING', date: vn(WK.addDays(today, -2), '15:00'), summary: 'Trao đổi hạn mức, tài sản bảo đảm (mẫu).', nextStep: 'Gửi báo cáo tài chính dự án', nextDue: vn(WK.addDays(today, 2), '17:00'), nextOwnerId: u('tb.taichinh'), createdById: u('tb.taichinh') }],
    [{ kind: 'MOU', title: 'Thoả thuận nguyên tắc tài trợ (mẫu)', value: 300_000_000_000, status: 'DRAFT', createdById: u('tb.taichinh') }]);
    await P({ name: 'Công ty CP Vật liệu Mẫu Cường Thịnh (giả)', kind: 'SUPPLIER', taxCode: '0100000005', status: 'PAUSED', rating: 2,
      ownerDepartmentId: dept.QLXD.id, ownerUserId: u('nv.qlxd'), note: 'Giao thép chậm 2 đợt (mẫu) — tạm dừng đặt hàng.' });
    out.crm = true;
  }

  if (modules.includes('hrm') && !(await prisma.appSetting.findUnique({ where: { key: H.CONFIG_KEY } }))) {
    const hr = users['nv.hcns'];
    await prisma.appSetting.create({ data: { key: H.CONFIG_KEY, value: { ...H.DEFAULTS, hrUserIds: hr ? [hr.id] : [], holidays: ['2026-01-01', '2026-04-30', '2026-05-01', '2026-09-02'] } } });
    const list = Object.values(users).filter(u => u.isActive && u.role !== 'admin');
    let i = 0;
    for (const u of list.sort((a, b) => a.id - b.id)) {
      i++;
      const code = `KP${String(i).padStart(3, '0')}`, fake = `0000000000${String(i).padStart(2, '0')}`;
      const start = WK.addDays(today, -(400 + i * 170));
      await prisma.hrProfile.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id, employeeCode: code, startDate: vn(start), status: 'OFFICIAL',
        birthDate: vn(`19${85 + (i % 12)}-0${1 + (i % 9)}-1${i % 9}`), gender: i % 2 ? 'MALE' : 'FEMALE', phone: `09000001${String(i).padStart(2, '0')}`, personalEmail: `${u.username}@mail.example`,
        address: `Số ${i} phố Mẫu (giả)`, emergencyName: `Người thân ${i} (giả)`, emergencyPhone: `09000002${String(i).padStart(2, '0')}`, education: 'Đại học (mẫu)',
        idNumberEnc: C.encrypt(fake, C.AAD.identity(u.id), env), idNumberLast4: fake.slice(-4), idIssuedOn: vn('2021-01-01'), idIssuedPlace: 'Cục Cảnh sát QLHC về TTXH (mẫu)' } });
      const expiring = u.username === 'nv.qlxd';
      const k = await prisma.hrContract.create({ data: { userId: u.id, number: `${code}/HĐLĐ (mẫu)`, type: expiring ? 'FIXED' : 'INDEFINITE', position: u.displayTitle, startDate: vn(start),
        endDate: expiring ? vn(WK.addDays(today, 20)) : null, status: 'ACTIVE', signedAt: vn(start), note: 'Hợp đồng mẫu', createdById: hr?.id || u.id } });
      await prisma.hrContract.update({ where: { id: k.id }, data: { salaryEnc: C.encrypt(String(10_000_000 + i * 1_500_000), C.AAD.salary(k.id), env) } });
    }
    const L = async (username, type, from, to, status, approver = null, reason = '') => {
      const u = users[username]; if (!u) return;
      const cfg = await H.hrmConfig(prisma);
      await prisma.hrLeave.create({ data: { userId: u.id, departmentId: u.departmentId, type, fromDate: vn(from), toDate: vn(to), days: H.leaveDays(from, to, 'NONE', cfg) || 1, reason, status,
        approverId: approver ? users[approver].id : null, decidedAt: approver ? new Date() : null, createdById: u.id } });
    };
    const nextMon = (() => { let d = WK.addDays(today, 7); while (WK.weekday(d) !== 1) d = WK.addDays(d, 1); return d; })();
    await L('nv.phaply', 'ANNUAL', nextMon, WK.addDays(nextMon, 1), 'PENDING', null, 'Việc gia đình (mẫu)');
    await L('tb.phaply', 'ANNUAL', WK.addDays(nextMon, 3), WK.addDays(nextMon, 4), 'PENDING', null, 'Nghỉ phép năm (mẫu)');
    await L('nv.qlxd', 'ANNUAL', WK.addDays(today, -14), WK.addDays(today, -13), 'APPROVED', 'tb.qlxd', 'Nghỉ phép (mẫu)');
    // Chấm công 10 ngày làm việc gần nhất cho vài người (giờ giả, có muộn / quên chấm ra).
    const cfg = await H.hrmConfig(prisma);
    for (const [k, username] of ['nv.phaply', 'tb.phaply', 'nv.qlxd', 'nv.hcns'].entries()) {
      const u = users[username]; if (!u) continue;
      let d = WK.addDays(today, -1), n = 0;
      while (n < 10) {
        if (H.isWorkday(d, cfg)) {
          n++;
          const late = (n + k) % 4 === 0, noOut = (n + k) % 7 === 0;
          const inT = vn(d, late ? '08:25' : `07:5${(n + k) % 10}`), outT = noOut ? null : vn(d, '17:3' + ((n + k) % 10));
          await prisma.hrAttendance.upsert({ where: { userId_day: { userId: u.id, day: d } }, update: {},
            create: { userId: u.id, departmentId: u.departmentId, day: d, checkIn: inT, checkOut: outT, ...H.lateEarly(inT, outT, cfg), note: 'Mẫu' } });
        }
        d = WK.addDays(d, -1);
      }
    }
    out.hrm = true;
  }
  return out;
}

module.exports = { seedPlayground };
