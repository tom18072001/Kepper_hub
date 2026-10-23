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

// Playground CRM / HRM (chỉ khi máy chủ thử bật MODULES=crm,hrm và đã có dữ liệu mẫu giả).
test('MCP playground: CRM / HRM theo đúng quyền; không CCCD đầy đủ, không lương, không chấm công / duyệt qua Claude', { skip }, async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const clients = [];
  try {
    const nv = await tokenFor(prisma, 'nv.phaply', ['read', 'write']);
    if ((await fetch(BASE_URL + '/api/crm/meta', { headers: { authorization: `Bearer ${nv.token}` } })).status === 404) return; // module tắt
    const c = await clientFor(nv.token); clients.push(c);
    const tools = (await c.listTools()).tools.map(t => t.name);
    assert.ok(tools.includes('kepper_hr_request_leave') && !tools.some(t => /check_?in|attendance_check|approve|decide|identity|salary/.test(t)));

    // Đối tác của bộ phận khác: chỉ thông tin chung, không người liên hệ / hợp đồng; không ghi nhật ký được.
    const other = await prisma.crmPartner.findFirst({ where: { ownerDepartmentId: { not: nv.user.departmentId }, ownerUserId: { not: nv.user.id } } });
    const p = await call(c, 'kepper_crm_partner', { partnerId: other.id });
    assert.ok(!p.error && p.json.contacts === null && p.json.engagements === undefined && p.json.limited === true, p.text);
    const deny = await call(c, 'kepper_crm_log_interaction', { partnerId: other.id, type: 'CALL', summary: 'thử (giả)' });
    assert.ok(deny.error && /Không đủ quyền/.test(deny.text), deny.text);
    // Đối tác bộ phận mình: ghi nhật ký được (đánh dấu [claude:token#] trong nhật ký hệ thống).
    const own = await prisma.crmPartner.findFirst({ where: { ownerDepartmentId: nv.user.departmentId } });
    const logged = await call(c, 'kepper_crm_log_interaction', { partnerId: own.id, type: 'CALL', summary: 'Claude ghi thử (giả)' });
    assert.ok(!logged.error, logged.text);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'CRM_INTERACTION_CREATE', entityId: String(logged.json.id) } });
    assert.match(audit.userAgent, /^\[claude:token#\d+\]/);

    // Hồ sơ: chỉ 4 số cuối CCCD, không lương; số định danh đầy đủ không lấy được bằng token.
    const me = await call(c, 'kepper_hr_me');
    assert.ok(!me.error, me.text);
    assert.equal(me.json.profile.identity.last4.length, 4);
    assert.ok(!/\b\d{12}\b/.test(me.text) && !/salary/.test(me.text), 'không lộ CCCD / lương');
    assert.equal((await fetch(`${BASE_URL}/api/hrm/people/${nv.user.id}/identity`, { headers: { authorization: `Bearer ${nv.token}` } })).status, 403);
    assert.equal((await fetch(`${BASE_URL}/api/hrm/attendance/check`, { method: 'POST', headers: { authorization: `Bearer ${nv.token}`, 'content-type': 'application/json' }, body: '{"kind":"in"}' })).status, 403);

    // Đơn nghỉ: tạo của chính mình được (chờ duyệt); không có gì để tôi duyệt.
    const leave = await call(c, 'kepper_hr_request_leave', { type: 'UNPAID', fromDate: '2026-12-21', reason: 'Claude tạo thử (giả)' });
    assert.ok(!leave.error && leave.json.status === 'PENDING', leave.text);
    await prisma.hrLeave.delete({ where: { id: leave.json.id } });
    assert.deepEqual((await call(c, 'kepper_hr_leaves', { scope: 'approve' })).json, []);
    // Lãnh đạo xem đơn của bộ phận qua Claude: nghỉ ốm / thai sản của người khác gộp thành "Nghỉ theo chế độ", không lý do.
    const tb = await tokenFor(prisma, 'tb.phaply', ['read']);
    const cTb = await clientFor(tb.token); clients.push(cTb);
    const sick = await prisma.hrLeave.create({ data: { userId: nv.user.id, departmentId: nv.user.departmentId, type: 'SICK', fromDate: new Date('2026-12-22T00:00:00+07:00'), toDate: new Date('2026-12-22T00:00:00+07:00'), days: 1, reason: 'chi tiết sức khoẻ (giả)', createdById: nv.user.id } });
    try {
      const team = await call(cTb, 'kepper_hr_leaves', { scope: 'team' });
      const row = team.json.find(l => l.id === sick.id);
      assert.ok(row && row.type === 'Nghỉ theo chế độ' && row.reason === undefined && !/sức khoẻ/.test(team.text), team.text);
    } finally { await prisma.hrLeave.delete({ where: { id: sick.id } }); }
  } finally {
    for (const x of clients) await x.close().catch(() => {});
    await prisma.crmInteraction.deleteMany({ where: { summary: 'Claude ghi thử (giả)' } });
    await prisma.apiToken.deleteMany({ where: { name: 'test' } });
    await prisma.$disconnect();
  }
});
