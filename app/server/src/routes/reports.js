// Báo cáo tuần / kỳ (Word): tổng quan theo phòng chủ trì, kết quả theo phòng và loại nhiệm vụ (Kế hoạch năm / Đột xuất),
// việc quá hạn kèm khâu, khó khăn – kiến nghị (từ báo cáo tiến độ), nhiệm vụ kỳ tới. Kỳ tối đa 93 ngày (xuất theo quý).
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType, AlignmentType, ShadingType } = require('docx');
const { fail, optionalInt } = require('../lib/http');
const { permissionScope } = require('../lib/permissions');
const { visibleProjectsWhere, itemVisibleWhere } = require('../services/access');
const { stageOf } = require('../services/stage');
const S = require('../services/stats');

const DAY = 86_400_000, H7 = 7 * 3_600_000, MAX_DAYS = 93;
const PRIORITY = { URGENT: 'Khẩn cấp', HIGH: 'Cao', MEDIUM: 'Trung bình', LOW: 'Thấp', NONE: '' };
const TYPES = [['PLAN', 'Nhiệm vụ theo Kế hoạch năm'], ['ADHOC', 'Nhiệm vụ đột xuất (theo chỉ đạo)']];
const typeOf = i => (i.taskType === 'PLAN' ? 'PLAN' : 'ADHOC');
const vnDate = S.vnDate;
function dayOf(value, fallback) {
  if (!value) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) fail(422, 'Ngày không hợp lệ (YYYY-MM-DD)', 'INVALID_DATE');
  return new Date(value + 'T00:00:00+07:00');
}
// Mặc định: tuần hiện tại (Thứ 2 → Chủ nhật, giờ Việt Nam).
function defaultWeek(now = new Date()) {
  const local = new Date(now.getTime() + H7);
  const dow = (local.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dow) - H7);
  return { from: monday, to: new Date(monday.getTime() + 6 * DAY) };
}

// Phân nhóm số liệu báo cáo (hàm thuần). items: việc trong phạm vi kèm state.category, dueDate, completedAt, taskType,
// leadDepartmentId, project{departmentId, approvalSteps?}, approvals (đang chờ), progressReports (trong kỳ).
// from: 00:00 ngày đầu kỳ; end: 00:00 ngày sau ngày cuối kỳ.
function reportData(items, { from, end, now = new Date(), departments = [] }) {
  const open = S.isOpen;
  const nextEnd = new Date(end.getTime() + Math.max(7, Math.round((end - from) / DAY)) * DAY);
  const deptName = Object.fromEntries(departments.map(d => [d.id, d.name]));
  const nameOf = id => (id == null ? 'Chưa xác định phòng' : deptName[id] || `Phòng #${id}`);
  const stage = i => stageOf({ ...i, pendingApproval: (i.approvals || [])[0] || null }, i.project?.approvalSteps || []);
  const sections = {
    done: items.filter(i => i.state.category === 'COMPLETED' && i.completedAt && i.completedAt >= from && i.completedAt < end),
    doing: items.filter(i => i.state.category === 'STARTED'),
    review: items.filter(i => i.state.category === 'REVIEW'),
    overdue: items.filter(i => S.isOverdue(i, now)).sort((a, b) => a.dueDate - b.dueDate),
    // Kỳ tới: cùng độ dài với kỳ báo cáo (tuần → tuần sau, tháng → 30 ngày sau…).
    next: items.filter(i => open(i) && i.dueDate && i.dueDate >= end && i.dueDate < nextEnd).sort((a, b) => a.dueDate - b.dueDate),
  };
  // Việc thuộc kỳ (bảng kết quả theo phòng / loại): xong trong kỳ, đang làm, chờ duyệt, quá hạn, hoặc còn mở mà đến hạn / được giao trong kỳ.
  const within = d => d != null && d >= from && d < end;
  const inPeriod = new Set([...sections.done, ...sections.doing, ...sections.review, ...sections.overdue,
    ...items.filter(i => open(i) && (within(i.dueDate) || within(i.assignedAt ?? i.createdAt)))].map(i => i.id));
  const doneIds = new Set(sections.done.map(i => i.id));
  const dueKey = i => (i.dueDate ? new Date(i.dueDate).getTime() : Number.MAX_SAFE_INTEGER);
  // Tình trạng của việc trong bảng kết quả: ngày hoàn thành (đúng / trễ hạn) hoặc khâu đang xử lý (+ quá hạn N ngày).
  const status = i => {
    if (i.state.category === 'COMPLETED') return `Hoàn thành ${vnDate(i.completedAt)}${i.dueDate ? (S.onTimeDone(i) ? ' (đúng hạn)' : ' (trễ hạn)') : ''}`;
    const late = S.isOverdue(i, now) ? ` · quá hạn ${S.vnDay(now) - S.vnDay(i.dueDate)} ngày` : '';
    return stage(i).label + late;
  };
  const ids = [...new Set(items.map(S.departmentOf))].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'vi'));
  const last = new Date(end.getTime() - 1);
  const byDepartment = ids.map(id => {
    const own = items.filter(i => S.departmentOf(i) === id);
    const m = S.metrics(own, { from, to: last, now });
    const types = TYPES.map(([type, label]) => ({ type, label, items: own.filter(i => typeOf(i) === type && inPeriod.has(i.id))
      .sort((a, b) => (doneIds.has(a.id) ? 0 : 1) - (doneIds.has(b.id) ? 0 : 1) || dueKey(a) - dueKey(b)) }));
    return { id, name: nameOf(id), done: own.filter(i => doneIds.has(i.id)).length, doing: own.filter(i => i.state.category === 'STARTED').length,
      review: own.filter(i => i.state.category === 'REVIEW').length, overdue: own.filter(i => S.isOverdue(i, now)).length, plan: m.plan, adhoc: m.adhoc, types };
  }).filter(d => d.done || d.doing || d.review || d.overdue || d.plan.total || d.adhoc.assigned || d.types.some(t => t.items.length));
  const issues = items.flatMap(i => (i.progressReports || []).filter(r => (r.difficulties || '').trim() || (r.proposals || '').trim()).map(r => ({ item: i, report: r, department: nameOf(S.departmentOf(i)) })))
    .sort((a, b) => a.department.localeCompare(b.department, 'vi') || a.report.createdAt - b.report.createdAt);
  const total = S.metrics(items, { from, to: last, now });
  return { sections, byDepartment, issues, status, stage, nameOf, nextEnd, total: { plan: total.plan, adhoc: total.adhoc } };
}

