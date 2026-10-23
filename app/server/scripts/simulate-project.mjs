// Chạy thử MỘT dự án theo vai trò trên bản thử (playground, dữ liệu GIẢ): Ban GĐ giao việc → PMO nhập MTL → lãnh đạo bộ phận
// chi tiết hoá, phân công → nhân viên thực hiện (giao diện + Claude) → nghỉ phép → báo cáo tuần → giao ban → theo dõi.
// Ghi nhật ký từng bước (journal.json) để rút phản hồi nghiệp vụ.
//
// CHỈ DÙNG TRÊN BẢN THỬ: đặt mật khẩu chung cho các tài khoản mẫu (PLAY_PW, mặc định Play@2026) và tạo dự án "BM".
// Từ chối chạy nếu không phải máy có dữ liệu mẫu (SEED_DEMO=true, ALLOW_DEMO_SEED=yes hoặc NODE_ENV≠production, MODULES có hrm).
//   Bản thử Docker:  docker exec -e BASE=http://127.0.0.1:4000 -e OUT=/tmp/journal.json kepper-play-app-1 node scripts/simulate-project.mjs
//   Máy dev:         BASE=http://127.0.0.1:4300 node scripts/simulate-project.mjs   (cùng biến môi trường của máy chủ dev)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const ExcelJS = require('exceljs');

const env = process.env;
if (String(env.SEED_DEMO) !== 'true' || (env.NODE_ENV === 'production' && env.ALLOW_DEMO_SEED !== 'yes') || !String(env.MODULES || '').split(',').includes('hrm')) {
  console.error('Từ chối: chỉ chạy trên bản thử có dữ liệu mẫu (SEED_DEMO=true, ALLOW_DEMO_SEED=yes, MODULES có hrm). Kịch bản này đổi mật khẩu tài khoản mẫu.');
  process.exit(2);
}
const B = env.BASE || 'http://127.0.0.1:4000';
const PW = process.env.PLAY_PW || 'Play@2026';
const OUT = process.env.OUT || path.join(process.cwd(), 'journal.json');
const journal = [];
const tokens = {};
const vnToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const nextWeekday = (d, wd) => { let x = addDays(d, 1); while (new Date(x + 'T00:00:00Z').getUTCDay() !== wd) x = addDays(x, 1); return x; };

async function raw(method, p, { token, body, form } = {}) {
  const headers = { ...(token ? { authorization: 'Bearer ' + token } : {}) };
  let payload;
  if (form) payload = form; else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(B + p, { method, headers, body: payload });
  const ct = r.headers.get('content-type') || '';
  const j = ct.includes('json') ? await r.json().catch(() => null) : null;
  return { s: r.status, j };
}
async function login(u) {
  if (tokens[u]) return tokens[u];
  for (const pw of [PW, '12345678', 'Moi@2026']) {
    const r = await raw('POST', '/api/auth/login', { body: { username: u, password: pw } });
    if (r.s !== 200) continue;
    let t = r.j.token;
    if (r.j.user?.mustChangePw || pw !== PW) {
      const c = await raw('POST', '/api/me/password', { token: t, body: { currentPassword: pw, newPassword: PW } });
      if (c.s === 200) t = c.j.token;
    }
    return (tokens[u] = t);
  }
  throw new Error('Không đăng nhập được ' + u);
}
const as = async (u, method, p, body, opts = {}) => raw(method, p, { token: await login(u), body, ...opts });
// Ghi một bước: actor, việc, kết quả, kỳ vọng (expect: mã HTTP mong đợi), ghi chú quan sát.
function log(act, actor, what, r, { expect = [200, 201, 204], note = '', data } = {}) {
  const ok = [].concat(expect).includes(r.s);
  const row = { act, actor, what, status: r.s, ok, error: r.j?.error, code: r.j?.code, note, ...(data !== undefined ? { data } : {}) };
  journal.push(row);
  console.log(`${ok ? '✓' : '✗'} [${act}] ${actor}: ${what} → ${r.s}${r.j?.error ? ' — ' + r.j.error : ''}${note ? ' · ' + note : ''}`);
  return r;
}
function obs(act, actor, text) { journal.push({ act, actor, observation: text }); console.log(`  ⚑ [${act}] ${actor}: ${text}`); }

