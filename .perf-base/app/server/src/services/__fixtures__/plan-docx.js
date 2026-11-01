// Văn bản "Kế hoạch công tác năm" GIẢ (tên cán bộ giả) để kiểm thử trình đọc kế hoạch — dùng cho unit test và E2E.
const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType } = require('docx');

const cell = text => new TableCell({ width: { size: 1400, type: WidthType.DXA }, children: String(text).split('\n').map(t => new Paragraph({ children: [new TextRun(t)] })) });
const row = cells => new TableRow({ children: cells.map(cell) });
const section = (code, title) => new TableRow({ children: [cell(code), new TableCell({ columnSpan: 6, children: [new Paragraph(title)] })] });

async function buildPlanDocx({ year = 2027, leadName = 'Lê Thu Hà', supportName = 'Phạm Văn An' } = {}) {
  const table = new Table({ rows: [
    row(['TT', 'Nội dung', 'Thời gian', 'Địa điểm', 'Mô tả công việc', 'Kết quả dự kiến', 'Thực hiện']),
    section('1', 'Tổ chức các hội thi'),
    row(['1.1', 'Hội thi Sáng tạo mẫu', `Quý II, III (trước 31/8/${year})`, 'Hà Nội',
      `- Kinh phí: 350 triệu đồng\n- Tháng 3/${year}: Ban hành thể lệ\n- Tháng 6 - 7/${year}: Tổ chức vòng chung kết`,
      '- 500 thí sinh\n- Báo cáo tổng kết',
      `Lãnh đạo phụ trách: Giám đốc\nChủ trì: Phòng Kinh doanh (đ/c ${leadName})\nPhối hợp: Văn phòng (đ/c ${supportName})\nChuyên viên tham mưu: …`]),
    section('2', 'Công việc khác'),
    row(['2.1', 'Báo cáo định kỳ mẫu', 'Trước ngày 25 tháng cuối mỗi Quý', '', 'Tổng hợp báo cáo', 'Báo cáo Quý',
      'Chủ trì: Phòng Hành chính (đ/c Người Chưa Có Tài Khoản)']),
  ] });
  const doc = new Document({ sections: [{ children: [new Paragraph(`KẾ HOẠCH CÔNG TÁC NĂM ${year} (MẪU KIỂM THỬ)`), new Paragraph('PHÂN CÔNG CÔNG VIỆC CỤ THỂ'), table] }] });
  return Packer.toBuffer(doc);
}

// GĐ3b — kế hoạch có mốc theo TUẦN, việc "mỗi Quý" kèm mốc tháng, mốc không đọc được, đơn vị chủ trì viết tắt (KHCN, TNT, VP).
// Hàm riêng: không đổi đầu ra mặc định của buildPlanDocx (E2E #16 kiểm tra số nhiệm vụ / mốc của nó).
async function buildPlanDocxWeeks({ year = 2027, leadName = 'Phan Đức Khoa', supportName = 'Châu Ngọc Lan' } = {}) {
  const table = new Table({ rows: [
    row(['TT', 'Nội dung', 'Thời gian', 'Địa điểm', 'Mô tả công việc', 'Kết quả dự kiến', 'Thực hiện']),
    section('1', 'Tổ chức các hội thi, cuộc thi'),
    row(['1.1', 'Hội thi Tin học trẻ mẫu', `Quý I - III/${year}`, 'Hà Nội',
      `- Kinh phí: 1.200 triệu đồng\n- Tuần 2 tháng 2/${year}: Họp Ban tổ chức\n- Tuần 1, 2 tháng 3/${year}: Phát động cuộc thi\n- Tháng 6/${year}: Chung kết toàn quốc\n- Tuần 6 tháng 7/${year}: Tổng kết\n- Tháng 9: Rút kinh nghiệm`,
      '- 1.000 thí sinh\n- Báo cáo tổng kết',
      `Lãnh đạo phụ trách: Phó Giám đốc\nChủ trì: Phòng KHCN (đ/c ${leadName})\nPhối hợp: Văn phòng, Phòng TNT (đ/c ${supportName})\nChuyên viên tham mưu: …`]),
    section('2', 'Công tác tổng hợp'),
    row(['2.1', 'Báo cáo định kỳ quý mẫu', 'Trước ngày 25 tháng cuối mỗi Quý', '', `- Tháng 3/${year}: Báo cáo Quý I gửi cấp trên\n- Tháng 12/${year}: Báo cáo tổng kết năm`, 'Báo cáo',
      'Chủ trì: VP\nPhối hợp: Phòng KHCN và Phòng TNT']),
    row(['2.2', 'Tọa đàm đối ngoại mẫu', `Tuần 3 tháng 4/${year}`, '', 'Tổ chức tọa đàm', 'Biên bản', 'Chủ trì: Phòng Đối ngoại']),
  ] });
  const doc = new Document({ sections: [{ children: [new Paragraph(`KẾ HOẠCH CÔNG TÁC NĂM ${year} (MẪU KIỂM THỬ GĐ3b)`), new Paragraph('PHÂN CÔNG CÔNG VIỆC CỤ THỂ'), table] }] });
  return Packer.toBuffer(doc);
}

module.exports = { buildPlanDocx, buildPlanDocxWeeks };
