// Giao ban — sửa ba lỗi mức Cao (đề xuất C1–C3):
//  - Lỗi 11: đổi lịch một tuần (hạn nộp, ngày giao ban, tuần nghỉ) phải tự báo lãnh đạo các bộ phận phải nộp và người lập báo cáo;
//  - Lỗi 12: bảng điểm tuân thủ — trình báo Ban TGĐ, duyệt báo thư ký + lãnh đạo bộ phận được chấm, Ban TGĐ mở khoá (bắt buộc lý do,
//    ghi nhật ký, báo thư ký), máy chủ chặn mọi vai khác.
// (Lỗi 10 — nhãn ba ô lịch, hỏi lại khi tuần đã qua hạn nộp — là giao diện: app/e2e/tests/22-sua-cao-giao-ban.spec.js.)
// HTTP thật: express + routes/weekly.js + Prisma GIẢ trong bộ nhớ. Dữ liệu GIẢ (id số, tên giả). Tuần tính tương đối với hiện tại
// bằng hàm của máy chủ (services/weekly.js) — đúng vào mọi ngày chạy.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const WK = require('../services/weekly');
const D = require('../services/weekly-data');
const mountWeekly = require('./weekly');
const { presentAudit, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('./admin');

// ---------- Hàm thuần: lịch hiệu lực trước / sau → nội dung thông báo ----------
test('Lỗi 11 — scheduleChange: chỉ báo khi lịch HIỆU LỰC đổi và buổi giao ban chưa diễn ra; nội dung ghi đúng tuần, hạn nộp, giờ họp', () => {
  const F = '2026-11-27'; // thứ Sáu — tuần 23/11 – 27/11/2026, giao ban thứ Hai 30/11
  const S = (m = null) => WK.scheduleOf(F, m);
  const before = new Date('2026-11-24T09:00:00+07:00'); // thứ Ba trong tuần
  assert.equal(WK.scheduleChange(S(), S(), before), null, 'lưu lại y nguyên: không báo');
  assert.equal(WK.scheduleChange(S(), S({ deadlineDay: F }), before), null, 'điền hạn nộp đúng bằng thứ Sáu mặc định: lịch không đổi');
  assert.equal(WK.scheduleChange(S({ skip: true }), S({ skip: true, deadlineDay: '2026-11-26' }), before), null, 'đổi hạn của tuần vẫn nghỉ: không báo');

  const moved = WK.scheduleChange(S(), S({ deadlineDay: '2026-11-26' }), before);
  assert.deepEqual(moved, { title: 'Lịch giao ban tuần 23/11 – 27/11/2026: hạn nộp 17:30 T5 26/11, giao ban 08:30 T2 30/11', body: 'Lịch cũ: hạn nộp 17:30 T6 27/11, giao ban 08:30 T2 30/11.' });
  assert.match(WK.scheduleChange(S(), S({ meetingDay: '2026-12-01' }), before).title, /giao ban 08:30 T3 01\/12$/);
  assert.deepEqual(WK.scheduleChange(S(), S({ skip: true }), before), { title: 'Tuần 23/11 – 27/11/2026 nghỉ giao ban', body: 'Không giao ban, không chấm điểm tuân thủ tuần này — không cần nộp báo cáo tuần.' });
  assert.equal(WK.scheduleChange(S({ skip: true }), S(), before).body, 'Tuần này không còn là tuần nghỉ — nộp báo cáo tuần như thường lệ.');

  // Thứ Bảy: đã qua hạn nộp nhưng chưa họp → vẫn báo (vd. dời họp thứ Hai sang thứ Ba).
  assert.ok(WK.scheduleChange(S(), S({ meetingDay: '2026-12-01' }), new Date('2026-11-28T10:00:00+07:00')));
  // Buổi họp (cũ và mới) đã bắt đầu: tuần đã họp, không báo.
  const after = new Date('2026-11-30T08:30:00+07:00');
  assert.equal(WK.scheduleChange(S(), S({ skip: true }), after), null);
  assert.equal(WK.scheduleChange(S(), S({ deadlineDay: '2026-11-26' }), new Date('2026-12-08T09:00:00+07:00')), null);
  // Họp cũ đã qua nhưng dời sang ngày chưa tới (họp lùi): vẫn báo.
  assert.ok(WK.scheduleChange(S(), S({ meetingDay: '2026-12-01' }), new Date('2026-11-30T09:00:00+07:00')));
});

// ---------- Prisma GIẢ trong bộ nhớ ----------
// where: so bằng, in / notIn / not / lt / lte / gt / gte, OR / AND — đủ cho các truy vấn của routes/weekly.js ở các đường được thử.
function matches(row, where = {}) {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return cond.some(w => matches(row, w));
    if (k === 'AND') return cond.every(w => matches(row, w));
    const v = row[k];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      return Object.entries(cond).every(([op, x]) => {
        if (op === 'in') return x.includes(v);
        if (op === 'notIn') return !x.includes(v);
        if (op === 'not') return v !== x;
        if (op === 'lt') return v < x;
        if (op === 'lte') return v <= x;
        if (op === 'gt') return v > x;
        if (op === 'gte') return v >= x;
        throw new Error('Prisma giả chưa hỗ trợ điều kiện ' + op);
      });
    }
    return v === cond;
  });
}
function fakeDb(seed) {
  const T = { user: [], department: [], appSetting: [], weeklyMeeting: [], weeklyReport: [], weeklyNotice: [], delegation: [], notification: [], workItem: [], ...structuredClone(seed) };
  // Như Prisma: mỗi lần đọc / ghi trả bản sao mới (sửa bản đã đọc không đổi dữ liệu trong bảng, ghi không đổi bản đã đọc trước đó).
  const copy = r => (r ? structuredClone(r) : null);
  const table = name => ({
    findMany: async ({ where = {} } = {}) => T[name].filter(r => matches(r, where)).map(copy),
    findFirst: async ({ where = {} } = {}) => copy(T[name].find(r => matches(r, where))),
    findUnique: async ({ where }) => copy(T[name].find(r => matches(r, where))),
    createMany: async ({ data }) => { for (const d of data) T[name].push({ id: T[name].length + 1, readAt: null, createdAt: new Date(), ...structuredClone(d) }); return { count: data.length }; },
    upsert: async ({ where, create, update }) => {
      const row = T[name].find(r => matches(r, where));
      if (row) return copy(Object.assign(row, structuredClone(update), { updatedAt: new Date() }));
      const n = { id: T[name].length + 1, createdAt: new Date(), updatedAt: new Date(), publishedAt: null, ...structuredClone(create) };
      T[name].push(n);
      return copy(n);
    },
  });
  const db = { T, $executeRaw: async () => 0 };
  for (const k of Object.keys(T)) db[k] = table(k);
  db.$transaction = async fn => fn(db);
  return db;
}

