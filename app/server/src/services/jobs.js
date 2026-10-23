// Lịch chạy có chạy bù. Máy chạy có thể là PC: tắt đúng giờ thì job chạy bù khi bật lại, trong khung giờ job còn ý nghĩa
// (vd. nhắc nộp báo cáo chỉ đến 17:30). Mỗi job chạy tối đa một lần / ngày; sổ ghi "lần chạy gần nhất" ở AppSetting.
// Lỗi của một job chỉ ghi log + sổ, không làm dừng máy chủ.
const KEY = 'jobs.lastRun';
const H7 = 7 * 3_600_000;
const vnClock = now => { const x = new Date(now.getTime() + H7); return { day: x.toISOString().slice(0, 10), hm: x.toISOString().slice(11, 16), wd: x.getUTCDay() }; };
const ALL = [0, 1, 2, 3, 4, 5, 6];

// Job đến hạn: đúng thứ, đã qua giờ chạy, chưa quá giờ cuối, hôm nay chưa chạy xong.
function dueJobs(jobs, ledger, now) {
  const c = vnClock(now);
  return jobs.filter(j => (j.days || ALL).includes(c.wd) && c.hm >= j.at && c.hm <= (j.until || '23:59') && ledger[j.name]?.day !== c.day);
}

function scheduler(prisma, jobs, { log = console } = {}) {
  let busy = false;
  const read = async () => { const r = await prisma.appSetting.findUnique({ where: { key: KEY } }); return r?.value && typeof r.value === 'object' ? { ...r.value } : {}; };
  const write = value => prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  async function tick(now = new Date()) {
    if (busy) return [];
    busy = true;
    const ran = [];
    try {
      const ledger = await read();
      for (const j of dueJobs(jobs, ledger, now)) {
        const day = vnClock(now).day, startedAt = new Date().toISOString();
        try {
          const result = await j.run(prisma, now);
          ledger[j.name] = { day, at: startedAt, ok: true };
          log.log(JSON.stringify({ level: 'info', msg: j.name, ...(result && typeof result === 'object' && !Array.isArray(result) ? result : {}) }));
        } catch (error) {
          // Ghi ngày để không lặp mỗi phút; lỗi hiện ở sổ (ok: false) và log — quản trị xem, chạy lại tay nếu cần.
          ledger[j.name] = { day, at: startedAt, ok: false, error: String(error?.message || error).slice(0, 300) };
          log.error(JSON.stringify({ level: 'error', msg: j.name + '_failed', error: error?.message }));
        }
        ran.push(j.name);
        await write(ledger);
      }
    } catch (error) {
      log.error(JSON.stringify({ level: 'error', msg: 'scheduler_failed', error: error?.message }));
    } finally { busy = false; }
    return ran;
  }
  return { tick, read };
}

module.exports = { KEY, vnClock, dueJobs, scheduler };
