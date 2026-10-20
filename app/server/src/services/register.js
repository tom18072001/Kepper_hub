// Sổ theo dõi, kiểm soát giao việc: trạng thái hạn tự tính (theo đúng quy tắc của mẫu sổ), danh mục dùng chung, tổng hợp theo cán bộ chủ trì.
const DAY = 86_400_000, H7 = 7 * 3_600_000;

const DEFAULT_SETTINGS = {
  dueSoonDays: 3,
  sources: ['Chỉ đạo của lãnh đạo', 'Kế hoạch năm', 'Văn bản cấp trên', 'Họp giao ban', 'Phát sinh'],
  // KPI theo công thức đã chốt (16/10/2026): đúng hạn + xếp loại + khối lượng, trọng số % (tổng 100).
  kpiWeights: { onTime: 40, rating: 40, volume: 20 },
};
const DEFAULT_TEMPLATES = [{
  name: 'Nhiệm vụ chuẩn – Cuộc thi/Hội thi',
  items: [
    { title: 'Lập Timeline tổng thể và phân công nhiệm vụ chi tiết', deliverable: 'Timeline tổng thể; bảng phân công nhiệm vụ' },
    { title: 'Khảo sát địa điểm tổ chức', deliverable: 'Báo cáo khảo sát; đề xuất địa điểm tổ chức' },
    { title: 'Xây dựng Ban Tổ chức, Ban Ra đề, Ban Chấm thi, Ban Coi thi', deliverable: 'Dự thảo Quyết định thành lập các Ban; danh sách thành viên' },
    { title: 'Công tác truyền thông', deliverable: 'Kế hoạch truyền thông; dự thảo thông cáo báo chí' },
    { title: 'Xây dựng dự toán kinh phí', deliverable: 'Dự toán kinh phí tổ chức' },
  ],
}];

// Số ngày lịch theo giờ Việt Nam (để "còn N ngày" giống công thức =Hạn-TODAY() của sổ).
const vnDayNumber = d => Math.floor((new Date(d).getTime() + H7) / DAY);

const STATUS = {
  OVERDUE: 'Quá hạn', DUE_SOON: 'Sắp đến hạn', IN_PROGRESS: 'Đang thực hiện', DONE_ON_TIME: 'Hoàn thành đúng hạn',
  DONE_LATE: 'Hoàn thành trễ hạn', DONE: 'Hoàn thành', CANCELLED: 'Huỷ', NO_DUE: 'Chưa có hạn',
};
// item: { dueDate, completedAt, state: { category } }
function deadlineStatus(item, now = new Date(), dueSoonDays = DEFAULT_SETTINGS.dueSoonDays) {
  const category = item.state?.category;
  if (category === 'CANCELLED') return { code: 'CANCELLED', label: STATUS.CANCELLED, daysLeft: null };
  const due = item.dueDate ? vnDayNumber(item.dueDate) : null;
  if (category === 'COMPLETED') {
    if (due == null || !item.completedAt) return { code: 'DONE', label: STATUS.DONE, daysLeft: null };
    const late = vnDayNumber(item.completedAt) > due;
    return { code: late ? 'DONE_LATE' : 'DONE_ON_TIME', label: late ? STATUS.DONE_LATE : STATUS.DONE_ON_TIME, daysLeft: null };
  }
  if (due == null) return { code: 'NO_DUE', label: STATUS.NO_DUE, daysLeft: null };
  const daysLeft = due - vnDayNumber(now);
  if (daysLeft < 0) return { code: 'OVERDUE', label: STATUS.OVERDUE, daysLeft };
  if (daysLeft <= dueSoonDays) return { code: 'DUE_SOON', label: STATUS.DUE_SOON, daysLeft };
  return { code: 'IN_PROGRESS', label: STATUS.IN_PROGRESS, daysLeft };
}

