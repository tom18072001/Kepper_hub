// Kepper GĐ2b — Báo cáo tuần bộ phận theo Quy chế QC-TH-01 / Quy trình QT-TH-01 / Biểu mẫu BM-TH-01.
// Hàm thuần (không đụng CSDL): tuần theo giờ VN, điền sẵn báo cáo từ MTL + báo cáo tuần trước + Action Log giao ban,
// làm sạch / kiểm tra dữ liệu nộp, tình trạng nộp (đúng hạn / muộn / không nộp), bản tổng hợp giao ban và chấm điểm tuân thủ.
const DAY = 86_400_000, H7 = 7 * 3_600_000;

// ---------- Danh mục theo BM-TH-01 ----------
const SOURCES = ['KH tháng', 'KH quý', 'KH năm', 'Phát sinh', 'TGĐ giao', 'Chuyển tiếp tuần trước'];
const MTL_SOURCE = 'MTL'; // hạng mục tự điền từ Master Timeline
const STATUSES = ['Hoàn thành', 'Đúng tiến độ', 'Chưa bắt đầu', 'Chậm', 'Vướng'];
const DONE = 'Hoàn thành';
const HELP_BGD = 'BGD', HELP_SELF = 'SELF'; // còn lại: 'D<id bộ phận>'
const REASONS = { CONG_TAC: 'Đi công tác', NGHI_PHEP: 'Nghỉ phép', DOT_XUAT: 'Việc đột xuất', KHAC: 'Lý do khác' };
const NOTICE_TYPES = { LATE: 'Nộp báo cáo muộn', ABSENT: 'Vắng mặt giao ban' };
const ATTENDANCE = { PRESENT: 'Có mặt', LATE: 'Đi muộn > 10 phút', ABSENT: 'Vắng' };
const DECISIONS = { APPROVE: 'Chấp thuận', ASSIGN: 'Giao bộ phận phối hợp', OTHER: 'Phương án khác' };
// Phụ lục 1 — mức trừ đề xuất (TGĐ chốt khi ban hành; ghi đè bằng AppSetting "weekly.config".points).
const POINTS = { LATE_NOTICED: 5, LATE_UNNOTICED: 15, NOT_SUBMITTED: 25, NOT_PASSING: 5, LATE_ARRIVAL: 5, ABSENT_UNNOTICED: 25, ABSENT_NOTICED: 0 };
const POINT_LABEL = {
  LATE_NOTICED: 'Nộp muộn, có thông báo trước hạn', LATE_UNNOTICED: 'Nộp muộn, không thông báo trước', NOT_SUBMITTED: 'Không nộp (quá 12:00 thứ Bảy)',
  NOT_PASSING: 'Báo cáo không đạt', LATE_ARRIVAL: 'Đi muộn quá 10 phút, không báo trước', ABSENT_UNNOTICED: 'Vắng mặt không báo trước', ABSENT_NOTICED: 'Vắng có báo trước, có người dự thay',
};

