import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createHabitMentorServer } from '../../mcp/src/server.ts';
import type { Config } from './config.ts';
import type { Principal } from './auth.ts';
import { transaction } from './database.ts';

type Authenticate = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<Principal | undefined>;
const scope = 'habit.read';
const pkceChallenge = /^[A-Za-z0-9_-]{43}$/;
// RFC 7636 permits period and tilde in a verifier; current MCP clients use them.
const pkceVerifier = /^[A-Za-z0-9._~-]{43,128}$/;
const uuid = z.uuid();
const registration = z
  .object({
    client_name: z.string().trim().min(1).max(100),
    redirect_uris: z.array(z.string().url().max(2048)).min(1).max(5),
    token_endpoint_auth_method: z.literal('none').optional(),
    grant_types: z.array(z.string()).optional(),
    response_types: z.array(z.string()).optional(),
  })
  .passthrough();
const authorization = z
  .object({
    response_type: z.literal('code'),
    client_id: uuid,
    redirect_uri: z.url().max(2048),
    scope: z.literal(scope),
    state: z.string().min(1).max(512),
    code_challenge: z.string().regex(pkceChallenge),
    code_challenge_method: z.literal('S256'),
    resource: z.url(),
  })
  .passthrough();
const consent = z
  .object({
    request_id: uuid,
    decision: z.enum(['approve', 'deny']),
    email: z.email().max(255).optional(),
    password: z.string().min(1).max(128).optional(),
  })
  .strict();
