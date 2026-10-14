import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';
import { URL, URLSearchParams } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  Client as ModernClient,
  StreamableHTTPClientTransport as ModernTransport,
  UnauthorizedError,
} from '@modelcontextprotocol/client';

const fetch = globalThis.fetch;

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080';
const origin = new URL(base).origin;
const hostedOptIn =
  process.env.TEST_HOSTED_MCP === '1' &&
  origin === 'https://habit-tracker-xard.onrender.com';
if (
  !['127.0.0.1', 'localhost'].includes(new URL(base).hostname) &&
  !hostedOptIn
)
  throw new Error(
    'Remote MCP integration tests only run locally or against the opted-in Habit Tracker host',
  );

async function callbackFrom(response) {
  assert.equal(response.status, 200);
  const document = await response.text();
  const href = document
    .match(/<a href="([^"]+)">Return to your AI client<\/a>/)?.[1]
    .replaceAll('&amp;', '&');
  assert.ok(href);
  return new URL(href);
}

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
    let modernClient;
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
      if (!hostedOptIn) {
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
        const verifier = randomBytes(32).toString('base64url') + '.~';
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
        assert.equal(
          consent.headers.get('cross-origin-opener-policy'),
          'unsafe-none',
        );
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
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            request_id: requestId,
            decision: 'approve',
            email: signup.body.user.email,
            password,
          }),
        });
        const location = await callbackFrom(approved);
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
              headers: {
                Authorization: 'Bearer ' + exchanged.body.access_token,
              },
            },
          },
        );
        client = new Client({ name: 'remote-mcp-test', version: '1.0.0' });
        await client.connect(transport);
        const tools = await client.listTools();
        assert.ok(
          tools.tools.some((item) => item.name === 'get_today_context'),
        );
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
            Origin: 'null',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            request_id: secondRequestId,
            decision: 'approve',
            email: signup.body.user.email,
            password,
          }),
        });
        const secondCode = (
          await callbackFrom(secondApproval)
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
      }

      // Exercise the current SDK's own OAuth discovery and dynamic registration,
      // not only a manually supplied bearer token.
      const provider = {
        redirectUrl: callback,
        clientMetadata: {
          client_name: 'Modern MCP OAuth integration',
          redirect_uris: [callback],
          token_endpoint_auth_method: 'none',
        },
        client: undefined,
        tokenSet: undefined,
        verifier: undefined,
        authorizationUrl: undefined,
        discovery: undefined,
        stateValue: randomUUID(),
        state() {
          return this.stateValue;
        },
        clientInformation() {
          return this.client;
        },
        saveClientInformation(value) {
          this.client = value;
        },
        tokens() {
          return this.tokenSet;
        },
        saveTokens(value) {
          this.tokenSet = value;
        },
        redirectToAuthorization(value) {
          this.authorizationUrl = value;
        },
        saveCodeVerifier(value) {
          this.verifier = value;
        },
        codeVerifier() {
          return this.verifier;
        },
        saveDiscoveryState(value) {
          this.discovery = value;
        },
        discoveryState() {
          return this.discovery;
        },
      };
      const modernUrl = new URL(base + '/mcp');
      const firstTransport = new ModernTransport(modernUrl, {
        authProvider: provider,
      });
      modernClient = new ModernClient({
        name: 'modern-oauth-test',
        version: '1.0.0',
      });
      await assert.rejects(
        modernClient.connect(firstTransport),
        UnauthorizedError,
      );
      assert.ok(provider.authorizationUrl);
      assert.equal(provider.authorizationUrl.origin, origin);
      assert.ok(provider.client?.client_id);
      const modernConsent = await fetch(provider.authorizationUrl);
      assert.equal(modernConsent.status, 200);
      const modernRequestId = (await modernConsent.text()).match(
        /name="request_id" value="([a-f0-9-]+)"/,
      )?.[1];
      assert.ok(modernRequestId);
      const modernApproval = await fetch(base + '/oauth/authorize', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          request_id: modernRequestId,
          decision: 'approve',
          email: signup.body.user.email,
          password,
        }),
      });
      const modernParams = (await callbackFrom(modernApproval)).searchParams;
      assert.equal(modernParams.get('state'), provider.stateValue);
      await firstTransport.finishAuth(modernParams);
      assert.ok(provider.tokenSet?.access_token);
      await modernClient.connect(
        new ModernTransport(modernUrl, {
          authProvider: provider,
        }),
      );
      const modernTools = await modernClient.listTools();
      assert.ok(
        modernTools.tools.some((item) => item.name === 'get_today_context'),
      );
      const modernToday = await modernClient.callTool({
        name: 'get_today_context',
        arguments: {},
      });
      assert.equal(modernToday.isError, undefined, JSON.stringify(modernToday));
      if (!hostedOptIn) {
        const otherPassword = 'Qa-' + randomUUID() + '-password';
        const otherAccount = await request('/api/v1/signup', 'POST', {
          email: 'other-remote-mcp-' + randomUUID() + '@example.test',
          name: 'Other MCP QA',
          password: otherPassword,
          timezone: 'Asia/Kolkata',
        });
        assert.equal(otherAccount.response.status, 201);
        const otherJwt = otherAccount.body.token.accessToken;
        try {
          const privateHabit = await request(
            '/api/v1/habits',
            'POST',
            {
              name: 'Other account private habit',
              schedule: { frequency: 'daily' },
              category: 'Learning',
              target: 1,
              startDate: modernToday.structuredContent.data.date,
            },
            otherJwt,
          );
          assert.equal(privateHabit.response.status, 201);
          const firstAccountView = await modernClient.callTool({
            name: 'get_today_context',
            arguments: {},
          });
          assert.equal(
            JSON.stringify(firstAccountView.structuredContent).includes(
              'Other account private habit',
            ),
            false,
          );
          const activeConnections = await request(
            '/api/v1/mcp/connections',
            'GET',
            undefined,
            jwt,
          );
          const activeGrant = activeConnections.body.connections.find(
            (item) => !item.revoked_at,
          );
          assert.ok(activeGrant);
          assert.equal(
            (
              await request(
                '/api/v1/mcp/connections/' + activeGrant.id,
                'DELETE',
                undefined,
                otherJwt,
              )
            ).response.status,
            404,
          );
          const stillAvailable = await modernClient.callTool({
            name: 'get_today_context',
            arguments: {},
          });
          assert.equal(stillAvailable.isError, undefined);
        } finally {
          const removed = await request(
            '/api/v1/account',
            'DELETE',
            {
              password: otherPassword,
            },
            otherJwt,
          );
          assert.equal(removed.response.status, 204);
        }
      }
    } finally {
      if (client) await client.close();
      if (modernClient) await modernClient.close();
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
