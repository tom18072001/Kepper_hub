// Lịch công tác: đọc giờ ("08h30", "09h30 - 11h30", "Cả ngày", "Sáng"…), đọc trang tính lịch tuần theo mẫu văn bản
// (dòng tiêu đề "Thời gian | Nội dung | Thành phần | … Chủ trì | Địa điểm | Ghi chú", mỗi ngày bắt đầu bằng dòng "Thứ Hai, ngày 12/10/2026"),
// tách thành phần thành tên người để gắn tài khoản. Hàm thuần — kiểm thử được, không đụng CSDL.
const { norm } = require('./plan-parser');

// Phút trong ngày của giờ bắt đầu; null nếu cả ngày / không rõ.
function parseTime(text) {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/(\d{1,2})\s*(?:h|giờ|:)\s*(\d{1,2})?/);
  if (m) { const h = Number(m[1]), mm = Number(m[2] || 0); if (h < 24 && mm < 60) return h * 60 + mm; }
  if (/^sáng/.test(s)) return 8 * 60;
  if (/^trưa/.test(s)) return 12 * 60;
  if (/^chiều/.test(s)) return 13 * 60 + 30;
  if (/^tối/.test(s)) return 18 * 60;
  return null;
}

// "- Đ/c Nguyễn Văn A\n- Đ/c Trần B" → ["Nguyễn Văn A", "Trần B"]; dòng "Tập thể phòng …" giữ nguyên.
function splitPeople(text) {
  return String(text || '').split(/[\n;]+/)
    .map(s => s.replace(/^[\s\-–•+*]+/, '').replace(/^(đ\/c|đồng chí|ông|bà|anh|chị)\s+/i, '').trim())
    .filter(Boolean);
}
// Khớp tên người (không phân biệt hoa thường, dấu) với danh sách tài khoản → { ids, unmatched }.
function matchPeople(text, users) {
  const byName = new Map();
  for (const u of users) { byName.set(norm(u.fullName), u.id); if (u.username) byName.set(norm(u.username), u.id); }
  const ids = [], unmatched = [];
  for (const p of splitPeople(text)) { const id = byName.get(norm(p)); if (id) { if (!ids.includes(id)) ids.push(id); } else unmatched.push(p); }
  return { ids, unmatched };
}

// Dòng ngày: "Thứ Hai, ngày 12/10/2026", "Chủ Nhật, ngày 18/10/2026", "Thứ 2 (12/10/2026)".
function dayOf(text) {
  const s = String(text || '');
  if (!/(thứ|chủ\s*nhật)/i.test(s)) return null;
  const m = s.match(/(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})/);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const HEADERS = {
  time: ['thoi gian', 'gio'], title: ['noi dung'], people: ['thanh phan', 'thanh phan tham du'],
  chair: ['chu tri', 'bi thu chu tri', 'lanh dao chu tri'], location: ['dia diem'], note: ['ghi chu'],
};
// rows: mảng dòng, mỗi dòng là mảng chuỗi (ô). Trả về { events, warnings } hoặc null nếu không phải trang lịch.
function parseScheduleRows(rows) {
  let headerAt = -1, cols = null;
  for (let r = 0; r < Math.min(rows.length, 25) && headerAt < 0; r++) {
    const cells = rows[r].map(c => norm(String(c || '')));
    const find = keys => cells.findIndex(c => keys.includes(c));
    if (find(HEADERS.title) >= 0 && find(HEADERS.time) >= 0) {
      headerAt = r;
      cols = Object.fromEntries(Object.entries(HEADERS).map(([k, keys]) => [k, find(keys)]));
    }
  }
  if (headerAt < 0) return null;
  const events = [], warnings = [];
  let day = null;
  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r].map(c => String(c ?? '').trim());
    const filled = row.filter(Boolean);
    if (!filled.length) continue;
    // Dòng ngày: chỉ một ô có chữ, chứa "Thứ … ngày dd/mm/yyyy".
    const d = filled.length <= 2 ? dayOf(filled.join(' ')) : null;
    if (d) { day = d; continue; }
    const get = k => (cols[k] >= 0 ? row[cols[k]] || '' : '');
    const title = get('title');
    if (!title) continue;
    if (!day) { warnings.push(`Dòng ${r + 1}: "${title.slice(0, 40)}" nằm trước dòng ngày — bỏ qua`); continue; }
    events.push({ date: day, timeText: get('time'), startMin: parseTime(get('time')), title: title.slice(0, 500), participantsText: get('people').slice(0, 2000), chairText: get('chair').slice(0, 300), location: get('location').slice(0, 300), note: get('note').slice(0, 1000) });
  }
  return { events, warnings };
}

// Địa điểm ở cơ quan / trực tuyến → thành phần vẫn ở cơ quan; nơi khác (địa chỉ, tỉnh thành, đơn vị bạn) → coi là "ngoài cơ quan".
const IN_OFFICE = /(phòng họp|phòng làm việc|hội trường|trực tuyến|online|zoom|teams|tại cơ quan|trụ sở|tầng \d|văn phòng trung tâm)/i;
const isOutside = location => !!String(location || '').trim() && !IN_OFFICE.test(location);

// Sắp xếp trong ngày: cả ngày trước, rồi theo giờ.
const byTime = (a, b) => (a.startMin ?? -1) - (b.startMin ?? -1) || a.id - b.id;

module.exports = { isOutside, parseTime, splitPeople, matchPeople, dayOf, parseScheduleRows, byTime };
