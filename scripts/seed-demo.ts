import { addDays, dateInTimezone } from '../packages/domain/src/index.ts';

const email = process.env.DEMO_EMAIL;
const password = process.env.DEMO_PASSWORD;
const origin = process.env.DEMO_ORIGIN;
const baseUrl = process.env.DEMO_API_URL ?? 'http://api:3001';
if (!email || !password || !origin)
  throw new Error('DEMO_EMAIL, DEMO_PASSWORD and DEMO_ORIGIN are required');

type Auth = { token: { accessToken: string } };
type Habit = { id: number; name: string };
type Task = { id: number; title: string; completed: boolean };
type Goal = {
  id: number;
  title: string;
  steps: { id: number; title: string; completed: boolean }[];
  habitIds: number[];
};
let accessToken = '';
async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Origin: origin!,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      `${method} ${path}: HTTP ${response.status} ${data?.error?.message ?? data?.message ?? ''}`,
    );
  return data as T;
}

async function main() {
  let auth: Auth;
  try {
    auth = await request<Auth>('/api/v1/signup', 'POST', {
      email,
      password,
      name: 'Demo Explorer',
      timezone: 'Asia/Kolkata',
    });
  } catch (cause) {
    if (!(cause instanceof Error) || !cause.message.includes('HTTP 409'))
      throw cause;
    auth = await request<Auth>('/api/v1/login', 'POST', { email, password });
  }
  accessToken = auth.token.accessToken;
  const today = dateInTimezone(new Date(), 'Asia/Kolkata');
  const yesterday = addDays(today, -1);
  const startDate = addDays(today, -6);
  const dayOfMonth = Number(today.slice(-2));
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();

  const existingHabits = await request<{ habits: Habit[] }>(
    '/api/v1/habits?limit=100',
  );
  const habits = new Map(
    existingHabits.habits.map((habit) => [habit.name, habit]),
  );
  async function addHabit(
    name: string,
    category: string,
    schedule: object,
    completedOffsets: number[],
  ) {
    if (habits.has(name)) return habits.get(name)!;
    const created = await request<{ habit: Habit }>('/api/v1/habits', 'POST', {
      name,
      category,
      color: category === 'Movement' ? '#668C72' : '#B9674B',
      schedule,
      startDate,
    });
    const habit = created.habit;
    habits.set(name, habit);
    for (const offset of completedOffsets)
      await request(`/api/v1/habits/${habit.id}/complete`, 'POST', {
        date: addDays(today, offset),
      });
    return habit;
  }
  await addHabit(
    'Drink water',
    'Wellbeing',
    { frequency: 'daily' },
    [-5, -4, -3, -2, -1],
  );
  await addHabit(
    'Morning walk',
    'Movement',
    { frequency: 'daily' },
    [-5, -3, -1],
  );
  const reading = await addHabit(
    'Read 20 minutes',
    'Learning',
    { frequency: 'daily' },
    [-4, -3, -2, -1, 0],
  );
  await addHabit(
    'Mindful breathing',
    'Mindfulness',
    { frequency: 'daily' },
    [-2, -1],
  );
  await addHabit('Evening reset', 'Home', { frequency: 'daily' }, [-3, -2, -1]);
  await addHabit(
    'Strength training',
    'Movement',
    { frequency: 'weekly', weekdays: [weekday, (weekday + 2) % 7].sort() },
    [],
  );
  await addHabit(
    'Monthly review',
    'Other',
    { frequency: 'monthly', monthDays: [dayOfMonth] },
    [],
  );

  const taskList = await request<{ tasks: Task[] }>(
    `/api/v1/tasks?from=${yesterday}&to=${today}`,
  );
  const tasks = new Map(taskList.tasks.map((task) => [task.title, task]));
  async function addTask(title: string, dueDate: string, completed: boolean) {
    if (tasks.has(title)) return;
    const created = await request<{ task: Task }>('/api/v1/tasks', 'POST', {
      title,
      dueDate,
      carryOver: false,
    });
    tasks.set(title, created.task);
    if (completed)
      await request(`/api/v1/tasks/${created.task.id}/complete`, 'POST');
  }
  await addTask('Plan meals', yesterday, true);
  await addTask('Review priorities', today, true);
  await addTask('Prepare tomorrow', today, false);
  await addTask('Take a short walk', today, false);

  const goalList = await request<{ goals: Goal[] }>('/api/v1/goals');
  let goal = goalList.goals.find(
    (item) => item.title === 'Build a reading habit',
  );
  if (!goal) {
    goal = (
      await request<{ goal: Goal }>('/api/v1/goals', 'POST', {
        title: 'Build a reading habit',
        description: 'Read consistently and make space for learning.',
        category: 'Learning',
        deadline: addDays(today, 30),
      })
    ).goal;
  }
  if (!goal.steps.some((step) => step.title === 'Choose a book')) {
    const created = await request<{ step: { id: number } }>(
      `/api/v1/goals/${goal.id}/steps`,
      'POST',
      { title: 'Choose a book' },
    );
    await request(`/api/v1/goals/${goal.id}/steps/${created.step.id}`, 'PUT', {
      completed: true,
    });
  }
  if (!goal.steps.some((step) => step.title === 'Finish the first chapter'))
    await request(`/api/v1/goals/${goal.id}/steps`, 'POST', {
      title: 'Finish the first chapter',
    });
  if (!goal.habitIds.includes(reading.id))
    await request(`/api/v1/goals/${goal.id}/habits/${reading.id}`, 'POST');

  const mindset = await request<{ entries: unknown[] }>(
    `/api/v1/mindset?from=${today}&to=${today}`,
  );
  if (mindset.entries.length === 0)
    await request(`/api/v1/mindset/${today}`, 'PUT', {
      energy: 4,
      focus: 3,
      motivation: 4,
    });
  const month = today.slice(0, 7);
  const journal = await request<{ content: string; version: number | null }>(
    `/api/v1/journal/${month}`,
  );
  if (!journal.content)
    await request(`/api/v1/journal/${month}`, 'PUT', {
      content:
        'I am noticing which small routines are easiest to return to. This month I want to make reading feel natural.',
      version: journal.version,
    });

  process.stdout.write(
    `Demo data ready for ${today}: ${habits.size} routines, ${tasks.size} tasks, 1 goal, mindset and journal.\n`,
  );
}

await main();
