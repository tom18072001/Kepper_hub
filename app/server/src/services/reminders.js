// Nhắc việc cá nhân (ghi chú có hạn — người dùng tự tạo hoặc nhờ Claude tạo qua MCP): sáng ngày đến hạn gửi thông báo trong ứng dụng.
// Riêng tư: chỉ người tạo nhận; nội dung thông báo là tiêu đề ghi chú của chính họ.
const { notify } = require('./events');
const H7 = 7 * 3_600_000;

async function runNoteReminders(prisma, now = new Date()) {
  const vn = new Date(now.getTime() + H7);
  const start = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - H7), end = new Date(start.getTime() + 86_400_000);
  const notes = await prisma.personalNote.findMany({ where: { done: false, dueDate: { gte: start, lt: end }, user: { isActive: true } }, select: { id: true, userId: true, title: true }, take: 2000 });
  let sent = 0;
  for (const n of notes) sent += await notify(prisma, [n.userId], { type: 'NOTE_DUE', title: `Nhắc việc hôm nay: ${n.title.slice(0, 120)}`, body: null, link: '#/my' });
  return { notes: notes.length, sent };
}

module.exports = { runNoteReminders };
