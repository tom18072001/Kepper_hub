// Điểm khởi động WorkHub.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const { createApp, loadConfig } = require('./app');
const { notify } = require('./services/events');
const { runDue } = require('./services/recurring');
const { purgeNotesOfInactiveUsers, purgeOldWeeklyNotices, purgeOldNotifications } = require('./services/retention');
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
  // errorFormat minimal: lỗi kiểm tra đầu vào của Prisma không in lại dữ liệu (tên người, nội dung báo cáo) vào log.
  const prisma = new PrismaClient({ errorFormat: 'minimal' });
  await prisma.$connect();
  const app = createApp({ prisma, config });
  if (config.enableCron) {
    // Job hằng ngày (giờ Việt Nam) có CHẠY BÙ khi máy bật lại sau giờ chạy, trong khung giờ còn ý nghĩa; lỗi không làm dừng máy chủ.
    const A = require('./services/alerts'), WD = require('./services/weekly-data');
    const daily = [
      { name: 'mtl_alerts', at: '07:30', run: p => A.runAllAlerts(p).then(r => ({ alerts: r.reduce((n, x) => n + x.alerts, 0) })) }, // cảnh báo tiến độ MTL + ảnh chụp
      { name: 'due_soon', at: '08:00', run: p => remindDueSoon(p) },
      // Nhắc từng người cập nhật % việc trong sprint — thứ Năm, để báo cáo tuần thứ Sáu điền sẵn đúng số liệu.
      { name: 'mtl_update_reminder', at: '15:00', until: '20:00', days: [4], run: p => A.runWeeklyUpdateReminder(p) },
      // QT-TH-01: 15:00 ngày hạn nộp nhắc bộ phận chưa nộp (đến 17:30); ngày giao ban gửi tóm tắt tổng hợp (07:35–12:00).
      { name: 'weekly_reminder', at: '15:00', until: '17:30', days: [1, 2, 3, 4, 5], run: p => WD.runReportReminder(p) },
      { name: 'weekly_summary', at: '07:35', until: '12:00', days: [1, 2, 3, 4, 5], run: p => WD.runSummaryNotice(p) },
      // Thời hạn lưu: ghi chú cá nhân của người nghỉ việc quá 30 ngày; thông báo muộn / vắng quá 12 tháng; thùng rác quá 7 ngày.
      { name: 'retention_notes', at: '02:30', run: p => purgeNotesOfInactiveUsers(p).then(count => ({ count })) },
      { name: 'retention_weekly_notices', at: '02:35', run: p => purgeOldWeeklyNotices(p).then(count => ({ count })) },
      { name: 'trash_purge', at: '02:45', run: p => purgeTrash(p) },
      { name: 'retention_notifications', at: '02:50', run: p => purgeOldNotifications(p).then(count => ({ count })) },
    ];
    const jobs = require('./services/jobs').scheduler(prisma, daily);
    cron.schedule('* * * * *', () => jobs.tick(), { timezone: 'Asia/Ho_Chi_Minh' });
    jobs.tick();
    // Việc lặp lại: kiểm tra mỗi 15 phút (quy tắc chạy lúc 07:00 giờ Việt Nam).
    const runRecurring = () => runDue(prisma).catch(error => console.error(JSON.stringify({ level: 'error', msg: 'recurring_cron_failed', error: error.message })));
    cron.schedule('*/15 * * * *', runRecurring, { timezone: 'Asia/Ho_Chi_Minh' });
    runRecurring();
  }
  const server = app.listen(config.port, () => console.log(JSON.stringify({ level: 'info', msg: 'listening', port: config.port })));
  const stop = async () => { server.close(); await prisma.$disconnect().catch(() => {}); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) start().catch(crash('startup_failed'));
module.exports = { remindDueSoon };
