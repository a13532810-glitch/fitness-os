import { type InclineRecord, dateValid, localDate, weekStart } from './model';
export const validIncline = (r: Pick<InclineRecord, 'date' | 'minutes' | 'incline' | 'speed'>) =>
  dateValid(r.date) && Number.isFinite(r.minutes) && r.minutes > 0 && r.minutes <= 1440 &&
  Number.isFinite(r.incline) && r.incline >= 0 && r.incline <= 100 &&
  Number.isFinite(r.speed) && r.speed >= 0 && r.speed <= 100;
export function inclineDefaults(rows: InclineRecord[]) {
  const last = rows.filter(validIncline).sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];
  return {minutes:last?.minutes ?? 40, incline:last?.incline ?? 10, speed:last?.speed ?? 4.7};
}
export function inclineWeek(rows: InclineRecord[], today = localDate()) {
  const valid = rows.filter(r => validIncline(r) && r.date >= weekStart(today) && r.date <= today);
  return {count:valid.length, minutes: Math.round(valid.reduce((n,r)=>n+r.minutes,0)*100)/100};
}