const tokenRequest = z.discriminatedUnion('grant_type', [
  z
    .object({
      grant_type: z.literal('authorization_code'),
      client_id: uuid,
      code: z.string().min(1).max(128),
      redirect_uri: z.url(),
      code_verifier: z.string().regex(pkceVerifier),
      resource: z.url(),
    })
    .passthrough(),
  z
    .object({
      grant_type: z.literal('refresh_token'),
      client_id: uuid,
      refresh_token: z.string().regex(/^htrf_[A-Za-z0-9_-]{43}$/),
      resource: z.url(),
    })
    .passthrough(),
]);
const revokeRequest = z
  .object({ client_id: uuid, token: z.string().min(1).max(128) })
  .passthrough();

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function secret(prefix: string) {
  return prefix + randomBytes(32).toString('base64url');
}
function oauthError(reply: FastifyReply, status: number, code: string) {
  return reply
    .code(status)
    .header('Cache-Control', 'no-store')
    .send({ error: code });
}
function callbackAllowed(value: string) {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
function html(value: string) {
  const replacements: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (match) => replacements[match] ?? match);
}
function returnToClient(reply: FastifyReply, destination: URL) {
  const callback = html(destination.toString());
  return reply
    .code(200)
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .header('Referrer-Policy', 'no-referrer')
    .send(
      [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta http-equiv="refresh" content="0;url=',
        callback,
        '"><title>Returning to your AI client</title><style>',
        'body{font:16px system-ui;background:#faf3f0;color:#243d35;max-width:32rem;margin:12vh auto;padding:1.5rem}',
        'main{background:white;border-radius:1rem;padding:2rem;box-shadow:0 8px 30px #243d3520}',
        'a{display:block;background:#b9674b;color:white;text-align:center;padding:.8rem;border-radius:.5rem;font-weight:700}',
        '</style></head><body><main><h1>Connection decision saved</h1>',
        '<p>Returning you to your AI client…</p><p><a href="',
        callback,
        '">Return to your AI client</a></p>',
        '<p><small>If you are not redirected automatically, use the button above.</small></p>',
        '</main></body></html>',
      ].join(''),
    );
}
function constantEqual(first: string, second: string) {
  const a = Buffer.from(first);
  const b = Buffer.from(second);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function registerMcpRemote(
  app: FastifyInstance,
  pool: pg.Pool,
  config: Config,
  authenticate: Authenticate,
) {
  const origin = new URL(config.WEB_ORIGIN).origin;
  const resource = new URL('/mcp', origin).toString();
  const issuer = origin;
  const metadataUrl = new URL(
    '/.well-known/oauth-protected-resource/mcp',
    origin,
  ).toString();
  const asMetadata = {
    issuer,
    authorization_endpoint: origin + '/oauth/authorize',
    token_endpoint: origin + '/oauth/token',
    registration_endpoint: origin + '/oauth/register',
    revocation_endpoint: origin + '/oauth/revoke',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [scope],
  };
  const resourceMetadata = {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [scope],
    bearer_methods_supported: ['header'],
  };
  app.get('/.well-known/oauth-authorization-server', async () => asMetadata);
  app.get(
    '/.well-known/oauth-protected-resource/mcp',
    async () => resourceMetadata,
  );
  app.get(
    '/.well-known/oauth-protected-resource',
    async () => resourceMetadata,
  );

  app.post(
    '/oauth/register',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const parsed = registration.safeParse(request.body);
      if (
        !parsed.success ||
        parsed.data.redirect_uris.some((value) => !callbackAllowed(value)) ||
        (parsed.data.grant_types &&
          parsed.data.grant_types.some(
            (value) => !['authorization_code', 'refresh_token'].includes(value),
          )) ||
        (parsed.data.response_types &&
          parsed.data.response_types.some((value) => value !== 'code'))
      )
        return oauthError(reply, 400, 'invalid_client_metadata');
      const registered = await pool.query<{ id: string }>(
        'INSERT INTO mcp_oauth_clients(name,redirect_uris) VALUES($1,$2::jsonb) RETURNING id',
        [parsed.data.client_name, JSON.stringify(parsed.data.redirect_uris)],
      );
      return reply.code(201).send({
        client_id: registered.rows[0]?.id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: parsed.data.client_name,
        redirect_uris: parsed.data.redirect_uris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      });
    },
  );

  app.get(
    '/oauth/authorize',
    {
      config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const parsed = authorization.safeParse(request.query);
      if (!parsed.success || parsed.data.resource !== resource)
        return oauthError(reply, 400, 'invalid_request');
      const client = (
        await pool.query<{ name: string; redirect_uris: string[] }>(
          'SELECT name,redirect_uris FROM mcp_oauth_clients WHERE id=$1',
          [parsed.data.client_id],
        )
      ).rows[0];
      if (!client || !client.redirect_uris.includes(parsed.data.redirect_uri))
        return oauthError(reply, 400, 'invalid_client');
      const pending = await pool.query<{ id: string }>(
        'INSERT INTO mcp_oauth_requests(client_id,redirect_uri,state,code_challenge,resource) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [
          parsed.data.client_id,
          parsed.data.redirect_uri,
          parsed.data.state,
          parsed.data.code_challenge,
          resource,
        ],
      );
      const requestId = pending.rows[0]?.id;
      if (!requestId) throw new Error('OAuth request insert failed');
      return reply
        .type('text/html; charset=utf-8')
        .header('Referrer-Policy', 'no-referrer')
        .header('Cache-Control', 'no-store')
        .send(
          [
            '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1">',
            '<title>Connect Habit Tracker</title><style>',
            'body{font:16px system-ui;background:#faf3f0;color:#243d35;max-width:32rem;margin:8vh auto;padding:1.5rem}',
            'main{background:white;border-radius:1rem;padding:2rem;box-shadow:0 8px 30px #243d3520}',
            'input,button{font:inherit;width:100%;box-sizing:border-box;padding:.75rem;margin:.4rem 0 1rem;border-radius:.5rem;border:1px solid #9a9a9a}',
            'button{background:#b9674b;color:white;border:0;cursor:pointer}button.secondary{background:#e9ece8;color:#243d35}',
            'label{display:block;font-weight:600}small{display:block;overflow-wrap:anywhere}</style>',
            '<main><h1>Connect Habit Tracker</h1><p><strong>',
            html(client.name),
            '</strong> requests read-only access to your habits, tasks, goals, Today plan, insights, and daily journal.</p>',
            '<p>Only connect a client you trust. It may send what it reads to its own AI service.</p>',
            '<small>Return to: ',
            html(parsed.data.redirect_uri),
            '</small>',
            '<form method="post" action="/oauth/authorize"><input type="hidden" name="request_id" value="',
            requestId,
            '"><label>Email<input name="email" type="email" autocomplete="username" required></label>',
            '<label>Password<input name="password" type="password" autocomplete="current-password" required></label>',
            '<button name="decision" value="approve" type="submit">Sign in and allow read-only access</button>',
            '<button class="secondary" name="decision" value="deny" type="submit" formnovalidate>Cancel</button>',
            '</form></main></html>',
          ].join(''),
        );
    },
  );

  app.post(
    '/oauth/authorize',
    {
      config: { rateLimit: { max: 8, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      // Some agent webviews omit Origin or send "null" for a top-level form.
      // The one-time request ID and account password still gate approval.
      const submittedOrigin = request.headers.origin;
      if (
        submittedOrigin &&
        submittedOrigin !== 'null' &&
        submittedOrigin !== origin
      )
        return oauthError(reply, 403, 'access_denied');
      const input = consent.safeParse(request.body);
      if (!input.success) return oauthError(reply, 400, 'invalid_request');
      const pending = (
        await pool.query<{
          client_id: string;
          redirect_uri: string;
          state: string;
          code_challenge: string;
          resource: string;
        }>(
          'SELECT client_id,redirect_uri,state,code_challenge,resource FROM mcp_oauth_requests WHERE id=$1 AND expires_at>now()',
          [input.data.request_id],
        )
      ).rows[0];
      if (!pending) return oauthError(reply, 400, 'invalid_request');
      if (input.data.decision === 'deny') {
        await pool.query('DELETE FROM mcp_oauth_requests WHERE id=$1', [
          input.data.request_id,
        ]);
        const destination = new URL(pending.redirect_uri);
        destination.searchParams.set('error', 'access_denied');
        destination.searchParams.set('state', pending.state);
        destination.searchParams.set('iss', issuer);
        return returnToClient(reply, destination);
      }
      if (!input.data.email || !input.data.password)
        return oauthError(reply, 400, 'invalid_request');
      const user = (
        await pool.query<{ id: string; password_hash: string }>(
          'SELECT id,password_hash FROM users WHERE email=$1',
          [input.data.email.toLowerCase()],
        )
      ).rows[0];
      if (
        !user ||
        !(await argon2.verify(user.password_hash, input.data.password))
      )
        return reply
          .code(403)
          .type('text/plain')
          .send(
            'Sign-in did not match. Return to the connection request and try again.',
          );
      const code = secret('htc_');
      const inserted = await transaction(pool, async (client) => {
        const locked = (
          await client.query<{ client_id: string }>(
            'SELECT client_id FROM mcp_oauth_requests WHERE id=$1 AND expires_at>now() FOR UPDATE',
            [input.data.request_id],
          )
        ).rows[0];
        if (!locked) return false;
        await client.query(
          'INSERT INTO mcp_oauth_codes(code_hash,user_id,client_id,redirect_uri,code_challenge,resource) VALUES($1,$2,$3,$4,$5,$6)',
          [
            hash(code),
            user.id,
            pending.client_id,
            pending.redirect_uri,
            pending.code_challenge,
            pending.resource,
          ],
        );
        await client.query('DELETE FROM mcp_oauth_requests WHERE id=$1', [
          input.data.request_id,
        ]);
        return true;
      });
      if (!inserted) return oauthError(reply, 400, 'invalid_request');
      const destination = new URL(pending.redirect_uri);
      destination.searchParams.set('code', code);
      destination.searchParams.set('state', pending.state);
      destination.searchParams.set('iss', issuer);
      return returnToClient(reply, destination);
    },
  );

  app.post(
    '/oauth/token',
    {
      config: { rateLimit: { max: 120, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const parsed = tokenRequest.safeParse(request.body);
      if (!parsed.success || parsed.data.resource !== resource)
        return oauthError(reply, 400, 'invalid_request');
      if (parsed.data.grant_type === 'authorization_code') {
        const input = parsed.data;
        const challenge = createHash('sha256')
          .update(input.code_verifier)
          .digest('base64url');
        const access = secret('hto_');
        const refresh = secret('htrf_');
        const granted = await transaction(pool, async (client) => {
          const code = (
            await client.query<{
              user_id: string;
              client_id: string;
              redirect_uri: string;
              code_challenge: string;
              resource: string;
            }>(
              'SELECT user_id,client_id,redirect_uri,code_challenge,resource FROM mcp_oauth_codes WHERE code_hash=$1 AND expires_at>now() FOR UPDATE',
              [hash(input.code)],
            )
          ).rows[0];
          if (
            !code ||
            code.client_id !== input.client_id ||
            code.redirect_uri !== input.redirect_uri ||
            code.resource !== resource ||
            !constantEqual(code.code_challenge, challenge)
          )
            return false;
          await client.query('DELETE FROM mcp_oauth_codes WHERE code_hash=$1', [
            hash(input.code),
          ]);
          const grant = (
            await client.query<{ id: string }>(
              'INSERT INTO mcp_oauth_grants(user_id,client_id,resource,refresh_hash) VALUES($1,$2,$3,$4) RETURNING id',
              [code.user_id, code.client_id, resource, hash(refresh)],
            )
          ).rows[0];
          if (!grant) throw new Error('OAuth grant insert failed');
          await client.query(
            'INSERT INTO mcp_oauth_access_tokens(token_hash,grant_id) VALUES($1,$2)',
            [hash(access), grant.id],
          );
          await client.query(
            "INSERT INTO audit_logs(user_id,entity,entity_id,action,request_id) VALUES($1,'McpOAuthGrant',$2,'CREATE',$3)",
            [code.user_id, grant.id, request.id],
          );
          return true;
        });
        if (!granted) return oauthError(reply, 400, 'invalid_grant');
        return reply
          .header('Cache-Control', 'no-store')
          .header('Pragma', 'no-cache')
          .send({
            access_token: access,
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: refresh,
            scope,
          });
      }
      const input = parsed.data;
      const access = secret('hto_');
      const refresh = secret('htrf_');
      const refreshed = await transaction(pool, async (client) => {
        const row = (
          await client.query<{
            id: string;
            user_id: string;
            client_id: string;
            resource: string;
          }>(
            'SELECT id,user_id,client_id,resource FROM mcp_oauth_grants WHERE refresh_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',
            [hash(input.refresh_token)],
          )
        ).rows[0];
        if (!row) {
          const reused = (
            await client.query<{ grant_id: string }>(
              'SELECT grant_id FROM mcp_oauth_refresh_history WHERE token_hash=$1',
              [hash(input.refresh_token)],
            )
          ).rows[0];
          if (reused)
            await client.query(
              'UPDATE mcp_oauth_grants SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1',
              [reused.grant_id],
            );
          return false;
        }
        if (row.client_id !== input.client_id || row.resource !== resource)
          return false;
        await client.query(
          'INSERT INTO mcp_oauth_refresh_history(token_hash,grant_id) VALUES($1,$2)',
          [hash(input.refresh_token), row.id],
        );
        await client.query(
          "UPDATE mcp_oauth_grants SET refresh_hash=$1,expires_at=now()+interval '30 days' WHERE id=$2",
          [hash(refresh), row.id],
        );
        await client.query(
          'INSERT INTO mcp_oauth_access_tokens(token_hash,grant_id) VALUES($1,$2)',
          [hash(access), row.id],
        );
        return true;
      });
      if (!refreshed) return oauthError(reply, 400, 'invalid_grant');
      return reply
        .header('Cache-Control', 'no-store')
        .header('Pragma', 'no-cache')
        .send({
          access_token: access,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: refresh,
          scope,
        });
    },
  );

  app.post('/oauth/revoke', async (request, reply) => {
    const parsed = revokeRequest.safeParse(request.body);
    if (!parsed.success) return oauthError(reply, 400, 'invalid_request');
    const tokenHash = hash(parsed.data.token);
    await pool.query(
      'UPDATE mcp_oauth_grants SET revoked_at=coalesce(revoked_at,now()) WHERE client_id=$1 AND (refresh_hash=$2 OR id IN (SELECT grant_id FROM mcp_oauth_access_tokens WHERE token_hash=$2))',
      [parsed.data.client_id, tokenHash],
    );
    return reply.code(200).send({});
  });

  app.get('/api/v1/mcp/connections', async (request, reply) => {
    const owner = await authenticate(request, reply);
    if (!owner) return;
    const rows = (
      await pool.query(
        'SELECT g.id,c.name,g.created_at,g.expires_at,g.revoked_at FROM mcp_oauth_grants g JOIN mcp_oauth_clients c ON c.id=g.client_id WHERE g.user_id=$1 ORDER BY g.created_at DESC LIMIT 100',
        [owner.userId],
      )
    ).rows;
    return { connections: rows };
  });
  app.delete('/api/v1/mcp/connections/:id', async (request, reply) => {
    if (request.headers.origin !== origin)
      return oauthError(reply, 403, 'access_denied');
    const owner = await authenticate(request, reply);
    if (!owner) return;
    const params = z.object({ id: uuid }).safeParse(request.params);
    if (!params.success) return oauthError(reply, 400, 'invalid_request');
    const revoked = await transaction(pool, async (client) => {
      const updated = await client.query(
        'UPDATE mcp_oauth_grants SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND user_id=$2',
        [params.data.id, owner.userId],
      );
      if (!updated.rowCount) return false;
      await client.query(
        "INSERT INTO audit_logs(user_id,entity,entity_id,action,request_id) VALUES($1,'McpOAuthGrant',$2,'REVOKE',$3)",
        [owner.userId, params.data.id, request.id],
      );
      return true;
    });
    return revoked
      ? reply.code(204).send()
      : oauthError(reply, 404, 'invalid_request');
  });

  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    config: { rateLimit: { max: 120, timeWindow: '15 minutes' } },
    handler: async (request, reply) => {
      if (request.headers.origin && request.headers.origin !== origin)
        return oauthError(reply, 403, 'invalid_origin');
      if (request.headers.host !== new URL(origin).host)
        return oauthError(reply, 403, 'invalid_host');
      const auth = request.headers.authorization;
      const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
      const challenge =
        'Bearer realm="Habit Tracker MCP", resource_metadata="' +
        metadataUrl +
        '"';
      if (!/^hto_[A-Za-z0-9_-]{43}$/.test(token))
        return reply
          .code(401)
          .header('WWW-Authenticate', challenge)
          .send({ error: 'invalid_token' });
      const grant = (
        await pool.query<{ id: string }>(
          'SELECT g.id FROM mcp_oauth_access_tokens a JOIN mcp_oauth_grants g ON g.id=a.grant_id WHERE a.token_hash=$1 AND a.expires_at>now() AND g.revoked_at IS NULL AND g.expires_at>now() AND g.resource=$2',
          [hash(token), resource],
        )
      ).rows[0];
      if (!grant)
        return reply
          .code(401)
          .header('WWW-Authenticate', challenge)
          .send({ error: 'invalid_token' });
      const { server } = createHabitMentorServer(
        token,
        'http://127.0.0.1:' + config.PORT,
      );
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
      });
      // SDK v1's Node transport types conflict under exactOptionalPropertyTypes.
      await server.connect(
        transport as unknown as Parameters<typeof server.connect>[0],
      );
      reply.hijack();
      try {
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } finally {
        await server.close();
      }
    },
  });
}
