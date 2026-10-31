import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const before = process.env.FITNESS_CAPTURE_BASELINE === "1";
const phase = before ? "before" : "after";
const root = "docs/v1.2";
mkdirSync(root, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.FITNESS_CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
// Always use an isolated, empty context. Never attach to personal Safari/Chrome profiles.
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  colorScheme: "light",
});
const metrics = {};
const shot = async (name) => {
  await page.screenshot({
    path: `${root}/${phase}-${name}.png`,
    fullPage: !["editor", "add", "body"].includes(name),
  });
};
const nav = async (name) =>
  page
    .locator(".bottom-nav")
    .getByRole("button", { name, exact: true })
    .click();
try {
  await page.goto(process.env.FITNESS_CAPTURE_URL ?? "http://127.0.0.1:4181");
  await page.locator(".page-heading").waitFor();
  metrics.overviewHeight = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  await shot("overview");
  await nav(before ? "记录" : "训练");
  await shot("training");
  await nav(before ? "首页" : "总览");
  await page.getByRole("button", { name: "开始记录", exact: false }).click();
  await page.getByRole("dialog").waitFor();
  metrics.editorHeight = await page
    .getByRole("dialog")
    .evaluate((e) => e.scrollHeight);
  metrics.visibleTextLength = await page
    .getByRole("dialog")
    .evaluate((e) => e.innerText.length);
  await shot("editor");
  await page
    .locator(".set-row")
    .first()
    .screenshot({ path: `${root}/${phase}-inputs.png` });
  if (before) await page.locator(".workout-more > summary").click();
  else
    await page.getByRole("button", { name: "添加动作", exact: true }).click();
  await page.getByLabel("选择要添加的动作").selectOption({ label: "腿举" });
  await page.getByLabel("选择要添加的动作").scrollIntoViewIfNeeded();
  await shot("add");
  await page.getByRole("button", { name: "关闭训练记录" }).click();
  await nav("趋势");
  await shot("trends");
  await page.getByRole("button", { name: "记录身体指标", exact: true }).click();
  await shot("body");
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await nav(before ? "AI" : "AI 周报");
  await shot("ai");
  if (before) await nav("设置");
  else {
    await nav("总览");
    await page.getByRole("button", { name: "总览更多操作" }).click();
    await page.getByRole("button", { name: "数据管理", exact: true }).click();
  }
  await shot("data");
  writeFileSync(
    `${root}/${phase}-layout.json`,
    JSON.stringify(metrics, null, 2) + "\n",
  );
  console.log(phase, metrics);
} finally {
  await browser.close();
}
