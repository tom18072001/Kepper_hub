class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const fail = (status, message, code) => { throw new HttpError(status, message, code); };

function intParam(value, label = 'ID') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) fail(422, label + ' không hợp lệ', 'INVALID_ID');
  return n;
}
function optionalInt(value, label) {
  if (value === undefined || value === null || value === '') return null;
  return intParam(value, label);
}
function optionalDate(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) fail(422, label + ' không hợp lệ', 'INVALID_DATE');
  return d;
}
function text(value, label, { required = false, max = 500 } = {}) {
  if (value === undefined) { if (required) fail(422, 'Thiếu ' + label, 'REQUIRED'); return undefined; }
  const s = String(value ?? '').trim();
  if (required && !s) fail(422, 'Thiếu ' + label, 'REQUIRED');
  if (s.length > max) fail(422, label + ' vượt ' + max + ' ký tự', 'TOO_LONG');
  return s;
}
function oneOf(value, allowed, label) {
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) fail(422, label + ' không hợp lệ', 'INVALID_VALUE');
  return value;
}

module.exports = { HttpError, fail, intParam, optionalInt, optionalDate, text, oneOf };
