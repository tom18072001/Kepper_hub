// Kepper GĐ2b — Báo cáo tuần bộ phận theo Quy chế QC-TH-01 / Quy trình QT-TH-01 / Biểu mẫu BM-TH-01.
// Hàm thuần (không đụng CSDL): tuần theo giờ VN, điền sẵn báo cáo từ MTL + báo cáo tuần trước + Action Log giao ban,
// làm sạch / kiểm tra dữ liệu nộp, tình trạng nộp (đúng hạn / muộn / không nộp), bản tổng hợp giao ban và chấm điểm tuân thủ.
const DAY = 86_400_000, H7 = 7 * 3_600_000;

// ---------- Danh mục theo BM-TH-01 ----------
const SOURCES = ['KH tháng', 'KH quý', 'KH năm', 'Phát sinh', 'TGĐ giao', 'Chuyển tiếp tuần trước'];
const MTL_SOURCE = 'MTL'; // hạng mục tự điền từ Master Timeline
const TASK_SOURCE = 'Công việc'; // việc thường (bảng công việc, không phải MTL) tự điền theo bộ phận
// Mã nguy cơ chậm tiến độ — định nghĩa và nhãn ở services/alerts.js (riskOf), dùng chung cảnh báo MTL hằng ngày.
const RISK_CODES = ['OVERDUE', 'LATE_START', 'BEHIND', 'DUE_SOON', 'PLAN_NOT_STARTED'];
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
// Ngày có thật (2026-02-30 → false: Date.parse tự chuyển sang 02/03).
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
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
// Điểm danh và phát hành kết luận + Action Log chỉ mở từ giờ giao ban: bấm nhầm từ thứ Năm, thứ Sáu không ghi được.
const meetingStarted = (S, now = new Date()) => now.getTime() >= new Date(S.meetingAt).getTime();

// ---------- Tình trạng hạng mục ----------
// Quá hạn = đã QUA deadline mà chưa hoàn thành (QC-TH-01 Điều 4): hạn trước thứ Sáu của tuần báo cáo.
const isOverdue = (r, f) => !!r.due && r.status !== DONE && r.due < f;
const needsIssue = (r, f) => r.status === 'Chậm' || r.status === 'Vướng' || isOverdue(r, f);
const issueLabel = (r, f) => [r.status === 'Chậm' || r.status === 'Vướng' ? r.status : null, isOverdue(r, f) ? 'Quá hạn' : null].filter(Boolean).join(' · ');
// Nguy cơ chậm tiến độ của một dòng báo cáo chưa xong (Phần III): theo cảnh báo MTL / hạn việc (máy chủ tính khi điền sẵn và khi nộp),
// hoặc bộ phận tự đánh dấu Chậm / Vướng, hoặc đã qua deadline. Trả về nhãn ('' = không có nguy cơ).
function rowRisk(r, f) {
  if (!r || r.status === DONE) return '';
  const out = [];
  if (r.risk) out.push(r.riskNote || r.risk);
  if (r.status === 'Vướng') out.push('Vướng');
  else if (r.status === 'Chậm' && !r.risk) out.push('Chậm');
  if (isOverdue(r, f) && !r.risk) out.push('Quá hạn');
  // Dòng tự do bắt buộc báo cáo (kế hoạch tuần trước, việc TGĐ giao) mà chưa làm: nguy cơ "đăng ký mà chưa làm" (Phần III).
  if (!out.length && !r.itemId && (r.mandatory || r.planned) && !rowStarted(r)) out.push(r.source === 'TGĐ giao' ? FREE_NOT_STARTED.tgd : PLAN_NOT_STARTED.label);
  return out.join(' · ');
}
const FREE_NOT_STARTED = { tgd: 'TGĐ giao, chưa khởi động' };
const allRows = data => [...(data?.results || []), ...(data?.ongoing || []), ...(data?.risks || [])].filter(r => r && r.task);
// Dòng đã bắt đầu: xong, hoặc ghi % > 0, hoặc (máy chủ không ghi started = false cho dòng gắn việc) và tình trạng khác "Chưa bắt đầu".
// Dòng tự do ghi "Chưa bắt đầu", 0% → chưa làm (không vào "đang thực hiện").
const rowStarted = r => r.status === DONE || Number(r.pct) > 0 || (r.started !== false && r.status !== 'Chưa bắt đầu');
// Mọi dòng có nguy cơ chậm (ở bất kỳ phần nào) — cho lãnh đạo / giao ban.
const riskRows = (data, f) => allRows(data).filter(r => rowRisk(r, f));
// Ba phần chủ dự án cần nắm, tính theo TÌNH TRẠNG từng dòng (không theo mảng lưu): xong trong tuần · mọi việc đã bắt đầu
// chưa xong (kể cả dòng tự do ở Phần I, dòng Phần III đã ghi %) · nguy cơ chậm. Dùng cho KPI, văn bản giao ban, chi tiết bộ phận.
function partsOf(data, f) {
  const rows = allRows(data);
  return { done: rows.filter(r => r.status === DONE), ongoing: rows.filter(r => r.status !== DONE && rowStarted(r)), risk: rows.filter(r => rowRisk(r, f)) };
}
const riskNoteOf = k => (!k ? '' : k.code === 'OVERDUE' && k.days ? `${k.label} ${k.days} ngày`
  : k.code === 'DUE_SOON' && k.days === 0 ? 'Đến hạn hôm nay' : k.code === 'DUE_SOON' && k.days != null ? `${k.label} (còn ${k.days} ngày)` : k.label);
// Đã đăng ký ở kế hoạch tuần trước mà tuần này chưa khởi động: người đọc cần thấy (Phần III), không lẫn vào kế hoạch tuần mới.
const PLAN_NOT_STARTED = { code: 'PLAN_NOT_STARTED', label: 'Đã đăng ký tuần trước, chưa khởi động', days: null };
// Tình trạng MTL → tình trạng BM-TH-01 (người lập chỉ sửa khi thực tế khác, vd. "Vướng").
function statusFromMtl(code, done) {
  if (done) return DONE;
  if (code === 'NOT_DUE') return 'Chưa bắt đầu';
  if (['LATE_START', 'BEHIND', 'OVERDUE'].includes(code)) return 'Chậm';
  return 'Đúng tiến độ';
}
// Tình trạng BM-TH-01 của việc thường (không có kế hoạch gốc): xong / quá hạn → Chậm / đang làm / chưa bắt đầu.
const taskStatus = i => (i.done ? DONE : i.risk?.code === 'OVERDUE' ? 'Chậm' : i.started ? 'Đúng tiến độ' : 'Chưa bắt đầu');

