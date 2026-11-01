// So phản hồi JSON của HAI máy chủ thử (trước/sau tối ưu) trên cùng bộ GET của perf.mjs, theo từng vai trò.
//   BASE_A=http://127.0.0.1:4310 BASE_B=http://127.0.0.1:4311 node scripts/perf-compare.mjs [--allow allow.txt] [--max 20]
// Hai máy chủ phải chạy trên hai bản sao CÙNG một CSDL mẫu (kepper_perf) và không ai ghi vào giữa chừng.
// Chuẩn hoá: bỏ khoá generatedAt, sắp khoá đối tượng theo thứ tự chữ; mảng giữ nguyên thứ tự (thứ tự là một phần của API).
// --allow <tệp>: mỗi dòng một luật, '#' là chú thích:
//     <đường-dẫn-trường>                  áp cho mọi endpoint
//     <glob-endpoint> <đường-dẫn-trường>   chỉ áp cho endpoint khớp (vd. /api/work* items[].description)
//   đường dẫn trường dạng a.b[].c (chỉ số mảng viết là []), '*' khớp mọi ký tự; luật cũng bao các trường con.
//   Trường bị bỏ ở B (có ở A, không có ở B) hay thêm ở B đều tính là "khác" nếu không được cho phép.
// Mã thoát: 0 = không khác biệt ngoài danh sách cho phép; 1 = có khác biệt; 2 = lỗi chạy.
import fs from 'node:fs';
import { buildPages } from './perf.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const A = process.env.BASE_A, Bb = process.env.BASE_B;
const PW = process.env.PERF_PW || 'Perf@2026';
const ROLES = (process.env.ROLES || 'giamdoc,pmo,tb.qlxd,nv.qlxd,tb.phaply,nv.pf01').split(',');
const MAX = +arg('--max', 20);
const IGNORE_KEYS = new Set(['generatedAt']);
if (!A || !Bb) { console.error('Thiếu BASE_A / BASE_B'); process.exit(2); }

const globRe = g => new RegExp('^' + g.replace(/[.+?^${}()|\\]/g, '\\$&').replace(/\[\]/g, '\\[\\]').replace(/\*/g, '.*') + '$');
const rules = [];
const allowFile = arg('--allow');
if (allowFile) {
  for (const raw of fs.readFileSync(allowFile, 'utf8').split(/\r?\n/)) {
    const l = raw.replace(/#.*/, '').trim(); if (!l) continue;
    const parts = l.split(/\s+/);
    const [ep, field] = parts.length > 1 ? [parts[0], parts[1]] : ['*', parts[0]];
    rules.push({ ep: globRe(ep), field: globRe(field), fieldSrc: field });
  }
}
const allowed = (ep, path) => rules.some(r => r.ep.test(ep) && (r.field.test(path) || path.split('.').some((_, i, a) => r.field.test(a.slice(0, i + 1).join('.')))));

async function login(B, u) {
  const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) });
  if (!r.ok) throw new Error(`đăng nhập ${u} @ ${B}: ${r.status}`);
  return (await r.json()).token;
}
async function fetchOne(B, token, p) {
  const r = await fetch(B + p, { headers: { authorization: 'Bearer ' + token } });
  const text = await r.text();
  let body = text;
  if ((r.headers.get('content-type') || '').includes('json')) { try { body = JSON.parse(text); } catch { /* giữ text */ } }
  return { status: r.status, body };
}
const norm = v => Array.isArray(v) ? v.map(norm)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter(k => !IGNORE_KEYS.has(k)).sort().map(k => [k, norm(v[k])])) : v;

// Trả về danh sách {path (có chỉ số), key (chỉ số → []), kind, a, b}
function diff(a, b, path, key, out) {
  if (a === b) return;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a, tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) return void out.push({ path, key, kind: 'kiểu', a: ta, b: tb });
  if (ta === 'array') {
    if (a.length !== b.length) out.push({ path, key, kind: 'độ dài mảng', a: a.length, b: b.length });
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${path}[${i}]`, `${key}[]`, out);
  } else if (ta === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const p = path ? `${path}.${k}` : k, kk = key ? `${key}.${k}` : k;
      if (!(k in b)) out.push({ path: p, key: kk, kind: 'chỉ có ở A', a: 'có', b: '—' });
      else if (!(k in a)) out.push({ path: p, key: kk, kind: 'chỉ có ở B', a: '—', b: 'có' });
      else diff(a[k], b[k], p, kk, out);
    }
  } else out.push({ path, key, kind: 'giá trị', a, b });
}
const show = v => { const s = typeof v === 'string' ? JSON.stringify(v) : String(v); return s.length > 60 ? s.slice(0, 57) + '…' : s; };

async function main() {
  const adminA = await login(A, 'giamdoc');
  const jget = async (B, t, p) => (await fetchOne(B, t, p)).body;
  const projects = (await jget(A, adminA, '/api/projects')) || [];
  const big = projects.filter(p => p.kind === 'MTL').find(p => /^PF/.test(p.key)) || projects.find(p => p.kind === 'MTL');
  const firstItem = big ? ((await jget(A, adminA, `/api/projects/${big.id}/mtl`))?.items || [])[0] : null;
  const pagesB = buildPages(big, firstItem); // id dự án giống nhau vì hai bản sao cùng mẫu
  let total = 0, checked = 0, tolerated = 0;
  for (const role of ROLES) {
    const [ta, tb] = [await login(A, role), await login(Bb, role)];
    for (const p of pagesB) {
      const [ra, rb] = [await fetchOne(A, ta, p), await fetchOne(Bb, tb, p)];
      checked++;
      const ep = p.replace(String(big?.id), ':big').replace(String(firstItem?.id), ':item');
      const out = [];
      if (ra.status !== rb.status) out.push({ path: '(status)', key: '(status)', kind: 'HTTP status', a: ra.status, b: rb.status });
      else diff(norm(ra.body), norm(rb.body), '', '', out);
      const bad = out.filter(d => !allowed(ep, d.key)), ok = out.length - bad.length;
      tolerated += ok;
      if (!bad.length) continue;
      total += bad.length;
      console.log(`✗ [${role}] ${ep}: ${bad.length} khác biệt${ok ? ` (+${ok} được phép)` : ''}`);
      for (const d of bad.slice(0, MAX)) console.log(`    ${d.path || '(gốc)'}  [${d.kind}]  A=${show(d.a)}  B=${show(d.b)}`);
      if (bad.length > MAX) console.log(`    … và ${bad.length - MAX} khác biệt nữa`);
    }
  }
  console.log(`\nĐã so ${checked} lời gọi (${ROLES.length} vai trò × ${pagesB.length} đường dẫn). Khác biệt ngoài danh sách cho phép: ${total}; được phép: ${tolerated}.`);
  process.exitCode = total ? 1 : 0;
}
main().catch(e => { console.error(e); process.exitCode = 2; });
