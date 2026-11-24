// Báo cáo tuần — gộp bản lưu và chuỗi xử lý khi LƯU NHÁP / NỘP / GỬI LẠI, không đụng CSDL. Route và test gọi đúng các hàm này.
//
// QUY TẮC GỐC (nghiệm thu vòng 4, làm rõ vòng 5) — áp cho MỌI đường lưu: lưu nháp, tự lưu, nộp, gửi lại, MCP kepper_save_weekly_draft.
//   - Trường DO NGƯỜI NHẬP (tình trạng "Vướng", nguyên nhân, giải pháp, đề nghị hỗ trợ, việc tuần tới, % do người lập ghi, dòng Phần IV):
//     chỉ người ĐƯỢC SỬA dòng đó thêm / sửa / xoá — người xem được việc, hoặc người có quyền sửa báo cáo mà xem được nội dung mọi dòng
//     (thư ký: người xem tổng hợp đầy đủ + quyền sửa — `editAll`). Người khác gửi gì cho dòng đó cũng bị bỏ qua và ĐƯỢC BÁO LẠI (ignored).
//   - Trường DO MÁY TÍNH (tên, mã, hạn, người phụ trách, %, tình trạng theo hệ thống, nguy cơ, dòng thuộc Phần I / II / III): LUÔN tính lại
//     từ việc ở mọi lần lưu, với MỌI dòng (kể cả dòng giữ lại và dòng tự bổ sung).
//   - Mọi lần lưu GỘP theo itemId với bản đã lưu (nháp hoặc đã nộp); một việc = một dòng ở Phần I–III và một dòng ở Phần IV.
//     Dòng của việc không còn trong phạm vi bộ phận (đã lưu trữ, huỷ) bị bỏ.
//   - Dòng "Hệ thống tự bổ sung" (mục S10): không ai xoá được (máy chủ quyết theo phạm vi bộ phận); người được sửa nhập được các trường do
//     người nhập vào chính dòng đó (nới quy tắc vòng 5); vẫn mang nhãn, vẫn ẩn tên với người không xem được.
//   - Không có dòng tự do trùng tên một việc đã có dòng: báo lỗi, hướng người dùng sửa chính dòng gắn việc.
const WK = require('./weekly');
const WR = require('./weekly-recompute');

const LISTS = ['results', 'ongoing', 'risks'];
const ALL = [...LISTS, 'plans'];
const USER_FIELDS = ['cause', 'solution', 'helpFrom', 'helpWhat', 'helpBy', 'next'];

// Dòng có actionRef không thuộc Action Log đang mở của CHÍNH bộ phận này → bỏ liên kết (không đóng hộ việc của bộ phận khác).
function stripForeignActions(data, actions) {
  const ok = new Set(actions.map(a => a.ref));
  for (const r of [...data.results, ...data.ongoing, ...(data.risks || [])]) if (r.actionRef && !ok.has(r.actionRef)) r.actionRef = null;
}

