// Playground CRM — quản lý đối tác B2B của dự án bất động sản: nhà thầu, tư vấn, cơ quan quản lý, ngân hàng, nhà cung cấp.
// Bật bằng MODULES=crm. Quyền: lib/policy.js (crm.*). Mỗi đối tác thuộc MỘT bộ phận phụ trách + người phụ trách;
// danh bạ tổ chức (tên, loại, MST, địa chỉ, tổng đài) mọi cán bộ xem; người liên hệ, nhật ký làm việc, hợp đồng chỉ bộ phận phụ trách.
// Claude (token): xem theo đúng quyền người dùng; chỉ GHI được nhật ký làm việc và đánh dấu xong việc theo dõi (lib/tokens.js).
const { fail, intParam, optionalInt, optionalDate, text, oneOf } = require('../lib/http');
const P = require('../lib/policy');
const WD = require('../services/weekly-data');
const WK = require('../services/weekly');
const { notify } = require('../services/events');
const { loadItem, loadProject } = require('../services/access');

const KINDS = { CONTRACTOR: 'Nhà thầu', CONSULTANT: 'Tư vấn', AUTHORITY: 'Cơ quan quản lý', BANK: 'Ngân hàng / tổ chức tín dụng', SUPPLIER: 'Nhà cung cấp', OTHER: 'Khác' };
const STATUSES = { PROSPECT: 'Đang tìm hiểu', ACTIVE: 'Đang hợp tác', PAUSED: 'Tạm dừng' };
const ITYPES = { MEETING: 'Họp', CALL: 'Gọi điện', EMAIL: 'Email', LETTER: 'Công văn', SITE_VISIT: 'Khảo sát hiện trường', OTHER: 'Khác' };
const EKINDS = { CONTRACT: 'Hợp đồng', BID: 'Gói thầu', MOU: 'Thoả thuận / MOU', PERMIT: 'Hồ sơ / giấy phép' };
const ESTATUS = { DRAFT: 'Đang chuẩn bị', ACTIVE: 'Đang thực hiện', DONE: 'Hoàn thành', CANCELLED: 'Huỷ' };
const ACTIVE_USER = { isActive: true, isRootAdmin: false, role: { not: 'admin' } };

const ctxOf = (p, me = null, extra = {}) => ({ departmentId: p.ownerDepartmentId, ownerUserId: p.ownerUserId, ...extra, participant: extra.participant === true });
const email = (v, label) => { const s = text(v, label, { max: 120 }); if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) fail(422, label + ' không hợp lệ', 'INVALID_VALUE'); return s; };
const phone = (v, label) => { const s = text(v, label, { max: 30 }); if (s && !/^[0-9+().\s-]{6,30}$/.test(s)) fail(422, label + ' không hợp lệ', 'INVALID_VALUE'); return s; };
const taxCode = v => { const s = text(v, 'Mã số thuế', { max: 20 }); if (s && !/^\d{10}(-\d{3})?$/.test(s)) fail(422, 'Mã số thuế gồm 10 số (chi nhánh: 10 số-3 số)', 'INVALID_VALUE'); return s; };
const money = v => { if (v === undefined) return undefined; if (v === null || v === '') return null; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1e15) fail(422, 'Giá trị không hợp lệ', 'INVALID_VALUE'); return n; };
const outEnum = (map, v) => ({ code: v, label: map[v] || v });

