import { expect, type Page } from "@playwright/test";
// Explicitly synthetic records in Playwright's disposable, isolated browser context only.
export async function seedHistory(page: Page) {
  await expect(page.locator(".page-heading")).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "开始记录", exact: false }).click();
    await page
      .getByRole("dialog")
      .getByLabel(/第1组重量/)
      .first()
      .fill("20");
    await page
      .getByRole("dialog")
      .getByLabel(/第1组次数/)
      .first()
      .fill("10");
    await page.getByRole("button", { name: "完成训练", exact: true }).click();
    await page.getByRole("region", { name: "训练完成总结" }).waitFor();
    await page
      .locator(
        page.viewportSize()!.width > 900 ? ".sidebar nav" : ".bottom-nav",
      )
      .getByRole("button", { name: "首页", exact: true })
      .click();
  }
}
export async function clearTestHistory(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("fitness-os-real");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(["workoutSessions", "workoutSets"], "readwrite");
      t.objectStore("workoutSessions").clear();
      t.objectStore("workoutSets").clear();
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.locator(".page-heading")).toBeVisible();
}
