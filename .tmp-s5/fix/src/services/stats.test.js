// Thống kê: phòng ban của việc, chỉ số KPI theo kỳ, điểm tổng hợp, định dạng giờ Việt Nam.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./stats');

const DAY = 86_400_000;
const at = s => new Date(s);
// Kỳ tháng 10/2026 theo giờ Việt Nam; "bây giờ" = 16/10/2026 12:00 (giờ VN).
const from = at('2026-10-01T00:00:00+07:00'), to = at('2026-10-31T23:59:59.999+07:00'), now = at('2026-10-16T12:00:00+07:00');
const item = (id, category, extra = {}) => ({ id, state: { category }, taskType: 'ADHOC', leadDepartmentId: null, project: { departmentId: 1 }, assignees: [],
  dueDate: null, assignedAt: null, createdAt: at('2026-09-01T09:00:00+07:00'), startedAt: null, completedAt: null, rating: null, ratedAt: null, ...extra });

test('phòng ban của việc = đơn vị chủ trì ?? phòng sở hữu dự án; điều kiện Prisma tương ứng', () => {
  assert.equal(S.departmentOf(item(1, 'STARTED', { leadDepartmentId: 6, project: { departmentId: 1 } })), 6); // sổ BGĐ giao về phòng KHCN
  assert.equal(S.departmentOf(item(2, 'STARTED', { project: { departmentId: 2 } })), 2);
  assert.equal(S.departmentOf({ project: null }), null);
  assert.equal(S.inDepartment(item(1, 'STARTED', { leadDepartmentId: 6 }), '6'), true);
  assert.equal(S.inDepartment(item(1, 'STARTED', { leadDepartmentId: 6 }), 1), false);
  assert.deepEqual(S.departmentWhere(6), { OR: [{ leadDepartmentId: 6 }, { leadDepartmentId: null, project: { departmentId: 6 } }] });
  assert.deepEqual(S.departmentWhere(null).OR[0], { leadDepartmentId: -1 });
});

test('thời gian xử lý = hoàn thành − (bắt đầu ?? ngày giao ?? ngày tạo); bỏ giá trị âm', () => {
  const done = at('2026-10-10T09:00:00+07:00');
  assert.equal(S.processingDays({ completedAt: done, startedAt: at('2026-10-08T09:00:00+07:00'), assignedAt: at('2026-10-01T09:00:00+07:00') }), 2);
  assert.equal(S.processingDays({ completedAt: done, startedAt: null, assignedAt: at('2026-10-06T09:00:00+07:00') }), 4);
  assert.equal(S.processingDays({ completedAt: done, startedAt: null, assignedAt: null, createdAt: at('2026-10-09T09:00:00+07:00') }), 1);
  assert.equal(S.processingDays({ completedAt: done, startedAt: at('2026-10-12T09:00:00+07:00') }), null); // bắt đầu sau khi xong → bỏ
  assert.equal(S.processingDays({ completedAt: null, startedAt: done }), null);
  assert.equal(S.processingDays({ completedAt: 'không phải ngày', startedAt: done }), null);
});

