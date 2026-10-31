import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
try {
  await page.goto("http://127.0.0.1:4183");
  await page.locator(".page-heading").waitFor();
  for (let n = 0; n < 10; n++) {
    await page.getByRole("button", { name: "开始记录", exact: false }).click();
    await page.getByRole("button", { name: "关闭训练记录" }).click();
  }
  const audit = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("fitness-os-real");
      r.onsuccess = () => resolve(r.result);
    });
    const get = (table) =>
      new Promise((resolve) => {
        const r = db.transaction(table).objectStore(table).getAll();
        r.onsuccess = () => resolve(r.result);
      });
    const sessions = await get("workoutSessions"),
      sets = await get("workoutSets");
    db.close();
    return {
      sessionCount: sessions.length,
      filledSets: sets.filter((s) => s.weight !== null || s.reps !== null)
        .length,
      sessions: sessions.map((s) => ({
        id: s.id,
        status: s.status,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        notes: s.notes,
        duration: s.duration,
      })),
    };
  });
  if (audit.sessionCount !== 10 || audit.filledSets !== 0)
    throw Error("Baseline reproduction differs");
  writeFileSync(
    "docs/v1.2.1/baseline-draft-reproduction.json",
    JSON.stringify(
      {
        baseline: "d4c980d",
        isolatedSyntheticContext: true,
        opens: 10,
        ...audit,
      },
      null,
      2,
    ),
  );
  console.log("Baseline confirmed: 10 opens, 10 empty drafts, 0 filled sets");
} finally {
  await browser.close();
}
