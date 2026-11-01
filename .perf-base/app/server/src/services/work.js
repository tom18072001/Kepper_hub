// Tổng thể công việc theo người / phòng trên mọi dự án: phạm vi được xem, lọc trạng thái, lọc theo chỉ số "Số liệu của tôi".
// Hàm thuần — kiểm thử được, không đụng CSDL.
const { permissionScope, isItAdmin } = require('../lib/permissions');
const { deadlineStatus } = require('./register');
const S = require('./stats');

// Phạm vi xem việc của người khác: Ban Giám đốc (SYSTEM) — mọi người, mọi phòng; lãnh đạo phòng (UNIT) — phòng mình
// và cán bộ trong phòng; còn lại (SELF) — chỉ chính mình. Admin IT không có dữ liệu nghiệp vụ (null).
function workScope(user) {
  if (!user || isItAdmin(user)) return null;
  if (permissionScope(user, 'work.view', 'VIEW') === 'SYSTEM') return 'SYSTEM';
  if (user.departmentId != null && permissionScope(user, 'work.approve', 'OPERATE') === 'UNIT') return 'UNIT';
  return 'SELF';
}
// subject: { type: 'all' } | { type: 'dept', id } | { type: 'user', id, departmentId }
function canViewSubject(user, scope, subject) {
  if (!scope || !subject) return false;
  if (scope === 'SYSTEM') return true;
  if (subject.type === 'user' && Number(subject.id) === Number(user.id)) return true;
  if (scope !== 'UNIT') return false;
  const own = Number(user.departmentId);
  return (subject.type === 'dept' && Number(subject.id) === own) || (subject.type === 'user' && Number(subject.departmentId) === own);
}

// Vai trò của một người với việc: chủ trì, phối hợp, người giao.
function rolesOf(item, userId) {
  const id = Number(userId), out = [];
  if ((item.assignees || []).some(a => Number(a.userId ?? a.user?.id ?? a.id) === id)) out.push('LEAD');
  if ((item.supporters || []).some(a => Number(a.userId ?? a.user?.id ?? a.id) === id)) out.push('SUPPORT');
  if (Number(item.assignedById) === id) out.push('ASSIGNER');
  return out;
}

const STATUSES = ['open', 'overdue', 'soon', 'done', 'all'];
// Trạng thái hạn: đang mở / quá hạn / sắp đến hạn / đã xong (huỷ chỉ hiện ở "Tất cả").
function statusOf(item, now, dueSoonDays) {
  const code = deadlineStatus(item, now, dueSoonDays).code;
  return { open: S.isOpen(item), overdue: code === 'OVERDUE', soon: code === 'DUE_SOON', done: S.isDone(item) };
}
function matchStatus(item, status, now, dueSoonDays) {
  if (status === 'all') return true;
  return !!statusOf(item, now, dueSoonDays)[status];
}

// Chỉ số của "Số liệu của tôi" → đúng tập việc đã được đếm (cùng định nghĩa với services/stats.metrics, trên việc người đó chủ trì).
const METRICS = {
  assigned: 'Được giao trong kỳ', completed: 'Hoàn thành trong kỳ', onTime: 'Đúng hạn trong kỳ', late: 'Trễ hạn trong kỳ',
  judged: 'Đã tới hạn trong kỳ', rated: 'Được xếp loại trong kỳ', overdueNow: 'Đang quá hạn',
};
function metricPredicate(metric, { from, to, now = new Date() }) {
  const f = new Date(from).getTime(), t = new Date(to).getTime();
  const within = d => d != null && new Date(d).getTime() >= f && new Date(d).getTime() <= t;
  const live = i => S.isOpen(i) || S.isDone(i);
  const judged = i => live(i) && within(i.dueDate) && (S.isDone(i) || S.vnDay(i.dueDate) < S.vnDay(now));
  switch (metric) {
    case 'assigned': return i => live(i) && within(i.assignedAt ?? i.createdAt);
    case 'completed': return i => S.isDone(i) && within(i.completedAt);
    case 'judged': return judged;
    case 'onTime': return i => judged(i) && S.onTimeDone(i);
    case 'late': return i => judged(i) && !S.onTimeDone(i);
    case 'rated': return i => S.RATING_POINTS[i.rating] != null && within(i.ratedAt ?? i.completedAt);
    case 'overdueNow': return i => S.isOverdue(i, now);
    default: return null;
  }
}

module.exports = { workScope, canViewSubject, rolesOf, STATUSES, statusOf, matchStatus, METRICS, metricPredicate };
