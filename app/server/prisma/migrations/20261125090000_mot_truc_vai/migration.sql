-- Một hệ quy chiếu phân quyền (chủ dự án duyệt 24/11/2026, docs/de-xuat-mot-he-quy-chieu-phan-quyen.md).
-- Chỉ đổi giá trị, không xoá dữ liệu (bảng UserPermission giữ nguyên, mã không đọc nữa).
-- 1) Vai "Phó phòng" gộp vào "Lãnh đạo bộ phận" (chức danh giữ nguyên trong displayTitle).
UPDATE "User" SET "role" = 'manager' WHERE "role" = 'deputy';
-- 2) Ba cấp duyệt Ban GĐ gộp thành một cấp "BTGĐ phụ trách" (DIRECTOR); "Người giao / PGĐ phụ trách" (SUPERVISOR) đổi sang DIRECTOR.
UPDATE "ApprovalStep" SET "approverType" = 'DIRECTOR' WHERE "approverType" = 'SUPERVISOR';
