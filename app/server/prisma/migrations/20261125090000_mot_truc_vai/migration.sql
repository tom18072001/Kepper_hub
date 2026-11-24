-- Một hệ quy chiếu phân quyền (chủ dự án duyệt 24/11/2026, docs/de-xuat-mot-he-quy-chieu-phan-quyen.md).
-- Chỉ đổi giá trị, không xoá dữ liệu (bảng UserPermission giữ nguyên, mã mới không đọc; tạo tài khoản / đổi vai vẫn ghi để quay lại được).

-- 0) CHỐT AN TOÀN TRIỂN KHAI: từ bản này quyền suy hoàn toàn từ VAI. Tài khoản vai Ban Tổng Giám đốc (director) mà bộ quyền cũ đã bị
--    thu hẹp (thiếu "Xem công việc" phạm vi toàn tổ chức) sẽ bị NỚI ra quyền toàn công ty. Phải đổi vai tài khoản đó trên giao diện
--    Quản trị (bản cũ) TRƯỚC khi triển khai bản này; còn sót thì dừng migration.
DO $$
DECLARE n integer;
BEGIN
  SELECT COUNT(*) INTO n FROM "User" u
  WHERE u."role" = 'director' AND u."isRootAdmin" = false
    AND NOT EXISTS (SELECT 1 FROM "UserPermission" p WHERE p."userId" = u."id" AND p."permissionKey" = 'work.view' AND p."scope" = 'SYSTEM');
  IF n > 0 THEN
    RAISE EXCEPTION 'Còn % tài khoản vai Ban Tổng Giám đốc có bộ quyền đã thu hẹp (thiếu work.view toàn tổ chức). Đổi vai các tài khoản này trên màn Quản trị trước khi triển khai (docs/de-xuat-mot-he-quy-chieu-phan-quyen.md, mục 11).', n;
  END IF;
END $$;

-- 1) Vai "Phó phòng" gộp vào "Lãnh đạo bộ phận" (chức danh giữ nguyên trong displayTitle).
UPDATE "User" SET "role" = 'manager' WHERE "role" = 'deputy';
-- 2) Ba cấp duyệt Ban GĐ gộp thành một cấp "BTGĐ phụ trách" (DIRECTOR); "Người giao / PGĐ phụ trách" (SUPERVISOR) đổi sang DIRECTOR.
UPDATE "ApprovalStep" SET "approverType" = 'DIRECTOR' WHERE "approverType" = 'SUPERVISOR';