test('chỉ số kỳ: đúng hạn, Kế hoạch năm, Đột xuất, xếp loại, ngày xử lý không âm', () => {
  const items = [
    // Đột xuất giao trong kỳ, xong đúng hạn, xếp loại Tốt.
    item(1, 'COMPLETED', { assignedAt: at('2026-10-02T08:00:00+07:00'), startedAt: at('2026-10-03T08:00:00+07:00'), dueDate: at('2026-10-10T00:00:00+07:00'),
      completedAt: at('2026-10-10T17:00:00+07:00'), rating: 'GOOD', ratedAt: at('2026-10-11T08:00:00+07:00') }),
    // Đột xuất giao trong kỳ, xong trễ hạn, xếp loại Xuất sắc; bắt đầu ghi sau khi xong (dữ liệu lỗi) → bỏ khỏi ngày xử lý.
    item(2, 'COMPLETED', { assignedAt: at('2026-10-02T08:00:00+07:00'), startedAt: at('2026-10-14T08:00:00+07:00'), dueDate: at('2026-10-05T00:00:00+07:00'),
      completedAt: at('2026-10-12T10:00:00+07:00'), rating: 'EXCELLENT', ratedAt: at('2026-10-12T10:00:00+07:00') }),
    // Đột xuất đang quá hạn.
    item(3, 'STARTED', { assignedAt: at('2026-10-05T08:00:00+07:00'), dueDate: at('2026-10-15T00:00:00+07:00') }),
    // Đến hạn hôm nay, chưa xong → chưa chấm, chưa quá hạn.
    item(4, 'UNSTARTED', { assignedAt: at('2026-10-06T08:00:00+07:00'), dueDate: at('2026-10-16T00:00:00+07:00') }),
    // Kế hoạch năm: 2 nhiệm vụ đến hạn trong kỳ (1 xong), 1 đến hạn tháng 12 (không tính), 1 bị huỷ.
    item(5, 'COMPLETED', { taskType: 'PLAN', assignedAt: at('2026-01-05T08:00:00+07:00'), dueDate: at('2026-10-20T00:00:00+07:00'), completedAt: at('2026-10-14T08:00:00+07:00') }),
    item(6, 'STARTED', { taskType: 'PLAN', assignedAt: at('2026-01-05T08:00:00+07:00'), dueDate: at('2026-10-30T00:00:00+07:00') }),
    item(7, 'UNSTARTED', { taskType: 'PLAN', assignedAt: at('2026-01-05T08:00:00+07:00'), dueDate: at('2026-12-15T00:00:00+07:00') }),
    item(8, 'CANCELLED', { taskType: 'PLAN', dueDate: at('2026-10-20T00:00:00+07:00') }),
    // Xong trong kỳ, xếp loại Không hoàn thành nhưng xếp loại ở kỳ trước → không tính vào xếp loại kỳ này.
    item(9, 'COMPLETED', { completedAt: at('2026-10-01T08:00:00+07:00'), rating: 'FAIL', ratedAt: at('2026-09-30T08:00:00+07:00'),
      rejectionDates: [at('2026-09-29T08:00:00+07:00'), at('2026-10-01T07:00:00+07:00')] }),
  ];
  const m = S.metrics(items, { from, to, now });
  assert.equal(m.dueInPeriod, 6); // 1,2,3,4,5,6
  assert.equal(m.judged, 4); // 1,2 (xong), 3 (đã qua hạn), 5 (xong)
  assert.equal(m.onTime, 2); // 1 và 5
  assert.equal(m.late, 2);
  assert.equal(m.onTimeRate, 50);
  assert.equal(m.completed, 4); // 1,2,5,9
  assert.equal(m.durationSamples, 3); // 2 bị bỏ (âm)
  assert.ok(m.avgDays >= 0);
  assert.equal(m.overdueNow, 1);
  assert.equal(m.openNow, 4);
  assert.deepEqual([m.rated, m.ratingAvg], [2, 92.5]);
  assert.equal(m.rejections, 1);
  assert.deepEqual(m.plan, { total: 2, completed: 1, rate: 50 });
  assert.deepEqual(m.adhoc, { assigned: 4, completed: 2, onTime: 1, late: 2 });
  assert.equal(m.assigned, 4);
});

