import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
const root = "artifacts/v1.2";
mkdirSync(root, { recursive: true });
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "开始记录", exact: false }).click();
}
async function fill(page: Page, weight = "20.5") {
  await page.getByLabel("坐姿推胸 第1组重量").fill(weight);
  await page.getByLabel("坐姿推胸 第1组次数").fill("10");
  await expect(page.locator(".save-state")).toHaveText("已保存");
}
for (const width of [320, 375, 390, 430])
  test(`V1.2 四导航、输入乘号与动作库 ${width}px 深浅色`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/");
      await expect(page.locator(".bottom-nav button")).toHaveText([
        "总览",
        "训练",
        "趋势",
        "AI 周报",
      ]);
      await expect(page.locator(".page-heading h1")).toHaveText("训练总览");
      await page.screenshot({
        path: `${root}/${info.project.name}-overview-${width}-${theme}.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "开始记录", exact: false })
        .click();
      await expect(
        page.locator('.exercise-toggle[aria-expanded="true"]'),
      ).toHaveCount(1);
      await expect(
        page.getByText(/首次记录|尚无已确认目标|历史比较可信度有限/),
      ).toHaveCount(0);
      await expect(page.getByLabel("主观疲劳")).toHaveCount(0);
      await expect(page.getByLabel("训练感受")).toHaveCount(0);
      const row = page.locator(".set-row").first();
      const w = await row.locator("input").nth(0).boundingBox();
      const x = await row.locator(".set-multiply").boundingBox();
      const r = await row.locator("input").nth(1).boundingBox();
      expect(w!.x + w!.width).toBeLessThanOrEqual(x!.x);
      expect(x!.x + x!.width).toBeLessThanOrEqual(r!.x);
      expect(
        Math.abs(w!.y + w!.height / 2 - (x!.y + x!.height / 2)),
      ).toBeLessThan(2);
      await expect(row.locator("button")).toHaveAttribute(
        "aria-label",
        "移除坐姿推胸第1组",
      );
      expect(
        await page
          .getByRole("dialog")
          .evaluate((e) => e.scrollWidth <= e.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path: `${root}/${info.project.name}-editor-${width}-${theme}.png`,
      });
      await row.screenshot({
        path: `${root}/${info.project.name}-inputs-${width}-${theme}.png`,
      });
      await page.getByRole("button", { name: "添加动作", exact: true }).click();
      await page.getByLabel("选择要添加的动作").selectOption({ label: "腿举" });
      await page.screenshot({
        path: `${root}/${info.project.name}-add-${width}-${theme}.png`,
      });
      await page
        .locator(".action-picker")
        .getByRole("button", { name: "添加动作", exact: true })
        .click();
      await expect(
        page.locator('.exercise-toggle[aria-expanded="true"]'),
      ).toContainText("腿举");
      await page.getByRole("button", { name: "关闭训练记录" }).click();
    }
  });
test("V1.2 已填写组取消删除、草稿放弃修改、整次删除前恢复备份", async ({
  page,
}) => {
  await start(page);
  await fill(page);
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "移除坐姿推胸第1组", exact: true })
    .click();
  await expect(page.getByLabel("坐姿推胸 第1组重量")).toHaveValue("20.5");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.getByRole("button", { name: /还有一份训练草稿/ }).click();
  await fill(page, "30");
  await page.getByRole("button", { name: "训练更多操作" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "放弃本次修改" }).click();
  await page.getByRole("button", { name: /还有一份训练草稿/ }).click();
  await expect(page.getByLabel("坐姿推胸 第1组重量")).toHaveValue("20.5");
  await page.getByRole("button", { name: "训练更多操作" }).click();
  const download = page.waitForEvent("download");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除训练", exact: true }).click();
  const file = await download;
  const backup = JSON.parse(readFileSync((await file.path())!, "utf8"));
  expect(backup.version).toBe(1);
  expect(
    backup.data.workoutSets.find(
      (s: { weight: number | null }) => s.weight !== null,
    ).weight,
  ).toBe(20.5);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "总览更多操作" }).click();
  await page.getByRole("button", { name: "数据管理", exact: true }).click();
  const before = page.waitForEvent("download");
  await page.getByLabel("选择备份文件").setInputFiles({
    name: "synthetic-restore.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await before;
  await page.getByLabel("我已确认导入前备份文件保存成功").check();
  await page.getByRole("button", { name: "确认合并恢复" }).click();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "总览", exact: true })
    .click();
  await page.getByRole("button", { name: /还有一份训练草稿/ }).click();
  await expect(page.getByLabel("坐姿推胸 第1组重量")).toHaveValue("20.5");
});
test("V1.2 浏览器前后退与重新启动导航", async ({ page }) => {
  await page.goto("/");
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "趋势", exact: true })
    .click();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "AI 周报", exact: true })
    .click();
  await page.goBack();
  await expect(page.locator(".page-heading h1")).toHaveText("进步趋势");
  await page.goForward();
  await expect(page.locator(".page-heading h1")).toHaveText("AI 周报");
  await page.reload();
  await expect(page.locator(".page-heading h1")).toHaveText("AI 周报");
});
