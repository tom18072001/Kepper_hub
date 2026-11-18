#!/usr/bin/env node
// Kepler NAS — tiện ích Claude Desktop (MCP qua stdio) đọc kho file nội bộ CHỈ ĐỌC, bằng chính tài khoản Windows
// của người dùng: quyền thư mục (NTFS) IT cấp được áp nguyên — ai không mở được thư mục thì Claude cũng không đọc được.
// Không thư viện ngoài (giao thức MCP JSON-RPC tối giản + đọc DOCX/XLSX/PDF bằng zlib có sẵn của Node).
// Biến môi trường: NAS_ROOTS = các thư mục gốc, cách nhau dấu ";" (mặc định \\192.168.130.2\DATA).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';

const VERSION = '0.1.0';
const ROOTS = String(process.env.NAS_ROOTS || '\\\\192.168.130.2\\DATA').split(';').map(s => s.trim()).filter(Boolean).map(r => path.resolve(r));
const MAX_LIST = 500, MAX_HITS = 100, MAX_READ_BYTES = 50 * 1024 * 1024, DEFAULT_CHARS = 40000, SEARCH_MS = 20000, SEARCH_DIRS = 5000;

// ---------- Đường dẫn: chỉ trong các thư mục gốc ----------
function resolveIn(p) {
  const raw = String(p || '').trim();
  const abs = !raw ? ROOTS[0] : path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(ROOTS[0], raw);
  const ok = ROOTS.some(r => { const rel = path.relative(r, abs); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); });
  if (!ok) throw new Error(`Chỉ đọc được trong: ${ROOTS.join(', ')}`);
  return abs;
}
const why = e => (e.code === 'EACCES' || e.code === 'EPERM' ? 'Tài khoản Windows của bạn không có quyền mở mục này (hỏi IT nếu cần quyền).'
  : e.code === 'ENOENT' ? 'Không tìm thấy (sai đường dẫn, hoặc chưa kết nối mạng công ty / VPN).' : e.message);
const fmtSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const day = d => new Date(d).toISOString().slice(0, 16).replace('T', ' ');

