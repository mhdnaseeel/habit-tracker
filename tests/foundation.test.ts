import { test } from 'node:test';
import assert from 'node:assert/strict';
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
