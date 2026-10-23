// Mã hoá theo trường cho dữ liệu "Hạn chế" (số CCCD, lương) — AES-256-GCM, thẻ xác thực 16 byte.
// Khoá: HR_ENC_KEY (32 byte, dạng hex 64 ký tự hoặc base64). Máy chạy thật (NODE_ENV=production) bật HRM mà thiếu khoá → không khởi động.
// Môi trường dev / test thiếu khoá: dẫn xuất từ JWT_SECRET (HKDF) để chạy được.
// Bản mã GẮN với chủ sở hữu bằng AAD (vd. "HrProfile:idNumber:12"): chép bản mã sang bản ghi khác trong CSDL → không giải mã được,
// nên người có quyền ghi CSDL không mượn được chức năng "tự xem" để giải mã hộ dữ liệu của người khác.
// Định dạng: "v1:<kid>:<iv>:<tag>:<bản mã>" (base64url); kid = mã khoá, chuẩn bị cho xoay khoá (HR_ENC_KEY_ID, mặc định k1).
// Mất khoá = mất dữ liệu đã mã hoá → giữ khoá cùng chỗ với khoá sao lưu (README). Xoá khoá = huỷ toàn bộ (crypto-shredding).
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
const kidOf = env => (/^[a-z0-9]{1,8}$/.test(String(env?.HR_ENC_KEY_ID || '')) ? env.HR_ENC_KEY_ID : 'k1');
const b64 = b => b.toString('base64url');
function aadOf(context) {
  if (!context || typeof context !== 'string') throw new Error('Thiếu ngữ cảnh mã hoá (AAD)');
  return Buffer.from(context, 'utf8');
}
// context: "<Bảng>:<trường>:<id chủ sở hữu>" — bắt buộc, phải giống nhau khi mã hoá và giải mã.
function encrypt(plain, context, env = process.env) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyOf(env), iv, { authTagLength: 16 });
  c.setAAD(aadOf(context));
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${kidOf(env)}:${b64(iv)}:${b64(c.getAuthTag())}:${b64(ct)}`;
}
function decrypt(value, context, env = process.env) {
  if (!value) return null;
  const [v, kid, iv, tag, ct] = String(value).split(':');
  if (v !== 'v1' || !kid || !iv || !tag || ct === undefined) throw new Error('Dữ liệu mã hoá không đúng định dạng');
  if (kid !== kidOf(env)) throw new Error(`Bản mã dùng khoá ${kid}, khoá hiện tại ${kidOf(env)}`);
  const t = Buffer.from(tag, 'base64url');
  if (t.length !== 16) throw new Error('Thẻ xác thực không hợp lệ');
  const d = crypto.createDecipheriv('aes-256-gcm', keyOf(env), Buffer.from(iv, 'base64url'), { authTagLength: 16 });
  d.setAAD(aadOf(context));
  d.setAuthTag(t);
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
// Giải mã an toàn: khoá sai / dữ liệu hỏng / bản mã bị chép sang bản ghi khác → null (không làm sập trang), ghi log không kèm dữ liệu.
function tryDecrypt(value, context, env = process.env) {
  try { return decrypt(value, context, env); } catch (error) { console.error(JSON.stringify({ level: 'error', msg: 'field_decrypt_failed', context: String(context).split(':').slice(0, 2).join(':'), error: error.message })); return null; }
}
const last4 = s => { const d = String(s || '').replace(/\D/g, ''); return d ? d.slice(-4) : null; };
const AAD = { identity: userId => `HrProfile:idNumber:${userId}`, salary: contractId => `HrContract:salary:${contractId}` };

module.exports = { encrypt, decrypt, tryDecrypt, last4, keyOf, AAD, _reset: () => { cached = null; } };