// ---------- ZIP tối giản (DOCX / XLSX / PPTX) ----------
function unzip(buf, want) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Tệp nén hỏng');
  let p = buf.readUInt32LE(eocd + 16); const n = buf.readUInt16LE(eocd + 10), out = {};
  for (let k = 0; k < n; k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (want(name)) {
      const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), data = buf.subarray(start, start + csize);
      out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    }
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
const xmlText = s => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function docx(buf) {
  const x = unzip(buf, n => n === 'word/document.xml')['word/document.xml'] || '';
  return xmlText(x.replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<w:br\/>/g, '\n')).replace(/\n{3,}/g, '\n\n').trim();
}
function pptx(buf) {
  const f = unzip(buf, n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  return Object.keys(f).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map(k => `--- Slide ${k.match(/\d+/)[0]} ---\n` + xmlText(f[k].replace(/<\/a:p>/g, '\n')).trim()).join('\n\n');
}
function xlsx(buf) {
  const f = unzip(buf, n => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared = [...(f['xl/sharedStrings.xml'] || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlText(m[1]));
  const names = [...(f['xl/workbook.xml'] || '').matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(m => xmlText(m[1]));
  return Object.keys(f).filter(k => k.includes('worksheets/')).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])).map((k, i) => {
    const rows = [...f[k].matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(r => [...r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(c => {
      const v = (c[2] || '').match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? xmlText((c[2] || '').match(/<is>([\s\S]*?)<\/is>/)?.[1] || '');
      return /t="s"/.test(c[1]) ? shared[Number(v)] ?? '' : xmlText(v);
    }).join('\t'));
    return `--- Sheet ${names[i] || i + 1} ---\n` + rows.join('\n');
  }).join('\n\n');
}
// PDF: lấy chữ từ các luồng nội dung (đủ cho PDF xuất từ Word/Excel; PDF scan không có chữ).
function pdf(buf) {
  const s = buf.toString('latin1'), parts = [];
  for (const m of s.matchAll(/<<([\s\S]{0,400}?)>>\s*stream\r?\n/g)) {
    const start = m.index + m[0].length, end = s.indexOf('endstream', start);
    if (end < 0) continue;
    let data = buf.subarray(start, end);
    if (/FlateDecode/.test(m[1])) { try { data = zlib.inflateSync(data); } catch { try { data = zlib.inflateRawSync(data.subarray(2)); } catch { continue; } } }
    else if (/Filter/.test(m[1])) continue;
    const c = data.toString('latin1');
    if (!/BT[\s\S]*?ET/.test(c)) continue;
    for (const bt of c.matchAll(/BT([\s\S]*?)ET/g)) {
      let line = '';
      for (const t of bt[1].matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:[^\]])*)\]\s*TJ|(T\*|Td|TD|')/g)) {
        if (t[3]) { line += '\n'; continue; }
        const raw = t[1] ?? [...t[2].matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map(x => x[1]).join('');
        line += raw.replace(/\\([nrtbf()\\]|\d{1,3})/g, (_, e) => ({ n: '\n', r: '', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[e] ?? String.fromCharCode(parseInt(e, 8))));
      }
      parts.push(line);
    }
  }
  const text = parts.join('\n').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > 20 ? text : '';
}
const IMAGE_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.xml', '.html', '.htm', '.log', '.ini', '.yml', '.yaml']);
function extract(abs, buf) {
  const ext = path.extname(abs).toLowerCase();
  if (TEXT_EXT.has(ext)) return buf.toString('utf8').replace(/^\uFEFF/, '');
  if (ext === '.docx') return docx(buf);
  if (ext === '.xlsx' || ext === '.xlsm') return xlsx(buf);
  if (ext === '.pptx') return pptx(buf);
  if (ext === '.pdf') return pdf(buf) || '[PDF không có lớp chữ (có thể là bản scan) — mở tệp và đính kèm vào cuộc trò chuyện để Claude đọc hình.]';
  return null;
}

// ---------- Công cụ (chỉ đọc) ----------
const TOOLS = [
  { name: 'nas_roots', description: 'Các thư mục gốc của kho file nội bộ mà tiện ích được phép đọc, và tài khoản hiện tại có mở được không.', inputSchema: { type: 'object', properties: {} } },
  { name: 'nas_list', description: 'Liệt kê thư mục trong kho file (tên, loại, dung lượng, ngày sửa). Chỉ hiện những gì tài khoản Windows của người dùng được quyền xem.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Đường dẫn trong kho, vd. "#10.DuAn\\NOXH-DuongXa" hoặc đường dẫn UNC đầy đủ. Trống = thư mục gốc.' } } } },
  { name: 'nas_search', description: 'Tìm tệp / thư mục theo tên (không dấu, không phân biệt hoa thường) trong kho file, có giới hạn thời gian.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Các từ có trong tên tệp, vd. "hop dong tu van"' }, path: { type: 'string', description: 'Thư mục bắt đầu tìm (trống = gốc)' }, limit: { type: 'number', description: 'Tối đa kết quả (≤ 100)' } }, required: ['query'] } },
  { name: 'nas_read', description: 'Đọc nội dung một tệp trong kho: chữ của TXT/CSV/MD, DOCX, XLSX, PPTX, PDF có lớp chữ; ảnh JPG/PNG (≤ 5 MB) trả về dạng ảnh để đọc. Chỉ đọc, không sửa.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Đường dẫn tệp trong kho' }, max_chars: { type: 'number', description: `Số ký tự tối đa trả về (mặc định ${DEFAULT_CHARS})` }, offset: { type: 'number', description: 'Bỏ qua bấy nhiêu ký tự đầu (đọc tiếp phần sau)' } }, required: ['path'] } },
];
const fold = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

