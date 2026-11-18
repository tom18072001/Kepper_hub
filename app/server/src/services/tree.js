// Cây việc nhiều cấp: việc con có thể có việc con của nó, cứ thế xuống tiếp.
// Việc gốc = cấp 0. Trần MAX_DEPTH cấp dưới việc gốc chỉ để chặn dữ liệu lỗi (người dùng thực tế không chạm tới).
const { fail } = require('../lib/http');

const MAX_DEPTH = 10;
const WALK_CAP = 50; // chặn vòng lặp / dữ liệu cũ hỏng khi đi lên hoặc xuống cây

// Các việc tổ tiên, gần nhất trước: [cha, ông, …, gốc]. `select` thêm trường cần lấy (luôn có id, parentId).
async function ancestors(db, parentId, select = {}) {
  const out = [], seen = new Set();
  for (let cur = parentId; cur != null && !seen.has(cur) && out.length < WALK_CAP;) {
    seen.add(cur);
    const row = await db.workItem.findUnique({ where: { id: cur }, select: { ...select, id: true, parentId: true } });
    if (!row) break;
    out.push(row); cur = row.parentId;
  }
  return out;
}

// Mã mọi việc con cháu (không gồm gốc), theo từng tầng. `where` lọc thêm (vd. { archivedAt: null }).
async function descendantIds(db, rootIds, where = {}) {
  const seen = new Set(rootIds), out = [];
  let frontier = [...rootIds];
  for (let d = 0; frontier.length && d < WALK_CAP; d++) {
    const rows = await db.workItem.findMany({ where: { ...where, parentId: { in: frontier } }, select: { id: true } });
    frontier = rows.map(r => r.id).filter(id => !seen.has(id));
    for (const id of frontier) { seen.add(id); out.push(id); }
  }
  return out;
}

// Số tầng con cháu bên dưới một việc (0 = không có con).
async function subtreeHeight(db, itemId) {
  const seen = new Set([itemId]);
  let frontier = [itemId], h = 0;
  while (frontier.length && h < WALK_CAP) {
    const rows = await db.workItem.findMany({ where: { parentId: { in: frontier }, archivedAt: null }, select: { id: true } });
    frontier = rows.map(r => r.id).filter(id => !seen.has(id));
    frontier.forEach(id => seen.add(id));
    if (frontier.length) h++;
  }
  return h;
}

// Kiểm tra trước khi gắn việc (mới: itemId = null; có sẵn: itemId) vào dưới parentId: không tạo vòng, không vượt trần cấp.
async function assertCanNest(db, parentId, itemId = null) {
  if (parentId == null) return;
  const chain = await ancestors(db, parentId);
  if (itemId != null && (parentId === itemId || chain.some(a => a.id === itemId)))
    fail(422, 'Không thể chọn việc cha là chính việc này hoặc một việc con cháu của nó', 'ITEM_CYCLE');
  const depth = chain.length + (itemId != null ? await subtreeHeight(db, itemId) : 0);
  if (depth > MAX_DEPTH) fail(422, `Cây việc tối đa ${MAX_DEPTH} cấp dưới việc gốc`, 'ITEM_TOO_DEEP');
}

// Phòng chủ trì hiệu lực: của chính việc, nếu trống thì của tổ tiên gần nhất có giá trị.
const effectiveDept = (item, chain = []) => item.leadDepartmentId ?? chain.find(a => a.leadDepartmentId != null)?.leadDepartmentId ?? null;

module.exports = { MAX_DEPTH, ancestors, descendantIds, subtreeHeight, assertCanNest, effectiveDept };
