// Kiểm thử end-to-end WorkHub: chạy server thật + PostgreSQL thật + Chromium.
// Yêu cầu E2E_DATABASE_URL trỏ tới CSDL RIÊNG cho test (tên kết thúc bằng _e2e hoặc _test) — CSDL sẽ bị xoá sạch.
const { defineConfig, devices } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DATABASE_URL = process.env.E2E_DATABASE_URL || '';
const dbName = DATABASE_URL.split('/').pop().split('?')[0];
if (!/_(e2e|test)$/.test(dbName)) {
  throw new Error('Đặt E2E_DATABASE_URL tới CSDL test có tên kết thúc bằng _e2e hoặc _test (CSDL này sẽ bị reset). Ví dụ: postgresql://workhub:workhub@127.0.0.1:5434/workhub_e2e');
}
const PORT = Number(process.env.E2E_PORT || 4173);
// E2E là test CHỨC NĂNG chạy cả bộ bằng vài tài khoản giả trong vài phút: nâng giới hạn tần suất API để không nhận 429 giả.
// Một nguồn duy nhất: truyền vào máy chủ (webServer.env) và process.env (worker nạp lại tệp này → test đọc được, vd. 01-core test 8).
// Bản thật giữ mặc định 600 yêu cầu / phút / tài khoản — ghim bằng unit test app/server/src/lib/rate-limit.test.js. Không thử lại khi 429.
const API_RATE_LIMIT = '100000';
process.env.E2E_API_RATE_LIMIT = API_RATE_LIMIT;
const BASE_URL = `http://127.0.0.1:${PORT}`;
// Kho file dự án GIẢ (NAS_ROOT) cho kịch bản Tài liệu (16-tai-lieu-du-an): thư mục trống, kịch bản tự tạo thư mục dự án của mình.
// Dự án khác không có thư mục ở đây nên tệp đính kèm của chúng vẫn lưu như cũ (UPLOAD_DIR).
// Thư mục theo cổng: hai lượt chạy cùng lúc trên một máy (khác E2E_PORT, khác CSDL) không xoá kho của nhau lúc khởi động.
const NAS_ROOT = path.join(os.tmpdir(), `workhub-e2e-nas-${PORT}`);
const UPLOAD_DIR = path.join(os.tmpdir(), `workhub-e2e-uploads-${PORT}`);
if (process.env.TEST_WORKER_INDEX === undefined) { // chỉ tiến trình chính (worker cũng nạp lại tệp cấu hình này)
  fs.rmSync(NAS_ROOT, { recursive: true, force: true });
  fs.mkdirSync(NAS_ROOT, { recursive: true });
  // Spec phải lấy `test` từ ./helpers (fixture đóng context tự mở sau mỗi test): lấy thẳng từ @playwright/test thì context lại rò.
  const tests = path.join(__dirname, 'tests');
  const direct = fs.readdirSync(tests).filter(f => f.endsWith('.spec.js') && /require\(['"]@playwright\/test['"]\)/.test(fs.readFileSync(path.join(tests, f), 'utf8')));
  if (direct.length) throw new Error(`Spec lấy test thẳng từ @playwright/test: ${direct.join(', ')} — đổi thành require('./helpers') để context tự đóng sau mỗi test.`);
}

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // CI: dòng ngắn (line). Lần chạy có test hỏng: luu-lan-hong.js chép trace / ảnh sang lan-hong/ (lần chạy sau không xoá) — để CUỐI.
  reporter: [[process.env.CI ? 'line' : 'list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['json', { outputFile: 'test-results/results.json' }], ['./luu-lan-hong.js']],
  use: {
    baseURL: BASE_URL,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    // Reset CSDL test → áp migration → seed dữ liệu GIẢ → chạy server.
    command: 'npx prisma migrate reset --force --skip-seed --skip-generate && node src/seed.js && node src/server.js',
    cwd: require('node:path').join(__dirname, '..', 'server'),
    url: BASE_URL + '/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    env: {
      DATABASE_URL, PORT: String(PORT), JWT_SECRET: 'e2e-secret-' + 'x'.repeat(32), APP_ORIGIN: BASE_URL, NODE_ENV: 'test',
      ROOT_ADMIN_USERNAME: 'admin', ROOT_ADMIN_PASSWORD: 'Admin@2026', SEED_DEMO: 'true', ENABLE_CRON: 'false', MODULES: 'crm,hrm,vanthu',
      API_RATE_LIMIT, // xem chú thích ở hằng API_RATE_LIMIT phía trên
      STORAGE_DRIVER: 'local', NAS_ROOT, UPLOAD_DIR,
      // Như docker-compose: cổng NAS giữ tối đa NAS_MAX_INFLIGHT (4) < UV_THREADPOOL_SIZE luồng; hạn chờ rộng hơn để máy chạy test đang tải
      // (nhiều trình duyệt mở cùng lúc) không làm cầu dao NAS mở → các spec sau nhận 503 (16-tai-lieu-du-an T3 chập chờn).
      UV_THREADPOOL_SIZE: '16', NAS_OP_TIMEOUT_MS: '30000',
    },
  },
});
module.exports.BASE_URL = BASE_URL;
module.exports.NAS_ROOT = NAS_ROOT;
module.exports.API_RATE_LIMIT = API_RATE_LIMIT;
