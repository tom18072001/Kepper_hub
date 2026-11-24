// MA TRẬN QUYỀN THEO MỘT TRỤC VAI (chủ dự án duyệt 24/11/2026 — docs/de-xuat-mot-he-quy-chieu-phan-quyen.md, bảng 5.4).
// Mỗi ô: vai (+ kiêm nhiệm / quan hệ với việc) × chức năng → được / không. Chạy đúng các hàm quyết định mà endpoint gọi
// (permissionScope, lib/policy.js, services/access.js, services/task-access.js, lib/project-docs.js, services/vanthu.js,
// routes/analytics.js). Ma trận HTTP chạy trên server thật: app/e2e/tests/17-ma-tran-vai.spec.js.
// Thêm / bớt một ô = sửa bảng 5.4 trong tài liệu VÀ ô tương ứng ở đây.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('./permissions');
const Policy = require('./policy');
const PD = require('./project-docs');
const V = require('../services/vanthu');
const WD = require('../services/weekly-data');
const { projectRights } = require('../services/access');
const TA = require('../services/task-access');
const { assertAnalyticsAccess } = require('../routes/analytics');

// ---------- Người (dữ liệu GIẢ) ----------
// Bộ phận: 1 = Ban Tổng Giám đốc (BTGD), 2 = bộ phận chủ trì, 3 = Phòng Tổng hợp (PMO), 4 = bộ phận thư ký giao ban.
const U = {
  tgd: { id: 1, role: 'director', departmentId: 1, boardAll: true }, // BTGĐ phụ trách Toàn công ty
  ptgd: { id: 2, role: 'director', departmentId: 1 }, // BTGĐ phụ trách bộ phận 2
  lead: { id: 10, role: 'manager', departmentId: 2 }, // Lãnh đạo bộ phận 2
  staff: { id: 11, role: 'member', departmentId: 2 }, // Nhân viên bộ phận 2
  pmo: { id: 30, role: 'member', departmentId: 3 }, // Nhân viên + kiêm nhiệm PMO (tài khoản PMO sau Q1)
  sec: { id: 40, role: 'member', departmentId: 4 }, // Nhân viên bộ phận thư ký giao ban
  it: { id: 90, role: 'admin', departmentId: null }, // Quản trị hệ thống
  root: { id: 91, role: 'admin', isRootAdmin: true, departmentId: null }, // Quản trị gốc
};
const NAMES = Object.keys(U);
const BUSINESS = NAMES.filter(n => !P.isItAdmin(U[n]));
const allowed = fn => NAMES.filter(n => { try { return !!fn(U[n], n); } catch { return false; } }).sort();
const expect = (label, fn, who) => assert.deepEqual(allowed(fn), [...who].sort(), label);

// Chủ thể chính sách (báo cáo tuần, CRM, HRM, văn thư) dựng đúng như route: weekly-data.rolesOf + kiêm nhiệm.
const WEEKLY_CFG = { key: 'weekly.config', value: { secretaryDepartmentId: 4, pmoUserIds: [30] } };
const fakeDb = { appSetting: { findUnique: async ({ where }) => (where.key === WEEKLY_CFG.key ? WEEKLY_CFG : null) } };
let S = {};
test.before(async () => {
  for (const n of NAMES) S[n] = await WD.rolesOf(fakeDb, U[n]);
  for (const n of NAMES) Object.assign(S[n], { hr: false, clerk: false, legal: false });
});

test('vai: mỗi tài khoản đúng một vai trên một trục; BTGĐ / lãnh đạo bộ phận / quản trị chỉ hỏi qua hàm vai', () => {
  expect('isBoard', u => P.isBoard(u), ['tgd', 'ptgd']);
  expect('isDeptLeader', u => P.isDeptLeader(u), ['lead']);
  expect('isItAdmin', u => P.isItAdmin(u), ['it', 'root']);
});

