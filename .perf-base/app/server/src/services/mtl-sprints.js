// Kepper — sprint = một giai đoạn của dự án, gồm một nhóm bước của MTL tổng, có tên và (tuỳ chọn) mục tiêu.
// Ví dụ: "Chuyển nhượng dự án (B1–9)", "Đề xuất NƠXH → CTĐT | 10-12". PMO thiết lập một lần cho dự án; hạng mục MTL bộ phận
// (dòng con) thuộc sprint của bước tổng mà nó chi tiết hoá. Hàm thuần — kiểm thử được, không đụng CSDL.
const M = require('./mtl');

const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100 };
const romanValue = s => { let n = 0; for (let i = 0; i < s.length; i++) { const v = ROMAN[s[i]], w = ROMAN[s[i + 1]] || 0; n += v < w ? -v : v; } return n; };
// Chuẩn hoá mã bước: bỏ tiền tố "B" / "Bước", bỏ khoảng trắng, chữ hoa ("b10" → "10", "ii.3" → "II.3").
const normStep = s => String(s ?? '').trim().replace(/^(bước|buoc|b)\s*\.?\s*(?=[\divxlc])/i, '').replace(/\s+/g, '').toUpperCase();
// Thứ tự bước tự nhiên: 1, 2, …, 10, rồi II.1, II.2, …, II.10 (phần La Mã sau phần số).
function stepOrder(code) {
  const parts = normStep(code).split('.');
  const head = parts[0];
  const first = /^\d+$/.test(head) ? [0, Number(head)] : /^[IVXLC]+$/.test(head) ? [1, romanValue(head)] : [2, 0, head];
  return [...first, ...parts.slice(1).map(p => (/^\d+$/.test(p) ? Number(p) : 0))];
}
function compareSteps(a, b) {
  const x = stepOrder(a), y = stepOrder(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? -1, q = y[i] ?? -1;
    if (p !== q) return typeof p === 'number' && typeof q === 'number' ? p - q : String(p).localeCompare(String(q));
  }
  return 0;
}

// "1-9, 11, II.1–II.8, II.1-8" → [{ from: '1', to: '9' }, { from: '11', to: '11' }, …]
function parseSteps(spec) {
  const out = [];
  for (const part of String(spec || '').replace(/[–—−]/g, '-').split(/[,;]+/)) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(.+?)\s*-\s*(.+)$/);
    if (m) {
      const a = normStep(m[1]); let b = normStep(m[2]);
      if (/^\d+$/.test(b) && /\.\d+$/.test(a)) b = a.replace(/\d+$/, b); // "II.1-8" → II.1 … II.8
      out.push({ from: a, to: b });
    } else out.push({ from: normStep(p), to: normStep(p) });
  }
  return out;
}

// Mỗi dòng một sprint: "Tên | các bước | mục tiêu (tuỳ chọn)" hoặc "Tên (B1–9)". Dòng trống / bắt đầu bằng # bỏ qua.
function parseSprintText(text) {
  const sprints = [], errors = [];
  String(text || '').split(/\r?\n/).forEach((raw, k) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    let name, steps = '', goal = '';
    if (line.includes('|')) [name, steps = '', goal = ''] = line.split('|').map(x => x.trim());
    else {
      const m = line.match(/^(.*?)\s*\(\s*((?:bước|buoc|b)?\s*[\divxlc][^()]*)\)\s*$/i);
      if (m) { name = m[1].trim(); steps = m[2].trim(); } else name = line;
    }
    if (!name) { errors.push(`Dòng ${k + 1}: thiếu tên sprint`); return; }
    if (!parseSteps(steps).length) errors.push(`Dòng ${k + 1}: "${name}" chưa ghi các bước — ví dụ "${name} | 1-9"`);
    sprints.push({ name: name.slice(0, 120), steps: steps.slice(0, 200), goal: goal.slice(0, 300) });
  });
  if (sprints.length > 30) errors.push('Tối đa 30 sprint');
  return { sprints, errors };
}
const sprintText = plan => (plan || []).map(s => [s.name, s.steps, s.goal].filter((v, i) => i < 2 || v).join(' | ')).join('\n');

// Bước tổng: hạng mục có mã bước và không phải dòng con của hạng mục khác trong tập.
const topItems = items => { const ids = new Set(items.map(i => i.id)); return items.filter(i => i.planCode && !(i.parentId && ids.has(i.parentId))); };

