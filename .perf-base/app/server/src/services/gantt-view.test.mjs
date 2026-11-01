// Unit test phần tính toán thuần của views/gantt.js (không cần trình duyệt).
// Chạy cùng npm test (app/server).
import test from 'node:test';
import assert from 'node:assert/strict';
import { vnDay, fmtDay, isoWeek, unitStart, addUnits, unitDays, statusOf, prepareItems, buildRows, fitRange, buildModel, buildScale, chartHtml, shortName, tooltipText } from '../../../web/js/views/gantt.js';

const D = s => vnDay(s + 'T12:00:00+07:00'); // ngày VN → số ngày
const STATES = [{ id: 1, category: 'UNSTARTED' }, { id: 2, category: 'STARTED' }, { id: 3, category: 'COMPLETED' }, { id: 4, category: 'CANCELLED' }];
const NOW = '2026-10-16T10:00:00+07:00';
let seq = 0;
const item = (o = {}) => { seq++; return { id: seq, number: seq, code: 'TT-' + seq, title: 'Việc ' + seq, parentId: null, startDate: null, assignedAt: null, createdAt: '2026-10-01T02:00:00Z', dueDate: null, internalDueDate: null, completedAt: null, progress: 0, stateId: 2, assignees: [], ...o }; };

test('ngày theo giờ Việt Nam: 23:59 VN vẫn là ngày cũ, 00:00 VN sang ngày mới', () => {
  assert.equal(fmtDay(vnDay('2026-10-15T16:59:59Z')), '15/10/2026');
  assert.equal(fmtDay(vnDay('2026-10-15T17:00:00Z')), '16/10/2026');
  assert.equal(vnDay(null), null);
  assert.equal(vnDay('không phải ngày'), null);
});

test('số tuần ISO (T1…T53) và đầu đơn vị tuần/tháng/quý/năm', () => {
  assert.deepEqual(isoWeek(D('2026-01-01')), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek(D('2026-10-16')), { year: 2026, week: 42 });
  assert.deepEqual(isoWeek(D('2026-12-31')), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek(D('2027-01-01')), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek(D('2027-01-04')), { year: 2027, week: 1 });
  assert.equal(fmtDay(unitStart(D('2026-10-18'), 'week')), '12/10/2026'); // Chủ nhật → Thứ Hai đầu tuần
  assert.equal(fmtDay(unitStart(D('2026-11-15'), 'quarter')), '01/10/2026');
  assert.equal(fmtDay(addUnits(D('2026-10-01'), 'quarter', 1)), '01/01/2027');
  assert.equal(fmtDay(addUnits(D('2026-01-01'), 'month', -1)), '01/12/2025');
  assert.equal(unitDays(D('2028-02-10'), 'month'), 29);
  assert.equal(unitDays(D('2028-06-01'), 'year'), 366);
  assert.equal(unitDays(D('2026-10-05'), 'quarter'), 92);
});

test('trạng thái màu: quá hạn theo ngày VN, hoàn thành, huỷ', () => {
  const today = vnDay(NOW);
  assert.equal(statusOf(item({ dueDate: '2026-10-15T16:59:59Z' }), 'STARTED', today), 'overdue'); // hạn 15/10 VN
  assert.equal(statusOf(item({ dueDate: '2026-10-15T17:00:00Z' }), 'STARTED', today), 'active'); // hạn 16/10 = hôm nay
  assert.equal(statusOf(item({ dueDate: '2026-10-01T00:00:00Z' }), 'COMPLETED', today), 'done');
  assert.equal(statusOf(item({ dueDate: '2026-10-01T00:00:00Z' }), 'CANCELLED', today), 'cancelled');
  assert.equal(statusOf(item({ completedAt: '2026-10-02T00:00:00Z' }), undefined, today), 'done');
  assert.equal(statusOf(item({}), 'STARTED', today), 'active'); // chưa có hạn
});

