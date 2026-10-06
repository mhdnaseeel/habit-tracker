import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createApp } from '../apps/api/src/app.ts';
import { loadConfig } from '../apps/api/src/config.ts';
import { addDays, dateInTimezone } from '../packages/domain/src/index.ts';
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL required');
const pool = new pg.Pool({ connectionString });
const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: connectionString,
  ACCESS_TOKEN_SECRET:
    'test-only-secret-with-32-plus-characters-unguessable-in-tests',
});
const app = await createApp(
  config,
  async () => {
    await pool.query('SELECT 1');
  },
  pool,
);
const today = dateInTimezone(new Date(), 'Asia/Kolkata');
const yesterday = addDays(today, -1);
const origin = config.WEB_ORIGIN;
const email = `habits-${crypto.randomUUID()}@example.test`;
const email2 = `habits-${crypto.randomUUID()}@example.test`;
let userId = '';
let secondId = '';
let token = '';
let otherToken = '';
let habitId = 0;
let freezeId = 0;
const headers = (access = token) => ({
  origin,
  authorization: `Bearer ${access}`,
});
async function call(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
  access = token,
) {
  return await app.inject({
    method,
    url,
    headers: {
      ...headers(access),
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
}
async function create(name: string, target = 1) {
  return call('POST', '/api/v1/habits', {
    name,
    schedule: { frequency: 'daily' },
    target,
    startDate: yesterday,
  });
}
test('habits require auth and owner scoped creation/list/detail', async () => {
  const signup = await app.inject({
    method: 'POST',
    url: '/api/v1/signup',
    headers: { origin },
    payload: {
      email,
      password: 'correct horse battery staple 2026',
      name: 'One',
      timezone: 'Asia/Kolkata',
    },
  });
  assert.equal(signup.statusCode, 201, signup.body);
  userId = signup.json().user.id;
  token = signup.json().token.accessToken;
  const second = await app.inject({
    method: 'POST',
    url: '/api/v1/signup',
    headers: { origin },
    payload: {
      email: email2,
      password: 'correct horse battery staple 2026',
      name: 'Two',
      timezone: 'Asia/Kolkata',
    },
  });
  secondId = second.json().user.id;
  otherToken = second.json().token.accessToken;
  assert.equal((await app.inject('/api/v1/habits')).statusCode, 401);
  const result = await create('Read', 8);
  assert.equal(result.statusCode, 201, result.body);
  habitId = result.json().habit.id;
  assert.equal((await create('read')).statusCode, 409);
  const own = await call('GET', `/api/v1/habits/${habitId}`);
  assert.equal(own.statusCode, 200);
  assert.equal(own.json().habit.name, 'Read');
  const forbidden = await call(
    'GET',
    `/api/v1/habits/${habitId}`,
    undefined,
    otherToken,
  );
  assert.equal(forbidden.statusCode, 404);
  const dashboard = await call('GET', '/api/v1/today');
  assert.equal(dashboard.statusCode, 200);
  assert.equal(dashboard.json().date, today);
  assert.equal(dashboard.json().progress.due, 1);
  assert.equal(dashboard.json().habits[0].name, 'Read');
  const list = await call('GET', '/api/v1/habits?page=1&limit=10');
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().total, 1);
  const otherList = await call('GET', '/api/v1/habits', undefined, otherToken);
  assert.equal(otherList.json().total, 0);
});
test('partial value, idempotency receipts, full completion and undo recalculate streak', async () => {
  const mutationId = crypto.randomUUID();
  const partial = await call('POST', `/api/v1/habits/${habitId}/complete`, {
    date: today,
    value: 3,
    mutationId,
  });
  assert.equal(partial.statusCode, 200, partial.body);
  assert.equal(partial.json().instance.status, 'partial');
  assert.equal(partial.json().instance.value, 3);
  const retry = await call('POST', `/api/v1/habits/${habitId}/complete`, {
    date: today,
    value: 3,
    mutationId,
  });
  assert.equal(retry.statusCode, 200);
  assert.deepEqual(retry.json(), partial.json());
  const reuse = await call('POST', `/api/v1/habits/${habitId}/complete`, {
    date: today,
    value: 2,
    mutationId,
  });
  assert.equal(reuse.statusCode, 409);
  const complete = await call('POST', `/api/v1/habits/${habitId}/complete`, {
    date: today,
    value: 5,
    mutationId: crypto.randomUUID(),
  });
  assert.equal(complete.statusCode, 200, complete.body);
  assert.equal(complete.json().instance.status, 'completed');
  assert.equal(complete.json().streak.current, 1);
  const dashboard = await call('GET', '/api/v1/today');
  assert.equal(dashboard.json().progress.completed, 1);
  assert.equal(dashboard.json().progress.percentage, 100);
  const again = await call('POST', `/api/v1/habits/${habitId}/complete`, {
    date: today,
  });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().instance.version, complete.json().instance.version);
  const history = await call(
    'GET',
    `/api/v1/habits/${habitId}/logs?from=${yesterday}&to=${today}`,
  );
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().logs.length, 1);
  const ownUndo = await call('POST', `/api/v1/habits/${habitId}/undo`, {
    date: today,
  });
  assert.equal(ownUndo.statusCode, 200);
  assert.equal(ownUndo.json().streak.current, 0);
  const otherUndo = await call(
    'POST',
    `/api/v1/habits/${habitId}/undo`,
    { date: today },
    otherToken,
  );
  assert.equal(otherUndo.statusCode, 404);
});
test('one freeze per month, frozen day cannot complete, schedule editing is version checked', async () => {
  const result = await create('Stretch');
  assert.equal(result.statusCode, 201);
  freezeId = result.json().habit.id;
  const skip = await call('POST', `/api/v1/habits/${freezeId}/skip`, {
    date: yesterday,
  });
  assert.equal(skip.statusCode, 200, skip.body);
  const retry = await call('POST', `/api/v1/habits/${freezeId}/skip`, {
    date: yesterday,
  });
  assert.equal(retry.statusCode, 200);
  const second = await call('POST', `/api/v1/habits/${freezeId}/skip`, {
    date: today,
  });
  assert.equal(second.statusCode, 409);
  const frozen = await call('POST', `/api/v1/habits/${freezeId}/complete`, {
    date: yesterday,
  });
  assert.equal(frozen.statusCode, 409);
  const edit = await call('PUT', `/api/v1/habits/${habitId}`, {
    version: 1,
    name: 'Read daily',
    schedule: {
      frequency: 'weekly',
      weekdays: [new Date(`${today}T12:00:00Z`).getUTCDay()],
    },
  });
  assert.equal(edit.statusCode, 200, edit.body);
  assert.equal(edit.json().habit.version, 2);
  const stale = await call('PUT', `/api/v1/habits/${habitId}`, {
    version: 1,
    name: 'Stale',
  });
  assert.equal(stale.statusCode, 409);
  const other = await call(
    'PUT',
    `/api/v1/habits/${habitId}`,
    { version: 2, name: 'Stolen' },
    otherToken,
  );
  assert.equal(other.statusCode, 404);
});
test('archive hides habit but retains history and permits reuse of active name', async () => {
  const archived = await call('DELETE', `/api/v1/habits/${habitId}`);
  assert.equal(archived.statusCode, 204, archived.body);
  const list = await call('GET', '/api/v1/habits');
  assert.equal(
    list.json().habits.some((h: { id: number }) => h.id === habitId),
    false,
  );
  const history = await call(
    'GET',
    `/api/v1/habits/${habitId}/logs?from=${yesterday}&to=${today}`,
  );
  assert.equal(history.statusCode, 200);
  const newHabit = await create('Read daily');
  assert.equal(newHabit.statusCode, 201, newHabit.body);
  assert.equal(
    (await call('POST', `/api/v1/habits/${habitId}/complete`, { date: today }))
      .statusCode,
    409,
  );
});
test('weekly history follows schedules, records check-ins, and stays owner scoped after archive', async () => {
  const from = addDays(today, -6);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const invalidCategory = await call('POST', '/api/v1/habits', {
    name: 'Invalid category',
    category: 'Fitness',
    schedule: { frequency: 'daily' },
    startDate: from,
  });
  assert.equal(invalidCategory.statusCode, 400);
  const created = await call('POST', '/api/v1/habits', {
    name: 'Weekly history example',
    category: 'Learning',
    schedule: { frequency: 'weekly', weekdays: [weekday] },
    target: 1,
    startDate: from,
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().habit.id;
  const completed = await call('POST', `/api/v1/habits/${id}/complete`, {
    date: today,
  });
  assert.equal(completed.statusCode, 200, completed.body);
  const updated = await call('PUT', `/api/v1/habits/${id}`, {
    version: created.json().habit.version,
    name: 'Weekly reading',
    category: 'Mindfulness',
    schedule: { frequency: 'weekly', weekdays: [weekday] },
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().habit.name, 'Weekly reading');
  assert.equal(updated.json().habit.category, 'Mindfulness');
  const url = `/api/v1/history?from=${from}&to=${today}`;
  const history = await call('GET', url);
  assert.equal(history.statusCode, 200, history.body);
  const routine = history
    .json()
    .habits.find((h: { id: number }) => h.id === id);
  assert.equal(routine.category, 'Mindfulness');
  assert.equal(
    routine.days.filter((day: { scheduled: boolean }) => day.scheduled).length,
    1,
  );
  assert.deepEqual(
    routine.days.find((day: { date: string }) => day.date === today),
    {
      date: today,
      scheduled: true,
      status: 'completed',
      recorded: true,
      value: 1,
      target: 1,
    },
  );
  const other = await call('GET', url, undefined, otherToken);
  assert.equal(other.statusCode, 200);
  assert.equal(
    other.json().habits.some((h: { id: number }) => h.id === id),
    false,
  );
  const invalid = await call(
    'GET',
    `/api/v1/history?from=${addDays(today, -7)}&to=${today}`,
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal((await call('DELETE', `/api/v1/habits/${id}`)).statusCode, 204);
  const archived = await call('GET', url);
  assert.equal(
    archived.json().habits.find((h: { id: number }) => h.id === id).archived,
    true,
  );
});
after(async () => {
  if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  if (secondId) await pool.query('DELETE FROM users WHERE id=$1', [secondId]);
  await app.close();
  await pool.end();
});