// ---------- Điền sẵn ----------
// items: hạng mục MTL + việc thường (kind 'TASK') người lập xem được, mỗi hạng mục { id, kind, code, projectKey, planCode, title, parentId,
//   baselineStart, baselineEnd (MTL) | startDate, dueDate (việc thường), done, cancelled, completedAt, status (mã MTL), actual, assignees: [{ id }],
//   leadDepartmentId, pctAuto (có việc nhánh: % tự tính), critical, milestone, started (alerts.isStarted), risk (alerts.riskOf) }.
// memberIds: tài khoản thuộc bộ phận. prev: báo cáo tuần trước (data). actions: Action Log của buổi giao ban vừa rồi giao cho bộ phận.
let seq = 0;
const newKey = p => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
// Khoá dòng chỉ gồm chữ / số / _ / - (dùng trong khoá kết luận "<bộ phận>:<dòng>" — dấu ":" thừa làm kết luận không lưu được).
const KEY_RE = /^[\w-]{1,40}$/;
const safeKey = k => String(k ?? '').replace(/[^\w-]/g, '_').slice(0, 40);
const blankIssue = () => ({ cause: '', solution: '', helpFrom: '', helpWhat: '', helpBy: '' });

// placeOfChild (tuỳ chọn): phần của một hạng mục con trong báo cáo. Có thì việc cha chỉ bị bỏ khi phần việc của nó đã được báo qua
// việc con: có con đang làm / có nguy cơ, hoặc cha đã xong và con xong cùng tuần. Việc cha đang làm mà con chưa tới kỳ → vẫn báo việc cha.
function deptCandidates(items, deptId, memberIds, placeOfChild = null) {
  const mine = items.filter(i => !i.cancelled && (i.leadDepartmentId === deptId || (i.assignees || []).some(a => memberIds.has(a.id))));
  const ids = new Set(mine.map(i => i.id)), parentOf = new Map(items.map(i => [i.id, i.parentId])), byId = new Map(items.map(i => [i.id, i]));
  // Bỏ hạng mục có hạng mục con (cháu…) cũng thuộc bộ phận — báo cáo ở mức chi tiết nhất, không đếm hai lần.
  const below = new Map(); // id cha → các phần của con cháu thuộc bộ phận
  for (const i of mine) {
    const where = placeOfChild ? placeOfChild(i) : 'any';
    let p = parentOf.get(i.id), guard = 0;
    while (p != null && guard++ < 20) { if (ids.has(p)) { if (!below.has(p)) below.set(p, new Set()); below.get(p).add(where); } p = parentOf.get(p); }
  }
  const covered = id => {
    const w = below.get(id); if (!w) return false;
    if (!placeOfChild || w.has('any') || w.has('ongoing')) return true;
    const parent = byId.get(id);
    // Con chưa bắt đầu mà có nguy cơ chỉ "báo thay" cho cha chưa bắt đầu; cha đang làm vẫn báo ở Phần II.
    if (w.has('risks') && !parent?.started && !parent?.done) return true;
    return !!parent?.done && w.has('results');
  };
  return mine.filter(i => !covered(i.id));
}

// Ngày bắt đầu / hạn: kế hoạch gốc MTL, không có thì ngày bắt đầu / hạn của việc.
const startOf = i => dayOf(i.baselineStart || i.startDate), dueOf = i => dayOf(i.baselineEnd || i.dueDate);
function mtlRow(i, extra = {}) {
  const task = i.kind === 'TASK';
  let status = task ? taskStatus(i) : statusFromMtl(i.status, i.done);
  if (status === 'Chưa bắt đầu' && i.started) status = 'Đúng tiến độ'; // MTL làm sớm hơn ngày bắt đầu kế hoạch
  const pct = i.done ? 100 : Math.round(i.actual ?? i.progress ?? 0);
  return {
    key: `m${i.id}`, itemId: i.id, ref: i.code, step: i.planCode || '', project: i.projectKey || '', task: i.title, source: task ? TASK_SOURCE : MTL_SOURCE,
    ownerIds: (i.assignees || []).map(a => a.id), start: startOf(i), due: dueOf(i), status, pct, pct0: pct, started: !!(i.done || i.started),
    // Việc thường: % do người chủ trì cập nhật trên việc (báo cáo tuần không ghi ngược).
    pctLocked: task || !!i.pctAuto, critical: !!i.critical, milestone: !!i.milestone, risk: i.done ? null : i.risk?.code || null, riskNote: i.done ? '' : riskNoteOf(i.risk),
    ...blankIssue(), next: '', mandatory: true, ...extra,
  };
}
// Phần của một hạng mục / việc trong báo cáo tuần (yêu cầu chủ dự án 11/2026):
//   xong trong tuần → I · đã bắt đầu, chưa xong → II (MỌI việc đang làm, không xét hạn) · chưa bắt đầu mà đã có nguy cơ chậm
//   (chậm khởi động, trễ hạn, sắp hạn) → III · chưa bắt đầu, bắt đầu / đến hạn tới hết tuần sau → IV (kế hoạch) · còn lại: không báo cáo.
// i.started / i.risk tính sẵn bằng alerts.isStarted / alerts.riskOf (một định nghĩa).
// "Xong trong tuần" tính từ thứ Hai TUẦN TRƯỚC đến hết Chủ nhật tuần này (việc xong sau giờ nộp tuần trước, kể cả khi nộp sớm, không bị sót);
// việc báo cáo tuần trước ĐÃ ghi "Hoàn thành" (prevDone) thì không báo lại.
function placeOf(i, S, prevDone = null) {
  if (i.cancelled) return null;
  if (i.done) { const c = dayOf(i.completedAt); return c && c >= addDays(S.from, -7) && c <= addDays(S.to, 2) && !prevDone?.has(i.id) ? 'results' : null; }
  if (i.started) return 'ongoing';
  if (i.risk) return 'risks';
  const s = startOf(i), e = dueOf(i);
  return (s ? s <= S.nextTo : e && e <= S.nextTo) ? 'plans' : null;
}
// Mốc nạp việc đã xong cho điền sẵn / phạm vi bộ phận: 00:00 thứ Hai TUẦN TRƯỚC — cùng cửa sổ với placeOf (routes/weekly.js).
const doneSince = f => at(addDays(scheduleOf(f).from, -7), 0, 0);
const planRow = i => ({ key: `m${i.id}`, itemId: i.id, ref: i.code, step: i.planCode || '', task: i.title, basis: i.kind === 'TASK' ? TASK_SOURCE : MTL_SOURCE,
  ownerIds: (i.assignees || []).map(a => a.id), due: dueOf(i), output: '' });

