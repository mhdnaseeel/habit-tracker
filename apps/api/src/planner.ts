import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { dateSchema } from '../../../packages/contracts/src/index.ts';
import { dateInTimezone } from '../../../packages/domain/src/index.ts';
import type { Principal } from './auth.ts';

const areas = [
  'Health',
  'Career',
  'Finances',
  'Relationships',
  'Creativity',
  'Learning',
  'Mindfulness',
  'Home',
  'Community',
  'Leisure',
] as const;
const goalInput = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().max(5000).default(''),
    category: z.enum(areas),
    deadline: dateSchema.nullable().default(null),
  })
  .strict();
const goalEdit = goalInput
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict();
const stepInput = z
  .object({ title: z.string().trim().min(1).max(100) })
  .strict();
const stepEdit = z.object({ completed: z.boolean() }).strict();
const mindsetInput = z
  .object({
    energy: z.number().int().min(1).max(5),
    focus: z.number().int().min(1).max(5),
    motivation: z.number().int().min(1).max(5),
  })
  .strict();
const journalInput = z
  .object({
    content: z.string().trim().min(1).max(20000),
    version: z.number().int().positive().nullable(),
  })
  .strict();
const journalDelete = z
  .object({ version: z.number().int().positive() })
  .strict();
const idParams = z.object({ id: z.coerce.number().int().positive() });
const stepParams = z.object({
  id: z.coerce.number().int().positive(),
  stepId: z.coerce.number().int().positive(),
});
const linkParams = z.object({
  id: z.coerce.number().int().positive(),
  habitId: z.coerce.number().int().positive(),
});
const dateParams = z.object({ date: dateSchema });
const monthParams = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
const weekQuery = z
  .object({ from: dateSchema, to: dateSchema })
  .strict()
  .refine(
    ({ from, to }) =>
      from <= to && Date.parse(to) - Date.parse(from) <= 6 * 86400000,
  );
type Authenticate = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<Principal | undefined>;
type GoalRow = {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  start_date: string;
  deadline: string | null;
  version: number;
};
type StepRow = {
  id: number;
  goal_id: number;
  title: string;
  completed_at: Date | null;
};
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
  const result = schema.safeParse(value);
  if (!result.success) {
    fail(reply, request, 400, 'Validation failed');
    return;
  }
  return result.data;
}
async function todayFor(pool: pg.Pool | pg.PoolClient, userId: string) {
  const row = (
    await pool.query<{ timezone: string }>(
      'SELECT timezone FROM users WHERE id=$1',
      [userId],
    )
  ).rows[0];
  return row ? dateInTimezone(new Date(), row.timezone) : null;
}
async function getGoal(
  pool: pg.Pool | pg.PoolClient,
  userId: string,
  id: number,
) {
  return (
    await pool.query<GoalRow>(
      'SELECT id,title,description,category,start_date,deadline,version FROM goals WHERE id=$1 AND user_id=$2 AND archived_at IS NULL',
      [id, userId],
    )
  ).rows[0];
}
async function publicGoal(
  pool: pg.Pool | pg.PoolClient,
  userId: string,
  row: GoalRow,
) {
  const steps = (
    await pool.query<StepRow>(
      'SELECT id,goal_id,title,completed_at FROM goal_steps WHERE user_id=$1 AND goal_id=$2 ORDER BY sort_order,id',
      [userId, row.id],
    )
  ).rows;
  const linked = (
    await pool.query<{ habit_id: number }>(
      'SELECT habit_id FROM goal_habits WHERE user_id=$1 AND goal_id=$2 AND unlinked_on IS NULL ORDER BY habit_id',
      [userId, row.id],
    )
  ).rows;
  const completed = steps.filter((step) => step.completed_at !== null).length;
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    category: row.category,
    startDate: row.start_date,
    deadline: row.deadline,
    version: row.version,
    steps: steps.map((step) => ({
      id: step.id,
      title: step.title,
      completed: step.completed_at !== null,
    })),
    habitIds: linked.map((item) => item.habit_id),
    progress: {
      completed,
      total: steps.length,
      percentage: steps.length
        ? Math.round((completed / steps.length) * 100)
        : null,
    },
  };
}

