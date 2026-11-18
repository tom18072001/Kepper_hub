// Giao diện mới: Trang chủ, menu tài khoản, Thông tin cá nhân (ảnh đại diện, cây tổ chức), Danh mục không còn ở menu người dùng.
const { test, expect } = require('@playwright/test');
const zlib = require('node:zlib');
const { login } = require('./helpers');

// Ảnh PNG 64×64 một màu (tạo tại chỗ — không dùng ảnh người thật).
function pngSquare(size = 64) {
  const crc = buf => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x40)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(size).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

test('24. Thông tin cá nhân: đổi / xoá ảnh đại diện, cây tổ chức; menu tài khoản không còn Danh mục dùng chung', async ({ page }) => {
  await login(page, 'nv.phaply');
  await expect(page.getByTestId('today')).toBeVisible();
  await page.getByTestId('user-menu').click();
  await expect(page.locator('#userPanel')).not.toContainText('Danh mục');
  await page.getByTestId('nav-me').click();
  await expect(page.getByTestId('profile')).toContainText('nv.phaply');
  // Nhân viên Ban Pháp lý: trên là lãnh đạo Ban Pháp lý và Ban Giám đốc.
  await expect(page.getByTestId('profile-org')).toContainText('Lãnh đạo Ban Pháp lý');
  await expect(page.getByTestId('profile-org')).toContainText('Ban Giám đốc');
  await page.locator('#pfFile').setInputFiles({ name: 'anh.png', mimeType: 'image/png', buffer: pngSquare() });
  await expect(page.locator('.toast', { hasText: 'Đã đổi ảnh đại diện' })).toBeVisible();
  await expect(page.locator('#meAvatar')).toHaveAttribute('src', /^\/avatars\/[0-9a-f-]{36}\.jpg$/);
  const src = await page.locator('#meAvatar').getAttribute('src');
  expect((await page.request.get(src)).status()).toBe(200);
  // Ảnh không phải PNG / JPEG / WebP thật → máy chủ từ chối.
  const token = await page.evaluate(() => localStorage.getItem('workhub_token'));
  const bad = await page.request.put('/api/me/avatar', { headers: { authorization: 'Bearer ' + token }, data: { image: 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64') } });
  expect(bad.status()).toBe(422);
  await page.getByTestId('profile-avatar-delete').click();
  await expect(page.locator('.toast', { hasText: 'Đã xoá ảnh đại diện' })).toBeVisible();
  expect((await page.request.get(src)).status()).toBe(404);
});
