const test = require('node:test');
const assert = require('node:assert/strict');
const mountSearch = require('./search');
const { searchItems, escapeLike } = mountSearch;
const { ROLE_PROFILES } = require('../lib/permissions');

// Gắn route vào một "app" giả để gọi đúng handler GET /api/search.
function routeHandler(prisma) {
  let handler;
  mountSearch({ get: (path, auth, fn) => { assert.equal(path, '/api/search'); handler = fn; } }, { prisma, auth: () => {} });
  return async (user, q) => { let body; await handler({ user, query: { q } }, { json: b => { body = b; } }); return body; };
}

test('ký tự đại diện của LIKE trong từ khoá được hiểu theo nghĩa đen', () => {
  assert.equal(escapeLike('50%_a\\b'), '50\\%\\_a\\\\b');
});

test('từ khoá ngắn hơn 2 ký tự không truy vấn', async () => {
  const prisma = { $queryRaw: () => { throw new Error('không được gọi'); } };
  assert.deepEqual(await searchItems(prisma, { id: 1 }, ' a '), []);
});

test('giữ lọc quyền: ứng viên SQL vẫn đi qua điều kiện xem của Prisma, giữ thứ tự ứng viên', async () => {
  let where;
  const prisma = {
    $queryRaw: async () => [{ id: 3, matchedDocument: null }, { id: 2, matchedDocument: '12/QĐ' }, { id: 1, matchedDocument: null }],
    workItem: { findMany: async args => { where = args.where; return [
      { id: 1, number: 1, title: 'A', project: { id: 9, key: 'DA', name: 'Dự án' } },
      { id: 2, number: 2, title: 'B', project: { id: 9, key: 'DA', name: 'Dự án' } },
    ]; } },
  };
  const user = { id: 10, role: 'member', departmentId: 1, permissions: ROLE_PROFILES.member };
  const out = await routeHandler(prisma)(user, 'ab');
  assert.deepEqual(where.id, { in: [3, 2, 1] });
  assert.ok(where.project.OR, 'điều kiện dự án được xem phải có mặt');
  assert.ok(where.AND?.[0]?.OR, 'điều kiện việc được xem phải có mặt');
  assert.deepEqual(out.map(r => [r.code, r.matchedDocument]), [['DA-2', '12/QĐ'], ['DA-1', null]]);
});

// Kiểm thử trên Postgres thật (cần extension unaccent): đặt TEST_DATABASE_URL tới một CSDL thử đã chạy `prisma migrate deploy`.
// Chỉ dữ liệu mẫu giả; tự dọn sau khi chạy.
const url = process.env.TEST_DATABASE_URL;
test('Postgres: tìm không dấu, không phân biệt hoa thường, vẫn theo quyền xem', { skip: !url && 'chưa đặt TEST_DATABASE_URL' }, async t => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  t.after(() => prisma.$disconnect());
  const tag = Date.now().toString(36).toUpperCase();
  const deptA = await prisma.department.create({ data: { code: 'A' + tag, name: 'Phòng thử A' } });
  const deptB = await prisma.department.create({ data: { code: 'B' + tag, name: 'Phòng thử B' } });
  const project = await prisma.project.create({ data: { key: 'NƠXH' + tag, name: 'Dự án NƠXH mẫu ' + tag, departmentId: deptA.id, visibility: 'DEPARTMENT' } });
  const state = await prisma.workflowState.create({ data: { projectId: project.id, name: 'Cần làm', category: 'UNSTARTED' } });
  const item = (number, title) => prisma.workItem.create({ data: { projectId: project.id, number, title, stateId: state.id } });
  const hop = await item(1, 'Bảng phòng họp ' + tag);
  const other = await item(2, 'Việc khác ' + tag);
  await prisma.workItemDocument.create({ data: { workItemId: other.id, kind: 'BASIS', number: `${tag}/QĐ-ĐHĐCĐ`, summary: 'Văn bản mẫu', createdById: 1 } });
  t.after(async () => {
    await prisma.workItemDocument.deleteMany({ where: { workItemId: other.id } });
    await prisma.workItem.deleteMany({ where: { projectId: project.id } });
    await prisma.workflowState.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.department.deleteMany({ where: { id: { in: [deptA.id, deptB.id] } } });
  });

  const search = routeHandler(prisma);
  const inDept = { id: 900001, role: 'member', departmentId: deptA.id, permissions: ROLE_PROFILES.member };
  const outsider = { id: 900002, role: 'member', departmentId: deptB.id, permissions: ROLE_PROFILES.member };
  const ids = async (user, q) => (await search(user, q)).map(r => r.id);

  assert.deepEqual(await ids(inDept, 'phong hop ' + tag.toLowerCase()), [hop.id], '"phong hop" khớp "Bảng phòng họp"');
  assert.deepEqual(await ids(inDept, 'PHÒNG HỌP ' + tag), [hop.id]);
  assert.deepEqual((await ids(inDept, 'NOXH' + tag)).sort(), [hop.id, other.id].sort(), '"NOXH" khớp mã dự án "NƠXH"');
  assert.deepEqual((await ids(inDept, 'du an noxh mau ' + tag)).sort(), [hop.id, other.id].sort(), 'khớp tên dự án không dấu');
  const byDoc = await search(inDept, tag + '/qd-dhdcd');
  assert.deepEqual(byDoc.map(r => [r.id, r.matchedDocument]), [[other.id, `${tag}/QĐ-ĐHĐCĐ`]], 'số văn bản không dấu, Đ → D');
  assert.deepEqual(await ids(inDept, 'phong%hop ' + tag), [], '% trong từ khoá không phải ký tự đại diện');
  assert.deepEqual(await ids(outsider, 'phong hop ' + tag), [], 'người phòng khác không thấy việc của dự án phòng ban');
});
