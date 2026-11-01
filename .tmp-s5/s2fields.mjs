const A='http://127.0.0.1:4352',B='http://127.0.0.1:4351';
const login=async(b,u)=>(await (await fetch(b+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:u,password:'Perf@2026'})})).json()).token;
const get=async(b,t,p)=>(await fetch(b+p,{headers:{authorization:'Bearer '+t}})).json();
const agg={};
const note=(ep,kind,k,a,b)=>{const m=(agg[ep]??={});const key=kind+' '+k;(m[key]??={n:0,ex:[a,b]}).n++;};
function diff(ep,a,b,k){ if(a===b)return;
 if(Array.isArray(a)&&Array.isArray(b)){ if(a.length!==b.length)note(ep,'LEN',k,a.length,b.length); for(let i=0;i<Math.min(a.length,b.length);i++)diff(ep,a[i],b[i],k+'[]'); return;}
 if(a&&b&&typeof a==='object'&&typeof b==='object'){ for(const x of new Set([...Object.keys(a),...Object.keys(b)])){ if(!(x in b))note(ep,'onlyA',k+'.'+x,JSON.stringify(a[x])?.slice(0,30)); else if(!(x in a))note(ep,'onlyB',k+'.'+x,JSON.stringify(b[x])?.slice(0,30)); else diff(ep,a[x],b[x],k+'.'+x);} return;}
 note(ep,'VAL',k,JSON.stringify(a)?.slice(0,40),JSON.stringify(b)?.slice(0,40)); }
const big=(await get(A,await login(A,'giamdoc'),'/api/projects')).filter(p=>p.kind==='MTL').find(p=>/^PF/.test(p.key));
for(const u of ['giamdoc','pmo','tb.qlxd','nv.qlxd','tb.phaply','nv.pf01']){const [ta,tb]=[await login(A,u),await login(B,u)];
 for(const [ep,p] of [['work','/api/work'],['my','/api/my/items'],['my-created','/api/my/items?mode=created'],['proj',`/api/projects/${big.id}/items`]]) diff(ep,await get(A,ta,p),await get(B,tb,p),'');}
for(const [ep,m] of Object.entries(agg)){console.log('##',ep);for(const [k,v] of Object.entries(m))console.log(' ',k,v.n,JSON.stringify(v.ex));}
