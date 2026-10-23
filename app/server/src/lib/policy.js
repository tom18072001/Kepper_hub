// QUY ĐỊNH PHÂN QUYỀN DỮ LIỆU KEPPER HUB — một nguồn duy nhất, thực thi bằng mã (policy-as-code).
// Ma trận: vai trò nghiệp vụ × tập dữ liệu × hành động. Route gọi can() / assertCan(); policy.test.js kiểm từng ô của ma trận.
// Vai trò nghiệp vụ SUY RA từ vai trò + phòng ban đã gán cho tài khoản (cơ chế đã thống nhất) và hai lựa chọn của Ban GĐ
// trong thiết lập giao ban (bộ phận thư ký, danh sách PMO) — không cấp quyền mới cho từng tài khoản, không đổi luồng đăng nhập.
// Sửa ma trận = sửa file này + policy.test.js + docs/data-protection-assessment.md (mục Quy định phân quyền).

// Tập dữ liệu và nhãn (docs/data-protection-assessment.md).
const DATASETS = {
  'weekly.report': { label: 'Bảo mật', pii: 'cơ bản', note: 'Báo cáo tuần của một bộ phận (nguyên nhân chậm, đề nghị hỗ trợ, người phụ trách)' },
  'weekly.summary': { label: 'Bảo mật', pii: 'không', note: 'Bản tổng hợp giao ban mức tóm tắt (như văn bản sao chép: không họ tên)' },
  'weekly.summary.detail': { label: 'Bảo mật', pii: 'cơ bản', note: 'Chi tiết báo cáo mọi bộ phận, ghi chú vắng / muộn, người lập' },
  'weekly.notice': { label: 'Bảo mật', pii: 'cơ bản (có thể nhạy cảm qua ghi chú)', note: 'Thông báo nộp muộn / vắng giao ban' },
  'weekly.meeting': { label: 'Bảo mật', pii: 'cơ bản', note: 'Điểm danh, kết luận TGĐ, Action Log' },
  'weekly.compliance': { label: 'Bảo mật', pii: 'cơ bản', note: 'Điểm tuân thủ giao ban theo trưởng bộ phận' },
  'weekly.config': { label: 'Nội bộ', pii: 'không', note: 'Bộ phận phải nộp, thứ tự, tuần chấm điểm, hạn nộp ngày lễ' },
  'weekly.roles': { label: 'Nội bộ', pii: 'không', note: 'Bộ phận thư ký, danh sách PMO — quyết định vai trò giao ban' },
  'mtl.progress': { label: 'Bảo mật', pii: 'không', note: '% tiến độ, checklist của một hạng mục MTL' },
  'mtl.plan': { label: 'Bảo mật', pii: 'không', note: 'Tên, đường găng, mốc, kế hoạch gốc của hạng mục MTL' },
  'kpi.person': { label: 'Bảo mật', pii: 'cơ bản (đánh giá cá nhân)', note: 'KPI theo người' },
};
const ACTIONS = ['view', 'edit', 'export', 'ai', 'external'];

// QĐ-AI (24/10/2026, chủ dự án quyết): AI DÙNG ĐÚNG QUYỀN CỦA NGƯỜI DÙNG. Người dùng dùng Claude (tài khoản Claude Team công ty)
// với mọi dữ liệu họ được xem / sửa — qua MCP bằng token cá nhân (lib/tokens.js), mọi lời gọi đi qua cùng API + ma trận này.
// Không có tài khoản AI riêng, không có quyền AI rộng hơn người dùng. Thao tác không hoàn tác / phê duyệt vẫn do người dùng làm trên giao diện.
// Số định danh (CCCD, tài khoản ngân hàng) không gửi cho AI — MCP chỉ trả 4 số cuối (tối thiểu hoá khi chuyển dữ liệu ra nước ngoài).
const NEVER_AI = new Set([]);
const NEVER_EXTERNAL = new Set(['weekly.notice', 'kpi.person', 'weekly.compliance', 'weekly.summary.detail', 'weekly.report']);

