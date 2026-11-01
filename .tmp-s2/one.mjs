import fs from 'node:fs';
const B=process.env.BASE;
const r=await fetch(B+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'giamdoc',password:'Perf@2026'})});
const j=await r.json();const h={authorization:'Bearer '+j.token,cookie:r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};
let max=0,mp;for(const id of [13,14,15,16,17,18,19,20,21,22,23,24]){const t=await (await fetch(B+'/api/projects/'+id+'/items',{headers:h})).arrayBuffer();if(t.byteLength>max){max=t.byteLength;mp=id}}
console.log('max project items bytes',max,mp);
const t=await (await fetch(B+'/api/projects/'+mp+'/items',{headers:h})).text();fs.writeFileSync('.tmp-s2/proj.json',JSON.stringify({items:JSON.parse(t)}));