async function getSettings(client) {
  const rows = await client.appSetting.findMany();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  return out;
}
async function ensureDefaults(client) {
  for (const t of DEFAULT_TEMPLATES) {
    if (!(await client.taskTemplate.findUnique({ where: { name: t.name } }))) await client.taskTemplate.create({ data: t });
  }
}

// Tổng hợp theo cán bộ chủ trì — đúng các cột của sheet "Tổng hợp".
// items: việc kèm state.category, dueDate, completedAt, assignees[{userId}], supporters[{userId}].
function summarize(items, users, { now = new Date(), dueSoonDays = DEFAULT_SETTINGS.dueSoonDays } = {}) {
  const row = u => ({ userId: u.id, fullName: u.fullName, title: u.displayTitle || null, department: u.department?.name || null,
    total: 0, inProgress: 0, dueSoon: 0, overdue: 0, doneOnTime: 0, doneLate: 0, done: 0, noDue: 0, supporting: 0 });
  const byUser = new Map(users.map(u => [u.id, row(u)]));
  const total = row({ id: 0, fullName: 'TỔNG CỘNG' });
  const bump = (r, s) => {
    r.total++;
    if (s.code === 'IN_PROGRESS') r.inProgress++; else if (s.code === 'DUE_SOON') r.dueSoon++; else if (s.code === 'OVERDUE') r.overdue++;
    else if (s.code === 'DONE_ON_TIME') r.doneOnTime++; else if (s.code === 'DONE_LATE') r.doneLate++; else if (s.code === 'DONE') r.done++; else if (s.code === 'NO_DUE') r.noDue++;
  };
  for (const it of items) {
    const s = deadlineStatus(it, now, dueSoonDays);
    if (s.code === 'CANCELLED') continue;
    const leads = it.assignees.filter(a => byUser.has(a.userId));
    if (leads.length) bump(total, s); // TỔNG CỘNG: mỗi việc tính một lần nếu có người chủ trì trong phạm vi
    for (const a of leads) bump(byUser.get(a.userId), s);
    for (const a of it.supporters || []) if (byUser.has(a.userId)) byUser.get(a.userId).supporting++;
  }
  const rate = r => (r.doneOnTime + r.doneLate ? Math.round(r.doneOnTime / (r.doneOnTime + r.doneLate) * 100) : null);
  const rows = [...byUser.values()].map(r => ({ ...r, onTimeRate: rate(r) }));
  return { rows, total: { ...total, onTimeRate: rate(total) } };
}

// ---------- GĐ3b: tổng hợp theo phòng chủ trì, văn bản căn cứ trong sổ Excel, áp mẫu có hạn tương đối ----------
// Phòng của một việc khi thống kê: đơn vị chủ trì; chưa giao về phòng thì là phòng sở hữu dự án / sổ.
const itemDepartmentId = it => it.leadDepartmentId ?? it.project?.departmentId ?? null;
const countRow = (extra = {}) => ({ total: 0, inProgress: 0, dueSoon: 0, overdue: 0, doneOnTime: 0, doneLate: 0, done: 0, noDue: 0, ...extra });
const STATUS_KEY = { IN_PROGRESS: 'inProgress', DUE_SOON: 'dueSoon', OVERDUE: 'overdue', DONE_ON_TIME: 'doneOnTime', DONE_LATE: 'doneLate', DONE: 'done', NO_DUE: 'noDue' };
const bumpStatus = (r, s) => { r.total++; if (STATUS_KEY[s.code]) r[STATUS_KEY[s.code]]++; };
const onTimeRate = r => (r.doneOnTime + r.doneLate ? Math.round(r.doneOnTime / (r.doneOnTime + r.doneLate) * 100) : null);
const share = t => ({ ...t, rate: t.total ? Math.round(t.done / t.total * 100) : null });

