// Sinh dữ liệu GIẢ quy mô vận hành thật (≈50 người, 12 dự án MTL × 60 bước, ~1 năm lịch sử) trên BẢN THỬ để đo hiệu năng.
//   docker exec -e PERF_DATA=yes <container bản thử> node scripts/perf-data.mjs
// Từ chối nếu không phải bản thử (SEED_DEMO=true, ALLOW_DEMO_SEED=yes, PERF_DATA=yes).
// ĐỔI mật khẩu mọi tài khoản thường (trừ quản trị gốc) thành PERF_PW (mặc định Perf@2026) để kịch bản đo đăng nhập được.
// Cấu trúc (dự án, nhập MTL, việc con) đi qua API thật; lịch sử khối lượng lớn (báo cáo tiến độ, bình luận, thông báo,
// nhật ký, ảnh chụp tiến độ, cảnh báo, báo cáo tuần các tuần trước) ghi thẳng CSDL. Chạy lại: dự án PFxx đã có thì bỏ qua.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));

const env = process.env;
if (env.SEED_DEMO !== 'true' || env.ALLOW_DEMO_SEED !== 'yes' || env.PERF_DATA !== 'yes') {
  console.error('Từ chối: chỉ chạy trên bản thử (SEED_DEMO=true, ALLOW_DEMO_SEED=yes) và đặt PERF_DATA=yes.');
  process.exit(2);
}
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { grantInitialPermissions } = require('./src/lib/permissions');
const WK = require('./src/services/weekly');
const prisma = new PrismaClient();

const B = env.BASE || 'http://127.0.0.1:4000';
const PW = env.PERF_PW || 'Perf@2026';
const NP = +(env.PF_PROJECTS || 12), NS = +(env.PF_STEPS || 60), NU = +(env.PF_USERS || 50), DAYS = +(env.PF_DAYS || 365);
const DAY = 86400e3, NOW = Date.now();
let seed = 20261101;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ymd = d => new Date(d).toISOString().slice(0, 10);
const utcDay = ms => new Date(ymd(ms) + 'T00:00:00Z');
async function chunked(rows, fn, size = 2000) { for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size)); return rows.length; }

// ---------- HTTP (tự chờ khi gặp 429) ----------
const tokens = {};
async function http(method, p, { token, body, form } = {}) {
  for (let i = 0; i < 40; i++) {
    const headers = token ? { authorization: 'Bearer ' + token } : {};
    let payload;
    if (form) payload = form(); else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(B + p, { method, headers, body: payload });
    if (r.status === 429) { await sleep(2500); continue; }
    const ct = r.headers.get('content-type') || '';
    return { s: r.status, j: ct.includes('json') ? await r.json().catch(() => null) : null };
  }
  throw new Error('429 quá lâu: ' + p);
}
async function login(u) {
  if (tokens[u]) return tokens[u];
  const r = await http('POST', '/api/auth/login', { body: { username: u, password: PW } });
  if (r.s !== 200) throw new Error(`Đăng nhập ${u}: ${r.s} ${r.j?.error || ''}`);
  return (tokens[u] = r.j.token);
}
const as = async (u, m, p, body, o = {}) => http(m, p, { token: await login(u), body, ...o });

// ---------- Danh mục giả ----------
const FAM = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
const MID = ['Văn', 'Thị', 'Hữu', 'Minh', 'Thanh', 'Quốc', 'Ngọc', 'Đức', 'Thu', 'Hoài', 'Gia', 'Bảo'];
const GIV = ['An', 'Bình', 'Châu', 'Dũng', 'Giang', 'Hà', 'Hải', 'Hạnh', 'Hiếu', 'Hoa', 'Huy', 'Khánh', 'Lan', 'Linh', 'Long', 'Mai', 'Nam', 'Nga', 'Phong', 'Phúc', 'Quân', 'Quỳnh', 'Sơn', 'Tâm', 'Thảo', 'Trang', 'Trung', 'Tuấn', 'Vy', 'Yến'];
const PROJECTS = ['Khu đô thị Sông Xanh', 'Tổ hợp căn hộ Ánh Dương', 'Khu nhà ở Hồ Sen', 'Khu dân cư Đồi Thông', 'Trung tâm thương mại Bến Mới', 'Khu nhà ở xã hội Phú An',
  'Khu biệt thự Vườn Cau', 'Tòa văn phòng Hải Đăng', 'Khu đô thị Cửa Sông', 'Khu dân cư Bãi Bồi', 'Khu nhà phố Lộc Phát', 'Khu nghỉ dưỡng Mũi Gió'];
