import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
const root = "artifacts/v1.1.1/after";
mkdirSync(root, { recursive: true });
for (const width of [320, 375, 390, 430])
  test(`单空间、每周图表与身体指标 ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() =>
      localStorage.setItem("fitness-os-mode", "demo"),
    );
    await page.goto("/");
    await expect(page.locator(".page-heading")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /演示|开启我的|正式空间/ }),
    ).toHaveCount(0);
    const nav = async (name: string) => {
      if (name === "数据管理") {
        await page
          .locator(".bottom-nav")
          .getByRole("button", { name: "总览", exact: true })
          .click();
        await page.getByRole("button", { name: "总览更多操作" }).click();
        await page
          .getByRole("button", { name: "数据管理", exact: true })
          .click();
        return;
      }
      await page
        .locator(".bottom-nav")
        .getByRole("button", { name, exact: true })
        .click();
    };
    await page.screenshot({
      path: `${root}/${info.project.name}-overview-${width}.png`,
      fullPage: true,
    });
    await nav("趋势");
    await expect(
      page.getByText("暂无已完成训练", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".bar-chart")).toHaveCount(0);
    await page.screenshot({
      path: `${root}/${info.project.name}-weekly-empty-${width}.png`,
      fullPage: true,
    });
    // Create a record via the public UI, then edit the same ID and verify persistence.
    await page
      .getByRole("button", { name: "记录身体指标", exact: true })
      .click();
    await page.getByRole("button", { name: "保存身体指标" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("体重（kg）").fill("74.2");
    await page.getByLabel("腰围（cm）").fill("85.5");
    await page.getByLabel("测量条件或备注（选填）").fill("隔离自动测试");
    await page.getByLabel("体重（kg）").focus();
    const bounds = await page.getByRole("dialog").boundingBox();
    expect(bounds!.x).toBeGreaterThan(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(
      await page
        .getByRole("dialog")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `${root}/${info.project.name}-body-${width}.png`,
    });
    await page.getByRole("button", { name: "保存身体指标" }).click();
    await page.getByText("查看身体指标明细").click();
    await page.getByRole("button", { name: /编辑身体指标/ }).click();
    await expect(page.getByLabel("体重（kg）")).toHaveValue("74.2");
    await page.getByLabel("体重（kg）").fill("74.3");
    await page.getByRole("button", { name: "保存身体指标" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await nav("趋势");
    await page.getByText("查看身体指标明细").click();
    await expect(
      page.locator(".history-line").filter({ hasText: "74.3kg" }),
    ).toHaveCount(1);
    // Only this disposable test context receives synthetic dated records. Never production profiles.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("fitness-os-real");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const tx = db.transaction("workoutSessions", "readwrite");
      const now = new Date();
      now.setHours(12, 0, 0, 0);
      const weekday = (now.getDay() + 6) % 7;
      now.setDate(now.getDate() - weekday);
      for (let w = 0; w < 8; w++) {
        const d = new Date(now);
        d.setDate(d.getDate() - w * 7);
        const date = [
          d.getFullYear(),
          String(d.getMonth() + 1).padStart(2, "0"),
          String(d.getDate()).padStart(2, "0"),
        ].join("-");
        for (let n = 0; n < (w === 0 ? 23 : w % 3); n++)
          tx.objectStore("workoutSessions").put({
            id: `synthetic-${w}-${n}`,
            date,
            status: "completed",
            kind: "A",
            items: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
      }
      tx.objectStore("workoutSessions").put({
        id: "synthetic-draft",
        duration: null,
        fatigue: "",
        notes: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        date: new Date().toISOString().slice(0, 10),
        status: "draft",
        kind: "A",
        items: [],
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await page.reload();
    for (const theme of ["light", "dark"]) {
      await nav("数据管理");
      await page.getByLabel("显示模式").selectOption(theme);
      await nav("趋势");
      await expect(page.locator(".bar-chart > div")).toHaveCount(8);
      await expect(page.locator(".bar-chart b").last()).toHaveText("23");
      for (const label of await page.locator(".bar-chart small").all())
        expect(
          await label.evaluate((e) => e.getBoundingClientRect().height),
        ).toBeLessThan(25);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `${root}/${info.project.name}-weekly-${width}-${theme}.png`,
        fullPage: true,
      });
    }
  });

test("旧演示偏好与独立演示库不影响个人训练库，未知来源记录原样保留", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".page-heading")).toBeVisible();
  const inspect = () =>
    page.evaluate(async () => {
      const read = async (name: string) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open(name);
          r.onupgradeneeded = () =>
            r.result
              .createObjectStore("legacyMarker", { keyPath: "id" })
              .add({ id: "unknown-origin", notes: "retain unchanged" });
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const names = Array.from(db.objectStoreNames);
        const tx = db.transaction(names, "readonly");
        const rows = await Promise.all(
          names.map(
            (name) =>
              new Promise((resolve) => {
                const r = tx.objectStore(name).getAll();
                r.onsuccess = () => resolve([name, r.result]);
              }),
          ),
        );
        db.close();
        return rows;
      };
      return {
        real: await read("fitness-os-real"),
        demo: await read("fitness-os-demo"),
      };
    });
  const before = await inspect();
  await page.evaluate(() => localStorage.setItem("fitness-os-mode", "demo"));
  await page.reload();
  await expect(page.locator(".page-heading")).toBeVisible();
  expect(await inspect()).toEqual(before);
  await expect(page.getByText("正式空间", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /演示/ })).toHaveCount(0);
});