export async function registerPlanner(
  app: FastifyInstance,
  pool: pg.Pool,
  authenticate: Authenticate,
) {
  app.get(
    '/api/v1/goals',
    { schema: { tags: ['Goals'], summary: 'List owned goals and steps' } },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const rows = (
        await pool.query<GoalRow>(
          'SELECT id,title,description,category,start_date,deadline,version FROM goals WHERE user_id=$1 AND archived_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 500',
          [user.userId],
        )
      ).rows;
      return {
        goals: await Promise.all(
          rows.map((row) => publicGoal(pool, user.userId, row)),
        ),
        areas,
      };
    },
  );
  app.post(
    '/api/v1/goals',
    { schema: { tags: ['Goals'], summary: 'Create a goal' } },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const input = parse(goalInput, request.body, reply, request);
      if (!input) return;
      const today = await todayFor(pool, user.userId);
      if (!today) return fail(reply, request, 401, 'Authentication required');
      if (input.deadline && input.deadline < today)
        return fail(reply, request, 400, 'Deadline is before today');
      const row = (
        await pool.query<GoalRow>(
          'INSERT INTO goals(user_id,title,description,category,start_date,deadline) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,title,description,category,start_date,deadline,version',
          [
            user.userId,
            input.title,
            input.description,
            input.category,
            today,
            input.deadline,
          ],
        )
      ).rows[0];
      if (!row) throw new Error('Goal insert failed');
      return reply
        .code(201)
        .send({ goal: await publicGoal(pool, user.userId, row) });
    },
  );
  app.put(
    '/api/v1/goals/:id',
    { schema: { tags: ['Goals'], summary: 'Edit an owned goal' } },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const params = parse(idParams, request.params, reply, request);
      if (!params) return;
      const input = parse(goalEdit, request.body, reply, request);
      if (!input) return;
      const old = await getGoal(pool, user.userId, params.id);
      if (!old) return fail(reply, request, 404, 'Goal not found');
      if (input.deadline && input.deadline < old.start_date)
        return fail(reply, request, 400, 'Deadline is before goal start');
      const row = (
        await pool.query<GoalRow>(
          'UPDATE goals SET title=coalesce($1,title),description=coalesce($2,description),category=coalesce($3,category),deadline=$4,version=version+1,updated_at=now() WHERE id=$5 AND user_id=$6 AND version=$7 AND archived_at IS NULL RETURNING id,title,description,category,start_date,deadline,version',
          [
            input.title ?? null,
            input.description ?? null,
            input.category ?? null,
            input.deadline === undefined ? old.deadline : input.deadline,
            params.id,
            user.userId,
            input.version,
          ],
        )
      ).rows[0];
      if (!row)
        return fail(reply, request, 409, 'Goal changed on another device');
      return { goal: await publicGoal(pool, user.userId, row) };
    },
  );
  app.delete(
    '/api/v1/goals/:id',
    { schema: { tags: ['Goals'], summary: 'Archive an owned goal' } },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const params = parse(idParams, request.params, reply, request);
      if (!params) return;
      const result = await pool.query(
        'UPDATE goals SET archived_at=now(),version=version+1,updated_at=now() WHERE id=$1 AND user_id=$2 AND archived_at IS NULL',
        [params.id, user.userId],
      );
      if (!result.rowCount) return fail(reply, request, 404, 'Goal not found');
      return reply.code(204).send();
    },
  );
  app.post(
    '/api/v1/goals/:id/steps',
    { schema: { tags: ['Goals'], summary: 'Add an owned goal step' } },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const params = parse(idParams, request.params, reply, request);
      if (!params) return;
      const input = parse(stepInput, request.body, reply, request);
      if (!input) return;
      const goal = await getGoal(pool, user.userId, params.id);
      if (!goal) return fail(reply, request, 404, 'Goal not found');
      const row = (
        await pool.query<{ id: number }>(
          'INSERT INTO goal_steps(goal_id,user_id,title) VALUES($1,$2,$3) RETURNING id',
          [params.id, user.userId, input.title],
        )
      ).rows[0];
      return reply
        .code(201)
        .send({ step: { id: row?.id, title: input.title, completed: false } });
    },
  );
  app.put(
    '/api/v1/goals/:id/steps/:stepId',
    {
      schema: {
        tags: ['Goals'],
        summary: 'Complete or undo an owned goal step',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const params = parse(stepParams, request.params, reply, request);
      if (!params) return;
      const input = parse(stepEdit, request.body, reply, request);
      if (!input) return;
      const row = (
        await pool.query<{ id: number }>(
          'UPDATE goal_steps s SET completed_at=CASE WHEN $1 THEN now() ELSE NULL END FROM goals g WHERE s.id=$2 AND s.goal_id=$3 AND s.user_id=$4 AND g.id=s.goal_id AND g.user_id=s.user_id AND g.archived_at IS NULL RETURNING s.id',
          [input.completed, params.stepId, params.id, user.userId],
        )
      ).rows[0];
      if (!row) return fail(reply, request, 404, 'Step not found');
      return { step: { id: row.id, completed: input.completed } };
    },
  );
  app.delete(
    '/api/v1/goals/:id/steps/:stepId',
    { schema: { tags: ['Goals'], summary: 'Delete an owned goal step' } },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const params = parse(stepParams, request.params, reply, request);
      if (!params) return;
      const result = await pool.query(
        'DELETE FROM goal_steps s USING goals g WHERE s.id=$1 AND s.goal_id=$2 AND s.user_id=$3 AND g.id=s.goal_id AND g.user_id=s.user_id AND g.archived_at IS NULL',
        [params.stepId, params.id, user.userId],
      );
      if (!result.rowCount) return fail(reply, request, 404, 'Step not found');
      return reply.code(204).send();
    },
  );
  app.post(
    '/api/v1/goals/:id/habits/:habitId',
    {
      schema: {
        tags: ['Goals'],
        summary: 'Link an owned habit to an owned goal',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const params = parse(linkParams, request.params, reply, request);
      if (!params) return;
      const today = await todayFor(pool, user.userId);
      if (!today) return fail(reply, request, 401, 'Authentication required');
      const goal = await getGoal(pool, user.userId, params.id);
      if (!goal) return fail(reply, request, 404, 'Goal not found');
      const habit = (
        await pool.query(
          'SELECT 1 FROM habits WHERE id=$1 AND user_id=$2 AND active=true',
          [params.habitId, user.userId],
        )
      ).rowCount;
      if (!habit) return fail(reply, request, 404, 'Habit not found');
      await pool.query(
        'INSERT INTO goal_habits(goal_id,habit_id,user_id,linked_on) VALUES($1,$2,$3,$4) ON CONFLICT(goal_id,habit_id) WHERE unlinked_on IS NULL DO NOTHING',
        [params.id, params.habitId, user.userId, today],
      );
      return { linked: true };
    },
  );
  app.delete(
    '/api/v1/goals/:id/habits/:habitId',
    {
      schema: {
        tags: ['Goals'],
        summary: 'Unlink an owned habit from an owned goal',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const params = parse(linkParams, request.params, reply, request);
      if (!params) return;
      const today = await todayFor(pool, user.userId);
      if (!today) return fail(reply, request, 401, 'Authentication required');
      const result = await pool.query(
        'UPDATE goal_habits SET unlinked_on=$1 WHERE goal_id=$2 AND habit_id=$3 AND user_id=$4 AND unlinked_on IS NULL',
        [today, params.id, params.habitId, user.userId],
      );
      if (!result.rowCount) return fail(reply, request, 404, 'Link not found');
      return reply.code(204).send();
    },
  );
  app.get(
    '/api/v1/mindset',
    {
      schema: {
        tags: ['Tasks'],
        summary: 'Read daily mindset entries for one week',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const range = parse(weekQuery, request.query, reply, request);
      if (!range) return;
      const rows = (
        await pool.query<{
          date: string;
          energy: number;
          focus: number;
          motivation: number;
        }>(
          'SELECT date,energy,focus,motivation FROM daily_mindset WHERE user_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date',
          [user.userId, range.from, range.to],
        )
      ).rows;
      return { entries: rows };
    },
  );
  app.put(
    '/api/v1/mindset/:date',
    {
      schema: {
        tags: ['Tasks'],
        summary: 'Save daily energy, focus and motivation',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const params = parse(dateParams, request.params, reply, request);
      if (!params) return;
      const input = parse(mindsetInput, request.body, reply, request);
      if (!input) return;
      const today = await todayFor(pool, user.userId);
      if (!today) return fail(reply, request, 401, 'Authentication required');
      if (params.date > today)
        return fail(
          reply,
          request,
          400,
          'Future mindset entries are not allowed',
        );
      await pool.query(
        'INSERT INTO daily_mindset(user_id,date,energy,focus,motivation) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,date) DO UPDATE SET energy=$3,focus=$4,motivation=$5,updated_at=now()',
        [user.userId, params.date, input.energy, input.focus, input.motivation],
      );
      return { entry: { date: params.date, ...input } };
    },
  );
  app.get(
    '/api/v1/journal/:month',
    {
      schema: {
        tags: ['Journal'],
        summary: 'Read an owned monthly reflection',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const params = parse(monthParams, request.params, reply, request);
      if (!params) return;
      const row = (
        await pool.query<{
          content: string;
          version: number;
          updated_at: Date;
        }>(
          'SELECT content,version,updated_at FROM monthly_journal WHERE user_id=$1 AND month=$2',
          [user.userId, `${params.month}-01`],
        )
      ).rows[0];
      return {
        month: params.month,
        content: row?.content ?? '',
        version: row?.version ?? null,
        updatedAt: row?.updated_at ?? null,
      };
    },
  );
  app.put(
    '/api/v1/journal/:month',
    {
      schema: {
        tags: ['Journal'],
        summary: 'Save an owned monthly reflection',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const params = parse(monthParams, request.params, reply, request);
      if (!params) return;
      const input = parse(journalInput, request.body, reply, request);
      if (!input) return;
      const result =
        input.version === null
          ? await pool.query<{ version: number }>(
              'INSERT INTO monthly_journal(user_id,month,content) VALUES($1,$2,$3) ON CONFLICT(user_id,month) DO NOTHING RETURNING version',
              [user.userId, `${params.month}-01`, input.content],
            )
          : await pool.query<{ version: number }>(
              'UPDATE monthly_journal SET content=$3,version=version+1,updated_at=now() WHERE user_id=$1 AND month=$2 AND version=$4 RETURNING version',
              [user.userId, `${params.month}-01`, input.content, input.version],
            );
      const saved = result.rows[0];
      if (!saved)
        return reply.code(409).send({
          message:
            'Reflection changed on another device. Reload before saving.',
        });
      return {
        month: params.month,
        content: input.content,
        version: saved.version,
      };
    },
  );
  app.delete(
    '/api/v1/journal/:month',
    {
      schema: {
        tags: ['Journal'],
        summary: 'Delete an owned monthly reflection',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const params = parse(monthParams, request.params, reply, request);
      if (!params) return;
      const input = parse(journalDelete, request.body, reply, request);
      if (!input) return;
      const result = await pool.query(
        'DELETE FROM monthly_journal WHERE user_id=$1 AND month=$2 AND version=$3',
        [user.userId, `${params.month}-01`, input.version],
      );
      if (!result.rowCount)
        return reply.code(409).send({
          message:
            'Reflection changed on another device. Reload before deleting.',
        });
      return reply.code(204).send();
    },
  );
}
