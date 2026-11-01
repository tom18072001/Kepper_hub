-- Rà soát vòng 2 (24/10/2026): bảng phiên bản báo cáo tuần cũng không TRUNCATE được (như AuditLog).
CREATE TRIGGER "WeeklyReportVersion_no_truncate" BEFORE TRUNCATE ON "WeeklyReportVersion" FOR EACH STATEMENT EXECUTE FUNCTION kepper_append_only();