module.exports = function mountCrm(app, { prisma, auth, audit, config }) {
  if (!(config.modules || []).includes('crm')) return;
  const subject = req => WD.rolesOf(prisma, req.user);
  const userOk = async (id, label) => {
    if (id == null) return null;
    const u = await prisma.user.findFirst({ where: { id, ...ACTIVE_USER }, select: { id: true, fullName: true, departmentId: true } });
    if (!u) fail(422, label + ' không hợp lệ', 'INVALID_USER');
    return u;
  };
  // Người phụ trách đối tác: phải thuộc bộ phận phụ trách (Ban GĐ chọn tự do). Người phụ trách được xem người liên hệ, nhật ký, giá trị hợp đồng
  // → đổi / chỉ định người khác chỉ lãnh đạo bộ phận phụ trách hoặc Ban GĐ (op 'transfer'), không tự gán mình để mở quyền.
  const ownerOk = async (s, id, departmentId) => {
    const u = await userOk(id, 'Người phụ trách');
    if (u && !s.director && u.departmentId !== departmentId) fail(422, 'Người phụ trách phải thuộc bộ phận phụ trách đối tác', 'INVALID_USER');
    return u;
  };
  const loadPartner = async id => {
    const p = await prisma.crmPartner.findUnique({ where: { id: intParam(id) } });
    if (!p) fail(404, 'Không tìm thấy đối tác', 'NOT_FOUND');
    return p;
  };
  const names = async ids => WD.userNames(prisma, ids);
  const deptNames = async () => Object.fromEntries((await prisma.department.findMany({ select: { id: true, name: true } })).map(d => [d.id, d.name]));

  function partnerOut(p, s, { users = {}, depts = {}, open = null } = {}) {
    const c = ctxOf(p);
    const detail = P.can(s, 'view', 'crm.contact', c);
    return {
      id: p.id, name: p.name, kind: outEnum(KINDS, p.kind), taxCode: p.taxCode, address: p.address, website: p.website, phone: p.phone, email: p.email,
      status: outEnum(STATUSES, p.status), archivedAt: p.archivedAt, createdAt: p.createdAt, updatedAt: p.updatedAt,
      rating: detail ? p.rating : undefined, // đánh giá nội bộ về đối tác: như nhận xét, chỉ bộ phận phụ trách
      ownerDepartment: { id: p.ownerDepartmentId, name: depts[p.ownerDepartmentId] || null },
      ownerUser: p.ownerUserId ? { id: p.ownerUserId, fullName: users[p.ownerUserId] || null } : null,
      note: detail ? p.note : undefined, // nhận xét nội bộ về đối tác: chỉ bộ phận phụ trách
      openFollowups: detail ? open : undefined,
      can: { edit: P.can(s, 'edit', 'crm.partner', c), detail, engagement: P.can(s, 'view', 'crm.engagement', c), archive: P.can(s, 'edit', 'crm.partner', { ...c, op: 'archive' }) },
    };
  }

  app.get('/api/crm/meta', auth, async (req, res) => {
    const s = await subject(req);
    if (s.it) fail(403, 'Quản trị hệ thống không xem dữ liệu nghiệp vụ', 'FORBIDDEN');
    res.json({ kinds: KINDS, statuses: STATUSES, interactionTypes: ITYPES, engagementKinds: EKINDS, engagementStatuses: ESTATUS,
      me: { director: s.director, leader: s.leader, departmentId: s.departmentId }, canCreate: P.can(s, 'edit', 'crm.partner', { op: 'create' }) });
  });

  // Danh sách đối tác (danh bạ tổ chức) — lọc theo tên / MST, loại, trạng thái, bộ phận phụ trách, "của bộ phận tôi".
  app.get('/api/crm/partners', auth, async (req, res) => {
    const s = await subject(req);
    if (!P.can(s, 'view', 'crm.partner')) fail(403, 'Quản trị hệ thống không xem dữ liệu nghiệp vụ', 'FORBIDDEN');
    const q = String(req.query.q || '').trim().slice(0, 80);
    const where = {
      ...(req.query.archived === '1' ? {} : { archivedAt: null }),
      ...(KINDS[req.query.kind] ? { kind: req.query.kind } : {}),
      ...(STATUSES[req.query.status] ? { status: req.query.status } : {}),
      ...(req.query.mine === '1' ? { OR: [{ ownerDepartmentId: s.departmentId ?? -1 }, { ownerUserId: s.userId }] } : {}),
      ...(req.query.departmentId ? { ownerDepartmentId: optionalInt(req.query.departmentId, 'Bộ phận') } : {}),
      ...(q ? { AND: [{ OR: [{ name: { contains: q, mode: 'insensitive' } }, { taxCode: { contains: q } }] }] } : {}),
    };
    const rows = await prisma.crmPartner.findMany({ where, orderBy: [{ name: 'asc' }], take: 500 });
    const ids = rows.map(r => r.id);
    const open = ids.length ? await prisma.crmInteraction.groupBy({ by: ['partnerId'], where: { partnerId: { in: ids }, nextDue: { not: null }, followUpDone: false }, _count: { _all: true } }) : [];
    const openMap = Object.fromEntries(open.map(o => [o.partnerId, o._count._all]));
    const [users, depts] = await Promise.all([names(rows.map(r => r.ownerUserId)), deptNames()]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(rows.map(p => partnerOut(p, s, { users, depts, open: openMap[p.id] || 0 })));
  });

  app.post('/api/crm/partners', auth, async (req, res) => {
    const s = await subject(req);
    if (!P.can(s, 'edit', 'crm.partner', { op: 'create' })) fail(403, 'Tài khoản chưa thuộc bộ phận nào — không tạo được đối tác', 'FORBIDDEN');
    const b = req.body || {};
    // Bộ phận phụ trách: bộ phận của người tạo; Ban GĐ chọn bộ phận.
    let ownerDepartmentId = s.departmentId;
    if (s.director && b.ownerDepartmentId != null) ownerDepartmentId = intParam(b.ownerDepartmentId, 'Bộ phận phụ trách');
    if (ownerDepartmentId == null) fail(422, 'Chọn bộ phận phụ trách', 'REQUIRED');
    if (!(await prisma.department.findFirst({ where: { id: ownerDepartmentId, isActive: true } }))) fail(422, 'Bộ phận phụ trách không hợp lệ', 'INVALID_VALUE');
    const wanted = optionalInt(b.ownerUserId, 'Người phụ trách') ?? s.userId;
    if (wanted !== s.userId) P.assertCan(s, 'edit', 'crm.partner', { departmentId: ownerDepartmentId, op: 'transfer' });
    const owner = await ownerOk(s, wanted, ownerDepartmentId);
    const data = {
      name: text(b.name, 'Tên đối tác', { required: true, max: 200 }), kind: oneOf(b.kind, Object.keys(KINDS), 'Loại đối tác') || 'OTHER',
      taxCode: taxCode(b.taxCode) || null, address: text(b.address, 'Địa chỉ', { max: 300 }) || null, website: text(b.website, 'Website', { max: 200 }) || null,
      phone: phone(b.phone, 'Điện thoại') || null, email: email(b.email, 'Email') || null, status: oneOf(b.status, Object.keys(STATUSES), 'Trạng thái') || 'ACTIVE',
      rating: b.rating == null || b.rating === '' ? null : Math.max(1, Math.min(5, Math.round(Number(b.rating)) || 1)), note: text(b.note, 'Ghi chú', { max: 2000 }) || '',
      ownerDepartmentId, ownerUserId: owner?.id ?? null, createdById: req.user.id,
    };
    if (data.taxCode) {
      const dup = await prisma.crmPartner.findFirst({ where: { taxCode: data.taxCode }, orderBy: { archivedAt: { sort: 'asc', nulls: 'first' } }, select: { id: true, name: true, archivedAt: true } });
      if (dup && !dup.archivedAt) fail(409, `Mã số thuế đã có: "${dup.name}" — mở đối tác đó thay vì tạo trùng`, 'DUPLICATE');
      if (dup) fail(409, `Mã số thuế thuộc đối tác đã ngừng theo dõi "${dup.name}" (#${dup.id}) — mở đối tác đó và bấm "Theo dõi lại"`, 'DUPLICATE_ARCHIVED');
    }
    const row = await prisma.crmPartner.create({ data });
    await audit(req, 'CRM_PARTNER_CREATE', 'CrmPartner', row.id, null, { name: row.name, kind: row.kind, ownerDepartmentId });
    res.status(201).json(partnerOut(row, s, { users: await names([row.ownerUserId]), depts: await deptNames(), open: 0 }));
  });

  // Chi tiết: thông tin chung (mọi cán bộ); người liên hệ, nhật ký, hợp đồng theo quyền.
  app.get('/api/crm/partners/:id', auth, async (req, res) => {
    const s = await subject(req);
    if (!P.can(s, 'view', 'crm.partner')) fail(403, 'Quản trị hệ thống không xem dữ liệu nghiệp vụ', 'FORBIDDEN');
    const p = await loadPartner(req.params.id);
    const c = ctxOf(p);
    const canContacts = P.can(s, 'view', 'crm.contact', c), canAll = P.can(s, 'view', 'crm.interaction', c), canEng = P.can(s, 'view', 'crm.engagement', c);
    const [contacts, interactions, engagements] = await Promise.all([
      canContacts ? prisma.crmContact.findMany({ where: { partnerId: p.id }, orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }] }) : [],
      prisma.crmInteraction.findMany({ where: { partnerId: p.id, ...(canAll ? {} : { OR: [{ createdById: s.userId }, { nextOwnerId: s.userId }] }) }, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 200 }),
      canEng ? prisma.crmEngagement.findMany({ where: { partnerId: p.id }, orderBy: [{ status: 'asc' }, { id: 'desc' }] }) : [],
    ]);
    const users = await names([p.ownerUserId, ...interactions.flatMap(i => [i.createdById, i.nextOwnerId])]);
    const open = interactions.filter(i => i.nextDue && !i.followUpDone).length;
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      ...partnerOut(p, s, { users, depts: await deptNames(), open }),
      contacts: canContacts ? contacts.map(x => ({ id: x.id, fullName: x.fullName, title: x.title, phone: x.phone, email: x.email, isPrimary: x.isPrimary, note: x.note })) : null,
      interactions: interactions.map(i => ({ id: i.id, type: outEnum(ITYPES, i.type), date: i.date, summary: i.summary, nextStep: i.nextStep, nextDue: i.nextDue, followUpDone: i.followUpDone,
        nextOwner: i.nextOwnerId ? { id: i.nextOwnerId, fullName: users[i.nextOwnerId] || null } : null, createdBy: { id: i.createdById, fullName: users[i.createdById] || null }, workItemId: i.workItemId,
        canDone: !!i.nextDue && !i.followUpDone && P.can(s, 'edit', 'crm.interaction', { ...c, op: 'followup', participant: i.nextOwnerId === s.userId || i.createdById === s.userId }) })),
      interactionsLimited: !canAll,
      engagements: canEng ? engagements.map(e => ({ id: e.id, kind: outEnum(EKINDS, e.kind), code: e.code, title: e.title, value: e.value, signedAt: e.signedAt, startAt: e.startAt, endAt: e.endAt,
        status: outEnum(ESTATUS, e.status), projectId: e.projectId, workItemId: e.workItemId, note: e.note })) : null,
    });
  });

  app.patch('/api/crm/partners/:id', auth, async (req, res) => {
    const s = await subject(req);
    const p = await loadPartner(req.params.id);
    const c = ctxOf(p), b = req.body || {};
    P.assertCan(s, 'edit', 'crm.partner', c);
    const data = {};
    if (b.name !== undefined) data.name = text(b.name, 'Tên đối tác', { required: true, max: 200 });
    if (b.kind !== undefined) data.kind = oneOf(b.kind, Object.keys(KINDS), 'Loại đối tác');
    if (b.taxCode !== undefined) data.taxCode = taxCode(b.taxCode) || null;
    if (b.address !== undefined) data.address = text(b.address, 'Địa chỉ', { max: 300 }) || null;
    if (b.website !== undefined) data.website = text(b.website, 'Website', { max: 200 }) || null;
    if (b.phone !== undefined) data.phone = phone(b.phone, 'Điện thoại') || null;
    if (b.email !== undefined) data.email = email(b.email, 'Email') || null;
    if (b.status !== undefined) data.status = oneOf(b.status, Object.keys(STATUSES), 'Trạng thái');
    if (b.rating !== undefined) data.rating = b.rating == null || b.rating === '' ? null : Math.max(1, Math.min(5, Math.round(Number(b.rating)) || 1));
    if (b.note !== undefined) data.note = text(b.note, 'Ghi chú', { max: 2000 }) || '';
    if (b.ownerDepartmentId !== undefined && Number(b.ownerDepartmentId) !== p.ownerDepartmentId) {
      P.assertCan(s, 'edit', 'crm.partner', { ...c, op: 'transfer' });
      const d = intParam(b.ownerDepartmentId, 'Bộ phận phụ trách');
      if (!(await prisma.department.findFirst({ where: { id: d, isActive: true } }))) fail(422, 'Bộ phận phụ trách không hợp lệ', 'INVALID_VALUE');
      data.ownerDepartmentId = d;
    }
    const newOwner = b.ownerUserId === undefined ? undefined : optionalInt(b.ownerUserId, 'Người phụ trách');
    if (newOwner !== undefined && newOwner !== p.ownerUserId) {
      P.assertCan(s, 'edit', 'crm.partner', { ...c, op: 'transfer' });
      data.ownerUserId = (await ownerOk(s, newOwner, data.ownerDepartmentId ?? p.ownerDepartmentId))?.id ?? null;
    } else if (data.ownerDepartmentId && p.ownerUserId && !s.director) {
      // Chuyển bộ phận: người phụ trách cũ không thuộc bộ phận mới → bỏ (lãnh đạo bộ phận mới chỉ định lại).
      const cur = await prisma.user.findUnique({ where: { id: p.ownerUserId }, select: { departmentId: true } });
      if (cur?.departmentId !== data.ownerDepartmentId) data.ownerUserId = null;
    }
    if (b.archived !== undefined) {
      P.assertCan(s, 'edit', 'crm.partner', { ...c, op: 'archive' });
      data.archivedAt = b.archived ? (p.archivedAt || new Date()) : null;
    }
    // Trùng MST với đối tác đang theo dõi: kiểm cả khi đổi MST và khi "Theo dõi lại".
    const taxNow = data.taxCode !== undefined ? data.taxCode : p.taxCode, activeAfter = data.archivedAt !== undefined ? !data.archivedAt : !p.archivedAt;
    if (taxNow && activeAfter && (data.taxCode !== undefined || (b.archived !== undefined && !b.archived))) {
      const dup = await prisma.crmPartner.findFirst({ where: { taxCode: taxNow, archivedAt: null, id: { not: p.id } }, select: { name: true } });
      if (dup) fail(409, `Mã số thuế đã có ở đối tác đang theo dõi "${dup.name}"`, 'DUPLICATE');
    }
    const row = await prisma.crmPartner.update({ where: { id: p.id }, data });
    await audit(req, 'CRM_PARTNER_UPDATE', 'CrmPartner', p.id, null, { fields: Object.keys(data) });
    res.json(partnerOut(row, s, { users: await names([row.ownerUserId]), depts: await deptNames() }));
  });

  // ---------- Người liên hệ (DLCN cơ bản của nhân sự đối tác) ----------
  const contactData = (b, partial) => {
    const d = {};
    if (!partial || b.fullName !== undefined) d.fullName = text(b.fullName, 'Họ tên', { required: true, max: 120 });
    if (b.title !== undefined) d.title = text(b.title, 'Chức danh', { max: 120 }) || null;
    if (b.phone !== undefined) d.phone = phone(b.phone, 'Điện thoại') || null;
    if (b.email !== undefined) d.email = email(b.email, 'Email') || null;
    if (b.isPrimary !== undefined) d.isPrimary = !!b.isPrimary;
    if (b.note !== undefined) d.note = text(b.note, 'Ghi chú', { max: 500 }) || '';
    return d;
  };
  app.post('/api/crm/partners/:id/contacts', auth, async (req, res) => {
    const s = await subject(req);
    const p = await loadPartner(req.params.id);
    P.assertCan(s, 'edit', 'crm.contact', ctxOf(p));
    if (p.archivedAt) fail(409, 'Đối tác đã ngừng theo dõi', 'ARCHIVED');
    if ((await prisma.crmContact.count({ where: { partnerId: p.id } })) >= 50) fail(409, 'Mỗi đối tác tối đa 50 người liên hệ', 'TOO_MANY');
    const row = await prisma.crmContact.create({ data: { partnerId: p.id, ...contactData(req.body || {}, false) } });
    await audit(req, 'CRM_CONTACT_CREATE', 'CrmContact', row.id, null, { partnerId: p.id });
    res.status(201).json({ id: row.id });
  });
  const loadContact = async (req, s) => {
    const x = await prisma.crmContact.findUnique({ where: { id: intParam(req.params.id) }, include: { partner: true } });
    if (!x) fail(404, 'Không tìm thấy người liên hệ', 'NOT_FOUND');
    P.assertCan(s, 'edit', 'crm.contact', ctxOf(x.partner));
    return x;
  };
  app.patch('/api/crm/contacts/:id', auth, async (req, res) => {
    const s = await subject(req);
    const x = await loadContact(req, s);
    const data = contactData(req.body || {}, true);
    await prisma.crmContact.update({ where: { id: x.id }, data });
    await audit(req, 'CRM_CONTACT_UPDATE', 'CrmContact', x.id, null, { partnerId: x.partnerId, fields: Object.keys(data) });
    res.json({ ok: true });
  });
  app.delete('/api/crm/contacts/:id', auth, async (req, res) => {
    const s = await subject(req);
    const x = await loadContact(req, s);
    await prisma.crmContact.delete({ where: { id: x.id } }); // người liên hệ rời đối tác: xoá hẳn (không giữ DLCN không còn mục đích)
    await audit(req, 'CRM_CONTACT_DELETE', 'CrmContact', x.id, null, { partnerId: x.partnerId });
    res.status(204).end();
  });

  // ---------- Nhật ký làm việc + việc cần theo dõi ----------
  // Ghi nhật ký (Claude ghi được qua token). Nhật ký là lịch sử: không sửa / xoá.
  app.post('/api/crm/partners/:id/interactions', auth, async (req, res) => {
    const s = await subject(req);
    const p = await loadPartner(req.params.id);
    if (p.archivedAt) fail(409, 'Đối tác đã ngừng theo dõi', 'ARCHIVED');
    P.assertCan(s, 'edit', 'crm.interaction', ctxOf(p));
    const b = req.body || {};
    const date = optionalDate(b.date, 'Ngày') || new Date();
    if (date.getTime() > Date.now() + 86_400_000) fail(422, 'Ngày làm việc không được ở tương lai', 'INVALID_DATE');
    if (date.getTime() < Date.now() - 2 * 365 * 86_400_000) fail(422, 'Chỉ ghi nhật ký trong 2 năm gần đây', 'INVALID_DATE');
    const nextDue = optionalDate(b.nextDue, 'Hạn theo dõi') || null;
    if (nextDue && (nextDue.getTime() < Date.now() - 86_400_000 || nextDue.getTime() > Date.now() + 2 * 365 * 86_400_000)) fail(422, 'Hạn theo dõi từ hôm nay tới 2 năm tới', 'INVALID_DATE');
    const nextOwner = nextDue ? await userOk(optionalInt(b.nextOwnerId, 'Người theo dõi') ?? s.userId, 'Người theo dõi') : null;
    let workItemId = optionalInt(b.workItemId, 'Việc liên quan');
    if (workItemId) await loadItem(prisma, req.user, workItemId, 'view').catch(() => fail(422, 'Việc liên quan không tồn tại hoặc bạn không xem được', 'INVALID_VALUE'));
    const row = await prisma.crmInteraction.create({ data: {
      partnerId: p.id, type: oneOf(b.type, Object.keys(ITYPES), 'Hình thức') || 'OTHER', date, summary: text(b.summary, 'Nội dung', { required: true, max: 4000 }),
      nextStep: text(b.nextStep, 'Việc tiếp theo', { max: 1000 }) || null, nextDue, nextOwnerId: nextOwner?.id ?? null, workItemId: workItemId || null, createdById: req.user.id,
    } });
    await audit(req, 'CRM_INTERACTION_CREATE', 'CrmInteraction', row.id, null, { partnerId: p.id, type: row.type, nextDue: row.nextDue });
    if (nextOwner && nextOwner.id !== req.user.id) await notify(prisma, [nextOwner.id], { type: 'CRM_FOLLOWUP', title: `Bạn được giao theo dõi ${p.name} (hạn ${WK.fmtD(WK.dayOf(nextDue))})`, body: (row.nextStep || '').slice(0, 200) || null, link: `#/crm/${p.id}` });
    res.status(201).json({ id: row.id, nextDue: row.nextDue });
  });

  // Việc cần theo dõi: của tôi (được giao), hoặc của bộ phận tôi (lãnh đạo / Ban GĐ: mọi bộ phận).
  app.get('/api/crm/followups', auth, async (req, res) => {
    const s = await subject(req);
    if (s.it) fail(403, 'Quản trị hệ thống không xem dữ liệu nghiệp vụ', 'FORBIDDEN');
    const scope = req.query.scope === 'dept' ? 'dept' : 'mine';
    const where = { nextDue: { not: null }, followUpDone: false, partner: { archivedAt: null } };
    if (scope === 'mine') where.nextOwnerId = s.userId;
    else if (!s.director) where.partner = { archivedAt: null, OR: [{ ownerDepartmentId: s.departmentId ?? -1 }, { ownerUserId: s.userId }] };
    const rows = await prisma.crmInteraction.findMany({ where, include: { partner: true }, orderBy: [{ nextDue: 'asc' }], take: 300 });
    const visible = rows.filter(i => P.can(s, 'view', 'crm.interaction', ctxOf(i.partner, null, { participant: i.nextOwnerId === s.userId || i.createdById === s.userId })));
    const users = await names(visible.flatMap(i => [i.nextOwnerId, i.createdById]));
    const today = WK.dayOf(new Date());
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(visible.map(i => ({ id: i.id, partner: { id: i.partner.id, name: i.partner.name }, nextStep: i.nextStep, summary: i.summary.slice(0, 300), nextDue: i.nextDue,
      overdue: WK.dayOf(i.nextDue) < today, nextOwner: i.nextOwnerId ? { id: i.nextOwnerId, fullName: users[i.nextOwnerId] || null } : null, createdBy: users[i.createdById] || null })));
  });
  app.post('/api/crm/followups/:id/done', auth, async (req, res) => {
    const s = await subject(req);
    const i = await prisma.crmInteraction.findUnique({ where: { id: intParam(req.params.id) }, include: { partner: true } });
    if (!i || !i.nextDue) fail(404, 'Không tìm thấy việc cần theo dõi', 'NOT_FOUND');
    if (i.partner.archivedAt) fail(409, 'Đối tác đã ngừng theo dõi', 'ARCHIVED');
    if (i.followUpDone) fail(409, 'Việc này đã xong', 'CONFLICT');
    P.assertCan(s, 'edit', 'crm.interaction', ctxOf(i.partner, null, { op: 'followup', participant: i.nextOwnerId === s.userId || i.createdById === s.userId }));
    const note = text(req.body?.note, 'Kết quả', { max: 2000 });
    await prisma.$transaction(async tx => {
      await tx.crmInteraction.update({ where: { id: i.id }, data: { followUpDone: true } });
      // Kết quả theo dõi ghi thành một dòng nhật ký mới (lịch sử không sửa).
      if (note) await tx.crmInteraction.create({ data: { partnerId: i.partnerId, type: 'OTHER', date: new Date(), summary: `Hoàn thành việc theo dõi: ${note}`, createdById: req.user.id } });
    });
    await audit(req, 'CRM_FOLLOWUP_DONE', 'CrmInteraction', i.id, null, { partnerId: i.partnerId });
    res.json({ ok: true });
  });

  // ---------- Hợp đồng / gói thầu / thoả thuận / giấy phép ----------
  const engData = async (b, partial, req) => {
    const d = {};
    if (!partial || b.title !== undefined) d.title = text(b.title, 'Tên', { required: true, max: 300 });
    if (!partial || b.kind !== undefined) d.kind = oneOf(b.kind, Object.keys(EKINDS), 'Loại') || 'CONTRACT';
    if (b.code !== undefined) d.code = text(b.code, 'Số hiệu', { max: 80 }) || null;
    if (b.value !== undefined) d.value = money(b.value);
    for (const k of ['signedAt', 'startAt', 'endAt']) if (b[k] !== undefined) d[k] = optionalDate(b[k], 'Ngày');
    if (b.status !== undefined) d.status = oneOf(b.status, Object.keys(ESTATUS), 'Trạng thái');
    if (b.note !== undefined) d.note = text(b.note, 'Ghi chú', { max: 2000 }) || '';
    if (b.projectId !== undefined) {
      d.projectId = optionalInt(b.projectId, 'Dự án');
      if (d.projectId) await loadProject(prisma, req.user, d.projectId, 'view').catch(() => fail(422, 'Dự án không tồn tại hoặc bạn không xem được', 'INVALID_VALUE'));
    }
    if (d.startAt && d.endAt && d.endAt < d.startAt) fail(422, 'Ngày kết thúc trước ngày bắt đầu', 'INVALID_DATE');
    return d;
  };
  app.post('/api/crm/partners/:id/engagements', auth, async (req, res) => {
    const s = await subject(req);
    const p = await loadPartner(req.params.id);
    P.assertCan(s, 'edit', 'crm.engagement', ctxOf(p));
    if (p.archivedAt) fail(409, 'Đối tác đã ngừng theo dõi', 'ARCHIVED');
    const row = await prisma.crmEngagement.create({ data: { partnerId: p.id, ...(await engData(req.body || {}, false, req)), createdById: req.user.id } });
    await audit(req, 'CRM_ENGAGEMENT_CREATE', 'CrmEngagement', row.id, null, { partnerId: p.id, kind: row.kind, title: row.title });
    res.status(201).json({ id: row.id });
  });
  app.patch('/api/crm/engagements/:id', auth, async (req, res) => {
    const s = await subject(req);
    const e = await prisma.crmEngagement.findUnique({ where: { id: intParam(req.params.id) }, include: { partner: true } });
    if (!e) fail(404, 'Không tìm thấy hợp đồng / gói thầu', 'NOT_FOUND');
    P.assertCan(s, 'edit', 'crm.engagement', ctxOf(e.partner));
    const data = await engData(req.body || {}, true, req);
    await prisma.crmEngagement.update({ where: { id: e.id }, data });
    await audit(req, 'CRM_ENGAGEMENT_UPDATE', 'CrmEngagement', e.id, null, { partnerId: e.partnerId, fields: Object.keys(data) });
    res.json({ ok: true });
  });
};

