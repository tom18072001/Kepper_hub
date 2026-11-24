// Kiêm nhiệm (Ban Tổng Giám đốc chỉ định trong từng mảng) — MỘT nơi tính, dùng cho hồ sơ cá nhân và màn Quản trị → Tài khoản.
// Thư ký giao ban theo BỘ PHẬN (Q5), các kiêm nhiệm khác theo người. Chỉ trả tên kiêm nhiệm, không trả nội dung nghiệp vụ.
const { isBoard } = require('../lib/permissions');

async function dutyConfig(prisma) {
  const safe = async fn => { try { return await fn(); } catch { return null; } };
  const [w, h, v] = await Promise.all([
    safe(() => require('./weekly-data').weeklyConfig(prisma)),
    safe(() => require('./hrm').hrmConfig(prisma)),
    safe(() => require('./vanthu').vanthuConfig(prisma)),
  ]);
  return { secretaryDepartmentId: w?.secretaryDepartmentId ?? null, pmo: w?.pmoUserIds || [], hr: h?.hrUserIds || [], clerk: v?.clerkUserIds || [], legal: v?.legalUserIds || [] };
}
// Hàm thuần: kiêm nhiệm của một tài khoản theo cấu hình đã nạp.
function dutiesFor(user, cfg) {
  if (!user || !cfg) return [];
  const out = [];
  if (cfg.secretaryDepartmentId != null && cfg.secretaryDepartmentId === user.departmentId && !isBoard(user)) out.push('Thư ký giao ban');
  if (cfg.pmo.includes(user.id)) out.push('PMO');
  if (cfg.hr.includes(user.id)) out.push('Phụ trách nhân sự');
  if (cfg.clerk.includes(user.id)) out.push('Văn thư');
  if (cfg.legal.includes(user.id)) out.push('Pháp chế');
  return out;
}
module.exports = { dutyConfig, dutiesFor };