// ---------- Tổ chức GIẢ ----------
// Bộ phận 1, 2, 3 phải nộp (thiết lập giao ban); 4 không phải nộp; 9 = bộ phận thư ký giao ban; 10 = Ban Tổng Giám đốc.
const SEC_DEPT = 9;
const u = (id, role, departmentId, extra = {}) => ({ id, role, departmentId, isActive: true, isRootAdmin: false, fullName: `Người ${id} (giả)`, ...extra });
const USERS = [
  u(1, 'director', 10), u(2, 'director', 10), u(3, 'director', 10, { isActive: false }), // Ban TGĐ (3: đã khoá)
  u(4, 'admin', null), u(5, 'admin', null, { isRootAdmin: true }), // Quản trị hệ thống, quản trị gốc
  u(11, 'manager', 1), u(12, 'manager', 2), u(13, 'manager', 2, { isActive: false }), u(24, 'manager', 3), u(30, 'manager', 4), // lãnh đạo bộ phận
  u(14, 'member', 1), u(15, 'member', 2, { isActive: false }), u(16, 'member', 2), u(17, 'member', 1, { isActive: false }), u(19, 'member', 3),
  u(18, 'admin', 3), // đã chuyển sang vai Quản trị hệ thống nhưng còn là "người lập" một báo cáo cũ
  u(21, 'member', SEC_DEPT), u(22, 'member', SEC_DEPT, { isActive: false }), u(23, 'director', SEC_DEPT), // thư ký (22 đã khoá; 23 vai BTGĐ → không là thư ký)
  u(31, 'member', 4), u(32, 'member', 1),
];
const now0 = new Date();
const CUR = WK.currentFriday(now0), NEXT = WK.addDays(CUR, 7), PAST = WK.addDays(CUR, -14);
const delegation = (fromUserId, toUserId) => ({ fromUserId, toUserId, revokedAt: null, startsAt: new Date(now0.getTime() - 86_400_000), endsAt: new Date(now0.getTime() + 30 * 86_400_000) });
const report = (departmentId, week, preparerId) => ({ departmentId, week, preparerId, firstSubmittedAt: null, status: 'DRAFT', data: {} });
function seed() {
  return {
    user: USERS,
    department: [1, 2, 3, 4, SEC_DEPT, 10].map(id => ({ id, name: `Bộ phận ${id} (giả)`, code: `BP${id}`, isActive: true })),
    appSetting: [{ key: D.CONFIG_KEY, value: { departments: [1, 2, 3], secretaryDepartmentId: SEC_DEPT } }],
    // Uỷ quyền đang hiệu lực: lãnh đạo bộ phận 2 → 16 (đang hoạt động); lãnh đạo bộ phận 1 → 17 (đã khoá).
    delegation: [delegation(12, 16), delegation(11, 17)],
    weeklyReport: [
      // Người lập báo cáo tuần TRƯỚC và tuần đang đổi lịch của các bộ phận phải nộp.
      ...[NEXT, PAST].flatMap(w => [report(1, WK.addDays(w, -7), 14), report(2, WK.addDays(w, -7), 15), report(3, WK.addDays(w, -7), 18), report(3, w, 19), report(2, w, 21),
        report(4, WK.addDays(w, -7), 31), report(1, WK.addDays(w, -14), 32)]),
    ],
  };
}
// Người nhận đúng: lãnh đạo bộ phận 1, 2, 3 (11, 12, 24) + người được uỷ quyền đang hoạt động (16) + người lập (14, 19, 21).
// Không: đã khoá (13, 15, 17), Quản trị hệ thống (18), bộ phận không phải nộp (30, 31), báo cáo hai tuần trước (32), người vừa đổi.
const SCHEDULE_TO = [11, 12, 14, 16, 19, 21, 24];