// Mã việc của dòng tự bổ sung trong bản đã lưu.
const autoIdsOf = saved => new Set(WK.allRows(saved).filter(r => r.auto && r.itemId).map(r => r.itemId));
const norm = t => String(t || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

// raw: dữ liệu gửi lên. ctx: cleanCtx của route (itemIds = việc người thao tác xem được, …). saved: bản đã lưu.
// scopeItems: mọi việc của bộ phận (DEPT_SCOPE). editAll: người thao tác được sửa trường do người nhập của MỌI dòng (thư ký).
// Trả { data, ignored } — data có cờ tạm _keep (dòng người thao tác không được sửa) / _auto, gỡ bằng strip().
function mergeSaved(raw, ctx, saved, { scopeItems = [], editAll = false } = {}) {
  const visible = ctx.itemIds || new Set();
  const scope = new Map([...scopeItems, ...(ctx.items || [])].map(i => [i.id, i]));
  const savedIds = WK.allRows(saved).concat(saved?.plans || []).map(r => r.itemId).filter(Boolean);
  const editable = new Set([...visible, ...(editAll ? [...scope.keys(), ...savedIds] : [])]);
  const live = id => scope.has(id) && !scope.get(id).cancelled; // việc còn trong phạm vi bộ phận
  // Thay đổi gửi cho dòng người thao tác không được sửa → bỏ qua và báo lại (không im lặng).
  const d = raw && typeof raw === 'object' ? raw : {};
  const ignored = ALL.flatMap(k => (Array.isArray(d[k]) ? d[k] : [])).filter(r => r && r.itemId != null && r.itemId !== '' && !editable.has(r.itemId)).length;
  const clean = WK.sanitize(d, { ...ctx, itemIds: editable, taskIds: new Set([...(ctx.taskIds || []), ...scopeItems.filter(i => i.kind === 'TASK').map(i => i.id)]) });
  const savedAuto = new Map(), savedRow = new Map();
  for (const list of ALL) for (const r of saved?.[list] || []) {
    if (!r?.itemId) continue;
    const k = `${list === 'plans' ? 'p' : 'r'}${r.itemId}`;
    if (!savedRow.has(k)) savedRow.set(k, { list, row: r });
    if (r.auto && list !== 'plans') savedAuto.set(r.itemId, r);
  }
  const seen = new Set(), data = { ...clean }, autoRows = [];
  const keyOf = (list, id) => `${list === 'plans' ? 'p' : 'r'}${id}`;
  for (const list of ALL) data[list] = (clean[list] || []).flatMap(r => {
    if (!r.itemId) return [r];
    const k = keyOf(list, r.itemId);
    if (seen.has(k) || !live(r.itemId)) return [];
    seen.add(k);
    const auto = list !== 'plans' && savedAuto.get(r.itemId);
    if (!auto) return [r];
    // Dòng tự bổ sung: giữ dòng của máy chủ (đúng phần đã lưu), nhận các trường do người nhập.
    const x = structuredClone(auto);
    for (const f of USER_FIELDS) x[f] = r[f];
    if (r.status === 'Vướng') x.status = 'Vướng'; else if (x.status === 'Vướng') x.status = 'Đúng tiến độ';
    autoRows.push({ list: savedRow.get(k).list, row: { ...x, _auto: true } });
    return [];
  });
  for (const { list, row } of autoRows) data[list].push(row);
  // Dòng đã lưu người thao tác không gửi lại: chỉ người XEM ĐƯỢC việc bỏ được dòng (thư ký chỉ sửa trường người nhập, không bỏ dòng của
  // việc mình không xem được); dòng tự bổ sung không ai bỏ được. Còn lại giữ nguyên trường người nhập.
  for (const [k, { list, row }] of savedRow) {
    if (seen.has(k) || !live(row.itemId)) continue;
    const keep = !visible.has(row.itemId), auto = row.auto && list !== 'plans';
    if (!keep && !auto) continue;
    seen.add(k);
    data[list].push({ ...structuredClone(row), ...(keep ? { _keep: true } : {}), ...(auto ? { _auto: true } : {}) });
  }
  return { data, ignored };
}
const strip = data => { for (const list of ALL) for (const r of data[list] || []) { delete r._keep; delete r._auto; } return data; };
// Dòng tự do trùng tên một việc đã có dòng (vd. thư ký gõ lại tên dòng tự bổ sung) → lỗi, hướng sửa chính dòng gắn việc.
function duplicateFree(data) {
  const named = new Map(WK.allRows(data).filter(r => r.itemId).map(r => [norm(r.task), r]));
  return WK.allRows(data).filter(r => !r.itemId && named.has(norm(r.task)))
    .map(r => `“${r.task.length > 50 ? r.task.slice(0, 50) + '…' : r.task}” đã có dòng gắn việc trong báo cáo${named.get(norm(r.task)).auto ? ' (dòng “Hệ thống tự bổ sung”)' : ''} — ghi tình trạng / giải trình vào chính dòng đó, bỏ dòng tự do này.`);
}
const recompute = (data, ctx, scopeItems, now) => WR.recomputeRows(data, [...new Map([...scopeItems, ...(ctx.items || [])].map(i => [i.id, i])).values()], now);

// Lưu nháp / tự lưu (PUT /api/weekly/report, MCP kepper_save_weekly_draft). Trả { data, ignored }.
function mergeDraft(raw, ctx, saved, { scopeItems = [], editAll = false, now = new Date() } = {}) {
  const { data, ignored } = mergeSaved(raw, ctx, saved, { scopeItems, editAll });
  recompute(data, ctx, scopeItems, now);
  return { data: strip(WK.regroup(data)), ignored };
}

// Nộp / gửi lại (POST /api/weekly/submit). prefill: điền sẵn mới nhất của người gửi.
function prepareSubmit({ raw, ctx, prefill, actions = [], now = new Date(), week, saved = null, scopeItems = [], editAll = false }) {
  const { data: merged, ignored } = mergeSaved(raw, ctx, saved, { scopeItems, editAll });
  const data = WK.adoptMandatory(merged, prefill);
  stripForeignActions(data, actions);
  recompute(data, ctx, scopeItems, now);
  const grouped = WK.regroup(data);
  // Kiểm từng dòng: chỉ dòng người gửi sửa được và không phải dòng tự bổ sung (giải trình dòng tự bổ sung là tuỳ chọn) — dòng giữ lại
  // không hiện lỗi (lộ tên việc, người gửi không sửa được). "Ít nhất 1 hạng mục / việc" xét trên toàn báo cáo.
  const mine = { ...grouped };
  for (const list of LISTS) mine[list] = grouped[list].filter(r => !r._keep && !r._auto && !r.auto);
  const autoIds = autoIdsOf(saved);
  const mandatory = [...prefill.results, ...prefill.ongoing, ...prefill.risks].filter(r => r.mandatory && !(r.itemId && autoIds.has(r.itemId)));
  const COUNT = /cần ít nhất 1/;
  const stub = r => ({ task: r.task, ownerIds: [0], due: 'x', status: WK.DONE });
  const whole = WK.validate({ results: grouped.results.map(stub), ongoing: grouped.ongoing.map(stub), risks: grouped.risks.map(stub), plans: grouped.plans.map(p => ({ task: p.task, ownerIds: [0], due: 'x', output: 'x' })) }, week);
  const errors = [...whole.filter(e => COUNT.test(e)), ...WK.validate(mine, week, { deptName: ctx.deptName || (() => ''), mandatory }).filter(e => !COUNT.test(e)), ...duplicateFree(grouped)];
  return { data: strip(grouped), errors, ignored };
}

// full: buildPrefill trên mọi việc của bộ phận; visibleIds: việc người gửi xem được; parentOf: Map id → id cha.
// Dòng tự bổ sung còn phải báo cáo thì giữ (kèm giải trình đã nhập), hết phải báo cáo thì bỏ; việc mới thiếu dòng thì thêm.
function finishSubmit(data, week, auto = null) {
  let d = data, added = 0;
  if (auto) {
    const due = new Set(['results', 'ongoing', 'risks'].flatMap(k => auto.full[k] || []).map(r => r.itemId).filter(Boolean));
    d = { ...data };
    for (const list of LISTS) d[list] = data[list].filter(r => !r.auto || due.has(r.itemId));
    const a = WK.addAutoRows(d, auto.full, auto.visibleIds, auto.parentOf);
    d = a.data; added = a.added;
  }
  return { final: WK.finalize(WK.regroup(d), week), added };
}

module.exports = { stripForeignActions, mergeSaved, mergeDraft, prepareSubmit, finishSubmit, autoIdsOf, duplicateFree };
