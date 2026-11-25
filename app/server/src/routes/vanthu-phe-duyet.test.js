// Người phê duyệt HIỆU LỰC đi qua đúng MỘT hàm (services/vanthu.js effectiveApprovers / approversOf) ở mọi chỗ của route — sửa C1 / T14:
// quyền xem + phê duyệt dự thảo, người nhận "Tài liệu chờ phê duyệt" lúc tạo / gửi lại / đổi Thiết lập, dữ liệu màn Thiết lập. Lưu Thiết lập
// giữ người không còn hợp lệ khi giao diện gửi lại (không âm thầm xoá), chặn THÊM người không hợp lệ.
// Gắn route vào "app" giả + Prisma giả (như routes/search.test.js); dữ liệu GIẢ.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const mountVanthu = require('./vanthu');

// Điều kiện Prisma tối thiểu mà các route dưới đây dùng: bằng, { in }, { not }, OR.
function matches(row, where = {}) {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return v.some(w => matches(row, w));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
      throw new Error('Prisma giả chưa hỗ trợ điều kiện ' + JSON.stringify(v));
    }
    return (row[k] ?? null) === v;
  });
}
const person = (id, fullName, role, extra = {}) => ({ id, fullName, role, isRootAdmin: false, isActive: true, boardAll: false, departmentId: null, ...extra });
const U = {
  tgd: person(1, 'TGĐ (giả)', 'director', { boardAll: true }), // phụ trách "Toàn công ty"
  ptgd: person(2, 'Phó TGĐ (giả)', 'director'),
  locked: person(3, 'Phó TGĐ đã nghỉ (giả)', 'director', { isActive: false }),
  demoted: person(4, 'Nay là Lãnh đạo bộ phận (giả)', 'manager', { departmentId: 5 }),
  clerk: person(5, 'Văn thư (giả)', 'member', { departmentId: 9 }),
  it: person(6, 'Quản trị hệ thống (giả)', 'admin', { boardAll: true }),
  lead: person(7, 'Lãnh đạo bộ phận (giả)', 'manager', { departmentId: 5 }),
};
const YEAR = new Date().getFullYear();
const draft = (id, extra = {}) => ({ id, book: 'NOIBO', series: 'D6', entity: 'HLD', year: YEAR, seq: null, number: null, status: 'DRAFT', viewLevel: 'ALL', docType: 'QC',
  title: `Quy chế mẫu ${id} (giả)`, createdById: U.lead.id, cancelledAt: null, viaAi: false, registeredAt: new Date(), handlerId: null, departmentId: null, ...extra });

function fakeDb({ approverUserIds, docs = [] }) {
  const db = {
    settings: { 'vanthu.config': { entities: [{ code: 'HLD', name: 'Công ty mẹ (giả)' }], clerkUserIds: [U.clerk.id], legalUserIds: [], approverUserIds } },
    docs, notes: [],
    appSetting: {
      findUnique: async ({ where }) => (db.settings[where.key] ? { key: where.key, value: db.settings[where.key] } : null),
      upsert: async ({ where, update }) => { db.settings[where.key] = update.value; return {}; },
    },
    user: {
      findMany: async ({ where = {} } = {}) => Object.values(U).filter(u => matches(u, where)).sort((a, b) => a.fullName.localeCompare(b.fullName)),
      count: async ({ where }) => Object.values(U).filter(u => matches(u, where)).length,
    },
    department: { findMany: async () => [], findFirst: async () => null, findUnique: async () => null },
    docRecord: {
      findUnique: async ({ where }) => docs.find(d => d.id === where.id) || null,
      findMany: async ({ where = {} } = {}) => docs.filter(d => matches(d, where)),
      create: async ({ data }) => { const d = { id: 100 + docs.length, cancelledAt: null, registeredAt: new Date(), ...data }; docs.push(d); return d; },
      updateMany: async ({ where, data }) => { const hit = docs.filter(d => matches(d, where)); for (const d of hit) Object.assign(d, data); return { count: hit.length }; },
    },
    docEvent: { create: async ({ data }) => data, findMany: async () => [] },
    docFile: { findMany: async () => [] },
    notification: { createMany: async ({ data }) => { db.notes.push(...data); return { count: data.length }; } },
    $transaction: async fn => fn(db),
  };
  return db;
}
// "app" giả: lưu handler cuối của mỗi route; gọi như Express (lỗi HttpError → mã + thông báo).
function mount(db) {
  const routes = {};
  const reg = method => (path, ...fns) => { routes[`${method} ${path}`] = fns[fns.length - 1]; };
  mountVanthu({ get: reg('GET'), post: reg('POST'), put: reg('PUT'), patch: reg('PATCH'), delete: reg('DELETE') },
    { prisma: db, auth: () => {}, audit: async () => {}, config: { modules: ['vanthu'], uploadTmpDir: os.tmpdir() } });
  return async (method, path, user, { params = {}, body = {} } = {}) => {
    const out = { status: 200 };
    const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
    try { await routes[`${method} ${path}`]({ user, params, body, query: {}, headers: {} }, res); }
    catch (e) { out.status = e.status || 500; out.body = { error: e.message, code: e.code }; }
    return out;
  };
}