// Gán sprint cho từng hạng mục. plan = [{ name, steps }]. Trả { indexOf: Map(itemId → chỉ số sprint), codesOf: [[mã bước]],
// errors (bước không có, bước trùng giữa hai sprint), unassigned (mã bước tổng chưa thuộc sprint nào) }.
function assignSprints(items, plan) {
  const top = topItems(items);
  const codes = [...new Set(top.map(i => normStep(i.planCode)))].sort(compareSteps);
  const owner = new Map(), errors = [], codesOf = [];
  (plan || []).forEach((sp, k) => {
    const mine = [];
    for (const r of parseSteps(sp.steps)) {
      const a = codes.indexOf(r.from), b = codes.indexOf(r.to);
      if (codes.length && (a < 0 || b < 0)) { errors.push(`Sprint "${sp.name}": không có bước ${[a < 0 ? r.from : null, b < 0 && r.to !== r.from ? r.to : null].filter(Boolean).join(', ')} trong MTL tổng`); continue; }
      if (a > b) { errors.push(`Sprint "${sp.name}": khoảng ${r.from}-${r.to} ngược thứ tự`); continue; }
      for (const c of codes.slice(a, b + 1)) {
        if (owner.has(c) && owner.get(c) !== k) errors.push(`Bước ${c} nằm trong cả sprint "${plan[owner.get(c)].name}" và "${sp.name}"`);
        else { owner.set(c, k); if (!mine.includes(c)) mine.push(c); }
      }
    }
    codesOf.push(mine);
  });
  const byId = new Map(items.map(i => [i.id, i]));
  const indexOf = new Map();
  const resolve = (i, depth = 0) => {
    if (indexOf.has(i.id)) return indexOf.get(i.id);
    let v = null;
    if (i.parentId && byId.has(i.parentId) && depth < 20) v = resolve(byId.get(i.parentId), depth + 1);
    else if (i.planCode) v = owner.has(normStep(i.planCode)) ? owner.get(normStep(i.planCode)) : null;
    indexOf.set(i.id, v); return v;
  };
  for (const i of items) resolve(i);
  return { indexOf, codesOf, errors, unassigned: codes.filter(c => !owner.has(c)) };
}

// Mô tả gọn các bước của sprint: ["1","2",…,"9"] → "B1–9"; ["II.1"…"II.8"] → "BII.1–II.8"; rời rạc → "B10, 12".
function stepsLabel(codes) {
  if (!codes.length) return '';
  const sorted = [...codes].sort(compareSteps);
  const label = sorted.length > 1 ? `${sorted[0]}–${sorted[sorted.length - 1]}` : sorted[0];
  return /^\d/.test(label) ? 'B' + label : label;
}
// Nhãn theo đúng cách PMO ghi: "1-9" → "B1–9", "II.1-II.8" → "II.1–II.8", "B10, 12" giữ nguyên.
const specLabel = spec => { const t = String(spec || '').trim().replace(/\s*[-–—]\s*/g, '–'); return /^\d/.test(t) ? 'B' + t : t; };

// Tiến độ, tình trạng, mốc của một sprint. items: hạng mục thuộc sprint (đã có actual / status từ computeProject).
const DAY = 86_400_000;
function summarize(items, actualOf, day = new Date(), cfg = M.DEFAULT_ALERTS, t0Date = null) {
  const live = items.filter(i => !M.isCancelled(i) && i.baselineStart && i.baselineEnd);
  const leaves = M.leavesOf(live);
  const top = topItems(live);
  if (!live.length) return { status: 'NO_PLAN', statusLabel: M.STATUS.NO_PLAN, items: 0, leaves: 0, steps: 0, stepsDone: 0, milestones: [] };
  const start = new Date(Math.min(...live.map(i => new Date(i.baselineStart).getTime())));
  const end = new Date(Math.max(...live.map(i => new Date(i.baselineEnd).getTime())));
  const { spi, plannedPct, actualPct } = M.spiOf(leaves, actualOf, day);
  const allDone = leaves.every(M.isDone);
  const d = M.vnDay(day), s = M.vnDay(start), e = M.vnDay(end);
  const variance = actualPct != null && plannedPct != null ? Math.round((actualPct - plannedPct) * 10) / 10 : null;
  let status;
  if (allDone) { const last = Math.max(...leaves.map(i => (i.completedAt ? M.vnDay(i.completedAt) : 0))); status = last > e ? 'DONE_LATE' : 'DONE_ON_TIME'; }
  else if (d < s) status = 'NOT_DUE';
  else if (d > e) status = 'OVERDUE';
  else if (variance != null && variance <= -cfg.behindPct) status = 'BEHIND';
  else if (variance != null && variance >= cfg.aheadPct) status = 'AHEAD';
  else status = 'ON_TRACK';
  const milestones = live.filter(i => i.milestone).sort((a, b) => new Date(a.baselineEnd) - new Date(b.baselineEnd));
  return {
    start, end, startT: t0Date ? M.currentT(t0Date, start) : null, endT: t0Date ? M.currentT(t0Date, end) : null,
    status, statusLabel: M.STATUS[status], plannedPct, actualPct, spi, variance,
    daysLeft: !allDone && d >= s && d <= e ? e - d : null, lateDays: status === 'OVERDUE' ? d - e : null, startsIn: status === 'NOT_DUE' ? s - d : null,
    items: live.length, leaves: leaves.length, done: leaves.filter(M.isDone).length,
    steps: top.length, stepsDone: top.filter(i => M.isDone(i) || actualOf(i) >= 100).length,
    behind: leaves.filter(i => ['BEHIND', 'LATE_START'].includes(i.status)).length, overdue: leaves.filter(i => i.status === 'OVERDUE').length,
    criticalLate: leaves.filter(i => i.critical && ['BEHIND', 'LATE_START', 'OVERDUE'].includes(i.status)).length,
    milestones: milestones.map(i => ({ id: i.id, code: i.code, planCode: i.planCode, title: i.title, baselineEnd: i.baselineEnd, status: i.status, statusLabel: i.statusLabel, done: M.isDone(i), critical: i.critical })),
  };
}
// Sprint "đang làm": sprint đầu tiên (theo thứ tự) đã tới ngày bắt đầu mà chưa xong; không có thì sprint đầu tiên chưa xong.
function currentSprintIndex(summaries) {
  const open = summaries.map((s, k) => [s, k]).filter(([s]) => s.status !== 'NO_PLAN' && !String(s.status).startsWith('DONE'));
  const active = open.find(([s]) => s.status !== 'NOT_DUE');
  return (active || open[0] || [null, summaries.length ? summaries.length - 1 : null])[1];
}