// ---------- Ngày / tuần (chuỗi YYYY-MM-DD theo giờ VN) ----------
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const dayOf = d => (d ? new Date(new Date(d).getTime() + H7).toISOString().slice(0, 10) : '');
const at = (day, hh, mm) => new Date(Date.parse(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+07:00`));
const weekday = s => new Date(Date.parse(s + 'T00:00:00Z')).getUTCDay(); // 0 = CN … 5 = thứ Sáu
// Thứ Sáu của tuần báo cáo: T2–T6 → thứ Sáu tuần này; T7, CN → thứ Sáu vừa qua.
function currentFriday(now = new Date()) {
  const d = dayOf(now), w = weekday(d);
  return addDays(d, w === 6 ? -1 : w === 0 ? -2 : 5 - w);
}
const isFriday = s => isDay(s) && weekday(s) === 5;
const fmtD = s => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
const fmtDY = s => (s ? `${fmtD(s)}/${s.slice(0, 4)}` : '');
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const fmtTime = t => { if (!t) return ''; const x = new Date(new Date(t).getTime() + H7); return `${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')} ${WD[x.getUTCDay()]} ${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}`; };

// Các mốc của một tuần (thứ Sáu f). meeting.data.deadlineDay / meetingDay đổi khi trùng ngày nghỉ (Điều 3).
function scheduleOf(f, meeting = null) {
  const m = meeting?.data || meeting || {};
  const deadlineDay = isDay(m.deadlineDay) ? m.deadlineDay : f;
  const meetingDay = isDay(m.meetingDay) ? m.meetingDay : addDays(f, 3);
  return {
    week: f, from: addDays(f, -4), to: f, nextFrom: addDays(f, 3), nextTo: addDays(f, 7), deadlineDay, meetingDay, skip: !!m.skip,
    remind: at(deadlineDay, 15, 0), deadline: at(deadlineDay, 17, 30), grace: at(addDays(deadlineDay, 1), 12, 0),
    summaryDue: at(meetingDay, 8, 0), meetingAt: at(meetingDay, 8, 30), absentEmergency: at(meetingDay, 8, 0), actionLogDue: at(meetingDay, 14, 0),
  };
}

// ---------- Tình trạng hạng mục ----------
// Quá hạn = đã QUA deadline mà chưa hoàn thành (QC-TH-01 Điều 4): hạn trước thứ Sáu của tuần báo cáo.
const isOverdue = (r, f) => !!r.due && r.status !== DONE && r.due < f;
const needsIssue = (r, f) => r.status === 'Chậm' || r.status === 'Vướng' || isOverdue(r, f);
const issueLabel = (r, f) => [r.status === 'Chậm' || r.status === 'Vướng' ? r.status : null, isOverdue(r, f) ? 'Quá hạn' : null].filter(Boolean).join(' · ');
// Tình trạng MTL → tình trạng BM-TH-01 (người lập chỉ sửa khi thực tế khác, vd. "Vướng").
function statusFromMtl(code, done) {
  if (done) return DONE;
  if (code === 'NOT_DUE') return 'Chưa bắt đầu';
  if (['LATE_START', 'BEHIND', 'OVERDUE'].includes(code)) return 'Chậm';
  return 'Đúng tiến độ';
}

// ---------- Điền sẵn ----------
// items: hạng mục MTL người lập xem được, mỗi hạng mục { id, code, projectKey, planCode, title, parentId, baselineStart, baselineEnd,
//   done, cancelled, completedAt, status, actual, assignees: [{ id }], leadDepartmentId, checklistNext, hasChecklist, critical, milestone }.
// memberIds: tài khoản thuộc bộ phận. prev: báo cáo tuần trước (data). actions: Action Log của buổi giao ban vừa rồi giao cho bộ phận.
let seq = 0;
const newKey = p => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
// Khoá dòng chỉ gồm chữ / số / _ / - (dùng trong khoá kết luận "<bộ phận>:<dòng>" — dấu ":" thừa làm kết luận không lưu được).
const KEY_RE = /^[\w-]{1,40}$/;
const safeKey = k => String(k ?? '').replace(/[^\w-]/g, '_').slice(0, 40);
const blankIssue = () => ({ cause: '', solution: '', helpFrom: '', helpWhat: '', helpBy: '' });

function deptCandidates(items, deptId, memberIds) {
  const mine = items.filter(i => !i.cancelled && (i.leadDepartmentId === deptId || (i.assignees || []).some(a => memberIds.has(a.id))));
  const ids = new Set(mine.map(i => i.id)), parentOf = new Map(items.map(i => [i.id, i.parentId]));
  // Bỏ hạng mục có hạng mục con (cháu…) cũng thuộc bộ phận — báo cáo ở mức chi tiết nhất, không đếm hai lần.
  const hasMineBelow = new Set();
  for (const i of mine) { let p = parentOf.get(i.id), guard = 0; while (p != null && guard++ < 20) { if (ids.has(p)) hasMineBelow.add(p); p = parentOf.get(p); } }
  return mine.filter(i => !hasMineBelow.has(i.id));
}

function mtlRow(i, extra = {}) {
  const status = statusFromMtl(i.status, i.done);
  const pct = i.done ? 100 : Math.round(i.actual || 0);
  return {
    key: `m${i.id}`, itemId: i.id, ref: i.code, step: i.planCode || '', project: i.projectKey || '', task: i.title, source: MTL_SOURCE,
    ownerIds: (i.assignees || []).map(a => a.id), start: dayOf(i.baselineStart), due: dayOf(i.baselineEnd), status, pct, pct0: pct,
    pctLocked: !!i.hasChecklist, critical: !!i.critical, milestone: !!i.milestone, ...blankIssue(), next: '', mandatory: true, ...extra,
  };
}

function buildPrefill({ week: f, deptId, items = [], memberIds = new Set(), prev = null, actions = [] }) {
  const S = scheduleOf(f);
  const cand = deptCandidates(items, deptId, memberIds);
  const byId = new Map(items.map(i => [i.id, i]));
  const results = [], ongoing = [], plans = [], seen = new Set();
  const add = (list, row) => { if (row.itemId) { if (seen.has(row.itemId)) return; seen.add(row.itemId); } list.push(row); };

  // 1) Kế hoạch tuần trước (bản ĐÃ NỘP) → Phần I; việc chưa xong tuần trước → Phần II (QT-TH-01, Phần C bước 2).
  if (prev) {
    for (const p of prev.plans || []) {
      if (p.itemId) { const i = byId.get(p.itemId); if (i && !(i.done && dayOf(i.completedAt) < S.from)) add(results, mtlRow(i)); continue; }
      if (!String(p.task || '').trim()) continue;
      results.push({ key: p.key || newKey('f'), itemId: null, task: p.task, source: SOURCES.includes(p.basis) ? p.basis : 'KH tháng', ownerIds: p.ownerIds || [], due: p.due || '',
        status: 'Đúng tiến độ', pct: '', ...blankIssue(), mandatory: true });
    }
    for (const r of [...(prev.results || []), ...(prev.ongoing || [])]) {
      if (r.status === DONE || !String(r.task || '').trim()) continue;
      if (r.itemId) { const i = byId.get(r.itemId); if (i && !i.done) add(ongoing, mtlRow(i)); continue; }
      if (ongoing.some(o => o.key === r.key) || results.some(o => o.key === r.key)) continue;
      ongoing.push({ key: r.key || newKey('f'), itemId: null, actionRef: r.actionRef || null, task: r.task, source: r.source === MTL_SOURCE ? 'Chuyển tiếp tuần trước' : r.source || 'Chuyển tiếp tuần trước',
        ownerIds: r.ownerIds || [], start: r.start || '', due: r.due || '', status: r.status || 'Đúng tiến độ', pct: r.pct ?? '', ...blankIssue(), next: '', mandatory: !!r.actionRef });
    }
  }
  // 2) Action Log giao ban (mọi việc TGĐ giao còn mở, kể cả tuần trước bộ phận chưa nộp) → Phần I, nguồn "TGĐ giao" — bắt buộc báo cáo.
  const hasAction = ref => [...results, ...ongoing].some(r => r.actionRef === ref);
  for (const a of actions) if (!hasAction(a.ref)) results.push({ key: safeKey(`a${a.ref}`), actionRef: a.ref, itemId: null, task: a.task, source: 'TGĐ giao', ownerIds: a.ownerId ? [a.ownerId] : [],
    due: a.due || '', status: 'Đúng tiến độ', pct: '', ...blankIssue(), mandatory: true });

  // 3) MTL của bộ phận: đến hạn / quá hạn / xong trong tuần → I; đang chạy nhiều tuần → II; bắt đầu tuần tới → III.
  for (const i of cand) {
    if (!i.baselineStart || !i.baselineEnd) continue;
    const s = dayOf(i.baselineStart), e = dayOf(i.baselineEnd), c = dayOf(i.completedAt);
    if (i.done) { if (c >= S.from && c <= S.to) add(results, mtlRow(i)); continue; }
    if (e <= S.to) add(results, mtlRow(i));
    else if (s <= S.to) add(ongoing, mtlRow(i, { next: i.checklistNext || '' }));
    else if (s <= S.nextTo) { if (!seen.has(i.id)) { seen.add(i.id); plans.push({ key: `m${i.id}`, itemId: i.id, ref: i.code, step: i.planCode || '', task: i.title, basis: MTL_SOURCE, ownerIds: (i.assignees || []).map(a => a.id), due: e, output: '' }); } }
  }
  // Nguyên nhân / giải pháp của tuần trước (bản đã nộp) cho cùng hạng mục còn chậm: điền sẵn để bộ phận xem lại, sửa nếu đã khác —
  // không phải gõ lại mỗi tuần. Đề nghị hỗ trợ không chép (mỗi tuần Ban GĐ kết luận riêng).
  if (prev) {
    const last = new Map();
    for (const r of [...(prev.results || []), ...(prev.ongoing || [])]) if (r && (r.cause || r.solution)) last.set(r.itemId ? `i${r.itemId}` : `k${r.key}`, r);
    for (const r of [...results, ...ongoing]) {
      const p = last.get(r.itemId ? `i${r.itemId}` : `k${r.key}`);
      if (!p || r.status === DONE || r.cause || r.solution) continue;
      r.cause = String(p.cause || ''); r.solution = String(p.solution || ''); r.carried = true;
    }
  }
  const rank = r => [r.status === DONE ? 2 : needsIssue(r, f) ? 0 : 1, r.due || '9999'];
  const order = (a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0); };
  return { results: results.sort(order), ongoing: ongoing.sort(order), plans: plans.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0)), other: '' };
}

