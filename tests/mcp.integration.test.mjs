import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080';
const parsedBase = new URL(base);
if (!['127.0.0.1', 'localhost'].includes(parsedBase.hostname))
  throw new Error('MCP integration tests only run against a local server');
const origin = parsedBase.origin;
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

async function call(token, path, method = 'GET', body) {
  const response = await globalThis.fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    value: response.status === 204 ? null : await response.json(),
  };
}
async function account() {
  const password = 'Qa-' + randomUUID() + '-password';
  const response = await call(null, '/api/v1/signup', 'POST', {
    email: 'mcp-' + randomUUID() + '@example.test',
    name: 'MCP QA',
    password,
    timezone: 'Asia/Kolkata',
  });
  assert.equal(response.status, 201, JSON.stringify(response.value));
  return { jwt: response.value.token.accessToken, password };
}
async function tokenFor(account) {
  const response = await call(account.jwt, '/api/v1/mcp-tokens', 'POST', {
    password: account.password,
    label: 'MCP integration test',
  });
  assert.equal(response.status, 201, JSON.stringify(response.value));
  return response.value;
}

async function runServer(env) {
  return new Promise((resolveResult, reject) => {
    const child = spawn('node', ['apps/mcp/dist/apps/mcp/src/main.js'], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolveResult({ code, stdout, stderr }));
  });
}

test('MCP startup fails closed without credentials or backend and keeps stdout clean', async () => {
  const missing = await runServer({
    MCP_READ_TOKEN: '',
    HABIT_API_URL: 'http://127.0.0.1:9',
  });
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, '');
  const unavailable = await runServer({
    MCP_READ_TOKEN: 'htr_' + 'x'.repeat(43),
    HABIT_API_URL: 'http://127.0.0.1:9',
  });
  assert.equal(unavailable.code, 1);
  assert.equal(unavailable.stdout, '');
  assert.match(unavailable.stderr, /authorization failed/);
});

test(
  'MCP stdio uses backend ownership, read-only authorization, prompts and revocation',
  { timeout: 120000 },
  async () => {
    const first = await account();
    const second = await account();
    let client;
    let assistantToken;
    try {
      const habit = await call(first.jwt, '/api/v1/habits', 'POST', {
        name: 'MCP private habit',
        schedule: { frequency: 'daily' },
        category: 'Learning',
        target: 1,
        startDate: today,
      });
      assert.equal(habit.status, 201, JSON.stringify(habit.value));
      const habitId = habit.value.habit.id;
      const journal = await call(first.jwt, '/api/v1/journal/' + today, 'PUT', {
        content: 'Private MCP journal marker',
        blueprintId: null,
        responses: {},
        status: 'saved',
        version: null,
      });
      assert.equal(journal.status, 200, JSON.stringify(journal.value));
      assistantToken = await tokenFor(first);
      const secondToken = await tokenFor(second);
      const profile = await call(assistantToken.token, '/api/v1/mcp/profile');
      assert.equal(profile.status, 200);
      assert.equal(profile.value.timezone, 'Asia/Kolkata');
      assert.equal(
        (await call(assistantToken.token, '/api/v1/account/export')).status,
        401,
      );
      assert.equal(
        (await call(assistantToken.token, '/api/v1/mcp-tokens')).status,
        401,
      );
      assert.equal(
        (
          await call(
            assistantToken.token,
            '/api/v1/habits/' + habitId + '/complete',
            'POST',
            { date: today },
          )
        ).status,
        401,
      );
      assert.equal(
        (await call(secondToken.token, '/api/v1/habits/' + habitId)).status,
        404,
      );
      assert.equal(
        (await call(secondToken.token, '/api/v1/journal/' + today)).value
          .status,
        'empty',
      );
      assert.equal(
        (await call('htr_' + 'x'.repeat(43), '/api/v1/mcp/profile')).status,
        401,
      );

      client = new Client({ name: 'habit-mcp-test', version: '1.0.0' });
      const transport = new StdioClientTransport({
        command: resolve('scripts/mcp-run.sh'),
        env: {
          ...process.env,
          MCP_READ_TOKEN: assistantToken.token,
          OPENAI_API_KEY: '',
        },
        stderr: 'pipe',
      });
      await client.connect(transport);
      const tools = await client.listTools();
      assert.ok(tools.tools.some((item) => item.name === 'get_today_context'));
      assert.ok(tools.tools.some((item) => item.name === 'get_journal_entry'));
      assert.ok(
        tools.tools.every((item) => item.annotations?.readOnlyHint === true),
      );
      const prompts = await client.listPrompts();
      assert.deepEqual(prompts.prompts.map((item) => item.name).sort(), [
        'daily_mentor',
        'journal_reflection',
        'weekly_mentor',
      ]);
      const daily = await client.callTool({
        name: 'get_today_context',
        arguments: {},
      });
      assert.equal(daily.isError, undefined);
      assert.equal(daily.structuredContent.data.date, today);
      assert.ok(
        daily.structuredContent.data.habits.some((item) => item.id === habitId),
      );
      const expected = await call(
        first.jwt,
        '/api/v1/history?from=' + today + '&to=' + today,
      );
      const history = await client.callTool({
        name: 'get_habit_history',
        arguments: { from: today, to: today },
      });
      assert.deepEqual(history.structuredContent.data, expected.value);
      const day = new Date(today + 'T00:00:00Z');
      day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
      const monday = day.toISOString().slice(0, 10);
      for (const [name, args] of [
        ['get_habit_summary', { page: 1 }],
        ['get_habit_details', { habitId, from: today, to: today }],
        ['get_task_summary', { from: today, to: today }],
        ['get_goal_progress', {}],
        ['get_journal_blueprints', {}],
        ['get_weekly_review_context', { weekStart: monday }],
      ]) {
        const item = await client.callTool({ name, arguments: args });
        assert.equal(
          item.isError,
          undefined,
          name + ': ' + JSON.stringify(item.content),
        );
        assert.ok(item.structuredContent?.data, name);
      }
      const dailyPrompt = await client.getPrompt({ name: 'daily_mentor' });
      assert.equal(dailyPrompt.messages.length, 1);
      const journalResult = await client.callTool({
        name: 'get_journal_entry',
        arguments: { date: today },
      });
      assert.equal(
        journalResult.structuredContent.data.content,
        'Private MCP journal marker',
      );
      const context = await client.callTool({
        name: 'get_mentor_context',
        arguments: {
          from: today,
          to: today,
          categories: ['journal_dates'],
        },
      });
      assert.equal(
        JSON.stringify(context.structuredContent).includes(
          'Private MCP journal marker',
        ),
        false,
      );
      const invalid = await client.callTool({
        name: 'get_habit_history',
        arguments: {
          from: '2026-01-01',
          to: '2026-03-01',
        },
      });
      assert.equal(invalid.isError, true);
      const revoke = await call(
        first.jwt,
        '/api/v1/mcp-tokens/' + assistantToken.id,
        'DELETE',
      );
      assert.equal(revoke.status, 204);
      const after = await client.callTool({
        name: 'get_today_context',
        arguments: {},
      });
      assert.equal(after.isError, true);
      assert.equal(
        (await call(assistantToken.token, '/api/v1/mcp/profile')).status,
        401,
      );
    } finally {
      if (client) await client.close();
      for (const account of [first, second]) {
        const deleted = await call(account.jwt, '/api/v1/account', 'DELETE', {
          password: account.password,
        });
        assert.equal(deleted.status, 204, JSON.stringify(deleted.value));
      }
    }
  },
);
