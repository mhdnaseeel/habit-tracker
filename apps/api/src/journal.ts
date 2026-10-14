import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { dateSchema } from '../../../packages/contracts/src/index.ts';
import { dateInTimezone } from '../../../packages/domain/src/index.ts';
import type { Principal } from './auth.ts';

type Authenticate = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<Principal | undefined>;
type Prompt = { id: string; text: string };
const dateParams = z.object({ date: dateSchema });
const historyQuery = z
  .object({ from: dateSchema, to: dateSchema })
  .strict()
  .refine(
    ({ from, to }) =>
      from <= to && Date.parse(to) - Date.parse(from) <= 92 * 86400000,
  );
const entryInput = z
  .object({
    content: z.string().max(20000),
    blueprintId: z.string().max(60).nullable().default(null),
    responses: z
      .record(
        z.string().regex(/^[a-z0-9-]{1,60}:[a-z0-9-]{1,40}$/),
        z.string().max(2000),
      )
      .refine((value) => Object.keys(value).length <= 50)
      .default({}),
    status: z.enum(['draft', 'saved']).default('saved'),
    version: z.number().int().positive().nullable(),
  })
  .strict();
const deleteInput = z.object({ version: z.number().int().positive() }).strict();

function invalid(reply: FastifyReply, request: FastifyRequest) {
  return reply.code(400).send({
    success: false,
    error: { code: 400, message: 'Validation failed', requestId: request.id },
  });
}
function conflict(reply: FastifyReply, request: FastifyRequest) {
  return reply.code(409).send({
    success: false,
    error: {
      code: 409,
      message: 'Journal changed on another device. Reload before saving.',
      requestId: request.id,
    },
  });
}
function entry(row: {
  entry_date: string;
  content: string;
  blueprint_id: string | null;
  blueprint_snapshot: Prompt[] | null;
  responses: Record<string, string>;
  status: 'draft' | 'saved';
  version: number;
  updated_at: Date;
}) {
  return {
    date: row.entry_date,
    content: row.content,
    blueprintId: row.blueprint_id,
    blueprintSnapshot: row.blueprint_snapshot,
    responses: row.responses,
    status: row.status,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export async function registerJournal(
  app: FastifyInstance,
  pool: pg.Pool,
  authenticate: Authenticate,
) {
  app.get(
    '/api/v1/journal/blueprints',
    {
      schema: { tags: ['Journal'], summary: 'List active journal blueprints' },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const rows = (
        await pool.query<{
          id: string;
          name: string;
          description: string;
          prompts: Prompt[];
          version: number;
        }>(
          'SELECT id,name,description,prompts,version FROM journal_blueprints WHERE active=true ORDER BY name',
        )
      ).rows;
      return { blueprints: rows };
    },
  );

  app.get(
    '/api/v1/journal/history',
    {
      schema: {
        tags: ['Journal'],
        summary: 'List owned journal entries within 93 days',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const parsed = historyQuery.safeParse(request.query);
      if (!parsed.success) return invalid(reply, request);
      const rows = (
        await pool.query<{
          date: string;
          status: string;
          blueprint_name: string | null;
          updated_at: Date;
        }>(
          `SELECT j.entry_date::text AS date,j.status,b.name AS blueprint_name,j.updated_at
       FROM daily_journal j LEFT JOIN journal_blueprints b ON b.id=j.blueprint_id
       WHERE j.user_id=$1 AND j.entry_date BETWEEN $2 AND $3
       ORDER BY j.entry_date DESC`,
          [user.userId, parsed.data.from, parsed.data.to],
        )
      ).rows;
      return {
        entries: rows.map((row) => ({
          date: row.date,
          status: row.status,
          blueprintName: row.blueprint_name,
          updatedAt: row.updated_at,
        })),
      };
    },
  );

  app.get(
    '/api/v1/journal/:date/context',
    {
      schema: {
        tags: ['Journal'],
        summary: 'Read owned habit and goal context for a journal date',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const parsed = dateParams.safeParse(request.params);
      if (!parsed.success) return invalid(reply, request);
      const [habits, goals] = await Promise.all([
        pool.query<{ id: number; name: string; status: string }>(
          `SELECT h.id,h.name,i.status FROM habit_instances i JOIN habits h ON h.id=i.habit_id AND h.user_id=i.user_id
         WHERE i.user_id=$1 AND i.date=$2 ORDER BY h.name`,
          [user.userId, parsed.data.date],
        ),
        pool.query<{
          id: number;
          title: string;
          completed: number;
          total: number;
        }>(
          `SELECT g.id,g.title,count(s.id) FILTER (WHERE s.completed_at IS NOT NULL)::int AS completed,count(s.id)::int AS total
         FROM goals g LEFT JOIN goal_steps s ON s.goal_id=g.id AND s.user_id=g.user_id
         WHERE g.user_id=$1 AND g.archived_at IS NULL AND g.start_date<=$2
         GROUP BY g.id,g.title ORDER BY g.id LIMIT 10`,
          [user.userId, parsed.data.date],
        ),
      ]);
      return { habits: habits.rows, goals: goals.rows };
    },
  );

  app.get(
    '/api/v1/journal/:date',
    {
      schema: {
        tags: ['Journal'],
        summary: 'Read an owned daily journal entry',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const parsed = dateParams.safeParse(request.params);
      if (!parsed.success) return invalid(reply, request);
      const row = (
        await pool.query<{
          entry_date: string;
          content: string;
          blueprint_id: string | null;
          blueprint_snapshot: Prompt[] | null;
          responses: Record<string, string>;
          status: 'draft' | 'saved';
          version: number;
          updated_at: Date;
        }>(
          `SELECT entry_date::text AS entry_date,content,blueprint_id,blueprint_snapshot,responses,status,version,updated_at
        FROM daily_journal WHERE user_id=$1 AND entry_date=$2`,
          [user.userId, parsed.data.date],
        )
      ).rows[0];
      return row
        ? entry(row)
        : {
            date: parsed.data.date,
            content: '',
            blueprintId: null,
            blueprintSnapshot: null,
            responses: {},
            status: 'empty',
            version: null,
            updatedAt: null,
          };
    },
  );

  app.put(
    '/api/v1/journal/:date',
    {
      schema: {
        tags: ['Journal'],
        summary: 'Save an owned journal draft or finished entry',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const params = dateParams.safeParse(request.params);
      const parsed = entryInput.safeParse(request.body);
      if (!params.success || !parsed.success) return invalid(reply, request);
      const input = parsed.data;
      const timezone = (
        await pool.query<{ timezone: string }>(
          'SELECT timezone FROM users WHERE id=$1',
          [user.userId],
        )
      ).rows[0]?.timezone;
      if (!timezone || params.data.date > dateInTimezone(new Date(), timezone))
        return invalid(reply, request);
      if (
        input.status === 'saved' &&
        !input.content.trim() &&
        !Object.values(input.responses).some((value) => value.trim())
      )
        return invalid(reply, request);
      let snapshot: Prompt[] | null = null;
      if (input.blueprintId) {
        const blueprint = (
          await pool.query<{ prompts: Prompt[] }>(
            'SELECT prompts FROM journal_blueprints WHERE id=$1 AND active=true',
            [input.blueprintId],
          )
        ).rows[0];
        if (!blueprint) return invalid(reply, request);
        snapshot = blueprint.prompts;
      }
      const sql =
        input.version === null
          ? `INSERT INTO daily_journal(user_id,entry_date,content,blueprint_id,blueprint_snapshot,responses,status)
         VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
         ON CONFLICT(user_id,entry_date) DO NOTHING RETURNING entry_date::text AS entry_date,content,blueprint_id,blueprint_snapshot,responses,status,version,updated_at`
          : `UPDATE daily_journal SET content=$3,blueprint_id=$4,
         blueprint_snapshot=CASE WHEN blueprint_id IS NOT DISTINCT FROM $4::text THEN blueprint_snapshot ELSE $5::jsonb END,
         responses=$6::jsonb,status=$7,version=version+1,updated_at=now()
         WHERE user_id=$1 AND entry_date=$2 AND version=$8
         RETURNING entry_date::text AS entry_date,content,blueprint_id,blueprint_snapshot,responses,status,version,updated_at`;
      const values: unknown[] = [
        user.userId,
        params.data.date,
        input.content,
        input.blueprintId,
        JSON.stringify(snapshot),
        JSON.stringify(input.responses),
        input.status,
      ];
      if (input.version !== null) values.push(input.version);
      const row = (
        await pool.query<{
          entry_date: string;
          content: string;
          blueprint_id: string | null;
          blueprint_snapshot: Prompt[] | null;
          responses: Record<string, string>;
          status: 'draft' | 'saved';
          version: number;
          updated_at: Date;
        }>(sql, values)
      ).rows[0];
      if (!row) return conflict(reply, request);
      return entry(row);
    },
  );

  app.delete(
    '/api/v1/journal/:date',
    {
      schema: {
        tags: ['Journal'],
        summary: 'Delete an owned daily journal entry',
      },
    },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const params = dateParams.safeParse(request.params);
      const parsed = deleteInput.safeParse(request.body);
      if (!params.success || !parsed.success) return invalid(reply, request);
      const result = await pool.query(
        'DELETE FROM daily_journal WHERE user_id=$1 AND entry_date=$2 AND version=$3',
        [user.userId, params.data.date, parsed.data.version],
      );
      if (!result.rowCount) return conflict(reply, request);
      return reply.code(204).send();
    },
  );
}
