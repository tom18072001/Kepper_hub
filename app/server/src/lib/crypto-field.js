// Mã hoá theo trường cho dữ liệu "Hạn chế" (số CCCD, lương) — AES-256-GCM.
// Khoá: HR_ENC_KEY (32 byte, dạng hex 64 ký tự hoặc base64). Máy chạy thật (NODE_ENV=production) bật HRM mà thiếu khoá → không khởi động.
// Môi trường dev / test thiếu khoá: dẫn xuất từ JWT_SECRET (HKDF) để chạy được, kèm cảnh báo.
// Định dạng lưu: "v1:<iv>:<tag>:<bản mã>" (base64url). Mất khoá = mất dữ liệu đã mã hoá → giữ khoá cùng chỗ với khoá sao lưu (README).
// Bản sao lưu CSDL chỉ chứa bản mã; xoá khoá = huỷ toàn bộ (crypto-shredding).
const crypto = require('node:crypto');

let cached = null;
function parseKey(raw) {
  const s = String(raw || '').trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return Buffer.from(s, 'hex');
  try { const b = Buffer.from(s, 'base64'); if (b.length === 32) return b; } catch { /* bỏ qua */ }
  return null;
}
function keyOf(env = process.env) {
  if (cached && cached.env === env) return cached.key;
  let key = env.HR_ENC_KEY ? parseKey(env.HR_ENC_KEY) : null;
  if (env.HR_ENC_KEY && !key) throw new Error('HR_ENC_KEY phải là 32 byte (64 ký tự hex — tạo bằng: openssl rand -hex 32)');
  if (!key) {
    if (env.NODE_ENV === 'production') throw new Error('Bật HRM trên máy chạy cần HR_ENC_KEY (openssl rand -hex 32) — khoá mã hoá số CCCD, lương');
    key = Buffer.from(crypto.hkdfSync('sha256', String(env.JWT_SECRET || 'dev'), 'kepper-hr', 'field-v1', 32));
  }
  cached = { env, key };
  return key;
}
const b64 = b => b.toString('base64url');
function encrypt(plain, env) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyOf(env), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${b64(iv)}:${b64(c.getAuthTag())}:${b64(ct)}`;
}
function decrypt(value, env) {
  if (!value) return null;
  const [v, iv, tag, ct] = String(value).split(':');
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Dữ liệu mã hoá không đúng định dạng');
  const d = crypto.createDecipheriv('aes-256-gcm', keyOf(env), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
// Giải mã an toàn: khoá sai / dữ liệu hỏng → null (không làm sập trang), ghi log không kèm dữ liệu.
function tryDecrypt(value, env) {
  try { return decrypt(value, env); } catch (error) { console.error(JSON.stringify({ level: 'error', msg: 'field_decrypt_failed', error: error.message })); return null; }
}
const last4 = s => { const d = String(s || '').replace(/\D/g, ''); return d ? d.slice(-4) : null; };

module.exports = { encrypt, decrypt, tryDecrypt, last4, keyOf, _reset: () => { cached = null; } };
