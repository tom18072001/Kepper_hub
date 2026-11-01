// ============================================================================
// StorageService — trừu tượng hoá lưu trữ tệp minh chứng (datalake).
//   STORAGE_DRIVER=local  → lưu ổ đĩa (mặc định, tiện dev)
//   STORAGE_DRIVER=minio  → lưu MinIO/S3 (vận hành, chạy trong Docker Compose)
// Cùng một giao diện async: save / getStream / stat / remove.
// Đổi driver KHÔNG phải sửa server.js — chỉ đổi biến môi trường.
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { objectKey, isStorageNotFound } = require('./attachment-utils');

const DRIVER = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
function localPath(root, key) {
  const absolute = path.resolve(root, String(key || ''));
  const relative = path.relative(root, absolute);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    const error = new Error('Object key không hợp lệ');
    error.code = 'INVALID_OBJECT_KEY';
    throw error;
  }
  return absolute;
}

async function minioStat(client, bucket, key) {
  try { const stat = await client.statObject(bucket, key); return { size: stat.size }; }
  catch (error) { if (isStorageNotFound(error)) return null; throw error; }
}

// ---------------------------------------------------------------------------
// Driver: ổ đĩa cục bộ
// ---------------------------------------------------------------------------
function localDriver() {
  const ROOT = process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(__dirname, '..', '..', 'uploads');
  if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });

  return {
    kind: 'local',
    async save(originalName, buffer, folder = 'minh-chung') {
      const key = objectKey(folder, originalName);
      const abs = localPath(ROOT, key);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, buffer);
      return { objectKey: key, size: buffer.length, checksum: sha256(buffer) };
    },
    async stat(objectKey) {
      const abs = localPath(ROOT, objectKey);
      return fs.existsSync(abs) ? { size: fs.statSync(abs).size } : null;
    },
    async getStream(objectKey) {
      return fs.createReadStream(localPath(ROOT, objectKey));
    },
    async remove(objectKey) {
      const abs = localPath(ROOT, objectKey);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    },
  };
}

// ---------------------------------------------------------------------------
// Driver: MinIO (S3-compatible)
// ---------------------------------------------------------------------------
function minioDriver() {
  const { Client } = require('minio');
  const bucket = process.env.MINIO_BUCKET || 'nq57-minh-chung';
  const endPoint = process.env.MINIO_ENDPOINT || 'localhost';
  const port = Number(process.env.MINIO_PORT || 9000);
  const useSSL = String(process.env.MINIO_USE_SSL || 'false') === 'true';
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;
  if (!accessKey || !secretKey) throw new Error('Thiếu MINIO_ACCESS_KEY hoặc MINIO_SECRET_KEY');
  const client = new Client({ endPoint, port, useSSL, accessKey, secretKey });

  // Đảm bảo bucket tồn tại. CHỈ nhớ kết quả khi thành công — nếu MinIO chưa sẵn
  // sàng lúc lưu đầu tiên, lần sau vẫn thử lại (không kẹt promise lỗi vĩnh viễn).
  let ready = false;
  const ensureBucket = async () => {
    if (ready) return;
    if (!(await client.bucketExists(bucket))) {
      await client.makeBucket(bucket, process.env.MINIO_REGION || 'us-east-1');
    }
    ready = true;
  };

  return {
    kind: 'minio',
    async save(originalName, buffer, folder = 'minh-chung') {
      await ensureBucket();
      const key = objectKey(folder, originalName);
      await client.putObject(bucket, key, buffer, buffer.length, {
        'Content-Type': 'application/octet-stream',
      });
      return { objectKey: key, size: buffer.length, checksum: sha256(buffer) };
    },
    async stat(objectKey) {
      await ensureBucket();
      return minioStat(client, bucket, objectKey);
    },
    async getStream(objectKey) {
      await ensureBucket();
      return client.getObject(bucket, objectKey);
    },
    async remove(objectKey) {
      await ensureBucket();
      await client.removeObject(bucket, objectKey);
    },
  };
}

const driver = DRIVER === 'minio' ? minioDriver() : localDriver();
console.log('StorageService: driver =', driver.kind);

module.exports = {
  driver: driver.kind,
  save: (...a) => driver.save(...a),
  stat: (...a) => driver.stat(...a),
  getStream: (...a) => driver.getStream(...a),
  remove: (...a) => driver.remove(...a),
  minioStat,
  localPath,
};
