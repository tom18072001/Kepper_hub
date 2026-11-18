// Kepler NAS: giao thức MCP, chỉ đọc trong thư mục gốc, đọc DOCX / XLSX / PDF / TXT, tìm theo tên không dấu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kepler-nas-'));
const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'kepler-out-'));

// ZIP "stored" tối giản để dựng DOCX / XLSX mẫu.
function zip(files) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals = [], centrals = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), nb = Buffer.from(name), c = crc(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(c, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(c, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, data); centrals.push(ch, nb); off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
fs.mkdirSync(path.join(ROOT, 'Dự án', '01.PhapLy'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'Dự án', '01.PhapLy', 'Hợp đồng tư vấn.docx'), zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Điều 1: Phạm vi tư vấn pháp lý</w:t></w:r></w:p><w:p><w:r><w:t>Giá trị: 120 triệu</w:t></w:r></w:p></w:body></w:document>' }));
fs.writeFileSync(path.join(ROOT, 'Dự án', 'Tiến độ.xlsx'), zip({ 'xl/workbook.xml': '<workbook><sheets><sheet name="MTL" sheetId="1"/></sheets></workbook>', 'xl/sharedStrings.xml': '<sst><si><t>Hạng mục</t></si><si><t>Pháp lý</t></si></sst>', 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>50</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>80</v></c></row></sheetData></worksheet>' }));
const content = zlib.deflateSync(Buffer.from('BT /F1 12 Tf 72 712 Td (Bien ban nghiem thu) Tj T* [(Hang muc ) -20 (mong coc)] TJ ET'));
fs.writeFileSync(path.join(ROOT, 'Dự án', 'Biên bản.pdf'), Buffer.concat([Buffer.from(`%PDF-1.4\n4 0 obj << /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')]));
fs.writeFileSync(path.join(ROOT, 'ghi chu.txt'), 'Ghi chú nội bộ');
fs.writeFileSync(path.join(OUTSIDE, 'bi-mat.txt'), 'không được đọc');

function server() {
  const child = spawn(process.execPath, [path.join(here, '..', 'server.js')], { env: { ...process.env, NAS_ROOTS: ROOT }, stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '', next = 1; const waiting = new Map();
  child.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); } });
  const call = (method, params) => new Promise(res => { const id = next++; waiting.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const tool = async (name, args) => { const r = await call('tools/call', { name, arguments: args }); return { error: !!r.result.isError, text: r.result.content[0].text }; };
  return { call, tool, stop: () => child.kill() };
}

test('MCP: khởi tạo, liệt kê đúng 4 công cụ chỉ đọc', async () => {
  const s = server();
  const init = await s.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.result.serverInfo.name, 'kepler-nas');
  const { result } = await s.call('tools/list', {});
  assert.deepEqual(result.tools.map(t => t.name), ['nas_roots', 'nas_list', 'nas_search', 'nas_read']);
  s.stop();
});

test('liệt kê, tìm không dấu, đọc DOCX / XLSX / PDF / TXT', async () => {
  const s = server();
  assert.match((await s.tool('nas_list', { path: 'Dự án' })).text, /\[DIR\] 01\.PhapLy/);
  assert.match((await s.tool('nas_search', { query: 'hop dong' })).text, /Hợp đồng tư vấn\.docx/);
  assert.match((await s.tool('nas_read', { path: 'Dự án\\01.PhapLy\\Hợp đồng tư vấn.docx' })).text, /Điều 1: Phạm vi tư vấn pháp lý\nGiá trị: 120 triệu/);
  assert.match((await s.tool('nas_read', { path: 'Dự án/Tiến độ.xlsx' })).text, /Sheet MTL[\s\S]*Hạng mục\t50[\s\S]*Pháp lý\t80/);
  const p = (await s.tool('nas_read', { path: 'Dự án/Biên bản.pdf' })).text;
  assert.match(p, /Bien ban nghiem thu/); assert.match(p, /Hang muc mong coc/);
  assert.match((await s.tool('nas_read', { path: 'ghi chu.txt' })).text, /Ghi chú nội bộ/);
  s.stop();
});

test('không đọc được ngoài thư mục gốc, kể cả bằng ..', async () => {
  const s = server();
  for (const p of [path.join(OUTSIDE, 'bi-mat.txt'), '..\\' + path.basename(OUTSIDE) + '\\bi-mat.txt']) {
    const r = await s.tool('nas_read', { path: p });
    assert.equal(r.error, true); assert.match(r.text, /Chỉ đọc được trong/);
  }
  assert.equal((await s.tool('nas_list', { path: 'khong-co' })).error, true);
  s.stop();
});
