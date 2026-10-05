import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { dateSchema } from '../../../packages/contracts/src/index.ts';
import { dateInTimezone } from '../../../packages/domain/src/index.ts';
import type { Principal } from './auth.ts';
import { transaction } from './database.ts';

const taskInput = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().max(5000).optional(),
    dueDate: dateSchema.optional(),
    priority: z.number().int().min(1).max(5).default(3),
    carryOver: z.boolean().default(false),
  })
  .strict();
const taskEdit = taskInput
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict();
const idSchema = z.object({ id: z.coerce.number().int().positive() });
const rangeSchema = z
  .object({ from: dateSchema, to: dateSchema })
  .refine(
    (v) =>
      v.from <= v.to && Date.parse(v.to) - Date.parse(v.from) <= 31 * 86400000,
  );
interface TaskRow {
  id: number;
  user_id: string;
  title: string;
  description: string | null;
  due_date: string;
  priority: number;
  carry_over: boolean;
  archived_at: Date | null;
  version: number;
  completed_at: Date | null;
  occurrence_id: number;
  original_date: string;
  display_date: string;
  timezone: string;
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
function idOf(request: FastifyRequest, reply: FastifyReply) {
  return parse(idSchema, request.params, reply, request)?.id;
}
function publicTask(row: TaskRow, today: string) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    displayDate:
      row.carry_over && !row.completed_at && row.due_date < today
        ? today
        : row.display_date,
    priority: row.priority,
    carryOver: row.carry_over,
    completed: row.completed_at !== null,
    version: row.version,
  };
}
async function loadTask(
  client: pg.Pool | pg.PoolClient,
  userId: string,
  id: number,
  lock = false,
) {
  const result = await client.query<TaskRow>(
    `SELECT t.*,i.id AS occurrence_id,i.original_date,i.display_date,i.completed_at,u.timezone FROM tasks t JOIN task_instances i ON i.task_id=t.id JOIN users u ON u.id=t.user_id WHERE t.id=$1 AND t.user_id=$2 ${lock ? 'FOR UPDATE OF t,i' : ''}`,
    [id, userId],
  );
  return result.rows[0];
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
    `INSERT INTO audit_logs(user_id,entity,entity_id,action,request_id) VALUES($1,'Task',$2,$3,$4)`,
    [userId, String(id), action, requestId],
  );
  await client.query(
    `INSERT INTO sync_changes(user_id,entity,entity_id,version,deleted) VALUES($1,'Task',$2,$3,$4)`,
    [userId, String(id), version, deleted],
  );
}
export async function registerTasks(
  app: FastifyInstance,
  pool: pg.Pool,
  authenticate: Authenticate,
) {
  app.get(
    '/api/v1/tasks',
    {
      schema: {
        tags: ['Tasks'],
        summary: 'List owned tasks by local date range',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const range = parse(rangeSchema, request.query, reply, request);
      if (!range) return;
      const tz = (
        await pool.query<{ timezone: string }>(
          `SELECT timezone FROM users WHERE id=$1`,
          [user.userId],
        )
      ).rows[0]?.timezone;
      if (!tz) return fail(reply, request, 401, 'Authentication required');
      const today = dateInTimezone(new Date(), tz);
      const rows = await pool.query<TaskRow>(
        `SELECT t.*,i.id AS occurrence_id,i.original_date,i.display_date,i.completed_at,u.timezone FROM tasks t JOIN task_instances i ON i.task_id=t.id JOIN users u ON u.id=t.user_id WHERE t.user_id=$1 AND t.archived_at IS NULL AND ((i.original_date BETWEEN $2 AND $3) OR (t.carry_over=true AND i.completed_at IS NULL AND i.original_date<$2 AND $2<=$4 AND $4<=$3)) ORDER BY i.original_date,t.priority,t.id LIMIT 500`,
        [user.userId, range.from, range.to, today],
      );
      return { tasks: rows.rows.map((r) => publicTask(r, today)) };
    },
  );
  app.post(
    '/api/v1/tasks',
    { schema: { tags: ['Tasks'], summary: 'Create a lightweight task' } },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const input = parse(taskInput, request.body, reply, request);
      if (!input) return;
      const tz = (
        await pool.query<{ timezone: string }>(
          `SELECT timezone FROM users WHERE id=$1`,
          [user.userId],
        )
      ).rows[0]?.timezone;
      if (!tz) return fail(reply, request, 401, 'Authentication required');
      const due = input.dueDate ?? dateInTimezone(new Date(), tz);
      const id = await transaction(pool, async (client) => {
        const result = await client.query<{ id: number }>(
          `INSERT INTO tasks(user_id,title,description,due_date,priority,carry_over) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
          [
            user.userId,
            input.title,
            input.description ?? null,
            due,
            input.priority,
            input.carryOver,
          ],
        );
        const id = result.rows[0]?.id;
        if (!id) throw new Error('Task insert failed');
        await client.query(
          `INSERT INTO task_instances(task_id,user_id,original_date,display_date) VALUES($1,$2,$3,$3)`,
          [id, user.userId, due],
        );
        await audit(client, user.userId, id, 'CREATE', request.id, 1);
        return id;
      });
      const row = await loadTask(pool, user.userId, id);
      if (!row) throw new Error('Task missing after insert');
      return reply.code(201).send({
        task: publicTask(row, dateInTimezone(new Date(), row.timezone)),
      });
    },
  );
  app.put(
    '/api/v1/tasks/:id',
    {
      schema: {
        tags: ['Tasks'],
        summary: 'Edit an owned task with version check',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const id = idOf(request, reply);
      if (!id) return;
      const input = parse(taskEdit, request.body, reply, request);
      if (!input) return;
      const outcome = await transaction(pool, async (client) => {
        const task = await loadTask(client, user.userId, id, true);
        if (!task) return 'missing';
        if (task.archived_at) return 'archived';
        if (task.version !== input.version) return 'stale';
        if (input.dueDate && task.completed_at) return 'historical';
        await client.query(
          `UPDATE tasks SET title=coalesce($1,title),description=coalesce($2,description),due_date=coalesce($3,due_date),priority=coalesce($4,priority),carry_over=coalesce($5,carry_over),version=version+1,updated_at=now() WHERE id=$6 AND user_id=$7`,
          [
            input.title ?? null,
            input.description ?? null,
            input.dueDate ?? null,
            input.priority ?? null,
            input.carryOver ?? null,
            id,
            user.userId,
          ],
        );
        if (input.dueDate)
          await client.query(
            `UPDATE task_instances SET original_date=$1,display_date=$1,version=version+1,updated_at=now() WHERE id=$2`,
            [input.dueDate, task.occurrence_id],
          );
        await audit(
          client,
          user.userId,
          id,
          'UPDATE',
          request.id,
          task.version + 1,
        );
        return 'ok';
      });
      if (outcome === 'missing')
        return fail(reply, request, 404, 'Task not found');
      if (outcome === 'archived')
        return fail(reply, request, 409, 'Task is archived');
      if (outcome === 'stale')
        return fail(reply, request, 409, 'Task changed on another device');
      if (outcome === 'historical')
        return fail(
          reply,
          request,
          409,
          'Completed task date cannot be changed',
        );
      const row = await loadTask(pool, user.userId, id);
      if (!row) throw new Error('Task missing after update');
      return {
        task: publicTask(row, dateInTimezone(new Date(), row.timezone)),
      };
    },
  );
  app.post(
    '/api/v1/tasks/:id/complete',
    {
      schema: {
        tags: ['Tasks'],
        summary: 'Complete task occurrence idempotently',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const id = idOf(request, reply);
      if (!id) return;
      const outcome = await transaction(pool, async (client) => {
        const task = await loadTask(client, user.userId, id, true);
        if (!task) return 'missing';
        if (task.archived_at) return 'archived';
        if (task.completed_at) return 'ok';
        const today = dateInTimezone(new Date(), task.timezone);
        if (task.due_date > today) return 'future';
        await client.query(
          `UPDATE task_instances SET completed_at=now(),version=version+1,updated_at=now() WHERE id=$1`,
          [task.occurrence_id],
        );
        await audit(
          client,
          user.userId,
          id,
          'COMPLETE',
          request.id,
          task.version,
        );
        return 'ok';
      });
      if (outcome === 'missing')
        return fail(reply, request, 404, 'Task not found');
      if (outcome === 'archived')
        return fail(reply, request, 409, 'Task is archived');
      if (outcome === 'future')
        return fail(reply, request, 400, 'Future task cannot be completed');
      const row = await loadTask(pool, user.userId, id);
      if (!row) throw new Error('Task missing after completion');
      return {
        task: publicTask(row, dateInTimezone(new Date(), row.timezone)),
      };
    },
  );
  app.post(
    '/api/v1/tasks/:id/undo',
    { schema: { tags: ['Tasks'], summary: 'Undo task completion' } },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const id = idOf(request, reply);
      if (!id) return;
      const outcome = await transaction(pool, async (client) => {
        const task = await loadTask(client, user.userId, id, true);
        if (!task) return 'missing';
        if (task.archived_at) return 'archived';
        if (!task.completed_at) return 'ok';
        await client.query(
          `UPDATE task_instances SET completed_at=NULL,version=version+1,updated_at=now() WHERE id=$1`,
          [task.occurrence_id],
        );
        await audit(client, user.userId, id, 'UNDO', request.id, task.version);
        return 'ok';
      });
      if (outcome === 'missing')
        return fail(reply, request, 404, 'Task not found');
      if (outcome === 'archived')
        return fail(reply, request, 409, 'Task is archived');
      const row = await loadTask(pool, user.userId, id);
      if (!row) throw new Error('Task missing after undo');
      return {
        task: publicTask(row, dateInTimezone(new Date(), row.timezone)),
      };
    },
  );
  app.delete(
    '/api/v1/tasks/:id',
    { schema: { tags: ['Tasks'], summary: 'Archive task and retain history' } },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const id = idOf(request, reply);
      if (!id) return;
      const outcome = await transaction(pool, async (client) => {
        const task = await loadTask(client, user.userId, id, true);
        if (!task) return 'missing';
        if (task.archived_at) return 'ok';
        await client.query(
          `UPDATE tasks SET archived_at=now(),version=version+1,updated_at=now() WHERE id=$1 AND user_id=$2`,
          [id, user.userId],
        );
        await audit(
          client,
          user.userId,
          id,
          'ARCHIVE',
          request.id,
          task.version + 1,
          true,
        );
        return 'ok';
      });
      if (outcome === 'missing')
        return fail(reply, request, 404, 'Task not found');
      return reply.code(204).send();
    },
  );
}