test('route: danh sách Người phê duyệt chỉ còn người đã khoá / đổi vai → BTGĐ "Toàn công ty" xem và phê duyệt được dự thảo (không kẹt)', async () => {
  const db = fakeDb({ approverUserIds: [U.locked.id, U.demoted.id], docs: [draft(10)] });
  const call = mount(db);
  const d = await call('GET', '/api/vanthu/docs/:id', U.tgd, { params: { id: '10' } });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.can.approve, true);
  assert.equal(d.body.can.return, true);
  // Người không còn hợp lệ không xem / duyệt được; thành viên BTGĐ không "Toàn công ty" cũng không.
  for (const who of [U.ptgd, U.demoted]) assert.equal((await call('GET', '/api/vanthu/docs/:id', who, { params: { id: '10' } })).status, 404, who.fullName);
  // Danh sách còn một người hợp lệ → chỉ người đó, kể cả khi có người đã khoá đứng trước.
  db.settings['vanthu.config'].approverUserIds = [U.locked.id, U.ptgd.id];
  assert.equal((await call('GET', '/api/vanthu/docs/:id', U.ptgd, { params: { id: '10' } })).body.can.approve, true);
  assert.equal((await call('GET', '/api/vanthu/docs/:id', U.tgd, { params: { id: '10' } })).status, 404);
});

test('route: /api/vanthu/meta báo ai đang thực sự duyệt, vì sao, và người đã lưu nhưng không còn hợp lệ (cùng hàm với quyền)', async () => {
  const call = mount(fakeDb({ approverUserIds: [U.locked.id, U.demoted.id, U.it.id] }));
  const m = await call('GET', '/api/vanthu/meta', U.tgd);
  assert.equal(m.status, 200);
  assert.equal(m.body.approver, true, 'cờ Người phê duyệt của chính người hỏi');
  const a = m.body.config.approvers;
  assert.equal(a.source, 'BOARD_ALL');
  assert.deepEqual(a.effective.map(u => u.id), [U.tgd.id], 'Quản trị hệ thống có "Toàn công ty" cũng không vào tập');
  assert.deepEqual(a.stored.map(x => [x.id, x.fullName, x.problems]), [[3, 'Phó TGĐ đã nghỉ (giả)', ['INACTIVE']], [4, 'Nay là Lãnh đạo bộ phận (giả)', ['NOT_BOARD']], [6, 'Quản trị hệ thống (giả)', ['NOT_BOARD']]]);
  assert.deepEqual(m.body.config.approverUserIds, [3, 4, 6], 'danh sách thô đã lưu vẫn trả cho màn Thiết lập');
  assert.deepEqual(m.body.config.boardUsers.map(u => u.id).sort(), [U.tgd.id, U.ptgd.id], 'ô chọn: chỉ thành viên Ban TGĐ đang hoạt động');
  assert.equal(m.body.config.approverProblems.INACTIVE, 'đã khoá');
  assert.equal(m.body.config.approverProblems.NOT_BOARD, 'không còn vai Ban Tổng Giám đốc');
  assert.equal((await call('GET', '/api/vanthu/meta', U.ptgd)).body.approver, false);
});

