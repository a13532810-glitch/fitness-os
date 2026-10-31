import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
test.use({ deviceScaleFactor: 1 });
const root = "artifacts/v1.1/after";
mkdirSync(root, { recursive: true });
async function nav(page: Page, label: string) {
  const region =
    page.viewportSize()!.width > 900 ? ".sidebar nav" : ".bottom-nav";
  await page
    .locator(region)
    .getByRole("button", { name: label, exact: true })
    .click();
}
async function toggle(page: Page, name: string) {
  const t = page.locator(".exercise-toggle").filter({ hasText: name });
  if ((await t.getAttribute("aria-expanded")) !== "true") await t.click();
}
for (const width of [320, 375, 390, 430, 1440]) {
  test(`五页与记录视觉矩阵 ${width}px，深浅色、空态、大字号及长文本`, async ({
    page,
  }, info) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: width > 900 ? 1000 : 844 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.getByRole("button", { name: "先体验虚构演示" }).click();
    for (const theme of ["light", "dark"]) {
      await nav(page, "设置");
      await page.getByLabel("显示模式").selectOption(theme);
      for (const [name, label] of [
        ["home", "首页"],
        ["record", "记录"],
        ["trends", "趋势"],
        ["ai", "AI"],
        ["settings", "设置"],
      ]) {
        await nav(page, label);
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          )
          .toBe(true);
        await page.screenshot({
          path: `${root}/${info.project.name}-${name}-${width}-${theme}.png`,
          fullPage: true,
        });
      }
      await nav(page, "首页");
      await page
        .getByRole("button", { name: "开始记录", exact: false })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(
        page.locator('.exercise-toggle[aria-expanded="true"]'),
      ).toHaveCount(1);
      await expect(dialog.getByLabel("坐姿推胸 第1组次数")).toHaveValue("");
      await expect(dialog.locator(".exercise-reference").first()).toContainText(
        "上次",
      );
      await expect(dialog.getByLabel("训练时长（分钟）")).not.toBeVisible();
      await expect
        .poll(() => dialog.evaluate((e) => e.scrollWidth <= e.clientWidth))
        .toBe(true);
      await page.screenshot({
        path: `${root}/${info.project.name}-editor-${width}-${theme}.png`,
        fullPage: false,
      });
      await page.getByRole("button", { name: "保存并关闭" }).click();
    }
    await nav(page, "设置");
    await page.getByLabel("显示模式").selectOption("light");
    await page
      .getByRole("button", { name: "返回正式空间", exact: true })
      .click();
    await nav(page, "趋势");
    await expect(
      page.getByText("暂无足够数据", { exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: `${root}/${info.project.name}-empty-${width}.png`,
      fullPage: true,
    });
    await nav(page, "首页");
    await page.getByRole("button", { name: "开始记录", exact: false }).click();
    await page.locator(".equipment-settings > summary").first().click();
    await page
      .getByRole("dialog")
      .getByLabel("器械标识", { exact: true })
      .first()
      .fill(
        "这是用于测试长名称的器械标识 ABCDEFGHIJKLMNOPQRSTUVWXYZ 1234567890".repeat(
          2,
        ),
      );
    await page.evaluate(
      () => (document.documentElement.style.fontSize = "150%"),
    );
    await expect
      .poll(() =>
        page
          .getByRole("dialog")
          .evaluate((e) => e.scrollWidth <= e.clientWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: `${root}/${info.project.name}-large-long-editor-${width}.png`,
      fullPage: false,
    });
    await page.getByRole("button", { name: "保存并关闭" }).click();
    for (const label of ["首页", "记录", "趋势", "AI", "设置"]) {
      await nav(page, label);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
    }
    await page.screenshot({
      path: `${root}/${info.project.name}-large-settings-${width}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
test("极简录入：小数、空值、主动复制、折叠、器械记忆、重复完成防护", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开启我的训练空间" }).click();
  await page.getByRole("button", { name: "开始记录", exact: false }).click();
  const weight = page.getByLabel("坐姿推胸 第1组重量");
  const reps = page.getByLabel("坐姿推胸 第1组次数");
  await weight.fill("22.25");
  await reps.fill("10");
  await weight.fill("");
  await expect(weight).toHaveValue("");
  await weight.fill("22.25");
  await reps.fill("1.5");
  await expect(reps).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "完成训练", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({
    path: `${root}/${info.project.name}-editor-invalid.png`,
    fullPage: true,
  });
  await reps.fill("10");
  await page
    .getByRole("button", { name: "添加一组", exact: true })
    .first()
    .click();
  await page.getByLabel("坐姿推胸 第3组重量").fill("25");
  await page.getByLabel("坐姿推胸 第3组次数").fill("8");
  await page.getByRole("button", { name: "复制上一组重量" }).first().click();
  await expect(page.getByLabel("坐姿推胸 第2组重量")).toHaveValue("22.25");
  await expect(page.getByLabel("坐姿推胸 第2组次数")).toHaveValue("");
  await page.getByLabel("坐姿推胸 第2组次数").fill("9");
  await page.getByRole("button", { name: "复制上一组重量" }).first().click();
  await expect(page.getByLabel("坐姿推胸 第4组重量")).toHaveValue("25");
  await expect(page.getByLabel("坐姿推胸 第4组次数")).toHaveValue("");
  await page.getByLabel("坐姿推胸 第4组次数").fill("7");
  await page.locator(".equipment-settings > summary").first().click();
  await page
    .getByRole("dialog")
    .getByLabel("器械标识", { exact: true })
    .first()
    .fill("胸推V11");
  await page.getByLabel("动作方式 / 座椅设置").first().fill("座椅2");
  await page.getByRole("button", { name: "关闭训练记录" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "还有一份训练草稿", exact: false })
    .click();
  await expect(page.getByLabel("坐姿推胸 第4组次数")).toHaveValue("7");
  await page.screenshot({
    path: `${root}/${info.project.name}-editor-filled.png`,
    fullPage: false,
  });
  // Two synchronous native clicks exercise the ref guard even before React disables the button.
  await page
    .getByRole("button", { name: "完成训练", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(
    page.getByRole("region", { name: "训练完成总结" }),
  ).toBeVisible();
  await expect(page.locator(".session-row")).toHaveCount(1);
  await page.screenshot({
    path: `${root}/${info.project.name}-complete.png`,
    fullPage: true,
  });
  await nav(page, "首页");
  await page.getByRole("button", { name: "开始记录", exact: false }).click();
  // Next is B; switching to A loads A's remembered configuration, keeping actual inputs blank.
  await page.getByLabel("训练类型").selectOption("A");
  await expect(
    page
      .getByText("22.25kg × 10 / 22.25kg × 9 / 25kg × 8 / 25kg × 7", {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await expect(page.getByLabel("坐姿推胸 第1组重量")).toHaveValue("");
  await page.locator(".equipment-settings > summary").first().click();
  await expect(
    page.getByRole("dialog").getByLabel("器械标识", { exact: true }).first(),
  ).toHaveValue("胸推V11");
  await expect(page.getByLabel("动作方式 / 座椅设置").first()).toHaveValue(
    "座椅2",
  );
  await page.getByRole("button", { name: "保存并关闭" }).click();
  await nav(page, "趋势");
  for (const label of ["最近 4 周", "最近 12 周", "全部历史"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
});
test("1000次虚构历史的页面响应与历史分页", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开启我的训练空间" }).click();
  await page.getByRole("button", { name: "开始记录", exact: false }).click();
  await page.getByRole("button", { name: "保存并关闭" }).click();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("fitness-os-real");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const get = <T>(table: string) =>
      new Promise<T[]>((resolve) => {
        const r = db.transaction(table).objectStore(table).getAll();
        r.onsuccess = () => resolve(r.result);
      });
    const session = (await get<any>("workoutSessions"))[0];
    const sets = await get<any>("workoutSets");
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        ["workoutSessions", "workoutSets"],
        "readwrite",
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      for (let n = 0; n < 1000; n++) {
        const id = "synthetic-performance-" + n;
        const date = new Date();
        date.setDate(date.getDate() - n);
        tx.objectStore("workoutSessions").put({
          ...session,
          id,
          date: date.toISOString().slice(0, 10),
          status: "completed",
          notes: "虚构性能验收记录",
        });
        for (const s of sets)
          tx.objectStore("workoutSets").put({
            ...s,
            id: id + "-" + s.id,
            sessionId: id,
            weight: 20,
            reps: 10,
          });
      }
    });
    db.close();
  });
  const boot = Date.now();
  await page.reload();
  await expect(page.locator(".page-heading")).toBeVisible();
  const timings: Record<string, number> = { coldLoad: Date.now() - boot };
  expect(timings.coldLoad).toBeLessThan(5000);
  for (const label of ["记录", "趋势", "首页", "AI"]) {
    const start = Date.now();
    await nav(page, label);
    await expect(page.locator(".page-heading")).toBeVisible();
    timings[label] = Date.now() - start;
    expect(timings[label]).toBeLessThan(5000);
  }
  await nav(page, "记录");
  await expect(page.locator(".session-row")).toHaveCount(30);
  await page.getByRole("button", { name: "查看更多训练" }).click();
  await expect(page.locator(".session-row")).toHaveCount(60);
  await info.attach("synthetic-history-performance", {
    body: JSON.stringify({
      records: 1000,
      sets: 12000,
      timings,
      limitation: "测试机自动化操作，不代表真实iPhone性能。",
    }),
    contentType: "application/json",
  });
});
