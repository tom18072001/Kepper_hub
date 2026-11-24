// Báo cáo tuần — gộp bản lưu và chuỗi xử lý khi LƯU NHÁP / NỘP / GỬI LẠI, không đụng CSDL. Route và test gọi đúng các hàm này.
//
// KHUNG NGUYÊN TẮC (nghiệm thu vòng 6) — áp cho MỌI đường: web, MCP kepper_save_weekly_draft, lưu nháp, tự lưu, nộp, gửi lại.
//  (K1) Trường DO MÁY TÍNH — tên, mã, hạn, người phụ trách, %, tình trạng, nguy cơ, VÀ dòng nằm ở Phần I / II / III — máy chủ quyết hoàn toàn,
//       kể cả dòng tự bổ sung và hạng mục MTL. Tuần đang mở: luôn tính lại từ việc. Tuần ĐÃ HỌP (`frozen`: đã có bản nộp và đã qua giờ giao ban):
//       đóng băng theo bản nộp trước đó — chỉ trường người nhập được sửa, không bỏ dòng vì việc bị lưu trữ về sau, không thêm dòng gắn việc mới.
//       Ngoại lệ duy nhất cho %: người XEM ĐƯỢC việc ghi % của hạng mục MTL lá (không phải dòng tự bổ sung) — ghi ngược MTL theo policy.
//  (K2) Dòng gắn việc MỚI (ở một phần — Phần I–III hoặc Phần IV — mà bản đã lưu chưa có) chỉ được thêm khi người lưu XEM ĐƯỢC việc. Người được
//       sửa rộng (thư ký: quyền sửa + xem tổng hợp đầy đủ — editAll) chỉ sửa trường người nhập của những dòng ĐÃ CÓ trong bản đã lưu.
//       Chỉ người xem được việc bỏ được dòng (không phải dòng tự bổ sung).
//  (K3) So khớp / kiểm tra (trùng tên…) chỉ xét dòng người lưu xem được hoặc sửa được; lỗi không tiết lộ việc họ không xem được.
//  (K4) Mọi thay đổi máy chủ bỏ qua — kể cả xoá dòng, sửa % do máy tính — được ĐẾM (`ignored`) để báo lại trên web lẫn MCP.
//       Dòng của việc đã lưu trữ / huỷ bị bỏ khỏi tuần đang mở: đếm riêng (`removed`, chỉ dòng người lưu xem được / sửa được).
//  (K5) Hiển thị lọc theo NGƯỜI XEM (routes/weekly.js hideUnseen, WK.summaryView) — kể cả kết luận giao ban.
// Trường DO NGƯỜI NHẬP: tình trạng "Vướng", nguyên nhân, giải pháp, đề nghị hỗ trợ, việc tuần tới, người phụ trách tự chọn (việc chưa giao),
// toàn bộ dòng Phần IV.
const WK = require('./weekly');
const WR = require('./weekly-recompute');

const LISTS = ['results', 'ongoing', 'risks'];
const ALL = [...LISTS, 'plans'];
const USER_FIELDS = ['cause', 'solution', 'helpFrom', 'helpWhat', 'helpBy', 'next'];
const FLAGS = ['_keep', '_auto', '_frozen', '_sent', '_saved', '_pctUser'];

// Dòng có actionRef không thuộc Action Log đang mở của CHÍNH bộ phận này → bỏ liên kết (không đóng hộ việc của bộ phận khác).
function stripForeignActions(data, actions) {
  const ok = new Set(actions.map(a => a.ref));
  for (const r of [...data.results, ...data.ongoing, ...(data.risks || [])]) if (r.actionRef && !ok.has(r.actionRef)) r.actionRef = null;
}

