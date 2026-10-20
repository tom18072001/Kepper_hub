// Luồng sự kiện thời gian thực. Trình duyệt mở bằng fetch (gửi header Authorization, không đưa token lên URL).
const bus = require('../services/bus');

const MAX_AGE_MS = 30 * 60_000; // đóng định kỳ để client kết nối lại và xác thực lại phiên

module.exports = function mountRealtime(app, { prisma, auth }) {
  bus.init(prisma);
  app.get('/api/stream', auth, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    const client = bus.add(res, req.user);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    const expire = setTimeout(() => res.end(), MAX_AGE_MS);
    req.on('close', () => { clearInterval(ping); clearTimeout(expire); bus.remove(client); });
  });
};
