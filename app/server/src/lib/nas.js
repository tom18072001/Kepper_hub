// Kho file dự án (NAS / máy chủ file, mount vào container tại NAS_ROOT) là BẢN GỐC của tệp đính kèm.
// Hub chỉ giữ đường dẫn + metadata. Quy ước (tài liệu "Đề xuất phương án liên thông Kepler Hub – NAS"):
//   <NAS_ROOT>/<KEY>-<TênNgắn>/<KEY>-<số hạng mục>_<ten-hang-muc>/<MãViệc>_<BộPhận>_<MôTả>_v<NN>_<YYYYMMDD>.<đuôi>
// - Chỉ dự án ĐÃ có thư mục trong NAS_ROOT (tên = KEY hoặc bắt đầu bằng "KEY-") mới lưu vào kho; còn lại giữ cách lưu cũ.
// - Không bao giờ ghi đè: mỗi lần tải lên là một phiên bản _vNN mới.
// - Xoá trên Hub không xoá trên kho: tệp được chuyển vào <thư mục dự án>/_LuuTru/.
const fs = require('fs');
const path = require('path');

const PREFIX = 'nas:';
const ROOT = process.env.NAS_ROOT ? path.resolve(process.env.NAS_ROOT) : null;
const enabled = () => !!ROOT && fs.existsSync(ROOT);

// Bỏ dấu tiếng Việt, ghép từ kiểu CamelCase, chỉ giữ chữ / số. "Hợp đồng tư vấn (bản ký)" → "HopDongTuVanBanKy".
function slug(text, max = 40) {
  const plain = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  const words = plain.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.map(w => w[0].toUpperCase() + w.slice(1)).join('').slice(0, max) || 'TaiLieu';
}
const ymd = (d = new Date()) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10).replace(/-/g, ''); // ngày theo giờ VN

function inside(rel) {
  const abs = path.resolve(ROOT, rel);
  const r = path.relative(ROOT, abs);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) { const e = new Error('Đường dẫn kho file không hợp lệ'); e.code = 'INVALID_OBJECT_KEY'; throw e; }
  return abs;
}
const isNasKey = key => String(key || '').startsWith(PREFIX);
const absOf = key => inside(String(key).slice(PREFIX.length));
const dirs = abs => { try { return fs.readdirSync(abs, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; } };

// Thư mục dự án có sẵn trong kho (do IT tạo) — không tự tạo thư mục dự án.
function projectFolder(key) {
  if (!enabled()) return null;
  const k = String(key || '').toUpperCase();
  return dirs(ROOT).find(n => n.toUpperCase() === k || n.toUpperCase().startsWith(k + '-')) || null;
}

// Đường dẫn tương đối cho tệp mới. root: việc gốc của cây (hạng mục MTL); item: việc nhận đính kèm.
function planPath({ projectKey, root, item, deptCode, fileName, date = new Date() }) {
  const proj = projectFolder(projectKey);
  if (!proj) return null;
  const rootCode = `${projectKey}-${root.number}`;
  const existing = dirs(inside(proj)).find(n => n === rootCode || n.startsWith(rootCode + '_'));
  const folder = existing || `${rootCode}_${slug(root.title)}`;
  const ext = path.extname(fileName).toLowerCase().replace(/[^.a-z0-9]/g, '');
  const stem = `${projectKey}-${item.number}_${slug(deptCode || 'CHUNG', 12)}_${slug(path.basename(fileName, path.extname(fileName)))}`;
  let taken = [];
  try { taken = fs.readdirSync(inside(path.join(proj, folder))); } catch { /* thư mục hạng mục chưa có */ }
  const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_v(\\d+)_`, 'i');
  const version = 1 + Math.max(0, ...taken.map(n => Number(re.exec(n)?.[1] || 0)));
  return { rel: path.join(proj, folder, `${stem}_v${String(version).padStart(2, '0')}_${ymd(date)}${ext}`).split(path.sep).join('/'), version };
}

function save(rel, buffer) {
  const abs = inside(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer, { flag: 'wx' }); // không ghi đè
  return PREFIX + rel;
}
// Xoá trên Hub → chuyển vào _LuuTru của dự án (bản gốc không mất).
function archive(key) {
  const abs = absOf(key);
  if (!fs.existsSync(abs)) return;
  const proj = path.relative(ROOT, abs).split(path.sep)[0];
  const dest = path.join(ROOT, proj, '_LuuTru', `${Date.now()}_${path.basename(abs)}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(abs, dest);
}
// Huỷ tệp vừa ghi khi lưu bản ghi thất bại (chưa ai thấy tệp này).
function discard(key) { const abs = absOf(key); if (fs.existsSync(abs)) fs.unlinkSync(abs); }

module.exports = { PREFIX, enabled, isNasKey, absOf, slug, ymd, projectFolder, planPath, save, archive, discard, root: () => ROOT };