// Tổng hợp theo phòng chủ trì: mỗi việc tính một lần cho phòng của việc (kể cả việc nhánh, không tính việc huỷ).
// items: { dueDate, completedAt, state: { category }, dispatchStatus, taskType, leadDepartmentId, project: { departmentId } }
// departments: [{ id, name }] — các phòng trong phạm vi; việc của phòng ngoài danh sách bị bỏ qua.
function summarizeDepartments(items, departments, { now = new Date(), dueSoonDays = DEFAULT_SETTINGS.dueSoonDays } = {}) {
  const blank = (id, name) => countRow({ departmentId: id, name, pendingAccept: 0, plan: { done: 0, total: 0 }, adhoc: { done: 0, total: 0 } });
  const byDept = new Map(departments.map(d => [d.id, blank(d.id, d.name)]));
  const total = blank(0, 'Cộng');
  for (const it of items) {
    const s = deadlineStatus(it, now, dueSoonDays);
    if (s.code === 'CANCELLED') continue;
    const row = byDept.get(itemDepartmentId(it));
    if (!row) continue;
    const doneItem = it.state?.category === 'COMPLETED';
    for (const r of [row, total]) {
      bumpStatus(r, s);
      if (it.dispatchStatus === 'PENDING' && !doneItem) r.pendingAccept++;
      const t = it.taskType === 'PLAN' ? r.plan : r.adhoc;
      t.total++; if (doneItem) t.done++;
    }
  }
  const out = r => ({ ...r, onTimeRate: onTimeRate(r), plan: share(r.plan), adhoc: share(r.adhoc) });
  return { rows: [...byDept.values()].map(out), total: out(total) };
}

// Dòng cộng theo phòng cho bảng cán bộ chủ trì: mỗi việc tính một lần cho mỗi phòng có người chủ trì trong phạm vi
// (hai cán bộ cùng phòng cùng chủ trì một việc → phòng đếm 1); "phối hợp" = số việc có cán bộ của phòng phối hợp.
// users: [{ id, departmentId, department: { name } }]
function subtotalsByDepartment(items, users, { now = new Date(), dueSoonDays = DEFAULT_SETTINGS.dueSoonDays } = {}) {
  const deptOf = new Map(users.map(u => [u.id, u.departmentId ?? null]));
  const rows = new Map();
  for (const u of users) if (!rows.has(u.departmentId ?? null)) rows.set(u.departmentId ?? null, countRow({ departmentId: u.departmentId ?? null, name: u.department?.name || 'Chưa có phòng ban', supporting: 0 }));
  for (const it of items) {
    const s = deadlineStatus(it, now, dueSoonDays);
    if (s.code === 'CANCELLED') continue;
    const depts = ids => new Set(ids.filter(id => deptOf.has(id)).map(id => deptOf.get(id)));
    for (const d of depts(it.assignees.map(a => a.userId))) bumpStatus(rows.get(d), s);
    for (const d of depts((it.supporters || []).map(a => a.userId))) rows.get(d).supporting++;
  }
  return [...rows.values()].map(r => ({ ...r, onTimeRate: onTimeRate(r) }));
}

