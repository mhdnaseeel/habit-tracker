import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createApp } from '../apps/api/src/app.ts';
import { loadConfig } from '../apps/api/src/config.ts';
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
const email = `auth-${crypto.randomUUID()}@example.test`;
const email2 = `auth-${crypto.randomUUID()}@example.test`;
const password = 'correct horse battery staple 2026';
let userId = '';
let secondId = '';
let access = '';
let refresh = '';
const post = async (
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  await app.inject({
    method: 'POST',
    url,
    headers: {
      origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

test('registration validates input and creates a real user, settings, hashed password and revocable session', async () => {
  const invalid = await post('/api/v1/signup', {
    email: 'bad',
    password: 'short',
    name: '',
    timezone: 'Mars/Olympus',
  });
  assert.equal(invalid.statusCode, 400);
  const response = await post('/api/v1/signup', {
    email,
    password,
    name: 'Sample User',
    timezone: 'Asia/Kolkata',
  });
  assert.equal(response.statusCode, 201, response.body);
  const body = response.json();
  userId = body.user.id;
  access = body.token.accessToken;
  refresh = String(response.headers['set-cookie']).split(';')[0] ?? '';
  assert.equal(body.user.email, email);
  assert.equal(body.user.password_hash, undefined);
  assert.match(refresh, /^habit-refresh=/);
  const stored = await pool.query<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id=$1',
    [userId],
  );
  assert.ok(stored.rows[0]?.password_hash.startsWith('$argon2id$'));
  assert.notEqual(stored.rows[0]?.password_hash, password);
  assert.equal(
    (await pool.query('SELECT 1 FROM settings WHERE user_id=$1', [userId]))
      .rowCount,
    1,
  );
  const duplicate = await post('/api/v1/signup', {
    email,
    password,
    name: 'Again',
    timezone: 'UTC',
  });
  assert.equal(duplicate.statusCode, 409);
});
test('login rejects invalid credentials and returns no password details', async () => {
  const wrong = await post('/api/v1/login', { email, password: 'wrong' });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.json().error.message, 'Invalid email or password');
  const unknown = await post('/api/v1/login', {
    email: 'unknown-' + email,
    password,
  });
  assert.equal(unknown.statusCode, 401);
  const valid = await post('/api/v1/login', { email, password });
  assert.equal(valid.statusCode, 200);
  assert.ok(valid.json().token.accessToken);
});
test('owner profile is isolated and optimistic concurrency rejects stale writes', async () => {
  const other = await post('/api/v1/signup', {
    email: email2,
    password,
    name: 'Other',
    timezone: 'UTC',
  });
  assert.equal(other.statusCode, 201);
  secondId = other.json().user.id;
  const unauth = await app.inject('/api/v1/user');
  assert.equal(unauth.statusCode, 401);
  const me = await app.inject({ url: '/api/v1/user', headers: bearer(access) });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.id, userId);
  assert.equal(me.json().user.password_hash, undefined);
  const forbidden = await app.inject({
    method: 'PUT',
    url: '/api/v1/user',
    headers: { origin, ...bearer(access) },
    payload: { name: 'Hijacked', version: 1, userId: secondId },
  });
  assert.equal(forbidden.statusCode, 400);
  const update = await app.inject({
    method: 'PUT',
    url: '/api/v1/user',
    headers: { origin, ...bearer(access) },
    payload: { name: 'Updated', version: 1 },
  });
  assert.equal(update.statusCode, 200);
  assert.equal(update.json().user.name, 'Updated');
  const stale = await app.inject({
    method: 'PUT',
    url: '/api/v1/user',
    headers: { origin, ...bearer(access) },
    payload: { name: 'Stale', version: 1 },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(
    (
      await pool.query<{ name: string }>('SELECT name FROM users WHERE id=$1', [
        secondId,
      ])
    ).rows[0]?.name,
    'Other',
  );
});
test('refresh rotates token and replay revokes the entire family', async () => {
  const rotated = await post('/api/v1/refresh', undefined, { cookie: refresh });
  assert.equal(rotated.statusCode, 200, rotated.body);
  const next = String(rotated.headers['set-cookie']).split(';')[0] ?? '';
  const newAccess = rotated.json().token.accessToken;
  assert.notEqual(next, refresh);
  const replay = await post('/api/v1/refresh', undefined, { cookie: refresh });
  assert.equal(replay.statusCode, 401);
  const family = await post('/api/v1/refresh', undefined, { cookie: next });
  assert.equal(family.statusCode, 401);
  assert.equal(
    (await app.inject({ url: '/api/v1/user', headers: bearer(newAccess) }))
      .statusCode,
    401,
  );
});
test('logout revokes access; origin checks protect cookie actions', async () => {
  const login = await post('/api/v1/login', { email, password });
  const token = login.json().token.accessToken;
  const badOrigin = await app.inject({
    method: 'POST',
    url: '/api/v1/logout',
    headers: { origin: 'https://attacker.example', ...bearer(token) },
  });
  assert.equal(badOrigin.statusCode, 403);
  const logout = await post('/api/v1/logout', undefined, bearer(token));
  assert.equal(logout.statusCode, 204);
  assert.equal(
    (await app.inject({ url: '/api/v1/user', headers: bearer(token) }))
      .statusCode,
    401,
  );
});
after(async () => {
  if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  if (secondId) await pool.query('DELETE FROM users WHERE id=$1', [secondId]);
  await app.close();
  await pool.end();
});
