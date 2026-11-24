// Quy chế, quy định nội bộ (sổ NOIBO) — docs/de-xuat-quy-che-phe-duyet.md (chủ dự án duyệt 24/11/2026).
// Ma trận 3 cấp xem × 4 vai (+ người soạn, Văn thư vai Nhân viên, Người phê duyệt) cho xem / gắn vào việc / Claude;
// luồng phê duyệt: chỉ Người phê duyệt, không qua Claude, phải có PDF, chỉ dự thảo đang chờ.
// Vai lấy từ lib/permissions.js roleRank (một trục vai của PR #41) — test dựng chủ thể từ TÀI KHOẢN thật sự (role) qua roleRank, không gõ tay hạng.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('./vanthu');
const { roleRank, isBoard } = require('../lib/permissions');

const cfgList = ids => ({ approverUserIds: ids, clerkUserIds: [], legalUserIds: [], entities: [] });
// Chủ thể như routes/vanthu.js subject(): rank từ roleRank, approver từ isApprover.
function subj(user, { clerk = false, ai = false, cfg = cfgList([]) } = {}) {
  const it = user.role === 'admin' || !!user.isRootAdmin;
  return { userId: user.id, departmentId: user.departmentId ?? null, it, director: isBoard(user), clerk: !it && clerk, ai, rank: roleRank(user), approver: !it && V.isApprover(user, cfg, isBoard(user)) };
}
const U = {
  board: { id: 1, role: 'director', departmentId: 1, boardAll: true },        // TGĐ — Người phê duyệt (mặc định: BTGĐ "Toàn công ty")
  board2: { id: 2, role: 'director', departmentId: 1, boardAll: false },      // thành viên BTGĐ khác, không phải Người phê duyệt
  leader: { id: 3, role: 'manager', departmentId: 5 },
  member: { id: 4, role: 'member', departmentId: 5 },
  it: { id: 5, role: 'admin', departmentId: null },
  root: { id: 6, role: 'member', isRootAdmin: true },
  author: { id: 7, role: 'member', departmentId: 6 },                          // người soạn vai Nhân viên
  clerkMember: { id: 8, role: 'member', departmentId: 9 },                     // Văn thư vai Nhân viên
};
const doc = (viewLevel, status = 'EFFECTIVE', extra = {}) => ({ book: 'NOIBO', viewLevel, status, createdById: U.author.id, number: V.isDraft({ status }) ? null : '001/2026/QC-TGĐ', ...extra });

test('vai lấy từ một trục vai (roleRank): BTGĐ 0 · Lãnh đạo bộ phận 1 · Nhân viên 2 · Quản trị hệ thống không có hạng', () => {
  assert.equal(subj(U.board).rank, 0); assert.equal(subj(U.leader).rank, 1); assert.equal(subj(U.member).rank, 2);
  assert.equal(subj(U.it).rank, null); assert.equal(subj(U.root).rank, null);
  assert.equal(subj({ id: 9, role: 'deputy', departmentId: 5 }).rank, 1, 'vai cũ Phó phòng đọc như Lãnh đạo bộ phận');
});

// Ma trận đã duyệt (đề xuất mục 4): cấp cao xem được tài liệu cấp thấp; Quản trị hệ thống không xem.
const MATRIX = {
  ALL: { board: true, board2: true, leader: true, member: true, it: false, root: false },
  LEADERS: { board: true, board2: true, leader: true, member: false, it: false, root: false },
  BOARD: { board: true, board2: true, leader: false, member: false, it: false, root: false },
};
for (const [level, row] of Object.entries(MATRIX)) {
  for (const status of ['APPROVED', 'EFFECTIVE', 'EXPIRED']) {
    test(`tài liệu đã phê duyệt (${status}) cấp ${level}: ma trận vai`, () => {
      for (const [who, want] of Object.entries(row)) assert.equal(V.canView(doc(level, status), subj(U[who])), want, `${who} xem ${level}`);
      assert.ok(V.canView(doc(level, status), subj(U.author)), 'người soạn luôn xem tài liệu mình soạn');
      // Văn thư vai Nhân viên: không vượt vai của mình.
      assert.equal(V.canView(doc(level, status), subj(U.clerkMember, { clerk: true })), level === 'ALL');
    });
  }
}

