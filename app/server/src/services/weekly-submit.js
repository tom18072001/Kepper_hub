// Báo cáo tuần — chuỗi xử lý khi NỘP / GỬI LẠI (POST /api/weekly/submit), không đụng CSDL. Route và test gọi đúng các hàm này (không chép lại chuỗi).
//   prepareSubmit: làm sạch → giữ dòng của máy chủ (bản đã lưu) → nhận dòng bắt buộc còn ở Phần IV → bỏ liên kết Action Log của bộ phận khác
//                  → tính lại dòng gắn việc → xếp lại phần (xong → I, đã bắt đầu → II) → kiểm tra. Xếp lại TRƯỚC kiểm tra: dòng vừa sang Phần II
//                  được hỏi "việc sẽ làm tuần tới" ngay lần nộp này.
//   finishSubmit:  thêm dòng "Hệ thống tự bổ sung" (mục S10) → xếp lại → làm gọn (finalize) thành bản lưu bất biến.
//
// Dòng của máy chủ (nghiệm thu vòng 3): mã việc (itemId) và cờ tự bổ sung (auto) KHÔNG phụ thuộc người bấm gửi.
//   - Dòng tự bổ sung đã lưu: luôn dựng lại từ phạm vi bộ phận (finishSubmit), bản gửi lên không sửa / bỏ / biến thành dòng thường được.
//   - Dòng gắn việc mà người gửi KHÔNG xem được (vd. thư ký, Ban GĐ nhập thay; trưởng phòng gửi lại dòng nhân viên nhập): giữ từ bản đã lưu,
//     chỉ nhận phần giải trình (nguyên nhân, giải pháp, đề nghị hỗ trợ, việc tuần tới) người gửi sửa; người gửi bỏ khỏi biểu mẫu thì vẫn giữ.
//   - Một việc = một dòng (gộp theo itemId). Dòng gắn việc không hợp lệ bị bỏ, không thành dòng tự do giữ nguyên tên việc.
const WK = require('./weekly');
const WR = require('./weekly-recompute');

const LISTS = ['results', 'ongoing', 'risks'];
const EDITABLE = ['cause', 'solution', 'helpFrom', 'helpWhat', 'helpBy', 'next'];

// Dòng có actionRef không thuộc Action Log đang mở của CHÍNH bộ phận này → bỏ liên kết (không đóng hộ việc của bộ phận khác).
function stripForeignActions(data, actions) {
  const ok = new Set(actions.map(a => a.ref));
  for (const r of [...data.results, ...data.ongoing, ...(data.risks || [])]) if (r.actionRef && !ok.has(r.actionRef)) r.actionRef = null;
}

// Mã việc của dòng tự bổ sung trong bản đã lưu.
const autoIdsOf = saved => new Set(WK.allRows(saved).filter(r => r.auto && r.itemId).map(r => r.itemId));

