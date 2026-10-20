// Kiểm thử end-to-end WorkHub: chạy server thật + PostgreSQL thật + Chromium.
// Yêu cầu E2E_DATABASE_URL trỏ tới CSDL RIÊNG cho test (tên kết thúc bằng _e2e hoặc _test) — CSDL sẽ bị xoá sạch.
const { defineConfig, devices } = require('@playwright/test');

const DATABASE_URL = process.env.E2E_DATABASE_URL || '';
const dbName = DATABASE_URL.split('/').pop().split('?')[0];
if (!/_(e2e|test)$/.test(dbName)) {
  throw new Error('Đặt E2E_DATABASE_URL tới CSDL test có tên kết thúc bằng _e2e hoặc _test (CSDL này sẽ bị reset). Ví dụ: postgresql://workhub:workhub@127.0.0.1:5434/workhub_e2e');
}
const PORT = Number(process.env.E2E_PORT || 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['json', { outputFile: 'test-results/results.json' }]],
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
      ROOT_ADMIN_USERNAME: 'admin', ROOT_ADMIN_PASSWORD: 'Admin@2026', SEED_DEMO: 'true', ENABLE_CRON: 'false',
      STORAGE_DRIVER: 'local', UPLOAD_DIR: require('node:path').join(require('node:os').tmpdir(), 'workhub-e2e-uploads'),
    },
  },
});
module.exports.BASE_URL = BASE_URL;
