import { chromium, webkit, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const base = "https://a13532810-glitch.github.io/fitness-os/";
const stage = process.argv[2];
assert(["before", "after"].includes(stage), "Pass before or after");
const root = resolve(".local/release-v1.2");
mkdirSync(root, { recursive: true });
const summaries = [];
async function snapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("fitness-os-real");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const names = Array.from(db.objectStoreNames);
    const data = await Promise.all(
      names.map(
        (name) =>
          new Promise((resolve, reject) => {
            const r = db.transaction(name).objectStore(name).getAll();
            r.onsuccess = () => resolve([name, r.result]);
            r.onerror = () => reject(r.error);
          }),
      ),
    );
    db.close();
    return Object.fromEntries(data);
  });
}
for (const [name, engine] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const profile = resolve(root, name + "-isolated-profile");
  if (stage === "before")
    assert(
      !readFileSafe(resolve(root, name + "-before.json")),
      "Baseline already exists; do not reuse or overwrite it",
    );
  const context = await engine.launchPersistentContext(profile, {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
    ...(name === "chromium"
      ? {
          executablePath:
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        }
      : {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = async (label) =>
    page.screenshot({
      path: resolve(root, `${name}-${label}.png`),
      fullPage: !["editor", "add"].includes(label),
    });
  const nav = async (label) =>
    page
      .locator(".bottom-nav")
      .getByRole("button", { name: label, exact: true })
      .click();
  const dataPage = async () => {
    await nav("总览");
    await page.getByRole("button", { name: "总览更多操作" }).click();
    await page.getByRole("button", { name: "数据管理", exact: true }).click();
  };
  try {
    await page.goto(base);
    await page.locator(".page-heading").waitFor();
    if (stage === "before") {
      await expect(page.locator('meta[name="fitness-build"]')).toHaveAttribute(
        "content",
        "1.1.1",
      );
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      await page.reload();
      await expect
        .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
        .toBe(true);
      await page
        .getByRole("button", { name: "开始记录", exact: false })
        .click();
      await page.getByLabel("坐姿推胸 第1组重量").fill("17.5");
      await page.getByLabel("坐姿推胸 第1组次数").fill("9");
      await page
        .getByRole("button", { name: "保存并关闭", exact: true })
        .click();
      const data = await snapshot(page);
      assert.equal(data.workoutSessions.length, 1);
      assert.equal(data.workoutSets.filter((s) => s.weight !== null).length, 1);
      writeFileSync(resolve(root, name + "-before.json"), JSON.stringify(data));
      summaries.push({
        engine: name,
        stage,
        oldVersion: "1.1.1",
        syntheticDraftSaved: true,
        isolatedProfile: true,
      });
    } else {
      if (
        (await page
          .locator('meta[name="fitness-build"]')
          .getAttribute("content")) !== "1.2.0"
      ) {
        await page.evaluate(async () => {
          await (await navigator.serviceWorker.ready).update();
        });
        await page
          .getByRole("button", { name: "更新应用", exact: true })
          .click({ timeout: 60000 });
      }
      await expect(page.locator('meta[name="fitness-build"]')).toHaveAttribute(
        "content",
        "1.2.0",
        { timeout: 30000 },
      );
      assert.deepEqual(
        await snapshot(page),
        JSON.parse(readFileSync(resolve(root, name + "-before.json"), "utf8")),
      );
      const reg = await page.evaluate(async () => {
        const r = await navigator.serviceWorker.ready;
        return { scope: r.scope, script: r.active.scriptURL };
      });
      assert.equal(reg.scope, base);
      assert.equal(reg.script, base + "sw.js");
      await expect(page.locator(".bottom-nav button")).toHaveText([
        "总览",
        "训练",
        "趋势",
        "AI 周报",
      ]);
      await nav("总览");
      await expect(page.locator(".page-heading h1")).toHaveText("训练总览");
      await shot("overview");
      await page.getByRole("button", { name: /还有一份训练草稿/ }).click();
      await expect(page.getByLabel("坐姿推胸 第1组重量")).toHaveValue("17.5");
      const row = page.locator(".set-row").first();
      const w = await row.locator("input").nth(0).boundingBox();
      const x = await row.locator(".set-multiply").boundingBox();
      const r = await row.locator("input").nth(1).boundingBox();
      assert(w.x + w.width <= x.x && x.x + x.width <= r.x);
      await page.getByLabel("坐姿推胸 第1组重量").fill("25.25");
      await page.getByLabel("坐姿推胸 第1组次数").fill("11");
      await shot("editor");
      await page.getByRole("button", { name: "添加动作", exact: true }).click();
      await page.getByLabel("选择要添加的动作").selectOption({ label: "腿举" });
      await shot("add");
      await page
        .locator(".action-picker")
        .getByRole("button", { name: "添加动作", exact: true })
        .click();
      await page.getByRole("button", { name: "完成训练", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await nav("趋势");
      await shot("trends");
      await nav("AI 周报");
      await expect(page.locator(".page-heading h1")).toHaveText("AI 周报");
      const exportAI = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "导出分析 JSON", exact: true })
        .click();
      const ai = await exportAI;
      const pack = JSON.parse(readFileSync(await ai.path(), "utf8"));
      assert.equal(pack.history28.length, 1);
      await shot("ai");
      await dataPage();
      await page.getByRole("button", { name: "检查数据完整性" }).click();
      await expect(page.getByRole("status")).toContainText("数据完整");
      const exporting = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "导出完整 JSON 备份", exact: true })
        .click();
      const file = await exporting;
      const backup = JSON.parse(readFileSync(await file.path(), "utf8"));
      assert.equal(backup.version, 1);
      assert.equal(backup.data.workoutSessions.length, 1);
      await shot("data");
      await nav("训练");
      await page.locator(".session-row").first().click();
      await page.getByRole("button", { name: "训练更多操作" }).click();
      page.once("dialog", (d) => d.accept());
      const deletionBackup = page.waitForEvent("download");
      await page.getByRole("button", { name: "删除训练", exact: true }).click();
      await deletionBackup;
      await expect(page.getByRole("dialog")).toHaveCount(0);
      assert.equal((await snapshot(page)).workoutSessions.length, 0);
      await dataPage();
      const auto = page.waitForEvent("download");
      await page
        .getByLabel("选择备份文件")
        .setInputFiles({
          name: "synthetic-v12-restore.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(backup)),
        });
      await auto;
      await page.getByLabel("我已确认导入前备份文件保存成功").check();
      await page.getByRole("button", { name: "确认合并恢复" }).click();
      await expect(
        page.getByText("恢复成功；", { exact: false }),
      ).toBeVisible();
      const restored = await snapshot(page);
      assert.deepEqual(restored.workoutSessions, backup.data.workoutSessions);
      assert.deepEqual(restored.workoutSets, backup.data.workoutSets);
      await context.setOffline(true);
      await page.reload();
      await nav("训练");
      await page.locator(".session-row").first().click();
      await expect(page.getByLabel("坐姿推胸 第1组重量")).toHaveValue("25.25");
      await page.getByLabel("坐姿推胸 第1组次数").fill("12");
      await page
        .getByRole("button", { name: "保存并关闭", exact: true })
        .click();
      await page.reload();
      await page.locator(".session-row").first().click();
      await expect(page.getByLabel("坐姿推胸 第1组次数")).toHaveValue("12");
      await page
        .getByRole("button", { name: "保存并关闭", exact: true })
        .click();
      await context.setOffline(false);
      await page.reload();
      await expect(page.locator('meta[name="fitness-build"]')).toHaveAttribute(
        "content",
        "1.2.0",
      );
      assert.deepEqual(errors, []);
      summaries.push({
        engine: name,
        stage,
        version: "1.2.0",
        productionURL: base,
        oldServiceWorkerUpgrade: true,
        allLegacyFieldsPreserved: true,
        overview: true,
        minimalEditor: true,
        multiplicationLayout: true,
        fourTabs: true,
        addExercise: true,
        dataManagement: true,
        aiJSONExport: true,
        backupExportDeleteAndRestore: true,
        offlineColdStartAndEdit: true,
        onlinePersistence: true,
        serviceWorker: reg,
        pageErrors: errors,
        realIPhoneTested: false,
        syntheticDataOnly: true,
      });
    }
    console.log(name, stage, "PASS");
  } finally {
    await context.close();
  }
}
writeFileSync(
  resolve(root, stage + "-results.json"),
  JSON.stringify(
    { checkedAt: new Date().toISOString(), results: summaries },
    null,
    2,
  ) + "\n",
);
function readFileSafe(path) {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}
