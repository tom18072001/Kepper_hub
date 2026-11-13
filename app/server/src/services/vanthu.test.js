const test = require('node:test');
const assert = require('node:assert');
const V = require('./vanthu');
const cfg = { workDays: [1, 2, 3, 4, 5], holidays: ['2026-11-24'] };

test('số và ký hiệu theo QyĐ-GA-01 Điều 7.2', () => {
  assert.equal(V.numberOf({ series: 'D10', entity: 'HLD', year: 2026, seq: 123 }), '0123/2026/Đ-HLD');
  assert.equal(V.numberOf({ series: 'D9', entity: 'HLD', year: 2026, seq: 45, docType: 'CV', deptCode: 'INV' }), '045/2026/HLD-INV');
  assert.equal(V.numberOf({ series: 'D9', entity: 'HLD', year: 2026, seq: 46, docType: 'TB' }), '046/2026/TB-HLD');
  assert.equal(V.numberOf({ series: 'D5', entity: 'DXA', year: 2026, seq: 2 }), '002/2026/QĐ-DXA');
  assert.equal(V.numberOf({ series: 'D6', entity: 'HLD', year: 2026, seq: 7, docType: 'TTr' }), '007/2026/TTr-TGĐ');
  assert.equal(V.numberOf({ series: 'D6', entity: 'DXA', year: 2026, seq: 3, docType: 'TB', holding: false }), '003/2026/TB-GĐ.DXA');
  assert.equal(V.numberOf({ series: 'D7-FIN', entity: 'HLD', year: 2026, seq: 12, docType: 'TTr' }), '012/2026/TTr-FIN');
  assert.equal(V.numberOf({ series: 'D10', entity: 'HLD', year: 2026, seq: 12345 }), '12345/2026/Đ-HLD'); // vượt ngưỡng thêm chữ số
});

test('hạn xử lý văn bản đến theo độ khẩn (Điều 12), bỏ cuối tuần và ngày lễ', () => {
  assert.equal(V.dueFor('HOA_TOC', '2026-11-13', cfg), '2026-11-13'); // thứ Sáu: trong ngày
  assert.equal(V.dueFor('THUONG_KHAN', '2026-11-13', cfg), '2026-11-16'); // 1 ngày làm việc → thứ Hai
  assert.equal(V.dueFor('KHAN', '2026-11-20', cfg), '2026-11-26'); // qua cuối tuần + lễ 24/11
  assert.equal(V.dueFor('THUONG', '2026-11-14', cfg), '2026-11-26'); // nhận thứ Bảy → tính từ thứ Hai, 7 ngày làm việc, bỏ lễ 24/11
});

test('quyền xem theo mức bảo mật (Điều 5)', () => {
  const staff = { userId: 9, departmentId: 3 }, clerk = { userId: 2, clerk: true }, dir = { userId: 1, director: true }, it = { it: true, userId: 50 };
  const noiBo = { security: 'NOI_BO', createdById: 2 };
  const hanChe = { security: 'HAN_CHE', departmentId: 4, handlerId: 7, createdById: 2 };
  const mat = { security: 'BAO_MAT_CAO', viewerIds: [9], handlerId: 7, createdById: 2 };
  assert.ok(V.canView(noiBo, staff)); assert.ok(!V.canView(noiBo, it));
  assert.ok(!V.canView(hanChe, staff)); assert.ok(V.canView(hanChe, { userId: 8, departmentId: 4 })); assert.ok(V.canView(hanChe, clerk));
  assert.ok(V.canView({ ...hanChe, toLegal: true }, { userId: 30, legal: true }));
  assert.ok(V.canView(mat, staff)); assert.ok(V.canView(mat, { userId: 2, clerk: true })); // văn thư vào sổ assert.ok(V.canView(mat, dir));
  assert.ok(!V.canView(mat, { userId: 11, clerk: true }));
});

test('ai được vào sổ / đổi trạng thái', () => {
  assert.ok(V.canRegister({ clerk: true }, 'D10')); assert.ok(!V.canRegister({ userId: 9 }, 'D10'));
  assert.ok(V.canRegister({ leader: true, departmentId: 3 }, 'D7', 3)); assert.ok(!V.canRegister({ leader: true, departmentId: 3 }, 'D7', 4));
  const doc = { handlerId: 9, departmentId: 3 };
  assert.ok(V.canStatus(doc, { userId: 9 }, 'DONE')); assert.ok(!V.canStatus(doc, { userId: 9 }, 'FILED'));
  assert.ok(!V.canStatus({ ...doc, cancelledAt: new Date() }, { director: true }, 'DONE'));
});
