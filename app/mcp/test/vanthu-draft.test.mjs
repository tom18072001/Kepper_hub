// Công cụ kepper_vanthu_draft (không cần máy chủ Kepler Hub thật): đọc PDF trên máy, gửi multipart tới /api/vanthu/drafts;
// không có công cụ phê duyệt / trả lại / cấp số; từ chối tệp không phải PDF, đường dẫn tương đối.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

process.env.KEPPER_NO_BROWSER = '1';
const { buildServer, readPdf } = await import('../server.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kepper-draft-'));
const pdfPath = path.join(dir, 'Quy che mau (gia).pdf');
fs.writeFileSync(pdfPath, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const fakePdf = path.join(dir, 'gia.pdf');
fs.writeFileSync(fakePdf, 'không phải pdf');

async function connect(call) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = buildServer({ call });
  await server.connect(a);
  const client = new Client({ name: 't', version: '1' });
  await client.connect(b);
  return client;
}
const META = { entities: [{ code: 'HLD', name: 'Công ty mẹ' }], departments: [{ id: 12, code: 'IT', name: 'Phòng CNTT (giả)' }] };

test('kepper_vanthu_draft: gửi PDF + trường của dự thảo tới /api/vanthu/drafts (multipart), mã bộ phận → id; trả "chưa có số"', async () => {
  const calls = [];
  const call = async (p, opts = {}) => {
    calls.push({ p, opts });
    if (p === '/api/vanthu/meta') return META;
    return { id: 5, status: { code: 'DRAFT', label: 'Chưa phê duyệt' }, title: 'Quy chế mẫu', viewLevel: { code: 'LEADERS', label: 'Lãnh đạo' }, number: null, viaAi: true };
  };
  const c = await connect(call);
  const r = await c.callTool({ name: 'kepper_vanthu_draft', arguments: { filePath: pdfPath, title: 'Quy chế mẫu (giả)', docType: 'QC', series: 'D7', entity: 'HLD', department: 'it', viewLevel: 'LEADERS', docCode: 'QC-IT-01', effectiveDate: '2026-10-22', originalIssueDate: '2026-10-22' } });
  assert.ok(!r.isError, r.content[0].text);
  const out = JSON.parse(r.content[0].text).data;
  assert.match(out.number, /chưa có số/);
  assert.match(out.next, /Claude không phê duyệt/);
  const post = calls.find(x => x.p === '/api/vanthu/drafts');
  assert.equal(post.opts.method, 'POST');
  const f = post.opts.form;
  assert.ok(f instanceof FormData);
  assert.equal(f.get('departmentId'), '12');
  assert.equal(f.get('docDate'), '2026-10-22', 'ngày ban hành gốc');
  assert.equal(f.get('viewLevel'), 'LEADERS');
  assert.equal(f.get('docType'), 'QC');
  const file = f.get('file');
  assert.equal(file.name, 'Quy che mau (gia).pdf');
  assert.equal(file.type, 'application/pdf');
  assert.equal(Buffer.from(await file.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  await c.close();
});

test('không có công cụ phê duyệt / trả lại / cấp số; tệp không phải PDF, đường dẫn tương đối, bộ phận / pháp nhân sai → báo lỗi, không gửi', async () => {
  const calls = [];
  const c = await connect(async (p, opts) => { calls.push(p); return META; });
  const names = (await c.listTools()).tools.map(t => t.name);
  assert.ok(names.includes('kepper_vanthu_draft'));
  assert.ok(!names.some(n => /approve|return|duyet|number|cap_so/i.test(n)), names.join(','));
  const base = { title: 'Quy chế mẫu', docType: 'QC', series: 'D6', entity: 'HLD' };
  for (const [args, re] of [[{ filePath: fakePdf }, /không phải PDF/], [{ filePath: 'tai-lieu.pdf' }, /đường dẫn đầy đủ/], [{ filePath: path.join(dir, 'x.docx') }, /\.pdf/],
    [{ filePath: path.join(dir, 'khong-co.pdf') }, /Không tìm thấy/], [{ filePath: pdfPath, entity: 'XYZ' }, /Pháp nhân/], [{ filePath: pdfPath, series: 'D7', department: 'ZZ' }, /bộ phận/]]) {
    const r = await c.callTool({ name: 'kepper_vanthu_draft', arguments: { ...base, ...args } });
    assert.ok(r.isError, JSON.stringify(args));
    assert.match(r.content[0].text, re);
  }
  assert.ok(!calls.includes('/api/vanthu/drafts'));
  await c.close();
});

test('readPdf: đọc đúng tệp PDF', () => {
  const r = readPdf(pdfPath);
  assert.equal(r.name, 'Quy che mau (gia).pdf');
  assert.ok(r.buffer.length > 10);
});
