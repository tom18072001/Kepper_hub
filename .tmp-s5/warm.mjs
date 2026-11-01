const B='http://127.0.0.1:'+(process.env.P||4351)+'';
const login=async u=>(await (await fetch(B+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:u,password:'Perf@2026'})})).json()).token;
const g=async(t,p)=>{const s=performance.now();await (await fetch(B+p,{headers:{authorization:'Bearer '+t}})).arrayBuffer();return performance.now()-s;};
const dir=await (await fetch(B+'/api/users/directory',{headers:{authorization:'Bearer '+await login('giamdoc')}})).json();
const names=dir.map(u=>u.username).filter(u=>u&&u!=='admin').slice(0,+process.env.N||50);
const toks=[];for(const n of names)toks.push(await login(n));
const med=a=>[...a].sort((x,y)=>x-y)[a.length>>1];
for(const pass of [1,2,3]){const r=[];for(const t of toks)r.push(await g(t,'/api/mtl/portfolio'));console.log('pass',pass,'portfolio p50',Math.round(med(r)),'max',Math.round(Math.max(...r)));}
