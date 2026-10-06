import { createHash } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  calculateStreak,
  dateInTimezone,
  datesBetween,
  isScheduled,
  localDate,
  type HabitTimeline,
} from '../../../packages/domain/src/index.ts';

pg.types.setTypeParser(1082, (value) => value);
const databaseUrl = process.env.DATABASE_URL;
const token = process.env.MCP_READ_TOKEN;
if (!databaseUrl || !token || !/^htr_[A-Za-z0-9_-]{43}$/.test(token)) {
  process.stderr.write(
    'DATABASE_URL and a valid MCP_READ_TOKEN are required.\n',
  );
  process.exit(1);
}
const pool = new pg.Pool({
  connectionString: databaseUrl,
  options: '-c default_transaction_read_only=on',
  max: 3,
});
const tokenHash = createHash('sha256').update(token).digest('hex');
async function owner() {
  const row = (
    await pool.query<{ user_id: string }>(
      'SELECT user_id FROM mcp_read_tokens WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()',
      [tokenHash],
    )
  ).rows[0];
  return row?.user_id ?? null;
}
async function currentDate(userId: string) {
  const timezone = (
    await pool.query<{ timezone: string }>(
      'SELECT timezone FROM users WHERE id=$1',
      [userId],
    )
  ).rows[0]?.timezone;
  if (!timezone) throw new Error('Account is unavailable');
  return dateInTimezone(new Date(), timezone);
}
function result(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    structuredContent: { data },
  };
}
async function read(work: (userId: string) => Promise<unknown>) {
  try {
    const userId = await owner();
    if (!userId)
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Read-only access token expired or revoked',
          },
        ],
        isError: true,
      };
    return result(await work(userId));
  } catch {
    return {
      content: [{ type: 'text' as const, text: 'Could not read account data' }],
      isError: true,
    };
  }
}
const server = new McpServer({
  name: 'habit-tracker-readonly',
  version: '0.1.0',
});
const dateRange = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine(
    ({ from, to }) =>
      from <= to && Date.parse(to) - Date.parse(from) <= 30 * 86400000,
    'Choose at most 31 dates',
  );

server.registerTool(
  'get_today',
  {
    title: 'Read today dashboard',
    description:
      'Read due routines, check-in status, streaks and tasks for the account today. No changes are made.',
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async () =>
    read(async (userId) => {
      const today = await currentDate(userId);
      const [habits, rules, logs, tasks, streaks] = await Promise.all([
        pool.query<{
          id: number;
          name: string;
          category: string | null;
          start_date: string;
          end_date: string | null;
          archived_on: string | null;
        }>(
          'SELECT id,name,category,start_date,end_date,archived_on FROM habits WHERE user_id=$1 AND active=true AND start_date<=$2 ORDER BY sort_order,id',
          [userId, today],
        ),
        pool.query<{
          habit_id: number;
          effective_from: string;
          frequency: 'daily' | 'weekly' | 'monthly';
          weekdays: number[];
          month_days: number[];
          target: number;
        }>(
          'SELECT habit_id,effective_from,frequency,weekdays,month_days,target FROM habit_schedules WHERE user_id=$1 AND effective_from<=$2 ORDER BY effective_from',
          [userId, today],
        ),
        pool.query<{
          habit_id: number;
          date: string;
          status: 'pending' | 'partial' | 'completed' | 'frozen' | 'missed';
          value: number;
        }>(
          'SELECT habit_id,date,status,value FROM habit_instances WHERE user_id=$1 AND date<=$2',
          [userId, today],
        ),
        pool.query<{
          id: number;
          title: string;
          due_date: string;
          completed_at: Date | null;
        }>(
          'SELECT t.id,t.title,t.due_date,i.completed_at FROM tasks t JOIN task_instances i ON i.task_id=t.id AND i.user_id=t.user_id WHERE t.user_id=$1 AND t.archived_at IS NULL AND (t.due_date=$2 OR (t.carry_over=true AND t.due_date<$2 AND i.completed_at IS NULL)) ORDER BY t.priority,t.id LIMIT 500',
          [userId, today],
        ),
        pool.query<{
          habit_id: number;
          current_streak: number;
          best_streak: number;
        }>(
          'SELECT s.habit_id,s.current_streak,s.best_streak FROM streaks s JOIN habits h ON h.id=s.habit_id WHERE h.user_id=$1',
          [userId],
        ),
      ]);
      const logIndex = new Map(
        logs.rows
          .filter((row) => row.date === today)
          .map((row) => [row.habit_id, row]),
      );
      const streakIndex = new Map(
        streaks.rows.map((row) => [row.habit_id, row]),
      );
      const due = habits.rows.flatMap((habit) => {
        const revisions = rules.rows
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
          }));
        const timeline: HabitTimeline = {
          startDate: localDate(habit.start_date),
          ...(habit.end_date ? { endDate: localDate(habit.end_date) } : {}),
          ...(habit.archived_on
            ? { archivedOn: localDate(habit.archived_on) }
            : {}),
          revisions,
        };
        if (!isScheduled(timeline, today)) return [];
        const cached = streakIndex.get(habit.id);
        const streak = calculateStreak(
          timeline,
          logs.rows
            .filter((row) => row.habit_id === habit.id)
            .map((row) => ({
              date: localDate(row.date),
              status: row.status,
              value: row.value,
            })),
          today,
          cached?.best_streak ?? 0,
        );
        return [
          {
            id: habit.id,
            name: habit.name,
            category: habit.category,
            target: revisions.at(-1)?.target ?? 1,
            status: logIndex.get(habit.id)?.status ?? 'pending',
            value: logIndex.get(habit.id)?.value ?? 0,
            streak: { current: streak.current, best: streak.bestEver },
          },
        ];
      });
      const completed = due.filter(
        (habit) => habit.status === 'completed',
      ).length;
      return {
        date: today,
        habits: due,
        progress: {
          completed,
          due: due.length,
          percentage: due.length
            ? Math.round((completed / due.length) * 100)
            : null,
        },
        tasks: tasks.rows.map((task) => ({
          id: task.id,
          title: task.title,
          dueDate: task.due_date,
          completed: task.completed_at !== null,
        })),
      };
    }),
);

