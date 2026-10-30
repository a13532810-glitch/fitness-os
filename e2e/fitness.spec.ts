import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function begin(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开启我的训练空间' }).click();
  await expect(page.getByRole('heading', { name: '今天，也为自己进步一点。' })).toBeVisible();
}
async function nav(page: Page, label: string) {
  await page.locator('.bottom-nav').getByRole('button', { name: label, exact: true }).click();
}
async function oneExercise(page: Page) {
  await page.getByRole('button', { name: '开始记录', exact: false }).click();
  const dialog = page.getByRole('dialog');
  for (const name of ['上斜推胸', '坐姿肩推', '侧平举机'])
    await dialog.getByRole('button', { name: '移除动作 ' + name, exact: true }).click();
  await dialog.getByLabel('器械标识', { exact: true }).fill('胸推01');
  await dialog.getByLabel('动作方式 / 座椅设置').fill('座椅2标准幅度');
  return dialog;
}
async function downloadJSON(page: Page, buttonName: string) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  const file = await event;
  return JSON.parse(await readFile((await file.path())!, 'utf8'));
}
function file(data: any) {
  return {
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
  };
}
test('逐组录入、增删组、草稿刷新、编辑与删除；目标确认、身体指标、周报', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await begin(page);
  const d = await oneExercise(page);
  await expect(d.getByLabel('坐姿推胸 第1组重量')).toHaveValue('');
  await d.getByLabel('坐姿推胸 第1组重量').fill('20');
  await d.getByLabel('坐姿推胸 第1组次数').fill('10');
  await d.getByLabel('坐姿推胸 第2组重量').fill('25');
  await d.getByLabel('坐姿推胸 第2组次数').fill('9');
  await d.getByLabel('坐姿推胸 第3组重量').fill('25');
  await d.getByLabel('坐姿推胸 第3组次数').fill('8');
  await d.getByRole('button', { name: '添加一组', exact: true }).click();
  await expect(d.getByLabel('坐姿推胸 第4组重量')).toBeVisible();
  await d.getByRole('button', { name: '移除坐姿推胸第4组' }).click();
  await d.getByRole('button', { name: '保存并关闭' }).click();
  await page.reload();
  await page.getByRole('button', { name: '还有一份训练草稿', exact: false }).click();
  await expect(page.getByLabel('坐姿推胸 第2组重量')).toHaveValue('25');
  await page.getByRole('button', { name: '完成训练', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await nav(page, '记录');
  await page.locator('.session-row').first().click();
  await page.getByLabel('坐姿推胸 第1组次数').fill('11');
  await page.getByRole('button', { name: '保存并关闭' }).click();
  await nav(page, '趋势');
  await expect(
    page.getByText('20kg × 11 / 25kg × 9 / 25kg × 8', { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: '记录身体指标', exact: false }).click();
  await page.getByLabel('体重（kg）').fill('74.2');
  await page.getByLabel('腰围（cm）').fill('85');
  await page.getByRole('button', { name: '保存身体指标' }).click();
  await page.getByRole('button', { name: '制定下次目标' }).click();
  await page.getByRole('dialog').getByLabel('器械标识', { exact: true }).fill('胸推01');
  await page.getByLabel('动作方式', { exact: true }).last().fill('座椅2标准幅度');
  await page.getByLabel('制定依据').fill('先保持重量，逐步增加次数');
  await page.getByRole('button', { name: '保存为待确认目标' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '本人确认', exact: true }).click();
  await expect(page.getByText('已确认', { exact: true })).toBeVisible();
  await nav(page, 'AI');
  await page.getByLabel('分析结论或个人复盘').fill('本周建立基线，下周保持同器械比较。');
  await page.getByRole('button', { name: '保存周报', exact: true }).click();
  await expect(page.getByText('本人保存', { exact: true })).toBeVisible();
  const pack = await downloadJSON(page, '导出分析 JSON');
  expect(pack.history28).toHaveLength(1);
  expect(pack.workoutSets).toHaveLength(3);
  expect(pack.bodyMetrics).toHaveLength(1);
  expect(pack.trainingGoals[0].status).toBe('confirmed');
  await nav(page, '记录');
  await page.locator('.session-row').first().click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '删除训练', exact: true }).click();
  await expect(page.getByText('还没有训练记录')).toBeVisible();
  expect(errors).toEqual([]);
});
test('JSON下载、预览、合并幂等、覆盖确认、损坏拒绝和演示隔离', async ({ page }) => {
  await begin(page);
  await oneExercise(page);
  await page.getByLabel('坐姿推胸 第1组重量').fill('20');
  await page.getByLabel('坐姿推胸 第1组次数').fill('10');
  await page.getByRole('button', { name: '完成训练', exact: true }).click();
  await nav(page, '设置');
  const backup = await downloadJSON(page, '导出完整 JSON 备份');
  expect(backup.mode).toBe('real');
  expect(backup.data.workoutSessions).toHaveLength(1);
  for (let i = 0; i < 2; i++) {
    const event = page.waitForEvent('download');
    await page.getByLabel('选择备份文件').setInputFiles(file(backup));
    await event;
    await expect(page.getByText('导入预览 · 合并保留')).toBeVisible();
    await expect(page.getByRole('button', { name: '确认合并恢复' })).toBeDisabled();
    await page.getByLabel('我已确认导入前备份文件保存成功').check();
    await page.getByRole('button', { name: '确认合并恢复' }).click();
    await expect(page.getByText('恢复成功；', { exact: false })).toBeVisible();
  }
  await page.getByLabel('选择备份文件').setInputFiles(file('{bad'));
  await expect(page.getByRole('alert')).toContainText('损坏');
  const event = page.waitForEvent('download');
  await page.getByLabel('选择备份文件').setInputFiles(file(backup));
  await event;
  const event2 = page.waitForEvent('download');
  await page.getByLabel('恢复方式').selectOption('replace');
  await event2;
  await page.getByLabel('我已确认导入前备份文件保存成功').check();
  await expect(page.getByRole('button', { name: '确认覆盖全部正式数据' })).toBeDisabled();
  await page.getByPlaceholder('覆盖当前数据', { exact: true }).fill('覆盖当前数据');
  await page.getByRole('button', { name: '确认覆盖全部正式数据' }).click();
  await expect(page.getByText('恢复成功；', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '体验虚构演示', exact: true }).click();
  await nav(page, '设置');
  await expect(page.getByRole('button', { name: '导出完整 JSON 备份' })).toBeDisabled();
  await nav(page, 'AI');
  await expect(page.getByRole('button', { name: '导出分析 JSON' })).toBeDisabled();
  await page.getByRole('button', { name: '返回正式', exact: true }).click();
  await nav(page, '记录');
  await expect(page.locator('.session-row')).toHaveCount(1);
});
test('移动布局与深色模式无横向溢出、数字键盘属性', async ({ page }) => {
  await begin(page);
  for (const label of ['首页', '记录', '趋势', 'AI', '设置']) {
    await nav(page, label);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator('.bottom-nav')).toBeVisible();
  }
  await page.getByLabel('显示模式').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await nav(page, '首页');
  await oneExercise(page);
  await expect(page.getByLabel('坐姿推胸 第1组重量')).toHaveAttribute('inputmode', 'decimal');
  await expect(page.getByLabel('坐姿推胸 第1组次数')).toHaveAttribute('inputmode', 'numeric');
  expect(await page.getByRole('dialog').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
});
test('生产PWA manifest、离线冷开、离线创建编辑、联网保留和更新检查', async ({ page, context }) => {
  await begin(page);
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons).toHaveLength(3);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('离线可记录', { exact: false })).toBeVisible();
  await oneExercise(page);
  await page.getByLabel('坐姿推胸 第1组重量').fill('22.5');
  await page.getByLabel('坐姿推胸 第1组次数').fill('12');
  await page.getByRole('button', { name: '完成训练', exact: true }).click();
  const another = await context.newPage();
  await page.close();
  await another.goto('/');
  await nav(another, '记录');
  await another.locator('.session-row').first().click();
  await expect(another.getByLabel('坐姿推胸 第1组重量')).toHaveValue('22.5');
  await another.getByLabel('坐姿推胸 第1组次数').fill('13');
  await another.getByRole('button', { name: '保存并关闭' }).click();
  await context.setOffline(false);
  await another.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    await r.update();
  });
  await another.reload();
  await nav(another, '记录');
  await another.locator('.session-row').first().click();
  await expect(another.getByLabel('坐姿推胸 第1组次数')).toHaveValue('13');
});
test('虚构演示的图表和桌面布局视觉检查', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '先体验虚构演示' }).click();
  await expect(page.getByText('虚构演示', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'artifacts/mobile-dashboard.png', fullPage: true });
  for (const label of ['趋势', 'AI', '设置']) {
    await nav(page, label);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await nav(page, '趋势');
  await page.screenshot({ path: 'artifacts/mobile-trends.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.sidebar nav').getByRole('button', { name: '首页', exact: true }).click();
  await page.screenshot({ path: 'artifacts/desktop-dashboard.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