test('điểm tổng hợp: trọng số, chia lại khi thiếu thành phần, điểm khối lượng tối đa 100', () => {
  const w = { onTime: 40, rating: 40, volume: 20 };
  assert.equal(S.compositeScore({ onTime: 80, rating: 85, volume: 100 }, w), 86);
  assert.equal(S.compositeScore({ onTime: 80, rating: null, volume: 50 }, w), 70); // (40×80 + 20×50) / 60
  assert.equal(S.compositeScore({ onTime: null, rating: null, volume: null }, w), null);
  assert.equal(S.compositeScore({ onTime: null, rating: null, volume: 0 }, w), null); // chỉ có khối lượng → chưa đủ căn cứ
  assert.equal(S.compositeScore({ onTime: null, rating: 70, volume: 100 }, w), 80); // (40×70 + 20×100) / 60
  assert.equal(S.compositeScore({ onTime: 100, rating: 0, volume: null }, { onTime: 0, rating: 0, volume: 0 }), 50); // trọng số rỗng → mặc định
  assert.equal(S.volumeScore(6, 4), 100);
  assert.equal(S.volumeScore(2, 4), 50);
  assert.equal(S.volumeScore(0, 4), 0);
  assert.equal(S.volumeScore(3, 0), null);
  assert.deepEqual(S.normalizeWeights({ onTime: '50', rating: -5, volume: 'x' }), { onTime: 50, rating: 0, volume: 0 });
});

test('KPI theo phòng chủ trì và cá nhân: việc sổ BGĐ giao về phòng tính cho phòng chủ trì; khối lượng so với bình quân phòng', () => {
  const done = (id, userId, extra = {}) => item(id, 'COMPLETED', { assignees: [{ userId }], assignedAt: at('2026-10-02T08:00:00+07:00'), dueDate: at('2026-10-20T00:00:00+07:00'), completedAt: at('2026-10-09T08:00:00+07:00'), ...extra });
  const items = [
    // Sổ giao việc Trung tâm (dự án thuộc BGĐ = phòng 1) giao về phòng KHCN (6).
    done(1, 11, { leadDepartmentId: 6, rating: 'EXCELLENT', ratedAt: at('2026-10-09T08:00:00+07:00') }),
    done(2, 11, { leadDepartmentId: 6 }), done(3, 11, { leadDepartmentId: 6 }), done(4, 11, { leadDepartmentId: 6 }),
    done(5, 12, { leadDepartmentId: 6, rating: 'PASS', ratedAt: at('2026-10-09T08:00:00+07:00') }),
    done(6, 13, { leadDepartmentId: 6 }),
    item(7, 'STARTED', { assignees: [{ userId: 13 }], leadDepartmentId: 6, assignedAt: at('2026-10-02T08:00:00+07:00'), dueDate: at('2026-10-12T00:00:00+07:00') }),
    // Việc nội bộ của phòng Kinh doanh (2), 1 cán bộ.
    done(8, 21, { project: { departmentId: 2 } }),
    // Việc ngoài kỳ, đã đóng → không liên quan.
    item(9, 'COMPLETED', { assignees: [{ userId: 22 }], project: { departmentId: 2 }, completedAt: at('2026-08-01T08:00:00+07:00'), assignedAt: at('2026-07-01T08:00:00+07:00') }),
  ];
  const users = [
    { id: 11, fullName: 'Cán bộ A', departmentId: 6, departmentName: 'Phòng KHCN' }, { id: 12, fullName: 'Cán bộ B', departmentId: 6, departmentName: 'Phòng KHCN' },
    { id: 13, fullName: 'Cán bộ C', departmentId: 6, departmentName: 'Phòng KHCN' }, { id: 21, fullName: 'Cán bộ D', departmentId: 2, departmentName: 'Phòng Kinh doanh' },
    { id: 22, fullName: 'Cán bộ E', departmentId: 2, departmentName: 'Phòng Kinh doanh' },
  ];
  const departments = [{ id: 1, name: 'Ban Giám đốc' }, { id: 2, name: 'Phòng Kinh doanh' }, { id: 6, name: 'Phòng KHCN' }];
  const k = S.computeKpi(items, { users, departments, from, to, now, weights: { onTime: 40, rating: 40, volume: 20 } });
  // Ban Giám đốc không "nhận" việc của sổ; Phòng KHCN có 7 việc.
  assert.deepEqual(k.byDepartment.map(d => d.name), ['Phòng Kinh doanh', 'Phòng KHCN']);
  const khcn = k.byDepartment.find(d => d.id === 6);
  assert.equal(khcn.completed, 6);
  assert.equal(khcn.overdueNow, 1);
  assert.equal(khcn.officers, 3);
  // Bình quân phòng KHCN = (4 + 1 + 1) / 3 = 2 việc → A: 100 (trần), B: 50, C: 50.
  const a = k.byPerson.find(p => p.id === 11), b = k.byPerson.find(p => p.id === 12), c = k.byPerson.find(p => p.id === 13);
  assert.deepEqual([a.components.volume, b.components.volume, c.components.volume], [100, 50, 50]);
  assert.equal(a.score, 100); // đúng hạn 100, xếp loại 100, khối lượng 100
  assert.equal(b.score, 78); // (40×100 + 40×70 + 20×50) / 100
  assert.equal(c.onTimeRate, 50); // 1 đúng hạn, 1 quá hạn
  assert.equal(c.score, 50); // không có xếp loại → (40×50 + 20×50) / 60
  // Phòng Kinh doanh chỉ 1 cán bộ có số liệu → không tính khối lượng (tránh suy ra số liệu cá nhân).
  const d = k.byPerson.find(p => p.id === 21);
  assert.equal(d.components.volume, null);
  assert.equal(d.score, 100);
  assert.equal(k.byPerson.some(p => p.id === 22), false);
  // Khối lượng phòng: bình quân mỗi cán bộ KHCN 2 việc, Kinh doanh 1 việc → bình quân các phòng 1,5.
  assert.equal(khcn.components.volume, 100);
  assert.equal(k.byDepartment.find(x => x.id === 2).components.volume, 66.7);
  assert.equal(k.total.completed, 7);
});