test('cấp xem không theo bộ phận / phạm vi phụ trách / kiêm nhiệm: Lãnh đạo bộ phận khác vẫn xem cấp Lãnh đạo; Pháp chế không mở thêm', () => {
  assert.ok(V.canView(doc('LEADERS'), subj({ id: 30, role: 'manager', departmentId: 77 })));
  assert.ok(!V.canView(doc('LEADERS'), { ...subj(U.member), legal: true }));
  assert.ok(!V.canView(doc('BOARD'), { ...subj(U.leader), clerk: true }), 'Văn thư vai Lãnh đạo bộ phận không xem cấp Ban TGĐ');
  // Mức mật cũ KHÔNG còn tác dụng trong sổ nội bộ (chỉ một khái niệm: cấp xem).
  assert.ok(!V.canView(doc('BOARD', 'EFFECTIVE', { security: 'CONG_KHAI' }), subj(U.member)));
  assert.ok(V.canView(doc('ALL', 'EFFECTIVE', { security: 'BAO_MAT_CAO', viewerIds: [] }), subj(U.member)));
  assert.ok(V.canView(doc(null), subj(U.member)), 'thiếu cấp xem = Mọi người');
});

test('dự thảo (Chưa phê duyệt / Đã trả lại): chỉ người soạn, Người phê duyệt, Văn thư (trong cấp xem theo vai của Văn thư)', () => {
  for (const status of ['DRAFT', 'RETURNED']) {
    for (const level of ['ALL', 'LEADERS', 'BOARD']) {
      const d = doc(level, status);
      assert.ok(V.canView(d, subj(U.author)), 'người soạn');
      assert.ok(V.canView(d, subj(U.board)), 'Người phê duyệt');
      assert.ok(!V.canView(d, subj(U.board2)), 'BTGĐ không phải Người phê duyệt');
      assert.ok(!V.canView(d, subj(U.leader)), 'Lãnh đạo bộ phận không phải người soạn');
      assert.ok(!V.canView(d, subj(U.member)));
      assert.ok(!V.canView(d, subj(U.it)) && !V.canView(d, subj(U.root)));
      assert.equal(V.canView(d, subj(U.clerkMember, { clerk: true })), level === 'ALL', 'Văn thư vai Nhân viên chỉ thấy dự thảo cấp Mọi người');
      assert.equal(V.canView(d, subj(U.leader, { clerk: true })), level !== 'BOARD', 'Văn thư vai Lãnh đạo bộ phận');
    }
  }
  // Danh sách Người phê duyệt được đặt: chỉ người trong danh sách; BTGĐ "Toàn công ty" ngoài danh sách không còn là Người phê duyệt.
  const cfg = cfgList([U.board2.id]);
  assert.ok(V.canView(doc('BOARD', 'DRAFT'), subj(U.board2, { cfg })));
  assert.ok(!V.canView(doc('BOARD', 'DRAFT'), subj(U.board, { cfg })));
});

test('Người phê duyệt: chỉ vai Ban TGĐ; danh sách trống → BTGĐ phụ trách "Toàn công ty"', () => {
  assert.ok(V.isApprover(U.board, cfgList([]), isBoard(U.board)));
  assert.ok(!V.isApprover(U.board2, cfgList([]), isBoard(U.board2)));
  assert.ok(V.isApprover(U.board2, cfgList([2]), isBoard(U.board2)));
  assert.ok(!V.isApprover(U.board, cfgList([2]), isBoard(U.board)));
  // Có tên trong danh sách nhưng không phải vai BTGĐ (vd. đổi vai sau khi chọn) → không phê duyệt.
  assert.ok(!V.isApprover(U.leader, cfgList([3]), isBoard(U.leader)));
  assert.ok(!V.isApprover({ ...U.board, role: 'admin' }, cfgList([1]), isBoard({ ...U.board, role: 'admin' })));
});