const SIZE = 20; // 10pt cho bảng
function cell(text, { bold = false, header = false, width, align } = {}) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: header ? { type: ShadingType.CLEAR, fill: 'E8EDFB', color: 'auto' } : undefined,
    children: String(text ?? '').split('\n').map(line => new Paragraph({ alignment: align, children: [new TextRun({ text: line, bold: bold || header, size: SIZE })] })),
  });
}
const table = (head, rows) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [new TableRow({ tableHeader: true, children: head.map(([t, w]) => cell(t, { header: true, width: w })) }), ...rows.map(r => new TableRow({ children: r }))],
});
const none = () => new Paragraph({ children: [new TextRun({ text: 'Không có.', italics: true, size: SIZE })] });
const para = (text, opts = {}) => new Paragraph({ spacing: { before: 120, after: 60 }, ...opts, children: [new TextRun({ text, size: 24 })] });
const heading = (text, level = HeadingLevel.HEADING_2) => new Paragraph({ heading: level, spacing: { before: 280, after: 120 }, children: [new TextRun({ text, bold: true })] });
const code = i => `${i.project.key}-${i.number}`;
const people = i => i.assignees.map(a => a.user.fullName).join(', ') || '—';
const num = n => cell(n, { align: AlignmentType.CENTER });
const frac = (a, b, r) => (b ? `${a}/${b}${r != null ? ` (${r}%)` : ''}` : '—');