test('cây việc: việc nhánh dưới việc cha, cha bị lọc thì hiện như việc gốc, gập ẩn cả cháu', () => {
  const p = item({ dueDate: '2027-08-12T00:00:00Z' });
  const c1 = item({ parentId: p.id, dueDate: '2027-02-13T00:00:00Z' });
  const c2 = item({ parentId: p.id, dueDate: '2026-12-30T00:00:00Z' });
  const g = item({ parentId: c1.id, dueDate: '2027-01-10T00:00:00Z' });
  const orphan = item({ parentId: 99999, dueDate: '2026-11-01T00:00:00Z' });
  const loose = item({}); // chưa có hạn → cuối
  const entries = prepareItems([loose, g, c1, p, c2, orphan], STATES, vnDay(NOW));
  const { rows, parentIds } = buildRows(entries);
  assert.deepEqual(rows.map(r => [r.item.code, r.depth]), [[orphan.code, 0], [p.code, 0], [c2.code, 1], [c1.code, 1], [g.code, 2], [loose.code, 0]]);
  assert.equal(rows.find(r => r.item.id === p.id).childCount, 2);
  assert.deepEqual(parentIds.sort(), [p.id, c1.id].sort());
  const folded = buildRows(entries, new Set([p.id])).rows.map(r => r.item.code);
  assert.deepEqual(folded, [orphan.code, p.code, loose.code]);
});

test('dữ liệu lỗi có vòng cha–con không treo, mọi việc vẫn hiện', () => {
  const a = item({ dueDate: '2026-11-01T00:00:00Z' }), b = item({ parentId: a.id, dueDate: '2026-11-02T00:00:00Z' });
  a.parentId = b.id;
  const self = item({ dueDate: '2026-11-03T00:00:00Z' }); self.parentId = self.id;
  const { rows } = buildRows(prepareItems([a, b, self], STATES, vnDay(NOW)));
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(r => r.item.id)).size, 3);
});

test('khung "Toàn bộ": từ bắt đầu sớm nhất tới hạn muộn nhất, có lề, tối thiểu 14 ngày, bỏ ngày nhập nhầm', () => {
  const today = vnDay(NOW);
  const entries = prepareItems([item({ startDate: '2026-10-11T00:00:00Z', dueDate: '2027-08-12T00:00:00Z' }), item({ dueDate: '9999-01-01T00:00:00Z', startDate: '2026-10-20T00:00:00Z' })], STATES, today);
  const fit = fitRange(entries, today);
  assert.ok(fit.start < D('2026-10-11') && fit.start > D('2026-09-01'));
  assert.ok(fit.end > D('2027-08-12') && fit.end < D('2027-10-01'));
  const one = fitRange(prepareItems([item({ startDate: '2026-10-16T00:00:00Z', dueDate: '2026-10-16T00:00:00Z' })], STATES, today), today);
  assert.equal(one.end - one.start, 14);
});

test('mức phóng: Tháng/Quý vừa đúng một đơn vị, vùng vẽ tự mở rộng khi lùi/tiến ra ngoài', () => {
  const items = [item({ startDate: '2026-10-11T00:00:00Z', dueDate: '2027-08-12T00:00:00Z' })];
  const month = buildModel(items, { states: STATES, now: NOW, zoom: 'month', trackWidth: 620 });
  assert.equal(fmtDay(month.leftDay), '01/10/2026');
  assert.equal(month.windowDays, 31);
  assert.ok(Math.abs(month.ppd - 20) < 1e-9);
  const q = buildModel(items, { states: STATES, now: NOW, zoom: 'quarter', trackWidth: 920, leftDay: D('2029-04-01') });
  assert.equal(fmtDay(q.leftDay), '01/04/2029');
  assert.ok(q.canvas.end >= q.leftDay + q.windowDays && q.pad.after > 0);
  const fit = buildModel(items, { states: STATES, now: NOW, trackWidth: 700 });
  assert.equal(fit.zoom, 'fit');
  assert.equal(fit.leftDay, fit.fit.start);
  assert.ok(Math.abs(fit.windowDays - (fit.fit.end - fit.fit.start)) < 1e-9);
});

test('thước thời gian: Quý / Tháng / Tuần "T42", hàng ngày khi phóng to', () => {
  const canvas = { start: D('2026-10-01'), end: D('2027-01-01') };
  const wide = buildScale(canvas, 30);
  assert.equal(wide.quarters[0].label, 'Quý IV/2026');
  assert.equal(wide.months[0].label, 'Tháng 10/2026');
  assert.ok(wide.weeks.some(w => w.label === 'T42 · 12/10–18/10'));
  assert.equal(wide.days.length, 92);
  assert.equal(wide.days[0].label, '1');
  const narrow = buildScale(canvas, 2.6); // ô tuần ~18px: ghi số tuần
  assert.ok(narrow.weeks.some(w => w.label === '42'));
  const tight = buildScale(canvas, 2.1); // ô tuần ~15px: chỉ ghi tuần lẻ
  assert.ok(tight.weeks.some(w => w.label === '43') && !tight.weeks.some(w => w.label === '42'));
  assert.equal(narrow.days.length, 0);
  const mid = buildScale(canvas, 6);
  assert.ok(mid.weeks.some(w => w.label === 'T42'));
  assert.ok(mid.lines.some(l => l.k === 'm') && mid.lines.some(l => l.k === 'w'));
});

