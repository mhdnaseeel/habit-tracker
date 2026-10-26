import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { dateSchema } from '../../../packages/contracts/src/index.ts';
import {
  addDays,
  dateInTimezone,
  localDate,
} from '../../../packages/domain/src/index.ts';
import type { Principal } from './auth.ts';
import { transaction } from './database.ts';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const kind = z.enum([
  'task',
  'habit',
  'goal_action',
  'appointment',
  'personal',
]);
const fields = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().max(5000).nullable().optional(),
    activityType: kind,
    scheduledDate: dateSchema,
    recurrence: z.enum(['none', 'daily']).default('none'),
    startTime: time.nullable().optional(),
    endTime: time.nullable().optional(),
    priority: z.number().int().min(1).max(5).default(3),
    reminderTime: time.nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    linkedTaskId: z.number().int().positive().nullable().optional(),
    linkedHabitId: z.number().int().positive().nullable().optional(),
    linkedGoalId: z.number().int().positive().nullable().optional(),
  })
  .strict();
const createInput = fields.superRefine(validateFields);
const editInput = fields
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict();
const idParams = z.object({ id: z.coerce.number().int().positive() });
const dateQuery = z.object({ date: dateSchema }).strict();
const rescheduleInput = z
  .object({
    version: z.number().int().positive(),
    scheduledDate: dateSchema,
    startTime: time.nullable(),
    endTime: time.nullable(),
  })
  .strict()
  .superRefine((input, ctx) => validateTimes(input, ctx));
const versionInput = z
  .object({ version: z.number().int().positive() })
  .strict();
type Authenticate = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<Principal | undefined>;
type ActivityInput = z.infer<typeof fields>;
type ActivityRow = {
  id: number;
  user_id: string;
  title: string;
  description: string | null;
  activity_type: z.infer<typeof kind>;
  scheduled_date: string;
  start_time: string | null;
  end_time: string | null;
  priority: number;
  reminder_time: string | null;
  notes: string | null;
  status: string;
  linked_task_id: number | null;
  linked_habit_id: number | null;
  linked_goal_id: number | null;
  version: number;
  completed_at: Date | null;
  cancelled_at: Date | null;
  task_title: string | null;
  task_description: string | null;
  task_priority: number | null;
  habit_name: string | null;
  goal_title: string | null;
  task_completed_at: Date | null;
  habit_status: string | null;
  habit_value: number | null;
  habit_target: number | null;
  series_id: number;
  recurrence: 'none' | 'daily';
  recurrenceStartDate: string;
  is_series_template: boolean;
  series_ends_on: string | null;
};

