// Thống kê dùng chung cho Dashboard, KPI và Báo cáo: quy đổi phòng ban của việc, chỉ số theo kỳ, điểm tổng hợp.
// Toàn bộ là hàm thuần (không truy vấn CSDL) để kiểm thử được; truy vấn nằm ở routes/*.
const DAY = 86_400_000, H7 = 7 * 3_600_000;

// Điểm xếp loại khi nghiệm thu (thang 100).
const RATING_POINTS = { EXCELLENT: 100, GOOD: 85, PASS: 70, FAIL: 0 };
const WEIGHT_KEYS = ['onTime', 'rating', 'volume'];
const DEFAULT_WEIGHTS = { onTime: 40, rating: 40, volume: 20 };
// Điểm khối lượng (so với bình quân cán bộ cùng phòng) chỉ tính khi phòng có từ 3 cán bộ có số liệu trong kỳ:
// với phòng 2 người, từ điểm của mình suy ra được số việc của đồng nghiệp (dữ liệu cá nhân).
const MIN_PEERS = 3;

const ms = d => (d == null ? null : new Date(d).getTime());
const round1 = n => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const pct = (a, b) => (b ? Math.round(a / b * 100) : null);
const mean = list => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const vnDay = d => Math.floor((ms(d) + H7) / DAY); // số ngày lịch theo giờ Việt Nam
const endOfLocalDay = d => new Date((vnDay(d) + 1) * DAY - 1 - H7);
const startOfLocalDay = d => new Date(vnDay(d) * DAY - H7);

const category = i => i.state?.category;
const isDone = i => category(i) === 'COMPLETED';
const isCancelled = i => category(i) === 'CANCELLED';
const isOpen = i => !isDone(i) && !isCancelled(i);
// Quá hạn = chưa xong và đã qua ngày hạn (theo ngày giờ Việt Nam, giống trạng thái hạn của sổ).
const isOverdue = (i, now = new Date()) => isOpen(i) && i.dueDate != null && vnDay(i.dueDate) < vnDay(now);
const onTimeDone = i => isDone(i) && i.completedAt != null && i.dueDate != null && vnDay(i.completedAt) <= vnDay(i.dueDate);
const assignedOn = i => i.assignedAt ?? i.createdAt ?? null;

// ---------- Phòng ban của việc ----------
// Khi thống kê, việc thuộc đơn vị chủ trì; không có đơn vị chủ trì thì thuộc phòng sở hữu dự án / sổ.
function departmentOf(item) {
  return item.leadDepartmentId ?? item.project?.departmentId ?? null;
}
function inDepartment(item, departmentId) {
  return departmentId != null && departmentOf(item) === Number(departmentId);
}
// Điều kiện Prisma (WorkItem) tương ứng departmentOf(item) === departmentId.
function departmentWhere(departmentId) {
  const id = departmentId == null ? -1 : Number(departmentId);
  return { OR: [{ leadDepartmentId: id }, { leadDepartmentId: null, project: { departmentId: id } }] };
}

// ---------- Thời gian xử lý ----------
// = hoàn thành − (bắt đầu ?? ngày giao ?? ngày tạo), tính theo ngày; giá trị âm / không hợp lệ bị bỏ.
function processingDays(item) {
  if (!item.completedAt) return null;
  const start = item.startedAt ?? item.assignedAt ?? item.createdAt;
  if (!start) return null;
  const d = (ms(item.completedAt) - ms(start)) / DAY;
  return Number.isFinite(d) && d >= 0 ? d : null;
}

// Việc có liên quan đến kỳ (để chọn tập việc và danh sách cán bộ thống kê).
function relevant(item, { from, to }) {
  const f = ms(from), t = ms(to);
  const within = d => d != null && ms(d) >= f && ms(d) <= t;
  return isOpen(item) || within(item.dueDate) || within(item.completedAt) || within(assignedOn(item)) || within(item.ratedAt);
}

