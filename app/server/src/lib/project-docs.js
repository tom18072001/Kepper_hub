// Tài liệu dự án — duyệt CHỈ ĐỌC thư mục dự án trên kho file (NAS_ROOT, xem lib/nas.js) và quyền xem tài liệu dự án.
// Thư mục dự án = thư mục IT tạo sẵn trong NAS_ROOT, tên = KEY hoặc "KEY-…". Hub không tạo / sửa / xoá gì ở đây.
// An toàn đường dẫn: chỉ nhận đường dẫn tương đối nằm TRONG thư mục dự án — chặn "..", ổ đĩa, ký tự NUL và
// liên kết tượng trưng (symlink / junction phía máy ảo) trỏ ra ngoài (so realpath).
// NAS là share CIFS (mount soft): MỌI thao tác đĩa ở đây là bất đồng bộ (fs.promises) — không khoá event loop khi máy chủ file chậm.
// Nhưng thao tác fs bất đồng bộ chạy trên threadpool libuv (UV_THREADPOOL_SIZE, mặc định 4 — dùng chung với zlib của compression,
// crypto…) và KHÔNG huỷ được: thao tác kẹt trên CIFS giữ luồng tới khi kernel trả lỗi. Vì vậy mọi thao tác fs trên NAS đi qua
// một CỔNG TOÀN CỤC (op): tối đa cfg.maxInflight thao tác cùng lúc cho cả máy chủ (mọi request); chỗ chỉ nhả khi thao tác fs THẬT SỰ
// kết thúc (không nhả lúc hết hạn chờ) → số luồng có thể bị NAS giữ luôn ≤ maxInflight < UV_THREADPOOL_SIZE (docker-compose: 16).
// Hạn chờ (cfg.timeoutMs) tính cả thời gian xếp hàng lấy chỗ. Hết hạn chờ → CẦU DAO mở cfg.breakerMs: mọi thao tác NAS mới trả 503
// ngay, không phát thêm thao tác xuống kho đang treo.
// Lỗi: không tìm thấy (ENOENT / ENOTDIR) → 404; kho không truy cập được (EIO, EHOSTDOWN, ETIMEDOUT, hết hạn chờ, cầu dao…) → 503.
const path = require('path');
const { Readable } = require('stream');
const nas = require('./nas');
const { isItAdmin, isBoard } = require('./permissions');

const fsp = { ...require('fs').promises }; // bản sao: test thay readdir / stat… để giả lập NAS lỗi / chậm
// Cấu hình cổng (test đổi trực tiếp). maxInflight phải nhỏ hơn UV_THREADPOOL_SIZE để luôn còn luồng cho zlib / fs khác.
const cfg = {
  timeoutMs: Number(process.env.NAS_OP_TIMEOUT_MS) || 8000,
  maxInflight: Number(process.env.NAS_MAX_INFLIGHT) || 4,
  breakerMs: Number(process.env.NAS_BREAKER_MS) || 30000,
};
const LIST_CONCURRENCY = 8; // số việc một lần liệt kê xếp vào cổng; số thao tác fs thật chạy cùng lúc do cổng giới hạn

// Quyền xem tài liệu dự án (chủ dự án quyết 24/11/2026): chỉ thành viên dự án và Ban Tổng Giám đốc (vai). Người đứng tên dự án tính như thành viên.
// Quản trị IT không đọc nội dung nghiệp vụ.
function canViewDocs(user, project, member) {
  if (!user || !project || project.deletedAt || isItAdmin(user)) return false;
  return isBoard(user) || !!member || (project.leadId != null && project.leadId === user.id);
}