// ---------- Làm sạch dữ liệu gửi lên ----------
const str = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const day = v => (isDay(v) ? v : '');
const pctOf = v => { if (v === '' || v == null) return ''; const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : ''; };
const idsOf = (v, allowed) => [...new Set([].concat(v || []).map(Number).filter(n => Number.isInteger(n) && n > 0 && (!allowed || allowed.has(n))))].slice(0, 5);
function cleanHelp(v, deptIds) { const s = String(v ?? ''); return s === HELP_BGD || s === HELP_SELF || (/^D\d+$/.test(s) && deptIds.has(Number(s.slice(1)))) ? s : ''; }

// ctx: { userIds: Set (tài khoản hợp lệ làm người phụ trách), deptIds: Set, itemIds: Set (hạng mục người lập xem được) }
function sanitize(data, { userIds = null, deptIds = new Set(), itemIds = null } = {}) {
  const d = data && typeof data === 'object' ? data : {};
  const base = r => {
    const itemId = Number.isInteger(r?.itemId) && (!itemIds || itemIds.has(r.itemId)) ? r.itemId : null;
    return {
      key: KEY_RE.test(str(r?.key, 40)) ? str(r?.key, 40) : newKey('f'), itemId, ref: itemId ? str(r.ref, 40) : '', step: itemId ? str(r.step, 20) : '', project: itemId ? str(r.project, 20) : '',
      actionRef: str(r?.actionRef, 40) || null, task: str(r?.task, 500), ownerIds: idsOf(r?.ownerIds, userIds), due: day(r?.due),
      mandatory: !!r?.mandatory, ownerPicked: !!r?.ownerPicked,
    };
  };
  const row = (r, ongoing) => {
    const o = { ...base(r), source: itemId(r) ? MTL_SOURCE : SOURCES.includes(r?.source) ? r.source : 'Phát sinh', status: STATUSES.includes(r?.status) ? r.status : 'Đúng tiến độ',
      pct: pctOf(r?.pct), pct0: pctOf(r?.pct0), pctLocked: !!r?.pctLocked, critical: !!r?.critical, milestone: !!r?.milestone,
      cause: str(r?.cause, 1000), solution: str(r?.solution, 1000), helpFrom: cleanHelp(r?.helpFrom, deptIds), helpWhat: str(r?.helpWhat, 1000), helpBy: day(r?.helpBy) };
    if (o.status === DONE) o.pct = 100;
    if (o.pct === 100 && o.status !== DONE) o.status = DONE;
    if (ongoing) { o.start = day(r?.start); o.next = str(r?.next, 1000); }
    return o;
  };
  const itemId = r => Number.isInteger(r?.itemId) && (!itemIds || itemIds.has(r.itemId));
  const lim = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  return {
    results: lim(d.results, 200).map(r => row(r, false)),
    ongoing: lim(d.ongoing, 200).map(r => row(r, true)),
    plans: lim(d.plans, 200).map(p => ({ ...base(p), basis: itemId(p) ? MTL_SOURCE : SOURCES.includes(p?.basis) ? p.basis : 'KH tháng', output: str(p?.output, 500) })),
    other: str(d.other, 3000),
  };
}

