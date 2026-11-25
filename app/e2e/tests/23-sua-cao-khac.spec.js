// Sửa lỗi mức Cao, nhóm "khác" — dữ liệu GIẢ.
// Lỗi 13: chưa ai phụ trách "Toàn công ty" và bộ phận chủ trì chưa có Phó TGĐ phụ trách → đề nghị gia hạn không ai nhận, không ai quyết.
// Sau sửa: mọi thành viên Ban Tổng Giám đốc nhận, thấy nút ở "Chờ tôi duyệt → Đề nghị gia hạn" và quyết được (dự phòng như cấp duyệt
// "BTGĐ phụ trách"); người giao, lãnh đạo bộ phận chủ trì chỉ theo dõi. Logic chi tiết: app/server/src/routes/gia-han.test.js.
// CSDL dùng chung với các spec khác: tạm bỏ dấu "Toàn công ty" và người phụ trách Ban Pháp lý, khôi phục đúng như cũ trong finally.
const { test, expect, login, apiAs, vnDate, toast } = require('./helpers');

const json = async res => { expect(res.status(), await res.text()).toBeLessThan(300); return res.json(); };
async function as(browser, username) {
  const page = await (await browser.newContext()).newPage();
  await login(page, username);
  return page;
}

test('Lỗi 13 — việc chưa có BTGĐ phụ trách: thành viên Ban Tổng Giám đốc nhận đề nghị gia hạn, có nút ở Chờ tôi duyệt và quyết; lãnh đạo bộ phận chỉ theo dõi', async ({ browser }) => {
  const admin = await as(browser, 'admin');
  const users = await json(await apiAs(admin, '/api/admin/users'));
  const PL = (await json(await apiAs(admin, '/api/departments'))).find(d => d.code === 'PL');
  const U = name => users.find(u => u.username === name);
  // Thiết lập dùng chung sẽ tạm đổi: dấu "Toàn công ty" của mọi thành viên BTGĐ và người đang phụ trách Ban Pháp lý.
  const saved = users.filter(u => u.isActive && u.role === 'director' && (u.boardAll || u.supervisedDepartmentIds.includes(PL.id)))
    .map(u => ({ id: u.id, all: u.boardAll, departmentIds: u.supervisedDepartmentIds }));
  const scope = (id, all, departmentIds) => apiAs(admin, `/api/admin/users/${id}/scope`, { method: 'PUT', data: { all, departmentIds } });
  try {
    for (const u of saved) await json(await scope(u.id, false, u.departmentIds.filter(d => d !== PL.id)));

    // giamdoc (thành viên BTGĐ, lúc này không phụ trách gì) ghi việc cho Ban Pháp lý; người giao là lãnh đạo bộ phận (tb.phaply).
    const tgd = await as(browser, 'giamdoc');
    const project = (await json(await apiAs(tgd, '/api/projects'))).find(p => p.key === 'DA');
    const item = await json(await apiAs(tgd, `/api/projects/${project.id}/items`, { method: 'POST', data: {
      title: 'Hồ sơ pháp lý chờ đối tác (giả) — e2e 23', leadDepartmentId: PL.id, assigneeIds: [U('nv.phaply').id], assignedById: U('tb.phaply').id,
      dueDate: vnDate(20), source: 'Họp giao ban' } }));
    expect(item.assignedById).toBe(U('tb.phaply').id);
    const nv = await as(browser, 'nv.phaply');
    const newDue = vnDate(30);
    const ext = await json(await apiAs(nv, `/api/items/${item.id}/extensions`, { method: 'POST', data: { newDue, reason: 'Chờ hồ sơ đối tác (giả) — e2e 23' } }));

    // Thành viên BTGĐ (không phải người giao, không phụ trách bộ phận nào) nhận thông báo.
    const notes = (await json(await apiAs(tgd, '/api/notifications'))).items;
    expect(notes.some(n => n.type === 'EXTENSION_REQUESTED' && n.link?.endsWith(`item=${item.id}`))).toBe(true);

    // Lãnh đạo bộ phận chủ trì (cũng là người giao): thấy để nắm, không có nút; API từ chối với câu đúng luật mới.
    const tb = await as(browser, 'tb.phaply');
    await tb.goto('/#/approvals?tab=extensions');
    await expect(tb.getByTestId(`ext-${item.code}`)).toContainText('Ban Tổng Giám đốc quyết định — bạn theo dõi');
    await expect(tb.getByTestId(`ext-approve-${item.code}`)).toHaveCount(0);
    const no = await apiAs(tb, `/api/extensions/${ext.id}/decide`, { method: 'POST', data: { decision: 'APPROVE' } });
    expect(no.status()).toBe(403);
    expect((await no.json()).error).toContain('việc chưa có BTGĐ phụ trách thì thành viên Ban Tổng Giám đốc nào cũng duyệt được');

    // Thành viên BTGĐ: số đỏ tính đề nghị này; có nút ở hàng chờ; bấm Duyệt → hạn đổi.
    expect((await json(await apiAs(tgd, '/api/approvals/counts'))).extensions).toBeGreaterThanOrEqual(1);
    await tgd.goto('/#/approvals?tab=extensions');
    await tgd.getByTestId(`ext-approve-${item.code}`).click();
    await toast(tgd, 'Đã duyệt gia hạn');
    const after = await json(await apiAs(tgd, `/api/items/${item.id}`));
    expect(after.extensions.find(x => x.id === ext.id).status).toBe('APPROVED');
    expect(after.dueDate.slice(0, 10)).toBe(newDue);
  } finally {
    for (const u of saved) expect((await scope(u.id, u.all, u.departmentIds)).status(), `khôi phục phạm vi tài khoản ${u.id}`).toBeLessThan(300);
  }
});