function buildPrefill({ week: f, deptId, items = [], memberIds = new Set(), prev = null, actions = [] }) {
  const S = scheduleOf(f);
  const prevDone = new Set(allRows(prev).filter(r => r.itemId && r.status === DONE).map(r => r.itemId));
  const cand = deptCandidates(items, deptId, memberIds, i => placeOf(i, S, prevDone));
  const byId = new Map(items.map(i => [i.id, i]));
  const results = [], ongoing = [], risks = [], plans = [], seen = new Set();
  const lists = { results, ongoing, risks };
  const add = (list, row) => { if (row.itemId) { if (seen.has(row.itemId)) return; seen.add(row.itemId); } list.push(row); };
  // Đặt hạng mục vào đúng phần theo tình trạng hiện tại (placeOf). planned: đã đăng ký ở kế hoạch tuần trước —
  // chưa khởi động (dù chưa có nguy cơ theo hạn) vẫn báo ở Phần III để người đọc thấy "đăng ký mà chưa làm".
  const put = (i, planned = false) => {
    let where = placeOf(i, S, prevDone);
    const reg = planned && !i.done && !i.cancelled && !i.started; // đã đăng ký mà chưa khởi động: cờ "planned" giữ qua các tuần
    if (reg && where !== 'risks') where = 'planned';
    if (where === 'planned') add(risks, mtlRow({ ...i, risk: i.risk || PLAN_NOT_STARTED }, { planned: true }));
    else if (reg && where === 'risks') add(risks, mtlRow(i, { planned: true }));
    else if (where === 'plans') { if (!seen.has(i.id)) { seen.add(i.id); plans.push(planRow(i)); } } else if (where) add(lists[where], mtlRow(i));
  };

  // 1) Kế hoạch tuần trước (bản ĐÃ NỘP): dòng tự do → Phần I; việc chưa xong tuần trước → Phần II (QT-TH-01, Phần C bước 2).
  //    Dòng gắn hạng mục / việc: đặt theo tình trạng hiện tại (xong → I, đang làm → II, nguy cơ chậm / đăng ký mà chưa làm → III).
  if (prev) {
    for (const p of prev.plans || []) {
      if (p.itemId) { const i = byId.get(p.itemId); if (i) put(i, true); continue; }
      if (!String(p.task || '').trim()) continue;
      results.push({ key: p.key || newKey('f'), itemId: null, task: p.task, source: SOURCES.includes(p.basis) ? p.basis : 'KH tháng', ownerIds: p.ownerIds || [], due: p.due || '',
        status: 'Đúng tiến độ', pct: '', ...blankIssue(), mandatory: true });
    }
    for (const r of [...(prev.results || []), ...(prev.ongoing || []), ...(prev.risks || [])]) {
      if (r.status === DONE || !String(r.task || '').trim()) continue;
      // xong trong tuần → I, xong trước đó → bỏ; "đã đăng ký mà chưa làm" giữ cờ tới khi việc được bắt đầu hoặc bị huỷ.
      if (r.itemId) { const i = byId.get(r.itemId); if (i) put(i, !!r.planned || r.risk === PLAN_NOT_STARTED.code); continue; }
      if ([...ongoing, ...results, ...risks].some(o => o.key === r.key)) continue;
      const carry = !r.actionRef && (r.mandatory || r.planned) && !rowStarted(r) ? risks : ongoing; // đăng ký mà chưa làm → Phần III
      carry.push({ key: r.key || newKey('f'), itemId: null, actionRef: r.actionRef || null, task: r.task, source: r.source === MTL_SOURCE ? 'Chuyển tiếp tuần trước' : r.source || 'Chuyển tiếp tuần trước',
        ownerIds: r.ownerIds || [], start: r.start || '', due: r.due || '', status: r.status || 'Đúng tiến độ', pct: r.pct ?? '', ...blankIssue(), next: '', mandatory: !!r.actionRef,
        // Đã đăng ký (bắt buộc) mà vẫn chưa làm: giữ nguy cơ "đăng ký mà chưa làm" các tuần sau; người lập vẫn bỏ được khi việc bị huỷ.
        ...(!r.actionRef && (r.mandatory || r.planned) && !rowStarted(r) ? { planned: true } : {}) });
    }
  }
  // 2) Action Log giao ban (mọi việc TGĐ giao còn mở, kể cả tuần trước bộ phận chưa nộp) → Phần I, nguồn "TGĐ giao" — bắt buộc báo cáo.
  const hasAction = ref => [...results, ...ongoing, ...risks].some(r => r.actionRef === ref);
  for (const a of actions) if (!hasAction(a.ref)) results.push({ key: safeKey(`a${a.ref}`), actionRef: a.ref, itemId: null, task: a.task, source: 'TGĐ giao', ownerIds: a.ownerId ? [a.ownerId] : [],
    due: a.due || '', status: 'Đúng tiến độ', pct: '', ...blankIssue(), mandatory: true });

  // 3) Hạng mục MTL + việc thường của bộ phận theo tình trạng hiện tại (placeOf): xong trong tuần → I; đang làm → II;
  //    chưa khởi động mà có nguy cơ chậm → III; sắp bắt đầu → IV; chưa bắt đầu (chưa tới kỳ) → không báo cáo.
  for (const i of cand) put(i);
  // Nguyên nhân / giải pháp của tuần trước (bản đã nộp) cho cùng hạng mục còn chậm: điền sẵn để bộ phận xem lại, sửa nếu đã khác —
  // không phải gõ lại mỗi tuần. Đề nghị hỗ trợ không chép (mỗi tuần Ban GĐ kết luận riêng).
  if (prev) {
    const last = new Map();
    for (const r of [...(prev.results || []), ...(prev.ongoing || []), ...(prev.risks || [])]) if (r && (r.cause || r.solution)) last.set(r.itemId ? `i${r.itemId}` : `k${r.key}`, r);
    for (const r of [...results, ...ongoing, ...risks]) {
      const p = last.get(r.itemId ? `i${r.itemId}` : `k${r.key}`);
      if (!p || r.status === DONE || r.cause || r.solution || !(needsIssue(r, f) || rowRisk(r, f))) continue;
      r.cause = String(p.cause || ''); r.solution = String(p.solution || ''); r.carried = true;
    }
  }
  const rank = r => [r.status === DONE ? 2 : needsIssue(r, f) || rowRisk(r, f) ? 0 : 1, r.due || '9999'];
  const order = (a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0); };
  return { results: results.sort(order), ongoing: ongoing.sort(order), risks: risks.sort(order), plans: plans.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0)), other: '' };
}

