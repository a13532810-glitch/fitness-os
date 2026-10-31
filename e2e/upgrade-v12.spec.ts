import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("真实线上 V1.1.1 构建 → V1.2 SW更新 → 旧代码回滚：历史与草稿逐字段保持", async ({
  page,
}) => {
  test.setTimeout(120000);
  const temp = mkdtempSync(join(tmpdir(), "fitness-upgrade-"));
  cpSync(resolve("dist"), join(temp, "v11"), { recursive: true });
  try {
    const archive = execFileSync(
      "git",
      ["archive", "4a10d42c4f19d5f952fab690cec043fc860c4a8e"],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    execFileSync("tar", ["-x", "-C", temp], { input: archive });
    symlinkSync(resolve("node_modules"), join(temp, "node_modules"));
    execFileSync(
      process.execPath,
      [
        resolve("node_modules/vite/bin/vite.js"),
        "build",
        "--outDir",
        join(temp, "v10"),
      ],
      {
        cwd: temp,
        env: {
          ...process.env,
          FITNESS_BASE_PATH: "/",
          FITNESS_BUILD_LABEL: "1.1.1",
        },
        stdio: "pipe",
      },
    );
    rmSync(resolve("dist"), { recursive: true, force: true });
    cpSync(join(temp, "v10"), resolve("dist"), { recursive: true });
    await page.goto("/");
    await expect(page.locator('meta[name="fitness-build"]')).toHaveAttribute(
      "content",
      "1.1.1",
    );
    await expect(page.locator(".page-heading")).toBeVisible();
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.screenshot({
        path: `artifacts/v1.2/before/${test.info().project.name}-overview-${width}.png`,
        fullPage: true,
      });
      await page
        .locator(".bottom-nav")
        .getByRole("button", { name: "趋势", exact: true })
        .click();
      await page.screenshot({
        path: `artifacts/v1.2/before/${test.info().project.name}-weekly-empty-${width}.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "记录身体指标", exact: true })
        .click();
      await page.screenshot({
        path: `artifacts/v1.2/before/${test.info().project.name}-body-${width}.png`,
      });
      await page.getByRole("button", { name: "关闭弹窗" }).click();
      await page
        .locator(".bottom-nav")
        .getByRole("button", { name: "首页", exact: true })
        .click();
    }
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.getByRole("button", { name: "开始记录", exact: false }).click();
    for (const name of ["上斜推胸", "坐姿肩推", "侧平举机"])
      await page
        .getByRole("button", { name: "移除动作 " + name, exact: true })
        .click();
    await page.locator(".equipment-settings > summary").click();
    await page
      .getByRole("dialog")
      .getByLabel("器械标识", { exact: true })
      .fill("旧版测试机器");
    await page.getByLabel("动作方式 / 座椅设置").fill("座椅2");
    await page.getByLabel("坐姿推胸 第1组重量").fill("20.25");
    await page.getByLabel("坐姿推胸 第1组次数").fill("9");
    await page.getByRole("button", { name: "完成训练", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "训练完成总结" }),
    ).toBeVisible();
    await page
      .locator(".bottom-nav")
      .getByRole("button", { name: "首页", exact: true })
      .click();
    await page.getByRole("button", { name: "开始记录", exact: false }).click();
    await page.getByLabel("高位下拉 第1组重量").fill("27.5");
    await page.getByRole("button", { name: "保存并关闭" }).click();
    const read = () =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open("fitness-os-real");
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
        const result = {
          version: db.version,
          data: Object.fromEntries(rows as any),
        };
        db.close();
        return result;
      });
    const before = await read();
    rmSync(resolve("dist"), { recursive: true, force: true });
    cpSync(join(temp, "v11"), resolve("dist"), { recursive: true });
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await page.getByRole("button", { name: "更新应用", exact: true }).click();
    await expect(page.locator('meta[name="fitness-build"]')).toHaveAttribute(
      "content",
      "1.2.0",
    );
    expect(await read()).toEqual(before);
    await page
      .getByRole("button", { name: "还有一份训练草稿", exact: false })
      .click();
    await expect(page.getByLabel("高位下拉 第1组重量")).toHaveValue("27.5");
    await page.getByRole("button", { name: /保存并关闭|保存草稿/ }).click();
    // Code rollback installs the old app shell without downgrading or deleting IndexedDB.
    rmSync(resolve("dist"), { recursive: true, force: true });
    cpSync(join(temp, "v10"), resolve("dist"), { recursive: true });
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await page.getByRole("button", { name: "更新应用", exact: true }).click();
    await expect(page.locator('meta[name="fitness-build"]')).toHaveAttribute(
      "content",
      "1.1.1",
    );
    expect(await read()).toEqual(before);
    await page
      .getByRole("button", { name: "还有一份训练草稿", exact: false })
      .click();
    await expect(page.getByLabel("高位下拉 第1组重量")).toHaveValue("27.5");
  } finally {
    rmSync(resolve("dist"), { recursive: true, force: true });
    cpSync(join(temp, "v11"), resolve("dist"), { recursive: true });
    rmSync(temp, { recursive: true, force: true });
  }
});
