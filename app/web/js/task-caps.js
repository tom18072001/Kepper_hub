// Quyền của người xem trên một việc — máy chủ tính (server/src/services/task-access.js) và trả trong `capabilities` (chi tiết việc)
// hoặc `my` (từng thẻ trong danh sách). Giao diện chỉ dựng ô nhập / nút / ô tick / menu chọn khi có quyền; không có thì hiện chữ.
// Luật đổi trạng thái của người chủ trì: Chưa bắt đầu → Đang thực hiện → Gửi duyệt (Hoàn thành khi chưa duyệt = vào "Chờ duyệt").
export const WORK_FROM = ['BACKLOG', 'UNSTARTED', 'STARTED'];
export const WORK_TO = ['BACKLOG', 'UNSTARTED', 'STARTED', 'REVIEW', 'COMPLETED'];

// state: 'ALL' (người giao / Ban Tổng Giám đốc) | 'WORK' (người chủ trì) | null; submit: gửi duyệt (chỉ người chủ trì).
export function canMove(state, fromCategory, toCategory, submit = false) {
  if (!state) return false;
  if (fromCategory !== toCategory && ['REVIEW', 'COMPLETED'].includes(toCategory) && !submit) return false;
  if (state === 'ALL') return true;
  if (fromCategory === toCategory) return WORK_FROM.includes(fromCategory);
  return WORK_FROM.includes(fromCategory) && WORK_TO.includes(toCategory);
}

// Ai duyệt cấp đầu (chấm mức): việc mốc / đường găng → BTGĐ phụ trách của việc; việc thường → người giao.
// pending: phiếu đang chờ (withBoard chốt lúc gửi duyệt) — có phiếu thì theo phiếu, chưa có thì theo cờ mốc / găng của việc.
export const firstApprover = (item, pending = null) => ((pending ? pending.withBoard : (item?.critical || item?.milestone)) ? 'Ban Tổng Giám đốc' : 'người giao');

const NONE = Object.freeze({ view: 'SUMMARY', roles: [], state: null, fields: {} });
export const capsOf = d => d?.capabilities || NONE;

// Vai hiện trên panel (A, B, L, S, D, O).
export const ROLE_LABEL = { A: 'Người giao', B: 'Ban Tổng Giám đốc', L: 'Người chủ trì', S: 'Người phối hợp', D: 'Lãnh đạo bộ phận', O: 'Chủ dự án / PMO', U: 'Thành viên dự án' };
