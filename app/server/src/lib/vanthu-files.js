// Tệp văn bản (bản scan, phụ lục) của sổ văn thư — bản gốc lưu trên NAS, trong thư mục văn thư của từng phòng.
// VANTHU_NAS_ROOT = share DATA đã mount vào container (vd. /data/vanthu). Quy ước:
//   <ROOT>/<thư mục phòng>/<NN.VanBanDen | NN.VanBanDi | NN.VanBanNoiBo>/<Năm>/<Số văn bản>_<TênTệp>_v<NN>_<YYYYMMDD>.<đuôi>
// - Thư mục phòng theo VANTHU_DEPT_FOLDERS (mã phòng Hub = đường dẫn thư mục phòng trên NAS, được nhiều tầng,
//   vd. "BTGD=I.KeplerHLD/#1.BOD"). Văn bản chưa gắn bộ phận → VANTHU_DEFAULT_DEPT.
// - Thư mục sổ tìm theo tên "<số>.VanBanDen" … (HCNS đánh số khác các phòng khác). Không có sẵn → không tự tạo, giữ tệp trong Hub.
// - Không ghi đè. Xoá trên Hub → chuyển vào <thư mục sổ>/_LuuTru/, không xoá hẳn.
const fs = require('fs');
const path = require('path');
const { slug, ymd } = require('./nas');

const PREFIX = 'vt:';
const BOOK_DIR = { DEN: 'VanBanDen', DI: 'VanBanDi', NOIBO: 'VanBanNoiBo' };
const DEFAULT_FOLDERS = 'BTGD=#1.BOD,HCNS=#2.HCNS,TCKT=#3.TaiChinh-KeToan,PC=#4.PhongPhapChe,TKKT=#5.PhongThietKe,TH=#6.PhongTongHop,KTXD=#7.PhongKinhTeXayDung,BDT=#9.BanDauTu,PTDA=#11.PhatTrienDuAn';

const root = () => (process.env.VANTHU_NAS_ROOT ? path.resolve(process.env.VANTHU_NAS_ROOT) : null);
const enabled = () => !!root() && fs.existsSync(root());
const deptFolders = () => Object.fromEntries(String(process.env.VANTHU_DEPT_FOLDERS || DEFAULT_FOLDERS).split(',')
  .map(s => s.split('=').map(x => x.trim())).filter(([k, v]) => k && v).map(([k, v]) => [k.toUpperCase(), v]));

function inside(rel) {
  const R = root();
  const abs = path.resolve(R, rel);
  const r = path.relative(R, abs);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) { const e = new Error('Đường dẫn kho văn thư không hợp lệ'); e.code = 'INVALID_OBJECT_KEY'; throw e; }
  return abs;
}
const isKey = key => String(key || '').startsWith(PREFIX);
const absOf = key => inside(String(key).slice(PREFIX.length));
const dirs = abs => { try { return fs.readdirSync(abs, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; } };

// "0001/2026/Đ-HLD" → "0001-2026-D-HLD" (tên tệp không chứa "/", bỏ dấu).
const numberTag = n => String(n).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

// Thư mục sổ trong thư mục phòng: { dept, book } hoặc null khi chưa bật / thiếu thư mục.
function bookFolder(deptCode, book) {
  if (!enabled() || !BOOK_DIR[book]) return null;
  const want = deptFolders()[String(deptCode || process.env.VANTHU_DEFAULT_DEPT || 'HCNS').toUpperCase()];
  if (!want || !fs.existsSync(inside(want))) return null; // không cần quyền liệt kê gốc share
  const re = new RegExp(`^\\d+\\.${BOOK_DIR[book]}$`, 'i');
  const b = dirs(inside(want)).find(n => re.test(n));
  return b ? path.join(want, b) : null;
}

// Đường dẫn tương đối cho tệp mới của văn bản doc ({ book, year, number }); null → lưu trong Hub.
function planPath({ doc, deptCode, fileName, date = new Date() }) {
  const base = bookFolder(deptCode, doc.book);
  if (!base) return null;
  const folder = path.join(base, String(doc.year));
  const ext = path.extname(fileName).toLowerCase().replace(/[^.a-z0-9]/g, '');
  const stem = `${numberTag(doc.number)}_${slug(path.basename(fileName, path.extname(fileName)))}`;
  let taken = [];
  try { taken = fs.readdirSync(inside(folder)); } catch { /* thư mục năm chưa có */ }
  const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_v(\\d+)_`, 'i');
  const version = 1 + Math.max(0, ...taken.map(n => Number(re.exec(n)?.[1] || 0)));
  return { rel: path.join(folder, `${stem}_v${String(version).padStart(2, '0')}_${ymd(date)}${ext}`).split(path.sep).join('/'), version };
}

function save(rel, buffer) {
  const abs = inside(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer, { flag: 'wx' }); // không ghi đè
  return PREFIX + rel;
}
// Xoá trên Hub → <thư mục phòng>/<NN.VanBan…>/_LuuTru/ (bản gốc không mất). Thư mục phòng có thể nhiều tầng
// ("I.KeplerHLD/#1.BOD"), nên tìm thư mục sổ theo TÊN, không theo vị trí; không thấy thư mục sổ → _LuuTru cạnh tệp.
const BOOK_RE = new RegExp(`^\\d+\\.(?:${Object.values(BOOK_DIR).join('|')})$`, 'i');
function archive(key) {
  const abs = absOf(key);
  if (!fs.existsSync(abs)) return;
  const folders = path.relative(root(), abs).split(path.sep).slice(0, -1);
  const i = folders.findLastIndex(n => BOOK_RE.test(n));
  const dest = path.join(root(), ...(i >= 0 ? folders.slice(0, i + 1) : folders), '_LuuTru', `${Date.now()}_${path.basename(abs)}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(abs, dest);
}
function discard(key) { const abs = absOf(key); if (fs.existsSync(abs)) fs.unlinkSync(abs); }

module.exports = { PREFIX, BOOK_DIR, enabled, isKey, absOf, numberTag, bookFolder, planPath, save, archive, discard, root };
