// Báo cáo tuần — chuỗi xử lý khi NỘP (POST /api/weekly/submit), không đụng CSDL. Route và test gọi đúng các hàm này (không chép lại chuỗi).
//   prepareSubmit: làm sạch → nhận dòng bắt buộc còn ở Phần IV → bỏ liên kết Action Log của bộ phận khác → tính lại dòng gắn việc
//                  → xếp lại phần (xong → I, đã bắt đầu → II) → kiểm tra. Xếp lại TRƯỚC kiểm tra: dòng vừa sang Phần II được hỏi
//                  "việc sẽ làm tuần tới" ngay lần nộp này (không để văn bản giao ban thiếu bước tiếp, không bắt điền ở lần "Gửi lại").
//   finishSubmit:  thêm dòng "Hệ thống tự bổ sung" (mục S10) → xếp lại → làm gọn (finalize) thành bản lưu bất biến.
const WK = require('./weekly');
const WR = require('./weekly-recompute');

// Dòng có actionRef không thuộc Action Log đang mở của CHÍNH bộ phận này → bỏ liên kết (không đóng hộ việc của bộ phận khác).
function stripForeignActions(data, actions) {
  const ok = new Set(actions.map(a => a.ref));
  for (const r of [...data.results, ...data.ongoing, ...(data.risks || [])]) if (r.actionRef && !ok.has(r.actionRef)) r.actionRef = null;
}

// ctx: như routes/weekly.js cleanCtx (userIds, deptIds, itemIds, taskIds, deptName, items). prefill: điền sẵn mới nhất của người nộp.
function prepareSubmit({ raw, ctx, prefill, actions = [], now = new Date(), week }) {
  const data = WK.adoptMandatory(WK.sanitize(raw, ctx), prefill);
  stripForeignActions(data, actions);
  WR.recomputeRows(data, ctx.items, now);
  const grouped = WK.regroup(data);
  const mandatory = [...prefill.results, ...prefill.ongoing, ...prefill.risks].filter(r => r.mandatory);
  return { data: grouped, errors: WK.validate(grouped, week, { deptName: ctx.deptName || (() => ''), mandatory }) };
}

// auto (tuỳ chọn): { full: buildPrefill trên mọi việc của bộ phận, visibleIds: việc người nộp xem được, parentOf: Map id → id cha }.
function finishSubmit(data, week, auto = null) {
  const a = auto ? WK.addAutoRows(data, auto.full, auto.visibleIds, auto.parentOf) : { data, added: 0 };
  return { final: WK.finalize(WK.regroup(a.data), week), added: a.added };
}

module.exports = { stripForeignActions, prepareSubmit, finishSubmit };
