// Kết nối Claude: mỗi người tự tạo token cá nhân để Claude Desktop (tài khoản Claude Team của công ty) làm việc với Kepper
// qua MCP chạy trên máy mình. Claude dùng ĐÚNG quyền tài khoản Kepper này — không hơn.
import { api } from '../api.js';
import { $, esc, fmtDateTime, toast, errorMessage, confirmDialog } from '../util.js';

export async function renderClaude(root, setCrumbs) {
  setCrumbs('Kết nối Claude');
  const tokens = await api('/api/me/tokens');
  const origin = location.origin;
  root.innerHTML = `<div class="page-head"><h1>Kết nối Claude</h1></div>
    <section class="card" style="padding:16px;margin-bottom:14px">
      <p><b>Claude làm việc với Kepper bằng chính quyền của bạn.</b> Claude chỉ xem được những gì bạn xem được, sửa được những gì bạn sửa được.
      Các bước <b>nộp báo cáo, phê duyệt, phát hành, xoá, xuất tệp</b> bạn vẫn tự làm trên Kepper.</p>
      <ol class="sm" style="line-height:1.7">
        <li>Tải <a href="/downloads/kepper-claude.mcpb" download data-testid="claude-mcpb">tiện ích Kepper cho Claude Desktop (kepper-claude.mcpb)</a>, mở Claude Desktop → kéo thả tệp vào cửa sổ (hoặc Settings → Extensions → Install Extension).</li>
        <li>Tạo token bên dưới, dán vào ô <b>Token Kepper</b>; ô <b>Địa chỉ Kepper</b> điền <code>${esc(origin)}</code>.</li>
        <li>Hỏi Claude, ví dụ: "Việc nào của tôi trễ hạn tuần này?", "Đánh dấu xong mục checklist hồ sơ PCCC", "Soạn nháp báo cáo tuần của ban".</li>
      </ol>
      <p class="muted sm">Token lưu mã hoá trong Windows Credential Manager / macOS Keychain. Mất máy hoặc nghi lộ: thu hồi ngay tại đây. Đổi mật khẩu cũng làm mọi token mất hiệu lực.</p>
    </section>
    <section class="card" style="padding:16px;margin-bottom:14px">
      <h2 style="margin-top:0">Tạo token</h2>
      <form id="tkForm" class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
        <label>Tên (máy / mục đích)<input id="tkName" maxlength="60" required placeholder="Laptop văn phòng" data-testid="claude-token-name"></label>
        <label>Quyền<select id="tkScope" data-testid="claude-token-scope"><option value="write">Đọc và cập nhật</option><option value="read">Chỉ đọc</option></select></label>
        <label>Hiệu lực<select id="tkDays"><option value="30">30 ngày</option><option value="60">60 ngày</option><option value="90">90 ngày</option></select></label>
        <button class="btn btn-primary" data-testid="claude-token-create">Tạo token</button>
      </form>
      <div id="tkNew" hidden class="card" style="margin-top:12px;padding:12px;border:1px solid var(--warn, #c90)">
        <b>Sao chép token ngay — Kepper không hiện lại.</b>
        <div class="row" style="gap:8px;margin-top:6px"><input id="tkValue" readonly style="flex:1;font-family:monospace" data-testid="claude-token-value"><button class="btn" type="button" id="tkCopy">Sao chép</button></div>
      </div>
    </section>
    <section class="card" style="padding:16px">
      <h2 style="margin-top:0">Token của tôi</h2>
      <table class="table" data-testid="claude-tokens"><thead><tr><th>Tên</th><th>Mã đầu</th><th>Quyền</th><th>Hết hạn</th><th>Dùng gần nhất</th><th></th></tr></thead><tbody>
      ${tokens.map(t => `<tr${t.active ? '' : ' class="muted"'}><td>${esc(t.name)}</td><td><code>${esc(t.prefix)}…</code></td><td>${t.scopes.includes('write') ? 'Đọc và cập nhật' : 'Chỉ đọc'}</td>
        <td>${t.revokedAt ? 'Đã thu hồi' : esc(fmtDateTime(t.expiresAt))}</td><td>${t.lastUsedAt ? esc(fmtDateTime(t.lastUsedAt)) : '—'}</td>
        <td>${t.active ? `<button class="btn btn-ghost btn-sm" data-revoke="${t.id}">Thu hồi</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Chưa có token.</td></tr>'}
      </tbody></table>
    </section>`;
  $('#tkForm', root).onsubmit = async e => {
    e.preventDefault();
    try {
      const scope = $('#tkScope', root).value;
      const t = await api('/api/me/tokens', { method: 'POST', body: { name: $('#tkName', root).value, scopes: scope === 'write' ? ['read', 'write'] : ['read'], days: Number($('#tkDays', root).value) } });
      await renderClaude(root, setCrumbs);
      $('#tkNew', root).hidden = false; $('#tkValue', root).value = t.token; $('#tkValue', root).select();
      $('#tkCopy', root).onclick = () => navigator.clipboard.writeText(t.token).then(() => toast('Đã sao chép token', 'ok'), () => toast('Bôi đen và nhấn Ctrl+C', 'err'));
    } catch (error) { toast(errorMessage(error), 'err'); }
  };
  root.onclick = async e => {
    const b = e.target.closest('[data-revoke]');
    if (!b) return;
    if (!(await confirmDialog('Thu hồi token này? Claude trên máy dùng token này sẽ không truy cập Kepper được nữa.', { okText: 'Thu hồi', danger: true }))) return;
    try { await api(`/api/me/tokens/${b.dataset.revoke}`, { method: 'DELETE' }); toast('Đã thu hồi', 'ok'); await renderClaude(root, setCrumbs); } catch (error) { toast(errorMessage(error), 'err'); }
  };
}
