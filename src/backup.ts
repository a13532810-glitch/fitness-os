import { z } from 'zod';
import { type Dataset, tables, dateValid } from './model';
import { FitnessDB, snapshot } from './db';
const id = z.string().min(1).max(120);
const txt = z.string().max(20000);
const date = z.string().refine(dateValid, '日期无效');
const time = z.iso.datetime();
const base = { id, createdAt: time, updatedAt: time };
const kind = z.enum(['A', 'B', 'C']);
const count = z.number().int().min(1).max(30);
const reps = z.number().int().min(1).max(1000);
const load = z.number().min(0).max(2000).nullable();
const item = z
  .object({
    id,
    exerciseId: id,
    name: z.string().min(1).max(160),
    equipment: z.string().max(160),
    technique: z.string().max(500),
    targetSets: count,
    min: reps,
    max: reps,
    quality: z.boolean(),
    reserve: z.boolean(),
  })
  .strict()
  .refine((x) => x.min <= x.max);
const row = {
  exercises: z
    .object({
      ...base,
      name: z.string().min(1).max(160),
      muscle: z.string().max(100),
      equipment: z.string().max(160),
      technique: z.string().max(500),
      active: z.boolean(),
    })
    .strict(),
  workoutPlans: z
    .object({
      ...base,
      kind,
      name: z.string().min(1).max(160),
      enabled: z.boolean(),
      items: z
        .array(
          z
            .object({ exerciseId: id, sets: count, min: reps, max: reps })
            .strict()
            .refine((x) => x.min <= x.max),
        )
        .max(30),
    })
    .strict(),
  workoutSessions: z
    .object({
      ...base,
      date,
      kind,
      status: z.enum(['draft', 'completed', 'incomplete']),
      duration: z.number().int().min(1).max(1440).nullable(),
      fatigue: z.enum(['', '轻松', '适中', '较累', '非常累']),
      notes: txt,
      items: z.array(item).max(30),
    })
    .strict(),
  workoutSets: z
    .object({
      ...base,
      sessionId: id,
      itemId: id,
      exerciseId: id,
      order: z.number().int().min(0).max(29),
      weight: load,
      reps: reps.nullable(),
    })
    .strict(),
  bodyMetrics: z
    .object({
      ...base,
      date,
      weight: z.number().min(10).max(500).nullable(),
      waist: z.number().min(20).max(300).nullable(),
      notes: txt,
    })
    .strict()
    .refine((x) => x.weight !== null || x.waist !== null),
  trainingGoals: z
    .object({
      ...base,
      exerciseId: id,
      equipment: z.string().max(160),
      technique: z.string().max(500),
      weight: load,
      sets: count,
      min: reps,
      max: reps,
      status: z.enum(['pending', 'confirmed', 'completed']),
      reason: txt,
      source: z.enum(['manual', 'ai']),
    })
    .strict()
    .refine((x) => x.min <= x.max),
  weeklyReports: z.object({ ...base, week: date, text: txt }).strict(),
  settings: z
    .object({
      ...base,
      cycleStart: date,
      weeklyPlanned: z.number().int().min(0).max(14).nullable(),
      cycleTargetSessions: z.number().int().min(1).max(180).nullable().optional(),
      theme: z.enum(['system', 'light', 'dark']),
      restoreTested: z.boolean(),
      lastBackup: time.nullable(),
    })
    .strict(),
};
const schema = z
  .object({
    format: z.literal('fitness-os-backup'),
    version: z.literal(1),
    mode: z.literal('real'),
    exportedAt: time,
    data: z
      .object(
        Object.fromEntries(tables.map((t) => [t, z.array(row[t]).max(100000)])) as {
          [K in keyof typeof row]: z.ZodArray<(typeof row)[K]>;
        },
      )
      .strict(),
  })
  .strict();