// ---- Văn bản căn cứ trong sổ Excel: "123/QĐ-TT ngày 15/03/2027; 45/KH-TT" ----
const vnDateOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d) - H7);
const fmtVnDay = d => new Date(new Date(d).getTime() + H7).toISOString().slice(0, 10).split('-').reverse().join('/');
function formatDocumentRefs(docs) {
  return (docs || []).map(d => (d.issuedOn ? `${d.number} ngày ${fmtVnDay(d.issuedOn)}` : d.number)).join('; ');
}
const DOC_DATE = /(^|[\s,])(?:ngày\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})(?=$|[\s,.:;–-])/i;
// → { docs: [{ number, issuedOn, summary }], errors: [] }. Trích yếu (nếu có) ghi sau ngày, hoặc sau "về việc"/"v/v".
function parseDocumentRefs(value, { defaultSummary = 'Văn bản căn cứ', max = 50 } = {}) {
  const docs = [], errors = [];
  for (const raw of String(value ?? '').split(/[;\n]+/)) {
    const part = raw.replace(/\s+/g, ' ').trim();
    if (!part) continue;
    let number = part, issuedOn = null, summary = '';
    const m = part.match(DOC_DATE);
    if (m) {
      number = part.slice(0, m.index).replace(/[\s,]*(?:ngày)?\s*$/i, '').trim();
      summary = part.slice(m.index + m[0].length).replace(/^[\s,.:;–-]+/, '').trim();
      const [y, mo, d] = [Number(m[4]), Number(m[3]), Number(m[2])];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate()) issuedOn = vnDateOf(y, mo, d);
      else errors.push(`ngày văn bản "${m[2]}/${m[3]}/${m[4]}" không hợp lệ`);
    } else {
      const v = part.match(/\s+(v\/v|về việc|về)\s+/i);
      if (v) { number = part.slice(0, v.index).trim(); summary = part.slice(v.index).trim(); }
    }
    if (!number) { errors.push(`thiếu số, ký hiệu văn bản ở "${part.slice(0, 60)}"`); continue; }
    if (number.length > 80) { errors.push(`số, ký hiệu "${number.slice(0, 30)}…" dài quá 80 ký tự — đã cắt`); number = number.slice(0, 80); }
    docs.push({ number, issuedOn, summary: (summary || defaultSummary).slice(0, 500) });
    if (docs.length >= max) break;
  }
  return { docs, errors };
}

// ---- Áp mẫu nhóm việc: hạn tương đối theo ngày mốc, chọn người / hạn / bỏ từng việc ----
// tplItems: [{ title, deliverable, offsetDays? }]; rows: [{ index, title?, assigneeIds?, dueDate?, skip? }] (dueDate: Date|null).
// Hạn = rows[i].dueDate ?? (anchorDate + offsetDays) ?? hạn việc cha; không muộn hơn hạn việc cha (cắt về hạn cha, ghi clampedFrom).
function planTemplateItems(tplItems, { rows = [], anchorDate = null, parentDue = null, parentAssigneeIds = [], prefix = null } = {}) {
  const byIndex = new Map(rows.map(r => [r.index, r]));
  const out = [];
  let skipped = 0;
  tplItems.forEach((t, index) => {
    const r = byIndex.get(index) || {};
    if (r.skip) { skipped++; return; }
    let dueDate = r.dueDate ?? null, basis = dueDate ? 'ROW' : null;
    if (!dueDate && anchorDate && Number.isInteger(t.offsetDays)) { dueDate = new Date(new Date(anchorDate).getTime() + t.offsetDays * DAY); basis = 'ANCHOR'; }
    if (!dueDate && parentDue) { dueDate = new Date(parentDue); basis = 'PARENT'; }
    let clampedFrom = null;
    if (dueDate && parentDue && vnDayNumber(dueDate) > vnDayNumber(parentDue)) { clampedFrom = dueDate; dueDate = new Date(parentDue); }
    const title = (r.title && String(r.title).trim()) || t.title;
    out.push({ index, title, deliverable: t.deliverable || '', assigneeIds: r.assigneeIds ?? parentAssigneeIds, dueDate, basis, clampedFrom });
  });
  // Gắn "KÝ HIỆU.n – " theo thứ tự sau khi bỏ dòng; tên đã mang sẵn ký hiệu (sửa từ bản xem trước) thì bỏ ký hiệu cũ trước.
  const esc = String(prefix || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  out.forEach((x, k) => { if (prefix) x.title = `${prefix}.${k + 1} – ${x.title.replace(new RegExp(`^${esc}\\.\\d+\\s*[–-]\\s*`), '')}`; });
  return { items: out, skipped };
}

module.exports = { DEFAULT_SETTINGS, DEFAULT_TEMPLATES, STATUS, deadlineStatus, getSettings, ensureDefaults, summarize, vnDayNumber,
  itemDepartmentId, summarizeDepartments, subtotalsByDepartment, formatDocumentRefs, parseDocumentRefs, planTemplateItems, fmtVnDay };
