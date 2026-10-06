import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createApp } from '../apps/api/src/app.ts';
import { loadConfig } from '../apps/api/src/config.ts';
import { dateInTimezone } from '../packages/domain/src/index.ts';

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
const origin = config.WEB_ORIGIN;
const today = dateInTimezone(new Date(), 'Asia/Kolkata');
const month = today.slice(0, 7);
const password = 'correct horse battery staple 2026';
let ownerId = '',
  otherId = '',
  access = '',
  otherAccess = '',
  goalId = 0,
  habitId = 0;
async function signup(name: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/signup',
    headers: { origin },
    payload: {
      email: `planner-${crypto.randomUUID()}@example.test`,
      password,
      name,
      timezone: 'Asia/Kolkata',
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json();
}
async function call(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
  token = access,
) {
  return app.inject({
    method,
    url,
    headers: {
      origin,
      authorization: `Bearer ${token}`,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
}
test('goals, steps and habit links are owned and report progress', async () => {
  const owner = await signup('Planner owner');
  ownerId = owner.user.id;
  access = owner.token.accessToken;
  const other = await signup('Another owner');
  otherId = other.user.id;
  otherAccess = other.token.accessToken;
  assert.equal(
    (
      await call('POST', '/api/v1/goals', {
        title: 'Bad',
        category: 'Undefined area',
      })
    ).statusCode,
    400,
  );
  const created = await call('POST', '/api/v1/goals', {
    title: 'Read 12 books',
    category: 'Learning',
  });
  assert.equal(created.statusCode, 201, created.body);
  goalId = created.json().goal.id;
  const habit = await call('POST', '/api/v1/habits', {
    name: 'Read daily',
    schedule: { frequency: 'daily' },
    startDate: today,
    category: 'Learning',
  });
  assert.equal(habit.statusCode, 201, habit.body);
  habitId = habit.json().habit.id;
  const step = await call('POST', `/api/v1/goals/${goalId}/steps`, {
    title: 'Finish first book',
  });
  assert.equal(step.statusCode, 201, step.body);
  assert.equal(
    (
      await call(
        'PUT',
        `/api/v1/goals/${goalId}/steps/${step.json().step.id}`,
        { completed: true },
        otherAccess,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        'PUT',
        `/api/v1/goals/${goalId}/steps/${step.json().step.id}`,
        { completed: true },
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await call('POST', `/api/v1/goals/${goalId}/habits/${habitId}`))
      .statusCode,
    200,
  );
  const list = await call('GET', '/api/v1/goals');
  assert.equal(list.json().goals[0].progress.percentage, 100);
  assert.deepEqual(list.json().goals[0].habitIds, [habitId]);
  assert.equal(
    (await call('GET', '/api/v1/goals', undefined, otherAccess)).json().goals
      .length,
    0,
  );
});
test('mindset, journal, and insights remain account scoped', async () => {
  const mindset = await call('PUT', `/api/v1/mindset/${today}`, {
    energy: 4,
    focus: 3,
    motivation: 5,
  });
  assert.equal(mindset.statusCode, 200, mindset.body);
  const own = await call('GET', `/api/v1/mindset?from=${today}&to=${today}`);
  assert.equal(own.json().entries[0].energy, 4);
  assert.equal(
    (
      await call(
        'GET',
        `/api/v1/mindset?from=${today}&to=${today}`,
        undefined,
        otherAccess,
      )
    ).json().entries.length,
    0,
  );
  const saved = await call('PUT', `/api/v1/journal/${month}`, {
    content: 'A thoughtful month.',
    version: null,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().version, 1);
  assert.equal(
    (
      await call('PUT', `/api/v1/journal/${month}`, {
        content: 'Stale edit',
        version: null,
      })
    ).statusCode,
    409,
  );
  const updated = await call('PUT', `/api/v1/journal/${month}`, {
    content: 'A thoughtful month.',
    version: 1,
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().version, 2);
  assert.equal(
    (await call('GET', `/api/v1/journal/${month}`)).json().content,
    'A thoughtful month.',
  );
  assert.equal(
    (
      await call('GET', `/api/v1/journal/${month}`, undefined, otherAccess)
    ).json().content,
    '',
  );
  assert.equal(
    (await call('POST', `/api/v1/habits/${habitId}/complete`, { date: today }))
      .statusCode,
    200,
  );
  const insights = await call('GET', '/api/v1/insights?weeks=2');
  assert.equal(insights.statusCode, 200, insights.body);
  assert.ok(
    insights
      .json()
      .leaderboard.some((entry: { id: number }) => entry.id === habitId),
  );
  assert.equal(
    (
      await call('GET', '/api/v1/insights?weeks=2', undefined, otherAccess)
    ).json().leaderboard.length,
    0,
  );
});
test('export excludes credentials and account deletion erases owned content', async () => {
  const exported = await call('GET', '/api/v1/account/export');
  assert.equal(exported.statusCode, 200, exported.body);
  assert.equal(exported.json().profile.id, ownerId);
  assert.equal(exported.json().goals[0].id, goalId);
  assert.equal(exported.json().journal[0].content, 'A thoughtful month.');
  assert.equal(
    JSON.stringify(exported.json()).includes('password_hash'),
    false,
  );
  assert.equal(JSON.stringify(exported.json()).includes('refresh_hash'), false);
  assert.equal(
    (await call('DELETE', '/api/v1/account', { password: 'wrong' })).statusCode,
    403,
  );
  assert.equal((await call('GET', '/api/v1/goals')).statusCode, 200);
  const deleted = await call('DELETE', '/api/v1/account', { password });
  assert.equal(deleted.statusCode, 204, deleted.body);
  ownerId = '';
  assert.equal((await call('GET', '/api/v1/goals')).statusCode, 401);
  assert.equal(
    (await pool.query('SELECT 1 FROM goals WHERE id=$1', [goalId])).rowCount,
    0,
  );
  assert.equal(
    (await call('GET', '/api/v1/goals', undefined, otherAccess)).statusCode,
    200,
  );
});
after(async () => {
  if (ownerId) await pool.query('DELETE FROM users WHERE id=$1', [ownerId]);
  if (otherId) await pool.query('DELETE FROM users WHERE id=$1', [otherId]);
  await app.close();
  await pool.end();
});