test('HTML: thanh tô %, mốc hình thoi, chưa có hạn, hạn nội bộ, trễ hạn, chống chèn mã', () => {
  const parent = item({ title: 'Hội thi <b>Tin học</b> trẻ', startDate: '2026-10-11T00:00:00Z', dueDate: '2027-08-12T00:00:00Z', progress: 10, assignees: [{ id: 5, fullName: 'Đinh Quang Huy' }, { id: 6, fullName: 'Mai Anh Thư' }] });
  const ms = item({ parentId: parent.id, startDate: '2027-07-23T00:00:00Z', dueDate: '2027-07-22T17:00:00Z' }); // bắt đầu = hạn → mốc
  const late = item({ parentId: parent.id, startDate: '2026-10-01T00:00:00Z', dueDate: '2026-10-10T00:00:00Z', internalDueDate: '2026-10-05T00:00:00Z', progress: 40 });
  const rootSameDay = item({ startDate: '2026-11-05T00:00:00Z', dueDate: '2026-11-01T00:00:00Z' }); // việc gốc bắt đầu sau hạn → thanh 1 ngày
  const noDue = item({});
  const done = item({ stateId: 3, startDate: '2026-10-01T00:00:00Z', dueDate: '2026-10-08T00:00:00Z', completedAt: '2026-10-07T00:00:00Z', progress: 60 });
  const m = buildModel([parent, ms, late, rootSameDay, noDue, done], { states: STATES, now: NOW, trackWidth: 900 });
  const html = chartHtml(m);
  assert.match(html, new RegExp(`data-testid="gantt-ms-${ms.code}"`));
  assert.doesNotMatch(html, new RegExp(`gantt-bar-${ms.code}"`));
  assert.match(html, new RegExp(`data-testid="gantt-bar-${rootSameDay.code}"`));
  assert.match(html, new RegExp(`data-testid="gantt-nodue-${noDue.code}">chưa có hạn`));
  assert.match(html, /class="g-idue"[^>]*title="Hạn nội bộ 05\/10\/2026"/);
  assert.match(html, /Trễ 6 ngày/);
  assert.match(html, /<i style="width:40%"><\/i>/);
  assert.match(html, new RegExp(`gantt-bar-${done.code}"></div>`)); // hoàn thành: tô kín màu xanh, không vẽ phần %
  assert.match(html, /Hội thi &lt;b&gt;Tin học&lt;\/b&gt; trẻ/);
  assert.doesNotMatch(html, /<b>Tin học<\/b>/);
  assert.match(html, />Quang Huy \+1</);
  assert.match(html, /aria-expanded="true"[^>]*data-testid="gantt-toggle-/);
  assert.match(html, /class="g-flag"/); // vạch hôm nay
  const lateRow = m.rows.find(r => r.item.id === late.id);
  assert.equal(lateRow.depth, 1);
  assert.equal(tooltipText(lateRow, m.today), `${late.code} · ${late.title}\nBắt đầu 01/10/2026 – Hạn 10/10/2026\nHạn nội bộ 05/10/2026\nTiến độ 40%\nQuá hạn 6 ngày`);
  assert.equal(m.stats.overdue, 1);
  assert.equal(m.stats.noDue, 1);
  assert.equal(m.stats.done, 1);
});

test('tên ngắn người chủ trì', () => {
  assert.equal(shortName('Đinh Quang Huy'), 'Quang Huy');
  assert.equal(shortName('Kiều Văn Nghỉ (thử)'), 'Văn Nghỉ');
  assert.equal(shortName('Lan'), 'Lan');
  assert.equal(shortName(''), '');
});

test('2000 việc: dựng mô hình và HTML nhanh', () => {
  const many = [];
  for (let k = 0; k < 2000; k++) many.push(item({ parentId: k % 10 ? many[k - (k % 10)].id : null, startDate: new Date(Date.UTC(2026, 0, 1 + (k % 500))).toISOString(), dueDate: new Date(Date.UTC(2026, 2, 1 + (k % 600))).toISOString(), progress: k % 101 }));
  const t = performance.now();
  const m = buildModel(many, { states: STATES, now: NOW, trackWidth: 1000 });
  const html = chartHtml(m);
  assert.equal(m.rows.length, 2000);
  assert.ok(html.length > 0);
  assert.ok(performance.now() - t < 1500, 'quá chậm');
});