function validateTimes(
  input: {
    startTime?: string | null | undefined;
    endTime?: string | null | undefined;
  },
  ctx: z.RefinementCtx,
) {
  if ((input.startTime == null) !== (input.endTime == null))
    ctx.addIssue({
      code: 'custom',
      message: 'Start and end times must be supplied together',
      path: ['endTime'],
    });
  if (input.startTime && input.endTime && input.endTime <= input.startTime)
    ctx.addIssue({
      code: 'custom',
      message: 'End time must be later on the same day',
      path: ['endTime'],
    });
}
function validateFields(input: ActivityInput, ctx: z.RefinementCtx) {
  validateTimes(input, ctx);
  if (input.recurrence === 'daily' && input.activityType === 'task')
    ctx.addIssue({
      code: 'custom',
      message: 'Tasks use task recurrence settings',
      path: ['recurrence'],
    });
  if (input.activityType === 'habit' && !input.linkedHabitId)
    ctx.addIssue({
      code: 'custom',
      message: 'Choose a habit',
      path: ['linkedHabitId'],
    });
  if (input.activityType !== 'habit' && input.linkedHabitId)
    ctx.addIssue({
      code: 'custom',
      message: 'Habit link requires habit type',
      path: ['linkedHabitId'],
    });
  if (input.activityType !== 'task' && input.linkedTaskId)
    ctx.addIssue({
      code: 'custom',
      message: 'Task link requires task type',
      path: ['linkedTaskId'],
    });
  if (input.activityType !== 'goal_action' && input.linkedGoalId)
    ctx.addIssue({
      code: 'custom',
      message: 'Goal link requires goal action type',
      path: ['linkedGoalId'],
    });
}
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
  value: unknown,
  reply: FastifyReply,
  request: FastifyRequest,
): T | undefined {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    fail(
      reply,
      request,
      400,
      parsed.error.issues[0]?.message ?? 'Validation failed',
    );
    return;
  }
  return parsed.data;
}
function present(row: ActivityRow) {
  return {
    id: row.id,
    title: row.task_title ?? row.habit_name ?? row.title,
    description: row.linked_task_id ? row.task_description : row.description,
    activityType: row.activity_type,
    scheduledDate: row.scheduled_date,
    startTime: row.start_time?.slice(0, 5) ?? null,
    endTime: row.end_time?.slice(0, 5) ?? null,
    priority: row.linked_task_id
      ? (row.task_priority ?? row.priority)
      : row.priority,
    reminderTime: row.reminder_time?.slice(0, 5) ?? null,
    notes: row.notes,
    status:
      row.activity_type === 'task'
        ? row.task_completed_at
          ? 'completed'
          : 'planned'
        : row.activity_type === 'habit'
          ? row.habit_status === 'frozen'
            ? 'skipped'
            : row.habit_status === 'completed'
              ? 'completed'
              : row.habit_status === 'partial'
                ? 'partial'
                : 'planned'
          : row.status,
    linkedTaskId: row.linked_task_id,
    linkedHabitId: row.linked_habit_id,
    linkedGoalId: row.linked_goal_id,
    linkedGoalTitle: row.goal_title,
    habitValue: row.habit_value ?? 0,
    habitTarget: row.habit_target ?? 1,
    version: row.version,
    seriesId: row.series_id,
    recurrence: row.recurrence,
    recurrenceStartDate: row.scheduled_date,
    isSeriesTemplate: row.is_series_template,
    seriesEndsOn: row.series_ends_on,
  };
}
const selectActivity = `SELECT a.*,t.title AS task_title,t.description AS task_description,t.priority AS task_priority,h.name AS habit_name,g.title AS goal_title,
  ti.completed_at AS task_completed_at,hi.status AS habit_status,hi.value AS habit_value,coalesce(hi.target,hs.target) AS habit_target
  FROM daily_activities a
  LEFT JOIN tasks t ON t.id=a.linked_task_id AND t.user_id=a.user_id
  LEFT JOIN task_instances ti ON ti.task_id=t.id AND ti.user_id=a.user_id
  LEFT JOIN habits h ON h.id=a.linked_habit_id AND h.user_id=a.user_id
  LEFT JOIN LATERAL (SELECT target FROM habit_schedules WHERE habit_id=h.id AND user_id=a.user_id AND effective_from<=a.scheduled_date ORDER BY effective_from DESC LIMIT 1) hs ON true
  LEFT JOIN goals g ON g.id=a.linked_goal_id AND g.user_id=a.user_id
  LEFT JOIN habit_instances hi ON hi.habit_id=h.id AND hi.user_id=a.user_id AND hi.date=a.scheduled_date`;
