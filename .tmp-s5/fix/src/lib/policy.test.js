// Kiểm từng ô của QUY ĐỊNH PHÂN QUYỀN DỮ LIỆU (lib/policy.js). Đổi ma trận thì phải đổi bảng này — chống lệch quyền âm thầm.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./policy');

const OWN = 1, OTHER = 2;
const S = {
  it: { it: true, departmentId: OWN, userId: 1 },
  director: { director: true, leader: true, departmentId: 9, userId: 2 },
  secretary: { secretary: true, departmentId: 5, userId: 3, mustReport: true },
  pmo: { pmo: true, departmentId: 9, userId: 4 },
  leader: { leader: true, departmentId: OWN, userId: 5, mustReport: true },
  member: { departmentId: OWN, userId: 6, mustReport: true },
  outsider: { departmentId: OTHER, userId: 7, mustReport: true },
};
const ROLES = Object.keys(S);
const allow = (dataset, action, ctx, yes) => {
  for (const r of ROLES) assert.equal(P.can(S[r], action, dataset, ctx), yes.includes(r), `${dataset} · ${action} · ${r} · ${JSON.stringify(ctx)}`);
};

test('QĐ-01: quản trị IT không có quyền nào trên dữ liệu nghiệp vụ', () => {
  for (const d of Object.keys(P.DATASETS)) for (const a of P.ACTIONS) assert.equal(P.can(S.it, a, d, { departmentId: OWN, item: { projectManager: true } }, { aiEnabled: true }), false, `${d} ${a}`);
});

test('Báo cáo tuần: lập / gửi đúng bộ phận; Ban GĐ không lập; thư ký nhập thay; xem bộ phận khác chỉ người nhận đầy đủ', () => {
  allow('weekly.report', 'view', { departmentId: OWN }, ['director', 'secretary', 'pmo', 'leader', 'member']);
  allow('weekly.report', 'edit', { departmentId: OWN }, ['secretary', 'leader', 'member']);
  allow('weekly.report', 'view', { departmentId: OTHER }, ['director', 'secretary', 'pmo', 'outsider']);
  allow('weekly.report', 'edit', { departmentId: OTHER }, ['secretary', 'outsider']);
  allow('weekly.report', 'edit', { departmentId: 9 }, ['secretary', 'pmo']); // phòng Ban GĐ: giám đốc không tự lập (thành viên khác của phòng vẫn là thành viên)
});

test('Tổng hợp: trưởng / phó nhận bản tóm tắt (Điều 5); chi tiết chỉ Ban GĐ, thư ký, PMO', () => {
  allow('weekly.summary', 'view', {}, ['director', 'secretary', 'pmo', 'leader']);
  allow('weekly.summary.detail', 'view', {}, ['director', 'secretary', 'pmo']);
  allow('weekly.meeting', 'edit', {}, ['director', 'secretary']);
  allow('weekly.compliance', 'view', {}, ['director', 'secretary']);
  allow('weekly.config', 'edit', {}, ['director', 'secretary']);
  allow('weekly.roles', 'edit', {}, ['director']);
});

test('Thông báo muộn / vắng: lãnh đạo xem bộ phận mình; ghi chú lý do chỉ người tạo, thư ký, Ban GĐ', () => {
  allow('weekly.notice', 'view', { departmentId: OWN, createdById: 99 }, ['director', 'secretary', 'pmo', 'leader']);
  allow('weekly.notice', 'view', { departmentId: OWN, createdById: 6 }, ['director', 'secretary', 'pmo', 'leader', 'member']);
  allow('weekly.notice', 'view', { departmentId: OWN, createdById: 6, field: 'note' }, ['director', 'secretary', 'member']);
  allow('weekly.notice', 'edit', { departmentId: OWN }, ['secretary', 'leader', 'member']);
  allow('weekly.notice', 'edit', { departmentId: OWN, createdById: 6, op: 'delete' }, ['secretary', 'member']);
});

test('MTL: % / checklist — người được giao, lãnh đạo bộ phận chủ trì, người quản lý dự án; kế hoạch chỉ người quản lý dự án', () => {
  const item = { assigneeIds: [6], leadLeaderIds: [5], projectManager: false };
  allow('mtl.progress', 'edit', { item }, ['leader', 'member']);
  allow('mtl.progress', 'edit', { item: { ...item, projectManager: true } }, ROLES.filter(r => r !== 'it'));
  allow('mtl.plan', 'edit', { item }, []);
  allow('mtl.plan', 'edit', { item: { ...item, projectManager: true } }, ROLES.filter(r => r !== 'it'));
  // Lãnh đạo bộ phận chủ trì: thêm / sửa việc con, phân công — không sửa bước tổng, không đổi cấu trúc.
  for (const op of ['child', 'detail', 'assign']) allow('mtl.plan', 'edit', { item, op }, ['leader']);
  allow('mtl.plan', 'edit', { item, op: 'struct' }, []);
  // Xuất ra tệp: quản lý dự án, Ban GĐ; lãnh đạo bộ phận phần bộ phận mình.
  allow('mtl.plan', 'export', { item }, ['director']);
  allow('mtl.progress', 'export', { item, op: 'dept' }, ['director', 'leader']);
  allow('mtl.plan', 'export', { item: { ...item, projectManager: true } }, ROLES.filter(r => r !== 'it'));
});

test('KPI cá nhân: chính mình, lãnh đạo bộ phận mình, Ban GĐ, quản lý dự án; không bao giờ gửi ra ngoài', () => {
  allow('kpi.person', 'view', { departmentId: OWN }, ['director', 'leader']);
  allow('kpi.person', 'view', { departmentId: OTHER }, ['director']);
  allow('kpi.person', 'view', { departmentId: OTHER, self: true }, ROLES.filter(r => r !== 'it'));
  for (const r of ROLES) assert.equal(P.can(S[r], 'external', 'kpi.person', {}), false);
});

test('QĐ-AI / QĐ-EXT: AI dùng đúng quyền xem của người dùng (không rộng hơn); gửi ra ngoài chỉ bản tóm tắt', () => {
  for (const r of ROLES) for (const d of Object.keys(P.DATASETS)) for (const ctx of [{}, { departmentId: OWN }, { departmentId: OTHER, createdById: 6 }])
    assert.equal(P.can(S[r], 'ai', d, ctx), P.can(S[r], 'view', d, ctx), `${r} ${d} ${JSON.stringify(ctx)}`);
  assert.equal(P.can(S.it, 'ai', 'weekly.summary'), false); // QĐ-01 vẫn giữ
  assert.equal(P.can(S.member, 'ai', 'weekly.summary.detail'), false);
  allow('weekly.summary', 'external', {}, ['director', 'secretary']);
  for (const d of P.NEVER_EXTERNAL) for (const r of ROLES) assert.equal(P.can(S[r], 'external', d), false);
  assert.throws(() => P.assertCan(S.member, 'edit', 'weekly.roles'), e => e.status === 403 && e.code === 'FORBIDDEN');
});
