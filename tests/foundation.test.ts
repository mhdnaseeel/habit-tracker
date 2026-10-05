import { test } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { loadConfig } from '../apps/api/src/config.ts';
import { createApp } from '../apps/api/src/app.ts';
const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost/test',
});
test('configuration rejects missing database and insecure production without leaking secrets', () => {
  assert.throws(() => loadConfig({}), /DATABASE_URL/);
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://private:secret@localhost/test',
      }),
    /Production requires/,
  );
});
test('liveness and readiness are distinct, carry headers and match OpenAPI', async () => {
  const app = await createApp(config, async () => {});
  try {
    const live = await app.inject('/health/live');
    assert.equal(live.statusCode, 200);
    assert.deepEqual(live.json(), { status: 'ok' });
    assert.ok(live.headers['x-request-id']);
    assert.equal(live.headers['cache-control'], 'no-store');
    assert.ok(live.headers['x-content-type-options']);
    assert.equal((await app.inject('/health/ready')).statusCode, 200);
    const docs = (await app.inject('/api/v1/openapi.json')).json();
    assert.ok(docs.paths['/health/live']);
    assert.ok(docs.paths['/health/ready']);
    const unknown = await app.inject('/api/v1/habits');
    assert.equal(unknown.statusCode, 404);
    assert.equal(unknown.json().success, false);
  } finally {
    await app.close();
  }
});
test('readiness fails closed on database failure without exposing internals', async () => {
  const app = await createApp(config, async () => {
    throw new Error('private database credential');
  });
  try {
    const response = await app.inject('/health/ready');
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { status: 'unavailable' });
    assert.equal((await app.inject('/health/live')).statusCode, 200);
  } finally {
    await app.close();
  }
});
test('CORS allows only configured frontend', async () => {
  const app = await createApp(config, async () => {});
  try {
    const response = await app.inject({
      url: '/health/live',
      headers: { origin: 'https://hostile.example' },
    });
    assert.notEqual(
      response.headers['access-control-allow-origin'],
      'https://hostile.example',
    );
  } finally {
    await app.close();
  }
});

test('app factory allows lifecycle hooks before listen or injection', async () => {
  const app = await createApp(config, async () => {});
  let closed = false;
  app.addHook('onClose', async () => {
    closed = true;
  });
  await app.inject('/health/live');
  await app.close();
  assert.equal(closed, true);
});

test('signup rolls back account creation when its session cannot be created', async () => {
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.startsWith('INSERT INTO users'))
        return {
          rows: [
            {
              id: 'd61b574b-99ee-4ba2-8d43-e176e6045147',
              email: 'rollback@example.test',
              name: 'Rollback',
              timezone: 'UTC',
              role: 'user',
              version: 1,
              password_hash: 'hashed',
            },
          ],
        };
      if (sql.startsWith('INSERT INTO sessions'))
        throw new Error('simulated session failure');
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
  } as unknown as pg.Pool;
  const app = await createApp(
    loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost/test',
      ACCESS_TOKEN_SECRET: 'test-only-secret-at-least-32-characters',
    }),
    async () => {},
    pool,
  );
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/signup',
      headers: { origin: 'http://127.0.0.1:5173' },
      payload: {
        email: 'rollback@example.test',
        password: 'correct horse battery staple',
        name: 'Rollback',
        timezone: 'UTC',
      },
    });
    assert.equal(response.statusCode, 500);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(statements.at(-1), 'ROLLBACK');
    assert.ok(statements.includes('BEGIN'));
    assert.ok(!statements.includes('COMMIT'));
  } finally {
    await app.close();
  }
});
