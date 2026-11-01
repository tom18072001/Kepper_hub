const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { minioStat, localPath } = require('./storage');

test('MinIO stat returns null only when object is missing', async () => {
  const missing = { statObject: async () => { const error = new Error('missing'); error.code = 'NoSuchKey'; throw error; } };
  assert.equal(await minioStat(missing, 'bucket', 'key'), null);
});

test('MinIO stat preserves permission and network errors', async () => {
  for (const code of ['AccessDenied', 'ECONNREFUSED']) {
    const client = { statObject: async () => { const error = new Error(code); error.code = code; throw error; } };
    await assert.rejects(() => minioStat(client, 'bucket', 'key'), { code });
  }
});

test('MinIO bucket checks preserve permission and network errors', () => {
  const source = require('node:fs').readFileSync(require.resolve('./storage'), 'utf8');
  assert.doesNotMatch(source, /bucketExists\(bucket\)\.catch\(\(\) => false\)/);
});

test('MinIO driver requires explicit credentials', () => {
  const env = { ...process.env, STORAGE_DRIVER: 'minio' };
  delete env.MINIO_ACCESS_KEY;
  delete env.MINIO_SECRET_KEY;
  const result = spawnSync(process.execPath, ['-e', "require('./storage')"], { cwd: __dirname, env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Thiếu MINIO_ACCESS_KEY hoặc MINIO_SECRET_KEY/);
});

test('local storage rejects object keys outside upload root', () => {
  const root = require('node:path').resolve(__dirname, '..', 'uploads');
  assert.throws(() => localPath(root, '../secret.txt'), { code: 'INVALID_OBJECT_KEY' });
  assert.throws(() => localPath(root, ''), { code: 'INVALID_OBJECT_KEY' });
  assert.equal(localPath(root, 'minh-chung/file.pdf'), require('node:path').join(root, 'minh-chung', 'file.pdf'));
});
