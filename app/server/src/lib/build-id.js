// Mã bản giao diện: băm nội dung các tệp HTML / JS / CSS trong thư mục web.
// Sửa mã giao diện → mã khác → tab đang mở biết mình chạy bản cũ (web/js/version.js hiện "Có bản mới · Tải lại").
// Không dùng giờ khởi động: khởi động lại máy chủ mà giao diện không đổi thì không bắt người dùng tải lại.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CODE_FILE = /\.(html|m?js|css)$/i;
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); // không theo locale: cùng thứ tự trên mọi máy

function computeBuildId(webDir) {
  const hash = crypto.createHash('sha256');
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort(byName)) {
      if (entry.name.startsWith('.')) continue;
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), name);
      else if (entry.isFile() && CODE_FILE.test(entry.name)) hash.update(name).update('\0').update(fs.readFileSync(path.join(dir, entry.name))).update('\0');
    }
  };
  walk(webDir, '');
  return hash.digest('hex').slice(0, 12);
}

module.exports = { computeBuildId };
