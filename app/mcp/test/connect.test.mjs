// Kết nối nhanh của tiện ích (không cần máy chủ Kepper thật): chưa có token → xin kết nối, chờ người dùng "Cho phép",
// nhận token, lưu vào thư mục người dùng; token bị thu hồi → tự xin lại; token cấu hình tay bị thu hồi → báo lỗi, không tự xin.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kepper-claude-'));
process.env.KEPPER_STATE_DIR = dir;
process.env.KEPPER_NO_BROWSER = '1';
const { createSession } = await import('../server.js');

// Máy chủ giả: /start → mã; /poll → chờ 1 lần rồi trao token; /api/me → 200 với token đúng.
function fakeKepper({ approveAfter = 1 } = {}) {
  const st = { starts: 0, polls: 0, valid: new Set() };
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body });
  st.fetch = async (url, opts = {}) => {
    const p = new URL(url).pathname;
    if (p === '/api/claude/connect/start') { st.starts++; return res(201, { deviceCode: 'dc' + st.starts, userCode: 'ABCD-EF23', verifyPath: '/#/claude?connect=ABCD-EF23', interval: 0.01, expiresIn: 600 }); }
    if (p === '/api/claude/connect/poll') { st.polls++; if (st.polls <= approveAfter) return res(202, { status: 'pending' }); const t = 'kpt_test_' + st.starts; st.valid.add(t); return res(200, { status: 'approved', token: t }); }
    const auth = String(opts.headers?.authorization || '').slice(7);
    return st.valid.has(auth) ? res(200, { fullName: 'Người dùng giả' }) : res(401, { error: 'Token không hợp lệ' });
  };
  return st;
}

test('chưa có token: xin kết nối, người dùng bấm Cho phép kịp → câu hỏi đầu tiên chạy luôn; token được lưu', async () => {
  const k = fakeKepper();
  const call = createSession({ base: 'http://kepper.test', envToken: '', fetchImpl: k.fetch, wait: 2000 });
  assert.equal((await call('/api/me')).fullName, 'Người dùng giả');
  assert.equal(k.starts, 1);
  const saved = fs.readdirSync(dir).filter(f => f.startsWith('token-'));
  assert.equal(saved.length, 1);
  // Phiên mới (Claude Desktop mở lại) dùng token đã lưu, không xin lại.
  const again = createSession({ base: 'http://kepper.test', envToken: '', fetchImpl: k.fetch, wait: 2000 });
  assert.equal((await again('/api/me')).fullName, 'Người dùng giả');
  assert.equal(k.starts, 1);
});

test('chưa bấm Cho phép trong thời gian chờ → báo mã kết nối và đường dẫn, không treo', async () => {
  const k = fakeKepper({ approveAfter: 1e9 });
  const call = createSession({ base: 'http://other.test', envToken: '', fetchImpl: k.fetch, wait: 50 });
  await assert.rejects(call('/api/me'), e => e.status === 401 && /Cho phép/.test(e.message) && /ABCD-EF23/.test(e.message) && /other\.test\/#\/claude\?connect=/.test(e.message));
});

test('token cấu hình tay bị thu hồi → lỗi "chưa xác thực", không tự xin kết nối', async () => {
  const k = fakeKepper();
  const call = createSession({ base: 'http://manual.test', envToken: 'kpt_revoked', fetchImpl: k.fetch, wait: 50 });
  await assert.rejects(call('/api/me'), e => e.status === 401);
  assert.equal(k.starts, 0);
});
