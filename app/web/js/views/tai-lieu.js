// Tài liệu — kho tài liệu theo dự án, duyệt như thư mục:
//   Tất cả dự án / <Dự án> / { Theo công việc (tệp tải lên Hub: hạng mục → việc → việc nhánh) | Thư mục dự án trên NAS (chỉ đọc) }
// Bộ lọc dự án + tìm theo tên tệp. Văn thư (văn bản đến / đi) và Quy chế, quy định nội bộ là các tab cạnh đây (views/vanthu.js).
// Quyền do máy chủ quyết (routes/documents.js): chỉ thành viên dự án và Ban Tổng Giám đốc thấy tài liệu của dự án.
import { api, download, openPreview } from '../api.js';
import { store } from '../store.js';
import { esc, fmtDate, fmtDateTime, toast, errorMessage, debounce } from '../util.js';
import { icon } from '../icons.js';

const mods = () => store.settings?.modules || [];
// Thanh tab chung của mục "Tài liệu" (dùng cả ở trang Văn thư).
export function docTabs(active) {
  const tabs = [['projects', 'Tài liệu dự án', '#/tai-lieu?tab=du-an']]; // có ?tab: không tự chuyển sang Văn thư (xem renderDocuments)
  if (mods().includes('vanthu')) tabs.push(['vanthu', 'Văn thư', '#/vanthu?book=DEN'], ['noibo', 'Quy chế, quy định nội bộ', '#/vanthu?book=NOIBO']);
  return `<nav class="seg vt-tabs doc-tabs" aria-label="Nhóm tài liệu">${tabs.map(([k, l, h]) => `<a href="${h}" class="${k === active ? 'on' : ''}"${k === active ? ' aria-current="page"' : ''} data-testid="doc-tab-${k}">${esc(l)}</a>`).join('')}</nav>`;
}

const size = n => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[\s\-_.]+/g, ' '); // như lib/project-docs.js
const inlineOk = name => /\.(pdf|png|jpe?g|gif|webp)$/i.test(name);
const link = params => '#/tai-lieu?' + new URLSearchParams(Object.entries({ tab: 'du-an', ...params }).filter(([, v]) => v != null && v !== '')).toString();

let hubCache = null; // { projectId, at, data } — tránh tải lại khi đi sâu trong cây