const autoIdsOf = saved => new Set(WK.allRows(saved).filter(r => r.auto && r.itemId).map(r => r.itemId));
const norm = t => String(t || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const partKey = (list, id) => `${list === 'plans' ? 'p' : 'r'}${id}`;

// raw: dữ liệu gửi lên. ctx: cleanCtx của route (itemIds = việc người lưu XEM ĐƯỢC). saved: bản đã lưu (nháp hoặc đã nộp).
// scopeItems: mọi việc của bộ phận (DEPT_SCOPE). editAll: thư ký. frozen: tuần đã họp (K1).
// Trả { data (còn cờ tạm), ignored, removed, writable(id, list) }.
function mergeSaved(raw, ctx, saved, { scopeItems = [], editAll = false, frozen = false } = {}) {
  const visible = ctx.itemIds || new Set();
  const scope = new Map([...scopeItems, ...(ctx.items || [])].map(i => [i.id, i]));
  const live = id => frozen || (scope.has(id) && !scope.get(id).cancelled);
  const savedRow = new Map();
  for (const list of ALL) for (const r of saved?.[list] || []) if (r?.itemId && !savedRow.has(partKey(list, r.itemId))) savedRow.set(partKey(list, r.itemId), { list, row: r });
  const savedIds = new Set([...savedRow.values()].map(x => x.row.itemId));
  const writable = (id, list) => visible.has(id) || (editAll && savedRow.has(partKey(list, id))); // K2
  const sawIt = id => visible.has(id) || editAll; // dòng có trên biểu mẫu của người lưu (người xem đầy đủ thấy mọi dòng)
  const d = raw && typeof raw === 'object' ? raw : {};
  const allowed = new Set([...visible, ...savedIds]);
  let ignored = ALL.flatMap(k => (Array.isArray(d[k]) ? d[k] : [])).filter(r => r && r.itemId != null && r.itemId !== '' && !allowed.has(r.itemId)).length;
  let removed = 0;
  const clean = WK.sanitize(d, { ...ctx, itemIds: allowed, taskIds: new Set([...(ctx.taskIds || []), ...scopeItems.filter(i => i.kind === 'TASK').map(i => i.id)]) });
  const seen = new Set(), data = { ...clean };
  for (const list of ALL) data[list] = [];
  for (const list of ALL) for (const r of clean[list] || []) {
    if (!r.itemId) { data[list].push(r); continue; }
    const k = partKey(list, r.itemId), prev = savedRow.get(k);
    // K2 / K3: kiểm được thêm / sửa TRƯỚC mọi thứ khác — dòng người lưu không được sửa (kín đang dùng, kín đã lưu trữ, mã không có) → cùng
    // một phản hồi: ignored.
    if (seen.has(k) || !writable(r.itemId, list) || (frozen && !prev)) { ignored++; continue; } // trùng / không được thêm-sửa / tuần đã họp
    seen.add(k);
    if (!live(r.itemId)) { if (prev) removed++; else ignored++; continue; } // việc đã lưu trữ / huỷ (tuần đang mở)
    if (list === 'plans') { data.plans.push(r); continue; } // dòng Phần IV: do người nhập
    // K4: ghi lại trường máy tính người lưu gửi lên — so sau khi tính lại (machineEdits).
    const sent = { task: r.task, due: r.due, status: r.status, pct: r.pct, list };
    if (!prev) { data[list].push({ ...r, _sent: sent }); continue; } // dòng mới của việc người lưu xem được
    // Dòng đã có: trường máy tính từ bản đã lưu (tính lại sau), trường người nhập từ bản gửi lên.
    const x = structuredClone(prev.row);
    x._saved = { task: x.task, due: x.due, status: x.status, pct: x.pct, list: prev.list }; x._sent = sent;
    for (const f of USER_FIELDS) if (r[f] !== undefined) x[f] = r[f]; // phần I không có "việc tuần tới" → giữ giá trị đã lưu
    if (r.status === 'Vướng') x.status = 'Vướng'; else if (x.status === 'Vướng') x.status = 'Đúng tiến độ';
    if (r.ownerPicked && r.ownerIds?.length) Object.assign(x, { ownerIds: r.ownerIds, ownerPicked: true });
    // % — hai nghĩa tách riêng (vòng 7):
    //  (a) không nhận % người này gửi: dòng người lưu không xem được, tuần đã họp → GIỮ % đã lưu (vd. trưởng phòng ghi 60% cho MTL);
    //  (b) khoá % theo MTL: dòng tự bổ sung, hạng mục có việc nhánh (weekly-recompute.js).
    // Còn lại (người xem được hạng mục MTL lá): % người lưu ghi — ghi ngược MTL theo policy.
    if (visible.has(r.itemId) && !frozen && !x.auto) { x.pct = r.pct; x._pctUser = true; }
    if (x.auto) x._auto = true;
    if (frozen) x._frozen = true;
    data[frozen ? prev.list : list].push(x);
  }
  // Dòng đã lưu mà bản gửi lên không có.
  for (const [k, { list, row }] of savedRow) {
    if (seen.has(k)) continue;
    if (!live(row.itemId)) { if (sawIt(row.itemId)) removed++; continue; }
    if (visible.has(row.itemId) && !(row.auto && list !== 'plans') && !frozen) continue; // người xem được việc đã bỏ dòng
    if (sawIt(row.itemId)) ignored++; // có trên biểu mẫu mà bị bỏ → không được bỏ (K2 / dòng tự bổ sung / tuần đã họp) → báo lại
    seen.add(k);
    data[list].push({ ...structuredClone(row), _keep: !visible.has(row.itemId) && !editAll, ...(row.auto && list !== 'plans' ? { _auto: true } : {}), ...(frozen ? { _frozen: true } : {}) });
  }
  return { data, ignored, removed, writable, visible, editAll, savedRow };
}
// Tính lại trường máy tính (tuần đang mở) cho mọi dòng không đóng băng.
function recompute(data, ctx, scopeItems, now) {
  const part = { results: data.results.filter(r => !r._frozen), ongoing: data.ongoing.filter(r => !r._frozen), risks: data.risks.filter(r => !r._frozen) };
  WR.recomputeRows(part, [...new Map([...scopeItems, ...(ctx.items || [])].map(i => [i.id, i])).values()], now);
}
// K4: trường máy tính gửi lên (tên, hạn, %, tình trạng trừ "Vướng", phần) khác CẢ giá trị đã lưu LẪN giá trị máy vừa tính → thay đổi bị bỏ, đếm.
// (Giao diện gửi nguyên giá trị đã nhận thì không bị báo nhầm dù việc đã tiến triển.) Mỗi dòng đếm một lần.
function machineEdits(grouped) {
  const same = (a, b) => String(a ?? '') === String(b ?? '');
  let n = 0;
  for (const list of LISTS) for (const r of grouped[list]) {
    const sent = r._sent; if (!sent) continue;
    const final = { task: r.task, due: r.due, status: r.status, pct: r.pct, list }, saved = r._saved || {};
    const fields = ['task', 'due', 'list', ...(sent.status === 'Vướng' ? [] : ['status']), ...(r._pctUser ? [] : ['pct'])];
    if (fields.some(f => sent[f] !== undefined && sent[f] !== '' && !same(sent[f], final[f]) && !same(sent[f], saved[f]))) n++;
  }
  return n;
}
const strip = data => { for (const list of ALL) for (const r of data[list] || []) for (const f of FLAGS) delete r[f]; return data; };
// K3: dòng tự do trùng tên một dòng gắn việc mà người lưu xem được / sửa được → lỗi hướng sửa chính dòng đó. Dòng người lưu không xem được
// không được so (không xác nhận việc kín tồn tại).
function duplicateFree(data, canTouch = () => true) {
  const named = new Map(WK.allRows(data).filter(r => r.itemId && canTouch(r)).map(r => [norm(r.task), r]));
  return WK.allRows(data).filter(r => !r.itemId && named.has(norm(r.task)))
    .map(r => `“${r.task.length > 50 ? r.task.slice(0, 50) + '…' : r.task}” đã có dòng gắn việc trong báo cáo${named.get(norm(r.task)).auto ? ' (dòng “Hệ thống tự bổ sung”)' : ''} — ghi tình trạng / giải trình vào chính dòng đó, bỏ dòng tự do này.`);
}

// Lưu nháp / tự lưu (PUT /api/weekly/report, MCP kepper_save_weekly_draft). Trả { data, ignored, removed }.
function mergeDraft(raw, ctx, saved, { scopeItems = [], editAll = false, now = new Date() } = {}) {
  const m = mergeSaved(raw, ctx, saved, { scopeItems, editAll });
  recompute(m.data, ctx, scopeItems, now);
  const grouped = WK.regroup(m.data);
  const edits = machineEdits(grouped);
  return { data: strip(grouped), ignored: m.ignored + edits, removed: m.removed };
}

// Nộp / gửi lại (POST /api/weekly/submit). prefill: điền sẵn mới nhất của người gửi.
function prepareSubmit({ raw, ctx, prefill, actions = [], now = new Date(), week, saved = null, scopeItems = [], editAll = false, frozen = false }) {
  const m = mergeSaved(raw, ctx, saved, { scopeItems, editAll, frozen });
  const data = frozen ? m.data : WK.adoptMandatory(m.data, prefill);
  stripForeignActions(data, actions);
  if (!frozen) recompute(data, ctx, scopeItems, now);
  const grouped = WK.regroup(data, { items: !frozen });
  const pct = machineEdits(grouped);
  // Kiểm từng dòng: chỉ dòng người gửi tự sửa (không phải dòng giữ lại, không phải dòng tự bổ sung — giải trình dòng đó là tuỳ chọn).
  const mine = { ...grouped };
  for (const list of LISTS) mine[list] = grouped[list].filter(r => !r._keep && !r._auto && !r.auto);
  const autoIds = autoIdsOf(saved);
  const mandatory = frozen ? [] : [...prefill.results, ...prefill.ongoing, ...prefill.risks].filter(r => r.mandatory && !(r.itemId && autoIds.has(r.itemId)));
  const COUNT = /cần ít nhất 1/;
  const stub = r => ({ task: r.task, ownerIds: [0], due: 'x', status: WK.DONE });
  const whole = WK.validate({ results: grouped.results.map(stub), ongoing: grouped.ongoing.map(stub), risks: grouped.risks.map(stub), plans: grouped.plans.map(p => ({ task: p.task, ownerIds: [0], due: 'x', output: 'x' })) }, week);
  const canTouch = r => m.visible.has(r.itemId) || (m.editAll && m.savedRow.has(partKey('results', r.itemId)));
  const errors = [...whole.filter(e => COUNT.test(e)), ...WK.validate(mine, week, { deptName: ctx.deptName || (() => ''), mandatory }).filter(e => !COUNT.test(e)), ...duplicateFree(grouped, canTouch)];
  return { data: strip(grouped), errors, ignored: m.ignored + pct, removed: m.removed };
}

// full: buildPrefill trên mọi việc của bộ phận; visibleIds: việc người gửi xem được; parentOf: Map id → id cha.
// Tuần đang mở: dòng tự bổ sung còn phải báo cáo thì giữ (kèm giải trình), hết thì bỏ; việc mới thiếu dòng thì thêm. Tuần đã họp: đóng băng.
function finishSubmit(data, week, auto = null, { frozen = false } = {}) {
  let d = data, added = 0;
  if (auto && !frozen) {
    const due = new Set(LISTS.flatMap(k => auto.full[k] || []).map(r => r.itemId).filter(Boolean));
    d = { ...data };
    for (const list of LISTS) d[list] = data[list].filter(r => !r.auto || due.has(r.itemId));
    const a = WK.addAutoRows(d, auto.full, auto.visibleIds, auto.parentOf);
    d = a.data; added = a.added;
  }
  return { final: WK.finalize(WK.regroup(d, { items: !frozen }), week), added };
}

// Xung đột khi nộp / lưu (như PUT): body CÓ khoá baseUpdatedAt → so với bản đã lưu (null = mở trang khi chưa có báo cáo → 0, khác mọi bản đã lưu);
// body KHÔNG có khoá (công cụ cũ / e2e gửi thẳng) → không kiểm. isStale(body, saved) = true → 409 REPORT_CONFLICT.
const baseOf = body => (body && Object.prototype.hasOwnProperty.call(body, 'baseUpdatedAt') ? (body.baseUpdatedAt ? new Date(body.baseUpdatedAt).getTime() : 0) : null);
const isStale = (body, saved) => { const b = baseOf(body); return b != null && !!saved && new Date(saved.updatedAt).getTime() !== b; };

module.exports = { baseOf, isStale, stripForeignActions, mergeSaved, mergeDraft, prepareSubmit, finishSubmit, autoIdsOf, duplicateFree };
