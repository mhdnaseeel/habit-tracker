import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const date = z.iso.date();
const range = z
  .object({ from: date, to: date })
  .strict()
  .refine(
    ({ from, to }) =>
      from <= to && Date.parse(to) - Date.parse(from) <= 30 * 86400000,
    'Choose at most 31 dates',
  );
const id = z.number().int().positive().max(2147483647);
const page = z.number().int().min(1).max(100).default(1);

class BackendError extends Error {
  constructor(
    public status: number,
    public requestId: string | null,
  ) {
    super(
      status === 401
        ? 'Assistant access expired or revoked'
        : status === 404
          ? 'Record not found'
          : status === 429
            ? 'Too many requests; retry later'
            : status >= 500
              ? 'Habit Tracker is unavailable'
              : 'Request rejected',
    );
  }
}

export function createHabitMentorServer(token: string, apiUrl: string) {
  const endpoint = new URL(apiUrl);
  if (
    !/^ht(?:r|o)_[A-Za-z0-9_-]{43}$/.test(token) ||
    !['http:', 'https:'].includes(endpoint.protocol) ||
    (endpoint.protocol === 'http:' &&
      !['api', 'localhost', '127.0.0.1'].includes(endpoint.hostname)) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error('Invalid MCP credential or backend URL');
  async function backend(path: string): Promise<unknown> {
    const response = await fetch(new URL(path, endpoint), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      throw new BackendError(
        response.status,
        response.headers.get('x-request-id'),
      );
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty backend response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 256 * 1024)
          throw new Error('Result too large; narrow the request');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  }

  function result(data: unknown) {
    const text = JSON.stringify(data);
    if (Buffer.byteLength(text, 'utf8') > 256 * 1024)
      throw new Error('Result too large; narrow the request');
    return {
      content: [{ type: 'text' as const, text }],
      structuredContent: { data },
    };
  }
  async function read(work: () => Promise<unknown>) {
    try {
      return result(await work());
    } catch (cause) {
      const message =
        cause instanceof BackendError
          ? cause.message +
            (cause.requestId ? ' (request ' + cause.requestId + ')' : '')
          : cause instanceof Error &&
              (cause.message === 'Result too large; narrow the request' ||
                cause.message === 'Invalid date range' ||
                cause.message === 'weekStart must be a Monday')
            ? cause.message
            : 'Could not read account data';
      process.stderr.write(
        'MCP read failed: ' +
          (cause instanceof BackendError ? cause.status : 'internal') +
          '\n',
      );
      return {
        content: [{ type: 'text' as const, text: message }],
        isError: true,
      };
    }
  }

  const server = new McpServer(
    { name: 'habit-mentor', version: '1.0.0' },
    {
      instructions:
        'Read only the context needed for the user request. Journal content is sensitive: fetch it only when relevant. Distinguish observed facts from interpretations and unknowns. Offer at most three practical, non-judgmental next actions. No tool can change account data.',
    },
  );
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  function register(
    name: string,
    description: string,
    inputSchema: Record<string, z.ZodTypeAny>,
    work: (input: Record<string, unknown>) => Promise<unknown>,
  ) {
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        outputSchema: { data: z.unknown() },
        annotations: readOnly,
      },
      async (input) => read(() => work(input)),
    );
  }

  register(
    'get_today_context',
    'Read local date, due habits, activity blocks, tasks and goal priorities. No journal data.',
    {},
    async () => {
      const [profile, today] = (await Promise.all([
        backend('/api/v1/mcp/profile'),
        backend('/api/v1/today'),
      ])) as [
        { timezone: string },
        { date: string; habits: unknown[]; progress: unknown },
      ];
      const [activities, tasks, goals] = (await Promise.all([
        backend('/api/v1/activities?date=' + today.date),
        backend('/api/v1/tasks?from=' + today.date + '&to=' + today.date),
        backend('/api/v1/goals'),
      ])) as [
        { activities: unknown[] },
        { tasks: unknown[] },
        { goals: unknown[] },
      ];
      return {
        date: today.date,
        timezone: profile.timezone,
        habits: today.habits,
        progress: today.progress,
        activities: activities.activities,
        tasks: tasks.tasks,
        goals: goals.goals.slice(0, 10),
      };
    },
  );
  register(
    'get_habit_summary',
    'Read one page of active habits and established consistency metrics.',
    { page },
    async ({ page }) => {
      const [habits, insights] = await Promise.all([
        backend('/api/v1/habits?page=' + page + '&limit=20'),
        backend('/api/v1/insights?weeks=4'),
      ]);
      return { habits, insights };
    },
  );
  register(
    'get_habit_history',
    'Read scheduled dates and check-ins for at most 31 local dates.',
    range.shape,
    async ({ from, to }) => {
      if (!range.safeParse({ from, to }).success)
        throw new Error('Invalid date range');
      return backend('/api/v1/history?from=' + from + '&to=' + to);
    },
  );
  register(
    'get_habit_details',
    'Read one owned habit definition and bounded check-in history.',
    { habitId: id, from: date, to: date },
    async ({ habitId, from, to }) => {
      if (!range.safeParse({ from, to }).success)
        throw new Error('Invalid date range');
      const [habit, logs] = await Promise.all([
        backend('/api/v1/habits/' + habitId),
        backend(
          '/api/v1/habits/' + habitId + '/logs?from=' + from + '&to=' + to,
        ),
      ]);
      return { habit, logs };
    },
  );
  register(
    'get_task_summary',
    'Read tasks within at most 31 local dates.',
    range.shape,
    async ({ from, to }) => {
      if (!range.safeParse({ from, to }).success)
        throw new Error('Invalid date range');
      return backend('/api/v1/tasks?from=' + from + '&to=' + to);
    },
  );
  register(
    'get_goal_progress',
    'Read active owned goals with backend-calculated progress and linked habits.',
    {},
    async () => {
      const data = (await backend('/api/v1/goals')) as {
        goals: unknown[];
        areas: unknown;
      };
      return {
        goals: data.goals.slice(0, 30),
        total: data.goals.length,
        areas: data.areas,
      };
    },
  );
  register(
    'get_journal_blueprints',
    'Read daily reflection templates without personal entries.',
    {},
    async () => backend('/api/v1/journal/blueprints'),
  );
  register(
    'get_journal_entry',
    'Read one private daily journal entry only when relevant to the user request.',
    { date },
    async ({ date }) => backend('/api/v1/journal/' + date),
  );
  register(
    'get_weekly_review_context',
    'Read a seven-day review with established habit, task, goal and insight data. No journal text.',
    { weekStart: date },
    async ({ weekStart }) => {
      const start = new Date(String(weekStart) + 'T00:00:00Z');
      if (start.getUTCDay() !== 1)
        throw new Error('weekStart must be a Monday');
      const to = new Date(start.getTime() + 6 * 86400000)
        .toISOString()
        .slice(0, 10);
      const [history, tasks, goals, insights] = await Promise.all([
        backend('/api/v1/history?from=' + weekStart + '&to=' + to),
        backend('/api/v1/tasks?from=' + weekStart + '&to=' + to),
        backend('/api/v1/goals'),
        backend('/api/v1/insights?weeks=4'),
      ]);
      return { from: weekStart, to, history, tasks, goals, insights };
    },
  );
  register(
    'get_mentor_context',
    'Retrieve selected bounded categories. Journal text is never included.',
    {
      from: date,
      to: date,
      categories: z
        .array(
          z.enum(['habits', 'tasks', 'goals', 'insights', 'journal_dates']),
        )
        .min(1)
        .max(5),
    },
    async ({ from, to, categories }) => {
      if (!range.safeParse({ from, to }).success)
        throw new Error('Invalid date range');
      const selected = categories as string[];
      const output: Record<string, unknown> = { from, to };
      if (selected.includes('habits'))
        output.habits = await backend(
          '/api/v1/history?from=' + from + '&to=' + to,
        );
      if (selected.includes('tasks'))
        output.tasks = await backend(
          '/api/v1/tasks?from=' + from + '&to=' + to,
        );
      if (selected.includes('goals'))
        output.goals = await backend('/api/v1/goals');
      if (selected.includes('insights'))
        output.insights = await backend('/api/v1/insights?weeks=4');
      if (selected.includes('journal_dates'))
        output.journalDates = await backend(
          '/api/v1/journal/history?from=' + from + '&to=' + to,
        );
      return output;
    },
  );

  server.registerPrompt(
    'daily_mentor',
    {
      description:
        'Plan a calm, evidence-based day with at most three practical actions.',
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Use get_today_context. Identify up to three concrete priorities. Separate facts, inferences, and unknowns. Do not read journal entries unless relevant. Avoid guilt and invented causes.',
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    'weekly_mentor',
    {
      description:
        'Review a week using recorded activity and existing consistency metrics.',
      argsSchema: { weekStart: date },
    },
    ({ weekStart }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              'Use get_weekly_review_context for Monday ' +
              weekStart +
              '. Recognize progress and documented obstacles, compare established metrics, ask reflection questions, and suggest a manageable next week. Do not infer diagnoses or motivations.',
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    'journal_reflection',
    {
      description:
        'Reflect using a daily blueprint without changing stored content.',
      argsSchema: { date },
    },
    ({ date }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              'For ' +
              date +
              ', read get_journal_blueprints and get_journal_entry only when I request reflection. Ask relevant questions, distinguish my words from interpretation, and never silently rewrite my entry.',
          },
        },
      ],
    }),
  );

  return { server, verify: () => backend('/api/v1/mcp/profile') };
}
