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

test('KPI theo người trong dự án MTL (chốt 24/11/2026 "Chỉ Ban TGĐ"): BTGĐ mọi người; người khác chỉ chính mình; quản trị không', () => {
  const { kpiScope, kpiTarget } = require('../routes/mtl');
  expect('scope SYSTEM', u => kpiScope(u) === 'SYSTEM', ['tgd', 'ptgd']);
  expect('scope SELF', u => kpiScope(u) === 'SELF', ['lead', 'staff', 'pmo', 'sec']);
  expect('scope null', u => kpiScope(u) === null, ['it', 'root']);
  // Không chỉ định người: BTGĐ → mọi người (target null); người khác → đúng chính mình.
  for (const n of ['tgd', 'ptgd']) assert.deepEqual(kpiTarget(U[n], undefined), { scope: 'SYSTEM', target: null });
  for (const n of ['lead', 'staff', 'pmo', 'sec']) assert.deepEqual(kpiTarget(U[n], undefined), { scope: 'SELF', target: U[n].id });
  // Chỉ định người khác: chỉ BTGĐ được; chỉ định chính mình: ai (trừ quản trị) cũng được.
  expect('xem KPI người khác (staff)', u => kpiTarget(u, String(U.staff.id)).target === U.staff.id && u !== U.staff, ['tgd', 'ptgd']);
  expect('xem KPI của chính mình', u => kpiTarget(u, String(u.id)).target === u.id, BUSINESS);
});

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

