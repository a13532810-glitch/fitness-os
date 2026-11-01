import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { seedLegacyBody, readTestDatabase } from "./fixtures";
test("历史身体指标与爬坡：v1合并、v2完整覆盖、重复恢复及损坏保护", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".page-heading")).toBeVisible();
  await seedLegacyBody(page);
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "训练", exact: true })
    .click();
  await page.getByRole("button", { name: "跑步机爬坡", exact: true }).click();
  await page.getByRole("button", { name: "保存爬坡记录", exact: true }).click();
  await expect(page.locator(".incline-history")).toHaveCount(1);
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "总览", exact: true })
    .click();
  await page.getByRole("button", { name: "总览更多操作" }).click();
  await page.getByRole("button", { name: "数据管理", exact: true }).click();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整 JSON 备份" }).click();
  const backup = JSON.parse(
    await readFile((await (await event).path())!, "utf8"),
  );
  expect(backup.version).toBe(2);
  expect(backup.data.bodyMetrics).toHaveLength(2);
  expect(backup.data.inclineRecords).toHaveLength(1);
  const importFile = async (b: any) => {
    await page
      .getByLabel("选择备份文件")
      .setInputFiles({
        name: "synthetic.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(b)),
      });
  };
  const legacy = structuredClone(backup);
  legacy.version = 1;
  delete legacy.data.inclineRecords;
  for (let i = 0; i < 2; i++) {
    await importFile(legacy);
    await expect(page.locator(".restore-preview")).toContainText("版本1");
    await page.getByLabel("我已确认导入前备份文件保存成功").check();
    await page
      .getByRole("button", { name: /确认合并恢复|确认覆盖全部正式数据/ })
      .click();
    await expect(page.locator(".success[role=status]")).toContainText("恢复成功");
    const data = await readTestDatabase(page);
    expect(data.bodyMetrics).toEqual(backup.data.bodyMetrics);
    expect(data.inclineRecords).toEqual(backup.data.inclineRecords);
  }
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("fitness-os-real");
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction(["bodyMetrics", "inclineRecords"], "readwrite");
      tx.objectStore("bodyMetrics").clear();
      tx.objectStore("inclineRecords").clear();
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await importFile(backup);
  await page.getByLabel("恢复方式").selectOption("replace");
  await expect(page.locator(".restore-preview")).toContainText("版本2");
  await page.getByLabel("我已确认导入前备份文件保存成功").check();
  await page.getByLabel("输入「覆盖当前数据」确认替换").fill("覆盖当前数据");
  await page
    .getByRole("button", { name: /确认合并恢复|确认覆盖全部正式数据/ })
    .click();
  await expect(page.locator(".success[role=status]")).toContainText("恢复成功");
  expect(await readTestDatabase(page)).toEqual(backup.data);
  const before = await readTestDatabase(page);
  const broken = structuredClone(backup);
  delete broken.data.inclineRecords;
  await importFile(broken);
  await expect(page.getByRole("alert")).toContainText("缺少爬坡数据");
  expect(await readTestDatabase(page)).toEqual(before);
});
