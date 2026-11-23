// Phân tích thống kê công việc cho Ban giám đốc (trang KPI & phân tích, GET /api/kpi/analytics + xuất Excel).
// Chủ dự án chốt 24/11/2026:
//  - Thời gian xử lý hiện HAI chỉ số: "thời gian làm" = bắt đầu làm → hoàn thành (không có ngày bắt đầu: ngày giao)
//    và "giao → được duyệt" = ngày giao → ngày phiếu duyệt cuối cùng được duyệt (việc không qua duyệt: → hoàn thành).
//  - Đánh giá Tốt / Trung bình / Kém GỘP từ mức người giao đã chấm khi duyệt (không thêm trường):
//    Xuất sắc + Tốt = Tốt; Đạt = Trung bình; Cần cải thiện + Kém = Kém. Đánh giá chung của nhóm = điểm bình quân (thang 100) quy về 3 mức.
//  - Thống kê mô tả + xu hướng + phát hiện bất thường; không dự báo.
// Dữ liệu còn nhỏ → dùng thống kê bền (trung vị, IQR), luôn kèm cỡ mẫu, đánh dấu mẫu nhỏ; KHÔNG xếp hạng người (sắp theo phòng, tên).
// Hàm thuần, không truy vấn CSDL (route: routes/analytics.js).
const S = require('./stats');

const { DAY, RATING_POINTS } = S;
const MIN_SAMPLE = 5;     // dưới mức này: chỉ hiện số liệu, ghi "mẫu nhỏ — chưa đủ để kết luận"
const MIN_OUTLIER = 8;    // cần ít nhất 8 việc đã xong mới tính hàng rào Tukey
const MIN_TREND = 4;      // cần ít nhất 4 kỳ có dữ liệu mới nêu xu hướng
const MIN_TREND_N = 12;   // và ít nhất 12 việc hoàn thành trong cả khoảng
const MIN_CONTROL = 20;   // biểu đồ kiểm soát p: cần ít nhất 20 việc được chấm đúng hạn trong cả khoảng

const ms = d => (d == null ? null : new Date(d).getTime());
const r1 = S.round1;

// ---------- Mức đánh giá 3 bậc ----------
const BANDS = { GOOD: 'Tốt', AVERAGE: 'Trung bình', POOR: 'Kém' };
const BAND_OF_RATING = { EXCELLENT: 'GOOD', GOOD: 'GOOD', PASS: 'AVERAGE', NEEDS_IMPROVEMENT: 'POOR', POOR: 'POOR' };
const ratingBand = rating => BAND_OF_RATING[rating] || null;
// Điểm bình quân (thang 100 của KPI: 100/85/70/50/0) → mức: ≥ 80 Tốt (trên điểm giữa Đạt–Tốt), ≥ 60 Trung bình (trên điểm giữa Cần cải thiện–Đạt), còn lại Kém.
const bandOfScore = score => (score == null ? null : score >= 80 ? 'GOOD' : score >= 60 ? 'AVERAGE' : 'POOR');

// ---------- Thống kê mô tả ----------
// Phân vị nội suy tuyến tính (cùng cách Excel PERCENTILE.INC / R type 7).
function quantile(sorted, p) {
  if (!sorted.length) return null;
  const h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}
function describe(values) {
  const v = values.filter(x => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  if (!n) return { n: 0, median: null, q1: null, q3: null, iqr: null, mean: null, min: null, max: null, smallSample: true };
  const q1 = quantile(v, 0.25), q3 = quantile(v, 0.75);
  return { n, median: r1(quantile(v, 0.5)), q1: r1(q1), q3: r1(q3), iqr: r1(q3 - q1), mean: r1(v.reduce((a, b) => a + b, 0) / n),
    min: r1(v[0]), max: r1(v[n - 1]), smallSample: n < MIN_SAMPLE };
}
// Hàng rào trên Tukey: Q3 + 1,5 × IQR (chỉ khi đủ mẫu).
function upperFence(values) {
  const v = values.filter(x => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < MIN_OUTLIER) return null;
  const q1 = quantile(v, 0.25), q3 = quantile(v, 0.75);
  return q3 + 1.5 * (q3 - q1);
}
// Độ dốc Theil–Sen (trung vị các độ dốc từng cặp) — bền với giá trị lạ, hợp mẫu nhỏ.
function theilSen(points) {
  const p = points.filter(([, y]) => y != null && Number.isFinite(y));
  if (p.length < MIN_TREND) return null;
  const slopes = [];
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[j][0] !== p[i][0]) slopes.push((p[j][1] - p[i][1]) / (p[j][0] - p[i][0]));
  return slopes.length ? quantile(slopes.sort((a, b) => a - b), 0.5) : null;
}