test('xem dự án / việc toàn công ty; tạo + quản lý dự án; xuất Excel', () => {
  expect('xem toàn công ty', u => P.permissionScope(u, 'work.view', 'VIEW') === 'SYSTEM', ['tgd', 'ptgd']);
  expect('xem trong bộ phận', u => P.permissionScope(u, 'work.view', 'VIEW') === 'UNIT', ['lead', 'staff', 'pmo', 'sec']);
  expect('quản lý dự án toàn công ty', u => P.permissionScope(u, 'projects.manage', 'OPERATE') === 'SYSTEM', ['tgd', 'ptgd']);
  expect('quản lý dự án bộ phận mình', u => P.permissionScope(u, 'projects.manage', 'OPERATE') === 'UNIT', ['lead']);
  expect('duyệt cấp bộ phận', u => P.permissionScope(u, 'work.approve', 'OPERATE') === 'UNIT', ['lead']);
  expect('xuất Excel', u => P.hasPermission(u, 'reports.export', 'OPERATE'), ['tgd', 'ptgd', 'lead']);
});

test('KPI & phân tích: chỉ Ban Tổng Giám đốc (endpoint /api/kpi, /api/kpi/analytics); KPI của chính mình: mọi người trừ quản trị', () => {
  expect('reports.kpi toàn công ty', u => P.permissionScope(u, 'reports.kpi', 'VIEW') === 'SYSTEM', ['tgd', 'ptgd']);
  expect('assertAnalyticsAccess', u => (assertAnalyticsAccess(u), true), ['tgd', 'ptgd']);
  expect('kpi.person người khác', n => Policy.can(S[nameOf(n)], 'view', 'kpi.person', { departmentId: 2 }), ['tgd', 'ptgd']);
  expect('kpi.person của mình', n => Policy.can(S[nameOf(n)], 'view', 'kpi.person', { self: true }), BUSINESS);
});
const nameOf = u => NAMES.find(n => U[n] === u);

test('Tài liệu dự án (Hub + NAS): thành viên dự án + Ban Tổng Giám đốc; quản trị không', () => {
  const project = { id: 5, leadId: null, deletedAt: null };
  const members = new Set([11]);
  expect('canViewDocs', u => PD.canViewDocs(u, project, members.has(u.id) ? { role: 'MEMBER' } : null), ['tgd', 'ptgd', 'staff']);
});

test('Văn thư: Bảo mật cao — BTGĐ; Hạn chế — BTGĐ + bộ phận xử lý; Nội bộ — mọi người trừ quản trị; vào sổ — BTGĐ + văn thư', () => {
  const doc = security => ({ security, departmentId: 2, handlerId: null, createdById: null, viewerIds: [] });
  expect('BAO_MAT_CAO', n => V.canView(doc('BAO_MAT_CAO'), S[nameOf(n)]), ['tgd', 'ptgd']);
  expect('HAN_CHE', n => V.canView(doc('HAN_CHE'), S[nameOf(n)]), ['tgd', 'ptgd', 'lead', 'staff']);
  expect('NOI_BO', n => V.canView(doc('NOI_BO'), S[nameOf(n)]), BUSINESS);
  expect('vào sổ dãy thường', n => V.canRegister(S[nameOf(n)], 'D1'), ['tgd', 'ptgd']);
  expect('vào sổ D7 bộ phận 2', n => V.canRegister(S[nameOf(n)], 'D7', 2), ['tgd', 'ptgd', 'lead']);
});

