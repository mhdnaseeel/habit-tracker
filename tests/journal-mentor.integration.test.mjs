import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import process from 'node:process';

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Journal integration tests only run against a local server');
const origin = new URL(base).origin;
const date = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

async function call(token, path, method = 'GET', body) {
  const response = await globalThis.fetch(`${base}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  const password = `Qa-${randomUUID()}-password`;
  const result = await call(null, '/api/v1/signup', 'POST', {
    email: `journal-${randomUUID()}@example.test`,
    name: 'Journal QA',
    password,
    timezone: 'Asia/Kolkata',
  });
  assert.equal(result.status, 201, JSON.stringify(result.value));
  return { token: result.value.token.accessToken, password };
}
async function good(token, path, method = 'GET', body, status = 200) {
  const result = await call(token, path, method, body);
  assert.equal(result.status, status, JSON.stringify(result.value));
  return result.value;
}

test('journal blueprint, draft, history, ownership and AI isolation', async () => {
  const first = await account();
  const second = await account();
  try {
    const path = `/api/v1/journal/${date}`;
    assert.equal((await call(null, path)).status, 401);
    const blueprints = (await good(first.token, '/api/v1/journal/blueprints'))
      .blueprints;
    assert.equal(blueprints.length, 5);
    const guide = blueprints.find((item) => item.id === 'daily-reflection');
    assert.equal(guide.prompts[0].text, 'How was my day?');
    const empty = await good(first.token, path);
    assert.equal(empty.status, 'empty');
    assert.equal(empty.version, null);
    const draft = await good(first.token, path, 'PUT', {
      content: '',
      blueprintId: guide.id,
      responses: { 'daily-reflection:day': 'A careful start.' },
      status: 'draft',
      version: null,
    });
    assert.equal(draft.status, 'draft');
    assert.deepEqual(draft.blueprintSnapshot, guide.prompts);
    assert.equal(
      (await good(first.token, path)).responses['daily-reflection:day'],
      'A careful start.',
    );
    const secondRead = await good(second.token, path);
    assert.equal(secondRead.version, null);
    assert.equal(
      (await call(second.token, path, 'DELETE', { version: draft.version }))
        .status,
      409,
    );
    const saved = await good(first.token, path, 'PUT', {
      content: 'Free writing remains intact.',
      blueprintId: guide.id,
      responses: { 'daily-reflection:day': 'A careful start.' },
      status: 'saved',
      version: draft.version,
    });
    assert.equal(saved.content, 'Free writing remains intact.');
    assert.equal(saved.version, draft.version + 1);
    assert.equal(
      (
        await call(first.token, path, 'PUT', {
          content: 'Stale',
          blueprintId: guide.id,
          responses: {},
          status: 'saved',
          version: draft.version,
        })
      ).status,
      409,
    );
    const month = date.slice(0, 7);
    const history = await good(
      first.token,
      `/api/v1/journal/history?from=${month}-01&to=${date}`,
    );
    assert.equal(history.entries[0].date, date);
    assert.equal(history.entries[0].status, 'saved');
    const context = await good(first.token, `${path}/context`);
    assert.ok(Array.isArray(context.habits));
    assert.ok(Array.isArray(context.goals));
    const exportData = await good(first.token, '/api/v1/account/export');
    assert.equal(
      exportData.journal.find((item) => item.date.slice(0, 10) === date)
        .responses['daily-reflection:day'],
      'A careful start.',
    );
    const consent = await good(first.token, '/api/v1/mentor/consent');
    assert.equal(consent.consent, false);
    assert.equal(
      (
        await call(first.token, '/api/v1/mentor/guidance', 'POST', {
          focus: 'journal',
          includeJournal: true,
        })
      ).status,
      403,
    );
    await good(first.token, '/api/v1/mentor/consent', 'PUT', { consent: true });
    assert.equal(
      (await good(first.token, '/api/v1/mentor/consent')).consent,
      true,
    );
    await good(first.token, '/api/v1/mentor/consent', 'PUT', {
      consent: false,
    });
    await good(first.token, path, 'DELETE', { version: saved.version }, 204);
    assert.equal((await good(first.token, path)).status, 'empty');
  } finally {
    for (const user of [first, second]) {
      const deletion = await call(user.token, '/api/v1/account', 'DELETE', {
        password: user.password,
      });
      assert.equal(deletion.status, 204, JSON.stringify(deletion.value));
    }
  }
});
