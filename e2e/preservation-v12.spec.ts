import { test, expect } from "@playwright/test";
test("隐藏的历史字段在重新编辑、导出和恢复后逐字段保留；完整性入口", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开始记录", exact: false }).click();
  await page.getByLabel("坐姿推胸 第1组重量").fill("42.5");
  await page.getByLabel("坐姿推胸 第1组次数").fill("9");
  await page.getByRole("button", { name: "完成训练", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Synthetic legacy fields are injected exclusively into this test's disposable context.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("fitness-os-real");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("workoutSessions", "readwrite");
      const store = tx.objectStore("workoutSessions");
      const r = store.getAll();
      r.onsuccess = () => {
        const s = r.result[0];
        s.duration = 47;
        s.fatigue = "较累";
        s.notes = "虚构历史备注，必须保留";
        s.items[0].quality = true;
        s.items[0].reserve = true;
        store.put(s);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "训练", exact: true })
    .click();
  await page.locator(".session-row").first().click();
  await expect(page.getByLabel("主观疲劳")).toHaveCount(0);
  await page.getByLabel("坐姿推胸 第1组次数").fill("11");
  await page.getByRole("button", { name: "保存并关闭", exact: true }).click();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "总览", exact: true })
    .click();
  await page.getByRole("button", { name: "总览更多操作" }).click();
  await page.getByRole("button", { name: "数据管理", exact: true }).click();
  await page.getByRole("button", { name: "检查数据完整性" }).click();
  await expect(page.getByRole("status")).toContainText("数据完整");
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整 JSON 备份" }).click();
  const file = await event;
  const { readFile } = await import("node:fs/promises");
  const backup = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(backup.version).toBe(2);
  expect(backup.data.workoutSessions[0]).toMatchObject({
    duration: 47,
    fatigue: "较累",
    notes: "虚构历史备注，必须保留",
    status: "completed",
  });
  expect(backup.data.workoutSessions[0].items[0]).toMatchObject({
    quality: true,
    reserve: true,
  });
  expect(
    backup.data.workoutSets.find(
      (s: { weight: number | null }) => s.weight !== null,
    ),
  ).toMatchObject({ weight: 42.5, reps: 11 });
  const before = page.waitForEvent("download");
  await page.getByLabel("选择备份文件").setInputFiles({
    name: "synthetic-v1.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await before;
  await page.getByLabel("我已确认导入前备份文件保存成功").check();
  await page.getByRole("button", { name: "确认合并恢复" }).click();
  await expect(page.getByText("恢复成功；", { exact: false })).toBeVisible();
});
