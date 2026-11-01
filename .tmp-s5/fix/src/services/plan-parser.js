// Đọc văn bản "Kế hoạch công tác năm" (.docx) → danh sách nhiệm vụ cho Sổ giao việc.
// Bảng nguồn: mục "PHÂN CÔNG CÔNG VIỆC CỤ THỂ" với các cột TT | Nội dung | Thời gian | Địa điểm | Mô tả công việc | Kết quả dự kiến | Thực hiện.
// Dòng nhóm (TT "1", "2"…) là nhóm nhiệm vụ; dòng nhiệm vụ (TT "1.1"…) là một việc; các mốc trong Mô tả thành việc nhánh:
//   "Tháng 7/2027: …", "Tháng 6 - 7/2027: …", "Cuối tháng 6/2027: …", "Tuần 2 tháng 2/2027: …", "Tuần 1, 2 tháng 3/2027: …",
//   "Quý II/2027: …", "Ngày 15/3/2027: …". Việc "mỗi Quý" (cột Thời gian) sinh thêm 4 mốc Quý, gộp cùng các mốc trên.
// Dòng trông giống mốc mà không đọc được (thiếu năm, tuần > 5…) được giữ trong mô tả và trả về trong `warnings`.
const PizZip = require('pizzip');

const H7 = 7 * 3_600_000;
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// Ngày cuối tháng/ngày cụ thể theo giờ Việt Nam (lưu 17:00 UTC ngày trước = 00:00 giờ VN của ngày đó).
const vnDate = (y, m, d) => new Date(Date.UTC(y, m - 1, d) - H7);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ROMAN = { I: 1, II: 2, III: 3, IV: 4 };