test('Claude (token): không đọc cấp Ban TGĐ, không đọc dự thảo của người khác; dự thảo của chính mình thì đọc', () => {
  const ai = who => subj(U[who], { ai: true });
  assert.ok(V.aiHidden(doc('BOARD'), ai('board')));
  assert.ok(!V.aiHidden(doc('LEADERS'), ai('leader')) && !V.aiHidden(doc('ALL'), ai('member')));
  assert.ok(V.aiHidden(doc('ALL', 'DRAFT'), ai('board')), 'Người phê duyệt qua Claude không đọc dự thảo của người khác');
  assert.ok(!V.aiHidden(doc('ALL', 'DRAFT'), ai('author')));
  assert.ok(!V.aiHidden(doc('ALL', 'DRAFT'), subj(U.board)), 'trên giao diện thì không ẩn');
  // Sổ đến / đi giữ quy tắc cũ: ẩn Bảo mật cao.
  assert.ok(V.aiHidden({ book: 'DEN', security: 'BAO_MAT_CAO' }, ai('board')) && !V.aiHidden({ book: 'DEN', security: 'HAN_CHE' }, ai('board')));
});

test('gắn vào việc: chỉ tài liệu nội bộ đã phê duyệt cấp Mọi người, chưa huỷ', () => {
  assert.ok(V.canLink(doc('ALL'), subj(U.member)));
  assert.ok(!V.canLink(doc('LEADERS'), subj(U.board)), 'cấp Lãnh đạo không gắn (người xem việc chưa chắc xem được)');
  assert.ok(!V.canLink(doc('BOARD'), subj(U.board)));
  assert.ok(!V.canLink(doc('ALL', 'DRAFT'), subj(U.author)), 'dự thảo không gắn');
  assert.ok(!V.canLink(doc('ALL', 'EFFECTIVE', { cancelledAt: new Date() }), subj(U.member)));
  assert.ok(!V.canLink(doc('ALL'), subj(U.it)));
});

test('cấp xem người dùng được đặt không vượt vai của chính họ', () => {
  assert.deepEqual(V.levelsFor(subj(U.board)), ['ALL', 'LEADERS', 'BOARD']);
  assert.deepEqual(V.levelsFor(subj(U.leader)), ['ALL', 'LEADERS']);
  assert.deepEqual(V.levelsFor(subj(U.clerkMember, { clerk: true })), ['ALL']);
  assert.deepEqual(V.levelsFor(subj(U.it)), []);
});

test('sửa / gửi lại / huỷ dự thảo: người soạn; Văn thư trong cấp xem; không qua Claude; đã phê duyệt thì khoá', () => {
  assert.ok(V.canEditDraft(doc('BOARD', 'DRAFT'), subj(U.author)));
  assert.ok(V.canEditDraft(doc('ALL', 'RETURNED'), subj(U.clerkMember, { clerk: true })));
  assert.ok(!V.canEditDraft(doc('LEADERS', 'DRAFT'), subj(U.clerkMember, { clerk: true })));
  assert.ok(!V.canEditDraft(doc('ALL', 'DRAFT'), subj(U.board)), 'Người phê duyệt không sửa — trả lại kèm lý do');
  assert.ok(!V.canEditDraft(doc('ALL', 'DRAFT'), subj(U.author, { ai: true })));
  assert.ok(!V.canEditDraft(doc('ALL', 'EFFECTIVE'), subj(U.author)));
  assert.ok(!V.canEditDraft(doc('ALL', 'DRAFT', { cancelledAt: new Date() }), subj(U.author)));
});

