// Thời hạn lưu trữ: ghi chú cá nhân của tài khoản đã khoá (nghỉ việc) bị xoá sau 30 ngày kể từ ngày khoá.
const NOTE_RETENTION_DAYS = 30;

async function purgeNotesOfInactiveUsers(prisma, now = new Date()) {
  const cutoff = new Date(now.getTime() - NOTE_RETENTION_DAYS * 86_400_000);
  const { count } = await prisma.personalNote.deleteMany({ where: { user: { isActive: false, deactivatedAt: { lte: cutoff } } } });
  // Chỉ ghi số lượng, không ghi nội dung ghi chú.
  if (count) console.log(JSON.stringify({ level: 'info', msg: 'retention_notes_purged', count, retentionDays: NOTE_RETENTION_DAYS }));
  return count;
}

// Kepper GĐ2b: thông báo nộp muộn / vắng giao ban giữ 12 tháng (đủ chấm điểm tuân thủ, rà soát quý / năm) rồi xoá.
const WEEKLY_NOTICE_RETENTION_DAYS = 365;
async function purgeOldWeeklyNotices(prisma, now = new Date()) {
  const cutoff = new Date(now.getTime() - WEEKLY_NOTICE_RETENTION_DAYS * 86_400_000);
  const { count } = await prisma.weeklyNotice.deleteMany({ where: { createdAt: { lt: cutoff } } });
  if (count) console.log(JSON.stringify({ level: 'info', msg: 'retention_weekly_notices_purged', count, retentionDays: WEEKLY_NOTICE_RETENTION_DAYS }));
  return count;
}

module.exports = { NOTE_RETENTION_DAYS, WEEKLY_NOTICE_RETENTION_DAYS, purgeNotesOfInactiveUsers, purgeOldWeeklyNotices };