// ---------- Chỉ số của một tập việc trong kỳ [from, to] ----------
// items: { state.category, taskType, dueDate, assignedAt, createdAt, startedAt, completedAt, rating, ratedAt,
//          rejectionDates?: Date[] (lần bị trả lại) | rejections?: number }
function metrics(items, { from, to, now = new Date() }) {
  const f = ms(from), t = ms(to);
  const within = d => d != null && ms(d) >= f && ms(d) <= t;
  const live = items.filter(i => !isCancelled(i));
  // Đúng hạn: việc có hạn trong kỳ; chỉ chấm việc đã xong hoặc đã qua ngày hạn.
  const dueIn = live.filter(i => within(i.dueDate));
  const judged = dueIn.filter(i => isDone(i) || vnDay(i.dueDate) < vnDay(now));
  const onTime = judged.filter(onTimeDone).length;
  const completedIn = items.filter(i => isDone(i) && within(i.completedAt));
  const durations = completedIn.map(processingDays).filter(d => d != null);
  const open = items.filter(isOpen);
  const rated = items.filter(i => RATING_POINTS[i.rating] != null && within(i.ratedAt ?? i.completedAt));
  // Kế hoạch năm: nhiệm vụ đến hạn trong kỳ (chưa có hạn thì theo ngày giao) → đã hoàn thành bao nhiêu.
  const plan = live.filter(i => i.taskType === 'PLAN' && (i.dueDate ? within(i.dueDate) : within(assignedOn(i))));
  const planDone = plan.filter(isDone).length;
  // Đột xuất: giao trong kỳ → hoàn thành, đúng hạn / trễ hạn (trễ = xong sau hạn hoặc đang quá hạn).
  const adhoc = live.filter(i => i.taskType !== 'PLAN' && within(assignedOn(i)));
  const adhocDone = adhoc.filter(isDone);
  const rejections = items.reduce((n, i) => n + (Array.isArray(i.rejectionDates) ? i.rejectionDates.filter(within).length : (i.rejections || 0)), 0);
  return {
    assigned: live.filter(i => within(assignedOn(i))).length,
    dueInPeriod: dueIn.length, judged: judged.length, onTime, late: judged.length - onTime, onTimeRate: pct(onTime, judged.length),
    completed: completedIn.length,
    avgDays: round1(mean(durations)), durationSamples: durations.length,
    openNow: open.length, overdueNow: open.filter(i => isOverdue(i, now)).length,
    rated: rated.length, ratingAvg: round1(mean(rated.map(i => RATING_POINTS[i.rating]))),
    rejections,
    plan: { total: plan.length, completed: planDone, rate: pct(planDone, plan.length) },
    adhoc: { assigned: adhoc.length, completed: adhocDone.length, onTime: adhocDone.filter(onTimeDone).length,
      late: adhoc.filter(i => i.dueDate && (isDone(i) ? !onTimeDone(i) : isOverdue(i, now))).length },
  };
}

// ---------- Điểm tổng hợp ----------
function normalizeWeights(weights) {
  const out = {};
  for (const k of WEIGHT_KEYS) { const n = Number(weights?.[k]); out[k] = Number.isFinite(n) && n > 0 ? n : 0; }
  return WEIGHT_KEYS.some(k => out[k] > 0) ? out : { ...DEFAULT_WEIGHTS };
}
// Điểm khối lượng = min(100, số việc hoàn thành / bình quân × 100); bình quân 0 hoặc không có → không có dữ liệu.
function volumeScore(completed, average) {
  if (average == null || !(average > 0)) return null;
  return round1(Math.min(100, (completed / average) * 100));
}
// Thành phần không có dữ liệu (null) bị bỏ, trọng số chia lại cho các thành phần còn lại.
// Chỉ có khối lượng (chưa có việc tới hạn, chưa được xếp loại) thì chưa đủ căn cứ chấm điểm → null.
function compositeScore(components, weights) {
  const w = normalizeWeights(weights);
  const has = k => components[k] != null && Number.isFinite(components[k]);
  if (!has('onTime') && !has('rating')) return null;
  const parts = WEIGHT_KEYS.filter(k => has(k) && w[k] > 0);
  const sum = parts.reduce((n, k) => n + w[k], 0);
  if (!sum) return null;
  return round1(parts.reduce((n, k) => n + w[k] * components[k], 0) / sum);
}