const STEPS = {
  PL: ['Thẩm định pháp lý khu đất', 'Chấp thuận chủ trương đầu tư', 'Quyết định giao đất', 'Xác định nghĩa vụ tài chính đất', 'Thẩm định báo cáo ĐTM', 'Cấp giấy phép xây dựng', 'Nghiệm thu PCCC'],
  TK: ['Ý tưởng quy hoạch', 'Quy hoạch chi tiết 1/500', 'Thiết kế cơ sở', 'Thiết kế kỹ thuật', 'Thiết kế bản vẽ thi công', 'Thiết kế nhà mẫu', 'Thoả thuận đấu nối hạ tầng'],
  TC: ['Phương án tài chính', 'Thu xếp vốn vay ngân hàng', 'Bảo lãnh nhà ở hình thành trong tương lai', 'Kế hoạch dòng tiền', 'Quyết toán giai đoạn'],
  GR: ['Kiểm đếm hiện trạng', 'Phương án bồi thường', 'Chi trả bồi thường', 'Bàn giao mặt bằng', 'Bố trí tái định cư'],
  QLXD: ['Lựa chọn nhà thầu thi công', 'Thi công cọc', 'Thi công móng, tầng hầm', 'Thi công phần thân', 'Hoàn thiện', 'Hạ tầng kỹ thuật', 'Nghiệm thu bàn giao'],
  KD: ['Nghiên cứu thị trường', 'Chính sách bán hàng', 'Mở bán đợt 1', 'Mở bán đợt 2', 'Bàn giao căn hộ'],
};
const CHILD = ['Chuẩn bị hồ sơ', 'Làm việc với cơ quan quản lý', 'Rà soát nội bộ', 'Trình ký', 'Lấy ý kiến bộ phận phối hợp', 'Hoàn thiện theo góp ý', 'Nộp hồ sơ', 'Theo dõi kết quả', 'Họp kỹ thuật', 'Nghiệm thu'];
const TEXT = ['Đã gửi văn bản, chờ phản hồi', 'Đã họp thống nhất phương án', 'Đang hoàn thiện hồ sơ theo góp ý', 'Nhà thầu đã huy động đủ nhân lực', 'Đã trình lãnh đạo ký',
  'Chờ ý kiến bộ phận phối hợp', 'Đã nộp hồ sơ một cửa', 'Đang đối chiếu số liệu', 'Đã nghiệm thu nội bộ', 'Cần bổ sung bản vẽ'];
const phaseDepts = k => (k < NS * 0.3 ? ['PL', 'TK', 'GR', 'PL'] : k < NS * 0.6 ? ['TK', 'TC', 'GR', 'QLXD', 'PL'] : ['QLXD', 'QLXD', 'KD', 'TC']);
const eom = (y, m) => new Date(Date.UTC(y, m + 1, 0)); // ngày cuối tháng m (0-based)

