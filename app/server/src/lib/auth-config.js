const { MIN_PASSWORD_LENGTH } = require('./passwords');

const LEGACY_JWT_TTL_HOURS = 12;

function integer(env, key, fallback, min, max) {
  const value = env[key];
  if (value === undefined || value === '') return fallback;
  if (!/^[0-9]+$/.test(String(value)) || Number(value) < min || Number(value) > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return Number(value);
}

function loadAuthConfig(env = process.env) {
  if (env.AUTH_SSO_ENABLED !== undefined && !['false', '0', ''].includes(env.AUTH_SSO_ENABLED)) {
    throw new Error('SSO is not available; AUTH_SSO_ENABLED must remain false');
  }
  const lockoutMax = integer(env, 'AUTH_LOCKOUT_MAX', 0, 0, 100);
  if (lockoutMax > 0 && lockoutMax < 3) throw new Error('AUTH_LOCKOUT_MAX must be 0 or >= 3');
  return Object.freeze({
    lockoutMax,
    lockoutMinutes: integer(env, 'AUTH_LOCKOUT_MINUTES', 15, 1, 1440),
    minPassword: integer(env, 'AUTH_MIN_PASSWORD', MIN_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, 128),
    jwtTtlHours: integer(env, 'AUTH_JWT_TTL_HOURS', LEGACY_JWT_TTL_HOURS, 1, LEGACY_JWT_TTL_HOURS),
  });
}

module.exports = { loadAuthConfig, LEGACY_JWT_TTL_HOURS };
