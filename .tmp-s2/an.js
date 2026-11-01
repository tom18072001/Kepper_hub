const j=JSON.parse(require('fs').readFileSync('.tmp-s2/sample.json'));const it=j.items;console.log(it.length,Object.keys(j));
const sz={};for(const i of it)for(const k in i)sz[k]=(sz[k]||0)+JSON.stringify(i[k]??null).length+k.length+4;
console.log(Object.entries(sz).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+':'+Math.round(v/1024)).join(' '));console.log(JSON.stringify(it[0]))
