// Ma trận quyền CRM / HRM (playground) — kiểm từng ô như policy.test.js. Đổi lib/policy.js thì đổi bảng này.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./policy');

const OWN = 1, OTHER = 2;
const S = {
  it: { it: true, departmentId: OWN, userId: 1 },
  director: { director: true, leader: true, departmentId: 9, userId: 2 },
  hr: { hr: true, departmentId: 5, userId: 3 },
  leader: { leader: true, departmentId: OWN, userId: 5 },
  member: { departmentId: OWN, userId: 6 },
  outsider: { departmentId: OTHER, userId: 7 },
  owner: { departmentId: OTHER, userId: 8 }, // người phụ trách đối tác, ở bộ phận khác
};
const ROLES = Object.keys(S);
const allow = (dataset, action, ctx, yes) => {
  for (const r of ROLES) assert.equal(P.can(S[r], action, dataset, ctx), yes.includes(r), `${dataset} · ${action} · ${r} · ${JSON.stringify(ctx)}`);
};

test('IT không có quyền trên CRM / HRM', () => {
  for (const d of Object.keys(P.DATASETS).filter(x => /^(crm|hrm)\./.test(x))) for (const a of P.ACTIONS)
    assert.equal(P.can(S.it, a, d, { departmentId: OWN, targetUserId: 1, ownerUserId: 1, participant: true }), false, `${d} ${a}`);
});

test('CRM: danh bạ tổ chức mọi người xem; chi tiết chỉ bộ phận phụ trách + người phụ trách + Ban GĐ', () => {
  const c = { departmentId: OWN, ownerUserId: 8 };
  allow('crm.partner', 'view', c, ['director', 'hr', 'leader', 'member', 'outsider', 'owner']);
  allow('crm.partner', 'edit', c, ['director', 'leader', 'member', 'owner']);
  allow('crm.partner', 'edit', { ...c, op: 'archive' }, ['director', 'leader']);
  allow('crm.partner', 'edit', { ...c, op: 'transfer' }, ['director', 'leader']);
  allow('crm.contact', 'view', c, ['director', 'leader', 'member', 'owner']);
  allow('crm.interaction', 'view', c, ['director', 'leader', 'member', 'owner']);
  allow('crm.interaction', 'view', { ...c, participant: true }, ['director', 'hr', 'leader', 'member', 'outsider', 'owner']);
  allow('crm.interaction', 'edit', c, ['director', 'leader', 'member', 'owner']);
  allow('crm.interaction', 'edit', { ...c, op: 'followup', participant: true }, ['director', 'hr', 'leader', 'member', 'outsider', 'owner']);
  allow('crm.engagement', 'view', c, ['director', 'leader', 'owner']); // giá trị hợp đồng: không phải mọi thành viên
  allow('crm.engagement', 'edit', c, ['director', 'leader', 'owner']);
});

test('CRM: không gửi ra ngoài (mail / Viber) người liên hệ, nhật ký, hợp đồng', () => {
  for (const d of ['crm.contact', 'crm.interaction', 'crm.engagement']) for (const r of ROLES) assert.equal(P.can(S[r], 'external', d, { departmentId: OWN }), false);
});

test('HRM hồ sơ: tự xem; HR, Ban GĐ xem đủ; lãnh đạo bộ phận chỉ trường cơ bản; tự sửa liên hệ', () => {
  const t = { targetUserId: 6, departmentId: OWN };
  allow('hrm.profile', 'view', t, ['director', 'hr', 'leader', 'member']);
  allow('hrm.profile', 'view', { ...t, field: 'private' }, ['director', 'hr', 'member']);
  allow('hrm.profile', 'edit', t, ['hr']);
  allow('hrm.profile', 'edit', { ...t, op: 'contact' }, ['hr', 'member']);
  allow('hrm.identity', 'view', t, ['hr', 'member']); // Ban GĐ không cần số CCCD
  allow('hrm.identity', 'edit', t, ['hr']);
  allow('hrm.contract', 'view', t, ['director', 'hr', 'member']);
  allow('hrm.contract', 'edit', t, ['hr']);
  for (const d of ['hrm.profile', 'hrm.identity', 'hrm.contract', 'hrm.leave', 'hrm.attendance']) for (const r of ROLES) assert.equal(P.can(S[r], 'external', d, t), false);
  assert.deepEqual(P.NEVER_AI_FIELDS['hrm.identity'], ['idNumber']);
  assert.deepEqual(P.NEVER_AI_FIELDS['hrm.contract'], ['salary']);
});

test('HRM nghỉ phép: tự lập; lãnh đạo bộ phận duyệt nhân viên; đơn của lãnh đạo: Ban GĐ; không tự duyệt', () => {
  const t = { targetUserId: 6, departmentId: OWN };
  allow('hrm.leave', 'view', t, ['director', 'hr', 'leader', 'member']);
  allow('hrm.leave', 'edit', { ...t, op: 'create' }, ['hr', 'member']);
  allow('hrm.leave', 'edit', { ...t, op: 'approve' }, ['director', 'leader']);
  allow('hrm.leave', 'edit', { ...t, op: 'cancel' }, ['hr', 'member']);
  const lt = { targetUserId: 5, departmentId: OWN, targetLeader: true };
  allow('hrm.leave', 'edit', { ...lt, op: 'approve' }, ['director']); // trưởng bộ phận không tự duyệt
  const dt = { targetUserId: 2, departmentId: 9, targetLeader: true };
  allow('hrm.leave', 'edit', { ...dt, op: 'approve' }, []); // Ban GĐ không tự duyệt đơn của mình
});

test('HRM chấm công: tự chấm / giải trình; duyệt: lãnh đạo bộ phận, HR, Ban GĐ (không tự duyệt); HR nhập máy chấm công không cho chính mình', () => {
  const t = { targetUserId: 6, departmentId: OWN };
  allow('hrm.attendance', 'view', t, ['director', 'hr', 'leader', 'member']);
  allow('hrm.attendance', 'edit', { ...t, op: 'check' }, ['member']);
  allow('hrm.attendance', 'edit', { ...t, op: 'explain' }, ['member']);
  allow('hrm.attendance', 'edit', { ...t, op: 'approve' }, ['director', 'hr', 'leader']);
  allow('hrm.attendance', 'edit', { ...t, op: 'hr' }, ['hr']);
  allow('hrm.attendance', 'edit', { targetUserId: 3, departmentId: 5, op: 'hr' }, []);
  allow('hrm.attendance', 'edit', { targetUserId: 3, departmentId: 5, op: 'approve' }, ['director']);
});

test('HRM thiết lập: chỉ Ban GĐ chỉ định người phụ trách nhân sự', () => {
  allow('hrm.config', 'view', {}, ['director', 'hr', 'leader', 'member', 'outsider', 'owner']);
  allow('hrm.config', 'edit', {}, ['director', 'hr']);
  allow('hrm.config', 'edit', { field: 'roles' }, ['director']);
});

test('AI = quyền xem của người dùng (cả CRM / HRM)', () => {
  const t = { targetUserId: 6, departmentId: OWN, ownerUserId: 8 };
  for (const d of Object.keys(P.DATASETS).filter(x => /^(crm|hrm)\./.test(x))) for (const r of ROLES)
    assert.equal(P.can(S[r], 'ai', d, t), P.can(S[r], 'view', d, t), `${d} ${r}`);
});
