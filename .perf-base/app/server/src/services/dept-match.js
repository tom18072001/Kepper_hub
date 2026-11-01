// Khớp tên đơn vị ghi tự do (Kế hoạch năm, sổ Excel) với phòng ban trong hệ thống:
// không phân biệt hoa thường / dấu, bỏ tiền tố "Phòng/Ban/Tổ", mở các viết tắt thông dụng, so khớp bằng nhau hoặc chứa nhau.
// Ví dụ: "Phòng KHCN" ↔ "Phòng Khoa học Công nghệ", "VP" ↔ "Văn phòng", "Phòng TNT" ↔ "Phòng Tài năng trẻ".
const { norm } = require('./plan-parser');

const ABBREVIATIONS = {
  khcn: 'khoa hoc cong nghe', tnt: 'tai nang tre', vp: 'van phong', bgd: 'ban giam doc', hcns: 'hanh chinh nhan su',
  hctc: 'hanh chinh to chuc', cntt: 'cong nghe thong tin', tckt: 'tai chinh ke toan', ttsk: 'truyen thong su kien', kd: 'kinh doanh',
};
const UNIT_PREFIX = /^(?:phong|ban|to|bo phan|don vi)\s+/;
const STOP = new Set(['va', 'cua', 'thuoc']);

const tokens = s => norm(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(t => t && !STOP.has(t));
// Dạng so khớp: mở viết tắt, bỏ tiền tố loại đơn vị ("phong", "ban"…). "Văn phòng" giữ nguyên ("van phong").
const UNIT_WORDS = new Set(['phong', 'ban', 'to', 'bo phan', 'don vi', 'trung tam']);
function canonical(s) {
  const expanded = tokens(String(s || '').replace(/\(.*?\)/g, ' ')).map(t => ABBREVIATIONS[t] || t).join(' ');
  const core = expanded.replace(UNIT_PREFIX, '').trim();
  return UNIT_WORDS.has(core) ? '' : core; // chỉ ghi "Phòng" / "Ban" → không đủ để khớp
}
const contains = (a, b) => ` ${a} `.includes(` ${b} `);

// departments: [{ id, name, code? }] → hàm (text) → { id, name } | null.
function departmentMatcher(departments) {
  const list = departments.map(d => ({ id: d.id, name: d.name, core: canonical(d.name), code: norm(d.code || '').replace(/[^a-z0-9]/g, '') })).filter(d => d.core);
  return value => {
    const raw = String(value || '').replace(/\(.*?\)/g, ' ').trim();
    if (!raw) return null;
    const core = canonical(raw);
    const bare = tokens(raw).join(' ').replace(UNIT_PREFIX, '').replace(/\s+/g, '');
    if (!core) return null;
    let best = null, tie = false;
    for (const d of list) {
      let score = 0;
      if (core === d.core || (d.code && bare === d.code)) score = 300;
      else if (contains(core, d.core)) score = 200 + d.core.length; // tên ghi dài hơn, chứa trọn tên phòng
      else if (core.length >= 4 && contains(d.core, core)) score = 100 - (d.core.length - core.length); // tên ghi tắt, nằm trong tên phòng
      if (!score) continue;
      if (!best || score > best.score) { best = { ...d, score }; tie = false; } else if (score === best.score && d.id !== best.id) tie = true;
    }
    return best && !tie ? { id: best.id, name: best.name } : null;
  };
}
// "Văn phòng (đ/c A), Phòng TNT; Phòng KHCN" → ["Văn phòng", "Phòng TNT", "Phòng KHCN"]. "và" chỉ tách khi cả cụm không khớp.
function splitUnits(value, match = null) {
  const parts = String(value || '').replace(/\(.*?\)/g, ' ').split(/[,;+\n/]+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return parts.flatMap(p => {
    if (!match || !/\svà\s/i.test(p)) return [p];
    const pieces = p.split(/\s+và\s+/i).map(s => s.trim()).filter(Boolean);
    const hits = pieces.map(match);
    // "Văn phòng và Phòng TNT" → hai đơn vị; "Phòng Khoa học và Công nghệ" → một đơn vị.
    return hits.every(Boolean) && new Set(hits.map(h => h.id)).size === pieces.length ? pieces : [p];
  });
}

module.exports = { departmentMatcher, splitUnits, canonical, ABBREVIATIONS };
