import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';
import { URL, URLSearchParams } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const fetch = globalThis.fetch;

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080';
const origin = new URL(base).origin;
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error(
    'Remote MCP integration tests only run against a local server',
  );

async function request(path, method = 'GET', body, token) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
  });
  return {
    response,
    body: response.status === 204 ? null : await response.json(),
  };
}

async function token(clientId, params) {
  const response = await fetch(base + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      resource: base + '/mcp',
      ...params,
    }),
  });
  return { status: response.status, body: await response.json() };
}

test(
  'remote OAuth MCP authorizes one account, rotates refresh tokens, and disconnects',
  { timeout: 120000 },
  async () => {
    const password = 'Qa-' + randomUUID() + '-password';
    const signup = await request('/api/v1/signup', 'POST', {
      email: 'remote-mcp-' + randomUUID() + '@example.test',
      name: 'Remote MCP QA',
      password,
      timezone: 'Asia/Kolkata',
    });
    assert.equal(signup.response.status, 201, JSON.stringify(signup.body));
    const jwt = signup.body.token.accessToken;
    let client;
    try {
      const metadata = await request('/.well-known/oauth-authorization-server');
      assert.equal(metadata.body.issuer, origin);
      assert.deepEqual(metadata.body.code_challenge_methods_supported, [
        'S256',
      ]);
      const protectedMetadata = await request(
        '/.well-known/oauth-protected-resource/mcp',
      );
      assert.equal(protectedMetadata.body.resource, base + '/mcp');
      const unauthenticated = await request('/mcp');
      assert.equal(unauthenticated.response.status, 401);
      assert.match(
        unauthenticated.response.headers.get('www-authenticate'),
        /resource_metadata=/,
      );

      const callback = origin + '/oauth-test-callback';
      const registered = await request('/oauth/register', 'POST', {
        client_name: 'Remote MCP integration',
        redirect_uris: [callback],
        token_endpoint_auth_method: 'none',
      });
      assert.equal(
        registered.response.status,
        201,
        JSON.stringify(registered.body),
      );
      const clientId = registered.body.client_id;
      const unsafeClient = await request('/oauth/register', 'POST', {
        client_name: 'Unsafe redirect',
        redirect_uris: ['http://example.com/callback'],
      });
      assert.equal(unsafeClient.response.status, 400);
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256')
        .update(verifier)
        .digest('base64url');
      const query = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: callback,
        scope: 'habit.read',
        state: 'test-state',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: base + '/mcp',
      });
      const wrongResource = new URLSearchParams(query);
      wrongResource.set('resource', origin + '/api/v1/account/export');
      assert.equal(
        (await fetch(base + '/oauth/authorize?' + wrongResource)).status,
        400,
      );
      const wrongRedirect = new URLSearchParams(query);
      wrongRedirect.set('redirect_uri', 'https://example.com/callback');
      assert.equal(
        (await fetch(base + '/oauth/authorize?' + wrongRedirect)).status,
        400,
      );
      const consent = await fetch(base + '/oauth/authorize?' + query);
      assert.equal(consent.status, 200);
      const consentHtml = await consent.text();
      assert.match(consentHtml, /read-only access/);
      const requestId = consentHtml.match(
        /name="request_id" value="([a-f0-9-]+)"/,
      )?.[1];
      assert.ok(requestId);
      const foreignOrigin = await fetch(base + '/oauth/authorize', {
        method: 'POST',
        headers: {
          Origin: 'https://example.com',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          request_id: requestId,
          decision: 'approve',
          email: signup.body.user.email,
          password,
        }),
      });
      assert.equal(foreignOrigin.status, 403);
      const approved = await fetch(base + '/oauth/authorize', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Origin: origin,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          request_id: requestId,
          decision: 'approve',
          email: signup.body.user.email,
          password,
        }),
      });
      assert.equal(approved.status, 302);
      const location = new URL(approved.headers.get('location'));
      assert.equal(location.origin, origin);
      assert.equal(location.searchParams.get('state'), 'test-state');
      assert.equal(location.searchParams.get('iss'), origin);
      const code = location.searchParams.get('code');
      assert.ok(code);
      const codeParams = {
        grant_type: 'authorization_code',
        code,
        redirect_uri: callback,
        code_verifier: verifier,
      };
      const badVerifier = await token(clientId, {
        ...codeParams,
        code_verifier: 'x'.repeat(43),
      });
      assert.equal(badVerifier.status, 400);
      const exchanged = await token(clientId, codeParams);
      assert.equal(exchanged.status, 200, JSON.stringify(exchanged.body));
      assert.equal((await token(clientId, codeParams)).status, 400);

      const transport = new StreamableHTTPClientTransport(
        new URL(base + '/mcp'),
        {
          requestInit: {
            headers: { Authorization: 'Bearer ' + exchanged.body.access_token },
          },
        },
      );
      client = new Client({ name: 'remote-mcp-test', version: '1.0.0' });
      await client.connect(transport);
      const tools = await client.listTools();
      assert.ok(tools.tools.some((item) => item.name === 'get_today_context'));
      assert.ok(
        tools.tools.every((item) => item.annotations?.readOnlyHint === true),
      );
      const today = await client.callTool({
        name: 'get_today_context',
        arguments: {},
      });
      assert.equal(today.isError, undefined, JSON.stringify(today));
      assert.ok(today.structuredContent.data.date);
      assert.equal(
        (
          await request(
            '/api/v1/account/export',
            'GET',
            undefined,
            exchanged.body.access_token,
          )
        ).response.status,
        401,
      );
      assert.equal(
        (
          await request(
            '/api/v1/habits',
            'POST',
            { name: 'blocked' },
            exchanged.body.access_token,
          )
        ).response.status,
        401,
      );

      const refreshed = await token(clientId, {
        grant_type: 'refresh_token',
        refresh_token: exchanged.body.refresh_token,
      });
      assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
      assert.notEqual(
        refreshed.body.refresh_token,
        exchanged.body.refresh_token,
      );
      const connections = await request(
        '/api/v1/mcp/connections',
        'GET',
        undefined,
        jwt,
      );
      assert.equal(connections.response.status, 200);
      assert.ok(connections.body.connections.length >= 1);
      const grantId = connections.body.connections[0].id;
      const disconnected = await request(
        '/api/v1/mcp/connections/' + grantId,
        'DELETE',
        undefined,
        jwt,
      );
      assert.equal(disconnected.response.status, 204);
      assert.equal(
        (await request('/mcp', 'GET', undefined, refreshed.body.access_token))
          .response.status,
        401,
      );
      assert.equal(
        (
          await token(clientId, {
            grant_type: 'refresh_token',
            refresh_token: refreshed.body.refresh_token,
          })
        ).status,
        400,
      );

      const secondConsent = await fetch(base + '/oauth/authorize?' + query);
      assert.equal(secondConsent.status, 200);
      const secondRequestId = (await secondConsent.text()).match(
        /name="request_id" value="([a-f0-9-]+)"/,
      )?.[1];
      assert.ok(secondRequestId);
      const secondApproval = await fetch(base + '/oauth/authorize', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Origin: origin,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          request_id: secondRequestId,
          decision: 'approve',
          email: signup.body.user.email,
          password,
        }),
      });
      assert.equal(secondApproval.status, 302);
      const secondCode = new URL(
        secondApproval.headers.get('location'),
      ).searchParams.get('code');
      assert.ok(secondCode);
      const secondGrant = await token(clientId, {
        ...codeParams,
        code: secondCode,
      });
      assert.equal(secondGrant.status, 200);
      const secondRefresh = await token(clientId, {
        grant_type: 'refresh_token',
        refresh_token: secondGrant.body.refresh_token,
      });
      assert.equal(secondRefresh.status, 200);
      const replay = await token(clientId, {
        grant_type: 'refresh_token',
        refresh_token: secondGrant.body.refresh_token,
      });
      assert.equal(replay.status, 400);
      assert.equal(
        (
          await request(
            '/mcp',
            'GET',
            undefined,
            secondRefresh.body.access_token,
          )
        ).response.status,
        401,
      );
    } finally {
      if (client) await client.close();
      const deleted = await request(
        '/api/v1/account',
        'DELETE',
        { password },
        jwt,
      );
      assert.equal(deleted.response.status, 204);
    }
  },
);
