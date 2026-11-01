// Pure comparison of two MTL plans. Dates are compared in UTC calendar days.
const DAY = 86400000;
function day(value) {
  if (value == null) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) throw new RangeError('INVALID_DATE');
  return Math.floor(d.getTime() / DAY);
}
function comparePlans(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) throw new TypeError('Plans must contain steps');
  const index = rows => {
    const map = new Map();
    for (const row of rows) {
      const code = String(row.code || '').trim();
      if (!code || map.has(code)) throw new RangeError('DUPLICATE_OR_EMPTY_CODE');
      const start = day(row.start), end = day(row.end);
      if (start != null && end != null && end < start) throw new RangeError('INVALID_DATE');
      map.set(code, { ...row, code, start, end });
    }
    return map;
  };
  const left = index(a), right = index(b);
  const summary = map => {
    const dated = [...map.values()].filter(x => x.start != null && x.end != null);
    return dated.length ? { start: Math.min(...dated.map(x => x.start)), end: Math.max(...dated.map(x => x.end)) } : null;
  };
  const sa = summary(left), sb = summary(right);
  const iso = n => n == null ? null : new Date(n * DAY).toISOString().slice(0, 10);
  const steps = [...new Set([...left.keys(), ...right.keys()])].sort().map(code => {
    const x = left.get(code), y = right.get(code);
    return { code, name: y?.name || x?.name || code, isMilestone: !!(x?.milestone || y?.milestone),
      a: x ? { start: iso(x.start), end: iso(x.end), critical: !!x.critical } : null,
      b: y ? { start: iso(y.start), end: iso(y.end), critical: !!y.critical } : null,
      endDeltaDays: x?.end != null && y?.end != null ? y.end - x.end : null };
  });
  return {
    summary: { a: sa && { start: iso(sa.start), end: iso(sa.end), durationDays: sa.end - sa.start + 1 },
      b: sb && { start: iso(sb.start), end: iso(sb.end), durationDays: sb.end - sb.start + 1 },
      endDeltaDays: sa && sb ? sb.end - sa.end : null },
    steps, milestones: steps.filter(s => s.isMilestone),
    criticalPath: { method: 'imported-flags', a: a.filter(x => x.critical).map(x => x.code),
      b: b.filter(x => x.critical).map(x => x.code),
      onlyA: a.filter(x => x.critical && !right.get(x.code)?.critical).map(x => x.code),
      onlyB: b.filter(x => x.critical && !left.get(x.code)?.critical).map(x => x.code) },
  };
}
module.exports = { comparePlans };
