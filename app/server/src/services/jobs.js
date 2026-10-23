// Lịch chạy có chạy bù. Máy chạy có thể là PC: tắt đúng giờ thì job chạy bù khi bật lại, trong khung giờ job còn ý nghĩa
// (vd. nhắc nộp báo cáo chỉ đến 17:30). Sổ "lần chạy" ở AppSetting 'jobs.lastRun'.
// - Nhận việc NGUYÊN TỬ: khoá CSDL + ghi "running" TRƯỚC khi chạy → hai tiến trình cùng một CSDL không chạy trùng; tiến trình
//   chết giữa chừng thì không chạy lại trong ngày (job gửi thông báo không gửi đôi) — ops_check báo job treo.
// - Lỗi: thử lại tối đa 3 lần / ngày, cách nhau 20 phút, vẫn trong khung giờ của job. Lỗi không làm dừng máy chủ.
const KEY = 'jobs.lastRun';
const LOCK_ID = 730101;
const MAX_TRIES = 3, RETRY_MS = 20 * 60_000;
const H7 = 7 * 3_600_000;
const vnClock = now => { const x = new Date(now.getTime() + H7); return { day: x.toISOString().slice(0, 10), hm: x.toISOString().slice(11, 16), wd: x.getUTCDay() }; };
const ALL = [0, 1, 2, 3, 4, 5, 6];

// Job đến hạn: đúng thứ, đã qua giờ chạy, chưa quá giờ cuối; hôm nay chưa chạy, hoặc lỗi và còn lượt thử lại.
function dueJobs(jobs, ledger, now) {
  const c = vnClock(now);
  return jobs.filter(j => {
    if (!(j.days || ALL).includes(c.wd) || c.hm < j.at || c.hm > (j.until || '23:59')) return false;
    const l = ledger[j.name];
    if (!l || l.day !== c.day) return true;
    if (l.running) return false;
    return l.ok === false && (l.tries || 1) < MAX_TRIES && now - new Date(l.at) >= RETRY_MS;
  });
}

function scheduler(prisma, jobs, { log = console } = {}) {
  let busy = false;
  const asObj = r => (r?.value && typeof r.value === 'object' ? { ...r.value } : {});
  const read = async (client = prisma) => asObj(await client.appSetting.findUnique({ where: { key: KEY } }));
  const write = (client, value) => client.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  // Trong transaction có khoá tư vấn (nếu CSDL hỗ trợ): đọc sổ → sửa → ghi.
  // try = true: nhận việc (tiến trình khác đang giữ khoá thì bỏ lượt này); false: ghi kết quả (chờ khoá, không bỏ — tránh kẹt "running").
  const locked = (fn, { tryOnly = true } = {}) => (typeof prisma.$transaction === 'function'
    ? prisma.$transaction(async tx => {
      if (!tryOnly) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_ID})`; return fn(tx); }
      const [{ ok }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${LOCK_ID}) AS ok`; return ok ? fn(tx) : null;
    })
    : fn(prisma));
  async function tick(now = new Date()) {
    if (busy) return [];
    busy = true;
    const ran = [];
    try {
      const day = vnClock(now).day;
      const claimed = await locked(async tx => {
        const ledger = await read(tx), list = dueJobs(jobs, ledger, now);
        for (const j of list) {
          const prev = ledger[j.name];
          ledger[j.name] = { day, at: now.toISOString(), running: true, tries: prev?.day === day ? (prev.tries || 1) + 1 : 1 };
        }
        if (list.length) await write(tx, ledger);
        return list.map(j => ({ job: j, tries: ledger[j.name].tries }));
      }) || [];
      for (const { job: j, tries } of claimed) {
        const startedAt = now.toISOString();
        let entry;
        try {
          const result = await j.run(prisma, now);
          entry = { day, at: startedAt, ok: true, tries };
          log.log(JSON.stringify({ level: 'info', msg: j.name, ...(result && typeof result === 'object' && !Array.isArray(result) ? result : {}) }));
        } catch (error) {
          entry = { day, at: startedAt, ok: false, tries, error: String(error?.message || error).slice(0, 300) };
          log.error(JSON.stringify({ level: 'error', msg: j.name + '_failed', tries, error: error?.message }));
        }
        await locked(async tx => { const ledger = await read(tx); ledger[j.name] = entry; await write(tx, ledger); }, { tryOnly: false });
        ran.push(j.name);
      }
    } catch (error) {
      log.error(JSON.stringify({ level: 'error', msg: 'scheduler_failed', error: error?.message }));
    } finally { busy = false; }
    return ran;
  }
  return { tick, read, isBusy: () => busy };
}

module.exports = { KEY, MAX_TRIES, RETRY_MS, vnClock, dueJobs, scheduler };