// ctx: như routes/weekly.js cleanCtx (userIds, deptIds, itemIds = việc người gửi xem được, taskIds, deptName, items).
// prefill: điền sẵn mới nhất của người gửi. saved: bản đã lưu (gửi lại). scopeItems: mọi việc của bộ phận (phạm vi bộ phận, DEPT_SCOPE).
function prepareSubmit({ raw, ctx, prefill, actions = [], now = new Date(), week, saved = null, scopeItems = [] }) {
  const visible = ctx.itemIds || new Set(), autoIds = autoIdsOf(saved);
  const savedRows = new Map();
  for (const list of LISTS) for (const r of saved?.[list] || []) if (r?.itemId && !r.auto && !savedRows.has(r.itemId)) savedRows.set(r.itemId, { list, row: r });
  const owned = id => !visible.has(id) && savedRows.has(id); // dòng gắn việc người gửi không xem được, có trong bản đã lưu
  const scopeTasks = new Set(scopeItems.filter(i => i.kind === 'TASK').map(i => i.id));
  const clean = WK.sanitize(raw, { ...ctx, itemIds: new Set([...visible, ...savedRows.keys(), ...autoIds]), taskIds: new Set([...(ctx.taskIds || []), ...scopeTasks]) });
  // Một việc = một dòng; dòng tự bổ sung bỏ (dựng lại ở finishSubmit); dòng của máy chủ: bản đã lưu + phần giải trình người gửi sửa.
  const seen = new Set();
  for (const list of LISTS) clean[list] = clean[list].filter(r => {
    if (!r.itemId) return true;
    if (autoIds.has(r.itemId) || seen.has(r.itemId)) return false;
    seen.add(r.itemId);
    return true;
  }).map(r => {
    if (!owned(r.itemId)) return r;
    const keep = structuredClone(savedRows.get(r.itemId).row);
    for (const k of EDITABLE) if (r[k] !== undefined) keep[k] = r[k];
    if (r.status === 'Vướng' || keep.status === 'Vướng') keep.status = r.status === 'Vướng' ? 'Vướng' : keep.status;
    return { ...keep, owned: true };
  });
  clean.plans = clean.plans.filter(p => !p.itemId || (!autoIds.has(p.itemId) && !owned(p.itemId)));
  // Dòng của máy chủ người gửi không có trên biểu mẫu (bị ẩn với họ) → giữ nguyên ở phần cũ.
  for (const [id, { list, row }] of savedRows) if (owned(id) && !seen.has(id)) { seen.add(id); clean[list].push({ ...structuredClone(row), owned: true }); }
  const data = WK.adoptMandatory(clean, prefill);
  stripForeignActions(data, actions);
  const byId = new Map([...scopeItems, ...(ctx.items || [])].map(i => [i.id, i]));
  WR.recomputeRows(data, [...byId.values()], now);
  const grouped = WK.regroup(data);
  // Kiểm tra chỉ những dòng người gửi sửa được: dòng của máy chủ không hiện lỗi (lộ tên việc, người gửi không sửa được).
  const mine = { ...grouped, results: grouped.results.filter(r => !r.owned), ongoing: grouped.ongoing.filter(r => !r.owned), risks: grouped.risks.filter(r => !r.owned) };
  const mandatory = [...prefill.results, ...prefill.ongoing, ...prefill.risks].filter(r => r.mandatory && !(r.itemId && autoIds.has(r.itemId)));
  // Điều kiện "ít nhất 1 hạng mục / việc" xét trên TOÀN báo cáo (kể cả dòng của máy chủ); kiểm từng dòng thì chỉ dòng người gửi sửa được.
  const whole = WK.validate({ ...grouped, results: grouped.results.map(r => ({ task: r.task, ownerIds: [0], due: 'x', status: WK.DONE })), ongoing: grouped.ongoing.map(r => ({ task: r.task, ownerIds: [0], due: 'x', status: WK.DONE })), risks: grouped.risks.map(r => ({ task: r.task, ownerIds: [0], due: 'x', status: WK.DONE })), plans: grouped.plans.map(p => ({ task: p.task, ownerIds: [0], due: 'x', output: 'x' })) }, week);
  const COUNT = /cần ít nhất 1/;
  const errors = [...whole.filter(e => COUNT.test(e)), ...WK.validate(mine, week, { deptName: ctx.deptName || (() => ''), mandatory }).filter(e => !COUNT.test(e))];
  for (const list of LISTS) for (const r of grouped[list]) delete r.owned;
  return { data: grouped, errors, autoIds };
}

// auto (tuỳ chọn): { full: buildPrefill trên mọi việc của bộ phận, visibleIds: việc người gửi xem được, parentOf: Map id → id cha,
//   autoIds: mã việc tự bổ sung của bản đã lưu — luôn dựng lại là dòng tự bổ sung dù người gửi xem được }.
function finishSubmit(data, week, auto = null) {
  const visibleIds = auto ? new Set([...auto.visibleIds].filter(id => !auto.autoIds?.has(id))) : null;
  const a = auto ? WK.addAutoRows(data, auto.full, visibleIds, auto.parentOf) : { data, added: 0 };
  return { final: WK.finalize(WK.regroup(a.data), week), added: a.added };
}

module.exports = { stripForeignActions, prepareSubmit, finishSubmit, autoIdsOf };
