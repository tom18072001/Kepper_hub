// Lịch công tác: đọc giờ, dòng ngày, tách thành phần, đọc trang tính lịch tuần (dữ liệu GIẢ).
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./schedule');

test('đọc giờ trong lịch', () => {
  assert.equal(S.parseTime('08h30'), 510);
  assert.equal(S.parseTime('09h30 - 11h30'), 570);
  assert.equal(S.parseTime('14:00'), 840);
  assert.equal(S.parseTime('Cả ngày'), null);
  assert.equal(S.parseTime('Sáng'), 480);
});

test('dòng ngày và tách thành phần', () => {
  assert.equal(S.dayOf('Thứ Hai, ngày 12/10/2026'), '2026-10-12');
  assert.equal(S.dayOf('Chủ Nhật, ngày 18/10/2026'), '2026-10-18');
  assert.equal(S.dayOf('Họp giao ban 12/10/2026'), null);
  assert.deepEqual(S.splitPeople('- Đ/c Hồ Minh Chánh\n- Đ/c Tạ Thu Phương\n- Tập thể phòng KHCN'), ['Hồ Minh Chánh', 'Tạ Thu Phương', 'Tập thể phòng KHCN']);
  const users = [{ id: 1, fullName: 'Hồ Minh Chánh' }, { id: 2, fullName: 'Tạ Thu Phương' }];
  assert.deepEqual(S.matchPeople('- đ/c ho minh chanh\n- Đ/c Tạ Thu Phương\n- Đ/c Người Lạ', users), { ids: [1, 2], unmatched: ['Người Lạ'] });
});

test('đọc trang tính lịch tuần theo mẫu văn bản', () => {
  const rows = [
    ['TRUNG TÂM (giả)', '', '', 'Hà Nội, ngày 12 tháng 10 năm 2026'],
    ['LỊCH CÔNG TÁC TUẦN'],
    [],
    ['Thời gian', 'Nội dung', 'Thành phần', 'Bí thư Chủ trì', 'Địa điểm', 'Ghi chú'],
    ['Thứ Hai, ngày 12/10/2026'],
    ['08h30', 'Họp giao ban tuần', '- Đ/c Hồ Minh Chánh', '', 'Phòng họp 302', ''],
    ['14h00', 'Làm việc với đối tác', '- Đ/c Tạ Thu Phương', 'Đ/c A', 'Nơi khác', 'Mang hồ sơ'],
    ['Thứ Ba, ngày 13/10/2026'],
    ['Cả ngày', 'Khảo sát địa điểm', '- Tập thể phòng KHCN', '', 'TP. Hồ Chí Minh', ''],
  ];
  const { events, warnings } = S.parseScheduleRows(rows);
  assert.equal(warnings.length, 0);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(e => [e.date, e.startMin, e.title]), [['2026-10-12', 510, 'Họp giao ban tuần'], ['2026-10-12', 840, 'Làm việc với đối tác'], ['2026-10-13', null, 'Khảo sát địa điểm']]);
  assert.equal(events[1].chairText, 'Đ/c A');
  assert.equal(events[1].note, 'Mang hồ sơ');
  assert.equal(S.parseScheduleRows([['Mã', 'Tiêu đề']]), null);
});

test('địa điểm ngoài cơ quan', () => {
  assert.equal(S.isOutside('Phòng họp 302'), false);
  assert.equal(S.isOutside('Trực tuyến'), false);
  assert.equal(S.isOutside(''), false);
  assert.equal(S.isOutside('TP. Hồ Chí Minh'), true);
  assert.equal(S.isOutside('62 phố (giả)'), true);
});
