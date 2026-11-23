// Tài liệu dự án — duyệt CHỈ ĐỌC thư mục dự án trên kho file (NAS_ROOT, xem lib/nas.js) và quyền xem tài liệu dự án.
// Thư mục dự án = thư mục IT tạo sẵn trong NAS_ROOT, tên = KEY hoặc "KEY-…" (nas.projectFolder). Hub không tạo / sửa / xoá gì ở đây.
// An toàn đường dẫn: chỉ nhận đường dẫn tương đối nằm TRONG thư mục dự án — chặn "..", đường dẫn tuyệt đối, ký tự NUL và
// liên kết tượng trưng (symlink / junction) trỏ ra ngoài (so realpath).
const fs = require('fs');
const path = require('path');
const nas = require('./nas');
const { isItAdmin } = require('./permissions');

// Quyền xem tài liệu dự án (chủ dự án quyết 24/11/2026): chỉ thành viên dự án và Ban Giám đốc. Trưởng dự án tính như thành viên.
// Quản trị IT không đọc nội dung nghiệp vụ.
function canViewDocs(user, project, member) {
  if (!user || !project || project.deletedAt || isItAdmin(user)) return false;
  return user.role === 'director' || !!member || (project.leadId != null && project.leadId === user.id);
}

// Tệp hệ thống / tạm của Windows, Synology, macOS — không hiện.
const HIDDEN = /^(\.|~\$|@eaDir$|#recycle$|#snapshot$|Thumbs\.db$|desktop\.ini$|\$RECYCLE\.BIN$|System Volume Information$)/i;
const hidden = name => HIDDEN.test(name);

function bad(msg = 'Đường dẫn thư mục không hợp lệ') { const e = new Error(msg); e.status = 400; e.code = 'INVALID_PATH'; return e; }

// Chuẩn hoá đường dẫn tương đối người dùng gửi lên: "a/b", "a\\b", "/a/b/" → "a/b". Từ chối "..", ".", NUL, ổ đĩa, phần tử ẩn.
function cleanRel(rel) {
  const s = String(rel ?? '');
  if (s.length > 1000 || s.includes('\0')) throw bad();
  const parts = s.split(/[\\/]+/).filter(Boolean);
  for (const p of parts) if (p === '..' || p === '.' || /^[A-Za-z]:$/.test(p) || hidden(p)) throw bad();
  return parts.join('/');
}

// Thư mục dự án (tuyệt đối, realpath) hoặc null khi chưa bật kho / dự án chưa có thư mục.
function projectRoot(projectKey) {
  const folder = nas.projectFolder(projectKey);
  if (!folder) return null;
  try { return { folder, abs: fs.realpathSync(path.join(nas.root(), folder)) }; } catch { return null; }
}

// Đường dẫn tuyệt đối của rel trong thư mục dự án; ném lỗi nếu ra ngoài (kể cả qua symlink) hoặc không tồn tại.
function resolveIn(base, rel) {
  const clean = cleanRel(rel);
  const abs = path.resolve(base, clean);
  const inside = p => { const r = path.relative(base, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
  if (!inside(abs)) throw bad();
  let real;
  try { real = fs.realpathSync(abs); } catch { const e = new Error('Không tìm thấy thư mục / tệp'); e.status = 404; e.code = 'NOT_FOUND'; throw e; }
  if (!inside(real)) throw bad();
  return { abs: real, rel: clean };
}

// Liệt kê một thư mục: thư mục trước, tệp sau, theo tên (tiếng Việt, số tự nhiên). Không đi theo symlink ra ngoài.
function listDir(base, rel) {
  const { abs, rel: clean } = resolveIn(base, rel);
  if (!fs.statSync(abs).isDirectory()) throw bad('Không phải thư mục');
  const out = [];
  for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
    if (hidden(d.name)) continue;
    const childRel = clean ? `${clean}/${d.name}` : d.name;
    let st;
    try {
      const real = fs.realpathSync(path.join(abs, d.name));
      const r = path.relative(base, real);
      if (r.startsWith('..') || path.isAbsolute(r)) continue; // symlink ra ngoài thư mục dự án: bỏ qua
      st = fs.statSync(real);
    } catch { continue; } // không đọc được (quyền, liên kết hỏng)
    if (st.isDirectory()) out.push({ name: d.name, path: childRel, dir: true, mtime: st.mtime });
    else if (st.isFile()) out.push({ name: d.name, path: childRel, dir: false, size: st.size, mtime: st.mtime });
  }
  const coll = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
  out.sort((a, b) => (a.dir === b.dir ? coll.compare(a.name, b.name) : a.dir ? -1 : 1));
  return { path: clean, entries: out };
}

// Tìm tệp / thư mục theo tên (không dấu, không phân biệt hoa thường) trong cả cây thư mục dự án — có giới hạn để không quét quá lâu.
// "Hồ sơ" khớp "ho-so", "HO_SO", "ho.so": bỏ dấu, chữ thường, coi - _ . và khoảng trắng là một.
const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[\s\-_.]+/g, ' ');
function search(base, q, { limit = 200, maxVisited = 20000, maxDepth = 12 } = {}) {
  const needle = fold(q).trim();
  const hits = [];
  let visited = 0, truncated = false;
  const walk = (abs, rel, depth) => {
    if (hits.length >= limit || visited >= maxVisited) { truncated = true; return; }
    let list;
    try { list = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const d of list) {
      if (hits.length >= limit || ++visited > maxVisited) { truncated = true; return; }
      if (hidden(d.name) || d.isSymbolicLink()) continue; // tìm kiếm không đi theo symlink
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      const childAbs = path.join(abs, d.name);
      if (fold(d.name).includes(needle)) {
        try { const st = fs.statSync(childAbs); hits.push({ name: d.name, path: childRel, dir: st.isDirectory(), size: st.isFile() ? st.size : undefined, mtime: st.mtime }); } catch { /* bỏ qua */ }
      }
      if (d.isDirectory() && depth < maxDepth) walk(childAbs, childRel, depth + 1);
    }
  };
  if (needle) walk(base, '', 0);
  return { entries: hits, truncated };
}

module.exports = { canViewDocs, hidden, cleanRel, projectRoot, resolveIn, listDir, search, fold };
