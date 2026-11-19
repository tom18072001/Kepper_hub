// Việc con hiện ở mọi view (Danh sách lồng / dòng riêng, Bảng) và ràng buộc việc cha – việc con với luật người giao duyệt.
// Dữ liệu GIẢ của dự án mẫu DA: bước 8 (DA-8) có 4 việc con của Ban Pháp lý. Chạy sau các spec khác trên cùng CSDL test.
const { test, expect } = require('@playwright/test');
const { login, apiAs } = require('./helpers');

async function subMode(page, mode) {
  const sel = page.getByTestId('filter-subtasks');
  if (!(await sel.isVisible())) await page.getByTestId('display-menu').click();
  await sel.selectOption(mode);
}

test.describe.configure({ mode: 'serial' });

test('20. Việc con: lồng / thu gọn / dòng riêng trong Danh sách, nằm trong thẻ cha ở Bảng; việc cha chỉ gửi duyệt khi đủ con đã duyệt', async ({ browser }) => {
  const pmo = await (await browser.newContext()).newPage();
  await login(pmo, 'pmo');
  const project = (await (await apiAs(pmo, '/api/projects')).json()).find(p => p.key === 'DA');
  const items = await (await apiAs(pmo, `/api/projects/${project.id}/items`)).json();
  const parent = items.find(i => i.code === 'DA-8');
  const kids = items.filter(i => i.parentId === parent.id);
  expect(kids.length).toBeGreaterThan(1);
  expect(parent.counts.childrenTotal).toBe(kids.length);
  for (const k of kids) expect(k.parentRef.code).toBe('DA-8');

  // Danh sách, chế độ mặc định "Lồng dưới việc cha": con nằm ngay dưới cha, thụt cấp 1; cha hiện x/y việc con.
  await pmo.goto(`/#/projects/${project.id}?view=list`);
  const rows = pmo.getByTestId('list-table').locator('tbody tr');
  await expect(pmo.getByTestId('kids-DA-8')).toContainText(`${parent.counts.childrenDone}/${kids.length} việc con`);
  const order = await rows.evaluateAll(trs => trs.map(t => [t.dataset.testid.replace('row-', ''), t.dataset.depth]));
  const at = order.findIndex(([c]) => c === 'DA-8');
  expect(order.slice(at + 1, at + 1 + kids.length).every(([, d]) => d === '1')).toBe(true);
  // Thu gọn / mở lại.
  const kidRows = () => Promise.all(kids.map(k => pmo.getByTestId(`row-${k.code}`).getAttribute('data-depth').catch(() => null)));
  await pmo.getByTestId('fold-DA-8').click();
  for (const k of kids) await expect(pmo.getByTestId(`row-${k.code}`)).toHaveCount(0);
  await pmo.getByTestId('fold-DA-8').click();
  expect(await kidRows()).toEqual(kids.map(() => '1'));
  // Dòng riêng kèm nhãn việc cha.
  await subMode(pmo, 'flat');
  await expect(pmo.getByTestId(`parent-ref-${kids[0].code}`)).toContainText('↳ DA-8');
  await expect.poll(kidRows).toEqual(kids.map(() => '0'));
  await subMode(pmo, 'nest');

  // Bảng: con nằm trong thẻ cha (không lặp thẻ riêng), mở bằng nút x/y việc con.
  await pmo.goto(`/#/projects/${project.id}?view=board`);
  await expect(pmo.getByTestId('kids-DA-8')).toBeVisible();
  await expect(pmo.getByTestId('card-DA-8')).toBeVisible();
  await expect(pmo.getByTestId(`card-${kids[0].code}`)).toHaveCount(0);
  await pmo.getByTestId('kids-DA-8').click();
  await expect(pmo.getByTestId('kid-list-DA-8').locator('li')).toHaveCount(kids.length);

  // Việc cha: còn con chưa được duyệt → không gửi duyệt / hoàn thành được (API), ô trạng thái khoá "Hoàn thành".
  const open = kids.filter(k => k.stage?.code !== 'DONE');
  if (open.length) {
    const review = (await (await apiAs(pmo, `/api/projects/${project.id}`)).json()).states.find(s => s.category === 'REVIEW');
    const r = await apiAs(pmo, `/api/items/${parent.id}`, { method: 'PATCH', data: { stateId: review.id } });
    expect(r.status()).toBe(409);
    expect((await r.json()).code).toBe('CHILDREN_OPEN');
    await pmo.getByTestId('card-DA-8').locator('.title').click();
    await expect.poll(() => pmo.locator('#ipState').evaluate(sel => [...sel.options].filter(o => o.text.startsWith('Hoàn thành')).map(o => [o.text, o.disabled]))).toEqual([['Hoàn thành (còn việc con chưa duyệt)', true]]);
    await expect(pmo.getByTestId('children-block-note')).toBeVisible();
  }
});