const handlers = {
  async nas_roots() {
    return ROOTS.map(r => { try { fs.readdirSync(r); return `${r}  — mở được`; } catch (e) { return `${r}  — ${why(e)}`; } }).join('\n');
  },
  async nas_list({ path: p }) {
    const abs = resolveIn(p);
    const ents = fs.readdirSync(abs, { withFileTypes: true });
    const rows = [];
    for (const d of ents.slice(0, MAX_LIST)) {
      let info = '';
      try { const st = fs.statSync(path.join(abs, d.name)); info = d.isDirectory() ? `thư mục · ${day(st.mtime)}` : `${fmtSize(st.size)} · ${day(st.mtime)}`; }
      catch (e) { info = e.code === 'EACCES' || e.code === 'EPERM' ? 'không có quyền' : '?'; }
      rows.push(`${d.isDirectory() ? '[DIR] ' : '      '}${d.name}  (${info})`);
    }
    return `${abs}\n${rows.join('\n') || '(trống)'}${ents.length > MAX_LIST ? `\n… còn ${ents.length - MAX_LIST} mục, hãy liệt kê thư mục con cụ thể hơn` : ''}`;
  },
  async nas_search({ query, path: p, limit }) {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) throw new Error('Nhập từ cần tìm');
    const max = Math.min(MAX_HITS, Math.max(1, Number(limit) || 30)), t0 = Date.now(), hits = [];
    let dirs = 0, denied = 0, stopped = '';
    const queue = [resolveIn(p)];
    while (queue.length && hits.length < max) {
      if (Date.now() - t0 > SEARCH_MS) { stopped = 'hết thời gian'; break; }
      if (++dirs > SEARCH_DIRS) { stopped = 'quá nhiều thư mục'; break; }
      const dir = queue.shift();
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { denied++; continue; }
      for (const d of ents) {
        const full = path.join(dir, d.name);
        if (d.isDirectory()) queue.push(full);
        if (words.every(w => fold(d.name).includes(w))) { hits.push((d.isDirectory() ? '[DIR] ' : '') + full); if (hits.length >= max) break; }
      }
    }
    return `${hits.length} kết quả${stopped ? ` (dừng: ${stopped} — thu hẹp thư mục bắt đầu)` : ''}${denied ? `; ${denied} thư mục không có quyền mở, bỏ qua` : ''}\n${hits.join('\n')}`;
  },
  async nas_read({ path: p, max_chars, offset }) {
    const abs = resolveIn(p);
    const st = fs.statSync(abs);
    if (st.isDirectory()) throw new Error('Đây là thư mục — dùng nas_list');
    if (st.size > MAX_READ_BYTES) throw new Error(`Tệp ${fmtSize(st.size)} quá lớn để đọc (tối đa ${fmtSize(MAX_READ_BYTES)})`);
    // Ảnh (bản scan chụp, sơ đồ): gửi ảnh để Claude tự đọc chữ trong ảnh.
    const img = IMAGE_EXT[path.extname(abs).toLowerCase()];
    if (img) {
      if (st.size > MAX_IMAGE_BYTES) throw new Error(`Ảnh ${fmtSize(st.size)} quá lớn (tối đa ${fmtSize(MAX_IMAGE_BYTES)}) — mở ảnh và đính kèm vào cuộc trò chuyện`);
      return [{ type: 'text', text: `${abs}\n(ảnh ${fmtSize(st.size)}, sửa ${day(st.mtime)})` }, { type: 'image', data: fs.readFileSync(abs).toString('base64'), mimeType: img }];
    }
    const text = extract(abs, fs.readFileSync(abs));
    if (text == null) return `${abs}\n(${fmtSize(st.size)}) Định dạng ${path.extname(abs) || 'không đuôi'} chưa đọc được chữ. Mở tệp và đính kèm vào cuộc trò chuyện nếu cần.`;
    const from = Math.max(0, Number(offset) || 0), n = Math.min(200000, Math.max(1000, Number(max_chars) || DEFAULT_CHARS));
    const part = text.slice(from, from + n);
    return `${abs}\n(${fmtSize(st.size)}, sửa ${day(st.mtime)}; ký tự ${from}–${from + part.length} / ${text.length})\n\n${part}${from + n < text.length ? `\n\n… còn tiếp: gọi lại với offset=${from + n}` : ''}`;
  },
};

// ---------- MCP qua stdio (JSON-RPC 2.0, mỗi dòng một thông điệp) ----------
const send = msg => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
readline.createInterface({ input: process.stdin }).on('line', async line => {
  let req; try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  if (id === undefined) return; // thông báo (notifications/initialized…)
  try {
    if (method === 'initialize') return send({ id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'kepler-nas', version: VERSION },
      instructions: 'Kho file nội bộ Kepler (NAS) — chỉ đọc, theo quyền tài khoản Windows của người dùng. Khi trả lời từ tệp, ghi rõ đường dẫn tệp đã đọc.' } });
    if (method === 'ping') return send({ id, result: {} });
    if (method === 'tools/list') return send({ id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      const h = handlers[params?.name];
      if (!h) return send({ id, error: { code: -32601, message: `Không có công cụ ${params?.name}` } });
      try { const out = await h(params.arguments || {}); return send({ id, result: { content: Array.isArray(out) ? out : [{ type: 'text', text: out }] } }); }
      catch (e) { return send({ id, result: { isError: true, content: [{ type: 'text', text: why(e) }] } }); }
    }
    send({ id, error: { code: -32601, message: `Không hỗ trợ ${method}` } });
  } catch (e) { send({ id, error: { code: -32603, message: e.message } }); }
});
