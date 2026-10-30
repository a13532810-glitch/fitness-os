import Dexie, { type Table } from 'dexie';
import {
  type Mode,
  type Dataset,
  type Exercise,
  type Plan,
  type Session,
  type WorkoutSet,
  type BodyMetric,
  type Goal,
  type Report,
  type Settings,
  tables,
  stamp,
  localDate,
  shiftDate,
  uuid,
  dateValid,
} from './model';
export class FitnessDB extends Dexie {
  exercises!: Table<Exercise>;
  workoutPlans!: Table<Plan>;
  workoutSessions!: Table<Session>;
  workoutSets!: Table<WorkoutSet>;
  bodyMetrics!: Table<BodyMetric>;
  trainingGoals!: Table<Goal>;
  weeklyReports!: Table<Report>;
  settings!: Table<Settings>;
  constructor(
    public mode: Mode,
    name = `fitness-os-${mode}`,
  ) {
    super(name);
    this.version(1).stores({
      exercises: 'id, active',
      workoutPlans: 'id, kind',
      workoutSessions: 'id, date, status, kind',
      workoutSets: 'id, sessionId, exerciseId, itemId',
      bodyMetrics: 'id, date',
      trainingGoals: 'id, exerciseId, status',
      weeklyReports: 'id, week',
      settings: 'id',
    });
  }
}
export async function snapshot(db: FitnessDB): Promise<Dataset> {
  return db.transaction(
    'r',
    tables.map((t) => db.table(t)),
    async () => {
      const out = {} as Dataset;
      for (const t of tables) (out[t] as unknown[]) = await db.table(t).toArray();
      return out;
    },
  );
}
export function validateWorkout(session: Session, sets: WorkoutSet[]) {
  if (!dateValid(session.date)) throw Error('训练日期无效');
  if (
    session.duration !== null &&
    (!Number.isInteger(session.duration) || session.duration < 1 || session.duration > 1440)
  )
    throw Error('时长需为1–1440分钟');
  if (session.items.length > 30) throw Error('最多30个动作');
  const orders = new Set<string>();
  for (const s of sets) {
    const i = session.items.find((i) => i.id === s.itemId);
    if (s.sessionId !== session.id || !i || i.exerciseId !== s.exerciseId)
      throw Error('训练组关联错误');
    if (
      !Number.isInteger(s.order) ||
      s.order < 0 ||
      s.order > 29 ||
      orders.has(s.itemId + '|' + s.order)
    )
      throw Error('训练组顺序错误');
    orders.add(s.itemId + '|' + s.order);
    if (s.weight !== null && (!Number.isFinite(s.weight) || s.weight < 0 || s.weight > 2000))
      throw Error('重量需为0–2000kg');
    if (s.reps !== null && (!Number.isInteger(s.reps) || s.reps < 1 || s.reps > 1000))
      throw Error('次数需为1–1000整数');
  }
  if (session.status !== 'draft') {
    if (sets.some((s) => (s.weight === null) !== (s.reps === null)))
      throw Error('有未填写完整的组');
    if (!sets.some((s) => s.weight !== null && s.reps !== null)) throw Error('请记录至少一组');
  }
}
export async function saveSession(db: FitnessDB, session: Session, sets: WorkoutSet[]) {
  validateWorkout(session, sets);
  await db.transaction('rw', [db.workoutSessions, db.workoutSets], async () => {
    await db.workoutSessions.put(session);
    await db.workoutSets.where('sessionId').equals(session.id).delete();
    await db.workoutSets.bulkPut(sets);
  });
}
export async function deleteSession(db: FitnessDB, id: string) {
  await db.transaction('rw', [db.workoutSessions, db.workoutSets], async () => {
    await db.workoutSets.where('sessionId').equals(id).delete();
    await db.workoutSessions.delete(id);
  });
}
export function createSession(
  data: Dataset,
  kind: Session['kind'],
): { session: Session; sets: WorkoutSet[] } {
  const p = data.workoutPlans.find((p) => p.kind === kind);
  const session: Session = {
    ...stamp(),
    date: localDate(),
    kind,
    status: 'draft',
    duration: null,
    fatigue: '',
    notes: '',
    items: [],
  };
  const sets: WorkoutSet[] = [];
  for (const i of p?.items ?? []) {
    const e = data.exercises.find((e) => e.id === i.exerciseId);
    if (!e?.active) continue;
    const g = data.trainingGoals
      .filter(
        (g) =>
          g.exerciseId === e.id &&
          g.equipment === e.equipment &&
          g.technique === e.technique &&
          g.status === 'confirmed',
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const item = {
      id: uuid(),
      exerciseId: e.id,
      name: e.name,
      equipment: e.equipment,
      technique: e.technique,
      targetSets: g?.sets ?? i.sets,
      min: g?.min ?? i.min,
      max: g?.max ?? i.max,
      quality: false,
      reserve: false,
    };
    session.items.push(item);
    for (let n = 0; n < item.targetSets; n++)
      sets.push({
        ...stamp(),
        sessionId: session.id,
        itemId: item.id,
        exerciseId: e.id,
        order: n,
        weight: null,
        reps: null,
      });
  }
  return { session, sets };
}
export async function seed(db: FitnessDB) {
  await db.transaction(
    'rw',
    tables.map((t) => db.table(t)),
    async () => {
      if (await db.settings.count()) return;
      const groups = [
        ['坐姿推胸', '胸'],
        ['上斜推胸', '胸'],
        ['坐姿肩推', '肩'],
        ['侧平举机', '肩'],
        ['高位下拉', '背'],
        ['坐姿划船', '背'],
        ['反向飞鸟', '肩'],
        ['腿举', '腿'],
        ['腿弯举', '腿'],
        ['卷腹', '核心'],
      ];
      const exercises: Exercise[] = groups.map(([name, muscle], i) => ({
        ...stamp('exercise-' + (i + 1)),
        name,
        muscle,
        equipment: db.mode === 'demo' ? `演示器械-${i + 1}` : '',
        technique: db.mode === 'demo' ? '虚构：相同座椅与动作幅度' : '',
        active: true,
      }));
      const plans: Plan[] = (['A', 'B', 'C'] as const).map((kind, n) => ({
        ...stamp('plan-' + kind),
        kind,
        name: ['胸肩训练', '背部训练', '下肢核心训练'][n],
        enabled: true,
        items: exercises
          .slice(n === 0 ? 0 : n === 1 ? 4 : 7, n === 0 ? 4 : n === 1 ? 7 : 10)
          .map((e) => ({ exerciseId: e.id, sets: 3, min: 8, max: 12 })),
      }));
      await db.exercises.bulkAdd(exercises);
      await db.workoutPlans.bulkAdd(plans);
      await db.settings.add({
        ...stamp('preferences'),
        cycleStart: localDate(),
        weeklyPlanned: null,
        cycleTargetSessions: null,
        theme: 'system',
        restoreTested: false,
        lastBackup: null,
      });
      if (db.mode === 'demo') {
        const data = { ...emptyData(), exercises, workoutPlans: plans };
        for (let i = 0; i < 9; i++) {
          const kind = (['A', 'B', 'C'] as const)[i % 3];
          const w = createSession(data, kind);
          w.session.date = shiftDate(localDate(), -16 + i * 2);
          w.session.status = i === 7 ? 'incomplete' : 'completed';
          w.session.duration = 38 + (i % 4) * 3;
          w.session.fatigue = i === 7 ? '较累' : '适中';
          w.session.notes = '虚构演示，仅用于体验';
          w.session.items = w.session.items.map((x) => ({
            ...x,
            technique: '虚构：相同座椅与动作幅度',
            quality: true,
            reserve: true,
          }));
          w.sets = w.sets.map((s, j) => ({
            ...s,
            weight: kind === 'C' ? 40 : 20 + (j % 3) * 5,
            reps: 8 + Math.min(Math.floor(i / 3), 4) + (j % 2),
          }));
          await db.workoutSessions.add(w.session);
          await db.workoutSets.bulkAdd(w.sets);
        }
        await db.bodyMetrics.bulkAdd(
          [0, 1, 2, 3].map((i) => ({
            ...stamp(),
            date: shiftDate(localDate(), -21 + i * 7),
            weight: 75 - i * 0.2,
            waist: 86 - i * 0.3,
            notes: '虚构演示',
          })),
        );
      }
    },
  );
}
function emptyData(): Dataset {
  return {
    exercises: [],
    workoutPlans: [],
    workoutSessions: [],
    workoutSets: [],
    bodyMetrics: [],
    trainingGoals: [],
    weeklyReports: [],
    settings: [],
  };
}