// Gợi ý ban đầu (để PMO sửa): mỗi phần (bước số / phần La Mã) cắt sau mỗi mốc ◆ trên đường găng.
function suggestSprints(items) {
  const top = topItems(items).filter(i => !M.isCancelled(i)).sort((a, b) => compareSteps(a.planCode, b.planCode));
  const seen = new Set(), steps = top.filter(i => { const c = normStep(i.planCode); if (seen.has(c)) return false; seen.add(c); return true; });
  const groups = [];
  let cur = [], part = null;
  const flush = () => { if (cur.length) groups.push(cur); cur = []; };
  for (const i of steps) {
    const p = /^\d/.test(normStep(i.planCode)) ? 'num' : normStep(i.planCode).split('.')[0];
    if (part !== null && p !== part) flush();
    part = p; cur.push(i);
    if (i.milestone && i.critical) flush();
  }
  flush();
  const short = t => String(t || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48);
  return groups.slice(0, 30).map(g => {
    const last = g[g.length - 1], codes = g.map(i => normStep(i.planCode));
    const range = codes.length > 1 ? `${codes[0]}-${codes[codes.length - 1]}` : codes[0];
    return { name: last.milestone ? `Đến mốc: ${short(last.title)}` : `${short(g[0].title)}…`, steps: range, goal: '' };
  });
}

// Sprint của một dự án: theo thiết lập của PMO; chưa thiết lập → gợi ý theo mốc (đánh dấu configured = false).
// items: hạng mục người xem thấy (đã tính actual / status). Trả danh sách sprint kèm tiến độ, sprint đang làm, chỉ số sprint của từng hạng mục.
function buildSprints(project, items, actualOf, day = new Date(), cfg = M.DEFAULT_ALERTS) {
  const configured = Array.isArray(project.sprintPlan) && project.sprintPlan.length > 0;
  const plan = configured ? project.sprintPlan : suggestSprints(items);
  const a = assignSprints(items, plan);
  const list = plan.map((sp, k) => {
    const members = items.filter(i => a.indexOf.get(i.id) === k);
    return { index: k, name: sp.name, goal: sp.goal || '', steps: sp.steps, stepsLabel: configured ? specLabel(sp.steps) : stepsLabel(a.codesOf[k]), ...summarize(members, actualOf, day, cfg, project.t0Date) };
  });
  return { configured, plan, list, current: currentSprintIndex(list), indexOf: a.indexOf, unassigned: a.unassigned, errors: a.errors,
    nameOf: i => { const k = a.indexOf.get(i.id); return k == null ? null : plan[k].name; } };
}

module.exports = { buildSprints, normStep, stepOrder, compareSteps, parseSteps, parseSprintText, sprintText, topItems, assignSprints, stepsLabel, specLabel, summarize, currentSprintIndex, suggestSprints, DAY };