test('kỳ thống kê theo giờ Việt Nam và định dạng dd/mm/yyyy HH:mm', () => {
  const late = at('2026-09-30T18:30:00Z'); // 01:30 ngày 01/10 giờ VN
  const m = S.vnPeriod(late, 'month');
  assert.equal(m.label, 'Tháng 10/2026');
  assert.equal(m.from.toISOString(), '2026-09-30T17:00:00.000Z');
  assert.equal(m.to.toISOString(), '2026-10-31T16:59:59.999Z');
  const q = S.vnPeriod(late, 'quarter');
  assert.equal(q.label, 'Quý IV/2026');
  assert.equal(q.to.toISOString(), '2026-12-31T16:59:59.999Z');
  assert.equal(S.vnPeriod(at('2026-02-10T00:00:00Z'), 'quarter').label, 'Quý I/2026');
  assert.equal(S.vnPeriod(late, 'year').from.toISOString(), '2025-12-31T17:00:00.000Z');
  assert.equal(S.vnDayStart('2026-10-01').toISOString(), '2026-09-30T17:00:00.000Z');
  assert.equal(S.vnDayStart('01/10/2026'), null);
  assert.equal(S.vnDate(late), '01/10/2026');
  assert.equal(S.vnDateTime(late), '01/10/2026 01:30');
  assert.equal(S.vnDateTime(null), '');
  assert.equal(S.endOfLocalDay(at('2026-10-16T00:00:00+07:00')).toISOString(), '2026-10-16T16:59:59.999Z');
  assert.equal(S.isOverdue(item(1, 'STARTED', { dueDate: at('2026-10-15T00:00:00+07:00') }), now), true);
  assert.equal(S.isOverdue(item(1, 'STARTED', { dueDate: at('2026-10-16T00:00:00+07:00') }), now), false);
});

test('relevant: chỉ lấy việc đang mở hoặc có mốc trong kỳ', () => {
  assert.equal(S.relevant(item(1, 'STARTED'), { from, to }), true);
  assert.equal(S.relevant(item(2, 'COMPLETED', { completedAt: at('2026-09-01T00:00:00Z') }), { from, to }), false);
  assert.equal(S.relevant(item(3, 'COMPLETED', { completedAt: at('2026-09-01T00:00:00Z'), ratedAt: at('2026-10-02T00:00:00Z') }), { from, to }), true);
  assert.equal(S.relevant(item(4, 'CANCELLED', { createdAt: at('2026-10-02T00:00:00Z') }), { from, to }), true);
  assert.ok(DAY > 0);
});
