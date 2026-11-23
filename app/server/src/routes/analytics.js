// KPI & phân tích thống kê công việc (services/analytics.js) — chỉ Ban giám đốc (quyền reports.kpi phạm vi toàn tổ chức).
// Nhân viên, trưởng / phó phòng, admin IT (QĐ 16/10/2026: không xem nội dung nghiệp vụ): 403.
// Dữ liệu "Bảo mật" (đánh giá cá nhân — kpi.person): mỗi lần xem / xuất ghi nhật ký; tệp Excel có dấu người xuất; không xuất qua token Claude.
const ExcelJS = require('exceljs');
const { fail, optionalInt, optionalDate } = require('../lib/http');
const { permissionScope } = require('../lib/permissions');
const { visibleProjectsWhere, itemVisibleWhere } = require('../services/access');
const S = require('../services/stats');
const A = require('../services/analytics');
const { RATINGS } = require('../services/task-rules');

function assertAnalyticsAccess(user) {
  if (permissionScope(user, 'reports.kpi', 'VIEW') !== 'SYSTEM') fail(403, 'Chỉ Ban giám đốc được xem KPI và phân tích thống kê', 'FORBIDDEN');
}

function rangeOf(query, now) {
  const def = S.vnPeriod(now, 'quarter');
  const day = (value, label) => (value ? S.vnDayStart(value) || optionalDate(value, label) : null);
  const from = day(query.from, 'Từ ngày') || def.from;
  const to = query.to ? S.endOfLocalDay(day(query.to, 'Đến ngày')) : def.to;
  if (to < from || to - from > 400 * S.DAY) fail(422, 'Khoảng thời gian không hợp lệ (tối đa ~13 tháng)');
  return { from, to };
}

async function load(prisma, user, query) {
  const now = new Date();
  const { from, to } = rangeOf(query, now);
  const departmentId = optionalInt(query.departmentId, 'Phòng ban');
  const range = { gte: from, lte: to };
  let items = await prisma.workItem.findMany({
    where: { archivedAt: null, project: { archivedAt: null, deletedAt: null },
      AND: [{ project: visibleProjectsWhere(user) }, itemVisibleWhere(user),
        { OR: [{ completedAt: range }, { ratedAt: range }, { state: { category: { notIn: ['COMPLETED', 'CANCELLED'] } } }] }] },
    select: { id: true, projectId: true, number: true, title: true, leadDepartmentId: true, dueDate: true, assignedAt: true, createdAt: true, startedAt: true, completedAt: true,
      rating: true, ratedAt: true, state: { select: { category: true } }, project: { select: { key: true, name: true, departmentId: true } },
      assignees: { select: { userId: true } },
      approvals: { select: { status: true, closedAt: true, actions: { select: { decision: true } } } } },
  });
  if (departmentId) items = items.filter(i => S.inDepartment(i, departmentId));
  const userIds = [...new Set(items.flatMap(i => i.assignees.map(a => a.userId)))];
  const users = (await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, department: { select: { id: true, name: true } } } }))
    .map(u => ({ id: u.id, fullName: u.fullName, departmentId: u.department?.id ?? null, departmentName: u.department?.name || '—' }));
  const departments = await prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const result = A.analyze(items, { users, departments, from, to, now });
  if (departmentId) result.byDepartment = result.byDepartment.filter(d => d.id === departmentId);
  return { ...result, departmentId: departmentId ?? null, generatedAt: now };
}

