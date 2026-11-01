// Audit log (truy vết hệ thống), activity (lịch sử từng việc) và thông báo.
function auditFor(prisma) {
  return async function audit(req, action, entity, entityId, oldValue, newValue, client = prisma) {
    try {
      await client.auditLog.create({ data: {
        userId: req.user ? req.user.id : null, action, entity, entityId: entityId != null ? String(entityId) : null,
        oldValue: oldValue != null ? JSON.stringify(oldValue) : null, newValue: newValue != null ? JSON.stringify(newValue) : null,
        // Thao tác qua Claude (token cá nhân) đánh dấu rõ trong nhật ký: [claude:token#id].
        ip: req.ip || null, userAgent: ((req.via ? `[claude:token#${req.tokenId}] ` : '') + String(req.headers['user-agent'] || '')).slice(0, 300) || null,
      } });
    } catch (error) {
      // Ghi log lỗi audit ra stderr để thu gom tập trung; không chặn nghiệp vụ.
      console.error(JSON.stringify({ level: 'error', msg: 'audit_write_failed', action, entity, error: error.message }));
    }
  };
}

async function activity(client, workItemId, actorId, type, data = null) {
  return client.activity.create({ data: { workItemId, actorId: actorId || null, type, data } });
}

async function notify(client, userIds, { type, title, body = null, link = null }, exceptUserId = null) {
  const ids = [...new Set((userIds || []).filter(id => id && id !== exceptUserId))];
  if (!ids.length) return 0;
  await client.notification.createMany({ data: ids.map(userId => ({ userId, type, title, body, link })) });
  require('./bus').notified(ids);
  return ids.length;
}

// Việc đến từ yêu cầu tiếp nhận: báo người gửi yêu cầu khi việc hoàn thành.
async function notifyRequesterIfDone(client, item, project, toCategory, actorId) {
  if (toCategory !== 'COMPLETED') return;
  const request = await client.intakeRequest.findUnique({ where: { workItemId: item.id } });
  if (!request) return;
  await notify(client, [request.requesterId], {
    type: 'INTAKE_DONE', title: `Yêu cầu "${request.title}" đã hoàn thành (${project.key}-${item.number})`, body: project.name, link: '#/requests',
  }, actorId);
}

module.exports = { auditFor, activity, notify, notifyRequesterIfDone };
