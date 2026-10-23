// Kết nối Claude: Claude Desktop (tài khoản Claude Team của công ty) làm việc với Kepper qua tiện ích MCP chạy trên máy mình,
// bằng ĐÚNG quyền tài khoản Kepper này — không hơn.
// Kết nối nhanh: cài tiện ích → hỏi Claude → Kepper mở trang này với mã kết nối → bấm "Cho phép" (không tạo / dán token).
// Token thủ công vẫn giữ cho trường hợp đặc biệt (máy không mở được trình duyệt), thu gọn bên dưới.
import { api } from '../api.js';
import { $, esc, fmtDateTime, toast, errorMessage, confirmDialog } from '../util.js';
import { icon } from '../icons.js';

const CODE_RE = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;

export async function renderClaude(root, setCrumbs, params = new URLSearchParams()) {
  setCrumbs('Kết nối Claude');
  const code = String(params.get('connect') || '').toUpperCase();
  const [tokens, req] = await Promise.all([
    api('/api/me/tokens'),
    CODE_RE.test(code) ? api(`/api/claude/connect/${code}`).catch(error => ({ error: errorMessage(error) })) : null,
  ]);
  const active = tokens.filter(t => t.active);
  const origin = location.origin;

  // Yêu cầu kết nối từ Claude Desktop (mở từ tiện ích).
  const connectCard = !req ? '' : req.error ? `<section class="card cl-req bad" data-testid="claude-connect-gone"><b>Không tìm thấy yêu cầu kết nối.</b> <span class="muted">${esc(req.error)}</span></section>`
    : req.status !== 'pending' ? `<section class="card cl-req" data-testid="claude-connect-done"><b>Yêu cầu ${esc(req.code)} đã được xử lý.</b> Quay lại Claude Desktop và hỏi tiếp.</section>`
    : `<section class="card cl-req" data-testid="claude-connect">
        <div class="cl-req-h">${icon('send')}<div><h2>Claude Desktop xin kết nối với tài khoản của bạn</h2>
          <p class="muted sm">Máy <b>${esc(req.device)}</b> · mã <b class="cl-code">${esc(req.code)}</b> · lúc ${esc(fmtDateTime(req.createdAt))}</p></div></div>
        ${req.sameMachine ? '' : '<p class="warn-text sm">Yêu cầu này đến từ <b>máy khác</b> với máy bạn đang mở Kepper — chỉ bấm "Cho phép" trên chính máy chạy Claude Desktop.</p>'}
        <p class="sm">Claude sẽ xem được những gì bạn xem được; không nộp báo cáo, phê duyệt, xoá, xuất tệp. Kết nối có hiệu lực 30 ngày, thu hồi được bất cứ lúc nào ở danh sách bên dưới.</p>
        <div class="row cl-req-act">
          <label class="check sm"><input type="radio" name="clScope" value="write" checked> Xem và cập nhật (%, checklist, bình luận, nháp báo cáo)</label>
          <label class="check sm"><input type="radio" name="clScope" value="read"> Chỉ xem</label>
        </div>
        <div class="row cl-req-act"><button class="btn btn-primary" data-connect="approve" data-testid="claude-connect-approve">Cho phép</button>
          <button class="btn btn-ghost" data-connect="deny" data-testid="claude-connect-deny">Từ chối</button></div>
      </section>`;

  root.innerHTML = `<div class="page-head"><h1>Kết nối Claude</h1></div>
    ${connectCard}
    <section class="card cl-steps">
      <p><b>Claude làm việc với Kepper bằng chính quyền của bạn.</b> Claude chỉ xem được những gì bạn xem được, sửa được những gì bạn sửa được.
        Các bước <b>nộp báo cáo, phê duyệt, phát hành, xoá, xuất tệp</b> bạn vẫn tự làm trên Kepper.</p>
      <ol class="cl-ol">
        <li><b>Cài tiện ích:</b> tải <a href="/downloads/kepper-claude.mcpb" download data-testid="claude-mcpb">kepper-claude.mcpb</a>, kéo thả vào cửa sổ Claude Desktop → Install.
          Ô <b>Địa chỉ Kepper</b> đã điền sẵn <code>${esc(origin)}</code>; ô Token để trống.</li>
        <li><b>Hỏi Claude</b>, ví dụ: "Việc nào của tôi trễ hạn tuần này?". Lần đầu, Kepper tự mở trên trình duyệt — bấm <b>Cho phép</b>. Xong.</li>
      </ol>
    </section>
    <section class="card cl-list">
      <h2>Máy đã kết nối</h2>
      <table class="table" data-testid="claude-tokens"><thead><tr><th>Máy / tên</th><th>Quyền</th><th>Hết hạn</th><th>Dùng gần nhất</th><th></th></tr></thead><tbody>
      ${tokens.map(t => `<tr${t.active ? '' : ' class="muted"'}><td>${esc(t.name)} <span class="muted xs"><code>${esc(t.prefix)}…</code></span></td><td>${t.scopes.includes('write') ? 'Xem và cập nhật' : 'Chỉ xem'}</td>
        <td>${t.revokedAt ? 'Đã thu hồi' : esc(fmtDateTime(t.expiresAt))}</td><td>${t.lastUsedAt ? esc(fmtDateTime(t.lastUsedAt)) : '—'}</td>
        <td>${t.active ? `<button class="btn btn-ghost btn-sm" data-revoke="${t.id}">Thu hồi</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Chưa có máy nào kết nối.</td></tr>'}
      </tbody></table>
      <p class="muted xs">${active.length}/5 kết nối còn hiệu lực. Mất máy hoặc nghi lộ: thu hồi ngay. Đổi mật khẩu cũng làm mọi kết nối mất hiệu lực.</p>
      <details class="cl-manual" data-testid="claude-manual"><summary>Tạo token thủ công (chỉ khi máy không mở được trình duyệt)</summary>
        <form id="tkForm" class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:10px">
          <label>Tên (máy / mục đích)<input id="tkName" maxlength="60" required placeholder="Laptop văn phòng" data-testid="claude-token-name"></label>
          <label>Quyền<select id="tkScope" data-testid="claude-token-scope"><option value="write">Xem và cập nhật</option><option value="read">Chỉ xem</option></select></label>
          <label>Hiệu lực<select id="tkDays"><option value="30">30 ngày</option><option value="60">60 ngày</option><option value="90">90 ngày</option></select></label>
          <button class="btn btn-primary" data-testid="claude-token-create">Tạo token</button>
        </form>
        <div id="tkNew" hidden class="card" style="margin-top:12px;padding:12px;border:1px solid var(--warn-line)">
          <b>Sao chép token ngay — Kepper không hiện lại.</b> Dán vào ô Token của tiện ích.
          <div class="row" style="gap:8px;margin-top:6px"><input id="tkValue" readonly style="flex:1;font-family:monospace" data-testid="claude-token-value"><button class="btn" type="button" id="tkCopy">Sao chép</button></div>
        </div>
      </details>
    </section>`;

  $('#tkForm', root).onsubmit = async e => {
    e.preventDefault();
    try {
      const scope = $('#tkScope', root).value;
      const t = await api('/api/me/tokens', { method: 'POST', body: { name: $('#tkName', root).value, scopes: scope === 'write' ? ['read', 'write'] : ['read'], days: Number($('#tkDays', root).value) } });
      await renderClaude(root, setCrumbs);
      $('details.cl-manual', root).open = true;
      $('#tkNew', root).hidden = false; $('#tkValue', root).value = t.token; $('#tkValue', root).select();
      $('#tkCopy', root).onclick = () => navigator.clipboard.writeText(t.token).then(() => toast('Đã sao chép token', 'ok'), () => toast('Bôi đen và nhấn Ctrl+C', 'err'));
    } catch (error) { toast(errorMessage(error), 'err'); }
  };
  root.onclick = async e => {
    const c = e.target.closest('[data-connect]');
    if (c) {
      const decision = c.dataset.connect;
      try {
        await api(`/api/claude/connect/${code}/${decision}`, { method: 'POST', body: { scope: root.querySelector('input[name="clScope"]:checked')?.value || 'write' } });
        toast(decision === 'approve' ? 'Đã kết nối — quay lại Claude Desktop và hỏi tiếp' : 'Đã từ chối', 'ok');
        history.replaceState(null, '', '#/claude'); window.dispatchEvent(new Event('workhub:hashreplaced'));
        await renderClaude(root, setCrumbs);
      } catch (error) { toast(errorMessage(error), 'err'); }
      return;
    }
    const b = e.target.closest('[data-revoke]');
    if (!b) return;
    if (!(await confirmDialog('Thu hồi kết nối này? Claude trên máy đó sẽ không truy cập Kepper được nữa (hỏi lại Claude để kết nối lại).', { okText: 'Thu hồi', danger: true }))) return;
    try { await api(`/api/me/tokens/${b.dataset.revoke}`, { method: 'DELETE' }); toast('Đã thu hồi', 'ok'); await renderClaude(root, setCrumbs); } catch (error) { toast(errorMessage(error), 'err'); }
  };
}