async function load(
  client: pg.Pool | pg.PoolClient,
  userId: string,
  id: number,
  lock = false,
) {
  const query = `${selectActivity} WHERE a.id=$1 AND a.user_id=$2 AND a.cancelled_at IS NULL${lock ? ' FOR UPDATE OF a' : ''}`;
  return (await client.query<ActivityRow>(query, [id, userId])).rows[0];
}
async function audit(
  client: pg.PoolClient,
  userId: string,
  id: number,
  action: string,
  requestId: string,
  version: number,
  deleted = false,
) {
  await client.query(
    "INSERT INTO audit_logs(user_id,entity,entity_id,action,request_id) VALUES($1,'DailyActivity',$2,$3,$4)",
    [userId, String(id), action, requestId],
  );
  await client.query(
    "INSERT INTO sync_changes(user_id,entity,entity_id,version,deleted) VALUES($1,'DailyActivity',$2,$3,$4)",
    [userId, String(id), version, deleted],
  );
}
async function timezoneFor(pool: pg.Pool | pg.PoolClient, userId: string) {
  return (
    await pool.query<{ timezone: string }>(
      'SELECT timezone FROM users WHERE id=$1',
      [userId],
    )
  ).rows[0]?.timezone;
}
async function checkLinks(
  client: pg.PoolClient,
  userId: string,
  input: ActivityInput,
) {
  if (input.linkedHabitId) {
    const habit = (
      await client.query<{
        start_date: string;
        end_date: string | null;
        archived_on: string | null;
      }>(
        'SELECT start_date,end_date,archived_on FROM habits WHERE id=$1 AND user_id=$2',
        [input.linkedHabitId, userId],
      )
    ).rows[0];
    if (
      !habit ||
      habit.start_date > input.scheduledDate ||
      (habit.end_date && habit.end_date < input.scheduledDate) ||
      (habit.archived_on && habit.archived_on <= input.scheduledDate)
    )
      return 'Habit is unavailable on this date';
    const rules = (
      await client.query<{
        frequency: string;
        weekdays: number[];
        month_days: number[];
      }>(
        'SELECT frequency,weekdays,month_days FROM habit_schedules WHERE habit_id=$1 AND user_id=$2 AND effective_from<=$3 ORDER BY effective_from DESC LIMIT 1',
        [input.linkedHabitId, userId, input.scheduledDate],
      )
    ).rows[0];
    const day = new Date(`${input.scheduledDate}T12:00:00Z`);
    if (
      !rules ||
      (rules.frequency === 'weekly' &&
        !rules.weekdays.includes(day.getUTCDay())) ||
      (rules.frequency === 'monthly' &&
        !rules.month_days.includes(day.getUTCDate()))
    )
      return 'Habit is not scheduled on this date';
  }
  if (input.linkedTaskId) {
    const task = (
      await client.query<{ due_date: string; archived_at: Date | null }>(
        'SELECT due_date,archived_at FROM tasks WHERE id=$1 AND user_id=$2',
        [input.linkedTaskId, userId],
      )
    ).rows[0];
    if (!task || task.archived_at || task.due_date !== input.scheduledDate)
      return 'Task must be active and due on this date';
  }
  if (input.linkedGoalId) {
    const goal = (
      await client.query<{ archived_at: Date | null }>(
        'SELECT archived_at FROM goals WHERE id=$1 AND user_id=$2',
        [input.linkedGoalId, userId],
      )
    ).rows[0];
    if (!goal || goal.archived_at) return 'Goal is unavailable';
  }
  return null;
}
async function ensureOccurrence(
  client: pg.PoolClient,
  userId: string,
  date: string,
) {
  await client.query(
    `INSERT INTO daily_activities(
       user_id,title,description,activity_type,scheduled_date,start_time,end_time,
       timezone,priority,reminder_time,notes,linked_habit_id,linked_goal_id,
       series_id,recurrence,is_series_template
     )
     SELECT series.user_id,series.title,series.description,series.activity_type,$2,
       series.start_time,series.end_time,series.timezone,series.priority,
       series.reminder_time,series.notes,series.linked_habit_id,series.linked_goal_id,
       series.series_id,'daily',false
       FROM daily_activities AS series
      WHERE series.user_id=$1 AND series.recurrence='daily'
        AND series.is_series_template=true AND series.scheduled_date<=$2
        AND (series.series_ends_on IS NULL OR series.series_ends_on >= $2)
        AND series.cancelled_at IS NULL
        AND (
          series.linked_habit_id IS NULL OR EXISTS (
            SELECT 1
              FROM habits AS habit
              JOIN LATERAL (
                SELECT frequency,weekdays,month_days
                  FROM habit_schedules
                 WHERE habit_id=habit.id AND user_id=habit.user_id
                   AND effective_from<=$2
                 ORDER BY effective_from DESC LIMIT 1
              ) AS schedule ON true
             WHERE habit.id=series.linked_habit_id AND habit.user_id=$1
               AND habit.start_date<=$2
               AND (habit.end_date IS NULL OR habit.end_date >= $2)
               AND (habit.archived_on IS NULL OR habit.archived_on > $2)
               AND (schedule.frequency<>'weekly' OR
                    EXTRACT(DOW FROM $2::date)::integer=ANY(schedule.weekdays))
               AND (schedule.frequency<>'monthly' OR
                    EXTRACT(DAY FROM $2::date)::integer=ANY(schedule.month_days))
          )
        )
     ON CONFLICT(series_id,scheduled_date) DO NOTHING`,
    [userId, date],
  );
}
export async function registerActivities(
  app: FastifyInstance,
  pool: pg.Pool,
  authenticate: Authenticate,
) {
  app.get(
    '/api/v1/activities',
    {
      schema: {
        tags: ['Today'],
        summary: 'List owned activity blocks for a local date',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const input = parse(dateQuery, request.query, reply, request);
      if (!input) return;
      const rows = await transaction(pool, async (client) => {
        await ensureOccurrence(client, user.userId, input.date);
        return client.query<ActivityRow>(
          `${selectActivity} WHERE a.user_id=$1 AND a.scheduled_date=$2 AND a.cancelled_at IS NULL AND (a.is_series_template=false OR a.is_series_template=true AND a.scheduled_date=$2) ORDER BY a.start_time NULLS LAST,a.end_time,a.id`,
          [user.userId, input.date],
        );
      });
      return { activities: rows.rows.map(present) };
    },
  );
  app.get(
    '/api/v1/activities/:id',
    { schema: { tags: ['Today'], summary: 'Get owned activity' } },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const id = parse(idParams, request.params, reply, request)?.id;
      if (!id) return;
      const row = await load(pool, user.userId, id);
      return row
        ? { activity: present(row) }
        : fail(reply, request, 404, 'Activity not found');
    },
  );
  app.post(
    '/api/v1/activities',
    {
      schema: { tags: ['Today'], summary: 'Create an activity or time block' },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const input = parse(createInput, request.body, reply, request);
      if (!input) return;
      const tz = await timezoneFor(pool, user.userId);
      if (!tz) return fail(reply, request, 401, 'Authentication required');
      let outcome: { id?: number; error?: string };
      try {
        outcome = await transaction(pool, async (client) => {
          const error = await checkLinks(client, user.userId, input);
          if (error) return { error };
          let taskId = input.linkedTaskId ?? null;
          if (input.activityType === 'task' && !taskId) {
            const task = (
              await client.query<{ id: number }>(
                'INSERT INTO tasks(user_id,title,description,due_date,priority,carry_over) VALUES($1,$2,$3,$4,$5,false) RETURNING id',
                [
                  user.userId,
                  input.title,
                  input.description ?? null,
                  input.scheduledDate,
                  input.priority,
                ],
              )
            ).rows[0];
            if (!task) throw new Error('Task insert failed');
            taskId = task.id;
            await client.query(
              'INSERT INTO task_instances(task_id,user_id,original_date,display_date) VALUES($1,$2,$3,$3)',
              [taskId, user.userId, input.scheduledDate],
            );
            await client.query(
              "INSERT INTO audit_logs(user_id,entity,entity_id,action,request_id) VALUES($1,'Task',$2,'CREATE',$3)",
              [user.userId, String(taskId), request.id],
            );
            await client.query(
              "INSERT INTO sync_changes(user_id,entity,entity_id,version) VALUES($1,'Task',$2,1)",
              [user.userId, String(taskId)],
            );
          }
          const row = (
            await client.query<{ id: number }>(
              `INSERT INTO daily_activities(user_id,title,description,activity_type,scheduled_date,start_time,end_time,timezone,priority,reminder_time,notes,linked_task_id,linked_habit_id,linked_goal_id,recurrence,is_series_template)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
              [
                user.userId,
                input.title,
                input.description ?? null,
                input.activityType,
                input.scheduledDate,
                input.startTime ?? null,
                input.endTime ?? null,
                tz,
                input.priority,
                input.reminderTime ?? null,
                input.notes ?? null,
                taskId,
                input.linkedHabitId ?? null,
                input.linkedGoalId ?? null,
                input.recurrence,
                input.recurrence === 'daily',
              ],
            )
          ).rows[0];
          if (!row) throw new Error('Activity insert failed');
          await client.query(
            'UPDATE daily_activities SET series_id=$1 WHERE id=$1',
            [row.id],
          );
          await audit(client, user.userId, row.id, 'CREATE', request.id, 1);
          return { id: row.id };
        });
      } catch (cause) {
        if (cause instanceof Error && 'code' in cause && cause.code === '23505')
          return fail(
            reply,
            request,
            409,
            'This task or habit already has an activity on this date',
          );
        throw cause;
      }
      if (outcome.error) return fail(reply, request, 400, outcome.error);
      const row = await load(pool, user.userId, outcome.id!);
      return reply.code(201).send({ activity: present(row!) });
    },
  );
  app.patch(
    '/api/v1/activities/:id',
    {
      schema: {
        tags: ['Today'],
        summary: 'Edit an activity with version check',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const id = parse(idParams, request.params, reply, request)?.id;
      if (!id) return;
      const input = parse(editInput, request.body, reply, request);
      if (!input) return;
      const outcome = await transaction(pool, async (client) => {
        const row = await load(client, user.userId, id, true);
        if (!row) return 'missing';
        if (row.version !== input.version) return 'stale';
        if (row.status === 'completed' || row.status === 'skipped')
          return 'finished';
        const next: ActivityInput = {
          title: input.title ?? row.title,
          description:
            input.description === undefined
              ? row.description
              : input.description,
          activityType: input.activityType ?? row.activity_type,
          scheduledDate: input.scheduledDate ?? row.scheduled_date,
          recurrence: row.recurrence,
          startTime:
            input.startTime === undefined
              ? (row.start_time?.slice(0, 5) ?? null)
              : input.startTime,
          endTime:
            input.endTime === undefined
              ? (row.end_time?.slice(0, 5) ?? null)
              : input.endTime,
          priority: input.priority ?? row.priority,
          reminderTime:
            input.reminderTime === undefined
              ? (row.reminder_time?.slice(0, 5) ?? null)
              : input.reminderTime,
          notes: input.notes === undefined ? row.notes : input.notes,
          linkedTaskId:
            input.linkedTaskId === undefined
              ? row.linked_task_id
              : input.linkedTaskId,
          linkedHabitId:
            input.linkedHabitId === undefined
              ? row.linked_habit_id
              : input.linkedHabitId,
          linkedGoalId:
            input.linkedGoalId === undefined
              ? row.linked_goal_id
              : input.linkedGoalId,
        };
        const checked = createInput.safeParse(next);
        if (!checked.success) return 'invalid';
        if (
          row.linked_task_id !== next.linkedTaskId ||
          row.linked_habit_id !== next.linkedHabitId ||
          row.activity_type !== next.activityType
        )
          return 'relink';
        if (
          row.activity_type === 'task' &&
          row.scheduled_date !== next.scheduledDate
        )
          return 'taskDate';
        const error = await checkLinks(client, user.userId, next);
        if (error) return error;
        if (row.recurrence === 'daily') {
          const templateId = row.series_id;
          const template = await load(client, user.userId, templateId, true);
          if (!template) return 'missing';
          if (id === templateId) {
            const newStartDate = next.scheduledDate;
            if (newStartDate < row.scheduled_date) return 'recurrenceStartDate';
            const updatedTemplate = await client.query<{ version: number }>(
              `UPDATE daily_activities SET title=$1,description=$2,start_time=$3,end_time=$4,priority=$5,reminder_time=$6,notes=$7,linked_goal_id=$8,version=version+1,updated_at=now() WHERE id=$9 AND user_id=$10 RETURNING version`,
              [
                next.title,
                next.description ?? null,
                next.startTime ?? null,
                next.endTime ?? null,
                next.priority,
                next.reminderTime ?? null,
                next.notes ?? null,
                next.linkedGoalId ?? null,
                templateId,
                user.userId,
              ],
            );
            if (updatedTemplate.rows[0])
              await audit(
                client,
                user.userId,
                templateId,
                'UPDATE',
                request.id,
                updatedTemplate.rows[0].version,
              );
          } else {
            const updatedOccurrence = await client.query<{ version: number }>(
              `UPDATE daily_activities SET title=$1,description=$2,start_time=$3,end_time=$4,priority=$5,reminder_time=$6,notes=$7,linked_goal_id=$8,version=version+1,updated_at=now() WHERE id=$9 AND user_id=$10 RETURNING version`,
              [
                next.title,
                next.description ?? null,
                next.startTime ?? null,
                next.endTime ?? null,
                next.priority,
                next.reminderTime ?? null,
                next.notes ?? null,
                next.linkedGoalId ?? null,
                id,
                user.userId,
              ],
            );
            if (updatedOccurrence.rows[0])
              await audit(
                client,
                user.userId,
                id,
                'UPDATE',
                request.id,
                updatedOccurrence.rows[0].version,
              );
          }
          const changed = await client.query<{ id: number; version: number }>(
            `UPDATE daily_activities SET title=$1,description=$2,start_time=$3,end_time=$4,priority=$5,reminder_time=$6,notes=$7,linked_goal_id=$8,version=version+1,updated_at=now()
              WHERE user_id=$9 AND series_id=$10 AND scheduled_date >= $11 AND id<>$12 AND cancelled_at IS NULL AND status NOT IN ('completed','skipped') RETURNING id,version`,
            [
              next.title,
              next.description ?? null,
              next.startTime ?? null,
              next.endTime ?? null,
              next.priority,
              next.reminderTime ?? null,
              next.notes ?? null,
              next.linkedGoalId ?? null,
              user.userId,
              templateId,
              id === templateId ? next.scheduledDate : row.scheduled_date,
              templateId,
            ],
          );
          for (const updated of changed.rows)
            await audit(
              client,
              user.userId,
              updated.id,
              'UPDATE',
              request.id,
              updated.version,
            );
        } else {
          await client.query(
            `UPDATE daily_activities SET title=$1,description=$2,scheduled_date=$3,start_time=$4,end_time=$5,priority=$6,reminder_time=$7,notes=$8,linked_goal_id=$9,version=version+1,updated_at=now() WHERE id=$10 AND user_id=$11`,
            [
              next.title,
              next.description ?? null,
              next.scheduledDate,
              next.startTime ?? null,
              next.endTime ?? null,
              next.priority,
              next.reminderTime ?? null,
              next.notes ?? null,
              next.linkedGoalId ?? null,
              id,
              user.userId,
            ],
          );
          await audit(
            client,
            user.userId,
            id,
            'UPDATE',
            request.id,
            row.version + 1,
          );
        }
        if (
          row.activity_type === 'task' &&
          (next.title !== row.title ||
            next.description !== row.description ||
            next.priority !== row.priority)
        )
          await client.query(
            'UPDATE tasks SET title=$1,description=$2,priority=$3,version=version+1,updated_at=now() WHERE id=$4 AND user_id=$5',
            [
              next.title,
              next.description ?? null,
              next.priority,
              row.linked_task_id,
              user.userId,
            ],
          );
        return 'ok';
      });
      if (outcome === 'missing')
        return fail(reply, request, 404, 'Activity not found');
      if (outcome === 'stale')
        return fail(reply, request, 409, 'Activity changed on another device');
      if (outcome === 'finished')
        return fail(
          reply,
          request,
          409,
          'Undo completion or skip before editing',
        );
      if (outcome === 'relink')
        return fail(
          reply,
          request,
          400,
          'Linked records cannot be changed; create a new activity',
        );
      if (outcome === 'taskDate')
        return fail(
          reply,
          request,
          400,
          'Reschedule the task in Tasks before moving its time block',
        );
      if (outcome === 'recurrenceStartDate')
        return fail(
          reply,
          request,
          400,
          'A recurrence start date cannot move earlier after the series is created',
        );
      if (outcome !== 'ok')
        return fail(
          reply,
          request,
          400,
          outcome === 'invalid' ? 'Invalid activity details' : outcome,
        );
      return { activity: present((await load(pool, user.userId, id))!) };
    },
  );
  app.post(
    '/api/v1/activities/:id/reschedule',
    {
      schema: {
        tags: ['Today'],
        summary: 'Move an activity to another local time or date',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const id = parse(idParams, request.params, reply, request)?.id;
      if (!id) return;
      const input = parse(rescheduleInput, request.body, reply, request);
      if (!input) return;
      const outcome = await transaction(pool, async (client) => {
        const row = await load(client, user.userId, id, true);
        if (!row) return 'missing';
        if (row.recurrence === 'daily') return 'recurring';
        if (row.version !== input.version) return 'stale';
        if (row.status !== 'planned') return 'finished';
        if (
          row.task_completed_at ||
          row.habit_status === 'completed' ||
          row.habit_status === 'frozen'
        )
          return 'finished';
        if (
          row.activity_type === 'habit' &&
          row.scheduled_date !== input.scheduledDate
        )
          return 'habitDate';
        const next: ActivityInput = {
          title: row.title,
          description: row.description,
          activityType: row.activity_type,
          scheduledDate: input.scheduledDate,
          recurrence: row.recurrence,
          startTime: input.startTime,
          endTime: input.endTime,
          priority: row.priority,
          reminderTime: row.reminder_time?.slice(0, 5) ?? null,
          notes: row.notes,
          linkedTaskId: row.linked_task_id,
          linkedHabitId: row.linked_habit_id,
          linkedGoalId: row.linked_goal_id,
        };
        const error = await checkLinks(client, user.userId, next);
        if (error && row.activity_type !== 'task') return error;
        if (
          row.activity_type === 'task' &&
          row.scheduled_date !== input.scheduledDate
        ) {
          const completed = (
            await client.query<{ completed_at: Date | null }>(
              'SELECT completed_at FROM task_instances WHERE task_id=$1 AND user_id=$2 FOR UPDATE',
              [row.linked_task_id, user.userId],
            )
          ).rows[0]?.completed_at;
          if (completed) return 'completedTask';
          await client.query(
            'UPDATE tasks SET due_date=$1,version=version+1,updated_at=now() WHERE id=$2 AND user_id=$3',
            [input.scheduledDate, row.linked_task_id, user.userId],
          );
          await client.query(
            'UPDATE task_instances SET original_date=$1,display_date=$1,version=version+1,updated_at=now() WHERE task_id=$2 AND user_id=$3',
            [input.scheduledDate, row.linked_task_id, user.userId],
          );
          await client.query(
            "INSERT INTO audit_logs(user_id,entity,entity_id,action,request_id) VALUES($1,'Task',$2,'RESCHEDULE',$3)",
            [user.userId, String(row.linked_task_id), request.id],
          );
          await client.query(
            "INSERT INTO sync_changes(user_id,entity,entity_id,version) SELECT $1,'Task',$2,version FROM tasks WHERE id=$3",
            [user.userId, String(row.linked_task_id), row.linked_task_id],
          );
        }
        await client.query(
          'UPDATE daily_activities SET scheduled_date=$1,start_time=$2,end_time=$3,version=version+1,updated_at=now() WHERE id=$4 AND user_id=$5',
          [
            input.scheduledDate,
            input.startTime,
            input.endTime,
            id,
            user.userId,
          ],
        );
        await audit(
          client,
          user.userId,
          id,
          'RESCHEDULE',
          request.id,
          row.version + 1,
        );
        return 'ok';
      });
      if (outcome === 'missing')
        return fail(reply, request, 404, 'Activity not found');
      if (outcome === 'stale')
        return fail(reply, request, 409, 'Activity changed on another device');
      if (outcome === 'recurring')
        return fail(
          reply,
          request,
          400,
          'Recurring activities are edited through their activity form',
        );
      if (outcome !== 'ok')
        return fail(
          reply,
          request,
          400,
          outcome === 'habitDate'
            ? 'Create a new habit block for another scheduled day'
            : outcome === 'completedTask'
              ? 'Completed task cannot be rescheduled'
              : 'Activity cannot be rescheduled',
        );
      return { activity: present((await load(pool, user.userId, id))!) };
    },
  );
  for (const action of ['complete', 'undo', 'skip'] as const) {
    app.post(
      `/api/v1/activities/:id/${action}`,
      {
        schema: { tags: ['Today'], summary: `${action} a standalone activity` },
      },
      async (request, reply) => {
        const user = await authenticate(request, reply);
        if (!user) return;
        const id = parse(idParams, request.params, reply, request)?.id;
        if (!id) return;
        const row = await load(pool, user.userId, id);
        if (!row) return fail(reply, request, 404, 'Activity not found');
        if (row.activity_type === 'task' || row.activity_type === 'habit')
          return fail(
            reply,
            request,
            409,
            'Use the linked task or habit check-in action',
          );
        const tz = await timezoneFor(pool, user.userId);
        const today = dateInTimezone(new Date(), tz!);
        if (action === 'complete' && row.scheduled_date > today)
          return fail(
            reply,
            request,
            400,
            'Future activity cannot be completed',
          );
        const outcome = await transaction(pool, async (client) => {
          const current = await load(client, user.userId, id, true);
          if (!current) return 'missing';
          const status =
            action === 'complete'
              ? 'completed'
              : action === 'skip'
                ? 'skipped'
                : 'planned';
          if (current.status === status) return 'ok';
          if (action === 'undo' && current.status === 'planned') return 'ok';
          if (action === 'complete' && current.status === 'skipped')
            return 'skipped';
          if (action === 'skip' && current.status === 'completed')
            return 'completed';
          await client.query(
            "UPDATE daily_activities SET status=$1,completed_at=CASE WHEN $1='completed' THEN now() ELSE NULL END,version=version+1,updated_at=now() WHERE id=$2 AND user_id=$3",
            [status, id, user.userId],
          );
          await audit(
            client,
            user.userId,
            id,
            action.toUpperCase(),
            request.id,
            current.version + 1,
          );
          return 'ok';
        });
        if (outcome === 'skipped')
          return fail(reply, request, 409, 'Undo skip before completing');
        if (outcome === 'completed')
          return fail(reply, request, 409, 'Undo completion before skipping');
        return { activity: present((await load(pool, user.userId, id))!) };
      },
    );
  }
  app.delete(
    '/api/v1/activities/:id',
    {
      schema: {
        tags: ['Today'],
        summary: 'Cancel an activity, retaining audit history',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const id = parse(idParams, request.params, reply, request)?.id;
      if (!id) return;
      const input = parse(versionInput, request.body, reply, request);
      if (!input) return;
      const outcome = await transaction(pool, async (client) => {
        const row = await load(client, user.userId, id, true);
        if (!row) return 'missing';
        if (row.version !== input.version) return 'stale';
        if (
          (row.status === 'completed' ||
            row.task_completed_at ||
            row.habit_status === 'completed') &&
          row.recurrence !== 'daily'
        )
          return 'completed';
        if (row.recurrence === 'daily') {
          const template = await client.query<{
            version: number;
            series_ends_on: string | null;
          }>(
            'UPDATE daily_activities SET series_ends_on=least(coalesce(series_ends_on,$1),$1),version=version+1,updated_at=now() WHERE id=$2 AND user_id=$3 RETURNING version,series_ends_on',
            [
              addDays(localDate(row.scheduled_date), -1),
              row.series_id,
              user.userId,
            ],
          );
          if (template.rows[0]) {
            await audit(
              client,
              user.userId,
              row.series_id,
              'END_SERIES',
              request.id,
              template.rows[0].version,
            );
            const cancelled = await client.query<{
              id: number;
              version: number;
            }>(
              `UPDATE daily_activities SET status='cancelled',cancelled_at=now(),version=version+1,updated_at=now()
                WHERE user_id=$1 AND series_id=$2 AND scheduled_date > $3 AND cancelled_at IS NULL AND status NOT IN ('completed','skipped') RETURNING id,version`,
              [user.userId, row.series_id, template.rows[0].series_ends_on],
            );
            for (const occurrence of cancelled.rows)
              await audit(
                client,
                user.userId,
                occurrence.id,
                'CANCEL',
                request.id,
                occurrence.version,
                true,
              );
          }
        } else {
          await client.query(
            "UPDATE daily_activities SET status='cancelled',cancelled_at=now(),version=version+1,updated_at=now() WHERE id=$1 AND user_id=$2",
            [id, user.userId],
          );
          await audit(
            client,
            user.userId,
            id,
            'CANCEL',
            request.id,
            row.version + 1,
            true,
          );
        }
        return 'ok';
      });
      if (outcome === 'missing')
        return fail(reply, request, 404, 'Activity not found');
      if (outcome === 'stale')
        return fail(reply, request, 409, 'Activity changed on another device');
      if (outcome === 'completed')
        return fail(reply, request, 409, 'Undo completion before cancelling');
      return reply.code(204).send();
    },
  );
}
