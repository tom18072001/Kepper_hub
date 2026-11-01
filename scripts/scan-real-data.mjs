// Guard against accidentally committing common personal identifiers in demo assets.
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const roots = ['app/server/src', 'app/server/prisma', 'app/e2e', 'app/mcp', 'app/web'];
const extensions = new Set(['.js', '.mjs', '.json', '.ts', '.html', '.csv', '.txt', '.md', '.png', '.jpg', '.jpeg', '.webp']);
const asset = /(^|[\\/])(seed[^\\/]*|[^\\/]*\.test\.[cm]?js|test|tests|fixtures?|screenshots?|__snapshots__)([\\/]|$)/i;
const patterns = [
  ['email', /\b[A-Z0-9._%+-]+@(?!example\.(?:com|org|net)\b|test\b|invalid\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ['phone', /(?:^|\D)(?:\+?84|0)(?:3|5|7|8|9)\d{8}(?!\d)/g],
  ['citizen-id', /(?<![\da-f-])\d{12}(?![\da-f-])/gi],
];

export async function scan(base = process.cwd(), directories = roots) {
  let scanned = 0;
  const findings = [];
  async function visit(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      const filename = resolve(dir, entry.name);
      if (entry.isDirectory()) { await visit(filename); continue; }
      if (!entry.isFile() || !extensions.has(extname(entry.name).toLowerCase())) continue;
      const name = relative(base, filename);
      if (!asset.test(name)) continue;
      scanned++;
      if (/\.(png|jpe?g|webp)$/i.test(name)) continue; // Binary assets require manual review.
      const text = await readFile(filename, 'utf8');
      for (const [rule, regex] of patterns) {
        regex.lastIndex = 0;
        for (const match of text.matchAll(regex)) {
          findings.push({ file: name, line: text.slice(0, match.index).split('\n').length, rule });
        }
      }
    }
  }
  for (const dir of directories) await visit(resolve(base, dir));
  return { scanned, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await scan();
  console.log(JSON.stringify(result));
  if (result.scanned === 0 || result.findings.length) process.exitCode = 1;
}