export interface Backup {
  format: 'fitness-os-backup';
  version: 1;
  mode: 'real';
  exportedAt: string;
  data: Dataset;
}
export function integrity(data: Dataset) {
  for (const t of tables) {
    const ids = data[t].map((x) => x.id);
    if (new Set(ids).size !== ids.length) throw Error(`${t} 存在重复 ID`);
    for (const r of data[t])
      if (r.updatedAt < r.createdAt) throw Error(`${t} 修改时间早于创建时间`);
  }
  if (data.settings.length !== 1 || data.settings[0].id !== 'preferences')
    throw Error('设置必须包含唯一 preferences 记录');
  if (data.workoutPlans.length !== 3 || new Set(data.workoutPlans.map((p) => p.kind)).size !== 3)
    throw Error('训练类型存在重复计划');
  const ex = new Set(data.exercises.map((e) => e.id));
  const sessions = new Map(data.workoutSessions.map((s) => [s.id, s]));
  for (const p of data.workoutPlans) {
    if (new Set(p.items.map((i) => i.exerciseId)).size !== p.items.length)
      throw Error('计划包含重复动作');
    for (const i of p.items) if (!ex.has(i.exerciseId)) throw Error('计划关联动作缺失');
  }
  for (const s of data.workoutSessions) {
    if (new Set(s.items.map((i) => i.id)).size !== s.items.length)
      throw Error('训练包含重复动作项 ID');
    for (const i of s.items) if (!ex.has(i.exerciseId)) throw Error('训练关联动作缺失');
    if (
      s.status === 'completed' &&
      !data.workoutSets.some((x) => x.sessionId === s.id && x.reps !== null && x.weight !== null)
    )
      throw Error('已完成训练没有有效组');
  }
  const order = new Set<string>();
  for (const s of data.workoutSets) {
    const w = sessions.get(s.sessionId);
    const i = w?.items.find((i) => i.id === s.itemId);
    if (!i || i.exerciseId !== s.exerciseId) throw Error('训练组关联不完整');
    const key = s.sessionId + '|' + s.itemId + '|' + s.order;
    if (order.has(key)) throw Error('训练组顺序重复');
    order.add(key);
    if (w?.status !== 'draft' && (s.weight === null) !== (s.reps === null))
      throw Error('已结束训练含不完整的组');
  }
  for (const g of data.trainingGoals) {
    if (!ex.has(g.exerciseId)) throw Error('训练目标关联动作缺失');
    if (g.status === 'confirmed' && (!g.equipment.trim() || !g.technique.trim()))
      throw Error('已确认目标缺少器械或动作方式');
  }
}
export function parseBackup(text: string): Backup {
  if (text.length > 20 * 1024 * 1024) throw Error('文件超过20MB，请拆分或检查文件');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw Error('JSON 文件损坏或格式错误');
  }
  const p = schema.safeParse(raw);
  if (!p.success)
    throw Error(
      '备份格式或版本不受支持：' +
        p.error.issues
          .slice(0, 3)
          .map((i) => i.path.join('.') + ' ' + i.message)
          .join('；'),
    );
  const value = p.data as Backup;
  integrity(value.data);
  return value;
}
export async function makeBackup(db: FitnessDB): Promise<Backup> {
  if (db.mode !== 'real') throw Error('演示数据库不能导出为正式备份');
  return {
    format: 'fitness-os-backup',
    version: 1,
    mode: 'real',
    exportedAt: new Date().toISOString(),
    data: await snapshot(db),
  };
}
export const counts = (d: Dataset) => Object.fromEntries(tables.map((t) => [t, d[t].length]));
export function mergeData(current: Dataset, incoming: Dataset) {
  const out = {} as Dataset;
  const conflicts: { table: string; id: string }[] = [];
  for (const t of tables) {
    const map = new Map(current[t].map((r) => [r.id, r]));
    for (const r of incoming[t]) {
      if (map.has(r.id)) {
        if (JSON.stringify(map.get(r.id)) !== JSON.stringify(r))
          conflicts.push({ table: t, id: r.id });
      } else map.set(r.id, r as never);
    }
    (out[t] as unknown[]) = Array.from(map.values());
  }
  integrity(out);
  return { data: out, conflicts };
}
export interface RecoveryPreview {
  mode: 'merge' | 'replace';
  incoming: Backup;
  before: Backup;
  result: Dataset;
  conflicts: { table: string; id: string }[];
}
export async function previewRestore(
  db: FitnessDB,
  raw: string,
  mode: 'merge' | 'replace',
): Promise<RecoveryPreview> {
  const incoming = parseBackup(raw),
    before = await makeBackup(db);
  const merged =
    mode === 'merge'
      ? mergeData(before.data, incoming.data)
      : { data: incoming.data, conflicts: [] };
  return { mode, incoming, before, result: merged.data, conflicts: merged.conflicts };
}
export async function restore(
  db: FitnessDB,
  p: RecoveryPreview,
  confirmation: string,
  backupDownloaded: boolean,
) {
  if (db.mode !== 'real' || !backupDownloaded) throw Error('请先下载导入前自动备份');
  if (p.mode === 'replace' && confirmation !== '覆盖当前数据')
    throw Error('请准确输入覆盖当前数据');
  // Re-validate at the mutation boundary, even if a caller changes the preview object.
  const incoming = parseBackup(JSON.stringify(p.incoming));
  const result = p.mode === 'merge' ? mergeData(p.before.data, incoming.data).data : incoming.data;
  integrity(result);
  await db.transaction(
    'rw',
    tables.map((t) => db.table(t)),
    async () => {
      const live = {} as Dataset;
      for (const t of tables) (live[t] as unknown[]) = await db.table(t).toArray();
      if (JSON.stringify(live) !== JSON.stringify(p.before.data))
        throw Error('预览后数据已变化，请重新选择文件并生成备份');
      for (const t of tables) {
        await db.table(t).clear();
        await db.table(t).bulkPut(result[t]);
      }
      for (const t of tables)
        if ((await db.table(t).count()) !== result[t].length)
          throw Error('恢复数量核对失败，已回滚');
    },
  );
  return { counts: counts(result), relations: '关联完整性已核对' };
}
export function download(name: string, text: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
