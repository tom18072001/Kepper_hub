// Quyền của người xem trên một việc — máy chủ tính (server/src/services/task-access.js) và trả trong `capabilities` (chi tiết việc)
// hoặc `my` (từng thẻ trong danh sách). Giao diện chỉ dựng ô nhập / nút / ô tick / menu chọn khi có quyền; không có thì hiện chữ.
// Luật đổi trạng thái của người chủ trì: Chưa bắt đầu → Đang thực hiện → Gửi duyệt (Hoàn thành khi chưa duyệt = vào "Chờ duyệt").
export const WORK_FROM = ['BACKLOG', 'UNSTARTED', 'STARTED'];
export const WORK_TO = ['BACKLOG', 'UNSTARTED', 'STARTED', 'REVIEW', 'COMPLETED'];

// state: 'ALL' (người giao / Ban Giám đốc) | 'WORK' (người chủ trì) | null.
export function canMove(state, fromCategory, toCategory) {
  if (!state) return false;
  if (state === 'ALL') return true;
  if (fromCategory === toCategory) return WORK_FROM.includes(fromCategory);
  return WORK_FROM.includes(fromCategory) && WORK_TO.includes(toCategory);
}

const NONE = Object.freeze({ view: 'SUMMARY', roles: [], state: null, fields: {} });
export const capsOf = d => d?.capabilities || NONE;

// Vai hiện trên panel (A, B, L, S, D, O).
export const ROLE_LABEL = { A: 'Người giao', B: 'Ban Giám đốc', L: 'Người chủ trì', S: 'Người phối hợp', D: 'Lãnh đạo bộ phận', O: 'Chủ dự án / PMO', U: 'Thành viên dự án' };
