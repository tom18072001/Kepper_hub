-- Việc MỐC hoặc trên ĐƯỜNG GĂNG (chủ dự án chốt 20/11/2026): khi gửi duyệt hoàn thành, cấp 1 của phiếu là Ban Giám đốc của việc
-- (Ban Giám đốc toàn quyền + PGĐ phụ trách bộ phận chủ trì) duyệt và chấm mức, thay người giao. Chốt trên phiếu lúc gửi duyệt;
-- phiếu đang chờ trước bản này giữ nguyên cấp người giao.
ALTER TABLE "ApprovalRequest" ADD COLUMN "withBoard" BOOLEAN NOT NULL DEFAULT false;
