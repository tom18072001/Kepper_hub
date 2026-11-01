// Kepper — bộ đệm kết quả tính MTL (services/mtl-project.js) theo (dự án, phạm vi xem, ngày VN, phiên bản dữ liệu).
// Vô hiệu hoá khi GHI, không dựa TTL: PrismaClient.$extends chặn mọi thao tác ghi vào các bảng ảnh hưởng kết quả
// (và SQL thô không phải SELECT) rồi tăng bộ đếm phiên bản; khoá có phiên bản nên mục cũ không bao giờ được dùng lại.
// Chỉ client đã qua withMtlCache() mới có bộ đệm; client thường (test, script) luôn đọc thẳng CSDL.

// Bảng mà truy vấn ITEM_SELECT / itemVisibleWhere / alertConfigOf đọc (trực tiếp hoặc để xác định quyền xem).
const WATCHED = new Set([
  'WorkItem', 'WorkItemAssignee', 'WorkItemSupporter', 'WorkItemDepartment', 'ChecklistItem', 'ProgressReport',
  'Project', 'ProjectMember', 'WorkflowState', 'User', 'UserPermission', 'Plan',
]);
const WRITE_OPS = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
// Khoá chủ yếu theo (dự án, ngày) vì phạm vi "ALL" dùng chung; chỉ sổ giao việc ASSIGNED mới theo người.
const MAX_ENTRIES = 2000;
// Ghi User chỉ đổi các trường này thì không ảnh hưởng kết quả MTL (vd. đăng nhập ghi lastLoginAt).
const IRRELEVANT_USER_FIELDS = new Set(['lastLoginAt']);
const onlyIrrelevant = (model, args) => model === 'User' && args?.data && typeof args.data === 'object'
  && Object.keys(args.data).length > 0 && Object.keys(args.data).every(k => IRRELEVANT_USER_FIELDS.has(k));
// Lưới an toàn (không phải cơ chế chính): giao dịch tương tác ghi trước khi commit có thể để lọt một lần đọc cũ vào bộ đệm.
const SAFETY_MS = 20000;

function createMtlCache({ max = MAX_ENTRIES, safetyMs = SAFETY_MS, now = Date.now } = {}) {
  let version = 0;
  const map = new Map(); // key → { value, at }
  const flights = new Map(); // key → Promise đang tính (single-flight)
  return {
    version: () => version,
    bump() { version++; map.clear(); flights.clear(); },
    flight: key => flights.get(key),
    fly(key, promise) {
      flights.set(key, promise);
      const done = () => { if (flights.get(key) === promise) flights.delete(key); };
      promise.then(done, done);
    },
    key: (v, projectId, scope, day) => `${v}|${projectId}|${day}|${scope}`,
    get(key) {
      const e = map.get(key);
      if (!e) return undefined;
      if (now() - e.at > safetyMs) { map.delete(key); return undefined; }
      map.delete(key); map.set(key, e); // LRU: đưa lên cuối
      return e.value;
    },
    set(key, value) {
      map.set(key, { value, at: now() });
      while (map.size > max) map.delete(map.keys().next().value);
    },
    get size() { return map.size; },
  };
}

const isReadSql = args => {
  const first = Array.isArray(args) ? args[0] : args;
  const text = Array.isArray(first) ? first.join(' ') : (first && typeof first === 'object' && first.strings ? first.strings.join(' ') : String(first ?? ''));
  return /^\s*(select|show|with\s)/i.test(text) && !/\b(insert|update|delete)\b/i.test(text);
};

// Gắn bộ đệm + bộ chặn ghi vào một PrismaClient; trả client đã mở rộng (dùng thay client gốc).
function withMtlCache(client, cache = createMtlCache()) {
  const extended = client.$extends({
    name: 'mtl-cache',
    client: { $mtlCache() { return cache; } },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!WRITE_OPS.has(operation) || !WATCHED.has(model) || (operation === 'update' || operation === 'updateMany') && onlyIrrelevant(model, args)) return query(args);
          cache.bump(); // trước: đọc xen giữa không còn dùng mục cũ
          try { return await query(args); } finally { cache.bump(); } // sau: kể cả khi lỗi (ghi dở trong giao dịch)
        },
      },
      async $allOperations({ args, query, operation, model }) {
        if (model || !String(operation).startsWith('$')) return query(args); // thao tác model đã xử lý ở $allModels
        // SQL thô ($executeRaw, $executeRawUnsafe, $queryRaw…): không biết bảng nào → coi là ghi trừ khi là SELECT thuần.
        if (isReadSql(args)) return query(args);
        cache.bump();
        try { return await query(args); } finally { cache.bump(); }
      },
    },
  });
  // Giao dịch: ghi bên trong đã bump nhưng chưa commit nên có thể lọt một lần đọc cũ → bump thêm khi giao dịch xong (commit/rollback).
  return new Proxy(extended, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (prop !== '$transaction' || typeof v !== 'function') return v;
      return async (...a) => { try { return await v.apply(target, a); } finally { cache.bump(); } };
    },
  });
}

module.exports = { createMtlCache, withMtlCache, WATCHED, WRITE_OPS };
