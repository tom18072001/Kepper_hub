// Viber Bot (đề xuất, MẶC ĐỊNH TẮT). Bật khi có VIBER_AUTH_TOKEN và VIBER_ENABLED=1 — chỉ sau khi chủ dự án hoàn tất
// hồ sơ đánh giá tác động chuyển DLCN ra nước ngoài (máy chủ Viber ở ngoài Việt Nam) — xem docs/data-protection-assessment.md.
// Người dùng tự liên kết: lấy mã một lần trong "Tài khoản của tôi" → gửi mã cho bot → bot gắn Viber ID (ghi thời điểm đồng ý).
// Tin nhắn tối thiểu hoá: mã hạng mục, loại cảnh báo, liên kết nội bộ.
const crypto = require('node:crypto');

const API = 'https://chatapi.viber.com/pa';
const enabled = () => process.env.VIBER_ENABLED === '1' && !!process.env.VIBER_AUTH_TOKEN;
const appLink = hashLink => `${String(process.env.APP_ORIGIN || '').replace(/\/$/, '')}/${hashLink}`;

// Chữ ký webhook: HMAC-SHA256(body thô, auth token) = header X-Viber-Content-Signature.
function validSignature(rawBody, signature, token = process.env.VIBER_AUTH_TOKEN) {
  if (!token || !signature || !rawBody) return false;
  const expected = crypto.createHmac('sha256', token).update(rawBody).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function call(method, body, fetchImpl = globalThis.fetch) {
  const r = await fetchImpl(`${API}/${method}`, { method: 'POST', headers: { 'X-Viber-Auth-Token': process.env.VIBER_AUTH_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (j.status !== 0) throw new Error(`viber_${method}_${j.status ?? r.status}: ${j.status_message || ''}`);
  return j;
}
async function sendText(viberId, textValue) {
  return call('send_message', { receiver: viberId, type: 'text', sender: { name: (process.env.VIBER_BOT_NAME || 'Kepper Hub').slice(0, 28) }, text: String(textValue).slice(0, 7000) });
}
// Gửi cho những người đã liên kết + đồng ý. Không bật → không làm gì.
async function sendToUsers(prisma, userIds, textValue) {
  if (!enabled() || !userIds?.length) return 0;
  const links = await prisma.viberLink.findMany({ where: { userId: { in: userIds }, viberId: { not: null }, consentAt: { not: null } }, select: { viberId: true } });
  let n = 0;
  for (const l of links) { try { await sendText(l.viberId, textValue); n++; } catch (e) { console.error(JSON.stringify({ level: 'warn', msg: 'viber_send_failed', error: e.message })); } }
  return n;
}
const newCode = () => crypto.randomInt(100000, 999999).toString();

module.exports = { enabled, appLink, validSignature, sendText, sendToUsers, newCode, call };