// ---------- Làm sạch dữ liệu gửi lên ----------
const str = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const day = v => (isDay(v) ? v : '');
const pctOf = v => { if (v === '' || v == null) return ''; const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : ''; };
const idsOf = (v, allowed) => [...new Set([].concat(v || []).map(Number).filter(n => Number.isInteger(n) && n > 0 && (!allowed || allowed.has(n))))].slice(0, 5);
function cleanHelp(v, deptIds) { const s = String(v ?? ''); return s === HELP_BGD || s === HELP_SELF || (/^D\d+$/.test(s) && deptIds.has(Number(s.slice(1)))) ? s : ''; }

// ctx: { userIds: Set (tài khoản hợp lệ làm người phụ trách), deptIds: Set, itemIds: Set (hạng mục / việc người lập xem được),
//   taskIds: Set (phần của itemIds là việc thường, không phải MTL) }
function sanitize(data, { userIds = null, deptIds = new Set(), itemIds = null, taskIds = null } = {}) {
  const d = data && typeof data === 'object' ? data : {};
  const base = r => {
    const itemId = Number.isInteger(r?.itemId) && (!itemIds || itemIds.has(r.itemId)) ? r.itemId : null;
    return {
      key: KEY_RE.test(str(r?.key, 40)) ? str(r?.key, 40) : newKey('f'), itemId, ref: itemId ? str(r.ref, 40) : '', step: itemId ? str(r.step, 20) : '', project: itemId ? str(r.project, 20) : '',
      actionRef: str(r?.actionRef, 40) || null, task: str(r?.task, 500), ownerIds: idsOf(r?.ownerIds, userIds), due: day(r?.due),
      mandatory: !!r?.mandatory, ownerPicked: !!r?.ownerPicked, ...(r?.planned === true ? { planned: true } : {}), ...(typeof r?.started === 'boolean' ? { started: r.started } : {}),
    };
  };
  const row = (r, ongoing) => {
    const risk = RISK_CODES.includes(r?.risk) ? r.risk : null;
    const o = { ...base(r), source: itemSource(r) || (SOURCES.includes(r?.source) ? r.source : 'Phát sinh'), status: STATUSES.includes(r?.status) ? r.status : 'Đúng tiến độ',
      risk, riskNote: risk ? str(r?.riskNote, 60) : '',
      pct: pctOf(r?.pct), pct0: pctOf(r?.pct0), pctLocked: !!r?.pctLocked, critical: !!r?.critical, milestone: !!r?.milestone,
      cause: str(r?.cause, 1000), solution: str(r?.solution, 1000), helpFrom: cleanHelp(r?.helpFrom, deptIds), helpWhat: str(r?.helpWhat, 1000), helpBy: day(r?.helpBy) };
    if (o.status === DONE) o.pct = 100;
    if (o.pct === 100 && o.status !== DONE) o.status = DONE;
    if (o.status === DONE) { o.risk = null; o.riskNote = ''; }
    if (ongoing) { o.start = day(r?.start); o.next = str(r?.next, 1000); }
    return o;
  };
  const itemId = r => Number.isInteger(r?.itemId) && (!itemIds || itemIds.has(r.itemId));
  const itemSource = r => (itemId(r) ? (taskIds?.has(r.itemId) ? TASK_SOURCE : MTL_SOURCE) : null);
  // Dòng gắn một việc không có trong tập cho phép (người gửi không xem được, việc đã xoá…) → BỎ hẳn, không biến thành dòng tự do
  // giữ nguyên tên việc (lộ tên, trùng dòng). Mã việc là dữ liệu của máy chủ.
  const foreign = r => r?.itemId != null && r.itemId !== '' && !itemId(r);
  const lim = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []).filter(r => !foreign(r));
  return {
    results: lim(d.results, 200).map(r => row(r, false)),
    ongoing: lim(d.ongoing, 200).map(r => row(r, true)),
    risks: lim(d.risks, 200).map(r => row(r, true)),
    plans: lim(d.plans, 200).map(p => ({ ...base(p), basis: itemSource(p) || (SOURCES.includes(p?.basis) ? p.basis : 'KH tháng'), output: str(p?.output, 500) })),
    other: str(d.other, 3000),
  };
}

