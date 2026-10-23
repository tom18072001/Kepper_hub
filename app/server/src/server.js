// Điểm khởi động WorkHub.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const { createApp, loadConfig } = require('./app');
const { notify } = require('./services/events');
const { runDue } = require('./services/recurring');
const { purgeNotesOfInactiveUsers, purgeOldWeeklyNotices } = require('./services/retention');
const { purgeTrash } = require('./services/trash');

// Lỗi không bắt được: ghi log rồi thoát để Docker/PM khởi động lại tiến trình sạch.
function crash(kind) {
  return error => {
    console.error(JSON.stringify({ level: 'fatal', msg: kind, error: error && error.message, stack: error && error.stack }));
    process.exit(1);
  };
}
process.on('unhandledRejection', crash('unhandledRejection'));
process.on('uncaughtException', crash('uncaughtException'));

// Nhắc việc sắp đến hạn (24 giờ tới) cho người nhận, mỗi ngày 8:00 giờ Việt Nam.
async function remindDueSoon(prisma, now = new Date()) {
  const soon = new Date(now.getTime() + 24 * 3600 * 1000);
  const items = await prisma.workItem.findMany({
    where: { archivedAt: null, dueDate: { gte: now, lt: soon }, state: { category: { notIn: ['COMPLETED', 'CANCELLED'] } } },
    include: { project: true, assignees: true },
  });
  let sent = 0;
  for (const i of items) sent += await notify(prisma, i.assignees.map(a => a.userId), {
    type: 'DUE_SOON', title: `${i.project.key}-${i.number} đến hạn trong 24 giờ`, body: i.title, link: `#/projects/${i.projectId}?item=${i.id}`,
  });
  return sent;
}

async function start() {
  const config = loadConfig();
  const prisma = new PrismaClient();
  await prisma.$connect();
  const app = createApp({ prisma, config });
  if (config.enableCron) {
    cron.schedule('0 8 * * *', () => remindDueSoon(prisma).catch(crash('cron_failed')), { timezone: 'Asia/Ho_Chi_Minh' });
    // Kepper: cảnh báo tiến độ Master Timeline + ảnh chụp tiến độ, 07:30 hằng ngày giờ Việt Nam.
    cron.schedule('30 7 * * *', () => require('./services/alerts').runAllAlerts(prisma).then(r => console.log(JSON.stringify({ level: 'info', msg: 'mtl_alerts', alerts: r.reduce((n, x) => n + x.alerts, 0) })))
      .catch(error => console.error(JSON.stringify({ level: 'error', msg: 'mtl_alerts_failed', error: error.message }))), { timezone: 'Asia/Ho_Chi_Minh' });
    // Kepper: nhắc từng người cập nhật % việc trong sprint, 15:00 thứ Năm — để báo cáo tuần thứ Sáu điền sẵn đúng số liệu.
    cron.schedule('0 15 * * 4', () => require('./services/alerts').runWeeklyUpdateReminder(prisma).then(r => console.log(JSON.stringify({ level: 'info', msg: 'mtl_update_reminder', ...r })))
      .catch(error => console.error(JSON.stringify({ level: 'error', msg: 'mtl_update_reminder_failed', error: error.message }))), { timezone: 'Asia/Ho_Chi_Minh' });
    // Kepper GĐ2b (QT-TH-01): 15:00 ngày hạn nộp — nhắc bộ phận chưa nộp báo cáo tuần; 07:35 ngày giao ban — gửi tóm tắt tổng hợp.
    const WD = require('./services/weekly-data');
    const logJob = name => r => console.log(JSON.stringify({ level: 'info', msg: name, ...r }));
    const failJob = name => error => console.error(JSON.stringify({ level: 'error', msg: name + '_failed', error: error.message }));
    cron.schedule('0 15 * * 1-5', () => WD.runReportReminder(prisma).then(logJob('weekly_reminder')).catch(failJob('weekly_reminder')), { timezone: 'Asia/Ho_Chi_Minh' });
    cron.schedule('35 7 * * 1-5', () => WD.runSummaryNotice(prisma).then(logJob('weekly_summary')).catch(failJob('weekly_summary')), { timezone: 'Asia/Ho_Chi_Minh' });
    // Việc lặp lại: kiểm tra mỗi 15 phút (quy tắc chạy lúc 07:00 giờ Việt Nam).
    const runRecurring = () => runDue(prisma).catch(error => console.error(JSON.stringify({ level: 'error', msg: 'recurring_cron_failed', error: error.message })));
    cron.schedule('*/15 * * * *', runRecurring, { timezone: 'Asia/Ho_Chi_Minh' });
    runRecurring();
    // Thời hạn lưu: xoá ghi chú cá nhân của người đã nghỉ việc quá 30 ngày (02:30 hằng ngày).
    // Thùng rác: xoá hẳn việc / dự án đã xoá quá 7 ngày (02:45 hằng ngày).
    cron.schedule('45 2 * * *', () => purgeTrash(prisma).catch(error => console.error(JSON.stringify({ level: 'error', msg: 'trash_purge_failed', error: error.message }))), { timezone: 'Asia/Ho_Chi_Minh' });
    cron.schedule('35 2 * * *', () => purgeOldWeeklyNotices(prisma).catch(error => console.error(JSON.stringify({ level: 'error', msg: 'retention_failed', error: error.message }))), { timezone: 'Asia/Ho_Chi_Minh' });
    cron.schedule('30 2 * * *', () => purgeNotesOfInactiveUsers(prisma).catch(error => console.error(JSON.stringify({ level: 'error', msg: 'retention_failed', error: error.message }))), { timezone: 'Asia/Ho_Chi_Minh' });
  }
  const server = app.listen(config.port, () => console.log(JSON.stringify({ level: 'info', msg: 'listening', port: config.port })));
  const stop = async () => { server.close(); await prisma.$disconnect().catch(() => {}); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) start().catch(crash('startup_failed'));
module.exports = { remindDueSoon };
