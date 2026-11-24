// Báo cáo tuần — gộp bản lưu và chuỗi xử lý khi NỘP / GỬI LẠI, không đụng CSDL. Route và test gọi đúng các hàm này (không chép lại chuỗi).
//
// QUY TẮC GỐC (nghiệm thu vòng 4) — áp cho MỌI đường lưu: lưu nháp, tự lưu, nộp, gửi lại, MCP kepper_save_weekly_draft:
//   "Một dòng gắn việc chỉ được THÊM / SỬA / XOÁ bởi người xem được việc đó. Mọi lần lưu đều GỘP theo itemId với bản đã lưu: dòng của
//    việc mà người thao tác không xem được được giữ NGUYÊN — mọi phần I–IV, mọi trường, đúng phần cũ. Hiển thị thì lọc theo NGƯỜI XEM."
//   - mergeSaved: bản gửi lên đã làm sạch với itemIds = việc người thao tác xem được (sanitize bỏ hẳn dòng gắn việc khác — mọi trường của
//     dòng đó bị bỏ qua, kể cả giải trình / tình trạng / đề nghị hỗ trợ). Dòng của việc người thao tác không xem được lấy NGUYÊN từ bản đã lưu.
//   - Dòng "Hệ thống tự bổ sung" (mục S10) là dữ liệu của máy chủ: chỉ đọc với mọi người; khi nộp luôn dựng lại từ phạm vi bộ phận.
//   - Một việc = một dòng (gộp theo itemId).
//
//   prepareSubmit: làm sạch → gộp bản lưu → nhận dòng bắt buộc còn ở Phần IV → bỏ liên kết Action Log của bộ phận khác → tính lại dòng gắn
//                  việc của người gửi → xếp lại phần → kiểm tra (chỉ dòng người gửi sửa được) → trả lại dòng giữ nguyên.
//   finishSubmit:  thêm dòng "Hệ thống tự bổ sung" → xếp lại → làm gọn (finalize) thành bản lưu bất biến.
const WK = require('./weekly');
const WR = require('./weekly-recompute');

const LISTS = ['results', 'ongoing', 'risks'];
const ALL = [...LISTS, 'plans'];

// Dòng có actionRef không thuộc Action Log đang mở của CHÍNH bộ phận này → bỏ liên kết (không đóng hộ việc của bộ phận khác).
function stripForeignActions(data, actions) {
  const ok = new Set(actions.map(a => a.ref));
  for (const r of [...data.results, ...data.ongoing, ...(data.risks || [])]) if (r.actionRef && !ok.has(r.actionRef)) r.actionRef = null;
}

// Mã việc của dòng tự bổ sung trong bản đã lưu.
const autoIdsOf = saved => new Set(WK.allRows(saved).filter(r => r.auto && r.itemId).map(r => r.itemId));

// clean: bản gửi lên đã làm sạch với itemIds = visible (việc người thao tác xem được). saved: bản đã lưu (nháp hoặc đã nộp).
// keepAuto: lưu nháp giữ dòng tự bổ sung như đã lưu; nộp thì bỏ để dựng lại (finishSubmit).
// Trả { data: phần người thao tác quyết, held: [{ list, row }] dòng giữ nguyên, autoIds }.
function mergeSaved(clean, saved, visible, { keepAuto = true } = {}) {
  // Một việc = một dòng trong Phần I–III, và = một dòng trong Phần IV (một việc vừa báo tuần này vừa có kế hoạch tuần mới là hợp lệ).
  const autoIds = autoIdsOf(saved), seen = { report: new Set(), plans: new Set() };
  const part = list => (list === 'plans' ? seen.plans : seen.report);
  const data = { ...clean };
  for (const list of ALL) data[list] = (clean[list] || []).filter(r => {
    if (!r.itemId) return true;
    if (!visible.has(r.itemId) || autoIds.has(r.itemId) || part(list).has(r.itemId)) return false; // việc không xem được / tự bổ sung / trùng
    part(list).add(r.itemId);
    return true;
  });
  const held = [];
  for (const list of ALL) for (const r of saved?.[list] || []) {
    if (!r?.itemId || part(list).has(r.itemId)) continue;
    if (r.auto ? !keepAuto : visible.has(r.itemId)) continue; // dòng của việc người thao tác xem được: họ quyết (sửa / xoá)
    part(list).add(r.itemId);
    held.push({ list, row: structuredClone(r) });
  }
  return { data, held, autoIds };
}
const restore = (data, held) => { for (const { list, row } of held) data[list].push(row); return data; };

