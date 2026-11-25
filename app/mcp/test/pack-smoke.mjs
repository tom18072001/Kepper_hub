// Gói tiện ích Claude (.mcpb) THẬT, đúng tệp Hub phát cho người dùng: giải nén rồi chạy như Claude Desktop
// (node <gói>/server.js, biến môi trường theo manifest), bắt tay bằng MCP client thật: initialize + tools/list.
// Đạt khi khởi động được, server.js báo đúng phiên bản manifest, và công cụ trả về khớp đúng danh sách khai báo trong manifest.
// Bắt lỗi đóng gói thiếu tệp: gói 0.6.0 (24/11/2026) thiếu weekly-draft.cjs nên chết ngay khi khởi động trên máy người dùng,
// trong khi test chạy trong app/mcp (đủ tệp) vẫn xanh.
//   unzip -q kepler-claude.mcpb -d /tmp/mcpb && node app/mcp/test/pack-smoke.mjs /tmp/mcpb     (CI: bước "Gói tiện ích Claude")
// Không cần Kepler Hub chạy: chỉ liệt kê công cụ (địa chỉ Hub thử là một cổng đóng).
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const dir = path.resolve(process.argv[2] || '.');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const cfg = manifest.server?.mcp_config;
if (!cfg) throw new Error('manifest.json thiếu server.mcp_config');
const TEST_CONFIG = { kepper_url: 'http://127.0.0.1:9', kepper_token: '' };
// Thay biến như Claude Desktop: ${__dirname} = thư mục gói, ${user_config.x} = giá trị thử.
const fill = v => String(v).replaceAll('${__dirname}', dir).replace(/\$\{user_config\.([a-z_]+)\}/g, (_, k) => TEST_CONFIG[k] ?? '');
const env = { ...process.env, ...Object.fromEntries(Object.entries(cfg.env || {}).map(([k, v]) => [k, fill(v)])) };

const errors = [];
const transport = new StdioClientTransport({ command: process.execPath, args: (cfg.args || []).map(fill), env, cwd: dir, stderr: 'pipe' });
transport.stderr?.on('data', d => errors.push(String(d)));
const client = new Client({ name: 'kiem-goi-mcpb', version: '1.0.0' });
const fail = msg => {
  console.error(`HỎNG — gói ${manifest.version}: ${msg}`);
  if (errors.length) console.error(errors.join('').slice(-3000));
  process.exit(1);
};
const timer = setTimeout(() => fail('quá 30 giây chưa bắt tay xong'), 30_000);
try {
  await client.connect(transport);
  const server = client.getServerVersion();
  if (server?.version !== manifest.version) fail(`server.js báo phiên bản ${server?.version}, manifest ghi ${manifest.version}`);
  const { tools } = await client.listTools();
  const got = tools.map(t => t.name).sort(), want = (manifest.tools || []).map(t => t.name).sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`công cụ không khớp manifest — thiếu: ${want.filter(n => !got.includes(n)).join(', ') || 'không'}; thừa: ${got.filter(n => !want.includes(n)).join(', ') || 'không'}`);
  }
  console.log(`OK — gói ${manifest.version}: khởi động được, ${got.length} công cụ khớp manifest`);
} catch (error) {
  fail(error.message);
} finally {
  clearTimeout(timer);
  await client.close().catch(() => {});
}