// ---------- Kiểm tra trước khi nộp (Điều 4, Phần C) ----------
function validate(data, f, { deptName = () => '', mandatory = [] } = {}) {
  const e = [];
  const res = data.results.filter(r => r.task), on = data.ongoing.filter(r => r.task), pl = data.plans.filter(p => p.task);
  if (!res.length && !on.length) e.push('Phần I hoặc II cần ít nhất 1 hạng mục.');
  if (!on.length && !pl.length) e.push('Phần II hoặc III cần ít nhất 1 việc cho tuần mới.');
  const check = (r, label) => {
    if (!r.due) e.push(`${label}: thiếu deadline.`);
    if (!r.ownerIds.length) e.push(`${label}: thiếu người phụ trách.`);
    if (needsIssue(r, f)) {
      const why = issueLabel(r, f);
      if (!r.cause) e.push(`${label} (${why}): thiếu nguyên nhân.`);
      if (!r.solution) e.push(`${label} (${why}): thiếu giải pháp bộ phận đề xuất.`);
      if (!r.helpFrom) e.push(`${label} (${why}): chọn đề nghị hỗ trợ từ Ban Giám đốc, bộ phận nào, hoặc "Tự xử lý".`);
      else if (r.helpFrom !== HELP_SELF) {
        const who = r.helpFrom === HELP_BGD ? 'Ban Giám đốc' : deptName(Number(r.helpFrom.slice(1))) || 'bộ phận được đề nghị';
        if (!r.helpWhat) e.push(`${label}: ghi rõ cần ${who} hỗ trợ việc gì.`);
        if (!r.helpBy) e.push(`${label}: ghi cần ${who} hỗ trợ trước ngày nào.`);
      }
    }
  };
  const short = t => `“${t.length > 50 ? t.slice(0, 50) + '…' : t}”`;
  data.results.forEach((r, k) => { if (!r.task) e.push(`Phần I, hạng mục ${k + 1}: thiếu tên hạng mục.`); else check(r, `Phần I ${short(r.task)}`); });
  data.ongoing.forEach((r, k) => {
    if (!r.task) { e.push(`Phần II, việc ${k + 1}: thiếu tên việc.`); return; }
    check(r, `Phần II ${short(r.task)}`);
    if (!r.next && r.status !== DONE) e.push(`Phần II ${short(r.task)}: ghi việc sẽ làm tuần tới.`);
  });
  data.plans.forEach((p, k) => {
    if (!p.task) { e.push(`Phần III, hạng mục ${k + 1}: thiếu tên hạng mục.`); return; }
    if (!p.ownerIds.length) e.push(`Phần III ${short(p.task)}: thiếu người phụ trách.`);
    if (!p.due) e.push(`Phần III ${short(p.task)}: thiếu deadline.`);
    if (!p.output) e.push(`Phần III ${short(p.task)}: ghi sản phẩm đầu ra.`);
  });
  // Hạng mục bắt buộc báo cáo (MTL đến hạn / quá hạn / đang chạy, việc TGĐ giao, kế hoạch tuần trước) không được bỏ (Điều 4).
  const has = (k, v) => [...data.results, ...data.ongoing].some(r => r[k] === v);
  for (const m of mandatory) if (!(m.itemId ? has('itemId', m.itemId) : m.actionRef ? has('actionRef', m.actionRef) : has('key', m.key)))
    e.push(`Không được bỏ ${short(m.task)}${m.ref ? ` (${m.ref})` : ''} — đây là hạng mục bắt buộc báo cáo; cập nhật tình trạng thay vì bỏ.`);
  return e;
}
// Xoá nội dung vướng mắc ở hạng mục không còn Chậm / Vướng / Quá hạn (giữ báo cáo gọn).
function finalize(data, f) {
  const fix = r => (needsIssue(r, f) ? { ...r, overdue: isOverdue(r, f) } : { ...r, ...blankIssue(), overdue: false });
  return { ...data, results: data.results.filter(r => r.task).map(fix), ongoing: data.ongoing.filter(r => r.task).map(fix), plans: data.plans.filter(p => p.task) };
}
// % đề xuất ghi ngược vào MTL: hạng mục liên kết, không tự tính theo checklist, % khác lúc điền sẵn (pct0).
// Máy chủ chỉ ghi khi % trong MTL vẫn bằng pct0 (chưa ai đổi từ lúc điền sẵn) — tránh đè số mới bằng số cũ khi gửi lại.
const writeBacks = data => [...data.results, ...data.ongoing]
  .filter(r => r.itemId && !r.pctLocked && r.pct !== '' && r.pct !== r.pct0)
  .map(r => ({ itemId: r.itemId, pct: r.pct }));