// Tệp hệ thống / tạm của Windows, Synology, macOS — không hiện.
const HIDDEN = /^(\.|~\$|@eaDir$|#recycle$|#snapshot$|Thumbs\.db$|desktop\.ini$|\$RECYCLE\.BIN$|System Volume Information$)/i;
const hidden = name => HIDDEN.test(name);

const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const bad = (msg = 'Đường dẫn thư mục không hợp lệ') => err(400, 'INVALID_PATH', msg);
const NOT_FOUND = new Set(['ENOENT', 'ENOTDIR']);
// Lỗi đĩa → lỗi HTTP: không có → 404; còn lại (mạng, I/O, hết hạn chờ, quyền share) → 503 để IT biết là kho lỗi, không phải thư mục bị xoá.
function nasError(e) {
  if (e?.status) return e;
  if (NOT_FOUND.has(e?.code)) return err(404, 'NOT_FOUND', 'Không tìm thấy thư mục / tệp');
  if (e?.code === 'NAS_TRIPPED') return err(503, 'NAS_UNAVAILABLE', 'Kho file đang không truy cập được (vừa bị treo, tạm ngắt ít giây) — thử lại sau hoặc báo IT');
  return err(503, 'NAS_UNAVAILABLE', `Kho file đang không truy cập được (${e?.code || 'lỗi kết nối'}) — thử lại sau hoặc báo IT`);
}
// --- Cổng toàn cục cho thao tác fs trên NAS ---
let inflight = 0, openUntil = 0;
const queue = []; // { run, fail } chờ chỗ
const tripped = () => Date.now() < openUntil;
const trippedErr = () => Object.assign(new Error('NAS tạm ngắt'), { code: 'NAS_TRIPPED' });
function pump() { while (inflight < cfg.maxInflight && queue.length) { inflight++; queue.shift().run(); } }
function trip() {
  openUntil = Date.now() + cfg.breakerMs;
  for (const w of queue.splice(0)) w.fail(trippedErr()); // người đang xếp hàng nhận 503 ngay, không chờ hết hạn
}
// Chạy một thao tác fs (start() → promise) qua cổng, có hạn chờ (CIFS soft có thể treo tới echo_interval).
// opts.trip = false: hết hạn do ngân sách của người gọi (tìm kiếm) chứ không phải NAS treo → không mở cầu dao.
// opts.force = true: chạy cả khi cầu dao mở (đóng file handle — không để rò).
function op(start, { ms = cfg.timeoutMs, trip: canTrip = true, force = false } = {}) {
  if (!force && tripped()) return Promise.reject(trippedErr());
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
    const w = {
      run() {
        let p;
        try { p = Promise.resolve(start()); } catch (e) { p = Promise.reject(e); }
        // Chỗ chỉ nhả khi thao tác fs thật sự xong (kể cả khi người gọi đã nhận hết hạn chờ).
        p.then(v => finish(resolve, v), e => finish(reject, e)).finally(() => { inflight--; pump(); });
      },
      fail: e => finish(reject, e),
    };
    const timer = setTimeout(() => {
      if (done) return;
      const i = queue.indexOf(w);
      if (i >= 0) queue.splice(i, 1);
      finish(reject, Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
      if (canTrip) trip();
    }, ms);
    if (inflight < cfg.maxInflight && !queue.length) { inflight++; w.run(); } else queue.push(w);
  });
}
const gateStats = () => ({ inflight, queued: queue.length, tripped: tripped() });
const resetGate = () => { openUntil = 0; };
// map có giới hạn song song.
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => { while (next < list.length) { const i = next++; out[i] = await fn(list[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

// Chuẩn hoá đường dẫn tương đối người dùng gửi lên: "a/b", "a\\b", "/a/b/" → "a/b". Từ chối "..", ".", NUL, ổ đĩa, phần tử ẩn.
// Đường dẫn tuyệt đối ("/etc/x", "C:/x") không bao giờ ra ngoài: "/" đầu bị bỏ, ổ đĩa bị từ chối.
function cleanRel(rel) {
  const s = String(rel ?? '');
  if (s.length > 1000 || s.includes('\0')) throw bad();
  const parts = s.split(/[\\/]+/).filter(Boolean);
  for (const p of parts) if (p === '..' || p === '.' || /^[A-Za-z]:$/.test(p) || hidden(p)) throw bad();
  return parts.join('/');
}

// Tên các thư mục ở gốc NAS — đọc MỘT lần cho cả danh sách dự án. null = chưa cấu hình NAS_ROOT. Lỗi kết nối → ném 503.
async function rootFolders() {
  const R = nas.root();
  if (!R) return null;
  try { return (await op(() => fsp.readdir(R, { withFileTypes: true }))).filter(d => d.isDirectory()).map(d => d.name); }
  catch (e) { if (NOT_FOUND.has(e.code)) return null; throw nasError(e); }
}
// Thư mục dự án trong danh sách tên ở gốc: tên = KEY hoặc bắt đầu bằng "KEY-" (như nas.projectFolder).
function folderFor(names, key) {
  const k = String(key || '').toUpperCase();
  return (names || []).find(n => n.toUpperCase() === k || n.toUpperCase().startsWith(k + '-')) || null;
}
// Thư mục dự án (tuyệt đối, realpath) hoặc null khi chưa bật kho / dự án chưa có thư mục. NAS lỗi → 503.
async function projectRoot(projectKey, names = undefined) {
  const list = names === undefined ? await rootFolders() : names;
  const folder = folderFor(list, projectKey);
  if (!folder) return null;
  try { return { folder, abs: await op(() => fsp.realpath(path.join(nas.root(), folder))) }; }
  catch (e) { if (NOT_FOUND.has(e.code)) return null; throw nasError(e); }
}

const insideOf = base => p => { const r = path.relative(base, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
// Đường dẫn tuyệt đối của rel trong thư mục dự án; ném lỗi nếu ra ngoài (kể cả qua symlink), không tồn tại (404) hoặc NAS lỗi (503).
async function resolveIn(base, rel) {
  const clean = cleanRel(rel);
  const inside = insideOf(base);
  const abs = path.resolve(base, clean);
  if (!inside(abs)) throw bad();
  let real;
  try { real = await op(() => fsp.realpath(abs)); } catch (e) { throw nasError(e); }
  if (!inside(real)) throw bad();
  return { abs: real, rel: clean };
}
async function statOf(abs) { try { return await op(() => fsp.stat(abs)); } catch (e) { throw nasError(e); } }

// Liệt kê một thư mục: thư mục trước, tệp sau, theo tên (tiếng Việt, số tự nhiên). Bỏ qua mục symlink ra ngoài / không đọc được;
// NAS mất kết nối giữa chừng → 503.
async function listDir(base, rel, { concurrency = LIST_CONCURRENCY } = {}) {
  const { abs, rel: clean } = await resolveIn(base, rel);
  if (!(await statOf(abs)).isDirectory()) throw bad('Không phải thư mục');
  let dirents;
  try { dirents = await op(() => fsp.readdir(abs, { withFileTypes: true })); } catch (e) { throw nasError(e); }
  const inside = insideOf(base);
  const rows = await mapLimit(dirents.filter(d => !hidden(d.name)), concurrency, async d => {
    const childRel = clean ? `${clean}/${d.name}` : d.name;
    try {
      const real = await op(() => fsp.realpath(path.join(abs, d.name)));
      if (!inside(real)) return null; // symlink ra ngoài thư mục dự án: bỏ qua
      const st = await op(() => fsp.stat(real));
      if (st.isDirectory()) return { name: d.name, path: childRel, dir: true, mtime: st.mtime };
      if (st.isFile()) return { name: d.name, path: childRel, dir: false, size: st.size, mtime: st.mtime };
      return null;
    } catch (e) {
      if (NOT_FOUND.has(e.code) || e.code === 'EACCES' || e.code === 'EPERM' || e.code === 'ELOOP') return null; // liên kết hỏng, không có quyền
      throw nasError(e);
    }
  });
  const coll = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
  const out = rows.filter(Boolean).sort((a, b) => (a.dir === b.dir ? coll.compare(a.name, b.name) : a.dir ? -1 : 1));
  return { path: clean, entries: out };
}

// "Hồ sơ" khớp "ho-so", "HO_SO", "ho.so": bỏ dấu, chữ thường, coi - _ . và khoảng trắng là một.
const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[\s\-_.]+/g, ' ');
// Tìm tệp / thư mục theo tên trong cả cây thư mục dự án (duyệt theo tầng, không đi theo symlink). Dừng khi đủ `limit` kết quả,
// đã xem `maxVisited` mục, quá `maxDepth` tầng hoặc hết ngân sách `budgetMs` → truncated: true (kết quả có tới lúc đó vẫn trả về).
async function search(base, q, { limit = 200, maxVisited = 20000, maxDepth = 12, budgetMs = 3000, concurrency = 4 } = {}) {
  const needle = fold(q).trim();
  const hits = [];
  if (!needle) return { entries: hits, truncated: false };
  const deadline = Date.now() + budgetMs;
  let visited = 0, truncated = false, level = [{ abs: base, rel: '' }];
  const stop = () => hits.length >= limit || visited >= maxVisited || Date.now() >= deadline;
  for (let depth = 0; level.length && depth <= maxDepth; depth++) {
    const nextLevel = [];
    await mapLimit(level, concurrency, async dir => {
      if (stop()) { truncated = true; return; }
      let list;
      const ms = Math.max(1, Math.min(cfg.timeoutMs, deadline - Date.now()));
      try { list = await op(() => fsp.readdir(dir.abs, { withFileTypes: true }), { ms, trip: ms >= cfg.timeoutMs }); }
      catch (e) {
        if (e.code === 'ETIMEDOUT' && (ms < cfg.timeoutMs || Date.now() >= deadline)) { truncated = true; return; } // hết ngân sách (bộ hẹn giờ có thể nổ sớm vài ms)
        if (dir.rel === '' || e.code === 'NAS_TRIPPED' || e.code === 'ETIMEDOUT') throw nasError(e); // kho treo → 503
        return; // thư mục con không đọc được (quyền, vừa bị xoá): bỏ qua
      }
      for (const d of list) {
        if (stop()) { truncated = true; return; }
        visited++;
        if (hidden(d.name) || d.isSymbolicLink()) continue;
        const childRel = dir.rel ? `${dir.rel}/${d.name}` : d.name;
        const childAbs = path.join(dir.abs, d.name);
        if (fold(d.name).includes(needle)) hits.push({ name: d.name, path: childRel, dir: d.isDirectory(), abs: childAbs });
        if (d.isDirectory()) nextLevel.push({ abs: childAbs, rel: childRel });
      }
    });
    if (truncated) break;
    level = nextLevel;
    if (level.length && depth === maxDepth) truncated = true;
  }
  // Kích thước / ngày sửa chỉ cho kết quả (không stat mọi mục đã duyệt).
  const coll = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
  hits.sort((a, b) => coll.compare(a.path, b.path)); // duyệt song song: sắp lại cho ổn định
  const entries = (await mapLimit(hits.slice(0, limit), LIST_CONCURRENCY, async h => {
    try { const st = await op(() => fsp.stat(h.abs)); return { name: h.name, path: h.path, dir: h.dir, size: h.dir ? undefined : st.size, mtime: st.mtime }; }
    catch { return { name: h.name, path: h.path, dir: h.dir }; }
  }));
  return { entries, truncated };
}

// Mở một tệp trên NAS để tải: mở + stat TRƯỚC khi gửi header (lỗi → 404 / 503 đúng), rồi đọc từng khối qua cổng
// (fs.createReadStream đi thẳng threadpool, không qua cổng). Đóng file handle khi xong / lỗi / người dùng ngắt.
const CHUNK = 256 * 1024;
const closeQuietly = fh => op(() => fh.close(), { force: true, trip: false }).catch(() => {});
async function openRead(abs) {
  let fh, st;
  try { fh = await op(() => fsp.open(abs, 'r')); } catch (e) { throw nasError(e); }
  try { st = await op(() => fh.stat()); } catch (e) { closeQuietly(fh); throw nasError(e); }
  if (!st.isFile()) { closeQuietly(fh); throw bad('Không phải tệp'); }
  let pos = 0;
  const stream = new Readable({
    highWaterMark: CHUNK,
    read() {
      const buf = Buffer.allocUnsafe(CHUNK);
      op(() => fh.read(buf, 0, CHUNK, pos)).then(({ bytesRead }) => { pos += bytesRead; this.push(bytesRead ? buf.subarray(0, bytesRead) : null); },
        e => this.destroy(nasError(e)));
    },
    destroy(e, cb) { closeQuietly(fh).then(() => cb(e)); },
  });
  return { stream, size: st.size };
}

module.exports = { canViewDocs, isBoard, openRead, cfg, gateStats, resetGate, op, hidden, cleanRel, nasError, rootFolders, folderFor, projectRoot, resolveIn, statOf, listDir, search, fold, mapLimit, fsp };
