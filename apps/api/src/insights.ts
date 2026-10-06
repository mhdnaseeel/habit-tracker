import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import {
  addDays,
  dateInTimezone,
  datesBetween,
  isScheduled,
  localDate,
  weekStart,
  type HabitTimeline,
} from '../../../packages/domain/src/index.ts';
import type { Principal } from './auth.ts';

type Authenticate = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<Principal | undefined>;
const querySchema = z
  .object({ weeks: z.coerce.number().int().min(2).max(12).default(8) })
  .strict();
type Habit = {
  id: number;
  name: string;
  start_date: string;
  end_date: string | null;
  archived_on: string | null;
};
type Rule = {
  habit_id: number;
  effective_from: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  weekdays: number[];
  month_days: number[];
  target: number;
};
type Log = { habit_id: number; date: string; status: string };
function percentage(completed: number, due: number) {
  return due ? Math.round((completed / due) * 100) : null;
}
function failure(reply: FastifyReply, request: FastifyRequest, code: number) {
  return reply.code(code).send({
    success: false,
    error: {
      code,
      message: code === 400 ? 'Validation failed' : 'Authentication required',
      requestId: request.id,
    },
  });
}
export async function registerInsights(
  app: FastifyInstance,
  pool: pg.Pool,
  authenticate: Authenticate,
) {
  app.get(
    '/api/v1/insights',
    {
      schema: {
        tags: ['Insights'],
        summary: 'Read owner-scoped weekly consistency and personal rankings',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) return failure(reply, request, 400);
      const timezone = (
        await pool.query<{ timezone: string }>(
          'SELECT timezone FROM users WHERE id=$1',
          [user.userId],
        )
      ).rows[0]?.timezone;
      if (!timezone) return failure(reply, request, 401);
      const today = dateInTimezone(new Date(), timezone);
      const thisMonday = weekStart(today);
      const from = addDays(thisMonday, -(parsed.data.weeks - 1) * 7);
      const [habitRows, ruleRows, logRows] = await Promise.all([
        pool.query<Habit>(
          'SELECT id,name,start_date,end_date,archived_on FROM habits WHERE user_id=$1 AND start_date<=$2 AND (end_date IS NULL OR end_date>=$3) AND (archived_on IS NULL OR archived_on>$3) ORDER BY id',
          [user.userId, today, from],
        ),
        pool.query<Rule>(
          'SELECT s.habit_id,s.effective_from,s.frequency,s.weekdays,s.month_days,s.target FROM habit_schedules s JOIN habits h ON h.id=s.habit_id WHERE s.user_id=$1 AND h.user_id=$1 AND s.effective_from<=$2 ORDER BY s.effective_from',
          [user.userId, today],
        ),
        pool.query<Log>(
          'SELECT habit_id,date,status FROM habit_instances WHERE user_id=$1 AND date BETWEEN $2 AND $3',
          [user.userId, from, today],
        ),
      ]);
      const weekBuckets = Array.from(
        { length: parsed.data.weeks },
        (_, index) => ({
          from: addDays(from, index * 7),
          to: addDays(from, index * 7 + 6),
          completed: 0,
          due: 0,
        }),
      );
      const comparable = [
        { due: 0, completed: 0 },
        { due: 0, completed: 0 },
      ];
      const leaderboard: {
        id: number;
        name: string;
        completed: number;
        due: number;
        percentage: number | null;
        thisWeek: number | null;
        lastWeek: number | null;
      }[] = [];
      const logs = new Map(
        logRows.rows.map((row) => [`${row.habit_id}:${row.date}`, row.status]),
      );
      for (const habit of habitRows.rows) {
        const timeline: HabitTimeline = {
          startDate: localDate(habit.start_date),
          ...(habit.end_date ? { endDate: localDate(habit.end_date) } : {}),
          ...(habit.archived_on
            ? { archivedOn: localDate(habit.archived_on) }
            : {}),
          revisions: ruleRows.rows
            .filter((rule) => rule.habit_id === habit.id)
            .map((rule) => ({
              effectiveFrom: localDate(rule.effective_from),
              target: rule.target,
              schedule:
                rule.frequency === 'daily'
                  ? { frequency: 'daily' as const }
                  : rule.frequency === 'weekly'
                    ? { frequency: 'weekly' as const, weekdays: rule.weekdays }
                    : {
                        frequency: 'monthly' as const,
                        monthDays: rule.month_days,
                      },
            })),
        };
        let due = 0,
          completed = 0;
        const recent = [
          { due: 0, completed: 0 },
          { due: 0, completed: 0 },
        ];
        for (const date of datesBetween(from, today)) {
          if (!isScheduled(timeline, date)) continue;
          const bucketIndex = Math.floor(
            (Date.parse(date) - Date.parse(from)) / (7 * 86400000),
          );
          const bucket = weekBuckets[bucketIndex];
          if (!bucket) continue;
          const done = logs.get(`${habit.id}:${date}`) === 'completed';
          due++;
          bucket.due++;
          if (done) {
            completed++;
            bucket.completed++;
          }
          const recentIndex =
            bucketIndex === parsed.data.weeks - 1
              ? 0
              : bucketIndex === parsed.data.weeks - 2 &&
                  date <= addDays(today, -7)
                ? 1
                : -1;
          if (recentIndex >= 0) {
            recent[recentIndex]!.due++;
            comparable[recentIndex]!.due++;
            if (done) recent[recentIndex]!.completed++;
            if (done) comparable[recentIndex]!.completed++;
          }
        }
        if (due)
          leaderboard.push({
            id: habit.id,
            name: habit.name,
            completed,
            due,
            percentage: percentage(completed, due),
            thisWeek: percentage(recent[0]!.completed, recent[0]!.due),
            lastWeek: percentage(recent[1]!.completed, recent[1]!.due),
          });
      }
      const total = weekBuckets.reduce(
        (sum, week) => ({
          completed: sum.completed + week.completed,
          due: sum.due + week.due,
        }),
        { completed: 0, due: 0 },
      );
      const current = comparable[0]!;
      const previous = comparable[1]!;
      leaderboard.sort(
        (a, b) =>
          (b.percentage ?? -1) - (a.percentage ?? -1) ||
          b.completed - a.completed ||
          a.name.localeCompare(b.name),
      );
      return {
        from,
        to: today,
        overall: {
          ...total,
          percentage: percentage(total.completed, total.due),
        },
        comparison: {
          thisWeek: percentage(current.completed, current.due),
          lastWeek: percentage(previous.completed, previous.due),
          deltaPoints:
            current.due && previous.due
              ? percentage(current.completed, current.due)! -
                percentage(previous.completed, previous.due)!
              : null,
        },
        weeks: weekBuckets.map((week) => ({
          ...week,
          percentage: percentage(week.completed, week.due),
        })),
        leaderboard,
        strongest: leaderboard.slice(0, 3),
        slipping: leaderboard.filter(
          (habit) =>
            habit.thisWeek !== null &&
            habit.lastWeek !== null &&
            habit.thisWeek < habit.lastWeek,
        ),
      };
    },
  );
}
