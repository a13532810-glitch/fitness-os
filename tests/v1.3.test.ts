import { it, expect } from "vitest";
import Dexie from "dexie";
import {
  FitnessDB,
  seed,
  snapshot,
  createSession,
  saveSession,
} from "../src/db";
import { stamp, type InclineRecord } from "../src/model";
import { inclineDefaults, inclineWeek, validIncline } from "../src/incline";
import {
  makeBackup,
  parseBackup,
  previewRestore,
  restore,
} from "../src/backup";
const row = (date = "2026-12-31", minutes = 40): InclineRecord => ({
  ...stamp(),
  date,
  minutes,
  incline: 10,
  speed: 4.7,
});
it("首次默认、最近有效日期参数复用，过滤非法记录", () => {
  expect(inclineDefaults([])).toEqual({ minutes: 40, incline: 10, speed: 4.7 });
  expect(
    inclineDefaults([
      row(),
      { ...row("2027-01-01"), speed: 6.2 },
      { ...row("2027-02-01"), speed: NaN },
    ]).speed,
  ).toBe(6.2);
  for (const n of [NaN, Infinity, -1, 0])
    expect(validIncline({ ...row(), minutes: n })).toBe(false);
  expect(validIncline({ ...row(), incline: 0, speed: 0, minutes: 0.5 })).toBe(
    true,
  );
  expect(validIncline({ ...row(), date: "2026-02-30" })).toBe(false);
});
it("本地周一边界跨月跨年，同日多次、编辑删除分别计算", () => {
  const rows = [
    row("2026-12-27"),
    row(),
    row(),
    row("2027-01-01", 30),
    row("2027-01-04"),
  ];
  expect(inclineWeek(rows, "2027-01-03")).toEqual({ count: 3, minutes: 110 });
  rows[1].minutes = 20;
  expect(inclineWeek(rows, "2027-01-03").minutes).toBe(90);
  rows.splice(2, 1);
  expect(inclineWeek(rows, "2027-01-03")).toEqual({ count: 2, minutes: 50 });
});
it("新增编辑删除与力量隔离、新旧备份与幂等恢复、失败保护", async () => {
  const db = new FitnessDB("real", "v130-" + crypto.randomUUID());
  try {
    await seed(db);
    const before = await snapshot(db);
    await db.bodyMetrics.put({
      ...stamp(),
      date: "2026-01-01",
      weight: 70,
      waist: 80,
      notes: "合成历史",
    });
    const r = row();
    await db.inclineRecords.put(r);
    await db.inclineRecords.put({ ...r, minutes: 30 });
    expect(await db.inclineRecords.count()).toBe(1);
    const b = await makeBackup(db);
    expect(b.version).toBe(2);
    expect(b.data.bodyMetrics).toHaveLength(1);
    expect(b.data.workoutSets).toEqual(before.workoutSets);
    expect(parseBackup(JSON.stringify(b)).data.inclineRecords[0].minutes).toBe(
      30,
    );
    for (let i = 0; i < 2; i++) {
      const p = await previewRestore(db, JSON.stringify(b), "merge");
      await restore(db, p, "", true);
    }
    expect(await db.inclineRecords.count()).toBe(1);
    const legacy = JSON.parse(JSON.stringify(b));
    legacy.version = 1;
    delete legacy.data.inclineRecords;
    expect(parseBackup(JSON.stringify(legacy)).data.inclineRecords).toEqual([]);
    const old = await previewRestore(db, JSON.stringify(legacy), "merge");
    await restore(db, old, "", true);
    expect(await db.inclineRecords.count()).toBe(1);
    const snap = await snapshot(db);
    b.data.inclineRecords[0].minutes = NaN;
    expect(() => parseBackup(JSON.stringify(b))).toThrow();
    expect(await snapshot(db)).toEqual(snap);
    await db.inclineRecords.delete(r.id);
    expect(await db.inclineRecords.count()).toBe(0);
  } finally {
    await db.delete();
  }
});
it("真实 schema1 升级只新增独立表，原八表逐字段保留", async () => {
  const source = new FitnessDB("real", "fixture-" + crypto.randomUUID());
  await seed(source);
  const draft = createSession(await snapshot(source), "A");
  draft.sets[0].weight = 20;
  await saveSession(source, draft.session, draft.sets);
  await source.bodyMetrics.put({
    ...stamp(),
    date: "2026-01-01",
    weight: 70,
    waist: null,
    notes: "虚构",
  });
  await source.weeklyReports.put({
    ...stamp(),
    week: "2026-01-05",
    text: "虚构周报",
  });
  await source.trainingGoals.put({
    ...stamp(),
    exerciseId: "exercise-1",
    equipment: "历史器械",
    technique: "历史设置",
    weight: 20,
    sets: 3,
    min: 8,
    max: 12,
    status: "confirmed",
    reason: "虚构依据",
    source: "manual",
  });
  const data = await snapshot(source);
  await source.delete();
  const name = "upgrade-" + crypto.randomUUID();
  const old = new Dexie(name);
  old
    .version(1)
    .stores({
      exercises: "id, active",
      workoutPlans: "id, kind",
      workoutSessions: "id, date, status, kind",
      workoutSets: "id, sessionId, exerciseId, itemId",
      bodyMetrics: "id, date",
      trainingGoals: "id, exerciseId, status",
      weeklyReports: "id, week",
      settings: "id",
    });
  for (const [table, rows] of Object.entries(data))
    if (table !== "inclineRecords") await old.table(table).bulkPut(rows);
  old.close();
  const db = new FitnessDB("real", name);
  try {
    expect(await snapshot(db)).toEqual(data);
    expect(await db.inclineRecords.count()).toBe(0);
  } finally {
    await db.delete();
  }
});
it("统计使用存储日期，跨时区和夏令时周界不重复；新版缺表拒绝", async () => {
  const tz = process.env.TZ;
  try {
    for (const zone of [
      "Asia/Shanghai",
      "America/New_York",
      "Pacific/Honolulu",
      "Europe/Berlin",
    ]) {
      process.env.TZ = zone;
      expect(
        inclineWeek(
          [row("2026-10-26", 10), row("2026-11-01", 20), row("2026-11-02", 50)],
          "2026-11-01",
        ),
      ).toEqual({ count: 2, minutes: 30 });
    }
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
  const db = new FitnessDB("real", "missing-" + crypto.randomUUID());
  try {
    await seed(db);
    const b: any = await makeBackup(db);
    delete b.data.inclineRecords;
    expect(() => parseBackup(JSON.stringify(b))).toThrow("缺少爬坡");
  } finally {
    await db.delete();
  }
});
