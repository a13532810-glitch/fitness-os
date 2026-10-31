import { createServer } from "node:http";
import {
  readFileSync,
  existsSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { resolve, extname } from "node:path";
import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";
mkdirSync("docs/v1.2.1", { recursive: true });
const prefix = "/fitness-os/";
const dir = resolve("dist-pages");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
let server;
let url;
if (!url) {
  server = createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!path.startsWith(prefix)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const file = resolve(dir, path.slice(prefix.length) || "index.html");
    if (
      !file.startsWith(dir + "/") ||
      !existsSync(file) ||
      !statSync(file).isFile()
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}${prefix}`;
}
const results = [];
try {
  for (const [name, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    const browser = await engine.launch(
      name === "chromium" &&
        existsSync(
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        )
        ? {
            executablePath:
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          }
        : {},
    );
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const page = await context.newPage();
      const failures = [];
      const errors = [];
      page.on("response", (r) => {
        if (r.status() >= 400)
          failures.push({ url: r.url(), status: r.status() });
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(url);
      await page.locator(".page-heading").waitFor();
      await page.getByRole("heading", { name: "训练总览" }).waitFor();
      const registration = await page.evaluate(async () => {
        const r = await navigator.serviceWorker.ready;
        return {
          scope: r.scope,
          script: r.active?.scriptURL,
          secure: isSecureContext,
        };
      });
      assert.equal(registration.scope, url);
      assert.equal(registration.script, new URL("sw.js", url).href);
      assert.equal(registration.secure, true);
      const manifestResponse = await page.request.get(
        new URL("manifest.webmanifest", url).href,
      );
      assert.equal(manifestResponse.status(), 200);
      const manifest = await manifestResponse.json();
      assert.equal(manifest.start_url, prefix);
      assert.equal(manifest.scope, prefix);
      assert.equal(manifest.id, prefix);
      for (const icon of manifest.icons) {
        assert(icon.src.startsWith(prefix));
        assert.equal(
          (await page.request.get(new URL(icon.src, url).href)).status(),
          200,
        );
      }
      const apple = await page
        .locator('link[rel="apple-touch-icon"]')
        .getAttribute("href");
      assert.equal(apple, prefix + "apple-touch-icon.png");
      assert.equal(
        (await page.request.get(new URL(apple, url).href)).status(),
        200,
      );
      await page.reload();
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await page
        .getByRole("button", { name: "开始记录", exact: false })
        .click();
      for (const e of ["上斜推胸", "坐姿肩推", "侧平举机"])
        await page
          .getByRole("button", { name: "移除动作 " + e, exact: true })
          .click();
      await page.getByRole("button", { name: "动作详情", exact: true }).click();
      await page
        .getByLabel("器械标识", { exact: true })
        .fill("自动验收虚构机器");
      await page.getByLabel("动作方式 / 座椅设置").fill("测试设置");
      await page.getByLabel("坐姿推胸 第1组重量").fill("20");
      await page.getByLabel("坐姿推胸 第1组次数").fill("10");
      await page.getByRole("button", { name: /保存并关闭|保存草稿/ }).click();
      await page.reload();
      await page
        .getByRole("button", { name: "还有一份训练草稿", exact: false })
        .click();
      assert.equal(
        await page.getByLabel("坐姿推胸 第1组重量").inputValue(),
        "20",
      );
      await page.getByRole("button", { name: "完成训练", exact: true }).click();
      await page.getByRole("region", { name: "训练完成总结" }).waitFor();
      await context.setOffline(true);
      await page.reload();
      await page
        .locator(".bottom-nav")
        .getByRole("button", { name: "训练", exact: true })
        .click();
      await page.locator(".session-row").first().click();
      assert.equal(
        await page.getByLabel("坐姿推胸 第1组次数").inputValue(),
        "10",
      );
      await page.getByLabel("坐姿推胸 第1组次数").fill("11");
      await page.getByRole("button", { name: /保存并关闭|保存草稿/ }).click();
      await context.setOffline(false);
      await page.reload();
      await page
        .locator(".bottom-nav")
        .getByRole("button", { name: "训练", exact: true })
        .click();
      await page.locator(".session-row").first().click();
      assert.equal(
        await page.getByLabel("坐姿推胸 第1组次数").inputValue(),
        "11",
      );
      assert.equal(
        await page
          .getByRole("dialog")
          .evaluate((e) => e.scrollWidth <= e.clientWidth),
        true,
      );
      assert.deepEqual(failures, []);
      assert.deepEqual(errors, []);
      results.push({
        browser: name,
        passed: true,
        registration,
        resources: "all 200",
        draftReload: true,
        offlineColdReloadAndEdit: true,
        onlinePersistence: true,
        isolatedProfile: true,
      });
      console.log(name + " PASS " + url);
    } finally {
      await context.close();
      await browser.close();
    }
  }
  writeFileSync(
    resolve("docs/v1.2.1/pages-subpath-checks.json"),
    JSON.stringify(
      { checkedAt: new Date().toISOString(), url, results },
      null,
      2,
    ),
  );
} finally {
  if (server) await new Promise((r) => server.close(r));
}