async function server(db) {
  const audits = [];
  const app = express();
  app.use(express.json());
  const auth = (req, res, next) => { req.user = db.T.user.find(x => x.id === Number(req.get('x-user'))); if (!req.user) return res.status(401).end(); req.headers['user-agent'] = 'test'; next(); };
  mountWeekly(app, { prisma: db, auth, audit: async (req, action, entity, entityId, oldValue, newValue) => audits.push({ userId: req.user.id, action, entity, entityId, oldValue, newValue }) });
  app.use((err, req, res, next) => res.status(err.status || 500).json({ code: err.code, error: err.message })); // eslint-disable-line no-unused-vars
  const srv = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, path, who, body) => {
    const res = await fetch(base + path, { method, headers: { 'x-user': String(who), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { audits, close: () => new Promise(r => srv.close(r)), call };
}
const sentTo = (db, type, from = 0) => db.T.notification.slice(from).filter(n => n.type === type).map(n => n.userId).sort((a, b) => a - b);
const ids = list => [...list].sort((a, b) => a - b);

// ---------- Lỗi 11: PUT /api/weekly/meeting đổi lịch → báo các bộ phận ----------
test('Lỗi 11 — đổi hạn nộp tuần sau: báo lãnh đạo bộ phận phải nộp + người lập báo cáo; bỏ người đã khoá, Quản trị hệ thống, người vừa đổi', async () => {
  const db = fakeDb(seed());
  const s = await server(db);
  try {
    const dl = WK.addDays(NEXT, -1); // thứ Năm
    const r = await s.call('PUT', '/api/weekly/meeting', 1, { week: NEXT, deadlineDay: dl, meetingDay: null, skip: false });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.notified, SCHEDULE_TO.length);
    assert.deepEqual(sentTo(db, 'WEEKLY_SCHEDULE'), SCHEDULE_TO);
    const n = db.T.notification[0], S = WK.scheduleOf(NEXT, { deadlineDay: dl });
    assert.equal(n.title, `Lịch giao ban tuần ${WK.fmtD(S.from)} – ${WK.fmtDY(S.to)}: hạn nộp ${WK.fmtTime(S.deadline)}, giao ban ${WK.fmtTime(S.meetingAt)}`);
    assert.match(n.title, /hạn nộp 17:30 T5 /);
    assert.equal(n.body, `Lịch cũ: hạn nộp ${WK.fmtTime(WK.scheduleOf(NEXT).deadline)}, giao ban ${WK.fmtTime(WK.scheduleOf(NEXT).meetingAt)}.`);
    assert.equal(n.link, `#/tuan?w=${NEXT}`);

    // Lưu lại y nguyên ("Lưu thiết lập" luôn gửi ba ô lịch), chỉ lưu "Không đạt", điền hạn = thứ Sáu mặc định sau khi bỏ hạn: không báo thêm.
    const count = db.T.notification.length;
    for (const body of [{ week: NEXT, deadlineDay: dl, meetingDay: null, skip: false }, { week: NEXT, failed: { 1: true } }]) {
      const again = await s.call('PUT', '/api/weekly/meeting', 1, body);
      assert.equal(again.status, 200); assert.equal(again.body.notified, 0);
    }
    assert.equal(db.T.notification.length, count, 'không đổi lịch thì không gửi');
    await s.call('PUT', '/api/weekly/meeting', 1, { week: NEXT, deadlineDay: null });
    const mark = db.T.notification.length;
    const same = await s.call('PUT', '/api/weekly/meeting', 1, { week: NEXT, deadlineDay: NEXT });
    assert.equal(same.body.notified, 0, 'hạn nộp điền đúng thứ Sáu = lịch không đổi');
    assert.equal(db.T.notification.length, mark);

    // Thư ký đổi: chính thư ký (người lập báo cáo bộ phận 2) không nhận thông báo của mình.
    const sec = await s.call('PUT', '/api/weekly/meeting', 21, { week: NEXT, meetingDay: WK.addDays(NEXT, 4) });
    assert.equal(sec.status, 200, JSON.stringify(sec.body));
    assert.deepEqual(sentTo(db, 'WEEKLY_SCHEDULE', mark), SCHEDULE_TO.filter(id => id !== 21));
    assert.match(db.T.notification.at(-1).title, /giao ban 08:30 T3 /);
  } finally { await s.close(); }
});

test('Lỗi 11 — tuần nghỉ / bỏ nghỉ có báo; danh sách đã chụp của tuần thắng thiết lập; tuần đã họp xong không báo', async () => {
  const db = fakeDb(seed());
  const s = await server(db);
  try {
    let r = await s.call('PUT', '/api/weekly/meeting', 2, { week: NEXT, skip: true });
    assert.equal(r.body.notified, SCHEDULE_TO.length);
    assert.match(db.T.notification.at(-1).title, /^Tuần \d\d\/\d\d – \d\d\/\d\d\/\d{4} nghỉ giao ban$/);
    const mark = db.T.notification.length;
    r = await s.call('PUT', '/api/weekly/meeting', 2, { week: NEXT, skip: false });
    assert.equal(r.body.notified, SCHEDULE_TO.length);
    assert.equal(db.T.notification.at(-1).body, 'Tuần này không còn là tuần nghỉ — nộp báo cáo tuần như thường lệ.');
    assert.equal(db.T.notification.length, mark + SCHEDULE_TO.length);

    // Danh sách phải nộp đã CHỤP cho tuần (chỉ bộ phận 2): chỉ báo bộ phận đó (lãnh đạo 12, người được uỷ quyền 16, người lập 21).
    db.T.weeklyMeeting.find(m => m.week === NEXT).data.required = [2];
    const snap = db.T.notification.length;
    r = await s.call('PUT', '/api/weekly/meeting', 2, { week: NEXT, deadlineDay: WK.addDays(NEXT, -2) });
    assert.deepEqual(sentTo(db, 'WEEKLY_SCHEDULE', snap), [12, 16, 21]);

    // Tuần hai tuần trước: buổi giao ban đã diễn ra — Ban TGĐ vẫn đổi được lịch, nhưng không gửi thông báo nào.
    const past = db.T.notification.length;
    r = await s.call('PUT', '/api/weekly/meeting', 1, { week: PAST, skip: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.notified, 0);
    assert.equal(db.T.notification.length, past);
  } finally { await s.close(); }
});

// ---------- Lỗi 10: hộp hỏi lại "tuần đã qua hạn nộp" chỉ hiện cho Ban TGĐ — dựa vào luật có sẵn của máy chủ ----------
// Sau hạn nộp của một tuần, chỉ Ban TGĐ đổi lịch tuần đó (tuần nghỉ, hạn nộp, ngày giao ban); thư ký, lãnh đạo bộ phận bị chặn.
test('Lỗi 10 — tuần đã qua hạn nộp: thư ký, lãnh đạo bộ phận đổi lịch bị 403, lịch giữ nguyên, không báo; Ban TGĐ đổi được', async () => {
  const db = fakeDb(seed());
  const s = await server(db);
  try {
    const LAST = WK.addDays(CUR, -7); // hạn nộp 17:30 thứ Sáu tuần trước: luôn đã qua, vào mọi ngày chạy
    assert.ok(Date.now() > new Date(WK.scheduleOf(LAST).deadline).getTime());
    const lich = () => { const S = WK.scheduleOf(LAST, db.T.weeklyMeeting.find(m => m.week === LAST) || null); return [S.skip, S.deadlineDay, S.meetingDay]; };
    const goc = lich(), mark = db.T.notification.length;
    for (const [who, patch] of [[21, { deadlineDay: WK.addDays(LAST, -1) }], [21, { meetingDay: WK.addDays(LAST, 4) }], [21, { skip: true }],
      [11, { skip: true }], [12, { deadlineDay: WK.addDays(LAST, -1) }], [24, { meetingDay: WK.addDays(LAST, 4) }]]) {
      const r = await s.call('PUT', '/api/weekly/meeting', who, { week: LAST, ...patch });
      assert.equal(r.status, 403, `người ${who} ${JSON.stringify(patch)}`);
      if (who === 21) assert.equal(r.body.error, 'Đã qua hạn nộp — chỉ Ban TGĐ đổi lịch của tuần này');
    }
    assert.deepEqual(lich(), goc, 'lịch giữ nguyên');
    assert.deepEqual(sentTo(db, 'WEEKLY_SCHEDULE', mark), [], 'không gửi thông báo đổi lịch');
    // "Lưu thiết lập" luôn gửi đủ ba ô lịch: thư ký gửi lại đúng lịch đang có (không đổi gì) thì vẫn lưu được.
    const same = await s.call('PUT', '/api/weekly/meeting', 21, { week: LAST, skip: false, deadlineDay: null, meetingDay: null });
    assert.equal(same.status, 200, JSON.stringify(same.body));
    // Ban TGĐ đổi được lịch của tuần đã qua hạn nộp.
    const dl = WK.addDays(LAST, -1);
    const ok = await s.call('PUT', '/api/weekly/meeting', 1, { week: LAST, deadlineDay: dl });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(lich(), [false, dl, goc[2]]);
  } finally { await s.close(); }
});

// ---------- Lỗi 12: bảng điểm tuân thủ — trình / duyệt / mở khoá ----------
// Tháng đã khép chắc chắn: 3 tháng trước tháng của tuần hiện tại (tháng liền trước có thể chưa khép vào sáng thứ Hai đầu tháng).
const MONTH = (() => { const [y, m] = CUR.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - 3, 1)).toISOString().slice(0, 7); })();
const M = `${MONTH.slice(5)}/${MONTH.slice(0, 4)}`, KEY = `weekly.compliance.${MONTH}`;
const stateOf = db => db.T.appSetting.find(x => x.key === KEY)?.value || null;

test('Lỗi 12 — trình báo Ban TGĐ đang hoạt động; "Duyệt và khoá" báo thư ký và lãnh đạo các bộ phận được chấm', async () => {
  const db = fakeDb(seed());
  const s = await server(db);
  try {
    const sub = await s.call('POST', '/api/weekly/compliance/submit', 21, { month: MONTH });
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    assert.deepEqual(sentTo(db, 'WEEKLY_COMPLIANCE'), [1, 2, 23], 'thành viên Ban TGĐ đang hoạt động (không người đã khoá, không Quản trị hệ thống)');
    const n = db.T.notification[0];
    assert.equal(n.title, `Bảng điểm tuân thủ giao ban tháng ${M} chờ duyệt`);
    assert.equal(n.link, `#/tuan/diem?m=${MONTH}`);
    assert.match(n.body, /đã trình/);

    const g = await s.call('GET', `/api/weekly/compliance?month=${MONTH}`, 1);
    assert.equal(g.body.canApprove, true); assert.equal(g.body.canUnlock, false);
    const mark = db.T.notification.length;
    const ap = await s.call('POST', '/api/weekly/compliance/approve', 1, { month: MONTH, sha256: g.body.state.sha256 });
    assert.equal(ap.status, 200, JSON.stringify(ap.body));
    assert.equal(stateOf(db).status, 'APPROVED');
    const sent = db.T.notification.slice(mark);
    assert.deepEqual(ids(sent.filter(x => x.link === `#/tuan/diem?m=${MONTH}`).map(x => x.userId)), [21], 'thư ký giao ban (không thư ký đã khoá, không BTGĐ thuộc bộ phận thư ký)');
    assert.deepEqual(ids(sent.filter(x => x.link === '#/tuan').map(x => x.userId)), [11, 12, 16, 24], 'lãnh đạo (và người được uỷ quyền) bộ phận 1, 2, 3 — không bộ phận 4');
    assert.ok(sent.every(x => x.title === `Bảng điểm tuân thủ giao ban tháng ${M} đã duyệt và khoá` && x.userId !== 1));
    // Lãnh đạo bộ phận không xem bảng điểm (lib/policy.js weekly.compliance): thông báo chỉ báo đã chốt, không kèm điểm.
    assert.deepEqual([...new Set(sent.filter(x => x.link === '#/tuan').map(x => x.body))], ['Điểm tuân thủ giao ban tháng này của bộ phận đã chốt (Phụ lục 1). Thắc mắc về điểm: liên hệ thư ký giao ban.']);
  } finally { await s.close(); }
});

test('Lỗi 12 — "Mở khoá": chỉ Ban TGĐ, bắt buộc lý do, về bản nháp, ghi nhật ký (ẩn với Quản trị hệ thống), báo thư ký', async () => {
  const db = fakeDb(seed());
  const s = await server(db);
  try {
    await s.call('POST', '/api/weekly/compliance/submit', 21, { month: MONTH });
    const sha = (await s.call('GET', `/api/weekly/compliance?month=${MONTH}`, 1)).body.state.sha256;
    assert.equal((await s.call('POST', '/api/weekly/compliance/approve', 1, { month: MONTH, sha256: sha })).status, 200);
    const approved = structuredClone(stateOf(db));
    assert.equal((await s.call('GET', `/api/weekly/compliance?month=${MONTH}`, 1)).body.canUnlock, true);
    assert.equal((await s.call('GET', `/api/weekly/compliance?month=${MONTH}`, 21)).body.canUnlock, false, 'thư ký không thấy nút Mở khoá');

    // Máy chủ chặn mọi vai khác Ban TGĐ — câu từ chối rõ; bảng vẫn khoá, không ghi nhật ký.
    for (const who of [21, 11, 14]) {
      const r = await s.call('POST', '/api/weekly/compliance/unlock', who, { month: MONTH, reason: 'Thử mở khoá (giả)' });
      assert.equal(r.status, 403, `người ${who}`);
      assert.equal(r.body.error, 'Chỉ Ban Tổng Giám đốc mở khoá bảng điểm tuân thủ đã duyệt');
    }
    for (const who of [4, 5]) {
      const r = await s.call('POST', '/api/weekly/compliance/unlock', who, { month: MONTH, reason: 'Thử mở khoá (giả)' });
      assert.equal(r.status, 403); assert.equal(r.body.error, 'Tài khoản quản trị hệ thống không xem nội dung nghiệp vụ');
    }
    // Lý do bắt buộc (bỏ trống / chỉ khoảng trắng), tối đa 500 ký tự.
    for (const reason of [undefined, '', '   ']) {
      const r = await s.call('POST', '/api/weekly/compliance/unlock', 1, { month: MONTH, reason });
      assert.equal(r.status, 422); assert.equal(r.body.error, 'Ghi lý do mở khoá bảng điểm');
    }
    assert.equal((await s.call('POST', '/api/weekly/compliance/unlock', 1, { month: MONTH, reason: 'x'.repeat(501) })).status, 422);
    assert.deepEqual(stateOf(db), approved);
    assert.ok(!s.audits.some(a => a.action === 'WEEKLY_COMPLIANCE_UNLOCK'));

    const mark = db.T.notification.length;
    const reason = 'Điểm danh tuần cuối tháng ghi nhầm bộ phận 2 vắng (giả)';
    const ok = await s.call('POST', '/api/weekly/compliance/unlock', 2, { month: MONTH, reason: `  ${reason} ` });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'DRAFT');
    const st = stateOf(db);
    assert.equal(st.status, 'DRAFT');
    assert.equal(st.rows, undefined, 'bản nháp: tính lại theo số liệu hiện tại, không giữ bảng đã duyệt');
    assert.deepEqual(st.unlocks.map(x => [x.byId, x.reason, x.approvedById, x.sha256]), [[2, reason, 1, sha]]);

    const a = s.audits.find(x => x.action === 'WEEKLY_COMPLIANCE_UNLOCK');
    assert.deepEqual([a.userId, a.entity, a.entityId, a.oldValue.status, a.oldValue.sha256, a.newValue.status, a.newValue.reason], [2, 'WeeklyCompliance', KEY, 'APPROVED', sha, 'DRAFT', reason]);
    // Nhật ký: lý do là nội dung nghiệp vụ — Quản trị hệ thống chỉ thấy ai / lúc nào (routes/admin.js presentAudit).
    const row = { id: 1, userId: 2, action: a.action, entity: a.entity, entityId: a.entityId, oldValue: JSON.stringify(a.oldValue), newValue: JSON.stringify(a.newValue) };
    const forIt = presentAudit(row, { itAdmin: true });
    assert.equal(forIt.newValue, null); assert.equal(forIt.oldValue, null); assert.equal(forIt.redacted, true);
    // Màn Nhật ký có nhãn cho hành động và đối tượng mới (ô lọc liệt kê được, không hiện mã thô).
    assert.equal(AUDIT_ACTIONS.WEEKLY_COMPLIANCE_UNLOCK, 'Mở khoá bảng điểm tuân thủ giao ban');
    assert.equal(AUDIT_ENTITIES.WeeklyCompliance, 'Bảng điểm tuân thủ giao ban');

    const sent = db.T.notification.slice(mark);
    assert.deepEqual(ids(sent.map(x => x.userId)), [21], 'báo thư ký giao ban');
    assert.equal(sent[0].title, `Bảng điểm tuân thủ giao ban tháng ${M} đã mở khoá`);
    assert.ok(sent[0].body.includes(`Lý do: ${reason}.`));

    // Sau mở khoá: thư ký trình lại được, Ban TGĐ chưa duyệt / mở khoá được (chưa trình); mở khoá lần nữa → 409.
    const sv = (await s.call('GET', `/api/weekly/compliance?month=${MONTH}`, 21)).body;
    assert.equal(sv.state.status, 'DRAFT'); assert.equal(sv.canSubmit, true);
    assert.deepEqual([sv.state.unlock.by, sv.state.unlock.reason], ['Người 2 (giả)', reason]);
    const dv = (await s.call('GET', `/api/weekly/compliance?month=${MONTH}`, 1)).body;
    assert.equal(dv.canApprove, false); assert.equal(dv.canUnlock, false);
    const again = await s.call('POST', '/api/weekly/compliance/unlock', 1, { month: MONTH, reason });
    assert.equal(again.status, 409); assert.equal(again.body.code, 'NOT_LOCKED');
    assert.equal((await s.call('POST', '/api/weekly/compliance/submit', 21, { month: MONTH })).status, 200);
    assert.equal(stateOf(db).unlocks.length, 1, 'trình lại giữ lịch sử mở khoá');
  } finally { await s.close(); }
});
