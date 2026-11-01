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
const MAX_ENTRIES = 600;
// Lưới an toàn (không phải cơ chế chính): giao dịch tương tác ghi trước khi commit có thể để lọt một lần đọc cũ vào bộ đệm.
const SAFETY_MS = 20000;

function createMtlCache({ max = MAX_ENTRIES, safetyMs = SAFETY_MS, now = Date.now } = {}) {
  let version = 0;
  const map = new Map(); // key → { value, at }
  return {
    version: () => version,
    bump() { version++; map.clear(); },
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
  return client.$extends({
    name: 'mtl-cache',
    client: { $mtlCache() { return cache; } },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!WRITE_OPS.has(operation) || !WATCHED.has(model)) return query(args);
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
}

module.exports = { createMtlCache, withMtlCache, WATCHED, WRITE_OPS };
