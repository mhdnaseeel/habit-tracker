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
let userId = '';
let otherId = '';
let access = '';
let otherAccess = '';
let taskId = 0;
async function signup(email: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/signup',
    headers: { origin },
    payload: {
      email,
      password: 'correct horse battery staple 2026',
      name: 'Task tester',
      timezone: 'Asia/Kolkata',
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
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
test('task create validates owner and carries one unfinished occurrence to today', async () => {
  const owner = await signup(`task-${crypto.randomUUID()}@example.test`);
  userId = owner.user.id;
  access = owner.token.accessToken;
  const other = await signup(`task-${crypto.randomUUID()}@example.test`);
  otherId = other.user.id;
  otherAccess = other.token.accessToken;
  assert.equal(
    (await app.inject(`/api/v1/tasks?from=${today}&to=${today}`)).statusCode,
    401,
  );
  const created = await call('POST', '/api/v1/tasks', {
    title: 'Write report',
    dueDate: yesterday,
    priority: 1,
    carryOver: true,
  });
  assert.equal(created.statusCode, 201, created.body);
  taskId = created.json().task.id;
  assert.equal(created.json().task.displayDate, today);
  const listed = await call('GET', `/api/v1/tasks?from=${today}&to=${today}`);
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().tasks.length, 1);
  assert.equal(listed.json().tasks[0].title, 'Write report');
  const hidden = await call(
    'GET',
    `/api/v1/tasks?from=${today}&to=${today}`,
    undefined,
    otherAccess,
  );
  assert.equal(hidden.json().tasks.length, 0);
  const bad = await call('POST', '/api/v1/tasks', {
    title: '',
    dueDate: today,
  });
  assert.equal(bad.statusCode, 400);
});
test('completion, undo and stale edits stay owner-scoped', async () => {
  const other = await call(
    'POST',
    `/api/v1/tasks/${taskId}/complete`,
    undefined,
    otherAccess,
  );
  assert.equal(other.statusCode, 404);
  const done = await call('POST', `/api/v1/tasks/${taskId}/complete`);
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().task.completed, true);
  const retry = await call('POST', `/api/v1/tasks/${taskId}/complete`);
  assert.equal(retry.statusCode, 200);
  const stale = await call('PUT', `/api/v1/tasks/${taskId}`, {
    version: 2,
    title: 'Stale',
  });
  assert.equal(stale.statusCode, 409);
  const edit = await call('PUT', `/api/v1/tasks/${taskId}`, {
    version: 1,
    title: 'Write final report',
  });
  assert.equal(edit.statusCode, 200);
  assert.equal(edit.json().task.version, 2);
  const moveDone = await call('PUT', `/api/v1/tasks/${taskId}`, {
    version: 2,
    dueDate: today,
  });
  assert.equal(moveDone.statusCode, 409);
  const undone = await call('POST', `/api/v1/tasks/${taskId}/undo`);
  assert.equal(undone.statusCode, 200);
  assert.equal(undone.json().task.completed, false);
});
test('archive removes task from active views and preserves instance row', async () => {
  const gone = await call('DELETE', `/api/v1/tasks/${taskId}`);
  assert.equal(gone.statusCode, 204);
  const list = await call('GET', `/api/v1/tasks?from=${yesterday}&to=${today}`);
  assert.equal(list.json().tasks.length, 0);
  const instance = await pool.query(
    'SELECT 1 FROM task_instances WHERE task_id=$1',
    [taskId],
  );
  assert.equal(instance.rowCount, 1);
  assert.equal(
    (await call('POST', `/api/v1/tasks/${taskId}/complete`)).statusCode,
    409,
  );
});
after(async () => {
  if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  if (otherId) await pool.query('DELETE FROM users WHERE id=$1', [otherId]);
  await app.close();
  await pool.end();
});
