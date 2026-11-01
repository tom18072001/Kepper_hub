const fs=require('fs'),path=require('path');
const it=JSON.parse(fs.readFileSync(process.argv[2]||'.tmp-s2/sample.json')).items[0];
const files=[];(function w(d){for(const f of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,f.name);if(f.isDirectory())w(p);else if(/[.](js|mjs|html)$/.test(f.name))files.push(p)}})('app/web');
const src=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const mcp=fs.readFileSync('app/mcp/server.js','utf8');
const used=[],unused=[];
for(const k of Object.keys(it)){
  const re=new RegExp('(^|[^A-Za-z0-9_])'+k+'([^A-Za-z0-9_]|$)','g');
  const n=(src.match(re)||[]).length;
  (n?used:unused).push(k+'('+n+')'+(re.test(mcp)?'[MCP]':''));
}
console.log('USED',used.join(' '));console.log('UNUSED',unused.join(' '));
