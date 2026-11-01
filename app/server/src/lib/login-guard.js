const { createHmac } = require('node:crypto');

function identifierHash(username, secret) {
  return createHmac('sha256', secret).update(String(username).trim().toLowerCase()).digest('hex');
}

async function recordFailure(prisma, username, user, secret, reason) {
  const identifier = identifierHash(username, secret);
  await prisma.loginAttempt.create({ data: { identifier, userId: user?.id || null, reason } });
  console.warn(JSON.stringify({ level: 'warn', event: 'login_failed', reason }));
}

async function isLocked(prisma, username, secret, config, now = new Date()) {
  if (!config.lockoutMax) return false;
  const identifier = identifierHash(username, secret);
  const since = new Date(now.getTime() - config.lockoutMinutes * 60_000);
  const lastSuccess = await prisma.loginAttempt.findFirst({
    where: { identifier, reason: 'SUCCESS' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true },
  });
  const failures = await prisma.loginAttempt.count({ where: {
    identifier, reason: { in: ['BAD_CREDENTIALS', 'INACTIVE'] },
    createdAt: { gte: lastSuccess && lastSuccess.createdAt > since ? lastSuccess.createdAt : since },
  } });
  return failures >= config.lockoutMax;
}

module.exports = { identifierHash, recordFailure, isLocked };
