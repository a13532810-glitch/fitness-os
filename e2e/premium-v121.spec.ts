import { test, expect, type Page } from "@playwright/test";
async function count(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("fitness-os-real");
      r.onsuccess = () => resolve(r.result);
    });
    const n = await new Promise<number>((resolve) => {
      const r = db
        .transaction("workoutSessions")
        .objectStore("workoutSessions")
        .count();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return n;
  });
}
const start = async (page: Page) =>
  page.getByRole("button", { name: "开始记录", exact: false }).click();
test("浏览十次、类型切换、刷新与后台恢复不持久化空白训练", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".page-heading")).toBeVisible();
  for (let n = 0; n < 10; n++) {
    await start(page);
    await page
      .getByRole("combobox", { name: "训练类型", exact: true })
      .selectOption(n % 2 ? "B" : "C");
    await page.getByRole("button", { name: "关闭训练记录" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  expect(await count(page)).toBe(0);
  await start(page);
  await page.reload();
  await expect(page.locator(".page-heading")).toBeVisible();
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
  });
  expect(await count(page)).toBe(0);
});
test("有效输入自动保存、刷新恢复原草稿与同日多次完成", async ({ page }) => {
  await page.goto("/");
  await start(page);
  await page.getByLabel("坐姿推胸 第1组重量").fill("0");
  await page.getByLabel("坐姿推胸 第1组次数").fill("10");
  await expect(page.locator(".save-state")).toHaveText("已保存");
  expect(await count(page)).toBe(1);
  await page.reload();
  await page.locator(".draft-banner").click();
  await expect(page.getByLabel("坐姿推胸 第1组重量")).toHaveValue("0");
  await page.getByRole("button", { name: "关闭训练记录" }).click();
  await page.locator(".draft-banner").click();
  expect(await count(page)).toBe(1);
  await page.getByRole("button", { name: "完成训练", exact: true }).click();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "总览", exact: true })
    .click();
  await start(page);
  await page
    .getByLabel(/第1组重量/)
    .first()
    .fill("20");
  await page
    .getByLabel(/第1组次数/)
    .first()
    .fill("8");
  await page.getByRole("button", { name: "完成训练", exact: true }).click();
  expect(await count(page)).toBe(2);
});
for (const width of [320, 390, 430, 1440])
  test(`紧凑计划与全站无溢出 ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "调整计划", exact: true }).click();
    await expect(page.locator(".plan-item input:visible")).toHaveCount(0);
    await page.locator(".plan-item > summary").first().click();
    await expect(page.getByLabel("坐姿推胸目标组数")).toBeVisible();
    await page.screenshot({
      path: `docs/v1.2.1/${info.project.name}-plan-${width}.png`,
    });
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    for (const name of ["总览", "训练", "趋势", "AI 周报"]) {
      await page
        .locator(width > 900 ? ".sidebar nav" : ".bottom-nav")
        .getByRole("button", { name, exact: true })
        .click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `docs/v1.2.1/${info.project.name}-${name}-${width}.png`,
        fullPage: true,
      });
    }
  });
test("空白清理预览、取消确认、下载备份与有效草稿保护", async ({ page }) => {
  await page.goto("/");
  await start(page);
  await page.getByLabel("坐姿推胸 第1组重量").fill("20");
  await page.getByLabel("坐姿推胸 第1组次数").fill("10");
  await page.getByRole("button", { name: "关闭训练记录" }).click();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("fitness-os-real");
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction(
        ["workoutSessions", "workoutSets"],
        "readwrite",
      );
      const r = tx.objectStore("workoutSessions").getAll();
      r.onsuccess = () =>
        tx
          .objectStore("workoutSessions")
          .put({ ...r.result[0], id: "synthetic-empty-draft" });
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.reload();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "训练", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "继续训练", exact: true }),
  ).toBeVisible();
  await page.getByText("检查 1 份空白草稿", { exact: true }).click();
  await page.getByRole("button", { name: "预览安全清理" }).click();
  await expect(page.getByRole("dialog")).toContainText("创建");
  page.once("dialog", (d) => d.dismiss());
  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "备份并确认清理" }).click();
  await download;
  expect(await count(page)).toBe(2);
  page.once("dialog", (d) => d.accept());
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "备份并确认清理" }).click();
  await download;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await count(page)).toBe(1);
  await page.locator(".session-row").click();
  await expect(page.getByLabel("坐姿推胸 第1组重量")).toHaveValue("20");
});
test("新训练自动保存后放弃本次修改，不恢复出初始空白草稿", async ({ page }) => {
  await page.goto("/");
  await start(page);
  await page.getByLabel("坐姿推胸 第1组重量").fill("20");
  await expect(page.locator(".save-state")).toHaveText("已保存");
  expect(await count(page)).toBe(1);
  await page.getByRole("button", { name: "训练更多操作" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "放弃本次修改" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await count(page)).toBe(0);
});
test("历史优先显示完成训练，并保留未完成训练", async ({ page }) => {
  await page.goto("/");
  await start(page);
  await page.getByLabel("坐姿推胸 第1组重量").fill("20");
  await page.getByLabel("坐姿推胸 第1组次数").fill("10");
  await page.getByRole("button", { name: "完成训练", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "训练完成总结" }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("fitness-os-real");
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction(
        ["workoutSessions", "workoutSets"],
        "readwrite",
      );
      const a = tx.objectStore("workoutSessions").getAll();
      a.onsuccess = () => {
        const s = a.result[0];
        tx.objectStore("workoutSessions").put({
          ...s,
          id: "synthetic-incomplete",
          status: "incomplete",
          updatedAt: new Date().toISOString(),
        });
      };
      const b = tx.objectStore("workoutSets").getAll();
      b.onsuccess = () => {
        for (const s of b.result)
          tx.objectStore("workoutSets").put({
            ...s,
            id: "synthetic-" + s.id,
            sessionId: "synthetic-incomplete",
          });
      };
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.reload();
  await expect(page.locator(".session-row")).toHaveCount(2);
  await expect(page.locator(".session-row").first()).toContainText("已完成");
  await expect(page.locator(".session-row").last()).toContainText("未完成");
});
