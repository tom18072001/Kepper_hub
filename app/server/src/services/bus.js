// Kênh cập nhật thời gian thực (Server-Sent Events) trong một tiến trình.
// Sự kiện phát trễ một chút để transaction kịp commit trước khi trình duyệt tải lại dữ liệu.
const { projectRights } = require('./access');

const DELAY_MS = 150;
const RIGHTS_TTL_MS = 60_000;
const clients = new Set();
let prismaRef = null;

function init(prisma) { prismaRef = prisma; }

function send(client, event, data) {
  try { client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { remove(client); }
}
function add(res, user) {
  const client = { res, user, rights: new Map() };
  clients.add(client);
  return client;
}
function remove(client) { clients.delete(client); }

async function canView(client, projectId) {
  const cached = client.rights.get(projectId);
  if (cached && Date.now() - cached.at < RIGHTS_TTL_MS) return cached.ok;
  const project = await prismaRef.project.findUnique({ where: { id: projectId } });
  const member = project && await prismaRef.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: client.user.id } } });
  const ok = !!project && !project.deletedAt && projectRights(client.user, project, member).canView;
  client.rights.set(projectId, { ok, at: Date.now() });
  return ok;
}

async function deliver(event) {
  for (const client of [...clients]) {
    try {
      if (event.type === 'notify') { if (event.userIds.includes(client.user.id)) send(client, 'notify', {}); continue; }
      if (await canView(client, event.projectId)) send(client, event.type, { projectId: event.projectId, itemId: event.itemId || null, actorId: event.actorId || null });
    } catch { remove(client); }
  }
}
function publish(event) {
  if (!prismaRef || !clients.size) return;
  setTimeout(() => deliver(event).catch(() => {}), DELAY_MS);
}
const item = (projectId, itemId, actorId) => publish({ type: 'item', projectId, itemId, actorId });
const project = (projectId, actorId) => publish({ type: 'project', projectId, actorId });
// Thông báo: gom theo người nhận, phát sau khi ngừng 600 ms (tối đa 3 s) — một thao tác hàng loạt (giao 30 việc)
// chỉ tạo một lần làm mới ở trình duyệt, và phát sau khi transaction đã commit.
const NOTIFY_QUIET_MS = 600, NOTIFY_MAX_MS = 3000;
let pendingNotify = new Set(), notifyTimer = null, notifyFirst = 0;
function flushNotify() {
  const userIds = [...pendingNotify];
  pendingNotify = new Set(); notifyTimer = null; notifyFirst = 0;
  if (prismaRef && clients.size && userIds.length) deliver({ type: 'notify', userIds }).catch(() => {});
}
function notified(userIds) {
  for (const id of userIds || []) pendingNotify.add(id);
  if (!pendingNotify.size) return;
  if (!notifyFirst) notifyFirst = Date.now();
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(flushNotify, Math.max(0, Math.min(NOTIFY_QUIET_MS, notifyFirst + NOTIFY_MAX_MS - Date.now())));
  notifyTimer.unref?.();
}

module.exports = { init, add, remove, item, project, notified, count: () => clients.size };