test('Báo cáo tuần: tóm tắt — BTGĐ, lãnh đạo bộ phận, thư ký, PMO; đầy đủ — BTGĐ, thư ký, PMO; gửi ra ngoài — chỉ bản tóm tắt, BTGĐ + thư ký', () => {
  const can = (a, d, ctx) => n => Policy.can(S[nameOf(n)], a, d, ctx);
  expect('weekly.summary', can('view', 'weekly.summary'), ['tgd', 'ptgd', 'lead', 'pmo', 'sec']);
  expect('weekly.summary.detail', can('view', 'weekly.summary.detail'), ['tgd', 'ptgd', 'pmo', 'sec']);
  expect('external summary', can('external', 'weekly.summary'), ['tgd', 'ptgd', 'sec']);
  expect('external detail', can('external', 'weekly.summary.detail'), []);
  expect('lập báo cáo bộ phận 2', can('edit', 'weekly.report', { departmentId: 2 }), ['lead', 'staff', 'sec']);
  expect('kết luận giao ban', can('edit', 'weekly.meeting'), ['tgd', 'ptgd', 'sec']);
  expect('chọn thư ký / PMO', can('edit', 'weekly.roles'), ['tgd', 'ptgd']);
});

test('Nhân sự, Đối tác (đang tắt trên bản thật): BTGĐ theo vai, lãnh đạo bộ phận phần bộ phận mình', () => {
  const can = (a, d, ctx) => n => Policy.can(S[nameOf(n)], a, d, ctx);
  expect('hồ sơ riêng tư người bộ phận 2', can('view', 'hrm.profile', { targetUserId: 11, departmentId: 2, field: 'private' }), ['tgd', 'ptgd', 'staff']);
  expect('hồ sơ cơ bản người bộ phận 2', can('view', 'hrm.profile', { targetUserId: 11, departmentId: 2 }), ['tgd', 'ptgd', 'lead', 'staff']);
  expect('số CCCD', can('view', 'hrm.identity', { targetUserId: 11, departmentId: 2 }), ['staff']);
  expect('giá trị hợp đồng đối tác bộ phận 2', can('view', 'crm.engagement', { departmentId: 2 }), ['tgd', 'ptgd', 'lead']);
});

test('Dự án: Người xem chỉ xem; quản trị không thấy dự án', () => {
  const project = { id: 7, departmentId: 2, visibility: 'DEPARTMENT', kind: 'KANBAN', archivedAt: null, leadId: null };
  const rights = (n, role) => projectRights(U[n], project, role ? { role } : null);
  assert.deepEqual(rights('lead', 'VIEWER'), { canView: true, canEdit: false, canManage: false, canDelete: false, memberRole: 'VIEWER' });
  assert.equal(rights('staff', 'VIEWER').canEdit, false);
  assert.equal(rights('staff', 'MEMBER').canEdit, true);
  assert.equal(rights('staff', null).canEdit, true, 'nhân viên cùng bộ phận vẫn làm việc trong dự án bộ phận');
  assert.equal(rights('it', 'OWNER').canView, false);
});

test('Một việc (bộ phận 2 chủ trì): kế hoạch & duyệt gia hạn — BTGĐ phụ trách (toàn công ty, Phó TGĐ phụ trách bộ phận 2) + người giao', () => {
  const org = { topIds: [1], supervisor: new Map([[2, 2]]), leaders: d => (d === 2 ? [10] : []), deptOf: new Map(NAMES.map(n => [U[n].id, U[n].departmentId])) };
  const project = { kind: 'KANBAN', visibility: 'PUBLIC', departmentId: 2, leadId: null }; // dự án dùng chung: ai cũng thấy dự án
  const item = { id: 1, assignedById: 40, reporterId: 40, assigneeIds: [11], supporterIds: [], leadDepartmentId: 2, category: 'STARTED', supportDepartmentIds: [] };
  const caps = n => {
    const u = U[n];
    const member = n === 'sec' ? { role: 'MEMBER' } : null; // người giao (bộ phận khác) là thành viên dự án
    const rights = projectRights(u, project, member);
    return TA.taskCapabilities(u, item, TA.itemContext(org, { project, rights, member, item }));
  };
  expect('sửa kế hoạch', u => caps(nameOf(u)).plan, ['tgd', 'ptgd', 'sec']); // sec = người giao (A)
  expect('duyệt gia hạn', u => caps(nameOf(u)).decideExtension, ['tgd', 'ptgd']);
  expect('cập nhật tiến độ', u => caps(nameOf(u)).progress, ['staff']);
  expect('xem đầy đủ', u => caps(nameOf(u)).view === 'FULL', ['tgd', 'ptgd', 'lead', 'staff', 'sec']);
  expect('bình luận', u => caps(nameOf(u)).comment, ['tgd', 'ptgd', 'lead', 'staff', 'sec']);
  // PMO không liên quan việc, không phải chủ dự án: chỉ tóm tắt (vai Ban giám đốc cũ không còn mở xem đầy đủ).
  assert.equal(caps('pmo').view, 'SUMMARY');
  assert.equal(caps('it').view, 'NONE');
});