const today = vnToday();
const U = {}, D = {};

async function main() {
  // ---------- 0. Người dùng, bộ phận ----------
  const dir = await as('giamdoc', 'GET', '/api/users/directory');
  for (const u of dir.j) U[u.username] = u;
  for (const d of (await as('giamdoc', 'GET', '/api/departments')).j) D[d.code] = d;

  // ---------- 1. Ban GĐ thiết lập giao ban, tạo dự án ----------
  log('1-thiet-lap', 'giamdoc', 'Thiết lập giao ban: thư ký = HCNS, PMO = pmo, 6 bộ phận phải nộp',
    await as('giamdoc', 'PUT', '/api/weekly/config', { secretaryDepartmentId: D.HCNS.id, pmoUserIds: [U.pmo.id], departments: ['PL', 'TC', 'TK', 'QLXD', 'GR', 'KD'].map(c => D[c].id) }));
  const t0 = today.slice(0, 7) === '2026-10' ? '2026-09-01' : today.slice(0, 8) + '01';
  const pr = log('1-du-an', 'giamdoc', 'Tạo dự án MTL "BM — Khu nhà ở Bình Minh (giả)", T0 = tháng 9/2026, trưởng dự án = PMO',
    await as('giamdoc', 'POST', '/api/projects', { key: 'BM', name: 'Khu nhà ở Bình Minh (giả)', kind: 'MTL', t0Date: t0, leadId: U.pmo.id, departmentId: D.BGD.id,
      description: 'Dự án mẫu để chạy thử quy trình giao việc (dữ liệu giả).' }));
  const P = pr.j;
  if (!P?.id) throw new Error('Không tạo được dự án');

  // ---------- 2. PMO nhập MTL tổng từ Excel ----------
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('MTL overall');
  ws.addRow(['MASTER TIMELINE — KHU NHÀ Ở BÌNH MINH (giả)']);
  ws.addRow(['Bước', 'Hạng mục công việc', 'Đầu mối', 'Bắt đầu (T)', 'Kết thúc (T)', 'Thời lượng (tháng)', 'Đường găng', 'Mốc']);
  const MTL = [
    [1, 'Chủ trương đầu tư (giả)', 'Pháp lý', 0, 2, 3, 'ĐƯỜNG GĂNG', ''],
    [2, 'Quy hoạch chi tiết 1/500 (giả)', 'Pháp lý/Thiết kế', 1, 4, 4, 'ĐƯỜNG GĂNG', '◆'],
    [3, 'Phương án tài chính, làm việc ngân hàng (giả)', 'Tài chính', 1, 5, 5, '', ''],
    [4, 'Thiết kế cơ sở (giả)', 'Thiết kế', 3, 6, 4, '', ''],
    [5, 'Thẩm định thiết kế cơ sở (giả)', 'Sở Xây dựng/Thiết kế', 6, 7, 2, '', '◆'],
    [6, 'Bồi thường, giải phóng mặt bằng (giả)', 'Đối ngoại', 2, 9, 8, 'ĐƯỜNG GĂNG', ''],
    [7, 'Lựa chọn nhà thầu thi công (giả)', 'QLXD', 7, 9, 3, '', ''],
    [8, 'Kế hoạch bán hàng (giả)', 'Kinh doanh', 6, 9, 4, '', ''],
  ];
  for (const r of MTL) ws.addRow(r);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const mk = extra => { const f = new FormData(); f.append('file', new Blob([buf]), 'mtl-binh-minh.xlsx'); f.append('kind', 'MASTER'); f.append('planName', 'MTL tổng'); for (const [k, v] of Object.entries(extra)) f.append(k, v); return f; };
  const prev = log('2-mtl', 'pmo', 'Xem trước nhập MTL tổng (8 hạng mục)', await raw('POST', `/api/projects/${P.id}/mtl-import`, { token: await login('pmo'), form: mk({ dryRun: '1' }) }));
  if (prev.j) obs('2-mtl', 'pmo', `Xem trước: ${JSON.stringify(prev.j).slice(0, 300)}`);
  log('2-mtl', 'pmo', 'Nhập MTL tổng', await raw('POST', `/api/projects/${P.id}/mtl-import`, { token: await login('pmo'), form: mk({}) }));
  let mtl = (await as('pmo', 'GET', `/api/projects/${P.id}/mtl`)).j;
  const step = c => mtl.items.find(i => i.planCode === String(c));
  obs('2-mtl', 'pmo', 'Sau nhập: ' + mtl.items.filter(i => !i.parentId).map(i => `${i.planCode}·${i.leadDepartmentName || '—'}·${i.status}·giao: ${(i.assignees || []).map(a => a.fullName).join(', ') || 'chưa giao'}`).join(' | '));

  // ---------- 3. PMO phân công lãnh đạo bộ phận chủ trì từng bước ----------
  const leadOf = { PL: 'tb.phaply', TC: 'tb.taichinh', TK: 'tb.thietke', GR: 'tb.doingoai', QLXD: 'tb.qlxd', KD: 'tp.kinhdoanh' };
  for (const i of mtl.items.filter(x => !x.parentId)) {
    const code = Object.keys(D).find(k => D[k].id === i.leadDepartmentId);
    const who = leadOf[code];
    if (!who || (i.assignees || []).some(a => a.id === U[who].id)) continue;
    log('3-phan-cong', 'pmo', `Giao ${i.code} (${i.title}) cho ${U[who].fullName}`, await as('pmo', 'PATCH', `/api/items/${i.id}`, { assigneeIds: [U[who].id] }));
  }
  // Ban GĐ giao việc đột xuất (TGĐ giao) vào dự án.
  const due7 = addDays(today, 7);
  const adhoc = log('3-tgd-giao', 'giamdoc', 'Giao việc đột xuất: "Báo cáo phương án tài chính sơ bộ trình HĐQT (giả)" cho Ban Tài chính, hạn 7 ngày',
    await as('giamdoc', 'POST', `/api/projects/${P.id}/items`, { title: 'Báo cáo phương án tài chính sơ bộ trình HĐQT (giả)', leadDepartmentId: D.TC.id, assigneeIds: [U['tb.taichinh'].id],
      dueDate: new Date(due7 + 'T17:00:00+07:00').toISOString(), startDate: new Date(today + 'T08:00:00+07:00').toISOString(), priority: 'HIGH', taskType: 'ADHOC' }));
  if (adhoc.s === 201) obs('3-tgd-giao', 'giamdoc', `Việc đột xuất tạo trong MTL: ${adhoc.j.code || adhoc.j.number}; có vào báo cáo tuần của Ban Tài chính không → xem bước 9`);

  // ---------- 4. Lãnh đạo bộ phận chi tiết hoá (MTL bộ phận), phân công nhân viên ----------
  mtl = (await as('pmo', 'GET', `/api/projects/${P.id}/mtl`)).j;
  const s1 = step(1), s6 = step(6), s3 = step(3), s2 = step(2);
  const child = async (actor, parent, title, who, startOff, dueOff, extra = {}) => {
    const r = await as(actor, 'POST', `/api/projects/${P.id}/items`, { title, parentId: parent.id, assigneeIds: who ? [U[who].id] : [],
      startDate: new Date(addDays(today, startOff) + 'T08:00:00+07:00').toISOString(), dueDate: new Date(addDays(today, dueOff) + 'T17:00:00+07:00').toISOString(), ...extra });
    return log('4-chi-tiet', actor, `Thêm việc con "${title}" dưới ${parent.code}, giao ${who ? U[who].fullName : '(chưa giao)'}`, r);
  };
  const c11 = await child('tb.phaply', s1, 'Soạn tờ trình chủ trương đầu tư (giả)', 'nv.phaply', -10, 3);
  const c12 = await child('tb.phaply', s1, 'Xin ý kiến Sở Xây dựng về chủ trương (giả)', 'nv.phaply', -5, 10);
  const c13 = await child('tb.phaply', s1, 'Trình UBND tỉnh chấp thuận chủ trương (giả)', 'tb.phaply', 10, 40);
  // Nhân viên thử tự thêm việc con (không phải lãnh đạo) — kỳ vọng bị chặn theo quy định MTL.
  log('4-chi-tiet', 'nv.phaply', 'Nhân viên tự thêm việc con dưới bước 1 (kỳ vọng: bị chặn, chỉ lãnh đạo chi tiết hoá)',
    await as('nv.phaply', 'POST', `/api/projects/${P.id}/items`, { title: 'Việc tự thêm (giả)', parentId: s1.id }), { expect: [403] });
  const c61 = await child('tb.doingoai', s6, 'Kiểm đếm hiện trạng đất (giả)', 'tb.doingoai', -20, -2);
  const c31 = await child('tb.taichinh', s3, 'Làm việc với Ngân hàng TMCP Mẫu về hạn mức (giả)', 'tb.taichinh', -3, 14);
  // Bộ phận phối hợp (Thiết kế ở bước 2) thử thêm việc con — quy định: chỉ bộ phận chủ trì.
  log('4-chi-tiet', 'tb.thietke', 'Bộ phận phối hợp (Thiết kế) thêm việc con dưới bước 2 (do Pháp lý chủ trì)',
    await as('tb.thietke', 'POST', `/api/projects/${P.id}/items`, { title: 'Lập bản vẽ quy hoạch tổng mặt bằng (giả)', parentId: s2.id, assigneeIds: [U['tb.thietke'].id] }), { expect: [201, 403] });
  // Checklist cho việc con của nhân viên.
  let cl = [];
  if (c11.j?.id) for (const t of ['Thu thập hồ sơ pháp lý đất (giả)', 'Soạn dự thảo tờ trình (giả)', 'Trình trưởng ban duyệt (giả)'])
    cl.push(log('4-chi-tiet', 'tb.phaply', `Checklist: ${t}`, await as('tb.phaply', 'POST', `/api/items/${c11.j.id}/checklist`, { title: t })).j);

  // ---------- 5. Nhân viên thực hiện ----------
  const myItems = (await as('nv.phaply', 'GET', '/api/my/items')).j;
  obs('5-thuc-hien', 'nv.phaply', `"Việc của tôi": ${myItems.length} việc — ${myItems.map(i => i.title).join('; ').slice(0, 300)}`);
  const sprint = (await as('nv.phaply', 'GET', '/api/my/sprint')).j;
  obs('5-thuc-hien', 'nv.phaply', `"Cập nhật nhanh" (việc trong kỳ): ${(sprint?.projects || []).map(p => p.project.key + ': ' + (p.items || []).map(i => i.code).join(', ')).join(' | ')}`);
  const bmNow = (await as('pmo', 'GET', `/api/projects/${P.id}/mtl`)).j;
  obs('5-thuc-hien', 'pmo', 'Việc con / việc đột xuất có kế hoạch gốc: ' + bmNow.items.filter(i => i.parentId || !i.planCode).map(i => `${i.code} ${i.status}`).join(', '));
  if (cl[0]?.id) log('5-thuc-hien', 'nv.phaply', 'Đánh dấu xong checklist 1', await as('nv.phaply', 'PATCH', `/api/checklist/${cl[0].id}`, { done: true }));
  if (cl[1]?.id) log('5-thuc-hien', 'nv.phaply', 'Đánh dấu xong checklist 2', await as('nv.phaply', 'PATCH', `/api/checklist/${cl[1].id}`, { done: true }));
  if (c11.j?.id) {
    const it = (await as('nv.phaply', 'GET', `/api/items/${c11.j.id}`)).j;
    obs('5-thuc-hien', 'nv.phaply', `Sau 2/3 checklist: % việc con = ${it.progress}, trạng thái = ${it.state?.name}`);
    log('5-thuc-hien', 'nv.phaply', 'Thử sửa % trực tiếp khi việc có checklist (kỳ vọng: % tính từ checklist)', await as('nv.phaply', 'PATCH', `/api/items/${c11.j.id}`, { progress: 90 }), { expect: [200, 403, 409, 422] });
    log('5-thuc-hien', 'nv.phaply', 'Bình luận @nhắc trưởng ban', await as('nv.phaply', 'POST', `/api/items/${c11.j.id}/comments`, { bodyHtml: `<p>Dự thảo tờ trình đã xong, nhờ chị <span data-mention="${U['tb.phaply'].id}">@${U['tb.phaply'].fullName}</span> xem giúp (giả).</p>` }));
  }
  if (c12.j?.id) {
    log('5-thuc-hien', 'nv.phaply', 'Báo cáo tiến độ 30% kèm khó khăn + kiến nghị', await as('nv.phaply', 'POST', `/api/items/${c12.j.id}/progress-reports`, { progress: 30, content: 'Đã gửi công văn xin ý kiến (giả).', difficulties: 'Sở chưa hẹn lịch làm việc (giả).', proposals: 'Đề nghị Ban GĐ gọi điện thúc Sở (giả).' }));
    const ext = log('5-thuc-hien', 'nv.phaply', 'Đề nghị gia hạn việc "Xin ý kiến Sở" thêm 7 ngày', await as('nv.phaply', 'POST', `/api/items/${c12.j.id}/extensions`, { newDue: new Date(addDays(today, 17) + 'T17:00:00+07:00').toISOString(), reason: 'Sở hẹn làm việc tuần sau (giả).' }));
    if (ext.j?.id) {
      const dec = log('5-thuc-hien', 'tb.phaply', 'Trưởng ban (người giao) duyệt gia hạn việc con', await as('tb.phaply', 'POST', `/api/extensions/${ext.j.id}/decide`, { decision: 'APPROVE', note: 'Đồng ý (giả).' }), { expect: [200, 403] });
      if (dec.s === 403) {
        obs('5-thuc-hien', 'tb.phaply', 'Trưởng ban giao việc con nhưng KHÔNG duyệt được gia hạn chính việc con đó: ' + dec.j?.error);
        log('5-thuc-hien', 'pmo', 'PMO duyệt gia hạn thay', await as('pmo', 'POST', `/api/extensions/${ext.j.id}/decide`, { decision: 'APPROVE', note: 'Đồng ý (giả).' }), { expect: [200, 403] });
      }
    }
  }
  // Nhân viên QLXD dùng Claude (token) — dự án chưa có việc cho QLXD trong kỳ → cập nhật việc của dự án mẫu cũ.
  const tk = await as('nv.qlxd', 'POST', '/api/me/tokens', { name: 'Claude Desktop (giả)', scopes: ['read', 'write'], days: 30 });
  log('5-claude', 'nv.qlxd', 'Tạo token Claude', tk);
  if (tk.j?.token) {
    const T = (m, p, b) => raw(m, p, { token: tk.j.token, body: b });
    const mine = log('5-claude', 'nv.qlxd (Claude)', 'Claude: "Việc của tôi"', await T('GET', '/api/my/items'));
    const target = (mine.j || []).find(i => i.state?.category !== 'COMPLETED');
    obs('5-claude', 'nv.qlxd (Claude)', `Claude thấy ${(mine.j || []).length} việc`);
    if (target) {
      log('5-claude', 'nv.qlxd (Claude)', `Claude: bình luận vào ${target.code || target.id}`, await T('POST', `/api/items/${target.id}/comments`, { bodyHtml: '<p>Cập nhật qua Claude: đã nghiệm thu cốt thép tầng 5 (giả).</p>' }));
      log('5-claude', 'nv.qlxd (Claude)', 'Claude: tạo nhắc việc', await T('POST', '/api/me/notes', { title: 'Gọi nhà thầu An Phát chốt lịch nghiệm thu (giả)', dueDate: addDays(today, 2) }));
    }
    log('5-claude', 'nv.qlxd (Claude)', 'Claude thử xem báo cáo tuần của Ban Pháp lý (kỳ vọng: chặn)', await T('GET', `/api/weekly/report?departmentId=${D.PL.id}`), { expect: [403] });
  }

  // ---------- 6. Đối tác (CRM) gắn với việc ----------
  const partners = (await as('nv.phaply', 'GET', '/api/crm/partners?q=S%E1%BB%9F')).j || [];
  const so = partners.find(p => p.name.includes('Sở Xây dựng'));
  if (so && c12.j?.id) {
    log('6-crm', 'nv.phaply', 'Ghi nhật ký làm việc với Sở Xây dựng, gắn việc "Xin ý kiến Sở", hẹn theo dõi', await as('nv.phaply', 'POST', `/api/crm/partners/${so.id}/interactions`,
      { type: 'CALL', summary: 'Gọi chuyên viên Sở hỏi lịch tiếp nhận hồ sơ chủ trương (giả).', nextStep: 'Mang hồ sơ lên Sở (giả)', nextDue: new Date(addDays(today, 5) + 'T09:00:00+07:00').toISOString(), workItemId: c12.j.id }));
    const ic = (await as('nv.phaply', 'GET', `/api/crm/items/${c12.j.id}/interactions`)).j;
    obs('6-crm', 'nv.phaply', `Mở việc "Xin ý kiến Sở": thấy ${ic?.rows?.length ?? 0} nhật ký đối tác ngay trong việc`);
    const icTc = (await as('tb.taichinh', 'GET', `/api/crm/items/${c12.j.id}/interactions`)).j;
    obs('6-crm', 'tb.taichinh', `Bộ phận khác mở cùng việc: ${icTc?.rows?.length ?? icTc?.error} nhật ký thấy được, ${icTc?.hidden ?? '?'} nhật ký ẩn (chỉ bộ phận phụ trách đối tác xem)`);
  }

  // ---------- 7. Nhân sự: nhân viên xin nghỉ giữa dự án ----------
  const mon = nextWeekday(today, 1);
  const lv = log('7-nghi', 'nv.phaply', `Xin nghỉ phép ${mon} (thứ Hai — trùng ngày giao ban, đang chủ trì 2 việc)`, await as('nv.phaply', 'POST', '/api/hrm/leaves', { type: 'ANNUAL', fromDate: mon, toDate: addDays(mon, 1), reason: 'Việc gia đình (giả)' }));
  if (lv.j?.id) {
    const ap = (await as('tb.phaply', 'GET', '/api/hrm/leaves?scope=approve')).j || [];
    const mine = ap.find(l => l.id === lv.j.id);
    obs('7-nghi', 'tb.phaply', `Màn duyệt đơn: ${ap.length} đơn; cảnh báo đơn của nv.phaply: việc đến hạn ${JSON.stringify(mine?.conflicts?.due || [])}, trùng giao ban ${JSON.stringify(mine?.conflicts?.meetings || [])}`);
    log('7-nghi', 'tb.phaply', 'Trưởng ban duyệt đơn nghỉ', await as('tb.phaply', 'POST', `/api/hrm/leaves/${lv.j.id}/decide`, { decision: 'APPROVE' }));
  }
  log('7-cham-cong', 'nv.phaply', 'Chấm công vào (giờ máy chủ)', await as('nv.phaply', 'POST', '/api/hrm/attendance/check', { kind: 'in' }), { expect: [200, 409] });

  // ---------- 8. Ban Tài chính báo cáo việc TGĐ giao, kèm kiến nghị; TGĐ trả lời ----------
  if (adhoc.j?.id) {
    const rp = log('8-tgd', 'tb.taichinh', 'Báo cáo tiến độ việc TGĐ giao 50% kèm kiến nghị', await as('tb.taichinh', 'POST', `/api/items/${adhoc.j.id}/progress-reports`,
      { progress: 50, content: 'Đã có số liệu dòng tiền sơ bộ (giả).', proposals: 'Xin ý kiến TGĐ về tỷ lệ vốn tự có 20% hay 30% (giả).' }));
    const q = (await as('giamdoc', 'GET', '/api/approvals/proposals')).j;
    obs('8-tgd', 'giamdoc', `Hộp "Kiến nghị" của TGĐ: ${JSON.stringify(q).slice(0, 200)}`);
    if (rp.j?.id) log('8-tgd', 'giamdoc', 'TGĐ trả lời kiến nghị', await as('giamdoc', 'POST', `/api/progress-reports/${rp.j.id}/answer`, { answer: 'Lấy phương án vốn tự có 30% (giả).' }), { expect: [200, 201, 422] });
  }

  // ---------- 9. Báo cáo tuần (BM-TH-01) ----------
  const ctx = (await as('tb.phaply', 'GET', '/api/weekly/context')).j;
  obs('9-bao-cao', 'hệ thống', `Tuần ${ctx?.week}; hạn nộp ${ctx?.schedule?.deadline}; giao ban ${ctx?.schedule?.meetingAt}`);
  const submit = async (actor, dept, tweak = () => {}) => {
    const rep = (await as(actor, 'GET', `/api/weekly/report?departmentId=${D[dept].id}`)).j;
    if (!rep?.prefill && !rep?.report) { obs('9-bao-cao', actor, `Không lấy được báo cáo ${dept}: ${JSON.stringify(rep).slice(0, 120)}`); return; }
    const data = structuredClone(rep.report?.data || rep.prefill);
    obs('9-bao-cao', actor, `Điền sẵn ${dept}: Phần I ${data.results.length} dòng, Phần II ${data.ongoing.length} dòng, Phần III ${data.plans.length} dòng — ${[...data.results, ...data.ongoing].map(r => `${r.ref || ''} ${r.task?.slice(0, 40)} [${r.status}${r.pct !== '' ? ' ' + r.pct + '%' : ''}]`).join('; ').slice(0, 400)}`);
    tweak(data, rep);
    let tries = 0, res;
    while (tries < 3) {
      res = await as(actor, 'POST', '/api/weekly/submit', { week: rep.week, departmentId: D[dept].id, data });
      if (res.s !== 422 || res.j?.code !== 'REPORT_INCOMPLETE') break;
      tries++;
      obs('9-bao-cao', actor, `Nộp ${dept} lần ${tries} bị trả: ${res.j.errors.slice(0, 6).join(' | ')}${res.j.errors.length > 6 ? ` (+${res.j.errors.length - 6})` : ''}`);
      const d2 = res.j.data || data;
      for (const r of [...d2.results, ...d2.ongoing]) {
        if (!r.cause) r.cause = 'Chờ cơ quan nhà nước phản hồi (giả)'; if (!r.solution) r.solution = 'Bố trí người bám Sở hằng ngày (giả)';
        if (!r.helpFrom) r.helpFrom = 'SELF'; if (!r.next) r.next = 'Tiếp tục làm việc với Sở (giả)';
        if (!r.ownerIds?.length && rep.members?.length) r.ownerIds = [rep.members[0].id];
        if (!r.due) r.due = addDays(today, 7);
      }
      if (!d2.ongoing.length && !d2.plans.length) d2.plans.push({ task: 'Kế hoạch tuần tới (giả)', basis: 'KH tháng', ownerIds: [rep.members?.[0]?.id].filter(Boolean), due: addDays(today, 7), output: '' });
      for (const p of d2.plans) if (!p.output) p.output = 'Văn bản / biên bản (giả)';
      Object.assign(data, d2);
    }
    return log('9-bao-cao', actor, `Nộp báo cáo tuần ${D[dept].name}${tries ? ` (sau ${tries} lần sửa)` : ''}`, res, { expect: [200, 201] });
  };
  await submit('tb.phaply', 'PL', d => { const r = [...d.results, ...d.ongoing].find(x => /Sở Xây dựng/.test(x.task || '')); if (r) { r.status = 'Vướng'; r.cause = 'Sở chưa hẹn lịch (giả)'; r.solution = 'Gửi công văn đôn đốc (giả)'; r.helpFrom = 'BGD'; r.helpWhat = 'TGĐ gọi lãnh đạo Sở (giả)'; r.helpBy = addDays(today, 5); } });
  // Bộ phận chưa có hạng mục MTL trong tuần: tự ghi việc thường xuyên (Phần I) và kế hoạch tuần tới (Phần III) như mẫu BM-TH-01.
  const manual = (task, plan) => (d, rep) => { const who = [rep.members?.[0]?.id].filter(Boolean);
    if (!d.results.length && !d.ongoing.length) d.results.push({ task, source: 'KH tháng', status: 'Đúng tiến độ', pct: 100, ownerIds: who, due: today });
    if (!d.plans.length) d.plans.push({ task: plan, basis: 'KH tháng', ownerIds: who, due: addDays(today, 7), output: 'Biên bản / văn bản (giả)' });
  };
  await submit('nv.qlxd', 'QLXD', manual('Giám sát thi công tầng 5 dự án mẫu (giả)', 'Nghiệm thu cốt thép tầng 6 (giả)'));
  await submit('tb.taichinh', 'TC', manual('Đối chiếu công nợ nhà thầu (giả)', 'Lập kế hoạch dòng tiền tháng 11 (giả)'));
  await submit('tb.thietke', 'TK');
  log('9-bao-cao', 'tp.kinhdoanh', 'Báo vắng giao ban thứ Hai (đi công tác), cử người dự thay',
    await as('tp.kinhdoanh', 'POST', '/api/weekly/notices', { week: ctx?.week, departmentId: D.KD.id, type: 'ABSENT', reason: 'CONG_TAC', substituteId: U['nv.kinhdoanh1'].id }));
  await submit('tp.kinhdoanh', 'KD', manual('Khảo sát nhu cầu khách hàng NƠXH (giả)', 'Hoàn thiện bảng giá dự kiến (giả)'));
  obs('9-bao-cao', 'tb.doingoai', 'Ban Đối ngoại – GPMB KHÔNG nộp, không báo (để xem nhắc / chấm điểm)');

  // ---------- 10. Thư ký tổng hợp, TGĐ kết luận ----------
  const sumSec = (await as('nv.hcns', 'GET', '/api/weekly/summary')).j;
  obs('10-giao-ban', 'nv.hcns', `Thư ký xem tổng hợp: ${JSON.stringify(sumSec?.sum?.status || sumSec?.status || Object.keys(sumSec || {})).slice(0, 300)}`);
  const sumGd = (await as('giamdoc', 'GET', '/api/weekly/summary')).j;
  const helps = (sumGd?.helps || []).flatMap(g => g.list || []);
  obs('10-giao-ban', 'giamdoc', `TGĐ thấy ${helps.length} đề nghị hỗ trợ: ${helps.map(h => h.task || h.helpWhat).join('; ').slice(0, 200)}`);
  const att = Object.fromEntries(['PL', 'TC', 'TK', 'QLXD', 'GR', 'KD'].map(c => [D[c].id, c === 'GR' ? 'ABSENT' : 'PRESENT']));
  const m1 = log('10-giao-ban', 'nv.hcns', 'Thư ký ghi điểm danh + Action Log', await as('nv.hcns', 'PUT', '/api/weekly/meeting', { week: ctx?.week, attendance: att,
    baseActions: sumSec?.actionsVersion, actions: [{ task: 'Ban Đối ngoại nộp bổ sung báo cáo GPMB (giả)', departmentId: D.GR.id, ownerId: U['tb.doingoai'].id, due: addDays(today, 4) }] }), { expect: [200, 409] });
  const conc = Object.fromEntries(helps.map(h => [h.key, { decision: 'APPROVE', note: 'TGĐ sẽ làm việc trực tiếp (giả).' }]));
  log('10-giao-ban', 'giamdoc', 'TGĐ kết luận các đề nghị hỗ trợ và phát hành', await as('giamdoc', 'PUT', '/api/weekly/meeting', { week: ctx?.week, conclusions: conc, publish: true }), { expect: [200, 422] });

  // ---------- 11. Ban GĐ / PMO theo dõi ----------
  const mtlEnd = (await as('giamdoc', 'GET', `/api/projects/${P.id}/mtl`)).j;
  obs('11-theo-doi', 'giamdoc', `Tổng quan dự án BM: ${JSON.stringify(mtlEnd?.summary || mtlEnd?.stats || {}).slice(0, 300)}`);
  const alerts = log('11-theo-doi', 'pmo', 'Chạy cảnh báo tiến độ dự án BM', await as('pmo', 'POST', `/api/projects/${P.id}/mtl-alerts/run`), { expect: [200, 201] });
  obs('11-theo-doi', 'pmo', `Cảnh báo: ${JSON.stringify(alerts.j).slice(0, 200)}`);
  const kpi = log('11-theo-doi', 'tb.phaply', 'Lãnh đạo bộ phận xem KPI dự án', await as('tb.phaply', 'GET', `/api/projects/${P.id}/mtl-kpi`), { expect: [200, 403] });
  obs('11-theo-doi', 'tb.phaply', `KPI: ${JSON.stringify(kpi.j).slice(0, 200)}`);
  for (const u of ['giamdoc', 'tb.phaply', 'nv.phaply', 'tb.taichinh', 'nv.hcns', 'tb.doingoai']) {
    const n = (await as(u, 'GET', '/api/notifications')).j;
    obs('12-thong-bao', u, `${n?.unread ?? '?'} thông báo chưa đọc: ${(n?.items || []).slice(0, 6).map(x => x.title).join(' | ')}`);
  }
}

main().catch(e => { console.error('DỪNG:', e.message); journal.push({ fatal: e.message }); }).finally(() => { fs.writeFileSync(OUT, JSON.stringify(journal, null, 1)); console.log('journal →', OUT); });