export async function renderDocuments(root, params, setCrumbs) {
  setCrumbs('Tài liệu');
  const st = { p: Number(params.get('p')) || null, src: ['hub', 'nas'].includes(params.get('src')) ? params.get('src') : '', path: params.get('path') || '', q: params.get('q') || '' };
  const { projects, nasEnabled, nasError } = await api('/api/documents/projects');
  // Mở từ menu (không tham số) mà không thuộc dự án nào — vd. văn thư HCNS: vào thẳng tab Văn thư.
  if (!projects.length && !params.toString() && mods().includes('vanthu')) { location.replace('#/vanthu?book=DEN'); return; }
  const project = projects.find(x => x.id === st.p) || null;
  if (st.p && !project) st.p = null;

  root.innerHTML = `<div class="page-head"><h1>Tài liệu</h1><span class="muted sm">Tài liệu của các dự án: tệp tải lên trong công việc và tệp có sẵn trong thư mục dự án trên kho file (NAS).</span></div>
    ${docTabs('projects')}
    <form class="row pg-filters" id="docFilter" role="search" aria-label="Lọc tài liệu">
      <select name="p" aria-label="Dự án" data-testid="doc-project"><option value="">Tất cả dự án</option>${projects.map(x => `<option value="${x.id}"${x.id === st.p ? ' selected' : ''}>${esc(x.key)} · ${esc(x.name)}${x.archived ? ' (đã đóng)' : ''}</option>`).join('')}</select>
      <input name="q" type="search" value="${esc(st.q)}" class="grow" placeholder="${project ? 'Tìm theo tên tệp trong dự án' : 'Tìm dự án'}" aria-label="Tìm tài liệu" data-testid="doc-q">
    </form>
    <div id="docCrumbs" class="doc-crumbs"></div>
    <div id="docBody" aria-live="polite"><div class="empty">Đang tải…</div></div>`;
  const form = root.querySelector('#docFilter'), body = root.querySelector('#docBody'), crumbsEl = root.querySelector('#docCrumbs');
  form.p.addEventListener('change', () => { location.hash = link({ p: form.p.value }); });
  const search = () => { if (form.isConnected && form.q.value.trim() !== st.q) location.hash = link({ p: st.p, src: st.src, path: st.path, q: form.q.value.trim() }); };
  const typed = debounce(search, 400);
  if (st.q) { form.q.focus(); form.q.setSelectionRange(st.q.length, st.q.length); } // vẽ lại sau khi gõ: giữ con trỏ trong ô tìm
  form.q.addEventListener('input', typed);
  form.addEventListener('submit', e => { e.preventDefault(); search(); });

  const crumbs = list => {
    crumbsEl.innerHTML = `<ol class="doc-path" data-testid="doc-path">${list.map(([label, href], i) => `<li>${i < list.length - 1 ? `<a href="${href}">${esc(label)}</a>` : `<b>${esc(label)}</b>`}</li>`).join('')}</ol>`;
  };
  const table = (rows, empty) => (rows.length
    ? `<div class="tbl-scroll"><table class="table doc-list" data-testid="doc-list"><thead><tr><th>Tên</th><th>Ghi chú</th><th class="num">Kích thước</th><th>Ngày</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
    : `<div class="empty" data-testid="doc-empty">${empty}</div>`);
  const folderRow = (name, href, note = '', testid = '') => `<tr class="clickable doc-dir" data-href="${href}"${testid ? ` data-testid="${testid}"` : ''}><td>${icon('folder')} <a href="${href}">${esc(name)}</a></td><td class="muted sm">${note}</td><td></td><td></td><td></td></tr>`;
  const bindRows = () => body.querySelectorAll('tr[data-href]').forEach(tr => tr.addEventListener('click', e => { if (!e.target.closest('a,button')) location.hash = tr.dataset.href; }));
  body.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const run = { 'hub-dl': () => download(`/api/documents/files/${b.dataset.id}`), 'hub-view': () => openPreview(`/api/documents/files/${b.dataset.id}?inline=1`),
      'nas-dl': () => download(`/api/documents/projects/${st.p}/nas/file?` + new URLSearchParams({ path: b.dataset.path })),
      'nas-view': () => openPreview(`/api/documents/projects/${st.p}/nas/file?` + new URLSearchParams({ path: b.dataset.path, inline: '1' })) }[b.dataset.act];
    run?.().catch(err => toast(errorMessage(err), 'err'));
  });

  const all = ['Tất cả dự án', link({})];
  // 1) Chưa chọn dự án: mỗi dự án là một thư mục.
  if (!project) {
    crumbs([all]);
    const list = projects.filter(x => !st.q || fold(`${x.key} ${x.name}`).includes(fold(st.q)));
    body.innerHTML = table(list.map(x => folderRow(`${x.key} · ${x.name}`, link({ p: x.id }),
      [x.hubFiles ? `${x.hubFiles} tệp tải lên Hub` : 'Chưa có tệp tải lên', x.nasFolder ? `NAS: ${esc(x.nasFolder)}` : '', x.archived ? 'đã đóng' : ''].filter(Boolean).join(' · '), `doc-project-${x.key}`)),
    projects.length ? 'Không có dự án khớp.' : 'Bạn chưa là thành viên dự án nào. Tài liệu dự án chỉ hiện với thành viên dự án và Ban Tổng Giám đốc.');
    return bindRows();
  }
  const projCrumb = [`${project.key} · ${project.name}`, link({ p: project.id })];
  const hubRoot = ['Theo công việc (tải lên Hub)', link({ p: project.id, src: 'hub' })];
  const nasRoot = [`Thư mục dự án trên NAS${project.nasFolder ? ` (${project.nasFolder})` : ''}`, link({ p: project.id, src: 'nas' })];
  const hub = async () => {
    if (hubCache?.projectId !== project.id || Date.now() - hubCache.at > 30_000) hubCache = { projectId: project.id, at: Date.now(), data: await api(`/api/documents/projects/${project.id}/hub`) };
    return hubCache.data;
  };
  const hubFileRow = (f, items, showWhere = false) => {
    const it = items.find(i => i.id === f.workItemId);
    return `<tr data-testid="doc-file"><td>${icon('file')} <span class="doc-name">${esc(f.fileName)}</span></td>
      <td class="muted sm">${showWhere && it ? `<a href="#/projects/${project.id}?item=${it.id}">${esc(it.code)}</a> · ` : ''}${esc(f.uploadedBy || '')}${f.storedIn === 'NAS' ? ' · <span class="pill ok" title="Bản gốc trong kho file dự án">Kho file</span>' : ''}</td>
      <td class="num nowrap">${size(f.sizeBytes)}</td><td class="nowrap" title="${fmtDateTime(f.createdAt)}">${fmtDate(f.createdAt)}</td>
      <td class="nowrap doc-acts">${inlineOk(f.fileName) ? `<button type="button" class="btn btn-ghost btn-sm" data-act="hub-view" data-id="${f.id}">Xem</button>` : ''}<button type="button" class="btn btn-ghost btn-sm" data-act="hub-dl" data-id="${f.id}" data-testid="doc-dl">Tải về</button></td></tr>`;
  };
  const nasFileRow = e => `<tr data-testid="doc-file"><td>${icon('file')} <span class="doc-name">${esc(e.name)}</span></td>
      <td class="muted sm">${st.q ? esc(e.path.split('/').slice(0, -1).join(' / ') || '(gốc)') : ''}${e.hub ? `${st.q ? ' · ' : ''}<a href="#/projects/${project.id}?item=${e.hub.workItemId}" title="Tệp này được tải lên trong việc ${esc(e.hub.code)}">${esc(e.hub.code)}</a>` : ''}</td>
      <td class="num nowrap">${size(e.size)}</td><td class="nowrap" title="${fmtDateTime(e.mtime)}">${fmtDate(e.mtime)}</td>
      <td class="nowrap doc-acts">${inlineOk(e.name) ? `<button type="button" class="btn btn-ghost btn-sm" data-act="nas-view" data-path="${esc(e.path)}">Xem</button>` : ''}<button type="button" class="btn btn-ghost btn-sm" data-act="nas-dl" data-path="${esc(e.path)}" data-testid="doc-dl">Tải về</button></td></tr>`;

  try {
    // 2) Tìm theo tên tệp trong dự án: cả tệp tải lên Hub và tệp trên NAS.
    if (st.q) {
      crumbs([all, projCrumb, [`Kết quả tìm "${st.q}"`, '']]);
      const [h, n] = await Promise.all([hub(), project.nasFolder ? api(`/api/documents/projects/${project.id}/nas?` + new URLSearchParams({ q: st.q })).catch(() => null) : null]);
      const hubHits = h.files.filter(f => fold(f.fileName).includes(fold(st.q)));
      body.innerHTML = `<h3 class="doc-h">Theo công việc (tải lên Hub) · ${hubHits.length}</h3>${table(hubHits.map(f => hubFileRow(f, h.items, true)), 'Không có tệp khớp.')}
        ${n ? `<h3 class="doc-h">Thư mục dự án trên NAS · ${n.entries.length}${n.truncated ? '+' : ''}</h3>${table(n.entries.map(e => (e.dir ? folderRow(e.path, link({ p: project.id, src: 'nas', path: e.path }), 'thư mục') : nasFileRow(e))), 'Không có tệp khớp.')}${n.truncated ? '<p class="muted sm">Nhiều kết quả — gõ cụ thể hơn để thu hẹp.</p>' : ''}` : ''}`;
      return bindRows();
    }
    // 3) Gốc dự án: hai nguồn.
    if (!st.src) {
      crumbs([all, projCrumb]);
      body.innerHTML = table([
        folderRow(hubRoot[0], hubRoot[1], `${project.hubFiles} tệp, xếp theo hạng mục → việc`, 'doc-src-hub'),
        project.nasFolder ? folderRow(nasRoot[0], nasRoot[1], 'Mọi tệp trong thư mục dự án, kể cả tệp không tải qua Hub (chỉ đọc)', 'doc-src-nas')
          : `<tr data-testid="doc-src-nas-off"><td>${icon('folder')} <span class="muted">Thư mục dự án trên NAS</span></td><td class="muted sm" colspan="4">${nasError ? esc(nasError) : nasEnabled ? `Chưa có thư mục cho dự án trên kho file (tên thư mục phải là "${esc(project.key)}" hoặc bắt đầu bằng "${esc(project.key)}-") — liên hệ IT tạo.` : 'Kho file NAS chưa được kết nối với Hub.'}</td></tr>`,
      ], '');
      return bindRows();
    }
    // 4) Theo công việc: thư mục = việc (hạng mục → việc → việc nhánh), tệp = tệp tải lên trong việc đó.
    if (st.src === 'hub') {
      const h = await hub();
      const cur = st.path ? h.items.find(i => i.id === Number(st.path)) : null;
      const chain = [];
      for (let c = cur; c; c = h.items.find(i => i.id === c.parentId)) chain.unshift(c);
      crumbs([all, projCrumb, hubRoot, ...chain.map(c => [`${c.code} ${c.title}`, link({ p: project.id, src: 'hub', path: c.id })])]);
      const count = id => { const ids = new Set([id]); let grew = true; while (grew) { grew = false; for (const i of h.items) if (i.parentId != null && ids.has(i.parentId) && !ids.has(i.id)) { ids.add(i.id); grew = true; } } return h.files.filter(f => ids.has(f.workItemId)).length; };
      const kids = h.items.filter(i => i.parentId === (cur ? cur.id : null));
      const files = cur ? h.files.filter(f => f.workItemId === cur.id) : [];
      body.innerHTML = (cur ? `<p class="sm doc-open"><a href="#/projects/${project.id}?item=${cur.id}" data-testid="doc-open-item">Mở việc ${esc(cur.code)}</a></p>` : '')
        + table([...kids.map(k => folderRow(`${k.code} ${k.title}`, link({ p: project.id, src: 'hub', path: k.id }), `${count(k.id)} tệp`, `doc-item-${k.code}`)), ...files.map(f => hubFileRow(f, h.items))],
          cur ? 'Việc này chưa có tệp.' : 'Chưa có tệp nào được tải lên trong các việc của dự án.');
      return bindRows();
    }
    // 5) Thư mục dự án trên NAS (chỉ đọc).
    const n = await api(`/api/documents/projects/${project.id}/nas?` + new URLSearchParams({ path: st.path }));
    const segs = n.path ? n.path.split('/') : [];
    crumbs([all, projCrumb, nasRoot, ...segs.map((s, i) => [s, link({ p: project.id, src: 'nas', path: segs.slice(0, i + 1).join('/') })])]);
    body.innerHTML = table(n.entries.map(e => (e.dir ? folderRow(e.name, link({ p: project.id, src: 'nas', path: e.path }), '', 'doc-dir') : nasFileRow(e))), 'Thư mục trống.');
    bindRows();
  } catch (error) {
    body.innerHTML = `<div class="empty" data-testid="doc-error">${esc(errorMessage(error))}</div>`;
  }
}