// ---------- Kiểm tra trước khi nộp (Điều 4, Phần C) ----------
function validate(data, f, { deptName = () => '', mandatory = [] } = {}) {
  const e = [];
  const risks = data.risks || [];
  const res = data.results.filter(r => r.task), on = data.ongoing.filter(r => r.task), rk = risks.filter(r => r.task), pl = data.plans.filter(p => p.task);
  if (!res.length && !on.length && !rk.length) e.push('Phần I, II hoặc III cần ít nhất 1 hạng mục.');
  if (!on.length && !rk.length && !pl.length) e.push('Phần II, III hoặc IV cần ít nhất 1 việc cho tuần mới.');
  const check = (r, label) => {
    // Dòng gắn hạng mục MTL / việc: hạn lấy từ việc (không sửa trong báo cáo) — việc chưa đặt hạn không chặn nộp.
    if (!r.due && !r.itemId) e.push(`${label}: thiếu deadline.`);
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
  risks.forEach((r, k) => { if (!r.task) e.push(`Phần III, việc ${k + 1}: thiếu tên việc.`); else check(r, `Phần III ${short(r.task)}`); });
  data.plans.forEach((p, k) => {
    if (!p.task) { e.push(`Phần IV, hạng mục ${k + 1}: thiếu tên hạng mục.`); return; }
    if (!p.ownerIds.length) e.push(`Phần IV ${short(p.task)}: thiếu người phụ trách.`);
    if (!p.due) e.push(`Phần IV ${short(p.task)}: thiếu deadline.`);
    if (!p.output) e.push(`Phần IV ${short(p.task)}: ghi sản phẩm đầu ra.`);
  });
  // Hạng mục bắt buộc báo cáo (MTL đến hạn / quá hạn / đang chạy, việc TGĐ giao, kế hoạch tuần trước) không được bỏ (Điều 4).
  const has = (k, v) => [...data.results, ...data.ongoing, ...risks].some(r => r[k] === v);
  for (const m of mandatory) if (!(m.itemId ? has('itemId', m.itemId) : m.actionRef ? has('actionRef', m.actionRef) : has('key', m.key)))
    e.push(`Không được bỏ ${short(m.task)}${m.ref ? ` (${m.ref})` : ''} — đây là hạng mục bắt buộc báo cáo; cập nhật tình trạng thay vì bỏ.`);
  return e;
}
// Xoá nội dung vướng mắc ở hạng mục không còn Chậm / Vướng / Quá hạn (giữ báo cáo gọn).
function finalize(data, f) {
  const fix = r => (needsIssue(r, f) ? { ...r, overdue: isOverdue(r, f) } : { ...r, ...blankIssue(), overdue: false });
  return { ...data, results: data.results.filter(r => r.task).map(fix), ongoing: data.ongoing.filter(r => r.task).map(fix), risks: (data.risks || []).filter(r => r.task).map(fix), plans: data.plans.filter(p => p.task) };
}
// Lúc nộp, sau khi máy chủ tính lại tình trạng: dòng gắn việc về đúng phần — xong → I, đã bắt đầu (Phần III ghi %, việc vừa bấm bắt đầu)
// → II. Bản lưu khớp với điều người đọc thấy; dòng chưa bắt đầu, hết nguy cơ (vd. vừa gia hạn) giữ ở III, không vào số liệu giao ban.
// items = false (tuần đã họp, đóng băng): không xếp lại dòng gắn việc.
// Dòng gắn việc: phần do máy quyết hoàn toàn theo tình trạng (K1) — xong → I; đã bắt đầu → II; chưa bắt đầu → III (nguy cơ / đăng ký mà chưa làm).
function regroup(data, { items = true } = {}) {
  const out = { ...data, results: [...data.results], ongoing: [...data.ongoing], risks: [...(data.risks || [])] };
  const placeOfRow = r => (r.status === DONE ? 'results' : rowStarted(r) ? 'ongoing' : 'risks');
  if (items) for (const from of ['results', 'ongoing', 'risks']) for (const r of out[from].filter(x => x.itemId && placeOfRow(x) !== from)) {
    const to = placeOfRow(r);
    out[from].splice(out[from].indexOf(r), 1); out[to].push(to === 'ongoing' ? { start: '', next: '', ...r } : r);
  }
  // Dòng tự do: bắt buộc / đã đăng ký mà chưa làm → III (tổng hợp cũng xếp ở III); ở III mà đã làm → II.
  const free = (from, to, test) => { for (const r of out[from].filter(x => !x.itemId && x.task && test(x))) { out[from].splice(out[from].indexOf(r), 1); out[to].push(to === 'ongoing' ? { start: '', next: '', ...r } : r); } };
  free('results', 'risks', r => r.status !== DONE && !rowStarted(r) && (r.mandatory || r.planned));
  free('ongoing', 'risks', r => r.status !== DONE && !rowStarted(r) && (r.mandatory || r.planned));
  free('risks', 'results', r => r.status === DONE);
  free('risks', 'ongoing', r => rowStarted(r));
  return out;
}
// Dòng bắt buộc báo cáo (theo điền sẵn mới nhất) mà bản gửi lên còn để ở Phần IV (kế hoạch) — vd. việc kế hoạch thành sắp hạn,
// hạng mục làm sớm: chuyển sang đúng phần thay vì báo "Không được bỏ" mà người lập không biết sửa thế nào.
function adoptMandatory(data, prefill) {
  const out = { ...data, results: [...data.results], ongoing: [...data.ongoing], risks: [...(data.risks || [])], plans: [...data.plans] };
  const has = id => [...out.results, ...out.ongoing, ...out.risks].some(r => r.itemId === id);
  for (const list of ['results', 'ongoing', 'risks']) for (const m of prefill[list] || []) {
    if (!m.mandatory || !m.itemId || has(m.itemId)) continue;
    const at = out.plans.findIndex(p => p.itemId === m.itemId);
    if (at < 0) continue;
    const [p] = out.plans.splice(at, 1);
    out[list].push({ ...structuredClone(m), ...(p.ownerPicked ? { ownerIds: p.ownerIds, ownerPicked: true } : {}) });
  }
  return out;
}
// ---------- Dòng "Hệ thống tự bổ sung" (quyết định chủ dự án 24/11/2026, mục S10) ----------
// Tập việc phải báo cáo của bộ phận tính theo PHẠM VI BỘ PHẬN (deptCandidates trên mọi việc của bộ phận), không theo quyền xem của
// người lập. Việc người lập không xem được (vd. TGĐ giao trưởng phòng qua sổ giao việc, nhân viên lập báo cáo) không hiện trên biểu mẫu;
// lúc nộp, máy chủ tự thêm vào bản nộp với tiến độ / hạn / nguy cơ lấy từ hệ thống, gắn auto: true, không bắt ghi giải pháp.
// Ai được thấy: người xem tổng hợp đầy đủ và người vốn xem được việc đó (routes/weekly.js); bản tóm tắt và văn bản tóm tắt bỏ hẳn.
const AUTO_LABEL = 'Hệ thống tự bổ sung';
const isAuto = r => !!r?.auto;
// full: buildPrefill trên MỌI việc của bộ phận (cùng tuần, cùng bản nộp tuần trước). visibleIds: việc người nộp xem được.
// parentOf: id việc → id việc cha (bỏ dòng tự bổ sung khi việc cha / tổ tiên đã có trong báo cáo — không đếm hai lần).
function addAutoRows(data, full, visibleIds, parentOf = new Map()) {
  const out = { ...data, results: [...data.results], ongoing: [...data.ongoing], risks: [...(data.risks || [])] };
  const have = new Set(allRows(out).map(r => r.itemId).filter(Boolean));
  const covered = id => { let p = parentOf.get(id), guard = 0; while (p != null && guard++ < 20) { if (have.has(p)) return true; p = parentOf.get(p); } return false; };
  let n = 0;
  for (const list of ['results', 'ongoing', 'risks']) for (const r of full[list] || []) {
    if (!r.itemId || visibleIds.has(r.itemId) || have.has(r.itemId) || covered(r.itemId)) continue;
    have.add(r.itemId); n++;
    out[list].push({ ...structuredClone(r), ...blankIssue(), next: '', carried: false, mandatory: false, pctLocked: true, auto: true });
  }
  return { data: out, added: n };
}
// Bản người xem nhận: bỏ MỌI dòng gắn việc mà người xem không xem được (canSee(itemId) = false), kể cả dòng do người khác nhập.
const viewFor = (data, canSee) => (data ? { ...data, results: (data.results || []).filter(r => !r.itemId || canSee(r.itemId)),
  ongoing: (data.ongoing || []).filter(r => !r.itemId || canSee(r.itemId)), risks: (data.risks || []).filter(r => !r.itemId || canSee(r.itemId)),
  plans: (data.plans || []).filter(r => !r.itemId || canSee(r.itemId)) } : data);
// Bản tóm tắt theo người xem: báo cáo bộ phận mình chỉ còn dòng họ xem được; danh sách nguy cơ: dòng không xem được giữ để ĐẾM, bỏ tên.
// Số liệu (kpis, rows[].done / ongoing / risk) không đổi — giống nhau với mọi người xem.
// Yêu cầu hỗ trợ: ẩn tên việc / nội dung khi việc thuộc dự án kín của bộ phận khác (x.secret), hoặc việc của bộ phận mình mà người xem không xem được.
const hiddenHelp = h => ({ fromId: h.fromId, from: h.from, to: h.to, toKey: h.toKey, by: h.by, status: h.status, conclusion: null, hidden: true, task: '', what: '', ref: '', itemId: null });
function briefFor(view, canSee, ownDeptId = null) {
  const hideHelp = h => h.itemId && (h.fromId === ownDeptId ? !canSee(h.itemId) : !!h.secret);
  return { ...view, rows: view.rows.map(r => (r.report ? { ...r, report: viewFor(r.report, canSee) } : r)),
    risks: (view.risks || []).map(x => (x.itemId && !canSee(x.itemId) ? { departmentId: x.departmentId, department: x.department, risk: x.risk, hidden: true, task: '', ref: '', solution: '', due: '', pct: '', itemId: null } : x)),
    helps: (view.helps || []).map(g => ({ ...g, list: g.list.map(h => (hideHelp(h) ? hiddenHelp(h) : h)) })),
    // K5: kết luận giao ban chỉ giữ cho yêu cầu hỗ trợ người xem được thấy (kết luận ghi tay có thể nhắc tên việc kín).
    meeting: { ...(view.meeting || {}), conclusions: Object.fromEntries(Object.entries(view.meeting?.conclusions || {}).filter(([k]) => (view.helps || []).some(g => g.list.some(h => h.key === k && !hideHelp(h))))) } };
}
// Bản không có dòng tự bổ sung.
const withoutAuto = (data, keep = () => false) => (data ? { ...data, results: (data.results || []).filter(r => !isAuto(r) || keep(r)),
  ongoing: (data.ongoing || []).filter(r => !isAuto(r) || keep(r)), risks: (data.risks || []).filter(r => !isAuto(r) || keep(r)) } : data);

// % đề xuất ghi ngược vào MTL: hạng mục liên kết, không tự tính từ việc nhánh, % khác lúc điền sẵn (pct0).
// Máy chủ chỉ ghi khi % trong MTL vẫn bằng pct0 (chưa ai đổi từ lúc điền sẵn) — tránh đè số mới bằng số cũ khi gửi lại.
const writeBacks = data => [...data.results, ...data.ongoing, ...(data.risks || [])]
  .filter(r => r.itemId && !r.auto && !r.pctLocked && r.pct !== '' && r.pct !== r.pct0)
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
  let submitted = 0, stuck = 0, overdue = 0, nDone = 0, nOngoing = 0;
  const helps = [], rows = [], risks = [];
  for (const d of depts) {
    const rep = reports.find(r => r.departmentId === d.id) || null;
    const sent = rep && rep.firstSubmittedAt ? rep : null;
    const ns = notices.filter(n => n.departmentId === d.id);
    const st = submissionStatus(sent, ns, S, now);
    const absent = ns.find(n => n.type === 'ABSENT') || null;
    const items = sent ? [...(sent.data.results || []), ...(sent.data.ongoing || []), ...(sent.data.risks || [])] : [];
    if (SUBMITTED.includes(st.code)) submitted++;
    const nStuck = items.filter(x => x.status === 'Chậm' || x.status === 'Vướng').length, nOver = items.filter(x => isOverdue(x, f)).length;
    stuck += nStuck; overdue += nOver;
    // Ba phần chủ dự án cần nắm: xong trong tuần · đang làm chưa xong (chuyển tiếp tuần sau) · nguy cơ chậm.
    const parts = sent ? partsOf(sent.data, f) : { done: [], ongoing: [], risk: [] };
    const dDone = parts.done.length, dOngoing = parts.ongoing.length, dRisk = parts.risk;
    nDone += dDone; nOngoing += dOngoing;
    for (const x of dRisk) risks.push({ departmentId: d.id, department: d.name, key: x.key, ref: x.ref || '', task: x.task, risk: rowRisk(x, f), due: x.due || '', pct: x.pct ?? '',
      started: rowStarted(x), auto: isAuto(x), solution: x.solution || '', itemId: x.itemId || null });
    for (const x of items) if (needsIssue(x, f) && x.helpFrom && x.helpFrom !== HELP_SELF)
      helps.push({ key: `${d.id}:${safeKey(x.key)}`, itemId: x.itemId || null, fromId: d.id, from: d.name, to: helpTarget(x.helpFrom, deptName), toKey: x.helpFrom, task: x.task, ref: x.ref || '', what: x.helpWhat, by: x.helpBy, status: issueLabel(x, f), cause: x.cause, solution: x.solution, conclusion: md.conclusions?.[`${d.id}:${safeKey(x.key)}`] || null });
    rows.push({ id: d.id, name: d.name, status: st, submittedAt: sent?.firstSubmittedAt || null, lastSubmittedAt: sent?.submittedAt || null, resubmits: sent ? Math.max(0, (sent.submitCount || 1) - 1) : 0,
      submittedBy: sent ? userName(sent.submittedById) : '', items: sent ? items.length : null, stuck: sent ? nStuck : null, overdue: sent ? nOver : null,
      done: sent ? dDone : null, ongoing: sent ? dOngoing : null, risk: sent ? dRisk.length : null,
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
  return { week: f, schedule: S, kpis: { submitted, total: depts.length, overdue, stuck, helps: helps.length, done: nDone, ongoing: nOngoing, risk: risks.length },
    rows, risks, helps: groups, actionReview, meeting: md, publishedAt: meeting?.publishedAt || null };
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
    risks: (sum.risks || []).filter(x => x.departmentId === ownDeptId),
    meeting: { conclusions: sum.meeting?.conclusions || {} } };
}

// Bản tổng hợp theo quyền người xem: có quyền chi tiết (weekly.summary.detail) → đầy đủ; còn lại (trưởng / phó) → bản tóm tắt của
// bộ phận mình. text = BẢN GỬI EMAIL (emailText, chủ dự án chọn "Bản tóm tắt" 24/11/2026) cho MỌI người dùng — nút "Sao chép bản tổng hợp",
// API /api/weekly/summary, MCP kepper_weekly_summary. fullText (I, II, III đầy đủ) chỉ cho người xem đầy đủ, chỉ dùng nội bộ, không gửi email.
// canSee(itemId): người xem xem được việc (bản tóm tắt: dòng / tên việc họ không xem được bị bỏ; số liệu giữ nguyên với mọi người).
// isSecret(itemId): việc thuộc dự án KÍN ("Chỉ thành viên" PRIVATE / "Sổ giao việc" ASSIGNED) — bản email và bản tóm tắt cho bộ phận khác
// KHÔNG nêu tên, chỉ đếm, bất kể ai lập (quy tắc theo việc, phiên nghiệm thu chốt vòng 4). Việc dự án thường vẫn nêu tên ở mục nguy cơ chậm.
function summaryView(sum, { full, departmentId, canSee = () => false, isSecret = () => false }) {
  const marked = { ...sum, risks: (sum.risks || []).map(x => ({ ...x, secret: !!x.itemId && isSecret(x.itemId) })),
    helps: (sum.helps || []).map(g => ({ ...g, list: g.list.map(h => ({ ...h, secret: !!h.itemId && isSecret(h.itemId) })) })) };
  sum = marked;
  const view = full ? sum : briefFor(briefSummary(sum, departmentId), canSee, departmentId);
  return { view, text: emailText(view), ...(full ? { fullText: summaryText(view) } : {}) };
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
    `Đã nộp ${sum.kpis.submitted}/${sum.kpis.total} bộ phận · ${sum.kpis.done ?? 0} việc xong trong tuần · ${sum.kpis.ongoing ?? 0} đang thực hiện · ${sum.kpis.risk ?? 0} nguy cơ chậm · ${sum.kpis.stuck} chậm/vướng · ${sum.kpis.overdue} quá hạn · ${sum.kpis.helps} yêu cầu hỗ trợ`, '', 'TÌNH TRẠNG NỘP'];
  for (const r of sum.rows) L.push(`- ${r.name}: ${r.status.label}${r.submittedAt ? ` (${fmtTime(r.submittedAt)})` : ''}${r.report ? ` · xong ${r.done ?? 0}, đang làm ${r.ongoing ?? 0}, nguy cơ chậm ${r.risk ?? 0}` : ''}${r.absent ? ` · VẮNG${r.absent.substitute || r.absent.hasSubstitute ? ', có người dự thay' : ''}` : ''}`);
  if (sum.actionReview.length) {
    L.push('', 'ACTION LOG ĐANG THEO DÕI');
    for (const a of sum.actionReview) L.push(`- [${a.department}] ${a.task} — ${a.status || 'chưa báo cáo'}${a.overdue && a.status !== DONE ? ', quá hạn' : ''}`);
  }
  const withReport = sum.rows.filter(r => r.report);
  const list = (title, pick, line) => {
    L.push('', title);
    let any = false;
    for (const r of withReport) for (const x of pick(r.report)) { any = true; L.push(line(r, x)); }
    if (!any) L.push('- Không có');
  };
  const pctOf = x => (x.pct !== '' && x.pct != null ? ` · ${x.pct}%` : '');
  const autoOf = x => (isAuto(x) ? ` (${AUTO_LABEL.toLowerCase()})` : '');
  list('I. ĐÃ HOÀN THÀNH TRONG TUẦN', d => partsOf(d, f).done, (r, x) => `- [${r.name}] ${x.task}${autoOf(x)}`);
  list('II. ĐANG THỰC HIỆN, CHƯA HOÀN THÀNH (chuyển tiếp tuần sau)', d => partsOf(d, f).ongoing,
    (r, x) => `- [${r.name}] ${x.task}${autoOf(x)}${pctOf(x)}${x.due ? ` · hạn ${fmtD(x.due)}` : ''}${rowRisk(x, f) ? ` · ${rowRisk(x, f)}` : ''}${x.next ? ` — Tuần tới: ${x.next}` : ''}`);
  list('III. NGUY CƠ CHẬM TIẾN ĐỘ (trễ hạn / chậm / vướng / sắp hạn / chậm khởi động / đăng ký mà chưa làm)', d => partsOf(d, f).risk,
    (r, x) => `- [${r.name}] ${x.task}${autoOf(x)} — ${rowRisk(x, f)}${x.due ? ` (hạn ${fmtD(x.due)})` : ''}${pctOf(x)}${x.solution ? ` — Giải pháp: ${x.solution}` : ''}`);
  L.push('', 'YÊU CẦU HỖ TRỢ (xử lý 09:15 – 09:25)');
  if (!sum.helps.length) L.push('- Không có');
  for (const g of sum.helps) for (const h of g.list) L.push(`- ${h.from} → ${g.to}: ${h.what} (việc “${h.task}”)${h.by ? `, cần trước ${fmtD(h.by)}` : ''}${h.conclusion ? ` — Kết luận: ${DECISIONS[h.conclusion.decision] || ''}${h.conclusion.note ? ': ' + h.conclusion.note : ''}` : ''}`);
  return L.join('\n');
}

// Bản gửi email sau giao ban (QĐ-EXT: chỉ bản tóm tắt được gửi ra ngoài phạm vi xem đầy đủ): tình trạng nộp + số việc xong / đang làm /
// nguy cơ chậm từng bộ phận, Action Log, mục III nguy cơ chậm (tên việc, mức nguy cơ, hạn, giải pháp), yêu cầu hỗ trợ. KHÔNG có danh sách
// mục I (việc xong) và mục II (việc đang làm); dòng "Hệ thống tự bổ sung" không nêu tên, chỉ cộng vào số liệu. Không có họ tên người phụ trách.
function emailText(sum) {
  const S = sum.schedule, f = sum.week;
  const L = ['BẢO MẬT – chỉ dùng nội bộ', `TỔNG HỢP BÁO CÁO TUẦN ${fmtD(S.from)}–${fmtDY(f)} · Giao ban 08:30 ${WD[weekday(S.meetingDay)]} ${fmtDY(S.meetingDay)}`, '',
    `Đã nộp ${sum.kpis.submitted}/${sum.kpis.total} bộ phận · ${sum.kpis.done ?? 0} việc xong trong tuần · ${sum.kpis.ongoing ?? 0} đang thực hiện · ${sum.kpis.risk ?? 0} nguy cơ chậm · ${sum.kpis.stuck} chậm/vướng · ${sum.kpis.overdue} quá hạn · ${sum.kpis.helps} yêu cầu hỗ trợ`, '', 'TÌNH TRẠNG NỘP'];
  for (const r of sum.rows) L.push(`- ${r.name}: ${r.status.label}${r.submittedAt ? ` (${fmtTime(r.submittedAt)})` : ''}${r.done != null ? ` · xong ${r.done}, đang làm ${r.ongoing ?? 0}, nguy cơ chậm ${r.risk ?? 0}` : ''}${r.absent ? ` · VẮNG${r.absent.substitute || r.absent.hasSubstitute ? ', có người dự thay' : ''}` : ''}`);
  if (sum.actionReview.length) {
    L.push('', 'ACTION LOG ĐANG THEO DÕI');
    for (const a of sum.actionReview) L.push(`- [${a.department}] ${a.task} — ${a.status || 'chưa báo cáo'}${a.overdue && a.status !== DONE ? ', quá hạn' : ''}`);
  }
  L.push('', 'NGUY CƠ CHẬM TIẾN ĐỘ (trễ hạn / chậm / vướng / sắp hạn / chậm khởi động / đăng ký mà chưa làm)');
  const named = (sum.risks || []).filter(x => !x.auto && !x.hidden && !x.secret), unnamed = (sum.risks || []).length - named.length;
  if (!named.length && !unnamed) L.push('- Không có');
  if (unnamed) L.push(`- (${unnamed} việc hệ thống tự bổ sung / dự án kín / không nêu tên — xem trong Kepler Hub)`);
  for (const x of named) L.push(`- [${x.department}] ${x.task} — ${x.risk}${x.due ? ` (hạn ${fmtD(x.due)})` : ''}${x.pct !== '' && x.pct != null ? ` · ${x.pct}%` : ''}${x.solution ? ` — Giải pháp: ${x.solution}` : ''}`);
  L.push('', 'YÊU CẦU HỖ TRỢ (xử lý 09:15 – 09:25)');
  if (!sum.helps.length) L.push('- Không có');
  for (const g of sum.helps) for (const h of g.list) L.push(h.hidden || h.secret ? `- ${h.from} → ${g.to}: (việc không nêu tên — xem trong Kepler Hub)${h.by ? `, cần trước ${fmtD(h.by)}` : ''}` : `- ${h.from} → ${g.to}: ${h.what} (việc “${h.task}”)${h.by ? `, cần trước ${fmtD(h.by)}` : ''}${h.conclusion ? ` — Kết luận: ${DECISIONS[h.conclusion.decision] || ''}${h.conclusion.note ? ': ' + h.conclusion.note : ''}` : ''}`);
  L.push('', 'Danh sách đầy đủ việc đã xong và đang thực hiện của từng bộ phận: xem trong Kepler Hub (Báo cáo tuần › Tổng hợp).');
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
  SOURCES, MTL_SOURCE, TASK_SOURCE, RISK_CODES, STATUSES, DONE, HELP_BGD, HELP_SELF, REASONS, NOTICE_TYPES, ATTENDANCE, DECISIONS, POINTS, POINT_LABEL,
  isDay, addDays, dayOf, at, weekday, currentFriday, isFriday, fmtD, fmtDY, fmtTime, scheduleOf, meetingStarted,
  doneSince, AUTO_LABEL, isAuto, addAutoRows, withoutAuto, viewFor, briefFor, allRows, isOverdue, needsIssue, issueLabel, rowRisk, riskRows, rowStarted, partsOf, regroup, adoptMandatory, PLAN_NOT_STARTED, riskNoteOf, placeOf, statusFromMtl, taskStatus, deptCandidates, buildPrefill, sanitize, validate, finalize, writeBacks,
  submissionStatus, absenceNoticed, SUBMITTED, buildSummary, briefSummary, summaryText, emailText, summaryView, compliance, fridaysOf, stableStringify,
};