// Nhắc việc theo dõi (08:10): đến hạn hôm nay, và quá hạn 1 / 3 / 7 ngày; quá hạn 7 ngày báo thêm lãnh đạo bộ phận phụ trách + người phụ trách đối tác.
// Người theo dõi đã khoá tài khoản → báo người phụ trách đối tác (hoặc lãnh đạo bộ phận phụ trách).
async function runCrmFollowups(prisma, now = new Date()) {
  const today = WK.dayOf(now);
  const end = new Date(Date.parse(today + 'T00:00:00+07:00') + 86_400_000);
  const rows = await prisma.crmInteraction.findMany({ where: { followUpDone: false, nextDue: { gte: new Date(end.getTime() - 9 * 86_400_000), lt: end }, partner: { archivedAt: null } },
    include: { partner: { select: { id: true, name: true, ownerUserId: true, ownerDepartmentId: true } } } });
  const active = new Set((await prisma.user.findMany({ where: { isActive: true, isRootAdmin: false, role: { not: 'admin' } }, select: { id: true } })).map(u => u.id));
  const leadersOf = async dept => (await prisma.user.findMany({ where: { isActive: true, isRootAdmin: false, role: { not: 'admin' }, departmentId: dept }, include: { permissions: true } }))
    .filter(u => require('../lib/permissions').permissionScope(u, 'reports.summary', 'VIEW')).map(u => u.id);
  let sent = 0;
  for (const i of rows) {
    const late = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(WK.dayOf(i.nextDue) + 'T00:00:00Z')) / 86_400_000);
    if (![0, 1, 3, 7].includes(late)) continue;
    let to = i.nextOwnerId && active.has(i.nextOwnerId) ? [i.nextOwnerId] : [];
    if (!to.length) to = i.partner.ownerUserId && active.has(i.partner.ownerUserId) ? [i.partner.ownerUserId] : await leadersOf(i.partner.ownerDepartmentId);
    if (late === 7) to = [...new Set([...to, ...(i.partner.ownerUserId && active.has(i.partner.ownerUserId) ? [i.partner.ownerUserId] : []), ...(await leadersOf(i.partner.ownerDepartmentId))])];
    sent += await notify(prisma, to, { type: late ? 'CRM_FOLLOWUP_OVERDUE' : 'CRM_FOLLOWUP_DUE', title: late ? `Quá hạn ${late} ngày: theo dõi ${i.partner.name}` : `Hôm nay: theo dõi ${i.partner.name}`,
      body: (i.nextStep || '').slice(0, 200) || null, link: `#/crm/${i.partner.id}` });
  }
  return { sent };
}
module.exports.runCrmFollowups = runCrmFollowups;
module.exports.KINDS = KINDS;
