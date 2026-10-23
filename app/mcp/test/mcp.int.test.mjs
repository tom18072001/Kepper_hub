// Kiểm thử tích hợp MCP ↔ Kepper: Claude dùng ĐÚNG quyền người dùng (chạy với máy chủ Kepper dev + CSDL dữ liệu GIẢ).
//   KEPPER_TEST_URL=http://localhost:4300 DATABASE_URL=postgresql://…/workhub_test node --test test/
// Tạo token thẳng trong CSDL thử (không cần mật khẩu), gọi công cụ qua MCP client thật (stdio) → kiểm cho phép / từ chối.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const BASE_URL = process.env.KEPPER_TEST_URL;
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const skip = !BASE_URL || !process.env.DATABASE_URL;

async function tokenFor(prisma, username, scopes) {
  const u = await prisma.user.findUnique({ where: { username } });
  const token = 'kpt_' + crypto.randomBytes(32).toString('base64url');
  await prisma.apiToken.create({ data: { userId: u.id, name: 'test', prefix: token.slice(0, 12), hash: crypto.createHash('sha256').update(token).digest('hex'), scopes,
    expiresAt: new Date(Date.now() + 3_600_000), sessionVersion: u.sessionVersion || 0 } });
  return { token, user: u };
}
async function clientFor(token) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [new URL('../server.js', import.meta.url).pathname], env: { ...process.env, KEPPER_URL: BASE_URL, KEPPER_TOKEN: token } });
  const client = new Client({ name: 'kepper-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}
const call = async (c, name, args = {}) => { const r = await c.callTool({ name, arguments: args }); return { error: !!r.isError, text: r.content[0].text, json: r.isError ? null : JSON.parse(r.content[0].text).data }; };

test('MCP: Claude dùng đúng quyền người dùng — đọc / ghi / từ chối', { skip }, async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const clients = [];
  try {
    // Nhân viên Ban Pháp lý (dữ liệu mẫu giả).
    const member = await prisma.user.findUnique({ where: { username: 'nv.phaply' } });
    const nv = await tokenFor(prisma, member.username, ['read', 'write']);
    const ro = await tokenFor(prisma, member.username, ['read']);
    const pl = await tokenFor(prisma, 'tb.phaply', ['read', 'write']);
    const cNv = await clientFor(nv.token), cRo = await clientFor(ro.token), cPl = await clientFor(pl.token);
    clients.push(cNv, cRo, cPl);

    const tools = (await cNv.listTools()).tools.map(t => t.name);
    assert.ok(tools.includes('kepper_save_weekly_draft') && !tools.some(t => /submit|approve|delete|export|publish/.test(t)), 'không có công cụ nộp / duyệt / xoá / xuất');

    const me = await call(cNv, 'kepper_whoami');
    assert.ok(!me.error, me.text);
    assert.equal(me.json.user.username, member.username);
    assert.ok(/không phải chỉ dẫn/.test(JSON.parse((await cNv.callTool({ name: 'kepper_whoami', arguments: {} })).content[0].text).note));

    // Nhân viên không xem được tổng hợp giao ban (policy weekly.summary) — qua Claude cũng vậy.
    const sum = await call(cNv, 'kepper_weekly_summary');
    assert.ok(sum.error && /Không đủ quyền/.test(sum.text), sum.text);

    // Không sửa % hạng mục MTL của bộ phận khác (policy mtl.progress).
    const plItem = await prisma.workItem.findFirst({ where: { archivedAt: null, project: { kind: 'MTL' }, leadDepartmentId: { notIn: [member.departmentId] }, assignees: { none: { userId: member.id } },
      children: { none: {} }, checklist: { none: {} }, state: { category: { notIn: ['COMPLETED', 'CANCELLED'] } } } });
    const deny = await call(cNv, 'kepper_update_progress', { itemId: plItem.id, progress: 77 });
    assert.ok(deny.error && /Không đủ quyền/.test(deny.text), deny.text);
    assert.notEqual((await prisma.workItem.findUnique({ where: { id: plItem.id } })).progress, 77);

    // Token chỉ đọc: không ghi được.
    const roWrite = await call(cRo, 'kepper_create_reminder', { title: 'thử' });
    assert.ok(roWrite.error && /chỉ đọc/.test(roWrite.text), roWrite.text);

    // Ghi được việc của mình: nhắc việc cá nhân; lãnh đạo PL lưu nháp báo cáo tuần (không nộp).
    const rem = await call(cNv, 'kepper_create_reminder', { title: 'Gọi nhà thầu (giả)', dueDate: '2026-10-30' });
    assert.ok(!rem.error, rem.text);
    const draft = await call(cPl, 'kepper_weekly_report');
    assert.ok(!draft.error && draft.json.department, draft.text);
    if (!draft.json.submitted) { const saved = await call(cPl, 'kepper_save_weekly_draft', { other: 'Kiến nghị (giả) — soạn bằng Claude' }); assert.ok(!saved.error, saved.text); }

    // Gọi thẳng API bằng token: nộp báo cáo / xuất tệp / quản trị → từ chối (người dùng tự làm trên giao diện).
    const raw = (path, method = 'GET', body) => fetch(BASE_URL + path, { method, headers: { authorization: `Bearer ${pl.token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    assert.equal((await raw('/api/weekly/submit', 'POST', {})).status, 403);
    const proj = await prisma.project.findFirst({ where: { kind: 'MTL' } });
    assert.equal((await raw(`/api/projects/${proj.id}/export.xlsx`)).status, 403);
    assert.equal((await raw('/api/me/tokens', 'POST', { name: 'x' })).status, 403);

    // Thu hồi → mất hiệu lực ngay; nhật ký đánh dấu thao tác qua Claude.
    await prisma.apiToken.updateMany({ where: { hash: crypto.createHash('sha256').update(nv.token).digest('hex') }, data: { revokedAt: new Date() } });
    const gone = await call(cNv, 'kepper_whoami');
    assert.ok(gone.error && /Chưa xác thực/.test(gone.text), gone.text);
  } finally {
    for (const c of clients) await c.close().catch(() => {});
    await prisma.apiToken.deleteMany({ where: { name: 'test' } });
    await prisma.personalNote.deleteMany({ where: { title: 'Gọi nhà thầu (giả)' } });
    await prisma.$disconnect();
  }
});