async function buildWeekly(prisma, user, { projectId, departmentId, from, to }) {
  const scope = permissionScope(user, 'reports.export', 'OPERATE');
  if (!scope) fail(403, 'Bạn không có quyền xuất báo cáo', 'FORBIDDEN');
  const where = { ...visibleProjectsWhere(user), archivedAt: null };
  // Dự án MTL (Bảo mật): xuất theo quy định mtl.plan · export — báo cáo Word cũ chỉ Ban GĐ mới gồm MTL.
  if (user.role !== 'director') where.kind = { not: 'MTL' };
  if (projectId) where.id = projectId;
  const projects = await prisma.project.findMany({ where, select: { id: true, key: true, name: true, departmentId: true }, orderBy: { name: 'asc' } });
  if (projectId && !projects.length) fail(404, 'Không tìm thấy dự án trong phạm vi được xuất', 'NOT_FOUND');
  // Phạm vi UNIT: phòng của người xuất; SYSTEM: toàn tổ chức hoặc phòng được chọn. Phòng của việc = đơn vị chủ trì ?? phòng của dự án.
  const unit = scope === 'UNIT' ? (user.departmentId ?? -1) : departmentId;
  const end = new Date(to.getTime() + DAY), now = new Date();
  const items = await prisma.workItem.findMany({
    where: { archivedAt: null, projectId: { in: projects.map(p => p.id) }, AND: [itemVisibleWhere(user), ...(unit != null ? [S.departmentWhere(unit)] : [])] },
    select: { id: true, number: true, title: true, priority: true, taskType: true, leadDepartmentId: true, dispatchStatus: true, returnedAt: true,
      dueDate: true, assignedAt: true, createdAt: true, startedAt: true, completedAt: true, rating: true, ratedAt: true, projectId: true,
      project: { select: { key: true, name: true, departmentId: true } }, state: { select: { category: true, name: true } },
      assignees: { select: { user: { select: { fullName: true } } } },
      approvals: { where: { status: 'PENDING' }, select: { status: true, currentLevel: true, totalLevels: true }, take: 1 },
      progressReports: { where: { createdAt: { gte: from, lt: end }, OR: [{ difficulties: { not: '' } }, { proposals: { not: '' } }] },
        select: { id: true, createdAt: true, difficulties: true, proposals: true, answer: true, answeredAt: true, authorId: true, answeredById: true, asSupporter: true }, orderBy: { createdAt: 'asc' } } },
    orderBy: [{ projectId: 'asc' }, { number: 'asc' }],
  });
  const steps = await prisma.approvalStep.findMany({ where: { projectId: { in: [...new Set(items.map(i => i.projectId))] } }, orderBy: { level: 'asc' } });
  for (const i of items) i.project.approvalSteps = steps.filter(s => s.projectId === i.projectId);
  const deptIds = [...new Set([...items.map(S.departmentOf), unit].filter(id => id != null && id > 0))];
  const departments = await prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } });
  const personIds = [...new Set(items.flatMap(i => i.progressReports.flatMap(r => [r.authorId, r.answeredById])).filter(Boolean))];
  const names = Object.fromEntries((await prisma.user.findMany({ where: { id: { in: personIds } }, select: { id: true, fullName: true } })).map(u => [u.id, u.fullName]));

  const data = reportData(items, { from, end, now, departments });
  const { sections } = data;
  const unitName = unit != null ? (departments.find(d => d.id === unit)?.name || 'Phòng ban') : null;
  const scopeLabel = projectId ? `Dự án ${projects[0].key} · ${projects[0].name}${unitName ? ` · ${unitName}` : ''}` : unitName || 'Toàn tổ chức';
  const days = Math.round((end - from) / DAY);
  const weekly = days <= 7;
  const title = weekly ? 'BÁO CÁO CÔNG VIỆC TUẦN' : 'BÁO CÁO TÌNH HÌNH THỰC HIỆN NHIỆM VỤ';

  const overview = [
    para(`Trong kỳ: hoàn thành ${sections.done.length} việc; đang thực hiện ${sections.doing.length}; chờ duyệt ${sections.review.length}; quá hạn ${sections.overdue.length}; đến hạn ${weekly ? 'tuần tới' : 'kỳ tới'} ${sections.next.length}.`),
    para(`Kế hoạch năm: hoàn thành ${frac(data.total.plan.completed, data.total.plan.total, data.total.plan.rate)} nhiệm vụ đến hạn trong kỳ. Đột xuất: giao ${data.total.adhoc.assigned}, hoàn thành ${data.total.adhoc.completed}, đúng hạn ${data.total.adhoc.onTime}, trễ hạn ${data.total.adhoc.late}.`),
    data.byDepartment.length ? table(
      [['Phòng chủ trì', 25], ['Hoàn thành trong kỳ', 11], ['Đang thực hiện', 11], ['Chờ duyệt', 9], ['Quá hạn', 9], ['Kế hoạch năm (HT/đến hạn)', 15], ['Đột xuất (giao · HT · đúng hạn)', 20]],
      [...data.byDepartment.map(d => [cell(d.name, { bold: true }), num(d.done), num(d.doing), num(d.review), num(d.overdue), num(frac(d.plan.completed, d.plan.total, d.plan.rate)), num(`${d.adhoc.assigned} · ${d.adhoc.completed} · ${d.adhoc.onTime}`)]),
        ...(data.byDepartment.length > 1 ? [[cell('Tổng cộng', { bold: true }), num(sections.done.length), num(sections.doing.length), num(sections.review.length), num(sections.overdue.length),
          num(frac(data.total.plan.completed, data.total.plan.total, data.total.plan.rate)), num(`${data.total.adhoc.assigned} · ${data.total.adhoc.completed} · ${data.total.adhoc.onTime}`)]] : [])],
    ) : none(),
  ];
  const results = data.byDepartment.length ? data.byDepartment.flatMap((d, k) => [
    heading(`${k + 1}. ${d.name}`, HeadingLevel.HEADING_3),
    ...d.types.flatMap(({ label, items: list }, t) => [
      new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text: `${k + 1}.${t + 1}. ${label} (${list.length})`, bold: true, italics: true, size: 24 })] }),
      list.length ? table([['Mã', 10], ['Công việc', 38], ['Người chủ trì', 18], ['Hạn', 11], ['Tình trạng', 23]],
        list.map(i => [cell(code(i)), cell(i.title + (PRIORITY[i.priority] ? ` (${PRIORITY[i.priority]})` : '')), cell(people(i)), cell(vnDate(i.dueDate)), cell(data.status(i))])) : none(),
    ]),
  ]) : [none()];
  const overdue = sections.overdue.length ? [table([['Mã', 9], ['Công việc', 31], ['Phòng chủ trì', 15], ['Người chủ trì', 15], ['Hạn', 10], ['Khâu', 12], ['Quá hạn', 8]],
    sections.overdue.map(i => [cell(code(i)), cell(i.title), cell(data.nameOf(S.departmentOf(i))), cell(people(i)), cell(vnDate(i.dueDate)), cell(data.stage(i).label), num(`${S.vnDay(now) - S.vnDay(i.dueDate)} ngày`)]))] : [none()];
  const issues = data.issues.length ? [table([['Công việc', 22], ['Phòng chủ trì', 13], ['Người báo cáo', 13], ['Khó khăn', 18], ['Kiến nghị', 18], ['Ý kiến trả lời', 16]],
    data.issues.map(({ item, report: r, department }) => [cell(`${code(item)} · ${item.title}`), cell(department),
      cell(`${names[r.authorId] || '—'}${r.asSupporter ? ' (phối hợp)' : ''}\n${S.vnDateTime(r.createdAt)}`), cell(r.difficulties || '—'), cell(r.proposals || '—'),
      cell(r.answer ? `${r.answer}${r.answeredById ? `\n— ${names[r.answeredById] || ''}${r.answeredAt ? `, ${S.vnDateTime(r.answeredAt)}` : ''}` : ''}` : 'Chưa trả lời')]))] : [none()];
  const next = sections.next.length ? [table([['Mã', 10], ['Công việc', 40], ['Phòng chủ trì', 16], ['Người chủ trì', 20], ['Hạn', 14]],
    sections.next.map(i => [cell(code(i)), cell(i.title), cell(data.nameOf(S.departmentOf(i))), cell(people(i)), cell(vnDate(i.dueDate))]))] : [none()];

  const doc = new Document({
    creator: `WorkHub - ${user.username}`, title: weekly ? 'Báo cáo công việc tuần' : 'Báo cáo tình hình thực hiện nhiệm vụ',
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [{ children: [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: title, bold: true, size: 32 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${scopeLabel} · Từ ${vnDate(from)} đến ${vnDate(to)}`, size: 24 })] }),
      heading('I. Tổng quan'), ...overview,
      heading('II. Kết quả thực hiện theo phòng chủ trì'), ...results,
      heading(`III. Việc quá hạn (${sections.overdue.length})`), ...overdue,
      heading(`IV. Khó khăn – kiến nghị (${data.issues.length})`), ...issues,
      heading(`V. ${weekly ? 'Kế hoạch tuần tới' : `Nhiệm vụ kỳ tới (${vnDate(end)} – ${vnDate(new Date(data.nextEnd.getTime() - DAY))})`} (${sections.next.length})`), ...next,
      new Paragraph({ spacing: { before: 360 }, children: [new TextRun({ text: `Xuất bởi ${user.fullName} (${user.username}) lúc ${S.vnDateTime(now)} (giờ Việt Nam) từ WorkHub.`, italics: true, size: 18, color: '6B7280' })] }),
    ] }],
  });
  const counts = { ...Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.length])), issues: data.issues.length };
  return { buffer: await Packer.toBuffer(doc), counts, scopeLabel, weekly };
}

module.exports = function mountReports(app, { prisma, auth, audit }) {
  app.get('/api/reports/weekly.docx', auth, async (req, res) => {
    const week = defaultWeek();
    const from = dayOf(req.query.from, week.from), to = dayOf(req.query.to, week.to);
    if (to < from || (to - from) / DAY > MAX_DAYS - 1) fail(422, `Khoảng thời gian không hợp lệ (tối đa ${MAX_DAYS} ngày)`, 'INVALID_RANGE');
    const { buffer, counts, weekly } = await buildWeekly(prisma, req.user, { projectId: optionalInt(req.query.projectId, 'Dự án'), departmentId: optionalInt(req.query.departmentId, 'Phòng ban'), from, to });
    await audit(req, 'EXPORT_WORD', 'WeeklyReport', null, null, { from, to, projectId: req.query.projectId || null, departmentId: req.query.departmentId || null, counts });
    const iso = d => new Date(d.getTime() + H7).toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${weekly ? `Bao_cao_tuan_${iso(from)}` : `Bao_cao_${iso(from)}_${iso(to)}`}.docx"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  });
};
module.exports.defaultWeek = defaultWeek;
module.exports.reportData = reportData;
module.exports.MAX_DAYS = MAX_DAYS;
