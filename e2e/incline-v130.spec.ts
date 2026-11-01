import { test, expect } from "@playwright/test";
test("爬坡默认、新增、防重复、同日多次、编辑、删除确认、离线及布局", async ({
  page,
  context,
}, info) => {
  await page.goto("/#record");
  await page.getByRole("button", { name: "跑步机爬坡", exact: true }).click();
  const log = page.getByRole("region", { name: "跑步机爬坡" });
  await expect(log.getByLabel("时长（分钟）")).toHaveValue("40");
  await expect(log.getByLabel("坡度（%）")).toHaveValue("10");
  await expect(log.getByLabel("速度（km/h）")).toHaveValue("4.7");
  await expect(log.locator(".incline-history")).toHaveCount(0);
  await log.getByLabel("时长（分钟）").fill("");
  await log.getByRole("button", { name: "保存爬坡记录", exact: true }).click();
  await expect(log.locator(".incline-history")).toHaveCount(0);
  await log.getByLabel("时长（分钟）").fill("40");
  await log
    .getByRole("button", { name: "保存爬坡记录", exact: true })
    .dblclick();
  await expect(log.locator(".incline-history")).toHaveCount(1);
  await log.getByRole("button", { name: "记录另一次训练" }).click();
  await log.getByLabel("时长（分钟）").fill("30.5");
  await log.getByRole("button", { name: "保存爬坡记录", exact: true }).click();
  await expect(log.locator(".incline-history")).toHaveCount(2);
  await expect(log).toContainText("70.5 分钟 · 2 次");
  await page.reload();
  await page.getByRole("button", { name: "跑步机爬坡", exact: true }).click();
  await expect(log.getByLabel("时长（分钟）")).toHaveValue("30.5");
  await log
    .locator(".incline-history")
    .first()
    .getByRole("button", { name: "编辑" })
    .click();
  await log.getByLabel("时长（分钟）").fill("20");
  await log.getByRole("button", { name: "保存修改" }).click();
  await expect(log).toContainText("60 分钟 · 2 次");
  page.once("dialog", (d) => d.dismiss());
  await log
    .locator(".incline-history")
    .first()
    .getByRole("button", { name: "删除" })
    .click();
  await expect(log.locator(".incline-history")).toHaveCount(2);
  page.once("dialog", (d) => d.accept());
  await log
    .locator(".incline-history")
    .first()
    .getByRole("button", { name: "删除" })
    .click();
  await expect(log.locator(".incline-history")).toHaveCount(1);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.getByRole("button", { name: "跑步机爬坡", exact: true }).click();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "跑步机爬坡", exact: true }).click();
  await expect(log.locator(".incline-history")).toHaveCount(1);
  await log
    .locator(".incline-history")
    .getByRole("button", { name: "编辑" })
    .click();
  await log.getByLabel("速度（km/h）").fill("5.1");
  await log.getByRole("button", { name: "保存修改" }).click();
  await expect(log.locator(".incline-history")).toContainText("5.1km/h");
  await context.setOffline(false);
  for (const width of [320, 375, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/v1.3.0/${info.project.name}-incline-${width}.png`,
      fullPage: true,
    });
  }
});
test("日常入口精简，力量仍能完成并导出 AI 包", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开始记录", exact: false }).click();
  await expect(
    page.getByRole("dialog").getByLabel("器械标识", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "动作详情", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("坐姿推胸 第1组重量").fill("20");
  await page.getByLabel("坐姿推胸 第1组次数").fill("10");
  await page.getByRole("button", { name: "完成训练", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "训练完成总结" }),
  ).toBeVisible();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "趋势", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "记录身体指标" })).toHaveCount(
    0,
  );
  await expect(page.locator(".body-summary")).toHaveCount(0);
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "AI 周报", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出分析 JSON", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/json$/);
});

test("补录、非法输入、历史持久化、失败重试及AI内容", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#record");
  await page.getByRole("button", { name: "跑步机爬坡", exact: true }).click();
  const log = page.getByRole("region", { name: "跑步机爬坡" });
  for (const [field, value] of [
    ["时长（分钟）", "0"],
    ["时长（分钟）", "-1"],
    ["坡度（%）", "-1"],
    ["速度（km/h）", "-1"],
  ]) {
    await log.getByLabel(field).fill(value);
    await log
      .getByRole("button", { name: "保存爬坡记录", exact: true })
      .click();
    await expect(log.locator(".incline-history")).toHaveCount(0);
    await log
      .getByLabel(field)
      .fill(
        field === "时长（分钟）" ? "40" : field === "坡度（%）" ? "10" : "4.7",
      );
  }
  await log.getByLabel("训练日期").fill("2025-12-31");
  await log.getByLabel("时长（分钟）").fill("12.25");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: any[]) {
      if (this.name === "inclineRecords") {
        IDBObjectStore.prototype.put = original;
        throw new Error("synthetic write failure");
      }
      return original.apply(this, args as any);
    };
  });
  await log.getByRole("button", { name: "保存爬坡记录", exact: true }).click();
  await expect(log.getByRole("status")).toContainText(
    "synthetic write failure",
  );
  await expect(
    log.getByRole("button", { name: "保存爬坡记录", exact: true }),
  ).toBeEnabled();
  await log.getByRole("button", { name: "保存爬坡记录", exact: true }).click();
  await expect(log.locator(".incline-history")).toContainText("2025-12-31");
  await page.reload();
  await page.getByRole("button", { name: "跑步机爬坡", exact: true }).click();
  await expect(log.locator(".incline-history")).toHaveCount(1);
  await log.getByRole("button", { name: "记录另一次训练" }).click();
  await log.getByRole("button", { name: "保存爬坡记录", exact: true }).click();
  await expect(log.locator(".incline-history")).toHaveCount(2);
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "AI 周报", exact: true })
    .click();
  const { readFile } = await import("node:fs/promises");
  let event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出分析 JSON", exact: true })
    .click();
  const pack = JSON.parse(
    await readFile((await (await event).path())!, "utf8"),
  );
  expect(pack.inclineRecords).toHaveLength(1);
  expect(pack.inclineThisWeek).toEqual({ count: 1, minutes: 12.25 });
  expect(pack.workoutSets).toEqual([]);
  expect(pack.recent7).toEqual([]);
  event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Markdown" }).click();
  const md = await readFile((await (await event).path())!, "utf8");
  expect(md).toContain("inclineRecords");
  expect(md).toContain("12.25");
  expect(errors).toEqual([]);
});

test("长历史按日期倒序分页，同日多次不合并，编辑日期后重排", async ({
  page,
}) => {
  await page.goto("/#record");
  await expect(page.locator(".page-heading")).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("fitness-os-real");
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("inclineRecords", "readwrite");
      for (let i = 0; i < 45; i++) {
        const now = new Date().toISOString();
        tx.objectStore("inclineRecords").put({
          id: "synthetic-incline-" + i,
          createdAt: now,
          updatedAt: now,
          date: i === 44 ? "2025-12-31" : "2026-01-01",
          minutes: i + 1,
          incline: 10,
          speed: 4.7,
        });
      }
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.reload();
  await page.getByRole("button", { name: "跑步机爬坡", exact: true }).click();
  const log = page.getByRole("region", { name: "跑步机爬坡" });
  await expect(log.locator(".incline-history")).toHaveCount(20);
  await expect(log.locator(".incline-history").first()).toContainText(
    "2026-01-01",
  );
  await log.getByRole("button", { name: "更多爬坡记录" }).click();
  await expect(log.locator(".incline-history")).toHaveCount(40);
  await log.getByRole("button", { name: "更多爬坡记录" }).click();
  await expect(log.locator(".incline-history")).toHaveCount(45);
  await expect(log.locator(".incline-history").last()).toContainText(
    "2025-12-31",
  );
  await log
    .locator(".incline-history")
    .last()
    .getByRole("button", { name: "编辑" })
    .click();
  await log.getByLabel("训练日期").fill("2026-01-02");
  await log.getByRole("button", { name: "保存修改" }).click();
  await expect(log.locator(".incline-history").first()).toContainText(
    "2026-01-02",
  );
  await expect(log.locator(".incline-history")).toHaveCount(45);
  await page.reload();
  await page.getByRole("button", { name: "跑步机爬坡", exact: true }).click();
  await expect(log.getByLabel("时长（分钟）")).toHaveValue("45");
});
