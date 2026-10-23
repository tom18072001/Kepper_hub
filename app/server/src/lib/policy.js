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
  // ---- Playground CRM đối tác (nhà thầu, tư vấn, cơ quan, ngân hàng, nhà cung cấp) ----
  'crm.partner': { label: 'Nội bộ', pii: 'không (thông tin tổ chức)', note: 'Tên, loại, MST, địa chỉ, tổng đài của đối tác — mọi cán bộ xem để phối hợp' },
  'crm.contact': { label: 'Bảo mật', pii: 'cơ bản (đầu mối của đối tác)', note: 'Họ tên, chức danh, điện thoại, email người liên hệ' },
  'crm.interaction': { label: 'Bảo mật', pii: 'cơ bản', note: 'Nhật ký làm việc với đối tác, việc cần theo dõi' },
  'crm.engagement': { label: 'Bảo mật', pii: 'không', note: 'Hợp đồng / gói thầu / thoả thuận / giấy phép, giá trị' },
  // ---- Playground HRM (hồ sơ, hợp đồng, nghỉ phép, chấm công) ----
  'hrm.profile': { label: 'Bảo mật', pii: 'cơ bản', note: 'Hồ sơ nhân sự: mã NV, ngày vào, trạng thái; trường riêng tư: ngày sinh, giới tính, liên hệ cá nhân, địa chỉ, người liên hệ khẩn cấp, học vấn' },
  'hrm.identity': { label: 'Hạn chế', pii: 'cơ bản (số định danh)', note: 'Số CCCD, ngày / nơi cấp — mã hoá theo trường, AI chỉ thấy 4 số cuối' },
  'hrm.contract': { label: 'Hạn chế', pii: 'cơ bản + tài chính cá nhân (lương)', note: 'Hợp đồng lao động; lương mã hoá theo trường, không gửi AI' },
  'hrm.leave': { label: 'Bảo mật', pii: 'cơ bản (có thể nhạy cảm nếu ghi bệnh)', note: 'Đơn nghỉ phép; lý do ≤ 200 ký tự, không ghi chi tiết bệnh' },
  'hrm.attendance': { label: 'Bảo mật', pii: 'cơ bản (thời gian, IP)', note: 'Giờ vào / ra, đi muộn / về sớm, giải trình' },
  'hrm.config': { label: 'Nội bộ', pii: 'không', note: 'Giờ làm, ngày làm, ngày lễ, mạng văn phòng, người phụ trách nhân sự' },
};
const ACTIONS = ['view', 'edit', 'export', 'ai', 'external'];

// QĐ-AI (24/10/2026, chủ dự án quyết): AI DÙNG ĐÚNG QUYỀN CỦA NGƯỜI DÙNG. Người dùng dùng Claude (tài khoản Claude Team công ty)
// với mọi dữ liệu họ được xem / sửa — qua MCP bằng token cá nhân (lib/tokens.js), mọi lời gọi đi qua cùng API + ma trận này.
// Không có tài khoản AI riêng, không có quyền AI rộng hơn người dùng. Thao tác không hoàn tác / phê duyệt vẫn do người dùng làm trên giao diện.
// Số định danh (CCCD, tài khoản ngân hàng) không gửi cho AI — MCP chỉ trả 4 số cuối (tối thiểu hoá khi chuyển dữ liệu ra nước ngoài).
const NEVER_AI = new Set([]);
const NEVER_EXTERNAL = new Set(['weekly.notice', 'kpi.person', 'weekly.compliance', 'weekly.summary.detail', 'weekly.report',
  'crm.contact', 'crm.interaction', 'crm.engagement', 'hrm.profile', 'hrm.identity', 'hrm.contract', 'hrm.leave', 'hrm.attendance']);
// Trường không bao giờ trả cho AI (token Claude), kể cả người có quyền xem: route trả 4 số cuối / bỏ trường.
const NEVER_AI_FIELDS = { 'hrm.identity': ['idNumber'], 'hrm.contract': ['salary'] };

