import { test, expect } from "@playwright/test";
import { localDate, shiftDate } from "../src/model";
test("身体指标独立判断零、一、两个点；删除必须确认", async ({ page }, info) => {
  await page.goto("/#trends");
  await expect(page.locator(".page-heading")).toBeVisible();
  await expect(page.locator(".body-summary .panel")).toHaveCount(2);
  await expect(page.locator(".body-trends svg")).toHaveCount(0);
  for (let n = 0; n < 2; n++) {
    await page
      .getByRole("button", { name: "记录身体指标", exact: true })
      .click();
    await page.getByLabel("测量日期").fill(shiftDate(localDate(), n - 1));
    await page.getByLabel("体重（kg）").fill(n ? "74.1" : "74.3");
    if (!n) await page.getByLabel("腰围（cm）").fill("85.5");
    await page.getByRole("button", { name: "保存身体指标" }).click();
    await expect(page.locator(".body-trends svg")).toHaveCount(n);
  }
  await expect(page.locator(".body-summary")).toContainText("74.1");
  await expect(page.locator(".body-summary")).toContainText("85.5");
  await page.screenshot({
    path: `docs/v1.2.1/${info.project.name}-body-independent.png`,
    fullPage: true,
  });
  await page.getByText("查看身体指标明细", { exact: true }).click();
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: /删除身体指标/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: /删除身体指标/ })).toHaveCount(
    2,
  );
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: /删除身体指标/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: /删除身体指标/ })).toHaveCount(
    1,
  );
});
test("目标默认精简；高级依据必填且保存后仍待确认", async ({ page }, info) => {
  await page.goto("/#trends");
  await page.getByRole("button", { name: "制定下次目标" }).click();
  await expect(page.getByLabel("目标组数")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByLabel("器械标识", { exact: true }),
  ).toBeHidden();
  await page.screenshot({ path: `docs/v1.2.1/${info.project.name}-goal.png` });
  await page.getByRole("button", { name: "保存为待确认目标" }).click();
  await expect(
    page.getByRole("dialog").getByLabel("器械标识", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByLabel("器械标识", { exact: true })
    .fill("测试机器");
  await page
    .getByRole("dialog")
    .getByLabel("动作方式", { exact: true })
    .fill("测试设置");
  await page.getByLabel("制定依据").fill("隔离测试的手动目标，非实际成绩");
  await page.getByRole("button", { name: "保存为待确认目标" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "本人确认", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("已确认", { exact: true })).toHaveCount(0);
});
test("周报编辑更新原记录，Markdown和复制提示词仍可用", async ({
  page,
}, info) => {
  await page.goto("/#ai");
  await page.getByLabel("分析结论或个人复盘").fill("隔离测试周报原文");
  await page.getByRole("button", { name: "保存周报", exact: true }).click();
  await page.locator(".report > summary").click();
  await page.getByRole("button", { name: "编辑周报" }).click();
  await expect(page.getByLabel("分析结论或个人复盘")).toHaveValue(
    "隔离测试周报原文",
  );
  await page.getByLabel("分析结论或个人复盘").fill("隔离测试周报修订");
  await page.getByRole("button", { name: "保存周报", exact: true }).click();
  await expect(page.locator(".report")).toHaveCount(1);
  await expect(page.locator(".report-text")).toHaveText("隔离测试周报修订");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Markdown" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.md$/);
  await page.getByRole("button", { name: "复制 ChatGPT 分析提示词" }).click();
  await expect(
    page.getByText(/ChatGPT 分析提示词已复制|当前浏览器无法自动复制/),
  ).toBeVisible();
  await page.screenshot({
    path: `docs/v1.2.1/${info.project.name}-ai-filled.png`,
    fullPage: true,
  });
});