// ---------- Tệp Excel ----------
const BAND = b => (b ? A.BANDS[b] : '');
const num = v => (v == null ? '' : v);
function personRows(list) {
  return list.map(p => ({ dept: p.department ?? p.name, name: p.fullName ?? '', completed: p.completed,
    workMedian: num(p.workDays.median), workMean: num(p.workDays.mean), workIqr: num(p.workDays.iqr), workN: p.workDays.n,
    leadMedian: num(p.leadDays.median), leadMean: num(p.leadDays.mean),
    onTime: num(p.onTime.rate), judged: p.onTime.judged, rejections: p.rejections,
    rated: p.rating.n, good: p.rating.bands.GOOD, avg: p.rating.bands.AVERAGE, poor: p.rating.bands.POOR, score: p.rating.median == null ? '—' : p.rating.median, scoreMean: p.rating.mean == null ? '—' : p.rating.mean, band: BAND(p.rating.band) || '—',
    note: [p.workDays.n < A.MIN_SAMPLE ? 'Mẫu nhỏ — chưa đủ để kết luận' : '', p.rating.n < A.MIN_SAMPLE ? `Dưới ${A.MIN_SAMPLE} việc được chấm — chưa đánh giá chung` : '',
      p.noStart ? `${p.noStart} việc không ghi lúc bắt đầu` : ''].filter(Boolean).join('; ') }));
}
const GROUP_COLUMNS = [
  { header: 'Số việc xong', key: 'completed', width: 12 },
  { header: 'Thời gian làm — TB (ngày)', key: 'workMean', width: 14 }, { header: 'Thời gian làm — trung vị (ngày)', key: 'workMedian', width: 16 },
  { header: 'Thời gian làm — IQR (ngày)', key: 'workIqr', width: 14 }, { header: 'Số việc tính thời gian làm', key: 'workN', width: 14 },
  { header: 'Giao → được duyệt — TB (ngày)', key: 'leadMean', width: 16 }, { header: 'Giao → được duyệt — trung vị (ngày)', key: 'leadMedian', width: 18 },
  { header: 'Đúng hạn (%)', key: 'onTime', width: 11 }, { header: 'Số việc có hạn', key: 'judged', width: 11 }, { header: 'Lần bị trả lại', key: 'rejections', width: 11 },
  { header: 'Số việc được chấm', key: 'rated', width: 12 }, { header: 'Tốt', key: 'good', width: 7 }, { header: 'Trung bình', key: 'avg', width: 10 }, { header: 'Kém', key: 'poor', width: 7 },
  { header: 'Điểm trung vị (0–100)', key: 'score', width: 12 }, { header: 'Điểm bình quân (tham khảo, không dùng kết luận)', key: 'scoreMean', width: 16 }, { header: 'Đánh giá chung', key: 'band', width: 14 }, { header: 'Ghi chú', key: 'note', width: 30 },
];
function sheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { wrapText: true, vertical: 'top' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  rows.forEach(r => ws.addRow(r));
  return ws;
}
async function workbook(r, user) {
  const wb = new ExcelJS.Workbook();
  wb.creator = `Kepler Hub - ${user.username}`;
  wb.created = r.generatedAt;
  const range = `${S.vnDate(r.from)} – ${S.vnDate(r.to)}`;
  const o = r.overall;
  const sum = sheet(wb, 'Tóm tắt', [{ header: 'Chỉ số', key: 'k', width: 46 }, { header: 'Giá trị', key: 'v', width: 60 }], [
    { k: 'Kỳ', v: range }, { k: 'Nhãn dữ liệu', v: 'Bảo mật — đánh giá cá nhân; không gửi ra ngoài hệ thống' },
    { k: 'Số việc hoàn thành trong kỳ', v: o.completed },
    { k: 'Thời gian làm (bắt đầu → xong): TB / trung vị / Q1 – Q3 (ngày)', v: o.workDays.n ? `${o.workDays.mean} / ${o.workDays.median} / ${o.workDays.q1} – ${o.workDays.q3} (n = ${o.workDays.n})` : '—' },
    { k: 'Giao → được duyệt: TB / trung vị (ngày)', v: o.leadDays.n ? `${o.leadDays.mean} / ${o.leadDays.median} (n = ${o.leadDays.n})` : '—' },
    { k: 'Tỷ lệ xong đúng hạn', v: o.onTime.rate == null ? '—' : `${o.onTime.rate}% (${o.onTime.onTime}/${o.onTime.judged})` },
    { k: 'Đánh giá sau duyệt (Tốt / Trung bình / Kém)', v: `${o.rating.bands.GOOD} / ${o.rating.bands.AVERAGE} / ${o.rating.bands.POOR} — ${o.rating.band ? `điểm trung vị ${o.rating.median} → ${BAND(o.rating.band)} (bình quân tham khảo ${o.rating.mean})` : `chưa đánh giá chung (dưới ${A.MIN_SAMPLE} việc được chấm)`}` },
    { k: 'Xu hướng thời gian làm', v: r.trend.direction == null ? 'Chưa đủ dữ liệu' : `${{ UP: 'Tăng', DOWN: 'Giảm', STABLE: 'Ổn định' }[r.trend.direction]} (${r.trend.workDaysSlope} ngày mỗi ${r.trend.unit === 'week' ? 'tuần' : 'tháng'}, Theil–Sen)` },
    { k: 'Ngưỡng kéo dài bất thường (Q3 + 1,5 × IQR)', v: r.outliers ? `${r.outliers.fence} ngày` : 'Chưa đủ dữ liệu' },
    {}, { k: 'Phương pháp', v: 'Trung vị, tứ phân vị (PERCENTILE.INC); bất thường theo Tukey; xu hướng theo độ dốc Theil–Sen; kiểm soát tỷ lệ đúng hạn bằng biểu đồ p (±3σ).' },
    { k: 'Mức đánh giá', v: 'Xuất sắc + Tốt = Tốt; Đạt = Trung bình; Cần cải thiện + Kém = Kém. Điểm 100/85/70/50/0; đánh giá chung theo TRUNG VỊ điểm: ≥ 80 Tốt, ≥ 60 Trung bình, còn lại Kém; chỉ khi có ít nhất 5 việc được chấm. Điểm bình quân chỉ để tham khảo.' },
    { k: 'Lưu ý', v: 'Số liệu tham khảo, không xếp hạng và không gắn lương thưởng. Nhóm dưới 5 việc: chưa đủ để kết luận.' },
    ...r.notes.map(n => ({ k: 'Ghi chú dữ liệu', v: n })),
  ]);
  sum.getColumn('v').alignment = { wrapText: true, vertical: 'top' };
  sheet(wb, 'Theo người', [{ header: 'Phòng', key: 'dept', width: 22 }, { header: 'Họ tên', key: 'name', width: 24 }, ...GROUP_COLUMNS], personRows(r.byPerson));
  sheet(wb, 'Theo phòng', [{ header: 'Phòng chủ trì', key: 'dept', width: 26 }, ...GROUP_COLUMNS], personRows(r.byDepartment.map(d => ({ ...d, department: d.name }))));
  sheet(wb, 'Xu hướng', [{ header: 'Kỳ', key: 'label', width: 16 }, { header: 'Số việc xong', key: 'completed', width: 12 }, { header: 'Thời gian làm — trung vị (ngày)', key: 'median', width: 18 },
    { header: 'Đúng hạn (%)', key: 'rate', width: 12 }, { header: 'Số việc có hạn', key: 'judged', width: 12 }, { header: 'Giới hạn dưới (%)', key: 'lcl', width: 12 }, { header: 'Giới hạn trên (%)', key: 'ucl', width: 12 }, { header: 'Tín hiệu', key: 'signal', width: 16 }],
    r.trend.series.map(s => { const c = r.control?.points.find(p => p.label === s.label);
      return { label: s.label, completed: s.completed, median: num(s.medianWorkDays), rate: num(s.onTimeRate), judged: s.judged, lcl: num(c?.lcl), ucl: num(c?.ucl),
        signal: c?.signal === 'LOW' ? 'Thấp bất thường' : c?.signal === 'HIGH' ? 'Cao bất thường' : '' }; }));
  sheet(wb, 'Bất thường', [{ header: 'Loại', key: 'kind', width: 16 }, { header: 'Mã', key: 'code', width: 12 }, { header: 'Tiêu đề', key: 'title', width: 50 }, { header: 'Số ngày', key: 'days', width: 10 }, { header: 'Người chủ trì', key: 'who', width: 30 }],
    r.outliers ? [...r.outliers.completed.map(x => ({ kind: 'Đã xong', ...x })), ...r.outliers.open.map(x => ({ kind: 'Đang mở', ...x }))].map(x => ({ kind: x.kind, code: x.code, title: x.title, days: x.days, who: x.assignees.join(', ') })) : []);
  // Chi tiết từng việc: mọi ô văn bản ghi dạng chuỗi (không công thức), ngày ghi dạng chuỗi dd/mm/yyyy giờ VN.
  const txt = x => (x == null ? '' : String(x));
  sheet(wb, 'Chi tiết việc', [{ header: 'Mã', key: 'code', width: 10 }, { header: 'Tiêu đề', key: 'title', width: 44 }, { header: 'Dự án', key: 'project', width: 22 },
    { header: 'Phòng chủ trì', key: 'dept', width: 20 }, { header: 'Người làm', key: 'who', width: 26 }, { header: 'Ngày giao', key: 'a', width: 12 }, { header: 'Bắt đầu', key: 's', width: 12 },
    { header: 'Hoàn thành', key: 'c', width: 12 }, { header: 'Được duyệt', key: 'p', width: 12 }, { header: 'Thời gian làm (ngày)', key: 'work', width: 12 },
    { header: 'Giao → duyệt (ngày)', key: 'lead', width: 12 }, { header: 'Đúng hạn', key: 'onTime', width: 13 }, { header: 'Lần bị trả lại', key: 'rej', width: 10 }, { header: 'Mức chấm', key: 'rating', width: 14 }],
    r.details.map(d => ({ code: txt(d.code), title: txt(d.title), project: txt(d.project), dept: txt(d.department), who: txt(d.assignees.join(', ')),
      a: S.vnDate(d.assignedAt), s: d.startedAt ? S.vnDate(d.startedAt) : 'không ghi nhận', c: S.vnDate(d.completedAt), p: S.vnDate(d.approvedAt),
      work: num(d.workDays), lead: num(d.leadDays), onTime: d.onTime == null ? 'Không có hạn' : d.onTime ? 'Có' : 'Không', rej: d.rejections,
      rating: d.rating ? `${RATINGS[d.rating]} (${A.BANDS[A.ratingBand(d.rating)]})` : '' })));
  // Dấu vết người xuất (truy vết khi dữ liệu rời hệ thống).
  for (const ws of wb.worksheets) { ws.addRow([]); ws.addRow([`Xuất bởi ${user.fullName || user.username} lúc ${S.vnDateTime(r.generatedAt)} — Bảo mật, chỉ dùng nội bộ`]).font = { italic: true, color: { argb: 'FF888888' } }; }
  return wb;
}