// ---------- Tình trạng nộp (Điều 6) ----------
const noticeTime = n => new Date(n.receivedAt || n.createdAt); // thư ký nhập hộ tin nhắn: tính theo giờ nhận
function submissionStatus(report, notices, S, now = new Date()) {
  if (S.skip) return { code: 'SKIPPED', label: 'Tuần nghỉ — không giao ban', tone: 'idle' };
  const told = notices.some(n => n.type === 'LATE' && noticeTime(n) <= S.deadline);
  const t = report?.firstSubmittedAt ? new Date(report.firstSubmittedAt) : null;
  if (!t) {
    if (now <= S.deadline) return { code: 'PENDING', label: 'Chưa nộp', tone: 'idle' };
    if (now <= S.grace) return told ? { code: 'LATE_TOLD_PENDING', label: 'Đã báo muộn, chưa nộp', tone: 'warn' } : { code: 'LATE_PENDING', label: 'Quá hạn, chưa báo', tone: 'bad' };
    return { code: 'MISSING', label: 'Không nộp', tone: 'bad', points: 'NOT_SUBMITTED' };
  }
  if (t <= S.deadline) return { code: 'ON_TIME', label: 'Đúng hạn', tone: 'good' };
  if (t <= S.grace) return told ? { code: 'LATE_TOLD', label: 'Muộn, có báo trước', tone: 'warn', points: 'LATE_NOTICED' } : { code: 'LATE', label: 'Muộn, không báo', tone: 'bad', points: 'LATE_UNNOTICED' };
  return { code: 'TOO_LATE', label: 'Nộp sau 12:00 T7 (tính không nộp)', tone: 'bad', points: 'NOT_SUBMITTED' };
}
// Vắng có báo đúng hạn và có người dự thay → không trừ (Điều 7): báo trước 17:30 ngày hạn nộp;
// lý do "Việc đột xuất" thì đến 08:00 ngày giao ban.
const absenceNoticed = (notices, S) => notices.find(n => n.type === 'ABSENT' && n.substituteId
  && (noticeTime(n) <= S.deadline || (n.reason === 'DOT_XUAT' && noticeTime(n) <= S.absentEmergency))) || null;