// ---------- Mốc thời gian của một việc ----------
const workDays = item => S.processingDays(item); // bắt đầu (?? giao ?? tạo) → hoàn thành
// Ngày được duyệt: phiếu APPROVED đóng muộn nhất; việc không qua duyệt → ngày hoàn thành.
function approvedAt(item) {
  const closed = (item.approvals || []).filter(a => a.status === 'APPROVED' && a.closedAt).map(a => ms(a.closedAt));
  return closed.length ? new Date(Math.max(...closed)) : item.completedAt ? new Date(item.completedAt) : null;
}
function leadDays(item) {
  if (!S.isDone(item)) return null;
  const end = approvedAt(item), start = item.assignedAt ?? item.createdAt;
  if (!end || !start) return null;
  const d = (ms(end) - ms(start)) / DAY;
  return Number.isFinite(d) && d >= 0 ? d : null;
}
const rejectionsOf = item => (item.approvals || []).reduce((n, a) => n + (a.actions || []).filter(x => x.decision === 'REJECT').length, 0);
const hasDue = i => i.dueDate != null;

// ---------- Chỉ số của một nhóm việc ----------
// done: việc hoàn thành trong kỳ; rated: việc được chấm trong kỳ.
function groupStats(done, rated) {
  const work = describe(done.map(workDays)), lead = describe(done.map(leadDays));
  const judged = done.filter(hasDue), onTime = judged.filter(S.onTimeDone).length;
  const bands = { GOOD: 0, AVERAGE: 0, POOR: 0 };
  for (const i of rated) bands[ratingBand(i.rating)]++;
  const points = rated.map(i => RATING_POINTS[i.rating]);
  const ratingAvg = points.length ? r1(points.reduce((a, b) => a + b, 0) / points.length) : null;
  return {
    completed: done.length, workDays: work, leadDays: lead,
    onTime: { judged: judged.length, onTime, rate: S.pct(onTime, judged.length) },
    rejections: done.reduce((n, i) => n + rejectionsOf(i), 0),
    rating: { n: rated.length, avg: ratingAvg, band: bandOfScore(ratingAvg), bands, smallSample: rated.length < MIN_SAMPLE },
  };
}

// ---------- Kỳ con cho xu hướng ----------
// Khoảng ≤ 92 ngày: theo tuần (thứ Hai, giờ VN); dài hơn: theo tháng.
function buckets(from, to) {
  const out = [];
  if (ms(to) - ms(from) <= 92 * DAY) {
    let d = S.startOfLocalDay(from);
    d = new Date(ms(d) - ((new Date(ms(d) + S.H7).getUTCDay() + 6) % 7) * DAY);
    while (ms(d) <= ms(to)) { const end = new Date(ms(d) + 7 * DAY - 1); out.push({ from: d, to: end, label: 'Tuần ' + S.vnDate(d).slice(0, 5) }); d = new Date(ms(d) + 7 * DAY); }
    return { unit: 'week', list: out };
  }
  let p = S.vnPeriod(from, 'month');
  while (ms(p.from) <= ms(to)) { out.push({ from: p.from, to: p.to, label: p.label }); p = S.vnPeriod(new Date(ms(p.to) + 1), 'month'); }
  return { unit: 'month', list: out };
}
const inRange = (d, f, t) => d != null && ms(d) >= ms(f) && ms(d) <= ms(t);

