// Báo cáo tuần — tính lại các dòng gắn hạng mục MTL / việc thường lúc NỘP (POST /api/weekly/submit), không đụng CSDL.
// Một nguồn sự thật: tên, mã, bước, găng, mốc, hạn, người phụ trách lấy từ việc; tình trạng, "đã bắt đầu" và nguy cơ chậm tính lại
// (MTL theo % mới người lập ghi; việc thường theo % trên việc). Người lập chỉ nâng tình trạng lên "Vướng".
// items: như routes/weekly.js workItemsFor (kind, cfg, actual, children, started, risk…).
const M = require('./mtl');
const A = require('./alerts');
const WK = require('./weekly');

function recomputeRows(data, items, now = new Date()) {
  const byId = new Map(items.map(i => [i.id, i]));
  for (const r of [...data.results, ...data.ongoing, ...(data.risks || [])]) {
    const i = r.itemId && byId.get(r.itemId);
    if (!i) continue;
    Object.assign(r, { task: i.title, ref: i.code, step: i.planCode || '', critical: !!i.critical, milestone: !!i.milestone });
    if (i.assignees?.length) r.ownerIds = i.assignees.map(a => a.id);
    // "Đăng ký tuần trước mà chưa làm" giữ khi việc vẫn chưa làm và không có nguy cơ nào khác.
    const keepPlanned = (started, risk) => r.risk === WK.PLAN_NOT_STARTED.code && !started && !risk;
    if (i.kind === 'TASK') {
      const started = !!(i.started || i.done);
      Object.assign(r, { pctLocked: true, pct: i.done ? 100 : Math.round(i.progress || 0), due: WK.dayOf(i.dueDate) || r.due, started });
      if (!keepPlanned(started, i.risk)) Object.assign(r, { risk: i.risk?.code || null, riskNote: WK.riskNoteOf(i.risk) });
      r.status = r.status === 'Vướng' && !i.done ? 'Vướng' : WK.taskStatus(i);
      if (r.status === WK.DONE) Object.assign(r, { risk: null, riskNote: '' });
      continue;
    }
    r.pctLocked = i.children > 0;
    r.due = WK.dayOf(i.baselineEnd) || r.due;
    if (r.pctLocked) r.pct = i.done ? 100 : Math.round(i.actual || 0);
    const pct = r.pct === '' ? Math.round(i.actual || 0) : r.pct;
    const done = i.done || (!r.pctLocked && pct >= 100);
    const st = M.statusOf({ ...i, progress: pct }, done ? 100 : pct, now, i.cfg);
    const started = !!(done || i.started || pct > 0);
    let computed = WK.statusFromMtl(st.code, done);
    if (computed === 'Chưa bắt đầu' && started) computed = 'Đúng tiến độ'; // làm sớm hơn ngày bắt đầu kế hoạch
    r.status = r.status === 'Vướng' && !done ? 'Vướng' : computed;
    r.started = started;
    // Nguy cơ chậm tính lại theo % mới (cùng quy tắc cảnh báo MTL).
    const risk = done ? null : A.riskOf({ ...i, progress: pct, actual: pct }, { st, cfg: i.cfg, day: now });
    if (!keepPlanned(started, risk)) Object.assign(r, { risk: risk?.code || null, riskNote: WK.riskNoteOf(risk) });
    if (r.status === WK.DONE) Object.assign(r, { pct: 100, risk: null, riskNote: '' });
  }
  return data;
}

module.exports = { recomputeRows };