const SUBMITTED = ['ON_TIME', 'LATE_TOLD', 'LATE']; // nộp sau 12:00 thứ Bảy tính là không nộp

// ---------- Tổng hợp giao ban ----------
const helpTarget = (h, deptName) => (h === HELP_BGD ? 'Ban Giám đốc' : h?.startsWith('D') ? deptName(Number(h.slice(1))) || 'Bộ phận khác' : '');
// depts: [{ id, name }] theo thứ tự trình bày; reports / notices của tuần; meeting của tuần (điểm danh, kết luận); prevMeeting: Action Log tuần trước.
// actions: Action Log còn theo dõi [{ ...action, ref, meetingWeek }]; actionRows: Map ref → dòng báo cáo mới nhất (đã nộp) có actionRef đó.
function buildSummary({ week: f, depts, reports, notices, meeting = null, actions = [], actionRows = new Map(), now = new Date(), userName = () => '' }) {
  const S = scheduleOf(f, meeting), deptName = id => depts.find(d => d.id === id)?.name || '';
  const md = meeting?.data || {};
  let submitted = 0, stuck = 0, overdue = 0;
  const helps = [], rows = [];
  for (const d of depts) {
    const rep = reports.find(r => r.departmentId === d.id) || null;
    const sent = rep && rep.firstSubmittedAt ? rep : null;
    const ns = notices.filter(n => n.departmentId === d.id);
    const st = submissionStatus(sent, ns, S, now);
    const absent = ns.find(n => n.type === 'ABSENT') || null;
    const items = sent ? [...(sent.data.results || []), ...(sent.data.ongoing || [])] : [];
    if (SUBMITTED.includes(st.code)) submitted++;
    const nStuck = items.filter(x => x.status === 'Chậm' || x.status === 'Vướng').length, nOver = items.filter(x => isOverdue(x, f)).length;
    stuck += nStuck; overdue += nOver;
    for (const x of items) if (needsIssue(x, f) && x.helpFrom && x.helpFrom !== HELP_SELF)
      helps.push({ key: `${d.id}:${safeKey(x.key)}`, fromId: d.id, from: d.name, to: helpTarget(x.helpFrom, deptName), toKey: x.helpFrom, task: x.task, ref: x.ref || '', what: x.helpWhat, by: x.helpBy, status: issueLabel(x, f), cause: x.cause, solution: x.solution, conclusion: md.conclusions?.[`${d.id}:${safeKey(x.key)}`] || null });
    rows.push({ id: d.id, name: d.name, status: st, submittedAt: sent?.firstSubmittedAt || null, lastSubmittedAt: sent?.submittedAt || null, resubmits: sent ? Math.max(0, (sent.submitCount || 1) - 1) : 0,
      submittedBy: sent ? userName(sent.submittedById) : '', items: sent ? items.length : null, stuck: sent ? nStuck : null, overdue: sent ? nOver : null,
      absent: absent ? { reason: REASONS[absent.reason] || '', note: absent.note, substitute: userName(absent.substituteId), noticed: !!absenceNoticed([absent], S) } : null,
      late: ns.filter(n => n.type === 'LATE').map(n => ({ reason: REASONS[n.reason] || '', note: n.note, expectedAt: n.expectedAt, createdAt: n.createdAt })),
      attendance: md.attendance?.[d.id] || null, failed: !!md.failed?.[d.id], report: sent ? sent.data : null, draft: !sent && !!rep });
  }
  // Rà Action Log (08:30–08:35): mọi việc TGĐ giao còn mở + việc của buổi liền trước; trạng thái lấy từ báo cáo đã nộp mới nhất.
  const actionReview = actions.map(a => {
    const row = actionRows.get(a.ref) || null;
    return { ...a, department: deptName(a.departmentId), owner: userName(a.ownerId), status: row ? row.status : null, pct: row ? row.pct : null,
      overdue: row ? isOverdue(row, f) : !!(a.due && a.due < f) };
  });
  const groups = [];
  for (const h of helps) { let g = groups.find(x => x.toKey === h.toKey); if (!g) groups.push(g = { toKey: h.toKey, to: h.to, list: [] }); g.list.push(h); }
  groups.sort((a, b) => (a.toKey === HELP_BGD ? -1 : b.toKey === HELP_BGD ? 1 : depts.findIndex(d => `D${d.id}` === a.toKey) - depts.findIndex(d => `D${d.id}` === b.toKey)));
  return { week: f, schedule: S, kpis: { submitted, total: depts.length, overdue, stuck, helps: helps.length }, rows, helps: groups, actionReview, meeting: md, publishedAt: meeting?.publishedAt || null };
}
// Bản tóm tắt cho trưởng / phó bộ phận (QC-TH-01 Điều 5): như văn bản sao chép — không họ tên, không ghi chú vắng / muộn,
// không chi tiết báo cáo bộ phận khác (giữ bộ phận mình). Ma trận: lib/policy.js weekly.summary vs weekly.summary.detail.
function briefSummary(sum, ownDeptId) {
  return { ...sum, brief: true,
    rows: sum.rows.map(r => ({ ...r, submittedBy: '', report: r.id === ownDeptId ? r.report : null,
      absent: r.absent ? { noticed: r.absent.noticed, hasSubstitute: !!r.absent.substitute } : null, late: r.late.map(() => ({})), draft: r.id === ownDeptId ? r.draft : false, attendance: null, failed: false })),
    // Yêu cầu hỗ trợ: bỏ nguyên nhân / giải pháp của bộ phận khác (văn bản sao chép cũng không có); Action Log: bỏ người phụ trách.
    helps: sum.helps.map(g => ({ ...g, list: g.list.map(({ cause, solution, ...h }) => (h.fromId === ownDeptId ? { ...h, cause, solution } : h)) })),
    actionReview: sum.actionReview.map(({ owner, ownerId, ...a }) => ({ ...a, owner: '' })),
    meeting: { conclusions: sum.meeting?.conclusions || {} } };
}