function mountAnalytics(app, { prisma, auth, audit }) {
  app.get('/api/kpi/analytics', auth, async (req, res) => {
    assertAnalyticsAccess(req.user);
    const r = await load(prisma, req.user, req.query);
    await audit(req, 'VIEW_KPI_ANALYTICS', 'Kpi', null, null, { from: r.from, to: r.to, departmentId: r.departmentId, people: r.byPerson.length });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(r);
  });

  app.get('/api/kpi/analytics.xlsx', auth, async (req, res) => {
    assertAnalyticsAccess(req.user);
    require('../lib/tokens').assertNotVia(req); // kpi.person không rời hệ thống qua AI / token
    const r = await load(prisma, req.user, req.query);
    const wb = await workbook(r, req.user);
    await audit(req, 'EXPORT_KPI_ANALYTICS', 'Kpi', null, null, { from: r.from, to: r.to, departmentId: r.departmentId, people: r.byPerson.length });
    const day = d => new Date(d.getTime() + S.H7).toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="phan-tich-kpi_${day(r.from)}_${day(r.to)}.xlsx"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  });
}

module.exports = mountAnalytics;
module.exports.assertAnalyticsAccess = assertAnalyticsAccess;
module.exports.workbook = workbook;
module.exports.rangeOf = rangeOf;
