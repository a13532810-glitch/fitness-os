import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("真实 V1.0 构建 → V1.1 SW更新 → 旧代码回滚：历史与草稿逐字段保持", async ({
  page,
}) => {
  test.setTimeout(120000);
  const temp = mkdtempSync(join(tmpdir(), "fitness-upgrade-"));
  cpSync(resolve("dist"), join(temp, "v11"), { recursive: true });
  try {
    const archive = execFileSync("git", [
      "archive",
      "805e67f7191d305fb4c1b9bbbad8c8b8351e5a51",
    ]);
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
          FITNESS_BUILD_LABEL: "1.0.0",
        },
        stdio: "pipe",
      },
    );
    rmSync(resolve("dist"), { recursive: true, force: true });
    cpSync(join(temp, "v10"), resolve("dist"), { recursive: true });
    await page.goto("/");
    await expect(page.locator('meta[name="fitness-build"]')).toHaveAttribute(
      "content",
      "1.0.0",
    );
    await page.getByRole("button", { name: "开启我的训练空间" }).click();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.getByRole("button", { name: "开始记录", exact: false }).click();
    for (const name of ["上斜推胸", "坐姿肩推", "侧平举机"])
      await page
        .getByRole("button", { name: "移除动作 " + name, exact: true })
        .click();
    await page
      .getByRole("dialog")
      .getByLabel("器械标识", { exact: true })
      .fill("旧版测试机器");
    await page.getByLabel("动作方式 / 座椅设置").fill("座椅2");
    await page.getByLabel("坐姿推胸 第1组重量").fill("20.25");
    await page.getByLabel("坐姿推胸 第1组次数").fill("9");
    await page.getByRole("button", { name: "完成训练", exact: true }).click();
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
      "1.1.0",
    );
    expect(await read()).toEqual(before);
    await page
      .getByRole("button", { name: "还有一份训练草稿", exact: false })
      .click();
    await expect(page.getByLabel("高位下拉 第1组重量")).toHaveValue("27.5");
    await page.getByRole("button", { name: "保存并关闭" }).click();
    // Code rollback installs the old app shell without downgrading or deleting IndexedDB.
    rmSync(resolve("dist"), { recursive: true, force: true });
    cpSync(join(temp, "v10"), resolve("dist"), { recursive: true });
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await page.getByRole("button", { name: "更新应用", exact: true }).click();
    await expect(page.locator('meta[name="fitness-build"]')).toHaveAttribute(
      "content",
      "1.0.0",
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
