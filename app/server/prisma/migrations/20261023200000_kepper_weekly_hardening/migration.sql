-- Kepper GĐ2b (rà soát): giờ nhận tin báo muộn / vắng do thư ký nhập hộ; phiên bản bất biến của mỗi lần nộp báo cáo tuần;
-- nhật ký hệ thống (AuditLog) chỉ ghi thêm — chặn sửa / xoá kể cả từ tài khoản ứng dụng (DET-05, chứng cứ).
ALTER TABLE "WeeklyNotice" ADD COLUMN "receivedAt" TIMESTAMP(3);

CREATE TABLE "WeeklyReportVersion" (
    "id" SERIAL NOT NULL,
    "reportId" INTEGER NOT NULL,
    "n" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "week" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "sha256" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "submittedById" INTEGER NOT NULL,
    "onBehalf" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklyReportVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WeeklyReportVersion_reportId_n_key" ON "WeeklyReportVersion"("reportId", "n");
CREATE INDEX "WeeklyReportVersion_week_departmentId_idx" ON "WeeklyReportVersion"("week", "departmentId");

-- Bản nộp và nhật ký: chỉ ghi thêm.
CREATE OR REPLACE FUNCTION kepper_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Bảng % chỉ được ghi thêm (không sửa / xoá)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION kepper_append_only();
CREATE TRIGGER "AuditLog_no_truncate" BEFORE TRUNCATE ON "AuditLog" FOR EACH STATEMENT EXECUTE FUNCTION kepper_append_only();
CREATE TRIGGER "WeeklyReportVersion_append_only" BEFORE UPDATE OR DELETE ON "WeeklyReportVersion" FOR EACH ROW EXECUTE FUNCTION kepper_append_only();
