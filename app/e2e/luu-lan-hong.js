// Reporter giữ bằng chứng của lần chạy có test hỏng.
// Playwright xoá test-results/ (trace.zip, ảnh, error-context.md) khi BẮT ĐẦU lần chạy sau — kể cả khi chỉ chạy lại một spec để
// xem có hỏng lại không — nên trace của lần chạy toàn bộ bị hỏng thường mất trước khi kịp đọc. Có test hỏng (hoặc lỗi ngoài test,
// vd. máy chủ test không lên) → chép test-results/ sang lan-hong/<thời điểm, giờ VN>/ kèm TOM-TAT.md (test hỏng, lỗi đầu tiên,
// đường dẫn trace); chỉ giữ KEEP lần gần nhất. Đặt CUỐI danh sách reporter (sau json / html: kết quả của chúng đã ghi xong).
const fs = require('node:fs');
const path = require('node:path');

const KEEP = 5;
const stamp = d => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
const firstLine = s => String(s || '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').find(l => l.trim()) || '';
const slash = p => p.replace(/\\/g, '/');

class KeepFailedRun {
  constructor({ dir = path.join(__dirname, 'lan-hong'), keep = KEEP } = {}) {
    this.dir = dir; this.keep = keep; this.failed = []; this.errors = [];
    this.started = new Date(); this.outputDirs = []; this.total = 0; // máy chủ test không lên thì không có onBegin
  }
  printsToStdio() { return false; }
  onError(error) { this.errors.push(firstLine(error?.message || error?.value)); }
  onBegin(config, suite) {
    this.outputDirs = [...new Set(config.projects.map(p => p.outputDir))];
    this.total = suite.allTests().length;
  }
  onTestEnd(test, result) {
    // Ctrl+C: test đang chạy thành "interrupted" — không phải hỏng.
    if (result.status === test.expectedStatus || result.status === 'skipped' || result.status === 'interrupted') return;
    this.failed.push({
      title: test.titlePath().filter(Boolean).slice(1).join(' › '),
      where: `${slash(path.relative(__dirname, test.location.file))}:${test.location.line}`,
      status: result.status, retry: result.retry, error: firstLine(result.error?.message),
      files: result.attachments.filter(a => a.path).map(a => a.path),
    });
  }
  async onEnd(result) {
    if (!this.failed.length && !this.errors.length && result.status !== 'failed' && result.status !== 'timedout') return;
    const dest = path.join(this.dir, stamp(this.started));
    fs.mkdirSync(dest, { recursive: true });
    const copied = new Map(); // thư mục kết quả → bản chép trong dest
    for (const out of this.outputDirs) {
      if (!fs.existsSync(out)) continue;
      const to = path.join(dest, path.basename(out));
      // .playwright-artifacts-*: thư mục làm việc tạm của worker (tài nguyên trace của MỌI context, có thể vài trăm MB khi worker bị
      // dừng giữa chừng) — không phải bằng chứng; trace.zip / ảnh của test hỏng nằm trong thư mục riêng của từng test.
      fs.cpSync(out, to, { recursive: true, filter: src => !path.basename(src).startsWith('.playwright-artifacts') });
      copied.set(out, to);
    }
    // Đường dẫn tệp đính kèm trong bản chép (tương đối với app/e2e), để mở được cả khi test-results/ đã bị lần chạy sau xoá.
    const moved = p => {
      for (const [out, to] of copied) if (!path.relative(out, p).startsWith('..')) return slash(path.relative(__dirname, path.join(to, path.relative(out, p))));
      return slash(p);
    };
    const lines = [`# Lần chạy hỏng ${stamp(this.started)} (giờ VN)`, '',
      `- Kết quả: ${result.status} · ${this.failed.length}/${this.total} test hỏng · ${Math.round((Date.now() - this.started) / 1000)} s`,
      '- Xem trace (chạy trong app/e2e): `npx playwright show-trace <đường dẫn trace.zip bên dưới>`', ''];
    if (this.errors.length) lines.push('## Lỗi ngoài test', ...this.errors.map(e => `- ${e}`), '');
    for (const f of this.failed) {
      lines.push(`## ${f.title}`, `- ${f.where} · ${f.status}${f.retry ? ` · lần thử lại ${f.retry}` : ''}`, `- Lỗi: ${f.error || '—'}`);
      for (const p of f.files) lines.push(`- ${moved(p)}`);
      lines.push('');
    }
    fs.writeFileSync(path.join(dest, 'TOM-TAT.md'), lines.join('\n'));
    // Chỉ giữ KEEP lần gần nhất (tên thư mục theo thời điểm nên sắp theo tên là theo thời gian).
    const runs = fs.readdirSync(this.dir).filter(n => /^\d{4}-\d{2}-\d{2}_/.test(n)).sort();
    for (const old of runs.slice(0, Math.max(0, runs.length - this.keep))) fs.rmSync(path.join(this.dir, old), { recursive: true, force: true });
    console.log(`\nĐã giữ trace / ảnh của lần chạy hỏng: ${slash(path.relative(process.cwd(), dest))} (xem TOM-TAT.md)`);
  }
}
module.exports = KeepFailedRun;
