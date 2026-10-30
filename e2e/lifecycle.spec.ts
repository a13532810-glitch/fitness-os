import { test, expect, chromium, webkit } from '@playwright/test';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
test('真正关闭浏览器进程后，持久配置中的训练草稿仍在', async ({}, info) => {
  const directory = mkdtempSync(join(tmpdir(), 'fitness-restart-'));
  const engine = info.project.name.startsWith('webkit') ? webkit : chromium;
  const options = {
    viewport: { width: 390, height: 844 },
    ...(engine === chromium
      ? {
          executablePath:
            process.env.FITNESS_CHROME_PATH ??
            (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
              ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
              : undefined),
        }
      : {}),
  };
  try {
    let browser = await engine.launchPersistentContext(directory, options);
    let page = await browser.newPage();
    await page.goto('http://127.0.0.1:4173');
    await page.getByRole('button', { name: '开启我的训练空间' }).click();
    await page.getByRole('button', { name: '开始记录', exact: false }).click();
    await page.getByLabel('坐姿推胸 第1组重量').fill('27.5');
    await page.getByLabel('坐姿推胸 第1组次数').fill('9');
    await page.getByRole('button', { name: '保存并关闭' }).click();
    await browser.close();
    browser = await engine.launchPersistentContext(directory, options);
    try {
      page = await browser.newPage();
      await page.goto('http://127.0.0.1:4173');
      await page.getByRole('button', { name: '还有一份训练草稿', exact: false }).click();
      await expect(page.getByLabel('坐姿推胸 第1组重量')).toHaveValue('27.5');
      await expect(page.getByLabel('坐姿推胸 第1组次数')).toHaveValue('9');
    } finally {
      await browser.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('实际新版本Service Worker激活后 IndexedDB 草稿保持完整', async ({ page }) => {
  test.setTimeout(120000);
  const backup = mkdtempSync(join(tmpdir(), 'fitness-dist-'));
  cpSync(resolve('dist'), join(backup, 'original'), { recursive: true });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '开启我的训练空间' }).click();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.getByRole('button', { name: '开始记录', exact: false }).click();
    await page.getByLabel('坐姿推胸 第1组重量').fill('32.5');
    await page.getByLabel('坐姿推胸 第1组次数').fill('8');
    await page.getByRole('button', { name: '保存并关闭' }).click();
    execFileSync(
      process.execPath,
      [resolve('node_modules/vite/bin/vite.js'), 'build', '--outDir', join(backup, 'updated')],
      { env: { ...process.env, FITNESS_BUILD_LABEL: 'test-update-2' }, stdio: 'pipe' },
    );
    cpSync(join(backup, 'updated'), resolve('dist'), { recursive: true });
    await page.evaluate(async () => {
      const r = await navigator.serviceWorker.ready;
      await r.update();
    });
    await expect(page.getByRole('button', { name: '更新应用', exact: true })).toBeVisible({
      timeout: 20000,
    });
    await page.getByRole('button', { name: '更新应用', exact: true }).click();
    await expect(page.locator('meta[name="fitness-build"]')).toHaveAttribute(
      'content',
      'test-update-2',
    );
    await page.getByRole('button', { name: '还有一份训练草稿', exact: false }).click();
    await expect(page.getByLabel('坐姿推胸 第1组重量')).toHaveValue('32.5');
    await expect(page.getByLabel('坐姿推胸 第1组次数')).toHaveValue('8');
  } finally {
    rmSync(resolve('dist'), { recursive: true, force: true });
    cpSync(join(backup, 'original'), resolve('dist'), { recursive: true });
    rmSync(backup, { recursive: true, force: true });
  }
});
test('4动作12组完整录入流程计时（自动操作，不代表真人速度）', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开启我的训练空间' }).click();
  await page.getByRole('button', { name: '调整计划', exact: true }).click();
  for (const details of await page.locator('.exercise-details').all()) {
    await details.locator('summary').click();
    await details
      .getByLabel('器械标识', { exact: true })
      .fill('机器' + (await details.locator('summary').innerText()));
    await details.getByLabel('默认动作方式').fill('固定座椅设置');
  }
  await page.getByRole('button', { name: '保存计划与动作' }).click();
  const start = Date.now();
  await page.getByRole('button', { name: '开始记录', exact: false }).click();
  await page.getByLabel('训练时长（分钟）').fill('45');
  await page.getByLabel('主观疲劳').selectOption('适中');
  for (const name of ['坐姿推胸', '上斜推胸', '坐姿肩推', '侧平举机'])
    for (let group = 1; group <= 3; group++) {
      await page.getByLabel(`${name} 第${group}组重量`).fill('20');
      await page.getByLabel(`${name} 第${group}组次数`).fill('10');
    }
  await page.getByLabel('训练感受').fill('本次动作稳定，保留余力');
  await page.getByRole('button', { name: '完成训练', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const seconds = (Date.now() - start) / 1000;
  writeFileSync(
    `artifacts/entry-timing-${info.project.name}.json`,
    JSON.stringify(
      {
        kind: 'automated-browser-workflow',
        exercises: 4,
        sets: 12,
        seconds,
        limitations: '自动填表实测，不能证明真人在iPhone上2–3分钟完成；需真实设备人工计时。',
      },
      null,
      2,
    ),
  );
  expect(seconds).toBeLessThan(180);
});
