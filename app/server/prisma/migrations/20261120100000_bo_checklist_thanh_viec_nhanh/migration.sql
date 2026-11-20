-- Bỏ Checklist (quyền tối thiểu theo vai, 20/11/2026): mỗi mục checklist cũ thành MỘT việc nhánh của việc chứa nó.
--   • cùng người chủ trì với việc cha; người giao = người chủ trì (đầu tiên) của việc cha — L chia việc của mình thì L là người giao;
--     việc cha chưa có người chủ trì thì người giao = người giao của việc cha;
--   • mục đã xong → việc nhánh "Hoàn thành" GHI THẲNG (không mở phiếu duyệt), 100%, có dòng lịch sử ghi rõ;
--   • mục chưa xong → việc nhánh ở cột "Chưa bắt đầu" (cột đầu tiên không phải Chờ duyệt / Hoàn thành / Huỷ);
--   • kế thừa phòng chủ trì, loại nhiệm vụ, hạn và kế hoạch gốc của việc cha (MTL: % việc cha tự tính từ việc nhánh như hiện nay);
--   • việc cha đang trong thùng rác → việc nhánh cũng trong thùng rác (khôi phục cùng việc cha).
-- Bảng "ChecklistItem" GIỮ LẠI (không đọc / ghi nữa) để đối chiếu và quay lui; cột "migratedItemId" trỏ tới việc nhánh đã tạo,
-- chạy lại migration không tạo trùng. Xoá bảng ở một bản sau khi đã đối chiếu xong (bản thật: 0 mục checklist lúc chuyển).

ALTER TABLE "ChecklistItem" ADD COLUMN "migratedItemId" INTEGER;

CREATE TEMP TABLE "_cl_map" ON COMMIT DROP AS
WITH src AS (
  SELECT c."id" AS cid, c."title", c."done", c."createdAt" AS c_created,
         w."id" AS parent_id, w."projectId" AS project_id, w."leadDepartmentId", w."taskType", w."startDate", w."dueDate",
         w."baselineStart", w."baselineEnd", w."assignedById" AS parent_assigner, w."archivedAt", w."deletedById",
         (SELECT a."userId" FROM "WorkItemAssignee" a WHERE a."workItemId" = w."id" ORDER BY a."userId" LIMIT 1) AS lead_id,
         ROW_NUMBER() OVER (PARTITION BY w."projectId" ORDER BY w."id", c."position", c."id") AS rn
  FROM "ChecklistItem" c
  JOIN "WorkItem" w ON w."id" = c."workItemId"
  WHERE c."migratedItemId" IS NULL
)
SELECT src.*, p."nextNumber" + src.rn - 1 AS num, p."kind" AS project_kind,
       CASE WHEN src."done"
         THEN (SELECT s."id" FROM "WorkflowState" s WHERE s."projectId" = src.project_id AND s."category" = 'COMPLETED' ORDER BY s."position" LIMIT 1)
         ELSE COALESCE(
           (SELECT s."id" FROM "WorkflowState" s WHERE s."projectId" = src.project_id AND s."category" = 'UNSTARTED' ORDER BY s."position" LIMIT 1),
           (SELECT s."id" FROM "WorkflowState" s WHERE s."projectId" = src.project_id AND s."category" NOT IN ('REVIEW', 'COMPLETED', 'CANCELLED') ORDER BY s."position" LIMIT 1))
       END AS state_id,
       COALESCE(src.lead_id, src.parent_assigner) AS giver
FROM src JOIN "Project" p ON p."id" = src.project_id;

-- Dự án thiếu cột phù hợp (hiếm): bỏ qua mục đó, giữ nguyên trong bảng cũ để xử lý tay.
DELETE FROM "_cl_map" WHERE state_id IS NULL;

INSERT INTO "WorkItem" ("projectId", "number", "title", "stateId", "priority", "reporterId", "parentId", "assignedById", "assignedAt",
  "progress", "taskType", "leadDepartmentId", "startDate", "dueDate", "originalDueDate", "baselineStart", "baselineEnd",
  "position", "startedAt", "completedAt", "progressAt", "archivedAt", "deletedById", "createdAt", "updatedAt")
SELECT m.project_id, m.num, LEFT(m."title", 300), m.state_id, 'NONE', m.giver, m.parent_id, m.giver, m.c_created,
  CASE WHEN m."done" THEN 100 ELSE 0 END, m."taskType", m."leadDepartmentId", m."startDate", m."dueDate", m."dueDate",
  CASE WHEN m.project_kind = 'MTL' THEN m."baselineStart" END, CASE WHEN m.project_kind = 'MTL' THEN m."baselineEnd" END,
  COALESCE((SELECT MAX(x."position") FROM "WorkItem" x WHERE x."stateId" = m.state_id), 0) + m.rn * 1024,
  CASE WHEN m."done" THEN m.c_created END, CASE WHEN m."done" THEN m.c_created END, CASE WHEN m."done" THEN m.c_created END,
  m."archivedAt", m."deletedById", m.c_created, now()
FROM "_cl_map" m;

-- Nối mục cũ ↔ việc nhánh mới (số thứ tự là duy nhất trong dự án).
UPDATE "ChecklistItem" c SET "migratedItemId" = w."id"
FROM "_cl_map" m JOIN "WorkItem" w ON w."projectId" = m.project_id AND w."number" = m.num
WHERE c."id" = m.cid;

-- Cùng người chủ trì với việc cha.
INSERT INTO "WorkItemAssignee" ("workItemId", "userId")
SELECT w."id", a."userId"
FROM "_cl_map" m JOIN "WorkItem" w ON w."projectId" = m.project_id AND w."number" = m.num
JOIN "WorkItemAssignee" a ON a."workItemId" = m.parent_id
ON CONFLICT DO NOTHING;

-- Lịch sử: việc nhánh tạo từ mục checklist; mục đã xong ghi thẳng Hoàn thành (không qua duyệt); việc cha ghi số mục đã chuyển.
INSERT INTO "Activity" ("workItemId", "actorId", "type", "data", "createdAt")
SELECT w."id", m.giver, 'CREATED', jsonb_build_object('title', LEFT(m."title", 300), 'source', 'CHECKLIST', 'checklistItemId', m.cid, 'parentId', m.parent_id), now()
FROM "_cl_map" m JOIN "WorkItem" w ON w."projectId" = m.project_id AND w."number" = m.num;

INSERT INTO "Activity" ("workItemId", "actorId", "type", "data", "createdAt")
SELECT w."id", m.giver, 'STATE', jsonb_build_object('from', 'Mục checklist đã xong', 'to', s."name", 'toId', s."id", 'direct', true,
  'note', 'Chuyển từ mục checklist đã xong — ghi thẳng Hoàn thành, không qua duyệt'), now()
FROM "_cl_map" m JOIN "WorkItem" w ON w."projectId" = m.project_id AND w."number" = m.num JOIN "WorkflowState" s ON s."id" = m.state_id
WHERE m."done";

INSERT INTO "Activity" ("workItemId", "actorId", "type", "data", "createdAt")
SELECT m.parent_id, NULL, 'CHECKLIST_MIGRATED', jsonb_build_object('count', COUNT(*), 'done', COUNT(*) FILTER (WHERE m."done")), now()
FROM "_cl_map" m GROUP BY m.parent_id;

-- Đẩy số thứ tự kế tiếp của dự án.
UPDATE "Project" p SET "nextNumber" = p."nextNumber" + x.n
FROM (SELECT project_id, COUNT(*) AS n FROM "_cl_map" GROUP BY project_id) x
WHERE p."id" = x.project_id;
