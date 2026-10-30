export type Mode = 'real' | 'demo';
export type Kind = 'A' | 'B' | 'C';
export type Status = 'draft' | 'completed' | 'incomplete';
export const names: Record<Kind, string> = { A: '胸肩', B: '背部', C: '下肢核心' };
export interface Base {
  id: string;
  createdAt: string;
  updatedAt: string;
}
export interface Exercise extends Base {
  name: string;
  muscle: string;
  equipment: string;
  technique: string;
  active: boolean;
}
export interface PlanItem {
  exerciseId: string;
  sets: number;
  min: number;
  max: number;
}
export interface Plan extends Base {
  kind: Kind;
  name: string;
  enabled: boolean;
  items: PlanItem[];
}
export interface SessionItem {
  id: string;
  exerciseId: string;
  name: string;
  equipment: string;
  technique: string;
  targetSets: number;
  min: number;
  max: number;
  quality: boolean;
  reserve: boolean;
}
export interface Session extends Base {
  date: string;
  kind: Kind;
  status: Status;
  duration: number | null;
  fatigue: string;
  notes: string;
  items: SessionItem[];
}
export interface WorkoutSet extends Base {
  sessionId: string;
  itemId: string;
  exerciseId: string;
  order: number;
  weight: number | null;
  reps: number | null;
}
export interface BodyMetric extends Base {
  date: string;
  weight: number | null;
  waist: number | null;
  notes: string;
}
export interface Goal extends Base {
  exerciseId: string;
  equipment: string;
  technique: string;
  weight: number | null;
  sets: number;
  min: number;
  max: number;
  status: 'pending' | 'confirmed' | 'completed';
  reason: string;
  source: 'manual' | 'ai';
}
export interface Report extends Base {
  week: string;
  text: string;
}
export interface Settings extends Base {
  cycleStart: string;
  weeklyPlanned: number | null;
  cycleTargetSessions?: number | null;
  theme: 'system' | 'light' | 'dark';
  restoreTested: boolean;
  lastBackup: string | null;
}
export interface Dataset {
  exercises: Exercise[];
  workoutPlans: Plan[];
  workoutSessions: Session[];
  workoutSets: WorkoutSet[];
  bodyMetrics: BodyMetric[];
  trainingGoals: Goal[];
  weeklyReports: Report[];
  settings: Settings[];
}
export const tables = [
  'exercises',
  'workoutPlans',
  'workoutSessions',
  'workoutSets',
  'bodyMetrics',
  'trainingGoals',
  'weeklyReports',
  'settings',
] as const;
export type TableName = (typeof tables)[number];
export const uuid = () => crypto.randomUUID();
export const stamp = (id: string = uuid()): Base => {
  const now = new Date().toISOString();
  return { id, createdAt: now, updatedAt: now };
};
export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const shiftDate = (date: string, days: number) => {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return localDate(d);
};
export const dateValid = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !isNaN(new Date(s + 'T12:00:00').getTime()) &&
  localDate(new Date(s + 'T12:00:00')) === s;
export const weekStart = (date = localDate()) => {
  const d = new Date(date + 'T12:00:00');
  return shiftDate(date, -((d.getDay() + 6) % 7));
};
export const validSet = (s: WorkoutSet) =>
  s.weight !== null &&
  Number.isFinite(s.weight) &&
  s.weight >= 0 &&
  s.reps !== null &&
  Number.isInteger(s.reps) &&
  s.reps > 0;
export const emptyDataset = (): Dataset => ({
  exercises: [],
  workoutPlans: [],
  workoutSessions: [],
  workoutSets: [],
  bodyMetrics: [],
  trainingGoals: [],
  weeklyReports: [],
  settings: [],
});