// subject = { it, director, secretary, pmo, leader, departmentId, userId } — dựng bằng weekly-data.rolesOf().
// ctx: { departmentId } cho dữ liệu của một bộ phận; { createdById } cho thông báo; { item } cho MTL:
//   item = { assigneeIds: [], leadDepartmentId, leadLeaderIds: [], projectManager: bool }.
function can(s, action, dataset, ctx = {}, env = {}) { return !!rule(s, action, dataset, ctx, env); }
function rule(s, action, dataset, ctx, env) {
  if (!s || s.it) return false; // QĐ-01: quản trị IT không xem / sửa / xuất nội dung nghiệp vụ
  if (!DATASETS[dataset] || !ACTIONS.includes(action)) return false;
  if (action === 'ai') return rule(s, 'view', dataset, ctx, env); // QĐ-AI: AI = quyền xem của chính người dùng
  if (action === 'external') { // QĐ-EXT: gửi ra ngoài (mail / Teams / Viber) chỉ bản tóm tắt, do thư ký
    if (NEVER_EXTERNAL.has(dataset)) return false;
    return dataset === 'weekly.summary' && (s.secretary || s.director);
  }
  const own = s.departmentId != null && ctx.departmentId != null && Number(ctx.departmentId) === Number(s.departmentId);
  const full = s.director || s.secretary || s.pmo; // người nhận bản tổng hợp đầy đủ
  switch (dataset) {
    case 'weekly.report':
      // Lập / gửi: thành viên đúng bộ phận (Ban GĐ không lập). Nộp thay bộ phận khác: chỉ thư ký. Xem bộ phận khác: Ban GĐ, thư ký, PMO.
      if (action === 'view') return (own && !s.director) || full;
      if (action === 'edit') return (own && !s.director) || (!own && s.secretary);
      if (action === 'export') return full;
      return false;
    case 'weekly.summary': // QC-TH-01 Điều 5: bản tổng hợp gửi TGĐ và các trưởng bộ phận
      if (action === 'view' || action === 'export') return full || s.leader;
      return false;
    case 'weekly.summary.detail':
      if (action === 'view' || action === 'export') return full;
      return false;
    case 'weekly.notice':
      // Xem: Ban GĐ, thư ký, PMO mọi bộ phận; lãnh đạo bộ phận — bộ phận mình; người tạo — của mình.
      // Ghi chú lý do chỉ người tạo, thư ký, Ban GĐ thấy (ctx.field === 'note').
      if (action === 'view') {
        if (ctx.field === 'note') return s.director || s.secretary || (ctx.createdById != null && ctx.createdById === s.userId);
        return full || (own && s.leader) || (ctx.createdById != null && ctx.createdById === s.userId);
      }
      if (action === 'edit') { // tạo / xoá
        if (ctx.op === 'delete') return s.secretary || (ctx.createdById != null && ctx.createdById === s.userId);
        return (own && !s.director) || (!own && s.secretary);
      }
      return false;
    case 'weekly.meeting':
      if (action === 'view') return full || s.leader;
      if (action === 'edit') return s.director || s.secretary; // TGĐ kết luận; thư ký ghi điểm danh, Action Log
      return false;
    case 'weekly.compliance':
      if (action === 'view' || action === 'export') return s.director || s.secretary; // thư ký lập, TGĐ duyệt (Phụ lục 1)
      return false;
    case 'weekly.config':
      if (action === 'view') return full || s.leader;
      if (action === 'edit') return s.director || s.secretary;
      return false;
    case 'weekly.roles': // ai là thư ký, ai là PMO: chỉ Ban GĐ quyết
      if (action === 'view') return full || s.leader;
      if (action === 'edit') return s.director;
      return false;
    case 'mtl.progress': {
      // % / checklist: người được giao, lãnh đạo bộ phận chủ trì, người quản lý dự án (PMO của dự án).
      const it = ctx.item || {};
      if (action === 'view') return true; // xem đã lọc bằng itemVisibleWhere
      if (action === 'edit') return !!it.projectManager || (it.assigneeIds || []).includes(s.userId) || (it.leadLeaderIds || []).includes(s.userId);
      if (action === 'export') return mtlExport(s, ctx);
      return false;
    }
    case 'mtl.plan': {
      const it = ctx.item || {};
      if (action === 'view') return true;
      if (action === 'edit') {
        // Tên, găng, mốc, hạn, kế hoạch gốc, cấu trúc cây, bộ phận chủ trì của bước MTL tổng: chỉ người quản lý dự án.
        if (it.projectManager) return true;
        // Lãnh đạo bộ phận chủ trì: chi tiết hoá (thêm / sửa việc con) và phân công người trong hạng mục bộ phận mình (MTL bộ phận).
        if (['child', 'detail', 'assign'].includes(ctx.op)) return (it.leadLeaderIds || []).includes(s.userId);
        return false;
      }
      if (action === 'export') return mtlExport(s, ctx);
      return false;
    }
    case 'kpi.person':
      if (action === 'view') return s.director || (own && s.leader) || ctx.self === true || ctx.projectManager === true;
      return false;
    default:
      return false;
  }
}

// Xuất MTL ra tệp (Excel / Word): người quản lý dự án, Ban GĐ; lãnh đạo bộ phận chỉ phần bộ phận mình (op 'dept').
function mtlExport(s, ctx) {
  const it = ctx.item || {};
  return !!it.projectManager || !!s.director || (ctx.op === 'dept' && (it.leadLeaderIds || []).includes(s.userId));
}

class PolicyError extends Error { constructor(message) { super(message); this.status = 403; this.code = 'FORBIDDEN'; } }
const MESSAGES = {
  'weekly.report': 'Chỉ thành viên bộ phận lập báo cáo của bộ phận mình; thư ký giao ban nhập thay bộ phận khác',
  'weekly.summary.detail': 'Chi tiết báo cáo các bộ phận chỉ Ban giám đốc, thư ký giao ban, PMO xem',
  'weekly.notice': 'Chỉ báo cho bộ phận của mình; thư ký giao ban báo thay',
  'weekly.meeting': 'Chỉ TGĐ / Ban giám đốc và thư ký giao ban ghi điểm danh, kết luận, Action Log',
  'weekly.compliance': 'Điểm tuân thủ chỉ thư ký giao ban và Ban giám đốc xem',
  'weekly.roles': 'Chỉ Ban giám đốc chọn bộ phận thư ký và PMO',
  'mtl.progress': 'Chỉ người được giao, lãnh đạo bộ phận chủ trì hoặc người quản lý dự án cập nhật tiến độ hạng mục này',
  'mtl.plan': 'Kế hoạch MTL (tên, găng, mốc, hạn, cấu trúc, phân công) do người quản lý dự án sửa; lãnh đạo bộ phận chủ trì chi tiết hoá phần bộ phận mình',
};
function assertCan(s, action, dataset, ctx, env) {
  if (!can(s, action, dataset, ctx, env)) throw new PolicyError(MESSAGES[dataset] || 'Bạn không có quyền với dữ liệu này');
}

module.exports = { DATASETS, ACTIONS, NEVER_AI, NEVER_EXTERNAL, can, assertCan, PolicyError };
