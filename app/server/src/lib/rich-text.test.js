const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeHtml, htmlToText, mentions } = require('./rich-text');

test('loại bỏ script, thuộc tính sự kiện và liên kết javascript:', () => {
  const out = sanitizeHtml('<p onclick="x()">Chào<script>alert(1)</script><img src=x onerror=alert(2)></p><a href="javascript:alert(3)">a</a><a href="https://vi.wikipedia.org">b</a>');
  assert.doesNotMatch(out, /script|onerror|onclick|javascript:|<img/i);
  assert.match(out, /<p>Chào<\/p>/);
  assert.match(out, /href="https:\/\/vi.wikipedia.org" rel="noopener noreferrer" target="_blank"/);
});

test('giữ định dạng cơ bản và bảng', () => {
  const out = sanitizeHtml('<p><strong>Đậm</strong> <em>nghiêng</em></p><ul><li>một</li></ul><table><tr><td colspan="2">ô</td></tr></table>');
  assert.match(out, /<strong>Đậm<\/strong>/);
  assert.match(out, /<td colspan="2">ô<\/td>/);
});

test('từ chối nội dung quá lớn và kiểu dữ liệu sai', () => {
  assert.throws(() => sanitizeHtml('x'.repeat(1024 * 1024 + 1)), { code: 'INVALID_RICH_TEXT' });
  assert.throws(() => sanitizeHtml({}), { code: 'INVALID_RICH_TEXT' });
  assert.equal(sanitizeHtml(null), '');
});

test('chuyển HTML sang văn bản và đọc @mention', () => {
  assert.equal(htmlToText('<p>Dòng 1</p><p>Dòng &amp; 2</p>'), 'Dòng 1\nDòng & 2');
  assert.deepEqual(mentions('@tp.kinhdoanh xem giúp, cc @NV.KT và email a@b.com'), ['tp.kinhdoanh', 'nv.kt']);
});