// subject = { it, director, secretary, pmo, leader, departmentId, userId, hr } — dựng bằng weekly-data.rolesOf() (+ hr: services/hrm.js).
// CRM ctx: { departmentId: bộ phận phụ trách đối tác, ownerUserId, participant: người ghi / người được giao theo dõi, op }.
// HRM ctx: { targetUserId, departmentId: bộ phận của người đó, targetLeader: lãnh đạo bộ phận / Ban GĐ, targetDirector, targetHr: người phụ trách nhân sự, field, op }.
// Người phụ trách nhân sự KHÔNG tự sửa hồ sơ / hợp đồng / lương / CCCD / chấm công của chính mình — Ban GĐ (hoặc người phụ trách nhân sự khác) làm.
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

    // ---------- CRM: đối tác thuộc MỘT bộ phận phụ trách (ownerDepartment) + người phụ trách (ownerUser) ----------
    case 'crm.partner': {
      const owner = s.director || own || (ctx.ownerUserId != null && ctx.ownerUserId === s.userId);
      if (action === 'view') return true; // danh bạ tổ chức đối tác: mọi cán bộ (trừ IT)
      if (action === 'edit') {
        if (ctx.op === 'create') return s.director || s.departmentId != null; // tạo cho bộ phận mình; Ban GĐ chọn bộ phận
        if (ctx.op === 'archive' || ctx.op === 'transfer') return s.director || (own && s.leader); // ngừng theo dõi / chuyển bộ phận phụ trách
        return owner;
      }
      return false;
    }
    case 'crm.contact':
      if (action === 'view' || action === 'edit') return s.director || own || (ctx.ownerUserId != null && ctx.ownerUserId === s.userId);
      return false;
    case 'crm.interaction': {
      const owner = s.director || own || (ctx.ownerUserId != null && ctx.ownerUserId === s.userId);
      if (action === 'view') return owner || ctx.participant === true;
      if (action === 'edit') {
        if (ctx.op === 'followup') return owner || ctx.participant === true; // người được giao theo dõi đánh dấu xong
        return owner;
      }
      return false;
    }
    case 'crm.engagement': // giá trị hợp đồng / gói thầu: lãnh đạo bộ phận phụ trách, người phụ trách, Ban GĐ
      if (action === 'view' || action === 'edit') return s.director || (own && s.leader) || (ctx.ownerUserId != null && ctx.ownerUserId === s.userId);
      return false;

    // ---------- HRM: người phụ trách nhân sự (hr) do Ban GĐ chỉ định trong thiết lập HRM ----------
    case 'hrm.profile': {
      const self = ctx.targetUserId != null && ctx.targetUserId === s.userId;
      if (action === 'view') {
        if (self || s.hr || s.director) return true;
        return own && s.leader && ctx.field !== 'private'; // lãnh đạo bộ phận: chỉ trường cơ bản người trong bộ phận
      }
      if (action === 'edit') return hrEdit(s, ctx, self) || (self && ctx.op === 'contact'); // tự sửa liên hệ cá nhân, người liên hệ khẩn cấp
      return false;
    }
    case 'hrm.identity': { // số CCCD: chỉ chính người đó và người phụ trách nhân sự (Ban GĐ không cần — tối thiểu hoá)
      const self = ctx.targetUserId != null && ctx.targetUserId === s.userId;
      if (action === 'view') return self || s.hr;
      if (action === 'edit') return hrEdit(s, ctx, self);
      return false;
    }
    case 'hrm.contract': {
      const self = ctx.targetUserId != null && ctx.targetUserId === s.userId;
      if (action === 'view') return self || s.hr || s.director;
      if (action === 'edit') return hrEdit(s, ctx, self);
      return false;
    }
    case 'hrm.leave': {
      const self = ctx.targetUserId != null && ctx.targetUserId === s.userId;
      // Lãnh đạo bộ phận duyệt nhân viên; Ban GĐ duyệt lãnh đạo bộ phận; đơn của Ban GĐ: Ban GĐ khác hoặc người phụ trách nhân sự ghi nhận.
      const approver = !self && (s.director || (own && s.leader && !ctx.targetLeader) || (ctx.targetDirector === true && s.hr));
      if (action === 'view') return self || s.hr || s.director || (own && s.leader);
      if (action === 'edit') {
        if (ctx.op === 'create') return self || s.hr;
        if (ctx.op === 'approve') return approver; // lãnh đạo bộ phận duyệt nhân viên; đơn của lãnh đạo bộ phận: Ban GĐ
        if (ctx.op === 'cancel') return self || s.hr;
        return false;
      }
      return false;
    }
    case 'hrm.attendance': {
      const self = ctx.targetUserId != null && ctx.targetUserId === s.userId;
      if (action === 'view') return self || s.hr || s.director || (own && s.leader);
      if (action === 'edit') {
        if (ctx.op === 'check' || ctx.op === 'explain') return self; // chấm công / giải trình: chính người đó (chỉ trên giao diện)
        if (ctx.op === 'approve') return !self && (s.hr || s.director || (own && s.leader && !ctx.targetLeader));
        if (ctx.op === 'hr') return !self && (s.hr || s.director); // nhập máy chấm công: người phụ trách nhân sự (của chính họ: Ban GĐ)
        return false;
      }
      if (action === 'export') return s.hr || s.director;
      return false;
    }
    case 'hrm.config':
      if (action === 'view') return true;
      if (action === 'edit') return ctx.field === 'roles' ? s.director : (s.director || s.hr);
      return false;
    default:
      return false;
  }
}