// JSON chuẩn hoá (khoá sắp xếp đệ quy): băm SHA-256 của bản nộp kiểm lại được từ bản đọc ra CSDL (JSONB sắp lại thứ tự khoá).
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

// Văn bản "Sao chép bản tổng hợp" — không có họ tên người phụ trách (tối thiểu hoá DLCN), dòng đầu ghi nhãn Bảo mật.
function summaryText(sum) {
  const S = sum.schedule, f = sum.week;
  const L = ['BẢO MẬT – chỉ dùng nội bộ', `TỔNG HỢP BÁO CÁO TUẦN ${fmtD(S.from)}–${fmtDY(f)} · Giao ban 08:30 ${WD[weekday(S.meetingDay)]} ${fmtDY(S.meetingDay)}`, '',
    `Đã nộp ${sum.kpis.submitted}/${sum.kpis.total} bộ phận · ${sum.kpis.stuck} chậm/vướng · ${sum.kpis.overdue} quá hạn · ${sum.kpis.helps} yêu cầu hỗ trợ`, '', 'TÌNH TRẠNG NỘP'];
  for (const r of sum.rows) L.push(`- ${r.name}: ${r.status.label}${r.submittedAt ? ` (${fmtTime(r.submittedAt)})` : ''}${r.absent ? ` · VẮNG${r.absent.substitute || r.absent.hasSubstitute ? ', có người dự thay' : ''}` : ''}`);
  if (sum.actionReview.length) {
    L.push('', 'ACTION LOG ĐANG THEO DÕI');
    for (const a of sum.actionReview) L.push(`- [${a.department}] ${a.task} — ${a.status || 'chưa báo cáo'}${a.overdue && a.status !== DONE ? ', quá hạn' : ''}`);
  }
  L.push('', 'HẠNG MỤC QUÁ HẠN / CHẬM / VƯỚNG');
  let any = false;
  for (const r of sum.rows) if (r.report) for (const x of [...r.report.results, ...r.report.ongoing]) if (needsIssue(x, f)) { any = true; L.push(`- [${r.name}] ${x.task} — ${issueLabel(x, f)}${isOverdue(x, f) ? ' ' + fmtD(x.due) : ''} — Giải pháp: ${x.solution}`); }
  if (!any) L.push('- Không có');
  L.push('', 'YÊU CẦU HỖ TRỢ (xử lý 09:15 – 09:25)');
  if (!sum.helps.length) L.push('- Không có');
  for (const g of sum.helps) for (const h of g.list) L.push(`- ${h.from} → ${g.to}: ${h.what} (việc “${h.task}”)${h.by ? `, cần trước ${fmtD(h.by)}` : ''}${h.conclusion ? ` — Kết luận: ${DECISIONS[h.conclusion.decision] || ''}${h.conclusion.note ? ': ' + h.conclusion.note : ''}` : ''}`);
  return L.join('\n');
}

