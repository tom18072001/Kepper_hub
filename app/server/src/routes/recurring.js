// Quy tắc việc lặp lại theo dự án (quản lý dự án cấu hình).
const { fail, intParam, text, oneOf } = require('../lib/http');
const { sanitizeHtml } = require('../lib/rich-text');
const { loadProject, loadItem } = require('../services/access');
const W = require('../services/workitems');
const R = require('../services/recurring');

function ruleInput(body) {
  const frequency = oneOf(body.frequency, R.FREQUENCIES, 'Tần suất') || fail(422, 'Thiếu tần suất');
  const interval = Number(body.interval ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 12) fail(422, 'Chu kỳ lặp phải từ 1 đến 12');
  const weekday = frequency === 'WEEKLY' ? Number(body.weekday ?? 1) : null;
  if (weekday != null && !(Number.isInteger(weekday) && weekday >= 1 && weekday <= 7)) fail(422, 'Thứ trong tuần không hợp lệ');
  const monthDay = frequency === 'MONTHLY' ? Number(body.monthDay ?? 1) : null;
  if (monthDay != null && !(Number.isInteger(monthDay) && monthDay >= 0 && monthDay <= 28)) fail(422, 'Ngày trong tháng phải từ 1 đến 28 (hoặc ngày cuối tháng)');
  const dueOffsetDays = Number(body.dueOffsetDays ?? 0);
  if (!Number.isInteger(dueOffsetDays) || dueOffsetDays < 0 || dueOffsetDays > 60) fail(422, 'Số ngày đến hạn phải từ 0 đến 60');
  return {
    title: text(body.title, 'Tiêu đề', { required: true, max: 300 }), descriptionHtml: sanitizeHtml(body.descriptionHtml || ''),
    priority: oneOf(body.priority, W.PRIORITIES, 'Ưu tiên') || 'NONE', assigneeIds: W.idList(body.assigneeIds || [], 'Người nhận'), labelIds: W.idList(body.labelIds || [], 'Nhãn'),
    frequency, interval, weekday, monthDay, dueOffsetDays, workdaysOnly: frequency === 'DAILY' && !!body.workdaysOnly,
  };
}

module.exports = function mountRecurring(app, { prisma, auth, audit }) {
  app.get('/api/projects/:id/recurring', auth, async (req, res) => {
    const { project, rights, member } = await loadProject(prisma, req.user, intParam(req.params.id));
    if (project.visibility === 'ASSIGNED' && !rights.canManage && !member) return res.json([]);
    const rows = await prisma.recurringRule.findMany({ where: { projectId: project.id }, orderBy: { id: 'asc' } });
    res.json(rows.map(r => ({ ...r, schedule: R.describe(r) })));
  });

  app.post('/api/projects/:id/recurring', auth, async (req, res) => {
    const { project } = await loadProject(prisma, req.user, intParam(req.params.id), 'manage');
    const data = ruleInput(req.body || {});
    await W.activeUsers(prisma, data.assigneeIds);
    const row = await prisma.recurringRule.create({ data: { ...data, projectId: project.id, createdById: req.user.id, nextRunAt: R.nextOccurrence(data, new Date()) } });
    await audit(req, 'CREATE', 'RecurringRule', row.id, null, row);
    res.status(201).json({ ...row, schedule: R.describe(row) });
  });

  async function ruleFor(req, need) {
    const rule = await prisma.recurringRule.findUnique({ where: { id: intParam(req.params.id) } });
    if (!rule) fail(404, 'Không tìm thấy quy tắc', 'NOT_FOUND');
    await loadProject(prisma, req.user, rule.projectId, need);
    return rule;
  }
  app.patch('/api/recurring/:id', auth, async (req, res) => {
    const rule = await ruleFor(req, 'manage');
    const body = req.body || {};
    const data = {};
    // Sửa lịch / nội dung: gửi các trường cần đổi, phần còn lại giữ nguyên.
    if (['title', 'frequency', 'weekday', 'monthDay', 'dueOffsetDays', 'assigneeIds', 'labelIds', 'priority', 'workdaysOnly', 'descriptionHtml'].some(k => body[k] !== undefined)) {
      Object.assign(data, ruleInput({ ...rule, ...body }));
      if (data.assigneeIds) await W.activeUsers(prisma, data.assigneeIds);
      data.nextRunAt = R.nextOccurrence(data, new Date());
    }
    if (body.isActive !== undefined) data.isActive = !!body.isActive;
    if (data.isActive && !rule.isActive) data.nextRunAt = R.nextOccurrence({ ...rule, ...data }, new Date());
    const row = await prisma.recurringRule.update({ where: { id: rule.id }, data });
    await audit(req, 'UPDATE', 'RecurringRule', rule.id, rule, data);
    res.json({ ...row, schedule: R.describe(row) });
  });
  app.delete('/api/recurring/:id', auth, async (req, res) => {
    const rule = await ruleFor(req, 'manage');
    await prisma.recurringRule.delete({ where: { id: rule.id } });
    await audit(req, 'DELETE', 'RecurringRule', rule.id, rule, null);
    res.json({ ok: true });
  });
  // "Lặp lại việc này": tạo quy tắc từ một việc có sẵn (sao chép tiêu đề, mô tả, ưu tiên, người nhận, nhãn).
  app.post('/api/items/:id/recurring', auth, async (req, res) => {
    const id = intParam(req.params.id);
    const { project } = await loadItem(prisma, req.user, id, 'manage');
    const item = await prisma.workItem.findUnique({ where: { id }, include: { assignees: true, labels: true } });
    if (item.recurringRuleId && await prisma.recurringRule.findUnique({ where: { id: item.recurringRuleId } }))
      fail(409, 'Việc này đã có lịch lặp lại — hãy sửa lịch hiện có', 'RULE_EXISTS');
    const data = ruleInput({
      title: item.title, descriptionHtml: item.descriptionHtml, priority: item.priority,
      assigneeIds: item.assignees.map(a => a.userId), labelIds: item.labels.map(l => l.labelId), ...req.body,
    });
    await W.activeUsers(prisma, data.assigneeIds);
    const row = await prisma.$transaction(async tx => {
      const rule = await tx.recurringRule.create({ data: { ...data, projectId: project.id, createdById: req.user.id, sourceItemId: item.id, nextRunAt: R.nextOccurrence(data, new Date()) } });
      await tx.workItem.update({ where: { id: item.id }, data: { recurringRuleId: rule.id } });
      await audit(req, 'CREATE', 'RecurringRule', rule.id, null, { ...rule, fromItem: item.id }, tx);
      return rule;
    });
    res.status(201).json({ ...row, schedule: R.describe(row) });
  });

  // Tạo ngay một việc từ quy tắc (không đổi lịch chạy kế tiếp).
  app.post('/api/recurring/:id/run', auth, async (req, res) => {
    const rule = await ruleFor(req, 'manage');
    const item = await R.createFromRule(prisma, rule, req.user);
    if (!item) fail(409, 'Dự án đã lưu trữ', 'ARCHIVED');
    await audit(req, 'RECURRING_RUN', 'RecurringRule', rule.id, null, { workItemId: item.id });
    res.status(201).json({ id: item.id, number: item.number });
  });
};
