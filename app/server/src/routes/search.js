// Tìm nhanh (Ctrl K): theo mã (DA-12), tên việc, số văn bản, tên / mã dự án — trong phạm vi người dùng được xem.
// Không phân biệt hoa thường và dấu: so khớp unaccent(lower(cột)) LIKE unaccent(lower(từ khoá)) (extension unaccent,
// migration 20261119200000_search_unaccent). Bước 1 lấy ứng viên bằng SQL có tham số; bước 2 lọc quyền bằng đúng
// điều kiện Prisma như trước (visibleProjectsWhere + itemVisibleWhere), nên phạm vi xem không đổi.
const { Prisma } = require('@prisma/client');
const { visibleProjectsWhere, itemVisibleWhere } = require('../services/access');

const LIMIT = 15, PAGE = 200, MAX_PAGES = 10;
// Ký tự đại diện của LIKE trong từ khoá được hiểu theo nghĩa đen (ESCAPE mặc định của Postgres là \).
const escapeLike = s => s.replace(/[\\%_]/g, c => '\\' + c);

function candidateQuery(q, offset) {
  const pat = '%' + escapeLike(q) + '%';
  const m = q.match(/^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/);
  const code = m ? Prisma.sql`OR (w."number" = ${Number(m[2])} AND p."key" = ${m[1].toUpperCase()})` : Prisma.empty;
  return Prisma.sql`
    SELECT w."id",
      (SELECT d."number" FROM "WorkItemDocument" d
        WHERE d."workItemId" = w."id" AND unaccent(lower(d."number")) LIKE unaccent(lower(${pat}))
        ORDER BY d."id" LIMIT 1) AS "matchedDocument"
    FROM "WorkItem" w JOIN "Project" p ON p."id" = w."projectId"
    WHERE w."archivedAt" IS NULL AND p."archivedAt" IS NULL AND p."deletedAt" IS NULL AND (
      unaccent(lower(w."title")) LIKE unaccent(lower(${pat}))
      OR unaccent(lower(p."name")) LIKE unaccent(lower(${pat}))
      OR unaccent(lower(p."key")) LIKE unaccent(lower(${pat}))
      OR EXISTS (SELECT 1 FROM "WorkItemDocument" d WHERE d."workItemId" = w."id" AND unaccent(lower(d."number")) LIKE unaccent(lower(${pat})))
      ${code})
    ORDER BY w."updatedAt" DESC, w."id" DESC
    LIMIT ${PAGE} OFFSET ${offset}`;
}

async function searchItems(prisma, user, rawQ) {
  const q = String(rawQ || '').trim().slice(0, 100);
  if (q.length < 2) return [];
  const out = [];
  // Ứng viên theo trang (mới cập nhật trước); lọc quyền từng trang tới khi đủ LIMIT kết quả.
  for (let page = 0; page < MAX_PAGES && out.length < LIMIT; page++) {
    const cands = await prisma.$queryRaw(candidateQuery(q, page * PAGE));
    if (!cands.length) break;
    const docs = new Map(cands.map(c => [Number(c.id), c.matchedDocument || null]));
    const rows = await prisma.workItem.findMany({
      where: { id: { in: [...docs.keys()] }, archivedAt: null, project: { ...visibleProjectsWhere(user), archivedAt: null }, AND: [itemVisibleWhere(user)] },
      select: { id: true, number: true, title: true, project: { select: { id: true, key: true, name: true } } },
    });
    const byId = new Map(rows.map(r => [r.id, r]));
    for (const id of docs.keys()) {
      const r = byId.get(id);
      if (r && out.length < LIMIT) out.push({ id: r.id, code: `${r.project.key}-${r.number}`, title: r.title, projectId: r.project.id, projectName: r.project.name, matchedDocument: docs.get(id) });
    }
    if (cands.length < PAGE) break;
  }
  return out;
}

module.exports = function mountSearch(app, { prisma, auth }) {
  app.get('/api/search', auth, async (req, res) => {
    res.json(await searchItems(prisma, req.user, req.query.q));
  });
};
module.exports.searchItems = searchItems;
module.exports.escapeLike = escapeLike;