test('route: "Tài liệu chờ phê duyệt" lúc tạo / gửi lại dự thảo tới Người phê duyệt hiệu lực (danh sách kẹt → "Toàn công ty")', async () => {
  const db = fakeDb({ approverUserIds: [U.locked.id], docs: [draft(10, { status: 'RETURNED', createdById: U.clerk.id })] });
  const call = mount(db);
  const r = await call('POST', '/api/vanthu/docs', U.clerk, { body: { series: 'D6', entity: 'HLD', docType: 'QC', viewLevel: 'ALL', title: 'Quy chế công tác phí (giả)' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(db.notes.map(n => [n.userId, n.type, n.title]), [[U.tgd.id, 'DOC_APPROVAL', 'Tài liệu chờ phê duyệt: Quy chế công tác phí (giả)']]);
  db.notes.length = 0;
  assert.equal((await call('POST', '/api/vanthu/docs/:id/resubmit', U.clerk, { params: { id: '10' } })).status, 200);
  assert.deepEqual(db.notes.map(n => [n.userId, n.title]), [[U.tgd.id, `Tài liệu gửi lại chờ phê duyệt: ${draft(10).title}`]]);
  // Người phê duyệt hiệu lực tự tạo dự thảo: không tự báo cho mình.
  db.notes.length = 0;
  assert.equal((await call('POST', '/api/vanthu/docs', U.tgd, { body: { series: 'D6', entity: 'HLD', docType: 'QC', title: 'Tự tạo (giả)' } })).status, 201);
  assert.deepEqual(db.notes, []);
});

test('route: lưu Thiết lập giữ người đã lưu nay không còn hợp lệ khi giao diện gửi lại; chặn THÊM người không hợp lệ; bỏ tick thì xoá', async () => {
  const db = fakeDb({ approverUserIds: [U.locked.id, U.demoted.id] });
  const call = mount(db);
  const keep = await call('PUT', '/api/vanthu/config', U.tgd, { body: { approverUserIds: [U.locked.id, U.demoted.id] } });
  assert.equal(keep.status, 200, JSON.stringify(keep.body));
  assert.deepEqual(db.settings['vanthu.config'].approverUserIds, [3, 4], 'không âm thầm xoá người đã lưu');
  for (const bad of [[U.locked.id, U.lead.id], [U.it.id], [99]]) {
    const r = await call('PUT', '/api/vanthu/config', U.tgd, { body: { approverUserIds: bad } });
    assert.equal(r.status, 422, `${bad}`);
    assert.equal(r.body.error, 'Người phê duyệt phải là tài khoản vai Ban Tổng Giám đốc đang hoạt động');
  }
  assert.deepEqual(db.settings['vanthu.config'].approverUserIds, [3, 4]);
  // Bỏ người đã khoá (giao diện không gửi lại) → xoá khỏi danh sách; thêm người hợp lệ được.
  assert.equal((await call('PUT', '/api/vanthu/config', U.tgd, { body: { approverUserIds: [U.demoted.id, U.ptgd.id] } })).status, 200);
  assert.deepEqual(db.settings['vanthu.config'].approverUserIds, [4, 2]);
  // Không gửi ô Người phê duyệt (vd. chỉ sửa pháp nhân) → giữ nguyên danh sách.
  assert.equal((await call('PUT', '/api/vanthu/config', U.tgd, { body: { entities: [{ code: 'HLD', name: 'Công ty mẹ mới (giả)' }] } })).status, 200);
  assert.deepEqual(db.settings['vanthu.config'].approverUserIds, [4, 2]);
});

test('route: đổi Thiết lập làm có Người phê duyệt hiệu lực MỚI → họ nhận "Tài liệu chờ phê duyệt" của dự thảo đang chờ (trừ dự thảo của chính họ)', async () => {
  const docs = [draft(10), draft(11, { createdById: U.ptgd.id }), draft(12, { status: 'RETURNED' }), draft(13, { cancelledAt: new Date() }), draft(14, { status: 'EFFECTIVE', number: `001/${YEAR}/QC-TGĐ` }),
    draft(15, { year: YEAR - 1, viaAi: true, viewLevel: 'BOARD' })];
  const db = fakeDb({ approverUserIds: [U.locked.id], docs }); // đang áp dụng: TGĐ "Toàn công ty"
  const call = mount(db);
  assert.equal((await call('PUT', '/api/vanthu/config', U.tgd, { body: { approverUserIds: [U.ptgd.id, U.tgd.id] } })).status, 200);
  assert.deepEqual(db.notes.map(n => [n.userId, n.link]), [[U.ptgd.id, '#/vanthu/10'], [U.ptgd.id, '#/vanthu/15']], 'chỉ người mới (Phó TGĐ), chỉ dự thảo đang chờ, mọi năm');
  assert.equal(db.notes[0].title, `Tài liệu chờ phê duyệt: ${draft(10).title}`);
  assert.match(db.notes[1].body, /^Quy chế · Ban TGĐ · tạo qua Claude · Bạn vừa thành Người phê duyệt/);
  // Lưu lại không đổi tập hiệu lực → không báo lại.
  db.notes.length = 0;
  assert.equal((await call('PUT', '/api/vanthu/config', U.tgd, { body: { approverUserIds: [U.ptgd.id, U.tgd.id] } })).status, 200);
  assert.deepEqual(db.notes, []);
  // Người bấm Lưu tự thêm mình: không tự báo cho mình.
  const db2 = fakeDb({ approverUserIds: [U.tgd.id], docs: [draft(10)] });
  assert.equal((await mount(db2)('PUT', '/api/vanthu/config', U.ptgd, { body: { approverUserIds: [U.ptgd.id] } })).status, 200);
  assert.deepEqual(db2.notes, []);
});
