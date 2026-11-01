// Log thời gian từng bước của một yêu cầu — tắt mặc định, bật bằng KEPPER_STEP_LOG=1 (chỉ để đo hiệu năng).
const ON = process.env.KEPPER_STEP_LOG === '1';
function stepTimer(label) {
  if (!ON) return { step: async (_name, fn) => fn(), finish() {} };
  const t0 = performance.now(), parts = [];
  return {
    async step(name, fn) { const s = performance.now(); try { return await fn(); } finally { parts.push(`${name}=${Math.round(performance.now() - s)}`); } },
    finish(res) { res.on('finish', () => console.log(`[step] ${label} total=${Math.round(performance.now() - t0)} ${parts.join(' ')}`)); },
  };
}
module.exports = { stepTimer };
