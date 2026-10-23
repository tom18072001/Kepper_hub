// Kepper — đặt % tiến độ một hạng mục MTL (dùng chung: checklist, báo cáo tuần ghi ngược % vào MTL).
// > 0% từ "Chưa bắt đầu" → "Đang thực hiện"; 100% → "Hoàn thành" (nếu không cần duyệt); hạ dưới 100% khi đã hoàn thành → mở lại.
// Gọi trong giao dịch, sau khi đã khoá hạng mục (pg_advisory_xact_lock 'item:<id>').
const { activity } = require('./events');
const approval = require('./approval');
const W = require('./workitems');

async function setProgress(tx, { user, project, rights, item, pct, via = null }) {
  const cat = item.state.category;
  if (cat === 'CANCELLED') return false;
  if (pct === item.progress && !(cat === 'COMPLETED' && pct < 100)) return false;
  const data = { progress: pct, progressAt: new Date() };
  const want = pct >= 100 ? 'COMPLETED' : cat === 'COMPLETED' || (pct > 0 && ['BACKLOG', 'UNSTARTED'].includes(cat)) ? 'STARTED' : null;
  let moved = null;
  if (want && want !== cat) {
    const target = await tx.workflowState.findFirst({ where: { projectId: project.id, category: want }, orderBy: { position: 'asc' } });
    const steps = await approval.stepsForItem(tx, project, item);
    if (target && !(want === 'COMPLETED' && steps.length)) {
      const t = await W.transition(tx, { project, rights, item, toState: target });
      Object.assign(data, t.data, { progress: pct, position: await W.endPosition(tx, target.id) });
      moved = { ...t, toState: target };
    }
  }
  const updated = await tx.workItem.update({ where: { id: item.id }, data });
  await activity(tx, item.id, user.id, 'UPDATED', via ? { progress: pct, via } : { progress: pct });
  if (moved) await W.afterTransition(tx, { user, project, item: updated, fromState: item.state, toState: moved.toState, steps: moved.steps });
  return true;
}

module.exports = { setProgress };
