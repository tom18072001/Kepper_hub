const B='http://127.0.0.1:4332', fs=await import('node:fs');
const out={}; 
for (const u of ['giamdoc','pmo','tb.qlxd']) {
  const r=await fetch(B+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:u,password:'Perf@2026'})});
  const j=await r.json(); const tok=j.token||j.accessToken; const ck=r.headers.get('set-cookie');
  const h={...(tok?{authorization:'Bearer '+tok}:{}),...(ck?{cookie:ck.split(';')[0]}:{})};
  for (const p of ['/api/dashboard','/api/kpi']) {
    const ts=[]; let body;
    for(let k=0;k<7;k++){const t=performance.now(); const x=await fetch(B+p,{headers:h}); body=await x.json(); ts.push(performance.now()-t);}
    ts.sort((a,b)=>a-b); delete body.generatedAt; delete body.from; delete body.to;
    out[u+p]=body; console.log(u,p,'p50',ts[3].toFixed(0),'ms', JSON.stringify(body).length,'B');
  }
}
fs.writeFileSync(process.argv[2],JSON.stringify(out,null,1));
