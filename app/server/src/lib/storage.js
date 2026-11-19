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
const nas = require('./nas');
const vt = require('./vanthu-files');

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
console.log('StorageService: driver =', driver.kind, nas.enabled() ? `+ kho file dự án (${nas.root()})` : '', vt.enabled() ? `+ kho văn thư (${vt.root()})` : '');

// Khoá "vt:<đường dẫn>" = tệp văn thư trên NAS (lib/vanthu-files.js) — xử lý trước, rồi mới tới "nas:" và driver cũ.
const ofVt = (fn, other) => async key => (vt.isKey(key) ? fn(key) : other(key));
const vtStat = key => (fs.existsSync(vt.absOf(key)) ? { size: fs.statSync(vt.absOf(key)).size } : null);

// Khoá "nas:<đường dẫn>" = tệp nằm trong kho file dự án (bản gốc); còn lại theo driver cũ.
const api = {
  driver: driver.kind,
  save: (...a) => driver.save(...a),
  // Lưu vào kho file dự án theo quy ước tên; null khi dự án chưa có thư mục trong kho (gọi save() như cũ).
  saveToProject(meta, buffer) {
    const plan = nas.planPath(meta);
    if (!plan) return null;
    return { objectKey: nas.save(plan.rel, buffer), size: buffer.length, checksum: sha256(buffer), version: plan.version };
  },
  stat: async key => (nas.isNasKey(key) ? (fs.existsSync(nas.absOf(key)) ? { size: fs.statSync(nas.absOf(key)).size } : null) : driver.stat(key)),
  getStream: async key => (nas.isNasKey(key) ? fs.createReadStream(nas.absOf(key)) : driver.getStream(key)),
  // Xoá trên Hub: tệp trong kho file được chuyển vào _LuuTru, không xoá hẳn.
  remove: async key => (nas.isNasKey(key) ? nas.archive(key) : driver.remove(key)),
  // Vị trí hiển thị cho người dùng: tệp trong kho file → đường dẫn trong kho (mở được qua ổ mạng trong văn phòng / VPN).
  locationOf: key => (nas.isNasKey(key) ? { storedIn: 'NAS', nasPath: String(key).slice(nas.PREFIX.length), version: Number(/_v(\d+)_\d{8}(\.[^./]*)?$/.exec(key)?.[1]) || null } : { storedIn: 'HUB' }),
  // Huỷ tệp vừa ghi khi lưu bản ghi thất bại.
  discard: async key => (nas.isNasKey(key) ? nas.discard(key) : driver.remove(key)),
  minioStat,
  localPath,
};
module.exports = {
  ...api,
  // Lưu vào thư mục văn thư của phòng trên NAS; null khi chưa bật / phòng chưa có thư mục sổ (gọi save() như cũ).
  saveToVanthu(meta, buffer) {
    const plan = vt.planPath(meta);
    if (!plan) return null;
    return { objectKey: vt.save(plan.rel, buffer), size: buffer.length, checksum: sha256(buffer), version: plan.version };
  },
  stat: ofVt(vtStat, api.stat),
  getStream: ofVt(key => fs.createReadStream(vt.absOf(key)), api.getStream),
  remove: ofVt(key => vt.archive(key), api.remove),
  discard: ofVt(key => vt.discard(key), api.discard),
  locationOf: key => (vt.isKey(key) ? { storedIn: 'NAS', nasPath: String(key).slice(vt.PREFIX.length), version: Number(/_v(\d+)_\d{8}(\.[^./]*)?$/.exec(key)?.[1]) || null } : api.locationOf(key)),
};