test('Quản trị: tài khoản, bộ phận, nhật ký, phạm vi phụ trách — chỉ quản trị hệ thống', () => {
  for (const k of ['admin.users', 'admin.departments', 'admin.permissions', 'admin.audit'])
    expect(k, u => P.permissionScope(u, k, k === 'admin.audit' ? 'VIEW' : 'OPERATE') === 'SYSTEM', ['it', 'root']);
});

test('vai quyết định, không phải bộ quyền lưu riêng: vai Ban TGĐ có bộ quyền cũ đã thu hẹp vẫn là BTGĐ — Q1 phải đổi vai cùng lần phát hành', () => {
  const narrowed = { id: 6, role: 'director', departmentId: 3, permissions: [{ permissionKey: 'work.view', action: 'VIEW', scope: 'UNIT' }] };
  assert.equal(P.permissionScope(narrowed, 'reports.kpi', 'VIEW'), 'SYSTEM');
  assert.equal(PD.canViewDocs(narrowed, { id: 9, deletedAt: null }, null), true);
  assert.match(P.boardDeptMismatch(narrowed.role, { code: 'TH' }), /không thuộc bộ phận Ban Tổng Giám đốc/, 'quản trị được cảnh báo');
});

// ---------- Quét mã: cấm so chuỗi vai / lọc theo bảng quyền từng người ngoài lib/permissions.js ----------
// Tệp PR #40 (Báo cáo tuần) đang sửa: chuyển sang hàm vai sau khi #40 merge (rồi bỏ khỏi danh sách này).
const PENDING_PR40 = new Set(['services/weekly-data.js', 'routes/reports.js', 'services/alerts.js']);
const FORBIDDEN = [
  [/\brole\s*[!=]==?\s*['"](director|manager|deputy|member|admin)['"]/, 'so chuỗi vai'],
  [/\brole:\s*['"](director|manager|deputy|member|admin)['"]/, 'lọc CSDL theo chuỗi vai'],
  [/\brole:\s*\{\s*(not|in)\s*:\s*[\['"]/, 'lọc CSDL theo chuỗi vai'],
  [/\[\s*['"](director|manager|deputy)['"]/, 'danh sách chuỗi vai'],
  [/permissions:\s*\{\s*some\b/, 'lọc theo bảng quyền từng người (quyền giờ suy từ vai)'],
];
test('quét mã: không so chuỗi vai, không lọc theo bảng quyền từng người ngoài lib/permissions.js', () => {
  const root = path.join(__dirname, '..');
  const files = [];
  const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', '__fixtures__'].includes(e.name)) walk(p); }
    else if (/\.(m?js)$/.test(e.name) && !/\.test\.m?js$/.test(e.name)) files.push(p);
  } };
  walk(root);
  const hits = [];
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (rel === 'lib/permissions.js' || /^seed/.test(rel) || rel === 'tidy-demo.js' || PENDING_PR40.has(rel)) continue;
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const [re, why] of FORBIDDEN) if (re.test(line)) hits.push(`${rel}:${i + 1} (${why}): ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, [], 'Hỏi vai qua lib/permissions.js (isBoard, isDeptLeader, isItAdmin, roleRank, *_WHERE, rolesWith):\n' + hits.join('\n'));
  assert.ok(files.length > 50, 'quét được mã nguồn');
});