async function main() {
  const t0 = Date.now();
  const depts = Object.fromEntries((await prisma.department.findMany()).map(d => [d.code, d]));
  const root = await prisma.user.findFirst({ where: { isRootAdmin: true } });
  const hash = bcrypt.hashSync(PW, 10);

  // ---------- 1. Người dùng ----------
  await prisma.user.updateMany({ where: { isRootAdmin: false }, data: { passwordHash: hash, mustChangePw: false } });
  const fill = ['QLXD', 'QLXD', 'PL', 'TC', 'TK', 'GR', 'KD', 'QLXD', 'PL', 'TK', 'TC', 'GR', 'HCNS', 'KT', 'KD', 'QLXD', 'PL', 'TK', 'TC', 'GR'];
  let have = await prisma.user.count({ where: { isActive: true, isRootAdmin: false } });
  for (let i = 1; have < NU && i < 500; i++) {
    const username = `nv.pf${String(i).padStart(2, '0')}`;
    if (await prisma.user.findUnique({ where: { username } })) continue;
    const dept = depts[fill[(i - 1) % fill.length]];
    await prisma.$transaction(async tx => {
      const u = await tx.user.create({ data: { username, fullName: `${pick(FAM)} ${pick(MID)} ${pick(GIV)}`, displayTitle: 'Chuyên viên', role: 'member', departmentId: dept.id, passwordHash: hash, mustChangePw: false } });
      await grantInitialPermissions(tx, u, root.id);
    });
    have++;
  }
  const users = await prisma.user.findMany({ where: { isActive: true, isRootAdmin: false }, select: { id: true, username: true, role: true, departmentId: true } });
  const U = Object.fromEntries(users.map(u => [u.username, u]));
  const leaderOf = {}; const membersOf = {};
  for (const u of users) {
    (membersOf[u.departmentId] ||= []).push(u);
    if (u.role === 'manager' && !leaderOf[u.departmentId]) leaderOf[u.departmentId] = u;
  }
  say(`người dùng: ${users.length} (mật khẩu chung ${PW})`);

  // ---------- 2. Cấu hình giao ban ----------
  const weeklyDepts = ['PL', 'TC', 'TK', 'QLXD', 'GR', 'KD'];
  const cfg = await as('giamdoc', 'PUT', '/api/weekly/config', { secretaryDepartmentId: depts.HCNS.id, pmoUserIds: [U.pmo.id], departments: weeklyDepts.map(c => depts[c].id) });
  say('cấu hình giao ban:', cfg.s);

  // ---------- 3. Dự án MTL + nhập MTL tổng qua API ----------
  const created = [];
  for (let p = 0; p < NP; p++) {
    const key = `PF${String(p + 1).padStart(2, '0')}`;
    if (await prisma.project.findUnique({ where: { key } })) continue;
    const ago = 3 + ((p * 7) % 18); // T0 cách đây 3–20 tháng
    const now = new Date(NOW);
    const t0Date = ymd(eom(now.getUTCFullYear(), now.getUTCMonth() - ago));
    const pr = await as('giamdoc', 'POST', '/api/projects', { key, name: `${PROJECTS[p % PROJECTS.length]} (giả)`, kind: 'MTL', t0Date, leadId: U.pmo.id, departmentId: depts.BGD.id,
      description: 'Dự án giả để đo hiệu năng (perf-data).' });
    if (pr.s !== 201 && pr.s !== 200) throw new Error(`Tạo dự án ${key}: ${pr.s} ${pr.j?.error}`);
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('MTL overall');
    ws.addRow([`MASTER TIMELINE — ${PROJECTS[p % PROJECTS.length].toUpperCase()} (giả)`]);
    ws.addRow(['Bước', 'Hạng mục công việc', 'Đầu mối', 'Bắt đầu (T)', 'Kết thúc (T)', 'Thời lượng (tháng)', 'Đường găng', 'Mốc']);
    for (let k = 0; k < NS; k++) {
      const code = pick(phaseDepts(k));
      const start = Math.floor((k * 30) / NS) + int(0, 2), dur = int(1, 5);
      ws.addRow([k + 1, `${pick(STEPS[code])} — phân kỳ ${1 + (k % 3)} (giả)`, depts[code].name, start, start + dur - 1, dur, rnd() < 0.25 ? 'ĐƯỜNG GĂNG' : '', rnd() < 0.12 ? '◆' : '']);
    }
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const form = () => { const f = new FormData(); f.append('file', new Blob([buf]), `mtl-${key}.xlsx`); f.append('kind', 'MASTER'); f.append('planName', 'MTL tổng'); return f; };
    const im = await http('POST', `/api/projects/${pr.j.id}/mtl-import`, { token: await login('pmo'), form });
    if (im.s >= 300) throw new Error(`Nhập MTL ${key}: ${im.s} ${JSON.stringify(im.j).slice(0, 300)}`);
    created.push(pr.j.id);
    say(`${key}: T0 ${t0Date}, nhập MTL ${im.s}`);
  }
  if (!created.length) { say('Không có dự án mới — dữ liệu đã sinh trước đó.'); return; }

  // ---------- 4. Giao bước MTL cho lãnh đạo bộ phận chủ trì ----------
  const steps = await prisma.workItem.findMany({ where: { projectId: { in: created }, parentId: null }, select: { id: true, projectId: true, leadDepartmentId: true, baselineStart: true, baselineEnd: true, title: true } });
  const asg = steps.filter(s => leaderOf[s.leadDepartmentId]).map(s => ({ workItemId: s.id, userId: leaderOf[s.leadDepartmentId].id }));
  await prisma.workItemAssignee.createMany({ data: asg, skipDuplicates: true });
  await prisma.workItem.updateMany({ where: { id: { in: steps.map(s => s.id) } }, data: { assignedById: U.pmo.id, assignedAt: new Date(NOW - 120 * DAY) } });
  say(`bước MTL: ${steps.length}, đã giao ${asg.length}`);

  // ---------- 5. Lãnh đạo bộ phận chi tiết hoá: việc con qua API (song song theo người tạo) ----------
  const byLeader = {};
  for (const s of steps) {
    const lead = leaderOf[s.leadDepartmentId]; if (!lead || !s.baselineStart || !s.baselineEnd) continue;
    const a = s.baselineStart.getTime(), b = Math.max(s.baselineEnd.getTime(), a + 10 * DAY);
    const n = int(2, 6);
    for (let i = 0; i < n; i++) {
      const st = a + Math.floor(((b - a) * i) / n), en = Math.min(b, st + Math.max(5 * DAY, Math.floor((b - a) / n) + int(0, 10) * DAY));
      const who = pick(membersOf[s.leadDepartmentId] || [lead]);
      (byLeader[lead.username] ||= []).push({ projectId: s.projectId, body: { title: `${pick(CHILD)} — ${s.title.replace(/ \(giả\)$/, '')} (giả)`, parentId: s.id, assigneeIds: [who.id],
        startDate: new Date(st).toISOString(), dueDate: new Date(en).toISOString() } });
    }
  }
  let ok = 0, bad = 0, firstErr = null;
  await Promise.all(Object.entries(byLeader).map(async ([u, list]) => {
    for (const x of list) {
      const r = await as(u, 'POST', `/api/projects/${x.projectId}/items`, x.body);
      if (r.s === 201 || r.s === 200) ok++; else { bad++; firstErr ||= `${u}: ${r.s} ${r.j?.error}`; }
    }
  }));
  say(`việc con: ${ok} tạo, ${bad} lỗi${firstErr ? ' — ' + firstErr : ''}`);

  // ---------- 6. Tiến độ thực tế theo thời gian (ghi thẳng CSDL) ----------
  const items = await prisma.workItem.findMany({ where: { projectId: { in: created } },
    select: { id: true, number: true, projectId: true, parentId: true, title: true, startDate: true, dueDate: true, baselineStart: true, baselineEnd: true, leadDepartmentId: true, createdAt: true,
      assignees: { select: { userId: true } } } });
  const states = await prisma.workflowState.findMany({ where: { projectId: { in: created } } });
  const stateOf = (pid, cat) => states.find(s => s.projectId === pid && s.category === cat);
  const proj = Object.fromEntries((await prisma.project.findMany({ where: { id: { in: created } }, select: { id: true, key: true, t0Date: true } })).map(p => [p.id, p]));
  const facts = [];
  for (const it of items) {
    const a = (it.startDate || it.baselineStart)?.getTime(), b = (it.dueDate || it.baselineEnd)?.getTime();
    if (!a || !b) continue;
    const planned = clamp((NOW - a) / Math.max(DAY, b - a), 0, 1);
    let pct = planned >= 1 ? (rnd() < 0.8 ? 100 : int(5, 18) * 5) : planned <= 0 ? (rnd() < 0.05 ? 10 : 0) : clamp(Math.round((planned * 100 + int(-30, 10)) / 5) * 5, 0, 95);
    const cat = pct >= 100 ? 'COMPLETED' : pct > 0 ? 'STARTED' : 'UNSTARTED';
    const startedAt = pct > 0 ? new Date(Math.min(NOW - DAY, a + int(0, 10) * DAY)) : null;
    const completedAt = cat === 'COMPLETED' ? new Date(Math.min(NOW - DAY, b + int(-15, 25) * DAY)) : null;
    facts.push({ it, a, b, pct, cat, startedAt, completedAt });
  }
  for (let i = 0; i < facts.length; i += 200) {
    await prisma.$transaction(facts.slice(i, i + 200).map(f => prisma.workItem.update({ where: { id: f.it.id }, data: {
      progress: f.pct, stateId: stateOf(f.it.projectId, f.cat).id, startedAt: f.startedAt, completedAt: f.completedAt,
      progressAt: f.pct > 0 ? new Date(Math.min(NOW - DAY, (f.completedAt || new Date(NOW)).getTime() - int(0, 20) * DAY)) : null } })));
  }
  say(`tiến độ: ${facts.length} việc (${facts.filter(f => f.cat === 'COMPLETED').length} xong, ${facts.filter(f => f.cat === 'STARTED').length} đang làm)`);

  // ---------- 7. Lịch sử: báo cáo tiến độ, bình luận, hoạt động ----------
  const actorOf = f => f.it.assignees[0]?.userId || pick(users).id;
  const reports = [], comments = [], acts = [];
  for (const f of facts) {
    const end = (f.completedAt || new Date(NOW)).getTime();
    if (f.it.parentId && f.pct > 0) {
      const n = int(1, 4);
      for (let k = 1; k <= n; k++) {
        const at = f.startedAt.getTime() + ((end - f.startedAt.getTime()) * k) / (n + 1);
        reports.push({ workItemId: f.it.id, authorId: actorOf(f), progress: Math.round((f.pct * k) / n), content: pick(TEXT) + ' (giả).',
          difficulties: rnd() < 0.2 ? 'Chờ cơ quan quản lý phản hồi (giả).' : '', proposals: rnd() < 0.1 ? 'Đề nghị Ban GĐ hỗ trợ làm việc với Sở (giả).' : '', createdAt: new Date(at) });
      }
    }
    for (let k = int(0, 3); k > 0; k--) {
      const txt = pick(TEXT) + ' (giả).';
      comments.push({ workItemId: f.it.id, authorId: pick(users).id, bodyHtml: `<p>${txt}</p>`, bodyText: txt, createdAt: new Date(Math.min(NOW, f.a + rnd() * Math.max(DAY, end - f.a))) });
    }
    if (f.startedAt) acts.push({ workItemId: f.it.id, actorId: actorOf(f), type: 'STATE', data: { from: 'Chưa bắt đầu', to: 'Đang thực hiện' }, createdAt: f.startedAt });
    if (f.completedAt) acts.push({ workItemId: f.it.id, actorId: actorOf(f), type: 'STATE', data: { from: 'Đang thực hiện', to: 'Hoàn thành' }, createdAt: f.completedAt });
  }
  await chunked(reports, c => prisma.progressReport.createMany({ data: c }));
  await chunked(comments, c => prisma.comment.createMany({ data: c }));
  await chunked(acts, c => prisma.activity.createMany({ data: c }));
  say(`báo cáo tiến độ ${reports.length}, bình luận ${comments.length}, hoạt động ${acts.length}`);

  // ---------- 8. Cảnh báo tiến độ + ảnh chụp tiến độ hằng ngày ----------
  const alerts = [];
  for (const f of facts) {
    const late = f.cat !== 'COMPLETED' && f.b < NOW, behind = f.cat === 'STARTED' && f.pct < 60;
    if (!late && !behind) continue;
    const kind = late ? 'OVERDUE' : 'BEHIND', level = late ? 'DANGER' : 'WARN';
    for (let d = Math.max(f.a, NOW - DAYS * DAY); d < NOW; d += 7 * DAY) if (rnd() < 0.6) alerts.push({ projectId: f.it.projectId, workItemId: f.it.id, kind, level, day: utcDay(d), lateDays: late ? Math.round((NOW - f.b) / DAY) : null, variance: behind ? -int(10, 40) : null, recipients: int(1, 4), createdAt: new Date(d) });
  }
  await chunked(alerts, c => prisma.progressAlert.createMany({ data: c, skipDuplicates: true }));
  const snaps = [];
  for (const pid of created) {
    const t0 = proj[pid].t0Date.getTime(), span = 36 * 30 * DAY;
    const deptIds = [null, ...new Set(steps.filter(s => s.projectId === pid).map(s => s.leadDepartmentId).filter(Boolean))];
    for (const dep of deptIds) {
      let spi = 0.75 + rnd() * 0.3;
      for (let d = Math.max(t0, NOW - DAYS * DAY); d <= NOW; d += DAY) {
        spi = clamp(spi + (rnd() - 0.5) * 0.02, 0.5, 1.1);
        const planned = clamp(((d - t0) / span) * 100, 0, 100), actual = Math.round(planned * spi * 10) / 10;
        snaps.push({ projectId: pid, departmentId: dep, day: utcDay(d), plannedPct: Math.round(planned * 10) / 10, actualPct: actual, spi: planned ? Math.round(spi * 100) / 100 : null });
      }
    }
  }
  await chunked(snaps, c => prisma.progressSnapshot.createMany({ data: c, skipDuplicates: true }));
  say(`cảnh báo ${alerts.length}, ảnh chụp tiến độ ${snaps.length}`);

  // ---------- 9. Thông báo + nhật ký kiểm toán ----------
  const NT = [['MTL_ALERT', 0.45, 'Chậm tiến độ'], ['ASSIGNED', 0.15, 'Được giao việc'], ['COMMENT', 0.15, 'Bình luận mới'], ['MENTION', 0.05, 'Nhắc đến bạn'],
    ['PROGRESS', 0.1, 'Báo cáo tiến độ'], ['DUE_SOON', 0.05, 'Sắp đến hạn'], ['WEEKLY_REMINDER', 0.05, 'Nhắc nộp báo cáo tuần']];
  const ntype = () => { let x = rnd(); for (const t of NT) { if ((x -= t[1]) <= 0) return t; } return NT[0]; };
  const notes = [];
  const perUser = Math.round(DAYS * 4);
  for (const u of users) {
    for (let k = 0; k < perUser; k++) {
      const f = pick(facts), [type, , label] = ntype();
      const at = NOW - Math.floor(rnd() * DAYS * DAY);
      const old = NOW - at > 3 * DAY;
      notes.push({ userId: u.id, type, title: `[${label}] ${proj[f.it.projectId].key}-${f.it.number} · ${f.it.title}`.slice(0, 250), body: type === 'MTL_ALERT' ? `Thực tế ${f.pct}%` : null,
        link: type === 'WEEKLY_REMINDER' ? '#/weekly' : `#/projects/${f.it.projectId}?item=${f.it.id}`, readAt: rnd() < (old ? 0.92 : 0.4) ? new Date(at + int(1, 48) * 3600e3) : null, createdAt: new Date(at) });
    }
  }
  await chunked(notes, c => prisma.notification.createMany({ data: c }), 5000);
  const AA = [['UPDATE', 'WorkItem', 0.6], ['CREATE', 'WorkItem', 0.12], ['SUBMIT', 'WeeklyReport', 0.05], ['EXPORT_EXCEL', 'Project', 0.08], ['DOWNLOAD', 'Attachment', 0.1], ['MTL_IMPORT', 'Project', 0.05]];
  const audit = [];
  for (let k = 0; k < users.length * DAYS * 6; k++) {
    let x = rnd(), a = AA[0]; for (const t of AA) { if ((x -= t[2]) <= 0) { a = t; break; } }
    const f = pick(facts);
    audit.push({ userId: pick(users).id, action: a[0], entity: a[1], entityId: String(a[1] === 'WorkItem' ? f.it.id : f.it.projectId),
      oldValue: a[0] === 'UPDATE' ? JSON.stringify({ progress: Math.max(0, f.pct - 10) }) : null, newValue: a[0] === 'UPDATE' ? JSON.stringify({ progress: f.pct }) : null,
      ip: `192.168.1.${int(10, 250)}`, userAgent: 'Mozilla/5.0 (perf-data)', createdAt: new Date(NOW - Math.floor(rnd() * DAYS * DAY)) });
  }
  await chunked(audit, c => prisma.auditLog.createMany({ data: c }), 5000);
  say(`thông báo ${notes.length}, nhật ký ${audit.length}`);

  // ---------- 10. Báo cáo tuần các tuần trước (mẫu = bản điền sẵn tuần này của từng bộ phận) ----------
  const cur = WK.currentFriday(new Date(NOW));
  const sha256 = v => crypto.createHash('sha256').update(WK.stableStringify(v)).digest('hex');
  let nw = 0;
  for (const code of weeklyDepts) {
    const d = depts[code], lead = leaderOf[d.id]; if (!lead) continue;
    const rep = await as(lead.username, 'GET', `/api/weekly/report?departmentId=${d.id}`);
    const tpl = rep.j?.report?.data || rep.j?.prefill;
    if (!tpl) { say(`báo cáo tuần ${code}: không lấy được mẫu (${rep.s})`); continue; }
    for (let w = 1; w <= Math.floor(DAYS / 7); w++) {
      const week = WK.addDays(cur, -7 * w);
      if (rnd() < 0.06) continue; // thỉnh thoảng không nộp
      const at = new Date(week + 'T03:00:00Z');
      const data = structuredClone(tpl);
      const exists = await prisma.weeklyReport.findUnique({ where: { departmentId_week: { departmentId: d.id, week } } });
      if (exists) continue;
      const r = await prisma.weeklyReport.create({ data: { departmentId: d.id, week, status: 'SUBMITTED', data, preparerId: lead.id, firstSubmittedAt: at, submittedAt: at, submittedById: lead.id, submitCount: 1, createdAt: at } });
      await prisma.weeklyReportVersion.create({ data: { reportId: r.id, n: 1, departmentId: d.id, week, data, sha256: sha256(data), submittedAt: at, submittedById: lead.id, createdAt: at } });
      nw++;
    }
  }
  say(`báo cáo tuần: ${nw}`);

  const counts = {};
  for (const m of ['user', 'project', 'workItem', 'workItemAssignee', 'progressReport', 'comment', 'activity', 'notification', 'auditLog', 'progressAlert', 'progressSnapshot', 'weeklyReport'])
    counts[m] = await prisma[m].count();
  say('tổng trong CSDL:', JSON.stringify(counts));
  say(`xong sau ${Math.round((Date.now() - t0) / 1000)} giây`);
}

main().catch(e => { console.error('DỪNG:', e.stack || e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
