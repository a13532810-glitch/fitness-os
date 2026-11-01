import { seedLegacyBody, readTestDatabase } from "./fixtures";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { localDate, shiftDate } from "../src/model";
test("身体界面移除后旧零、一、两条记录逐字段保留，备份恢复不丢失", async ({
  page,
}) => {
  await page.goto("/#trends");
  await expect(page.locator(".page-heading")).toBeVisible();
  for (const count of [0, 1, 2]) {
    if (count) await seedLegacyBody(page, count);
    await expect(page.locator(".body-summary,.body-trends")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "记录身体指标" }),
    ).toHaveCount(0);
    const before = await readTestDatabase(page);
    expect(before.bodyMetrics).toHaveLength(count);
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
    expect(backup.data.bodyMetrics).toEqual(before.bodyMetrics);
    await page.reload();
    expect((await readTestDatabase(page)).bodyMetrics).toEqual(
      before.bodyMetrics,
    );
  }
});
test("目标默认精简；高级依据必填且保存后仍待确认", async ({ page }, info) => {
  await page.goto("/#trends");
  await page.getByRole("button", { name: "制定下次目标" }).click();
  await expect(page.getByLabel("目标组数")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByLabel("器械标识", { exact: true }),
  ).toBeHidden();
  await page.screenshot({
    path: `artifacts/v1.3.0/regression/${info.project.name}-goal.png`,
  });
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
    path: `artifacts/v1.3.0/regression/${info.project.name}-ai-filled.png`,
    fullPage: true,
  });
});
