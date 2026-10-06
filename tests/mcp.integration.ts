import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
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
const password = 'correct horse battery staple 2026';
let userId = '';
test('read-only MCP tools expose only the token owner and stop after revocation', async () => {
  const signup = await app.inject({
    method: 'POST',
    url: '/api/v1/signup',
    headers: { origin: config.WEB_ORIGIN },
    payload: {
      email: `mcp-${crypto.randomUUID()}@example.test`,
      password,
      name: 'MCP owner',
      timezone: 'Asia/Kolkata',
    },
  });
  assert.equal(signup.statusCode, 201, signup.body);
  userId = signup.json().user.id;
  const bearer = signup.json().token.accessToken;
  const headers = {
    origin: config.WEB_ORIGIN,
    authorization: `Bearer ${bearer}`,
  };
  const today = dateInTimezone(new Date(), 'Asia/Kolkata');
  const habit = await app.inject({
    method: 'POST',
    url: '/api/v1/habits',
    headers,
    payload: {
      name: 'Private routine',
      schedule: { frequency: 'daily' },
      startDate: today,
    },
  });
  assert.equal(habit.statusCode, 201, habit.body);
  const invalid = await app.inject({
    method: 'POST',
    url: '/api/v1/mcp-tokens',
    headers,
    payload: { label: 'Claude', password: 'wrong' },
  });
  assert.equal(invalid.statusCode, 403);
  const issued = await app.inject({
    method: 'POST',
    url: '/api/v1/mcp-tokens',
    headers,
    payload: { label: 'Claude', password },
  });
  assert.equal(issued.statusCode, 201, issued.body);
  const readToken = issued.json().token as string;
  const listed = await app.inject({
    method: 'GET',
    url: '/api/v1/mcp-tokens',
    headers,
  });
  assert.equal(JSON.stringify(listed.json()).includes(readToken), false);
  const executable = fileURLToPath(
    new URL('../apps/mcp/dist/apps/mcp/src/main.js', import.meta.url),
  );
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [executable],
    env: { DATABASE_URL: connectionString, MCP_READ_TOKEN: readToken },
  });
  try {
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes('get_today'));
    assert.equal(
      names.some((name) => name.includes('write') || name.includes('delete')),
      false,
    );
    const response = await client.callTool({
      name: 'get_today',
      arguments: {},
    });
    assert.equal(response.isError, undefined);
    assert.match(JSON.stringify(response.structuredContent), /Private routine/);
    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/mcp-tokens/${issued.json().id}`,
      headers,
    });
    assert.equal(revoked.statusCode, 204);
    const denied = await client.callTool({ name: 'get_today', arguments: {} });
    assert.equal(denied.isError, true);
  } finally {
    await client.close();
  }
});
after(async () => {
  if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  await app.close();
  await pool.end();
});
