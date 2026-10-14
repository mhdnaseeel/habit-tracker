import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askOpenAI, groundRecommendations } from '../apps/api/src/mentor.ts';

const config = {
  OPENAI_API_KEY: 'test-only-key',
  OPENAI_REPORT_MODEL: 'test-model',
};
const output = {
  recommendations: [
    {
      title: 'Resume reading',
      area: 'Habit',
      evidenceIds: ['habit-1'],
      nextAction: 'Read for ten minutes.',
      priority: 'medium',
      confidence: 'observed',
    },
  ],
  reflectionQuestions: ['What helped today?'],
};
function providerResponse(value = output) {
  return new globalThis.Response(
    JSON.stringify({
      output: [
        { content: [{ type: 'output_text', text: JSON.stringify(value) }] },
      ],
    }),
    { status: 200 },
  );
}

test('mentor provider requests bounded, nonstored structured output', async () => {
  let called = 0;
  const result = await askOpenAI(
    config,
    { evidence: [{ id: 'habit-1' }] },
    async (url, init) => {
      called++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(init.body);
      assert.equal(body.store, false);
      assert.equal(body.model, 'test-model');
      assert.equal(body.max_output_tokens, 850);
      assert.equal(body.text.format.type, 'json_schema');
      assert.ok(body.instructions.includes('untrusted data'));
      return providerResponse();
    },
  );
  assert.equal(called, 1);
  await assert.rejects(
    askOpenAI(
      config,
      {},
      async () =>
        new globalThis.Response(
          JSON.stringify({ error: { code: 'insufficient_quota' } }),
          { status: 429 },
        ),
    ),
    /provider_quota/,
  );
  assert.equal(result.recommendations[0].evidenceIds[0], 'habit-1');
});

test('mentor provider retries one server failure but rejects malformed output', async () => {
  let called = 0;
  const result = await askOpenAI(config, {}, async () => {
    called++;
    return called === 1
      ? new globalThis.Response('', { status: 503 })
      : providerResponse();
  });
  assert.equal(called, 2);
  assert.equal(
    result.recommendations[0].title,
    output.recommendations[0].title,
  );
  await assert.rejects(
    askOpenAI(config, {}, async () =>
      providerResponse({
        ...output,
        recommendations: [{ ...output.recommendations[0], evidenceIds: [] }],
      }),
    ),
  );
});

test('mentor provider surfaces rate limits and timeouts without retry storms', async () => {
  let called = 0;
  await assert.rejects(
    askOpenAI(config, {}, async () => {
      called++;
      return new globalThis.Response('', { status: 429 });
    }),
    /provider_rate_limit/,
  );
  assert.equal(called, 1);
  await assert.rejects(
    askOpenAI(config, {}, async () => {
      throw new globalThis.DOMException('aborted', 'TimeoutError');
    }),
    /aborted/,
  );
});

test('mentor recommendations require owned evidence from the claimed area', () => {
  const evidence = [
    {
      id: 'habit-1',
      area: 'Habit',
      summary: 'Reading was due today',
      source: 'current plan',
    },
  ];
  const grounded = groundRecommendations(output.recommendations, evidence);
  assert.equal(grounded[0].evidence[0].summary, evidence[0].summary);
  assert.throws(() =>
    groundRecommendations(
      [{ ...output.recommendations[0], evidenceIds: ['unknown'] }],
      evidence,
    ),
  );
  assert.throws(() =>
    groundRecommendations(
      [{ ...output.recommendations[0], area: 'Goal' }],
      evidence,
    ),
  );
});