// Sửa hồ sơ / hợp đồng / CCCD: người phụ trách nhân sự, trừ hồ sơ của chính mình; hồ sơ của người phụ trách nhân sự: Ban GĐ.
function hrEdit(s, ctx, self) {
  if (self) return false;
  return !!s.hr || (!!s.director && ctx.targetHr === true);
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
  'crm.partner': 'Chỉ bộ phận phụ trách đối tác, người phụ trách hoặc Ban giám đốc sửa đối tác này',
  'crm.contact': 'Người liên hệ của đối tác chỉ bộ phận phụ trách, người phụ trách và Ban giám đốc xem / sửa',
  'crm.interaction': 'Nhật ký làm việc với đối tác chỉ bộ phận phụ trách, người phụ trách, người được giao theo dõi và Ban giám đốc xem',
  'crm.engagement': 'Hợp đồng / gói thầu chỉ lãnh đạo bộ phận phụ trách, người phụ trách và Ban giám đốc xem / sửa',
  'hrm.profile': 'Hồ sơ nhân sự chỉ chính người đó, người phụ trách nhân sự và Ban giám đốc xem đầy đủ',
  'hrm.identity': 'Số định danh chỉ chính người đó và người phụ trách nhân sự xem',
  'hrm.contract': 'Hợp đồng lao động chỉ chính người đó, người phụ trách nhân sự và Ban giám đốc xem; người phụ trách nhân sự sửa',
  'hrm.leave': 'Đơn nghỉ do chính người đó lập; lãnh đạo bộ phận duyệt nhân viên, Ban giám đốc duyệt đơn của lãnh đạo bộ phận',
  'hrm.attendance': 'Chấm công / giải trình do chính người đó làm; lãnh đạo bộ phận hoặc người phụ trách nhân sự duyệt giải trình',
  'hrm.config': 'Chỉ Ban giám đốc chỉ định người phụ trách nhân sự; Ban giám đốc / người phụ trách nhân sự sửa giờ làm, ngày lễ',
};
function assertCan(s, action, dataset, ctx, env) {
  if (!can(s, action, dataset, ctx, env)) throw new PolicyError(MESSAGES[dataset] || 'Bạn không có quyền với dữ liệu này');
}

module.exports = { DATASETS, ACTIONS, NEVER_AI, NEVER_EXTERNAL, NEVER_AI_FIELDS, can, assertCan, PolicyError };
