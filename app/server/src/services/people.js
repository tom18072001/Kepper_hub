// Tách / khớp tên người trong ô văn bản (vd. cột "Đầu mối" của MTL bộ phận) với tài khoản. Hàm thuần.
const { norm } = require('./plan-parser');

// "- Đ/c Nguyễn Văn A\n- Đ/c Trần B" → ["Nguyễn Văn A", "Trần B"]
function splitPeople(text) {
  return String(text || '').split(/[\n;]+/)
    .map(s => s.replace(/^[\s\-–•+*]+/, '').replace(/^(đ\/c|đồng chí|ông|bà|anh|chị)\s+/i, '').trim())
    .filter(Boolean);
}
// Khớp tên (không phân biệt hoa thường, dấu) hoặc tên đăng nhập → { ids, unmatched }.
function matchPeople(text, users) {
  const byName = new Map();
  for (const u of users) { byName.set(norm(u.fullName), u.id); if (u.username) byName.set(norm(u.username), u.id); }
  const ids = [], unmatched = [];
  for (const p of splitPeople(text)) { const id = byName.get(norm(p)); if (id) { if (!ids.includes(id)) ids.push(id); } else unmatched.push(p); }
  return { ids, unmatched };
}
module.exports = { splitPeople, matchPeople };