server.registerTool(
  'list_routines',
  {
    title: 'List routines',
    description:
      'Read active routines and their daily, weekly or monthly schedules. No changes are made.',
    inputSchema: { page: z.number().int().positive().default(1) },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ page }) =>
    read(async (userId) => {
      const rows = (
        await pool.query(
          'SELECT h.id,h.name,h.description,h.category,s.effective_from,s.frequency,s.weekdays,s.month_days,s.target FROM habits h JOIN habit_schedules s ON s.habit_id=h.id AND s.user_id=h.user_id WHERE h.user_id=$1 AND h.active=true AND s.id=(SELECT s2.id FROM habit_schedules s2 WHERE s2.habit_id=h.id ORDER BY effective_from DESC LIMIT 1) ORDER BY h.sort_order,h.id LIMIT 100 OFFSET $2',
          [userId, (page - 1) * 100],
        )
      ).rows;
      return { page, routines: rows };
    }),
);

server.registerTool(
  'get_habit_grid',
  {
    title: 'Read habit grid',
    description:
      'Read scheduled dates and recorded check-ins over at most 31 local dates. Includes archived history. No changes are made.',
    inputSchema: dateRange.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ from, to }) =>
    read(async (userId) => {
      if (!dateRange.safeParse({ from, to }).success)
        throw new Error('Invalid date range');
      const today = await currentDate(userId);
      const [habits, rules, logs] = await Promise.all([
        pool.query<{
          id: number;
          name: string;
          category: string | null;
          start_date: string;
          end_date: string | null;
          archived_on: string | null;
        }>(
          'SELECT id,name,category,start_date,end_date,archived_on FROM habits WHERE user_id=$1 AND start_date<=$3 AND (end_date IS NULL OR end_date>=$2) AND (archived_on IS NULL OR archived_on>$2) ORDER BY sort_order,id',
          [userId, from, to],
        ),
        pool.query<{
          habit_id: number;
          effective_from: string;
          frequency: 'daily' | 'weekly' | 'monthly';
          weekdays: number[];
          month_days: number[];
          target: number;
        }>(
          'SELECT habit_id,effective_from,frequency,weekdays,month_days,target FROM habit_schedules WHERE user_id=$1 AND effective_from<=$2 ORDER BY effective_from',
          [userId, to],
        ),
        pool.query<{
          habit_id: number;
          date: string;
          status: string;
          value: number;
        }>(
          'SELECT habit_id,date,status,value FROM habit_instances WHERE user_id=$1 AND date BETWEEN $2 AND $3',
          [userId, from, to],
        ),
      ]);
      return {
        from,
        to,
        habits: habits.rows.map((habit) => {
          const revisions = rules.rows
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
            }));
          const timeline: HabitTimeline = {
            startDate: localDate(habit.start_date),
            ...(habit.end_date ? { endDate: localDate(habit.end_date) } : {}),
            ...(habit.archived_on
              ? { archivedOn: localDate(habit.archived_on) }
              : {}),
            revisions,
          };
          const ownLogs = new Map(
            logs.rows
              .filter((log) => log.habit_id === habit.id)
              .map((log) => [log.date, log]),
          );
          return {
            id: habit.id,
            name: habit.name,
            category: habit.category,
            days: datesBetween(localDate(from), localDate(to)).map((date) => ({
              date,
              scheduled: isScheduled(timeline, date),
              status:
                ownLogs.get(date)?.status ??
                (isScheduled(timeline, date)
                  ? date > today
                    ? 'upcoming'
                    : date < today
                      ? 'missed'
                      : 'pending'
                  : null),
              value: ownLogs.get(date)?.value ?? 0,
            })),
          };
        }),
      };
    }),
);

