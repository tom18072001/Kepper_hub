const B='http://127.0.0.1:4355';
async function login(u){const r=await fetch(B+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:u,password:'Perf@2026'})});const c=r.headers.getSetCookie?.().map(x=>x.split(';')[0]).join('; ');const j=await r.json().catch(()=>({}));return {c,t:j.token};}
const fs=await import('node:fs');
for(const u of ['giamdoc','pmo','tb.qlxd']){
  const a=await login(u);const h={cookie:a.c,...(a.t?{authorization:'Bearer '+a.t}:{})};
  const get=async p=>{const t0=performance.now();const r=await fetch(B+p,{headers:h});const t=await r.text();return {ms:Math.round(performance.now()-t0),kb:Math.round(t.length/1024),st:r.status,t}};
  const projs=await (await fetch(B+'/api/projects',{headers:h})).json();
  const list=[['/api/work'],['/api/my/items'],['/api/my/items?mode=created']];
  const big=Array.isArray(projs)?projs.slice(0,40):[];
  for(const p of big) list.push(['/api/projects/'+p.id+'/items']);
  let mx=0;
  for(const [p] of list){const r=await get(p);if(p.includes('projects')){if(r.kb>mx){mx=r.kb;} if(r.kb>250)console.log(u,p,r.ms+'ms',r.kb+'KB');}else{console.log(u,p,r.ms+'ms',r.kb+'KB',r.st);}
   if(process.argv[2]&&p===process.argv[2]&&u==='giamdoc')fs.writeFileSync('.tmp-s2/sample.json',r.t);}
  console.log(u,'max project items KB',mx);
}
