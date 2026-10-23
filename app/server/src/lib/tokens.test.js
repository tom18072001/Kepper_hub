const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('./tokens');

test('Token Claude: đọc mọi thứ người dùng xem được trừ xuất tệp / quản trị; ghi chỉ thao tác thường ngày', () => {
  const R = ['read'], W = ['read', 'write'];
  assert.equal(T.tokenDenied('GET', '/api/weekly/summary', R), null);
  assert.equal(T.tokenDenied('GET', '/api/items/12', R), null);
  assert.match(T.tokenDenied('GET', '/api/projects/3/export.xlsx', W), /xuất tệp/);
  assert.match(T.tokenDenied('GET', '/api/admin/users', W), /quản trị/);
  assert.match(T.tokenDenied('PATCH', '/api/items/12', R), /chỉ đọc/);
  assert.equal(T.tokenDenied('PATCH', '/api/items/12', W), null);
  assert.equal(T.tokenDenied('POST', '/api/items/12/comments', W), null);
  assert.equal(T.tokenDenied('PUT', '/api/weekly/report', W), null);
  for (const [m, p] of [['POST', '/api/weekly/submit'], ['PUT', '/api/weekly/meeting'], ['POST', '/api/weekly/compliance/approve'], ['DELETE', '/api/items/12'],
    ['POST', '/api/me/password'], ['POST', '/api/me/tokens'], ['PUT', '/api/admin/users/3'], ['POST', '/api/projects'], ['POST', '/api/extensions/4/decide'], ['PUT', '/api/projects/3/members']])
    assert.match(T.tokenDenied(m, p, W), /giao diện/, `${m} ${p}`);
  const t = T.newToken();
  assert.ok(T.isToken(t) && t.length > 40); assert.equal(T.sha256(t).length, 64); assert.ok(!T.isToken('eyJhbGciOi'));
});

test('Token Claude: biến thể đường dẫn (/ cuối, chữ hoa, %xx, //) không lách được danh sách chặn', () => {
  const R = ['read'], W = ['read', 'write'];
  for (const p of ['/api/projects/3/export.xlsx/', '/api/projects/3/export.XLSX', '/api/summary.xlsx/', '/api/reports/weekly.docx/', '/api/stream/', '/API/me/tokens',
    '/api/attachments/5/download/', '/api/attachments/5/preview', '/api/attachments/5/PREVIEW/', '/api/me/viber', '/api/ADMIN/users', '/api/projects/3/export%2Exlsx', '//api//stream',
    '/api/hrm/people/7/identity/', '/api/projects/3/register.xlsx?x=1'])
    assert.ok(T.tokenDenied('GET', p, W), p);
  // Ghi: biến thể không mở thêm đường (chuẩn hoá xong vẫn phải khớp danh sách cho phép).
  assert.equal(T.tokenDenied('PATCH', '/api/items/12/', W), null);
  assert.ok(T.tokenDenied('POST', '/api/weekly/submit/', W));
  assert.ok(T.tokenDenied('DELETE', '/API/items/12', W));
  assert.equal(T.normPath('/API//Items/12/?a=1'), '/api/items/12');
  assert.throws(() => T.assertNotVia({ via: 'mcp' }), /Claude/);
  assert.doesNotThrow(() => T.assertNotVia({}));
  assert.ok(T.tokenDenied('GET', '/api/projects/3/export.xlsx', R));
});
