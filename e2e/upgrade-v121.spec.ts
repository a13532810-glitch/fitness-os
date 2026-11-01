import { seedLegacyBody } from "./fixtures";
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("已发布 V1.2 构建 → V1.3.1 SW更新 → 保留schema2的兼容UI回滚：历史与草稿逐字段保持", async ({
  page,
}) => {
  test.setTimeout(120000);
  const temp = mkdtempSync(join(tmpdir(), "fitness-upgrade-"));
  cpSync(resolve("dist"), join(temp, "v11"), { recursive: true });
  try {
    const archive = execFileSync(
      "git",
      ["archive", "d4c980d52b27eb4eb9c228afb9769ebba17af0bb"],
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
          FITNESS_BUILD_LABEL: "1.2.0",
        },
        stdio: "pipe",
      },
    );
    rmSync(resolve("dist"), { recursive: true, force: true });
    cpSync(join(temp, "v10"), resolve("dist"), { recursive: true });
    await page.goto("/");
    await expect(page.locator('meta[name="fitness-build"]')).toHaveAttribute(
      "content",
      "1.2.0",
    );
    await expect(page.locator(".page-heading")).toBeVisible();
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.screenshot({
        path: `artifacts/v1.2.1/before/${test.info().project.name}-overview-${width}.png`,
        fullPage: true,
      });
      await page
        .locator(".bottom-nav")
        .getByRole("button", { name: "趋势", exact: true })
        .click();
      await page.screenshot({
        path: `artifacts/v1.2.1/before/${test.info().project.name}-weekly-empty-${width}.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "记录身体指标", exact: true })
        .click();
      await page.screenshot({
        path: `artifacts/v1.2.1/before/${test.info().project.name}-body-${width}.png`,
      });
      await page.getByRole("button", { name: "关闭弹窗" }).click();
      await page
        .locator(".bottom-nav")
        .getByRole("button", { name: "总览", exact: true })
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
    await page.getByRole("button", { name: "动作详情", exact: true }).click();
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
      .getByRole("button", { name: "总览", exact: true })
      .click();
    await page.getByRole("button", { name: "开始记录", exact: false }).click();
    await page.getByLabel("高位下拉 第1组重量").fill("27.5");
    await page.getByRole("button", { name: "保存草稿" }).click();
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
    await seedLegacyBody(page, 2);
    const before = await read();
    rmSync(resolve("dist"), { recursive: true, force: true });
    cpSync(join(temp, "v11"), resolve("dist"), { recursive: true });
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await page.getByRole("button", { name: "更新应用", exact: true }).click();
    await expect(page.locator('meta[name="fitness-build"]')).toHaveAttribute(
      "content",
      "1.3.1",
    );
    // The HTML build marker appears before Dexie finishes opening/upgrading.
    // Wait for the same complete schema/data equality; do not accept partial data.
    await expect.poll(read).toEqual({
      version: 20,
      data: { ...before.data, inclineRecords: [] },
    });
    await page
      .getByRole("button", { name: "还有一份训练草稿", exact: false })
      .click();
    await expect(page.getByLabel("高位下拉 第1组重量")).toHaveValue("27.5");
    await page.getByRole("button", { name: /保存并关闭|保存草稿/ }).click();
    await page
      .locator(".bottom-nav")
      .getByRole("button", { name: "训练", exact: true })
      .click();
    await page.getByRole("button", { name: "跑步机爬坡", exact: true }).click();
    await page
      .getByRole("button", { name: "保存爬坡记录", exact: true })
      .click();
    await expect(page.locator(".incline-history")).toHaveCount(1);
    await page.locator('.bottom-nav').getByRole('button',{name:'总览',exact:true}).click();
    const upgraded = await read();
    // Roll back the UI only; retain schema2 so old Dexie code does not VersionError.
    const dbPath = join(temp, "src/db.ts");
    const oldSource = readFileSync(dbPath, "utf8");
    const at =
      oldSource.indexOf("    });", oldSource.indexOf("this.version(1)")) + 7;
    writeFileSync(
      dbPath,
      oldSource.slice(0, at) +
        '\n    this.version(2).stores({inclineRecords:"id, date"});' +
        oldSource.slice(at),
    );
    cpSync(resolve("src/model.ts"), join(temp, "src/model.ts"));
    cpSync(resolve("src/backup.ts"), join(temp, "src/backup.ts"));
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
          FITNESS_BUILD_LABEL: "1.2.0",
        },
        stdio: "pipe",
      },
    );

    rmSync(resolve("dist"), { recursive: true, force: true });
    cpSync(join(temp, "v10"), resolve("dist"), { recursive: true });
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await page.getByRole("button", { name: "更新应用", exact: true }).click();
    await expect(page.locator('meta[name="fitness-build"]')).toHaveAttribute(
      "content",
      "1.2.0",
    );
    expect(await read()).toEqual(upgraded);
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