// Lưu nháp / tự lưu (PUT /api/weekly/report, MCP kepper_save_weekly_draft): làm sạch + gộp với bản nháp đã lưu.
function mergeDraft(raw, ctx, saved) {
  const visible = ctx.itemIds || new Set();
  const { data, held } = mergeSaved(WK.sanitize(raw, ctx), saved, visible, { keepAuto: true });
  return restore(data, held);
}

// ctx: như routes/weekly.js cleanCtx (userIds, deptIds, itemIds = việc người gửi xem được, taskIds, deptName, items).
// prefill: điền sẵn mới nhất của người gửi. saved: bản đã lưu (nháp hoặc đã nộp). scopeItems: mọi việc của bộ phận (DEPT_SCOPE).
function prepareSubmit({ raw, ctx, prefill, actions = [], now = new Date(), week, saved = null, scopeItems = [] }) {
  const visible = ctx.itemIds || new Set();
  const { data: mine0, held, autoIds } = mergeSaved(WK.sanitize(raw, ctx), saved, visible, { keepAuto: false });
  const data = WK.adoptMandatory(mine0, prefill);
  stripForeignActions(data, actions);
  const byId = new Map([...scopeItems, ...(ctx.items || [])].map(i => [i.id, i]));
  WR.recomputeRows(data, [...byId.values()], now);
  const grouped = WK.regroup(data);
  // Kiểm tra từng dòng: chỉ dòng người gửi sửa được (dòng giữ nguyên không hiện lỗi — lộ tên việc, người gửi không sửa được).
  const mandatory = [...prefill.results, ...prefill.ongoing, ...prefill.risks].filter(r => r.mandatory && !(r.itemId && autoIds.has(r.itemId)));
  const COUNT = /cần ít nhất 1/;
  const rowErrors = WK.validate(grouped, week, { deptName: ctx.deptName || (() => ''), mandatory }).filter(e => !COUNT.test(e));
  const out = restore({ ...grouped, results: [...grouped.results], ongoing: [...grouped.ongoing], risks: [...grouped.risks], plans: [...grouped.plans] }, held);
  // "Ít nhất 1 hạng mục / việc" xét trên TOÀN báo cáo (kể cả dòng giữ nguyên).
  const stub = r => ({ task: r.task, ownerIds: [0], due: 'x', status: WK.DONE });
  const whole = WK.validate({ results: out.results.map(stub), ongoing: out.ongoing.map(stub), risks: out.risks.map(stub), plans: out.plans.map(p => ({ task: p.task, ownerIds: [0], due: 'x', output: 'x' })) }, week);
  return { data: out, errors: [...whole.filter(e => COUNT.test(e)), ...rowErrors], autoIds, held: new Set(held.map(h => h.row)) };
}

// auto (tuỳ chọn): { full: buildPrefill trên mọi việc của bộ phận, visibleIds: việc người gửi xem được, parentOf: Map id → id cha,
//   autoIds: mã việc tự bổ sung của bản đã lưu — luôn dựng lại là dòng tự bổ sung dù người gửi xem được }.
// held: các dòng giữ nguyên (prepareSubmit) — không xếp lại, không làm gọn: giữ đúng phần cũ, mọi trường.
function finishSubmit(data, week, auto = null, heldRows = new Set()) {
  const visibleIds = auto ? new Set([...auto.visibleIds].filter(id => !auto.autoIds?.has(id))) : null;
  const a = auto ? WK.addAutoRows(data, auto.full, visibleIds, auto.parentOf) : { data, added: 0 };
  const held = [], rest = { ...a.data };
  for (const list of ALL) rest[list] = (a.data[list] || []).filter(r => (heldRows.has(r) ? (held.push({ list, row: r }), false) : true));
  return { final: restore(WK.finalize(WK.regroup(rest), week), held), added: a.added };
}

module.exports = { stripForeignActions, mergeSaved, mergeDraft, prepareSubmit, finishSubmit, autoIdsOf };
