// QUY ĐỊNH PHÂN QUYỀN DỮ LIỆU KEPPER HUB — một nguồn duy nhất, thực thi bằng mã (policy-as-code).
// Ma trận: vai trò nghiệp vụ × tập dữ liệu × hành động. Route gọi can() / assertCan(); policy.test.js kiểm từng ô của ma trận.
// Vai trò nghiệp vụ SUY RA từ VAI của tài khoản (lib/permissions.js — một trục vai) + bộ phận, và các kiêm nhiệm do Ban TGĐ chỉ định
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
  'mtl.progress': { label: 'Bảo mật', pii: 'không', note: '% tiến độ của một hạng mục MTL' },
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
  // ---- Văn thư (QyĐ-GA-01) — quyền theo mức bảo mật của từng văn bản: services/vanthu.js canView ----
  // Sổ đến / đi: theo mức bảo mật. Sổ nội bộ (quy chế, quy định): theo CẤP XEM theo vai (Mọi người / Lãnh đạo / Ban TGĐ), dự thảo chỉ
  // người soạn, Người phê duyệt, Văn thư — docs/de-xuat-quy-che-phe-duyet.md.
  'vanthu.doc': { label: 'Sổ đến / đi: theo mức ghi trên văn bản (Công khai / Nội bộ / Hạn chế / Bảo mật cao); sổ nội bộ: theo cấp xem (Mọi người / Lãnh đạo / Ban TGĐ)', pii: 'có thể (nơi gửi, người ký, nội dung trích yếu)', note: 'Sổ văn bản đến / đi / nội bộ: số, trích yếu, người xử lý, hạn, trạng thái, người phê duyệt; tệp lưu trên NAS / kho tệp, mã băm SHA-256 lúc phê duyệt ghi nhật ký' },
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
// HRM ctx: { targetUserId, departmentId: bộ phận của người đó, targetLeader: lãnh đạo bộ phận / Ban TGĐ, targetDirector, targetHr: người phụ trách nhân sự, field, op }.
// Người phụ trách nhân sự KHÔNG tự sửa hồ sơ / hợp đồng / lương / CCCD / chấm công của chính mình — Ban TGĐ (hoặc người phụ trách nhân sự khác) làm.
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
      // Lập / gửi: thành viên đúng bộ phận (Ban TGĐ không lập). Nộp thay bộ phận khác: chỉ thư ký. Xem bộ phận khác: Ban TGĐ, thư ký, PMO.
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
      // Xem: Ban TGĐ, thư ký, PMO mọi bộ phận; lãnh đạo bộ phận — bộ phận mình; người tạo — của mình.
      // Ghi chú lý do chỉ người tạo, thư ký, Ban TGĐ thấy (ctx.field === 'note').
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
    case 'weekly.roles': // ai là thư ký, ai là PMO: chỉ Ban TGĐ quyết
      if (action === 'view') return full || s.leader;
      if (action === 'edit') return s.director;
      return false;
    case 'mtl.progress': {
      // % tiến độ: chỉ người chủ trì (quyền tối thiểu theo vai, services/task-access.js — 20/11/2026).
      const it = ctx.item || {};
      if (action === 'view') return true; // xem đã lọc bằng itemVisibleWhere
      if (action === 'edit') return (it.assigneeIds || []).includes(s.userId);
      if (action === 'export') return mtlExport(s, ctx);
      return false;
    }
    case 'mtl.plan': {
      const it = ctx.item || {};
      if (action === 'view') return true;
      if (action === 'edit') {
        // Kế hoạch của MỘT hạng mục (tên, găng, mốc, hạn, kế hoạch gốc): người giao, BTGĐ phụ trách của việc (it.boss, task-access).
        if (ctx.op === 'item') return !!it.boss;
        // Thao tác cả dự án (tạo bước MTL tổng, nhập Excel, chuyển ghi chú thành việc): người quản lý dự án.
        return !!it.projectManager;
      }
      if (action === 'export') return mtlExport(s, ctx);
      return false;
    }
    case 'kpi.person':
      // KPI & phân tích (số liệu theo người, mọi bộ phận): chỉ Ban Tổng Giám đốc; mỗi người xem KPI của chính mình (chủ dự án chốt).
      if (action === 'view') return s.director || ctx.self === true;
      return false;

    // ---------- CRM: đối tác thuộc MỘT bộ phận phụ trách (ownerDepartment) + người phụ trách (ownerUser) ----------
    case 'crm.partner': {
      const owner = s.director || own || (ctx.ownerUserId != null && ctx.ownerUserId === s.userId);
      if (action === 'view') return true; // danh bạ tổ chức đối tác: mọi cán bộ (trừ IT)
      if (action === 'edit') {
        if (ctx.op === 'create') return s.director || s.departmentId != null; // tạo cho bộ phận mình; Ban TGĐ chọn bộ phận
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
    case 'crm.engagement': // giá trị hợp đồng / gói thầu: lãnh đạo bộ phận phụ trách, người phụ trách, Ban TGĐ
      if (action === 'view' || action === 'edit') return s.director || (own && s.leader) || (ctx.ownerUserId != null && ctx.ownerUserId === s.userId);
      return false;

    // ---------- HRM: người phụ trách nhân sự (hr) do Ban TGĐ chỉ định trong thiết lập HRM ----------
    case 'hrm.profile': {
      const self = ctx.targetUserId != null && ctx.targetUserId === s.userId;
      if (action === 'view') {
        if (self || s.hr || s.director) return true;
        return own && s.leader && ctx.field !== 'private'; // lãnh đạo bộ phận: chỉ trường cơ bản người trong bộ phận
      }
      if (action === 'edit') return hrEdit(s, ctx, self) || (self && ctx.op === 'contact'); // tự sửa liên hệ cá nhân, người liên hệ khẩn cấp
      return false;
    }
    case 'hrm.identity': { // số CCCD: chỉ chính người đó và người phụ trách nhân sự (Ban TGĐ không cần — tối thiểu hoá)
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
      // Lãnh đạo bộ phận duyệt nhân viên; Ban TGĐ duyệt lãnh đạo bộ phận; đơn của Ban TGĐ: Ban TGĐ khác hoặc người phụ trách nhân sự ghi nhận.
      const approver = !self && (s.director || (own && s.leader && !ctx.targetLeader) || (ctx.targetDirector === true && s.hr));
      if (action === 'view') return self || s.hr || s.director || (own && s.leader);
      if (action === 'edit') {
        if (ctx.op === 'create') return self || s.hr;
        if (ctx.op === 'approve') return approver; // lãnh đạo bộ phận duyệt nhân viên; đơn của lãnh đạo bộ phận: Ban TGĐ
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
        if (ctx.op === 'hr') return !self && (s.hr || s.director); // nhập máy chấm công: người phụ trách nhân sự (của chính họ: Ban TGĐ)
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

// Sửa hồ sơ / hợp đồng / CCCD: người phụ trách nhân sự, trừ hồ sơ của chính mình; hồ sơ của người phụ trách nhân sự: Ban TGĐ.
function hrEdit(s, ctx, self) {
  if (self) return false;
  return !!s.hr || (!!s.director && ctx.targetHr === true);
}
// Xuất MTL ra tệp (Excel / Word): người quản lý dự án, Ban TGĐ; lãnh đạo bộ phận chỉ phần bộ phận mình (op 'dept').
function mtlExport(s, ctx) {
  const it = ctx.item || {};
  return !!it.projectManager || !!s.director || (ctx.op === 'dept' && (it.leadLeaderIds || []).includes(s.userId));
}

class PolicyError extends Error { constructor(message) { super(message); this.status = 403; this.code = 'FORBIDDEN'; } }
const MESSAGES = {
  'weekly.report': 'Chỉ thành viên bộ phận lập báo cáo của bộ phận mình; thư ký giao ban nhập thay bộ phận khác',
  'weekly.summary.detail': 'Chi tiết báo cáo các bộ phận chỉ Ban Tổng Giám đốc, thư ký giao ban, PMO xem',
  'weekly.notice': 'Chỉ báo cho bộ phận của mình; thư ký giao ban báo thay',
  'weekly.meeting': 'Chỉ TGĐ / Ban Tổng Giám đốc và thư ký giao ban ghi điểm danh, kết luận, Action Log',
  'weekly.compliance': 'Điểm tuân thủ chỉ thư ký giao ban và Ban Tổng Giám đốc xem',
  'weekly.roles': 'Chỉ Ban Tổng Giám đốc chọn bộ phận thư ký và PMO',
  'mtl.progress': 'Tiến độ hạng mục do người chủ trì cập nhật',
  'mtl.plan': 'Kế hoạch hạng mục MTL do người giao hoặc Ban Tổng Giám đốc sửa; tạo bước MTL tổng, nhập Excel do người quản lý dự án (PMO)',
  'crm.partner': 'Chỉ bộ phận phụ trách đối tác, người phụ trách hoặc Ban Tổng Giám đốc sửa đối tác này',
  'crm.contact': 'Người liên hệ của đối tác chỉ bộ phận phụ trách, người phụ trách và Ban Tổng Giám đốc xem / sửa',
  'crm.interaction': 'Nhật ký làm việc với đối tác chỉ bộ phận phụ trách, người phụ trách, người được giao theo dõi và Ban Tổng Giám đốc xem',
  'crm.engagement': 'Hợp đồng / gói thầu chỉ lãnh đạo bộ phận phụ trách, người phụ trách và Ban Tổng Giám đốc xem / sửa',
  'hrm.profile': 'Hồ sơ nhân sự chỉ chính người đó, người phụ trách nhân sự và Ban Tổng Giám đốc xem đầy đủ',
  'hrm.identity': 'Số định danh chỉ chính người đó và người phụ trách nhân sự xem',
  'hrm.contract': 'Hợp đồng lao động chỉ chính người đó, người phụ trách nhân sự và Ban Tổng Giám đốc xem; người phụ trách nhân sự sửa',
  'hrm.leave': 'Đơn nghỉ do chính người đó lập; lãnh đạo bộ phận duyệt nhân viên, Ban Tổng Giám đốc duyệt đơn của lãnh đạo bộ phận',
  'hrm.attendance': 'Chấm công / giải trình do chính người đó làm; lãnh đạo bộ phận hoặc người phụ trách nhân sự duyệt giải trình',
  'hrm.config': 'Chỉ Ban Tổng Giám đốc chỉ định người phụ trách nhân sự; Ban Tổng Giám đốc / người phụ trách nhân sự sửa giờ làm, ngày lễ',
};
function assertCan(s, action, dataset, ctx, env) {
  if (!can(s, action, dataset, ctx, env)) throw new PolicyError(MESSAGES[dataset] || 'Bạn không có quyền với dữ liệu này');
}

module.exports = { DATASETS, ACTIONS, NEVER_AI, NEVER_EXTERNAL, NEVER_AI_FIELDS, can, assertCan, PolicyError };