// ---------- Phân tích chính ----------
// items: việc đã lọc quyền xem, có { id, number, title, project: { key, departmentId }, leadDepartmentId, state.category, dueDate, assignedAt,
//   createdAt, startedAt, completedAt, rating, ratedAt, assignees: [{ userId }], approvals: [{ status, closedAt, actions: [{ decision }] }] }.
// users: [{ id, fullName, departmentId, departmentName }]; departments: [{ id, name }].
function analyze(items, { users = [], departments = [], from, to, now = new Date() } = {}) {
  const live = items.filter(i => i.state?.category !== 'CANCELLED');
  const done = live.filter(i => S.isDone(i) && inRange(i.completedAt, from, to));
  const rated = live.filter(i => ratingBand(i.rating) && inRange(i.ratedAt ?? i.completedAt, from, to));
  const overall = groupStats(done, rated);
  const code = i => `${i.project?.key || ''}-${i.number}`;

  // Theo người (người chủ trì / được giao). Không xếp hạng: sắp theo phòng rồi tên.
  const byPerson = users.map(u => {
    const mine = i => (i.assignees || []).some(a => a.userId === u.id);
    const g = groupStats(done.filter(mine), rated.filter(mine));
    return { id: u.id, fullName: u.fullName, departmentId: u.departmentId ?? null, department: u.departmentName || '—', ...g };
  }).filter(p => p.completed || p.rating.n)
    .sort((a, b) => a.department.localeCompare(b.department, 'vi') || a.fullName.localeCompare(b.fullName, 'vi'));

  // Theo phòng chủ trì (cùng định nghĩa phạm vi với Thống kê / KPI).
  const byDepartment = departments.map(d => {
    const own = i => S.inDepartment(i, d.id);
    return { id: d.id, name: d.name, ...groupStats(done.filter(own), rated.filter(own)) };
  }).filter(r => r.completed || r.rating.n);

  // Xu hướng theo tuần / tháng + biểu đồ kiểm soát p cho tỷ lệ đúng hạn.
  const b = buckets(from, to);
  const series = b.list.map((k, idx) => {
    const d = done.filter(i => inRange(i.completedAt, k.from, k.to));
    const judged = d.filter(hasDue), ok = judged.filter(S.onTimeDone).length;
    const work = describe(d.map(workDays));
    return { idx, label: k.label, from: k.from, to: k.to, completed: d.length, medianWorkDays: work.median, judged: judged.length, onTime: ok, onTimeRate: S.pct(ok, judged.length) };
  });
  const slope = done.length < MIN_TREND_N ? null : theilSen(series.filter(s => s.completed).map(s => [s.idx, s.medianWorkDays]));
  const trend = {
    unit: b.unit, series,
    workDaysSlope: slope == null ? null : r1(slope),
    // Ổn định nếu thay đổi < 0,5 ngày mỗi kỳ.
    direction: slope == null ? null : Math.abs(slope) < 0.5 ? 'STABLE' : slope > 0 ? 'UP' : 'DOWN',
  };
  const totalJudged = series.reduce((n, s) => n + s.judged, 0), totalOk = series.reduce((n, s) => n + s.onTime, 0);
  let control = null;
  if (totalJudged >= MIN_CONTROL) {
    const p = totalOk / totalJudged;
    control = { center: r1(p * 100), points: series.filter(s => s.judged).map(s => {
      const sigma = Math.sqrt(p * (1 - p) / s.judged);
      const lcl = Math.max(0, p - 3 * sigma), ucl = Math.min(1, p + 3 * sigma), rate = s.onTime / s.judged;
      return { label: s.label, judged: s.judged, rate: r1(rate * 100), lcl: r1(lcl * 100), ucl: r1(ucl * 100), signal: rate < lcl ? 'LOW' : rate > ucl ? 'HIGH' : null };
    }) };
  }

  // Bất thường: việc xong có thời gian làm vượt hàng rào Tukey; việc đang mở đã "tồn" lâu hơn hàng rào đó.
  const fence = upperFence(done.map(workDays));
  const names = new Map(users.map(u => [u.id, u.fullName]));
  const row = (i, days) => ({ id: i.id, projectId: i.projectId ?? null, code: code(i), title: i.title, days: r1(days), assignees: (i.assignees || []).map(a => names.get(a.userId)).filter(Boolean) });
  const outliers = fence == null ? null : {
    fence: r1(fence),
    completed: done.map(i => [i, workDays(i)]).filter(([, d]) => d != null && d > fence).sort((a, c) => c[1] - a[1]).map(([i, d]) => row(i, d)),
    open: live.filter(S.isOpen).map(i => [i, (ms(now) - ms(i.startedAt ?? i.assignedAt ?? i.createdAt)) / DAY])
      .filter(([, d]) => Number.isFinite(d) && d > fence).sort((a, c) => c[1] - a[1]).map(([i, d]) => row(i, d)),
  };

  const notes = [];
  if (overall.completed < MIN_SAMPLE) notes.push(`Chỉ có ${overall.completed} việc hoàn thành trong kỳ — chưa đủ để kết luận.`);
  if (fence == null) notes.push(`Cần ít nhất ${MIN_OUTLIER} việc hoàn thành để xác định việc kéo dài bất thường.`);
  if (trend.direction == null) notes.push(`Cần ít nhất ${MIN_TREND_N} việc hoàn thành, rải trên ${MIN_TREND} ${b.unit === 'week' ? 'tuần' : 'tháng'}, để nêu xu hướng.`);
  if (!control) notes.push(`Biểu đồ kiểm soát tỷ lệ đúng hạn cần ít nhất ${MIN_CONTROL} việc có hạn đã hoàn thành (hiện ${totalJudged}).`);

  return { from, to, overall, byPerson, byDepartment, trend, control, outliers, notes,
    thresholds: { minSample: MIN_SAMPLE, minOutlier: MIN_OUTLIER, minTrend: MIN_TREND, minTrendN: MIN_TREND_N, minControl: MIN_CONTROL } };
}

module.exports = { BANDS, BAND_OF_RATING, MIN_SAMPLE, MIN_OUTLIER, MIN_TREND, MIN_TREND_N, MIN_CONTROL,
  ratingBand, bandOfScore, quantile, describe, upperFence, theilSen, approvedAt, workDays, leadDays, rejectionsOf, groupStats, buckets, analyze };
