const test = require('node:test');
const assert = require('node:assert/strict');
const { textMatch } = require('./vanthu');

// Ô tìm Văn thư (danh sách sổ + "Chọn từ sổ Văn thư"): không phân biệt hoa thường và dấu như Tìm nhanh (routes/search.js).
test('tìm văn bản không phân biệt dấu: unaccent(lower(cột)) cho số, trích yếu, nơi gửi / nhận, số của bên gửi', () => {
  const q = textMatch('xay dung');
  for (const c of ['number', 'title', 'counterpart', 'externalNumber']) {
    assert.ok(q.text.includes(`unaccent(lower(coalesce("${c}", ''))) LIKE unaccent(lower($`), c);
  }
  assert.equal(q.text.match(/ OR /g).length, 3);
  assert.deepEqual([...new Set(q.values)], ['%xay dung%']); // từ khoá đi bằng tham số, không ghép vào câu SQL
});

test('ký tự đại diện của LIKE trong từ khoá văn thư được hiểu theo nghĩa đen; từ khoá không lọt vào câu SQL', () => {
  assert.deepEqual([...new Set(textMatch('50%_a\\b').values)], ['%50\\%\\_a\\\\b%']);
  assert.ok(!textMatch('x\'); DROP TABLE "DocRecord"; --').text.includes('DROP'));
});
