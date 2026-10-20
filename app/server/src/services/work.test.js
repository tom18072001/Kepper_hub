const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./work');

const P = (key, action, scope) => ({ permissionKey: key, action, scope });
const director = { id: 1, departmentId: 9, role: 'user', permissions: [P('work.view', 'VIEW', 'SYSTEM'), P('work.approve', 'OPERATE', 'SYSTEM')] };
const lead = { id: 2, departmentId: 5, role: 'user', permissions: [P('work.view', 'VIEW', 'UNIT'), P('work.approve', 'OPERATE', 'UNIT')] };
const staff = { id: 3, departmentId: 5, role: 'user', permissions: [P('work.view', 'VIEW', 'UNIT')] };
const itAdmin = { id: 4, role: 'admin', permissions: [] };

test('phạm vi xem việc theo vai trò', () => {
  assert.equal(W.workScope(director), 'SYSTEM');
  assert.equal(W.workScope(lead), 'UNIT');
  assert.equal(W.workScope(staff), 'SELF');
  assert.equal(W.workScope(itAdmin), null);
});

test('lãnh đạo phòng chỉ xem người / phòng mình; cán bộ chỉ xem chính mình', () => {
  const s = u => W.workScope(u);
  assert.ok(W.canViewSubject(director, s(director), { type: 'user', id: 99, departmentId: 7 }));
  assert.ok(W.canViewSubject(director, s(director), { type: 'all' }));
  assert.ok(W.canViewSubject(lead, s(lead), { type: 'dept', id: 5 }));
  assert.ok(W.canViewSubject(lead, s(lead), { type: 'user', id: 3, departmentId: 5 }));
  assert.ok(!W.canViewSubject(lead, s(lead), { type: 'dept', id: 7 }));
  assert.ok(!W.canViewSubject(lead, s(lead), { type: 'user', id: 8, departmentId: 7 }));
  assert.ok(!W.canViewSubject(lead, s(lead), { type: 'all' }));
  assert.ok(W.canViewSubject(staff, s(staff), { type: 'user', id: 3, departmentId: 5 }));
  assert.ok(!W.canViewSubject(staff, s(staff), { type: 'user', id: 2, departmentId: 5 }));
  assert.ok(!W.canViewSubject(staff, s(staff), { type: 'dept', id: 5 }));
  assert.ok(!W.canViewSubject(itAdmin, s(itAdmin), { type: 'user', id: 4 }));
});

test('vai trò của một người với việc', () => {
  const item = { assignees: [{ userId: 3 }], supporters: [{ userId: 4 }], assignedById: 2 };
  assert.deepEqual(W.rolesOf(item, 3), ['LEAD']);
  assert.deepEqual(W.rolesOf(item, 4), ['SUPPORT']);
  assert.deepEqual(W.rolesOf(item, 2), ['ASSIGNER']);
  assert.deepEqual(W.rolesOf(item, 5), []);
});

test('lọc trạng thái và chỉ số theo kỳ', () => {
  const now = new Date('2026-10-17T03:00:00Z');
  const open = c => ({ state: { category: c } });
  const overdue = { ...open('STARTED'), dueDate: new Date('2026-10-10T00:00:00Z') };
  const soon = { ...open('STARTED'), dueDate: new Date('2026-10-18T00:00:00Z') };
  const doneLate = { ...open('COMPLETED'), dueDate: new Date('2026-10-05T00:00:00Z'), completedAt: new Date('2026-10-08T00:00:00Z'), assignedAt: new Date('2026-10-01T00:00:00Z') };
  const doneOk = { ...open('COMPLETED'), dueDate: new Date('2026-10-12T00:00:00Z'), completedAt: new Date('2026-10-11T00:00:00Z'), assignedAt: new Date('2026-09-01T00:00:00Z') };
  assert.ok(W.matchStatus(overdue, 'overdue', now, 3));
  assert.ok(W.matchStatus(soon, 'soon', now, 3) && !W.matchStatus(soon, 'overdue', now, 3));
  assert.ok(W.matchStatus(doneLate, 'done', now, 3) && !W.matchStatus(doneLate, 'open', now, 3));
  const period = { from: new Date('2026-09-30T17:00:00Z'), to: new Date('2026-10-31T16:59:59Z'), now };
  const all = [overdue, soon, doneLate, doneOk];
  const pick = m => all.filter(W.metricPredicate(m, period));
  assert.deepEqual(pick('completed'), [doneLate, doneOk]);
  assert.deepEqual(pick('onTime'), [doneOk]);
  assert.deepEqual(pick('late'), [overdue, doneLate]);
  assert.deepEqual(pick('overdueNow'), [overdue]);
  assert.deepEqual(pick('assigned'), [doneLate]);
  assert.equal(W.metricPredicate('khong-co', period), null);
});
