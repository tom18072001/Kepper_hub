// Đo hiệu năng Kepper Hub trên BẢN THỬ có dữ liệu giả (sinh bằng scripts/perf-data.mjs).
//   BASE=http://127.0.0.1:4300 PERF_PW=Perf@2026 node scripts/perf.mjs [out.json]
// Pha A: từng API, từng vai trò, gọi tuần tự 5 lần → p50 + kích thước phản hồi.
// Pha B: N người dùng thật (mỗi người một tài khoản, có luồng /api/stream mở suốt) mở "trang chủ" (bộ lời gọi song song như trình duyệt)
//        mỗi INTERVAL giây trong DURATION giây → p50/p95/p99 tổng và theo API, số lỗi.
// Chỉ ĐỌC (GET) — không đổi dữ liệu. Không chạy vào bản thật.
import fs from 'node:fs';

const B = process.env.BASE || 'http://127.0.0.1:4300';
const PW = process.env.PERF_PW || 'Perf@2026';
const OUT = process.argv[2] || 'perf-result.json';
const VUS = +(process.env.VUS || 50), DURATION = +(process.env.DURATION || 60), INTERVAL = +(process.env.INTERVAL || 5);
const ROLES = (process.env.ROLES || 'giamdoc,pmo,tb.qlxd,nv.qlxd').split(',');
const HOME = ['/api/me', '/api/brand', '/api/approvals/counts', '/api/notifications', '/api/departments', '/api/labels', '/api/projects', '/api/settings', '/api/templates',
  '/api/users/directory', '/api/approvals/extensions', '/api/approvals/proposals', '/api/approvals/queue', '/api/mtl/portfolio', '/api/my/items', '/api/weekly/context',
  '/api/weekly/report', '/api/weekly/summary'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };

async function login(u) {
  const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) });
  if (!r.ok) throw new Error(`login ${u}: ${r.status}`);
  return (await r.json()).token;
}
async function get(token, p) {
  const t = performance.now();
  const r = await fetch(B + p, { headers: { authorization: 'Bearer ' + token } });
  const buf = await r.arrayBuffer();
  return { ms: performance.now() - t, s: r.status, bytes: buf.byteLength, body: r.headers.get('content-type')?.includes('json') ? buf : null };
}
const json = b => { try { return JSON.parse(Buffer.from(b).toString('utf8')); } catch { return null; } };

async function main() {
  const result = { base: B, at: new Date().toISOString(), single: {}, load: null };
  // ---------- Pha A ----------
  const admin = await login('giamdoc');
  const projects = json((await get(admin, '/api/projects')).body) || [];
  const mtls = projects.filter(p => p.kind === 'MTL');
  const big = mtls.find(p => /^PF/.test(p.key)) || mtls[0];
  const firstItem = big ? (json((await get(admin, `/api/projects/${big.id}/mtl`)).body)?.items || [])[0] : null;
  const PAGES = [...HOME, '/api/dashboard', '/api/work', '/api/kpi', '/api/kpi/me', '/api/my/sprint', '/api/search?q=thi%20c%C3%B4ng', '/api/weekly/compliance', '/api/dispatch/inbox',
    ...(big ? [`/api/projects/${big.id}`, `/api/projects/${big.id}/mtl`, `/api/projects/${big.id}/mtl-kpi`, `/api/projects/${big.id}/mtl-sprints`, `/api/projects/${big.id}/mtl-month`,
      `/api/projects/${big.id}/items`, `/api/projects/${big.id}/cycles`] : []),
    ...(firstItem ? [`/api/items/${firstItem.id}`] : [])];
  for (const role of (process.env.SINGLE === '0' ? [] : ROLES)) {
    const tk = await login(role);
    const rows = {};
    for (const p of PAGES) {
      const ms = []; let s = 0, bytes = 0;
      for (let i = 0; i < 5; i++) { const r = await get(tk, p); ms.push(r.ms); s = r.s; bytes = r.bytes; }
      rows[p.replace(String(big?.id), ':big').replace(String(firstItem?.id), ':item')] = { status: s, p50: q(ms, 0.5), max: q(ms, 1), kb: Math.round(bytes / 102.4) / 10 };
    }
    result.single[role] = rows;
    console.log(`\n== ${role}`);
    for (const [p, r] of Object.entries(rows).sort((a, b) => b[1].p50 - a[1].p50).slice(0, 12)) console.log(`${String(r.p50).padStart(6)} ms  ${String(r.kb).padStart(8)} KB  ${r.status}  ${p}`);
  }

  // ---------- Pha B ----------
  if (VUS > 0) {
    const dir = json((await get(admin, '/api/users/directory')).body) || [];
    const names = dir.map(u => u.username).filter(u => u && u !== 'admin').slice(0, VUS);
    const vus = [];
    for (const u of names) { try { vus.push({ u, token: await login(u) }); } catch (e) { console.log('bỏ', u, e.message); } }
    const streams = vus.map(v => { const ac = new AbortController();
      fetch(B + '/api/stream', { headers: { authorization: 'Bearer ' + v.token }, signal: ac.signal }).then(async r => { const rd = r.body.getReader(); for (;;) { const { done } = await rd.read(); if (done) break; } }).catch(() => {});
      return ac; });
    const per = {}, all = []; let errors = 0, pages = 0; const errByStatus = {};
    const end = Date.now() + DURATION * 1000;
    const t0 = Date.now();
    await Promise.all(vus.map(async v => {
      await sleep(Math.random() * INTERVAL * 1000);
      while (Date.now() < end) {
        const st = Date.now();
        const rs = await Promise.all(HOME.map(p => get(v.token, p).then(r => ({ p, ...r })).catch(() => ({ p, ms: 0, s: 0 }))));
        const pageMs = Date.now() - st; pages++;
        (per.__page ||= []).push(pageMs);
        for (const r of rs) {
          (per[r.p] ||= []).push(r.ms); all.push(r.ms);
          if (r.s >= 500 || r.s === 0 || r.s === 429) { errors++; errByStatus[r.s] = (errByStatus[r.s] || 0) + 1; }
        }
        await sleep(Math.max(0, INTERVAL * 1000 - (Date.now() - st)));
      }
    }));
    streams.forEach(a => a.abort());
    const secs = (Date.now() - t0) / 1000;
    result.load = { vus: vus.length, durationS: DURATION, intervalS: INTERVAL, requests: all.length, rps: Math.round(all.length / secs), errors, errByStatus,
      p50: q(all, 0.5), p95: q(all, 0.95), p99: q(all, 0.99), page: { n: pages, p50: q(per.__page, 0.5), p95: q(per.__page, 0.95), p99: q(per.__page, 0.99) },
      perApi: Object.fromEntries(Object.entries(per).filter(([k]) => k !== '__page').map(([k, a]) => [k, { p50: q(a, 0.5), p95: q(a, 0.95), p99: q(a, 0.99) }]).sort((a, b) => b[1].p95 - a[1].p95)) };
    console.log(`\n== Tải: ${vus.length} người, mỗi ${INTERVAL}s, ${DURATION}s — ${result.load.rps} lời gọi/s, p50 ${result.load.p50} ms, p95 ${result.load.p95} ms, p99 ${result.load.p99} ms, lỗi ${errors}`);
    console.log(`   trang chủ (cả bộ ${HOME.length} lời gọi): p50 ${result.load.page.p50} ms, p95 ${result.load.page.p95} ms`);
    for (const [p, r] of Object.entries(result.load.perApi).slice(0, 8)) console.log(`   ${String(r.p95).padStart(6)} ms p95  ${p}`);
  }
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
  console.log('\n→', OUT);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
