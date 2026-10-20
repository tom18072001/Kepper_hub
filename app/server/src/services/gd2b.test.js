// Unit test GĐ2b: mức duyệt hiệu lực (chọn tay > quy tắc > mặc định), lịch lặp ngày làm việc / cuối tháng, xoá ghi chú hết hạn.
const test = require('node:test');
const assert = require('node:assert/strict');
const { levelsForItem } = require('./approval');
const { nextOccurrence, describe } = require('./recurring');
const { purgeNotesOfInactiveUsers, NOTE_RETENTION_DAYS } = require('./retention');

const steps = [{ level: 1, name: 'Trưởng phòng' }, { level: 2, name: 'Giám đốc' }];
const fakeClient = rules => ({ approvalRule: { findMany: async () => rules }, workItem: { findUnique: async () => null } });

test('mức duyệt: chọn tay thắng quy tắc, quy tắc thắng mặc định, nhiều quy tắc lấy số cấp cao nhất', async () => {
  const project = { id: 1, defaultApprovalLevels: 1 };
  const rules = [{ id: 1, labelId: 7, priority: null, levels: 2 }, { id: 2, labelId: null, priority: 'URGENT', levels: 1 }];
  const c = fakeClient(rules);
  assert.deepEqual(await levelsForItem(c, project, steps, { approvalLevels: 0, labelIds: [7], priority: 'URGENT' }), { levels: 0, source: 'MANUAL' });
  assert.equal((await levelsForItem(c, project, steps, { approvalLevels: null, labelIds: [7], priority: 'URGENT' })).levels, 2);
  assert.equal((await levelsForItem(c, project, steps, { approvalLevels: null, labelIds: [], priority: 'URGENT' })).source, 'RULE');
  assert.deepEqual(await levelsForItem(c, project, steps, { approvalLevels: null, labelIds: [], priority: 'LOW' }), { levels: 1, source: 'DEFAULT' });
  // Không đặt mặc định → đủ các cấp; giá trị vượt số cấp bị chặn.
  assert.equal((await levelsForItem(fakeClient([]), { id: 1, defaultApprovalLevels: null }, steps, {})).levels, 2);
  assert.equal((await levelsForItem(fakeClient([]), { id: 1 }, steps, { approvalLevels: 5 })).levels, 2);
});

test('lặp lại mỗi ngày làm việc bỏ qua Thứ 7, Chủ nhật; hằng tháng hỗ trợ ngày cuối tháng', () => {
  // Thứ 6 16/10/2026 08:00 giờ VN → lần kế tiếp là Thứ 2 19/10 07:00 VN (00:00Z).
  const fri = new Date('2026-10-16T01:00:00Z');
  assert.equal(nextOccurrence({ frequency: 'DAILY', interval: 1, workdaysOnly: true }, fri).toISOString(), '2026-10-19T00:00:00.000Z');
  assert.equal(nextOccurrence({ frequency: 'DAILY', interval: 1 }, fri).toISOString(), '2026-10-17T00:00:00.000Z');
  assert.equal(nextOccurrence({ frequency: 'MONTHLY', interval: 1, monthDay: 0 }, fri).toISOString(), '2026-10-31T00:00:00.000Z');
  assert.equal(nextOccurrence({ frequency: 'MONTHLY', interval: 1, monthDay: 0 }, new Date('2027-02-01T01:00:00Z')).toISOString(), '2027-02-28T00:00:00.000Z');
  assert.equal(describe({ frequency: 'DAILY', interval: 1, workdaysOnly: true }), 'Mỗi ngày làm việc (T2–T6)');
  assert.equal(describe({ frequency: 'MONTHLY', interval: 1, monthDay: 0 }), 'Ngày cuối mỗi tháng');
});

test('thời hạn lưu: chỉ xoá ghi chú của tài khoản đã khoá quá 30 ngày', async () => {
  let where = null;
  const prisma = { personalNote: { deleteMany: async args => { where = args.where; return { count: 2 }; } } };
  const now = new Date('2026-10-16T00:00:00Z');
  assert.equal(await purgeNotesOfInactiveUsers(prisma, now), 2);
  assert.equal(NOTE_RETENTION_DAYS, 30);
  assert.equal(where.user.isActive, false);
  assert.equal(where.user.deactivatedAt.lte.toISOString(), '2026-09-16T00:00:00.000Z');
});

test('thùng rác: chỉ xoá hẳn việc/dự án đã xoá quá 7 ngày, xoá cả tệp đính kèm', async () => {
  const { purgeTrash, purgeAt, TRASH_DAYS } = require('./trash');
  const calls = [];
  const prisma = {
    project: { findMany: async args => { calls.push(['projects', args.where.deletedAt.lte.toISOString()]); return []; }, delete: async () => {} },
    workItem: {
      findMany: async args => { calls.push(['items', args.where]); return args.where.archivedAt ? [{ id: 5, attachments: [] }] : []; },
      updateMany: async () => ({}), deleteMany: async args => { calls.push(['delete', args.where.id.in]); return { count: 1 }; },
    },
    auditLog: { create: async () => ({}) },
  };
  const r = await purgeTrash(prisma, new Date('2026-10-16T00:00:00Z'));
  assert.equal(TRASH_DAYS, 7);
  assert.equal(calls[0][1], '2026-10-09T00:00:00.000Z');
  assert.equal(calls[1][1].archivedAt.lte.toISOString(), '2026-10-09T00:00:00.000Z');
  assert.deepEqual(calls.find(c => c[0] === 'delete')[1], [5]);
  assert.deepEqual(r, { projects: 0, items: 1 });
  assert.equal(purgeAt('2026-10-16T00:00:00Z').toISOString(), '2026-10-23T00:00:00.000Z');
});
