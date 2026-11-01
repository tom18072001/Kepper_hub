const B = process.env.BASE;
async function login(u) {
  const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: 'Perf@2026' }) });
  const j = await r.json().catch(() => ({})); return { cookie: r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '), ...(j.token ? { authorization: 'Bearer ' + j.token } : {}) };
}
const paths = process.argv.slice(2);
for (const u of ['giamdoc', 'pmo', 'tb.qlxd']) {
  const h = await login(u);
  for (const p of paths) {
    const ts = []; let b = 0;
    for (let i = 0; i < 9; i++) {
      const t = performance.now();
      const r = await fetch(B + p, { headers: h });
      const buf = await r.arrayBuffer();
      ts.push(performance.now() - t); b = buf.byteLength;
    }
    ts.sort((a, c) => a - c);
    console.log(u, p, 'p50', Math.round(ts[4]), 'ms', b, 'bytes');
  }
}
