// Kết quả công cụ MCP kepper_save_weekly_draft (tách riêng, không phụ thuộc thư viện, để unit test của máy chủ kiểm được).
// K4: máy chủ bỏ qua thay đổi (dòng người dùng không có quyền thêm / sửa / bỏ; trường lấy từ chính việc — tên, hạn, %, tình trạng, phần)
// → BÁO LẠI cho Claude / người dùng, không im lặng.
function draftResult(saved, missing = []) {
  return { savedAt: saved.updatedAt, missingKeys: missing, ignored: saved.ignored || 0, removed: saved.removed || 0, ...(saved.warning ? { warning: saved.warning } : {}),
    next: 'Mở Kepler Hub → Báo cáo tuần, kiểm tra và bấm "Gửi" (Claude không nộp thay).' };
}
module.exports = { draftResult };
