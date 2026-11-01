import { afterEach, beforeEach, expect, it } from "vitest";
import {
  FitnessDB,
  seed,
  snapshot,
  createSession,
  saveSession,
  rememberedExercise,
} from "../src/db";
import {
  makeBackup,
  parseBackup,
  previewRestore,
  restore,
} from "../src/backup";
import { records, totals } from "../src/analytics";
import { localDate, shiftDate, stamp } from "../src/model";
let db: FitnessDB;
beforeEach(async () => {
  db = new FitnessDB("real", "v11-" + crypto.randomUUID());
  await seed(db);
});
afterEach(async () => {
  await db.delete();
});
it("记忆最近完成的配置，忽略草稿；不填入实际重量次数，不改旧记录与目标", async () => {
  const w = createSession(await snapshot(db), "A");
  w.session.items = w.session.items.slice(0, 1);
  const item = w.session.items[0];
  item.equipment = "胸推02";
  item.technique = "座椅3";
  w.sets = w.sets
    .filter((s) => s.itemId === item.id)
    .map((s, n) => ({ ...s, weight: 20 + n * 0.25, reps: 9 + n }));
  w.session.status = "completed";
  await saveSession(db, w.session, w.sets);
  const goal = {
    ...stamp(),
    exerciseId: item.exerciseId,
    equipment: item.equipment,
    technique: item.technique,
    weight: 22.5,
    sets: 4,
    min: 8,
    max: 12,
    status: "confirmed" as const,
    source: "manual" as const,
    reason: "本人确认",
  };
  await db.trainingGoals.add(goal);
  const d = await snapshot(db);
  const next = createSession(d, "A");
  expect(next.session.items[0]).toMatchObject({
    equipment: "胸推02",
    technique: "座椅3",
    targetSets: 4,
  });
  expect(next.sets.every((s) => s.weight === null && s.reps === null)).toBe(
    true,
  );
  next.session.items[0].equipment = "草稿机器";
  await saveSession(db, next.session, next.sets);
  const after = await snapshot(db);
  expect(rememberedExercise(after, after.exercises[0]).equipment).toBe(
    "胸推02",
  );
  expect(after.trainingGoals).toEqual([goal]);
  expect(after.workoutSets.filter((s) => s.sessionId === w.session.id)).toEqual(
    d.workoutSets,
  );
});
it("JSON v1 旧备份恢复到 v2 后再次导出，保留旧记录", async () => {
  const w = createSession(await snapshot(db), "B");
  w.sets[0].weight = 18.25;
  w.sets[0].reps = 9;
  await saveSession(db, w.session, w.sets);
  const backup = await makeBackup(db);
  const legacy = JSON.parse(JSON.stringify(backup));
  legacy.version = 1;
  delete legacy.data.inclineRecords;
  // V1.0 allowed settings without the optional cycle target.
  delete legacy.data.settings[0].cycleTargetSessions;
  expect(parseBackup(JSON.stringify(legacy)).version).toBe(1);
  expect(db.verno).toBe(2);
  const preview = await previewRestore(db, JSON.stringify(legacy), "merge");
  await restore(db, preview, "", true);
  const restored = await makeBackup(db);
  expect(restored.version).toBe(2);
  expect(restored.data.workoutSessions).toEqual(backup.data.workoutSessions);
  expect(restored.data.workoutSets).toEqual(backup.data.workoutSets);
});
it("长历史按关联索引读取，3000次训练/27000组保持准确并在合理时间完成", async () => {
  const data = await snapshot(db);
  const template = createSession(data, "B");
  for (let n = 0; n < 3000; n++) {
    const id = "history-" + n;
    const date = shiftDate(localDate(), -n);
    data.workoutSessions.push({
      ...template.session,
      id,
      date,
      status: "completed",
    });
    data.workoutSets.push(
      ...template.sets.map((s, i) => ({
        ...s,
        id: id + "-" + i,
        sessionId: id,
        weight: i % 2 ? 25 : 20,
        reps: 10,
      })),
    );
  }
  const start = performance.now();
  const all = records(data, "exercise-5");
  expect(all).toHaveLength(3000);
  expect(totals(all[0].sets)).toEqual({ sets: 3, reps: 30, volume: 650 });
  expect(performance.now() - start).toBeLessThan(3000);
});
it("未录入动作不覆盖上次实际配置；用户主动修改默认设置优先生效", async () => {
  const old = createSession(await snapshot(db), "A");
  old.session.status = "completed";
  old.session.items[0].equipment = "旧机器";
  old.session.items[0].technique = "座椅2";
  old.sets[0].weight = 20;
  old.sets[0].reps = 10;
  await saveSession(db, old.session, old.sets);
  const next = createSession(await snapshot(db), "A");
  next.session.status = "completed";
  next.session.items[0].equipment = "未完成动作的机器";
  const other = next.sets.find((s) => s.exerciseId === "exercise-2")!;
  other.weight = 20;
  other.reps = 9;
  await saveSession(db, next.session, next.sets);
  const data = await snapshot(db);
  expect(records(data, "exercise-1")).toHaveLength(1);
  expect(rememberedExercise(data, data.exercises[0]).equipment).toBe("旧机器");
  await db.exercises.update("exercise-1", {
    equipment: "本人主动修改",
    updatedAt: "2099-01-01T00:00:00.000Z",
  });
  expect(
    createSession(await snapshot(db), "A").session.items[0].equipment,
  ).toBe("本人主动修改");
});
