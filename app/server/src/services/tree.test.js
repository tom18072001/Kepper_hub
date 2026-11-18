// Việc con nhiều cấp: cây không giới hạn (trần MAX_DEPTH), chặn vòng, quyền xem theo tổ tiên, tiến độ dồn mọi cấp, thùng rác cả cây.
const test = require('node:test');
const assert = require('node:assert/strict');
const tree = require('./tree');
const { canSeeItem, itemVisibleWhere } = require('./access');
const { trashItem, restoreItem } = require('./trash');
const MTL = require('./mtl');
const { ROLE_PROFILES } = require('../lib/permissions');

// Prisma giả: chỉ những truy vấn services/tree.js và services/trash.js dùng.
function fakeDb(rows) {
  const items = rows.map(r => ({ archivedAt: null, ...r }));
  const match = (i, where = {}) => Object.entries(where).every(([k, v]) =>
    v && typeof v === 'object' && 'in' in v ? v.in.includes(i[k]) : (v instanceof Date ? i[k]?.getTime() === v.getTime() : i[k] === v));
  return { items, workItem: {
    findUnique: async ({ where }) => items.find(i => i.id === where.id) || null,
    findMany: async ({ where }) => items.filter(i => match(i, where)).map(i => ({ id: i.id })),
    updateMany: async ({ where, data }) => { const hit = items.filter(i => match(i, where)); hit.forEach(i => Object.assign(i, data)); return { count: hit.length }; },
  } };
}
// 1 → 2 → 3 → 4 (4 cấp), 1 → 5
const chain = () => fakeDb([{ id: 1, parentId: null }, { id: 2, parentId: 1 }, { id: 3, parentId: 2 }, { id: 4, parentId: 3 }, { id: 5, parentId: 1 }]);

test('thêm việc con ở cấp sâu được; không tạo vòng; không vượt trần cấp', async () => {
  const db = chain();
  await tree.assertCanNest(db, 4); // việc mới dưới cấp 3 → cấp 4: được
  await assert.rejects(tree.assertCanNest(db, 3, 1), e => e.code === 'ITEM_CYCLE'); // gốc không làm con của cháu nó
  await assert.rejects(tree.assertCanNest(db, 2, 2), e => e.code === 'ITEM_CYCLE');
  await tree.assertCanNest(db, 5, 3); // chuyển nhánh 3→4 sang dưới 5: được
  const deep = fakeDb(Array.from({ length: tree.MAX_DEPTH + 1 }, (_, i) => ({ id: i + 1, parentId: i || null })));
  await tree.assertCanNest(deep, tree.MAX_DEPTH); // cha ở cấp MAX_DEPTH-1 → con ở cấp MAX_DEPTH
  await assert.rejects(tree.assertCanNest(deep, tree.MAX_DEPTH + 1), e => e.code === 'ITEM_TOO_DEEP');
});

test('dữ liệu cũ đã vòng: đi lên / xuống cây không lặp vô hạn', async () => {
  const db = fakeDb([{ id: 1, parentId: 2 }, { id: 2, parentId: 1 }]);
  assert.deepEqual((await tree.ancestors(db, 1)).map(a => a.id), [1, 2]);
  assert.deepEqual(await tree.descendantIds(db, [1]), [2]);
});

test('sổ giao việc của đơn vị: người được giao việc gốc thấy việc chắt', () => {
  const as = (id, role, departmentId) => ({ id, role, departmentId, permissions: ROLE_PROFILES[role] });
  const register = { id: 1, visibility: 'ASSIGNED' };
  const blank = { assignedById: 9, leadDepartmentId: null, assignees: [], supporters: [], supportDepartments: [] };
  const root = { ...blank, assignees: [{ userId: 21 }] };
  assert.equal(canSeeItem(as(21, 'member', 2), register, null, blank, [blank, blank, root]), true);
  assert.equal(canSeeItem(as(24, 'member', 2), register, null, blank, [blank, blank, root]), false);
  // Điều kiện Prisma đi lên đủ MAX_DEPTH tầng việc cha.
  const where = JSON.stringify(itemVisibleWhere(as(21, 'member', 2)));
  assert.equal(where.split('"parent"').length - 1, tree.MAX_DEPTH);
});

test('tiến độ thực tế dồn qua mọi cấp (cháu cập nhật → ông thay đổi)', () => {
  const rows = [{ id: 1, parentId: null, progress: 0 }, { id: 2, parentId: 1, progress: 0 }, { id: 3, parentId: 1, progress: 0, state: { category: 'COMPLETED' } },
    { id: 4, parentId: 2, progress: 50 }, { id: 5, parentId: 2, progress: 0 }];
  const r = MTL.rollup(rows);
  assert.equal(r.get(2), 25);
  assert.equal(r.get(1), 62.5);
});

test('thùng rác: xoá và khôi phục cả cây con cháu', async () => {
  const db = chain();
  const at = new Date('2026-11-18T00:00:00Z');
  const ids = await trashItem(db, 2, { id: 1 }, at);
  assert.deepEqual(ids.sort(), [2, 3, 4]);
  assert.deepEqual(db.items.filter(i => i.archivedAt).map(i => i.id).sort(), [2, 3, 4]);
  await restoreItem(db, db.items.find(i => i.id === 2));
  assert.equal(db.items.filter(i => i.archivedAt).length, 0);
});
