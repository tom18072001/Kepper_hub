const fs = require('node:fs/promises');
const path = require('node:path');

async function checkWritable(dir) {
  // A temporary file proves that the running UID can write, not merely stat the mount.
  const name = path.join(dir, `.health-${process.pid}-${Date.now()}`);
  const handle = await fs.open(name, 'wx', 0o600);
  try { await handle.close(); } finally { await fs.unlink(name); }
}

module.exports = { checkWritable };
