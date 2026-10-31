import { afterEach, beforeEach, expect, it } from "vitest";
import {
  FitnessDB,
  seed,
  snapshot,
  createSession,
  saveSession,
  hasWorkoutInput,
  emptyDrafts,
  cleanEmptyDrafts,
} from "../src/db";
import { makeBackup, parseBackup, integrity } from "../src/backup";
let db: FitnessDB;
beforeEach(async () => {
  db = new FitnessDB("real", "v121-" + crypto.randomUUID());
  await seed(db);
});
afterEach(async () => {
  await db.delete();
});
it("默认计划与空白组不构成输入；0kg、半填次数及旧标记都受保护", async () => {
  const w = createSession(await snapshot(db), "A");
  expect(hasWorkoutInput(w.session, w.sets)).toBe(false);
  for (const patch of [{ weight: 0 }, { reps: 1 }]) {
    const sets = structuredClone(w.sets);
    Object.assign(sets[0], patch);
    expect(hasWorkoutInput(w.session, sets)).toBe(true);
  }
  for (const patch of [{ notes: "备注" }, { fatigue: "较累" }, { duration: 1 }])
    expect(hasWorkoutInput({ ...w.session, ...patch }, w.sets)).toBe(true);
  w.session.items[0].quality = true;
  expect(hasWorkoutInput(w.session, w.sets)).toBe(true);
});
it("预览后变为有效的草稿不会被清理，备份契约保持兼容", async () => {
  const d = await snapshot(db),
    blank = createSession(d, "A"),
    valuable = createSession(d, "A");
  await saveSession(db, blank.session, blank.sets);
  await saveSession(db, valuable.session, valuable.sets);
  const ids = emptyDrafts(await snapshot(db)).map((s) => s.id);
  valuable.sets[0].weight = 0;
  await saveSession(db, valuable.session, valuable.sets);
  const backup = await makeBackup(db);
  expect(() =>
    integrity(parseBackup(JSON.stringify(backup)).data),
  ).not.toThrow();
  expect(await cleanEmptyDrafts(db, ids)).toBe(1);
  expect(await db.workoutSessions.get(valuable.session.id)).toEqual(
    valuable.session,
  );
  expect(
    await db.workoutSets.where("sessionId").equals(valuable.session.id).count(),
  ).toBe(valuable.sets.length);
});
it("同日多次真实训练不会合并，已完成记录不能清理", async () => {
  const d = await snapshot(db);
  for (let n = 0; n < 2; n++) {
    const w = createSession(d, "A");
    w.sets[0].weight = 20;
    w.sets[0].reps = 10;
    w.session.status = "completed";
    await saveSession(db, w.session, w.sets);
  }
  const all = await db.workoutSessions.toArray();
  expect(all).toHaveLength(2);
  expect(
    await cleanEmptyDrafts(
      db,
      all.map((s) => s.id),
    ),
  ).toBe(0);
});
it("仅有自定义器械设置的旧草稿也不能被清理", async () => {
  const w = createSession(await snapshot(db), "A");
  w.session.items[0].equipment = "用户设置01";
  await saveSession(db, w.session, w.sets);
  expect(emptyDrafts(await snapshot(db))).toHaveLength(0);
  expect(await cleanEmptyDrafts(db, [w.session.id])).toBe(0);
});
