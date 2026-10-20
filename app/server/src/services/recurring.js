// Việc lặp lại: tính lần chạy kế tiếp (giờ Việt Nam, 07:00) và tạo việc khi đến hạn.
const { createWorkItem } = require('./workitems');
const { projectRights } = require('./access');
const bus = require('./bus');

const H7 = 7 * 3_600_000, DAY = 86_400_000, RUN_HOUR = 7;
const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'];
const SYSTEM_ACTOR = Object.freeze({ id: null, isSystem: true, fullName: 'Hệ thống', permissions: [] });

function localParts(date) {
  const x = new Date(date.getTime() + H7);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), dow: ((x.getUTCDay() + 6) % 7) + 1 };
}
const atLocal = (y, m, d, h = RUN_HOUR) => new Date(Date.UTC(y, m, d, h) - H7);

// Lần chạy đầu tiên SAU thời điểm `after`.
function nextOccurrence(rule, after) {
  const p = localParts(after), interval = Math.max(1, rule.interval || 1);
  if (rule.frequency === 'DAILY') {
    let c = atLocal(p.y, p.m, p.d);
    const weekend = d => [6, 7].includes(localParts(d).dow);
    while (c <= after || (rule.workdaysOnly && weekend(c))) c = new Date(c.getTime() + (c <= after ? interval : 1) * DAY);
    return c;
  }
  if (rule.frequency === 'WEEKLY') {
    const target = rule.weekday || 1;
    let c = new Date(atLocal(p.y, p.m, p.d).getTime() + ((target - p.dow + 7) % 7) * DAY);
    while (c <= after) c = new Date(c.getTime() + 7 * interval * DAY);
    return c;
  }
  // monthDay = 0: ngày cuối tháng.
  const last = rule.monthDay === 0;
  const day = last ? 0 : Math.min(Math.max(rule.monthDay || 1, 1), 28);
  const at = m => last ? atLocal(p.y, m + 1, 0) : atLocal(p.y, m, day);
  let m = p.m, c = at(m);
  while (c <= after) { m += interval; c = at(m); }
  return c;
}
function describe(rule) {
  const every = rule.interval > 1 ? `${rule.interval} ` : '';
  if (rule.frequency === 'DAILY') return `Mỗi ${every}ngày${rule.workdaysOnly ? ' làm việc (T2–T6)' : ''}`;
  if (rule.frequency === 'WEEKLY') return `Mỗi ${every}tuần vào ${['', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'][rule.weekday || 1]}`;
  return rule.monthDay === 0 ? `Ngày cuối mỗi ${every}tháng` : `Ngày ${rule.monthDay || 1} mỗi ${every}tháng`;
}

// Tạo một việc từ quy tắc (người tạo = người lập quy tắc, hoặc người bấm "Chạy ngay").
async function createFromRule(prisma, rule, actor, runAt = new Date()) {
  const project = await prisma.project.findUnique({ where: { id: rule.projectId } });
  if (!project || project.archivedAt || project.deletedAt) return null;
  const member = actor.id ? await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: project.id, userId: actor.id } } }) : null;
  let rights = actor.isSystem ? { canEdit: true, canManage: false } : projectRights(actor, project, member);
  // Người lập quy tắc đã mất quyền trong dự án: hệ thống vẫn tạo việc theo lịch, không gắn tên người đó.
  if (!rights.canEdit) { actor = SYSTEM_ACTOR; rights = { canEdit: true, canManage: false }; }
  // Bỏ nhãn đã bị xoá / không còn thuộc dự án thay vì làm hỏng lượt tạo việc.
  const labelIds = rule.labelIds.length ? (await prisma.label.findMany({ where: { id: { in: rule.labelIds }, OR: [{ projectId: null }, { projectId: project.id }] }, select: { id: true } })).map(l => l.id) : [];
  const p = localParts(runAt);
  const start = atLocal(p.y, p.m, p.d, 0);
  const item = await prisma.$transaction(tx => createWorkItem(tx, {
    project, user: actor, rights, source: 'RECURRING', strictAssignees: false,
    input: { title: rule.title, descriptionHtml: rule.descriptionHtml, priority: rule.priority, assigneeIds: rule.assigneeIds, labelIds,
      startDate: start, dueDate: new Date(start.getTime() + rule.dueOffsetDays * DAY), recurringRuleId: rule.id },
  }));
  bus.item(project.id, item.id, actor.id);
  return item;
}

// Chạy các quy tắc đến hạn; mỗi quy tắc chỉ tạo một việc mỗi lượt dù đã trễ nhiều kỳ.
async function runDue(prisma, now = new Date()) {
  const rules = await prisma.recurringRule.findMany({ where: { isActive: true, nextRunAt: { lte: now } } });
  let created = 0;
  for (const rule of rules) {
    try {
      const actor = (rule.createdById && await prisma.user.findFirst({ where: { id: rule.createdById, isActive: true }, include: { permissions: true } })) || SYSTEM_ACTOR;
      if (await createFromRule(prisma, rule, actor, now)) created++;
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', msg: 'recurring_failed', ruleId: rule.id, error: error.message }));
    }
    await prisma.recurringRule.update({ where: { id: rule.id }, data: { lastRunAt: now, nextRunAt: nextOccurrence(rule, now) } });
  }
  return created;
}

module.exports = { FREQUENCIES, nextOccurrence, describe, createFromRule, runDue, localParts };
