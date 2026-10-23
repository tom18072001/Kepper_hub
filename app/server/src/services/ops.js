// Giám sát vận hành tối thiểu cho máy chạy đơn lẻ: báo quản trị IT khi sao lưu quá hạn / lỗi hoặc một job lịch chạy lỗi.
// Chỉ thông tin hệ thống (giờ, tên job, mã lỗi) — không có dữ liệu nghiệp vụ, đúng QĐ-01 (IT không xem nội dung nghiệp vụ).
const { notify } = require('./events');
const { KEY: JOBS_KEY } = require('./jobs');

const BACKUP_KEY = 'backup.status';
const STALE_HOURS = 36; // sao lưu hằng ngày + chạy bù: quá 36 giờ chưa có bản đạt là bất thường

function opsProblems({ backup, ledger, now, demoActive = [] }) {
  const out = [];
  const lastOk = backup?.lastOk ? new Date(backup.lastOk) : null;
  if (!lastOk) out.push('Chưa ghi nhận bản sao lưu nào đạt.');
  else if (now - lastOk > STALE_HOURS * 3_600_000) out.push(`Bản sao lưu đạt gần nhất cách đây ${Math.floor((now - lastOk) / 3_600_000)} giờ.`);
  if (backup?.lastFailAt && (!lastOk || new Date(backup.lastFailAt) > lastOk)) out.push(`Lần sao lưu gần nhất lỗi: ${String(backup.error || '').slice(0, 80)}.`);
  if (lastOk && backup.encrypted === false) out.push('Bản sao lưu chưa mã hoá (đặt BACKUP_AGE_RECIPIENT).');
  if (lastOk && backup.copied === false) out.push('Chưa có bản sao lưu ngoài máy (đặt BACKUP_COPY / BACKUP_COPY_PATH).');
  if (lastOk && (!backup.restoreTestOk || now - new Date(backup.restoreTestOk) > 100 * 86_400_000)) out.push('Chưa thử khôi phục trong 3 tháng qua (RESTORE_TEST=1, xem deploy/restore.sh).');
  const failed = Object.entries(ledger || {}).filter(([, v]) => v && v.ok === false && now - new Date(v.at) < 2 * 86_400_000).map(([k]) => k);
  if (failed.length) out.push(`Job lịch chạy lỗi: ${failed.join(', ')}.`);
  if (demoActive.length) out.push(`Tài khoản mẫu (mật khẩu công khai trong README) còn hoạt động: ${demoActive.slice(0, 8).join(', ')} — khoá trước khi dùng với dữ liệu thật.`);
  const stuck = Object.entries(ledger || {}).filter(([, v]) => v?.running && now - new Date(v.at) > 3_600_000).map(([k]) => k);
  if (stuck.length) out.push(`Job dừng giữa chừng (tiến trình tắt khi đang chạy): ${stuck.join(', ')}.`);
  return out;
}

async function runOpsCheck(prisma, now = new Date()) {
  const [b, l] = await Promise.all([prisma.appSetting.findUnique({ where: { key: BACKUP_KEY } }), prisma.appSetting.findUnique({ where: { key: JOBS_KEY } })]);
  const demoActive = (await prisma.user.findMany({ where: { isActive: true, username: { in: require('../seed').DEMO_USERNAMES } }, select: { username: true } })).map(u => u.username);
  const problems = opsProblems({ backup: b?.value, ledger: l?.value, now, demoActive });
  // Chỉ báo khi có vấn đề thật (sao lưu / job lỗi); hai nhắc cấu hình (mã hoá, ngoài máy) gửi kèm khi đã có vấn đề khác hoặc vào thứ Hai.
  const serious = problems.filter(p => !/chưa mã hoá|ngoài máy|thử khôi phục|Tài khoản mẫu/.test(p));
  if (!serious.length && new Date(now.getTime() + 7 * 3_600_000).getUTCDay() !== 1) return { problems: problems.length, notified: 0 };
  if (!problems.length) return { problems: 0, notified: 0 };
  const admins = await prisma.user.findMany({ where: { isActive: true, OR: [{ isRootAdmin: true }, { role: 'admin' }] }, select: { id: true } });
  const notified = await notify(prisma, admins.map(a => a.id), { type: 'SYSTEM_OPS', title: 'Kiểm tra vận hành Kepper Hub', body: problems.join(' '), link: '#/admin/audit' });
  return { problems: problems.length, notified };
}

module.exports = { BACKUP_KEY, STALE_HOURS, opsProblems, runOpsCheck };