function paragraphs(xml) {
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(p => decode([...p[0].matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map(t => t[1]).join('')).trim());
}
// Trả về các bảng (mỗi bảng: mảng dòng, mỗi dòng: mảng ô, mỗi ô: văn bản các đoạn nối bằng \n). Bỏ qua bảng lồng.
function tables(xml) {
  const out = [];
  for (const t of xml.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)) {
    const rows = [...t[1].matchAll(/<w:tr[ >]([\s\S]*?)<\/w:tr>/g)].map(r => [...r[1].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map(c => paragraphs(c[1]).filter(Boolean).join('\n')));
    out.push(rows);
  }
  return out;
}
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();

function quarters(text) {
  const qs = new Set();
  for (const m of text.matchAll(/Quý\s+([IV]+(?:\s*(?:,|-|–|và)\s*[IV]+)*)/gi)) {
    const parts = m[1].split(/\s*(,|-|–|và)\s*/).filter(p => ROMAN[p.toUpperCase()] || ['-', '–'].includes(p));
    for (let i = 0; i < parts.length; i++) {
      const q = ROMAN[parts[i].toUpperCase()];
      if (!q) continue;
      if (['-', '–'].includes(parts[i + 1]) && ROMAN[(parts[i + 2] || '').toUpperCase()]) { for (let k = q; k <= ROMAN[parts[i + 2].toUpperCase()]; k++) qs.add(k); i += 2; } else qs.add(q);
    }
  }
  return [...qs].sort();
}
// Ngày hợp lệ theo lịch (tránh 31/2 bị Date tự đẩy sang tháng sau).
const validDay = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= lastDay(y, m);
const numList = s => String(s).split(/\s*(?:,|-|–|và)\s*/).map(x => Number(x.trim())).filter(x => Number.isInteger(x) && x > 0);
// "Tuần N tháng M": tuần thứ N của tháng = ngày 7(N-1)+1 … 7N (tuần 5 đến hết tháng). Hạn = ngày cuối tuần.
const weekDue = (y, m, w) => vnDate(y, m, Math.min(7 * w, lastDay(y, m)));
const weekStart = (y, m, w) => vnDate(y, m, Math.min(7 * (w - 1) + 1, lastDay(y, m)));
const YEAR = String.raw`\s*(?:\/|\s+năm\s+)\s*(\d{4})`;
const WEEK_RE = new RegExp(String.raw`tuần\s+(\d{1,2}(?:\s*(?:,|-|–|và)\s*\d{1,2})*)\s+(?:của\s+)?tháng\s+(\d{1,2})` + YEAR, 'i');
const MONTH_RE = new RegExp(String.raw`(?:^|\s)(?:(đầu|giữa|cuối)\s+)?tháng\s+(\d{1,2}(?:\s*(?:,|-|–|và)\s*\d{1,2})*)` + YEAR, 'i');
// Hạn hoàn thành từ cột "Thời gian".
function dueFromPeriod(text, year) {
  const t = text.normalize('NFC').replace(/\s+/g, ' ');
  const d = t.match(/trước\s+(?:ngày\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (d && validDay(Number(d[3]), Number(d[2]), Number(d[1]))) return vnDate(Number(d[3]), Number(d[2]), Number(d[1]));
  const w = t.match(WEEK_RE);
  if (w) {
    const weeks = numList(w[1]), m = Number(w[2]), y = Number(w[3]);
    if (weeks.length && Math.max(...weeks) <= 5 && m >= 1 && m <= 12) return weekDue(y, m, Math.max(...weeks));
  }
  const mo = t.match(MONTH_RE);
  if (mo) {
    const months = numList(mo[2]).filter(x => x <= 12), y = Number(mo[3]);
    if (months.length) { const last = Math.max(...months); return vnDate(y, last, partDay(mo[1], y, last)); }
  }
  const q = quarters(t);
  if (q.length) { const m = q.at(-1) * 3; return vnDate(year, m, lastDay(year, m)); }
  if (/cả năm|thường xuyên/i.test(t)) return vnDate(year, 12, 31);
  return null;
}
// Việc định kỳ theo Quý: "Mỗi Quý 01 số", "Trước ngày 25 tháng cuối mỗi Quý".
function quarterlySplit(text, year) {
  const t = text.normalize('NFC').replace(/\s+/g, ' ');
  if (!/mỗi\s+quý/i.test(t)) return null;
  const day = t.match(/trước\s+ngày\s+(\d{1,2})\s+tháng\s+cuối\s+mỗi\s+quý/i);
  return [1, 2, 3, 4].map(q => ({ title: `Quý ${['I', 'II', 'III', 'IV'][q - 1]}`, monthLabel: `Quý ${['I', 'II', 'III', 'IV'][q - 1]}/${year}`, start: vnDate(year, q * 3 - 2, 1),
    due: vnDate(year, q * 3, day ? Math.min(Number(day[1]), lastDay(year, q * 3)) : lastDay(year, q * 3)) }));
}
// "Đầu / Giữa / Cuối tháng": ngày 10 / 20 / cuối tháng.
function partDay(part, y, m) {
  const p = String(part || '').toLowerCase();
  return p === 'đầu' ? 10 : p === 'giữa' ? 20 : lastDay(y, m);
}
const ROMAN_OR_DIGIT = s => ROMAN[String(s).toUpperCase()] || (/^[1-4]$/.test(s) ? Number(s) : null);
const cap = s => { const t = s.replace(/[.;]$/, '').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const SEP = String.raw`\s*[:：\-–]\s*(.+)$`;
const LINE_WEEK = new RegExp('^' + WEEK_RE.source + SEP, 'i');
const LINE_MONTH = new RegExp(String.raw`^(?:(đầu|giữa|cuối)\s+)?tháng\s+([\d\s,\-–và]+?)` + YEAR + SEP, 'i');
const LINE_QUARTER = new RegExp(String.raw`^quý\s+([IV]+|[1-4])(?:\s*(?:,|-|–|và)\s*([IV]+|[1-4]))*` + YEAR + SEP, 'i');
const LINE_DATE = new RegExp(String.raw`^(?:(?:trước\s+)?ngày\s+|trước\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})` + SEP, 'i');
// Dòng có dáng một mốc thời gian (để cảnh báo khi không đọc được): bắt đầu bằng Tháng/Tuần/Quý/Ngày + số, kèm dấu ":" hoặc năm.
const looksLikeMilestone = line => /^(?:(?:đầu|giữa|cuối|trước)\s+)?(?:tháng|tuần|quý|ngày)\s*(?:\d|[IV]+\b)/i.test(line) && /[:：]|\/\d{4}|năm\s+\d{4}/i.test(line);

// Một dòng mô tả → mốc { title, monthLabel, start, due } | { error } | null (không phải mốc).
function parseMilestoneLine(line) {
  let m = line.match(LINE_WEEK);
  if (m) {
    const weeks = numList(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (!weeks.length || Math.max(...weeks) > 5 || mo < 1 || mo > 12) return { error: 'tuần phải từ 1 đến 5, tháng từ 1 đến 12' };
    return { title: cap(m[4]), monthLabel: `Tuần ${weeks.join(', ')} tháng ${mo}/${y}`, start: weekStart(y, mo, Math.min(...weeks)), due: weekDue(y, mo, Math.max(...weeks)) };
  }
  m = line.match(LINE_MONTH);
  if (m) {
    const months = numList(m[2]), y = Number(m[3]);
    if (!months.length || months.some(x => x > 12)) return { error: 'tháng phải từ 1 đến 12' };
    const first = Math.min(...months), last = Math.max(...months);
    const part = m[1] ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() + ' tháng' : 'Tháng';
    return { title: cap(m[4]), monthLabel: `${part} ${m[2].trim()}/${y}`, start: vnDate(y, first, 1), due: vnDate(y, last, partDay(m[1], y, last)) };
  }
  m = line.match(LINE_QUARTER);
  if (m) {
    const head = line.slice(0, line.search(/\s*(?:\/|\s+năm\s+)\s*\d{4}/i));
    const qs = [...head.matchAll(/([IV]+|[1-4])(?![\w])/gi)].map(x => ROMAN_OR_DIGIT(x[1])).filter(Boolean);
    const y = Number(m[3]);
    if (!qs.length) return { error: 'không rõ quý' };
    const lastQ = Math.max(...qs);
    return { title: cap(m[4]), monthLabel: `Quý ${qs.map(q => ['I', 'II', 'III', 'IV'][q - 1]).join(', ')}/${y}`, start: vnDate(y, Math.min(...qs) * 3 - 2, 1), due: vnDate(y, lastQ * 3, lastDay(y, lastQ * 3)) };
  }
  m = line.match(LINE_DATE);
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (!validDay(y, mo, d)) return { error: 'ngày không hợp lệ' };
    return { title: cap(m[4]), monthLabel: `Ngày ${d}/${mo}/${y}`, start: null, due: vnDate(y, mo, d) };
  }
  return looksLikeMilestone(line) ? { error: /\d{4}/.test(line) ? 'không đúng dạng "Tháng M/YYYY: …" hoặc "Tuần N tháng M/YYYY: …"' : 'thiếu năm — ghi dạng "Tháng 3/2027: …" hoặc "Tuần 2 tháng 3/2027: …"' } : null;
}

function parseDescription(text, year) {
  const milestones = [], rest = [], warnings = [];
  let budget = null;
  for (const raw of String(text || '').normalize('NFC').split('\n')) {
    const line = raw.replace(/^[-–•+*]\s*/, '').trim();
    if (!line) continue;
    const k = line.match(/^Kinh phí\s*:\s*([\d.,]+)\s*(triệu|tỷ)/i);
    if (k) { const n = Number(k[1].replace(/\./g, '').replace(',', '.')); budget = k[2].toLowerCase() === 'tỷ' ? n * 1000 : n; continue; }
    const ms = parseMilestoneLine(line);
    if (ms && !ms.error) { milestones.push(ms); continue; }
    if (ms?.error) warnings.push(`chưa đọc được mốc "${line.length > 90 ? line.slice(0, 87) + '…' : line}" (${ms.error}) — dòng này chỉ ghi vào mô tả`);
    rest.push(line);
  }
  return { milestones, budget, description: rest.join('\n'), warnings };
}
const vnDay = d => Math.floor((d.getTime() + H7) / 86_400_000);
const vnMonth = d => new Date(d.getTime() + H7).toISOString().slice(0, 7);
// Gộp mốc trong mô tả với mốc "mỗi Quý" (giữ cả hai), sắp theo hạn, bỏ trùng:
// - mốc Quý bị bỏ khi mô tả đã có mốc cho chính quý đó (cùng tháng hạn, ghi "Quý …" hoặc nhắc tới "quý"), vd. "Tháng 3/2027: Báo cáo Quý I";
// - mốc trùng tên và trùng ngày hạn chỉ giữ một.
function mergeMilestones(explicit, quarterly = []) {
  const covers = (m, q) => vnMonth(m.due) === vnMonth(q.due) && (/quý/i.test(m.title) || /^quý/i.test(m.monthLabel || ''));
  const all = [...explicit, ...quarterly.filter(q => !explicit.some(m => covers(m, q)))];
  const seen = new Set(), out = [];
  for (const m of all) {
    const key = norm(m.title) + '|' + vnDay(m.due);
    if (seen.has(key)) continue;
    seen.add(key); out.push(m);
  }
  return out.map((m, i) => ({ m, i })).sort((a, b) => a.m.due - b.m.due || a.i - b.i).map(x => x.m);
}
// "Thực hiện": Lãnh đạo phụ trách / Chủ trì: Phòng KHCN (đ/c A) / Phối hợp: … / Chuyên viên tham mưu: …
function parseExecution(text) {
  const out = { supervisor: null, leadUnit: null, leadNames: [], coordinator: null, coordinatorNames: [], advisors: null };
  const field = re => { const m = text.match(re); return m ? m[1].replace(/\s+/g, ' ').trim() : null; };
  out.supervisor = field(/Lãnh đạo phụ trách\s*:\s*([^\n]+)/i);
  const lead = field(/Chủ trì\s*:\s*([^\n]+)/i);
  const names = s => [...String(s || '').matchAll(/đ\/c\s+([^,;)]+)/gi)].map(m => m[1].trim());
  if (lead) { out.leadUnit = lead.replace(/\(.*?\)/g, '').trim() || null; out.leadNames = names(lead); }
  out.coordinator = field(/Phối hợp\s*:\s*([^\n]+)/i);
  out.coordinatorNames = names(out.coordinator);
  const adv = field(/Chuyên viên tham mưu\s*:\s*([^\n]+)/i);
  out.advisors = adv && !/^[.…\s]*$/.test(adv) ? adv : null;
  return out;
}

function parsePlanDocx(buffer) {
  let zip;
  try { zip = new PizZip(buffer); } catch { throw Object.assign(new Error('Không đọc được tệp Word (.docx)'), { status: 422 }); }
  const xml = zip.file('word/document.xml')?.asText();
  if (!xml) throw Object.assign(new Error('Tệp không phải văn bản Word hợp lệ'), { status: 422 });
  const paras = paragraphs(xml);
  const titleLine = paras.find(p => /KẾ HOẠCH CÔNG TÁC NĂM\s*\d{4}/i.test(p)) || paras.find(p => /KẾ HOẠCH/i.test(p) && /\d{4}/.test(p)) || 'Kế hoạch công tác';
  const year = Number((titleLine.match(/(20\d{2})/) || [])[1]) || new Date().getUTCFullYear() + 1;
  const table = tables(xml).find(rows => rows.length > 1 && rows[0].some(c => /Nội dung/i.test(c)) && rows[0].some(c => /Thực hiện/i.test(c)));
  if (!table) throw Object.assign(new Error('Không tìm thấy bảng "Phân công công việc cụ thể" (cần các cột Nội dung … Thực hiện)'), { status: 422 });
  const header = table[0].map(norm);
  const col = name => header.findIndex(h => h.includes(name));
  const C = { code: col('tt') >= 0 ? col('tt') : 0, title: col('noi dung'), period: col('thoi gian'), location: col('dia diem'), desc: col('mo ta'), result: col('ket qua'), exec: col('thuc hien') };
  const tasks = [], sections = [];
  let section = null;
  for (const row of table.slice(1)) {
    const code = (row[C.code] || '').replace(/\s+/g, '');
    const title = (row[C.title] ?? row[1] ?? '').replace(/\s*\n\s*/g, ' ').trim();
    const isSection = row.length < 4 || new Set(row.slice(1)).size === 1 || /^\d+$/.test(code) && !row[C.exec];
    if (!title) continue;
    if (isSection) { section = { code, title }; sections.push(section); continue; }
    const period = (row[C.period] || '').replace(/\s*\n\s*/g, ' ').trim();
    const d = parseDescription(row[C.desc] || '', year);
    const ex = parseExecution(row[C.exec] || '');
    const quarterly = quarterlySplit(period, year);
    tasks.push({
      code, section: section ? `${section.code}. ${section.title}` : null, title, period,
      location: (row[C.location] || '').replace(/\s*\n\s*/g, ' ').trim() || null,
      description: d.description, budget: d.budget, deliverable: (row[C.result] || '').split('\n').map(s => s.replace(/^[-–•]\s*/, '').trim()).filter(Boolean).join('\n'),
      due: dueFromPeriod(period, year), quarters: quarters(period), ...ex,
      milestones: mergeMilestones(d.milestones, quarterly || []), warnings: d.warnings,
    });
    const t = tasks.at(-1);
    if (!t.due && t.milestones.length) t.due = t.milestones.reduce((a, m) => (m.due > a ? m.due : a), t.milestones[0].due);
  }
  if (!tasks.length) throw Object.assign(new Error('Bảng phân công không có nhiệm vụ nào'), { status: 422 });
  const warnings = tasks.flatMap(t => t.warnings.map(w => `Nhiệm vụ ${t.code || t.title.slice(0, 40)}: ${w}`));
  return { name: titleLine.replace(/\s+/g, ' ').trim(), year, sections, tasks, warnings };
}

module.exports = { parsePlanDocx, norm, dueFromPeriod, quarters, parseDescription, parseExecution, parseMilestoneLine, mergeMilestones, quarterlySplit };