// ---------- Chấm điểm tuân thủ tháng (Phụ lục 1) ----------
// weeks: các thứ Sáu thuộc tháng (đã chạy qua mốc 12:00 thứ Bảy mới tính "không nộp"). byWeek: { [f]: { reports, notices, meeting } }.
function compliance({ weeks, depts, byWeek, points = POINTS, now = new Date() }) {
  const P = { ...POINTS, ...(points || {}) };
  return depts.map(d => {
    const events = [];
    for (const f of weeks) {
      const w = byWeek[f] || { reports: [], notices: [], meeting: null };
      const S = scheduleOf(f, w.meeting), ns = w.notices.filter(n => n.departmentId === d.id);
      if (S.skip) continue; // tuần nghỉ (Tết, lễ): không giao ban, không chấm
      const req = w.meeting?.data?.required; // danh sách phải nộp chụp lại tại hạn nộp của tuần đó
      if (Array.isArray(req) && !req.includes(d.id)) continue;
      const rep = w.reports.find(r => r.departmentId === d.id && r.firstSubmittedAt) || null;
      const st = submissionStatus(rep, ns, S, now);
      if (st.points) events.push({ week: f, code: st.points, label: POINT_LABEL[st.points], points: P[st.points] });
      const md = w.meeting?.data || {};
      if (md.failed?.[d.id]) events.push({ week: f, code: 'NOT_PASSING', label: POINT_LABEL.NOT_PASSING, points: P.NOT_PASSING });
      const att = md.attendance?.[d.id];
      const noticed = absenceNoticed(ns, S);
      if (att === 'ABSENT') events.push(noticed ? { week: f, code: 'ABSENT_NOTICED', label: POINT_LABEL.ABSENT_NOTICED, points: P.ABSENT_NOTICED } : { week: f, code: 'ABSENT_UNNOTICED', label: POINT_LABEL.ABSENT_UNNOTICED, points: P.ABSENT_UNNOTICED });
      // "Đi muộn" chỉ ghi khi muộn quá 10 phút mà không báo trước (thư ký chọn khi điểm danh) — không phụ thuộc báo vắng.
      if (att === 'LATE') events.push({ week: f, code: 'LATE_ARRIVAL', label: POINT_LABEL.LATE_ARRIVAL, points: P.LATE_ARRIVAL });
    }
    const lost = events.reduce((n, e) => n + e.points, 0);
    return { id: d.id, name: d.name, score: Math.max(0, 100 - lost), lost, violations: events.filter(e => e.points > 0).length, events };
  });
}
// Các thứ Sáu của tháng ym ('YYYY-MM'), không quá thứ Sáu tuần hiện tại.
function fridaysOf(ym, now = new Date(), startWeek = null) {
  const [y, m] = ym.split('-').map(Number), out = [];
  for (let d = 1; d <= 31; d++) {
    const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!isDay(s) || Number(s.slice(5, 7)) !== m) continue;
    if (weekday(s) === 5 && s <= currentFriday(now) && (!startWeek || s >= startWeek)) out.push(s);
  }
  return out;
}

module.exports = {
  SOURCES, MTL_SOURCE, STATUSES, DONE, HELP_BGD, HELP_SELF, REASONS, NOTICE_TYPES, ATTENDANCE, DECISIONS, POINTS, POINT_LABEL,
  isDay, addDays, dayOf, at, weekday, currentFriday, isFriday, fmtD, fmtTime, scheduleOf,
  isOverdue, needsIssue, issueLabel, statusFromMtl, deptCandidates, buildPrefill, sanitize, validate, finalize, writeBacks,
  submissionStatus, absenceNoticed, SUBMITTED, buildSummary, briefSummary, summaryText, compliance, fridaysOf, stableStringify,
};
