import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  habitInputSchema,
  dateSchema,
} from '../../../packages/contracts/src/index.ts';
import {
  addDays,
  calculateStreak,
  dateInTimezone,
  datesBetween,
  localDate,
  validateCheckIn,
  isScheduled,
  type HabitLog,
  type HabitTimeline,
  type LocalDate,
  type StreakResult,
} from '../../../packages/domain/src/index.ts';
import type { Principal } from './auth.ts';
import { transaction } from './database.ts';

const idSchema = z.object({ id: z.coerce.number().int().positive() });
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  archived: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(100).optional(),
});
const actionSchema = z
  .object({
    date: dateSchema.optional(),
    value: z.number().int().positive().max(1_000_000).optional(),
    mutationId: z.uuid().optional(),
  })
  .strict();
const dateAction = z.object({ date: dateSchema.optional() }).strict();
const historyRange = z
  .object({ from: dateSchema, to: dateSchema })
  .strict()
  .refine(
    ({ from, to }) =>
      from <= to && Date.parse(to) - Date.parse(from) <= 6 * 86400000,
  );
const editSchema = z
  .object(habitInputSchema.shape)
  .omit({ startDate: true })
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict();
interface HabitRow {
  id: number;
  user_id: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  color: string | null;
  active: boolean;
  start_date: string;
  end_date: string | null;
  archived_on: string | null;
  version: number;
  timezone: string;
}
interface ScheduleRow {
  id: number;
  effective_from: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  weekdays: number[];
  month_days: number[];
  target: number;
  reminder_time: string | null;
}
interface InstanceRow {
  id: number;
  date: string;
  status: HabitLog['status'];
  value: number;
  target: number;
  version: number;
}
type Authenticate = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<Principal | undefined>;
function fail(
  reply: FastifyReply,
  request: FastifyRequest,
  code: number,
  message: string,
) {
  return reply
    .code(code)
    .send({ success: false, error: { code, message, requestId: request.id } });
}
function parse<T>(
  schema: z.ZodType<T>,
  input: unknown,
  reply: FastifyReply,
  request: FastifyRequest,
): T | undefined {
  const result = schema.safeParse(input);
  if (!result.success) {
    fail(reply, request, 400, 'Validation failed');
    return;
  }
  return result.data;
}
function idOf(request: FastifyRequest, reply: FastifyReply) {
  return parse(idSchema, request.params, reply, request)?.id;
}
async function loadHabit(
  client: pg.Pool | pg.PoolClient,
  userId: string,
  id: number,
  lock = false,
): Promise<HabitRow | undefined> {
  const result = await client.query<HabitRow>(
    `SELECT h.*,u.timezone FROM habits h JOIN users u ON u.id=h.user_id WHERE h.id=$1 AND h.user_id=$2 ${lock ? 'FOR UPDATE OF h' : ''}`,
    [id, userId],
  );
  return result.rows[0];
}
async function schedules(
  client: pg.Pool | pg.PoolClient,
  userId: string,
  id: number,
): Promise<ScheduleRow[]> {
  return (
    await client.query<ScheduleRow>(
      `SELECT id,effective_from,frequency,weekdays,month_days,target,reminder_time::text FROM habit_schedules WHERE habit_id=$1 AND user_id=$2 ORDER BY effective_from`,
      [id, userId],
    )
  ).rows;
}
function timeline(
  habit: HabitRow,
  rules: readonly ScheduleRow[],
): HabitTimeline {
  return {
    startDate: localDate(habit.start_date),
    ...(habit.end_date ? { endDate: localDate(habit.end_date) } : {}),
    ...(habit.archived_on ? { archivedOn: localDate(habit.archived_on) } : {}),
    revisions: rules.map((rule) => ({
      effectiveFrom: localDate(rule.effective_from),
      target: rule.target,
      schedule:
        rule.frequency === 'daily'
          ? { frequency: 'daily' }
          : rule.frequency === 'weekly'
            ? { frequency: 'weekly', weekdays: rule.weekdays }
            : { frequency: 'monthly', monthDays: rule.month_days },
    })),
  };
}
function scheduleOn(rules: readonly ScheduleRow[], date: LocalDate) {
  return [...rules].reverse().find((r) => r.effective_from <= date);
}
function publicHabit(habit: HabitRow, rules: readonly ScheduleRow[]) {
  return {
    id: habit.id,
    name: habit.name,
    description: habit.description,
    category: habit.category,
    icon: habit.icon,
    color: habit.color,
    active: habit.active,
    startDate: habit.start_date,
    endDate: habit.end_date,
    archivedOn: habit.archived_on,
    version: habit.version,
    schedules: rules.map((r) => ({
      effectiveFrom: r.effective_from,
      frequency: r.frequency,
      weekdays: r.weekdays,
      monthDays: r.month_days,
      target: r.target,
      reminderTime: r.reminder_time,
    })),
  };
}
async function replay(
  client: pg.PoolClient,
  habit: HabitRow,
  rules: readonly ScheduleRow[],
  today: LocalDate,
): Promise<StreakResult> {
  const rows = (
    await client.query<InstanceRow>(
      `SELECT date,status,value FROM habit_instances WHERE habit_id=$1 AND user_id=$2 AND date<=$3 ORDER BY date`,
      [habit.id, habit.user_id, today],
    )
  ).rows;
  const logs = rows.map((row) => ({
    date: localDate(row.date),
    status: row.status,
    value: row.value,
  }));
  const previous =
    (
      await client.query<{ best_streak: number }>(
        `SELECT best_streak FROM streaks WHERE habit_id=$1`,
        [habit.id],
      )
    ).rows[0]?.best_streak ?? 0;
  const result = calculateStreak(timeline(habit, rules), logs, today, previous);
  await client.query(
    `INSERT INTO streaks(habit_id,current_streak,best_streak,historical_best,calculated_through) VALUES($1,$2,$3,$4,$5) ON CONFLICT(habit_id) DO UPDATE SET current_streak=$2,best_streak=$3,historical_best=$4,calculated_through=$5,updated_at=now()`,
    [habit.id, result.current, result.bestEver, result.historicalBest, today],
  );
  return result;
}
async function audit(
  client: pg.PoolClient,
  userId: string,
  entity: string,
  id: number,
  action: string,
  requestId: string,
) {
  await client.query(
    `INSERT INTO audit_logs(user_id,entity,entity_id,action,request_id) VALUES($1,$2,$3,$4,$5)`,
    [userId, entity, String(id), action, requestId],
  );
}
async function updateSync(
  client: pg.PoolClient,
  userId: string,
  entity: string,
  id: number,
  version: number,
  deleted = false,
) {
  await client.query(
    `INSERT INTO sync_changes(user_id,entity,entity_id,version,deleted) VALUES($1,$2,$3,$4,$5)`,
    [userId, entity, String(id), version, deleted],
  );
}
function monthStart(date: LocalDate) {
  return `${date.slice(0, 7)}-01`;
}
function requestHash(
  userId: string,
  id: number,
  date: LocalDate,
  value: number,
  mutationId: string,
) {
  return createHash('sha256')
    .update(JSON.stringify({ userId, id, date, value, mutationId }))
    .digest('hex');
}
export async function registerHabits(
  app: FastifyInstance,
  pool: pg.Pool,
  authenticate: Authenticate,
) {
  app.get(
    '/api/v1/history',
    {
      schema: {
        tags: ['History'],
        summary: 'Read one local week of owned habit history',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const range = parse(historyRange, request.query, reply, request);
      if (!range) return;
      const timezone = (
        await pool.query<{ timezone: string }>(
          `SELECT timezone FROM users WHERE id=$1`,
          [user.userId],
        )
      ).rows[0]?.timezone;
      if (!timezone)
        return fail(reply, request, 401, 'Authentication required');
      const today = dateInTimezone(new Date(), timezone);
      const habitRows = (
        await pool.query<HabitRow>(
          `SELECT h.*,u.timezone FROM habits h JOIN users u ON u.id=h.user_id WHERE h.user_id=$1 AND h.start_date<=$3 AND (h.end_date IS NULL OR h.end_date>=$2) AND (h.archived_on IS NULL OR h.archived_on>$2) ORDER BY h.sort_order,h.id`,
          [user.userId, range.from, range.to],
        )
      ).rows;
      const ids = habitRows.map((habit) => habit.id);
      const ruleRows = ids.length
        ? (
            await pool.query<ScheduleRow & { habit_id: number }>(
              `SELECT id,habit_id,effective_from,frequency,weekdays,month_days,target,reminder_time::text FROM habit_schedules WHERE user_id=$1 AND habit_id=ANY($2::int[]) AND effective_from<=$3 ORDER BY effective_from`,
              [user.userId, ids, range.to],
            )
          ).rows
        : [];
      const logRows = ids.length
        ? (
            await pool.query<InstanceRow & { habit_id: number }>(
              `SELECT id,habit_id,date,status,value,target,version FROM habit_instances WHERE user_id=$1 AND habit_id=ANY($2::int[]) AND date BETWEEN $3 AND $4 ORDER BY date`,
              [user.userId, ids, range.from, range.to],
            )
          ).rows
        : [];
      const dates = datesBetween(localDate(range.from), localDate(range.to));
      const habits = habitRows.map((habit) => {
        const rules = ruleRows.filter((rule) => rule.habit_id === habit.id);
        const series = timeline(habit, rules);
        const logs = new Map(
          logRows
            .filter((log) => log.habit_id === habit.id)
            .map((log) => [log.date, log]),
        );
        return {
          id: habit.id,
          name: habit.name,
          category: habit.category,
          color: habit.color,
          archived: !habit.active,
          days: dates.map((date) => {
            if (!isScheduled(series, date))
              return { date, scheduled: false, status: null, recorded: false };
            const log = logs.get(date);
            return {
              date,
              scheduled: true,
              status:
                log?.status ??
                (date > today
                  ? 'upcoming'
                  : date < today
                    ? 'missed'
                    : 'pending'),
              recorded: Boolean(log),
              value: log?.value ?? 0,
              target: log?.target ?? scheduleOn(rules, date)?.target ?? 1,
            };
          }),
        };
      });
      const due = habits
        .flatMap((habit) => habit.days)
        .filter((day) => day.scheduled && day.date <= today);
      const completed = due.filter((day) => day.status === 'completed').length;
      return {
        from: range.from,
        to: range.to,
        today,
        habits,
        progress: {
          completed,
          due: due.length,
          percentage: due.length
            ? Math.round((completed / due.length) * 100)
            : null,
        },
      };
    },
  );
  app.get(
    '/api/v1/today',
    {
      schema: {
        tags: ['Today'],
        summary: 'Read current local date and due habits',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const tz = (
        await pool.query<{ timezone: string }>(
          `SELECT timezone FROM users WHERE id=$1`,
          [user.userId],
        )
      ).rows[0]?.timezone;
      if (!tz) return fail(reply, request, 401, 'Authentication required');
      const today = dateInTimezone(new Date(), tz);
      const habitRows = (
        await pool.query<HabitRow>(
          `SELECT h.*,u.timezone FROM habits h JOIN users u ON u.id=h.user_id WHERE h.user_id=$1 AND h.active=true AND h.start_date<=$2 AND (h.end_date IS NULL OR h.end_date>=$2) ORDER BY h.sort_order,h.id`,
          [user.userId, today],
        )
      ).rows;
      const ids = habitRows.map((h) => h.id);
      if (ids.length === 0)
        return {
          date: today,
          habits: [],
          progress: { completed: 0, due: 0, percentage: null },
        };
      const ruleRows = (
        await pool.query<ScheduleRow & { habit_id: number }>(
          `SELECT id,habit_id,effective_from,frequency,weekdays,month_days,target,reminder_time::text FROM habit_schedules WHERE user_id=$1 AND habit_id=ANY($2::int[]) ORDER BY effective_from`,
          [user.userId, ids],
        )
      ).rows;
      const logRows = (
        await pool.query<InstanceRow & { habit_id: number }>(
          `SELECT id,habit_id,date,status,value,target,version FROM habit_instances WHERE user_id=$1 AND habit_id=ANY($2::int[]) AND date<=$3 ORDER BY date`,
          [user.userId, ids, today],
        )
      ).rows;
      const bestRows = (
        await pool.query<{ habit_id: number; best_streak: number }>(
          `SELECT habit_id,best_streak FROM streaks WHERE habit_id=ANY($1::int[])`,
          [ids],
        )
      ).rows;
      const best = new Map(bestRows.map((r) => [r.habit_id, r.best_streak]));
      const habits = habitRows.flatMap((h) => {
        const rules = ruleRows.filter((r) => r.habit_id === h.id);
        const series = timeline(h, rules);
        if (!isScheduled(series, today)) return [];
        const logs = logRows
          .filter((r) => r.habit_id === h.id)
          .map((r) => ({
            date: localDate(r.date),
            status: r.status,
            value: r.value,
          }));
        const status = logRows.find(
          (r) => r.habit_id === h.id && r.date === today,
        );
        const target = scheduleOn(rules, today)?.target ?? 1;
        const streak = calculateStreak(
          series,
          logs,
          today,
          best.get(h.id) ?? 0,
        );
        return [
          {
            id: h.id,
            name: h.name,
            category: h.category,
            icon: h.icon,
            color: h.color,
            target,
            value: status?.value ?? 0,
            status: status?.status ?? 'pending',
            streak: { current: streak.current, best: streak.bestEver },
          },
        ];
      });
      const completed = habits.filter((h) => h.status === 'completed').length;
      return {
        date: today,
        habits,
        progress: {
          completed,
          due: habits.length,
          percentage:
            habits.length === 0
              ? null
              : Math.round((completed / habits.length) * 100),
        },
      };
    },
  );
  app.get(
    '/api/v1/habits',
    {
      schema: { tags: ['Habits'], summary: 'List user habits with pagination' },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const q = parse(querySchema, request.query, reply, request);
      if (!q) return;
      const active = q.archived === 'true' ? false : true;
      const count = await pool.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM habits WHERE user_id=$1 AND active=$2 AND ($3::text IS NULL OR name ILIKE '%'||$3||'%')`,
        [user.userId, active, q.search ?? null],
      );
      const result = await pool.query<HabitRow>(
        `SELECT h.*,u.timezone FROM habits h JOIN users u ON u.id=h.user_id WHERE h.user_id=$1 AND h.active=$2 AND ($3::text IS NULL OR h.name ILIKE '%'||$3||'%') ORDER BY h.sort_order,h.id LIMIT $4 OFFSET $5`,
        [
          user.userId,
          active,
          q.search ?? null,
          q.limit,
          (q.page - 1) * q.limit,
        ],
      );
      const habits = await Promise.all(
        result.rows.map(async (h) =>
          publicHabit(h, await schedules(pool, user.userId, h.id)),
        ),
      );
      return {
        habits,
        total: count.rows[0]?.total ?? 0,
        page: q.page,
        limit: q.limit,
      };
    },
  );
  app.post(
    '/api/v1/habits',
    {
      schema: { tags: ['Habits'], summary: 'Create habit and first schedule' },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const input = parse(habitInputSchema, request.body, reply, request);
      if (!input) return;
      const today = (
        await pool.query<{ timezone: string }>(
          `SELECT timezone FROM users WHERE id=$1`,
          [user.userId],
        )
      ).rows[0]?.timezone;
      if (!today) return fail(reply, request, 401, 'Authentication required');
      let id: number;
      try {
        id = await transaction(pool, async (client) => {
          const created = await client.query<{ id: number }>(
            `INSERT INTO habits(user_id,name,description,category,icon,color,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [
              user.userId,
              input.name,
              input.description ?? null,
              input.category ?? null,
              input.icon ?? null,
              input.color ?? null,
              input.startDate,
              input.endDate ?? null,
            ],
          );
          const id = created.rows[0]?.id;
          if (!id) throw new Error('Habit insert failed');
          const schedule = input.schedule;
          await client.query(
            `INSERT INTO habit_schedules(habit_id,user_id,effective_from,frequency,weekdays,month_days,target,reminder_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              id,
              user.userId,
              input.startDate,
              schedule.frequency,
              schedule.frequency === 'weekly' ? schedule.weekdays : [],
              schedule.frequency === 'monthly' ? schedule.monthDays : [],
              input.target,
              input.reminderTime ?? null,
            ],
          );
          await audit(client, user.userId, 'Habit', id, 'CREATE', request.id);
          await updateSync(client, user.userId, 'Habit', id, 1);
          return id;
        });
      } catch (e) {
        if (e instanceof Error && 'code' in e && e.code === '23505')
          return fail(reply, request, 409, 'Active habit name already exists');
        throw e;
      }
      const h = await loadHabit(pool, user.userId, id);
      if (!h) throw new Error('Habit missing after insert');
      return reply.code(201).send({
        habit: publicHabit(h, await schedules(pool, user.userId, id)),
      });
    },
  );
  app.get(
    '/api/v1/habits/:id',
    { schema: { tags: ['Habits'], summary: 'Get owned habit' } },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const id = idOf(request, reply);
      if (!id) return;
      const habit = await loadHabit(pool, user.userId, id);
      if (!habit) return fail(reply, request, 404, 'Habit not found');
      return {
        habit: publicHabit(habit, await schedules(pool, user.userId, id)),
      };
    },
  );
  app.put(
    '/api/v1/habits/:id',
    {
      schema: {
        tags: ['Habits'],
        summary:
          'Edit habit with version check; schedule changes take effect from next safe local day',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const id = idOf(request, reply);
      if (!id) return;
      const input = parse(editSchema, request.body, reply, request);
      if (!input) return;
      const outcome = await transaction(pool, async (client) => {
        const habit = await loadHabit(client, user.userId, id, true);
        if (!habit) return { kind: 'missing' as const };
        if (!habit.active) return { kind: 'archived' as const };
        if (habit.version !== input.version) return { kind: 'stale' as const };
        const today = dateInTimezone(new Date(), habit.timezone);
        const hasToday =
          (
            await client.query(
              `SELECT 1 FROM habit_instances WHERE habit_id=$1 AND date=$2`,
              [id, today],
            )
          ).rowCount ?? 0;
        const effective = hasToday ? addDays(today, 1) : today;
        const oldRules = await schedules(client, user.userId, id);
        const current = scheduleOn(oldRules, effective);
        if (
          input.schedule ||
          input.target !== undefined ||
          input.reminderTime !== undefined
        ) {
          const frequency =
            input.schedule?.frequency ?? current?.frequency ?? 'daily';
          const weekdays =
            input.schedule?.frequency === 'weekly'
              ? input.schedule.weekdays
              : !input.schedule && current?.frequency === 'weekly'
                ? current.weekdays
                : [];
          const monthDays =
            input.schedule?.frequency === 'monthly'
              ? input.schedule.monthDays
              : !input.schedule && current?.frequency === 'monthly'
                ? current.month_days
                : [];
          await client.query(
            `INSERT INTO habit_schedules(habit_id,user_id,effective_from,frequency,weekdays,month_days,target,reminder_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(habit_id,effective_from) DO UPDATE SET frequency=$4,weekdays=$5,month_days=$6,target=$7,reminder_time=$8`,
            [
              id,
              user.userId,
              effective,
              frequency,
              weekdays,
              monthDays,
              input.target ?? current?.target ?? 1,
              input.reminderTime ?? current?.reminder_time ?? null,
            ],
          );
        }
        const updated = await client.query<HabitRow>(
          `UPDATE habits SET name=coalesce($1,name),description=coalesce($2,description),category=coalesce($3,category),icon=coalesce($4,icon),color=coalesce($5,color),end_date=coalesce($6,end_date),version=version+1,updated_at=now() WHERE id=$7 AND user_id=$8 RETURNING *`,
          [
            input.name ?? null,
            input.description ?? null,
            input.category ?? null,
            input.icon ?? null,
            input.color ?? null,
            input.endDate ?? null,
            id,
            user.userId,
          ],
        );
        await audit(client, user.userId, 'Habit', id, 'UPDATE', request.id);
        await updateSync(
          client,
          user.userId,
          'Habit',
          id,
          updated.rows[0]?.version ?? input.version + 1,
        );
        return { kind: 'ok' as const };
      });
      if (outcome.kind === 'missing')
        return fail(reply, request, 404, 'Habit not found');
      if (outcome.kind === 'stale')
        return fail(reply, request, 409, 'Habit changed on another device');
      if (outcome.kind === 'archived')
        return fail(reply, request, 409, 'Habit is archived');
      const habit = await loadHabit(pool, user.userId, id);
      if (!habit) throw new Error('Habit missing after update');
      return {
        habit: publicHabit(habit, await schedules(pool, user.userId, id)),
      };
    },
  );
  app.delete(
    '/api/v1/habits/:id',
    {
      schema: {
        tags: ['Habits'],
        summary: 'Archive owned habit, retaining history',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const id = idOf(request, reply);
      if (!id) return;
      const outcome = await transaction(pool, async (client) => {
        const habit = await loadHabit(client, user.userId, id, true);
        if (!habit) return 'missing';
        if (!habit.active) return 'ok';
        const today = dateInTimezone(new Date(), habit.timezone);
        const hasToday =
          (
            await client.query(
              `SELECT 1 FROM habit_instances WHERE habit_id=$1 AND date=$2`,
              [id, today],
            )
          ).rowCount ?? 0;
        const archivedOn = hasToday ? addDays(today, 1) : today;
        await client.query(
          `UPDATE habits SET active=false,archived_on=$1,version=version+1,updated_at=now() WHERE id=$2 AND user_id=$3`,
          [archivedOn, id, user.userId],
        );
        await audit(client, user.userId, 'Habit', id, 'ARCHIVE', request.id);
        await updateSync(
          client,
          user.userId,
          'Habit',
          id,
          habit.version + 1,
          true,
        );
        return 'ok';
      });
      if (outcome === 'missing')
        return fail(reply, request, 404, 'Habit not found');
      return reply.code(204).send();
    },
  );
  app.post(
    '/api/v1/habits/:id/complete',
    {
      schema: {
        tags: ['Habits'],
        summary: 'Record or increment a scheduled occurrence',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const id = idOf(request, reply);
      if (!id) return;
      const input = parse(actionSchema, request.body ?? {}, reply, request);
      if (!input) return;
      if (input.value !== undefined && !input.mutationId)
        return fail(
          reply,
          request,
          400,
          'mutationId required for numeric increments',
        );
      const result = await transaction(pool, async (client) => {
        const habit = await loadHabit(client, user.userId, id, true);
        if (!habit) return { kind: 'missing' as const };
        if (!habit.active) return { kind: 'archived' as const };
        const today = dateInTimezone(new Date(), habit.timezone);
        const date = localDate(input.date ?? today);
        const rules = await schedules(client, user.userId, id);
        const series = timeline(habit, rules);
        try {
          validateCheckIn(series, date, today);
        } catch {
          return { kind: 'invalid' as const };
        }
        const rule = scheduleOn(rules, date);
        if (!rule) return { kind: 'invalid' as const };
        const fingerprint = input.mutationId
          ? requestHash(
              user.userId,
              id,
              date,
              input.value ?? rule.target,
              input.mutationId,
            )
          : null;
        if (input.mutationId) {
          const prior = await client.query<{
            request_hash: string;
            response: unknown;
          }>(
            `SELECT request_hash,response FROM mutation_receipts WHERE user_id=$1 AND mutation_id=$2`,
            [user.userId, input.mutationId],
          );
          if (prior.rows[0])
            return prior.rows[0].request_hash === fingerprint
              ? { kind: 'ok' as const, response: prior.rows[0].response }
              : { kind: 'conflict' as const };
        }
        const existing = (
          await client.query<InstanceRow>(
            `SELECT id,date,status,value,target,version FROM habit_instances WHERE habit_id=$1 AND date=$2 FOR UPDATE`,
            [id, date],
          )
        ).rows[0];
        if (existing?.status === 'frozen') return { kind: 'frozen' as const };
        if (existing?.status === 'completed' && input.value === undefined)
          return {
            kind: 'ok' as const,
            response: {
              instance: existing,
              streak: await replay(client, habit, rules, today),
            },
          };
        const target = existing?.target ?? rule.target;
        const value =
          existing?.status === 'completed'
            ? existing.value
            : input.value !== undefined
              ? (existing?.value ?? 0) + input.value
              : target;
        const status = value >= target ? 'completed' : 'partial';
        const record = existing
          ? await client.query<InstanceRow>(
              `UPDATE habit_instances SET status=$1,value=$2,version=version+1,updated_at=now() WHERE id=$3 RETURNING id,date,status,value,target,version`,
              [status, value, existing.id],
            )
          : await client.query<InstanceRow>(
              `INSERT INTO habit_instances(habit_id,user_id,schedule_id,date,timezone,status,value,target) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,date,status,value,target,version`,
              [
                id,
                user.userId,
                rule.id,
                date,
                habit.timezone,
                status,
                value,
                target,
              ],
            );
        const instance = record.rows[0];
        if (!instance) throw new Error('Occurrence write failed');
        const streak = await replay(client, habit, rules, today);
        await audit(
          client,
          user.userId,
          'HabitInstance',
          instance.id,
          existing ? 'UPDATE' : 'CREATE',
          request.id,
        );
        await updateSync(
          client,
          user.userId,
          'HabitInstance',
          instance.id,
          instance.version,
        );
        const response = { instance, streak };
        if (input.mutationId)
          await client.query(
            `INSERT INTO mutation_receipts(user_id,mutation_id,request_hash,response_status,response) VALUES($1,$2,$3,200,$4)`,
            [user.userId, input.mutationId, fingerprint, response],
          );
        return { kind: 'ok' as const, response };
      });
      if (result.kind === 'missing')
        return fail(reply, request, 404, 'Habit not found');
      if (result.kind === 'archived')
        return fail(reply, request, 409, 'Habit is archived');
      if (result.kind === 'invalid')
        return fail(
          reply,
          request,
          400,
          'Date is outside the allowed schedule or correction window',
        );
      if (result.kind === 'frozen')
        return fail(reply, request, 409, 'Frozen day cannot be completed');
      if (result.kind === 'conflict')
        return fail(
          reply,
          request,
          409,
          'Mutation ID was used for a different request',
        );
      return result.response;
    },
  );
  app.post(
    '/api/v1/habits/:id/skip',
    {
      schema: {
        tags: ['Habits'],
        summary: 'Spend monthly freeze for scheduled day',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const id = idOf(request, reply);
      if (!id) return;
      const input = parse(dateAction, request.body ?? {}, reply, request);
      if (!input) return;
      const result = await transaction(pool, async (client) => {
        const habit = await loadHabit(client, user.userId, id, true);
        if (!habit) return 'missing';
        if (!habit.active) return 'archived';
        const today = dateInTimezone(new Date(), habit.timezone);
        const date = localDate(input.date ?? today);
        const rules = await schedules(client, user.userId, id);
        try {
          validateCheckIn(timeline(habit, rules), date, today);
        } catch {
          return 'invalid';
        }
        const existing = (
          await client.query<InstanceRow>(
            `SELECT * FROM habit_instances WHERE habit_id=$1 AND date=$2 FOR UPDATE`,
            [id, date],
          )
        ).rows[0];
        if (existing?.status === 'frozen') return 'ok';
        if (
          existing &&
          (existing.status === 'completed' || existing.status === 'partial')
        )
          return 'conflict';
        const spent =
          (
            await client.query(
              `SELECT 1 FROM freeze_usage WHERE habit_id=$1 AND month=$2`,
              [id, monthStart(date)],
            )
          ).rowCount ?? 0;
        if (spent) return 'exhausted';
        const rule = scheduleOn(rules, date);
        if (!rule) return 'invalid';
        await client.query(
          `INSERT INTO freeze_usage(habit_id,user_id,month,occurrence_date) VALUES($1,$2,$3,$4)`,
          [id, user.userId, monthStart(date), date],
        );
        const record = existing
          ? await client.query<InstanceRow>(
              `UPDATE habit_instances SET status='frozen',value=0,version=version+1,updated_at=now() WHERE id=$1 RETURNING id,version`,
              [existing.id],
            )
          : await client.query<InstanceRow>(
              `INSERT INTO habit_instances(habit_id,user_id,schedule_id,date,timezone,status,value,target) VALUES($1,$2,$3,$4,$5,'frozen',0,$6) RETURNING id,version`,
              [id, user.userId, rule.id, date, habit.timezone, rule.target],
            );
        const instance = record.rows[0];
        if (!instance) throw new Error('Freeze write failed');
        await replay(client, habit, rules, today);
        await audit(
          client,
          user.userId,
          'HabitInstance',
          instance.id,
          'FREEZE',
          request.id,
        );
        await updateSync(
          client,
          user.userId,
          'HabitInstance',
          instance.id,
          instance.version,
        );
        return 'ok';
      });
      if (result === 'missing')
        return fail(reply, request, 404, 'Habit not found');
      if (result === 'archived')
        return fail(reply, request, 409, 'Habit is archived');
      if (result === 'invalid')
        return fail(
          reply,
          request,
          400,
          'Date is outside the allowed schedule or correction window',
        );
      if (result === 'exhausted')
        return fail(reply, request, 409, 'No freeze remains for this month');
      if (result === 'conflict')
        return fail(
          reply,
          request,
          409,
          'Completed or partial day cannot be frozen',
        );
      return { message: 'Day skipped; streak preserved' };
    },
  );
  app.post(
    '/api/v1/habits/:id/undo',
    {
      schema: {
        tags: ['Habits'],
        summary: 'Undo a completion within correction window',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const id = idOf(request, reply);
      if (!id) return;
      const input = parse(dateAction, request.body ?? {}, reply, request);
      if (!input) return;
      const result = await transaction(pool, async (client) => {
        const habit = await loadHabit(client, user.userId, id, true);
        if (!habit) return { kind: 'missing' as const };
        if (!habit.active) return { kind: 'archived' as const };
        const today = dateInTimezone(new Date(), habit.timezone);
        const date = localDate(input.date ?? today);
        const rules = await schedules(client, user.userId, id);
        try {
          validateCheckIn(timeline(habit, rules), date, today);
        } catch {
          return { kind: 'invalid' as const };
        }
        const removed = await client.query<{ id: number; version: number }>(
          `DELETE FROM habit_instances WHERE habit_id=$1 AND user_id=$2 AND date=$3 AND status IN ('completed','partial') RETURNING id,version`,
          [id, user.userId, date],
        );
        const item = removed.rows[0];
        if (item) {
          await audit(
            client,
            user.userId,
            'HabitInstance',
            item.id,
            'UNDO',
            request.id,
          );
          await updateSync(
            client,
            user.userId,
            'HabitInstance',
            item.id,
            item.version + 1,
            true,
          );
        }
        return {
          kind: 'ok' as const,
          streak: await replay(client, habit, rules, today),
        };
      });
      if (result.kind === 'missing')
        return fail(reply, request, 404, 'Habit not found');
      if (result.kind === 'archived')
        return fail(reply, request, 409, 'Habit is archived');
      if (result.kind === 'invalid')
        return fail(
          reply,
          request,
          400,
          'Date is outside the allowed schedule or correction window',
        );
      return { streak: result.streak };
    },
  );
  app.get(
    '/api/v1/habits/:id/logs',
    { schema: { tags: ['Habits'], summary: 'Read habit occurrence history' } },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const id = idOf(request, reply);
      if (!id) return;
      const range = parse(
        z
          .object({ from: dateSchema, to: dateSchema })
          .refine((v) => v.from <= v.to)
          .refine(
            (v) =>
              new Date(v.to).getTime() - new Date(v.from).getTime() <=
              366 * 86400000,
          ),
        request.query,
        reply,
        request,
      );
      if (!range) return;
      const habit = await loadHabit(pool, user.userId, id);
      if (!habit) return fail(reply, request, 404, 'Habit not found');
      const logs = await pool.query<InstanceRow>(
        `SELECT id,date,status,value,target,version FROM habit_instances WHERE habit_id=$1 AND user_id=$2 AND date BETWEEN $3 AND $4 ORDER BY date`,
        [id, user.userId, range.from, range.to],
      );
      return { logs: logs.rows };
    },
  );
}