server.registerTool(
  'list_tasks',
  {
    title: 'Read tasks',
    description:
      'Read owned tasks due in a date range of at most 31 days. No changes are made.',
    inputSchema: dateRange.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ from, to }) =>
    read(async (userId) => {
      if (!dateRange.safeParse({ from, to }).success)
        throw new Error('Invalid date range');
      return {
        tasks: (
          await pool.query(
            'SELECT t.id,t.title,t.description,t.due_date,t.priority,t.carry_over,i.completed_at FROM tasks t JOIN task_instances i ON i.task_id=t.id AND i.user_id=t.user_id WHERE t.user_id=$1 AND t.archived_at IS NULL AND t.due_date BETWEEN $2 AND $3 ORDER BY t.due_date,t.priority,t.id LIMIT 500',
            [userId, from, to],
          )
        ).rows,
      };
    }),
);

server.registerTool(
  'list_goals',
  {
    title: 'Read goals',
    description:
      'Read goal titles, life areas, deadlines, steps and linked routine IDs. No changes are made.',
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async () =>
    read(async (userId) => {
      const [goals, steps, links] = await Promise.all([
        pool.query<{
          id: number;
          title: string;
          category: string | null;
          deadline: string | null;
        }>(
          'SELECT id,title,category,deadline FROM goals WHERE user_id=$1 AND archived_at IS NULL ORDER BY id LIMIT 500',
          [userId],
        ),
        pool.query<{
          goal_id: number;
          title: string;
          completed_at: Date | null;
        }>(
          'SELECT goal_id,title,completed_at FROM goal_steps WHERE user_id=$1 ORDER BY goal_id,id',
          [userId],
        ),
        pool.query<{ goal_id: number; habit_id: number }>(
          'SELECT goal_id,habit_id FROM goal_habits WHERE user_id=$1 AND unlinked_on IS NULL',
          [userId],
        ),
      ]);
      return {
        goals: goals.rows.map((goal) => ({
          ...goal,
          steps: steps.rows
            .filter((step) => step.goal_id === goal.id)
            .map((step) => ({
              title: step.title,
              completed: step.completed_at !== null,
            })),
          habitIds: links.rows
            .filter((link) => link.goal_id === goal.id)
            .map((link) => link.habit_id),
        })),
      };
    }),
);

server.registerTool(
  'get_monthly_reflection',
  {
    title: 'Read monthly reflection',
    description: 'Read one monthly journal entry. No changes are made.',
    inputSchema: { month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ month }) =>
    read(async (userId) => ({
      month,
      content:
        (
          await pool.query<{ content: string }>(
            'SELECT content FROM monthly_journal WHERE user_id=$1 AND month=$2',
            [userId, `${month}-01`],
          )
        ).rows[0]?.content ?? null,
    })),
);

server.registerTool(
  'get_mindset',
  {
    title: 'Read mindset entries',
    description:
      'Read daily energy, focus and motivation over at most 31 dates. No changes are made.',
    inputSchema: dateRange.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ from, to }) =>
    read(async (userId) => {
      if (!dateRange.safeParse({ from, to }).success)
        throw new Error('Invalid date range');
      return {
        entries: (
          await pool.query(
            'SELECT date,energy,focus,motivation FROM daily_mindset WHERE user_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date',
            [userId, from, to],
          )
        ).rows,
      };
    }),
);

if (!(await owner())) {
  process.stderr.write('Read-only assistant token is expired or revoked.\n');
  await pool.end();
  process.exit(1);
}
process.on('SIGINT', () => {
  void pool.end();
});
process.on('SIGTERM', () => {
  void pool.end();
});
await server.connect(new StdioServerTransport());