test('Dự án: quan hệ chỉ CỘNG quyền — Người xem chỉ được thêm quyền xem; quyền từ vai giữ nguyên; quản trị không thấy dự án', () => {
  const dept = { id: 7, departmentId: 2, visibility: 'DEPARTMENT', kind: 'KANBAN', archivedAt: null, leadId: null };
  const shared = { ...dept, id: 8, visibility: 'PUBLIC' };
  const rights = (n, role, project = dept) => projectRights(U[n], project, role ? { role } : null);
  // Người không có quyền sửa từ vai (nhân viên bộ phận khác, dự án dùng chung): Người xem chỉ xem; Thành viên thì sửa được.
  assert.deepEqual(rights('pmo', 'VIEWER', shared), { canView: true, canEdit: false, canManage: false, canDelete: false, memberRole: 'VIEWER' });
  assert.equal(rights('pmo', 'MEMBER', shared).canEdit, true);
  // Ai đã có quyền từ vai thì đặt làm Người xem cũng không mất: BTGĐ, lãnh đạo / nhân viên bộ phận của dự án bộ phận.
  for (const [n, p] of [['tgd', shared], ['ptgd', dept], ['lead', dept]]) {
    const r = rights(n, 'VIEWER', p);
    assert.equal(r.canEdit, true, n + ' giữ quyền sửa');
    assert.equal(r.canManage, rights(n, null, p).canManage, n + ' giữ quyền quản lý từ vai');
  }
  assert.equal(rights('tgd', 'VIEWER', shared).canManage, true, 'BTGĐ là Người xem vẫn quản lý dự án');
  assert.equal(rights('staff', 'VIEWER').canEdit, true, 'nhân viên cùng bộ phận vẫn làm việc trong dự án bộ phận');
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

// ---------- Quét mã: chốt "một hệ quy chiếu" ----------
// Quét server/src, server/scripts, web/js, mcp THEO CÚ PHÁP: bỏ chú thích, quét cả tệp (bắt được cách viết nhiều dòng), không phụ thuộc
// cách viết so sánh (===, đảo vế, includes, switch/case, Prisma in / notIn…):
//   • chuỗi giá trị vai 'director' | 'manager' | 'deputy' | 'member' ở BẤT KỲ đâu; 'admin' khi đứng gần chữ role;
//   • đọc / lọc bảng quyền lưu riêng từng người: userPermission, `permissions: { some`, `permissions: true`, `.permissions.`.
// Chỉ nơi định nghĩa vai được dùng: server lib/permissions.js, web js/util.js (+ js/store.js đọc bảng quyền-theo-vai của chính mình).
const APP = path.join(__dirname, '..', '..', '..');
const ROOTS = [['server/src', path.join(APP, 'server', 'src')], ['server/scripts', path.join(APP, 'server', 'scripts')], ['web/js', path.join(APP, 'web', 'js')], ['mcp', path.join(APP, 'mcp')]];
const ALLOW = {
  'server/src/lib/permissions.js': 'nơi định nghĩa vai và bảng quyền theo vai',
  'web/js/util.js': 'nơi so giá trị vai duy nhất trên giao diện',
  'server/scripts/sync-role-grants.js': 'đồng bộ bảng quyền cũ để quay lại bản trước (chỉ ghi qua permissions.js)',
  'server/src/seed.js': 'dữ liệu GIẢ (khai báo vai của tài khoản mẫu)',
  'server/src/seed-showcase.js': 'dữ liệu GIẢ',
  'server/src/seed-playground.js': 'dữ liệu GIẢ',
  'server/src/tidy-demo.js': 'dọn dữ liệu GIẢ',
};
const ALLOW_RULE = { 'web/js/store.js': ['bảng quyền'] }; // can() đọc bảng quyền-theo-vai server trả cho chính người dùng
const RULES = [
  ['chuỗi vai', /['"`](director|manager|deputy|member)['"`]/g, 'code'],
  ['chuỗi vai', /\brole\b[^;]{0,60}?['"`]admin['"`]|['"`]admin['"`][^;]{0,60}?\brole\b/g, 'code'],
  // Viết hoa / hoa đầu (vd. so u.role.toUpperCase() === 'DIRECTOR'); 'DIRECTOR' của loại cấp duyệt không đứng gần chữ role nên không bị bắt.
  ['chuỗi vai', /\brole\b[^;]{0,60}?['"`](director|manager|deputy)['"`]|['"`](director|manager|deputy)['"`][^;]{0,60}?\brole\b/gi, 'code'],
  ['bảng quyền', /\buserPermission\b/g, 'bare'],
  ['bảng quyền', /['"`]userPermission['"`]/g, 'code'], // db['userPermission']
  ['bảng quyền', /\bpermissions\s*:\s*(\{\s*(some|none|every|where)\b|true\b)/g, 'bare'],
  ['bảng quyền', /\b(me|user|u|actor|target|req\.user)\??\.permissions\b/g, 'bare'],
  ['bảng quyền', /\.permissions\s*\??\.\s*[A-Za-z_$]/g, 'bare'], // <biến bất kỳ>.permissions.find / .some / .length …
  ['bảng quyền', /\bpermissions\s*:\s*\[/g, 'bare'], // người dùng giả mang bảng quyền riêng (vd. { role: 'system', permissions: [ … ] })
];
// Bỏ chú thích (giữ xuống dòng để đếm dòng); bản 'bare' bỏ thêm nội dung chuỗi.
const TOKENS = /('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g;
const blank = t => t.replace(/[^\n]/g, ' ');
const codeOf = src => src.replace(TOKENS, (m, str) => (str ? m : blank(m)));
const bareOf = src => src.replace(TOKENS, (m, str) => (str ? m[0] + blank(m.slice(1, -1)) + m.slice(-1) : blank(m)));
function scanFile(src) {
  const text = { code: codeOf(src), bare: bareOf(src) };
  const hits = [];
  for (const [why, re, kind] of RULES) for (const m of text[kind].matchAll(re)) {
    const line = text[kind].slice(0, m.index).split('\n').length;
    hits.push({ why, line, snippet: src.split('\n')[line - 1].trim().slice(0, 110) });
  }
  return hits;
}
function sources() {
  const out = [];
  for (const [prefix, dir] of ROOTS) {
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!['node_modules', '__fixtures__', 'vendor', 'test'].includes(e.name)) walk(p); }
      else if (/\.[mc]?js$/.test(e.name) && !/\.test\.[mc]?js$/.test(e.name)) out.push([prefix + '/' + path.relative(dir, p).split(path.sep).join('/'), p]);
    } };
    walk(dir);
  }
  return out;
}

test('quét mã: chính bộ quét bắt được mọi cách viết đã gặp (đảo vế, includes, Prisma in / notIn, switch, nhiều dòng, bảng quyền)', () => {
  const bad = [
    "if ('director' === u.role) x();", "if ([ 'manager', 'deputy' ].includes(u.role)) x();", "where: { role: { notIn: ['admin'] } }",
    "switch (u.role) { case 'member': break; }", "if ((u.role || '') === 'director') x();", "const ok = u.permissions.some(g => g);",
    "await tx.userPermission.findMany({});", "where: {\n  role:\n    'director' }", "include: { permissions: true }", "where: { permissions: { some: {} } }",
    "where: { permissions: { none: {} } }", "where: { permissions: { every: {} } }", "include: { permissions: { where: { scope: 'SYSTEM' } } }",
    "const g = actor2.permissions.find(x => x);", "await db['userPermission'].findMany({})", "if (u.role.toUpperCase() === 'DIRECTOR') x();",
    "const r = u.role === \"Manager\";", "const S = { id: 0, permissions: [{ permissionKey: 'work.view' }] };",
  ];
  for (const src of bad) assert.ok(scanFile(src).length > 0, 'phải bắt: ' + src);
  const good = ["// so 'director' trong chú thích thì không sao", "app.get('/api/admin/users', h)", "if (parts[0] === 'admin') route()", "catalogList(cat).map(p => p)", "x = 'admin.users'", "if (step.approverType === 'DIRECTOR') x();", "oneOf(m.role || 'MEMBER', MEMBER_ROLES)"];
  for (const src of good) assert.deepEqual(scanFile(src), [], 'không được bắt nhầm: ' + src);
});

test('quét mã: server, scripts, web không so chuỗi vai / không đọc bảng quyền từng người ngoài nơi định nghĩa vai', () => {
  const files = sources();
  assert.ok(files.length > 80, 'quét được mã nguồn server + scripts + web');
  const hits = [];
  for (const [rel, file] of files) {
    if (ALLOW[rel]) continue;
    for (const h of scanFile(fs.readFileSync(file, 'utf8'))) {
      if ((ALLOW_RULE[rel] || []).includes(h.why)) continue;
      hits.push(`${rel}:${h.line} (${h.why}): ${h.snippet}`);
    }
  }
  assert.deepEqual(hits, [], 'Hỏi vai qua lib/permissions.js (server) hoặc web/js/util.js (giao diện):\n' + hits.join('\n'));
});