// ---------- KPI theo phòng và theo cá nhân ----------
// items: việc (đã lọc quyền xem) kèm project.departmentId, leadDepartmentId, assignees[{ userId }] và các trường của metrics().
// users: [{ id, fullName, displayTitle?, isActive?, departmentId, departmentName? }] — cán bộ được xét (chỉ người có việc trong kỳ được liệt kê).
// departments: [{ id, name }] — các phòng được xét.
function computeKpi(items, { users = [], departments = [], from, to, now = new Date(), weights = DEFAULT_WEIGHTS, minPeers = MIN_PEERS } = {}) {
  const scoped = items.filter(i => relevant(i, { from, to }));
  const opts = { from, to, now };
  const total = metrics(scoped, opts);

  const people = [];
  for (const u of users) {
    const own = scoped.filter(i => (i.assignees || []).some(a => a.userId === u.id));
    if (!own.length) continue;
    people.push({ id: u.id, fullName: u.fullName, title: u.displayTitle ?? u.title ?? null, isActive: u.isActive !== false,
      departmentId: u.departmentId ?? null, department: u.departmentName || '—', ...metrics(own, opts) });
  }
  // Bình quân việc hoàn thành của cán bộ cùng phòng (theo phòng của cán bộ).
  const groups = new Map();
  for (const p of people) { const k = p.departmentId ?? 'none'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  for (const list of groups.values()) {
    const avg = list.length >= minPeers ? mean(list.map(p => p.completed)) : null;
    for (const p of list) {
      p.peers = list.length;
      p.components = { onTime: p.onTimeRate, rating: p.ratingAvg, volume: volumeScore(p.completed, avg) };
      p.score = compositeScore(p.components, weights);
    }
  }
  people.sort((a, b) => a.department.localeCompare(b.department, 'vi') || a.fullName.localeCompare(b.fullName, 'vi'));

  // Theo phòng: việc theo đơn vị chủ trì; khối lượng = việc hoàn thành bình quân mỗi cán bộ của phòng so với bình quân các phòng.
  const rows = departments.map(d => {
    const own = scoped.filter(i => inDepartment(i, d.id));
    const crew = groups.get(d.id) || [];
    const scores = crew.map(p => p.score).filter(s => s != null);
    return { id: d.id, name: d.name, ...metrics(own, opts), officers: crew.length,
      perCapita: crew.length ? own.filter(i => isDone(i) && ms(i.completedAt) >= ms(from) && ms(i.completedAt) <= ms(to)).length / crew.length : null,
      officerAvgScore: scores.length >= minPeers ? round1(mean(scores)) : null };
  }).filter(r => r.dueInPeriod || r.completed || r.openNow || r.assigned);
  const perCapita = rows.map(r => r.perCapita).filter(v => v != null);
  const avgPerCapita = perCapita.length >= 2 ? mean(perCapita) : null;
  for (const r of rows) {
    r.components = { onTime: r.onTimeRate, rating: r.ratingAvg, volume: r.perCapita == null ? null : volumeScore(r.perCapita, avgPerCapita) };
    r.score = compositeScore(r.components, weights);
    r.perCapita = round1(r.perCapita);
  }
  return { total, byDepartment: rows, byPerson: people };
}

// ---------- Kỳ thống kê (giờ Việt Nam) ----------
const ROMAN = ['I', 'II', 'III', 'IV'];
function vnPeriod(now = new Date(), kind = 'month') {
  const x = new Date(ms(now) + H7), y = x.getUTCFullYear(), m = x.getUTCMonth();
  const at = (yy, mm) => new Date(Date.UTC(yy, mm, 1) - H7);
  if (kind === 'quarter') {
    const q = Math.floor(m / 3);
    return { kind, from: at(y, q * 3), to: new Date(at(y, q * 3 + 3).getTime() - 1), label: `Quý ${ROMAN[q]}/${y}` };
  }
  if (kind === 'year') return { kind, from: at(y, 0), to: new Date(at(y + 1, 0).getTime() - 1), label: `Năm ${y}` };
  return { kind: 'month', from: at(y, m), to: new Date(at(y, m + 1).getTime() - 1), label: `Tháng ${m + 1}/${y}` };
}
// "YYYY-MM-DD" → 00:00 giờ Việt Nam của ngày đó.
function vnDayStart(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const d = new Date(value + 'T00:00:00+07:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------- Định dạng ngày giờ Việt Nam ----------
const pad = n => String(n).padStart(2, '0');
function vnDate(d) {
  if (!d) return '';
  const x = new Date(ms(d) + H7);
  return `${pad(x.getUTCDate())}/${pad(x.getUTCMonth() + 1)}/${x.getUTCFullYear()}`;
}
function vnDateTime(d) {
  if (!d) return '';
  const x = new Date(ms(d) + H7);
  return `${vnDate(d)} ${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
}

module.exports = {
  DAY, H7, RATING_POINTS, DEFAULT_WEIGHTS, WEIGHT_KEYS, MIN_PEERS,
  departmentOf, inDepartment, departmentWhere, processingDays, relevant, metrics,
  normalizeWeights, volumeScore, compositeScore, computeKpi,
  isOpen, isDone, isOverdue, onTimeDone, vnDay, endOfLocalDay, startOfLocalDay, vnPeriod, vnDayStart, vnDate, vnDateTime, round1, pct,
};
