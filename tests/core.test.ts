import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { FitnessDB, seed, snapshot, createSession, saveSession, deleteSession } from '../src/db';
import { stamp, shiftDate, localDate, validSet, type Dataset, tables } from '../src/model';
import {
  makeBackup,
  parseBackup,
  previewRestore,
  restore,
  mergeData,
  integrity,
} from '../src/backup';
import {
  totals,
  records,
  comparable,
  progress,
  suggestion,
  packageAnalysis,
  analysisMarkdown,
  nextKind,
} from '../src/analytics';
let db: FitnessDB;
beforeEach(async () => {
  db = new FitnessDB('real', 'test-' + crypto.randomUUID());
  await seed(db);
});
afterEach(async () => {
  await db.delete();
});
async function logged(date = localDate(), equipment = '机器1', reps = 10) {
  const d = await snapshot(db);
  const w = createSession(d, 'A');
  w.session.items = w.session.items
    .slice(0, 1)
    .map((i) => ({ ...i, equipment, technique: '座椅2', quality: true, reserve: true }));
  w.session.date = date;
  w.session.status = 'completed';
  w.sets = w.sets
    .filter((s) => s.itemId === w.session.items[0].id)
    .map((s) => ({ ...s, weight: 20, reps }));
  await saveSession(db, w.session, w.sets);
  return w;
}
describe('训练与持久化', () => {
  it('空白正式空间有10动作和三类计划，但没有虚构实际', async () => {
    const d = await snapshot(db);
    expect(d.exercises).toHaveLength(10);
    expect(d.workoutPlans).toHaveLength(3);
    expect(d.workoutSessions).toHaveLength(0);
    expect(createSession(d, 'A').sets.every((s) => s.weight === null && s.reps === null)).toBe(
      true,
    );
  });
  it('不同重量组、增加组、草稿、编辑、关闭重开和删除关联', async () => {
    const w = createSession(await snapshot(db), 'B');
    w.sets[0].weight = 20;
    await saveSession(db, w.session, w.sets);
    expect((await snapshot(db)).workoutSets[0].reps).toBe(null);
    w.sets = w.sets.slice(0, 3).map((s, i) => ({ ...s, weight: 20 + i * 5, reps: 10 }));
    w.session.items = w.session.items.slice(0, 1);
    w.sets.push({ ...w.sets[0], ...stamp(), order: 3, weight: 30, reps: 8 });
    w.session.status = 'completed';
    await saveSession(db, w.session, w.sets);
    w.sets[0].reps = 12;
    await saveSession(db, w.session, w.sets);
    const name = db.name;
    db.close();
    db = new FitnessDB('real', name);
    const d = await snapshot(db);
    expect(d.workoutSets).toHaveLength(4);
    expect(totals(d.workoutSets)).toEqual({ sets: 4, reps: 40, volume: 1030 });
    await deleteSession(db, w.session.id);
    expect((await snapshot(db)).workoutSets).toHaveLength(0);
  });
  it('非法组或关联不破坏已存记录', async () => {
    const w = await logged();
    const before = await snapshot(db);
    w.sets[0].exerciseId = 'wrong';
    await expect(saveSession(db, w.session, w.sets)).rejects.toThrow('关联');
    expect(await snapshot(db)).toEqual(before);
  });
  it('目标与历史分离，只有已确认目标进入新训练', async () => {
    await logged();
    const d = await snapshot(db);
    const e = d.exercises[0];
    await db.exercises.update(e.id, { equipment: '机器1', technique: '座椅2' });
    const goal = {
      ...stamp(),
      exerciseId: e.id,
      equipment: '机器1',
      technique: '座椅2',
      weight: 25,
      sets: 4,
      min: 9,
      max: 13,
      status: 'pending' as const,
      reason: '建议',
      source: 'ai' as const,
    };
    await db.trainingGoals.add(goal);
    expect(createSession(await snapshot(db), 'A').session.items[0].targetSets).toBe(3);
    await db.trainingGoals.update(goal.id, { status: 'confirmed' });
    expect(createSession(await snapshot(db), 'A').session.items[0].targetSets).toBe(4);
    expect((await snapshot(db)).workoutSets).toEqual(d.workoutSets);
  });
  it('可停用C，不强制轮换', async () => {
    await db.workoutPlans.update('plan-C', { enabled: false });
    await logged();
    expect(nextKind(await snapshot(db))).toBe('B');
  });
});
describe('备份安全边界', () => {
  it('完整版本化导出与覆盖恢复，数量和关联核对', async () => {
    await logged();
    await db.bodyMetrics.add({ ...stamp(), date: localDate(), weight: 74, waist: 85, notes: '' });
    await db.weeklyReports.add({ ...stamp(), week: localDate(), text: '周报' });
    const b = await makeBackup(db);
    expect(parseBackup(JSON.stringify(b))).toEqual(b);
    const w = createSession(await snapshot(db), 'C');
    await saveSession(db, w.session, w.sets);
    const p = await previewRestore(db, JSON.stringify(b), 'replace');
    await expect(restore(db, p, '', true)).rejects.toThrow('准确输入');
    await expect(restore(db, p, '覆盖当前数据', false)).rejects.toThrow('先下载');
    await restore(db, p, '覆盖当前数据', true);
    expect(await snapshot(db)).toEqual(b.data);
    integrity(await snapshot(db));
  });
  it('重复合并幂等且保留现有内容', async () => {
    const w = await logged();
    const b = await makeBackup(db);
    await db.workoutSessions.update(w.session.id, { notes: '保留本地' });
    const p = await previewRestore(db, JSON.stringify(b), 'merge');
    expect(p.conflicts).toHaveLength(1);
    await restore(db, p, '', true);
    const p2 = await previewRestore(db, JSON.stringify(b), 'merge');
    await restore(db, p2, '', true);
    expect(await db.workoutSessions.count()).toBe(1);
    expect((await db.workoutSessions.get(w.session.id))?.notes).toBe('保留本地');
  });
  it('损坏、未来版本、缺失关联、重复ID、非法日期、缺失计划拒绝且数据完整', async () => {
    await logged();
    const b = await makeBackup(db);
    const before = await snapshot(db);
    expect(() => parseBackup('{')).toThrow('损坏');
    for (const mutate of [
      (x: any) => (x.version = 99),
      (x: any) => (x.data.workoutSets[0].itemId = '不存在'),
      (x: any) => x.data.exercises.push(x.data.exercises[0]),
      (x: any) => (x.data.workoutSessions[0].date = '2026-02-30'),
      (x: any) => x.data.workoutPlans.pop(),
    ]) {
      const copy = structuredClone(b);
      mutate(copy);
      await expect(previewRestore(db, JSON.stringify(copy), 'replace')).rejects.toThrow();
      expect(await snapshot(db)).toEqual(before);
    }
  });
  it('预览后变化拒绝覆盖，多标签页保护', async () => {
    const p = await previewRestore(db, JSON.stringify(await makeBackup(db)), 'replace');
    await logged();
    const before = await snapshot(db);
    await expect(restore(db, p, '覆盖当前数据', true)).rejects.toThrow('预览后');
    expect(await snapshot(db)).toEqual(before);
  });
  it('不信任被修改的预览result，恢复重新计算', async () => {
    await logged();
    const b = await makeBackup(db);
    const p = await previewRestore(db, JSON.stringify(b), 'replace');
    p.result = structuredClone(p.result);
    p.result.workoutSessions = [];
    p.result.workoutSets = [];
    await restore(db, p, '覆盖当前数据', true);
    expect(await snapshot(db)).toEqual(b.data);
  });
  it('事务写入失败回滚整个恢复', async () => {
    await logged();
    const b = await makeBackup(db);
    b.data.bodyMetrics.push({ ...stamp(), date: localDate(), weight: 74, waist: null, notes: '' });
    const p = await previewRestore(db, JSON.stringify(b), 'replace');
    const before = await snapshot(db);
    db.bodyMetrics.hook('creating', () => {
      throw Error('模拟磁盘故障');
    });
    await expect(restore(db, p, '覆盖当前数据', true)).rejects.toThrow('磁盘');
    expect(await snapshot(db)).toEqual(before);
  });
  it('演示库隔离且不允许正式备份和数据包', async () => {
    const demo = new FitnessDB('demo', 'demo-' + crypto.randomUUID());
    await seed(demo);
    try {
      expect(await demo.workoutSessions.count()).toBeGreaterThan(0);
      expect(await db.workoutSessions.count()).toBe(0);
      await expect(makeBackup(demo)).rejects.toThrow('演示');
      expect(() => packageAnalysis(awaitedPlaceholder, 'demo')).toThrow();
    } finally {
      await demo.delete();
    }
  });
});
const awaitedPlaceholder = {} as Dataset;
describe('有依据的分析', () => {
  it('总训练量按逐组实际计算，空白不计', async () => {
    const w = await logged();
    w.sets[1].weight = 25;
    w.sets[2].reps = null;
    expect(totals(w.sets)).toEqual({ sets: 2, reps: 20, volume: 450 });
  });
  it('同器械相同条件可比；不同机器或缺失方式不可比', async () => {
    await logged(shiftDate(localDate(), -2), '机器1', 9);
    await logged(localDate(), '机器1', 10);
    let d = await snapshot(db);
    expect(progress(d, 'exercise-1', '机器1', '座椅2').delta).toBe(3);
    await logged(localDate(), '机器2', 12);
    d = await snapshot(db);
    const a = records(d, 'exercise-1', '机器1', '座椅2')[0],
      b = records(d, 'exercise-1', '机器2', '座椅2')[0];
    expect(comparable(a, b)).toBe(false);
    expect(comparable(a, { ...a, item: { ...a.item, technique: '' } })).toBe(false);
    expect(progress(d, 'exercise-1', '不存在', '座椅2').label).toBe('暂无足够数据');
  });
  it('只有全部组上限且质量余力明确才建议按实际档位加重', async () => {
    await logged(localDate(), '机器1', 12);
    const d = await snapshot(db);
    expect(suggestion(d, d.workoutSessions[0].items[0])).toContain('实际档位');
    d.workoutSessions[0].items[0].reserve = false;
    expect(suggestion(d, d.workoutSessions[0].items[0])).toContain('优先增加次数');
  });
  it('7/28天边界、草稿排除、包内关联与Markdown完整', async () => {
    for (const days of [0, -6, -7, -27, -28]) await logged(shiftDate(localDate(), days));
    const w = createSession(await snapshot(db), 'B');
    await saveSession(db, w.session, w.sets);
    const d = await snapshot(db);
    const p = packageAnalysis(d, 'real');
    expect(p.recent7).toHaveLength(2);
    expect(p.history28).toHaveLength(4);
    expect(p.workoutSets).toHaveLength(12);
    expect(p.workoutSets.every((s) => p.history28.some((w) => w.id === s.sessionId))).toBe(true);
    expect(analysisMarkdown(p)).toContain('trainingGoals');
    expect(p.workoutPlans).toHaveLength(3);
    expect(p.plannedThisCalendarWeek).toBeNull();
  });
});

describe('连续表现与保守建议', () => {
  it('三次可比记录连续下降才提醒恢复，不根据一次异常改计划', async () => {
    await logged(shiftDate(localDate(), -4), '机器1', 12);
    await logged(shiftDate(localDate(), -2), '机器1', 11);
    await logged(localDate(), '机器1', 10);
    const data = await snapshot(db);
    expect(progress(data, 'exercise-1', '机器1', '座椅2').warning).toContain('连续两次下降');
    const before = structuredClone(data.workoutPlans);
    suggestion(data, data.workoutSessions[0].items[0]);
    expect((await snapshot(db)).workoutPlans).toEqual(before);
  });
  it('三次持平才提示停滞，目标组数不同则不直接比较', async () => {
    for (const days of [-4, -2, 0]) await logged(shiftDate(localDate(), days), '机器1', 10);
    const data = await snapshot(db);
    expect(progress(data, 'exercise-1', '机器1', '座椅2').warning).toContain('连续三次');
    const [a, b] = records(data, 'exercise-1', '机器1', '座椅2');
    expect(comparable(a, { ...b, item: { ...b.item, targetSets: 4 } })).toBe(false);
  });
});
