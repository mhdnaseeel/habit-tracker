import type { Schedule } from '../../contracts/src/index.ts';
export type LocalDate = string & { readonly __localDate: unique symbol };
export function localDate(value: string): LocalDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new RangeError('Expected YYYY-MM-DD');
  const date = new Date(`${value}T12:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new RangeError('Invalid calendar date');
  return value as LocalDate;
}
export function dateInTimezone(instant: Date, timezone: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return localDate(`${get('year')}-${get('month')}-${get('day')}`);
}
export function addDays(date: LocalDate, days: number): LocalDate {
  if (!Number.isInteger(days)) throw new RangeError('Days must be an integer');
  const cursor = new Date(`${date}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return localDate(cursor.toISOString().slice(0, 10));
}
export function datesBetween(from: LocalDate, to: LocalDate): LocalDate[] {
  if (to < from) return [];
  const result: LocalDate[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (result.length >= 36600)
      throw new RangeError('Date range exceeds 100 years');
    result.push(date);
  }
  return result;
}
export interface ScheduleRevision {
  effectiveFrom: LocalDate;
  schedule: Schedule;
  target: number;
}
export interface HabitTimeline {
  startDate: LocalDate;
  endDate?: LocalDate;
  archivedOn?: LocalDate;
  revisions: readonly ScheduleRevision[];
}
export function revisionOn(
  habit: HabitTimeline,
  date: LocalDate,
): ScheduleRevision | undefined {
  return [...habit.revisions]
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
    .find((r) => r.effectiveFrom <= date);
}
export function isScheduled(habit: HabitTimeline, date: LocalDate): boolean {
  if (
    date < habit.startDate ||
    (habit.endDate && date > habit.endDate) ||
    (habit.archivedOn && date >= habit.archivedOn)
  )
    return false;
  const rule = revisionOn(habit, date)?.schedule;
  if (!rule) return false;
  const calendar = new Date(`${date}T12:00:00Z`);
  switch (rule.frequency) {
    case 'daily':
      return true;
    case 'weekly':
      return rule.weekdays.includes(calendar.getUTCDay());
    case 'monthly':
      return rule.monthDays.includes(calendar.getUTCDate());
  }
}
export type OccurrenceStatus =
  'pending' | 'partial' | 'completed' | 'frozen' | 'missed';
export interface HabitLog {
  date: LocalDate;
  status: OccurrenceStatus;
  value: number;
}
export interface StreakResult {
  current: number;
  historicalBest: number;
  bestEver: number;
  scheduled: number;
  completed: number;
  frozen: number;
}
export function calculateStreak(
  habit: HabitTimeline,
  logs: readonly HabitLog[],
  today: LocalDate,
  previousBest = 0,
): StreakResult {
  const index = new Map<LocalDate, HabitLog>();
  for (const log of logs) {
    if (index.has(log.date)) throw new Error('Duplicate occurrence');
    index.set(log.date, log);
  }
  let current = 0,
    historicalBest = 0,
    scheduled = 0,
    completed = 0,
    frozen = 0;
  for (const date of datesBetween(habit.startDate, today)) {
    if (!isScheduled(habit, date)) continue;
    scheduled++;
    const log = index.get(date);
    if (log?.status === 'completed') {
      current++;
      completed++;
      historicalBest = Math.max(historicalBest, current);
    } else if (log?.status === 'frozen') {
      frozen++;
    } else if (date < today || log?.status === 'missed') {
      current = 0;
    }
  }
  return {
    current,
    historicalBest,
    bestEver: Math.max(previousBest, historicalBest),
    scheduled,
    completed,
    frozen,
  };
}
export function validateCheckIn(
  habit: HabitTimeline,
  date: LocalDate,
  today: LocalDate,
  retroactiveDays = 7,
) {
  if (date > today) throw new RangeError('Future check-ins are not allowed');
  if (date < addDays(today, -retroactiveDays))
    throw new RangeError('Historical correction window exceeded');
  if (!isScheduled(habit, date))
    throw new RangeError('Habit is not scheduled on this date');
}
export function completionRate(
  completed: number,
  scheduled: number,
): number | null {
  if (
    !Number.isInteger(completed) ||
    !Number.isInteger(scheduled) ||
    completed < 0 ||
    scheduled < 0 ||
    completed > scheduled
  )
    throw new RangeError('Invalid completion counts');
  return scheduled === 0 ? null : (completed / scheduled) * 100;
}
export function quantitativeGoal(values: readonly number[], target: number) {
  if (
    !Number.isFinite(target) ||
    target <= 0 ||
    values.some((v) => !Number.isFinite(v) || v < 0)
  )
    throw new RangeError('Invalid goal progress');
  const progress = values.reduce((sum, value) => sum + value, 0);
  return {
    progress,
    percentage: Math.min(100, (progress / target) * 100),
    achieved: progress >= target,
  };
}
export function carryOver(
  due: LocalDate,
  today: LocalDate,
  completed: boolean,
  enabled: boolean,
): LocalDate {
  return enabled && !completed && due < today ? today : due;
}
export function withinQuietHours(
  time: string,
  start: string | null,
  end: string | null,
): boolean {
  const valid = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  if (
    !valid(time) ||
    (start !== null && !valid(start)) ||
    (end !== null && !valid(end))
  )
    throw new RangeError('Invalid wall-clock time');
  if (start === null && end === null) return false;
  if (start === null || end === null)
    throw new RangeError('Quiet hours require both boundaries');
  if (start === end) return true;
  return start < end
    ? time >= start && time < end
    : time >= start || time < end;
}