test('phê duyệt: 403 không phải Người phê duyệt, 403 qua Claude, 422 thiếu PDF, 422 không phải dự thảo đang chờ', () => {
  const pdf = [{ mimeType: 'application/pdf' }];
  const code = (d, s, f = pdf) => (V.approveCheck(d, s, f) || [null])[0];
  const err = (d, s, f = pdf) => (V.approveCheck(d, s, f) || [])[2];
  assert.equal(V.approveCheck(doc('ALL', 'DRAFT'), subj(U.board), pdf), null);
  for (const who of ['board2', 'leader', 'member', 'author', 'it', 'root']) assert.equal(code(doc('ALL', 'DRAFT'), subj(U[who])), 403, who);
  assert.equal(code(doc('ALL', 'DRAFT'), subj(U.leader, { clerk: true })), 403, 'Văn thư không phê duyệt');
  assert.equal(code(doc('ALL', 'DRAFT'), subj(U.board, { ai: true })), 403);
  assert.equal(err(doc('ALL', 'DRAFT'), subj(U.board, { ai: true })), 'NOT_VIA_AI');
  assert.equal(err(doc('ALL', 'DRAFT'), subj(U.board), []), 'PDF_REQUIRED');
  assert.equal(err(doc('ALL', 'DRAFT'), subj(U.board), [{ mimeType: 'image/png' }]), 'PDF_REQUIRED');
  assert.equal(code(doc('ALL', 'RETURNED'), subj(U.board)), 422, 'đã trả lại: chờ gửi lại');
  assert.equal(code(doc('ALL', 'APPROVED'), subj(U.board)), 422);
  assert.equal(code(doc('ALL', 'DRAFT', { cancelledAt: new Date() }), subj(U.board)), 422);
  assert.equal(code({ book: 'DEN', status: 'RECEIVED' }, subj(U.board)), 422);
  // Trả lại: như phê duyệt nhưng không cần PDF.
  assert.equal(V.returnCheck(doc('ALL', 'DRAFT'), subj(U.board)), null);
  assert.equal(V.returnCheck(doc('ALL', 'DRAFT'), subj(U.board2))[0], 403);
  assert.equal(V.returnCheck(doc('ALL', 'DRAFT'), subj(U.board, { ai: true }))[0], 403);
});

test('phê duyệt xong: ngày hiệu lực trống / hôm nay / trong quá khứ → Hiệu lực ngay; tương lai → Đã phê duyệt', () => {
  assert.equal(V.statusOnApprove(null, '2026-11-25'), 'EFFECTIVE');
  assert.equal(V.statusOnApprove('2026-11-25', '2026-11-25'), 'EFFECTIVE');
  assert.equal(V.statusOnApprove('2026-10-22', '2026-11-25'), 'EFFECTIVE', 'văn bản ban hành từ trước khi đưa vào Hub');
  assert.equal(V.statusOnApprove('2026-12-01', '2026-11-25'), 'APPROVED');
  assert.deepEqual(V.NOIBO_MANUAL, { APPROVED: ['EFFECTIVE', 'EXPIRED'], EFFECTIVE: ['EXPIRED'] });
  assert.equal(V.FIRST.NOIBO, 'DRAFT');
  assert.deepEqual(Object.keys(V.STATUS.NOIBO), ['DRAFT', 'RETURNED', 'APPROVED', 'EFFECTIVE', 'EXPIRED']);
});

test('sổ đến / đi không đổi: vẫn theo mức bảo mật', () => {
  const staff = subj(U.member);
  assert.ok(V.canView({ book: 'DEN', security: 'NOI_BO' }, staff));
  assert.ok(!V.canView({ book: 'DEN', security: 'HAN_CHE', departmentId: 99 }, staff));
  assert.ok(V.canView({ book: 'DI', security: 'BAO_MAT_CAO', viewerIds: [U.member.id] }, staff));
});

