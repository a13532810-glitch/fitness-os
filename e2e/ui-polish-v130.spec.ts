import { test, expect, type Locator } from '@playwright/test';
import { readTestDatabase } from './fixtures';

async function checkInclineLayout(log: Locator, width: number) {
  const layout = await log.evaluate((element) => {
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
    };
    const inputs = [...element.querySelectorAll('input')];
    const actions = element.querySelector('form > .button-row')!;
    const history = element.querySelector('h3')!;
    return {
      panel: box(element), inputs: inputs.map(box),
      labels: inputs.map(e => box(e.parentElement!)),
      buttons: [...actions.querySelectorAll('button')].map(box),
      controls: [...element.querySelectorAll('input,button')].map(box),
      separator: { ...box(history), border: getComputedStyle(history).borderTopWidth },
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      fieldOverflow: inputs.map(e => e.scrollWidth > e.clientWidth + 1),
    };
  });
  expect(layout.pageOverflow).toBe(false);
  expect(layout.inputs).toHaveLength(4);
  expect(layout.fieldOverflow).toEqual([false, false, false, false]);
  for (const r of layout.controls) {
    expect(r.height).toBeGreaterThanOrEqual(44);
    expect(r.left).toBeGreaterThanOrEqual(layout.panel.left + 1);
    expect(r.right).toBeLessThanOrEqual(layout.panel.right - 1);
  }
  expect(layout.inputs[0].top).toBeCloseTo(layout.inputs[1].top, 0);
  expect(layout.inputs[2].top).toBeCloseTo(layout.inputs[3].top, 0);
  expect(layout.inputs[0].left).toBeCloseTo(layout.inputs[2].left, 0);
  expect(layout.inputs[1].right).toBeCloseTo(layout.inputs[3].right, 0);
  expect(layout.labels[2].top - layout.labels[0].bottom).toBeGreaterThanOrEqual(10);
  expect(layout.labels[2].top - layout.labels[0].bottom).toBeLessThanOrEqual(14);
  expect(new Set(layout.inputs.map(r => Math.round(r.height))).size).toBe(1);
  expect(layout.buttons[0].height).toBeCloseTo(layout.buttons[1].height, 0);
  if (width < 360) expect(layout.buttons[1].top).toBeGreaterThanOrEqual(layout.buttons[0].bottom + 8);
  else expect(layout.buttons[1].top).toBeCloseTo(layout.buttons[0].top, 0);
  expect(layout.separator.top).toBeGreaterThanOrEqual(layout.buttons[1].bottom + 18);
  expect(layout.separator.border).toBe('1px');
}

test('爬坡两列字段、日期边界、44px触控及空/有记录布局矩阵', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/#record');
  await page.getByRole('button', { name: '跑步机爬坡', exact: true }).click();
  const log = page.getByRole('region', { name: '跑步机爬坡' });
  for (const state of ['empty', 'history']) {
    if (state === 'history') {
      await log.getByRole('button', { name: '保存爬坡记录', exact: true }).click();
      await expect(log.locator('.incline-history')).toHaveCount(1);
      await log.getByRole('button', { name: '记录另一次训练' }).click();
    }
    for (const width of [320, 375, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await checkInclineLayout(log, width);
      await page.screenshot({ path: `artifacts/v1.3.0/ui-polish/${info.project.name}-${state}-${width}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '150%'; });
  await expect(log.getByLabel('训练日期')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of await log.locator('input,button').all()) {
    const bounds = await control.boundingBox();
    expect(bounds!.width).toBeGreaterThan(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  }
  expect(errors).toEqual([]);
});

test('日常力量新增/历史编辑无器械控件，旧配置保留，新记录不冒用旧配置', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始记录', exact: false }).click();
  const dialog = page.getByRole('dialog');
  async function absentControls() {
    for (const label of ['器械标识', '动作方式', '动作方式 / 座椅设置'])
      await expect(dialog.getByLabel(label, { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '动作详情', exact: true })).toHaveCount(0);
  }
  await absentControls();
  await dialog.getByLabel('坐姿推胸 第1组重量').fill('20');
  await dialog.getByLabel('坐姿推胸 第1组次数').fill('10');
  await dialog.getByRole('button', { name: '完成训练', exact: true }).click();
  await expect(page.getByRole('region', { name: '训练完成总结' })).toBeVisible();
  // Simulate an existing legacy record in this disposable test database only.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('fitness-os-real');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('workoutSessions', 'readwrite');
      const store = tx.objectStore('workoutSessions');
      const request = store.getAll();
      request.onsuccess = () => {
        const record = request.result[0];
        record.items.forEach((item: any, i: number) => { item.equipment = '虚构旧机器' + i; item.technique = '虚构旧座椅' + i; });
        store.put(record);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  const before = (await readTestDatabase(page)).workoutSessions[0];
  await page.goto('/#record');
  await page.locator('.session-row').first().click();
  await absentControls();
  for (const width of [320, 375, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    await expect(dialog.getByLabel('训练日期', { exact: true })).toBeVisible();
    await page.screenshot({ path: `artifacts/v1.3.0/ui-polish/${info.project.name}-strength-${width}.png`, fullPage: true });
  }
  await dialog.getByLabel('坐姿推胸 第1组次数').fill('11');
  await dialog.getByRole('button', { name: /保存并关闭|保存草稿/ }).click();
  const after = await readTestDatabase(page);
  expect(after.workoutSessions[0].items).toEqual(before.items);
  expect(after.workoutSets.find((r: any) => r.exerciseId === 'exercise-1' && r.order === 0).reps).toBe(11);
  await page.goto('/');
  await page.getByRole('button', { name: '开始记录', exact: false }).click();
  await absentControls();
  await dialog.getByLabel(/第1组重量/).first().fill('30');
  await dialog.getByLabel(/第1组次数/).first().fill('12');
  await dialog.getByRole('button', { name: '完成训练', exact: true }).click();
  await expect(page.getByRole('region', { name: '训练完成总结' })).toBeVisible();
  const sessions = (await readTestDatabase(page)).workoutSessions;
  expect(sessions.find((r: any) => r.id === before.id).items).toEqual(before.items);
  const added = sessions.find((r: any) => r.id !== before.id);
  expect(added.items.every((i: any) => i.equipment === '' && i.technique === '')).toBe(true);
});