// ---- Quay lại bản cũ (PR #41) an toàn: mã cũ đọc mức mật ghi song song (legacySecurity) phải xem HẸP hơn hoặc bằng mã mới. ----
// Bản sao NGUYÊN VĂN canView + visible của PR #41 (services/vanthu.js, routes/vanthu.js) — không sửa theo mã mới.
function oldCanView(doc, s) {
  if (s.it) return false;
  if (doc.security === 'CONG_KHAI' || doc.security === 'NOI_BO') return true;
  if (s.director || doc.handlerId === s.userId || doc.createdById === s.userId) return true;
  if (doc.security === 'BAO_MAT_CAO') return (doc.viewerIds || []).includes(s.userId);
  return s.clerk || (doc.departmentId != null && doc.departmentId === s.departmentId) || (doc.toLegal && s.legal);
}
const oldVisible = (doc, s) => oldCanView(doc, s) && !(s.ai && doc.security === 'BAO_MAT_CAO');
const newVisible = (doc, s) => V.canView(doc, s) && !V.aiHidden(doc, s);

test('quay lại bản cũ: với mọi trạng thái × cấp xem × vai (cả Văn thư, Pháp chế, cùng bộ phận, qua Claude), mã cũ xem ⊆ mã mới — trừ đúng một ngoại lệ đã ghi', () => {
  const who = { ...U, sameDept: { id: 20, role: 'member', departmentId: 6 }, legal: { id: 21, role: 'member', departmentId: 9 } };
  const exceptions = [];
  for (const status of Object.keys(V.STATUS.NOIBO)) for (const level of ['ALL', 'LEADERS', 'BOARD']) {
    const rec = { book: 'NOIBO', status, viewLevel: level, createdById: U.author.id, departmentId: 6, viewerIds: [], toLegal: false, handlerId: null, security: V.legacySecurity(status, level) };
    assert.notEqual(rec.security, 'HAN_CHE');
    for (const [name, user] of Object.entries(who)) for (const flags of [{}, { clerk: true }, { ai: true }, { clerk: true, ai: true }]) {
      const sn = { ...subj(user, flags), legal: name === 'legal', leader: roleRank(user) === 1 };
      const so = { ...sn, director: isBoard(user) }; // chủ thể của mã cũ: Ban TGĐ = vai
      if (oldVisible(rec, so) && !newVisible(rec, sn)) exceptions.push(`${status}/${level}/${name}${flags.clerk ? '+văn thư' : ''}${flags.ai ? '+AI' : ''}`);
    }
  }
  // Ngoại lệ duy nhất: thành viên Ban TGĐ KHÔNG phải Người phê duyệt xem dự thảo trên giao diện (mã cũ: Ban TGĐ xem mọi mức mật).
  assert.ok(exceptions.length > 0 && exceptions.every(x => /^(DRAFT|RETURNED)\/[A-Z]+\/board2(\+văn thư)?$/.test(x)), exceptions.join(', '));
  // Mức mật ghi song song: chỉ Nội bộ (đã duyệt, Mọi người) hoặc Bảo mật cao.
  assert.equal(V.legacySecurity('EFFECTIVE', 'ALL'), 'NOI_BO');
  assert.equal(V.legacySecurity('APPROVED', null), 'NOI_BO');
  for (const [st, lv] of [['DRAFT', 'ALL'], ['RETURNED', 'ALL'], ['EFFECTIVE', 'LEADERS'], ['EXPIRED', 'BOARD']]) assert.equal(V.legacySecurity(st, lv), 'BAO_MAT_CAO');
  // "Gắn vào việc" của mã cũ (security IN Công khai, Nội bộ) chỉ nhận tài liệu đã duyệt cấp Mọi người — như mã mới.
  assert.ok(V.canLink({ book: 'NOIBO', status: 'EFFECTIVE', viewLevel: 'ALL', security: V.legacySecurity('EFFECTIVE', 'ALL') }, subj(U.member)));
});
